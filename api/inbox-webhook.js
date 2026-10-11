// 📥 官方帳號收件匣 webhook v4.70.47（溝通中樞第三部：三個官方帳號共用這一個網址）
// LINE Developers 每個帳號的 Webhook URL 都填：https://ground-pm.vercel.app/api/inbox-webhook
// 流程：讀原始 body → 用哪個帳號的 secret 驗得過＝哪個帳號（驗不過一律 401，不處理）→ 事件去重（webhookEventId）→ 存訊息＋更新對話＋通知 → 200
// 跟 DD（api/line-webhook.js）完全分開：DD 的帳號不會打到這裡，這裡也不會回答任何問題（只收、存、通知；回覆由 app 端點 mail-sync ?inbox= 發）
import { acctBySignature, ingestEvent, noteSigFail, ACCOUNTS, configured, forwardRaw } from './_inbox.js'
import { ddEventOnce } from './_ddhealth.js'

export const config = { api: { bodyParser: false } }
const readRaw = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', () => resolve(Buffer.alloc(0))) })

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, inbox: true, accounts: ACCOUNTS.map(a => ({ key: a.key, name: a.name, configured: configured(a) })) })
  if (req.method !== 'POST') return res.status(405).end()
  const raw = await readRaw(req)
  const sig = String(req.headers['x-line-signature'] || '')
  const a = acctBySignature(raw, sig)
  if (!a) { noteSigFail().catch(() => {}); console.log('[inbox] sig fail', { rawLen: raw.length, sigPresent: !!sig }); return res.status(401).json({ ok: false, error: 'bad signature' }) }
  const fwdP = forwardRaw(a, raw, sig).catch(() => null) // 有設轉發對象（原本接著的系統）就同時原封轉過去，跟我們自己的存檔並行
  let body = {}; try { body = JSON.parse(raw.toString('utf8') || '{}') } catch (_) {}
  const events = Array.isArray(body.events) ? body.events : []
  let n = 0
  for (const ev of events) {
    try {
      if (ev.webhookEventId) { const once = await ddEventOnce('ib_' + ev.webhookEventId); if (once === false) continue } // 重送＝已處理過就跳過（第一次沒處理完的仍會進來）
      const r = await ingestEvent(a, ev, body.destination)
      if (r) n++
    } catch (e) { console.log('[inbox] event error', a.key, ev.type, e?.message) }
  }
  const fwd = await fwdP
  console.log('[inbox] ok', a.key, events.length, n, fwd ? 'fwd=' + (fwd.ok ? fwd.status : 'fail') : '')
  return res.status(200).json({ ok: true, n, fwd: fwd ? fwd.ok : undefined })
}
