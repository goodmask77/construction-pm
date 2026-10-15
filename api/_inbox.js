import './_qpatch.js' // v4.71.10 DD 推播統一補額度尾巴
// 📥 統一收件匣 v4.70.61（+DD 帳號：DD 的一對一私訊自動進收件匣、DD 自己答過算已完成、可從收件匣用 DD 名義插手回；張良 2026-10-11「增加DD」）（舊版前端自動重新整理；沒人回提醒可設通知誰／LINE 群；帳號顯示名改 A Beach／GROUN:D／104招募；溝通中樞 docs/COMMS_PLAN.md 第三部 項目 5「只收不回」＋項目 6「從 app 回覆」合一；張良 2026-10-11「你先建構所有需要的，最後剩官方帳號金鑰」）
// 設計：
//  - 三個官方帳號（A Beach 客服／GROUN:D 客服／招募）共用一個接收端點 api/inbox-webhook.js；每個請求用「哪個帳號的 channel secret 驗得過」決定是哪個帳號（不用先知道 destination）
//  - 金鑰只在環境變數：LINE_OA_<KEY>_SECRET／LINE_OA_<KEY>_TOKEN（KEY=AB／GD／HR）；前端永遠看不到
//  - 每個對話一鍵 pm_inbox_c_<帳號>_<對方id>；每則訊息一列 pm_inbox_m_<帳號>_<對方id>_<ts36><rand>（只插入＝兩個客人同時傳不互蓋，同 1a 作法）
//  - 圖片／檔案下載後存私有桶 ground-private 的 inbox/…，app 用短效簽名網址看
//  - 回覆：收到後 50 秒內有 replyToken → reply（免費）；否則 push（扣該帳號額度）；回覆框先告訴人「免費／會扣額度」
//  - 權限：pm_inbox_cfg.perm[帳號]=姓名清單；主管（審核人／張良瑋／角色主管／perm admin）全看；清單空＝只有主管
//  - 通知：新訊息→wpPush 給有權限的人（鈴鐺＋推播，點了直達 #inbox=對話）；超過 remindMin 分鐘沒人回→每小時 cron 再提醒＋LINE 私訊審核人
import crypto from 'crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { SB_URL, SB_KEY, uploadPrivate, signedUrl, linePush } from './_onboard.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
export const INBOX_VER = '4832' // 跟 index.html 的 p24-inbox.js?v= 同步；前端每次輪詢比對，不一樣就自動重新整理（手機 PWA 常抓舊 JS，張良 10-11 錄影）
export const ACCOUNTS = [
  { key: 'ab', name: 'A Beach', env: 'LINE_OA_AB', color: '#0ea5e9' },
  { key: 'gd', name: 'GROUN:D', env: 'LINE_OA_GD', color: '#ce1611' },
  { key: 'hr', name: '104招募', env: 'LINE_OA_HR', color: '#16a34a' }, // v4.70.53 名稱照張良 10-11：A Beach／GROUN:D／104招募
  // v4.70.61 DD 本尊（@425pmzor）：relay＝webhook 留在 api/line-webhook（一個帳號只能有一個 webhook，DD 要照常回話），私訊由 line-webhook 轉進來（ddInboxBegin／ddInboxOut）；鑰匙沒設 LINE_OA_DD_* 就退回 DD 原本的 LINE_CHANNEL_*
  { key: 'dd', name: 'DD', env: 'LINE_OA_DD', color: '#7c3aed', relay: true, fallback: { secret: 'LINE_CHANNEL_SECRET', token: 'LINE_CHANNEL_ACCESS_TOKEN' } },
]
export const acctOf = (key) => ACCOUNTS.find(a => a.key === key) || null
export const creds = (a) => ({ secret: clean(process.env[a.env + '_SECRET']) || (a.fallback ? clean(process.env[a.fallback.secret]) : ''), token: clean(process.env[a.env + '_TOKEN']) || (a.fallback ? clean(process.env[a.fallback.token]) : '') })
export const configured = (a) => { const c = creds(a); return !!(c.secret && c.token) }

const H = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' })
const esc = (s) => String(s).replace(/[\\%_]/g, (m) => '\\' + m)
const nowIso = () => new Date().toISOString()
// v4.71.120 收件匣搬新殼準備（B 模式，同信箱中樞／任務）：pm_inbox_ 開頭的鍵依資料歸屬讀寫（_abgdkv：域在 GD＝原表；搬到新殼＝讀走 gdread、寫走命令橋）；
//   其他鍵（訂位 sp_finance_pm_inline_、包場 sp_finance_pm_em）照舊讀 GD。寫入失敗一律丟錯（不再默默失敗）。
// v4.71.122（關卡 3 inbox 第一輪 A1～A4）：
//   ① 只暫存「歸屬」5 秒，每次讀寫另建 abgdKv 物件（版本號不跨請求共用）
//   ② 對話（pm_inbox_c_）不再整份覆蓋：讀的時候在本次請求記下原樣（快照），存的時候只送「改了哪些欄位」，依規則套在最新內容上（新殼＝ops.inbox_apply 一個交易；GD＝程式裡同一套規則）
//   ③ 訊息＋對話一次套用（ibApply）：訊息已存在＝這個事件套用過（dup），不再改對話、不再通知
const IBP = 'pm_inbox_', IBC = 'pm_inbox_c_'
const _ibAls = new AsyncLocalStorage()
export const ibAs = (name, fn) => _ibAls.run({ op: String(name || '收件匣').slice(0, 30), snaps: new Map() }, fn) // 以操作者姓名執行（存檔帶操作者；對話快照只在這次請求內有效）
const ibStore = () => _ibAls.getStore() || null
let _ibOwner = null
async function ibKv() {
  const st = ibStore(); const op = (st && st.op) || '收件匣'
  const M = await import('./_abgdkv.js')
  if (!_ibOwner || Date.now() - _ibOwner.t > 5000) _ibOwner = { t: Date.now(), v: await M.abgdOwner('pm_inbox_x') }
  return M.abgdKv({ domain: 'inbox', lockKey: 'pm_inbox_x', operator: op, label: '收件匣', owner: _ibOwner.v })
}
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)))
const snapPut = (k, v) => { const st = ibStore(); if (st && k.startsWith(IBC)) st.snaps.set(k, v ? clone(v) : null) } // 讀了但不存在＝null（跟「沒讀過」分開）
async function kvGetManyRaw(ids) {
  if (!SB_URL || !SB_KEY || !ids.length) return {}
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,data`, { headers: H() })
    const rows = r.ok ? await r.json() : []
    const out = {}; rows.forEach((row) => { if (row?.data?.v) { try { out[row.id] = JSON.parse(row.data.v) } catch (_) {} } }); return out
  } catch (_) { return {} }
}
async function kvGetMany(ids) {
  const ib = ids.filter(k => k.startsWith(IBP)), other = ids.filter(k => !k.startsWith(IBP))
  const out = other.length ? await kvGetManyRaw(other) : {}
  if (ib.length) { const m = await (await ibKv()).kvGetMany(ib); for (const k of ib) { if (m[k] !== undefined) out[k] = m[k]; snapPut(k, m[k] || null) } }
  return out
}
const kvGet = async (id) => (await kvGetMany([id]))[id] || null

// ── 對話修改規則（跟新殼 ops.inbox_apply 同一套）──
const NEWEST = ['last', 'lastT', 'lastInT', 'lastOutT', 'replyToken', 'replyT', 'replyUsed', 'follow'] // 只有較新的事件能推進
const IFEMPTY = { name: [], cat: ['catBy'], phone: ['phoneBy'], assignee: [] } // 原本空白才填（不蓋掉別人同時填的）
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b)
// before＝讀到時的對話（沒有＝新對話）、after＝改完的；t＝事件時間（沒有＝現在）
export function convPatch(before, after, t, opt = {}) { // opt.reopen：客人訊息（交易依目前狀態與 statusT 決定要不要重開）
  const st = ibStore(); const force = !!(st && st.force) // 店員手動操作（convOp）：負責人／分類等直接設定，不套「空白才填」
  const b = before || {}, p = { set: {}, unset: [], last: {}, lastUnset: [], t: t || new Date().toISOString(), inc: 0, reopen: false, ifEmpty: {} }
  const keys = new Set([...Object.keys(b), ...Object.keys(after)])
  const companion = new Set(Object.values(IFEMPTY).flat())
  // 自動重開＝原本完成／等待中、改成新、人工改狀態時間（statusT）沒變（＝客人訊息觸發）；交給套用端依事件時間判斷
  const autoReopen = ['done', 'wait'].includes(b.status) && after.status === 'new' && same(b.statusT, after.statusT)
  if (autoReopen || opt.reopen) p.reopen = true
  const autoOpen = b.status === 'new' && after.status === 'open' && same(b.statusT, after.statusT) // 自動 新→處理中（送出時）：交易裡目前還是新才轉（第三輪 A2）
  if (autoOpen) p.autoOpen = true
  for (const k of keys) {
    if ((autoReopen && (k === 'status' || k === 'waitUntil')) || (autoOpen && k === 'status')) continue
    if (same(b[k], after[k]) || companion.has(k)) continue
    if (k === 'replyUsed' && b.replyToken && same(b.replyToken, after.replyToken)) { p.ifTok = { tok: b.replyToken, set: { replyUsed: after.replyUsed } }; continue } // 只在憑證沒換時標（第二輪 A4）
    if (NEWEST.includes(k)) { if (after[k] === undefined) p.lastUnset.push(k); else p.last[k] = after[k]; continue } // 拿掉也要比時間（第二輪 A4）
    if (k === 'unread') { const d = (Number(after.unread) || 0) - (Number(b.unread) || 0); if ((Number(after.unread) || 0) === 0) p.clearUnread = { upTo: String(b.lastInT || '') }; else p.inc += d; continue } // 清未讀只清到讀到的那則（第三輪 A1）
    if (IFEMPTY[k] && !force && (b[k] == null || b[k] === '') && after[k] != null && after[k] !== '') { const g = { [k]: after[k] }; for (const c of IFEMPTY[k]) if (after[c] !== undefined) g[c] = after[c]; p.ifEmpty[k] = g; continue }
    if (after[k] === undefined) p.unset.push(k); else p.set[k] = after[k]
  }
  for (const [k, cs] of Object.entries(IFEMPTY)) for (const c of cs) if (!p.ifEmpty[k] && !same(b[c], after[c]) && !(c in p.set)) { if (after[c] === undefined) p.unset.push(c); else p.set[c] = after[c] } // 伴隨欄位單獨改（例：人工改分類來源）
  if (!Object.keys(p.last).length) delete p.last
  if (!p.lastUnset.length) delete p.lastUnset
  return p
}
// 沒有本次讀到的快照（例：別的流程直接拿整份來存）：整份欄位照設、未讀用絕對值、最後訊息那組照「較新才推進」
export function convPatchFull(after) {
  const p = { set: {}, unset: [], last: {}, t: String(after.lastT || new Date().toISOString()), inc: 0, reopen: false, ifEmpty: {} }
  for (const [k, v] of Object.entries(after)) { if (v === undefined) continue; if (NEWEST.includes(k)) p.last[k] = v; else p.set[k] = v }
  if (!Object.keys(p.last).length) delete p.last
  return p
}
// GD 原表模式：同一套規則套在目前內容上
export function convApplyJs(cur, conv0, p) {
  let c = cur ? { ...cur } : { ...(conv0 || {}) }
  Object.assign(c, p.set || {}); for (const k of p.unset || []) delete c[k]
  for (const [k, g] of Object.entries(p.ifEmpty || {})) if (c[k] == null || c[k] === '') Object.assign(c, g)
  if (String(p.t || '') >= String(c.lastT || '')) { if (p.last) Object.assign(c, p.last); for (const k of p.lastUnset || []) delete c[k] }
  if (p.ifTok && String(c.replyToken || '') === String(p.ifTok.tok || '')) Object.assign(c, p.ifTok.set || {})
  if (p.clearUnread && String(c.lastInT || '') <= String(p.clearUnread.upTo || '')) c.unread = 0
  if (p.autoOpen && c.status === 'new') c.status = 'open'
  if (p.inc) c.unread = Math.max(0, (Number(c.unread) || 0) + p.inc)
  if (p.reopen && ['done', 'wait'].includes(c.status) && String(p.t || '') > String(c.statusT || '')) { c.status = 'new'; c.waitUntil = '' }
  return c
}
// 訊息＋對話一次套用：回 { dup, conv }
export async function ibApply(ck, mk, msg, before, after, full, opt) {
  const kv = await ibKv(); const patch = full ? convPatchFull(after) : convPatch(before, after, msg ? msg.t : undefined, opt || {}) // 新對話（before＝null）：規則本身從空白建出完整內容（起點空白，未讀不會算兩次）
  if (kv.mode === 'abgd') { const j = await kv.cmdRaw('apply', { convKey: ck, msgKey: mk || null, msg: mk ? msg : null, conv0: {}, patch }); return { dup: !!j.dup, conv: j.conv || after } }
  if (kv.mode !== 'gd') throw new Error('收件匣正在切換，請稍後再試')
  // GD 原表：同規則的資料庫函式 pm_inbox_apply（一個交易；第二輪 A2）
  const st = ibStore()
  const r = await fetch(`${SB_URL}/rest/v1/rpc/pm_inbox_apply`, { method: 'POST', headers: H(), body: JSON.stringify({ p_conv_key: ck, p_msg_key: mk || null, p_msg: mk ? msg : null, p_conv0: {}, p_patch: patch, p_editor: (st && st.op) || '收件匣' }), signal: AbortSignal.timeout(15000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error('收件匣存不進去：' + String((j && (j.message || j.hint)) || r.status).slice(0, 120))
  return { dup: !!j.dup, conv: j.conv || after }
}
async function kvSet(id, obj, editor) {
  if (id.startsWith(IBC)) { // 對話：只送改了的欄位（沒有本次讀到的快照＝當新對話／整份欄位）
    const st = ibStore(); const before = st && st.snaps.has(id) ? st.snaps.get(id) : undefined
    if (before === undefined) { // 沒有本次讀到的快照（程式漏讀）：新殼模式不准整份覆蓋既有對話（第二輪 A1）；GD 原表照舊並留紀錄
      const kv0 = await ibKv(); console.log('[inbox] 對話存檔沒有快照', id, kv0.mode)
      if (kv0.mode !== 'gd') throw new Error('收件匣存檔缺讀取快照，請重新整理再試一次')
    }
    const r = before === undefined ? await ibApply(id, null, null, null, obj, true) : await ibApply(id, null, null, before, obj)
    if (st) st.snaps.set(id, clone(r.conv)); return
  }
  const kv = await ibKv() // 其他（設定、帳號狀態、訊息附註）：整份（同 GD 原本），新殼模式先讀版本再存
  if (kv.mode === 'gd') { await kv.kvPut(id, obj, editor || '收件匣'); return }
  await kv.retry(async () => { await kv.kvGet(id); await kv.kvPut(id, obj, editor || '收件匣') })
}
async function kvInsert(id, obj, editor) { return (await ibKv()).kvInsert(id, obj, editor || '收件匣') } // 只新增：回 true＝新增、false＝已存在
async function kvLike(prefix, limit, order) {
  const m = await (await ibKv()).kvPrefix(prefix, { order: /^updated_at/.test(order || '') ? 'updated' : 'id', limit: limit || 300 })
  for (const [k, v] of Object.entries(m)) snapPut(k, v)
  return Object.values(m).filter(v => v != null)
}

const CFG_KEY = 'pm_inbox_cfg'
// v4.71.12 對話分類（張良 2026-10-14 參考小夏 EM「一般訂位／大型訂位／包場／婚禮」）：設定頁可增刪改；新訊息先用關鍵字猜，猜不到每小時 AI 補；人改過（catBy=man）就不再自動改
export const DEF_CATS = ['一般訂位', '大型訂位', '包場', '婚禮', '會員／點數', '其他']
export function kwCat(text, cats) {
  const t = String(text || ''); const has = (c) => (cats || DEF_CATS).includes(c)
  const n = Math.max(0, ...[...t.matchAll(/(\d{2,3})\s*(?:人|位|個人)/g)].map(m => +m[1]))
  if (has('婚禮') && /婚禮|婚宴|求婚|訂婚|wedding/i.test(t)) return '婚禮'
  if (has('包場') && /包場|尾牙|春酒|包下|場地租|整場|活動場地|企業活動|發表會/.test(t)) return '包場'
  if (has('大型訂位') && n >= 15) return '大型訂位'
  if (has('會員／點數') && /會員|點數|集點|補登|會員卡/.test(t)) return '會員／點數'
  if (has('一般訂位') && /訂位|預約|位子|座位|幾位|候位|訂桌/.test(t)) return '一般訂位'
  return ''
}
const PHONE_RE = /(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}/
export const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-9) // 台灣手機後 9 碼（+886／0 開頭都對得上）
const convKey = (acct, uid) => `pm_inbox_c_${acct}_${uid}`
const convId = (acct, uid) => `${acct}:${uid}`
const splitId = (id) => { const i = String(id).indexOf(':'); return i > 0 ? [id.slice(0, i), id.slice(i + 1)] : [null, null] }
const msgKey = (acct, uid, t) => `pm_inbox_m_${acct}_${uid}_${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`
const statKey = (acct) => `pm_inbox_acct_${acct}`
export async function loadCfg() { const c = (await kvGet(CFG_KEY)) || {}; return { ...c, perm: c.perm || {}, templates: c.templates || [], remindMin: +c.remindMin || 30, forward: c.forward || {}, reply: c.reply || {}, remind: c.remind || {}, cats: (Array.isArray(c.cats) && c.cats.length) ? c.cats : DEF_CATS } } // remind[acct]={people:[姓名], group:LINE群gid}：沒人回提醒通知誰（v4.70.54 張良：可設個人或直接通知群組） // forward[acct]=原本接著的系統網址（接到收件匣後我們每則原封轉發過去，原系統不斷）
export const maskUrl = (u) => String(u || '').replace(/([?&][^=&]+=)[^&]{4,}/g, (m, k) => k + '••••')
export const isMgr = (who, apr, pm) => !!who && (apr.includes(who.name) || who.name === '張良瑋' || who.role === '主管' || (((pm || {}).users || {})[who.rid || who.uid] || {}).admin)
export const canSeeAcct = (cfg, who, mgr, acct) => mgr || ((cfg.perm || {})[acct] || []).includes(who.name)
export const canReplyAcct = (cfg, who, mgr, acct) => mgr || (canSeeAcct(cfg, who, mgr, acct) && ((cfg.reply || {})[acct] || []).includes(who.name)) // v4.70.51 回覆權限分開勾（張良 10-11）：主管永遠可回；其他人要同時「看得到」＋「可回覆」

// ── 驗簽：哪個帳號的 secret 驗得過＝哪個帳號 ──
export function acctBySignature(raw, sig) {
  if (!sig || !raw) return null
  for (const a of ACCOUNTS) {
    const { secret } = creds(a); if (!secret) continue
    try { if (crypto.createHmac('sha256', secret).update(raw).digest('base64') === sig) return a } catch (_) {}
  }
  return null
}

// ── LINE API（每個帳號各自 token）──
async function lineApi(a, path, opt) {
  const { token } = creds(a); if (!token) return { ok: false, status: 0, data: { message: '未設金鑰' } }
  const host = /\/content$/.test(path) ? 'https://api-data.line.me' : 'https://api.line.me'
  try {
    const r = await fetch(host + path, { ...(opt || {}), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...((opt || {}).headers || {}) } })
    let data = null; try { data = await r.json() } catch (_) { data = {} }
    return { ok: r.ok, status: r.status, data }
  } catch (e) { return { ok: false, status: 0, data: { message: e?.message } } }
}
export async function botInfo(a) { return lineApi(a, '/v2/bot/info') }
export async function webhookInfo(a) { return lineApi(a, '/v2/bot/channel/webhook/endpoint') }
export async function webhookSet(a, endpoint) { return lineApi(a, '/v2/bot/channel/webhook/endpoint', { method: 'PUT', body: JSON.stringify({ endpoint }) }) }
export async function webhookTest(a, endpoint) { return lineApi(a, '/v2/bot/channel/webhook/test', { method: 'POST', body: JSON.stringify(endpoint ? { endpoint } : {}) }) }
const _quotaC = {} // v4.71.11 速度鐵則：額度 60 秒快取（每開一個對話都打兩次 LINE API → 0.3 秒）
export async function quotaOf(a) {
  const hit = _quotaC[a.key]; if (hit && Date.now() - hit.t < 60e3) return hit.v
  const v = await quotaOfRaw(a); _quotaC[a.key] = { t: Date.now(), v }; return v
}
export async function quotaOfRaw(a) {
  const [q, c] = await Promise.all([lineApi(a, '/v2/bot/message/quota'), lineApi(a, '/v2/bot/message/quota/consumption')])
  return { limit: q.data?.value ?? null, type: q.data?.type || '', used: c.data?.totalUsage ?? null }
}
async function profileOf(a, uid) {
  if (!/^U[0-9a-f]{32}$/.test(uid)) return null
  const r = await lineApi(a, `/v2/bot/profile/${uid}`); return r.ok ? { name: r.data.displayName || '', pic: r.data.pictureUrl || '', statusMsg: r.data.statusMessage || '' } : null
}
async function downloadContent(a, messageId) {
  const { token } = creds(a); if (!token) return null
  try {
    const r = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    const mime = r.headers.get('content-type') || 'application/octet-stream'
    return { buf: Buffer.from(await r.arrayBuffer()), mime }
  } catch (_) { return null }
}
const extOf = (mime, name) => { const m = String(name || '').match(/\.([A-Za-z0-9]{1,5})$/); if (m) return m[1].toLowerCase(); return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'application/pdf': 'pdf' })[mime] || 'bin' }

// ── 帳號狀態（最近收到／驗簽失敗／destination）──
async function bumpStat(acct, patch) {
  try { const s = (await kvGet(statKey(acct))) || {}; await kvSet(statKey(acct), { ...s, ...patch }, '收件匣狀態') } catch (_) {}
}
export async function noteSigFail() { try { const s = (await kvGet('pm_inbox_acct__sigfail')) || { n: 0 }; await kvSet('pm_inbox_acct__sigfail', { n: (s.n || 0) + 1, lastT: nowIso() }, '收件匣狀態') } catch (_) {} }

// ── 轉發：原封不動（同 body、同簽章）送給原本接著的系統；失敗記在帳號狀態，不影響我們自己的存檔 ──
export async function forwardRaw(a, raw, sig) {
  const cfg = await loadCfg(); const url = cfg.forward[a.key]; if (!url) return null
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000)
  let out
  try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig, 'user-agent': 'LineBotWebhook/2.0 (via ground-pm inbox relay)' }, body: raw, signal: ctl.signal }); out = { ok: r.ok, status: r.status, t: nowIso() } }
  catch (e) { out = { ok: false, status: 0, err: String(e?.name === 'AbortError' ? 'timeout' : e?.message || e).slice(0, 80), t: nowIso() } }
  clearTimeout(tm)
  bumpStat(a.key, { lastFwd: out }).catch(() => {})
  if (!out.ok) console.log('[inbox] forward fail', a.key, JSON.stringify(out))
  return out
}

// ── 收訊：一個 webhook 事件 → 存訊息＋更新對話＋通知 ──
export async function ingestEvent(a, ev, destination, opt = {}) { return ibStore() ? _ingestEvent(a, ev, destination, opt) : ibAs('收件匣', () => _ingestEvent(a, ev, destination, opt)) } // v4.71.122 包請求情境（對話快照、操作者）
async function _ingestEvent(a, ev, destination, opt = {}) { // opt.retry＝待補存佇列重跑（v4.71.120）：不再自動回覆（第一次已試過、replyToken 也過期）
  const src = ev.source || {}
  const uid = src.userId && src.type === 'user' ? src.userId : (src.groupId || src.roomId || src.userId || '')
  if (!uid) return null
  const t = +ev.timestamp || Date.now()
  const ck = convKey(a.key, uid)
  const cur0 = await kvGet(ck); const before = cur0 ? clone(cur0) : null // 讀到時的原樣（一次套用時只送改了哪些）
  let conv = cur0 || { id: convId(a.key, uid), acct: a.key, uid, kind: src.type || 'user', name: '', pic: '', status: 'new', assignee: '', note: '', unread: 0, createdT: nowIso() }
  // 顯示名稱：第一次或超過 1 天沒更新就問 LINE
  if (src.type === 'user' && (!conv.name || !conv.profT || Date.now() - new Date(conv.profT).getTime() > 86400e3)) {
    const p = await profileOf(a, uid); if (p) { conv.name = p.name || conv.name; conv.pic = p.pic || ''; conv.profT = nowIso() } else if (!conv.name) conv.name = '客人 ' + uid.slice(-4)
  }
  if (src.type !== 'user' && !conv.name) conv.name = (src.type === 'group' ? '群組 ' : '聊天室 ') + uid.slice(-4)
  let msg = null, text = ''
  if (ev.type === 'message') {
    const m = ev.message || {}
    msg = { id: '', convId: conv.id, t: new Date(t).toISOString(), dir: 'in', type: m.type || 'text', name: conv.name }
    if (m.type === 'text') { msg.text = String(m.text || '').slice(0, 5000); text = msg.text
      if (!opt.retry && a.key === 'gd' && ev.replyToken && (ev.source || {}).type === 'user') { if (text === '門市與客服' || text === '我要團體訂餐') { conv.replyUsed = true; cardAutoReply(a, uid, ev.replyToken, conv, text).catch(() => {}) } else if (/會員|點數|集點|積分|累點/.test(text) && text.length <= 40) { conv.replyUsed = true; memberAutoReply(a, uid, ev.replyToken, conv).catch(() => {}) } } } // v4.70.96 圖文選單第 6 格／團訂卡片 // v4.70.92 客人問「點數／會員」→ 免費 reply 目前點數＋會員卡連結（張良 2026-10-12「官方目前不會回覆問題」）
    else if (m.type === 'sticker') { msg.sticker = { pkg: m.packageId, id: m.stickerId }; text = '（貼圖）' }
    else if (m.type === 'location') { msg.text = [m.title, m.address].filter(Boolean).join(' '); msg.loc = { lat: m.latitude, lng: m.longitude }; text = '（位置）' + (m.address || '') }
    else if (['image', 'video', 'audio', 'file'].includes(m.type)) {
      const label = { image: '（圖片）', video: '（影片）', audio: '（語音）', file: '（檔案）' }[m.type]
      text = label + (m.fileName ? ' ' + m.fileName : '')
      msg.fileName = m.fileName || ''
      if (m.contentProvider && m.contentProvider.type === 'external' && m.contentProvider.originalContentUrl) msg.ext = m.contentProvider.originalContentUrl
      else {
        const dl = await downloadContent(a, m.id)
        if (dl && dl.buf.length) { const path = `inbox/${a.key}/${uid}/${t.toString(36)}.${extOf(dl.mime, m.fileName)}`; if (await uploadPrivate(path, dl.buf, dl.mime)) { msg.media = path; msg.mime = dl.mime; msg.size = dl.buf.length } }
      }
    } else { text = '（' + (m.type || '訊息') + '）' }
    conv.replyToken = ev.replyToken || ''; conv.replyT = nowIso(); conv.replyUsed = false // 每則新訊息都有新的 replyToken（v4.70.49 修：之前回過一次後永遠走 push）
    conv.unread = (conv.unread || 0) + 1
    if (msg.text && !conv.cat) { try { const cfgK = await loadCfg(); const g = kwCat(msg.text, cfgK.cats); if (g) { conv.cat = g; conv.catBy = 'kw' } } catch (_) {} }
    if (msg.text && !conv.phone) { const pm = String(msg.text).match(PHONE_RE); if (pm) { conv.phone = pm[0].replace(/[\s-]/g, ''); conv.phoneBy = 'auto' } }
    if (conv.status === 'done' || conv.status === 'wait') { conv.status = 'new'; conv.waitUntil = '' } // v4.71.11 等待中的客人又傳訊息＝要處理，回到待處理
    conv.lastInT = msg.t
  } else if (ev.type === 'follow') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: (ev.follow && ev.follow.isUnblocked) ? '解除封鎖，重新加入好友' : '加入好友' }; text = msg.text; conv.follow = true; conv.unread = (conv.unread || 0) + 1; if (conv.status === 'done') conv.status = 'new'; if (!opt.retry && a.key === 'gd' && ev.replyToken) { conv.replyUsed = true; welcomeReply(a, ev.replyToken).catch(() => {}) } } // v4.70.83 GD 加好友：用 replyToken 免費回歡迎＋會員卡連結（加好友≠入會，點開會員卡按同意才入會）
  else if (ev.type === 'unfollow') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: '封鎖／刪除好友' }; text = msg.text; conv.follow = false }
  else if (ev.type === 'join') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: '官方帳號被加入這個群' }; text = msg.text }
  else if (ev.type === 'leave') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: '官方帳號離開這個群' }; text = msg.text }
  else if (ev.type === 'postback') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'in', type: 'text', text: '（按了按鈕）' + String((ev.postback || {}).data || '').slice(0, 200), name: conv.name }; text = msg.text; conv.unread = (conv.unread || 0) + 1 }
  else return null
  const mk = ev.webhookEventId ? `pm_inbox_m_${a.key}_${uid}_${t.toString(36)}e${djb(String(ev.webhookEventId))}` : msgKey(a.key, uid, t); msg.id = mk // 有事件編號＝固定鍵（重存不會變兩則）
  conv.last = { text: text.slice(0, 80), t: msg.t, dir: msg.dir }
  conv.lastT = msg.t
  const ap = await ibApply(ck, mk, msg, before, conv, false, { reopen: msg.dir === 'in' || ev.type === 'follow' }) // v4.71.122 訊息＋對話一次套用；這個事件套用過＝不再通知；客人訊息一律帶可重開（交易決定）
  if (ap.dup) return { conv: ap.conv, msg, dup: true }
  conv = ap.conv
  bumpStat(a.key, { lastEventT: nowIso(), destination: destination || undefined, lastEventType: ev.type }).catch(() => {})
  if ((msg.dir === 'in' || ev.type === 'follow') && !a.relay) notifyNew(a, conv, text).catch(() => {}) // relay 帳號（DD）不推播：DD 私訊量大且 DD 自己會答，有要插手的人自己到收件匣看
  return { conv, msg }
}

// ── v4.71.120 待補存佇列：webhook 存檔失敗（例：收件匣切換凍結那幾秒、新殼暫時連不上）時原始事件先放 GD 的 pm_ibq_<事件編號>
//   （不屬收件匣域，凍結期也寫得進去），之後每次 webhook 結束前與每小時排程補存；訊息鍵由事件編號固定，重存不會變兩則；重存不再自動回覆
const IBQ = 'pm_ibq_'
const qPut = async (key, v) => { const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: key, data: { v: JSON.stringify(v) }, editor: '收件匣待補存', updated_at: nowIso() }) }); return r.ok }
const qDel = async (key) => { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: H() }); if (!r.ok) console.log('[inbox] 佇列刪不掉（補存時會判斷已套用過再刪）', key, r.status); return r.ok }
export const ibQid = (a, ev) => IBQ + String(ev.webhookEventId || (a.key + '_' + (ev.timestamp || '') + '_' + djb(JSON.stringify(ev)))).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
// 客人事件先存一份（webhook 收到就存、處理完才刪；v4.71.122 關卡 3 inbox 第一輪 A3）：回 true＝存上
export async function ibQueue(a, ev, destination, err) {
  const ok = await qPut(ibQid(a, ev), { kind: 'in', acct: a.key, ev, destination: destination || '', t: new Date(+ev.timestamp || Date.now()).toISOString(), at: nowIso(), tries: 0, err: String(err || '').slice(0, 200) }).catch(() => false)
  if (!ok) console.log('[inbox] 待補存也存不進去', ibQid(a, ev))
  return ok
}
export const ibDequeue = (a, ev) => qDel(ibQid(a, ev)).catch(() => false)
// DD 回覆紀錄存不上（例：對話還沒建好、切換中）：放佇列，補存時用原本時間（固定鍵）
export async function ibQueueOut(a, uid, text, by, mode, t, full) { // full＝{mk, msg}：店員送出時保存完整訊息（附件也照原樣補記）
  const key = IBQ + 'out_' + a.key + '_' + String(uid).slice(-12) + '_' + t.toString(36) + djb(String(text))
  return qPut(key, { kind: 'out', acct: a.key, uid, text: String(text || '').slice(0, 5000), by, mode, t: new Date(t).toISOString(), ms: t, at: nowIso(), tries: 0, ...(full && full.msg ? { mk: full.mk, msg: full.msg } : {}) }).catch(() => false)
}
// 通知主管（DD 私訊老闆）：送出結果需要人工核對時。第五輪 A3：固定鍵的通知工作 pm_ibnote_<鍵>（只新增＝同一件事只建一次）；送成功才標完成，沒送成功由補存排程重試
// 第六輪：通知主管一律帶 LINE 重試鍵（X-Line-Retry-Key，由通知編號算出的固定 UUID）：同一件通知不管同時跑、或送成功後標記沒寫上再送，LINE 24 小時內只送一次
const retryKeyOf = (id) => { const h = crypto.createHash('sha256').update('ibnote:' + id).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
async function bossPush(id, text) { // 回 true＝LINE 確定收下（2xx，或 409＝這把重試鍵已經送過）
  const tk = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(); if (!tk) return false
  const boss = (process.env.LINE_BOSS_USER || '').trim() || 'Uf7ce4fb9191cd3055247204e0cb6b4fc'
  try { const r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}`, 'X-Line-Retry-Key': retryKeyOf(id) }, body: JSON.stringify({ to: boss, messages: [{ type: 'text', text: String(text).slice(0, 900) }] }), signal: AbortSignal.timeout(10000) }); return r.ok || r.status === 409 }
  catch (e) { console.log('[inbox] 通知主管失敗', e && e.message); return false }
}
// 建通知工作（只新增）：回 true＝工作已存在（這次建的或之前建過）
async function noteCreate(id, text) { const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify({ st: 'pending', text: String(text).slice(0, 900), at: nowIso() }) }, editor: '收件匣通知', updated_at: nowIso() }) }).catch(() => null); return !!(r && (r.ok || r.status === 409)) }
const noteId = (key) => 'pm_ibnote_' + String(key).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)
export async function ibAlert(key, text) { // 立即通知：先建工作、再送（帶重試鍵）；回 true＝確定送出
  const id = noteId(key); const made = await noteCreate(id, text)
  const sent = await bossPush(id, text)
  if (sent && made) await qPut(id, { st: 'done', text: String(text).slice(0, 900), at: nowIso() }).catch(() => {}) // 標記沒寫上也沒關係：重送時 LINE 依重試鍵不會再送
  return sent
}

export async function ibRetry({ limit = 5 } = {}) { return ibStore() ? _ibRetry({ limit }) : ibAs('收件匣補存', () => _ibRetry({ limit })) } // 包請求情境（對話快照、操作者）
async function _ibRetry({ limit = 5 } = {}) { // 套用本身會判斷「這個事件套用過」，同一筆被兩邊同時補存也不會重複
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(esc(IBQ))}*&select=id,data&order=updated_at.asc&limit=${Math.min(500, limit * 4)}`, { headers: H() })
  const rows0 = r.ok ? await r.json() : []; let ok = 0, bad = 0, dead = 0
  const rows = rows0.map(row => { try { return { id: row.id, q: JSON.parse(row.data.v) } } catch (_) { return { id: row.id, q: null } } })
  rows.sort((x, y) => String((x.q || {}).t || '').localeCompare(String((y.q || {}).t || ''))) // 照事件時間先後補（先客人訊息、後回覆）
  const toDead = async (id, q, why) => { dead++; await qPut('pm_ibqdead_' + id.slice(IBQ.length), { ...(q || {}), dead: why, deadAt: nowIso() }).catch(() => {}); await qDel(id).catch(() => {}); console.log('[inbox] 待補存移到死信', id, why) } // 壞資料不卡在最前面（第二輪 B）
  for (const { id, q } of rows.slice(0, limit)) {
    if (!q) { await toDead(id, null, '內容壞掉'); continue }
    const a = acctOf(q.acct); if (!a) { await toDead(id, q, '沒有這個帳號'); continue }
    if ((q.tries || 0) >= 30) { await toDead(id, q, '重試 30 次仍失敗：' + (q.err || '')); continue }
    try {
      if (q.kind === 'out' && q.msg && q.mk) { const ck = convKey(q.acct, q.uid); const cur = await kvGet(ck); if (!cur) throw new Error('對話還沒建好'); await ibApply(ck, q.mk, q.msg, cur, { ...cur, replyUsed: true, last: { text: String(q.text || '').slice(0, 80), t: q.msg.t, dir: 'out', by: q.by }, lastT: q.msg.t, lastOutT: q.msg.t }) }
      else if (q.kind === 'out') { const m = await noteOut(a, q.uid, q.text, q.by, q.mode, { t: q.ms }); if (!m) throw new Error('對話還沒建好') }
      else await ingestEvent(a, q.ev, q.destination, { retry: true })
      if (await qDel(id)) ok++; else bad++ // 刪不掉＝下一輪再判斷重複後刪
    } catch (e) { bad++; q.tries = (q.tries || 0) + 1; q.err = String(e && e.message || e).slice(0, 200); await qPut(id, q).catch(() => {}) }
  }
  // 送出標記（第五輪 A2／A4）：只撈待處理狀態（資料庫篩選，舊的已完成標記不會塞住）；轉移狀態用版本比對（pm_doc_cas），版本變了就不動
  //   10 分鐘門檻＞函式最長執行時間 5 分鐘：排程不會動到還在跑的送出
  const sendRows = async (stx) => { const like = encodeURIComponent('*"st":"' + stx + '"*'); const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.pm%5C_ibsend%5C_*&data->>v=like.${like}&select=id,updated_at&order=updated_at.asc&limit=50`, { headers: H() }).catch(() => null); return r && r.ok ? r.json() : [] }
  try {
    for (const row of await sendRows('lineok')) { // LINE 已送出但紀錄沒存上：一次套用補記（固定鍵，已存在＝dup）→ sent
      if (Date.now() - Date.parse(row.updated_at) < 60e3) continue
      const d = await docGet(row.id); const m = d && d.v; if (!m || m.st !== 'lineok' || !m.msg) continue
      const ck = convKey(m.acct, m.uid); const cur = await kvGet(ck); if (!cur) continue
      const after = { ...cur, replyUsed: true, last: { text: m.lastText, t: m.msg.t, dir: 'out', by: m.by }, lastT: m.msg.t, lastOutT: m.msg.t }
      try { await ibApply(ck, m.mk, m.msg, cur, after); if (await docCas(row.id, d.rev, { ...m, st: 'sent', at: nowIso(), res: { ok: true, msg: m.msg, mode: m.mode }, fixed: 1 })) ok++ } catch (e) { bad++ }
    }
    for (const stx of ['sending', 'unknown']) for (const row of await sendRows(stx)) { // 結果不明超過 10 分鐘：標待核對（版本比對）＋建通知工作（固定鍵只建一次）
      if (Date.now() - Date.parse(row.updated_at) < 600e3) continue
      const d = await docGet(row.id); const m = d && d.v; if (!m || m.st !== stx) continue
      const made = await noteCreate(noteId('c_' + row.id.slice(10)), `收件匣：有一則送出結果不確定（${(acctOf(m.acct) || {}).name || m.acct || ''}・${String(m.uid || (m.job || {}).id || '').slice(-6)}）：「${String(m.lastText || (m.job || {}).text || '').slice(0, 40)}」。請到 LINE 官方帳號後台確認客人有沒有收到；系統不會自動重送。`)
      if (!made) continue // 通知工作沒建好＝不轉待核對（下輪再來）
      await docCas(row.id, d.rev, { ...m, st: 'review', reviewAt: nowIso() }) // 版本對不上＝不動（通知工作已在，下輪 409＝已存在）
    }
    { // 通知工作沒送成功的：重試
      const like = encodeURIComponent('*"st":"pending"*'); const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.pm%5C_ibnote%5C_*&data->>v=like.${like}&select=id,data&order=updated_at.asc&limit=20`, { headers: H() }).catch(() => null)
      for (const row of (r && r.ok ? await r.json() : [])) { let n = null; try { n = JSON.parse(row.data.v) } catch (_) { continue } if (n && n.st === 'pending' && await bossPush(row.id, n.text)) await qPut(row.id, { ...n, st: 'done', doneAt: nowIso() }).catch(() => {}) } // 帶重試鍵：同時跑或標記沒寫上，LINE 都只送一次
    }
    { // 已送完的送出標記留 2 天（防重用）後清掉
      const like = encodeURIComponent('*"st":"sent"*'); await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.pm%5C_ibsend%5C_*&data->>v=like.${like}&updated_at=lt.${encodeURIComponent(new Date(Date.now() - 2 * 86400e3).toISOString())}`, { method: 'DELETE', headers: H() }).catch(() => {})
    }
  } catch (_) {}
  const cr = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(esc(IBQ))}*&select=id`, { headers: { ...H(), Prefer: 'count=exact', Range: '0-0' } }).catch(() => null)
  const left = cr ? Number(String(cr.headers.get('content-range') || '').split('/')[1]) : NaN
  return { ok, bad, dead, seen: Math.min(rows.length, limit), left: Number.isFinite(left) ? left : null } // left＝現在實際還剩幾筆
}
// 店員送出 LINE 前：收件匣在新殼且正在做切換驗收、不是驗收者＝不准送（關卡 3 inbox 第一輪 A5）；回 null＝放行
export async function ibGate() { const kv = await ibKv(); if (kv.mode === 'gd') return null; if (kv.mode !== 'abgd') return '收件匣正在切換，請稍後再送'; return kv.gate() }
// 同一個送出動作只送一次（頁面每次按送出產生 cid）：pm_ibsend_<cid> 記狀態（GD 原表，不屬收件匣域）；結果不確定＝不自動重送
// 送出標記的版本讀寫（GD pm_doc_get／pm_doc_cas）
const docGet = async (id) => { const r = await fetch(`${SB_URL}/rest/v1/rpc/pm_doc_get`, { method: 'POST', headers: H(), body: JSON.stringify({ p_id: id }) }).catch(() => null); const j = r && r.ok ? await r.json() : null; if (!j || !j.data) return null; let v = null; try { v = JSON.parse(j.data.v) } catch (_) { return null } return { v, rev: Number(j.rev) || 0 } }
const docCas = async (id, rev, v) => { const r = await fetch(`${SB_URL}/rest/v1/rpc/pm_doc_cas`, { method: 'POST', headers: H(), body: JSON.stringify({ p_id: id, p_rev: rev, p_data: { v: JSON.stringify(v) }, p_editor: '收件匣送出' }) }).catch(() => null); const j = r && r.ok ? await r.json() : null; return !!(j && j.ok) }
async function markUnknown(key) { for (let i = 0; i < 3; i++) { const d = await docGet(key); if (!d || !d.v) return; if (d.v.st !== 'sending') return; if (await docCas(key, d.rev, { ...d.v, st: 'unknown', at: nowIso() })) return } } // 讀不到＝不寫；lineok／sent 不降級
export async function ibSendOnce(cid, fn, bind, need) { // bind＝{對話, 內容摘要}：同一個編號只認同一則；need＝必須帶編號（新殼頁）
  const c = String(cid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
  if (!c) { if (need) return { ok: false, error: '缺送出編號，請重新整理再送' }; return fn() }
  const b0 = bind || {}; const h = crypto.createHash('sha256').update(JSON.stringify(['v2', String(b0.id || ''), String(b0.text || ''), String(b0.name || ''), String(b0.sha || '')])).digest('hex') // 無歧義序列化（JSON 陣列）＋SHA-256；附件綁內容雜湊（第四輪 B）
  const key = 'pm_ibsend_' + c
  const ins = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'return=minimal' }, body: JSON.stringify({ id: key, data: { v: JSON.stringify({ st: 'sending', at: nowIso(), h, job: { id: b0.id || '', text: String(b0.text || '').slice(0, 5000), name: b0.name || '' } }) }, editor: '收件匣送出', updated_at: nowIso() }) }).catch(() => null)
  if (!ins) return { ok: false, error: '系統暫時連不上，請稍後再送' }
  if (!ins.ok && ins.status !== 409) return { ok: false, error: '系統暫時連不上（' + ins.status + '），請稍後再送' }
  if (!ins.ok) {
    const prev = await kvGetManyRaw([key]); const p = prev[key]
    if (p && p.h && p.h !== h) return { ok: false, error: '送出編號重複（對到別則訊息），請重新整理再送' }
    if (p && p.st === 'sent') return { ...(p.res || { ok: true }), dup: true }
    return { ok: false, error: '這則剛剛送過，結果還不確定——請重新整理看有沒有送出，沒有再送一次' }
  }
  let res
  { const st = ibStore(); if (st) { st.sendKey = key; st.sendH = h } } // deliver 在 LINE 成功後寫「已送出」到這個標記
  try { res = await fn() } catch (e) { res = { ok: false, sentUnknown: true, error: '送出結果不確定：' + String(e && e.message || e).slice(0, 100) + '——請重新整理看有沒有送出' } } // 例外＝不確定（第二輪 A3）
  if (res && res.ok && res.queued === false) { /* LINE 已送、紀錄沒存上也沒排上：保留「已送出＋內容」標記（補存排程從這裡補記後改 sent） */ }
  else if (res && res.ok) await qPut(key, { st: 'sent', at: nowIso(), h, res: { ok: true, msg: res.msg, mode: res.mode, conv: res.conv } }).catch(() => {})
  else if (res && res.sentUnknown) await markUnknown(key) // 不確定：版本比對、只從「送出中」轉、保留全部欄位（第六輪）；同編號不准重送
  else await qDel(key).catch(() => {}) // 確定沒送出（LINE 4xx、權限、內容錯）＝可以重送
  return res
}

// ── v4.70.61 DD 私訊轉進收件匣：line-webhook 每個事件先 ddInboxBegin(ev)；DD 回話處（lineReply／linePush／卡片）呼叫 ddInboxOut(text, to)；回 200 前 ddInboxFlush() 等寫完 ──
// 存 DD（或系統）主動／自動發出的一則：dir=out、by=DD；relay 帳號 DD 答過＝這個對話算「已完成」且不留未讀（人要插手再從收件匣回，會變處理中）
export async function noteOut(a, uid, text, by, mode, opt) { return ibStore() ? _noteOut(a, uid, text, by, mode, opt) : ibAs('DD', () => _noteOut(a, uid, text, by, mode, opt)) } // v4.71.122 包請求情境（對話快照、操作者）
async function _noteOut(a, uid, text, by, mode, opt) { // opt.t：補存時用原本時間（固定鍵）
  if (!a || !uid) return null
  const ck = convKey(a.key, uid); const conv = await kvGet(ck); if (!conv) return null
  const before = clone(conv)
  const t = (opt && opt.t) || Date.now(); const mk = `pm_inbox_m_${a.key}_${uid}_${t.toString(36)}o${djb(String(text || '') + (mode || ''))}` // 固定鍵（時間＋內容）：補存不會變兩則
  const msg = { id: mk, convId: conv.id, t: new Date(t).toISOString(), dir: 'out', by: by || 'DD', mode: mode || 'reply', type: 'text', text: String(text || '').slice(0, 5000), auto: 1 }
  if (msg.mode === 'reply') conv.replyUsed = true
  conv.last = { text: msg.text.slice(0, 80), t: msg.t, dir: 'out', by: msg.by }; conv.lastT = msg.t; conv.lastOutT = msg.t
  if (a.relay) { conv.status = 'done'; conv.unread = 0 }
  await ibApply(ck, mk, msg, before, conv)
  return msg
}
const _dd = { ev: null, p: null, pend: [] } // 目前正在處理的 DD 一對一事件（跟 line-webhook 的 _lastSend 一樣是模組層狀態，一個事件處理完就清）
export function ddInboxBegin(ev, destination) {
  _dd.ev = null; _dd.p = null
  if (!ev || (ev.source || {}).type !== 'user' || !['message', 'follow', 'unfollow', 'postback'].includes(ev.type)) return
  const a = acctOf('dd'); if (!a || !configured(a)) return
  _dd.ev = ev
  _dd.p = ingestEvent(a, ev, destination).catch(async e => { console.log('[inbox] dd ingest err', e?.message); await ibQueue(a, ev, destination, e?.message); return null }) // v4.71.122 存不上＝放待補存（關卡 3 inbox 第一輪 A6）
  _dd.pend.push(_dd.p)
}
export function ddInboxOut(text, to, mode) {
  const ev = _dd.ev, p0 = _dd.p; if (!ev || !p0) return
  if (to && to !== ev.source.userId) return // 推給別人（老闆私訊、群組）不是這個對話
  const t = String(text || '').trim(); if (!t) return
  const tm = Date.now(), A = acctOf('dd'), md = mode || 'reply'
  const p = p0.then(() => noteOut(A, ev.source.userId, t, 'DD', md, { t: tm })).then(m => { if (!m) return ibQueueOut(A, ev.source.userId, t, 'DD', md, tm) }).catch(e => { console.log('[inbox] dd out err', e?.message); return ibQueueOut(A, ev.source.userId, t, 'DD', md, tm) }) // 對話還沒建好或存不上＝放待補存
  _dd.pend.push(p)
}
export async function ddInboxFlush() { const ps = _dd.pend.splice(0); _dd.ev = null; _dd.p = null; if (ps.length) await Promise.allSettled(ps) }

async function memberAutoReply(a, uid, token, conv) {
  const MB = await import('./_member.js')
  let messages; try { messages = await MB.memberCardMessages(uid) } catch (_) { messages = [{ type: 'text', text: '點下面開啟會員卡查點數：\n' + MB.memberLiffUrl() }] }
  const r = await lineApi(a, '/v2/bot/message/reply', { method: 'POST', body: JSON.stringify({ replyToken: token, messages }) })
  if (r.ok) { const t = Date.now(); const mk = msgKey(a.key, uid, t); const text = messages.map(m => m.type === 'text' ? m.text : '（卡片）' + m.altText).join('\n'); await kvInsert(mk, { id: mk, convId: conv.id, t: new Date(t).toISOString(), dir: 'out', by: '系統', mode: 'reply', type: 'text', text }) } // 收件匣看得到系統回了什麼
}
async function cardAutoReply(a, uid, token, conv, text) {
  const MB = await import('./_member.js')
  const messages = text === '門市與客服' ? await MB.storeCardMessages() : await MB.grporderCardMessages()
  const r = await lineApi(a, '/v2/bot/message/reply', { method: 'POST', body: JSON.stringify({ replyToken: token, messages }) })
  if (r.ok) { const t = Date.now(); const mk = msgKey(a.key, uid, t); await kvInsert(mk, { id: mk, convId: conv.id, t: new Date(t).toISOString(), dir: 'out', by: '系統', mode: 'reply', type: 'text', text: '（卡片）' + messages[0].altText }) }
}
async function welcomeReply(a, token) { const MB = await import('./_member.js'); let messages; try { messages = await MB.welcomeMessages() } catch (_) { messages = [{ type: 'text', text: (await MB.welcomeText()).slice(0, 4900) }] }; await lineApi(a, '/v2/bot/message/reply', { method: 'POST', body: JSON.stringify({ replyToken: token, messages }) }) }
// ── 通知：有權限的人（鈴鐺＋推播）；沒設權限→審核人 ──
export async function permRids(acct, forRemind) { // export：團體訂餐（_grporder.js）通知店家時沿用「誰看得到這個帳號」
  const [cfg, bind, def] = await Promise.all([loadCfg(), kvGet('sp_finance_pm_prep_bind'), kvGet('sp_finance_pm_sop_def')])
  const apr = (((def || {}).ground || {}).approvers || ['張良瑋'])
  // 新訊息通知＝看得到的人＋審核人；沒人回提醒＝設定「通知誰」有勾就只通知那些人，沒勾退回「可回覆的人＋審核人」
  const rc = forRemind ? ((cfg.remind || {})[acct] || {}) : null
  const names = new Set(rc ? ((rc.people && rc.people.length) ? rc.people : [...(((cfg.reply || {})[acct]) || []), ...apr]) : [...(((cfg.perm || {})[acct]) || []), ...apr])
  const rids = new Set()
  for (const v of Object.values((bind || {}).tokens || {})) if (v && names.has(v.name)) { if (v.rid) rids.add(String(v.rid)); if (v.uid) rids.add(String(v.uid)) }
  return { rids: [...rids], apr, names: [...names], group: rc ? (rc.group || '') : '' }
}
async function notifyNew(a, conv, text) {
  const { rids } = await permRids(a.key); if (!rids.length) return
  const { wpPush } = await import('./_webpush.js')
  await wpPush(rids, { title: `${a.name}：${conv.name || '客人'}`, body: text.slice(0, 160), url: '/prep#inbox=' + encodeURIComponent(conv.id), cat: 'inbox' })
}

// ── 列表／對話（app 端）──
export async function listConvs({ who, mgr, cfg, acct }) {
  const prefix = acct ? `pm_inbox_c_${acct}_` : 'pm_inbox_c_'
  const all = await kvLike(prefix, 600, 'updated_at.desc')
  const vis = all.filter(c => c && c.acct && canSeeAcct(cfg, who, mgr, c.acct))
  // v4.71.18 一律照最後訊息時間新→舊（張良 2026-10-14「沒有按照時間排序，summer 剛回完還在最下面」；原本先排未讀／狀態，回完變處理中就沉底）
  vis.sort((x, y) => String(y.lastT || '').localeCompare(String(x.lastT || '')))
  return vis.map(c => ({ id: c.id, acct: c.acct, kind: c.kind, name: c.name, pic: c.pic, last: c.last, lastT: c.lastT, unread: c.unread || 0, status: c.status || 'new', assignee: c.assignee || '', follow: c.follow !== false, star: !!c.star, waitUntil: c.waitUntil || '', cat: c.cat || '', memoN: (c.memos || []).length + (c.note ? 1 : 0), bk: c.bk ? { date: c.bk.date, time: c.bk.time, n: c.bk.n, name: c.bk.name, by: c.bk.by, ok: !!c.bk.ok } : null, bkSt: c.bkSt ? { st: c.bkSt.st, pct: c.bkSt.pct, dayN: c.bkSt.dayN, ref: c.bkSt.ref, em: c.bkSt.em, rec: c.bkSt.rec } : null }))
}
async function signMany(paths, expiresIn) { // Supabase 批次簽名：一個請求簽多張；失敗退回一張一張
  const out = {}; if (!paths.length) return out
  try {
    const r = await fetch(`${SB_URL}/storage/v1/object/sign/ground-private`, { method: 'POST', headers: H(), body: JSON.stringify({ expiresIn, paths }) })
    const d = r.ok ? await r.json() : null
    if (Array.isArray(d)) for (const x of d) if (x && x.path && x.signedURL) out[x.path] = SB_URL + '/storage/v1' + x.signedURL
  } catch (_) {}
  const miss = paths.filter(p => !out[p]); if (miss.length) await Promise.all(miss.map(async p => { try { const u = await signedUrl(p, expiresIn); if (u) out[p] = u } catch (_) {} }))
  return out
}
export async function getConv({ who, mgr, cfg, id, markRead }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  const ck = convKey(acct, uid)
  // v4.71.11 速度鐵則：對話／訊息／額度同時抓；圖片網址一次批次簽（原本一張一個請求、全部排隊 → 0.7~1 秒）
  const [conv, rows, quotaP] = await Promise.all([kvGet(ck), kvLike(`pm_inbox_m_${acct}_${uid}_`, 300, 'id.desc'), quotaOf(a).catch(() => ({}))])
  if (!conv) return { ok: false, error: '找不到這個對話' }
  rows.sort((x, y) => String(x.t).localeCompare(String(y.t)))
  const urls = await signMany(rows.filter(m => m.media).map(m => m.media), 1800)
  const list = rows.map(m => { const o = { ...m }; if (m.media && urls[m.media]) o.url = urls[m.media]; return o })
  if (markRead && conv.unread) { conv.unread = 0; conv.readBy = who.name; conv.readT = nowIso(); await kvSet(ck, conv) }
  const fresh = conv.replyToken && conv.replyT && (Date.now() - new Date(conv.replyT).getTime()) < 50e3 && !conv.replyUsed
  const quota = quotaP
  return { ok: true, conv: { ...conv, replyToken: undefined }, list, replyFree: !!fresh, replyLeft: fresh ? Math.max(0, 50 - Math.round((Date.now() - new Date(conv.replyT).getTime()) / 1000)) : 0, quota, acctName: a.name }
}

// ── 回覆：reply（免費）或 push（扣額度）──
export async function sendOut({ who, mgr, cfg, id, text, kind, extra }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  if (!canReplyAcct(cfg, who, mgr, acct)) return { ok: false, error: '你只有查看權限，沒有回覆權限（請主管在收件匣設定勾「可回覆」）' }
  if (!configured(a)) return { ok: false, error: `${a.name} 還沒設金鑰，不能回覆` }
  text = String(text || '').trim(); if (!text) return { ok: false, error: '沒有內容' }
  const ck = convKey(acct, uid); const conv = await kvGet(ck); if (!conv) return { ok: false, error: '找不到這個對話' }
  const messages = [{ type: 'text', text: text.slice(0, 4900) }]
  return deliver({ a, acct, uid, ck, conv, who, messages, msgPatch: { type: 'text', text }, lastText: text })
}
// 送出（文字或媒體）：50 秒內有未用過的 replyToken → reply（免費），否則 push；存 out 訊息＋更新對話
async function deliver({ a, acct, uid, ck, conv, who, messages, msgPatch, lastText }) {
  const before = clone(conv)
  const fresh = conv.replyToken && conv.replyT && (Date.now() - new Date(conv.replyT).getTime()) < 50e3 && !conv.replyUsed
  let mode = fresh ? 'reply' : 'push', r
  const unknown = (x) => !x.ok && (x.status === 0 || x.status >= 500) // 連不上／LINE 伺服器錯＝不確定有沒有送到（第二輪 A3）
  // 第四輪 A：送 LINE 之前先把固定訊息鍵＋完整內容寫進送出標記（寫不進去＝不送，這時還沒送出，可以安全重試）
  const t = Date.now(); const mk = msgKey(acct, uid, t); const st0 = ibStore()
  const base = { id: mk, convId: conv.id, t: new Date(t).toISOString(), dir: 'out', by: who.name, ...msgPatch }
  if (st0 && st0.sendKey) { const okPre = await qPut(st0.sendKey, { st: 'sending', at: nowIso(), h: st0.sendH, acct, uid, mk, msg: base, lastText: String(lastText || '').slice(0, 80), by: who.name }).catch(() => false); if (!okPre) return { ok: false, notSent: true, error: '系統暫時連不上，還沒送出，請稍後再送' } }
  if (fresh) {
    r = await lineApi(a, '/v2/bot/message/reply', { method: 'POST', body: JSON.stringify({ replyToken: conv.replyToken, messages }) })
    if (!r.ok && !unknown(r)) { mode = 'push'; r = await lineApi(a, '/v2/bot/message/push', { method: 'POST', noQuota: true, body: JSON.stringify({ to: uid, messages }) }) } // reply 憑證過期（4xx）才退 push；不確定時不再推一次
  } else r = await lineApi(a, '/v2/bot/message/push', { method: 'POST', noQuota: true, body: JSON.stringify({ to: uid, messages }) })
  if (unknown(r)) return { ok: false, sentUnknown: true, error: `送出結果不確定（LINE ${r.status || '連不上'}）——請到 LINE 官方帳號後台確認客人有沒有收到，沒有再送` }
  if (!r.ok) return { ok: false, notSent: true, error: `LINE 不收（${r.status}）：${String(r.data?.message || '').slice(0, 80)}` }
  const msg = { ...base, mode }
  let markOk = true
  if (st0 && st0.sendKey) markOk = await qPut(st0.sendKey, { st: 'lineok', at: nowIso(), h: st0.sendH, acct, uid, mk, msg, lastText: String(lastText || '').slice(0, 80), by: who.name, mode }).catch(() => false) // LINE 已送出：記下（補存排程從這裡補記；第三輪 A3）；失敗不吞（第四輪 A）
  conv.replyUsed = true; conv.last = { text: String(lastText || '').slice(0, 80), t: msg.t, dir: 'out', by: who.name }; conv.lastT = msg.t; conv.lastOutT = msg.t; conv.unread = 0
  if (conv.status === 'new') conv.status = 'open'
  if (!conv.assignee) conv.assignee = who.name
  let ap; try { ap = await ibApply(ck, mk, msg, before, conv) } // 負責人空白才填（不蓋掉同時指派的）
  catch (e) { // LINE 已經送出、紀錄存不上：紀錄放佇列補存，回「已送出」（不能讓店員以為沒送又送一次）；佇列也放不進去＝照實說（送出標記裡有內容，補存排程會補記）
    const qok = await ibQueueOut(a, uid, String(lastText || ''), who.name, mode, t, { mk, msg }).catch(() => false) // 佇列存完整訊息（附件也照原樣補記）
    console.log('[inbox] 送出後紀錄存不上', mk, e && e.message, 'queue', qok, 'mark', markOk)
    let told = false
    if (!qok && !markOk) told = await ibAlert(st0 && st0.sendKey ? 'c_' + st0.sendKey.slice(10) : 'send_' + mk.slice(-40), `收件匣：「${String(lastText || '').slice(0, 40)}」已送給客人，但紀錄存不上（${a.name}・${uid.slice(-6)}）。請到 LINE 官方帳號後台核對；系統不會重送。`).catch(() => false)
    return { ok: true, msg, mode, conv: { status: conv.status, assignee: conv.assignee }, queued: !!qok, warn: qok ? '已送出，紀錄稍後補上' : markOk ? '已送出，但紀錄暫時存不上（系統會再補記）' : told ? '已送出，但紀錄存不上，已通知主管核對' : '已送出，但紀錄存不上，請告訴主管到 LINE 後台核對' }
  }
  const cv = ap.conv || conv
  { const st = ibStore(); if (st) st.snaps.set(ck, clone(cv)) } // 同一次請求後面再存這個對話時用最新的（Gemini 第三輪 B）
  return { ok: true, msg, mode, conv: { status: cv.status, assignee: cv.assignee } }
}
// 送圖片／檔案（v4.70.49 張良「能上傳檔案或截圖貼上嗎」）：圖片→LINE 圖片訊息（LINE 要抓得到的 https 網址＝私桶簽名一年）；其他檔案 LINE 沒有「檔案訊息」→ 用文字附連結
export async function sendMedia({ who, mgr, cfg, id, dataUrl, name }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  if (!canReplyAcct(cfg, who, mgr, acct)) return { ok: false, error: '你只有查看權限，沒有回覆權限（請主管在收件匣設定勾「可回覆」）' }
  if (!configured(a)) return { ok: false, error: `${a.name} 還沒設金鑰，不能回覆` }
  const m = /^data:([\w\/+.-]+);base64,(.+)$/.exec(String(dataUrl || '')); if (!m) return { ok: false, error: '檔案格式不對' }
  const buf = Buffer.from(m[2], 'base64'); const mime = m[1]
  if (!buf.length) return { ok: false, error: '檔案是空的' }
  if (buf.length > 10 * 1024 * 1024) return { ok: false, error: '檔案太大（上限 10MB）' }
  const ck = convKey(acct, uid); const conv = await kvGet(ck); if (!conv) return { ok: false, error: '找不到這個對話' }
  const fileName = String(name || '').trim().slice(0, 80) || (mime.startsWith('image/') ? '圖片' : '檔案')
  const isImg = /^image\/(jpeg|png)$/.test(mime) // LINE 圖片訊息只收 JPEG/PNG（前端已轉 JPEG）
  const ts = Date.now(); const path = `inbox/${acct}/${uid}/out_${ts.toString(36)}.${extOf(mime, fileName)}`
  if (!(await uploadPrivate(path, buf, mime))) return { ok: false, error: '上傳失敗' }
  const url = await signedUrl(path, 365 * 86400); if (!url) return { ok: false, error: '產生網址失敗' }
  const messages = isImg ? [{ type: 'image', originalContentUrl: url, previewImageUrl: url }] : [{ type: 'text', text: `📎 ${fileName}\n${url}` }]
  const msgPatch = isImg ? { type: 'image', media: path, mime, fileName, size: buf.length } : { type: 'file', media: path, mime, fileName, size: buf.length, text: `📎 ${fileName}` }
  return deliver({ a, acct, uid, ck, conv, who, messages, msgPatch, lastText: isImg ? '（圖片）' : `（檔案）${fileName}` })
}

// v4.70.85 團體訂餐計價圖：已上傳好的圖片網址一次傳多張＋一段文字（走同一條 deliver：reply 免費否則 push）
export async function sendSystemMessages({ acct, uid, messages, lastText }) { // v4.70.99 系統主動傳（團訂送出確認卡片等）：不經權限（由伺服器流程觸發）
  const a = acctOf(acct || 'gd'); if (!a || !uid || !configured(a)) return { ok: false, error: '帳號未設' }
  const ck = convKey(a.key, uid); const conv = await kvGet(ck); if (!conv) return { ok: false, error: '找不到對話' }
  return deliver({ a, acct: a.key, uid, ck, conv, who: { name: '系統' }, messages, msgPatch: { type: 'text', text: lastText || (messages[0] && (messages[0].text || '（卡片）' + messages[0].altText)) }, lastText: lastText || '（系統訊息）' })
}
export async function sendImages({ who, mgr, cfg, id, urls, text }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  if (!canReplyAcct(cfg, who, mgr, acct)) return { ok: false, error: '你只有查看權限，沒有回覆權限' }
  if (!configured(a)) return { ok: false, error: `${a.name} 還沒設金鑰，不能回覆` }
  const ck = convKey(acct, uid); const conv = await kvGet(ck); if (!conv) return { ok: false, error: '找不到這個對話' }
  const us = (urls || []).filter(u => /^https:\/\//.test(String(u))).slice(0, 4)
  if (!us.length) return { ok: false, error: '沒有圖片' }
  const messages = [...us.map(u => ({ type: 'image', originalContentUrl: u, previewImageUrl: u })), ...(text ? [{ type: 'text', text: String(text).slice(0, 4900) }] : [])]
  return deliver({ a, acct, uid, ck, conv, who, messages, msgPatch: { type: 'text', text: `（計價圖 ${us.length} 張）${text ? '\n' + text : ''}` }, lastText: '（計價圖）' })
}
// ── 狀態／指派／備註 ──
export async function convOp({ who, mgr, cfg, op, id, value }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  const ck = convKey(acct, uid); const conv = await kvGet(ck); if (!conv) return { ok: false, error: '找不到這個對話' }
  const t = Date.now()
  { const st = ibStore(); if (st) st.force = true } // v4.71.122 手動操作＝直接設定
  if (op === 'status' || op === 'wait') conv.statusT = nowIso() // 人工改狀態時間：之後補存較舊的客人訊息不會把它重開
  if (op === 'status') { conv.waitUntil = ''; if (!['new', 'open', 'done'].includes(value)) return { ok: false, error: '狀態不對' }; conv.status = value; if (value === 'done') conv.unread = 0; await kvInsert(msgKey(acct, uid, t), { id: 'x', convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: `${who.name} 標為「${{ new: '新', open: '處理中', done: '已完成' }[value]}」` }) }
  else if (op === 'assign') { conv.assignee = String(value || '').slice(0, 30); await kvInsert(msgKey(acct, uid, t), { id: 'x', convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: conv.assignee ? `${who.name} 指派給 ${conv.assignee}` : `${who.name} 取消指派` }); if (conv.assignee && conv.assignee !== who.name) notifyAssign(a, conv, who).catch(() => {}) }
  else if (op === 'note') conv.note = String(value || '').slice(0, 2000)
  // v4.71.11 張良 2026-10-14「有些客戶要特別注意、沒辦法即時完成 → 收進資料夾等待未來回覆避免忘記＋備忘錄」
  else if (op === 'star') { conv.star = !!value; conv.starBy = who.name; conv.starT = nowIso() }
  else if (op === 'wait') {
    const d = String(value || '')
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '日期格式不對' }
    if (d) { conv.status = 'wait'; conv.waitUntil = d; conv.waitBy = who.name } else { conv.status = 'open'; conv.waitUntil = '' }
    await kvInsert(msgKey(acct, uid, t), { id: 'x', convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: d ? `${who.name} 設為「等待中」，${d.slice(5).replace('-', '/')} 提醒再回覆` : `${who.name} 取消等待` }, '收件匣')
  }
  else if (op === 'memo') { const tx = String(value || '').trim().slice(0, 1000); if (!tx) return { ok: false, error: '備忘錄是空的' }; conv.memos = [...(conv.memos || []), { id: t.toString(36), t: new Date(t).toISOString(), by: who.name, text: tx }].slice(-100) }
  else if (op === 'cat') { const v = String(value || '').slice(0, 20); conv.cat = v; conv.catBy = v ? 'man' : '' }
  else if (op === 'custset') { const v = value && typeof value === 'object' ? value : {}; conv.phone = String(v.phone || '').replace(/[^\d+]/g, '').slice(0, 15); conv.phoneBy = 'man'; conv.email = String(v.email || '').trim().slice(0, 80); conv.company = String(v.company || '').trim().slice(0, 60); conv.tags = (Array.isArray(v.tags) ? v.tags : []).map(x => String(x).trim().slice(0, 16)).filter(Boolean).slice(0, 12) }
  else if (op === 'memodel') conv.memos = (conv.memos || []).filter(m => m.id !== String(value))
  else if (op === 'rename') conv.alias = String(value || '').slice(0, 40)
  else if (op === 'bkset') { // v4.71.23 人工設定／修改／清除確定訂位日期；ok=已用別的名字在 inline 訂好
    const v = value && typeof value === 'object' ? value : null
    if (!v || !v.date) { conv.bk = { by: 'man', cleared: true, t: nowIso() }; delete conv.bkSt }
    else { if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return { ok: false, error: '日期格式不對' }; conv.bk = { date: v.date, time: /^\d{1,2}:\d{2}$/.test(v.time || '') ? v.time : '', n: +v.n || 0, name: String(v.name || (conv.bk || {}).name || '').slice(0, 40), phone: String((conv.bk || {}).phone || ''), ok: !!v.ok, by: 'man', byWho: who.name, t: nowIso() }; conv.bkSt = await bkCheckOne(conv) }
  }
  else return { ok: false, error: '不認識的操作' }
  await kvSet(ck, conv)
  return { ok: true, conv: { status: conv.status, assignee: conv.assignee, note: conv.note, alias: conv.alias, star: !!conv.star, waitUntil: conv.waitUntil || '', memos: conv.memos || [], bk: conv.bk && conv.bk.date ? conv.bk : null, bkSt: conv.bkSt || null, cat: conv.cat || '', catBy: conv.catBy || '', phone: conv.phone || '', email: conv.email || '', company: conv.company || '', tags: conv.tags || [] } }
}
// ── v4.71.20 匯入舊帳號聊天記錄（張良 2026-10-14「這個聊天記錄可以直接匯入目前 app 對話框嗎」）──
// LINE 官方帳號後台「下載聊天記錄」的 CSV：前 3 行帳號名／時區／下載時間，第 4 行表頭（傳送者類型,傳送者名稱,傳送日期,傳送時間,內容）
// 只寫進收件匣給同事看：不傳給客人、不扣額度、不動未讀／排序／提醒；每則用「時間＋內容」算固定鍵，重複匯入同一份不會多出來
function parseCsv(txt) {
  const rows = []; let row = [], f = '', q = false; const s = String(txt || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++ } else q = false } else f += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(f); f = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
    else f += ch
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  return rows
}
const djb = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36).slice(-5) }
export function parseLineChat(csv) {
  const rows = parseCsv(csv)
  const meta = {}; let hi = -1
  for (let i = 0; i < Math.min(rows.length, 8); i++) { const r = rows[i]; if (r[0] === '傳送者類型') { hi = i; break } if (r[0]) meta[r[0]] = String(r[1] || '').replace(/^'/, '') }
  if (hi < 0) return { ok: false, error: '看不懂這個檔案：要用 LINE 官方帳號後台「下載聊天記錄」的 CSV' }
  const tz = /^[+-]\d{2}:\d{2}$/.test(meta['時區'] || '') ? meta['時區'] : '+08:00'
  const SHORT = { '貼圖已傳送': '（貼圖）', '照片已傳送': '（照片，舊帳號沒匯出內容）', '檔案已傳送': '（檔案，舊帳號沒匯出內容）', '影片已傳送': '（影片，舊帳號沒匯出內容）', '語音訊息已傳送': '（語音，舊帳號沒匯出內容）' }
  const out = []; let skipAuto = 0, bad = 0
  rows.slice(hi + 1).forEach((r) => {
    if (!r || r.length < 5 || !r[0]) return
    const [type, name, d, tm] = r; const text = String(r.slice(4).join(',')).trim()
    if (type === 'Account' && /自動回應|自動回覆/.test(name)) { skipAuto++; return }
    const ms = Date.parse(`${String(d).replace(/\//g, '-')}T${tm}${tz}`)
    if (!Number.isFinite(ms) || !text) { bad++; return }
    const dir = type === 'User' ? 'in' : 'out'
    const same = out.filter(m => Math.floor(m.ms / 1000) === ms / 1000).length // 同一秒多則：依序 +1 毫秒保住先後（換另一份重疊的檔案也算得一樣）
    const tx = text.replace(/\r\n?/g, '\n')
    out.push({ ms: ms + same, dir, name: String(name || ''), text: SHORT[tx] || tx })
  })
  return { ok: true, acctName: meta['帳號名稱'] || '舊帳號', msgs: out, skipAuto, bad }
}
export async function importChat({ who, mgr, cfg, id, csv, dry }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canReplyAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的回覆權限，不能匯入' }
  const ck = convKey(acct, uid); const conv = await kvGet(ck); if (!conv) return { ok: false, error: '找不到這個對話' }
  if (String(csv || '').length > 3e6) return { ok: false, error: '檔案太大（上限 3MB）' }
  const p = parseLineChat(csv); if (!p.ok) return p
  if (!p.msgs.length) return { ok: false, error: '檔案裡沒有可匯入的訊息' }
  const sum = { n: p.msgs.length, nIn: p.msgs.filter(m => m.dir === 'in').length, nOut: p.msgs.filter(m => m.dir === 'out').length, skipAuto: p.skipAuto, bad: p.bad, acctName: p.acctName, from: new Date(p.msgs[0].ms).toISOString(), to: new Date(p.msgs[p.msgs.length - 1].ms).toISOString() }
  if (dry) return { ok: true, dry: true, ...sum }
  const docs = p.msgs.map(m => ({ id: `pm_inbox_m_${acct}_${uid}_${m.ms.toString(36)}i${djb(m.dir + m.text)}`, data: { v: JSON.stringify({ id: 'imp', convId: conv.id, t: new Date(m.ms).toISOString(), dir: m.dir, type: 'text', text: m.text, ...(m.dir === 'in' ? { name: conv.name } : { by: (m.name && m.name !== 'Unknown') ? m.name : p.acctName }), imp: p.acctName }) }, editor: '收件匣匯入', updated_at: nowIso() }))
  const kvI = await ibKv()
  if (kvI.mode === 'gd') {
    for (let i = 0; i < docs.length; i += 200) {
      const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(docs.slice(i, i + 200)) })
      if (!r.ok) return { ok: false, error: '寫入失敗：' + r.status }
    }
  } else { // 已搬新殼：逐筆經命令橋存（鍵固定＝重匯不重複；8 筆並行）
    let k = 0; const work = async () => { while (k < docs.length) { const d = docs[k++]; await kvI.retry(async () => { await kvI.kvGet(d.id); await kvI.kvPut(d.id, JSON.parse(d.data.v), '匯入舊紀錄') }) } }
    try { await Promise.all(Array.from({ length: Math.min(8, docs.length) }, work)) } catch (e) { return { ok: false, error: '寫入失敗：' + String(e && e.message || e).slice(0, 80) } }
  }
  conv.imports = [...(conv.imports || []), { t: nowIso(), by: who.name, acctName: p.acctName, n: sum.n, from: sum.from, to: sum.to }].slice(-20)
  await kvSet(ck, conv)
  return { ok: true, ...sum }
}
// ── v4.71.11 問 AI（張良 2026-10-14「要有 AI 對話框，讓我即時詢問一些內容回覆給客戶」）：看這段對話＋備忘錄回答；要擬回覆就放在【回覆草稿】區塊，前端一鍵放進回覆框（不會自動發出）──
// ── v4.71.22 問 AI 直通訂位檔期（張良 2026-10-14「這邊的 AI 功能能直通 inline 嗎，像 DD 可以回答訂位狀況」）──
// 從「問題＋客人最近訊息＋備忘錄」抓日期（1/7、1月7日、2027-01-07、明年…；沒寫年份＝今天以後最近的那天），當場讀 inline 訂位月檔＋當日備註＋EM 包場案件給 AI
export function pickDates(text, today) {
  const ty = +today.slice(0, 4), out = new Set(), months = new Set()
  const pad = (n) => String(n).padStart(2, '0')
  const ok = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31
  const s = String(text || '')
  for (const m of s.matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/g)) if (ok(+m[2], +m[3])) out.add(`${m[1]}-${pad(m[2])}-${pad(m[3])}`)
  let yHint = 0, lastEnd = -9
  for (const m of s.matchAll(/(明年|後年|今年)?\s*(?<!\d)(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})(?![\d:])/g)) {
    if (m[1]) yHint = { 今年: 0, 明年: 1, 後年: 2 }[m[1]]
    else if (m.index - lastEnd > 3) yHint = 0 // 「明年1/7、1/8」才延用年份；隔開的句子不延用
    lastEnd = m.index + m[0].length
    const mo = +m[2], d = +m[3]; if (!ok(mo, d)) continue
    let y = ty + yHint; let iso = `${y}-${pad(mo)}-${pad(d)}`
    if (!m[1] && !yHint && iso < today) iso = `${y + 1}-${pad(mo)}-${pad(d)}`
    out.add(iso)
  }
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
  for (const m of s.matchAll(/(明年|後年|今年)?\s*(?<![\d/一二三四五六七八九十期拜])(\d{1,2}|十[一二]?|[一二三四五六七八九])\s*月(?!\s*[\d一二三四五六七八九十])/g)) {
    const mo = CN[m[2]] || +m[2]; if (mo < 1 || mo > 12) continue
    const yh = m[1] ? { 今年: 0, 明年: 1, 後年: 2 }[m[1]] : 0
    let ym = `${ty + yh}-${pad(mo)}`; if (!m[1] && ym < today.slice(0, 7)) ym = `${ty + 1}-${pad(mo)}`
    months.add(ym)
  }
  return { dates: [...out].filter(d => d >= today).sort().slice(0, 10), months: [...months].sort().slice(0, 2) }
}
export async function resvBrief({ dates, months }) {
  if (!dates.length && !months.length) return ''
  const mos = [...new Set([...dates.map(d => d.slice(0, 7)), ...months])].slice(0, 4)
  const kv = await kvGetMany([...mos.map(m => 'sp_finance_pm_inline_' + m), 'sp_finance_pm_inline_notes', 'sp_finance_pm_em'])
  const notes = ((kv.sp_finance_pm_inline_notes || {}).days) || {}
  const em = ((kv.sp_finance_pm_em || {}).projects) || []
  const ST = { 1: '已確認', 3: '待確認', 4: '已入座', 6: '已確認' }
  const wd = (d) => '日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()]
  const dayRecs = (d) => ((((kv['sp_finance_pm_inline_' + d.slice(0, 7)] || {}).days) || {})[d] || []).filter(r => r.st !== 2 && r.st !== 5)
  const emOn = (d) => em.filter(p => p.date === d && !/取消|流失|作廢/.test(p.status || ''))
  const emLine = (p) => `包場案件「${p.title || p.code}」${p.cust ? '客戶 ' + p.cust : ''}${p.n ? '・' + p.n + ' 人' : ''}${p.start ? '・' + p.start + (p.end ? '–' + p.end : '') : ''}${p.venue ? '・區域 ' + p.venue : ''}${p.status ? '・' + p.status : ''}${p.deposit ? '・訂金 ' + p.deposit : ''}`
  const L = []
  for (const d of dates) {
    const rs = dayRecs(d), lu = rs.filter(r => r.t && r.t < '17:00'), di = rs.filter(r => !r.t || r.t >= '17:00')
    const sum = (a) => a.reduce((t, r) => t + (r.n || 0), 0)
    L.push(`${d}（${wd(d)}）：${rs.length ? `inline 已有 ${rs.length} 組 ${sum(rs)} 人（午 ${lu.length} 組 ${sum(lu)} 人／晚 ${di.length} 組 ${sum(di)} 人）` : 'inline 目前沒有訂位'}`)
    const cn = (x) => String(x || '').replace(/Purpose:\s*✅一般用餐無特殊需求✅/g, '').replace(/\s+/g, ' ').trim() // 訂位表單預設勾選＝不是真備註
    rs.filter(r => (r.n || 0) >= 10 || cn(r.note) || cn(r.inote)).sort((a, b) => String(a.t).localeCompare(String(b.t))).slice(0, 15).forEach(r => L.push(`  - ${r.t || '未填時間'} ${r.name || ''} ${r.n || 0} 人｜${ST[r.st] || r.st}${cn(r.note) ? '｜客註：' + cn(r.note).slice(0, 60) : ''}${cn(r.inote) ? '｜店註：' + cn(r.inote).slice(0, 60) : ''}`))
    ;(notes[d] || []).forEach(n => n && n.note && L.push(`  - 當日備註：${String(n.note).replace(/\s+/g, ' ').slice(0, 100)}`))
    emOn(d).forEach(p => L.push('  - ' + emLine(p)))
  }
  for (const ym of months) {
    const days = (((kv['sp_finance_pm_inline_' + ym] || {}).days) || {})
    const ds = new Set([...Object.keys(days), ...Object.keys(notes).filter(d => d.startsWith(ym)), ...em.filter(p => String(p.date || '').startsWith(ym)).map(p => p.date)])
    const rows = [...ds].filter(d => d.startsWith(ym)).sort().map(d => { const rs = dayRecs(d); const big = rs.filter(r => (r.n || 0) >= 20).map(r => `${r.name} ${r.n}人${r.t ? ' ' + r.t : ''}`); const ems = emOn(d).map(p => `包場「${p.title || p.code}」${p.n ? p.n + '人' : ''}`); const nt = (notes[d] || []).filter(n => /包場|全包|關閉|公休|不開/.test(String(n.note || ''))).length ? '有包場／公休註記' : ''; return (big.length || ems.length || nt) ? `  - ${d.slice(5)}（${wd(d)}）${rs.length} 組 ${rs.reduce((t, r) => t + (r.n || 0), 0)} 人${big.length ? '；大組：' + big.join('、') : ''}${ems.length ? '；' + ems.join('、') : ''}${nt ? '；' + nt : ''}` : '' }).filter(Boolean)
    L.push(`${ym} 整月（只列有 20 人以上大組／包場案件／包場公休註記的日子）：${rows.length ? '' : '沒有'}`); rows.forEach(r => L.push(r))
  }
  return L.join('\n')
}
export async function inboxAi({ who, mgr, cfg, id, q, hist }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  const question = String(q || '').trim().slice(0, 2000); if (!question) return { ok: false, error: '請輸入問題' }
  const conv = await kvGet(convKey(acct, uid)); if (!conv) return { ok: false, error: '找不到這個對話' }
  const rows = await kvLike(`pm_inbox_m_${acct}_${uid}_`, 60, 'id.desc')
  rows.sort((x, y) => String(x.t).localeCompare(String(y.t)))
  const tw = (t) => new Date(new Date(t).getTime() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
  const lines = rows.map(m => `[${tw(m.t)}] ${m.dir === 'in' ? '客人' : m.dir === 'out' ? '我們（' + (m.by || '') + '）' : '系統'}：${(String(m.text || (m.media ? '（圖片／檔案）' : '')) + (m.ai ? `\n　〔照片／檔案內容（AI 讀的）〕${m.ai}` : '')).slice(0, m.ai ? 3000 : 500)}`)
  const memos = [...(conv.note ? [{ by: '', text: conv.note }] : []), ...(conv.memos || [])].map(m => `・${m.by ? m.by + '：' : ''}${m.text}`)
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const pk = pickDates([question, ...(Array.isArray(hist) ? hist : []).slice(-4).map(h => h.text), ...rows.filter(m => m.dir === 'in').slice(-15).map(m => m.text), ...memos].join('\n'), today)
  let resv = ''; try { resv = await resvBrief(pk) } catch (_) { resv = '（訂位資料暫時讀不到）' }
  const SYS = `你是「${a.name}」餐廳 LINE 官方帳號的客服助手，幫店內同事（${who.name}）處理這位客人的對話。今天是 ${today}（台灣）。
規則：
- 一律繁體中文、口語、簡短。
- 不知道的事實（價格、營業時間、能不能包場、發票規定、活動內容）不要編，直接說「這要跟店裡確認」，並列出要確認什麼。
- 同事要你「擬回覆／幫我回」時，把要傳給客人的話放在【回覆草稿】和【/回覆草稿】中間；語氣親切、像店家本人，不要提到 AI。
- 沒被要求擬回覆時就直接回答同事的問題，不要硬塞草稿。
- 問到檔期／訂位／某天能不能辦：只能根據下面【A Beach 訂位檔期】回答（inline 訂位系統＋包場案件，系統剛剛即時讀的），列出那天已有幾組幾人、有沒有大組或包場；能不能再接、場地容量、價格這些資料裡沒有的，說「要跟店裡確認」。沒列到的日期就說還沒查到，請同事把日期寫清楚（例如 1/7）。

【客人】${conv.alias || conv.name || '客人'}${conv.alias && conv.name ? '（LINE 名稱 ' + conv.name + '）' : ''}；狀態：${({ new: '新', open: '處理中', wait: '等待中', done: '已完成' })[conv.status] || conv.status}${conv.waitUntil ? '（' + conv.waitUntil + ' 要再回覆）' : ''}
【內部備忘錄】${memos.length ? '\n' + memos.join('\n') : '（無）'}
【A Beach 訂位檔期】${resv ? '\n' + resv : '（這次問題和對話裡沒有看到具體日期，所以沒有查）'}
【最近對話】
${lines.join('\n') || '（沒有訊息）'}`
  const messages = [...(Array.isArray(hist) ? hist : []).slice(-8).map(h => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: String(h.text || '').slice(0, 2000) })).filter(m => m.content), { role: 'user', content: question }]
  try {
    const { aiCall } = await import('./_ai.js')
    const r = await aiCall('inbox', { system: SYS, messages, maxTokens: 1500, timeoutMs: 60000 })
    const text = String(r.text || '').trim()
    const m = text.match(/【回覆草稿】([\s\S]*?)(【\/回覆草稿】|$)/)
    return { ok: true, text: text.replace(/【回覆草稿】[\s\S]*?(【\/回覆草稿】|$)/, '').trim(), draft: m ? m[1].trim() : '', model: r.model }
  } catch (e) { return { ok: false, error: 'AI 沒回應：' + String(e?.message || e).slice(0, 80) } }
}
async function notifyAssign(a, conv, who) {
  const bind = await kvGet('sp_finance_pm_prep_bind'); const rids = new Set()
  for (const v of Object.values((bind || {}).tokens || {})) if (v && v.name === conv.assignee) { if (v.rid) rids.add(String(v.rid)); if (v.uid) rids.add(String(v.uid)) }
  if (!rids.size) return
  const { wpPush } = await import('./_webpush.js')
  await wpPush([...rids], { title: `收件匣指派：${a.name}`, body: `${who.name} 把「${conv.name}」的對話交給你`, url: '/prep#inbox=' + encodeURIComponent(conv.id), cat: 'inbox' })
}

// ── 設定（主管）：帳號連線狀態＋權限＋範本＋提醒分鐘 ──
export async function settings({ origin }) {
  const cfg = await remindDefaults(await loadCfg())
  const sig = (await kvGet('pm_inbox_acct__sigfail')) || { n: 0 }
  let groups = []; try { const { ddGroupList } = await import('./_ddmsg.js'); groups = (await ddGroupList({})).filter(g => !g.gone && !(g.cfg && g.cfg.hide)).map(g => ({ gid: g.gid, name: (g.cfg && g.cfg.alias) || g.name || g.gid.slice(-6) })) } catch (_) {} // 提醒可直接發 DD 在的 LINE 群
  const accounts = await Promise.all(ACCOUNTS.map(async a => {
    const ok = configured(a); const st = (await kvGet(statKey(a.key))) || {}
    let info = null, hook = null, quota = null
    if (ok) { const [i, w, q] = await Promise.all([botInfo(a), webhookInfo(a), quotaOf(a)]); info = i.ok ? i.data : { error: i.data?.message || i.status }; hook = w.ok ? w.data : { error: w.data?.message || w.status }; quota = q }
    const want = origin + (a.relay ? '/api/line-webhook' : '/api/inbox-webhook') // relay（DD）＝webhook 應該指在 DD 自己的接收端
    return { key: a.key, name: a.name, color: a.color, relay: !!a.relay, configured: ok, forward: maskUrl(cfg.forward[a.key] || ''), forwardSet: !!cfg.forward[a.key], lastFwd: st.lastFwd || null, envSecret: a.env + '_SECRET', envToken: a.env + '_TOKEN', info, hook, hookOk: !!(hook && hook.endpoint === want && hook.active), wantHook: want, quota, lastEventT: st.lastEventT || '', lastEventType: st.lastEventType || '' }
  }))
  return { ok: true, accounts, cfg: { perm: cfg.perm, reply: cfg.reply, remind: cfg.remind, templates: cfg.templates, remindMin: cfg.remindMin, escalateH: +cfg.escalateH || 24, cats: cfg.cats, quiet: cfg.quiet || null }, sigfail: sig, groups }
}
export async function saveCfg(patch, who) {
  const cfg = await loadCfg()
  if (patch.perm && typeof patch.perm === 'object') { cfg.perm = {}; for (const a of ACCOUNTS) cfg.perm[a.key] = Array.isArray(patch.perm[a.key]) ? patch.perm[a.key].map(String).slice(0, 50) : [] }
  if (patch.reply && typeof patch.reply === 'object') { cfg.reply = {}; for (const a of ACCOUNTS) cfg.reply[a.key] = Array.isArray(patch.reply[a.key]) ? patch.reply[a.key].map(String).slice(0, 50) : [] }
  if (Array.isArray(patch.templates)) cfg.templates = patch.templates.filter(x => x && (x.text || '').trim()).map((x, i) => ({ id: x.id || ('t' + Date.now().toString(36) + i), title: String(x.title || '').slice(0, 30), text: String(x.text || '').slice(0, 1000) })).slice(0, 60)
  if (patch.remindMin != null) cfg.remindMin = Math.max(5, Math.min(1440, +patch.remindMin || 30))
  if (Array.isArray(patch.cats)) { const cs = [...new Set(patch.cats.map(x => String(x || '').trim().slice(0, 20)).filter(Boolean))].slice(0, 20); cfg.cats = cs.length ? cs : DEF_CATS }
  if (patch.quiet !== undefined) { const qq = patch.quiet; cfg.quiet = qq && qq.on !== false && qq.from !== '' && qq.to !== '' ? { from: Math.max(0, Math.min(23, +qq.from || 0)), to: Math.max(0, Math.min(23, +qq.to || 0)) } : null }
  if (patch.escalateH != null) cfg.escalateH = Math.max(1, Math.min(168, +patch.escalateH || 24))
  if (patch.remind && typeof patch.remind === 'object') { cfg.remind = cfg.remind || {}; for (const [k, v] of Object.entries(patch.remind)) { if (!acctOf(k) || !v || typeof v !== 'object') continue; cfg.remind[k] = { people: Array.isArray(v.people) ? v.people.map(String).slice(0, 50) : [], group: /^[CR][0-9a-f]{32}$/.test(String(v.group || '')) ? String(v.group) : '' } } }
  if (patch.forward && typeof patch.forward === 'object') { for (const [k, v] of Object.entries(patch.forward)) { if (!acctOf(k)) continue; const u = String(v || '').trim(); if (!u) delete cfg.forward[k]; else if (/^https:\/\//.test(u)) cfg.forward[k] = u.slice(0, 500) } }
  cfg.updatedBy = who.name; cfg.updatedT = nowIso()
  await kvSet(CFG_KEY, cfg, who.name)
  return { ok: true, cfg: { perm: cfg.perm, reply: cfg.reply, remind: cfg.remind, templates: cfg.templates, remindMin: cfg.remindMin, escalateH: +cfg.escalateH || 24 } }
}
// 把這個帳號的 webhook 指到我們這裡（先看現在指哪裡；指著別的系統就不硬改，回報給人決定）
export async function connectAcct({ key, origin, force }) {
  const a = acctOf(key); if (!a) return { ok: false, error: '沒有這個帳號' }
  if (a.relay) return { ok: false, error: `${a.name} 的 webhook 要留在 DD 自己的接收端（/api/line-webhook），私訊會自動轉進收件匣，不用改接` }
  if (!configured(a)) return { ok: false, error: `${a.name} 還沒設金鑰（${a.env}_SECRET／${a.env}_TOKEN）` }
  const want = origin + '/api/inbox-webhook'
  const cur = await webhookInfo(a)
  const curEp = cur.ok ? (cur.data.endpoint || '') : ''
  if (curEp && curEp !== want && !force) return { ok: false, needConfirm: true, current: maskUrl(curEp), error: `這個帳號的 webhook 目前指到別的系統：${maskUrl(curEp)}。改接後我們會把每一則原封轉發給它，它照常運作；確定要改接嗎？` }
  // 改接時把原本的系統記成「轉發對象」：原系統不會斷（可在設定頁停止轉發）
  if (curEp && curEp !== want) { const cfg = await loadCfg(); cfg.forward[a.key] = curEp; await kvSet(CFG_KEY, cfg, '收件匣改接') }
  const s = await webhookSet(a, want); if (!s.ok) return { ok: false, error: `LINE 不讓設定（${s.status}）：${String(s.data?.message || '').slice(0, 100)}` }
  const t = await webhookTest(a, want)
  await bumpStat(a.key, { connectedT: nowIso(), prevHook: curEp && curEp !== want ? curEp : undefined })
  return { ok: true, endpoint: want, test: t.data, previous: curEp && curEp !== want ? maskUrl(curEp) : '', forwarding: !!(curEp && curEp !== want) }
}

// ── 未回覆提醒（每小時 cron 呼叫）v4.71.9 張良 2026-10-13：①同一輪合併成一則（原本一個客人一則、群組按人數扣額度）②超過 remindMin 分鐘 → 只通知「通知誰」③超過 escalateH 小時（預設 24）還沒回 → 才發 LINE 群（每個對話每 24 小時最多進群一次）──
// 一次性預設（remindV<2）：三個官方帳號「通知誰」=張良瑋、群組=HAPPY337；之後在收件匣設定可改
async function remindDefaults(cfg) {
  if ((+cfg.remindV || 0) >= 3) return cfg
  if ((+cfg.remindV || 0) === 2) { cfg.quiet = cfg.quiet || { from: 21, to: 12 }; cfg.remindV = 3; await kvSet(CFG_KEY, cfg, '收件匣提醒安靜時段'); return cfg }
  let g337 = ''; try { const { ddGroupGid } = await import('./_ddmsg.js'); g337 = await ddGroupGid('internal') } catch (_) {}
  cfg.remind = cfg.remind || {}
  for (const a of ACCOUNTS) { if (a.relay) continue; cfg.remind[a.key] = { people: ['張良瑋'], group: /^[CR][0-9a-f]{32}$/.test(g337) ? g337 : ((cfg.remind[a.key] || {}).group || '') } }
  cfg.escalateH = 24; cfg.remindV = 3
  if (!cfg.quiet) cfg.quiet = { from: 21, to: 12 } // v4.71.13 張良 2026-10-14「晚上 21:00～隔日 12:00 不用提醒」
  await kvSet(CFG_KEY, cfg, '收件匣提醒預設')
  return cfg
}
export async function inboxRemind({ test } = {}) { return ibStore() ? _inboxRemind({ test }) : ibAs('收件匣排程', () => _inboxRemind({ test })) } // v4.71.122 包請求情境（對話快照、操作者）
async function _inboxRemind({ test } = {}) { // test=true：只私訊張良瑋、不發群、不存提醒時間（測試口 ?inboxremindtest=）
  const cfg = await remindDefaults(await loadCfg())
  const escH = +cfg.escalateH || 24
  // 安靜時段（台灣時間，from 點起到隔天 to 點前不發）：整輪跳過；時段結束後第一輪把累積的合併成一則（測試口不受限）
  const q = cfg.quiet || {}; const hTw = new Date(Date.now() + 8 * 3600e3).getUTCHours()
  if (!test && q.from != null && q.to != null && q.from !== q.to && (q.from > q.to ? (hTw >= q.from || hTw < q.to) : (hTw >= q.from && hTw < q.to))) return { ok: true, quiet: true, hour: hTw }
  const all = await kvLike('pm_inbox_c_', 600, 'updated_at.desc')
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  // v4.71.11 張良 2026-10-14「不需要給那麼多資訊，簡單整理名稱、不同官方幾則即可」：每位收件人／群各一則＝帳號分組「A Beach 3：甲、乙、丙」
  const P = {}, G = {}, touched = [], out = [] // P[姓名]={rids,acct:{key:[名字]},due:[名字]}；G[gid]={acct:{}}
  const add = (bk, k, a, nm, due) => { const b = bk[k] = bk[k] || { acct: {}, due: [], rids: new Set() }; if (due) b.due.push(`${a.name}・${nm}`); else (b.acct[a.key] = b.acct[a.key] || { a, n: [] }).n.push(nm); return b }
  for (const c of all) {
    if (!c || c.status === 'done') continue
    const a = acctOf(c.acct); if (!a || a.relay) continue // relay（DD）不提醒：DD 自己會答，沒答的留在待處理給人看就好
    const nm = c.alias || c.name || '客人'
    // 等待中：到了約定日期才提醒（一次），並自動放回「處理中」；還沒到就不吵
    if (c.status === 'wait') {
      if (!c.waitUntil || c.waitUntil > today) continue
      const { rids, names } = test ? { rids: [], names: ['張良瑋'] } : await permRids(c.acct, true)
      for (const n of names) { const b = add(P, n, a, nm, true); rids.forEach(r => b.rids.add(r)) }
      if (!test) { c.status = 'open'; c.waitUntil = ''; c.remindT = nowIso(); touched.push(c) }
      out.push(c.id); continue
    }
    if (!c.lastInT) continue
    if (c.lastOutT && c.lastOutT > c.lastInT) continue // 已回
    const age = Date.now() - new Date(c.lastInT).getTime()
    if (age < cfg.remindMin * 60e3) continue
    const dueP = test || !(c.remindT && Date.now() - new Date(c.remindT).getTime() < 55 * 60e3)
    const dueG = !test && age >= escH * 3600e3 && !(c.escT && Date.now() - new Date(c.escT).getTime() < 23.5 * 3600e3)
    if (!dueP && !dueG) continue
    const { rids, names, group } = test ? { rids: [], names: ['張良瑋'], group: '' } : await permRids(c.acct, true)
    if (dueP) { for (const n of names) { const b = add(P, n, a, nm); rids.forEach(r => b.rids.add(r)) } c.remindT = nowIso(); c.remindN = (c.remindN || 0) + 1 }
    if (dueG && group) { add(G, group, a, nm); c.escT = nowIso() }
    if (!test) touched.push(c); out.push(c.id)
  }
  const link = 'https://ground-pm.vercel.app/prep#inbox'
  const short = (n) => n.slice(0, 6).join('、') + (n.length > 6 ? ` 等 ${n.length} 位` : '')
  const body = (b) => { const ac = Object.values(b.acct); return [...ac.map(x => `${x.a.name} ${x.n.length}：${short(x.n)}`), ...(b.due.length ? [`等待到期 ${b.due.length}：${short(b.due)}`] : [])].join('\n') + `\n→ ${link}` }
  const head = (b, h) => { const tot = Object.values(b.acct).reduce((t, x) => t + x.n.length, 0); return `📥 ${h}${tot ? ` ${tot} 位沒回` : ''}${b.due.length ? `${tot ? '・' : ' '}${b.due.length} 位等待到期` : ''}` }
  let wpPush = null; try { wpPush = (await import('./_webpush.js')).wpPush } catch (_) {} // 推播模組壞了也不能擋 LINE 私訊
  try { const ros = await kvGet('sp_crew_kb_roster')
    for (const [an, b] of Object.entries(P)) {
      const txt = head(b, test ? '【測試】收件匣' : '收件匣') + '\n' + body(b)
      if (b.rids.size && wpPush) { try { await wpPush([...b.rids], { title: head(b, '收件匣').replace('📥 ', ''), body: txt.split('\n').slice(1, 4).join('\n').slice(0, 160), url: '/prep#inbox', cat: 'inbox' }) } catch (_) {} }
      const p = ((ros || {}).people || []).find(x => x.name === an && x.lineUserId); if (p) await linePush(p.lineUserId, txt)
    } } catch (_) {}
  for (const [g, b] of Object.entries(G)) { try { await linePush(g, head(b, `收件匣超過 ${escH} 小時`) + '\n' + body(b)) } catch (_) {} } // 群組推播按群內人數計費（LINE 規則）：合併成一則
  for (const c of touched) await kvSet(convKey(c.acct, c.uid), c, '收件匣提醒')
  return { ok: true, reminded: out, private: Object.keys(P).length, groups: Object.keys(G).length }
}
export const unreadTotal = async ({ who, mgr, cfg }) => (await listConvs({ who, mgr, cfg })).reduce((t, c) => t + (c.unread || 0), 0)

// ── v4.71.12 AI 補分類（每小時跟提醒一起跑）：還沒分類、近 7 天有動的對話，一次丟一批給便宜模型 ──
export async function inboxClassify() { return ibStore() ? _inboxClassify() : ibAs('收件匣排程', () => _inboxClassify()) } // v4.71.122 包請求情境（對話快照、操作者）
async function _inboxClassify() {
  const cfg = await loadCfg(); const cats = cfg.cats
  const all = await kvLike('pm_inbox_c_', 600, 'updated_at.desc')
  const todo = all.filter(c => c && !c.cat && c.catBy !== 'man' && !(acctOf(c.acct) || {}).relay && c.lastInT && Date.now() - new Date(c.lastInT).getTime() < 7 * 864e5 && (c.aiCatN || 0) < 2).slice(0, 25)
  if (!todo.length) return { ok: true, n: 0 }
  const items = await Promise.all(todo.map(async c => { const rows = await kvLike(`pm_inbox_m_${c.acct}_${c.uid}_`, 12, 'id.desc'); return { id: c.id, acct: (acctOf(c.acct) || {}).name, text: rows.filter(m => m.dir === 'in' && m.text).map(m => String(m.text).slice(0, 200)).reverse().join(' / ').slice(0, 600) } }))
  const { aiCall } = await import('./_ai.js')
  const r = await aiCall('summary', { system: `把餐廳 LINE 客服對話分類。只能用這些分類：${cats.join('、')}。判斷不出來就用「其他」。只回 JSON：{"對話id":"分類",...}，不要其他文字。`, messages: [{ role: 'user', content: JSON.stringify(items) }], maxTokens: 1200, effort: 'low', timeoutMs: 60000 })
  let map = {}; try { map = JSON.parse(String(r.text || '').replace(/^[^{]*/, '').replace(/[^}]*$/, '')) } catch (_) {}
  let n = 0
  for (const c of todo) { const v = map[c.id]; c.aiCatN = (c.aiCatN || 0) + 1; if (v && cats.includes(v)) { c.cat = v; c.catBy = 'ai'; n++ } await kvSet(convKey(c.acct, c.uid), c, '收件匣AI分類') }
  return { ok: true, n, tried: todo.length }
}
// ── v4.71.26 讀照片／檔案內容（張良 2026-10-14「summer 的照片跟檔案內容讀取得到嗎」＋「Word、Excel 怎麼會讀不了」）──
// 每張只讀一次，結果存在那則訊息的 ai 欄位（張良同意）；照片、PDF 給 AI 看（路由 mediaread）；Word／Excel／PowerPoint 直接拆檔取文字，不花 AI 錢
async function kvLikeRows(prefix, limit) { // 依歸屬讀（同 kvLike），回 [{id, v}]，編號新到舊
  const m = await (await ibKv()).kvPrefix(prefix, { order: 'id', limit: limit || 300 })
  return Object.entries(m).filter(([, v]) => v != null).map(([id, v]) => ({ id, v }))
}
async function unzipText(buf, want) { // 極簡 zip 讀取（Office 檔就是 zip）：只解 want(name) 為真的檔
  const zlib = await import('node:zlib'); const out = {}
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--
  if (e < 0) return out
  let p = buf.readUInt32LE(e + 16); const n = buf.readUInt16LE(e + 10)
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const meth = buf.readUInt16LE(p + 10), csz = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8'); p += 46 + nl + xl + cl
    if (!want(name)) continue
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.slice(ds, ds + csz)
    try { out[name] = (meth === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8') } catch (_) {}
  }
  return out
}
const xmlText = (x) => String(x || '').replace(/<\/w:p>|<\/a:p>|<w:br\/>|<w:tab\/>/g, m => m === '<w:tab/>' ? '\t' : '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim()
async function officeText(buf, ext) {
  if (ext === 'docx') { const f = await unzipText(buf, n => n === 'word/document.xml'); return xmlText(f['word/document.xml']) }
  if (ext === 'pptx') { const f = await unzipText(buf, n => /^ppt\/slides\/slide\d+\.xml$/.test(n)); return Object.keys(f).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/))).map((k, i) => `【第 ${i + 1} 頁】\n` + xmlText(f[k])).join('\n') }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    const X = (await import('xlsx')).default || (await import('xlsx')); const wb = X.read(buf, { type: 'buffer' })
    return wb.SheetNames.slice(0, 5).map(nm => `【${nm}】\n` + X.utils.sheet_to_csv(wb.Sheets[nm], { blankrows: false }).split('\n').slice(0, 300).join('\n')).join('\n')
  }
  if (ext === 'txt') return buf.toString('utf8')
  return ''
}
const MEDIA_PROMPT = '把這個檔案的內容完整轉成繁體中文文字，給餐廳客服同事看。對話截圖：逐則列出「誰：說了什麼」（含時間、金額、帳號末幾碼）；報價單／意向書／合約：列出所有欄位、日期、時段、人數、金額、訂金、帳戶；一般照片：一句話描述＋圖上看得到的字。不要加評論，不要省略數字。'
async function mediaReadOne(m) {
  if (!m.media) return ''
  const ext = String(m.fileName || m.media).toLowerCase().split('.').pop(), mime = String(m.mime || '')
  const isImg = m.type === 'image' || mime.startsWith('image/'), isPdf = mime === 'application/pdf' || ext === 'pdf'
  const office = ['docx', 'xlsx', 'xls', 'pptx', 'csv', 'txt'].includes(ext)
  if (!isImg && !isPdf && !office) return '' // 影片、語音、舊版 .doc／.ppt 先跳過
  const u = await signedUrl(m.media, 600); if (!u) return ''
  const r = await fetch(u); if (!r.ok) return ''
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 18e6) return '（檔案太大，沒有讀）'
  if (office) return (await officeText(buf, ext)).slice(0, 6000)
  const { aiCall } = await import('./_ai.js')
  const res = await aiCall('mediaread', { messages: [{ role: 'user', content: [{ type: 'image', media_type: isPdf ? 'application/pdf' : (mime.startsWith('image/') ? mime : 'image/jpeg'), data: buf.toString('base64') }, { type: 'text', text: MEDIA_PROMPT }] }], maxTokens: 2500, timeoutMs: 90000 })
  return String(res.text || '').trim().slice(0, 6000)
}
export async function inboxMediaRead({ force, limit = 12 } = {}) { return ibStore() ? _inboxMediaRead({ force, limit }) : ibAs('收件匣排程', () => _inboxMediaRead({ force, limit })) } // v4.71.122 包請求情境（對話快照、操作者）
async function _inboxMediaRead({ force, limit = 12 } = {}) { // 每小時：有新動靜的對話裡還沒讀過的照片／檔案；force＝全部對話補讀
  const all = await kvLike('pm_inbox_c_', 600, 'updated_at.desc')
  const convs = all.filter(c => c && !(acctOf(c.acct) || {}).relay && c.lastT && (force || !c.mediaChkT || c.lastT > c.mediaChkT))
  let n = 0, tried = 0, fail = 0
  for (const c of convs) {
    if (tried >= limit) break
    const rows = (await kvLikeRows(`pm_inbox_m_${c.acct}_${c.uid}_`, 300)).filter(x => x.v.media && x.v.ai == null)
    let got = 0
    for (const x of rows) {
      if (tried >= limit) break
      tried++
      let txt = ''; try { txt = await mediaReadOne(x.v) } catch (e) { fail++; continue }
      x.v.ai = txt || ''; x.v.aiT = nowIso(); await kvSet(x.id, x.v, '收件匣讀檔'); if (txt) { n++; got++ }
    }
    const left = rows.length - rows.filter(x => x.v.ai != null).length
    const cur = await kvGet(convKey(c.acct, c.uid)); if (!cur) continue
    if (!left) cur.mediaChkT = nowIso()
    if (got) cur.bkChkT = '' // 讀到新內容→下一輪訂位偵測重看這位
    await kvSet(convKey(c.acct, c.uid), cur, '收件匣讀檔')
  }
  return { ok: true, read: n, tried, fail }
}
// ── v4.71.23 確定訂位日期 × inline 有沒有訂（張良 2026-10-14「偵測客人已經確定的訂位日期、inline 訂位了沒，常態顯示讓我不會漏掉」）──
// conv.bk＝{date,time,n,name,phone,by:'ai'|'man',ok(人工標已訂),t}；conv.bkSt＝{st:'ok'|'maybe'|'none',rec,dayG,dayN,ref,pct,em,at}；conv.bkRem＝{d,h,sent}
// 提醒（張良 B）：活動前兩週起每天提醒；還沒到兩週但那天 inline 已訂到平常滿位的一半以上（訂不到位的風險）就提早每天提醒；時間每天隨機 12~20 點
const BK_ACCTS = ['ab'] // inline 只有 A Beach
const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const bkDays = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(twToday() + 'T00:00:00Z')) / 864e5)
export async function bkDetect({ limit = 15, force } = {}) { return ibStore() ? _bkDetect({ limit, force }) : ibAs('收件匣排程', () => _bkDetect({ limit, force })) } // v4.71.122 包請求情境（對話快照、操作者）
async function _bkDetect({ limit = 15, force } = {}) {
  const all = await kvLike('pm_inbox_c_', 600, 'updated_at.desc')
  const todo = all.filter(c => c && BK_ACCTS.includes(c.acct) && c.lastT && (force || !c.bkChkT || c.lastT > c.bkChkT || (c.memos || []).some(m => m.t > c.bkChkT)) && !bkManLock(c) && (Date.now() - new Date(c.lastT).getTime() < 180 * 864e5)).slice(0, limit)
  if (!todo.length) return { ok: true, n: 0 }
  const { aiCall } = await import('./_ai.js'); const today = twToday()
  const tw = (t) => new Date(new Date(t).getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
  let n = 0
  const one = async (c) => {
    const rows = await kvLike(`pm_inbox_m_${c.acct}_${c.uid}_`, 80, 'id.desc'); rows.sort((x, y) => String(x.t).localeCompare(String(y.t)))
    const lines = rows.filter(m => (m.text || m.ai) && m.dir !== 'sys').map(m => `[${tw(m.t)}] ${m.dir === 'in' ? '客人' : '店家'}：${String(m.text || '').slice(0, 300)}${m.ai ? `〔照片／檔案內容〕${String(m.ai).slice(0, 1500)}` : ''}`).join('\n').slice(-14000)
    const memos = (c.memos || []).map(m => m.text).join('\n').slice(0, 2000)
    let j = null
    try {
      const r = await aiCall('inbox', { system: `你判斷餐廳客服對話裡「客人已經確定要來的訂位／包場日期」。今天是 ${today}（台灣）。
只有雙方已經講定（店家答應、客人確認，或已談到訂金／意向書／報價）才算確定；客人只是詢問、比較幾個日期、還在考慮，都不算。
只回 JSON，不要其他字：{"confirmed":true/false,"date":"YYYY-MM-DD","time":"HH:MM 或空字串","n":人數數字或0,"name":"訂位人或公司名稱","phone":"電話或空字串","why":"一句話理由"}。年份沒寫就推算成今天以後最近的那天。多個確定日期只回最近的未來那個。`, messages: [{ role: 'user', content: `【客人 LINE 名稱】${c.alias || c.name || ''}\n【內部備忘錄】\n${memos || '（無）'}\n【對話】\n${lines || '（無）'}` }], maxTokens: 400, effort: 'low', timeoutMs: 60000 })
      j = JSON.parse(String(r.text || '').replace(/^[^{]*/, '').replace(/[^}]*$/, ''))
    } catch (_) { return }
    const cur = await kvGet(convKey(c.acct, c.uid)); if (!cur || bkManLock(cur)) return // 先重讀再寫：不蓋掉這段時間進來的新訊息／人工設定
    if (j && j.confirmed && /^\d{4}-\d{2}-\d{2}$/.test(j.date || '')) { cur.bk = { date: j.date, time: /^\d{1,2}:\d{2}$/.test(j.time || '') ? j.time : '', n: +j.n || 0, name: String(j.name || '').slice(0, 40), phone: String(j.phone || '').replace(/[^\d+]/g, '').slice(0, 15), why: String(j.why || '').slice(0, 80), by: 'ai', t: nowIso() }; n++ }
    else if (cur.bk && (cur.bk.by === 'ai' || cur.bk.cleared)) delete cur.bk
    cur.bkChkT = nowIso()
    if (cur.bk) cur.bkSt = await bkCheckOne(cur)
    else delete cur.bkSt
    await kvSet(convKey(c.acct, c.uid), cur, '收件匣訂位偵測')
  }
  for (let i = 0; i < todo.length; i += 5) await Promise.all(todo.slice(i, i + 5).map(one))
  return { ok: true, n, tried: todo.length }
}
const _bkMo = {} // 同一輪內共用；5 分鐘過期（函式實例會被重複使用，不能一直拿舊資料）
async function bkMonth(ym) { const h = _bkMo[ym]; if (!h || Date.now() - h.t > 300e3) _bkMo[ym] = { t: Date.now(), p: kvGet('sp_finance_pm_inline_' + ym).then(x => ((x || {}).days) || {}).catch(() => ({})) }; return _bkMo[ym].p }
let _bkEm = null
async function bkEm() { if (!_bkEm || Date.now() - _bkEm.t > 300e3) _bkEm = { t: Date.now(), p: kvGet('sp_finance_pm_em').then(x => (x || {}).projects || []).catch(() => []) }; return _bkEm.p }
const bkManLock = (c) => !!(c.bk && c.bk.by === 'man' && (!c.bk.cleared || String(c.lastT || '') <= String(c.bk.t || ''))) // 人工設過就不讓 AI 改；人工清除後客人又有新訊息才重新判斷
async function bkRef(date) { // 那個星期幾「平常最滿」的人數：過去 26 週同星期幾的單日訂位人數，去掉有 40 人以上大組的日子（包場會撐爆）取最大
  const wd = new Date(date + 'T00:00:00Z').getUTCDay(); const today = twToday(); const vals = []
  for (let k = 1; k <= 26; k++) {
    const d = new Date(Date.parse(today + 'T00:00:00Z') - k * 7 * 864e5 + (((wd - new Date(today + 'T00:00:00Z').getUTCDay()) + 7) % 7) * 864e5).toISOString().slice(0, 10)
    if (d >= today) continue
    const rs = ((await bkMonth(d.slice(0, 7)))[d] || []).filter(r => r.st !== 2 && r.st !== 5)
    if (!rs.length || rs.some(r => (r.n || 0) >= 40)) continue
    vals.push(rs.reduce((t, r) => t + (r.n || 0), 0))
  }
  return vals.length ? Math.max(...vals) : 0
}
export async function bkCheckOne(c) {
  const b = c.bk || {}; if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return null
  const rs = ((await bkMonth(b.date.slice(0, 7)))[b.date] || []).filter(r => r.st !== 2 && r.st !== 5)
  const pk = phoneKey(b.phone || c.phone || ''), toks = [b.name, c.alias, c.name, c.company].flatMap(x => String(x || '').split(/[\s、,，/()（）<>]+/)).map(x => x.replace(/(小姐|先生|女士|老師)$/, '').trim()).filter(x => x.length >= 2)
  let rec = null, st = 'none'
  for (const r of rs) {
    const rn = String(r.name || '')
    if ((pk.length === 9 && phoneKey(r.phone) === pk) || toks.some(t => rn.includes(t) || (rn.length >= 2 && t.includes(rn)))) { rec = r; st = 'ok'; break }
  }
  if (!rec && b.n >= 15) { const m = rs.find(r => (r.n || 0) >= 15 && Math.abs((r.n || 0) - b.n) <= Math.max(5, b.n * 0.25)); if (m) { rec = m; st = 'maybe' } }
  if (b.ok) st = 'ok'
  const em = (await bkEm()).find(p => p.date === b.date && !/取消|流失|作廢/.test(p.status || '') && toks.some(t => String(p.cust || '').includes(t) || String(p.title || '').includes(t)))
  const dayN = rs.reduce((t, r) => t + (r.n || 0), 0), ref = await bkRef(b.date)
  return { st, rec: rec ? { t: rec.t || '', name: rec.name || '', n: rec.n || 0 } : null, dayG: rs.length, dayN, ref, pct: ref ? Math.round(dayN / ref * 100) : null, em: em ? (em.title || em.code) : '', manual: !!b.ok, at: nowIso() }
}
export async function bkWatch({ test, dry } = {}) { return ibStore() ? _bkWatch({ test, dry }) : ibAs('收件匣排程', () => _bkWatch({ test, dry })) } // v4.71.122 包請求情境（對話快照、操作者）
async function _bkWatch({ test, dry } = {}) { // dry：只回要發的內容，不發不存（驗證用）
  if (dry) test = true // 每小時：重算所有未來訂位的 inline 狀態＋到點發提醒
  const cfg = await loadCfg(); const warn = +cfg.bkWarnPct || 50
  const all = await kvLike('pm_inbox_c_', 600, 'updated_at.desc'); const today = twToday(); const hTw = new Date(Date.now() + 8 * 3600e3).getUTCHours()
  const due = []; let n = 0
  for (const c of all) {
    if (!c || !c.bk || !BK_ACCTS.includes(c.acct) || !c.bk.date || c.bk.date < today) continue
    const st = await bkCheckOne(c); const left = bkDays(c.bk.date)
    const cur = await kvGet(convKey(c.acct, c.uid)); if (!cur || !cur.bk || cur.bk.date !== c.bk.date) continue
    cur.bkSt = st; n++
    const risky = st && st.st === 'none' && (left <= 14 || (st.pct != null && st.pct >= warn))
    if (risky) {
      const r = cur.bkRem && cur.bkRem.d === today ? cur.bkRem : { d: today, h: 12 + Math.floor(Math.random() * 9), sent: false } // 每天換一個時間（張良：時間不要固定，免得習慣性忽略）
      if (test || (!r.sent && hTw >= r.h)) { due.push({ c: cur, st, left }); if (!test) r.sent = true }
      cur.bkRem = r
    }
    if (!test) await kvSet(convKey(c.acct, c.uid), cur, '收件匣訂位檢查')
  }
  if (due.length) {
    due.sort((x, y) => x.left - y.left)
    const wd = (d) => '日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()]
    const txt = `📅 ${test ? '【測試】' : ''}inline 還沒訂位 ${due.length} 位\n` + due.map(({ c, st, left }) => `・${c.alias || c.bk.name || c.name} ${c.bk.date.slice(5).replace('-', '/')}(${wd(c.bk.date)})${c.bk.n ? ' ' + c.bk.n + '人' : ''}｜${left === 0 ? '就是今天' : '還有 ' + left + ' 天'}${st.pct != null ? `｜那天已訂 ${st.dayN} 人（平常最滿 ${st.ref}，${st.pct}%）` : ''}${st.pct != null && st.pct >= warn ? ' ⚠️ 快滿了' : ''}`).join('\n') + '\n→ https://ground-pm.vercel.app/prep#inbox'
    if (dry) return { ok: true, dry: true, text: txt, n: due.length }
    const { names } = test ? { names: ['張良瑋'] } : await permRids('ab', true)
    try { const ros = await kvGet('sp_crew_kb_roster'); for (const nm of names) { const p = ((ros || {}).people || []).find(x => x.name === nm && x.lineUserId); if (p) await linePush(p.lineUserId, txt) } } catch (_) {}
  }
  return { ok: true, checked: n, reminded: due.length }
}
// ── v4.71.12 客戶資料側欄：會員（LINE 帳號直接對）＋ inline 訂位（電話後 9 碼）＋ EM 包場案件（名字）──
export async function inboxCust({ who, mgr, cfg, id }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  const MB = await import('./_member.js')
  const shard = (pk) => kvGet('sp_finance_pm_inline_ph3_' + pk.slice(-3)).then(sh => (sh && sh.rows && sh.rows[pk]) || null).catch(() => null)
  const [conv, mc, em] = await Promise.all([kvGet(convKey(acct, uid)), (acct === 'gd' ? MB.memberCard(uid).catch(() => null) : null) /* 會員制只在 GROUN:D 帳號 */, kvGet('sp_finance_pm_em').catch(() => null)]) // 速度鐵則：同時查
  if (!conv) return { ok: false, error: '找不到這個對話' }
  const member = mc ? mc.member : null, mphone = mc ? mc.phone : ''
  const phone = conv.phone || mphone || ''
  const pk = phoneKey(phone)
  let inline = null
  if (pk.length === 9) { const r = await shard(pk); if (r) inline = { name: r[0], visits: r[1], cancels: r[2], first: r[3], last: r[4], maxParty: r[5], bookings: r[6] } }
  const names = [conv.alias, conv.name, member && member.name].map(x => String(x || '').trim()).filter(x => x.length >= 2)
  const projects = ((em && em.projects) || []).filter(p => p.cust && names.some(n => p.cust.includes(n) || n.includes(p.cust))).sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))).slice(0, 8).map(p => ({ code: p.code, title: p.title, date: p.date, n: p.n, status: p.status, owner: p.owner, venue: p.venue, cust: p.cust }))
  return { ok: true, phone, phoneBy: conv.phone ? (conv.phoneBy || 'man') : (mphone ? 'member' : ''), email: conv.email || '', company: conv.company || '', tags: conv.tags || [], assignee: conv.assignee || '', member, inline, inlineReady: !!(pk.length === 9), projects }
}
