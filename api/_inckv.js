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
// 觀測戳記：抓來源之前取；ISO 時間＋隨機尾碼（同毫秒兩次觀測也分得出先後，字串比大小；關卡 3 OpenAI 第二輪 A2）
export const obsStamp = () => new Date().toISOString() + '|' + Math.random().toString(36).slice(2, 10).padEnd(8, '0')
// AB 停售狀態比對寫（排程 joya-intraday 與手動掃描 ?abscan 共用一份算法）：每次重做都對「最新那份」重算，回傳只取最後成功那次的結果
//   nowSo：這次看到的停售品名 {名:1}；obs：抓清單前取的觀測戳記（文件裡的較新＝不寫、回 null）；day：今天；stamp：記在 current 的時間字樣
//   manual＝手動掃描：沒變化也寫（記今天基準），回 { added, removed, current, changed }；排程：有變化才寫（每天首輪落基準），有變化才回結果（呼叫端據此發群）
export function soldoutApply(cur, { nowSo, obs, day, hm, stamp, manual }) {
  if (cur && cur.obsAt && cur.obsAt > obs) return manual ? { write: false, value: { skipped: '已有較新的掃描結果', current: cur.current || {}, added: [], removed: [] } } : { write: false, value: null }
  const doc = cur ? { ...cur, current: { ...(cur.current || {}) }, log: [...(cur.log || [])], obsAt: obs } : { current: {}, log: [], obsAt: obs }
  const prev = doc.current
  const added = Object.keys(nowSo).filter(n => !(n in prev)), removed = Object.keys(prev).filter(n => !(n in nowSo))
  if (added.length || removed.length) {
    doc.current = Object.fromEntries(Object.keys(nowSo).map(n => [n, prev[n] || stamp]))
    added.forEach(n => { doc.current[n] = stamp; doc.log.unshift({ d: day, t: hm, n, op: '停售' }) })
    removed.forEach(n => doc.log.unshift({ d: day, t: hm, n, op: '恢復' }))
    doc.log = doc.log.slice(0, 300)
    if (manual) doc.day = day
    return { write: true, doc, value: { added, removed, current: doc.current } }
  }
  if (manual) { doc.day = day; return { write: true, doc, value: { added, removed, current: doc.current } } }
  if (!doc.day || doc.day !== day) { doc.day = day; return { write: true, doc, value: null } } // 每天首輪落個檔（沒變化也記狀態基準）
  return { write: false, value: null }
}
export async function soldoutTx(opts, editor) { return incTx('sp_finance_pm_absoldout', (cur) => soldoutApply(cur, opts), editor) }
export async function incGet(key, op) { return (await newKv(op)).kvGet(key) }
