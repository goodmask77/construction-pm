// ── AB 預做節奏表資料（張良 2026-09-22：「AB產品銷售也一樣做出來」）──
// Eats365 dailyReport 吃任意時間區段（2026-09-21 實測）→ 不用快照差分：直接逐 15 分窗撈當天品項份數。
// 每天打烊後 cron 建當日檔 sp_finance_pm_pos_q_ab_<date> = {date, slots:[{t,items:{品名:份數}}]}（t=窗起點、值=該窗實賣）
// 歷史回補：?force=<MENU_PROBE_KEY>&date=YYYY-MM-DD 指定日；?force&back=1 自動找最近還沒建檔的營業日建一天。
// 窗：11:30~21:15 起點、每 15 分（AB 12:30 開但抓寬一點）＝40 請求/天，間隔 300ms 溫柔打。
import { kvGet, kvPut, announceChanged } from './mail-sync.js'
import { eatsSession, eatsItemsRange } from './_eats.js'

const SLOTS = []
for (let t = 11 * 60 + 30; t <= 21 * 60 + 15; t += 15) SLOTS.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'))
const plus15 = (hm) => { const m = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + 14; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export default async function handler(req, res) {
  const mk = (process.env.MENU_PROBE_KEY || '').trim()
  const force = mk && String(req.query?.force || '') === mk
  if (!process.env.EATS_USER || !process.env.EATS_PASS) return res.status(200).json({ ok: false, skipped: '缺 EATS 憑證' })
  try {
    // 要建哪一天：指定 date ＞ back=1(找最近缺檔營業日) ＞ 今天（cron 打烊後）
    let date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.date || '')) ? String(req.query.date) : null
    if (!date && force && req.query?.back) {
      const store = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
      const abDays = store.entries.filter(e => /beach|abeach/i.test(String(e.store || '')) && e.revenue > 0).map(e => e.date).sort().reverse().slice(0, 14)
      for (const dd of abDays) { const ex = await kvGet('sp_finance_pm_pos_q_ab_' + dd); if (!ex || !(ex.slots || []).length) { date = dd; break } }
      if (!date) return res.status(200).json({ ok: true, skipped: '近 14 個營業日都建好了' })
    }
    if (!date) date = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const ex = await kvGet('sp_finance_pm_pos_q_ab_' + date)
    if (ex && (ex.slots || []).length >= SLOTS.length && !req.query?.refresh) return res.status(200).json({ ok: true, skipped: date + ' 已建檔', slots: ex.slots.length })
    const sessDoc = (await kvGet('sp_finance_pm_eats_sess')) || {}
    const sess = await eatsSession(sessDoc.device || process.env.EATS_DEVICE_COOKIE || '')
    const devName = Object.keys(sess.J.jar).find((k) => k.endsWith('|'))
    if (devName) await kvPut('sp_finance_pm_eats_sess', { device: devName + '=' + sess.J.jar[devName], updatedAt: new Date().toISOString() }, 'AB節奏') // cookie 滾動續期（同 syncEatsLive）
    const slots = []
    let total = 0
    for (const t of SLOTS) {
      const items = await eatsItemsRange(sess, `${date} ${t}:00`, `${date} ${plus15(t)}:59`)
      const n = Object.values(items).reduce((a, b) => a + b, 0)
      total += n
      if (n > 0) slots.push({ t, items })
      await sleep(300)
    }
    await kvPut('sp_finance_pm_pos_q_ab_' + date, { date, kind: 'win', slots, updatedAt: new Date().toISOString() }, 'AB節奏表建檔 ' + date)
    await announceChanged()
    return res.status(200).json({ ok: true, date, slots: slots.length, qty: total })
  } catch (e) { return res.status(200).json({ ok: false, error: e?.message }) }
}
