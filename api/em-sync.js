// ── EM 包場系統同步（小夏做的 em-abeach.vercel.app/api/v1；張良 2026-10-04「小夏的來了 幫我接上」）──
// 唯讀 API（x-api-key＝EM_API_KEY，scopes: projects/quotes/tasks read）；案件/任務量小（77案/218任務）
// → 每小時全量覆蓋單檔 sp_finance_pm_em = { projects:[瘦身列…], tasks:[…], lastSync }（冪等、刪除自然反映）
// 消毒：同 boss-sync 教訓（阿桑 2026-10-04「被塞亂碼你也會收到」）——字串去 HTML/控制字元/截長度
// cron：vercel.json 每小時 :40；手動 GET /api/em-sync（?manual=1 同義）
import { kvGet, kvPut, announceChanged } from './mail-sync.js'

const BASE = 'https://em-abeach.vercel.app/api/v1'
const KEY = (process.env.EM_API_KEY || '').trim()
const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g')
const san = (v, cap = 300) => { if (v == null) return null; let s = String(v).replace(/<[^>]*>/g, '').replace(CTRL, '').trim(); return s.length > cap ? s.slice(0, cap) + '…' : s }

async function fetchAll(path, params) {
  const out = []
  let offset = 0
  for (let page = 0; page < 10; page++) { // 量小；10頁(5000筆)保險上限
    const qs = new URLSearchParams({ limit: '500', offset: String(offset), ...(params || {}) }).toString()
    const r = await fetch(`${BASE}${path}?${qs}`, { headers: { 'x-api-key': KEY } })
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('EM 金鑰無效/scope 不足'), { auth: true })
    if (!r.ok) throw new Error(`EM ${path} HTTP ${r.status}`)
    const j = await r.json()
    const rows = Array.isArray(j) ? j : (j.data || [])
    out.push(...rows)
    if (rows.length < 500) break
    offset += 500
  }
  return out
}

export default async function handler(req, res) {
  if (!KEY) return res.status(200).json({ ok: false, skipped: '未設 EM_API_KEY' })
  try {
    const [pr, tk] = await Promise.all([fetchAll('/projects'), fetchAll('/tasks')])
    const projects = pr.map(p => ({
      id: p.id, code: san(p.code, 40), title: san(p.title, 80), status: san(p.status, 20),
      type: san(p.case_type, 20), event: san(p.event_type, 30), date: san(p.event_date, 10),
      start: san(p.start_time, 5), end: san(p.end_time, 5), n: p.people_count ?? null,
      dining: san(p.dining_style, 20), venue: san(p.venue_scope, 40), owner: san(p.owner, 20),
      cust: san(p.customer && p.customer.name, 30),
      budget: p.budget ?? null, recv: p.receivable_total ?? null, actual: p.actual_total ?? null,
      deposit: san(p.deposit_status, 20), quote: p.current_quote_total ?? null, changed: san(p.last_changed_at, 19),
    })).sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1))
    const tasks = tk.map(t => ({
      id: t.id, code: san(t.project && t.project.code, 40), ptitle: san(t.project && t.project.title, 60),
      pdate: san(t.project && t.project.event_date, 10), dept: san(t.dept, 15), title: san(t.title, 100),
      who: san(t.assignee, 20), due: san(t.due_date, 10), st: san(t.progress, 10), note: san(t.note, 150),
    })).sort((a, b) => (String(a.due) < String(b.due) ? 1 : -1))
    await kvPut('sp_finance_pm_em', { projects, tasks, lastSync: new Date().toISOString() }, 'EM包場同步')
    await announceChanged()
    return res.status(200).json({ ok: true, projects: projects.length, tasks: tasks.length })
  } catch (e) {
    // 401=金鑰失效 → DD 私訊老闆一次（同 boss-sync 慣例：當天只提醒一次）
    if (e.auth) {
      try {
        const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
        const st = (await kvGet('sp_finance_pm_em_state')) || {}
        if (st.auth401 !== today) {
          st.auth401 = today
          await kvPut('sp_finance_pm_em_state', st, 'EM金鑰失效記錄')
          const tkL = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
          const boss = (process.env.LINE_BOSS_USER || '').trim() || 'Uf7ce4fb9191cd3055247204e0cb6b4fc'
          if (tkL) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkL }, body: JSON.stringify({ to: boss, messages: [{ type: 'text', text: '⚠️ EM 包場同步：金鑰失效（401），已停。請跟小夏拿新的 emk_ 金鑰後更新 Vercel 的 EM_API_KEY。' }] }) })
        }
      } catch (_) {}
    }
    return res.status(200).json({ ok: false, error: e.message })
  }
}
