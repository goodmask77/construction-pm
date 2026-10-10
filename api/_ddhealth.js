// DD 穩定化批次 1a（v4.70.39，溝通中樞 docs/COMMS_PLAN.md 項目 1）：事件去重＋健康紀錄＋健康頁彙總
// 設計原則：
//  - 全部「只插入、不讀改寫」：每個事件／每筆紀錄各一列（pm_ddev_*／pm_ddh_*），並發不會互相覆蓋（這正是 pm_bot_chats 一鍵擠全部的病根）
//  - fail-safe：任何失敗回 null／空物件，絕不讓 DD 因為健康紀錄壞掉而不回話
//  - 清理：pm_ddev_ 留 2 天、pm_ddh_ 留 30 天（cron-daily 每天掃）
import { SB_URL, SB_KEY } from './_onboard.js'

const H = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' })
const tpeDay = (t) => new Date((t || Date.now()) + 8 * 3600e3).toISOString().slice(0, 10)
const esc = (s) => String(s).replace(/[\\%_]/g, (m) => '\\' + m) // LIKE 的 _ 是萬用字元，要跳脫（踩過的坑）

// 事件只處理一次：第一次見到 → true；已處理過（含 LINE 重送）→ false；查不到／沒 DB → null（呼叫端自行決定）
export async function ddEventOnce(eventId) {
  if (!SB_URL || !SB_KEY || !eventId) return null
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, {
      method: 'POST', headers: { ...H(), Prefer: 'return=minimal' }, // 不帶 merge-duplicates → 撞 id 會 409＝原子去重
      body: JSON.stringify({ id: 'pm_ddev_' + String(eventId).slice(0, 120), data: { v: '1' }, editor: 'D哥', updated_at: new Date().toISOString() }),
    })
    if (r.status === 201) return true
    if (r.status === 409) return false
    console.log('[ddhealth] eventOnce unexpected', r.status)
    return null
  } catch (e) { console.log('[ddhealth] eventOnce err', e?.message); return null }
}

// 記一筆健康紀錄（約 100ms，呼叫端 .catch 吞掉即可）。entry.kind：reply／error／sigfail／dup／redelivery_ok
export async function ddHealthLog(entry) {
  if (!SB_URL || !SB_KEY) return
  try {
    const now = Date.now()
    const id = `pm_ddh_${tpeDay(now)}_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
    await fetch(`${SB_URL}/rest/v1/pm_documents`, {
      method: 'POST', headers: { ...H(), Prefer: 'return=minimal' },
      body: JSON.stringify({ id, data: { v: JSON.stringify({ t: new Date(now).toISOString(), ...entry }) }, editor: 'D哥', updated_at: new Date(now).toISOString() }),
    })
  } catch (e) { console.log('[ddhealth] log err', e?.message) }
}

async function readDay(day) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(esc('pm_ddh_' + day))}*&select=data&limit=5000`, { headers: H() })
    const rows = r.ok ? await r.json() : []
    const out = []
    rows.forEach((row) => { if (row?.data?.v) { try { out.push(JSON.parse(row.data.v)) } catch (_) {} } })
    return out
  } catch (_) { return [] }
}

// 健康頁彙總：近 N 天（台北日）
export async function ddHealthSummary(days = 7) {
  if (!SB_URL || !SB_KEY) return { days: [], total: {} }
  const list = []
  for (let i = 0; i < days; i++) list.push(tpeDay(Date.now() - i * 86400e3))
  const perDay = await Promise.all(list.map(readDay))
  const mk = () => ({ n: 0, ok: 0, fail: 0, msSum: 0, ms: [], le3: 0, le10: 0, le30: 0, gt30: 0, pushFb: 0, aiCalls: 0, aiFb: 0, aiErr: 0, inCut: 0, outCut: 0, itSum: 0, sigfail: 0, dup: 0, redeliv: 0, errors: 0, nodata: 0 })
  const total = mk(); const daysOut = []; const recentFail = []; const recentNodata = []; const reasons = {}
  const secSum = {}; let secN = 0 // v4.70.42 各資料段落平均字數（1b 瘦身量測）
  const addReason = (k) => { if (!k) return; k = String(k).slice(0, 60); reasons[k] = (reasons[k] || 0) + 1 }
  list.forEach((day, i) => {
    const d = mk(); d.day = day
    for (const e of perDay[i]) {
      for (const T of [d, total]) {
        if (e.kind === 'reply') {
          T.n++; if (e.ok) T.ok++; else T.fail++
          const ms = +e.ms || 0; T.msSum += ms; T.ms.push(ms)
          if (ms <= 3000) T.le3++; else if (ms <= 10000) T.le10++; else if (ms <= 30000) T.le30++; else T.gt30++
          if (e.send && e.send.pushed) T.pushFb++
          const a = e.ai || null
          if (a) { T.aiCalls += a.calls || 0; T.aiFb += a.fb || 0; T.aiErr += a.err || 0; T.inCut += a.inCut || 0; T.outCut += a.outCut || 0; T.itSum += a.it || 0 }
          if (T === total && a && a.sec) { secN++; for (const [k, v] of Object.entries(a.sec)) secSum[k] = (secSum[k] || 0) + (+v || 0) }
        } else if (e.kind === 'error') T.errors++
        else if (e.kind === 'sigfail') T.sigfail++
        else if (e.kind === 'dup') T.dup++
        else if (e.kind === 'redelivery_ok') T.redeliv++
        else if (e.kind === 'nodata') T.nodata++ // v4.70.41 DD 承認沒資料
      }
      if (e.kind === 'error') { addReason('例外：' + (e.err || '?')); recentFail.push(e) }
      else if (e.kind === 'reply' && !e.ok) { addReason('回覆失敗：' + ((e.send && (e.send.err || e.send.status)) || '?')); recentFail.push(e) }
      else if (e.kind === 'sigfail') addReason('驗簽失敗')
      if (e.kind === 'nodata') recentNodata.push(e)
      if (e.kind === 'reply' && e.ai && e.ai.err) addReason('AI：' + (e.ai.lastErr || '失敗')) // 回覆成功與否都算（AI 壞了走備援也要看得到）
    }
    daysOut.push(fin(d))
  })
  recentFail.sort((a, b) => String(b.t).localeCompare(String(a.t))); recentNodata.sort((a, b) => String(b.t).localeCompare(String(a.t)))
  return { days: daysOut, total: fin(total), reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ k, n })), recentFail: recentFail.slice(0, 20), recentNodata: recentNodata.slice(0, 20), sections: secN ? Object.entries(secSum).map(([k, v]) => ({ k, avg: Math.round(v / secN) })).sort((a, b) => b.avg - a.avg) : [] }
}
function fin(T) {
  const ms = T.ms.slice().sort((a, b) => a - b)
  const pct = (p) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] : 0
  const o = { ...T, avgMs: T.n ? Math.round(T.msSum / T.n) : 0, p50: pct(0.5), p90: pct(0.9), avgIt: T.aiCalls ? Math.round(T.itSum / T.aiCalls) : 0 }
  delete o.ms; delete o.msSum; delete o.itSum
  return o
}

// 清理：去重列留 2 天、健康紀錄留 30 天（用 updated_at 欄位判斷）
export async function ddHealthCleanup() {
  if (!SB_URL || !SB_KEY) return { ok: false }
  const out = {}
  for (const [prefix, keepDays] of [['pm_ddev_', 2], ['pm_ddh_', 30]]) {
    try {
      const before = new Date(Date.now() - keepDays * 86400e3).toISOString()
      const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(esc(prefix))}*&updated_at=lt.${encodeURIComponent(before)}`, { method: 'DELETE', headers: { ...H(), Prefer: 'return=minimal' } })
      out[prefix] = r.status
    } catch (e) { out[prefix] = 'err ' + e?.message }
  }
  return { ok: true, ...out }
}
