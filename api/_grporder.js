// 🧾 團體訂餐（官方帳號客人直用的點餐計算機）後端｜v4.70.78 批次 1（規格 docs/GROUP_ORDER_SPEC.md，張良 2026-10-12「照這版開工做批次 1」）
// 流程：收件匣對話「建立點餐單」→ 發連結 ground-pm.vercel.app/order/<8碼> → 客人自填（或貼整段文字 AI 拆列）→ 送出 → GD「團體訂餐」核價 → 鎖單（價格快照）
// 資料：pm_grpord_<id> 一單一檔／pm_grpord_idx 索引（列表用）／pm_grpord_cfg 設定（搬運規則、通知誰、連結到期）；菜單**不另存**，每次即時讀 sp_finance_pm_menu.draft
// 計價只有一支：public/ops/js/grporder-calc.js（三邊共用）
import crypto from 'crypto'
import { SB_URL, SB_KEY, linePush } from './_onboard.js'
import * as C from '../public/ops/js/grporder-calc.js'

const H = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' })
const nowIso = () => new Date().toISOString()
const twNow = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
async function kvGet (id) {
  if (!SB_URL || !SB_KEY) return null
  try { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}&select=data`, { headers: H() }); const rows = r.ok ? await r.json() : []; return rows[0] && rows[0].data && rows[0].data.v ? JSON.parse(rows[0].data.v) : null } catch (_) { return null }
}
async function kvSet (id, obj, editor) {
  await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: editor || '團體訂餐', updated_at: nowIso() }) })
}
const KEY = id => 'pm_grpord_' + id
const IDX = 'pm_grpord_idx', CFG = 'pm_grpord_cfg'
export const GO_VER = '4778'
const DEF_CFG = { carry: { bag: 6, cup: 6, pz: 2, hand: 3 }, notify: { people: [] }, expireDays: 14, linkTpl: '您好，這是{company}的團體訂餐連結，大家可以自己填或由一人代填，填好按「送出給店家」我們就核價：\n{link}\n取餐：{when}（{mode}）' }
export async function loadCfg () { const c = (await kvGet(CFG)) || {}; return { ...DEF_CFG, ...c, carry: { ...DEF_CFG.carry, ...(c.carry || {}) }, notify: { ...DEF_CFG.notify, ...(c.notify || {}) } } }
export async function saveCfg (patch, who) { const c = await loadCfg(); const n = { ...c, ...(patch || {}), carry: { ...c.carry, ...((patch || {}).carry || {}) }, notify: { ...c.notify, ...((patch || {}).notify || {}) }, by: who && who.name, at: nowIso() }; await kvSet(CFG, n, '團體訂餐設定(' + ((who && who.name) || '') + ')'); return { ok: true, cfg: n } }
export async function loadMenu () { return C.normMenu(await kvGet('sp_finance_pm_menu')) }

// ── 索引 ──
async function idxPut (o) {
  const d = (await kvGet(IDX)) || { list: [] }
  const row = { id: o.id, acct: o.acct, convId: o.convId, custName: o.custName, company: o.company, when: o.when, status: o.status, n: (o.rows || []).length, total: o.totalCache || 0, assignee: o.assignee || '', updatedAt: o.updatedAt, createdAt: o.createdAt }
  d.list = [row, ...(d.list || []).filter(x => x.id !== o.id)].slice(0, 500)
  await kvSet(IDX, d, '團體訂餐索引')
}
export async function listOrders () { const d = (await kvGet(IDX)) || { list: [] }; return (d.list || []).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))) }
export async function getOrder (id) { if (!/^[a-z0-9]{6,12}$/i.test(String(id || ''))) return null; return kvGet(KEY(String(id).toLowerCase())) }
async function putOrder (o, editor) { o.updatedAt = nowIso(); const menu = await loadMenu(); o.totalCache = C.totals(menu, o).total; await kvSet(KEY(o.id), o, editor || '團體訂餐'); await idxPut(o) }
const log = (o, by, what) => { o.edits = [{ t: nowIso(), by: String(by || '').slice(0, 30), what: String(what || '').slice(0, 120) }, ...(o.edits || [])].slice(0, 80) }
const ORIGIN = 'https://ground-pm.vercel.app'
export const linkOf = (id) => `${ORIGIN}/order/${id}`

// ── 建單（從收件匣對話）──
export async function createOrder ({ who, acct, convId, custName, company, taxId, when, mode, contact, phone, uid, deadline }) {
  let id = ''; for (let i = 0; i < 5; i++) { id = Math.random().toString(36).slice(2, 10); if (!(await kvGet(KEY(id)))) break }
  const o = { id, acct: String(acct || 'gd'), convId: String(convId || ''), uid: String(uid || ''), custName: String(custName || '').slice(0, 40), company: String(company || custName || '').slice(0, 60), taxId: String(taxId || '').replace(/\D/g, '').slice(0, 8), when: String(when || '').slice(0, 16), mode: String(mode || '外帶自取').slice(0, 10), deadline: String(deadline || '').slice(0, 16), contact: String(contact || custName || '').slice(0, 30), phone: String(phone || '').slice(0, 20),
    rows: [], shared: [], disc: '', dep: 0, pay: { status: '未付', method: '現場', amount: 0 }, status: 'draft', frozen: false, assignee: who.name, createdBy: who.name, createdAt: nowIso(), edits: [] }
  log(o, who.name, '建單')
  await putOrder(o, '團體訂餐建單(' + who.name + ')')
  return { ok: true, id, link: linkOf(id), order: o }
}
// ── 店家存（基本資料／餐點／金額）──
const EDITABLE_STAFF = ['draft', 'sent', 'submitted', 'priced', 'confirmed']
export async function saveOrder ({ who, id, patch }) {
  const o = await getOrder(id); if (!o) return { ok: false, error: '找不到這張單' }
  if (!EDITABLE_STAFF.includes(o.status)) return { ok: false, error: '這張單已' + (C.STATUS_LABEL[o.status] || o.status) + '，要改請先解鎖' }
  const menu = await loadMenu(); patch = patch || {}
  const chg = []
  for (const k of ['company', 'taxId', 'when', 'deadline', 'mode', 'contact', 'phone', 'custName', 'note', 'assignee']) if (patch[k] != null) { const v = String(patch[k]).slice(0, k === 'note' ? 400 : 60); if (v !== (o[k] || '')) { o[k] = k === 'taxId' ? v.replace(/\D/g, '').slice(0, 8) : v; chg.push(k) } }
  if (patch.rows || patch.shared) { const cl = C.cleanOrderBody(menu, { rows: patch.rows || o.rows, shared: patch.shared || o.shared }); o.rows = cl.rows; o.shared = cl.shared; chg.push('餐點') }
  if (patch.disc != null) { o.disc = String(patch.disc).slice(0, 10); chg.push('折扣') }
  if (patch.dep != null) { o.dep = Math.max(0, Number(patch.dep) || 0); chg.push('訂金') }
  if (patch.pay) { o.pay = { ...(o.pay || {}), status: String(patch.pay.status || o.pay.status).slice(0, 10), method: String(patch.pay.method || o.pay.method).slice(0, 10), amount: Number(patch.pay.amount) || (o.pay.amount || 0) }; chg.push('付款') }
  if (!chg.length) return { ok: true, order: o }
  log(o, who.name, '改 ' + chg.join('、'))
  await putOrder(o, '團體訂餐(' + who.name + ')')
  return { ok: true, order: o, totals: C.totals(menu, o) }
}
// ── 狀態 ──
export async function setStatus ({ who, id, status }) {
  const o = await getOrder(id); if (!o) return { ok: false, error: '找不到這張單' }
  const menu = await loadMenu()
  const t = C.totals(menu, o)
  if (status === 'priced') { if (!['submitted', 'draft', 'sent', 'confirmed'].includes(o.status)) return { ok: false, error: '目前狀態不能標核價' }; if (t.pend || t.missing) return { ok: false, error: `還有 ${t.pend + t.missing} 項待確認／已下架，先換成最新菜單的品項` }; o.status = 'priced'; o.pricedAt = nowIso() }
  else if (status === 'locked') {
    if (['locked', 'done', 'void'].includes(o.status)) return { ok: false, error: '已經鎖了' }
    if (t.pend || t.missing) return { ok: false, error: `還有 ${t.pend + t.missing} 項待確認／已下架，不能鎖單` }
    // 價格快照：鎖單那一刻把每個品項的價存進單內，之後菜單改價不影響這張單（規格 §4）
    const snap = pk => { if (pk && pk.id) { const it = C.itemOf(menu, pk.id); if (it) pk.p = it.price } }
    for (const r of o.rows) for (const l of (r.lines || [])) { snap(l); snap(l.side); snap(l.drink) }
    (o.shared || []).forEach(snap)
    o.priceAt = { setN: menu.setN, sideOff: menu.sideOff, drinkOff: menu.drinkOff, at: nowIso() }
    o.frozen = true; o.status = 'locked'; o.lockedAt = nowIso(); o.lockedTotal = t.total
  }
  else if (status === 'unlock') { if (!['locked', 'done'].includes(o.status)) return { ok: false, error: '沒有鎖著' }; o.frozen = false; o.status = 'priced' }
  else if (status === 'done') { if (o.status !== 'locked') return { ok: false, error: '先鎖單再標完成' }; o.status = 'done'; o.doneAt = nowIso() }
  else if (status === 'void') { o.status = 'void'; o.voidAt = nowIso() }
  else if (status === 'reopen') { if (o.status !== 'void') return { ok: false, error: '只有作廢的單能復原' }; o.status = (o.rows || []).length ? 'submitted' : 'draft' }
  else return { ok: false, error: '不認識的狀態' }
  log(o, who.name, C.STATUS_LABEL[o.status] || status)
  await putOrder(o, '團體訂餐(' + who.name + ')')
  return { ok: true, order: o, totals: C.totals(menu, o) }
}
// ── 發連結給客人（走收件匣 sendOut：50 秒內 reply 免費，否則 push）──
export async function sendLink ({ who, mgr, cfgIB, IB, id }) {
  const o = await getOrder(id); if (!o) return { ok: false, error: '找不到這張單' }
  if (!o.convId) return { ok: false, error: '這張單沒綁收件匣對話' }
  const cfg = await loadCfg()
  const text = String(cfg.linkTpl || DEF_CFG.linkTpl).replace('{company}', o.company || o.custName || '您').replace('{link}', linkOf(o.id)).replace('{when}', o.when || '待定').replace('{mode}', o.mode || '')
  const r = await IB.sendOut({ who, mgr, cfg: cfgIB, id: o.convId, text })
  if (!r.ok) return r
  if (o.status === 'draft') o.status = 'sent'
  o.sentAt = nowIso(); log(o, who.name, '發連結給客人（' + r.mode + '）')
  await putOrder(o, '團體訂餐(' + who.name + ')')
  return { ok: true, order: o, mode: r.mode }
}
// ── 客人頁（公開：只認連結碼）──
const deadlinePassed = (o) => !!(o.deadline && (Date.now() + 8 * 3600e3) > new Date(o.deadline.replace(' ', 'T') + ':00Z').getTime()) // deadline 存台灣時間字串
export function publicView (o, menu, cfg) {
  const t = C.totals(menu, o)
  const expired = cfg && cfg.expireDays && o.createdAt && (Date.now() - new Date(o.createdAt).getTime()) > cfg.expireDays * 86400e3 && !['locked', 'done'].includes(o.status)
  return { ok: true, id: o.id, company: o.company, custName: o.custName, taxId: o.taxId, when: o.when, deadline: o.deadline || '', closed: deadlinePassed(o), mode: o.mode, contact: o.contact, rows: o.rows, shared: o.shared, disc: o.disc, dep: o.dep, status: o.status, frozen: !!o.frozen, priceAt: o.priceAt || null, editable: C.CUST_EDITABLE.includes(o.status) && !expired, expired: !!expired, liff: (process.env.LIFF_ID || '').trim() || null, totals: t, carry: C.carry(menu, o, cfg && cfg.carry), submittedAt: o.submittedAt || null, confirmedAt: o.confirmedAt || null, imgs: o.imgs || null, custSavedAt: o.custSavedAt || null }
}
export async function custSave ({ code, body }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單，請跟店家確認連結' }
  const cfg = await loadCfg()
  if (!C.CUST_EDITABLE.includes(o.status)) return { ok: false, error: '這張單已經' + (C.STATUS_LABEL[o.status] || '鎖定') + '，要改請聯絡店家' }
  const menu = await loadMenu()
  const cl = C.cleanOrderBody(menu, body || {})
  o.rows = cl.rows; o.shared = cl.shared
  if (body && body.contact != null) o.contact = String(body.contact).slice(0, 30)
  if (body && body.phone != null) o.phone = String(body.phone).slice(0, 20)
  o.custSavedAt = nowIso()
  if (o.status === 'priced') { o.status = 'submitted'; log(o, '客人', '核價後又改了餐點 → 退回待核價') }
  await putOrder(o, '團體訂餐(客人)')
  return publicView(o, menu, cfg)
}
export async function custSubmit ({ code }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  if (!C.CUST_EDITABLE.includes(o.status)) return { ok: false, error: '這張單已經' + (C.STATUS_LABEL[o.status] || '鎖定') }
  if (!(o.rows || []).length && !(o.shared || []).length) return { ok: false, error: '還沒有任何餐點' }
  const menu = await loadMenu(); const cfg = await loadCfg()
  o.status = 'submitted'; o.submittedAt = nowIso(); log(o, '客人', '送出')
  await putOrder(o, '團體訂餐(客人送出)')
  const t = C.totals(menu, o)
  notifyStaff(o, { title: '團體訂餐：客人送出了', body: `${o.company || o.custName}｜${(o.rows || []).length} 人${(o.shared || []).length ? '＋共用 ' + o.shared.length + ' 項' : ''}｜暫計 ${t.total.toLocaleString()}${t.pend ? '（' + t.pend + ' 項待確認）' : ''}｜取餐 ${o.when || '待定'}` }).catch(() => {})
  return publicView(o, menu, cfg)
}
export async function custConfirm ({ code }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  if (o.status !== 'priced') return { ok: false, error: '店家還沒核價完成，核價後才能確認' }
  const menu = await loadMenu(); const cfg = await loadCfg()
  o.status = 'confirmed'; o.confirmedAt = nowIso(); log(o, '客人', '確認無誤')
  await putOrder(o, '團體訂餐(客人確認)')
  const t = C.totals(menu, o)
  notifyStaff(o, { title: '團體訂餐：客人確認了', body: `${o.company || o.custName}｜全單 ${t.total.toLocaleString()}｜取餐 ${o.when || '待定'}｜可以鎖單了` }).catch(() => {})
  return publicView(o, menu, cfg)
}
// ── 通知店家（通知鐵則：鈴鐺＋推播，關鍵節點加 LINE 私訊）：設定「通知誰」有填就通知那些人，沒填＝這張單負責人＋收件匣有權限的人＋審核人 ──
async function notifyStaff (o, msg) {
  const cfg = await loadCfg()
  const IB = await import('./_inbox.js')
  const base = await IB.permRids(o.acct || 'gd')
  const names = new Set([...((cfg.notify.people || []).length ? cfg.notify.people : base.names), ...(o.assignee ? [o.assignee] : [])])
  const bind = (await kvGet('sp_finance_pm_prep_bind')) || {}
  const rids = new Set()
  for (const v of Object.values(bind.tokens || {})) if (v && names.has(v.name)) { if (v.rid) rids.add(String(v.rid)); if (v.uid) rids.add(String(v.uid)) }
  const url = '/prep#tab=gorder&id=' + o.id
  try { if (rids.size) { const { wpPush } = await import('./_webpush.js'); await wpPush([...rids], { title: msg.title, body: msg.body.slice(0, 160), url, cat: 'inbox' }) } } catch (_) {}
  try { const ros = await kvGet('sp_crew_kb_roster'); for (const an of names) { const p = ((ros || {}).people || []).find(x => x.name === an && x.lineUserId); if (p) await linePush(p.lineUserId, `🧾 ${msg.title}\n${msg.body}\n→ ${ORIGIN}${url}`) } } catch (_) {}
}
// ── AI 拆文字（路由 grporder；只認最新菜單；對不到的放 pend 給人點選）──
export async function parseText ({ text }) {
  text = String(text || '').trim().slice(0, 6000); if (!text) return { ok: false, error: '沒有內容' }
  const menu = await loadMenu()
  const list = C.flatItems(menu).filter(i => !i.soon).map(i => `${i.id}｜${i.name}｜${{ main: '主餐', snack: '副餐', drink: '飲品', pizza: '披薩' }[i.kind]}｜${i.price}`).join('\n')
  const SYS = `你是 GROUN:D 餐廳的團體訂餐助理。把客人貼的訂餐文字拆成「每人一列」，品項只能對到下面最新菜單的 id；對不到的（舊品項、菜單沒有的）放進 pend 保留原文，不要硬湊。
最新菜單（id｜品名｜類別｜價格）：
${list}
套餐規則：主餐 +${menu.setN} 升級套餐＝副餐選 1（副餐類）＋飲品選 1（飲品類）。文字有「套餐」或「主餐＋副餐＋飲品」都算 combo=true；只有主餐沒副餐飲品＝false。
分配規則：一人一列（「姓名：內容」或「姓名 : 內容」）；main=主餐類的一項（沒有主餐但有「炸雞／脆雞 x2」可當 main、q=2）；side=第一個副餐類（q=1）；drink=第一個飲品類；其餘全放 extras；披薩類不分人，放 shared（「四個口味各一個」＝四種披薩各 1）。
note 放口味／冰糖：如「去冰／無糖」「微冰」「冰」「熱」「原味」「川味」「飯」「沙拉」「ZERO」。數量寫在 q（x2＝2）。
開頭的日期時間行、問候、統編、問搬運的句子都略過（不要變成人）。
只輸出 JSON，格式：{"rows":[{"name":"","main":{"id":"","q":1,"note":""},"side":{"id":"","q":1,"note":""}|null,"drink":{"id":"","q":1,"note":""}|null,"extras":[{"id":"","q":1,"note":""}],"combo":true,"pend":[{"text":"原文","q":1,"note":""}]}],"shared":[{"id":"","q":1}]}`
  const { aiCall } = await import('./_ai.js')
  const r = await aiCall('grporder', { system: SYS, messages: [{ role: 'user', content: text }], maxTokens: 6000, effort: 'low', timeoutMs: 90000 })
  let parsed = null
  try { const t = String(r.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''); parsed = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) } catch (_) { return { ok: false, error: 'AI 讀出來的不是可用格式，請把文字整理成「姓名：餐點」一行一人再試' } }
  const rows = (Array.isArray(parsed.rows) ? parsed.rows : []).slice(0, 150).map(x => C.fromLegacyRow(menu, x || {}))
  const shared = (Array.isArray(parsed.shared) ? parsed.shared : []).map(x => C.cleanPick(menu, { q: 1, ...(x || {}) })).filter(Boolean).slice(0, 30)
  return { ok: true, rows, shared, model: r.model, provider: r.provider }
}

// ── 每人自己點（1b，像 UberEats）：身分＝LINE（LIFF access token 伺服器驗）或手打名字（匿名 id 存在客人瀏覽器）──
const PT_SECRET = () => (SB_KEY || 'go') + '|grporder'
const ptOf = (uid) => crypto.createHmac('sha256', PT_SECRET()).update(String(uid)).digest('hex').slice(0, 24)
export async function custWho ({ code, at }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  at = String(at || ''); if (!at) return { ok: false, error: '缺 LINE 登入資料' }
  try {
    const vr = await (await fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(at))).json()
    if (!vr || !vr.client_id || vr.expires_in <= 0) return { ok: false, error: 'LINE 登入過期，請重新開連結' }
    const pf = await (await fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + at } })).json()
    if (!pf || !pf.userId) return { ok: false, error: '拿不到 LINE 身分' }
    return { ok: true, uid: pf.userId, name: String(pf.displayName || '').slice(0, 30), pic: String(pf.pictureUrl || '').slice(0, 300), pt: ptOf(pf.userId) }
  } catch (_) { return { ok: false, error: 'LINE 驗證失敗，請再試一次' } }
}
// 存「我這一份」：LINE 身分要帶 pt（伺服器簽的）；匿名用 anon id（≥8 碼）；只能動自己那列
export async function custMine ({ code, body }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單，請跟店家確認連結' }
  const cfg = await loadCfg(); const menu = await loadMenu()
  if (!C.CUST_EDITABLE.includes(o.status)) return { ok: false, error: '這張單已經' + (C.STATUS_LABEL[o.status] || '鎖定') + '，要改請聯絡店家' }
  if (deadlinePassed(o) && !body.force) return { ok: false, error: '已經過截單時間（' + o.deadline + '），要加點請聯絡主辦人或店家', closed: true }
  let uid = '', src = 'manual'
  if (body.uid && body.pt) { if (ptOf(body.uid) !== String(body.pt)) return { ok: false, error: '身分驗證不符，請重新開連結' }; uid = String(body.uid); src = 'line' }
  else if (body.anon && /^[a-z0-9]{8,40}$/i.test(String(body.anon))) uid = 'anon:' + body.anon
  else return { ok: false, error: '缺身分' }
  const name = String(body.name || '').trim().slice(0, 30); if (!name) return { ok: false, error: '請填名字' }
  const row = C.cleanRow(menu, { ...(o.rows.find(r => r.uid === uid) || {}), uid, src, name, pic: body.pic || (o.rows.find(r => r.uid === uid) || {}).pic || '', lines: body.lines || [], pend: body.pend || [], done: !!body.done, at: nowIso() })
  const i = o.rows.findIndex(r => r.uid === uid)
  if (!row.lines.length && !row.pend.length && body.remove) { if (i >= 0) o.rows.splice(i, 1) } else if (i >= 0) o.rows[i] = row; else o.rows.push(row)
  o.custSavedAt = nowIso()
  if (o.status === 'priced') { o.status = 'submitted'; log(o, name, '核價後又改了餐點 → 退回待核價') }
  await putOrder(o, '團體訂餐(' + name + ')')
  return { ...publicView(o, menu, cfg), mine: row }
}
