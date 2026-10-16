// 夥伴名冊／人資／打卡域（crew，v4.71.187 abgd 搬家 B 模式）：sp_crew_kb_roster（名冊）、sp_crew_pm_hr_*（NUEiP 出勤／班表月檔、薪資、人資主檔 master、員工、通知去重）、
//   sp_crew_pch_*（打卡一筆一份）、sp_finance_pm_hr_idlock（身分證欄名單）、sp_finance_pm_punch_makeup（補打卡）
//   寫入：依歸屬走 GD 或新殼、一律版本比對寫
//   ① crewRun(op, fn)：執行情境——mail-sync／_onboard 的 kvGet／kvPut／kvSet 碰到這些鍵＝同一個版本化讀寫物件（讀到的版本、寫回比對）；撞版本整段重做（最多 5 次），前提：fn 在寫入前沒有對外動作
//   ② crewTx(key, mutate, editor, op)：有對外動作（DD 回覆、LINE）的流程用——每次重讀最新、mutate(cur) 回 { write, doc, value }、撞版本只重做這一步
//   情境外：讀照舊讀 GD 副本；寫一律拒絕（漏包就會露出來）
import { AsyncLocalStorage } from 'node:async_hooks'
import { abgdKv } from './_abgdkv.js'
export const CREW_RE = /^(sp_crew_kb_roster|sp_crew_pm_hr_|sp_crew_pch_|sp_finance_pm_hr_idlock|sp_finance_pm_punch_makeup)/
const newKv = (op) => abgdKv({ domain: 'crew', lockKey: 'sp_crew_kb_roster', operator: String(op || '夥伴名冊').slice(0, 30), label: '夥伴名冊', versioned: true })
const als = new AsyncLocalStorage()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
export async function crewRun(op, fn) {
  if (als.getStore()) return fn()
  for (let i = 0; ; i++) {
    try { return await als.run({ op: String(op || '夥伴名冊').slice(0, 30), kvP: null }, fn) }
    catch (e) { if (i >= 4 || !(e && e.code === 'stale')) throw e; await sleep(150 + Math.random() * 400) }
  }
}
async function ctxKv() { const st = als.getStore(); if (!st) return null; if (!st.kvP) st.kvP = newKv(st.op); return st.kvP }
export const crewInCtx = () => !!als.getStore()
export function crewSetOp(name) { const st = als.getStore(); if (st && !st.kvP && name) st.op = String(name).slice(0, 30) }
export async function crewHookGet(id) { const k = await ctxKv(); return k ? k.kvGet(id) : undefined }
export async function crewHookPut(id, obj, editor) {
  const k = await ctxKv()
  if (k) { await k.kvPut(id, obj, editor || '夥伴名冊'); return true }
  console.log('[crewkv] 情境外寫入被拒', id, editor)
  const e = new Error('夥伴名冊寫入要在情境裡（程式漏包了）：' + id); e.code = 'nocrew'; throw e
}
export async function crewTx(key, mutate, editor, op) {
  for (let i = 0; i < 8; i++) {
    const kv = await newKv(op || editor)
    const cur = await kv.kvGet(key)
    const res = await mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    try { await kv.kvPut(key, res.doc, editor || '夥伴名冊'); return res.value } catch (e) { if (!(e && e.code === 'stale')) throw e }
    await sleep(100 + Math.random() * 300)
  }
  const e = new Error('夥伴名冊一直有人同時在改，這次沒存進去，請再試一次'); e.code = 'commitfail'; throw e
}
// 依前綴列出（打卡逐筆）：情境內走同一個版本化物件（新殼＝引擎；GD＝原表）；回 undefined＝不在情境（呼叫端照舊讀 GD 副本）
export async function crewHookPrefix(pf) { const k = await ctxKv(); return k ? k.kvPrefix(pf) : undefined }
// 刪一份（打卡後台刪除、LINE 打卡退回）：情境外拒絕
export async function crewHookDel(id) {
  const k = await ctxKv()
  if (k) { await k.kvDel(id); return true }
  const e = new Error('夥伴名冊刪除要在情境裡（程式漏包了）：' + id); e.code = 'nocrew'; throw e
}
