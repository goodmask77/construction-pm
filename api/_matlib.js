// 物料庫 F08（GD v4.71.89 從 mail-sync ?matlib／?matcat／?matord 原樣抽出；abgd 新殼逐字共用同一份）
// buildMatlib／buildMatord：只讀（阿桑叫貨明細 boss_ordi_／單頭 boss_ord_、GD 的 gops gord_／gordi_、分類 boss_matcat）
// applyMatcat：改分類文件（回 { error } 或 null）；呼叫端負責讀寫與權限
export const MATCAT_KEY = 'sp_finance_pm_boss_matcat'

export async function buildMatlib ({ kvGet }) {
  const todayM = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const mosM = (() => { const out = []; const d = new Date(todayM.slice(0, 7) + '-01T00:00:00Z'); for (let i = 0; i < 13; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1) } return out })()
  const [ordiDocs, catDoc] = await Promise.all([
    Promise.all(mosM.map(m => kvGet('sp_finance_pm_boss_ordi_' + m.replace('-', '')))),
    kvGet('sp_finance_pm_boss_matcat'),
  ])
  const catD = catDoc || { cats: [], map: {} }
  const d30M = (() => { const d = new Date(todayM + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 29); return d.toISOString().slice(0, 10) })()
  const normM = s => String(s || '').replace(/\s+/g, '').trim()
  const items = {}, vend = {}, byMonth = {}
  let rowCount = 0
  for (const doc of ordiDocs) {
    for (const r of Object.values((doc || {}).rows || {})) {
      const nm = r.name || r.item || ''
      if (!nm) continue
      const date = String(r.ordered_at || r.created_at || '').slice(0, 10)
      if (date.length < 10) continue
      const key = normM(r.code) ? ('c:' + normM(r.code)) : ('n:' + normM(nm))
      const price = (r.price == null || r.price === '' || !(Number(r.price) > 0)) ? null : Number(r.price) // v4.70.31 口徑統一：單價 0／空＝不知道價格（同規格與 _cost.js）
      const qty = Number(r.qty) || 0
      const amt = (r.amount == null || r.amount === '') ? (price != null ? price * qty : null) : Number(r.amount)
      const supplier = (r.supplier || '').trim() || '（未填廠商）'
      const status = r.order_status || r.status || ''
      const appr = status === 'approved'
      rowCount++
      const o = items[key] || (items[key] = { key, name: nm, code: r.code || '', unit: r.unit || '', suppliers: {}, recs: [], qty30: 0, amt30: 0, n30: 0 })
      o.name = nm; if (r.unit) o.unit = r.unit
      o.suppliers[supplier] = (o.suppliers[supplier] || 0) + 1
      o.recs.push({ d: date, s: supplier, q: qty, u: r.unit || '', p: price, a: amt == null ? null : Math.round(amt), st: status, oid: r.order_id || '' })
      if (date >= d30M && appr) { o.qty30 += qty; if (amt != null) o.amt30 += amt; o.n30++ }
      const v = vend[supplier] || (vend[supplier] = { name: supplier, amt30: 0, n30: 0, items: {}, last: '' })
      v.items[key] = 1; if (date > v.last) v.last = date
      if (date >= d30M && appr) { v.amt30 += (amt || 0); v.n30++ }
      if (appr && amt != null) byMonth[date.slice(0, 7)] = (byMonth[date.slice(0, 7)] || 0) + amt
    }
  }
  const itemsOut = Object.values(items).map(o => {
    o.recs.sort((a, b) => (a.d < b.d ? -1 : (a.d > b.d ? 1 : 0)))
    const priced = o.recs.filter(r => r.p != null && r.st === 'approved')
    const first = priced[0], last = priced[priced.length - 1]
    const prices = priced.map(r => r.p)
    const lastP = last ? last.p : null, firstP = first ? first.p : null
    return {
      key: o.key, name: o.name, code: o.code, unit: o.unit, cat: catD.map[o.key] || '',
      suppliers: Object.keys(o.suppliers),
      lastPrice: lastP, lastDate: (o.recs[o.recs.length - 1] || {}).d || '',
      firstPrice: firstP,
      pctChg: (firstP && lastP != null && priced.length > 1) ? Math.round((lastP - firstP) / firstP * 1000) / 10 : null,
      minP: prices.length ? Math.min(...prices) : null, maxP: prices.length ? Math.max(...prices) : null,
      qty30: Math.round(o.qty30 * 10) / 10, amt30: Math.round(o.amt30), n30: o.n30, nRec: o.recs.length,
      series: priced.map(r => ({ d: r.d, p: r.p, s: r.s })).slice(-80),
      recs: o.recs.slice(-80),
    }
  }).sort((a, b) => b.amt30 - a.amt30)
  const vendorsOut = Object.values(vend).map(v => ({ name: v.name, cat: (catD.vmap || {})[v.name] || '', amt30: Math.round(v.amt30), n30: v.n30, nItems: Object.keys(v.items).length, last: v.last })).sort((a, b) => b.amt30 - a.amt30)
  return {
    items: itemsOut, vendors: vendorsOut, cats: catD.cats || [], vcats: catD.vcats || [],
    byMonth, months: mosM.slice().reverse(),
    updatedAt: (ordiDocs.find(Boolean) || {}).updatedAt || null, rows: rowCount,
  }
}

export function applyMatcat (doc, bm) {
  // 鍵名檢查（abgd 物料庫搬家）：不收物件原型名稱、控制字元、過長（避免把 map 寫壞）
  const badK = k => typeof k !== 'string' || !k || k.length > 120 || /[\u0000-\u001f\u007f]/.test(k) || k === '__proto__' || Object.prototype.hasOwnProperty.call(Object.prototype, k)
  if (bm.op === 'setcat' && (Array.isArray(bm.keys) ? bm.keys : [bm.key]).some(k => k && badK(String(k)))) return { error: '品項代碼格式不對' }
  doc.cats = doc.cats || []; doc.map = doc.map || {}; doc.vcats = doc.vcats || []; doc.vmap = doc.vmap || {}
  const isV = bm.kind === 'vendor' // kind=vendor → 操作廠商分類(vcats/vmap)；預設物料分類(cats/map)
  const C = isV ? 'vcats' : 'cats', M = isV ? 'vmap' : 'map'
  const op = bm.op
  if (op === 'addcat') { const nm = String(bm.name || '').trim().slice(0, 20); if (!nm) return { error: '分類名稱空白' }; if (!doc[C].includes(nm)) doc[C].push(nm) }
  else if (op === 'delcat') { doc[C] = doc[C].filter(c => c !== bm.name); for (const k of Object.keys(doc[M])) if (doc[M][k] === bm.name) delete doc[M][k] }
  else if (op === 'rencat') { const nm = String(bm.to || '').trim().slice(0, 20); if (!nm) return { error: '新名稱空白' }; doc[C] = doc[C].map(c => (c === bm.name ? nm : c)); for (const k of Object.keys(doc[M])) if (doc[M][k] === bm.name) doc[M][k] = nm }
  else if (op === 'setcat') { const keys = Array.isArray(bm.keys) ? bm.keys : [bm.key]; for (const k of keys) { if (!k) continue; if (bm.cat) doc[M][k] = String(bm.cat).slice(0, 20); else delete doc[M][k] } }
  else if (op === 'order') { if (Array.isArray(bm.cats)) doc[C] = bm.cats.filter(c => typeof c === 'string').slice(0, 50) }
  else return { error: '未知操作' }
  return null
}

export async function buildMatord ({ kvGet }) {
  const todayO = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const mosO = (() => { const out = []; const d = new Date(todayO.slice(0, 7) + '-01T00:00:00Z'); for (let i = 0; i < 13; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1) } return out })()
  const tpeDay = s => { const t = Date.parse(String(s || '')); return isNaN(t) ? '' : new Date(t + 8 * 3600e3).toISOString().slice(0, 10) }
  // v4.70.42 兩店都列（張良 2026-10-11 問 DD「GD 10 月叫貨單」才發現這頁也只有 AB）：store=AB（阿桑 OPS ord/ordi）／GD（gops gord/gordi）
  const [ordDocs, ordiDocs, gordDocs, gordiDocs] = await Promise.all([
    Promise.all(mosO.map(m => kvGet('sp_finance_pm_boss_ord_' + m.replace('-', '')))),
    Promise.all(mosO.map(m => kvGet('sp_finance_pm_boss_ordi_' + m.replace('-', '')))),
    Promise.all(mosO.map(m => kvGet('sp_finance_pm_boss_gord_' + m.replace('-', '')))),
    Promise.all(mosO.map(m => kvGet('sp_finance_pm_boss_gordi_' + m.replace('-', '')))),
  ])
  const orders = {}
  for (const [store, docs] of [['AB', ordDocs], ['GD', gordDocs]]) for (const doc of docs) for (const r of Object.values((doc || {}).rows || {})) {
    if (!r.order_id) continue
    orders[store + ':' + r.order_id] = { id: store + ':' + r.order_id, store, date: tpeDay(r.created_at), supplier: (r.supplier || '').trim() || '（未填廠商）', dept: r.dept || '', status: r.status || '', total: Number(r.total_amount) || 0, lineCount: Number(r.line_count) || 0, unpriced: Number(r.unpriced_lines) || 0, items: [] }
  }
  for (const [store, docs] of [['AB', ordiDocs], ['GD', gordiDocs]]) for (const doc of docs) for (const r of Object.values((doc || {}).rows || {})) {
    const oid0 = r.order_id; if (!oid0) continue
    const oid = store + ':' + oid0
    let o = orders[oid]
    if (!o) o = orders[oid] = { id: oid, store, date: tpeDay(r.ordered_at), supplier: (r.supplier || '').trim() || '（未填廠商）', dept: r.dept || '', status: r.order_status || '', total: 0, lineCount: 0, unpriced: 0, items: [], _fi: 1 } // 單頭缺→用明細補一張
    o.items.push({ name: r.name || r.item || '', code: r.code || '', qty: Number(r.qty) || 0, unit: r.unit || '', price: (r.price == null || r.price === '') ? null : Number(r.price), amount: (r.amount == null || r.amount === '') ? null : Math.round(Number(r.amount)), st: r.order_status || '' })
    if (o._fi) { o.total += (Number(r.amount) || 0); o.lineCount = o.items.length }
  }
  const outO = Object.values(orders).map(o => { delete o._fi; o.total = Math.round(o.total); return o }).sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)))
  return { orders: outO, months: mosO.slice().reverse(), updatedAt: (ordDocs.find(Boolean) || {}).updatedAt || null }
}
