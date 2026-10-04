// ── A Beach inline 訂位同步（張良 2026-10-03「所有訂位資訊紀錄」）────────────
// cron（vercel.json 每小時 :25）：
//   ①滾動窗「前 3 天 ～ 未來 45 天」逐日抓（新訂/改期/取消/入座隨時變）
//   ②遠期同步：搜尋端點一次收齊「45 天後全部未來訂位」（婚顧包場 2027/2028；張良要隨時答哪天被訂）
// 手動口（金鑰同 MENU_PROBE_KEY）：
//   ?backfill=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD → 回填區間（一次最多 150 天，歷史回填分批打）
//   ?probe=<key>                                   → 各月筆數盤點＋遠期清單
// 入庫：sp_finance_pm_inline_<YYYY-MM>＝{ days: { 'YYYY-MM-DD': [瘦身訂位…] }, updatedAt }（月檔，key=訂位日）
//       sp_finance_pm_inline＝{ firstDay, lastSync, months: {…}, farFuture: [{d,…}], dayNotes: {今天起的當日備註} }（總覽，AI/probe 用）
//       sp_finance_pm_inline_notes＝{ days: { 'YYYY-MM-DD': [{note,by,at}] } }（當日備註全史，RTDB branchDailyNotes）
import { inlineLogin, inlineFetchDay, inlineSearchFuture, inlineFetchDayNotes, inlineSearchKeyword, inlineCustomer, CANCELED_STATES } from './_inline.js'
import { kvGet, kvPut, announceChanged } from './mail-sync.js'

const DAY = 86400e3
const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10)

function dateRange(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

// 同步一段日期：登入一次、8 併發抓、按月整批寫回
// 空日逾時（_inline.js 6 秒坑）→ 跳過該日不動舊資料；skipped 回報出來（通常=公休/無訂位日，本來就空）
async function syncRange(from, to) {
  const days = dateRange(from, to)
  if (days.length > 150) throw new Error(`一次最多 150 天（現在 ${days.length}）`)
  const token = await inlineLogin()
  const byDay = {}
  const skipped = []
  for (let i = 0; i < days.length; i += 8) {
    await Promise.all(days.slice(i, i + 8).map(async (d) => {
      try { byDay[d] = await inlineFetchDay(token, d) }
      catch (e) { if (e?.isTimeout) { byDay[d] = null; skipped.push(d) } else throw e }
    }))
  }
  // 按月合併寫回（讀舊檔→覆蓋抓到的日→寫回；沒動到的日保留）
  const byMo = {}
  for (const d of days) (byMo[d.slice(0, 7)] = byMo[d.slice(0, 7)] || []).push(d)
  let resv = 0
  const sum = (await kvGet('sp_finance_pm_inline')) || { firstDay: '2021-02-10', months: {} }
  for (const [mo, ds] of Object.entries(byMo)) {
    const key = 'sp_finance_pm_inline_' + mo
    const doc = (await kvGet(key)) || { days: {} }
    for (const d of ds) {
      if (byDay[d] == null) continue // 逾時跳過：不動舊資料
      if (byDay[d].length) { doc.days[d] = byDay[d]; resv += byDay[d].length }
      else delete doc.days[d] // 空日不佔空間（公休/無訂位）
    }
    doc.updatedAt = new Date().toISOString()
    await kvPut(key, doc, 'inline訂位同步')
    sum.months[mo] = moStat(doc)
  }
  sum.lastSync = new Date().toISOString()
  await kvPut('sp_finance_pm_inline', sum, 'inline訂位同步')
  await announceChanged()
  return { days: days.length, resv, skipped }
}

// 月檔 → 總覽統計（guests 不含已取消 state 2/5）
const moStat = (doc) => {
  const dd = Object.values(doc.days)
  return { days: dd.length, resv: dd.reduce((t, a) => t + a.length, 0), guests: dd.reduce((t, a) => t + a.reduce((x, r) => x + (CANCELED_STATES.includes(r.st) ? 0 : r.n || 0), 0), 0) }
}

// 遠期同步：搜尋端點收齊全部未來訂位 → 「窗外（today+45 之後）」的日子以搜尋結果為準整批重建
// （含刪掉已全取消消失的日子；取消的遠期訂位等日子滾進 45 天窗會由 dailyUpdated 補回取消紀錄）
async function syncFuture(token) {
  const boundary = addDays(twToday(), 45) // ≤boundary 由滾動窗負責
  const byDate = await inlineSearchFuture(token)
  const far = {}
  for (const [d, arr] of Object.entries(byDate)) if (d > boundary) far[d] = arr
  const sum = (await kvGet('sp_finance_pm_inline')) || { firstDay: '2021-02-10', months: {} }
  // 要掃的月份＝遠期訂位所在月 ∪ 總覽裡 boundary 之後還有資料的月（才能清掉被取消而消失的日子）
  const mos = new Set(Object.keys(far).map((d) => d.slice(0, 7)))
  for (const mo of Object.keys(sum.months)) if (mo >= boundary.slice(0, 7)) mos.add(mo)
  let farResv = 0
  for (const mo of [...mos].sort()) {
    const key = 'sp_finance_pm_inline_' + mo
    const doc = (await kvGet(key)) || { days: {} }
    let changed = false
    for (const d of Object.keys(doc.days)) if (d > boundary && !far[d]) { delete doc.days[d]; changed = true }
    for (const [d, arr] of Object.entries(far)) if (d.slice(0, 7) === mo) { doc.days[d] = arr; farResv += arr.length; changed = true }
    if (changed) {
      doc.updatedAt = new Date().toISOString()
      await kvPut(key, doc, 'inline遠期同步')
      sum.months[mo] = moStat(doc)
      if (!sum.months[mo].days) delete sum.months[mo]
    }
  }
  // 遠期清單直接放總覽（AI 兩邊都載總覽＝不用撈到未來月檔就能答「哪天已被訂」）；候補(ty=4)不算「被訂」排除
  sum.farFuture = Object.keys(far).sort().flatMap((d) => far[d].filter((r) => r.ty !== 4).map((r) => ({ d, ...r })))
  // 當日備註（RTDB branchDailyNotes 一次整包；⚠️包場/公休註記＝婚顧檔期的另一真相來源）
  let notesInfo = {}
  try {
    const notes = await inlineFetchDayNotes(token)
    const today = twToday()
    sum.dayNotes = {} // 今天起的全部備註 → AI 直接讀
    for (const [d, arr] of Object.entries(notes)) if (d >= today) sum.dayNotes[d] = arr
    await kvPut('sp_finance_pm_inline_notes', { days: notes, updatedAt: new Date().toISOString() }, 'inline備註同步') // 全史另存一檔
    notesInfo = { noteDays: Object.keys(notes).length, futureNoteDays: Object.keys(sum.dayNotes).length }
  } catch (e) { notesInfo = { notesError: e?.message } }
  sum.lastSync = new Date().toISOString()
  await kvPut('sp_finance_pm_inline', sum, 'inline遠期同步')
  await announceChanged()
  return { farDays: Object.keys(far).length, farResv, ...notesInfo }
}

// ── 顧客資料庫＋營運洞察（張良 2026-10-04「建立inline顧客資料庫+九大數據分析頁」）──────
// 全史月檔掃一遍 → ①顧客聚合（key=cid→電話→名字）分段分頁存 sp_finance_pm_inline_cs_<seg>_<頁>
//   ②營運洞察 sp_finance_pm_inline_insights（年趨勢/週幾×時段/來源/提前天數/親子/目的/新舊客/取消率/大組）
//   ③索引 sp_finance_pm_inline_custidx {segments:{seg:{total,pages}}, builtAt}
// cron 每小時檢查：builtAt 超過 20 小時自動重建＝持續累積；手動 ?custbuild=MENU_KEY
const SEG_DEF = { // [標籤, 過濾, 排序, 最多頁數(每頁1000)]
  all: ['全部(有電話)', (c) => true, (a, b) => (b.l || '').localeCompare(a.l || ''), 5],
  vip: ['VIP常客≥10次', (c) => c.v >= 10, (a, b) => b.v - a.v, 2],
  repeat: ['回頭客≥2次', (c) => c.v >= 2, (a, b) => b.v - a.v, 3],
  kids: ['帶小孩', (c) => c.k > 0, (a, b) => (b.l || '').localeCompare(a.l || ''), 2],
  big: ['大組/包場≥20人', (c) => c.mx >= 20, (a, b) => b.mx - a.mx, 2],
  lost: ['流失常客(≥5次但180天沒來)', (c) => c.v >= 5, (a, b) => b.v - a.v, 2], // 180天門檻在 build 時補
  cxh: ['高取消', (c) => c.cx >= 3 && c.cx > c.v, (a, b) => b.cx - a.cx, 1],
  wed: ['婚禮/包場相關', (c) => /婚|包場/.test(c.n || ''), (a, b) => (b.l || '').localeCompare(a.l || ''), 1],
}
async function custBuild() {
  const sum = (await kvGet('sp_finance_pm_inline')) || { months: {} }
  const mos = Object.keys(sum.months || {}).sort()
  const today = twToday()
  const cust = {}
  // v4.40.0（張良「每張卡點進去要有更深的分析：年/月/平均/趨勢」）：洞察改存「逐月明細 m」＋大組清單 bigList，前端自由切年/月/平均
  const ins = { m: {}, bigList: [] }
  // v4.42.1（張良「眼見為憑：點 182/76 要看到詳細資料」）：近 14 個月的新/回「逐筆名單」另存 nr_<ym> 檔
  const NRD_FROM = addDays(today, -430).slice(0, 7)
  const nrd = {}
  const M9 = (ym) => ins.m[ym] = ins.m[ym] || { resv: 0, guests: 0, cxl: 0, kids: 0, nw: 0, rt: 0, big: 0, bigG: 0, src: {}, lead: { d0: 0, d1_3: 0, d4_7: 0, d8_30: 0, d31: 0 }, pp: {}, hp: Array.from({ length: 7 }, () => [0, 0, 0, 0]), hg: Array.from({ length: 7 }, () => [0, 0, 0, 0]), wdD: [0, 0, 0, 0, 0, 0, 0] }
  const slotIdx = (t) => (t < '13:00' ? 0 : t < '18:00' ? 1 : t < '19:00' ? 2 : 3)
  for (let i = 0; i < mos.length; i += 12) {
    const kvm = await Promise.all(mos.slice(i, i + 12).map((m) => kvGet('sp_finance_pm_inline_' + m)))
    for (const doc of kvm) {
      for (const [d, arr] of Object.entries(doc?.days || {})) {
        const ym = d.slice(0, 7), wd = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7
        const mm = M9(ym)
        let dayValid = false
        for (const r of arr) {
          const canceled = CANCELED_STATES.includes(r.st)
          // 候補(ty=4)＝沒進店的人：全部主統計排除、另計 wlN/wlG（張良 2026-10-04「候補要切出來」）
          if (r.ty === 4) { if (!canceled) { mm.wlN = (mm.wlN || 0) + 1; mm.wlG = (mm.wlG || 0) + (r.n || 0) } continue }
          if (canceled) mm.cxl++
          else { mm.resv++; mm.guests += r.n || 0; if (r.ty === 1 || r.ty === 3) { mm.wkN = (mm.wkN || 0) + 1; mm.wkG = (mm.wkG || 0) + (r.n || 0) } }
          const name = (r.name || '').trim()
          const key = r.cid || r.phone || (name ? 'n:' + name : '')
          if (key) {
            const c = cust[key] = cust[key] || { n: name, ph: '', em: '', gd: 0, v: 0, b: 0, cx: 0, p: 0, k: 0, f: d, l: '', mx: 0 }
            if (name) c.n = name // 顧客檔名=最近一次訂位的名字（原取最長→抓到『同學會-Ginny』活動名，張良 2026-10-04 抓包）
            if ((r.phone || '').length > c.ph.length) c.ph = r.phone
            if (r.email && !c.em) c.em = r.email
            if (r.gd && !c.gd) c.gd = r.gd
            c.b++
            if (d < c.f) c.f = d
            const isFirst = c.b === 1
            if (canceled) c.cx++
            else {
              if (r.st === 4) { c.v++; c.p += r.n || 0 }
              c.k += (r.kc || 0) + (r.ks || 0)
              if ((r.n || 0) > c.mx) c.mx = r.n || 0
              if (d > c.l && d <= today) c.l = d
              // 新/回只算「可識別」客人（有客人檔或有效電話）——現場客代稱(外國人/王…)無法判斷新舊，算進去會灌水（張良 2026-10-04 抓包）
              if (r.cid || (r.phone || '').replace(/\D/g, '').length >= 8) {
                isFirst ? mm.nw++ : mm.rt++
                if (ym >= NRD_FROM) { // 眼見為憑逐筆名單（近14個月；回頭附首次來店日+第幾筆）
                  const g9 = nrd[ym] = nrd[ym] || { nw: [], rt: [] }
                  const lst = isFirst ? g9.nw : g9.rt
                  if (lst.length < 1600) lst.push({ d, t: r.t || '', nm: name || c.n, ph: c.ph || r.phone || '', n: r.n || 0, f: c.f, b: c.b, vz: c.v, ty: r.ty || 2 }) // nm=該筆名字非檔名、vz=至此已入座次數
                }
              }
            }
          }
          if (canceled) continue
          dayValid = true
          if ((r.kc || 0) + (r.ks || 0) > 0) mm.kids++
          if ((r.n || 0) >= 20) { mm.big++; mm.bigG += r.n; ins.bigList.push({ d, t: r.t || '', n: r.name || '', g: r.n }) }
          const sv = (r.ref || r.src || '其他').toLowerCase()
          const sk = /google/.test(sv) ? 'Google' : /fb|facebook|instagram|ig/.test(sv) ? 'FB/IG' : /opentable/.test(sv) ? 'OpenTable' : /host|ios|android/.test(sv) ? '店內/電話' : /web/.test(sv) ? '官網/線上' : '其他'
          mm.src[sk] = (mm.src[sk] || 0) + 1
          if (r.created) { const ld = Math.max(0, Math.round((new Date(d) - new Date(r.created.slice(0, 10))) / 86400e3)); mm.lead[ld === 0 ? 'd0' : ld <= 3 ? 'd1_3' : ld <= 7 ? 'd4_7' : ld <= 30 ? 'd8_30' : 'd31']++ }
          const nt = String(r.note || '')
          const pk2 = /慶生|生日|birthday/i.test(nt) ? '慶生' : /約會|date/i.test(nt) ? '約會' : /家庭|親子|family/i.test(nt) ? '家庭' : /商務|公司|business/i.test(nt) ? '商務' : /一般/.test(nt) ? '一般' : nt ? '其他備註' : '未填'
          mm.pp[pk2] = (mm.pp[pk2] || 0) + 1
          if (r.t) { mm.hp[wd][slotIdx(r.t)] += r.n || 0; mm.hg[wd][slotIdx(r.t)]++ }
        }
        if (dayValid) mm.wdD[wd]++
      }
    }
  }
  ins.bigList.sort((a, b) => b.d.localeCompare(a.d))
  if (ins.bigList.length > 900) ins.bigList = ins.bigList.slice(0, 900)
  // POS 真實來客/營收對帳（張良 2026-10-04「跟營業額人均對得起來嗎」→實測9月訂位人次=POS來客的110%，訂位有水分）
  // sp_finance_pm_pos entries（AB=日結信+boss回填）→ 每月 posG 來客/posRev 營收，前端算覆蓋率與人均
  try {
    const posDoc = await kvGet('sp_finance_pm_pos')
    for (const e of ((posDoc || {}).entries || [])) {
      if (/groun/i.test(e.store || '') || !e.date) continue
      const mm = M9(e.date.slice(0, 7))
      mm.posG = (mm.posG || 0) + (Number(e.guests) || 0)
      mm.posRev = (mm.posRev || 0) + (Number(e.revenue) || 0)
      mm.posD = (mm.posD || 0) + 1
    }
  } catch (_) {}
  // 分段寫入（只收「有有效電話」的＝識別得出同一人；現場代稱不進資料庫）
  const idd = Object.values(cust).filter((c) => c.n && c.ph.replace(/\D/g, '').length >= 8)
  const cutoff = addDays(today, -180)
  const idx = { builtAt: new Date().toISOString(), totalAll: Object.keys(cust).length, identified: idd.length, segments: {} }
  const named = Object.values(cust).filter((c) => c.n) // 婚禮/包場常沒留電話 → wed 段不要求電話
  for (const [seg, [label, filt, sorter, maxPg]] of Object.entries(SEG_DEF)) {
    let list = (seg === 'wed' ? named : idd).filter(filt)
    if (seg === 'lost') list = list.filter((c) => c.l && c.l < cutoff)
    list.sort(sorter)
    const pages = Math.min(maxPg, Math.ceil(list.length / 1000) || 0)
    for (let p = 0; p < pages; p++) await kvPut(`sp_finance_pm_inline_cs_${seg}_${p}`, { rows: list.slice(p * 1000, p * 1000 + 1000) }, 'inline顧客庫')
    idx.segments[seg] = { label, total: list.length, pages }
  }
  for (const [ym9, g9] of Object.entries(nrd)) await kvPut(`sp_finance_pm_inline_nr_${ym9}`, { ...g9, builtAt: new Date().toISOString() }, 'inline新回名單')
  await kvPut('sp_finance_pm_inline_insights', ins, 'inline洞察')
  await kvPut('sp_finance_pm_inline_custidx', idx, 'inline顧客庫索引')
  await announceChanged()
  // 自我驗證（2026-10-04 洞察檔悄悄寫失敗抓包）：寫完馬上讀回，讀不到=回報大小與錯誤
  const chk = await kvGet('sp_finance_pm_inline_insights')
  return { identified: idd.length, insightsOk: !!(chk && chk.m), insSize: JSON.stringify(ins).length, segments: Object.fromEntries(Object.entries(idx.segments).map(([k, v]) => [k, v.total])) }
}

export default async function handler(req, res) {
  const mk = (process.env.MENU_PROBE_KEY || '').trim()
  try {
    // 盤點口
    if (req.query?.probe) {
      if (!mk || String(req.query.probe) !== mk) return res.status(403).json({ ok: false })
      const sum = (await kvGet('sp_finance_pm_inline')) || {}
      return res.status(200).json({ ok: true, sum })
    }
    // 顧客資料庫（/prep inline 分頁用；OPS 金鑰）
    const ok9 = (q) => { const k = (process.env.OPS_BOARD_KEY || '').trim(); return k && String(q) === k }
    if (req.query?.custdb) { // ?custdb=OPS&seg=all&page=0 → 索引+該頁名單
      if (!ok9(req.query.custdb)) return res.status(403).json({ ok: false })
      const seg = SEG_DEF[String(req.query.seg || 'all')] ? String(req.query.seg || 'all') : 'all'
      const pg = Math.max(0, Number(req.query.page) || 0)
      const [idx, shard] = await Promise.all([kvGet('sp_finance_pm_inline_custidx'), kvGet(`sp_finance_pm_inline_cs_${seg}_${pg}`)])
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
      return res.status(200).json({ ok: true, idx: idx || null, seg, page: pg, rows: (shard || {}).rows || [] })
    }
    if (req.query?.custinsights) { // ?custinsights=OPS → 九大洞察
      if (!ok9(req.query.custinsights)) return res.status(403).json({ ok: false })
      const [ins, idx, sum2] = await Promise.all([kvGet('sp_finance_pm_inline_insights'), kvGet('sp_finance_pm_inline_custidx'), kvGet('sp_finance_pm_inline')])
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
      return res.status(200).json({ ok: true, ins: ins || null, idx: idx || null, months: (sum2 || {}).months || {}, farFuture: (sum2 || {}).farFuture || [], dayNotes: (sum2 || {}).dayNotes || {} })
    }
    if (req.query?.custnr) { // ?custnr=OPS&ym=2026-10 → 該月新/回「逐筆名單」（眼見為憑，張良 2026-10-04）
      if (!ok9(req.query.custnr)) return res.status(403).json({ ok: false })
      const ym9 = /^\d{4}-\d{2}$/.test(String(req.query.ym || '')) ? String(req.query.ym) : null
      if (!ym9) return res.status(400).json({ ok: false, error: '要 ym=YYYY-MM' })
      const doc9 = await kvGet(`sp_finance_pm_inline_nr_${ym9}`)
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
      return res.status(200).json({ ok: true, ym: ym9, nr: doc9 || null })
    }
    if (req.query?.custfind) { // ?custfind=OPS&q=OD → 即時直搜 inline（姓名/電話片段）＋官方客人檔統計
      if (!ok9(req.query.custfind)) return res.status(403).json({ ok: false })
      const token = await inlineLogin()
      const { total, rows } = await inlineSearchKeyword(token, String(req.query.q || ''), 30)
      const cids = [...new Set(rows.map((r) => r.cid).filter(Boolean))].slice(0, 3)
      const stats = {}
      for (const cid of cids) { const c = await inlineCustomer(token, cid); if (c?.stats) stats[cid] = c }
      return res.status(200).json({ ok: true, total, rows, stats })
    }
    if (req.query?.custbuild) { // 手動重建（MENU 金鑰）
      if (!mk || String(req.query.custbuild) !== mk) return res.status(403).json({ ok: false })
      const out = await custBuild()
      return res.status(200).json({ ok: true, ...out })
    }
    // 關鍵字搜尋盤點口（驗證 D哥 query_resv name 模式用；正式邏輯在 line-webhook queryResvName）
    if (req.query?.kwsearch) {
      if (!mk || String(req.query.kwsearch) !== mk) return res.status(403).json({ ok: false })
      const token = await inlineLogin()
      const out = await inlineSearchKeyword(token, String(req.query.kw || ''), 40)
      return res.status(200).json({ ok: true, ...out })
    }
    // 常客排行盤點口（驗證 D哥 query_resv top 模式用；同一套聚合邏輯）
    if (req.query?.custtop) {
      if (!mk || String(req.query.custtop) !== mk) return res.status(403).json({ ok: false })
      const sum = (await kvGet('sp_finance_pm_inline')) || {}
      const mos = Object.keys(sum.months || {}).sort()
      const cust = {}
      for (let i = 0; i < mos.length; i += 12) {
        const docs = await Promise.all(mos.slice(i, i + 12).map((m) => kvGet('sp_finance_pm_inline_' + m)))
        for (const doc of docs) {
          for (const [d, arr] of Object.entries(doc?.days || {})) {
            for (const r of arr) {
              const name = (r.name || '').trim()
              const key = r.cid || r.phone || (name ? 'n:' + name : '') // cid=inline 客人檔口徑（同人換名/沒留電話合併）
              if (!key) continue
              const c = cust[key] = cust[key] || { name, phone: '', seat: 0, book: 0, cx: 0, guests: 0, last: '' }
              if (name && (!c.name || name.length > c.name.length)) c.name = name
              if ((r.phone || '').length > (c.phone || '').length) c.phone = r.phone
              if (r.cid && !c.cid) c.cid = r.cid
              c.book++
              if (CANCELED_STATES.includes(r.st)) c.cx++
              else { if (r.st === 4) { c.seat++; c.guests += r.n || 0 }; if (d > c.last) c.last = d }
            }
          }
        }
      }
      const topN = Math.min(30, Number(req.query.n) || 10)
      // 聚合選人 → inline 官方客人檔統計定次數（與 line-webhook queryResvTop 同款；楊主委=楊安娜案）
      const cands = Object.values(cust).filter((c) => c.name && (c.phone || '').replace(/\D/g, '').length >= 8).sort((a, b) => b.seat - a.seat || b.book - a.book).slice(0, Math.min(30, topN * 2))
      try {
        const token = await inlineLogin()
        await Promise.all(cands.map(async (c) => {
          if (!c.cid) return
          const o = await inlineCustomer(token, c.cid)
          // 取消＝全部−入座−NoShow 反推（官方取消欄位名不固定）
          if (o?.stats?.total != null) { c.seat = o.stats.seated ?? c.seat; c.bookOfficial = o.stats.total; c.cx = o.stats.total - (o.stats.seated || 0) - (o.stats.noShow || 0) }
        }))
      } catch (_) {}
      const rank = cands.sort((a, b) => b.seat - a.seat || b.book - a.book).slice(0, topN)
      return res.status(200).json({ ok: true, customers: Object.keys(cust).length, rank })
    }
    // 回填口
    if (req.query?.backfill) {
      if (!mk || String(req.query.backfill) !== mk) return res.status(403).json({ ok: false })
      const { from, to } = req.query
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return res.status(400).json({ ok: false, error: '要 from/to=YYYY-MM-DD' })
      const out = await syncRange(from, to)
      return res.status(200).json({ ok: true, ...out })
    }
    // cron：①滾動窗 前3天～未來45天 ②遠期（45天後全部，搜尋端點）③顧客庫/洞察超過20小時自動重建
    const t = twToday()
    const out = await syncRange(addDays(t, -3), addDays(t, 45))
    const far = await syncFuture(await inlineLogin())
    let cb = {}
    try {
      const idx = await kvGet('sp_finance_pm_inline_custidx')
      if (!idx?.builtAt || Date.now() - new Date(idx.builtAt).getTime() > 20 * 3600e3) cb = await custBuild()
    } catch (e) { cb = { custErr: e?.message } }
    return res.status(200).json({ ok: true, ...out, ...far, ...cb })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
