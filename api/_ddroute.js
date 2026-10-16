// DD 搬家第 0 批（docs/ABGD_DD_PLAN.md v2，新殼 repo）：事件分類＋歸屬＋「只算不發」轉交
//   ddClassify(ev)：純函式，事件 → 路由名（第 0 批只用來記錄與比對；之後的批次依 sp_finance_pm_ddroutes.routes 決定 owner）
//   歸屬一次決定、寫在事件台帳 pm_ddev_<webhookEventId>（只新增）：第 0 批 owner 一律 gd
//   影子轉交：設定 sp_finance_pm_ddroutes.shadow===true 時，把「分類＋來源＋驗簽結果＋文字雜湊／長度」（不送原文）轉給新殼 /api/dd/enqueue（mode=shadow），新殼只算權限、不發不寫
import crypto from 'node:crypto'
const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '')
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '')
const ABGD = (process.env.ABGD_BASE_URL || 'https://ab-gd.vercel.app').trim().replace(/\/+$/, '')
export const DD_ROUTE_VER = 1

export function ddClassify(ev) {
  const t = ev && ev.type
  if (t === 'unsend' || t === 'join' || t === 'leave' || t === 'follow' || t === 'unfollow' || t === 'memberJoined' || t === 'memberLeft') return t.toLowerCase()
  if (t === 'postback') { const d = String((ev.postback && ev.postback.data) || ''); if (/^cf\|/.test(d)) return 'pb_confirm'; if (/^pi\|/.test(d)) return 'pb_issue'; if (/^bd\|/.test(d)) return 'pb_bind'; return 'pb_card' }
  if (t !== 'message') return 'other'
  const m = ev.message || {}
  if (m.type === 'image' || m.type === 'file' || m.type === 'video') return 'media'
  if (m.type !== 'text') return 'msg_other'
  const s = String(m.text || '').trim()
  if (/^(心得|日誌|工作日誌)/.test(s)) return 'journal'
  if (/^(轉給|轉告|交給|丟給)\s*CC/i.test(s)) return 'cc'
  if (/綁定/.test(s)) return 'bind'
  if (/^(我的連結|個人連結|連結|登入|重新登入|登入碼|登入連結)$/.test(s) || /報到/.test(s)) return 'login'
  if (/^(記住|忘記|看記事本|記事本)/.test(s)) return 'memo'
  if (/密碼/.test(s) && /^(記|查|刪|密碼清單)/.test(s)) return 'vault'
  if (/^(確認|取消)$/.test(s) || /^DD\s*(確認|取消)$/i.test(s)) return 'confirm'
  if (/^(今日任務|任務卡)$/.test(s)) return 'todaycard'
  if (/文件庫|檔案庫|相簿|存到|撈檔/.test(s)) return 'files'
  if (/^授權[:：]/.test(s)) return 'auth_code'
  return 'ai'
}

let cfgP = null
async function ddRoutesCfg() { // 每個請求讀一次（模組層快取 30 秒；讀不到＝影子關）
  if (cfgP && cfgP.t > Date.now() - 30e3) return cfgP.v
  let v = {}
  try { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.sp_finance_pm_ddroutes&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(3000) }); const rows = r.ok ? await r.json() : []; v = rows[0] && rows[0].data && rows[0].data.v ? JSON.parse(rows[0].data.v) : {} } catch (_) { v = {} }
  cfgP = { t: Date.now(), v }; return v
}

export function ddSigHeaders(method, path, body) { // 同新殼 lib/dd/sign.ts：方法＋路徑＋時間戳＋一次性編號＋body 雜湊
  const ts = String(Date.now()), nonce = crypto.randomBytes(18).toString('base64url')
  const base = [method.toUpperCase(), path, ts, nonce, crypto.createHash('sha256').update(body).digest('hex')].join('\n')
  const sig = crypto.createHmac('sha256', (process.env.BRIDGE_SECRET || '').trim()).update(base).digest('base64url')
  return { 'content-type': 'application/json', 'x-dd-ts': ts, 'x-dd-nonce': nonce, 'x-dd-kid': 'b1', 'x-dd-sig': sig }
}

// 影子轉交：失敗只記 log（影子不影響正式處理）；最多等 2.5 秒
export async function ddShadow(ev, route, sigOK) {
  try {
    const eid = String(ev.webhookEventId || '')
    if (!eid || !(process.env.BRIDGE_SECRET || '').trim()) return
    const cfg = await ddRoutesCfg(); if (cfg.shadow !== true) return
    const txt = ev.type === 'message' && ev.message && ev.message.type === 'text' ? String(ev.message.text || '') : ''
    const s = ev.source || {}
    const body = JSON.stringify({ eventId: eid, mode: 'shadow', route, payload: { source: { type: s.type, userId: s.userId, groupId: s.groupId, roomId: s.roomId }, sigOK, gdRoute: route, type: ev.type, textLen: txt.length, textHash: txt ? crypto.createHash('sha256').update(txt).digest('hex').slice(0, 16) : '' } })
    const r = await fetch(ABGD + '/api/dd/enqueue', { method: 'POST', headers: ddSigHeaders('POST', '/api/dd/enqueue', body), body, signal: AbortSignal.timeout(2500) })
    if (!r.ok) console.log('[dd] 影子轉交失敗', r.status, (await r.text()).slice(0, 120))
  } catch (e) { console.log('[dd] 影子轉交失敗', e && e.message) }
}
