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

// 財務內帳（多帳戶 + 交易 + 科目）→ 文字
async function loadFinanceText() {
  try {
    const fin = await kvGetMany(['sp_finance_pm_fin_accounts', 'sp_finance_pm_fin_ledger', 'sp_finance_pm_fin_coa'])
    const accs = fin['sp_finance_pm_fin_accounts'] || [], led = fin['sp_finance_pm_fin_ledger'] || [], coa = fin['sp_finance_pm_fin_coa'] || []
    if (!accs.length && !led.length) return ''
    const n = (v) => Number(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0
    const bal = (id) => { let b = n((accs.find(a => a.id === id) || {}).opening); led.forEach(l => { if (l.to === id) b += n(l.amount); if (l.from === id) b -= n(l.amount); }); return b }
    const lines = ['\n\n【財務內帳（多帳戶總表）】']
    if (accs.length) { lines.push('各帳戶餘額：'); accs.forEach(a => lines.push(`  - ${a.name || '未命名'} 餘額 NT$${Math.round(bal(a.id)).toLocaleString()}`)) }
    const inc = led.filter(l => l.kind === 'income').reduce((s, l) => s + n(l.amount), 0)
    const exp = led.filter(l => l.kind === 'expense').reduce((s, l) => s + n(l.amount), 0)
    lines.push(`交易共 ${led.length} 筆，累計收入 NT$${Math.round(inc).toLocaleString()}、支出 NT$${Math.round(exp).toLocaleString()}`)
    const recent = [...led].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15)
    if (recent.length) { lines.push('最近交易：'); recent.forEach(l => lines.push(`  - ${l.date || ''} ${l.kind === 'income' ? '收入' : l.kind === 'transfer' ? '轉帳' : '支出'} ${Math.round(n(l.amount)).toLocaleString()} ${[l.category, l.vendor, l.note].filter(Boolean).join('・')}`)) }
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
    const lines = ['\n\n【操作紀錄（誰做了什麼，新到舊）】']
    all.slice(0, 40).forEach(e => lines.push(`  - ${fmtT(e.ts)} ${e.user || '—'}（${e.space}）${e.action || ''}：${e.detail || ''}`))
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

// 夥伴中心（團隊）資料：360 互評 / 意見回饋 / 闖關積分 / 獎勵商店 / 知識庫 / 投票。
// 這些是半結構化資料，直接餵精簡 JSON 讓 D哥自己解讀，確保「答得出來」。
async function loadCrewText() {
  try {
    const bases = ['kb_360', 'kb_feedback', 'kb_quests', 'kb_shop', 'kb_docs', 'kb_polls']
    const keys = []
    for (const p of ['sp_crew_', 'sp_team_']) for (const b of bases) keys.push(p + b)
    const map = await kvGetMany(keys)
    const label = { kb_360: '360 互評', kb_feedback: '意見回饋', kb_quests: '闖關任務/積分', kb_shop: '獎勵商店', kb_docs: '知識庫文件', kb_polls: '投票' }
    const present = Object.entries(map).filter(([, v]) => v && (Array.isArray(v) ? v.length : Object.keys(v).length))
    if (!present.length) return ''
    const lines = ['\n\n【夥伴中心（團隊）資料】']
    present.forEach(([k, v]) => { const base = k.replace(/^sp_(crew|team)_/, ''); let j = JSON.stringify(v); if (j.length > 1400) j = j.slice(0, 1400) + '…(略)'; lines.push(`▍${label[base] || base}：${j}`) })
    return lines.join('\n')
  } catch (_) { return '' }
}

async function answer(question, snaps, accountsText, financeText, activityText, estimatesText, crewText) {
  if (!ANTHROPIC) return '（D哥的 AI 金鑰尚未設定。）'
  const system = '你是「D哥」，喬亞國際餐飲的 LINE 全能助理，掌握 App 內幾乎所有資料：工程專案（預算/付款/進度/工序日誌/零用金/ToDo/有問題項目）、財務內帳（多帳戶/交易/餘額/科目）、比價估價單、App 帳號清單、操作與登入紀錄（誰做了什麼、誰最近登入）、夥伴中心（360互評/意見回饋/闖關積分/獎勵商店/知識庫）。\n規則：①只根據下方「目前資料」回答，數字直接引用、不要亂算。②下方資料涵蓋 App 內絕大多數資訊——**優先從裡面找答案，能答就答清楚完整**。③**只有「App 完全沒有的東西」**（例如現場實際尺寸/深度/材質、與公司無關的閒聊）才說「這個我沒有資料」；不要把 App 裡明明有的（帳號、財務、進度、登入/操作紀錄、比價、夥伴中心…）也說沒有。④答案對準問題，用繁體中文、簡短口語、必要時條列。\n\n【目前資料】\n' + snapshotsToContext(snaps) + (accountsText || '') + (financeText || '') + (activityText || '') + (estimatesText || '') + (crewText || '')
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
      // 只在「真的被 @到本帳號」(排除 @All/@他人) 或「明確叫到 D哥」時才回。
      // 移除舊的 /@d/：它會誤中別人的 @Doris、@David… 導致 D 插嘴。
      const mentionees = ev.message?.mention?.mentionees || []
      const mentionedSelf = mentionees.some((m) => m.isSelf === true && m.type !== 'all')
      const named = mentionedSelf || /d哥/i.test(text)
      console.log('event', JSON.stringify({ src: ev.source?.type, isDM, named, mSelf: mentionedSelf, text: text.slice(0, 40) }))
      if (!isDM && !named) continue // 私訊一律回；群組必須被點名（@本帳號 或 講「D哥」）
      const [snaps, accountsText, financeText, activityText, estimatesText, crewText] = await Promise.all([loadSnapshots(), loadAccounts(), loadFinanceText(), loadActivityText(), loadEstimatesText(), loadCrewText()])
      const reply = await answer(text, snaps, accountsText, financeText, activityText, estimatesText, crewText)
      console.log('answer', JSON.stringify({ snaps: snaps.length, replyLen: reply.length }))
      if (ev.replyToken) await lineReply(ev.replyToken, reply)
    } catch (e) { console.log('event error', e?.message) }
  }
  return res.status(200).json({ ok: true })
}
