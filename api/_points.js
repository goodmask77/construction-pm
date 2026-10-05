// ── 🏦 積分中樞共用模組（張良 2026-10-06）──
// 抽出來讓 mail-sync（排行榜/規則/回饋/SOP/簽收/回報）與 punch（打卡）等端點共用同一套給分邏輯，
// 避免 punch 靜態 import 整包 mail-sync（含 imapflow 等）造成循環/冷啟負擔。KV 走 _onboard（與 mail-sync 同 data.v 格式）。
import { kvGet, kvSet } from './_onboard.js'

// 行為分規則預設（可被 sp_finance_pm_points_cfg.behavior 覆寫/增刪；cap=每人每天上限，0=不限只用 ref 去重）
export const POINTS_DEFAULT = {
  punch: { label: '打卡上班', pts: 2, cap: 1 },
  fb_give: { label: '交每日回饋', pts: 3, cap: 3 },
  sop_done: { label: '完成 SOP 一條', pts: 1, cap: 0 },
  meet_ack: { label: '簽收會議宣達', pts: 2, cap: 0 },
  journal: { label: '交工作日誌', pts: 2, cap: 3 },
  issue_report: { label: '回報問題', pts: 3, cap: 0 },
  inv_count: { label: '完成盤點', pts: 3, cap: 1 },
}
// 預設 ∪ 自訂（自訂可覆寫 pts/cap/label、加 off 關閉、加新動作）
export function pointsRules(cfg) {
  const o = {}
  for (const k of Object.keys(POINTS_DEFAULT)) o[k] = { ...POINTS_DEFAULT[k] }
  const cu = (cfg && cfg.behavior) || {}
  for (const k of Object.keys(cu)) o[k] = { ...(o[k] || {}), ...cu[k] }
  return o
}
// 給行為分一筆。person=姓名、act=規則key、ref=去重鍵（同人同動作同 ref 只給一次）
export async function awardPts(person, act, ref) {
  try {
    if (!person || person === '匿名') return false
    const cfg = await kvGet('sp_finance_pm_points_cfg')
    const rule = pointsRules(cfg)[act]
    if (!rule || rule.off || !(Number(rule.pts) > 0)) return false
    const doc = (await kvGet('sp_finance_pm_points')) || { list: [], carry: {} }
    doc.list = doc.list || []; doc.carry = doc.carry || {}
    const dnow = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    if (ref && doc.list.find(e => e.person === person && e.act === act && e.ref === ref)) return false
    const cap = Number(rule.cap) || 0
    if (cap > 0 && doc.list.filter(e => e.person === person && e.act === act && e.date === dnow).length >= cap) return false
    doc.list.push({ id: 'pt' + Date.now().toString(36) + '_' + doc.list.length, person, date: dnow, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16), type: 'behavior', act, pts: Number(rule.pts), ref: ref || '' })
    if (doc.list.length > 40000) { const cut = doc.list.splice(0, doc.list.length - 40000); for (const e of cut) doc.carry[e.person] = (doc.carry[e.person] || 0) + Number(e.pts || 0) } // 滾出窗口的折進 carry，總累積不失真
    await kvSet('sp_finance_pm_points', doc)
    return true
  } catch (_) { return false }
}
