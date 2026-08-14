// 後端：LINE Webhook（D哥）。收群組訊息 → 登記群、回答問題（以 pm_bot_context 唯一真相快照為依據）。
// 需要環境變數：LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN（新）；ANTHROPIC_API_KEY、SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY（本專案已有）。
// LINE 後台 Webhook URL 設成： https://<本專案網域>/api/line-webhook
import crypto from 'crypto'
// Task Object v2：與前端共用同一份資料模型（保證 Bot / Front-end 的 Task shape 一致）
import { normalizePatch, mergeTask, isWaiting, isBlocked } from '../src/tasks/taskModel.js'
// 供應鏈 AI 摘要：與 App 全域 AI 顧問共用同一份（100%資料鐵則——新資料域加 digest.js 一處，兩邊自動同步）
import { supplyDigest } from '../src/supply/digest.js'
// 入職 2.0：LINE 申請/報到綁定（固定表單流程、證件直存私有桶，「不經 AI」）
import { handleOnboardEvent } from './_onboard.js'
// DD 互動卡片：照片歸檔/回饋卡/投票卡（Flex+postback，固定指令不經 AI，答案直接寫回 App 同一份資料）
import { handleDDCards } from './_ddcards.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SECRET = clean(process.env.LINE_CHANNEL_SECRET)
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const ANTHROPIC = clean(process.env.ANTHROPIC_API_KEY)
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const OP_CODE = clean(process.env.BOT_OP_CODE) // 操作者授權碼（私訊「授權:碼」才會被列為可執行操作者；未設＝全程唯讀，最安全）

// 必須拿「原始 bytes」驗章，所以關掉預設 body 解析、自己 buffer。
export const config = { api: { bodyParser: false } }
const readRaw = (req) => new Promise((resolve) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', () => resolve(Buffer.from('')))
})

// ── Supabase KV（pm_documents）讀寫 ──
const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' }
async function kvGetMany(ids) {
  if (!SB_URL || !SB_KEY) return {}
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,data`, { headers: sbHeaders })
    const rows = r.ok ? await r.json() : []
    const out = {}
    rows.forEach((row) => { if (row?.data?.v) { try { out[row.id] = JSON.parse(row.data.v) } catch (_) {} } })
    return out
  } catch (_) { return {} }
}
async function kvSet(id, valueObj) {
  if (!SB_URL || !SB_KEY) return
  try {
    await fetch(`${SB_URL}/rest/v1/pm_documents`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id, data: { v: JSON.stringify(valueObj) }, editor: 'D哥', updated_at: new Date().toISOString() }),
    })
  } catch (_) {}
}

// ── D哥 檔案庫收檔：把 LINE 傳來的檔案下載→上傳 photos 公桶→暫存→依指令存進 App 檔案庫(pm_photos) ──
const FILECACHE_KEY = 'pm_bot_filecache' // 剛上傳、還沒歸檔的檔案暫存（TTL 60 分）
async function uploadToPhotos(buf, ext, contentType) {
  const safeExt = String(ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
  const r = await fetch(`${SB_URL}/storage/v1/object/photos/${path}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, 'content-type': contentType || 'application/octet-stream' },
    body: buf,
  })
  if (!r.ok) throw new Error('storage upload ' + r.status)
  return { url: `${SB_URL}/storage/v1/object/public/photos/${path}`, path }
}
// 檔案庫自訂類別清單（pm_photo_folders，字串陣列；App 讀來當篩選/分組）
const FOLDERS_KEY = 'pm_photo_folders'
async function ensureFolder(name) {
  const n = String(name || '').trim(); if (!n) return []
  const cur = (await kvGetMany([FOLDERS_KEY]))[FOLDERS_KEY]
  const list = Array.isArray(cur) ? cur.filter(x => typeof x === 'string') : []
  if (!list.some(x => x.trim().toLowerCase() === n.toLowerCase())) { list.unshift(n); await kvSet(FOLDERS_KEY, list.slice(0, 100)) }
  return list
}
async function listFolders() {
  const cur = (await kvGetMany([FOLDERS_KEY]))[FOLDERS_KEY]
  return Array.isArray(cur) ? cur.filter(x => typeof x === 'string') : []
}
// 只記「檔案參考」(LINE message id)，先不下載——等使用者說「存到檔案庫」才真的抓，省儲存空間（群組也不會塞爆）
async function stashLibraryFile(ev, convId) {
  const msg = ev.message || {}
  if (!msg.id) return false
  const isImage = msg.type === 'image'
  const fileName = msg.fileName || (isImage ? `LINE-${new Date().toISOString().slice(0, 10)}.jpg` : 'file')
  const cur = (await kvGetMany([FILECACHE_KEY]))[FILECACHE_KEY]
  const list = (cur && Array.isArray(cur.list)) ? cur.list : []
  list.unshift({ mid: msg.id, name: fileName, isImage, convId: convId || '', ts: new Date().toISOString() })
  await kvSet(FILECACHE_KEY, { list: list.slice(0, 40) })
  return true
}
// 把暫存檔存進 App 檔案庫（pm_photos）。label＝使用者講的類別名（設計檔案…）＝自訂 folder；估價單/發票/現場照 另對到固定 kind
// convId：只歸「同一個對話(私訊/該群)」剛上傳的檔，避免抓到別的群的檔
async function saveCachedFilesToLibrary(label, byName, convId) {
  const cache = (await kvGetMany([FILECACHE_KEY]))[FILECACHE_KEY]
  const all = (cache && Array.isArray(cache.list)) ? cache.list : []
  const now = Date.now()
  const mine = all.filter(f => f && f.ts && (now - new Date(f.ts).getTime()) < 60 * 60 * 1000 && (!convId || f.convId === convId))
  if (!mine.length) return { ok: false, msg: '找不到剛剛上傳的檔案（超過 60 分鐘會清掉）。請重新傳一次，傳完馬上說「存到檔案庫」。' }
  const lb = (label || '').trim()
  let kind = 'other'
  if (/估價單|報價單|報價/.test(lb)) kind = 'quote'
  else if (/發票|收據/.test(lb)) kind = 'invoice'
  else if (/現場照|工地照|進度照/.test(lb)) kind = 'site'
  const folder = lb // 自訂類別名（可為空）
  if (folder) await ensureFolder(folder)
  const photos = (await kvGetMany(['pm_photos']))['pm_photos']
  const cur = Array.isArray(photos) ? photos : []
  const today = new Date().toISOString().slice(0, 10)
  const names = [], failed = []
  for (const f of mine) {
    try {
      const r = await fetch(`https://api-data.line.me/v2/bot/message/${f.mid}/content`, { headers: { authorization: `Bearer ${TOKEN}` } })
      if (!r.ok) { failed.push(f.name); continue }
      const buf = Buffer.from(await r.arrayBuffer())
      const contentType = r.headers.get('content-type') || (f.isImage ? 'image/jpeg' : 'application/octet-stream')
      const ext = f.isImage ? (/png/.test(contentType) ? 'png' : 'jpg') : ((String(f.name).split('.').pop() || 'bin'))
      const { url, path } = await uploadToPhotos(buf, ext, contentType)
      cur.unshift({ id: 'ph-' + Math.random().toString(36).slice(2, 8), url, path, name: f.name, mime: contentType, isImage: !!f.isImage, kind, folder, catId: '', catName: '', date: today, note: '', invoiceReceived: false, by: byName || 'D哥(LINE)', ts: new Date().toISOString() })
      names.push(f.name)
    } catch (_) { failed.push(f.name) }
  }
  if (!names.length) return { ok: false, msg: '檔案抓取失敗（可能超過 LINE 下載期限），請重新傳一次再說「存到檔案庫」。' }
  await kvSet('pm_photos', cur)
  // 清掉這個對話已處理的暫存參考（其他對話的留著）
  const rest = all.filter(f => !mine.some(m => m.mid === f.mid))
  await kvSet(FILECACHE_KEY, { list: rest })
  return { ok: true, count: names.length, names, failed, label: folder || (kind === 'other' ? '其他' : { quote: '估價單', invoice: '發票', site: '現場照' }[kind]) }
}

// ── 逐筆存（v2）相容（2026-07-18）：前端改「一筆交易/任務＝一份文件」後，D哥 讀寫要跟上 ──
async function kvGetPrefix(prefix) {
  if (!SB_URL || !SB_KEY) return []
  try {
    // SQL LIKE 的 _ 也是萬用字元（pm_task_* 會誤匹配 pm_tasks）→ 底線要跳脫
    const pattern = prefix.replace(/[\\%_]/g, (m) => '\\' + m)
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(pattern)}*&select=id,data`, { headers: sbHeaders })
    const rows = r.ok ? await r.json() : []
    const out = []
    rows.forEach((row) => { if (row?.data?.v) { try { out.push(JSON.parse(row.data.v)) } catch (_) {} } })
    return out
  } catch (_) { return [] }
}
// 合併讀（防丟資料）：有 marker → 只用逐筆檔；沒 marker → 舊整包+逐筆檔合併（同 id 逐筆檔優先）。
// v2 旗標＝「寫入時走逐筆」：只要逐筆檔已存在就走逐筆，避免把舊整包整包寫回蓋掉別人的逐筆編輯。
async function kvLoadRecords(markerKey, prefix, legacyKey) {
  const [m, recs] = await Promise.all([kvGetMany([markerKey, legacyKey]), kvGetPrefix(prefix)])
  if (m[markerKey]) return { list: recs, v2: true }
  const legacy = Array.isArray(m[legacyKey]) ? m[legacyKey] : []
  if (!legacy.length) return { list: recs, v2: recs.length > 0 }
  const byId = new Map(legacy.filter(t => t && t.id).map(t => [t.id, t]))
  recs.forEach(t => { if (t && t.id) byId.set(t.id, t) })
  return { list: [...byId.values()], v2: recs.length > 0 }
}
const kvLoadTasks = async () => { const r = await kvLoadRecords('pm_tasks_v2', 'pm_task_', 'pm_tasks'); r.list.sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0)); return r }
const kvLoadLedger = async () => { const r = await kvLoadRecords('sp_finance_pm_fin_ledger_v2', 'sp_finance_pm_fin_tx_', 'sp_finance_pm_fin_ledger'); r.list.sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1)); return r }
// v2 儲存：只寫「跟載入時不同」的那幾筆（新增/被改的），不整包重寫
async function kvSaveRecordsDiff(prefix, origList, nextList, withOrd) {
  const orig = new Set(origList)
  let minOrd = 0; nextList.forEach(t => { if (typeof t.ord === 'number' && t.ord < minOrd) minOrd = t.ord })
  for (const t of nextList) {
    if (orig.has(t)) continue // 物件沒被換掉＝沒改過
    if (withOrd && typeof t.ord !== 'number') { minOrd -= 1; t.ord = minOrd } // 新任務放最前（跟 App 一致）
    await kvSet(prefix + t.id, t)
  }
}

// 全部空間的快照（每空間一個 key）
async function loadSnapshots() {
  const keys = ['pm_bot_context', 'sp_team_pm_bot_context', 'sp_crew_pm_bot_context']
  const map = await kvGetMany(keys)
  return Object.values(map)
}

// 登記/更新群組（pm_group_seen：給前端「群組」頁顯示）
async function registerGroup(gid, src) {
  if (!gid) return
  const cur = (await kvGetMany(['pm_group_seen']))['pm_group_seen'] || {}
  const g = cur[gid] || {}
  cur[gid] = { ...g, lastActive: new Date().toISOString(), count: (g.count || 0) + 1, src: src || g.src }
  await kvSet('pm_group_seen', cur)
}

async function lineReply(replyToken, text) {
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    })
    if (!r.ok) { const d = await r.text().catch(() => ''); console.log('LINE reply FAILED', r.status, d.slice(0, 300)) }
    else console.log('LINE reply OK')
    return r.ok
  } catch (e) { console.log('LINE reply error', e?.message); return false }
}

// 把快照整理成精簡文字，餵給 AI 當依據
function snapshotsToContext(snaps, moneyOK = true) {
  if (!snaps.length) return '（目前沒有資料快照。）'
  return snaps.map((s) => {
    const t = s.totals || {}
    const lines = [
      `【空間：${s.project?.name || s.space}】更新於 ${s.updatedAt || ''}`,
      moneyOK ? `預估總額 NT$${Math.round(t.est || 0).toLocaleString()}、已付 NT$${Math.round(t.paid || 0).toLocaleString()}、未付 NT$${Math.round(t.unpaid || 0).toLocaleString()}` : '',
      s.progress ? `進度 ${s.progress.pct}%（細項 ${s.progress.doneItems}/${s.progress.totalItems}）` : '',
      s.project?.daysLeft != null ? `距完工 ${s.project.daysLeft} 天（目標 ${s.project.targetDate}）` : '',
      (moneyOK && s.petty) ? `零用金：撥款 NT$${Math.round(s.petty.advances).toLocaleString()}、花費 NT$${Math.round(s.petty.spends).toLocaleString()}、餘額 NT$${Math.round(s.petty.balance).toLocaleString()}` : '',
      (s.cats || []).length ? '各大項：\n' + s.cats.map((c) => moneyOK ? `  - ${c.name}（${c.status}）預估 ${Math.round(c.est).toLocaleString()}／已付 ${Math.round(c.paid).toLocaleString()}／未付 ${Math.round(c.unpaid).toLocaleString()}` : `  - ${c.name}（${c.status}）`).join('\n') : '',
      s.seq?.urgent?.length ? `🔥 急件：${s.seq.urgent.join('、')}` : '',
      s.seq?.logs?.length ? '工序日誌（近期，含每日做了什麼/預計）：\n' + s.seq.logs.map((l) => `  - ${l.date} ${l.item}：${l.done || l.next || '（只有照片）'}${l.next && l.done ? `（預計：${l.next}）` : ''}${l.issue ? ' ⚠️異常' : ''}`).join('\n') : '工序日誌：近期無紀錄',
      (s.todo || []).length ? 'ToDo 待辦事項：\n' + s.todo.map((t) => `  - [${t.category}] ${t.desc}${t.due ? `（交期 ${t.due}）` : ''}`).join('\n') : 'ToDo：目前無待辦',
      (s.issues || []).length ? `⚠️ 有問題項目：${s.issues.join('、')}` : '',
    ].filter(Boolean)
    return lines.join('\n')
  }).join('\n\n')
}

// 帳號清單（誰能用 App）— 用 service role 讀 profiles，只取名字/角色，不碰密碼
async function loadAccounts() {
  if (!SB_URL || !SB_KEY) return ''
  try {
    const r = await fetch(`${SB_URL}/rest/v1/profiles?select=display_name,role,role_template`, { headers: sbHeaders })
    const rows = r.ok ? await r.json() : []
    if (!rows.length) return ''
    return '\n\n【App 帳號清單】\n' + rows.map((p) => `  - ${p.display_name}（${p.role === 'admin' ? '管理員' : '一般'}）`).join('\n')
  } catch (_) { return '' }
}

// 財務內帳（多帳戶 + 交易 + 科目）→ 文字
async function loadFinanceText() {
  try {
    const [fin, ledR] = await Promise.all([kvGetMany(['sp_finance_pm_fin_accounts', 'sp_finance_pm_fin_coa']), kvLoadLedger()])
    const accs = fin['sp_finance_pm_fin_accounts'] || [], led = ledR.list, coa = fin['sp_finance_pm_fin_coa'] || []
    if (!accs.length && !led.length) return ''
    const n = (v) => Number(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0
    const bal = (id) => { let b = n((accs.find(a => a.id === id) || {}).opening); led.forEach(l => { if (l.to === id) b += n(l.amount); if (l.from === id) b -= n(l.amount); }); return b }
    const lines = ['\n\n【財務內帳（多帳戶總表）】']
    if (accs.length) { lines.push('各帳戶餘額：'); accs.forEach(a => lines.push(`  - ${a.name || '未命名'} 餘額 NT$${Math.round(bal(a.id)).toLocaleString()}`)) }
    const inc = led.filter(l => l.kind === 'income').reduce((s, l) => s + n(l.amount), 0)
    const exp = led.filter(l => l.kind === 'expense').reduce((s, l) => s + n(l.amount), 0)
    lines.push(`交易共 ${led.length} 筆，累計收入 NT$${Math.round(inc).toLocaleString()}、支出 NT$${Math.round(exp).toLocaleString()}`)
    const CAP = 120
    const sorted = [...led].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, CAP)
    if (sorted.length) { lines.push(led.length > CAP ? `交易明細（新到舊，僅列最近 ${CAP} 筆，共 ${led.length} 筆；要更早的請在App查）：` : '全部交易明細（新到舊）：'); sorted.forEach(l => lines.push(`  - ${l.date || ''} ${l.kind === 'income' ? '收入' : l.kind === 'transfer' ? '轉帳' : '支出'} ${Math.round(n(l.amount)).toLocaleString()} ${[l.category, l.vendor, l.note].filter(Boolean).join('・')}`)) }
    if (coa.length) lines.push(`會計科目樹：共 ${coa.length} 個科目（大項/中項/細項）`)
    return lines.join('\n')
  } catch (_) { return '' }
}

// 操作 / 登入紀錄（pm_activity，各空間）→ 文字。D哥要能答「誰最近登入、誰改了什麼」
async function loadActivityText() {
  try {
    const keys = ['pm_activity', 'sp_team_pm_activity', 'sp_crew_pm_activity', 'sp_finance_pm_activity']
    const map = await kvGetMany(keys)
    const spaceName = { pm_activity: '工程', sp_team_pm_activity: '團隊', sp_crew_pm_activity: '夥伴', sp_finance_pm_activity: '財務' }
    let all = []
    for (const k of keys) { const arr = map[k] || []; if (Array.isArray(arr)) all.push(...arr.map(e => ({ ...e, space: spaceName[k] || '' }))) }
    if (!all.length) return ''
    all.sort((a, b) => (a.ts < b.ts ? 1 : -1))
    const fmtT = (ts) => { try { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` } catch (_) { return ts || '' } }
    const lines = [`\n\n【操作紀錄（誰做了什麼，新到舊${all.length > 80 ? '，僅列最近 80 筆' : ''}）】`]
    all.slice(0, 80).forEach(e => lines.push(`  - ${fmtT(e.ts)} ${e.user || '—'}（${e.space}）${e.action || ''}：${e.detail || ''}`))
    // 登入紀錄獨立整理：每人最後一次登入時間
    const logins = all.filter(e => e.action === '登入')
    if (logins.length) {
      const last = {}
      logins.forEach(e => { if (!last[e.user]) last[e.user] = e.ts }) // 已是新到舊，第一次遇到即最近
      lines.push('\n【登入紀錄（每人最近一次登入）】')
      Object.entries(last).forEach(([u, ts]) => lines.push(`  - ${u}：${fmtT(ts)}`))
    }
    return lines.join('\n')
  } catch (_) { return '' }
}

// 比價估價單（pm_estimates）→ 文字
async function loadEstimatesText() {
  try {
    const map = await kvGetMany(['pm_estimates'])
    const ests = map['pm_estimates'] || []
    if (!Array.isArray(ests) || !ests.length) return ''
    const n = (v) => Number(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0
    const lines = ['\n\n【比價估價單】共 ' + ests.length + ' 份：']
    ests.forEach(e => lines.push(`  - ${e.vendor || e.file || '未命名'}：總價 NT$${Math.round(n(e.total)).toLocaleString()}（${(e.items || []).length} 個品項）`))
    return lines.join('\n')
  } catch (_) { return '' }
}

// 夥伴中心（團隊）資料：正規解析成「完整但精簡」的摘要（不再截斷原始JSON，避免漏資料）。
// 360 互評→逐人平均分+各構面；意見回饋→逐人標籤統計+留言；其餘→計數+重點。
async function loadCrewText() {
  try {
    const bases = ['kb_360', 'kb_roster', 'kb_feedback', 'kb_quests', 'kb_shop', 'kb_docs', 'kb_polls', 'kb_journal']
    const keys = []
    for (const p of ['sp_crew_', 'sp_team_']) for (const b of bases) keys.push(p + b)
    const map = await kvGetMany(keys)
    const pick = (b) => map['sp_crew_' + b] || map['sp_team_' + b] || null
    const out = ['\n\n【夥伴中心（團隊）資料】']
    let any = false
    const r360 = pick('kb_360')
    // 名冊/360 已分家（2026-07-18）：人員優先讀 kb_roster；舊資料還在 kb_360.people 就當備援
    const roster = pick('kb_roster')
    const people = (roster && Array.isArray(roster.people) && roster.people.length) ? roster.people
      : (r360 && Array.isArray(r360.people) ? r360.people : [])
    const nameOf = {}
    people.forEach(p => { nameOf[p.id] = p.name })
    if (people.length) {
      any = true
      // 【100%資料鐵則】名冊全欄位（含薪資/保險/證件等機密）都要掌握；
      // 但機密欄位（薪資/身分證/保險/銀行）只在老闆（張良）的私訊裡回答，群組一律只回公開資訊（姓名/部門/到職/生日）。
      const rosterFields = (roster && Array.isArray(roster.fields) && roster.fields.length) ? roster.fields : null
      out.push(`【夥伴名冊（共 ${people.length} 人；生日格式 西元年-月-日，問「誰快生日」看月-日。含機密欄位：薪資/保險/證件/銀行——只私訊回老闆，群組不透露）】`)
      people.forEach(p => {
        let line = `  - ${p.name}${p.nick ? '（' + p.nick + '）' : ''}｜生日:${p.bday || '?'}｜到職:${p.startDate || '?'}${p.dept ? '｜部門:' + p.dept : ''}｜${p.status || '在職'}`
        if (rosterFields) {
          const extra = rosterFields.filter(f => !['dept', 'startDate', 'bday'].includes(f.key)).map(f => {
            if (f.type === 'file') { const n = (p[f.key] || []).length; return n ? `${f.label}:📎${n}份` : null }
            const v = String(p[f.key] ?? '').trim(); return v ? `${f.label}:${v}` : null
          }).filter(Boolean).join('｜')
          if (extra) line += '｜' + extra
        }
        out.push(line)
      })
    }

    // 360 互評：每個被評者的「整體平均 + 各構面平均 + 份數」（全員、不截斷）
    if (r360 && people.length) {
      any = true
      const dims = r360.dimensions || []
      const reviews = r360.reviews || []
      const agg = {}
      reviews.forEach(rv => {
        const a = agg[rv.revieweeId] || (agg[rv.revieweeId] = { sum: 0, n: 0, dim: {}, dimN: {}, cnt: 0, comments: [] })
        a.cnt++
        Object.entries(rv.scores || {}).forEach(([d, s]) => { const v = Number(s) || 0; a.sum += v; a.n++; a.dim[d] = (a.dim[d] || 0) + v; a.dimN[d] = (a.dimN[d] || 0) + 1 })
        if (rv.comment) a.comments.push(rv.comment)
      })
      const rows = Object.entries(agg).map(([id, a]) => ({ name: nameOf[id] || id, avg: a.n ? a.sum / a.n : 0, cnt: a.cnt, a })).sort((x, y) => y.avg - x.avg)
      out.push(`▍360 互評（滿分5，共 ${reviews.length} 份評，依平均高→低）：`)
      rows.forEach(r => {
        const per = dims.map(d => `${d.label}${r.a.dimN[d.id] ? (r.a.dim[d.id] / r.a.dimN[d.id]).toFixed(1) : '-'}`).join('・')
        const cm = r.a.comments.length ? `｜評語：${r.a.comments.join('；')}` : ''
        out.push(`  - ${r.name}：平均 ${r.avg.toFixed(2)}（${r.cnt} 份）｜${per}${cm}`)
      })
      const reviewed = new Set(Object.keys(agg))
      const noRev = people.filter(p => !reviewed.has(p.id)).map(p => p.name)
      if (noRev.length) out.push(`  -（尚無人評分）：${noRev.join('、')}`)
    }

    // 意見回饋：逐人收到的標籤次數 + 留言（全部 57 筆都涵蓋，不截斷）
    const fb = pick('kb_feedback')
    const items = fb && Array.isArray(fb.items) ? fb.items : (Array.isArray(fb) ? fb : [])
    if (items.length) {
      any = true
      const per = {}
      items.forEach(it => {
        const to = nameOf[it.toId] || it.toId || '?'
        const p = per[to] || (per[to] = { tags: {}, comments: [] })
        ;(it.tags || []).forEach(t => { p.tags[t] = (p.tags[t] || 0) + 1 })
        if (it.text) p.comments.push(it.anon ? `${it.text}(匿名)` : it.text)
      })
      out.push(`▍意見回饋（共 ${items.length} 筆，依人彙整）：`)
      Object.entries(per).forEach(([name, p]) => {
        const tags = Object.entries(p.tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}${n > 1 ? '×' + n : ''}`).join('、')
        const cm = p.comments.length ? `｜留言：${p.comments.join('；')}` : ''
        out.push(`  - ${name}：${tags}${cm}`)
      })
    }

    // 其餘：計數 + 重點名稱
    const q = pick('kb_quests'); if (q) { const qs = q.quests || []; if (qs.length) { any = true; out.push(`▍闖關任務：${qs.length} 個（${qs.map(x => x.title || x.name).filter(Boolean).join('、')}）`) } }
    const shop = pick('kb_shop'); if (shop) { const rw = shop.rewards || []; if (rw.length) { any = true; out.push(`▍獎勵商店：${rw.length} 個獎品（${rw.map(x => x.name || x.title).filter(Boolean).join('、')}）`) } }
    const docs = pick('kb_docs'); if (Array.isArray(docs) && docs.length) { any = true; out.push(`▍知識庫：${docs.length} 篇（${docs.map(d => d.title || d.name).filter(Boolean).join('、')}）`) }
    const polls = pick('kb_polls'); const ps = polls && Array.isArray(polls.polls) ? polls.polls : (Array.isArray(polls) ? polls : []); if (ps.length) { any = true; out.push(`▍投票：${ps.length} 個（${ps.map(p => p.title || p.q).filter(Boolean).join('、')}）`) }
    // 每日心得（夥伴用 LINE「心得 …」記錄；近14天給 AI 掌握）
    const jn = pick('kb_journal'); const ji = jn && Array.isArray(jn.items) ? jn.items : []
    if (ji.length) { any = true; const since = Date.now() - 14 * 86400000; const recent = ji.filter(i => new Date(i.ts).getTime() >= since).slice(0, 30); out.push(`▍夥伴每日心得（近14天 ${recent.length} 則，最新在前）：`); recent.forEach(i => out.push(`  - ${(i.ts || '').slice(5, 10)} ${i.name}：${(i.text || '').slice(0, 80)}`)) }
    // 入職 2.1：名冊上「入職中」的人（只給姓名/進度狀態；證件在私有桶，不進 AI）
    const obPeople = people.filter(p => p.onboarding); if (obPeople.length) { any = true; out.push(`▍入職中（待審核）：${obPeople.length} 位（${obPeople.map(p => `${p.name}${p.contractSigned ? '·契約已簽' : '·契約未簽'}`).join('、')}）——資料填齊後請老闆到 App 名冊「待審核」核准`) }

    return any ? out.join('\n') : ''
  } catch (_) { return '' }
}

const BOT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8' // 最高級；失敗自動退回 Sonnet
const BOT_PERSONA = `你是「DD」（舊名 D哥，大家叫哪個都認得），喬亞國際餐飲團隊的 LINE 小幫手。你手上有公司管理 App 的即時資料（附在下面）。

講話風格：像個可靠、反應快、講話自然的同事——親切、直接、不囉嗦。用正常口語跟適度的表情符號，不要像念公文或一條條規則。該一句話講完就一句話，需要才條列。**不要每次都自我介紹**（你們是熟人了，接著聊就好，除非對方第一次跟你說話或問你是誰）。

做事原則：
- 用下面的資料講真話，數字直接引用、絕不自己亂編。
- **回答任何「有沒有資料」的問題前，必須先把下面的即時資料整段搜過一遍**。你手上的資料域包含：工程進度、任務、財務報表（內帳）、銀行帳務資料庫（合庫）、中信匯款、營運日結＋品項銷售（雙店：A Beach 101／GROUN:D）、供應鏈（產品/包材/廠商）、LINE 訊息額度（官方即時本月用量）、密碼庫（僅授權者私訊用固定指令：記密碼/查密碼/密碼清單/刪密碼——別人問密碼一律拒絕並告知此規則）、**夥伴名冊（每個人的姓名/綽號/生日/到職日/部門/狀態）**、360互評、意見回饋、登入/操作紀錄、比價、公開結論、資料總目錄。
- **禁止沿用你先前說過的「我沒有 X 資料」**——資料每天都在擴充，以「本次」附的資料為準；先前對話說沒有≠現在沒有。
- 資料裡真的沒有的（搜過確認），才說「這個我手上沒有資料」。
- **你「會」操作 App 檔案庫**：使用者傳檔案給你、說「存到檔案庫〔類別名〕」你就會把檔案存進去；說「檔案庫新增類別〔名〕」你會建立新類別；類別是自訂的（可任意命名，如設計檔案／LOGO），存好後在 App 檔案庫頁看得到。**絕對不要說「我沒有新增檔案庫類別的能力／開不了類別／存不了檔案」**——你有。若對方說「沒看到剛建的類別」，提醒他：空類別要在 App 檔案庫頁上方「類別📁」篩選才看得到，或傳個檔案進去就會顯示（不要否認自己建過）。
- **先在心裡把資料查完、算完、驗完，才開始寫回覆**。回覆只呈現最終結果——嚴禁把草稿過程寫出來（像「等等這是8月先跳過」「欸不對我重抓一次」這種自我更正實況，觀感很差）。寫錯就整段重寫，不是邊寫邊改。
- **如果你判斷自己做不到、或資料不足、或對方的要求不在你能力範圍**：直接、清楚地說「我做不到 X，原因是 Y，你可以這樣做 Z」。不要裝懂、不要答非所問、不要假裝完成。
- 記得上面的對話脈絡，順著聊，不要把每句話都當第一次見面。
- 如果對話中出現「值得長期記住」的重要事實（某人負責什麼、聯絡方式、分工窗口、老闆的偏好或固定要求、專案的重要約定…），在你回覆的「最後」另起一行用這個格式標記：[[記住:該事實]]（可多行、每行一件、寫簡短）。只標真正值得長期記的，瑣事不要標。這個標記使用者看不到，是給系統存進你的長期記事本用的。`
const SYS_DATA_HEAD = '\n\n────────\n【你目前掌握的即時資料】\n'

// 排班系統（夥伴中心・排班）→ 文字。【100%資料鐵則】問「某人某天上什麼班」一律以此為準。
// 出勤打卡（今日）：誰上班中/已下班、LINE備援未審核筆數（100%資料鐵則——打卡新資料域）
async function loadPunchText() {
  try {
    const { todayPunchesAll } = await import('./punch.js')
    const all = await todayPunchesAll()
    if (!all.length) return ''
    const by = {}
    all.forEach(r => { (by[r.personId] = by[r.personId] || { name: r.name, recs: [] }).recs.push(r) })
    const lines = ['\n【今日出勤打卡（記到分鐘；qr=打卡站掃碼、line=備援需審核）】']
    Object.values(by).forEach(p => {
      const last = p.recs[p.recs.length - 1]
      const hhmm = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' })
      lines.push(`  - ${p.name}：${p.recs.map(r => `${r.dir === 'in' ? '上' : '下'}${hhmm(r.ts)}${r.src === 'line' ? (r.verified ? '(line✓)' : '(line待審)') : ''}`).join(' ')}｜${last.dir === 'in' ? '🟢上班中' : '已下班'}`)
    })
    const pend = all.filter(r => r.src === 'line' && !r.verified).length
    if (pend) lines.push(`  ⚠ LINE 備援打卡待審核 ${pend} 筆（負責人請到 App 夥伴中心→出勤 審核）`)
    // P2：今日班表比對（本週有發布班表才有）
    try { const pj = await import('./punch.js'); const cmp = await pj.attendanceCompareToday(); lines.push(...pj.attendanceLines(cmp)) } catch (_) {}
    // P3：薪資試算參數（sp_crew_pay_rules；試算明細在 App 薪資頁。薪資屬機密——數字只私訊回老闆）
    try {
      const { rulesAt } = await import('../src/shift/payroll.js')
      const doc = await kvGetMany(['sp_crew_pay_rules']).then(m => m['sp_crew_pay_rules'])
      const rr = rulesAt(doc, new Date().toISOString().slice(0, 10))
      lines.push(`【薪資/勞基法參數（App 夥伴中心→薪資試算 ⚙ 可調；試算=草稿）】基本工資 月${rr.minWageMonthly}/時${rr.minWageHourly}・加班 ${rr.otRate1}/${rr.otRate2}・勞保 ${rr.laborInsRate} 健保 ${rr.healthInsRate} 勞退 ${rr.pensionRate}${(doc?.scheduled || []).length ? `・預排調整 ${(doc.scheduled).map(s => s.effective).join('、')}` : ''}`)
    } catch (_) {}
    return lines.join('\n')
  } catch (_) { return '' }
}
async function loadShiftText() {
  try {
    const base = ['shift_staff', 'shift_templates', 'shift_stations', 'shift_leaves', 'shift_sched_index'].map(k => 'sp_crew_' + k)
    const m = await kvGetMany(base)
    const g = (k) => m['sp_crew_' + k] || {}
    const staff = g('shift_staff').staff || []
    const shifts = g('shift_templates').shifts || []
    const stations = g('shift_stations').stations || []
    const leaves = g('shift_leaves').leaves || []
    const weeks = (g('shift_sched_index').weeks || []).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, 6) // 最近 6 週
    if (!staff.length && !weeks.length) return ''
    const sName = (id) => { const p = staff.find((x) => x.id === id); return p ? (p.nick || p.name) : id }
    const shOf = (id) => shifts.find((x) => x.id === id)
    const stOf = (id) => stations.find((x) => x.id === id)
    const out = ['\n\n【排班系統（夥伴中心・排班；問誰哪天上什麼班、班別時間、請假，一律以此為準）】']
    if (staff.length) out.push('排班人員（' + staff.length + ' 人）：' + staff.map((p) => `${p.nick || p.name}(${p.dept || '?'}/${p.grade || '?'}${p.expectShifts != null ? '/週' + p.expectShifts + '班' : ''})`).join('、'))
    if (shifts.length) out.push('班別代碼：' + shifts.map((s) => `${s.code}=${s.name} ${s.start}-${s.end}(${s.dept})`).join('、'))
    const schedKeys = weeks.map((w) => 'sp_crew_shift_sched_' + w.storeId + '_' + w.weekStart)
    const sm = schedKeys.length ? await kvGetMany(schedKeys) : {}
    for (const w of weeks) {
      const doc = sm['sp_crew_shift_sched_' + w.storeId + '_' + w.weekStart]
      if (!doc) continue
      const byDate = {}
      for (const a of doc.assignments || []) {
        const sh = shOf(a.shiftId)
        ;(byDate[a.date] = byDate[a.date] || []).push(`${sName(a.staffId)} ${sh ? sh.code + ' ' + sh.start + '-' + sh.end : a.shiftId}${a.stationId && stOf(a.stationId) ? '@' + stOf(a.stationId).name : ''}`)
      }
      out.push(`▍週 ${w.weekStart}（店:${w.storeId}，狀態:${doc.status || w.status || '?'}${doc.isActual ? '，實際出勤' : ''}）`)
      Object.keys(byDate).sort().forEach((d) => out.push(`  - ${d}：${byDate[d].join('、')}`))
    }
    if (leaves.length) out.push('請假紀錄：' + leaves.slice(-30).map((l) => `${sName(l.staffId)} ${l.date} ${l.type || '休'}(${l.status || '?'})`).join('、'))
    return out.join('\n')
  } catch (_) { return '' }
}

// 任務中心（pm_tasks，Task v2 全欄位）→ 文字。D哥 讀任務一律以這份為準（完整、含衍生狀態）
async function loadTasksText() {
  try {
    const [m, tR] = await Promise.all([kvGetMany(['pm_data']), kvLoadTasks()])
    const tasks = tR.list
    if (!tasks.length) return ''
    const cats = Array.isArray(m['pm_data']) ? m['pm_data'] : []
    const catName = (id) => (!id || id === '__inbox__') ? '收件匣' : ((cats.find(c => c.id === id) || {}).name || '收件匣')
    const SL = { todo: '待辦', doing: '進行中', done: '完成' }
    const lines = [`\n\n【任務中心（共 ${tasks.length} 件，可用 add_task / update_task 操作）】`]
    tasks.forEach(t => {
      const bits = [`${t.pinned ? '📌' : ''}[${SL[t.status] || t.status}] ${t.title}（${catName(t.catId)}）`]
      if (t.due) bits.push(`截止${t.due}`)
      if (t.owner) bits.push(`負責:${t.owner}`)
      if (isWaiting(t)) bits.push(`等待中:${t.waitingFor}`)
      if (t.estimatedMinutes != null) bits.push(`預估${t.estimatedMinutes}分`)
      const deps = (t.dependsOn || []).map(id => { const d = tasks.find(x => x.id === id); return d ? d.title : '(失效引用)' })
      if (deps.length) bits.push(`依賴:${deps.join('、')}`)
      if (isBlocked(t, tasks)) bits.push('⛔被前置任務卡住')
      if (t.priority === 'urgent') bits.push('超急')
      if ((t.tags || []).length) bits.push(`#${t.tags.join(' #')}`)
      lines.push('  - ' + bits.join('｜'))
    })
    return lines.join('\n')
  } catch (_) { return '' }
}

// 銀行帳務資料庫（sp_finance_pm_bank 永久累積；試算表退役中，僅當備援）→ 文字
async function loadSheetText() {
  try {
    const kv = await kvGetMany(['sp_finance_pm_bank', 'sp_finance_pm_sheet', 'sp_finance_pm_ctbc'])
    const bk = kv['sp_finance_pm_bank']
    const v = (bk && Array.isArray(bk.entries) && bk.entries.length) ? { rows: bk.entries, syncedAt: bk.updatedAt } : kv['sp_finance_pm_sheet']
    const rows = v && Array.isArray(v.rows) ? v.rows : []
    if (!rows.length) return ''
    const lines = [`\n\n【銀行帳務資料庫（合作金庫·喬亞帳戶，每一筆銀行進出，共 ${rows.length} 筆，更新 ${v.syncedAt ? new Date(v.syncedAt).toLocaleString('zh-TW') : ''}）】`]
    const ct = kv['sp_finance_pm_ctbc']
    if (ct && Array.isArray(ct.entries) && ct.entries.length) {
      lines.push(`【中國信託 e-Cash 匯款紀錄（匯款通知自動入庫，共 ${ct.entries.length} 筆，以下最近 60 筆）】`)
      ct.entries.slice(-60).forEach(e => lines.push(`  - ${e.effDate || e.setDate} [${e.type}] ${e.note || ''}｜NT$${Math.round(e.amount).toLocaleString()}${e.count > 1 ? `（${e.count}筆）` : ''}${e.result !== '交易完成' ? `〔${e.result}〕` : ''}`))
    }
    rows.slice(-100).forEach(r => lines.push(`  - ${r.payDate || r.notifyDate || ''} [${r.cat}${r.subject ? '/' + r.subject : ''}] ${r.content}｜NT$${Math.round(r.amount).toLocaleString()}${r.payee ? '→' + r.payee : ''}${r.batch ? '（' + r.batch + '）' : ''}`))
    return lines.join('\n')
  } catch (_) { return '' }
}

// POS 營運日結（Eats365 自動收信入庫 sp_finance_pm_pos + 當月明細）→ 文字
async function loadPosText() {
  try {
    const now = new Date(Date.now() + 8 * 3600e3)
    const mo = now.toISOString().slice(0, 7)
    const kv = await kvGetMany(['sp_finance_pm_pos', 'sp_finance_pm_pos_d_' + mo, 'sp_finance_pm_pos_tx_' + mo, 'sp_finance_pm_pos_flags', 'sp_finance_pm_pos_idlecfg'])
    const pos = kv['sp_finance_pm_pos']
    const entries = pos && Array.isArray(pos.entries) ? pos.entries : []
    if (!entries.length) return ''
    const nt = (n) => 'NT$' + Math.round(n || 0).toLocaleString()
    // 雙店（A Beach / GROUN:D）同庫：多店時每行帶店名；partial=人工回填日（只有營收/品項，別答單數/付款拆分）
    const isG = (e) => /groun/i.test(e.store || '')
    const multiStore = new Set(entries.map(e => isG(e) ? 'g' : 'a')).size > 1
    const sTag = (e) => multiStore ? (isG(e) ? '［GROUN:D］' : '［A Beach］') : ''
    const lines = [`\n\n【營運日結（${multiStore ? '雙店：A Beach＋GROUN:D' : (entries[0]?.store || 'POS')}，每日結帳自動入庫，共 ${entries.length} 天）】`]
    entries.slice(-30).forEach(e => lines.push(e.partial
      ? `  - ${e.date}${sTag(e)} 營收${nt(e.revenue)}${e.grossSales > e.revenue ? `（牌價${nt(e.grossSales)}·試營運折讓）` : ''}｜${e.partial}`
      : `  - ${e.date}${sTag(e)} 營收${nt(e.revenue)}｜${e.txCount}單｜來客${e.guests || '?'}｜客單${e.guests ? nt(Math.round(e.revenue / e.guests)) : '—'}｜現金${nt(e.cash)}/卡${nt(e.card)}/Uber${nt(e.uber)}｜折扣${nt(e.discount)}`))
    // 當月品項銷售彙總（答「哪些餐賣得好」用）
    const det = kv['sp_finance_pm_pos_d_' + mo]
    if (det && det.days) {
      const agg = {}
      Object.values(det.days).forEach(day => (day.sheets?.['總銷售額 (以類別分類)'] || []).forEach(sec => {
        if (sec.title === '總結') return
        const sfx = multiStore ? (/groun/i.test(day.store || '') ? '〔GROUN:D〕' : '〔A Beach〕') : '' // 兩店菜單重疊（都賣披薩），品名帶店名分開統計不混算
        ;(sec.rows || []).forEach(r => {
          if (!Array.isArray(r) || typeof r[0] !== 'string') return
          const a = agg[r[0] + sfx] = agg[r[0] + sfx] || { qty: 0, amt: 0, cat: sec.title }
          a.qty += Number(r[1]) || 0; a.amt += Number(r[r.length - 1]) || 0
          // 同名品項各分類分開記（答「哪些是外帶低價版」）
          const bc = (a.byCat = a.byCat || {})[sec.title] = (a.byCat || {})[sec.title] || { qty: 0, amt: 0 }
          bc.qty += Number(r[1]) || 0; bc.amt += Number(r[r.length - 1]) || 0
        })
      }))
      const arr = Object.entries(agg).filter(([, v]) => v.amt > 0).sort((a, b) => b[1].amt - a[1].amt)
      if (arr.length) {
        lines.push(`【本月品項銷售彙總（依營收排序，共 ${arr.length} 品項；前 25 名＋末 10 名）】`)
        arr.slice(0, 25).forEach(([n, v], i) => lines.push(`  ${i + 1}. ${n}［${v.cat}］ ${v.qty}份 ${nt(v.amt)}`))
        if (arr.length > 35) { lines.push('  …（中段略）…'); arr.slice(-10).forEach(([n, v]) => lines.push(`  末段: ${n}［${v.cat}］ ${v.qty}份 ${nt(v.amt)}`)) }
      }
      // 同名品項分類價差（張良 2026-07-26：賣很少+單價低=外帶類別版本，DD 要認得）
      const dupes = Object.entries(agg).map(([n, v]) => {
        const cats = Object.entries(v.byCat || {}).filter(([, b]) => b.qty > 0).map(([c2, b]) => ({ c: c2, qty: b.qty, unit: Math.round(b.amt / b.qty) }))
        if (cats.length < 2) return null
        cats.sort((a, b) => b.unit - a.unit)
        const df = cats[0].unit - cats[cats.length - 1].unit
        return (df >= 10 && df / cats[0].unit >= 0.05) ? { n, cats, df } : null
      }).filter(Boolean).sort((a, b) => b.df - a.df)
      if (dupes.length) {
        lines.push(`【同名品項分類價差（低價版多為外帶/優惠類別；共 ${dupes.length} 組。同名銷量統計已合併計算）】`)
        dupes.slice(0, 15).forEach(g => lines.push(`  - ${g.n}：` + g.cats.map(c2 => `${c2.c} 單價${nt(c2.unit)}(${c2.qty}份)`).join(' vs ')))
      }
      // 品項連續未售（張良 2026-07-26：DD 要答得出「哪些餐點連續幾天沒賣」）：逐日明細算每品項最後售出日
      // 門檻/排除清單跟 App「😴 沒賣預警」區同一份設定（sp_finance_pm_pos_idlecfg）＝資料一致
      const icfg = kv['sp_finance_pm_pos_idlecfg'] || {}
      const idleDays = Number(icfg.days) || 7
      const exCats = Array.isArray(icfg.exCats) ? icfg.exCats : []
      const exItems = Array.isArray(icfg.exItems) ? icfg.exItems : []
      const itemLast = {}, itemCat = {}
      Object.values(det.days).forEach(day => (day.sheets?.['總銷售額 (以類別分類)'] || []).forEach(sec => {
        if (sec.title === '總結') return
        const sfx = multiStore ? (/groun/i.test(day.store || '') ? '〔GROUN:D〕' : '〔A Beach〕') : '' // 未售統計也分店記，跟上面彙總同口徑
        ;(sec.rows || []).forEach(r => {
          if (!Array.isArray(r) || typeof r[0] !== 'string' || (Number(r[1]) || 0) <= 0) return
          const dte = (day.date || '').slice(0, 10)
          const nk = r[0] + sfx
          if (dte && (!itemLast[nk] || itemLast[nk] < dte)) { itemLast[nk] = dte; itemCat[nk] = sec.title }
        })
      }))
      const lastD = entries[entries.length - 1]?.date
      if (lastD && Object.keys(itemLast).length) {
        const idle = Object.entries(itemLast).map(([n, ld]) => ({ n, ld, gap: Math.round((new Date(lastD + 'T00:00:00') - new Date(ld + 'T00:00:00')) / 864e5) })).filter(x => x.gap >= idleDays && !exCats.includes(itemCat[x.n]) && !exItems.includes(x.n.replace(/〔.*〕$/, ''))).sort((a, b) => b.gap - a.gap)
        if (idle.length) {
          lines.push(`【連續未售品項（門檻 ${idleDays} 天＝老闆在營運報表「沒賣預警」設的；已排除 ${exCats.length} 分類/${exItems.length} 品項；距最新日結 ${lastD}；共 ${idle.length} 項）】`)
          idle.slice(0, 25).forEach(x => lines.push(`  - ${x.n}［${itemCat[x.n] || ''}］：${x.gap} 天沒賣（最後售出 ${x.ld}）`))
          lines.push('  ※只看得到本月有賣過的品項；上月就停售的看不到（逐日明細只到本月）')
        } else {
          lines.push(`【連續未售品項】目前沒有超過 ${idleDays} 天沒賣的品項（門檻與排除清單＝老闆在「沒賣預警」區的設定）`)
        }
      }
    }
    // 逐筆交易（日結信 Transaction 附件，sp_finance_pm_pos_tx_月檔）：只濃縮「作廢/退」相關列（100%資料鐵則；答「7/23 那筆 Void 是哪張單」）
    const txd = kv['sp_finance_pm_pos_tx_' + mo]
    if (txd && txd.days) {
      const bad = []
      Object.values(txd.days).forEach(day => {
        const t = day.tx; if (!t || !t.h) return
        ;(t.r || []).forEach(row => { if (row.some(c => /void|作廢|退菜|退單|取消|refund/i.test(String(c)))) bad.push(`  - ${day.date} ` + t.h.map((h, j) => (row[j] !== '' && row[j] != null) ? `${h}:${row[j]}` : '').filter(Boolean).join('｜')) })
      })
      if (bad.length) { lines.push(`【本月逐筆交易「作廢/退」相關（共 ${bad.length} 筆）】`); bad.slice(-40).forEach(l => lines.push(l)) }
    }
    // 日別標記（老闆確認過的非營運事件：測試/包場/行銷——警示已排除，回答時要當背景知識）
    const flags = kv['sp_finance_pm_pos_flags']
    if (flags && flags.items && Object.keys(flags.items).length) {
      lines.push('【POS 日別標記（老闆確認過的非營運事件，警示已排除）】')
      Object.entries(flags.items).slice(-20).forEach(([k, f]) => { const [d8, , kind] = k.split('::'); lines.push(`  - ${d8} ${kind === 'waste' ? '退菜/Void' : '折扣'}：${f.type}${f.note ? `（${f.note}）` : ''}｜排除${Number(f.amt) > 0 ? 'NT$' + Number(f.amt).toLocaleString() : '整天全額'}`) })
    }
    return lines.join('\n')
  } catch (_) { return '' }
}

// 資料總目錄：列出資料庫所有文件 id → D 知道系統有哪些資料域（新空間/新功能上線自動出現在這）
// LINE OA 訊息額度（官方 API 即時）→ 文字（張良 2026-07-18：DD 要答得出「LINE 訊息額度多少」）
async function loadLineQuotaText() {
  try {
    const H = { authorization: `Bearer ${TOKEN}` }
    const [qr, cr] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers: H }).then(r => r.json()),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: H }).then(r => r.json()),
    ])
    if (qr?.value == null && cr?.totalUsage == null) return ''
    return `\n\n【LINE 訊息額度（官方即時）】本月已用 ${cr?.totalUsage ?? '?'} / ${qr?.value ?? '無上限'} 則（只有主動推播計額度；在群裡回覆不計、免費）。App 設定→用量 也看得到＋推播去向。`
  } catch (_) { return '' }
}
// ── DD 密碼庫（pm_bot_vault）：密碼用 BOT_VAULT_KEY(伺服器env) AES-256-GCM 加密存放 ──
// 資料庫裡只有密文（拿到 DB 也解不開）；只有「授權操作者的私訊」能存取，處理走固定指令、不經 AI 模型。
const VKEY = clean(process.env.BOT_VAULT_KEY || '')
const vkey = () => crypto.createHash('sha256').update(VKEY).digest()
const vEnc = (s) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', vkey(), iv); const ct = Buffer.concat([c.update(String(s), 'utf8'), c.final()]); return iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + ct.toString('hex') }
const vDec = (s) => { try { const [iv, tag, ct] = String(s).split(':'); const d = crypto.createDecipheriv('aes-256-gcm', vkey(), Buffer.from(iv, 'hex')); d.setAuthTag(Buffer.from(tag, 'hex')); return Buffer.concat([d.update(Buffer.from(ct, 'hex')), d.final()]).toString('utf8') } catch (_) { return '（解不開）' } }
async function getBotVault() { const d = await kvGetMany(['pm_bot_vault']); const v = d['pm_bot_vault']; return (v && Array.isArray(v.items)) ? v.items : [] }
async function saveBotVault(items) { await kvPut('pm_bot_vault', { items }, 'DD密碼庫') }

async function loadCatalogText() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?select=id,updated_at&order=id`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows = r.ok ? await r.json() : []
    const skip = /^(pm_hist_|sp_.*_pm_hist_)|backup|pm_bot_(chats|confirm|operators)/
    const ids = rows.filter(x => !skip.test(x.id)).map(x => `${x.id}(${(x.updated_at || '').slice(5, 10)})`)
    if (!ids.length) return ''
    return `\n\n【資料總目錄（App 全部資料域＋最後更新月-日；若被問到你沒有的細節，先看這裡有沒有對應資料域，有的話回「這個資料我有收錄，請張良叫 Claude 幫我接上細節」）】\n  ${ids.join('、')}`
  } catch (_) { return '' }
}

// 供應鏈（廠商/物料比價/變價/叫貨驗收問題追蹤/食譜成本）→ 文字（與 App 共用 supplyDigest，一處維護兩邊同步）
async function loadSupplyText() {
  try {
    const [kv2, recipes] = await Promise.all([
      kvGetMany(['sp_supply_pm_supply', 'sp_supply_pm_orders']),
      kvGetPrefix('sp_supply_pm_recipe_v_'),
    ])
    return supplyDigest({ supply: kv2['sp_supply_pm_supply'], orders: kv2['sp_supply_pm_orders'], recipes })
  } catch (_) { return '' }
}

// 公開結論（團隊定案，現行版）→ 文字
async function loadConclusionsText() {
  try {
    const v = (await kvGetMany(['pm_conclusions']))['pm_conclusions']
    const list = Array.isArray(v) ? v.filter(c => c && c.status !== 'archived') : []
    if (!list.length) return ''
    const lines = ['\n\n【公開結論（團隊定案・現行版，問結論優先看這）】']
    list.slice(0, 60).forEach(c => lines.push(`・${c.topic}：${c.conclusion}${c.decidedBy ? `（${c.decidedBy}${c.date ? ' ' + c.date : ''} 定案）` : ''}`))
    return lines.join('\n')
  } catch (_) { return '' }
}

async function loadFilelibText() {
  try {
    const [ff, fc] = await Promise.all([kvGetMany([FOLDERS_KEY]), kvGetMany([FILECACHE_KEY])])
    const folders = Array.isArray(ff[FOLDERS_KEY]) ? ff[FOLDERS_KEY].filter(x => typeof x === 'string') : []
    const cache = fc[FILECACHE_KEY]
    const pend = (cache && Array.isArray(cache.list)) ? cache.list.filter(f => f && f.ts && (Date.now() - new Date(f.ts).getTime()) < 60 * 60 * 1000) : []
    const lines = ['\n\n【檔案庫（App 相簿）｜你會操作，別說做不到】']
    lines.push('現有自訂類別：' + (folders.length ? folders.join('、') : '（還沒有自訂類別）') + '；固定類別：估價單／現場照／發票／其他。')
    lines.push('使用者說「新增〔名〕類別」你就會建、「存到檔案庫〔類別〕」你就把剛傳的檔存進去（這些由系統直接執行，你只要照講、別否認自己有此能力）。回答「有沒有X類別」直接看上面清單。')
    if (pend.length) lines.push(`⏳ 現在有 ${pend.length} 個剛上傳、還沒歸檔的檔案在等你歸檔。`)
    return lines.join('\n')
  } catch (_) { return '' }
}

async function answer(question, snaps, accountsText, financeText, activityText, estimatesText, crewText, canAct, history, memoryText, conclusionsText, tasksText, sheetText, posText, catalogText, supplyText, lineQuotaText, filelibText, moneyOK = true) {
  if (!ANTHROPIC) return '（D哥的 AI 金鑰尚未設定。）'
  // 外部群（moneyOK=false）：不給任何金額/財務資料，並下鐵令禁止透露
  const moneyGuard = moneyOK ? '' : '\n\n⚠️【外部群鐵律】這個群是「外部群」，你**絕對禁止**透露任何：金額、預估/已付/未付、單價、報價、成本、營業額、銀行/帳戶餘額、零用金、財務數字、薪資。被問到金額類一律回「這部分金額不方便在這裡提供，我私下跟張哥確認 🙏」，不要旁敲側擊地洩漏。你可以講進度、工序、一般事務、用 web_search 查一般問題。'
  const system = (canAct ? BOT_AGENT_GUIDE + '\n\n' : '') + BOT_PERSONA + moneyGuard + (memoryText || '') + SYS_DATA_HEAD + snapshotsToContext(snaps, moneyOK) + (tasksText || '') + (moneyOK ? (accountsText || '') : '') + (moneyOK ? (financeText || '') : '') + (activityText || '') + (moneyOK ? (estimatesText || '') : '') + (crewText || '') + (conclusionsText || '') + (sheetText || '') + (moneyOK ? (posText || '') : '') + (moneyOK ? (supplyText || '') : '') + (lineQuotaText || '') + (catalogText || '') + (filelibText || '')
  const messages = [...(Array.isArray(history) ? history : []), { role: 'user', content: question }]
  const callModel = async (model) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1500, system, messages }),
    })
    return { ok: r.ok, d: await r.json().catch(() => ({})) }
  }
  try {
    let { ok, d } = await callModel(BOT_MODEL)
    if (!ok) { console.log('primary model failed, fallback to sonnet', d?.error?.message); ({ ok, d } = await callModel('claude-sonnet-4-6')) } // 主模型不可用就退回，D哥不會啞掉
    if (ok) return (d.content || []).map((b) => b.text || '').join('').trim() || '（沒有內容）'
    return '（AI 回應失敗，請稍後再試）'
  } catch (_) { return '（AI 連線失敗，請稍後再試）' }
}

// ════════════════════════════════════════════════════════════════════════
// D哥 動作引擎：授權操作者可用 LINE 對話直接操作 App（私訊限定＋執行前一律要確認）
// 寫入格式刻意與 App 內 applyActions 一致，確保不會寫壞資料。
// ════════════════════════════════════════════════════════════════════════
const STATUS_ALIASES = { '待開工': 'pending', '未開工': 'pending', 'pending': 'pending', '進行中': 'inprogress', '施工中': 'inprogress', 'inprogress': 'inprogress', 'in_progress': 'inprogress', '完工': 'done', '完成': 'done', '已完成': 'done', 'done': 'done', '有問題': 'issue', '問題': 'issue', 'issue': 'issue', '暫停': 'hold', 'paused': 'hold', 'hold': 'hold' }
const STATUS_LABEL = { pending: '待開工', inprogress: '進行中', done: '完工', issue: '有問題', hold: '暫停' }
const normStatus = (s) => STATUS_ALIASES[String(s || '').trim()] || null
const bid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const fmtNT = (n) => 'NT$' + (Math.round(Number(n) || 0)).toLocaleString()
const findCat = (cats, q) => { if (!q) return null; return cats.find(c => c.name === q) || cats.find(c => c.name && (c.name.includes(q) || q.includes(c.name))) }
const findItem = (cat, q) => { if (!cat || !q) return null; const its = cat.items || []; return its.find(i => i.name === q) || its.find(i => i.name && (i.name.includes(q) || q.includes(i.name))) }
// 任務：用標題(或id)找；精準優先、再模糊
const findTask = (tasks, q) => { if (!q) return null; return tasks.find(t => t.id === q) || tasks.find(t => t.title === q) || tasks.find(t => t.title && (t.title.includes(q) || q.includes(t.title))) }
// dependsOn：Bot 端收到「標題或 id」→ 一律換成 Task ID 存（storage 永遠存 id）
const resolveDeps = (list, tasks) => (Array.isArray(list) ? list : []).map(q => { const d = findTask(tasks, q); return d ? d.id : null }).filter(Boolean)
const TASK_STATUS = { '待辦': 'todo', 'todo': 'todo', '進行中': 'doing', '施工中': 'doing', 'doing': 'doing', '完成': 'done', '完工': 'done', 'done': 'done' }
const TASK_PRIO = { '超急': 'urgent', 'urgent': 'urgent', '高': 'high', 'high': 'high', '一般': 'normal', 'normal': 'normal', '低': 'low', 'low': 'low' }

function extractBalancedObjects(s) {
  const out = []; let depth = 0, start = -1
  for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '{') { if (depth === 0) start = i; depth++ } else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1 } } }
  return out
}
function parseActions(text) {
  const actions = [], blocks = []
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) blocks.push(m[1])
  if (!blocks.length) { const m = text.match(/\{[\s\S]*"actions"[\s\S]*\}/); if (m) blocks.push(m[0]) }
  if (!blocks.length) blocks.push(text)
  for (const b of blocks) {
    let ok = false
    try { const o = JSON.parse(b); if (Array.isArray(o)) { actions.push(...o); ok = true } else if (Array.isArray(o.actions)) { actions.push(...o.actions); ok = true } else if (o && o.type) { actions.push(o); ok = true } } catch (_) {}
    if (!ok) for (const os of extractBalancedObjects(b)) { try { const o = JSON.parse(os); if (o && o.type) actions.push(o) } catch (_) {} }
  }
  return actions.filter(a => a && a.type)
}
// 把 AI 回覆裡的 json 區塊拿掉，只留給人看的說明文字
const stripJson = (t) => t.replace(/```(?:json)?[\s\S]*?```/g, '').replace(/\{[\s\S]*"actions"[\s\S]*\}/g, '').trim()

// 一句話描述一個 action（給「執行前確認」用）
function describeAction(a) {
  switch (a.type) {
    case 'add_category': return `新增大項「${a.name || '?'}」`
    case 'delete_category': return `刪除大項「${a.category || '?'}」`
    case 'set_category_status': return `把大項「${a.category || '?'}」狀態改成 ${a.status || '?'}`
    case 'add_item': return `在「${a.category || '?'}」新增細項「${a.name || '?'}」${a.unitPrice ? `（單價 ${fmtNT(a.unitPrice)}×${a.qty || 1}）` : ''}`
    case 'set_item': case 'set_item_status': return `更新「${a.category || '?'}／${a.item || a.itemName || '?'}」${a.status ? ` 狀態→${a.status}` : ''}`
    case 'delete_item': return `刪除「${a.category || '?'}」的細項「${a.item || a.itemName || '?'}」`
    case 'add_payment': return `「${a.category || '?'}」新增付款 ${fmtNT(a.amount)}`
    case 'add_todo': case 'add_task': return `新增任務「${a.desc || a.content || a.title || '?'}」${a.category ? `（歸到 ${a.category}）` : ''}${a.due ? `（交期 ${a.due}）` : ''}${a.owner ? `（負責:${a.owner}）` : ''}${a.estimatedMinutes ? `（預估${a.estimatedMinutes}分）` : ''}`
    case 'update_task': { const ks = ['status', 'owner', 'waitingFor', 'estimatedMinutes', 'dependsOn', 'due', 'start', 'priority', 'category', 'tags', 'note', 'newTitle'].filter(k => a[k] !== undefined); return `更新任務「${a.task || a.title || '?'}」→ 改 ${ks.join('、') || '?'}` }
    case 'add_conclusion': return `新增公開結論：「${a.topic || a.title || '?'}」→ ${(a.conclusion || a.text || a.content || '').slice(0, 30)}`
    case 'add_petty_spend': return `記零用金花費 ${fmtNT(a.amount)}「${a.content || a.note || ''}」`
    case 'add_finance_tx': return `記財務${/收/.test(a.kind || '') ? '收入' : /轉/.test(a.kind || '') ? '轉帳' : '支出'} ${fmtNT(a.amount)}${a.vendor ? `（${a.vendor}）` : ''}`
    case 'add_log': return `新增工作日誌「${(a.content || '').slice(0, 20)}」`
    default: return `（不支援的操作：${a.type}）`
  }
}

async function appendActivity(key, user, action, detail) {
  try { const cur = (await kvGetMany([key]))[key]; const arr = Array.isArray(cur) ? cur : []; await kvSet(key, [{ ts: new Date().toISOString(), user, action, detail }, ...arr].slice(0, 200)) } catch (_) {}
}

// 真正執行：載入要動到的資料 → 套用 → 存回 → 記操作紀錄
async function executeActions(actions, operator) {
  const [ck, tR, lR] = await Promise.all([
    kvGetMany(['pm_data', 'pm_worklog', 'pm_petty', 'pm_issues', 'pm_conclusions', 'sp_finance_pm_fin_accounts']),
    kvLoadTasks(), kvLoadLedger(),
  ])
  let cats = Array.isArray(ck['pm_data']) ? ck['pm_data'] : []
  let worklog = Array.isArray(ck['pm_worklog']) ? ck['pm_worklog'] : []
  const pj = ck['pm_petty'] || {}; let petty = { advances: pj.advances || [], spends: pj.spends || [] }
  let issues = Array.isArray(ck['pm_issues']) ? ck['pm_issues'] : []
  let tasks = tR.list
  let conclusions = Array.isArray(ck['pm_conclusions']) ? ck['pm_conclusions'] : []
  let ledger = lR.list
  const tasks0 = [...tasks], ledger0 = [...ledger] // v2 差異寫入的比對基準（載入時的原物件）
  const accounts = Array.isArray(ck['sp_finance_pm_fin_accounts']) ? ck['sp_finance_pm_fin_accounts'] : []
  const today = new Date().toISOString().slice(0, 10)
  const by = 'D哥(' + operator + ')'
  const results = [], changed = new Set(), audits = []
  for (const a of actions) {
    const t = a.type
    try {
      if (t === 'add_category') {
        cats.push({ id: 'cat-' + bid(''), order: cats.length, name: a.name || '新大項', budget: Number(a.budget) || 0, status: 'pending', items: [] })
        changed.add('pm_data'); results.push(`➕ 新增大項「${a.name || '新大項'}」`); audits.push(['pm_activity', '新增', `新增大項「${a.name || '新大項'}」`])
      } else if (t === 'delete_category') {
        const c = findCat(cats, a.category); if (c) { cats = cats.filter(x => x.id !== c.id); changed.add('pm_data'); results.push(`🗑️ 刪除大項「${c.name}」`); audits.push(['pm_activity', '刪除', `刪除大項「${c.name}」`]) } else results.push(`⚠️ 找不到大項「${a.category}」`)
      } else if (t === 'set_category_status') {
        const c = findCat(cats, a.category), s = normStatus(a.status)
        if (c && s) { c.status = s; if (s === 'done') c.items = (c.items || []).map(it => ({ ...it, status: 'done', done: true })); changed.add('pm_data'); results.push(`🔖 「${c.name}」→${STATUS_LABEL[s]}`); audits.push(['pm_activity', '編輯', `改大項「${c.name}」狀態 → ${STATUS_LABEL[s]}`]) } else results.push(`⚠️ 找不到大項「${a.category}」或狀態無效`)
      } else if (t === 'add_item') {
        const c = findCat(cats, a.category)
        if (c) { const tax = ['未稅', '含稅', '免稅'].includes(a.taxType) ? a.taxType : '未稅'; const it = { id: 'i-' + bid(''), name: a.name || '新細項', qty: Number(a.qty) || 1, unit: a.unit || '式', unitPrice: Math.round(Number(a.unitPrice) || 0), taxType: tax, labor: 0, laborDays: 0, dailyWage: 0, assignee: a.assignee || '', status: normStatus(a.status) || 'pending', receipts: [], notes: a.notes || '', chat: [], done: false }; (c.items || (c.items = [])).push(it); changed.add('pm_data'); results.push(`➕ 「${c.name}」新增細項「${it.name}」`); audits.push(['pm_activity', '新增', `「${c.name}」新增細項「${it.name}」`]) } else results.push(`⚠️ 找不到大項「${a.category}」`)
      } else if (t === 'set_item' || t === 'set_item_status') {
        const c = findCat(cats, a.category), it = c && findItem(c, a.item || a.itemName)
        if (c && it) { const chg = []; if (a.qty != null) { it.qty = Number(a.qty); chg.push('數量') } if (a.unitPrice != null) { it.unitPrice = Math.round(Number(a.unitPrice)); chg.push('單價') } if (a.unit != null) { it.unit = a.unit; chg.push('單位') } if (a.assignee != null) { it.assignee = a.assignee; chg.push('廠商') } if (a.status != null) { const s = normStatus(a.status); if (s) { it.status = s; chg.push('狀態' + STATUS_LABEL[s]) } } it.lastUpdated = new Date().toISOString(); changed.add('pm_data'); results.push(`✏️ 「${c.name}／${it.name}」：${chg.join('、') || '無變更'}`); audits.push(['pm_activity', '編輯', `改「${c.name}／${it.name}」${chg.join('、')}`]) } else results.push(`⚠️ 找不到細項「${a.item || a.itemName}」`)
      } else if (t === 'delete_item') {
        const c = findCat(cats, a.category), it = c && findItem(c, a.item || a.itemName)
        if (c && it) { c.items = c.items.filter(x => x.id !== it.id); changed.add('pm_data'); results.push(`🗑️ 刪除「${c.name}／${it.name}」`); audits.push(['pm_activity', '刪除', `「${c.name}」刪除細項「${it.name}」`]) } else results.push(`⚠️ 找不到細項`)
      } else if (t === 'add_payment') {
        const c = findCat(cats, a.category)
        if (c) { const amt = Math.round(Number(a.amount) || 0); const it = (a.item || a.itemName) ? findItem(c, a.item || a.itemName) : null; (c.payments || (c.payments = [])).push({ id: 'pay-' + bid(''), date: a.date || today, amount: amt, category: a.kind || '其他', note: a.note || '', itemId: it ? it.id : null, receipts: [] }); changed.add('pm_data'); results.push(`💵 「${c.name}」新增付款 ${fmtNT(amt)}`); audits.push(['pm_activity', '編輯', `「${c.name}」新增付款 ${fmtNT(amt)}`]) } else results.push(`⚠️ 找不到大項「${a.category}」`)
      } else if (t === 'add_todo' || t === 'add_task') {
        // ToDo 已併入「任務中心」(pm_tasks)，所以寫到 tasks，App才看得到
        const title = a.desc || a.content || a.title || ''
        const tc = a.category ? findCat(cats, a.category) : null
        const newId = 't-' + bid('')
        // Task v2 選填欄位：只納入 Bot 有提供的 key，經 normalizePatch（trim/去重/循環防護/estimate驗證）
        const extra = {}
        if (a.owner !== undefined) extra.owner = a.owner
        if (a.waitingFor !== undefined) extra.waitingFor = a.waitingFor
        if (a.estimatedMinutes !== undefined) extra.estimatedMinutes = a.estimatedMinutes
        if (a.dependsOn !== undefined) extra.dependsOn = resolveDeps(a.dependsOn, tasks)
        if (a.pinned !== undefined) extra.pinned = a.pinned
        const np = normalizePatch(extra, newId, tasks)
        tasks = [{ id: newId, title, note: '', status: 'todo', catId: tc ? tc.id : '__inbox__', start: '', due: a.due || '', priority: TASK_PRIO[a.priority] || (a.urgent ? 'urgent' : 'normal'), tags: Array.isArray(a.tags) ? normalizePatch({ tags: a.tags }).tags : [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...np }, ...tasks]
        changed.add('pm_tasks'); results.push(`📝 新增任務「${title.slice(0, 20)}」${tc ? '→' + tc.name : ''}`); audits.push(['pm_activity', '新增', `新增任務「${title.slice(0, 20)}」`])
      } else if (t === 'update_task') {
        // Merge Rule：只帶要改的欄位；沒帶的完全不動（{...existing, ...patch}）
        const target = findTask(tasks, a.task || a.title)
        if (!target) { results.push(`⚠️ 找不到任務「${a.task || a.title || '?'}」`) }
        else {
          const patch = {}
          if (a.newTitle != null && String(a.newTitle).trim()) patch.title = String(a.newTitle).trim()
          if (a.note !== undefined) patch.note = a.note || ''
          if (a.status != null && TASK_STATUS[String(a.status).trim()]) patch.status = TASK_STATUS[String(a.status).trim()]
          if (a.due !== undefined) patch.due = a.due || ''
          if (a.start !== undefined) patch.start = a.start || ''
          if (a.priority != null && TASK_PRIO[String(a.priority).trim()]) patch.priority = TASK_PRIO[String(a.priority).trim()]
          if (a.category != null) { const c = findCat(cats, a.category); if (c) patch.catId = c.id }
          if (a.owner !== undefined) patch.owner = a.owner
          if (a.waitingFor !== undefined) patch.waitingFor = a.waitingFor
          if (a.estimatedMinutes !== undefined) patch.estimatedMinutes = a.estimatedMinutes
          if (a.dependsOn !== undefined) patch.dependsOn = resolveDeps(a.dependsOn, tasks)
          if (a.pinned !== undefined) patch.pinned = a.pinned
          if (a.tags !== undefined) patch.tags = Array.isArray(a.tags) ? a.tags : []
          tasks = tasks.map(x => x.id === target.id ? mergeTask(x, patch, tasks) : x)
          changed.add('pm_tasks')
          const what = Object.keys(patch).join('、') || '（無變更）'
          results.push(`✏️ 更新任務「${target.title.slice(0, 20)}」：${what}`)
          audits.push(['pm_activity', '編輯', `更新任務「${target.title.slice(0, 20)}」(${what})`])
        }
      } else if (t === 'add_conclusion') {
        const cc = a.category ? findCat(cats, a.category) : null
        const e = { id: 'cc-' + bid(''), topic: a.topic || a.title || '(未命名)', conclusion: a.conclusion || a.text || a.content || '', reason: a.reason || '', decidedBy: operator, date: a.date || today, catId: cc ? cc.id : '__none__', tags: Array.isArray(a.tags) ? a.tags : [], status: 'current', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), by }
        conclusions = [e, ...conclusions]; changed.add('pm_conclusions'); results.push(`📌 新增結論「${e.topic.slice(0, 24)}」：${(e.conclusion || '').slice(0, 30)}`); audits.push(['pm_activity', '新增', `新增結論「${e.topic.slice(0, 24)}」`])
      } else if (t === 'add_petty_spend') {
        const c = a.category ? findCat(cats, a.category) : null; const content = a.content || a.note || ''; petty.spends = [...petty.spends, { id: 's' + bid(''), date: a.date || today, content, amount: Math.round(Number(a.amount) || 0), catId: c ? c.id : '__misc__' }]; changed.add('pm_petty'); results.push(`🪙 記零用金花費 ${fmtNT(a.amount)}「${content}」`); audits.push(['pm_activity', '新增', `記零用金花費「${content}」${fmtNT(a.amount)}`])
      } else if (t === 'add_finance_tx') {
        const kind = ['expense', 'income', 'transfer'].includes(a.kind) ? a.kind : (/收/.test(a.kind || '') ? 'income' : /轉/.test(a.kind || '') ? 'transfer' : 'expense')
        const acc = a.account ? (accounts.find(x => x.name === a.account) || accounts.find(x => x.name && x.name.includes(a.account))) : accounts[0]
        const aid = acc ? acc.id : ''; const toAcc = a.toAccount ? (accounts.find(x => x.name === a.toAccount) || accounts.find(x => x.name && x.name.includes(a.toAccount))) : null
        ledger = [{ id: 'tx' + bid(''), date: a.date || today, kind, amount: Math.round(Number(a.amount) || 0), from: kind === 'income' ? '' : aid, to: kind === 'income' ? aid : (toAcc ? toAcc.id : ''), category: a.category || '', vendor: a.vendor || '', invoiceNo: '', note: a.note || '', receipts: [] }, ...ledger]; changed.add('sp_finance_pm_fin_ledger'); results.push(`💰 記財務${kind === 'income' ? '收入' : kind === 'transfer' ? '轉帳' : '支出'} ${fmtNT(a.amount)}`); audits.push(['sp_finance_pm_activity', '新增', `記財務${kind === 'income' ? '收入' : kind === 'transfer' ? '轉帳' : '支出'} ${fmtNT(a.amount)}${a.vendor ? `（${a.vendor}）` : ''}`])
      } else if (t === 'add_log') {
        worklog = [{ id: 'wl-' + bid(''), date: a.date || today, content: a.content || '', author: by, ts: new Date().toISOString() }, ...worklog]; changed.add('pm_worklog'); results.push(`📓 新增工作日誌`); audits.push(['pm_activity', '新增', '新增工作日誌'])
      } else results.push(`⚠️ 不支援的操作：${t}`)
    } catch (e) { results.push(`⚠️ 執行「${t}」失敗`) }
  }
  const saveMap = { pm_data: cats, pm_worklog: worklog, pm_petty: petty, pm_issues: issues, pm_conclusions: conclusions }
  for (const k of changed) if (saveMap[k] !== undefined) await kvSet(k, saveMap[k])
  // 任務/交易明細：已遷移逐筆存＝只寫動到的那幾筆；還沒遷移＝照舊整包寫
  if (changed.has('pm_tasks')) { if (tR.v2) await kvSaveRecordsDiff('pm_task_', tasks0, tasks, true); else await kvSet('pm_tasks', tasks) }
  if (changed.has('sp_finance_pm_fin_ledger')) { if (lR.v2) await kvSaveRecordsDiff('sp_finance_pm_fin_tx_', ledger0, ledger, false); else await kvSet('sp_finance_pm_fin_ledger', ledger) }
  for (const [key, action, detail] of audits) await appendActivity(key, by, action, detail)
  return results
}

// 操作者白名單 / 待確認操作（都存在 pm_documents）
// 注意：用 pm_bot_confirm（不要用舊的 pm_bot_pending，那是舊 bot 留下的「陣列」，
//       把字串 key 塞進陣列再 JSON.stringify 會被丟掉 → pending 存不進去 → 確認失效）。
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
async function getOperators() { return asObj((await kvGetMany(['pm_bot_operators']))['pm_bot_operators']) }
async function addOperator(userId, name) { const ops = await getOperators(); ops[userId] = { name: name || '操作者', ts: new Date().toISOString() }; await kvSet('pm_bot_operators', ops); return ops[userId] }
async function getPending(userId) { const all = asObj((await kvGetMany(['pm_bot_confirm']))['pm_bot_confirm']); const p = all[userId]; if (!p) return null; if (Date.now() - new Date(p.ts).getTime() > 10 * 60000) return null; return p }
async function setPending(userId, val) { const all = asObj((await kvGetMany(['pm_bot_confirm']))['pm_bot_confirm']); if (val) all[userId] = val; else delete all[userId]; await kvSet('pm_bot_confirm', all) }
// ── 回收訊息監控：群訊息滾動快取，有人回收 → 私訊老闆（第一位授權操作者）──
async function cacheGroupMsg(ev) {
  try {
    const cache = asObj((await kvGetMany(['pm_bot_msgcache']))['pm_bot_msgcache'])
    const list = Array.isArray(cache.list) ? cache.list : []
    list.push({ id: ev.message.id, gid: ev.source?.groupId || ev.source?.roomId || '', uid: ev.source?.userId || '', text: (ev.message.text || '').slice(0, 300), ts: ev.timestamp || Date.now() })
    await kvSet('pm_bot_msgcache', { list: list.slice(-300) })
  } catch (_) {}
}
async function handleUnsend(ev) {
  try {
    const mid = ev.unsend?.messageId
    if (!mid) return
    const cache = asObj((await kvGetMany(['pm_bot_msgcache']))['pm_bot_msgcache'])
    const hit = (Array.isArray(cache.list) ? cache.list : []).find(m => m.id === mid)
    if (!hit) return // 沒快取到內容（圖/貼圖/較舊訊息）→ 不發「沒快取到」的空通知
    const st = asObj((await kvGetMany(['pm_settings']))['pm_settings']) // 尊重「暫停所有 LINE 通知」總開關
    if (st && st.lineNotify && st.lineNotify.pauseAll) return
    const ops = await getOperators()
    const boss = Object.keys(ops)[0]
    if (!boss || !TOKEN) return
    const gid = ev.source?.groupId || ev.source?.roomId || hit.gid || ''
    const groupsSeen = asObj((await kvGetMany(['pm_group_seen']))['pm_group_seen'])
    const gname = (groupsSeen[gid] && groupsSeen[gid].name) || '未知群'
    const uid = ev.source?.userId || hit.uid || ''
    const uname = uid ? (await getLineProfile(uid)) || uid.slice(-6) : '未知'
    const when = new Date(hit.ts).toLocaleString('zh-TW', { hour12: false })
    const textLine = `內容：「${hit.text}」${when ? `\n原發送：${when}` : ''}`
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ to: boss, messages: [{ type: 'text', text: `🕵️ 回收訊息通知\n群：${gname}\n誰：${uname}\n${textLine}` }] }),
    })
    try { const { logPush } = await import('./push.js'); await logPush(boss, 1, '回收訊息通知') } catch (_) {}
  } catch (_) {}
}
async function getLineProfile(userId) { try { const r = await fetch('https://api.line.me/v2/bot/profile/' + userId, { headers: { authorization: `Bearer ${TOKEN}` } }); if (r.ok) { const d = await r.json(); return d.displayName || '' } } catch (_) {} return '' }

// ── 對話記憶：每個對話(私訊userId或群組id)留最近幾輪，讓 D哥 記得前文、接得上 ──
async function getChatHistory(convId) {
  const all = asObj((await kvGetMany(['pm_bot_chats']))['pm_bot_chats'])
  const h = all[convId]
  return Array.isArray(h) ? h.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content).slice(-40) : []
}
async function pushChat(convId, userText, assistantText) {
  try {
    const all = asObj((await kvGetMany(['pm_bot_chats']))['pm_bot_chats'])
    const h = Array.isArray(all[convId]) ? all[convId] : []
    h.push({ role: 'user', content: String(userText || '').slice(0, 900) })
    h.push({ role: 'assistant', content: String(assistantText || '').slice(0, 1400) })
    all[convId] = h.slice(-40) // 每個對話留最近 20 輪
    const keys = Object.keys(all)
    if (keys.length > 40) for (const k of keys.slice(0, keys.length - 40)) delete all[k] // 最多 40 個對話
    await kvSet('pm_bot_chats', all)
  } catch (_) {}
}

// ── D哥的長期記事本（pm_bot_memory）：永久記得的事實，每次對話都先翻一遍 ──
async function getMemory() { const v = (await kvGetMany(['pm_bot_memory']))['pm_bot_memory']; return Array.isArray(v) ? v : [] }
async function addMemory(text, source, by) {
  const t = String(text || '').trim().replace(/^[:：,，、\s]+/, ''); if (!t) return null
  const list = await getMemory()
  if (list.some(m => m.text === t)) return null // 一模一樣不重複
  const entry = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t.slice(0, 200), ts: new Date().toISOString(), source: source || 'manual', by: by || '' }
  list.push(entry); await kvSet('pm_bot_memory', list.slice(-100)); return entry // 最多 100 條
}
async function removeMemory(query) {
  const q = String(query || '').trim(); if (!q) return 0
  const list = await getMemory()
  const keep = list.filter(m => !(m.text.includes(q) || q.includes(m.text)))
  const removed = list.length - keep.length
  if (removed) await kvSet('pm_bot_memory', keep)
  return removed
}
const memoryToText = (list) => (list && list.length) ? '\n\n【D哥的長期記事本（永久記得，回答前優先參考）】\n' + list.map(m => '・' + m.text).join('\n') : ''
// 從 AI 回覆抓出 [[記住:...]] 標記，回傳 {facts:[...], clean:'去掉標記後的文字'}
function extractMemoryTags(reply) {
  const facts = []
  const clean = String(reply || '').replace(/\[\[記住[:：]?\s*([^\]]+)\]\]/g, (_, f) => { const t = f.trim(); if (t) facts.push(t); return '' }).replace(/\n{3,}/g, '\n\n').trim()
  return { facts, clean }
}

const BOT_AGENT_GUIDE = `
你除了回答問題，還能「直接操作」這個 App。當（且僅當）使用者明確要你「做某個操作」（新增/修改/刪除/記一筆/改狀態…）時，用一段 markdown json 區塊輸出指令；若只是問問題，就正常用文字回答、不要輸出 json。
\`\`\`json
{"actions":[ ... ]}
\`\`\`
可用指令：
- {"type":"add_task","desc":"買水泥3包","category":"消防工程","due":"2026-06-25","owner":"阿哲","waitingFor":"等木工","estimatedMinutes":15,"dependsOn":["確認交期"],"tags":["採購"]}  // 加任務到「任務中心」。owner=負責人、waitingFor=在等誰/什麼、estimatedMinutes=預估分鐘(正整數)、dependsOn=依賴的任務(填任務標題)。全部選填(可省略)；category省略→進收件匣。(「加待辦」也用這個)
- {"type":"update_task","task":"買水泥","status":"完成","owner":"阿哲","waitingFor":"","estimatedMinutes":30,"dependsOn":[],"pinned":true,"due":"2026-07-20","category":"消防工程","priority":"高","tags":["採購"],"note":"...","newTitle":"..."}  // 更新既有任務；task=用標題找。⚠️只帶「要改的欄位」，沒帶的欄位絕不要帶(會保留原值)；waitingFor 給 ""=清除等待、dependsOn 給 []=清空依賴。狀態:待辦/進行中/完成
- {"type":"add_conclusion","topic":"開幕日","conclusion":"8/10 開幕","reason":"","category":""}  // 加一條「公開結論」(團隊定案)；topic=主題、conclusion=定案內容
- {"type":"add_log","content":"今天水電進場拉管線","date":"2026-06-22"}  // 工作日誌；date 可省略(預設今天)
- {"type":"add_petty_spend","amount":390,"content":"工人便當","category":"水電工程"}  // 記零用金花費；category 是歸到哪個工種(可省略)
- {"type":"add_finance_tx","kind":"expense","amount":12000,"account":"合庫","category":"物料","vendor":"震旦","note":"買桌椅"}  // 財務內帳；kind=expense支出/income收入/transfer轉帳；account=帳戶名
- {"type":"set_category_status","category":"消防工程","status":"完工"}  // 狀態：待開工/進行中/完工/有問題/暫停
- {"type":"set_item","category":"消防工程","item":"灑水頭","status":"完工","unitPrice":1200,"qty":10,"assignee":"王師傅"}  // 改細項；欄位都可省略
- {"type":"add_category","name":"空調工程","budget":300000}
- {"type":"add_item","category":"空調工程","name":"主機","qty":1,"unit":"式","unitPrice":150000,"taxType":"未稅"}
- {"type":"delete_item","category":"空調工程","item":"主機"}
- {"type":"add_payment","category":"消防工程","amount":63000,"date":"2026-06-22","note":"訂金"}  // 大項新增一筆付款
數字只放阿拉伯數字、不要逗號或「元」。一次可放多個指令。`

const TRIGGERS = ['d哥', 'D哥', '進度', '多少', '還欠', '未付', '已付', '付款', '總額', '預算', '餘額', '報告', '速報', '幾天', '完工', '零用金']
const triggered = (text) => /[?？]\s*$/.test(text) || TRIGGERS.some((k) => text.includes(k))

export default async function handler(req, res) {
  // 診斷探針（唯讀）：/api/line-webhook?probe=crew → 回 D 實際拿到的夥伴中心文字開頭
  if (req.method === 'GET' && req.query?.probe === 'crew') {
    const t = (await loadCrewText()) + (await loadShiftText())
    return res.status(200).json({ len: t.length, head: t.slice(0, 800), shiftHead: t.includes('【排班系統') ? t.slice(t.indexOf('【排班系統'), t.indexOf('【排班系統') + 600) : '（無排班段落）' })
  }
  if (req.method !== 'POST') return res.status(405).end()
  const raw = await readRaw(req)
  let body = {}, sigOK = null
  if (raw && raw.length) {
    if (SECRET) {
      const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('base64')
      sigOK = sig === (req.headers['x-line-signature'] || '')
    }
    try { body = JSON.parse(raw.toString('utf8') || '{}') } catch (_) {}
  } else if (req.body) {
    body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body) } catch (_) { return {} } })() : req.body
  }
  // 診斷用 log（之後 strict 模式會用 sigOK 擋）。暫時：不論驗章結果都處理，先確認 D 會回。
  console.log('LINE webhook hit', JSON.stringify({ rawLen: raw?.length || 0, sigPresent: !!req.headers['x-line-signature'], sigOK, events: (body.events || []).length, secretSet: !!SECRET, tokenSet: !!TOKEN }))
  const events = body.events || []
  if (!events.length) return res.status(200).json({ ok: true }) // LINE 驗證請求等

  // 重要：serverless 一旦 res 回應就會凍結，後面的 await 不會跑完 → 必須「先處理完(含回覆)再回 200」。
  for (const ev of events) {
    try {
      // 防重複：LINE 在我們回應慢時會「重送」同一批事件，redelivery 標記為 true → 直接跳過，避免同一則通知/回覆重複
      if (ev.deliveryContext?.isRedelivery) { console.log('skip redelivery', ev.webhookEventId || ''); continue }
      // 回收訊息 → 私訊老闆（誰在哪個群回收了什麼）
      if (ev.type === 'unsend') { await handleUnsend(ev); continue }
      // 互動卡片按鈕（postback）：回饋/投票/文件歸類（只在私訊）
      if (ev.type === 'postback' && ev.source?.type === 'user') {
        try { await handleDDCards(ev, await getOperators()) } catch (e) { console.log('ddcards postback error', e?.message) }
        continue
      }
      // 報到/登入（只在私訊）：「王小明報到」直接開帳號發登入連結（固定格式、不經 AI）；資料改在 App 名冊卡填
      if (ev.type === 'message' && ev.source?.type === 'user') {
        try { if (await handleOnboardEvent(ev)) continue } catch (e) { console.log('onboard error', e?.message) }
        // 回饋/投票/照片歸檔/推播指令（固定指令與圖片，不經 AI）
        try { if (await handleDDCards(ev, await getOperators())) continue } catch (e) { console.log('ddcards error', e?.message) }
      }
      // D哥 檔案庫：記下剛傳的檔案參考（私訊操作者 or 任何群組），等「存到檔案庫」指令再抓進檔案庫
      if (ev.type === 'message' && (ev.message?.type === 'file' || ev.message?.type === 'image')) {
        try {
          const uid2 = ev.source?.userId || ''
          const isDM2 = ev.source?.type === 'user'
          const cid = isDM2 ? ('dm_' + uid2) : ('g_' + (ev.source?.groupId || ev.source?.roomId || uid2))
          if (!isDM2 || (await getOperators())[uid2]) await stashLibraryFile(ev, cid) // 私訊只幫操作者記；群組都記
        } catch (e) { console.log('filelib stash error', e?.message) }
        continue
      }
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue
      // 群組文字訊息先快取（回收監控用；私訊不快取）
      if (ev.source?.type !== 'user') await cacheGroupMsg(ev)
      const gid = ev.source?.groupId || ev.source?.roomId || ev.source?.userId
      // 只登記「群組/聊天室」到群組頁；私訊(user)不是群，登記進去會在群組頁出現「未命名群」
      if (ev.source?.type !== 'user') await registerGroup(gid, ev.source?.type)
      const text = (ev.message.text || '').trim()
      const isDM = ev.source?.type === 'user' // 一對一私訊
      // 只在「真的被 @到本帳號」(排除 @All/@他人) 或「明確叫到 D哥」時才回。
      // 移除舊的 /@d/：它會誤中別人的 @Doris、@David… 導致 D 插嘴。
      const mentionees = ev.message?.mention?.mentionees || []
      const mentionedSelf = mentionees.some((m) => m.isSelf === true && m.type !== 'all')
      // 叫名字：新名 DD（要獨立字，避免 add/odd 誤觸）或舊名 D哥 都算
      const named = mentionedSelf || /d哥/i.test(text) || /(^|[^a-z0-9])dd([^a-z0-9]|$)/i.test(text)
      console.log('event', JSON.stringify({ src: ev.source?.type, isDM, named, mSelf: mentionedSelf, text: text.slice(0, 40) }))
      if (!isDM && !named) continue // 私訊一律回；群組必須被點名（@本帳號 或 講「D哥」）
      const userId = ev.source?.userId || ''
      const convId = isDM ? ('dm_' + userId) : ('g_' + gid) // 對話記憶的識別
      const send = (t) => ev.replyToken ? lineReply(ev.replyToken, t) : Promise.resolve()
      // finish＝回覆＋把這輪存進對話記憶（讓 D哥 記得前文）；授權訊息不用 finish(含密碼，不留紀錄)
      const finish = async (t) => { await send(t); await pushChat(convId, text, t) }

      // ── 動作引擎（只在「私訊」進行，群組一律唯讀，較安全）──
      // 1) 授權：私訊「授權:碼」→ 列入操作者白名單
      const mAuth = text.match(/^授權[\s:：]*([^\s]+)/)
      if (isDM && mAuth) {
        if (!OP_CODE) { await send('（系統尚未設定操作密碼 BOT_OP_CODE，目前無法授權操作。請先在 Vercel 設定。）'); continue }
        if (mAuth[1] === OP_CODE) { const name = await getLineProfile(userId); const op = await addOperator(userId, name); await send(`✅ 已授權「${op.name}」為操作者，之後可以直接用對話叫我新增/修改資料（執行前我都會先問你確認）。`) }
        else await send('❌ 授權碼不對。')
        continue
      }
      const operators = await getOperators()
      const op = isDM ? operators[userId] : null
      const canAct = !!op

      // 1.4) 檔案庫（私訊操作者 or 被叫名字的群組都能用）：一句話可同時「新增類別／查有哪些類別／把剛傳的檔存進去」
      if ((isDM ? canAct : true) && /檔案庫|相簿/.test(text)) {
        // 新增類別（可多個）：兩種語序都接——「新增〔名〕類別」與「新增類別〔名〕」
        const creates = [...new Set([
          ...[...text.matchAll(/(?:新增|加|建|開)\s*(?:一個)?\s*[「『]?\s*([^「」『』\s，,、。？?！!的]{1,12}?)\s*[」』]?\s*(?:類別|資料夾|夾)/g)].map(m => m[1]),
          ...[...text.matchAll(/(?:新增|加|建|開)\s*(?:一個)?\s*(?:類別|資料夾|夾)\s*[「『]?\s*([^「」『』\s，,、。？?！!]{1,12})/g)].map(m => m[1]),
        ].map(s => (s || '').trim()).filter(s => s && !/^(類別|資料夾|夾)$/.test(s)))]
        const wantSave = /(存|放|上傳|收|歸)\S{0,6}(檔案庫|相簿)|(檔案庫|相簿)\S{0,6}(存|放|收|歸)/.test(text)
        const wantQuery = /(有沒有|有哪些|有什麼|哪些類別|什麼類別|類別.{0,3}嗎|有.{1,12}類別)/.test(text)
        if (creates.length || wantSave || wantQuery) {
          const parts = []
          for (const nm of creates) await ensureFolder(nm)
          if (creates.length) parts.push(`✅ 已新增類別：${creates.map(n => `「${n}」`).join('、')}。`)
          if (wantSave) {
            const label = creates[0] || ((text.split(/檔案庫|相簿/)[1] || '')
              .replace(/類別|資料夾|夾|開.{0,2}|新增|加|存到?|存進?|放到?|放進?|上傳到?|收到?|收進?|歸到?|一下|把|剛剛的?|這些?|那些?|請|幫我|裡面|儲存在?/g, '')
              .replace(/[，,、。\s「」『』:：]/g, '').trim())
            const byName = isDM ? op.name : ((await getLineProfile(userId)) || '群組成員')
            const out = await saveCachedFilesToLibrary(label, byName, convId)
            parts.push(out.ok
              ? `✅ 已把 ${out.count} 個檔案存進「${out.label}」${out.failed && out.failed.length ? `（有 ${out.failed.length} 個抓不到，可能過期）` : ''}。`
              : out.msg)
          }
          const cur = await listFolders()
          parts.push(`📁 目前檔案庫自訂類別：${cur.length ? cur.join('、') : '（還沒有）'}（另有固定類別：估價單／現場照／發票／其他）。到 App 檔案庫頁上方「類別📁」可篩選/分組。`)
          await finish(parts.join('\n'))
          continue
        }
      }

      // 1.5) 長期記事本指令（操作者私訊）：記住 / 忘記 / 看記事本
      if (isDM && canAct) {
        if (/^(你記得(哪些|什麼|多少|啥)|你記住了(什麼|哪些|啥)?|你的?(記事本|長期記憶)|看記事本|記事本$)/.test(text)) {
          const list = await getMemory()
          await finish(list.length ? '🧠 我目前記得這些：\n' + list.map((m, i) => `${i + 1}. ${m.text}`).join('\n') + '\n\n（要忘掉就跟我說「忘記 …」）' : '我的記事本還是空的。你可以跟我說「記住：…」開始建立，或我在聊天中遇到重要的事也會自動記下來。')
          continue
        }
        const mForget = text.match(/^(忘記|忘掉|別記|不要記了?|刪(除|掉)記憶)[\s:：,，、]*(.+)/s)
        if (mForget && (mForget[3] || '').trim()) { const n = await removeMemory(mForget[3]); await finish(n ? `好，忘掉了 ${n} 條相關的記憶。` : '記事本裡沒找到相關的，沒有刪到東西。'); continue }
        const mRemember = text.match(/^(記住|幫我記住?|幫我記一下|記一下|記個|備註一下?)[\s:：,，、]*(.+)/s)
        if (mRemember && (mRemember[2] || '').trim()) { const e = await addMemory(mRemember[2], 'manual', op.name); await finish(e ? `好 👍 我記住了：「${e.text}」` : '這件我已經記過囉。'); continue }
      }

      // 1.6) 密碼庫（只限授權操作者私訊；固定指令、不經 AI、不進對話記憶）
      if (isDM && canAct && /密碼/.test(text)) {
        if (!VKEY) { if (/^(記|查|看|刪)密碼|^密碼清單/.test(text)) { await send('（密碼庫加密金鑰 BOT_VAULT_KEY 還沒設定，請叫 Claude 設好。）'); continue } }
        else {
          const mAdd = text.match(/^記密碼[\s:：]+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.+))?$/s)
          if (mAdd) {
            const items = await getBotVault()
            const it = { id: 'pw' + Date.now(), name: mAdd[1], acc: vEnc(mAdd[2]), pwd: vEnc(mAdd[3]), note: mAdd[4] || '', ts: new Date().toISOString(), by: op.name }
            await saveBotVault([it, ...items.filter(x => x.name !== mAdd[1])])
            await send(`🔐 已存「${mAdd[1]}」（帳號密碼已加密入庫）。查詢：「查密碼 ${mAdd[1]}」`)
            continue
          }
          const mGet = text.match(/^(查|看)密碼[\s:：]*(.*)$/)
          if (mGet) {
            const kw = (mGet[2] || '').trim()
            const items = await getBotVault()
            const hits = kw ? items.filter(x => (x.name + ' ' + (x.note || '')).toLowerCase().includes(kw.toLowerCase())) : items
            if (!hits.length) await send(items.length ? `找不到「${kw}」。目前有：${items.map(x => x.name).join('、')}` : '密碼庫是空的。新增：「記密碼 名稱 帳號 密碼 [備註]」')
            else await send('🔐 ' + hits.slice(0, 5).map(x => `${x.name}\n帳號：${vDec(x.acc)}\n密碼：${vDec(x.pwd)}${x.note ? '\n備註：' + x.note : ''}`).join('\n──────\n') + '\n\n（只有授權者私訊查得到）')
            continue
          }
          if (/^密碼清單$/.test(text)) { const items = await getBotVault(); await send(items.length ? '🔐 密碼庫（' + items.length + ' 筆）：\n' + items.map(x => '・' + x.name + (x.note ? `（${x.note}）` : '')).join('\n') : '密碼庫是空的。新增：「記密碼 名稱 帳號 密碼 [備註]」'); continue }
          const mDel = text.match(/^刪密碼[\s:：]+(\S+)$/)
          if (mDel) { const items = await getBotVault(); const left = items.filter(x => x.name !== mDel[1]); await saveBotVault(left); await send(left.length < items.length ? `🗑 已刪除「${mDel[1]}」。` : `沒有「${mDel[1]}」這筆。`); continue }
        }
      }

      // 2) 確認 / 取消 待執行的操作（用詞放寬：確認/確定/執行/請執行/好/送出…都算確認）
      if (isDM && canAct) {
        const pend = await getPending(userId)
        if (pend) {
          const isConfirm = /^(請?(確認|確定|執行|送出)|好(的|啊)?|對|是|沒問題|ok|okay|yes|y|go)\s*$/i.test(text)
          const isCancel = /^(取消|不要|不用|算了|放棄|no|n|cancel)\s*$/i.test(text)
          if (isConfirm) {
            const results = await executeActions(pend.actions, op.name)
            await setPending(userId, null)
            await finish('✅ 搞定！\n' + results.join('\n'))
            continue
          }
          if (isCancel) { await setPending(userId, null); await finish('好，取消了，沒有做任何更動。'); continue }
          // 其它訊息 → 視為改主意/新需求，往下重新解析（會覆蓋舊的待確認）
        }
      }

      // 金額/財務權限：私訊(操作者)可看；群組只有「內部群(預設群) 或 設定 money:true」才可看金額，外部群一律擋
      let moneyOK = true
      if (!isDM) {
        const gcfg = asObj((await kvGetMany(['pm_bot_groups']))['pm_bot_groups'])
        moneyOK = (gid === 'Cf7940efc6517b0c084ad2ad496b45f30') || (gcfg[gid] && gcfg[gid].money === true)
      }
      // 3) 一般流程：載入資料＋對話記憶＋長期記事本 → 問 AI（操作者才開放下指令）
      const [snaps, accountsText, financeText, activityText, estimatesText, crewText, history, memList, conclusionsText, tasksText, sheetText, posText, catalogText, supplyText, lineQuotaText, filelibText] = await Promise.all([loadSnapshots(), loadAccounts(), loadFinanceText(), loadActivityText(), loadEstimatesText(), Promise.all([loadCrewText(), loadShiftText(), loadPunchText()]).then(([a, b, c]) => a + b + c), getChatHistory(convId), getMemory(), loadConclusionsText(), loadTasksText(), loadSheetText(), loadPosText(), loadCatalogText(), loadSupplyText(), loadLineQuotaText(), loadFilelibText()])
      const rawReply = await answer(text, snaps, accountsText, financeText, activityText, estimatesText, crewText, canAct, history, memoryToText(memList), conclusionsText, tasksText, sheetText, posText, catalogText, supplyText, lineQuotaText, filelibText, moneyOK)
      // 抓出 D 想長期記住的事（[[記住:...]]）→ 存進記事本(僅操作者)，並把標記從給人看的文字拿掉
      const { facts, clean } = extractMemoryTags(rawReply)
      if (canAct && facts.length) { for (const f of facts) await addMemory(f, 'auto', op?.name) }
      const reply = clean || rawReply
      const actions = canAct ? parseActions(reply) : []
      console.log('answer', JSON.stringify({ snaps: snaps.length, canAct, hist: history.length, mem: memList.length, autoFacts: facts.length, actions: actions.length, replyLen: reply.length }))

      if (actions.length) {
        // 4) 提出操作 → 存待確認 → 請使用者回「確認」
        // 不放 AI 的 prose（它常會誤寫「已幫你記錄」其實還沒做）；只給明確的待執行清單。
        await setPending(userId, { actions, ts: new Date().toISOString() })
        const list = actions.map((a, i) => `${i + 1}. ${describeAction(a)}`).join('\n')
        const proposeMsg = `🛠 要執行以下操作（還沒做，等你確認）：\n${list}\n\n回「確認」執行、「取消」放棄。`
        await finish(proposeMsg)
      } else {
        await finish(reply)
      }
    } catch (e) { console.log('event error', e?.message) }
  }
  return res.status(200).json({ ok: true })
}
