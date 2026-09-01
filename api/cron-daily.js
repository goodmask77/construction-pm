// 後端：每日工地速報（由 Vercel Cron 觸發，見 vercel.json）。
// 讀 pm_bot_context 快照 → 組速報 → 推到工地群。沒設 LINE token 前＝安全 no-op。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const GROUP = clean(process.env.LINE_DEFAULT_GROUP) || 'Cf7940efc6517b0c084ad2ad496b45f30'
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()

async function kvGet(id) {
  if (!SB_URL || !SB_KEY) return null
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows = r.ok ? await r.json() : []
    if (rows[0]?.data?.v) return JSON.parse(rows[0].data.v)
  } catch (_) {}
  return null
}
const loadSnapshot = () => kvGet('pm_bot_context')

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
  // 三個資料同步：失敗不影響速報，但要「留下失敗紀錄」（以前默默吞掉＝資料變舊都不知道）
  const syncErrs = []
  const syncOne = async (label, url) => { try { const r = await fetch(url); if (!r.ok) syncErrs.push(`${label} ${r.status}`) } catch (e) { syncErrs.push(`${label} ${e?.message || 'fail'}`) } }
  await syncOne('sheet-sync', 'https://ground-pm.vercel.app/api/sheet-sync') // 對帳中心：公司帳務試算表
  await syncOne('mail-sync', 'https://ground-pm.vercel.app/api/mail-sync?days=10') // 自動收信：中信 e-Cash + Eats365 POS 日結
  await syncOne('mail-manage', 'https://ground-pm.vercel.app/api/mail-manage?action=apply&days=7') // 信箱管理規則
  if (syncErrs.length) console.log('cron-daily sync errors:', syncErrs.join('; '))
  if (!TOKEN) return res.status(200).json({ ok: false, skipped: '未設 LINE_CHANNEL_ACCESS_TOKEN' })
  // 尊重「設定 → LINE 通知」開關（張良 2026-07-18：關了還照發＝bug）；沒勾就只做資料同步、不推播
  const settings = (await kvGet('pm_settings')) || {}
  const notify = settings.lineNotify || {}
  // 總開關：暫停所有 LINE 通知 → 只做資料同步、完全不推播（張良 2026-07-31）
  if (notify.pauseAll) return res.status(200).json({ ok: true, skipped: '已暫停所有 LINE 通知（總開關），僅完成資料同步' })
  const target = clean(settings.lineGroupId) || GROUP
  const messages = []
  if (notify.daily) {
    const snap = await loadSnapshot()
    const text = buildReport(snap)
    if (text) messages.push({ type: 'text', text })
  }
  // 360評鑑：每週五（台北時間）「回饋時間」提醒——跟著「AI 週報每週五」開關走
  const taipeiDay = new Date(Date.now() + 8 * 3600e3).getUTCDay()
  if (taipeiDay === 5 && notify.weekly) messages.push({ type: 'text', text: '💬 每週回饋時間！\n花 30 秒到「夥伴中心 → 回饋」，給一位夥伴一句具體的鼓勵或建議（可匿名）。\n被按「幫到我」還會加分，衝一波回饋王 👑\nhttps://ground-pm.vercel.app/' })
  if (!messages.length) return res.status(200).json({ ok: true, skipped: '通知開關未勾選，僅完成資料同步、未推播' })
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ to: target, messages: messages.slice(0, 5) }),
    })
    if (r.ok) { try { const { logPush, groupMembers } = await import('./push.js'); const m = await groupMembers(target); await logPush(target, messages.length, '每日彙報', m) } catch (_) {} }
    return res.status(200).json({ ok: r.ok, pushed: messages.length })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message })
  }
}
