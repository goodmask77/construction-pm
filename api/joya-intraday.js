// GROUN:D 盤中更新（張良 2026-08-27：喬亞後台是即時的，指定時間直接更新「今天」＋顯示更新時間）
// cron 每 30 分打一次（vercel.json，UTC 04-11 點＝台北 12:00-19:30），端點自己核對台北時間在不在名單內：
//   12:00 12:30 13:00 13:30 14:00 15:00 17:00 18:00 19:00 —— 要改時間改 SLOTS 這行就好
// 寫入規則：只蓋「今天＋intraday 標記」的記錄，絕不動正式資料；打烊後 mail-sync syncJoya 會把
// intraday 記錄當缺日重抓成最終值（盤中數字不會凍住）。手動測試：?force=<MENU_PROBE_KEY>
import { joyaLogin, joyaFetchDay, joyaBuildRecord, taipeiToday } from './_joya.js'
import { kvGet, kvPut, announceChanged } from './mail-sync.js'

// 2026-08-27 二版（張良：峰值要能切半小時看）：11:00-19:30 每半小時都抓——每次快照存 {t,rev,tx}，
// 相鄰兩張相減＝那半小時的營業額/單數（喬亞只給每小時，半小時是我們自己用快照推算的）
const SLOTS = ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30']
const WINDOW_MIN = 6 // cron 可能晚幾分鐘觸發，時間點後 6 分鐘內都算數

const taipeiHM = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

export default async function handler(req, res) {
  const hm = taipeiHM(), nowM = toMin(hm)
  const mk = (process.env.MENU_PROBE_KEY || '').trim()
  const force = mk && String(req.query?.force || '') === mk
  const manual = String(req.query?.manual || '') === '1' // 前端「🔄 更新」鈕（張良 2026-08-27：按更新要立刻抓現在的數字）
  const hit = SLOTS.some(s => nowM >= toMin(s) && nowM < toMin(s) + WINDOW_MIN)
  if (!hit && !force && !manual) return res.status(200).json({ ok: true, skipped: '非指定時間', taipei: hm })
  if (manual && !hit && !force && (nowM < toMin('11:00') || nowM >= toMin('19:30'))) {
    return res.status(200).json({ ok: true, skipped: '非營業時間（11:00-19:30 才有盤中數字）', taipei: hm })
  }
  try {
    const today = taipeiToday()
    const store = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
    const isGround = (n) => /groun/i.test(n || '')
    const cur = store.entries.find(e => e.date === today && isGround(e.store))
    if (cur && !cur.intraday) return res.status(200).json({ ok: true, skipped: '今天已是打烊後正式資料，不覆蓋', taipei: hm })
    // 手動更新冷卻 3 分鐘（端點公開，防連打狂敲喬亞）；排程時間點與金鑰不受限
    if (manual && !hit && !force && cur?.intraday && cur.fetchedAt && nowM >= toMin(cur.fetchedAt) && nowM - toMin(cur.fetchedAt) < 3) {
      return res.status(200).json({ ok: true, skipped: '剛更新過（' + cur.fetchedAt + '），3 分鐘內不重抓', taipei: hm, revenue: cur.revenue, txCount: cur.txCount })
    }
    const cookie = await joyaLogin()
    const day = await joyaFetchDay(cookie, today)
    if (day.empty) return res.status(200).json({ ok: true, skipped: '喬亞今天還沒有資料（未開店/公休）', taipei: hm })
    const rec = joyaBuildRecord(day)
    rec.intraday = true
    rec.fetchedAt = hm
    rec.period = today + '（盤中更新 ' + hm + '）'
    rec.partial = '盤中更新（' + hm + '，未打烊）：數字之後還會變，打烊後自動換成最終值。' + (rec.partial || '')
    const { _details, ...summary } = rec
    // 摘要：整筆換掉今天的盤中記錄（上面擋過正式資料，這裡只會蓋到 intraday 或沒有）
    store.entries = [...store.entries.filter(e => !(e.date === today && isGround(e.store))), summary].sort((a, b) => (a.date < b.date ? -1 : 1))
    store.updatedAt = new Date().toISOString()
    await kvPut('sp_finance_pm_pos', store, '喬亞盤中更新 ' + hm)
    // 明細月檔：同樣只蓋今天的盤中明細（品項/時段下鑽跟著即時）
    const did = 'sp_finance_pm_pos_d_' + today.slice(0, 7)
    const doc = (await kvGet(did)) || { days: {} }
    doc.days[today + '::ground'] = { date: today, period: rec.period, store: rec.store, sheets: _details, intraday: true }
    doc.updatedAt = new Date().toISOString()
    await kvPut(did, doc, '喬亞盤中更新 ' + hm)
    // 半小時快照：整點/半點視窗內的抓取記一筆 {t:時間格, at:實際抓取時刻, rev, tx}（視窗外的手動更新不記，資料格線才乾淨；同格重複抓不重記）
    const slotHit = SLOTS.find(s => nowM >= toMin(s) && nowM < toMin(s) + WINDOW_MIN)
    if (slotHit) {
      const hid = 'sp_finance_pm_pos_hh_' + today.slice(0, 7)
      const hdoc = (await kvGet(hid)) || { days: {} }
      const arr = hdoc.days[today] = hdoc.days[today] || []
      if (!arr.some(s => s.t === slotHit)) {
        arr.push({ t: slotHit, at: hm, rev: rec.revenue, tx: rec.txCount })
        hdoc.updatedAt = new Date().toISOString()
        await kvPut(hid, hdoc, '喬亞半小時快照 ' + slotHit)
      }
    }
    await announceChanged() // 開著的網頁即刻自動跟上
    return res.status(200).json({ ok: true, updated: true, taipei: hm, date: today, revenue: rec.revenue, txCount: rec.txCount, snap: slotHit || null })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e), taipei: hm })
  }
}
