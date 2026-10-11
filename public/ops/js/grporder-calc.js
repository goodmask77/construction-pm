// 🧾 團體訂餐｜唯一一支計價（v4.70.78 批次 1，規格 docs/GROUP_ORDER_SPEC.md §4）
// 客人頁（/order/<code>）、GD 分頁（p25-grporder.js）、後端（api/_grporder.js）三邊都 import 這一支；數字不會各算各的。
// 瀏覽器用 <script type="module"> 載入後掛在 window.GOCALC；Node（Vercel function）直接 import。
// 菜單只認 sp_finance_pm_menu.draft（最新菜單）：normMenu 每次把那份資料整理成 {setN, sideOff, drinkOff, sections[{key,name,kind,combo,items}]}

export function normMenu (doc) {
  const d = (doc && (doc.draft || doc.base)) || { sections: [] }
  const setN = Number((String(d.note || '').match(/(\d+)\s*元/) || [])[1]) || 89 // 「套餐玩法 +89 元＝…」→ 89
  const sections = (d.sections || []).map((s, si) => {
    const nm = String(s.name || ''), combo = Number(s.combo) || 0
    const kind = /PIZZA|披薩|比薩/i.test(nm) ? 'pizza' : /DRINK|飲品|飲料|咖啡/i.test(nm) ? 'drink' : (combo > 0 || /SNACK|小點|炸物|副餐|副食/i.test(nm)) ? 'snack' : 'main'
    const items = (s.items || []).filter(it => it && it.name && !it.del).map(it => ({ id: String(it.id || (si + '|' + it.name)), name: String(it.name).trim(), en: String(it.en || ''), price: Number(it.price) || 0, soon: !!it.soon, note: String(it.note || '') })).filter(it => it.price > 0 || it.soon)
    return { key: 's' + si, name: nm, kind, combo, items }
  }).filter(s => s.items.length)
  return { setN, sideOff: (sections.find(s => s.kind === 'snack') || {}).combo || 0, drinkOff: (sections.find(s => s.kind === 'drink') || {}).combo || 0, sections }
}
export function flatItems (menu) { const out = []; for (const s of (menu.sections || [])) for (const it of s.items) out.push({ ...it, kind: s.kind, sec: s.key, secName: s.name }); return out }
export function itemOf (menu, id) { if (!id) return null; for (const s of (menu.sections || [])) { const it = s.items.find(x => x.id === id); if (it) return { ...it, kind: s.kind, sec: s.key, secName: s.name } } return null }

// 一列（一人）：{ name, main:{id,q,note,p?}, side, drink, extras:[{id,q,note,p?}], combo, pend:[{text,q,note,sug:[id]}] }
// frozen=true（已鎖單）→ 用鎖單當時存進去的 p；否則一律最新菜單價
export function pickPrice (menu, pk, frozen) {
  if (!pk || !pk.id) return { price: 0, missing: false }
  if (frozen && pk.p != null) return { price: Number(pk.p) || 0, missing: false }
  const it = itemOf(menu, pk.id)
  if (!it || it.soon) return { price: 0, missing: true } // 菜單拿掉／標即將上線 → 這筆要重選
  return { price: it.price, missing: false }
}
export function priceRow (menu, r, frozen) {
  const P = pk => pickPrice(menu, pk, frozen)
  let missing = 0
  const mp = P(r.main); if (r.main && mp.missing) missing++
  const main = r.main ? mp.price * (Number(r.main.q) || 1) : 0
  let set = 0, diff = 0, ala = 0
  const sp = P(r.side), dp = P(r.drink); if (r.side && sp.missing) missing++; if (r.drink && dp.missing) missing++
  const sideAmt = r.side ? sp.price * (Number(r.side.q) || 1) : 0, drinkAmt = r.drink ? dp.price * (Number(r.drink.q) || 1) : 0
  if (r.combo && r.main) { set = menu.setN; if (r.side) diff += Math.max(0, sideAmt - menu.sideOff); if (r.drink) diff += Math.max(0, drinkAmt - menu.drinkOff) } else { ala += sideAmt + drinkAmt }
  for (const e of (r.extras || [])) { const ep = P(e); if (ep.missing) missing++; ala += ep.price * (Number(e.q) || 1) }
  const pend = (r.pend || []).length
  return { main, set, diff, ala, total: main + set + diff + ala, pend, missing }
}
export function parseDisc (s, sub) { s = String(s || '').trim(); if (!s) return 0; if (/%$/.test(s)) return Math.round(sub * (parseFloat(s) / 100)) || 0; return Math.round(parseFloat(s)) || 0 }
export function totals (menu, o) {
  const frozen = !!o.frozen
  let sub = 0, pend = 0, missing = 0, sets = 0
  for (const r of (o.rows || [])) { const p = priceRow(menu, r, frozen); sub += p.total; pend += p.pend; missing += p.missing; if (p.set) sets++ }
  let shared = 0; for (const s of (o.shared || [])) { const sp = pickPrice(menu, s, frozen); if (sp.missing) missing++; shared += sp.price * (Number(s.q) || 1) }
  const disc = parseDisc(o.disc, sub + shared)
  return { people: sub, shared, sub: sub + shared, disc, total: sub + shared - disc, pend, missing, sets, dep: Number(o.dep) || 0 }
}
// 搬運建議（規格 §6）：cfg={bag,cup,pz,hand}
export function carry (menu, o, cf) {
  cf = { bag: 6, cup: 6, pz: 2, hand: 3, ...(cf || {}) }
  let food = 0, cups = 0, pz = 0
  for (const r of (o.rows || [])) {
    if (r.main) food += Number(r.main.q) || 1
    if (r.side) food += Number(r.side.q) || 1
    if (r.drink) cups += Number(r.drink.q) || 1
    for (const e of (r.extras || [])) { const it = itemOf(menu, e.id); if (it && it.kind === 'drink') cups += Number(e.q) || 1; else food += Number(e.q) || 1 }
  }
  for (const s of (o.shared || [])) { const it = itemOf(menu, s.id); if (it && it.kind === 'pizza') pz += Number(s.q) || 1; else food += Number(s.q) || 1 }
  const bags = Math.ceil(food / cf.bag), cupBags = Math.ceil(cups / cf.cup), stacks = Math.ceil(pz / cf.pz)
  const units = bags + cupBags + stacks
  return { food, cups, pz, bags, cupBags, stacks, units, people: Math.max(1, Math.ceil(units / cf.hand)), cf }
}
// 對不到最新菜單的文字 → 最接近的三個品項（給客人／店家點一下換掉）
export function overlap (a, b) { const A = new Set(String(a || '').replace(/\s/g, '')), B = new Set(String(b || '').replace(/\s/g, '')); if (!A.size || !B.size) return 0; let c = 0; for (const ch of A) if (B.has(ch)) c++; return c / Math.max(A.size, B.size) }
export function suggest (menu, text, n) { return flatItems(menu).filter(i => !i.soon).map(i => ({ i, s: overlap(text, i.name) })).sort((a, b) => b.s - a.s).slice(0, n || 3).filter(x => x.s > 0).map(x => x.i.id) }
// 整理一列（兩邊存前都走這裡：去掉不存在的 id、數量≥1、字串裁短）
export function cleanPick (menu, pk) { if (!pk || typeof pk !== 'object' || !pk.id) return null; const it = itemOf(menu, pk.id); if (!it) return null; const o = { id: String(pk.id), q: Math.max(1, Math.min(99, Math.round(Number(pk.q) || 1))), note: String(pk.note || '').slice(0, 40) }; if (pk.p != null) o.p = Number(pk.p) || 0; return o }
export function cleanRow (menu, r) {
  r = r || {}
  const row = { name: String(r.name || '').slice(0, 30), main: cleanPick(menu, r.main), side: cleanPick(menu, r.side), drink: cleanPick(menu, r.drink), extras: (Array.isArray(r.extras) ? r.extras : []).map(e => cleanPick(menu, e)).filter(Boolean).slice(0, 12), combo: !!r.combo, pend: (Array.isArray(r.pend) ? r.pend : []).slice(0, 8).map(p => ({ text: String((p && p.text) || '').slice(0, 60), q: Math.max(1, Math.round(Number(p && p.q) || 1)), note: String((p && p.note) || '').slice(0, 40), sug: suggest(menu, (p && p.text) || '') })).filter(p => p.text), note: String(r.note || '').slice(0, 80) }
  if (!row.main) row.combo = false
  return row
}
export function cleanOrderBody (menu, b) { return { rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 120).map(r => cleanRow(menu, r)), shared: (Array.isArray(b.shared) ? b.shared : []).map(s => cleanPick(menu, s)).filter(Boolean).slice(0, 30) } }
export function labelOf (menu, pk) { const it = itemOf(menu, pk && pk.id); if (!it) return '（已下架）'; return it.name + (pk.note ? '・' + pk.note : '') + ((Number(pk.q) || 1) > 1 ? ' ×' + pk.q : '') }
export const STATUS = ['draft', 'sent', 'submitted', 'priced', 'confirmed', 'locked', 'done']
export const STATUS_LABEL = { draft: '建單', sent: '已發連結', submitted: '客人已送出', priced: '已核價', confirmed: '客人已確認', locked: '鎖單', done: '完成', void: '作廢' }
export const CUST_EDITABLE = ['draft', 'sent', 'submitted', 'priced']

const GOCALC = { normMenu, flatItems, itemOf, pickPrice, priceRow, parseDisc, totals, carry, overlap, suggest, cleanPick, cleanRow, cleanOrderBody, labelOf, STATUS, STATUS_LABEL, CUST_EDITABLE }
if (typeof window !== 'undefined') window.GOCALC = GOCALC
export default GOCALC
