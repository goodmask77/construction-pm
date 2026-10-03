// ── boss-api 同步（張良 2026-09-21：「先進我們的資料庫就對了，要開頁面要資料都可以再做」）──
// A Beach 營運資料唯讀 API → 我們自己的 KV（pm_documents）。照 ~/.claude/skills/boss-api/SKILL.md 的規則實作：
//   ・主鍵 upsert、各端點不同增量窗（出勤/加班31天、交接45天、營收14天…）、班表往後35天
//   ・每分鐘 60 次限流 → 循序請求、間隔 1.1 秒、每輪最多 35 個請求（吃不完下一輪輪替續跑）
//   ・刪除偵測：窗內整段重拉「全部翻頁成功」才刪窗內沒再出現的列；任何一頁失敗就不刪
//   ・首次回填 from=2026-01-01（線上最早資料 2026-01，一段 366 天內涵蓋）
//   ・401＝金鑰失效 → 當天停跑＋DD 私訊審核人一次
// 儲存：sp_finance_pm_boss_<slug>_<YYYYMM>（月分片 {rows:{主鍵:整列}}）；快照型（菜單成本/名冊）單檔 sp_finance_pm_boss_<slug>
// 紅線放寬（張良 2026-10-03 拍板）：阿桑＝自家員工、兩邊互通都是公司內部資料，/prep 也算內部可以放；
// 實作仍走 /prep 既有權限矩陣（permWho），不進免登入裸頁。
// cron：vercel.json 每小時 :07；手動 ?force=<MENU_PROBE_KEY>；只測金鑰 ?ping=1&force=<金鑰>
// ?fillpos=<PARTNER_API_KEY>[&dry=1]：一次性把 4~6 月 AB 營收（revd+sett）補進營收頁 pos entries（7/1 起維持日結信為準）
import { kvGet, kvPut, announceChanged, ingestPosRecords } from './mail-sync.js'

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
  { ep: 'revenue/monthly', slug: 'revm', pk: r => r.month, snapshot: 1 }, // 2026-10-04 阿桑新增：iCHEF 時代 2021-02 起月營收（無 from/to 參數→快照全抓）
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

  // 盤點探針（唯讀；?bosspeek=<PARTNER_API_KEY>&slug=sched&ym=202610[&q=關鍵字]）：看同步進來的 boss 月檔原始列（除錯用）
  if (req.query?.bosspeek) {
    const pk0 = (process.env.PARTNER_API_KEY || '').trim()
    if (!pk0 || String(req.query.bosspeek) !== pk0) return res.status(403).json({ ok: false })
    const slug0 = String(req.query.slug || 'staff')
    const id0 = ['menu', 'staff'].includes(slug0) ? `sp_finance_pm_boss_${slug0}` : `sp_finance_pm_boss_${slug0}_${String(req.query.ym || '').replace('-', '') || tpeToday().slice(0, 7).replace('-', '')}`
    const doc0 = (await kvGet(id0)) || {}
    let rows0 = Object.values(doc0.rows || {})
    const q0 = String(req.query.q || '')
    if (q0) rows0 = rows0.filter(r => JSON.stringify(r).includes(q0))
    return res.status(200).json({ ok: true, id: id0, total: Object.keys(doc0.rows || {}).length, matched: rows0.length, rows: rows0.slice(0, 30) })
  }
  // 原始透傳探針（除錯用；?bossraw=<MENU_PROBE_KEY>&ep=revenue/daily&from=&to=）：直接打上游看原始回應
  if (req.query?.bossraw) {
    const pkR = (process.env.PARTNER_API_KEY || '').trim() // 本機 .env.local 的 MENU_PROBE_KEY 與線上不符 → 也收 partner 金鑰
    if (!force && String(req.query.bossraw) !== mk && !(pkR && String(req.query.bossraw) === pkR)) return res.status(403).json({ ok: false })
    try {
      const p = { limit: 50 }
      if (req.query.from) { p.from = String(req.query.from); p.to = String(req.query.to || req.query.from) }
      const j = await call(String(req.query.ep || 'revenue/daily'), p)
      return res.status(200).json({ ok: true, count: (j.data || []).length, meta: j.meta || null, sample: (j.data || []).slice(0, 3) })
    } catch (e) { return res.status(200).json({ ok: false, error: e.message }) }
  }
  // 歷史回填重啟口（張良 2026-10-04「阿桑OPS已更新2021年營業資料,更新」）：
  // ?histfill=<MENU_PROBE_KEY>&slugs=revd,sett&from=2021-01-01 → 把指定端點的回填起點撥回去，
  // 之後每跑一次同步（cron 或 ?force）吃一段 366 天，分幾輪自動拉完；不動其他端點
  if (req.query?.histfill) {
    if (!mk || String(req.query.histfill) !== mk) return res.status(403).json({ ok: false })
    const from0 = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '2021-01-01'
    const slugs = String(req.query.slugs || 'revd,sett').split(',').map(s => s.trim()).filter(s => EPS.some(E => E.slug === s))
    const st0 = (await kvGet('sp_finance_pm_boss_state')) || { bf: {}, rot: 0, res: {} }
    for (const s of slugs) st0.bf[s] = from0
    await kvPut('sp_finance_pm_boss_state', st0, 'boss歷史回填重啟')
    return res.status(200).json({ ok: true, slugs, from: from0, hint: '之後每跑一次同步吃一段366天，?force 催跑到 bf 顯示 done' })
  }
  // 一次性回填（張良 2026-10-03「7/1 前營收頁沒 AB 資料」→ 2026-10-04 放寬到 2021 起全史）：
  // boss revd（營收/單數/折扣/服務費/來客）＋ sett（現金/刷卡/Uber）→ 營收頁 pos entries；
  // 只補 2026-07-01 前、且該日尚無 AB 列的日子（ingestPosRecords 本身就 date|店 去重，7/1 起日結信為準不會被蓋）
  if (req.query?.fillpos) {
    const pk = (process.env.PARTNER_API_KEY || '').trim()
    if (!pk || String(req.query.fillpos) !== pk) return res.status(403).json({ ok: false })
    const recs = []
    for (const m of monthsBetween('2021-01-01', '2026-06-30')) {
      const ym = m.replace('-', '')
      const [revD, settD] = await Promise.all([kvGet(`sp_finance_pm_boss_revd_${ym}`), kvGet(`sp_finance_pm_boss_sett_${ym}`)])
      const settRows = (settD || {}).rows || {}
      for (const r of Object.values((revD || {}).rows || {})) {
        if (!r?.date || r.date >= '2026-07-01' || r.net_sales == null) continue
        const s = settRows[r.date] || {}
        recs.push({
          id: 'pos-' + r.date.replace(/-/g, '') + 'boss-abeach',
          date: r.date, period: r.date + '（阿桑OPS回填）', store: 'A Beach 101&Pizza', subject: 'A Beach boss-api 回填',
          revenue: r.net_sales, grossSales: r.net_sales, discount: Number(r.discount) || 0, serviceFee: Number(r.service_charge) || 0,
          txCount: r.transactions ?? null, guests: r.customers ?? null,
          cash: s.cash_total ?? null, card: s.card_total ?? null, uber: s.ue_total ?? null,
          source: 'boss-api',
        })
      }
    }
    if (req.query.dry) return res.status(200).json({ ok: true, dry: 1, n: recs.length, first: recs[0] || null, last: recs[recs.length - 1] || null })
    const out = await ingestPosRecords(recs, 'boss-api回填AB4-6月營收')
    await announceChanged()
    return res.status(200).json({ ok: true, ...out })
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
