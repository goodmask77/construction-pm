// GROUN:D 退單／作廢偵測（v4.71.6 張良 2026-10-12「退單作廢的詳細數字能抓出來另外表示嗎 每一筆都要清楚 才知道問題在哪 以後也可能會發生」）
// 真因背景：10/12 熱力圖 16 時空格＝喬亞時段表那小時是 −6,090（2 筆退單／作廢），舊程式把 ≤0 的時段當沒資料丟掉。
// 喬亞「行動報表」只有日彙總、沒有逐筆訂單頁（已翻遍 15 個報表頁＋試探 17 個可能網址都 404），所以逐筆只能從兩個線索推：
//   ① 時段表負數：喬亞每小時「營業額」出現負值＝那小時有退單／作廢（金額＋單數準確；品項不知道）
//   ② 盤中 15 分快照相減：營收／單數／某品項累計「變少」＝那 15 分內有人退單／作廢（時間精確到 15 分、品項推估得到）
//   真正逐筆（單號／誰操作／原因）要喬亞 POS 後台的作廢報表，行動報表拿不到——需張良向喬亞要。
// 存放：月檔 sp_finance_pm_pos_void_YYYY-MM = { days: { [date]: { snap:[{t,at,rev,tx,items:{name:-q}}], hours:[{h,amt,orders}] } } }
//   snap＝由該日全部快照重算整份蓋掉（冪等）；hours＝每次拿到最新時段表就整份蓋掉。
//   日結後 opsboard 另外直接從日結明細的時段表算 hours（舊日子也看得到，不靠這個月檔）。

import crypto from 'node:crypto'
export const VOID_KEY = (ym) => 'sp_finance_pm_pos_void_' + ym

// ② 快照相減：qdoc.slots=[{t:'11:00',at:'11:03',rev,tx,items:{name:q}}]（items 只收 q>0）
export function voidsFromSnapshots(qdoc) {
  const slots = [...(((qdoc || {}).slots) || [])].filter(s => s && s.t).sort((a, b) => (a.t < b.t ? -1 : 1))
  const out = []
  for (let i = 1; i < slots.length; i++) {
    const p = slots[i - 1], c = slots[i]
    const dRev = (Number(c.rev) || 0) - (Number(p.rev) || 0)
    const dTx = (Number(c.tx) || 0) - (Number(p.tx) || 0)
    const items = {}
    for (const [n, q] of Object.entries(p.items || {})) { const dq = (Number((c.items || {})[n]) || 0) - (Number(q) || 0); if (dq < 0) items[n] = dq }
    if (dRev < 0 || dTx < 0 || Object.keys(items).length) out.push({ t: c.t, at: c.at || c.t, prev: p.t, rev: dRev, tx: dTx, items })
  }
  return out
}

// ① 時段表負數：slots=[[hour, amt, orders]]（_joya parseTimeslots 形狀）或日結明細 rows=[['16:00', orders, amt]]
export function negHoursFromSlots(slots) {
  return (slots || []).filter(r => Array.isArray(r) && Number(r[1]) < 0).map(r => ({ h: Number(r[0]), amt: Number(r[1]), orders: Number(r[2]) || 0 }))
}
export function negHoursFromSheetRows(rows) {
  const out = []
  for (const r of (rows || [])) { const h = parseInt(r[0]); const amt = Number(r[r.length - 1]) || 0; if (!isNaN(h) && amt < 0) out.push({ h, amt, orders: Number(r[1]) || 0 }) }
  return out
}

// 寫入月檔（整份蓋該日）；回傳「這次新出現的快照事件」（給通知用）
export async function recordVoidDay({ kvGet, kvPut, date, qdoc, slots, hours, editor }) {
  const key = VOID_KEY(date.slice(0, 7))
  const doc = (await kvGet(key)) || { days: {} }
  const prev = doc.days[date] || {}
  const snap = qdoc ? voidsFromSnapshots(qdoc) : (prev.snap || [])
  const hrs = hours || (slots ? negHoursFromSlots(slots) : (prev.hours || []))
  const seen = new Set((prev.snap || []).map(e => e.t))
  const fresh = snap.filter(e => !seen.has(e.t))
  const changed = JSON.stringify({ a: prev.snap || [], b: prev.hours || [] }) !== JSON.stringify({ a: snap, b: hrs })
  if (changed) {
    doc.days[date] = { ...prev, ntf: Array.isArray(prev.ntf) ? prev.ntf : (prev.snap || []).map(e => e.t), snap, hours: hrs, updatedAt: new Date().toISOString() } // ntf＝已通知的快照時點：新的一天＝[]；改版前的舊資料＝當時已有的事件當已通知（這次新記到的不算；關卡 3 pos 第二輪 A1）
    doc.updatedAt = new Date().toISOString()
    await kvPut(key, doc, editor || '退單偵測 ' + date)
  }
  return { fresh, snap, hours: hrs, changed }
}

// 通知文字（私訊審核人；金額敏感不進群）
export function voidAlertText(date, ev) {
  const its = Object.entries(ev.items || {}).map(([n, q]) => `${n} ${q}`).join('、')
  return `⚠️ GD 疑似退單／作廢（${date.slice(5)} ${ev.prev}～${ev.t}）\n營收 ${ev.rev > 0 ? '+' : ''}${ev.rev.toLocaleString()}　單數 ${ev.tx > 0 ? '+' : ''}${ev.tx}${its ? `\n品項（推估）：${its}` : ''}\n（15 分快照相減推估；同時段若有新單會互相抵銷，實際退的可能更多。/prep 首頁「退單／作廢紀錄」可看）`
}

// 退單私訊（v4.71.186）：只送「營收真的變少、還沒通知過」的快照事件；每個事件×每位審核人帶固定 LINE 重送識別碼（重送／重做 LINE 去重）；
//   全部審核人都送達（2xx 或 409＝同識別碼已收過）才記進 ntf；沒送成的下一輪補送。舊資料沒有 ntf＝第一次遇到時現有事件一律當已通知（不補發改版前的）
//   必須在所有銷售數據寫入完成之後呼叫（後面不再有寫入＝不會因撞版本整段重做而重發；記 ntf 撞版本重做也靠識別碼去重）
const uuidOf = (s) => { const h = crypto.createHash('sha256').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
export async function notifyVoidDay({ kvGet, kvPut, date, approvers, token, send }) {
  const key = VOID_KEY(date.slice(0, 7))
  const doc = (await kvGet(key)) || { days: {} }
  const day = (doc.days || {})[date]; if (!day) return { sent: 0 }
  if (!Array.isArray(day.ntf)) { day.ntf = (day.snap || []).map(e => e.t); doc.updatedAt = new Date().toISOString(); await kvPut(key, doc, '退單通知（建立已通知清單）'); return { sent: 0, init: day.ntf.length } }
  const tries = day.ntfTry || {}
  const pend = (day.snap || []).filter(e => e.rev < 0 && !day.ntf.includes(e.t) && (Number(tries[e.t]) || 0) < 8).slice(0, 3) // 同一事件最多試 8 次（永久錯誤不無限重試；Gemini 第二輪）
  if (!pend.length || !token || !approvers.length) return { sent: 0 }
  const ok = [], fail = []
  for (const ev of pend) {
    let all = true
    for (const ap of approvers) { try { const r = await send(ap, ev, uuidOf(date + '|' + ev.t + '|' + ap)); if (!(r && (r.ok || r.status === 409))) all = false } catch (_) { all = false } }
    if (all) ok.push(ev.t); else fail.push(ev.t)
  }
  day.ntf = [...day.ntf, ...ok]; day.ntfTry = { ...tries }; for (const t of fail) { day.ntfTry[t] = (Number(day.ntfTry[t]) || 0) + 1; if (day.ntfTry[t] >= 8) console.log('[voids] 退單通知試 8 次都沒送成，放棄', date, t) }
  doc.updatedAt = new Date().toISOString(); await kvPut(key, doc, ok.length ? '退單通知（已送）' : '退單通知（待重試）')
  return { sent: ok.length, pending: fail.length }
}
