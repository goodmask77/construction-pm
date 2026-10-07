// 後端：GD 工作流程SOP 每日收班彙整（改版第2期，照 GROUND_SOP_CC_spec.md 第7節）
// 取代「逐項超時提醒」→ 每天台北 20:05 由 Vercel Cron 發一則收班彙整（見 vercel.json）。
// 冪等：report_outbox 唯一鍵(營業日)防重送；預設 dry-run 不真發（DD 設定 sopSummary.on 開了才真發，spec：當前不發真實群組訊息）。
// 前端用：POST ?sopsummary=<OPS_BOARD_KEY> {token, mode:'preview'|'send', date?} 預覽／手動測試發送。
import { kvGet, kvPut } from './mail-sync.js'

const OUTBOX_KEY = 'sp_finance_pm_sop_outbox'
const taipei = () => new Date(Date.now() + 8 * 3600e3)
const tpeDate = () => taipei().toISOString().slice(0, 10)
const tpeStamp = () => taipei().toISOString().slice(5, 16).replace('T', ' ')
const fmtRange = it => { const a = it.start || '', b = it.end || it.due || ''; return a && b ? `${a}–${b}` : (b ? `${b} 前` : (a ? `${a} 起` : '未設時間')) }

// 組當天收班彙整快照（收班＝結算，所有 end 都已過）
async function buildSummary(dateStr) {
  const def = ((await kvGet('sp_finance_pm_sop_def')) || {}).ground || {}
  const items = Array.isArray(def.items) ? def.items : []
  const strict = !!def.strictMode
  const log = ((await kvGet('sp_finance_pm_sop_g_' + dateStr.replace(/-/g, ''))) || {}).items || {}
  const isDone = i => log[i.id] && log[i.id].done
  const req = items.filter(i => i.req !== false) // 必做總數只計葉端動作（選做另計，不重複加總階段/父子）
  const doneN = req.filter(isDone).length
  // 逾時＝嚴格模式下有設區間且未完成（收班時 end 都過了）；非嚴格無「逾時鎖」→歸未完成
  const over = req.filter(i => !isDone(i) && strict && i.start && i.end)
  const undoneOther = req.filter(i => !isDone(i) && !over.includes(i))
  return {
    date: dateStr, strict,
    reqN: req.length, doneN,
    overN: over.length, over: over.map(i => ({ st: i.st, tg: i.tg || '未分階段', title: i.title, range: fmtRange(i) })),
    undoneN: undoneOther.length,
    optionalN: items.filter(i => i.req === false).length,
  }
}

function summaryText(cfgText, snap, link) {
  const listStr = snap.over.length ? snap.over.map(o => `・${o.st}／${o.tg}：${o.title}（${o.range}）`).join('\n') : '（無逾時未完成）'
  return String(cfgText || '')
    .replace(/\{date\}/g, snap.date).replace(/\{doneN\}/g, snap.doneN).replace(/\{reqN\}/g, snap.reqN)
    .replace(/\{overN\}/g, snap.overN).replace(/\{list\}/g, listStr).replace(/\{link\}/g, link || '')
}

// 真發 LINE 群（照 joya-intraday 計費 footer 模式）
async function pushLine(gid, text) {
  const tk = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
  if (!tk || !gid) return false
  try {
    let foot = ''
    try { const { groupMembers, quotaFoot } = await import('./push.js'); foot = await quotaFoot(await groupMembers(gid)) } catch (_) {}
    const r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: gid, messages: [{ type: 'text', text: text + (foot || '') }] }) })
    return r.ok
  } catch (_) { return false }
}

async function runSummary(mode, dateStr) {
  const snap = await buildSummary(dateStr)
  let link = 'https://ground-pm.vercel.app/prep#tab=sop'
  let cfg = { on: 0, group: 'internal', text: '' }
  try { const { ddGet } = await import('./_ddmsg.js'); cfg = (await ddGet('sopSummary')) || cfg } catch (_) {}
  try { const { prepLink } = await import('./_webpush.js'); if (prepLink) link = prepLink('#tab=sop') || link } catch (_) {}
  const text = summaryText(cfg.text, snap, link)
  if (mode === 'preview') return { ok: true, mode: 'preview', text, snap, willSend: !!cfg.on }
  // send / cron：冪等（唯一鍵＝營業日）
  const ob = (await kvGet(OUTBOX_KEY)) || { sent: {} }
  ob.sent = ob.sent || {}
  const prev = ob.sent[dateStr]
  if (prev && prev.status === 'sent') return { ok: true, already: true, status: 'sent', ts: prev.ts, text } // 已成功送出→不重送（防排程重跑/盲重送）
  // 預設關＝dry-run：記錄但不真發（spec：當前不發真實群組訊息）
  if (!cfg.on) { ob.sent[dateStr] = { status: 'dryrun', ts: tpeStamp(), text }; await kvPut(OUTBOX_KEY, ob, 'SOP彙整(dry-run)'); return { ok: true, status: 'dryrun', text } }
  // 真發
  let gid = ''
  try { const { ddGroupGid } = await import('./_ddmsg.js'); gid = await ddGroupGid(cfg.group) } catch (_) {}
  const sent = await pushLine(gid, text)
  try { const { wpPush } = await import('./_webpush.js'); if (wpPush) await wpPush(null, { title: '📋 收班彙整', body: `必做 ${snap.doneN}/${snap.reqN}・逾時 ${snap.overN}`, url: '/prep#tab=sop', cat: 'sop' }) } catch (_) {}
  ob.sent[dateStr] = { status: sent ? 'sent' : 'failed', ts: tpeStamp(), text, tries: ((prev && prev.tries) || 0) + 1 }
  await kvPut(OUTBOX_KEY, ob, 'SOP彙整發送')
  return { ok: true, status: ob.sent[dateStr].status, text }
}

export default async function handler(req, res) {
  const key = (process.env.OPS_BOARD_KEY || '').trim()
  // 前端預覽／手動測試發送
  if (req.query && req.query.sopsummary) {
    if (!key || String(req.query.sopsummary) !== key) return res.status(403).json({ ok: false })
    let b = {}; try { b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
    const mode = b.mode === 'send' ? 'send' : 'preview'
    if (mode === 'send') { // 手動發送＝審核人限定（防任意綁定者觸發真發；cron 走內部不經此）
      const bind = (await kvGet('sp_finance_pm_prep_bind')) || {}
      const w = (bind.tokens || {})[b.token || '']
      const apr = (((await kvGet('sp_finance_pm_sop_def')) || {}).ground || {}).approvers || ['張良瑋']
      if (!w || !apr.includes(w.name)) return res.status(403).json({ ok: false, error: '只有審核人可以手動發送彙整' })
    }
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : tpeDate()
    const r = await runSummary(mode, dateStr)
    return res.status(200).json(r)
  }
  // Vercel cron（台北 20:05）：週末公休不發
  const wd = taipei().getUTCDay()
  if (wd === 0 || wd === 6) return res.status(200).json({ ok: true, skip: 'weekend' })
  const r = await runSummary('send', tpeDate())
  return res.status(200).json(r)
}
