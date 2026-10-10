// DD 自動訊息集中設定（張良 2026-10-06「設定頁管理 DD 所有自動發送：發哪個群／話怎麼講／開關」）
// 設計原則：fail-safe——任何讀取/解析失敗，一律退回這裡的「預設值」，絕不讓通知壞掉。
// 覆蓋值存 KV: sp_finance_pm_ddmsg = { [key]: { on:0|1, group:'family'|'internal'|'happy337'|'<原始gid>', text:'...' } }
// 開關沿用習慣：預設關的(buy)維持關；原本總是發的(會議)預設開。
const CFG_KEY = 'sp_finance_pm_ddmsg'
const FALLBACK_GID = 'Cf7940efc6517b0c084ad2ad496b45f30' // 內部預設群（POS/金額/採購/問題也發這個）

// 群組預設：env 優先 → 群組登記表(pm_group_seen)照名字找 → 寫死退路
// 註：Cf7940（internal）官方群名＝HAPPY337（原名瑞光路337已改名；採購/問題/SOP/庫存/停售都發這個）；GROUN:D Family 是另一個群（會議用）。
// 真名一律由 ddGroupName 即時抓顯示，下面 label 只是抓不到時的退路。
// v4.55.2 張良「只留 海灘叢林team / HAPPY337 / GROUN:D Family 這3個 DD 有在的群」：預設群固定這三個，真名由 ddGroupName 即時抓
export const DD_GROUPS = {
  family:   { label: 'GROUN:D Family', match: /ground.*family|family/i, fallback: FALLBACK_GID },
  internal: { label: 'HAPPY337', env: 'LINE_DEFAULT_GROUP', match: /happy ?337|337/i, fallback: FALLBACK_GID },
  abteam:   { label: '海灘叢林 Team', match: /海灘叢林.*team|beach.*team/i, fallback: '' },
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
  sopLate:    { label: 'SOP 超時未完成（已停用，改收班彙整）', group: 'internal', on: 0, legacy: 'sopLate', where: 'v4.60.0 起停用逐項提醒，改每日收班彙整 sopSummary',
    text: '⏰ GD SOP 超時未完成：\n{list}\n\n完成後點連結按「完成」打卡 🙏\n{link}',
    vars: '{list}=超時項目清單（自動帶）　{link}=連結' },
  sopSummary: { label: 'SOP 每日收班彙整', group: 'internal', on: 0, where: '每天 20:05 發一則收班彙整（取代逐項超時提醒）；預設關＝不真發，要發自己開',
    text: 'GROUN:D｜{date} 收班 SOP\n必做完成 {doneN}/{reqN}；逾時未完成 {overN}\n{list}\n看今日紀錄 👉 {link}',
    vars: '{date}=營業日　{doneN}=已完成　{reqN}=必做總數　{overN}=逾時數　{list}=逾時清單（自動帶）　{link}=連結' },
  lowStock:   { label: '庫存低水位', group: 'internal', on: 0, legacy: 'lowStock', where: '盤點後低於安全量時',
    text: '📉 庫存低水位提醒：\n{list}\n\n請盡快叫貨／補盤點',
    vars: '{list}=低水位品項清單（自動帶）' },
  staleItem:  { label: '品項停售盯梢', group: 'internal', on: 1, legacy: 'staleItem', where: '超過5個營業日沒賣出',
    text: '🕵️ 品項停售提醒（超過 5 個營業日沒賣出）：\n{list}\n\n請確認：斷貨？下架？還是產品有問題？',
    vars: '{list}=疑似停售品項（自動帶）' },
  soldoutAB:  { label: 'A Beach 停售異動', group: 'internal', on: 1, legacy: 'soldoutAB', where: '偵測到停售/恢復即時發',
    text: '🔔 A Beach 停售異動\n{list}',
    vars: '{list}=停售/恢復動態（自動帶）' },
  // v4.70.38（張良 2026-10-10「兩個面板合成一個」）：舊「群組通知開關」唯一沒搬過來的一則；10-05 起停發，預設關、開了才會真發
  prep0930:   { label: '每日備料量（晚上 21:00 發明天）', group: 'family', on: 0, legacy: 'prep0930', where: '每天 21:00 發「明天」備料建議；預設關＝不發，要發自己開',
    text: '{body}',
    vars: '{body}=備料清單（自動帶，含週幾／總平均／峰值／直達連結）' },
}

// ── 群組個別設定（v4.70.38 張良 2026-10-10「DD 在的群全部列出來、都要能設定功能」）──
// KV sp_finance_pm_ddgrp = { [gid]: { mode:'normal'|'quiet'|'off', journal:0|1, translate:0|1, target:0|1, tag:'internal'|'external'|'', alias:'', hide:0|1 } }
// mode：normal＝@DD／講到「D哥」「dd」都回（現狀）；quiet＝只認 @DD 本帳號（文字提到 D哥 不插嘴）；off＝完全不回話（只默默記錄）
// journal＝這個群收不收「日誌/心得 …」；translate＝這個群能不能開翻譯模式；target＝能不能被選為自動訊息「發到」的群
// 沒設過的群一律用 DD_GRP_DEF（＝現狀行為不變），fail-safe：讀壞也退預設
const GRP_KEY = 'sp_finance_pm_ddgrp'
export const DD_GRP_DEF = { mode: 'normal', journal: 1, translate: 1, target: 1, tag: '', alias: '', hide: 0 }
export const DDGRP_CFG_KEY = GRP_KEY
export async function ddGroupCfgAll() { try { return (await _kvGet(GRP_KEY)) || {} } catch (_) { return {} } }
export async function ddGroupCfg(gid, doc) {
  const d = doc || await ddGroupCfgAll()
  const c = { ...DD_GRP_DEF, ...((gid && d[gid]) || {}) }
  if (!['normal', 'quiet', 'off'].includes(c.mode)) c.mode = 'normal'
  return c
}
async function _kvPut(id, obj, editor) { try { const m = await import('./mail-sync.js'); return await m.kvPut(id, obj, editor) } catch (_) { return null } }

// 全部 DD 在的群（來源＝pm_group_seen 登記表：DD 在群裡看過任何一則訊息就會登記）＋每群設定
// refresh=true：逐群問 LINE 真名（並行、3 秒逾時），404＝DD 已不在群 → 標 gone
export async function ddGroupList({ refresh } = {}) {
  let seen = {}; try { seen = (await _kvGet('pm_group_seen')) || {} } catch (_) {}
  const cfgAll = await ddGroupCfgAll()
  // 三個常用群的 gid：跟 ddGroupGid 同一套規則（env → 登記表照名字 → 寫死退路），但直接用上面已讀的 seen，省 3 次 KV 來回（端點 3.8s → 更快）
  const presetGid = {}
  for (const [k, g] of Object.entries(DD_GROUPS)) {
    let gid = (g.env && (process.env[g.env] || '').trim()) || ''
    if (!gid && g.match) for (const [g2, gg] of Object.entries(seen)) if (g.match.test(gg?.name || '')) { gid = g2; break }
    presetGid[k] = gid || g.fallback || FALLBACK_GID
  }
  const tk = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
  const gids = Object.keys(seen).filter(g => /^[CR]/.test(g)) // C=group R=room；私訊 U 不算群
  if (refresh && tk) {
    let dirty = false
    await Promise.all(gids.map(async gid => {
      try {
        const r = await fetch(`https://api.line.me/v2/bot/group/${gid}/summary`, { headers: { authorization: 'Bearer ' + tk }, signal: AbortSignal.timeout(3000) })
        if (r.ok) { const nm = (await r.json()).groupName || ''; if (nm && nm !== seen[gid].name) { seen[gid].name = nm; dirty = true }; if (seen[gid].gone) { delete seen[gid].gone; dirty = true } }
        else if (r.status === 404 || r.status === 403) { if (!seen[gid].gone) { seen[gid].gone = 1; dirty = true } }
      } catch (_) {}
    }))
    if (dirty) await _kvPut('pm_group_seen', seen, '群名/在群狀態重新確認')
  }
  const order = Object.keys(DD_GROUPS)
  const rows = gids.map(gid => {
    const g = seen[gid] || {}
    const key = order.find(k => presetGid[k] === gid) || ''
    const cfg = { ...DD_GRP_DEF, ...(cfgAll[gid] || {}) }
    if (!['normal', 'quiet', 'off'].includes(cfg.mode)) cfg.mode = 'normal'
    if (key && !cfg.tag) cfg.tag = 'internal' // 三個常用群預設內部
    return { gid, key, name: g.name || '', lastActive: g.lastActive || '', count: g.count || 0, gone: g.gone ? 1 : 0, cfg }
  })
  rows.sort((a, b) => {
    const ka = a.key ? order.indexOf(a.key) : 99, kb = b.key ? order.indexOf(b.key) : 99
    if (ka !== kb) return ka - kb
    if ((a.cfg.hide || 0) !== (b.cfg.hide || 0)) return (a.cfg.hide || 0) - (b.cfg.hide || 0)
    return String(b.lastActive).localeCompare(String(a.lastActive))
  })
  return rows
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

// 查某個 group id 的「官方真名」：直接問 LINE(最準,群改名也跟著)，問不到才退回 DD 記過的 pm_group_seen
// 註：LINE「官方群名」每個人看到的一樣；若使用者在自己手機把群「自訂顯示名」（例如改成 HAPPY337），那是本機私有的，伺服器拿不到，只能顯示官方名。
export async function ddGroupName(gid) {
  if (!gid) return ''
  try { const tk = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(); if (tk) { const r = await fetch(`https://api.line.me/v2/bot/group/${gid}/summary`, { headers: { authorization: 'Bearer ' + tk }, signal: AbortSignal.timeout(4000) }); if (r.ok) { const nm = (await r.json()).groupName; if (nm) return nm } } } catch (_) {}
  try { const seen = (await _kvGet('pm_group_seen')) || {}; if (seen[gid] && seen[gid].name) return seen[gid].name } catch (_) {}
  return ''
}

// 給設定頁：全部定義 + 目前覆蓋 + 可選群組清單（一律顯示「真名」，不用猜的）
export async function ddAll(opts) {
  let ov = {}; try { ov = (await _kvGet(CFG_KEY)) || {} } catch (_) {}
  const msgs = Object.keys(DD_MSG_DEF).map(k => ({ key: k, ...DD_MSG_DEF[k], cur: ov[k] || {} }))
  // v4.70.38 張良 2026-10-10「DD 還在海灘大群／duty 群／婚顧群／很多廠商群，全部都列出來」：
  // 「發到」清單＝登記表全部群（排除：隱藏／已離群／關掉「可發自動訊息」），常用三群（海灘叢林team/HAPPY337/Family）置頂；label 一律真名
  const grps = await ddGroupList({ refresh: !!(opts && opts.refresh) })
  const groups = []
  for (const r of grps) {
    if (r.cfg.hide || r.gone || r.cfg.target === 0) continue
    groups.push({ key: r.key || r.gid, gid: r.gid, label: r.cfg.alias || r.name || ('群 ' + r.gid.slice(-6)), real: r.name, tag: r.cfg.tag || '', preset: !!r.key })
  }
  // 三個預設群就算登記表還沒看到（例如剛加入沒講過話），也要出現在清單（退路＝舊寫法）
  for (const [k, v] of Object.entries(DD_GROUPS)) {
    if (groups.some(g => g.key === k)) continue
    let gid = ''; try { gid = await ddGroupGid(k) } catch (_) {}
    if (!gid || groups.some(g => g.gid === gid)) continue
    const real = await ddGroupName(gid)
    groups.unshift({ key: k, gid, label: real || v.label, real, tag: 'internal', preset: true })
  }
  return { msgs, groups, grps }
}

export const DDMSG_CFG_KEY = CFG_KEY
