// ── GD 每日銷量預測引擎 P1（張良 2026-09-25 規格定案「開工」）──
// 照最終版規格：全店層級（星期比例×水準×成長×全店校正係數）→ 佔比分配到品項（largest remainder 湊整）。
// 固定參數（FC_DEF，可被 sp_finance_pm_fc_cfg 覆寫）；只做全店校正係數，不做品項係數、不自動調參（第二版再說）。
// P1 尚無輸入 UI：特殊日/賣完/人工調整先當空集合，規格對應的排除條件都寫好、資料進來即生效。
// 資料口徑＝品項明細同一套：alias 合併後 key、pm_pos_hidden 排除；正常營業日＝週一~五且有日結資料（GD 週末公休；沒紀錄≠銷量0，直接不參與）。

export const FC_DEF = {
  wWeeks: 6,          // 星期幾比例回看有效週數
  wDecay: 0.8,        // 週權重衰減
  shrinkK: 4,         // 比例向 1 收斂強度：(n×r+K)/(n+K)
  levelDays: 7,       // 水準視窗（正常營業日）
  growthBeta: 0.5,    // 成長修正係數
  growthCap: [0.85, 1.15],
  calibDays: 28,      // 校正係數視窗（有快照+實績的正常日）
  calibK: 14,         // 校正收斂：1+(R-1)*n/(n+K)
  calibCap: [0.85, 1.15],
  shareDays: 14,      // 品項佔比視窗
  shareDaysFB: 28,    // 有售天數不足時退回
  minSoldDays: 7,
  futureDays: 7,      // 預測未來幾個營業日
  validWeekPct: 0.7,  // 有效週門檻（該週正常日 ≥ 預定營業日×70%，且 ≥3）
  closedWd: [0, 6],   // 固定公休（GD 週六日）
  selloutPct: 0.2,    // 賣完排除門檻（校正）
}

const iso = (d) => d.toISOString().slice(0, 10)
const wdOf = (ds) => new Date(ds + 'T00:00:00Z').getUTCDay()
const addD = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const mondayOf = (ds) => addD(ds, -((wdOf(ds) + 6) % 7))
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v))
const r2 = (v) => Math.round(v * 100) / 100
const r3 = (v) => Math.round(v * 1000) / 1000

// 載近 ~13 週 GD 品項日銷（kvGet 由呼叫端傳入）：回 { days:[{date,wd,total,items:{k:qty}}]升冪, names:{k:顯示名} }
export async function fcLoadData(kvGet, todayISO) {
  const from = addD(todayISO, -92)
  const months = [...new Set([from.slice(0, 7), addD(todayISO, -60).slice(0, 7), addD(todayISO, -30).slice(0, 7), todayISO.slice(0, 7)])]
  const [posDoc, aliasDoc, hiddenDoc, ...dDocs] = await Promise.all([
    kvGet('sp_finance_pm_pos'), kvGet('sp_finance_pm_pos_alias'), kvGet('sp_finance_pm_pos_hidden'),
    ...months.map(m => kvGet('sp_finance_pm_pos_d_' + m)),
  ])
  const aliasMap = ((aliasDoc || {}).ground) || {}
  const hidden = ((hiddenDoc || {}).ground) || {}
  const isGround = (s) => /groun/i.test(String(s || ''))
  // 正常營業日候選＝pm_pos 有 GD 日結（盤中 intraday 今天的那筆不算完整日）
  const okDates = new Set(((posDoc || {}).entries || []).filter(e => isGround(e.store) && e.revenue > 0 && !e.intraday && e.date >= from && e.date < todayISO).map(e => e.date))
  const det = {}
  for (const doc of dDocs) for (const [k, v] of Object.entries((doc || {}).days || {})) if (k.endsWith('::ground')) det[k.slice(0, 10)] = v
  const GD_SKIP = new Set(['財務工具箱', '財務工具', '現場工具箱', '保存期限工具箱', '套餐', '總結'])
  const names = {}
  const days = []
  for (const date of [...okDates].sort()) {
    const secs = ((det[date] || {}).sheets || {})['總銷售額 (以類別分類)']
    if (!Array.isArray(secs)) continue
    const items = {}
    let total = 0
    for (const s of secs) {
      if (GD_SKIP.has(s.title)) continue
      for (const r of (s.rows || [])) {
        if (!Array.isArray(r) || typeof r[0] !== 'string' || /^1\/4/.test(r[0].trim())) continue
        let k = String(r[0]); k = aliasMap[k] || k
        if (hidden[k]) continue
        const q = Number(r[1]) || 0
        if (q <= 0) continue
        items[k] = (items[k] || 0) + q
        names[k] = r[0]
        total += q
      }
    }
    if (total > 0) days.push({ date, wd: wdOf(date), total, items })
  }
  return { days, names }
}

// 主計算：data=fcLoadData 結果、snaps=[{date,preCalStore,actualStore,selloutPre,anyLow}]（校正用歷史快照）、special=Set(特殊日)
export function fcCompute(data, snaps, cfg, todayISO) {
  const C = { ...FC_DEF, ...(cfg || {}) }
  const openWd = [1, 2, 3, 4, 5].filter(w => !C.closedWd.includes(w))
  const special = new Set((cfg && cfg.special) || [])
  const normal = data.days.filter(d => openWd.includes(d.wd) && !special.has(d.date)) // 正常營業日（升冪）
  const notes = []

  // ── 1) 星期幾比例 ──
  const thisMon = mondayOf(todayISO)
  const byWeek = {}
  normal.forEach(d => { const wk = mondayOf(d.date); if (wk < thisMon) (byWeek[wk] = byWeek[wk] || []).push(d) })
  const needDays = Math.max(3, Math.ceil(openWd.length * C.validWeekPct))
  const weeks = Object.entries(byWeek).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, C.wWeeks) // 新→舊
  const acc = {} // wd -> {sw, w, n}
  const weekMeta = []
  weeks.forEach(([wk, ds], k) => {
    const valid = ds.length >= needDays
    weekMeta.push({ week: wk, days: ds.length, valid })
    if (!valid) return
    const avg = ds.reduce((t, d) => t + d.total, 0) / ds.length
    const w = Math.pow(C.wDecay, k)
    ds.forEach(d => { const a = acc[d.wd] = acc[d.wd] || { sw: 0, w: 0, n: 0 }; a.sw += (d.total / avg) * w; a.w += w; a.n++ })
  })
  let ratios = {}
  openWd.forEach(wd => {
    const a = acc[wd]
    const raw = a && a.w ? a.sw / a.w : 1
    const n = a ? a.n : 0
    ratios[wd] = (n * raw + C.shrinkK) / (n + C.shrinkK) // 向 1 收斂
    if (!n) notes.push(`週${'日一二三四五六'[wd]}無有效樣本→比例=1`)
  })
  const rMean = openWd.reduce((t, wd) => t + ratios[wd], 0) / openWd.length
  openWd.forEach(wd => { ratios[wd] = r3(ratios[wd] / rMean) }) // 正規化：營業日平均=1

  // ── 2) 水準（去星期效應）──
  const deW = (d) => d.total / (ratios[d.wd] || 1)
  const last7 = normal.slice(-C.levelDays)
  let level = last7.length ? last7.reduce((t, d) => t + deW(d), 0) / last7.length : 0
  if (last7.length < C.levelDays) notes.push(`水準樣本只有 ${last7.length} 天（資料不足）`)

  // ── 3) 成長修正 ──
  let growth = 1, growthRate = null
  const prev7 = normal.slice(-C.levelDays * 2, -C.levelDays)
  if (last7.length >= C.levelDays && prev7.length >= C.levelDays) {
    const a = last7.reduce((t, d) => t + deW(d), 0) / last7.length
    const b = prev7.reduce((t, d) => t + deW(d), 0) / prev7.length
    if (b > 0) { growthRate = a / b - 1; growth = clamp(1 + C.growthBeta * growthRate, C.growthCap) }
  } else notes.push('正常營業日 <14 天→成長修正=1')

  // ── 4) 全店校正係數（吃快照：分母=校正前預測；賣完截斷日排除）──
  let calib = 1, calibMeta = { n: 0, R: null, excluded: [] }
  const usable = (snaps || []).filter(s => s.actualStore != null && s.preCalStore > 0 && !special.has(s.date))
    .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, C.calibDays)
  const kept = []
  usable.forEach(s => {
    if ((s.selloutPre || 0) >= s.preCalStore * C.selloutPct && s.actualStore < s.preCalStore) { calibMeta.excluded.push({ date: s.date, why: '賣完截斷' }); return }
    kept.push(s)
  })
  if (kept.length) {
    const R = kept.reduce((t, s) => t + s.actualStore, 0) / kept.reduce((t, s) => t + s.preCalStore, 0)
    calib = clamp(1 + (R - 1) * kept.length / (kept.length + C.calibK), C.calibCap)
    calibMeta = { ...calibMeta, n: kept.length, R: r3(R) }
  } else notes.push('尚無快照實績→校正係數=1（累積 28 天才滿速）')

  // ── 5) 未來 N 個營業日全店預測（同一組水準/成長/係數，不逐日複利）──
  const future = []
  let cur = todayISO
  while (future.length < C.futureDays) {
    if (openWd.includes(wdOf(cur)) && !special.has(cur)) {
      const ratio = ratios[wdOf(cur)] || 1
      const preCal = level * ratio * growth
      future.push({ date: cur, wd: wdOf(cur), ratio, preCal: Math.round(preCal), sys: Math.round(preCal * calib) })
    }
    cur = addD(cur, 1)
  }

  // ── 6) 品項佔比（近14正常日；有售天數<7 退28天）＋整數分配（largest remainder，加總=全店整數）──
  const shareOf = (win) => {
    const ds = normal.slice(-win)
    const sum = {}, sold = {}
    let tot = 0
    ds.forEach(d => { for (const [k, q] of Object.entries(d.items)) { sum[k] = (sum[k] || 0) + q; sold[k] = (sold[k] || 0) + 1; tot += q } })
    return { sum, sold, tot, days: ds.length }
  }
  const s14 = shareOf(C.shareDays), s28 = shareOf(C.shareDaysFB)
  const keys = [...new Set([...Object.keys(s14.sum), ...Object.keys(s28.sum)])]
  let shares = keys.map(k => {
    const use28 = (s14.sold[k] || 0) < C.minSoldDays
    const src = use28 ? s28 : s14
    return { k, n: data.names[k] || k, share: src.tot ? (src.sum[k] || 0) / src.tot : 0, win: use28 ? C.shareDaysFB : C.shareDays, sold14: s14.sold[k] || 0 }
  }).filter(s => s.share > 0)
  const shareSum = shares.reduce((t, s) => t + s.share, 0) || 1
  shares.forEach(s => { s.share = s.share / shareSum }) // 正規化=100%
  shares.sort((a, b) => b.share - a.share)
  const allocate = (storeInt) => { // largest remainder：品項整數加總=全店整數
    const raw = shares.map(s => ({ k: s.k, v: storeInt * s.share }))
    const base = raw.map(x => ({ k: x.k, i: Math.floor(x.v), f: x.v - Math.floor(x.v) }))
    let left = storeInt - base.reduce((t, x) => t + x.i, 0)
    base.sort((a, b) => b.f - a.f)
    for (let i = 0; i < base.length && left > 0; i++, left--) base[i].i++
    return Object.fromEntries(base.map(x => [x.k, x.i]))
  }
  const futureItems = future.map(f => ({ date: f.date, items: allocate(f.sys) }))

  // ── 7) 舊法 baseline（現行備料卡口徑＝該星期幾截尾平均，品項層級；對照組）──
  const tmean = (vals) => { if (!vals.length) return 0; let a = [...vals].sort((x, y) => x - y); if (a.length >= 8) a = a.slice(1, -1); return a.reduce((t, v) => t + v, 0) / a.length }
  const last30 = normal.slice(-30)
  const baseItems = {} // k -> wd -> val
  keys.forEach(k => { baseItems[k] = {}; openWd.forEach(wd => { baseItems[k][wd] = r2(tmean(last30.filter(d => d.wd === wd).map(d => d.items[k] || 0))) }) })
  const baseStoreByWd = {}
  openWd.forEach(wd => { baseStoreByWd[wd] = Math.round(keys.reduce((t, k) => t + (baseItems[k][wd] || 0), 0)) })

  return {
    params: C, notes, weekMeta, ratios, level: Math.round(level), growth: r3(growth), growthRate: growthRate != null ? r3(growthRate) : null,
    calib: r3(calib), calibMeta, future, shares: shares.map(s => ({ ...s, share: r3(s.share) })), futureItems, baseItems, baseStoreByWd,
    normalDays: normal.length, dataFrom: normal[0] ? normal[0].date : null, dataTo: normal.length ? normal[normal.length - 1].date : null,
  }
}

// 每日快照＋實績回填（joya-intraday 11:00 順路跑；鎖定後預測欄不可改寫）
export async function fcDaily(kvGet, kvPut, todayISO) {
  const cfg = (await kvGet('sp_finance_pm_fc_cfg')) || {}
  const C = { ...FC_DEF, ...cfg }
  const mkey = (ds) => 'sp_finance_pm_fc_' + ds.slice(0, 7).replace('-', '')
  const months = [...new Set([mkey(addD(todayISO, -35)), mkey(todayISO)])]
  const docs = {}
  for (const m of months) docs[m] = (await kvGet(m)) || { days: {} }
  const allSnap = Object.assign({}, ...Object.values(docs).map(d => d.days))
  const data = await fcLoadData(kvGet, todayISO)
  // 實績回填（只補 actual，不動預測欄）
  const byDate = Object.fromEntries(data.days.map(d => [d.date, d]))
  const touched = new Set()
  for (const [ds, snap] of Object.entries(allSnap)) {
    if (snap.actual == null && byDate[ds]) { snap.actual = { total: byDate[ds].total, items: byDate[ds].items }; touched.add(mkey(ds)) }
  }
  const snaps = Object.entries(allSnap).map(([ds, s]) => ({ date: ds, preCalStore: s.preCalStore, actualStore: s.actual ? s.actual.total : null, selloutPre: 0 }))
  const out = fcCompute(data, snaps, cfg, todayISO)
  // 當日快照（營業日且未存過才寫＝鎖定）
  const wd = wdOf(todayISO)
  if (!C.closedWd.includes(wd) && !allSnap[todayISO] && out.future.length && out.future[0].date === todayISO) {
    const f0 = out.future[0]
    const mk = mkey(todayISO)
    docs[mk].days[todayISO] = {
      lockedAt: new Date().toISOString(), params: { level: out.level, ratio: f0.ratio, growth: out.growth, calib: out.calib },
      preCalStore: f0.preCal, sysStore: f0.sys, items: (out.futureItems[0] || {}).items || {},
      shares: Object.fromEntries(out.shares.slice(0, 60).map(s => [s.k, s.share])),
      baseStore: out.baseStoreByWd[wd] || 0, baseItems: Object.fromEntries(Object.entries(out.baseItems).map(([k, m]) => [k, m[wd] || 0])),
    }
    touched.add(mk)
  }
  for (const m of touched) { docs[m].updatedAt = new Date().toISOString(); await kvPut(m, docs[m], '銷量預測快照') }
  return { snapped: touched.has(mkey(todayISO)), backfilled: touched.size, forecast: out }
}
