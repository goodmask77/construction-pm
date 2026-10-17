import './_qpatch.js' // DD 推播統一補額度尾巴（與 GD 其他推播同一出口）
// abgd 搬家：新殼代發口（2026-10-14）
// 資料域切到新殼後，新殼不自己拿 LINE 金鑰，所有對外通知（LINE 群／私訊、Web Push、積分、建任務）都打這裡，由 GD 原本的單一出口送出：
// 文字照抄 GD 原程式、logPush／額度尾巴／推播紀錄完全不變。HMAC(BRIDGE_SECRET) 簽 body；idem 冪等（同一個 idem 只做一次，重送回上次結果）。
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { kvGet, kvSet, SB_URL, svc } from './_onboard.js'
import { logPush, groupMembers, quotaFoot } from './push.js'
import { wpPush, wpPushUids, prepLink } from './_webpush.js'
import { awardPtsStrict } from './_points.js'
import { ddGet, ddFill, ddGroupGid, ddAll } from './_ddmsg.js'
import { aiCall } from './_ai.js'
import { crewTx } from './_crewkv.js'

const TK = () => (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
// 冪等：每個事件（含逐收件人的子事件）一個鍵 pm_abgd_fxk_<sha1>，用「insert 不覆寫」原子佔位（pm_abgd_ 前綴不屬於任何資料域）
const fxKey = (idem) => 'pm_abgd_fxk_' + crypto.createHash('sha1').update(String(idem)).digest('hex')
async function claim(idem) { // 回 {tok}（我佔到）／{done:r}（做過）／'busy'（別人正在做）；儲存失敗丟錯（由呼叫端回可重試）
  const id = fxKey(idem), tok = crypto.randomUUID(), now = new Date().toISOString()
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify({ s: 'sending', t: Date.now(), tok }) }, editor: 'abgd-fx:' + tok, updated_at: now }) })
  if (r.ok) return { tok }
  if (r.status !== 409) throw new Error('佔位失敗 HTTP ' + r.status) // 只有「已存在」才當衝突
  const g = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data,updated_at`, { headers: svc })
  if (!g.ok) throw new Error('讀佔位失敗 HTTP ' + g.status)
  const row = (await g.json())[0]; if (!row) throw new Error('佔位消失')
  let cur = {}; try { cur = JSON.parse(row.data.v) } catch (_) {}
  if (cur.s === 'done') return { done: cur.r }
  if (Date.now() - (cur.t || 0) < 5 * 60e3) return 'busy'
  // 過期重領：條件更新（updated_at 沒變才改），只有一個請求搶得到
  const u = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&updated_at=eq.${encodeURIComponent(row.updated_at)}`, { method: 'PATCH', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ data: { v: JSON.stringify({ s: 'sending', t: Date.now(), tok }) }, editor: 'abgd-fx:' + tok, updated_at: new Date().toISOString() }) })
  if (!u.ok) throw new Error('重領失敗 HTTP ' + u.status)
  return (await u.json()).length ? { tok } : 'busy'
}
// 完成／釋放都只在「佔位還是我的（editor=abgd-fx:<tok>）」時才動，舊請求不能覆寫或刪掉新持有者
async function finish(idem, tok, r) {
  const u = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${fxKey(idem)}&editor=eq.${encodeURIComponent('abgd-fx:' + tok)}`, { method: 'PATCH', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ data: { v: JSON.stringify({ s: 'done', t: Date.now(), r }) }, editor: 'abgd-fx:done', updated_at: new Date().toISOString() }) })
  if (!u.ok) throw new Error('完成紀錄寫入失敗 HTTP ' + u.status)
  if (!(await u.json()).length) throw new Error('佔位已不是我的')
}
async function release(idem, tok) { await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${fxKey(idem)}&editor=eq.${encodeURIComponent('abgd-fx:' + tok)}`, { method: 'DELETE', headers: svc }).catch(() => {}) }
// 只看子事件結果、不佔位（DD 回話：reply 期限過了也要先看之前試過沒；關卡 OpenAI A5）：回 {done}／'busy'／null（沒試過）；讀失敗丟錯
async function peekOnce(sub, kind = 'reply') { // kind：reply／push——各自只接受自己那種完成收據（第六輪 OpenAI A1-1）
  const g = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${fxKey(sub)}&select=data`, { headers: svc, signal: AbortSignal.timeout(5000) }) // 逾時丟錯＝整個動作回可重試（不會當成沒試過）
  if (!g.ok) throw new Error('讀子事件失敗 HTTP ' + g.status)
  const row = (await g.json())[0]; if (!row) return null
  const UNK = (why) => ({ done: { ok: true, unknown: true, [why]: true } })
  let cur = null; try { cur = JSON.parse(row.data.v) } catch (_) { return UNK('bad') }
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return UNK('bad') // 第三輪 OpenAI A2：結構不對＝結果不明（不重試、不轉 push）
  if (cur.s === 'done') { const x = cur.r; const okR = x && typeof x === 'object' && !Array.isArray(x) && (kind === 'push' ? (x.ok === true && x.via === 'push') : (x.via === 'reply' || x.invalid === true || x.badmsg === true || x.unknown === true)); return okR ? { done: x } : UNK('bad') }
  if (cur.s !== 'sending' || !Number.isFinite(cur.t)) return UNK('bad')
  if (Date.now() - cur.t > 5 * 60e3) return UNK('stale') // 處理中超過 5 分鐘＝當時可能已送出、結果沒存＝結果不明（第二輪 OpenAI A3）
  return 'busy'
}
// 子事件：同一個動作裡逐收件人只發一次（重試時已發的人不再發）
async function once(sub, fn, base) { const c = await claim(sub); if (c === 'busy') return { ok: false, retry: true, busy: true }; if (c.done !== undefined) return c.done; try { const r = await fn(); if (r && r.ok === false && r.retry) { await release(sub, c.tok); return r } try { await finish(sub, c.tok, r) } catch (_) {} return r } catch (e) { await release(sub, c.tok); throw e } }
const ctx = new AsyncLocalStorage() // 每個請求自己的事件 idem（同時處理多個請求不會互蓋），用來派生 LINE 重試鍵
const retryKey = (to) => { const h = crypto.createHash('sha1').update((ctx.getStore() || '') + '|' + to).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
// 由任意字串推出固定 UUID（LINE 重試鍵要 UUID 格式）：同一件事不論哪邊、按幾次都同一把鍵，LINE 24 小時內擋重複
export const fixedKey = (s) => { const h = crypto.createHash('sha1').update(String(s)).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
async function linePush(to, messages, key) { // key：指定固定重試鍵（跨系統同一件事共用）；沒給就用事件＋收件人推導
  const tk = TK(); if (!tk || !to) return false
  const h = { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }
  if (key) h['X-Line-Retry-Key'] = fixedKey(key); else if (ctx.getStore()) h['X-Line-Retry-Key'] = retryKey(to)
  const r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: h, body: JSON.stringify({ to, messages }), signal: AbortSignal.timeout(15000) })
  return r.ok || r.status === 409 // 409＝同一重試鍵 LINE 已收過（先前其實送出了）
}
// 版本比對寫入（GD 0012 pm_doc_get／pm_doc_cas：同一交易鎖版本列、比對、寫入，搬家閘門照樣擋）；衝突重讀重做 5 次
async function kvCas(id, fn) {
  const rpc = (f, b) => fetch(`${SB_URL}/rest/v1/rpc/${f}`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json' }, body: JSON.stringify(b) })
  for (let i = 0; i < 5; i++) {
    const r = await rpc('pm_doc_get', { p_id: id }); if (!r.ok) throw new Error('讀 ' + id + ' 失敗')
    const g = await r.json()
    if (!g || !g.data) return kvSet(id, fn({})) // 還不存在：直接建（極少發生）
    const next = fn(JSON.parse(g.data.v || '{}'))
    const u = await rpc('pm_doc_cas', { p_id: id, p_rev: g.rev, p_data: { v: JSON.stringify(next) }, p_editor: 'abgd-fx' })
    if (!u.ok) return false
    const j = await u.json(); if (j && j.ok) return true; if (!j || !j.conflict) return false
    await new Promise(res => setTimeout(res, 120 + Math.random() * 300))
  }
  return false
}
async function bindMaps() {
  const bd = (await kvGet('sp_finance_pm_prep_bind')) || {}
  const ids = {}, uid = {}, tok = {}
  for (const [k, v] of Object.entries(bd.tokens || {})) {
    if (!v || !v.name) continue
    ;(ids[v.name] = ids[v.name] || []); if (v.rid) ids[v.name].push(v.rid); if (v.uid) ids[v.name].push(v.uid)
    if (v.uid && !uid[v.name]) { uid[v.name] = v.uid; tok[v.name] = k }
  }
  return { bd, ids, uid, tok }
}
const gdNames = (rosterDoc) => {
  const alive = (((rosterDoc || {}).people) || []).filter(p2 => !p2.endDate && (p2.status || '在職') !== '離職')
  const gd = alive.filter(p2 => p2.gd).map(p2 => p2.name).filter(Boolean)
  return gd.length ? gd : alive.map(p2 => p2.name).filter(Boolean)
}

// 新殼借用 GD 的 AI 出口（唯讀動作，2026-10-14 第 2 波耗損 F09 起）：金鑰、路由（AI 中樞設定）、用量紀錄都留在 GD；
// 只允許登記過的路由，避免新殼任意呼叫；回 { text, provider, model }
const AI_ROUTES_OK = new Set(['waste', 'rcpimport', 'menuocr', 'app']) // app：聊天室 @DD（F22，同 GD _chat.js 走 aiCall('app')） // menuocr：菜單拍照建檔（F18）
// 行銷大師（v4.71.146）：新殼已驗身分；身分格式同 _social.js whoSocial（權限表 social 分頁）；呼叫原本的社群端點（req._who＝已驗身分）
// inline 顧客資料庫（v4.71.175 新殼經代發口）：即時直搜 inline（find，唯讀）、行動建議勾選／派任務（act）、連假 AI 文案（holcopy）
//   權限同 inline-sync whoTok：停權擋；核准模式下 act／holcopy 要有編輯權且 inline 分頁沒被關；讀（find）只要登入
async function inlineRun(a, method) {
  const kind = String(a.kind || '')
  const name = String((a.who || {}).name || '').slice(0, 30), rid = String((a.who || {}).rid || ''), role = String((a.who || {}).role || '一般')
  if (!name) return { ok: false, error: '缺操作者' }
  if (role === '停權') return { ok: false, error: '帳號已停權', _http: 403 }
  if (method === 'GET' ? kind !== 'find' : !['act', 'holcopy'].includes(kind)) return { ok: false, error: '不認識的操作', _http: 400 }
  if (method === 'POST') {
    const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }
    if (pm.mode === 'approve') { const u = (pm.users || {})[rid]; if (!(u && u.edit && (u.admin || !u.tabs || u.tabs.cust !== 0))) return { ok: false, error: '沒有 inline 編輯權限', _http: 403 } }
  }
  const key = (process.env.OPS_BOARD_KEY || '').trim()
  const query = kind === 'find' ? { custfind: key, q: String(a.q || '').slice(0, 40) } : kind === 'act' ? { custact: key } : { custholcopy: key }
  let st = 200, out = null
  const res = { status (c) { st = c; return this }, json (o) { out = o; return this }, send (o) { out = { ok: false, html: String(o).slice(0, 200) }; return this }, setHeader () { return this }, writeHead () { return this }, end () { return this } }
  const H = (await import('./inline-sync.js')).default
  await H({ method, query, body: a.body || {}, headers: {}, _who: { name, rid } }, res)
  return { ...(out || { ok: false, error: 'GD 沒有回結果' }), _http: st }
}
// 銷售數據頁（新殼 /ops/sales，v4.71.188）轉 GD 原本的端點：新殼傳人員編號，這裡找他的 GD 綁定 token 再呼叫原端點——
//   權限檢查、版本比對寫（銷售數據 posRun）、操作紀錄都照 GD 原本的；只放行白名單（讀：預測、停售清單、行事曆；寫：備料、熱力圖隱藏、節奏表隱藏、品項隱藏、停售、特殊日、人工調）
const BOARD_READ = new Set(['fc', 'fcso', 'twhol'])
const BOARD_WRITE = new Set(['prepact', 'heathide', 'prephide', 'poshide', 'fcso', 'fcsp', 'fcadj'])
const BOARD_QS = ['ym', 'store', 'date', 'days', 'n']
async function boardRun(a, method) {
  const q = String(a.q || '')
  const name = String((a.who || {}).name || '').slice(0, 30), rid = String((a.who || {}).rid || ''), role = String((a.who || {}).role || '一般')
  if (!name) return { ok: false, error: '缺操作者' }
  if (role === '停權') return { ok: false, error: '帳號已停權', _http: 403 }
  if (!(method === 'GET' ? BOARD_READ : BOARD_WRITE).has(q)) return { ok: false, error: '不認識的操作', _http: 400 }
  const bd = (await kvGet('sp_finance_pm_prep_bind')) || {}
  // 只比人員編號（不跟 LINE 編號混比）；同一人有多筆（換手機重綁）＝優先目前生效的那筆（byUid 指向它），其次最新的；全部都是同一個人（sopWho 依 token 認出的 rid 一樣）
  const mine = rid ? Object.entries(bd.tokens || {}).filter(([, v]) => v && v.rid === rid) : []
  const hit = mine.find(([t, v]) => (bd.byUid || {})[v.uid] === t) || mine.sort((x, y) => String((y[1] || {}).ts || '').localeCompare(String((x[1] || {}).ts || '')))[0]
  const tk = hit ? hit[0] : ''
  if (!tk && q !== 'twhol') return { ok: false, error: '你的帳號還沒綁定 GD（私訊 DD「綁定GD 本名」）', _http: 403 }
  const key = (process.env.OPS_BOARD_KEY || '').trim()
  const query = { [q]: key }
  for (const k of BOARD_QS) if (a.query && a.query[k] != null) query[k] = String(a.query[k]).slice(0, 40)
  if (method === 'GET' && tk) query.me = tk
  const body = method === 'POST' ? { ...(a.body || {}), token: tk } : {}
  let st = 200, out = null
  const res = { status (c) { st = c; return this }, json (o) { out = o; return this }, send (o) { out = { ok: false, html: String(o).slice(0, 200) }; return this }, setHeader () { return this }, writeHead () { return this }, end () { return this }, redirect () { return this } }
  const H = (await import('./mail-sync.js')).default
  await H({ method, query, body, headers: {} }, res)
  return { ...(out || { ok: false, error: 'GD 沒有回結果' }), _http: st }
}
// 新殼「GD 頁面轉接」（v4.71.189）：新殼頁面＝GD 頁面前端副本，讀寫一律呼叫 GD 原端點（權限、遮罩、版本比對寫照舊）。
//   PAGES 登記每頁准許的讀／寫端點與網址參數；新殼傳人員編號 → 找他的 GD 綁定 token（只比人員編號，多筆用目前生效那筆）→ GET 帶 me、POST 帶 body.token
//   GD 端點回轉址（例：入職文件看檔＝5 分鐘簽名網址）＝回 { redirect }，由新殼轉過去
const PAGES = {
  ntf: { get: ['ntf', 'ntfread'], post: ['ntfseen', 'ntfpin'], qs: [] }, // 通知中心（歷史、已讀、釘選）
  gear: { get: ['menu', 'tabcfg', 'ddmsg', 'ddlog', 'aicfg', 'aimodels', 'aiab', 'ddhealth', 'gdrole'], post: ['gdrole', 'prepapply', 'preppermset', 'tabset', 'ddmsgset', 'ddgrpset', 'aitest', 'aicfgset'], qs: ['refresh', 'provider', 'kind', 'route', 'days'] }, // 設定（權限面板、分頁名稱、DD 自動訊息與群組、AI 模型、DD 健康）
  onb: { get: ['onboardself', 'onboardmgr'], post: ['onboardself', 'onboardfile', 'onboardins'], qs: [] }, // 入職（新人自填四步、證件自傳、主管入職管理、確認加保）
  hrm: { get: ['hrmaster', 'onboardone', 'hrdocurl'], post: ['hrmasterup', 'hridlock', 'hrmpendset', 'hrdocup', 'hrdocdel', 'onboardins'], qs: ['co', 'nm', 'key', 'i', 'dl', 'rid'] }, // 夥伴名冊（含身分證欄遮罩、入職文件、待審核、加保）
}
function tokenOfRid(bd, rid) {
  const mine = rid ? Object.entries(bd.tokens || {}).filter(([, v]) => v && v.rid === rid) : []
  const hit = mine.find(([t, v]) => (bd.byUid || {})[v.uid] === t) || mine.sort((x, y) => String((y[1] || {}).ts || '').localeCompare(String((x[1] || {}).ts || '')))[0]
  return hit ? hit[0] : ''
}
async function pageRun(a, method) {
  const page = String(a.p || ''), q = String(a.q || '')
  const spec = PAGES[page]
  const name = String((a.who || {}).name || '').slice(0, 30), rid = String((a.who || {}).rid || ''), role = String((a.who || {}).role || '一般')
  if (!name) return { ok: false, error: '缺操作者' }
  if (role === '停權') return { ok: false, error: '帳號已停權', _http: 403 }
  if (!spec || !(method === 'GET' ? spec.get : spec.post).includes(q)) return { ok: false, error: '不認識的操作', _http: 400 }
  const tk = tokenOfRid((await kvGet('sp_finance_pm_prep_bind')) || {}, rid)
  if (!tk) return { ok: false, error: '你的帳號還沒綁定 GD（私訊 DD「綁定GD 本名」）', _http: 403 }
  const query = { [q]: (process.env.OPS_BOARD_KEY || '').trim() }
  for (const k of spec.qs || []) if (a.query && a.query[k] != null) query[k] = String(a.query[k]).slice(0, 80)
  if (method === 'GET') query.me = tk
  const body = method === 'POST' ? { ...(a.body || {}), token: tk } : {}
  let st = 200, out = null, loc = null
  const res = { status (c) { st = c; return this }, json (o) { out = o; return this }, send (o) { out = { ok: false, html: String(o).slice(0, 200) }; return this }, setHeader () { return this }, writeHead () { return this }, end () { return this }, redirect (c, u) { loc = typeof c === 'string' ? c : u; st = 302; return this } }
  const H = (await import('./mail-sync.js')).default
  await H({ method, query, body, headers: {} }, res)
  if (loc) return { ok: true, redirect: loc, _http: 200 }
  return { ...(out || { ok: false, error: 'GD 沒有回結果' }), _http: st }
}
async function socialRun(a, method) {
  const kind = String(a.kind || 'social')
  const name = String((a.who || {}).name || '').slice(0, 30), rid = String((a.who || {}).rid || ''), role = String((a.who || {}).role || '一般')
  if (!name) return { ok: false, error: '缺操作者' }
  if (role === '停權') return { ok: false, error: '帳號已停權', _http: 403 }
  const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }
  const u = (pm.users || {})[rid] || {}
  const who = { rid, name, role, admin: !!u.admin, _mode: pm.mode, _u: u }
  const key = (process.env.OPS_BOARD_KEY || '').trim()
  let st = 200, out = null
  const res = { status (c) { st = c; return this }, json (o) { out = o; return this }, send (o) { out = { ok: false, html: String(o).slice(0, 200) }; return this }, setHeader () { return this }, writeHead () { return this }, end () { return this } }
  if (kind === 'social') {
    if (method === 'POST' && !(a.body && a.body.op)) return { ok: false, error: '缺操作', _http: 400 }
    const H = (await import('./social.js')).default
    await H({ method, query: { ...(a.q || {}), social: key }, body: method === 'POST' ? (a.body || {}) : undefined, headers: {}, _who: who, _fromShell: true }, res)
  } else if (kind === 'lineoa' && method === 'GET') {
    const H = (await import('./lineoa-sync.js')).default
    await H({ method: 'GET', query: { ...(a.q || {}), lineoa: key }, headers: {} }, res)
  } else return { ok: false, error: '不認識的操作', _http: 400 }
  return { ...(out || { ok: false, error: '社群沒有回應' }), _http: st } // HTTP 狀態放 _http（社群回應本身有 status 欄位＝貼文狀態，不能蓋掉）
}
// 積分（v4.71.136）：新殼已驗身分；編輯權限照 GD permWho 規則（權限表「排行榜」分頁 lb）；分派同 GD 舊頁（_pointsop.js）
async function pointsRun(a, method) {
  const who = { name: String((a.who || {}).name || '').slice(0, 30), role: String((a.who || {}).role || ''), rid: String((a.who || {}).rid || '') }
  if (!who.name) return { ok: false, error: '缺操作者' }
  const kind = String(a.kind || '')
  if (!(method === 'GET' ? ['lb', 'cfg', 'redeemlog', 'ledger'] : ['cfg', 'rewardset', 'redeem']).includes(kind)) return { ok: false, error: '不認識的操作', status: 400 } // 唯讀口只准讀（關卡 3 積分第一輪 OpenAI A1）
  if (method === 'POST' && kind === 'redeem' && (a.body || {}).op === 'setcheckers') return { ok: false, error: '設定核銷人在新殼 SOP 設定改' }
  const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }
  const u = (pm.users || {})[who.rid]
  const canEdit = pm.mode !== 'approve' ? true : !!(u && u.edit && (u.admin || !u.tabs || u.tabs.lb !== 0))
  if (method === 'POST' && !canEdit) return { ok: false, error: '你還沒有排行榜的編輯權限——請找張良申請開通', status: 403 }
  const { pointsDispatch } = await import('./_pointsop.js')
  try { return await pointsDispatch({ kind, method, q: a.q || {}, body: a.body || {}, who, canEdit }) }
  catch (e) { return { ok: false, error: '積分暫時出錯：' + String(e && e.message || e).slice(0, 120) } }
}
// 團體訂餐（v4.71.132）：新殼已驗身分；編輯權限照 GD permWho 規則（權限表 approve 模式＝已核准＋「團體訂餐」分頁沒關）；分派同 GD 舊頁（_grporderop.js）
async function gorderRun(a, method) {
  const who = { name: String((a.who || {}).name || '').slice(0, 30), role: String((a.who || {}).role || ''), rid: String((a.who || {}).rid || '') }
  if (!who.name) return { ok: false, error: '缺操作者' }
  const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }
  const u = (pm.users || {})[who.rid]
  const canEdit = pm.mode !== 'approve' ? true : !!(u && u.edit && (u.admin || !u.tabs || u.tabs.gorder !== 0))
  const { grporderDispatch } = await import('./_grporderop.js')
  try { return await grporderDispatch({ method, op: String(a.op || (method === 'GET' ? 'list' : '')), q: a.q || {}, body: a.body || {}, who, canEdit }) }
  catch (e) { return { ok: false, error: '團體訂餐暫時出錯：' + String(e && e.message || e).slice(0, 120) } }
}
const ACTIONS = {
  async ai_call(a) {
    const route = String(a.route || '')
    if (!AI_ROUTES_OK.has(route)) throw new Error('這個 AI 路由沒開放給新殼：' + route)
    // 內容限制（abgd 耗損關卡 3 第一輪）：只收 user 訊息、文字或圖片（JPEG／PNG／WebP）、圖片最多 14 張、整包 ≤4.3MB、maxTokens 1～4000；不接受指定模型（override）
    const msgs = Array.isArray(a.messages) ? a.messages : []
    if (msgs.length > 4 || Buffer.byteLength(JSON.stringify(a)) > 4_300_000 || Buffer.byteLength(String(a.system || '')) > 24000) throw new Error('送 AI 的內容太大') // 量實際位元組（中文一字 3 位元組），含 system 與所有參數
    let nImg = 0
    for (const m of msgs) {
      if (!m || m.role !== 'user') throw new Error('訊息格式不對')
      const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (Array.isArray(m.content) ? m.content : null)
      if (!parts) throw new Error('訊息格式不對')
      for (const c of parts) {
        if (c && c.type === 'text' && typeof c.text === 'string') continue
        if (c && c.type === 'image' && /^image\/(jpeg|png|webp)$/.test(String(c.media_type || '')) && typeof c.data === 'string') { nImg++; continue }
        throw new Error('訊息內容只能是文字或圖片')
      }
    }
    if (nImg > 14) throw new Error('圖片太多')
    const mt = Math.trunc(Number(a.maxTokens)); const maxTokens = Number.isFinite(mt) && mt >= 1 ? Math.min(route === 'menuocr' ? 8000 : 4000, mt) : 600 // 菜單抄寫（F18）整份菜單 JSON 較長：同 GD ?menuocr 8000
    const r = await aiCall(route, { system: String(a.system || ''), messages: msgs, maxTokens, ...(route === 'menuocr' ? { timeoutMs: 150000 } : {}) })
    return { text: r.text || '', provider: r.provider || '', model: r.model || '' }
  },
  // 菜單 AI 生圖（abgd F18 菜單；2026-10-15）：跟 GD ?menuai 同一份程式（_menuai.js）；只產圖存 photos/menu/raw/、回網址，不寫任何資料文件
  // 參數只收 kind／sub／imgs（≤3 張 data URL）／hint／slogan／n／brief_en／brief_zh；整包 ≤4.3MB
  async menu_ai_gen(a) {
    if (Buffer.byteLength(JSON.stringify(a || {})) > 4_300_000) throw new Error('送 AI 的內容太大')
    const { menuAiGen } = await import('./_menuai.js')
    const pick = { kind: a.kind, sub: a.sub, imgs: Array.isArray(a.imgs) ? a.imgs.slice(0, 3) : [], hint: a.hint, slogan: a.slogan, n: a.n, brief_en: a.brief_en, brief_zh: a.brief_zh }
    return await menuAiGen(pick)
  },
  // 讀：會議頁需要的名單（與 GD ?meet 同算法）
  async meet_meta() {
    const [rosM, shM, defM, bindM] = await Promise.all([kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_shift_g'), kvGet('sp_finance_pm_sop_def'), kvGet('sp_finance_pm_prep_bind')])
    const offM = new Set((shM || {}).offStaff || [])
    const regNames = gdNames(rosM).filter(n => !offM.has(n))
    const approvers = (((defM || {}).ground || {}).approvers) || ['張良瑋']
    const boundNames = [...new Set(Object.values((bindM || {}).tokens || {}).map(v => v && v.name).filter(Boolean))]
    const allNames = [...new Set((((rosM || {}).people) || []).filter(p => !p.endDate && (p.status || '在職') !== '離職').map(p => p.name).filter(Boolean))]
    let sendGroups = []; try { sendGroups = (await ddAll()).groups } catch (_) {}
    return { regNames, allNames, boundNames, sendGroups, approvers }
  },
  // 讀：回饋頁需要的名單（與 GD ?fb 同算法：當天打卡者、名冊、審核人、站長、站別）
  async fb_meta(a) {
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '')) ? String(a.date) : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const [rosterF, defFb] = await Promise.all([kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_sop_def')])
    const pjF = await import('./punch.js')
    let pch = []; try { pch = await pjF.listPunches('sp_crew_pch_' + dt.replace(/-/g, '')) } catch (_) {}
    const g = (defFb || {}).ground || {}
    return { date: dt, workers: [...new Set(pch.map(p2 => p2.name))].filter(Boolean), names: gdNames(rosterF), approvers: g.approvers || ['張良瑋'], stOwner: g.stOwner || {}, stations: g.stations || [] }
  },
  async meet_group(a) { // 新會議發大群（DD 自動訊息 meet_new）
    const cfgG = await ddGet('meet_new')
    if (!TK() || !cfgG.on) return { ok: true, skipped: true }
    const lnkG = prepLink('meet=' + a.id)
    const GRP = await ddGroupGid(a.group || cfgG.group)
    const mem = await groupMembers(GRP)
    const body = ddFill(cfgG.text, { type: a.type, date: a.date, content: String(a.text || '').slice(0, 300), n: a.n, link: lnkG }) + await quotaFoot(mem)
    const imgs = (a.media || []).filter(u => /^https:\/\//.test(u)).slice(0, 4).map(u => ({ type: 'image', originalContentUrl: u, previewImageUrl: u }))
    const ok = await linePush(GRP, [{ type: 'text', text: body }, ...imgs])
    if (ok) { const nQ = a.n || 1; try { await logPush(GRP, nQ, '會議宣達發大群(' + a.by + ')') } catch (_) {} return { ok: true, sent: true, n: nQ } }
    return { ok: false, retry: true, fail: true }
  },
  async meet_dm_picked(a) { // 指定對象：逐一私訊（個人直達連結）
    const { uid, tok } = await bindMaps()
    const imgs = (a.media || []).filter(u => /^https:\/\//.test(u)).slice(0, 4).map(u => ({ type: 'image', originalContentUrl: u, previewImageUrl: u }))
    let dm = 0
    for (const nm of a.names || []) {
      const u = uid[nm]; if (!u) continue
      const lnk = tok[nm] ? `https://ground-pm.vercel.app/prep?me=${tok[nm]}#meet=${a.id}` : prepLink('meet=' + a.id)
      if (await linePush(u, [{ type: 'text', text: `📢 會議宣達【${a.type}・${a.date}】（${a.by} 指定你簽收）\n${String(a.text || '').slice(0, 300)}\n\n👉 點連結直達，看完按「✅ 確認熟知」\n${lnk}` }, ...imgs])) { dm++; try { await logPush(u, 1, '會議個別私訊(' + a.by + ')') } catch (_) {} }
    }
    return { dm }
  },
  async meet_dm_one(a) { // 指定對象：一個人一個事件（個人直達連結）
    const { uid, tok } = await bindMaps(); const u = uid[a.name]
    if (!u) return { ok: true, skipped: true }
    const imgs = (a.media || []).filter(x => /^https:\/\//.test(x)).slice(0, 4).map(x => ({ type: 'image', originalContentUrl: x, previewImageUrl: x }))
    const lnk = tok[a.name] ? `https://ground-pm.vercel.app/prep?me=${tok[a.name]}#meet=${a.id}` : prepLink('meet=' + a.id)
    const ok = await linePush(u, [{ type: 'text', text: `📢 會議宣達【${a.type}・${a.date}】（${a.by} 指定你簽收）\n${String(a.text || '').slice(0, 300)}\n\n👉 點連結直達，看完按「✅ 確認熟知」\n${lnk}` }, ...imgs])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(u, 1, '會議個別私訊(' + a.by + ')') } catch (_) {}
    return { ok: true, sent: true }
  },
  async meet_ask_notify(a, idem) { // 發問→逐一私訊老闆群操作者（逐人只發一次）
    const ops = (await kvGet('pm_bot_operators')) || {}
    let n = 0
    for (const u of Object.keys(ops)) {
      const r = await once(idem + ':' + u, async () => { const ok = await linePush(u, [{ type: 'text', text: '❓ 會議宣達發問【' + a.type + ' ' + a.date + '】\n' + a.by + '：' + a.q + '\n到 /prep → 會議 回覆（他會收到通知）' }]); if (!ok) return { ok: false, retry: true }; try { await logPush(u, 1, '會議發問通知') } catch (_) {} return { ok: true } })
      if (!r || r.ok === false) return { ok: false, retry: true, n }
      n++
    }
    return { ok: true, n }
  },
  async meet_ask_task(a) { // 發問→收件匣任務（鍵由發問 id 派生，重試不會多建）
    const key = 'sp_team_pm_task_mq' + a.askId
    const { abgdKv } = await import('./_abgdkv.js'); const kvT = await abgdKv({ domain: 'tasks', lockKey: 'sp_team_pm_task_x', operator: String(a.by || '會議'), label: '任務' }) // v4.71.115 依資料歸屬
    if (await kvT.kvGet(key)) return { ok: true, dup: true }
    const ok = await kvT.kvPut(key, { id: 'mq' + a.askId, title: '❓會議發問：' + String(a.q).slice(0, 40) + '（' + a.by + '）', note: '【' + a.type + ' ' + a.date + '】' + a.q, status: 'todo', catId: '__inbox__', priority: 'normal', tags: ['會議'], by: a.by, createdAt: new Date().toISOString() })
    return ok ? { ok: true } : { ok: false, retry: true }
  },
  async wp_names(a) { // App 站內通知＋推播（同名所有身分 id）
    const { ids } = await bindMaps()
    const rids = [...new Set((a.names || []).flatMap(n => ids[n] || []))]
    if (!rids.length) return { ok: true, n: 0 }
    return { ok: true, n: await wpPush(rids, a.msg) }
  },
  async meet_all_acked(a) { // 全員簽完→發起人 LINE 私訊
    const { uid } = await bindMaps(); const u = uid[a.by]
    if (!u) return { ok: true, skipped: true }
    const ok = await linePush(u, [{ type: 'text', text: `🎉 會議全員已簽收【${a.type}・${a.date}】\n${a.total} 人全部確認熟知，點開看 👇\nhttps://ground-pm.vercel.app/prep#meet=${a.id}` }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(u, 1, '會議全員簽收(' + a.by + ')') } catch (_) {}
    return { ok: true }
  },
  // v4.71.198 DD 搬家批 1：新殼 DD 處理器的回覆／推播（docs/ABGD_DD_PLAN.md v2.1 二節；金鑰留 GD）
  //   reply：只在期限內、只試一次（子事件 idem:reply 記結果）；成功＝完成；LINE 回 400（token 過期／用過）＝改 push；其他／逾時＝結果不明，不自動補發（回 retry:false＋健康紀錄，人工查）
  //   push：固定重試鍵（idem）＝LINE 端擋重複；_qpatch 補額度尾巴（reply 跟 GD lineReply 一樣自己補本月用量）
  //   chat：回完寫對話記憶（同 GD finish；子事件只寫一次）
  // v4.71.203 DD 批 5：新殼改團隊任務後補記活動紀錄（GD 正本 sp_team_pm_activity；DD 回答「誰最近改了什麼」讀這份）
  //   跟任務修改同一交易排入新殼佇列；同一編號只記一次（條目帶 id＝編號，完成紀錄沒寫上又被重送也不會記兩筆）；最新在前、留 200 筆
  async dd_activity(a, idem) {
    if (a.key !== 'sp_team_pm_activity') return { ok: false, retry: false, error: '只能記團隊活動紀錄' }
    const e = a.entry || {}
    if (![e.ts, e.user, e.action, e.detail].every((x) => typeof x === 'string' && x.length <= 1000)) return { ok: false, retry: false, error: '活動紀錄格式不對' }
    const { actAppend } = await import('./_actlog.js')
    const ok = await actAppend(a.key, [{ ts: e.ts, user: e.user, action: e.action, detail: e.detail, id: idem }], 'abgd-fx')
    return ok ? { ok: true } : { ok: false, retry: true, error: '活動紀錄沒存上' }
  },
  async dd_send(a, idem) {
    const to = String(a.to || '')
    if (!/^[UCR][0-9a-f]{32}$/.test(to)) return { ok: false, retry: false, error: '收件人格式不對' }
    const msgs = Array.isArray(a.messages) ? a.messages.filter((m) => m && typeof m === 'object' && typeof m.type === 'string').slice(0, 5) : []
    if (!msgs.length) return { ok: false, retry: false, error: '沒有訊息' }
    const { ddHealthLog } = await import('./_ddhealth.js')
    // v4.71.213 DD 搬家 7c-2：新殼 AI 回答（kind=ai_answer）才有的檢查——送 LINE 前一刻：期限、暫停開關（ddroutes.aiMute）、用 GD 正本重驗收件人權限（綁定、不是操作者、機密權限）
    //   不符＝不送、回 state（denied／cancelled，不重試）；其他路由（批 1～6）行為不變
    const isAi = a.kind === 'ai_answer'
    // v4.71.214 DD 搬家 7c-3a：新殼 AI 處理不了時的固定短訊（kind=ai_notice：系統忙／權限調整中／資料太多）——只准一則 500 字內、不帶對話紀錄；
    //   送 LINE 前檢查期限（新殼給 D＋300 秒）與暫停開關（aiMute），不符＝cancelled 不送；不寫對話紀錄（不進 DD 記憶）
    if (a.kind === 'ai_notice') {
      if (!to.startsWith('U') || a.chat || msgs.length !== 1 || msgs[0].type !== 'text' || String(msgs[0].text || '').length > 500) return { ok: false, retry: false, error: 'AI 短訊格式不對' }
      const cfgN = await kvGet('sp_finance_pm_ddroutes')
      if (!(Number(a.deadline) > Date.now()) || (cfgN && cfgN.aiMute === true)) return { ok: false, retry: false, state: 'cancelled', error: '短訊已過期限或暫停中' }
    }
    // 第一輪審查：AI 回答一定要帶對話紀錄，且對話編號就是收件人的私訊（不能寫到別人的對話）
    if (isAi && !(a.chat && typeof a.chat === 'object' && a.chat.conv === 'dm_' + to && typeof a.chat.a === 'string')) return { ok: false, retry: false, error: 'AI 回答的對話紀錄格式不對' }
    // 第二輪審查：送出去的跟記進對話紀錄的必須是同一份（文字訊息依序以換行接起來＝chat.a），不能送 A 記 B
    if (isAi && a.chat.a !== msgs.filter((m) => m.type === 'text').map((m) => String(m.text || '')).join('\n')) return { ok: false, retry: false, error: 'AI 回答的送出內容與紀錄內容不一致' }
    if (isAi && msgs.some((m) => m.type === 'text' && String(m.text || '').length > 4800)) return { ok: false, retry: false, error: 'AI 回答單則超過 4800 字（會被截斷，不送）' } // 第三輪 OpenAI N4：送出時不會再截字
    // GD 正本查收件人身分：bound＝名冊綁定、op＝操作者、s＝機密權限（GD 自己算，不信新殼帶來的標記）；每次閘門都重讀（第三輪 OpenAI P3：改推播前要看到最新的撤權／暫停）
    const aiFacts = async () => {
      const [cfg, roster, ops, sop, idl] = await Promise.all(['sp_finance_pm_ddroutes', 'sp_crew_kb_roster', 'pm_bot_operators', 'sp_finance_pm_sop_def', 'sp_finance_pm_hr_idlock'].map((k) => kvGet(k)))
      const me = ((roster && Array.isArray(roster.people)) ? roster.people : []).find((p) => p && typeof p.lineUserId === 'string' && p.lineUserId && p.lineUserId === to)
      const apr = (((sop || {}).ground || {}).approvers || ['張良瑋']); const lock = ((idl || {}).rids) || []
      return { mute: !!(cfg && cfg.aiMute === true), bound: !!me, op: !!(ops && typeof ops === 'object' && ops[to]), s: !!(me && (apr.includes(me.name) || lock.includes(me.id))) }
    }
    const aiGate = async () => {
      if (!isAi) return null
      const f = await aiFacts() // 先讀完資料再看期限（讀很慢時不會讓過期的回答溜出去）
      if (!(Number(a.deadline) > 0) || Date.now() > Number(a.deadline)) return 'cancelled'
      if (f.mute) return 'cancelled'
      const nd = a.need && typeof a.need === 'object' ? a.need : null
      if (!nd || String(nd.uid || '') !== to || !to.startsWith('U')) return 'denied'
      if (!f.bound || f.op) return 'denied' // 7c 只回綁定、不是操作者的人
      if (nd.s === true && !f.s) return 'denied'
      return null
    }
    // 權限標記＝這則回答「內容」的敏感等級（第四輪定義）：m＝含金額（7c 只回綁定、非操作者＝能看金額才會走到送出）、s＝新殼宣告有用到機密資料（need.s，閘門已用 GD 正本驗過收件人有機密權限）、v＝1
    //   由這次的請求內容決定，同一事件重試永遠一樣（不用另外凍結，也不會跟已寫入的內容衝突）；不採用新殼自己帶的 sc
    const aiSc = () => ({ m: true, s: !!(a.need && a.need.s === true), v: 1 })
    const aiChat = async (st) => { // AI 回答寫對話紀錄（帶事件編號、權限標記、送達狀態）；寫不上＝回 false（動作回可重試，只補紀錄）
      if (!isAi) return true
      try { const cr = await once(idem + ':chat', async () => { const { pushChat } = await import('./line-webhook.js'); const w = await pushChat(String(a.chat.conv), String(a.chat.q || ''), String(a.chat.a || ''), { id: String(a.chat.id || idem), sc: aiSc(), st, noSum: true }); return w && w.ok ? { ok: true } : { ok: false, retry: true } }); return !(cr && cr.ok === false) } catch (_) { return false }
    }
    // 收件匣記這則回答（子事件只寫一次；存不上也排不進待補存＝回 false）；md＝reply／push／unknown（結果不明也要留紀錄，第四輪 OpenAI A1）
    const ibNote = async (md) => {
      if (!to.startsWith('U')) return true
      try {
        const ibr = await once(idem + ':ib', async () => { const IB = await import('./_inbox.js'); const A = IB.acctOf('dd'); const txt = String((msgs.find((m) => m.type === 'text') || {}).text || '').trim(); if (A && IB.configured(A) && txt) { const tm = Number(a.ts || Date.now()) + 1; let m = null; try { m = await IB.noteOut(A, to, txt, 'DD', md, { t: tm }) } catch (e) { console.log('[dd] 收件匣記回答失敗（放待補存）', e && e.message) } if (!m) { const q = await IB.ibQueueOut(A, to, txt, 'DD', md, tm).catch(() => null); if (q === false || q === null) return { ok: false, retry: true } } } return { ok: true } })
        return !(ibr && ibr.ok === false)
      } catch (_) { return false }
    }
    // 第二輪審查：已有收據＝明確分流，這條路上絕不再呼叫 LINE：送出（reply 或 push 成功）＝只補收件匣與紀錄；結果不明＝記不明；訊息被拒＝失敗
    let aiPrior = null
    if (isAi) {
      const [p1, p2] = await Promise.all([peekOnce(idem + ':reply'), peekOnce(idem + ':push', 'push')])
      if (p1 === 'busy' || p2 === 'busy') return { ok: false, retry: true, error: '回覆正在處理中' }
      const d1 = p1 && p1.done, d2 = p2 && p2.done
      aiPrior = (d1 && d1.via === 'reply') ? 'reply' : (d2 && d2.via === 'push') ? 'push' : ((d1 && d1.unknown) || (d2 && d2.unknown)) ? 'unknown' : (d1 && d1.badmsg) ? 'badmsg' : null // reply 只是 token 失效（還沒 push）＝照一般流程：過閘門再改推播
      if (aiPrior === 'badmsg') return { ok: false, retry: false, state: 'failed', error: '訊息格式錯（LINE 拒收，之前已試過）' }
      if (aiPrior === 'unknown') {
        if (!(await ibNote('unknown'))) return { ok: false, retry: true, error: '回覆結果不明，收件匣還沒記上（只補收件匣）' }
        if (!(await aiChat('unknown'))) return { ok: false, retry: true, error: '回覆結果不明，對話紀錄還沒記上（只補紀錄）' }
        return { ok: false, retry: false, state: 'unknown', error: '回覆結果不明（不自動補發，避免重複）' }
      }
      if (aiPrior === 'reply' || aiPrior === 'push') {
        const ib1 = await ibNote(aiPrior)
        if (!(await aiChat('sent'))) return { ok: false, retry: true, state: 'sent', error: '已送出，對話紀錄還沒記上（只補紀錄）' }
        if (!ib1) return { ok: false, retry: true, error: '已回話，收件匣還沒記上（會再補）' }
        return { ok: true, via: aiPrior, state: 'sent' }
      }
    }
    if (!aiPrior) { const g0 = await aiGate(); if (g0) { ddHealthLog({ kind: 'error', from: 'abgd', err: 'DD AI 回答不送（' + g0 + '）' }).catch(() => {}); return { ok: false, retry: false, state: g0, error: g0 === 'denied' ? '收件人權限不符' : '已過期限或暫停中' } }}
    let via = ''
    // 事件超過 20 小時（LINE 重試鍵只保 24 小時）：之後不論收據狀態都不再呼叫 LINE——沒有確定送出的，當結果不明處理（只補收件匣）（第五輪 OpenAI A1-1）
    const tooOld = Date.now() - Number(a.ts || 0) > 20 * 3600e3
    if (a.replyToken) {
      // 先看之前試過 reply 沒（不論期限）：成功＝不再發；結果不明＝不自動補發；明確 token 失效＝改 push；沒試過且還在期限內＝試一次
      const pk = await peekOnce(idem + ':reply')
      let r = pk && pk.done !== undefined ? pk.done : null
      if (pk === 'busy') return { ok: false, retry: true, error: '回覆正在處理中' }
      if (!r && Number(a.replyBefore) > Date.now() && !tooOld) {
        r = await once(idem + ':reply', async () => {
          try {
            const foot = await quotaFoot(0)
            const m2 = msgs.map((m, i) => (i === 0 && m.type === 'text' ? { ...m, text: String(m.text || '').slice(0, 4800) + foot } : m))
            const res = await fetch('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TK() }, body: JSON.stringify({ replyToken: String(a.replyToken), messages: m2 }), signal: AbortSignal.timeout(10000) })
            if (res.ok) return { ok: true, via: 'reply' }
            if (res.status === 400) { // 只有 reply token 失效才改 push；訊息格式錯＝同一份訊息 push 也會錯，直接終止（關卡 Gemini／OpenAI）
              const j = await res.json().catch(() => ({})); const msg = String(j.message || '')
              return /reply token/i.test(msg) ? { ok: true, invalid: true } : { ok: true, badmsg: true, msg: msg.slice(0, 160) }
            }
            return { ok: true, unknown: true, status: res.status }
          } catch (e) { return { ok: true, unknown: true, err: String(e && e.message || e).slice(0, 80) } }
        })
        if (r && r.busy) return { ok: false, retry: true, error: '回覆正在處理中' }
      }
      if (r && r.via) via = 'reply'
      else if (r && r.badmsg) { ddHealthLog({ kind: 'error', from: 'abgd', err: 'DD 回話訊息格式錯：' + r.msg }).catch(() => {}); return { ok: false, retry: false, state: isAi ? 'failed' : undefined, error: '訊息格式錯（LINE 拒收）：' + r.msg } }
      else if (r && r.unknown) { // 結果不明：絕不再發；收件匣照樣記一筆（標結果不明），記不上就回可重試（重試不會發 LINE，只補收件匣）
        ddHealthLog({ kind: 'reply', from: 'abgd', ok: 0, unknown: 1, status: r.status || 0 }).catch(() => {})
        if (!(await ibNote('unknown'))) return { ok: false, retry: true, error: '回覆結果不明，收件匣還沒記上（只補收件匣）' }
        if (!(await aiChat('unknown'))) return { ok: false, retry: true, error: '回覆結果不明，對話紀錄還沒記上（只補紀錄）' }
        return { ok: false, retry: false, state: isAi ? 'unknown' : undefined, error: '回覆結果不明（不自動補發，避免重複）' }
      }
    }
    if (!via && tooOld) { // 太舊：push 收據若在（成功）就照成功；否則不呼叫 LINE
      const pk2 = await peekOnce(idem + ':push', 'push')
      if (pk2 && pk2.done && pk2.done.via === 'push') via = 'push'
      else {
        ddHealthLog({ kind: 'reply', from: 'abgd', ok: 0, unknown: 1, old: 1 }).catch(() => {})
        if (!(await ibNote('unknown'))) return { ok: false, retry: true, error: '事件太舊不再發，收件匣還沒記上（只補收件匣）' }
        return { ok: false, retry: false, error: '事件超過 20 小時、沒有確定送出：不再發（避免超過 LINE 防重期限後重複）' }
      }
    }
    if (!via && !aiPrior) { const g1 = await aiGate(); if (g1) return { ok: false, retry: false, state: g1, error: '改推播前：已過期限、暫停中或權限不符' } } // AI 回答：改推播前再檢查一次（reply 那次可能花了時間）
    if (!via) { // push 也有自己的完成收據：重試時看到已送就不再呼叫 LINE（第四輪 OpenAI A1；LINE 重試鍵只保 24 小時，佇列最多重試 5 次、退避上限 10 分鐘＝1 小時內結束）
      const pr = await once(idem + ':push', async () => {
        const ok = await linePush(to, msgs.map((m) => (m.type === 'text' ? { ...m, text: String(m.text || '').slice(0, 4800) } : m)), idem)
        if (!ok) return { ok: false, retry: true }
        try { await logPush(to, 1, 'DD 新殼回話（reply 失效改推播）') } catch (_) {}
        return { ok: true, via: 'push' }
      })
      if (!pr || pr.ok === false) return { ok: false, retry: true, error: pr && pr.busy ? '推播正在處理中' : '推播失敗' }
      via = 'push'
    }
    // 統一收件匣記 DD 這則回答（關卡 Gemini A3／OpenAI A11；同 GD lineReply 的 ddInboxOut；固定時間＝補送不會變兩則）
    const ibOk = await ibNote(via) // 存不上也排不進待補存＝這次回話不算完成（第三輪 OpenAI A1）
    if (isAi) { if (!(await aiChat('sent'))) return { ok: false, retry: true, state: 'sent', error: '已送出，對話紀錄還沒記上（只補紀錄）' } }
    else if (a.chat && a.chat.conv) { try { await once(idem + ':chat', async () => { const { pushChat } = await import('./line-webhook.js'); await pushChat(String(a.chat.conv), String(a.chat.q || ''), String(a.chat.a || '')); return { ok: true } }) } catch (_) {} }
    ddHealthLog({ kind: 'reply', from: 'abgd', dm: to.startsWith('U') ? 1 : 0, ok: 1, send: via, route: String(a.route || '').slice(0, 20), ib: ibOk ? 1 : 0 }).catch(() => {})
    // 收件匣沒記上：整個動作回「可重試」——新殼佇列會用同一編號再呼叫；重試時 reply 子紀錄已是成功＝不重發、push 用同一重試鍵＝LINE 擋重複、對話記憶子事件已完成＝不重寫，只補收件匣
    if (!ibOk) return { ok: false, retry: true, error: '已回話，收件匣還沒記上（會再補）' }
    return { ok: true, via, state: isAi ? 'sent' : undefined }
  },
  async dd_chat_get(a) { // v4.71.213 DD 搬家 7c-2（唯讀）：新殼每輪讀對話紀錄正本（GD 表，不經鏡像＝沒有落後）；只收私訊對話編號
    const conv = String(a.conv || '')
    if (!/^dm_U[0-9a-f]{32}$/.test(conv)) throw new Error('對話編號格式不對')
    // 第一輪審查：用資料庫同一個快照讀（清單＋摘要＋版本；含舊整包懶讀），不會讀到裁一半的狀態；讀不到＝丟錯（新殼這輪不回答，不拿空紀錄硬答）
    const r = await fetch(`${SB_URL}/rest/v1/rpc/pm_chat_get`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json' }, body: JSON.stringify({ p_conv: conv }), signal: AbortSignal.timeout(6000) })
    if (!r.ok) throw new Error('對話紀錄讀不到（' + r.status + '）')
    const g = await r.json()
    if (!g || !Array.isArray(g.list) || typeof g.sum !== 'string') throw new Error('對話紀錄格式不對')
    return { list: g.list, sum: g.sum, rev: Number(g.rev) || 0, pending: g.pending === true } // pending＝還有待補寫（新殼 7c-3 決定這輪要不要等）
  },
  async dd_ai(a) { // v4.71.213 DD 搬家 7c-2（唯讀路徑；去重在新殼模型呼叫台帳）：走 GD answer() 同一個 aiCallAB('dd')（同供應商、模型、備援、用量紀錄）；超過期限不叫
    const dl = Number(a.deadline) || 0, left = dl - Date.now()
    if (!(left > 25_000)) return { expired: true }
    if (typeof a.system !== 'string' || !Array.isArray(a.messages) || !a.messages.length || a.messages.length > 80 || Buffer.byteLength(JSON.stringify(a)) > 600_000) throw new Error('送 AI 的內容格式不對')
    for (const m of a.messages) if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') throw new Error('訊息格式不對')
    const { aiCallAB } = await import('./_ai.js')
    let r
    try { r = await aiCallAB('dd', { system: a.system, messages: a.messages, maxTokens: 3000, cache: true, effort: 'low', timeoutMs: Math.min(90_000, left - 10_000), deadline: dl - 10_000 }, null) } // 絕對期限：備援也不會超過（第八輪 OpenAI A33）
    catch (e) { // v4.71.214 7c-3a：分類——期限到＝expired；備援鏈每一家都明確失敗（aiCall 丟出帶 tried 清單的錯）＝model_all_failed；其他（程式錯誤等）＝照丟（新殼當結果不明）
      if (e && e.code === 'AI_DEADLINE') return { expired: true } // AI 中樞穩定錯誤碼（第三輪 OpenAI A9）
      if (e && Array.isArray(e.tried) && e.tried.length > 0) return { failed: true, code: 'model_all_failed' }
      throw e
    }
    return { text: String(r.text || ''), provider: r.provider || '', model: r.model || '' }
  },
  async dd_query(a) { // v4.71.212 DD 搬家 7c-1b（唯讀）：新殼 AI 代查裡要 GD 才有的四種——訂位即時搜尋／常客排行（inline 登入金鑰在 GD）、會員（會員資料在 GD）、團體訂餐（GD 原函式）；回的就是 GD 原本代查的文字
    const t = String(a.tool || '')
    if (t === 'resv_name' || t === 'resv_top') { const LW = await import('./line-webhook.js'); return { text: String(t === 'resv_name' ? await LW.queryResvName(String(a.kw || '').slice(0, 60)) : await LW.queryResvTop(Math.min(100, Math.max(0, Number(a.n) || 0)))) } }
    const M = await import('./_ddmember.js')
    if (t === 'member') return { text: String(await M.queryMember({ kw: String(a.kw || '').slice(0, 60), secretOK: a.secretOK === true })) }
    if (t === 'grporder') return { text: String(await M.queryGrporder({ kw: a.kw == null ? undefined : String(a.kw).slice(0, 60), id: a.id == null ? undefined : String(a.id).slice(0, 40), status: a.status == null ? undefined : String(a.status).slice(0, 20) })) }
    throw new Error('不認得的代查：' + t)
  },
  async dd_meta() { // v4.71.208 DD 搬家批 7a（唯讀）：AI 段落要的「舊主 App 帳號清單」與「DD 的 LINE 訊息額度」——這兩樣的金鑰／資料表只在 GD；讀不到＝null（新殼那段標「暫時讀不到」，不當成沒資料）
    const H = { authorization: 'Bearer ' + TK() }
    const [profiles, quota] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/profiles?select=display_name,role,role_template`, { headers: svc, signal: AbortSignal.timeout(5000) }).then(async (r) => (r.ok ? r.json() : null)).catch(() => null),
      Promise.all([
        fetch('https://api.line.me/v2/bot/message/quota', { headers: H, signal: AbortSignal.timeout(5000) }).then(async (r) => (r.ok ? r.json() : null)),
        fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: H, signal: AbortSignal.timeout(5000) }).then(async (r) => (r.ok ? r.json() : null)),
      ]).catch(() => null),
    ])
    // LINE 回錯誤碼（401／429／500）或格式不對＝null（不把錯誤內容當成額度）；quota.type 只認 limited（要有數字 value）或 none（無上限）
    const qOk = quota && quota[0] && typeof quota[0] === 'object' && ((quota[0].type === 'limited' && Number.isFinite(quota[0].value)) || quota[0].type === 'none') && quota[1] && typeof quota[1] === 'object' && Number.isFinite(quota[1].totalUsage)
    return { profiles: Array.isArray(profiles) ? profiles.map((p) => ({ display_name: p && p.display_name, role: p && p.role, role_template: p && p.role_template })) : null, quota: qOk ? [{ type: quota[0].type, ...(quota[0].type === 'limited' ? { value: quota[0].value } : {}) }, { totalUsage: quota[1].totalUsage }] : null }
  },
  async dd_health(a) { // v4.71.217 DD 搬家 7c-3b：新殼把重要狀況寫進 GD 的 DD 健康紀錄（健康頁看得到）；只收固定代碼（GD 這邊換成說明文字），不收任何自由文字（第一輪 OpenAI A6）
    const CODES = { job_dead: '新殼 AI 工作放棄（要人工看）', finfail: '新殼 AI 工作結束標記沒寫上（會被重新領取、只補送）', send_gaveup: '新殼 AI 送出結果不明、超過期限放棄（要人工看）', cc_failed: 'DD 查不到資料自動記給 CC 沒記上（新殼）', notice_late: '新殼 AI 短訊太晚沒送' }
    if (!Object.hasOwn(CODES, a.code)) throw new Error('不認得的健康紀錄代碼')
    const { ddHealthLog } = await import('./_ddhealth.js')
    await ddHealthLog({ kind: 'error', from: 'abgd', code: a.code, err: CODES[a.code], route: 'ai' })
    return { ok: true }
  },
  async dd_redrive() { // v4.71.198 新殼每分鐘排程呼叫：補送沒送到新殼的 DD 事件（簽章＝不掛公開網址）
    const dl = Date.now() + 35_000 // 整段期限（新殼這次呼叫等 40 秒，留 5 秒回應）
    const { ddRedrive } = await import('./_ddroute.js')
    const out = await ddRedrive(async (t, eid) => { const to = String(process.env.LINE_BOSS_USER || 'Uf7ce4fb9191cd3055247204e0cb6b4fc').trim(); return await linePush(to, [{ type: 'text', text: String(t).slice(0, 1000) }], 'ddgiveup:' + eid) }) // 回 true＝通知送出（固定重試鍵＝同一事件只一則）
    try { const LW = await import('./line-webhook.js'); await LW.chatRetryRun(dl) } catch (_) {} // v4.71.213 對話紀錄維護（補寫＋摘要待辦）：搭這個每分鐘、有簽章的排程（不掛公開網址）；放在補送之後、自己有時間上限（新殼這次呼叫等 40 秒）
    return { ok: true, ...out }
  },
  async boss_dm(a) { // 私訊老闆（固定收件人 LINE_BOSS_USER，不收任意 userId）：新殼排程摘要（例：每日菜商報價同步）用；有 idem＝重試不重發
    const to = String(process.env.LINE_BOSS_USER || 'Uf7ce4fb9191cd3055247204e0cb6b4fc').trim()
    const text = String(a.text || '').slice(0, 4800); if (!text) return { ok: true, skipped: true }
    const ok = await linePush(to, [{ type: 'text', text }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(to, 1, String(a.tag || '新殼私訊老闆').slice(0, 40)) } catch (_) {}
    return { ok: true }
  },
  async award(a) { const r = await awardPtsStrict(a.person, a.act, a.ref); return { ok: true, awarded: r.awarded, reason: r.reason } }, // 規則關閉／已給過／達上限＝完成；讀寫失敗丟錯＝新殼重試（關卡 3 回饋第一輪）
  async meet_ask(a) { // 發問→DD 私訊老闆群操作者＋收件匣任務
    const ops = (await kvGet('pm_bot_operators')) || {}
    for (const u of Object.keys(ops)) { if (await linePush(u, [{ type: 'text', text: '❓ 會議宣達發問【' + a.type + ' ' + a.date + '】\n' + a.by + '：' + a.q + '\n到 /prep → 會議 回覆（他會收到通知）' }])) { try { await logPush(u, 1, '會議發問通知') } catch (_) {} } }
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(String(a.askId || ''))) return { ok: false, retry: false, error: '缺發問編號' } // v4.71.119 發問編號必填（不退回時間戳；關卡 3 tasks 第二輪 OpenAI A6）
    const id = 'mq' + a.askId
    const { abgdKv } = await import('./_abgdkv.js'); const kvT = await abgdKv({ domain: 'tasks', lockKey: 'sp_team_pm_task_x', operator: String(a.by || '會議'), label: '任務' }) // v4.71.115 依資料歸屬
    if (!(await kvT.kvGet('sp_team_pm_task_' + id))) await kvT.kvPut('sp_team_pm_task_' + id, { id, title: '❓會議發問：' + String(a.q).slice(0, 40) + '（' + a.by + '）', note: '【' + a.type + ' ' + a.date + '】' + a.q, status: 'todo', catId: '__inbox__', priority: 'normal', tags: ['會議'], by: a.by, createdAt: new Date().toISOString() })
    return { ok: true }
  },
  async meet_answer(a) { // 回覆→DD 通知提問人
    const ros = await kvGet('sp_crew_kb_roster')
    const po = (((ros || {}).people) || []).find(p2 => p2.name === a.asker && p2.lineUserId)
    if (!po) return { ok: true, skipped: true }
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: '💬 你的會議發問有回覆了【' + a.type + ' ' + a.date + '】\nQ：' + a.q + '\nA：' + a.ans + '（' + a.ansBy + '）' }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, '會議發問回覆') } catch (_) {}
    return { ok: true }
  },
  async meet_nudge(a) { // 點未簽的人→單獨 DD 私訊＋App 推播
    const { bd } = await bindMaps()
    let tok = null, uid = null, rid = null
    for (const [k, v] of Object.entries(bd.tokens || {})) { if (v && v.name === a.name) { tok = k; uid = v.uid; rid = v.rid || v.uid; break } }
    let sent = 0
    if (uid && TK()) {
      const link = 'https://ground-pm.vercel.app/prep?me=' + tok + '#meet=' + a.id
      const ok = await linePush(uid, [{ type: 'text', text: '📣 會議簽收提醒【' + a.type + '・' + a.date + '】\n' + a.by + ' 請你確認熟知，點開直達這則並簽收 👇\n' + link }])
      if (!ok) return { ok: false, retry: true }
      try { await logPush(uid, 1, '會議個別催簽(' + a.name + ')') } catch (_) {}
      sent++
    }
    if (rid) { try { await wpPush([rid], { title: '📣 會議簽收提醒', body: a.type + '・' + a.date + '（' + a.by + ' 提醒你簽收）', url: '/prep#meet=' + a.id, cat: 'meet' }) } catch (_) {} }
    return { ok: true, sent, bound: !!(uid || rid) }
  },
  async meet_remind(a) { // 未簽追提醒（排程）
    const [ros, bd] = await Promise.all([kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_prep_bind')])
    const po = (((ros || {}).people) || []).find(p2 => p2.name === a.name && p2.lineUserId)
    if (!po) return { ok: true, noLine: true }
    const tkP = (((bd || {}).byUid) || {})[po.lineUserId]
    const lnk = tkP ? `https://ground-pm.vercel.app/prep?me=${tkP}#meet=${a.id}` : prepLink('meet=' + a.id)
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: `📣 會議宣達還沒簽收（第 ${a.n} 次提醒）\n【${a.type}・${a.date}】\n點下面連結直達這則，看完按「✅ 確認熟知」，有問題按「❓ 我想發問」👇\n${lnk}` }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, '宣達未簽提醒') } catch (_) {}
    try { await wpPushUids([po.lineUserId], { title: '📣 會議簽收提醒', body: `【${a.type}・${a.date}】還沒簽收，點開直達這則`, url: '/prep#meet=' + a.id, badge: a.badge }) } catch (_) {}
    return { ok }
  },
  // ── SOP／問題回報（F02＋F33，文字照抄 mail-sync 原程式）──
  async sop_sug_dm(a) { // 💡 建議 → DD 私訊該站負責人（原 sopsugset add）
    const ros = await kvGet('sp_crew_kb_roster')
    const po = (((ros || {}).people) || []).find(p2 => p2.name === a.owner && p2.lineUserId)
    if (!po || !TK()) return { ok: true, skipped: true }
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: '💡 ' + a.by + ' 對你負責的 SOP【' + a.st + '】提了建議：\n' + a.text + '\n到 /prep → SOP 按「💡 建議」審核（通過他會加分）' }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, 'SOP建議通知') } catch (_) {} return { ok: true, sent: true }
  },
  async sop_sug_result(a) { // 建議審核結果 → DD 通知申請人（原 sopsugset decide）
    const ros = await kvGet('sp_crew_kb_roster')
    const po = (((ros || {}).people) || []).find(p2 => p2.name === a.to && p2.lineUserId)
    if (!po || !TK()) return { ok: true, skipped: true }
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: a.pass ? ('✅ 你對 SOP【' + a.st + '】的建議通過了（' + a.decBy + ' 核）——記你 1 分！') : ('📁 你對 SOP【' + a.st + '】的建議未採納（' + a.decBy + '）：' + a.note + '\n已歸檔留紀錄。') }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, 'SOP建議結果') } catch (_) {} return { ok: true, sent: true }
  },
  async ntf_add(a, idem) { // 通知中心只記歷史（原 sopreport：不發 web push）
    const nd = (await kvGet('sp_finance_pm_prep_ntf')) || { list: [] }
    // 通知 id 由事件冪等鍵決定（關卡 3 SOP 第一輪）：寫成功但回應丟失再執行，不會多一筆
    const nid = idem ? 'nx' + crypto.createHash('sha1').update(String(idem)).digest('hex').slice(0, 12) : 'n' + Date.now().toString(36)
    if ((nd.list || []).some(x => x.id === nid)) return { ok: true, dup: true }
    nd.list = [{ id: nid, ts: new Date().toISOString(), cat: a.cat || 'other', title: a.title, body: a.body, url: a.url || '/prep', to: a.to || null }, ...(nd.list || [])].slice(0, 300)
    if (!(await kvSet('sp_finance_pm_prep_ntf', nd))) return { ok: false, retry: true }
    return { ok: true }
  },
  async sop_report_dm(a, idem) { // 問題回報 → DD 私訊審核人【發布／保留／刪除】（原 sopreport）
    const [defD, rosterD] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
    const apr = Array.isArray(a.apr) ? a.apr : (((defD || {}).ground || {}).approvers || ['張良瑋']) // 新殼正本快照優先（GD 副本可能還沒反推到）
    const iss = a.iss || {}
    const out = []
    for (const an of apr) {
      const ap = ((rosterD || {}).people || []).find(p => p.name === an && p.lineUserId)
      if (!TK() || !ap) continue
      out.push(await once(idem + '|' + an, async () => ({ ok: await linePush(ap.lineUserId, [{ type: 'template', altText: `⚠️ 問題回報待確認【${iss.st}】${(iss.text || '').slice(0, 30)}`, template: { type: 'buttons', title: `⚠️ 問題回報【${iss.st}】`.slice(0, 40), text: `${(iss.text || '（見附件）').slice(0, 100)}\n— ${iss.by}${(iss.media || []).length ? `・附${iss.media.length}檔(看板可看)` : ''}`.slice(0, 160), actions: [
        { type: 'postback', label: '✅ 發布到群', data: `pi|${iss.id}|go` },
        { type: 'postback', label: '📥 保留（不進群）', data: `pi|${iss.id}|hold` },
        { type: 'postback', label: '🗑 刪除', data: `pi|${iss.id}|del` },
      ] } }]) || false })))
    }
    return out.some(r => r && r.ok === false) ? { ok: false, retry: true } : { ok: true, n: out.length }
  },
  async sop_resolve_dm(a, idem) { // 夥伴按已解決＝送審 → DD 私訊審核人＋推播（原 sopresolve pending）
    const [defD, rosterD] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
    const apr = Array.isArray(a.apr) ? a.apr : (((defD || {}).ground || {}).approvers || ['張良瑋'])
    const it = a.it || {}
    for (const an of apr) {
      const ap = ((rosterD || {}).people || []).find(p => p.name === an && p.lineUserId)
      if (!ap) continue
      const r = await once(idem + '|' + an, async () => {
        if (TK()) { const ok = await linePush(ap.lineUserId, [{ type: 'text', text: `🕐 待你審核：【${it.st}】${it.text || '（附件）'}\n${a.who} 說已解決。\n到看板該站卡片按「核准／退回」👇\n${prepLink('')}` }]); if (!ok) return { ok: false, retry: true } }
        try { await wpPushUids([ap.lineUserId], { title: '🕐 待你審核', body: `【${it.st}】${a.who} 說已解決，按核准／退回`, url: '/prep' }) } catch (_) {}
        return { ok: true }
      })
      if (r && r.ok === false) return { ok: false, retry: true }
    }
    return { ok: true }
  },
  async issue_pub_group(a) { // 審核發布 go → 發到 DD 自動訊息 issue 設定的群（原 sopissue pub）
    if (a.ts && Date.now() - Date.parse(a.ts) > 23 * 3600e3) return { ok: true, skipped: 'expired' } // 超過 23 小時不再送（同上）
    const cfgI = await ddGet('issue')
    if (!TK() || !cfgI.on) return { ok: true, skipped: true }
    const it = a.it || {}
    const gidI = await ddGroupGid(cfgI.group)
    const mem = await groupMembers(gidI)
    const ok = await linePush(gidI, [{ type: 'text', text: ddFill(cfgI.text, { st: it.st, content: (it.text || '（見附件）') + ((it.media || []).length ? `・附件${it.media.length}` : ''), by: it.by }) + await quotaFoot(mem) }], 'issue-pub:' + (a.id || it.id || '') + ':' + gidI) // 固定鍵＝問題＋目標群（不同群是不同發送單元）
    return ok ? { ok: true, sent: true } : { ok: false, retry: true }
  },
  async pi_pub_group(a) { // LINE 審核按鈕「發布到群」（原 line-webhook pi|go：固定發內部群＋全員推播，文字照抄）
    const it = a.it || {}
    // 超過 23 小時（LINE 去重期限前）的發布嘗試不再送（關卡 3 SOP 第七輪）：避免期限過後重送變重複
    if (a.ts && Date.now() - Date.parse(a.ts) > 23 * 3600e3) return { ok: true, skipped: 'expired' }
    if (!TK()) return { ok: false, retry: true } // 缺金鑰＝等設定修好重試（不當成已發；關卡 3 SOP 第二輪）
    // 固定重試鍵＝問題編號（與 GD 舊路徑同一把）：切換前後兩邊、重試幾次，LINE 都只收一次
    const ok = await linePush('Cf7940efc6517b0c084ad2ad496b45f30', [{ type: 'text', text: `⚠️ 看板問題回報【${it.st}】\n${it.text || '（見附件）'}\n— ${it.by}${(it.media || []).length ? `・附 ${it.media.length} 個檔案` : ''}\n處理完點連結按「已解決」👇\n${prepLink('')}` }], 'pi-pub:' + (a.id || it.id || ''))
    if (!ok) return { ok: false, retry: true }
    try { await wpPush(null, { title: `⚠️ 問題回報【${it.st}】`, body: `${(it.text || '（附件）').slice(0, 60)} — ${it.by}`, url: '/prep' }) } catch (_) {}
    return { ok: true, sent: true }
  },
  async issue_own_dm(a) { // 指派負責人 → DD 私訊被指派者（原 sopissue own）
    const rosterO = (await kvGet('sp_crew_kb_roster')) || {}
    const po = (rosterO.people || []).find(p2 => p2.name === a.nm && p2.lineUserId)
    if (!TK() || !po) return { ok: true, skipped: true }
    const it = a.it || {}
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: `📌 ${a.who} 指派給你：【${it.st || '任務'}】${it.text || ''}\n完成後到 /prep 按「已解決」` }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, '任務指派通知') } catch (_) {} return { ok: true, sent: true }
  },
  async chat_dd(a) { // 聊天室 @DD（新殼背景回覆；同 GD _chat.js 的 aiCall('app')）：只回 AI 文字，回寫聊天室由新殼負責
    if (a.ts && Date.now() - Date.parse(a.ts) > 30 * 60e3) return { ok: true, skipped: 'expired' } // 超過 30 分鐘不再回（聊天已過時）
    const r = await aiCall('app', { system: String(a.system || '').slice(0, 4000), messages: [{ role: 'user', content: String(a.user || '').slice(0, 20000) }], maxTokens: 600 })
    return { ok: true, text: String(r.text || '').trim().slice(0, 2000) }
  },
  async chat_notify(a) { // 聊天室新訊息（原 mail-sync ?chat send 的 notify，文字照抄）：鈴鐺推播給該室成員（toNames=null＝全部）＋個人室夥伴發話 LINE 私訊審核人
    if (a.ts && Date.now() - Date.parse(a.ts) > 6 * 3600e3) return { ok: true, skipped: 'expired' }
    const { ids } = await bindMaps()
    let n = 0
    try { const to = Array.isArray(a.toNames) ? [...new Set(a.toNames.flatMap(nm => ids[nm] || []))] : null; if (!to || to.length) n = await wpPush(to, a.msg) } catch (_) {}
    if (a.lineDm && TK()) {
      const [defC, rosC] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
      const apr = (((defC || {}).ground || {}).approvers || ['張良瑋'])
      const alive = ((rosC || {}).people || []).filter(p => p && p.name && !p.endDate && (p.status || '在職') !== '離職')
      for (const an of apr) { const ap = alive.find(p => p.name === an && p.lineUserId); if (ap && ap.name !== a.lineDm.whoName) await linePush(ap.lineUserId, [{ type: 'text', text: `💬 ${a.lineDm.roomName}\n${a.lineDm.whoName}：${String(a.lineDm.text).slice(0, 300)}\n（到 /prep 聊天室回覆）` }]) }
    }
    return { ok: true, n }
  },
  async vio_notify(a, idem) { // 班表違規清單通知（原 mail-sync ?vionotify，文字照抄；新殼法規薪資頁排）：to='group' 發 ABpeople 群／'mgrs' 私訊班表主管（新殼已篩 rids，這裡再照權限表核一次）
    if (a.ts && Date.now() - Date.parse(a.ts) > 23 * 3600e3) return { ok: true, skipped: 'expired' }
    const items9 = (Array.isArray(a.items) ? a.items : []).slice(0, 8)
    if (!items9.length) return { ok: true, skipped: 'no-items' }
    if (!TK()) return { ok: false, retry: false, error: '缺 LINE token' }
    // 短網址：代碼由事件編號＋序號固定推出（重試不會多生新代碼）
    // 短網址用版本比對寫入（不會跟同時寫短網址的其他功能互蓋；關卡 3 payroll 第二輪 Gemini）
    const withShort = items9.map((it, i) => ({ ...it, c9: crypto.createHash('sha1').update(String(idem) + '|' + i).digest('hex').slice(0, 6), short: '' }))
    withShort.forEach(it => { it.short = 'https://ground-pm.vercel.app/v/' + it.c9 })
    const okSl = await kvCas('pm_shortlinks', (sl) => {
      sl.map = sl.map || {}
      for (const it of withShort) if (!sl.map[it.c9]) sl.map[it.c9] = { u: String(it.link || ''), ts: Date.now() }
      const es9 = Object.entries(sl.map); if (es9.length > 500) { es9.sort((x, y) => (x[1].ts || 0) - (y[1].ts || 0)); es9.slice(0, es9.length - 500).forEach(([k9]) => delete sl.map[k9]) }
      return sl
    })
    if (!okSl) throw new Error('短網址存不進去，稍後重試')
    const txt9 = `⚠️ 班表違規清單（${String(a.by || '').slice(0, 30)} 發送）\n` + withShort.map(it => `・${String(it.st).slice(0, 2)} ${String(it.dt).slice(5)} ${String(it.nm).slice(0, 10)}：${String(it.r).slice(0, 40)}\n　${String(it.punch || '').slice(0, 60)}\n　👉 ${it.short}`).join('\n') + `\n\n處理完點上面連結（會開新版「法規薪資」）按 ✅ 填處理內容 → 張良審核通過才銷案。`
    const quota9 = async () => { try { const H9 = { authorization: 'Bearer ' + TK() }; const [q9, c9] = await Promise.all([fetch('https://api.line.me/v2/bot/message/quota', { headers: H9 }).then(x => x.json()), fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: H9 }).then(x => x.json())]); return { used: (c9 && c9.totalUsage != null) ? c9.totalUsage : -1, total: (q9 && q9.type === 'limited') ? q9.value : -1 } } catch (_) { return { used: -1, total: -1 } } }
    const qv9 = await quota9()
    const foot9 = (billed) => qv9.used < 0 ? '' : `\n\n📊 本次 ${billed} 則｜本月 ${qv9.used + billed}${qv9.total > 0 ? '/' + qv9.total : ''} 則`
    const sent9 = []
    if (a.to === 'group') {
      let gid9 = ''
      const seen9b = (await kvGet('pm_group_seen')) || {}
      for (const [g2, gg] of Object.entries(seen9b)) if (/abpeople|ab people/i.test(gg?.name || '')) { gid9 = g2; break }
      if (!gid9) return { ok: false, retry: false, error: '找不到 ABpeople 群（DD 要先在群裡收過訊息）' }
      const r9 = await once(idem + ':g', async () => { const mem9 = await groupMembers(gid9); const ok = await linePush(gid9, [{ type: 'text', text: txt9 + foot9(mem9) }]); if (!ok) return { ok: false, retry: true }; try { await logPush(gid9, 1, '違規清單群發', mem9) } catch (_) {} return { ok: true } })
      if (!r9 || r9.ok === false) return { ok: false, retry: true, error: 'LINE 發送失敗' }
      sent9.push('ABpeople 群')
    } else { // mgrs＝權限表「班表・編」有勾的人（含管理者），要綁定過才有 LINE；只發新殼指定的 rids
      const [pmN9, rosN9, bindN9] = await Promise.all([kvGet('sp_finance_pm_prep_perm'), kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_prep_bind')])
      const ppl9 = ((rosN9 || {}).people) || []
      const pickR = new Set((Array.isArray(a.rids) ? a.rids : []).map(String))
      let fail = 0
      for (const [rid9, u9] of Object.entries(((pmN9 || {}).users) || {})) {
        if (!pickR.has(String(rid9))) continue
        if (!u9.edit) continue
        if (!u9.admin && u9.tabs && u9.tabs.shift === 0) continue // 班表編沒勾=跳過
        let uid9 = (ppl9.find(p9 => p9.id === rid9) || {}).lineUserId
        if (!uid9) uid9 = (Object.values((bindN9 || {}).tokens || {}).find(t9 => (t9.rid || t9.uid) === rid9) || {}).uid
        if (!uid9) continue
        const r9 = await once(idem + ':' + rid9, async () => { const ok = await linePush(uid9, [{ type: 'text', text: txt9 + foot9(1) }]); if (!ok) return { ok: false, retry: true }; try { await logPush(uid9, 1, '違規清單私訊') } catch (_) {} return { ok: true } })
        if (r9 && r9.ok !== false) sent9.push(u9.name); else fail++
      }
      if (fail) return { ok: false, retry: true, error: '有人沒送到，稍後重試（已送到的人不會重收）' }
      if (!sent9.length) return { ok: false, retry: false, error: '找不到可通知的班表主管（要有班表編輯權＋綁定過 LINE）' }
    }
    return { ok: true, sent: sent9 }
  },
  async mailhub_op(a) { // 信箱中樞（新殼畫面 → 這裡執行；IMAP、密碼加解密只在 GD）：新殼已驗身分與主管資格；讀寫依資料歸屬走 GD 或新殼（_mailhubkv.js）
    const who = { name: String((a.who || {}).name || '').slice(0, 30), role: String((a.who || {}).role || ''), rid: String((a.who || {}).rid || '') }
    if (!who.name) return { ok: false, error: '缺操作者' }
    const { mailhubDispatch } = await import('./_mailhubop.js'); const { mhKv } = await import('./_mailhubkv.js')
    const kv = await mhKv(kvGet, kvSet, who.name)
    try { return await mailhubDispatch({ method: a.method === 'POST' ? 'POST' : 'GET', op: String(a.op || ''), q: a.q || {}, body: a.body || {}, who, kvGet: kv.kvGet, kvPut: kv.kvPut, guard: kv.guard }) }
    catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 300) } }
  },
  async inbox_op(a) { // 收件匣（新殼畫面 → 這裡執行；LINE 收發、AI、媒體簽名只在 GD）：新殼已驗身分；分派同 GD 舊頁（_inboxop.js）；讀寫依資料歸屬走 GD 或新殼
    const who = { name: String((a.who || {}).name || '').slice(0, 30), role: String((a.who || {}).role || ''), rid: String((a.who || {}).rid || '') }
    if (!who.name) return { ok: false, error: '缺操作者' }
    const { inboxDispatch } = await import('./_inboxop.js')
    try { return await inboxDispatch({ method: a.method === 'POST' ? 'POST' : 'GET', op: String(a.op || 'list'), q: a.q || {}, body: a.body || {}, who, origin: 'https://ground-pm.vercel.app', fromShell: true }) }
    catch (e) { return { ok: false, error: '收件匣暫時出錯：' + String(e && e.message || e).slice(0, 120) } }
  },
  async gorder_read(a) { return gorderRun(a, 'GET') }, // 團體訂餐讀（列表／單張／設定）：唯讀，不佔事件位
  async gorder_op(a) { return gorderRun(a, 'POST') }, // 團體訂餐寫（新殼畫面 → 這裡執行；LINE、發票、金流只在 GD）：走事件佔位（同一個 idem 只執行一次，新殼重送不會重發 LINE／重開發票）
  async points_read(a) { return pointsRun(a, 'GET') }, // 排行榜／積分規則／兌換紀錄／存摺讀：唯讀，不佔事件位
  async points_op(a) { return pointsRun(a, 'POST') }, // 積分規則／獎勵／兌換寫（新殼畫面 → 這裡執行；通知在 GD）：走事件佔位（同一個 idem 只執行一次）
  async points_drain(a) { const { ptsDrain } = await import('./_points.js'); return { ok: true, ...(await ptsDrain({ limit: Math.min(300, Number(a.limit) || 100) })) } }, // 積分補分佇列立即排空（拆閘門後呼叫）；唯讀路徑（重給本身依 ref 去重）
  async social_meta() { // 新殼行銷大師原生讀取用：GD 環境設定類旗標（不含任何金鑰）——Meta 有沒有設、AI 有沒有設、Graph 版本、哪幾個官方帳號有金鑰；唯讀
    const S = await import('./_social.js'); const IB = await import('./_inbox.js')
    return { ok: true, metaReady: S.metaReady(), aiReady: !!(process.env.ANTHROPIC_API_KEY || '').trim(), graphVersion: S.GV, configured: IB.ACCOUNTS.filter(IB.configured).map(a => a.key) }
  },
  async page_read(a) { return pageRun(a, 'GET') }, // 新殼 GD 頁面轉接：讀（唯讀）
  async page_write(a) { return pageRun(a, 'POST') }, // 新殼 GD 頁面轉接：寫（事件佔位，同一個 idem 只做一次）
  async board_read(a) { return boardRun(a, 'GET') }, // 新殼銷售數據頁：預測／停售清單／行事曆（唯讀）
  async board_write(a) { return boardRun(a, 'POST') }, // 新殼銷售數據頁寫入：轉 GD 原端點（事件佔位，同一個 idem 只做一次）
  async inline_read(a) { return inlineRun(a, 'GET') }, // inline 即時直搜（外部 inline 搜尋）：唯讀，不佔事件位
  async inline_op(a) { return inlineRun(a, 'POST') }, // inline 行動建議勾選／派任務、連假 AI 文案：走事件佔位（同一個 idem 只執行一次）
  async social_read(a) { return socialRun(a, 'GET') }, // 行銷大師讀（社群總覽／LINE 官方統計；統計 run=1 會順便抓一次，寫入本身版本比對）：唯讀路徑
  async social_op(a) { return socialRun(a, 'POST') }, // 行銷大師寫（草稿／審核／立即發布／素材／AI…；發文、AI、上傳在 GD）：走事件佔位（同一個 idem 只執行一次）
  async inbox_drain(a) { // 收件匣待補存佇列立即排空（切換拆閘門後呼叫；關卡 3 inbox 第一輪 B1）；唯讀路徑（套用本身判斷重複）
    const IB = await import('./_inbox.js'); return { ok: true, ...(await IB.ibRetry({ limit: Math.min(300, Number(a.limit) || 100) })) }
  },
  async inbox_quota(a) { // 新殼收件匣讀對話用：官方帳號本月額度（LINE 金鑰只在 GD；GD 端本來就暫存 60 秒）；唯讀
    const IB = await import('./_inbox.js'); const ac = IB.acctOf(String(a.acct || '')); if (!ac) return { ok: false, error: '沒有這個帳號' }
    return { ok: true, quota: await IB.quotaOf(ac).catch(() => ({})) }
  },
  async task_notify(a) { // 任務通知（新殼任務頁 → 這裡發；文字照抄 GD ?tasknotify，_tasknotify.js 共用）；新殼已驗任務編輯權限，a.actor＝操作者
    const { taskNotify } = await import('./_tasknotify.js')
    const r = await taskNotify(a, String(a.actor || '').slice(0, 30))
    return r.ok ? { ok: true, sent: r.sent } : { ok: false, retry: false, error: r.error }
  },
  async tn_groups() { // 新殼任務頁「通知發到哪個群」清單（同 mail-sync ?tngroups：DD 在的群真名）；唯讀
    const gl = (await ddAll()).groups
    return { ok: true, groups: gl.map(g => ({ gid: g.gid, label: g.label, tag: g.tag || '', preset: !!g.preset })), def: 'Cf7940efc6517b0c084ad2ad496b45f30' }
  },
  async anim_pref(a) { // 新殼任務頁個人動畫偏好（同 mail-sync ?animpref／?animprefset，資料在 GD perm 域 sp_finance_pm_prep_animpref）；新殼已驗身分，a.rid＝本人
    const rid = String(a.rid || '').slice(0, 80); if (!rid) return { ok: false, error: '缺身分' }
    if (a.op !== 'set') { const docA = (await kvGet('sp_finance_pm_prep_animpref')) || {}; return { ok: true, pref: docA[rid] || null } }
    const p = a.pref || {}
    const clean = { inView: p.inView !== false, noDone: p.noDone !== false, followReduce: p.followReduce !== false, allOff: !!p.allOff } // 欄位清洗照 GD ?animprefset
    try { await crewTx('sp_finance_pm_prep_animpref', (cur) => { const d = cur || {}; d[rid] = clean; return { write: true, doc: d } }, '動畫偏好', '動畫偏好') } catch (_) { return { ok: false, error: '存不進去，請稍後再試' } } // v4.71.196 權限域版本化寫（搬家後走新殼正本）
    return { ok: true }
  },
  async err_notify(a) { // App 錯誤回報（原 mail-sync ?errlog 當日首見通知，文字照抄）：DD 私訊審核人（名冊有 lineUserId 的在職者）；新殼 issues 域排
    if (a.ts && Date.now() - Date.parse(a.ts) > 23 * 3600e3) return { ok: true, skipped: 'expired' }
    if (!TK()) return { ok: true, skipped: 'no-token' } // 設定缺失＝不重試（留原因）
    const it = a.it || {}
    const [defE, rosterE] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
    const ppl = ((rosterE || {}).people || []) // 同原 ?errlog：不另外過濾在職（關卡 3 issues 第一輪獨立 Claude B2）
    const to = (((defE || {}).ground || {}).approvers || ['張良瑋']).map(an => ppl.find(p2 => p2 && p2.name === an && p2.lineUserId)).filter(Boolean)
    if (!to.length) return { ok: true, skipped: 'no-recipient' } // 沒有可私訊的審核人＝不重試（留原因）
    let n = 0
    // 逐人送；任一人送不出去＝丟錯讓新殼重試（LINE 重試鍵依事件＋收件人固定，已送到的人重試不會再收到一次）
    for (const ap of to) {
      if (await linePush(ap.lineUserId, [{ type: 'text', text: `🐞 App 錯誤回報\n頁面：${String(it.page || '?').slice(0, 60)}（v${String(it.ver || '?').slice(0, 20)}）\n${String(it.msg || '').slice(0, 300)}\n— ${String(it.by || '訪客').slice(0, 30)}・累計 ${Number(it.n) || 1} 次\n（同錯誤今天不再通知；細節問 DD 或看 /prep 錯誤日誌）` }])) n++
      else throw new Error('錯誤回報通知送不出去（' + ap.name + '），稍後重試')
    }
    return { ok: true, n }
  },
  async buy_group(a) { // 採購需求 → DD 自動訊息 buy 設定的群（原 ?buyadd，文字照抄；abgd 盤點／採購 F05～07）
    if (a.ts && Date.now() - Date.parse(a.ts) > 23 * 3600e3) return { ok: true, skipped: 'expired' }
    const cfgB = await ddGet('buy')
    if (!TK() || !cfgB.on) return { ok: true, skipped: true }
    const it = a.it || {}
    const gidB = await ddGroupGid(cfgB.group)
    const mem = await groupMembers(gidB)
    const media = Array.isArray(it.media) ? it.media : []
    const ok = await linePush(gidB, [{ type: 'text', text: ddFill(cfgB.text, { content: it.text || '（見附件）', by: it.by, url: (it.url ? '\n🔗 ' + it.url : '') + (media.length ? `・附${media.length}圖` : '') }) + await quotaFoot(mem) }], 'buy-add:' + (it.id || '') + ':' + gidB)
    return ok ? { ok: true, sent: true } : { ok: false, retry: true }
  },
  async low_stock(a) { // 盤點／包材低水位（原 joya-intraday 每日 11:00 場次，文字照抄）：ch='line' 發 DD 自動訊息 lowStock 群；ch='push' 全員推播（兩路分開排、各自重試）
    if (a.ts && Date.now() - Date.parse(a.ts) > 12 * 3600e3) return { ok: true, skipped: 'expired' } // 當天的提醒，隔太久就不發
    const cfgLS = await ddGet('lowStock')
    if (!cfgLS.on) return { ok: true, skipped: true }
    if (a.ch === 'push') { const n = await wpPush(null, { title: '📉 庫存低水位', body: String(a.names || ''), url: '/prep' }); return { ok: true, sent: !!n } } // 推播是盡力送（沒有訂閱者也算完成），重試最多造成重複一次
    if (!TK()) return { ok: false, retry: true }
    const gidLS = await ddGroupGid(cfgLS.group)
    const mem = await groupMembers(gidLS)
    const ok = await linePush(gidLS, [{ type: 'text', text: ddFill(cfgLS.text, { list: String(a.list || '') }) + await quotaFoot(mem) }], 'low-stock:' + (a.date || '') + ':' + gidLS)
    return ok ? { ok: true, sent: true } : { ok: false, retry: true }
  },
  async meet_nudge_group(a) { // 3 次沒簽→大群點名（DD 自動訊息 meet_nudge）
    const cfg = await ddGet('meet_nudge')
    if (!cfg.on || !TK()) return { ok: true, skipped: true }
    const gid = await ddGroupGid(cfg.group)
    const mem = await groupMembers(gid)
    const ok = await linePush(gid, [{ type: 'text', text: ddFill(cfg.text, { type: a.type, date: a.date, names: (a.names || []).join('、'), link: prepLink('meet=' + a.id) }) + await quotaFoot(mem) }])
    return ok ? { ok: true, sent: true } : { ok: false, retry: true }
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false })
  const sec = (process.env.BRIDGE_SECRET || '').trim()
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  const sig = String(req.headers['x-abgd-sig'] || '')
  const expect = sec ? crypto.createHmac('sha256', sec).update(raw).digest('base64url') : ''
  if (!sec || sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return res.status(401).json({ ok: false, error: '簽章不符' })
  let b; try { b = JSON.parse(raw) } catch (_) { return res.status(400).json({ ok: false }) }
  const fn = ACTIONS[b.action]
  if (!fn) return res.status(400).json({ ok: false, error: '未知動作 ' + b.action })
  const readOnly = b.action === 'dd_health' || b.action === 'dd_redrive' || b.action === 'dd_meta' || b.action === 'dd_query' || b.action === 'dd_chat_get' || b.action === 'dd_ai' || b.action === 'meet_meta' || b.action === 'fb_meta' || b.action === 'ai_call' || b.action === 'menu_ai_gen' || b.action === 'mailhub_op' || b.action === 'tn_groups' || b.action === 'anim_pref' || b.action === 'inbox_op' || b.action === 'inbox_quota' || b.action === 'inbox_drain' || b.action === 'gorder_read' || b.action === 'points_read' || b.action === 'points_drain' || b.action === 'social_read' || b.action === 'social_meta' || b.action === 'inline_read' || b.action === 'board_read' || b.action === 'page_read' // mailhub_op：寫入走自己的版本比對／命令收據，不用事件佔位
  if (readOnly) { try { return res.status(200).json({ ok: true, result: await fn(b.args || {}) }) } catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) }) } }
  if (!b.idem) return res.status(400).json({ ok: false, error: '缺 idem' })
  let c
  try { c = await claim(b.idem) } catch (e) { return res.status(200).json({ ok: false, retry: true, error: String(e?.message || e) }) }
  if (c === 'busy') return res.status(200).json({ ok: false, retry: true, error: '同一個事件正在處理中' })
  if (c.done !== undefined) return res.status(200).json({ ok: true, dup: true, result: c.done })
  try {
    const r = await ctx.run(b.idem, () => fn(b.args || {}, b.idem))
    if (r && r.ok === false) { await release(b.idem, c.tok); return res.status(200).json({ ok: false, retry: !!r.retry, result: r, error: '送出失敗' }) }
    try { await finish(b.idem, c.tok, r) } catch (_) { /* 已送出但完成紀錄沒寫上：回成功（不要讓新殼重送）；GD 佔位 5 分鐘後過期，若再收到同 idem，LINE 重試鍵會擋重送 */ }
    return res.status(200).json({ ok: true, result: r })
  } catch (e) {
    await release(b.idem, c.tok)
    return res.status(500).json({ ok: false, retry: true, error: String(e?.message || e).slice(0, 200) })
  }
}
