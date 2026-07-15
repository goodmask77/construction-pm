// 後端：自動收信入庫（cron-daily 每天呼叫；也可手動 /api/mail-sync?days=N）
// ① 中信 e-Cash「帳務處理結果」通知（goodmask77@gmail.com）→ sp_finance_pm_ctbc（只增不改，dedupe by 交易序號）
// ② Eats365 POS 日結報表 xlsx 附件（money@gumgum.club）→ sp_finance_pm_pos（設好 MAIL_USER2/MAIL_PASS2 後自動啟用）
// 憑證：Gmail 應用程式密碼，存 Vercel Sensitive env。⚠️ env 值可能帶「VAR=」前綴，clean() 必須 strip。
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import * as XLSX from 'xlsx'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const M1U = clean(process.env.MAIL_USER), M1P = clean(process.env.MAIL_PASS)   // goodmask77（中信通知）
const M2U = clean(process.env.MAIL_USER2), M2P = clean(process.env.MAIL_PASS2) // money@gumgum.club（Eats365）

async function kvGet(id) {
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
  const rows = r.ok ? await r.json() : []
  try { return rows[0]?.data?.v ? JSON.parse(rows[0].data.v) : null } catch (_) { return null }
}
async function kvPut(id, obj, editor) {
  await fetch(`${SB_URL}/rest/v1/pm_documents`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor, updated_at: new Date().toISOString() }),
  })
}

// 開連線＋找出「所有郵件」「垃圾桶」兩個資料夾（信被使用者整理/刪掉也照抓）
async function withMailboxes(user, pass, fn) {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false })
  await client.connect()
  try {
    const paths = []
    for (const mb of await client.list()) {
      if (mb.specialUse === '\\All' || mb.specialUse === '\\Trash') paths.push(mb.path)
    }
    if (!paths.length) paths.push('INBOX')
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
    const uids = await client.search({ from: 'bank.csc@inib.ctbcbank.com', since: new Date(Date.now() - days * 864e5) }, { uid: true })
    if (!uids || !uids.length) return
    for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true })) {
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
// 報表是「標籤/數值」直欄式（概覽/總銷售額/銷售來源/付款方式/審計…）→ 掃全表建 label→value 字典＋抽關鍵欄位
// 實測樣本：DailyClosing (.xls 舊格式)；label 內含全形/半形空白（信 用 卡）→ key 一律去空白
function parsePosWorkbook(buf, subject) {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
  const kv = {}, kvArr = {}
  let name = '', period = ''
  for (const row of grid) {
    const cells = row.map(c => String(c ?? '').trim())
    const joined = cells.join('')
    if (joined.startsWith('名稱:')) name = joined.slice(3).replace(/服務由.*$/, '').trim()
    if (joined.startsWith('報表日期:')) period = joined.slice(5).trim()
    const label = cells.find(c => c && isNaN(parseFloat(c.replace(/[NT$,()\s]/g, ''))))
    const nums = row.filter(c => typeof c === 'number' || (String(c).trim() && !isNaN(parseFloat(String(c).replace(/[NT$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'))))).map(c => typeof c === 'number' ? c : parseFloat(String(c).replace(/[NT$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')))
    if (!label || !nums.length) continue
    const key = label.replace(/\s+/g, '')
    if (!(key in kv)) { kv[key] = nums[nums.length - 1]; kvArr[key] = nums }
  }
  const pm = period.match(/(\d{4}-\d{2}-\d{2})/)
  const cnt = (k) => (kvArr[k] && kvArr[k].length > 1) ? kvArr[k][0] : null
  return {
    id: 'pos-' + (period.replace(/[^\d]/g, '').slice(0, 20) || Math.random().toString(36).slice(2, 9)),
    date: pm ? pm[1] : '', period, store: name, subject: subject || '',
    revenue: kv['總收入'] ?? kv['總銷售額'] ?? 0,
    grossSales: kv['總銷售額'] ?? 0, txCount: kv['交易數量'] ?? 0, guests: kv['人數(堂食)'] ?? 0,
    sales: kv['銷售'] ?? 0, serviceFee: kv['服務費'] ?? 0, discount: kv['折扣'] ?? 0, refund: kv['退單'] ?? 0,
    cash: kv['現金'] ?? 0, cashCount: cnt('現金'), card: kv['信用卡'] ?? 0, cardCount: cnt('信用卡'),
    uber: kv['點餐平台(UBEREATS)-API'] ?? 0, uberCount: cnt('點餐平台(UBEREATS)-API'),
    posSales: kv['POS'] ?? 0, apiSales: kv['API'] ?? 0,
    voidItems: kv['VoidItems'] ?? 0, returnDish: kv['退菜'] ?? 0, unsettled: kv['未結賬(轉移)'] ?? 0,
    kv, source: 'mail',
  }
}
async function syncPos(days) {
  // 來源：money@gumgum.club（設 MAIL_USER2/MAIL_PASS2 後）＋ goodmask77（吃「轉寄/自動轉寄」的報表信）
  const accounts = []
  if (M2U && M2P) accounts.push([M2U, M2P])
  if (M1U && M1P) accounts.push([M1U, M1P])
  if (!accounts.length) return { skipped: '未設信箱憑證' }
  const store = (await kvGet('sp_finance_pm_pos')) || { name: 'Eats365 POS 日結', entries: [] }
  const have = new Set(store.entries.map(e => e.id))
  const found = {}
  let scanned = 0
  for (const [au, ap] of accounts) await withMailboxes(au, ap, async (client) => {
    const uids = await client.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true })
    if (!uids || !uids.length) return
    for await (const msg of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true })) {
      const from = msg.envelope?.from?.[0]?.address || ''
      const subject = msg.envelope?.subject || ''
      if (!/eats365/i.test(from) && !/營業報告|Eats365/i.test(subject)) continue
      scanned++
      // 需要附件 → 抓整封再讓 mailparser 拆
      const { content } = await client.download(msg.uid, undefined, { uid: true })
      const chunks = []; for await (const c of content) chunks.push(c)
      const parsed = await simpleParser(Buffer.concat(chunks))
      const att = (parsed.attachments || []).find(a => /\.xlsx?$/i.test(a.filename || ''))
      if (!att) continue
      try {
        const rec = parsePosWorkbook(att.content, subject)
        if (!have.has(rec.id) && !found[rec.id]) found[rec.id] = rec
      } catch (_) {}
    }
  })
  const add = Object.values(found)
  if (add.length) {
    store.entries = [...store.entries, ...add].sort((a, b) => (a.date < b.date ? -1 : 1))
    store.updatedAt = new Date().toISOString()
    await kvPut('sp_finance_pm_pos', store, 'POS日結自動收信')
  }
  return { scanned, added: add.length, total: store.entries.length }
}

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(200).json({ ok: false, error: '缺 Supabase 設定' })
  const days = Math.min(120, Math.max(1, parseInt(req.query?.days || '10', 10) || 10))
  const out = { ok: true, days }
  try { out.ctbc = await syncCtbc(days) } catch (e) { out.ctbc = { error: e?.message || String(e) } }
  try { out.pos = await syncPos(days) } catch (e) { out.pos = { error: e?.message || String(e) } }
  return res.status(200).json(out)
}
