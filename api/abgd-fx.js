import './_qpatch.js' // DD 推播統一補額度尾巴（與 GD 其他推播同一出口）
// abgd 搬家：新殼代發口（2026-10-14）
// 資料域切到新殼後，新殼不自己拿 LINE 金鑰，所有對外通知（LINE 群／私訊、Web Push、積分、建任務）都打這裡，由 GD 原本的單一出口送出：
// 文字照抄 GD 原程式、logPush／額度尾巴／推播紀錄完全不變。HMAC(BRIDGE_SECRET) 簽 body；idem 冪等（同一個 idem 只做一次，重送回上次結果）。
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { kvGet, kvSet, SB_URL, svc } from './_onboard.js'
import { logPush, groupMembers, quotaFoot } from './push.js'
import { wpPush, wpPushUids, prepLink } from './_webpush.js'
import { awardPtsStrict } from './_points.js'
import { ddGet, ddFill, ddGroupGid, ddAll } from './_ddmsg.js'
import { aiCall } from './_ai.js'

const TK = () => (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
// 冪等：每個事件（含逐收件人的子事件）一個鍵 pm_abgd_fxk_<sha1>，用「insert 不覆寫」原子佔位（pm_abgd_ 前綴不屬於任何資料域）
const fxKey = (idem) => 'pm_abgd_fxk_' + crypto.createHash('sha1').update(String(idem)).digest('hex')
async function claim(idem) { // 回 {tok}（我佔到）／{done:r}（做過）／'busy'（別人正在做）；儲存失敗丟錯（由呼叫端回可重試）
  const id = fxKey(idem), tok = crypto.randomUUID(), now = new Date().toISOString()
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify({ s: 'sending', t: Date.now(), tok }) }, editor: 'abgd-fx:' + tok, updated_at: now }) })
  if (r.ok) return { tok }
  if (r.status !== 409) throw new Error('佔位失敗 HTTP ' + r.status) // 只有「已存在」才當衝突
  const g = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data,updated_at`, { headers: svc })
  if (!g.ok) throw new Error('讀佔位失敗 HTTP ' + g.status)
  const row = (await g.json())[0]; if (!row) throw new Error('佔位消失')
  let cur = {}; try { cur = JSON.parse(row.data.v) } catch (_) {}
  if (cur.s === 'done') return { done: cur.r }
  if (Date.now() - (cur.t || 0) < 5 * 60e3) return 'busy'
  // 過期重領：條件更新（updated_at 沒變才改），只有一個請求搶得到
  const u = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&updated_at=eq.${encodeURIComponent(row.updated_at)}`, { method: 'PATCH', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ data: { v: JSON.stringify({ s: 'sending', t: Date.now(), tok }) }, editor: 'abgd-fx:' + tok, updated_at: new Date().toISOString() }) })
  if (!u.ok) throw new Error('重領失敗 HTTP ' + u.status)
  return (await u.json()).length ? { tok } : 'busy'
}
// 完成／釋放都只在「佔位還是我的（editor=abgd-fx:<tok>）」時才動，舊請求不能覆寫或刪掉新持有者
async function finish(idem, tok, r) {
  const u = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${fxKey(idem)}&editor=eq.${encodeURIComponent('abgd-fx:' + tok)}`, { method: 'PATCH', headers: { ...svc, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ data: { v: JSON.stringify({ s: 'done', t: Date.now(), r }) }, editor: 'abgd-fx:done', updated_at: new Date().toISOString() }) })
  if (!u.ok) throw new Error('完成紀錄寫入失敗 HTTP ' + u.status)
  if (!(await u.json()).length) throw new Error('佔位已不是我的')
}
async function release(idem, tok) { await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${fxKey(idem)}&editor=eq.${encodeURIComponent('abgd-fx:' + tok)}`, { method: 'DELETE', headers: svc }).catch(() => {}) }
// 子事件：同一個動作裡逐收件人只發一次（重試時已發的人不再發）
async function once(sub, fn, base) { const c = await claim(sub); if (c === 'busy') return { ok: false, retry: true, busy: true }; if (c.done !== undefined) return c.done; try { const r = await fn(); if (r && r.ok === false && r.retry) { await release(sub, c.tok); return r } try { await finish(sub, c.tok, r) } catch (_) {} return r } catch (e) { await release(sub, c.tok); throw e } }
const ctx = new AsyncLocalStorage() // 每個請求自己的事件 idem（同時處理多個請求不會互蓋），用來派生 LINE 重試鍵
const retryKey = (to) => { const h = crypto.createHash('sha1').update((ctx.getStore() || '') + '|' + to).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
// 由任意字串推出固定 UUID（LINE 重試鍵要 UUID 格式）：同一件事不論哪邊、按幾次都同一把鍵，LINE 24 小時內擋重複
export const fixedKey = (s) => { const h = crypto.createHash('sha1').update(String(s)).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
async function linePush(to, messages, key) { // key：指定固定重試鍵（跨系統同一件事共用）；沒給就用事件＋收件人推導
  const tk = TK(); if (!tk || !to) return false
  const h = { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }
  if (key) h['X-Line-Retry-Key'] = fixedKey(key); else if (ctx.getStore()) h['X-Line-Retry-Key'] = retryKey(to)
  const r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: h, body: JSON.stringify({ to, messages }), signal: AbortSignal.timeout(15000) })
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

// 新殼借用 GD 的 AI 出口（唯讀動作，2026-10-14 第 2 波耗損 F09 起）：金鑰、路由（AI 中樞設定）、用量紀錄都留在 GD；
// 只允許登記過的路由，避免新殼任意呼叫；回 { text, provider, model }
const AI_ROUTES_OK = new Set(['waste', 'rcpimport', 'menuocr']) // menuocr：菜單拍照建檔（F18）
const ACTIONS = {
  async ai_call(a) {
    const route = String(a.route || '')
    if (!AI_ROUTES_OK.has(route)) throw new Error('這個 AI 路由沒開放給新殼：' + route)
    // 內容限制（abgd 耗損關卡 3 第一輪）：只收 user 訊息、文字或圖片（JPEG／PNG／WebP）、圖片最多 14 張、整包 ≤4.3MB、maxTokens 1～4000；不接受指定模型（override）
    const msgs = Array.isArray(a.messages) ? a.messages : []
    if (msgs.length > 4 || Buffer.byteLength(JSON.stringify(a)) > 4_300_000 || Buffer.byteLength(String(a.system || '')) > 24000) throw new Error('送 AI 的內容太大') // 量實際位元組（中文一字 3 位元組），含 system 與所有參數
    let nImg = 0
    for (const m of msgs) {
      if (!m || m.role !== 'user') throw new Error('訊息格式不對')
      const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (Array.isArray(m.content) ? m.content : null)
      if (!parts) throw new Error('訊息格式不對')
      for (const c of parts) {
        if (c && c.type === 'text' && typeof c.text === 'string') continue
        if (c && c.type === 'image' && /^image\/(jpeg|png|webp)$/.test(String(c.media_type || '')) && typeof c.data === 'string') { nImg++; continue }
        throw new Error('訊息內容只能是文字或圖片')
      }
    }
    if (nImg > 14) throw new Error('圖片太多')
    const mt = Math.trunc(Number(a.maxTokens)); const maxTokens = Number.isFinite(mt) && mt >= 1 ? Math.min(route === 'menuocr' ? 8000 : 4000, mt) : 600 // 菜單抄寫（F18）整份菜單 JSON 較長：同 GD ?menuocr 8000
    const r = await aiCall(route, { system: String(a.system || ''), messages: msgs, maxTokens, ...(route === 'menuocr' ? { timeoutMs: 150000 } : {}) })
    return { text: r.text || '', provider: r.provider || '', model: r.model || '' }
  },
  // 菜單 AI 生圖（abgd F18 菜單；2026-10-15）：跟 GD ?menuai 同一份程式（_menuai.js）；只產圖存 photos/menu/raw/、回網址，不寫任何資料文件
  // 參數只收 kind／sub／imgs（≤3 張 data URL）／hint／slogan／n／brief_en／brief_zh；整包 ≤4.3MB
  async menu_ai_gen(a) {
    if (Buffer.byteLength(JSON.stringify(a || {})) > 4_300_000) throw new Error('送 AI 的內容太大')
    const { menuAiGen } = await import('./_menuai.js')
    const pick = { kind: a.kind, sub: a.sub, imgs: Array.isArray(a.imgs) ? a.imgs.slice(0, 3) : [], hint: a.hint, slogan: a.slogan, n: a.n, brief_en: a.brief_en, brief_zh: a.brief_zh }
    return await menuAiGen(pick)
  },
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
  // 讀：回饋頁需要的名單（與 GD ?fb 同算法：當天打卡者、名冊、審核人、站長、站別）
  async fb_meta(a) {
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '')) ? String(a.date) : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const [rosterF, defFb] = await Promise.all([kvGet('sp_crew_kb_roster'), kvGet('sp_finance_pm_sop_def')])
    const pjF = await import('./punch.js')
    let pch = []; try { pch = await pjF.listPunches('sp_crew_pch_' + dt.replace(/-/g, '')) } catch (_) {}
    const g = (defFb || {}).ground || {}
    return { date: dt, workers: [...new Set(pch.map(p2 => p2.name))].filter(Boolean), names: gdNames(rosterF), approvers: g.approvers || ['張良瑋'], stOwner: g.stOwner || {}, stations: g.stations || [] }
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
  async boss_dm(a) { // 私訊老闆（固定收件人 LINE_BOSS_USER，不收任意 userId）：新殼排程摘要（例：每日菜商報價同步）用；有 idem＝重試不重發
    const to = String(process.env.LINE_BOSS_USER || 'Uf7ce4fb9191cd3055247204e0cb6b4fc').trim()
    const text = String(a.text || '').slice(0, 4800); if (!text) return { ok: true, skipped: true }
    const ok = await linePush(to, [{ type: 'text', text }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(to, 1, String(a.tag || '新殼私訊老闆').slice(0, 40)) } catch (_) {}
    return { ok: true }
  },
  async award(a) { const r = await awardPtsStrict(a.person, a.act, a.ref); return { ok: true, awarded: r.awarded, reason: r.reason } }, // 規則關閉／已給過／達上限＝完成；讀寫失敗丟錯＝新殼重試（關卡 3 回饋第一輪）
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
  // ── SOP／問題回報（F02＋F33，文字照抄 mail-sync 原程式）──
  async sop_sug_dm(a) { // 💡 建議 → DD 私訊該站負責人（原 sopsugset add）
    const ros = await kvGet('sp_crew_kb_roster')
    const po = (((ros || {}).people) || []).find(p2 => p2.name === a.owner && p2.lineUserId)
    if (!po || !TK()) return { ok: true, skipped: true }
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: '💡 ' + a.by + ' 對你負責的 SOP【' + a.st + '】提了建議：\n' + a.text + '\n到 /prep → SOP 按「💡 建議」審核（通過他會加分）' }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, 'SOP建議通知') } catch (_) {} return { ok: true, sent: true }
  },
  async sop_sug_result(a) { // 建議審核結果 → DD 通知申請人（原 sopsugset decide）
    const ros = await kvGet('sp_crew_kb_roster')
    const po = (((ros || {}).people) || []).find(p2 => p2.name === a.to && p2.lineUserId)
    if (!po || !TK()) return { ok: true, skipped: true }
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: a.pass ? ('✅ 你對 SOP【' + a.st + '】的建議通過了（' + a.decBy + ' 核）——記你 1 分！') : ('📁 你對 SOP【' + a.st + '】的建議未採納（' + a.decBy + '）：' + a.note + '\n已歸檔留紀錄。') }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, 'SOP建議結果') } catch (_) {} return { ok: true, sent: true }
  },
  async ntf_add(a, idem) { // 通知中心只記歷史（原 sopreport：不發 web push）
    const nd = (await kvGet('sp_finance_pm_prep_ntf')) || { list: [] }
    // 通知 id 由事件冪等鍵決定（關卡 3 SOP 第一輪）：寫成功但回應丟失再執行，不會多一筆
    const nid = idem ? 'nx' + crypto.createHash('sha1').update(String(idem)).digest('hex').slice(0, 12) : 'n' + Date.now().toString(36)
    if ((nd.list || []).some(x => x.id === nid)) return { ok: true, dup: true }
    nd.list = [{ id: nid, ts: new Date().toISOString(), cat: a.cat || 'other', title: a.title, body: a.body, url: a.url || '/prep', to: a.to || null }, ...(nd.list || [])].slice(0, 300)
    if (!(await kvSet('sp_finance_pm_prep_ntf', nd))) return { ok: false, retry: true }
    return { ok: true }
  },
  async sop_report_dm(a, idem) { // 問題回報 → DD 私訊審核人【發布／保留／刪除】（原 sopreport）
    const [defD, rosterD] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
    const apr = Array.isArray(a.apr) ? a.apr : (((defD || {}).ground || {}).approvers || ['張良瑋']) // 新殼正本快照優先（GD 副本可能還沒反推到）
    const iss = a.iss || {}
    const out = []
    for (const an of apr) {
      const ap = ((rosterD || {}).people || []).find(p => p.name === an && p.lineUserId)
      if (!TK() || !ap) continue
      out.push(await once(idem + '|' + an, async () => ({ ok: await linePush(ap.lineUserId, [{ type: 'template', altText: `⚠️ 問題回報待確認【${iss.st}】${(iss.text || '').slice(0, 30)}`, template: { type: 'buttons', title: `⚠️ 問題回報【${iss.st}】`.slice(0, 40), text: `${(iss.text || '（見附件）').slice(0, 100)}\n— ${iss.by}${(iss.media || []).length ? `・附${iss.media.length}檔(看板可看)` : ''}`.slice(0, 160), actions: [
        { type: 'postback', label: '✅ 發布到群', data: `pi|${iss.id}|go` },
        { type: 'postback', label: '📥 保留（不進群）', data: `pi|${iss.id}|hold` },
        { type: 'postback', label: '🗑 刪除', data: `pi|${iss.id}|del` },
      ] } }]) || false })))
    }
    return out.some(r => r && r.ok === false) ? { ok: false, retry: true } : { ok: true, n: out.length }
  },
  async sop_resolve_dm(a, idem) { // 夥伴按已解決＝送審 → DD 私訊審核人＋推播（原 sopresolve pending）
    const [defD, rosterD] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
    const apr = Array.isArray(a.apr) ? a.apr : (((defD || {}).ground || {}).approvers || ['張良瑋'])
    const it = a.it || {}
    for (const an of apr) {
      const ap = ((rosterD || {}).people || []).find(p => p.name === an && p.lineUserId)
      if (!ap) continue
      const r = await once(idem + '|' + an, async () => {
        if (TK()) { const ok = await linePush(ap.lineUserId, [{ type: 'text', text: `🕐 待你審核：【${it.st}】${it.text || '（附件）'}\n${a.who} 說已解決。\n到看板該站卡片按「核准／退回」👇\n${prepLink('')}` }]); if (!ok) return { ok: false, retry: true } }
        try { await wpPushUids([ap.lineUserId], { title: '🕐 待你審核', body: `【${it.st}】${a.who} 說已解決，按核准／退回`, url: '/prep' }) } catch (_) {}
        return { ok: true }
      })
      if (r && r.ok === false) return { ok: false, retry: true }
    }
    return { ok: true }
  },
  async issue_pub_group(a) { // 審核發布 go → 發到 DD 自動訊息 issue 設定的群（原 sopissue pub）
    if (a.ts && Date.now() - Date.parse(a.ts) > 23 * 3600e3) return { ok: true, skipped: 'expired' } // 超過 23 小時不再送（同上）
    const cfgI = await ddGet('issue')
    if (!TK() || !cfgI.on) return { ok: true, skipped: true }
    const it = a.it || {}
    const gidI = await ddGroupGid(cfgI.group)
    const mem = await groupMembers(gidI)
    const ok = await linePush(gidI, [{ type: 'text', text: ddFill(cfgI.text, { st: it.st, content: (it.text || '（見附件）') + ((it.media || []).length ? `・附件${it.media.length}` : ''), by: it.by }) + await quotaFoot(mem) }], 'issue-pub:' + (a.id || it.id || '') + ':' + gidI) // 固定鍵＝問題＋目標群（不同群是不同發送單元）
    return ok ? { ok: true, sent: true } : { ok: false, retry: true }
  },
  async pi_pub_group(a) { // LINE 審核按鈕「發布到群」（原 line-webhook pi|go：固定發內部群＋全員推播，文字照抄）
    const it = a.it || {}
    // 超過 23 小時（LINE 去重期限前）的發布嘗試不再送（關卡 3 SOP 第七輪）：避免期限過後重送變重複
    if (a.ts && Date.now() - Date.parse(a.ts) > 23 * 3600e3) return { ok: true, skipped: 'expired' }
    if (!TK()) return { ok: false, retry: true } // 缺金鑰＝等設定修好重試（不當成已發；關卡 3 SOP 第二輪）
    // 固定重試鍵＝問題編號（與 GD 舊路徑同一把）：切換前後兩邊、重試幾次，LINE 都只收一次
    const ok = await linePush('Cf7940efc6517b0c084ad2ad496b45f30', [{ type: 'text', text: `⚠️ 看板問題回報【${it.st}】\n${it.text || '（見附件）'}\n— ${it.by}${(it.media || []).length ? `・附 ${it.media.length} 個檔案` : ''}\n處理完點連結按「已解決」👇\n${prepLink('')}` }], 'pi-pub:' + (a.id || it.id || ''))
    if (!ok) return { ok: false, retry: true }
    try { await wpPush(null, { title: `⚠️ 問題回報【${it.st}】`, body: `${(it.text || '（附件）').slice(0, 60)} — ${it.by}`, url: '/prep' }) } catch (_) {}
    return { ok: true, sent: true }
  },
  async issue_own_dm(a) { // 指派負責人 → DD 私訊被指派者（原 sopissue own）
    const rosterO = (await kvGet('sp_crew_kb_roster')) || {}
    const po = (rosterO.people || []).find(p2 => p2.name === a.nm && p2.lineUserId)
    if (!TK() || !po) return { ok: true, skipped: true }
    const it = a.it || {}
    const ok = await linePush(po.lineUserId, [{ type: 'text', text: `📌 ${a.who} 指派給你：【${it.st || '任務'}】${it.text || ''}\n完成後到 /prep 按「已解決」` }])
    if (!ok) return { ok: false, retry: true }
    try { await logPush(po.lineUserId, 1, '任務指派通知') } catch (_) {} return { ok: true, sent: true }
  },
  async buy_group(a) { // 採購需求 → DD 自動訊息 buy 設定的群（原 ?buyadd，文字照抄；abgd 盤點／採購 F05～07）
    if (a.ts && Date.now() - Date.parse(a.ts) > 23 * 3600e3) return { ok: true, skipped: 'expired' }
    const cfgB = await ddGet('buy')
    if (!TK() || !cfgB.on) return { ok: true, skipped: true }
    const it = a.it || {}
    const gidB = await ddGroupGid(cfgB.group)
    const mem = await groupMembers(gidB)
    const media = Array.isArray(it.media) ? it.media : []
    const ok = await linePush(gidB, [{ type: 'text', text: ddFill(cfgB.text, { content: it.text || '（見附件）', by: it.by, url: (it.url ? '\n🔗 ' + it.url : '') + (media.length ? `・附${media.length}圖` : '') }) + await quotaFoot(mem) }], 'buy-add:' + (it.id || '') + ':' + gidB)
    return ok ? { ok: true, sent: true } : { ok: false, retry: true }
  },
  async low_stock(a) { // 盤點／包材低水位 → DD 自動訊息 lowStock 群＋全員推播（原 joya-intraday 每日 11:00 場次，文字照抄）
    if (a.ts && Date.now() - Date.parse(a.ts) > 12 * 3600e3) return { ok: true, skipped: 'expired' } // 當天的提醒，隔太久就不發
    const cfgLS = await ddGet('lowStock')
    if (!cfgLS.on) return { ok: true, skipped: true }
    let sent = false
    if (TK()) {
      const gidLS = await ddGroupGid(cfgLS.group)
      const mem = await groupMembers(gidLS)
      if (await linePush(gidLS, [{ type: 'text', text: ddFill(cfgLS.text, { list: String(a.list || '') }) + await quotaFoot(mem) }], 'low-stock:' + (a.date || '') + ':' + gidLS)) sent = true
    }
    try { if (await wpPush(null, { title: '📉 庫存低水位', body: String(a.names || ''), url: '/prep' })) sent = true } catch (_) {}
    return sent ? { ok: true, sent: true } : { ok: false, retry: true }
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
  const readOnly = b.action === 'meet_meta' || b.action === 'fb_meta' || b.action === 'ai_call' || b.action === 'menu_ai_gen'
  if (readOnly) { try { return res.status(200).json({ ok: true, result: await fn(b.args || {}) }) } catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) }) } }
  if (!b.idem) return res.status(400).json({ ok: false, error: '缺 idem' })
  let c
  try { c = await claim(b.idem) } catch (e) { return res.status(200).json({ ok: false, retry: true, error: String(e?.message || e) }) }
  if (c === 'busy') return res.status(200).json({ ok: false, retry: true, error: '同一個事件正在處理中' })
  if (c.done !== undefined) return res.status(200).json({ ok: true, dup: true, result: c.done })
  try {
    const r = await ctx.run(b.idem, () => fn(b.args || {}, b.idem))
    if (r && r.ok === false) { await release(b.idem, c.tok); return res.status(200).json({ ok: false, retry: !!r.retry, result: r, error: '送出失敗' }) }
    try { await finish(b.idem, c.tok, r) } catch (_) { /* 已送出但完成紀錄沒寫上：回成功（不要讓新殼重送）；GD 佔位 5 分鐘後過期，若再收到同 idem，LINE 重試鍵會擋重送 */ }
    return res.status(200).json({ ok: true, result: r })
  } catch (e) {
    await release(b.idem, c.tok)
    return res.status(500).json({ ok: false, retry: true, error: String(e?.message || e).slice(0, 200) })
  }
}
