// 後端：發送 LINE 推播訊息（取代舊外部專案 ground-pm-webhook/api/push）。
// 需要環境變數 LINE_CHANNEL_ACCESS_TOKEN。前端帶 X-API-Key（預設沿用舊金鑰，可用 LINE_PUSH_KEY 覆寫）。
// 尚未設定 token 前，前端仍指向舊的外部 push，不影響現況；設好後把 App 的 LINE_PUSH_URL 改成 /api/push 即可切過來。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const PUSH_KEY = clean(process.env.LINE_PUSH_KEY) || 'ground-pm-2026-secret-abc123'
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
// 推播去向紀錄（給 設定→用量 顯示「用在哪」）；best-effort，失敗不影響推播
export async function logPush(to, n, src, m = 1) {
  // n=訊息則數、m=群內人數、b=計費數(n×m)——LINE 群組推播按人數計費
  try {
    if (!SB_URL || !SB_KEY) return
    const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' }
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.pm_bot_pushlog&select=data`, { headers: H })
    const rows = r.ok ? await r.json() : []
    const doc = rows[0]?.data?.v ? JSON.parse(rows[0].data.v) : { items: [] }
    doc.items = [{ ts: new Date().toISOString(), to, n, m, b: n * m, src }, ...(doc.items || [])].slice(0, 200)
    await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'pm_bot_pushlog', data: { v: JSON.stringify(doc) }, editor: '推播紀錄', updated_at: new Date().toISOString() }) })
  } catch (_) {}
}

// 群組人數：LINE 群組推播「按群內人數」計費（1 則 × N 人 = N 則）——查人數才能算真實扣多少
export async function groupMembers(to) {
  try {
    if (!/^C/.test(String(to || ''))) return 1
    const r = await fetch(`https://api.line.me/v2/bot/group/${to}/members/count`, { headers: { authorization: `Bearer ${TOKEN}` } })
    const d = r.ok ? await r.json() : null
    return d?.count || 1
  } catch (_) { return 1 }
}

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
    const members = await groupMembers(to)
    const billed = messages.length * members
    await logPush(to, messages.length, body.src || 'App推播(叫貨單/D發群)', members)
    return res.status(200).json({ ok: true, members, billed })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || '伺服器錯誤' })
  }
}
