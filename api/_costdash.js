// ── 產品與成本模組｜批次 5a「成本總覽（首頁）」＋「廠商與月帳」後端（v4.70.34，2026-10-10）──
// 規格 docs/COST_MODULE_SPEC.md §1、§6。原則：同一個數字同一套算法——待處理用 _cost.buildTodo、供應品↔卡用 _matcard.buildCards，
// 叫貨序列用 _cost.loadSeries；本檔只做「彙總＋人填的設定／對帳」：
//   ・sp_finance_pm_cost_cfg.ratioCap{品類:%}＝成本率上限（管理者設；未設定一律顯示「未設定」，不套預設）
//   ・sp_finance_pm_vendor_recon_YYYYMM{sys|廠商:{exTax, tax, note, done, by, at, log[]}}＝月帳對帳（廠商帳單「未稅＋稅額」兩格；阿桑 vendor_recon 尚未給端點）
//   ・金額口徑：單價 0／空＝不知道，不計入；null 不是 0；未稅廠商另給 ×1.05 四捨五入的「含稅估」並標明
import { buildTodo, loadSeries, num, norm } from './_cost.js'
import { buildCards } from './_matcard.js'

export const CFG_KEY = 'sp_finance_pm_cost_cfg'
const reconKey = ym => 'sp_finance_pm_vendor_recon_' + String(ym).replace('-', '')
const tpeToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const tpeDay = s => { const t = Date.parse(String(s || '')); return isNaN(t) ? '' : new Date(t + 8 * 3600e3).toISOString().slice(0, 10) }
const rows = d => Object.values((d || {}).rows || {})
const DRINK_RE = /飲|酒|茶|果昔|咖啡|SOFT|BEER|WINE|DRINK/i // 飲料類：阿桑 view 口徑不同，不計平均毛利（同 10/06 快照作法）
const vkey = (sys, name) => (sys === 'GROUN:D' ? 'G|' : 'A|') + String(name || '').trim()

// ── §1 成本總覽 ──
export async function buildDash ({ kvGet, months }) {
  const [todo, menuD, cfg0] = await Promise.all([buildTodo({ kvGet, months }), kvGet('sp_finance_pm_boss_menu'), kvGet(CFG_KEY)])
  const cfg = cfg0 || { ratioCap: {} }
  const caps = cfg.ratioCap || {}
  const menus = rows(menuD).map(m => ({ id: m.menu_id, name: m.name, cat: m.category || '', price: num(m.price), cost: num(m.cost), ratio: num(m.cost_ratio), active: !!m.is_active, complete: !!m.cost_complete, lines: m.recipe_lines, costed: m.lines_costed, noPrice: m.lines_no_price, noConv: m.lines_no_conversion }))
  const active = menus.filter(m => m.active)
  const cats = [...new Set(active.map(m => m.cat).filter(Boolean))].sort()
  const over = active.filter(m => m.complete && m.price > 0 && m.cost > 0 && caps[m.cat] != null && (m.cost / m.price * 100) > Number(caps[m.cat]))
    .map(m => ({ name: m.name, cat: m.cat, price: m.price, cost: m.cost, ratio: Math.round(m.cost / m.price * 1000) / 10, cap: Number(caps[m.cat]) })).sort((a, b) => (b.ratio - b.cap) - (a.ratio - a.cap))
  const today = tpeToday(), weekAgo = new Date(Date.parse(today) - 7 * 864e5).toISOString().slice(0, 10)
  const items = todo.items || []
  const weekPrice = items.filter(it => it.tab === 'price' && it.open && it.date >= weekAgo)
  const weekChanges = weekPrice.slice().sort((a, b) => Math.abs((b.impact || {}).perServing || 0) - Math.abs((a.impact || {}).perServing || 0) || ((b.impact || {}).nMenus || 0) - ((a.impact || {}).nMenus || 0))
    .slice(0, 15).map(it => ({ id: it.id, name: it.name, supplier: it.supplier, sys: it.sys, code: it.code, title: it.title, signal: it.signal, info: !!it.info, date: it.date, perServing: (it.impact || {}).perServing || 0, nMenus: (it.impact || {}).nMenus || 0, menus: ((it.impact || {}).menus || []).slice(0, 4) }))
  const top10 = items.filter(it => it.open && !it.info).slice(0, 10).map(it => ({ id: it.id, tab: it.tab, name: it.name, supplier: it.supplier, sys: it.sys, title: it.title, signal: it.signal, date: it.date, perServing: (it.impact || {}).perServing || 0, nMenus: (it.impact || {}).nMenus || 0 }))
  // 平均毛利：在賣、非飲料、成本完整、有售價；不完整不計
  const gm = active.filter(m => !DRINK_RE.test(m.cat) && m.complete && m.price > 0 && m.cost > 0).map(m => (m.price - m.cost) / m.price)
  const avgMargin = gm.length ? Math.round(gm.reduce((s, x) => s + x, 0) / gm.length * 1000) / 10 : null
  // 各品類成本率摘要（給設定面板：平均成本率、道數、超標數）
  const byCat = cats.map(c => { const ms = active.filter(m => m.cat === c); const ok = ms.filter(m => m.complete && m.price > 0 && m.cost > 0); const avg = ok.length ? Math.round(ok.reduce((s, m) => s + m.cost / m.price, 0) / ok.length * 1000) / 10 : null; return { cat: c, n: ms.length, nComplete: ok.length, avgRatio: avg, cap: caps[c] != null ? Number(caps[c]) : null, over: over.filter(o => o.cat === c).length, drink: DRINK_RE.test(c) } })
  return {
    kpi: {
      menuComplete: active.filter(m => m.complete).length, menuTotal: active.length, menuSrc: '阿桑 /costs/menu view 口徑（cost_complete）；批次 3 食譜庫上線後換本模組完整度',
      pending: (todo.counts || {}).urgent || 0, pendingAll: (todo.counts || {}).total || 0,
      over: over.length, overSet: Object.keys(caps).filter(k => caps[k] != null).length, catsTotal: cats.length,
      weekPrice: weekPrice.length,
      avgMargin, avgMarginN: gm.length,
    },
    over: over.slice(0, 30), weekChanges, top10, byCat, caps, cfgUpdatedAt: cfg.updatedAt || null,
    updated: { menu: (menuD || {}).updatedAt || null, todo: todo.masterUpdatedAt || null, series: todo.seriesFrom || null, live: !!todo.live },
    counts: todo.counts,
  }
}

// ── §6 廠商與月帳 ──
async function loadOrders (kvGet, months, slug, sys) {
  const docs = await Promise.all(months.map(m => kvGet(`sp_finance_pm_boss_${slug}_` + m.replace('-', ''))))
  const out = []
  for (const d of docs) for (const r of rows(d)) if (r.order_id) out.push({ sys, id: r.order_id, date: tpeDay(r.created_at), supplier: (r.supplier || '').trim() || '（未填廠商）', status: r.status || '', total: num(r.total_amount), lines: num(r.line_count), unpriced: num(r.unpriced_lines), dept: r.dept || r.source || '' })
  return out
}
async function loadLines (kvGet, months, slug, sys) {
  const docs = await Promise.all(months.map(m => kvGet(`sp_finance_pm_boss_${slug}_` + m.replace('-', ''))))
  const out = []
  for (const d of docs) for (const r of rows(d)) {
    const p = num(r.price), q = num(r.qty); const st = r.order_status || r.status || ''
    out.push({ sys, oid: r.order_id, d: tpeDay(r.ordered_at || r.created_at), supplier: (r.supplier || '').trim() || '（未填廠商）', code: r.code || '', name: r.name || '', unit: r.unit || '', p, q, amt: (p != null && p > 0 && q != null) ? p * q : null, st, bf: !!r.is_backfill })
  }
  return out
}
export async function buildVendors ({ kvGet, months, ym, detail }) {
  const today = tpeToday(), thisYm = ym || today.slice(0, 7)
  const prevYm = (() => { const d = new Date(thisYm + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) })()
  const [supD, gsupD, prodD, gprodD, ordA, ordG, linA, linG, reconThis, reconPrev] = await Promise.all([
    kvGet('sp_finance_pm_boss_sup'), kvGet('sp_finance_pm_boss_gsup'), kvGet('sp_finance_pm_boss_prod'), kvGet('sp_finance_pm_boss_gprod'),
    loadOrders(kvGet, months, 'ord', 'A Beach'), loadOrders(kvGet, months, 'gord', 'GROUN:D'), loadLines(kvGet, months, 'ordi', 'A Beach'), loadLines(kvGet, months, 'gordi', 'GROUN:D'),
    kvGet(reconKey(thisYm)), kvGet(reconKey(prevYm)),
  ])
  const vendors = {}
  const mk = (sys, name) => { const k = vkey(sys, name); return vendors[k] || (vendors[k] = { key: k, sys, name, status: '', taxExcl: null, bill: '', orderDays: [], restDays: [], minOrder: null, nProducts: 0, nActive: 0, last: '', months: {}, nOrders: 0 }) }
  for (const s of rows(supD)) { const v = mk('A Beach', s.name); v.status = s.is_active ? '啟用' : '停用'; v.taxExcl = !!s.price_tax_excl; v.bill = (s.bill_basis === 'recv' ? '以驗收日' : s.bill_basis === 'order' ? '以下單日' : (s.bill_basis || '—')) + (s.bill_cut_day ? `・每月 ${s.bill_cut_day} 日結` : '・一般月帳'); v.orderDays = s.order_days || []; v.restDays = s.rest_days || []; v.minOrder = s.min_order_on ? num(s.min_order_amount) : null; v.billDepts = s.bill_depts || [] }
  for (const s of rows(gsupD)) { const v = mk('GROUN:D', s.name); v.status = s.is_active ? '啟用' : '停用'; v.taxExcl = !!s.price_tax_excl; v.bill = '—'; v.orderDays = s.order_days || []; v.restDays = [...(s.rest_dates || []), ...(s.rest_weekdays || []).map(w => '每週' + '日一二三四五六'[w] )]; v.cat = s.category || '' }
  for (const p of rows(prodD)) if (p.supplier) { const v = mk('A Beach', p.supplier); v.nProducts++; if (p.is_active) v.nActive++ }
  for (const p of rows(gprodD)) if (p.supplier) { const v = mk('GROUN:D', p.supplier); v.nProducts++; if (p.is_active) v.nActive++ }
  for (const o of [...ordA, ...ordG]) { const v = mk(o.sys, o.supplier); if (o.status === 'approved' || o.status === 'received') { v.nOrders++; if (o.date > v.last) v.last = o.date } }
  // 月金額：approved/received 行、單價>0；補單另計
  for (const l of [...linA, ...linG]) {
    if (!(l.st === 'approved' || l.st === 'received') || !l.d) continue
    const v = mk(l.sys, l.supplier); const m = l.d.slice(0, 7)
    const mm = v.months[m] || (v.months[m] = { amt: 0, n: 0, lines: 0, unpriced: 0, bfAmt: 0, bfLines: 0, orders: new Set() })
    mm.lines++; mm.orders.add(l.oid)
    if (l.amt == null) { mm.unpriced++; continue }
    if (l.bf) { mm.bfAmt += l.amt; mm.bfLines++ } else mm.amt += l.amt
  }
  const reconOf = (doc, k) => ((doc || {}).vendors || {})[k] || null
  const list = Object.values(vendors).map(v => {
    const ms = {}
    for (const [m, x] of Object.entries(v.months)) ms[m] = { amt: Math.round(x.amt), n: x.orders.size, lines: x.lines, unpriced: x.unpriced, bfAmt: Math.round(x.bfAmt), bfLines: x.bfLines, incl: v.taxExcl ? Math.round(x.amt * 1.05) : null }
    const cur = ms[thisYm] || { amt: 0, n: 0, lines: 0, unpriced: 0, bfAmt: 0, bfLines: 0, incl: v.taxExcl ? 0 : null }
    const rec = reconOf(reconThis, v.key), recP = reconOf(reconPrev, v.key)
    const calcDiff = (r, m) => { if (!r || (r.exTax == null && r.tax == null)) return null; const bill = (Number(r.exTax) || 0) + (Number(r.tax) || 0); const sys = m.amt + m.bfAmt; return { bill, sys, diff: Math.round(sys - bill), pct: sys ? Math.round((sys - bill) / sys * 1000) / 10 : null, warn: bill < 0 ? '帳單金額為負，請再確認' : (sys && Math.abs(sys - bill) / sys > 0.5 ? '與系統差超過 50%，請再確認' : '') } }
    return { ...v, months: ms, cur, recon: rec ? { ...rec, ...calcDiff(rec, cur) } : null, reconPrev: recP ? { ...recP, ...calcDiff(recP, ms[prevYm] || { amt: 0, bfAmt: 0 }) } : null, curPrev: ms[prevYm] || null }
  }).sort((a, b) => (a.status === '啟用' ? 0 : 1) - (b.status === '啟用' ? 0 : 1) || (b.cur.amt - a.cur.amt) || (a.name < b.name ? -1 : 1))
  const out = { vendors: list, ym: thisYm, prevYm, today, updated: { sup: (supD || {}).updatedAt || null, gsup: (gsupD || {}).updatedAt || null } }
  if (detail) { // 單一廠商：供應品（接物料卡 id）、報價歷史、近 3 個月採購單
    const v = vendors[detail]; if (!v) return { ...out, detail: null }
    const [serA, serG, cards] = await Promise.all([loadSeries(kvGet, months), loadSeries(kvGet, months, 'gordi', 'GROUN:D'), buildCards({ kvGet, months })])
    const ser = (v.sys === 'GROUN:D' ? serG : serA).series.filter(s => s.supplier === v.name)
    const cardOf = {}; for (const c of cards.cards) for (const k of c.supplies) cardOf[k] = c.id
    const prods = rows(v.sys === 'GROUN:D' ? gprodD : prodD).filter(p => p.supplier === v.name).map(p => { const k = (v.sys === 'GROUN:D' ? 'G|' : 'A|') + norm(p.code); const s = ser.find(x => norm(x.code) === norm(p.code)); const last = s && s.pts[s.pts.length - 1]; return { code: p.code, sku: p.sku || '', name: p.name, unit: p.unit, price: num(p.price), active: !!p.is_active, cat: p.category || '', cardId: cardOf[k] || ('auto:' + k), lastPrice: last ? last.p : null, lastDate: last ? last.d : '' } }).sort((a, b) => (a.active ? 0 : 1) - (b.active ? 0 : 1) || (a.name < b.name ? -1 : 1))
    const quotes = ser.map(s => { const ps = s.pts.map(p => p.p); let ch = 0; for (let i = 1; i < ps.length; i++) if (Math.abs(ps[i] - ps[i - 1]) / ps[i - 1] > 0.001) ch++; return { code: s.code, name: s.name, unit: s.unit, n: s.pts.length, first: ps[0], firstDate: s.pts[0].d, last: ps[ps.length - 1], lastDate: s.pts[s.pts.length - 1].d, min: Math.min(...ps), max: Math.max(...ps), changes: ch, pct: ps[0] ? Math.round((ps[ps.length - 1] - ps[0]) / ps[0] * 1000) / 10 : null, series: s.pts.slice(-8).map(p => ({ d: p.d, p: p.p })) } }).sort((a, b) => b.changes - a.changes || b.n - a.n)
    const since = new Date(Date.parse(today) - 92 * 864e5).toISOString().slice(0, 10)
    const orders = (v.sys === 'GROUN:D' ? ordG : ordA).filter(o => o.supplier === v.name && o.date >= since).sort((a, b) => (a.date < b.date ? 1 : -1))
    // 月帳列表：近 6 個月每月一列
    const recDocs = await Promise.all(months.slice(0, 6).map(m => kvGet(reconKey(m))))
    const recon = months.slice(0, 6).map((m, i) => { const x = list.find(z => z.key === v.key); const mm = (x && x.months[m]) || { amt: 0, n: 0, lines: 0, unpriced: 0, bfAmt: 0, bfLines: 0, incl: null }; const r = reconOf(recDocs[i], v.key); const bill = r && (r.exTax != null || r.tax != null) ? (Number(r.exTax) || 0) + (Number(r.tax) || 0) : null; const sys = mm.amt + mm.bfAmt; return { ym: m, sys, incl: v.taxExcl ? Math.round(sys * 1.05) : null, n: mm.n, lines: mm.lines, unpriced: mm.unpriced, bfAmt: mm.bfAmt, bfLines: mm.bfLines, exTax: r ? r.exTax : null, tax: r ? r.tax : null, bill, diff: bill != null ? Math.round(sys - bill) : null, pct: bill != null && sys ? Math.round((sys - bill) / sys * 1000) / 10 : null, warn: bill == null ? '' : (bill < 0 ? '帳單金額為負，請再確認' : (sys && Math.abs(sys - bill) / sys > 0.5 ? '與系統差超過 50%，請再確認' : '')), done: !!(r && r.done), note: r ? r.note : '', by: r ? r.by : '', at: r ? r.at : '', log: r ? (r.log || []).slice(-10) : [] } })
    out.detail = { key: v.key, sys: v.sys, name: v.name, products: prods, quotes, orders, recon }
  }
  return out
}

// ── 寫：成本率上限／月帳對帳（限採購權限，留紀錄）──
export async function applyDashOp ({ kvGet, kvPut, who, body }) {
  const at = new Date().toISOString(), op = String(body.op || '')
  if (op === 'ratioCap') {
    const doc = (await kvGet(CFG_KEY)) || { ratioCap: {}, log: [] }
    doc.ratioCap = doc.ratioCap || {}; doc.log = doc.log || []
    const caps = body.caps || {}; const before = { ...doc.ratioCap }
    for (const [cat, v] of Object.entries(caps)) { const c = String(cat).slice(0, 60); if (v == null || v === '' || v === false) delete doc.ratioCap[c]; else { const n = Number(v); if (!(n > 0 && n <= 100)) return { ok: false, error: `「${c}」的成本率上限要在 1～100% 之間` }; doc.ratioCap[c] = n } }
    doc.updatedAt = at; doc.log.push({ at, by: who.name, op, before, after: { ...doc.ratioCap } }); if (doc.log.length > 200) doc.log = doc.log.slice(-200)
    await kvPut(CFG_KEY, doc, '成本率上限(' + who.name + ')'); return { ok: true, ratioCap: doc.ratioCap }
  }
  if (op === 'recon') {
    const ym = String(body.ym || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: '月份格式要 YYYY-MM' }
    const k = vkey(body.sys, body.supplier); if (!String(body.supplier || '').trim()) return { ok: false, error: '缺廠商' }
    const doc = (await kvGet(reconKey(ym))) || { vendors: {} }
    doc.vendors = doc.vendors || {}
    const prev = doc.vendors[k] || { log: [] }
    const exTax = body.exTax === '' || body.exTax == null ? null : Number(body.exTax), tax = body.tax === '' || body.tax == null ? null : Number(body.tax)
    if ((exTax != null && isNaN(exTax)) || (tax != null && isNaN(tax))) return { ok: false, error: '金額要是數字' }
    const next = { exTax, tax, note: String(body.note || '').slice(0, 300), done: !!body.done, by: who.name, at, log: [...(prev.log || []), { at, by: who.name, exTax, tax, done: !!body.done, note: String(body.note || '').slice(0, 120), prev: { exTax: prev.exTax, tax: prev.tax, done: prev.done } }].slice(-30) }
    doc.vendors[k] = next; doc.updatedAt = at
    await kvPut(reconKey(ym), doc, '月帳對帳 ' + ym + '(' + who.name + ')'); return { ok: true }
  }
  return { ok: false, error: '不認得的操作' }
}
