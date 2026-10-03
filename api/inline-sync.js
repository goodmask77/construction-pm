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
import { inlineLogin, inlineFetchDay, inlineSearchFuture, inlineFetchDayNotes, CANCELED_STATES } from './_inline.js'
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
  // 遠期清單直接放總覽（AI 兩邊都載總覽＝不用撈到未來月檔就能答「哪天已被訂」）
  sum.farFuture = Object.keys(far).sort().flatMap((d) => far[d].map((r) => ({ d, ...r })))
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

export default async function handler(req, res) {
  const mk = (process.env.MENU_PROBE_KEY || '').trim()
  try {
    // 盤點口
    if (req.query?.probe) {
      if (!mk || String(req.query.probe) !== mk) return res.status(403).json({ ok: false })
      const sum = (await kvGet('sp_finance_pm_inline')) || {}
      return res.status(200).json({ ok: true, sum })
    }
    // 回填口
    if (req.query?.backfill) {
      if (!mk || String(req.query.backfill) !== mk) return res.status(403).json({ ok: false })
      const { from, to } = req.query
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return res.status(400).json({ ok: false, error: '要 from/to=YYYY-MM-DD' })
      const out = await syncRange(from, to)
      return res.status(200).json({ ok: true, ...out })
    }
    // cron：①滾動窗 前3天～未來45天 ②遠期（45天後全部，搜尋端點）
    const t = twToday()
    const out = await syncRange(addDays(t, -3), addDays(t, 45))
    const far = await syncFuture(await inlineLogin())
    return res.status(200).json({ ok: true, ...out, ...far })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
