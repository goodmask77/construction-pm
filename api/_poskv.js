// 銷售數據域（pos，v4.71.186 abgd 搬家 B 模式）：sp_finance_pm_pos（每日總表）、_pos_d_／_pos_tx_／_pos_q_／_pos_q_ab_／_pos_hh_／_pos_void_ 月日檔、
//   _pos_flags／_pos_idlecfg／_pos_slotex、_ab_hh_／_ab_hhrev_、_ablive、_fc_（預測快照、設定）、_eats_sess、_heat_hide、_twhol_（行事曆快取）
//   人改的四份（_pos_hidden／alias／prices／costs）＝posmeta 域，已在新殼；_pos_flags／_pos_idlecfg＝posapp 域（只有主 App 能改，留 GD）——最長鍵頭歸屬，都不在這裡
//   寫入：依歸屬走 GD 或新殼、一律版本比對寫；posTx(key, mutate, editor)：每次重讀最新 → mutate(cur) 回 { write, doc, value } → 寫；撞版本重讀重做（最多 8 次）
import { AsyncLocalStorage } from 'node:async_hooks'
import { abgdKv } from './_abgdkv.js'
export const POS_RE = /^sp_finance_pm_(pos(?!_(hidden|alias|prices|costs|flags|idlecfg)$)|ab_hh|ablive|fc|eats_sess|heat_hide|twhol_)/ // 不含 posmeta 四份、posapp 兩份（主 App 品項標記、沒賣預警設定留 GD）
const newKv = (op) => abgdKv({ domain: 'pos', lockKey: 'sp_finance_pm_pos', operator: String(op || '銷售數據').slice(0, 30), label: '銷售數據', versioned: true })
export async function posTx(key, mutate, editor, op) {
  for (let i = 0; i < 8; i++) {
    const kv = await newKv(op || editor)
    const cur = await kv.kvGet(key)
    const res = await mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    try { await kv.kvPut(key, res.doc, editor || '銷售數據'); return res.value } catch (e) { if (!(e && e.code === 'stale')) throw e }
    await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
  }
  const e = new Error('銷售數據一直有人同時在改，這次沒存進去'); e.code = 'commitfail'; throw e
}
export async function posGet(key, op) { return (await newKv(op)).kvGet(key) }
// 整份覆蓋（沒有讀改寫依賴的：連線 cookie、即時快照、行事曆快取）：重讀最新版本號再寫，撞版本重做
export async function posPut(key, doc, editor, op) { return posTx(key, () => ({ write: true, doc }), editor, op) }

// 執行情境（同 _socialkv socRun）：posRun(op, fn) 裡 mail-sync 的 kvGet／kvPut 碰到銷售數據鍵＝走同一個版本化讀寫物件（讀到的版本、寫回時比對）；
//   撞版本＝整段 fn 重做（最多 5 次）——前提：fn 在寫入前沒有對外動作（這些同步只讀外部資料：收信、喬亞、Eats365）；巢狀呼叫沿用外層
const als = new AsyncLocalStorage()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
export async function posRun(op, fn) {
  if (als.getStore()) return fn()
  for (let i = 0; ; i++) {
    try { return await als.run({ op: String(op || '銷售數據').slice(0, 30), kv: null }, fn) }
    catch (e) { if (i >= 4 || !(e && e.code === 'stale')) throw e; await sleep(150 + Math.random() * 400) }
  }
}
async function ctxKv() { const st = als.getStore(); if (!st) return null; if (!st.kvP) st.kvP = newKv(st.op); st.kv = await st.kvP; return st.kv } // 共用同一個初始化（同情境並行讀寫也只有一個讀寫物件；關卡 3 pos 第一輪 B1）
// 給 mail-sync kvGet 用：情境內＝依歸屬版本化讀（記版本）；情境外＝回 undefined（呼叫端照舊讀 GD 副本，看板類讀取不繞新殼）
export async function posHookGet(id) { const k = await ctxKv(); return k ? k.kvGet(id) : undefined }
// 給 mail-sync kvPut 用：情境內＝比對讀到的版本寫（撞版本丟 stale 讓 posRun 重做）；情境外＝拒絕（讀改寫若不在情境裡，「重讀版本再寫」會拿舊內容蓋掉別人；關卡 3 pos 第一輪 A1）
export async function posHookPut(id, obj, editor) {
  const k = await ctxKv()
  if (k) { await k.kvPut(id, obj, editor || '銷售數據'); return true }
  console.log('[poskv] 情境外寫入被拒', id, editor)
  const e = new Error('銷售數據寫入要在同步情境裡（程式漏包了）：' + id); e.code = 'nopos'; throw e
}
export const posInCtx = () => !!als.getStore()
// 確認身分後把這次的操作者改成本人（讀寫物件還沒建才改；驗收閘門只認驗收者本人；同 _socialkv socSetOp）
export function posSetOp(name) { const st = als.getStore(); if (st && !st.kvP && name) st.op = String(name).slice(0, 30) }
