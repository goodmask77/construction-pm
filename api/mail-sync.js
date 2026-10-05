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
import { joyaLogin, joyaFetchDay, joyaBuildRecord, taipeiToday, taipeiAfterClose, joyaFetchTimeslots, timeslotSection, TIMESLOT_SHEET, joyaFetchSalesMethod, parseSalesMethod } from './_joya.js' // GROUN:D POS行動報表自動抓取（2026-08-26 起全自動）
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
// ── 盤點/包材理論庫存（張良 2026-09-21）：預估現量＝最後盤點量 −（盤點後的銷售×每份用量）
// 盤點時間 <11:00（開店前）→ 含盤點當天的銷售；否則（打烊後）→ 從隔天起算。export 給 joya-intraday 低水位提醒共用
export async function invStatus(kind) {
  const doc = (await kvGet('sp_finance_pm_inv')) || {}
  const kd = doc[kind] || { items: [], counts: {} }
  const items = kd.items || []
  if (!items.length) return { items: [] }
  const counts = kd.counts || {}
  let minDate = null
  for (const it of items) { const last = (counts[it.id] || [])[0]; if (last) { const d0 = last.ts.slice(0, 10); if (!minDate || d0 < minDate) minDate = d0 } }
  const salesByKey = {}, catSales = {}
  if (minDate) {
    const pos = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
    const dates = (pos.entries || []).filter(e => /groun/i.test(e.store || '') && e.date >= minDate).map(e => e.date)
    const mos = [...new Set(dates.map(d => d.slice(0, 7)))]
    const dets = {}
    await Promise.all(mos.map(async m => { dets[m] = await kvGet('sp_finance_pm_pos_d_' + m) }))
    const amap = ((await kvGet('sp_finance_pm_pos_alias')) || {}).ground || {}
    for (const dd of dates) {
      const dmap = (dets[dd.slice(0, 7)] || {}).days || {}
      const day = dmap[`${dd}::ground`] || dmap[dd]
      const secs = day && day.sheets && day.sheets['總銷售額 (以類別分類)']
      if (!Array.isArray(secs)) continue
      for (const s of secs) {
        if (s.title === '總結' || s.title === '套餐') continue
        for (const r of (s.rows || [])) {
          if (!Array.isArray(r) || typeof r[0] !== 'string' || /^1\/4/.test(r[0].trim())) continue
          const k = amap[r[0]] || r[0]
          const q = Number(r[1]) || 0
          ;(salesByKey[k] = salesByKey[k] || {})[dd] = (salesByKey[k][dd] || 0) + q
          ;(catSales[s.title] = catSales[s.title] || {})[dd] = (catSales[s.title][dd] || 0) + q
        }
      }
    }
  }
  const out = items.map(it => {
    const last = (counts[it.id] || [])[0] || null
    let used = null, est = null
    if (last) {
      const cd = last.ts.slice(0, 10), hh = Number(last.ts.slice(11, 13) || 99)
      const inclSame = hh < 11 // 開店前盤點→盤點當天的銷售也要扣
      used = 0
      for (const ln of (it.links || [])) {
        const src = ln.type === 'cat' ? catSales[ln.key] : salesByKey[ln.key]
        if (!src) continue
        for (const [dd, q] of Object.entries(src)) { if (dd > cd || (inclSame && dd === cd)) used += q * (Number(ln.per) || 0) }
      }
      used = Math.round(used * 10) / 10
      est = Math.round(((Number(last.qty) || 0) - used) * 10) / 10
    }
    return { ...it, last, used, est, low: est != null && it.min > 0 && est <= it.min }
  })
  return { items: out }
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
export async function ingestPosRecords(recs, editor) { // export：boss-sync.js fillpos（AB 4~6月營收回填）共用
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
 try { // v4.52.4 總兜底（張良「儲存失敗 檢查問題」）：原本 handler 沒有 try/catch，任一行 throw(Supabase/LINE 瞬斷…)就噴 HTML 500→前端 r.json() 解析失敗→一律顯示「儲存失敗」看不出原因。改成任何未捕捉錯誤都回可讀 JSON
  if (!SB_URL || !SB_KEY) return res.status(200).json({ ok: false, error: '缺 Supabase 設定' })
  let _lastBound = false // v4.31.0（張良：擋下來的訊息要分「沒登入」跟「沒權限」）：sopWho 每次順手記「這個 token 有沒有綁定」
  const sopWho = async (tk3) => {
    _lastBound = false
    if (!tk3) return null
    const b = (await kvGet('sp_finance_pm_prep_bind')) || {}
    const w = (b.tokens || {})[tk3]
    if (!w) return null
    let role = '一般'
    try { const r5 = (await kvGet('sp_crew_kb_roster')) || {}; const p5 = (r5.people || []).find(x => x.id === w.rid); if (p5 && p5.gdRole) role = p5.gdRole } catch (_) {}
    if (role === '停權') return null
    _lastBound = true
    // v4.32.0 模擬檢視（張良：切換不同使用者，確認每人看到的畫面/權限都對）：管理者 GET 帶 &as=rid ＝用「那個人」的身分讀資料
    // 只收 GET＝只能看不能改（寫入都是 POST，永遠用本人身分守門）；as=guest 模擬未綁定訪客；非管理者帶 as 一律當沒看到
    const as9 = req.method === 'GET' ? String(req.query?.as || '') : ''
    if (as9) {
      const pmS = (await kvGet('sp_finance_pm_prep_perm')) || { users: {} }
      const uS = (pmS.users || {})[w.rid || w.uid]
      if (uS && uS.admin) {
        if (as9 === 'guest') { _lastBound = false; return null }
        const t9 = Object.values(b.tokens || {}).find(x => (x.rid || x.uid) === as9)
        const nm9 = (t9 && t9.name) || ((pmS.users || {})[as9] || {}).name
        if (nm9) {
          let role9 = '一般'
          try { const r9 = (await kvGet('sp_crew_kb_roster')) || {}; const p9 = (r9.people || []).find(x => x.id === as9); if (p9 && p9.gdRole) role9 = p9.gdRole } catch (_) {}
          return { ...(t9 || {}), rid: as9, name: nm9, role: role9 }
        }
      }
    }
    return { ...w, role }
  }
  // v4.31.0 擋人時的話要講對（張良抓包：已綁定的人被擋還叫他「綁定GD」很莫名）：
  // 有綁定＝權限問題→找張良開；沒綁定＝登入問題→點自己的個人連結（DD 會再發）
  const permDeny = () => _lastBound
    ? '你還沒有這一頁的編輯權限——請找張良申請開通（核准後就能編輯）'
    : '還沒登入——私訊 DD「登入碼」拿 4 位數，App 按右上「登入」填入（或點 DD 給你的個人連結）'
  // 編輯守門（張良 2026-10-02：趙以棠還沒核准就能編 SOP——全部寫入端點掛上）：approve 模式要「已核准＋該分頁有勾」
  const permWho = async (tk9, tab9) => {
    const pm9 = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }
    const w9 = await sopWho(tk9)
    if (pm9.mode !== 'approve') return w9 || { name: '現場(未綁定)' }
    const u9 = w9 && pm9.users[w9.rid || w9.uid]
    return (u9 && u9.edit && (u9.admin || !u9.tabs || u9.tabs[tab9] !== 0)) ? w9 : null
  }
  // v4.32.1 新核准的人自動套「團隊共同設定」（張良抓包：林碧昱剛核准＝全開預設，班表能編+設定看得到，跟其他人不一致）
  // 規則：現有非管理者「大家都關」的分頁才關（tabs[k]===0 全員一致→0；hide[k]=1 全員一致→藏），其餘照舊全開
  const prepPermTmpl = (pm9) => {
    const ns = Object.values(pm9.users || {}).filter(u => !u.admin && (u.tabs || u.hide)) // 只看「有設定過的人」——否則沒設定的新人自己會害「全員一致」永遠不成立
    if (!ns.length) return {}
    const keys = new Set(); ns.forEach(u => { Object.keys(u.tabs || {}).forEach(k => keys.add(k)); Object.keys(u.hide || {}).forEach(k => keys.add(k)) })
    const tabs = {}, hide = {}
    for (const k of keys) {
      if (ns.every(u => u.tabs && u.tabs[k] === 0)) tabs[k] = 0
      if (ns.every(u => u.hide && u.hide[k] === 1)) hide[k] = 1
    }
    const o = {}; if (Object.keys(tabs).length) o.tabs = tabs; if (Object.keys(hide).length) o.hide = hide; return o
  }
  // 📱 個人化 manifest（v4.31.2 張良：換 icon 重加 App 變訪客——iOS 刪掉重加＝儲存清空，token 跟著掉）
  // 已綁定的人開 /prep → 前端把 manifest 換成這支 → start_url 帶 ?me=token → 加入主畫面的捷徑自帶身分，重加也不會掉
  // token 先驗真（sopWho）：無效/停權就回乾淨版，不把壞 token 烙進捷徑
  if (req.query?.manifest) {
    const me8 = String(req.query.me || '').replace(/[^A-Za-z0-9_-]/g, '')
    let su8 = '/prep'
    if (me8) { try { const w8 = await sopWho(me8); if (w8) su8 = '/prep?me=' + me8 } catch (_) {} }
    res.setHeader('Content-Type', 'application/manifest+json')
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({
      name: 'GD', short_name: 'GD', start_url: su8, scope: '/', display: 'standalone',
      background_color: '#FFFFFF', theme_color: '#087EBA',
      icons: [
        { src: '/ops/icon-192.png?v=2', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/ops/icon-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'any' }
      ]
    })
  }
  // 🔢 四位數登入碼兌換（v4.31.3 張良：綁定碼太麻煩）：DD 私訊「登入碼」發 4 位數 → App「登入」輸入 → 這裡換回 token
  // 防暴力猜碼：全域 10 分鐘內錯 15 次就鎖（碼本身 10 分鐘過期＋單次使用，風險窗很小）
  if (req.query?.bindcode) {
    const cd7 = String(req.query.bindcode).replace(/\D/g, '')
    const doc7 = (await kvGet('sp_finance_pm_prep_logincode')) || { codes: {} }
    const now7 = Date.now()
    doc7.fails = (doc7.fails || []).filter(t => now7 - t < 10 * 60e3)
    if (doc7.fails.length >= 15) return res.status(200).json({ ok: false, error: '試太多次了，請過 10 分鐘再試，或改貼個人連結' })
    const hit7 = (doc7.codes || {})[cd7]
    if (!cd7 || !hit7 || hit7.exp < now7) {
      doc7.fails.push(now7)
      await kvPut('sp_finance_pm_prep_logincode', doc7, 'bindcode')
      return res.status(200).json({ ok: false, error: '登入碼錯誤或已過期——私訊 DD「登入碼」再拿一組新的' })
    }
    delete doc7.codes[cd7] // 單次使用：換完即失效
    await kvPut('sp_finance_pm_prep_logincode', doc7, 'bindcode')
    return res.status(200).json({ ok: true, me: hit7.tk })
  }
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
  // 任務補建口（同金鑰，張良 2026-09-17：DD 在群組「假完成」7 件任務——群組唯讀但 AI 演成建好了。
  // webhook 已治本；這口把當天答應的 7 件補真的建進團隊空間）：?taskfill=<key>[&dry=1]，用標題去重可重跑
  if (req.query?.taskfill) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.taskfill) !== mk) return res.status(403).json({ ok: false })
    const bid2 = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const cats = (await kvGet('sp_team_pm_data')) || []
    let sysCat = cats.find(c => c.name === '系統設備')
    const dry = !!String(req.query.dry || '')
    if (!sysCat && !dry) { sysCat = { id: 'cat-' + bid2(''), order: cats.length, name: '系統設備', budget: 0, status: 'pending', items: [] }; cats.push(sysCat); await kvPut('sp_team_pm_data', cats, '任務補建口') }
    const toolCat = cats.find(c => c.name === '採購-器具'), formCat = cats.find(c => c.name === '表單')
    const FILL = [
      { title: 'KDS 是否導入（待討論）', note: '缺細節：哪間店、卡點（成本／POS整合／流程）。可等 POS 延遲/退單釐清後一起評估，KDS 可能就是解法之一。', cat: sysCat },
      { title: 'POS 退單問題', note: '退單會出另一張不同號碼的單、KDS 也會顯示；正餐期炸單容易誤做到退單、貼紙已出要人進去撕。待討論更好的處理方式（9/15 小夏、Zoey 提的）。', cat: sysCat },
      { title: 'POS 系統延遲', note: '法蘭回饋。待確認是硬體還是系統問題、廠商是否處理中。直接拖累正餐期出餐與退單誤做，建議優先。', cat: sysCat, priority: 'urgent' },
      { title: 'POS 套餐點法', note: '是否一定要預設餐點再改。', cat: sysCat },
      { title: '出單機／叫料提醒', note: '「單子沒了不會叫，打開機器才叫」。待張良確認是出單機紙張還是叫貨庫存提醒。', cat: sysCat },
      { title: '奶油滾輪改刷子', note: '缺規格/數量/店別。', cat: toolCat },
      { title: '廁所告示說明', note: 'owner 夏傳程；缺店別/數量。', cat: formCat, owner: '夏傳程' },
    ]
    const pat2 = 'sp_team_pm_task_'.replace(/[\\%_]/g, (m) => '\\' + m) // LIKE 的 _ 是萬用字元要跳脫（同 supplyreset 寫法）
    const r2 = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(pat2)}*&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows2 = r2.ok ? await r2.json() : []
    const exist = []; rows2.forEach(row => { try { exist.push(JSON.parse(row.data.v)) } catch (_) {} })
    const have = new Set(exist.map(t => t.title))
    let mo = 0; exist.forEach(x => { if (typeof x.ord === 'number' && x.ord < mo) mo = x.ord })
    const made = [], skipped = []
    for (const f of FILL) {
      if (have.has(f.title)) { skipped.push(f.title); continue }
      if (dry) { made.push(f.title); continue }
      const nid = 't-' + bid2(''); mo -= 1
      const row = { id: nid, title: f.title, note: f.note || '', status: 'todo', catId: f.cat ? f.cat.id : '__inbox__', start: '', due: '', priority: f.priority || 'normal', tags: [], ord: mo, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      if (f.owner) row.owner = f.owner
      await kvPut('sp_team_pm_task_' + nid, row, '任務補建口')
      made.push(`${f.title} → ${f.cat ? f.cat.name : '收件匣'}`)
    }
    if (!dry) await announceChanged()
    return res.status(200).json({ ok: true, dry, made, skipped, taskTotal: exist.length + (dry ? 0 : made.length) })
  }
  // 供應鏈資料重置口（同金鑰，張良 2026-09-07：「不想要之前的版本、包材舊資料也不要，全部刪掉重做」）
  // 保留＝價格歷史(pm_ph_)出現過的廠商+品項、半成品產品+其食譜+引用到的物料卡、settings/驗收選項；其餘（舊包材庫/包材綁定/舊菜單產品/類別/舊食譜版本/孤兒物料卡/不在叫貨資料的廠商）全清
  // 安全網：動手前整包舊 db 備份到 sp_supply_pm_supply_bak_<日期>；?dry=1 只回報不動
  if (req.query?.supplyreset) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.supplyreset) !== mk) return res.status(403).json({ ok: false })
    const dry = !!String(req.query.dry || '')
    const db = (await kvGet('sp_supply_pm_supply')) || {}
    // 前綴撈列（照 line-webhook kvGetPrefix 的驗證過寫法：LIKE 底線要跳脫，不然 _ 是萬用字元）
    const fetchRange = async (pfx) => {
      const pattern = pfx.replace(/[\\%_]/g, (m) => '\\' + m)
      const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(pattern)}*&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      return r.ok ? await r.json() : []
    }
    // 保留集合＝價格歷史出現過的 (廠商,品項)
    const phDocs = await fetchRange('sp_supply_pm_ph_')
    const keepPair = new Set(), keepVend = new Set()
    phDocs.forEach(row => { try { (JSON.parse(row.data.v).rows || []).forEach(x => { keepPair.add(`${x.vendor}||${x.item}`); keepVend.add(x.vendor) }) } catch (_) {} })
    const vname2 = (vid) => ((db.vendors || []).find(v => v.id === vid) || {}).name || ''
    const vendors2 = (db.vendors || []).filter(v => keepVend.has(v.name))
    const vendorItems2 = (db.vendorItems || []).filter(vi => keepPair.has(`${vname2(vi.vendor_id)}||${vi.name}`))
    const products2 = (db.products || []).filter(p => p.semi)
    const keepProd = new Set(products2.map(p => p.id))
    // 食譜版本：半成品的留、舊產品的刪
    const recRows = await fetchRange('sp_supply_pm_recipe_v_')
    const recDel = [], refIng = new Set()
    recRows.forEach(row => {
      try {
        const rec = JSON.parse(row.data.v)
        if (keepProd.has(rec.product_id)) (rec.ingredients || []).forEach(li => refIng.add(li.ingredient_id))
        else recDel.push(row.id)
      } catch (_) { recDel.push(row.id) }
    })
    ;(vendorItems2 || []).forEach(vi => { if (vi.ingredient_id) refIng.add(vi.ingredient_id) })
    const ingredients2 = (db.ingredients || []).filter(g => refIng.has(g.id) || g.costFree)
    const next = {
      categories: [], products: products2, materials: [], vendors: vendors2, vendorItems: vendorItems2,
      ingredients: ingredients2, matches: [], productPackaging: [],
      settings: db.settings || {}, ...(db.inspectOpts ? { inspectOpts: db.inspectOpts } : {}),
    }
    const rep0 = {
      removed: {
        vendors: (db.vendors || []).length - vendors2.length, vendorItems: (db.vendorItems || []).length - vendorItems2.length,
        products: (db.products || []).length - products2.length, ingredients: (db.ingredients || []).length - ingredients2.length,
        materials: (db.materials || []).length, productPackaging: (db.productPackaging || []).length, categories: (db.categories || []).length,
        recipeVersions: recDel.length,
      },
      kept: { vendors: vendors2.length, vendorItems: vendorItems2.length, semiProducts: products2.length, ingredients: ingredients2.length },
      removedVendors: (db.vendors || []).filter(v => !keepVend.has(v.name)).map(v => v.name),
    }
    if (dry) return res.status(200).json({ ok: true, dry: true, ...rep0 })
    await kvPut('sp_supply_pm_supply_bak_' + new Date().toISOString().slice(0, 10), db, '重置前備份')
    await kvPut('sp_supply_pm_supply', next, '供應鏈重置口')
    for (const id of recDel) await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const eid = 'sp_supply_pm_editlog_' + new Date().toISOString().slice(0, 7)
    const el = (await kvGet(eid)) || { rows: [] }
    el.rows.push({ ts: new Date().toISOString(), by: '重置口', kind: 'reset', name: '供應鏈資料重置', from: `${(db.vendorItems || []).length}品項/${(db.products || []).length}產品`, to: `${vendorItems2.length}品項/${products2.length}半成品（備份 bak_${new Date().toISOString().slice(0, 10)}）` })
    await kvPut(eid, el, '供應鏈重置口')
    await announceChanged()
    return res.status(200).json({ ok: true, ...rep0 })
  }
  // 菜單英文批次上架口（同金鑰；張良 2026-10-01 英文都直接上）：POST ?menuen=<key> {map:{中文:英文}}
  if (req.method === 'POST' && req.query?.menuen) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.menuen) !== mk) return res.status(403).json({ ok: false })
    let mb = {}; try { mb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const map = mb.map || {}
    const doc = (await kvGet('sp_finance_pm_menu')) || {}
    if (Array.isArray(mb.imgs)) doc.imgs = mb.imgs.slice(0, 4) // 菜單設計圖四格（張良 2026-10-02）
    let n = 0, missed = []
    for (const s2 of ((doc.draft || {}).sections || [])) for (const i2 of (s2.items || [])) {
      const en = map[i2.name] || map[(i2.name || '').trim()]
      if (en) { i2.en = String(en).slice(0, 80); n++ } else if (!i2.en) missed.push(i2.name)
    }
    doc.edits = [{ by: 'AI代操', ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: '英文批次上架 ' + n + ' 項' }, ...(doc.edits || [])].slice(0, 30)
    await kvPut('sp_finance_pm_menu', doc, '菜單英文批次(AI代操)')
    return res.status(200).json({ ok: true, set: n, missed })
  }
  // 菜單分類備註清理口（張良 2026-10-02「主餐文字那些備註都消失」）：POST ?menunote=<key> {clear:1}=全清 或 {map:{分類名:新備註}}
  if (req.method === 'POST' && req.query?.menunote) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.menunote) !== mk) return res.status(403).json({ ok: false })
    let nb = {}; try { nb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const doc = (await kvGet('sp_finance_pm_menu')) || {}
    let nC = 0
    for (const s2 of ((doc.draft || {}).sections || [])) {
      if (nb.clear) { if (s2.note) { s2.note = ''; nC++ } }
      else if (nb.map && nb.map[s2.name] != null) { s2.note = String(nb.map[s2.name]).slice(0, 60); nC++ }
    }
    doc.edits = [{ by: 'AI代操', ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: '分類備註清理 ' + nC + ' 類' }, ...(doc.edits || [])].slice(0, 30)
    await kvPut('sp_finance_pm_menu', doc, '菜單備註清理(AI代操)')
    return res.status(200).json({ ok: true, n: nC })
  }
  // 菜單品項搬分類口（同金鑰；張良用對話叫 AI 搬，例：湯移到飲料區）：?menumv=<key>&item=品名&to=目標分類（模糊比對）
  if (req.query?.menumv) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.menumv) !== mk) return res.status(403).json({ ok: false })
    const itemQ = String(req.query.item || ''), toQ = String(req.query.to || '')
    const doc = (await kvGet('sp_finance_pm_menu')) || {}
    const secs = ((doc.draft || {}).sections) || []
    let moved = null
    const tgt = secs.find(s2 => (s2.name || '').includes(toQ))
    if (!tgt) return res.status(400).json({ ok: false, error: '找不到目標分類', sections: secs.map(s2 => s2.name) })
    for (const s2 of secs) {
      const i = (s2.items || []).findIndex(i2 => (i2.name || '').includes(itemQ))
      if (i >= 0 && s2 !== tgt) { moved = s2.items.splice(i, 1)[0]; tgt.items = tgt.items || []; tgt.items.push(moved); break }
    }
    if (!moved) return res.status(400).json({ ok: false, error: '找不到品項或已在目標分類' })
    await kvPut('sp_finance_pm_menu', doc, '菜單搬移口(AI代操)')
    return res.status(200).json({ ok: true, moved: moved.name, to: tgt.name })
  }
  // 價格歷史匯入口（POST＋同金鑰，張良 2026-09-06 供應鏈重建 P1：把「叫貨價格浮動追蹤」5,378 筆歷史搬進 App 當活資料）
  // body={dry, rows:[{d:'YYYY-MM-DD',vendor,item,unit,p,q,src}]}；存月檔 sp_supply_pm_ph_YYYY-MM={rows:[…]}，
  // 以 d|vendor|item 去重（重送冪等）；之後驗收/匯入的新價自動 append 同一庫——價格追蹤頁全吃這裡
  if (req.method === 'POST' && req.query?.phingest) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.phingest) !== mk) return res.status(403).json({ ok: false })
    let body = {}
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) { return res.status(400).json({ ok: false, error: 'body 不是 JSON' }) }
    const rows = Array.isArray(body.rows) ? body.rows : []
    if (!rows.length || rows.length > 8000) return res.status(400).json({ ok: false, error: 'rows 空或超過 8000 筆' })
    for (const r of rows) { if (!/^\d{4}-\d{2}-\d{2}$/.test(r?.d || '') || !r?.vendor || !r?.item || !(Number(r?.p) > 0)) return res.status(400).json({ ok: false, error: '每筆要有 d/vendor/item/p', bad: r }) }
    const byMo = {}
    rows.forEach(r => { const mo = r.d.slice(0, 7); (byMo[mo] = byMo[mo] || []).push({ d: r.d, vendor: String(r.vendor), item: String(r.item), unit: String(r.unit || ''), p: Number(r.p), q: Number(r.q) || 0, src: String(r.src || 'import') }) })
    const rep2 = {}
    for (const mo of Object.keys(byMo)) {
      const did = 'sp_supply_pm_ph_' + mo
      const doc = (await kvGet(did)) || { rows: [] }
      const seen = new Set(doc.rows.map(r => `${r.d}|${r.vendor}|${r.item}`))
      const add = byMo[mo].filter(r => !seen.has(`${r.d}|${r.vendor}|${r.item}`))
      rep2[mo] = { had: doc.rows.length, add: add.length }
      if (!body.dry && add.length) { doc.rows.push(...add); doc.updatedAt = new Date().toISOString(); await kvPut(did, doc, '價格歷史匯入口') }
    }
    if (!body.dry) await announceChanged()
    return res.status(200).json({ ok: true, dry: !!body.dry, months: rep2 })
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
    arr('ingredients').forEach(x => { if (!x?.name) return; const g = getIng(x.name, x.baseUnit); if (x.baseUnit) g.baseUnit = x.baseUnit; if (x.cat) g.cat = x.cat; if (x.costFree != null) g.costFree = !!x.costFree })
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
    // 變價側錄（張良 2026-09-06）：新價 append 價格歷史月檔＋變價通知＋價差過大（預設±80%且差額≥20）標「疑似有誤」待確認
    const priceEvents = []   // {vendor,item,unit,from,to,pct|null}
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
        const p = Number(x.price); const cur = vi.last || {}
        const prev = Number(cur.price) || Number(vi.price) || 0
        vi.price = p
        vi.last = Number(cur.price) === p ? { ...cur, ts: now } : { price: p, ts: now, prevPrice: Number(cur.price) || 0, prevTs: cur.ts || '' }
        if (p !== prev) priceEvents.push({ vendor: v.name, item: vi.name, unit: vi.unit || '', from: prev, to: p, pct: prev > 0 ? Math.round((p - prev) / prev * 100) : null })
      }
      if (!Number(vi.packToBase)) rep.warn.push(`品項「${vi.name}」缺入數換算（規格解析不出）——App 物料頁要補，不然成本算不出`)
    })
    // ③b 產品主檔 upsert（張良 2026-09-07：成品以正式菜單為準——中文/英文/售價/分類）：
    // find=舊名（對到既有食譜產品→改名成菜單名）；沒 find 或找不到→用 name 找；都沒有→建新品（沒食譜，表上一目瞭然缺什麼）
    arr('products').forEach(x => {
      if (!x?.name) return
      const byN = (nm) => db.products.find(p => !p.semi && normName(p.name) === normName(nm))
      const t = (x.find && byN(x.find)) || byN(x.name)
      if (t) {
        if (t.name !== x.name) rep.updated.push(`產品改名：${t.name}→${x.name}`)
        else rep.updated.push('產品：' + x.name)
        t.name = x.name
        if (x.en != null) t.english_name = String(x.en)
        if (x.price != null && x.price !== '') t.price = x.price
        if (x.category) t.category = x.category
        if (x.note) t.note = String(x.note)
      } else {
        db.products.push({ id: rid2('p'), category: x.category || '未分類', name: String(x.name).trim(), english_name: String(x.en || ''), price: x.price ?? '', note: String(x.note || ''), is_active: true, sort: db.products.length, unit: '', tags: [] })
        rep.created.push('產品(無食譜)：' + x.name)
      }
    })
    // 分類主檔跟上（菜單分類自動登記，成品食譜頁分組用）
    arr('products').forEach(x => { if (x?.category && !(db.categories || []).some(c => c.name === x.category)) db.categories.push({ name: x.category, sort: db.categories.length }) })
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
      // 食譜公版欄位（2026-09-06 張良：照他配方表的完整格式）——有給才寫，不硬塞空值
      if (Number(x.packW) > 0) rec.packW = Number(x.packW)
      if (Number(x.packN) > 0) rec.packN = Number(x.packN)
      for (const k of ['keepType', 'keepPlace', 'expFrozen', 'expChilled', 'stationStock', 'reserveStock']) if (x[k]) rec[k] = String(x[k])
      newRecs.push(rec); rep.recipes.push(`${p.name}（用料${lines.length}＋半成品${subs.length}）`)
    })
    // 變價側錄：價差過大＝「疑似資料有誤」進待確認清單（App 價格追蹤頁 highlight，確認後解除）
    const suspectPct = Number((db.settings || {}).suspectPct) > 0 ? Number((db.settings || {}).suspectPct) : 80
    const suspects = priceEvents.filter(e => e.pct != null && Math.abs(e.pct) >= suspectPct && Math.abs(e.to - e.from) >= 20)
    if (priceEvents.length) rep.priceChanges = priceEvents
    if (suspects.length) rep.suspects = suspects
    if (body.dry) return res.status(200).json({ ok: true, dry: true, ...rep })
    await kvPut('sp_supply_pm_supply', db, '供應鏈匯入口')
    for (const rec of newRecs) await kvPut('sp_supply_pm_recipe_v_' + rec.id, rec, '供應鏈匯入口')
    if (priceEvents.length) {
      const today = now.slice(0, 10), mo = today.slice(0, 7)
      // ① 價格歷史 append（同一天同品項只留一筆＝最新）
      const did = 'sp_supply_pm_ph_' + mo
      const doc = (await kvGet(did)) || { rows: [] }
      priceEvents.forEach(e => {
        const i = doc.rows.findIndex(r => r.d === today && r.vendor === e.vendor && r.item === e.item)
        const row = { d: today, vendor: e.vendor, item: e.item, unit: e.unit, p: e.to, q: 0, src: 'ingest' }
        if (i >= 0) doc.rows[i] = row; else doc.rows.push(row)
      })
      doc.updatedAt = now; await kvPut(did, doc, '供應鏈匯入口')
      // ② 疑似有誤旗標（待張良確認：資料錯→改價；沒錯→按確認解除）
      if (suspects.length) {
        const flags = (await kvGet('sp_supply_pm_price_flags')) || {}
        suspects.forEach(e => { flags[`${e.vendor}||${e.item}`] = { ts: now, from: e.from, to: e.to, pct: e.pct, status: 'pending' } })
        await kvPut('sp_supply_pm_price_flags', flags, '供應鏈匯入口')
      }
      // ③ 編輯歷史（改動都要留痕）
      const eid = 'sp_supply_pm_editlog_' + mo
      const el = (await kvGet(eid)) || { rows: [] }
      priceEvents.forEach(e => el.rows.push({ ts: now, by: 'AI匯入口', kind: 'price', name: `${e.vendor}／${e.item}`, from: e.from, to: e.to }))
      await kvPut(eid, el, '供應鏈匯入口')
      // ④ LINE 通知老闆（變價都要知道；疑似有誤特別標）——群外私訊、記額度
      try {
        const { linePush } = await import('./_onboard.js')
        const { logPush } = await import('./push.js')
        const top = priceEvents.slice(0, 8).map(e => `・${e.item}（${e.vendor}）$${e.from || '—'}→$${e.to}${e.pct != null ? `（${e.pct > 0 ? '+' : ''}${e.pct}%）` : ''}`)
        const txt = `📈 進價變動 ${priceEvents.length} 項\n${top.join('\n')}${priceEvents.length > 8 ? `\n…等共 ${priceEvents.length} 項` : ''}` +
          (suspects.length ? `\n\n⚠️ ${suspects.length} 項價差過大（≥${suspectPct}%），疑似資料有誤——已在「價格追蹤」頁標黃待確認` : '')
        const ops = (await kvGet('pm_bot_operators')) || {}
        for (const uid of Object.keys(ops)) { if (await linePush(uid, txt)) await logPush(uid, 1, '進價變動通知') }
      } catch (_) {}
    }
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
    const maxSnips = Math.min(40, Math.max(1, parseInt(req.query.max || '8', 10) || 8)) // &max=N 拉高單文件片段數；&id=xxx 只查某份文件
    const onlyId = String(req.query.id || '')
    const lr = await fetch(`${SB_URL}/rest/v1/pm_documents?select=id&data->>v=ilike.${encodeURIComponent('*' + q + '*')}&limit=60`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const ids = (lr.ok ? await lr.json() : []).map(x => x.id).filter(id => !onlyId || id === onlyId)
    const out2 = []
    for (const id of ids.slice(0, 30)) {
      const r2 = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      const rows2 = r2.ok ? await r2.json() : []
      const txt = rows2[0]?.data?.v || ''
      const snips = []
      let i2 = -1
      while ((i2 = txt.indexOf(q, i2 + 1)) >= 0 && snips.length < maxSnips) { snips.push(txt.slice(Math.max(0, i2 - 90), i2 + 120)); i2 += q.length }
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
  // 名冊探針（唯讀＋同金鑰；張良 2026-09-18：問「入職超過一年的正職名單」，本機被 RLS 擋 →
  // 走這裡撈名冊公開欄位自己算。刻意不回機密欄：薪資/身分證/保險/銀行/證件）：?rosterprobe=<key>
  if (req.query?.rosterprobe) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.rosterprobe) !== mk) return res.status(403).json({ ok: false })
    const rd = (await kvGet('sp_crew_kb_roster')) || {}
    // 回「全部非機密欄位」（名冊欄位是動態自訂的，寫死清單會漏——第一版就漏了「職稱」）：
    // 黑名單制擋機密：身分證/銀行/保險/薪資/投保/生日碼/檔案欄
    const BLOCK = /身分證|銀行|薪轉|保險|投保|勞保|健保|團保|生日碼|本薪|薪資|補助|津貼/
    const fs2 = (Array.isArray(rd.fields) ? rd.fields : []).filter(f => f.type !== 'file' && !BLOCK.test(f.label || ''))
    const ppl = (Array.isArray(rd.people) ? rd.people : []).map(p => {
      const o = { name: p.name, nick: p.nick || '', status: p.status || '' }
      fs2.forEach(f => { const v = p[f.key]; if (v != null && String(v).trim()) o[f.key] = v })
      return o
    })
    return res.status(200).json({ ok: true, n: ppl.length, fields: fs2.map(f => ({ key: f.key, label: f.label })), people: ppl })
  }
  // 夥伴營運看板資料口（獨立金鑰 OPS_BOARD_KEY——跟管理金鑰分開，外流也只能唯讀看板資料；張良 2026-09-20）：
  // ?opsboard=<OPS_BOARD_KEY>&store=ground|abeach → 給 /ops/ 靜態頁用：日表(營收/單數/外帶%/套餐%)＋
  // 品項備料表(30日均/vs近60/近14天逐日,套 alias 合併+hidden 過濾)＋時段平均。刻意不含：付款明細/成本/毛利/定價
  // /prep 舊任務搬家口（整併步驟5，張良 2026-10-02）：?prepmigrate=<MENU_PROBE_KEY>[&dry=1]
  // sp_finance_pm_sop_issues → sp_team_pm_task_<id>（title/status/catId 對應；prep 特色欄 by/claimBy/claimAt/prepPub 原樣帶）
  if (req.query?.prepmigrate) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.prepmigrate) !== mk) return res.status(403).json({ ok: false })
    const dry = !!String(req.query.dry || '')
    const iss = ((await kvGet('sp_finance_pm_sop_issues')) || {}).list || []
    const data = (await kvGet('sp_team_pm_data')) || []
    const catByName = new Map((Array.isArray(data) ? data : []).map(c => [c.name, c]))
    const newCats = []
    const catIdOf = (nm) => {
      const name = nm || '收件匣'
      if (name === '收件匣') return '__inbox__'
      let c = catByName.get(name)
      if (!c) { c = { id: 'cat-gd-' + Math.random().toString(36).slice(2, 8), order: (data.length + newCats.length), name, budget: 0, status: 'pending', items: [] }; catByName.set(name, c); newCats.push(c) }
      return c.id
    }
    const rep = { moved: [], cats: [] }
    const tasks = iss.map((x, i) => ({
      id: 'gdiss-' + (x.id || i),
      title: String(x.text || '（附件）').slice(0, 120),
      note: (x.media || []).length ? '附件：' + x.media.join(' ') : '',
      status: x.status === 'done' ? 'done' : (x.claimBy ? 'doing' : 'todo'),
      catId: catIdOf(x.st), due: x.due || '', priority: x.flag ? 'high' : '',
      by: x.by || '', claimBy: x.claimBy || '', claimAt: x.claimAt || null,
      prepPending: x.status === 'pending' ? 1 : 0, prepPub: x.pub || '', ck: x.ck || [],
      createdAt: x.ts || '', updatedAt: new Date().toISOString(), src: 'prep搬家',
    }))
    rep.moved = tasks.map(t => t.title); rep.cats = newCats.map(c => c.name)
    if (!dry) {
      if (newCats.length) await kvPut('sp_team_pm_data', [...data, ...newCats], 'prep任務搬家')
      for (const t of tasks) await kvPut('sp_team_pm_task_' + t.id, t, 'prep任務搬家')
      await announceChanged()
    }
    return res.status(200).json({ ok: true, dry, n: tasks.length, ...rep })
  }
  // 任務中心代理口（/prep 掛主App TaskCenter 用；張良 2026-10-02 整併開工）：POST ?kvproxy=<OPS_BOARD_KEY>
  // body={op:'get'|'set'|'getPrefix'|'del', key, value, token}；只准團隊空間任務相關 key；寫入須 permWho(token,'task') 留痕
  if (req.method === 'POST' && req.query?.kvproxy) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.kvproxy) !== ok2) return res.status(403).json({ ok: false })
    let kb = {}; try { kb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const key = String(kb.key || '')
    const ALLOW_RE = /^sp_team_pm_(task_[A-Za-z0-9_-]+|tasks_v2|data|activity|ownerord|ptscfg)$/ // ownerord=負責人分組排序(v4.41.0)；ptscfg=任務積分級距(v4.44.0)
    const ALLOW_PFX = /^sp_team_pm_task_$/
    const op = String(kb.op || '')
    if (op === 'getPrefix') {
      if (!ALLOW_PFX.test(key)) return res.status(403).json({ ok: false, error: 'key 不在白名單' })
      const pattern = key.replace(/[\\%_]/g, (m) => '\\' + m)
      const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(pattern)}*&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      const rows = r.ok ? await r.json() : []
      const out = {}; rows.forEach(row => { if (row?.data?.v) out[row.id] = row.data.v })
      return res.status(200).json({ ok: true, rows: out })
    }
    if (!ALLOW_RE.test(key)) return res.status(403).json({ ok: false, error: 'key 不在白名單' })
    if (op === 'get') { const v = await kvGet(key); return res.status(200).json({ ok: true, value: v == null ? null : JSON.stringify(v) }) }
    if (op === 'set' || op === 'del') {
      const w = await permWho(kb.token, 'task')
      if (!w) return res.status(403).json({ ok: false, error: '要有任務編輯權限（綁定＋核准）' })
      if (op === 'del') { await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }); return res.status(200).json({ ok: true }) }
      let val; try { val = JSON.parse(String(kb.value)) } catch (_) { return res.status(400).json({ ok: false, error: 'value 要是 JSON 字串' }) }
      await kvPut(key, val, '/prep任務(' + w.name + ')')
      await announceChanged()
      return res.status(200).json({ ok: true })
    }
    return res.status(400).json({ ok: false, error: '未知 op' })
  }
  // 🛠 任務通知口（v4.41.0 張良：指派完選「發群/私訊/不通知」；完成送審通知建立者；審核結果回報本人）
  // POST ?tasknotify=<OPS_BOARD_KEY> body={token, kind:'assign'|'review'|'approve'|'reject', mode:'group'|'dm'|'none', title, due, owner, creator, doer}
  if (req.method === 'POST' && req.query?.tasknotify) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.tasknotify) !== ok2) return res.status(403).json({ ok: false })
    let tb = {}; try { tb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoT9 = await permWho(tb.token, 'task')
    if (!whoT9) return res.status(403).json({ ok: false, error: permDeny() })
    const actor9 = whoT9.name || '現場'
    const title9 = String(tb.title || '').slice(0, 80)
    if (!title9) return res.status(400).json({ ok: false, error: '缺任務標題' })
    const tkL9 = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
    const bd9 = (await kvGet('sp_finance_pm_prep_bind')) || {}
    const uidByName9 = nm => { for (const [u9, tk9] of Object.entries(bd9.byUid || {})) { if (((bd9.tokens || {})[tk9] || {}).name === nm) return u9 } return null }
    const ridByName9 = nm => { const e9 = Object.values(bd9.tokens || {}).find(x => x.name === nm); return e9 ? (e9.rid || e9.uid) : null }
    const { prepLink, wpPush } = await import('./_webpush.js')
    const push9 = (to, text) => tkL9 ? fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkL9 }, body: JSON.stringify({ to, messages: [{ type: 'text', text }] }) }).catch(() => {}) : null
    let sent9 = 0
    const kind9 = String(tb.kind || 'assign'), mode9 = String(tb.mode || 'none')
    const due9 = tb.due ? `\n截止：${String(tb.due).slice(0, 10)}` : ''
    // v4.41.6 深層連結（張良「通知跟訊息一樣定位 直接帶過去看那張卡片閃金光」）：帶任務 id → 連結直達該卡
    const tid9 = String(tb.id || '').replace(/[^A-Za-z0-9_-]/g, '')
    const lnk9 = prepLink(tid9 ? 'task=' + tid9 : '')
    const url9 = tid9 ? '/prep#task=' + tid9 : '/prep'
    if (kind9 === 'assign' && mode9 !== 'none') {
      const txt9 = `🛠 任務指派｜${title9}\n負責人：${tb.owner || '（未定）'}${due9}\n— ${actor9} 指派\n點開直達這張卡 👇\n${lnk9}`
      if (mode9 === 'group') { await push9('Cf7940efc6517b0c084ad2ad496b45f30', txt9); sent9++ }
      else if (mode9 === 'dm') {
        const u9 = uidByName9(String(tb.owner || ''))
        if (!u9) return res.status(200).json({ ok: false, error: `${tb.owner || '負責人'} 還沒綁定 GD，私訊不到——改發群組或請他先綁定` })
        await push9(u9, txt9); sent9++
      }
      const r9 = ridByName9(String(tb.owner || '')); if (r9) { try { await wpPush([r9], { title: '🛠 新任務指派', body: `${title9}（${actor9} 指派）`, url: url9 }) } catch (_) {} }
    }
    if (kind9 === 'manual' && mode9 !== 'none') { // v4.41.4 卡片內🔔隨時補通知（張良「一開始不通知後來要通知」）：措辭=提醒不是指派
      const txtM = `🛠 任務提醒｜${title9}${tb.owner ? `\n負責人：${tb.owner}` : ''}${due9}\n— ${actor9} 提醒\n點開直達這張卡 👇\n${lnk9}`
      if (mode9 === 'group') { await push9('Cf7940efc6517b0c084ad2ad496b45f30', txtM); sent9++ }
      else if (mode9 === 'dm') {
        const uM = uidByName9(String(tb.owner || ''))
        if (!uM) return res.status(200).json({ ok: false, error: `${tb.owner || '負責人'} 還沒綁定 GD，私訊不到——改發群組或請他先綁定` })
        await push9(uM, txtM); sent9++
      }
      const rM = ridByName9(String(tb.owner || '')); if (rM) { try { await wpPush([rM], { title: '🛠 任務提醒', body: `${title9}（${actor9}）`, url: url9 }) } catch (_) {} }
    }
    if (kind9 === 'review') { // 別人建立的任務按完成 → 固定私訊建立者審核（不吵群）
      const cu9 = uidByName9(String(tb.creator || ''))
      if (cu9) { await push9(cu9, `✅ ${actor9} 回報完成【${title9}】\n請到 GD 任務審核（通過＝封存）\n點開直達這張卡 👇\n${lnk9}`); sent9++ }
      const cr9 = ridByName9(String(tb.creator || '')); if (cr9) { try { await wpPush([cr9], { title: '🛠 完成待審核', body: `${actor9}：${title9}`, url: url9 }) } catch (_) {} }
    }
    if (kind9 === 'approve' || kind9 === 'reject') { // 審核結果 → 私訊回報完成的人
      const du9 = uidByName9(String(tb.doer || ''))
      if (du9) { await push9(du9, kind9 === 'approve' ? `🎉 你完成的【${title9}】通過審核，已封存` : `↩️ 【${title9}】被退回，再處理一下（${actor9}）\n點開直達這張卡 👇\n${lnk9}`); sent9++ }
      const dr9 = ridByName9(String(tb.doer || '')); if (dr9) { try { await wpPush([dr9], { title: kind9 === 'approve' ? '🎉 審核通過' : '↩️ 任務退回', body: title9, url: url9 }) } catch (_) {} }
    }
    if (kind9 === 'ack') { // v4.41.6 ✅ 確認收到（張良「對方看到按下去 即時私訊任務建立者」）：負責人按鈕 → 建立者私訊+推播
      const cu9 = uidByName9(String(tb.creator || ''))
      if (cu9) { await push9(cu9, `👌 ${actor9} 已確認收到任務【${title9}】${due9}\n點開直達這張卡 👇\n${lnk9}`); sent9++ }
      const cr9 = ridByName9(String(tb.creator || '')); if (cr9) { try { await wpPush([cr9], { title: '👌 任務已確認收到', body: `${actor9}：${title9}`, url: url9 }) } catch (_) {} }
    }
    return res.status(200).json({ ok: true, sent: sent9 })
  }
  // 🧹 任務管理口（v4.45.0 張良「先把所有類別/卡片/框顏色都清除」＋「積分級距規劃一版」）：?taskadmin=<MENU_PROBE_KEY>&op=colorwipe|ptsseed
  if (req.query?.taskadmin) {
    const mk9 = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk9 || String(req.query.taskadmin) !== mk9) return res.status(403).json({ ok: false })
    const op9 = String(req.query.op || '')
    if (op9 === 'colorwipe') { // 類別+卡片顏色全清（一次性；跑幾次都安全）
      let nCat = 0, nTask = 0
      const pd9 = await kvGet('sp_team_pm_data')
      if (Array.isArray(pd9)) { pd9.forEach(c9 => { if (c9 && c9.color) { delete c9.color; nCat++ } }); if (nCat) await kvPut('sp_team_pm_data', pd9, '清類別顏色') }
      const r9 = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.sp\\_team\\_pm\\_task\\_*&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      const rows9 = r9.ok ? await r9.json() : []
      for (const row9 of rows9) {
        try { const t9 = JSON.parse(row9.data.v); if (t9 && t9.color) { delete t9.color; await kvPut(row9.id, t9, '清卡片顏色'); nTask++ } } catch (_) {}
      }
      await announceChanged()
      return res.status(200).json({ ok: true, cats: nCat, tasks: nTask })
    }
    if (op9 === 'ptsseed') { // 積分級距 10 級模組化版（v4.47.0 張良：模組化特效）：顏色＋mods（浮誇模板）同參考檔
      const M = [ // 浮誇模板（參考 tier-effects-reference.html PR）每級的七軌道組合
        { border: 'solid', glow: 'none', outer: 'none', edge: 'none', surf: 'none', part: 'none', badge: 'outline' },
        { border: 'solid', glow: 'breathe', outer: 'none', edge: 'none', surf: 'none', part: 'none', badge: 'outline' },
        { border: 'solid', glow: 'none', outer: 'ripple', edge: 'none', surf: 'none', part: 'none', badge: 'outline' },
        { border: 'solid', glow: 'none', outer: 'none', edge: 'none', surf: 'shimmer', part: 'none', badge: 'outline' },
        { border: 'laser', glow: 'static', outer: 'none', edge: 'none', surf: 'none', part: 'none', badge: 'outline' },
        { border: 'solid', glow: 'breathe', outer: 'pulse', edge: 'none', surf: 'none', part: 'none', badge: 'solid' },
        { border: 'solid', glow: 'zap', outer: 'none', edge: 'bolt', surf: 'none', part: 'none', badge: 'solid' },
        { border: 'solid', glow: 'static', outer: 'none', edge: 'fire', surf: 'none', part: 'none', badge: 'solid' },
        { border: 'laser2', glow: 'static', outer: 'none', edge: 'none', surf: 'shimmer', part: 'gold', badge: 'jump' },
        { border: 'rainbow', glow: 'static', outer: 'boom', edge: 'none', surf: 'flash', part: 'rainbow', badge: 'rainbow' },
      ]
      const CO = ['#9AA3AF', '#c0567a', '#4b8cf7', '#9b74ff', '#26c6e0', '#ec4f9c', '#ef4444', '#ff8a1f', '#f5c542', 'rainbow']
      const NM = ['日常', '例行', '進階', '熟練', '稀有', '精英', '史詩', '大師', '傳說', '神話']
      const DE = ['隨手可完成的小事，順手就做', '固定流程照做就好', '要動腦，半天內搞定', '獨立完成，有品質要求', '小專案：自己規劃＋執行到完', '跨人協調，或影響營運數字', '跨天大案，帶人一起完成', '建立新制度、新流程', '公司級改變、重大成果', '扭轉局面的里程碑']
      const MN = [1, 3, 5, 8, 10, 15, 20, 30, 50, 100]
      const tiers9 = NM.map((n, i) => ({ name: n, min: MN[i], desc: DE[i], color: CO[i], mods: M[i] }))
      const cur9 = (await kvGet('sp_team_pm_ptscfg')) || {}
      await kvPut('sp_team_pm_ptscfg', { tiers: tiers9, note: cur9.note || '積分怎麼算：按任務的難度與影響力給分；完成並通過審核才入帳。積分會進排行榜，未來接 360 分潤加成。拿不準就往低一級抓，重大成果再往上調。' }, '積分級距模組化版')
      await announceChanged()
      return res.status(200).json({ ok: true, tiers: tiers9.length })
    }
    return res.status(400).json({ ok: false, error: '未知 op' })
  }
  // 🗓 台灣國定假日/補班（v4.43.0 張良「中秋連假沒上班族——假日標記班表+營業額、以後排班提醒的底」）
  // 資料=人事行政總處行事曆(ruyut/TaiwanCalendar,每年官方公告)；KV快取14天自動更新、2027公告後自動進來
  if (req.query?.twhol) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.twhol) !== ok2) return res.status(403).json({ ok: false })
    const y0 = new Date(Date.now() + 8 * 3600e3).getUTCFullYear()
    const hol = {}, wk = {}
    for (const y of [y0, y0 + 1]) {
      let doc = await kvGet('sp_finance_pm_twhol_' + y).catch(() => null)
      if (!doc || !doc.ts || Date.now() - new Date(doc.ts).getTime() > 14 * 86400e3) {
        try {
          const r9 = await fetch('https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/' + y + '.json')
          if (r9.ok) {
            const arr = await r9.json()
            const h9 = {}, w9 = {}
            for (const x of arr) {
              if (!x.description) continue
              const s8 = String(x.date); const dt = s8.includes('-') ? s8 : (s8.slice(0,4)+'-'+s8.slice(4,6)+'-'+s8.slice(6,8)) // v4.43.1 寫檔跳脫吃掉\d害regex失效→改slice
              if (x.isHoliday) h9[dt] = x.description; else w9[dt] = x.description // 補行上班
            }
            doc = { ts: new Date().toISOString(), hol: h9, wk: w9 }
            await kvPut('sp_finance_pm_twhol_' + y, doc, '行事曆快取')
          }
        } catch (_) {} // 來源掛了→用舊快取（明年檔還沒公告=404 正常跳過）
      }
      if (doc) { Object.assign(hol, doc.hol || {}); Object.assign(wk, doc.wk || {}) }
    }
    const fx9 = o => { const r = {}; for (const [k, v] of Object.entries(o || {})) { const kk = k.includes('-') ? k : (k.slice(0,4)+'-'+k.slice(4,6)+'-'+k.slice(6,8)); r[kk] = v } return r } // v4.43.1 舊快取鍵也正規化
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
    return res.status(200).json({ ok: true, hol: fx9(hol), wk: fx9(wk) })
  }
  // 🎬 個人動畫偏好（v2.0 張良：任務卡特效動畫開關，跟帳號走）：GET ?animpref=<OPS_KEY>&me=token 讀本人；POST ?animprefset= 存
  if (req.query?.animpref) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.animpref) !== ok2) return res.status(403).json({ ok: false })
    const wA = await sopWho(req.query.me)
    if (!wA) return res.status(200).json({ ok: true, pref: null })
    const docA = (await kvGet('sp_finance_pm_prep_animpref')) || {}
    return res.status(200).json({ ok: true, pref: docA[wA.rid || wA.uid] || null })
  }
  if (req.method === 'POST' && req.query?.animprefset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.animprefset) !== ok2) return res.status(403).json({ ok: false })
    let bA = {}; try { bA = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const wA = await sopWho(bA.token)
    if (!wA) return res.status(403).json({ ok: false, error: permDeny() })
    const p = bA.pref || {}
    const clean = { inView: p.inView !== false, noDone: p.noDone !== false, followReduce: p.followReduce !== false, allOff: !!p.allOff }
    const docA = (await kvGet('sp_finance_pm_prep_animpref')) || {}
    docA[wA.rid || wA.uid] = clean
    await kvPut('sp_finance_pm_prep_animpref', docA, '動畫偏好(' + wA.name + ')')
    return res.status(200).json({ ok: true })
  }
  // 我是誰（側欄底部身分膠囊用；張良 2026-10-02）：GET ?whoami=<OPS_BOARD_KEY>&me=token
  if (req.query?.whoami) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.whoami) !== ok2) return res.status(403).json({ ok: false })
    const w = await sopWho(req.query.me)
    if (!w) return res.status(200).json({ ok: true, me: null })
    const [defW, pmW, favW] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_finance_pm_prep_perm'), kvGet('sp_finance_pm_prep_fav')]) // v4.39.1 fav=個人常用捷徑
    const aprW = (((defW || {}).ground || {}).approvers || ['張良瑋'])
    const uW = ((pmW || {}).users || {})[w.rid || w.uid]
    const hideW = (uW && !uW.admin && uW.hide) ? Object.keys(uW.hide).filter(k => uW.hide[k]) : [] // v4.26.3 每頁看不看得見
    const favU = (((favW || {}).users || {})[w.rid || w.uid]) || null // v4.39.1 個人常用捷徑清單（手機底部列）
    // v4.34.0（張良「到底能不能編輯要一看就知道」）：whoami 連權限一起回，前端照 permWho 同一套邏輯鎖按鈕（&as= 模擬時=回被模擬者的）
    return res.status(200).json({ ok: true, me: { name: w.name, role: w.role, approver: w.role === '主管' || aprW.includes(w.name), hideTabs: hideW, fav: favU, mode: (pmW || {}).mode || 'open', edit: !!(uW && uW.edit), adminP: !!(uW && uW.admin), tabs: (uW && uW.tabs) || null } })
  }
  if (req.query?.opsboard) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.opsboard) !== ok2) return res.status(403).json({ ok: false })
    const storeQ = String(req.query.store || 'ground') === 'abeach' ? 'abeach' : 'ground'
    const skOf2 = (n) => /groun/i.test(n || '') ? 'ground' : 'abeach'
    const [posDoc, aliasDoc2, hiddenDoc2, pricesDoc2] = await Promise.all([kvGet('sp_finance_pm_pos'), kvGet('sp_finance_pm_pos_alias'), kvGet('sp_finance_pm_pos_hidden'), kvGet('sp_finance_pm_pos_prices')])
    const todayAct = new Date(Date.now()+8*3600e3).toISOString().slice(0,10)
    const actDoc = (await kvGet('sp_finance_pm_prep_act_'+todayAct.slice(0,7))) || { days:{} } // 實際備料（張良 2026-10-01：每天可填、留紀錄做分析）
    // 排除「盤中未完整日」（張良 2026-09-24 抓包：今天的半天資料 11:00 起混進統計，把當天星期的平均拉低
    // → 看板白天數字一直變、跟 09:30 備料訊息對不上。統計只吃打烊後的正式日結；日表那段照樣顯示今天盤中）
    const entriesAll9 = ((posDoc || {}).entries || []).filter(e => skOf2(e.store) === storeQ).sort((a, b) => (a.date < b.date ? -1 : 1))
    const entries = entriesAll9.filter(e => !e.intraday)
    if (!entries.length) return res.status(200).json({ ok: true, store: storeQ, empty: true })
    // v4.18.2（張良：每日數據要跟主App一樣有今天盤中）：統計照舊只吃正式日結；日表額外掛上今天的盤中列(live=1)
    const today18 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const liveE9 = entriesAll9.filter(e => e.intraday && e.date === today18 && !entries.some(x => x.date === e.date)).slice(-1)
    const anchor = entries[entries.length - 1].date
    const dOf = (base, off) => { const d0 = new Date(base + 'T00:00:00Z'); d0.setUTCDate(d0.getUTCDate() + off); return d0.toISOString().slice(0, 10) }
    const from60 = dOf(anchor, -59), from30 = dOf(anchor, -29)
    const win = entries.filter(e => e.date >= from60)
    const w30 = win.filter(e => e.date >= from30)
    // 品項：撈全部歷史明細月檔（張良 2026-09-20：跟 App 一樣顯示全部歷史，不只近期）
    const mos = [...new Set(entries.map(e => e.date.slice(0, 7)))]
    const dets = {}
    await Promise.all(mos.map(async mo2 => { dets[mo2] = await kvGet('sp_finance_pm_pos_d_' + mo2) })) // 平行抓（串行是 10 秒慢的元兇之一，張良 2026-09-21）
    const dayDet2 = (date) => { const m = (dets[date.slice(0, 7)] || {}).days; if (!m) return undefined; return m[`${date}::${storeQ}`] || (m[date] && skOf2(m[date].store) === storeQ ? m[date] : undefined) }
    // 日表（近20個營業日；核心夥伴全開＝付款明細/至14:00/單均都給——張良 2026-09-20「都是核心夥伴」）
    const WD = ['日', '一', '二', '三', '四', '五', '六']
    const days2 = [...entries, ...liveE9].map(e => {
      const tk = Number(e.takeTx) || 0, dn = Number(e.dineTx) || 0
      const rev2 = Number(e.revenue) || 0, tx2 = Number(e.txCount) || 0
      // 至14:00＝時段表 <14 點小時列加總（與 App 同一份資料）
      let lunch = null
      const ts = ((dayDet2(e.date) || {}).sheets || {})['時段分析(每小時)']
      const trows = Array.isArray(ts) && ts[0] ? (ts[0].rows || []) : []
      if (trows.length) { lunch = 0; for (const r of trows) { const hh2 = parseInt(r[0]); if (!isNaN(hh2) && hh2 < 14) lunch += Number(r[2]) || 0 } }
      return {
        live: e.intraday ? 1 : 0,
        date: e.date, wd: WD[new Date(e.date + 'T00:00:00Z').getUTCDay()], rev: rev2, tx: tx2,
        avg: tx2 ? Math.round(rev2 / tx2) : null, lunchPct: lunch != null && rev2 ? Math.round(lunch / rev2 * 100) : null, lunchRev: lunch != null ? Math.round(lunch) : null,
        cash: Number(e.cash) || 0, card: Number(e.card) || 0, linepay: Number(e.linepay) || 0, uber: Number(e.uber) || 0,
        kioskPct: e.kiosk > 0 && rev2 ? Math.round(e.kiosk / rev2 * 100) : null, discount: Number(e.discount) || 0,
        takePct: tk + dn > 0 ? Math.round(tk / (tk + dn) * 100) : null,
      }
    })
    const AB_SKIP2 = new Set(['⚡️工具箱', '包場大訂', '免招手', '收蛋糕', '慶生沒蛋糕', '♥️福利♥️', '自訂食品', '總結', '套餐', '商品分類銷售分析'])
    const GD_SKIP2 = new Set(['財務工具箱', '財務工具', '現場工具箱', '保存期限工具箱'])
    const isAB2 = storeQ === 'abeach'
    const norm2 = (s) => isAB2 ? String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '').replace(/\s+/g, '') : String(s)
    const aliasMap2 = ((aliasDoc2 || {})[storeQ]) || {}
    const hiddenMap2 = ((hiddenDoc2 || {})[storeQ]) || {}
    const priceMap2 = ((pricesDoc2 || {})[storeQ]) || {} // 張良手填牌價優先；0=不顯示（與 App 同口徑）
    const items2 = {}; const itemsH2 = {}; const catOrder2 = []; const setByDate = {}
    let n30 = 0, nPrev = 0
    for (const e of entries) {
      const inCur = e.date >= from30, inPrev = !inCur && e.date >= from60
      if (inCur) n30++; else if (inPrev) nPrev++
      const secs = ((dayDet2(e.date) || {}).sheets || {})['總銷售額 (以類別分類)']
      if (!Array.isArray(secs)) continue
      for (const s of secs) {
        if (s.title === '總結') continue
        if (s.title === '套餐') { for (const r of (s.rows || [])) if (Array.isArray(r)) setByDate[e.date] = (setByDate[e.date] || 0) + (Number(r[1]) || 0); continue }
        if (isAB2 && AB_SKIP2.has(s.title)) continue
        if (!isAB2 && GD_SKIP2.has(s.title)) continue
        if (!isAB2 && !catOrder2.includes(s.title)) catOrder2.push(s.title)
        const uberCat = isAB2 && ['Pizza披薩', '主餐＆早午餐', '沙拉＆湯', '炸物＆前菜', '飲品'].includes(s.title) // AB Uber 低價分類：份數併入、金額不算（與 App 同口徑）
        for (const r of (s.rows || [])) {
          if (!Array.isArray(r) || typeof r[0] !== 'string' || /^1\/4/.test(r[0].trim())) continue
          let key2 = norm2(r[0]); key2 = aliasMap2[key2] || key2
          if (hiddenMap2[key2]) { // 已下架：不進任何統計，只收進隱藏管理清單（張良 2026-09-22 /prep 也要隱藏管理）
            const oH = itemsH2[key2] || (itemsH2[key2] = { n: r[0], k: key2, cat: s.title, q30: 0 })
            if (inCur) oH.q30 += Number(r[1]) || 0
            continue
          }
          const o = items2[key2] || (items2[key2] = { n: r[0], k: key2, cat: s.title, q: {}, q30: 0, qPrev: 0, amt30: 0 })
          o.n = r[0]; o.cat = s.title // 最新出現的名字/分類為準
          const qv = Number(r[1]) || 0
          o.q[e.date] = (o.q[e.date] || 0) + qv // 全歷史逐日
          if (inCur) { o.q30 += qv; if (!uberCat) o.amt30 += Number(r[r.length - 1]) || 0 } else if (inPrev) o.qPrev += qv
        }
      }
    }
    const datesAll = entries.map(e => e.date)
    const GD_ORDER2 = ['披薩', '漢堡', '越法三明治', '義大利麵', '小點', '湯品', '基礎飲品', '咖啡飲品', '奶香飲品', '檸檬飲品', '甜點']
    const catsAll = [...new Set(Object.values(items2).map(o => o.cat))]
    catsAll.sort((a, b) => { const ia = GD_ORDER2.indexOf(a), ib = GD_ORDER2.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) })
    const growOf2 = (o) => { if (!nPrev) return null; const p = o.qPrev; if (!p) return o.q30 > 0 ? '新' : null; const a30 = o.q30 / n30, a60 = (o.q30 + p) / (n30 + nPrev); return Math.round((a30 - a60) / a60 * 100) }
    const totalAmt30 = Object.values(items2).reduce((t, o) => t + (o.amt30 || 0), 0)
    const cats2 = catsAll.map(cn => ({
      name: cn,
      amt30: Math.round(Object.values(items2).filter(o => o.cat === cn).reduce((t, o) => t + (o.amt30 || 0), 0)),
      items: Object.values(items2).filter(o => o.cat === cn && (o.q30 > 0 || o.qPrev > 0)).sort((a, b) => b.q30 - a.q30)
        .map(o => { const ov = priceMap2[o.k] != null ? priceMap2[o.k] : priceMap2[o.n]
          // 售價：手填/灌檔牌價優先；GD 不用金額÷份數估（套餐拆帳會拉低＝張良 2026-09-22 抓包「菜單金額不對」），AB 才估
          const price = ov != null ? (Number(ov) || null) : (isAB2 && o.q30 > 0 && o.amt30 > 0 ? Math.round(o.amt30 / o.q30 / 5) * 5 : null)
          return { n: o.n, k: o.k, avg30: n30 ? Math.round(o.q30 / n30 * 10) / 10 : null, cum30: o.q30, grow: growOf2(o), amt30: Math.round(o.amt30 || 0), pct: totalAmt30 ? Math.round((o.amt30 || 0) / totalAmt30 * 1000) / 10 : null, price, q: datesAll.map(dd => o.q[dd] || 0) } }),
    })).filter(c => c.items.length)
    // 品類彙總（30日均/vs近60/30天累計/全歷史逐日）＋漢堡子小計＋預估備料（張良 2026-09-20）
    const aggOf = (list) => {
      const q = datesAll.map(dd => list.reduce((t, o) => t + (o.q[dd] || 0), 0))
      const q30s = list.reduce((t, o) => t + o.q30, 0), qPs = list.reduce((t, o) => t + o.qPrev, 0)
      let grow = null
      if (nPrev) { if (!qPs) grow = q30s > 0 ? '新' : null; else { const a30 = q30s / n30, a60 = (q30s + qPs) / (n30 + nPrev); grow = Math.round((a30 - a60) / a60 * 100) } }
      return { avg30: n30 ? Math.round(q30s / n30 * 10) / 10 : null, cum30: q30s, grow, q }
    }
    cats2.forEach(c => { c.agg = aggOf(Object.values(items2).filter(o => o.cat === c.name)) })
    if (!isAB2) {
      const burg = Object.values(items2).filter(o => o.cat === '漢堡')
      const c = cats2.find(x => x.name === '漢堡')
      if (c && burg.length) {
        const mk2 = (label, filt) => ({ n: label, ...aggOf(burg.filter(filt)) })
        c.subs = [
          mk2('├ 雞肉堡小計', o => !/牛肉/.test(o.n)),
          mk2('│　├ 炸雞腿堡', o => /雞腿堡/.test(o.n) && /炸/.test(o.n)),
          mk2('│　└ 煎雞腿堡', o => /雞腿堡/.test(o.n) && !/炸/.test(o.n)),
          mk2('├ 牛肉堡小計', o => /牛肉/.test(o.n)),
        ]
      }
    }
    // 預估備料量（GD；張良 2026-09-20 指定站別彙總）：平日/週末分開日均＝實際備量抓數
    const wkDates = new Set(w30.filter(e => { const d2 = new Date(e.date + 'T00:00:00Z').getUTCDay(); return d2 >= 1 && d2 <= 5 }).map(e => e.date))
    const weDates = new Set(w30.filter(e => !wkDates.has(e.date)).map(e => e.date))
    // 星期別集合（全歷史；GD 週末公休所以主要是週一~五各自平均——備料微調建議用）
    const wdSets2 = {}
    for (const e of entries) { const w = new Date(e.date + 'T00:00:00Z').getUTCDay(); (wdSets2[w] = wdSets2[w] || new Set()).add(e.date) }
    const prepAgg = (filt, mult = 1) => {
      const list = Object.values(items2).filter(filt)
      const dayVal = (dd) => list.reduce((t, o) => t + (o.q[dd] || 0), 0) * mult
      // 截尾平均（張良 2026-09-21 統計學抓包採納：樣本≥8天就去掉最高/最低各1天再平均——颱風日/異常日不再拉偏；
      // 備料數字照舊無條件進位取整）。峰值/低值本來就是要看極端，不截。
      const tmean = (vals) => {
        const v2 = vals.filter(v => v != null)
        if (!v2.length) return null
        let a = [...v2].sort((x, y) => x - y)
        if (a.length >= 8) a = a.slice(1, -1)
        return Math.ceil(a.reduce((t, v) => t + v, 0) / a.length)
      }
      const w30Vals = w30.map(e => dayVal(e.date))
      const byWd = [1, 2, 3, 4, 5].map(w => { const ds = wdSets2[w]; return ds && ds.size ? tmean([...ds].map(dayVal)) : null })
      return { avg: w30Vals.length ? tmean(w30Vals) : null, wk: wkDates.size ? tmean([...wkDates].map(dayVal)) : null, we: weDates.size ? tmean([...weDates].map(dayVal)) : null, byWd, peak: w30Vals.length ? Math.max(...w30Vals) : null, low: w30Vals.length ? Math.min(...w30Vals) : null }
    }
    const prep = isAB2 ? null : [
      { grp: '炸台', name: '無骨煎雞腿', ...prepAgg(o => o.cat === '漢堡' && /雞腿堡/.test(o.n) && !/炸/.test(o.n)) },
      { grp: '炸台', name: '無骨炸雞腿', ...prepAgg(o => o.cat === '漢堡' && /雞腿堡/.test(o.n) && /炸/.test(o.n)) },
      { grp: '炸台', name: '無骨雞腿合計', sub: 1, ...prepAgg(o => o.cat === '漢堡' && /雞腿堡/.test(o.n)) }, // 煎+炸加總小計（張良 2026-09-20；峰低值=兩者同日合計的最高/最低，不是峰值相加）
      { grp: '炸台', name: '帶骨炸雞（支）', ...prepAgg(o => o.cat === '小點' && /玻璃脆殼|川味微辣炸雞/.test(o.n), 2) },
      { grp: '沙拉', name: '小洋芋', ...prepAgg(o => o.cat === '小點' && /洋芋/.test(o.n)) },
      { grp: '沙拉', name: '沙拉杯', ...prepAgg(o => o.cat === '小點' && /沙拉杯/.test(o.n)) },
      { grp: '吧檯', name: '四季春烏龍', ...prepAgg(o => o.cat === '基礎飲品' && /四季春/.test(o.n)) },
      { grp: '吧檯', name: '台灣有機紅茶', ...prepAgg(o => o.cat === '基礎飲品' && /有機紅茶/.test(o.n)) },
      { grp: '吧檯', name: '南非國寶茶', ...prepAgg(o => o.cat === '基礎飲品' && /國寶茶/.test(o.n)) },
    ]
    // 套餐附加率（GD）：組數÷主餐份數
    const MAIN2 = new Set(['漢堡', '披薩', '義大利麵', '越法三明治'])
    const setDays = days2.map(d => {
      const sq = setByDate[d.date] || 0
      const mains = Object.values(items2).filter(o => MAIN2.has(o.cat)).reduce((t, o) => t + (o.q[d.date] || 0), 0)
      return sq && mains ? Math.round(sq / mains * 100) : null
    })
    // 時段平均（近30天，分平日/週末；GD 才有）
    const hourAgg = { wk: {}, we: {} }, hourN = { wk: 0, we: 0 }
    for (const e of w30) {
      const sheet = ((dayDet2(e.date) || {}).sheets || {})['時段分析(每小時)']
      const rows2 = Array.isArray(sheet) && sheet[0] ? (sheet[0].rows || []) : []
      if (!rows2.length) continue
      const wd2 = new Date(e.date + 'T00:00:00Z').getUTCDay()
      const kk = (wd2 === 0 || wd2 === 6) ? 'we' : 'wk'
      hourN[kk]++
      for (const r of rows2) { const h = parseInt(r[0]); if (!isNaN(h)) hourAgg[kk][h] = (hourAgg[kk][h] || 0) + (Number(r[1]) || 0) }
    }
    const slots2 = {}
    for (const kk of ['wk', 'we']) slots2[kk] = Object.entries(hourAgg[kk]).map(([h, t]) => [Number(h), Math.round(t / Math.max(1, hourN[kk]) * 10) / 10]).sort((a, b) => a[0] - b[0])
    // 14:00 前的單量佔比（平日；備料節奏推估用——品項無分時資料，用全店時段分佈當比例）
    const wkTot2 = slots2.wk.reduce((t, a) => t + a[1], 0)
    const share14 = wkTot2 ? Math.round(slots2.wk.filter(a => a[0] < 14).reduce((t, a) => t + a[1], 0) / wkTot2 * 100) : null
    // 🔥 時段營收熱力圖（張良 2026-10-05「之前的營收時間熱力圖放每日數據下面」）：{date:{hour:rev}}；近120天有日結時段表的日子；GD/AB 都給
    // 口徑＝時段表最後一欄＝營收（與 App 熱力圖同一份：det.sheets['時段分析(每小時)']）
    const hourDays = {}
    const fromHD = dOf(anchor, -120)
    for (const e of entries) {
      if (e.date < fromHD) continue
      const sheet = ((dayDet2(e.date) || {}).sheets || {})['時段分析(每小時)']
      const rows3 = Array.isArray(sheet) && sheet[0] ? (sheet[0].rows || []) : []
      if (!rows3.length) continue
      const hm = {}
      for (const r of rows3) { const h = parseInt(r[0]); if (!isNaN(h)) hm[h] = (hm[h] || 0) + (Number(r[r.length - 1]) || 0) }
      if (Object.keys(hm).length) hourDays[e.date] = hm
    }
    const rev30 = w30.reduce((t, e) => t + (Number(e.revenue) || 0), 0)
    // 預做節奏表（張良 2026-09-21：每15分×品項）：pm_pos_q_每日檔（joya-intraday 15分快照）相鄰差分 → 近7個營業日平均
    // 喬亞不給歷史時分 → 資料 2026-09-22 起累積；沒資料時 rhythm.days=0（前端顯示 0 佔位）
    let rhythm = null
    if (!isAB2) {
      const RSLOTS = []
      for (let t = 11 * 60; t <= 19 * 60 + 15; t += 15) RSLOTS.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')) // 桶＝起始時刻；19:30 快照的差分落在 19:15 桶
      // 平行抓最新 10 個營業日的快照檔、留有料的前 7 個（原本逐日串行＝慢；快照 9/22 起才有，早期日子抓了也是空）
      const qcand = datesAll.slice(-10).reverse()
      const qall = await Promise.all(qcand.map(dd4 => kvGet('sp_finance_pm_pos_q_' + dd4).catch(() => null)))
      const qdocs = qall.filter(qd => qd && Array.isArray(qd.slots) && qd.slots.length > 1).slice(0, 7)
      const bucket = {}
      for (const qd of qdocs) {
        const sl = [...qd.slots].sort((a, b) => (a.t < b.t ? -1 : 1))
        for (let i = 0; i < sl.length; i++) {
          const prevI = i ? (sl[i - 1].items || {}) : {}
          const bucketT = i ? sl[i - 1].t : '11:00' // 差分歸「前一格起始」桶；首張快照＝開店至該刻的量歸 11:00
          for (const [nm, qv] of Object.entries(sl[i].items || {})) {
            const dq = Math.max(0, (Number(qv) || 0) - (Number(prevI[nm]) || 0))
            if (!dq) continue
            let k3 = norm2(nm); k3 = aliasMap2[k3] || k3
            if (hiddenMap2[k3]) continue
            const o = bucket[k3] || (bucket[k3] = { n: nm, s: {} })
            o.n = nm
            o.s[bucketT] = (o.s[bucketT] || 0) + dq
          }
        }
      }
      const nD = qdocs.length
      // 完整菜單＋分類（張良 2026-09-21：不要只有 Top18）：照品項明細的品類順序全列，沒快照資料的顯示 0；隱藏另由 pm_prep_hide 前端過濾
      const rows3 = cats2.flatMap(c => c.items.map(it => {
        const b = bucket[it.k]
        return { n: it.n, k: it.k, cat: c.name, q: RSLOTS.map(t => (b && nD ? Math.round((b.s[t] || 0) / nD * 10) / 10 : 0)) }
      }))
      rhythm = { slots: RSLOTS, days: nD, items: rows3 }
    } else { // AB（張良 2026-09-22）：eats-rhythm 每天打烊後直接逐15分窗撈（pm_pos_q_ab_，值=該窗實賣，不用差分）
      const RS2 = []
      for (let t2 = 11 * 60 + 30; t2 <= 21 * 60 + 15; t2 += 15) RS2.push(String(Math.floor(t2 / 60)).padStart(2, '0') + ':' + String(t2 % 60).padStart(2, '0'))
      const qcand2 = datesAll.slice(-10).reverse()
      const qall2 = await Promise.all(qcand2.map(dd4 => kvGet('sp_finance_pm_pos_q_ab_' + dd4).catch(() => null)))
      const qdocs2 = qall2.filter(qd => qd && Array.isArray(qd.slots) && qd.slots.length > 0).slice(0, 7)
      const bucket2 = {}
      for (const qd of qdocs2) for (const sl of qd.slots) for (const [nm, qv] of Object.entries(sl.items || {})) {
        let k3 = norm2(nm); k3 = aliasMap2[k3] || k3
        if (hiddenMap2[k3]) continue
        const o = bucket2[k3] || (bucket2[k3] = { s: {} })
        o.s[sl.t] = (o.s[sl.t] || 0) + (Number(qv) || 0)
      }
      const nD2 = qdocs2.length
      const rows4 = cats2.flatMap(c => c.items.map(it => { const b = bucket2[it.k]; return { n: it.n, k: it.k, cat: c.name, q: RS2.map(t2 => (b && nD2 ? Math.round((b.s[t2] || 0) / nD2 * 10) / 10 : 0)) } }))
      rhythm = { slots: RS2, days: nD2, items: rows4 }
    }
    // AB 停售動態（張良 2026-09-30：不只通知——看板要能隨時查現在+歷史）
    let soldout = null
    if (isAB2) { const soD = await kvGet('sp_finance_pm_absoldout'); if (soD) soldout = { current: soD.current || {}, log: (soD.log || []).slice(0, 150) } }
    // 📜 歷史月營收（張良 2026-10-04「補在哪？現在主要都用prep」）：有日結的月份=entries 加總（跟 KPI/每日數據同口徑）、
    // 更早（iCHEF 時代 2021-02 起）=阿桑 /revenue/monthly 月彙總（sp_finance_pm_boss_revm；只有 AB 有）
    let hist = []
    try {
      const byMoH = {}
      for (const e of entries) {
        const mo9 = e.date.slice(0, 7)
        const o = byMoH[mo9] = byMoH[mo9] || { month: mo9, revenue: 0, bills: 0, customers: 0, days: 0 }
        o.revenue += Number(e.revenue) || 0; o.bills += Number(e.txCount) || 0; o.customers += Number(e.guests) || 0; o.days++
      }
      if (storeQ === 'abeach') {
        const revmD = (await kvGet('sp_finance_pm_boss_revm')) || {}
        for (const m9 of Object.values(revmD.rows || {})) {
          if (m9?.month && !byMoH[m9.month]) byMoH[m9.month] = { month: m9.month, revenue: Number(m9.revenue) || 0, bills: m9.bills ?? null, customers: m9.customers ?? null, days: (m9.sources || [])[0]?.open_days ?? m9.days_with_data ?? null }
        }
      }
      hist = Object.values(byMoH).sort((a, b) => (a.month < b.month ? 1 : -1))
    } catch (_) {}
    // Vercel 邊緣快取 5 分鐘（張良 2026-09-21 嫌慢）：同網址請求直接吃 CDN 不進函式重算；資料本來 15 分一更，5 分快取無感
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
    return res.status(200).json({
      ok: true, store: storeQ, updatedAt: new Date().toISOString(), anchor, hist,
      kpi: { rev30, days30: w30.length, avgRev: w30.length ? Math.round(rev30 / w30.length) : 0, tx30: w30.reduce((t, e) => t + (Number(e.txCount) || 0), 0) },
      n30, prep, prepAct: Object.fromEntries(Object.entries((actDoc.days || {})[todayAct] || {}).filter(([, v]) => v.q != null).map(([k, v]) => [k, v.q])), prepS86: Object.fromEntries(Object.entries((actDoc.days || {})[todayAct] || {}).filter(([, v]) => v.s86 && v.s86.on).map(([k]) => [k, 1])), prepActDate: todayAct, share14, rhythm, soldout, days: days2.reverse(), setPcts: setDays.reverse(), dates: datesAll, cats: cats2, hidden: Object.values(itemsH2).map(o => ({ n: o.n, k: o.k, cat: o.cat, cum30: o.q30 })), slots: (slots2.wk.length || slots2.we.length) ? slots2 : null,
      hourDays: Object.keys(hourDays).length ? hourDays : null,
    })
  }
  // 內用/外帶歷史回補口（同金鑰，張良 2026-09-20 內外帶接進報表）：?dinefill=<key>[&dry=1]
  // 把 GROUN:D 已入庫、還沒有 dineTx 欄的日子逐日抓 salesMethod 補上（新日子入庫時已自動帶）
  if (req.query?.dinefill) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.dinefill) !== mk) return res.status(403).json({ ok: false })
    const store = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
    const targets = (store.entries || []).filter(e => /groun/i.test(e.store || '') && e.dineTx === undefined)
    if (String(req.query.dry || '')) return res.status(200).json({ ok: true, dry: true, n: targets.length, dates: targets.map(e => e.date) })
    const cookie = await joyaLogin()
    const done = [], fail = []
    for (const e of targets) {
      try { const ms = await joyaFetchSalesMethod(cookie, e.date); Object.assign(e, parseSalesMethod(ms)); done.push(e.date) } catch (_) { fail.push(e.date) }
    }
    if (done.length) { store.updatedAt = new Date().toISOString(); await kvPut('sp_finance_pm_pos', store, '內外帶回補口'); await announceChanged() }
    return res.status(200).json({ ok: true, done: done.length, fail })
  }
  // 品項改名對照管理口（同金鑰，張良 2026-09-19 菜名更新要合併歷史數據）：
  // GET  ?aliasget=<key>                          → 看目前對照表
  // POST ?priceset=<MENU_PROBE_KEY> body={store, set:{品名:牌價,…}, del:[品名,…]}——灌/改牌價（pm_pos_prices 手填優先那份；張良 2026-09-22 菜單牌價灌檔用）
  if (req.method === 'POST' && req.query?.priceset) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.priceset) !== mk) return res.status(403).json({ ok: false })
    let pb2 = {}
    try { pb2 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const stP = pb2.store === 'abeach' ? 'abeach' : 'ground'
    const doc = (await kvGet('sp_finance_pm_pos_prices')) || {}
    doc[stP] = doc[stP] || {}
    let nSet = 0, nDel = 0
    for (const [k3, v3] of Object.entries(pb2.set || {})) { const nv = Number(v3); if (isFinite(nv)) { doc[stP][String(k3)] = nv; nSet++ } }
    for (const k3 of (pb2.del || [])) if (doc[stP][k3] != null) { delete doc[stP][k3]; nDel++ }
    await kvPut('sp_finance_pm_pos_prices', doc, '牌價灌檔(priceset)')
    await announceChanged()
    return res.status(200).json({ ok: true, set: nSet, del: nDel, total: Object.keys(doc[stP]).length })
  }
  // POST ?aliasset=<key>  body={store:"abeach"|"ground", set:{舊key:新key,…}, del:[舊key,…]}
  // key 規則：A Beach 用 abNorm 後的 key（去 emoji/空白）、GROUN:D 用品項原名；前端品項明細/30日均/AI 都吃這份
  if (req.query?.aliasget) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.aliasget) !== mk) return res.status(403).json({ ok: false })
    return res.status(200).json({ ok: true, alias: (await kvGet('sp_finance_pm_pos_alias')) || {} })
  }
  if (req.method === 'POST' && req.query?.aliasset) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.aliasset) !== mk) return res.status(403).json({ ok: false })
    let body2 = {}
    try { body2 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const st2 = body2.store === 'ground' ? 'ground' : body2.store === 'abeach' ? 'abeach' : null
    if (!st2) return res.status(400).json({ ok: false, error: 'store 要是 abeach 或 ground' })
    const cur2 = (await kvGet('sp_finance_pm_pos_alias')) || {}
    const m3 = { ...(cur2[st2] || {}) }
    for (const [o3, n3] of Object.entries(body2.set || {})) { if (typeof n3 === 'string' && n3.trim()) m3[o3] = n3 }
    for (const o3 of (Array.isArray(body2.del) ? body2.del : [])) delete m3[o3]
    const next2 = { ...cur2, [st2]: m3 }
    await kvPut('sp_finance_pm_pos_alias', next2, '改名對照口')
    await announceChanged() // 開著的營運報表即刻套用合併
    return res.status(200).json({ ok: true, store: st2, n: Object.keys(m3).length, alias: next2 })
  }
  // ── GD 每日 SOP（張良 2026-09-21 /prep 幹成 App）：每站每天 SOP＋拍照上傳＋完成記時；超時通知在 joya-intraday cron ──
  // 定義存 sp_finance_pm_sop_def={ground:{items:[{id,st,title,due:"HH:MM",photo}]}}；每日紀錄 sp_finance_pm_sop_g_<日期>={items:{id:{done,ts,by,photo}},notified:{}}
  // GET  ?sop=<OPS_BOARD_KEY>     → 今日清單＋完成狀態＋名冊姓名（打卡選人用）
  // POST ?sopdone=<OPS_BOARD_KEY> body={itemId,by,undo,photo(dataURL)} → 打卡/撤銷；照片傳 Supabase photos/sop/
  // POST ?sopset=<MENU_PROBE_KEY> body={items:[…]} → 整份覆蓋定義（跟我用對話增刪改）
  const sopToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  // 綁定 token → 本人（LINE「綁定看板」發的個人連結；打卡/編輯身分都以此為準，前端傳的名字只是備援）
  // 權限模型（張良 2026-09-25 拍板）：訪客=只能看／綁定=一般(記名操作)／名冊 gdRole 可設 主管/停權；停權=所有寫入自動擋
  // （sopWho/permWho 已上移到 handler 開頭——2026-10-02 修 TDZ：kvproxy/whoami 跑在宣告前會炸＝身分膠囊訪客真因）
  // GD 人員名單（張良 2026-09-21：主App名冊標記 p.gd 的人＝排班/任務/回饋下拉選單；沒標任何人時退回在職全員）
  const gdNames = (rosterDoc) => {
    const alive = (((rosterDoc || {}).people) || []).filter(p2 => !p2.endDate && (p2.status || '在職') !== '離職')
    const gd = alive.filter(p2 => p2.gd).map(p2 => p2.name).filter(Boolean)
    return gd.length ? gd : alive.map(p2 => p2.name).filter(Boolean)
  }
  // ── 🔔 群組通知開關（張良 2026-09-21：主動群通知先全關，每項獨立開關；審核人可改）──
  // keys：buy=採購需求 / sopLate=SOP超時 / lowStock=庫存低水位 / prep0930=每日09:30備料訊息
  if (req.query?.notifycfg) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.notifycfg) !== ok2) return res.status(403).json({ ok: false })
    const [cfgN, meN2] = await Promise.all([kvGet('sp_finance_pm_notify'), sopWho(req.query.me)])
    const defN = await kvGet('sp_finance_pm_sop_def')
    const aprN = (((defN || {}).ground || {}).approvers || ['張良瑋'])
    return res.status(200).json({ ok: true, cfg: cfgN || {}, canEdit: !!(meN2 && aprN.includes(meN2.name)) })
  }
  // 🔔 通知開關管理口（v4.51.1 CC：張良透過 CC 開/關任一群通知）：GET ?notifyadmin=<MENU_PROBE_KEY>&key=prep0930&val=0
  if (req.query?.notifyadmin) {
    const mk9 = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk9 || String(req.query.notifyadmin) !== mk9) return res.status(403).json({ ok: false })
    const kN9 = String(req.query.key || '')
    if (!['buy', 'sopLate', 'lowStock', 'prep0930', 'staleItem', 'soldoutAB'].includes(kN9)) return res.status(400).json({ ok: false, error: '未知開關' })
    const doc9 = (await kvGet('sp_finance_pm_notify')) || {}
    if (req.query.val != null) { doc9[kN9] = Number(req.query.val) === 1 ? 1 : 0; await kvPut('sp_finance_pm_notify', doc9, 'CC改通知開關 ' + kN9 + '=' + doc9[kN9]) }
    return res.status(200).json({ ok: true, cfg: doc9 })
  }
  if (req.method === 'POST' && req.query?.notifyset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.notifyset) !== ok2) return res.status(403).json({ ok: false })
    let nb = {}
    try { nb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoN2 = await sopWho(nb.token)
    const defN = await kvGet('sp_finance_pm_sop_def')
    const aprN = (((defN || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoN2 || !aprN.includes(whoN2.name)) return res.status(403).json({ ok: false, error: '只有審核人能改通知開關' })
    const KEYSN = ['buy', 'sopLate', 'lowStock', 'prep0930', 'staleItem', 'soldoutAB']
    const doc = (await kvGet('sp_finance_pm_notify')) || {}
    for (const k2 of KEYSN) if (nb.cfg && k2 in nb.cfg) doc[k2] = nb.cfg[k2] ? 1 : 0
    await kvPut('sp_finance_pm_notify', doc, '通知開關(' + whoN2.name + ')')
    return res.status(200).json({ ok: true, cfg: doc })
  }
  // ── 👥 GD 人員直編（張良 2026-09-24：班表頁加人/移除＝改名冊 p.gd 標記，主App同步）：POST ?gdstaff= {op:'add'|'del', name, token}
  if (req.method === 'POST' && req.query?.gdstaff) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.gdstaff) !== ok2) return res.status(403).json({ ok: false })
    let gb = {}
    try { gb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoG = await permWho(gb.token, 'shift') // v4.34.0 人員管理=要班表編輯權（原本綁定即可=漏洞）
    if (!whoG) return res.status(403).json({ ok: false, error: permDeny() })
    { const defG = await kvGet('sp_finance_pm_sop_def'); const aprG = (((defG || {}).ground || {}).approvers || ['張良瑋']); if (whoG.role !== '主管' && !aprG.includes(whoG.name)) return res.status(403).json({ ok: false, error: '人員名單由主管/審核人管理' }) }
    const rosterG = (await kvGet('sp_crew_kb_roster')) || { people: [] }
    const pG = (rosterG.people || []).find(p2 => p2.name === String(gb.name || '').trim() && !p2.endDate)
    if (!pG) return res.status(404).json({ ok: false, error: '名冊裡找不到這個人（先在主 App 名冊新增）' })
    // 首次操作落地（張良 2026-09-24「刪除沒反應」根因：沒人標記時名單=在職全員fallback，刪不存在的標記當然沒反應）
    // → 第一次增刪先把「目前顯示的全員名單」寫成正式標記，之後增刪才有東西可動
    const alive = (rosterG.people || []).filter(p2 => !p2.endDate && (p2.status || '在職') !== '離職')
    if (!alive.some(p2 => p2.gd)) alive.forEach(p2 => { p2.gd = 1 })
    if (gb.op === 'add') pG.gd = 1
    else if (gb.op === 'del') delete pG.gd
    else return res.status(400).json({ ok: false })
    await kvPut('sp_crew_kb_roster', rosterG, 'GD人員' + gb.op + '(' + whoG.name + ')')
    return res.status(200).json({ ok: true })
  }
  // 一次性：刪參考店數據（張良 2026-09-24 指示「刪除相關設定及數據」）：GET ?ichefpurge=<MENU_PROBE_KEY>
  if (req.query?.ichefpurge) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.ichefpurge) !== mk) return res.status(403).json({ ok: false })
    const r2 = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.sp_finance_pm_ichef`, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    return res.status(200).json({ ok: r2.ok, deleted: 'sp_finance_pm_ichef' })
  }
  // ── 🎚 權限設定（張良 2026-09-25：人員名單可設每人權限）：POST ?gdrole= {name, role:一般|主管|停權, token}（主管/審核人限定）
  if (req.method === 'POST' && req.query?.gdrole) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.gdrole) !== ok2) return res.status(403).json({ ok: false })
    let rb = {}
    try { rb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoR3 = await permWho(rb.token, 'shift') // v4.34.0 角色管理=要班表編輯權
    const defR3 = await kvGet('sp_finance_pm_sop_def')
    const aprR3 = (((defR3 || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoR3 || (whoR3.role !== '主管' && !aprR3.includes(whoR3.name))) return res.status(403).json({ ok: false, error: '權限由主管/審核人設定' })
    // v4.41.3 兩口合一（張良按主管跳「名冊找不到」真因＝權限表送 rid、這個舊口只認 name；新口排後面被這裡攔截）：同時收 rid/name；職級加 PT/正職（''/一般=清除）
    if (!['一般', '主管', '停權', 'PT', '正職', ''].includes(String(rb.role || ''))) return res.status(400).json({ ok: false })
    const rosterR = (await kvGet('sp_crew_kb_roster')) || { people: [] }
    const ridQ3 = String(rb.rid || '')
    const pR = ridQ3
      ? (rosterR.people || []).find(p2 => String(p2.id) === ridQ3)
      : (rosterR.people || []).find(p2 => p2.name === String(rb.name || '').trim() && !p2.endDate)
    if (!pR) return res.status(404).json({ ok: false, error: '名冊找不到這個人' })
    if (aprR3.includes(pR.name) && rb.role === '停權') return res.status(400).json({ ok: false, error: '審核人不能停權自己人 😄' })
    if (rb.role === '一般' || rb.role === '') delete pR.gdRole; else pR.gdRole = rb.role
    await kvPut('sp_crew_kb_roster', rosterR, 'GD權限(' + whoR3.name + '→' + pR.name + '=' + rb.role + ')')
    return res.status(200).json({ ok: true })
  }
  // ── 📈 銷量預測 P1（張良 2026-09-25「開工」）：?fc=<OPS>&me=token 檢視（主管/審核人限定——夥伴只看備料卡一個數字）──
  if (req.query?.fc) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.fc) !== ok2) return res.status(403).json({ ok: false })
    const meF2 = await sopWho(req.query.me)
    const defF2 = await kvGet('sp_finance_pm_sop_def')
    const aprF2 = (((defF2 || {}).ground || {}).approvers || ['張良瑋'])
    if (!meF2 || (meF2.role !== '主管' && !aprF2.includes(meF2.name))) return res.status(403).json({ ok: false, error: '預測驗證區只開放主管/審核人' })
    const { fcLoadData, fcCompute } = await import('./_fc.js')
    const today2 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const cfgF = (await kvGet('sp_finance_pm_fc_cfg')) || {}
    const mkeys = [...new Set([ 'sp_finance_pm_fc_' + (() => { const m = today2.slice(0, 7); return `${Number(m.slice(0, 4)) - (m.slice(5) === '01' ? 1 : 0)}${String(((Number(m.slice(5, 7)) + 10) % 12) + 1).padStart(2, '0')}` })(), 'sp_finance_pm_fc_' + today2.slice(0, 7).replace('-', '') ])]
    const snapDocs = await Promise.all(mkeys.map(m => kvGet(m)))
    const allSnap = Object.assign({}, ...snapDocs.map(d => (d || {}).days || {}))
    const snaps = Object.entries(allSnap).map(([ds, s]) => ({ date: ds, preCalStore: s.preCalStore, actualStore: s.actual ? s.actual.total : null, selloutPre: 0 }))
    const data = await fcLoadData(kvGet, today2)
    const out = fcCompute(data, snaps, cfgF, today2)
    // 準確度（快照有實績的日子）：新模型 vs 舊法，全店＋品項層 WAPE、高低估、逐日勝負
    const days2 = Object.entries(allSnap).filter(([, s]) => s.actual).sort((a, b) => (a[0] < b[0] ? 1 : -1))
    const accOf = (nDays) => {
      const ds = days2.slice(0, nDays)
      let aeS = 0, aeB = 0, act = 0, overS = 0, underS = 0, overB = 0, underB = 0, aeSI = 0, aeBI = 0, actI = 0, winS = 0, winB = 0
      let aeF = 0
      ds.forEach(([, s]) => {
        const a = s.actual.total
        const fin = s.finalStore != null ? s.finalStore : s.sysStore
        act += a; aeS += Math.abs(s.sysStore - a); aeB += Math.abs((s.baseStore || 0) - a); aeF += Math.abs(fin - a)
        if (s.sysStore > a) overS += s.sysStore - a; else underS += a - s.sysStore
        if ((s.baseStore || 0) > a) overB += (s.baseStore || 0) - a; else underB += a - (s.baseStore || 0)
        if (Math.abs(s.sysStore - a) < Math.abs((s.baseStore || 0) - a)) winS++; else if (Math.abs(s.sysStore - a) > Math.abs((s.baseStore || 0) - a)) winB++
        const ks = new Set([...Object.keys(s.items || {}), ...Object.keys(s.actual.items || {}), ...Object.keys(s.baseItems || {})])
        ks.forEach(k => { const ai = s.actual.items[k] || 0; actI += ai; aeSI += Math.abs((s.items[k] || 0) - ai); aeBI += Math.abs(Math.round(s.baseItems ? (s.baseItems[k] || 0) : 0) - ai) })
      })
      return { days: ds.length, act, store: { wapeF: act ? Math.round(aeF / act * 1000) / 10 : null, wapeS: act ? Math.round(aeS / act * 1000) / 10 : null, wapeB: act ? Math.round(aeB / act * 1000) / 10 : null, overS, underS, overB, underB, winS, winB }, item: { wapeS: actI ? Math.round(aeSI / actI * 1000) / 10 : null, wapeB: actI ? Math.round(aeBI / actI * 1000) / 10 : null } }
    }
    const daily = days2.slice(0, 14).map(([ds, s]) => ({ date: ds, actual: s.actual.total, sys: s.sysStore, base: s.baseStore || 0 }))
    const todaySnap = allSnap[today2] || null
    return res.status(200).json({ ok: true, today: today2, fc: out, acc7: accOf(7), acc28: accOf(28), daily, snapDays: days2.length,
      special: cfgF.special || {}, adj: cfgF.adj || {}, todaySoldout: todaySnap ? (todaySnap.soldout || []) : null })
  }
  // ── P2 輸入口（張良 2026-09-26）──
  // 今日賣完勾選（收班時；綁定者都能勾＝現場的人才知道）：GET ?fcso= 列表；POST {k,on}
  if (req.query?.fcso) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.fcso) !== ok2) return res.status(403).json({ ok: false })
    const today2 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const mk2 = 'sp_finance_pm_fc_' + today2.slice(0, 7).replace('-', '')
    const doc = (await kvGet(mk2)) || { days: {} }
    const snap = doc.days[today2]
    if (req.method !== 'POST') {
      if (!snap) return res.status(200).json({ ok: true, none: '今天沒有預測快照（假日或還沒 11:00）' })
      return res.status(200).json({ ok: true, date: today2, items: Object.entries(snap.names || {}).map(([k, n]) => ({ k, n, so: (snap.soldout || []).includes(k) })) })
    }
    let sb3 = {}
    try { sb3 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoSo = await sopWho(sb3.token)
    if (!whoSo) return res.status(403).json({ ok: false, error: permDeny() })
    if (!snap) return res.status(400).json({ ok: false, error: '今天沒有預測快照' })
    snap.soldout = snap.soldout || []
    const has = snap.soldout.includes(sb3.k)
    if (sb3.on && !has) snap.soldout.push(sb3.k)
    if (!sb3.on && has) snap.soldout = snap.soldout.filter(x => x !== sb3.k)
    snap.soldoutBy = whoSo.name; snap.soldoutTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    await kvPut(mk2, doc, '賣完勾選(' + whoSo.name + ')')
    return res.status(200).json({ ok: true, soldout: snap.soldout })
  }
  // 特殊日標記（主管/審核人）：POST ?fcsp= {date, note, del}
  if (req.method === 'POST' && req.query?.fcsp) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.fcsp) !== ok2) return res.status(403).json({ ok: false })
    let pb3 = {}
    try { pb3 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoSp = await sopWho(pb3.token)
    const defSp = await kvGet('sp_finance_pm_sop_def')
    const aprSp = (((defSp || {}).ground || {}).approvers || ['張良瑋'])
    const mkSp = (process.env.MENU_PROBE_KEY || '').trim()
    const byAdmin = mkSp && String(pb3.force || '') === mkSp // 管理金鑰（後台維運標記用，留痕=系統）
    if (!byAdmin && (!whoSp || (whoSp.role !== '主管' && !aprSp.includes(whoSp.name)))) return res.status(403).json({ ok: false, error: '特殊日由主管/審核人標記' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pb3.date || '')) return res.status(400).json({ ok: false })
    const cfgD = (await kvGet('sp_finance_pm_fc_cfg')) || {}
    cfgD.special = cfgD.special || {}
    if (pb3.del) delete cfgD.special[pb3.date]
    else cfgD.special[pb3.date] = String(pb3.note || '特殊日').slice(0, 40) + '（' + (whoSp ? whoSp.name : '系統') + '）'
    await kvPut('sp_finance_pm_fc_cfg', cfgD, '特殊日(' + (whoSp ? whoSp.name : '系統') + ')')
    return res.status(200).json({ ok: true, special: cfgD.special })
  }
  // 人工預測調整（主管/審核人；必填原因；影響「還沒鎖定」的日子）：POST ?fcadj= {date, k, n, why}
  if (req.method === 'POST' && req.query?.fcadj) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.fcadj) !== ok2) return res.status(403).json({ ok: false })
    let ab3 = {}
    try { ab3 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoAd = await sopWho(ab3.token)
    const defAd = await kvGet('sp_finance_pm_sop_def')
    const aprAd = (((defAd || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoAd || (whoAd.role !== '主管' && !aprAd.includes(whoAd.name))) return res.status(403).json({ ok: false, error: '人工調整由主管/審核人設定' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ab3.date || '') || !ab3.k) return res.status(400).json({ ok: false })
    const nAdj = Math.round(Number(ab3.n) || 0)
    if (nAdj !== 0 && !String(ab3.why || '').trim()) return res.status(400).json({ ok: false, error: '人工調整必填原因（規格）' })
    const cfgA = (await kvGet('sp_finance_pm_fc_cfg')) || {}
    cfgA.adj = cfgA.adj || {}
    cfgA.adj[ab3.date] = cfgA.adj[ab3.date] || {}
    if (!nAdj) delete cfgA.adj[ab3.date][ab3.k]
    else cfgA.adj[ab3.date][ab3.k] = { n: nAdj, why: String(ab3.why).slice(0, 60), by: whoAd.name }
    if (!Object.keys(cfgA.adj[ab3.date]).length) delete cfgA.adj[ab3.date]
    await kvPut('sp_finance_pm_fc_cfg', cfgA, '預測人工調整(' + whoAd.name + ')')
    return res.status(200).json({ ok: true })
  }
  // 手動觸發快照/回填（管理金鑰）：GET ?fcrun=<MENU_PROBE_KEY>
  if (req.query?.fcrun) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.fcrun) !== mk) return res.status(403).json({ ok: false })
    const { fcDaily } = await import('./_fc.js')
    const today2 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const r6 = await fcDaily(kvGet, kvPut, today2)
    await announceChanged()
    return res.status(200).json({ ok: true, snapped: r6.snapped, backfilled: r6.backfilled, futureStore: r6.forecast.future.map(f => f.date + ':' + f.sys).join(' '), level: r6.forecast.level, calib: r6.forecast.calib })
  }
  // ── 🐞 App 錯誤自動回報 L1（張良 2026-09-26）：前端全域捕捉＋後端都打這口；同指紋去重、當日首見 DD 私訊審核人 ──
  if (req.method === 'POST' && req.query?.errlog) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.errlog) !== ok2) return res.status(403).json({ ok: false })
    let eb = {}
    try { eb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoE = await sopWho(eb.token).catch(() => null)
    const doc = (await kvGet('sp_finance_pm_errlog')) || { list: [] }
    const msg = String(eb.msg || '').slice(0, 300)
    if (!msg) return res.status(400).json({ ok: false })
    const fp = (msg + '|' + String(eb.src || '').slice(0, 80)).slice(0, 200) // 指紋＝訊息+來源
    const today3 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    let it = doc.list.find(x => x.fp === fp)
    if (it) { it.n = (it.n || 1) + 1; it.lastTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '); it.lastBy = whoE ? whoE.name : (it.lastBy || '訪客') }
    else {
      it = { id: 'er' + Date.now().toString(36), fp, msg, src: String(eb.src || '').slice(0, 120), page: String(eb.page || '').slice(0, 60), ver: String(eb.ver || '').slice(0, 20), stack: String(eb.stack || '').slice(0, 600), by: whoE ? whoE.name : '訪客', ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), day: today3, n: 1 }
      doc.list = [it, ...doc.list].slice(0, 200)
    }
    const notifyKey = fp + '|' + today3
    doc.notified = doc.notified || {}
    if (!doc.notified[notifyKey]) { // 同錯誤一天通知一次
      doc.notified = Object.fromEntries(Object.entries(doc.notified).filter(([k2]) => k2.endsWith(today3))) // 只留今天的鍵
      doc.notified[notifyKey] = 1
      try {
        const tkE = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        const [defE, rosterE] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
        for (const an of (((defE || {}).ground || {}).approvers || ['張良瑋'])) {
          const ap = ((rosterE || {}).people || []).find(p2 => p2.name === an && p2.lineUserId)
          if (tkE && ap) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkE }, body: JSON.stringify({ to: ap.lineUserId, messages: [{ type: 'text', text: `🐞 App 錯誤回報\n頁面：${it.page || '?'}（v${it.ver || '?'}）\n${it.msg}\n— ${it.by}・累計 ${it.n} 次\n（同錯誤今天不再通知；細節問 DD 或看 /prep 錯誤日誌）` }] }) })
        }
      } catch (_) {}
    }
    await kvPut('sp_finance_pm_errlog', doc, 'App錯誤回報')
    return res.status(200).json({ ok: true })
  }
  if (req.query?.errs) { // 檢視（主管/審核人）
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.errs) !== ok2) return res.status(403).json({ ok: false })
    const meE2 = await sopWho(req.query.me)
    const defE2 = await kvGet('sp_finance_pm_sop_def')
    const aprE2 = (((defE2 || {}).ground || {}).approvers || ['張良瑋'])
    if (!meE2 || (meE2.role !== '主管' && !aprE2.includes(meE2.name))) return res.status(403).json({ ok: false })
    const doc = (await kvGet('sp_finance_pm_errlog')) || { list: [] }
    return res.status(200).json({ ok: true, list: doc.list.slice(0, 50) })
  }
  // AB 停售手動掃描（張良 2026-09-30 基準灌檔/除錯）：GET ?abscan=<MENU_PROBE_KEY>——只更新狀態不發通知
  if (req.query?.abscan) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.abscan) !== mk) return res.status(403).json({ ok: false })
    const { eatsSession, eatsItemList } = await import('./_eats.js')
    const sessDoc = (await kvGet('sp_finance_pm_eats_sess')) || {}
    const sess = await eatsSession(sessDoc.device || process.env.EATS_DEVICE_COOKIE || '')
    const devN = Object.keys(sess.J.jar).find((k) => k.endsWith('|'))
    if (devN) await kvPut('sp_finance_pm_eats_sess', { device: devN + '=' + sess.J.jar[devN], updatedAt: new Date().toISOString() }, 'AB停售掃描')
    const items = await eatsItemList(sess)
    const hm2 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16)
    const today2 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const soDoc = (await kvGet('sp_finance_pm_absoldout')) || { current: {}, log: [] }
    const prev = soDoc.current || {}
    const nowSo = {}
    for (const it of items) if (/🚫/.test(it.n)) nowSo[it.n.replace(/🚫/g, '').trim()] = 1
    const added = Object.keys(nowSo).filter(n => !(n in prev)), removed = Object.keys(prev).filter(n => !(n in nowSo))
    soDoc.current = Object.fromEntries(Object.keys(nowSo).map(n => [n, prev[n] || (today2 + ' ' + hm2)]))
    added.forEach(n => { soDoc.current[n] = today2 + ' ' + hm2; soDoc.log.unshift({ d: today2, t: hm2, n, op: '停售' }) })
    removed.forEach(n => soDoc.log.unshift({ d: today2, t: hm2, n, op: '恢復' }))
    soDoc.log = soDoc.log.slice(0, 300)
    soDoc.day = today2
    await kvPut('sp_finance_pm_absoldout', soDoc, 'AB停售手動掃描')
    await announceChanged()
    return res.status(200).json({ ok: true, current: Object.keys(soDoc.current).length, added: added.length, removed: removed.length })
  }
  // ── 🔖 分頁自訂（張良 2026-09-22：分頁名稱＋排序可編輯，全裝置同步；pm_prep_tabs=UI設定）──
  if (req.query?.tabcfg) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.tabcfg) !== ok2) return res.status(403).json({ ok: false })
    const cfg = (await kvGet('sp_finance_pm_prep_tabs')) || {}
    return res.status(200).json({ ok: true, order: cfg.order || null, names: cfg.names || {} })
  }
  if (req.method === 'POST' && req.query?.tabset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.tabset) !== ok2) return res.status(403).json({ ok: false })
    let tb = {}
    try { tb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoT = await sopWho(tb.token)
    if (!whoT) return res.status(403).json({ ok: false, error: permDeny() })
    const KEYS = ['task', 'lb', 'food', 'pack', 'buy', 'meet', 'shift', 'inc', 'fb', 'menu']
    const order = (Array.isArray(tb.order) ? tb.order : []).filter(k2 => KEYS.includes(k2))
    KEYS.forEach(k2 => { if (!order.includes(k2)) order.push(k2) }) // 漏掉的補在後面
    const names = {}
    for (const k2 of KEYS) { const v2 = String((tb.names || {})[k2] || '').trim().slice(0, 12); if (v2) names[k2] = v2 }
    await kvPut('sp_finance_pm_prep_tabs', { order, names, by: whoT.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') }, '分頁自訂(' + whoT.name + ')')
    return res.status(200).json({ ok: true })
  }
  // ── 🙈 品項隱藏切換（張良 2026-09-22：/prep 品項明細也要隱藏管理；同 App 的 pm_pos_hidden，KV 廣播全裝置同步）──
  if (req.method === 'POST' && req.query?.poshide) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.poshide) !== ok2) return res.status(403).json({ ok: false })
    let ph = {}
    try { ph = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoH = await permWho(ph.token, 'board') // v4.34.0 品項隱藏=要首頁編輯權
    const mkH = (process.env.MENU_PROBE_KEY || '').trim()
    const byAdminH = mkH && String(ph.force || '') === mkH // 管理金鑰（後台維運下架用）
    if (!whoH && !byAdminH) return res.status(403).json({ ok: false, error: permDeny() })
    const stH = ph.store === 'abeach' ? 'abeach' : 'ground'
    const keyH = String(ph.key || '').slice(0, 80)
    if (!keyH) return res.status(400).json({ ok: false })
    const doc = (await kvGet('sp_finance_pm_pos_hidden')) || {}
    doc[stH] = doc[stH] || {}
    if (ph.hide) doc[stH][keyH] = 1; else delete doc[stH][keyH]
    await kvPut('sp_finance_pm_pos_hidden', doc, '品項隱藏(' + (whoH ? whoH.name : '系統') + ')')
    return res.status(200).json({ ok: true })
  }
  // ── 🍔 菜單編輯（張良 2026-09-22：base=既有菜單凍結快照、draft=新菜單大家協作編輯；diff 給夥伴看動了什麼）──
  if (req.query?.menu) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.menu) !== ok2) return res.status(403).json({ ok: false })
    const [mdoc0, meM2] = await Promise.all([kvGet('sp_finance_pm_menu'), sopWho(req.query.me)])
    let mdoc = mdoc0
    if (!mdoc || !mdoc.base) { // 首次：把既有菜單（2026-09 紙本）種進去，base 之後不動、draft 開放編輯
      const S = (nm, note, items) => ({ name: nm, note: note || '', items })
      const I = (id, nm, pr, note) => ({ id, name: nm, price: pr, note: note || '' })
      const seed = { note: '套餐玩法 +89 元＝任一主餐 ＋ 副食A區 ＋ 飲品B區', sections: [
        S('PIZZA 披薩', '主餐', [I('m01','經典瑪格麗特',330,'全日'), I('m02','蜂蜜五起司綜合堅果',380,'周一'), I('m03','辣楓糖臘腸培根',390,'周二'), I('m04','煙燻BBQ雞肉',360,'周三'), I('m05','松露菌菇',400,'周四'), I('m06','菠菜培根溫泉蛋',360,'周五')]),
        S('BURGERS 漢堡堡', '主餐', [I('m11','香煎去骨雞腿堡',180), I('m12','大阪燒煎雞腿堡',200), I('m13','美式牧場炸雞腿堡',180), I('m14','松露菌菇炸雞腿堡',200), I('m15','泰式椒麻炸雞腿堡',200), I('m16','川味微辣炸雞腿堡',200), I('m17','4oz 100%純牛肉起司堡',200), I('m18','8oz 雙層純牛肉起司堡',260)]),
        S('ROLLS 越法三明治', '主餐', [I('m21','生菜煎蛋越南三明治',120), I('m22','烤雞胸越南三明治',180), I('m23','BBQ烤豬肉越南三明治',180), I('m24','爐烤牛排越南三明治',260), I('m25','酥炸雞腿越南三明治',200)]),
        S('FAST IDEAS 輕鬆選', '前四項可當主餐', [I('m31','川味微辣炸雞 x2',160,'主餐'), I('m32','玻璃脆殼炸雞 x2',160,'主餐'), I('m33','松露菌菇義大利麵',160,'主餐'), I('m34','經典番茄肉醬義大利麵',160,'主餐'), I('m35','松露/肉醬薯條',90), I('m36','雙醬薯條',120), I('m37','費洛蒙起司薯條',160), I('m38','肉醬起司小洋芋',120), I('m39','烤地瓜海鹽焦糖冰淇淋',120)]),
        S('A區 套餐副食', '4選1（可單點）', [I('m41','可愛沙拉杯',60), I('m42','薯條',60), I('m43','番茄蔬菜湯',60), I('m44','酸奶油香煎小洋芋',80)]),
        S('B區 套餐飲品', '4選1（可單點）', [I('m51','可口可樂 原味/ZERO',50), I('m52','南非國寶茶',50,'#無咖啡因'), I('m53','自然四季春烏龍',60,'#日月老茶廠'), I('m54','台灣有機紅茶',60,'#自然農法')]),
        S('咖啡・其他飲品', '', [I('m61','美式咖啡',75,'冰/熱'), I('m62','國寶鮮奶茶',90,'#無咖啡因'), I('m63','經典拿鐵',90,'冰/熱'), I('m64','抹茶/可可拿鐵',100)]),
      ] }
      mdoc = { base: seed, draft: JSON.parse(JSON.stringify(seed)), edits: [] }
      await kvPut('sp_finance_pm_menu', mdoc, '菜單種子(既有菜單2026-09)')
    }
    const pmM = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {}, pending: {} }
    const meU = meM2 ? pmM.users[meM2.rid || meM2.uid] : null
    const meOut = meM2 ? { name: meM2.name, canEdit: pmM.mode !== 'approve' || !!(meU && meU.edit), admin: !!(meU && meU.admin), pendingMe: !!pmM.pending[meM2.rid || meM2.uid] } : null
    return res.status(200).json({ ok: true, imgs: mdoc.imgs || [], imgHist: Object.fromEntries(Object.entries(mdoc.imgHist || {}).map(([k, v]) => [k, (v || []).length])), base: mdoc.base, draft: mdoc.draft, edits: (mdoc.edits || []).slice(0, 15), me: meOut, perm: meOut && meOut.admin ? { mode: pmM.mode, users: Object.entries(pmM.users).map(([r, v]) => ({ rid: r, ...v })), pending: Object.entries(pmM.pending).map(([r, v]) => ({ rid: r, ...v })), removed: Object.entries(pmM.removed || {}).map(([r, v]) => ({ rid: r, ...v })) } : null })
  }
  // 菜單設計圖換圖（張良 2026-10-02：菜單頁頂四格圖，點看大圖、可各自換新圖）：POST ?menuimgset=<OPS_BOARD_KEY> {idx,url,token}
  if (req.method === 'POST' && req.query?.menuimgset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.menuimgset) !== ok2) return res.status(403).json({ ok: false })
    let bi = {}; try { bi = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoI = await permWho(bi.token, 'menu')
    if (!whoI) return res.status(403).json({ ok: false, error: permDeny() })
    const idx = Math.max(0, Math.min(3, Number(bi.idx) || 0))
    const doc = (await kvGet('sp_finance_pm_menu')) || {}
    doc.imgs = doc.imgs || []; doc.imgHist = doc.imgHist || {}
    let what
    if (bi.undo) { // ↩︎ 復原上一張（張良 2026-10-02：不小心換到要能退回）
      const h = doc.imgHist[idx] || []
      if (!h.length) return res.status(400).json({ ok: false, error: '這格沒有舊圖可復原' })
      doc.imgs[idx] = h.pop(); what = '復原菜單圖' + (idx + 1)
    } else {
      if (doc.imgs[idx]) { (doc.imgHist[idx] = doc.imgHist[idx] || []).push(doc.imgs[idx]); doc.imgHist[idx] = doc.imgHist[idx].slice(-10) }
      doc.imgs[idx] = String(bi.url || '').slice(0, 300); what = '換菜單圖' + (idx + 1)
    }
    doc.edits = [{ by: whoI.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what }, ...(doc.edits || [])].slice(0, 30)
    await kvPut('sp_finance_pm_menu', doc, '菜單圖(' + whoI.name + ')')
    return res.status(200).json({ ok: true, imgs: doc.imgs, imgHist: Object.fromEntries(Object.entries(doc.imgHist).map(([k, v]) => [k, v.length])) })
  }
  if (req.method === 'POST' && req.query?.menuset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.menuset) !== ok2) return res.status(403).json({ ok: false })
    let mb2 = {}
    try { mb2 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoM2 = (await (async () => { const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }; const w = await sopWho(mb2.token); if (pm.mode !== 'approve') return w || { name: '現場(未綁定)' }; const u = w && pm.users[w.rid || w.uid]; return (u && u.edit && (u.admin || !u.tabs || u.tabs['menu'] !== 0)) ? w : null })())
    if (!whoM2) return res.status(403).json({ ok: false, error: permDeny() })
    const doc = (await kvGet('sp_finance_pm_menu')) || {}
    if (!doc.base) return res.status(400).json({ ok: false, error: '先開一次菜單分頁讓系統種既有菜單' })
    // v4.52.6 批次補英文（張良上傳 4 張菜單圖→補所有品項含「已刪除」(在 base)的官方英文；只改 en 不動名稱/價格）
    if (mb2.enMap && typeof mb2.enMap === 'object' && !Array.isArray(mb2.enMap)) {
      let n9 = 0
      for (const s9 of ((doc.draft || {}).sections || [])) for (const i9 of (s9.items || [])) if (mb2.enMap[i9.id] !== undefined) { i9.en = String(mb2.enMap[i9.id]).slice(0, 80); n9++ }
      for (const s9 of ((doc.base || {}).sections || [])) for (const i9 of (s9.items || [])) if (mb2.enMap[i9.id] !== undefined) { i9.en = String(mb2.enMap[i9.id]).slice(0, 80); n9++ }
      await kvPut('sp_finance_pm_menu', doc, '批次補英文(' + whoM2.name + ') ' + n9 + '項')
      return res.status(200).json({ ok: true, updated: n9 })
    }
    const dr = mb2.draft || {}
    if (!Array.isArray(dr.sections)) return res.status(400).json({ ok: false, error: '格式不對' })
    const oldEn = {}; for (const s0 of ((doc.draft || {}).sections || [])) for (const i0 of (s0.items || [])) if (i0.en) oldEn[i0.id] = i0.en // 英文防蓋（2026-10-01：舊分頁整份存檔會把剛灌的英文清空）
    // 消毒＋上限（名稱80字/註記40字/價格0~9999/分類20個/品項每類60個）
    doc.draft = { note: String(dr.note || '').slice(0, 200), sections: dr.sections.slice(0, 20).map(s2 => ({
      name: String(s2.name || '').slice(0, 80), note: String(s2.note || '').slice(0, 60),
      items: (Array.isArray(s2.items) ? s2.items : []).slice(0, 60).map(i2 => ({
        id: String(i2.id || ('mn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))).slice(0, 20),
        name: String(i2.name || '').slice(0, 80), en: (i2.en !== undefined ? String(i2.en) : (oldEn[i2.id] || '')).slice(0, 80), np: Number(i2.np) > 0 ? Math.min(9999, Math.round(Number(i2.np))) : '', price: Math.max(0, Math.min(9999, Math.round(Number(i2.price) || 0))), note: String(i2.note || '').slice(0, 40), // v4.52.5 英文防蓋修正（張良「刪掉英文會自動跑回來」）：只有「根本沒送 en 欄位」(undefined=舊版整份存檔)才 fallback 舊值；明確送空字串=故意刪→存空
      })).filter(i2 => i2.name),
    })).filter(s2 => s2.name) }
    if (Array.isArray(mb2.purge) && mb2.purge.length) { // 永久刪除（張良 2026-10-01：不留在菜單上）
      const pg = new Set(mb2.purge.map(String))
      for (const s0 of ((doc.base || {}).sections || [])) s0.items = (s0.items || []).filter(i0 => !pg.has(String(i0.id)))
    }
    doc.edits = [{ by: whoM2.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: String(mb2.what || '').slice(0, 80) }, ...(doc.edits || [])].slice(0, 30)
    await kvPut('sp_finance_pm_menu', doc, '新菜單編輯(' + whoM2.name + ')')
    return res.status(200).json({ ok: true })
  }
  // ── 💬 每日回饋（張良 2026-09-22：每天對有上班的人做文字回饋＋評分1~5星；一人一天對一人一則可改）──
  if (req.query?.fb) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.fb) !== ok2) return res.status(403).json({ ok: false })
    const dtF = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const [fbDoc, meF, rosterF, fbjDoc, defFb] = await Promise.all([kvGet('sp_finance_pm_fb'), sopWho(req.query.me), kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_fbj'), kvGet('sp_finance_pm_sop_def')])
    const pjF = await import('./punch.js')
    let pchF = []
    try { pchF = await pjF.listPunches('sp_crew_pch_' + dtF.replace(/-/g, '')) } catch (_) {}
    const workers = [...new Set(pchF.map(p2 => p2.name))].filter(Boolean)
    const namesF = gdNames(rosterF)
    const fbs = ((fbDoc || {}).list || []).filter(x => x.date === dtF)
    // 每日回饋紀錄（張良 2026-09-22：每人每天發現問題要發——文字/照片/影片、可多則、選站別）
    const jn = ((fbjDoc || {}).list || []).filter(x => x.date === dtF)
    const stationsF = (((defFb || {}).ground || {}).stations || [])
    return res.status(200).json({ ok: true, date: dtF, workers, names: namesF, fbs, jn, stations: stationsF, me: meF ? { name: meF.name } : null })
  }
  // 每日回饋紀錄：POST ?fbj= {op:'add', date?, st, text, media[]} / {op:'del', id}（本人或審核人可刪）
  if (req.method === 'POST' && req.query?.fbj) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.fbj) !== ok2) return res.status(403).json({ ok: false })
    let jb = {}
    try { jb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoJ = await permWho(jb.token, 'fb')
    if (!whoJ) return res.status(403).json({ ok: false, error: permDeny() })
    const doc = (await kvGet('sp_finance_pm_fbj')) || { list: [] }
    if (jb.op === 'add') {
      if (!String(jb.text || '').trim() && !(jb.media || []).length) return res.status(400).json({ ok: false, error: '寫點文字或附照片/影片' })
      const it = { id: 'fj' + Date.now().toString(36), date: /^\d{4}-\d{2}-\d{2}$/.test(jb.date || '') ? jb.date : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), st: String(jb.st || '').slice(0, 20), text: String(jb.text || '').slice(0, 1000), media: (Array.isArray(jb.media) ? jb.media : []).slice(0, 6), by: whoJ.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16) }
      doc.list = [it, ...(doc.list || [])].slice(0, 800)
    } else if (jb.op === 'del') {
      const defJ = await kvGet('sp_finance_pm_sop_def')
      const aprJ = (((defJ || {}).ground || {}).approvers || ['張良瑋'])
      const it = (doc.list || []).find(x => x.id === jb.id)
      if (!it) return res.status(404).json({ ok: false })
      if (it.by !== whoJ.name && !aprJ.includes(whoJ.name)) return res.status(403).json({ ok: false, error: '只能刪自己的' })
      doc.list = doc.list.filter(x => x.id !== jb.id)
    } else return res.status(400).json({ ok: false })
    await kvPut('sp_finance_pm_fbj', doc, '每日回饋紀錄(' + whoJ.name + ')')
    return res.status(200).json({ ok: true })
  }
  if (req.method === 'POST' && req.query?.fbset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.fbset) !== ok2) return res.status(403).json({ ok: false })
    let fbB = {}
    try { fbB = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoF = await permWho(fbB.token, 'fb')
    if (!whoF) return res.status(403).json({ ok: false, error: permDeny() })
    const dtF = /^\d{4}-\d{2}-\d{2}$/.test(String(fbB.date || '')) ? String(fbB.date) : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const tgF = String(fbB.target || '').trim().slice(0, 20)
    const svF = Math.round(Number(fbB.stars))
    if (!tgF) return res.status(400).json({ ok: false, error: '要選對象' })
    if (tgF === whoF.name) return res.status(400).json({ ok: false, error: '不能回饋自己 😄' })
    if (!(svF >= 1 && svF <= 5) && !String(fbB.text || '').trim()) return res.status(400).json({ ok: false, error: '評分或文字至少一樣' })
    const doc = (await kvGet('sp_finance_pm_fb')) || { list: [] }
    doc.list = doc.list || []
    let it = doc.list.find(x => x.date === dtF && x.target === tgF && x.by === whoF.name)
    if (!it) { it = { id: 'fb' + Date.now().toString(36), date: dtF, target: tgF, by: whoF.name }; doc.list.unshift(it) }
    if (svF >= 1 && svF <= 5) it.stars = svF
    it.text = String(fbB.text || '').slice(0, 1000)
    it.ts = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    doc.list = doc.list.slice(0, 1000)
    await kvPut('sp_finance_pm_fb', doc, '每日回饋(' + whoF.name + '→' + tgF + ')')
    return res.status(200).json({ ok: true, item: it })
  }
  // 一次性回填（張良 2026-09-21：既有 SOP 條目補 editBy/editTs＝最近一次儲存者；之後逐條照實記）：GET ?sopstamp=<MENU_PROBE_KEY>
  if (req.query?.sopstamp) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.sopstamp) !== mk) return res.status(403).json({ ok: false })
    const doc = (await kvGet('sp_finance_pm_sop_def')) || {}
    const g = doc.ground || {}
    const lastEd = (g.edits || [])[0] || {}
    const by0 = lastEd.by || '張良瑋'
    const ts0 = lastEd.ts ? new Date(new Date(lastEd.ts).getTime() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    let n = 0
    for (const it of (g.items || [])) if (!it.editBy) { it.editBy = by0; it.editTs = ts0; n++ }
    if (n) { doc.ground = g; await kvPut('sp_finance_pm_sop_def', doc, 'SOP編輯者回填') }
    return res.status(200).json({ ok: true, stamped: n, by: by0 })
  }
  // ── 🖼 SOP 標準照直改（張良 2026-09-22：列表點條目直接上傳，不用進總編輯）：POST ?sopref= {itemId, ref, token}
  if (req.method === 'POST' && req.query?.sopref) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopref) !== ok2) return res.status(403).json({ ok: false })
    let bR = {}
    try { bR = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoR2 = await permWho(bR.token, 'sop') // v4.34.0 SOP拆頁後守門跟上：board→sop
    if (!whoR2) return res.status(403).json({ ok: false, error: permDeny() })
    const doc = (await kvGet('sp_finance_pm_sop_def')) || {}
    const g = doc.ground || {}
    const it = (g.items || []).find(x => x.id === bR.itemId)
    if (!it) return res.status(404).json({ ok: false })
    const rf = String(bR.ref || '').slice(0, 500)
    if (rf) it.ref = rf; else delete it.ref
    it.editBy = whoR2.name; it.editTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    doc.ground = g
    await kvPut('sp_finance_pm_sop_def', doc, 'SOP標準照(' + whoR2.name + ')')
    return res.status(200).json({ ok: true, ref: it.ref || null })
  }
  // ── 📋 會議紀錄（張良 2026-09-21：班前會議/營運會議，類型可自訂、紀錄可新增刪改）──
  // ⚠️ 異常通知（張良 2026-10-03「/prep 多一個異常通知；AB=阿桑系統先上、之後 GD ERP 叫貨收貨也同步進同頁」）：
  // GET ?absinc=<OPS_KEY>[&me=]：讀 boss-api 交接異常近3個月（sp_finance_pm_boss_inc_ 月檔）；唯讀；store 欄位留給之後 GD
  if (req.query?.absinc) {
    const okI = (process.env.OPS_BOARD_KEY || '').trim()
    if (!okI || String(req.query.absinc) !== okI) return res.status(403).json({ ok: false })
    const tdI = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const mosI = [0, 1, 2].map(n => new Date(Date.UTC(+tdI.slice(0, 4), +tdI.slice(5, 7) - 1 - n, 1)).toISOString().slice(0, 7).replace('-', ''))
    const [meI, ...docsI] = await Promise.all([sopWho(req.query.me), ...mosI.map(m => kvGet('sp_finance_pm_boss_inc_' + m))])
    const listI = docsI.flatMap(d9 => Object.values((d9 || {}).rows || {})).map(x => ({
      id: x.incident_id, store: 'abeach', created: x.created_at, happened: x.happened_at || null,
      cat: [x.main_cat, x.cat, x.item].filter(Boolean).join('／'), station: x.station || '', target: x.target || '',
      detail: x.detail || '', status: x.status || '', stage: x.stage || '', urgency: x.urgency || '', importance: x.importance || '',
      by: x.reported_by_name || '', dept: x.reported_dept || '', assignee: x.assignee_name || '',
      resolveType: x.resolve_type || '', resolvedAt: x.resolved_at || null,
    }))
    const openI = listI.filter(x => !['closed', 'dismissed'].includes(x.status)).sort((a, b) => (String(a.created) < String(b.created) ? 1 : -1))
    const doneI = listI.filter(x => ['closed', 'dismissed'].includes(x.status)).sort((a, b) => (String(a.created) < String(b.created) ? 1 : -1))
    return res.status(200).json({ ok: true, open: openI.slice(0, 100), done: doneI.slice(0, 200), total: listI.length, me: meI ? { name: meI.name } : null })
  }
  if (req.query?.meet) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.meet) !== ok2) return res.status(403).json({ ok: false })
    const [md, meM, shM, defM] = await Promise.all([kvGet('sp_finance_pm_meet'), sopWho(req.query.me), kvGet('sp_finance_pm_shift_g'), kvGet('sp_finance_pm_sop_def')])
    // v4.16.0 簽收名單=常態人員（照班表⚙️排序-非常態）
    const rosM = await kvGet('sp_crew_kb_roster')
    const offM = new Set((shM || {}).offStaff || [])
    const regM = gdNames(rosM).filter(n => !offM.has(n))
    const aprM = (((defM || {}).ground || {}).approvers) || ['張良瑋']
    return res.status(200).json({ ok: true, types: ((md || {}).types || ['班前會議', '營運會議']), list: ((md || {}).list || []).slice(0, 200), regNames: regM, me: meM ? { name: meM.name, role: meM.role || '', approver: aprM.includes(meM.name) } : null })
  }
  if (req.method === 'POST' && req.query?.meetset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.meetset) !== ok2) return res.status(403).json({ ok: false })
    let mb = {}
    try { mb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoM = ['ack','view','ask'].includes(String(mb.op)) ? await sopWho(mb.token) : await permWho(mb.token, 'meet') // v4.34.0 簽收/看過/發問=人人可；增改刪/類型/回覆才要會議編輯權
    if (!whoM) return res.status(403).json({ ok: false, error: permDeny() })
    const doc = (await kvGet('sp_finance_pm_meet')) || { types: ['班前會議', '營運會議'], list: [] }
    if (!Array.isArray(doc.types) || !doc.types.length) doc.types = ['班前會議', '營運會議']
    const now8 = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    const mkItems = t2 => String(t2 || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 40).map((t3, i) => ({ id: 'mi' + Date.now().toString(36) + i, t: t3.slice(0, 200) }))
    const mkLinks = L => (Array.isArray(L) ? L : []).slice(0, 10).map(x => ({ label: String(x.label || '').slice(0, 40), url: String(x.url || '').slice(0, 300) })).filter(x => x.url)
    if (mb.op === 'add') { // v4.16.0 宣達：條列+附件+連結+簽收快照
      const shA = await kvGet('sp_finance_pm_shift_g')
      const rosA = await kvGet('sp_crew_kb_roster')
      const offA = new Set((shA || {}).offStaff || [])
      const ackNames = gdNames(rosA).filter(n => !offA.has(n))
      const it = { id: 'mt' + Date.now().toString(36), type: String(mb.type || doc.types[0]).slice(0, 20), date: /^\d{4}-\d{2}-\d{2}$/.test(mb.date) ? mb.date : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), text: String(mb.text || '').slice(0, 4000), items: mkItems(mb.text), media: (Array.isArray(mb.media) ? mb.media : []).slice(0, 10).map(u => String(u).slice(0, 300)), links: mkLinks(mb.links), ver: 1, pubTs: Date.now(), ackNames, acks: {}, views: {}, asks: [], remind: {}, by: whoM.name, ts: now8() }
      doc.list = [it, ...(doc.list || [])].slice(0, 500)
      // v4.48.0 張良「新增會議都同步發大群＋定位連結＋提醒簽到按確認＋顯示則數」：try 包住＝發群失敗也不影響會議已存
      try {
        const tkG = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        const GRP_FAM = (process.env.LINE_DEFAULT_GROUP || '').trim() || 'Cf7940efc6517b0c084ad2ad496b45f30' // GROUN:D Family
        if (tkG && GRP_FAM) {
          const { prepLink } = await import('./_webpush.js')
          const lnkG = prepLink('meet=' + it.id)
          const bodyG = `📢 新會議宣達【${it.type}・${it.date}】\n${String(it.text || '').slice(0, 300)}\n\n👉 點連結直達，看完按「✅ 確認熟知」完成簽到（${it.ackNames.length} 人要簽）\n${lnkG}`
          const rG = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkG }, body: JSON.stringify({ to: GRP_FAM, messages: [{ type: 'text', text: bodyG }] }), signal: AbortSignal.timeout(8000) }) // v4.52.4 8秒逾時＝LINE 慢也不拖垮整個存檔(504)
          if (rG.ok) { const nQ = it.ackNames.length || 1; try { const { logPush } = await import('./push.js'); await logPush(GRP_FAM, nQ, '會議宣達發大群(' + it.by + ')') } catch (_) {}; it.groupSent = { ts: now8(), n: nQ } } // 群發計費＝群人數×1則（line-quota）
          else { it.groupSent = { ts: now8(), fail: true } }
        }
      } catch (_) { it.groupSent = { ts: now8(), fail: true } }
    } else if (mb.op === 'edit') {
      const it = (doc.list || []).find(x => x.id === mb.id)
      if (!it) return res.status(404).json({ ok: false })
      if (mb.type) it.type = String(mb.type).slice(0, 20)
      if (/^\d{4}-\d{2}-\d{2}$/.test(mb.date)) it.date = mb.date
      const chgM = String(mb.text || '') !== String(it.text || '')
      it.text = String(mb.text || '').slice(0, 4000)
      it.items = mkItems(it.text)
      if (Array.isArray(mb.media)) it.media = mb.media.slice(0, 10).map(u => String(u).slice(0, 300))
      if (Array.isArray(mb.links)) it.links = mkLinks(mb.links)
      if (chgM && it.ackNames) { it.ver = (it.ver || 1) + 1; it.remind = {} } // 內容改了=v+1 要重簽（舊簽收留档但不算數）
      it.editedBy = whoM.name; it.editedTs = now8()
    } else if (mb.op === 'ack') { // ✅ 確認熟知
      const it = (doc.list || []).find(x => x.id === mb.id)
      if (!it) return res.status(404).json({ ok: false })
      it.acks = it.acks || {}; it.acks[whoM.name] = { ts: now8(), ver: it.ver || 1 }
      // v4.47.4 治本（張良「趙以棠按了會議確認已熟知 我這邊沒有通知」）：每人簽收→即時通知發起人(鈴鐺紅點+推播)，全員簽完→再加一則 LINE 私訊（關鍵節點才發，不每簽都吵）
      try {
        if (it.by && it.by !== whoM.name) { // 發起人自己簽自己發起的不用通知自己
          const ver9 = it.ver || 1
          const signed9 = (it.ackNames || []).filter(n => it.acks[n] && (it.acks[n].ver || 1) >= ver9).length
          const total9 = (it.ackNames || []).length
          const allDone9 = total9 > 0 && signed9 >= total9
          const bdK = (await kvGet('sp_finance_pm_prep_bind')) || {}
          let uidB = null, ridB = null
          for (const v of Object.values(bdK.tokens || {})) { if (v && v.name === it.by) { uidB = v.uid; ridB = v.rid || v.uid; break } }
          if (ridB) { const { wpPush } = await import('./_webpush.js'); await wpPush([ridB], { title: allDone9 ? '🎉 會議全員已簽收' : '✅ 會議簽收', body: `${whoM.name} 已確認熟知【${it.type}・${it.date}】（${signed9}/${total9}）`, url: '/prep#meet=' + it.id, cat: 'meet' }) }
          if (allDone9 && uidB) { // 全員簽完才加 LINE 私訊
            const tkB = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
            if (tkB) { await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkB }, body: JSON.stringify({ to: uidB, messages: [{ type: 'text', text: `🎉 會議全員已簽收【${it.type}・${it.date}】\n${total9} 人全部確認熟知，點開看 👇\nhttps://ground-pm.vercel.app/prep#meet=${it.id}` }] }) }).catch(() => {}); try { const { logPush } = await import('./push.js'); await logPush(uidB, 1, '會議全員簽收(' + it.by + ')') } catch (_) {} }
          }
        }
      } catch (_) {}
    } else if (mb.op === 'view') { // 點過連結/看過
      const it = (doc.list || []).find(x => x.id === mb.id)
      if (it) { it.views = it.views || {}; it.views[whoM.name] = now8() }
    } else if (mb.op === 'ask') { // ❓ 我想發問 → DD通知老闆+收件匣任務
      const it = (doc.list || []).find(x => x.id === mb.id)
      if (!it) return res.status(404).json({ ok: false })
      const qT = String(mb.q || '').trim().slice(0, 300)
      if (!qT) return res.status(400).json({ ok: false, error: '要寫問題' })
      it.asks = [...(it.asks || []), { id: 'ak' + Date.now().toString(36), q: qT, by: whoM.name, ts: now8(), status: 'open' }]
      try { // DD 私訊老闆群操作者
        const tkQ = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        const opsQ = (await kvGet('pm_bot_operators')) || {}
        const { logPush } = await import('./push.js')
        for (const uid of Object.keys(opsQ)) { if (tkQ) { await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkQ }, body: JSON.stringify({ to: uid, messages: [{ type: 'text', text: '❓ 會議宣達發問【' + it.type + ' ' + it.date + '】\n' + whoM.name + '：' + qT + '\n到 /prep → 會議 回覆（他會收到通知）' }] }) }); await logPush(uid, 1, '會議發問通知') } }
      } catch (_) {}
      try { // 收件匣任務（主App任務中心同步可見）
        await kvPut('sp_team_pm_task_mq' + Date.now().toString(36), { id: 'mq' + Date.now().toString(36), title: '❓會議發問：' + qT.slice(0, 40) + '（' + whoM.name + '）', note: '【' + it.type + ' ' + it.date + '】' + qT, status: 'todo', catId: '__inbox__', priority: 'normal', tags: ['會議'], by: whoM.name, createdAt: new Date().toISOString() }, '會議發問(' + whoM.name + ')')
      } catch (_) {}
    } else if (mb.op === 'answer') { // 老闆/主管回覆 → DD 通知提問人
      const it = (doc.list || []).find(x => x.id === mb.id)
      const ak = it && (it.asks || []).find(x => x.id === mb.askId)
      if (!ak) return res.status(404).json({ ok: false })
      const defQ = await kvGet('sp_finance_pm_sop_def')
      const aprQ = (((defQ || {}).ground || {}).approvers) || ['張良瑋']
      if (!(aprQ.includes(whoM.name) || whoM.role === '主管')) return res.status(403).json({ ok: false, error: '只有審核人／主管能回覆' })
      ak.ans = String(mb.ans || '').trim().slice(0, 500); ak.ansBy = whoM.name; ak.ansTs = now8(); ak.status = 'done'
      try {
        const tkA = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        const rosQ = await kvGet('sp_crew_kb_roster')
        const poQ = (((rosQ || {}).people) || []).find(p2 => p2.name === ak.by && p2.lineUserId)
        if (tkA && poQ) { await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkA }, body: JSON.stringify({ to: poQ.lineUserId, messages: [{ type: 'text', text: '💬 你的會議發問有回覆了【' + it.type + ' ' + it.date + '】\nQ：' + ak.q + '\nA：' + ak.ans + '（' + whoM.name + '）' }] }) }); const { logPush } = await import('./push.js'); await logPush(poQ.lineUserId, 1, '會議發問回覆') }
      } catch (_) {}
    } else if (mb.op === 'del') {
      doc.list = (doc.list || []).filter(x => x.id !== mb.id)
    } else if (mb.op === 'types') { // 類型自己增刪改名（整份存）
      const ts2 = (Array.isArray(mb.types) ? mb.types : []).map(s => String(s).trim().slice(0, 20)).filter(Boolean).slice(0, 10)
      if (!ts2.length) return res.status(400).json({ ok: false, error: '至少留一種會議類型' })
      doc.types = ts2
    } else if (mb.op === 'nudge') { // v4.47.3 點未簽的人→單獨 DD 私訊（個人連結直達該則）＋App 推播＋記催時間
      const it = (doc.list || []).find(x => x.id === mb.id); if (!it) return res.status(404).json({ ok: false })
      const nm = String(mb.name || '').trim(); if (!nm) return res.status(400).json({ ok: false, error: '缺名字' })
      const bdN = (await kvGet('sp_finance_pm_prep_bind')) || {}
      let tok = null, uid = null, rid = null
      for (const [k, v] of Object.entries(bdN.tokens || {})) { if (v && v.name === nm) { tok = k; uid = v.uid; rid = v.rid || v.uid; break } }
      const tkL = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
      let sent = 0
      if (uid && tkL) {
        const link = 'https://ground-pm.vercel.app/prep?me=' + tok + '#meet=' + it.id
        await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkL }, body: JSON.stringify({ to: uid, messages: [{ type: 'text', text: '📣 會議簽收提醒【' + it.type + '・' + it.date + '】\n' + whoM.name + ' 請你確認熟知，點開直達這則並簽收 👇\n' + link }] }) }).catch(() => {})
        try { const { logPush } = await import('./push.js'); await logPush(uid, 1, '會議個別催簽(' + nm + ')') } catch (_) {}
        sent++
      }
      if (rid) { try { const { wpPush } = await import('./_webpush.js'); await wpPush([rid], { title: '📣 會議簽收提醒', body: it.type + '・' + it.date + '（' + whoM.name + ' 提醒你簽收）', url: '/prep#meet=' + it.id, cat: 'meet' }) } catch (_) {} }
      it.nudges = it.nudges || {}; it.nudges[nm] = now8()
      await kvPut('sp_finance_pm_meet', doc, '會議催簽 ' + nm + '(' + whoM.name + ')')
      if (!uid && !rid) return res.status(200).json({ ok: false, error: nm + ' 還沒綁定 GD，私訊／推播都送不到——請他先綁定' })
      return res.status(200).json({ ok: true, sent: sent, nudged: nm })
    } else return res.status(400).json({ ok: false })
    await kvPut('sp_finance_pm_meet', doc, '會議' + mb.op + '(' + whoM.name + ')')
    return res.status(200).json({ ok: true })
  }
  // ── ⏰ /prep 一鍵打卡（張良 2026-09-21：綁定者直接打卡，寫進既有出勤系統 sp_crew_pch_ 法定逐筆檔＝與 iPad QR/LINE 備援同一套；自動判上下班、5分內可修方向）──
  if (req.method === 'POST' && req.query?.punchme) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.punchme) !== ok2) return res.status(403).json({ ok: false })
    let pb = {}
    try { pb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoP = await sopWho(pb.token)
    if (!whoP || !whoP.rid) return res.status(403).json({ ok: false, error: permDeny() })
    const { recordPunch } = await import('./punch.js')
    const out = await recordPunch({ id: whoP.rid, name: whoP.name }, 'prep', true)
    return res.status(200).json({ ok: true, name: whoP.name, ...out })
  }
  if (req.method === 'POST' && req.query?.punchfix) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.punchfix) !== ok2) return res.status(403).json({ ok: false })
    let pb = {}
    try { pb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoP = await sopWho(pb.token)
    if (!whoP || !whoP.rid) return res.status(403).json({ ok: false, error: permDeny() })
    const pj2 = await import('./punch.js')
    const oj2 = await import('./_onboard.js')
    const todayP = await pj2.todayPunchesOf(whoP.rid)
    const lastP = todayP[todayP.length - 1]
    if (!lastP) return res.status(400).json({ ok: false, error: '今天還沒有打卡紀錄' })
    if (Date.now() - new Date(lastP.ts).getTime() > 5 * 60000) return res.status(400).json({ ok: false, error: '超過 5 分鐘，請找管理員處理' })
    const dirF = lastP.dir === 'in' ? 'out' : 'in'
    await oj2.kvSet(lastP.key, { ...lastP, key: undefined, dir: dirF, fixedAt: new Date().toISOString() })
    return res.status(200).json({ ok: true, dir: dirF })
  }
  // ── 📅 班表（張良 2026-09-21：/prep 排班＋整月打卡對照；工時/加班試算在前端、倍率口徑同 src/shift/payroll.js 1.34/1.67）──
  if (req.query?.shift) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.shift) !== ok2) return res.status(403).json({ ok: false })
    const ym = /^\d{4}-\d{2}$/.test(String(req.query.ym || '')) ? String(req.query.ym) : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
    const [sd, meS, rosterS, bindS, defS] = await Promise.all([kvGet('sp_finance_pm_shift_g'), sopWho(req.query.me), kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_prep_bind'), kvGet('sp_finance_pm_sop_def')])
    const pj2 = await import('./punch.js')
    let pchs = []
    try { pchs = await pj2.listPunches('sp_crew_pch_' + ym.replace('-', '')) } catch (_) {}
    // v4.4.2（張良 2026-10-02「排9/30過幾秒自動消失」）：週表會跨月——只回當月資料害跨月那幾天存了也不見；改回傳當月±6天
    const mo0 = new Date(ym + '-01T00:00:00Z')
    const loS = new Date(mo0.getTime() - 6 * 86400e3).toISOString().slice(0, 10)
    const hiS = new Date(Date.UTC(mo0.getUTCFullYear(), mo0.getUTCMonth() + 1, 1) + 6 * 86400e3).toISOString().slice(0, 10)
    const schedL = ((sd || {}).list || []).filter(x => { const dd = String(x.date || ''); return dd >= loS && dd <= hiS })
    const namesU = [...new Set([...gdNames(rosterS), ...((((sd || {}).list) || []).map(x => x.name)), ...pchs.map(p => p.name)])].filter(Boolean)
    const namesAll = (((rosterS || {}).people) || []).filter(p2 => !p2.endDate && (p2.status || '在職') !== '離職').map(p2 => p2.name).filter(Boolean)
    const posList = [...new Set([...(((sd || {}).pos) || []), ...(((sd || {}).list) || []).map(x => x.pos).filter(Boolean)])]
    const boundRids = new Set(Object.values(((bindS || {}).tokens) || {}).map(w => w.rid).filter(Boolean))
    const aprS = (((defS || {}).ground || {}).approvers || ['張良瑋'])
    const aliveS = (((rosterS || {}).people) || []).filter(p2 => !p2.endDate && (p2.status || '在職') !== '離職')
    const gdOn = aliveS.some(p2 => p2.gd)
    const staff = aliveS.filter(p2 => !gdOn || p2.gd).map(p2 => ({ n: p2.name, role: aprS.includes(p2.name) ? '審核人' : (p2.gdRole || '一般'), bound: boundRids.has(p2.id) }))
    // v4.5.2 人員排序：staffOrd 名單優先、沒列到的排後面（staff=顏色/chips、names=快選按鈕 吃同一順序）
    const ordA = (sd || {}).staffOrd || []
    const oIdx = n => { const i = ordA.indexOf(n); return i < 0 ? 999 : i }
    const offSet = new Set((sd || {}).offStaff || []) // ✕非常態：沉底+踢出快選
    staff.forEach(s3 => { if (offSet.has(s3.n)) s3.off = 1 })
    staff.sort((a, b) => ((a.off ? 1 : 0) - (b.off ? 1 : 0)) || (oIdx(a.n) - oIdx(b.n)))
    namesU.sort((a, b) => oIdx(a) - oIdx(b))
    // v4.5.3（張良「顏色一直在變」）：配色永久固定——每人第一次出現配一個沒人用的色號存檔，之後不隨排序/名單進出變動
    const colMap = ((sd || {}).colors) || {}
    let colDirty = false
    const usedC = new Set(Object.values(colMap))
    for (const s3 of staff) { if (colMap[s3.n] == null) { let ci = 0; while (usedC.has(ci) && ci < 16) ci++; colMap[s3.n] = ci % 16; usedC.add(colMap[s3.n]); colDirty = true } }
    if (colDirty && sd) { sd.colors = colMap; await kvPut('sp_finance_pm_shift_g', sd, '人員配色固定') }
    // v4.9.0 崗位熟練度（張良 2026-10-02：訓練/排班安排）：每人×崗位排過幾次（只算今天含以前；被帶訓另計 🎓 前綴鍵）
    const todayS9 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const posStats = {}
    for (const x of ((sd || {}).list || [])) {
      if (!x.pos || String(x.date || '') > todayS9) continue
      const stN = posStats[x.name] = posStats[x.name] || {}
      stN[x.pos] = (stN[x.pos] || 0) + 1
      if (x.tr) { const stT = posStats[x.tr] = posStats[x.tr] || {}; stT['🎓' + x.pos] = (stT['🎓' + x.pos] || 0) + 1 }
    }
    // v4.9.7（張良「不要全部一樣次數,是第幾次」）：全歷史照日期排序逐筆編號——每張班卡=該人該站第幾次（未來的班順著遞增）
    const seqMap = {}, trSeqMap = {}
    const c1 = {}, c2 = {}
    for (const x of [...((sd || {}).list || [])].sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')))) {
      if (!x.pos) continue
      const k1 = x.name + '|' + x.pos; c1[k1] = (c1[k1] || 0) + 1; seqMap[x.id] = c1[k1]
      if (x.tr) { const k2 = x.tr + '|' + x.pos; c2[k2] = (c2[k2] || 0) + 1; trSeqMap[x.id] = c2[k2] }
    }
    const leaveM = {}; for (const dt of Object.keys(((sd || {}).leave) || {})) { if (dt >= loS && dt <= hiS) leaveM[dt] = sd.leave[dt] } // 🏖 當月範圍請假標記
    const hourlyL = (((sd || {}).hourly) || []).filter(x => String(x.date || '') >= loS && String(x.date || '') <= hiS) // 🕐 時段排班（v4.27.0）
    // AB 班表（張良 2026-10-03「加在GD班表下方,知道兩間店有誰上班方便調度」）：阿桑 boss-api 排班（sp_finance_pm_boss_sched_ 月檔）
    // 唯讀；列=人名、格=班別代碼；status=cancelled 排除；start/end 轉台北 HH:MM
    let abSched = [], abOn = [], abAtt = [], payRates = {}, vioRes = {}, hrPay = []
    try {
      const moSet = [...new Set([loS.slice(0, 7), ym, hiS.slice(0, 7)])]
      const [bStaff, nueStf, payDoc9, vioResD, hrPayD, ...abDocs] = await Promise.all([kvGet('sp_finance_pm_boss_staff'), kvGet('sp_crew_pm_hr_staff'), kvGet('sp_finance_pm_payrates'), kvGet('sp_finance_pm_vio_res'), kvGet('sp_crew_pm_hr_pay'), ...moSet.map(m => kvGet('sp_finance_pm_boss_sched_' + m.replace('-', '')))])
      // v4.46.1 NUEiP 薪資真值進薪資表：salary_name「2026年8月薪水」=所屬月（發放日通常次月10）
      for (const ev of ((hrPayD || {}).events || [])) {
        let ym9 = ''
        const evN = String(ev.event || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 全形數字→半形（實際資料是「２０２６年８月」）
        const mN = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(evN)
        if (mN) ym9 = mN[1] + '-' + String(+mN[2]).padStart(2, '0')
        else if (ev.payDate) { const d9 = new Date(ev.payDate + 'T00:00:00Z'); d9.setUTCMonth(d9.getUTCMonth() - 1); ym9 = d9.toISOString().slice(0, 7) }
        const lv9 = Object.entries(ev.leaves || {}).map(([k9, v9]) => k9 + ' ' + v9 + 'h').join('、')
        hrPay.push({ n: ev.name, ym: ym9, ev: ev.event, pd: ev.payDate, g: ev.gross, net: ev.net, ot: (ev.otFree || 0) + (ev.otTax || 0), otF: ev.otFree || 0, otT: ev.otTax || 0, otH: ev.otH || 0, lv: lv9 })
      }
      vioRes = (vioResD || {}).items || {}
      payRates = (payDoc9 || {}).rates || {}
      // v4.33.0 AB 實際出勤（NUEiP 打卡,薪資條/法規檢查用）：att 月檔→ {date,name,h,late,early,absent}
      try {
        const attDocs = await Promise.all(moSet.map(m => kvGet('sp_crew_pm_hr_att_' + m)))
        const t2m9 = (t) => { const a9 = String(t || '').split(':'); return (+a9[0] || 0) * 60 + (+a9[1] || 0) }
        for (const ad of attDocs) {
          for (const [dt9, users9] of Object.entries((ad || {}).days || {})) {
            if (dt9 < loS || dt9 > hiS) continue
            for (const rec9 of Object.values(users9)) {
              if (!/AB/.test(rec9.dept || '')) continue
              let h9 = (Number(rec9.durmin) || 0) / 60
              if (!h9 && (rec9.on || []).length && (rec9.off || []).length) { let sp9 = t2m9(rec9.off[rec9.off.length - 1]) - t2m9(rec9.on[0]); if (sp9 < 0) sp9 += 1440; h9 = Math.max(0, sp9 - 60) / 60 }
              if (h9 > 0 || rec9.absent) abAtt.push({ date: dt9, name: String(rec9.name || '').replace(/\s+[A-Za-z].*$/, ''), h: Math.round(h9 * 10) / 10, late: rec9.late || 0, early: rec9.early || 0, absent: rec9.absent || 0, on: (rec9.on || [])[0] || '', off: (rec9.off || []).slice(-1)[0] || '', miss: rec9.miss || 0 }) // 名字去英文後綴；on/off=點格核對打卡用(v4.36.4)
            }
          }
        }
      } catch (_) {}
      const hm = (ts) => { if (!ts) return ''; try { return new Date(new Date(ts).getTime() + 8 * 3600e3).toISOString().slice(11, 16) } catch (_) { return '' } }
      // v4.36.2（張良「怎麼會出現 蕭/桑/芳/Fran 這種名字」）：阿桑系統存的是暱稱/簡稱 → 用我們名冊轉全名
      // 順序：①全名直接命中 ②暱稱命中(不分大小寫) ③唯一「名字包含」(蕭→蕭睿詮) ④唯一「暱稱互含」(桑→阿桑=林品燊)；轉不出來保留原樣
      const idName = {}; Object.values((bStaff || {}).rows || {}).forEach(s9 => { if (s9.staff_id) idName[s9.staff_id] = s9.display_name }) // 阿桑名冊欄位=display_name（2026-10-04 bosspeek 實查）
      const pplR = ((rosterS || {}).people) || []
      const fullCache = {}
      const fullOf = (raw) => {
        const r0 = String(raw || '').trim()
        if (!r0) return ''
        if (fullCache[r0]) return fullCache[r0]
        let out = r0
        if (!pplR.some(p9 => p9.name === r0)) {
          const byNick = pplR.filter(p9 => (p9.nick || '').toLowerCase() === r0.toLowerCase())
          const byPart = byNick.length ? [] : pplR.filter(p9 => p9.name && p9.name.includes(r0))
          const byNk2 = (byNick.length || byPart.length === 1) ? [] : pplR.filter(p9 => p9.nick && (p9.nick.includes(r0) || r0.includes(p9.nick)))
          if (byNick.length === 1) out = byNick[0].name
          else if (byPart.length === 1) out = byPart[0].name
          else if (byNk2.length === 1) out = byNk2[0].name
        }
        fullCache[r0] = out
        return out
      }
      // v4.36.3（張良「PT也分出來 內歸內外歸外」）：pt=名冊職稱欄(cf_thi3j)含 PT/兼職；dept 班表沒帶就用名冊部門補
      const personOf = {}
      const bossRows = abDocs.flatMap(d9 => Object.values((d9 || {}).rows || {}))
        .filter(x => x.status !== 'cancelled' && String(x.work_date || '') >= loS && String(x.work_date || '') <= hiS)
        .map(x => {
          const nm9 = fullOf(idName[x.staff_id] || x.staff_name)
          if (!(nm9 in personOf)) personOf[nm9] = pplR.find(p9 => p9.name === nm9) || null
          const pp9 = personOf[nm9]
          return { date: x.work_date, name: nm9, code: x.shift_code || x.role_code || '', dept: x.dept || (pp9 && pp9.dept) || '', pt: pp9 && /pt|兼職/i.test(String(pp9.cf_thi3j || '')) ? 1 : 0, start: hm(x.start_at), end: hm(x.end_at), day: x.day_type || '' }
        })
      // v4.36.5（張良「高婕瀅直接從人資系統抓」）：NUEiP 高效排班為主來源（api/hr.js ?shifts=1 同步進 sp_crew_pm_hr_sched_ 月檔；
      // 全名+官方 is_part_time+休/例也有），阿桑 boss 班表只補 NUEiP 沒有的 (日期|人)
      const nueDocs = await Promise.all(moSet.map(m => kvGet('sp_crew_pm_hr_sched_' + m)))
      const nueRows = nueDocs.flatMap(d9 => Object.entries((d9 || {}).days || {}))
        .filter(([d]) => d >= loS && d <= hiS)
        .flatMap(([d, list]) => (Array.isArray(list) ? list : []).map(x => ({ date: d, name: x.name, code: x.code || '', dept: x.dept || '', pt: x.pt ? 1 : 0, start: x.start || '', end: x.end || '', brk: x.brk || 0 })))
      const seen9 = new Set(nueRows.map(x => x.date + '|' + x.name))
      abSched = [...nueRows, ...bossRows.filter(x => !seen9.has(x.date + '|' + x.name))]
      // v4.32.3（張良「高婕瀅沒離職卻被藏」+名冊離職日全空）：在職權威=NUEiP部門現役名單(每日班表同步順手更新sp_crew_pm_hr_staff)，再扣掉名冊有離職日的
      abOn = (((nueStf || {}).names) || []).filter(n9 => { const p9 = pplR.find(q9 => q9.name === n9); return !(p9 && p9.endDate) })
    } catch (_) {}
    // AB inline 訂位彙總（張良 2026-10-03「班表下方同日期對齊,時段 12-13/13-17/18-19/19後」）：
    // 每天×時段 {g組,p人,big:[≥20人大組]}；有效=state∉{2,5}；12-13含更早(11點包場)、13-17含17點、候位(沒時間)不計
    let resvDays = {}
    try {
      const moSet2 = [...new Set([loS.slice(0, 7), ym, hiS.slice(0, 7)])]
      const inlDocs = await Promise.all(moSet2.map((m) => kvGet('sp_finance_pm_inline_' + m))) // ⚠️ pm_inline_ 月檔 key 含破折號（跟 boss_sched 不同）
      const slotOf = (t) => (t < '13:00' ? 'a' : t < '18:00' ? 'b' : t < '19:00' ? 'c' : 'd')
      for (const d9 of inlDocs) {
        for (const [dt, arr] of Object.entries((d9 || {}).days || {})) {
          if (dt < loS || dt > hiS) continue
          for (const r9 of arr) {
            if (r9.st === 2 || r9.st === 5 || !r9.t) continue
            if (r9.ty === 4) continue // 候補≠真的會進店（張良 2026-10-04「候補要切出來」），班表訂位格不計
            const sl = slotOf(r9.t)
            const dd9 = resvDays[dt] = resvDays[dt] || {}
            const cell = dd9[sl] = dd9[sl] || { g: 0, p: 0, k: 0 }
            cell.g++; cell.p += r9.n || 0; cell.k += (r9.kc || 0) + (r9.ks || 0) // k=小孩（兒童椅+兒童座；inline iPad 時間軸人數=大人+k，對帳用——張良 2026-10-04「40 vs 35」案）
            if ((r9.n || 0) >= 20) (cell.big = cell.big || []).push({ t: r9.t, name: r9.name, n: r9.n })
          }
        }
      }
    } catch (_) {}
    return res.status(200).json({ ok: true, ym, ab: abSched, abOn, abAtt, payRates, vioRes, hrPay, resv: resvDays, hourly: hourlyL, sched: schedL.map(x => ({ ...x, seq: seqMap[x.id], trSeq: trSeqMap[x.id] })), punches: pchs.map(p => ({ name: p.name, ts: p.ts, dir: p.dir, src: p.src })), names: namesU, namesAll, posList, slots: (sd || {}).slots || null, colors: colMap, posStats, leave: leaveM, hist: ((sd || {}).hist || []).slice(-200).reverse(), lockEdit: (sd || {}).lockEdit ? 1 : 0, tpls: (sd || {}).tpls || [], staff, me: meS ? { name: meS.name, role: meS.role, approver: aprS.includes(meS.name) } : null })
  }
  // 人員色號管理口：POST ?shiftcolor=管理金鑰 {map:{名字:色號}} 合併寫入（固定/校正專屬色用）
  if (req.method === 'POST' && req.query?.shiftcolor) {
    const okC = (process.env.MENU_PROBE_KEY || '').trim()
    if (!okC || String(req.query.shiftcolor) !== okC) return res.status(403).json({ ok: false })
    let bC = {}
    try { bC = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const docC = (await kvGet('sp_finance_pm_shift_g')) || { list: [] }
    docC.colors = { ...(docC.colors || {}) }
    for (const [nm, ci] of Object.entries(bC.map || {})) docC.colors[String(nm).slice(0, 20)] = Math.max(0, Math.min(39, Number(ci) || 0))
    await kvPut('sp_finance_pm_shift_g', docC, '人員色號校正')
    return res.status(200).json({ ok: true, colors: docC.colors })
  }
  // 班表批次回補口（張良 2026-10-02「貼LINE班表幫我灌」）：POST ?shiftfill=管理金鑰 {list:[{name,date,start,end,break,pos,tr}]}——同(人+日+崗位)已存在就跳過
  if (req.method === 'POST' && req.query?.shiftfill) {
    const okF = (process.env.MENU_PROBE_KEY || '').trim()
    if (!okF || String(req.query.shiftfill) !== okF) return res.status(403).json({ ok: false })
    let bF = {}
    try { bF = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const docF = (await kvGet('sp_finance_pm_shift_g')) || { list: [] }
    const hasK = new Set((docF.list || []).map(x => [x.name, x.date, x.pos || ''].join('|')))
    let added = 0, skipped = 0
    for (const i2 of (Array.isArray(bF.list) ? bF.list : [])) {
      if (!String(i2.name || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(i2.date)) { skipped++; continue }
      const k2 = [String(i2.name).trim(), i2.date, String(i2.pos || '').trim()].join('|')
      if (hasK.has(k2)) { skipped++; continue }
      hasK.add(k2)
      const it = { id: 'sh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(i2.name).trim().slice(0, 20), date: i2.date, start: String(i2.start || '11:00').padStart(5, '0'), end: String(i2.end || '20:00').padStart(5, '0'), break: Math.max(0, Math.min(240, Number(i2.break) || 60)), pos: String(i2.pos || '').trim().slice(0, 20), by: 'AI回補' }
      const trF = String(i2.tr || '').trim().slice(0, 20); if (trF) it.tr = trF
      docF.list.push(it); added++
    }
    docF.list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    if (added) await kvPut('sp_finance_pm_shift_g', docF, '班表AI回補(' + added + '筆)')
    return res.status(200).json({ ok: true, added, skipped })
  }
  // 一次性清班表重複（2026-10-02 跨月bug期間連點產生的分身）：?shiftdedup=管理金鑰[&dry=1]——同(人+日+起迄+崗位)只留一筆
  if (req.query?.shiftdedup) {
    const okD = (process.env.MENU_PROBE_KEY || '').trim()
    if (!okD || String(req.query.shiftdedup) !== okD) return res.status(403).json({ ok: false })
    const docD = (await kvGet('sp_finance_pm_shift_g')) || { list: [] }
    const seenD = new Set(); const keep = []; const dropped = []
    const byK = new Map(); let idFixed = 0
    for (const x of (docD.list || [])) {
      if (String(x.id || '').startsWith('tmp')) { x.id = 'sh' + Math.random().toString(36).slice(2, 10); idFixed++ } // 暫存id轉正
      const k2 = [x.name, x.date, x.start, x.end, x.pos || ''].join('|')
      const prev = byK.get(k2)
      if (!prev) { byK.set(k2, x); keep.push(x) }
      else if (!prev.tr && x.tr) { dropped.push({ id: prev.id, k: k2 }); keep[keep.indexOf(prev)] = x; byK.set(k2, x) } // 同班留有帶訓那筆
      else dropped.push({ id: x.id, k: k2 })
    }
    if (!req.query.dry && (dropped.length || idFixed)) { docD.list = keep; await kvPut('sp_finance_pm_shift_g', docD, '班表去重(' + dropped.length + '筆/轉正' + idFixed + ')') }
    return res.status(200).json({ ok: true, dry: !!req.query.dry, kept: keep.length, idFixed, dropped })
  }
  if (req.method === 'POST' && req.query?.shiftset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.shiftset) !== ok2) return res.status(403).json({ ok: false })
    let sb2 = {}
    try { sb2 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoS = await permWho(sb2.token, 'shift')
    if (!whoS) return res.status(403).json({ ok: false, error: permDeny() })
    const doc = (await kvGet('sp_finance_pm_shift_g')) || { list: [] }
    // v4.12.0 班表鎖（張良：不要讓其他人動班表）＋修改紀錄（誰/時間/做了什麼）
    let mgrS = null
    const isMgr = async () => { if (mgrS != null) return mgrS; const [defL, rosL] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')]); const aprL = ((defL || {}).ground || {}).approvers || ['張良瑋']; const pL = (((rosL || {}).people) || []).find(p2 => p2.name === whoS.name); mgrS = aprL.includes(whoS.name) || (pL && pL.gdRole === '主管') ? 1 : 0; return mgrS }
    if (doc.lockEdit && !(await isMgr())) return res.status(403).json({ ok: false, error: '🔒 班表已鎖定——只有審核人／主管能編輯' })
    const pushH = d9 => { doc.hist = [...(doc.hist || []).slice(-499), { ts: new Date().toISOString(), by: whoS.name, d: d9 }] }
    if (sb2.op === 'save') {
      const i2 = sb2.item || {}
      if (!String(i2.name || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(i2.date) || !/^\d{1,2}:\d{2}$/.test(i2.start) || !/^\d{1,2}:\d{2}$/.test(i2.end)) return res.status(400).json({ ok: false, error: '姓名/日期/時間沒填齊' })
      if (String(i2.id || '').startsWith('tmp')) delete i2.id // 舊版前端會把暫存id送上來→一律換發正式id（v4.5.1 防線）
      const it = { id: i2.id || 'sh' + Date.now().toString(36), name: String(i2.name).trim().slice(0, 20), date: i2.date, start: String(i2.start).padStart(5, '0'), end: String(i2.end).padStart(5, '0'), break: Math.max(0, Math.min(240, Number(i2.break) || 0)), pos: String(i2.pos || '').trim().slice(0, 20), by: whoS.name }
      const trV = String(i2.tr || '').trim().slice(0, 20); if (trV) it.tr = trV // 🎓帶訓對象（張良 2026-10-02）
      const hadS = (doc.list || []).some(x => x.id === it.id)
      pushH((hadS ? '改' : '排') + ' ' + it.name + ' ' + it.date + ' ' + (it.pos || '未分崗') + ' ' + it.start + '-' + it.end + (it.tr ? '（帶' + it.tr + '）' : ''))
      doc.list = [...(doc.list || []).filter(x => x.id !== it.id), it].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(-1000)
      await kvPut('sp_finance_pm_shift_g', doc, '班表save(' + whoS.name + ')')
      return res.status(200).json({ ok: true, id: it.id }) // 回正式id——前端把暫存卡換正身（v4.4.8 分身治本）
    } else if (sb2.op === 'del') {
      const deE = (doc.list || []).find(x => x.id === sb2.id)
      if (deE) pushH('刪 ' + deE.name + ' ' + deE.date + ' ' + (deE.pos || '未分崗'))
      doc.list = (doc.list || []).filter(x => x.id !== sb2.id)
    } else if (sb2.op === 'pos') { // 崗位清單管理（張良 2026-09-24：班表頁直接編輯）
      doc.pos = (Array.isArray(sb2.list) ? sb2.list : []).map(s3 => String(s3).trim().slice(0, 20)).filter(Boolean).slice(0, 30)
    } else if (sb2.op === 'slots') { // ⏱時段快捷（張良 2026-10-02：照尖峰切時段，一鍵帶時間）
      doc.slots = (Array.isArray(sb2.list) ? sb2.list : []).map(s3 => ({ n: String(s3.n || '').trim().slice(0, 10), s: String(s3.s || '').slice(0, 5), e: String(s3.e || '').slice(0, 5) })).filter(x => x.n && /^\d{1,2}:\d{2}$/.test(x.s) && /^\d{1,2}:\d{2}$/.test(x.e)).slice(0, 10)
    } else if (sb2.op === 'ord') { // 👥人員排序（張良 2026-10-02：順序=快選排列）
      doc.staffOrd = (Array.isArray(sb2.list) ? sb2.list : []).map(s3 => String(s3).trim().slice(0, 20)).filter(Boolean).slice(0, 50)
    } else if (sb2.op === 'colors') { // 🎨人員自選色（張良 2026-10-02「讓我自己選擇編輯」）
      doc.colors = { ...(doc.colors || {}) }
      for (const [nm, ci] of Object.entries(sb2.map || {})) doc.colors[String(nm).slice(0, 20)] = Math.max(0, Math.min(39, Number(ci) || 0))
    } else if (sb2.op === 'off') { // ✕非常態排班人員（張良 2026-10-02）：沉底+不進快選選單+不列每日未排
      doc.offStaff = (Array.isArray(sb2.list) ? sb2.list : []).map(s3 => String(s3).trim().slice(0, 20)).filter(Boolean).slice(0, 50)
    } else if (sb2.op === 'cfg') { // 設定五合一（v4.8.3 提速：⚙️儲存原本連發5個POST排隊寫同一份doc→合成一發）
      const nm20 = a => (Array.isArray(a) ? a : []).map(s3 => String(s3).trim().slice(0, 20)).filter(Boolean).slice(0, 50)
      if (Array.isArray(sb2.pos)) doc.pos = nm20(sb2.pos).slice(0, 30)
      if (Array.isArray(sb2.slots)) doc.slots = sb2.slots.map(s3 => ({ n: String(s3.n || '').trim().slice(0, 10), s: String(s3.s || '').slice(0, 5), e: String(s3.e || '').slice(0, 5) })).filter(x => x.n && /^\d{1,2}:\d{2}$/.test(x.s) && /^\d{1,2}:\d{2}$/.test(x.e)).slice(0, 10)
      if (Array.isArray(sb2.ord)) doc.staffOrd = nm20(sb2.ord)
      if (sb2.colors && typeof sb2.colors === 'object') { doc.colors = { ...(doc.colors || {}) }; for (const [nm, ci] of Object.entries(sb2.colors)) doc.colors[String(nm).slice(0, 20)] = Math.max(0, Math.min(39, Number(ci) || 0)) }
      if (Array.isArray(sb2.off)) doc.offStaff = nm20(sb2.off)
      if ('lock' in sb2 && (await isMgr())) { const nv = sb2.lock ? 1 : 0; if (nv !== (doc.lockEdit ? 1 : 0)) pushH(nv ? '🔒 鎖定班表（只有審核人/主管能編輯）' : '🔓 解除班表鎖定') ; doc.lockEdit = nv }
      pushH('改班表設定')
    } else if (sb2.op === 'tplsave') { // 💾 班表版本（v4.13.0）：命名+自動記姓名時間
      const nmT = String(sb2.name || '').trim().slice(0, 30)
      if (!nmT) return res.status(400).json({ ok: false, error: '版本要取名字' })
      const itemsT = (Array.isArray(sb2.items) ? sb2.items : []).slice(0, 200).map(x => { const o2 = { name: String(x.name || '').trim().slice(0, 20), wd: Math.max(0, Math.min(6, Number(x.wd) || 0)), start: String(x.start || '11:00').slice(0, 5), end: String(x.end || '20:00').slice(0, 5), break: Math.max(0, Math.min(240, Number(x.break) || 0)), pos: String(x.pos || '').trim().slice(0, 20) }; const trT = String(x.tr || '').trim().slice(0, 20); if (trT) o2.tr = trT; return o2 }).filter(x => x.name)
      doc.tpls = [...(doc.tpls || []), { id: 'tp' + Date.now().toString(36), name: nmT, by: whoS.name, ts: new Date().toISOString(), items: itemsT }].slice(-20)
      pushH('💾 存版本「' + nmT + '」(' + itemsT.length + '筆)')
    } else if (sb2.op === 'tpldel') {
      const tpD = (doc.tpls || []).find(x => x.id === sb2.id)
      doc.tpls = (doc.tpls || []).filter(x => x.id !== sb2.id)
      if (tpD) pushH('刪版本「' + tpD.name + '」')
    } else if (sb2.op === 'hsave') { // 🕐 時段排班（張良 2026-10-03：週表同款樣板,欄=08:00-22:00每半小時）
      const i2 = sb2.item || {}
      const tOk = /^([01]\d|2[0-1]):(00|30)$/.test(String(i2.t || '')) && i2.t >= '08:00' && i2.t <= '21:30'
      if (!String(i2.name || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(i2.date) || !tOk) return res.status(400).json({ ok: false, error: '姓名/日期/時段沒填齊' })
      if (String(i2.id || '').startsWith('tmp')) delete i2.id
      const it = { id: i2.id || 'hr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(i2.name).trim().slice(0, 20), date: i2.date, t: i2.t, pos: String(i2.pos || '').trim().slice(0, 20), by: whoS.name }
      const trV = String(i2.tr || '').trim().slice(0, 20); if (trV) it.tr = trV
      const hadS = (doc.hourly || []).some(x => x.id === it.id)
      pushH((hadS ? '改' : '排') + '時段 ' + it.name + ' ' + it.date + ' ' + it.t + ' ' + (it.pos || ''))
      doc.hourly = [...(doc.hourly || []).filter(x => x.id !== it.id), it].sort((a, b) => (a.date + a.t).localeCompare(b.date + b.t)).slice(-3000)
      await kvPut('sp_finance_pm_shift_g', doc, '時段排班(' + whoS.name + ')')
      return res.status(200).json({ ok: true, id: it.id })
    } else if (sb2.op === 'hdel') {
      const deE = (doc.hourly || []).find(x => x.id === sb2.id)
      if (deE) pushH('刪時段 ' + deE.name + ' ' + deE.date + ' ' + deE.t)
      doc.hourly = (doc.hourly || []).filter(x => x.id !== sb2.id)
    } else if (sb2.op === 'leave') { // 🏖 請假標記（張良 2026-10-02：未排名單點人反黑劃掉＝那天不能排班；休/特/病/事/國/婚/喪/產/公）
      const dt9 = String(sb2.date || ''); const nm9 = String(sb2.name || '').trim().slice(0, 20); const tp9 = String(sb2.type || '').trim().slice(0, 2)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dt9) || !nm9) return res.status(400).json({ ok: false, error: '日期或姓名錯誤' })
      const OKT = ['休', '特', '病', '事', '國', '婚', '喪', '產', '公']
      doc.leave = doc.leave || {}; doc.leave[dt9] = doc.leave[dt9] || {}
      if (tp9 && OKT.includes(tp9)) { doc.leave[dt9][nm9] = tp9; pushH('🏖 ' + nm9 + ' ' + dt9 + ' 請' + tp9 + '假') }
      else { if (doc.leave[dt9][nm9]) pushH('取消 ' + nm9 + ' ' + dt9 + ' 請假'); delete doc.leave[dt9][nm9] }
      if (!Object.keys(doc.leave[dt9]).length) delete doc.leave[dt9]
    } else return res.status(400).json({ ok: false })
    await kvPut('sp_finance_pm_shift_g', doc, '班表' + sb2.op + '(' + whoS.name + ')')
    return res.status(200).json({ ok: true })
  }
  // ── 盤點/包材（張良 2026-09-21）：品項自建＋盤點紀錄＋照銷售自動扣除＋低水位提醒（cron 每日開店前查）──
  if (req.query?.inv) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.inv) !== ok2) return res.status(403).json({ ok: false })
    const kind = String(req.query.kind) === 'pack' ? 'pack' : 'food'
    const [st, meV] = await Promise.all([invStatus(kind), sopWho(req.query.me)])
    return res.status(200).json({ ok: true, kind, items: st.items, me: meV ? { name: meV.name } : null })
  }
  if (req.method === 'POST' && req.query?.invset) { // 品項增改刪：{kind, op:'save'|'del', item}
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.invset) !== ok2) return res.status(403).json({ ok: false })
    let bn = {}
    try { bn = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoN = await permWho(bn.token, (bn.kind === 'pack' ? 'pack' : 'food'))
    if (!whoN) return res.status(403).json({ ok: false, error: permDeny() })
    const kind = bn.kind === 'pack' ? 'pack' : 'food'
    const doc = (await kvGet('sp_finance_pm_inv')) || {}
    const kd = doc[kind] || (doc[kind] = { items: [], counts: {}, edits: [] })
    if (bn.op === 'del') kd.items = (kd.items || []).filter(x => x.id !== bn.id)
    else {
      const it = bn.item || {}
      const clean = { id: it.id || ('iv' + Date.now().toString(36)), name: String(it.name || '').slice(0, 30), unit: String(it.unit || '').slice(0, 8), min: Number(it.min) || 0, links: (Array.isArray(it.links) ? it.links : []).slice(0, 10).map(l => ({ type: l.type === 'cat' ? 'cat' : 'item', key: String(l.key || '').slice(0, 40), per: Number(l.per) || 0 })).filter(l => l.key && l.per > 0) }
      if (!clean.name) return res.status(400).json({ ok: false, error: '要有名稱' })
      const i0 = (kd.items || []).findIndex(x => x.id === clean.id)
      if (i0 >= 0) kd.items[i0] = clean; else kd.items.push(clean)
    }
    kd.edits = [{ ts: new Date().toISOString(), by: whoN.name, op: bn.op, name: (bn.item || {}).name || bn.id }, ...(kd.edits || [])].slice(0, 30)
    await kvPut('sp_finance_pm_inv', doc, '盤點品項' + bn.op + '(' + whoN.name + ')')
    return res.status(200).json({ ok: true })
  }
  if (req.method === 'POST' && req.query?.invcount) { // 盤點：{kind, id, qty}
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.invcount) !== ok2) return res.status(403).json({ ok: false })
    let bc = {}
    try { bc = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoC = await permWho(bc.token, (bc.kind === 'pack' ? 'pack' : 'food'))
    if (!whoC) return res.status(403).json({ ok: false, error: permDeny() })
    const qv = Number(bc.qty)
    if (!bc.id || isNaN(qv) || qv < 0) return res.status(400).json({ ok: false, error: '數量不對' })
    const kind = bc.kind === 'pack' ? 'pack' : 'food'
    const doc = (await kvGet('sp_finance_pm_inv')) || {}
    const kd = doc[kind] || (doc[kind] = { items: [], counts: {} })
    kd.counts = kd.counts || {}
    kd.counts[bc.id] = [{ ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), qty: qv, by: whoC.name }, ...(kd.counts[bc.id] || [])].slice(0, 30)
    await kvPut('sp_finance_pm_inv', doc, '盤點紀錄(' + whoC.name + ')')
    return res.status(200).json({ ok: true })
  }
  if (req.query?.sop) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sop) !== ok2) return res.status(403).json({ ok: false })
    const dt2 = sopToday()
    const [defDoc, logDoc, rosterDoc, me3, hideDoc, shDoc9, issuesDoc] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_finance_pm_sop_g_' + dt2), kvGet('sp_crew_kb_roster'), sopWho(req.query.me), kvGet('sp_finance_pm_prep_hide'), kvGet('sp_finance_pm_shift_g'), kvGet('sp_finance_pm_sop_issues')]) // v4.31.9 issues併進平行抓（原本落單多一趟）
    // v4.17.2 負責人名單=只有GD人員、照班表⚙️排序（常態在前、非常態墊底）
    const ordN9 = (shDoc9 || {}).staffOrd || []
    const offN9 = new Set((shDoc9 || {}).offStaff || [])
    const gdAll9 = gdNames(rosterDoc)
    const oI9 = n => { const i = ordN9.indexOf(n); return i < 0 ? 999 : i }
    const names = [...gdAll9.filter(n => !offN9.has(n)).sort((x, y) => oI9(x) - oI9(y)), ...gdAll9.filter(n => offN9.has(n)).sort((x, y) => oI9(x) - oI9(y))]
    const gdef = (defDoc || {}).ground || { items: [] }
    // me＝綁定者（張良 2026-09-21 拍板：不設站長，綁定的人全站都能編，靠歷史紀錄留痕）
    const approvers = ((defDoc || {}).ground || {}).approvers || ['張良瑋'] // 解決審核人（張良 2026-09-21：已解決要經我審核）
    const me4 = me3 ? { name: me3.name, canEdit: true, approver: approvers.includes(me3.name), role: me3.role || '' } : null
    const issues = ((issuesDoc || {}).list || []).filter(x => x.status === 'open' || x.status === 'pending').slice(0, 30)
    // v4.18.0 hashtag 模型遷移（張良 2026-10-02：#階段 × #產品 雙標籤取代樹狀分身）——一次性自動轉
    let mig18 = false
    gdef.items = gdef.items || []
    gdef.stations = (gdef.stations && gdef.stations.length) ? gdef.stations : [...new Set(gdef.items.map(i => i.st))]
    for (const stX of [...gdef.stations]) {
      if (String(stX).includes('｜')) { // 樹狀分身「分類｜站」→ 拆回標籤
        const parts18 = String(stX).split('｜'), cg18 = parts18[0], pd18 = parts18[1]
        gdef.items.forEach(it => { if (it.st === stX) { it.st = pd18; if (!it.tg) it.tg = cg18 } })
        if (!gdef.stations.includes(pd18)) gdef.stations.push(pd18)
        gdef.stations = gdef.stations.filter(x => x !== stX)
        if (gdef.stCat) delete gdef.stCat[stX]
        if (gdef.stOwner && gdef.stOwner[stX]) { gdef.stOwner[pd18] = gdef.stOwner[pd18] || gdef.stOwner[stX]; delete gdef.stOwner[stX] }
        mig18 = true
      }
    }
    for (const [stX, cg18] of Object.entries(gdef.stCat || {})) { // 整站歸類 → 條目打階段標籤
      gdef.items.forEach(it => { if (it.st === stX && !it.tg) { it.tg = cg18; mig18 = true } })
    }
    if (gdef.stCat && Object.keys(gdef.stCat).length) { gdef.stCat = {}; mig18 = true }
    if (mig18) { defDoc.ground = gdef; await kvPut('sp_finance_pm_sop_def', defDoc, 'SOP hashtag遷移') }
    const stations = gdef.stations
    const trash = (gdef.trash || []).map(t => ({ id: t.id, st: t.st, n: (t.items || []).length, ts: t.ts, by: t.by }))
    // v4.15.0 SOP分層+負責人（張良 2026-10-02）
    const sugsD0 = await kvGet('sp_finance_pm_sop_sugs')
    const sugOpen = {}
    ;(((sugsD0 || {}).list) || []).forEach(x => { if (x.status === 'open') sugOpen[x.st] = (sugOpen[x.st] || 0) + 1 })
    return res.status(200).json({ ok: true, date: dt2, def: { items: gdef.items || [], stations, edits: (gdef.edits || []).slice(0, 10), cats: gdef.catOrder || [], stCat: gdef.stCat || {}, stOwner: gdef.stOwner || {}, catOwner: gdef.catOwner || {} }, sugOpen, trash, log: logDoc || { items: {} }, names, me: me4, issues, prepHide: (hideDoc || {}).keys || {} })
  }
  // 站別管理（張良 2026-09-21：站可新增/改名/刪除；誤刪可復原→軟刪進回收站）：POST ?sopst=<OPS_BOARD_KEY> {token, op, st, newName, trashId}
  if (req.method === 'POST' && req.query?.sopst) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopst) !== ok2) return res.status(403).json({ ok: false })
    let bs = {}
    try { bs = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoS = await permWho(bs.token, 'sop') // v4.34.0 SOP拆頁後守門跟上：board→sop
    if (!whoS) return res.status(403).json({ ok: false, error: permDeny() })
    const curS = (await kvGet('sp_finance_pm_sop_def')) || {}
    const gS = curS.ground || { items: [] }
    gS.stations = (gS.stations && gS.stations.length) ? gS.stations : [...new Set((gS.items || []).map(i => i.st))]
    const nmS = String(bs.st || '').trim().slice(0, 20)
    if (bs.op === 'add') {
      if (!nmS) return res.status(400).json({ ok: false, error: '要給站名' })
      if (gS.stations.includes(nmS)) return res.status(400).json({ ok: false, error: '已經有這個站了' })
      gS.stations.push(nmS)
    } else if (bs.op === 'rename') {
      const nn = String(bs.newName || '').trim().slice(0, 20)
      if (!nmS || !nn) return res.status(400).json({ ok: false, error: '要給舊站名與新站名' })
      if (gS.stations.includes(nn)) return res.status(400).json({ ok: false, error: '新站名已存在' })
      gS.stations = gS.stations.map(s => s === nmS ? nn : s)
      gS.items = (gS.items || []).map(it => it.st === nmS ? { ...it, st: nn } : it)
      if ((gS.stCat || {})[nmS] != null) { gS.stCat = { ...gS.stCat, [nn]: gS.stCat[nmS] }; delete gS.stCat[nmS] }
      if ((gS.stOwner || {})[nmS] != null) { gS.stOwner = { ...gS.stOwner, [nn]: gS.stOwner[nmS] }; delete gS.stOwner[nmS] }
    } else if (bs.op === 'del') {
      if (!gS.stations.includes(nmS)) return res.status(400).json({ ok: false, error: '找不到這個站' })
      const moved = (gS.items || []).filter(it => it.st === nmS)
      gS.items = (gS.items || []).filter(it => it.st !== nmS)
      gS.stations = gS.stations.filter(s => s !== nmS)
      if (gS.stCat) delete gS.stCat[nmS]
      if (gS.stOwner) delete gS.stOwner[nmS]
      gS.trash = [{ id: 'tr' + Date.now().toString(36), ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), by: whoS.name, st: nmS, items: moved }, ...(gS.trash || [])].slice(0, 20)
    } else if (bs.op === 'restore') {
      const tr = (gS.trash || []).find(t => t.id === bs.trashId)
      if (!tr) return res.status(404).json({ ok: false, error: '回收站找不到' })
      if (!gS.stations.includes(tr.st)) gS.stations.push(tr.st)
      gS.items = [...(gS.items || []).filter(it => it.st !== tr.st || !(tr.items || []).some(x => x.id === it.id)), ...(tr.items || [])]
      gS.trash = (gS.trash || []).filter(t => t.id !== bs.trashId)
    } else if (bs.op === 'catadd') { // v4.15.0 分類層
      const cn = String(bs.cat || '').trim().slice(0, 20); if (!cn) return res.status(400).json({ ok: false, error: '要給分類名' })
      gS.catOrder = gS.catOrder || []; if (!gS.catOrder.includes(cn)) gS.catOrder.push(cn)
    } else if (bs.op === 'catren') {
      const co = String(bs.cat || '').trim(), cn = String(bs.newName || '').trim().slice(0, 20)
      if (!co || !cn) return res.status(400).json({ ok: false, error: '要給舊名與新名' })
      gS.catOrder = (gS.catOrder || []).map(c2 => c2 === co ? cn : c2)
      gS.stCat = Object.fromEntries(Object.entries(gS.stCat || {}).map(([k, v]) => [k, v === co ? cn : v]))
      ;(gS.items || []).forEach(it => { if (it.tg === co) it.tg = cn })
      if ((gS.catOwner || {})[co] != null) { gS.catOwner = { ...gS.catOwner, [cn]: gS.catOwner[co] }; delete gS.catOwner[co] }
    } else if (bs.op === 'catdel') {
      const cn = String(bs.cat || '').trim()
      gS.catOrder = (gS.catOrder || []).filter(c2 => c2 !== cn)
      gS.stCat = Object.fromEntries(Object.entries(gS.stCat || {}).filter(([, v]) => v !== cn))
      ;(gS.items || []).forEach(it => { if (it.tg === cn) delete it.tg })
      if (gS.catOwner) delete gS.catOwner[cn]
    } else if (bs.op === 'stord') { // v4.18.1 產品排序
      const want = (Array.isArray(bs.list) ? bs.list : []).map(x => String(x).trim().slice(0, 20)).filter(Boolean)
      const keep9 = want.filter(x => gS.stations.includes(x))
      gS.stations = [...keep9, ...gS.stations.filter(x => !keep9.includes(x))]
    } else if (bs.op === 'catord') {
      gS.catOrder = (Array.isArray(bs.list) ? bs.list : []).map(c2 => String(c2).trim().slice(0, 20)).filter(Boolean).slice(0, 20)
    } else if (bs.op === 'catset') { // 站歸到哪個分類（空=未分類）
      if (!nmS) return res.status(400).json({ ok: false, error: '要給站名' })
      gS.stCat = { ...(gS.stCat || {}) }
      const cn = String(bs.cat || '').trim().slice(0, 20)
      if (cn) { gS.stCat[nmS] = cn; gS.catOrder = gS.catOrder || []; if (!gS.catOrder.includes(cn)) gS.catOrder.push(cn) } else delete gS.stCat[nmS]
    } else if (bs.op === 'catown') { // 分類負責人（v4.17.0 張良：每個類別設負責人編輯權限）
      const aprO = (curS.ground || {}).approvers || ['張良瑋']
      if (!(aprO.includes(whoS.name) || whoS.role === '主管')) return res.status(403).json({ ok: false, error: '負責人由審核人／主管指定' })
      const cnO = String(bs.cat || '').trim().slice(0, 20)
      if (!cnO) return res.status(400).json({ ok: false, error: '要給分類' })
      gS.catOwner = { ...(gS.catOwner || {}) }
      const onC = String(bs.owner || '').trim().slice(0, 20)
      if (onC) gS.catOwner[cnO] = onC; else delete gS.catOwner[cnO]
    } else if (bs.op === 'ownset') { // 負責人（只有審核人/主管能指定）
      const aprO = (curS.ground || {}).approvers || ['張良瑋']
      if (!(aprO.includes(whoS.name) || whoS.role === '主管')) return res.status(403).json({ ok: false, error: '負責人由審核人／主管指定' })
      if (!nmS) return res.status(400).json({ ok: false, error: '要給站名' })
      gS.stOwner = { ...(gS.stOwner || {}) }
      const on2 = String(bs.owner || '').trim().slice(0, 20)
      if (on2) gS.stOwner[nmS] = on2; else delete gS.stOwner[nmS]
    } else return res.status(400).json({ ok: false, error: 'op 不認得' })
    gS.edits = [{ ts: new Date().toISOString(), by: whoS.name, st: nmS || (bs.trashId || ''), op: bs.op }, ...(gS.edits || [])].slice(0, 30)
    curS.ground = gS
    await kvPut('sp_finance_pm_sop_def', curS, 'SOP站別' + bs.op + '(' + whoS.name + ')')
    return res.status(200).json({ ok: true })
  }
  // 💡 SOP 建議（v4.15.0 張良：非負責人提建議→負責人審核；通過加分留記錄、駁回歸檔不吃案）
  if (req.query?.sopsug && req.method !== 'POST') {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopsug) !== ok2) return res.status(403).json({ ok: false })
    const dG = (await kvGet('sp_finance_pm_sop_sugs')) || { list: [] }
    let L = dG.list || []
    const stQ = String(req.query.st || '')
    if (stQ) L = L.filter(x => x.st === stQ)
    return res.status(200).json({ ok: true, list: L.slice(0, 100) })
  }
  if (req.method === 'POST' && req.query?.sopsugset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopsugset) !== ok2) return res.status(403).json({ ok: false })
    let bG = {}
    try { bG = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoG2 = await sopWho(bG.token)
    if (!whoG2) return res.status(403).json({ ok: false, error: permDeny() })
    const docG = (await kvGet('sp_finance_pm_sop_sugs')) || { list: [] }
    const nowG = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    if (bG.op === 'add') {
      const stG = String(bG.st || '').trim().slice(0, 20), txG = String(bG.text || '').trim().slice(0, 300)
      if (!stG || !txG) return res.status(400).json({ ok: false, error: '要寫建議內容' })
      docG.list = [{ id: 'sg' + Date.now().toString(36), st: stG, text: txG, by: whoG2.name, ts: nowG, status: 'open' }, ...(docG.list || [])].slice(0, 300)
      await kvPut('sp_finance_pm_sop_sugs', docG, 'SOP建議(' + whoG2.name + ')')
      try { // DD 私訊負責人
        const defX = await kvGet('sp_finance_pm_sop_def')
        const gDX = ((defX || {}).ground || {})
        const ow = (gDX.stOwner || {})[stG] || (gDX.catOwner || {})[(gDX.stCat || {})[stG]]
        if (ow) {
          const ros = await kvGet('sp_crew_kb_roster')
          const po = (((ros || {}).people) || []).find(p2 => p2.name === ow && p2.lineUserId)
          const tk = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
          if (po && tk) { await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: po.lineUserId, messages: [{ type: 'text', text: '💡 ' + whoG2.name + ' 對你負責的 SOP【' + stG + '】提了建議：\n' + txG + '\n到 /prep → SOP 按「💡 建議」審核（通過他會加分）' }] }) }); const { logPush } = await import('./push.js'); await logPush(po.lineUserId, 1, 'SOP建議通知') }
        }
      } catch (_) {}
    } else if (bG.op === 'decide') {
      const sg = (docG.list || []).find(x => x.id === bG.id)
      if (!sg || sg.status !== 'open') return res.status(400).json({ ok: false, error: '找不到或已處理' })
      const defX = await kvGet('sp_finance_pm_sop_def')
      const gX = (defX || {}).ground || {}
      const ow = (gX.stOwner || {})[sg.st] || (gX.catOwner || {})[(gX.stCat || {})[sg.st]]
      const aprX = gX.approvers || ['張良瑋']
      if (!(whoG2.name === ow || aprX.includes(whoG2.name) || whoG2.role === '主管')) return res.status(403).json({ ok: false, error: '只有該站負責人／審核人能審' })
      const pass = !!bG.pass
      const note = String(bG.note || '').trim().slice(0, 200)
      if (!pass && !note) return res.status(400).json({ ok: false, error: '駁回一定要寫原因——會歸檔，不能吃案' })
      sg.status = pass ? 'ok' : 'no'; sg.decBy = whoG2.name; sg.decTs = nowG; if (note) sg.note = note; if (pass) sg.pts = 1
      await kvPut('sp_finance_pm_sop_sugs', docG, 'SOP建議審核(' + whoG2.name + ')')
      try { // DD 通知申請人
        const ros = await kvGet('sp_crew_kb_roster')
        const po = (((ros || {}).people) || []).find(p2 => p2.name === sg.by && p2.lineUserId)
        const tk = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        if (po && tk) { await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: po.lineUserId, messages: [{ type: 'text', text: pass ? ('✅ 你對 SOP【' + sg.st + '】的建議通過了（' + whoG2.name + ' 核）——記你 1 分！') : ('📁 你對 SOP【' + sg.st + '】的建議未採納（' + whoG2.name + '）：' + note + '\n已歸檔留紀錄。') }] }) }); const { logPush } = await import('./push.js'); await logPush(po.lineUserId, 1, 'SOP建議結果') }
      } catch (_) {}
    } else return res.status(400).json({ ok: false })
    return res.status(200).json({ ok: true, list: (docG.list || []).slice(0, 100) })
  }
  // ── 發現/解決問題排行榜（張良 2026-09-21）：全員對每件回報的「發現」與「解決」評 L1~L10，平均分進個人積分 ──
  // GET  ?lb=<OPS_BOARD_KEY>&me=token → 事件列表(含評分)+排行榜；POST ?soprate= {id, aspect:'find'|'fix', level:1-10, token}
  // 五大面向星星評分（張良 2026-09-21 拍板：取代 L1~L10 投票——面向沿用薪資360同語彙，1~5星直覺免看定義；
  // 效率不用人評=認領計時 durMin 客觀數據）。stars 結構：issue.stars[find|fix][面向key][評分人]=1~5
  const FACETS = ['專業', '品質', '團隊', '負責', '創新']
  if (req.query?.lb) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.lb) !== ok2) return res.status(403).json({ ok: false })
    const [issDoc, meL, rosterL] = await Promise.all([kvGet('sp_finance_pm_sop_issues'), sopWho(req.query.me), kvGet('sp_crew_kb_roster')])
    const namesL = gdNames(rosterL)
    const list = ((issDoc || {}).list || []).slice(0, 60)
    const board = {}
    const P = (nm) => board[nm] || (board[nm] = { name: nm, findPts: 0, fixPts: 0, nFind: 0, nFix: 0, fc: {} })
    for (const x of list) {
      for (const aspect of ['find', 'fix']) {
        if (aspect === 'fix' && x.status !== 'done') continue // 待審不計
        const target = aspect === 'find' ? x.by : x.doneBy
        if (!target || target === '匿名') continue
        const p = P(target)
        if (aspect === 'find') p.nFind++; else p.nFix++
        const st = (x.stars || {})[aspect] || {}
        let all = []
        for (const f of FACETS) {
          const vs = Object.values(st[f] || {}).map(Number).filter(v => v >= 1)
          if (vs.length) { const fo = p.fc[f] || (p.fc[f] = { sum: 0, n: 0 }); fo.sum += vs.reduce((a, b) => a + b, 0); fo.n += vs.length; all = all.concat(vs) }
        }
        const evAvg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0 // 該事件該面的整體星平均
        if (aspect === 'find') p.findPts += evAvg; else p.fixPts += evAvg
        x[aspect + 'Avg'] = all.length ? Math.round(evAvg * 10) / 10 : null
      }
    }
    namesL.forEach(nm => P(nm)) // v4.44.0 張良「直接先把每個人的名字show出來」：GD 人員全員上榜（沒分=0）
    // ⭐ 任務積分（v4.44.0 360制度）：已完成任務的 pts 按負責人加總
    const tpMap = {}
    try {
      const rT = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.sp_team_pm_task_*&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      const rowsT = rT.ok ? await rT.json() : []
      for (const row of rowsT) {
        let t9 = null; try { t9 = JSON.parse(typeof row.data?.v === 'string' ? row.data.v : JSON.stringify(row.data?.v)) } catch (_) {}
        if (t9 && t9.status === 'done' && t9.owner && Number(t9.pts) > 0) tpMap[t9.owner] = (tpMap[t9.owner] || 0) + Number(t9.pts)
      }
      Object.keys(tpMap).forEach(nm => P(nm))
    } catch (_) {}
    const rank = Object.values(board).map(p => ({
      name: p.name, nFind: p.nFind, nFix: p.nFix,
      findPts: Math.round(p.findPts * 10) / 10, fixPts: Math.round(p.fixPts * 10) / 10,
      taskPts: Math.round((tpMap[p.name] || 0) * 10) / 10,
      total: Math.round((p.findPts + p.fixPts + (tpMap[p.name] || 0)) * 10) / 10,
      facets: Object.fromEntries(FACETS.map(f => [f, p.fc[f] ? { avg: Math.round(p.fc[f].sum / p.fc[f].n * 10) / 10, n: p.fc[f].n } : null])),
    })).sort((a, b) => b.total - a.total || (b.nFind + b.nFix) - (a.nFind + a.nFix))
    // ○○之星榮耀榜：每面向平均星最高者（至少 3 票才上榜，避免一票封神）
    const stars5 = Object.fromEntries(FACETS.map(f => {
      const cand = rank.filter(p => p.facets[f] && p.facets[f].n >= 3).sort((a, b) => b.facets[f].avg - a.facets[f].avg || b.facets[f].n - a.facets[f].n)
      return [f, cand[0] ? { name: cand[0].name, avg: cand[0].facets[f].avg, n: cand[0].facets[f].n } : null]
    }))
    // 2026-10-02 治本（張良：還是沒按鈕）：lb 口的 me 漏了 approver → taskCard 的 📣發布/✅核准 鈕對誰都不出現
    const defL = await kvGet('sp_finance_pm_sop_def')
    const aprL = (((defL || {}).ground || {}).approvers || ['張良瑋'])
    return res.status(200).json({ ok: true, me: meL ? { name: meL.name, role: meL.role, approver: meL.role === '主管' || aprL.includes(meL.name) } : null, facets: FACETS, rank, stars5, issues: list, names: namesL })
  }
  if (req.method === 'POST' && req.query?.soprate) {
    // v2：面向星星（1~5）。body={id, aspect:'find'|'fix', facet:五面向之一, stars:1-5}
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.soprate) !== ok2) return res.status(403).json({ ok: false })
    let br = {}
    try { br = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoR = await sopWho(br.token)
    if (!whoR) return res.status(403).json({ ok: false, error: permDeny() })
    const sv = Math.round(Number(br.stars))
    if (!br.id || !['find', 'fix'].includes(br.aspect) || !FACETS.includes(br.facet) || !(sv >= 1 && sv <= 5)) return res.status(400).json({ ok: false, error: '參數不對' })
    const docR = (await kvGet('sp_finance_pm_sop_issues')) || { list: [] }
    const itR = (docR.list || []).find(x => x.id === br.id)
    if (!itR) return res.status(404).json({ ok: false })
    if (br.aspect === 'fix' && itR.status !== 'done') return res.status(400).json({ ok: false, error: '還沒核准解決，先不能評解決星' })
    const target = br.aspect === 'find' ? itR.by : itR.doneBy
    if (target === whoR.name) return res.status(400).json({ ok: false, error: '不能評自己的星 😄' })
    itR.stars = itR.stars || {}; itR.stars[br.aspect] = itR.stars[br.aspect] || {}; itR.stars[br.aspect][br.facet] = itR.stars[br.aspect][br.facet] || {}
    itR.stars[br.aspect][br.facet][whoR.name] = sv // 一人每面向一票、可改
    await kvPut('sp_finance_pm_sop_issues', docR, '面向評星(' + whoR.name + ')')
    return res.status(200).json({ ok: true, stars: itR.stars })
  }
  // ── /prep 編輯權限（張良 2026-10-01「開工」審核制）：sp_finance_pm_prep_perm={mode:'open'|'approve',users:{rid:{name,edit,admin}},pending:{rid:{name,ts}}} ──
  // 申請口：POST ?prepapply=<OPS_BOARD_KEY> {token} → 進 pending ＋ LINE 通知老闆
  if (req.method === 'POST' && req.query?.prepapply) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.prepapply) !== ok2) return res.status(403).json({ ok: false })
    let bp = {}; try { bp = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const who = await sopWho(bp.token)
    if (!who) return res.status(403).json({ ok: false, error: permDeny() })
    const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'approve', users: {}, pending: {} }
    const pKey = who.rid || who.uid
    if (pm.users[pKey]?.edit) return res.status(200).json({ ok: true, already: true })
    pm.pending = pm.pending || {}; pm.pending[pKey] = { name: who.name, uid: who.uid, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') }
    await kvPut('sp_finance_pm_prep_perm', pm, '編輯權申請(' + who.name + ')')
    try {
      const { linePush } = await import('./_onboard.js'); const { logPush } = await import('./push.js')
      const ops = (await kvGet('pm_bot_operators')) || {}
      for (const uid of Object.keys(ops)) { if (await linePush(uid, `🙋 ${who.name} 申請 /prep 編輯權限
核准：到 /prep 右上「權限」面板按✅，或跟 Claude 說「核准 ${who.name}」`)) await logPush(uid, 1, 'prep編輯權申請') }
    } catch (_) {}
    return res.status(200).json({ ok: true, pending: true })
  }
  // 🪪 職級查詢（v4.41.3）：GET ?gdrole=<OPS_KEY>&me= 回全部職級（限管理者）；POST 設定走前面 1420 行的舊口（v4.41.3 兩口合一，別再加第二個 POST 分支）
  if (req.query?.gdrole) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.gdrole) !== ok2) return res.status(403).json({ ok: false })
    const pmR9 = (await kvGet('sp_finance_pm_prep_perm')) || { users: {} }
    const whoR9 = await sopWho(req.query.me)
    if (!whoR9 || !(pmR9.users[whoR9.rid || whoR9.uid] || {}).admin) return res.status(403).json({ ok: false })
    const rosR9 = (await kvGet('sp_crew_kb_roster')) || {}
    const roles9 = {}; (rosR9.people || []).forEach(p9 => { if (p9.gdRole) roles9[p9.id] = p9.gdRole })
    return res.status(200).json({ ok: true, roles: roles9 })
  }
  // 🔒 身分證欄名單（v4.41.2）：POST ?hridlock=<OPS_KEY> {token, rids:[]}——限管理者；名冊頁鎖頭點開勾人
  if (req.method === 'POST' && req.query?.hridlock) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.hridlock) !== ok2) return res.status(403).json({ ok: false })
    let bL9 = {}; try { bL9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const pmL9 = (await kvGet('sp_finance_pm_prep_perm')) || { users: {} }
    const whoL9 = await sopWho(bL9.token)
    if (!whoL9 || !(pmL9.users[whoL9.rid || whoL9.uid] || {}).admin) return res.status(403).json({ ok: false, error: '只有管理者能設' })
    const docL9 = { rids: (Array.isArray(bL9.rids) ? bL9.rids : []).map(String).slice(0, 100), by: whoL9.name, ts: new Date().toISOString() }
    await kvPut('sp_finance_pm_hr_idlock', docL9, '身分證欄名單(' + whoL9.name + ')')
    return res.status(200).json({ ok: true, n: docL9.rids.length })
  }
  // 管理口（頁內，admin 才能動）：POST ?preppermset=<OPS_BOARD_KEY> {token, op:approve|reject|revoke|mode, rid, mode}
  if (req.method === 'POST' && req.query?.preppermset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.preppermset) !== ok2) return res.status(403).json({ ok: false })
    let bp = {}; try { bp = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const who = await sopWho(bp.token)
    const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'approve', users: {}, pending: {} }
    if (!who || !pm.users[who.rid || who.uid]?.admin) return res.status(403).json({ ok: false, error: '只有管理者能改權限' })
    const rid = String(bp.rid || '')
    if (bp.op === 'approve' && pm.pending[rid]) {
      const appr = pm.pending[rid]
      const snap = (pm.removed || {})[rid] // v4.32.1 之前被移除過＝還原他原本的勾選；全新夥伴＝套團隊共同設定
      pm.users[rid] = { ...(snap ? { tabs: snap.tabs, hide: snap.hide } : prepPermTmpl(pm)), name: appr.name, edit: 1, by: who.name, ts: appr.ts }
      if (snap) delete pm.removed[rid]
      delete pm.pending[rid]
      try { // 核准→DD 通知當事人（張良 2026-10-01）
        const { linePush } = await import('./_onboard.js'); const { logPush } = await import('./push.js')
        let uidA = appr.uid
        if (!uidA) { const bd = (await kvGet('sp_finance_pm_prep_bind')) || {}; uidA = (Object.values(bd.tokens || {}).find(t => t.rid === rid || t.uid === rid) || {}).uid }
        if (uidA && await linePush(uidA, `✅ 你的 /prep 編輯權限審核通過了！重新整理頁面就能編輯。`)) await logPush(uidA, 1, 'prep編輯權核准')
      } catch (_) {}
    }
    else if (bp.op === 'reject') delete pm.pending[rid]
    else if (bp.op === 'revoke' && pm.users[rid] && !pm.users[rid].admin) { // v4.32.1 軟刪（張良：按移除就沒了要能復原）：搬到 removed 保留勾選，可一鍵復原
      pm.removed = pm.removed || {}
      pm.removed[rid] = { ...pm.users[rid], rts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') }
      delete pm.users[rid]
    }
    else if (bp.op === 'restore' && (pm.removed || {})[rid]) { // v4.32.1 復原：原本的勾選原封不動搬回來
      const v9 = pm.removed[rid]; delete v9.rts
      pm.users[rid] = v9; delete pm.removed[rid]
    }
    else if (bp.op === 'mode') pm.mode = bp.mode === 'open' ? 'open' : 'approve'
    else if (bp.op === 'tab' && pm.users[rid]) { pm.users[rid].tabs = pm.users[rid].tabs || {}; pm.users[rid].tabs[String(bp.tab)] = bp.val ? 1 : 0 } // 分頁細部權限（張良 2026-10-01）
    else if (bp.op === 'see' && pm.users[rid]) { const u9 = pm.users[rid]; u9.hide = u9.hide || {}; if (bp.val) delete u9.hide[String(bp.tab)]; else u9.hide[String(bp.tab)] = 1 } // v4.26.3 每頁看不看得見（hide[tab]=1=隱藏）
    else if (bp.op === 'rowall' && pm.users[rid] && !pm.users[rid].admin) { // v4.31.0 一鍵開關「一個人」整列（張良：橫向一次開關一個人；tab=逗號串的分頁清單）
      const u9 = pm.users[rid]
      for (const k9 of String(bp.tab || '').split(',').filter(Boolean)) {
        if (bp.kind === 'see') { u9.hide = u9.hide || {}; if (bp.val) delete u9.hide[k9]; else u9.hide[k9] = 1 }
        else { u9.tabs = u9.tabs || {}; u9.tabs[k9] = bp.val ? 1 : 0 }
      }
    }
    else if (bp.op === 'taball') { // v4.26.3 一鍵勾選所有人（kind: edit|see）
      const kindT = bp.kind === 'see' ? 'see' : 'edit'
      for (const u9 of Object.values(pm.users)) {
        if (u9.admin) continue
        if (kindT === 'edit') { u9.tabs = u9.tabs || {}; u9.tabs[String(bp.tab)] = bp.val ? 1 : 0 }
        else { u9.hide = u9.hide || {}; if (bp.val) delete u9.hide[String(bp.tab)]; else u9.hide[String(bp.tab)] = 1 }
      }
    }
    await kvPut('sp_finance_pm_prep_perm', pm, '權限管理(' + who.name + ')')
    return res.status(200).json({ ok: true, perm: pm })
  }
  // 測試口（v4.33.1 張良：先發一則會議提醒給我測連結帶不帶身分）：?meetping=<MENU_PROBE_KEY>&name=張良
  // 原樣複製 joya-intraday 追簽提醒的訊息格式：有綁定→個人連結?me=token#meet=最新一則；同時發 GD 推播（有開🔔才收得到）
  if (req.query?.meetping) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.meetping) !== mk) return res.status(403).json({ ok: false })
    const nmT = String(req.query.name || '張良')
    const [rosT, meetT, bdT] = await Promise.all([kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_meet'), kvGet('sp_finance_pm_prep_bind')])
    const poT = ((rosT || {}).people || []).find(p => (p.name || '').includes(nmT) && p.lineUserId)
    if (!poT) return res.status(404).json({ ok: false, error: '名冊找不到有LINE的 ' + nmT })
    const itT = (((meetT || {}).list) || []).find(x => x.pubTs) || (((meetT || {}).list) || [])[0]
    if (!itT) return res.status(404).json({ ok: false, error: '沒有會議紀錄可以測' })
    const tkPT = ((bdT || {}).byUid || {})[poT.lineUserId]
    if (req.query.probe) { // v4.33.3 診斷（張良點測試連結還是訪客）：檢查 byUid token 是否能解析成身分，不發訊息
      const recP = tkPT ? ((bdT || {}).tokens || {})[tkPT] : null
      const whoP = tkPT ? await sopWho(tkPT) : null
      const allTk = Object.entries((bdT || {}).tokens || {}).filter(([, v]) => v.uid === poT.lineUserId || v.rid === poT.id)
      return res.status(200).json({ ok: true, name: poT.name, rosterId: poT.id, hasByUid: !!tkPT, byUidTokenHead: tkPT ? String(tkPT).slice(0, 6) + '…' : null, tokenRecord: recP ? { rid: recP.rid, name: recP.name } : null, sopWhoOK: !!whoP, whoName: whoP ? whoP.name : null, tokensForThisPerson: allTk.map(([k, v]) => ({ head: k.slice(0, 6) + '…', rid: v.rid, name: v.name })) })
    }
    const lnkT = tkPT ? `https://ground-pm.vercel.app/prep?me=${tkPT}#meet=${itT.id}` : prepLink('meet=' + itT.id)
    const tkLT = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
    if (!tkLT) return res.status(500).json({ ok: false, error: '沒有 LINE token' })
    const prT = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkLT }, body: JSON.stringify({ to: poT.lineUserId, messages: [{ type: 'text', text: `📣 會議宣達還沒簽收（測試）\n【${itT.type}・${itT.date}】\n點下面連結直達這則，看完按「✅ 確認熟知」，有問題按「❓ 我想發問」👇\n${lnkT}` }] }) })
    let wpT = 0; try {
      const nPendT = (((meetT || {}).list) || []).filter(x => x.pubTs && (x.ackNames || []).includes(poT.name) && !((x.acks || {})[poT.name] && x.acks[poT.name].ver === (x.ver || 1))).length
      wpT = await wpPushUids([poT.lineUserId], { title: '📣 會議簽收提醒（測試）', body: `【${itT.type}・${itT.date}】點開直達這則`, url: '/prep#meet=' + itT.id, badge: nPendT || 1 })
    } catch (_) {}
    return res.status(200).json({ ok: prT.ok, to: poT.name, meet: itT.id, linkType: tkPT ? '個人連結(自動帶身分)' : 'LIFF/https(未綁定)', webpushSent: wpT })
  }
  // ── 🔔 Web Push＋LIFF（v4.33.0 張良：點通知直接打開主畫面GD+本人身分；LINE群組連結點開自動認人不再是訪客）──
  // 設定口（公開資訊）：GET ?webpushcfg=1 → VAPID 公鑰 + LIFF id（公鑰本來就是公開的，LIFF id 也是）
  if (req.query?.webpushcfg) {
    const { wpPubKey } = await import('./_webpush.js')
    return res.status(200).json({ ok: true, key: wpPubKey() || null, liff: (process.env.LIFF_ID || '').trim() || null })
  }
  // 訂閱口：POST ?pushsub=<OPS_BOARD_KEY> {token, sub, off} → 綁定者本人存訂閱（off=1 取消）
  if (req.method === 'POST' && req.query?.pushsub) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.pushsub) !== ok2) return res.status(403).json({ ok: false })
    let bw = {}; try { bw = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoW = await sopWho(bw.token)
    if (!whoW) return res.status(403).json({ ok: false, error: permDeny() })
    const ep = bw.sub && bw.sub.endpoint
    if (!ep) return res.status(400).json({ ok: false, error: '缺訂閱資料' })
    const ridW = whoW.rid || whoW.uid
    const docW = (await kvGet('sp_finance_pm_push_subs')) || {}
    const recW = docW[ridW] || { name: whoW.name, subs: [] }
    recW.name = whoW.name
    recW.subs = (recW.subs || []).filter(s => s.endpoint !== ep)
    if (!bw.off) recW.subs = [bw.sub, ...recW.subs].slice(0, 5) // 一人最多 5 裝置
    docW[ridW] = recW
    await kvPut('sp_finance_pm_push_subs', docW, '推播訂閱(' + whoW.name + (bw.off ? '取消' : '') + ')')
    return res.status(200).json({ ok: true, on: !bw.off })
  }
  // 🔔 通知已讀（v4.33.5 張良：手機桌面App圖示顯示未讀數）：GET ?ntfread=<OPS_BOARD_KEY>&me=token → 記本人已讀時間
  // 之後每次推播 badge=ts>已讀 的筆數＝跟 App 裡鈴鐺同數字
  if (req.query?.ntfread) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.ntfread) !== ok2) return res.status(403).json({ ok: false })
    const whoR9 = await sopWho(req.query.me)
    if (!whoR9) return res.status(200).json({ ok: true }) // 訪客沒有個人未讀
    const docR9 = (await kvGet('sp_finance_pm_prep_ntf')) || { list: [] }
    docR9.read = { ...(docR9.read || {}), [whoR9.rid || whoR9.uid]: new Date().toISOString() }
    await kvPut('sp_finance_pm_prep_ntf', docR9, '通知已讀(' + whoR9.name + ')')
    return res.status(200).json({ ok: true })
  }
  // 🔔 通知中心歷史（v4.33.4 張良：通知要有頁面+歷史+分類）：GET ?ntf=<OPS_BOARD_KEY>&me=token
  // 全員通知(to=null)人人看得到；指定對象的(to=[rids])只有本人看得到
  if (req.query?.ntf) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.ntf) !== ok2) return res.status(403).json({ ok: false })
    const [docN9, meN9] = await Promise.all([kvGet('sp_finance_pm_prep_ntf'), sopWho(req.query.me)])
    const ridN9 = meN9 ? (meN9.rid || meN9.uid) : null
    const pinN9 = new Set((((docN9 || {}).pins || {})[ridN9]) || []) // v4.52.2 本人釘選集合
    // v4.52.1（張良「新增有＠自己的分類」）：加 mine 旗標＝這則是「指定給我」(to 含我，非全員廣播)；只回布林不外洩收件名單
    // v4.52.2（張良「收件匣／釘選稍後處理」）：加 pinned 旗標＝本人有沒有釘這則
    const listN9 = ((docN9 || {}).list || []).filter(x => !x.to || (ridN9 && x.to.includes(ridN9))).slice(0, 100).map(({ to, ...r }) => ({ ...r, mine: !!(to && ridN9 && to.includes(ridN9)), pinned: pinN9.has(r.id) }))
    return res.status(200).json({ ok: true, list: listN9 })
  }
  // 📌 通知釘選/取消（v4.52.2 張良「收件匣／釘選稍後回頭處理」）：POST ?ntfpin=<OPS_BOARD_KEY> body={id,pin:1|0,token}
  // 釘選以人為準存 doc.pins[rid]=[ids]（跟已讀 doc.read[rid] 同一份文件）；要綁定身分才能釘
  if (req.query?.ntfpin) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.ntfpin) !== ok2) return res.status(403).json({ ok: false })
    let pb = {}; try { pb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoP9 = await sopWho(pb.token || req.query.me)
    if (!whoP9) return res.status(200).json({ ok: false, error: '要綁定身分才能釘選' })
    const idP9 = String(pb.id || '').trim(); if (!idP9) return res.status(400).json({ ok: false, error: '缺 id' })
    const docP9 = (await kvGet('sp_finance_pm_prep_ntf')) || { list: [] }
    const ridP9 = whoP9.rid || whoP9.uid
    docP9.pins = docP9.pins || {}
    const setP9 = new Set(docP9.pins[ridP9] || [])
    if (pb.pin) setP9.add(idP9); else setP9.delete(idP9)
    docP9.pins[ridP9] = [...setP9].slice(-200) // 最多留 200 筆釘選
    await kvPut('sp_finance_pm_prep_ntf', docP9, '通知釘選(' + whoP9.name + ')')
    return res.status(200).json({ ok: true, pins: docP9.pins[ridP9] })
  }
  // 🔔 通知測試口（管理金鑰）：GET ?ntfping=<MENU_PROBE_KEY>&name=張良瑋 → 對本人發一則測試推播（帶 badge=1 驗證圖示數字）
  if (req.query?.ntfping) {
    const mk9 = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk9 || String(req.query.ntfping) !== mk9) return res.status(403).json({ ok: false })
    const nmP9 = String(req.query.name || '').trim()
    const bdP9 = (await kvGet('sp_finance_pm_prep_bind')) || {}
    const hitP9 = Object.values(bdP9.tokens || {}).find(x => x.name === nmP9)
    if (!hitP9) return res.status(404).json({ ok: false, error: '找不到這個人的綁定' })
    const { wpPush } = await import('./_webpush.js')
    const sentP9 = await wpPush([hitP9.rid || hitP9.uid], { title: String(req.query.t || '🔔 通知中心上線'), body: String(req.query.b || '左下角鈴鐺＝通知歷史＋分類，這一則也會出現在裡面；App 圖示應該有數字 1'), url: '/prep', badge: 1, cat: 'other' })
    return res.status(200).json({ ok: true, sent: sentP9 })
  }
  // LIFF 換身分口：POST ?liffauth=1 {at}（LIFF access token）→ 伺服器跟 LINE 驗證拿 userId → 回個人 token
  // 安全：不信前端給的 userId，一定拿 at 去 LINE API 驗（不然誰都能冒名）
  if (req.method === 'POST' && req.query?.liffauth) {
    let bl9 = {}; try { bl9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const at9 = String(bl9.at || '')
    if (!at9) return res.status(400).json({ ok: false, error: '缺 access token' })
    try {
      const vr = await (await fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(at9))).json()
      if (!vr || !vr.client_id || vr.expires_in <= 0) return res.status(403).json({ ok: false, error: 'token 無效' })
      const pf = await (await fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + at9 } })).json()
      if (!pf || !pf.userId) return res.status(403).json({ ok: false, error: '拿不到身分' })
      const bd9 = (await kvGet('sp_finance_pm_prep_bind')) || {}
      const tk0 = (bd9.byUid || {})[pf.userId] || null
      return res.status(200).json({ ok: true, me: tk0, name: tk0 ? ((bd9.tokens || {})[tk0] || {}).name : null })
    } catch (_) { return res.status(502).json({ ok: false, error: 'LINE 驗證失敗' }) }
  }
  // ── 🪪 員工清冊 v4.34.0（張良：兩間公司到職日/生日/身分證，主管限定）：GET ?hrmaster=K&me=token；匯入 POST ?hrmasterset=<MENU_PROBE_KEY> ──
  if (req.query?.hrmaster) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.hrmaster) !== ok2) return res.status(403).json({ ok: false })
    // v4.41.3 張良拍板改規則：名冊「所有人（有登入）都可以看」；敏感的身分證欄另外用名單鎖（下面 idlock）
    const whoH9 = await sopWho(req.query.me)
    if (!whoH9) return res.status(403).json({ ok: false, error: permDeny() })
    // 🔒 身分證欄名單鎖（v4.41.2 張良「打勾的人才可以看到」）：預設只有管理者；名單存 pm_hr_idlock；沒在名單＝整欄伺服器端拔掉(不是前端藏)
    const [docH, lockH, pmH] = await Promise.all([kvGet('sp_crew_pm_hr_master'), kvGet('sp_finance_pm_hr_idlock'), kvGet('sp_finance_pm_prep_perm')])
    const ridH = whoH9.rid || whoH9.uid
    const isAdmH = !!(pmH && pmH.users && pmH.users[ridH] && pmH.users[ridH].admin)
    const canId = isAdmH || (((lockH || {}).rids) || []).includes(ridH)
    // v4.34.4 職務統一（張良「兼職改為PT 值班都改為正職」）：開頁順手搬家一次，之後選單制
    let mig44 = false
    ;((docH || {}).rows || []).forEach(r9 => { const t9 = { '兼職': 'PT', '值班': '正職' }[r9.title]; if (t9) { r9.title = t9; mig44 = true } })
    if (mig44) { docH.log = [{ by: '系統', ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: '職務統一：兼職→PT、值班→正職' }, ...(docH.log || [])].slice(0, 80); await kvPut('sp_crew_pm_hr_master', docH, '職務統一搬家') }
    let rowsH = (docH || { rows: [] }).rows || []
    if (!canId) rowsH = rowsH.map(({ nid, ...r9 }) => r9)
    const topts = (docH || {}).titleOpts || [...new Set(['正職', 'PT', ...rowsH.map(r9 => r9.title).filter(Boolean)])]
    const outH = { ok: true, rows: rowsH, titleOpts: topts, colOrder: (docH || {}).colOrder || [], updatedAt: (docH || {}).updatedAt || '', src: (docH || {}).src || '', idCan: canId, canEdit: isAdmH || whoH9.role === '主管' } // v4.41.3 全員可看但編輯鈕只給主管/管理者（寫入口 hrmasterup 本來就擋）
    if (isAdmH) outH.idLock = { rids: ((lockH || {}).rids) || [], people: Object.entries((pmH && pmH.users) || {}).map(([r9, u9]) => ({ rid: r9, name: u9.name, admin: !!u9.admin })) }
    return res.status(200).json(outH)
  }
  // 🔗 短網址 v4.38.0（張良「能縮短網址嗎」）：/v/<code> → 302 到完整深層連結；碼存 pm_shortlinks
  if (req.query?.vgo) {
    const slDoc = (await kvGet('pm_shortlinks')) || { map: {} }
    const tgt = (slDoc.map[String(req.query.vgo)] || {}).u
    return res.redirect(302, tgt || 'https://ground-pm.vercel.app/prep')
  }
  // 名單口：?viomgrs=K&me= → 可私訊的班表主管（班表編有勾+有LINE）
  if (req.query?.viomgrs) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.viomgrs) !== ok2) return res.status(403).json({ ok: false })
    const whoM0 = await permWho(req.query.me, 'shift')
    if (!whoM0) return res.status(403).json({ ok: false })
    const [pmM0, rosM0, bindM0] = await Promise.all([kvGet('sp_finance_pm_prep_perm'), kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_prep_bind')])
    const pplM0 = ((rosM0 || {}).people) || []
    const outM0 = []
    for (const [rid9, u9] of Object.entries(((pmM0 || {}).users) || {})) {
      if (!u9.edit) continue
      if (!u9.admin && u9.tabs && u9.tabs.shift === 0) continue
      const hasLine = (pplM0.find(p9 => p9.id === rid9) || {}).lineUserId || (Object.values((bindM0 || {}).tokens || {}).find(t9 => (t9.rid || t9.uid) === rid9) || {}).uid
      if (hasLine) outM0.push({ rid: rid9, name: u9.name })
    }
    return res.status(200).json({ ok: true, mgrs: outM0 })
  }
  // ── 📣 違規通知發送 v4.37.5（張良「通知按鈕 可選發給班表有勾編輯的主管 跟群發ABpeople」）：POST ?vionotify=K {token,to:mgrs|group,items:[{st,nm,dt,r,punch,link}]} ──
  if (req.method === 'POST' && req.query?.vionotify) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.vionotify) !== ok2) return res.status(403).json({ ok: false })
    let bn9 = {}; try { bn9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoN9 = await permWho(bn9.token, 'shift')
    if (!whoN9) return res.status(403).json({ ok: false, error: permDeny() })
    const items9 = (Array.isArray(bn9.items) ? bn9.items : []).slice(0, 8)
    if (!items9.length) return res.status(400).json({ ok: false, error: '沒有要通知的違規' })
    const tkN9 = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
    if (!tkN9) return res.status(502).json({ ok: false, error: '缺 LINE token' })
    // 短網址化（v4.38.0）
    const slDoc9 = (await kvGet('pm_shortlinks')) || { map: {} }
    const mkShort9 = (u9) => { const c9 = Math.random().toString(36).slice(2, 8); slDoc9.map[c9] = { u: u9, ts: Date.now() }; return 'https://ground-pm.vercel.app/v/' + c9 }
    const withShort = items9.map(it => ({ ...it, short: mkShort9(String(it.link || '')) }))
    { const es9 = Object.entries(slDoc9.map); if (es9.length > 500) { es9.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0)); es9.slice(0, es9.length - 500).forEach(([k9]) => delete slDoc9.map[k9]) } }
    await kvPut('pm_shortlinks', slDoc9, '短網址')
    const txt9 = `⚠️ 班表違規清單（${whoN9.name} 發送）\n` + withShort.map(it => `・${String(it.st).slice(0, 2)} ${String(it.dt).slice(5)} ${String(it.nm).slice(0, 10)}：${String(it.r).slice(0, 40)}\n　${String(it.punch || '').slice(0, 60)}\n　👉 ${it.short}`).join('\n') + `\n\n處理完到 /prep 班表「🔴 違規」按 ✅ 填處理內容 → 張良審核通過才銷案。`
    const { logPush, groupMembers } = await import('./push.js')
    // 📊 v4.42.2（張良轉CC許願單：違規清單群發底下沒顯示訊息則數）：發送前查額度、尾端補「本次X則｜本月Y/Z」＝跟其他群發同款
    const quota9 = async () => { try { const H9 = { authorization: 'Bearer ' + tkN9 }; const [q9, c9] = await Promise.all([fetch('https://api.line.me/v2/bot/message/quota', { headers: H9 }).then(x => x.json()), fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: H9 }).then(x => x.json())]); return { used: (c9 && c9.totalUsage != null) ? c9.totalUsage : -1, total: (q9 && q9.type === 'limited') ? q9.value : -1 } } catch (_) { return { used: -1, total: -1 } } }
    const qv9 = await quota9()
    const foot9 = (billed) => qv9.used < 0 ? '' : `\n\n📊 本次 ${billed} 則｜本月 ${qv9.used + billed}${qv9.total > 0 ? '/' + qv9.total : ''} 則`
    const sent9 = []
    if (bn9.to === 'group') {
      let gid9 = ''
      const seen9b = (await kvGet('pm_group_seen')) || {}
      for (const [g2, gg] of Object.entries(seen9b)) if (/abpeople|ab people/i.test(gg?.name || '')) { gid9 = g2; break }
      if (!gid9) return res.status(404).json({ ok: false, error: '找不到 ABpeople 群（DD 要先在群裡收過訊息）' })
      const mem9 = await groupMembers(gid9) // 先查人數＝真實扣額寫進訊息
      const pr9 = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkN9 }, body: JSON.stringify({ to: gid9, messages: [{ type: 'text', text: txt9 + foot9(mem9) }] }) })
      if (!pr9.ok) return res.status(502).json({ ok: false, error: 'LINE 發送失敗' })
      try { await logPush(gid9, 1, '違規清單群發', mem9) } catch (_) {}
      sent9.push('ABpeople 群')
    } else { // mgrs＝權限表「班表・編」有勾的人（含管理者），要綁定過才有 LINE
      const [pmN9, rosN9, bindN9] = await Promise.all([kvGet('sp_finance_pm_prep_perm'), kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_prep_bind')])
      const ppl9 = ((rosN9 || {}).people) || []
      const pickR = Array.isArray(bn9.rids) ? new Set(bn9.rids.map(String)) : null // v4.37.6 可選人,不直接都發
      for (const [rid9, u9] of Object.entries(((pmN9 || {}).users) || {})) {
        if (pickR && !pickR.has(String(rid9))) continue
        if (!u9.edit) continue
        if (!u9.admin && u9.tabs && u9.tabs.shift === 0) continue // 班表編沒勾=跳過
        let uid9 = (ppl9.find(p9 => p9.id === rid9) || {}).lineUserId
        if (!uid9) uid9 = (Object.values((bindN9 || {}).tokens || {}).find(t9 => (t9.rid || t9.uid) === rid9) || {}).uid
        if (!uid9) continue
        const pr9 = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkN9 }, body: JSON.stringify({ to: uid9, messages: [{ type: 'text', text: txt9 + foot9(1) }] }) })
        if (pr9.ok) { sent9.push(u9.name); await logPush(uid9, 1, '違規清單私訊') }
      }
      if (!sent9.length) return res.status(404).json({ ok: false, error: '找不到可通知的班表主管（要有班表編輯權＋綁定過 LINE）' })
    }
    return res.status(200).json({ ok: true, sent: sent9 })
  }
  // ── 🧩 AB 模組班表 v4.45.0（張良：四週模組方法論搬進系統,人為列編輯+自動體檢）：GET ?abmod=K&me= / POST ?abmodset=K ──
  if (req.query?.abmod) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.abmod) !== ok2) return res.status(403).json({ ok: false })
    const [whoAm, defAm] = await Promise.all([sopWho(req.query.me), kvGet('sp_finance_pm_sop_def')])
    const aprAm = (((defAm || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoAm || !(aprAm.includes(whoAm.name) || whoAm.name === '張良瑋' || whoAm.role === '主管')) return res.status(403).json({ ok: false, error: '模組班表主管限定' })
    const [docAm, stfAm, payAm, rosAm] = await Promise.all([kvGet('sp_finance_pm_abmod'), kvGet('sp_crew_pm_hr_staff'), kvGet('sp_finance_pm_payrates'), kvGet('sp_crew_kb_roster')])
    const onAm = (((stfAm || {}).names) || []).filter(n9 => { const p9 = ((rosAm || {}).people || []).find(q9 => q9.name === n9); return !(p9 && p9.endDate) })
    return res.status(200).json({ ok: true, mods: (docAm || {}).mods || [], staff: (stfAm || {}).names || [], abOn: onAm, payRates: (payAm || {}).rates || {} })
  }
  if (req.method === 'POST' && req.query?.abmodset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.abmodset) !== ok2) return res.status(403).json({ ok: false })
    let bm9 = {}; try { bm9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoAm2 = await permWho(bm9.token, 'shift')
    if (!whoAm2) return res.status(403).json({ ok: false, error: permDeny() })
    const docAm2 = (await kvGet('sp_finance_pm_abmod')) || { mods: [] }
    if (!Array.isArray(bm9.mods)) return res.status(400).json({ ok: false })
    docAm2.mods = bm9.mods.slice(0, 12)
    docAm2.log = [{ by: whoAm2.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') }, ...(docAm2.log || [])].slice(0, 40)
    await kvPut('sp_finance_pm_abmod', docAm2, 'AB模組班表(' + whoAm2.name + ')')
    return res.status(200).json({ ok: true })
  }
  // ── ✅ 違規處理紀錄 v4.37.0（張良「負責人調整確認完才消失 不然一直提醒;處理完進紀錄留存」）：POST ?vioresset=K {token,key,op:done|undo,note} ──
  if (req.method === 'POST' && req.query?.vioresset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.vioresset) !== ok2) return res.status(403).json({ ok: false })
    let bv9 = {}; try { bv9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoV9 = await permWho(bv9.token, 'shift')
    if (!whoV9) return res.status(403).json({ ok: false, error: permDeny() })
    const docV = (await kvGet('sp_finance_pm_vio_res')) || { items: {} }
    const keyV = String(bv9.key || '').slice(0, 80); if (!keyV) return res.status(400).json({ ok: false })
    const defV9 = await kvGet('sp_finance_pm_sop_def')
    const aprV9 = (((defV9 || {}).ground || {}).approvers || ['張良瑋'])
    const isApr = aprV9.includes(whoV9.name) || whoV9.name === '張良瑋'
    const ts8V = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    if (bv9.op === 'done') { // v4.38.0 處理=必填內容→待審核（張良「要記錄姓名時間處理內容 我審核才能真的銷案」）
      const noteV = String(bv9.note || '').trim()
      if (!noteV) return res.status(400).json({ ok: false, error: '要寫「處理了什麼」才能送審' })
      docV.items[keyV] = { by: whoV9.name, ts: ts8V, note: noteV.slice(0, 200), r: String(bv9.r || '').slice(0, 60), st: 'pending' }
    } else if (bv9.op === 'approve') {
      if (!isApr) return res.status(403).json({ ok: false, error: '只有審核人（張良）能核准銷案' })
      const it9 = docV.items[keyV]; if (!it9) return res.status(404).json({ ok: false })
      it9.st = 'ok'; it9.apBy = whoV9.name; it9.apTs = ts8V
    } else if (bv9.op === 'reject') {
      if (!isApr) return res.status(403).json({ ok: false, error: '只有審核人能退回' })
      delete docV.items[keyV] // 退回=回到待處理（原處理紀錄進 log）
      docV.log = [{ ts: ts8V, what: '退回 ' + keyV, by: whoV9.name }, ...(docV.log || [])].slice(0, 60)
    } else if (bv9.op === 'undo') {
      if (!isApr) return res.status(403).json({ ok: false, error: '只有審核人能復原' })
      delete docV.items[keyV]
    } else return res.status(400).json({ ok: false })
    await kvPut('sp_finance_pm_vio_res', docV, '違規處理(' + whoV9.name + ' ' + (bv9.op || '') + ')')
    return res.status(200).json({ ok: true, items: docV.items })
  }
  // ── 🕐 AB 出勤總覽 v4.36.0（張良「6/1起所有人打卡紀錄,看出遲到/沒打卡,像營業額那樣好查」）：?abatt=K&me=&from=YYYY-MM；主管限定 ──
  if (req.query?.abatt) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.abatt) !== ok2) return res.status(403).json({ ok: false })
    const [whoA9, defA9] = await Promise.all([sopWho(req.query.me), kvGet('sp_finance_pm_sop_def')])
    const aprA9 = (((defA9 || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoA9 || !(aprA9.includes(whoA9.name) || whoA9.name === '張良瑋' || whoA9.role === '主管')) return res.status(403).json({ ok: false, error: '出勤紀錄主管限定' })
    const fromA = /^\d{4}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '2026-06'
    const mos = []; { let [y9, m9] = fromA.split('-').map(Number); const now9 = new Date(Date.now() + 8 * 3600e3); while (y9 < now9.getUTCFullYear() || (y9 === now9.getUTCFullYear() && m9 <= now9.getUTCMonth() + 1)) { mos.push(y9 + '-' + String(m9).padStart(2, '0')); if (++m9 > 12) { m9 = 1; y9++ } } }
    const docs9 = await Promise.all(mos.map(m9 => kvGet('sp_crew_pm_hr_att_' + m9)))
    const outA = []
    for (const ad of docs9) {
      for (const [dt9, users9] of Object.entries((ad || {}).days || {})) {
        for (const rec9 of Object.values(users9)) {
          if (!/AB/.test(rec9.dept || '')) continue
          outA.push({ d: dt9, n: String(rec9.name || '').replace(/\s+[A-Za-z].*$/, ''), w: rec9.work || '', on: (rec9.on || [])[0] || '', off: (rec9.off || []).slice(-1)[0] || '', h: Math.round(((Number(rec9.durmin) || 0) / 60) * 10) / 10, late: rec9.late || 0, early: rec9.early || 0, miss: rec9.miss || 0, abs: rec9.absent || 0 })
        }
      }
    }
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
    return res.status(200).json({ ok: true, from: fromA, rows: outA })
  }
  // ── 📎 入職文件 v4.35.0（張良「體檢要能直接上傳檔案給勞檢稽核；一般入職文件列出來做在夥伴名冊」）──
  // 標準清單（台灣餐飲業）：勞動契約/身分證影本/存摺影本/體檢報告/大頭照/緊急聯絡人/勞健保加保/衛生教育訓練/未成年法代同意書
  // 檔案一律進私有桶 ground-private（個資），看檔=5分鐘簽名網址；上傳=頁面或 LINE 私訊 DD「文件 姓名 文件名」+照片/檔案
  if (req.method === 'POST' && req.query?.hrdocup) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.hrdocup) !== ok2) return res.status(403).json({ ok: false })
    let bd0 = {}; try { bd0 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const [whoD0, defD0] = await Promise.all([sopWho(bd0.token), kvGet('sp_finance_pm_sop_def')])
    const aprD0 = (((defD0 || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoD0 || !(aprD0.includes(whoD0.name) || whoD0.name === '張良瑋' || whoD0.role === '主管')) return res.status(403).json({ ok: false, error: '只有主管能上傳入職文件' })
    const m0 = /^data:([\w\/+.-]+);base64,(.+)$/.exec(String(bd0.dataUrl || ''))
    if (!m0) return res.status(400).json({ ok: false, error: '檔案格式不對' })
    const buf0 = Buffer.from(m0[2], 'base64')
    if (buf0.length > 8 * 1024 * 1024) return res.status(400).json({ ok: false, error: '檔案太大（上限8MB）' })
    const docM = (await kvGet('sp_crew_pm_hr_master')) || { rows: [] }
    const row0 = (docM.rows || []).find(r9 => r9.co === bd0.co && r9.name === bd0.name)
    if (!row0) return res.status(404).json({ ok: false, error: '找不到這個人' })
    const key0 = String(bd0.key || '').replace(/[^a-z]/g, '').slice(0, 20); if (!key0) return res.status(400).json({ ok: false })
    const ext0 = String(bd0.ext || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'
    const { uploadPrivate } = await import('./_onboard.js')
    const path0 = `hrdocs/${/A Beach/.test(bd0.co) ? 'ab' : 'gd'}/${encodeURIComponent(bd0.name)}/${key0}-${Date.now().toString(36)}.${ext0}`
    if (!(await uploadPrivate(path0, buf0, m0[1]))) return res.status(502).json({ ok: false, error: '上傳失敗' })
    row0.docs = row0.docs || {}; row0.docs[key0] = row0.docs[key0] || { files: [] }
    row0.docs[key0].files.push({ path: path0, ext: ext0, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), by: whoD0.name })
    docM.log = [{ by: whoD0.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: `上傳 ${bd0.name} ${key0}` }, ...(docM.log || [])].slice(0, 80)
    docM.updatedAt = new Date().toISOString()
    await kvPut('sp_crew_pm_hr_master', docM, '入職文件上傳(' + whoD0.name + ')')
    return res.status(200).json({ ok: true, docs: row0.docs })
  }
  if (req.query?.hrdocurl) { // 看檔：5 分鐘簽名網址（主管限定）
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.hrdocurl) !== ok2) return res.status(403).json({ ok: false })
    const [whoD1, defD1] = await Promise.all([sopWho(req.query.me), kvGet('sp_finance_pm_sop_def')])
    const aprD1 = (((defD1 || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoD1 || !(aprD1.includes(whoD1.name) || whoD1.name === '張良瑋' || whoD1.role === '主管')) return res.status(403).json({ ok: false, error: '主管限定' })
    const docM = (await kvGet('sp_crew_pm_hr_master')) || { rows: [] }
    const row1 = (docM.rows || []).find(r9 => r9.co === String(req.query.co) && r9.name === String(req.query.nm))
    const f1 = (((row1 || {}).docs || {})[String(req.query.key)] || {}).files || []
    const file1 = f1[Number(req.query.i) || 0]
    if (!file1) return res.status(404).json({ ok: false })
    const { signedUrl } = await import('./_onboard.js')
    let u1 = await signedUrl(file1.path, 300)
    if (!u1) return res.status(502).json({ ok: false })
    if (req.query.dl) u1 += (u1.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(String(req.query.dl).slice(0, 80)) // v4.38.3 統一檔名下載
    return res.redirect(302, u1)
  }
  if (req.method === 'POST' && req.query?.hrdocdel) { // 刪檔（主管限定，檔案留桶只移連結=可救回）
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.hrdocdel) !== ok2) return res.status(403).json({ ok: false })
    let bd2 = {}; try { bd2 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const [whoD2, defD2] = await Promise.all([sopWho(bd2.token), kvGet('sp_finance_pm_sop_def')])
    const aprD2 = (((defD2 || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoD2 || !(aprD2.includes(whoD2.name) || whoD2.name === '張良瑋' || whoD2.role === '主管')) return res.status(403).json({ ok: false })
    const docM = (await kvGet('sp_crew_pm_hr_master')) || { rows: [] }
    const row2 = (docM.rows || []).find(r9 => r9.co === bd2.co && r9.name === bd2.name)
    const slot2 = ((row2 || {}).docs || {})[String(bd2.key || '')]
    if (!slot2 || !slot2.files[Number(bd2.i)]) return res.status(404).json({ ok: false })
    slot2.files.splice(Number(bd2.i), 1)
    docM.log = [{ by: whoD2.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: `刪檔 ${bd2.name} ${bd2.key}` }, ...(docM.log || [])].slice(0, 80)
    await kvPut('sp_crew_pm_hr_master', docM, '入職文件刪檔(' + whoD2.name + ')')
    return res.status(200).json({ ok: true, docs: row2.docs })
  }
  // ✏️ 夥伴名冊編輯口 v4.34.3（張良「整個清冊要可以讓我跟有權限的人編輯」）：主管限定＋留痕；身分證欄要有 idLock 檢視權才能改
  if (req.method === 'POST' && req.query?.hrmasterup) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.hrmasterup) !== ok2) return res.status(403).json({ ok: false })
    let bu9 = {}; try { bu9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const [whoU9, defU9, lockU9, pmU9] = await Promise.all([sopWho(bu9.token), kvGet('sp_finance_pm_sop_def'), kvGet('sp_finance_pm_hr_idlock'), kvGet('sp_finance_pm_prep_perm')])
    const aprU9 = (((defU9 || {}).ground || {}).approvers || ['張良瑋'])
    if (!whoU9 || !(aprU9.includes(whoU9.name) || whoU9.name === '張良瑋' || whoU9.role === '主管')) return res.status(403).json({ ok: false, error: '只有主管能編輯名冊' })
    const ridU = whoU9.rid || whoU9.uid
    const admU = !!(pmU9 && pmU9.users && pmU9.users[ridU] && pmU9.users[ridU].admin)
    const canIdU = admU || (((lockU9 || {}).rids) || []).includes(ridU)
    const FLDS = ['name', 'dept', 'title', 'onboard', 'birth', 'age', 'sex', 'nid', 'health', 'emer']
    const docU = (await kvGet('sp_crew_pm_hr_master')) || { rows: [] }
    docU.rows = docU.rows || []
    const ts8U = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    const findU = () => docU.rows.find(r9 => r9.co === bu9.co && r9.name === bu9.name)
    if (bu9.op === 'set') {
      const row9 = findU(); if (!row9) return res.status(404).json({ ok: false, error: '找不到這個人' })
      const fd9 = String(bu9.field || '')
      if (!FLDS.includes(fd9)) return res.status(400).json({ ok: false, error: '不認識的欄位' })
      if (fd9 === 'nid' && !canIdU) return res.status(403).json({ ok: false, error: '你沒有身分證欄的權限' })
      row9[fd9] = String(bu9.val ?? '').slice(0, 60).trim()
      if (fd9 === 'birth' && /^\d{4}-\d{2}-\d{2}$/.test(row9.birth)) row9.age = Math.floor((Date.now() - new Date(row9.birth).getTime()) / 31557600000) // 改生日→年齡自動跟
    } else if (bu9.op === 'add') {
      if (!bu9.co) return res.status(400).json({ ok: false })
      docU.rows.push({ co: String(bu9.co).slice(0, 40), name: String(bu9.newName || '新夥伴').slice(0, 20), dept: '', title: '', onboard: '', birth: '', age: '', sex: '', nid: '', health: '' })
    } else if (bu9.op === 'titleopts') { // 職務選單自訂（張良「我可以新增刪減編輯選單」）
      docU.titleOpts = (Array.isArray(bu9.list) ? bu9.list : []).map(x9 => String(x9).trim().slice(0, 12)).filter(Boolean).slice(0, 20)
    } else if (bu9.op === 'colorder') { // v4.35.1 欄位順序自訂（全裝置共用）
      docU.colOrder = (Array.isArray(bu9.list) ? bu9.list : []).map(x9 => String(x9).slice(0, 12)).slice(0, 20)
    } else if (bu9.op === 'del') {
      const row9 = findU(); if (!row9) return res.status(404).json({ ok: false })
      docU.rows = docU.rows.filter(r9 => r9 !== row9)
    } else return res.status(400).json({ ok: false })
    docU.log = [{ by: whoU9.name, ts: ts8U, what: `${bu9.op} ${bu9.name || bu9.newName || ''} ${bu9.field || ''}`.trim() }, ...(docU.log || [])].slice(0, 80)
    docU.updatedAt = new Date().toISOString()
    await kvPut('sp_crew_pm_hr_master', docU, '夥伴名冊編輯(' + whoU9.name + ')')
    return res.status(200).json({ ok: true, rows: canIdU ? docU.rows : docU.rows.map(({ nid, ...r9 }) => r9), titleOpts: docU.titleOpts || [], colOrder: docU.colOrder || [] })
  }
  if (req.method === 'POST' && req.query?.hrmasterset) {
    const mk9 = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk9 || String(req.query.hrmasterset) !== mk9) return res.status(403).json({ ok: false })
    let bh9 = {}; try { bh9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    if (Array.isArray(bh9.updates) && bh9.updates.length) { // v4.35.4 合併修資料（不整份覆蓋）
      const docU9 = (await kvGet('sp_crew_pm_hr_master')) || { rows: [] }
      const outU9 = []
      for (const u9 of bh9.updates) {
        const r9 = (docU9.rows || []).find(x9 => x9.name === u9.name && (!u9.co || x9.co === u9.co))
        if (!r9) { outU9.push(u9.name + ':notfound'); continue }
        Object.assign(r9, u9.set || {})
        outU9.push(u9.name + ':ok')
      }
      docU9.updatedAt = new Date().toISOString()
      await kvPut('sp_crew_pm_hr_master', docU9, '名冊合併修資料')
      return res.status(200).json({ ok: true, results: outU9 })
    }
    if (!Array.isArray(bh9.rows) || !bh9.rows.length) return res.status(400).json({ ok: false, error: '要給 rows' })
    const docH = { rows: bh9.rows.slice(0, 300), src: String(bh9.src || '').slice(0, 200), updatedAt: new Date().toISOString() }
    await kvPut('sp_crew_pm_hr_master', docH, '員工清冊匯入(' + docH.rows.length + '人)')
    return res.status(200).json({ ok: true, n: docH.rows.length })
  }
  // ── 💰 薪資費率口 v4.33.0（張良：薪資條表格給會計師）：POST ?payset= {token,name,field:base|allow,val} ──
  if (req.method === 'POST' && req.query?.payset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.payset) !== ok2) return res.status(403).json({ ok: false })
    let bp9 = {}; try { bp9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoP9 = await permWho(bp9.token, 'shift')
    if (!whoP9) return res.status(403).json({ ok: false, error: permDeny() })
    const docP = (await kvGet('sp_finance_pm_payrates')) || { rates: {} }
    const nm9 = String(bp9.name || '').slice(0, 20); if (!nm9) return res.status(400).json({ ok: false })
    const fd9 = bp9.field === 'allow' ? 'allow' : 'base'
    docP.rates[nm9] = docP.rates[nm9] || {}
    docP.rates[nm9][fd9] = Math.max(0, Math.min(999999, Number(bp9.val) || 0))
    docP.rates[nm9].by = whoP9.name; docP.rates[nm9].ts = new Date().toISOString()
    await kvPut('sp_finance_pm_payrates', docP, '薪資費率 ' + nm9 + '(' + whoP9.name + ')')
    return res.status(200).json({ ok: true, rates: docP.rates })
  }
  // ── 🧮 工時成本試算（張良 2026-10-03：每小時×崗位填金額、右/下自動加總、方案制可存版本切換比較）──
  if (req.query?.labor) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.labor) !== ok2) return res.status(403).json({ ok: false })
    const [docL, meL] = await Promise.all([kvGet('sp_finance_pm_labor'), sopWho(req.query.me)])
    return res.status(200).json({ ok: true, sheets: (docL || {}).sheets || [], versions: (docL || {}).versions || [], me: meL ? { name: meL.name } : null })
  }
  if (req.method === 'POST' && req.query?.laborset) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.laborset) !== ok2) return res.status(403).json({ ok: false })
    let bl = {}; try { bl = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoL = await permWho(bl.token, 'shift') // v4.28.1 掛班表下面=吃班表權限
    if (!whoL) return res.status(403).json({ ok: false, error: permDeny() })
    const doc = (await kvGet('sp_finance_pm_labor')) || { sheets: [] }
    if (bl.op === 'save') {
      const shIn = bl.sheet || {}
      const rowsC = {}
      for (const [h, ro] of Object.entries(shIn.rows || {})) {
        if (!/^\d{2}$/.test(h)) continue
        const r2 = {}
        for (const [ci, v] of Object.entries(ro || {})) { const n2 = Number(v) || 0; if (n2) r2[ci] = Math.max(0, Math.min(999999, n2)) }
        if (Object.keys(r2).length) rowsC[h] = r2
      }
      const finIn = shIn.fin || {}
      const nf = (v, mx) => Math.max(0, Math.min(mx, Number(v) || 0))
      const finC = { rent: nf(finIn.rent, 9999999), util: nf(finIn.util, 9999999), misc: nf(finIn.misc, 9999999), days: Math.max(1, Math.min(31, Number(finIn.days) || 26)), food: nf(finIn.food, 99), tax: nf(finIn.tax, 99), pay: nf(finIn.pay, 99), ins: nf(finIn.ins, 99), profit: nf(finIn.profit, 99) }
      const clean = { fin: finC, wage: Math.max(1, Math.min(9999, Number(shIn.wage) || 300)), pct: Math.max(1, Math.min(99, Number(shIn.pct) || 20)), id: shIn.id || 'lb' + Date.now().toString(36), name: String(shIn.name || '方案').slice(0, 20), cols: (Array.isArray(shIn.cols) ? shIn.cols : []).map(c => String(c).trim().slice(0, 12)).filter(Boolean).slice(0, 20), rows: rowsC, by: whoL.name, ts: new Date().toISOString() }
      doc.sheets = [...(doc.sheets || []).filter(x => x.id !== clean.id), clean].slice(-20)
      await kvPut('sp_finance_pm_labor', doc, '工時成本 ' + clean.name + '(' + whoL.name + ')')
      return res.status(200).json({ ok: true, id: clean.id })
    } else if (bl.op === 'del') {
      doc.sheets = (doc.sheets || []).filter(x => x.id !== bl.id)
      await kvPut('sp_finance_pm_labor', doc, '工時成本刪方案(' + whoL.name + ')')
      return res.status(200).json({ ok: true })
    } else if (bl.op === 'snap') { // v4.31.6（張良「存檔+版本檔案庫 怕自己或別人動到」）：目前方案拍快照進版本庫，之後自動儲存動不到它
      const shS = (doc.sheets || []).find(x => x.id === bl.id)
      if (!shS) return res.status(404).json({ ok: false, error: '找不到方案' })
      const ts8 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
      const v9 = { vid: 'lv' + Date.now().toString(36), name: String(bl.name || (shS.name + ' ' + ts8)).slice(0, 40), by: whoL.name, ts: ts8, sheet: JSON.parse(JSON.stringify(shS)) }
      doc.versions = [...(doc.versions || []), v9].slice(-40)
      await kvPut('sp_finance_pm_labor', doc, '工時成本存檔「' + v9.name + '」(' + whoL.name + ')')
      return res.status(200).json({ ok: true, versions: doc.versions })
    } else if (bl.op === 'restore') { // 還原：快照蓋回同 id 方案（方案被刪了就補回來）
      const v9 = (doc.versions || []).find(x => x.vid === bl.vid)
      if (!v9) return res.status(404).json({ ok: false, error: '找不到這個版本' })
      const shR = JSON.parse(JSON.stringify(v9.sheet)); shR.by = whoL.name; shR.ts = new Date().toISOString()
      const i9 = (doc.sheets || []).findIndex(x => x.id === shR.id)
      if (i9 >= 0) doc.sheets[i9] = shR; else doc.sheets = [...(doc.sheets || []), shR]
      await kvPut('sp_finance_pm_labor', doc, '工時成本還原「' + v9.name + '」(' + whoL.name + ')')
      return res.status(200).json({ ok: true, sheets: doc.sheets, versions: doc.versions || [] })
    } else if (bl.op === 'vdel') {
      doc.versions = (doc.versions || []).filter(x => x.vid !== bl.vid)
      await kvPut('sp_finance_pm_labor', doc, '工時成本刪版本(' + whoL.name + ')')
      return res.status(200).json({ ok: true, versions: doc.versions })
    } else if (bl.op === 'vren') {
      const v9 = (doc.versions || []).find(x => x.vid === bl.vid)
      if (v9) { v9.name = String(bl.name || v9.name).slice(0, 40); await kvPut('sp_finance_pm_labor', doc, '工時成本版本改名(' + whoL.name + ')') }
      return res.status(200).json({ ok: true, versions: doc.versions || [] })
    }
    return res.status(400).json({ ok: false })
  }
  // boss-api 資料盤點探針（MENU_PROBE_KEY；2026-10-04 串接後盤點用）：?bossprobe=<key> 回各檔筆數+欄位+每類一筆樣本
  if (req.query?.bossprobe) {
    const mkP = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mkP || String(req.query.bossprobe) !== mkP) return res.status(403).json({ ok: false })
    const r9 = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.sp_finance_pm_boss_*&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows9 = r9.ok ? await r9.json() : []
    const files = [], samples = {}
    for (const row of rows9) {
      let v = null; try { v = typeof row.data?.v === 'string' ? JSON.parse(row.data.v) : row.data?.v } catch (_) {}
      const rr = (v && v.rows) ? Object.values(v.rows) : (Array.isArray(v) ? v : (v && typeof v === 'object' && !v.rows ? [v] : []))
      const n2 = (v && v.rows) ? Object.keys(v.rows).length : rr.length
      files.push({ id: row.id, n: n2 })
      const slug9 = row.id.replace('sp_finance_pm_boss_', '').replace(/_\d{6}$/, '')
      if (!samples[slug9] && rr.length) samples[slug9] = rr[0]
    }
    files.sort((a, b) => a.id.localeCompare(b.id))
    return res.status(200).json({ ok: true, files, samples })
  }
  // 補發綁定審核按鈕卡（MENU_PROBE_KEY；張良 2026-10-03「這兩個請DD傳給我試試看」）：?bindcard=<key> 把待審核名單逐一發按鈕卡給審核人
  if (req.query?.bindcard) {
    const mkB = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mkB || String(req.query.bindcard) !== mkB) return res.status(403).json({ ok: false })
    const tkB = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
    const [pmB, defB, rosB] = await Promise.all([kvGet('sp_finance_pm_prep_perm'), kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
    const aprB = (((defB || {}).ground || {}).approvers || ['張良瑋'])
    const pend = Object.entries(((pmB || {}).pending) || {})
    if (!pend.length) return res.status(200).json({ ok: true, sent: 0, note: '沒有待審核的申請' })
    const { buildBindApproveCard } = await import('./_ddcards.js')
    let sent = 0
    for (const an of aprB) {
      const ap = (((rosB || {}).people) || []).find(p2 => p2.name === an && p2.lineUserId)
      if (!ap) continue
      const msgs = pend.slice(0, 5).map(([rid9, pd9]) => buildBindApproveCard(pd9.name, rid9))
      const r9 = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkB }, body: JSON.stringify({ to: ap.lineUserId, messages: msgs }) })
      if (r9.ok) sent += msgs.length
    }
    return res.status(200).json({ ok: true, sent, pending: pend.map(([r9, p9]) => p9.name) })
  }
  // 老闆/AI 指令口（MENU_PROBE_KEY）：?prepperm=<key>&op=list|seed|approve|revoke|mode&rid=&name=&mode=
  if (req.query?.prepperm) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.prepperm) !== mk) return res.status(403).json({ ok: false })
    const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'approve', users: {}, pending: {} }
    const op = String(req.query.op || 'list')
    if (op === 'seed') { // 既有綁定者全數先給編輯權（不中斷現場）；名字含「張良」= admin
      const binds = (await kvGet('sp_finance_pm_prep_bind')) || {} // 正確鍵＋tokens 結構（第一次種到空的＝讀錯鍵）
      for (const u of Object.values(binds.tokens || {})) { const rid = u && u.rid; const nm = (u && u.name) || ''; if (!rid || !nm) continue; pm.users[rid] = { ...(pm.users[rid] || {}), name: nm, edit: 1, ...(/張良/.test(nm) ? { admin: 1 } : {}) } }
      pm.mode = 'approve'
      await kvPut('sp_finance_pm_prep_perm', pm, '權限種子')
    }
    if (op === 'fixbind') { // 綁定身分改正口（張良 2026-10-01：小夏用LINE名稱綁了→直接改正不用重綁）
      const match = String(req.query.match || ''), nm = String(req.query.name || '')
      const bd = (await kvGet('sp_finance_pm_prep_bind')) || { byUid: {}, tokens: {} }
      const roster = (await kvGet('sp_crew_kb_roster')) || {}
      const person = (roster.people || []).find(p2 => p2.name === nm || String(p2.nick || '').includes(nm))
      let fixed = []
      for (const t of Object.values(bd.tokens || {})) {
        if (!match || !((t.name || '').includes(match) || t.uid === match)) continue
        const oldKey = t.rid || t.uid
        t.name = person ? person.name : nm
        if (person) { t.rid = person.id; if (t.uid) { person.lineUserId = person.lineUserId || t.uid; person.gd = 1 } }
        const newKey = t.rid || t.uid
        // 待審/已核准名單同步改名＋換鍵
        for (const bag of ['pending', 'users']) {
          if (pm[bag] && pm[bag][oldKey]) { const v = pm[bag][oldKey]; delete pm[bag][oldKey]; pm[bag][newKey] = { ...v, name: t.name } }
        }
        fixed.push(t.name)
      }
      await kvPut('sp_finance_pm_prep_bind', bd, '綁定改正口')
      if (person) await kvPut('sp_crew_kb_roster', roster, '綁定改正口')
      await kvPut('sp_finance_pm_prep_perm', pm, '綁定改正口')
      return res.status(200).json({ ok: true, fixed, pending: Object.values(pm.pending || {}).map(v => v.name), users: Object.values(pm.users || {}).map(v => v.name) })
    }
    if (op === 'approve') { const rid = String(req.query.rid || ''); const nm = String(req.query.name || ''); const hit = rid ? [[rid, pm.pending[rid]]] : Object.entries(pm.pending).filter(([, v]) => v.name.includes(nm)); for (const [r, v] of hit) { if (v) { const sn = (pm.removed || {})[r]; pm.users[r] = { ...(sn ? { tabs: sn.tabs, hide: sn.hide } : prepPermTmpl(pm)), name: v.name, edit: 1, by: 'AI代操', ts: v.ts }; if (sn) delete pm.removed[r]; delete pm.pending[r]
      try { const { linePush } = await import('./_onboard.js'); const { logPush } = await import('./push.js'); let uidA = v.uid; if (!uidA) { const bd = (await kvGet('sp_finance_pm_prep_bind')) || {}; uidA = (Object.values(bd.tokens || {}).find(t => t.rid === r || t.uid === r) || {}).uid } if (uidA && await linePush(uidA, `✅ 你的 /prep 編輯權限審核通過了！重新整理頁面就能編輯。`)) await logPush(uidA, 1, 'prep編輯權核准') } catch (_) {}
    } } await kvPut('sp_finance_pm_prep_perm', pm, '權限核准(AI代操)') }
    if (op === 'revoke') { const nm = String(req.query.name || ''); for (const [r, v] of Object.entries(pm.users)) if (v.name.includes(nm) && !v.admin) { pm.removed = pm.removed || {}; pm.removed[r] = { ...v, rts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') }; delete pm.users[r] } await kvPut('sp_finance_pm_prep_perm', pm, '權限移除(AI代操)') } // v4.32.1 軟刪可復原
    if (op === 'restore') { const nm = String(req.query.name || ''); for (const [r, v] of Object.entries(pm.removed || {})) if (v.name.includes(nm)) { delete v.rts; pm.users[r] = v; delete pm.removed[r] } await kvPut('sp_finance_pm_prep_perm', pm, '權限復原(AI代操)') }
    if (op === 'normalize') { const nm = String(req.query.name || ''); const tp = prepPermTmpl(pm); for (const v of Object.values(pm.users)) if (!v.admin && v.name.includes(nm) && !v.tabs && !v.hide) { if (tp.tabs) v.tabs = { ...tp.tabs }; if (tp.hide) v.hide = { ...tp.hide } } await kvPut('sp_finance_pm_prep_perm', pm, '權限套團隊預設(AI代操)') } // v4.32.1 補正沒設定過的人
    if (op === 'mode') { pm.mode = String(req.query.mode) === 'open' ? 'open' : 'approve'; await kvPut('sp_finance_pm_prep_perm', pm, '權限模式(AI代操)') }
    return res.status(200).json({ ok: true, mode: pm.mode, users: Object.entries(pm.users).map(([r, v]) => ({ rid: r, ...v })), pending: Object.entries(pm.pending).map(([r, v]) => ({ rid: r, ...v })), removed: Object.entries(pm.removed || {}).map(([r, v]) => ({ rid: r, ...v })) })
  }
  // 實際備料填寫（張良 2026-10-01：備料表每天旁邊可填實備數字，逐日留痕做分析）：POST ?prepact=<OPS_BOARD_KEY> {item, qty, token}
  if (req.method === 'POST' && req.query?.prepact) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.prepact) !== ok2) return res.status(403).json({ ok: false })
    let ba = {}
    try { ba = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoA = (await (async () => { const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }; const w = await sopWho(ba.token); if (pm.mode !== 'approve') return w || { name: '現場(未綁定)' }; const u = w && pm.users[w.rid || w.uid]; return (u && u.edit && (u.admin || !u.tabs || u.tabs['board'] !== 0)) ? w : null })())
    if (!whoA) return res.status(403).json({ ok: false, error: permDeny() })
    if (!ba.item) return res.status(400).json({ ok: false, error: '缺 item' })
    // v4.11.0（張良 2026-10-02）：每筆都留痕（誰/時間）＋追加＋耗損＋86停售；log 永遠只加不刪
    const dA = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const idA = 'sp_finance_pm_prep_act_' + dA.slice(0, 7)
    const docA = (await kvGet(idA)) || { days: {} }
    docA.days[dA] = docA.days[dA] || {}
    const cur = docA.days[dA][ba.item] || { q: null, log: [] }
    cur.log = cur.log || []
    const tsA = new Date().toISOString()
    const opA = String(ba.op || 'set')
    const qn = Number(ba.qty)
    const rsn = String(ba.reason || '').slice(0, 60)
    if (opA === 'add') {
      if (!(qn > 0)) return res.status(400).json({ ok: false, error: '追加數量要大於 0' })
      cur.q = (Number(cur.q) || 0) + qn
      cur.log.push({ t: '追加', q: qn, by: whoA.name, ts: tsA })
    } else if (opA === 'loss') {
      if (!(qn > 0)) return res.status(400).json({ ok: false, error: '耗損數量要大於 0' })
      cur.loss = [...(cur.loss || []), { q: qn, r: rsn, by: whoA.name, ts: tsA }]
      cur.log.push({ t: '耗損', q: qn, r: rsn, by: whoA.name, ts: tsA })
    } else if (opA === '86') {
      const on86 = ba.on ? 1 : 0
      if (on86) cur.s86 = { on: 1, r: rsn, by: whoA.name, ts: tsA }; else delete cur.s86
      cur.log.push({ t: on86 ? '86停售' : '回賣', r: rsn, by: whoA.name, ts: tsA })
    } else { // set＝直接填總數
      if (ba.qty === '' || ba.qty == null || !(qn >= 0)) { cur.q = null; cur.log.push({ t: '清除', by: whoA.name, ts: tsA }) }
      else { cur.q = qn; cur.log.push({ t: '填', q: qn, by: whoA.name, ts: tsA }) }
    }
    cur.by = whoA.name; cur.ts = tsA
    docA.days[dA][ba.item] = cur
    await kvPut(idA, docA, '備料' + opA + '(' + whoA.name + ')')
    const dayE = Object.entries(docA.days[dA])
    return res.status(200).json({ ok: true, date: dA, act: Object.fromEntries(dayE.filter(([, v]) => v.q != null).map(([k, v]) => [k, v.q])), s86: Object.fromEntries(dayE.filter(([, v]) => v.s86 && v.s86.on).map(([k]) => [k, 1])) })
  }
  // 📜 備料歷史查詢（v4.11.0）：?preplog=<OPS_BOARD_KEY>&ym=YYYY-MM → 整月逐日逐品項留痕
  if (req.query?.preplog) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.preplog) !== ok2) return res.status(403).json({ ok: false })
    const ymL = /^\d{4}-\d{2}$/.test(String(req.query.ym || '')) ? String(req.query.ym) : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
    const docL = (await kvGet('sp_finance_pm_prep_act_' + ymL)) || { days: {} }
    return res.status(200).json({ ok: true, ym: ymL, days: docL.days || {} })
  }
  // 預做節奏表隱藏設定（張良 2026-09-21：有些品項不用看預做）：POST ?prephide=<OPS_BOARD_KEY> {key, hide, token}
  if (req.method === 'POST' && req.query?.prephide) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.prephide) !== ok2) return res.status(403).json({ ok: false })
    let bh = {}
    try { bh = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoH = (await (async () => { const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }; const w = await sopWho(bh.token); if (pm.mode !== 'approve') return w || { name: '現場(未綁定)' }; const u = w && pm.users[w.rid || w.uid]; return (u && u.edit && (u.admin || !u.tabs || u.tabs['board'] !== 0)) ? w : null })())
    if (!whoH) return res.status(403).json({ ok: false, error: permDeny() })
    if (!bh.key) return res.status(400).json({ ok: false, error: '缺 key' })
    const hd = (await kvGet('sp_finance_pm_prep_hide')) || { keys: {} }
    hd.keys = hd.keys || {}
    if (bh.hide) hd.keys[bh.key] = 1; else delete hd.keys[bh.key]
    await kvPut('sp_finance_pm_prep_hide', hd, '預做隱藏(' + whoH.name + ')')
    return res.status(200).json({ ok: true, prepHide: hd.keys })
  }
  // ⭐ 個人常用捷徑清單（v4.39.1 張良「手機版固定一行、每個人可編輯自己的常用清單」）：POST ?prepfav=<OPS_BOARD_KEY> {token, list}
  // 一人一份存 users[rid]＝跟人不跟裝置；只能改自己的、要綁定才存（未綁定前端自己存本機）
  if (req.method === 'POST' && req.query?.prepfav) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.prepfav) !== ok2) return res.status(403).json({ ok: false })
    let bf = {}
    try { bf = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const wF = await sopWho(bf.token)
    if (!wF) return res.status(403).json({ ok: false, error: '要先綁定身分才能存常用清單' })
    const listF = Array.isArray(bf.list) ? bf.list.filter(x => typeof x === 'string' && x.length < 20).slice(0, 6) : []
    if (!listF.length) return res.status(400).json({ ok: false, error: '清單是空的' })
    const fd = (await kvGet('sp_finance_pm_prep_fav')) || { users: {} }
    fd.users = fd.users || {}
    fd.users[wF.rid || wF.uid] = listF
    await kvPut('sp_finance_pm_prep_fav', fd, '常用清單(' + wF.name + ')')
    return res.status(200).json({ ok: true, fav: listF })
  }
  if (req.method === 'POST' && req.query?.sopdone) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopdone) !== ok2) return res.status(403).json({ ok: false })
    let b4 = {}
    try { b4 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    if (!b4.itemId) return res.status(400).json({ ok: false, error: '缺 itemId' })
    const dt2 = sopToday(); const dk2 = 'sp_finance_pm_sop_g_' + dt2
    const slog = (await kvGet(dk2)) || { items: {}, notified: {} }
    slog.items = slog.items || {}
    if (b4.undo) delete slog.items[b4.itemId]
    else {
      let photoUrl = null
      if (typeof b4.photo === 'string' && b4.photo.startsWith('data:image')) {
        try {
          const buf = Buffer.from(b4.photo.split(',')[1], 'base64')
          const path4 = `sop/${dt2}/${b4.itemId}_${Date.now()}.jpg`
          const ur = await fetch(`${SB_URL}/storage/v1/object/photos/${path4}`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: buf })
          if (ur.ok) photoUrl = `${SB_URL}/storage/v1/object/public/photos/${path4}`
        } catch (_) {}
      }
      const hm4 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16)
      const who4 = await sopWho(b4.token) // v4.34.0 打卡=參與，綁定即可（編輯內容才看 sop 權限）
      if (!who4) return res.status(403).json({ ok: false, error: permDeny() }) // 張良 2026-09-25：不再收手填名字
      slog.items[b4.itemId] = { done: 1, ts: hm4, by: who4.name, ...(photoUrl ? { photo: photoUrl } : {}) }
    }
    await kvPut(dk2, slog, 'SOP打卡')
    return res.status(200).json({ ok: true, log: slog })
  }
  if (req.method === 'POST' && req.query?.sopset) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.sopset) !== mk) return res.status(403).json({ ok: false })
    let b5 = {}
    try { b5 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const cur5 = (await kvGet('sp_finance_pm_sop_def')) || {}
    const g5 = cur5.ground || {}
    if (Array.isArray(b5.items)) g5.items = b5.items
    if (b5.owners && typeof b5.owners === 'object') g5.owners = { ...(g5.owners || {}), ...b5.owners } // 站長制：{站名:[名字,…]}，給空陣列=清掉該站站長
    cur5.ground = g5
    await kvPut('sp_finance_pm_sop_def', cur5, 'SOP定義口')
    return res.status(200).json({ ok: true, n: (g5.items || []).length, owners: g5.owners || {} })
  }
  // 站長編輯口（看板金鑰＋個人token；只能改自己當站長的那一站）：POST ?sopedit=<OPS_BOARD_KEY> body={token, st, items:[…該站全部項目…]}
  if (req.method === 'POST' && req.query?.sopedit) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopedit) !== ok2) return res.status(403).json({ ok: false })
    let b6 = {}
    try { b6 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const who6 = await permWho(b6.token, 'sop') // v4.34.0 SOP拆頁後守門跟上：board→sop
    if (!who6) return res.status(403).json({ ok: false, error: permDeny() })
    if (!b6.st || !Array.isArray(b6.items)) return res.status(400).json({ ok: false, error: '缺 st 或 items' })
    const cur6 = (await kvGet('sp_finance_pm_sop_def')) || {}
    const g6 = cur6.ground || { items: [] }
    { // v4.17.0 有效負責人=站負責人||分類負責人：有主的只有負責人/審核人/主管能編
      const own6 = (g6.stOwner || {})[b6.st] || (g6.catOwner || {})[(g6.stCat || {})[b6.st]]
      const apr6 = g6.approvers || ['張良瑋']
      if (own6 && own6 !== who6.name && !apr6.includes(who6.name) && who6.role !== '主管') return res.status(403).json({ ok: false, error: '「' + b6.st + '」由 ' + own6 + ' 負責——想改請按站名旁「💡 提建議」，通過會記你一分' })
    }
    const prev6 = (g6.items || []).filter(it => it.st === b6.st) // 改前快照＝歷史紀錄可回溯
    const prevIt6 = {}; ((cur6.ground || {}).items || []).forEach(it => { prevIt6[it.id] = it })
    const now86 = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    // 逐條編輯歸屬（張良 2026-09-21：每一條 SOP 顯示最後編輯者＋時間，之後統計每人編輯量）：有改才蓋名字，沒改保留原編輯者
    const clean6 = b6.items.filter(it => it && it.title).slice(0, 30).map((it, i) => { const o6 = { id: it.id || ('u' + Date.now().toString(36) + i), st: b6.st, title: String(it.title).slice(0, 60), due: /^\d{2}:\d{2}$/.test(it.due || '') ? it.due : '11:00', photo: !!it.photo }; const pv = prevIt6[o6.id]; const rf = String(it.ref || (pv && pv.ref) || '').slice(0, 500); if (rf) o6.ref = rf
      const tg6 = String(it.tg || (pv && pv.tg) || '').trim().slice(0, 20); if (tg6) o6.tg = tg6
      const chg = !pv || pv.title !== o6.title || pv.due !== o6.due || !!pv.photo !== o6.photo || (pv.ref || '') !== (o6.ref || '') || pv.st !== o6.st || ((pv.tg || '') !== (o6.tg || ''))
      o6.editBy = chg ? who6.name : (pv.editBy || pv && pv.editBy || undefined); o6.editTs = chg ? now86 : (pv ? pv.editTs : undefined)
      if (!o6.editBy) { o6.editBy = who6.name; o6.editTs = o6.editTs || now86 }
      return o6 })
    g6.items = [...(g6.items || []).filter(it => it.st !== b6.st), ...clean6]
    g6.edits = [{ ts: new Date().toISOString(), by: who6.name, st: b6.st, n: clean6.length, prev: prev6 }, ...(g6.edits || [])].slice(0, 30) // 留痕：時間/姓名/改前內容
    cur6.ground = g6
    await kvPut('sp_finance_pm_sop_def', cur6, 'SOP編輯(' + who6.name + ')')
    return res.status(200).json({ ok: true, items: g6.items })
  }
  // 問題回報（張良 2026-09-21：站別旁⚠️回報，文字+照片影片；DD發內部群、可標已解決）
  // 影片太大不能過 Vercel（4.5MB 限制）→ 用簽名直傳：先要 ?sopsign 拿上傳位址、前端直傳 Supabase，再送 ?sopreport 帶路徑
  if (req.method === 'POST' && req.query?.sopsign) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopsign) !== ok2) return res.status(403).json({ ok: false })
    let b7 = {}
    try { b7 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const ext7 = String(b7.ext || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'
    const path7 = `sop/issues/${sopToday()}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext7}`
    const sr = await fetch(`${SB_URL}/storage/v1/object/upload/sign/photos/${path7}`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    if (!sr.ok) return res.status(500).json({ ok: false, error: '簽名失敗 ' + sr.status })
    const sj = await sr.json()
    return res.status(200).json({ ok: true, uploadUrl: `${SB_URL}/storage/v1${sj.url}`, publicUrl: `${SB_URL}/storage/v1/object/public/photos/${path7}` })
  }
  if (req.method === 'POST' && req.query?.sopreport) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopreport) !== ok2) return res.status(403).json({ ok: false })
    let b8 = {}
    try { b8 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    if (!b8.st || !(b8.text || (b8.media || []).length)) return res.status(400).json({ ok: false, error: '至少要有文字或照片/影片' })
    const who8 = await sopWho(b8.token)
    if (!who8) return res.status(403).json({ ok: false, error: permDeny() }) // 張良 2026-09-25：訪客唯讀
    const doc8 = (await kvGet('sp_finance_pm_sop_issues')) || { list: [] }
    const iss = { id: 'is' + Date.now().toString(36), st: String(b8.st).slice(0, 20), text: String(b8.text || '').slice(0, 500), media: (Array.isArray(b8.media) ? b8.media : []).slice(0, 6), by: who8.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), status: 'open', pub: 'pending' }
    doc8.list = [iss, ...(doc8.list || [])].slice(0, 200)
    await kvPut('sp_finance_pm_sop_issues', doc8, '看板問題回報(' + iss.by + ')')
    // v4.53.0 問題回報一提交就進通知中心（張良「通知中心也沒出現問題回報」）：只記通知歷史不發 web push（避免吵），issue 分類、全員可見
    try {
      const nd8 = (await kvGet('sp_finance_pm_prep_ntf')) || { list: [] }
      nd8.list = [{ id: 'n' + Date.now().toString(36), ts: new Date().toISOString(), cat: 'issue', title: `⚠️ 問題回報【${iss.st}】`, body: `${(iss.text || '（見附件）').slice(0, 80)} — ${iss.by}`, url: '/prep', to: null }, ...(nd8.list || [])].slice(0, 300)
      await kvPut('sp_finance_pm_prep_ntf', nd8, '問題回報通知')
    } catch (_) {}
    // 審核發布制（張良 2026-09-22：不直接進群——DD 先私訊老闆帶【發布/保留/刪除】按鈕，確認完才到群裡；/prep 任務分頁也能按）
    try {
      const tk8 = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
      const [defD8, rosterD8] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
      const apr8 = (((defD8 || {}).ground || {}).approvers || ['張良瑋'])
      for (const an of apr8) {
        const ap = ((rosterD8 || {}).people || []).find(p => p.name === an && p.lineUserId)
        if (tk8 && ap) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk8 }, body: JSON.stringify({ to: ap.lineUserId, messages: [{ type: 'template', altText: `⚠️ 問題回報待確認【${iss.st}】${(iss.text || '').slice(0, 30)}`, template: { type: 'buttons', title: `⚠️ 問題回報【${iss.st}】`.slice(0, 40), text: `${(iss.text || '（見附件）').slice(0, 100)}\n— ${iss.by}${iss.media.length ? `・附${iss.media.length}檔(看板可看)` : ''}`.slice(0, 160), actions: [
          { type: 'postback', label: '✅ 發布到群', data: `pi|${iss.id}|go` },
          { type: 'postback', label: '📥 保留（不進群）', data: `pi|${iss.id}|hold` },
          { type: 'postback', label: '🗑 刪除', data: `pi|${iss.id}|del` },
        ] } }] }) })
      }
    } catch (_) {}
    return res.status(200).json({ ok: true, issue: iss })
  }
  if (req.method === 'POST' && req.query?.sopresolve) {
    // 兩段式（張良 2026-09-21：已解決要經審核不能隨便按掉）：夥伴按=pending 送審＋DD私訊審核人；審核人自己按=直接 done
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopresolve) !== ok2) return res.status(403).json({ ok: false })
    let b9 = {}
    try { b9 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const who9 = await sopWho(b9.token)
    if (!who9) return res.status(403).json({ ok: false, error: permDeny() })
    const [doc9, defD9, rosterD9] = await Promise.all([kvGet('sp_finance_pm_sop_issues'), kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
    const d9 = doc9 || { list: [] }
    const it9 = (d9.list || []).find(x => x.id === b9.id)
    if (!it9) return res.status(404).json({ ok: false })
    const approvers9 = ((defD9 || {}).ground || {}).approvers || ['張良瑋']
    it9.doneBy = who9.name; it9.doneTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
    if (it9.claimAt) it9.durMin = Math.max(1, Math.round((Date.now() - it9.claimAt) / 60000)) // 認領→解決耗時（分）
    it9.status = approvers9.includes(who9.name) ? 'done' : 'pending'
    await kvPut('sp_finance_pm_sop_issues', d9, '看板問題解決' + (it9.status === 'pending' ? '送審' : '') + '(' + who9.name + ')')
    if (it9.status === 'pending') { // DD 私訊審核人（找名冊 lineUserId）
      try {
        const tk9 = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        const { prepLink, wpPushUids } = await import('./_webpush.js') // v4.33.0
        for (const an of approvers9) {
          const ap = ((rosterD9 || {}).people || []).find(p => p.name === an && p.lineUserId)
          if (tk9 && ap) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk9 }, body: JSON.stringify({ to: ap.lineUserId, messages: [{ type: 'text', text: `🕐 待你審核：【${it9.st}】${it9.text || '（附件）'}\n${who9.name} 說已解決。\n到看板該站卡片按「核准／退回」👇\n${prepLink('')}` }] }) })
          if (ap) { try { await wpPushUids([ap.lineUserId], { title: '🕐 待你審核', body: `【${it9.st}】${who9.name} 說已解決，按核准／退回`, url: '/prep' }) } catch (_) {} }
        }
      } catch (_) {}
    }
    return res.status(200).json({ ok: true, status: it9.status })
  }
  // 問題卡片操作口（張良 2026-09-21 卡片式看板）：POST ?sopissue= {id, op, val, token}
  // op=claim(我來解決:記名+開始計時)/unclaim(本人或審核人可放棄)/flag(標記)/due(排定處理時間,自由文字)/ckadd·cktog·ckdel(階段性checklist 文字+圖片)
  if (req.method === 'POST' && req.query?.sopissue) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopissue) !== ok2) return res.status(403).json({ ok: false })
    let bi = {}
    try { bi = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoI = await permWho(bi.token, 'task')
    if (!whoI) return res.status(403).json({ ok: false, error: permDeny() })
    const [docI, defI] = await Promise.all([kvGet('sp_finance_pm_sop_issues'), kvGet('sp_finance_pm_sop_def')])
    const dI = docI || { list: [] }
    const itI = (dI.list || []).find(x => x.id === bi.id)
    if (bi.op !== 'new' && !itI) return res.status(404).json({ ok: false }) // 新增本來就沒 id——別擋（張良 2026-09-24「無法建立」抓包：404 guard 放在 new 分支前害新增永遠失敗）
    const apprI = (((defI || {}).ground || {}).approvers || ['張良瑋'])
    if (bi.op === 'new') { // 直接新增任務（張良 2026-09-22：比照任務中心——標題/類別/負責人/時間；checklist 建卡後用 ckadd）
      const v = bi.val || {}
      if (!String(v.text || '').trim()) return res.status(400).json({ ok: false, error: '任務要寫標題' })
      const now8I = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
      const it2 = { id: 'is' + Date.now().toString(36), st: String(v.st || '一般').trim().slice(0, 20) || '一般', text: String(v.text).slice(0, 300), media: [], by: whoI.name, ts: now8I, status: 'open' }
      if (String(v.owner || '').trim()) { it2.claimBy = String(v.owner).trim().slice(0, 20); it2.claimAt = Date.now(); it2.claimTs = now8I }
      if (String(v.due || '').trim()) it2.due = String(v.due).slice(0, 30)
      dI.list = [it2, ...(dI.list || [])].slice(0, 200)
      await kvPut('sp_finance_pm_sop_issues', dI, '任務新增(' + whoI.name + ')')
      return res.status(200).json({ ok: true, issue: it2 })
    }
    if (bi.op === 'claim') {
      if (itI.claimBy && itI.claimBy !== whoI.name) return res.status(400).json({ ok: false, error: `已由 ${itI.claimBy} 認領處理中` })
      itI.claimBy = whoI.name; itI.claimAt = Date.now(); itI.claimTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    } else if (bi.op === 'unclaim') {
      if (itI.claimBy !== whoI.name && !apprI.includes(whoI.name)) return res.status(403).json({ ok: false, error: '只有認領人或審核人能放棄' })
      delete itI.claimBy; delete itI.claimAt; delete itI.claimTs
    } else if (bi.op === 'flag') {
      if (bi.val) itI.flag = 1; else delete itI.flag
    } else if (bi.op === 'due') {
      itI.due = String(bi.val || '').slice(0, 30); if (!itI.due) delete itI.due
    } else if (bi.op === 'pub') { // 審核發布（張良限定：go=發布到群 / hold=保留 / del=刪除）
      if (!apprI.includes(whoI.name)) return res.status(403).json({ ok: false, error: '只有審核人能確認發布' })
      if (bi.val === 'go') {
        itI.pub = 'ok'
        try {
          const tkP = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
          if (tkP) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkP }, body: JSON.stringify({ to: 'Cf7940efc6517b0c084ad2ad496b45f30', messages: [{ type: 'text', text: `📢 問題發布【${itI.st}】${itI.text || '（見附件）'}\n發現：${itI.by}${(itI.media || []).length ? `・附件${itI.media.length}` : ''}\n能處理的人 → /prep 按「🙋 我來解決」` }] }) })
        } catch (_) {}
      } else if (bi.val === 'hold') { itI.pub = 'hold' }
      else if (bi.val === 'del') { dI.list = (dI.list || []).filter(x => x.id !== bi.id) }
      else return res.status(400).json({ ok: false })
    } else if (bi.op === 'own') { // 指派/清除負責人（清除＝val 空字串）
      const nm = String(bi.val || '').trim().slice(0, 20)
      if (nm) { itI.claimBy = nm; itI.claimAt = itI.claimAt || Date.now(); itI.claimTs = itI.claimTs || new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') }
      if (nm) { // 指派→DD 私訊被指派者本人（張良 2026-10-02：回報群播沒鳥用，改通知該負責的人）
        try {
          const tkO = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
          const rosterO = (await kvGet('sp_crew_kb_roster')) || {}
          const po = (rosterO.people || []).find(p2 => p2.name === nm && p2.lineUserId)
          if (tkO && po) { await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkO }, body: JSON.stringify({ to: po.lineUserId, messages: [{ type: 'text', text: `📌 ${whoI.name} 指派給你：【${itI.st || '任務'}】${itI.text || ''}\n完成後到 /prep 按「已解決」` }] }) }); const { logPush } = await import('./push.js'); await logPush(po.lineUserId, 1, '任務指派通知') }
        } catch (_) {}
      }
      else { delete itI.claimBy; delete itI.claimAt; delete itI.claimTs }
    } else if (bi.op === 'ckadd') { // 階段性 checklist：文字＋圖片（張良 2026-09-22）
      const v = bi.val || {}
      if (!String(v.t || '').trim() && !v.img) return res.status(400).json({ ok: false, error: '寫一下這一步要做什麼' })
      itI.ck = itI.ck || []
      if (itI.ck.length >= 20) return res.status(400).json({ ok: false, error: '步驟最多 20 個' })
      itI.ck.push({ id: 'ck' + Date.now().toString(36), t: String(v.t || '').slice(0, 200), img: String(v.img || '').slice(0, 500), by: whoI.name })
    } else if (bi.op === 'cktog') {
      const c = (itI.ck || []).find(c2 => c2.id === bi.val)
      if (!c) return res.status(404).json({ ok: false })
      if (c.done) { delete c.done; delete c.doneBy; delete c.doneTs } else { c.done = 1; c.doneBy = whoI.name; c.doneTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') }
    } else if (bi.op === 'ckdel') {
      itI.ck = (itI.ck || []).filter(c2 => c2.id !== bi.val)
    } else return res.status(400).json({ ok: false, error: 'op?' })
    await kvPut('sp_finance_pm_sop_issues', dI, '問題卡' + bi.op + '(' + whoI.name + ')')
    return res.status(200).json({ ok: true, issue: itI })
  }
  // ── 採購需求（張良 2026-09-21：大家隨時提要買的東西，可附圖片＆連結）──
  // GET ?buy=<OPS>&me=；POST ?buyadd= {text,url,media,by,token}（圖走 sopsign 簽名直傳）；POST ?buyop= {id,op:done|undone|del,token}
  if (req.query?.buy) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.buy) !== ok2) return res.status(403).json({ ok: false })
    const [bd, meB] = await Promise.all([kvGet('sp_finance_pm_buy'), permWho(req.query.me, 'buy')])
    const defB = await kvGet('sp_finance_pm_sop_def')
    const apprB = (((defB || {}).ground || {}).approvers || ['張良瑋'])
    return res.status(200).json({ ok: true, list: ((bd || {}).list || []).slice(0, 100), me: meB ? { name: meB.name, approver: apprB.includes(meB.name) } : null })
  }
  if (req.method === 'POST' && req.query?.buyadd) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.buyadd) !== ok2) return res.status(403).json({ ok: false })
    let bb = {}
    try { bb = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    if (!(bb.text || '').trim() && !(bb.media || []).length) return res.status(400).json({ ok: false, error: '至少寫要買什麼' })
    const whoB = await permWho(bb.token, 'buy') // v4.34.0 權限表「採購 編」生效
    if (!whoB) return res.status(403).json({ ok: false, error: permDeny() })
    const doc = (await kvGet('sp_finance_pm_buy')) || { list: [] }
    const it = { id: 'by' + Date.now().toString(36), text: String(bb.text || '').slice(0, 300), cat: String(bb.cat || '').trim().slice(0, 20), url: String(bb.url || '').slice(0, 500), media: (Array.isArray(bb.media) ? bb.media : []).slice(0, 6), by: whoB.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), status: 'open' }
    doc.list = [it, ...(doc.list || [])].slice(0, 200)
    await kvPut('sp_finance_pm_buy', doc, '採購需求(' + it.by + ')')
    try { // DD 通知內部群（張良 2026-09-21：掛通知開關 pm_notify.buy，預設關）
      const ncfg = (await kvGet('sp_finance_pm_notify')) || {}
      const tkB = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
      if (ncfg.buy === 1 && tkB) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkB }, body: JSON.stringify({ to: 'Cf7940efc6517b0c084ad2ad496b45f30', messages: [{ type: 'text', text: `🛒 採購需求：${it.text || '（見附件）'}\n— ${it.by}${it.url ? '\n🔗 ' + it.url : ''}${it.media.length ? `・附${it.media.length}圖` : ''}\n處理完到 /prep 採購分頁按「已購買」` }] }) })
    } catch (_) {}
    return res.status(200).json({ ok: true, item: it })
  }
  if (req.method === 'POST' && req.query?.buyop) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.buyop) !== ok2) return res.status(403).json({ ok: false })
    let bo = {}
    try { bo = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoO = await permWho(bo.token, 'buy') // v4.34.0 權限表「採購 編」生效
    if (!whoO) return res.status(403).json({ ok: false, error: permDeny() })
    const doc = (await kvGet('sp_finance_pm_buy')) || { list: [] }
    const it = (doc.list || []).find(x => x.id === bo.id)
    if (!it) return res.status(404).json({ ok: false })
    if (bo.op === 'cat') { it.cat = String(bo.val || '').trim().slice(0, 20) } // 改分類（張良 2026-09-22）
    else if (bo.op === 'done') { it.status = 'bought'; it.doneBy = whoO.name; it.doneTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') } // 已購買→進待收貨區
    else if (bo.op === 'recv') { // 確認收貨（張良 2026-09-22：要拍照上傳＋記日期時間）
      const md = (Array.isArray(bo.media) ? bo.media : []).slice(0, 4)
      if (!md.length) return res.status(400).json({ ok: false, error: '收貨要拍照存證' })
      it.status = 'received'; it.recvBy = whoO.name; it.recvTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '); it.recvMedia = md
    }
    else if (bo.op === 'undone') { it.status = 'open'; delete it.doneBy; delete it.doneTs }
    else if (bo.op === 'del') {
      const defO = await kvGet('sp_finance_pm_sop_def')
      if (!((((defO || {}).ground || {}).approvers) || ['張良瑋']).includes(whoO.name) && it.by !== whoO.name) return res.status(403).json({ ok: false, error: '只有提出者或審核人可以刪' })
      doc.list = doc.list.filter(x => x.id !== bo.id)
    } else return res.status(400).json({ ok: false })
    await kvPut('sp_finance_pm_buy', doc, '採購' + bo.op + '(' + whoO.name + ')')
    return res.status(200).json({ ok: true })
  }
  // SOP 總編輯整份儲存（張良 2026-09-21：拖曳排序後一次存）：POST ?sopfull= {token, stations:[名], items:[{id,st,title,due,photo}]}
  // 站與項目順序＝陣列順序；改前整份存進 edits.prev 可回溯；回收站 trash 不動
  if (req.method === 'POST' && req.query?.sopfull) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopfull) !== ok2) return res.status(403).json({ ok: false })
    let bf = {}
    try { bf = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoF = await permWho(bf.token, 'sop') // v4.34.0 SOP拆頁後守門跟上：board→sop
    if (!whoF) return res.status(403).json({ ok: false, error: permDeny() })
    if (!Array.isArray(bf.stations) || !Array.isArray(bf.items)) return res.status(400).json({ ok: false, error: '缺 stations/items' })
    const stCl = [...new Set(bf.stations.map(s => String(s || '').trim().slice(0, 20)).filter(Boolean))].slice(0, 20)
    const curF = (await kvGet('sp_finance_pm_sop_def')) || {}
    const prevItF = {}; ((curF.ground || {}).items || []).forEach(it => { prevItF[it.id] = it })
    const now8F = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
    const itCl = bf.items.slice(0, 200).map((it, i) => { const oF = { id: it.id || ('u' + Date.now().toString(36) + i), st: String(it.st || '').trim().slice(0, 20), title: String(it.title || '').trim().slice(0, 60), due: /^\d{2}:\d{2}$/.test(it.due || '') ? it.due : '11:00', photo: !!it.photo }; const pv = prevItF[oF.id]; const rf = String(it.ref || (pv && pv.ref) || '').slice(0, 500); if (rf) oF.ref = rf
      const tgF = String(it.tg || '').trim().slice(0, 20); if (tgF) oF.tg = tgF // v4.18.0 #階段標籤
      const chg = !pv || pv.title !== oF.title || pv.due !== oF.due || !!pv.photo !== oF.photo || (pv.ref || '') !== (oF.ref || '') || pv.st !== oF.st || ((pv.tg || '') !== (oF.tg || ''))
      oF.editBy = chg ? whoF.name : (pv ? pv.editBy : undefined); oF.editTs = chg ? now8F : (pv ? pv.editTs : undefined)
      if (!oF.editBy) { oF.editBy = whoF.name; oF.editTs = oF.editTs || now8F }
      return oF }).filter(it => it.title && stCl.includes(it.st))
    const gF = curF.ground || {}
    { // v4.15.0 站負責人：非負責人在總編輯動到有主的站→整包擋下
      const aprF = gF.approvers || ['張良瑋']
      const mgrF = aprF.includes(whoF.name) || whoF.role === '主管'
      if (!mgrF) {
        const keyF = it => JSON.stringify([it.title, it.due || '', !!it.photo, it.ref || '', it.tg || '', it.st || ''])
        const effOwn = {}
        ;(gF.stations || []).forEach(stX => { const o2 = (gF.stOwner || {})[stX] || (gF.catOwner || {})[(gF.stCat || {})[stX]]; if (o2) effOwn[stX] = o2 })
        for (const [tgO, owT] of Object.entries(gF.catOwner || {})) { // v4.18.0 #階段負責人守門
          if (owT === whoF.name) continue
          const aT2 = ((curF.ground || {}).items || []).filter(i => (i.tg || '') === tgO).map(keyF).sort().join('|')
          const bT2 = itCl.filter(i => (i.tg || '') === tgO).map(keyF).sort().join('|')
          if (aT2 !== bT2) return res.status(403).json({ ok: false, error: '「#' + tgO + '」由 ' + owT + ' 負責——這個階段的修改請用「💡 提建議」' })
        }
        for (const [stO, ow] of Object.entries(effOwn)) {
          if (ow === whoF.name) continue
          const aT = (gF.items || []).filter(i => i.st === stO).map(keyF).sort().join('|')
          const bT = itCl.filter(i => i.st === stO).map(keyF).sort().join('|')
          if (aT !== bT) return res.status(403).json({ ok: false, error: '「' + stO + '」由 ' + ow + ' 負責——這站的修改請用「💡 提建議」' })
        }
      }
    }
    gF.edits = [{ ts: new Date().toISOString(), by: whoF.name, op: 'full', prev: { stations: gF.stations || [], items: gF.items || [] } }, ...(gF.edits || [])].slice(0, 15)
    gF.stations = stCl
    gF.items = itCl
    curF.ground = gF
    await kvPut('sp_finance_pm_sop_def', curF, 'SOP總編輯(' + whoF.name + ')')
    return res.status(200).json({ ok: true, n: itCl.length })
  }
  // 審核口（只有審核人）：POST ?sopreview= {id, pass:true/false, token} → 核准=done；退回=回 open 清除解決人
  if (req.method === 'POST' && req.query?.sopreview) {
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!ok2 || String(req.query.sopreview) !== ok2) return res.status(403).json({ ok: false })
    let bv = {}
    try { bv = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const whoV = await sopWho(bv.token)
    if (!whoV) return res.status(403).json({ ok: false, error: permDeny() })
    const [docV, defV] = await Promise.all([kvGet('sp_finance_pm_sop_issues'), kvGet('sp_finance_pm_sop_def')])
    if (!(((defV || {}).ground || {}).approvers || ['張良瑋']).includes(whoV.name)) return res.status(403).json({ ok: false, error: '只有審核人可以核准/退回' })
    const dV = docV || { list: [] }
    const itV = (dV.list || []).find(x => x.id === bv.id)
    if (!itV || itV.status !== 'pending') return res.status(404).json({ ok: false, error: '不是待審核狀態' })
    if (bv.pass) { itV.status = 'done'; itV.reviewedBy = whoV.name; itV.reviewedTs = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') }
    else { itV.status = 'open'; itV.rejectedBy = whoV.name; delete itV.doneBy; delete itV.doneTs }
    await kvPut('sp_finance_pm_sop_issues', dV, '看板問題審核' + (bv.pass ? '核准' : '退回') + '(' + whoV.name + ')')
    return res.status(200).json({ ok: true })
  }
  // 名冊更新口（同管理金鑰，張良 2026-09-20：用 Google Sheet 夥伴名單更新 kb_roster）：
  // POST ?rosterset=<key>[&dry=1] body={addFields:[{key,label,type}], updates:[{name,set:{…}}], adds:[{name,…}]}
  // 以姓名比對；updates 只動 set 給的欄位、adds 同名跳過不重複建；動完廣播讓開著的 App 即時跟上
  if (req.method === 'POST' && req.query?.rosterset) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    if (!mk || String(req.query.rosterset) !== mk) return res.status(403).json({ ok: false })
    let b3 = {}
    try { b3 = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const doc = (await kvGet('sp_crew_kb_roster')) || { people: [], fields: [] }
    doc.people = doc.people || []; doc.fields = doc.fields || []
    const dry = !!String(req.query.dry || '')
    const out3 = { fieldAdded: [], updated: [], added: [], skipped: [], notFound: [] }
    for (const f of (b3.addFields || [])) {
      if (!doc.fields.some(x => x.key === f.key)) { if (!dry) doc.fields.push({ key: f.key, label: f.label || f.key, type: f.type || 'text', show: f.show !== false }); out3.fieldAdded.push(f.label || f.key) }
    }
    for (const u of (b3.updates || [])) {
      const p = doc.people.find(x => x.name === u.name)
      if (!p) { out3.notFound.push(u.name); continue }
      const chg = Object.keys(u.set || {}).filter(k => String(p[k] ?? '') !== String(u.set[k] ?? ''))
      if (chg.length) { if (!dry) Object.assign(p, u.set); out3.updated.push(u.name + '(' + chg.join(',') + ')') }
    }
    for (const a of (b3.adds || [])) {
      if (!a.name || doc.people.some(x => x.name === a.name)) { out3.skipped.push(a.name); continue }
      if (!dry) doc.people.push({ id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), role: 'staff', status: '在職', ...a })
      out3.added.push(a.name)
    }
    if (!dry) { await kvPut('sp_crew_kb_roster', doc, '名冊更新口'); await announceChanged() }
    return res.status(200).json({ ok: true, dry, ...out3, total: doc.people.length })
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
        // 區間過濾（張良 2026-09-19 飲品成長率分析：要能只撈近30天 vs 前30天）：?from=YYYY-MM-DD&to=YYYY-MM-DD 選填
        if (req.query.from && date < String(req.query.from)) continue
        if (req.query.to && date > String(req.query.to)) continue
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
  // 參考店 1/2 已退役（張良 2026-09-24）——iCHEF 停抓、數據已刪
  try { out.ab = await syncEatsLive(kvGet, kvPut) } catch (e) { out.ab = { error: e?.message || String(e) } } // AB 即時（白天看今天；日結信到就被正式資料接手）
  await announceChanged() // 有新資料入庫→通知所有開著的網頁自動重抓（沒新資料就不發）
  if (req.query?.debug) out.dbg = DBG
  return res.status(200).json(out)
 } catch (e) { // v4.52.4 總兜底：把 HTML 500 轉成可讀 JSON 錯誤（回 200+ok:false＝前端一律看得到真正原因，不再只是「儲存失敗」）
   const ep = Object.keys(req.query || {})[0] || req.method
   console.error('mail-sync handler 未捕捉錯誤:', ep, e)
   if (!res.headersSent) return res.status(200).json({ ok: false, error: '伺服器錯誤（' + ep + '）：' + (e?.message || String(e)) })
 }
}
