// 後端：發送 LINE 推播訊息（取代舊外部專案 ground-pm-webhook/api/push）。
// 需要環境變數 LINE_CHANNEL_ACCESS_TOKEN。前端帶 X-API-Key（預設沿用舊金鑰，可用 LINE_PUSH_KEY 覆寫）。
// 尚未設定 token 前，前端仍指向舊的外部 push，不影響現況；設好後把 App 的 LINE_PUSH_URL 改成 /api/push 即可切過來。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const PUSH_KEY = clean(process.env.LINE_PUSH_KEY) || 'ground-pm-2026-secret-abc123'

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: '僅支援 POST' })
    if ((req.headers['x-api-key'] || '') !== PUSH_KEY) return res.status(401).json({ ok: false, error: '金鑰錯誤' })
    if (!TOKEN) return res.status(400).json({ ok: false, error: '後端未設定 LINE_CHANNEL_ACCESS_TOKEN' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const to = body.to
    if (!to) return res.status(400).json({ ok: false, error: '缺少 to（群組/使用者 ID）' })
    // 接受 {text} 或 {messages:[...]}（LINE message 物件陣列）
    const messages = Array.isArray(body.messages) && body.messages.length
      ? body.messages.slice(0, 5)
      : [{ type: 'text', text: String(body.text || '').slice(0, 4900) || '（空訊息）' }]

    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ to, messages }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return res.status(400).json({ ok: false, error: d?.message || `LINE 回應 ${r.status}` })
    }
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || '伺服器錯誤' })
  }
}
