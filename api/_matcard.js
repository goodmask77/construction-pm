// ── 產品與成本模組｜批次 2「物料卡」後端（v4.70.33，2026-10-10）──
// 規格 docs/COST_MODULE_SPEC.md §3 物料庫＋物料卡、資料模型（物料卡／供應品／價格紀錄／合併拆分／單位換算）、計算規則。
// 核心：**物料卡**（不變內部 ID）與**供應品**（＝阿桑系統的代碼，A Beach products.code／GROUN:D gops.products.code）分開；
//   ・供應品主檔＝boss-api 即時（每小時）；本檔只存「人做的決定」：供應品→卡的歸屬、卡的屬性、換算確認、手動報價、拆分規則、合併紀錄
//   ・價格紀錄＝叫貨序列（ordi／gordi，每張單一點，只新增不覆寫）＋手動報價（quotes，只新增）；「當時價」＝該日前最後一筆
//   ・成本基準價＝主要供應品 最近實際叫貨價 ÷ 已確認換算（每基準單位）；換算沒確認＝不完整（顯示建議值但標未確認）
//   ・統一料號（之後）：只改卡的 displaySku，舊代碼永遠保留為別名
import { loadSnap, loadSeries, loadMaster, norm, num } from './_cost.js'

export const CARD_KEY = 'sp_finance_pm_matcard'
const TYPES = ['原料', '半成品', '包材', '非食品']
const BASE_UNITS = ['g', 'ml', '個']
const METRIC = { kg: ['g', 1000], 公斤: ['g', 1000], g: ['g', 1], 公克: ['g', 1], 克: ['g', 1], l: ['ml', 1000], 公升: ['ml', 1000], ml: ['ml', 1], 毫升: ['ml', 1], cc: ['ml', 1] }
const r4 = n => Math.round(n * 1e4) / 1e4
const nowIso = () => new Date().toISOString()
const supplyKeyOf = (sys, code) => (sys === 'GROUN:D' ? 'G|' : 'A|') + norm(code)

// 規格文字 → 建議換算（1000g/罐、1kg*10塊/箱、200g*5盒、500ml、12入）
export function parseSpec (spec) {
  const t = String(spec || '').replace(/，/g, ',').replace(/×/g, '*').replace(/[xX]\s*(\d)/g, '*$1').replace(/／/g, '/')
  const out = []
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|k|g|l|ml|cc|公斤|公克|毫升|公升|克)(?![a-z])/i)
  if (m) {
    const v = Number(m[1]); const u = m[2].toLowerCase()
    const mult = (t.slice(m.index + m[0].length).match(/^\s*\*\s*(\d+(?:\.\d+)?)/) || [])[1]
    const f = mult ? Number(mult) : 1
    const [to, k] = METRIC[u === 'k' ? 'kg' : u] || []
    if (to) out.push({ to, factor: r4(v * k * f), why: `規格「${spec}」` })
  }
  const n = t.match(/(\d+)\s*(入|顆|片|塊|個|包|支|張|粒)/)
  if (n) out.push({ to: '個', factor: Number(n[1]), why: `規格「${spec}」${n[2]}` })
  return out
}
// 快照換算文字「g=1000; 顆=9」→ [{to, factor}]
function parseConvText (txt) {
  const out = []
  for (const seg of String(txt || '').split(/[;；]/)) { const m = seg.trim().match(/^([a-zA-Z一-龥]+)\s*=\s*(\d+(?:\.\d+)?)/); if (m) out.push({ to: m[1].toLowerCase(), factor: Number(m[2]) }) }
  return out
}
function guessBaseUnit (sup, convs) {
  const u = String(sup.unit || '').toLowerCase()
  if (METRIC[u]) return METRIC[u][0]
  const c = convs.find(x => x.to === 'g' || x.to === 'ml'); if (c) return c.to
  if (/包材|耗材|杯|盒|袋|紙|吸管|餐具/.test((sup.cat || '') + (sup.name || ''))) return '個'
  return '個'
}
function guessType (sup) {
  const c = (sup.cat || '') + '|' + (sup.dept || '')
  if (/包材|耗材|清潔|文具|瓦斯|用品/.test(c) || /杯蓋|吸管|紙袋|餐盒|手套|垃圾袋|洗碗/.test(sup.name || '')) return /清潔|文具|瓦斯|用品|洗碗|手套|垃圾/.test(c + sup.name) ? '非食品' : '包材'
  return '原料'
}

export async function buildCards ({ kvGet, months }) {
  const snap = await loadSnap(kvGet)
  const [master, serA, serG, doc0] = await Promise.all([loadMaster(kvGet, snap), loadSeries(kvGet, months), loadSeries(kvGet, months, 'gordi', 'GROUN:D'), kvGet(CARD_KEY)])
  const doc = doc0 || { cards: {}, supplyCard: {}, conv: {}, quotes: [], splits: {}, log: [] }
  // 價格紀錄：供應品鍵 → [{d, p, q, src, supplier}]
  const recs = {}
  for (const s of [...serA.series, ...serG.series]) {
    if (!s.code) continue
    const k = supplyKeyOf(s.sys, s.code)
    ;(recs[k] = recs[k] || []).push(...s.pts.map(p => ({ d: p.d, p: p.p, q: p.q, src: 'order', supplier: s.supplier, oid: p.oid })))
  }
  for (const q of (doc.quotes || [])) (recs[q.supplyKey] = recs[q.supplyKey] || []).push({ d: q.date, p: q.price, src: q.src || 'quote', by: q.by, note: q.note })
  for (const k of Object.keys(recs)) recs[k].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  // 供應品（即時主檔）＋拆分出來的虛擬供應品
  const supplies = {}
  for (const p of master.products) {
    const k = supplyKeyOf(p.sys, p.code)
    const snapConv = parseConvText(p.conv)
    const sugg = parseSpec(p.spec)
    const confirmed = (doc.conv[k] || []).filter(c => !c.off)
    const convs = [
      ...confirmed.map(c => ({ ...c, status: c.status || 'confirmed' })),
      ...snapConv.filter(c => !confirmed.some(x => x.to === c.to)).map(c => ({ to: c.to, factor: c.factor, status: 'snapshot', why: '阿桑系統 item_convs（10-06 快照）' })),
      ...sugg.filter(c => !confirmed.some(x => x.to === c.to) && !snapConv.some(x => x.to === c.to && Math.abs(x.factor - c.factor) < 1e-6)).map(c => ({ ...c, status: 'suggested' })),
    ]
    const mu = METRIC[String(p.unit || '').toLowerCase()]
    if (mu && !convs.some(c => c.to === mu[0])) convs.unshift({ to: mu[0], factor: mu[1], status: 'metric', why: '公制固定換算' })
    const rs = recs[k] || []
    const split = doc.splits[k]
    const own = split ? rs.filter(r => r.src !== 'order' || !(r.p >= split.minPrice)) : rs
    const lastOrder = own.filter(r => r.src === 'order').slice(-1)[0] || null
    const lastConfirmed = own.filter(r => r.src === 'confirmed').slice(-1)[0] || null
    supplies[k] = { key: k, sys: p.sys, code: p.code, sku: p.sku || '', name: p.name, supplier: p.supplier, spec: p.spec || '', unit: p.unit || '', price: p.price, tax: p.tax || '', status: p.status, cat: p.cat || '', dept: p.dept || '', store: p.store || '', station: p.station || '', cost: p.cost, stock: p.stock, safe: p.safe, convs, recs: own.slice(-60), nRecs: own.length, lastOrder, lastConfirmed, updatedAt: p.updatedAt }
    if (split) {
      const vk = k + '~2'
      const vr = rs.filter(r => r.src === 'order' && r.p >= split.minPrice)
      const vconf = (doc.conv[vk] || []).filter(c => !c.off).map(c => ({ ...c, status: c.status || 'confirmed' }))
      supplies[vk] = { key: vk, sys: p.sys, code: p.code + '（' + (split.label || '大單位') + '）', sku: p.sku || '', name: p.name, supplier: p.supplier, spec: p.spec || '', unit: split.unit || p.unit || '', price: null, tax: p.tax || '', status: p.status, cat: p.cat || '', dept: p.dept || '', store: p.store || '', virtual: true, splitOf: k, convs: vconf, recs: vr.slice(-60), nRecs: vr.length, lastOrder: vr.slice(-1)[0] || null, lastConfirmed: null }
    }
  }
  // 卡：供應品 → cardId（沒指定＝自己一張 auto 卡）
  const cards = {}
  for (const sup of Object.values(supplies)) {
    const cid = doc.supplyCard[sup.key] || ('auto:' + sup.key)
    const c = cards[cid] || (cards[cid] = { id: cid, ...(doc.cards[cid] || {}), supplies: [] })
    c.supplies.push(sup.key)
  }
  // 卡屬性補預設＋算成本基準
  const prodBySys = {}
  const rows = []
  for (const c of Object.values(cards)) {
    const sups = c.supplies.map(k => supplies[k])
    const primaryKey = (c.primary && supplies[c.primary] && c.supplies.includes(c.primary)) ? c.primary : (sups.find(s => s.status === '啟用' && s.lastOrder) || sups.find(s => s.status === '啟用') || sups[0]).key
    const pri = supplies[primaryKey]
    c.primary = primaryKey
    c.name = c.name || pri.name
    c.displaySku = c.displaySku || pri.sku || pri.code
    c.type = c.type || guessType(pri)
    c.baseUnit = c.baseUnit || guessBaseUnit(pri, pri.convs)
    c.brands = c.brands && c.brands.length ? c.brands : [...new Set(sups.map(s => s.sys))]
    c.store = c.store || pri.store || ''
    c.station = c.station || pri.station || ''
    c.status = c.status || (sups.some(s => s.status === '啟用') ? '啟用' : '停用')
    c.aliases = sups.map(s => s.code).concat(sups.map(s => s.sku).filter(Boolean))
    // 每基準單位成本（每個供應品都算，給比價；卡的基準＝主要供應品）
    for (const s of sups) {
      const conv = s.convs.find(x => x.to === c.baseUnit && x.status === 'confirmed') || s.convs.find(x => x.to === c.baseUnit && x.status === 'metric') || s.convs.find(x => x.to === c.baseUnit)
      const basePrice = (s.lastConfirmed && s.lastConfirmed.p) || (s.lastOrder && s.lastOrder.p) || s.price
      s.baseCost = (conv && basePrice) ? r4(basePrice / conv.factor) : null
      s.convStatus = conv ? conv.status : 'none'
      s.priceSrc = s.lastConfirmed ? 'confirmed' : (s.lastOrder ? 'order' : (s.price ? 'master' : 'none'))
      s.priceDate = s.lastConfirmed ? s.lastConfirmed.d : (s.lastOrder ? s.lastOrder.d : '')
    }
    c.baseCost = pri.baseCost; c.convStatus = pri.convStatus; c.priceSrc = pri.priceSrc; c.priceDate = pri.priceDate
    c.complete = pri.baseCost != null && (pri.convStatus === 'confirmed' || pri.convStatus === 'metric') && pri.priceSrc !== 'none'
    c.gaps = [pri.priceSrc === 'none' ? '缺價' : null, pri.convStatus === 'none' ? '缺換算' : (pri.convStatus === 'suggested' || pri.convStatus === 'snapshot' ? '換算未確認' : null)].filter(Boolean)
    c.suppliers = [...new Set(sups.map(s => s.supplier).filter(Boolean))]
    c.cats = [...new Set(sups.map(s => s.cat).filter(Boolean))]
    rows.push(c)
  }
  // 被使用於：即時食譜 items（code）＋ 快照菜單行（code／sku／名稱）
  const useBy = {}
  for (const r of master.recipes) for (const it of r.items) if (it.code) (useBy['A|' + norm(it.code)] = useBy['A|' + norm(it.code)] || { recipes: new Set(), menus: new Set() }).recipes.add(r.name)
  const skuToKey = {}; for (const s of Object.values(supplies)) if (s.sku) skuToKey[norm(s.sku)] = s.key
  for (const l of snap.menuLines) { const k = skuToKey[norm(l.code)] || ('A|' + norm(l.code)); if (l.menu) (useBy[k] = useBy[k] || { recipes: new Set(), menus: new Set() }).menus.add(l.menu) }
  const rcpByName = {}; for (const r of master.recipes) rcpByName[norm(r.name)] = r
  for (const c of rows) {
    const rs = new Set(), ms = new Set()
    for (const k of c.supplies) { const u = useBy[k]; if (u) { u.recipes.forEach(x => rs.add(x)); u.menus.forEach(x => ms.add(x)) } }
    // 間接：被半成品用到 → 半成品被哪些菜單用（快照菜單行以品名對）
    for (const rn of [...rs]) for (const l of snap.menuLines) if (norm(l.name) === norm(rn) && l.menu) ms.add(l.menu + '（經 ' + rn + '）')
    c.usedRecipes = [...rs].slice(0, 30); c.usedMenus = [...ms].slice(0, 30)
  }
  rows.sort((a, b) => (a.status === '啟用' ? 0 : 1) - (b.status === '啟用' ? 0 : 1) || (b.usedMenus.length - a.usedMenus.length) || (a.name < b.name ? -1 : 1))
  const facets = { types: TYPES, baseUnits: BASE_UNITS, brands: ['A Beach', 'GROUN:D'], cats: [...new Set(rows.flatMap(c => c.cats))].sort(), stores: [...new Set(rows.map(c => c.store).filter(Boolean))].sort(), suppliers: [...new Set(rows.flatMap(c => c.suppliers))].sort() }
  return { cards: rows, supplies, facets, log: (doc.log || []).slice(-80).reverse(), live: master.live, masterUpdatedAt: master.updatedAt, snapAsOf: snap.asOf, nMerged: Object.keys(doc.supplyCard || {}).length }
}

// ── 寫：全部留紀錄；供應品主檔不改（只改歸屬／屬性／換算／報價／拆分）──
export async function applyCardOp ({ kvGet, kvPut, who, body, uploadPrivate }) {
  const doc = (await kvGet(CARD_KEY)) || { cards: {}, supplyCard: {}, conv: {}, quotes: [], splits: {}, log: [] }
  doc.cards = doc.cards || {}; doc.supplyCard = doc.supplyCard || {}; doc.conv = doc.conv || {}; doc.quotes = doc.quotes || []; doc.splits = doc.splits || {}; doc.log = doc.log || []
  const at = nowIso(), op = String(body.op || '')
  const log = o => { doc.log.push({ at, by: who.name, op, ...o }); if (doc.log.length > 800) doc.log = doc.log.slice(-800) }
  const newId = () => 'mc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  if (op === 'merge') { // 把多個供應品併進同一張卡（規格：只有同一種東西才合併；跨品牌由人確認）
    const keys = (body.supplyKeys || []).map(String).filter(Boolean); if (keys.length < 2 && !body.targetCardId) return { ok: false, error: '至少選兩個代碼' }
    let target = String(body.targetCardId || '')
    if (!target || target.startsWith('auto:')) { target = newId(); doc.cards[target] = { id: target, name: String(body.name || '').slice(0, 80) || undefined, createdAt: at, by: who.name } }
    const prev = {}
    for (const k of keys) { prev[k] = doc.supplyCard[k] || null; doc.supplyCard[k] = target }
    if (body.primary && keys.includes(body.primary)) doc.cards[target] = { ...(doc.cards[target] || { id: target }), primary: body.primary }
    log({ target, keys, prev, reason: String(body.reason || '').slice(0, 200) })
    await kvPut(CARD_KEY, doc, '物料卡合併(' + who.name + ')'); return { ok: true, cardId: target }
  }
  if (op === 'unmerge') { const k = String(body.supplyKey || ''); if (!doc.supplyCard[k]) return { ok: false, error: '這個代碼本來就沒合併' }; log({ key: k, prev: doc.supplyCard[k] }); delete doc.supplyCard[k]; await kvPut(CARD_KEY, doc, '物料卡拆出(' + who.name + ')'); return { ok: true } }
  if (op === 'edit') { // 卡屬性：name/displaySku/type/baseUnit/store/station/status/brands/primary/note
    const id = String(body.cardId || ''); if (!id) return { ok: false, error: '缺卡 ID' }
    const c = doc.cards[id] || { id, createdAt: at }
    const f = body.fields || {}, before = {}
    for (const k of ['name', 'displaySku', 'type', 'baseUnit', 'store', 'station', 'status', 'primary', 'note']) if (f[k] != null) { if (k === 'type' && !TYPES.includes(f[k])) continue; if (k === 'baseUnit' && !BASE_UNITS.includes(f[k])) continue; before[k] = c[k]; c[k] = String(f[k]).slice(0, 120) }
    if (Array.isArray(f.brands)) { before.brands = c.brands; c.brands = f.brands.filter(x => ['A Beach', 'GROUN:D'].includes(x)) }
    doc.cards[id] = c; log({ cardId: id, before, after: f })
    await kvPut(CARD_KEY, doc, '物料卡編輯(' + who.name + ')'); return { ok: true }
  }
  if (op === 'conv') { // 換算：確認建議／手動輸入／不需換算（填原因）／取消
    const k = String(body.supplyKey || ''); if (!k) return { ok: false, error: '缺供應品' }
    const arr = doc.conv[k] = doc.conv[k] || []
    if (body.mode === 'off') { const to = String(body.to || ''); const cand = arr.filter(x => !x.off && (to === 'noconv' ? x.noconv : x.to === to)); const x = cand[cand.length - 1]; if (!x) return { ok: false, error: '找不到這條換算' }; x.off = true; x.offBy = who.name; x.offAt = at; log({ key: k, mode: 'off', prev: x }) } else if (body.mode === 'noconv') {
      if (!String(body.reason || '').trim()) return { ok: false, error: '「不需換算」要填原因' }
      arr.forEach(x => { if (!x.off && x.noconv) { x.off = true } }); arr.push({ noconv: true, reason: String(body.reason).slice(0, 200), by: who.name, at, status: 'confirmed' }); log({ key: k, mode: 'noconv', reason: body.reason })
    } else {
      const to = String(body.to || '').trim(), factor = Number(body.factor)
      if (!to || !(factor > 0)) return { ok: false, error: '倍率必須是正數、目標單位必填' }
      if ((to === 'g' && String(body.from || '').toLowerCase() === 'ml') || (to === 'ml' && String(body.from || '').toLowerCase() === 'g')) { if (!String(body.reason || '').trim()) return { ok: false, error: 'g ↔ ml 要填實測密度依據（決策 #14）' } }
      arr.forEach(x => { if (!x.off && x.to === to) { x.off = true; x.offBy = who.name; x.offAt = at } }) // 同目標單位只留一條有效
      arr.push({ to, factor, by: who.name, at, status: 'confirmed', mode: body.mode === 'accept' ? '接受建議' : '手動輸入', why: String(body.why || body.reason || '').slice(0, 200) })
      log({ key: k, to, factor, mode: body.mode })
    }
    await kvPut(CARD_KEY, doc, '物料換算(' + who.name + ')'); return { ok: true }
  }
  if (op === 'quote') { // 手動價格紀錄（報價／確認價）：只新增
    const k = String(body.supplyKey || ''), price = Number(body.price), date = String(body.date || '').slice(0, 10)
    if (!k || !(price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '供應品、價格（>0）、日期都要填' }
    doc.quotes.push({ supplyKey: k, price, date, src: body.src === 'confirmed' ? 'confirmed' : 'quote', by: who.name, at, note: String(body.note || '').slice(0, 200) })
    log({ key: k, price, date, src: body.src }); await kvPut(CARD_KEY, doc, '物料報價(' + who.name + ')'); return { ok: true }
  }
  if (op === 'split') { // 一碼多單位：價格 ≥ minPrice 的叫貨行視為另一個（大）單位的供應品
    const k = String(body.supplyKey || ''), minPrice = Number(body.minPrice)
    if (!k || !(minPrice > 0)) return { ok: false, error: '要填分界價格' }
    doc.splits[k] = { minPrice, label: String(body.label || '箱').slice(0, 20), unit: String(body.unit || '').slice(0, 10), by: who.name, at }
    log({ key: k, minPrice, label: body.label }); await kvPut(CARD_KEY, doc, '物料拆料號(' + who.name + ')'); return { ok: true }
  }
  if (op === 'unsplit') { const k = String(body.supplyKey || ''); if (!doc.splits[k]) return { ok: false, error: '沒有拆分' }; log({ key: k, prev: doc.splits[k] }); delete doc.splits[k]; delete doc.supplyCard[k + '~2']; await kvPut(CARD_KEY, doc, '物料取消拆分(' + who.name + ')'); return { ok: true } }
  if (op === 'photo') { // 卡照片（包材照片牆；私有桶）
    const id = String(body.cardId || ''); if (!id) return { ok: false, error: '缺卡 ID' }
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(body.dataUrl || '')); if (!m) return { ok: false, error: '只能上傳圖片' }
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 6 * 1024 * 1024) return { ok: false, error: '圖片太大（上限 6MB，前端會壓縮）' }
    const path = `matcard/${id.replace(/[^a-z0-9_:|~-]/gi, '_')}/${Date.now().toString(36)}.jpg`
    if (!(await uploadPrivate(path, buf, m[1]))) return { ok: false, error: '上傳失敗' }
    const c = doc.cards[id] || { id, createdAt: at }; const before = c.photo; c.photo = path; doc.cards[id] = c
    log({ cardId: id, photo: path, before }); await kvPut(CARD_KEY, doc, '物料卡照片(' + who.name + ')'); return { ok: true, photo: path }
  }
  return { ok: false, error: '不認得的操作' }
}
