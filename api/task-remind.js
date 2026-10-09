// ── 任務卡「定期提醒」引擎（張良 2026-10-09；每小時整點 cron）──
// 前端設定存 task.reminder = { on, freq:'daily'|'weekday'|'custom', days:[0..6], hours:[整點], ch:['push','dm','group'], count, lastSlot }
// 這支每小時整點跑：挑出「今天這個星期 × 這個整點 該提醒、且本小時還沒提醒過」的任務 → 發 push/LINE私訊/群組 → count+1、記 lastSlot 防重複
// 對象＝任務負責人 t.owner（姓名）→ 經 sp_finance_pm_prep_bind 對到 rid(push)/lineUserId(私訊)
import { kvGet, kvPut } from './mail-sync.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const GRP_TASK = 'Cf7940efc6517b0c084ad2ad496b45f30' // GD 任務群（與 tasknotify 同一個群）

export default async function handler(req, res) {
  try {
    // 守門：Vercel cron 自動呼叫（帶 x-vercel-cron）；手動測可帶 ?key=<OPS_BOARD_KEY>
    const isCron = !!req.headers['x-vercel-cron'] || /vercel/i.test(req.headers['user-agent'] || '')
    const keyOk = req.query && req.query.key && String(req.query.key) === clean(process.env.OPS_BOARD_KEY)
    if (!isCron && !keyOk) return res.status(403).json({ ok: false, error: 'forbidden' })

    // 台灣時間：星期與整點（+8 後用 UTC 取值）
    const tw = new Date(Date.now() + 8 * 3600e3)
    const wd = tw.getUTCDay()        // 0=日…6=六（對齊前端 tnREM_WD）
    const hr = tw.getUTCHours()      // 0..23 整點
    const slot = tw.toISOString().slice(0, 13) // YYYY-MM-DDTHH ＝本小時唯一碼（防同一小時重複發）

    // 讀所有任務
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.sp_team_pm_task_*&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows = r.ok ? await r.json() : []

    // 對象解析（照 mail-sync tasknotify 同一套）
    const bd = (await kvGet('sp_finance_pm_prep_bind')) || {}
    const uidByName = nm => { for (const [u, tk] of Object.entries(bd.byUid || {})) { if (((bd.tokens || {})[tk] || {}).name === nm) return u } return null }
    const allIdsByName = nm => { const s = new Set(); for (const v of Object.values(bd.tokens || {})) if (v && v.name === nm) { if (v.rid) s.add(v.rid); if (v.uid) s.add(v.uid) } return [...s] }
    const { wpPush, prepLink } = await import('./_webpush.js')
    const tkL = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
    const linePush = (to, text) => tkL ? fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkL }, body: JSON.stringify({ to, messages: [{ type: 'text', text }] }) }).catch(() => {}) : null

    let checked = 0, reminded = 0
    for (const row of rows) {
      let t; try { t = row && row.data && row.data.v ? JSON.parse(row.data.v) : null } catch (_) { t = null }
      if (!t || !t.id) continue
      const rm = t.reminder
      if (!rm || !rm.on) continue
      if (t.done || t.status === 'done' || t.archived) continue // 已完成／封存不提醒
      checked++
      // 頻率：daily=每天；weekday=週一~五；custom=指定星期
      const freqOk = rm.freq === 'weekday' ? (wd >= 1 && wd <= 5) : rm.freq === 'custom' ? (rm.days || []).includes(wd) : true
      if (!freqOk) continue
      if (!(rm.hours || []).includes(hr)) continue // 時段不符
      if (rm.lastSlot === slot) continue            // 本小時已提醒過

      const ch = (rm.ch && rm.ch.length) ? rm.ch : ['push']
      const title = String(t.title || t.name || '任務').slice(0, 80)
      const url = '/prep#task=' + t.id
      const lnk = prepLink('task=' + t.id)
      const owner = String(t.owner || '')
      try {
        if (ch.includes('push')) { const ids = allIdsByName(owner); if (ids.length) await wpPush(ids, { title: '🔔 定期提醒', body: title, url }) }
        if (ch.includes('dm')) { const u = uidByName(owner); if (u) await linePush(u, `🔔 定期提醒｜${title}${owner ? `\n負責人：${owner}` : ''}\n點開直達這張卡 👇\n${lnk}`) }
        if (ch.includes('group')) await linePush(GRP_TASK, `🔔 定期提醒｜${title}${owner ? `（負責人：${owner}）` : ''}\n點開直達這張卡 👇\n${lnk}`)
      } catch (_) {}

      rm.count = (Number(rm.count) || 0) + 1
      rm.lastSlot = slot
      t.reminder = rm; t.updatedAt = new Date().toISOString()
      await kvPut('sp_team_pm_task_' + t.id, t, '定期提醒cron')
      reminded++
    }
    return res.status(200).json({ ok: true, tw: slot, wd, hr, checked, reminded })
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }) }
}
