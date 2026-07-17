// 後端：LWLWLW 信箱管理（goodmask77@gmail.com 收件匣）
// ?action=scan&days=N  → 掃收件匣：來源彙總+最近信件 → sp_lw_pm_mail_scan（給前端判讀/設規則）
// ?action=apply&days=N → 套用規則 sp_lw_pm_mail_rules：delete=移垃圾桶(30天可救回)/label=貼標移出收件匣/archive=封存；寫執行紀錄 sp_lw_pm_mail_log
// cron-daily 每天 apply（新信寄來→依張良的設定自動處理）。keep 規則=白名單，永不動。
import { ImapFlow } from 'imapflow'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const MU = clean(process.env.MAIL_USER), MP = clean(process.env.MAIL_PASS)

async function kvGet(id) {
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${id}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
  const rows = r.ok ? await r.json() : []
  try { return rows[0]?.data?.v ? JSON.parse(rows[0].data.v) : null } catch (_) { return null }
}
async function kvPut(id, obj, editor) {
  await fetch(`${SB_URL}/rest/v1/pm_documents`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor, updated_at: new Date().toISOString() }),
  })
}
const connect = async () => {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: MU, pass: MP }, logger: false })
  await client.connect()
  return client
}
async function specialPaths(client) {
  const out = {}
  for (const mb of await client.list()) {
    if (mb.specialUse === '\\Trash') out.trash = mb.path
    if (mb.specialUse === '\\All') out.all = mb.path
  }
  return out
}

// 掃收件匣 → 來源彙總 + 最近信件清單
async function doScan(days) {
  const client = await connect()
  const mails = []
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true })
      if (uids && uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
          const fr = msg.envelope?.from?.[0] || {}
          mails.push({
            uid: msg.uid,
            from: (fr.address || '').toLowerCase(),
            name: fr.name || '',
            subject: msg.envelope?.subject || '',
            date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString().slice(0, 10) : '',
          })
        }
      }
    } finally { lock.release() }
  } finally { await client.logout().catch(() => {}) }
  mails.sort((a, b) => (a.date < b.date ? 1 : -1))
  const agg = {}
  mails.forEach(m => {
    const a = agg[m.from] = agg[m.from] || { from: m.from, name: m.name, count: 0, latest: '', sample: '' }
    a.count++
    if (m.date > a.latest) { a.latest = m.date; a.sample = m.subject; if (m.name) a.name = m.name }
  })
  const senders = Object.values(agg).sort((a, b) => b.count - a.count)
  const scan = { scannedAt: new Date().toISOString(), days, inboxCount: mails.length, senders, mails: mails.slice(0, 400) }
  await kvPut('sp_lw_pm_mail_scan', scan, '信箱掃描')
  return { inboxCount: mails.length, senders: senders.length }
}

// 套用規則（範圍：收件匣＋重要郵件＋使用者自建資料夾；keep=白名單優先；目標標籤資料夾本身不掃避免自轉）
async function doApply(days) {
  const rulesDoc = (await kvGet('sp_lw_pm_mail_rules')) || { rules: [] }
  const rules = (rulesDoc.rules || []).filter(r => r.enabled !== false && r.match)
  if (!rules.length) return { skipped: '沒有啟用中的規則' }
  const keeps = rules.filter(r => r.action === 'keep')
  const acts = rules.filter(r => r.action !== 'keep')
  if (!acts.length) return { skipped: '只有保留規則，無需動作' }
  const hit = (r, m) => {
    const t = (r.field === 'subject' ? m.subject : r.field === 'to' ? (m.to || '') : (m.from + ' ' + m.name)).toLowerCase()
    return r.match.toLowerCase().split('|').some(k => k.trim() && t.includes(k.trim()))
  }
  const client = await connect()
  const perRule = []
  let moved = 0
  try {
    const sp = await specialPaths(client)
    // 掃描範圍：收件匣 + 重要郵件(\Important) + 使用者自建資料夾；排除規則目標標籤/系統資料夾/Notes
    const targets = new Set(acts.filter(r => r.action === 'label').map(r => (r.label || '').trim()).filter(Boolean))
    const boxes = ['INBOX']
    for (const mb of await client.list()) {
      if (mb.flags && mb.flags.has && mb.flags.has('\\Noselect')) continue
      // Gmail「重要郵件」的 \Important 是非標準旗標，imapflow 不會放進 specialUse → 要看 flags
      if (mb.specialUse === '\\Important' || (mb.flags && mb.flags.has && mb.flags.has('\\Important'))) { boxes.push(mb.path); continue }
      if (mb.specialUse === '\\Junk') { boxes.push(mb.path); continue } // 垃圾郵件夾也套規則（配合「收件人」規則清掉外洩地址的信）
      if (mb.specialUse || mb.path === 'INBOX' || mb.path === 'Notes') continue
      if (/^\[Gmail\]/.test(mb.path)) continue
      if (targets.has(mb.path)) continue
      boxes.push(mb.path)
    }
    for (const box of boxes) {
      const lock = await client.getMailboxLock(box)
      const plan = {} // ruleId → {uids, samples, rule}
      try {
        const uids = await client.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true })
        if (uids && uids.length) {
          for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
            const fr = msg.envelope?.from?.[0] || {}
            const m = { from: (fr.address || '').toLowerCase(), name: fr.name || '', subject: msg.envelope?.subject || '', to: (msg.envelope?.to || []).map(x => x.address || '').join(' ').toLowerCase() }
            if (keeps.some(r => hit(r, m))) continue // 白名單：永不動
            const r = acts.find(r2 => hit(r2, m))
            if (!r) continue
            const pl = plan[r.id] = plan[r.id] || { uids: [], samples: [], rule: r }
            pl.uids.push(msg.uid)
            if (pl.samples.length < 5) pl.samples.push(m.subject.slice(0, 40))
          }
        }
        for (const pl of Object.values(plan)) {
          const r = pl.rule
          let dest = ''
          if (r.action === 'delete') dest = sp.trash || '[Gmail]/Trash'
          else if (r.action === 'archive') dest = sp.all || '[Gmail]/All Mail'
          else if (r.action === 'label') {
            dest = (r.label || '自動分類').trim()
            try { await client.mailboxCreate(dest) } catch (_) {} // 已存在會丟錯，忽略
          }
          if (!dest || dest === box || !pl.uids.length) continue
          // 直接刪除的垃圾信：先標已讀再進垃圾桶 → 垃圾桶不會掛未讀數字引人去點
          if (r.action === 'delete') { try { await client.messageFlagsAdd(pl.uids, ['\\Seen'], { uid: true }) } catch (_) {} }
          await client.messageMove(pl.uids, dest, { uid: true })
          moved += pl.uids.length
          const ex = perRule.find(x => x.ruleId === r.id && x.action === r.action)
          if (ex) { ex.count += pl.uids.length } else perRule.push({ ruleId: r.id, rule: r.note || r.match, action: r.action, label: r.label || '', count: pl.uids.length, samples: pl.samples })
          r.hits = (r.hits || 0) + pl.uids.length
        }
      } finally { lock.release() }
    }
    // 垃圾郵件夾智慧清理：Gmail 已判垃圾 ＋（收件人不是本人 或 寄件網域是亂碼TLD）→ 直接進垃圾桶（標已讀）
    // 亂碼垃圾每封換寄件位址，規則比對不到，用特徵判讀；真正寄「給你」而被誤判的信會留在垃圾郵件夾等你看
    try {
      const junk = (await client.list()).find(mb => mb.specialUse === '\\Junk')
      if (junk) {
        const lock2 = await client.getMailboxLock(junk.path)
        try {
          const TLDS = new Set(['com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'tw', 'jp', 'kr', 'cn', 'hk', 'sg', 'us', 'uk', 'de', 'fr', 'ca', 'au', 'app', 'dev', 'ai', 'me', 'info', 'biz', 'cc', 'tv', 'xyz', 'club', 'shop', 'online', 'site', 'store', 'email', 'cloud', 'life', 'world', 'today', 'news', 'gg', 'ly', 'to'])
          const mine = MU.toLowerCase()
          const uidsJ = await client.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true })
          const kill = [], samples = []
          if (uidsJ && uidsJ.length) {
            for await (const msg of client.fetch(uidsJ, { envelope: true }, { uid: true })) {
              const toStr = (msg.envelope?.to || []).map(x => (x.address || '').toLowerCase()).join(' ')
              const fromAd = (msg.envelope?.from?.[0]?.address || '').toLowerCase()
              const tld = (fromAd.split('.').pop() || '').replace(/[^a-z]/g, '')
              const notMine = !toStr.includes(mine)          // 收件人偽造（me@aol.com 之類）＝必為垃圾
              const weirdTld = tld && !TLDS.has(tld)          // 寄件網域亂碼（.fnq/.ejg 之類）
              if (notMine || weirdTld) { kill.push(msg.uid); if (samples.length < 5) samples.push((msg.envelope?.subject || '').slice(0, 36)) }
            }
          }
          if (kill.length) {
            try { await client.messageFlagsAdd(kill, ['\\Seen'], { uid: true }) } catch (_) {}
            await client.messageMove(kill, sp.trash || '[Gmail]/Trash', { uid: true })
            moved += kill.length
            perRule.push({ ruleId: '__junk_ai__', rule: '垃圾夾智慧清理(亂碼寄件/偽造收件)', action: 'delete', label: '', count: kill.length, samples })
          }
          // 剩下的（真的寄給你、只是被 Gmail 誤判的）標已讀就好，不掛未讀數
          const un = await client.search({ seen: false }, { uid: true })
          if (un && un.length) { await client.messageFlagsAdd(un, ['\\Seen'], { uid: true }); DBG.boxes.push('junk-seen:' + un.length) }
        } finally { lock2.release() }
      }
    } catch (_) {}
  } finally { await client.logout().catch(() => {}) }
  if (perRule.length) {
    rulesDoc.updatedAt = new Date().toISOString()
    await kvPut('sp_lw_pm_mail_rules', rulesDoc, '規則命中數更新')
    const log = (await kvGet('sp_lw_pm_mail_log')) || { items: [] }
    log.items = [{ ts: new Date().toISOString(), moved, perRule }, ...(log.items || [])].slice(0, 60)
    await kvPut('sp_lw_pm_mail_log', log, '信箱規則執行')
  }
  return { moved, perRule }
}

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(200).json({ ok: false, error: '缺 Supabase 設定' })
  if (!MU || !MP) return res.status(200).json({ ok: false, error: '缺信箱憑證' })
  const action = String(req.query?.action || 'apply') // cron 每小時直打不帶參數＝套用規則
  const days = Math.min(3650, Math.max(1, parseInt(req.query?.days || (action === 'scan' ? '90' : '2'), 10) || 2))
  try {
    if (action === 'scan') return res.status(200).json({ ok: true, ...(await doScan(days)) })
    if (action === 'apply') return res.status(200).json({ ok: true, ...(await doApply(days)) })
    return res.status(200).json({ ok: false, error: '未知 action' })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) })
  }
}
