// ── 產品與成本模組｜批次 1b「耗損紀錄 v1（AI 拍照）」後端（v4.70.32，2026-10-10）──
// 規格：docs/COST_MODULE_SPEC.md「耗損紀錄(AI 拍照)」。三原則：
//   ① 耗損不扣庫存（只解釋盤差，實際庫存以盤點為準）② 升級既有功能：備料板「耗損」按鈕（prepact loss）舊紀錄一併顯示在新頁
//   ③ AI 只預填、人確認才入帳：AI 原始輸出與人最後值都存，不同＝修正（學習資料）
// 資料：
//   sp_finance_pm_waste_YYYYMM = { rows:{ id: 紀錄 } }  只新增；更正＝另寫一筆沖銷（voidOf）
//   sp_finance_pm_waste_cfg    = { containers[], reasons[], bigAmt, est:{minPairs,maxErr}, refs:{code:[{path,ts,id}]}, hit:{code:{n,hit}}, pairs:{code:[{estG,realG,ts}]} }
//   照片進私有桶 ground-private/waste/…（看檔＝短效簽名網址）
// 不 import mail-sync（避免循環）；kvGet/kvPut 由呼叫端傳入。AI 一律走 _ai.js 中樞（route 'waste'）。
import { aiCall } from './_ai.js'
import { SB_URL, BUCKET, svc, uploadPrivate, signedUrl } from './_onboard.js'

export const WASTE_CFG_KEY = 'sp_finance_pm_waste_cfg'
export const REASONS = ['過期', '製作失誤', '掉落污染', '品質不良', '客退', '試菜', '其他'] // 員工餐另列、不算耗損
export const COUNT_UNITS = ['顆', '片', '塊', '支', '個', '份', '條', '粒', '隻', '張', '杯', '瓶', '罐', '包']
const DEFAULT_CFG = { containers: [], reasons: REASONS, bigAmt: 500, est: { minPairs: 30, maxErr: 15 }, refs: {}, hit: {}, pairs: {} }

const num = v => (v == null || v === '' ? null : (isNaN(Number(v)) ? null : Number(v)))
const r1 = n => Math.round(n * 10) / 10
const norm = s => String(s || '').replace(/\s+/g, '').trim()
const tpeNow = () => new Date(Date.now() + 8 * 3600e3)
const ymOf = d => d.toISOString().slice(0, 7)
const monthKey = ym => 'sp_finance_pm_waste_' + ym.replace('-', '')
const monthsBack = (n) => { const out = []; const d = tpeNow(); d.setUTCDate(1); for (let i = 0; i < n; i++) { out.push(ymOf(d)); d.setUTCMonth(d.getUTCMonth() - 1) } return out }

export async function cfgGet (kvGet) { const c = (await kvGet(WASTE_CFG_KEY)) || {}; return { ...DEFAULT_CFG, ...c, est: { ...DEFAULT_CFG.est, ...(c.est || {}) }, containers: c.containers || [], reasons: (c.reasons && c.reasons.length) ? c.reasons : REASONS, refs: c.refs || {}, hit: c.hit || {}, pairs: c.pairs || {} } }

// ── 規格文字 → 總 g／ml（「250g*30個」「1kg」「1000 ml/壺」「5K*4包」）──
export function specG (s) {
  const t = String(s || '').replace(/，/g, ',').replace(/×/g, '*').replace(/[xX]\s*(\d)/g, '*$1')
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|k|g|l|ml|公斤|公克|毫升|公升|克)(?![a-z])/i); if (!m) return null
  const v = Number(m[1]); const u = m[2].toLowerCase()
  const mult = (t.slice(m.index + m[0].length).match(/^\s*\*\s*(\d+(?:\.\d+)?)/) || [])[1]
  const f = mult ? Number(mult) : 1
  const g = (u === 'kg' || u === 'k' || u === '公斤') ? v * 1000 * f : (u === 'g' || u === '公克' || u === '克') ? v * f : null
  const ml = (u === 'l' || u === '公升') ? v * 1000 * f : (u === 'ml' || u === '毫升') ? v * f : null
  return { g, ml, total: g != null ? g : ml, kind: g != null ? 'g' : 'ml' }
}
// 物料「每 g 成本」＋依據（算不出→null，畫面標「待物料卡」）
export function perGram (p) {
  if (!p) return { perG: null, basis: '找不到物料' }
  const cost = num(p.cost) > 0 ? num(p.cost) : (num(p.price) > 0 ? num(p.price) : null)
  if (!cost) return { perG: null, basis: '物料沒有成本／單價' }
  const u = String(p.unit || '')
  if (/^(kg|公斤)$/i.test(u)) return { perG: cost / 1000, basis: `${cost} 元/${u} ÷ 1000` }
  if (/^(g|公克|克)$/i.test(u)) return { perG: cost, basis: `${cost} 元/${u}` }
  if (/^(l|公升)$/i.test(u)) return { perG: cost / 1000, basis: `${cost} 元/${u} ÷ 1000（以 ml 當 g）` }
  if (/^(ml|毫升)$/i.test(u)) return { perG: cost, basis: `${cost} 元/${u}（以 ml 當 g）` }
  const sg = specG(p.spec) || specG(p.name) // 規格欄沒寫量（例「未稅」）就從品名找「250g*30個」
  if (sg && sg.total > 0) return { perG: cost / sg.total, basis: `${cost} 元/${u} ÷ 規格 ${sg.total}${sg.kind}` }
  return { perG: null, basis: `單位「${u}」沒有換算（待物料卡）`, perUnit: cost }
}

// ── 候選物料（boss-api 即時主檔：GD gprod／AB prod）──
export async function loadProducts (kvGet) {
  const [g, a] = await Promise.all([kvGet('sp_finance_pm_boss_gprod'), kvGet('sp_finance_pm_boss_prod')])
  const slim = (rows, sys) => Object.values((rows || {}).rows || {}).filter(p => p && p.is_active !== false && p.name).map(p => ({ sys, code: String(p.code || p.sku || ''), sku: p.sku || '', name: p.name, unit: p.unit || '', spec: p.spec || '', category: p.category || '', supplier: p.supplier || '', store: p.store || '', station: p.station || '', dept: p.dept || '', stock: num(p.stock), cost: num(p.cost), price: num(p.price) }))
  return { ground: slim(g, 'GROUN:D'), abeach: slim(a, 'A Beach'), updatedAt: (g || {}).updatedAt || null }
}

// ── 讀紀錄（本模組＋舊備料板耗損）──
export async function loadRows ({ kvGet, months }) {
  const ms = months || monthsBack(3)
  const [docs, acts] = await Promise.all([Promise.all(ms.map(m => kvGet(monthKey(m)))), Promise.all(ms.map(m => kvGet('sp_finance_pm_prep_act_' + m)))])
  const rows = []
  docs.forEach(d => { for (const r of Object.values((d || {}).rows || {})) rows.push(r) })
  acts.forEach((d, i) => { // 舊備料板「耗損」：days[日期][品項].loss[{q,r,by,ts}]（份數，無金額）
    for (const [date, items] of Object.entries((d || {}).days || {})) for (const [item, v] of Object.entries(items || {})) for (const l of (v.loss || [])) {
      rows.push({ id: 'board|' + date + '|' + item + '|' + l.ts, ts: l.ts, date, by: l.by, store: 'ground', station: '', code: '', name: item, qty: l.q, qtyUnit: '份', netG: null, reason: l.r || '', amount: null, src: 'board', costNote: '舊備料板紀錄（份數）' })
    }
  })
  rows.sort((a, b) => (a.ts < b.ts ? 1 : -1))
  return rows
}

// ── 讀私有桶（參考照給 AI 用）──
async function downloadB64 (path) {
  try { const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: svc }); if (!r.ok) return null; const buf = Buffer.from(await r.arrayBuffer()); return { media_type: r.headers.get('content-type') || 'image/jpeg', data: buf.toString('base64') } } catch (_) { return null }
}
const parseJson = (txt) => { const m = String(txt || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]) } catch (_) { return null } }
const toG = (v, u) => { const n = num(v); if (n == null) return null; const x = String(u || 'g').toLowerCase(); return x === 'kg' ? n * 1000 : x === 'oz' ? n * 28.3495 : x === 'lb' ? n * 453.592 : n }

// ── AI 讀秤＋物料建議（照片先上傳私有桶，再交中樞）──
// body: { photos:[{type:'scale'|'wide', dataUrl}], store:'ground'|'abeach', station, candCodes:[] }
export async function aiRead ({ kvGet, kvPut, who, body }) {
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 2) : []
  const scale = photos.find(p => p.type === 'scale'), wide = photos.find(p => p.type === 'wide')
  if (!scale && !wide) return { ok: false, error: '至少要一張照片（秤面特寫）' }
  const draftId = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const saved = []
  for (const p of photos) {
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(p.dataUrl || '')); if (!m) continue
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 4 * 1024 * 1024) return { ok: false, error: '照片太大（前端應已壓縮到長邊 1024）' }
    const path = `waste/${tpeNow().toISOString().slice(0, 7)}/${draftId}-${p.type}.jpg`
    if (!(await uploadPrivate(path, buf, m[1]))) return { ok: false, error: '照片上傳失敗' }
    saved.push({ type: p.type, path, media_type: m[1], data: m[2] })
  }
  // 候選清單：前端給（該站／有庫存／搜尋）上限 30；每個候選附最多 1 張自家參考照、總共 ≤10 張
  const cfg = await cfgGet(kvGet)
  const prods = await loadProducts(kvGet)
  const pool = body.store === 'abeach' ? prods.abeach : prods.ground
  const codes = Array.isArray(body.candCodes) ? body.candCodes.map(String).slice(0, 30) : []
  const cands = (codes.length ? codes.map(c => pool.find(p => p.code === c)).filter(Boolean) : pool.filter(p => (p.stock || 0) > 0).slice(0, 30))
  const refs = []
  for (const c of cands) { if (refs.length >= 10) break; const r = (cfg.refs[c.code] || [])[0]; if (r) { const im = await downloadB64(r.path); if (im) refs.push({ code: c.code, name: c.name, im }) } }
  const { ai, aiRaw, aiErr, model, est } = await askAi({ saved, cands, refs, station: body.station })
  const sc = (ai && ai.scale) || {}
  const flags = Array.isArray(sc.flags) ? sc.flags.map(String) : []
  const conf = num(sc.confidence) || 0
  const readG = toG(sc.value, sc.unit)
  const usable = readG != null && readG > 0 && conf >= 0.6 && !flags.some(f => /negative|tare|unclear|no_scale/.test(f))
  const candOut = (Array.isArray(ai && ai.candidates) ? ai.candidates : []).map(c => { const p = pool.find(x => x.code === String(c.code)); return p ? { code: p.code, name: p.name, unit: p.unit, conf: num(c.confidence) || 0 } : null }).filter(Boolean).slice(0, 3)
  // 合理性：該物料歷史單筆中位數 × 10
  const rows = await loadRows({ kvGet })
  const medOf = code => { const xs = rows.filter(r => r.code === code && r.netG > 0 && !r.voidOf).map(r => r.netG).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null }
  const top = candOut[0]; const med = top ? medOf(top.code) : null
  const draft = { draftId, photos: saved.map(s => ({ type: s.type, path: s.path })), ai: { readG: readG != null ? r1(readG) : null, readUnit: sc.unit || null, conf, flags, usable, cands: candOut, notes: String((ai && ai.notes) || '').slice(0, 60), raw: aiRaw.slice(0, 800), err: aiErr, model, est }, sanity: (med && readG && readG > med * 10) ? { median: med, msg: `確定是 ${r1(readG)} g 嗎？這個物料過去單筆中位數只有 ${r1(med)} g` } : null }
  return { ok: true, ...draft }
}


// ── 只負責問 AI（可單獨測；saved=[{type,media_type,data}]、cands=[{code,name,unit,category}]、refs=[{code,name,im:{media_type,data}}]）──
export async function askAi ({ saved, cands, refs, station, override }) {
  const sys = `你是餐廳廚房的耗損記錄助理。任務：(1) 讀出照片中「電子秤顯示的數字與單位」；(2) 從候選清單判斷秤上／照片裡的物料是哪一個。
規則：只能從候選清單選物料（回 code）；看不清、數字閃爍、顯示負數或 TARE/歸零字樣、沒有秤，都要在 flags 標出並把 confidence 壓低；不要猜沒有的數字。
只輸出 JSON，不要任何說明：{"scale":{"value":數字或null,"unit":"g|kg|oz|lb|null","confidence":0到1,"flags":["negative"|"tare"|"unclear"|"no_scale"]},"candidates":[{"code":"候選code","name":"名稱","confidence":0到1}],"notes":"20字內備註"}`
  const content = []
  content.push({ type: 'text', text: `候選清單（code｜名稱｜單位｜分類）：\n${cands.map(c => `${c.code}｜${c.name}｜${c.unit}｜${c.category}`).join('\n') || '（無候選）'}\n站別：${station || '未指定'}` })
  for (const r of refs) { content.push({ type: 'text', text: `參考照（已確認是 ${r.code} ${r.name}）：` }); content.push({ type: 'image', media_type: r.im.media_type, data: r.im.data }) }
  { const s = saved.find(x => x.type === 'scale'); if (s) { content.push({ type: 'text', text: '【第 1 張：秤面特寫】' }); content.push({ type: 'image', media_type: s.media_type, data: s.data }) } }
  { const w = saved.find(x => x.type === 'wide'); if (w) { content.push({ type: 'text', text: '【第 2 張：物料全景】' }); content.push({ type: 'image', media_type: w.media_type, data: w.data }) } }
  let ai = null, aiRaw = '', aiErr = null, model = ''
  try { const r = await aiCall('waste', { override, noFallback: !!override, system: sys, messages: [{ role: 'user', content }], maxTokens: 600 }); aiRaw = r.text || ''; model = (r.provider || '') + '/' + (r.model || ''); ai = parseJson(aiRaw) } catch (e) { aiErr = String(e.message || e).slice(0, 200) }
  // 第三階段資料累積：只看全景照盲估重量（只存不顯示，之後配對秤讀數）
  let est = null
  const w2 = saved.find(x => x.type === 'wide')
  if (w2) { try { const r2 = await aiCall('waste', { override, noFallback: !!override, system: '你只看這一張照片估計其中「要被丟棄的物料」淨重，單位公克。只輸出 JSON：{"est_g":數字或null,"confidence":0到1}', messages: [{ role: 'user', content: [{ type: 'image', media_type: w2.media_type, data: w2.data }] }], maxTokens: 80 }); const j = parseJson(r2.text); if (j) est = { estG: num(j.est_g), conf: num(j.confidence) } } catch (_) {} }
  return { ai, aiRaw, aiErr, model, est }
}

// ── 入帳（人確認）──
// body: { draftId?, photos?, ai?, store, station, code, name, grossG, tareG, container, netG, qty, qtyUnit, reason, note, staffMeal, src:'photo'|'manual' }
export async function addWaste ({ kvGet, kvPut, who, body }) {
  const reason = String(body.reason || '').trim()
  const cfg = await cfgGet(kvGet)
  const staffMeal = !!body.staffMeal
  if (!staffMeal && !cfg.reasons.includes(reason)) return { ok: false, error: '請選原因' }
  if (reason === '其他' && !String(body.note || '').trim()) return { ok: false, error: '原因「其他」要填說明' }
  const netG = num(body.netG), qty = num(body.qty)
  if (!(netG > 0) && !(qty > 0)) return { ok: false, error: '淨重或數量要大於 0' }
  const prods = await loadProducts(kvGet)
  const pool = body.store === 'abeach' ? prods.abeach : prods.ground
  const p = pool.find(x => x.code === String(body.code || '')) || null
  const name = p ? p.name : String(body.name || '').trim()
  if (!name) return { ok: false, error: '要選物料' }
  // 金額快照（之後變價不改舊紀錄）
  let amount = null, costNote = ''
  const pg = perGram(p)
  if (netG > 0 && pg.perG != null) { amount = Math.round(netG * pg.perG * 100) / 100; costNote = pg.basis }
  else if (qty > 0 && p && pg.perUnit != null && norm(body.qtyUnit) === norm(p.unit)) { amount = Math.round(qty * pg.perUnit * 100) / 100; costNote = `${pg.perUnit} 元/${p.unit} × ${qty}` }
  else costNote = p ? (pg.basis || '待物料卡') : '不在物料主檔（待物料卡）'
  const ai = body.ai || null
  const corrected = !!(ai && ((ai.readG != null && netG != null && Math.abs(ai.readG - (num(body.grossG) || netG)) > 0.5) || (ai.cands && ai.cands[0] && p && ai.cands[0].code !== p.code)))
  const now = new Date(), ts = now.toISOString(), date = tpeNow().toISOString().slice(0, 10)
  const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const rec = {
    id, ts, date, by: who.name, store: body.store === 'abeach' ? 'abeach' : 'ground', station: String(body.station || '').slice(0, 20),
    code: p ? p.code : '', name, unit: p ? p.unit : '', netG: netG > 0 ? r1(netG) : null, qty: qty > 0 ? qty : null, qtyUnit: qty > 0 ? String(body.qtyUnit || (p && p.unit) || '個').slice(0, 6) : null,
    grossG: num(body.grossG), tareG: num(body.tareG) || 0, container: String(body.container || '').slice(0, 30),
    reason: staffMeal ? '員工餐' : reason, note: String(body.note || '').slice(0, 200), staffMeal,
    amount, costNote, perG: pg.perG != null ? Math.round(pg.perG * 10000) / 10000 : null,
    src: ai ? 'photo' : 'manual', photos: Array.isArray(body.photos) ? body.photos.slice(0, 2) : [], ai, corrected,
    bigFlag: amount != null && amount >= (num(cfg.bigAmt) || 500), // 大額耗損 → 待處理中心讀這個旗標
  }
  const ym = date.slice(0, 7)
  const doc = (await kvGet(monthKey(ym))) || { rows: {} }
  doc.rows[id] = rec; doc.updatedAt = ts
  await kvPut(monthKey(ym), doc, '耗損入帳(' + who.name + ')')
  // 學習資料：確認照進辨識圖庫、命中率、盲估配對
  if (p) {
    const wideP = rec.photos.find(x => x.type === 'wide') || rec.photos.find(x => x.type === 'scale')
    if (wideP) { cfg.refs[p.code] = [{ path: wideP.path, ts, id }, ...(cfg.refs[p.code] || [])].slice(0, 5) }
    if (ai && ai.cands && ai.cands.length) { const h = cfg.hit[p.code] || { n: 0, hit: 0 }; h.n++; if (ai.cands[0].code === p.code) h.hit++; cfg.hit[p.code] = h }
    if (ai && ai.est && ai.est.estG > 0 && rec.netG > 0) { cfg.pairs[p.code] = [...(cfg.pairs[p.code] || []), { estG: ai.est.estG, realG: rec.netG, ts }].slice(-200) }
    await kvPut(WASTE_CFG_KEY, cfg, '耗損學習資料')
  }
  return { ok: true, rec }
}

export async function voidWaste ({ kvGet, kvPut, who, body }) {
  const id = String(body.id || ''); const ym = String(body.ym || '')
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: '缺月份' }
  const doc = (await kvGet(monthKey(ym))) || { rows: {} }
  const src = doc.rows[id]; if (!src) return { ok: false, error: '找不到這筆' }
  if (src.voidOf || Object.values(doc.rows).some(r => r.voidOf === id)) return { ok: false, error: '這筆已沖銷過' }
  const vid = id + 'v'
  doc.rows[vid] = { ...src, id: vid, ts: new Date().toISOString(), by: who.name, voidOf: id, netG: src.netG != null ? -src.netG : null, qty: src.qty != null ? -src.qty : null, amount: src.amount != null ? -src.amount : null, note: '沖銷：' + String(body.note || '').slice(0, 120), bigFlag: false, photos: [] }
  await kvPut(monthKey(ym), doc, '耗損沖銷(' + who.name + ')')
  return { ok: true }
}

export async function cfgSave ({ kvGet, kvPut, who, body }) {
  const cfg = await cfgGet(kvGet)
  if (Array.isArray(body.containers)) cfg.containers = body.containers.filter(c => c && c.name).map(c => ({ id: String(c.id || ('c' + Math.random().toString(36).slice(2, 7))), name: String(c.name).slice(0, 30), g: Math.max(0, num(c.g) || 0) })).slice(0, 50)
  if (Array.isArray(body.reasons) && body.reasons.length) cfg.reasons = [...new Set(body.reasons.map(x => String(x).trim().slice(0, 12)).filter(Boolean))].slice(0, 20)
  if (num(body.bigAmt) != null) cfg.bigAmt = Math.max(0, num(body.bigAmt))
  if (body.est) cfg.est = { minPairs: Math.max(1, num(body.est.minPairs) || 30), maxErr: Math.max(1, num(body.est.maxErr) || 15) }
  cfg.updatedBy = who.name; cfg.updatedAt = new Date().toISOString()
  await kvPut(WASTE_CFG_KEY, cfg, '耗損設定(' + who.name + ')')
  return { ok: true }
}

// ── 統計／命中率／估重開放狀態 ──
export function summarize (rows, cfg) {
  const live = rows.filter(r => !r.voidOf && !rows.some(x => x.voidOf === r.id))
  const sum = (arr, k) => arr.reduce((s, r) => s + (num(r[k]) || 0), 0)
  const by = key => { const m = {}; for (const r of live) { if (r.staffMeal) continue; const k = r[key] || '（未填）'; const o = m[k] || (m[k] = { k, n: 0, amount: 0, g: 0 }); o.n++; o.amount += num(r.amount) || 0; o.g += num(r.netG) || 0 } return Object.values(m).sort((a, b) => b.amount - a.amount || b.n - a.n) }
  const hit = Object.entries(cfg.hit || {}).map(([code, h]) => ({ code, n: h.n, rate: h.n ? Math.round(h.hit / h.n * 100) : null }))
  const est = Object.entries(cfg.pairs || {}).map(([code, ps]) => { const errs = ps.map(p => Math.abs(p.estG - p.realG) / p.realG * 100).sort((a, b) => a - b); const med = errs.length ? errs[Math.floor(errs.length / 2)] : null; return { code, n: ps.length, medErr: med != null ? Math.round(med) : null, open: ps.length >= cfg.est.minPairs && med != null && med <= cfg.est.maxErr } })
  return { total: { n: live.filter(r => !r.staffMeal).length, amount: Math.round(sum(live.filter(r => !r.staffMeal), 'amount')), g: Math.round(sum(live.filter(r => !r.staffMeal), 'netG')), staffMeal: live.filter(r => r.staffMeal).length, big: live.filter(r => r.bigFlag).length, noCost: live.filter(r => !r.staffMeal && r.amount == null).length }, byItem: by('name'), byReason: by('reason'), byStation: by('station'), byPerson: by('by'), hit, est }
}

export async function signPhoto (path) { if (!/^waste\//.test(String(path || ''))) return null; return signedUrl(path, 300) }
