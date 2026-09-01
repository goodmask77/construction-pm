// ── iCHEF 後台自動抓取（張良 2026-09-01）──────────────────────────────────────
// 兩間參考店的每日營業額，畫面上只標「1」「2」不露店名（張良：不要讓其他人知道是哪兩間）。
// 流程：GET / 拿 csrf → POST 登入（Django 表單，要 Referer+Origin 不然 403）→
//       任一後台頁 HTML 內嵌 login_token → /analyse/api/business_situation/ 帶
//       Authorization: token <login_token>（單發 cookie 不夠，缺 token 回 401）。
// 憑證：ICHEF_S1_*（=1）/ ICHEF_S2_*（=2），Vercel env＋.env.local；缺哪家就跳過哪家。
// 入庫：sp_finance_pm_ichef = { days: { 'YYYY-MM-DD': { s1: 營業額, s2: 營業額 } }, updatedAt }
//       只增/覆蓋當日值（重跑冪等）；掛在 mail-sync 每小時 cron，失敗不影響收信主流程。
const BASE = 'https://admin.ichef.tw'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

async function ichefLogin(storeId, account, password) {
  const jar = {}
  const capture = (res) => {
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    sc.forEach((c) => { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1) })
  }
  const cookieStr = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
  let r = await fetch(BASE + '/', { headers: { 'User-Agent': UA }, redirect: 'manual' })
  capture(r)
  const tok = ((await r.text()).match(/csrfmiddlewaretoken" value="([^"]+)/) || [])[1]
  if (!tok) throw new Error('ichef: csrf token not found')
  r = await fetch(BASE + '/', {
    method: 'POST', redirect: 'manual',
    headers: { 'User-Agent': UA, Cookie: cookieStr(), Referer: BASE + '/', Origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfmiddlewaretoken: tok, store_id: storeId, account, password }).toString(),
  })
  capture(r)
  if (r.status !== 302) throw new Error('ichef: login failed ' + r.status)
  r = await fetch(BASE + '/setting/notification-center', { headers: { 'User-Agent': UA, Cookie: cookieStr() } })
  const lt = ((await r.text()).match(/login_token = '([^']+)'/) || [])[1]
  if (!lt) throw new Error('ichef: login_token not found')
  return { cookie: cookieStr(), token: lt }
}

// 抓一段期間的每日營業額 → { 'YYYY-MM-DD': 金額 }（business_situation 的 total_amount，與後台「營運概況」同一數字）
async function ichefFetchRange(sess, from, to) {
  const u = `${BASE}/analyse/api/business_situation/?start_date=${from}&end_date=${to}&start_hour=0&end_hour=24`
  const r = await fetch(u, { headers: { 'User-Agent': UA, Cookie: sess.cookie, Authorization: 'token ' + sess.token, Accept: 'application/json' } })
  if (!r.ok) throw new Error('ichef: fetch ' + r.status)
  const cd = (await r.json()).current_data || {}
  const out = {}
  ;(cd.date || []).forEach((dt, i) => { out[dt] = Math.round(Number((cd.total_amount || [])[i]) || 0) })
  return out
}

// 同步入庫：kvGet/kvPut 由 mail-sync 傳入（共用同一條入庫＋廣播管線）。回傳 {s1:天數, s2:天數} 供 log。
export async function syncIchef(kvGet, kvPut, days = 60) {
  const stores = [
    ['s1', process.env.ICHEF_S1_STORE, process.env.ICHEF_S1_USER, process.env.ICHEF_S1_PASS],
    ['s2', process.env.ICHEF_S2_STORE, process.env.ICHEF_S2_USER, process.env.ICHEF_S2_PASS],
  ].filter(([, sid, acc, pw]) => sid && acc && pw)
  if (!stores.length) return null
  const tw = new Date(Date.now() + 8 * 3600e3) // 台灣時區的今天
  const d2s = (d) => d.toISOString().slice(0, 10)
  const to = d2s(tw), from = d2s(new Date(tw.getTime() - days * 86400e3))
  const doc = (await kvGet('sp_finance_pm_ichef')) || { days: {} }
  const got = {}
  for (const [key, sid, acc, pw] of stores) {
    const sess = await ichefLogin(sid, acc, pw)
    const daily = await ichefFetchRange(sess, from, to)
    let n = 0
    for (const [dt, amt] of Object.entries(daily)) {
      if (!(amt > 0) && !(doc.days[dt]?.[key] > 0)) continue // 0 元（沒開/未來日）不入庫，已有值則保留
      doc.days[dt] = { ...(doc.days[dt] || {}), [key]: amt }
      n++
    }
    got[key] = n
  }
  doc.updatedAt = new Date().toISOString()
  await kvPut('sp_finance_pm_ichef', doc, 'iCHEF自動抓取')
  return got
}
