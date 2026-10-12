// 🧾 團體訂餐｜唯一一支計價（v4.70.78 批次 1b，規格 docs/GROUP_ORDER_SPEC.md §4）
// 客人頁（/order/<code>）、GD 分頁（p25-grporder.js）、後端（api/_grporder.js）三邊都 import 這一支；數字不會各算各的。
// 瀏覽器用 <script type="module"> 載入後掛在 window.GOCALC；Node（Vercel function）直接 import。
// 菜單只認 sp_finance_pm_menu.draft（最新菜單）：normMenu 每次把那份資料整理成 {setN, sideOff, drinkOff, sections[{key,name,kind,combo,items}]}
// 資料模型（1b，像 UberEats 每人自己點）：一單 = { rows:[人], shared:[共用] }；人 = { pid, uid, name, src:'line'|'manual', done, lines:[一道], pend:[對不到的] }
//   一道 = { id, q, set:true|false, side:{id,note}|null, drink:{id,note}|null, note, p?, side.p?, drink.p? }（p＝鎖單時的價格快照）

export function normMenu (doc) {
  const d = (doc && (doc.draft || doc.base)) || { sections: [] }
  const setN = Number((String(d.note || '').match(/(\d+)\s*元/) || [])[1]) || 89 // 「套餐玩法 +89 元＝…」→ 89
  const sections = (d.sections || []).map((s, si) => {
    const nm = String(s.name || ''), combo = Number(s.combo) || 0
    const kind = /PIZZA|披薩|比薩/i.test(nm) ? 'pizza' : /DRINK|飲品|飲料|咖啡/i.test(nm) ? 'drink' : (combo > 0 || /SNACK|小點|炸物|副餐|副食/i.test(nm)) ? 'snack' : 'main'
    const photo = /PIZZA|披薩/i.test(nm) ? 'pizza' : /BURGER|漢堡/i.test(nm) ? 'burger' : /BOWL|碗|沙拉/i.test(nm) ? 'bowl' : /ROLL|三明治/i.test(nm) ? 'roll' : /PASTA|義大利麵/i.test(nm) ? 'pasta' : /BRUNCH|早午餐/i.test(nm) ? 'brunch' : /SNACK|小點|炸物/i.test(nm) ? 'snack' : ''
    const items = (s.items || []).filter(it => it && it.name && !it.del).map(it => ({ id: String(it.id || (si + '|' + it.name)), name: String(it.name).trim(), en: String(it.en || ''), price: Number(it.price) || 0, soon: !!it.soon, note: String(it.note || ''), img: it.img || '' })).filter(it => it.price > 0 || it.soon)
    return { key: 's' + si, name: nm, kind, combo, photo, items }
  }).filter(s => s.items.length)
  return { setN, sideOff: (sections.find(s => s.kind === 'snack') || {}).combo || 0, drinkOff: (sections.find(s => s.kind === 'drink') || {}).combo || 0, sections }
}
export function flatItems (menu) { const out = []; for (const s of (menu.sections || [])) for (const it of s.items) out.push({ ...it, kind: s.kind, sec: s.key, secName: s.name, photo: s.photo }); return out }
export function itemOf (menu, id) { if (!id) return null; for (const s of (menu.sections || [])) { const it = s.items.find(x => x.id === id); if (it) return { ...it, kind: s.kind, sec: s.key, secName: s.name, photo: s.photo } } return null }
// 可不可以升級套餐：主餐類；副餐／飲品／披薩不行
export const canSet = (it) => !!it && (it.kind === 'main' || it.kind === 'pizza') // 披薩也能 +89 升級套餐（張良 2026-10-12）
// 口味選項（從品名推：「原味/川味麻辣」「原味 / ZERO」「飯 / 沙拉」「I/H」＝冰/熱）
export function variantsOf (it) {
  if (!it) return []
  const nm = String(it.name)
  if (/\bI\s*[\/／|｜]\s*H\b/i.test(nm) || /冰\s*[\/／|｜]\s*熱/.test(nm + ' ' + (it.note || ''))) return ['冰', '熱']
  const m = nm.match(/([^\s\/／|｜]{1,6})\s*[\/／|｜]\s*([^\s\/／|｜]{1,6})\s*$/)
  if (m && m[1] !== m[2]) return [m[1].length >= 4 ? m[1].slice(-1) : m[1], m[2]] // 「紐約街頭雞上飯 / 沙拉」→ 飯／沙拉
  return []
}
// 飲料客製（冰塊／甜度）：茶類兩種都有、咖啡與可樂只有冰塊、湯沒有
export function customOf (it) {
  if (!it || it.kind !== 'drink') return { ice: [], sugar: [] }
  const nm = it.name
  if (/湯/.test(nm)) return { ice: [], sugar: [] }
  const hot = variantsOf(it).includes('熱')
  const ice = ['正常冰', '少冰', '去冰']
  const sugar = /茶|烏龍|奶茶/.test(nm) && !/咖啡|拿鐵|可樂/.test(nm) ? ['正常甜', '半糖', '無糖'] : /奶茶|拿鐵|抹茶|可可/.test(nm) ? ['正常甜', '半糖', '無糖'] : []
  return { ice, sugar, hot }
}
// 名字顯示用：「主餐 ×2・川味」
export function pickPrice (menu, pk, frozen) {
  if (!pk || !pk.id) return { price: 0, missing: false }
  if (frozen && pk.p != null) return { price: Number(pk.p) || 0, missing: false }
  const it = itemOf(menu, pk.id)
  if (!it || it.soon) return { price: 0, missing: true } // 菜單拿掉／標即將上線 → 這筆要重選
  return { price: it.price, missing: false }
}
// 一道：單點＝價×量；套餐＝（價＋setN＋副餐超過折抵的差＋飲品超過折抵的差）×量
export function priceLine (menu, l, frozen) {
  const bp = pickPrice(menu, l, frozen); const q = Math.max(1, Number(l.q) || 1)
  let missing = bp.missing ? 1 : 0
  const base = bp.price * q
  let set = 0, diff = 0
  if (l.set) {
    set = menu.setN * q
    if (l.side) { const sp = pickPrice(menu, l.side, frozen); if (sp.missing) missing++; diff += Math.max(0, sp.price - menu.sideOff) * q }
    if (l.drink) { const dp = pickPrice(menu, l.drink, frozen); if (dp.missing) missing++; diff += Math.max(0, dp.price - menu.drinkOff) * q }
  }
  return { base, set, diff, total: base + set + diff, missing, q }
}
export function priceRow (menu, r, frozen) {
  let main = 0, set = 0, diff = 0, ala = 0, missing = 0
  for (const l of (r.lines || [])) {
    const p = priceLine(menu, l, frozen); missing += p.missing
    const it = itemOf(menu, l.id)
    if (l.set || (it && it.kind === 'main')) main += p.base; else ala += p.base
    set += p.set; diff += p.diff
  }
  const pend = (r.pend || []).length
  return { main, set, diff, ala, total: main + set + diff + ala, pend, missing, sets: (r.lines || []).filter(l => l.set).reduce((n, l) => n + (Number(l.q) || 1), 0) }
}
export function parseDisc (s, sub) { s = String(s || '').trim(); if (!s) return 0; if (/%$/.test(s)) return Math.round(sub * (parseFloat(s) / 100)) || 0; return Math.round(parseFloat(s)) || 0 }
export function totals (menu, o) {
  const frozen = !!o.frozen
  let sub = 0, pend = 0, missing = 0, sets = 0
  for (const r of (o.rows || [])) { const p = priceRow(menu, r, frozen); sub += p.total; pend += p.pend; missing += p.missing; sets += p.sets }
  let shared = 0; for (const s of (o.shared || [])) { const sp = pickPrice(menu, s, frozen); if (sp.missing) missing++; shared += sp.price * (Number(s.q) || 1) }
  const disc = parseDisc(o.disc, sub + shared)
  return { people: sub, shared, sub: sub + shared, disc, total: sub + shared - disc, pend, missing, sets, dep: Number(o.dep) || 0, n: (o.rows || []).length, nDone: (o.rows || []).filter(r => r.done).length }
}
// 搬運建議（規格 §6）：cfg={bag,cup,pz,hand}
export function carry (menu, o, cf) {
  cf = { bag: 6, cup: 6, pz: 2, hand: 3, ...(cf || {}) }
  let food = 0, cups = 0, pz = 0
  const one = (pk, mult) => { const it = itemOf(menu, pk && pk.id); if (!it) return; const q = (Number(pk.q) || 1) * (mult || 1); if (it.kind === 'drink') cups += q; else if (it.kind === 'pizza') pz += q; else food += q }
  for (const r of (o.rows || [])) for (const l of (r.lines || [])) { one(l); if (l.set) { if (l.side) one({ ...l.side, q: 1 }, Number(l.q) || 1); if (l.drink) one({ ...l.drink, q: 1 }, Number(l.q) || 1) } }
  for (const s of (o.shared || [])) one(s)
  const bags = Math.ceil(food / cf.bag), cupBags = Math.ceil(cups / cf.cup), stacks = Math.ceil(pz / cf.pz)
  const units = bags + cupBags + stacks
  return { food, cups, pz, bags, cupBags, stacks, units, people: Math.max(1, Math.ceil(units / cf.hand)), cf }
}
// 對不到最新菜單的文字 → 最接近的三個品項（給客人／店家點一下換掉）
export function overlap (a, b) { const A = new Set(String(a || '').replace(/\s/g, '')), B = new Set(String(b || '').replace(/\s/g, '')); if (!A.size || !B.size) return 0; let c = 0; for (const ch of A) if (B.has(ch)) c++; return c / Math.max(A.size, B.size) }
export function suggest (menu, text, n) { return flatItems(menu).filter(i => !i.soon).map(i => ({ i, s: overlap(text, i.name) })).sort((a, b) => b.s - a.s).slice(0, n || 3).filter(x => x.s > 0).map(x => x.i.id) }
// 整理（兩邊存前都走這裡：去掉不存在的 id、數量≥1、字串裁短；副餐／飲品只在套餐才留）
export function cleanPick (menu, pk) { if (!pk || typeof pk !== 'object' || !pk.id) return null; const it = itemOf(menu, pk.id); if (!it) return null; const o = { id: String(pk.id), note: String(pk.note || '').slice(0, 40) }; if (pk.q != null) o.q = Math.max(1, Math.min(99, Math.round(Number(pk.q) || 1))); if (pk.p != null) o.p = Number(pk.p) || 0; return o }
export function cleanLine (menu, l) {
  const it = itemOf(menu, l && l.id); if (!it) return null
  const set = !!(l.set && canSet(it))
  const side = set ? cleanPick(menu, l.side) : null, drink = set ? cleanPick(menu, l.drink) : null
  if (side && itemOf(menu, side.id).kind !== 'snack') return cleanLine(menu, { ...l, side: null })
  if (drink && itemOf(menu, drink.id).kind !== 'drink') return cleanLine(menu, { ...l, drink: null })
  const o = { id: it.id, q: Math.max(1, Math.min(99, Math.round(Number(l.q) || 1))), set, side, drink, note: String(l.note || '').slice(0, 60) }
  if (l.p != null) o.p = Number(l.p) || 0
  return o
}
export function cleanRow (menu, r) {
  r = r || {}
  const row = { pid: String(r.pid || '').slice(0, 40), uid: String(r.uid || '').slice(0, 60), src: r.src === 'line' ? 'line' : 'manual', pic: String(r.pic || '').slice(0, 300), name: String(r.name || '').slice(0, 30), done: !!r.done, at: r.at || null,
    lines: (Array.isArray(r.lines) ? r.lines : []).map(l => cleanLine(menu, l)).filter(Boolean).slice(0, 20),
    pend: (Array.isArray(r.pend) ? r.pend : []).slice(0, 8).map(p => ({ text: String((p && p.text) || '').slice(0, 60), q: Math.max(1, Math.round(Number(p && p.q) || 1)), note: String((p && p.note) || '').slice(0, 40), sug: suggest(menu, (p && p.text) || '') })).filter(p => p.text), note: String(r.note || '').slice(0, 80) }
  if (!row.pid) row.pid = 'p' + Math.random().toString(36).slice(2, 9)
  return row
}
export function cleanOrderBody (menu, b) { return { rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 150).map(r => cleanRow(menu, r)), shared: (Array.isArray(b.shared) ? b.shared : []).map(s => cleanPick(menu, { q: 1, ...s })).filter(Boolean).slice(0, 30) } }
// AI 拆文字的舊形（main/side/drink/extras/combo）→ 一道一道
export function fromLegacyRow (menu, r) {
  const lines = []
  if (r.main && r.main.id) lines.push({ id: r.main.id, q: r.main.q || 1, set: !!r.combo && canSet(itemOf(menu, r.main.id)), side: r.combo && r.side ? { id: r.side.id, note: r.side.note || '' } : null, drink: r.combo && r.drink ? { id: r.drink.id, note: r.drink.note || '' } : null, note: r.main.note || '' })
  const L0 = lines[0]
  if (r.side && r.side.id && !(L0 && L0.set && L0.side)) lines.push({ id: r.side.id, q: r.side.q || 1, set: false, side: null, drink: null, note: r.side.note || '' })
  if (r.drink && r.drink.id && !(L0 && L0.set && L0.drink)) lines.push({ id: r.drink.id, q: r.drink.q || 1, set: false, side: null, drink: null, note: r.drink.note || '' })
  for (const e of (r.extras || [])) if (e && e.id) lines.push({ id: e.id, q: e.q || 1, set: false, side: null, drink: null, note: e.note || '' })
  return cleanRow(menu, { name: r.name, src: 'manual', lines, pend: r.pend || [] })
}
export function labelOf (menu, pk) { const it = itemOf(menu, pk && pk.id); if (!it) return '（已下架）'; return it.name + (pk.note ? '・' + pk.note : '') + ((Number(pk.q) || 1) > 1 ? ' ×' + pk.q : '') }
export function lineLabel (menu, l) { const it = itemOf(menu, l && l.id); if (!it) return '（已下架）'; let s = it.name + (l.note ? '・' + l.note : ''); if (l.set) s += '【套餐】' + (l.side ? labelOf(menu, l.side) : '副餐未選') + '＋' + (l.drink ? labelOf(menu, l.drink) : '飲品未選'); if ((Number(l.q) || 1) > 1) s += ' ×' + l.q; return s }
export const STATUS = ['draft', 'sent', 'submitted', 'priced', 'confirmed', 'locked', 'done']
export const STATUS_LABEL = { draft: '建單', sent: '已發連結', submitted: '客人已送出', priced: '已核價', confirmed: '客人已確認', locked: '鎖單', done: '完成', void: '作廢' }
export const CUST_EDITABLE = ['draft', 'sent', 'submitted', 'priced']

const GOCALC = { normMenu, flatItems, itemOf, canSet, variantsOf, customOf, pickPrice, priceLine, priceRow, parseDisc, totals, carry, overlap, suggest, cleanPick, cleanLine, cleanRow, cleanOrderBody, fromLegacyRow, labelOf, lineLabel, STATUS, STATUS_LABEL, CUST_EDITABLE }
if (typeof window !== 'undefined') window.GOCALC = GOCALC
export default GOCALC
