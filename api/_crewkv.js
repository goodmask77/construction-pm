// 夥伴名冊／人資／打卡讀寫層（v4.71.187 abgd 搬家 B 模式；張良 10-16 選 A＝只搬人資月檔＋打卡＋補卡）
//   crew 域（搬新殼）：sp_crew_pm_hr_*（NUEiP 出勤／班表月檔、薪資、人資主檔 master、在職名單、遲到通知去重）、sp_crew_pch_*（打卡一筆一份）、sp_finance_pm_punch_makeup（補卡）
//   crewapp 域（留 GD）：sp_crew_kb_roster（名冊：角色／停權／LINE 綁定＝GD 每個請求的權限判斷）、sp_finance_pm_hr_idlock（身分證欄名單）——等新殼有自己的登入時跟權限／身分一起搬
//   兩類都走同一套版本比對寫（情境內讀到的版本、寫回比對）；各自依歸屬選路（每類一個讀寫物件）
//   ① crewRun(op, fn)：執行情境——mail-sync／_onboard 的 kvGet／kvPut／kvSet 碰到這些鍵＝版本化讀寫；撞版本整段重做（最多 5 次），前提：fn 在寫入前沒有對外動作
//   ② crewTx(key, mutate, editor, op)：有對外動作（DD 回覆、LINE）的流程用——每次重讀最新、mutate(cur) 回 { write, doc, value }、撞版本只重做這一步
//   情境外：讀照舊讀 GD 副本；寫一律拒絕（漏包就會露出來）
import { AsyncLocalStorage } from 'node:async_hooks'
import { abgdKv } from './_abgdkv.js'
export const CREW_RE = /^(sp_crew_kb_roster|sp_crew_pm_hr_|sp_crew_pch_|sp_finance_pm_hr_idlock|sp_finance_pm_punch_makeup|sp_finance_pm_prep_(perm|tabs|fav|hide|animpref|bind|logincode)$)/ // 這層管的全部鍵（四類；v4.71.196 加權限 perm、身分 identity）
const APP_RE = /^(sp_crew_kb_roster|sp_finance_pm_hr_idlock)/ // crewapp：名冊、身分證欄名單
const PERM_RE = /^sp_finance_pm_prep_(perm|tabs|fav|hide|animpref)$/ // perm：權限名單、分頁名稱、常用清單、預做隱藏、動畫偏好
const IDN_RE = /^sp_finance_pm_prep_(bind|logincode)$/ // identity：GD 綁定 token、4 位數登入碼
const cls = (id) => APP_RE.test(String(id)) ? 'app' : PERM_RE.test(String(id)) ? 'perm' : IDN_RE.test(String(id)) ? 'idn' : 'crew'
const KV_OF = { app: ['crewapp', 'sp_crew_kb_roster', '夥伴名冊'], perm: ['perm', 'sp_finance_pm_prep_perm', '權限設定'], idn: ['identity', 'sp_finance_pm_prep_bind', '登入綁定'], crew: ['crew', 'sp_crew_pm_hr_master', '夥伴名冊'] }
const newKv = (op, c) => { const [domain, lockKey, label] = KV_OF[c] || KV_OF.crew; return abgdKv({ domain, lockKey, operator: String(op || label).slice(0, 30), label, versioned: true }) }
// 權限／身分類（GD 每個請求的權限判斷都讀 GD 副本）：新殼正本寫成功後，等 GD 副本也變成這份內容才回（最多 8 秒；新殼命令寫完立刻反推）——停權／解除綁定按完＝GD 已擋得住；等不到＝留紀錄照回成功（每分鐘排程補）
const AUTH_RE = /^(sp_crew_kb_roster|sp_finance_pm_hr_idlock|sp_finance_pm_prep_(perm|bind|logincode)$)/
// 正式站環境變數值前面帶「NAME=」（例：NEXT_PUBLIC_SUPABASE_URL=https://…），要剝掉（同 line-webhook.js clean；v4.71.199：沒剝＝網址解析失敗、整段靜默略過）
const cleanEnv = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = cleanEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).replace(/\/+$/, '')
const SB_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o }, {}) : x)
// 等不到 GD 副本的次數：只算「這次操作」自己的寫入（crewLagWatch 包起來的那段；關卡 3 auth 第二輪 Gemini 2／OpenAI B3：不用全域計數，別人的延遲不會算到你頭上）
const lagAls = new AsyncLocalStorage()
export async function crewLagWatch(fn) { const st = { lag: 0 }; const v = await lagAls.run(st, fn); return { v, lag: st.lag > 0 } }
export async function awaitGdCopy(id, doc, ms = 5000) { // 5 秒（第二輪 Gemini 4：一次操作最多寫三份，8 秒×3 太久）
  const want = stable(doc), t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(Math.max(500, Math.min(3000, ms - (Date.now() - t0)))) }); const rows = r.ok ? await r.json() : []; const v = rows[0] && rows[0].data && rows[0].data.v; if (v != null && stable(JSON.parse(v)) === want) return true } catch (_) {}
    await sleep(400)
  }
  const st = lagAls.getStore(); if (st) st.lag++
  console.log('[crewkv] GD 副本 5 秒內沒追上（排程會補）', id); return false
}
const afterPut = async (k, id, obj) => { if (k && k.mode === 'abgd' && AUTH_RE.test(String(id))) await awaitGdCopy(id, obj) }
const als = new AsyncLocalStorage()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
export async function crewRun(op, fn) {
  if (als.getStore()) return fn()
  for (let i = 0; ; i++) {
    try { return await als.run({ op: String(op || '夥伴名冊').slice(0, 30), kv: {} }, fn) }
    catch (e) { if (i >= 4 || !(e && e.code === 'stale')) throw e; await sleep(150 + Math.random() * 400) }
  }
}
async function ctxKv(id) { const st = als.getStore(); if (!st) return null; const c = cls(id); if (!st.kv[c]) st.kv[c] = newKv(st.op, c); return st.kv[c] }
export const crewInCtx = () => !!als.getStore()
export function crewSetOp(name) { const st = als.getStore(); if (st && !st.kv.crew && name) st.op = String(name).slice(0, 30) } // 新殼那類還沒建讀寫物件前才改得到（權限判斷先讀名冊＝GD 那類，不影響）
export async function crewHookGet(id) { const k = await ctxKv(id); return k ? k.kvGet(id) : undefined }
export async function crewHookPut(id, obj, editor) {
  const k = await ctxKv(id)
  if (k) { await k.kvPut(id, obj, editor || '夥伴名冊'); await afterPut(k, id, obj); return true }
  console.log('[crewkv] 情境外寫入被拒', id, editor)
  const e = new Error('夥伴名冊寫入要在情境裡（程式漏包了）：' + id); e.code = 'nocrew'; throw e
}
export async function crewTx(key, mutate, editor, op) {
  for (let i = 0; i < 8; i++) {
    const kv = await newKv(op || editor, cls(key))
    const cur = await kv.kvGet(key)
    const res = await mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    try { await kv.kvPut(key, res.doc, editor || '夥伴名冊'); await afterPut(kv, key, res.doc); return res.value } catch (e) { if (!(e && e.code === 'stale')) throw e }
    await sleep(100 + Math.random() * 300)
  }
  const e = new Error('夥伴名冊一直有人同時在改，這次沒存進去，請再試一次'); e.code = 'commitfail'; throw e
}
// 依前綴列出（打卡逐筆）：情境內走同一個版本化物件（新殼＝引擎；GD＝原表）；回 undefined＝不在情境（呼叫端照舊讀 GD 副本）
export async function crewHookPrefix(pf) { const k = await ctxKv(pf); return k ? k.kvPrefix(pf) : undefined }
// 刪一份（打卡後台刪除、LINE 打卡退回）：情境外拒絕
export async function crewHookDel(id) {
  if (cls(id) !== 'crew') { const e = new Error('名冊／權限／身分是核心資料，不准整份刪除：' + id); e.code = 'nodel'; throw e } // 關卡 3 auth 第一輪 OpenAI B3
  const k = await ctxKv(id)
  if (k) { await k.kvDel(id); return true }
  const e = new Error('夥伴名冊刪除要在情境裡（程式漏包了）：' + id); e.code = 'nocrew'; throw e
}
