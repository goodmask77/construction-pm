// 營運看板／銷售數據資料（GD ?opsboard 與新殼 /api/ops/board 共用同一份算法；v4.71.188 從 mail-sync 原樣抽出）
//   opsBoardData(store, kvGet)：store＝ground|abeach；kvGet(key) 讀一份文件（GD＝pm_documents；新殼＝銷售數據讀引擎正本、其他讀鏡像）
//   新殼有一份副本 abgd lib/ops/opsboard.js：這支改了要同步複製過去（兩邊同一套算法＝資料一致鐵則）
export const VOID_KEY = (ym) => 'sp_finance_pm_pos_void_' + ym // 同 _voids.js
function negHoursFromSheetRows(rows) { // 同 _voids.js
  const out = []
  for (const r of (rows || [])) { const h = parseInt(r[0]); const amt = Number(r[r.length - 1]) || 0; if (!isNaN(h) && amt < 0) out.push({ h, amt, orders: Number(r[1]) || 0 }) }
  return out
}
export async function opsBoardData(store, kvGet) {
    const storeQ = String(store || 'ground') === 'abeach' ? 'abeach' : 'ground'
    const skOf2 = (n) => /groun/i.test(n || '') ? 'ground' : 'abeach'
    const [posDoc, aliasDoc2, hiddenDoc2, pricesDoc2, slotExDoc] = await Promise.all([kvGet('sp_finance_pm_pos'), kvGet('sp_finance_pm_pos_alias'), kvGet('sp_finance_pm_pos_hidden'), kvGet('sp_finance_pm_pos_prices'), kvGet('sp_finance_pm_pos_slotex')])
    // 🚫 包場/非常態大單日（張良 2026-10-08／10-10：10/4 包場 76,500 計入總營收、但不進時段平均/熱力圖/每日列/品項平均）：v4.71.7 提早讀，品項明細也用同一份
    const slotEx = new Set(((slotExDoc || {})[storeQ]) || [])
    const todayAct = new Date(Date.now()+8*3600e3).toISOString().slice(0,10)
    const actDoc = (await kvGet('sp_finance_pm_prep_act_'+todayAct.slice(0,7))) || { days:{} } // 實際備料（張良 2026-10-01：每天可填、留紀錄做分析）
    // 排除「盤中未完整日」（張良 2026-09-24 抓包：今天的半天資料 11:00 起混進統計，把當天星期的平均拉低
    // → 看板白天數字一直變、跟 09:30 備料訊息對不上。統計只吃打烊後的正式日結；日表那段照樣顯示今天盤中）
    const entriesAll9 = ((posDoc || {}).entries || []).filter(e => skOf2(e.store) === storeQ).sort((a, b) => (a.date < b.date ? -1 : 1))
    const entries = entriesAll9.filter(e => !e.intraday)
    if (!entries.length) return { ok: true, store: storeQ, empty: true }
    // v4.18.2（張良：每日數據要跟主App一樣有今天盤中）：統計照舊只吃正式日結；日表額外掛上今天的盤中列(live=1)
    const today18 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const liveE9 = entriesAll9.filter(e => e.intraday && e.date === today18 && !entries.some(x => x.date === e.date)).slice(-1)
    const anchor = entries[entries.length - 1].date
    const dOf = (base, off) => { const d0 = new Date(base + 'T00:00:00Z'); d0.setUTCDate(d0.getUTCDate() + off); return d0.toISOString().slice(0, 10) }
    const from60 = dOf(anchor, -59), from30 = dOf(anchor, -29)
    const win = entries.filter(e => e.date >= from60)
    const w30 = win.filter(e => e.date >= from30)
    // 品項：撈全部歷史明細月檔（張良 2026-09-20：跟 App 一樣顯示全部歷史，不只近期）
    const mos = [...new Set(entries.map(e => e.date.slice(0, 7)))]
    const dets = {}
    await Promise.all(mos.map(async mo2 => { dets[mo2] = await kvGet('sp_finance_pm_pos_d_' + mo2) })) // 平行抓（串行是 10 秒慢的元兇之一，張良 2026-09-21）
    const dayDet2 = (date) => { const m = (dets[date.slice(0, 7)] || {}).days; if (!m) return undefined; return m[`${date}::${storeQ}`] || (m[date] && skOf2(m[date].store) === storeQ ? m[date] : undefined) }
    // 日表（近20個營業日；核心夥伴全開＝付款明細/至14:00/單均都給——張良 2026-09-20「都是核心夥伴」）
    const WD = ['日', '一', '二', '三', '四', '五', '六']
    const days2 = [...entries, ...liveE9].map(e => {
      const tk = Number(e.takeTx) || 0, dn = Number(e.dineTx) || 0
      const rev2 = Number(e.revenue) || 0, tx2 = Number(e.txCount) || 0
      // 至14:00＝時段表 <14 點小時列加總（與 App 同一份資料）
      let lunch = null
      const ts = ((dayDet2(e.date) || {}).sheets || {})['時段分析(每小時)']
      const trows = Array.isArray(ts) && ts[0] ? (ts[0].rows || []) : []
      if (trows.length) { lunch = 0; for (const r of trows) { const hh2 = parseInt(r[0]); if (!isNaN(hh2) && hh2 < 14) lunch += Number(r[2]) || 0 } }
      return {
        live: e.intraday ? 1 : 0,
        date: e.date, wd: WD[new Date(e.date + 'T00:00:00Z').getUTCDay()], rev: rev2, tx: tx2,
        avg: tx2 ? Math.round(rev2 / tx2) : null, lunchPct: lunch != null && rev2 ? Math.round(lunch / rev2 * 100) : null, lunchRev: lunch != null ? Math.round(lunch) : null,
        cash: Number(e.cash) || 0, card: Number(e.card) || 0, linepay: Number(e.linepay) || 0, uber: Number(e.uber) || 0,
        kioskPct: e.kiosk > 0 && rev2 ? Math.round(e.kiosk / rev2 * 100) : null, discount: Number(e.discount) || 0,
        takePct: tk + dn > 0 ? Math.round(tk / (tk + dn) * 100) : null,
      }
    })
    const AB_SKIP2 = new Set(['⚡️工具箱', '包場大訂', '免招手', '收蛋糕', '慶生沒蛋糕', '♥️福利♥️', '自訂食品', '總結', '套餐', '商品分類銷售分析'])
    const GD_SKIP2 = new Set(['財務工具箱', '財務工具', '現場工具箱', '保存期限工具箱'])
    const isAB2 = storeQ === 'abeach'
    const norm2 = (s) => isAB2 ? String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '').replace(/\s+/g, '') : String(s)
    const aliasMap2 = ((aliasDoc2 || {})[storeQ]) || {}
    const hiddenMap2 = ((hiddenDoc2 || {})[storeQ]) || {}
    const priceMap2 = ((pricesDoc2 || {})[storeQ]) || {} // 張良手填牌價優先；0=不顯示（與 App 同口徑）
    const items2 = {}; const itemsH2 = {}; const catOrder2 = []; const setByDate = {}
    let n30 = 0, nPrev = 0
    // v4.71.7（張良 2026-10-13「品項明細要即時」）：今天盤中那筆也跑進來、但只填逐日欄（o.q[今天]），30日均/vs近60/累計/金額照舊只算打烊後正式日結；
    //   包場日（slotEx）整天跳過＝不佔分母、不出欄（跟每日數據表「不拉平均、隱藏該列」同一口徑）
    const liveDate9 = liveE9.length ? liveE9[0].date : null
    for (const e of [...entries, ...liveE9]) {
      if (slotEx.has(e.date)) continue
      const inCur = !e.intraday && e.date >= from30, inPrev = !e.intraday && !inCur && e.date >= from60
      if (inCur) n30++; else if (inPrev) nPrev++
      const secs = ((dayDet2(e.date) || {}).sheets || {})['總銷售額 (以類別分類)']
      if (!Array.isArray(secs)) continue
      for (const s of secs) {
        if (s.title === '總結') continue
        if (s.title === '套餐') { for (const r of (s.rows || [])) if (Array.isArray(r)) setByDate[e.date] = (setByDate[e.date] || 0) + (Number(r[1]) || 0); continue }
        if (isAB2 && AB_SKIP2.has(s.title)) continue
        if (!isAB2 && GD_SKIP2.has(s.title)) continue
        if (!isAB2 && !catOrder2.includes(s.title)) catOrder2.push(s.title)
        const uberCat = isAB2 && ['Pizza披薩', '主餐＆早午餐', '沙拉＆湯', '炸物＆前菜', '飲品'].includes(s.title) // AB Uber 低價分類：份數併入、金額不算（與 App 同口徑）
        for (const r of (s.rows || [])) {
          if (!Array.isArray(r) || typeof r[0] !== 'string' || /^1\/4/.test(r[0].trim())) continue
          let key2 = norm2(r[0]); key2 = aliasMap2[key2] || key2
          if (hiddenMap2[key2]) { // 已下架：不進任何統計，只收進隱藏管理清單（張良 2026-09-22 /prep 也要隱藏管理）
            const oH = itemsH2[key2] || (itemsH2[key2] = { n: r[0], k: key2, cat: s.title, q30: 0 })
            if (inCur) oH.q30 += Number(r[1]) || 0
            continue
          }
          const o = items2[key2] || (items2[key2] = { n: r[0], k: key2, cat: s.title, q: {}, q30: 0, qPrev: 0, amt30: 0 })
          o.n = r[0]; o.cat = s.title // 最新出現的名字/分類為準
          const qv = Number(r[1]) || 0
          o.q[e.date] = (o.q[e.date] || 0) + qv // 全歷史逐日
          if (inCur) { o.q30 += qv; if (!uberCat) o.amt30 += Number(r[r.length - 1]) || 0 } else if (inPrev) o.qPrev += qv
        }
      }
    }
    const datesAll = [...entries, ...liveE9].filter(e => !slotEx.has(e.date)).map(e => e.date) // v4.71.7 逐日欄＝正式日結＋今天盤中（最右一欄標「盤中」）、包場日不出欄
    const GD_ORDER2 = ['披薩', '漢堡', '越法三明治', '義大利麵', '小點', '湯品', '基礎飲品', '咖啡飲品', '奶香飲品', '檸檬飲品', '甜點']
    const catsAll = [...new Set(Object.values(items2).map(o => o.cat))]
    catsAll.sort((a, b) => { const ia = GD_ORDER2.indexOf(a), ib = GD_ORDER2.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) })
    const growOf2 = (o) => { if (!nPrev) return null; const p = o.qPrev; if (!p) return o.q30 > 0 ? '新' : null; const a30 = o.q30 / n30, a60 = (o.q30 + p) / (n30 + nPrev); return Math.round((a30 - a60) / a60 * 100) }
    const totalAmt30 = Object.values(items2).reduce((t, o) => t + (o.amt30 || 0), 0)
    const cats2 = catsAll.map(cn => ({
      name: cn,
      amt30: Math.round(Object.values(items2).filter(o => o.cat === cn).reduce((t, o) => t + (o.amt30 || 0), 0)),
      items: Object.values(items2).filter(o => o.cat === cn && (o.q30 > 0 || o.qPrev > 0 || (liveDate9 && o.q[liveDate9] > 0))).sort((a, b) => b.q30 - a.q30) // v4.71.7 今天才第一次賣的新品也列（只有盤中欄有數）
        .map(o => { const ov = priceMap2[o.k] != null ? priceMap2[o.k] : priceMap2[o.n]
          // 售價：手填/灌檔牌價優先；GD 不用金額÷份數估（套餐拆帳會拉低＝張良 2026-09-22 抓包「菜單金額不對」），AB 才估
          const price = ov != null ? (Number(ov) || null) : (isAB2 && o.q30 > 0 && o.amt30 > 0 ? Math.round(o.amt30 / o.q30 / 5) * 5 : null)
          return { n: o.n, k: o.k, avg30: n30 ? Math.round(o.q30 / n30 * 10) / 10 : null, cum30: o.q30, grow: growOf2(o), amt30: Math.round(o.amt30 || 0), pct: totalAmt30 ? Math.round((o.amt30 || 0) / totalAmt30 * 1000) / 10 : null, price, q: datesAll.map(dd => o.q[dd] || 0) } }),
    })).filter(c => c.items.length)
    // 品類彙總（30日均/vs近60/30天累計/全歷史逐日）＋漢堡子小計＋預估備料（張良 2026-09-20）
    const aggOf = (list) => {
      const q = datesAll.map(dd => list.reduce((t, o) => t + (o.q[dd] || 0), 0))
      const q30s = list.reduce((t, o) => t + o.q30, 0), qPs = list.reduce((t, o) => t + o.qPrev, 0)
      let grow = null
      if (nPrev) { if (!qPs) grow = q30s > 0 ? '新' : null; else { const a30 = q30s / n30, a60 = (q30s + qPs) / (n30 + nPrev); grow = Math.round((a30 - a60) / a60 * 100) } }
      return { avg30: n30 ? Math.round(q30s / n30 * 10) / 10 : null, cum30: q30s, grow, q }
    }
    cats2.forEach(c => { c.agg = aggOf(Object.values(items2).filter(o => o.cat === c.name)) })
    if (!isAB2) {
      const burg = Object.values(items2).filter(o => o.cat === '漢堡')
      const c = cats2.find(x => x.name === '漢堡')
      if (c && burg.length) {
        const mk2 = (label, filt) => ({ n: label, ...aggOf(burg.filter(filt)) })
        c.subs = [
          mk2('├ 雞肉堡小計', o => !/牛肉/.test(o.n)),
          mk2('│　├ 炸雞腿堡', o => /雞腿堡/.test(o.n) && /炸/.test(o.n)),
          mk2('│　└ 煎雞腿堡', o => /雞腿堡/.test(o.n) && !/炸/.test(o.n)),
          mk2('├ 牛肉堡小計', o => /牛肉/.test(o.n)),
        ]
      }
    }
    // 預估備料量（GD；張良 2026-09-20 指定站別彙總）：平日/週末分開日均＝實際備量抓數
    const wkDates = new Set(w30.filter(e => { const d2 = new Date(e.date + 'T00:00:00Z').getUTCDay(); return d2 >= 1 && d2 <= 5 }).map(e => e.date))
    const weDates = new Set(w30.filter(e => !wkDates.has(e.date)).map(e => e.date))
    // 星期別集合（全歷史；GD 週末公休所以主要是週一~五各自平均——備料微調建議用）
    const wdSets2 = {}
    for (const e of entries) { const w = new Date(e.date + 'T00:00:00Z').getUTCDay(); (wdSets2[w] = wdSets2[w] || new Set()).add(e.date) }
    const prepAgg = (filt, mult = 1) => {
      const list = Object.values(items2).filter(filt)
      const dayVal = (dd) => list.reduce((t, o) => t + (o.q[dd] || 0), 0) * mult
      // 截尾平均（張良 2026-09-21 統計學抓包採納：樣本≥8天就去掉最高/最低各1天再平均——颱風日/異常日不再拉偏；
      // 備料數字照舊無條件進位取整）。峰值/低值本來就是要看極端，不截。
      const tmean = (vals) => {
        const v2 = vals.filter(v => v != null)
        if (!v2.length) return null
        let a = [...v2].sort((x, y) => x - y)
        if (a.length >= 8) a = a.slice(1, -1)
        return Math.ceil(a.reduce((t, v) => t + v, 0) / a.length)
      }
      const w30Vals = w30.map(e => dayVal(e.date))
      const byWd = [1, 2, 3, 4, 5].map(w => { const ds = wdSets2[w]; return ds && ds.size ? tmean([...ds].map(dayVal)) : null })
      return { avg: w30Vals.length ? tmean(w30Vals) : null, wk: wkDates.size ? tmean([...wkDates].map(dayVal)) : null, we: weDates.size ? tmean([...weDates].map(dayVal)) : null, byWd, peak: w30Vals.length ? Math.max(...w30Vals) : null, low: w30Vals.length ? Math.min(...w30Vals) : null }
    }
    const prep = isAB2 ? null : [
      { grp: '炸台', name: '無骨煎雞腿', ...prepAgg(o => o.cat === '漢堡' && /雞腿堡/.test(o.n) && !/炸/.test(o.n)) },
      { grp: '炸台', name: '無骨炸雞腿', ...prepAgg(o => o.cat === '漢堡' && /雞腿堡/.test(o.n) && /炸/.test(o.n)) },
      { grp: '炸台', name: '無骨雞腿合計', sub: 1, ...prepAgg(o => o.cat === '漢堡' && /雞腿堡/.test(o.n)) }, // 煎+炸加總小計（張良 2026-09-20；峰低值=兩者同日合計的最高/最低，不是峰值相加）
      { grp: '炸台', name: '帶骨炸雞（支）', ...prepAgg(o => o.cat === '小點' && /玻璃脆殼|川味微辣炸雞/.test(o.n), 2) },
      { grp: '沙拉', name: '小洋芋', ...prepAgg(o => o.cat === '小點' && /洋芋/.test(o.n)) },
      { grp: '沙拉', name: '沙拉杯', ...prepAgg(o => o.cat === '小點' && /沙拉杯/.test(o.n)) },
      { grp: '吧檯', name: '四季春烏龍', ...prepAgg(o => o.cat === '基礎飲品' && /四季春/.test(o.n)) },
      { grp: '吧檯', name: '台灣有機紅茶', ...prepAgg(o => o.cat === '基礎飲品' && /有機紅茶/.test(o.n)) },
      { grp: '吧檯', name: '南非國寶茶', ...prepAgg(o => o.cat === '基礎飲品' && /國寶茶/.test(o.n)) },
    ]
    // 套餐附加率（GD）：組數÷主餐份數
    const MAIN2 = new Set(['漢堡', '披薩', '義大利麵', '越法三明治'])
    const setDays = days2.map(d => {
      const sq = setByDate[d.date] || 0
      const mains = Object.values(items2).filter(o => MAIN2.has(o.cat)).reduce((t, o) => t + (o.q[d.date] || 0), 0)
      return sq && mains ? Math.round(sq / mains * 100) : null
    })
    // 時段平均（近30天，分平日/週末；GD 才有）
    // 🚫 排除包場/非常態大單日（張良 2026-10-08：10/4 包場 76,500 不進時段平均/熱力圖，但仍計入總營收）：清單 sp_finance_pm_pos_slotex.dates
    // （slotEx 已在最上面跟 pos 一起讀，品項明細同一份）
    const hourAgg = { wk: {}, we: {} }, hourN = { wk: 0, we: 0 }
    for (const e of w30) {
      if (slotEx.has(e.date)) continue // 包場日不算進時段平均
      const sheet = ((dayDet2(e.date) || {}).sheets || {})['時段分析(每小時)']
      const rows2 = Array.isArray(sheet) && sheet[0] ? (sheet[0].rows || []) : []
      if (!rows2.length) continue
      const wd2 = new Date(e.date + 'T00:00:00Z').getUTCDay()
      const kk = (wd2 === 0 || wd2 === 6) ? 'we' : 'wk'
      hourN[kk]++
      for (const r of rows2) { const h = parseInt(r[0]); if (!isNaN(h)) hourAgg[kk][h] = (hourAgg[kk][h] || 0) + (Number(r[1]) || 0) }
    }
    const slots2 = {}
    for (const kk of ['wk', 'we']) slots2[kk] = Object.entries(hourAgg[kk]).map(([h, t]) => [Number(h), Math.round(t / Math.max(1, hourN[kk]) * 10) / 10]).sort((a, b) => a[0] - b[0])
    // 14:00 前的單量佔比（平日；備料節奏推估用——品項無分時資料，用全店時段分佈當比例）
    const wkTot2 = slots2.wk.reduce((t, a) => t + a[1], 0)
    const share14 = wkTot2 ? Math.round(slots2.wk.filter(a => a[0] < 14).reduce((t, a) => t + a[1], 0) / wkTot2 * 100) : null
    // 🔥 時段營收熱力圖（張良 2026-10-05「之前的營收時間熱力圖放每日數據下面」）：{date:{hour:rev}}；近120天有日結時段表的日子；GD/AB 都給
    // 口徑＝時段表最後一欄＝營收（與 App 熱力圖同一份：det.sheets['時段分析(每小時)']）
    const hourDays = {}
    const hourUber = {} // AB 每小時 Uber {date:{hour:uber}}（張良 2026-10-12 熱力圖顯示 Uber）
    const fromHD = dOf(anchor, -120)
    // v4.70.87（張良 2026-10-12「熱力圖怎麼沒有更新到現在週一」）：原本只跑 entries＝日結正式筆，今天盤中那筆（liveE9，喬亞每 15 分已帶時段表）被漏掉
    // →每日數據表有今天、熱力圖沒有。改成跟 days2 同一份名單（正式＋今天盤中），打烊後自動換正式值
    for (const e of [...entries, ...liveE9]) {
      if (e.date < fromHD) continue
      if (slotEx.has(e.date)) continue // 包場日不進熱力圖（那格隱藏）
      const sheet = ((dayDet2(e.date) || {}).sheets || {})['時段分析(每小時)']
      const rows3 = Array.isArray(sheet) && sheet[0] ? (sheet[0].rows || []) : []
      if (!rows3.length) continue
      const hm = {}
      for (const r of rows3) { const h = parseInt(r[0]); if (!isNaN(h)) hm[h] = (hm[h] || 0) + (Number(r[r.length - 1]) || 0) }
      for (const h of Object.keys(hm)) if (!hm[h]) delete hm[h] // 0 元時段不給（盤中會帶 9 時＝0 的空列，熱力圖多一整列空白）；v4.71.6 負數（退單／作廢）要留著顯示，不然格子加總≠日營收（張良 2026-10-12 10/12 16時 −6,090 被吃掉）
      if (Object.keys(hm).length) hourDays[e.date] = hm
    }
    // ⚠️ 退單／作廢紀錄（v4.71.6 張良 2026-10-12「每一筆都要清楚」）：GD 限定。每天＝{hours:時段表負數小時, snap:盤中快照相減事件, gap:時段表加總−實收(≠0 代表喬亞報表本身有跨日/沖帳差)}
    let voids = null
    if (!isAB2) {
      try {
        voids = {}
        const revOf = {}; for (const e of [...entries, ...liveE9]) revOf[e.date] = Number(e.revenue) || 0
        for (const e of [...entries, ...liveE9]) {
          if (e.date < fromHD) continue
          const sheet = ((dayDet2(e.date) || {}).sheets || {})['時段分析(每小時)']
          const rows3 = Array.isArray(sheet) && sheet[0] ? (sheet[0].rows || []) : []
          if (!rows3.length) continue
          const hrsN = negHoursFromSheetRows(rows3)
          const sumH = rows3.reduce((t, r) => t + (Number(r[r.length - 1]) || 0), 0)
          const gap = sumH - revOf[e.date]
          if (hrsN.length || gap) voids[e.date] = { hours: hrsN, snap: [], gap }
        }
        const ymsV = [...new Set([...entries, ...liveE9].filter(e => e.date >= fromHD).map(e => e.date.slice(0, 7)))]
        const vdocs = await Promise.all(ymsV.map(ym => kvGet(VOID_KEY(ym)).catch(() => null)))
        for (const vd of vdocs) for (const [dt, v] of Object.entries((vd || {}).days || {})) {
          if (!(v.snap || []).length) continue
          voids[dt] = voids[dt] || { hours: v.hours || [], snap: [], gap: 0 }
          voids[dt].snap = v.snap
        }
        if (!Object.keys(voids).length) voids = null
      } catch (_) { voids = null }
    }
    // AB 沒有日結時段表（Eats365 日結無時段）→ ①主來源：後台 hourlySalesRecordMap 回補的直接每小時營收 sp_finance_pm_ab_hhrev_（可回補歷史＝熱力圖跟 GD 一樣滿，張良 2026-10-10）②補：盤中快照 sp_finance_pm_ab_hh_（joya-intraday 當天累計相鄰相減）補今天進行中的日子
    if (isAB2 && !Object.keys(hourDays).length) {
      const mos = new Set()
      for (let i = 0; i <= 4; i++) { const dM = new Date(String(anchor).slice(0, 7) + '-01T00:00:00Z'); dM.setUTCMonth(dM.getUTCMonth() - i); mos.add(dM.toISOString().slice(0, 7)) }
      for (const mo of mos) { // ① 回補的直接每小時（優先）
        const rvDoc = await kvGet('sp_finance_pm_ab_hhrev_' + mo)
        if (!rvDoc || !rvDoc.days) continue
        for (const [date, hm] of Object.entries(rvDoc.days)) {
          if (date < fromHD || slotEx.has(date)) continue
          const hm2 = {}; for (const [h, v] of Object.entries(hm || {})) { const hh = parseInt(h); if (!isNaN(hh) && Number(v) > 0) hm2[hh] = Number(v) }
          if (Object.keys(hm2).length) hourDays[date] = hm2
          const um = (rvDoc.uber || {})[date]; if (um) { const u2 = {}; for (const [h, v] of Object.entries(um)) { const hh = parseInt(h); if (!isNaN(hh) && Number(v) > 0) u2[hh] = Number(v) } if (Object.keys(u2).length) hourUber[date] = u2 }
        }
      }
      // ② 今天進行中：吃 sp_finance_pm_ablive.hourly（syncEatsLive 每次盤中存的後台同一張每小時表＝「開單時間」口徑，跟歷史列一致；
      //    張良 2026-10-12 拍板「A 開單時間」。之前用快照相減＝結帳時間口徑，隔天回補後整列會變＝不一致）
      try {
        const live = await kvGet('sp_finance_pm_ablive')
        if (live && live.date && live.date >= fromHD && !slotEx.has(live.date) && !hourDays[live.date] && Array.isArray(live.hourly)) {
          const hm2 = {}; for (const a of live.hourly) { const hh = Number(a[0]), v = Math.round(Number(a[1]) || 0); if (!isNaN(hh) && v > 0) hm2[hh] = v }
          if (Object.keys(hm2).length) hourDays[live.date] = hm2
          const u2 = {}; for (const [h, v] of Object.entries(live.hourlyUber || {})) { const hh = parseInt(h); if (!isNaN(hh) && Number(v) > 0) u2[hh] = Number(v) }
          if (Object.keys(u2).length) hourUber[live.date] = u2
        }
      } catch (_) {}
      for (const mo of mos) { // ③ 盤中快照補前兩步都沒有的日子（結帳時間口徑，只當最後備援）
        const hhDoc = await kvGet('sp_finance_pm_ab_hh_' + mo)
        if (!hhDoc || !hhDoc.days) continue
        for (const [date, arr] of Object.entries(hhDoc.days)) {
          if (date < fromHD || slotEx.has(date) || hourDays[date]) continue
          const pts = (arr || []).slice().sort((a, b) => (a.t < b.t ? -1 : 1))
          const hm2 = {}
          for (let i = 1; i < pts.length; i++) { const seg = (Number(pts[i].rev) || 0) - (Number(pts[i - 1].rev) || 0); if (seg <= 0) continue; const h = parseInt(pts[i - 1].t.slice(0, 2)); if (!isNaN(h)) hm2[h] = (hm2[h] || 0) + seg }
          if (Object.keys(hm2).length) hourDays[date] = hm2
        }
      }
    }
    const rev30 = w30.reduce((t, e) => t + (Number(e.revenue) || 0), 0)
    // 預做節奏表（張良 2026-09-21：每15分×品項）：pm_pos_q_每日檔（joya-intraday 15分快照）相鄰差分 → 近7個營業日平均
    // 喬亞不給歷史時分 → 資料 2026-09-22 起累積；沒資料時 rhythm.days=0（前端顯示 0 佔位）
    let rhythm = null
    if (!isAB2) {
      const RSLOTS = []
      for (let t = 11 * 60; t <= 19 * 60 + 15; t += 15) RSLOTS.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')) // 桶＝起始時刻；19:30 快照的差分落在 19:15 桶
      // 平行抓最新 10 個營業日的快照檔、留有料的前 7 個（原本逐日串行＝慢；快照 9/22 起才有，早期日子抓了也是空）
      const qcand = datesAll.slice(-10).reverse()
      const qall = await Promise.all(qcand.map(dd4 => kvGet('sp_finance_pm_pos_q_' + dd4).catch(() => null)))
      const qdocs = qall.filter(qd => qd && Array.isArray(qd.slots) && qd.slots.length > 1).slice(0, 7)
      const bucket = {}
      for (const qd of qdocs) {
        const sl = [...qd.slots].sort((a, b) => (a.t < b.t ? -1 : 1))
        for (let i = 0; i < sl.length; i++) {
          const prevI = i ? (sl[i - 1].items || {}) : {}
          const bucketT = i ? sl[i - 1].t : '11:00' // 差分歸「前一格起始」桶；首張快照＝開店至該刻的量歸 11:00
          for (const [nm, qv] of Object.entries(sl[i].items || {})) {
            const dq = Math.max(0, (Number(qv) || 0) - (Number(prevI[nm]) || 0))
            if (!dq) continue
            let k3 = norm2(nm); k3 = aliasMap2[k3] || k3
            if (hiddenMap2[k3]) continue
            const o = bucket[k3] || (bucket[k3] = { n: nm, s: {} })
            o.n = nm
            o.s[bucketT] = (o.s[bucketT] || 0) + dq
          }
        }
      }
      const nD = qdocs.length
      // 完整菜單＋分類（張良 2026-09-21：不要只有 Top18）：照品項明細的品類順序全列，沒快照資料的顯示 0；隱藏另由 pm_prep_hide 前端過濾
      const rows3 = cats2.flatMap(c => c.items.map(it => {
        const b = bucket[it.k]
        return { n: it.n, k: it.k, cat: c.name, q: RSLOTS.map(t => (b && nD ? Math.round((b.s[t] || 0) / nD * 10) / 10 : 0)) }
      }))
      rhythm = { slots: RSLOTS, days: nD, items: rows3 }
    } else { // AB（張良 2026-09-22）：eats-rhythm 每天打烊後直接逐15分窗撈（pm_pos_q_ab_，值=該窗實賣，不用差分）
      const RS2 = []
      for (let t2 = 11 * 60 + 30; t2 <= 21 * 60 + 15; t2 += 15) RS2.push(String(Math.floor(t2 / 60)).padStart(2, '0') + ':' + String(t2 % 60).padStart(2, '0'))
      const qcand2 = datesAll.slice(-10).reverse()
      const qall2 = await Promise.all(qcand2.map(dd4 => kvGet('sp_finance_pm_pos_q_ab_' + dd4).catch(() => null)))
      const qdocs2 = qall2.filter(qd => qd && Array.isArray(qd.slots) && qd.slots.length > 0).slice(0, 7)
      const bucket2 = {}
      for (const qd of qdocs2) for (const sl of qd.slots) for (const [nm, qv] of Object.entries(sl.items || {})) {
        let k3 = norm2(nm); k3 = aliasMap2[k3] || k3
        if (hiddenMap2[k3]) continue
        const o = bucket2[k3] || (bucket2[k3] = { s: {} })
        o.s[sl.t] = (o.s[sl.t] || 0) + (Number(qv) || 0)
      }
      const nD2 = qdocs2.length
      const rows4 = cats2.flatMap(c => c.items.map(it => { const b = bucket2[it.k]; return { n: it.n, k: it.k, cat: c.name, q: RS2.map(t2 => (b && nD2 ? Math.round((b.s[t2] || 0) / nD2 * 10) / 10 : 0)) } }))
      rhythm = { slots: RS2, days: nD2, items: rows4 }
    }
    // AB 停售動態（張良 2026-09-30：不只通知——看板要能隨時查現在+歷史）
    let soldout = null
    if (isAB2) { const soD = await kvGet('sp_finance_pm_absoldout'); if (soD) soldout = { current: soD.current || {}, log: (soD.log || []).slice(0, 150) } }
    // 📜 歷史月營收（張良 2026-10-04「補在哪？現在主要都用prep」）：有日結的月份=entries 加總（跟 KPI/每日數據同口徑）、
    // 更早（iCHEF 時代 2021-02 起）=阿桑 /revenue/monthly 月彙總（sp_finance_pm_boss_revm；只有 AB 有）
    let hist = []
    try {
      const byMoH = {}
      for (const e of entries) {
        const mo9 = e.date.slice(0, 7)
        const o = byMoH[mo9] = byMoH[mo9] || { month: mo9, revenue: 0, bills: 0, customers: 0, days: 0, uber: 0 }
        o.revenue += Number(e.revenue) || 0; o.bills += Number(e.txCount) || 0; o.customers += Number(e.guests) || 0; o.days++; o.uber += Number(e.uber) || 0 // uber=月 Uber Eats 合計（KPI 第四卡，張良 2026-10-12；與每日數據 Uber 欄同源）
        if (slotEx.has(e.date)) { o.exRev = (o.exRev || 0) + (Number(e.revenue) || 0); o.exDays = (o.exDays || 0) + 1 } // v4.71.6 包場日：計入總營收、KPI 日均要排除（與每日數據平均列同口徑；張良 2026-10-10 拍板、10-12 抓包 KPI 沒排）
      }
      if (storeQ === 'abeach') {
        const revmD = (await kvGet('sp_finance_pm_boss_revm')) || {}
        for (const m9 of Object.values(revmD.rows || {})) {
          if (m9?.month && !byMoH[m9.month]) byMoH[m9.month] = { month: m9.month, revenue: Number(m9.revenue) || 0, bills: m9.bills ?? null, customers: m9.customers ?? null, days: (m9.sources || [])[0]?.open_days ?? m9.days_with_data ?? null }
        }
      }
      hist = Object.values(byMoH).sort((a, b) => (a.month < b.month ? 1 : -1))
    } catch (_) {}
    // Vercel 邊緣快取（張良 2026-09-21 嫌慢→快取；2026-10-13「確保即時更新」抓包：原本 s-maxage=300＋stale-while-revalidate=1800
    //   ＝過期後還能再端 30 分鐘舊資料，首頁打開看到 16:53 的數字其實已 17:10）→ 改 60 秒快取＋最多再端 60 秒舊的；前端本來就有本機快取秒開，速度不受影響
    // v4.71.7 資料時間（給畫面顯示「喬亞/Eats365 幾點抓的」，不再拿回應產生時間冒充更新時間）
    const liveAt = liveE9.length ? (liveE9[0].fetchedAt || null) : null
    return {
      ok: true, store: storeQ, updatedAt: new Date().toISOString(), anchor, hist,
      liveDate: liveDate9, liveAt, // 今天盤中那筆的日期＋抓取時刻（HH:MM 台北）；打烊後正式值接手＝null
      kpi: { rev30, days30: w30.length, avgRev: w30.length ? Math.round(rev30 / w30.length) : 0, tx30: w30.reduce((t, e) => t + (Number(e.txCount) || 0), 0) },
      n30, prep, prepAct: Object.fromEntries(Object.entries((actDoc.days || {})[todayAct] || {}).filter(([, v]) => v.q != null).map(([k, v]) => [k, v.q])), prepS86: Object.fromEntries(Object.entries((actDoc.days || {})[todayAct] || {}).filter(([, v]) => v.s86 && v.s86.on).map(([k]) => [k, 1])), prepActDate: todayAct, share14, rhythm, soldout, days: days2.reverse(), setPcts: setDays.reverse(), dates: datesAll, cats: cats2, hidden: Object.values(itemsH2).map(o => ({ n: o.n, k: o.k, cat: o.cat, cum30: o.q30 })), slots: (slots2.wk.length || slots2.we.length) ? slots2 : null,
      hourDays: Object.keys(hourDays).length ? hourDays : null,
      voids, // v4.71.6 退單／作廢紀錄 {date:{hours,snap,gap}}（GD）
      hourUber: Object.keys(hourUber).length ? hourUber : null, // AB 每小時 Uber（張良 2026-10-12）
      slotEx: [...slotEx], // 包場/異常大單日（張良 2026-10-10：10/4 隱藏不入每日列、計入總營收、不拉平均）：每日數據表用它排除平均並隱藏該列
      heatHide: ((await kvGet('sp_finance_pm_heat_hide')) || {})[storeQ] || {}, // v4.70.1 熱力圖隱藏時段（全店一致、限有權限者改）：{時段:1}
    }
}
