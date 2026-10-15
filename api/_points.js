// ── 🏦 積分中樞共用模組（張良 2026-10-06）──
// 抽出來讓 mail-sync（排行榜/規則/回饋/SOP/簽收/回報）與 punch（打卡）等端點共用同一套給分邏輯，
// 避免 punch 靜態 import 整包 mail-sync（含 imapflow 等）造成循環/冷啟負擔。KV 走 _onboard（與 mail-sync 同 data.v 格式）。
import crypto from 'node:crypto'
import { abgdKv } from './_abgdkv.js'
import { SB_URL, svc } from './_onboard.js'

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
// 積分大表原子改（abgd 關卡 3 回饋第一輪：原本讀→改→整份寫，兩筆同時給分會互蓋掉分；存檔失敗也回成功）：
// 讀 data＋updated_at → 改 → PATCH 條件 updated_at＝剛讀到的值；別人先寫了（0 列）就重讀重做，最多 12 次（退避加亂數）。
// mutate(doc) 回 { write: boolean, value }：write=false＝不用寫（例如已給過），直接回 value。
const PTS_KEY = 'sp_finance_pm_points'
// ── 讀寫層（v4.71.136 abgd 搬家 B 模式）：積分四份文件（流水帳 sp_finance_pm_points、規則 _points_cfg、獎勵 sp_finance_pm_rewards、兌換 sp_finance_pm_redeem）
//   依資料歸屬走 GD 或新殼，一律版本比對寫（GD 正本＝pm_doc_get／pm_doc_cas；新殼正本＝gdread＋命令橋 points/put）；撞版本重讀重做
export const PTS_KEYS = { points: PTS_KEY, cfg: 'sp_finance_pm_points_cfg', rewards: 'sp_finance_pm_rewards', redeem: 'sp_finance_pm_redeem' }
const ptsKv = (op) => abgdKv({ domain: 'points', lockKey: PTS_KEY, operator: String(op || '積分').slice(0, 30), label: '積分', versioned: true })
// 一份文件的讀改寫：mutate(cur) 回 { write, doc, value }（write=false＝不用寫，直接回 value）；每次重試都新開讀寫物件重讀；最多 12 次
export async function ptsTx(key, mutate, editor = '積分', op) {
  for (let i = 0; i < 12; i++) {
    const kv = await ptsKv(op)
    const cur = await kv.kvGet(key)
    const res = mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    try { await kv.kvPut(key, res.doc, editor); return res.value } catch (e) { if (!(e && e.code === 'stale')) throw e }
    await new Promise(rs => setTimeout(rs, Math.floor(Math.random() * (60 + 60 * i)))) // 退避加亂數，避免大家同時重來
  }
  const e = new Error('積分寫入一直衝突（12 次），稍後重試'); e.code = 'commitfail'; throw e
}
// 讀多份（依歸屬；讀失敗丟錯，不當成「沒有」）
export async function ptsRead(keys, op) { const kv = await ptsKv(op); const vals = await Promise.all(keys.map(k => kv.kvGet(k))); const out = {}; keys.forEach((k, i) => { out[k] = vals[i] }); return out }
// 積分大表原子改（原介面）：mutate(doc) 直接改 doc、回 { write, value }
export async function pointsCas(mutate, editor = 'onboard-bot', op) {
  return ptsTx(PTS_KEY, (cur) => { const doc = cur || { list: [], carry: {} }; const r = mutate(doc) || {}; return { write: !!r.write, doc, value: r.value } }, editor, op)
}
// 嚴格版：回 { awarded, reason }；讀寫失敗直接丟錯（給新殼代發口用，失敗會重試）
export async function awardPtsStrict(person, act, ref, atIso) { // atIso：行為發生時間（補分重放用原本時間算日期與每日上限；關卡 3 積分第二輪 A6）
  if (!person || person === '匿名') return { awarded: false, reason: 'no-person' }
  const cfg = (await ptsRead([PTS_KEYS.cfg], person))[PTS_KEYS.cfg]
  const rule = pointsRules(cfg)[act]
  if (!rule || rule.off || !(Number(rule.pts) > 0)) return { awarded: false, reason: 'rule-off' }
  if (atIso && !(Date.now() - Date.parse(atIso) <= 25 * 86400e3)) throw new Error('補分事件超過 25 天（或時間無效），不重放') // 折舊只折 30 天前：25 天內的重放一定還找得到去重憑證（關卡 3 積分第四輪 A5／A6）
  return pointsCas(doc => {
    doc.list = doc.list || []; doc.carry = doc.carry || {}
    const t0 = atIso && Number.isFinite(Date.parse(atIso)) ? Date.parse(atIso) : Date.now()
    const dnow = new Date(t0 + 8 * 3600e3).toISOString().slice(0, 10)
    if (ref && doc.list.find(e => e.person === person && e.act === act && e.ref === ref)) return { write: false, value: { awarded: false, reason: 'dup' } }
    const cap = Number(rule.cap) || 0
    if (cap > 0 && doc.list.filter(e => e.person === person && e.act === act && e.date === dnow).length >= cap) return { write: false, value: { awarded: false, reason: 'cap' } }
    doc.list.push({ id: 'pt' + Date.now().toString(36) + '_' + doc.list.length, person, date: dnow, ts: new Date(t0 + 8 * 3600e3).toISOString().slice(11, 16), type: 'behavior', act, pts: Number(rule.pts), ref: ref || '', ...(atIso ? { late: true } : {}) })
    if (doc.list.length > 40000) { const old30 = new Date(Date.now() + 8 * 3600e3 - 30 * 86400e3).toISOString().slice(0, 10); const keep = (e) => e.act === 'redeem' || e.act === 'adjust' || !(String(e.date || '') < old30); let over = doc.list.length - 40000; const cut = []; doc.list = doc.list.filter(e => { if (over > 0 && !keep(e)) { over--; cut.push(e); return false } return true }); for (const e of cut) doc.carry[e.person] = (doc.carry[e.person] || 0) + Number(e.pts || 0) } // 滾出窗口的折進 carry，總累積不失真；兌換扣點、主管加扣分永不折，30 天內的紀錄也不折（補分佇列只保留 7 天，重放時去重憑證與每日計數一定還在；關卡 3 積分第二、三輪 A5／A6）
    return { write: true, value: { awarded: true, reason: 'ok' } }
  }, '行為分(' + person + ')', person) // 操作者＝得分的人（新殼命令橋留痕、驗收閘門看得到是誰）
}
// 原本的介面（GD 各處呼叫）：不丟錯、回 true/false；改用同一套原子寫入
export async function awardPts(person, act, ref) {
  try { return (await awardPtsStrict(person, act, ref)).awarded } catch (e) { console.log('[awardPts] 失敗，進補分佇列', person, act, ref, String(e && e.message || e).slice(0, 160)); await ptsQueue(person, act, ref); return false }
}
// ── 補分佇列（v4.71.136；關卡 3 積分第一輪 OpenAI A6）：給分寫不進去（驗收閘門、一直撞版本、新殼連不上）→ 存一筆 GD 文件 pm_ptsq_<雜湊>（不屬積分域，留 GD），
//   每小時排程與拆閘門後的 points_drain 依原 ref 重給（awardPtsStrict 同人同動作同 ref 只給一次，重放不會加倍）；成功（含已給過／達上限／規則關閉）就刪
const PQ = 'pm_ptsq_'
async function ptsQueue(person, act, ref) {
  try {
    const at = new Date().toISOString(); const id = PQ + crypto.createHash('sha256').update(String(person) + '|' + String(act) + '|' + (ref ? String(ref) : '@' + at)).digest('hex').slice(0, 40)
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify({ person, act, ref: ref || '', at }) }, editor: '補分佇列', updated_at: at }) })
    if (!r.ok && r.status !== 409) console.error('[awardPts] 補分佇列也存不進去（這筆行為分會漏，請人工補）', person, act, ref, r.status)
  } catch (e) { console.error('[awardPts] 補分佇列也存不進去（這筆行為分會漏，請人工補）', person, act, ref, String(e && e.message || e).slice(0, 80)) }
}
export async function ptsDrain({ limit = 50 } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent('pm\\_ptsq\\_')}*&select=id,data&order=updated_at.asc&limit=${Math.min(300, Number(limit) || 50)}`, { headers: svc })
  if (!r.ok) throw new Error('讀補分佇列失敗 HTTP ' + r.status)
  const rows = await r.json(); let ok = 0, left = 0, drop = 0
  for (const row of rows) {
    let q = null; try { q = JSON.parse(row.data.v) } catch (_) {}
    const del = async () => { const d = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE', headers: svc }); if (!d.ok) throw new Error('刪補分佇列失敗 HTTP ' + d.status) } // 刪除要確認成功（沒刪掉下次再補也不會重給：同 ref 去重）
    const dead = async (why) => { const at = new Date().toISOString(); const r2 = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'pm_ptsqdead_' + row.id.slice(PQ.length), data: { v: JSON.stringify({ ...(q || {}), why, deadAt: at }) }, editor: '補分死信', updated_at: at }) }); if (!r2.ok) throw new Error('寫補分死信失敗 HTTP ' + r2.status); console.error('[awardPts] 補分進死信（請人工核對補分）', why, JSON.stringify(q)); await del() } // 死信保留（不刪），等人工核對
    try {
      if (!q || !q.person || !q.act) { await dead('內容壞了'); drop++; continue }
      if (!(Date.now() - Date.parse(q.at || '') <= 7 * 86400e3)) { await dead('超過 7 天（或時間無效）沒補成，不再重放'); drop++; continue } // 超齡不嘗試、直接進死信（關卡 3 積分第四輪 A6）
      try { await awardPtsStrict(q.person, q.act, q.ref || '', q.at); await del(); ok++ }
      catch (e) { left++ }
    } catch (e) { console.error('[awardPts] 補分佇列處理失敗（下輪再試）', row.id, String(e && e.message || e).slice(0, 80)); left++ }
  }
  return { seen: rows.length, ok, left, drop }
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
