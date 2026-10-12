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

// ── 🏆 積分總表（排行榜 lb 口＋DD 積分段落共用同一套算法；張良 2026-10-12「DD 又抓不到資料（我現在有多少積分）」治本）──
// 之前算法只活在 mail-sync 的 lb 口，DD 的資料包根本沒有「積分」這個資料域 → 問積分一律「沒資料」。
// 現在抽成純函式：排行榜頁與 DD 兩邊都呼叫這裡，同一個人在兩邊看到的數字保證同一套算法（資料一致鐵則）。
export const FACETS = ['專業', '品質', '團隊', '負責', '創新']
// 輸入：issDoc=sp_finance_pm_sop_issues、catsDoc=sp_team_pm_data（任務分類）、taskRows=Supabase pm_documents sp_team_pm_task_* 原始列、
//       ptsDoc=sp_finance_pm_points（行為分流水帳）、names=要保證上榜的人（GD 全員，沒分=0）
// 輸出：rank（排名用 total＝發現+解決+任務+行為，不含兌換）、stars5（五面向之星）、taskBreak（每人任務分拆解）、
//       balance（可用點＝含兌換負值）、behavMonth（本月行為分）、month、list（事件列，已標 findAvg/fixAvg）
export function computePointsBoard({ issDoc, catsDoc, taskRows, ptsDoc, names } = {}) {
  const list = ((issDoc || {}).list || []).slice(0, 60)
  const board = {}
  const P = (nm) => board[nm] || (board[nm] = { name: nm, findPts: 0, fixPts: 0, nFind: 0, nFix: 0, fc: {} })
  for (const x of list) {
    for (const aspect of ['find', 'fix']) {
      if (aspect === 'fix' && x.status !== 'done') continue // 待審不計
      const target = aspect === 'find' ? x.by : x.doneBy
      if (!target || target === '匿名') continue
      const p = P(target)
      if (aspect === 'find') p.nFind++; else p.nFix++
      const st = (x.stars || {})[aspect] || {}
      let all = []
      for (const f of FACETS) {
        const vs = Object.values(st[f] || {}).map(Number).filter(v => v >= 1)
        if (vs.length) { const fo = p.fc[f] || (p.fc[f] = { sum: 0, n: 0 }); fo.sum += vs.reduce((a, b) => a + b, 0); fo.n += vs.length; all = all.concat(vs) }
      }
      const evAvg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0 // 該事件該面的整體星平均
      if (aspect === 'find') p.findPts += evAvg; else p.fixPts += evAvg
      x[aspect + 'Avg'] = all.length ? Math.round(evAvg * 10) / 10 : null
    }
  }
  ;(Array.isArray(names) ? names : []).forEach(nm => { if (nm) P(nm) }) // GD 全員上榜（沒分=0）
  // ⭐ 任務積分（360 制度）：已完成任務的 pts 按負責人加總
  const tpMap = {}, taskBreak = {}
  try {
    const catMap = {}; (Array.isArray(catsDoc) ? catsDoc : (catsDoc && catsDoc.list) || []).forEach(c => { if (c && c.id) catMap[c.id] = String(c.name || '').slice(0, 30) })
    for (const row of (Array.isArray(taskRows) ? taskRows : [])) {
      let t9 = null; try { t9 = JSON.parse(typeof row.data?.v === 'string' ? row.data.v : JSON.stringify(row.data?.v)) } catch (_) {}
      if (t9 && t9.status === 'done' && t9.owner && Number(t9.pts) > 0) {
        tpMap[t9.owner] = (tpMap[t9.owner] || 0) + Number(t9.pts)
        ;(taskBreak[t9.owner] = taskBreak[t9.owner] || []).push({ title: String(t9.title || t9.name || '任務').slice(0, 60), pts: Number(t9.pts), date: String(t9.doneAt || t9.updatedAt || '').slice(0, 10), cat: (t9.catId && catMap[t9.catId]) || '領養代替購買' })
      }
    }
    Object.keys(taskBreak).forEach(nm => taskBreak[nm].sort((a, b) => b.pts - a.pts))
    Object.keys(tpMap).forEach(nm => P(nm))
  } catch (_) {}
  // 🏦 行為分（統一流水帳）：總累積＝carry+窗內、本月＝當月；兌換(type redeem)不讓排名掉；可用餘額 balance＝全部加總(含兌換負值)
  const pd = ptsDoc || { list: [], carry: {} }
  const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
  const behavTotal = { ...(pd.carry || {}) }, behavMonth = {}, balance = { ...(pd.carry || {}) }
  for (const e of (pd.list || [])) {
    const v = Number(e.pts || 0)
    balance[e.person] = (balance[e.person] || 0) + v
    if (e.type !== 'redeem') {
      behavTotal[e.person] = (behavTotal[e.person] || 0) + v
      if (String(e.date || '').slice(0, 7) === month && e.type === 'behavior') behavMonth[e.person] = (behavMonth[e.person] || 0) + v
    }
  }
  Object.keys(behavTotal).forEach(nm => P(nm)); Object.keys(balance).forEach(nm => P(nm))
  const r1 = (v) => Math.round(v * 10) / 10
  const rank = Object.values(board).map(p => ({
    name: p.name, nFind: p.nFind, nFix: p.nFix,
    findPts: r1(p.findPts), fixPts: r1(p.fixPts),
    taskPts: r1(tpMap[p.name] || 0),
    behavPts: r1(behavTotal[p.name] || 0),
    behavMonth: r1(behavMonth[p.name] || 0),
    balance: r1(balance[p.name] || 0), // 可用點（扣過兌換）
    qualPts: r1(p.findPts + p.fixPts + (tpMap[p.name] || 0)), // 品質分合計（發現+解決+任務）
    total: r1(p.findPts + p.fixPts + (tpMap[p.name] || 0) + (behavTotal[p.name] || 0)), // 排名用＝累積賺得(不含兌換)
    facets: Object.fromEntries(FACETS.map(f => [f, p.fc[f] ? { avg: r1(p.fc[f].sum / p.fc[f].n), n: p.fc[f].n } : null])),
  })).sort((a, b) => b.total - a.total || (b.nFind + b.nFix) - (a.nFind + a.nFix))
  // ○○之星榮耀榜：每面向平均星最高者（至少 3 票才上榜，避免一票封神）
  const stars5 = Object.fromEntries(FACETS.map(f => {
    const cand = rank.filter(p => p.facets[f] && p.facets[f].n >= 3).sort((a, b) => b.facets[f].avg - a.facets[f].avg || b.facets[f].n - a.facets[f].n)
    return [f, cand[0] ? { name: cand[0].name, avg: cand[0].facets[f].avg, n: cand[0].facets[f].n } : null]
  }))
  return { rank, stars5, taskBreak, balance, behavMonth, month, list }
}
