// ── 產品與成本模組｜批次 3「食譜庫＋食譜詳情＋製作模式」後端（v4.70.34，2026-10-10）──
// 規格 docs/COST_MODULE_SPEC.md §4、計算規則（換算與產量／完整度／成本基準與歷史）。
//   ・備料食譜＝阿桑 /recipes 即時（190 份：材料、用量、成品量；沒有步驟／照片／影片）；出餐食譜＝在賣菜單的食譜行（阿桑尚未給端點 → 10-06 快照 menuLines，標「快照」）
//   ・本檔只存「我們補的」：版本（草稿／發布）、步驟（順序/標題/說明/媒體/計時/相關材料）、工作站、照片、成本快照（永不改寫）
//   ・行成本＝系統算（物料卡供應品 最近實際叫貨價 ÷ 已確認換算 × 用量），每行附完整換算鏈；半成品遞迴（≤5 層、擋循環）；耗損已在產量裡不再加
//   ・完整度：完整／缺價格／缺換算／缺產量／循環引用／超過深度／白名單外不計成本；子食譜缺口往上傳
import { loadSnap, loadMaster, norm, num, NOCOST_WHITELIST } from './_cost.js'
import { buildCards } from './_matcard.js'

export const RB_KEY = 'sp_finance_pm_recipebook'
export const RB_SNAP_KEY = 'sp_finance_pm_recipecost_snap'
const METRIC = { kg: ['g', 1000], 公斤: ['g', 1000], g: ['g', 1], 公克: ['g', 1], 克: ['g', 1], l: ['ml', 1000], 公升: ['ml', 1000], ml: ['ml', 1], 毫升: ['ml', 1], cc: ['ml', 1] }
const r2 = n => Math.round(n * 100) / 100, r4 = n => Math.round(n * 1e4) / 1e4
const nowIso = () => new Date().toISOString()
const uLow = u => String(u || '').trim().toLowerCase()
const isWhite = nm => NOCOST_WHITELIST.some(w => norm(w) === norm(nm))

// 兩個單位之間的倍率（1 from ＝ k to）：公制互換；相同字串＝1；其餘靠供應品換算
function metricK (from, to) {
  const a = METRIC[uLow(from)], b = METRIC[uLow(to)]
  if (uLow(from) === uLow(to)) return 1
  if (a && b && a[0] === b[0]) return a[1] / b[1]
  return null
}
// 供應品：1 叫貨單位 ＝ k 目標單位（優先已確認／公制，其次快照／建議＝「未確認」）
function supplyFactor (sup, toUnit) {
  const direct = metricK(sup.unit, toUnit); if (direct != null) return { k: direct, status: 'metric' }
  const pick = st => (sup.convs || []).find(c => !c.noconv && st.includes(c.status) && (uLow(c.to) === uLow(toUnit) || metricK(c.to, toUnit) != null))
  const c = pick(['confirmed', 'metric']) || pick(['snapshot', 'suggested'])
  if (!c) return null
  const k2 = metricK(c.to, toUnit) == null ? 1 : metricK(c.to, toUnit)
  return { k: c.factor * k2, status: c.status }
}
const supPrice = s => (s.lastConfirmed && s.lastConfirmed.p) || (s.lastOrder && s.lastOrder.p) || (num(s.price) > 0 ? s.price : null)
const supPriceSrc = s => s.lastConfirmed ? '已確認價' : (s.lastOrder ? '最近叫貨 ' + s.lastOrder.d : (num(s.price) > 0 ? '主檔現價' : ''))

export async function buildRecipes ({ kvGet, months, light }) {
  const snap = await loadSnap(kvGet)
  const [master, cards, rb0, snaps0, menuD] = await Promise.all([loadMaster(kvGet, snap), buildCards({ kvGet, months }), kvGet(RB_KEY), kvGet(RB_SNAP_KEY), kvGet('sp_finance_pm_boss_menu')])
  const rb = rb0 || { r: {}, log: [] }
  const snaps = snaps0 || {}
  const supBy = {} // code／sku → 供應品（A Beach 優先）
  for (const s of Object.values(cards.supplies)) { if (s.virtual) continue; const kc = (s.sys === 'GROUN:D' ? 'G|' : '') + norm(s.code); supBy[kc] = s; if (s.sku && !supBy[norm(s.sku)]) supBy[norm(s.sku)] = s; if (s.sys === 'A Beach' && !supBy[norm(s.code)]) supBy[norm(s.code)] = s }
  const cardOf = {}; for (const c of cards.cards) for (const k of c.supplies) cardOf[k] = c
  // 食譜主檔（即時）＋我們的版本
  const recipes = {}
  for (const r of master.recipes) {
    const key = r.code || ('id:' + r.id)
    const mine = rb.r[key] || {}
    const vers = (mine.versions || [])
    const pub = vers.filter(v => v.status === 'published').sort((a, b) => b.v - a.v)[0] || null
    const draft = vers.find(v => v.status === 'draft') || null
    const eff = pub && pub.items ? pub : null // 發布版可覆寫材料／產量；沒有＝用阿桑的
    recipes[key] = { key, id: r.id, code: r.code, name: r.name, type: 'prep', src: 'live', station: mine.station || '', photo: mine.photo || '', minutes: r.minutes,
      yieldQty: eff && eff.yieldQty ? eff.yieldQty : r.yieldQty, yieldUnit: eff && eff.yieldUnit ? eff.yieldUnit : r.yieldUnit,
      items: (eff ? eff.items : r.items).map(i => ({ ...i })), steps: (pub && pub.steps) || [], draft, pubV: pub ? pub.v : 0, nVersions: vers.length, updatedAt: r.updatedAt, liveItems: r.items, liveYield: { qty: r.yieldQty, unit: r.yieldUnit } }
  }
  for (const [key, mine] of Object.entries(rb.r)) { // 我們自建的食譜（阿桑系統沒有；GD 五款代表餐點／新品）
    if (!mine.own || recipes[key]) continue
    const vers = mine.versions || []
    const pub = vers.filter(v => v.status === 'published').sort((a, b) => b.v - a.v)[0] || null
    const draft = vers.find(v => v.status === 'draft') || null
    const eff = pub || draft || { items: [], yieldQty: 0, yieldUnit: '' }
    recipes[key] = { key, id: null, code: mine.own.code || key, name: mine.own.name, brand: mine.own.brand || 'GROUN:D', type: mine.own.type === 'dish' ? 'dish' : 'prep', src: 'own', station: mine.station || mine.own.station || '', photo: mine.photo || '', minutes: null,
      yieldQty: eff.yieldQty, yieldUnit: eff.yieldUnit, items: (eff.items || []).map(i => ({ ...i })), steps: (pub && pub.steps) || [], draft, pubV: pub ? pub.v : 0, nVersions: vers.length, updatedAt: mine.own.at || '', liveItems: [], liveYield: null, pendingContent: !pub || !(pub.items || []).length }
  }
  for (const rc of Object.values(recipes)) if (!rc.brand) rc.brand = 'A Beach'
  const byCode = {}; for (const rc of Object.values(recipes)) if (rc.code) byCode[norm(rc.code)] = rc
  const byName = {}; for (const rc of Object.values(recipes)) byName[norm(rc.name)] = rc
  // 成本遞迴
  const memo = {}
  function costOf (rc, stack) {
    if (memo[rc.key]) return memo[rc.key]
    if (stack.includes(rc.key)) return { status: 'cycle', total: 0, lines: [], gaps: ['循環引用：' + [...stack, rc.key].join(' → ')] }
    if (stack.length >= 5) return { status: 'depth', total: 0, lines: [], gaps: ['超過 5 層展開'] }
    const lines = [], gaps = []
    let total = 0, allOk = true
    for (const it of rc.items) {
      const L = { seq: it.seq, code: it.code || '', name: it.name, qty: it.qty, unit: it.unit, match: it.match, cost: null, status: 'ok', chain: '', kind: 'raw' }
      if (it.match === 'nonstock' || (!it.code && isWhite(it.name))) {
        if (isWhite(it.name)) { L.kind = 'zero'; L.cost = 0; L.chain = '白名單：不計成本'; lines.push(L); continue }
        L.status = 'nocost_unlisted'; L.chain = '標不計成本但不在白名單 → 進待處理'; allOk = false; gaps.push(`「${it.name}」白名單外不計成本`); lines.push(L); continue
      }
      const sup = it.code ? ((rc.brand === 'GROUN:D' ? supBy['G|' + norm(it.code)] : null) || supBy[norm(it.code)] || supBy['G|' + norm(it.code)] || null) : null
      const sub = it.code ? (byCode[norm(it.code)] || null) : (byName[norm(it.name)] && byName[norm(it.name)].key !== rc.key ? byName[norm(it.name)] : null)
      if (sup && !(sub && !sup.lastOrder && !(num(sup.price) > 0))) { // 叫貨品（若同時也是食譜且叫貨品沒價→當半成品）
        L.supplyKey = sup.key; L.supplier = sup.supplier; L.cardId = (cardOf[sup.key] || {}).id || ''
        const price = supPrice(sup)
        if (!price) { L.status = 'noprice'; L.chain = `${sup.code} 沒有有效價格`; allOk = false; gaps.push(`${it.name} 缺價格`); lines.push(L); continue }
        const f = supplyFactor(sup, it.unit)
        if (!f) { L.status = 'noconv'; L.chain = `1 ${sup.unit} ${price} 元 → 缺「${sup.unit} → ${it.unit}」換算`; allOk = false; gaps.push(`${it.name} 缺換算（${sup.unit}→${it.unit}）`); lines.push(L); continue }
        const per = price / f.k
        L.cost = r2(per * (num(it.qty) || 0)); L.per = r4(per); L.factor = r4(f.k); L.price = price; L.priceSrc = supPriceSrc(sup); L.supUnit = sup.unit; L.convStatus = f.status
        L.chain = `1 ${sup.unit} ${price} 元 → 1 ${sup.unit} = ${r4(f.k).toLocaleString()} ${it.unit} → ${r4(per)} 元/${it.unit} × ${it.qty} ${it.unit} = ${L.cost} 元`
        if (f.status === 'snapshot' || f.status === 'suggested') { L.status = 'conv_unconfirmed'; allOk = false; gaps.push(`${it.name} 換算未確認`) }
        total += L.cost; lines.push(L); continue
      }
      if (sub) { // 半成品：遞迴
        L.kind = 'sub'; L.subKey = sub.key
        const sc = costOf(sub, [...stack, rc.key])
        if (!sub.yieldQty) { L.status = 'noyield'; L.chain = `半成品「${sub.name}」沒有可用產量`; allOk = false; gaps.push(`${sub.name} 缺產量`); lines.push(L); continue }
        const k = metricK(sub.yieldUnit, it.unit) != null ? metricK(sub.yieldUnit, it.unit) : (uLow(sub.yieldUnit) === uLow(it.unit) ? 1 : null)
        if (k == null) { L.status = 'noconv'; L.chain = `半成品產量單位 ${sub.yieldUnit} 換不到 ${it.unit}`; allOk = false; gaps.push(`${sub.name} 產量單位 ${sub.yieldUnit}→${it.unit} 缺換算`); lines.push(L); continue }
        const per = sc.total / (sub.yieldQty * k) // 每 it.unit
        L.cost = r2(per * (num(it.qty) || 0)); L.per = r4(per); L.subStatus = sc.status
        L.chain = `半成品「${sub.name}」整批 ${r2(sc.total)} 元 ÷ 產量 ${sub.yieldQty} ${sub.yieldUnit} → ${r4(per)} 元/${it.unit} × ${it.qty} ${it.unit} = ${L.cost} 元${sc.status !== 'ok' ? '（子食譜不完整：' + sc.gaps.slice(0, 2).join('；') + '）' : ''}`
        if (sc.status !== 'ok') { L.status = 'sub_gap'; allOk = false; gaps.push(`子食譜「${sub.name}」：${sc.gaps[0] || '不完整'}`) }
        total += L.cost; lines.push(L); continue
      }
      L.status = 'nomatch'; L.chain = it.code ? `代碼 ${it.code} 在主檔／食譜都找不到` : '沒有料號，對不到物料'; allOk = false; gaps.push(`${it.name} 對不到物料`); lines.push(L)
    }
    let status = allOk ? 'ok' : 'gap'
    if (!rc.yieldQty) { status = 'gap'; gaps.unshift('缺產量') }
    const out = { status, total: r2(total), perUnit: rc.yieldQty ? r4(total / rc.yieldQty) : null, lines, gaps }
    memo[rc.key] = out; return out
  }
  const list = [], ownDishes = []
  for (const rc of Object.values(recipes)) {
    const c = costOf(rc, [])
    if (rc.src === 'own' && rc.type === 'dish') { const sn = (snaps[rc.key] || []); ownDishes.push({ ...rc, category: rc.station || '', price: null, abCost: null, cost: c.total, perUnit: c.total, status: !rc.items.length ? '待補配方' : (c.status === 'ok' ? '完整' : (c.gaps[0] || '不完整')), ok: c.status === 'ok' && rc.items.length > 0, gaps: c.gaps.slice(0, 6), lines: light ? undefined : c.lines, margin: null, content: { items: rc.items.length > 0, steps: (rc.steps || []).length > 0, photo: !!rc.photo }, snaps: light ? undefined : sn.slice(-40), lastSnap: sn.length ? sn[sn.length - 1] : null }); continue }
    const sn = (snaps[rc.key] || [])
    list.push({ ...rc, cost: c.total, perUnit: c.perUnit, status: !rc.items.length ? '待補配方' : (c.status === 'ok' ? '完整' : (c.status === 'cycle' ? '循環引用' : (c.status === 'depth' ? '超過深度' : (c.gaps[0] || '不完整')))), ok: c.status === 'ok' && rc.items.length > 0, gaps: c.gaps.slice(0, 6), lines: light ? undefined : c.lines,
      content: { items: rc.items.length > 0, steps: (rc.steps || []).length > 0, photo: !!rc.photo }, snaps: light ? undefined : sn.slice(-40), lastSnap: sn.length ? sn[sn.length - 1] : null })
  }
  // 出餐食譜（在賣 90 道）：快照菜單行 ＋ /costs/menu 售價；行成本用我們的引擎（代碼→供應品／半成品）
  const menuRows = Object.values((menuD || {}).rows || {})
  const menuBy = {}; for (const m of menuRows) menuBy[norm(m.name)] = m
  const dishes = {}
  for (const l of snap.menuLines) { if (!l.menu) continue; (dishes[l.menu] = dishes[l.menu] || { key: 'dish:' + l.menu, name: l.menu, type: 'dish', src: 'snapshot', category: l.cat || '', price: num(l.price), lines: [] }).lines.push(l) }
  const dishList = []
  for (const d of Object.values(dishes)) {
    const m = menuBy[norm(d.name)]
    if (m && m.is_active === false) continue // 停售不抓
    const mine = rb.r[d.key] || {}
    const pub = (mine.versions || []).filter(v => v.status === 'published').sort((a, b) => b.v - a.v)[0] || null
    const draft = (mine.versions || []).find(v => v.status === 'draft') || null
    const fake = { key: d.key, name: d.name, items: d.lines.map(l => ({ seq: num(l.idx) || 0, code: l.code || '', name: l.name, qty: num(l.qty), unit: l.unit, match: l.match === 'nonstock' ? 'nonstock' : (l.code ? 'matched' : 'unmatched') })), yieldQty: 1, yieldUnit: '份' }
    const c = costOf(fake, [])
    const sn = (snaps[d.key] || [])
    dishList.push({ key: d.key, name: d.name, type: 'dish', src: 'snapshot', category: d.category || (m && m.category) || '', price: (m && num(m.price)) || d.price, abCost: m ? num(m.cost) : num(d.lines[0] && d.lines[0].cost), abComplete: m ? !!m.cost_complete : null, station: mine.station || '', photo: mine.photo || '', items: fake.items, steps: (pub && pub.steps) || [], draft, pubV: pub ? pub.v : 0, nVersions: (mine.versions || []).length,
      cost: c.total, perUnit: c.total, status: c.status === 'ok' ? '完整' : (c.gaps[0] || '不完整'), ok: c.status === 'ok', gaps: c.gaps.slice(0, 6), lines: light ? undefined : c.lines, yieldQty: 1, yieldUnit: '份',
      margin: (c.status === 'ok' && (m && num(m.price) > 0)) ? r4((m.price - c.total) / m.price) : null, content: { items: fake.items.length > 0, steps: (pub && pub.steps || []).length > 0, photo: !!mine.photo }, snaps: light ? undefined : sn.slice(-40), lastSnap: sn.length ? sn[sn.length - 1] : null })
  }
  dishList.push(...ownDishes)
  list.sort((a, b) => (a.station || '~').localeCompare(b.station || '~') || a.name.localeCompare(b.name))
  dishList.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name))
  const stations = [...new Set(list.map(r => r.station).filter(Boolean))].sort()
  const cats = [...new Set(dishList.map(d => d.category).filter(Boolean))]
  return { recipes: list, dishes: dishList, stations, cats, live: master.live, masterUpdatedAt: master.updatedAt, snapAsOf: snap.asOf, nOk: list.filter(r => r.ok).length, log: (rb.log || []).slice(-60).reverse() }
}

// ── 成本快照：價格／換算／配方任一變動 → 每個對象寫一筆（永不改寫）＋差異行（哪一行、為什麼、變多少）──
export async function snapshotRecipeCosts ({ kvGet, kvPut, months }) {
  const t = await buildRecipes({ kvGet, months })
  const snaps = (await kvGet(RB_SNAP_KEY)) || {}
  const at = nowIso(); let changed = 0
  for (const r of [...t.recipes, ...t.dishes]) {
    const arr = snaps[r.key] = snaps[r.key] || []
    const last = arr[arr.length - 1]
    const lines = {}; for (const L of (r.lines || [])) lines[L.code || L.name] = { c: L.cost, p: L.price != null ? L.price : null, f: L.factor != null ? L.factor : null, q: L.qty, n: L.name }
    if (last && Math.abs((last.cost || 0) - (r.cost || 0)) < 0.005 && last.status === r.status) continue
    const diff = []
    if (last) {
      for (const [k, v] of Object.entries(lines)) {
        const o = (last.lines || {})[k]
        if (!o) { diff.push({ k, name: v.n, why: '新增材料', from: 0, to: v.c }); continue }
        if (Math.abs((o.c || 0) - (v.c || 0)) < 0.005) continue
        const why = (o.p != null && v.p != null && Math.abs(o.p - v.p) > 1e-9) ? `${v.n} ${o.p}→${v.p}` : (o.f != null && v.f != null && Math.abs(o.f - v.f) > 1e-9 ? `${v.n} 換算 ${o.f}→${v.f}` : (o.q !== v.q ? `${v.n} 用量 ${o.q}→${v.q}` : `${v.n} 子食譜／價格變動`))
        diff.push({ k, name: v.n, why, from: o.c, to: v.c })
      }
      for (const k of Object.keys(last.lines || {})) if (!lines[k]) diff.push({ k, name: (last.lines[k] || {}).n, why: '移除材料', from: (last.lines[k] || {}).c, to: 0 })
    }
    arr.push({ at, cost: r.cost, perUnit: r.perUnit, status: r.status, ok: r.ok, lines, diff: diff.slice(0, 20), v: r.pubV || 0 })
    if (arr.length > 60) arr.splice(0, arr.length - 60)
    changed++
  }
  if (changed) await kvPut(RB_SNAP_KEY, snaps, '食譜成本快照 ' + changed + ' 筆')
  return { changed, total: t.recipes.length + t.dishes.length }
}

// ── 寫：工作站／照片／草稿／編輯草稿／發布（檢查）／捨棄 ──
export async function applyRecipeOp ({ kvGet, kvPut, who, body, uploadPrivate, months }) {
  const doc = (await kvGet(RB_KEY)) || { r: {}, log: [] }
  doc.r = doc.r || {}; doc.log = doc.log || []
  const key = String(body.key || ''); if (!key) return { ok: false, error: '缺食譜 key' }
  const R = doc.r[key] = doc.r[key] || { versions: [] }
  R.versions = R.versions || []
  const at = nowIso(), op = String(body.op || '')
  const log = o => { doc.log.push({ at, by: who.name, op, key, ...o }); if (doc.log.length > 800) doc.log = doc.log.slice(-800) }
  const save = async msg => { await kvPut(RB_KEY, doc, msg + '(' + who.name + ')'); return { ok: true } }
  const cleanSteps = steps => (Array.isArray(steps) ? steps : []).slice(0, 60).map((s, i) => ({ seq: i + 1, title: String(s.title || '').slice(0, 80), desc: String(s.desc || '').slice(0, 1500), media: (Array.isArray(s.media) ? s.media : []).slice(0, 6).map(m => String(m).slice(0, 300)), timerSec: Math.max(0, Math.min(86400, Number(s.timerSec) || 0)), itemCodes: (Array.isArray(s.itemCodes) ? s.itemCodes : []).slice(0, 30).map(x => String(x).slice(0, 40)) }))
  const cleanItems = items => (Array.isArray(items) ? items : []).slice(0, 80).map((i, n) => ({ seq: n, code: String(i.code || '').slice(0, 40), name: String(i.name || '').slice(0, 80), qty: Number(i.qty) || 0, unit: String(i.unit || '').slice(0, 10), match: i.match || (i.code ? 'matched' : (isWhite(i.name) ? 'nonstock' : 'unmatched')) }))
  if (op === 'create') { // 自建食譜（批次 4：GD 五款代表餐點／新品）；不生成假配方，材料由人填
    const name = String(body.name || '').trim().slice(0, 80); if (!name) return { ok: false, error: '要填名稱' }
    if (R.own || R.versions.length) return { ok: false, error: '這個 key 已存在' }
    R.own = { name, brand: body.brand === 'A Beach' ? 'A Beach' : 'GROUN:D', type: body.type === 'dish' ? 'dish' : 'prep', station: String(body.station || '').slice(0, 30), code: String(body.code || '').slice(0, 40), by: who.name, at }
    R.station = R.own.station
    R.versions.push({ v: 1, status: 'draft', items: cleanItems(body.items), yieldQty: Number(body.yieldQty) || (R.own.type === 'dish' ? 1 : 0), yieldUnit: String(body.yieldUnit || (R.own.type === 'dish' ? '份' : '')).slice(0, 10), steps: [], by: who.name, at, note: String(body.note || '').slice(0, 300) })
    log({ name, brand: R.own.brand, type: R.own.type }); await kvPut(RB_KEY, doc, '新增食譜(' + who.name + ')'); return { ok: true, key }
  }
  if (op === 'rename') { if (!R.own) return { ok: false, error: '只能改自建食譜的名稱' }; const before = R.own.name; R.own.name = String(body.name || '').trim().slice(0, 80) || R.own.name; log({ before, after: R.own.name }); return save('食譜改名') }
  if (op === 'meta') { const before = { station: R.station, type: R.type }; if (body.station != null) R.station = String(body.station).slice(0, 30); log({ before, station: R.station }); return save('食譜工作站') }
  if (op === 'photo' || op === 'media') {
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(body.dataUrl || '')); if (!m) return { ok: false, error: '只能上傳圖片（影片請貼連結）' }
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 4 * 1024 * 1024) return { ok: false, error: '圖片太大（前端會壓到 1200px）' }
    const path = `recipe/${key.replace(/[^a-z0-9_:|~-]/gi, '_')}/${Date.now().toString(36)}.jpg`
    if (!(await uploadPrivate(path, buf, m[1]))) return { ok: false, error: '上傳失敗' }
    if (op === 'photo') { R.photo = path; log({ photo: path }); await kvPut(RB_KEY, doc, '食譜照片(' + who.name + ')'); return { ok: true, path } }
    return { ok: true, path } // 步驟媒體：前端把 path 放進草稿 steps[].media 再存
  }
  if (op === 'draft') { // 從目前有效版本複製一份草稿（同時只允許一份草稿）
    if (R.versions.some(v => v.status === 'draft')) return { ok: false, error: '已經有一份草稿了' }
    const pub = R.versions.filter(v => v.status === 'published').sort((a, b) => b.v - a.v)[0]
    const v = (R.versions.reduce((m, x) => Math.max(m, x.v), 0) || 0) + 1
    const base = body.base || {}
    R.versions.push({ v, status: 'draft', items: cleanItems(pub && pub.items ? pub.items : base.items), yieldQty: Number(pub && pub.yieldQty ? pub.yieldQty : base.yieldQty) || 0, yieldUnit: String(pub && pub.yieldUnit ? pub.yieldUnit : base.yieldUnit || '').slice(0, 10), steps: cleanSteps(pub ? pub.steps : []), by: who.name, at, note: '' })
    log({ v }); await kvPut(RB_KEY, doc, '食譜草稿(' + who.name + ')'); return { ok: true, v }
  }
  const vObj = R.versions.find(x => x.v === Number(body.v))
  if (op === 'edit') { // 只能改草稿（兩人同時編輯：帶 baseAt 比對，不同就擋）
    if (!vObj || vObj.status !== 'draft') return { ok: false, error: '只能編輯草稿（發布版請先建新草稿）' }
    if (body.baseAt && vObj.editedAt && body.baseAt !== vObj.editedAt) return { ok: false, error: '這份草稿剛被 ' + (vObj.editedBy || '別人') + ' 改過，請重新整理再編輯（避免互相覆蓋）' }
    if (body.items) vObj.items = cleanItems(body.items)
    if (body.steps) vObj.steps = cleanSteps(body.steps)
    if (body.yieldQty != null) vObj.yieldQty = Number(body.yieldQty) || 0
    if (body.yieldUnit != null) vObj.yieldUnit = String(body.yieldUnit).slice(0, 10)
    if (body.note != null) vObj.note = String(body.note).slice(0, 300)
    vObj.editedAt = at; vObj.editedBy = who.name
    log({ v: vObj.v, fields: Object.keys(body).filter(k => ['items', 'steps', 'yieldQty', 'yieldUnit', 'note'].includes(k)) })
    await kvPut(RB_KEY, doc, '食譜草稿編輯(' + who.name + ')'); return { ok: true, editedAt: at }
  }
  if (op === 'discard') { if (!vObj || vObj.status !== 'draft') return { ok: false, error: '只能捨棄草稿' }; R.versions = R.versions.filter(x => x !== vObj); log({ v: vObj.v }); return save('食譜捨棄草稿') }
  if (op === 'publish') { // 發布前檢查：材料可解析、產量 > 0、無循環引用
    if (!vObj || vObj.status !== 'draft') return { ok: false, error: '只能發布草稿' }
    const t = await buildRecipes({ kvGet, months, light: true })
    const known = new Set(); for (const r of t.recipes) { if (r.code) known.add(norm(r.code)); for (const it of r.liveItems || []) if (it.code) known.add(norm(it.code)) }
    const cards = await buildCards({ kvGet, months }); for (const s of Object.values(cards.supplies)) { known.add(norm(s.code)); if (s.sku) known.add(norm(s.sku)) }
    const bad = (vObj.items || []).filter(i => !(i.code && known.has(norm(i.code))) && !(i.match === 'nonstock' && isWhite(i.name)))
    if (key.startsWith('dish:') ? false : !(vObj.yieldQty > 0)) return { ok: false, error: '產量必須 > 0' }
    if (bad.length) return { ok: false, error: '這些材料對不到物料／食譜：' + bad.map(b => b.name || b.code).join('、') }
    if (!(vObj.items || []).length && !key.startsWith('dish:')) return { ok: false, error: '沒有材料不能發布' }
    // 循環：這份草稿的材料若引用了「會引用回自己」的食譜
    const codeOf = {}; for (const r of t.recipes) if (r.code) codeOf[norm(r.code)] = r
    const myCode = norm((t.recipes.find(r => r.key === key) || {}).code || '')
    const seen = new Set(); const stack = (vObj.items || []).map(i => norm(i.code)).filter(Boolean)
    while (stack.length) { const c = stack.pop(); if (!c || seen.has(c)) continue; seen.add(c); if (myCode && c === myCode) return { ok: false, error: '循環引用：這份食譜的材料最後會引用回自己' }; const r = codeOf[c]; if (r) for (const it of (r.items || [])) if (it.code) stack.push(norm(it.code)) }
    vObj.status = 'published'; vObj.publishedAt = at; vObj.publishedBy = who.name
    log({ v: vObj.v }); await kvPut(RB_KEY, doc, '食譜發布 v' + vObj.v + '(' + who.name + ')'); return { ok: true }
  }
  return { ok: false, error: '不認得的操作' }
}
