// 活動紀錄（各空間 *pm_activity：最新在前、留 200 筆）安全追加（v4.71.203，DD 批 5 關卡 3 第一輪 OpenAI A3）
//   原本每個寫入點都「讀整包→加一筆→寫整包」，同時寫會互相蓋掉；改成版本比對寫入（pm_doc_get／pm_doc_cas），撞版本重讀重做
//   條目可帶 id（同 id 只記一次：重送不重記）；整份依 ts 新到舊排序（晚送到的舊事件不會插到最前面）
//   actMerge：給舊任務頁整包存用——頁面送來的跟現有的合併，不覆蓋掉伺服器端剛追加的
import { SB_URL, svc } from './_onboard.js'

const MAX = 200
const sig = (e) => (e && e.id) ? 'id:' + e.id : JSON.stringify([e && e.ts, e && e.user, e && e.action, e && e.detail])
export function actMerge(cur, incoming) {
  const seen = new Set(), out = []
  for (const e of [...(Array.isArray(incoming) ? incoming : []), ...(Array.isArray(cur) ? cur : [])]) { if (!e || typeof e !== 'object') continue; const k = sig(e); if (seen.has(k)) continue; seen.add(k); out.push(e) }
  // 依真的時間比（有沒有毫秒都一樣）；時間壞掉＝一律排在有效時間後面（第三輪 OpenAI 低項）；同時間或都壞＝保持原順序
  const tOf = (e) => { const t = Date.parse(String(e.ts || '')); return Number.isNaN(t) ? null : t }
  const cmp = (a, b) => { const x = tOf(a[0]), y = tOf(b[0]); if (x === null && y === null) return a[1] - b[1]; if (x === null) return 1; if (y === null) return -1; return (y - x) || (a[1] - b[1]) }
  return out.map((e, i) => [e, i]).sort(cmp).map((x) => x[0]).slice(0, MAX)
}
// 網路錯誤／逾時不丟例外，一律當「沒存上」回 false（關卡 3 第二輪 Gemini）
const safe = (p) => p.catch(() => ({ ok: false, status: 0, json: async () => null }))
const rpc = (f, b) => safe(fetch(`${SB_URL}/rest/v1/rpc/${f}`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(8000) }))
// 回 true＝已存（或本來就有同 id）；false＝存不上（呼叫端決定要不要重試）
export async function actAppend(key, entries, editor = 'actlog') {
  if (!Array.isArray(entries)) return false
  for (let i = 0; i < 6; i++) {
    const g = await rpc('pm_doc_get', { p_id: key }); if (!g.ok) return false
    const d = await g.json().catch(() => null)
    if (!d || !d.data) { // 還不存在：只新增（已存在＝409，回頭重讀）
      const r = await safe(fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id: key, data: { v: JSON.stringify(actMerge([], entries)) }, editor }), signal: AbortSignal.timeout(8000) }))
      if (r.ok) return true
      if (r.status !== 409) return false
      continue
    }
    let cur; try { cur = JSON.parse(d.data.v || '[]') } catch (_) { return false } // 壞資料不覆蓋
    if (!Array.isArray(cur)) return false
    const next = actMerge(cur, entries)
    if (JSON.stringify(next) === JSON.stringify(cur)) return true // 同 id 已在、沒變＝不用寫
    const u = await rpc('pm_doc_cas', { p_id: key, p_rev: d.rev, p_data: { v: JSON.stringify(next) }, p_editor: editor })
    if (!u.ok) return false
    const j = await u.json().catch(() => null)
    if (j && j.ok) return true
    if (!j || !j.conflict) return false
    await new Promise((res) => setTimeout(res, 80 + Math.random() * 250))
  }
  return false
}
