// 📬 信箱中樞（多信箱管理）批次1 v4.70.79（張良 2026-10-12「重新建立一個信箱管理系統，我有很多個信箱要串接」；規格 docs/MAIL_HUB_PLAN.md）
// 設計：
//  - 信箱清單存 KV sp_finance_pm_mailhub.boxes；密碼用 env MAIL_ENC_KEY 做 AES-256-GCM 加密後才存，讀出只給前端帳號不回密碼
//  - 舊的兩個 env 信箱（MAIL_USER／MAIL_USER2）自動列成「系統設定」信箱（id=env1／env2），不能改密碼、可停用
//  - 規則 hub.rules：{id, box:'*'|boxId, fields:['from','subject'], kw:[...], action:'archive'|'label'|'trash'|'keep', folder, on, confirmed}
//      keep（白名單）永遠優先；trash＝移垃圾桶（30 天可救回），永不永久刪除；archive＝移出收件匣（Gmail 進「所有郵件」）
//      每日自動只跑 on && confirmed 的規則；confirmed 只有在前端「預覽」看過之後才能勾
//  - 掃描結果每信箱一檔 sp_finance_pm_mailhub_scan_<id>（來源彙總＋最近信件 cap 500），給前端判讀與規則預覽用
//  - 執行紀錄 hub.log cap 300：{at, box, rule, action, n, samples, dry, by}
//  - 權限：全部端點主管限定（審核人／張良瑋／角色主管／perm admin）
import crypto from 'crypto'
import { ImapFlow } from 'imapflow'

export const HUB_KEY = 'sp_finance_pm_mailhub'
export const SCAN_KEY = (id) => 'sp_finance_pm_mailhub_scan_' + String(id).replace(/[^A-Za-z0-9_-]/g, '')
export const MAILHUB_VER = '4779'
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const now = () => new Date().toISOString()
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
export const isMgr = (who, apr, pm) => !!who && !!(apr.includes(who.name) || who.name === '張良瑋' || who.role === '主管' || (((pm || {}).users || {})[who.rid || who.uid] || {}).admin)

// ── 密碼加密（金鑰只在 env；沒設金鑰＝不能新增信箱，但 env 信箱照常）──
const encKey = () => { const k = clean(process.env.MAIL_ENC_KEY); return k ? crypto.createHash('sha256').update(k).digest() : null }
export function encrypt(txt) {
  const k = encKey(); if (!k) throw new Error('後台沒設 MAIL_ENC_KEY，不能保存信箱密碼')
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([c.update(String(txt), 'utf8'), c.final()])
  return 'v1:' + iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + ct.toString('hex')
}
export function decrypt(s) {
  const k = encKey(); if (!k) throw new Error('後台沒設 MAIL_ENC_KEY')
  const [v, ivh, tagh, cth] = String(s || '').split(':'); if (v !== 'v1') throw new Error('密碼格式不對')
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivh, 'hex')); d.setAuthTag(Buffer.from(tagh, 'hex'))
  return Buffer.concat([d.update(Buffer.from(cth, 'hex')), d.final()]).toString('utf8')
}

// ── 信箱清單 ──
export async function loadHub(kvGet) { const h = (await kvGet(HUB_KEY)) || {}; return { boxes: h.boxes || [], rules: h.rules || [], log: h.log || [], envOff: h.envOff || {}, envMeta: h.envMeta || {} } } // v4.71.109 envMeta 也要帶（原本漏帶，存一次就把預設信箱狀態洗掉）
// 信件日期 → 台灣時間字串（壞日期回空字串，不讓整個掃描中斷；v4.71.109）
const tpeDate = (d, len) => { const t = new Date(d); return isNaN(t.getTime()) ? '' : new Date(t.getTime() + 8 * 3600e3).toISOString().slice(0, len).replace('T', ' ') }
const SCAN_MAX = 2000 // 掃描最多讀最新 2000 封（避免一次載入幾萬封）
export async function saveHub(kvPut, hub, who) { await kvPut(HUB_KEY, hub, '信箱中樞 ' + ((who && who.name) || '')) }
function envBoxes(hub) {
  const out = []
  const u1 = clean(process.env.MAIL_USER), p1 = clean(process.env.MAIL_PASS)
  const u2 = clean(process.env.MAIL_USER2), p2 = clean(process.env.MAIL_PASS2)
  if (u1 && p1) out.push({ id: 'env1', name: u1.split('@')[0], user: u1, host: 'imap.gmail.com', port: 993, src: 'env', on: !hub.envOff.env1, note: '系統設定（中信通知／舊信箱管理）' })
  if (u2 && p2) out.push({ id: 'env2', name: u2.split('@')[0], user: u2, host: 'imap.gmail.com', port: 993, src: 'env', on: !hub.envOff.env2, note: '系統設定（Eats365 日結信）' })
  return out
}
export function allBoxes(hub) { return [...envBoxes(hub), ...hub.boxes] }
export function boxById(hub, id) { return allBoxes(hub).find(b => b.id === id) || null }
function credsOf(box) {
  if (box.src === 'tmp') return { user: box.user, pass: box._pass } // 新增／改密碼時測連線：還沒加密的明文
  if (box.src === 'env') return { user: box.user, pass: clean(process.env[box.id === 'env1' ? 'MAIL_PASS' : 'MAIL_PASS2']) }
  return { user: box.user, pass: decrypt(box.enc) }
}
const pub = (b) => ({ id: b.id, name: b.name, user: b.user, host: b.host, port: b.port, src: b.src || 'kv', on: !!b.on, note: b.note || '', addedBy: b.addedBy || '', addedAt: b.addedAt || '', lastScan: b.lastScan || '', lastOk: b.lastOk || '', lastErr: b.lastErr || '' })
export function publicBoxes(hub) { return allBoxes(hub).map(pub) }

async function connect(box) {
  const c = credsOf(box)
  if (!c.user || !c.pass) throw new Error('缺帳號或密碼')
  const client = new ImapFlow({ host: box.host || 'imap.gmail.com', port: +box.port || 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 60e3, greetingTimeout: 20e3 })
  await client.connect()
  return client
}
async function specials(client) {
  const out = { trash: '', all: '', folders: [] }
  for (const mb of await client.list()) {
    out.folders.push(mb.path)
    if (mb.specialUse === '\\Trash') out.trash = mb.path
    if (mb.specialUse === '\\All') out.all = mb.path
  }
  return out
}
const errText = (e) => { const m = String(e && (e.responseText || e.message) || e); if (/Invalid credentials|AUTHENTICATIONFAILED|Application-specific password/i.test(m)) return '帳號或密碼不對（Gmail 要用「應用程式密碼」，不是登入密碼）'; if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'IMAP 主機找不到：' + m.slice(0, 80); if (/timeout|ETIMEDOUT/i.test(m)) return '連線逾時'; return m.slice(0, 200) }

export async function testBox(box) {
  const t0 = Date.now(); let client = null
  try { client = await connect(box); const sp = await specials(client); const st = await client.status('INBOX', { messages: true, unseen: true }); return { ok: true, ms: Date.now() - t0, messages: st.messages, unseen: st.unseen, folders: sp.folders, trash: sp.trash, all: sp.all } } catch (e) { return { ok: false, error: errText(e) } } finally { if (client) await client.logout().catch(() => {}) }
}

export async function boxAdd({ kvGet, kvPut, body, who }) {
  const hub = await loadHub(kvGet)
  const user = String(body.user || '').trim().toLowerCase(), pass = String(body.pass || '').replace(/\s+/g, '')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) return { ok: false, error: '信箱帳號格式不對' }
  if (!pass) return { ok: false, error: '請貼上應用程式密碼' }
  if (allBoxes(hub).some(b => b.user === user)) return { ok: false, error: '這個信箱已經接過了' }
  const box = { id: rid(), name: String(body.name || '').trim() || user.split('@')[0], user, host: String(body.host || '').trim() || 'imap.gmail.com', port: +body.port || 993, on: true, note: String(body.note || '').trim(), addedBy: who.name, addedAt: now() }
  const t = await testBox({ ...box, src: 'tmp', _pass: pass })
  if (!t.ok) return { ok: false, error: '連不上：' + t.error }
  box.enc = encrypt(pass); box.lastOk = now(); box.lastErr = ''
  hub.boxes.push(box); pushLog(hub, { box: box.id, action: 'boxadd', n: 0, by: who.name, note: box.user })
  await saveHub(kvPut, hub, who)
  return { ok: true, box: pub(box), test: { messages: t.messages, unseen: t.unseen } }
}

export async function boxSet({ kvGet, kvPut, body, who }) {
  const hub = await loadHub(kvGet)
  const id = String(body.id || '')
  if (/^env[12]$/.test(id)) { // env 信箱只能開關／改名不做（名稱跟帳號走）
    if (body.on != null) { hub.envOff[id] = !body.on; pushLog(hub, { box: id, action: body.on ? 'boxon' : 'boxoff', n: 0, by: who.name }) }
    await saveHub(kvPut, hub, who); return { ok: true, box: pub(boxById(hub, id)) }
  }
  const b = hub.boxes.find(x => x.id === id); if (!b) return { ok: false, error: '找不到這個信箱' }
  if (body.name != null) b.name = String(body.name).trim() || b.name
  if (body.note != null) b.note = String(body.note).trim()
  if (body.host != null) b.host = String(body.host).trim() || 'imap.gmail.com'
  if (body.port != null) b.port = +body.port || 993
  if (body.on != null) { b.on = !!body.on; pushLog(hub, { box: id, action: b.on ? 'boxon' : 'boxoff', n: 0, by: who.name }) }
  if (body.pass) { const pass = String(body.pass).replace(/\s+/g, ''); const t = await testBox({ ...b, src: 'tmp', _pass: pass }); if (!t.ok) return { ok: false, error: '新密碼連不上：' + t.error }; b.enc = encrypt(pass); b.lastOk = now(); b.lastErr = ''; pushLog(hub, { box: id, action: 'boxpass', n: 0, by: who.name }) }
  await saveHub(kvPut, hub, who); return { ok: true, box: pub(b) }
}
export async function boxDel({ kvGet, kvPut, body, who }) {
  const hub = await loadHub(kvGet)
  const id = String(body.id || ''); if (/^env[12]$/.test(id)) return { ok: false, error: '系統設定的信箱只能停用，不能移除' }
  const i = hub.boxes.findIndex(x => x.id === id); if (i < 0) return { ok: false, error: '找不到這個信箱' }
  const [b] = hub.boxes.splice(i, 1)
  hub.rules = hub.rules.filter(r => r.box !== id) // 專屬規則一起拿掉；通用規則（*）不動
  pushLog(hub, { box: id, action: 'boxdel', n: 0, by: who.name, note: b.user })
  await saveHub(kvPut, hub, who); return { ok: true }
}

// ── 掃描：來源彙總＋最近信件（唯讀，不動任何信）──
export async function scanBox({ kvGet, kvPut, id, days = 7, who, connectFn = connect }) {
  days = Math.max(1, Math.min(60, parseInt(days, 10) || 7))
  const hub = await loadHub(kvGet)
  const box = boxById(hub, id); if (!box) return { ok: false, error: '找不到這個信箱' }
  const t0 = Date.now(); let client = null; const mails = []; let unseen = 0, sp = { folders: [] }, totalN = 0
  try {
    client = await connectFn(box)
    sp = await specials(client)
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids0 = await client.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true })
      totalN = (uids0 || []).length
      const asc = (uids0 || []).every((u, i, a) => i === 0 || a[i - 1] <= u) // IMAP 通常已遞增；不是才排序
      const uids = (asc ? (uids0 || []).slice(-SCAN_MAX) : (uids0 || []).slice().sort((x, y) => x - y).slice(-SCAN_MAX)).reverse() // 最新的 SCAN_MAX 封
      if (uids && uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true, flags: true }, { uid: true })) {
          const fr = (msg.envelope && msg.envelope.from && msg.envelope.from[0]) || {}
          const seen = msg.flags && msg.flags.has && msg.flags.has('\\Seen')
          if (!seen) unseen++
          mails.push({ uid: msg.uid, from: (fr.address || '').toLowerCase(), name: fr.name || '', subject: (msg.envelope && msg.envelope.subject) || '', date: msg.envelope && msg.envelope.date ? tpeDate(msg.envelope.date, 16) : '', seen: !!seen })
        }
      }
    } finally { lock.release() }
  } catch (e) {
    const err = errText(e)
    await markBox(kvGet, kvPut, id, { lastErr: err }, who)
    return { ok: false, error: err }
  } finally { if (client) await client.logout().catch(() => {}) }
  mails.sort((a, b) => (a.date < b.date ? 1 : -1))
  const agg = {}
  mails.forEach(m => { const a = agg[m.from] = agg[m.from] || { from: m.from, name: m.name, count: 0, unseen: 0, latest: '', sample: '' }; a.count++; if (!m.seen) a.unseen++; if (m.date > a.latest) { a.latest = m.date; a.sample = m.subject; if (m.name) a.name = m.name } })
  const senders = Object.values(agg).sort((a, b) => b.count - a.count)
  const scan = { scannedAt: now(), days, inboxCount: Math.max(totalN, mails.length), capped: totalN > mails.length ? mails.length : 0, unseen, senders, mails: mails.slice(0, 500), folders: sp.folders, trash: sp.trash, all: sp.all, ms: Date.now() - t0 }
  await kvPut(SCAN_KEY(id), scan, '信箱掃描')
  await markBox(kvGet, kvPut, id, { lastScan: scan.scannedAt, lastOk: scan.scannedAt, lastErr: '' }, who)
  return { ok: true, scan: { ...scan, mails: scan.mails.slice(0, 200) } }
}
// 讀→改→存，撞到「有人同時在改」（新殼版本號比對）就重讀重做，最多 5 次（搬信後的紀錄與狀態不能因為別人剛好在改設定就丟掉；關卡 3 mailhub 第四輪 Gemini）
export async function updateHub(kvGet, kvPut, mutate, who) {
  for (let i = 0; ; i++) {
    const hub = await loadHub(kvGet)
    await mutate(hub) // 允許非同步修改
    try { await saveHub(kvPut, hub, who); return hub } catch (e) {
      if (i >= 4 || !/同時在改/.test(String(e && e.message || e))) throw e
      await new Promise(r => setTimeout(r, 150 + Math.random() * 400))
    }
  }
}
async function markBox(kvGet, kvPut, id, patch, who) {
  await updateHub(kvGet, kvPut, (hub) => { if (/^env[12]$/.test(id)) { hub.envMeta = hub.envMeta || {}; hub.envMeta[id] = { ...(hub.envMeta[id] || {}), ...patch } } else { const b = hub.boxes.find(x => x.id === id); if (b) Object.assign(b, patch) } }, who)
}
export async function loadScan(kvGet, id) { return (await kvGet(SCAN_KEY(id))) || null }

// ── 規則 ──
const normRule = (r) => ({
  id: r.id || rid(), box: r.box || '*', fields: Array.isArray(r.fields) && r.fields.length ? r.fields.filter(f => ['from', 'subject', 'name'].includes(f)) : ['from'],
  kw: (Array.isArray(r.kw) ? r.kw : String(r.kw || '').split(/[,，\n]/)).map(s => String(s).trim().toLowerCase()).filter(Boolean),
  action: ['archive', 'label', 'trash', 'keep'].includes(r.action) ? r.action : 'archive', folder: String(r.folder || '').trim(),
  on: r.on !== false, confirmed: !!r.confirmed, note: String(r.note || '').trim(), by: r.by || '', at: r.at || now(), confirmedBy: r.confirmedBy || '', confirmedAt: r.confirmedAt || '',
})
const ACT_TXT = { archive: '封存', label: '貼標移出收件匣', trash: '移垃圾桶', keep: '保留（白名單）' }
export function matchRule(rule, m) {
  const hay = []
  if (rule.fields.includes('from')) hay.push(m.from || '')
  if (rule.fields.includes('name')) hay.push(m.name || '')
  if (rule.fields.includes('subject')) hay.push(m.subject || '')
  const s = hay.join(' \n ').toLowerCase()
  return rule.kw.some(k => s.includes(k))
}
// 一封信的最終動作：keep 先看（白名單蓋過一切），再依規則順序第一個命中的
export function decide(rules, boxId, m, onlyIds) {
  const rs = rules.filter(r => r.on && (r.box === '*' || r.box === boxId) && (!onlyIds || onlyIds.includes(r.id)))
  const keep = rs.find(r => r.action === 'keep' && matchRule(r, m)); if (keep) return { rule: keep, action: 'keep' }
  const hit = rs.find(r => r.action !== 'keep' && matchRule(r, m)); return hit ? { rule: hit, action: hit.action } : null
}
export async function ruleAdd({ kvGet, kvPut, body, who }) {
  const hub = await loadHub(kvGet)
  const r = normRule({ ...body.rule, id: undefined, confirmed: false, by: who.name, at: now() })
  if (!r.kw.length) return { ok: false, error: '至少要一個關鍵字' }
  if (r.action === 'label' && !r.folder) return { ok: false, error: '貼標要填資料夾名稱' }
  if (r.box !== '*' && !boxById(hub, r.box)) return { ok: false, error: '找不到指定的信箱' }
  hub.rules.push(r); pushLog(hub, { box: r.box, rule: r.id, action: 'ruleadd', n: 0, by: who.name, note: ACT_TXT[r.action] + '：' + r.kw.join('、') })
  await saveHub(kvPut, hub, who); return { ok: true, rule: r }
}
export async function ruleSet({ kvGet, kvPut, body, who }) {
  const hub = await loadHub(kvGet)
  const i = hub.rules.findIndex(x => x.id === body.id); if (i < 0) return { ok: false, error: '找不到這條規則' }
  const old = hub.rules[i]
  if (body.rule) { // 改內容＝要重新預覽確認（條件變了，之前看過的不算）
    const r = normRule({ ...old, ...body.rule, id: old.id, by: old.by, at: old.at })
    const changed = JSON.stringify([r.fields, r.kw, r.action, r.folder, r.box]) !== JSON.stringify([old.fields, old.kw, old.action, old.folder, old.box])
    if (changed) { r.confirmed = false; r.confirmedBy = ''; r.confirmedAt = '' }
    if (!r.kw.length) return { ok: false, error: '至少要一個關鍵字' }
    hub.rules[i] = r
  }
  if (body.on != null) hub.rules[i].on = !!body.on
  if (body.confirmed != null) { hub.rules[i].confirmed = !!body.confirmed; hub.rules[i].confirmedBy = body.confirmed ? who.name : ''; hub.rules[i].confirmedAt = body.confirmed ? now() : ''; pushLog(hub, { box: old.box, rule: old.id, action: body.confirmed ? 'ruleok' : 'ruleunok', n: 0, by: who.name }) }
  await saveHub(kvPut, hub, who); return { ok: true, rule: hub.rules[i] }
}
export async function ruleDel({ kvGet, kvPut, body, who }) {
  const hub = await loadHub(kvGet)
  const i = hub.rules.findIndex(x => x.id === body.id); if (i < 0) return { ok: false, error: '找不到這條規則' }
  const [r] = hub.rules.splice(i, 1); pushLog(hub, { box: r.box, rule: r.id, action: 'ruledel', n: 0, by: who.name, note: ACT_TXT[r.action] + '：' + r.kw.join('、') })
  await saveHub(kvPut, hub, who); return { ok: true }
}

// ── 預覽：用最近一次掃描結果算「這條規則會動到哪些信」（唯讀）──
export async function previewRule({ kvGet, ruleId, rule: draft, boxId }) {
  const hub = await loadHub(kvGet)
  const rule = draft ? normRule(draft) : hub.rules.find(r => r.id === ruleId)
  if (!rule) return { ok: false, error: '找不到這條規則' }
  const boxes = allBoxes(hub).filter(b => b.on && (rule.box === '*' || rule.box === b.id) && (!boxId || b.id === boxId))
  const out = []
  for (const b of boxes) {
    const sc = await loadScan(kvGet, b.id); if (!sc) { out.push({ box: b.id, name: b.name, noScan: true, n: 0, mails: [] }); continue }
    const keepRules = hub.rules.filter(r => r.on && r.action === 'keep' && r.id !== rule.id && (r.box === '*' || r.box === b.id))
    const hits = [], kept = []
    for (const m of sc.mails) { if (!matchRule(rule, m)) continue; if (rule.action !== 'keep' && keepRules.some(k => matchRule(k, m))) kept.push(m); else hits.push(m) }
    out.push({ box: b.id, name: b.name, scannedAt: sc.scannedAt, days: sc.days, n: hits.length, mails: hits.slice(0, 100), kept: kept.length, keptMails: kept.slice(0, 20) })
  }
  return { ok: true, rule, boxes: out, total: out.reduce((t, x) => t + x.n, 0) }
}

// ── 執行：連 IMAP 真的把信搬走（dry=只算不動）──
export async function applyBox({ kvGet, kvPut, id, days = 7, dry = false, onlyIds = null, who, requireConfirmed = true, guard = null, connectFn = connect }) { // connectFn：測試換假信箱用 // guard：真的搬信前呼叫，回字串＝不准動（切換中／驗收中；v4.71.109）
  const hub = await loadHub(kvGet)
  const box = boxById(hub, id); if (!box) return { ok: false, error: '找不到這個信箱' }
  if (!box.on) return { ok: false, error: '這個信箱已停用' }
  const rules = hub.rules.filter(r => r.on && (r.box === '*' || r.box === id) && (!requireConfirmed || r.confirmed || r.action === 'keep') && (!onlyIds || onlyIds.includes(r.id) || r.action === 'keep'))
  if (!rules.some(r => r.action !== 'keep')) return { ok: true, box: id, n: 0, groups: [], note: '沒有已確認的規則' }
  if (!dry && guard) { const g0 = await guard(); if (g0) return { ok: false, box: id, error: g0 } } // 連信箱前先檢查（不記成連線失敗）
  days = Math.max(1, Math.min(60, parseInt(days, 10) || 7)) // 天數防呆（關卡 3 mailhub 第二輪 Gemini A2）
  let client = null; const groups = {}; let scanned = 0, stopped = '', aborted = ''
  try {
    client = await connectFn(box)
    const sp = await specials(client)
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true })
      if (uids && uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
          scanned++
          const fr = (msg.envelope && msg.envelope.from && msg.envelope.from[0]) || {}
          const m = { uid: msg.uid, from: (fr.address || '').toLowerCase(), name: fr.name || '', subject: (msg.envelope && msg.envelope.subject) || '', date: msg.envelope && msg.envelope.date ? tpeDate(msg.envelope.date, 10) : '' }
          const d = decide(rules, id, m, onlyIds ? [...onlyIds, ...rules.filter(r => r.action === 'keep').map(r => r.id)] : null)
          if (!d || d.action === 'keep') continue
          const g = groups[d.rule.id] = groups[d.rule.id] || { rule: d.rule.id, action: d.action, folder: d.rule.folder, kw: d.rule.kw, uids: [], samples: [], err: '' }
          g.uids.push(m.uid); if (g.samples.length < 5) g.samples.push({ from: m.from, subject: m.subject.slice(0, 80), date: m.date })
        }
      }
      stopped = !dry && guard ? (await guard()) || '' : '' // 掃完、真的搬之前再檢查一次（期間切換或上了驗收閘門＝一封都不動）
      if (!dry && !stopped) {
        for (const g of Object.values(groups)) {
          if (aborted) break // 中途被擋＝後面的規則也一律不動（第三輪 Gemini）
          if (!g.uids.length) continue
          try {
            let dest = ''
            if (g.action === 'trash') dest = sp.trash || 'Trash'
            else if (g.action === 'archive') dest = sp.all || '' // Gmail：移到「所有郵件」＝拿掉收件匣標籤；非 Gmail 沒有 \All → 移到「封存」資料夾
            else if (g.action === 'label') dest = g.folder
            if (g.action === 'archive' && !dest) dest = '封存'
            if (dest && !sp.folders.includes(dest)) { try { await client.mailboxCreate(dest); sp.folders.push(dest) } catch (e) { if (/ALREADYEXISTS|already exists/i.test(String(e && (e.responseText || e.message) || '') + errText(e))) sp.folders.push(dest); else { g.err = '無法建立資料夾「' + dest + '」：' + errText(e); g.moved = 0; continue } } } // 已存在＝當成功繼續搬 // 建不起來就不搬（第三輪 Gemini）
            g.moved = 0
            if (dest) for (let i9 = 0; i9 < g.uids.length; i9 += 500) {
              const gb = guard ? await guard() : null // 每批再查一次（縮小切換空隙；不取代切換前排空）
              if (gb) { g.err = gb; aborted = gb; break }
              const part = g.uids.slice(i9, i9 + 500)
              try { await client.messageMove(part, dest, { uid: true }) } // 分批（IMAP 指令長度有限）
              catch (e) { throw Object.assign(new Error(errText(e) + `（失敗前已確認搬 ${g.moved} 封；失敗這批 ${part.length} 封結果未確認，請到信箱核對）`), { moveFail: true }) } // 第三輪 OpenAI A3：第一批就失敗也要寫未確認
              g.moved += part.length // 每批成功才累加；moved＝已確認成功數（第二輪 OpenAI A3／Gemini A1）
            }
          } catch (e) { g.err = e && e.moveFail ? e.message : errText(e) }
        }
      }
    } finally { lock.release() }
  } catch (e) { const err = errText(e); await markBox(kvGet, kvPut, id, { lastErr: err }, who); return { ok: false, error: err } } finally { if (client) await client.logout().catch(() => {}) }
  if (stopped) return { ok: false, box: id, error: stopped, scanned }
  const gs = Object.values(groups).map(g => ({ rule: g.rule, action: g.action, folder: g.folder, kw: g.kw, n: g.uids.length, moved: dry ? 0 : (g.moved || 0), samples: g.samples, err: g.err }))
  await updateHub(kvGet, kvPut, (hub2) => {
    for (const g of gs) if (g.n && !dry) pushLog(hub2, { box: id, rule: g.rule, action: g.action, n: g.n, moved: g.moved, samples: g.samples, dry: !!dry, by: (who && who.name) || '每日自動', err: g.err })
    if (!dry && !aborted) { const b2 = hub2.boxes.find(x => x.id === id); if (b2) { b2.lastApply = now(); b2.lastOk = now(); b2.lastErr = '' } } // 中途被擋＝不算完整成功
  }, who)
  return { ok: !aborted, box: id, scanned, n: gs.reduce((t, g) => t + g.n, 0), groups: gs, dry: !!dry, ...(aborted ? { error: aborted + '（已搬的照紀錄，其餘這次沒動）' } : {}) }
}
export async function applyAll({ kvGet, kvPut, days = 7, dry = false, who = { name: '每日自動' }, guard = null }) {
  const hub = await loadHub(kvGet)
  const out = []
  for (const b of allBoxes(hub)) { if (!b.on) continue; try { out.push({ ...(await applyBox({ kvGet, kvPut, id: b.id, days, dry, who, guard })), name: b.name }) } catch (e) { out.push({ ok: false, box: b.id, name: b.name, error: String(e && e.message || e).slice(0, 200) }) } }
  return { ok: true, boxes: out, n: out.reduce((t, x) => t + (x.n || 0), 0) }
}
export function pushLog(hub, e) { hub.log = [{ at: now(), ...e }, ...(hub.log || [])].slice(0, 300) }

// 前端總覽一包：信箱（含最近掃描摘要）＋規則＋紀錄
export async function overview({ kvGet }) {
  const hub = await loadHub(kvGet)
  const boxes = []
  for (const b of allBoxes(hub)) {
    const sc = await loadScan(kvGet, b.id)
    const meta = b.src === 'env' ? ((hub.envMeta || {})[b.id] || {}) : {}
    boxes.push({ ...pub({ ...b, ...meta }), scan: sc ? { scannedAt: sc.scannedAt, days: sc.days, inboxCount: sc.inboxCount, unseen: sc.unseen, senders: sc.senders.slice(0, 60), folders: sc.folders || [] } : null })
  }
  return { ok: true, ver: MAILHUB_VER, encReady: !!encKey(), boxes, rules: hub.rules, log: hub.log.slice(0, 80), actTxt: ACT_TXT }
}
