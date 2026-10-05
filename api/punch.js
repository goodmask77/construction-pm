// ── 打卡系統 P1（張良 2026-07-22 拍板：店內 iPad 開 App 打卡站顯示動態 QR，不用 GPS）──
// GET  ?action=token     (Bearer 管理員/主管) → 打卡站取當前 QR token（HMAC 簽章、無狀態、75秒內有效）
// POST ?action=punch     (Bearer 登入者) {token} → 掃碼打卡：驗 token → 自動判上/下班 → 逐筆存
// POST ?action=fix       (Bearer 登入者) {} → 5 分鐘內把自己最後一筆上/下班判向改過來
// POST ?action=line-punch (內部：webhook 呼叫，帶 uid) → LINE「上班/下班」備援打卡（verified:false 待審核）
// POST ?action=verify    (Bearer 管理員/主管) {recordId, ok} → 審核 LINE 打卡（ok=false 刪除）
// 出勤紀錄＝法定文件：逐筆一筆一檔 sp_crew_pch_<日期>_<personId>_<亂碼>，記到分鐘、只增不改（判向修正除外）、永久保存。
import crypto from 'crypto'
import { SB_URL, SB_KEY, svc, kvGet, kvSet, loadRoster } from './_onboard.js'
import { compareDay, summarize, ATT_LABEL } from '../src/shift/attendance.js'
import { schedKey, mondayOf } from '../src/shift/model.js'

const SECRET = crypto.createHash('sha256').update('punch:' + SB_KEY).digest() // 站點 token 簽章金鑰（由服務金鑰衍生，不另設環境變數）
const TOKEN_TTL = 75 * 1000 // QR 每 30 秒換新，容忍慢掃 75 秒

export function makeToken(now = Date.now()) {
  const ts = String(now)
  const sig = crypto.createHmac('sha256', SECRET).update(ts).digest('hex').slice(0, 20)
  return ts + '.' + sig
}
export function checkToken(token) {
  const [ts, sig] = String(token || '').split('.')
  if (!ts || !sig) return false
  const good = crypto.createHmac('sha256', SECRET).update(ts).digest('hex').slice(0, 20)
  if (sig !== good) return false
  return Math.abs(Date.now() - Number(ts)) <= TOKEN_TTL
}

async function whoAmI(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  const u = await r.json()
  if (!u?.id) return null
  const pr = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${u.id}&select=role,display_name`, { headers: svc })
  const rows = pr.ok ? await pr.json() : []
  return { id: u.id, role: rows[0]?.role || 'staff', name: rows[0]?.display_name || '' }
}
const isMgr = (me) => me && (me.role === 'admin' || me.role === 'manager')
const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

// 台北時區的日期字串（打卡以店的當地日為準）
const tpeDate = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(d) // YYYY-MM-DD
const dayKey = () => tpeDate().replace(/-/g, '')

// 逐筆讀某人某日打卡（LIKE 前綴；底線要跳脫——踩過的坑）
export async function listPunches(prefix) { // mail-sync 班表分頁撈整月共用
  const esc = prefix.replace(/_/g, '\\_')
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(esc + '%')}&select=id,data&order=id`, { headers: svc })
  const rows = r.ok ? await r.json() : []
  return rows.map(x => { try { return { key: x.id, ...JSON.parse(x.data.v) } } catch (_) { return null } }).filter(Boolean)
}
export async function todayPunchesOf(personId) { return listPunches(`sp_crew_pch_${dayKey()}_${personId}_`) }
export async function todayPunchesAll() { return listPunches(`sp_crew_pch_${dayKey()}_`) }

// 寫一筆打卡（自動判向：今天最後一筆是上班→這筆下班，否則上班；LINE 備援講明「上班/下班」則以字面為準）
export async function recordPunch(person, src, verified, forceDir) {
  const today = await todayPunchesOf(person.id)
  const last = today[today.length - 1]
  const dir = forceDir || (last && last.dir === 'in' ? 'out' : 'in')
  const ts = new Date().toISOString()
  const key = `sp_crew_pch_${dayKey()}_${person.id}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const rec = { personId: person.id, name: person.name, ts, dir, src, verified: !!verified }
  await kvSet(key, rec)
  // 今日累計（配對 in/out）
  const list = [...today, { ...rec, key }]
  let ms = 0
  for (let i = 0; i < list.length; i += 2) if (list[i]?.dir === 'in' && list[i + 1]?.dir === 'out') ms += new Date(list[i + 1].ts) - new Date(list[i].ts)
  return { key, dir, ts, todayHours: Math.round(ms / 360000) / 10, count: list.length }
}

// 補卡：在指定（過去）時間寫一筆打卡；日 key 取該時間的台北日，讓它落在正確那天/月檔
export async function recordPunchAt(person, tsISO, dir, src, verified) {
  const dISO = new Date(tsISO).toISOString()
  const dk = tpeDate(new Date(tsISO)).replace(/-/g, '')
  const key = `sp_crew_pch_${dk}_${person.id}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const rec = { personId: person.id, name: person.name, ts: dISO, dir, src: src || 'makeup', verified: !!verified }
  await kvSet(key, rec)
  return { key, dir, ts: dISO }
}

// P2 出勤×班表比對（今日）：App 與 D哥 共用（attendance.js 同一套算法）。本週沒發布班表回 null。
export async function attendanceCompareToday() {
  const todayISO = tpeDate()
  const [staffDoc, tplDoc, sched] = await Promise.all([
    kvGet('sp_crew_shift_staff'), kvGet('sp_crew_shift_templates'), kvGet('sp_crew_' + schedKey('abeach', mondayOf(todayISO))),
  ])
  const assignments = (sched?.assignments || []).filter(a => a.date === todayISO)
  if (!assignments.length) return null
  const staffById = Object.fromEntries((staffDoc?.staff || []).map(s => [s.id, s]))
  const shiftById = Object.fromEntries((tplDoc?.shifts || []).map(s => [s.id, s]))
  const punches = await todayPunchesAll()
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Taipei' })
  const nowMin = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const rows = compareDay({ date: todayISO, assignments, staffById, shiftById, punches, nowMin })
  return { rows, sum: summarize(rows) }
}
export function attendanceLines(cmp) {
  if (!cmp) return []
  const lines = ['【今日班表比對（遲到寬限5分）】']
  cmp.rows.forEach(r => lines.push(`  - ${r.name}｜${r.shiftCode || '未排班'} ${r.planIn ? r.planIn + '-' + r.planOut : ''}｜實到 ${r.firstIn || '—'}${r.lastOut ? '~' + r.lastOut : ''}｜${ATT_LABEL[r.status]}${r.lateMin ? `(遲${r.lateMin}分)` : ''}${r.earlyMin ? `(早退${r.earlyMin}分)` : ''}`))
  const b = cmp.sum.bad
  if (b.length) lines.push(`  ⚠ 異常 ${b.length} 筆：${b.map(r => `${r.name}${ATT_LABEL[r.status]}`).join('、')}`)
  return lines
}

export default async function handler(req, res) {
  try {
    if (!SB_URL || !SB_KEY) return res.status(500).json({ error: '後端未設定' })
    const action = req.query?.action || ''

    // 打卡站取 token（只有管理員/主管開得了站）
    if (action === 'token' && req.method === 'GET') {
      const me = await whoAmI(req)
      if (!isMgr(me)) return res.status(403).json({ error: '只有管理員/主管可以開打卡站' })
      return res.status(200).json({ token: makeToken(), ttl: 30 })
    }

    // 掃碼打卡
    if (action === 'punch' && req.method === 'POST') {
      const me = await whoAmI(req)
      if (!me) return res.status(401).json({ error: '請先登入（回 LINE 跟 DD 說「登入」拿連結）' })
      const body = bodyOf(req)
      if (!checkToken(body.token)) return res.status(400).json({ error: 'QR 已過期，請重新掃打卡站上的最新 QR。' })
      const roster = await loadRoster()
      const p = roster.people.find(x => (x.account === me.name || x.name === me.name) && (x.status || '在職') !== '離職') // 帳號名對不上時退回用本名對，避免改過顯示名就打不了卡
      if (!p) return res.status(403).json({ error: '你的帳號還沒對應到名冊，請聯絡管理員。' })
      const out = await recordPunch(p, 'qr', true)
      return res.status(200).json({ ok: true, name: p.name, ...out })
    }

    // 5 分鐘內修正判向（打成下班改上班之類）
    if (action === 'fix' && req.method === 'POST') {
      const me = await whoAmI(req)
      if (!me) return res.status(401).json({ error: '未登入' })
      const roster = await loadRoster()
      const p = roster.people.find(x => x.account === me.name || x.name === me.name)
      if (!p) return res.status(403).json({ error: '帳號未對應名冊' })
      const today = await todayPunchesOf(p.id)
      const last = today[today.length - 1]
      if (!last) return res.status(400).json({ error: '今天還沒有打卡紀錄' })
      if (Date.now() - new Date(last.ts).getTime() > 5 * 60000) return res.status(400).json({ error: '超過 5 分鐘，請找負責人處理' })
      const dir = last.dir === 'in' ? 'out' : 'in'
      await kvSet(last.key, { ...last, key: undefined, dir, fixedAt: new Date().toISOString() })
      return res.status(200).json({ ok: true, dir })
    }

    // 審核 LINE 備援打卡（核可 or 刪除）
    if (action === 'verify' && req.method === 'POST') {
      const me = await whoAmI(req)
      if (!isMgr(me)) return res.status(403).json({ error: '只有管理員/主管可以審核' })
      const body = bodyOf(req)
      const key = String(body.recordId || '')
      if (!/^sp_crew_pch_/.test(key)) return res.status(400).json({ error: '紀錄不合法' })
      const rec = await kvGet(key)
      if (!rec) return res.status(404).json({ error: '找不到紀錄' })
      if (body.ok) await kvSet(key, { ...rec, verified: true, verifiedBy: me.name, verifiedAt: new Date().toISOString() })
      else await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: svc })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: '未知動作' })
  } catch (e) { return res.status(500).json({ error: e?.message || '伺服器錯誤' }) }
}
