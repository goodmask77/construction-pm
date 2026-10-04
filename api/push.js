// 後端：發送 LINE 推播訊息（取代舊外部專案 ground-pm-webhook/api/push）。
// 需要環境變數 LINE_CHANNEL_ACCESS_TOKEN。前端帶 X-API-Key（預設沿用舊金鑰，可用 LINE_PUSH_KEY 覆寫）。
// 尚未設定 token 前，前端仍指向舊的外部 push，不影響現況；設好後把 App 的 LINE_PUSH_URL 改成 /api/push 即可切過來。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
// v4.44.0 金鑰洞修補（2026-10-04：repo 公開＝舊寫死金鑰曝光,實測任何人可冒 DD 推播,連群組 ID 都在公開程式碼裡）：
// 不再有寫死預設——X-API-Key 只認環境變數 LINE_PUSH_KEY（沒設=這條路直接停用）；App 前端改走「登入權杖」驗證（下方）
const PUSH_KEY = clean(process.env.LINE_PUSH_KEY)
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
    // v4.44.0 雙軌驗證：① X-API-Key＝環境變數 LINE_PUSH_KEY（伺服器對伺服器；沒設環境變數=停用）
    // ② Authorization: Bearer <App 登入權杖> → 向 Supabase 驗證是真登入者（App 內推播走這條）
    let authed = !!(PUSH_KEY && (req.headers['x-api-key'] || '') === PUSH_KEY)
    if (!authed) {
      const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
      if (jwt && SB_URL && SB_KEY) {
        try { const vr = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, authorization: `Bearer ${jwt}` } }); authed = vr.ok } catch (_) {}
      }
    }
    if (!authed) return res.status(401).json({ ok: false, error: '未授權（App 請重新整理登入後再試）' })
    if (!TOKEN) return res.status(400).json({ ok: false, error: '後端未設定 LINE_CHANNEL_ACCESS_TOKEN' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const to = body.to
    if (!to) return res.status(400).json({ ok: false, error: '缺少 to（群組/使用者 ID）' })
    // 接受 {text} 或 {messages:[...]}（LINE message 物件陣列）
    const messages = Array.isArray(body.messages) && body.messages.length
      ? body.messages.slice(0, 5)
      : [{ type: 'text', text: String(body.text || '').slice(0, 4900) || '（空訊息）' }]

    // 📊 v4.41.1（張良「每次發訊息最下方顯示消耗幾則＋使用/總則數」）：先查人數＋額度，把用量寫進訊息尾端再發
    const members = await groupMembers(to)
    const billed = messages.length * members
    try {
      const H9 = { authorization: `Bearer ${TOKEN}` }
      const [q9, c9] = await Promise.all([
        fetch('https://api.line.me/v2/bot/message/quota', { headers: H9 }).then((x) => x.json()),
        fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: H9 }).then((x) => x.json()),
      ])
      const used9 = (c9 && c9.totalUsage != null) ? c9.totalUsage : -1
      const total9 = (q9 && q9.type === 'limited') ? q9.value : -1
      if (used9 >= 0) {
        const last9 = [...messages].reverse().find((m) => m.type === 'text')
        if (last9) last9.text = String(last9.text).slice(0, 4800) + `\n\n📊 本次 ${billed} 則｜本月 ${used9 + billed}${total9 > 0 ? '/' + total9 : ''} 則`
      }
    } catch (_) {}
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ to, messages }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return res.status(400).json({ ok: false, error: d?.message || `LINE 回應 ${r.status}` })
    }
    await logPush(to, messages.length, body.src || 'App推播(叫貨單/D發群)', members)
    return res.status(200).json({ ok: true, members, billed })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || '伺服器錯誤' })
  }
}
