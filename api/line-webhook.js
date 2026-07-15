// 後端：LINE Webhook（D哥）。收群組訊息 → 登記群、回答問題（以 pm_bot_context 唯一真相快照為依據）。
// 需要環境變數：LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN（新）；ANTHROPIC_API_KEY、SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY（本專案已有）。
// LINE 後台 Webhook URL 設成： https://<本專案網域>/api/line-webhook
import crypto from 'crypto'
// Task Object v2：與前端共用同一份資料模型（保證 Bot / Front-end 的 Task shape 一致）
import { normalizePatch, mergeTask, isWaiting, isBlocked } from '../src/tasks/taskModel.js'

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
    const bases = ['kb_360', 'kb_feedback', 'kb_quests', 'kb_shop', 'kb_docs', 'kb_polls']
    const keys = []
    for (const p of ['sp_crew_', 'sp_team_']) for (const b of bases) keys.push(p + b)
    const map = await kvGetMany(keys)
    const pick = (b) => map['sp_crew_' + b] || map['sp_team_' + b] || null
    const out = ['\n\n【夥伴中心（團隊）資料】']
    let any = false
    const r360 = pick('kb_360')
    const nameOf = {}
    if (r360 && Array.isArray(r360.people)) r360.people.forEach(p => { nameOf[p.id] = p.name })

    // 360 互評：每個被評者的「整體平均 + 各構面平均 + 份數」（全員、不截斷）
    if (r360 && Array.isArray(r360.people)) {
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
      const noRev = r360.people.filter(p => !reviewed.has(p.id)).map(p => p.name)
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

    return any ? out.join('\n') : ''
  } catch (_) { return '' }
}

const BOT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8' // 最高級；失敗自動退回 Sonnet
const BOT_PERSONA = `你是「D哥」，喬亞國際餐飲團隊的 LINE 小幫手。你手上有公司管理 App 的即時資料（附在下面）。

講話風格：像個可靠、反應快、講話自然的同事——親切、直接、不囉嗦。用正常口語跟適度的表情符號，不要像念公文或一條條規則。該一句話講完就一句話，需要才條列。**不要每次都自我介紹**（你們是熟人了，接著聊就好，除非對方第一次跟你說話或問你是誰）。

做事原則：
- 用下面的資料講真話，數字直接引用、絕不自己亂編。
- 資料裡真的沒有的，就老實說「這個我手上沒有資料」，但別把明明有的（工程進度、財務、帳號、登入/操作紀錄、比價、夥伴中心…）說成沒有。
- **如果你判斷自己做不到、或資料不足、或對方的要求不在你能力範圍**：直接、清楚地說「我做不到 X，原因是 Y，你可以這樣做 Z」。不要裝懂、不要答非所問、不要假裝完成。
- 記得上面的對話脈絡，順著聊，不要把每句話都當第一次見面。
- 如果對話中出現「值得長期記住」的重要事實（某人負責什麼、聯絡方式、分工窗口、老闆的偏好或固定要求、專案的重要約定…），在你回覆的「最後」另起一行用這個格式標記：[[記住:該事實]]（可多行、每行一件、寫簡短）。只標真正值得長期記的，瑣事不要標。這個標記使用者看不到，是給系統存進你的長期記事本用的。`
const SYS_DATA_HEAD = '\n\n────────\n【你目前掌握的即時資料】\n'

// 任務中心（pm_tasks，Task v2 全欄位）→ 文字。D哥 讀任務一律以這份為準（完整、含衍生狀態）
async function loadTasksText() {
  try {
    const m = await kvGetMany(['pm_tasks', 'pm_data'])
    const tasks = Array.isArray(m['pm_tasks']) ? m['pm_tasks'] : []
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
    const kv = await kvGetMany(['sp_finance_pm_bank', 'sp_finance_pm_sheet'])
    const bk = kv['sp_finance_pm_bank']
    const v = (bk && Array.isArray(bk.entries) && bk.entries.length) ? { rows: bk.entries, syncedAt: bk.updatedAt } : kv['sp_finance_pm_sheet']
    const rows = v && Array.isArray(v.rows) ? v.rows : []
    if (!rows.length) return ''
    const lines = [`\n\n【銀行帳務資料庫（合作金庫·喬亞帳戶，每一筆銀行進出，共 ${rows.length} 筆，更新 ${v.syncedAt ? new Date(v.syncedAt).toLocaleString('zh-TW') : ''}）】`]
    rows.slice(-100).forEach(r => lines.push(`  - ${r.payDate || r.notifyDate || ''} [${r.cat}${r.subject ? '/' + r.subject : ''}] ${r.content}｜NT$${Math.round(r.amount).toLocaleString()}${r.payee ? '→' + r.payee : ''}${r.batch ? '（' + r.batch + '）' : ''}`))
    return lines.join('\n')
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

async function answer(question, snaps, accountsText, financeText, activityText, estimatesText, crewText, canAct, history, memoryText, conclusionsText, tasksText, sheetText) {
  if (!ANTHROPIC) return '（D哥的 AI 金鑰尚未設定。）'
  const system = (canAct ? BOT_AGENT_GUIDE + '\n\n' : '') + BOT_PERSONA + (memoryText || '') + SYS_DATA_HEAD + snapshotsToContext(snaps) + (tasksText || '') + (accountsText || '') + (financeText || '') + (activityText || '') + (estimatesText || '') + (crewText || '') + (conclusionsText || '') + (sheetText || '')
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
    if (!ok) { console.log('primary model failed, fallback to sonnet', d?.error?.message); ({ ok, d } = await callModel('claude-sonnet-4-5')) } // 主模型不可用就退回，D哥不會啞掉
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
  const ck = await kvGetMany(['pm_data', 'pm_worklog', 'pm_petty', 'pm_issues', 'pm_tasks', 'pm_conclusions', 'sp_finance_pm_fin_ledger', 'sp_finance_pm_fin_accounts'])
  let cats = Array.isArray(ck['pm_data']) ? ck['pm_data'] : []
  let worklog = Array.isArray(ck['pm_worklog']) ? ck['pm_worklog'] : []
  const pj = ck['pm_petty'] || {}; let petty = { advances: pj.advances || [], spends: pj.spends || [] }
  let issues = Array.isArray(ck['pm_issues']) ? ck['pm_issues'] : []
  let tasks = Array.isArray(ck['pm_tasks']) ? ck['pm_tasks'] : []
  let conclusions = Array.isArray(ck['pm_conclusions']) ? ck['pm_conclusions'] : []
  let ledger = Array.isArray(ck['sp_finance_pm_fin_ledger']) ? ck['sp_finance_pm_fin_ledger'] : []
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
  const saveMap = { pm_data: cats, pm_worklog: worklog, pm_petty: petty, pm_issues: issues, pm_tasks: tasks, pm_conclusions: conclusions, sp_finance_pm_fin_ledger: ledger }
  for (const k of changed) if (saveMap[k] !== undefined) await kvSet(k, saveMap[k])
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
      // 只登記「群組/聊天室」到群組頁；私訊(user)不是群，登記進去會在群組頁出現「未命名群」
      if (ev.source?.type !== 'user') await registerGroup(gid, ev.source?.type)
      const text = (ev.message.text || '').trim()
      const isDM = ev.source?.type === 'user' // 一對一私訊
      // 只在「真的被 @到本帳號」(排除 @All/@他人) 或「明確叫到 D哥」時才回。
      // 移除舊的 /@d/：它會誤中別人的 @Doris、@David… 導致 D 插嘴。
      const mentionees = ev.message?.mention?.mentionees || []
      const mentionedSelf = mentionees.some((m) => m.isSelf === true && m.type !== 'all')
      const named = mentionedSelf || /d哥/i.test(text)
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

      // 3) 一般流程：載入資料＋對話記憶＋長期記事本 → 問 AI（操作者才開放下指令）
      const [snaps, accountsText, financeText, activityText, estimatesText, crewText, history, memList, conclusionsText, tasksText, sheetText] = await Promise.all([loadSnapshots(), loadAccounts(), loadFinanceText(), loadActivityText(), loadEstimatesText(), loadCrewText(), getChatHistory(convId), getMemory(), loadConclusionsText(), loadTasksText(), loadSheetText()])
      const rawReply = await answer(text, snaps, accountsText, financeText, activityText, estimatesText, crewText, canAct, history, memoryToText(memList), conclusionsText, tasksText, sheetText)
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
