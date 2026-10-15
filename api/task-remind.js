import './_qpatch.js' // v4.71.10 DD 推播統一補額度尾巴
// ── 任務卡「定期提醒」引擎（張良 2026-10-09；每小時整點 cron）──
// 前端設定存 task.reminder = { on, freq:'daily'|'weekday'|'custom', days:[0..6], hours:[整點], ch:['push','dm','group'], count, lastSlot }
// 這支每小時整點跑：挑出「今天這個星期 × 這個整點 該提醒、且本小時還沒提醒過」的任務 → 先記 lastSlot＋count（認領）→ 成功才發 push/LINE私訊/群組（v4.71.117 改先記後發）
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
    await (async () => { try { const r9 = await (await import('./_inbox.js')).inboxRemind(); console.log('[inbox] remind', JSON.stringify(r9)) } catch (e) { console.log('[inbox] remind err', e?.message) } })()
    await (async () => { try { const IB = await import('./_inbox.js'); const m7 = await IB.inboxMediaRead(); console.log('[inbox] media', JSON.stringify(m7)); const d7 = await IB.bkDetect(); const w7 = await IB.bkWatch(); console.log('[inbox] bk', JSON.stringify(d7), JSON.stringify(w7)) } catch (e) { console.log('[inbox] bk err', e?.message) } })() // v4.71.23 確定訂位日期偵測＋inline 有沒有訂＋提醒
    await (async () => { try { const r8 = await (await import('./_inbox.js')).inboxClassify(); console.log('[inbox] classify', JSON.stringify(r8)) } catch (e) { console.log('[inbox] classify err', e?.message) } })() // v4.71.12 收件匣 AI 補分類 // v4.70.47 收件匣未回覆提醒（每小時整點順便跑，fail-safe）

    // 台灣時間：星期與整點（+8 後用 UTC 取值）
    const tw = new Date(Date.now() + 8 * 3600e3)
    const wd = tw.getUTCDay()        // 0=日…6=六（對齊前端 tnREM_WD）
    const hr = tw.getUTCHours()      // 0..23 整點
    const slot = tw.toISOString().slice(0, 13) // YYYY-MM-DDTHH ＝本小時唯一碼（防同一小時重複發）

    // 讀所有任務（v4.71.115 依資料歸屬：任務域搬到新殼後改讀新殼、寫回走命令橋；_abgdkv.js）
    const { abgdKv } = await import('./_abgdkv.js')
    const kvT = await abgdKv({ domain: 'tasks', lockKey: 'sp_team_pm_task_x', operator: '定期提醒', label: '任務' })
    const all = await kvT.kvPrefix('sp_team_pm_task_')

    // 對象解析（照 mail-sync tasknotify 同一套）
    const bd = (await kvGet('sp_finance_pm_prep_bind')) || {}
    const uidByName = nm => { for (const [u, tk] of Object.entries(bd.byUid || {})) { if (((bd.tokens || {})[tk] || {}).name === nm) return u } return null }
    const allIdsByName = nm => { const s = new Set(); for (const v of Object.values(bd.tokens || {})) if (v && v.name === nm) { if (v.rid) s.add(v.rid); if (v.uid) s.add(v.uid) } return [...s] }
    const { wpPush, prepLink } = await import('./_webpush.js')
    const tkL = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
    const linePush = (to, text) => tkL ? fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkL }, body: JSON.stringify({ to, messages: [{ type: 'text', text }] }) }).catch(() => {}) : null

    let checked = 0, reminded = 0
    for (const t of Object.values(all)) {
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

      // v4.71.117 先認領再外送（關卡 3 tasks 第一輪 OpenAI A4）：讀最新那份、重新確認仍該提醒，先寫 lastSlot＋次數；
      //   寫成功才發（寫不進去＝切換中／被擋／有人同時在改到重試用完 → 這小時不發，寧可漏一次也不重發）
      let claimed = null
      try {
        await kvT.retry(async () => {
          claimed = null
          const k = 'sp_team_pm_task_' + t.id; const cur = await kvT.kvGet(k); if (!cur) return
          const r2 = cur.reminder || {}
          if (!r2.on || cur.done || cur.status === 'done' || cur.archived || r2.lastSlot === slot) return
          const f2 = r2.freq === 'weekday' ? (wd >= 1 && wd <= 5) : r2.freq === 'custom' ? (r2.days || []).includes(wd) : true
          if (!f2 || !(r2.hours || []).includes(hr)) return
          cur.reminder = { ...r2, count: (Number(r2.count) || 0) + 1, lastSlot: slot }
          cur.updatedAt = new Date().toISOString()
          await kvT.kvPut(k, cur, '定期提醒cron')
          claimed = cur
        })
      } catch (e) { console.log('[task-remind] 認領失敗（這小時不發）', t.id, e && e.message); claimed = null }
      if (!claimed) continue
      const ch = (claimed.reminder.ch && claimed.reminder.ch.length) ? claimed.reminder.ch : ['push']
      const title = String(claimed.title || claimed.name || '任務').slice(0, 80)
      const url = '/prep#task=' + t.id
      const lnk = prepLink('task=' + t.id)
      const owner = String(claimed.owner || '')
      try {
        if (ch.includes('push')) { const ids = allIdsByName(owner); if (ids.length) await wpPush(ids, { title: '🔔 定期提醒', body: title, url }) }
        if (ch.includes('dm')) { const u = uidByName(owner); if (u) await linePush(u, `🔔 定期提醒｜${title}${owner ? `\n負責人：${owner}` : ''}\n點開直達這張卡 👇\n${lnk}`) }
        if (ch.includes('group')) await linePush(GRP_TASK, `🔔 定期提醒｜${title}${owner ? `（負責人：${owner}）` : ''}\n點開直達這張卡 👇\n${lnk}`)
      } catch (_) {}
      reminded++
    }
    return res.status(200).json({ ok: true, tw: slot, wd, hr, checked, reminded })
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }) }
}
