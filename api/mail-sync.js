// 後端：自動收信入庫（cron-daily 每天呼叫；也可手動 /api/mail-sync?days=N）
// ① 中信 e-Cash「帳務處理結果」通知（goodmask77@gmail.com）→ sp_finance_pm_ctbc（只增不改，dedupe by 交易序號）
// ② Eats365 POS 日結報表 xlsx 附件（money@gumgum.club）→ sp_finance_pm_pos（設好 MAIL_USER2/MAIL_PASS2 後自動啟用）
// 憑證：Gmail 應用程式密碼，存 Vercel Sensitive env。⚠️ env 值可能帶「VAR=」前綴，clean() 必須 strip。
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { parsePosWorkbook, parseTxSheet } from './_pos-parse.js' // 解析器共用模組（前端手動匯入也用同一套）
// 2026-08-27 退役 _ground-seed.js（試營運 08-10~13 截圖回填）：口徑錯（8/10、8/11 比 POS 實收多，疑未扣完折扣），
// 且每次同步都會把刪掉的日子塞回來——改由 syncJoya 抓喬亞真值（張良同意四天以 POS 為準）。檔案留檔不再引用。
import { groundManualRecords } from './_ground-manual.js' // GROUN:D 喬亞POS報表手動回填（08-19~21，張良 2026-08-24 截圖；已驗證與POS一致）
import { joyaLogin, joyaFetchDay, joyaBuildRecord, taipeiToday, taipeiAfterClose, joyaFetchTimeslots, timeslotSection, TIMESLOT_SHEET } from './_joya.js' // GROUN:D 喬亞行動報表自動抓取（2026-08-26 起全自動）
import { syncIchef } from './_ichef.js' // 參考店1/2 每日營業額（iCHEF 後台自動抓取，2026-09-01）
import { syncEatsLive } from './_eats.js' // AB 今天即時營業額（Eats365 商家後台，2026-09-02）

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const M1U = clean(process.env.MAIL_USER), M1P = clean(process.env.MAIL_PASS)   // goodmask77（中信通知）
const M2U = clean(process.env.MAIL_USER2), M2P = clean(process.env.MAIL_PASS2) // money@gumgum.club（Eats365）

export async function kvGet(id) { // export：joya-intraday.js（盤中更新）共用
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
  const rows = r.ok ? await r.json() : []
  try { return rows[0]?.data?.v ? JSON.parse(rows[0].data.v) : null } catch (_) { return null }
}
export async function kvPut(id, obj, editor) {
  await fetch(`${SB_URL}/rest/v1/pm_documents`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor, updated_at: new Date().toISOString() }),
  })
  CHANGED.add(id)
}

// 入庫後廣播「這些 key 變了」（Realtime REST 一發 HTTP 就好，免開 websocket）：
// 前端 supa.js 訂著 pm-doc-sync 頻道，聽到就自動重抓該 key → 日結信一入庫，
// 開著的營運報表/對帳頁畫面自己跳新資料，不用手動按更新或重新整理（張良 2026-08-14）
const CHANGED = new Set()
export async function announceChanged() {
  const keys = [...CHANGED]; CHANGED.clear()
  if (!keys.length) return
  try {
    await fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: keys.map(k => ({ topic: 'pm-doc-sync', event: 'doc', payload: { key: k, editor: 'server' } })) }),
    })
  } catch (_) {}
}

// 開連線＋找出「所有郵件」「垃圾桶」兩個資料夾（信被使用者整理/刪掉也照抓）
const DBG = { boxes: [], cred: '' }
async function withMailboxes(user, pass, fn) {
  DBG.cred = `${(user || '').slice(0, 4)}…/len${(pass || '').length}`
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false })
  await client.connect()
  try {
    const paths = []
    for (const mb of await client.list()) {
      if (mb.specialUse === '\\All' || mb.specialUse === '\\Trash') paths.push(mb.path)
    }
    if (!paths.length) paths.push('INBOX')
    DBG.boxes.push(...paths)
    for (const p of paths) {
      const lock = await client.getMailboxLock(p)
      try { await fn(client) } finally { lock.release() }
    }
  } finally { await client.logout().catch(() => {}) }
}

const htmlToLines = (html) => (html || '').replace(/<[^>]+>/g, '\n').replace(/&nbsp;?/g, ' ').split('\n').map(s => s.trim()).filter(Boolean)

// ── ① 中信 e-Cash ───────────────────────────────────────────
async function syncCtbc(days) {
  if (!M1U || !M1P) return { skipped: '未設 MAIL_USER/MAIL_PASS' }
  const store = (await kvGet('sp_finance_pm_ctbc')) || { account: '中國信託 · 企業收付 e-Cash', entries: [] }
  const have = new Set(store.entries.map(e => e.id))
  const found = {}
  let scanned = 0
  await withMailboxes(M1U, M1P, async (client) => {
    let uids
    try { uids = await client.search({ from: 'bank.csc@inib.ctbcbank.com', since: new Date(Date.now() - days * 864e5) }, { uid: true }) } catch (e) { DBG.boxes.push('ctbc-searchERR:' + e.message) }
    DBG.boxes.push('ctbc:' + (Array.isArray(uids) ? uids.length : String(uids)))
    if (!uids || !uids.length) return
    for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
      scanned++
      if (!/帳務處理結果/.test(msg.envelope?.subject || '')) continue
      const parsed = await simpleParser(msg.source)
      const lines = htmlToLines(parsed.html || parsed.textAsHtml || parsed.text)
      const grab = (lab) => { const i = lines.findIndex(l => l === lab || l.replace(/\s+/g, '') === lab); return i >= 0 ? (lines[i + 1] || '') : '' }
      const sn = grab('交易序號')
      if (!sn || have.has(sn) || found[sn]) continue
      const m = (grab('交易總金額') || '').match(/([\d,]+)/)
      const d8 = (s) => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s) ? s.replace(/\//g, '-') : s
      found[sn] = {
        id: sn, type: grab('交易類別'), result: grab('處理結果'),
        setDate: d8(grab('設定日期')), effDate: d8(grab('生效日期')),
        outAcct: grab('轉出帳號'), inAcct: grab('轉入帳號'),
        count: parseInt((grab('交易總筆數') || '1').replace(/\D/g, '') || '1', 10),
        amount: m ? parseInt(m[1].replace(/,/g, ''), 10) : 0,
        note: grab('備註'), source: 'mail',
      }
    }
  })
  const add = Object.values(found)
  if (add.length) {
    store.entries = [...store.entries, ...add].sort((a, b) => ((a.effDate || a.setDate) < (b.effDate || b.setDate) ? -1 : 1))
    store.updatedAt = new Date().toISOString()
    await kvPut('sp_finance_pm_ctbc', store, '中信e-Cash自動收信')
  }
  return { scanned, added: add.length, total: store.entries.length }
}

// ── ② Eats365 POS 日結（xlsx 附件）──────────────────────────
// 解析函式已抽到 ./_pos-parse.js（sheetSections/parsePosWorkbook/parseTxSheet）——前端手動匯入共用同一套
async function syncPos(days) {
  // 來源：money@gumgum.club（設 MAIL_USER2/MAIL_PASS2 後）＋ goodmask77（吃「轉寄/自動轉寄」的報表信）
  const accounts = []
  if (M2U && M2P) accounts.push([M2U, M2P])
  if (M1U && M1P) accounts.push([M1U, M1P])
  if (!accounts.length) return { skipped: '未設信箱憑證' }
  const store = (await kvGet('sp_finance_pm_pos')) || { name: 'Eats365 POS 日結', entries: [] }
  const have = new Set(store.entries.map(e => e.id))
  // 雙店支援：A Beach 101 與 GROUN:D 同一天各寄一封 → 以「日期+店名」二次去重（舊 id 不含店名也擋得住重複）
  const storeKeyOf = (n) => /groun/i.test(n || '') ? 'ground' : 'abeach'
  const haveCombo = new Set(store.entries.map(e => (e.date || '') + '|' + storeKeyOf(e.store)))
  const found = {}
  const txAll = [] // 逐筆交易（含已入庫日期→回補）
  let scanned = 0
  for (const [au, ap] of accounts) await withMailboxes(au, ap, async (client) => {
    let uids
    try { uids = await client.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true }) } catch (e) { DBG.boxes.push('pos-searchERR:' + e.message) }
    DBG.boxes.push('pos:' + (Array.isArray(uids) ? uids.length : String(uids)))
    if (!uids || !uids.length) return
    // ⚠️ imapflow：fetch 迭代中不可再下其他指令（會死鎖）→ 先收集符合的 uid，迴圈外再下載
    const matched = []
    for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
      const from = msg.envelope?.from?.[0]?.address || ''
      const subject = msg.envelope?.subject || ''
      if (/eats365/i.test(from) || /營業報告|Eats365/i.test(subject)) matched.push({ uid: msg.uid, subject })
    }
    for (const mm of matched) {
      scanned++
      const { content } = await client.download(mm.uid, undefined, { uid: true })
      const chunks = []; for await (const c of content) chunks.push(c)
      const parsed = await simpleParser(Buffer.concat(chunks))
      const atts = parsed.attachments || []
      // 同一封信有三個附件：DailyClosing(日結)/Transaction(逐筆交易)/Reconciliation(對帳)——先照名字挑，挑不到退回「第一個 xls」（舊行為）
      const att = atts.find(a => /daily\s*closing/i.test(a.filename || '')) || atts.find(a => /\.xlsx?$/i.test(a.filename || ''))
      if (!att) continue
      try {
        const rec = parsePosWorkbook(att.content, mm.subject)
        // POS 人為誤操作有時同一天寄兩封（一封正確、一封全 0）→ 全 0 的空報表一律不入庫
        if ((Number(rec.revenue) || 0) <= 0 && (Number(rec.txCount) || 0) <= 0) continue
        // 逐筆交易附件：不論摘要是否已入庫都解析，之後回補到 tx 月檔（張良 2026-07-26：數字要能點到來源）
        const attTx = atts.find(a => /^transaction/i.test((a.filename || '').trim()))
        const tx = attTx ? parseTxSheet(attTx.content) : null
        if (tx && rec.date) txAll.push({ date: rec.date, store: rec.store, tx })
        // id 加上店代碼，兩店同日不撞 id；再用 日期|店 組合擋掉舊格式 id 的重複入庫
        rec.id = rec.id + '-' + storeKeyOf(rec.store)
        if (!have.has(rec.id) && !haveCombo.has(rec.date + '|' + storeKeyOf(rec.store)) && !found[rec.id]) found[rec.id] = rec
      } catch (_) {}
    }
  })
  // （試營運 08-10~13 種子已退役，見檔頭註記；那四天改由 syncJoya 補真值）
  let seeded = 0
  // 喬亞POS報表手動回填（同一條只增不改管線；之後真日結信/自動介接來了也不會撞）
  for (const rec of groundManualRecords()) {
    if (!have.has(rec.id) && !haveCombo.has(rec.date + '|' + storeKeyOf(rec.store)) && !found[rec.id]) { found[rec.id] = rec; seeded++ }
  }
  const add = Object.values(found)
  if (add.length) {
    // 明細按月分檔 sp_finance_pm_pos_d_YYYY-MM（已存在的日期不覆蓋＝只增不改）
    const byMonth = {}
    for (const r of add) { if (r.date && r._details) (byMonth[r.date.slice(0, 7)] = byMonth[r.date.slice(0, 7)] || []).push(r) }
    for (const [mo, recs] of Object.entries(byMonth)) {
      const did = 'sp_finance_pm_pos_d_' + mo
      const doc = (await kvGet(did)) || { days: {} }
      let changed = false
      // 明細 key＝日期::店代碼（雙店同日不互蓋）；舊資料是純日期 key，若同店同日已存在（不論新舊格式）都不覆蓋
      for (const r of recs) {
        const dk = r.date + '::' + storeKeyOf(r.store)
        const legacy = doc.days[r.date] && storeKeyOf(doc.days[r.date].store) === storeKeyOf(r.store)
        if (!doc.days[dk] && !legacy) { doc.days[dk] = { date: r.date, period: r.period, store: r.store, sheets: r._details, ...(r.seedVer ? { seedVer: r.seedVer } : {}) }; changed = true }
      }
      if (changed) { doc.updatedAt = new Date().toISOString(); await kvPut(did, doc, 'POS明細自動入庫') }
    }
    store.entries = [...store.entries, ...add.map(({ _details, ...r }) => r)].sort((a, b) => (a.date < b.date ? -1 : 1))
    store.updatedAt = new Date().toISOString()
    await kvPut('sp_finance_pm_pos', store, 'POS日結自動收信')
  }
  // （種子明細版本升級已隨 _ground-seed.js 退役）
  const seedUpgraded = 0
  // 逐筆交易另存 tx 月檔（sp_finance_pm_pos_tx_YYYY-MM）：跟 _d_ 分開＝前端點下鑽才載、不拖慢日常載入
  // 只增不改：該日已有 tx 就不覆蓋；舊日期只要信還在信箱就會回補
  let txPatched = 0
  const txByMonth = {}
  for (const t of txAll) (txByMonth[t.date.slice(0, 7)] = txByMonth[t.date.slice(0, 7)] || []).push(t)
  for (const [mo, recs] of Object.entries(txByMonth)) {
    const tid = 'sp_finance_pm_pos_tx_' + mo
    const doc = (await kvGet(tid)) || { days: {} }
    let changed = false
    for (const t of recs) {
      const dk = t.date + '::' + storeKeyOf(t.store)
      if (!doc.days[dk]) { doc.days[dk] = { date: t.date, store: t.store, tx: t.tx }; changed = true; txPatched++ }
    }
    if (changed) { doc.updatedAt = new Date().toISOString(); await kvPut(tid, doc, 'POS逐筆交易入庫') }
  }
  return { scanned, added: add.length, seeded, seedUpgraded, total: store.entries.length, txParsed: txAll.length, txPatched, txCols: txAll[0]?.tx?.h || null }
}

// 共用回填插入（手動回填口＋喬亞自動抓取共用；同 syncPos 口徑：id 與 日期|店 都去重、明細月檔不覆蓋）
async function ingestPosRecords(recs, editor) {
  const skOf2 = (n) => /groun/i.test(n || '') ? 'ground' : 'abeach'
  const store = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
  const have = new Set(store.entries.map(e => e.id)), haveCombo = new Set(store.entries.map(e => e.date + '|' + skOf2(e.store)))
  const add = recs.filter(r => { const id = r.id || ('pos-' + r.date.replace(/-/g, '') + 'ingest-' + skOf2(r.store)); r.id = id; return !have.has(id) && !haveCombo.has(r.date + '|' + skOf2(r.store)) })
  const byMonth = {}
  for (const r of add) { if (r._details) (byMonth[r.date.slice(0, 7)] = byMonth[r.date.slice(0, 7)] || []).push(r) }
  for (const [mo, list] of Object.entries(byMonth)) {
    const did = 'sp_finance_pm_pos_d_' + mo
    const doc = (await kvGet(did)) || { days: {} }
    let ch = false
    for (const r of list) { const dk = r.date + '::' + skOf2(r.store); if (!doc.days[dk] && !(doc.days[r.date] && skOf2(doc.days[r.date].store) === skOf2(r.store))) { doc.days[dk] = { date: r.date, period: r.period, store: r.store, sheets: r._details }; ch = true } }
    if (ch) { doc.updatedAt = new Date().toISOString(); await kvPut(did, doc, editor) }
  }
  if (add.length) {
    store.entries = [...store.entries, ...add.map(({ _details, ...r }) => r)].sort((a, b) => (a.date < b.date ? -1 : 1))
    store.updatedAt = new Date().toISOString()
    await kvPut('sp_finance_pm_pos', store, editor)
  }
  return { received: recs.length, added: add.length, skippedAsDup: recs.length - add.length, total: store.entries.length }
}

// GROUN:D 喬亞行動報表自動抓取（張良 2026-08-26）：每次 cron 跑，補「昨天以前 N 天」還沒入庫的日子
// 只抓昨天以前（今天營業中、只增不改不能提早凍結）；營收 0 的公休日不入庫
async function syncJoya(daysBack) {
  if (!process.env.JOYA_USER) return { skipped: '未設 JOYA_* 環境變數' }
  const store = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
  const today = taipeiToday()
  // 盤中記錄到期清理（joya-intraday.js 寫入的 intraday 記錄）：昨天以前的、或今天已過結帳時間的
  // → 刪掉當「缺日」由下面正常流程重抓＝盤中數字絕不會凍成最終值
  const stale = store.entries.filter(e => e.intraday && /groun/i.test(e.store || '') && (e.date < today || (e.date === today && taipeiAfterClose())))
  if (stale.length) {
    store.entries = store.entries.filter(e => !stale.includes(e))
    store.updatedAt = new Date().toISOString()
    await kvPut('sp_finance_pm_pos', store, '盤中記錄到期換正式值')
    for (const e of stale) {
      const did = 'sp_finance_pm_pos_d_' + e.date.slice(0, 7)
      const doc = (await kvGet(did)) || { days: {} }
      if (doc.days[e.date + '::ground']?.intraday) { delete doc.days[e.date + '::ground']; doc.updatedAt = new Date().toISOString(); await kvPut(did, doc, '盤中記錄到期換正式值') }
    }
  }
  const haveCombo = new Set(store.entries.map(e => e.date + '|' + (/groun/i.test(e.store || '') ? 'ground' : 'abeach')))
  const t0 = new Date(today + 'T00:00:00Z').getTime()
  const dates = []
  // 張良 2026-08-26：營業 11-19、19:30 可結帳 → 過 19:30 連「今天」一起抓（當天晚上數字就進系統）
  for (let i = taipeiAfterClose() ? 0 : 1; i <= daysBack; i++) dates.push(new Date(t0 - i * 86400000).toISOString().slice(0, 10))
  const need = dates.filter(d => !haveCombo.has(d + '|ground'))
  let cookie = null
  const recs = []; let closed = 0
  if (need.length) {
    cookie = await joyaLogin()
    for (const d of need) {
      const day = await joyaFetchDay(cookie, d)
      if (day.empty) { closed++; continue }
      recs.push(joyaBuildRecord(day))
    }
  }
  const out2 = recs.length ? await ingestPosRecords(recs, '喬亞行動報表自動抓取') : { added: 0 }
  // 舊日子補時段表（手動回填/試營運日入庫時沒有時段）：只加這張表、其他資料不動（只增不改）
  let slotPatched = 0
  const detCache = {}
  for (const d of dates.filter(d2 => haveCombo.has(d2 + '|ground'))) {
    try {
      const did = 'sp_finance_pm_pos_d_' + d.slice(0, 7)
      const doc = detCache[did] = detCache[did] || (await kvGet(did)) || { days: {} }
      const dk = doc.days[d + '::ground'] ? d + '::ground' : (doc.days[d] && /groun/i.test(doc.days[d].store || '') ? d : null)
      if (!dk || doc.days[dk].sheets?.[TIMESLOT_SHEET]) continue
      cookie = cookie || await joyaLogin()
      const slots = await joyaFetchTimeslots(cookie, d)
      if (!slots.length) continue
      doc.days[dk].sheets = { ...(doc.days[dk].sheets || {}), [TIMESLOT_SHEET]: [timeslotSection(slots)] }
      doc.updatedAt = new Date().toISOString()
      await kvPut(did, doc, '喬亞時段補齊')
      slotPatched++
    } catch (_) {}
  }
  return { checked: dates.length, needed: need.length, closedDays: closed, slotPatched, staleIntraday: stale.length, ...out2 }
}

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(200).json({ ok: false, error: '缺 Supabase 設定' })
  // 診斷探針（只回結構統計，不回金額/內容——端點公開，保守）：?txprobe=YYYY-MM-DD
  if (req.query?.txprobe) {
    const dt = String(req.query.txprobe)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) return res.status(400).json({ ok: false })
    const doc = (await kvGet('sp_finance_pm_pos_tx_' + dt.slice(0, 7))) || { days: {} }
    const out2 = {}
    for (const [dk, day] of Object.entries(doc.days)) {
      if (!dk.startsWith(dt)) continue
      const t = day.tx || {}
      const si = (t.h || []).findIndex(h => /狀態|status/i.test(h))
      const statuses = {}
      ;(t.r || []).forEach(row => { const s = si >= 0 ? String(row[si] || '—') : '—'; statuses[s] = (statuses[s] || 0) + 1 })
      out2[dk] = { rows: (t.r || []).length, statuses, voidLike: (t.r || []).filter(row => row.some(c => /void|作廢|退菜|退單|取消|refund/i.test(String(c)))).length }
    }
    return res.status(200).json({ ok: true, probe: dt, days: out2 })
  }
  // 手動回填口（POST＋金鑰，張良 2026-08-24：喬亞POS寄信開通前，回填不用再部署）：
  // POST ?ingest=<MENU_PROBE_KEY>，body={records:[record…]}，record 形狀同日結信入庫（date/store/revenue/…/_details 選填）
  // 同一條只增不改管線：id 與 日期|店 都去重，之後寄信自動化來了也不會撞
  if (req.method === 'POST' && req.query?.ingest) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.ingest) !== mk) return res.status(403).json({ ok: false })
    let recs = []
    try { recs = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body)?.records || [] } catch (_) {}
    if (!Array.isArray(recs) || !recs.length || recs.length > 40) return res.status(400).json({ ok: false, error: 'records 空或超過40筆' })
    for (const r of recs) { if (!/^\d{4}-\d{2}-\d{2}$/.test(r?.date || '') || !r?.store || typeof r?.revenue !== 'number') return res.status(400).json({ ok: false, error: '每筆要有 date/store/revenue', bad: r?.date }) }
    const out2 = await ingestPosRecords(recs, 'POS手動回填口')
    await announceChanged() // 開著的網頁即刻自動跟上
    return res.status(200).json({ ok: true, ...out2 })
  }
  // 任務搬移口（同金鑰，張良 2026-09-01：D哥把 14 筆記到工程空間，要搬到團隊工作）：
  // ?taskmove=<key>&from=ISO&to=ISO[&dry=1] → 把工程空間收件匣、createdAt 落在 [from,to] 的任務
  // 搬到團隊工作空間（sp_team_pm_task_*），原工程檔刪除。dry=1 只列清單不動資料，先看再搬。
  if (req.query?.taskmove) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.taskmove) !== mk) return res.status(403).json({ ok: false })
    const from = String(req.query.from || ''), to = String(req.query.to || '')
    if (!from || !to) return res.status(400).json({ ok: false, error: '要帶 from=ISO&to=ISO（比對任務 createdAt）' })
    // 撈工程空間逐筆任務：LIKE 的 _ 是萬用字元會誤匹配（pm_tasks）→ 用範圍過濾（'`'＝'_'+1，pm_tasks 的 s 在範圍外）
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=gte.pm_task_&id=lt.pm_task%60&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows = r.ok ? await r.json() : []
    const all = []
    rows.forEach((row) => { try { const t = JSON.parse(row.data.v); if (t && t.id) all.push({ key: row.id, t }) } catch (_) {} })
    const hit = all.filter(({ t }) => t.catId === '__inbox__' && t.createdAt >= from && t.createdAt <= to)
    if (String(req.query.dry || '')) return res.status(200).json({ ok: true, dry: true, n: hit.length, tasks: hit.map(({ t }) => ({ id: t.id, title: t.title, createdAt: t.createdAt, tags: t.tags })) })
    for (const { key, t } of hit) {
      await kvPut('sp_team_pm_task_' + t.id, t, '任務搬移口')
      await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    }
    await announceChanged()
    return res.status(200).json({ ok: true, moved: hit.length, titles: hit.map(({ t }) => t.title) })
  }
  // 供應鏈匯入口（POST＋同金鑰，張良 2026-09-04：兩店產品成本計算——截圖/試算表資料貼給 AI 整理後從這裡灌入，
  // 不用在 App 一筆筆 keyin）。body={dry, ingredients:[{name,baseUnit,cat}], vendors:[{name,dept}],
  //   vendorItems:[{vendor,name,spec,unit,price,packToBase,moq,note,ingredient}], recipes:[{product,store:'AB'|'GD'|'semi',
  //   category,price,posName,ingredients:[{name,qty,unit}],subRecipes:[{name,qty}],steps,yield,yieldUnit,lossPct,keepNote,note}]}
  // 規則＝App 同一套（資料一致）：物料 normName 同名不重建；品項價格視為最近實付（更新 last，同價只刷時間不誤觸漲價警示）；
  // 食譜 append-only 存 pm_recipe_v_ 新版本；dry=true 只回報會動什麼不寫入
  if (req.method === 'POST' && req.query?.supplyingest) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.supplyingest) !== mk) return res.status(403).json({ ok: false })
    const { normName, parseSpec } = await import('../src/supply/inv.js')
    let body = {}
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) { return res.status(400).json({ ok: false, error: 'body 不是 JSON' }) }
    const arr = (k) => Array.isArray(body[k]) ? body[k] : []
    if ([...arr('ingredients'), ...arr('vendors'), ...arr('vendorItems'), ...arr('recipes')].length > 300) return res.status(400).json({ ok: false, error: '一次最多 300 筆，分批送' })
    const db = (await kvGet('sp_supply_pm_supply')) || { categories: [], products: [], materials: [], vendors: [], vendorItems: [], ingredients: [], matches: [], productPackaging: [] }
    for (const k of ['categories', 'products', 'vendors', 'vendorItems', 'ingredients']) if (!Array.isArray(db[k])) db[k] = []
    const rid2 = (p) => p + Math.random().toString(36).slice(2, 8)
    const now = new Date().toISOString()
    const rep = { created: [], updated: [], recipes: [], warn: [] }
    // ① 物料卡 upsert（normName 同名＝同卡）
    const ingBy = new Map(); db.ingredients.forEach(g => { const k = normName(g.name); if (k && !ingBy.has(k)) ingBy.set(k, g) })
    const getIng = (name, unit) => {
      const k = normName(name); if (!k) return null
      let g = ingBy.get(k)
      if (!g) {
        g = { id: rid2('g'), name: String(name).trim(), cat: '', baseUnit: /^(ml|毫升|cc|公升|升|l)$/i.test(String(unit || '')) ? 'ml' : /^(個|张|張|片|顆|支|份|pcs?)$/i.test(String(unit || '')) ? '個' : 'g', countFreq: { type: 'none', days: [], dom: 1, paused: false }, countRole: '', countUnit: '', isKey: false, safeStock: '', note: '', sort: db.ingredients.length, tags: '' }
        db.ingredients.push(g); ingBy.set(k, g); rep.created.push('物料卡：' + g.name)
      }
      return g
    }
    arr('ingredients').forEach(x => { if (!x?.name) return; const g = getIng(x.name, x.baseUnit); if (x.baseUnit) g.baseUnit = x.baseUnit; if (x.cat) g.cat = x.cat })
    // ② 廠商 upsert（同名不重建）
    const vendBy = new Map(); db.vendors.forEach(v => vendBy.set(normName(v.name), v))
    const getVend = (name) => {
      const k = normName(name); if (!k) return null
      let v = vendBy.get(k)
      if (!v) { v = { id: rid2('v'), name: String(name).trim(), dept: '共用', official: false }; db.vendors.push(v); vendBy.set(k, v); rep.created.push('廠商：' + v.name) }
      return v
    }
    arr('vendors').forEach(x => { if (!x?.name) return; const v = getVend(x.name); if (x.dept) v.dept = x.dept })
    // ③ 廠商品項 upsert：價格＝最近實付（同 applyLastPaid 規則：同價只刷時間、變價留 prevPrice 供漲價警示）
    arr('vendorItems').forEach(x => {
      if (!x?.name || !x?.vendor) return
      const v = getVend(x.vendor); if (!v) return
      let vi = db.vendorItems.find(it => it.vendor_id === v.id && normName(it.name) === normName(x.name))
      if (!vi) { vi = { id: rid2('vi'), vendor_id: v.id, name: String(x.name).trim(), spec: '', unit: '', price: '', sort: db.vendorItems.length }; db.vendorItems.push(vi); rep.created.push(`品項：${v.name}／${vi.name}`) } else rep.updated.push(`品項：${v.name}／${vi.name}`)
      if (x.spec != null) vi.spec = String(x.spec)
      if (x.unit) vi.unit = String(x.unit)
      if (x.moq != null) vi.moq = Number(x.moq) || vi.moq
      if (x.note) vi.note = String(x.note)
      const g = x.ingredient ? getIng(x.ingredient, x.unit) : getIng(x.name, x.unit)
      if (g && !vi.ingredient_id) vi.ingredient_id = g.id
      if (Number(x.packToBase) > 0) vi.packToBase = Number(x.packToBase)
      else if (!Number(vi.packToBase)) { const p2 = parseSpec(vi.spec); if (p2.packToBase) vi.packToBase = p2.packToBase }
      if (Number(x.price) > 0) {
        const p = Number(x.price); vi.price = p
        const cur = vi.last || {}
        vi.last = Number(cur.price) === p ? { ...cur, ts: now } : { price: p, ts: now, prevPrice: Number(cur.price) || 0, prevTs: cur.ts || '' }
      }
      if (!Number(vi.packToBase)) rep.warn.push(`品項「${vi.name}」缺入數換算（規格解析不出）——App 物料頁要補，不然成本算不出`)
    })
    // ④ 食譜：產品 upsert（半成品共用/成品分店）＋ 新版本 append 進 pm_recipe_v_
    const findProd = (name, store) => db.products.find(p => normName(p.name) === normName(name) && (store === 'semi' ? p.semi : (!p.semi && (p.store || 'AB') === store)))
    const newRecs = []
    arr('recipes').forEach(x => {
      if (!x?.product) return
      const store = x.store === 'GD' ? 'GD' : x.store === 'semi' ? 'semi' : 'AB'
      let p = findProd(x.product, store)
      if (!p) {
        p = { id: rid2('p'), category: x.category || (store === 'semi' ? '半成品' : '未分類'), name: String(x.product).trim(), english_name: '', price: x.price || '', note: x.note || '', is_active: true, sort: db.products.length, unit: '', tags: [], ...(store === 'semi' ? { semi: true } : { store }) }
        if (x.posName) p.posName = String(x.posName)
        db.products.push(p); rep.created.push(`產品(${store === 'semi' ? '半成品' : store})：` + p.name)
      } else { if (x.price != null && x.price !== '') p.price = x.price; if (x.posName) p.posName = String(x.posName); if (x.category) p.category = x.category }
      const lines = (Array.isArray(x.ingredients) ? x.ingredients : []).map(li => { const g = getIng(li.name, li.unit); return g && Number(li.qty) > 0 ? { ingredient_id: g.id, qty: Number(li.qty) } : null }).filter(Boolean)
      const subs = (Array.isArray(x.subRecipes) ? x.subRecipes : []).map(sr => { const sp = findProd(sr.name, 'semi'); if (!sp) { rep.warn.push(`食譜「${x.product}」引用的半成品「${sr.name}」不存在（半成品要先建/先送）`); return null } return Number(sr.qty) > 0 ? { product_id: sp.id, qty: Number(sr.qty) } : null }).filter(Boolean)
      const rec = { id: rid2('rv'), product_id: p.id, ts: now, by: 'AI匯入口', ingredients: lines, subRecipes: subs, steps: Array.isArray(x.steps) ? x.steps : String(x.steps || '').split('\n').map(s => s.trim()).filter(Boolean), yield: Number(x.yield) > 0 ? Number(x.yield) : 1, yieldUnit: String(x.yieldUnit || (store === 'semi' ? 'g' : '份')), lossPct: Number(x.lossPct) > 0 ? Number(x.lossPct) : 0, keepNote: String(x.keepNote || ''), note: String(x.note || '') }
      newRecs.push(rec); rep.recipes.push(`${p.name}（用料${lines.length}＋半成品${subs.length}）`)
    })
    if (body.dry) return res.status(200).json({ ok: true, dry: true, ...rep })
    await kvPut('sp_supply_pm_supply', db, '供應鏈匯入口')
    for (const rec of newRecs) await kvPut('sp_supply_pm_recipe_v_' + rec.id, rec, '供應鏈匯入口')
    await announceChanged()
    return res.status(200).json({ ok: true, ...rep })
  }
  // 清理口（同金鑰）：?delday=<key>&date=YYYY-MM-DD&store=ground → 刪該日摘要＋明細（只用於清誤入資料，例：公休0元日）
  if (req.query?.delday) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.delday) !== mk) return res.status(403).json({ ok: false })
    const dt = String(req.query.date || ''), stq = String(req.query.store || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || !/^(abeach|ground)$/.test(stq)) return res.status(400).json({ ok: false, error: '要帶 date=YYYY-MM-DD 與 store=abeach|ground' })
    const skOf3 = (n) => /groun/i.test(n || '') ? 'ground' : 'abeach'
    const store = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
    const before = store.entries.length
    store.entries = store.entries.filter(e => !(e.date === dt && skOf3(e.store) === stq))
    if (store.entries.length !== before) { store.updatedAt = new Date().toISOString(); await kvPut('sp_finance_pm_pos', store, 'POS清理口') }
    const did = 'sp_finance_pm_pos_d_' + dt.slice(0, 7)
    const doc = (await kvGet(did)) || { days: {} }
    let ch = false
    for (const dk of Object.keys(doc.days)) { const day = doc.days[dk]; if ((day.date || dk.slice(0, 10)) === dt && skOf3(day.store) === stq) { delete doc.days[dk]; ch = true } }
    if (ch) { doc.updatedAt = new Date().toISOString(); await kvPut(did, doc, 'POS清理口') }
    await announceChanged()
    return res.status(200).json({ ok: true, removedSummary: before - store.entries.length, removedDetail: ch })
  }
  // 資料搜尋探針（唯讀＋同金鑰，2026-09-05）：?docgrep=<key>&q=關鍵字 → 全庫文件（pm_documents.data->>v）ilike 撈出現位置前後文
  // 用途：張良問「XX有幾台/什麼時候買的/在哪」這類資料問題，本機被 RLS 擋時走這裡；只回片段不回整份文件
  if (req.query?.docgrep) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.docgrep) !== mk) return res.status(403).json({ ok: false })
    const q = String(req.query.q || '').slice(0, 40)
    if (!q) return res.status(400).json({ ok: false, error: '要帶 q=關鍵字' })
    const lr = await fetch(`${SB_URL}/rest/v1/pm_documents?select=id&data->>v=ilike.${encodeURIComponent('*' + q + '*')}&limit=60`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const ids = (lr.ok ? await lr.json() : []).map(x => x.id)
    const out2 = []
    for (const id of ids.slice(0, 30)) {
      const r2 = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      const rows2 = r2.ok ? await r2.json() : []
      const txt = rows2[0]?.data?.v || ''
      const snips = []
      let i2 = -1
      while ((i2 = txt.indexOf(q, i2 + 1)) >= 0 && snips.length < 8) { snips.push(txt.slice(Math.max(0, i2 - 90), i2 + 120)); i2 += q.length }
      out2.push({ id, hits: snips.length, snips })
    }
    return res.status(200).json({ ok: true, q, matchedDocs: ids.length, docs: out2 })
  }
  // 營收探針（唯讀＋同 MENU_PROBE_KEY 金鑰）：?revprobe=<key>&store=abeach|ground → 每日 {date, weekday, revenue}
  // 用途：張良問「某月平日/週末營業額」這類彙總，本機被 RLS 擋時走這裡拿原始日列自己算（同一份 sp_finance_pm_pos）
  if (req.query?.revprobe) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.revprobe) !== mk) return res.status(403).json({ ok: false })
    const storeQ = String(req.query.store || 'abeach')
    const skOf = (n) => /groun/i.test(n || '') ? 'ground' : 'abeach'
    const store = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
    const days2 = (store.entries || []).filter(e => skOf(e.store) === storeQ).map(e => ({ date: e.date, weekday: new Date(e.date + 'T00:00:00').getDay(), revenue: Number(e.revenue) || 0, discount: Number(e.discount) || 0 })).sort((a, b) => (a.date < b.date ? -1 : 1))
    return res.status(200).json({ ok: true, store: storeQ, n: days2.length, days: days2 })
  }
  // 工程資料探針（唯讀＋同金鑰；張良 2026-09-03：問電費要盤點工程總覽裡的空調/設備/燈光等用電項目，
  // 本機被 RLS 擋 → 走這裡撈大項/細項全清單自己整理）：?catprobe=<key>[&space=team|crew|finance，預設工程]
  if (req.query?.catprobe) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.catprobe) !== mk) return res.status(403).json({ ok: false })
    const pfx = { team: 'sp_team_', crew: 'sp_crew_', finance: 'sp_finance_' }[String(req.query.space || '')] || ''
    const cats = (await kvGet(pfx + 'pm_data')) || []
    const out2 = (Array.isArray(cats) ? cats : []).map(c => ({
      name: c.name, budget: c.budget, status: c.status,
      items: (c.items || []).map(i => ({ name: i.name, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice, taxType: i.taxType, assignee: i.assignee, status: i.status, notes: i.notes })),
    }))
    return res.status(200).json({ ok: true, space: pfx || 'construction', nCats: out2.length, cats: out2 })
  }
  // 菜單探針（唯讀＋金鑰保護，回品名/金額 → 沒帶對 MENU_PROBE_KEY 一律 403）：?menuprobe=<key>&store=abeach|ground
  // 用途：把期間內出現過的全部品項按「日結信分類」彙總（品名/數量/套餐內/金額/出現天數），給菜單盤點/試算表用
  if (req.query?.menuprobe) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.menuprobe) !== mk) return res.status(403).json({ ok: false })
    const storeQ = String(req.query.store || 'abeach')
    const skOf = (n) => /groun/i.test(n || '') ? 'ground' : 'abeach'
    // LIKE 底線要跳脫（記憶鐵則）→ 不用 like，直接撈 id 清單再前綴過濾
    const lr = await fetch(`${SB_URL}/rest/v1/pm_documents?select=id&id=gte.sp_finance_pm_pos_d_&id=lt.sp_finance_pm_pos_e`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const ids = (lr.ok ? await lr.json() : []).map(x => x.id).filter(id => /^sp_finance_pm_pos_d_\d{4}-\d{2}$/.test(id))
    const items = {} // 分類||品名 -> { cat, name, qty, combo, amt, days, first, last }
    let dayCnt = 0, from = '', to = ''
    for (const id of ids) {
      const doc = await kvGet(id); if (!doc?.days) continue
      for (const [dk, day] of Object.entries(doc.days)) {
        if (skOf(day.store) !== storeQ) continue
        const secs = (day.sheets || {})['總銷售額 (以類別分類)']; if (!Array.isArray(secs)) continue
        const date = day.date || dk.slice(0, 10)
        dayCnt++; if (!from || date < from) from = date; if (date > to) to = date
        for (const s of secs) {
          const ci = (s.header || []).indexOf('套餐內')
          for (const row of (s.rows || [])) {
            const k = (s.title || '(未分類)') + '||' + row[0]
            const it = items[k] || (items[k] = { cat: s.title || '(未分類)', name: String(row[0]), qty: 0, combo: 0, amt: 0, days: 0, first: date, last: date })
            it.qty += Number(row[1]) || 0; it.amt += Number(row[row.length - 1]) || 0
            if (ci >= 0) it.combo += Number(row[ci]) || 0
            it.days++; if (date < it.first) it.first = date; if (date > it.last) it.last = date
          }
        }
      }
    }
    return res.status(200).json({ ok: true, store: storeQ, months: ids.map(i => i.slice(-7)), dayCnt, from, to, items: Object.values(items) })
  }
  const days = Math.min(120, Math.max(1, parseInt(req.query?.days || '3', 10) || 3)) // 每小時 cron 跑近3天(增量)；手動可帶 ?days=N
  const out = { ok: true, days }
  try { out.ctbc = await syncCtbc(days) } catch (e) { out.ctbc = { error: e?.message || String(e) } }
  try { out.pos = await syncPos(days) } catch (e) { out.pos = { error: e?.message || String(e) } }
  try { out.joya = await syncJoya(Math.min(days, 20)) } catch (e) { out.joya = { error: e?.message || String(e) } } // GROUN:D 喬亞自動抓（?days=N 可回補 N 天）
  // 參考店1/2（iCHEF，2026-09-01）：後台即時＝今天的數字每次抓都是「到目前為止」→ 手動🔄/每小時 cron 都只掃近3天（快），?days=N 可回補
  try { out.ic = await syncIchef(kvGet, kvPut, Math.min(60, Math.max(3, days))) } catch (e) { out.ic = { error: e?.message || String(e) } }
  try { out.ab = await syncEatsLive(kvGet, kvPut) } catch (e) { out.ab = { error: e?.message || String(e) } } // AB 即時（白天看今天；日結信到就被正式資料接手）
  await announceChanged() // 有新資料入庫→通知所有開著的網頁自動重抓（沒新資料就不發）
  if (req.query?.debug) out.dbg = DBG
  return res.status(200).json(out)
}
