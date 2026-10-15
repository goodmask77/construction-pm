// 社群（行銷大師）讀寫層（v4.71.146 abgd 搬家 B 模式）：社群域的文件（sp_finance_pm_social_*、sp_finance_pm_pinterest、sp_finance_pm_lineoa_*）
//   依資料歸屬走 GD 或新殼、一律版本比對寫（撞版本＝丟 stale）；其他鍵（綁定、名冊、權限、活動紀錄）照舊經 mail-sync 讀寫 GD。
//   用法：社群各檔原本 import { kvGet, kvPut } from './mail-sync.js' → 改從這裡 import（同名、同參數）
//   socRun(op, fn)：一次請求／排程用一個讀寫物件（版本號只在這次有效），撞版本整段重做最多 5 次——前提：重做前沒有對外動作
//   socTx(key, mutate, editor)：對外動作（發文、上傳、AI 生圖）之後的寫入：每次新開讀寫物件重讀最新、mutate(cur) 回 { write, doc, value }，撞版本只重做這一步
import { AsyncLocalStorage } from 'node:async_hooks'
import { kvGet as gdGet, SB_URL, svc } from './_onboard.js' // 其他鍵：輕量讀寫（社群程式原本只用到 mail-sync 的通用讀寫，不必整包載入）
async function gdPut(id, obj, editor) { const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: String(editor || '社群').slice(0, 60), updated_at: new Date().toISOString() }) }); if (!r.ok) { try { const tx = await r.text(); console.log('[socialkv] 寫入失敗', id, r.status, tx.slice(0, 160)) } catch (_) {} } return r.ok } // 同 mail-sync kvPut：失敗回 false
import { abgdKv } from './_abgdkv.js'
export const SOC_RE = /^sp_finance_pm_(social_|pinterest|lineoa)/
const als = new AsyncLocalStorage()
const newKv = (op) => abgdKv({ domain: 'social', lockKey: 'sp_finance_pm_social_posts', operator: String(op || '社群').slice(0, 30), label: '社群', versioned: true })
async function kv() { const st = als.getStore(); if (st && st.kv) return st.kv; const k = await newKv(st && st.op); if (st) st.kv = k; return k }
export async function kvGet(id) { if (!SOC_RE.test(String(id))) return gdGet(id); return (await kv()).kvGet(id) } // 社群鍵讀失敗會丟錯（不當成「沒有」）
export async function kvPut(id, v, editor) { if (!SOC_RE.test(String(id))) return gdPut(id, v, editor); await (await kv()).kvPut(id, v, editor || '社群'); return true } // 社群鍵寫失敗會丟錯（撞版本＝code stale）
const isStale = (e) => !!(e && e.code === 'stale')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
export async function socRun(op, fn) {
  if (als.getStore()) return fn() // 已在情境內（巢狀呼叫）：沿用外層
  for (let i = 0; ; i++) {
    try { return await als.run({ op: String(op || '社群').slice(0, 30), kv: null }, fn) }
    catch (e) { if (i >= 4 || !isStale(e)) throw e; await sleep(150 + Math.random() * 400) }
  }
}
export async function socTx(key, mutate, editor, op) {
  const st = als.getStore()
  for (let i = 0; i < 8; i++) {
    const k = await newKv(op || (st && st.op))
    const cur = await k.kvGet(key)
    const res = mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    try { await k.kvPut(key, res.doc, editor || '社群'); return res.value } catch (e) { if (!isStale(e)) throw e }
    await sleep(100 + Math.random() * 300)
  }
  const e = new Error('社群資料一直有人同時在改，這次的結果沒存進去，請重新整理後再確認'); e.code = 'commitfail'; throw e
}
// 對外動作前先問切換驗收閘門（GD 正本＝放行、切換中＝擋、新殼正本＝看閘門）
export async function socGate() { const st = als.getStore(); const k = await newKv(st && st.op); if (k.mode === 'gd') return null; if (k.mode !== 'abgd') return '社群正在切換，請稍後再試'; return k.gate() }
