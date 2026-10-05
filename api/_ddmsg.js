// DD 自動訊息集中設定（張良 2026-10-06「設定頁管理 DD 所有自動發送：發哪個群／話怎麼講／開關」）
// 設計原則：fail-safe——任何讀取/解析失敗，一律退回這裡的「預設值」，絕不讓通知壞掉。
// 覆蓋值存 KV: sp_finance_pm_ddmsg = { [key]: { on:0|1, group:'family'|'internal'|'happy337'|'<原始gid>', text:'...' } }
// 開關沿用習慣：預設關的(buy)維持關；原本總是發的(會議)預設開。
const CFG_KEY = 'sp_finance_pm_ddmsg'
const FALLBACK_GID = 'Cf7940efc6517b0c084ad2ad496b45f30' // 內部預設群（POS/金額/採購/問題也發這個）

// 群組預設：env 優先 → 群組登記表(pm_group_seen)照名字找 → 寫死退路
export const DD_GROUPS = {
  family:   { label: 'GROUN:D Family 群', env: 'LINE_PREP_GROUP', match: /family/i, fallback: FALLBACK_GID },
  internal: { label: '內部群（預設）', env: 'LINE_DEFAULT_GROUP', fallback: FALLBACK_GID },
  happy337: { label: 'happy337 群（A Beach，實際群名瑞光路337）', match: /happy ?337|337/i, fallback: '' },
}

// 自動訊息登記表：label=人看的名稱、group=預設群、on=預設開關、text=可編輯文字(含 {變數})、vars=變數說明、where=發生情境
export const DD_MSG_DEF = {
  meet_new:   { label: '新會議宣達', group: 'family', on: 1, where: '按「新增會議」時發到群',
    text: '📢 新會議宣達【{type}・{date}】\n{content}\n\n👉 點連結直達，看完按「✅ 確認熟知」完成簽到（{n} 人要簽）\n{link}',
    vars: '{type}=會議類型　{date}=日期　{content}=會議內容　{n}=要簽人數　{link}=直達連結' },
  meet_nudge: { label: '會議3次沒簽·大群點名', group: 'family', on: 1, where: '提醒3次還沒簽→大群點名',
    text: '📣 會議宣達【{type}・{date}】提醒 3 次還沒簽收：{names}\n麻煩今天點連結簽收 🙏\n{link}',
    vars: '{type}　{date}　{names}=還沒簽的人　{link}=直達連結' },
  buy:        { label: '採購需求', group: 'internal', on: 0, legacy: 'buy', where: '有人送出採購需求時',
    text: '🛒 採購需求：{content}\n— {by}{url}\n處理完到 /prep 採購分頁按「已購買」',
    vars: '{content}=需求內容　{by}=發起人　{url}=附連結' },
  issue:      { label: '問題發布', group: 'internal', on: 1, where: '問題回報「發布」到群時',
    text: '📢 問題發布【{st}】{content}\n發現：{by}\n能處理的人 → /prep 按「🙋 我來解決」',
    vars: '{st}=站別　{content}=問題內容　{by}=回報人' },
  sopLate:    { label: 'SOP 超時未完成', group: 'internal', on: 0, legacy: 'sopLate', where: '每15分檢查，有超時就發',
    text: '⏰ GD SOP 超時未完成：\n{list}\n\n完成後點連結按「完成」打卡 🙏\n{link}',
    vars: '{list}=超時項目清單（自動帶）　{link}=連結' },
  lowStock:   { label: '庫存低水位', group: 'internal', on: 0, legacy: 'lowStock', where: '盤點後低於安全量時',
    text: '📉 庫存低水位提醒：\n{list}\n\n請盡快叫貨／補盤點',
    vars: '{list}=低水位品項清單（自動帶）' },
  staleItem:  { label: '品項停售盯梢', group: 'happy337', on: 1, legacy: 'staleItem', where: '超過5個營業日沒賣出',
    text: '🕵️ 品項停售提醒（超過 5 個營業日沒賣出）：\n{list}\n\n請確認：斷貨？下架？還是產品有問題？',
    vars: '{list}=疑似停售品項（自動帶）' },
  soldoutAB:  { label: 'A Beach 停售異動', group: 'happy337', on: 1, legacy: 'soldoutAB', where: '偵測到停售/恢復即時發',
    text: '🔔 A Beach 停售異動\n{list}',
    vars: '{list}=停售/恢復動態（自動帶）' },
}

async function _kvGet(id) { try { const m = await import('./mail-sync.js'); return await m.kvGet(id) } catch (_) { return null } }

// 解析群組 key（或原始 gid）→ 真正的 LINE group id
export async function ddGroupGid(groupVal) {
  const g = DD_GROUPS[groupVal]
  if (!g) return String(groupVal || '').trim() || FALLBACK_GID // 不是預設 key＝當作原始 gid
  if (g.env && (process.env[g.env] || '').trim()) return (process.env[g.env]).trim()
  if (g.match) { const seen = (await _kvGet('pm_group_seen')) || {}; for (const [gid, gg] of Object.entries(seen)) if (g.match.test(gg?.name || '')) return gid }
  return g.fallback || FALLBACK_GID
}

// 取某則訊息的「生效設定」＝預設 merge 覆蓋（任何錯→回預設）
export async function ddGet(key) {
  const def = DD_MSG_DEF[key]; if (!def) return null
  let ov = {}
  try { ov = ((await _kvGet(CFG_KEY)) || {})[key] || {} } catch (_) {}
  // on 來源優先序：新面板覆蓋 > 舊開關 sp_finance_pm_notify(相容) > 預設
  let on = def.on
  if (ov.on != null) on = ov.on ? 1 : 0
  else if (def.legacy) { try { const lv = ((await _kvGet('sp_finance_pm_notify')) || {})[def.legacy]; if (lv != null) on = def.on ? (lv !== 0 ? 1 : 0) : (lv === 1 ? 1 : 0) } catch (_) {} } // 預設開的用!==0、預設關的用===1(對齊原本判斷)
  return {
    key, label: def.label, vars: def.vars, where: def.where,
    on,
    group: ov.group || def.group,
    text: (ov.text != null && String(ov.text).trim()) ? String(ov.text) : def.text,
  }
}

// 套字：把 {變數} 換成實際值（缺的變數→空字串）
export function ddFill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null) ? String(vars[k]) : '')
}

// 給設定頁：全部定義 + 目前覆蓋 + 可選群組清單
export async function ddAll() {
  let ov = {}; try { ov = (await _kvGet(CFG_KEY)) || {} } catch (_) {}
  const msgs = Object.keys(DD_MSG_DEF).map(k => ({ key: k, ...DD_MSG_DEF[k], cur: ov[k] || {} }))
  const groups = Object.entries(DD_GROUPS).map(([k, v]) => ({ key: k, label: v.label }))
  // 已知群組（讓使用者也能直接選某個登記過的群）
  try { const seen = (await _kvGet('pm_group_seen')) || {}; for (const [gid, gg] of Object.entries(seen)) if (gg?.name) groups.push({ key: gid, label: gg.name + '（群）' }) } catch (_) {}
  return { msgs, groups }
}

export const DDMSG_CFG_KEY = CFG_KEY
