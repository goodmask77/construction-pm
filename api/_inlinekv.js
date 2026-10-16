// inline 訂位資料域（inline，v4.71.175 abgd 搬家 B 模式）：原始資料＝訂位月檔 sp_finance_pm_inline_YYYY-MM、總覽 sp_finance_pm_inline、當日備註 _notes、行動建議狀態 _actst
//   衍生快取（顧客分段 cs_、新回名單 nr_、洞察 insights、索引 custidx、電話索引 ph3_、近期展望 outlook、提醒紀錄 alerts）＝inlinecache 域，留 GD（GD 排程從原始資料重算；最長鍵頭歸屬）
//   寫入：依歸屬走 GD 或新殼、一律版本比對寫（撞版本重讀重算，最多 8 次）；月檔每天各記觀測戳記 obsD；總覽的遠期清單、備註、每月統計各帶觀測戳記
import { abgdKv } from './_abgdkv.js'
const newKv = (op) => abgdKv({ domain: 'inline', lockKey: 'sp_finance_pm_inline', operator: String(op || 'inline同步').slice(0, 30), label: 'inline 訂位資料', versioned: true })
export async function inlTx(key, mutate, editor, op) {
  for (let i = 0; i < 8; i++) {
    const kv = await newKv(op || editor)
    const cur = await kv.kvGet(key)
    const res = mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    try { await kv.kvPut(key, res.doc, editor || 'inline同步'); return res.value } catch (e) { if (!(e && e.code === 'stale')) throw e }
    await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
  }
  const e = new Error('inline 訂位資料一直有人同時在改，這次沒存進去'); e.code = 'commitfail'; throw e
}
export async function inlGet(key, op) { return (await newKv(op)).kvGet(key) }
// 月檔逐日套用（純函式）：dayVals＝{ 日期: 這批抓到的訂位陣列（空陣列＝那天沒訂位／遠期已消失＝刪掉那天） }；文件裡那天的觀測比這批新＝那天不動
//   回 value＝套用後的月統計（寫或不寫都回，呼叫端拿去更新總覽）
export function applyInlineDays(cur, { dayVals, obsT, stat, now = new Date().toISOString() }) {
  const doc = cur ? { ...cur, days: { ...(cur.days || {}) }, obsD: { ...(cur.obsD || {}) } } : { days: {}, obsD: {} }
  let n = 0
  for (const [d, arr] of Object.entries(dayVals)) {
    if (doc.obsD[d] && doc.obsD[d] > obsT) continue
    if (arr && arr.length) doc.days[d] = arr; else delete doc.days[d]
    doc.obsD[d] = obsT; n++
  }
  if (!n) return { write: false, value: stat(doc) }
  doc.updatedAt = now
  return { write: true, doc, value: stat(doc) }
}
// 總覽合併（純函式）：months[月] 帶 at（那次月檔寫入的觀測戳記），較新的才換；遠期清單 farFuture／當日備註 dayNotes 帶 farAt／notesAt，較新的才換；lastSync 取大
export function mergeSum(cur, { months, far, notes, lastSync }) {
  const s = { firstDay: '2021-02-10', months: {}, ...(cur || {}) }
  s.months = { ...(s.months || {}) }
  for (const [mo, st] of Object.entries(months || {})) { const o = s.months[mo]; if (!o || !o.at || String(st.at) >= String(o.at)) { if (st.del) delete s.months[mo]; else { const { del, ...x } = st; s.months[mo] = x } } }
  if (far && (!s.farAt || String(far.at) >= String(s.farAt))) { s.farFuture = far.list; s.farAt = far.at }
  if (notes && (!s.notesAt || String(notes.at) >= String(s.notesAt))) { s.dayNotes = notes.dayNotes; s.notesAt = notes.at }
  if (lastSync && String(lastSync) > String(s.lastSync || '')) s.lastSync = lastSync
  return s
}
