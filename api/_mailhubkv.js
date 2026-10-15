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
// guard：真的搬信（IMAP 寫入）之前呼叫——資料歸屬跟開始時一樣、新殼的切換驗收閘門放行（域在新殼時）才回 null；否則回原因（不准動）（關卡 3 mailhub 第一輪 OpenAI A1／A2）
async function gateCheck(operator) {
  try {
    const body = JSON.stringify({ op: 'gate', operator: String(operator || '系統').slice(0, 30), ts: Date.now() })
    const r = await fetch(base() + '/api/core/gdread', { method: 'POST', headers: { 'content-type': 'application/json', 'x-abgd-sig': sign(body) }, body, signal: AbortSignal.timeout(10000) })
    const j = await r.json().catch(() => ({}))
    if (!j.ok) return '查不到切換驗收狀態，這次先不搬信'
    return j.gate || null
  } catch (_) { return '查不到切換驗收狀態，這次先不搬信' }
}
export async function mhKv(nativeGet, nativePut, operator) {
  const ow = await owner()
  const guard = async () => { const ow2 = await owner(); if (ow2 !== ow || (ow !== 'gd' && ow !== 'abgd')) return '信箱中樞正在切換，這次先不搬信'; return ow === 'abgd' ? gateCheck(operator) : null }
  if (ow === 'gd') return { mode: 'gd', guard, kvGet: nativeGet, kvPut: async (k, v, ed) => { if (!(await nativePut(k, v, ed))) throw new Error(BUSY); return true } }
  if (ow !== 'abgd') return { mode: 'frozen', guard, kvGet: nativeGet, kvPut: async () => { throw new Error(BUSY) } }
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
  return { mode: 'abgd', guard, kvGet, kvPut }
}
