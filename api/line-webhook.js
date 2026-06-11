// 後端：LINE Webhook（D哥）。收群組訊息 → 登記群、回答問題（以 pm_bot_context 唯一真相快照為依據）。
// 需要環境變數：LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN（新）；ANTHROPIC_API_KEY、SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY（本專案已有）。
// LINE 後台 Webhook URL 設成： https://<本專案網域>/api/line-webhook
import crypto from 'crypto'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SECRET = clean(process.env.LINE_CHANNEL_SECRET)
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const ANTHROPIC = clean(process.env.ANTHROPIC_API_KEY)
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()

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
function snapshotsToContext(snaps) {
  if (!snaps.length) return '（目前沒有資料快照。）'
  return snaps.map((s) => {
    const t = s.totals || {}
    const lines = [
      `【空間：${s.project?.name || s.space}】更新於 ${s.updatedAt || ''}`,
      `預估總額 NT$${Math.round(t.est || 0).toLocaleString()}、已付 NT$${Math.round(t.paid || 0).toLocaleString()}、未付 NT$${Math.round(t.unpaid || 0).toLocaleString()}`,
      s.progress ? `進度 ${s.progress.pct}%（細項 ${s.progress.doneItems}/${s.progress.totalItems}）` : '',
      s.project?.daysLeft != null ? `距完工 ${s.project.daysLeft} 天（目標 ${s.project.targetDate}）` : '',
      s.petty ? `零用金：撥款 NT$${Math.round(s.petty.advances).toLocaleString()}、花費 NT$${Math.round(s.petty.spends).toLocaleString()}、餘額 NT$${Math.round(s.petty.balance).toLocaleString()}` : '',
      (s.cats || []).length ? '各大項：\n' + s.cats.map((c) => `  - ${c.name}（${c.status}）預估 ${Math.round(c.est).toLocaleString()}／已付 ${Math.round(c.paid).toLocaleString()}／未付 ${Math.round(c.unpaid).toLocaleString()}`).join('\n') : '',
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

async function answer(question, snaps, accountsText) {
  if (!ANTHROPIC) return '（D哥的 AI 金鑰尚未設定。）'
  const system = '你是「D哥」，喬亞國際餐飲工程專案的 LINE 助理。\n規則：①只根據下方「目前資料」回答，數字直接引用、不要自己亂算。②如果使用者問的東西資料裡沒有（例如現場尺寸、深度、材質、施工細節、與本專案無關的閒聊），就**直接簡短說「這個我沒有資料」**，不要改用進度或其他數字硬湊答案。③答案要對準問題，問什麼答什麼，不要不相關地報整體進度。④用繁體中文、簡短口語、必要時條列。\n\n【目前資料】\n' + snapshotsToContext(snaps) + (accountsText || '')
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens: 1024, system, messages: [{ role: 'user', content: question }] }),
    })
    const d = await r.json()
    if (r.ok) return (d.content || []).map((b) => b.text || '').join('').trim() || '（沒有內容）'
    return '（AI 回應失敗）'
  } catch (_) { return '（AI 連線失敗）' }
}

const TRIGGERS = ['d哥', 'D哥', '進度', '多少', '還欠', '未付', '已付', '付款', '總額', '預算', '餘額', '報告', '速報', '幾天', '完工', '零用金']
const triggered = (text) => /[?？]\s*$/.test(text) || TRIGGERS.some((k) => text.includes(k))

export default async function handler(req, res) {
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
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue
      const gid = ev.source?.groupId || ev.source?.roomId || ev.source?.userId
      await registerGroup(gid, ev.source?.type)
      const text = (ev.message.text || '').trim()
      const isDM = ev.source?.type === 'user' // 一對一私訊
      const mentionedSelf = (ev.message?.mention?.mentionees || []).some((m) => m.isSelf)
      const named = mentionedSelf || /d哥|＠d|@d/i.test(text) // 群組只在「被@ 或叫到 D哥」時才回，避免插嘴別人對話
      console.log('event', JSON.stringify({ src: ev.source?.type, isDM, named, text: text.slice(0, 40) }))
      if (!isDM && !named) continue // 私訊一律回；群組必須被點名
      const snaps = await loadSnapshots()
      const reply = await answer(text, snaps)
      console.log('answer', JSON.stringify({ snaps: snaps.length, replyLen: reply.length }))
      if (ev.replyToken) await lineReply(ev.replyToken, reply)
    } catch (e) { console.log('event error', e?.message) }
  }
  return res.status(200).json({ ok: true })
}
