// LINE OA 訊息額度即時查詢：本月已用/上限（官方 API）＋ 最近推播去向（pm_bot_pushlog，各推播端寫入）
// 給 設定→用量 的「LINE 訊息額度」區塊用；張良測試時不用開 LINE 官方後台。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

async function kvGet(id) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows = r.ok ? await r.json() : []
    return rows[0]?.data?.v ? JSON.parse(rows[0].data.v) : null
  } catch (_) { return null }
}

export default async function handler(req, res) {
  if (!TOKEN) return res.status(200).json({ ok: false, error: '未設 LINE_CHANNEL_ACCESS_TOKEN' })
  try {
    const H = { authorization: `Bearer ${TOKEN}` }
    const [qr, cr, log, seen] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers: H }).then(r => r.json()).catch(() => ({})),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: H }).then(r => r.json()).catch(() => ({})),
      kvGet('pm_bot_pushlog'),
      kvGet('pm_group_seen'),
    ])
    const nameOf = (to) => {
      if (!to) return '—'
      if (String(to).startsWith('U')) return '私訊（操作者）'
      const g = seen && seen[to]
      return (g && g.name && !/^[CRU][0-9a-f]{32}$/.test(g.name)) ? g.name : '未命名群 ' + String(to).slice(-6)
    }
    const items = ((log && log.items) || []).slice(0, 40).map(it => ({ ...it, name: nameOf(it.to) }))
    return res.status(200).json({ ok: true, limit: qr?.value ?? null, limitType: qr?.type || '', used: cr?.totalUsage ?? null, items })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) })
  }
}
