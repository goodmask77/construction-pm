import './_qpatch.js' // DD 推播統一補額度尾巴（與 GD 其他推播同一出口）
// abgd 搬家：新殼代發口（2026-10-14）
// 資料域切到新殼後，新殼不自己拿 LINE 金鑰，所有對外通知（LINE 群／私訊、Web Push、積分、建任務）都打這裡，由 GD 原本的單一出口送出：
// 文字照抄 GD 原程式、logPush／額度尾巴／推播紀錄完全不變。HMAC(BRIDGE_SECRET) 簽 body；idem 冪等（同一個 idem 只做一次，重送回上次結果）。
import crypto from 'node:crypto'
import { kvGet, kvSet, SB_URL, svc } from './_onboard.js'
import { logPush, groupMembers, quotaFoot } from './push.js'
import { wpPush, wpPushUids, prepLink } from './_webpush.js'
import { awardPts } from './_points.js'
import { ddGet, ddFill, ddGroupGid, ddAll } from './_ddmsg.js'

const TK = () => (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
// 冪等：每個事件（含逐收件人的子事件）一個鍵 pm_abgd_fxk_<sha1>，用「insert 不覆寫」原子佔位（pm_abgd_ 前綴不屬於任何資料域）
const fxKey = (idem) => 'pm_abgd_fxk_' + crypto.createHash('sha1').update(String(idem)).digest('hex')
async function claim(idem) { // 回 {tok}（我佔到）／{done:r}（做過）／'busy'（別人正在做）；儲存失敗丟錯（由呼叫端回可重試）
  const id = fxKey(idem), tok = crypto.randomUUID(), now = new Date().toISOString()
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify({ s: 'sending', t: Date.now(), tok }) }, editor: 'abgd-fx', updated_at: now }) })
  if (r.ok) return { tok }
  if (r.status !== 409) throw new Error('佔位失敗 HTTP ' + r.status) // 只有「已存在」才當衝突
  const g = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data,updated_at`, { headers: svc })
  if (!g.ok) throw new Error('讀佔位失敗 HTTP ' + g.status)
  const row = (await g.json())[0]; if (!row) throw new Error('佔位消失')
  let cur = {}; try { cur = JSON.parse(row.data.v) } catch (_) {}
  if (cur.s === 'done') return { done: cur.r }
  if (Date.now() - (cur.t || 0) < 5 * 60e3) return 'busy'
  // 過期重領：條件更新（updated_at 沒變才改），只有一個請求搶得到
  const u = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&updated_at=eq.${encodeURIComponent(row.updated_at)}`, { method: 'PATCH', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ data: { v: JSON.stringify({ s: 'sending', t: Date.now(), tok }) }, updated_at: new Date().toISOString() }) })
  if (!u.ok) throw new Error('重領失敗 HTTP ' + u.status)
  return (await u.json()).length ? { tok } : 'busy'
}
async function finish(idem, r) {
  const ok = await kvSet(fxKey(idem), { s: 'done', t: Date.now(), r })
  if (!ok) throw new Error('完成紀錄寫入失敗')
}
async function release(idem) { await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${fxKey(idem)}`, { method: 'DELETE', headers: svc }).catch(() => {}) }
// 子事件：同一個動作裡逐收件人只發一次（重試時已發的人不再發）
async function once(sub, fn) { const c = await claim(sub); if (c === 'busy') return { ok: false, retry: true, busy: true }; if (c.done !== undefined) return c.done; try { const r = await fn(); if (r && r.ok === false && r.retry) { await release(sub); return r } await finish(sub, r); return r } catch (e) { await release(sub); throw e } }
let _retryBase = '' // 目前事件的 idem（handler 設定），用來派生 LINE 重試鍵
const retryKey = (to) => { const h = crypto.createHash('sha1').update(_retryBase + '|' + to).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
async function linePush(to, messages) {
  const tk = TK(); if (!tk || !to) return false
  const h = { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }
  if (_retryBase) h['X-Line-Retry-Key'] = retryKey(to)
  const r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: h, body: JSON.stringify({ to, messages }) })
  return r.ok || r.status === 409 // 409＝同一重試鍵 LINE 已收過（先前其實送出了）
}
async function bindMaps() {
  const bd = (await kvGet('sp_finance_pm_prep_bind')) || {}
  const ids = {}, uid = {}, tok = {}
  for (const [k, v] of Object.entries(bd.tokens || {})) {
    if (!v || !v.name) continue
    ;(ids[v.name] = ids[v.name] || []); if (v.rid) ids[v.name].push(v.rid); if (v.uid) ids[v.name].push(v.uid)
    if (v.uid && !uid[v.name]) { uid[v.name] = v.uid; tok[v.name] = k }
  }
  return { bd, ids, uid, tok }
}
const gdNames = (rosterDoc) => {
  const alive = (((rosterDoc || {}).people) || []).filter(p2 => !p2.endDate && (p2.status || '在職') !== '離職')
  const gd = alive.filter(p2 => p2.gd).map(p2 => p2.name).filter(Boolean)
  return gd.length ? gd : alive.map(p2 => p2.name).filter(Boolean)
}

const ACTIONS = {
  // 讀：會議頁需要的名單（與 GD ?meet 同算法）
  async meet_meta() {
    const [rosM, shM, defM, bindM] = await Promise.all([kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_shift_g'), kvGet('sp_finance_pm_sop_def'), kvGet('sp_finance_pm_prep_bind')])
    const offM = new Set((shM || {}).offStaff || [])
    const regNames = gdNames(rosM).filter(n => !offM.has(n))
    const approvers = (((defM || {}).ground || {}).approvers) || ['張良瑋']
    const boundNames = [...new Set(Object.values((bindM || {}).tokens || {}).map(v => v && v.name).filter(Boolean))]
    const allNames = [...new Set((((rosM || {}).people) || []).filter(p => !p.endDate && (p.status || '在職') !== '離職').map(p => p.name).filter(Boolean))]
    let sendGroups = []; try { sendGroups = (await ddAll()).groups } catch (_) {}
    return { regNames, allNames, boundNames, sendGroups, approvers }
  },
  async meet_group(a) { // 新會議發大群（DD 自動訊息 meet_new）
    const cfgG = await ddGet('meet_new')
    if (!TK() || !cfgG.on) return { ok: true, skipped: true }
    const lnkG = prepLink('meet=' + a.id)
    const GRP = await ddGroupGid(a.group || cfgG.group)
    const mem = await groupMembers(GRP)
    const body = ddFill(cfgG.text, { type: a.type, date: a.date, content: String(a.text || '').slice(0, 300), n: a.n, link: lnkG }) + await quotaFoot(mem)
    const imgs = (a.media || []).filter(u => /^https:\/\//.test(u)).slice(0, 4).map(u => ({ type: 'image', originalContentUrl: u, previewImageUrl: u }))
    const ok = await linePush(GRP, [{ type: 'text', text: body }, ...imgs])
    if (ok) { const nQ = a.n || 1; try { await logPush(GRP, nQ, '會議宣達發大群(' + a.by + ')') } catch (_) {} return { ok: true, sent: true, n: nQ } }
    return { ok: false, retry: true, fail: true }
  },
  async meet_dm_picked(a) { // 指定對象：逐一私訊（個人直達連結）
    const { uid, tok } = await bindMaps()
    const imgs = (a.media || []).filter(u => /^https:\/\//.test(u)).slice(0, 4).map(u => ({ type: 'image', originalContentUrl: u, previewImageUrl: u }))
    let dm = 0
    for (const nm of a.names || []) {
      const u = uid[nm]; if (!u) continue
      const lnk = tok[nm] ? `https://ground-pm.vercel.app/prep?me=${tok[nm]}#meet=${a.id}` : prepLink('meet=' + a.id)
      if (await linePush(u, [{ type: 'text', text: `📢 會議宣達【${a.type}・${a.date}】（${a.by} 指定你簽收）\n${String(a.text || '').slice(0, 300)}\n\n👉 點連結直達，看完按「✅ 確認熟知」\n${lnk}` }, ...imgs])) { dm++; try { await logPush(u, 1, '會議個別私訊(' + a.by + ')') } catch (_) {} }
    }
    return { dm }
  },
  async meet_dm_one(a) { // 指定對象：一個人一個事件（個人直達連結）
    const { uid, tok } = await bindMaps(); const u = uid[a.name]
    if (!u) return { ok: true, skipped: true }
    const imgs = (a.media || []).filter(x => /^https:\/\//.test(x)).slice(0, 4).map(x => ({ type: 'image', originalContentUrl: x, previewImageUrl: x }))
    const lnk = tok[a.name] ? `https://ground-pm.vercel.app/prep?me=${tok[a.name]}#meet=${a.id}` : prepLink('meet=' + a.id)
    const ok = await linePush(u, [{ type: 'text', text: `📢 會議宣達【${a.type}・${a.date}】（${a.by} 指定你簽收）\n${String(a.text || '').slice(0, 300)}\n\n👉 點連結直達，看完按「✅ 確認熟知」\n${lnk}` }, ...imgs])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(u, 1, '會議個別私訊(' + a.by + ')') } catch (_) {}
    return { ok: true, sent: true }
  },
  async meet_ask_notify(a, idem) { // 發問→逐一私訊老闆群操作者（逐人只發一次）
    const ops = (await kvGet('pm_bot_operators')) || {}
    let n = 0
    for (const u of Object.keys(ops)) {
      const r = await once(idem + ':' + u, async () => { const ok = await linePush(u, [{ type: 'text', text: '❓ 會議宣達發問【' + a.type + ' ' + a.date + '】\n' + a.by + '：' + a.q + '\n到 /prep → 會議 回覆（他會收到通知）' }]); if (!ok) return { ok: false, retry: true }; try { await logPush(u, 1, '會議發問通知') } catch (_) {} return { ok: true } })
      if (!r || r.ok === false) return { ok: false, retry: true, n }
      n++
    }
    return { ok: true, n }
  },
  async meet_ask_task(a) { // 發問→收件匣任務（鍵由發問 id 派生，重試不會多建）
    const key = 'sp_team_pm_task_mq' + a.askId
    if (await kvGet(key)) return { ok: true, dup: true }
    const ok = await kvSet(key, { id: 'mq' + a.askId, title: '❓會議發問：' + String(a.q).slice(0, 40) + '（' + a.by + '）', note: '【' + a.type + ' ' + a.date + '】' + a.q, status: 'todo', catId: '__inbox__', priority: 'normal', tags: ['會議'], by: a.by, createdAt: new Date().toISOString() })
    return ok ? { ok: true } : { ok: false, retry: true }
  },
  async wp_names(a) { // App 站內通知＋推播（同名所有身分 id）
    const { ids } = await bindMaps()
    const rids = [...new Set((a.names || []).flatMap(n => ids[n] || []))]
    if (!rids.length) return { ok: true, n: 0 }
    return { ok: true, n: await wpPush(rids, a.msg) }
  },
  async meet_all_acked(a) { // 全員簽完→發起人 LINE 私訊
    const { uid } = await bindMaps(); const u = uid[a.by]
    if (!u) return { ok: true, skipped: true }
    const ok = await linePush(u, [{ type: 'text', text: `🎉 會議全員已簽收【${a.type}・${a.date}】\n${a.total} 人全部確認熟知，點開看 👇\nhttps://ground-pm.vercel.app/prep#meet=${a.id}` }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(u, 1, '會議全員簽收(' + a.by + ')') } catch (_) {}
    return { ok: true }
  },
  async award(a) { return { ok: true, awarded: await awardPts(a.person, a.act, a.ref) } }, // 沒給分（規則關閉／已給過）也算完成
  async meet_ask(a) { // 發問→DD 私訊老闆群操作者＋收件匣任務
    const ops = (await kvGet('pm_bot_operators')) || {}
    for (const u of Object.keys(ops)) { if (await linePush(u, [{ type: 'text', text: '❓ 會議宣達發問【' + a.type + ' ' + a.date + '】\n' + a.by + '：' + a.q + '\n到 /prep → 會議 回覆（他會收到通知）' }])) { try { await logPush(u, 1, '會議發問通知') } catch (_) {} } }
    const id = 'mq' + Date.now().toString(36)
    await kvSet('sp_team_pm_task_mq' + Date.now().toString(36), { id, title: '❓會議發問：' + String(a.q).slice(0, 40) + '（' + a.by + '）', note: '【' + a.type + ' ' + a.date + '】' + a.q, status: 'todo', catId: '__inbox__', priority: 'normal', tags: ['會議'], by: a.by, createdAt: new Date().toISOString() })
    return { ok: true }
  },
  async meet_answer(a) { // 回覆→DD 通知提問人
    const ros = await kvGet('sp_crew_kb_roster')
    const po = (((ros || {}).people) || []).find(p2 => p2.name === a.asker && p2.lineUserId)
    if (!po) return { ok: true, skipped: true }
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: '💬 你的會議發問有回覆了【' + a.type + ' ' + a.date + '】\nQ：' + a.q + '\nA：' + a.ans + '（' + a.ansBy + '）' }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, '會議發問回覆') } catch (_) {}
    return { ok: true }
  },
  async meet_nudge(a) { // 點未簽的人→單獨 DD 私訊＋App 推播
    const { bd } = await bindMaps()
    let tok = null, uid = null, rid = null
    for (const [k, v] of Object.entries(bd.tokens || {})) { if (v && v.name === a.name) { tok = k; uid = v.uid; rid = v.rid || v.uid; break } }
    let sent = 0
    if (uid && TK()) {
      const link = 'https://ground-pm.vercel.app/prep?me=' + tok + '#meet=' + a.id
      const ok = await linePush(uid, [{ type: 'text', text: '📣 會議簽收提醒【' + a.type + '・' + a.date + '】\n' + a.by + ' 請你確認熟知，點開直達這則並簽收 👇\n' + link }])
      if (!ok) return { ok: false, retry: true }
      try { await logPush(uid, 1, '會議個別催簽(' + a.name + ')') } catch (_) {}
      sent++
    }
    if (rid) { try { await wpPush([rid], { title: '📣 會議簽收提醒', body: a.type + '・' + a.date + '（' + a.by + ' 提醒你簽收）', url: '/prep#meet=' + a.id, cat: 'meet' }) } catch (_) {} }
    return { ok: true, sent, bound: !!(uid || rid) }
  },
  async meet_remind(a) { // 未簽追提醒（排程）
    const [ros, bd] = await Promise.all([kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_prep_bind')])
    const po = (((ros || {}).people) || []).find(p2 => p2.name === a.name && p2.lineUserId)
    if (!po) return { ok: true, noLine: true }
    const tkP = (((bd || {}).byUid) || {})[po.lineUserId]
    const lnk = tkP ? `https://ground-pm.vercel.app/prep?me=${tkP}#meet=${a.id}` : prepLink('meet=' + a.id)
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: `📣 會議宣達還沒簽收（第 ${a.n} 次提醒）\n【${a.type}・${a.date}】\n點下面連結直達這則，看完按「✅ 確認熟知」，有問題按「❓ 我想發問」👇\n${lnk}` }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, '宣達未簽提醒') } catch (_) {}
    try { await wpPushUids([po.lineUserId], { title: '📣 會議簽收提醒', body: `【${a.type}・${a.date}】還沒簽收，點開直達這則`, url: '/prep#meet=' + a.id, badge: a.badge }) } catch (_) {}
    return { ok }
  },
  async meet_nudge_group(a) { // 3 次沒簽→大群點名（DD 自動訊息 meet_nudge）
    const cfg = await ddGet('meet_nudge')
    if (!cfg.on || !TK()) return { ok: true, skipped: true }
    const gid = await ddGroupGid(cfg.group)
    const mem = await groupMembers(gid)
    const ok = await linePush(gid, [{ type: 'text', text: ddFill(cfg.text, { type: a.type, date: a.date, names: (a.names || []).join('、'), link: prepLink('meet=' + a.id) }) + await quotaFoot(mem) }])
    return ok ? { ok: true, sent: true } : { ok: false, retry: true }
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false })
  const sec = (process.env.BRIDGE_SECRET || '').trim()
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  const sig = String(req.headers['x-abgd-sig'] || '')
  const expect = sec ? crypto.createHmac('sha256', sec).update(raw).digest('base64url') : ''
  if (!sec || sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return res.status(401).json({ ok: false, error: '簽章不符' })
  let b; try { b = JSON.parse(raw) } catch (_) { return res.status(400).json({ ok: false }) }
  const fn = ACTIONS[b.action]
  if (!fn) return res.status(400).json({ ok: false, error: '未知動作 ' + b.action })
  const readOnly = b.action === 'meet_meta'
  if (readOnly) { try { return res.status(200).json({ ok: true, result: await fn(b.args || {}) }) } catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) }) } }
  if (!b.idem) return res.status(400).json({ ok: false, error: '缺 idem' })
  let c
  try { c = await claim(b.idem) } catch (e) { return res.status(200).json({ ok: false, retry: true, error: String(e?.message || e) }) }
  if (c === 'busy') return res.status(200).json({ ok: false, retry: true, error: '同一個事件正在處理中' })
  if (c.done !== undefined) return res.status(200).json({ ok: true, dup: true, result: c.done })
  try {
    _retryBase = b.idem
    const r = await fn(b.args || {}, b.idem)
    if (r && r.ok === false) { await release(b.idem); return res.status(200).json({ ok: false, retry: !!r.retry, result: r, error: '送出失敗' }) }
    try { await finish(b.idem, r) } catch (_) { /* 已送出但完成紀錄沒寫上：回成功（不要讓新殼重送）；GD 佔位 5 分鐘後過期，若再收到同 idem，LINE 重試鍵會擋重送 */ }
    return res.status(200).json({ ok: true, result: r })
  } catch (e) {
    await release(b.idem)
    return res.status(500).json({ ok: false, retry: true, error: String(e?.message || e).slice(0, 200) })
  }
}
