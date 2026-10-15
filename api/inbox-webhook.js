// 📥 官方帳號收件匣 webhook v4.70.61（relay 帳號＝DD：萬一 DD 的 webhook 被指到這裡，原封轉給 /api/line-webhook 讓 DD 照常回話，這裡不存——由 line-webhook 轉進收件匣）（溝通中樞第三部：三個官方帳號共用這一個網址）
// LINE Developers 每個帳號的 Webhook URL 都填：https://ground-pm.vercel.app/api/inbox-webhook
// 流程：讀原始 body → 用哪個帳號的 secret 驗得過＝哪個帳號（驗不過一律 401，不處理）→ 事件去重（webhookEventId）→ 存訊息＋更新對話＋通知 → 200
// 跟 DD（api/line-webhook.js）完全分開：DD 的帳號不會打到這裡，這裡也不會回答任何問題（只收、存、通知；回覆由 app 端點 mail-sync ?inbox= 發）
import { acctBySignature, ingestEvent, noteSigFail, ACCOUNTS, configured, forwardRaw, ibQueue, ibDequeue, ibRetry } from './_inbox.js'
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
  if (a.relay) {
    const origin = 'https://' + String(req.headers['x-forwarded-host'] || req.headers.host || 'ground-pm.vercel.app')
    let ok = false; try { const r = await fetch(origin + '/api/line-webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig }, body: raw }); ok = r.ok } catch (e) { console.log('[inbox] relay fail', a.key, e?.message) }
    console.log('[inbox] relay', a.key, ok)
    return res.status(200).json({ ok: true, relayed: ok })
  }
  const fwdP = forwardRaw(a, raw, sig).catch(() => null) // 有設轉發對象（原本接著的系統）就同時原封轉過去，跟我們自己的存檔並行
  let body = {}; try { body = JSON.parse(raw.toString('utf8') || '{}') } catch (_) {}
  const events = Array.isArray(body.events) ? body.events : []
  let n = 0, lost = 0
  for (const ev of events) {
    // v4.71.122（關卡 3 inbox 第一輪 A3）：先存原始事件（待補存佇列）再處理、處理完才刪；佇列也存不進去＝不做事件去重標記、處理失敗就回 500 讓 LINE 重送
    const qok = await ibQueue(a, ev, body.destination, 'recv')
    try {
      if (qok && ev.webhookEventId) { const once = await ddEventOnce('ib_' + ev.webhookEventId); if (once === false) continue } // 已處理過（或處理中）：佇列那份交給補存，套用時會判斷重複
      const r = await ingestEvent(a, ev, body.destination)
      if (r) n++
      if (qok) await ibDequeue(a, ev)
    } catch (e) { console.log('[inbox] event error', a.key, ev.type, e?.message); if (!qok) lost++ } // 佇列有存＝之後補存；沒存＝回 500
  }
  try { const rq = await ibRetry({ limit: 5 }); if (rq.seen) console.log('[inbox] 補存', JSON.stringify(rq)) } catch (_) {} // 順手補存之前沒存上的
  const fwd = await fwdP
  console.log('[inbox] ok', a.key, events.length, n, fwd ? 'fwd=' + (fwd.ok ? fwd.status : 'fail') : '')
  if (lost) return res.status(500).json({ ok: false, error: '暫時存不進去，請 LINE 重送', n }) // 原始事件連佇列都沒存上＝讓 LINE 重送（沒有標記去重，重送會再處理）
  return res.status(200).json({ ok: true, n, fwd: fwd ? fwd.ok : undefined })
}
