// 📥 統一收件匣 v4.70.55（舊版前端自動重新整理；沒人回提醒可設通知誰／LINE 群；帳號顯示名改 A Beach／GROUN:D／104招募；溝通中樞 docs/COMMS_PLAN.md 第三部 項目 5「只收不回」＋項目 6「從 app 回覆」合一；張良 2026-10-11「你先建構所有需要的，最後剩官方帳號金鑰」）
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
export const INBOX_VER = '4756' // 跟 index.html 的 p24-inbox.js?v= 同步；前端每次輪詢比對，不一樣就自動重新整理（手機 PWA 常抓舊 JS，張良 10-11 錄影）
export const ACCOUNTS = [
  { key: 'ab', name: 'A Beach', env: 'LINE_OA_AB', color: '#0ea5e9' },
  { key: 'gd', name: 'GROUN:D', env: 'LINE_OA_GD', color: '#ce1611' },
  { key: 'hr', name: '104招募', env: 'LINE_OA_HR', color: '#16a34a' }, // v4.70.53 名稱照張良 10-11：A Beach／GROUN:D／104招募
]
export const acctOf = (key) => ACCOUNTS.find(a => a.key === key) || null
export const creds = (a) => ({ secret: clean(process.env[a.env + '_SECRET']), token: clean(process.env[a.env + '_TOKEN']) })
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
const convKey = (acct, uid) => `pm_inbox_c_${acct}_${uid}`
const convId = (acct, uid) => `${acct}:${uid}`
const splitId = (id) => { const i = String(id).indexOf(':'); return i > 0 ? [id.slice(0, i), id.slice(i + 1)] : [null, null] }
const msgKey = (acct, uid, t) => `pm_inbox_m_${acct}_${uid}_${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`
const statKey = (acct) => `pm_inbox_acct_${acct}`
export async function loadCfg() { const c = (await kvGet(CFG_KEY)) || {}; return { ...c, perm: c.perm || {}, templates: c.templates || [], remindMin: +c.remindMin || 30, forward: c.forward || {}, reply: c.reply || {}, remind: c.remind || {} } } // remind[acct]={people:[姓名], group:LINE群gid}：沒人回提醒通知誰（v4.70.54 張良：可設個人或直接通知群組） // forward[acct]=原本接著的系統網址（接到收件匣後我們每則原封轉發過去，原系統不斷）
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
export async function quotaOf(a) {
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
    if (m.type === 'text') { msg.text = String(m.text || '').slice(0, 5000); text = msg.text }
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
    if (conv.status === 'done') conv.status = 'new'
    conv.lastInT = msg.t
  } else if (ev.type === 'follow') { msg = { convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: (ev.follow && ev.follow.isUnblocked) ? '解除封鎖，重新加入好友' : '加入好友' }; text = msg.text; conv.follow = true; conv.unread = (conv.unread || 0) + 1; if (conv.status === 'done') conv.status = 'new' }
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
  if (msg.dir === 'in' || ev.type === 'follow') notifyNew(a, conv, text).catch(() => {})
  return { conv, msg }
}

// ── 通知：有權限的人（鈴鐺＋推播）；沒設權限→審核人 ──
async function permRids(acct, forRemind) {
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
  const rank = (c) => (c.unread ? 0 : 1) * 10 + ({ new: 0, open: 1, done: 2 }[c.status] ?? 1)
  vis.sort((x, y) => rank(x) - rank(y) || String(y.lastT || '').localeCompare(String(x.lastT || '')))
  return vis.map(c => ({ id: c.id, acct: c.acct, kind: c.kind, name: c.name, pic: c.pic, last: c.last, lastT: c.lastT, unread: c.unread || 0, status: c.status || 'new', assignee: c.assignee || '', follow: c.follow !== false }))
}
export async function getConv({ who, mgr, cfg, id, markRead }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  const ck = convKey(acct, uid)
  const conv = await kvGet(ck); if (!conv) return { ok: false, error: '找不到這個對話' }
  const rows = await kvLike(`pm_inbox_m_${acct}_${uid}_`, 300, 'id.desc')
  rows.sort((x, y) => String(x.t).localeCompare(String(y.t)))
  const list = await Promise.all(rows.map(async m => { const o = { ...m }; if (m.media) { try { o.url = await signedUrl(m.media, 1800) } catch (_) {} } return o }))
  if (markRead && conv.unread) { conv.unread = 0; conv.readBy = who.name; conv.readT = nowIso(); await kvSet(ck, conv) }
  const fresh = conv.replyToken && conv.replyT && (Date.now() - new Date(conv.replyT).getTime()) < 50e3 && !conv.replyUsed
  const quota = await quotaOf(a)
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
    if (!r.ok) { mode = 'push'; r = await lineApi(a, '/v2/bot/message/push', { method: 'POST', body: JSON.stringify({ to: uid, messages }) }) } // reply 過期就退 push
  } else r = await lineApi(a, '/v2/bot/message/push', { method: 'POST', body: JSON.stringify({ to: uid, messages }) })
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

// ── 狀態／指派／備註 ──
export async function convOp({ who, mgr, cfg, op, id, value }) {
  const [acct, uid] = splitId(id); const a = acctOf(acct)
  if (!a || !uid) return { ok: false, error: '找不到這個對話' }
  if (!canSeeAcct(cfg, who, mgr, acct)) return { ok: false, error: '你沒有這個帳號的收件匣權限' }
  const ck = convKey(acct, uid); const conv = await kvGet(ck); if (!conv) return { ok: false, error: '找不到這個對話' }
  const t = Date.now()
  if (op === 'status') { if (!['new', 'open', 'done'].includes(value)) return { ok: false, error: '狀態不對' }; conv.status = value; if (value === 'done') conv.unread = 0; await kvInsert(msgKey(acct, uid, t), { id: 'x', convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: `${who.name} 標為「${{ new: '新', open: '處理中', done: '已完成' }[value]}」` }) }
  else if (op === 'assign') { conv.assignee = String(value || '').slice(0, 30); await kvInsert(msgKey(acct, uid, t), { id: 'x', convId: conv.id, t: new Date(t).toISOString(), dir: 'sys', type: 'sys', text: conv.assignee ? `${who.name} 指派給 ${conv.assignee}` : `${who.name} 取消指派` }); if (conv.assignee && conv.assignee !== who.name) notifyAssign(a, conv, who).catch(() => {}) }
  else if (op === 'note') conv.note = String(value || '').slice(0, 2000)
  else if (op === 'rename') conv.alias = String(value || '').slice(0, 40)
  else return { ok: false, error: '不認識的操作' }
  await kvSet(ck, conv)
  return { ok: true, conv: { status: conv.status, assignee: conv.assignee, note: conv.note, alias: conv.alias } }
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
  const cfg = await loadCfg()
  const sig = (await kvGet('pm_inbox_acct__sigfail')) || { n: 0 }
  let groups = []; try { const { ddGroupList } = await import('./_ddmsg.js'); groups = (await ddGroupList({})).filter(g => !g.gone && !(g.cfg && g.cfg.hide)).map(g => ({ gid: g.gid, name: (g.cfg && g.cfg.alias) || g.name || g.gid.slice(-6) })) } catch (_) {} // 提醒可直接發 DD 在的 LINE 群
  const accounts = await Promise.all(ACCOUNTS.map(async a => {
    const ok = configured(a); const st = (await kvGet(statKey(a.key))) || {}
    let info = null, hook = null, quota = null
    if (ok) { const [i, w, q] = await Promise.all([botInfo(a), webhookInfo(a), quotaOf(a)]); info = i.ok ? i.data : { error: i.data?.message || i.status }; hook = w.ok ? w.data : { error: w.data?.message || w.status }; quota = q }
    const want = origin + '/api/inbox-webhook'
    return { key: a.key, name: a.name, color: a.color, configured: ok, forward: maskUrl(cfg.forward[a.key] || ''), forwardSet: !!cfg.forward[a.key], lastFwd: st.lastFwd || null, envSecret: a.env + '_SECRET', envToken: a.env + '_TOKEN', info, hook, hookOk: !!(hook && hook.endpoint === want && hook.active), wantHook: want, quota, lastEventT: st.lastEventT || '', lastEventType: st.lastEventType || '' }
  }))
  return { ok: true, accounts, cfg: { perm: cfg.perm, reply: cfg.reply, remind: cfg.remind, templates: cfg.templates, remindMin: cfg.remindMin }, sigfail: sig, groups }
}
export async function saveCfg(patch, who) {
  const cfg = await loadCfg()
  if (patch.perm && typeof patch.perm === 'object') { cfg.perm = {}; for (const a of ACCOUNTS) cfg.perm[a.key] = Array.isArray(patch.perm[a.key]) ? patch.perm[a.key].map(String).slice(0, 50) : [] }
  if (patch.reply && typeof patch.reply === 'object') { cfg.reply = {}; for (const a of ACCOUNTS) cfg.reply[a.key] = Array.isArray(patch.reply[a.key]) ? patch.reply[a.key].map(String).slice(0, 50) : [] }
  if (Array.isArray(patch.templates)) cfg.templates = patch.templates.filter(x => x && (x.text || '').trim()).map((x, i) => ({ id: x.id || ('t' + Date.now().toString(36) + i), title: String(x.title || '').slice(0, 30), text: String(x.text || '').slice(0, 1000) })).slice(0, 60)
  if (patch.remindMin != null) cfg.remindMin = Math.max(5, Math.min(1440, +patch.remindMin || 30))
  if (patch.remind && typeof patch.remind === 'object') { cfg.remind = cfg.remind || {}; for (const [k, v] of Object.entries(patch.remind)) { if (!acctOf(k) || !v || typeof v !== 'object') continue; cfg.remind[k] = { people: Array.isArray(v.people) ? v.people.map(String).slice(0, 50) : [], group: /^[CR][0-9a-f]{32}$/.test(String(v.group || '')) ? String(v.group) : '' } } }
  if (patch.forward && typeof patch.forward === 'object') { for (const [k, v] of Object.entries(patch.forward)) { if (!acctOf(k)) continue; const u = String(v || '').trim(); if (!u) delete cfg.forward[k]; else if (/^https:\/\//.test(u)) cfg.forward[k] = u.slice(0, 500) } }
  cfg.updatedBy = who.name; cfg.updatedT = nowIso()
  await kvSet(CFG_KEY, cfg, who.name)
  return { ok: true, cfg: { perm: cfg.perm, reply: cfg.reply, remind: cfg.remind, templates: cfg.templates, remindMin: cfg.remindMin } }
}
// 把這個帳號的 webhook 指到我們這裡（先看現在指哪裡；指著別的系統就不硬改，回報給人決定）
export async function connectAcct({ key, origin, force }) {
  const a = acctOf(key); if (!a) return { ok: false, error: '沒有這個帳號' }
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

// ── 未回覆提醒（每小時 cron 呼叫）：超過 remindMin 分鐘沒人回且還沒完成 → 再推一次＋LINE 私訊審核人 ──
export async function inboxRemind() {
  const cfg = await loadCfg()
  const all = await kvLike('pm_inbox_c_', 600, 'updated_at.desc')
  const out = []
  for (const c of all) {
    if (!c || !c.lastInT || c.status === 'done') continue
    if (c.lastOutT && c.lastOutT > c.lastInT) continue // 已回
    const age = Date.now() - new Date(c.lastInT).getTime()
    if (age < cfg.remindMin * 60e3) continue
    if (c.remindT && Date.now() - new Date(c.remindT).getTime() < 55 * 60e3) continue
    const a = acctOf(c.acct); if (!a) continue
    const { rids, names, group } = await permRids(c.acct, true)
    const mins = Math.round(age / 60e3)
    const body = `${a.name}「${c.name}」${mins >= 60 ? Math.floor(mins / 60) + ' 小時' : mins + ' 分鐘'}沒人回：${(c.last && c.last.text) || ''}`
    const link = `https://ground-pm.vercel.app/prep#inbox=${encodeURIComponent(c.id)}`
    try { if (rids.length) { const { wpPush } = await import('./_webpush.js'); await wpPush(rids, { title: '收件匣：還沒回覆', body: body.slice(0, 160), url: '/prep#inbox=' + encodeURIComponent(c.id), cat: 'inbox' }) } } catch (_) {}
    try { const ros = await kvGet('sp_crew_kb_roster'); for (const an of names) { const p = ((ros || {}).people || []).find(x => x.name === an && x.lineUserId); if (p) await linePush(p.lineUserId, `📥 ${body}\n→ ${link}`) } } catch (_) {}
    if (group) { try { await linePush(group, `📥 ${body}\n→ ${link}`) } catch (_) {} } // 群組推播按群內人數計費（LINE 規則），張良自己選的
    c.remindT = nowIso(); c.remindN = (c.remindN || 0) + 1
    await kvSet(convKey(c.acct, c.uid), c, '收件匣提醒')
    out.push(c.id)
  }
  return { ok: true, reminded: out }
}
export const unreadTotal = async ({ who, mgr, cfg }) => (await listConvs({ who, mgr, cfg })).reduce((t, c) => t + (c.unread || 0), 0)
