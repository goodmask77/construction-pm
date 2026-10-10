// 💬 聊天室 v4.70.45（溝通中樞項目 3a「個人聊天室」：張良 2026-10-10 裁決「像 Google Chat：內部工作討論分不同聊天室提出需求、主管看見回覆、部分授權 AI」；10-11 深夜「繼續下階段」開工）
// 設計：
//  - 聊天室清單一個鍵 pm_chat_rooms；訊息「一則一列」pm_chatm_<room>_<ts36><rand>（只插入不改寫＝兩人同時講不互蓋，同 1a 健康紀錄作法）
//  - 已讀每人一鍵 pm_chat_read_<rid>（{ [room]: lastTs }）
//  - 身分走 sopWho（/prep 綁定 token）；主管（審核人／張良瑋／角色主管／perm admin）看得到所有聊天室；一般人只看自己是成員的
//  - 預設聊天室：「全體」(id=all，人人都在)＋每人一間「個人聊天室」(id=p_<rid>，本人＋主管)
//  - 通知：新訊息→wpPush（鈴鐺＋手機推播）給該室成員（發話者除外）；個人室的夥伴發話另 LINE 私訊審核人（通知鐵則：關鍵節點加 LINE）
//  - @DD：訊息含 @DD → 走 AI 中樞 route=app 回一則（先只用本室對話脈絡；接公司資料＝項目 4 共用 AI 大腦）
//  - 這一版先輪詢（三家審查共識：第一版輪詢不做即時連線）
import { SB_URL, SB_KEY } from './_onboard.js'

const H = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' })
const esc = (s) => String(s).replace(/[\\%_]/g, (m) => '\\' + m)
const tpe = (t) => new Date((t || Date.now()) + 8 * 3600e3).toISOString()
async function kvGetMany(ids) {
  if (!SB_URL || !SB_KEY || !ids.length) return {}
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,data`, { headers: H() })
    const rows = r.ok ? await r.json() : []
    const out = {}; rows.forEach((row) => { if (row?.data?.v) { try { out[row.id] = JSON.parse(row.data.v) } catch (_) {} } }); return out
  } catch (_) { return {} }
}
async function kvSet(id, obj, editor) {
  await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: editor || '聊天室', updated_at: new Date().toISOString() }) })
}
async function kvInsert(id, obj, editor) { // 只插入（訊息）
  await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: editor || '聊天室', updated_at: new Date().toISOString() }) })
}
async function kvLike(prefix, limit) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=like.${encodeURIComponent(esc(prefix))}*&select=id,data&order=id.desc&limit=${limit || 300}`, { headers: H() })
    const rows = r.ok ? await r.json() : []
    const out = []; rows.forEach((row) => { if (row?.data?.v) { try { out.push(JSON.parse(row.data.v)) } catch (_) {} } }); return out
  } catch (_) { return [] }
}

const ROOMS_KEY = 'pm_chat_rooms'
const readKey = (rid) => 'pm_chat_read_' + rid
const msgKey = (room, t) => `pm_chatm_${room}_${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ridOf = (who) => String(who.rid || who.uid || '')
const idsOf = (who) => [...new Set([ridOf(who), ...((who.ids || []).map(String))].filter(Boolean))] // 同一人多裝置多個身分 id（桌面/手機各綁一組）

export function isMgr(who, apr, pm) { return !!who && (apr.includes(who.name) || who.name === '張良瑋' || who.role === '主管' || (((pm || {}).users || {})[who.rid || who.uid] || {}).admin) }

async function loadRooms() { const d = (await kvGetMany([ROOMS_KEY]))[ROOMS_KEY]; return d && Array.isArray(d.rooms) ? d : { rooms: [] } }
function ensureDefaults(doc, who) {
  let dirty = false
  if (!doc.rooms.find(r => r.id === 'all')) { doc.rooms.unshift({ id: 'all', name: '全體', kind: 'all', members: [], createdBy: 'system', ts: tpe() }); dirty = true }
  const rid = ridOf(who)
  if (rid && !doc.rooms.find(r => r.kind === 'personal' && (r.owner === rid || r.ownerName === who.name || idsOf(who).includes(r.owner)))) { doc.rooms.push({ id: 'p_' + rid, name: `${who.name} 與主管`, kind: 'personal', owner: rid, ownerName: who.name, members: [rid], createdBy: 'system', ts: tpe() }); dirty = true }
  return dirty
}
const canSee = (room, who, mgr) => mgr || room.kind === 'all' || (room.kind === 'personal' && room.ownerName === who.name) || (room.members || []).some(x => idsOf(who).includes(x))

// 清單：我看得到的聊天室＋最後一則＋未讀
export async function listRooms({ who, mgr, roster }) {
  const rid = ridOf(who)
  const doc = await loadRooms()
  if (ensureDefaults(doc, who)) await kvSet(ROOMS_KEY, doc)
  const rooms = doc.rooms.filter(r => canSee(r, who, mgr))
  const [readDoc, recent] = await Promise.all([kvGetMany([readKey(rid)]).then(d => d[readKey(rid)] || {}), kvLike('pm_chatm_', 600)])
  const byRoom = {}; recent.forEach(m => { (byRoom[m.room] = byRoom[m.room] || []).push(m) })
  const out = rooms.map(r => {
    const ms = (byRoom[r.id] || []).sort((a, b) => (a.t < b.t ? 1 : -1))
    const last = ms[0] || null; const rd = readDoc[r.id] || ''
    const mine = idsOf(who); const unread = ms.filter(m => m.t > rd && !mine.includes(m.rid)).length
    const names = (r.members || []).map(x => (roster.find(p => p.rid === x) || {}).name || x)
    return { id: r.id, name: r.name, kind: r.kind, members: r.members || [], memberNames: names, owner: r.owner || null, last: last ? { text: String(last.text || '').slice(0, 60), name: last.name, t: last.t } : null, unread, lastT: last ? last.t : r.ts }
  })
  // 排序：個人室（本人）最前、再依最後訊息時間
  out.sort((a, b) => (a.id === 'p_' + rid ? -1 : b.id === 'p_' + rid ? 1 : String(b.lastT).localeCompare(String(a.lastT))))
  return out
}
export async function getMsgs({ who, mgr, room, after, markRead }) {
  const rid = ridOf(who)
  const doc = await loadRooms(); const r = doc.rooms.find(x => x.id === room)
  if (!r || !canSee(r, who, mgr)) return { ok: false, error: '沒有這個聊天室或你不在裡面' }
  let list = await kvLike('pm_chatm_' + room + '_', 200)
  list.sort((a, b) => String(a.t).localeCompare(String(b.t)))
  if (after) list = list.filter(m => m.t > after)
  if (markRead && list.length) { const k = readKey(rid); const rd = (await kvGetMany([k]))[k] || {}; rd[room] = list[list.length - 1].t; await kvSet(k, rd) }
  return { ok: true, room: { id: r.id, name: r.name, kind: r.kind, members: r.members || [] }, list }
}
export async function markRead({ who, room }) { const rid = ridOf(who); const k = readKey(rid); const rd = (await kvGetMany([k]))[k] || {}; rd[room] = tpe(); await kvSet(k, rd); return { ok: true } }

export async function sendMsg({ who, mgr, room, text, roster, notify, aiCall }) {
  const rid = ridOf(who); text = String(text || '').trim().slice(0, 4000)
  if (!text) return { ok: false, error: '沒有內容' }
  const doc = await loadRooms(); const r = doc.rooms.find(x => x.id === room)
  if (!r || !canSee(r, who, mgr)) return { ok: false, error: '沒有這個聊天室或你不在裡面' }
  const now = Date.now(); const m = { id: msgKey(room, now), room, rid, name: who.name, text, t: tpe(now), kind: 'text' }
  await kvInsert(m.id, m, who.name)
  // 已讀自己
  try { const k = readKey(rid); const rd = (await kvGetMany([k]))[k] || {}; rd[room] = m.t; await kvSet(k, rd) } catch (_) {}
  // 通知（發話者除外）：全體→全部；個人室→本人＋主管；群→成員（主管若非成員也不吵）
  try {
    const mgrRids = roster.filter(p => p.mgr).map(p => p.rid)
    let to = r.kind === 'all' ? null : r.kind === 'personal' ? [...new Set([...(r.members || []), ...mgrRids])] : (r.members || [])
    if (to) to = to.filter(x => x !== rid)
    if (!to || to.length) await notify(to, { title: `💬 ${r.name}`, body: `${who.name}：${text.slice(0, 120)}`, url: '/prep#chat=' + room, cat: 'chat' }, { personalFromCrew: r.kind === 'personal' && !mgr, text, who, roomName: r.name })
  } catch (_) {}
  // @DD
  let ai = null
  if (/@\s*DD/i.test(text) && aiCall) {
    try {
      const hist = (await kvLike('pm_chatm_' + room + '_', 20)).sort((a, b) => String(a.t).localeCompare(String(b.t)))
      const convo = hist.map(x => `${x.name}：${x.text}`).join('\n')
      const sys = `你是「DD」，喬亞國際餐飲團隊（GROUN:D／A Beach）的內部小幫手，現在在 app 的聊天室「${r.name}」被 @ 到。用繁體中文、口語、簡短回答；這一版你「沒有」公司資料查詢能力（之後會接），被問到營收/班表/叫貨/人員資料時老實說「這裡我還查不到，LINE 私訊我可以查」，不要編數字。只回答最後被 @ 的那一句，必要時參考前面的對話脈絡。`
      const rr = await aiCall('app', { system: sys, messages: [{ role: 'user', content: `【本室最近對話】\n${convo}\n\n【被 @ 的訊息】${who.name}：${text}` }], maxTokens: 600 })
      const at = Date.now() + 1; ai = { id: msgKey(room, at), room, rid: 'dd', name: 'DD', text: String(rr.text || '').trim().slice(0, 2000) || '（沒有內容）', t: tpe(at), kind: 'text' }
      await kvInsert(ai.id, ai, 'DD')
    } catch (e) { ai = null }
  }
  return { ok: true, msg: m, ai }
}
export async function roomOp({ who, mgr, op, room, name, members }) {
  const rid = ridOf(who); const doc = await loadRooms()
  if (op === 'create') {
    const nm = String(name || '').trim().slice(0, 40); if (!nm) return { ok: false, error: '要取名字' }
    const mem = [...new Set([rid, ...(Array.isArray(members) ? members.map(String) : [])])]
    const id = 'g' + Date.now().toString(36)
    doc.rooms.push({ id, name: nm, kind: 'group', members: mem, createdBy: rid, ts: tpe() }); await kvSet(ROOMS_KEY, doc)
    await kvInsert(msgKey(id, Date.now()), { id: 'sys', room: id, rid: 'sys', name: '系統', text: `${who.name} 建立了聊天室`, t: tpe(), kind: 'sys' }, who.name)
    return { ok: true, id }
  }
  const r = doc.rooms.find(x => x.id === room); if (!r) return { ok: false, error: '沒有這個聊天室' }
  if (r.kind !== 'group') return { ok: false, error: '預設聊天室不能改' }
  if (!(mgr || r.createdBy === rid)) return { ok: false, error: '只有建立者或主管能改' }
  if (op === 'rename') { r.name = String(name || '').trim().slice(0, 40) || r.name }
  else if (op === 'members') { r.members = [...new Set([r.createdBy, ...(Array.isArray(members) ? members.map(String) : [])])] }
  else if (op === 'delete') { doc.rooms = doc.rooms.filter(x => x.id !== room) }
  else return { ok: false, error: '不認識的操作' }
  await kvSet(ROOMS_KEY, doc); return { ok: true }
}
