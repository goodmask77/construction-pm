// ── 菜商報價比價（v4.70.67，2026-10-12；張良「上展跟尚太每月報價騰上、菜商比價頁、對照市場行情歷史波動、核對價格異常、抓 ops 訂單沒更新」）──
//   資料：sp_finance_pm_veg_quotes ＝ 兩家菜商每月報價（從張良的 Google 試算表騰入，之後可在頁面「重新匯入」或由 CC 補）
//         sp_finance_pm_veg_market ＝ 農業部「農產品交易行情」台北一市月均價快取（每天最多抓一次；對照表 MARKET_MAP 由人維護）
//   比價：同一品項兩家逐月並排、差額％、誰便宜；市場行情同圖對照（批發價是「行情」不是「到店價」，看走勢與漲跌幅，不比絕對值）
//   核對：①偵錯中心「價格異常」每筆拿變價後的價 vs 該廠商那個月報價（±1% 或 ±1 元；月初 5 號前也認前月價）→ 對上＝可一鍵確認正確
//         ②ops 叫貨單每行單價 vs 該月報價 → 不一致／該月沒報價／報價表沒品項／GD 無單價，列給人看
import { buildTodo, buildImpact, loadSnap, loadMaster } from './_cost.js'
import { buildCards } from './_matcard.js'

export const VQ_KEY = 'sp_finance_pm_veg_quotes'
export const VM_KEY = 'sp_finance_pm_veg_market'
export const VENDORS = ['尚太', '上展']
const r1 = n => Math.round(n * 10) / 10
export const nk = s => String(s || '').toLowerCase().replace(/[\s\-_()（）/／·・]/g, '').replace(/蕃/g, '番').replace(/臺/g, '台')
const baseVendor = s => String(s || '').replace(/[＿_]?員餐$/, '').trim()
const prevYm = ym => { const [y, m] = ym.split('-').map(Number); return m > 1 ? `${y}-${String(m - 1).padStart(2, '0')}` : `${y - 1}-12` }

// 品項 → 農業部作物名（台北一市）。對不準的先不對（null）；張良說哪個對錯再改這張表
export const MARKET_MAP = {
  美生菜: '萵苣菜-結球萵', 綠檸檬: '雜柑-檸檬', 聖女蕃茄: '小番茄-聖女', 聖女番茄: '小番茄-聖女', 牛蕃茄: '番茄-牛番茄', 牛番茄: '番茄-牛番茄', 九層塔: '九層塔',
  廣東A菜: '萵苣菜-廣東菜', 大陸妹: '萵苣菜-本島圓葉', 青蔥: '青蔥-北蔥', 蔥花: '青蔥-北蔥', 白洋蔥: '洋蔥-本產', 紫洋蔥: '洋蔥-進口', 紅蔥頭: '青蔥-紅蔥頭',
  大辣椒: '辣椒-紅小', 朝天椒: '辣椒-朝天椒', 糯米椒: '辣椒-糯米椒', 青椒: '甜椒-青椒', 香菜: '芫荽', 小黃瓜: '花胡瓜', 蒜中: '大蒜-蒜頭', 蒜仁: '大蒜-蒜仁', 蒜苗: '大蒜-軟梗',
  青花菜: '花椰菜-青梗', 白花椰: '花椰菜-進口', '高麗菜(平)': '甘藍-初秋', 高麗菜: '甘藍-初秋', 西洋芹: '芹菜-進口', 芹菜: '芹菜-白梗', 油菜: '油菜', 菠菜: '菠菜-角葉',
  '洋芋(馬K)': '馬鈴薯-本產', 珍珠洋芋: '馬鈴薯-本產', 紅K: '胡蘿蔔-清洗', 紅蘿蔔: '胡蘿蔔-清洗', 菜頭: '蘿蔔-矸仔', 白蘿蔔: '蘿蔔-矸仔', 四季豆: '敏豆-粉豆',
  '杏鮑菇(A)(中)': '杏鮑菇', 杏鮑菇: '杏鮑菇', '香菇(中)': '濕香菇', 金針菇: '其他菇類', 皎白筍: '茭白筍-去殼', 去殼皎白筍: '茭白筍-去殼', 帶殼玉米筍: '玉米-玉米筍 帶殼', 玉米筍: '玉米-玉米筍',
  小豆苗: '豌豆-豌豆苗', 日本茄子: '茄子-日本種', 茄子: '茄子-麻荸茄', 南瓜: '南瓜-木瓜型 阿成', 地瓜: '甘薯-臺農57號', 紅心地瓜: '甘薯-臺農66號', 捲葉巴西里: '巴西利', 羅勒葉: '羅勒', 茴香: '茴香', 牛蒡: '牛蒡'
}

// ── 匯入（整包覆蓋該廠商；留上一版在 prev 以便回復）──
export async function importQuotes ({ kvGet, kvPut, body, who }) {
  const doc = (await kvGet(VQ_KEY)) || { vendors: {}, log: [] }
  const vendors = body.vendors || {}
  const names = Object.keys(vendors).filter(v => VENDORS.includes(v))
  if (!names.length) return { ok: false, error: '沒有 尚太／上展 的資料' }
  for (const v of names) {
    const items = {}
    for (const [name, it] of Object.entries(vendors[v].items || {})) {
      const nm = String(name).trim(); if (!nm) continue
      const m = {}; for (const [ym, p] of Object.entries(it.m || {})) { if (/^\d{4}-\d{2}$/.test(ym) && isFinite(Number(p)) && Number(p) > 0) m[ym] = Number(p) }
      if (!Object.keys(m).length) continue
      items[nm] = { cat: String(it.cat || ''), spec: String(it.spec || ''), unit: String(it.unit || ''), m }
    }
    doc.vendors[v] = { prev: doc.vendors[v] ? { items: doc.vendors[v].items, importedAt: doc.vendors[v].importedAt } : null, items, src: String(vendors[v].src || ''), importedAt: new Date().toISOString(), by: who.name, n: Object.keys(items).length }
  }
  doc.log = [...(doc.log || []), { at: new Date().toISOString(), by: who.name, vendors: names.map(v => v + ' ' + doc.vendors[v].n + ' 項') }].slice(-50)
  await kvPut(VQ_KEY, doc, '菜商報價匯入(' + who.name + ')')
  return { ok: true, vendors: names.map(v => ({ vendor: v, n: doc.vendors[v].n })) }
}

// ── 市場行情：農業部 AgriProductsTransType，台北一市，近 13 個月日均 → 月均（元/公斤）──
const roc = d => `${d.getUTCFullYear() - 1911}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`
async function fetchCrop (crop, startRoc, endRoc, timeoutMs = 45000) {
  const u = 'https://data.moa.gov.tw/api/v1/AgriProductsTransType/?' + new URLSearchParams({ Start_time: startRoc, End_time: endRoc, CropName: crop, MarketName: '台北一' })
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(u, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status)
    const d = await r.json(); const by = {}
    for (const x of d.Data || []) { if (x.CropName !== crop || !(x.Avg_Price > 0)) continue; const [y, m] = String(x.TransDate).split('.'); const ym = (Number(y) + 1911) + '-' + m; (by[ym] = by[ym] || []).push(Number(x.Avg_Price)) }
    const out = {}; for (const [ym, arr] of Object.entries(by)) out[ym] = { avg: r1(arr.reduce((a, b) => a + b, 0) / arr.length), n: arr.length, max: Math.max(...arr), min: Math.min(...arr) }
    return out
  } finally { clearTimeout(tm) }
}
// 讀快取（頁面載入用，不打農業部）；refresh 才真的抓：農業部 API 一次併發太多會被擋（實測 47 種全 abort），改 4 個一批、每種最多 45 秒、總預算 200 秒，抓到哪存到哪（下次接著補）
export async function marketCache ({ kvGet }) { return (await kvGet(VM_KEY)) || { crops: {}, fetchedAt: '' } }
export async function marketSeries ({ kvGet, kvPut, force, budgetMs = 200000 }) {
  const cache = await marketCache({ kvGet })
  const fresh = cache.fetchedAt && (Date.now() - Date.parse(cache.fetchedAt)) < 20 * 3600e3
  if (fresh && !force) return cache
  const t0 = Date.now()
  const stale = c => !cache.crops[c] || !cache.crops[c]._at || (Date.now() - Date.parse(cache.crops[c]._at)) > 20 * 3600e3
  const crops = [...new Set(Object.values(MARKET_MAP).filter(Boolean))].sort((a, b) => (stale(a) ? 0 : 1) - (stale(b) ? 0 : 1))
  const end = new Date(Date.now() + 8 * 3600e3); const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() - 1, 1))
  const sR = roc(start), eR = roc(end); const errs = []; let nDone = 0, nSkip = 0
  const next = { crops: { ...cache.crops }, fetchedAt: cache.fetchedAt || '', market: '台北一', errs }
  for (let i = 0; i < crops.length; i += 4) {
    if (Date.now() - t0 > budgetMs) { nSkip += crops.length - i; break }
    const batch = crops.slice(i, i + 4).filter(c => force === 'all' || stale(c))
    if (!batch.length) continue
    const rs = await Promise.all(batch.map(async c => { try { return [c, await fetchCrop(c, sR, eR, 45000)] } catch (e) { errs.push(c + ':' + String(e.message || e).slice(0, 40)); return [c, null] } }))
    for (const [c, s] of rs) if (s) { next.crops[c] = { ...s, _at: new Date().toISOString() }; nDone++ }
  }
  if (nDone) next.fetchedAt = new Date().toISOString()
  next.nDone = nDone; next.nSkip = nSkip; next.ms = Date.now() - t0
  try { await kvPut(VM_KEY, next, '市場行情快取') } catch (_) {}
  return next
}


// ── 直接讀 Google 試算表更新（v4.70.68；張良 2026-10-12「他們每個月會在試算表更新報價」）──
//   每家存的 src 連結帶 gid → 抓 export?format=csv&gid= → 表頭「N月單價」→ 月份換年：N ≤ 現在月份＝今年、N > 現在月份＝去年
//   只更新試算表上有的月份，歷史月份（去年「不使用」分頁騰的）保留；逐筆記錄 舊→新，給 LINE 摘要與頁面看
function parseCsv (txt) {
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(v => String(v).trim()))
}
export function sheetToItems (csvText, now = new Date(Date.now() + 8 * 3600e3)) {
  const rows = parseCsv(csvText); if (rows.length < 2) throw new Error('試算表讀不到資料列')
  const hdr = rows[0].map(h => String(h || '').trim())
  const iCat = hdr.indexOf('分類'), iName = hdr.findIndex(h => h === '品項' || h === '叫貨名稱' || h === '名稱'), iSpec = hdr.indexOf('規格'), iUnit = hdr.indexOf('單位')
  if (iName < 0) throw new Error('表頭找不到「品項」或「叫貨名稱」欄')
  const Y = now.getUTCFullYear(), M = now.getUTCMonth() + 1
  const cols = hdr.map((h, i) => { const m = h.match(/^(\d{1,2})月單價$/); if (!m) return null; const mo = Number(m[1]); return { i, ym: `${mo <= M ? Y : Y - 1}-${String(mo).padStart(2, '0')}` } }).filter(Boolean)
  if (!cols.length) throw new Error('表頭找不到「N月單價」欄')
  const items = {}
  for (const r of rows.slice(1)) {
    const name = String(r[iName] || '').trim(); if (!name || name === hdr[iName]) continue
    const m = {}; for (const c of cols) { const v = String(r[c.i] || '').replace(/[,\s元$NT]/g, ''); const n = Number(v); if (v && isFinite(n) && n > 0) m[c.ym] = n }
    const cur = items[name] || (items[name] = { cat: iCat >= 0 ? String(r[iCat] || '').trim() : '', spec: iSpec >= 0 ? String(r[iSpec] || '').trim() : '', unit: iUnit >= 0 ? String(r[iUnit] || '').trim() : '', m: {} })
    Object.assign(cur.m, m); if (!cur.cat && iCat >= 0) cur.cat = String(r[iCat] || '').trim()
  }
  return { items, months: [...new Set(cols.map(c => c.ym))].sort(), nRows: rows.length - 1 }
}
async function fetchSheetCsv (src) {
  const m = String(src || '').match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/); if (!m) throw new Error('不是 Google 試算表連結')
  const gid = (String(src).match(/[#&?]gid=(\d+)/) || [])[1], sheet = (String(src).match(/[#&?]sheet=([^&#]+)/) || [])[1]
  // 連結帶 sheet=分頁名稱 → 用 gviz 依名稱抓（分頁 gid 看不到時用這招；張良給的上展連結 gid 指到舊「不使用」分頁）；否則用 gid 匯出
  const u = sheet ? `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(decodeURIComponent(sheet))}` : `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? '&gid=' + gid : ''}`
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000)
  try { const r = await fetch(u, { signal: ctl.signal, redirect: 'follow' }); if (!r.ok) throw new Error('試算表打不開（HTTP ' + r.status + '），分享要設「知道連結的人可檢視」'); if (/accounts\.google\.com/.test(r.url || '')) throw new Error('試算表要登入才看得到，分享要設「知道連結的人可檢視」'); return await r.text() } finally { clearTimeout(tm) }
}
export async function syncFromSheets ({ kvGet, kvPut, who, vendors: only, srcOverride }) {
  const doc = (await kvGet(VQ_KEY)) || { vendors: {}, log: [] }
  const out = { ok: true, at: new Date().toISOString(), vendors: [] }
  for (const v of VENDORS) {
    if (only && only.length && !only.includes(v)) continue
    const cur = doc.vendors[v] || { items: {} }
    const src = (srcOverride && srcOverride[v]) || cur.src; if (!src) { out.vendors.push({ vendor: v, ok: false, error: '沒有試算表連結' }); continue }
    try {
      const { items, months, nRows } = sheetToItems(await fetchSheetCsv(src))
      const changes = [], added = []
      const next = JSON.parse(JSON.stringify(cur.items || {}))
      for (const [name, it] of Object.entries(items)) {
        if (!Object.keys(it.m).length) continue // 表上有名字但沒半個價＝略過（不算新品項）
        const old = next[name]
        if (!old) { next[name] = it; added.push(name); for (const [ym, p] of Object.entries(it.m)) changes.push({ name, ym, from: null, to: p }); continue }
        for (const [ym, p] of Object.entries(it.m)) { if (old.m[ym] !== p) { changes.push({ name, ym, from: old.m[ym] == null ? null : old.m[ym], to: p }); old.m[ym] = p } }
        if (it.cat) old.cat = it.cat; if (it.spec) old.spec = it.spec; if (it.unit) old.unit = it.unit
      }
      const recent = months.slice(-2) // 上一次最新兩個月還有價、這次表上沒有＝可能被刪或改名（不動資料，只提醒）；去年「不使用」分頁騰的歷史品項不算
      const missing = Object.keys(next).filter(n => !items[n] && recent.some(ym => (next[n].m || {})[ym] != null))
      doc.vendors[v] = { ...cur, prev: changes.length ? { items: cur.items, importedAt: cur.importedAt } : cur.prev, items: next, src, importedAt: changes.length ? out.at : cur.importedAt, lastSync: out.at, lastSyncBy: who.name, n: Object.keys(next).length, lastChanges: changes.length }
      out.vendors.push({ vendor: v, ok: true, months, nRows, n: Object.keys(next).length, changes, added, missing: missing.slice(0, 30) })
    } catch (e) { doc.vendors[v] = { ...cur, lastSync: out.at, lastSyncErr: String(e.message || e).slice(0, 200) }; out.vendors.push({ vendor: v, ok: false, error: String(e.message || e).slice(0, 200) }) }
  }
  doc.sync = { at: out.at, by: who.name, summary: out.vendors.map(x => x.ok ? `${x.vendor} ${x.changes.length} 筆變動` : `${x.vendor} 失敗：${x.error}`) }
  doc.log = [...(doc.log || []), { at: out.at, by: who.name, sync: doc.sync.summary }].slice(-50)
  await kvPut(VQ_KEY, doc, '菜商報價同步(' + who.name + ')')
  return out
}
// LINE 摘要文字（有變動才發）
export function syncSummaryText (r) {
  const lines = []
  for (const x of r.vendors) {
    if (!x.ok) { lines.push(`❌ ${x.vendor}：${x.error}`); continue }
    if (!x.changes.length) continue
    const byYm = {}; for (const c of x.changes) (byYm[c.ym] = byYm[c.ym] || []).push(c)
    for (const [ym, cs] of Object.entries(byYm).sort()) {
      const ups = cs.filter(c => c.from != null && c.to > c.from).sort((a, b) => (b.to / b.from) - (a.to / a.from)), downs = cs.filter(c => c.from != null && c.to < c.from).sort((a, b) => (a.to / a.from) - (b.to / b.from)), news = cs.filter(c => c.from == null)
      lines.push(`🥬 ${x.vendor} ${ym.slice(5)} 月報價更新：${news.length} 項新報價、漲 ${ups.length}、跌 ${downs.length}` + (ups.length ? `\n　漲最多：${ups.slice(0, 4).map(c => `${c.name} ${c.from}→${c.to}`).join('、')}` : '') + (downs.length ? `\n　跌最多：${downs.slice(0, 4).map(c => `${c.name} ${c.from}→${c.to}`).join('、')}` : ''))
    }
    if (x.added.length) lines.push(`　新品項：${x.added.slice(0, 8).join('、')}${x.added.length > 8 ? '…' : ''}`)
    if (x.missing.length) lines.push(`　表上不見了（可能改名）：${x.missing.slice(0, 6).join('、')}${x.missing.length > 6 ? '…' : ''}`)
  }
  return lines.length ? lines.join('\n') + '\n\n看比價：GD → 成本總覽 → 菜商比價' : ''
}

// ── 比價＋核對 ──
function matchVerdict (it, quoteOf, curPrice) { // it＝偵錯中心 price 項目
  const sup = baseVendor(it.supplier); const flagged = []
  if (it.signal === 'pricelog') { const mm = String(it.note || '').match(/新價：([\d.]+)[\s\S]*?時間：(\d{4}-\d{2}-\d{2})/); if (mm) flagged.push({ d: mm[2], p: Number(mm[1]), lab: '新價' }) } else if (it.signal === 'curvslast') { const p = curPrice(it.code); if (p > 0) flagged.push({ d: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), p, lab: '現價' }) } else {
    const ser = Array.isArray(it.series) ? it.series : []; const seen = new Set()
    for (const x of ser) { if (x.d < it.date || seen.has(x.p)) continue; seen.add(x.p); flagged.push({ d: x.d, p: Number(x.p), lab: '叫貨價' }); if (flagged.length >= 3) break }
  }
  if (!flagged.length) return { verdict: 'nodata', detail: [] }
  let ok = true; const detail = []
  for (const f of flagged) {
    const ym = f.d.slice(0, 7); const q = quoteOf(sup, it.name, ym), qp = quoteOf(sup, it.name, prevYm(ym))
    if (q == null && qp == null) { ok = null; detail.push({ ...f, q: null, hit: false }); continue }
    const tol = Math.max(1, f.p * 0.01)
    const hit = (q != null && Math.abs(q - f.p) <= tol) || (qp != null && Number(f.d.slice(8, 10)) <= 5 && Math.abs(qp - f.p) <= tol)
    detail.push({ ...f, ym, q, qp, hit }); if (!hit) ok = false
  }
  return { verdict: ok ? 'hit' : (ok === null ? 'noquote' : 'miss'), detail }
}

export async function buildVegCmp ({ kvGet, kvPut, months, withMarket = true, withChk = true }) { // withChk=false：不算偵錯中心那包（慢 5 秒），頁面先秀比價表，核對頁另外載
  const doc = (await kvGet(VQ_KEY)) || { vendors: {} }
  const V = {}; for (const v of VENDORS) V[v] = (doc.vendors[v] || {}).items || {}
  const idx = {}; for (const v of VENDORS) { idx[v] = {}; for (const [n, it] of Object.entries(V[v])) idx[v][nk(n)] = { name: n, ...it } }
  const quoteOf = (v, name, ym) => { const d = (idx[v] || {})[nk(name)]; return d ? (d.m[ym] == null ? null : d.m[ym]) : null }
  const allYm = [...new Set(VENDORS.flatMap(v => Object.values(V[v]).flatMap(it => Object.keys(it.m))))].sort()
  const market = withMarket ? await marketCache({ kvGet }) : { crops: {} } // 只讀快取；抓行情走 refreshMarket（分批、慢）
  // 品項合併（兩家名稱正規化後相同＝同一品項）
  const keys = [...new Set(VENDORS.flatMap(v => Object.keys(idx[v])))]
  const items = keys.map(k => {
    const a = idx['尚太'][k], b = idx['上展'][k]; const ref = a || b
    const row = { key: k, name: ref.name, cat: (a && a.cat) || (b && b.cat) || '', spec: ref.spec, unit: ref.unit || '公斤', s: {}, both: !!(a && b) }
    for (const v of VENDORS) { const d = idx[v][k]; row.s[v] = d ? d.m : null }
    const crop = MARKET_MAP[ref.name] || (a && MARKET_MAP[a.name]) || (b && MARKET_MAP[b.name]) || null
    row.crop = crop; row.mkt = crop && market.crops[crop] ? Object.fromEntries(Object.entries(market.crops[crop]).filter(([ym, x]) => /^\d{4}-\d{2}$/.test(ym) && x && x.avg != null).map(([ym, x]) => [ym, x.avg])) : null
    // 最新一個月兩家都有的比較
    const common = allYm.filter(ym => a && b && a.m[ym] != null && b.m[ym] != null)
    row.nCommon = common.length
    if (common.length) {
      const last = common[common.length - 1]; const pa = a.m[last], pb = b.m[last]
      row.latest = { ym: last, 尚太: pa, 上展: pb, diff: r1(pa - pb), pct: pb ? Math.round((pa - pb) / pb * 1000) / 10 : null, cheaper: pa === pb ? '一樣' : (pa < pb ? '尚太' : '上展') }
      let wa = 0, wb = 0, sumPct = 0; for (const ym of common) { if (a.m[ym] < b.m[ym]) wa++; else if (b.m[ym] < a.m[ym]) wb++; sumPct += (a.m[ym] - b.m[ym]) / b.m[ym] }
      row.stat = { 尚太便宜: wa, 上展便宜: wb, 一樣: common.length - wa - wb, avgPct: Math.round(sumPct / common.length * 1000) / 10 }
    }
    for (const v of VENDORS) { const d = idx[v][k]; if (!d) continue; const vals = allYm.map(ym => d.m[ym]).filter(x => x != null); if (vals.length >= 2) { const mn = Math.min(...vals), mx = Math.max(...vals); row['vol' + v] = { min: mn, max: mx, pct: mn ? Math.round((mx - mn) / mn * 100) : null, first: vals[0], last: vals[vals.length - 1] } } }
    if (row.mkt) { const mv = allYm.map(ym => row.mkt[ym]).filter(x => x != null); if (mv.length >= 2) row.volMkt = { min: Math.min(...mv), max: Math.max(...mv), pct: Math.min(...mv) ? Math.round((Math.max(...mv) - Math.min(...mv)) / Math.min(...mv) * 100) : null } }
    return row
  }).sort((x, y) => (x.cat === '營運' ? 0 : 1) - (y.cat === '營運' ? 0 : 1) || (y.both - x.both) || x.name.localeCompare(y.name, 'zh-Hant'))

  // ── ops 叫貨單 vs 報價 ──
  const mos = months.slice(0, 6) // 近 6 個月
  const [ordi, gordi] = await Promise.all([Promise.all(mos.map(m => kvGet('sp_finance_pm_boss_ordi_' + m.replace('-', '')))), Promise.all(mos.map(m => kvGet('sp_finance_pm_boss_gordi_' + m.replace('-', ''))))])
  const tpe = s => { const t = Date.parse(String(s || '')); return isNaN(t) ? '' : new Date(t + 8 * 3600e3).toISOString().slice(0, 10) }
  const lines = []
  for (const [store, docs] of [['AB', ordi], ['GD', gordi]]) for (const d of docs) for (const r of Object.values((d || {}).rows || {})) {
    const sup = baseVendor(r.supplier); if (!VENDORS.includes(sup)) continue
    if (r.is_backfill) continue
    const date = tpe(r.ordered_at); if (!date) continue
    const name = r.name || r.item || ''; const price = (r.price == null || r.price === '') ? null : Number(r.price)
    const ym = date.slice(0, 7); const d9 = idx[sup][nk(name)]
    const q = d9 ? d9.m[ym] : undefined, qp = d9 ? d9.m[prevYm(ym)] : undefined
    let kind
    if (!(price > 0)) kind = 'unpriced'
    else if (!d9) kind = 'noitem'
    else if (q == null) kind = 'nomonth'
    else if (Math.abs(q - price) <= Math.max(1, price * 0.01)) kind = 'ok'
    else if (qp != null && Math.abs(qp - price) <= Math.max(1, price * 0.01)) kind = 'prev'
    else kind = 'diff'
    lines.push({ store, date, ym, supplier: r.supplier, sup, meal: /員餐/.test(r.supplier || ''), name, code: r.code || '', qty: Number(r.qty) || 0, unit: r.unit || '', st: r.order_status || '', price, q: q == null ? null : q, qp: qp == null ? null : qp, kind, pct: (kind === 'diff' && q) ? Math.round((price - q) / q * 1000) / 10 : null, oid: r.order_id || '' })
  }
  // v4.70.69 兩家各品項叫貨量（依月，AB＋GD 合計；取消／退回的單不算）＋「若叫便宜那家可省多少」
  const qtyBy = {}, amtBy = {}, totals = {} // totals[ym][sup] = { AB, GD, all }：該廠商全部叫貨金額（含報價表沒有的品項）
  for (const l of lines) {
    if (/cancel|取消|reject|退回|void/i.test(l.st || '')) continue
    const k = nk(l.name), amt = (l.price > 0 ? l.price * (l.qty || 0) : 0)
    const o = qtyBy[k] = qtyBy[k] || {}; const v = o[l.sup] = o[l.sup] || {}; v[l.ym] = r1((v[l.ym] || 0) + (l.qty || 0)); o._unit = o._unit || l.unit
    const a = amtBy[k] = amtBy[k] || {}; const av = a[l.sup] = a[l.sup] || {}; av[l.ym] = Math.round((av[l.ym] || 0) + amt)
    const t = (totals[l.ym] = totals[l.ym] || {}); const ts = (t[l.sup] = t[l.sup] || { AB: 0, GD: 0, all: 0, meal: 0, ops: 0, lines: 0 }); ts[l.store] = Math.round(ts[l.store] + amt); ts.all = Math.round(ts.all + amt); ts[l.meal ? 'meal' : 'ops'] = Math.round(ts[l.meal ? 'meal' : 'ops'] + amt); ts.lines++ // v4.70.74 員餐＝叫貨單帳號「＿員餐」
  }
  const last3 = mos.slice(0, 3)
  for (const row of items) {
    const q = qtyBy[row.key] || {}, a = amtBy[row.key] || {}; row.qty = {}; row.amt = {}; row.qty3 = {}; row.qtyUnit = q._unit || ''
    for (const v of VENDORS) { row.qty[v] = q[v] || null; row.amt[v] = a[v] || null; row.qty3[v] = q[v] ? r1(last3.reduce((s, ym) => s + (q[v][ym] || 0), 0)) : 0 }
    // 可省＝每月「跟貴的那家買的量 × 兩家價差」（兩家該月都有報價才算）；逐月給前端，前端依選的月份加總
    if (row.both) {
      const sv = { total: 0, byYm: {}, toByYm: {}, to: null }; const cnt = { 尚太: 0, 上展: 0 }
      for (const ym of mos) { const pa = row.s.尚太[ym], pb = row.s.上展[ym]; if (pa == null || pb == null || pa === pb) continue; const qa = (q.尚太 || {})[ym] || 0, qb = (q.上展 || {})[ym] || 0; let m = 0; if (pa > pb && qa) m += qa * (pa - pb); if (pb > pa && qb) m += qb * (pb - pa); if (m) { sv.byYm[ym] = Math.round(m); sv.toByYm[ym] = pa > pb ? '上展' : '尚太'; if (last3.includes(ym)) { sv.total += m; cnt[sv.toByYm[ym]]++ } } }
      sv.total = Math.round(sv.total); sv.to = sv.total ? (cnt.上展 >= cnt.尚太 ? '上展' : '尚太') : null
      row.save = sv
    }
  }
  // ── 主要用在哪些產品（v4.70.72）：物料代碼 → 食譜／菜單行（_cost buildImpact，ratio=1 ＝ 這個物料在該餐點每份的成本）＋ POS 兩店月銷量 ──
  try {
    const snap = await loadSnap(kvGet); const master = await loadMaster(kvGet, snap); const impact = buildImpact(snap)
    const prodBy = {}; for (const p of master.products || []) { if (!VENDORS.includes(baseVendor(p.supplier))) continue; const k = nk(p.name); (prodBy[k] = prodBy[k] || []).push(p) }
    // 月銷量：pos_d_ 近 3 個月兩店；key＝正規化菜名（去 emoji／空白）
    const mn = s => String(s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/[\s\-_()（）/／·・]/g, '').toLowerCase()
    const sold = {} // mn(menu) → { ym: qty }
    const posDocs = await Promise.all(last3.map(m => kvGet('sp_finance_pm_pos_d_' + m)))
    for (const d of posDocs) for (const [dk, day] of Object.entries((d || {}).days || {})) { const secs = (day.sheets || {})['總銷售額 (以類別分類)']; if (!Array.isArray(secs)) continue; const ym = (day.date || dk).slice(0, 7); for (const sec of secs) { if (sec.title === '總結' || sec.title === '套餐') continue; for (const row of (sec.rows || [])) { if (!Array.isArray(row) || typeof row[0] !== 'string') continue; const k = mn(row[0]); if (!k) continue; const o = sold[k] = sold[k] || {}; o[ym] = (o[ym] || 0) + (Number(row[1]) || 0) } } }
    for (const row of items) {
      const prods = prodBy[row.key] || []; if (!prods.length) { row.uses = null; continue }
      const menus = {}, recs = new Set()
      for (const p of prods) for (const code of [p.code, p.sku].filter(Boolean)) { const im = impact(code, 1); for (const m of im.menus) menus[m.menu] = Math.max(menus[m.menu] || 0, m.perServing); for (const r of im.recipes) recs.add(r) }
      const list = Object.entries(menus).map(([menu, per]) => { const sd = sold[mn(menu)] || {}; const s3 = last3.reduce((s, ym) => s + (sd[ym] || 0), 0); return { menu, per: Math.round(per * 100) / 100, sold: sd, sold3: s3, cost3: Math.round(per * s3) } }).sort((x, y) => (y.cost3 - x.cost3) || (y.per - x.per))
      row.uses = { menus: list.slice(0, 12), nMenus: list.length, recipes: [...recs].slice(0, 8), codes: prods.map(p => p.code).filter(Boolean).slice(0, 4) }
    }
  } catch (e) { for (const row of items) row.uses = row.uses || null; console.log('[veg] uses err', String(e.message || e).slice(0, 120)) }
  const ordSummary = {}; for (const l of lines) { const k = l.sup + '|' + l.store; ordSummary[k] = ordSummary[k] || { sup: l.sup, store: l.store, ok: 0, diff: 0, prev: 0, nomonth: 0, noitem: 0, unpriced: 0, n: 0 }; ordSummary[k][l.kind]++; ordSummary[k].n++ }
  const byItem = {}; for (const l of lines) { if (l.kind !== 'diff' && l.kind !== 'unpriced' && l.kind !== 'noitem') continue; const k = l.sup + '|' + l.store + '|' + l.kind + '|' + nk(l.name); const o = byItem[k] = byItem[k] || { sup: l.sup, store: l.store, kind: l.kind, name: l.name, n: 0, last: '', sample: [] }; o.n++; if (l.date > o.last) o.last = l.date; if (o.sample.length < 6) o.sample.push({ date: l.date, price: l.price, q: l.q, qty: l.qty, unit: l.unit }) }
  const ordIssues = Object.values(byItem).sort((a, b) => b.n - a.n)

  // ── 偵錯中心價格異常 vs 報價 ──
  const [todo, cards] = withChk ? await Promise.all([buildTodo({ kvGet, months }), buildCards({ kvGet, months })]) : [{ items: [] }, { supplies: {} }]
  const curBy = {}; for (const s of Object.values(cards.supplies || {})) if (s.code && !curBy[s.code]) curBy[s.code] = Number(s.price) || 0
  const anomalies = (todo.items || []).filter(i => i.tab === 'price' && VENDORS.includes(baseVendor(i.supplier))).map(i => { const m = matchVerdict(i, quoteOf, c => curBy[c]); return { id: i.id, supplier: i.supplier, code: i.code, name: i.name, signal: i.signal, date: i.date, title: i.title, decided: !!i.decision, verdict: m.verdict, detail: m.detail, impact: i.impact ? { nMenus: i.impact.nMenus, perServing: i.impact.perServing } : null } })
  const anomSummary = { hit: anomalies.filter(a => a.verdict === 'hit' && !a.decided).length, miss: anomalies.filter(a => a.verdict === 'miss' && !a.decided).length, noquote: anomalies.filter(a => a.verdict === 'noquote' && !a.decided).length, decided: anomalies.filter(a => a.decided).length, total: anomalies.length, allPrice: (todo.items || []).filter(i => i.tab === 'price').length }

  return { ok: true, months: allYm, vendors: VENDORS, sync: doc.sync || null, pins: doc.pins || [], ordMonths3: last3, ordMonths: mos, totals, chkLoaded: !!withChk, imported: Object.fromEntries(VENDORS.map(v => [v, { at: (doc.vendors[v] || {}).importedAt || null, n: (doc.vendors[v] || {}).n || 0, src: (doc.vendors[v] || {}).src || '', lastSync: (doc.vendors[v] || {}).lastSync || null, lastSyncErr: (doc.vendors[v] || {}).lastSyncErr || null, lastChanges: (doc.vendors[v] || {}).lastChanges || 0 }])), items, market: { fetchedAt: market.fetchedAt || null, market: '台北一', nCrops: Object.keys(market.crops || {}).length, nMapped: [...new Set(Object.values(MARKET_MAP))].length, errs: market.errs || [] }, orders: { months: mos, summary: Object.values(ordSummary), issues: ordIssues, nLines: lines.length }, anomalies, anomSummary }
}

// ── 一鍵確認「對上」的異常（走偵錯中心同一條決定流程，逐筆留紀錄，可 undo）──
export async function confirmMatched ({ kvGet, kvPut, who, months, ids, applyDecision }) {
  const cmp = await buildVegCmp({ kvGet, kvPut, months, withMarket: false, withChk: true })
  const want = new Set(Array.isArray(ids) && ids.length ? ids : cmp.anomalies.filter(a => a.verdict === 'hit' && !a.decided).map(a => a.id))
  const done = [], skipped = []
  for (const a of cmp.anomalies) {
    if (!want.has(a.id)) continue
    if (a.verdict !== 'hit') { skipped.push({ id: a.id, name: a.name, why: '沒對上報價' }); continue }
    if (a.decided) { skipped.push({ id: a.id, name: a.name, why: '已處理過' }); continue }
    const d0 = a.detail.find(x => x.hit) || a.detail[0]
    const note = `菜商報價單核對：${baseVendor(a.supplier)} ${d0.ym} 報價 ${d0.q ?? d0.qp} 元，${d0.lab} ${d0.p} 元一致`
    const r = await applyDecision({ kvGet, kvPut, who, body: { op: 'decide', id: a.id, st: 'ok', note, title: a.title } })
    if (r.ok) done.push({ id: a.id, name: a.name, supplier: a.supplier, note }); else skipped.push({ id: a.id, name: a.name, why: r.error })
  }
  return { ok: true, done, skipped }
}

// ── 釘選（共用一份，採購權限可改）──
export async function togglePin ({ kvGet, kvPut, who, key, on }) {
  const doc = (await kvGet(VQ_KEY)) || { vendors: {}, log: [] }
  const set = new Set(doc.pins || []); const k = String(key || ''); if (!k) return { ok: false, error: '缺品項' }
  if (on) set.add(k); else set.delete(k)
  doc.pins = [...set].slice(0, 200)
  await kvPut(VQ_KEY, doc, '菜商比價釘選(' + who.name + ')')
  return { ok: true, pins: doc.pins }
}
