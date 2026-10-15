// abgd 搬家 B 模式通用讀寫路線（v4.71.115；先例＝信箱中樞 _mailhubkv.js）：
//   某個資料域搬到新殼後，GD 端還在跑的功能（DD 對話、排程、卡片按鈕、其他同步）讀寫那個域的文件時，依 pm_domain_lock 自動選路：
//     域在 GD＝照舊讀寫 GD pm_documents（寫入失敗改丟錯，不假裝成功）
//     域在新殼＝讀走新殼 /api/core/gdread（簽章、帶版本號；也可依前綴列出）、寫／刪走命令橋 <域>/put|del（帶讀到的版本號；對不上＝丟錯 stale，呼叫端重讀重做）
//     切換中（凍結）或查不到歸屬＝可讀不可寫
//   用法：const kv = await abgdKv({ domain: 'tasks', lockKey: 'sp_team_pm_task_x', operator: '張良瑋' })；kv.kvGet(k)／kv.kvPut(k, v)／kv.kvDel(k)／kv.kvPrefix(pfx)
//   kv.retry(fn)：撞到「有人同時在改」就重跑整段讀改寫（最多 5 次）
import crypto from 'node:crypto'
import { SB_URL, svc } from './_onboard.js'
const BUSY = (label) => `${label}正在切換，請稍後再試`
async function owner(lockKey) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_domain_lock?select=prefix,owner`, { headers: svc, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return 'unknown'
    const hit = (await r.json()).filter(l => lockKey.startsWith(l.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
    return hit ? hit.owner : 'gd'
  } catch (_) { return 'unknown' }
}
const base = () => (process.env.ABGD_BASE_URL || 'https://ab-gd.vercel.app').replace(/\/$/, '')
const sign = (body) => crypto.createHmac('sha256', (process.env.BRIDGE_SECRET || '').trim()).update(body).digest('base64url')
// ── GD 原生讀寫（pm_documents data.v）──
async function nGet(k) { try { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(k)}&select=data`, { headers: svc }); const rows = r.ok ? await r.json() : []; return rows[0]?.data?.v != null ? JSON.parse(rows[0].data.v) : null } catch (_) { return null } }
async function nPut(k, v, editor) { const r = await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...svc, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: k, data: { v: JSON.stringify(v) }, editor: String(editor || 'abgdkv').slice(0, 60), updated_at: new Date().toISOString() }) }); if (!r.ok) { const tx = await r.text().catch(() => ''); console.log('[abgdkv] 寫入失敗', k, r.status, tx.slice(0, 160)) } return r.ok }
async function nDel(k) { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(k)}`, { method: 'DELETE', headers: svc }); return r.ok }
async function nPrefix(pf) { const like = pf.replace(/[\\%_]/g, m => '\\' + m); const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(like)}*&select=id,data`, { headers: svc }); const rows = r.ok ? await r.json() : []; const out = {}; for (const row of rows) { if (!String(row.id).startsWith(pf) || row?.data?.v == null) continue; try { out[row.id] = JSON.parse(row.data.v) } catch (_) {} } return out }

export async function abgdKv({ domain, lockKey, operator, label = '這項資料' }) {
  const ow = await owner(lockKey)
  const isStale = (e) => /同時在改/.test(String(e && e.message || e))
  const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= 4 || !isStale(e)) throw e; await new Promise(r => setTimeout(r, 150 + Math.random() * 400)) } } }
  if (ow === 'gd') return {
    mode: 'gd', retry,
    kvGet: nGet, kvPrefix: nPrefix,
    kvPut: async (k, v, ed) => { if (!(await nPut(k, v, ed))) throw new Error(BUSY(label)); return true },
    kvDel: async (k) => { if (!(await nDel(k))) throw new Error(BUSY(label)); return true },
  }
  if (ow !== 'abgd') return { mode: 'frozen', retry, kvGet: nGet, kvPrefix: nPrefix, kvPut: async () => { throw new Error(BUSY(label)) }, kvDel: async () => { throw new Error(BUSY(label)) } }
  if (!(process.env.BRIDGE_SECRET || '').trim()) throw new Error('新版連線金鑰未設定')
  const revs = {}
  const read = async (payload) => {
    const body = JSON.stringify({ ...payload, ts: Date.now() })
    const r = await fetch(base() + '/api/core/gdread', { method: 'POST', headers: { 'content-type': 'application/json', 'x-abgd-sig': sign(body) }, body, signal: AbortSignal.timeout(15000) })
    const j = await r.json().catch(() => ({}))
    if (!j.ok) throw new Error('讀新版資料失敗：' + (j.error || r.status))
    return j.docs || {}
  }
  const kvGet = async (k) => { const g = (await read({ keys: [k] }))[k] || {}; revs[k] = Number(g.rev) || 0; return g.exists ? g.doc : null }
  const kvPrefix = async (pf) => { const d = await read({ prefix: pf }); const out = {}; for (const [k, g] of Object.entries(d)) { revs[k] = Number(g.rev) || 0; out[k] = g.doc } return out }
  const cmd = async (action, args) => {
    const body = JSON.stringify({ idem: domain + '-' + crypto.randomUUID(), domain, action, args, operator: String(operator || '系統').slice(0, 30) })
    const r = await fetch(base() + '/api/core/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-abgd-sig': sign(body) }, body, signal: AbortSignal.timeout(20000) })
    const j = await r.json().catch(() => ({}))
    if (j.ok) return j
    throw new Error(j.text || j.error || '存不進新版，請稍後再試')
  }
  const kvPut = async (k, v) => { if (!(k in revs)) await kvGet(k); const j = await cmd('put', { key: k, doc: v, baseRev: revs[k] }); revs[k] = Number(j.rev) || revs[k] + 1; return true }
  const kvDel = async (k) => { if (!(k in revs)) await kvGet(k); const j = await cmd('del', { key: k, baseRev: revs[k] }); revs[k] = Number(j.rev) || revs[k] + 1; return true }
  return { mode: 'abgd', retry, kvGet, kvPrefix, kvPut, kvDel }
}
