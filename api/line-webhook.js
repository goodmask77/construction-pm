// 後端：LINE Webhook（D哥）。收群組訊息 → 登記群、回答問題（以 pm_bot_context 唯一真相快照為依據）。
// 2026-08-28 DD變聰明版：純記錄免確認直接執行、prose不再被丟掉（多件事都回）、記憶30輪、讀得到自己記的工作日誌、prompt caching。
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
import { handleDDCards, handleJournalText, attachJournalPhotos, buildConfirmCard, buildTaskCards, buildTaskSetupCards } from './_ddcards.js'
import { inlineLogin, inlineSearchKeyword, inlineCustomer } from './_inline.js'
import { ddEventOnce, ddHealthLog } from './_ddhealth.js' // v4.70.39 DD 穩定化批次 1a：事件去重＋健康紀錄（docs/COMMS_PLAN.md 項目 1） // 訂位關鍵字代查＋客人檔官方統計（張良 2026-10-03）

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SECRET = clean(process.env.LINE_CHANNEL_SECRET)
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const SIG_STRICT = (process.env.LINE_SIG_STRICT || '').trim() === '1' // v4.70.39：=1 才真的拒絕驗簽失敗；先觀察健康頁「驗簽失敗」歸零再開
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
// v4.70.40 單鍵讀取（原本沒有這個函式：loadEmText 從 v4.43.7 起呼叫 kvGet 一直 ReferenceError 被 try 吞掉＝DD 從沒看過 EM 包場資料；query_orders 也用）
async function kvGet(id) { return (await kvGetMany([id]))[id] || null }
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
// 刪一筆文件（跨空間刪任務用；App 端刪除也是直接 DELETE 該列，同一套行為）
async function kvDel(id) {
  if (!SB_URL || !SB_KEY) return
  try { await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: sbHeaders }) } catch (_) {}
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

// ── 🗂 通用文件庫 v4.70.0（張良「資料庫像雲端硬碟＋DD上傳歸檔＋DD撈檔傳群」）──
// 資料 KV sp_finance_pm_library，實體檔進私有桶 ground-private。權限：資料夾 acl 角色預設＋個人覆蓋；等級 0看不到/1只能看/2可編。
const LIBRARY_KEY = 'sp_finance_pm_library'
// lineUserId → { name, rid, role, mgr }（走 prep 綁定＋名冊 gdRole；mgr=主管/審核人approver/張良＝可管理＋可撈檔）
async function libWhoByLine(userId) {
  const kv = await kvGetMany(['sp_finance_pm_prep_bind', 'sp_finance_pm_sop_def', 'sp_crew_kb_roster'])
  const bind = kv['sp_finance_pm_prep_bind'] || {}
  const tk = (bind.byUid || {})[userId]
  const w = tk ? (bind.tokens || {})[tk] : null
  if (!w || !w.name) return null
  const apr = (((kv['sp_finance_pm_sop_def'] || {}).ground || {}).approvers || ['張良瑋'])
  const role = ((((kv['sp_crew_kb_roster'] || {}).people) || []).find(p => p.name === w.name) || {}).gdRole || '一般'
  const mgr = apr.includes(w.name) || w.name === '張良瑋' || role === '主管'
  return { name: w.name, rid: w.rid || w.uid, role, mgr }
}
function libLevelOf(who, folder) {
  if (!who) return 0
  if (who.mgr) return 2
  const acl = folder.acl || {}
  if ((acl.users || {})[who.rid] != null) return acl.users[who.rid]
  if ((acl.roles || {})[who.role] != null) return acl.roles[who.role]
  return (acl.roles || {})['一般'] != null ? acl.roles['一般'] : 1
}
function libFindFolder(lib, name) {
  const n = String(name || '').trim().toLowerCase(); if (!n) return null
  const fs = lib.folders || []
  return fs.find(f => f.name.toLowerCase() === n) || fs.find(f => f.name.toLowerCase().includes(n) || n.includes(f.name.toLowerCase())) || null
}
// 把 stash 的檔案（使用者剛傳、同一對話）存進 library 指定資料夾（who 需該夾 level>=2）
async function saveCachedToLibrary(folderName, who, convId) {
  const lib = (await kvGetMany([LIBRARY_KEY]))[LIBRARY_KEY] || { folders: [], files: {} }
  lib.folders = lib.folders || []; lib.files = lib.files || {}
  const folder = libFindFolder(lib, folderName)
  if (!folder) {
    const can = lib.folders.filter(f => libLevelOf(who, f) >= 2).map(f => f.name)
    return { ok: false, msg: `找不到資料夾「${folderName || '（沒講清楚）'}」。${can.length ? '你可以存進：' + can.join('、') : '你目前沒有可上傳的資料夾，請主管在 App 文件庫開一個或給你權限。'}` }
  }
  if (libLevelOf(who, folder) < 2) return { ok: false, msg: `你沒有「${folder.name}」的上傳權限 🙏` }
  const cache = (await kvGetMany([FILECACHE_KEY]))[FILECACHE_KEY]
  const all = (cache && Array.isArray(cache.list)) ? cache.list : []
  const now = Date.now()
  const mine = all.filter(f => f && f.ts && (now - new Date(f.ts).getTime()) < 60 * 60 * 1000 && (!convId || f.convId === convId))
  if (!mine.length) return { ok: false, msg: `找不到剛剛傳的檔案（超過 60 分鐘會清掉）。請重新傳一次，傳完馬上說「存到文件庫 ${folder.name}」。` }
  const { uploadPrivate } = await import('./_onboard.js')
  lib.files[folder.id] = lib.files[folder.id] || []
  const names = [], failed = []
  for (const f of mine) {
    try {
      const r = await fetch(`https://api-data.line.me/v2/bot/message/${f.mid}/content`, { headers: { authorization: `Bearer ${TOKEN}` } })
      if (!r.ok) { failed.push(f.name); continue }
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 20 * 1024 * 1024) { failed.push(f.name + '(超過20MB)'); continue }
      const ct = r.headers.get('content-type') || (f.isImage ? 'image/jpeg' : 'application/octet-stream')
      const ext = f.isImage ? (/png/.test(ct) ? 'png' : 'jpg') : ((String(f.name).split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin')
      const fid = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const path = `library/${folder.id}/${fid}.${ext}`
      if (!(await uploadPrivate(path, buf, ct))) { failed.push(f.name); continue }
      const maxo = Math.max(0, ...lib.files[folder.id].map(x => x.order || 0))
      const ts = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
      lib.files[folder.id].push({ id: fid, name: f.name, path, ext, mime: ct, size: buf.length, ts, by: who.name + '(LINE)', order: maxo + 1 })
      names.push(f.name)
    } catch (_) { failed.push(f.name) }
  }
  if (!names.length) return { ok: false, msg: '檔案抓取失敗（可能超過 LINE 下載期限），請重新傳一次。' }
  lib.log = [{ by: who.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: `DD存 ${names.length}檔→${folder.name}` }, ...(lib.log || [])].slice(0, 100)
  lib.updatedAt = new Date().toISOString()
  await kvSet(LIBRARY_KEY, lib)
  const rest = all.filter(f => !mine.some(m => m.mid === f.mid))
  await kvSet(FILECACHE_KEY, { list: rest })
  return { ok: true, folder: folder.name, count: names.length, names, failed }
}
// DD 把 library 檔案撈出傳到群/私訊（who 需 mgr；資料夾需 level>=1 且非 noExport；圖片推 image，其他推簽名連結）
async function pushLibraryFile(folderName, fileKw, who, to) {
  if (!who || !who.mgr) return { ok: false, msg: '撈檔傳送只開放主管使用 🙏' }
  const lib = (await kvGetMany([LIBRARY_KEY]))[LIBRARY_KEY] || { folders: [], files: {} }
  const folder = libFindFolder(lib, folderName)
  if (!folder) return { ok: false, msg: `找不到資料夾「${folderName}」。` }
  if (folder.acl && folder.acl.noExport) return { ok: false, msg: `「${folder.name}」被標記為「禁止外傳」，不能撈到群。要改請到 App 文件庫 → 該夾齒輪 → 權限設定。` }
  if (libLevelOf(who, folder) < 1) return { ok: false, msg: `你沒有「${folder.name}」的檢視權限 🙏` }
  const files = (lib.files || {})[folder.id] || []
  const kw = String(fileKw || '').trim().toLowerCase()
  const hits = kw ? files.filter(x => x.name.toLowerCase().includes(kw)) : files
  if (!hits.length) return { ok: false, msg: kw ? `「${folder.name}」裡找不到檔名含「${fileKw}」的檔案。` : `「${folder.name}」裡還沒有檔案。` }
  if (hits.length > 5) return { ok: false, msg: `符合的有 ${hits.length} 個，太多了——檔名講精確一點。前幾個：${hits.slice(0, 6).map(x => x.name).join('、')}` }
  const { signedUrl } = await import('./_onboard.js')
  const msgs = []
  for (const x of hits.slice(0, 5)) {
    const u = await signedUrl(x.path, 600)
    if (!u) continue
    const isImg = /^image\//.test(x.mime || '') || /\.(jpe?g|png|gif|webp)$/i.test(x.name)
    if (isImg) msgs.push({ type: 'image', originalContentUrl: u, previewImageUrl: u })
    else msgs.push({ type: 'text', text: `📄 ${x.name}（${folder.name}）\n下載（10分鐘內有效）：\n${u}` })
  }
  if (!msgs.length) return { ok: false, msg: '檔案連結產生失敗，稍後再試 🙏' }
  for (let i = 0; i < msgs.length; i += 5) {
    await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ to, messages: msgs.slice(i, i + 5) }) })
  }
  lib.log = [{ by: who.name, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: `DD撈 ${hits.length}檔 ${folder.name}→傳送` }, ...(lib.log || [])].slice(0, 100)
  await kvSet(LIBRARY_KEY, lib)
  return { ok: true, count: Math.min(hits.length, 5), folder: folder.name, names: hits.slice(0, 5).map(x => x.name) }
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
  // 群名沒記過就跟 LINE 要一次（群組訊息流/回收通知都要靠它顯示人看得懂的群名）
  let name = g.name || ''
  if (!name) {
    try { const r = await fetch(`https://api.line.me/v2/bot/group/${gid}/summary`, { headers: { authorization: `Bearer ${TOKEN}` } }); if (r.ok) name = (await r.json()).groupName || '' } catch (_) {}
  }
  cur[gid] = { ...g, ...(name ? { name } : {}), lastActive: new Date().toISOString(), count: (g.count || 0) + 1, src: src || g.src }
  delete cur[gid].gone // 有訊息進來＝DD 還在這個群（v4.70.38）
  await kvSet('pm_group_seen', cur)
}

// 📊 額度查詢（v4.41.1 張良「每次發訊息最下方顯示消耗幾則＋使用/總則數」）：LINE 官方口=本月已用/方案上限；60秒快取少打API
let _qC = { t: 0, used: -1, total: -1 }
async function lineQuota() {
  if (Date.now() - _qC.t < 60e3) return _qC
  try {
    const H9 = { authorization: `Bearer ${TOKEN}` }
    const [q9, c9] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers: H9 }).then(r => r.json()),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: H9 }).then(r => r.json()),
    ])
    _qC = { t: Date.now(), used: (c9 && c9.totalUsage != null) ? c9.totalUsage : -1, total: (q9 && q9.type === 'limited') ? q9.value : -1 }
  } catch (_) {}
  return _qC
}
async function quotaFoot(billed) { // billed=本次計費則數（回覆=0 免費）
  const q = await lineQuota()
  if (q.used < 0) return ''
  // v4.41.2 簡易版（張良 2026-10-04「改成簡易版 0 70/3000 像這樣就好」）：本次計費數 本月用量/上限
  return `\n\n${billed} ${q.used + billed}${q.total > 0 ? '/' + q.total : ''}`
}
// 🗒 DD 群組回話紀錄（v4.70.38 張良 2026-10-10「有些群 DD 會突然自己回」→ 記下每次在哪個群、因為哪條規則、對方說什麼、DD 回什麼；私訊不記）
// why：mention=被@本帳號／name=字裡有 D哥·dd／journal=日誌前綴／photo=照片附日誌／translate=翻譯模式逐句／cmd=開關翻譯指令
async function ddReplyLog(ev, why, q, a) {
  try {
    if (!ev || ev.source?.type === 'user') return
    const gid = ev.source?.groupId || ev.source?.roomId || ''
    if (!gid) return
    const cur = (await kvGetMany(['pm_dd_replylog']))['pm_dd_replylog']
    const arr = Array.isArray(cur) ? cur : []
    arr.unshift({ t: new Date().toISOString(), gid, uid: ev.source?.userId || '', why, q: String(q || '').slice(0, 80), a: String(a || '').slice(0, 120) })
    await kvSet('pm_dd_replylog', arr.slice(0, 300))
  } catch (e) { console.log('ddReplyLog err', e?.message) }
}
// 群組個別設定（mode/journal/translate）：讀壞一律退預設＝現狀行為不變
async function ddGrpCfg(ev) {
  try { const gid = ev.source?.groupId || ev.source?.roomId || ''; if (!gid) return null; const { ddGroupCfg } = await import('./_ddmsg.js'); return await ddGroupCfg(gid) } catch (_) { return null }
}
let _lastSend = null // v4.70.39 健康紀錄用：最近一次送出結果 { replyOk, status, err, pushed }
async function lineReply(replyToken, text, extra, fallbackTo) {
  // extra＝附加訊息物件（Flex 按鈕卡等），跟文字一起回（LINE 一次最多 5 則）
  // v4.70.39 fallbackTo＝reply 失敗（token 逾時／已用過＝400）時改 push 給這個對象（userId 或 groupId），答案不再無聲消失。
  //   push 會計費，所以只在 reply 真的失敗才用；健康頁會記「改推播」次數（docs/COMMS_PLAN.md 項目 1 第 2 點）
  _lastSend = null
  try {
    const foot9 = await quotaFoot(0) // v4.41.1 回覆免費＝本次0則，照樣顯示本月用量
    const messages = [{ type: 'text', text: String(text).slice(0, 4800) + foot9 }, ...(Array.isArray(extra) ? extra.slice(0, 4) : [])]
    const r = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ replyToken, messages }),
    })
    if (r.ok) { console.log('LINE reply OK'); _lastSend = { replyOk: true }; return true }
    const d = await r.text().catch(() => '')
    console.log('LINE reply FAILED', r.status, d.slice(0, 300))
    _lastSend = { replyOk: false, status: r.status, err: d.slice(0, 120) }
    if (fallbackTo && r.status === 400) {
      const p = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ to: fallbackTo, messages }) })
      _lastSend.pushed = p.ok ? 1 : 0
      if (!p.ok) _lastSend.pushErr = (await p.text().catch(() => '')).slice(0, 120)
      console.log('LINE reply→push fallback', p.ok)
      return p.ok
    }
    return false
  } catch (e) { console.log('LINE reply error', e?.message); _lastSend = { replyOk: false, err: String(e?.message || '').slice(0, 120) }; return false }
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
// 年資/年齡由程式先算好餵給 AI（2026-09-18 翻車：DD 用「年份目測」判滿一年，2025-04 到職被說未滿一年——AI 心算日期不可靠，一律程式算）
export function tenureOf(d, nowMs) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(d || '')) return ''
  const now = new Date((nowMs ?? Date.now()) + 8 * 3600e3)
  let months = (now.getUTCFullYear() - Number(d.slice(0, 4))) * 12 + (now.getUTCMonth() + 1 - Number(d.slice(5, 7)))
  if (now.getUTCDate() < Number(d.slice(8, 10))) months--
  if (months < 0) return ''
  const y = Math.floor(months / 12), m = months % 12
  return y ? `${y}年${m ? m + '個月' : ''}` : `${m}個月`
}

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
      out.push(`【夥伴名冊（共 ${people.length} 人；生日格式 西元年-月-日，問「誰快生日」看月-日。⚠️年資已由系統算好標在到職日後——回答滿幾年/年資問題「直接引用」，禁止自己心算日期差。含機密欄位：薪資/保險/證件/銀行——只私訊回老闆，群組不透露）】`)
      people.forEach(p => {
        const ten = tenureOf(p.startDate)
        let line = `  - ${p.name}${p.nick ? '（' + p.nick + '）' : ''}｜生日:${p.bday || '?'}｜到職:${p.startDate || '?'}${ten ? `（年資${ten}）` : ''}${p.dept ? '｜部門:' + p.dept : ''}｜${p.status || '在職'}`
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
    // 工作日誌（夥伴用 LINE「日誌/心得 …」記錄；近14天＋未解決求助給 AI 掌握——100%資料鐵則）
    const jn = pick('kb_journal'); const ji = jn && Array.isArray(jn.items) ? jn.items : []
    if (ji.length) {
      any = true; const since = Date.now() - 14 * 86400000
      const kTag = (i) => ({ issue: '⚠️問題', improve: '🔧改善', help: '🙋求助' }[i.kind] || '心得')
      const sTag = (i) => i.store === 'ground' ? '〔GD〕' : i.store === 'abeach' ? '〔AB〕' : ''
      const openHelp = ji.filter(i => i.kind === 'help' && i.status !== 'solved')
      if (openHelp.length) { out.push(`▍🙋 工作日誌「要幫忙」未解決 ${openHelp.length} 則（有人問「有什麼要幫忙/協作」要答得出）：`); openHelp.slice(0, 10).forEach(i => out.push(`  - ${(i.ts || '').slice(5, 10)} ${i.name}${sTag(i)}：${(i.text || '').slice(0, 80)}`)) }
      const recent = ji.filter(i => new Date(i.ts).getTime() >= since).slice(0, 30)
      out.push(`▍夥伴工作日誌（近14天 ${recent.length} 則，最新在前；含類型 心得/問題/改善/求助 與店別）：`)
      recent.forEach(i => out.push(`  - ${(i.ts || '').slice(5, 10)} ${i.name}${sTag(i)}［${kTag(i)}${i.kind === 'help' ? (i.status === 'solved' ? '·已解決' : '·未解決') : ''}］：${(i.text || '').slice(0, 80)}`))
    }
    // 入職 2.1：名冊上「入職中」的人（只給姓名/進度狀態；證件在私有桶，不進 AI）
    const obPeople = people.filter(p => p.onboarding); if (obPeople.length) { any = true; out.push(`▍入職中（待審核）：${obPeople.length} 位（${obPeople.map(p => `${p.name}${p.contractSigned ? '·契約已簽' : '·契約未簽'}`).join('、')}）——資料填齊後請老闆到 App 名冊「待審核」核准`) }

    return any ? out.join('\n') : ''
  } catch (_) { return '' }
}

// BOT_MODEL 已退役（v4.70.29）：D哥用哪家／哪個模型改在 /prep 設定頁「AI 模型」選（api/_ai.js route=dd，預設 Claude Opus→備援 Sonnet）
const BOT_PERSONA = `你是「DD」（舊名 D哥，大家叫哪個都認得），喬亞國際餐飲團隊的 LINE 小幫手。你手上有公司管理 App 的即時資料（附在下面）。

講話風格：像個可靠、反應快、講話自然的同事——親切、直接、不囉嗦。用正常口語跟適度的表情符號，不要像念公文或一條條規則。該一句話講完就一句話，需要才條列。**不要每次都自我介紹**（你們是熟人了，接著聊就好，除非對方第一次跟你說話或問你是誰）。

做事原則：
- 用下面的資料講真話，數字直接引用、絕不自己亂編。
- **回答任何「有沒有資料」的問題前，必須先把下面的即時資料整段搜過一遍**。你手上的資料域包含：工程進度、任務、財務報表（內帳）、銀行帳務資料庫（合庫）、中信匯款、營運日結＋品項銷售（雙店：A Beach 101／GROUN:D）、供應鏈（產品/包材/廠商）、LINE 訊息額度（官方即時本月用量）、密碼庫（僅授權者私訊用固定指令：記密碼/查密碼/密碼清單/刪密碼——別人問密碼一律拒絕並告知此規則）、**夥伴名冊（每個人的姓名/綽號/生日/到職日/部門/狀態）**、360互評、意見回饋、登入/操作紀錄、比價、公開結論、資料總目錄。
- **禁止沿用你先前說過的「我沒有 X 資料」**——資料每天都在擴充，以「本次」附的資料為準；先前對話說沒有≠現在沒有。
- 資料裡真的沒有的（搜過確認），才說「這個我手上沒有資料」。
- **你「會」操作 App 檔案庫**：使用者傳檔案給你、說「存到檔案庫〔類別名〕」你就會把檔案存進去；說「檔案庫新增類別〔名〕」你會建立新類別；類別是自訂的（可任意命名，如設計檔案／LOGO），存好後在 App 檔案庫頁看得到。**絕對不要說「我沒有新增檔案庫類別的能力／開不了類別／存不了檔案」**——你有。若對方說「沒看到剛建的類別」，提醒他：空類別要在 App 檔案庫頁上方「類別📁」篩選才看得到，或傳個檔案進去就會顯示（不要否認自己建過）。
- **你「會」操作「文件庫」（雲端硬碟）**：這跟上面的「檔案庫／相簿」是兩套東西。使用者先傳檔案給你、再說「存到文件庫〔資料夾名〕」你就把檔案歸進該資料夾（受權限：他要有該夾的編輯權）；私訊打「文件庫」你會列出他看得到的資料夾。主管還可以說「文件庫 把〔資料夾〕〔檔名〕傳到群／給我」，你把檔案撈出來傳過去（但被標記「禁止外傳」的資料夾、或非主管，一律不給撈）。**不要說你做不到**——這些由系統直接執行。資料夾的新增／刪除／改名／排序／設權限在 App 文件庫頁做。
- **【日期計算鐵則】你心算日期差很不可靠（2026-09-18 真實翻車：把 2025-04 到職的人「目測年份」判成未滿一年）**。年資、年齡、滿幾年→資料區已算好，直接引用；其他日期差（幾天後、隔幾週）→必須先寫下兩個完整日期再逐步算，**禁止看年份目測**。
- **先在心裡把資料查完、算完、驗完，才開始寫回覆**。回覆只呈現最終結果——嚴禁把草稿過程寫出來（像「等等這是8月先跳過」「欸不對我重抓一次」這種自我更正實況，觀感很差）。寫錯就整段重寫，不是邊寫邊改。
- **你「有」每日主動提醒功能**：系統每天早上 8:00 自動把「今日任務簡報」（逾期/今天到期/急件/三天內）私訊給張良，傍晚 5:30 若今天的任務還沒完成會再追一次；提醒附**互動按鈕卡**（每件任務可直接按 ✅完成／⏭延1天／📅改日期／🗑取消，不用打字）。**絕對不要說「我不會主動提醒/我沒辦法定時推播/要你自己來問我」**——定時推播是系統既有功能。另外：每週日傍晚會送「下週任務規劃」（7 天按日排好）；張良隨時打「**今日任務**」就會秒回當日簡報＋按鈕卡。改資料/金額類操作等確認時也有 ✅確認/❌取消 按鈕（打字照樣有效）。要調整提醒的內容或時間，請對方跟張良講一聲就能改。
- **幫使用者記任務時要動腦，不是當打字員**：對方隨手打一段工作內容，你要主動（1）判斷歸哪個空間/大項、（2）把「明天/週五/月底」換算成實際日期填 due（今天日期在下面資料區開頭）、（3）判斷輕重緩急——急的、影響營運的帶 priority 超急、（4）有提到人就填 owner。一次丟好幾件就逐件記。記完之後如果對方在安排工作，主動給一句優先順序建議（先做哪個、為什麼）。
- **記完任務系統會自動附「快速設定卡」**（每件新任務一張，按鈕：📅設截止日跳日曆／🏷選分類跳大項按鈕／👤設負責人跳夥伴按鈕／🔥標超急）。所以**不要說「聊天框變不出選單/按鈕」**——有，而且是自動附的；你只要正常記任務就好，不用叫使用者打字補設定。
- **如果你判斷自己做不到、或資料不足、或對方的要求不在你能力範圍**：直接、清楚地說「我做不到 X，原因是 Y，你可以這樣做 Z」。不要裝懂、不要答非所問、不要假裝完成。
- 記得上面的對話脈絡，順著聊，不要把每句話都當第一次見面。
- **一則訊息常常同時有好幾件事**（要記的＋要問的＋要查的，可能用換行或「跟」「還有」分開）。**每一件都要處理到、逐件交代**，絕對不能只做第一件就停：要記錄的照記錄，要問的問題照回答，同一則回覆裡全部給齊。
- 如果對話中出現「值得長期記住」的重要事實（某人負責什麼、聯絡方式、分工窗口、老闆的偏好或固定要求、專案的重要約定…），在你回覆的「最後」另起一行用這個格式標記：[[記住:該事實]]（可多行、每行一件、寫簡短）。只標真正值得長期記的，瑣事不要標。這個標記使用者看不到，是給系統存進你的長期記事本用的。`
// 今天日期＋星期（台北時間）放資料區開頭：換算「明天/週五」設任務截止日要用（張良 2026-09-08）
const sysDataHead = () => { const d = new Date(Date.now() + 8 * 3600e3); return `\n\n────────\n【你目前掌握的即時資料】（今天是 ${d.toISOString().slice(0, 10)} 星期${'日一二三四五六'[d.getUTCDay()]}，台北時間）\n` }

// 排班系統（夥伴中心・排班）→ 文字。【100%資料鐵則】問「某人某天上什麼班」一律以此為準。
// 出勤打卡（今日）：誰上班中/已下班、LINE備援未審核筆數（100%資料鐵則——打卡新資料域）
// NUEiP 人資出勤（sp_crew_pm_hr_att_ 月檔＝App 夥伴中心「人資系統」頁同一份；api/hr.js 每日 22:40 同步）
// 問「誰今天幾點打卡/這個月誰常遲到」用這裡；與 App loadSpaceAIContext 同步接（100%資料鐵則）
async function loadHrText() {
  try {
    const mo = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
    const doc = await kvGetMany(['sp_crew_pm_hr_att_' + mo]).then(m => m['sp_crew_pm_hr_att_' + mo])
    if (!doc || !doc.days) return ''
    const days = Object.keys(doc.days).sort()
    if (!days.length) return ''
    const out = [`\n\n【NUEiP 人資出勤（本月 ${days.length} 天；App→夥伴中心→人資系統）】`]
    days.slice(-2).forEach(d => {
      const rows = Object.values(doc.days[d]).map(r => `${r.name}${r.work ? ` 班${r.work}` : ''} 上${(r.on || []).join('/') || '—'} 下${(r.off || []).join('/') || '—'}${r.late ? ` 遲到${r.late}分` : ''}${r.early ? ` 早退${r.early}分` : ''}${r.miss ? ' 缺卡' : ''}${r.absent ? ' 曠職' : ''}`)
      out.push(`▍${d}\n` + rows.map(x => '- ' + x).join('\n'))
    })
    const st = {}
    days.forEach(d => Object.values(doc.days[d]).forEach(r => { const s2 = st[r.name] = st[r.name] || { late: 0, lm: 0, miss: 0, ab: 0 }; if (r.late) { s2.late++; s2.lm += r.late } if (r.miss) s2.miss++; if (r.absent) s2.ab++ }))
    const bad = Object.entries(st).filter(([, s2]) => s2.late || s2.miss || s2.ab)
    if (bad.length) out.push('▍本月異常統計\n' + bad.map(([n, s2]) => `- ${n}：${[s2.late ? `遲到${s2.late}次(${s2.lm}分)` : '', s2.miss ? `缺卡${s2.miss}次` : '', s2.ab ? `曠職${s2.ab}次` : ''].filter(Boolean).join('、')}`).join('\n'))
    return out.join('\n')
  } catch (_) { return '' }
}
// 薪資分潤模型（夥伴中心・薪資透明頁 sp_crew_salary_model；只給參數概要,個人試算以 App 頁為準；外部群不載；v4.38.3 盤點補洞）
async function loadSalaryText() {
  try {
    const d = (await kvGetMany(['sp_crew_salary_model']))['sp_crew_salary_model']
    if (!d?.settings) return ''
    const S = d.settings
    return `\n\n【薪資分潤模型（A Beach・夥伴中心「薪資透明」頁）】\n  - 池=損益淨利×淨利率×放大係數${S.pnl?.amp ?? '?'}${Number(S.poolManual) > 0 ? `（目前手動指定池 NT$${Number(S.poolManual).toLocaleString()}）` : ''}｜模式${S.mode}（A=全池連乘/B=半票半乘）｜預設本薪 NT$${Number(S.defaultBase || 0).toLocaleString()}\n  - 五大面向：${(S.facets || []).join('/')}｜每人票數${S.votesPerPerson}｜單項係數上限${S.maxBoost}｜已填浮動欄 ${Object.keys(d.people || {}).length} 人\n  - ⚠️個人獎金一律以 App 薪資透明頁試算為準（公式=保底+票數獎金×六係數連乘），不要自己心算`
  } catch (_) { return '' }
}
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
    const [m, tR] = await Promise.all([kvGetMany(['pm_data', 'pm_worklog']), kvLoadTasks()])
    const tasks = tR.list
    const worklog = Array.isArray(m['pm_worklog']) ? m['pm_worklog'] : []
    if (!tasks.length && !worklog.length) return ''
    const cats = Array.isArray(m['pm_data']) ? m['pm_data'] : []
    const catName = (id) => (!id || id === '__inbox__') ? '領養代替購買' : ((cats.find(c => c.id === id) || {}).name || '領養代替購買')
    const SL = { todo: '待辦', doing: '進行中', done: '完成' }
    const lines = []
    // 工作日誌（add_log 記的）：DD 要讀得到自己記過什麼，被問「之前幫我記的在哪」答得出來
    if (worklog.length) {
      lines.push(`\n\n【工作日誌（你用 add_log 幫使用者記的都存在這裡＝App「工作日誌」頁；共 ${worklog.length} 則，列最新 30 則）】`)
      worklog.slice(0, 30).forEach(w => lines.push(`  - ${w.date || ''} ${w.content || ''}${w.author ? `（${w.author}）` : ''}`))
    }
    if (tasks.length) lines.push(`\n\n【任務中心（共 ${tasks.length} 件，可用 add_task / update_task / delete_task 操作）】`)
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
    // 其他空間的任務中心（張良 2026-09-01：D哥能 add_task 到團隊/夥伴/財務空間了，讀也要跟上——
    // 不然「記了但問他又說沒有」重演；100%資料鐵則）。各空間任務獨立，用標題分開列。
    for (const [nm, pfx] of [['團隊工作', 'sp_team_'], ['夥伴中心', 'sp_crew_'], ['財務報表', 'sp_finance_']]) {
      const ts2 = await kvGetPrefix(pfx + 'pm_task_')
      if (!ts2.length) continue
      ts2.sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))
      // 該空間的大項清單也給 D（v2.1.2：add_category/update_task/delete_task 都能跨空間了，D 要知道有哪些分類、任務歸在哪）
      const cats2raw = (await kvGetMany([pfx + 'pm_data']))[pfx + 'pm_data']
      const cats2 = Array.isArray(cats2raw) ? cats2raw : []
      const catName2 = (id) => (!id || id === '__inbox__') ? '收件匣' : (cats2.find(c => c.id === id)?.name || '收件匣')
      lines.push(`\n\n【${nm}空間的任務中心（共 ${ts2.length} 件；add_task/update_task/delete_task/add_category 帶 "space":"${nm.slice(0, 2)}" 都能操作這裡）】`)
      if (cats2.length) lines.push(`  大項分類：${cats2.map(c => c.name).join('、')}`)
      ts2.forEach(t => lines.push(`  - ${t.pinned ? '📌' : ''}[${SL[t.status] || t.status}] ${t.title}（${catName2(t.catId)}）${t.due ? `｜截止${t.due}` : ''}${t.owner ? `｜負責:${t.owner}` : ''}${(t.tags || []).length ? `｜#${t.tags.join(' #')}` : ''}`))
    }
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
    const kv = await kvGetMany(['sp_finance_pm_pos', 'sp_finance_pm_pos_d_' + mo, 'sp_finance_pm_pos_tx_' + mo, 'sp_finance_pm_pos_flags', 'sp_finance_pm_pos_idlecfg', 'sp_finance_pm_pos_hh_' + mo, 'sp_finance_pm_pos_costs', 'sp_finance_pm_pos_prices', 'sp_finance_pm_pos_hidden', 'sp_finance_pm_pos_alias', 'sp_finance_pm_sop_def', 'sp_finance_pm_sop_g_' + now.toISOString().slice(0, 10), 'sp_finance_pm_sop_issues', 'sp_finance_pm_inv', 'sp_finance_pm_buy', 'sp_finance_pm_meet', 'sp_finance_pm_shift_g', 'sp_finance_pm_fb', 'sp_finance_pm_fbj', 'sp_finance_pm_menu', 'sp_finance_pm_fc_' + now.toISOString().slice(0, 7).replace('-', ''), 'sp_finance_pm_absoldout', 'sp_finance_pm_ablive', 'sp_finance_pm_labor', 'sp_finance_pm_inline_' + mo, 'sp_finance_pm_inline_' + new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7), 1)).toISOString().slice(0, 7), 'sp_finance_pm_inline_' + new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7) - 2, 1)).toISOString().slice(0, 7), 'sp_finance_pm_inline', 'sp_finance_pm_inline_insights', 'sp_finance_pm_sop_sugs'])
    const pos = kv['sp_finance_pm_pos']
    const entries = pos && Array.isArray(pos.entries) ? pos.entries : []
    if (!entries.length) return ''
    const nt = (n) => 'NT$' + Math.round(n || 0).toLocaleString()
    // 雙店（A Beach / GROUN:D）同庫：多店時每行帶店名；partial 且沒單數=人工回填日（只有營收/品項，別答單數/付款拆分）
    // 喬亞自動抓的日子也帶 partial 但有完整單數/付款 → 走完整行（2026-08-29：不然 D 哥答不出 GROUN:D 現金/卡/LINE Pay）
    const isG = (e) => /groun/i.test(e.store || '')
    const multiStore = new Set(entries.map(e => isG(e) ? 'g' : 'a')).size > 1
    const sTag = (e) => multiStore ? (isG(e) ? '［GROUN:D］' : '［A Beach］') : ''
    const lines = [`\n\n【營運日結（${multiStore ? '雙店：A Beach＋GROUN:D' : (entries[0]?.store || 'POS')}，每日結帳自動入庫，共 ${entries.length} 天；下面日列=每店近30天，更久的看月加總或用 query_pos_day 代查）】`]
    { // v4.31.2 治本（張良 2026-10-03「Ab九月營業額→DD說只有半個月還叫我自己看App」）：月加總全史直接餵——問「X月營業額」就用這行答，不用代查
      const moAgg = {}
      entries.forEach(e => { const k9 = (isG(e) ? 'g' : 'a') + '|' + e.date.slice(0, 7); const o = moAgg[k9] = moAgg[k9] || { rev: 0, tx: 0, n: 0 }; o.rev += Number(e.revenue) || 0; o.tx += Number(e.txCount) || 0; o.n++ })
      const moNow9 = now.toISOString().slice(0, 7)
      const moLine = (pfx) => Object.keys(moAgg).filter(k9 => k9.startsWith(pfx)).sort().map(k9 => { const m2 = k9.slice(2), o = moAgg[k9]; return `${m2}=${nt(o.rev)}(${o.n}天${o.tx ? `,${o.tx}單` : ''})${m2 === moNow9 ? '〈本月進行中〉' : ''}` }).join('、')
      lines.push(`【月營業額加總（全部歷史月份，日結逐日加總＝和 App 營運日結月合計同一套算法；問「某月營業額」直接用這行答，不要叫使用者自己去看 App）】`)
      if (moLine('a|')) lines.push(`  - A Beach：${moLine('a|')}`)
      if (moLine('g|')) lines.push(`  - GROUN:D：${moLine('g|')}`)
    }
    // v4.31.2：原本 entries.slice(-30) 雙店混切＝每店只剩約15天，AI誤以為月初資料缺——改每店各取近30天
    ;[...entries.filter(e => !isG(e)).slice(-30), ...entries.filter(e => isG(e)).slice(-30)].sort((x, y) => (x.date < y.date ? -1 : 1)).forEach(e => lines.push((e.partial && !e.txCount)
      ? `  - ${e.date}${sTag(e)} 營收${nt(e.revenue)}${e.grossSales > e.revenue ? `（牌價${nt(e.grossSales)}·試營運折讓）` : ''}｜${e.partial}`
      : `  - ${e.date}${sTag(e)} 營收${nt(e.revenue)}｜${e.txCount}單｜來客${e.guests || '?'}｜客單${e.guests ? nt(Math.round(e.revenue / e.guests)) : '—'}｜現金${nt(e.cash)}/卡${nt(e.card)}${e.linepay ? `/LINE Pay${nt(e.linepay)}` : ''}${e.payOther ? `/其他${nt(e.payOther)}` : ''}/Uber${nt(e.uber)}${e.kiosk ? `｜自助點餐${nt(e.kiosk)}(佔${e.revenue ? Math.round(e.kiosk / e.revenue * 100) : 0}%,約${e.txCount && e.revenue ? Math.round(e.kiosk / (e.revenue / e.txCount)) : '?'}單估算,已含在卡/LINE Pay內)` : ''}｜折扣${nt(e.discount)}`))
    // AB 今天即時（pm_ablive＝Eats365 後台儀表板抓的「到目前為止」，張良 2026-09-02；日結信入庫後被正式資料取代——同一天有正式日結就別再引用即時值）
    // 人力配置（財務·人力成本分頁 pm_labor，張良 2026-09-11）：答「幾點幾個人/人力成本/哪站幾人」
    const lbr = kv['sp_finance_pm_labor']
    if (lbr?.stations?.length) {
      const w = Number(lbr.wage) || 300
      const cnt = (h, sid) => Number(lbr.grid?.[h]?.[sid]) || 0
      const hrs = Array.from({ length: 10 }, (_, i) => 10 + i)
      const rowTx = hrs.map(h => { const n = lbr.stations.reduce((t, st) => t + cnt(h, st.id), 0); return n ? `${h}-${h + 1}點${n}人(${lbr.stations.filter(st => cnt(h, st.id)).map(st => st.name + (cnt(h, st.id) > 1 ? '×' + cnt(h, st.id) : '')).join('/')})` : null }).filter(Boolean)
      const totalN = hrs.reduce((t, h) => t + lbr.stations.reduce((x, st) => x + cnt(h, st.id), 0), 0)
      lines.push(`\n【GROUN:D 人力配置（財務·人力成本分頁；時薪${w}）】\n  - ${rowTx.join('、')}\n  - 全日 ${totalN} 人時＝每日人力成本 NT$${(totalN * w).toLocaleString()}｜站別品類對應：${lbr.stations.map(st => st.name + ((st.cats || []).length ? `(${st.cats.join('/')})` : '(全店共用)')).join('、')}`)
    }
    const abl = kv['sp_finance_pm_ablive']
    if (abl?.date === now.toISOString().slice(0, 10) && abl.revenue && !entries.some(e => e.date === abl.date && !isG(e))) {
      lines.push(`  - ${abl.date}［A Beach］盤中即時（${abl.at} 更新，還沒打烊會再長大）：營收${nt(abl.revenue)}｜${abl.tx}單${abl.guests ? `｜來客${abl.guests}` : ''}${abl.dineIn?.tx || abl.takeout?.tx ? `｜內用${abl.dineIn?.tx || 0}單${nt(abl.dineIn?.sales)}/外帶${abl.takeout?.tx || 0}單${nt(abl.takeout?.sales)}` : ''}${(abl.items || []).length ? `｜熱銷Top${Math.min(5, abl.items.length)}:${abl.items.slice(0, 5).map(i => `${i.n}×${i.q}`).join('、')}（品項共${abl.items.length}項${abl.items.reduce((t2, i) => t2 + (i.q || 0), 0) >= (abl.itemsQtyTotal || 0) ? ',完整' : ',僅Top10'};要全表問我某品項即可）` : ''}`)
    }
    // A Beach inline 訂位（pm_inline_月檔＝每小時自動同步，2021-02 起全史，張良 2026-10-03；與 App loadSpaceAIContext 同步接）
    {
      const today = now.toISOString().slice(0, 10)
      const nmo = new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7), 1)).toISOString().slice(0, 7)
      const pmo = new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7) - 2, 1)).toISOString().slice(0, 7)
      const inlDays = { ...(kv['sp_finance_pm_inline_' + pmo]?.days || {}), ...(kv['sp_finance_pm_inline_' + mo]?.days || {}), ...(kv['sp_finance_pm_inline_' + nmo]?.days || {}) }
      const inlSum = kv['sp_finance_pm_inline']
      if (Object.keys(inlDays).length || inlSum) {
        const ST = { 1: '確認', 2: '取消', 3: '待確認', 4: '入座', 5: '取消', 6: '確認' }
        const ok1 = (r) => r.st !== 2 && r.st !== 5 && r.ty !== 4 // 有效（2/5=取消、ty4=候補沒進店都排除——張良 2026-10-04）
        const fmt1 = (r) => `${r.t || '候位'} ${r.name}${r.n}人(${ST[r.st] || r.st}${r.kc ? `,兒童椅${r.kc}` : ''}${r.note ? `,${String(r.note).slice(0, 30)}` : ''})`
        lines.push(`\n【A Beach 訂位（inline 每小時自動同步；載入=上月起到未來全部；2021-02 開店起全史已入庫 pm_inline_ 月檔，更早明細要另外查）】`)
        const td = inlDays[today] || []
        lines.push(`  - 今天 ${today}：${td.length ? `${td.filter(ok1).length}組有效（${td.filter(ok1).reduce((t, r) => t + (r.n || 0), 0)}人）｜` + td.filter(ok1).map(fmt1).join('、') + (td.some(r => !ok1(r)) ? `｜另取消${td.filter(r => !ok1(r)).length}組` : '') : '無訂位'}`)
        const futs = Object.keys(inlDays).filter(d => d > today).sort()
        if (futs.length) lines.push(`  - 未來45天內（有訂位的日子全列；格式=日期(星期) 組數人數[午X/晚Y]；午場=訂位時間17:00前、晚場=17:00後（17-18店休息）；≥20人大組附名+時間；星期直接用括號裡的,不要自己算；要逐筆時間明細用 query_resv 代查）：` + futs.map(d => { const a = inlDays[d].filter(ok1); if (!a.length) return null; const wd = '日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()]; const noon = a.filter(r => r.t && r.t < '17:00').length, eve = a.filter(r => r.t && r.t >= '17:00').length, nt0 = a.length - noon - eve; const big = a.filter(r => (r.n || 0) >= 20).map(r => `${r.name}${r.n}人${r.t || ''}`).join('+'); return `${d.slice(5)}(${wd}) ${a.length}組${a.reduce((t, r) => t + (r.n || 0), 0)}人[午${noon}/晚${eve}${nt0 ? `/未填${nt0}` : ''}]${big ? `(${big})` : ''}` }).filter(Boolean).join('、'))
        // 遠期訂位（45天後全部＝總覽 farFuture，每小時同步；婚顧/包場問「某天有沒有被訂」以此為準）
        const ff = (inlSum?.farFuture || []).filter(ok1)
        lines.push(`  - 遠期訂位（45天後～最遠，全部列出；婚顧包場問「哪天已被訂」以此為準，沒列到的日子=目前空）：${ff.length ? ff.map(r => `${r.d} ${r.t || ''} ${r.name}${r.n}人${r.inote ? `(${String(r.inote).slice(0, 20)})` : ''}`).join('、') : '無'}`)
        // 當日備註（host 日曆⚠️註記＝包場/公休/訂位已關；婚顧檔期另一真相來源，跟訂位對照答；全史在 pm_inline_notes）
        const dn = inlSum?.dayNotes || {}
        const dnKeys = Object.keys(dn).sort()
        if (dnKeys.length) lines.push(`  - 當日備註（今天起全部；⚠️=包場/全包等營運註記）：` + dnKeys.map(d => `${d} ${dn[d].map(n => String(n.note).replace(/\s+/g, ' ').slice(0, 40)).join(';')}`).join('、'))
        const pasts = Object.keys(inlDays).filter(d => d < today).sort().slice(-7)
        if (pasts.length) {
          const agg = { all: 0, s4: 0, cx: 0, rest: 0 }
          pasts.forEach(d => inlDays[d].forEach(r => { agg.all++; if (r.st === 4) agg.s4++; else if (!ok1(r)) agg.cx++; else agg.rest++ }))
          lines.push(`  - 近${pasts.length}天（${pasts[0].slice(5)}~${pasts[pasts.length - 1].slice(5)}）：共${agg.all}組｜入座${agg.s4}/取消${agg.cx}/其他${agg.rest}`)
        }
        if (inlSum?.months) { const ms = Object.entries(inlSum.months); lines.push(`  - 歷史總量：${ms.length}個月 ${ms.reduce((t, [, v]) => t + (v.resv || 0), 0)}筆（最後同步 ${String(inlSum.lastSync || '').slice(0, 16).replace('T', ' ')}）`) }
        // 訂位洞察（inline-sync 全史聚合；答「客人哪來的/提前多久訂/大組趨勢」；v4.38.3 盤點補洞）
        const insD = kv['sp_finance_pm_inline_insights']
        if (insD && (insD.src || insD.purpose)) {
          const top6 = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}${v}`).join('、')
          lines.push(`  - 洞察（全史聚合）：來源=${top6(insD.src) || '無'}｜目的=${top6(insD.purpose) || '無'}${insD.lead ? `｜提前訂:當天${insD.lead.d0 || 0}/1-3天${insD.lead.d1_3 || 0}/4-7天${insD.lead.d4_7 || 0}/8-30天${insD.lead.d8_30 || 0}/31天+${insD.lead.d31 || 0}` : ''}${insD.bigY ? `｜大組(≥20人)年趨勢:${Object.entries(insD.bigY).sort().slice(-3).map(([y, b]) => `${y}年${b.cnt}次${b.guests}人`).join('、')}` : ''}`)
        }
      }
    }
    // SOP 建議待審（夥伴在 /prep 提的建議；status=open 等負責人處理；v4.38.3 盤點補洞）
    const sugsD = kv['sp_finance_pm_sop_sugs']
    const sugsOpen = (sugsD?.list || []).filter(s => s.status === 'open')
    if (sugsOpen.length) lines.push(`【SOP 建議待審 ${sugsOpen.length} 件】` + sugsOpen.slice(0, 6).map(s => `${s.by}(${s.st}):${String(s.text || '').slice(0, 25)}`).join('、'))
    // GROUN:D 半小時時段（pm_pos_hh_月檔＝盤中每30分快照相減推算，2026-08-28 起；答「排人力/尖峰半小時」；對帳以每小時原生資料為準；與 App loadSpaceAIContext 同步接）
    const hhDoc = kv['sp_finance_pm_pos_hh_' + mo]
    if (hhDoc?.days && Object.keys(hhDoc.days).length) {
      const t2m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
      const m2t = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
      const hh = {}; let nDays = 0
      Object.values(hhDoc.days).forEach(snapsRaw => {
        if (!Array.isArray(snapsRaw) || snapsRaw.length < 2) return
        const snaps = [...snapsRaw].sort((a, b) => t2m(a.t) - t2m(b.t)); nDays++
        for (let i = 1; i < snaps.length; i++) { const amt = (Number(snaps[i].rev) || 0) - (Number(snaps[i - 1].rev) || 0), od = (Number(snaps[i].tx) || 0) - (Number(snaps[i - 1].tx) || 0); if (amt < 0 || od < 0) continue; const k = snaps[i - 1].t; const o = hh[k] = hh[k] || { amt: 0, od: 0 }; o.amt += amt; o.od += od }
      })
      const ks = Object.keys(hh).sort()
      if (ks.length) { lines.push(`【GROUN:D 半小時時段（本月快照推算・${nDays} 天；排人力用）】`); ks.forEach(k => lines.push(`  - ${k}-${m2t(t2m(k) + 30)} 共${hh[k].od}單 ${nt(hh[k].amt)}｜日均${(hh[k].od / nDays).toFixed(1)}單`)) }
    }
    // 品項成本主檔（pm_pos_costs＝張良在品項明細「💰填成本」手填；答「XX成本多少/毛利/成本率」；毛利＝營收−Σ當日份數×成本；與 App loadSpaceAIContext 同步接）
    const costsDoc = kv['sp_finance_pm_pos_costs']
    if (costsDoc && Object.keys(costsDoc).length) {
      const cLines = []
      for (const [sk2, m2] of Object.entries(costsDoc)) {
        const es2 = Object.entries(m2 || {}).filter(([, v]) => Number(v) > 0)
        if (es2.length) cLines.push(`  - ${sk2 === 'ground' ? 'GROUN:D' : 'A Beach'}：` + es2.map(([n2, v]) => `${n2}=${Math.round(Number(v))}`).join('、'))
      }
      if (cLines.length) { lines.push('【品項成本主檔（手填食材成本/份；毛利＝營收−Σ當日份數×成本；沒填的品項當0成本→毛利偏高估要提醒）】'); lines.push(...cLines) }
    }
    // 品項定價覆寫（pm_pos_prices＝張良手填牌價，優先於銷售資料推算；GROUN:D 飲料/湯/小點跟套餐拆帳、POS金額≠牌價，答「XX賣多少錢」以此為準；與 App loadSpaceAIContext 同步接）
    const pricesDoc = kv['sp_finance_pm_pos_prices']
    if (pricesDoc && Object.keys(pricesDoc).length) {
      const pLines = []
      for (const [sk2, m2] of Object.entries(pricesDoc)) {
        const es2 = Object.entries(m2 || {}).filter(([, v]) => Number(v) > 0)
        if (es2.length) pLines.push(`  - ${sk2 === 'ground' ? 'GROUN:D' : 'A Beach'}：` + es2.map(([n2, v]) => `${n2}=${Math.round(Number(v))}`).join('、'))
      }
      if (pLines.length) { lines.push('【品項定價（老闆手填牌價，比銷售資料推算的準；問「XX賣多少錢」以此為準）】'); lines.push(...pLines) }
    }
    // 下架品項隱藏清單（pm_pos_hidden＝品項明細「🙈隱藏管理」勾的；分析銷售時銷量歸零是下架不是賣不動，要排除別誤判；與 App loadSpaceAIContext 同步接）
    const hiddenDoc = kv['sp_finance_pm_pos_hidden']
    if (hiddenDoc && Object.keys(hiddenDoc).length) {
      const hLines = []
      for (const [sk2, m2] of Object.entries(hiddenDoc)) {
        const ks2 = Object.keys(m2 || {})
        if (ks2.length) hLines.push(`  - ${sk2 === 'ground' ? 'GROUN:D' : 'A Beach'}：${ks2.join('、')}`)
      }
      if (hLines.length) { lines.push('【已下架/隱藏品項（老闆在品項明細標的；銷量歸零是下架不是賣不動，分析時要排除）】'); lines.push(...hLines) }
    }
    // 品項改名對照（pm_pos_alias＝菜名更新後歷史數據合併到最新名；分析品項時舊名=同一個商品，別當兩個菜；與 App loadSpaceAIContext 同步接）
    const aliasDoc = kv['sp_finance_pm_pos_alias']
    if (aliasDoc && Object.keys(aliasDoc).length) {
      const aLines = []
      for (const [sk2, m2] of Object.entries(aliasDoc)) {
        const es2 = Object.entries(m2 || {})
        if (es2.length) aLines.push(`  - ${sk2 === 'ground' ? 'GROUN:D' : 'A Beach'}：` + es2.map(([o2, n2]) => `${o2}→${n2}`).join('、'))
      }
      if (aLines.length) { lines.push('【品項改名對照（舊菜名→最新名；同一個商品，統計/回答都用最新名合併算）】'); lines.push(...aLines) }
    }
    // GD 每日 SOP（pm_sop_def 定義＋pm_sop_g_今日紀錄；夥伴在 /prep 看板打卡、拍照，超時 cron 會發群提醒；與 App loadSpaceAIContext 同步接）
    const sopDef = kv['sp_finance_pm_sop_def']
    const sopItems = (sopDef && sopDef.ground && Array.isArray(sopDef.ground.items)) ? sopDef.ground.items : []
    if (sopItems.length) {
      const sopLog = (kv['sp_finance_pm_sop_g_' + now.toISOString().slice(0, 10)] || {}).items || {}
      const sLines = sopItems.map(it => { const lg = sopLog[it.id]; return `  - ${it.st}｜${it.title}（${it.due} 前${it.photo ? '・要拍照' : ''}）：${lg && lg.done ? `✅ ${lg.ts} ${lg.by || ''}完成` : '未完成'}` })
      lines.push(`【GD 每日SOP（今日 ${now.toISOString().slice(5, 10)} 執行狀況；夥伴在 /prep 看板打卡；超時未完成 cron 會發群提醒）】`); lines.push(...sLines)
    }
    // 盤點/包材（pm_inv＝/prep 盤點分頁：品項/最後盤點/銷售連結；預估現量要即時算太重，AI 給定義+最後盤點，低水位由 cron 提醒；與 App loadSpaceAIContext 同步接）
    const invDoc = kv['sp_finance_pm_inv']
    if (invDoc && (((invDoc.food || {}).items || []).length || ((invDoc.pack || {}).items || []).length)) {
      const invL = []
      for (const [kk, lb2] of [['food', '食材'], ['pack', '包材']]) {
        const kd2 = invDoc[kk] || {}
        for (const it2 of (kd2.items || [])) {
          const last2 = ((kd2.counts || {})[it2.id] || [])[0]
          invL.push(`  - [${lb2}] ${it2.name}（單位${it2.unit || '?'}・低標${it2.min}）最後盤點：${last2 ? `${last2.qty} @${last2.ts}(${last2.by})` : '還沒盤過'}`)
        }
      }
      lines.push('【盤點/包材庫存（/prep 盤點分頁；預估現量=盤點量−盤後銷售×用量，低於低標 cron 每日開店前發群提醒）】'); lines.push(...invL)
    }
    // AB 停售即時狀態（pm_absoldout＝每30分掃 Eats365 品名🚫慣例；與 App loadSpaceAIContext 同步接）
    const soAI = kv['sp_finance_pm_absoldout']
    if (soAI && soAI.current && Object.keys(soAI.current).length) {
      lines.push('【A Beach 目前停售中（🚫命名偵測，約半小時內即時）】' + Object.entries(soAI.current).map(([n, t2]) => `${n}（自${t2}）`).join('、'))
    }
    // 銷量預測快照（pm_fc_月檔＝每天11:00鎖定的全店/品項預測與實績；與 App loadSpaceAIContext 同步接）
    const fcDoc = kv['sp_finance_pm_fc_' + now.toISOString().slice(0, 7).replace('-', '')]
    const fcDays = Object.entries((fcDoc || {}).days || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1))
    if (fcDays.length) {
      const [fd, fs] = fcDays[0]
      lines.push(`【GD銷量預測（測試中；最新快照 ${fd}）】系統預測全店 ${fs.sysStore} 份（校正前${fs.preCalStore}×係數）｜舊法備料卡口徑 ${fs.baseStore} 份${fs.actual ? `｜實際 ${fs.actual.total} 份` : ''}`)
    }
    // 每日回饋紀錄（pm_fbj＝/prep 回饋分頁：每人每天發現問題的文字/照片/影片紀錄；與 App loadSpaceAIContext 同步接）
    const fbjL = ((kv['sp_finance_pm_fbj'] || {}).list || [])
    if (fbjL.length) {
      lines.push('【每日回饋紀錄（近8則；每人每天要交發現的問題）】')
      fbjL.slice(0, 8).forEach(x => lines.push(`  - ${x.date} ${x.ts || ''} ${x.by}${x.st ? '【' + x.st + '】' : ''}：${String(x.text || '（附件）').replace(/\n/g, ' ').slice(0, 50)}${(x.media || []).length ? '・附' + x.media.length + '檔' : ''}`))
    }
    // 新菜單編輯（pm_menu＝/prep 菜單分頁：base=既有菜單、draft=新菜單協作稿；與 App loadSpaceAIContext 同步接）
    const mnDoc = kv['sp_finance_pm_menu']
    if (mnDoc && mnDoc.base) {
      const flat = (m2) => { const o2 = {}; (m2.sections || []).forEach(s2 => (s2.items || []).forEach(i2 => { o2[i2.id] = { ...i2, sec: s2.name } })); return o2 }
      const bF = flat(mnDoc.base), dF = flat(mnDoc.draft || mnDoc.base)
      const add2 = Object.keys(dF).filter(k2 => !bF[k2]), del2 = Object.keys(bF).filter(k2 => !dF[k2])
      const chg2 = Object.keys(dF).filter(k2 => bF[k2] && (bF[k2].name !== dF[k2].name || bF[k2].price !== dF[k2].price))
      lines.push(`【新菜單協作稿（/prep 菜單分頁；對比既有菜單：新增${add2.length}、刪${del2.length}、改${chg2.length}）】`)
      add2.slice(0, 8).forEach(k2 => lines.push(`  + ${dF[k2].sec}｜${dF[k2].name} $${dF[k2].price}`))
      del2.slice(0, 8).forEach(k2 => lines.push(`  - ${bF[k2].name}（原$${bF[k2].price}）`))
      chg2.slice(0, 8).forEach(k2 => lines.push(`  ~ ${bF[k2].name} $${bF[k2].price} → ${dF[k2].name} $${dF[k2].price}`))
    }
    // 每日回饋（pm_fb＝/prep 回饋分頁：每天對有上班的人文字回饋+1~5星；與 App loadSpaceAIContext 同步接）
    const fbL = ((kv['sp_finance_pm_fb'] || {}).list || [])
    if (fbL.length) {
      lines.push('【每日回饋（近8則；/prep 回饋分頁）】')
      fbL.slice(0, 8).forEach(x => lines.push(`  - ${x.date} ${x.by}→${x.target}${x.stars ? '⭐' + x.stars : ''}：${String(x.text || '').replace(/\n/g, ' ').slice(0, 50)}`))
    }
    // GD 夥伴 App 綁定小抄（張良 2026-09-24：夥伴問「輸入綁定碼在哪」DD 要答得出來）
    lines.push('【GD夥伴App(/prep)綁定小抄】想綁定的人＝請他本人私訊DD說「綁定GD」就好。已綁過要登入＝私訊DD「登入碼」拿4位數→App按右上「登入」填入。【鐵則】綁定連結是個人專屬：你絕對不可以自己生成、猜測或把聊天紀錄裡任何人的綁定連結(含 ?bind=、?me= 開頭)或登入碼貼給別人——一律只回「私訊DD說綁定GD／登入碼」。')
    // 會議紀錄＋GD班表（pm_meet/pm_shift_g＝/prep 會議、班表分頁；打卡本體走既有 sp_crew_pch_；與 App loadSpaceAIContext 同步接）
    const meetL = ((kv['sp_finance_pm_meet'] || {}).list || [])
    if (meetL.length) {
      lines.push('【會議紀錄（近5筆；/prep 會議分頁，類型可自訂）】')
      meetL.slice(0, 5).forEach(x => lines.push(`  - ${x.type}｜${x.date}｜${x.by}：${String(x.text || '').replace(/\n/g, ' ').slice(0, 60)}`))
    }
    const shGL = ((kv['sp_finance_pm_shift_g'] || {}).list || [])
    if (shGL.length) {
      const tdS = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
      const soonS = shGL.filter(x => x.date >= tdS).slice(0, 8)
      lines.push(`【GD班表（/prep 班表分頁；共${shGL.length}筆，工時對照打卡、加班1.34/1.67口徑同薪資引擎）】`)
      soonS.forEach(x => lines.push(`  - ${x.date} ${x.name} ${x.start}-${x.end}${x.break ? `(休${x.break}分)` : ''}`))
      if (!soonS.length) lines.push('  （近期沒有排班）')
    }
    // 採購需求（pm_buy＝/prep 採購分頁：大家提要買的東西附圖/連結；與 App loadSpaceAIContext 同步接）
    const buyDoc = kv['sp_finance_pm_buy']
    const buyOpen = ((buyDoc || {}).list || []).filter(x => x.status === 'open')
    if (buyOpen.length) {
      lines.push(`【採購需求（未購買 ${buyOpen.length} 件；/prep 採購分頁，買好按已購買）】`)
      buyOpen.slice(0, 10).forEach(x => lines.push(`  - ${x.text || '（附件）'}（${x.by}・${x.ts}${x.url ? '・附連結' : ''}）`))
    }
    // 看板問題回報（pm_sop_issues＝夥伴在 /prep 站別旁⚠️回報的問題，附照片影片；與 App loadSpaceAIContext 同步接）
    const issDoc = kv['sp_finance_pm_sop_issues']
    const issOpen = ((issDoc || {}).list || []).filter(x => x.status === 'open')
    if (issOpen.length) {
      lines.push(`【看板問題回報（未解決 ${issOpen.length} 件；夥伴在 /prep 回報、解決後標記）】`)
      issOpen.slice(0, 10).forEach(x => lines.push(`  - 【${x.st}】${x.text || '（附件）'}（${x.by}・${x.ts}${(x.media || []).length ? `・附${x.media.length}檔` : ''}）`))
    }
    // 當月品項銷售彙總（答「哪些餐賣得好」用）
    const det = kv['sp_finance_pm_pos_d_' + mo]
    if (det && det.days) {
      const agg = {}
      Object.values(det.days).forEach(day => (day.sheets?.['總銷售額 (以類別分類)'] || []).forEach(sec => {
        if (sec.title === '總結') return
        const sfx = multiStore ? (/groun/i.test(day.store || '') ? '〔GROUN:D〕' : '〔A Beach〕') : '' // 兩店菜單重疊（都賣披薩），品名帶店名分開統計不混算
        ;(sec.rows || []).forEach(r => {
          if (!Array.isArray(r) || typeof r[0] !== 'string' || /^1\/4/.test(r[0].trim())) return // 1/4披薩=試營運切片，張良 2026-08-26 全部統計排除
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
      // 單日品項明細（張良 2026-09-27：DD 被問「9/25 各品項賣幾份」答不出→帶最近 3 個營業日/店的逐品項；更早的單日在庫但不塞進對話）
      const dayKeys2 = Object.keys(det.days).sort().reverse()
      const perStore2 = { ground: [], abeach: [] }
      for (const k2 of dayKeys2) { const st2 = /groun/i.test(det.days[k2].store || '') ? 'ground' : 'abeach'; if (perStore2[st2].length < 3) perStore2[st2].push(k2) }
      const dayLine2 = (k2) => {
        const items2 = []
        ;(det.days[k2].sheets?.['總銷售額 (以類別分類)'] || []).forEach(sec => {
          if (sec.title === '總結' || sec.title === '套餐') return
          ;(sec.rows || []).forEach(r => { if (!Array.isArray(r) || typeof r[0] !== 'string' || /^1\/4/.test(r[0].trim())) return; const q = Number(r[1]) || 0; if (q > 0) items2.push([r[0], q]) })
        })
        items2.sort((a, b) => b[1] - a[1])
        const head2 = items2.slice(0, 40).map(([n2, q]) => `${n2}×${q}`).join('、')
        const rest2 = items2.slice(40)
        return head2 + (rest2.length ? `…另 ${rest2.length} 項共 ${rest2.reduce((t2, x) => t2 + x[1], 0)} 份` : '')
      }
      lines.push('【單日品項明細（最近 3 個營業日/店；更早的單日請張良從 App 品項明細查）】')
      for (const st2 of ['ground', 'abeach']) for (const k2 of perStore2[st2]) lines.push(`  - ${k2.slice(0, 10)} ${st2 === 'ground' ? 'GROUN:D' : 'A Beach'}：${dayLine2(k2)}`)
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
          if (!Array.isArray(r) || typeof r[0] !== 'string' || (Number(r[1]) || 0) <= 0 || /^1\/4/.test(r[0].trim())) return // 1/4披薩同上排除
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

// ── 阿桑 boss-api（A Beach OPS 系統，api/boss-sync.js 每小時同步進 sp_finance_pm_boss_*）→ 文字（100%資料鐵則）──
// 涵蓋：每日結帳對帳/叫貨/菜單成本/AB班表/出勤加班事件/交接異常/備料例行/冰箱警報；營收本體已併營收頁不重複列
async function loadBossText() {
  try {
    const now = new Date(Date.now() + 8 * 3600e3)
    const today = now.toISOString().slice(0, 10)
    const ym = today.slice(0, 7).replace('-', '')
    const prevYm = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 7).replace('-', '')
    const nextYm = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1)).toISOString().slice(0, 7).replace('-', '')
    const K = (s, m) => `sp_finance_pm_boss_${s}_${m}`
    const kv = await kvGetMany([
      K('sett', ym), K('sett', prevYm), K('ord', ym), K('ord', prevYm), K('gord', ym), K('gord', prevYm), 'sp_finance_pm_boss_menu', 'sp_finance_pm_boss_revm',
      K('sched', ym), K('sched', nextYm), K('att', ym), K('att', prevYm), K('ot', ym), K('ot', prevYm),
      K('inc', ym), K('inc', prevYm), K('prep', ym), K('rout', ym), K('temp', ym),
    ])
    const rowsOf = (...ks) => ks.flatMap(k => Object.values((kv[k] || {}).rows || {}))
    const nt = (n) => 'NT$' + Math.round(n || 0).toLocaleString()
    const lines = ['【A Beach OPS（阿桑系統 boss-api，每小時自動同步；null=沒資料不是0）】']
    // 歷史月營收（/revenue/monthly 2026-10-04 阿桑新增：iCHEF 時代 2021-02 開店起；「日」明細 2026-04 起才有，更早只有月彙總）
    const revm = Object.values((kv['sp_finance_pm_boss_revm'] || {}).rows || {}).sort((a, b) => (a.month < b.month ? -1 : 1))
    if (revm.length) {
      const byY = {}
      revm.forEach(m => { const y = m.month.slice(0, 4); const o = byY[y] = byY[y] || { rev: 0, mo: 0 }; o.rev += Number(m.revenue) || 0; o.mo++ })
      lines.push(`  ◇ AB 歷史月營收（${revm[0].month} 開店起共 ${revm.length} 個月；2026-04 前只有月彙總無日明細）：年合計 ` + Object.entries(byY).map(([y, o]) => `${y}=${nt(o.rev)}(${o.mo}月)`).join('、'))
      // v4.38.4 改餵精確值（2026-10-04 DD 看到我們進位的「723」就跟張良瞎掰「資料顆粒度只到萬」；源頭 revm 存的是精確值=App每日數據同數）
      lines.push('    逐月（精確值,=App每日數據同數；⚠️這些舊月只有月彙總,query_pos_day 撈不到逐日,月營收以本行為準）：' + revm.map(m => `${m.month.slice(2).replace('-', '/')}:${Math.round(Number(m.revenue) || 0).toLocaleString()}`).join('、'))
    }
    // 每日結帳對帳：現金差/刷卡差/與POS差額（eats365_synced=false=還沒對帳不是差0）
    const sett = rowsOf(K('sett', ym), K('sett', prevYm)).sort((a, b) => (a.date < b.date ? 1 : -1))
    if (sett.length) {
      const bad = sett.filter(s => Math.abs(Number(s.cash_diff) || 0) + Math.abs(Number(s.card_diff) || 0) + Math.abs(Number(s.eats365_diff) || 0) > 0).slice(0, 10)
      lines.push(`  ◇ 每日結帳對帳（近兩個月 ${sett.length} 天）：最新 ${sett[0].date} 現金差${sett[0].cash_diff ?? '?'}／刷卡差${sett[0].card_diff ?? '?'}／POS差${sett[0].eats365_synced ? (sett[0].eats365_diff ?? 0) : '未對帳'}`)
      if (bad.length) { lines.push(`  ◇ 有帳差的日子（${bad.length} 天）：`); bad.forEach(s => lines.push(`    - ${s.date} 現金${s.cash_diff || 0}｜刷卡${s.card_diff || 0}｜POS${s.eats365_diff ?? '未對帳'}`)) }
    }
    // AB 叫貨（阿桑系統這份＝AB 實際在用的；成本只算已核准 approved）
    const ords = rowsOf(K('ord', ym), K('ord', prevYm))
    if (ords.length) {
      const ap = ords.filter(o => o.status === 'approved'), pend = ords.filter(o => o.status === 'pending')
      const sum = ap.reduce((t, o) => t + (Number(o.total_amount) || 0), 0)
      const byV = {}; ap.forEach(o => { byV[o.supplier || '(未填)'] = (byV[o.supplier || '(未填)'] || 0) + (Number(o.total_amount) || 0) })
      lines.push(`  ◇ AB 叫貨（近兩個月）：已核准 ${ap.length} 單共${nt(sum)}｜待審 ${pend.length} 單；廠商前5：` + Object.entries(byV).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, m]) => `${v}${nt(m)}`).join('、'))
      ords.sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1)).slice(0, 8).forEach(o => lines.push(`    - ${String(o.created_at).slice(0, 10)} ${o.supplier || '(未填)'}｜${o.status}｜${o.line_count}項 ${nt(o.total_amount)}${o.unpriced_lines > 0 ? `（${o.unpriced_lines}項沒單價,金額低估）` : ''}`))
    }
    // v4.70.40 GROUN:D 叫貨（阿桑 gops 系統 10-10 起入庫；張良 2026-10-11 問「GD 10 月叫貨訂單」DD 答沒資料＝只餵了 AB 這份）
    const gords = rowsOf(K('gord', ym), K('gord', prevYm))
    if (gords.length) {
      const ap = gords.filter(o => o.status === 'approved'), pend = gords.filter(o => o.status === 'pending')
      const sum = ap.reduce((t, o) => t + (Number(o.total_amount) || 0), 0)
      const byV = {}; ap.forEach(o => { byV[o.supplier || '(未填)'] = (byV[o.supplier || '(未填)'] || 0) + (Number(o.total_amount) || 0) })
      lines.push(`  ◇ GROUN:D 叫貨（近兩個月，含向 AB 央廚叫貨；要逐張全列／看明細用 query_orders 代查）：已核准 ${ap.length} 單共${nt(sum)}｜待審 ${pend.length} 單；廠商前5：` + Object.entries(byV).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, m]) => `${v}${nt(m)}`).join('、'))
      gords.sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1)).slice(0, 8).forEach(o => lines.push(`    - ${String(o.created_at).slice(0, 10)} ${o.supplier || '(未填)'}｜${o.status}｜${o.line_count}項 ${nt(o.total_amount)}${o.unpriced_lines > 0 ? `（${o.unpriced_lines}項沒單價,金額低估）` : ''}`))
    }
    // AB 菜單成本（估算值；cost_complete=false=配方缺價成本偏低不可盡信）
    const menu = Object.values((kv['sp_finance_pm_boss_menu'] || {}).rows || {}).filter(m => m.is_active)
    if (menu.length) {
      const costed = menu.filter(m => m.cost != null)
      lines.push(`  ◇ AB 菜單成本估算：上架 ${menu.length} 道、有配方 ${costed.length} 道（幾乎全部 cost_complete=false＝成本偏低僅供參考）；成本率最高：` + costed.sort((a, b) => (b.cost_ratio || 0) - (a.cost_ratio || 0)).slice(0, 5).map(m => `${m.name}${Math.round((m.cost_ratio || 0) * 100)}%`).join('、'))
    }
    // AB 班表（排班非打卡；status=cancelled 已排除）
    const sched = rowsOf(K('sched', ym), K('sched', nextYm)).filter(s => s.status !== 'cancelled' && s.work_date >= today).sort((a, b) => (a.work_date < b.work_date ? -1 : 1))
    if (sched.length) {
      const byD = {}; sched.forEach(s => (byD[s.work_date] = byD[s.work_date] || []).push(s.staff_name + (s.shift_code ? `(${s.shift_code})` : '')))
      lines.push('  ◇ AB 班表（今天起 7 天，阿桑系統）：')
      Object.entries(byD).slice(0, 7).forEach(([d, ns]) => lines.push(`    - ${d}：${ns.join('、')}`))
    }
    // 出勤/加班事件（人工回報：請假/遲到/加班；沒紀錄≠全勤）
    const att = rowsOf(K('att', ym), K('att', prevYm)).sort((a, b) => (a.date < b.date ? 1 : -1))
    if (att.length) { lines.push(`  ◇ AB 出勤事件（近兩個月 ${att.length} 筆，最近5）：`); att.slice(0, 5).forEach(e => lines.push(`    - ${e.date} ${e.item || ''}：${(e.people || []).join('、')}${e.hours ? `（${e.hours}h）` : ''}`)) }
    const ot = rowsOf(K('ot', ym), K('ot', prevYm))
    if (ot.length) { const hrs = ot.reduce((t, e) => t + (Number(e.hours_each) || 0) * ((e.people || []).length || 1), 0); lines.push(`  ◇ AB 加班（近兩個月）：${ot.length} 件、合計約 ${Math.round(hrs * 10) / 10} 人時`) }
    // 交接異常（不含人事類；status/stage 會變動）
    const inc = rowsOf(K('inc', ym), K('inc', prevYm))
    const incOpen = inc.filter(i => !['closed', 'dismissed'].includes(i.status)).sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))
    if (inc.length) {
      lines.push(`  ◇ AB 交接異常（近兩個月 ${inc.length} 筆、未結案 ${incOpen.length} 筆）：`)
      incOpen.slice(0, 10).forEach(i => lines.push(`    - ${String(i.created_at).slice(0, 10)}［${i.status}${i.stage ? '·' + i.stage : ''}］${i.cat || i.main_cat || ''}｜${String(i.detail || i.item || '').replace(/\n/g, ' ').slice(0, 50)}${i.assignee_name ? `（負責:${i.assignee_name}）` : ''}`))
    }
    // 備料/例行任務（今天）
    const prep = rowsOf(K('prep', ym)).filter(p => String(p.at || '').slice(0, 10) === today && !p.cancelled_at)
    const rout = rowsOf(K('rout', ym)).filter(r => r.biz_date === today)
    if (prep.length || rout.length) lines.push(`  ◇ AB 今日備料送出 ${prep.length} 筆、例行任務完成 ${rout.length} 項`)
    // 冰箱溫度警報（只列超標；空=沒異常）
    const temp = rowsOf(K('temp', ym))
    if (temp.length) { lines.push(`  ◇ ⚠️ AB 冰箱溫度超標 ${temp.length} 筆：`); temp.slice(0, 5).forEach(t => lines.push(`    - ${String(t.recorded_at).slice(0, 16)} ${t.device_label || t.device_id} ${t.temp_c}°C（${t.level}）`)) }
    return lines.length > 1 ? '\n' + lines.join('\n') : ''
  } catch (_) { return '' }
}

// ── EM 包場系統（小夏做的；api/em-sync.js 每小時全量進 sp_finance_pm_em）→ 文字（100%資料鐵則）──
async function loadEmText() {
  try {
    const em = await kvGet('sp_finance_pm_em')
    if (!em || !(em.projects || []).length) return ''
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const nt = (n) => 'NT$' + Math.round(n || 0).toLocaleString()
    const lines = ['【EM 包場/大訂（小夏系統，每小時自動同步；案件金額=actual_total 實收為準、quote=目前報價）】']
    const act = em.projects.filter(p => p.status !== '取消')
    const fut = act.filter(p => p.date >= today && !/結案/.test(p.status || '')).sort((a, b) => (a.date < b.date ? -1 : 1))
    if (fut.length) {
      lines.push(`  ◇ 未來案件 ${fut.length} 件：`)
      fut.slice(0, 20).forEach(p => lines.push(`    - ${p.date} ${p.start || ''}${p.end ? '-' + p.end : ''}｜${p.type || ''}${p.event ? '·' + p.event : ''}｜${p.n || '?'}人｜${p.venue || ''}｜${p.status}${p.deposit ? '·訂金' + p.deposit : ''}${p.quote ? '｜報價' + nt(p.quote) : ''}${p.owner ? '｜負責:' + p.owner : ''}${p.cust ? '｜客:' + p.cust : ''}`))
    } else lines.push('  ◇ 未來沒有進行中的包場/大訂案件')
    const done90 = act.filter(p => /結案/.test(p.status || '') && p.date >= new Date(Date.now() - 82 * 86400e3).toISOString().slice(0, 10))
    if (done90.length) lines.push(`  ◇ 近90天結案 ${done90.length} 件、實收合計 ${nt(done90.reduce((t, p) => t + (Number(p.actual) || 0), 0))}`)
    const openTk = (em.tasks || []).filter(t => t.st !== '已完成')
    if (openTk.length) {
      lines.push(`  ◇ EM 未完成任務 ${openTk.length} 件（最近到期 10 件）：`)
      openTk.sort((a, b) => (String(a.due || '9999') < String(b.due || '9999') ? -1 : 1)).slice(0, 10).forEach(t => lines.push(`    - ${t.due || '無期限'}［${t.dept || ''}］${t.title}${t.who ? '（' + t.who + '）' : ''}｜案:${t.code || t.ptitle || ''}`))
    }
    return '\n' + lines.join('\n')
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
    const mo = new Date().toISOString().slice(0, 7)
    const prevMo = `${Number(mo.slice(0, 4)) - (mo.slice(5) === '01' ? 1 : 0)}-${String(((Number(mo.slice(5, 7)) + 10) % 12) + 1).padStart(2, '0')}` // 上個日曆月（−32天在月初會跳月）
    const [kv2, recipes] = await Promise.all([
      kvGetMany(['sp_supply_pm_supply', 'sp_supply_pm_orders', 'sp_supply_pm_price_flags', 'sp_supply_pm_ph_' + mo, 'sp_supply_pm_ph_' + prevMo, 'sp_supply_pm_editlog_' + mo]),
      kvGetPrefix('sp_supply_pm_recipe_v_'),
    ])
    // 價格歷史（pm_ph_月檔近兩個月）/疑似有誤旗標（pm_price_flags）/編輯紀錄（pm_editlog_月檔）——100%資料鐵則，與 App 同接
    const priceRows = [...(kv2['sp_supply_pm_ph_' + prevMo]?.rows || []), ...(kv2['sp_supply_pm_ph_' + mo]?.rows || [])]
    return supplyDigest({ supply: kv2['sp_supply_pm_supply'], orders: kv2['sp_supply_pm_orders'], recipes, priceRows, priceFlags: kv2['sp_supply_pm_price_flags'], editRows: kv2['sp_supply_pm_editlog_' + mo]?.rows })
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

async function answer(question, snaps, accountsText, financeText, activityText, estimatesText, crewText, canAct, history, memoryText, conclusionsText, tasksText, sheetText, posText, catalogText, supplyText, lineQuotaText, filelibText, groupChatText, moneyOK = true) {
  // 外部群（moneyOK=false）：不給任何金額/財務資料，並下鐵令禁止透露
  const moneyGuard = moneyOK ? '' : '\n\n⚠️【外部群鐵律】這個群是「外部群」，你**絕對禁止**透露任何：金額、預估/已付/未付、單價、報價、成本、營業額、銀行/帳戶餘額、零用金、財務數字、薪資。被問到金額類一律回「這部分金額不方便在這裡提供，我私下跟張哥確認 🙏」，不要旁敲側擊地洩漏。你可以講進度、工序、一般事務、用 web_search 查一般問題。'
  // v2.5.9 唯讀鐵令（2026-09-16 翻車：群組叫 DD 建 7 件任務，DD 沒有寫入權卻回了整篇「都建好了」）：
  // 沒有動作指南＝這輪根本執行不了任何寫入 → 必須明講，禁止 AI 用人設「演」出已完成
  const readonlyGuard = canAct ? '' : ('\n\n⚠️【唯讀鐵令】這一輪你「沒有」任何寫入能力：不能建任務/大項、不能記帳、不能記日誌、不能改資料——系統不會執行任何指令。被要求「記下來/建任務/整理成任務」時，你**絕對禁止**說「已建好/已記好/都建好了/開好了」這類完成話術（說了＝說謊，系統會抓包標警語）。正確回法：先把內容條列整理好，然後明講「我在這裡沒有寫入權限，請張良（操作者）在群組直接下指令、或私訊我一句『照上面建』，我就真的建進去」。'
    + '\n\n【你可以查 A Beach 訂位檔期（唯讀，不用確認）】有人問某天「有沒有訂位/有沒有檔期/空不空/那天能不能辦/包場」時，輸出一行 JSON 指令讓系統代查：\n```json\n{"type":"query_resv","date":"2027-06-18"}\n```\ndate 用 YYYY-MM-DD（單日）或 YYYY-MM（整月）；要查一段期間加 "to":"YYYY-MM-DD"。系統會把「檔期狀況」查好回填給你，你再據此回答——你沒有「稍後再傳」的能力，要查就必須在這一則同時輸出這段 JSON（只說要查卻沒帶 JSON＝永遠不會查）。'
    + (moneyOK ? '' : '\n\n⚠️這個群只能查「檔期狀況」（某天空檔／已有幾組幾人／可能包場），系統查回來的資料本來就不含客人姓名、電話、備註內容——這些是客人個資，對外一律不提供。有人問「誰訂的／客人電話／某客人來過幾次」時，回「客人資料這邊不方便提供，要查請私訊張哥 🙏」，不要用 query_resv 的 name/top。'))
  const system = (canAct ? BOT_AGENT_GUIDE + '\n\n' : '') + BOT_PERSONA + readonlyGuard + moneyGuard + (memoryText || '') + sysDataHead() + snapshotsToContext(snaps, moneyOK) + (tasksText || '') + (moneyOK ? (accountsText || '') : '') + (moneyOK ? (financeText || '') : '') + (activityText || '') + (moneyOK ? (estimatesText || '') : '') + (crewText || '') + (conclusionsText || '') + (sheetText || '') + (moneyOK ? (posText || '') : '') + (moneyOK ? (supplyText || '') : '') + (lineQuotaText || '') + (catalogText || '') + (filelibText || '') + (moneyOK ? (groupChatText || '') : '')
  const messages = [...(Array.isArray(history) ? history : []), { role: 'user', content: question }]
  // v4.70.29 走 AI 中樞 route=dd（設定頁可選 ChatGPT／Claude／Gemini；cache=system 可快取→Claude 連續對話輸入成本大降）；選的那家壞了自動退備援，D哥不會啞掉
  const tAi = Date.now()
  try {
    const { aiCall } = await import('./_ai.js')
    const r = await aiCall('dd', { system, messages, maxTokens: 3000, cache: true })
    if (r.tried && r.tried.length) console.log('dd primary failed → used', r.provider, r.model, r.tried)
    aiAggAdd(r, system, tAi) // v4.70.39 健康紀錄：這輪用哪家、備援、token、是否截斷
    return r.text || '（沒有內容）'
  } catch (e) {
    console.log('dd ai all failed', e.message, e.tried)
    aiAggAdd(null, system, tAi, e)
    return /尚未設定金鑰/.test(e.message || '') ? '（D哥的 AI 金鑰尚未設定。）' : '（AI 回應失敗，請稍後再試）'
  }
}
// v4.70.39 一個事件內所有 AI 呼叫的彙總（代查迴圈一題可能打 2–4 次）：calls／fb 備援次數／err／it 輸入 token／inCut 輸入被「中段略」截斷／outCut 輸出撞到 3000 上限
let _aiAgg = null
const aiAggReset = () => { _aiAgg = { calls: 0, fb: 0, err: 0, it: 0, ot: 0, ms: 0, inCut: 0, outCut: 0, provider: '', model: '' } }
function aiAggAdd(r, system, t0, e) {
  if (!_aiAgg) aiAggReset()
  const A = _aiAgg; A.calls++; A.ms += Date.now() - t0
  if (String(system || '').includes('（中段略）')) A.inCut++
  if (e) { A.err++; A.lastErr = String(e.message || e).slice(0, 120); if (e.tried && e.tried.length) A.fb += e.tried.length; return }
  const u = r.usage || {}
  const it = +(u.input_tokens ?? u.prompt_tokens ?? u.promptTokenCount ?? 0) + +(u.cache_read_input_tokens ?? 0) + +(u.cache_creation_input_tokens ?? 0)
  const ot = +(u.output_tokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? 0)
  A.it += it; A.ot += ot; A.provider = r.provider || ''; A.model = r.model || ''
  if (r.tried && r.tried.length) A.fb++
  if (ot >= 2950) A.outCut++
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
// 空間解析（v2.1.2 治本：以前只有 add_task 會跨空間，add_category/update_task/刪除都寫死工程
// → 張良叫D哥在團隊工作建大項/拆卡/刪合併卡全被「我做不到」擋回。現在四個指令共用這套）
const SPACE_PFX = { 工程: '', 團隊: 'sp_team_', 夥伴: 'sp_crew_', 財務: 'sp_finance_' }
const spaceOf = (s) => Object.keys(SPACE_PFX).find(k => String(s || '').includes(k)) || '工程'

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
    case 'add_category': return `新增大項「${a.name || '?'}」${a.space && a.space !== '工程' ? `（→${a.space}空間）` : ''}`
    case 'delete_category': return `刪除大項「${a.category || '?'}」`
    case 'set_category_status': return `把大項「${a.category || '?'}」狀態改成 ${a.status || '?'}`
    case 'add_item': return `在「${a.category || '?'}」新增細項「${a.name || '?'}」${a.unitPrice ? `（單價 ${fmtNT(a.unitPrice)}×${a.qty || 1}）` : ''}`
    case 'set_item': case 'set_item_status': return `更新「${a.category || '?'}／${a.item || a.itemName || '?'}」${a.status ? ` 狀態→${a.status}` : ''}`
    case 'delete_item': return `刪除「${a.category || '?'}」的細項「${a.item || a.itemName || '?'}」`
    case 'add_payment': return `「${a.category || '?'}」新增付款 ${fmtNT(a.amount)}`
    case 'add_todo': case 'add_task': return `新增任務「${a.desc || a.content || a.title || '?'}」${a.space && a.space !== '工程' ? `（→${a.space}空間）` : ''}${a.category ? `（歸到 ${a.category}）` : ''}${a.due ? `（交期 ${a.due}）` : ''}${a.owner ? `（負責:${a.owner}）` : ''}${a.estimatedMinutes ? `（預估${a.estimatedMinutes}分）` : ''}`
    case 'update_task': { const ks = ['status', 'owner', 'waitingFor', 'estimatedMinutes', 'dependsOn', 'due', 'start', 'priority', 'category', 'tags', 'note', 'newTitle'].filter(k => a[k] !== undefined); return `更新任務「${a.task || a.title || '?'}」${a.space && a.space !== '工程' ? `（${a.space}空間）` : ''}→ 改 ${ks.join('、') || '?'}` }
    case 'delete_task': return `刪除任務「${a.task || a.title || '?'}」${a.space && a.space !== '工程' ? `（${a.space}空間）` : ''}`
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
  results.created = [] // 這輪新建的任務（掛在陣列屬性上，不影響 join；給「快速設定卡」用）
  for (const a of actions) {
    const t = a.type
    try {
      if (t === 'add_category') {
        // 跨空間建大項（張良 2026-09-01：叫D哥在團隊工作建「採購/營運/表單/SOP」被拒——以前只會寫工程 pm_data）
        const spName = spaceOf(a.space), pfx = SPACE_PFX[spName]
        if (pfx) {
          const key = pfx + 'pm_data'
          const cur = (await kvGetMany([key]))[key]
          const list = Array.isArray(cur) ? cur : []
          const nm = a.name || '新大項'
          if (list.some(c => c.name === nm)) { results.push(`⚠️ ${spName}空間已有大項「${nm}」，不重複建`); continue }
          list.push({ id: 'cat-' + bid(''), order: list.length, name: nm, budget: Number(a.budget) || 0, status: 'pending', items: [] })
          await kvSet(key, list)
          results.push(`➕ 新增大項「${nm}」→ ${spName}空間`); audits.push([pfx + 'pm_activity', '新增', `新增大項「${nm}」（D哥）`])
          continue
        }
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
        // 跨空間新增（張良 2026-09-01：14 筆要進「團隊工作」卻被記到工程——以前只會寫工程空間）：
        // space=工程(預設)/團隊/夥伴/財務 → 各空間任務一筆一檔 sp_<id>_pm_task_*
        // v2.1.2：category/dependsOn 跨空間也吃了（用該空間自己的 pm_data 大項與任務清單解析）
        const spName = spaceOf(a.space)
        if (SPACE_PFX[spName]) {
          const pfx = SPACE_PFX[spName]
          const others = await kvGetPrefix(pfx + 'pm_task_') // 算 ord（新任務排最前，跟 App 一致）＋解析 dependsOn
          let mo = 0; others.forEach(x => { if (typeof x.ord === 'number' && x.ord < mo) mo = x.ord })
          const cats2raw = a.category ? (await kvGetMany([pfx + 'pm_data']))[pfx + 'pm_data'] : null
          const tc2 = a.category ? findCat(Array.isArray(cats2raw) ? cats2raw : [], a.category) : null
          const nid = 't-' + bid('')
          const ex2 = {}
          if (a.owner !== undefined) ex2.owner = a.owner
          if (a.waitingFor !== undefined) ex2.waitingFor = a.waitingFor
          if (a.estimatedMinutes !== undefined) ex2.estimatedMinutes = a.estimatedMinutes
          if (a.pinned !== undefined) ex2.pinned = a.pinned
          if (a.dependsOn !== undefined) ex2.dependsOn = resolveDeps(a.dependsOn, others)
          const np2 = normalizePatch(ex2, nid, others)
          await kvSet(pfx + 'pm_task_' + nid, { id: nid, title, note: '', status: 'todo', catId: tc2 ? tc2.id : '__inbox__', start: '', due: a.due || '', priority: TASK_PRIO[a.priority] || (a.urgent ? 'urgent' : 'normal'), tags: Array.isArray(a.tags) ? normalizePatch({ tags: a.tags }).tags : [], ord: mo - 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...np2 })
          results.push(`📝 新增任務「${title.slice(0, 20)}」→ ${spName}空間·${tc2 ? tc2.name : '收件匣'}`); audits.push([pfx + 'pm_activity', '新增', `新增任務「${title.slice(0, 20)}」（D哥跨空間）`])
          results.created.push({ id: nid, title, sp: spName })
          continue
        }
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
        results.created.push({ id: newId, title, sp: '工程' })
      } else if (t === 'update_task') {
        // Merge Rule：只帶要改的欄位；沒帶的完全不動（{...existing, ...patch}）
        // v2.1.2 跨空間：space≠工程 → 直接對該空間逐筆檔操作（以前被「僅限工程」擋掉）
        const spName2 = spaceOf(a.space), pfx2 = SPACE_PFX[spName2]
        if (pfx2) {
          const list2 = await kvGetPrefix(pfx2 + 'pm_task_')
          const tg = findTask(list2, a.task || a.title)
          if (!tg) { results.push(`⚠️ ${spName2}空間找不到任務「${a.task || a.title || '?'}」`); continue }
          const patch2 = {}
          if (a.newTitle != null && String(a.newTitle).trim()) patch2.title = String(a.newTitle).trim()
          if (a.note !== undefined) patch2.note = a.note || ''
          if (a.status != null && TASK_STATUS[String(a.status).trim()]) patch2.status = TASK_STATUS[String(a.status).trim()]
          if (a.due !== undefined) patch2.due = a.due || ''
          if (a.start !== undefined) patch2.start = a.start || ''
          if (a.priority != null && TASK_PRIO[String(a.priority).trim()]) patch2.priority = TASK_PRIO[String(a.priority).trim()]
          if (a.category != null) { const c2raw = (await kvGetMany([pfx2 + 'pm_data']))[pfx2 + 'pm_data']; const c2 = findCat(Array.isArray(c2raw) ? c2raw : [], a.category); if (c2) patch2.catId = c2.id; else if (/收件匣/.test(String(a.category))) patch2.catId = '__inbox__' }
          if (a.owner !== undefined) patch2.owner = a.owner
          if (a.waitingFor !== undefined) patch2.waitingFor = a.waitingFor
          if (a.estimatedMinutes !== undefined) patch2.estimatedMinutes = a.estimatedMinutes
          if (a.dependsOn !== undefined) patch2.dependsOn = resolveDeps(a.dependsOn, list2)
          if (a.pinned !== undefined) patch2.pinned = a.pinned
          if (a.tags !== undefined) patch2.tags = Array.isArray(a.tags) ? a.tags : []
          await kvSet(pfx2 + 'pm_task_' + tg.id, mergeTask(tg, patch2, list2))
          const what2 = Object.keys(patch2).join('、') || '（無變更）'
          results.push(`✏️ 更新任務「${tg.title.slice(0, 20)}」（${spName2}空間）：${what2}`)
          audits.push([pfx2 + 'pm_activity', '編輯', `更新任務「${tg.title.slice(0, 20)}」(${what2})（D哥）`])
          continue
        }
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
      } else if (t === 'delete_task') {
        // v2.1.2 新增：刪任務（跨空間）。張良場景：合併卡拆成獨立任務後，原合併卡要刪掉才不重複
        // ——以前 D哥只能回「請去 App 手動刪」。刪除屬確認類（AUTO_TYPES 之外），使用者按確認才會走到這。
        const spName3 = spaceOf(a.space), pfx3 = SPACE_PFX[spName3]
        if (pfx3) {
          const list3 = await kvGetPrefix(pfx3 + 'pm_task_')
          const tg3 = findTask(list3, a.task || a.title)
          if (!tg3) { results.push(`⚠️ ${spName3}空間找不到任務「${a.task || a.title || '?'}」`); continue }
          await kvDel(pfx3 + 'pm_task_' + tg3.id)
          // 清掉同空間其他任務對它的 dependsOn 引用（跟 App 的 removeTaskAndRefs 同一套規則）
          for (const x of list3) if ((x.dependsOn || []).includes(tg3.id)) await kvSet(pfx3 + 'pm_task_' + x.id, { ...x, dependsOn: x.dependsOn.filter(d => d !== tg3.id), updatedAt: new Date().toISOString() })
          results.push(`🗑️ 刪除任務「${tg3.title.slice(0, 20)}」（${spName3}空間）`)
          audits.push([pfx3 + 'pm_activity', '刪除', `刪除任務「${tg3.title.slice(0, 20)}」（D哥）`])
        } else {
          const tg3 = findTask(tasks, a.task || a.title)
          if (!tg3) { results.push(`⚠️ 找不到任務「${a.task || a.title || '?'}」`); continue }
          tasks = tasks.filter(x => x.id !== tg3.id).map(x => (x.dependsOn || []).includes(tg3.id) ? mergeTask(x, { dependsOn: x.dependsOn.filter(d => d !== tg3.id) }, tasks) : x)
          if (tR.v2) await kvDel('pm_task_' + tg3.id)
          changed.add('pm_tasks') // v2＝只把「引用被清掉」的那幾筆差異寫回；舊整包＝整包寫回（已含刪除）
          results.push(`🗑️ 刪除任務「${tg3.title.slice(0, 20)}」`)
          audits.push(['pm_activity', '刪除', `刪除任務「${tg3.title.slice(0, 20)}」（D哥）`])
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
// ── 回收訊息監控＋群訊息流：群訊息滾動快取（回收監控用；同時餵給 DD 當「群組對話紀錄」能整理會議）──
async function cacheGroupMsg(ev) {
  try {
    const cache = asObj((await kvGetMany(['pm_bot_msgcache']))['pm_bot_msgcache'])
    const list = Array.isArray(cache.list) ? cache.list : []
    const names = asObj(cache.names)
    const uid = ev.source?.userId || ''
    if (uid && !names[uid]) names[uid] = (await getLineProfile(uid)) || uid.slice(-6) // 顯示名稱每人只查一次、之後重用
    list.push({ id: ev.message.id, gid: ev.source?.groupId || ev.source?.roomId || '', uid, text: (ev.message.text || '').slice(0, 300), ts: ev.timestamp || Date.now() })
    await kvSet('pm_bot_msgcache', { list: list.slice(-600), names })
  } catch (_) {}
}
// 群組訊息流 → 文字（餵給 DD：整理會議、答「昨天某群誰講了什麼」。LINE 不給抓歷史，只有 DD 在場聽到的才有）
async function loadGroupChatText() {
  try {
    const m = await kvGetMany(['pm_bot_msgcache', 'pm_group_seen'])
    const cache = asObj(m['pm_bot_msgcache'])
    const list = Array.isArray(cache.list) ? cache.list : []
    if (!list.length) return ''
    const names = asObj(cache.names)
    const seen = asObj(m['pm_group_seen'])
    const gname = (gid) => (seen[gid] && seen[gid].name) || ('群…' + String(gid).slice(-4))
    const fmtT = (ts) => new Date(ts).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })
    const recent = list.slice(-300)
    const lines = [`\n\n【群組訊息流（你在場的群最近 ${recent.length} 則原文，台北時間 月/日 時:分。被要求「整理會議/重點/採購清單」「昨天某群講了什麼」就用這份，別再說讀不到群組訊息）】`]
    recent.forEach(x => lines.push(`  - ${fmtT(x.ts)}｜${gname(x.gid)}｜${names[x.uid] || '成員'}：${x.text}`))
    return lines.join('\n')
  } catch (_) { return '' }
}
// DD 最近主動發給這位的通知（v4.22.0 張良「DD 不會知道我在問上一句話」）：使用者針對通知追問時接得上
async function loadPushLogText(convId) {
  try {
    const arr = asObj((await kvGetMany(['pm_bot_pushlog']))['pm_bot_pushlog'])[convId] || []
    const cut = Date.now() - 12 * 3600e3
    const recent = arr.filter(x => x && x.ts > cut).slice(-10)
    if (!recent.length) return ''
    const fmtT = (ts) => new Date(ts).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })
    return '\n\n【你最近主動發給這位的通知（台北時間 月/日 時:分，最新在後）——他現在很可能在針對這些追問（例如對「遲到通知」問「是打幾點的卡」就是問通知裡那個人）。先把他的話當成接續這些通知的對話，別當成全新問題重頭猜：\n' + recent.map(x => `  - ${fmtT(x.ts)}：${String(x.text).replace(/\n/g, ' ／ ')}`).join('\n') + '】'
  } catch (_) { return '' }
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
// 🔎 DD 資料代查工具（張良 2026-09-27「一直出現一樣的問題,可以根除嗎」——根除法：不再靠預塞摘要,AI 需要什麼自己下指令查庫）
async function queryPosDay(date, store) {
  if (/^\d{4}-\d{2}$/.test(String(date || ''))) { // v4.31.2 整月代查（張良抓包：補整月卻一天一天查、2筆就斷）：回每日營收+月合計
    const stM = /ab|beach/i.test(store || '') ? 'abeach' : 'ground'
    const kvM = await kvGetMany(['sp_finance_pm_pos'])
    const esM = (((kvM['sp_finance_pm_pos'] || {}).entries) || []).filter(e => e.date.slice(0, 7) === date && ((/groun/i.test(e.store || '') ? 'ground' : 'abeach') === stM)).sort((a, b) => (a.date < b.date ? -1 : 1))
    if (!esM.length) return `（${date} ${stM === 'ground' ? 'GROUN:D' : 'A Beach'} 整月沒有入庫資料）`
    const totM = esM.reduce((t, e) => t + (Number(e.revenue) || 0), 0)
    return `◆ ${date} ${stM === 'ground' ? 'GROUN:D' : 'A Beach'} 整月（系統代查，共 ${esM.length} 天）\n` + esM.map(e => `  - ${e.date} NT$${Math.round(e.revenue || 0).toLocaleString()}${e.txCount ? `｜${e.txCount}單` : ''}`).join('\n') + `\n  ＝月合計 NT$${Math.round(totM).toLocaleString()}`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '（日期格式要 YYYY-MM-DD，或 YYYY-MM 查整月）'
  const st = /ab|beach/i.test(store || '') ? 'abeach' : 'ground'
  const kv2 = await kvGetMany(['sp_finance_pm_pos', 'sp_finance_pm_pos_d_' + date.slice(0, 7)])
  const ent = (((kv2['sp_finance_pm_pos'] || {}).entries) || []).find(e => e.date === date && ((/groun/i.test(e.store || '') ? 'ground' : 'abeach') === st))
  const day = (((kv2['sp_finance_pm_pos_d_' + date.slice(0, 7)] || {}).days) || {})[date + '::' + st]
  if (!ent && !day) return `（${date} ${st === 'ground' ? 'GROUN:D' : 'A Beach'} 沒有入庫資料——可能公休或還沒進來）`
  const L = [`◆ ${date} ${st === 'ground' ? 'GROUN:D' : 'A Beach'} 單日完整明細（系統代查）`]
  if (ent) L.push(`營收 NT$${ent.revenue}｜單數 ${ent.txCount || '?'}｜現金 ${ent.cash || 0}｜卡 ${ent.card || 0}｜LINE Pay ${ent.linepay || 0}｜Uber ${ent.uber || 0}｜折扣 ${ent.discount || 0}`)
  const secs = ((day || {}).sheets || {})['總銷售額 (以類別分類)']
  if (Array.isArray(secs)) {
    const items = []
    secs.forEach(sec => { if (sec.title === '總結') return; (sec.rows || []).forEach(r => { if (!Array.isArray(r) || typeof r[0] !== 'string' || /^1\/4/.test(r[0].trim())) return; const q = Number(r[1]) || 0; if (q > 0) items.push([r[0], sec.title, q, Math.round(Number(r[r.length - 1]) || 0)]) }) })
    items.sort((a, b) => b[2] - a[2])
    L.push(`逐品項（${items.length} 項，份數降冪）：`)
    items.forEach(x => L.push(`  - ${x[0]}［${x[1]}］×${x[2]}｜NT$${x[3]}`))
  }
  const slot = ((day || {}).sheets || {})['時段分析(每小時)']
  if (Array.isArray(slot) && slot[0]) { L.push('時段（每小時營業額）：'); (slot[0].rows || []).forEach(r => { if (Array.isArray(r) && r.length) L.push(`  ${r[0]}時 NT$${Math.round(Number(r[r.length - 1]) || Number(r[1]) || 0)}`) }) }
  return L.join('\n')
}
// 🔎 訂位代查（inline 全檔；張良 2026-10-03「資料都串了為什麼摘要限制45天/20人」→治本：
//   背景摘要只是快取，任何日期/區間（2021-02 開店～未來）都能用這支當場撈完整明細＋當日備註）
// 🔎 訂位「檔期」公開查詢（v4.54.0 張良「開放婚禮顧問群任何人問訂位」）：外部群專用＝只回某天空/滿/可能包場，
// 零客人個資（不輸出姓名/電話/客註/備註內容）——婚禮顧問要的是檔期，不需要客人資料；個資外洩從源頭杜絕
async function queryResvPublic(from, to) {
  let f = String(from || ''), t2 = String(to || '')
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(f)) return '（要給日期：YYYY-MM-DD 或整月 YYYY-MM）'
  if (/^\d{4}-\d{2}$/.test(f)) { if (!t2) t2 = f + '-31'; f = f + '-01' }
  if (!t2) t2 = f
  if (/^\d{4}-\d{2}$/.test(t2)) t2 = t2 + '-31'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t2) || t2 < f) return '（日期格式要 YYYY-MM-DD，且結束不能早於起日）'
  const mos = []
  for (let m = f.slice(0, 7); m <= t2.slice(0, 7);) { mos.push(m); m = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)).toISOString().slice(0, 7) }
  if (mos.length > 4) return '（一次最多查 4 個月）'
  const kv3 = await kvGetMany(mos.map((m) => 'sp_finance_pm_inline_' + m).concat(['sp_finance_pm_inline_notes']))
  const notes = ((kv3['sp_finance_pm_inline_notes'] || {}).days) || {}
  const L = [`◆ A Beach 檔期 ${f}${t2 !== f ? `~${t2}` : ''}（只回檔期狀況，不含客人資料）`]
  let any = false
  for (const m of mos) {
    const days = ((kv3['sp_finance_pm_inline_' + m] || {}).days) || {}
    for (const d of Object.keys(days).sort()) {
      if (d < f || d > t2) continue
      any = true
      const ok = days[d].filter((r) => r.st !== 2 && r.st !== 5)
      const wd = '日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()]
      const nn = ok.filter((r) => r.t && r.t < '17:00').length, ee = ok.filter((r) => r.t && r.t >= '17:00').length
      const tp = ok.reduce((t, r) => t + (r.n || 0), 0), big = ok.some((r) => (r.n || 0) >= 20)
      L.push(`  - ${d.slice(5)}(${wd})：${ok.length ? `已有 ${ok.length} 組 ${tp} 人（午 ${nn}/晚 ${ee}）${big ? '・含大組(可能包場)' : ''}` : '目前空檔'}`)
    }
  }
  const dn = Object.keys(notes).filter((d) => d >= f && d <= t2 && (notes[d] || []).some((n) => /包場|全包|關閉|公休|不開/.test(String(n.note || '')))).sort()
  dn.forEach((d) => L.push(`  - ${d.slice(5)} ⚠️ 有營運註記（可能包場/公休——細節請私訊張良確認）`))
  if (!any && !dn.length) L.push('  （這段期間查到的日子都是空檔，沒有訂位）')
  return L.join('\n')
}
async function queryResvDay(from, to, kw) {
  let f = String(from || ''), t2 = String(to || '')
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(f)) return '（日期格式要 YYYY-MM-DD 或 YYYY-MM 整月；可加 to 查區間）'
  if (/^\d{4}-\d{2}$/.test(f)) { if (!t2) t2 = f + '-31'; f = f + '-01' }
  if (!t2) t2 = f
  if (/^\d{4}-\d{2}$/.test(t2)) t2 = t2 + '-31'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t2) || t2 < f) return '（to 格式要 YYYY-MM-DD 且不能早於起日）'
  const mos = []
  for (let m = f.slice(0, 7); m <= t2.slice(0, 7);) { mos.push(m); m = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)).toISOString().slice(0, 7) }
  if (mos.length > 4) return '（一次最多查 4 個月的區間，請分段）'
  const kv3 = await kvGetMany(mos.map((m) => 'sp_finance_pm_inline_' + m).concat(['sp_finance_pm_inline_notes']))
  const notes = ((kv3['sp_finance_pm_inline_notes'] || {}).days) || {}
  const ST = { 1: '已確認', 2: '已取消', 3: '待確認', 4: '已入座', 5: '已取消', 6: '已確認' }
  // v4.38.4 關鍵字過濾（張良「用搜尋功能就能找到我要的資料跟數量,不是嗎」）：kw=只回「姓名/客註/店註/當日備註」命中的筆,先在資料庫端篩完才給AI,不整月硬塞
  const kw9 = String(kw || '').trim()
  if (kw9) {
    const Lk = [`◆ A Beach 訂位 ${f}${t2 !== f ? `~${t2}` : ''} 關鍵字「${kw9}」（系統代查=搜姓名/客註/店註）`]
    let nHit = 0
    for (const m of mos) {
      const days = ((kv3['sp_finance_pm_inline_' + m] || {}).days) || {}
      for (const d of Object.keys(days).sort()) {
        if (d < f || d > t2) continue
        for (const r of days[d]) {
          if (![r.name, r.note, r.inote].some(x => String(x || '').includes(kw9))) continue
          nHit++
          Lk.push(`  - ${d} ${r.t || '未填'} ${r.name} ${r.n}人｜${ST[r.st] || r.st}${r.phone ? `｜${r.phone}` : ''}${r.note ? `｜客註:${String(r.note).slice(0, 60)}` : ''}${r.inote ? `｜店註:${String(r.inote).slice(0, 60)}` : ''}`)
        }
      }
    }
    const dnK = Object.keys(notes).filter(d => d >= f && d <= t2 && (notes[d] || []).some(n => String(n.note || '').includes(kw9))).sort()
    if (dnK.length) { Lk.push('當日備註命中：'); dnK.forEach(d => (notes[d] || []).filter(n => String(n.note || '').includes(kw9)).forEach(n => Lk.push(`  - ${d} ${String(n.note).replace(/\s+/g, ' ').slice(0, 80)}`))) }
    Lk.splice(1, 0, `共命中 ${nHit} 筆訂位＋${dnK.length} 天備註（0 筆=這段期間沒有任何含「${kw9}」的訂位/備註；婚禮包場也可能只寫在備註沒寫關鍵字,保險起見可再用不帶 kw 的整月精簡模式掃大組）`)
    return Lk.join('\n')
  }
  // v4.38.3 大區間精簡模式（2026-10-04 真實翻車：代查九月=1182筆逐筆全塞,AI輸入爆掉回「AI 回應失敗」兩次）：
  // >7天=每天一行統計+只逐列「≥20人大組 或 有客註/店註」的訂位（婚禮/包場線索都在備註,一筆不漏）；要完整逐筆用單日再查
  const compact = (new Date(t2) - new Date(f)) / 86400e3 > 7
  const L = [`◆ A Beach 訂位 ${f}${t2 !== f ? `~${t2}` : ''}（系統代查 inline 全檔${compact ? '；區間>7天=精簡模式:每天一行合計+只逐列大組(≥20人)/有備註的訂位,要某天完整逐筆用單日再查' : ''}）`]
  let any = false
  for (const m of mos) {
    const days = ((kv3['sp_finance_pm_inline_' + m] || {}).days) || {}
    for (const d of Object.keys(days).sort()) {
      if (d < f || d > t2) continue
      any = true
      if (!compact) {
        L.push(`${d}（${days[d].length}筆）：`)
        days[d].forEach((r) => L.push(`  - ${r.t || '候位'} ${r.name} ${r.n}人｜${r.ty === 4 ? '候補⚠️' : r.ty === 3 || r.ty === 1 ? '現場客' : ''}${ST[r.st] || r.st}${r.phone ? `｜${r.phone}` : ''}${r.kc ? `｜兒童椅${r.kc}` : ''}${r.note ? `｜客註:${String(r.note).slice(0, 40)}` : ''}${r.inote ? `｜店註:${String(r.inote).slice(0, 40)}` : ''}`))
      }
      // 系統算好的合計（2026-10-04 DD 心算 34≠33 抓包）：有效=st∉{2,5}；分時段+全天；引用這些數字別自己加
      // v4.38.2 沒填時間的也要計入（之前 && r.t 直接漏掉＝100人包場沒填時間就從合計消失）＋午/晚場總計（張良切法：17:00前=中午、17:00後=晚上，17-18店休息）
      const ok9 = days[d].filter((r) => r.st !== 2 && r.st !== 5 && r.ty !== 4)
      const slot9 = (t9) => (!t9 ? '未填時間' : t9 < '13:00' ? '午12-13' : t9 < '17:00' ? '午13-17' : t9 < '19:00' ? '晚18-19' : '晚19後')
      const agg9 = {}
      ok9.forEach((r) => { const s9 = slot9(r.t || ''); const a9 = agg9[s9] = agg9[s9] || { g: 0, p: 0, k: 0, pend: 0 }; a9.g++; a9.p += r.n || 0; a9.k += (r.kc || 0) + (r.ks || 0); if (r.st === 3) a9.pend++ })
      const tp = ok9.reduce((t9, r) => t9 + (r.n || 0), 0), tkc = ok9.reduce((t9, r) => t9 + (r.kc || 0), 0), tks = ok9.reduce((t9, r) => t9 + (r.ks || 0), 0), tpd = ok9.filter((r) => r.st === 3).length
      const wl9 = days[d].filter((r) => r.ty === 4 && r.st !== 2 && r.st !== 5), wlG9 = wl9.reduce((t9, r) => t9 + (r.n || 0), 0)
      const kcWho = tkc ? ok9.filter((r) => r.kc).map((r) => `${r.name}${r.kc}張`).join('、') : ''
      const nn9 = ok9.filter((r) => r.t && r.t < '17:00'), ee9 = ok9.filter((r) => r.t && r.t >= '17:00'), nt9 = ok9.filter((r) => !r.t)
      if (compact) {
        const wd9 = '日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()]
        const cx9 = days[d].length - ok9.length
        L.push(`${d.slice(5)}(${wd9}) 有效${ok9.length}組${tp}人(午${nn9.length}/晚${ee9.length}${nt9.length ? `/未填${nt9.length}` : ''})${cx9 ? `,取消${cx9}組` : ''}${tkc + tks ? `,小孩${tkc + tks}` : ''}`)
        days[d].filter((r) => (r.n || 0) >= 20 || r.note || r.inote).forEach((r) => L.push(`  - ${r.t || '未填'} ${r.name}${r.n}人(${ST[r.st] || r.st})${r.note ? `｜客註:${String(r.note).slice(0, 40)}` : ''}${r.inote ? `｜店註:${String(r.inote).slice(0, 40)}` : ''}`))
      } else {
        L.push(`  ＝${d} 系統合計（回答以此為準，別自己加總）：有效 ${ok9.length}組 ${tp}人${tkc || tks ? `＋小孩${tkc + tks}` : ''}${tpd ? `（含待確認${tpd}組）` : ''}｜午場(17:00前)${nn9.length}組${nn9.reduce((t9, r) => t9 + (r.n || 0), 0)}人/晚場(17:00後)${ee9.length}組${ee9.reduce((t9, r) => t9 + (r.n || 0), 0)}人${nt9.length ? `/未填時間${nt9.length}組${nt9.reduce((t9, r) => t9 + (r.n || 0), 0)}人` : ''}｜` + Object.entries(agg9).map(([s9, a9]) => `${s9}:${a9.g}組${a9.p}人${a9.k ? `+${a9.k}小` : ''}`).join('、') + (tkc ? `｜🪑兒童椅共${tkc}張（${kcWho}）` : '') + (tks ? `｜兒童座${tks}個` : '') + `｜⚠️ inline iPad 時間軸人數=大人+小孩` + (wl9.length ? `｜🪧候補另計：${wl9.length}組${wlG9}人（沒進店，不算人次）` : ''))
      }
    }
  }
  const dn = Object.keys(notes).filter((d) => d >= f && d <= t2).sort()
  if (dn.length) { L.push('當日備註：'); dn.forEach((d) => (notes[d] || []).forEach((n) => L.push(`  - ${d} ${String(n.note).replace(/\s+/g, ' ').slice(0, 80)}（${n.by}）`))) }
  if (!any && !dn.length) L.push('（這段期間沒有任何訂位或備註＝空檔）')
  return L.join('\n')
}
// 🔎 人資代查（任意月出勤+班表；context 只載本月出勤近2天+異常統計,歷史月/逐人統計用這支；v4.38.3 全資料域盤點補洞）
async function queryHrMonth(month, date) {
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : ''
  const mo = dt ? dt.slice(0, 7) : String(month || '')
  if (!/^\d{4}-\d{2}$/.test(mo)) return '（格式：month=YYYY-MM 整月統計，或 date=YYYY-MM-DD 看單日逐筆）'
  const kvh = await kvGetMany(['sp_crew_pm_hr_att_' + mo, 'sp_crew_pm_hr_sched_' + mo])
  const att = kvh['sp_crew_pm_hr_att_' + mo], sch = kvh['sp_crew_pm_hr_sched_' + mo]
  const L = [`◆ NUEiP 人資 ${dt || mo}（系統代查）`]
  if (dt) {
    const rows = Object.values(att?.days?.[dt] || {})
    L.push(rows.length ? `出勤逐筆：` : `（${dt} 沒有出勤資料）`)
    rows.forEach(r => L.push(`  - ${r.name}${r.work ? ` 班${r.work}` : ''} 上${(r.on || []).join('/') || '—'} 下${(r.off || []).join('/') || '—'}${r.late ? ` 遲到${r.late}分` : ''}${r.early ? ` 早退${r.early}分` : ''}${r.miss ? ' 缺卡' : ''}${r.absent ? ' 曠職' : ''}`))
    const srows = (sch?.days?.[dt] || []).filter(x => !x.brk && x.name)
    if (srows.length) L.push(`班表：` + srows.map(x => `${x.name}${x.code ? `(${x.code}${x.start ? ` ${x.start.slice(0, 5)}-${(x.end || '').slice(0, 5)}` : ''})` : ''}`).join('、'))
    return L.join('\n')
  }
  if (att?.days && Object.keys(att.days).length) {
    const ds = Object.keys(att.days).sort()
    const st = {}
    ds.forEach(d => Object.values(att.days[d]).forEach(r => { const s = st[r.name] = st[r.name] || { d: 0, late: 0, lm: 0, early: 0, miss: 0, ab: 0 }; s.d++; if (r.late) { s.late++; s.lm += r.late } if (r.early) s.early++; if (r.miss) s.miss++; if (r.absent) s.ab++ }))
    L.push(`出勤 ${ds[0]}~${ds[ds.length - 1]} 共${ds.length}天（每人統計；要某天逐筆帶 date 再查）：`)
    Object.entries(st).sort((a, b) => b[1].d - a[1].d).forEach(([n, s]) => L.push(`  - ${n}：出勤${s.d}天${s.late ? `｜遲到${s.late}次(${s.lm}分)` : ''}${s.early ? `｜早退${s.early}次` : ''}${s.miss ? `｜缺卡${s.miss}次` : ''}${s.ab ? `｜曠職${s.ab}次` : ''}`))
  } else L.push('（該月沒有出勤資料）')
  if (sch?.days && Object.keys(sch.days).length) {
    const st2 = {}
    Object.values(sch.days).forEach(list => (list || []).forEach(x => { if (x.brk || !x.name) return; st2[x.name] = (st2[x.name] || 0) + 1 }))
    L.push(`班表共${Object.keys(sch.days).length}天（每人排班天數,休假不計）：` + Object.entries(st2).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}${c}天`).join('、'))
  } else L.push('（該月沒有班表資料）')
  return L.join('\n')
}
// 🔎 財務內帳代查（任意月逐筆；context 只有最近120筆,更早的用這支；v4.38.3 全資料域盤點補洞）
// 🔎 v4.70.40 叫貨單代查（兩店；資料＝阿桑 boss/gops 系統每小時入庫的月檔 sp_finance_pm_boss_{ord|gord}_YYYYMM＋明細 {ordi|gordi}）
async function queryOrders(month, store, supplier, withItems) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return '（月份格式要 YYYY-MM）'
  const st = /ab|beach|a beach/i.test(String(store || '')) ? 'abeach' : 'ground'
  const label = st === 'abeach' ? 'A Beach' : 'GROUN:D'
  const ymk = month.replace('-', '')
  const tpeDay = (x) => { const t = Date.parse(String(x || '')); return isNaN(t) ? '' : new Date(t + 8 * 3600e3).toISOString().slice(0, 10) }
  const [hd, it] = await Promise.all([kvGet(`sp_finance_pm_boss_${st === 'abeach' ? 'ord' : 'gord'}_${ymk}`), kvGet(`sp_finance_pm_boss_${st === 'abeach' ? 'ordi' : 'gordi'}_${ymk}`)])
  const rows = Object.values((hd || {}).rows || {}).filter(r => r.order_id)
  const sup = String(supplier || '').trim()
  let list = rows.map(r => ({ id: r.order_id, d: tpeDay(r.created_at), supplier: (r.supplier || '').trim() || '（未填廠商）', status: r.status || '', total: Number(r.total_amount) || 0, n: Number(r.line_count) || 0, unpriced: Number(r.unpriced_lines) || 0 }))
  if (sup) list = list.filter(o => o.supplier.includes(sup))
  list.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
  const L = [`◆ ${label} 叫貨單 ${month}${sup ? `（廠商含「${sup}」）` : ''} 共 ${list.length} 張（系統代查；阿桑 ${st === 'abeach' ? 'OPS' : 'gops'} 系統每小時同步，最新到 ${(hd || {}).updatedAt ? String(hd.updatedAt).slice(0, 16).replace('T', ' ') : '?'}）`]
  if (!list.length) { L.push(rows.length ? '（這個月有單但沒有符合這家廠商的）' : '（這個月在我們這邊沒有任何單；如果阿桑系統裡有，可能同步還沒跑到或更早的月份）'); return L.join('\n') }
  const ap = list.filter(o => o.status === 'approved'), pend = list.filter(o => o.status === 'pending'), other = list.length - ap.length - pend.length
  const sum = (a) => a.reduce((t, o) => t + o.total, 0)
  L.push(`合計（回答以此為準，別自己加總）：已核准 ${ap.length} 張 ${fmtNT(sum(ap))}｜待審 ${pend.length} 張 ${fmtNT(sum(pend))}${other ? `｜其他狀態 ${other} 張` : ''}`)
  const byV = {}; ap.forEach(o => { byV[o.supplier] = (byV[o.supplier] || 0) + o.total })
  L.push('已核准依廠商：' + Object.entries(byV).sort((a, b) => b[1] - a[1]).map(([v, m]) => `${v} ${fmtNT(m)}`).join('、'))
  const items = {}
  if (withItems) for (const r of Object.values((it || {}).rows || {})) { if (!r.order_id) continue; (items[r.order_id] = items[r.order_id] || []).push(`${r.name || r.item || '?'}×${Number(r.qty) || 0}${r.unit || ''}${r.price != null && r.price !== '' ? `@${Math.round(Number(r.price))}` : ''}`) }
  list.slice(0, 120).forEach(o => L.push(`  - ${o.d} ${o.supplier}｜${o.status === 'approved' ? '已核准' : o.status === 'pending' ? '待審' : o.status}｜${o.n}項 ${fmtNT(o.total)}${o.unpriced ? `（${o.unpriced}項沒單價,金額低估）` : ''}${items[o.id] ? '：' + items[o.id].slice(0, 12).join('、') + (items[o.id].length > 12 ? `…等${items[o.id].length}項` : '') : ''}`))
  if (list.length > 120) L.push(`…僅列前 120 張（合計是整月的）`)
  return L.join('\n')
}
async function queryFinMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return '（月份格式要 YYYY-MM）'
  const { list } = await kvLoadLedger()
  const rows = list.filter(t => String(t.date || '').slice(0, 7) === month)
  const L = [`◆ 財務內帳 ${month} 共 ${rows.length} 筆（系統代查）`]
  if (rows.length) {
    let inc = 0, exp = 0
    rows.forEach(t => { if (t.kind === 'income') inc += Number(t.amount) || 0; else if (t.kind === 'expense') exp += Number(t.amount) || 0 })
    L.push(`合計（回答以此為準，別自己加總）：收入 ${fmtNT(inc)}／支出 ${fmtNT(exp)}`)
    rows.slice(0, 250).forEach(t => L.push(`  - ${t.date} ${t.kind === 'income' ? '收' : t.kind === 'transfer' ? '轉' : '支'} ${fmtNT(t.amount)}｜${t.category || ''}${t.vendor ? `｜${t.vendor}` : ''}${t.note ? `｜${String(t.note).slice(0, 30)}` : ''}`))
    if (rows.length > 250) L.push(`…僅列前 250 筆（合計是全月的）`)
  }
  return L.join('\n')
}
// 🔎 訂位關鍵字代查（「客人OD電話多少」這種用名字問的；直連 inline 即時搜尋＝後台搜尋框同源）
async function queryResvName(keyword) {
  const kw = String(keyword || '').trim()
  if (!kw) return '（要給關鍵字：姓名/電話片段都可以）'
  try {
    const token = await inlineLogin()
    const { total, rows } = await inlineSearchKeyword(token, kw, 40)
    if (!rows.length) return `（inline 全史搜「${kw}」＝0 筆，可能名字拼法不同，換個關鍵字再試）`
    const ST = { 1: '已確認', 2: '已取消', 3: '待確認', 4: '已入座', 5: '已取消', 6: '已確認' }
    const L = [`◆ inline 訂位搜尋「${kw}」共 ${total} 筆${total > rows.length ? `（列最近的 ${rows.length} 筆，要更多再縮關鍵字）` : ''}：`]
    // 官方客人檔統計（App 客人頁同數字；搜尋/自己數訂位會漏——同人換名/沒留電話/現場客，次數以這個為準）
    const cids = [...new Set(rows.map((r) => r.cid).filter(Boolean))].slice(0, 3)
    for (const cid of cids) {
      const c = await inlineCustomer(token, cid)
      if (c?.stats?.total != null) L.push(`★ ${c.name}${c.phone ? `（${c.phone}）` : ''} 官方客人檔統計：入座${c.stats.seated ?? 0}次｜取消${c.stats.total - (c.stats.seated || 0) - (c.stats.noShow || 0)}｜NO SHOW ${c.stats.noShow ?? 0}｜全部${c.stats.total}（回答「來過幾次」以此為準）`)
    }
    rows.forEach((r) => L.push(`  - ${r.d || '?'} ${r.t || ''} ${r.name} ${r.n}人｜${ST[r.st] || r.st}${r.phone ? `｜${r.phone}` : '｜未留電話'}${r.email ? `｜${r.email}` : ''}${r.note ? `｜客註:${String(r.note).slice(0, 30)}` : ''}`))
    return L.join('\n')
  } catch (e) { return `（inline 搜尋失敗：${e?.message}）` }
}
// 🔎 常客排行代查（「來最多次的客人前十名」；掃全史月檔即時聚合，電話為 key 同人合併）
async function queryResvTop(n) {
  const top = Math.min(30, Math.max(3, Number(n) || 10))
  const sum = (await kvGetMany(['sp_finance_pm_inline']))['sp_finance_pm_inline']
  const mos = Object.keys(sum?.months || {}).sort()
  if (!mos.length) return '（訂位庫是空的）'
  // key=客人ID（＝inline 客人檔同口徑；同人會換名字「楊主委/楊安娜/楊」且部分單沒留電話，用電話當 key 會漏算——張良 2026-10-03 抓包）→ 沒 cid 退電話 → 再退名字
  const cust = {}
  for (let i = 0; i < mos.length; i += 12) {
    const kvm = await kvGetMany(mos.slice(i, i + 12).map((m) => 'sp_finance_pm_inline_' + m))
    for (const doc of Object.values(kvm)) {
      for (const [d, arr] of Object.entries(doc?.days || {})) {
        for (const r of arr) {
          const name = (r.name || '').trim()
          const key = r.cid || r.phone || (name ? 'n:' + name : '')
          if (!key) continue
          const c = cust[key] = cust[key] || { name, phone: '', seat: 0, book: 0, cx: 0, guests: 0, last: '' }
          if (name && (!c.name || name.length > c.name.length)) c.name = name
          if ((r.phone || '').length > (c.phone || '').length) c.phone = r.phone
          if (r.cid && !c.cid) c.cid = r.cid
          c.book++
          if (r.st === 2 || r.st === 5) c.cx++
          else { if (r.st === 4) { c.seat++; c.guests += r.n || 0 }; if (d > c.last) c.last = d }
        }
      }
    }
  }
  // 只排「有有效電話」的（沒電話的=店員現場代稱如「外國人/控」，幾百筆不是同一人，2026-10-03 實測排除）
  const cands = Object.values(cust).filter((c) => c.name && (c.phone || '').replace(/\D/g, '').length >= 8).sort((a, b) => b.seat - a.seat || b.book - a.book).slice(0, Math.min(30, top * 2))
  // 聚合只拿來「選人」；最終次數以 inline 官方客人檔 statistics 為準（同人換名/沒留電話/現場客聚合會漏——楊主委=楊安娜案）
  try {
    const token = await inlineLogin()
    await Promise.all(cands.map(async (c) => {
      if (!c.cid) return
      const o = await inlineCustomer(token, c.cid)
      // 取消數＝全部−入座−NoShow（官方取消欄位名不固定，用恆等式反推最穩；Belle 137-31-0=106 與客人檔一致）
      if (o?.stats?.total != null) { c.seat = o.stats.seated ?? c.seat; c.bookOfficial = o.stats.total; c.cx = o.stats.total - (o.stats.seated || 0) - (o.stats.noShow || 0) }
    }))
  } catch (_) {} // 官方統計拿不到就用聚合值（寧可近似別開天窗）
  const rank = cands.sort((a, b) => b.seat - a.seat || b.book - a.book).slice(0, top)
  const L = [`◆ A Beach 常客排行 Top${top}（次數=inline官方客人檔統計、與App客人頁同數字；只計有留電話的，現場代稱不算）`]
  rank.forEach((c, i) => L.push(`  ${i + 1}. ${c.name}｜入座${c.seat}次｜全部${c.bookOfficial ?? c.book}次(取消${c.cx})｜最近${c.last}${c.phone ? `｜${c.phone}` : ''}`))
  return L.join('\n')
}
// 🌐 即時翻譯模式（張良 2026-09-29：外國面試者溝通——群裡每句自動雙向翻，不用點名）
async function ddTranslate(text, mode) {
  const pair = mode === 'zh-ko' ? { fo: '韓文', foName: 'Korean' } : { fo: '英文', foName: 'English' }
  const hasHan = /[\u4e00-\u9fff]/.test(text)
  const hasHangul = /[\uac00-\ud7af]/.test(text)
  const dir = hasHan ? `翻成${pair.fo}` : (hasHangul || !hasHan ? '翻成繁體中文（台灣用語）' : `翻成${pair.fo}`)
  // v4.70.29 走 AI 中樞 route=translate（預設 Haiku 便宜快，設定頁可換家）
  try {
    const { aiCall } = await import('./_ai.js')
    const r = await aiCall('translate', { system: `即時口譯：把訊息${dir}。只輸出譯文，不解釋不加引號。保留語氣敬語；人名品牌保留原文。`, messages: [{ role: 'user', content: text }], maxTokens: Math.min(500, Math.max(80, text.length * 3)) })
    return r.text || '（翻譯暫時失敗，再說一次）'
  } catch (_) { return '（翻譯暫時失敗，再說一次）' }
}
async function getLineProfile(userId) { try { const r = await fetch('https://api.line.me/v2/bot/profile/' + userId, { headers: { authorization: `Bearer ${TOKEN}` } }); if (r.ok) { const d = await r.json(); return d.displayName || '' } } catch (_) {} return '' }

// ── 對話記憶：每個對話(私訊userId或群組id)留最近幾輪「逐字」，更舊的滾動濃縮成摘要永久保留 ──
// 三層記憶：①逐字最近 30 輪 ②滾動摘要（pm_bot_chatsum，舊對話濃縮、不再蒸發＝無限記憶）③長期記事本(pm_bot_memory)
// v4.70.39 每個對話各自一筆 pm_bot_chat_<convId>／pm_bot_chatsum_<convId>（原本全部擠在 pm_bot_chats 一鍵：兩個對話同時進來讀改寫互相覆蓋＝DD 失憶根因；docs/COMMS_PLAN.md 項目 1 第 3 點）
// 舊鍵 pm_bot_chats／pm_bot_chatsum 只讀不寫（新鍵沒有時才讀一次＝懶遷移，寫入一律進新鍵）
const chatKey = (c) => 'pm_bot_chat_' + c
const chatSumKey = (c) => 'pm_bot_chatsum_' + c
async function loadConv(convId) {
  const m = await kvGetMany([chatKey(convId), chatSumKey(convId)])
  let h = m[chatKey(convId)], sum = m[chatSumKey(convId)]
  if (!h || sum == null) {
    const old = await kvGetMany(['pm_bot_chats', 'pm_bot_chatsum'])
    if (!h) { const o = asObj(old['pm_bot_chats'])[convId]; h = { list: Array.isArray(o) ? o : [] } }
    if (sum == null) sum = { text: String(asObj(old['pm_bot_chatsum'])[convId] || '') }
  }
  return { h: Array.isArray(h.list) ? h.list : [], sum: String((sum && sum.text) || '') }
}
async function getChatHistory(convId) {
  const { h: all, sum } = await loadConv(convId)
  const h = all.filter(x => x && (x.role === 'user' || x.role === 'assistant') && x.content).slice(-60)
  if (sum) {
    // 摘要以一問一答塞在最前面，維持 user/assistant 交錯
    return [
      { role: 'user', content: '【系統】以下是我們更早之前對話的濃縮摘要（超過逐字記憶範圍、但你仍記得的舊脈絡）：\n' + sum },
      { role: 'assistant', content: '好，這些舊脈絡我都記得，繼續。' },
      ...h,
    ]
  }
  return h
}
// 舊對話溢出時：把「既有摘要＋要被擠掉的舊對話」合併成新摘要（用便宜的 Haiku；失敗就保留舊摘要，不丟資料）
async function summarizeOverflow(oldSummary, dropped) {
  if (!dropped.length) return oldSummary || ''
  const convo = dropped.map(x => (x.role === 'user' ? '使用者' : 'DD') + '：' + x.content).join('\n')
  const prompt = `你在維護一份 LINE 對話的「長期摘要」。把【既有摘要】和【即將被移出逐字記憶的舊對話】合併成更新版摘要：保留仍重要的事實、決定、數字、金額、日期、待辦、使用者偏好與習慣；閒聊丟掉。600字內、條列。只輸出摘要本身，不要開場白。\n\n【既有摘要】\n${oldSummary || '（無）'}\n\n【舊對話】\n${convo}`
  try { // v4.70.29 走 AI 中樞 route=summary（預設 Haiku）
    const { aiCall } = await import('./_ai.js')
    const r = await aiCall('summary', { messages: [{ role: 'user', content: prompt }], maxTokens: 900 })
    return r.text || oldSummary || ''
  } catch (_) { return oldSummary || '' }
}
async function pushChat(convId, userText, assistantText) {
  try {
    const { h, sum: oldSum } = await loadConv(convId)
    h.push({ role: 'user', content: String(userText || '').slice(0, 900) })
    h.push({ role: 'assistant', content: String(assistantText || '').slice(0, 1400) })
    let keep = h
    if (h.length > 60) {
      // 滿 30 輪：最舊的 6 輪不丟掉 → 濃縮進滾動摘要（回覆已送出後才跑，使用者無感）
      const dropped = h.slice(0, h.length - 48)
      const ns = (await summarizeOverflow(oldSum || '', dropped)).slice(0, 2400)
      await kvSet(chatSumKey(convId), { text: ns, at: new Date().toISOString() })
      keep = h.slice(-48)
    }
    await kvSet(chatKey(convId), { list: keep, at: new Date().toISOString() }) // 一個對話一鍵，不再 20 個對話擠一份文件
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
- {"type":"add_task","desc":"買水泥3包","space":"工程","category":"消防工程","due":"2026-06-25","owner":"阿哲","waitingFor":"等木工","estimatedMinutes":15,"dependsOn":["確認交期"],"tags":["採購"]}  // 加任務到「任務中心」。space=記到哪個空間：工程(預設)/團隊/夥伴/財務——使用者說「記到團隊工作」就帶"space":"團隊"，各空間任務各自獨立；category/dependsOn 每個空間都可用(用該空間自己的大項/任務解析)。owner=負責人、waitingFor=在等誰/什麼、estimatedMinutes=預估分鐘(正整數)、dependsOn=依賴的任務(填任務標題)。全部選填(可省略)；category省略或找不到→進收件匣。(「加待辦」也用這個)
- {"type":"update_task","task":"買水泥","space":"工程","status":"完成","owner":"阿哲","waitingFor":"","estimatedMinutes":30,"dependsOn":[],"pinned":true,"due":"2026-07-20","category":"消防工程","priority":"高","tags":["採購"],"note":"...","newTitle":"..."}  // 更新既有任務（四個空間都可以，space 帶任務所在空間，預設工程）；task=用標題找。⚠️只帶「要改的欄位」，沒帶的欄位絕不要帶(會保留原值)；waitingFor 給 ""=清除等待、dependsOn 給 []=清空依賴、category=改隸屬大項(歸類用)。狀態:待辦/進行中/完成
- {"type":"delete_task","task":"溫度探針、推車、碼錶","space":"團隊"}  // 刪除任務（四個空間都可以）；task=用標題找(盡量給完整標題免得刪錯)。典型用法：把合併卡拆成獨立任務後，刪掉原本的合併卡
- {"type":"add_conclusion","topic":"開幕日","conclusion":"8/10 開幕","reason":"","category":""}  // 加一條「公開結論」(團隊定案)；topic=主題、conclusion=定案內容
- {"type":"add_log","content":"今天水電進場拉管線","date":"2026-06-22"}  // 工作日誌；date 可省略(預設今天)
- {"type":"add_petty_spend","amount":390,"content":"工人便當","category":"水電工程"}  // 記零用金花費；category 是歸到哪個工種(可省略)
- {"type":"add_finance_tx","kind":"expense","amount":12000,"account":"合庫","category":"物料","vendor":"震旦","note":"買桌椅"}  // 財務內帳；kind=expense支出/income收入/transfer轉帳；account=帳戶名
- {"type":"set_category_status","category":"消防工程","status":"完工"}  // 狀態：待開工/進行中/完工/有問題/暫停
- {"type":"set_item","category":"消防工程","item":"灑水頭","status":"完工","unitPrice":1200,"qty":10,"assignee":"王師傅"}  // 改細項；欄位都可省略
- {"type":"add_category","name":"空調工程","budget":300000,"space":"工程"}  // 建大項分類（四個空間都可以，space 預設工程；例：在團隊工作建「採購」就帶"space":"團隊"）。任務中心的分類欄位就是這個大項，建好後用 add_task/update_task 的 category 歸類
【夥伴名冊（主管限定頁,/prep→夥伴名冊）】已上線：欄位=姓名/店/部門/職務/到職日/年資/生日/年齡/性別/身分證(鎖名單)/緊急聯絡人/入職文件(勞動契約/身分證影本/存摺/體檢/衛生訓練/未成年法代)。你不能直接改名冊——使用者要改就教他打指令(主管私訊限定)：改文字欄「名冊 姓名 欄位 值」或「緊急聯絡人 姓名 電話」(改那個人的欄位)或「我的緊急聯絡人 內容」(掛自己名下)；傳文件「文件 姓名 體檢」後15分內傳照片/檔案；查收件「文件 姓名」。絕不要說「名冊沒有某欄位/要找CC加欄位」。
- {"type":"query_pos_day","date":"2026-09-25","store":"ground"}  // 🔎資料代查（唯讀,不用確認,誰問都能用）：查某天某店「完整」銷售明細=逐品項份數金額+時段表+付款別。date 也可以只給月份 "2026-09"＝查整月（回每日營收+月合計,問某月總額/要補一段日期時用這個,**不要**一天一天查）。使用者問的資料你手上摘要沒有時,輸出這個指令(可附一句「我查一下」),系統會代查回填後你再答——**不要**回「資料沒帶到/請自己看App/請找張良接」。store=ground|abeach。
- {"type":"query_resv","date":"2024-07-15","to":"2024-07-20"}  // 🔎A Beach 訂位代查（唯讀,不用確認）：任何日期的訂位「逐筆完整明細」（姓名/電話/人數/時間/狀態/客註/店註）＋當日備註（⚠️包場/公休註記），2021-02 開店～未來全查得到。date=YYYY-MM-DD 或 YYYY-MM 整月；to 選填查區間（一次最多 4 個月）；加 "kw":"婚" =資料庫端先搜關鍵字（姓名/客註/店註/當日備註）只回命中的筆——問「某段期間所有婚禮/包場/慶生」這種主題式問題**優先用 kw**,比整月硬掃又準又省。摘要裡只有彙總數字、使用者要「某天是誰訂的/電話/歷史某天明細/**兒童椅要幾張**」就用這個（回覆有🪑兒童椅合計＋誰要幾張）；問空檔也可以用（回「空檔」=確定沒被訂）。
- {"type":"query_resv","name":"OD"}  // 🔎A Beach 訂位「關鍵字」代查（唯讀,不用確認）：用「客人姓名/電話片段」直搜 inline 全史（=後台搜尋框同源），回每筆日期+姓名+人數+狀態+**電話**。使用者問「客人XX的電話/XX上次什麼時候來/XX訂過幾次」這種用名字問的就用這個（不知道日期時不要用 date 亂猜）。
- {"type":"query_resv","top":10}  // 🔎A Beach 常客排行代查（唯讀,不用確認）：掃 2021 開店～今全史，回「實際入座次數」最多的前 N 名（姓名/入座次數/累計人次/訂過幾次含取消/最近來店/電話）。使用者問「常客前十名/來最多次的客人/回頭客」就用這個。
- {"type":"query_hr","month":"2026-08"}  // 🔎NUEiP人資代查（唯讀,不用確認）：任意月「出勤統計(每人出勤天數/遲到/早退/缺卡/曠職)+班表(每人排班天數)」。加 "date":"2026-08-15" =改看單日逐筆打卡+當日班表。摘要只有本月近況,問歷史月/某人某月統計就用這個。
- {"type":"query_orders","month":"2026-10","store":"ground"}  // 🔎叫貨單代查（唯讀,不用確認,外部群自動擋）：某店某月「跟廠商的叫貨單逐張」（日期/廠商/狀態/幾項/金額）＋月合計＋依廠商合計。store=ground（GROUN:D，含向 AB 央廚叫貨）|abeach（A Beach）。加 "supplier":"上展" 只列那家；加 "items":1 連每張單的品項數量單價一起列。摘要裡只有近 8 張，使用者問「X 月叫貨單／跟某家叫了什麼／叫貨花多少」就用這個——**不要**回「沒接進來／去看 Google 試算表」。
- {"type":"query_fin","month":"2026-08"}  // 🔎財務內帳代查（唯讀,不用確認,外部群自動擋）：任意月收支「逐筆+月合計」。摘要只有最近120筆,問更早的月份/某月總支出就用這個。
- 張良想叫 CC（Claude Code 工程師）改程式/加功能：教他直接打「**轉給CC ＋需求內容**」一句話——系統會自動收進 CC 收件匣、CC 會撿單處理（這是接好的真管道，**不要再說「我沒辦法轉給CC」**）。只有張良本人打有效；夥伴提需求請他們走 /prep 的建議或先跟張良說。
- **【代查鐵則】你沒有「稍等一下／待會撈回來再回報」的能力**——這一則回覆送出後就結束了，不會有下一則。要代查，就必須在**同一則回覆裡**輸出上面的 query_pos_day / query_resv JSON 指令（系統會當場查完回填、你再據此作答，使用者只會看到最終答案）。只寫「我幫你代查／撈回來整理給你／稍等一下」而**沒帶 JSON ＝什麼都不會發生＝對使用者說謊**（2026-10-04 真實翻車：答應查九月婚禮包場說「稍等一下」，結果指令沒輸出、使用者空等）。
- {"type":"add_item","category":"空調工程","name":"主機","qty":1,"unit":"式","unitPrice":150000,"taxType":"未稅"}
- {"type":"delete_item","category":"空調工程","item":"主機"}
- {"type":"add_payment","category":"消防工程","amount":63000,"date":"2026-06-22","note":"訂金"}  // 大項新增一筆付款
數字只放阿拉伯數字、不要逗號或「元」。一次可放多個指令。

輸出 json 的同時，**正常文字部分照樣要寫**：回答訊息裡的其他問題、交代你打算記什麼——這段文字使用者看得到，不會被丟掉。
執行規則（系統自動處理，你只要知道怎麼措辭）：
- 純記錄類（add_log / add_task / add_todo / add_conclusion）系統會**直接執行**。
- **【存檔鐵則】你自己絕對不要寫「已記好／已新增／已存好／記好了／建好了／已建立／開好了」這類完成宣告**——寫入成功時，系統會自動在你的回覆後面附上「✅ 已直接記好：…」清單，**那才是唯一可信的存檔證明**；你的文字一律用進行式「幫你記這筆👇」。你這一則沒輸出 json＝根本沒記，講「已記好」就是說謊（2026-09-12 真實翻車案例：宣稱記好其實沒送出，被老闆抓包）。被質疑「有記到嗎」時，去查下面資料區的任務清單，用資料回答，真沒記就重新輸出 json 補記。
- **【禁止仿冒系統台詞】**「✅ 已直接記好」「🛠 這些要等你確認」是**系統**執行後自動附加的字樣，你**絕對禁止自己打這些字**（打了＝偽造存檔證明，系統會當場改標成「❌ 假清單」丟你臉）。對話歷史裡你過去的回覆若出現這些字樣，那都是系統附的，**要模仿的是歷史裡的 json 指令區塊，不是那段中文**。想做事，唯一的方法＝輸出 \`\`\`json 動作區塊。
- 其他（改資料、刪除、金額類：add_payment / add_finance_tx / add_petty_spend / set_* / update_task / delete_*）會**先請使用者確認**，這類要用「我準備幫你…，等你確認」的語氣，**不要說已完成**。`

// 仿冒系統核可章的消毒（2026-09-12 二次翻車：DD 自己「打字仿冒」✅ 已直接記好清單）：
// 0 動作卻出現系統台詞 → 當場改標成假清單，使用者一眼看出沒存
export function sanitizeFakeDone(reply) {
  return String(reply).replaceAll('✅ 已直接記好', '❌「已直接記好」（DD 自己打的假清單，系統並沒有執行）')
}

// 「嘴上說記好、實際沒寫入」自動抓包（張良 2026-09-12：DD 宣稱已記好但 json 沒送出，被抓包「說太快」）
// 回覆送出前核對：AI 說了完成話術但這輪 0 個動作 → 當場加警語，不讓使用者以為存好了
// v2.5.9：①措辭補「建好/建立/開好」（2026-09-16 群組翻車：「7 件都先建好了」完美閃過舊 regex）
//         ②加 readonly 版警語（唯讀對話裡說「再講一次我重記」是空頭支票，要講清楚誰才能寫入）
export function falseDoneWarning(reply, actionCount, readonly = false) {
  if (actionCount > 0) return ''
  if (!readonly && /```json/.test(reply)) return '\n\n⚠️ 系統核對：上面想送的寫入指令格式出錯，「沒有」存成功。請把要記的再講一次，我馬上重記 🙏'
  const claims = /(已|都)(幫你)?(先)?(直接)?(記|存|新增|建|開)(好|立|進去|了)|記好了|建好了|已新增任務|已記下|已建立/.test(reply)
  const past = /(之前|上次|昨天|那時|當時|先前|早就)/.test(reply)
  if (claims && !past) {
    return readonly
      ? '\n\n⚠️ 系統核對：這個對話「沒有」寫入權限，上面說的建好/記好其實都「沒有」執行。要真的建進系統，請操作者（張良）直接下指令。'
      : '\n\n⚠️ 系統核對：這一則其實「沒有」執行任何寫入（沒附「✅ 已直接記好」清單＝沒存）。上面若說了記好，是講太快——請把要記的再講一次，我立刻重記 🙏'
  }
  return ''
}

// 給 selftest 用的具名匯出（純函式，不碰網路/DB；scripts/test-webhook-parsing.mjs 每次部署前會驗）
export { parseActions, extractBalancedObjects, describeAction, extractMemoryTags, stripJson }

const TRIGGERS = ['d哥', 'D哥', '進度', '多少', '還欠', '未付', '已付', '付款', '總額', '預算', '餘額', '報告', '速報', '幾天', '完工', '零用金']
const triggered = (text) => /[?？]\s*$/.test(text) || TRIGGERS.some((k) => text.includes(k))

export default async function handler(req, res) {
  if (req.query?.warm) return res.status(200).json({ ok: true }) // 保溫 ping（翻譯秒回用：函式常駐不冷啟）
  // 診斷探針（唯讀）：/api/line-webhook?probe=crew → 回 D 實際拿到的夥伴中心文字開頭
  if (req.method === 'GET' && req.query?.probe === 'crew') {
    const t = (await loadCrewText()) + (await loadShiftText()) + (await loadHrText())
    return res.status(200).json({ len: t.length, head: t.slice(0, 800), shiftHead: t.includes('【排班系統') ? t.slice(t.indexOf('【排班系統'), t.indexOf('【排班系統') + 600) : '（無排班段落）' })
  }
  // 「轉給CC」收件匣（v4.41.3 張良 2026-10-04「C能幹最好,關鍵密碼就是轉給CC」）：讀口＋銷單口（CC 本機排程撿單用）
  const ccAuth = (v) => { const a = (process.env.MENU_PROBE_KEY || '').trim(), b = (process.env.CC_AGENT_KEY || '').trim(), s = String(v || ''); return !!((a && s === a) || (b && s === b)) } // v4.68.7 雲端代理用 CC_AGENT_KEY 也可
  if (req.method === 'GET' && req.query?.ccinbox) {
    if (!ccAuth(req.query.ccinbox)) return res.status(403).json({ ok: false })
    const doc9 = (await kvGetMany(['pm_cc_inbox']))['pm_cc_inbox'] || { list: [] }
    return res.status(200).json({ ok: true, list: (doc9.list || []).filter(x => x.status === 'open') })
  }
  // v4.45.6 CC 私訊張良共用小函式（開工/完成都用）：找 bind 裡名字含「張良」的 uid 發文字
  const ccNotifyBoss = async (text) => { try {
    const bdC9 = (await kvGetMany(['sp_finance_pm_prep_bind']))['sp_finance_pm_prep_bind'] || {}
    let uidC9 = null
    for (const [u9, tk9] of Object.entries(bdC9.byUid || {})) { if (/張良/.test(((bdC9.tokens || {})[tk9] || {}).name || '')) { uidC9 = u9; break } }
    if (uidC9 && TOKEN) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ to: uidC9, messages: [{ type: 'text', text }] }) })
  } catch (_) {} }
  // 開工回報（v4.45.6 CC許願：撿單當下即時告訴張良「開工」）：GET ?ccstart=K&id=
  if (req.method === 'GET' && req.query?.ccstart) {
    if (!ccAuth(req.query.ccstart)) return res.status(403).json({ ok: false })
    const doc9 = (await kvGetMany(['pm_cc_inbox']))['pm_cc_inbox'] || { list: [] }
    const it9 = (doc9.list || []).find(x => x.id === String(req.query.id || ''))
    if (it9 && !it9.startedAt) { it9.startedAt = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); await kvSet('pm_cc_inbox', doc9); await ccNotifyBoss(`🛠 CC 開工\n📥 ${String(it9.text || '').slice(0, 140)}\n做完會再回報你`) }
    return res.status(200).json({ ok: !!it9 })
  }
  if (req.method === 'GET' && req.query?.ccdone) {
    if (!ccAuth(req.query.ccdone)) return res.status(403).json({ ok: false })
    const doc9 = (await kvGetMany(['pm_cc_inbox']))['pm_cc_inbox'] || { list: [] }
    const it9 = (doc9.list || []).find(x => x.id === String(req.query.id || ''))
    if (it9) {
      it9.status = 'done'; it9.doneAt = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); it9.result = String(req.query.note || '').slice(0, 300); await kvSet('pm_cc_inbox', doc9)
      const footC9 = await quotaFoot(1)
      await ccNotifyBoss(`✅ CC 完成許願\n📥 ${String(it9.text || '').slice(0, 120)}\n🛠 結果：${it9.result || '已處理'}${footC9}`)
    }
    return res.status(200).json({ ok: !!it9 })
  }
  // 問題回報（v4.68.6 CC 全自動：卡住需張良決定時 DD 問他，不硬幹）：GET ?ccask=K&id=&q=
  if (req.method === 'GET' && req.query?.ccask) {
    if (!ccAuth(req.query.ccask)) return res.status(403).json({ ok: false })
    await ccNotifyBoss(`❓ CC 有問題要你決定\n${String(req.query.q || '').slice(0, 280)}\n（回覆：直接打「轉給CC ＋你的決定」）`)
    return res.status(200).json({ ok: true })
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
  console.log('LINE webhook hit', JSON.stringify({ rawLen: raw?.length || 0, sigPresent: !!req.headers['x-line-signature'], sigOK, events: (body.events || []).length, secretSet: !!SECRET, tokenSet: !!TOKEN }))
  const events = body.events || []
  // v4.70.39 驗簽失敗一律進健康紀錄；LINE_SIG_STRICT=1 才真的拒絕（上線先確認健康頁「驗簽失敗」是 0，再開 strict——開了才算補上「偽造事件可操作任務」這個洞）
  if (sigOK === false) {
    ddHealthLog({ kind: 'sigfail', n: events.length, strict: SIG_STRICT ? 1 : 0 }).catch(() => {})
    if (SIG_STRICT) return res.status(403).json({ ok: false, error: 'bad signature' })
  }
  if (!events.length) return res.status(200).json({ ok: true }) // LINE 驗證請求等

  // 重要：serverless 一旦 res 回應就會凍結，後面的 await 不會跑完 → 必須「先處理完(含回覆)再回 200」。
  for (const ev of events) {
    const tEv = Date.now(); aiAggReset() // v4.70.39 健康紀錄：這個事件從收到到回完花多久
    try {
      // v4.70.39 去重取代「重送一律跳過」：重送＝LINE 認為第一次沒成功；用 webhookEventId 判斷——第一次真的處理過才跳過，否則照常處理（原本整筆跳過＝那則訊息永久遺失）
      const evIdX = String(ev.webhookEventId || '')
      const redelivX = !!ev.deliveryContext?.isRedelivery
      if (evIdX) {
        const firstX = await ddEventOnce(evIdX)
        if (firstX === false || (firstX === null && redelivX)) { console.log('dup event skip', evIdX, redelivX ? 'redelivery' : ''); ddHealthLog({ kind: 'dup', redelivery: redelivX ? 1 : 0, type: ev.type }).catch(() => {}); continue }
        if (redelivX) ddHealthLog({ kind: 'redelivery_ok', type: ev.type }).catch(() => {})
      } else if (redelivX) { console.log('skip redelivery (no id)'); continue }
      // 回收訊息 → 私訊老闆（誰在哪個群回收了什麼）
      if (ev.type === 'unsend') { await handleUnsend(ev); continue }
      // v4.70.38 DD 被加進群（join）就登記到群組清單（不用等有人講話）；被踢出／離開（leave）標 gone（設定頁顯示「DD 已不在這個群」）
      if (ev.type === 'join' || ev.type === 'leave') {
        const gidJ = ev.source?.groupId || ev.source?.roomId || ''
        if (gidJ) {
          if (ev.type === 'join') await registerGroup(gidJ, ev.source?.type)
          else { try { const curJ = (await kvGetMany(['pm_group_seen']))['pm_group_seen'] || {}; if (curJ[gidJ]) { curJ[gidJ].gone = 1; await kvSet('pm_group_seen', curJ) } } catch (_) {} }
        }
        continue
      }
      // 互動卡片按鈕（postback）：回饋/投票/文件歸類/任務卡（只在私訊）
      // 簽章驗不過＝偽造請求 → 按鈕一律不理（按鈕會寫資料/刪任務，跟操作權同一套防線）
      if (ev.type === 'postback' && ev.source?.type === 'user') {
        if (sigOK === false) { console.log('sig FAIL → 拒絕 postback', (ev.source.userId || '').slice(-6)) ; continue }
        // 確認卡按鈕（cf|ok / cf|no）：跟打字「確認/取消」同一條路，在這裡處理（executeActions 在本檔）
        const pdata = String(ev.postback?.data || '')
        if (pdata === 'cf|ok' || pdata === 'cf|no') {
          const uid0 = ev.source.userId
          const op0 = (await getOperators())[uid0]
          const rep0 = (t) => ev.replyToken ? lineReply(ev.replyToken, t) : Promise.resolve()
          if (!op0) { await rep0('這按鈕只有授權操作者能用喔。'); continue }
          const pend0 = await getPending(uid0)
          if (!pend0) { await rep0('沒有等待確認的操作（可能超過 10 分鐘失效了）。要做什麼再跟我說一次 🙏'); continue }
          if (pdata === 'cf|ok') {
            try {
              const results = await executeActions(pend0.actions, op0.name)
              await setPending(uid0, null)
              const done = '✅ 搞定！\n' + results.join('\n')
              await rep0(done); await pushChat('dm_' + uid0, '（按了確認按鈕）', done)
            } catch (e) { console.log('cf exec error', e?.message); await rep0('⚠️ 執行出錯（' + (e?.message || '未知錯誤') + '），沒有完成，請再試一次。') }
          } else {
            await setPending(uid0, null)
            await rep0('好，取消了，沒有做任何更動。'); await pushChat('dm_' + uid0, '（按了取消按鈕）', '好，取消了，沒有做任何更動。')
          }
          continue
        }
        if (/^pi\|/.test(pdata)) { // /prep 問題回報審核發布（張良 2026-09-22：發布/保留/刪除按鈕）
          const [, piId, piOp] = pdata.split('|')
          const uidP = ev.source.userId
          const repP = (t2) => ev.replyToken ? lineReply(ev.replyToken, t2) : Promise.resolve()
          try {
            const kvP = await kvGetMany(['sp_finance_pm_sop_issues', 'sp_finance_pm_sop_def', 'sp_crew_kb_roster'])
            const aprP = (((kvP['sp_finance_pm_sop_def'] || {}).ground || {}).approvers || ['張良瑋'])
            const meP = ((kvP['sp_crew_kb_roster'] || {}).people || []).find(p2 => p2.lineUserId === uidP)
            if (!meP || !aprP.includes(meP.name)) { await repP('這按鈕只有審核人能用喔。'); continue }
            const docP = kvP['sp_finance_pm_sop_issues'] || { list: [] }
            const itP = (docP.list || []).find(x => x.id === piId)
            if (!itP) { await repP('找不到這筆回報（可能已處理或刪除）。'); continue }
            const headP = `【${itP.st}】${(itP.text || '（附件）').slice(0, 40)}`
            if (piOp === 'go') {
              itP.pub = 'ok'
              await kvSet('sp_finance_pm_sop_issues', docP)
              try { const { prepLink } = await import('./_webpush.js'); await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ to: 'Cf7940efc6517b0c084ad2ad496b45f30', messages: [{ type: 'text', text: `⚠️ 看板問題回報【${itP.st}】\n${itP.text || '（見附件）'}\n— ${itP.by}${(itP.media || []).length ? `・附 ${itP.media.length} 個檔案` : ''}\n處理完點連結按「已解決」👇\n${prepLink('')}` }] }) }) } catch (_) {}
              try { const { wpPush } = await import('./_webpush.js'); await wpPush(null, { title: `⚠️ 問題回報【${itP.st}】`, body: `${(itP.text || '（附件）').slice(0, 60)} — ${itP.by}`, url: '/prep' }) } catch (_) {} // v4.33.0 GD推播
              await repP(`✅ 已發布到內部群：${headP}`)
            } else if (piOp === 'hold') {
              itP.pub = 'hold'
              await kvSet('sp_finance_pm_sop_issues', docP)
              await repP(`📥 已保留（不進群，看板上仍看得到）：${headP}`)
            } else if (piOp === 'del') {
              docP.list = (docP.list || []).filter(x => x.id !== piId)
              await kvSet('sp_finance_pm_sop_issues', docP)
              await repP(`🗑 已刪除：${headP}`)
            }
          } catch (e) { console.log('pub issue postback error', e?.message); await repP('⚠️ 處理出錯，再按一次或到 /prep 任務分頁操作。') }
          continue
        }
        if (/^bd\|/.test(pdata)) { // 綁定審核按鈕（張良 2026-10-03「按了就過」）：bd|ok|rid|名 核准、bd|no|rid|名 拒絕——只有審核人能按
          const [, bdOp, bdRid, bdNm] = pdata.split('|')
          const uidB = ev.source.userId
          const repB = (t2) => ev.replyToken ? lineReply(ev.replyToken, t2) : Promise.resolve()
          try {
            const kvB = await kvGetMany(['sp_finance_pm_prep_perm', 'sp_finance_pm_sop_def', 'sp_crew_kb_roster', 'sp_finance_pm_prep_bind'])
            const aprB = (((kvB['sp_finance_pm_sop_def'] || {}).ground || {}).approvers || ['張良瑋'])
            const meB = ((kvB['sp_crew_kb_roster'] || {}).people || []).find(p2 => p2.lineUserId === uidB)
            if (!meB || !aprB.includes(meB.name)) { await repB('這按鈕只有審核人能用喔。'); continue }
            const pmB = kvB['sp_finance_pm_prep_perm'] || { mode: 'approve', users: {}, pending: {} }
            const pd = (pmB.pending || {})[bdRid]
            if (!pd) { await repB((pmB.users || {})[bdRid]?.edit ? `✅ ${bdNm} 已經核准過了。` : `找不到 ${bdNm} 的待審申請（可能已處理）。`); continue }
            if (bdOp === 'ok') {
              pmB.users[bdRid] = { name: pd.name, edit: 1, by: meB.name, ts: pd.ts }
              delete pmB.pending[bdRid]
              await kvSet('sp_finance_pm_prep_perm', pmB)
              try { // 核准→DD 通知當事人（同 /prep 權限設定 ✅ 的通知）
                let uidA = pd.uid
                if (!uidA) { const bdDoc = kvB['sp_finance_pm_prep_bind'] || {}; uidA = (Object.values(bdDoc.tokens || {}).find(t2 => t2.rid === bdRid || t2.uid === bdRid) || {}).uid }
                if (uidA) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ to: uidA, messages: [{ type: 'text', text: '✅ 你的 /prep 編輯權限審核通過了！重新整理頁面就能編輯。' }] }) })
              } catch (_) {}
              await repB(`✅ 已核准 ${pd.name}，他現在可以編輯了（我也通知他了）。`)
            } else {
              delete pmB.pending[bdRid]
              await kvSet('sp_finance_pm_prep_perm', pmB)
              await repB(`❌ 已拒絕 ${pd.name} 的編輯權限申請（沒有通知他）。`)
            }
          } catch (e) { console.log('bind approve postback error', e?.message); await repB('⚠️ 處理出錯，再按一次，或到 /prep → 設定 → 🔐權限設定 操作。') }
          continue
        }
        try { await handleDDCards(ev, await getOperators()) } catch (e) { console.log('ddcards postback error', e?.message) }
        continue
      }
      // 工作日誌（張良 2026-08-20：群組跟 DD 講也要能記）：固定前綴「日誌/心得 …」私訊＋群組都收、不用點名；
      // 記完 15 分鐘內傳的照片自動附上（下面 image 分支）；未綁定者在群組保持安靜（外部群安靜原則）
      const gcE = (ev.source?.type !== 'user') ? await ddGrpCfg(ev) : null // v4.70.38 這個群的個別設定（null＝私訊或讀不到＝照舊）
      if (ev.type === 'message' && ev.message?.type === 'text' && !(gcE && (gcE.journal === 0 || gcE.mode === 'off'))) {
        try { const jr = await handleJournalText(ev); if (jr?.consumed) { if (ev.source?.type !== 'user') { await cacheGroupMsg(ev); ddReplyLog(ev, 'journal', ev.message.text, '（已記日誌）').catch(() => {}) }; continue } } catch (e) { console.log('journal error', e?.message) }
      }
      // 工作日誌照片：綁定夥伴 15 分鐘內記過日誌 → 這張圖直接附到那則（私訊＋群組）。
      // 先「只查不寫」確認有近期日誌，才下載上傳——廠商群的圖不會被誤傳進公開桶；沒近期日誌就走原本檔案庫/文件流程
      // 📎 入職文件收檔（v4.35.0）：私訊且 15 分內有「文件 …」情境 → 照片/檔案進私有桶+名冊欄位
      if (ev.type === 'message' && (ev.message?.type === 'image' || ev.message?.type === 'file') && ev.source?.type === 'user') {
        try {
          const uidD = ev.source?.userId || ''
          const pendD = (await kvGetMany(['pm_hrdoc_pending']))['pm_hrdoc_pending'] || {}
          const ctxD = pendD[uidD]
          if (ctxD && Date.now() - ctxD.ts < 15 * 60e3) {
            const rD = await fetch(`https://api-data.line.me/v2/bot/message/${ev.message.id}/content`, { headers: { authorization: `Bearer ${TOKEN}` } })
            if (rD.ok) {
              const bufD = Buffer.from(await rD.arrayBuffer())
              const ctD = rD.headers.get('content-type') || 'application/octet-stream'
              const extD = ev.message.type === 'file' ? (String(ev.message.fileName || '').split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : (/png/.test(ctD) ? 'png' : 'jpg')
              const { uploadPrivate } = await import('./_onboard.js')
              const pathD = `hrdocs/${/A Beach/.test(ctxD.co) ? 'ab' : 'gd'}/${encodeURIComponent(ctxD.name)}/${ctxD.key}-${Date.now().toString(36)}.${extD}`
              if (bufD.length <= 15 * 1024 * 1024 && await uploadPrivate(pathD, bufD, ctD)) {
                const docMD = (await kvGetMany(['sp_crew_pm_hr_master']))['sp_crew_pm_hr_master'] || { rows: [] }
                const rowD = (docMD.rows || []).find(r9 => r9.co === ctxD.co && r9.name === ctxD.name)
                if (rowD) {
                  rowD.docs = rowD.docs || {}; rowD.docs[ctxD.key] = rowD.docs[ctxD.key] || { files: [] }
                  rowD.docs[ctxD.key].files.push({ path: pathD, ext: extD, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), by: ctxD.by })
                  docMD.log = [{ by: ctxD.by, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: `DD上傳 ${ctxD.name} ${ctxD.key}` }, ...(docMD.log || [])].slice(0, 80)
                  docMD.updatedAt = new Date().toISOString()
                  await kvSet('sp_crew_pm_hr_master', docMD)
                  ctxD.ts = Date.now(); await kvSet('pm_hrdoc_pending', pendD) // 連傳多張=每張都續 15 分鐘
                  if (ev.replyToken) await lineReply(ev.replyToken, `✅ 已歸檔：${ctxD.name}・${ctxD.label}（第 ${rowD.docs[ctxD.key].files.length} 份）\n夥伴名冊 → 點他的「📎 文件」就看得到。`)
                  continue
                }
              }
              if (ev.replyToken) await lineReply(ev.replyToken, '檔案收到了但歸檔失敗（太大或格式怪），再試一次 🙏')
              continue
            }
          }
        } catch (e) { console.log('hrdoc upload err', e?.message) }
      }
      if (ev.type === 'message' && ev.message?.type === 'image' && !(gcE && (gcE.journal === 0 || gcE.mode === 'off'))) {
        try {
          const uidJ = ev.source?.userId || ''
          if (uidJ && await attachJournalPhotos(uidJ, [])) {
            const rJ = await fetch(`https://api-data.line.me/v2/bot/message/${ev.message.id}/content`, { headers: { authorization: `Bearer ${TOKEN}` } })
            if (rJ.ok) {
              const bufJ = Buffer.from(await rJ.arrayBuffer())
              const ctJ = rJ.headers.get('content-type') || 'image/jpeg'
              const { url } = await uploadToPhotos(bufJ, /png/.test(ctJ) ? 'png' : 'jpg', ctJ)
              const hit = await attachJournalPhotos(uidJ, [url])
              if (hit) { if (ev.replyToken) await lineReply(ev.replyToken, `📷 照片已附到 ${hit.name} 剛剛的日誌（共 ${(hit.photos || []).length} 張）。`); ddReplyLog(ev, 'photo', '（照片）', '照片已附到 ' + hit.name + ' 的日誌').catch(() => {}); continue }
            }
          }
        } catch (e) { console.log('journal photo error', e?.message) }
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
          if (!isDM2 || (await getOperators())[uid2] || (await libWhoByLine(uid2))) await stashLibraryFile(ev, cid) // 私訊幫操作者＋已綁定GD者記（文件庫歸檔要用）；群組都記
        } catch (e) { console.log('filelib stash error', e?.message) }
        continue
      }
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue
      const gid = ev.source?.groupId || ev.source?.roomId || ev.source?.userId
      const text = (ev.message.text || '').trim()
      const isDM = ev.source?.type === 'user' // 一對一私訊
      // v4.70.38 群組設定「不回話」：只默默快取＋登記群，其他一律不做（不翻譯、不回答、不認指令）
      if (!isDM && gcE && gcE.mode === 'off') { await cacheGroupMsg(ev); await registerGroup(gid, ev.source?.type); continue }
      // 🌐 翻譯模式快速通道（張良 2026-09-30「能不能秒翻」）：翻譯群第一時間翻、其他紀錄射後不理（v4.70.38 該群 translate=0 就不翻）
      if (!isDM && !(gcE && gcE.translate === 0) && !/^(關翻譯|(?:DD\s*)?開翻譯)/i.test(text)) {
        const trDocF = (await kvGetMany(['pm_bot_translate']))['pm_bot_translate'] || {}
        const trCfgF = trDocF[gid]
        if (trCfgF && trCfgF.mode && Date.now() - (trCfgF.on || 0) <= 12 * 3600e3) {
          cacheGroupMsg(ev).catch(() => {}) // 不等
          try { const tr = await ddTranslate(text, trCfgF.mode); if (tr && ev.replyToken) { await lineReply(ev.replyToken, '🌐 ' + tr); ddReplyLog(ev, 'translate', text, tr).catch(() => {}) } } catch (e) { console.log('translate err', e?.message) }
          continue
        }
        if (trCfgF && Date.now() - (trCfgF.on || 0) > 12 * 3600e3) { delete trDocF[gid]; kvSet('pm_bot_translate', trDocF).catch(() => {}) }
      }
      // 群組文字訊息先快取（回收監控用；私訊不快取）
      if (ev.source?.type !== 'user') await cacheGroupMsg(ev)
      // 只登記「群組/聊天室」到群組頁；私訊(user)不是群，登記進去會在群組頁出現「未命名群」
      if (ev.source?.type !== 'user') await registerGroup(gid, ev.source?.type)
      // ── 🌐 翻譯模式（張良 2026-09-29）：群裡「開翻譯 中英/中韓」（操作者限定）→ 該群每句話自動雙向翻到「關翻譯」為止（12小時自動關保險）──
      if (!isDM && !(gcE && gcE.translate === 0)) { // v4.70.38 該群關掉翻譯＝開翻譯指令當一般訊息
        const trM = text.match(/^(?:DD\s*)?開翻譯\s*(中英|中韓)?$/i)
        const trOff = /^(?:DD\s*)?關翻譯$/i.test(text)
        if (trM || trOff) {
          const ops0 = await getOperators()
          if (!ops0[ev.source?.userId || '']) { /* 非操作者的開關指令當一般訊息 */ } else {
            const trDoc = (await kvGetMany(['pm_bot_translate']))['pm_bot_translate'] || {}
            if (trOff) { delete trDoc[gid]; await kvSet('pm_bot_translate', trDoc); await lineReply(ev.replyToken, '🌐 翻譯模式已關閉。'); ddReplyLog(ev, 'cmd', text, '翻譯模式已關閉').catch(() => {}); continue }
            const md = trM[1] === '中韓' ? 'zh-ko' : 'zh-en'
            trDoc[gid] = { mode: md, on: Date.now(), by: ev.source?.userId }
            await kvSet('pm_bot_translate', trDoc)
            ddReplyLog(ev, 'cmd', text, '翻譯模式 ON ' + md).catch(() => {})
            await lineReply(ev.replyToken, md === 'zh-ko' ? '🌐 翻譯模式 ON（中⇄韓）：這個群每句話我都會自動翻譯，直到說「關翻譯」。\n🌐 통역 모드 시작: 이 방의 모든 메시지를 자동으로 번역합니다.' : '🌐 翻譯模式 ON（中⇄英）：這個群每句話我都會自動翻譯，直到說「關翻譯」。\n🌐 Translation mode ON: I will translate every message in this chat automatically.')
            continue
          }
        }
      }
      // 只在「真的被 @到本帳號」(排除 @All/@他人) 或「明確叫到 D哥」時才回。
      // 移除舊的 /@d/：它會誤中別人的 @Doris、@David… 導致 D 插嘴。
      const mentionees = ev.message?.mention?.mentionees || []
      const mentionedSelf = mentionees.some((m) => m.isSelf === true && m.type !== 'all')
      // 叫名字：新名 DD（要獨立字，避免 add/odd 誤觸）或舊名 D哥 都算
      // v4.70.38 群組設定 quiet（安靜）＝只認 @DD 本帳號，字裡提到 D哥／dd 不插嘴（廠商群、外部群建議設這個）
      const quietG = !isDM && gcE && gcE.mode === 'quiet'
      const named = mentionedSelf || (!quietG && (/d哥/i.test(text) || /(^|[^a-z0-9])dd([^a-z0-9]|$)/i.test(text)))
      console.log('event', JSON.stringify({ src: ev.source?.type, isDM, named, mSelf: mentionedSelf, quiet: !!quietG, text: text.slice(0, 40) }))
      if (!isDM && !named) continue // 私訊一律回；群組必須被點名（@本帳號 或 講「D哥」；安靜群只認 @）
      const userId = ev.source?.userId || ''
      const convId = isDM ? ('dm_' + userId) : ('g_' + gid) // 對話記憶的識別
      const whyG = mentionedSelf ? 'mention' : 'name'
      const send = async (t, extra) => {
        if (!isDM) ddReplyLog(ev, whyG, text, t).catch(() => {})
        const okS = ev.replyToken ? await lineReply(ev.replyToken, t, extra, isDM ? userId : gid) : false // v4.70.39 reply 失敗改 push 給同一對象
        ddHealthLog({ kind: 'reply', dm: isDM ? 1 : 0, conv: String(convId).slice(-6), ms: Date.now() - tEv, ok: okS ? 1 : 0, send: _lastSend, ai: _aiAgg && _aiAgg.calls ? _aiAgg : null, len: String(t || '').length }).catch(() => {})
        return okS
      }
      // finish＝回覆＋把這輪存進對話記憶（讓 D哥 記得前文）；授權訊息不用 finish(含密碼，不留紀錄)
      // hist＝存進對話記憶的版本（可跟送出的不同）。動作輪要存「含 json 指令」的原始回覆，
      // 不然記憶裡只剩「✅ 已直接記好」文字、沒有指令 → DD 回頭學自己的歷史，學會只寫✅不夾指令（2026-09-12 自導自演翻車根因）
      const finish = async (t, extra, hist) => { await send(t, extra); await pushChat(convId, text, hist || t) }

      // ── 動作引擎（只在「私訊」進行，群組一律唯讀，較安全）──
      // 1) 授權：私訊「授權:碼」→ 列入操作者白名單
      const mAuth = text.match(/^授權[\s:：]*([^\s]+)/)
      if (isDM && mAuth && sigOK !== false) { // 簽章驗不過的偽造請求不准拿授權
        if (!OP_CODE) { await send('（系統尚未設定操作密碼 BOT_OP_CODE，目前無法授權操作。請先在 Vercel 設定。）'); continue }
        if (mAuth[1] === OP_CODE) { const name = await getLineProfile(userId); const op = await addOperator(userId, name); await send(`✅ 已授權「${op.name}」為操作者，之後可以直接用對話叫我新增/修改資料（執行前我都會先問你確認）。`) }
        else await send('❌ 授權碼不對。')
        continue
      }
      const operators = await getOperators()
      // v2.5.9 治本（2026-09-16 翻車根因）：以前 op 只認私訊（群組一律唯讀），張良在群組叫 DD
      // 建 7 件任務 → canAct=false → AI 沒拿到動作指南也沒被告知唯讀，整篇「都建好了」其實 0 寫入，
      // 而且 0 動作抓包網也只對 canAct 開 → 群組假完成完全沒被攔。
      // 現在：群組訊息只要發話者在操作者白名單，一樣能下指令（授權本身仍只能私訊辦；非白名單照舊唯讀）
      const op = operators[userId] || null
      // 安全（2026-09-01）：LINE 簽章驗不過（sigOK===false）＝可能是偽造請求 → 一律不給操作權限
      // （密碼庫/記帳/改資料全鎖；一般問答照回，就算真的設定出錯 DD 也不會啞掉）
      if (sigOK === false && op) console.log('sig FAIL → 拒絕操作權限', userId.slice(-6))
      const canAct = !!op && sigOK !== false

      // 1.34) 「轉給CC」直通車（v4.41.3 張良 2026-10-04 拍板：B自動掃夥伴許願太危險打槍、C=只有他本人下暗號才算）：
      // 只認「張良本人」的訊息（夥伴/其他操作者都不行=一定經過他）→ 寫進 pm_cc_inbox 收件匣,
      // CC 側排程每15分撿單照專案慣例實作+部署+ccdone銷單+推播回報;CC沒開機=累積在收件匣不會丟
      // v4.42.3 暗號放寬（張良實測打「轉告CC」沒進直通車=只記成任務卡沒人執行）：轉給/轉告/交給/丟給 CC 都算
      const mCC = text.match(/^(?:轉給|轉告|交給|丟給)\s*CC[:：,，\s]*([\s\S]*)$/i)
      if (mCC && canAct && /張良/.test(op?.name || '')) {
        const bodyCC = (mCC[1] || '').trim()
        if (!bodyCC) { await send('要轉什麼給 CC？整句寫在「轉給CC」後面（例：轉給CC 把備料表加一欄昨日實際用量）。'); continue }
        const docCC = (await kvGetMany(['pm_cc_inbox']))['pm_cc_inbox'] || { list: [] }
        docCC.list = [{ id: 'cc' + Date.now().toString(36), ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), text: bodyCC.slice(0, 2000), status: 'open' }, ...(docCC.list || [])].slice(0, 100)
        await kvSet('pm_cc_inbox', docCC)
        // v4.45.6（CC許願：回覆文案改正＋開工即時回報）：寫一筆「開工回報」待補——CC 撿單時會先發「開工」
        await send(`✅ 已收進 CC 收件匣（待辦 ${docCC.list.filter(x => x.status === 'open').length} 件）。CC 在線時最快 20 秒內開工，開工跟完成都會即時回報你；沒在線就先排隊，下次開工第一件處理。`)
        continue
      }
      // 1.35) App 身分綁定（張良 2026-09-21：夥伴打卡不用手填名字）：任何夥伴私訊「綁定GD」→
      // 用入職系統綁好的 lineUserId 對到名冊本人 → 發個人專屬連結（/prep?me=token，手機點開就永遠是他）。
      // 一個 bot 可掛多個 app：之後「綁定AB」等指令加進 BIND_APPS 就好，身分 token 各 app 共用（本人只有一個）
      const BIND_APPS = { GD: 'https://ground-pm.vercel.app/prep', 看板: 'https://ground-pm.vercel.app/prep' } // 舊詞「綁定看板」相容
      // 一步到位（張良 2026-09-21：別叫人先走主App的「報到」流程重複設定）：
      // 「綁定GD」→ LINE已對到名冊＝直接給連結；還沒對到＝教他「綁定GD 本名」一句話連身分帶連結一次完成
      // 「綁定GD」就好（張良 2026-09-21 Zoey 綁不上抓包）：不逼人打本名——自動抓 LINE 名稱，
      // 先對名冊(本名或綽號、含大小寫寬鬆)，對到＝用名冊本名＋補 lineUserId；對不到＝直接用 LINE 名稱綁（照樣能用，打卡對不到名冊時再補）。
      // 「綁定GD 名字」仍可用（本名或綽號都認）；帶名字比對放寬到綽號是因為名冊「姓名（綽號）」兩欄都是大家的慣用稱呼。
      const mBind = isDM && text.match(/^綁定\s*(GD|看板|AB)\s*(\S{1,12})?\s*$/i)
      if (mBind) {
        const appKey = mBind[1].toUpperCase() === 'AB' ? 'AB' : (mBind[1] === '看板' ? '看板' : 'GD')
        if (!BIND_APPS[appKey]) { await send('「' + appKey + '」的 App 還沒開通，目前可以綁定：GD（營運看板）。'); continue }
        try {
          const kvb = await kvGetMany(['sp_crew_kb_roster', 'sp_finance_pm_prep_bind'])
          const rosterDoc2 = kvb['sp_crew_kb_roster'] || { people: [] }
          const ppl = (rosterDoc2.people || []).filter(p => !p.endDate)
          const byNameOrNick = (s) => { const q = String(s || '').trim().toLowerCase(); return q ? ppl.find(p => (p.name || '').toLowerCase() === q || (p.nick || '').toLowerCase() === q) : null }
          let rp = ppl.find(p => p.lineUserId === userId)
          let note2 = ''
          if (!rp && mBind[2]) { // 帶名字版：本名或綽號都認；名冊沒這人→自動建入職卡（v4.56.0 張良「整合成一步,只要/prep」）
            const cand = byNameOrNick(mBind[2])
            if (cand && cand.lineUserId && cand.lineUserId !== userId) { await send('這個名字已經綁定過其他 LINE 帳號。如果是你本人換帳號，請聯絡店長解除舊綁定。'); continue }
            if (cand) { cand.lineUserId = userId; await kvSet('sp_crew_kb_roster', rosterDoc2); rp = cand }
            else { // 名冊找不到＝新夥伴：自動建「入職中」名冊卡並綁定（onboarding待審核+權限守門+下方isNewBind通知老闆審核卡），不再卡住要他先報到
              const newP = { id: 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: mBind[2].trim(), nick: '', dept: '', role: 'staff', status: '在職', onboarding: true, onboardAt: new Date().toISOString(), lineUserId: userId, gd: 1 }
              rosterDoc2.people.push(newP); await kvSet('sp_crew_kb_roster', rosterDoc2); rp = newP
              note2 = '\n\n（你是新夥伴，已自動建好名冊卡、待店長核准。基本資料／證件／簽約之後在 App 名冊卡補就好。）'
            }
          }
          if (!rp) { // 一句「綁定GD」→ 自動用 LINE 名稱
            const ln = await getLineProfile(userId)
            const cand = byNameOrNick(ln)
            if (cand && (!cand.lineUserId || cand.lineUserId === userId)) { cand.lineUserId = userId; await kvSet('sp_crew_kb_roster', rosterDoc2); rp = cand }
            // LINE 名稱對不到名冊＝不再將就綁（張良 2026-10-01：夏👌這種名字辨識不了誰是誰）→ 要求帶本名
            else { await send('為了確認你是誰，回我「綁定GD 你的本名」就好（例：綁定GD 張良瑋）。'); continue }
          }
          if (rp.id) { // 綁定的人自動標成 GD 人員（名冊可再取消；張良 2026-09-21）
            const pgd = (rosterDoc2.people || []).find(p => p.id === rp.id)
            if (pgd && !pgd.gd) { pgd.gd = 1; await kvSet('sp_crew_kb_roster', rosterDoc2) }
          }
          const bind = kvb['sp_finance_pm_prep_bind'] || { byUid: {}, tokens: {} }
          let tk2 = bind.byUid[userId]
          const isNewBind = !tk2
          if (!tk2) {
            tk2 = 'pv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
            bind.byUid[userId] = tk2
          }
          bind.tokens[tk2] = { ...(bind.tokens[tk2] || {}), name: rp.name, rid: rp.id, uid: userId, ts: bind.tokens[tk2]?.ts || new Date().toISOString() }
          await kvSet('sp_finance_pm_prep_bind', bind)
          // 綁定即自動申請編輯權限（張良 2026-10-01：不要廢話；綁完=等待審核，核准後 DD 通知當事人）
          let pendTxt = ''
          try {
            const permB = (await kvGetMany(['sp_finance_pm_prep_perm']))['sp_finance_pm_prep_perm'] || { mode: 'approve', users: {}, pending: {} }
            const pKey = rp.id || userId
            if (permB.mode === 'approve' && !(permB.users[pKey] && permB.users[pKey].edit)) {
              permB.pending = permB.pending || {}
              permB.pending[pKey] = { name: rp.name, uid: userId, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') }
              await kvSet('sp_finance_pm_prep_perm', permB)
              pendTxt = '\n已自動幫你申請編輯權限，核准後我會通知你。'
            }
          } catch (_) {}
          await send(`✅ ${rp.name} 綁定完成！點一下啟用👇\n${BIND_APPS[appKey]}?me=${tk2}${rp.onboarding ? '#tab=onb' : ''}${pendTxt}${note2}`)
          if (isNewBind) { // 新綁定→DD 通知老闆（張良 2026-09-21：任何人綁定完成要跟我說）
            try {
              const defB2 = await kvGetMany(['sp_finance_pm_sop_def'])
              const aprB2 = (((defB2['sp_finance_pm_sop_def'] || {}).ground || {}).approvers || ['張良瑋'])
              for (const an of aprB2) {
                const ap = (rosterDoc2.people || []).find(p => p.name === an && p.lineUserId)
                // v4.26.0（張良 2026-10-03：綁定審核改按鈕卡「按了就過」）：✅核准/❌拒絕 postback bd|，不用再打字或進 /prep
                if (ap && ap.lineUserId !== userId) { const { buildBindApproveCard } = await import('./_ddcards.js'); await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ to: ap.lineUserId, messages: [buildBindApproveCard(rp.name, rp.id || userId)] }) }) }
              }
            } catch (_) {}
          }
        } catch (e) { await send('綁定出了點問題，稍後再試一次 🙏') }
        continue
      }
      // 1.355) 我的連結（v4.31.0 張良：換瀏覽器打開變訪客→最簡單的「登入」＝把個人連結再發一次，點了就自動登入）
      // 只限私訊本人索取；個人連結絕不進群組、絕不經 AI
      if (isDM && /^(我的連結|個人連結|連結|登入|重新登入|登入碼)$/.test(text.trim())) {
        try {
          const bindL = (await kvGetMany(['sp_finance_pm_prep_bind']))['sp_finance_pm_prep_bind'] || {}
          const tkL = (bindL.byUid || {})[userId]
          if (tkL) {
            // v4.31.3 四位數登入碼（張良：綁定碼要更簡單＝打4個數字就好）：10分鐘有效、用一次就失效、過期自動清
            let codeMsg = ''
            try {
              const lcDoc = (await kvGetMany(['sp_finance_pm_prep_logincode']))['sp_finance_pm_prep_logincode'] || { codes: {} }
              const nowC = Date.now()
              for (const [k9, v9] of Object.entries(lcDoc.codes || {})) if (!v9 || v9.exp < nowC) delete lcDoc.codes[k9]
              let c9 = ''
              do { c9 = String(Math.floor(1000 + Math.random() * 9000)) } while (lcDoc.codes[c9])
              lcDoc.codes[c9] = { tk: tkL, exp: nowC + 10 * 60e3 }
              await kvSet('sp_finance_pm_prep_logincode', lcDoc)
              codeMsg = `🔢 登入碼【 ${c9} 】\nApp 按右上「登入」→ 輸入這 4 個數字就好（10分鐘內有效）\n\n`
            } catch (_) {}
            await send(`${codeMsg}🔑 或點個人連結自動登入（換手機/瀏覽器都通用）👇\nhttps://ground-pm.vercel.app/prep?me=${tkL}`)
          }
          else await send('你還沒綁定過，回我「綁定GD 你的本名」就好（例：綁定GD 張良瑋）。')
        } catch (_) { await send('查連結出了點問題，稍後再試一次 🙏') }
        continue
      }
      // 1.357) 📎 入職文件上傳 v4.35.0（張良「從DD上傳檔案或照片 直接到對應的欄位」）：主管私訊「文件 姓名 文件名」→ 15分內傳照片/檔案自動歸檔私有桶
      // 1.356) 📇 名冊文字欄位直改 v4.35.2（張良「緊急聯絡人 趙以棠 0958120009 這樣DD就會自動更新資料嗎」→ 會）：
      // 「緊急聯絡人 姓名 內容」或「名冊 姓名 欄位 值」（欄位=部門/職務/到職日/生日/性別/緊急聯絡人）；主管限定、留痕
      if (isDM && /^確認$/.test(text.trim())) { // 緊急聯絡人防呆的「確認」回覆（10分鐘內有效）
        try {
          const pendE2 = (await kvGetMany(['pm_emr_confirm']))['pm_emr_confirm'] || {}
          const cE = pendE2[userId]
          if (cE && Date.now() - cE.ts < 10 * 60e3) {
            const docE2 = (await kvGetMany(['sp_crew_pm_hr_master']))['sp_crew_pm_hr_master'] || { rows: [] }
            const rowE2 = (docE2.rows || []).find(r9 => r9.co === cE.co && r9.name === cE.name)
            if (rowE2) {
              const bE2 = rowE2.emer || '（空）'
              rowE2.emer = cE.val
              docE2.log = [{ by: cE.by, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: `DD改 ${cE.name} emer(已確認)` }, ...(docE2.log || [])].slice(0, 80)
              docE2.updatedAt = new Date().toISOString()
              await kvSet('sp_crew_pm_hr_master', docE2)
              delete pendE2[userId]; await kvSet('pm_emr_confirm', pendE2)
              await send(`✅ 已更新 ${cE.name} 的緊急聯絡人：\n${bE2} → ${cE.val}`)
              continue
            }
          }
        } catch (_) {}
      }
      const mEmrMe = isDM && text.match(/^我的緊急聯絡人\s+(.{2,40})$/) // v4.35.4 張良抓包：「緊急聯絡人 趙以棠 0958…」他本意=自己的聯絡人是趙以棠→新增「我的」版=掛發話者本人名下
      const mEmr = isDM && !mEmrMe && text.match(/^緊急聯絡人\s+(\S{2,10})\s+(.{2,40})$/)
      const mRos = isDM && text.match(/^名冊\s+(\S{2,10})\s+(部門|職務|到職日|生日|性別|緊急聯絡人)\s+(.{1,40})$/)
      if (mEmrMe) { // 掛自己名下（發話者=綁定本名，要在夥伴名冊裡）
        try {
          const kvM9 = await kvGetMany(['sp_crew_pm_hr_master', 'sp_finance_pm_prep_bind'])
          const bindM9 = kvM9['sp_finance_pm_prep_bind'] || {}
          const tkM9 = (bindM9.byUid || {})[userId]
          const meM9 = tkM9 ? ((bindM9.tokens || {})[tkM9] || {}).name : null
          if (!meM9) { await send('先綁定才知道你是誰——私訊我「綁定GD 本名」。'); continue }
          const docM9 = kvM9['sp_crew_pm_hr_master'] || { rows: [] }
          const rowM9 = (docM9.rows || []).find(r9 => r9.name === meM9)
          if (!rowM9) { await send(`夥伴名冊裡找不到你（${meM9}）——跟張良說一聲加進名冊。`); continue }
          const beforeM9 = rowM9.emer || '（空）'
          rowM9.emer = mEmrMe[1].trim().slice(0, 60)
          docM9.log = [{ by: meM9, ts: new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' '), what: `DD改 ${meM9} emer(本人)` }, ...(docM9.log || [])].slice(0, 80)
          docM9.updatedAt = new Date().toISOString()
          await kvSet('sp_crew_pm_hr_master', docM9)
          await send(`✅ 已更新「你本人（${meM9}）」的緊急聯絡人：\n${beforeM9} → ${rowM9.emer}`)
        } catch (_) { await send('更新出了點問題 🙏') }
        continue
      }
      if (mEmr || mRos) {
        try {
          const nmQ = mEmr ? mEmr[1] : mRos[1]
          const fdMap = { 部門: 'dept', 職務: 'title', 到職日: 'onboard', 生日: 'birth', 性別: 'sex', 緊急聯絡人: 'emer' }
          const fdK = mEmr ? 'emer' : fdMap[mRos[2]]
          let valQ = (mEmr ? mEmr[2] : mRos[3]).trim()
          const kvR = await kvGetMany(['sp_crew_pm_hr_master', 'sp_finance_pm_sop_def', 'sp_finance_pm_prep_bind', 'sp_crew_kb_roster'])
          const bindR = kvR['sp_finance_pm_prep_bind'] || {}
          const tkR = (bindR.byUid || {})[userId]
          const meR = tkR ? ((bindR.tokens || {})[tkR] || {}).name : null
          const aprR = (((kvR['sp_finance_pm_sop_def'] || {}).ground || {}).approvers || ['張良瑋'])
          const roleR = meR ? ((((kvR['sp_crew_kb_roster'] || {}).people) || []).find(p9 => p9.name === meR) || {}).gdRole : ''
          if (!meR || !(aprR.includes(meR) || roleR === '主管')) { await send('名冊編輯只開放主管使用 🙏'); continue }
          const docR = kvR['sp_crew_pm_hr_master'] || { rows: [] }
          const psnR = (docR.rows || []).filter(r9 => r9.name.includes(nmQ) || nmQ.includes(r9.name))
          if (!psnR.length) { await send(`夥伴名冊找不到「${nmQ}」。`); continue }
          if (psnR.length > 1) { await send(`有 ${psnR.length} 個同名：${psnR.map(x => x.name + '(' + (/A Beach/.test(x.co) ? 'AB' : 'GD') + ')').join('、')}——名字打完整一點。`); continue }
          const rowR = psnR[0]
          if (fdK === 'onboard' || fdK === 'birth') { // 日期寬鬆收：2026/9/1、2026-9-1、民國 115-9-1 都轉標準
            const dm9 = valQ.match(/^(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/)
            if (!dm9) { await send('日期格式看不懂——用 2026-09-01 這種寫法。'); continue }
            let yy9 = +dm9[1]; if (yy9 < 200) yy9 += 1911
            valQ = `${yy9}-${String(+dm9[2]).padStart(2, '0')}-${String(+dm9[3]).padStart(2, '0')}`
          }
          // v4.35.5 防呆（張良「他沒發現我不是趙以棠本人」）：改「別人」的緊急聯絡人、內容又只有電話（看不出聯絡人是誰）→ 先確認意圖，不直接寫
          if (fdK === 'emer' && rowR.name !== meR && /^[\d\s\-+()]{6,}$/.test(valQ)) {
            const pendE = (await kvGetMany(['pm_emr_confirm']))['pm_emr_confirm'] || {}
            pendE[userId] = { co: rowR.co, name: rowR.name, val: valQ.slice(0, 60), ts: Date.now(), by: meR }
            await kvSet('pm_emr_confirm', pendE)
            await send(`等等，先確認一下你的意思 🤔\n\n1️⃣ 「${rowR.name} 的」緊急聯絡人＝${valQ}\n　→ 回我「確認」就改\n\n2️⃣ 「你（${meR}）的」緊急聯絡人是 ${rowR.name}（${valQ}）\n　→ 打「我的緊急聯絡人 ${rowR.name} ${valQ}」\n\n（判斷依據：你不是${rowR.name}本人，而且內容只有電話、看不出聯絡人叫什麼）`)
            continue
          }
          const before9 = rowR[fdK] || '（空）'
          rowR[fdK] = valQ.slice(0, 60)
          if (fdK === 'birth') rowR.age = Math.floor((Date.now() - new Date(rowR.birth).getTime()) / 31557600000)
          const ts8R = new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
          docR.log = [{ by: meR, ts: ts8R, what: `DD改 ${rowR.name} ${fdK}` }, ...(docR.log || [])].slice(0, 80)
          docR.updatedAt = new Date().toISOString()
          await kvSet('sp_crew_pm_hr_master', docR)
          await send(`✅ 已更新 ${rowR.name}（${/A Beach/.test(rowR.co) ? 'AB' : 'GD'}）的${mEmr ? '緊急聯絡人' : mRos[2]}：\n${before9} → ${rowR[fdK]}${fdK === 'birth' ? `（年齡自動改 ${rowR.age}）` : ''}${mEmr ? '\n\n（這是改「' + rowR.name + ' 的」緊急聯絡人欄；如果你是要登記自己的，打「我的緊急聯絡人 ' + rowR.name + ' ' + rowR[fdK] + '」我會掛你名下）' : ''}`)
        } catch (e) { await send('更新出了點問題，再試一次 🙏') }
        continue
      }
      const mDoc = isDM && text.match(/^文件\s*(\S{2,10})\s+(\S{1,12})\s*$/)
      const mDocQ = isDM && !mDoc && text.match(/^文件\s*(\S{2,10})\s*$/) // 只打「文件 姓名」=回收件狀態
      if (mDocQ) {
        try {
          const kvQ = await kvGetMany(['sp_crew_pm_hr_master'])
          const rowsQ = (kvQ['sp_crew_pm_hr_master'] || {}).rows || []
          const psnQ = rowsQ.filter(r9 => r9.name.includes(mDocQ[1]) || mDocQ[1].includes(r9.name))
          if (psnQ.length !== 1) { await send(psnQ.length ? '同名多人，名字打完整一點。' : `夥伴名冊找不到「${mDocQ[1]}」。`); continue }
          const xQ = psnQ[0]
          const DSET = [['contract', '勞動契約'], ['idcard', '身分證影本'], ['bank', '存摺影本'], ['health', '體檢報告'], ['hygiene', '衛生教育訓練'], ...((+xQ.age || 99) < 18 ? [['guardian', '法代同意書（未成年）']] : [])]
          const lines9 = DSET.map(([k9, n9]) => `${((((xQ.docs || {})[k9]) || {}).files || []).length ? '✅' : '⬜'} ${n9}`)
          const missQ = DSET.filter(([k9]) => !((((xQ.docs || {})[k9]) || {}).files || []).length)
          await send(`📎 ${xQ.name}（${/A Beach/.test(xQ.co) ? 'AB' : 'GD'}）入職文件：\n${lines9.join('\n')}${missQ.length ? `\n\n要補哪件就回我「文件 ${xQ.name} ${missQ[0][1].slice(0, 2)}」再傳檔案。` : '\n\n全部收齊了 🎉'}`)
        } catch (_) { await send('查詢出了點問題 🙏') }
        continue
      }
      if (mDoc) {
        try {
          const HRD = { contract: ['勞動契約', '契約', '合約'], idcard: ['身分證'], bank: ['存摺', '銀行'], health: ['體檢', '健檢'], hygiene: ['衛生', '教育訓練', '講習'], guardian: ['法代', '法定代理', '同意書'] } // v4.35.1 大頭照/緊急聯絡/勞健保退役
          const kvD = await kvGetMany(['sp_crew_pm_hr_master', 'sp_finance_pm_sop_def', 'sp_finance_pm_prep_bind'])
          const bindD = kvD['sp_finance_pm_prep_bind'] || {}
          const tkD = (bindD.byUid || {})[userId]
          const meD = tkD ? ((bindD.tokens || {})[tkD] || {}).name : null
          const aprD = (((kvD['sp_finance_pm_sop_def'] || {}).ground || {}).approvers || ['張良瑋'])
          const rosD9 = await kvGetMany(['sp_crew_kb_roster'])
          const roleD = meD ? ((((rosD9['sp_crew_kb_roster'] || {}).people) || []).find(p9 => p9.name === meD) || {}).gdRole : ''
          if (!meD || !(aprD.includes(meD) || roleD === '主管')) { await send('入職文件上傳只開放主管使用 🙏'); continue }
          const rowsD = (kvD['sp_crew_pm_hr_master'] || {}).rows || []
          const psn = rowsD.filter(r9 => r9.name.includes(mDoc[1]) || mDoc[1].includes(r9.name))
          if (!psn.length) { await send(`夥伴名冊找不到「${mDoc[1]}」。`); continue }
          if (psn.length > 1) { await send(`有 ${psn.length} 個同名：${psn.map(x => x.name + '(' + (/A Beach/.test(x.co) ? 'AB' : 'GD') + ')').join('、')}——名字打完整一點。`); continue }
          const kw = mDoc[2]
          const keyD = Object.entries(HRD).find(([, as9]) => as9.some(a9 => kw.includes(a9) || a9.includes(kw)))
          if (!keyD) { await send('文件名我認得這些：勞動契約、身分證、存摺、體檢、衛生訓練、法代同意書。') ; continue }
          const pend = (await kvGetMany(['pm_hrdoc_pending']))['pm_hrdoc_pending'] || {}
          pend[userId] = { co: psn[0].co, name: psn[0].name, key: keyD[0], label: keyD[1][0], ts: Date.now(), by: meD }
          await kvSet('pm_hrdoc_pending', pend)
          await send(`📎 OK！接下來 15 分鐘內傳給我「${psn[0].name} 的 ${keyD[1][0]}」照片或檔案（可多張），我會直接歸到名冊對應欄位。`)
        } catch (e) { await send('設定上傳出了點問題，再試一次 🙏') }
        continue
      }
      // 1.36) 綁定防火牆（張良 2026-10-01：小夏問綁定→AI 自由發揮把 Toby 的專屬連結翻出來亂發）：
      // 私訊只要提到「綁定」但沒精準命中上面指令 → 固定短回覆，永遠不進 AI（個人連結絕不能由 AI 生成/轉傳）
      if (/綁定/.test(text)) { // 群組也擋（2026-10-01 張良在群裡講綁定，DD 自由發揮還發明錯誤教學）——固定說明、永不進 AI
        await send(isDM
          ? '回我「綁定GD 本名」（例：綁定GD張良瑋）就好，我會發你專屬連結，點一下完成綁定。已經綁過只是換瀏覽器？回我「我的連結」就好。'
          : '📌 綁定方法：本人私訊 DD 打「綁定GD 本名」（例：綁定GD張良瑋）→ 我會發專屬連結，點一下完成；核准後我會通知你。')
        continue
      }
      // 1.39) 🗂 通用文件庫（雲端硬碟）：先傳檔→「存到文件庫 <資料夾>」歸檔；私訊打「文件庫」列出可存資料夾；主管可「文件庫 把 <資料夾> <檔名> 傳到群/給我」撈檔
      {
        const _libPush = /(傳|發|送|撈)\s*(到|給|去)?\s*(群|這|我|私|自己)/.test(text)
        const _libSave = !_libPush && /(存|放|上傳|收|歸)/.test(text)
        if (/文件庫/.test(text) && (isDM || _libPush || _libSave)) {
          const who = await libWhoByLine(userId)
          if (!who) { await finish('先綁定才知道你是誰——私訊我「綁定GD 本名」，核准後就能用文件庫。'); continue }
          if (_libPush) { // 撈檔傳群/傳我（限主管＋受權限＋禁外傳夾擋）
            const toSelf = /給我|傳我|私訊|給自己|自己/.test(text)
            let seg = text.replace(/^(@\S+|dd|d哥)[\s,，:：]*/i, '').replace(/文件庫/g, ' ')
              .replace(/(傳|發|送|撈)\s*(到|給|去)?\s*(群(組|裡)?|這裡?|我|私訊|自己)\S*/g, ' ')
              .replace(/(把|將|幫我|請|一下|的檔案|檔案|文件|資料)/g, ' ').trim()
            const toks = seg.split(/[\s，,、]+|的|裡的?|中的?/).map(s => s.trim()).filter(Boolean)
            const out = await pushLibraryFile(toks[0] || '', toks.slice(1).join(''), who, toSelf ? userId : (isDM ? userId : convId))
            await finish(out.ok ? `✅ 已把「${out.folder}」的 ${out.count} 個檔案傳${toSelf || isDM ? '給你' : '到這個群'}：${out.names.join('、')}` : out.msg)
            continue
          }
          if (_libSave) { // 把剛傳的檔歸進資料夾（受權限）
            const fname = text.replace(/.*文件庫/, '')
              .replace(/類別|資料夾|夾|存到?|存進?|放到?|放進?|上傳到?|收到?|收進?|歸到?|歸檔|一下|把|剛剛的?|這些?|那些?|請|幫我|裡面|的|檔案|到/g, '')
              .replace(/[，,、。\s「」『』:：]/g, '').trim()
            const out = await saveCachedToLibrary(fname, who, convId)
            await finish(out.ok ? `✅ 已把 ${out.count} 個檔案存進文件庫「${out.folder}」${out.failed && out.failed.length ? `（${out.failed.length} 個抓不到）` : ''}。到 App 文件庫頁看得到。` : out.msg)
            continue
          }
          // 查詢（私訊）：列出看得到的資料夾＋用法
          const lib9 = (await kvGetMany([LIBRARY_KEY]))[LIBRARY_KEY] || { folders: [] }
          const vis = (lib9.folders || []).filter(f => libLevelOf(who, f) >= 1)
          await finish(vis.length
            ? `🗂 你看得到的文件庫資料夾：\n${vis.map(f => `・${f.name}（${libLevelOf(who, f) >= 2 ? '可存檔' : '只能看'}${(f.acl && f.acl.noExport) ? '・禁外傳' : ''}）`).join('\n')}\n\n存檔：先傳檔案給我，再說「存到文件庫 ${vis[0].name}」。${who.mgr ? '\n撈檔：「文件庫 把 ' + vis[0].name + ' 檔名 傳到群」（或傳給我）。' : ''}`
            : '目前沒有你看得到的文件庫資料夾，請主管在 App 文件庫開資料夾或給你權限。')
          continue
        }
      }
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
      // v2.5.9 群組也能確認（群組訊息要點名才進得來，先剝掉「DD／D哥」前綴再比對；
      // 群組只認「確認/執行」等明確字眼——隨口回別人「好」不能誤觸執行）
      if (canAct) {
        const pend = await getPending(userId)
        if (pend) {
          const bare = isDM ? text : text.replace(/^(@\S+|dd|d哥)[\s,，:：]*/i, '').trim()
          const isConfirm = isDM
            ? /^(請?(確認|確定|執行|送出)|好(的|啊)?|對|是|沒問題|ok|okay|yes|y|go)\s*$/i.test(bare)
            : /^請?(確認|確定|執行|送出)\s*$/i.test(bare)
          const isCancel = /^(取消|不要|不用|算了|放棄|no|n|cancel)\s*$/i.test(bare)
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

      // 2.5) 今日任務卡（固定指令、不經 AI、秒回）：隨時召喚今日任務簡報＋互動按鈕卡（張良 2026-09-08）
      if (isDM && canAct && /^(今日|今天)(的)?任務|^任務卡$/.test(text)) {
        const { loadOpenTasks, buildTaskRemind } = await import('./cron-daily.js')
        const open = await loadOpenTasks()
        const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
        const brief = buildTaskRemind(open, false, today)
        if (!brief) { await finish(`今天沒有到期或急件任務 🎉（未完成總共 ${open.length} 件，要看全部就問我「所有任務」）`); continue }
        const hot = open.filter(t => (t.due && t.due <= today) || t.priority === 'urgent')
        await finish(brief.replace(/^☀️ 早安！/, '📋 '), hot.length ? [buildTaskCards(hot, '今日任務（點按鈕直接處理）', today)] : undefined)
        continue
      }

      // 金額/財務權限：私訊(操作者)可看；群組只有「內部群(預設群) 或 設定 money:true」才可看金額，外部群一律擋
      let moneyOK = true
      if (!isDM) {
        const gcfg = asObj((await kvGetMany(['pm_bot_groups']))['pm_bot_groups'])
        moneyOK = (gid === 'Cf7940efc6517b0c084ad2ad496b45f30') || (gcfg[gid] && gcfg[gid].money === true)
      }
      // 3) 一般流程：載入資料＋對話記憶＋長期記事本 → 問 AI（操作者才開放下指令）
      const [snaps, accountsText, financeText, activityText, estimatesText, crewText, history, memList, conclusionsText, tasksText, sheetText, posText, catalogText, supplyText, lineQuotaText, filelibText, groupChatText] = await Promise.all([loadSnapshots(), loadAccounts(), loadFinanceText(), loadActivityText(), loadEstimatesText(), Promise.all([loadCrewText(), loadShiftText(), loadPunchText(), loadHrText(), moneyOK ? loadSalaryText() : Promise.resolve('')]).then(parts => parts.join('')), getChatHistory(convId), getMemory(), loadConclusionsText(), loadTasksText(), loadSheetText(), Promise.all([loadPosText(), loadBossText(), loadEmText()]).then(([a, b, c]) => a + b + c), loadCatalogText(), loadSupplyText(), loadLineQuotaText(), loadFilelibText(), loadGroupChatText().then(async g => g + await loadPushLogText(convId))])
      let rawReply = await answer(text, snaps, accountsText, financeText, activityText, estimatesText, crewText, canAct, history, memoryToText(memList), conclusionsText, tasksText, sheetText, posText, catalogText, supplyText, lineQuotaText, filelibText, groupChatText, moneyOK)
      // 🔎 資料代查迴圈（張良 2026-09-27 根除）：AI 輸出 query_pos_day → 系統查庫 → 資料回填再答一輪（唯讀自動執行,不經確認）
      // v4.38.1 假代查抓包（張良 2026-10-04「dd到底查不查得到」：DD 答應查九月婚禮包場說「稍等一下」卻沒輸出指令,使用者空等）：
      // 嘴上說要代查但沒帶 JSON → 系統退回去逼它只輸出指令（這輪不給使用者看）→ 查到再答
      try {
        const runQueries = async (txt) => {
          const qms = [...txt.matchAll(/\{[^{}]*"type"\s*:\s*"query_pos_day"[^{}]*\}/g)].slice(0, 2)
          const qrs = [...txt.matchAll(/\{[^{}]*"type"\s*:\s*"query_resv"[^{}]*\}/g)].slice(0, 2)
          const qhs = [...txt.matchAll(/\{[^{}]*"type"\s*:\s*"query_hr"[^{}]*\}/g)].slice(0, 2)
          const qfs = moneyOK ? [...txt.matchAll(/\{[^{}]*"type"\s*:\s*"query_fin"[^{}]*\}/g)].slice(0, 2) : []
          const qos = moneyOK ? [...txt.matchAll(/\{[^{}]*"type"\s*:\s*"query_orders"[^{}]*\}/g)].slice(0, 2) : [] // v4.70.40 叫貨單（成本資料，外部群擋）
          if (!qms.length && !qrs.length && !qhs.length && !qfs.length && !qos.length) return null
          let dataTxt = ''
          for (const m of qms) { try { const q = JSON.parse(m[0]); dataTxt += await queryPosDay(String(q.date || ''), String(q.store || 'ground')) + '\n\n' } catch (e) { dataTxt += '（查詢指令解析失敗）\n' } }
          for (const m of qrs) { try { const q = JSON.parse(m[0]); dataTxt += (moneyOK
            ? (q.top ? await queryResvTop(q.top) : q.name ? await queryResvName(q.name) : await queryResvDay(String(q.date || ''), String(q.to || ''), String(q.kw || '')))
            : ((q.name || q.top) ? '（這個群只能查「某天檔期狀況」，不提供客人姓名/電話/常客等個資查詢——要查客人資料請私訊張良）' : await queryResvPublic(String(q.date || ''), String(q.to || '')))) + '\n\n' } catch (e) { dataTxt += '（訂位查詢指令解析失敗）\n' } }
          for (const m of qhs) { try { const q = JSON.parse(m[0]); dataTxt += await queryHrMonth(q.month, q.date) + '\n\n' } catch (e) { dataTxt += '（人資查詢指令解析失敗）\n' } }
          for (const m of qfs) { try { const q = JSON.parse(m[0]); dataTxt += await queryFinMonth(q.month) + '\n\n' } catch (e) { dataTxt += '（財務查詢指令解析失敗）\n' } }
          for (const m of qos) { try { const q = JSON.parse(m[0]); dataTxt += await queryOrders(q.month, q.store, q.supplier, q.items) + '\n\n' } catch (e) { dataTxt += '（叫貨單查詢指令解析失敗）\n' } }
          // v4.38.3 保險絲（九月1182筆爆AI輸入翻車）：代查結果超長一律截斷,寧可請AI縮範圍也不能整則掛掉
          if (dataTxt.length > 60000) dataTxt = dataTxt.slice(0, 60000) + '\n…（代查結果過長已截斷：請縮小日期區間分段再查）'
          return dataTxt
        }
        let dataTxt = await runQueries(rawReply)
        if (dataTxt == null && canAct && /(代查|幫你查|幫你撈|撈回來|查回來|我查一下|我撈一下|再查|試撈|稍等|等我一下)/.test(rawReply)) {
          console.log('fake-query caught, forcing retry')
          const retry = await answer(text + '\n\n【系統抓包】你剛剛的回覆說要「代查／撈資料／稍等一下」，但沒有輸出任何 query_pos_day/query_resv JSON 指令——你沒有「稍後再傳」的能力，這一則沒帶指令＝永遠不會查。現在立刻輸出正確的查詢 JSON 指令（照指令格式,一行就好,不要解釋）。你剛剛的回覆是：\n' + rawReply.slice(0, 1500), snaps, accountsText, financeText, activityText, estimatesText, crewText, canAct, history, memoryToText(memList), conclusionsText, tasksText, sheetText, posText, catalogText, supplyText, lineQuotaText, filelibText, groupChatText, moneyOK)
          dataTxt = await runQueries(retry)
        }
        // v4.38.2 最多兩輪：第一輪答完若又輸出新查詢指令（「我再查一次👇」），真的再查一次，不再放使用者空等
        for (let hop = 0; dataTxt != null && hop < 2; hop++) {
          rawReply = await answer(text + '\n\n【系統代查結果（依你剛才的 query_pos_day/query_resv）——請直接據此回答使用者' + (hop ? ',這是最後一輪,絕對' : ',沒必要就') + '不要再輸出查詢指令,也不要說資料沒帶到】\n' + dataTxt, snaps, accountsText, financeText, activityText, estimatesText, crewText, canAct, history, memoryToText(memList), conclusionsText, tasksText, sheetText, posText, catalogText, supplyText, lineQuotaText, filelibText, groupChatText, moneyOK)
          dataTxt = hop < 1 ? await runQueries(rawReply) : null
        }
      } catch (e) { console.log('query tool err', e?.message) }
      // 抓出 D 想長期記住的事（[[記住:...]]）→ 存進記事本(僅操作者)，並把標記從給人看的文字拿掉
      const { facts, clean } = extractMemoryTags(rawReply)
      if (canAct && facts.length) { for (const f of facts) await addMemory(f, 'auto', op?.name) }
      const reply = clean || rawReply
      const actions = canAct ? parseActions(reply) : []
      console.log('answer', JSON.stringify({ snaps: snaps.length, canAct, hist: history.length, mem: memList.length, autoFacts: facts.length, actions: actions.length, replyLen: reply.length }))

      if (actions.length) {
        // 4) 操作分兩級（張良 2026-08-28）：
        //    純記錄類 → 直接執行不用確認（小事免卡關）；改資料/刪除/金額類 → 照舊先確認。
        //    AI 的 prose 一律保留（裡面有對其他問題的回答，以前整段被丟掉＝答非所問的元兇）。
        const AUTO_TYPES = new Set(['add_log', 'add_task', 'add_todo', 'add_conclusion'])
        const autoActs = actions.filter(a => AUTO_TYPES.has(a.type))
        const confirmActs = actions.filter(a => !AUTO_TYPES.has(a.type))
        const parts = []
        const prose = stripJson(reply)
        if (prose) parts.push(prose)
        let createdTasks = []
        if (autoActs.length) {
          // 直接執行也要誠實回報：失敗不能默默吞掉讓使用者以為記好了
          try {
            const results = await executeActions(autoActs, op.name)
            createdTasks = results.created || []
            parts.push('✅ 已直接記好：\n' + results.join('\n'))
          } catch (e) {
            console.log('auto-exec error', e?.message)
            parts.push('⚠️ 記錄時出錯沒有存成功（' + (e?.message || '未知錯誤') + '），請再說一次或稍後重試。')
          }
        }
        // 剛記好的任務附「快速設定卡」：📅截止日/🏷分類/👤負責人/🔥超急 直接按（張良 2026-09-08）
        // v2.5.9：卡片按鈕(postback)只在私訊有接，群組不發卡（發了按不動＝假按鈕），改文字提示
        const todayTPE = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
        const setupCards = (isDM && createdTasks.length) ? [buildTaskSetupCards(createdTasks, todayTPE)] : []
        if (!isDM && createdTasks.length) parts.push('（要設截止日/負責人/超急：在 App 任務中心點開，或私訊我改）')
        // 對話記憶存「原始回覆(含 json 指令)＋系統結果」：讓 DD 的歷史示範永遠是「要做事就夾 json」
        const histOf = () => reply + '\n\n' + parts.filter(p => p !== prose).join('\n\n')
        if (confirmActs.length) {
          await setPending(userId, { actions: confirmActs, ts: new Date().toISOString() })
          const list = confirmActs.map((a, i) => `${i + 1}. ${describeAction(a)}`).join('\n')
          parts.push(`🛠 這些要等你確認才會做：\n${list}${isDM ? '' : '\n（群組裡回「DD 確認」執行、「DD 取消」放棄）'}`)
          // 附確認按鈕卡（打字「確認/取消」也照樣有效）；群組按鈕按不動→只給文字指引
          await finish(parts.join('\n\n'), isDM ? [buildConfirmCard(`共 ${confirmActs.length} 個操作，內容如上`), ...setupCards] : undefined, histOf())
          continue
        }
        await finish(parts.join('\n\n'), setupCards.length ? setupCards : undefined, histOf())
      } else {
        // 0 個動作 → 抓包＋消毒：AI 仿冒「✅ 已直接記好」直接改標成假清單；嘴上說記好就加警語
        // v2.5.9：唯讀對話（非操作者/外人）也要消毒＋抓包——2026-09-16 群組假完成就是從這個豁免漏掉的
        const out = sanitizeFakeDone(reply) + falseDoneWarning(reply, 0, !canAct)
        await finish(out)
      }
    } catch (e) { console.log('event error', e?.message); ddHealthLog({ kind: 'error', err: String(e?.message || '').slice(0, 160), ms: Date.now() - tEv, type: ev.type, ai: _aiAgg && _aiAgg.calls ? _aiAgg : null }).catch(() => {}) }
  }
  return res.status(200).json({ ok: true })
}
