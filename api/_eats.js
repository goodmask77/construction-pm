// ── A Beach（Eats365 商家後台）即時營業額（張良 2026-09-02）──────────────────
// 日結信要打烊才寄＝白天看不到 AB 今天的數字 → 直接登入 mpphk.eats365pos.com 抓儀表板。
// 登入流程（全逆向自 sign-in 頁）：
//   ① GET /sign-in → meta _csrf（X-XSRF-TOKEN）＋頁內 var csid（X-XSRF-SESSION，兩個都要不然靜默失敗）
//   ② POST /sign-in JSON {u,p,rmb} → code 0=成功；code 101=要 OTP（email 驗證碼）
//      —— 首次 OTP 完成時勾了「這台裝置不再詢問」＝發 30 天裝置 cookie（名稱=email 的 base64，尾巴帶「|」）；
//      之後帶著這顆 cookie 登入就直接 code 0。cookie 滾動存 kv（sp_finance_pm_eats_sess），env 只是第一顆種子。
//   ③ 登入後再 GET 一次頁面拿「綁 session 的」新 csrf/csid → 打資料 API
// 資料 API：POST /report/dashboard/shop {start,end,rCode,groupByType:1}＋EATS365-* 三顆 context 標頭
//   ⚠️ 營業額要用 totalNetSales（=日結信口徑，9/1=30,614 驗證一致）；totalSales 少了服務費。
// 入庫：sp_finance_pm_ablive = {date,revenue,tx,at,updatedAt}（只存今天，明天日結信入庫即接手）
// 若裝置 cookie 過期回 code 101 → 丟明確錯誤（要張良再收一次 email 驗證碼重種）。
const BASE = 'https://mpphk.eats365pos.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const CTX = { org: '115964', brand: '118391', rcode: 'TWTP001331' } // 口香糖俱樂部／A Beach 101&Pizza（organization/getFullBrandList 撈的）

function makeJar(seedCookie) {
  const jar = {}
  if (seedCookie) { const i = seedCookie.indexOf('='); if (i > 0) jar[seedCookie.slice(0, i)] = seedCookie.slice(i + 1) }
  const capture = (res) => {
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    sc.forEach((c) => { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1) })
  }
  const cookieStr = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
  return { jar, capture, cookieStr }
}

const pickCsrf = (html) => ({
  tok: (html.match(/_csrf" content="([^"]+)/) || [])[1],
  csid: (html.match(/var csid = "([^"]+)"/) || [])[1],
})

async function eatsSession(deviceCookie) {
  const J = makeJar(deviceCookie)
  let r = await fetch(BASE + '/sign-in', { headers: { 'User-Agent': UA, Cookie: J.cookieStr() } })
  J.capture(r)
  let { tok, csid } = pickCsrf(await r.text())
  if (!tok || !csid) throw new Error('eats: sign-in 頁拿不到 csrf/csid')
  r = await fetch(BASE + '/sign-in', {
    method: 'POST',
    headers: { 'User-Agent': UA, Cookie: J.cookieStr(), 'X-XSRF-TOKEN': tok, 'X-XSRF-SESSION': csid, 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/json', Origin: BASE, Referer: BASE + '/sign-in' },
    body: JSON.stringify({ u: process.env.EATS_USER, p: process.env.EATS_PASS, rmb: true }),
  })
  J.capture(r)
  const j = await r.json().catch(() => null)
  if (!j || j.code !== 0) throw new Error(j && j.code === 101 ? 'eats: 裝置驗證過期，要重新收 email 驗證碼' : 'eats: 登入失敗 code=' + (j && j.code))
  r = await fetch(BASE + '/v2/dashboard', { headers: { 'User-Agent': UA, Cookie: J.cookieStr() } })
  J.capture(r)
  const fresh = pickCsrf(await r.text())
  if (!fresh.tok || !fresh.csid) throw new Error('eats: 登入後拿不到 csrf/csid')
  return { J, tok: fresh.tok, csid: fresh.csid }
}

async function eatsFetchDay(sess, date) {
  const r = await fetch(BASE + '/report/dashboard/shop', {
    method: 'POST',
    headers: { 'User-Agent': UA, Cookie: sess.J.cookieStr(), 'X-XSRF-TOKEN': sess.tok, 'X-XSRF-SESSION': sess.csid, 'EATS365-RESTAURANT-CODE': CTX.rcode, 'EATS365-BRAND-ID': CTX.brand, 'EATS365-ORGANIZATION-ID': CTX.org, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ start: date + ' 00:00', end: date + ' 23:59', isCompared: false, compareStart: '', compareEnd: '', rCode: CTX.rcode, groupByType: 1 }),
  })
  if (!r.ok) throw new Error('eats: fetch ' + r.status)
  return await r.json()
}

// 同步「AB 今天即時」：kvGet/kvPut 由 mail-sync 傳入（共用入庫＋廣播）。回傳 {revenue,tx} 供更新訊息用。
export async function syncEatsLive(kvGet, kvPut) {
  if (!process.env.EATS_USER || !process.env.EATS_PASS) return null
  const sessDoc = (await kvGet('sp_finance_pm_eats_sess')) || {}
  const sess = await eatsSession(sessDoc.device || process.env.EATS_DEVICE_COOKIE || '')
  // 裝置 cookie 滾動續期：登入若重發（名稱=email base64、尾帶「|」）就存新的，30 天期限一直往後推
  const devName = Object.keys(sess.J.jar).find((k) => k.endsWith('|'))
  if (devName) await kvPut('sp_finance_pm_eats_sess', { device: devName + '=' + sess.J.jar[devName], updatedAt: new Date().toISOString() }, 'AB即時')
  const tw = new Date(Date.now() + 8 * 3600e3)
  const date = tw.toISOString().slice(0, 10)
  const d = await eatsFetchDay(sess, date)
  const doc = {
    date,
    revenue: Math.round(Number(d.totalNetSales) || 0), // 日結信同口徑（totalSales 少服務費，別用）
    tx: Number(d.totalTransaction) || 0,
    at: tw.toISOString().slice(11, 16),
    updatedAt: new Date().toISOString(),
  }
  await kvPut('sp_finance_pm_ablive', doc, 'AB即時')
  return { revenue: doc.revenue, tx: doc.tx }
}
