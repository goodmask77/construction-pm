// 🪪 GROUN:D 自建會員 第一批後端｜v4.70.83（2026-10-12）｜計畫 docs/MEMBER_PLAN_v1.md、建表 supabase/migrations/0001_member.sql
// 張良拍板：只做 GD；現場入點＝店員「輸會員號碼或掃會員 QR」＋金額（單號選填）；三家 AI 共識＝真表、冪等鍵、餘額 view、加好友≠入會、客人不排行不分級、LINE 通知極簡。
// 身分：客人＝LIFF access token 伺服器驗（比對 LINE_LOGIN_CHANNEL_ID）→ 會員 session（mt，12 小時）；店員＝/prep 登入 token＋分頁 member 權限（mail-sync 那邊驗）。
// 設定留 KV pm_member_cfg（每 N 元 1 點、單筆上限、獎勵清單、入會禮、歡迎詞、告知文字；有版本號）。
import crypto from 'crypto'
import { SB_URL, SB_KEY } from './_onboard.js'

const H = (extra) => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', ...(extra || {}) })
const nowIso = () => new Date().toISOString()
const BRAND = 'gd'
async function kvGet (id) { try { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}&select=data`, { headers: H() }); const rows = r.ok ? await r.json() : []; return rows[0] && rows[0].data && rows[0].data.v ? JSON.parse(rows[0].data.v) : null } catch (_) { return null } }
async function kvSet (id, obj, editor) { await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: H({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: editor || '會員', updated_at: nowIso() }) }) }
// 真表：PostgREST
async function sel (table, q) { const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, { headers: H() }); if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error(tableErr(r.status, t)), { status: r.status }) } return r.json() }
async function ins (table, row, prefer) { const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: H({ Prefer: prefer || 'return=representation' }), body: JSON.stringify(row) }); const t = await r.text().catch(() => ''); if (!r.ok) throw Object.assign(new Error(tableErr(r.status, t)), { status: r.status, body: t }); try { const j = JSON.parse(t); return Array.isArray(j) ? j[0] : j } catch (_) { return null } }
async function upd (table, q, patch) { const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, { method: 'PATCH', headers: H({ Prefer: 'return=representation' }), body: JSON.stringify({ ...patch }) }); if (!r.ok) throw Object.assign(new Error(tableErr(r.status, await r.text().catch(() => ''))), { status: r.status }); return r.json() }
async function rpc (fn, args) { const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(), body: JSON.stringify(args) }); const t = await r.text().catch(() => ''); if (!r.ok) throw Object.assign(new Error(tableErr(r.status, t)), { status: r.status }); try { return JSON.parse(t) } catch (_) { return t } }
const tableErr = (st, t) => /relation .* does not exist|42P01/.test(t) ? '會員資料表還沒建立：請把 supabase/migrations/0001_member.sql 貼到 Supabase SQL Editor 執行一次' : `資料庫錯誤 ${st}：${String(t).slice(0, 160)}`
export const MEMBER_VER = '4784'

// ── 設定 ──
const CFG_KEY = 'pm_member_cfg'
const DEF_CFG = { perAmt: 10, capSingle: 3000, capDailyStaff: 20000, welcomePts: 0, rewards: [{ id: 'r1', name: '飲料升級（套餐飲品任選）', value: 40, pts: 100, active: true }], yearCap: 900, prizeMax: 500, welcomeText: '歡迎加入 GROUN:D！點下面連結開啟會員卡，消費出示會員號碼或 QR 就能累點：\n{link}', consentText: 'GROUN:D（{entity}）為提供會員點數、優惠與訂單服務，蒐集您的 LINE 名稱、手機號碼（選填）與消費紀錄，於營運期間在台灣境內使用。您可隨時在會員卡頁查詢、更正資料或退會；退會後個資會匿名化，交易紀錄依法保留。', entity: '', consentVer: '2026-10-12', ver: 1 }
export async function loadCfg () { const c = (await kvGet(CFG_KEY)) || {}; return { ...DEF_CFG, ...c, rewards: Array.isArray(c.rewards) && c.rewards.length ? c.rewards : DEF_CFG.rewards } }
export async function saveCfg (patch, who) {
  const c = await loadCfg(); const n = { ...c, ...(patch || {}) }
  n.yearCap = Math.max(100, Math.round(Number(n.yearCap) || 900)); n.prizeMax = Math.max(50, Math.round(Number(n.prizeMax) || 500))
  n.perAmt = Math.max(1, Math.round(Number(n.perAmt) || 10)); n.capSingle = Math.max(100, Math.round(Number(n.capSingle) || 3000)); n.welcomePts = Math.max(0, Math.round(Number(n.welcomePts) || 0))
  n.rewards = (Array.isArray(n.rewards) ? n.rewards : []).slice(0, 30).map((r, i) => ({ id: String(r.id || 'r' + (i + 1)).slice(0, 12), name: String(r.name || '').slice(0, 40), value: Math.max(0, Math.round(Number(r.value) || 0)), pts: Math.max(1, Math.round(Number(r.pts) || 1)), active: r.active !== false })).filter(r => r.name)
  n.ver = (c.ver || 1) + 1; n.by = who && who.name; n.at = nowIso()
  await kvSet(CFG_KEY, n, '會員設定(' + ((who && who.name) || '') + ')'); return { ok: true, cfg: n }
}
export const ptsFor = (cfg, amount) => Math.floor((Number(amount) || 0) / (cfg.perAmt || 10))

// ── 會員號碼／QR／session ──
const SECRET = () => (SB_KEY || 'm') + '|member'
const hmac = (s) => crypto.createHmac('sha256', SECRET()).update(String(s)).digest('base64url').slice(0, 22)
async function newMno () { for (let i = 0; i < 8; i++) { const n = String(100000 + Math.floor(Math.random() * 900000)); const ex = await sel('members', `mno=eq.${n}&select=id`); if (!ex.length) return n } return String(Date.now()).slice(-6) }
export function cardToken (memberId) { const exp = Date.now() + 60e3; const body = memberId + '|' + exp; return 'GDM.' + Buffer.from(body).toString('base64url') + '.' + hmac(body) } // 60 秒會員 QR
export function parseCardToken (tok) { try { const [p, b, s] = String(tok || '').trim().split('.'); if (p !== 'GDM') return null; const body = Buffer.from(b, 'base64url').toString(); if (hmac(body) !== s) return null; const [mid, exp] = body.split('|'); if (Date.now() > Number(exp)) return { expired: true }; return { memberId: mid } } catch (_) { return null } }
const mtOf = (uid, exp) => exp + '.' + hmac(uid + '|' + exp)
const mtOk = (uid, mt) => { const [exp, sig] = String(mt || '').split('.'); return !!exp && Date.now() < Number(exp) && hmac(uid + '|' + exp) === sig }

// ── 客人（LIFF）──
async function identityOf (uid) { const rows = await sel('member_identities', `provider=eq.line&line_uid=eq.${encodeURIComponent(uid)}&select=member_id`); return rows[0] ? rows[0].member_id : null }
export async function custWho ({ at }) {
  at = String(at || ''); if (!at) return { ok: false, error: '缺 LINE 登入資料' }
  let pf
  try {
    const vr = await (await fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(at))).json()
    if (!vr || !vr.client_id || vr.expires_in <= 0) return { ok: false, error: 'LINE 登入過期，請重新開啟' }
    const ch = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim(); if (ch && String(vr.client_id) !== ch) return { ok: false, error: '這不是 GROUN:D 的 LINE 登入' }
    pf = await (await fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + at } })).json()
    if (!pf || !pf.userId) return { ok: false, error: '拿不到 LINE 身分' }
  } catch (_) { return { ok: false, error: 'LINE 驗證失敗，請再試一次' } }
  const uid = pf.userId, exp = Date.now() + 12 * 3600e3
  const mid = await identityOf(uid)
  const cfg = await loadCfg()
  if (!mid) return { ok: true, uid, mt: mtOf(uid, exp), member: null, needConsent: true, name: pf.displayName || '', pic: pf.pictureUrl || '', consentText: cfg.consentText.replace('{entity}', cfg.entity || 'GROUN:D'), consentVer: cfg.consentVer }
  const m = (await sel('members', `id=eq.${mid}&select=*`))[0]
  if (m && (!m.pic || m.pic !== pf.pictureUrl)) { try { await upd('members', `id=eq.${mid}`, { pic: pf.pictureUrl || '', updated_at: nowIso() }) } catch (_) {} }
  return { ok: true, uid, mt: mtOf(uid, exp), member: m ? pub(m) : null, needConsent: !m || !m.consent_at || m.status === 'left', name: pf.displayName || '', pic: pf.pictureUrl || '', consentText: cfg.consentText.replace('{entity}', cfg.entity || 'GROUN:D'), consentVer: cfg.consentVer }
}
const pub = (m) => ({ id: m.id, mno: m.mno, name: m.name, phone: m.phone, pic: m.pic, birthday: m.birthday, status: m.status, consentAt: m.consent_at, createdAt: m.created_at })
async function custAuth (body) { if (!body || !body.uid || !mtOk(body.uid, body.mt)) return null; return String(body.uid) }
// 同意＝入會（第一次）或重新啟用（退會後）；加好友本身不入會
export async function custConsent ({ body }) {
  const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期，請重新開啟會員卡' }
  const cfg = await loadCfg()
  const name = String(body.name || '').trim().slice(0, 30); if (!name) return { ok: false, error: '請填名字' }
  const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 15)
  let mid = await identityOf(uid); let created = false
  if (!mid) {
    const m = await ins('members', { brand: BRAND, mno: await newMno(), name, phone: phone || null, pic: String(body.pic || '').slice(0, 300) || null, src: 'line', consent_ver: cfg.consentVer, consent_at: nowIso(), status: 'active' })
    mid = m.id; created = true
    try { await ins('member_identities', { provider: 'line', line_uid: uid, member_id: mid }, 'return=minimal') } catch (e) { if (e.status !== 409) throw e }
    if (cfg.welcomePts > 0) { try { await ins('member_pts', { brand: BRAND, member_id: mid, kind: 'welcome', pts: cfg.welcomePts, idem_key: 'welcome:' + mid, note: '入會禮' }, 'return=minimal') } catch (_) {} }
  } else {
    await upd('members', `id=eq.${mid}`, { name, ...(phone ? { phone } : {}), consent_ver: cfg.consentVer, consent_at: nowIso(), status: 'active', updated_at: nowIso() })
  }
  return { ok: true, created, ...(await custMe({ body })) }
}
export async function custMe ({ body }) {
  const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期，請重新開啟會員卡' }
  const mid = await identityOf(uid); if (!mid) return { ok: false, needConsent: true }
  const [m, bal, pts, cps] = await Promise.all([sel('members', `id=eq.${mid}&select=*`), sel('member_balance', `member_id=eq.${mid}`), sel('member_pts', `member_id=eq.${mid}&order=created_at.desc&limit=60&select=kind,pts,amount,note,created_at`), sel('member_coupons', `member_id=eq.${mid}&order=created_at.desc&limit=30&select=id,kind,name,value,status,expires_at,redeemed_at,created_at`)])
  if (!m[0] || m[0].status === 'left') return { ok: false, needConsent: true }
  const cfg = await loadCfg()
  let game = null; try { game = await availableDraws(mid, m[0]) } catch (_) { game = null } // 資料表還沒建（0002）就略過
  return { ok: true, member: pub(m[0]), balance: (bal[0] || {}).balance || 0, earned: (bal[0] || {}).earned || 0, ledger: pts, coupons: cps, qr: cardToken(mid), rewards: cfg.rewards.filter(r => r.active), perAmt: cfg.perAmt, game }
}
export async function custUpdate ({ body }) {
  const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期' }
  const mid = await identityOf(uid); if (!mid) return { ok: false, needConsent: true }
  const patch = { updated_at: nowIso() }
  if (body.name != null) { const n = String(body.name).trim().slice(0, 30); if (n) patch.name = n }
  if (body.phone != null) patch.phone = String(body.phone).replace(/\D/g, '').slice(0, 15) || null
  if (body.birthday != null) { const b = String(body.birthday).slice(0, 10); const cur = (await sel('members', `id=eq.${mid}&select=birthday`))[0]; if (!cur.birthday && /^\d{4}-\d{2}-\d{2}$/.test(b)) patch.birthday = b } // 生日只能填一次（防反覆領生日禮）
  await upd('members', `id=eq.${mid}`, patch)
  return custMe({ body })
}
export async function custLeave ({ body }) { // 退會＝匿名化（姓名／手機／照片清空），點數流水與券保留做帳
  const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期' }
  const mid = await identityOf(uid); if (!mid) return { ok: true }
  await upd('members', `id=eq.${mid}`, { name: '（已退會）', phone: null, pic: null, birthday: null, status: 'left', updated_at: nowIso() })
  return { ok: true }
}

// ── 店家（/prep 會員分頁）──
export async function listMembers ({ q, limit }) {
  q = String(q || '').trim(); const lim = Math.min(200, Number(limit) || 50)
  let qs = `brand=eq.${BRAND}&order=created_at.desc&limit=${lim}&select=id,mno,name,phone,pic,status,src,created_at`
  if (q) { const enc = encodeURIComponent(`%${q}%`); qs += `&or=(name.ilike.${enc},phone.ilike.${enc},mno.ilike.${enc})` }
  const rows = await sel('members', qs)
  const ids = rows.map(r => r.id); const bal = ids.length ? await sel('member_balance', `member_id=in.(${ids.join(',')})`) : []
  const bm = {}; bal.forEach(b => { bm[b.member_id] = b.balance })
  return rows.map(r => ({ ...r, phone: maskPhone(r.phone), balance: bm[r.id] || 0 }))
}
const maskPhone = (p) => p ? String(p).replace(/^(\d{4})\d+(\d{3})$/, '$1***$2') : ''
export async function stats () {
  const [n, today, bal] = await Promise.all([sel('members', `brand=eq.${BRAND}&status=eq.active&select=id`), sel('member_pts', `created_at=gte.${new Date(Date.now() - 86400e3).toISOString()}&select=pts,kind`), sel('member_balance', 'select=balance')])
  return { members: n.length, todayEarn: today.filter(x => x.pts > 0).reduce((t, x) => t + x.pts, 0), todayUsed: today.filter(x => x.pts < 0).reduce((t, x) => t - x.pts, 0), outstanding: bal.reduce((t, b) => t + (b.balance > 0 ? b.balance : 0), 0) }
}
export async function getMember ({ id, mgr }) {
  const m = (await sel('members', `id=eq.${id}&select=*`))[0]; if (!m) return { ok: false, error: '找不到這位會員' }
  const [bal, pts, cps, vis, idn] = await Promise.all([sel('member_balance', `member_id=eq.${id}`), sel('member_pts', `member_id=eq.${id}&order=created_at.desc&limit=100`), sel('member_coupons', `member_id=eq.${id}&order=created_at.desc&limit=50`), sel('member_visits', `member_id=eq.${id}&order=created_at.desc&limit=50`), sel('member_identities', `member_id=eq.${id}&select=provider`)])
  return { ok: true, member: { ...m, phone: mgr ? m.phone : maskPhone(m.phone), hasLine: idn.length > 0 }, balance: (bal[0] || {}).balance || 0, earned: (bal[0] || {}).earned || 0, used: (bal[0] || {}).used || 0, ledger: pts, coupons: cps, visits: vis }
}
// 找人：掃到的 QR（GDM.…）或會員號碼或會員 id
export async function resolveMember (key) {
  key = String(key || '').trim(); if (!key) return { ok: false, error: '請輸入會員號碼或掃 QR' }
  if (key.startsWith('GDM.')) { const t = parseCardToken(key); if (!t) return { ok: false, error: 'QR 不是 GROUN:D 會員卡' }; if (t.expired) return { ok: false, error: 'QR 已過期（60 秒），請客人重新整理會員卡' }; key = t.memberId }
  const q = /^\d{6}$/.test(key) ? `mno=eq.${key}` : /^[0-9a-f-]{36}$/i.test(key) ? `id=eq.${key}` : `phone=eq.${key.replace(/\D/g, '')}`
  const m = (await sel('members', `${q}&select=id,mno,name,phone,pic,status`))[0]
  if (!m) return { ok: false, error: '找不到這位會員' }
  if (m.status !== 'active') return { ok: false, error: '這位會員已退會／停用' }
  const bal = (await sel('member_balance', `member_id=eq.${m.id}`))[0] || {}
  return { ok: true, member: { ...m, phone: maskPhone(m.phone) }, balance: bal.balance || 0 }
}
// 入點：店員輸會員（號碼／QR）＋金額（＋單號選填）；冪等＝單號或前端請求 id
export async function earn ({ who, mgr, key, amount, posNo, reqId, note }) {
  const cfg = await loadCfg()
  const r = await resolveMember(key); if (!r.ok) return r
  amount = Math.round(Number(amount) || 0); if (amount <= 0) return { ok: false, error: '金額要大於 0' }
  if (amount > cfg.capSingle && !mgr) return { ok: false, error: `單筆超過 ${cfg.capSingle} 元要主管操作` }
  const ref = posNo ? 'pos:' + String(posNo).trim().slice(0, 40) : 'req:' + String(reqId || crypto.randomUUID()).slice(0, 60)
  let visit
  try { visit = await ins('member_visits', { brand: BRAND, member_id: r.member.id, amount, source: 'staff', external_ref: ref, by_name: who.name, note: String(note || '').slice(0, 80) || null }) }
  catch (e) { if (e.status === 409) return { ok: false, dup: true, error: posNo ? `單號 ${posNo} 已經入過點了` : '這筆剛剛已經入過點了' }; throw e }
  const pts = ptsFor(cfg, amount)
  if (pts > 0) { try { await ins('member_pts', { brand: BRAND, member_id: r.member.id, kind: 'earn', pts, amount, ref: visit.id, idem_key: 'visit:' + visit.id, by_name: who.name, note: posNo ? '單號 ' + posNo : null }, 'return=minimal') } catch (e) { if (e.status !== 409) throw e } }
  const bal = (await sel('member_balance', `member_id=eq.${r.member.id}`))[0] || {}
  return { ok: true, member: r.member, pts, amount, balance: bal.balance || 0 }
}
// 兌換：櫃檯當場扣點＋出餐（券直接 redeemed）；RPC 原子
export async function redeem ({ who, key, rewardId, reqId }) {
  const cfg = await loadCfg(); const rw = cfg.rewards.find(x => x.id === rewardId && x.active !== false); if (!rw) return { ok: false, error: '找不到這個獎勵' }
  const r = await resolveMember(key); if (!r.ok) return r
  const out = await rpc('member_redeem', { p_member: r.member.id, p_name: rw.name, p_value: rw.value || 0, p_pts: rw.pts, p_idem: 'rdm:' + String(reqId || crypto.randomUUID()).slice(0, 60), p_by: who.name })
  if (!out || !out.ok) return { ok: false, error: (out && out.error) || '兌換失敗' }
  return { ok: true, member: r.member, reward: rw, balance: out.balance, dup: !!out.dup }
}
// 手動調整（留痕、必填原因）；單筆上限（非主管）
export async function adjust ({ who, mgr, id, pts, reason, reqId }) {
  pts = Math.round(Number(pts) || 0); if (!pts) return { ok: false, error: '點數不能是 0' }
  if (!String(reason || '').trim()) return { ok: false, error: '請寫原因' }
  if (Math.abs(pts) > 500 && !mgr) return { ok: false, error: '超過 500 點的調整要主管操作' }
  const m = (await sel('members', `id=eq.${id}&select=id,name`))[0]; if (!m) return { ok: false, error: '找不到這位會員' }
  try { await ins('member_pts', { brand: BRAND, member_id: id, kind: 'adjust', pts, idem_key: 'adj:' + String(reqId || crypto.randomUUID()).slice(0, 60), by_name: who.name, note: String(reason).slice(0, 80) }, 'return=minimal') } catch (e) { if (e.status !== 409) throw e }
  const bal = (await sel('member_balance', `member_id=eq.${id}`))[0] || {}
  return { ok: true, balance: bal.balance || 0 }
}
// 店員建會員（客人沒 LINE 或現場先建；之後 LINE 入會可用手機合併＝第二批）
export async function createByStaff ({ who, name, phone, note }) {
  name = String(name || '').trim().slice(0, 30); if (!name) return { ok: false, error: '請填名字' }
  phone = String(phone || '').replace(/\D/g, '').slice(0, 15)
  if (phone) { const ex = await sel('members', `phone=eq.${phone}&status=eq.active&select=id,name,mno`); if (ex.length) return { ok: false, error: `這個手機已經是會員：${ex[0].name}（${ex[0].mno}）`, exist: ex[0] } }
  const cfg = await loadCfg()
  const m = await ins('members', { brand: BRAND, mno: await newMno(), name, phone: phone || null, src: 'staff', consent_ver: cfg.consentVer, consent_at: nowIso(), status: 'active', note: String(note || '').slice(0, 200) || null })
  return { ok: true, member: pub(m) }
}
export async function staffUpdate ({ who, id, patch }) {
  const p = { updated_at: nowIso() }
  if (patch.name != null) p.name = String(patch.name).trim().slice(0, 30)
  if (patch.phone != null) p.phone = String(patch.phone).replace(/\D/g, '').slice(0, 15) || null
  if (patch.note != null) p.note = String(patch.note).slice(0, 300)
  if (patch.status && ['active', 'blocked'].includes(patch.status)) p.status = patch.status
  if (patch.birthday != null) p.birthday = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.birthday)) ? String(patch.birthday) : null
  await upd('members', `id=eq.${id}`, p)
  return getMember({ id, mgr: true })
}
// 加好友歡迎（inbox 的 follow 事件呼叫；只給文字，由 _inbox 用 replyToken 免費回）
export async function welcomeText () { const cfg = await loadCfg(); const L = liffId(); const link = L ? `https://liff.line.me/${L}` : 'https://ground-pm.vercel.app/member'; return String(cfg.welcomeText || DEF_CFG.welcomeText).replace('{link}', link) }
export const liffId = () => (process.env.LIFF_MEMBER_ID || process.env.LIFF_ID || '').trim() || null // LIFF app 一個端點一個：會員卡端點 https://ground-pm.vercel.app/member（liff.init 只保證在端點網址之下能用）

// ── 🎡 轉盤（第二批 v4.70.84；SQL 0002）──
const pubCamp = (c, slots) => { const free = {}, total = {}; for (const sl of (slots || [])) { total[sl.pidx] = (total[sl.pidx] || 0) + 1; if (!sl.taken_by) free[sl.pidx] = (free[sl.pidx] || 0) + 1 }
  return { id: c.id, name: c.name, type: c.type, status: c.status, startAt: c.start_at, endAt: c.end_at, rules: c.rules || {}, prizes: (c.prizes || []).map(p => ({ ...p, left: free[p.idx] || 0, total: total[p.idx] || 0 })), free: Object.values(free).reduce((a, b) => a + b, 0), total: Object.values(total).reduce((a, b) => a + b, 0) } }
async function activeCampaign () { const now = nowIso(); const rows = await sel('member_campaigns', `brand=eq.${BRAND}&status=eq.active&or=(start_at.is.null,start_at.lte.${now})&or=(end_at.is.null,end_at.gt.${now})&order=created_at.desc&limit=1`); return rows[0] || null }
// 這位會員現在有幾次可抽：入會 1 抽（活動期間內入會）＋活動期間內每筆入點 1 抽，扣掉已抽過的
async function availableDraws (mid, m) {
  const c = await activeCampaign(); if (!c) return null
  const slots = await sel('member_slots', `campaign_id=eq.${c.id}&select=pidx,taken_by`)
  const camp = pubCamp(c, slots)
  const rules = c.rules || {}; const rights = []
  const since = c.start_at || c.created_at
  if (rules.joinDraw !== false && m && m.created_at >= since) rights.push({ key: `join:${c.id}:${mid}`, label: '入會禮：轉一次' })
  if (rules.visitDraw !== false) { const vis = await sel('member_visits', `member_id=eq.${mid}&created_at=gte.${since}&amount=gte.${Number(rules.minAmount) || 0}&select=id,amount,created_at&order=created_at.desc&limit=50`); for (const v of vis) rights.push({ key: `visit:${v.id}`, label: `消費 ${v.amount} 元：轉一次` }) }
  const used = rights.length ? await sel('member_draws', `right_key=in.(${rights.map(r => '"' + r.key + '"').join(',')})&select=right_key`) : []
  const usedSet = new Set(used.map(u => u.right_key))
  const draws = await sel('member_draws', `member_id=eq.${mid}&campaign_id=eq.${c.id}&order=created_at.desc&limit=20&select=id,pidx,prize,created_at`)
  return { campaign: camp, rights: rights.filter(r => !usedSet.has(r.key)), draws }
}
export async function custDraw ({ body }) {
  const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期，請重新開啟會員卡' }
  const mid = await identityOf(uid); if (!mid) return { ok: false, needConsent: true }
  const m = (await sel('members', `id=eq.${mid}&select=*`))[0]; if (!m || m.status !== 'active') return { ok: false, error: '會員狀態不能參加' }
  const g = await availableDraws(mid, m); if (!g) return { ok: false, error: '現在沒有進行中的活動' }
  const key = String(body.rightKey || (g.rights[0] || {}).key || ''); if (!key || !g.rights.some(r => r.key === key)) return { ok: false, error: '沒有可用的抽獎機會' }
  const cfg = await loadCfg()
  const out = await rpc('member_draw', { p_member: mid, p_campaign: g.campaign.id, p_right: key, p_year_cap: cfg.yearCap || 900 })
  if (!out || !out.ok) return { ok: false, error: (out && out.error) || '抽獎失敗' }
  return { ok: true, drawId: out.drawId, pidx: out.pidx, prize: out.prize, capped: !!out.capped, dup: !!out.dup }
}
// 店家：活動管理
export async function listCampaigns () { const cs = await sel('member_campaigns', `brand=eq.${BRAND}&order=created_at.desc&limit=30`); const ids = cs.map(c => c.id); const slots = ids.length ? await sel('member_slots', `campaign_id=in.(${ids.join(',')})&select=campaign_id,pidx,taken_by`) : []; return cs.map(c => pubCamp(c, slots.filter(sl => sl.campaign_id === c.id))) }
export async function createCampaign ({ who, name, startAt, endAt, rules, prizes }) {
  const cfg = await loadCfg()
  name = String(name || '').trim().slice(0, 40); if (!name) return { ok: false, error: '請填活動名稱' }
  const pz = (Array.isArray(prizes) ? prizes : []).slice(0, 12).map((p, i) => ({ idx: i, name: String(p.name || '').trim().slice(0, 30), kind: ['pts', 'coupon', 'none'].includes(p.kind) ? p.kind : 'none', pts: Math.max(0, Math.round(Number(p.pts) || 0)), value: Math.max(0, Math.round(Number(p.value) || 0)), count: Math.max(0, Math.min(5000, Math.round(Number(p.count) || 0))) })).filter(p => p.name)
  if (!pz.length) return { ok: false, error: '至少一個獎項' }
  const over = pz.find(p => p.kind !== 'none' && p.value > cfg.prizeMax); if (over) return { ok: false, error: `「${over.name}」市值 ${over.value} 超過上限 ${cfg.prizeMax}（設定可改）` }
  const total = pz.reduce((n, p) => n + p.count, 0); if (!total || total > 5000) return { ok: false, error: '槽位總數要在 1～5000' }
  const c = await ins('member_campaigns', { brand: BRAND, name, type: 'wheel', status: 'draft', start_at: startAt ? new Date(startAt).toISOString() : null, end_at: endAt ? new Date(endAt).toISOString() : null, rules: { joinDraw: rules && rules.joinDraw !== false, visitDraw: rules && rules.visitDraw !== false, minAmount: Math.max(0, Number((rules || {}).minAmount) || 0), couponDays: Math.max(1, Number((rules || {}).couponDays) || 30), note: String((rules || {}).note || '').slice(0, 300) }, prizes: pz, created_by: who.name })
  const rows = []; for (const p of pz) for (let i = 0; i < p.count; i++) rows.push({ campaign_id: c.id, pidx: p.idx })
  for (let i = 0; i < rows.length; i += 1000) await ins('member_slots', rows.slice(i, i + 1000), 'return=minimal')
  return { ok: true, campaign: pubCamp(c, rows.map(r => ({ pidx: r.pidx, taken_by: null }))) }
}
export async function campaignStatus ({ who, id, status }) {
  if (!['active', 'paused', 'ended'].includes(status)) return { ok: false, error: '狀態不對' }
  if (status === 'active') { const cur = await activeCampaign(); if (cur && cur.id !== id) return { ok: false, error: `「${cur.name}」還在進行中，一次只能一個活動` } }
  await upd('member_campaigns', `id=eq.${id}`, { status, updated_at: nowIso() }); return { ok: true }
}
export async function campaignStats ({ id }) { const c = (await sel('member_campaigns', `id=eq.${id}`))[0]; if (!c) return { ok: false, error: '找不到活動' }; const [slots, draws] = await Promise.all([sel('member_slots', `campaign_id=eq.${id}&select=pidx,taken_by`), sel('member_draws', `campaign_id=eq.${id}&order=created_at.desc&limit=100&select=id,member_id,pidx,prize,created_at`)]); const mids = [...new Set(draws.map(d => d.member_id))]; const ms = mids.length ? await sel('members', `id=in.(${mids.join(',')})&select=id,name,mno`) : []; const mm = {}; ms.forEach(m => { mm[m.id] = m }); return { ok: true, campaign: pubCamp(c, slots), draws: draws.map(d => ({ ...d, member: mm[d.member_id] || {} })) } }
// 店家核銷券（遊戲獎品／之後的優惠券）
export async function couponUse ({ who, couponId, ref }) { const out = await rpc('member_coupon_use', { p_coupon: couponId, p_by: who.name, p_ref: String(ref || '').slice(0, 40) || null }); return out && out.ok ? { ok: true, name: out.name } : { ok: false, error: (out && out.error) || '核銷失敗' } }
