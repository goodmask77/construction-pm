// 🧾 團體訂餐（官方帳號客人直用的點餐計算機）後端｜v4.70.78 批次 1（規格 docs/GROUP_ORDER_SPEC.md，張良 2026-10-12「照這版開工做批次 1」）
// 流程：收件匣對話「建立點餐單」→ 發連結 ground-pm.vercel.app/order/<8碼> → 客人自填（或貼整段文字 AI 拆列）→ 送出 → GD「團體訂餐」核價 → 鎖單（價格快照）
// 資料：pm_grpord_<id> 一單一檔／pm_grpord_idx 索引（列表用）／pm_grpord_cfg 設定（搬運規則、通知誰、連結到期）；菜單**不另存**，每次即時讀 sp_finance_pm_menu.draft
// 計價只有一支：public/ops/js/grporder-calc.js（三邊共用）
import crypto from 'crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { abgdKv } from './_abgdkv.js'
import { SB_URL, SB_KEY, linePush, uploadPrivate, signedUrl } from './_onboard.js'
import * as C from '../public/ops/js/grporder-calc.js'

const H = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' })
const nowIso = () => new Date().toISOString()
const twNow = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
// ── 讀寫層（v4.71.132 abgd 搬家 B 模式）：團體訂餐自己的文件 pm_grpord_* 依資料歸屬走 GD 或新殼，一律版本比對寫（撞版本＝丟 stale）；
//   其他資料（菜單、綁定、名冊）照舊從 GD 唯讀。每個對外入口包 goRun：撞版本整段重做（重做前沒有任何對外動作）；
//   有對外動作（發 LINE、開發票、LINE Pay、上傳）的函式，動作之後的寫入一律走 commit（重讀最新、只套這次變更、只重做寫入這一步）
async function gdRead (id) {
  if (!SB_URL || !SB_KEY) return null
  try { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}&select=data`, { headers: H() }); const rows = r.ok ? await r.json() : []; return rows[0] && rows[0].data && rows[0].data.v ? JSON.parse(rows[0].data.v) : null } catch (_) { return null }
}
const _als = new AsyncLocalStorage()
const isGo = (k) => String(k).startsWith('pm_grpord_')
const newKv = (op) => abgdKv({ domain: 'grporder', lockKey: 'pm_grpord_', operator: String(op || '團體訂餐').slice(0, 30), label: '團體訂餐', versioned: true })
async function goKv () { const st = _als.getStore(); if (st && st.kv) return st.kv; const kv = await newKv(st && st.op); if (st) st.kv = kv; return kv }
async function kvGet (id) { if (!isGo(id)) return gdRead(id); return (await goKv()).kvGet(id) } // 讀失敗會丟錯（不當成「沒有」，免得讀改寫拿空資料蓋掉）
async function kvSet (id, obj, editor) { if (!isGo(id)) throw new Error('團體訂餐只寫自己的文件：' + id); return (await goKv()).kvPut(id, obj, editor || '團體訂餐') }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// 對外動作前先問切換驗收閘門（動作做了卻存不進去＝最糟；GD 正本＝放行、切換中＝擋、新殼正本＝看閘門）
async function goGate () { const st = _als.getStore(); const kv = await newKv(st && st.op); if (kv.mode === 'gd') return null; if (kv.mode !== 'abgd') return '團體訂餐正在切換，請稍後再試'; return kv.gate() }
const gateOut = (g) => ({ ok: false, error: g, code: 'smoke' })
const isStale = (e) => !!(e && e.code === 'stale')
// 入口包裝：同一次請求共用一個讀寫物件（版本號只在這次有效）；撞版本整段重做最多 5 次
function goRun (fn, opOf) { return async (...a) => { for (let i = 0; ; i++) { try { return await _als.run({ op: String((opOf && opOf(...a)) || '團體訂餐').slice(0, 30), kv: null }, () => fn(...a)) } catch (e) { if (i >= 4 || !isStale(e)) throw e; await sleep(150 + Math.random() * 400) } } } }
// 對外動作之後的寫入：每次新開讀寫物件重讀最新 → mut(o)（回 false＝不用寫）→ 版本比對寫；撞版本只重做這一步，最後仍失敗丟 commitfail（不是 stale，外層不會整段重做）
async function commit (id, mut, editor) {
  const st = _als.getStore()
  for (let i = 0; i < 6; i++) {
    const kv = await newKv(st && st.op)
    const o = await kv.kvGet(KEY(id)); if (!o) { const e = new Error('找不到這張單'); e.code = 'gone'; throw e }
    if (mut(o) === false) return o
    try { await putOrderKv(kv, o, editor); return o } catch (e) { if (!isStale(e)) throw e; await sleep(100 + Math.random() * 300) }
  }
  const e = new Error('有人同時在改這張單，這次的結果沒存進去，請重新整理後再確認'); e.code = 'commitfail'; throw e
}
const KEY = id => 'pm_grpord_' + id
const IDX = 'pm_grpord_idx', CFG = 'pm_grpord_cfg'
export const GO_VER = '4813'
// v4.71.3 ecpay.test＝沒 env 時用綠界測試商家；choose＝ALL/Credit/ATM/CVS；invoice.auto＝付款成功自動開發票
const DEF_CFG = { ecpay: { test: false, choose: 'ALL' }, invoice: { auto: true, test: false }, carry: { bag: 6, cup: 6, pz: 2, hand: 3 }, notify: { people: [] }, expireDays: 14, linkTpl: '您好，這是{company}的團體訂餐連結，大家可以自己填或由一人代填，填好按「送出給店家」我們就核價：\n{link}\n取餐：{when}（{mode}）' }
export async function loadCfg () { const c = (await kvGet(CFG)) || {}; return { ...DEF_CFG, ...c, carry: { ...DEF_CFG.carry, ...(c.carry || {}) }, notify: { ...DEF_CFG.notify, ...(c.notify || {}) } } }
async function _saveCfg (patch, who) { const c = await loadCfg(); const n = { ...c, ...(patch || {}), carry: { ...c.carry, ...((patch || {}).carry || {}) }, notify: { ...c.notify, ...((patch || {}).notify || {}) }, by: who && who.name, at: nowIso() }; await kvSet(CFG, n, '團體訂餐設定(' + ((who && who.name) || '') + ')'); return { ok: true, cfg: n } }
export async function loadMenu () { return C.normMenu(await kvGet('sp_finance_pm_menu')) }

// ── 索引 ──
async function idxPut (kv, o) { // 索引是列表用的衍生資料：撞版本自己重讀重試；最後仍失敗只記錄、不丟錯（單子本身已存好，不能讓外層整段重做）
  const row = { id: o.id, acct: o.acct, convId: o.convId, custName: o.custName, company: o.company, when: o.when, status: o.status, n: (o.rows || []).length, total: o.totalCache || 0, assignee: o.assignee || '', updatedAt: o.updatedAt, createdAt: o.createdAt, demo: !!o.demo }
  for (let i = 0; i < 6; i++) {
    try { // 讀、改、寫整段包住：任何失敗都不往外丟（關卡 3 第一輪 OpenAI A：讀索引失敗也不能讓已存好的單子被當成失敗）
      const d = (await kv.kvGet(IDX)) || { list: [] }
      d.list = [row, ...(d.list || []).filter(x => x.id !== o.id)].slice(0, 500)
      await kv.kvPut(IDX, d, '團體訂餐索引'); return
    } catch (e) { if (!isStale(e)) { console.error('[grporder] 索引存不進去', o.id, String(e && e.message || e).slice(0, 120)); return } await sleep(100 + Math.random() * 300) }
  }
  console.error('[grporder] 索引一直撞版本，這次沒更新', o.id)
}
export async function listOrders () { const d = (await kvGet(IDX)) || { list: [] }; return (d.list || []).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))) }
export async function getOrder (id) { if (!/^[a-z0-9]{6,12}$/i.test(String(id || ''))) return null; return kvGet(KEY(String(id).toLowerCase())) }
async function putOrderKv (kv, o, editor) { o.updatedAt = nowIso(); const menu = await loadMenu(); o.totalCache = C.totals(menu, o).total; await kv.kvPut(KEY(o.id), o, editor || '團體訂餐'); await idxPut(kv, o) }
async function putOrder (o, editor) { return putOrderKv(await goKv(), o, editor) }
const log = (o, by, what) => { o.edits = [{ t: nowIso(), by: String(by || '').slice(0, 30), what: String(what || '').slice(0, 120) }, ...(o.edits || [])].slice(0, 80) }
const ORIGIN = 'https://ground-pm.vercel.app'
export const linkOf = (id) => `${ORIGIN}/order/${id}`

// ── 建單（從收件匣對話）──
async function _createOrder ({ who, acct, convId, custName, company, taxId, when, mode, contact, phone, uid, deadline, demo }) {
  let id = ''; for (let i = 0; i < 5; i++) { id = Math.random().toString(36).slice(2, 10); if (!(await kvGet(KEY(id)))) break } // 讀過＝不存在 → 存檔走「只新增」，同時被別人用掉＝撞版本整段重做換新碼
  const o = { id, acct: String(acct || 'gd'), convId: String(convId || ''), uid: String(uid || ''), custName: String(custName || '').slice(0, 40), company: String(company || custName || '').slice(0, 60), taxId: String(taxId || '').replace(/\D/g, '').slice(0, 8), when: String(when || '').slice(0, 16), mode: String(mode || '外帶自取').slice(0, 10), deadline: String(deadline || '').slice(0, 16), contact: String(contact || custName || '').slice(0, 30), phone: String(phone || '').slice(0, 20),
    rows: [], shared: [], disc: '', dep: 0, pay: { status: '未付', method: '現場', amount: 0 }, status: demo ? 'sent' : 'draft', frozen: false, demo: !!demo, hostUid: String(uid || '') || null, assignee: who.name, createdBy: who.name, createdAt: nowIso(), edits: [] } // demo＝模擬試用：不通知、完成不累點、列表另篩
  log(o, who.name, '建單')
  await putOrder(o, '團體訂餐建單(' + who.name + ')')
  return { ok: true, id, link: linkOf(id), order: o }
}
// ── 店家存（基本資料／餐點／金額）──
const EDITABLE_STAFF = ['draft', 'sent', 'submitted', 'priced', 'confirmed']
async function _saveOrder ({ who, id, patch }) {
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
async function _setStatus ({ who, id, status }) {
  const o = await getOrder(id); if (!o) return { ok: false, error: '找不到這張單' }
  let earn = false
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
  else if (status === 'done') { if (o.status !== 'locked') return { ok: false, error: '先鎖單再標完成' }; o.status = 'done'; o.doneAt = nowIso(); earn = !o.demo } // v4.70.86 完成＝有 LINE 身分的人自動累點（v4.71.132：先存完成狀態，存好才入點） // v4.70.86 完成＝有 LINE 身分的人自動累點
  else if (status === 'void') { o.status = 'void'; o.voidAt = nowIso() }
  else if (status === 'reset') { if (!o.demo) return { ok: false, error: '只有模擬單能清空' }; o.rows = []; o.shared = []; o.imgs = null; o.imgSentAt = null; o.confirmedAt = null; o.frozen = false; o.hostUid = null; o.status = 'sent' }
  else if (status === 'reopen') { if (o.status !== 'void') return { ok: false, error: '只有作廢的單能復原' }; o.status = (o.rows || []).length ? 'submitted' : 'draft' }
  else return { ok: false, error: '不認識的狀態' }
  log(o, who.name, C.STATUS_LABEL[o.status] || status)
  await putOrder(o, '團體訂餐(' + who.name + ')')
  if (earn) { let msg = '', bad = false; try { const MB = await import('./_member.js'); const r = await MB.earnFromOrder(o); msg = r && r.n ? `會員入點：${r.n} 人共 ${r.pts} 點` : '' } catch (e) { bad = true; msg = '會員入點失敗：' + String(e.message || e).slice(0, 60) } { try { const o2 = await commit(o.id, (x) => { if (!msg && !bad && !x.earnErr) return false; if (msg) log(x, '系統', msg); if (bad) x.earnErr = { at: nowIso(), msg }; else delete x.earnErr }, '團體訂餐(入點)'); return { ok: true, order: o2, totals: C.totals(menu, o2) } } catch (e) { console.error('[grporder] 入點結果留痕沒存進去', o.id, msg) } } }
  return { ok: true, order: o, totals: C.totals(menu, o) }
}
// ── 發連結給客人（走收件匣 sendOut：50 秒內 reply 免費，否則 push）──
async function _sendLink ({ who, mgr, cfgIB, IB, id }) {
  const o = await getOrder(id); if (!o) return { ok: false, error: '找不到這張單' }
  if (!o.convId) return { ok: false, error: '這張單沒綁收件匣對話' }
  const cfg = await loadCfg()
  const text = String(cfg.linkTpl || DEF_CFG.linkTpl).replace('{company}', o.company || o.custName || '您').replace('{link}', linkOf(o.id)).replace('{when}', o.when || '待定').replace('{mode}', o.mode || '')
  { const g = await goGate(); if (g) return gateOut(g) }
  const r = await IB.sendOut({ who, mgr, cfg: cfgIB, id: o.convId, text })
  if (!r.ok) return r
  const o2 = await commit(o.id, (x) => { if (x.status === 'draft') x.status = 'sent'; x.sentAt = nowIso(); log(x, who.name, '發連結給客人（' + r.mode + '）') }, '團體訂餐(' + who.name + ')') // 已送出：只重做寫入
  return { ok: true, order: o2, mode: r.mode }
}
// ── 客人頁（公開：只認連結碼）──
const deadlinePassed = (o) => !!(o.deadline && (Date.now() + 8 * 3600e3) > new Date(o.deadline.replace(' ', 'T') + ':00Z').getTime()) // deadline 存台灣時間字串
export function publicView (o, menu, cfg) {
  const t = C.totals(menu, o)
  const expired = cfg && cfg.expireDays && o.createdAt && (Date.now() - new Date(o.createdAt).getTime()) > cfg.expireDays * 86400e3 && !['locked', 'done'].includes(o.status)
  return { ok: true, id: o.id, demo: !!o.demo, host: o.hostUid || o.uid || null, company: o.company, custName: o.custName, taxId: o.taxId, addr: o.addr || '', email: o.email || '', when: o.when, deadline: o.deadline || '', closed: deadlinePassed(o), mode: o.mode, contact: o.contact, rows: o.rows, shared: o.shared, disc: o.disc, dep: o.dep, status: o.status, frozen: !!o.frozen, priceAt: o.priceAt || null, editable: C.CUST_EDITABLE.includes(o.status) && !expired, expired: !!expired, liff: (process.env.LIFF_ID || process.env.LIFF_ORDER_ID || '').trim() || null, liffUrl: (process.env.LIFF_ID || process.env.LIFF_ORDER_ID || '').trim() ? `https://liff.line.me/${(process.env.LIFF_ID || process.env.LIFF_ORDER_ID).trim()}?to=order&c=${o.id}` : null, /* 團體訂餐自己的 LIFF app（端點 /order/） */ pay: payPub(o, t, cfg), totals: t, carry: C.carry(menu, o, cfg && cfg.carry), submittedAt: o.submittedAt || null, confirmedAt: o.confirmedAt || null, imgs: o.imgs || null, custSavedAt: o.custSavedAt || null }
}
async function _custSave ({ code, body }) {
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
function callerUid (body) { if (body && body.uid && body.pt && ptOf(body.uid) === String(body.pt)) return String(body.uid); if (body && body.anon && /^[a-z0-9]{8,40}$/i.test(String(body.anon))) return 'anon:' + body.anon; return '' }
const isHost = (o, body) => { if (o.demo) return true; const host = o.hostUid || o.uid; if (!host) return true; const u = callerUid(body); return !!u && u === host }
// 只換共用品項（審查第 1 點：不整份蓋 rows）
async function _custShared ({ code, body }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  const cfg = await loadCfg(); if (!C.CUST_EDITABLE.includes(o.status)) return { ok: false, error: '這張單已經' + (C.STATUS_LABEL[o.status] || '鎖定') }
  if (deadlinePassed(o)) return { ok: false, error: '已經過截單時間', closed: true }
  const menu = await loadMenu(); o.shared = C.cleanOrderBody(menu, { rows: [], shared: body.shared || [] }).shared; o.custSavedAt = nowIso()
  if (o.status === 'priced') { o.status = 'submitted'; log(o, '客人', '核價後又改了共用 → 退回待核價') }
  await putOrder(o, '團體訂餐(客人共用)'); return publicView(o, menu, cfg)
}
// 貼文字拆列：後端解析後「追加」，不蓋現有列
async function _custParseAdd ({ code, body }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  const cfg = await loadCfg(); if (!C.CUST_EDITABLE.includes(o.status)) return { ok: false, error: '這張單已經' + (C.STATUS_LABEL[o.status] || '鎖定') }
  const r = await parseText({ text: body.text }); if (!r.ok) return r
  const menu = await loadMenu(); let blocked = ''
  const fresh = await commit(o.id, (x) => { // AI 拆完（不重做 AI）：重讀最新再追加，狀態變了就不加
    if (!C.CUST_EDITABLE.includes(x.status)) { blocked = '這張單已經' + (C.STATUS_LABEL[x.status] || '鎖定'); return false }
    for (const row of r.rows) x.rows.push({ ...row, uid: 'anon:' + row.pid, src: 'manual' })
    for (const sh of r.shared) { const ex = x.shared.find(y => y.id === sh.id); if (ex) ex.q += sh.q; else x.shared.push({ ...sh }) }
    if (!x.hostUid && !x.uid && x.rows.length) x.hostUid = callerUid(body) || x.rows[0].uid
    x.custSavedAt = nowIso(); log(x, '客人', '貼文字拆出 ' + r.rows.length + ' 人')
  }, '團體訂餐(客人拆列)')
  if (blocked) return { ok: false, error: blocked }
  return { ...publicView(fresh, menu, cfg), added: r.rows.length }
}
async function _custSubmit ({ code, body }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  if (!isHost(o, body || {})) return { ok: false, error: '只有主辦人能送出給店家' }
  if (!C.CUST_EDITABLE.includes(o.status)) return { ok: false, error: '這張單已經' + (C.STATUS_LABEL[o.status] || '鎖定') }
  if (!(o.rows || []).length && !(o.shared || []).length) return { ok: false, error: '還沒有任何餐點' }
  const menu = await loadMenu(); const cfg = await loadCfg()
  o.status = 'submitted'; o.submittedAt = nowIso(); log(o, '客人', '送出')
  await putOrder(o, '團體訂餐(客人送出)')
  const t = C.totals(menu, o)
  if (!o.demo) orderReceiptCard(o, menu, t).catch(() => {}) // v4.70.99 張良：客人要在 LINE 對話框看到「已送出」
  notifyStaff(o, { title: '團體訂餐：客人送出了', body: `${o.company || o.custName}｜${(o.rows || []).length} 人${(o.shared || []).length ? '＋共用 ' + o.shared.length + ' 項' : ''}｜暫計 ${t.total.toLocaleString()}${t.pend ? '（' + t.pend + ' 項待確認）' : ''}｜取餐 ${o.when || '待定'}` }).catch(() => {})
  return publicView(o, menu, cfg)
}
// ── 💳 LINE Pay 付款 v4.71.1（第三批金流；api/_linepay.js）：核價確認後（confirmed／locked）主辦人可在客人頁按「LINE Pay 付款」；付完由 LINE Pay 導回 ?gorder=<碼>&payok=1 → payConfirm 改 pay 欄＋留痕＋通知店家；模擬單不開 ──
const payDueOf = (o, t) => { const total = o.frozen && o.lockedTotal != null ? o.lockedTotal : t.total; return Math.max(0, Math.round(total) - Math.round(Number((o.pay || {}).amount) || 0)) }
const lpOn = () => !!(String(process.env.LINEPAY_CHANNEL_ID || '').trim() && String(process.env.LINEPAY_CHANNEL_SECRET || '').trim()) // 跟 _linepay.js enabled() 同口徑（publicView 是同步的，這裡不 import）
const lpEnv = () => (/^prod/i.test(String(process.env.LINEPAY_ENV || '').trim()) ? '正式' : '沙盒測試')
function payPub (o, t, cfg) { const p = o.pay || {}; const can = !o.demo && ['confirmed', 'locked'].includes(o.status); const ec = ecpayOn(cfg); return { status: p.status || '未付', method: p.method || '', amount: Number(p.amount) || 0, paidAt: p.paidAt || null, due: payDueOf(o, t), enabled: can && lpOn(), env: lpEnv(), ecpay: can && !!ec, ecpayTest: !!(ec && ec.test), ecpayChoose: ((cfg || {}).ecpay || {}).choose || 'ALL', pending: p.pending || null, invoice: o.invoice ? { no: o.invoice.no, date: o.invoice.date, taxId: o.invoice.taxId || '', test: !!o.invoice.test } : null } }
const ecpayOn = (cfg) => { try { const id = String(process.env.ECPAY_MERCHANT_ID || '').trim(); if (id && String(process.env.ECPAY_HASH_KEY || '').trim()) return { test: false }; return ((cfg || {}).ecpay || {}).test ? { test: true } : null } catch (_) { return null } }
let _EC = null; async function EC () { if (!_EC) _EC = await import('./_ecpay.js'); return _EC }
// 付款成功（LINE Pay／綠界共用）：改 pay 欄＋留痕＋通知店家＋自動開發票；冪等靠呼叫端先比對交易號
const paidRef = (o, ref) => !!ref && ((o.pay || {}).txId === ref || ((o.pay || {}).txIds || []).includes(ref))
async function markPaid (id, { amount, method, ref, env, extra }) { // v4.71.132：扣款已發生 → 重讀最新再入帳（同交易號已入帳＝跳過，不重複加），撞版本只重做寫入
  const menu = await loadMenu(); let did = false
  const o = await commit(id, (x) => {
    if (paidRef(x, ref)) return false // 入帳過的交易號都記在 pay.txIds（不只最後一筆；關卡 3 第一輪 OpenAI A）
    const t = C.totals(menu, x)
    const paid = Math.round(Number((x.pay || {}).amount) || 0) + amount; const total = x.frozen && x.lockedTotal != null ? x.lockedTotal : t.total
    x.pay = { ...(x.pay || {}), status: paid >= Math.round(total) ? '已付清' : '已付訂金', method, amount: paid, lastAmt: amount, paidAt: nowIso(), txId: ref, env, pending: null, ...(extra || {}), txIds: [...new Set([...((x.pay || {}).txIds || []), ...((x.pay || {}).txId ? [x.pay.txId] : []), ref])] } // 全部保留（不截斷；關卡 3 第二輪 OpenAI A）
    delete x.pay.tx; delete x.pay.ecp
    log(x, '客人', `${method} 付款 ${amount} 元（${env}）`); did = true
  }, '團體訂餐(付款)')
  if (!did) return o
  notifyStaff(o, { title: `團體訂餐：客人已用 ${method} 付款`, body: `${o.company || o.custName}｜${amount.toLocaleString()} 元（${o.pay.status}）｜取餐 ${o.when || '待定'}${/正式/.test(env) ? '' : '｜' + env}` }).catch(() => {})
  try { const cfg = await loadCfg(); if ((cfg.invoice || {}).auto !== false && o.pay.status === '已付清' && !o.invoice) await invoiceIssue({ who: { name: '系統' }, id: o.id, auto: true }) } catch (_) {}
  return o
}
// ── 🧾 電子發票（綠界）：有統編開公司發票；付清自動開（cfg.invoice.auto），店家也可在 GD 側欄手動開／作廢 ──
const INV_BUSY_MS = 10 * 60e3
async function _invoiceIssue ({ who, id, taxId, title, addr, email, phone, auto }) {
  const o0 = await getOrder(id); if (!o0) return { ok: false, error: '找不到這張單' }
  if (o0.demo) return { ok: false, error: '模擬單不開發票' }
  const cfg = await loadCfg(); const E = await EC(); const creds = E.invCreds(!!(cfg.invoice || {}).test); if (!creds) return { ok: false, error: '綠界電子發票還沒設定（env ECPAY_INV_* 或設定頁勾測試）' }
  const menu = await loadMenu()
  { const g = await goGate(); if (g) return gateOut(g) }
  // ① 認領：已開過／別人正在開（10 分鐘內）＝不開；關聯編號沿用上次沒成功那次的（若上次其實開成功，綠界會擋重複，不會開出第二張）
  let err = '', claim = null
  const o = await commit(o0.id, (x) => {
    if (x.invoice && x.invoice.no) { err = `已開過發票 ${x.invoice.no}，要重開先作廢`; return false }
    const ing = x.invoicing; if (ing && !ing.failedAt && Date.now() - Date.parse(ing.at || 0) < INV_BUSY_MS) { err = '發票正在開立中（' + (ing.by || '') + '），請稍候再看'; return false }
    const adr = String(addr != null ? addr : x.addr || '').trim().slice(0, 100); if (adr && !x.addr) x.addr = adr; if (email && !x.email) x.email = String(email).trim().slice(0, 80)
    claim = { at: nowIso(), by: who.name, rel: (ing && ing.rel) || ('GO' + x.id + Date.now().toString(36)) }; x.invoicing = claim
  }, '團體訂餐(發票)')
  if (err) return { ok: false, error: err }
  const t = C.totals(menu, o); const amount = o.frozen && o.lockedTotal != null ? o.lockedTotal : t.total
  const tid = String(taxId != null ? taxId : o.taxId || '').replace(/\D/g, '').slice(0, 8); const ttl = String(title != null ? title : (tid ? o.company : '') || '').trim()
  const adr = String(addr != null ? addr : o.addr || '').trim().slice(0, 100)
  // ② 開
  let r; try { r = await E.issueInvoice({ creds, relateNumber: claim.rel, taxId: tid, title: ttl, addr: adr, email: email || o.email || '', phone: phone || o.phone || '', amount, itemName: `團體訂餐（${t.n} 人）`, remark: `${o.company || o.custName || ''} 取餐 ${o.when || ''}`.trim() }) } catch (e) { r = { ok: false, error: '綠界沒回應（' + String(e && e.message || e).slice(0, 40) + '），請到綠界後台確認有沒有開出' } }
  // ③ 記結果（只重做寫入）：失敗保留關聯編號給下次沿用
  if (!r.ok) { await commit(o.id, (x) => { x.invoiceErr = { at: nowIso(), error: r.error }; x.invoicing = { ...(x.invoicing || claim), failedAt: nowIso() }; log(x, who.name, `開發票失敗：${r.error}`) }, '團體訂餐(發票)'); return r }
  const inv = { no: r.no, date: r.date, random: r.random, amount, taxId: tid, title: ttl, at: nowIso(), by: who.name, test: !!r.test, rel: claim.rel }
  const o2 = await commit(o.id, (x) => { x.invoice = inv; delete x.invoiceErr; delete x.invoicing; if (tid && !x.taxId) x.taxId = tid; if (ttl && tid && !x.company) x.company = ttl; log(x, who.name, `開發票 ${r.no}（${amount} 元${tid ? '，統編 ' + tid : ''}${r.test ? '，測試' : ''}）${auto ? '（自動）' : ''}`) }, '團體訂餐(發票)')
  return { ok: true, invoice: o2.invoice, order: o2 }
}
async function _invoiceVoid ({ who, id, reason }) {
  const o = await getOrder(id); if (!o || !o.invoice || !o.invoice.no) return { ok: false, error: '這張單沒有發票' }
  const cfg = await loadCfg(); const E = await EC(); const creds = E.invCreds(!!(cfg.invoice || {}).test || !!o.invoice.test); if (!creds) return { ok: false, error: '綠界電子發票還沒設定' }
  { const g = await goGate(); if (g) return gateOut(g) }
  const no = o.invoice.no; const r = await E.voidInvoice({ creds, no, date: o.invoice.date, reason }); if (!r.ok) return r
  const o2 = await commit(o.id, (x) => { if (!x.invoice || x.invoice.no !== no) return false; x.invoiceVoided = [...(x.invoiceVoided || []), { ...x.invoice, voidAt: nowIso(), voidBy: who.name, reason }]; delete x.invoice; delete x.invoicing; log(x, who.name, `作廢發票 ${no}（${String(reason || '').slice(0, 20)}）`) }, '團體訂餐(發票)') // 已作廢：只重做寫入
  return { ok: true, order: o2 }
}
// ── 💳 綠界金流：客人選信用卡／ATM／超商 → 自動送表單到綠界 → 綠界背景回呼 ReturnURL（付款結果）／PaymentInfoURL（ATM 帳號、超商代碼）→ 客人導回 OrderResultURL／ClientBackURL ──
async function _custEcpayReq ({ code, body }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  if (o.demo) return { ok: false, error: '模擬單不能付款' }
  if (!isHost(o, body || {})) return { ok: false, error: '只有主辦人能付款' }
  if (!['confirmed', 'locked'].includes(o.status)) return { ok: false, error: '要先確認金額、店家鎖單後才能付款' }
  takeInvFields(o, body)
  const cfg = await loadCfg(); const ec = ecpayOn(cfg); if (!ec) return { ok: false, error: '店家尚未開通綠界付款' }
  const menu = await loadMenu(); const t = C.totals(menu, o); const due = payDueOf(o, t); if (due <= 0) return { ok: false, error: '這張單已經付清了' }
  const choose = ['ALL', 'Credit', 'ATM', 'CVS'].includes(String((body || {}).choose)) ? String(body.choose) : ((cfg.ecpay || {}).choose || 'ALL')
  const no = ('GO' + o.id + Date.now().toString(36)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
  o.pay = { ...(o.pay || {}), ecp: { no, amount: due, at: nowIso(), choose, test: ec.test } }
  log(o, '客人', `建立綠界付款 ${due} 元（${(await EC()).CHOOSE[choose]}${ec.test ? '，測試商家' : ''}）`)
  await putOrder(o, '團體訂餐(付款)')
  return { ok: true, url: `${ORIGIN}/api/mail-sync?gorder=${o.id}&ecpaygo=${no}`, amount: due }
}
export async function ecpayFormHtml ({ code, no }) {
  const o = await getOrder(code); const ecp = o && (o.pay || {}).ecp; if (!o || !ecp || ecp.no !== String(no || '')) return null
  const cfg = await loadCfg(); const E = await EC(); const creds = E.payCreds(!!(cfg.ecpay || {}).test); if (!creds) return null
  const base = `${ORIGIN}/api/mail-sync?gorder=${o.id}`
  return E.checkoutHtml({ creds, tradeNo: ecp.no, amount: ecp.amount, desc: 'GROUN:D 團體訂餐', itemName: `GROUN:D 團體訂餐 ${o.company || o.custName || ''}`.trim().replace(/#/g, ' '), returnUrl: `${base}&ecpayret=1`, orderResultUrl: `${base}&ecpayback=1`, clientBackUrl: `${base}&ecpayclient=1`, paymentInfoUrl: `${base}&ecpayinfo=1`, choose: ecp.choose })
}
async function ecpayVerify (o, params) { const cfg = await loadCfg(); const E = await EC(); const creds = E.payCreds(!!(cfg.ecpay || {}).test || !!((o.pay || {}).ecp || {}).test); if (!creds || !E.verifyMac(params || {}, creds)) return null; return creds }
// 綠界背景通知（ReturnURL）：RtnCode 1＝付款成功；要回純文字 1|OK
async function _ecpayReturn ({ code, params }) {
  const o = await getOrder(code); if (!o) return '0|order'
  const creds = await ecpayVerify(o, params); if (!creds) return '0|mac'
  const no = String(params.MerchantTradeNo || ''); const ecp = (o.pay || {}).ecp
  if (paidRef(o, no)) return '1|OK' // 重送＝已處理
  if (!ecp || ecp.no !== no) { await commit(o.id, (x) => { log(x, '系統', `綠界回呼交易號對不上 ${no}`) }, '團體訂餐(付款)'); return '1|OK' }
  if (String(params.RtnCode) === '1') { const amt = Math.round(Number(params.TradeAmt) || ecp.amount); await markPaid(o.id, { amount: amt, method: '綠界' + ({ Credit: '信用卡', ATM: 'ATM', CVS: '超商', BARCODE: '超商條碼', WebATM: '網路 ATM' })[String(params.PaymentType || '').split('_')[0]] || '', ref: no, env: creds.test ? '綠界測試' : '正式', extra: { ecTradeNo: params.TradeNo || '', payType: params.PaymentType || '' } }) }
  else { await commit(o.id, (x) => { log(x, '系統', `綠界付款未成功（${params.RtnCode}：${String(params.RtnMsg || '').slice(0, 60)}）`) }, '團體訂餐(付款)') }
  return '1|OK'
}
// 取號通知（PaymentInfoURL）：ATM 虛擬帳號／超商代碼，存 pay.pending 給客人頁顯示
async function _ecpayInfo ({ code, params }) {
  const o = await getOrder(code); if (!o) return '0|order'
  const creds = await ecpayVerify(o, params); if (!creds) return '0|mac'
  const pt = String(params.PaymentType || ''); const pending = { type: pt.startsWith('ATM') ? 'ATM' : pt.startsWith('CVS') ? 'CVS' : pt, amount: Math.round(Number(params.TradeAmt) || 0), bank: params.BankCode || '', account: params.vAccount || '', code: params.PaymentNo || '', expire: params.ExpireDate || '', at: nowIso(), no: params.MerchantTradeNo || '' }
  o.pay = { ...(o.pay || {}), pending }
  log(o, '系統', `綠界取號：${pending.type === 'ATM' ? '轉帳 ' + pending.bank + '-' + pending.account : '超商代碼 ' + pending.code}，${pending.amount} 元，期限 ${pending.expire}`)
  await putOrder(o, '團體訂餐(付款)')
  notifyStaff(o, { title: '團體訂餐：客人取得付款帳號（尚未付款）', body: `${o.company || o.custName}｜${pending.type === 'ATM' ? 'ATM 轉帳' : '超商代碼'} ${pending.amount.toLocaleString()} 元｜期限 ${pending.expire}` }).catch(() => {})
  return '1|OK'
}
// 客人導回（OrderResultURL：信用卡付完 POST 回來；ClientBackURL：ATM／超商取號後按返回）→ 回點餐單頁的 hash
async function _ecpayBackFrag ({ code, params, client }) {
  const o = await getOrder(code); if (!o) return 'payfail=' + encodeURIComponent('找不到這張點餐單')
  if (client) return (o.pay || {}).pending ? 'paypending=1' : 'paycancel=1'
  if (params && params.CheckMacValue) { const creds = await ecpayVerify(o, params); if (creds && String(params.RtnCode) === '1') { if (!paidRef(o, String(params.MerchantTradeNo || ''))) { try { await ecpayReturn({ code, params }) } catch (_) {} } return 'paid=' + (Number(params.TradeAmt) || 1) } return 'payfail=' + encodeURIComponent(String((params || {}).RtnMsg || '付款未完成').slice(0, 80)) }
  return (o.pay || {}).txId ? 'paid=' + ((o.pay || {}).lastAmt || 1) : 'paycancel=1'
}

let _LP = null; async function LP () { if (!_LP) _LP = await import('./_linepay.js'); return _LP }
const takeInvFields = (o, body) => { if (!body) return; if (body.addr != null) { const a = String(body.addr).trim().slice(0, 100); if (a) o.addr = a } if (body.email != null) { const e = String(body.email).trim().slice(0, 80); if (/^[^@\s]+@[^@\s]+$/.test(e)) o.email = e } } // v4.71.3 付款時順便留發票用的地址／email
async function _custPayReq ({ code, body }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  takeInvFields(o, body)
  if (o.demo) return { ok: false, error: '模擬單不能付款' }
  if (!isHost(o, body || {})) return { ok: false, error: '只有主辦人能付款' }
  if (!['confirmed', 'locked'].includes(o.status)) return { ok: false, error: '要先確認金額、店家鎖單後才能付款' }
  const L = await LP(); if (!L.enabled()) return { ok: false, error: '店家尚未開通線上付款' }
  const menu = await loadMenu(); const t = C.totals(menu, o); const due = payDueOf(o, t)
  if (due <= 0) return { ok: false, error: '這張單已經付清了' }
  const orderNo = `GO-${o.id}-${Date.now().toString(36)}`
  const base = `${ORIGIN}/api/mail-sync?gorder=${o.id}`
  { const g = await goGate(); if (g) return gateOut(g) }
  const r = await L.request({ orderId: orderNo, amount: due, name: `GROUN:D 團體訂餐 ${o.company || o.custName || ''}`.trim(), confirmUrl: `${base}&payok=1`, cancelUrl: `${base}&paycancel=1` })
  if (!r.ok) return r
  await commit(o.id, (x) => { takeInvFields(x, body); x.pay = { ...(x.pay || {}), tx: { id: r.transactionId, orderNo, amount: due, at: nowIso() } }; log(x, '客人', `建立 LINE Pay 付款 ${due} 元（${L.envLabel()}）`) }, '團體訂餐(付款)') // 交易已建：只重做寫入
  return { ok: true, url: r.url, amount: due }
}
async function _payConfirm ({ code, transactionId }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  const tx = (o.pay || {}).tx; transactionId = String(transactionId || '')
  if (transactionId && paidRef(o, transactionId)) return { ok: true, dup: true, amount: (o.pay || {}).lastAmt || (o.pay || {}).amount || 0, status: (o.pay || {}).status } // 導回頁被重新整理：已確認過就直接回成功，不再打 LINE Pay
  if (!tx || !transactionId || tx.id !== transactionId) return { ok: false, error: '付款資料對不上，請回點餐單重新付款' }
  { const g = await goGate(); if (g) return { ...gateOut(g), error: '系統維護中（幾分鐘），付款還沒扣，請稍後重新整理這一頁完成付款' } }
  const L = await LP(); let r
  try { r = await L.confirm({ transactionId, amount: tx.amount }) } catch (e) { r = { ok: false, code: 'unknown', error: String(e && e.message || e).slice(0, 80) } } // 確認請求逾時／斷線＝扣款結果不明 → 跟 1172 一樣先查狀態（關卡 3 第二輪 OpenAI A）
  if (!r.ok && (r.code === '1172' || r.code === 'unknown')) { // 已確認過（上次扣款成功但沒存進去、或兩個導回同時到）：向 LINE Pay 查狀態，確定「付款已完成」才補入帳（關卡 3 第一輪 OpenAI／Gemini A）
    const st = await L.checkStatus({ transactionId }).catch((e) => ({ ok: false, error: String(e && e.message || e) }))
    if (st.ok && st.code === '0123') r = { ok: true, info: { payType: '' }, recovered: true }
    else if (r.code === 'unknown' && st.ok && st.code === '0110') return { ok: false, error: '付款確認沒有完成（尚未扣款），請重新整理這一頁再試' } // 查得到「已授權、還沒確認」＝確認沒成功，可以安全再確認
    else { const why = st.ok ? `LINE Pay 狀態 ${st.code}` : st.error; try { await commit(o.id, (x) => { x.pay = { ...(x.pay || {}), review: { tx: transactionId, at: nowIso(), why } }; log(x, '系統', `LINE Pay 付款結果不明（${why}），待人工核對`) }, '團體訂餐(付款)') } catch (e) { console.error('[grporder] 待核對標記沒存進去（會嘗試通知店家）', o.id, transactionId, String(e && e.message || e).slice(0, 80)) } notifyStaff(o, { title: '團體訂餐：LINE Pay 付款要人工核對', body: `${o.company || o.custName}｜交易號 ${transactionId}｜${tx.amount} 元｜${why}` }).catch(() => {}); return { ok: false, error: '付款狀態需要店家核對，店家會盡快跟你確認（不用重複付款）' } }
  }
  if (!r.ok) { await commit(o.id, (x) => { log(x, '系統', `LINE Pay 確認失敗：${r.error}`) }, '團體訂餐(付款)'); return r }
  let o2; try { o2 = await markPaid(o.id, { amount: tx.amount, method: 'LINE Pay', ref: transactionId, env: L.isProd() ? '正式' : 'LINE Pay 沙盒', extra: { orderNo: tx.orderNo, payType: r.info.payType || '' } }) // v4.71.3 與綠界共用
  } catch (e) { // 扣款已成功但入帳寫不進去：通知店家核對；客人重新整理會走上面 1172＋查狀態補入帳
    notifyStaff(o, { title: '團體訂餐：LINE Pay 已扣款但入帳沒存進去', body: `${o.company || o.custName}｜交易號 ${transactionId}｜${tx.amount} 元｜請核對（客人重新整理付款頁會自動補）` }).catch(() => {})
    return { ok: false, error: '付款已完成，系統記錄時忙線——請稍後重新整理這一頁（不用重複付款）' }
  }
  return { ok: true, amount: tx.amount, status: (o2.pay || {}).status }
}
async function _custConfirm ({ code, body }) {
  const o = await getOrder(code); if (!o) return { ok: false, error: '找不到這張點餐單' }
  if (!isHost(o, body || {})) return { ok: false, error: '只有主辦人能確認金額' }
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
  if (o.demo) return // 模擬單不吵人
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
    const chG = (process.env.LINE_LOGIN_CHANNEL_ID || '').trim(); if (chG && String(vr.client_id) !== chG) return { ok: false, error: '這不是 GROUN:D 的 LINE 登入' } // 三家審查（Claude）抓到：不比對 channel 任何 LINE Login app 的 token 都過關；設 env LINE_LOGIN_CHANNEL_ID 就鎖
    const pf = await (await fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + at } })).json()
    if (!pf || !pf.userId) return { ok: false, error: '拿不到 LINE 身分' }
    return { ok: true, uid: pf.userId, name: String(pf.displayName || '').slice(0, 30), pic: String(pf.pictureUrl || '').slice(0, 300), pt: ptOf(pf.userId) }
  } catch (_) { return { ok: false, error: 'LINE 驗證失敗，請再試一次' } }
}
// 存「我這一份」：LINE 身分要帶 pt（伺服器簽的）；匿名用 anon id（≥8 碼）；只能動自己那列
async function _custMine ({ code, body }) {
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
  if (!o.hostUid && !o.uid && o.rows.length) o.hostUid = o.rows[0].uid // 審查第 2 點：沒綁 LINE 對話的單，第一個進來點的人＝主辦人
  o.custSavedAt = nowIso()
  if (o.status === 'priced') { o.status = 'submitted'; log(o, name, '核價後又改了餐點 → 退回待核價') }
  await putOrder(o, '團體訂餐(' + name + ')')
  return { ...publicView(o, menu, cfg), mine: row }
}

// ── 第二批 v4.70.85：兩張計價圖（前端 html-to-image 出 PNG → 這裡存私桶簽名一年）＋傳給客人（圖＋文字）＋客人頁顯示 ──
async function _saveImgs ({ who, id, p1, p2 }) {
  const o = await getOrder(id); if (!o) return { ok: false, error: '找不到這張單' }
  const dec = (d) => { const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(d || '')); return m ? { buf: Buffer.from(m[2], 'base64'), ext: m[1] === 'png' ? 'png' : 'jpg', mime: 'image/' + m[1] } : null }
  const a = dec(p1), b = dec(p2); if (!a || !b) return { ok: false, error: '圖片格式不對' }
  if (a.buf.length > 8e6 || b.buf.length > 8e6) return { ok: false, error: '圖片太大' }
  { const g = await goGate(); if (g) return gateOut(g) } // 上傳前先問閘門（關卡 3 第一輪 OpenAI A）
  const ts = Date.now().toString(36); const out = {}
  for (const [k, im] of [['p1', a], ['p2', b]]) { const path = `grporder/${o.id}/${k}_${ts}.${im.ext}`; if (!(await uploadPrivate(path, im.buf, im.mime))) return { ok: false, error: '上傳失敗' }; const url = await signedUrl(path, 365 * 86400); if (!url) return { ok: false, error: '產生網址失敗' }; out[k] = { path, url, size: im.buf.length } }
  const menuI = await loadMenu()
  const o2 = await commit(o.id, (x) => { x.imgs = { ...out, at: nowIso(), by: who.name, total: C.totals(menuI, x).total }; log(x, who.name, '產生計價圖 01／02') }, '團體訂餐計價圖(' + who.name + ')') // 已上傳：只重做寫入
  return { ok: true, imgs: o2.imgs, order: o2 }
}
async function _sendImgs ({ who, mgr, cfgIB, IB, id }) {
  const o = await getOrder(id); if (!o) return { ok: false, error: '找不到這張單' }
  if (!o.imgs || !o.imgs.p1) return { ok: false, error: '先產生計價圖' }
  if (o.demo) { if (['submitted', 'draft', 'sent'].includes(o.status)) { o.status = 'priced'; o.pricedAt = nowIso() } log(o, who.name, '（模擬）計價圖視同已傳'); await putOrder(o, '團體訂餐(' + who.name + ')'); return { ok: true, order: o, mode: 'demo' } } // 模擬單不真的傳 LINE
  if (!o.convId) return { ok: false, error: '這張單沒綁收件匣對話' }
  const menu = await loadMenu(); const t = C.totals(menu, o)
  const text = `${o.company || o.custName} 計價表（全單 ${t.total.toLocaleString()} 元${t.disc ? '，含折扣' : ''}）\n取餐 ${o.when || '待定'}（${o.mode || ''}）\n確認無誤請在點餐頁按「確認無誤」：${linkOf(o.id)}`
  { const g = await goGate(); if (g) return gateOut(g) }
  const r = await IB.sendImages({ who, mgr, cfg: cfgIB, id: o.convId, urls: [o.imgs.p1.url, o.imgs.p2.url], text })
  if (!r.ok) return r
  const o2 = await commit(o.id, (x) => { const tx = C.totals(menu, x); x.imgSentAt = nowIso(); log(x, who.name, '計價圖傳給客人（' + r.mode + '）'); if (['submitted', 'draft', 'sent'].includes(x.status) && !tx.pend && !tx.missing) { x.status = 'priced'; x.pricedAt = nowIso() } }, '團體訂餐(' + who.name + ')') // 傳圖＝核價完成；已送出：只重做寫入
  return { ok: true, order: o2, mode: r.mode }
}

// ── 送出確認卡片（傳到建單的那個 LINE 對話；LINE 內多人各自點，但只通知主辦人一則，省額度）──
async function orderReceiptCard (o, menu, t) {
  if (!o.convId) return
  const [acct, uid] = String(o.convId).split(':'); if (!uid) return
  const IB = await import('./_inbox.js')
  const RED = '#ce1611'
  const kv = (k, v) => ({ type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: k, size: 'sm', color: '#8a7a70', flex: 3 }, { type: 'text', text: String(v), size: 'sm', weight: 'bold', color: '#2b1d18', align: 'end', flex: 5, wrap: true }] })
  const names = (o.rows || []).map(r => r.name).filter(Boolean)
  const card = { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'vertical', backgroundColor: RED, paddingAll: '14px', contents: [{ type: 'text', text: '已收到你們的訂單', color: '#ffffff', weight: 'bold', size: 'lg' }, { type: 'text', text: `${o.company || o.custName || ''}・單號 ${o.id}`, color: '#ffd9d6', size: 'xxs' }] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [kv('人數', `${t.n} 人${(o.shared || []).length ? '＋共用 ' + o.shared.reduce((a, s) => a + (s.q || 1), 0) + ' 項' : ''}`), kv('暫計金額', `${t.total.toLocaleString()} 元${t.pend ? '（' + t.pend + ' 項待確認）' : ''}`), kv('取餐', `${o.when || '待定'}（${o.mode || ''}）`), { type: 'separator', margin: 'md' }, { type: 'text', text: names.length ? names.join('、') : '—', size: 'xs', color: '#8a7a70', wrap: true, margin: 'md' }, { type: 'text', text: '店家核價後會再傳計價表給你確認；截單前都還能回連結改。', size: 'xs', color: '#8a7a70', wrap: true, margin: 'sm' }] },
    footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [{ type: 'button', style: 'primary', color: RED, height: 'sm', action: { type: 'uri', label: '看訂單', uri: (process.env.LIFF_ID || '').trim() ? `https://liff.line.me/${(process.env.LIFF_ID || '').trim()}?to=order&c=${o.id}` : linkOf(o.id) } }] } }
  await IB.sendSystemMessages({ acct, uid, messages: [{ type: 'flex', altText: `已收到訂單：${t.n} 人、暫計 ${t.total.toLocaleString()} 元`, contents: card }], lastText: '（已收到訂單卡片）' })
  log(o, '系統', '傳「已收到訂單」卡片給主辦人')
}

// ── 對外入口（v4.71.132）：每個都包 goRun（同一次請求一個讀寫物件、撞版本整段重做；操作者姓名給新殼命令橋與驗收閘門）──
const staffOp = (a) => (a && a.who && a.who.name) || '團體訂餐'
export const createOrder = goRun(_createOrder, staffOp)
export const saveOrder = goRun(_saveOrder, staffOp)
export const setStatus = goRun(_setStatus, staffOp)
export const sendLink = goRun(_sendLink, staffOp)
export const invoiceIssue = goRun(_invoiceIssue, staffOp)
export const invoiceVoid = goRun(_invoiceVoid, staffOp)
export const saveImgs = goRun(_saveImgs, staffOp)
export const sendImgs = goRun(_sendImgs, staffOp)
export const custSave = goRun(_custSave, () => '客人')
export const custShared = goRun(_custShared, () => '客人')
export const custParseAdd = goRun(_custParseAdd, () => '客人')
export const custSubmit = goRun(_custSubmit, () => '客人')
export const custEcpayReq = goRun(_custEcpayReq, () => '客人')
export const custPayReq = goRun(_custPayReq, () => '客人')
export const custConfirm = goRun(_custConfirm, () => '客人')
export const custMine = goRun(_custMine, () => '客人')
export const ecpayReturn = goRun(_ecpayReturn, () => '系統')
export const ecpayInfo = goRun(_ecpayInfo, () => '系統')
export const ecpayBackFrag = goRun(_ecpayBackFrag, () => '系統')
export const payConfirm = goRun(_payConfirm, () => '系統')
export const saveCfg = goRun(_saveCfg, (p, who) => (who && who.name) || '團體訂餐')
