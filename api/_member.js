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
export const MEMBER_VER = '4812'

// ── 設定 ──
const CFG_KEY = 'pm_member_cfg'
const DEF_CFG = { perAmt: 10, capSingle: 3000, capDailyStaff: 20000, welcomePts: 0, rewards: [{ id: 'r1', name: '飲料升級（套餐飲品任選）', value: 40, pts: 100, active: true }], yearCap: 900, prizeMax: 500, sellerTaxId: '', invoiceScan: false, grpShareCap: 50,
  stores: { gd: { name: 'GROUN:D', perAmt: 10, active: true }, ab: { name: 'A Beach 101', perAmt: 10, active: true } }, // 跨店：同一個錢包，各店累點比例可不同
  pointValue: 1, // 1 點折抵幾元（折抵型兌換與店間結算用）
  missions: [
    { id: 'first', type: 'first', name: '首次消費', desc: '完成第一筆消費', pts: 20, active: true },
    { id: 'm4', type: 'count_month', name: '本月來 4 次', desc: '同一個月內消費 4 次', n: 4, pts: 0, coupon: { name: '免費飲料券', value: 50 }, active: true },
    { id: 'd3', type: 'days_month', name: '一個月 3 個不同日子', desc: '同一個月內 3 個不同日期來消費', n: 3, pts: 50, active: true },
    { id: 'wk', type: 'weekday_bonus', name: '週一、二點數 1.5 倍', desc: '週一、週二消費累點 ×1.5', days: [1, 2], mult: 1.5, active: false },
    { id: 'sv', type: 'survey', name: '用餐回饋', desc: '填一份用餐問卷（每月一次）', pts: 10, active: true },
    { id: 'r3', type: 'referral_milestone', name: '成功推薦 3 位', desc: '累計 3 位朋友完成首購', n: 3, pts: 100, active: true },
    { id: 'r5', type: 'referral_milestone', name: '成功推薦 5 位', desc: '累計 5 位朋友完成首購', n: 5, pts: 200, active: true },
    { id: 'r10', type: 'referral_milestone', name: '成功推薦 10 位', desc: '累計 10 位朋友完成首購', n: 10, pts: 500, active: true },
  ],
  referral: { referrerPts: 50, refereePts: 50, monthlyCap: 10, active: true },
  // v4.71.1 等級：近 N 天消費「次數」決定（計畫「之後」批次：近 90 天消費次數算 2 級）；levels 由低到高，n＝達到此級要的次數，mult＝累點倍率。等級不存資料庫、每次用同一條算法現算（資料一致）
  tiers: { active: true, days: 90, levels: [{ id: 'base', name: '會員', n: 0, mult: 1 }, { id: 'vip', name: '常客', n: 4, mult: 1.2 }] },
  // v4.71.1 生日禮：生日「當月」每年一次（冪等 m:birthday:<會員>:<年>），給點數或券（券 60 天內有效）；每天 08:00 自動發（cron-daily）；客人沒填生日就領不到，會員卡任務頁會提醒
  birthday: { active: true, pts: 0, coupon: { name: '生日飲料券', value: 50 }, push: false },
  promoText: '', address: '', phone: '', mapUrl: '', igUrl: '', fbUrl: '', hours: '週一～週五 11:00–19:00（週末休）', welcomeText: '歡迎加入 GROUN:D！點下面連結開啟會員卡（會自動帶入你的 LINE 名字），消費出示會員號碼或 QR 就能累點：\n{link}', consentText: 'GROUN:D（{entity}）為提供會員點數、優惠與訂單服務，蒐集您的 LINE 名稱、手機號碼（選填）與消費紀錄，於營運期間在台灣境內使用。您可隨時在會員卡頁查詢、更正資料或退會；退會後個資會匿名化，交易紀錄依法保留。', entity: '', consentVer: '2026-10-12', ver: 1 }
export async function loadCfg () { const c = (await kvGet(CFG_KEY)) || {}; return { ...DEF_CFG, ...c, rewards: Array.isArray(c.rewards) && c.rewards.length ? c.rewards : DEF_CFG.rewards } }
export async function saveCfg (patch, who) {
  const c = await loadCfg(); const n = { ...c, ...(patch || {}) }
  n.sellerTaxId = String(n.sellerTaxId || '').replace(/\D/g, '').slice(0, 8); n.invoiceScan = !!n.invoiceScan; n.grpShareCap = Math.max(0, Math.min(100, Math.round(Number(n.grpShareCap) || 50)))
  n.stores = n.stores && typeof n.stores === 'object' ? n.stores : DEF_CFG.stores; for (const k of Object.keys(n.stores)) n.stores[k] = { name: String(n.stores[k].name || k).slice(0, 30), perAmt: Math.max(1, Math.round(Number(n.stores[k].perAmt) || 10)), active: n.stores[k].active !== false }
  n.pointValue = Math.max(0.1, Number(n.pointValue) || 1)
  n.missions = (Array.isArray(n.missions) ? n.missions : DEF_CFG.missions).slice(0, 30).map((x, i) => ({ id: String(x.id || 'ms' + (i + 1)).slice(0, 16), type: String(x.type || 'count_month'), name: String(x.name || '').slice(0, 30), desc: String(x.desc || '').slice(0, 80), n: Math.max(1, Math.round(Number(x.n) || 1)), pts: Math.max(0, Math.round(Number(x.pts) || 0)), coupon: x.coupon && x.coupon.name ? { name: String(x.coupon.name).slice(0, 30), value: Math.max(0, Math.round(Number(x.coupon.value) || 0)) } : null, days: Array.isArray(x.days) ? x.days.map(Number).filter(d => d >= 0 && d <= 6) : [1, 2], mult: Math.max(1, Number(x.mult) || 1.5), active: x.active !== false })).filter(x => x.name)
  n.referral = { ...DEF_CFG.referral, ...(n.referral || {}) }; n.referral.referrerPts = Math.max(0, Math.round(Number(n.referral.referrerPts) || 0)); n.referral.refereePts = Math.max(0, Math.round(Number(n.referral.refereePts) || 0)); n.referral.monthlyCap = Math.max(0, Math.round(Number(n.referral.monthlyCap) || 0)); n.referral.active = n.referral.active !== false
  for (const k of ['promoText', 'address', 'phone', 'mapUrl', 'igUrl', 'fbUrl', 'hours']) n[k] = String(n[k] || '').slice(0, k === 'promoText' ? 400 : 200)
  { const T = { ...DEF_CFG.tiers, ...(n.tiers || {}) }; T.active = T.active !== false; T.days = Math.max(7, Math.min(730, Math.round(Number(T.days) || 90))); T.levels = (Array.isArray(T.levels) && T.levels.length ? T.levels : DEF_CFG.tiers.levels).slice(0, 6).map((l, i) => ({ id: String(l.id || 'lv' + i).slice(0, 12), name: String(l.name || '').slice(0, 12) || ('等級 ' + (i + 1)), n: Math.max(0, Math.round(Number(l.n) || 0)), mult: Math.max(1, Math.min(5, Math.round((Number(l.mult) || 1) * 10) / 10)) })).sort((a, b) => a.n - b.n); T.levels[0].n = 0; n.tiers = T } // v4.71.1 最低級一定從 0 次起算、倍率 1～5、最多 6 級
  { const B = { ...DEF_CFG.birthday, ...(n.birthday || {}) }; B.active = B.active !== false; B.pts = Math.max(0, Math.round(Number(B.pts) || 0)); B.coupon = B.coupon && B.coupon.name ? { name: String(B.coupon.name).slice(0, 30), value: Math.max(0, Math.round(Number(B.coupon.value) || 0)) } : null; B.push = !!B.push; n.birthday = B }
  n.yearCap = Math.max(100, Math.round(Number(n.yearCap) || 900)); n.prizeMax = Math.max(50, Math.round(Number(n.prizeMax) || 500))
  n.perAmt = Math.max(1, Math.round(Number(n.perAmt) || 10)); n.capSingle = Math.max(100, Math.round(Number(n.capSingle) || 3000)); n.welcomePts = Math.max(0, Math.round(Number(n.welcomePts) || 0))
  n.rewards = (Array.isArray(n.rewards) ? n.rewards : []).slice(0, 30).map((r, i) => ({ id: String(r.id || 'r' + (i + 1)).slice(0, 12), name: String(r.name || '').slice(0, 40), value: Math.max(0, Math.round(Number(r.value) || 0)), pts: Math.max(1, Math.round(Number(r.pts) || 1)), active: r.active !== false })).filter(r => r.name)
  n.ver = (c.ver || 1) + 1; n.by = who && who.name; n.at = nowIso()
  await kvSet(CFG_KEY, n, '會員設定(' + ((who && who.name) || '') + ')'); return { ok: true, cfg: n }
}
// ── 等級（v4.71.1）：單一算法，會員卡／GD 名單／入點倍率／DD 都呼叫這裡 ──
export function tierOf (cfg, nRecent) { const T = cfg.tiers || {}; const lv = (T.levels || []).slice().sort((a, b) => (a.n || 0) - (b.n || 0)); if (T.active === false || !lv.length) return null; let cur = lv[0]; for (const l of lv) if (nRecent >= (l.n || 0)) cur = l; const idx = lv.indexOf(cur); const next = lv[idx + 1] || null; return { id: cur.id, name: cur.name, mult: Number(cur.mult) || 1, n: nRecent, days: T.days || 90, next: next ? { name: next.name, n: next.n, need: Math.max(0, (next.n || 0) - nRecent), mult: Number(next.mult) || 1 } : null, top: !next } }
async function recentCounts (mids, cfg) { const days = (cfg.tiers || {}).days || 90; if (!mids.length) return {}; const since = new Date(Date.now() - days * 86400e3).toISOString(); const rows = await sel('member_visits', `member_id=in.(${mids.join(',')})&created_at=gte.${since}&select=member_id`); const c = {}; rows.forEach(r => { c[r.member_id] = (c[r.member_id] || 0) + 1 }); return c }
export async function tierFor (mid, cfg) { cfg = cfg || await loadCfg(); const c = await recentCounts([mid], cfg); return tierOf(cfg, c[mid] || 0) }
// 累點倍率（等級×平日加倍）：earn（店員入點）與 earnFromOrder（團訂自動入點）共用，同一筆消費兩邊算出來一樣
async function bonusPts (cfg, mid, amount, store) { let pts = ptsFor(cfg, amount, store); const notes = []; if (pts > 0) { const tier = await tierFor(mid, cfg).catch(() => null); if (tier && tier.mult !== 1) { pts = Math.round(pts * tier.mult); notes.push(`${tier.name} ×${tier.mult}`) } const wk = weekdayBonus(cfg); if (wk) { pts = Math.round(pts * wk.mult); notes.push(wk.name) } } return { pts, notes, bonus: notes.join('、') || null } }
export const ptsFor = (cfg, amount, store) => { const per = (store && cfg.stores && cfg.stores[store] && cfg.stores[store].perAmt) || cfg.perAmt || 10; return Math.floor((Number(amount) || 0) / per) }

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
    try { const refMno = String(body.ref || '').replace(/\D/g, '').slice(0, 6); if (refMno && cfg.referral.active !== false) { const rf = (await sel('members', `mno=eq.${refMno}&status=eq.active&select=id`))[0]; if (rf && rf.id !== mid) { await upd('members', `id=eq.${mid}`, { ref_by: rf.id }); await ins('member_referrals', { referrer_id: rf.id, referee_id: mid }, 'return=minimal') } } } catch (_) {} // 一層推薦：只能綁一次、不能推自己
    try { await ins('member_identities', { provider: 'line', line_uid: uid, member_id: mid }, 'return=minimal') } catch (e) { if (e.status !== 409) throw e }
    richMenuLinkMember(uid).catch(() => {})
    if (cfg.welcomePts > 0) { try { await ins('member_pts', { brand: BRAND, member_id: mid, kind: 'welcome', pts: cfg.welcomePts, idem_key: 'welcome:' + mid, note: '入會禮' }, 'return=minimal') } catch (_) {} }
  } else {
    await upd('members', `id=eq.${mid}`, { name, ...(phone ? { phone } : {}), consent_ver: cfg.consentVer, consent_at: nowIso(), status: 'active', updated_at: nowIso() })
  }
  return { ok: true, created, ...(await custMe({ body })) }
}
export async function custWho2 ({ body }) { const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期' }; const cfg = await loadCfg(); const mid = await identityOf(uid); return { ok: true, needConsent: !mid, consentText: cfg.consentText.replace('{entity}', cfg.entity || 'GROUN:D'), consentVer: cfg.consentVer } }
export async function custMe ({ body }) {
  const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期，請重新開啟會員卡' }
  const mid = await identityOf(uid); if (!mid) return { ok: false, needConsent: true }
  const [m, bal, pts, cps] = await Promise.all([sel('members', `id=eq.${mid}&select=*`), sel('member_balance', `member_id=eq.${mid}`), sel('member_pts', `member_id=eq.${mid}&order=created_at.desc&limit=60&select=kind,pts,amount,note,created_at`), sel('member_coupons', `member_id=eq.${mid}&order=created_at.desc&limit=30&select=id,kind,name,value,status,expires_at,redeemed_at,created_at`)])
  if (!m[0] || m[0].status === 'left') return { ok: false, needConsent: true }
  const cfg = await loadCfg()
  let game = null; try { game = await availableDraws(mid, m[0]) } catch (_) { game = null } // 資料表還沒建（0002）就略過
  const mkt = (await kvGet('pm_member_mktout')) || {}
  let missions = [], referral = null, tier = null, birthdayGift = null; try { missions = await missionProgress(mid, cfg) } catch (_) {} try { referral = await referralInfo(mid, m[0], cfg) } catch (_) {}
  try { tier = await tierFor(mid, cfg) } catch (_) {} try { birthdayGift = await birthdayStatus(mid, m[0], cfg) } catch (_) {}
  return { ok: true, missions, referral, tier, birthdayGift, stores: cfg.stores, pointValue: cfg.pointValue, promoText: cfg.promoText, info: { address: cfg.address, phone: cfg.phone, mapUrl: cfg.mapUrl, igUrl: cfg.igUrl, fbUrl: cfg.fbUrl, hours: cfg.hours }, member: pub(m[0]), balance: (bal[0] || {}).balance || 0, earned: (bal[0] || {}).earned || 0, ledger: pts, coupons: cps, qr: cardToken(mid), rewards: cfg.rewards.filter(r => r.active), perAmt: cfg.perAmt, game, invoiceScan: !!(cfg.invoiceScan && cfg.sellerTaxId), mktOut: !!mkt[uid] }
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
  const cfg = await loadCfg(); let rc = {}; try { rc = await recentCounts(ids, cfg) } catch (_) {}
  return rows.map(r => { const t = tierOf(cfg, rc[r.id] || 0); return { ...r, phone: maskPhone(r.phone), balance: bm[r.id] || 0, tier: t ? t.name : '', tierN: rc[r.id] || 0 } })
}
const maskPhone = (p) => p ? String(p).replace(/^(\d{4})\d+(\d{3})$/, '$1***$2') : ''
export async function stats () {
  const [n, today, bal] = await Promise.all([sel('members', `brand=eq.${BRAND}&status=eq.active&select=id`), sel('member_pts', `created_at=gte.${new Date(Date.now() - 86400e3).toISOString()}&select=pts,kind`), sel('member_balance', 'select=balance')])
  return { members: n.length, todayEarn: today.filter(x => x.pts > 0).reduce((t, x) => t + x.pts, 0), todayUsed: today.filter(x => x.pts < 0).reduce((t, x) => t - x.pts, 0), outstanding: bal.reduce((t, b) => t + (b.balance > 0 ? b.balance : 0), 0) }
}
export async function getMember ({ id, mgr }) {
  const m = (await sel('members', `id=eq.${id}&select=*`))[0]; if (!m) return { ok: false, error: '找不到這位會員' }
  const [bal, pts, cps, vis, idn] = await Promise.all([sel('member_balance', `member_id=eq.${id}`), sel('member_pts', `member_id=eq.${id}&order=created_at.desc&limit=100`), sel('member_coupons', `member_id=eq.${id}&order=created_at.desc&limit=50`), sel('member_visits', `member_id=eq.${id}&order=created_at.desc&limit=50`), sel('member_identities', `member_id=eq.${id}&select=provider`)])
  let tier = null; try { tier = await tierFor(id) } catch (_) {}
  return { ok: true, tier, member: { ...m, phone: mgr ? m.phone : maskPhone(m.phone), hasLine: idn.length > 0 }, balance: (bal[0] || {}).balance || 0, earned: (bal[0] || {}).earned || 0, used: (bal[0] || {}).used || 0, ledger: pts, coupons: cps, visits: vis }
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
export async function earn ({ who, mgr, key, amount, posNo, reqId, note, store }) {
  const cfg = await loadCfg(); store = cfg.stores && cfg.stores[store] ? store : 'gd'
  const r = await resolveMember(key); if (!r.ok) return r
  amount = Math.round(Number(amount) || 0); if (amount <= 0) return { ok: false, error: '金額要大於 0' }
  if (amount > cfg.capSingle && !mgr) return { ok: false, error: `單筆超過 ${cfg.capSingle} 元要主管操作` }
  const ref = posNo ? 'pos:' + String(posNo).trim().slice(0, 40) : 'req:' + String(reqId || crypto.randomUUID()).slice(0, 60)
  let visit
  try { visit = await ins('member_visits', { brand: BRAND, store, member_id: r.member.id, amount, source: 'staff', external_ref: ref, by_name: who.name, note: String(note || '').slice(0, 80) || null }) }
  catch (e) { if (e.status === 409) return { ok: false, dup: true, error: posNo ? `單號 ${posNo} 已經入過點了` : '這筆剛剛已經入過點了' }; throw e }
  const bp = await bonusPts(cfg, r.member.id, amount, store); const pts = bp.pts
  if (pts > 0) { try { await ins('member_pts', { brand: BRAND, store, member_id: r.member.id, kind: 'earn', pts, amount, ref: visit.id, idem_key: 'visit:' + visit.id, by_name: who.name, note: (posNo ? '單號 ' + posNo : '') + (bp.bonus ? '（' + bp.bonus + '）' : '') || null }, 'return=minimal') } catch (e) { if (e.status !== 409) throw e } }
  let got = []; try { got = await afterVisit(r.member.id, visit, store) } catch (_) {} // 任務／推薦（失敗不影響入點）
  const bal = (await sel('member_balance', `member_id=eq.${r.member.id}`))[0] || {}
  return { ok: true, member: r.member, pts, amount, store, bonus: bp.bonus, missions: got, balance: bal.balance || 0 }
}
// 兌換：櫃檯當場扣點＋出餐（券直接 redeemed）；RPC 原子
export async function redeem ({ who, key, rewardId, reqId, store, cashAmt }) {
  const cfg = await loadCfg(); store = cfg.stores && cfg.stores[store] ? store : 'gd'
  let rw = cfg.rewards.find(x => x.id === rewardId && x.active !== false)
  if (rewardId === 'cash') { const amt = Math.max(1, Math.round(Number(cashAmt) || 0)); rw = { id: 'cash', name: `折抵 ${amt} 元`, value: amt, pts: Math.ceil(amt / (cfg.pointValue || 1)), kind: 'cash' } } // 折抵型：任意金額換點（1 點＝pointValue 元）
  if (!rw) return { ok: false, error: '找不到這個獎勵' }
  const r = await resolveMember(key); if (!r.ok) return r
  const out = await rpc('member_redeem', { p_member: r.member.id, p_name: rw.name, p_value: rw.value || 0, p_pts: rw.pts, p_idem: 'rdm:' + String(reqId || crypto.randomUUID()).slice(0, 60), p_by: who.name })
  if (!out || !out.ok) return { ok: false, error: (out && out.error) || '兌換失敗' }
  try { if (out.couponId) await upd('member_coupons', `id=eq.${out.couponId}`, { store }); await upd('member_pts', `idem_key=eq.${encodeURIComponent('rdm:' + String(reqId || '').slice(0, 60))}`, { store }) } catch (_) {}
  return { ok: true, member: r.member, reward: rw, store, balance: out.balance, dup: !!out.dup }
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
// 🗑 刪除會員 v4.71.2（張良 2026-10-12「好像沒有刪除的功能」）：主管限定、真刪除＝連點數流水／消費／券／抽獎／推薦／任務／問卷／LINE 身分一起清掉（測試資料清理用；正式客人建議用「退會」留帳）
async function del (table, q) { const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, { method: 'DELETE', headers: H({ Prefer: 'return=minimal' }) }); if (!r.ok && r.status !== 404) { const t = await r.text().catch(() => ''); if (!/relation .* does not exist|PGRST205|42P01/.test(t)) throw new Error(tableErr(r.status, t)) } }
export async function deleteMember ({ who, mgr, id }) {
  if (!mgr) return { ok: false, error: '只有主管能刪除會員' }
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return { ok: false, error: '會員 id 不對' }
  const m = (await sel('members', `id=eq.${id}&select=id,name,mno`))[0]; if (!m) return { ok: false, error: '找不到這位會員' }
  const e = encodeURIComponent(id)
  await upd('member_slots', `taken_by=eq.${e}`, { taken_by: null }).catch(() => {}) // 轉盤槽位：還回獎池（不刪槽位）
  for (const t of ['member_draws', 'member_coupons', 'member_pts', 'member_visits', 'member_missions_done', 'member_surveys']) await del(t, `member_id=eq.${e}`)
  await del('member_referrals', `or=(referrer_id.eq.${e},referee_id.eq.${e})`)
  await upd('members', `ref_by=eq.${e}`, { ref_by: null }).catch(() => {})
  await del('member_identities', `member_id=eq.${e}`)
  await del('members', `id=eq.${e}`)
  console.log('member deleted', JSON.stringify({ by: who && who.name, id, mno: m.mno, name: m.name }))
  return { ok: true, deleted: { id, mno: m.mno, name: m.name } }
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
export async function welcomeText () { const cfg = await loadCfg(); const link = memberLiffUrl(); return String(cfg.welcomeText || DEF_CFG.welcomeText).replace('{link}', link) }
export const liffId = () => (process.env.LIFF_ID || process.env.LIFF_MEMBER_ID || '').trim() || null // v4.70.91 同一個 LIFF：liff.line.me/<ID>?to=member 由 /liff/ 落地頁認完人再轉 /member（張良：原本那一個就要能帶客人 LINE ID）
export const memberLiffUrl = () => { const L = liffId(); return L ? `https://liff.line.me/${L}?to=member` : 'https://ground-pm.vercel.app/member' } // LIFF app 一個端點一個：會員卡端點 https://ground-pm.vercel.app/member（liff.init 只保證在端點網址之下能用）

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

// ── 第三批 v4.70.86：團訂自動入點／收件匣顯示會員／電子發票自助集點／行銷推播／對帳報表 ──
// 團體訂餐標「完成」→ 有 LINE 身分的人依自己小計入點；共用品項歸主辦人（建單對話那位客人），上限＝全單的 grpShareCap%；冪等 grp:<訂單>:<列 pid>
export async function earnFromOrder (o) {
  const C = await import('../public/ops/js/grporder-calc.js'); const menu = C.normMenu(await kvGet('sp_finance_pm_menu'))
  const cfg = await loadCfg(); const t = C.totals(menu, o); let n = 0, pts = 0
  const put = async (mid, amount, ref, note) => { if (!mid || amount <= 0) return; let v; try { v = await ins('member_visits', { brand: BRAND, member_id: mid, amount, source: 'grporder', external_ref: ref, by_name: '系統', note }) } catch (e) { if (e.status === 409) return; throw e }; const bp = await bonusPts(cfg, mid, amount, 'gd'); const p = bp.pts; if (p > 0) { try { await ins('member_pts', { brand: BRAND, member_id: mid, kind: 'earn', pts: p, amount, ref: v.id, idem_key: 'visit:' + v.id, note: note + (bp.bonus ? '（' + bp.bonus + '）' : '') }, 'return=minimal'); n++; pts += p } catch (e) { if (e.status !== 409) throw e } } try { await afterVisit(mid, v, 'gd') } catch (_) {} }
  for (const r of (o.rows || [])) { if (r.src !== 'line' || !r.uid) continue; const mid = await identityOf(r.uid); if (!mid) continue; const amt = C.priceRow(menu, r, o.frozen).total; await put(mid, amt, `grp:${o.id}:${r.pid}`, `團體訂餐 ${o.company || ''}`) }
  if (t.shared > 0 && o.uid) { const mid = await identityOf(o.uid); const cap = Math.round(t.total * (cfg.grpShareCap || 50) / 100); await put(mid, Math.min(t.shared, cap), `grp:${o.id}:shared`, `團體訂餐共用品項 ${o.company || ''}`) }
  return { n, pts }
}
export async function memberCard (uid) { // v4.71.12 收件匣客戶資料（速度鐵則）：身分→（會員＋手機、點數、最近消費）同時查＝2 趟
  const mid = await identityOf(String(uid || '')); if (!mid) return null
  const [mm, bal, last] = await Promise.all([sel('members', `id=eq.${mid}&select=id,mno,name,status,created_at,phone`), sel('member_balance', `member_id=eq.${mid}`), sel('member_visits', `member_id=eq.${mid}&order=created_at.desc&limit=1&select=created_at,amount`)])
  const m = mm[0]; if (!m) return null
  const { phone, ...pubM } = m; return { member: { ...pubM, balance: (bal[0] || {}).balance || 0, lastVisit: last[0] || null }, phone: phone || '' }
}
export async function phoneOfMember (mid) { const m = (await sel('members', `id=eq.${encodeURIComponent(mid)}&select=phone`))[0]; return (m && m.phone) || '' } // v4.71.12 收件匣客戶資料：用會員手機對 inline 訂位（只給收件匣伺服器端用）
export async function byUid (uid) { const mid = await identityOf(String(uid || '')); if (!mid) return { ok: true, member: null }; const m = (await sel('members', `id=eq.${mid}&select=id,mno,name,status,created_at`))[0]; if (!m) return { ok: true, member: null }; const bal = (await sel('member_balance', `member_id=eq.${mid}`))[0] || {}; const last = (await sel('member_visits', `member_id=eq.${mid}&order=created_at.desc&limit=1&select=created_at,amount`))[0] || null; return { ok: true, member: { ...m, balance: bal.balance || 0, lastVisit: last } } }
// 電子發票左 QR：發票號碼10＋民國日期7＋隨機碼4＋銷售額8(hex)＋總計8(hex)＋買方統編8＋賣方統編8＋加密24＋...；賣方＝自家才算、48 小時內、發票號碼唯一
export function parseInvoiceQR (txt) {
  const t = String(txt || '').trim(); if (!/^[A-Z]{2}\d{8}\d{7}\d{4}[0-9A-F]{8}[0-9A-F]{8}\d{8}\d{8}/.test(t)) return null
  const no = t.slice(0, 10), ymd = t.slice(10, 17), total = parseInt(t.slice(29, 37), 16), buyer = t.slice(37, 45), seller = t.slice(45, 53)
  const y = Number(ymd.slice(0, 3)) + 1911, dt = `${y}-${ymd.slice(3, 5)}-${ymd.slice(5, 7)}`
  return { no, date: dt, total, buyer, seller }
}
export async function custInvoice ({ body }) {
  const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期，請重新開啟會員卡' }
  const mid = await identityOf(uid); if (!mid) return { ok: false, needConsent: true }
  const cfg = await loadCfg(); if (!cfg.invoiceScan || !cfg.sellerTaxId) return { ok: false, error: '掃發票集點尚未開放' }
  const inv = parseInvoiceQR(body.qr); if (!inv) return { ok: false, error: '這不是電子發票的 QR（請掃發票左邊那顆）' }
  if (inv.seller !== cfg.sellerTaxId) return { ok: false, error: '這張不是 GROUN:D 開的發票' }
  const age = Date.now() - new Date(inv.date + 'T00:00:00+08:00').getTime(); if (age > 3 * 86400e3 || age < -86400e3) return { ok: false, error: '只能登錄 48 小時內的發票' }
  if (!(inv.total > 0)) return { ok: false, error: '發票金額讀不到' }
  let v; try { v = await ins('member_visits', { brand: BRAND, member_id: mid, amount: inv.total, source: 'invoice', external_ref: 'inv:' + inv.no, by_name: '客人自助', note: '發票 ' + inv.no }) } catch (e) { if (e.status === 409) return { ok: false, error: `發票 ${inv.no} 已經登錄過了` }; throw e }
  const pts = ptsFor(cfg, inv.total); if (pts > 0) { try { await ins('member_pts', { brand: BRAND, member_id: mid, kind: 'earn', pts, amount: inv.total, ref: v.id, idem_key: 'visit:' + v.id, note: '發票 ' + inv.no }, 'return=minimal') } catch (e) { if (e.status !== 409) throw e } }
  return { ok: true, pts, amount: inv.total, no: inv.no, ...(await custMe({ body })) }
}
export async function custMktOut ({ body }) { const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期' }; const d = (await kvGet('pm_member_mktout')) || {}; if (body.out) d[uid] = nowIso(); else delete d[uid]; await kvSet('pm_member_mktout', d, '會員行銷選項'); return { ok: true, mktOut: !!body.out } }
// 分眾：all／active30（近 30 天有消費）／sleep30（有消費但近 30 天沒來）／never（沒消費過）／pts（有點數）
async function segmentUids (seg) {
  const ids = await sel('member_identities', 'provider=eq.line&select=line_uid,member_id'); const ms = await sel('members', `brand=eq.${BRAND}&status=eq.active&select=id`); const act = new Set(ms.map(m => m.id))
  const vis = await sel('member_visits', 'select=member_id,created_at&order=created_at.desc&limit=5000'); const last = {}; for (const v of vis) if (!last[v.member_id]) last[v.member_id] = v.created_at
  const bal = await sel('member_balance', 'balance=gt.0&select=member_id'); const hasPts = new Set(bal.map(b => b.member_id))
  const cut = Date.now() - 30 * 86400e3; const mkt = (await kvGet('pm_member_mktout')) || {}
  return ids.filter(i => act.has(i.member_id) && !mkt[i.line_uid]).filter(i => { const l = last[i.member_id]; if (seg === 'active30') return l && new Date(l).getTime() >= cut; if (seg === 'sleep30') return l && new Date(l).getTime() < cut; if (seg === 'never') return !l; if (seg === 'pts') return hasPts.has(i.member_id); return true }).map(i => i.line_uid)
}
export async function pushPreview ({ segment }) { const IB = await import('./_inbox.js'); const a = IB.acctOf('gd'); const uids = await segmentUids(segment); let quota = null; try { quota = await IB.quotaOf(a) } catch (_) {} return { ok: true, n: uids.length, quota } }
export async function pushSend ({ who, segment, text, test }) {
  text = String(text || '').trim().slice(0, 1000); if (!text) return { ok: false, error: '沒有內容' }
  const IB = await import('./_inbox.js'); const a = IB.acctOf('gd'); const { token } = IB.creds(a); if (!token) return { ok: false, error: 'GROUN:D 官方帳號金鑰未設' }
  let uids
  if (test) { const ros = await kvGet('sp_crew_kb_roster'); const me = ((ros || {}).people || []).find(x => x.name === who.name && x.lineUserId); if (!me) return { ok: false, error: '你的 LINE 沒綁在名冊，無法測試發給自己' }; uids = [me.lineUserId] } else uids = await segmentUids(segment)
  if (!uids.length) return { ok: false, error: '這個分眾沒有人' }
  let sent = 0, fail = 0
  for (let i = 0; i < uids.length; i += 500) { const r = await fetch('https://api.line.me/v2/bot/message/multicast', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'X-Line-Retry-Key': crypto.randomUUID() }, body: JSON.stringify({ to: uids.slice(i, i + 500), messages: [{ type: 'text', text }] }) }); if (r.ok) sent += Math.min(500, uids.length - i); else fail += Math.min(500, uids.length - i) }
  const d = (await kvGet('pm_member_push')) || { list: [] }; d.list = [{ t: nowIso(), by: who.name, segment: test ? 'test' : segment, n: uids.length, sent, fail, text: text.slice(0, 200) }, ...(d.list || [])].slice(0, 100); await kvSet('pm_member_push', d, '會員推播(' + who.name + ')')
  return { ok: true, n: uids.length, sent, fail }
}
export async function pushLog () { return ((await kvGet('pm_member_push')) || { list: [] }).list }
// 對帳：每天店員入點金額 vs POS 實收；店員入點排行；可疑（同會員 10 分內兩筆、單筆超上限）
export async function report ({ days }) {
  const n = Math.min(60, Number(days) || 14); const since = new Date(Date.now() - n * 86400e3).toISOString()
  const vis = await sel('member_visits', `created_at=gte.${since}&order=created_at.desc&limit=5000&select=id,member_id,amount,source,external_ref,by_name,created_at`)
  const cfg = await loadCfg()
  const tw = (iso) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10)
  const byDay = {}; for (const v of vis) { const d = tw(v.created_at); (byDay[d] = byDay[d] || { staff: 0, inv: 0, grp: 0, n: 0 }); byDay[d][v.source === 'staff' ? 'staff' : v.source === 'invoice' ? 'inv' : 'grp'] += v.amount; byDay[d].n++ }
  const months = [...new Set(Object.keys(byDay).map(d => d.slice(0, 7)))]; const pos = {}
  for (const mo of months) { const doc = await kvGet('sp_finance_pm_pos_d_' + mo); for (const [d, rec] of Object.entries((doc || {}).days || {})) pos[d] = Number((rec || {}).revenue ?? ((rec || {}).sum || {}).revenue ?? 0) || 0 }
  const rows = Object.keys(byDay).sort().reverse().map(d => ({ date: d, ...byDay[d], pos: pos[d] || 0, ratio: pos[d] ? Math.round((byDay[d].staff + byDay[d].inv) / pos[d] * 100) : null }))
  const staff = {}; for (const v of vis.filter(x => x.source === 'staff')) { (staff[v.by_name] = staff[v.by_name] || { n: 0, amount: 0 }); staff[v.by_name].n++; staff[v.by_name].amount += v.amount }
  const flags = []; const byM = {}; for (const v of vis) { (byM[v.member_id] = byM[v.member_id] || []).push(v) }
  for (const [mid, list] of Object.entries(byM)) { list.sort((a, b) => a.created_at < b.created_at ? -1 : 1); for (let i = 1; i < list.length; i++) if (new Date(list[i].created_at) - new Date(list[i - 1].created_at) < 10 * 60e3) flags.push({ kind: '10 分內兩筆', memberId: mid, at: list[i].created_at, by: list[i].by_name, amount: list[i].amount }) }
  for (const v of vis) if (v.amount > cfg.capSingle) flags.push({ kind: '超過單筆上限', memberId: v.member_id, at: v.created_at, by: v.by_name, amount: v.amount })
  const mids = [...new Set(flags.map(f => f.memberId))]; const ms = mids.length ? await sel('members', `id=in.(${mids.join(',')})&select=id,name,mno`) : []; const mm = {}; ms.forEach(m => { mm[m.id] = m })
  return { ok: true, days: rows, staff: Object.entries(staff).map(([name, x]) => ({ name, ...x })).sort((a, b) => b.amount - a.amount), flags: flags.slice(0, 50).map(f => ({ ...f, member: mm[f.memberId] || {} })) }
}

// ── 🪪 LINE Flex 卡片（v4.70.93 張良：會員資訊用卡片不要純文字）──
const RED = '#ce1611'
const flexBtn = (label, uri, style) => ({ type: 'button', style: style || 'primary', color: style === 'secondary' ? undefined : RED, height: 'sm', action: { type: 'uri', label, uri } })
const kv = (k, v, big) => ({ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: k, size: 'sm', color: '#8a7a70', flex: 3 }, { type: 'text', text: String(v), size: big ? 'xxl' : 'sm', weight: 'bold', color: big ? RED : '#2b1d18', align: 'end', flex: 5 }] })
export async function memberCardMessages (uid) {
  const url = memberLiffUrl(); const r = await byUid(uid); const m = r && r.member
  const tw = (iso) => { try { return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(new Date(iso)) } catch (_) { return '' } }
  if (!m) {
    return [{ type: 'flex', altText: '加入 GROUN:D 會員，消費累點', contents: { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'vertical', backgroundColor: RED, paddingAll: '14px', contents: [{ type: 'text', text: 'GROUN:D 會員', color: '#ffffff', weight: 'bold', size: 'lg' }, { type: 'text', text: '還沒加入會員', color: '#ffd9d6', size: 'xs' }] }, body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [{ type: 'text', text: '一鍵加入，會自動帶入你的 LINE 名字。消費出示會員卡就能累點，點數可以換餐點，還有轉盤活動。', wrap: true, size: 'sm', color: '#2b1d18' }] }, footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: [flexBtn('加入會員', url)] } } }]
  }
  const body = [kv('會員', m.name || '—'), kv('會員號碼', m.mno || '—'), { type: 'separator', margin: 'md' }, { type: 'box', layout: 'vertical', margin: 'md', contents: [kv('可用點數', m.balance, true)] }]
  if (m.lastVisit) body.push(kv('最近消費', `${tw(m.lastVisit.created_at)}・${m.lastVisit.amount} 元`))
  const card = { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'vertical', backgroundColor: RED, paddingAll: '14px', contents: [{ type: 'text', text: 'GROUN:D 會員卡', color: '#ffffff', weight: 'bold', size: 'lg' }, { type: 'text', text: 'MEMBER CARD', color: '#ffd9d6', size: 'xxs' }] }, body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: body }, footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: [flexBtn('開啟會員卡（出示 QR）', url), flexBtn('點數紀錄', url, 'secondary')] } }
  return [{ type: 'flex', altText: `${m.name || ''} 目前 ${m.balance} 點（會員號碼 ${m.mno}）`, contents: card }]
}
export async function welcomeMessages () {
  const cfg = await loadCfg(); const url = memberLiffUrl()
  const intro = String(cfg.welcomeText || DEF_CFG.welcomeText).replace(/\n?\{link\}/, '').trim()
  const card = { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'vertical', backgroundColor: RED, paddingAll: '14px', contents: [{ type: 'text', text: '歡迎加入 GROUN:D', color: '#ffffff', weight: 'bold', size: 'lg' }, { type: 'text', text: 'MEMBER', color: '#ffd9d6', size: 'xxs' }] }, body: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: [{ type: 'text', text: intro || '點下面開啟會員卡，消費出示會員號碼或 QR 就能累點。', wrap: true, size: 'sm', color: '#2b1d18' }] }, footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [flexBtn('開啟會員卡', url)] } }
  return [{ type: 'flex', altText: '歡迎加入 GROUN:D！點開會員卡開始累點', contents: card }]
}

// ── 第四批 v4.70.95：任務闖關／一層推薦／跨店結算／問卷 ──
const twDate = (iso) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10)
const twMonth = () => twDate(nowIso()).slice(0, 7)
function weekdayBonus (cfg) { const m = (cfg.missions || []).find(x => x.type === 'weekday_bonus' && x.active !== false); if (!m) return null; const dow = new Date(Date.now() + 8 * 3600e3).getUTCDay(); return (m.days || []).includes(dow) ? m : null }
async function award (mid, mission, period, store, note) { // 任務達成：一次性冪等；給點數或券
  const idem = `m:${mission.id}:${mid}:${period || ''}`
  const ex = await sel('member_missions_done', `idem_key=eq.${encodeURIComponent(idem)}&select=id`); if (ex.length) return null
  let couponId = null
  if (mission.coupon && mission.coupon.name) { try { const c = await ins('member_coupons', { brand: BRAND, member_id: mid, kind: 'mission', name: mission.coupon.name, value: mission.coupon.value || 0, status: 'issued', issue_key: idem, expires_at: new Date(Date.now() + 60 * 86400e3).toISOString(), note: mission.name }); couponId = c && c.id } catch (e) { if (e.status !== 409) throw e } }
  if (mission.pts > 0) { try { await ins('member_pts', { brand: BRAND, store: store || 'gd', member_id: mid, kind: 'mission', pts: mission.pts, idem_key: idem, note: '任務：' + mission.name }, 'return=minimal') } catch (e) { if (e.status !== 409) throw e } }
  try { await ins('member_missions_done', { member_id: mid, mission_id: mission.id, period: period || '', idem_key: idem, pts: mission.pts || 0, coupon_id: couponId, note: note || null }, 'return=minimal') } catch (e) { if (e.status !== 409) throw e }
  return { id: mission.id, name: mission.name, pts: mission.pts || 0, coupon: mission.coupon ? mission.coupon.name : null }
}
async function visitStats (mid) { const vis = await sel('member_visits', `member_id=eq.${mid}&order=created_at.asc&limit=2000&select=id,amount,store,created_at`); const mo = twMonth(); const thisMo = vis.filter(v => twDate(v.created_at).slice(0, 7) === mo); return { all: vis, n: vis.length, month: { n: thisMo.length, days: new Set(thisMo.map(v => twDate(v.created_at))).size, amount: thisMo.reduce((t, v) => t + v.amount, 0) } } }
async function referralDoneCount (mid) { return (await sel('member_referrals', `referrer_id=eq.${mid}&status=eq.done&select=id`)).length }
// 每次入點後：首購→推薦完成→本月次數／天數／金額→推薦里程碑
export async function afterVisit (mid, visit, store) {
  const cfg = await loadCfg(); const got = []; const vs = await visitStats(mid); const mo = twMonth()
  const ms = (cfg.missions || []).filter(x => x.active !== false)
  for (const m of ms) {
    let r = null
    if (m.type === 'first' && vs.n >= 1) r = await award(mid, m, '', store)
    else if (m.type === 'count_month' && vs.month.n >= m.n) r = await award(mid, m, mo, store)
    else if (m.type === 'days_month' && vs.month.days >= m.n) r = await award(mid, m, mo, store)
    else if (m.type === 'amount_month' && vs.month.amount >= m.n) r = await award(mid, m, mo, store)
    if (r) got.push(r)
  }
  // 推薦：我是被推薦人、這是我的第一筆消費 → 完成，雙方給點（推薦人每月上限）
  if (vs.n === 1 && cfg.referral.active !== false) {
    const rf = (await sel('member_referrals', `referee_id=eq.${mid}&status=eq.pending&select=*`))[0]
    if (rf) {
      const monthDone = (await sel('member_referrals', `referrer_id=eq.${rf.referrer_id}&status=eq.done&done_at=gte.${new Date(Date.now() - 30 * 86400e3).toISOString()}&select=id`)).length
      await upd('member_referrals', `id=eq.${rf.id}`, { status: 'done', first_visit_id: visit.id, done_at: nowIso() })
      if (cfg.referral.refereePts > 0) { try { await ins('member_pts', { brand: BRAND, store, member_id: mid, kind: 'referral', pts: cfg.referral.refereePts, idem_key: 'ref:' + rf.id + ':b', note: '朋友推薦禮' }, 'return=minimal') } catch (_) {} }
      if (cfg.referral.referrerPts > 0 && (!cfg.referral.monthlyCap || monthDone < cfg.referral.monthlyCap)) { try { await ins('member_pts', { brand: BRAND, store, member_id: rf.referrer_id, kind: 'referral', pts: cfg.referral.referrerPts, idem_key: 'ref:' + rf.id + ':a', note: '推薦朋友首購' }, 'return=minimal') } catch (_) {} }
      got.push({ id: 'referral', name: '朋友推薦禮', pts: cfg.referral.refereePts })
      const done = await referralDoneCount(rf.referrer_id)
      for (const m of ms.filter(x => x.type === 'referral_milestone' && done >= x.n)) await award(rf.referrer_id, m, 'n' + m.n, store)
    }
  }
  return got
}
export async function missionProgress (mid, cfg) {
  const vs = await visitStats(mid); const mo = twMonth(); const done = await sel('member_missions_done', `member_id=eq.${mid}&select=mission_id,period,created_at`); const refDone = await referralDoneCount(mid)
  const sv = (await sel('member_surveys', `member_id=eq.${mid}&order=created_at.desc&limit=1&select=created_at`))[0]
  const isDone = (m, period) => done.some(d => d.mission_id === m.id && d.period === (period || ''))
  return (cfg.missions || []).filter(x => x.active !== false).map(m => {
    let progress = 0, target = m.n || 1, period = '', doneFlag = false
    if (m.type === 'first') { progress = Math.min(1, vs.n); target = 1; doneFlag = isDone(m, '') }
    else if (m.type === 'count_month') { progress = vs.month.n; period = mo; doneFlag = isDone(m, mo) }
    else if (m.type === 'days_month') { progress = vs.month.days; period = mo; doneFlag = isDone(m, mo) }
    else if (m.type === 'amount_month') { progress = vs.month.amount; period = mo; doneFlag = isDone(m, mo) }
    else if (m.type === 'referral_milestone') { progress = refDone; doneFlag = isDone(m, 'n' + m.n) }
    else if (m.type === 'survey') { progress = sv && twDate(sv.created_at).slice(0, 7) === mo ? 1 : 0; target = 1; period = mo; doneFlag = isDone(m, mo) }
    else if (m.type === 'weekday_bonus') { progress = 0; target = 0 }
    return { id: m.id, type: m.type, name: m.name, desc: m.desc, progress: Math.min(progress, target || progress), target, done: doneFlag, reward: m.coupon ? m.coupon.name : (m.pts ? m.pts + ' 點' : ''), days: m.days, mult: m.mult }
  })
}
export async function referralInfo (mid, m, cfg) {
  const L = liffId(); const link = L ? `https://liff.line.me/${L}?to=member&ref=${m.mno}` : `https://ground-pm.vercel.app/member?ref=${m.mno}`
  const rows = await sel('member_referrals', `referrer_id=eq.${mid}&order=created_at.desc&limit=50&select=status,created_at,done_at,referee_id`)
  const ids = rows.map(r => r.referee_id); const ms = ids.length ? await sel('members', `id=in.(${ids.join(',')})&select=id,name`) : []; const nm = {}; ms.forEach(x => { nm[x.id] = x.name })
  return { code: m.mno, link, active: cfg.referral.active !== false, referrerPts: cfg.referral.referrerPts, refereePts: cfg.referral.refereePts, done: rows.filter(r => r.status === 'done').length, pending: rows.filter(r => r.status === 'pending').length, list: rows.slice(0, 20).map(r => ({ name: (nm[r.referee_id] || '朋友').slice(0, 1) + '＊＊', status: r.status, at: r.done_at || r.created_at })), referredBy: !!m.ref_by }
}
// ── 🎂 生日禮（v4.71.1）：生日當月每年一次；用任務的 award() 冪等（m:birthday:<會員>:<年>）──
const bdayMission = (cfg) => { const b = cfg.birthday || {}; return { id: 'birthday', name: '生日禮', pts: Number(b.pts) || 0, coupon: b.coupon && b.coupon.name ? { name: b.coupon.name, value: Number(b.coupon.value) || 0 } : null } }
async function birthdayStatus (mid, m, cfg) { const b = cfg.birthday || {}; if (b.active === false) return null; const year = twDate(nowIso()).slice(0, 4); const mo = twDate(nowIso()).slice(5, 7); const ms = bdayMission(cfg); const reward = ms.coupon ? ms.coupon.name : (ms.pts ? ms.pts + ' 點' : ''); if (!reward) return null
  const done = (await sel('member_missions_done', `member_id=eq.${mid}&mission_id=eq.birthday&period=eq.${year}&select=id`)).length > 0
  return { reward, hasBirthday: !!m.birthday, thisMonth: !!m.birthday && String(m.birthday).slice(5, 7) === mo, month: m.birthday ? Number(String(m.birthday).slice(5, 7)) : null, done } }
export async function birthdayRun ({ who } = {}) { // 每天 08:00（cron-daily）＋ GD 主管手動 op=bdayrun；只發「生日月＝本月」且今年還沒領的
  const cfg = await loadCfg(); const b = cfg.birthday || {}; if (b.active === false) return { ok: true, n: 0, skipped: '生日禮已關' }
  const ms = bdayMission(cfg); if (!ms.coupon && !ms.pts) return { ok: true, n: 0, skipped: '生日禮沒設獎勵' }
  const td = twDate(nowIso()); const year = td.slice(0, 4), mo = Number(td.slice(5, 7))
  const all = await sel('members', `brand=eq.${BRAND}&status=eq.active&birthday=not.is.null&select=id,name,mno,birthday&limit=5000`)
  const hits = all.filter(m => Number(String(m.birthday).slice(5, 7)) === mo)
  const got = []
  for (const m of hits) { try { const r = await award(m.id, ms, year, 'gd', (who && who.name ? who.name : '每日自動') + ' 生日禮'); if (r) got.push({ id: m.id, name: m.name, mno: m.mno }) } catch (_) {} }
  return { ok: true, n: got.length, candidates: hits.length, list: got, month: mo }
}
// 問卷：每月一次給點
export async function custSurvey ({ body }) {
  const uid = await custAuth(body); if (!uid) return { ok: false, error: '登入已過期' }
  const mid = await identityOf(uid); if (!mid) return { ok: false, needConsent: true }
  const score = Math.max(1, Math.min(5, Math.round(Number(body.score) || 0))); if (!score) return { ok: false, error: '請選分數' }
  const answers = {}; for (const k of ['food', 'service', 'speed', 'comment', 'dish']) if (body[k] != null) answers[k] = String(body[k]).slice(0, 300)
  const cfg = await loadCfg(); const store = cfg.stores && cfg.stores[body.store] ? body.store : 'gd'
  await ins('member_surveys', { member_id: mid, store, score, answers }, 'return=minimal')
  const m = (cfg.missions || []).find(x => x.type === 'survey' && x.active !== false); let got = null
  if (m) got = await award(mid, m, twMonth(), store, '問卷 ' + score + ' 分')
  return { ok: true, got, ...(await custMe({ body })) }
}
export async function surveysList ({ days }) { const since = new Date(Date.now() - (Number(days) || 30) * 86400e3).toISOString(); const rows = await sel('member_surveys', `created_at=gte.${since}&order=created_at.desc&limit=200`); const ids = [...new Set(rows.map(r => r.member_id))]; const ms = ids.length ? await sel('members', `id=in.(${ids.join(',')})&select=id,name,mno`) : []; const nm = {}; ms.forEach(x => { nm[x.id] = x }); return { ok: true, list: rows.map(r => ({ ...r, member: nm[r.member_id] || {} })), avg: rows.length ? Math.round(rows.reduce((t, r) => t + (r.score || 0), 0) / rows.length * 10) / 10 : null } }
// 跨店結算：某月各店「發出多少點／被用掉多少點＋券面值」；淨額＝用掉的價值－發出的價值（1 點＝pointValue 元）
export async function settlement ({ month }) {
  const cfg = await loadCfg(); const mo = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : twMonth()
  const from = new Date(mo + '-01T00:00:00+08:00').toISOString(), to = new Date(new Date(mo + '-01T00:00:00+08:00').setMonth(new Date(mo + '-01T00:00:00+08:00').getMonth() + 1)).toISOString()
  const [pts, cps] = await Promise.all([sel('member_pts', `created_at=gte.${from}&created_at=lt.${to}&select=store,kind,pts&limit=20000`), sel('member_coupons', `redeemed_at=gte.${from}&redeemed_at=lt.${to}&select=store,value,pts_cost,name&limit=5000`)])
  const S = {}; const g = (k) => (S[k] = S[k] || { name: (cfg.stores[k] || {}).name || k, issued: 0, spent: 0, couponValue: 0, coupons: 0 })
  for (const p of pts) { const k = p.store || 'gd'; if (p.pts > 0) g(k).issued += p.pts; else g(k).spent += -p.pts }
  for (const c of cps) { const k = c.store || 'gd'; g(k).coupons++; g(k).couponValue += Number(c.value) || 0 }
  const pv = cfg.pointValue || 1
  return { ok: true, month: mo, pointValue: pv, stores: Object.entries(S).map(([k, v]) => ({ key: k, ...v, issuedValue: Math.round(v.issued * pv), spentValue: Math.round(v.spent * pv), net: Math.round(v.spent * pv) - Math.round(v.issued * pv) })) }
}

// 會員系統暫停（張良 2026-10-16「會員跟自建點餐、綠界先不用，不要給客人看到會員系統跟連結；LINE 官方那六格也取消」）：
//   收件匣自動回（加好友歡迎、會員／點數、門市與客服、團訂卡片）全停；客人頁 /member、/order 轉暫停頁（vercel.json）；圖文選單用 richMenuOff 取消。恢復＝這裡改 false＋vercel.json 轉寫改回＋richMenuSetup
export const MEMBER_PAUSED = true
// 取消圖文選單（不刪選單本身，之後 richMenuSetup 可重掛）：取消「全部好友預設」＋已入會的人逐批解除連結
export async function richMenuOff ({ who }) {
  const token = await gdToken(); const cfg = await loadCfg()
  const d = await fetch('https://api.line.me/v2/bot/user/all/richmenu', { method: 'DELETE', headers: { authorization: 'Bearer ' + token } })
  const idn = await sel('member_identities', 'provider=eq.line&select=line_uid'); const uids = idn.map(i => i.line_uid).filter(Boolean); let unlinked = 0
  for (let i = 0; i < uids.length; i += 500) { const r = await fetch('https://api.line.me/v2/bot/richmenu/bulk/unlink', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ userIds: uids.slice(i, i + 500) }) }); if (r.ok || r.status === 202) unlinked += Math.min(500, uids.length - i) }
  const chk = await fetch('https://api.line.me/v2/bot/user/all/richmenu', { headers: { authorization: 'Bearer ' + token } }) // 讀回：沒有預設選單＝404
  const n = { ...cfg, richmenu: { ...(cfg.richmenu || {}), offAt: nowIso(), offBy: who && who.name, unlinked } }; await kvSet(CFG_KEY, n, '圖文選單取消(' + ((who && who.name) || '') + ')')
  return { ok: d.ok || d.status === 404, defaultCleared: chk.status === 404, unlinked, members: uids.length, delStatus: d.status }
}
// ── 🧭 圖文選單（v4.70.96）：六格兩版（會員／非會員），用 GROUN:D 官方帳號金鑰建；入會當下把那個人切到會員版 ──
const ORIGIN = 'https://ground-pm.vercel.app'
async function gdToken () { const IB = await import('./_inbox.js'); const a = IB.acctOf('gd'); const { token } = IB.creds(a); if (!token) throw new Error('GROUN:D 官方帳號金鑰未設'); return token }
async function lineJson (token, path, method, body, host) { const r = await fetch((host || 'https://api.line.me') + path, { method: method || 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let d = {}; try { d = await r.json() } catch (_) {} if (!r.ok) throw new Error(`LINE ${path} ${r.status}：${String(d.message || '').slice(0, 120)}`); return d }
function richMenuDef (kind, L) {
  const W = 2500, H = 1686, cw = Math.floor(W / 3), ch = Math.floor(H / 2)
  const u = (q) => ({ type: 'uri', uri: `https://liff.line.me/${L}?to=member${q ? '&' + q : ''}` })
  const cells = [kind === 'member' ? { ...u(''), label: '我的會員' } : { ...u(''), label: '加入會員' }, { ...u('tab=tasks'), label: '任務闖關' }, { ...u('tab=offers'), label: '優惠換好禮' }, { type: 'uri', uri: 'https://ground.oddle.me/zh_TW', label: '點餐菜單' }, { ...u('tab=friends'), label: '揪友賺點' }, { type: 'message', text: '門市與客服', label: '門市客服' }]
  return { size: { width: W, height: H }, selected: true, name: 'GD ' + kind + ' ' + Date.now().toString(36), chatBarText: kind === 'member' ? '會員卡・點餐' : '加入會員・點餐', areas: cells.map((a, i) => ({ bounds: { x: (i % 3) * cw, y: Math.floor(i / 3) * ch, width: cw, height: ch }, action: a })) }
}
export async function richMenuSetup ({ who }) {
  const L = liffId(); if (!L) return { ok: false, error: 'LIFF ID 未設' }
  const token = await gdToken(); const cfg = await loadCfg(); const ids = {}
  for (const kind of ['guest', 'member']) {
    const created = await lineJson(token, '/v2/bot/richmenu', 'POST', richMenuDef(kind, L)); const id = created.richMenuId
    const img = await fetch(`${ORIGIN}/ops/menu/richmenu-${kind}.png?r=${Date.now()}`); if (!img.ok) throw new Error('抓不到選單圖 ' + kind); const buf = Buffer.from(await img.arrayBuffer())
    const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'image/png' }, body: buf }); if (!up.ok) throw new Error('上傳選單圖失敗 ' + up.status)
    ids[kind] = id
  }
  await lineJson(token, `/v2/bot/user/all/richmenu/${ids.guest}`, 'POST') // 預設＝非會員版
  // 既有會員全部切到會員版（每 500 人一批）
  const idn = await sel('member_identities', 'provider=eq.line&select=line_uid'); const uids = idn.map(i => i.line_uid); let linked = 0
  for (let i = 0; i < uids.length; i += 500) { try { await lineJson(token, '/v2/bot/richmenu/bulk/link', 'POST', { richMenuId: ids.member, userIds: uids.slice(i, i + 500) }); linked += Math.min(500, uids.length - i) } catch (_) {} }
  // 舊的選單刪掉（留這次兩個）
  try { const old = ((cfg.richmenu || {}).ids) || {}; for (const k of Object.keys(old)) if (!Object.values(ids).includes(old[k])) await lineJson(token, `/v2/bot/richmenu/${old[k]}`, 'DELETE').catch(() => {}) } catch (_) {}
  const n = { ...cfg, richmenu: { ids, at: nowIso(), by: who && who.name, linked } }; await kvSet(CFG_KEY, n, '圖文選單(' + ((who && who.name) || '') + ')')
  return { ok: true, ids, linked, members: uids.length }
}
export async function richMenuLinkMember (uid) { try { const cfg = await loadCfg(); const id = ((cfg.richmenu || {}).ids || {}).member; if (!id || !uid) return; const token = await gdToken(); await lineJson(token, `/v2/bot/user/${uid}/richmenu/${id}`, 'POST') } catch (_) {} }
// 門市與客服卡片／團體訂餐卡片（圖文選單第 6 格與「我要團體訂餐」）
export async function storeCardMessages () {
  const cfg = await loadCfg(); const url = memberLiffUrl()
  const rows = []
  if (cfg.hours) rows.push(kv('營業時間', cfg.hours)); if (cfg.address) rows.push(kv('地址', cfg.address)); if (cfg.phone) rows.push(kv('電話', cfg.phone))
  const btns = []
  if (cfg.mapUrl) btns.push(flexBtn('地圖導航', cfg.mapUrl, 'secondary')); if (cfg.phone) btns.push({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: '撥打電話', uri: 'tel:' + cfg.phone.replace(/\D/g, '') } })
  btns.push({ type: 'button', style: 'primary', color: RED, height: 'sm', action: { type: 'message', label: '我要團體訂餐', text: '我要團體訂餐' } })
  const social = [cfg.igUrl ? { type: 'text', text: 'Instagram', size: 'sm', color: '#2049c9', action: { type: 'uri', uri: cfg.igUrl }, flex: 1, align: 'center' } : null, cfg.fbUrl ? { type: 'text', text: 'Facebook', size: 'sm', color: '#2049c9', action: { type: 'uri', uri: cfg.fbUrl }, flex: 1, align: 'center' } : null].filter(Boolean)
  const body = [...rows, { type: 'separator', margin: 'md' }, { type: 'text', text: '預訂餐點請提前一天留言，小編上班時間內回覆；臨時當天的請直接來電。', wrap: true, size: 'xs', color: '#8a7a70', margin: 'md' }]
  if (social.length) body.push({ type: 'box', layout: 'horizontal', margin: 'md', contents: social })
  return [{ type: 'flex', altText: 'GROUN:D 門市與客服', contents: { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'vertical', backgroundColor: RED, paddingAll: '14px', contents: [{ type: 'text', text: 'GROUN:D 門市與客服', color: '#ffffff', weight: 'bold', size: 'lg' }, { type: 'text', text: '直接留言就是找小編', color: '#ffd9d6', size: 'xxs' }] }, body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: body }, footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: btns.slice(0, 3) } } }]
}
export async function grporderCardMessages () {
  return [{ type: 'flex', altText: '團體訂餐怎麼訂', contents: { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'vertical', backgroundColor: RED, paddingAll: '14px', contents: [{ type: 'text', text: '團體訂餐', color: '#ffffff', weight: 'bold', size: 'lg' }, { type: 'text', text: '部門聚餐・大量外帶', color: '#ffd9d6', size: 'xxs' }] }, body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '14px', contents: [
    { type: 'text', text: '① 在這裡留言：日期、人數、取餐方式', wrap: true, size: 'sm' }, { type: 'text', text: '② 小編傳你一條點餐連結，丟到群組每個人自己點', wrap: true, size: 'sm' }, { type: 'text', text: '③ 我們核價後傳計價表，確認就完成；用 LINE 登入點餐的人自動累點', wrap: true, size: 'sm' },
    { type: 'text', text: '已收到你的需求，小編上班時間內回覆。', wrap: true, size: 'xs', color: '#8a7a70', margin: 'md' }] } } }]
}
