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

// ── NUEiP 高效排班（hrm-next）逆向 2026-10-04（張良「高婕瀅直接從人資系統抓,我們有串好」）──
// 鏈：classic cookie → GET cloud/oauth2/token/api 換 JWT → api.nueip.com/hrm/*（Bearer）
// POST /hrm/shift/search/search {department,start_date,end_date} 回應就含每天每人班（shift_schedule_list[].shift_info[].shift_list）
// GET /hrm/shift/search/basic-configs?shift_schedule_list_id[]= → shift_id→縮寫（Ｄ/沙/⚪休/🔴例…）；user_info 給官方 is_part_time
export async function fetchShifts(from, to) {
  const jar = await login()
  const tj = await (await fetch('https://cloud.nueip.com/oauth2/token/api', { headers: { cookie: ckStr(jar) } })).json()
  const jwt = tj.token_access_token
  if (!jwt) throw new Error('NUEiP JWT 換發失敗')
  const H = { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' }
  const dt = await (await fetch('https://api.nueip.com/hrm/organization/departments-tree', { headers: H })).json()
  const depts = []
  const walkD = (arr) => { for (const x of (arr || [])) { depts.push({ id: Number(x.department_id), name: x.name || '' }); walkD(x.sub_department_list) } }
  walkD(dt.data?.department_list)
  const ab = depts.filter(x => /ＡＢ|AB/.test(x.name) && /場/.test(x.name)) // ＡＢ外場/ＡＢ內場（管理部不排班）
  if (!ab.length) throw new Error('NUEiP 部門樹找不到 AB 內外場')
  const sr = await (await fetch('https://api.nueip.com/hrm/shift/search/search', { method: 'POST', headers: H, body: JSON.stringify({ department: ab.map(x => ({ id: x.id, type: 'dept' })), start_date: from, end_date: to, keyword: '', self_only: false }) })).json()
  const lists = new Set(), users = {}, raw = {}
  const deptShort = (n) => /內場/.test(n) ? '內場' : /外場/.test(n) ? '外場' : String(n || '')
  for (const dep of (sr.data || [])) {
    for (const u of (dep.user_info || [])) users[u.user_id] = { name: String(u.user_name || '').replace(/\s+[A-Za-z].*$/, ''), pt: !!u.is_part_time, dept: deptShort(dep.dept_name) }
    for (const sl of (dep.shift_schedule_list || [])) {
      if (sl.shift_schedule_list_id) lists.add(sl.shift_schedule_list_id)
      for (const di of (sl.shift_info || [])) for (const s of (di.shift_list || [])) {
        if (di.shift_date) (raw[di.shift_date] = raw[di.shift_date] || []).push({ uid: s.shift_user, sid: s.shift_id, wt: (s.working_times || [])[0] || null })
      }
    }
  }
  const qs2 = [...lists].map(id => 'shift_schedule_list_id%5B%5D=' + id).join('&')
  const cf = qs2 ? await (await fetch('https://api.nueip.com/hrm/shift/search/basic-configs?' + qs2, { headers: H })).json() : { data: [] }
  const codeOf = {}
  for (const c of (cf.data || [])) codeOf[c.shift_schedule_basic_config_id] = { code: c.abbreviation || c.name || '', brk: c.type === 'break' ? 1 : 0 }
  const days = {}
  for (const [d, list] of Object.entries(raw)) {
    days[d] = list.map(x => {
      const u = users[x.uid] || {}, c = codeOf[x.sid] || {}
      return { name: u.name || '', dept: u.dept || '', pt: u.pt ? 1 : 0, code: c.code || '', brk: c.brk || 0, start: x.wt?.start_time || '', end: x.wt?.end_time || '' }
    }).filter(x => x.name)
  }
  const staff = [...new Set(Object.values(users).map(u => u.name).filter(Boolean))] // v4.32.3 NUEiP 部門現役名單＝在職權威（名冊沒人填離職日）
  return { days, staff }
}

// 班表寫月檔 sp_crew_pm_hr_sched_YYYY-MM = { days: { 日期: [列…] } }（同日整天覆蓋＝以最新為準）
async function storeShifts(days) {
  const byMo = {}
  for (const d of Object.keys(days)) (byMo[d.slice(0, 7)] = byMo[d.slice(0, 7)] || {})[d] = days[d]
  const rep = {}
  for (const [mo, part] of Object.entries(byMo)) {
    const id = 'sp_crew_pm_hr_sched_' + mo
    const doc = (await kvGet(id)) || { days: {} }
    for (const [d, list] of Object.entries(part)) doc.days[d] = list
    doc.updatedAt = new Date().toISOString()
    await kvPut(id, doc, 'NUEiP班表同步')
    rep[mo] = Object.keys(part).length
  }
  return rep
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
  // 2026-10-01 治本（張良：為什麼都沒自動更新）：Vercel 排程請求「沒有」x-vercel-cron 標頭——
  // 之前只認標頭＝排程每20分打進來全被擋在門口。改跟 joya-intraday 同款：裸呼叫（沒帶 manual）＝排程，照樣同步；通知只在裸呼叫發（手動更新不觸發通知）
  const manual = String(req.query?.manual || '')
  const isCron = !manual
  try {
    const addD = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
    // 班表同步口（?shifts=1[&from&to]；預設 前7天~後35天）：/prep AB 班表的資料來源（張良 2026-10-04 拍板 NUEiP 為準）
    if (req.query?.shifts) {
      const fromS = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : addD(today, -7)
      const toS = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : addD(today, 35)
      const fs9 = await fetchShifts(fromS, toS)
      const daysS = fs9.days
      const repS = await storeShifts(daysS)
      if (fromS <= today && today <= toS && (fs9.staff || []).length) await kvPut('sp_crew_pm_hr_staff', { names: fs9.staff, updatedAt: new Date().toISOString() }, 'NUEiP在職名單') // 只有「涵蓋今天」的同步才更新在職名單（歷史回補不能蓋）
      let nS = 0; for (const d of Object.keys(daysS)) nS += daysS[d].length
      return res.status(200).json({ ok: true, from: fromS, to: toS, personDays: nS, months: repS, staff: (fs9.staff || []).length })
    }
    const from = String(req.query?.from || '') || today
    const to = String(req.query?.to || '') || today
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ ok: false, error: '日期格式 YYYY-MM-DD' })
    const days = await fetchAttendance(from, to)
    const rep = await store(days)
    let n = 0; for (const d of Object.keys(days)) n += Object.keys(days[d]).length
    // cron 分兩種（張良 2026-09-30「遲到打卡要即時通知」）：
    // ①營業時間每20分掃：誰打卡被判遲到→馬上通知（同人同天只推一次，pm_hr_notif 去重）②22:40 收班：全日異常總結
    let notified = 0
    if (isCron && days[today]) {
      const hourTW = tz.getUTCHours() // tz 已 +8，取小時=台北時間
      try {
        const { linePush } = await import('./_onboard.js')
        const { logPush } = await import('./push.js')
        const ops = (await kvGet('pm_bot_operators')) || {}
        const push = async (txt, src) => { for (const uid of Object.keys(ops)) { if (await linePush(uid, txt)) { await logPush(uid, 1, src); notified++ } } }
        if (hourTW >= 22) {
          // 每日收班順手同步 NUEiP 班表（前7天~後35天；改班/新增人員隔天自動跟上）
          try { const fs9 = await fetchShifts(addD(today, -7), addD(today, 35)); await storeShifts(fs9.days); if ((fs9.staff || []).length) await kvPut('sp_crew_pm_hr_staff', { names: fs9.staff, updatedAt: new Date().toISOString() }, 'NUEiP在職名單') } catch (_) {}
          const lines = anomalies(days[today])
          if (lines.length) await push(`🕐 NUEiP 出勤異常 ${today.slice(5).replace('-', '/')}\n${lines.slice(0, 15).join('\n')}${lines.length > 15 ? `\n…共 ${lines.length} 筆` : ''}\n（詳細：夥伴中心 → 人資系統）`, 'NUEiP出勤異常')
        } else {
          const nd = (await kvGet('sp_crew_pm_hr_notif')) || {}
          if (nd.date !== today) { nd.date = today; nd.keys = {} }
          const fresh = Object.values(days[today]).filter(r => r.late > 0 && !nd.keys[r.name + '|late'])
          if (fresh.length) {
            await push(`⏰ 遲到打卡（即時）\n${fresh.map(r => `・${r.name}（${r.dept}）班 ${r.work}｜上班卡 ${(r.on || [])[0] || '—'}｜遲到 ${r.late} 分`).join('\n')}`, 'NUEiP遲到即時')
            fresh.forEach(r => { nd.keys[r.name + '|late'] = 1 })
            await kvPut('sp_crew_pm_hr_notif', nd, '遲到即時通知去重')
          }
        }
      } catch (_) {}
    }
    return res.status(200).json({ ok: true, from, to, personDays: n, months: rep, notified })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
