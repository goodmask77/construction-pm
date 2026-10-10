// v4.70.41 DD 資料覆蓋自檢（張良 2026-10-11：「確定以後不會查不到資料然後 DD 又說謊嗎？很多次了」）
// 三個洞（10-04 假代查、EM 包場 kvGet 未定義、10-11 GD 叫貨沒餵 DD）共同病根＝每接一份新資料都要人工記得接 DD、沒有東西檢查有沒有漏。
// 這支做三件事：
//  (1) bossGenericText：阿桑系統每個端點，DD 沒有專門摘要的 → 自動一行（筆數＋欄位）告訴 DD「有這份、用 query_boss 看」
//  (2) queryBoss：通用代查，任何 feed 任何月都撈得到（新端點加進 _bossfeeds.js 就自動有）
//  (3) ddCoverageCheck（每日）：資料庫最近異動的「資料家族」vs 上次看過的 → 新家族出現就私訊審核人「DD 可能看不到 X」，並列進健康頁
// fail-safe：全部 try/catch，壞了回空，絕不影響 DD 回話
import { SB_URL, SB_KEY } from './_onboard.js'
import { EPS, OFF } from './_bossfeeds.js'

const H = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' })
async function kvGetMany(ids) {
  if (!SB_URL || !SB_KEY || !ids.length) return {}
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,data`, { headers: H() })
    const rows = r.ok ? await r.json() : []
    const out = {}
    rows.forEach((row) => { if (row?.data?.v) { try { out[row.id] = JSON.parse(row.data.v) } catch (_) {} } })
    return out
  } catch (_) { return {} }
}
async function kvSet(id, obj) {
  if (!SB_URL || !SB_KEY) return
  try { await fetch(`${SB_URL}/rest/v1/pm_documents`, { method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id, data: { v: JSON.stringify(obj) }, editor: 'D哥', updated_at: new Date().toISOString() }) }) } catch (_) {}
}
const tpeNow = () => new Date(Date.now() + 8 * 3600e3).toISOString()

export const LABELS = { revd: 'AB 每日營收', revm: 'AB 歷史月營收', sett: 'AB 每日結帳對帳', ord: 'AB 叫貨單', ordi: 'AB 叫貨明細', menu: 'AB 菜單成本', sched: 'AB 班表', staff: 'AB 員工名冊', prep: 'AB 備料送出', rout: 'AB 例行任務', att: 'AB 出勤事件', ot: 'AB 加班', inc: 'AB 交接異常', temp: 'AB 冰箱溫度', prod: 'AB 叫貨商品主檔（標準單價/規格/廠商）', sup: 'AB 廠商（叫貨日/休息日/帳期）', rcp: 'AB 配方', citem: 'AB 每品項單位成本', gprod: 'GROUN:D 產品主檔（售價/成本/庫存/安全量/站別）', gsup: 'GROUN:D 廠商', gord: 'GROUN:D 叫貨單', gordi: 'GROUN:D 叫貨明細' }
// DD 在 line-webhook loadBossText 有「專門寫過摘要」的 feed（改那邊要同步改這裡；自檢會對照）
export const DD_SPECIFIC = new Set(['sett', 'ord', 'gord', 'menu', 'revm', 'sched', 'att', 'ot', 'inc', 'prep', 'rout', 'temp'])
// 不走摘要但 DD 另有路看得到
export const DD_VIA = { revd: 'AB 營收走 App 每日數據（同源不重複餵）', ordi: 'query_orders 加 items', gordi: 'query_orders 加 items' }
export const feedKey = (E, ym) => E.snapshot ? `sp_finance_pm_boss_${E.slug}` : `sp_finance_pm_boss_${E.slug}_${ym}`
export const coverageOf = (slug) => DD_SPECIFIC.has(slug) ? '摘要（專門段落）' : DD_VIA[slug] ? DD_VIA[slug] : '通用一行＋query_boss'
export const genericFeeds = () => EPS.filter(E => !OFF.has(E.slug) && !DD_SPECIFIC.has(E.slug) && !DD_VIA[E.slug])

// (1) DD 摘要通用行：ym=YYYYMM
export async function bossGenericText(ym) {
  try {
    const feeds = genericFeeds(); if (!feeds.length) return []
    const kv = await kvGetMany(feeds.map(E => feedKey(E, ym)))
    const L = []
    for (const E of feeds) {
      const rows = Object.values((kv[feedKey(E, ym)] || {}).rows || {}); if (!rows.length) continue
      const cols = Object.keys(rows[0] || {}).slice(0, 10).join('/')
      L.push(`  ◇ ${LABELS[E.slug] || E.ep}（阿桑系統 ${E.ep}，${E.snapshot ? '快照' : '本月'} ${rows.length} 筆；欄位：${cols}）→ 內容用 query_boss feed="${E.slug}" 代查，不要說沒有這份資料`)
    }
    return L
  } catch (_) { return [] }
}

// (2) 通用代查：feed=slug、month=YYYY-MM（月檔才要）、kw=關鍵字（整列字串比對）、limit≤200
export async function queryBoss(feed, month, kw, limit) {
  const E = EPS.find(x => x.slug === String(feed || '').trim())
  if (!E) return `（沒有 feed「${feed}」；可用的：${EPS.map(x => `${x.slug}=${LABELS[x.slug] || x.ep}`).join('、')}）`
  const ym = E.snapshot ? '' : String(month || '').replace('-', '')
  if (!E.snapshot && !/^\d{6}$/.test(ym)) return `（${LABELS[E.slug] || E.ep} 是月檔，要給 "month":"YYYY-MM"）`
  const key = feedKey(E, ym); const doc = (await kvGetMany([key]))[key]
  let rows = Object.values((doc || {}).rows || {})
  const k = String(kw || '').trim(); if (k) rows = rows.filter(r => JSON.stringify(r).includes(k))
  const n = Math.min(Math.max(1, Number(limit) || 80), 200)
  const L = [`◆ ${LABELS[E.slug] || E.ep}${E.snapshot ? '（快照）' : `（${month}）`}${k ? `關鍵字「${k}」` : ''} 共 ${rows.length} 筆${rows.length > n ? `，只列前 ${n} 筆（要更多加關鍵字縮範圍）` : ''}（系統代查；${OFF.has(E.slug) ? '⚠️這個來源已停更，資料是舊的' : '阿桑系統每小時同步'}${(doc || {}).updatedAt ? `，最新到 ${String(doc.updatedAt).slice(0, 16).replace('T', ' ')}` : ''}）`]
  if (!rows.length) L.push('（這邊沒有任何資料）')
  rows.slice(0, n).forEach(r => L.push('  - ' + Object.entries(r).filter(([, v]) => v != null && v !== '').map(([a, b]) => `${a}=${typeof b === 'object' ? JSON.stringify(b).slice(0, 80) : String(b).slice(0, 60)}`).join('｜').slice(0, 400)))
  return L.join('\n')
}

// (3) 資料家族正規化：pm_ddh_2026-10-11_abc12x → pm_ddh_*；sp_finance_pm_boss_gord_202610 → sp_finance_pm_boss_gord_*；pm_bot_chat_dm_U<32hex> → pm_bot_chat_dm_*
export function familyOf(id) {
  // 以底線切段：含數字的段（日期／流水號／userId／雜湊）→ *；純字母段保留；連續 * 合併
  return String(id).split('_').map(t => ((/\d/.test(t) || t.length >= 20) ? '*' : t)).join('_').replace(/(_\*)+/g, '_*').replace(/^\*(_\*)*$/, '*')
}
const COV_KEY = 'pm_dd_coverage'

async function notifyApprovers(text) {
  try {
    const kv = await kvGetMany(['sp_finance_pm_sop_def', 'sp_crew_kb_roster'])
    const tk = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
    for (const an of (((kv.sp_finance_pm_sop_def || {}).ground || {}).approvers || ['張良瑋'])) {
      const ap = ((kv.sp_crew_kb_roster || {}).people || []).find(p => p.name === an && p.lineUserId)
      if (tk && ap) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: ap.lineUserId, messages: [{ type: 'text', text }] }) })
    }
  } catch (_) {}
}

// 每日自檢（cron-daily 呼叫；同一天只跑一次）
export async function ddCoverageCheck({ force } = {}) {
  if (!SB_URL || !SB_KEY) return { ok: false }
  const today = tpeNow().slice(0, 10)
  const st = (await kvGetMany([COV_KEY]))[COV_KEY] || { fam: {}, fresh: [] }
  if (st.lastDay === today && !force) return { ok: true, skipped: true }
  // a. 資料庫最近異動 1000 筆的 id → 家族
  let ids = []
  try { const r = await fetch(`${SB_URL}/rest/v1/pm_documents?select=id&order=updated_at.desc.nullslast&limit=1000`, { headers: H() }); ids = r.ok ? (await r.json()).map(x => x.id) : [] } catch (_) {}
  const seen = {}; ids.forEach(id => { const f = familyOf(id); seen[f] = (seen[f] || 0) + 1 })
  const baseline = !st.baselineAt
  const newFams = []
  for (const [f, n] of Object.entries(seen)) {
    if (!st.fam[f]) { st.fam[f] = { first: today, n }; if (!baseline) newFams.push(f) } else { st.fam[f].last = today; st.fam[f].n = n }
  }
  if (baseline) st.baselineAt = today
  if (newFams.length) st.fresh = [...newFams.map(f => ({ f, t: today })), ...(st.fresh || [])].slice(0, 50)
  // b. 阿桑端點表 vs DD 覆蓋方式（+本月筆數）
  const ym = today.slice(0, 7).replace('-', '')
  const kv = await kvGetMany(EPS.map(E => feedKey(E, ym)))
  st.boss = EPS.map(E => ({ slug: E.slug, label: LABELS[E.slug] || E.ep, ep: E.ep, off: OFF.has(E.slug), rows: Object.keys((kv[feedKey(E, ym)] || {}).rows || {}).length, via: coverageOf(E.slug) }))
  st.lastDay = today; st.checkedAt = tpeNow().slice(0, 16).replace('T', ' ')
  await kvSet(COV_KEY, st)
  if (newFams.length) await notifyApprovers(`🩺 DD 資料自檢：資料庫今天出現 ${newFams.length} 個新的資料家族，DD 可能還看不到：\n${newFams.slice(0, 12).map(f => '・' + f).join('\n')}${newFams.length > 12 ? `\n…共 ${newFams.length} 個` : ''}\n（/prep 設定 → DD 健康 可看；CC 下次開工會接上）`)
  return { ok: true, baseline, ids: ids.length, families: Object.keys(seen).length, newFams }
}
// 健康頁讀（唯讀）
export async function ddCoverageReport() {
  const st = (await kvGetMany([COV_KEY]))[COV_KEY] || null
  if (!st) return { boss: EPS.map(E => ({ slug: E.slug, label: LABELS[E.slug] || E.ep, ep: E.ep, off: OFF.has(E.slug), rows: null, via: coverageOf(E.slug) })), fresh: [], checkedAt: null }
  return { boss: st.boss || [], fresh: (st.fresh || []).slice(0, 20), checkedAt: st.checkedAt || null, families: Object.keys(st.fam || {}).length }
}
