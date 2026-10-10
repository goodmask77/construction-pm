// ── 產品與成本模組｜批次 1「偵錯與待處理中心」後端（v4.70.31，2026-10-10）──
// 規格：docs/COST_MODULE_SPEC.md（唯一來源）。原則：只拿阿桑的原始資料（boss-api → KV 月檔），規則用我們自己的。
//   ・價格序列＝A Beach 叫貨明細 sp_finance_pm_boss_ordi_YYYYMM（approved/received、排除補單 is_backfill、單價 0/空、數量 ≤0；同單同料加權平均）
//   ・10/06 快照（阿桑 xlsx）只當「驗收基準」＋補 boss-api 尚未開通的主檔（產品現價／換算／食譜行／菜單行／資料品質），畫面一律標「快照 10-06」
//   ・偵測只「標記＋建議」，不改任何金額；決定（確認／更正／單位／靜音…）全部留紀錄在 sp_finance_pm_cost_todo
// 不在這裡 import mail-sync（避免循環），kvGet/kvPut 由呼叫端傳進來。

const SNAP_SHEETS = ['products', 'suppliers', 'recipes', 'recipeLines', 'menu', 'menuLines', 'quality', 'priceLog', 'sameName']
const TODO_KEY = 'sp_finance_pm_cost_todo'
const NOCOST_WHITELIST = ['水', '生飲水', '純淨水', '熱水', '溫水', '冰塊', '碎冰'] // 決策 #6：系統定案不計成本
const DEFAULT_CFG = { thr: { default: 50, veg: 80, tight: 30 }, catRules: { veg: '蔬|果|菜|農產', tight: '起司|乾貨|包材|耗材|乳' } } // 門檻 %（管理者可改）

const norm = s => String(s || '').replace(/\s+/g, '').trim()
const tpeDay = s => { const t = Date.parse(String(s || '')); return isNaN(t) ? '' : new Date(t + 8 * 3600e3).toISOString().slice(0, 10) }
const r2 = n => Math.round(n * 100) / 100
const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }
const num = v => (v == null || v === '' ? null : (isNaN(Number(v)) ? null : Number(v)))

export const snapKey = sheet => 'sp_finance_pm_cost_snap_' + sheet
export { SNAP_SHEETS, TODO_KEY }

// ── 讀快照（全部一次撈；沒灌過就是空）──
async function loadSnap (kvGet) {
  const docs = await Promise.all(SNAP_SHEETS.map(s => kvGet(snapKey(s))))
  const out = {}
  SNAP_SHEETS.forEach((s, i) => { out[s] = (docs[i] || {}).rows || [] })
  out.asOf = (docs.find(d => d && d.asOf) || {}).asOf || null
  return out
}

// ── A Beach 叫貨序列：廠商 × 物料 → [{d, p, q, oid}]（每張單一點）──
async function loadSeries (kvGet, months) {
  const docs = await Promise.all(months.map(m => kvGet('sp_finance_pm_boss_ordi_' + m.replace('-', ''))))
  const per = {} // key → { supplier, code, name, unit, orders: {oid:{d, amt, qty}} }
  let firstDay = ''
  for (const doc of docs) for (const r of Object.values((doc || {}).rows || {})) {
    const st = r.order_status || r.status || ''
    if (!(st === 'approved' || st === 'received')) continue
    if (r.is_backfill) continue
    const p = num(r.price), q = num(r.qty)
    if (p == null || p <= 0 || q == null || q <= 0) continue
    const d = tpeDay(r.ordered_at || r.created_at); if (!d) continue
    if (!firstDay || d < firstDay) firstDay = d
    const supplier = (r.supplier || '').trim() || '（未填廠商）'
    const code = norm(r.code), nm = r.name || r.item || ''
    const key = supplier + '|' + (code ? 'c:' + code : 'n:' + norm(nm))
    const o = per[key] || (per[key] = { key, supplier, code, sku: r.sku || '', name: nm, unit: r.unit || '', orders: {} })
    if (r.unit) o.unit = r.unit
    const od = o.orders[r.order_id || (d + '#' + p)] || (o.orders[r.order_id || (d + '#' + p)] = { d, amt: 0, qty: 0, lines: [] })
    od.amt += p * q; od.qty += q; od.lines.push({ p, q, u: r.unit || '' })
  }
  const series = Object.values(per).map(o => {
    const pts = Object.entries(o.orders).map(([oid, x]) => ({ oid, d: x.d, p: r2(x.amt / x.qty), q: r2(x.qty), lines: x.lines })).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
    return { ...o, orders: undefined, pts }
  })
  return { series, firstDay }
}

// ── 門檻：依物料分類（matcat 自訂分類 → 關鍵字）──
function thrOf (cfg, catName) {
  const c = String(catName || '')
  try { if (c && new RegExp(cfg.catRules.veg).test(c)) return cfg.thr.veg } catch (_) {}
  try { if (c && new RegExp(cfg.catRules.tight).test(c)) return cfg.thr.tight } catch (_) {}
  return cfg.thr.default
}
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-9)
const seq = pts => pts.map(x => x.d.slice(5) + ':' + x.p).join(' → ')

// ── 影響面（快照）：代碼 → 直接用到的在賣菜單行、經半成品間接用到的菜單 ──
function buildImpact (snap) {
  const byCode = {}, recipeByProduct = {}, recipeLinesByCode = {}, menuLinesByName = {}
  const prodBySku = {}, prodByCode = {}
  for (const p of snap.products) { if (p.sku) prodBySku[norm(p.sku)] = p; if (p.code) prodByCode[norm(p.code)] = p }
  for (const l of snap.menuLines) { // 菜單食譜逐行：代碼多半是 sku（PCD001 披薩麵團）或叫貨代碼
    if (!l.menu) continue
    const c = norm(l.code)
    if (c) (byCode[c] = byCode[c] || []).push(l)
    const nm = norm(l.name); if (nm) (menuLinesByName[nm] = menuLinesByName[nm] || []).push(l)
  }
  for (const r of snap.recipes) { recipeByProduct[norm(r.name)] = r }
  for (const l of snap.recipeLines) { const c = norm(l.code); if (c) (recipeLinesByCode[c] = recipeLinesByCode[c] || []).push(l) }
  // 代碼可能同時以 sku 或 code 出現在食譜/菜單行 → 兩種都查
  const aliases = code => { const s = new Set([norm(code)]); const p = prodByCode[norm(code)] || prodBySku[norm(code)]; if (p) { if (p.sku) s.add(norm(p.sku)); if (p.code) s.add(norm(p.code)) } return [...s].filter(Boolean) }
  // 回：{menus:[{menu, perServing}], recipes:[name], perServingTotal}；ratio = 新價/舊價 − 1
  return function impact (code, ratio) {
    const menus = {}, recipes = new Set()
    for (const a of aliases(code)) {
      for (const l of (byCode[a] || [])) { const lc = num(l.lineCost) || 0; menus[l.menu] = (menus[l.menu] || 0) + lc * ratio }
      for (const rl of (recipeLinesByCode[a] || [])) {
        recipes.add(rl.recipe)
        const rec = recipeByProduct[norm(rl.recipe)]; const yieldQ = num(rec && rec.yieldQty) || 0
        const lc = num(rl.lineCost) || 0
        if (!yieldQ) continue
        for (const ml of (menuLinesByName[norm(rl.recipe)] || [])) { const useQ = num(ml.qty) || 0; menus[ml.menu] = (menus[ml.menu] || 0) + lc * ratio * (useQ / yieldQ) }
      }
    }
    const list = Object.entries(menus).map(([menu, perServing]) => ({ menu, perServing: r2(perServing) })).sort((a, b) => Math.abs(b.perServing) - Math.abs(a.perServing))
    return { menus: list.slice(0, 12), recipes: [...recipes].slice(0, 12), nMenus: list.length, perServing: list.length ? Math.abs(list[0].perServing) : 0, total: r2(list.reduce((s, x) => s + Math.abs(x.perServing), 0)) } // perServing=影響最大那一道的每份金額
  }
}

// ── 掃描：價格序列 → 待處理項目 ──
function scanSeries (series, firstDay, cfg, catMap, impact) {
  const out = []
  const openWeekEnd = firstDay ? new Date(Date.parse(firstDay + 'T00:00:00Z') + 7 * 864e5).toISOString().slice(0, 10) : ''
  // 跨廠商：同品名其他廠商同期（±14 天）同方向變動 → 真的變價，降級資訊
  const byName = {}
  for (const s of series) (byName[norm(s.name)] = byName[norm(s.name)] || []).push(s)
  const crossMoved = (s, d, dir) => (byName[norm(s.name)] || []).some(o => o.supplier !== s.supplier && o.pts.some((p, i) => i > 0 && Math.abs(Date.parse(p.d) - Date.parse(d)) <= 14 * 864e5 && Math.sign(p.p - o.pts[i - 1].p) === dir && Math.abs(p.p - o.pts[i - 1].p) / o.pts[i - 1].p >= 0.1))

  for (const s of series) {
    const pts = s.pts
    if (pts.length < 2) continue
    const cat = catMap[s.code ? 'c:' + s.code : 'n:' + norm(s.name)] || ''
    const thr = thrOf(cfg, cat) / 100
    const base = { itemKey: s.key, supplier: s.supplier, code: s.code, sku: s.sku, name: s.name, unit: s.unit, cat, thr: Math.round(thr * 100), series: pts.slice(-8).map(p => ({ d: p.d, p: p.p, q: p.q })) }
    const push = (tab, signal, d, title, basis, ratio, extra) => {
      const imp = impact(s.code || s.name, ratio)
      out.push({ id: hash([tab, signal, s.key, d].join('|')), tab, signal, date: d, title, basis, ...base, impact: imp, ...extra })
    }
    // 開帳週錯價：首價落在上線首週、之後再沒出現過
    const first = pts[0]
    const openWeek = openWeekEnd && first.d <= openWeekEnd && !pts.slice(1).some(p => near(p.p, first.p, 0.05))
    const stats = openWeek ? pts.slice(1) : pts
    // 交替（兩個價位來回跳 ≥2 次）→ 一碼多單位
    const levels = []
    for (const p of pts) { const L = levels.find(l => near(l.p, p.p, 0.08)); if (L) L.n++; else levels.push({ p: p.p, n: 1 }) }
    if (levels.length === 2 && pts.length >= 4) {
      let alt = 0; for (let i = 1; i < pts.length; i++) if (!near(pts[i].p, pts[i - 1].p, 0.08)) alt++
      const hi = Math.max(levels[0].p, levels[1].p), lo = Math.min(levels[0].p, levels[1].p)
      if (alt >= 3 && hi / lo >= 1.5) {
        const k = hi / lo, intK = Math.round(k)
        push('unit', 'alternate', pts[pts.length - 1].d, `${lo} ↔ ${hi} 來回跳 ${alt} 次`, `單位：${s.unit}；序列：${seq(pts.slice(-6))}${near(k, intK, 0.05) ? `；倍率 ≈ ${intK} 倍，疑似一碼兩種單位（箱／公斤之類）` : ''}`, 0, { suggest: '拆料號（兩種單位各一個）或登記換算' })
        continue // 交替已涵蓋，不再逐段報
      }
    }
    // 逐段看相鄰變動
    for (let i = 1; i < stats.length; i++) {
      const a = stats[i - 1].p, b = stats[i].p, d = stats[i].d
      if (a <= 0) continue
      const k = b / a, chg = Math.abs(k - 1)
      if (chg < thr && !(near(k, 10, 0.05) || near(k, 0.1, 0.05))) continue
      const dir = Math.sign(b - a)
      const next = stats[i + 1]
      const backToA = next && near(next.p, a, 0.1)
      const intK = Math.round(k >= 1 ? k : 1 / k)
      const isInt = intK >= 2 && intK <= 12 && near(k >= 1 ? k : 1 / k, intK, 0.03)
      // 打錯一位數：跟前一點差 10 倍，或「這一點 ×10／÷10 剛好等於下一點」（140→12→120：12 才是錯的那個）
      const isDigit = near(k, 10, 0.05) || near(k, 0.1, 0.05) || (next && (near(next.p, b * 10, 0.05) || near(next.p, b / 10, 0.05)) && chg >= 0.5)
      // 金額守恆：同單內 單價×N 且 數量÷N
      const conserve = (() => { const pa = pts.find(x => x.d === stats[i - 1].d), pb = pts.find(x => x.d === d); if (!pa || !pb) return false; return near(pa.p * pa.q, pb.p * pb.q, 0.02) && !near(pa.q, pb.q, 0.02) })()
      const sig = isDigit ? 'digit' : (conserve ? 'conserve' : (isInt ? 'intmul' : (backToA ? 'spike' : 'step')))
      if (sig === 'digit') { push('price', 'digit', d, `${a} → ${b}${next ? ` → ${next.p}` : ''}，剛好差一位數`, `疑似少打／多打一個 0；序列：${seq(pts.slice(Math.max(0, i - 2), i + 3))}`, 0, { suggest: '更正金額（對送貨單）', amtSuggest: next && (near(next.p, b * 10, 0.05) ? b * 10 : (near(next.p, b / 10, 0.05) ? b / 10 : null)) }); if (next && (near(next.p, b * 10, 0.05) || near(next.p, b / 10, 0.05))) i++; continue }
      if (sig === 'conserve') { push('unit', 'conserve', d, `單價 ×${intK || r2(k)}、數量 ÷${intK || r2(k)}，整行金額不變`, `單位混用，付的錢沒錯；序列：${seq(pts.slice(Math.max(0, i - 2), i + 3))}`, 0, { suggest: '登記換算或拆料號' }); continue }
      if (sig === 'intmul') { push('unit', 'intmul', d, `${a} → ${b}${backToA ? ` → ${next.p}` : ''}，剛好 ${intK} 倍${backToA ? '、又跳回來' : ''}`, `整數倍跳動多半是單位混用（整箱／散裝）；序列：${seq(pts.slice(Math.max(0, i - 2), i + 3))}`, 0, { suggest: '查該行數量是否也差 ' + intK + ' 倍（例：0.5 箱）' }); if (backToA) i++; continue }
      if (sig === 'spike') { push('price', 'spike', d, `${a} → ${b} → ${next.p}，跳一次又回來`, `單點尖峰（A→B→A），多半是打錯或單位混用；超過門檻 ±${Math.round(thr * 100)}%`, k - 1, { suggest: '確認正確或更正金額', once: true }); i++; continue }
      // 階梯：沒回來
      const cross = crossMoved(s, d, dir)
      push('price', cross ? 'step-cross' : 'step', d, `${a} → ${b}（${dir > 0 ? '+' : ''}${Math.round((k - 1) * 100)}%）${cross ? '，其他廠商同期也變' : ''}`, `${cross ? '跨廠商同向變動 → 真的變價（資訊）' : '階梯式變價、之後沒回來 → 可能是真的變價'}；門檻 ±${Math.round(thr * 100)}%；序列：${seq(pts.slice(Math.max(0, i - 2), i + 3))}`, k - 1, { suggest: cross ? '確認正確' : '確認正確（真的變價）或更正', info: cross })
    }
    // 累計漂移：單段都沒過門檻，但 60 天內最低→最新 ≥ 門檻 或 高低差 ≥2 倍（資訊級，例：美生菜 125→250 慢慢爬）
    const lastPt = pts[pts.length - 1]
    const win = stats.filter(p => Date.parse(lastPt.d) - Date.parse(p.d) <= 60 * 864e5)
    if (win.length >= 3) {
      const lo = Math.min(...win.map(p => p.p)), hi = Math.max(...win.map(p => p.p))
      const drift = lastPt.p / lo - 1
      if ((drift >= thr || hi / lo >= 2) && !out.some(o => o.itemKey === s.key && o.tab === 'price' && !o.info)) push('price', 'drift', lastPt.d, `60 天內 ${lo} → ${lastPt.p}（累計 ${drift >= 0 ? '+' : ''}${Math.round(drift * 100)}%）`, `每一段都沒過門檻，但累計變動大${crossMoved(s, lastPt.d, 1) ? '；其他廠商同期也漲 → 真的變價' : ''}；序列：${seq(pts.slice(-6))}`, drift, { suggest: '確認正確（真的變價）', info: true })
    }
    if (openWeek) push('price', 'openweek', first.d, `首價 ${first.p} 只出現在開帳首週`, `之後都是 ${pts[1].p} 左右 → 疑似開帳初始價錯誤，建議從統計排除；序列：${seq(pts.slice(0, 4))}`, 0, { suggest: '排除這筆不進價格統計', info: true })
  }
  return out
}

// ── 快照衍生的待處理（資料缺口／合併建議／單位待確認／現價 vs 最後叫貨）──
function scanSnapshot (snap, impact) {
  const out = []
  const push = (tab, signal, key, title, basis, extra) => out.push({ id: hash([tab, signal, key].join('|')), tab, signal, date: snap.asOf || '', title, basis, fromSnap: true, ...extra })
  const specG = s => { // 「1000g/罐」「1kg * 10塊/箱」「5K*4包/件」「200g*5盒」→ 總量（g 或 ml）
    const t = String(s || '').replace(/，/g, ',').replace(/×/g, '*').replace(/[xX]\s*(\d)/g, '*$1')
    const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|k|g|l|ml|公斤|公克|毫升|公升)(?![a-z])/i); if (!m) return null
    const v = Number(m[1]); const u = m[2].toLowerCase()
    const mult = (t.slice(m.index + m[0].length).match(/^\s*\*\s*(\d+(?:\.\d+)?)/) || [])[1]
    const f = mult ? Number(mult) : 1
    return { g: (u === 'kg' || u === 'k' || u === '公斤') ? v * 1000 * f : (u === 'g' || u === '公克') ? v * f : null, ml: (u === 'l' || u === '公升') ? v * 1000 * f : (u === 'ml' || u === '毫升') ? v * f : null } }
  for (const p of snap.products) {
    const key = (p.sys || '') + '|' + (p.code || p.sku || p.name)
    const conv = String(p.conv || '')
    const base = { supplier: p.supplier || '', code: p.code || '', sku: p.sku || '', name: p.name || '', unit: p.unit || '', sys: p.sys || '', active: p.status === '啟用' }
    // 1:1 假設：換算同時有 g 與 ml 且數值相同
    const mg = conv.match(/g=(\d+(?:\.\d+)?)/), mml = conv.match(/ml=(\d+(?:\.\d+)?)/)
    if (mg && mml && mg[1] === mml[1] && base.active) push('unit', 'gml11', key, `換算 g=${mg[1]}; ml=${mml[1]} 是 1:1 假設`, '決策 #14：g 與 ml 不可預設 1:1，要實測密度（可批次確認「密度 ≈1」）', { ...base, suggest: '手動輸入實測換算或確認密度 ≈1', info: true, impact: impact(p.code || p.sku, 0) })
    // 規格文字 vs 換算不符（1000g/包 但 g=500）
    const sg = specG(p.spec)
    if (sg && base.active) { const g = sg.g != null ? sg.g : sg.ml; const mm = sg.g != null ? mg : mml; if (mm && g && !near(Number(mm[1]), g, 0.02)) push('unit', 'specmismatch', key, `規格「${p.spec}」但換算 ${sg.g != null ? 'g' : 'ml'}=${mm[1]}`, '規格文字解析出的量與登記換算不符', { ...base, suggest: `接受建議換算 ${sg.g != null ? 'g' : 'ml'}=${g}`, suggestConv: g, impact: impact(p.code || p.sku, 0) }) }
    // 現價 vs 最後叫貨價 差 ≥2 倍
    const cur = num(p.price), last = num(p.lastPrice)
    if (cur && last && (cur / last >= 2 || last / cur >= 2)) push('price', 'curvslast', key, `現價 ${cur} vs 最後叫貨價 ${last}（${p.lastDate || ''}）`, '目前叫貨單價與最後一次叫貨單價差 2 倍以上（快照 10-06）', { ...base, suggest: '確認哪個才對、更正現價或單位', impact: impact(p.code || p.sku, cur / last - 1) })
  }
  // 資料品質清單（阿桑 7.x）→ 資料缺口／合併建議／單位待確認
  const mergeGroups = {}
  const nameOf = {}; for (const p of snap.products) { if (p.code) nameOf[norm(p.code)] = p.name; if (p.sku && !nameOf[norm(p.sku)]) nameOf[norm(p.sku)] = p.name }
  for (const q of snap.quality) {
    if (!q.name && (q.code || q.sku)) q.name = nameOf[norm(q.code || q.sku)] || q.code || q.sku
    const cat = String(q.cat || '')
    const k = (q.code || q.sku || q.name) + '|' + (q.supplier || '')
    const base = { supplier: q.supplier || '', code: q.code || '', sku: q.sku || '', name: q.name || '', status: q.status || '', note: q.note || '', srcCat: cat.slice(0, 60) }
    if (/^7\.4/.test(cat)) { const g = (cat.includes('GROUN') ? 'G|' : 'A|') + norm(q.name); (mergeGroups[g] = mergeGroups[g] || { sys: cat.includes('GROUN') ? 'GROUN:D' : 'A Beach', name: q.name, rows: [] }).rows.push(base); continue }
    if (/^7\.3\b|^7\.3 /.test(cat)) { push('unit', 'noconv', k, `${q.name} 缺單位換算`, q.note || '庫存單位非公制、item_convs 沒登記、也不在 item_no_conv', { ...base, suggest: '接受建議換算／手動輸入／不需換算(填原因)', impact: impact(q.code || q.sku, 0) }); continue }
    if (/^7\.3b/.test(cat)) { push('gap', 'noinv', k, `${q.name} 沒有庫存資料`, '啟用叫貨品 inventory_items 無此代碼 → 沒有最小單位', { ...base, suggest: '補庫存資料', impact: impact(q.code || q.sku, 0) }); continue }
    if (/^7\.2/.test(cat)) { if (!/啟用/.test(cat) && q.status && q.status !== '啟用') continue; push('gap', 'noprice', k, `${q.name} 無單價或 0`, cat.includes('GROUN') ? 'GROUN:D 單價空白或 0' : 'A Beach 啟用中但無單價或 0', { ...base, suggest: '補價格', impact: impact(q.code || q.sku, 0) }); continue }
    if (/^7\.1b|^7\.1c/.test(cat)) { if (q.status && q.status !== '啟用') continue; push('gap', 'nosku', k, `${q.name} 沒有料號`, cat.includes('GROUN') ? 'GROUN:D 啟用品沒有料號' : 'A Beach 啟用品沒有料號', { ...base, suggest: '補料號', impact: impact(q.code || q.sku, 0) }); continue }
    if (/^7\.5/.test(cat)) { push('gap', 'inactiveused', k, `停用品「${q.name}」仍被啟用食譜／在賣菜單使用`, q.note || '', { ...base, suggest: '指定替代料', impact: impact(q.code || q.sku, 0) }); continue }
    if (/^7\.6b/.test(cat)) { push('gap', 'nocode', k + '|' + hash(q.note || ''), `食譜／菜單行「${q.name}」沒有料號`, q.note || '非 nonstock，成本算不到', { ...base, suggest: '對到物料' }); continue }
    if (/^7\.9/.test(cat)) { push('gap', 'incomplete', k, `食譜「${q.name}」成本不完整`, q.note || '有缺行（缺價或缺換算）', { ...base, suggest: '補上游缺口後自動解決' }); continue }
    if (/^7\.7c/.test(cat)) { push('price', 'pricelog', k + '|' + hash(q.note || ''), `改價紀錄：${q.name}`, q.note || '', { ...base, suggest: '確認正確或更正', info: true }); continue }
  }
  for (const [g, grp] of Object.entries(mergeGroups)) push('merge', 'samename', g, `${grp.name}：${grp.rows.length} 個代碼同名`, grp.rows.map(r => `${r.code || r.sku}（${r.supplier || '—'}${r.status ? '・' + r.status : ''}）`).join('、'), { sys: grp.sys, name: grp.name, rows: grp.rows, suggest: '合併進同一張物料卡（批次 2 生效）或標「不是同一物」' })
  // 白名單外的「不計成本」
  const seen = new Set()
  for (const l of snap.recipeLines) {
    if (!/不計/.test(String(l.status || ''))) continue
    const nm = norm(l.name); if (!nm || NOCOST_WHITELIST.some(w => norm(w) === nm)) continue
    if (seen.has(nm)) continue; seen.add(nm)
    const users = snap.recipeLines.filter(x => norm(x.name) === nm && /不計/.test(String(x.status || ''))).map(x => x.recipe)
    push('gap', 'nocost', nm, `「${l.name}」被標為不計成本，但不在白名單`, `用在：${[...new Set(users)].join('、')}；白名單只有 ${NOCOST_WHITELIST.join('/')}`, { name: l.name, suggest: '改接半成品食譜，或確認不計成本（填原因）' })
  }
  return out
}

// ── 主入口：產生待處理清單＋套用決定／靜音 ──
export async function buildTodo ({ kvGet, months }) {
  const [snap, ser, todoDoc, catDoc] = await Promise.all([loadSnap(kvGet), loadSeries(kvGet, months), kvGet(TODO_KEY), kvGet('sp_finance_pm_boss_matcat')])
  const todo = todoDoc || { dec: {}, mutes: {}, cfg: DEFAULT_CFG, log: [] }
  const cfg = { ...DEFAULT_CFG, ...(todo.cfg || {}), thr: { ...DEFAULT_CFG.thr, ...((todo.cfg || {}).thr || {}) }, catRules: { ...DEFAULT_CFG.catRules, ...((todo.cfg || {}).catRules || {}) } }
  const impact = buildImpact(snap)
  const items = [...scanSeries(ser.series, ser.firstDay, cfg, (catDoc || {}).map || {}, impact), ...scanSnapshot(snap, impact)]
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  // 價格異常被判「是單位問題」→ 轉到單位待確認（新 id，原筆算已處理）
  for (const it of items.slice()) { const d = todo.dec[it.id]; if (d && d.st === 'unit' && it.tab === 'price') items.push({ ...it, id: it.id + ':u', tab: 'unit', signal: 'fromprice', title: '（由價格異常轉入）' + it.title, suggest: '登記換算或拆料號', info: false }) }
  for (const it of items) {
    const d = todo.dec[it.id]
    it.decision = d || null
    const mk = it.itemKey || ((it.supplier || '') + '|' + (it.code ? 'c:' + it.code : 'n:' + norm(it.name)))
    it.muteKey = mk
    const mutes = (todo.mutes[mk] || []).filter(m => !m.off && (m.scope === 'rule' ? (m.signal === it.signal || m.signal === '*') : (m.scope === 'days' ? m.until >= today : false)))
    it.muted = mutes.length ? mutes[0] : null
    it.open = !d && !it.muted
  }
  // 排序：影響在賣菜的優先 → 每份影響金額 → 日期新
  items.sort((a, b) => (!!a.info - !!b.info) || ((b.impact || {}).nMenus > 0) - ((a.impact || {}).nMenus > 0) || Math.abs((b.impact || {}).perServing || 0) - Math.abs((a.impact || {}).perServing || 0) || (b.date > a.date ? 1 : -1))
  const mutes = []
  for (const [mk, arr] of Object.entries(todo.mutes || {})) arr.forEach((m, idx) => { if (!m.off) mutes.push({ ...m, muteKey: mk, idx }) })
  const counts = {}
  for (const it of items) if (it.open) counts[it.tab] = (counts[it.tab] || 0) + 1
  counts.muted = Object.values(todo.mutes).reduce((s, arr) => s + arr.filter(m => !m.off).length, 0)
  counts.done = items.filter(it => it.decision).length
  counts.total = Object.values(counts).reduce((s, n) => s + n, 0) - counts.muted - counts.done
  return { items, counts, mutes, cfg, snapAsOf: snap.asOf, seriesFrom: ser.firstDay, nSeries: ser.series.length, log: (todo.log || []).slice(-50).reverse(), hasSnap: snap.products.length > 0 }
}

// ── 寫決定：POST {op:'decide'|'mute'|'unmute'|'cfg', ...} ──
export async function applyDecision ({ kvGet, kvPut, who, body }) {
  const doc = (await kvGet(TODO_KEY)) || { dec: {}, mutes: {}, cfg: DEFAULT_CFG, log: [] }
  doc.dec = doc.dec || {}; doc.mutes = doc.mutes || {}; doc.log = doc.log || []
  const at = new Date().toISOString()
  const op = String(body.op || '')
  const logIt = (o) => { doc.log.push({ at, by: who.name, ...o }); if (doc.log.length > 500) doc.log = doc.log.slice(-500) }
  if (op === 'decide') {
    const id = String(body.id || ''); if (!id) return { ok: false, error: '缺 id' }
    const st = String(body.st || '') // ok=確認正確 fix=更正金額 unit=轉單位待確認 conv=修正換算 split=拆料號 exclude=排除統計 merge=合併 nomerge=不是同一物 fill=補資料 alt=指定替代料 nocost=標不計成本 noconv=不需換算
    if (!st) return { ok: false, error: '缺決定' }
    const needReason = ['exclude', 'nocost', 'noconv', 'nomerge'].includes(st)
    if (needReason && !String(body.reason || '').trim()) return { ok: false, error: '這個決定要填原因' }
    doc.dec[id] = { st, by: who.name, at, reason: String(body.reason || '').slice(0, 300), amt: num(body.amt), note: String(body.note || '').slice(0, 300), title: String(body.title || '').slice(0, 120) }
    logIt({ op: 'decide', id, st, title: body.title, reason: body.reason, amt: num(body.amt) })
    // 「這一筆已確認」= 預設只關這次（id 綁日期，之後再偏離新基準會是新 id）
    if (body.scope === 'days' || body.scope === 'rule') {
      const mk = String(body.muteKey || ''); if (!mk) return { ok: false, error: '缺 muteKey' }
      if (body.scope === 'rule' && !String(body.reason || '').trim()) return { ok: false, error: '永久靜音要填原因' }
      const until = body.scope === 'days' ? new Date(Date.now() + (Math.min(365, Math.max(1, Number(body.days) || 30))) * 864e5 + 8 * 3600e3).toISOString().slice(0, 10) : null
      ;(doc.mutes[mk] = doc.mutes[mk] || []).push({ scope: body.scope, until, signal: body.scope === 'rule' ? String(body.signal || '*') : null, by: who.name, at, reason: String(body.reason || '').slice(0, 300), name: String(body.name || ''), supplier: String(body.supplier || '') })
      logIt({ op: 'mute', muteKey: mk, scope: body.scope, until, signal: body.signal, name: body.name })
    }
  } else if (op === 'undo') {
    const id = String(body.id || ''); if (!doc.dec[id]) return { ok: false, error: '沒有這筆決定' }
    logIt({ op: 'undo', id, prev: doc.dec[id] }); delete doc.dec[id]
  } else if (op === 'unmute') {
    const mk = String(body.muteKey || ''), idx = Number(body.idx)
    const m = (doc.mutes[mk] || [])[idx]; if (!m) return { ok: false, error: '沒有這筆靜音' }
    m.off = true; m.offBy = who.name; m.offAt = at
    logIt({ op: 'unmute', muteKey: mk, name: m.name })
  } else if (op === 'cfg') {
    const t = body.thr || {}
    doc.cfg = { ...DEFAULT_CFG, ...(doc.cfg || {}) }
    doc.cfg.thr = { default: Math.min(500, Math.max(5, Number(t.default) || DEFAULT_CFG.thr.default)), veg: Math.min(500, Math.max(5, Number(t.veg) || DEFAULT_CFG.thr.veg)), tight: Math.min(500, Math.max(5, Number(t.tight) || DEFAULT_CFG.thr.tight)) }
    if (body.catRules && typeof body.catRules === 'object') { for (const k of ['veg', 'tight']) if (typeof body.catRules[k] === 'string') { try { new RegExp(body.catRules[k]); doc.cfg.catRules[k] = body.catRules[k].slice(0, 120) } catch (_) {} } }
    logIt({ op: 'cfg', thr: doc.cfg.thr, catRules: doc.cfg.catRules })
  } else return { ok: false, error: '不認得的操作' }
  await kvPut(TODO_KEY, doc, '成本待處理(' + who.name + ')')
  return { ok: true }
}

// ── 快照入庫（本機 scripts/cost-snap-ingest.mjs 分 sheet POST）──
export async function putSnapshot ({ kvPut, sheet, rows, asOf }) {
  if (!SNAP_SHEETS.includes(sheet)) return { ok: false, error: '不認得的 sheet：' + sheet }
  if (!Array.isArray(rows)) return { ok: false, error: 'rows 要是陣列' }
  await kvPut(snapKey(sheet), { rows, asOf: String(asOf || ''), n: rows.length, importedAt: new Date().toISOString() }, '成本快照 ' + sheet)
  return { ok: true, sheet, n: rows.length }
}
