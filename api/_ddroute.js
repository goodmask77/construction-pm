// DD 搬家第 0 批（docs/ABGD_DD_PLAN.md v2，新殼 repo）：事件分類＋歸屬＋「只算不發」轉交
//   ddClassify(ev)：純函式，事件 → 路由名（第 0 批只用來記錄與比對；之後的批次依 sp_finance_pm_ddroutes.routes 決定 owner）
//   歸屬一次決定、寫在事件台帳 pm_ddev_<webhookEventId>（只新增）：第 0 批 owner 一律 gd
//   影子轉交：設定 sp_finance_pm_ddroutes.shadow===true 時，把「分類＋來源＋驗簽結果＋文字雜湊／長度」（不送原文）轉給新殼 /api/dd/enqueue（mode=shadow），新殼只算權限、不發不寫
import crypto from 'node:crypto'
// 正式站環境變數值前面帶「NAME=」（例：NEXT_PUBLIC_SUPABASE_URL=https://…），要剝掉（同 line-webhook.js clean；v4.71.199：沒剝＝網址解析失敗、整段靜默略過）
const cleanEnv = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = cleanEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).replace(/\/+$/, '')
const SB_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
const ABGD = (process.env.ABGD_BASE_URL || 'https://ab-gd.vercel.app').trim().replace(/\/+$/, '')
export const DD_ROUTE_VER = 1
// 長期記事本三條（照 line-webhook.js 1.5) 原式）
export const MEMO_LIST = /^(你記得(哪些|什麼|多少|啥)|你記住了(什麼|哪些|啥)?|你的?(記事本|長期記憶)|看記事本|記事本$)/
export const MEMO_FORGET = /^(忘記|忘掉|別記|不要記了?|刪(除|掉)記憶)[\s:：,，、]*(.+)/s
export const MEMO_REMEMBER = /^(記住|幫我記住?|幫我記一下|記一下|記個|備註一下?)[\s:：,，、]*(.+)/s
// GD 在 1.5) 之前就會接走的指令關鍵字（日誌、報到／登入、卡片指令、授權、轉給CC、素材庫、綁定、連結、緊急聯絡人、名冊、文件、文件庫、檔案庫）：帶到就一律 GD（保守）
// 第一輪 OpenAI A7：不再用開頭／結尾錨點近似 GD 條件——這些詞出現在句子任何位置就一律 GD（更保守；留 GD 的記事本寫入一樣經命令橋寫新殼正本）
const BEFORE_MEMO = /心得|日誌|補充|上班|下班|回饋|投票|推播|出勤|測試卡片|報到|登入|授權|轉給|轉告|交給|丟給|CC|素材庫|綁定|連結|確認|緊急聯絡人|名冊|文件|檔案庫|相簿|pinterest|pin\.it/i

export function ddClassify(ev) {
  const t = ev && ev.type
  if (t === 'unsend' || t === 'join' || t === 'leave' || t === 'follow' || t === 'unfollow' || t === 'memberJoined' || t === 'memberLeft') return t.toLowerCase()
  if (t === 'postback') { const d = String((ev.postback && ev.postback.data) || ''); if (/^cf\|/.test(d)) return 'pb_confirm'; if (/^pi\|/.test(d)) return 'pb_issue'; if (/^bd\|/.test(d)) return 'pb_bind'; if (/^tk\|/.test(d)) return 'tkcard'; return 'pb_card' }
  if (t !== 'message') return 'other'
  const m = ev.message || {}
  if (m.type === 'image' || m.type === 'file' || m.type === 'video') return 'media'
  if (m.type !== 'text') return 'msg_other'
  const s = String(m.text || '').trim()
  if (/^(心得|日誌|工作日誌)/.test(s)) return 'journal'
  if (/^(轉給|轉告|交給|丟給)\s*CC/i.test(s)) return 'cc'
  if (/綁定/.test(s)) return 'bind'
  if (/^(我的連結|個人連結|連結|登入|重新登入|登入碼|登入連結)$/.test(s) || /報到/.test(s)) return 'login'
  if (MEMO_LIST.test(s) || MEMO_FORGET.test(s) || MEMO_REMEMBER.test(s)) return 'memo' // 跟 GD 1.5) 長期記事本同一組正規式
  if (/密碼/.test(s) && /^(記|查|刪|密碼清單)/.test(s)) return 'vault'
  if (/^(確認|取消)$/.test(s) || /^DD\s*(確認|取消)$/i.test(s)) return 'confirm'
  if (/^(今日|今天)(的)?任務|^任務卡$/.test(s)) return 'todaycard' // 跟 GD 2.5) 今日任務卡同一條正規式
  if (/文件庫|檔案庫|相簿|存到|撈檔/.test(s)) return 'files'
  if (/^授權[:：]/.test(s)) return 'auth_code'
  return 'ai'
}

let cfgP = null
export async function ddRoutesCfg() { // 每個請求讀一次（模組層快取 30 秒；讀不到＝影子關）
  if (cfgP && cfgP.t > Date.now() - 30e3) return cfgP.v
  let v = {}
  try { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.sp_finance_pm_ddroutes&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(3000) }); if (!r.ok) console.log('[dd] 讀路由設定失敗', r.status); const rows = r.ok ? await r.json() : []; v = rows[0] && rows[0].data && rows[0].data.v ? JSON.parse(rows[0].data.v) : {} } catch (e) { console.log('[dd] 讀路由設定失敗', e && e.message); v = {} }
  cfgP = { t: Date.now(), v }; return v
}

export function ddSigHeaders(method, path, body) { // 同新殼 lib/dd/sign.ts：方法＋路徑＋時間戳＋一次性編號＋body 雜湊
  const ts = String(Date.now()), nonce = crypto.randomBytes(18).toString('base64url')
  const base = [method.toUpperCase(), path, ts, nonce, crypto.createHash('sha256').update(body).digest('hex')].join('\n')
  const sig = crypto.createHmac('sha256', (process.env.BRIDGE_SECRET || '').trim()).update(base).digest('base64url')
  return { 'content-type': 'application/json', 'x-dd-ts': ts, 'x-dd-nonce': nonce, 'x-dd-kid': 'b1', 'x-dd-sig': sig }
}

// 影子轉交：失敗只記 log（影子不影響正式處理）；最多等 2.5 秒
// onSel：抽樣一決定就立刻回報結果（在送出之前；不用等轉交送完），呼叫端在同一個請求內交給 ddShadowReport，兩邊同一個值；沒決定到＝呼叫端自己補 undefined
export async function ddShadow(ev, route, sigOK, onSel) {
  let sel
  const until = Date.now() + 4000; const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 4000) // v4.71.211 整體期限 4 秒（讀設定＋送出共用；關卡 7b 第三輪 A5）
  try {
    const eid = String(ev.webhookEventId || '')
    if (!eid || !(process.env.BRIDGE_SECRET || '').trim()) return
    let rt; const cfg = await Promise.race([ddRoutesCfg(), new Promise((res) => { rt = setTimeout(() => res(null), Math.max(1, until - Date.now())) })]); clearTimeout(rt)
    if (!cfg || cfg.shadow !== true) { if (cfg && !Object.keys(cfg).length) console.log('[dd] 影子略過：路由設定是空的（讀不到？）'); return }
    const txt = ev.type === 'message' && ev.message && ev.message.type === 'text' ? String(ev.message.text || '') : ''
    const s = ev.source || {}
    const body = JSON.stringify({ eventId: eid, mode: 'shadow', route, payload: { source: { type: s.type, userId: s.userId, groupId: s.groupId, roomId: s.roomId }, sigOK, gdRoute: route, type: ev.type, aiShadow: (sel = route === 'ai' && shadowPick(eid, aiPct(cfg)), (typeof onSel === 'function' && onSel(sel)), sel), textLen: txt.length, textHash: txt ? shadowHash(eid, '_text', txt) : '' } }) // v4.71.211 文字雜湊改金鑰化＋綁事件編號（原本裸 sha256 短句可猜；關卡 7b 第二輪 A1）
    const r = await fetch(ABGD + '/api/dd/enqueue', { method: 'POST', headers: ddSigHeaders('POST', '/api/dd/enqueue', body), body, signal: ac.signal })
    if (!r.ok) console.log('[dd] 影子轉交失敗', r.status); else console.log('[dd] 影子轉交 ok', eid.slice(-6), route) // 只記狀態碼
  } catch (e) { console.log('[dd] 影子轉交失敗', e && e.name) } finally { clearTimeout(tm) }
  return sel
}

// v4.71.211 批 7b：AI 對話影子回報——GD 回答時（第 0 輪）實際用的每段資料「字數＋金鑰化雜湊」與權限，交給新殼跟它自己組的同一批比；不送原文
//   雜湊＝HMAC-SHA256，子金鑰＝HKDF(BRIDGE_SECRET, "dd-shadow-hash-v1")（同新殼 lib/dd/ai/shadowhash.ts）；輸入 "v1\n事件\n段名\n原文"，取 32 碼
//   抽樣：設定 aiPct（預設 100）；同一個判斷用在影子轉交（帶 aiShadow）與回報，兩邊選同一批；逾時 1.5 秒、失敗只記狀態碼
let _shk = null
const shKey = () => { const sec = (process.env.BRIDGE_SECRET || '').trim(); if (!sec) throw new Error('沒有 BRIDGE_SECRET：影子停用'); return (_shk ||= Buffer.from(crypto.hkdfSync('sha256', Buffer.from(sec, 'utf8'), Buffer.alloc(0), Buffer.from('dd-shadow-hash-v1', 'utf8'), 32))) } // 空金鑰一律停用（不產生人人算得出的值）
export const shadowHash = (eid, sec, text) => crypto.createHmac('sha256', shKey()).update(`v1\n${eid}\n${sec}\n${text}`, 'utf8').digest('hex').slice(0, 32)
export function shadowPick(eid, pct) { if (!(pct > 0)) return false; if (pct >= 100) return true; return parseInt(crypto.createHmac('sha256', shKey()).update(`pick\n${eid}`, 'utf8').digest('hex').slice(0, 8), 16) % 100 < pct }
const aiPct = (cfg) => (Number.isFinite(Number(cfg.aiPct)) ? Number(cfg.aiPct) : 100)
// 回報：整體期限 1.5 秒（含讀設定與送出；到期就放棄，不拖 webhook）；抽樣不在這裡判斷——入口（ddShadow）判一次、新殼以那次為準（母體＝被選中的）
export async function ddShadowReport(eventId, scope, sec, t, selP) { // selP＝同一個請求裡入口抽樣結果的承諾（抽樣一決定就完成）
  const until = Date.now() + 1500
  const left = () => Math.max(1, until - Date.now())
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 1500)
  try {
    const eid = String(eventId || '')
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(eid) || !(process.env.BRIDGE_SECRET || '').trim() || !sec) return
    let rt; const cfg = await Promise.race([ddRoutesCfg(), new Promise((res) => { rt = setTimeout(() => res(null), left()) })]); clearTimeout(rt); if (!cfg || cfg.shadow !== true) return
    const out = {}; for (const [k, txt] of Object.entries(sec)) out[k] = { n: String(txt || '').length, h: shadowHash(eid, k, String(txt || '')) }
    let st; const selV = selP != null ? await Promise.race([Promise.resolve(selP).catch(() => undefined), new Promise((res) => { st = setTimeout(() => res(undefined), left()) })]) : undefined; if (st) clearTimeout(st) // 同步傳 false 也算入口有結果
    if (selP != null && typeof selV !== 'boolean') { console.log('[dd] 影子回報略過：入口抽樣到期前沒決定'); return } // 入口有轉交但沒在期限內決定＝這次不送（不自己重算，免得跟入口不同）
    const sel = typeof selV === 'boolean' ? selV : shadowPick(eid, aiPct(cfg)) // 入口那次的結果；只有入口根本沒轉交（例：重送不是第一次）才用同一個函式算
    const body = JSON.stringify({ eventId: eid, report: { v: 2, round: 0, sel, scope: { moneyOK: scope.moneyOK === true, secretOK: scope.secretOK === true, canAct: scope.canAct === true, isDM: scope.isDM === true }, sec: out, t: { a: Math.round(Number(t && t.a) || 0), b: Math.round(Number(t && t.b) || 0) } } })
    const r = await fetch(ABGD + '/api/dd/shadow-report', { method: 'POST', headers: ddSigHeaders('POST', '/api/dd/shadow-report', body), body, signal: ac.signal })
    if (!r.ok) console.log('[dd] 影子回報失敗', r.status)
  } catch (e) { console.log('[dd] 影子回報失敗', e && e.name) } finally { clearTimeout(tm) }
}

// ── 批 1：歸屬決定＋正式轉交（docs/ABGD_DD_PLAN.md v2.1 一節）──
//   ddOwner：路由在設定 routes 裡開了、且符合 GD 原本走到該處理的條件（例：今日任務卡＝私訊＋操作者＋驗簽成功），才歸新殼；其餘一律 GD
//   歸新殼的事件：台帳首次寫入就帶可重建的轉交內容 p＋fwd:'pending'；轉交成功改 fwd:'ok'；失敗留 pending 由每 5 分鐘保溫排程補送（30 分鐘後放棄並私訊老闆）
//   GD 永遠不替歸新殼的事件做業務（交出去不收回）
const GATES = {
  todaycard: async (ev, sigOK, ctx) => ev.source && ev.source.type === 'user' && sigOK === true && !!(await ctx.operators())[ev.source.userId || ''],
  // v4.71.202 文件庫查詢（批 4，唯讀）：私訊＋驗簽成功＋只收「文件庫」或「看／查／打開／列出 文件庫（有哪些／資料夾／清單）」——
  //   刻意很窄：GD 的「文件 姓名」（/^文件\s*\S{2,10}\s*$/）會先接走「文件庫資料夾」這類說法；帶傳／發／送／撈或存／放／上傳／收／歸＝存檔撈檔（留 GD）
  files: async (ev, sigOK) => {
    if (!(ev.source && ev.source.type === 'user' && sigOK === true)) return false
    const t = String((ev.message && ev.message.text) || '').trim()
    return t === '文件庫' || /^(看|查|打開|列出)\s*文件庫\s*(有哪些|資料夾|清單)?\s*[？?]?$/.test(t)
  },
  // v4.71.204 問題回報審核按鈕（批 6）：私訊＋驗簽成功＋「pi|回報編號|go／hold／del」＋問題回報正本在新殼（sop 域）——
  //   審核資格由新殼依正本判斷（GD 原本就把這種按鈕轉成新殼命令，這批改成整個事件交給新殼）
  pb_issue: async (ev, sigOK) => {
    if (!(ev.type === 'postback' && ev.source && ev.source.type === 'user' && sigOK === true)) return false
    if (!/^pi\|[A-Za-z0-9_-]{1,80}\|(go|hold|del)$/.test(String((ev.postback && ev.postback.data) || ''))) return false
    const { abgdOwner } = await import('./_abgdkv.js')
    return (await abgdOwner('sp_finance_pm_sop_issues')) === 'abgd'
  },
  // v4.71.203 團隊任務卡按鈕（批 5）：私訊＋驗簽成功＋按鈕資料是「tk|動作|團|任務編號（|選項）」＋操作者＋團隊任務正本在新殼（tasks 域）——
  //   其他空間（工程／夥伴／財務）的任務還在 GD，照舊；動作只收 GD 卡片會產生的那幾種
  tkcard: async (ev, sigOK, ctx) => {
    if (!(ev.type === 'postback' && ev.source && ev.source.type === 'user' && sigOK === true)) return false
    const d = String((ev.postback && ev.postback.data) || '')
    if (!/^tk\|(done|d1|pick|del|del2|keep|urg|cat|cat2|own|own2)\|團\|[^|]+(\|[^|]*)?$/.test(d)) return false
    if (!(await ctx.operators())[ev.source.userId || '']) return false
    const { abgdOwner } = await import('./_abgdkv.js')
    return (await abgdOwner('sp_team_pm_task_x')) === 'abgd'
  },
  // 轉給CC：私訊＋操作者且名字含「張良」（同 GD 原條件）＋驗簽成功＋句首轉給／轉告／交給／丟給 CC＋沒帶到報到／登入（報到流程會先接走）＋CC 收件匣正本已在新殼
  cc: async (ev, sigOK, ctx) => {
    if (!(ev.source && ev.source.type === 'user' && sigOK === true)) return false
    const t = String((ev.message && ev.message.text) || '').trim()
    if (!/^(?:轉給|轉告|交給|丟給)\s*CC[:：,，\s]*([\s\S]*)$/i.test(t) || /報到|登入/.test(t)) return false
    const op = (await ctx.operators())[ev.source.userId || '']
    if (!op || !/張良/.test(op.name || '')) return false
    const { abgdOwner } = await import('./_abgdkv.js')
    return (await abgdOwner('pm_cc_inbox')) === 'abgd'
  },
  // v4.71.217 AI 私訊（批 7c-3b）：私訊＋驗簽成功＋文字＋分類是 ai（ddClassify 沒被其他指令接走）＋沒帶到 GD 在 AI 之前會接走的關鍵字（BEFORE_MEMO；
  //   10-17 盤點：對綁定非操作者，GD 在 AI 前的攔截全是看文字、沒有會吃掉任意文字的等待狀態，且都被 BEFORE_MEMO 涵蓋）＋在切換集合內＋不在維護時段＋不是操作者（集合只收綁定非操作者，這裡再擋一次）
  ai: async (ev, sigOK, ctx) => {
    if (!(ev.type === 'message' && ev.source && ev.source.type === 'user' && sigOK === true)) return false
    const m = ev.message || {}; if (m.type !== 'text') return false
    const t = String(m.text || '').trim(); if (!t || BEFORE_MEMO.test(t)) return false
    const cfg = await ddRoutesCfg()
    if (cfg.aiMaint === true || !ddAiInSet(cfg, ev.source.userId)) return false
    if ((await ctx.operators())[ev.source.userId || '']) return false
    return true
  },
  // 記事本：私訊＋操作者＋驗簽成功＋三條其一＋沒有帶到前面指令的關鍵字＋記事本正本已在新殼（pm_bot_memory 歸屬＝abgd）
  memo: async (ev, sigOK, ctx) => {
    if (!(ev.source && ev.source.type === 'user' && sigOK === true)) return false
    const t = String((ev.message && ev.message.text) || '').trim()
    if (BEFORE_MEMO.test(t)) return false
    const mF = t.match(MEMO_FORGET), mR = mF ? null : t.match(MEMO_REMEMBER)
    if (!(MEMO_LIST.test(t) || (mF && (mF[3] || '').trim()) || (mR && (mR[2] || '').trim()))) return false
    if (!(await ctx.operators())[ev.source.userId || '']) return false
    const { abgdOwner } = await import('./_abgdkv.js')
    return (await abgdOwner('pm_bot_memory')) === 'abgd'
  },
}
// v4.71.217 DD 搬家 7c-3b：AI 私訊切換集合（設定 sp_finance_pm_ddroutes.aiSet＝{convs:['dm_U…'], epoch, at}；維護時段腳本寫入）
export function ddAiInSet(cfg, userId) { const set = cfg && cfg.aiSet; return !!(set && typeof set === 'object' && Array.isArray(set.convs) && typeof userId === 'string' && /^U[0-9a-f]{32}$/.test(userId) && set.convs.includes('dm_' + userId)) }
export async function ddOwner(ev, route, sigOK, ctx) {
  try {
    const cfg = await ddRoutesCfg()
    if (!cfg.routes || cfg.routes[route] !== true || !GATES[route]) return 'gd'
    return (await GATES[route](ev, sigOK, ctx)) ? 'abgd' : 'gd'
  } catch (_) { return 'gd' } // 判斷不了＝GD 照舊（還沒交出去，GD 做是安全的）
}
export function ddRunPayload(ev, route, sigOK) {
  const s = ev.source || {}, m = ev.message || {}
  return { route, sigOK, type: ev.type, source: { type: s.type, userId: s.userId, groupId: s.groupId, roomId: s.roomId }, text: m.type === 'text' ? String(m.text || '').slice(0, 5000) : '', messageType: m.type || '', replyToken: ev.replyToken || '', replyBefore: Number(ev.timestamp || Date.now()) + 50e3, postback: ev.postback ? { data: String(ev.postback.data || ''), params: ev.postback.params || null } : null, ts: Number(ev.timestamp || Date.now()) }
}
export async function ddForward(eventId, payload) {
  const body = JSON.stringify({ eventId, mode: 'run', route: payload.route, payload })
  try {
    const r = await fetch(ABGD + '/api/dd/enqueue', { method: 'POST', headers: ddSigHeaders('POST', '/api/dd/enqueue', body), body, signal: AbortSignal.timeout(8000) })
    const j = await r.json().catch(() => ({}))
    return !!(r.ok && j.ok)
  } catch (_) { return false }
}
const LH = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' })
export async function ddLedgerGet(eventId) {
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent('pm_ddev_' + String(eventId).slice(0, 120))}&select=data,updated_at`, { headers: LH(), signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error('讀事件台帳失敗 ' + r.status)
  const rows = await r.json(); const v = rows[0] && rows[0].data && rows[0].data.v; const u = rows[0] && rows[0].updated_at
  if (!rows.length) return null // 沒有這列＝沒有紀錄
  if (!v) return { o: '?', bad: 1 } // 有列卻沒內容＝壞（關卡第二輪 OpenAI A2）
  if (v === '1') return { o: 'gd', _u: u } // 舊格式＝GD
  let j = null; try { j = JSON.parse(v) } catch (_) { return { o: '?', bad: 1 } }
  const ok = j && typeof j === 'object' && !Array.isArray(j) && (j.o === 'gd' || (j.o === 'abgd' && ['pending', 'ok', 'giveup', 'gaveup'].includes(j.fwd) && (j.fwd !== 'pending' || (j.p && typeof j.p === 'object' && j.p.route))))
  return ok ? { ...j, _u: u } : { o: '?', bad: 1 } // 壞掉＝不認歸屬（呼叫端不處理、記錯誤）
}
// 轉交狀態只往前：pending→ok／giveup（放棄、通知待送）→gaveup（通知已送）；條件更新＝updated_at 相同＋內容仍是原狀態（關卡 OpenAI A3／第二輪 A5）；回 true＝這次真的改到
const NEXT = { pending: ['ok', 'giveup'], giveup: ['gaveup'] }
export async function ddLedgerMark(eventId, fwd) {
  const cur = await ddLedgerGet(eventId); if (!cur || cur.o !== 'abgd' || !(NEXT[cur.fwd] || []).includes(fwd)) return false
  const from = cur.fwd // 狀態比對靠 JSON.stringify 不帶空白的格式（台帳只由這支程式寫）
  const u0 = cur._u; const next = { ...cur, fwd, fwdAt: Date.now() }; delete next._u; if (fwd === 'ok') delete next.p // 送到了就不留內容
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent('pm_ddev_' + String(eventId).slice(0, 120))}&updated_at=eq.${encodeURIComponent(u0)}&data->>v=like.*%22fwd%22:%22${from}%22*`, { method: 'PATCH', headers: { ...LH(), Prefer: 'return=representation' }, body: JSON.stringify({ data: { v: JSON.stringify(next) }, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(5000) })
  if (!r.ok) return false
  return ((await r.json().catch(() => [])) || []).length === 1
}
// 補送：每 5 分鐘（line-webhook ?warm=1）掃還沒送到的；超過 30 分鐘放棄＋私訊老闆一次
// 補送：新殼排程經 GD 代發口 dd_redrive 呼叫（簽章；不掛公開網址）；照更新時間排、整批預算（每筆開始前檢查，單筆轉交最長 8 秒）；
//   超過 30 分鐘：pending→giveup（搶到的那次才通知）→ 通知送出（固定重試鍵＝同一事件只會一則）→ gaveup；通知失敗留 giveup，下一輪再通知（第二輪 OpenAI A5）
export async function ddRedrive(notify, budgetMs = 12e3) {
  const t0 = Date.now(), out = { tried: 0, ok: 0, gaveup: 0, oldest: 0 }
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.pm_ddev_*&or=(data->>v.like.*%22fwd%22:%22pending%22*,data->>v.like.*%22fwd%22:%22giveup%22*)&select=id,data&order=updated_at.asc&limit=50`, { headers: LH(), signal: AbortSignal.timeout(8000) })
  if (!r.ok) return { ...out, error: r.status }
  for (const row of await r.json()) {
    if (Date.now() - t0 > budgetMs) break
    let v = {}; try { v = JSON.parse(row.data.v) } catch (_) { continue }
    const eid = row.id.slice('pm_ddev_'.length), age = Date.now() - (v.t || 0)
    const msg = `⚠️ DD 有一則訊息轉給新版 30 分鐘都沒送到（${v.c}），已放棄，請 CC 查 pm_ddev_${eid}`
    if (v.fwd === 'giveup') { if (await notify(msg, eid)) { await ddLedgerMark(eid, 'gaveup'); out.gaveup++ } continue }
    out.oldest = Math.max(out.oldest, Math.round(age / 1000))
    if (!v.p || age < 20e3) continue
    if (age > 30 * 60e3) { if (await ddLedgerMark(eid, 'giveup') && await notify(msg, eid)) { await ddLedgerMark(eid, 'gaveup'); out.gaveup++ } continue }
    out.tried++
    if (await ddForward(eid, v.p)) { await ddLedgerMark(eid, 'ok'); out.ok++ }
  }
  return out
}
