// 後端：每日工地速報（由 Vercel Cron 觸發，見 vercel.json）。
// 讀 pm_bot_context 快照 → 組速報 → 推到工地群。沒設 LINE token 前＝安全 no-op。
import { buildTaskCards } from './_ddcards.js' // 任務提醒的互動按鈕卡（完成/延1天/改日期/取消）
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const GROUP = clean(process.env.LINE_DEFAULT_GROUP) || 'Cf7940efc6517b0c084ad2ad496b45f30'
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()

async function kvGet(id) {
  if (!SB_URL || !SB_KEY) return null
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows = r.ok ? await r.json() : []
    if (rows[0]?.data?.v) return JSON.parse(rows[0].data.v)
  } catch (_) {}
  return null
}
const loadSnapshot = () => kvGet('pm_bot_context')

// ── 每日任務提醒（張良 2026-09-08：用 LINE 打字記任務 → DD 每天主動提醒）──
// 早上 8:00（cron 0 0 UTC）：私訊老闆「今日任務簡報」（逾期/今天/急件/三天內）
// 傍晚 17:30（cron 30 9 UTC）：今天到期/逾期的還沒完成 → 再追一次（時間不同、不固定感）
const BOSS = clean(process.env.LINE_BOSS_USER) || 'Uf7ce4fb9191cd3055247204e0cb6b4fc'
const tpeToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

// 逐筆任務檔 LIKE 前綴（底線要跳脫——踩過的坑）
async function listPrefix(prefix) {
  if (!SB_URL || !SB_KEY) return []
  try {
    const esc = prefix.replace(/_/g, '\\_')
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(esc + '%')}&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
    const rows = r.ok ? await r.json() : []
    return rows.map(x => { try { return JSON.parse(x.data.v) } catch (_) { return null } }).filter(Boolean)
  } catch (_) { return [] }
}
// 四個空間的未完成任務（與 DD 讀的同一套資料——資料一致鐵則）
async function loadOpenTasks() {
  const spaces = [['工程', 'pm_task_'], ['團隊', 'sp_team_pm_task_'], ['夥伴', 'sp_crew_pm_task_'], ['財務', 'sp_finance_pm_task_']]
  const out = []
  for (const [sp, pfx] of spaces) (await listPrefix(pfx)).forEach(t => { if (t && t.title && t.status !== 'done') out.push({ ...t, sp }) })
  // 舊版整包 pm_tasks 備援（尚未migrate到逐筆檔時）
  if (!out.some(t => t.sp === '工程')) { const legacy = await kvGet('pm_tasks'); if (Array.isArray(legacy)) legacy.forEach(t => { if (t && t.title && t.status !== 'done') out.push({ ...t, sp: '工程' }) }) }
  return out
}
const tline = (t) => `・${t.title}（${t.sp}${t.owner ? '·' + t.owner : ''}）${t.due ? '｜截止' + t.due.slice(5).replace('-', '/') : ''}`
export function buildTaskRemind(tasks, evening, today) {
  const soon = new Date(new Date(today + 'T00:00:00Z').getTime() + 3 * 86400e3).toISOString().slice(0, 10)
  const overdue = tasks.filter(t => t.due && t.due < today)
  const dueToday = tasks.filter(t => t.due === today)
  const urgent = tasks.filter(t => t.priority === 'urgent' && !(t.due && t.due <= today))
  const dueSoon = tasks.filter(t => t.due && t.due > today && t.due <= soon)
  if (evening) {
    if (!overdue.length && !dueToday.length) return null // 都處理完了就不吵
    const L = ['🌆 傍晚追一下，這些還沒結：']
    if (dueToday.length) { L.push('⏰ 今天到期未完成：'); dueToday.slice(0, 10).forEach(t => L.push(tline(t))) }
    if (overdue.length) { L.push('🔴 已逾期：'); overdue.slice(0, 10).forEach(t => L.push(tline(t))) }
    L.push('做完的跟我說一聲「XX完成」我就銷掉；要延的說「XX延到幾號」。')
    return L.join('\n')
  }
  if (!overdue.length && !dueToday.length && !urgent.length && !dueSoon.length) return null
  const L = [`☀️ 早安！${today.slice(5).replace('-', '/')} 任務簡報`]
  if (overdue.length) { L.push(`🔴 逾期（${overdue.length}）：`); overdue.slice(0, 10).forEach(t => L.push(tline(t))) }
  if (dueToday.length) { L.push(`⏰ 今天到期（${dueToday.length}）：`); dueToday.slice(0, 10).forEach(t => L.push(tline(t))) }
  if (urgent.length) { L.push(`🔥 標了超急（${urgent.length}）：`); urgent.slice(0, 8).forEach(t => L.push(tline(t))) }
  if (dueSoon.length) { L.push(`🟠 三天內到期（${dueSoon.length}）：`); dueSoon.slice(0, 8).forEach(t => L.push(tline(t))) }
  L.push('建議先清 🔴 再做 ⏰。回我「XX完成」直接銷任務 👌')
  return L.join('\n')
}
// 下週規劃（張良 2026-09-08「都做」）：每週日傍晚取代晚班追蹤，把下週 7 天任務按日排好送過來
export function buildWeeklyPlan(tasks, today) {
  const day = (o) => new Date(new Date(today + 'T00:00:00Z').getTime() + o * 86400e3).toISOString().slice(0, 10)
  const end = day(7)
  const wd = (d) => '日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()]
  const md = (d) => d.slice(5).replace('-', '/')
  const overdue = tasks.filter(t => t.due && t.due <= today) // 逾期＋今天沒結的
  const week = tasks.filter(t => t.due && t.due > today && t.due <= end)
  const urgent = tasks.filter(t => t.priority === 'urgent' && !(t.due && t.due <= end))
  const noDue = tasks.filter(t => !t.due && t.priority !== 'urgent')
  if (!overdue.length && !week.length && !urgent.length) return null
  const L = [`🗓 下週任務規劃（${md(day(1))}〜${md(end)}）`]
  if (overdue.length) { L.push(`🔴 先清舊帳（${overdue.length} 件逾期/今天未結）：`); overdue.slice(0, 8).forEach(t => L.push(tline(t))) }
  const byDay = {}
  week.forEach(t => { (byDay[t.due] = byDay[t.due] || []).push(t) })
  Object.keys(byDay).sort().forEach(d => { L.push(`▫️ ${md(d)}（${wd(d)}）：`); byDay[d].slice(0, 6).forEach(t => L.push(`  ・${t.title}（${t.sp}${t.owner ? '·' + t.owner : ''}）`)) })
  if (urgent.length) { L.push(`🔥 沒排日期但標超急（${urgent.length}）：`); urgent.slice(0, 6).forEach(t => L.push(tline(t))) }
  if (noDue.length) L.push(`💤 另有 ${noDue.length} 件沒設截止日（想排進來就跟我說「XX排到幾號」）`)
  L.push('建議：週初先清 🔴 和 🔥，其餘照日期走。要調整直接按卡片按鈕或跟我說 👌')
  return L.join('\n')
}

// 團隊群每人今日工作（張良要的「未來功能」：預設關、settings.lineNotify.teamTasks===true 才發）
export function buildTeamRemind(tasks, today) {
  const hot = tasks.filter(t => (t.due && t.due <= today) || t.priority === 'urgent')
  const byOwner = {}
  hot.forEach(t => { const o = t.owner || '（未指派）'; (byOwner[o] = byOwner[o] || []).push(t) })
  const names = Object.keys(byOwner)
  if (!names.length) return null
  const L = [`📋 今日工作安排 ${today.slice(5).replace('-', '/')}`]
  names.forEach(o => { L.push(`👤 ${o}`); byOwner[o].slice(0, 6).forEach(t => L.push(`  ・${t.title}${t.due && t.due < today ? '（逾期）' : ''}`)) })
  L.push('完成跟 DD 說一聲就好 💪')
  return L.join('\n')
}

const nt = (n) => 'NT$' + Math.round(n || 0).toLocaleString()

function buildReport(s) {
  if (!s) return null
  const p = s.project || {}, t = s.totals || {}, pr = s.progress || {}
  const lines = [
    `🏗 工地速報 ${new Date().toLocaleDateString('zh-TW')}`,
    p.name || '',
    `進度 ${pr.pct || 0}%（細項 ${pr.doneItems || 0}/${pr.totalItems || 0}）` + (p.daysLeft != null ? `・距完工 ${p.daysLeft} 天` : ''),
    `預估 ${nt(t.est)}｜已付 ${nt(t.paid)}｜未付 ${nt(t.unpaid)}`,
    s.petty ? `零用金餘額 ${nt(s.petty.balance)}` : '',
    (s.issues || []).length ? `⚠️ 有問題：${s.issues.slice(0, 8).join('、')}` : '✅ 無待處理問題',
  ].filter(Boolean)
  return lines.join('\n')
}

export default async function handler(req, res) {
  // 可選：用 CRON_SECRET 防止外部亂打
  const secret = clean(process.env.CRON_SECRET)
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) return res.status(401).json({ ok: false })
  // 一次性補建（已於 2026-09-12 使用完畢；防重複所以留著也無害，佔位待清）
  if (false && req.query?.seed === 'pizza12') {
    const kvSet = async (id, obj) => { const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: 'claude-seed', updated_at: new Date().toISOString() }) }); return r.ok }
    const title = '12吋披薩圓盒', url = 'https://www.bagasseproduct.com/'
    const existing = await listPrefix('sp_team_pm_task_')
    if (existing.some(t => t && t.title === title)) return res.status(200).json({ ok: true, skipped: '已存在，不重建' })
    const catsRaw = await kvGet('sp_team_pm_data')
    const cats = Array.isArray(catsRaw) ? catsRaw : []
    const cat = cats.find(c => c.name === '採購-包材') || cats.find(c => /採購/.test(c.name || ''))
    const id = 't-seed' + Date.now().toString(36)
    const now = new Date().toISOString()
    const okw = await kvSet('sp_team_pm_task_' + id, { id, title, note: url, status: 'todo', catId: cat ? cat.id : '__inbox__', start: '', due: '', priority: 'normal', tags: ['包材'], ord: Math.min(0, ...existing.map(t => t?.ord ?? 0)) - 1, createdAt: now, updatedAt: now })
    try { const cur = await kvGet('sp_team_pm_activity'); const arr = Array.isArray(cur) ? cur : []; await kvSet('sp_team_pm_activity', [{ ts: now, user: 'Claude(補建)', action: '新增', detail: `補建任務「${title}」（DD 假完成翻車補救，備註放連結）` }, ...arr].slice(0, 200)) } catch (_) {}
    return res.status(200).json({ ok: okw, cat: cat?.name || '收件匣', id })
  }
  // 同一支 cron 跑三班：台北 8 點=早班（同步＋速報＋任務簡報）、9:30=備料班（發 GROUN:D Family 群）、中午後=晚班（只追未完成任務）
  const tpeHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }).format(new Date()))
  const evening = req.query?.mode === 'evening' || (req.query?.mode !== 'morning' && req.query?.mode !== 'prep' && tpeHour >= 12)
  // ── 每日 09:30 備料訊息（張良 2026-09-21：DD 在 GROUN:D Family 群發「今天各站備多少」）──
  // cron 30 1 * * *（台北 09:30）；手動試發：?mode=prep&force=<MENU_PROBE_KEY>[&wd=1..5]
  if (req.query?.mode === 'prep' || (!req.query?.mode && !req.query?.dry && tpeHour === 9)) {
    const mk = (process.env.MENU_PROBE_KEY || '').trim()
    const forced = mk && String(req.query?.force || '') === mk
    if (!forced && tpeHour !== 9) return res.status(200).json({ ok: false, skipped: '非 09:30 時段（試發要帶 force 金鑰）' })
    const tpd = new Date(Date.now() + 8 * 3600e3)
    let wd = Number(req.query?.wd); if (!(wd >= 1 && wd <= 5)) wd = tpd.getUTCDay()
    if (wd === 0 || wd === 6) return res.status(200).json({ ok: true, skipped: '週末公休不發備料' })
    if (!TOKEN) return res.status(200).json({ ok: false, skipped: '未設 LINE token' })
    const st = (await kvGet('pm_settings')) || {}
    if ((st.lineNotify || {}).prepRemind === false) return res.status(200).json({ ok: true, skipped: '備料訊息已關（prepRemind=false）' })
    // 備料數字直接吃 /prep 看板同一個資料口（資料一致鐵則：不另算一套）
    const okey = clean(process.env.OPS_BOARD_KEY) || '7ea362bae1f0274372d4ec7b27c78852'
    const rr = await fetch('https://ground-pm.vercel.app/api/mail-sync?opsboard=' + encodeURIComponent(okey) + '&store=ground')
    const dd = await rr.json().catch(() => null)
    if (!dd || !dd.ok || !Array.isArray(dd.prep)) return res.status(200).json({ ok: false, error: '拿不到備料資料' })
    const L = [`🍳 早安！今天（週${'日一二三四五六'[wd]}）備料建議 👇`]
    let g0 = ''
    for (const p of dd.prep) {
      if (p.grp !== g0) { g0 = p.grp; L.push(`▍${g0}`) }
      const v = Array.isArray(p.byWd) && p.byWd[wd - 1] != null ? p.byWd[wd - 1] : p.avg
      if (v == null) continue
      L.push(`${p.sub ? '　└ ' : '・'}${p.name}：${v}${p.avg != null && v !== p.avg ? `（總平均 ${p.avg}）` : ''}${p.peak != null ? `｜峰值 ${p.peak}` : ''}`)
    }
    L.push('')
    L.push(`數字＝週${'日一二三四五六'[wd]}近幾週平均（已進位往上抓）；訂位多、活動日往「峰值」抓。詳細：ground-pm.vercel.app/prep`)
    // 目標群：env LINE_PREP_GROUP 優先，否則從群組登記表找名字含 Family 的群
    let tgt = clean(process.env.LINE_PREP_GROUP)
    if (!tgt) { const seen = (await kvGet('pm_group_seen')) || {}; for (const [gid2, gg] of Object.entries(seen)) if (/family/i.test(gg?.name || '')) { tgt = gid2; break } }
    if (!tgt) return res.status(200).json({ ok: false, error: '找不到 GROUN:D Family 群（讓 DD 在群裡看到一則訊息就會登記群名，或設 LINE_PREP_GROUP）' })
    try {
      const pr = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ to: tgt, messages: [{ type: 'text', text: L.join('\n') }] }) })
      if (pr.ok) { try { const { logPush, groupMembers } = await import('./push.js'); await logPush(tgt, 1, '備料建議', await groupMembers(tgt)) } catch (_) {} }
      return res.status(200).json({ ok: pr.ok, prep: true, wd, to: tgt.slice(-6), lines: L.length })
    } catch (e) { return res.status(200).json({ ok: false, error: e?.message }) }
  }
  // 三個資料同步（只在早班跑）：失敗不影響速報，但要「留下失敗紀錄」（以前默默吞掉＝資料變舊都不知道）
  const syncErrs = []
  if (!evening && !req.query?.dry) {
    const syncOne = async (label, url) => { try { const r = await fetch(url); if (!r.ok) syncErrs.push(`${label} ${r.status}`) } catch (e) { syncErrs.push(`${label} ${e?.message || 'fail'}`) } }
    await syncOne('sheet-sync', 'https://ground-pm.vercel.app/api/sheet-sync') // 對帳中心：公司帳務試算表
    await syncOne('mail-sync', 'https://ground-pm.vercel.app/api/mail-sync?days=10') // 自動收信：中信 e-Cash + Eats365 POS 日結
    await syncOne('mail-manage', 'https://ground-pm.vercel.app/api/mail-manage?action=apply&days=7') // 信箱管理規則
    if (syncErrs.length) console.log('cron-daily sync errors:', syncErrs.join('; '))
  }
  if (!TOKEN) return res.status(200).json({ ok: false, skipped: '未設 LINE_CHANNEL_ACCESS_TOKEN' })
  // 尊重「設定 → LINE 通知」開關（張良 2026-07-18：關了還照發＝bug）；沒勾就只做資料同步、不推播
  const settings = (await kvGet('pm_settings')) || {}
  const notify = settings.lineNotify || {}
  const target = clean(settings.lineGroupId) || GROUP
  const pushTo = async (to, msgs) => { try { const r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ to, messages: msgs.slice(0, 5) }) }); return r.ok } catch (_) { return false } }
  // ── 任務提醒（發給老闆「私訊」，taskRemind 沒特別關就開）──
  // 刻意放在 pauseAll 總開關「之前」：總開關擋的是群組推播；老闆私訊提醒是他 2026-09-08 明確要的，
  // 只受 taskRemind 開關管（要關：pm_settings.lineNotify.taskRemind = false）。
  let taskPushed = false, teamPushed = false
  if (notify.taskRemind !== false) {
    const open = await loadOpenTasks()
    const today = tpeToday()
    // 週日傍晚 → 晚班改送「下週規劃」（?mode=weekly 可手動觸發）
    const weekly = req.query?.mode === 'weekly' || (evening && new Date(Date.now() + 8 * 3600e3).getUTCDay() === 0)
    const txt = weekly ? buildWeeklyPlan(open, today) : buildTaskRemind(open, evening, today)
    if (req.query?.dry) return res.status(200).json({ ok: true, dry: true, evening, weekly, openCount: open.length, taskText: txt, teamText: buildTeamRemind(open, today) }) // 乾跑：只回文字不推播
    if (txt) {
      // 文字簡報＋互動按鈕卡：卡片只放「該動的」（逾期/今天到期；早班和週規劃多含超急），一張卡=一件任務
      const hot = open.filter(t => (t.due && t.due <= today) || ((weekly || !evening) && t.priority === 'urgent'))
      const msgs = [{ type: 'text', text: txt }]
      if (hot.length) msgs.push(buildTaskCards(hot, weekly ? '下週規劃・先處理這些（點按鈕）' : evening ? '還沒結的任務（點按鈕直接處理）' : '今日任務（點按鈕直接處理）', today))
      taskPushed = await pushTo(BOSS, msgs)
      try { const { logPush } = await import('./push.js'); await logPush(BOSS, msgs.length, weekly ? '下週規劃' : evening ? '任務追蹤' : '任務簡報', 1) } catch (_) {}
    }
    if (req.query?.mode === 'weekly') return res.status(200).json({ ok: true, weekly: true, taskPushed })
    // 團隊群每人今日工作：預設關，設定勾了 teamTasks「且」總開關沒暫停才發（外發要保守）
    if (!evening && notify.teamTasks === true && !notify.pauseAll) {
      const teamTxt = buildTeamRemind(open, today)
      if (teamTxt) { teamPushed = await pushTo(target, [{ type: 'text', text: teamTxt }]); try { const { logPush, groupMembers } = await import('./push.js'); await logPush(target, 1, '團隊任務', await groupMembers(target)) } catch (_) {} }
    }
  }
  if (evening) return res.status(200).json({ ok: true, evening: true, taskPushed }) // 晚班只追任務，不發速報
  // 總開關：暫停所有 LINE 通知 → 群組推播全停（張良 2026-07-31；上面的老闆私訊提醒不在此限）
  if (notify.pauseAll) return res.status(200).json({ ok: true, skipped: '已暫停所有 LINE 通知（總開關），僅完成資料同步', taskPushed })
  const messages = []
  if (notify.daily) {
    const snap = await loadSnapshot()
    const text = buildReport(snap)
    if (text) messages.push({ type: 'text', text })
  }
  // 360評鑑：每週五（台北時間）「回饋時間」提醒——跟著「AI 週報每週五」開關走
  const taipeiDay = new Date(Date.now() + 8 * 3600e3).getUTCDay()
  if (taipeiDay === 5 && notify.weekly) messages.push({ type: 'text', text: '💬 每週回饋時間！\n花 30 秒到「夥伴中心 → 回饋」，給一位夥伴一句具體的鼓勵或建議（可匿名）。\n被按「幫到我」還會加分，衝一波回饋王 👑\nhttps://ground-pm.vercel.app/' })
  if (!messages.length) return res.status(200).json({ ok: true, skipped: '速報開關未勾選', taskPushed, teamPushed })
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ to: target, messages: messages.slice(0, 5) }),
    })
    if (r.ok) { try { const { logPush, groupMembers } = await import('./push.js'); const m = await groupMembers(target); await logPush(target, messages.length, '每日彙報', m) } catch (_) {} }
    return res.status(200).json({ ok: r.ok, pushed: messages.length, taskPushed, teamPushed })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message })
  }
}
