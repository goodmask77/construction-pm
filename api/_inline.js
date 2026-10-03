// ── A Beach inline 訂位系統（host.inline.app 逆向，張良 2026-10-03）──────────
// 登入：Firebase 帳密（identitytoolkit signInWithPassword）→ idToken（效期 1h，每次執行重登即可）
// 資料 API：host-web-api.inline.app，authorization 標頭＝「裸 idToken」⚠️不加 Bearer（加了會 401 decode failed）
// 訂位：GET /v2/reservations/dailyUpdated?companyId&branchId&day=YYYY-MM-DD&timestamp=0
//   → 回 NDJSON（一行一筆 JSON，不是陣列），含已取消/未出席/候位，day=訂位日（不是建立日）
// 狀態碼（2026-10-03 實測比對 acceptedTime/seatedTime/canceledTime/previousState）：
//   1=已確認(預設) 3=待確認(prev 1,未accept) 6=已確認(店家已接受,有acceptedTime,prev 3) 4=已入座(完成)
//   2=已取消 5=已取消(變體,也有canceledTime)——「有效訂位」＝state 不在 {2,5}
// 搜尋端點：GET /search?companyId&branchId&keyword=&filterType=booking&offset=N&rawData=true
//   → 空 keyword=全部訂位且「未來的排最前面(由遠到近)」→ 翻頁翻到過去日就收齊全部未來訂位（答婚顧/包場用）
// 資料起點：2021-02-10（開店以來全在線上）
const FIREBASE_KEY = 'AIzaSyAfHlsBd2WjrijkX4G26oHo0Tci-TZ5E-g' // host.inline.app 前端公開 key（不是機密）
export const INLINE_COMPANY = '-MSaZaOu2SoK0rtCNgCK:inline-live-2' // 口香糖俱樂部
export const INLINE_BRANCH = '-MSaZaX5Lt2HleQp32OL' // A Beach 101&Pizza

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()

export async function inlineLogin() {
  const email = clean(process.env.INLINE_EMAIL), pass = clean(process.env.INLINE_PASS)
  if (!email || !pass) throw new Error('inline: 未設 INLINE_EMAIL/INLINE_PASS')
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true, email, password: pass, clientType: 'CLIENT_TYPE_WEB' }),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.idToken) throw new Error('inline: 登入失敗 ' + (j?.error?.message || r.status))
  return j.idToken
}

// 時間戳(ms) → 台北時間字串
const tw = (ms, fmt) => {
  if (!ms) return null
  const d = new Date(ms + 8 * 3600e3).toISOString()
  return fmt === 'hm' ? d.slice(11, 16) : d.slice(0, 16).replace('T', ' ')
}

// 瘦身：一筆原始 ~2KB → ~0.2KB（月檔才塞得下整月）；欄位缺省就不佔 key
function trimResv(x) {
  const o = {
    id: x.id,
    t: tw(x.reservationTime, 'hm'), // 訂位時間（台北 HH:mm；候位單沒有=null）
    name: x.customer?.name || '',
    phone: x.customer?.phoneNumber || '',
    n: x.groupSize || 0,
    st: x.state, // 1確認/2取消/4入座/5未出席
  }
  if (x.customer?.customerId) o.cid = x.customer.customerId // 客人ID＝inline 客人檔同人合併的 key（同人會用不同名字/有時沒留電話，電話當 key 會漏；張良 2026-10-03 楊主委=楊安娜案）
  if (x.customer?.email) o.email = x.customer.email
  if (x.numberOfKidChairs) o.kc = x.numberOfKidChairs
  if (x.numberOfKidSets) o.ks = x.numberOfKidSets
  if (x.customerNote) o.note = x.customerNote // 客人備註（用餐目的等）
  if (x.note) o.inote = typeof x.note === 'string' ? x.note : (x.note?.note || undefined) // 店內註記（搜尋端點回物件 {noteId,note}）
  if (Array.isArray(x.tags) && x.tags.length) o.tags = x.tags
  if (x.createdFrom) o.src = x.createdFrom // web/ios 等
  if (x.referer) o.ref = x.referer // 流量來源（google/fb…）
  if (x.createdTime) o.created = tw(x.createdTime)
  if (x.canceledTime) o.canceled = tw(x.canceledTime)
  if (x.seatedTime) o.seated = tw(x.seatedTime)
  if (x.reservationTime == null) o.waitlist = 1 // 現場候位單（沒有預約時間）
  return o
}

export const STATE_TXT = { 1: '已確認', 2: '已取消', 3: '待確認', 4: '已入座', 5: '已取消', 6: '已確認' }
export const CANCELED_STATES = [2, 5] // 「有效訂位」＝state 不在這裡面

// 抓一天的全部訂位（day=訂位日 YYYY-MM-DD）→ 瘦身後陣列（依時間排序）
// ⚠️坑（2026-10-03 實測）：空日（無任何訂位的日子）inline 後端會「吊 60 秒」才回 0 筆（有資料日 <1 秒）
//   → 6 秒逾時當「跳過」丟 TIMEOUT 錯，呼叫端別把逾時日當空日去刪舊資料
export async function inlineFetchDay(token, day) {
  const u = `https://host-web-api.inline.app/v2/reservations/dailyUpdated?companyId=${encodeURIComponent(INLINE_COMPANY)}&branchId=${INLINE_BRANCH}&day=${day}&timestamp=0`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  let r, txt
  try {
    r = await fetch(u, { headers: { authorization: token, accept: 'application/json' }, signal: ctrl.signal })
    if (!r.ok) throw new Error(`inline: fetchDay ${day} ${r.status}`)
    txt = await r.text()
  } catch (e) {
    if (e?.name === 'AbortError' || /abort/i.test(e?.message || '')) { const err = new Error(`inline: fetchDay ${day} TIMEOUT(空日慢回)`); err.isTimeout = true; throw err }
    throw e
  } finally { clearTimeout(timer) }
  const rows = txt.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
  return rows.map(trimResv).sort((a, b) => (a.t || '99') < (b.t || '99') ? -1 : 1)
}

// 當日備註（host 後台日曆上的⚠️包場/公休註記；張良 2026-10-03 截圖問的那個）
// 存在 Firebase RTDB：branchDailyNotes/<companyId>/<branchId>/<date>/{noteId:{note,createdBy,updatedBy,updatedTime}}
// REST 一次整包：GET https://inline-live-2.firebaseio.com/branchDailyNotes/<C>/<B>.json?auth=<idToken>
// （同一顆 idToken 可用；根路徑被規則擋 401、這條子路徑可讀；2026-10 實測 1507 天 841KB）
export async function inlineFetchDayNotes(token) {
  const u = `https://inline-live-2.firebaseio.com/branchDailyNotes/${encodeURIComponent(INLINE_COMPANY)}/${INLINE_BRANCH}.json?auth=${token}`
  const r = await fetch(u)
  if (!r.ok) throw new Error(`inline: dayNotes ${r.status}`)
  const j = await r.json() || {}
  const out = {} // { 'YYYY-MM-DD': [{note, by, at}] }
  for (const [d, m] of Object.entries(j)) {
    const arr = Object.values(m || {})
      .filter((n) => (n.note || '').trim())
      .map((n) => ({ note: n.note.trim(), by: n.updatedBy?.name || n.createdBy?.name || '', at: tw(n.updatedTime || n.createdTime) }))
    if (arr.length) out[d] = arr
  }
  return out
}

// 關鍵字搜尋（＝host 後台搜尋框同源；姓名/電話/備註都搜得到、全史含未來，未來排最前）
// 回 { total, rows: [{d:'YYYY-MM-DD', ...瘦身}] }，最多 maxRows 筆
export async function inlineSearchKeyword(token, keyword, maxRows = 40) {
  const rows = []
  let total = 0, offset = 0
  while (rows.length < maxRows && offset <= 200) {
    const u = `https://host-web-api.inline.app/search?companyId=${encodeURIComponent(INLINE_COMPANY)}&branchId=${INLINE_BRANCH}&keyword=${encodeURIComponent(keyword)}&filterType=booking&offset=${offset}&rawData=true`
    const r = await fetch(u, { headers: { authorization: token, accept: 'application/json' } })
    if (!r.ok) throw new Error(`inline: search ${r.status}`)
    const j = await r.json()
    total = j?.reservation?.total || 0
    const batch = j?.reservation?.reservations || []
    if (!batch.length) break
    for (const x of batch) {
      if (rows.length >= maxRows) break
      rows.push({ d: x.reservationTime ? new Date(x.reservationTime + 8 * 3600e3).toISOString().slice(0, 10) : null, ...trimResv(x) })
    }
    offset += batch.length
  }
  return { total, rows }
}

// 客人檔（inline 官方統計＝App 客人頁同數字；張良 2026-10-03：楊主委/楊安娜同人被 inline 在客人檔層合併，
// 訂位原始紀錄各帶舊 cid 合不回來 → 次數以這支官方 statistics 為準，自己聚合只拿來排序選人）
export async function inlineCustomer(token, cid) {
  const r = await fetch(`https://host-web-api.inline.app/customers/${encodeURIComponent(INLINE_COMPANY)}/${cid}`, { headers: { authorization: token, accept: 'application/json' } })
  if (!r.ok) return null
  const j = await r.json().catch(() => null)
  if (!j) return null
  return { name: j.name || '', phone: j.phoneNumber || '', stats: j.statistics || null }
}

// 全部「未來」訂位（搜尋端點翻頁；婚顧包場問 2027/2028 哪天被訂就靠這個）
// 回 { 'YYYY-MM-DD': [瘦身訂位…] }；翻到第一筆過去日就停（未來排最前、由遠到近）
export async function inlineSearchFuture(token) {
  const byDate = {}
  let offset = 0
  while (offset <= 4000) { // 保險上限（未來訂位通常 <500 筆）
    const u = `https://host-web-api.inline.app/search?companyId=${encodeURIComponent(INLINE_COMPANY)}&branchId=${INLINE_BRANCH}&keyword=&filterType=booking&offset=${offset}&rawData=true`
    const r = await fetch(u, { headers: { authorization: token, accept: 'application/json' } })
    if (!r.ok) throw new Error(`inline: searchFuture ${r.status}`)
    const j = await r.json()
    const rows = j?.reservation?.reservations || []
    if (!rows.length) break
    let hitPast = false
    for (const x of rows) {
      if (!x.reservationTime || x.reservationTime < Date.now()) { hitPast = true; break }
      const d = new Date(x.reservationTime + 8 * 3600e3).toISOString().slice(0, 10)
      ;(byDate[d] = byDate[d] || []).push(trimResv(x))
    }
    if (hitPast) break
    offset += rows.length
  }
  for (const d of Object.keys(byDate)) byDate[d].sort((a, b) => (a.t || '99') < (b.t || '99') ? -1 : 1)
  return byDate
}
