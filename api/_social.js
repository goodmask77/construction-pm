// ── 社群自動發文＋成效 共用模組（張良 2026-10-08：FB/IG 內容系統，Phase 1 先 FB 只讀數據）──
// 設計同其他整合（em-sync/boss-sync）：KV 存資料、機密 token 另存一檔永不回前端、Graph API 呼叫包一層
// 標籤頁代碼＝'social'（permWho/canTab 用）；資料鍵前綴 sp_finance_pm_social_*
import { kvGet, kvPut } from './mail-sync.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()

export const GV = clean(process.env.META_GRAPH_VERSION) || 'v21.0' // ⚠️ Meta 版本會變，設 env 可隨時換不用改碼
export const APP_ID = clean(process.env.META_APP_ID)
export const APP_SECRET = clean(process.env.META_APP_SECRET)
export const REDIRECT_URI = clean(process.env.SOCIAL_REDIRECT) || 'https://ground-pm.vercel.app/api/social-oauth'
export const DRY_RUN = /^(1|true|yes)$/i.test(clean(process.env.SOCIAL_DRY_RUN)) // 發文測試模式：只記 log 不真打 Meta
export const GRAPH = `https://graph.facebook.com/${GV}`
export const metaReady = () => !!(APP_ID && APP_SECRET)

// KV 鍵：帳號狀態（可回前端）／機密 token（永不回前端）／貼文／成效月檔
const A_KEY = 'sp_finance_pm_social_accounts', S_KEY = 'sp_finance_pm_social_secret', P_KEY = 'sp_finance_pm_social_posts'
export const getAccounts = async () => (await kvGet(A_KEY)) || {}
export const setAccounts = (o, editor = '社群') => kvPut(A_KEY, o, editor)
export const getSecret = async () => (await kvGet(S_KEY)) || {}
export const setSecret = (o, editor = '社群token') => kvPut(S_KEY, o, editor)
export const getPosts = async () => (await kvGet(P_KEY)) || { list: [] }
export const setPosts = (o, editor = '社群') => kvPut(P_KEY, o, editor)
export const metricsKey = (ym) => 'sp_finance_pm_social_metrics_' + ym
// 多粉專：token 依 pageId 取（相容舊單粉專 pageToken）
export async function fbPageToken(pageId) {
  const s = await getSecret()
  const t = (s.facebook && s.facebook.tokens) || {}
  if (pageId) return t[pageId] || ''
  return Object.values(t)[0] || (s.facebook && s.facebook.pageToken) || ''
}
export async function fbPages() { const a = await getAccounts(); return (a.facebook && a.facebook.pages) || {} }

// Graph API：GET（查詢）／POST（發文）。錯誤統一丟 Error 帶 .code（190=token失效、4/17/32/613=rate limit）
export async function graphGet(path, params = {}, token) {
  const qs = new URLSearchParams({ ...(token ? { access_token: token } : {}), ...params }).toString()
  const r = await fetch(`${GRAPH}${path}?${qs}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) { const e = new Error((j.error && j.error.message) || ('Graph HTTP ' + r.status)); e.code = j.error && j.error.code; e.graph = j.error; throw e }
  return j
}
export async function graphPost(path, params = {}, token) {
  const r = await fetch(`${GRAPH}${path}`, { method: 'POST', body: new URLSearchParams({ ...(token ? { access_token: token } : {}), ...params }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) { const e = new Error((j.error && j.error.message) || ('Graph HTTP ' + r.status)); e.code = j.error && j.error.code; e.graph = j.error; throw e }
  return j
}

// 身分＋編輯權（複製 mail-sync 的 sopWho/permWho 同一套邏輯；標籤頁='social'）
export async function whoSocial(token) {
  if (!token) return null
  const b = (await kvGet('sp_finance_pm_prep_bind')) || {}
  const w = (b.tokens || {})[token]
  if (!w) return null
  let role = '一般'
  try { const r = (await kvGet('sp_crew_kb_roster')) || {}; const p = (r.people || []).find(x => x.id === w.rid); if (p && p.gdRole) role = p.gdRole } catch (_) {}
  if (role === '停權') return null
  const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }
  const u = pm.users[w.rid || w.uid] || {}
  return { rid: w.rid, uid: w.uid, name: w.name, role, admin: !!u.admin, _mode: pm.mode, _u: u }
}
export function canEditSocial(who) {
  if (!who) return false
  if (who._mode !== 'approve') return true
  const u = who._u
  return !!(u && u.edit && (u.admin || !u.tabs || u.tabs['social'] !== 0))
}
