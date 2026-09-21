// ── boss-api 同步（張良 2026-09-21：「先進我們的資料庫就對了，要開頁面要資料都可以再做」）──
// A Beach 營運資料唯讀 API → 我們自己的 KV（pm_documents）。照 ~/.claude/skills/boss-api/SKILL.md 的規則實作：
//   ・主鍵 upsert、各端點不同增量窗（出勤/加班31天、交接45天、營收14天…）、班表往後35天
//   ・每分鐘 60 次限流 → 循序請求、間隔 1.1 秒、每輪最多 35 個請求（吃不完下一輪輪替續跑）
//   ・刪除偵測：窗內整段重拉「全部翻頁成功」才刪窗內沒再出現的列；任何一頁失敗就不刪
//   ・首次回填 from=2026-01-01（線上最早資料 2026-01，一段 366 天內涵蓋）
//   ・401＝金鑰失效 → 當天停跑＋DD 私訊審核人一次
// 儲存：sp_finance_pm_boss_<slug>_<YYYYMM>（月分片 {rows:{主鍵:整列}}）；快照型（菜單成本/名冊）單檔 sp_finance_pm_boss_<slug>
// 🔴 紅線（SKILL 明定）：這些資料＝內部資料，不可進 /prep 共用金鑰頁；之後開頁面只能放要登入的主 App。
// cron：vercel.json 每小時 :07；手動 ?force=<MENU_PROBE_KEY>；只測金鑰 ?ping=1&force=<金鑰>
import { kvGet, kvPut, announceChanged } from './mail-sync.js'

const BASE = (process.env.BOSS_API_BASE_URL || '').trim().replace(/\/$/, '')
const KEY = (process.env.BOSS_API_KEY || '').trim()
const REQ_BUDGET = 35, SLEEP_MS = 1100, PAGE_LIMIT = 200
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const tpeToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const monthsBetween = (a, b) => { const out = []; let m = a.slice(0, 7); while (m <= b.slice(0, 7)) { out.push(m); const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); m = d.toISOString().slice(0, 7) } return out }

// 端點表（照 SKILL §3.1；orders/summary 刻意不同步＝SKILL 建議用自己的 orders 算）
const EPS = [
  { ep: 'revenue/daily', slug: 'revd', pk: r => r.date, df: r => r.date, back: 14, fwd: 0 },
  { ep: 'revenue/settlement', slug: 'sett', pk: r => r.date, df: r => r.date, back: 7, fwd: 0 },
  { ep: 'orders', slug: 'ord', pk: r => r.order_id, df: r => String(r.created_at || '').slice(0, 10), back: 14, fwd: 0 },
  { ep: 'orders/items', slug: 'ordi', pk: r => r.line_id, df: r => String(r.ordered_at || r.created_at || '').slice(0, 10), back: 14, fwd: 0 },
  { ep: 'costs/menu', slug: 'menu', pk: r => r.menu_id, snapshot: 1 },
  { ep: 'hr/schedule', slug: 'sched', pk: r => r.shift_id, df: r => r.work_date, back: 7, fwd: 35 },
  { ep: 'hr/staff', slug: 'staff', pk: r => r.staff_id, snapshot: 1 }, // 含離職不刪（歷史 *_staff_id 會指到）
  { ep: 'hr/prep', slug: 'prep', pk: r => r.submit_id, df: r => String(r.at || '').slice(0, 10), back: 14, fwd: 0 },
  { ep: 'hr/routine', slug: 'rout', pk: r => `${r.biz_date}|${r.task_id}`, df: r => r.biz_date, back: 7, fwd: 0 },
  { ep: 'hr/attendance', slug: 'att', pk: r => r.event_id, df: r => r.date, back: 31, fwd: 0 },
  { ep: 'hr/overtime', slug: 'ot', pk: r => r.event_id, df: r => r.date, back: 31, fwd: 0 },
  { ep: 'ops/incidents', slug: 'inc', pk: r => r.incident_id, df: r => String(r.created_at || '').slice(0, 10), back: 45, fwd: 0 },
  { ep: 'ops/temp-alerts', slug: 'temp', pk: r => r.reading_id, df: r => String(r.recorded_at || '').slice(0, 10), back: 7, fwd: 0 },
]

export default async function handler(req, res) {
  const mk = (process.env.MENU_PROBE_KEY || '').trim()
  const force = mk && String(req.query?.force || '') === mk
  if (!BASE || !KEY) return res.status(200).json({ ok: false, skipped: 'BOSS_API_BASE_URL / BOSS_API_KEY 尚未設定（張良要自己在 Vercel env 設，金鑰不經過對話）' })

  let used = 0
  const call = async (path, params) => { // 循序＋限流＋429退避；回 {data,next} 或丟錯
    if (used >= REQ_BUDGET) throw Object.assign(new Error('BUDGET'), { budget: true })
    if (used > 0) await sleep(SLEEP_MS)
    used++
    const qs = new URLSearchParams(params || {}).toString()
    const url = `${BASE}/${path}${qs ? '?' + qs : ''}`
    let r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } })
    if (r.status === 429) { const ra = Number(r.headers.get('Retry-After')) || 60; await sleep(ra * 1000); r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } }) }
    if (r.status === 401) throw Object.assign(new Error('金鑰無效/已撤銷'), { auth: true })
    if (r.status === 403) throw Object.assign(new Error('scope 不足'), { scope: true })
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}`)
    return await r.json()
  }

  // 只測金鑰
  if (req.query?.ping) {
    if (!force) return res.status(403).json({ ok: false })
    try { const p = await call('ping'); return res.status(200).json({ ok: true, ping: p }) } catch (e) { return res.status(200).json({ ok: false, error: e.message }) }
  }

  const state = (await kvGet('sp_finance_pm_boss_state')) || { bf: {}, rot: 0, res: {} }
  const today = tpeToday()
  if (!force && state.auth401 === today) return res.status(200).json({ ok: false, skipped: '金鑰 401，今天已停跑（換好金鑰後 ?force 手動跑）' })

  // 拉一個端點的一個區間：全部翻頁成功才回列陣列；失敗丟錯（呼叫端不刪資料）
  const fetchRange = async (E, from, to) => {
    const rows = []
    let cursor = null
    do {
      const params = { limit: PAGE_LIMIT }
      if (from) { params.from = from; params.to = to }
      if (cursor) params.cursor = cursor
      const pg = await call(E.ep, params)
      rows.push(...(pg.data || []))
      cursor = (pg.meta && pg.meta.next != null) ? pg.meta.next : (pg.next != null ? pg.next : null)
    } while (cursor)
    return rows
  }
  // 寫入：月分片 upsert＋（窗完整時）刪窗內沒出現的列
  const writeRows = async (E, rows, from, to, allowDelete) => {
    const byM = {}
    for (const r of rows) { const d = E.df(r); if (!d || d.length < 7) continue; (byM[d.slice(0, 7)] = byM[d.slice(0, 7)] || {})[E.pk(r)] = r }
    const months = allowDelete ? monthsBetween(from, to) : Object.keys(byM)
    for (const m of months) {
      const id = `sp_finance_pm_boss_${E.slug}_${m.replace('-', '')}`
      const doc = (await kvGet(id)) || { rows: {} }
      if (allowDelete) for (const [k, r] of Object.entries(doc.rows)) { const d = E.df(r); if (d >= from && d <= to && !((byM[m] || {})[k])) delete doc.rows[k] } // 窗內沒再出現＝來源已刪
      Object.assign(doc.rows, byM[m] || {})
      doc.updatedAt = new Date().toISOString()
      await kvPut(id, doc, `boss同步 ${E.slug} ${m}`)
    }
  }

  const done = [], errs = []
  const order = [...EPS.slice(state.rot % EPS.length), ...EPS.slice(0, state.rot % EPS.length)] // 輪替起點：預算吃完時後面的端點下一輪優先
  try {
    for (const E of order) {
      try {
        if (E.snapshot) { // 快照型：每次全抓、整批覆蓋（staff 含離職全保留＝API 本來就會回）
          const rows = await fetchRange(E, null, null)
          const doc = { rows: Object.fromEntries(rows.map(r => [E.pk(r), r])), updatedAt: new Date().toISOString(), count: rows.length }
          await kvPut(`sp_finance_pm_boss_${E.slug}`, doc, `boss同步 ${E.slug} 全量`)
          done.push(`${E.slug}:${rows.length}`)
        } else if (state.bf[E.slug] !== 'done') { // 首次回填（分段 366 天；成功一段推進一段）
          const from = state.bf[E.slug] || '2026-01-01'
          const to0 = addDays(from, 365), to = to0 > today ? (E.fwd ? addDays(today, E.fwd) : today) : to0
          const rows = await fetchRange(E, from, to)
          await writeRows(E, rows, from, to, false) // 回填不刪
          state.bf[E.slug] = to >= today ? 'done' : addDays(to, 1)
          done.push(`${E.slug}:回填${from}~${to}:${rows.length}`)
        } else { // 增量窗：整段重拉 upsert＋刪除偵測
          const from = addDays(today, -E.back), to = E.fwd ? addDays(today, E.fwd) : today
          const rows = await fetchRange(E, from, to)
          await writeRows(E, rows, from, to, true)
          done.push(`${E.slug}:${rows.length}`)
        }
        state.res[E.slug] = { at: new Date().toISOString(), ok: 1 }
      } catch (e) {
        if (e.budget) { state.rot = EPS.findIndex(x => x.slug === E.slug); throw e } // 預算吃完：下一輪從這個端點開始
        if (e.auth) throw e
        if (e.scope) { state.res[E.slug] = { at: new Date().toISOString(), scope: 0 }; errs.push(`${E.slug}:無scope`); continue } // 金鑰沒開這類→跳過不重試
        errs.push(`${E.slug}:${e.message}`); state.res[E.slug] = { at: new Date().toISOString(), err: e.message }
      }
    }
    state.rot = 0 // 全部跑完
  } catch (e) {
    if (e.auth) {
      state.auth401 = today
      try { // DD 私訊審核人一次（照 SKILL：401 要停止並通知管理者）
        const [defD, rosterD] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
        const tk = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        for (const an of (((defD || {}).ground || {}).approvers || ['張良瑋'])) {
          const ap = ((rosterD || {}).people || []).find(p => p.name === an && p.lineUserId)
          if (tk && ap) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: ap.lineUserId, messages: [{ type: 'text', text: '⚠️ boss-api 同步：金鑰 401（無效/撤銷），已停止同步。請跟 A Beach 管理者拿新金鑰後到 Vercel 更新 BOSS_API_KEY。' }] }) })
        }
      } catch (_) {}
    } else if (!e.budget) errs.push(e.message)
  }
  state.lastRun = new Date().toISOString()
  await kvPut('sp_finance_pm_boss_state', state, 'boss同步狀態')
  await announceChanged()
  return res.status(200).json({ ok: !errs.length, requests: used, done, errs, rot: state.rot, bf: state.bf })
}
