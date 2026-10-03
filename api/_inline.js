// ── A Beach inline 訂位系統（host.inline.app 逆向，張良 2026-10-03）──────────
// 登入：Firebase 帳密（identitytoolkit signInWithPassword）→ idToken（效期 1h，每次執行重登即可）
// 資料 API：host-web-api.inline.app，authorization 標頭＝「裸 idToken」⚠️不加 Bearer（加了會 401 decode failed）
// 訂位：GET /v2/reservations/dailyUpdated?companyId&branchId&day=YYYY-MM-DD&timestamp=0
//   → 回 NDJSON（一行一筆 JSON，不是陣列），含已取消/未出席/候位，day=訂位日（不是建立日）
// 狀態碼（2026-10-03 實測比對 seatedTime/canceledTime）：1=已確認 2=已取消 4=已入座(完成) 5=未出席no-show；其他保留原碼
// 資料起點：2021-02-10（開店以來全在線上）；未來訂位最遠約 +1 個月
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
  if (x.customer?.email) o.email = x.customer.email
  if (x.numberOfKidChairs) o.kc = x.numberOfKidChairs
  if (x.numberOfKidSets) o.ks = x.numberOfKidSets
  if (x.customerNote) o.note = x.customerNote // 客人備註（用餐目的等）
  if (x.note) o.inote = x.note // 店內註記
  if (Array.isArray(x.tags) && x.tags.length) o.tags = x.tags
  if (x.createdFrom) o.src = x.createdFrom // web/ios 等
  if (x.referer) o.ref = x.referer // 流量來源（google/fb…）
  if (x.createdTime) o.created = tw(x.createdTime)
  if (x.canceledTime) o.canceled = tw(x.canceledTime)
  if (x.seatedTime) o.seated = tw(x.seatedTime)
  if (x.reservationTime == null) o.waitlist = 1 // 現場候位單（沒有預約時間）
  return o
}

export const STATE_TXT = { 1: '已確認', 2: '已取消', 4: '已入座', 5: '未出席' }

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
