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
//   回 value＝套用後的月統計＋月檔寫入流水號 seq（每次寫入 +1，版本比對保證遞增；總覽用 seq 比新舊，不用抓取時間——關卡 3 inline 第一輪 A1）
export function applyInlineDays(cur, { dayVals, obsT, stat, now = new Date().toISOString() }) {
  const doc = cur ? { ...cur, days: { ...(cur.days || {}) }, obsD: { ...(cur.obsD || {}) } } : { days: {}, obsD: {} }
  const seq0 = Number(cur && cur.wseq) || 0
  let n = 0
  for (const [d, arr] of Object.entries(dayVals)) {
    if (doc.obsD[d] && doc.obsD[d] > obsT) continue
    if (arr && arr.length) doc.days[d] = arr; else delete doc.days[d]
    doc.obsD[d] = obsT; n++
  }
  if (!n) return { write: false, value: { ...stat(doc), seq: seq0 } }
  doc.updatedAt = now; doc.wseq = seq0 + 1
  return { write: true, doc, value: { ...stat(doc), seq: doc.wseq } }
}
// 總覽合併（純函式）：months[月] 帶 seq（月檔寫入流水號），比總覽裡那個月的 seq（含刪掉月份留下的墓碑 monthsGone）新或一樣才換；
//   遠期清單 farFuture／當日備註 dayNotes 帶 farAt／notesAt，較新的才換；lastSync 取大
export function mergeSum(cur, { months, far, notes, lastSync }) {
  const s = { firstDay: '2021-02-10', months: {}, ...(cur || {}) }
  s.months = { ...(s.months || {}) }; s.monthsGone = { ...(s.monthsGone || {}) }
  for (const [mo, st] of Object.entries(months || {})) {
    const o = s.months[mo], have = Math.max(o && o.seq != null ? Number(o.seq) : -1, s.monthsGone[mo] != null ? Number(s.monthsGone[mo]) : -1)
    if (Number(st.seq) < have) continue // 較舊的月檔狀態不蓋（包括已被較新一輪刪掉的月份）
    const { del, ...x } = st
    if (del) { delete s.months[mo]; s.monthsGone[mo] = Number(st.seq) } else { s.months[mo] = x; delete s.monthsGone[mo] }
  }
  if (far && (!s.farAt || String(far.at) >= String(s.farAt))) { s.farFuture = far.list; s.farAt = far.at }
  if (notes && (!s.notesAt || String(notes.at) >= String(s.notesAt))) { s.dayNotes = notes.dayNotes; s.notesAt = notes.at }
  if (lastSync && String(lastSync) > String(s.lastSync || '')) s.lastSync = lastSync
  return s
}
