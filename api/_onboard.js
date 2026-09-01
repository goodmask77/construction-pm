// ── 入職 2.1 共用模組（張良 2026-07-22 拍板簡化）──
// 「王小明報到」→ 不用邀請碼、不用末三碼：名冊有人=綁定、沒人=直接開帳號＋建「入職中」名冊卡，
// 立刻回免密碼登入連結；資料改在 App 名冊卡自己填（機密檔案走私有桶）；管理員只做「審核」。
// 防線：①新帳號只進夥伴中心+金額全遮 ②每次報到 DD 私訊通知操作者 ③審核退回=刪帳號。
// 機密不經 AI：報到指令走這裡就 return，不進 D哥 的 AI 對話。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim().replace(/\/+$/, '')
export const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
export const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const LINE_TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
export const APP_URL = 'https://' + (clean(process.env.VERCEL_PROJECT_PRODUCTION_URL) || 'ground-pm.vercel.app')
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
export async function notifyOps(text) { // 每次報到/簽約都讓老闆知道（不帶機密）
  try { const ops = (await kvGet('pm_bot_operators')) || {}; for (const uid of Object.keys(ops)) await linePush(uid, text) } catch (_) {}
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

// ── 帳號 ──
async function findProfileByEmail(email) {
  const r = await fetch(`${SB_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,display_name`, { headers: svc })
  const rows = r.ok ? await r.json() : []
  return rows[0] || null
}
export async function ensureAccount(username, displayName, role = 'staff') {
  const email = `${username}@ground.local`.toLowerCase()
  const existed = await findProfileByEmail(email)
  if (existed?.id) return { id: existed.id, email, displayName: existed.display_name || displayName, existed: true }
  const pwd = 'OTL-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) // 隨機密碼；登入走一次性連結，不發密碼
  const c = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pwd, email_confirm: true }),
  })
  const d = await c.json().catch(() => ({}))
  let id = d?.id || d?.user?.id || null
  if (!id && /already|exists|registered/i.test(JSON.stringify(d))) id = (await findProfileByEmail(email))?.id
  if (!id) return { error: d?.msg || '建立帳號失敗' }
  // 新帳號安全預設：只進夥伴中心、金額全遮（管理員之後可在帳號頁放寬）；欄位不存在則退最小寫入
  const ins = (body) => fetch(`${SB_URL}/rest/v1/profiles`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(body),
  })
  const full = await ins({ id, email, display_name: displayName, role, spaces: ['crew'], money_pages: ['__none__'] })
  if (!full.ok) await ins({ id, email, display_name: displayName, role })
  return { id, email, displayName }
}
export async function deleteAccountByEmail(email) { // 審核退回時清帳號
  const p = await findProfileByEmail(email)
  if (!p?.id) return false
  await fetch(`${SB_URL}/auth/v1/admin/users/${p.id}`, { method: 'DELETE', headers: svc })
  await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${p.id}`, { method: 'DELETE', headers: svc })
  return true
}
// 一次性登入連結：hashed_token → App ?otl= 由 verifyOtp 換 session（不依賴 Supabase Site URL）
export async function loginLink(email) {
  const r = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  const d = await r.json().catch(() => ({}))
  const th = d?.hashed_token || d?.properties?.hashed_token
  return th ? `${APP_URL}/?otl=${encodeURIComponent(th)}` : null
}

// ── 名冊 ──
const ROSTER_KEY = 'sp_crew_kb_roster'
export const loadRoster = async () => (await kvGet(ROSTER_KEY)) || { people: [], fields: [] }
export const saveRoster = (doc) => kvSet(ROSTER_KEY, doc)
export const usernameOf = (p) => (String(p.phone || '').replace(/\D/g, '') || 'u' + String(p.id).replace(/[^a-z0-9]/gi, '').toLowerCase())

// 綁定＋開帳號＋回登入連結（共用：既有員工綁定 / 新人開卡）
async function bindPerson(uid, roster, p, reply, isNew) {
  const acct = await ensureAccount(usernameOf(p), p.name, 'staff')
  if (acct.error) { await reply('帳號開通失敗：' + acct.error + '，請聯絡管理員。'); return true }
  p.lineUserId = uid
  p.account = String(acct.displayName || '').trim() || p.account || p.name // meFromRoster 用 account===display_name 對身分（trim 防空白字串把欄位洗掉）
  await saveRoster(roster)
  const link = await loginLink(acct.email)
  await reply(isNew
    ? `${p.name} 歡迎加入 GROUN:D！🎉 帳號開好了。\n點下面連結進入夥伴中心（1小時內有效、登入後手機保持登入）：\n${link || '（連結產生失敗，稍後輸入「登入」再試）'}\n\n進去後打開「今日」頁最上面的「入職資料卡」，把基本資料填一填、證件拍照上傳、線上簽勞動契約——可以分次慢慢完成。`
    : `綁定完成 ✅ ${p.name}，歡迎使用夥伴中心！\n點這個連結直接登入（1小時內有效、登入後手機保持登入）：\n${link || '（連結產生失敗，稍後輸入「登入」再試）'}\n\n以後要再登入，跟我說「登入」就好。`)
  await notifyOps(`📲 ${isNew ? '新夥伴' : '夥伴'}「${p.name}」剛完成 LINE 報到${isNew ? '（新開帳號，資料填完會進名冊「待審核」）' : '（綁定既有名冊）'}。若非你認識的人，請到名冊處理。`)
  return true
}

// ── 主入口：處理一則私訊文字。回 true＝已消化（不進 AI）──
export async function handleOnboardEvent(ev) {
  if (ev.source?.type !== 'user' || ev.message?.type !== 'text') return false
  const uid = ev.source.userId
  const text = (ev.message.text || '').trim()
  const reply = async (t) => { try { await fetch('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${LINE_TOKEN}` }, body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: 'text', text: String(t).slice(0, 4900) }] }) }) } catch (_) {} }

  // 「登入」→ 已綁定者補發連結
  if (/^(登入|登入連結|再給我連結)$/.test(text)) {
    const roster = await loadRoster()
    const p = roster.people.find(x => x.lineUserId === uid)
    if (!p) { await reply('你還沒報到過喔。請輸入「你的本名＋報到」，例如：王小明報到') ; return true }
    const link = await loginLink(`${usernameOf(p)}@ground.local`.toLowerCase())
    await reply(link ? `這是你的登入連結（1小時內有效）：\n${link}` : '連結產生失敗，請稍後再試。')
    return true
  }

  // 「王小明報到」或「報到 王小明」（固定格式，不經 AI）
  const m = text.match(/^報到[\s　]*(.{1,12})$/) || text.match(/^(.{1,12}?)[\s　]*報到$/)
  if (!m) return false
  const name = (m[1] || '').trim()
  if (!name) { await reply('請輸入「你的本名＋報到」，例如：王小明報到'); return true }

  const roster = await loadRoster()
  const act = roster.people.filter(p => (p.status || '在職') !== '離職')
  const already = act.find(p => p.lineUserId === uid)
  if (already) { await reply(`你已經報到過了（${already.name}）✅ 要登入連結就輸入「登入」。`); return true }

  const hits = act.filter(p => p.name === name || (p.nick && p.nick === name))
  if (hits.length > 1) { await reply('名冊裡有同名同姓的夥伴，請聯絡店長手動綁定。'); return true }
  if (hits.length === 1) {
    const p = hits[0]
    if (p.lineUserId && p.lineUserId !== uid) { await reply('這個名字已經綁定過其他 LINE 帳號。如果是你本人換帳號，請聯絡店長解除舊綁定。'); return true }
    return await bindPerson(uid, roster, p, reply, !!p.onboarding)
  }
  // 名冊沒有 → 新人：直接開卡＋開帳號（入職中，等資料填完管理員審核）
  const np = {
    id: 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name, nick: '', dept: '', role: 'staff', status: '在職',
    onboarding: true, onboardAt: new Date().toISOString(), // 入職中：名冊「待審核」區會列出
    signToken: 'sg-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8), // 契約簽署一次性連結
  }
  roster.people.push(np)
  return await bindPerson(uid, roster, np, reply, true)
}

// ── 契約簽署（App 入職卡/簽署頁用）──
export async function completeSign(token, signName, ip) {
  const roster = await loadRoster()
  const p = roster.people.find(x => x.signToken === token)
  if (!p) return { error: '連結無效' }
  if (p.contractSigned) return { error: '已完成簽署' }
  if (signName.trim() !== (p.name || '').trim()) return { error: '簽名須與本名一致：' + p.name }
  const signedAt = new Date().toISOString()
  const path = `roster/${p.id}/contract.json`
  await uploadPrivate(path, Buffer.from(JSON.stringify({ personId: p.id, name: p.name, signName, signedAt, ip, agree: true }, null, 1)), 'application/json')
  p.contractSigned = signedAt
  p.contractDoc = [...(p.contractDoc || []), { name: '勞動契約(線上簽)', path, private: true, ts: signedAt }]
  await saveRoster(roster)
  await notifyOps(`✍ 「${p.name}」已完成勞動契約線上簽署。`)
  return { ok: true, name: p.name }
}

// ── 審核（App 名冊待審核區 → onboard.js 驗完管理員身分後呼叫）──
export async function approveApp(personId, dept, byName, startDate) {
  const roster = await loadRoster()
  const p = roster.people.find(x => x.id === personId && x.onboarding)
  if (!p) return { error: '找不到這位入職中的夥伴' }
  delete p.onboarding
  if (dept) p.dept = dept
  if (!p.startDate) p.startDate = startDate || new Date().toISOString().slice(0, 10)
  p.approvedBy = byName; p.approvedAt = new Date().toISOString()
  await saveRoster(roster)
  await linePush(p.lineUserId, `🎉 ${p.name}，你的入職審核通過了！正式歡迎加入 GROUN:D。\n每天打開「今日」就能看到你的班、訓練與待辦。`)
  return { ok: true }
}
export async function rejectApp(personId, reason, byName) {
  const roster = await loadRoster()
  const p = roster.people.find(x => x.id === personId && x.onboarding)
  if (!p) return { error: '找不到這位入職中的夥伴' }
  roster.people = roster.people.filter(x => x.id !== personId)
  await saveRoster(roster)
  await deleteAccountByEmail(`${usernameOf(p)}@ground.local`.toLowerCase()) // 帳號一併清掉
  await linePush(p.lineUserId, `你的入職申請被退回${reason ? '：' + reason : ''}。\n如有疑問請直接聯絡店長；要重新申請再輸入「你的本名＋報到」。`)
  return { ok: true }
}
