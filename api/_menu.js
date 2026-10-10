// ── 產品與成本模組｜批次 5「菜單與定價」＋批次 4「GROUN:D 五款代表餐點」後端（v4.70.35，2026-10-10）──
// 規格 §5：列表（品名／品類／規格／通路／售價／食材成本／包材成本／成本率／毛利率／完整狀態／在賣停售）；
//   規格分開（4oz/8oz、M/L 各自售價與用量，不可整份加倍）；包材依內用／外帶／外送各一組（從物料卡挑類型「包材」，帶照片與數量，成本連動包材供應品價）；
//   套餐（主餐＋可選附餐＋可選飲料＋額外包材與加價，列每種合法組合成本與最低／最高，同一份包材不重複計入，加價是設定值）；
//   試算在前端（不寫正式資料），「建立新版本」才進發布（價格版本只新增）；成本歷史＝連結食譜的成本快照。
// 菜單來源：A Beach＝/costs/menu 即時（售價、在賣、品類）＋出餐食譜（快照行）成本；GROUN:D＝/prep 菜單（sp_finance_pm_menu.draft，2026-09 紙本種子＋編輯）＋自建食譜。
import { norm, num } from './_cost.js'
import { buildCards } from './_matcard.js'
import { buildRecipes } from './_recipe.js'

export const PRICING_KEY = 'sp_finance_pm_pricing'
const CH = ['dinein', 'takeout', 'delivery']
const CH_LABEL = { dinein: '內用', takeout: '外帶', delivery: '外送' }
const r2 = n => Math.round(n * 100) / 100, r4 = n => Math.round(n * 1e4) / 1e4
const nowIso = () => new Date().toISOString()
const slug = s => String(s || '').replace(/\s+/g, '').slice(0, 60)

export async function buildPricing ({ kvGet, months }) {
  const [rc, cards, menuA, menuG, doc0, cfgD] = await Promise.all([buildRecipes({ kvGet, months, light: true }), buildCards({ kvGet, months }), kvGet('sp_finance_pm_boss_menu'), kvGet('sp_finance_pm_menu'), kvGet(PRICING_KEY), kvGet('sp_finance_pm_cost_cfg')])
  const doc = doc0 || { items: {}, log: [], versions: [] }
  const ratioCap = ((cfgD || {}).ratioCap) || {} // 成本率上限：批次 5a 總覽頁設（同一份 KV，不另存）
  const recipeBy = {}; for (const r of [...rc.recipes, ...rc.dishes]) recipeBy[r.key] = r
  const dishByName = {}; for (const r of rc.dishes) dishByName[norm(r.name)] = r
  // 包材卡（物料卡 type=包材）：每個＝多少錢（每「個」；沒有換到個就用叫貨單位價）
  const packCards = cards.cards.filter(c => c.type === '包材' && c.status === '啟用').map(c => { const s = cards.supplies[c.primary] || {}; const per = c.baseUnit === '個' && c.baseCost != null ? c.baseCost : (s.lastOrder ? s.lastOrder.p : (num(s.price) || null)); return { id: c.id, name: c.name, sku: c.displaySku, photo: c.photo || '', brand: (c.brands || []).join('＋'), supplier: s.supplier || '', unitLabel: c.baseUnit === '個' && c.baseCost != null ? '個' : (s.unit || '單位'), per, complete: c.complete, convNote: c.baseUnit === '個' && c.baseCost != null ? '' : '尚未換算成「個」，先用叫貨單位價' } })
  const packBy = {}; for (const p of packCards) packBy[p.id] = p
  const packCost = arr => { let sum = 0, ok = true, lines = []; for (const x of (arr || [])) { const p = packBy[x.cardId]; if (!p || p.per == null) { ok = false; lines.push({ cardId: x.cardId, name: (p || {}).name || x.cardId, qty: x.qty, cost: null }); continue } const c = r2(p.per * (Number(x.qty) || 0)); sum += c; lines.push({ cardId: x.cardId, name: p.name, qty: x.qty, per: p.per, cost: c, photo: p.photo, convNote: p.convNote }) } return { cost: r2(sum), ok, lines } }
  // 菜單品項（兩品牌）
  const items = []
  const mA = Object.values((menuA || {}).rows || {})
  for (const m of mA) {
    const key = 'A|' + slug(m.name)
    const ov = doc.items[key] || {}
    const linked = ov.recipeKey ? recipeBy[ov.recipeKey] : dishByName[norm(m.name)]
    items.push(buildItem({ key, brand: 'A Beach', name: m.name, category: m.category || '', active: m.is_active !== false, basePrice: num(m.price), abCost: num(m.cost), abComplete: !!m.cost_complete, ov, linked, packCost, ratioCap, recipeBy }))
  }
  const secs = (((menuG || {}).draft || (menuG || {}).base || {}).sections) || []
  for (const sct of secs) for (const it of (sct.items || [])) {
    const key = 'G|' + (it.id || slug(it.name))
    const ov = doc.items[key] || {}
    const linked = ov.recipeKey ? recipeBy[ov.recipeKey] : null
    items.push(buildItem({ key, brand: 'GROUN:D', name: it.name, category: sct.name || '', active: !it.hidden, basePrice: num(it.price), note: it.note || '', abCost: null, abComplete: null, ov, linked, packCost, ratioCap, recipeBy }))
  }
  // 自建但菜單還沒有的 GD 餐點（批次 4 的五款）也列出
  for (const r of rc.dishes) if (r.src === 'own' && !items.some(x => x.recipeKey === r.key)) { const key = 'G|own:' + r.key; const ov = doc.items[key] || { recipeKey: r.key }; items.push(buildItem({ key, brand: 'GROUN:D', name: r.name, category: r.category || '代表餐點', active: true, basePrice: null, ov: { ...ov, recipeKey: r.key }, linked: r, packCost, ratioCap, recipeBy })) }
  const cats = { 'A Beach': [...new Set(items.filter(i => i.brand === 'A Beach').map(i => i.category).filter(Boolean))], 'GROUN:D': [...new Set(items.filter(i => i.brand === 'GROUN:D').map(i => i.category).filter(Boolean))] }
  const recipesPick = [...rc.dishes, ...rc.recipes].map(r => ({ key: r.key, name: r.name, type: r.type, brand: r.brand || 'A Beach', ok: r.ok, cost: r.cost, yieldQty: r.yieldQty, yieldUnit: r.yieldUnit }))
  return { items, cats, packCards, recipesPick, ratioCap, versions: (doc.versions || []).slice(-100).reverse(), log: (doc.log || []).slice(-60).reverse(), masterUpdatedAt: rc.masterUpdatedAt }
}

function buildItem ({ key, brand, name, category, active, basePrice, note, abCost, abComplete, ov, linked, packCost, ratioCap, recipeBy }) {
  // 規格：沒設就是「單一規格」，售價＝菜單價、三通路同價、用量倍率 1
  const specs = (ov.specs && ov.specs.length ? ov.specs : [{ id: 'std', name: '單一規格', mult: 1, prices: {} }]).map(sp => {
    const prices = {}; for (const ch of CH) prices[ch] = sp.prices && sp.prices[ch] != null ? Number(sp.prices[ch]) : basePrice
    const food = linked && linked.cost != null ? r2(linked.cost * (Number(sp.mult) || 1)) : null
    const foodOk = !!(linked && linked.ok)
    const pack = {}; for (const ch of CH) pack[ch] = packCost((sp.pack || ov.pack || {})[ch])
    const channels = {}
    for (const ch of CH) {
      const price = prices[ch], pc = pack[ch].cost
      const complete = foodOk && pack[ch].ok && price > 0
      channels[ch] = { price, food, pack: pc, packOk: pack[ch].ok, complete,
        costRatio: (foodOk && price > 0) ? r4(food / price) : null, // 食材成本率＝食材 ÷ 同稅別售價
        margin: complete ? r4((price - food - pc) / price) : null, // 含包材毛利率
        known: r2((food || 0) + (pc || 0)) }
    }
    return { id: sp.id, name: sp.name, mult: Number(sp.mult) || 1, prices, pack, channels, food, foodOk }
  })
  const main = specs[0], mc = main.channels.dinein
  const cap = ratioCap[category] != null ? Number(ratioCap[category]) : null
  const over = cap != null && mc.costRatio != null ? mc.costRatio * 100 > cap : null
  // 套餐：主餐（這個品項）＋附餐池＋飲料池＋額外包材＋加價 → 每種組合成本
  let combo = null
  if (ov.combo && ((ov.combo.sides || []).length || (ov.combo.drinks || []).length)) {
    const pick = arr => (arr || []).map(k => recipeBy[k]).filter(Boolean)
    const sides = pick(ov.combo.sides), drinks = pick(ov.combo.drinks)
    const extra = packCost(ov.combo.extraPack)
    const up = Number(ov.combo.upcharge) || 0
    const combos = []
    const S = sides.length ? sides : [null], D = drinks.length ? drinks : [null]
    for (const s of S) for (const d of D) {
      const parts = [linked, s, d].filter(Boolean)
      const ok = parts.every(p => p && p.ok) && extra.ok
      const food = r2(parts.reduce((a, p) => a + (p && p.cost != null ? p.cost : 0), 0))
      const price = (mc.price || 0) + up
      combos.push({ side: s ? s.name : '—', drink: d ? d.name : '—', food, pack: r2((mc.pack || 0) + extra.cost), price, ok, margin: ok && price > 0 ? r4((price - food - mc.pack - extra.cost) / price) : null })
    }
    const okc = combos.filter(c => c.ok)
    combo = { upcharge: up, extraPack: extra, combos: combos.slice(0, 60), n: combos.length, nOk: okc.length, min: okc.length ? Math.min(...okc.map(c => c.food + c.pack)) : null, max: okc.length ? Math.max(...okc.map(c => c.food + c.pack)) : null }
  }
  return { key, brand, name, category, active, note: note || '', basePrice, abCost, abComplete, recipeKey: linked ? linked.key : (ov.recipeKey || ''), recipeName: linked ? linked.name : '', recipeOk: !!(linked && linked.ok), recipeStatus: linked ? linked.status : '未連結食譜', recipeGaps: linked ? (linked.gaps || []).slice(0, 4) : [], recipePending: !!(linked && linked.pendingContent), specs, main: mc, cap, over, combo, hasOverlay: !!(ov.specs || ov.pack || ov.combo || ov.recipeKey), updatedAt: ov.at || '' }
}

export async function applyPricingOp ({ kvGet, kvPut, who, body }) {
  const doc = (await kvGet(PRICING_KEY)) || { items: {}, log: [], versions: [] }
  doc.items = doc.items || {}; doc.log = doc.log || []; doc.versions = doc.versions || []
  const key = String(body.key || ''); if (!key) return { ok: false, error: '缺品項 key' }
  const it = doc.items[key] = doc.items[key] || {}
  const at = nowIso(), op = String(body.op || '')
  const log = o => { doc.log.push({ at, by: who.name, op, key, ...o }); if (doc.log.length > 800) doc.log = doc.log.slice(-800) }
  const cleanPack = p => { const out = {}; for (const ch of CH) out[ch] = (Array.isArray((p || {})[ch]) ? p[ch] : []).slice(0, 12).map(x => ({ cardId: String(x.cardId || '').slice(0, 80), qty: Math.max(0, Number(x.qty) || 0) })).filter(x => x.cardId && x.qty > 0); return out }
  if (op === 'link') { const before = it.recipeKey; it.recipeKey = String(body.recipeKey || '').slice(0, 80); it.at = at; log({ before, after: it.recipeKey }) } else if (op === 'specs') { // 規格：各自售價（三通路）與用量倍率；改售價＝新增一筆版本紀錄（只新增）
    const specs = (Array.isArray(body.specs) ? body.specs : []).slice(0, 8).map((s, i) => ({ id: String(s.id || ('s' + (i + 1))).slice(0, 20), name: String(s.name || '規格' + (i + 1)).slice(0, 30), mult: Math.max(0.01, Number(s.mult) || 1), prices: Object.fromEntries(CH.map(ch => [ch, s.prices && s.prices[ch] !== '' && s.prices[ch] != null ? Number(s.prices[ch]) : null])), pack: s.pack ? cleanPack(s.pack) : undefined }))
    if (!specs.length) return { ok: false, error: '至少一個規格' }
    const before = it.specs || null
    it.specs = specs; it.at = at
    doc.versions.push({ at, by: who.name, key, specs: specs.map(s => ({ id: s.id, name: s.name, prices: s.prices, mult: s.mult })), reason: String(body.reason || '').slice(0, 200) })
    if (doc.versions.length > 1000) doc.versions = doc.versions.slice(-1000)
    log({ before: before ? before.map(s => s.prices) : null, after: specs.map(s => s.prices), reason: body.reason })
  } else if (op === 'pack') { const before = it.pack; it.pack = cleanPack(body.pack); it.at = at; log({ before, after: it.pack }) } else if (op === 'combo') {
    const before = it.combo
    it.combo = { sides: (Array.isArray(body.sides) ? body.sides : []).slice(0, 12).map(String), drinks: (Array.isArray(body.drinks) ? body.drinks : []).slice(0, 12).map(String), extraPack: (Array.isArray(body.extraPack) ? body.extraPack : []).slice(0, 8).map(x => ({ cardId: String(x.cardId || ''), qty: Number(x.qty) || 0 })).filter(x => x.cardId && x.qty > 0), upcharge: Number(body.upcharge) || 0 }
    it.at = at; log({ before, after: it.combo })
  } else if (op === 'clear') { delete doc.items[key]; log({}) } else return { ok: false, error: '不認得的操作' }
  await kvPut(PRICING_KEY, doc, '菜單定價(' + who.name + ')')
  return { ok: true }
}

// ── 批次 4：GROUN:D 五款代表餐點（漢堡／披薩／碗／義麵／飲料）骨架：從 /prep 菜單挑真實品項建「自建餐點」草稿（材料空白＝待補，不生成假配方）＋ 連到菜單品項 ──
export async function seedGdFive ({ kvGet, kvPut, who, applyRecipeOp, months }) {
  const menuG = await kvGet('sp_finance_pm_menu')
  const secs = (((menuG || {}).draft || (menuG || {}).base || {}).sections) || []
  const flat = []; for (const s of secs) for (const it of (s.items || [])) flat.push({ ...it, sec: s.name })
  const pick = (re) => flat.find(x => re.test(x.name + ' ' + x.sec))
  const five = [['burger', '漢堡', pick(/漢堡|堡/)], ['pizza', '披薩', pick(/披薩|瑪格麗特|PIZZA/i)], ['bowl', '碗', pick(/碗|沙拉杯|丼|飯/)], ['pasta', '義麵', pick(/義大利麵|義麵|PASTA/i)], ['drink', '飲料', pick(/咖啡|拿鐵|紅茶|烏龍|國寶/)]]
  const out = []
  for (const [k, label, m] of five) {
    const key = 'gd:' + k
    if (!m) { out.push({ k, label, skipped: '菜單找不到對應品項' }); continue }
    const r = await applyRecipeOp({ kvGet, kvPut, who, body: { op: 'create', key, name: m.name, brand: 'GROUN:D', type: 'dish', station: label, code: 'GD-' + k.toUpperCase(), yieldQty: 1, yieldUnit: '份', note: '批次 4 代表餐點骨架：材料請依已確認配方與實測產量填入（不生成假食譜）' }, uploadPrivate: null, months })
    const doc = (await kvGet(PRICING_KEY)) || { items: {}, log: [], versions: [] }
    doc.items = doc.items || {}
    const pk = 'G|' + (m.id || slug(m.name))
    doc.items[pk] = { ...(doc.items[pk] || {}), recipeKey: key, at: nowIso() }
    doc.log = doc.log || []; doc.log.push({ at: nowIso(), by: who.name, op: 'seed', key: pk, recipeKey: key })
    await kvPut(PRICING_KEY, doc, 'GD 五款代表餐點骨架')
    out.push({ k, label, menuItem: m.name, price: m.price, recipeKey: key, created: r.ok, err: r.error })
  }
  return { ok: true, five: out }
}
