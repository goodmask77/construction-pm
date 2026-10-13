import './_qpatch.js' // v4.71.10 DD 推播統一補額度尾巴
// ── LINE 官方帳號好友成長數據 v4.70.80（張良 2026-10-12「抓得到官方 LINE 的成長數字嗎」→「做」）──
// 來源：LINE Messaging API 官方統計（Insight）。四個帳號（A Beach／GROUN:D／104招募／DD）用收件匣同一組金鑰（api/_inbox.js ACCOUNTS），前端永遠看不到金鑰。
// 抓什麼：
//   ① 每日「加入好友／目標好友／封鎖」＝ GET /v2/bot/insight/followers?date=（LINE 隔天才有，未完成回 unready）
//   ② 每日訊息則數（群發／自動回應／API 推播…）＝ GET /v2/bot/insight/message/delivery?date=
//   ③ 屬性（性別／年齡／地區／裝置／加入多久）＝ GET /v2/bot/insight/demographic（LINE 推估值、延遲約 3 天、目標好友 <20 人不給）
//   ④ 訊息額度（本月已用／上限）＝ GET /v2/bot/message/quota（+/consumption）
// 存哪：
//   月檔 sp_finance_pm_lineoa_<帳號>_<YYYY-MM>  = { days: { 'YYYY-MM-DD': { f:加入, t:目標, b:封鎖, m:{訊息則數各類} } } }
//   狀態 sp_finance_pm_lineoa_<帳號>            = { name, demo:最新屬性, demoAt, demoHist:{日期:屬性}（每 7 天留一份，留 60 份）, quota, alerts }
//   摘要 sp_finance_pm_lineoa_sum               = 全帳號一鍵摘要（DD 讀這一鍵就夠，line-webhook loadLineQuotaText 接）
// 節奏：cron 每小時一次（vercel.json）。LINE 統計 API 每小時每帳號上限 60 次 → 每次最多補 BATCH 天（2 次呼叫／天），
//       第一次回補 397 天（LINE 可查上限）大約跑十幾個小時自動補完，之後每小時只是補昨天（unready 就下一小時再試）。
// 通知（LINE 私訊張良）：昨天封鎖數比前一天多 ≥3 → 提醒；訊息額度用到 80%／95% → 每月各提醒一次。
// 讀：GET ?lineoa=<OPS_BOARD_KEY>[&days=400] → 前端「行銷大師 → LINE 官方帳號」；加 &run=1 先抓再回
import { kvGet, kvPut } from './mail-sync.js'
import { ACCOUNTS, creds, configured } from './_inbox.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const LINE = 'https://api.line.me/v2/bot'
const BATCH = 22 // 每次每帳號最多補幾天（×2 次呼叫 ≤ 44，留餘裕給屬性／額度）
const MAX_BACK = 397 // LINE 可查上限
const tpe = (ms = Date.now()) => new Date(ms + 8 * 3600e3)
const ymd = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => ymd(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5))
export const stKey = (k) => 'sp_finance_pm_lineoa_' + k
export const moKey = (k, ym) => `sp_finance_pm_lineoa_${k}_${ym}`
export const SUM_KEY = 'sp_finance_pm_lineoa_sum'
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0 }

async function lineGet(path, token) {
  const r = await fetch(LINE + path, { headers: { Authorization: 'Bearer ' + token } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error((j && j.message) || ('LINE HTTP ' + r.status)); e.status = r.status; throw e }
  return j
}

// 月檔快取（一次 run 內同月只讀寫一次）
function monthCache() {
  const c = {}, dirty = new Set()
  return {
    async get(k, ym) { const id = moKey(k, ym); if (!c[id]) c[id] = (await kvGet(id)) || { days: {} }; if (!c[id].days) c[id].days = {}; return c[id] },
    mark(k, ym) { dirty.add(moKey(k, ym)) },
    async flush() { for (const id of dirty) await kvPut(id, c[id], 'LINE官方統計') },
  }
}

// 把一段期間的每日資料攤平成陣列（含跨月）
export async function loadDays(k, days) {
  const end = ymd(tpe()), start = addDays(end, -Math.max(1, Math.min(MAX_BACK + 10, days || 400)))
  const yms = new Set(); for (let d = start; d <= end; d = addDays(d, 1)) yms.add(d.slice(0, 7))
  const out = {}
  const docs = await Promise.all([...yms].map(ym => kvGet(moKey(k, ym)))) // 月檔並行讀（原本逐月讀 14 個月×4 帳號要 10 秒）
  for (const doc of docs) if (doc && doc.days) for (const [d, v] of Object.entries(doc.days)) if (d >= start && d <= end) out[d] = v
  return out
}

// 單一帳號：補缺的日子（昨天優先，再往回補最舊缺的）
async function collectAccount(a, mc, opts) {
  const { token } = creds(a)
  const st = (await kvGet(stKey(a.key))) || {}
  st.name = a.name
  const today = ymd(tpe()), yday = addDays(today, -1)
  const res = { acct: a.key, fetched: 0, unready: 0, errors: 0 }
  let calls = 0
  // 1) 找缺的日期：昨天 + 近 MAX_BACK 天裡沒有的（由近到遠）
  const want = []
  const have = await loadDays(a.key, MAX_BACK)
  const stopAt = st.noDataBefore || '' // LINE 回「這天以前沒資料」就記住，不再往前試
  for (let i = 0; i <= MAX_BACK && want.length < (opts.batch || BATCH); i++) { // i=0 今天：LINE 清晨就把今天那筆算好（官方後台「統計完成資料：至今日止」），抓得到就存，unready 下一小時再試
    const d = addDays(today, -i)
    if (stopAt && d <= stopAt) break
    if (!have[d]) want.push(d)
  }
  const nowIso = new Date().toISOString()
  for (const d of want) {
    if (calls >= 50) break
    const dd = d.replace(/-/g, '')
    try {
      calls++
      const f = await lineGet(`/insight/followers?date=${dd}`, token)
      if (f.status !== 'ready') { res.unready++; if (d !== yday && f.status === 'out_of_service') { st.noDataBefore = d; break } continue }
      const row = { f: num(f.followers), t: num(f.targetedReaches), b: num(f.blocks), at: nowIso }
      try { calls++; const m = await lineGet(`/insight/message/delivery?date=${dd}`, token); if (m.status === 'ready') { const mm = {}; for (const [kk, vv] of Object.entries(m)) if (kk !== 'status' && num(vv)) mm[kk] = num(vv); if (Object.keys(mm).length) row.m = mm } } catch (_) {}
      const doc = await mc.get(a.key, d.slice(0, 7)); doc.days[d] = row; mc.mark(a.key, d.slice(0, 7))
      have[d] = row; res.fetched++
      if ((d === yday || d === today) && !res.gotDay) { res.gotDay = d; res.gotYday = row } // 最新剛拿到的那天（今天優先）→ 警示用
    } catch (e) { res.errors++; res.err = e.message; if (e.status === 429) break }
  }
  // 2) 屬性＋額度：每小時抓一次很便宜（各 1 次）；屬性每 7 天留一份歷史
  try {
    const dg = await lineGet('/insight/demographic', token)
    if (dg && dg.available) {
      st.demo = { genders: dg.genders || [], ages: dg.ages || [], areas: dg.areas || [], appTypes: dg.appTypes || [], subs: dg.subscriptionPeriods || [] }
      st.demoAt = nowIso
      st.demoHist = st.demoHist || {}
      const hk = Object.keys(st.demoHist).sort(), last = hk[hk.length - 1]
      if (!last || addDays(last, 7) <= today) { st.demoHist[today] = st.demo; const ks = Object.keys(st.demoHist).sort(); while (ks.length > 60) delete st.demoHist[ks.shift()] }
    } else st.demoUnavailable = true
  } catch (e) { st.demoErr = e.message }
  try {
    const [q, c] = await Promise.all([lineGet('/message/quota', token), lineGet('/message/quota/consumption', token)])
    st.quota = { type: q.type || '', limit: q.value == null ? null : num(q.value), used: num(c.totalUsage), at: nowIso }
  } catch (_) {}
  // 3) 警示（只在昨天剛拿到時判）
  st.alerts = st.alerts || {}
  if (res.gotYday) {
    const gd = res.gotDay, prev = have[addDays(gd, -1)]
    const dB = prev ? res.gotYday.b - prev.b : 0
    if (dB >= 3 && st.alerts.block !== gd) { st.alerts.block = gd; await lineBoss(`⚠️「${a.name}」官方帳號 ${gd.slice(5).replace('-', '/')} 被封鎖 +${dB}（累計 ${res.gotYday.b}，好友 ${res.gotYday.f}）。可到 App 行銷大師→LINE 官方帳號看前後幾天有沒有群發訊息。`) }
  }
  if (st.quota && st.quota.limit) {
    const pct = st.quota.used / st.quota.limit, ym = today.slice(0, 7)
    for (const [lv, th] of [['q95', 0.95], ['q80', 0.8]]) {
      if (pct >= th && st.alerts[lv] !== ym) { st.alerts[lv] = ym; await lineBoss(`📣「${a.name}」官方帳號本月訊息額度已用 ${Math.round(pct * 100)}%（${st.quota.used}/${st.quota.limit} 則）。超過上限會發不出去，要加買方案或省著推。`); break }
    }
  }
  st.lastRun = nowIso
  await kvPut(stKey(a.key), st, 'LINE官方統計')
  res.calls = calls
  return res
}

// 全帳號摘要（DD 讀這一鍵；前端 KPI 也用同一套算法＝資料一致）
export function summarize(k, name, days, st) {
  const ds = Object.keys(days).sort(); if (!ds.length) return null
  const last = ds[ds.length - 1], L = days[last]
  const at = (n) => { const d = addDays(last, -n); return days[d] || null }
  const dlt = (p) => p ? { f: L.f - p.f, t: L.t - p.t, b: L.b - p.b } : null
  const ym = last.slice(0, 7), first = days[ds.find(d => d.startsWith(ym))]
  const mtd = first ? { f: L.f - first.f, b: L.b - first.b } : null
  const msg30 = {}; for (const d of ds.slice(-30)) for (const [kk, vv] of Object.entries((days[d] || {}).m || {})) msg30[kk] = (msg30[kk] || 0) + vv
  const demo = st && st.demo ? {
    gender: (st.demo.genders || []).map(g => `${GEN[g.gender] || g.gender}${Math.round(g.percentage)}%`).join('/'),
    age: (st.demo.ages || []).filter(x => x.age !== 'unknown' && x.percentage > 0).sort((a, b) => b.percentage - a.percentage).slice(0, 3).map(x => `${AGE[x.age] || x.age}歲${Math.round(x.percentage)}%`).join('、'),
    area: (st.demo.areas || []).filter(x => x.area !== 'unknown' && x.percentage > 0).sort((a, b) => b.percentage - a.percentage).slice(0, 3).map(x => `${x.area}${Math.round(x.percentage)}%`).join('、'),
  } : null
  return { key: k, name, date: last, f: L.f, t: L.t, b: L.b, d1: dlt(at(1)), d7: dlt(at(7)), d30: dlt(at(30)), mtd, msg30, demo, quota: (st && st.quota) || null, firstDay: ds[0], nDays: ds.length }
}
export const GEN = { male: '男', female: '女', unknown: '不明' }
export const AGE = { from0to14: '0~14', from15to19: '15~19', from20to24: '20~24', from25to29: '25~29', from30to34: '30~34', from35to39: '35~39', from40to44: '40~44', from45to49: '45~49', from50to54: '50~54', from55to59: '55~59', from60to64: '60~64', from65to69: '65~69', from70: '70+', from50: '50+', unknown: '不明' }

export async function runCollect(opts = {}) {
  const mc = monthCache()
  const out = []
  for (const a of ACCOUNTS) {
    if (!configured(a)) { out.push({ acct: a.key, skipped: '未設金鑰' }); continue }
    if (opts.only && opts.only !== a.key) continue
    try { out.push(await collectAccount(a, mc, opts)) } catch (e) { out.push({ acct: a.key, error: e.message }) }
  }
  await mc.flush()
  // 摘要
  const sum = { at: new Date().toISOString(), accts: {} }
  await Promise.all(ACCOUNTS.filter(configured).map(async a => {
    const [days, st] = await Promise.all([loadDays(a.key, 45), kvGet(stKey(a.key))])
    const s = summarize(a.key, a.name, days, st); if (s) sum.accts[a.key] = s
  }))
  await kvPut(SUM_KEY, sum, 'LINE官方統計')
  return { ok: true, accounts: out }
}

export default async function handler(req, res) {
  try {
    const q = req.query || {}
    const ok2 = clean(process.env.OPS_BOARD_KEY)
    if (q.lineoa != null) { // 前端讀
      if (!ok2 || String(q.lineoa) !== ok2) return res.status(403).json({ ok: false, error: '金鑰錯誤' })
      let ran = null
      if (q.run) { try { ran = await runCollect({ batch: 6 }) } catch (e) { ran = { ok: false, error: e.message } } }
      const nD = Math.min(MAX_BACK + 10, Math.max(7, Number(q.days) || 400))
      const accts = await Promise.all(ACCOUNTS.filter(configured).map(async a => {
        const [days, st] = await Promise.all([loadDays(a.key, nD), kvGet(stKey(a.key))])
        return { key: a.key, name: a.name, color: a.color, days, demo: (st && st.demo) || null, demoAt: (st && st.demoAt) || null, demoUnavailable: !!(st && st.demoUnavailable && !st.demo), demoHist: (st && st.demoHist) || {}, quota: (st && st.quota) || null, lastRun: (st && st.lastRun) || null, sum: summarize(a.key, a.name, days, st) }
      }))
      return res.status(200).json({ ok: true, accts, ran })
    }
    // cron／手動：?batch=N&only=gd
    const out = await runCollect({ batch: Math.min(28, Number(q.batch) || BATCH), only: q.only ? String(q.only) : '' })
    return res.status(200).json(out)
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }) }
}

async function lineBoss(text) {
  try { const tk = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN), boss = clean(process.env.LINE_BOSS_USER) || 'Uf7ce4fb9191cd3055247204e0cb6b4fc'; if (tk && boss) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: boss, messages: [{ type: 'text', text }] }) }) } catch (_) {}
}
