// 阿桑同步資料域（boss，v4.71.172 abgd 搬家 B 模式）：sp_finance_pm_boss_*（不含交接異常 boss_inc_＝incidents 域、物料分類 boss_matcat＝matlib 域；最長鍵頭歸屬）
//   寫入者只有 boss-sync；依資料歸屬走 GD 或新殼、一律版本比對寫（撞版本重讀重算，最多 8 次）
//   月檔：每天各記觀測戳記 obsD（applyDays，跟交接異常同一份算法）；快照：整份記 obsAt；狀態檔：結尾重讀最新再合併（mergeState）
import { abgdKv } from './_abgdkv.js'
const newKv = (op) => abgdKv({ domain: 'boss', lockKey: 'sp_finance_pm_boss_state', operator: String(op || '阿桑同步').slice(0, 30), label: '阿桑同步資料', versioned: true })
export async function bossTx(key, mutate, editor, op) {
  for (let i = 0; i < 8; i++) {
    const kv = await newKv(op || editor)
    const cur = await kv.kvGet(key)
    const res = mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    try { await kv.kvPut(key, res.doc, editor || '阿桑同步'); return res.value } catch (e) { if (!(e && e.code === 'stale')) throw e }
    await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
  }
  const e = new Error('阿桑同步資料一直有人同時在改，這次沒存進去'); e.code = 'commitfail'; throw e
}
export async function bossGet(key, op) { return (await newKv(op)).kvGet(key) }

// 月檔逐日套用（純函式）：只動「文件裡那天沒有觀測、或那天的觀測比這批舊」的日子；同一筆改日期時原本那天不可寫＝新那天也不動（連鎖傳到不再變）
//   days：這批涵蓋的日子（增量窗＝窗∩本月每一天；回填＝這批有資料的日子）；byRows：本月這批的列 {主鍵: 列}；df：取列日期；allowDelete：窗內沒再出現＝來源已刪
export function applyDays(cur, { days, byRows, df, allowDelete, obsT, now = new Date().toISOString() }) {
  const doc = cur ? { ...cur, rows: { ...(cur.rows || {}) }, obsD: { ...(cur.obsD || {}) } } : { rows: {}, obsD: {} }
  const ok = new Set(days.filter(d => !(doc.obsD[d] && doc.obsD[d] > obsT)))
  for (let chg = true; chg;) { chg = false; for (const [k, r] of Object.entries(byRows)) { const old = doc.rows[k]; const d0 = old && df(old), d1 = df(r); if (d0 && d0 !== d1 && !ok.has(d0) && ok.has(d1)) { ok.delete(d1); chg = true } } }
  if (!ok.size) return { write: false }
  if (allowDelete) for (const [k, r] of Object.entries(doc.rows)) { if (ok.has(df(r)) && !byRows[k]) delete doc.rows[k] }
  for (const [k, r] of Object.entries(byRows)) if (ok.has(df(r))) doc.rows[k] = r
  for (const d of ok) doc.obsD[d] = obsT
  doc.updatedAt = now
  return { write: true, doc }
}
// 快照（整份覆蓋）：文件裡的觀測比這批新＝不寫
export function applySnap(cur, { rows, pk, obsT, now = new Date().toISOString() }) {
  if (cur && cur.obsAt && cur.obsAt > obsT) return { write: false }
  return { write: true, doc: { rows: Object.fromEntries(rows.map(r => [pk(r), r])), updatedAt: now, count: rows.length, obsAt: obsT } }
}
// 同步狀態合併（結尾重讀最新再合併，兩次執行重疊時不互蓋）：
//   res 每個端點取 at 較新的；bf（回填進度）先比世代 bfGen（手動「歷史回填重啟」會加世代），同世代 done 最大、否則日期大的；auth401 取大的；rot／lastRun／rcpSnap 用這次的
export function mergeState(cur, mine) {
  const c = cur || {}, out = { ...c, ...mine, res: { ...(c.res || {}) }, bf: { ...(c.bf || {}) }, bfGen: { ...(c.bfGen || {}) } }
  for (const [s, r] of Object.entries(mine.res || {})) { const o = out.res[s]; if (!o || String(r && r.at || '') >= String(o.at || '')) out.res[s] = r }
  const rank = (v) => (v === 'done' ? '9999-99-99' : String(v || ''))
  for (const s of new Set([...Object.keys(c.bf || {}), ...Object.keys(mine.bf || {})])) {
    const gc = Number((c.bfGen || {})[s]) || 0, gm = Number((mine.bfGen || {})[s]) || 0
    const vc = (c.bf || {})[s], vm = (mine.bf || {})[s]
    if (gc > gm) { out.bf[s] = vc; out.bfGen[s] = gc } else if (gm > gc) { out.bf[s] = vm; out.bfGen[s] = gm } else { out.bf[s] = rank(vm) >= rank(vc) ? vm : vc; if (gc) out.bfGen[s] = gc }
    if (out.bf[s] == null) delete out.bf[s]
  }
  if (String(c.auth401 || '') > String(mine.auth401 || '')) out.auth401 = c.auth401
  return out
}
