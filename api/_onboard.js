// ── 入職 2.0 共用模組（LINE 申請/報到綁定/私有檔案桶/帳號開通/免密碼登入連結）──
// 被 line-webhook.js（對話流程）與 onboard.js（簽署頁/審核/文件連結）共用。
// 設計原則：
//  1. 機密（證件照/個資）「不經 AI」：申請流程是固定表單式問答，走這裡就 return，不進 D哥 的 AI 對話。
//  2. 檔案存「私有桶」ground-private（公開圖庫 photos 絕不放證件），看檔一律經 onboard.js 驗身分換短效簽名連結。
//  3. 帳號開通後登入不用密碼：發「一次性登入連結」（App 端 verifyOtp 換 session），連結 1 小時內有效。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim().replace(/\/+$/, '')
export const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
export const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const LINE_TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
export const APP_URL = 'https://' + (clean(process.env.VERCEL_PROJECT_PRODUCTION_URL) || 'construction-pm-goodmask77s-projects.vercel.app')
export const BUCKET = 'ground-private'
export const svc = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

// ── kv（沿用 App 的 pm_documents data.v 格式）──
export async function kvGet(id) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}&select=data`, { headers: svc })
    const rows = r.ok ? await r.json() : []
    if (rows[0]?.data?.v != null) return JSON.parse(rows[0].data.v)
  } catch (_) {}
  return null
}
export async function kvSet(id, obj) {
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: 'onboard-bot', updated_at: new Date().toISOString() }),
  })
  return r.ok
}

// ── LINE ──
export async function linePush(to, text) {
  if (!LINE_TOKEN || !to) return false
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    })
    return r.ok
  } catch (_) { return false }
}
async function lineContent(messageId) { // 下載使用者傳的圖片
  const r = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { authorization: `Bearer ${LINE_TOKEN}` } })
  if (!r.ok) return null
  return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' }
}

// ── 私有桶 ──
let bucketReady = false
export async function ensureBucket() {
  if (bucketReady) return true
  try {
    const g = await fetch(`${SB_URL}/storage/v1/bucket/${BUCKET}`, { headers: svc })
    if (g.ok) { bucketReady = true; return true }
    const c = await fetch(`${SB_URL}/storage/v1/bucket`, {
      method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 15728640 }),
    })
    bucketReady = c.ok
    return c.ok
  } catch (_) { return false }
}
export async function uploadPrivate(path, buf, contentType) {
  await ensureBucket()
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', headers: { ...svc, 'content-type': contentType || 'application/octet-stream', 'x-upsert': 'true' }, body: buf,
  })
  return r.ok
}
export async function signedUrl(path, expiresIn = 300) {
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn }),
  })
  if (!r.ok) return null
  const d = await r.json().catch(() => null)
  return d?.signedURL ? SB_URL + '/storage/v1' + d.signedURL : null
}

// ── 帳號：確保 auth 使用者存在（username@ground.local）＋ profiles 對齊，回 { id }──
async function findProfileByEmail(email) {
  const r = await fetch(`${SB_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`, { headers: svc })
  const rows = r.ok ? await r.json() : []
  return rows[0]?.id || null
}
export async function ensureAccount(username, displayName, role = 'staff') {
  const email = `${username}@ground.local`.toLowerCase()
  // 已有 profile → 完全不動（避免覆蓋管理員調過的權限/名稱），回傳現有 display_name 讓名冊對齊
  const pr = await fetch(`${SB_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,display_name`, { headers: svc })
  const rows = pr.ok ? await pr.json() : []
  if (rows[0]?.id) return { id: rows[0].id, email, displayName: rows[0].display_name || displayName, existed: true }
  const pwd = 'OTL-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) // 隨機密碼，走一次性連結登入，不發密碼
  const c = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pwd, email_confirm: true }),
  })
  const d = await c.json().catch(() => ({}))
  let id = d?.id || d?.user?.id || null
  if (!id && /already|exists|registered/i.test(JSON.stringify(d))) id = await findProfileByEmail(email)
  if (!id) return { error: d?.msg || '建立帳號失敗' }
  // 新帳號安全預設：只進夥伴中心、金額全遮（管理員之後可在帳號頁放寬）
  // 防呆：spaces/money_pages 欄位若資料表還沒加，退回最小欄位寫入（權限=預設全開，部署後要補欄位）
  const ins = (body) => fetch(`${SB_URL}/rest/v1/profiles`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(body),
  })
  const full = await ins({ id, email, display_name: displayName, role, spaces: ['crew'], money_pages: ['__none__'] })
  if (!full.ok) await ins({ id, email, display_name: displayName, role })
  return { id, email, displayName, fullPerms: full.ok }
}
// 一次性登入連結：admin generate_link 取 hashed_token → App 端 verifyOtp 換 session（不依賴 Supabase Site URL 設定）
export async function loginLink(email) {
  const r = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  const d = await r.json().catch(() => ({}))
  const th = d?.hashed_token || d?.properties?.hashed_token
  return th ? `${APP_URL}/?otl=${encodeURIComponent(th)}` : null
}

// ── 名冊讀寫 ──
const ROSTER_KEY = 'sp_crew_kb_roster'
export const loadRoster = async () => (await kvGet(ROSTER_KEY)) || { people: [], fields: [] }
export const saveRoster = (doc) => kvSet(ROSTER_KEY, doc)
const ONBOARD_KEY = 'sp_crew_kb_onboard'   // 申請書（審核中心讀這份）
const STATE_KEY = 'pm_onboard_state'        // 對話進行中的暫存
const CONF_KEY = 'pm_onboard_config'        // {inviteCode}
export const loadApps = async () => (await kvGet(ONBOARD_KEY)) || { apps: [] }
export const saveApps = (d) => kvSet(ONBOARD_KEY, d)
export const loadConf = async () => (await kvGet(CONF_KEY)) || { inviteCode: 'GROUND66' }
export const saveConf = (d) => kvSet(CONF_KEY, d)
const loadStates = async () => (await kvGet(STATE_KEY)) || {}
const saveStates = (d) => kvSet(STATE_KEY, d)

// ── 申請流程步驟（固定表單、逐項驗證；file:true 表示等圖片）──
const isAdult = (bday) => { try { return (Date.now() - new Date(bday).getTime()) / 31557600000 >= 18 } catch (_) { return true } }
const STEPS = [
  { k: 'name', q: '1/9 請問你的「本名」？（例：王小明）', ok: (s) => s.length >= 2 && s.length <= 10, err: '名字看起來不對，請直接回覆本名（2~10字）。' },
  { k: 'nick', q: '2/9 綽號或想被怎麼稱呼？（沒有就回「無」）', ok: () => true },
  { k: 'phone', q: '3/9 手機號碼？（例：0912345678）', ok: (s) => /^09\d{8}$/.test(s), err: '手機格式不對，請輸入 09 開頭共 10 碼。' },
  { k: 'bday', q: '4/9 生日？（格式：2005-03-15）', ok: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s)), err: '生日格式不對，請照「2005-03-15」這樣輸入。' },
  { k: 'idNo', q: '5/9 身分證字號？（僅供投保與人事建檔，只有主管與你本人看得到）', ok: (s) => /^[A-Z][12]\d{8}$/.test(s.toUpperCase()), err: '身分證字號格式不對，請再確認。', up: true },
  { k: 'bankBranch', q: '6/9 薪轉「銀行＋分行」？（例：合作金庫 三重分行；還沒開戶回「待補」）', ok: (s) => s.length >= 2 },
  { k: 'bankAcct', q: '7/9 銀行「帳號」？（還沒開戶回「待補」）', ok: (s) => s === '待補' || /^[\d-]{6,20}$/.test(s), err: '帳號格式不對（6~20位數字），還沒開戶請回「待補」。' },
  { k: 'idFront', file: true, q: '8/9 請直接傳「身分證正面」照片 📷', label: '身分證正面' },
  { k: 'idBack', file: true, q: '請再傳「身分證反面」照片 📷', label: '身分證反面' },
  { k: 'bankbook', file: true, q: '9/9 請傳「存摺封面」照片 📷（帳號待補者回「待補」先跳過）', label: '存摺封面', skipWord: '待補' },
  { k: 'parentConsent', file: true, minorOnly: true, q: '你未滿 18 歲，依規定需要「法定代理人同意書」：請家長簽名後拍照傳上來 📷（紙本之後也請帶來交給店長留存）', label: '法定代理人同意書' },
]
const stepList = (st) => STEPS.filter((s) => !s.minorOnly || !isAdult(st.data?.bday))
const askNext = (st) => { const list = stepList(st); return st.step < list.length ? list[st.step].q : null }

// ── 主入口：處理一則私訊事件。回 true＝已消化（webhook 直接跳過 AI）──
export async function handleOnboardEvent(ev) {
  if (ev.source?.type !== 'user') return false
  const uid = ev.source.userId
  const isText = ev.message?.type === 'text'
  const isImage = ev.message?.type === 'image'
  if (!isText && !isImage) return false
  const text = isText ? (ev.message.text || '').trim() : ''
  const reply = async (t) => { try { await fetch('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${LINE_TOKEN}` }, body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: 'text', text: String(t).slice(0, 4900) }] }) }) } catch (_) {} }

  const states = await loadStates()
  const st = states[uid]

  // ── 觸發詞（沒有進行中流程也可用）──
  if (isText) {
    // 取消
    if (st && /^(取消申請|取消報到|重來)$/.test(text)) { delete states[uid]; await saveStates(states); await reply('好，已取消。要重新開始就再輸入「入職 邀請碼」或「報到 你的名字」。'); return true }
    // 報到（既有員工綁定）
    const mCheck = text.match(/^報到[\s　]*(.*)$/)
    if (mCheck && !st) return await startCheckin(uid, (mCheck[1] || '').trim(), states, reply)
    // 登入（已綁定者要新連結）
    if (/^(登入|登入連結|再給我連結)$/.test(text) && !st) return await sendLoginForBound(uid, reply)
    // 入職申請（邀請碼）
    const conf = await loadConf()
    const mJoin = text.match(/^(入職|應徵|申請)[\s　:：]*(\S*)$/)
    const bareCode = conf.inviteCode && text.toUpperCase() === String(conf.inviteCode).toUpperCase()
    if ((mJoin || bareCode) && !st) {
      const code = bareCode ? text : (mJoin[2] || '')
      if (!conf.inviteCode) { await reply('入職申請目前未開放（管理員尚未設定邀請碼）。'); return true }
      if (code.toUpperCase() !== String(conf.inviteCode).toUpperCase()) { await reply(mJoin && !mJoin[2] ? '請輸入「入職 邀請碼」開始申請（邀請碼請向店長索取）。' : '邀請碼不對，請向店長確認後再試一次。'); return true }
      const appId = 'ob-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      states[uid] = { mode: 'apply', appId, step: 0, data: {}, files: {}, ts: new Date().toISOString() }
      await saveStates(states)
      await reply('歡迎加入 GROUN:D！🎉 接下來我會逐項跟你收入職資料（約 3 分鐘）。\n你的個資與證件只會進入加密的人事檔案，只有主管與你本人能看，不會出現在任何群組。\n隨時可輸入「取消申請」。\n\n' + STEPS[0].q)
      return true
    }
  }

  if (!st) return false // 沒有進行中流程、也不是觸發詞 → 交還給 D哥

  // ── 報到綁定：等末三碼驗證 ──
  if (st.mode === 'checkin') {
    if (!isText) { await reply('請輸入手機末三碼完成驗證，或輸入「取消報到」。'); return true }
    const p = st.person
    if (String(text).slice(-3) === String(p.phone || '').slice(-3)) {
      delete states[uid]; await saveStates(states)
      await bindAndSendLink(uid, p.id, reply)
    } else await reply('末三碼不對喔，再試一次？（或輸入「取消報到」）')
    return true
  }

  // ── 申請流程 ──
  const list = stepList(st)
  if (st.step >= list.length) { await handleContractStage(uid, st, states, text, reply); return true }
  const cur = list[st.step]
  if (cur.file) {
    if (isText && cur.skipWord && text === cur.skipWord) { st.step++; }
    else if (isImage) {
      const c = await lineContent(ev.message.id)
      if (!c) { await reply('圖片下載失敗，請再傳一次。'); return true }
      const ext = /png/.test(c.type) ? 'png' : 'jpg'
      const path = `onboard/${st.appId}/${cur.k}.${ext}`
      const ok = await uploadPrivate(path, c.buf, c.type)
      if (!ok) { await reply('檔案儲存失敗，請再傳一次（或稍後再試）。'); return true }
      st.files[cur.k] = { label: cur.label, path }
      st.step++
    } else { await reply(cur.q); return true }
  } else {
    if (!isText) { await reply(cur.q); return true }
    const val = cur.up ? text.toUpperCase() : text
    if (!cur.ok(val)) { await reply(cur.err || cur.q); return true }
    st.data[cur.k] = val === '無' ? '' : val
    st.step++
  }
  // 下一步 or 進入契約簽署
  const nq = askNext(st)
  states[uid] = st
  if (nq) { await saveStates(states); await reply(nq); return true }
  // 資料收齊 → 發契約簽署連結
  st.signToken = 'sg-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8)
  states[uid] = st
  await saveStates(states)
  await reply(`資料收齊了 ✅ 最後一步：勞動契約線上簽署。\n請點下面連結，詳閱契約內容後在頁面最下方簽名送出：\n${APP_URL}/api/onboard?action=sign&t=${st.signToken}\n\n簽完我會通知管理員審核，審核通過就會發登入連結給你。`)
  return true
}

// 契約階段收到訊息（等簽署完成，或使用者問進度）
async function handleContractStage(uid, st, states, text, reply) {
  if (st.contractSigned) await reply('你的申請已送出，等管理員審核中；審核通過我會馬上把登入連結傳給你 👍')
  else await reply(`還差最後一步：勞動契約簽署。\n${APP_URL}/api/onboard?action=sign&t=${st.signToken}\n（簽完會自動送審）`)
}

// 簽署完成（由 onboard.js 簽署頁 POST 呼叫）：把申請落檔 → 通知管理員
export async function completeSign(token, signName, ip) {
  const states = await loadStates()
  const entry = Object.entries(states).find(([, s]) => s.signToken === token && !s.contractSigned)
  if (!entry) return { error: '連結無效或已簽署' }
  const [uid, st] = entry
  if (signName.trim() !== (st.data.name || '').trim()) return { error: '簽名須與申請的本名一致：' + st.data.name }
  const signedAt = new Date().toISOString()
  const record = { appId: st.appId, name: st.data.name, idNo: st.data.idNo, signName, signedAt, ip, agree: true }
  await uploadPrivate(`onboard/${st.appId}/contract.json`, Buffer.from(JSON.stringify(record, null, 1)), 'application/json')
  st.contractSigned = signedAt
  states[uid] = st
  const apps = await loadApps()
  apps.apps = [{ id: st.appId, lineUserId: uid, status: 'pending', data: st.data, files: st.files, contract: { signedAt, signName }, minor: !isAdult(st.data.bday), ts: st.ts, submittedAt: signedAt }, ...apps.apps.filter(a => a.id !== st.appId)]
  await Promise.all([saveStates(states), saveApps(apps)])
  await linePush(uid, '契約簽署完成、申請已送出 ✅ 管理員審核通過後，我會把登入連結傳給你。')
  // 通知管理員（操作者）——只講有申請，不帶任何個資
  try {
    const ops = (await kvGet('pm_bot_operators')) || {}
    for (const opUid of Object.keys(ops)) await linePush(opUid, `📥 有新的入職申請（${st.data.name}）待審核。請到 App → 夥伴中心 → 名冊 → 待審核 處理。`)
  } catch (_) {}
  return { ok: true, name: st.data.name }
}

// ── 核准/退回核心（onboard.js 驗完管理員身分後呼叫）──
export async function approveApp(appId, dept, byName, startDate) {
  const apps = await loadApps()
  const app = apps.apps.find(a => a.id === appId)
  if (!app || app.status !== 'pending') return { error: '找不到這筆待審申請' }
  const d = app.data || {}
  const acct = await ensureAccount(String(d.phone || '').replace(/\D/g, '') || 'ob' + app.id.replace(/\W/g, ''), d.name, 'staff')
  if (acct.error) return { error: '開帳號失敗：' + acct.error }
  const roster = await loadRoster()
  if (!roster.people.some(p => p.onboardId === app.id)) {
    roster.people.push({
      id: 'p-' + app.id, name: d.name, nick: d.nick || '', dept: dept || '', role: 'staff', status: '在職',
      account: acct.displayName || d.name, phone: d.phone || '', bday: d.bday || '', idNo: d.idNo || '',
      bankBranch: d.bankBranch === '待補' ? '' : (d.bankBranch || ''), bankAcct: d.bankAcct === '待補' ? '' : (d.bankAcct || ''),
      startDate: startDate || new Date().toISOString().slice(0, 10), lineUserId: app.lineUserId, onboardId: app.id,
      privateDocs: [...Object.values(app.files || {}).map(f => ({ label: f.label, path: f.path })), { label: '勞動契約(已簽)', path: `onboard/${app.id}/contract.json` }],
    })
    await saveRoster(roster)
  }
  app.status = 'approved'; app.decidedBy = byName; app.decidedAt = new Date().toISOString()
  await saveApps(apps)
  try { const states = await (async () => (await kvGet('pm_onboard_state')) || {})(); for (const [k, v] of Object.entries(states)) if (v.appId === app.id) delete states[k]; await kvSet('pm_onboard_state', states) } catch (_) {}
  const link = await loginLink(acct.email)
  await linePush(app.lineUserId, `🎉 ${d.name}，你的入職申請通過了！歡迎加入 GROUN:D。\n${link ? '點這裡直接登入夥伴中心（1小時內有效）：\n' + link : '輸入「登入」取得登入連結。'}\n\n之後每天打開「今日」就能看到你的訓練與待辦。`)
  return { ok: true }
}
export async function rejectApp(appId, reason, byName) {
  const apps = await loadApps()
  const app = apps.apps.find(a => a.id === appId)
  if (!app || app.status !== 'pending') return { error: '找不到這筆待審申請' }
  app.status = 'rejected'; app.decidedBy = byName; app.decidedAt = new Date().toISOString(); app.reason = reason || ''
  await saveApps(apps)
  await linePush(app.lineUserId, `你的入職申請被退回${reason ? '：' + reason : ''}。\n可以輸入「入職 邀請碼」重新申請，或直接聯絡店長。`)
  return { ok: true }
}

// ── 報到：既有員工綁 LINE ──
async function startCheckin(uid, nameQ, states, reply) {
  const roster = await loadRoster()
  const act = roster.people.filter(p => (p.status || '在職') !== '離職')
  const already = act.find(p => p.lineUserId === uid)
  if (already) { await reply(`你已經報到過了（${already.name}）✅ 要登入連結就輸入「登入」。`); return true }
  if (!nameQ) { await reply('請輸入「報到 你的本名」，例如：報到 王小明'); return true }
  const hits = act.filter(p => p.name === nameQ || (p.nick && p.nick === nameQ))
  if (!hits.length) { await reply(`名冊裡找不到「${nameQ}」。請確認輸入的是名冊上的本名；新夥伴請改用「入職 邀請碼」申請。`); return true }
  if (hits.length > 1) { await reply('有同名同姓的夥伴，請聯絡管理員手動綁定。'); return true }
  const p = hits[0]
  if (p.lineUserId && p.lineUserId !== uid) { await reply('這位夥伴已經綁定過其他 LINE 帳號。如果是你本人換帳號，請聯絡管理員解除舊綁定。'); return true }
  if (p.phone && String(p.phone).replace(/\D/g, '').length >= 3) {
    states[uid] = { mode: 'checkin', person: { id: p.id, name: p.name, phone: String(p.phone).replace(/\D/g, '') }, ts: new Date().toISOString() }
    await saveStates(states)
    await reply(`哈囉 ${p.name}！最後確認一下身分：請輸入你「手機號碼的末三碼」。`)
  } else {
    await bindAndSendLink(uid, p.id, reply)
  }
  return true
}
// 綁定名冊 person ↔ LINE、確保帳號存在、發登入連結
export async function bindAndSendLink(uid, personId, reply) {
  const roster = await loadRoster()
  const p = roster.people.find(x => x.id === personId)
  if (!p) { await reply('名冊資料異常，請聯絡管理員。'); return true }
  const username = (String(p.phone || '').replace(/\D/g, '') || 'u' + String(p.id).replace(/[^a-z0-9]/gi, '').toLowerCase())
  const acct = await ensureAccount(username, p.name, 'staff')
  if (acct.error) { await reply('帳號開通失敗：' + acct.error + '，請聯絡管理員。'); return true }
  p.lineUserId = uid
  p.account = acct.displayName || p.account || p.name // meFromRoster 用 account===display_name 對身分（以 profiles 現值為準）
  await saveRoster(roster)
  const link = await loginLink(acct.email)
  await reply(link
    ? `綁定完成 ✅ ${p.name}，歡迎使用夥伴中心！\n點這個連結直接登入（1小時內有效、登入後手機會保持登入）：\n${link}\n\n以後要再登入，跟我說「登入」就好。`
    : '綁定完成 ✅ 但登入連結產生失敗，請稍後輸入「登入」再試一次。')
  return true
}
async function sendLoginForBound(uid, reply) {
  const roster = await loadRoster()
  const p = roster.people.find(x => x.lineUserId === uid)
  if (!p) { await reply('你還沒報到綁定喔。既有夥伴輸入「報到 你的本名」；新夥伴輸入「入職 邀請碼」。'); return true }
  const username = (String(p.phone || '').replace(/\D/g, '') || 'u' + String(p.id).replace(/[^a-z0-9]/gi, '').toLowerCase())
  const link = await loginLink(`${username}@ground.local`.toLowerCase())
  await reply(link ? `這是你的登入連結（1小時內有效）：\n${link}` : '連結產生失敗，請稍後再試。')
  return true
}
