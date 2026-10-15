// 信箱中樞 mailhub 的讀寫路線（abgd 搬家 B 模式，v4.71.108）：
//   域還在 GD＝照舊讀寫 GD KV（kvPut 存不進去改成丟錯，不再假裝成功）
//   域在新殼＝讀走新殼 /api/core/gdread（簽章、帶版本號）、寫走命令橋 put（帶讀到的版本號；對不上＝有人同時在改 → 丟錯請重試）
//   切換中（凍結）＝可讀不可寫
// IMAP、密碼加解密（MAIL_ENC_KEY）仍在 GD 執行；新殼不拿這些金鑰
import crypto from 'node:crypto'
import { SB_URL, svc } from './_onboard.js'
const PREFIX = 'sp_finance_pm_mailhub'
const BUSY = '信箱中樞正在切換，請稍後再試'
async function owner() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_domain_lock?select=prefix,owner`, { headers: svc, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return 'unknown'
    const hit = (await r.json()).filter(l => PREFIX.startsWith(l.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
    return hit ? hit.owner : 'gd'
  } catch (_) { return 'unknown' }
}
const base = () => (process.env.ABGD_BASE_URL || 'https://ab-gd.vercel.app').replace(/\/$/, '')
const sign = (body) => crypto.createHmac('sha256', (process.env.BRIDGE_SECRET || '').trim()).update(body).digest('base64url')
export async function mhKv(nativeGet, nativePut, operator) {
  const ow = await owner()
  if (ow === 'gd') return { mode: 'gd', kvGet: nativeGet, kvPut: async (k, v, ed) => { if (!(await nativePut(k, v, ed))) throw new Error(BUSY); return true } }
  if (ow !== 'abgd') return { mode: 'frozen', kvGet: nativeGet, kvPut: async () => { throw new Error(BUSY) } }
  if (!(process.env.BRIDGE_SECRET || '').trim()) throw new Error('新版連線金鑰未設定')
  const revs = {}
  const kvGet = async (k) => {
    const body = JSON.stringify({ keys: [k], ts: Date.now() })
    const r = await fetch(base() + '/api/core/gdread', { method: 'POST', headers: { 'content-type': 'application/json', 'x-abgd-sig': sign(body) }, body, signal: AbortSignal.timeout(15000) })
    const j = await r.json().catch(() => ({}))
    if (!j.ok) throw new Error('讀新版資料失敗：' + (j.error || r.status))
    const g = (j.docs || {})[k] || {}
    revs[k] = Number(g.rev) || 0
    return g.exists ? g.doc : null
  }
  const kvPut = async (k, v) => {
    if (!(k in revs)) await kvGet(k) // 整份覆寫（例：掃描結果）也要帶目前版本號
    const body = JSON.stringify({ idem: 'mh-' + crypto.randomUUID(), domain: 'mailhub', action: 'put', args: { key: k, doc: v, baseRev: revs[k] }, operator: String(operator || '系統').slice(0, 30) })
    const r = await fetch(base() + '/api/core/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-abgd-sig': sign(body) }, body, signal: AbortSignal.timeout(20000) })
    const j = await r.json().catch(() => ({}))
    if (j.ok) { revs[k] = Number(j.rev) || revs[k] + 1; return true }
    throw new Error(j.text || j.error || '存不進新版，請稍後再試')
  }
  return { mode: 'abgd', kvGet, kvPut }
}
