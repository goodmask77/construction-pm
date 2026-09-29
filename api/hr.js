// NUEiP 人資系統同步（張良 2026-09-30：夥伴中心「人資系統」頁＝出勤紀錄每人每天＋每日自動抓＋異常LINE通知）
// 登入＝純 HTTP（免驗證碼）：POST cloud.nueip.com/login/index/param → cookie
// 打卡竅門：條件先 POST 整張表單到 /attendance_record 寫進伺服器 session，再打 /attendance_record/ajax（詳見記憶 nueip-scrape）
// 存檔：sp_crew_pm_hr_att_YYYY-MM = { days: { 日期: { 工號: 精簡紀錄 } } }（月檔合併、重跑冪等）
// 機密界線：出勤資料只進主 App（帳號權限管），不進 /prep 共用金鑰頁
import { kvGet, kvPut } from './mail-sync.js'

const CO = (process.env.NUEIP_COMPANY || '').trim()
const ID = (process.env.NUEIP_USER || '').trim()
const PW = (process.env.NUEIP_PASS || '').trim()
const FLAYER = '25777' // 公司層（abeach）

function jarFrom(res, jar = {}) {
  const arr = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  arr.forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1) })
  return jar
}
const ckStr = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')

async function login() {
  if (!CO || !ID || !PW) throw new Error('缺 NUEIP_* 環境變數')
  const body = new URLSearchParams({ inputCompany: CO, inputID: ID, inputPassword: PW })
  const r = await fetch('https://cloud.nueip.com/login/index/param', { method: 'POST', body, redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
  const jar = jarFrom(r)
  if (!jar.PHPSESSID) throw new Error('NUEiP 登入失敗（沒拿到 session，帳密改了？）')
  return jar
}

// 抓區間出勤（全公司）→ 正規化列
export async function fetchAttendance(from, to) {
  const jar = await login()
  const ck = ckStr(jar)
  const form1 = new URLSearchParams({ action: 'attendance', export: '1', work_status: '1', FLayer: FLAYER, SLayer: '', TLayer: '', date_start: from, date_end: to, showByBelongDate: '1', filterModify: '0' })
  const r1 = await fetch('https://cloud.nueip.com/attendance_record', { method: 'POST', body: form1, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: ck } })
  jarFrom(r1, jar)
  const out = {} // 日期 → 工號 → rec
  let batch = 1, total = 1
  do {
    const f = new URLSearchParams({ action: 'attendance', loadInBatch: '1', loadBatchGroupNum: '2000', loadBatchNumber: String(batch), work_status: '1' })
    const r = await fetch('https://cloud.nueip.com/attendance_record/ajax', { method: 'POST', body: f, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: ckStr(jar), 'x-requested-with': 'XMLHttpRequest' } })
    const j = await r.json()
    total = Number(j.loadBatchTotalNumber) || 1
    for (const [d, users] of Object.entries(j.data || {})) {
      out[d] = out[d] || {}
      for (const rec of Object.values(users)) {
        const u = rec.user || {}
        const a = rec.attendance || {}
        const p = rec.punch || {}
        const times = (arr) => (Array.isArray(arr) ? arr : []).map(x => x.time ? x.time.slice(0, 5) : '').filter(Boolean)
        const on = times(p.onPunch), off = times(p.offPunch)
        const work = rec.worktime || ''
        if (!work && !on.length && !off.length) continue // 沒班沒卡不佔空間
        out[d][u.u_no || String(u.u_sn)] = {
          name: u.name || '', dept: (u.deptname || '').replace(/ＡＢ/g, 'AB').replace(/ＧＤ/g, 'GD'),
          title: u.titleName || '', work, on, off,
          durmin: Number(a.durminhour) || 0,
          late: Number(a.latemin) || 0, early: Number(a.leaveearlymin) || 0,
          miss: a.miss_punch !== '0' && a.miss_punch != null ? 1 : 0,
          absent: a.absent !== '0' && a.absent != null ? 1 : 0,
        }
      }
    }
    batch++
  } while (batch <= total && batch < 40)
  return out
}

// 寫月檔（合併；同日同人覆蓋＝以最新抓到為準）
async function store(days) {
  const byMo = {}
  for (const d of Object.keys(days)) (byMo[d.slice(0, 7)] = byMo[d.slice(0, 7)] || {})[d] = days[d]
  const rep = {}
  for (const [mo, part] of Object.entries(byMo)) {
    const id = 'sp_crew_pm_hr_att_' + mo
    const doc = (await kvGet(id)) || { days: {} }
    for (const [d, users] of Object.entries(part)) doc.days[d] = users
    doc.updatedAt = new Date().toISOString()
    await kvPut(id, doc, 'NUEiP出勤同步')
    rep[mo] = Object.keys(part).length
  }
  return rep
}

// 異常清單（遲到/早退/缺卡/曠職）
const anomalies = (users) => Object.entries(users || {}).flatMap(([no, r]) => {
  const fx = []
  if (r.absent) fx.push('曠職')
  if (r.miss) fx.push('缺卡')
  if (r.late) fx.push(`遲到${r.late}分`)
  if (r.early) fx.push(`早退${r.early}分`)
  return fx.length ? [`・${r.name}（${r.dept}）${r.work ? ' 班' + r.work : ''}：${fx.join('、')}`] : []
})

export default async function handler(req, res) {
  const tz = new Date(Date.now() + 8 * 3600e3) // 台北
  const today = tz.toISOString().slice(0, 10)
  const isCron = !!req.headers['x-vercel-cron']
  const manual = String(req.query?.manual || '')
  if (!isCron && !manual) return res.status(200).json({ ok: false, hint: '要手動同步帶 ?manual=1[&from=YYYY-MM-DD&to=YYYY-MM-DD]' })
  try {
    const from = String(req.query?.from || '') || today
    const to = String(req.query?.to || '') || today
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ ok: false, error: '日期格式 YYYY-MM-DD' })
    const days = await fetchAttendance(from, to)
    const rep = await store(days)
    let n = 0; for (const d of Object.keys(days)) n += Object.keys(days[d]).length
    // 每日 cron（收班後）：今天的異常 → D哥 LINE 通知老闆（記推播額度）
    let notified = 0
    if (isCron && days[today]) {
      const lines = anomalies(days[today])
      if (lines.length) {
        try {
          const { linePush } = await import('./_onboard.js')
          const { logPush } = await import('./push.js')
          const ops = (await kvGet('pm_bot_operators')) || {}
          const txt = `🕐 NUEiP 出勤異常 ${today.slice(5).replace('-', '/')}\n${lines.slice(0, 15).join('\n')}${lines.length > 15 ? `\n…共 ${lines.length} 筆` : ''}\n（詳細：夥伴中心 → 人資系統）`
          for (const uid of Object.keys(ops)) { if (await linePush(uid, txt)) { await logPush(uid, 1, 'NUEiP出勤異常'); notified++ } }
        } catch (_) {}
      }
    }
    return res.status(200).json({ ok: true, from, to, personDays: n, months: rep, notified })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
