// 後端：每日工地速報（由 Vercel Cron 觸發，見 vercel.json）。
// 讀 pm_bot_context 快照 → 組速報 → 推到工地群。沒設 LINE token 前＝安全 no-op。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const GROUP = clean(process.env.LINE_DEFAULT_GROUP) || 'Cf7940efc6517b0c084ad2ad496b45f30'
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()

async function loadSnapshot() {
  if (!SB_URL || !SB_KEY) return null
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.pm_bot_context&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows = r.ok ? await r.json() : []
    if (rows[0]?.data?.v) return JSON.parse(rows[0].data.v)
  } catch (_) {}
  return null
}

const nt = (n) => 'NT$' + Math.round(n || 0).toLocaleString()

function buildReport(s) {
  if (!s) return null
  const p = s.project || {}, t = s.totals || {}, pr = s.progress || {}
  const lines = [
    `🏗 工地速報 ${new Date().toLocaleDateString('zh-TW')}`,
    p.name || '',
    `進度 ${pr.pct || 0}%（細項 ${pr.doneItems || 0}/${pr.totalItems || 0}）` + (p.daysLeft != null ? `・距完工 ${p.daysLeft} 天` : ''),
    `預估 ${nt(t.est)}｜已付 ${nt(t.paid)}｜未付 ${nt(t.unpaid)}`,
    s.petty ? `零用金餘額 ${nt(s.petty.balance)}` : '',
    (s.issues || []).length ? `⚠️ 有問題：${s.issues.slice(0, 8).join('、')}` : '✅ 無待處理問題',
  ].filter(Boolean)
  return lines.join('\n')
}

export default async function handler(req, res) {
  // 可選：用 CRON_SECRET 防止外部亂打
  const secret = clean(process.env.CRON_SECRET)
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) return res.status(401).json({ ok: false })
  if (!TOKEN) return res.status(200).json({ ok: false, skipped: '未設 LINE_CHANNEL_ACCESS_TOKEN' })
  const snap = await loadSnapshot()
  const text = buildReport(snap)
  if (!text) return res.status(200).json({ ok: false, skipped: '無快照資料' })
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ to: GROUP, messages: [{ type: 'text', text }] }),
    })
    return res.status(200).json({ ok: r.ok })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message })
  }
}
