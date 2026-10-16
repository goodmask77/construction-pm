// 異常通知域（v4.71.158 abgd 搬家 B 模式）：阿桑交接異常月檔 sp_finance_pm_boss_inc_YYYYMM、AB 停售 sp_finance_pm_absoldout
//   依資料歸屬走 GD 或新殼、一律版本比對寫；incTx(key, mutate, editor)：每次重讀最新 → mutate(cur) 回 { write, doc, value } → 寫；撞版本重讀重做（最多 8 次）
import { abgdKv } from './_abgdkv.js'
const newKv = (op) => abgdKv({ domain: 'incidents', lockKey: 'sp_finance_pm_boss_inc_', operator: String(op || '異常通知').slice(0, 30), label: '異常通知', versioned: true })
export async function incTx(key, mutate, editor, op) {
  for (let i = 0; i < 8; i++) {
    const kv = await newKv(op || editor)
    const cur = await kv.kvGet(key)
    const res = mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    try { await kv.kvPut(key, res.doc, editor || '異常通知'); return res.value } catch (e) { if (!(e && e.code === 'stale')) throw e }
    await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
  }
  const e = new Error('異常通知資料一直有人同時在改，這次沒存進去'); e.code = 'commitfail'; throw e
}
export async function incGet(key, op) { return (await newKv(op)).kvGet(key) }
