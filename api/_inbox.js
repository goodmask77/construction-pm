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
import { SB_URL, SB_KEY, uploadPrivate, signedUrl, linePush } from './_onboard.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
export const INBOX_VER = '4822' // 跟 index.html 的 p24-inbox.js?v= 同步；前端每次輪詢比對，不一樣就自動重新整理（手機 PWA 常抓舊 JS，張良 10-11 錄影）
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
async function kvGetMany(ids) {
  if (!SB_URL || !SB_KEY || !ids.length) return {}
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,data`, { headers: H() })
    const rows = r.ok ? await r.json() : []
    const out = {}; rows.forEach((row) => { if (row?.data?.v) { try { out[row.id] = JSON.parse(row.data.v) } catch (_) {} } }); return out
  } catch (_) { return {} }
}
const kvGet = async (id) => (await kvGetMany([id]))[id] || null
async function kvSet(id, obj, editor) {
  await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: editor || '收件匣', updated_at: nowIso() }) })
}
async function kvInsert(id, obj, editor) {
  await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: editor || '收件匣', updated_at: nowIso() }) })
}
async function kvLike(prefix, limit, order) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(esc(prefix))}*&select=id,data&order=${order || 'id.desc'}&limit=${limit || 300}`, { headers: H() })
    const rows = r.ok ? await r.json() : []
    const out = []; rows.forEach((row) => { if (row?.data?.v) { try { out.push(JSON.parse(row.data.v)) } catch (_) {} } }); return out
  } catch (_) { return [] }
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
export async function ingestEvent(a, ev, destination) {
  const src = ev.source || {}
  const uid = src.userId && src.type === 'user' ? src.userId : (src.groupId || src.roomId || src.userId || '')
  if (!uid) return null
  const t = +ev.timestamp || Date.now()
  const ck = convKey(a.key, uid)
  let conv = (await kvGet(ck)) || { id: convId(a.key, uid), acct: a.key, uid, kind: src.type || 'user', name: '', pic: '', status: 'new', assignee: '', note: '', unread: 0, createdT: nowIso() }
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
      if (a.key === 'gd' && ev.replyToken && (ev.source || {}).type === 'user') { if (text === '門市與客服' || text === '我要團體訂餐') { conv.replyUsed = true; cardAutoReply(a, uid, ev.replyToken, conv, text).catch(() => {}) } else if (/會員|點數|集點|積分|累點/.test(text) && text.length <= 40) { conv.replyUsed = true; memberAutoReply(a, uid, ev.replyToken, conv).catch(() => {}) } } } // v4.70.96 圖文選單第 6 格／團訂卡片 // v4.70.92 客人問「點數／會員」→ 免費 reply 目前點數＋會員卡連結（張良 2026-10-12「官方目前不會回覆問題」）
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
  } else if (ev.type === 'follow') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: (ev.follow && ev.follow.isUnblocked) ? '解除封鎖，重新加入好友' : '加入好友' }; text = msg.text; conv.follow = true; conv.unread = (conv.unread || 0) + 1; if (conv.status === 'done') conv.status = 'new'; if (a.key === 'gd' && ev.replyToken) { conv.replyUsed = true; welcomeReply(a, ev.replyToken).catch(() => {}) } } // v4.70.83 GD 加好友：用 replyToken 免費回歡迎＋會員卡連結（加好友≠入會，點開會員卡按同意才入會）
  else if (ev.type === 'unfollow') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: '封鎖／刪除好友' }; text = msg.text; conv.follow = false }
  else if (ev.type === 'join') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: '官方帳號被加入這個群' }; text = msg.text }
  else if (ev.type === 'leave') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: '官方帳號離開這個群' }; text = msg.text }
  else if (ev.type === 'postback') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'in', type: 'text', text: '（按了按鈕）' + String((ev.postback || {}).data || '').slice(0, 200), name: conv.name }; text = msg.text; conv.unread = (conv.unread || 0) + 1 }
  else return null
  const mk = msgKey(a.key, uid, t); msg.id = mk
  conv.last = { text: text.slice(0, 80), t: msg.t, dir: msg.dir }
  conv.lastT = msg.t
  await Promise.all([kvInsert(mk, msg), kvSet(ck, conv)])
  bumpStat(a.key, { lastEventT: nowIso(), destination: destination || undefined, lastEventType: ev.type }).catch(() => {})
  if ((msg.dir === 'in' || ev.type === 'follow') && !a.relay) notifyNew(a, conv, text).catch(() => {}) // relay 帳號（DD）不推播：DD 私訊量大且 DD 自己會答，有要插手的人自己到收件匣看
  return { conv, msg }
}

// ── v4.70.61 DD 私訊轉進收件匣：line-webhook 每個事件先 ddInboxBegin(ev)；DD 回話處（lineReply／linePush／卡片）呼叫 ddInboxOut(text, to)；回 200 前 ddInboxFlush() 等寫完 ──
// 存 DD（或系統）主動／自動發出的一則：dir=out、by=DD；relay 帳號 DD 答過＝這個對話算「已完成」且不留未讀（人要插手再從收件匣回，會變處理中）
export async function noteOut(a, uid, text, by, mode) {
  if (!a || !uid) return null
  const ck = convKey(a.key, uid); const conv = await kvGet(ck); if (!conv) return null
  const t = Date.now(); const mk = msgKey(a.key, uid, t)
  const msg = { id: mk, convId: conv.id, t: new Date(t).toISOString(), dir: 'out', by: by || 'DD', mode: mode || 'reply', type: 'text', text: String(text || '').slice(0, 5000), auto: 1 }
  if (msg.mode === 'reply') conv.replyUsed = true
  conv.last = { text: msg.text.slice(0, 80), t: msg.t, dir: 'out', by: msg.by }; conv.lastT = msg.t; conv.lastOutT = msg.t
  if (a.relay) { conv.status = 'done'; conv.unread = 0 }
  await Promise.all([kvInsert(mk, msg), kvSet(ck, conv)])
  return msg
}
const _dd = { ev: null, p: null, pend: [] } // 目前正在處理的 DD 一對一事件（跟 line-webhook 的 _lastSend 一樣是模組層狀態，一個事件處理完就清）
export function ddInboxBegin(ev, destination) {
  _dd.ev = null; _dd.p = null
  if (!ev || (ev.source || {}).type !== 'user' || !['message', 'follow', 'unfollow', 'postback'].includes(ev.type)) return
  const a = acctOf('dd'); if (!a || !configured(a)) return
  _dd.ev = ev
  _dd.p = ingestEvent(a, ev, destination).catch(e => { console.log('[inbox] dd ingest err', e?.message); return null })
  _dd.pend.push(_dd.p)
}
export function ddInboxOut(text, to, mode) {
  const ev = _dd.ev, p0 = _dd.p; if (!ev || !p0) return
  if (to && to !== ev.source.userId) return // 推給別人（老闆私訊、群組）不是這個對話
  const t = String(text || '').trim(); if (!t) return
  const p = p0.then(() => noteOut(acctOf('dd'), ev.source.userId, t, 'DD', mode || 'reply')).catch(e => console.log('[inbox] dd out err', e?.message))
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
  const rank = (c) => (c.unread ? 0 : 1) * 100 + (c.star && c.status !== 'done' ? 0 : 1) * 10 + ({ new: 0, open: 1, wait: 2, done: 3 }[c.status] ?? 1) // v4.71.11 未讀→特別注意→新→處理中→等待中→已完成
  vis.sort((x, y) => rank(x) - rank(y) || String(y.lastT || '').localeCompare(String(x.lastT || '')))
  return vis.map(c => ({ id: c.id, acct: c.acct, kind: c.kind, name: c.name, pic: c.pic, last: c.last, lastT: c.lastT, unread: c.unread || 0, status: c.status || 'new', assignee: c.assignee || '', follow: c.follow !== false, star: !!c.star, waitUntil: c.waitUntil || '', cat: c.cat || '', memoN: (c.memos || []).length + (c.note ? 1 : 0) }))
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
  const fresh = conv.replyToken && conv.replyT && (Date.now() - new Date(conv.replyT).getTime()) < 50e3 && !conv.replyUsed
  let mode = fresh ? 'reply' : 'push', r
  if (fresh) {
    r = await lineApi(a, '/v2/bot/message/reply', { method: 'POST', body: JSON.stringify({ replyToken: conv.replyToken, messages }) })
    if (!r.ok) { mode = 'push'; r = await lineApi(a, '/v2/bot/message/push', { method: 'POST', noQuota: true, body: JSON.stringify({ to: uid, messages }) }) } // reply 過期就退 push
  } else r = await lineApi(a, '/v2/bot/message/push', { method: 'POST', noQuota: true, body: JSON.stringify({ to: uid, messages }) })
  if (!r.ok) return { ok: false, error: `LINE 不收（${r.status}）：${String(r.data?.message || '').slice(0, 80)}` }
  const t = Date.now(); const mk = msgKey(acct, uid, t)
  const msg = { id: mk, convId: conv.id, t: new Date(t).toISOString(), dir: 'out', by: who.name, mode, ...msgPatch }
  conv.replyUsed = true; conv.last = { text: String(lastText || '').slice(0, 80), t: msg.t, dir: 'out', by: who.name }; conv.lastT = msg.t; conv.lastOutT = msg.t; conv.unread = 0
  if (conv.status === 'new') conv.status = 'open'
  if (!conv.assignee) conv.assignee = who.name
  await Promise.all([kvInsert(mk, msg), kvSet(ck, conv)])
  return { ok: true, msg, mode, conv: { status: conv.status, assignee: conv.assignee } }
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
  else return { ok: false, error: '不認識的操作' }
  await kvSet(ck, conv)
  return { ok: true, conv: { status: conv.status, assignee: conv.assignee, note: conv.note, alias: conv.alias, star: !!conv.star, waitUntil: conv.waitUntil || '', memos: conv.memos || [], cat: conv.cat || '', catBy: conv.catBy || '', phone: conv.phone || '', email: conv.email || '', company: conv.company || '', tags: conv.tags || [] } }
}
// ── v4.71.11 問 AI（張良 2026-10-14「要有 AI 對話框，讓我即時詢問一些內容回覆給客戶」）：看這段對話＋備忘錄回答；要擬回覆就放在【回覆草稿】區塊，前端一鍵放進回覆框（不會自動發出）──
export async function inboxAi({ who, mgr, cfg, id, q, hist }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  const question = String(q || '').trim().slice(0, 2000); if (!question) return { ok: false, error: '請輸入問題' }
  const conv = await kvGet(convKey(acct, uid)); if (!conv) return { ok: false, error: '找不到這個對話' }
  const rows = await kvLike(`pm_inbox_m_${acct}_${uid}_`, 60, 'id.desc')
  rows.sort((x, y) => String(x.t).localeCompare(String(y.t)))
  const tw = (t) => new Date(new Date(t).getTime() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
  const lines = rows.map(m => `[${tw(m.t)}] ${m.dir === 'in' ? '客人' : m.dir === 'out' ? '我們（' + (m.by || '') + '）' : '系統'}：${String(m.text || (m.media ? '（圖片／檔案）' : '')).slice(0, 500)}`)
  const memos = [...(conv.note ? [{ by: '', text: conv.note }] : []), ...(conv.memos || [])].map(m => `・${m.by ? m.by + '：' : ''}${m.text}`)
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const SYS = `你是「${a.name}」餐廳 LINE 官方帳號的客服助手，幫店內同事（${who.name}）處理這位客人的對話。今天是 ${today}（台灣）。
規則：
- 一律繁體中文、口語、簡短。
- 不知道的事實（價格、營業時間、能不能包場、發票規定、活動內容）不要編，直接說「這要跟店裡確認」，並列出要確認什麼。
- 同事要你「擬回覆／幫我回」時，把要傳給客人的話放在【回覆草稿】和【/回覆草稿】中間；語氣親切、像店家本人，不要提到 AI。
- 沒被要求擬回覆時就直接回答同事的問題，不要硬塞草稿。

【客人】${conv.alias || conv.name || '客人'}${conv.alias && conv.name ? '（LINE 名稱 ' + conv.name + '）' : ''}；狀態：${({ new: '新', open: '處理中', wait: '等待中', done: '已完成' })[conv.status] || conv.status}${conv.waitUntil ? '（' + conv.waitUntil + ' 要再回覆）' : ''}
【內部備忘錄】${memos.length ? '\n' + memos.join('\n') : '（無）'}
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
export async function inboxRemind({ test } = {}) { // test=true：只私訊張良瑋、不發群、不存提醒時間（測試口 ?inboxremindtest=）
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
export async function inboxClassify() {
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
// ── v4.71.12 客戶資料側欄：會員（LINE 帳號直接對）＋ inline 訂位（電話後 9 碼）＋ EM 包場案件（名字）──
export async function inboxCust({ who, mgr, cfg, id }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  const MB = await import('./_member.js')
  const shard = (pk) => kvGet('sp_finance_pm_inline_ph_' + pk.slice(-2)).then(sh => (sh && sh.rows && sh.rows[pk]) || null).catch(() => null)
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
