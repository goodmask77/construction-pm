// ── A Beach inline 訂位同步（張良 2026-10-03「所有訂位資訊紀錄」）────────────
// cron（vercel.json 每小時 :25）：同步「前 3 天 ～ 未來 45 天」滾動窗（新訂/改期/取消/入座隨時變）
// 手動口（金鑰同 MENU_PROBE_KEY）：
//   ?backfill=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD → 回填區間（一次最多 150 天，歷史回填分批打）
//   ?probe=<key>                                   → 各月筆數盤點
// 入庫：sp_finance_pm_inline_<YYYY-MM>＝{ days: { 'YYYY-MM-DD': [瘦身訂位…] }, updatedAt }（月檔，key=訂位日）
//       sp_finance_pm_inline＝{ firstDay, lastSync, months: { 'YYYY-MM': { days, resv, guests } } }（總覽，AI/probe 用）
import { inlineLogin, inlineFetchDay } from './_inline.js'
import { kvGet, kvPut, announceChanged } from './mail-sync.js'

const DAY = 86400e3
const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10)

function dateRange(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

// 同步一段日期：登入一次、5 併發抓、按月整批寫回
async function syncRange(from, to) {
  const days = dateRange(from, to)
  if (days.length > 150) throw new Error(`一次最多 150 天（現在 ${days.length}）`)
  const token = await inlineLogin()
  const byDay = {}
  for (let i = 0; i < days.length; i += 5) {
    await Promise.all(days.slice(i, i + 5).map(async (d) => { byDay[d] = await inlineFetchDay(token, d) }))
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
      if (byDay[d].length) { doc.days[d] = byDay[d]; resv += byDay[d].length }
      else delete doc.days[d] // 空日不佔空間（公休/無訂位）
    }
    doc.updatedAt = new Date().toISOString()
    await kvPut(key, doc, 'inline訂位同步')
    // 總覽同月統計（guests 不含已取消）
    const dd = Object.values(doc.days)
    sum.months[mo] = { days: dd.length, resv: dd.reduce((t, a) => t + a.length, 0), guests: dd.reduce((t, a) => t + a.reduce((x, r) => x + (r.st === 2 ? 0 : r.n || 0), 0), 0) }
  }
  sum.lastSync = new Date().toISOString()
  await kvPut('sp_finance_pm_inline', sum, 'inline訂位同步')
  await announceChanged()
  return { days: days.length, resv }
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
    // cron：滾動窗 前3天～未來45天
    const t = twToday()
    const out = await syncRange(addDays(t, -3), addDays(t, 45))
    return res.status(200).json({ ok: true, ...out })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
