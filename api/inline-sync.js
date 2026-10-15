// ── A Beach inline 訂位同步（張良 2026-10-03「所有訂位資訊紀錄」）────────────
// cron（vercel.json 每小時 :25）：
//   ①滾動窗「前 3 天 ～ 未來 45 天」逐日抓（新訂/改期/取消/入座隨時變）
//   ②遠期同步：搜尋端點一次收齊「45 天後全部未來訂位」（婚顧包場 2027/2028；張良要隨時答哪天被訂）
// 手動口（金鑰同 MENU_PROBE_KEY）：
//   ?backfill=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD → 回填區間（一次最多 150 天，歷史回填分批打）
//   ?probe=<key>                                   → 各月筆數盤點＋遠期清單
// 入庫：sp_finance_pm_inline_<YYYY-MM>＝{ days: { 'YYYY-MM-DD': [瘦身訂位…] }, updatedAt }（月檔，key=訂位日）
//       sp_finance_pm_inline＝{ firstDay, lastSync, months: {…}, farFuture: [{d,…}], dayNotes: {今天起的當日備註} }（總覽，AI/probe 用）
//       sp_finance_pm_inline_notes＝{ days: { 'YYYY-MM-DD': [{note,by,at}] } }（當日備註全史，RTDB branchDailyNotes）
import { inlineLogin, inlineFetchDay, inlineSearchFuture, inlineFetchDayNotes, inlineSearchKeyword, inlineCustomer, CANCELED_STATES } from './_inline.js'
import { kvGet, kvPut, announceChanged } from './mail-sync.js'

const DAY = 86400e3
const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10)

function dateRange(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

// 同步一段日期：登入一次、8 併發抓、按月整批寫回
// 空日逾時（_inline.js 6 秒坑）→ 跳過該日不動舊資料；skipped 回報出來（通常=公休/無訂位日，本來就空）
async function syncRange(from, to) {
  const days = dateRange(from, to)
  if (days.length > 150) throw new Error(`一次最多 150 天（現在 ${days.length}）`)
  const token = await inlineLogin()
  const byDay = {}
  const skipped = []
  for (let i = 0; i < days.length; i += 8) {
    await Promise.all(days.slice(i, i + 8).map(async (d) => {
      try { byDay[d] = await inlineFetchDay(token, d) }
      catch (e) { if (e?.isTimeout) { byDay[d] = null; skipped.push(d) } else throw e }
    }))
  }
  // 按月合併寫回（讀舊檔→覆蓋抓到的日→寫回；沒動到的日保留）
  const byMo = {}
  for (const d of days) (byMo[d.slice(0, 7)] = byMo[d.slice(0, 7)] || []).push(d)
  let resv = 0
  const sum = (await kvGet('sp_finance_pm_inline')) || { firstDay: '2021-02-10', months: {} }
  for (const [mo, ds] of Object.entries(byMo)) {
    const key = 'sp_finance_pm_inline_' + mo
    const doc = (await kvGet(key)) || { days: {} }
    for (const d of ds) {
      if (byDay[d] == null) continue // 逾時跳過：不動舊資料
      if (byDay[d].length) { doc.days[d] = byDay[d]; resv += byDay[d].length }
      else delete doc.days[d] // 空日不佔空間（公休/無訂位）
    }
    doc.updatedAt = new Date().toISOString()
    await kvPut(key, doc, 'inline訂位同步')
    sum.months[mo] = moStat(doc)
  }
  sum.lastSync = new Date().toISOString()
  await kvPut('sp_finance_pm_inline', sum, 'inline訂位同步')
  await announceChanged()
  return { days: days.length, resv, skipped }
}

// 月檔 → 總覽統計（guests 不含已取消 state 2/5）
const moStat = (doc) => {
  const dd = Object.values(doc.days)
  return { days: dd.length, resv: dd.reduce((t, a) => t + a.length, 0), guests: dd.reduce((t, a) => t + a.reduce((x, r) => x + (CANCELED_STATES.includes(r.st) ? 0 : r.n || 0), 0), 0) }
}

// 遠期同步：搜尋端點收齊全部未來訂位 → 「窗外（today+45 之後）」的日子以搜尋結果為準整批重建
// （含刪掉已全取消消失的日子；取消的遠期訂位等日子滾進 45 天窗會由 dailyUpdated 補回取消紀錄）
async function syncFuture(token) {
  const boundary = addDays(twToday(), 45) // ≤boundary 由滾動窗負責
  const byDate = await inlineSearchFuture(token)
  const far = {}
  for (const [d, arr] of Object.entries(byDate)) if (d > boundary) far[d] = arr
  const sum = (await kvGet('sp_finance_pm_inline')) || { firstDay: '2021-02-10', months: {} }
  // 要掃的月份＝遠期訂位所在月 ∪ 總覽裡 boundary 之後還有資料的月（才能清掉被取消而消失的日子）
  const mos = new Set(Object.keys(far).map((d) => d.slice(0, 7)))
  for (const mo of Object.keys(sum.months)) if (mo >= boundary.slice(0, 7)) mos.add(mo)
  let farResv = 0
  for (const mo of [...mos].sort()) {
    const key = 'sp_finance_pm_inline_' + mo
    const doc = (await kvGet(key)) || { days: {} }
    let changed = false
    for (const d of Object.keys(doc.days)) if (d > boundary && !far[d]) { delete doc.days[d]; changed = true }
    for (const [d, arr] of Object.entries(far)) if (d.slice(0, 7) === mo) { doc.days[d] = arr; farResv += arr.length; changed = true }
    if (changed) {
      doc.updatedAt = new Date().toISOString()
      await kvPut(key, doc, 'inline遠期同步')
      sum.months[mo] = moStat(doc)
      if (!sum.months[mo].days) delete sum.months[mo]
    }
  }
  // 遠期清單直接放總覽（AI 兩邊都載總覽＝不用撈到未來月檔就能答「哪天已被訂」）；候補(ty=4)不算「被訂」排除
  sum.farFuture = Object.keys(far).sort().flatMap((d) => far[d].filter((r) => r.ty !== 4).map((r) => ({ d, ...r })))
  // 當日備註（RTDB branchDailyNotes 一次整包；⚠️包場/公休註記＝婚顧檔期的另一真相來源）
  let notesInfo = {}
  try {
    const notes = await inlineFetchDayNotes(token)
    const today = twToday()
    sum.dayNotes = {} // 今天起的全部備註 → AI 直接讀
    for (const [d, arr] of Object.entries(notes)) if (d >= today) sum.dayNotes[d] = arr
    await kvPut('sp_finance_pm_inline_notes', { days: notes, updatedAt: new Date().toISOString() }, 'inline備註同步') // 全史另存一檔
    notesInfo = { noteDays: Object.keys(notes).length, futureNoteDays: Object.keys(sum.dayNotes).length }
  } catch (e) { notesInfo = { notesError: e?.message } }
  sum.lastSync = new Date().toISOString()
  await kvPut('sp_finance_pm_inline', sum, 'inline遠期同步')
  await announceChanged()
  return { farDays: Object.keys(far).length, farResv, ...notesInfo }
}

// ── 顧客資料庫＋營運洞察（張良 2026-10-04「建立inline顧客資料庫+九大數據分析頁」）──────
// 全史月檔掃一遍 → ①顧客聚合（key=cid→電話→名字）分段分頁存 sp_finance_pm_inline_cs_<seg>_<頁>
//   ②營運洞察 sp_finance_pm_inline_insights（年趨勢/週幾×時段/來源/提前天數/親子/目的/新舊客/取消率/大組）
//   ③索引 sp_finance_pm_inline_custidx {segments:{seg:{total,pages}}, builtAt}
// cron 每小時檢查：builtAt 超過 20 小時自動重建＝持續累積；手動 ?custbuild=MENU_KEY
const SEG_DEF = { // [標籤, 過濾, 排序, 最多頁數(每頁1000)]
  all: ['全部(有電話)', (c) => true, (a, b) => (b.l || '').localeCompare(a.l || ''), 5],
  vip: ['VIP常客≥10次', (c) => c.v >= 10, (a, b) => b.v - a.v, 2],
  repeat: ['回頭客≥2次', (c) => c.v >= 2, (a, b) => b.v - a.v, 3],
  kids: ['帶小孩', (c) => c.k > 0, (a, b) => (b.l || '').localeCompare(a.l || ''), 2],
  big: ['大組/包場≥20人', (c) => c.mx >= 20, (a, b) => b.mx - a.mx, 2],
  lost: ['流失常客(≥5次但180天沒來)', (c) => c.v >= 5, (a, b) => b.v - a.v, 2], // 180天門檻在 build 時補
  cxh: ['高取消', (c) => c.cx >= 3 && c.cx > c.v, (a, b) => b.cx - a.cx, 1],
  wed: ['婚禮/包場相關', (c) => /婚|包場/.test(c.n || ''), (a, b) => (b.l || '').localeCompare(a.l || ''), 1],
}
async function custBuild() {
  const sum = (await kvGet('sp_finance_pm_inline')) || { months: {} }
  const mos = Object.keys(sum.months || {}).sort()
  const today = twToday()
  const cust = {}
  // v4.40.0（張良「每張卡點進去要有更深的分析：年/月/平均/趨勢」）：洞察改存「逐月明細 m」＋大組清單 bigList，前端自由切年/月/平均
  const ins = { m: {}, bigList: [] }
  // v4.42.1（張良「眼見為憑：點 182/76 要看到詳細資料」）：近 14 個月的新/回「逐筆名單」另存 nr_<ym> 檔
  const NRD_FROM = addDays(today, -430).slice(0, 7)
  const nrd = {}
  const M9 = (ym) => ins.m[ym] = ins.m[ym] || { resv: 0, guests: 0, cxl: 0, kids: 0, nw: 0, rt: 0, big: 0, bigG: 0, src: {}, lead: { d0: 0, d1_3: 0, d4_7: 0, d8_30: 0, d31: 0 }, pp: {}, hp: Array.from({ length: 7 }, () => [0, 0, 0, 0]), hg: Array.from({ length: 7 }, () => [0, 0, 0, 0]), wdD: [0, 0, 0, 0, 0, 0, 0] }
  const slotIdx = (t) => (t < '13:00' ? 0 : t < '18:00' ? 1 : t < '19:00' ? 2 : 3)
  for (let i = 0; i < mos.length; i += 12) {
    const kvm = await Promise.all(mos.slice(i, i + 12).map((m) => kvGet('sp_finance_pm_inline_' + m)))
    for (const doc of kvm) {
      for (const [d, arr] of Object.entries(doc?.days || {})) {
        const ym = d.slice(0, 7), wd = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7
        const mm = M9(ym)
        let dayValid = false
        const dv = (mm.dy = mm.dy || {})[d.slice(8)] = (mm.dy[d.slice(8)] || {}), inc = (k, n9 = 1) => { dv[k] = (dv[k] || 0) + n9 } // v4.70.36 逐日明細（只選一個月時前端畫逐日趨勢線；r組/g人次/c取消/k親子/bg大組人次/nw新/rt回/ld有建立日/d0當天訂/bd慶生）
        for (const r of arr) {
          const canceled = CANCELED_STATES.includes(r.st)
          // 候補(ty=4)＝沒進店的人：全部主統計排除、另計 wlN/wlG（張良 2026-10-04「候補要切出來」）
          if (r.ty === 4) { if (!canceled) { mm.wlN = (mm.wlN || 0) + 1; mm.wlG = (mm.wlG || 0) + (r.n || 0) } continue }
          if (canceled) { mm.cxl++; inc('c') }
          else { mm.resv++; mm.guests += r.n || 0; inc('r'); inc('g', r.n || 0); if (r.ty === 1 || r.ty === 3) { mm.wkN = (mm.wkN || 0) + 1; mm.wkG = (mm.wkG || 0) + (r.n || 0) } }
          const name = (r.name || '').trim()
          const key = r.cid || r.phone || (name ? 'n:' + name : '')
          if (key) {
            const c = cust[key] = cust[key] || { n: name, ph: '', em: '', gd: 0, v: 0, b: 0, cx: 0, p: 0, k: 0, f: d, l: '', mx: 0 }
            if (name) c.n = name // 顧客檔名=最近一次訂位的名字（原取最長→抓到『同學會-Ginny』活動名，張良 2026-10-04 抓包）
            if ((r.phone || '').length > c.ph.length) c.ph = r.phone
            if (r.email && !c.em) c.em = r.email
            if (r.gd && !c.gd) c.gd = r.gd
            c.b++
            if (d < c.f) c.f = d
            const isFirst = c.b === 1
            if (canceled) c.cx++
            else {
              if (r.st === 4) { c.v++; c.p += r.n || 0 }
              c.k += (r.kc || 0) + (r.ks || 0)
              if ((r.n || 0) > c.mx) c.mx = r.n || 0
              if (d > c.l && d <= today) c.l = d
              // 新/回只算「可識別」客人（有客人檔或有效電話）——現場客代稱(外國人/王…)無法判斷新舊，算進去會灌水（張良 2026-10-04 抓包）
              if (r.cid || (r.phone || '').replace(/\D/g, '').length >= 8) {
                if (isFirst) { mm.nw++; inc('nw') } else { mm.rt++; inc('rt') }
                if (ym >= NRD_FROM) { // 眼見為憑逐筆名單（近14個月；回頭附首次來店日+第幾筆）
                  const g9 = nrd[ym] = nrd[ym] || { nw: [], rt: [] }
                  const lst = isFirst ? g9.nw : g9.rt
                  if (lst.length < 1600) lst.push({ d, t: r.t || '', nm: name || c.n, ph: c.ph || r.phone || '', n: r.n || 0, f: c.f, b: c.b, vz: c.v, ty: r.ty || 2 }) // nm=該筆名字非檔名、vz=至此已入座次數
                }
              }
            }
          }
          if (canceled) continue
          dayValid = true
          if ((r.kc || 0) + (r.ks || 0) > 0) { mm.kids++; inc('k') }
          if ((r.n || 0) >= 20) { mm.big++; mm.bigG += r.n; inc('bg', r.n); ins.bigList.push({ d, t: r.t || '', n: r.name || '', g: r.n }) }
          const sv = (r.ref || r.src || '其他').toLowerCase()
          const sk = /google/.test(sv) ? 'Google' : /fb|facebook|instagram|ig/.test(sv) ? 'FB/IG' : /opentable/.test(sv) ? 'OpenTable' : /host|ios|android/.test(sv) ? '店內/電話' : /web/.test(sv) ? '官網/線上' : '其他'
          mm.src[sk] = (mm.src[sk] || 0) + 1
          if (r.created) { const ld = Math.max(0, Math.round((new Date(d) - new Date(r.created.slice(0, 10))) / 86400e3)); mm.lead[ld === 0 ? 'd0' : ld <= 3 ? 'd1_3' : ld <= 7 ? 'd4_7' : ld <= 30 ? 'd8_30' : 'd31']++; inc('ld'); if (ld === 0) inc('d0') }
          const nt = String(r.note || '')
          const pk2 = /慶生|生日|birthday/i.test(nt) ? '慶生' : /約會|date/i.test(nt) ? '約會' : /家庭|親子|family/i.test(nt) ? '家庭' : /商務|公司|business/i.test(nt) ? '商務' : /一般/.test(nt) ? '一般' : nt ? '其他備註' : '未填'
          mm.pp[pk2] = (mm.pp[pk2] || 0) + 1; if (pk2 === '慶生') inc('bd')
          if (r.t) { mm.hp[wd][slotIdx(r.t)] += r.n || 0; mm.hg[wd][slotIdx(r.t)]++ }
        }
        if (dayValid) mm.wdD[wd]++
      }
    }
  }
  ins.bigList.sort((a, b) => b.d.localeCompare(a.d))
  if (ins.bigList.length > 900) ins.bigList = ins.bigList.slice(0, 900)
  // POS 真實來客/營收對帳（張良 2026-10-04「跟營業額人均對得起來嗎」→實測9月訂位人次=POS來客的110%，訂位有水分）
  // sp_finance_pm_pos entries（AB=日結信+boss回填）→ 每月 posG 來客/posRev 營收，前端算覆蓋率與人均
  try {
    const posDoc = await kvGet('sp_finance_pm_pos')
    for (const e of ((posDoc || {}).entries || [])) {
      if (/groun/i.test(e.store || '') || !e.date) continue
      const mm = M9(e.date.slice(0, 7))
      mm.posG = (mm.posG || 0) + (Number(e.guests) || 0)
      mm.posRev = (mm.posRev || 0) + (Number(e.revenue) || 0)
      mm.posD = (mm.posD || 0) + 1
    }
  } catch (_) {}
  // 分段寫入（只收「有有效電話」的＝識別得出同一人；現場代稱不進資料庫）
  const idd = Object.values(cust).filter((c) => c.n && c.ph.replace(/\D/g, '').length >= 8)
  const cutoff = addDays(today, -180)
  const idx = { builtAt: new Date().toISOString(), totalAll: Object.keys(cust).length, identified: idd.length, segments: {} }
  const named = Object.values(cust).filter((c) => c.n) // 婚禮/包場常沒留電話 → wed 段不要求電話
  for (const [seg, [label, filt, sorter, maxPg]] of Object.entries(SEG_DEF)) {
    let list = (seg === 'wed' ? named : idd).filter(filt)
    if (seg === 'lost') list = list.filter((c) => c.l && c.l < cutoff)
    list.sort(sorter)
    const pages = Math.min(maxPg, Math.ceil(list.length / 1000) || 0)
    for (let p = 0; p < pages; p++) await kvPut(`sp_finance_pm_inline_cs_${seg}_${p}`, { rows: list.slice(p * 1000, p * 1000 + 1000) }, 'inline顧客庫')
    idx.segments[seg] = { label, total: list.length, pages }
  }
  for (const [ym9, g9] of Object.entries(nrd)) await kvPut(`sp_finance_pm_inline_nr_${ym9}`, { ...g9, builtAt: new Date().toISOString() }, 'inline新回名單')
  // v4.71.14 電話索引（收件匣客戶資料用）：手機後 9 碼 → [名字,來店,取消,第一次,最近,最大人數,訂位數]
  //   依後 3 碼分 1000 檔（每檔約 5KB，查一個人只讀一小檔；原 v4.71.12 分 100 檔每檔 50KB 太慢）；一次批次寫 100 檔
  { const sh = {}; for (const c of idd) { const k = c.ph.replace(/\D/g, '').slice(-9); if (k.length !== 9) continue; const b = sh[k.slice(-3)] = sh[k.slice(-3)] || {}; const o = b[k]; if (!o || (c.l || '') > (o[4] || '')) b[k] = [c.n, c.v, c.cx, c.f, c.l, c.mx, c.b] }
    const { SB_URL: U9, SB_KEY: K9 } = await import('./_onboard.js'); const now9 = new Date().toISOString()
    const rows9 = Array.from({ length: 1000 }, (_, i) => { const d3 = String(i).padStart(3, '0'); return { id: 'sp_finance_pm_inline_ph3_' + d3, data: { v: JSON.stringify({ rows: sh[d3] || {}, builtAt: now9 }) }, editor: 'inline電話索引', updated_at: now9 } })
    for (let i = 0; i < rows9.length; i += 100) await fetch(`${U9}/rest/v1/pm_documents`, { method: 'POST', headers: { apikey: K9, Authorization: `Bearer ${K9}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows9.slice(i, i + 100)) })
    // 收掉 v4.71.12 的舊版 100 檔（sp_finance_pm_inline_ph_00~99，只有收件匣用過的衍生索引）
    await fetch(`${U9}/rest/v1/pm_documents?id=in.(${Array.from({ length: 100 }, (_, i) => 'sp_finance_pm_inline_ph_' + String(i).padStart(2, '0')).join(',')})`, { method: 'DELETE', headers: { apikey: K9, Authorization: `Bearer ${K9}` } }).catch(() => {}) }
  await kvPut('sp_finance_pm_inline_insights', ins, 'inline洞察')
  await kvPut('sp_finance_pm_inline_custidx', idx, 'inline顧客庫索引')
  await announceChanged()
  // 自我驗證（2026-10-04 洞察檔悄悄寫失敗抓包）：寫完馬上讀回，讀不到=回報大小與錯誤
  const chk = await kvGet('sp_finance_pm_inline_insights')
  return { identified: idd.length, insightsOk: !!(chk && chk.m), insSize: JSON.stringify(ins).length, segments: Object.fromEntries(Object.entries(idx.segments).map(([k, v]) => [k, v.total])) }
}

// ── 📅 近期展望（v4.70.63 張良 2026-10-12「首頁都是歷史數據，缺近期分析／國定假日訂位提醒／行動建議」）──
// 回答三件事：①未來 14 天每天已訂多少、去年同一週同一天真實來客多少 ②下個連假倒數：現在已訂 vs 去年同期「同距離天數」已訂 vs 去年最終 ③要你做的事
// 資料全現成：inline 月檔（未來訂位含 created 建立時間）＋ sp_finance_pm_pos（AB 日結來客）＋ 行事曆快取 sp_finance_pm_twhol_<年>
const isCx = (r) => CANCELED_STATES.includes(r.st)
const SEATS_AB = 90 // 座位參考值（算滿座率用；張良要改在這裡改）
async function holYear(y) { // 行事曆：同 mail-sync ?twhol 的快取鍵（去年檔沒抓過就現抓一次存起來）
  let doc = await kvGet('sp_finance_pm_twhol_' + y).catch(() => null)
  if (!doc || !doc.ts || Date.now() - new Date(doc.ts).getTime() > 14 * 86400e3) {
    try {
      const r9 = await fetch('https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/' + y + '.json')
      if (r9.ok) {
        const arr = await r9.json(); const h9 = {}, w9 = {}
        for (const x of arr) { if (!x.description) continue; const s8 = String(x.date); const dt = s8.includes('-') ? s8 : (s8.slice(0, 4) + '-' + s8.slice(4, 6) + '-' + s8.slice(6, 8)); if (x.isHoliday) h9[dt] = x.description; else w9[dt] = x.description }
        doc = { ts: new Date().toISOString(), hol: h9, wk: w9 }
        await kvPut('sp_finance_pm_twhol_' + y, doc, '行事曆快取')
      }
    } catch (_) {}
  }
  const fx = (o) => { const r = {}; for (const [k, v] of Object.entries(o || {})) r[k.includes('-') ? k : (k.slice(0, 4) + '-' + k.slice(4, 6) + '-' + k.slice(6, 8))] = v; return r }
  return doc ? fx(doc.hol) : {}
}
// 連假分塊：連續的假日（含補假）合成一塊；名稱取最有意義的假名（跳過「補假」）
function holBlocks(hol, from, to) {
  const days = Object.keys(hol).filter((d) => d >= from && d <= to).sort()
  const blocks = []
  for (const d of days) {
    const last = blocks[blocks.length - 1]
    if (last && addDays(last.to, 1) === d) { last.to = d; last.days.push(d); if (last.name === '補假' && hol[d] !== '補假') last.name = hol[d] }
    else blocks.push({ from: d, to: d, days: [d], name: hol[d] })
  }
  for (const b of blocks) b.name = holShort(b.name)
  return blocks
}
const holShort = (n) => String(n || '').replace(/臺灣光復暨金門古寧頭大捷紀念日/, '光復節').replace(/開國紀念日/, '元旦').replace(/農曆除夕/, '除夕').replace(/和平紀念日/, '228').replace(/行憲紀念日/, '行憲日')
const dayStat = (arr) => { // 一天的訂位 → 統計（候補 ty=4 不算人次；待確認 st=3 另計）
  const o = { r: 0, g: 0, l: 0, dn: 0, wl: 0, uc: 0, ucG: 0, big: 0, bg: 0 }
  for (const r of arr || []) {
    if (isCx(r)) continue
    if (r.ty === 4) { o.wl++; continue }
    o.r++; o.g += r.n || 0
    if ((r.t || '') < '16:00') o.l += r.n || 0; else o.dn += r.n || 0
    if (r.st === 3) { o.uc++; o.ucG += r.n || 0 }
    if ((r.n || 0) >= 20) { o.big++; o.bg += r.n || 0 }
  }
  return o
}
// 某日在「截止時間點」之前已建立的有效訂位人次（去年同期這時候已訂多少＝公平比較的基準）
const bookedBy = (arr, cutoff) => (arr || []).reduce((t, r) => t + (!isCx(r) && r.ty !== 4 && (r.created || '').slice(0, 10) <= cutoff ? (r.n || 0) : 0), 0)
// 天氣（v4.70.64 第二批）：Open-Meteo 免金鑰，A Beach＝台北信義區；KV 快取 3 小時
const WX_LAT = 25.0336, WX_LON = 121.5645
const wxName = (c) => c === 0 ? '晴' : c <= 2 ? '多雲' : c === 3 ? '陰' : c <= 48 ? '霧' : c <= 57 ? '毛毛雨' : c <= 67 ? '雨' : c <= 77 ? '雪' : c <= 82 ? '陣雨' : '雷雨'
async function weather14() {
  const cached = await kvGet('sp_finance_pm_wx').catch(() => null)
  if (cached && cached.ts && Date.now() - new Date(cached.ts).getTime() < 3 * 3600e3) return cached.days || {}
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${WX_LAT}&longitude=${WX_LON}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTaipei&forecast_days=14`)
    if (!r.ok) throw new Error('wx ' + r.status)
    const j = await r.json(); const dd = j.daily || {}; const days = {}
    ;(dd.time || []).forEach((d, i) => { days[d] = { c: dd.weather_code[i], n: wxName(dd.weather_code[i]), hi: Math.round(dd.temperature_2m_max[i]), lo: Math.round(dd.temperature_2m_min[i]), pop: dd.precipitation_probability_max[i] } })
    await kvPut('sp_finance_pm_wx', { ts: new Date().toISOString(), days }, '天氣快取')
    return days
  } catch (_) { return (cached || {}).days || {} }
}
// 班表（NUEiP 同步月檔 sp_crew_pm_hr_sched_）：某日排班人數／總時數／名單（休例假沒 start 不算）
const hhm = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null }
function shiftStat(list) {
  const o = { n: 0, h: 0, fo: 0, ki: 0, lh: 0, dh: 0, names: [] } // lh/dh＝午場（16:00 前）／晚場（16:00 後）人力時數（v4.70.81 人力建議用）
  for (const x of list || []) {
    const a = hhm(x.start), b = hhm(x.end); if (a == null || b == null) continue
    let mins = b - a; if (mins <= 0) mins += 1440
    const brk = Number(x.brk) || 0; mins -= brk >= 30 ? brk : brk * 60 // brk 可能是分鐘或小時
    if (mins <= 0) continue
    o.n++; o.h += mins / 60
    const lm = Math.max(0, Math.min(b, 16 * 60) - a); o.lh += Math.min(lm, mins) / 60; o.dh += Math.max(0, mins - lm) / 60
    if (/內/.test(x.dept || '')) o.ki++; else o.fo++
    o.names.push(`${x.name}${x.pt ? '(PT)' : ''} ${x.start}-${x.end}`)
  }
  o.h = +o.h.toFixed(1); o.lh = +o.lh.toFixed(1); o.dh = +o.dh.toFixed(1)
  return o
}
// 要你做的事（v4.70.81 從前端搬到後端：首頁、DD、每週一摘要三邊同一份；每條有穩定 key＝可勾完成／派任務）
// 文字用 **粗體** 標記，前端轉 <b>、LINE 去掉星號
const mdOf = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
const wdOf = (d) => '日一二三四五六'[new Date(d + 'T00:00:00Z').getUTCDay()]
const isWkd = (d) => [0, 5, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())
function custActs(ol) {
  const acts = [], td = ol.today
  const lvOf = (x) => { const base = x.ly.pos || x.ly.g; if (!base) return { k: 'na', r: null }; const r = (x.est || x.g) / base; return { k: r >= 0.8 ? 'hot' : r < 0.5 ? 'cold' : 'ok', r } }
  for (const x of ol.hols || []) {
    if (x.status === 'behind') acts.push({ k: `hol_${x.from}`, d: '0', p: 0, kind: 'hol', c: '#F07373', t: `**${x.name}**倒數 ${x.left} 天，已訂 ${x.g} 人只有去年此時（${x.ly.then}）的 ${x.ratio}%：按「去年來過、今年沒訂」撈名單＋產文案推給他們、社群發連假檔期` })
  }
  for (const x of ol.days || []) {
    const lv = lvOf(x), lb = `${mdOf(x.d)}（${wdOf(x.d)}）`, pc = lv.r != null ? Math.round(lv.r * 100) : null, base = x.ly.pos || x.ly.g
    if (x.uc) acts.push({ k: `uc_${x.d}`, d: x.d, p: 1, kind: 'uc', c: '#E8A657', t: `${lb}有 **${x.uc} 組 ${x.ucG} 人**待確認，請電話確認` })
    if (x.big) acts.push({ k: `big_${x.d}`, d: x.d, p: 2, kind: 'big', c: '#C792EA', t: `${lb}有 **${x.big} 組 20 人以上大組**：留桌、備料、排人` })
    if (lv.k === 'hot') acts.push({ k: `hot_${x.d}`, d: x.d, p: 3, kind: 'hot', c: '#F07373', t: `${lb}已訂 ${x.g} 人、預估最終 **${x.est} 人**，是去年同日 ${base} 人的 ${pc}%：排班加人、備料加量${x.wl ? '、候補已有 ' + x.wl + ' 組' : ''}` })
    // 人力：排班時數 vs 「近 8 週同週幾平均時數 × 預估人次／平均人次」＝這天需要的時數；差 1 人以上才講，講到時段與人數（v4.70.81 第 6 項）
    if (x.sh && x.sh.h && x.sh.avgH && x.sh.avgG) {
      const need = +(x.sh.avgH * Math.min(1.8, Math.max(0.6, (x.est || x.g) / x.sh.avgG))).toFixed(1)
      const diff = +(x.sh.h - need).toFixed(1), per = x.sh.n ? Math.max(5, x.sh.h / x.sh.n) : 7 // 一人一班平均時數
      const slot = (x.l + x.dn) ? (x.l >= x.dn ? '午場' : '晚場') : (x.sh.lh >= x.sh.dh ? '午場' : '晚場')
      const far = x.d > addDays(td, 6) && x.sh.h < x.sh.avgH * 0.85 ? '（一週後的班表可能還沒排完，先參考）' : ''
      if (diff <= -per) acts.push({ k: `staffL_${x.d}`, d: x.d, p: 3.5, kind: 'staff', c: '#F07373', t: `${lb}預估 ${x.est || x.g} 人（近 8 週同週幾平均 ${Math.round(x.sh.avgG)} 人排 ${Math.round(x.sh.avgH)} 小時）需要約 ${Math.round(need)} 小時，現排 ${x.sh.n} 人 ${Math.round(x.sh.h)} 小時：**${slot}建議加 ${Math.min(6, Math.ceil(-diff / per))} 人**（約 ${Math.round(-diff)} 小時）${far}` })
      else if (diff >= per && x.d > td) { const cut = x.sh.lh >= x.sh.dh ? '午場' : '晚場'; acts.push({ k: `staffH_${x.d}`, d: x.d, p: 3.5, kind: 'staff', c: '#8C98A8', t: `${lb}預估只有 ${x.est || x.g} 人（平均 ${Math.round(x.sh.avgG)}），需要約 ${Math.round(need)} 小時，現排 ${x.sh.n} 人 ${Math.round(x.sh.h)} 小時：**${cut}可少 ${Math.floor(diff / per)} 人**（省約 ${Math.round(diff)} 小時）` }) }
    }
    if (x.wx && x.wx.pop >= 60 && isWkd(x.d)) acts.push({ k: `rain_${x.d}`, d: x.d, p: 5, kind: 'rain', c: '#6EB1FF', t: `${lb}降雨機率 ${x.wx.pop}%（${x.wx.n}）：週末現場客會少，備料保守、提醒訂位客` })
    if (lv.k === 'cold' && isWkd(x.d) && x.d > td) acts.push({ k: `cold_${x.d}`, d: x.d, p: 4, kind: 'cold', c: '#8C98A8', t: `${lb}週末已訂 ${x.g} 人、預估最終只有 **${x.est} 人**（去年同日 ${base}）：社群發文、推熟客補客` })
  }
  for (const x of ol.week || []) { if (x.ratio != null && x.ratio < 70) acts.push({ k: `low_${x.d}`, d: x.d, p: 6, kind: 'low', c: '#E8A657', t: `上週 ${mdOf(x.d)}（${wdOf(x.d)}）只來 **${x.g} 人**，近 8 週同週幾平均 ${x.base}（${x.ratio}%）：查那天發生什麼（天氣／活動／評論）` }) }
  acts.sort((a, b) => a.d.localeCompare(b.d) || a.p - b.p)
  return acts.slice(0, 16)
}
const ACT_ST_KEY = 'sp_finance_pm_inline_actst' // 行動建議狀態 {keys:{k:{st:'done',by,at,tid}}}；key 帶日期，30 天自動清
async function actStates() { const d = (await kvGet(ACT_ST_KEY)) || { keys: {} }; const lim = addDays(twToday(), -30); for (const k of Object.keys(d.keys || {})) { const m = /(\d{4}-\d{2}-\d{2})/.exec(k); if (m && m[1] < lim) delete d.keys[k] }; return d }
// 身分：GD 個人連結 token → 名字（跟 mail-sync permWho 同一套：綁定檔＋名冊停權＋核准模式）；守門 inline 分頁
async function whoTok(tk) {
  if (!tk) return null
  const b = (await kvGet('sp_finance_pm_prep_bind')) || {}
  const w = (b.tokens || {})[tk]; if (!w) return null
  try { const r5 = (await kvGet('sp_crew_kb_roster')) || {}; const p5 = (r5.people || []).find((x) => x.id === w.rid); if (p5 && p5.gdRole === '停權') return null } catch (_) {}
  const pm = (await kvGet('sp_finance_pm_prep_perm')) || { mode: 'open', users: {} }
  if (pm.mode !== 'approve') return w
  const u = pm.users[w.rid || w.uid]
  return (u && u.edit && (u.admin || !u.tabs || u.tabs.cust !== 0)) ? w : null
}
async function custOutlook() {
  const today = twToday(), y0 = +today.slice(0, 4)
  const H14 = dateRange(today, addDays(today, 13))
  const [holA, holB, holC] = await Promise.all([holYear(y0 - 1), holYear(y0), holYear(y0 + 1)])
  const hol = { ...holB, ...holC }, holLY = holA
  const blocks = holBlocks(hol, today, addDays(today, 120)).slice(0, 2) // 接下來兩個連假
  // 要讀的月檔：未來 14 天＋連假日＋去年同期（同週同日＝ -364 天；去年同名假日）
  const need = new Set()
  const want = (d) => need.add(d.slice(0, 7))
  for (const d of H14) { want(d); want(addDays(d, -364)) }
  const PAST = dateRange(addDays(today, -63), addDays(today, -1)) // 近 7 天回顧＋近 8 週同週幾基準＋排班基準
  for (const d of PAST) want(d)
  const lyBlocks = holBlocks(holLY, `${y0 - 1}-01-01`, `${y0}-12-31`)
  for (const b of blocks) {
    for (const d of b.days) want(d)
    const key = b.name
    let ly = lyBlocks.find((x) => x.name === key && x.days.length === b.days.length) || lyBlocks.find((x) => x.name === key)
    if (!ly) { const ds = b.days.map((d) => addDays(d, -364)); ly = { from: ds[0], to: ds[ds.length - 1], days: ds, name: b.name, approx: true } } // 去年沒有同名假（新假）→ 用去年同一週同一天代替
    b.ly = ly
    for (const d of ly.days) want(d)
  }
  const docs = {}, sched = {}
  const schMos = new Set([...PAST, ...H14].map((d) => d.slice(0, 7)))
  const [wx] = await Promise.all([weather14(), ...[...need].map(async (m) => { docs[m] = (await kvGet('sp_finance_pm_inline_' + m)) || { days: {} } }), ...[...schMos].map(async (m) => { sched[m] = (await kvGet('sp_crew_pm_hr_sched_' + m)) || { days: {} } })])
  const schArr = (d) => (sched[d.slice(0, 7)] || { days: {} }).days[d] || []
  const dayArr = (d) => (docs[d.slice(0, 7)] || { days: {} }).days[d] || []
  // POS 真實來客（AB）
  const pos = {}
  try { for (const e of (((await kvGet('sp_finance_pm_pos')) || {}).entries || [])) { if (/groun/i.test(e.store || '') || !e.date) continue; pos[e.date] = { g: Number(e.guests) || 0, rev: Number(e.revenue) || 0 } } } catch (_) {}
  // ① 未來 14 天
  const strip = (r) => ({ t: r.t || '', nm: r.name || '', n: r.n || 0, st: r.st, ty: r.ty, kc: (r.kc || 0) + (r.ks || 0), note: (r.note || r.inote || '').slice(0, 40) })
  // 近 8 週同週幾基準（到店人次／排班時數）→ 人力過多不足的比較底
  const wdG = Array.from({ length: 7 }, () => []), wdH = Array.from({ length: 7 }, () => [])
  for (const d of PAST.slice(-56)) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); const g = dayStat(dayArr(d)).g; if (g) wdG[w].push(g); const sh = shiftStat(schArr(d)); if (sh.h) wdH[w].push(sh.h) }
  const avg = (a) => a.length ? Math.round(a.reduce((t, v) => t + v, 0) / a.length * 10) / 10 : 0
  // 進單曲線（v4.70.81 第 1 項「預估最終」）：近 8 週每一天，「距當天還剩 L 天時已訂的人次 ÷ 最終到店人次」，週末／假日與平日分開算
  // → 未來第 L 天的預估最終＝目前已訂 ÷ 曲線[L]。13 天後的日子本來就還沒訂滿，不能直接跟去年最終比，這樣才公平
  const fill = { w: Array.from({ length: 14 }, () => [0, 0]), d: Array.from({ length: 14 }, () => [0, 0]) }
  for (const d of PAST.slice(-56)) { const arr = dayArr(d), g = dayStat(arr).g; if (!g) continue; const f = (isWkd(d) || hol[d]) ? fill.w : fill.d; for (let L = 0; L < 14; L++) { f[L][0] += bookedBy(arr, addDays(d, -L)); f[L][1] += g } }
  const fillAt = (d, L) => { const f = ((isWkd(d) || hol[d]) ? fill.w : fill.d)[L]; return f && f[1] >= 40 ? f[0] / f[1] : null }
  const days = H14.map((d, i) => {
    const ly = addDays(d, -364), s = dayStat(dayArr(d)), ls = dayStat(dayArr(ly)), w = new Date(d + 'T00:00:00Z').getUTCDay()
    const sh = shiftStat(schArr(d))
    const fr = fillAt(d, i), est = fr != null && fr >= 0.15 ? s.bg + Math.round((s.g - s.bg) / fr) : s.g // 大組（≥20 人）不放大：那種都是提早幾週訂好的，只有散客照曲線補
    return { d, hol: holShort(hol[d] || ''), ...s, est: Math.max(est, s.g), fill: fr != null ? Math.round(fr * 100) : null, wx: wx[d] || null, sh: { n: sh.n, h: sh.h, fo: sh.fo, ki: sh.ki, lh: sh.lh, dh: sh.dh, names: sh.names.slice(0, 30), avgH: avg(wdH[w]), avgG: avg(wdG[w]) }, ly: { d: ly, g: ls.g, r: ls.r, pos: (pos[ly] || {}).g || 0, rev: (pos[ly] || {}).rev || 0 }, list: dayArr(d).filter((r) => !isCx(r)).sort((a, b) => (a.t || '').localeCompare(b.t || '')).slice(0, 60).map(strip) }
  })
  // ② 連假倒數
  const hols = blocks.map((b) => {
    const left = Math.round((new Date(b.from) - new Date(today)) / DAY)
    let g = 0, r = 0, uc = 0
    for (const d of b.days) { const s = dayStat(dayArr(d)); g += s.g; r += s.r; uc += s.ucG }
    const ly = b.ly
    const cutoff = addDays(ly.from, -left) // 去年同一個假、同樣剩 left 天的那一天
    let lyThen = 0, lyFinal = 0, lyPos = 0, lyRev = 0
    for (const d of ly.days) { const arr = dayArr(d); lyThen += bookedBy(arr, cutoff); lyFinal += dayStat(arr).g; lyPos += (pos[d] || {}).g || 0; lyRev += (pos[d] || {}).rev || 0 }
    const ratio = lyThen ? Math.round(g / lyThen * 100) : null
    const status = ratio == null ? 'na' : ratio < 70 ? 'behind' : ratio > 110 ? 'ahead' : 'ok'
    const est = lyThen && lyFinal ? Math.max(g, Math.round(g * lyFinal / lyThen)) : g // 照去年同距離天數的進單比例推最終
    return { name: b.name, from: b.from, to: b.to, days: b.days, left, g, r, uc, est, ly: { from: ly.from, to: ly.to, approx: !!ly.approx, then: lyThen, final: lyFinal, pos: lyPos, rev: lyRev }, ratio, status, gap: Math.max(0, lyFinal - g) }
  })
  // ③ 近 7 天回顧：每天到店人次 vs 近 8 週同週幾平均（±30% 點名）＋POS 真實來客/營收
  const week = PAST.slice(-7).map((d) => {
    const w = new Date(d + 'T00:00:00Z').getUTCDay(), s = dayStat(dayArr(d))
    const base = avg(wdG[w].filter((_, i) => true)), ratio = base ? Math.round(s.g / base * 100) : null
    return { d, g: s.g, r: s.r, l: s.l, dn: s.dn, base, ratio, pos: (pos[d] || {}).g || 0, rev: (pos[d] || {}).rev || 0, sh: shiftStat(schArr(d)).h }
  })
  const ol = { today, seats: SEATS_AB, days, hols, week, builtAt: new Date().toISOString() }
  ol.acts = custActs(ol)
  return ol
}
// 連假「去年來過、今年還沒訂」名單（v4.70.81 第 5 項）：去年同一個假（或去年同週同日）有效訂位且有電話的客人，今年到連假結束前都沒再訂 → 推給他們
async function holLost(ol, from) {
  const h = (ol.hols || []).find((x) => x.from === from); if (!h) return null
  const need = new Set([...h.ly.days || dateRange(h.ly.from, h.ly.to), ...dateRange(ol.today, h.to)].map((d) => d.slice(0, 7)))
  const docs = {}; await Promise.all([...need].map(async (m) => { docs[m] = (await kvGet('sp_finance_pm_inline_' + m)) || { days: {} } }))
  const arr = (d) => (docs[d.slice(0, 7)] || { days: {} }).days[d] || []
  const digits = (p) => String(p || '').replace(/\D/g, '')
  const booked = new Set()
  for (const d of dateRange(ol.today, h.to)) for (const r of arr(d)) { if (!isCx(r) && digits(r.phone).length >= 8) booked.add(digits(r.phone)) }
  const seen = {}
  for (const d of dateRange(h.ly.from, h.ly.to)) for (const r of arr(d)) {
    if (isCx(r) || r.ty === 4) continue
    const ph = digits(r.phone); if (ph.length < 8 || booked.has(ph)) continue
    const c = seen[ph] = seen[ph] || { nm: r.name || '', ph: r.phone || '', n: 0, d, t: r.t || '', note: '' }
    if ((r.n || 0) > c.n) { c.n = r.n || 0; c.nm = r.name || c.nm; c.d = d; c.t = r.t || ''; c.note = String(r.note || r.inote || '').replace(/Purpose:.*?(,|$)/, '').slice(0, 30) }
  }
  const rows = Object.values(seen).sort((a, b) => b.n - a.n)
  return { name: h.name, from: h.from, to: h.to, left: h.left, lyFrom: h.ly.from, lyTo: h.ly.to, approx: h.ly.approx, rows, total: rows.length, g: rows.reduce((t, r) => t + r.n, 0) }
}
// 每週一 09:00 LINE 摘要（v4.70.81 第 3 項）：本週 7 天預估 vs 去年、連假倒數、上週回顧、前五件要做的事；跟首頁同一份數字
async function weeklyDigest(ol) {
  const tw = new Date(Date.now() + 8 * 3600e3)
  if (tw.getUTCDay() !== 1 || tw.getUTCHours() !== 9) return { skip: 'notMon9' }
  const log = (await kvGet('sp_finance_pm_inline_alerts')) || {}
  const k = 'wk_' + ol.today; if (log[k]) return { skip: 'sent' }
  log[k] = new Date().toISOString(); await kvPut('sp_finance_pm_inline_alerts', log, 'inline每週摘要')
  const st = await actStates()
  const wk = ol.days.slice(0, 7)
  const lines = [`📊 本週展望（${mdOf(wk[0].d)}～${mdOf(wk[6].d)}）`]
  for (const x of wk) { const base = x.ly.pos || x.ly.g; const pc = base ? Math.round((x.est || x.g) / base * 100) : null; lines.push(`${mdOf(x.d)}(${wdOf(x.d)})${x.hol ? x.hol : ''} 已訂${x.g}→預估${x.est}${base ? `／去年${base}(${pc}%)` : ''}${x.uc ? `・待確認${x.uc}組` : ''}${x.wx && x.wx.pop >= 60 ? `・${x.wx.n}${x.wx.pop}%` : ''}`) }
  for (const h of ol.hols || []) { if (h.left <= 60) lines.push(`📅 ${h.name} 倒數 ${h.left} 天：已訂 ${h.g}${h.ly.then ? `／去年此時 ${h.ly.then}（${h.ratio}%${h.status === 'behind' ? '，落後' : h.status === 'ahead' ? '，超前' : ''}）` : ''}`) }
  const tot = ol.week.reduce((t, x) => t + x.g, 0), totB = ol.week.reduce((t, x) => t + x.base, 0)
  lines.push(`↩ 上週到店 ${tot} 人${totB ? `，近 8 週同期平均 ${Math.round(totB)}（${Math.round(tot / totB * 100)}%）` : ''}`)
  const open = (ol.acts || []).filter((a) => !((st.keys || {})[a.k] || {}).st).slice(0, 5)
  if (open.length) { lines.push('✅ 要你做的事：'); open.forEach((a, i) => lines.push(`${i + 1}. ${a.t.replace(/\*\*/g, '')}`)) }
  lines.push('完整版：/prep → inline')
  const { notifyOps } = await import('./_onboard.js')
  await notifyOps(lines.join('\n'))
  return { weekly: 1 }
}
// 明日大組未確認（第二批）：每天台灣 16 點那次 cron，明天 6 人以上還是「待確認」→ 私訊審核人；一天一次
async function bigAlert() {
  const h = new Date(Date.now() + 8 * 3600e3).getUTCHours()
  if (h !== 16) return { skip: 'not16' }
  const tmr = addDays(twToday(), 1)
  const log = (await kvGet('sp_finance_pm_inline_alerts')) || {}
  if (log['big_' + tmr]) return { skip: 'sent' }
  const doc = (await kvGet('sp_finance_pm_inline_' + tmr.slice(0, 7))) || { days: {} }
  const big = (doc.days[tmr] || []).filter((r) => !isCx(r) && r.ty !== 4 && (r.n || 0) >= 6 && r.st === 3).sort((a, b) => (a.t || '').localeCompare(b.t || ''))
  log['big_' + tmr] = new Date().toISOString()
  await kvPut('sp_finance_pm_inline_alerts', log, 'inline明日大組提醒')
  if (!big.length) return { big: 0 }
  const { notifyOps } = await import('./_onboard.js')
  const tot = big.reduce((t, r) => t + (r.n || 0), 0)
  await notifyOps(`📋 明天（${tmr.slice(5).replace('-', '/')}）有 ${big.length} 組大桌共 ${tot} 人還沒確認，18:00 前請電話確認：\n${big.slice(0, 12).map((r) => `・${r.t || '--:--'} ${r.name || '未填名'} ${r.n} 人${r.phone ? ' ' + r.phone.replace(/^\+886/, '0') : ''}`).join('\n')}${big.length > 12 ? `\n…共 ${big.length} 組` : ''}`)
  return { big: big.length }
}
// 連假落後提醒（cron 每小時進來、台灣時間 10 點那次才跑）：距連假 14／7／3 天時，已訂低於去年同期七成 → 私訊審核人；同一假同一天數只發一次
async function holidayAlert(ol) {
  const h = new Date(Date.now() + 8 * 3600e3).getUTCHours()
  if (h !== 10) return { skip: 'not10' }
  ol = ol || await custOutlook()
  const log = (await kvGet('sp_finance_pm_inline_alerts')) || {}
  const sent = []
  for (const x of ol.hols) {
    if (![14, 7, 3].includes(x.left)) continue
    const k = `${x.from}_${x.left}`
    if (log[k]) continue
    log[k] = new Date().toISOString()
    if (x.status !== 'behind') continue
    const { notifyOps } = await import('./_onboard.js')
    const rng = x.from === x.to ? x.from.slice(5).replace('-', '/') : `${x.from.slice(5).replace('-', '/')}～${x.to.slice(5).replace('-', '/')}`
    const txt = `📅 連假訂位落後提醒｜${x.name}（${rng}）倒數 ${x.left} 天\n目前已訂 ${x.g} 人（${x.r} 組）\n去年此時已訂 ${x.ly.then} 人 → 只有去年的 ${x.ratio}%\n去年最終 ${x.ly.final} 人訂位／POS 實際來客 ${x.ly.pos} 人\n建議：推給流失常客、社群發連假檔期（/prep → inline → 連假倒數卡有名單）`
    await notifyOps(txt)
    sent.push(k)
  }
  await kvPut('sp_finance_pm_inline_alerts', log, 'inline連假提醒')
  return { alerts: sent }
}

export default async function handler(req, res) {
  const mk = (process.env.MENU_PROBE_KEY || '').trim()
  try {
    // 盤點口
    if (req.query?.probe) {
      if (!mk || String(req.query.probe) !== mk) return res.status(403).json({ ok: false })
      const sum = (await kvGet('sp_finance_pm_inline')) || {}
      return res.status(200).json({ ok: true, sum })
    }
    // 顧客資料庫（/prep inline 分頁用；OPS 金鑰）
    const ok9 = (q) => { const k = (process.env.OPS_BOARD_KEY || '').trim(); return k && String(q) === k }
    if (req.query?.custdb) { // ?custdb=OPS&seg=all&page=0 → 索引+該頁名單
      if (!ok9(req.query.custdb)) return res.status(403).json({ ok: false })
      const seg = SEG_DEF[String(req.query.seg || 'all')] ? String(req.query.seg || 'all') : 'all'
      const pg = Math.max(0, Number(req.query.page) || 0)
      const [idx, shard] = await Promise.all([kvGet('sp_finance_pm_inline_custidx'), kvGet(`sp_finance_pm_inline_cs_${seg}_${pg}`)])
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
      return res.status(200).json({ ok: true, idx: idx || null, seg, page: pg, rows: (shard || {}).rows || [] })
    }
    if (req.query?.custinsights) { // ?custinsights=OPS → 九大洞察
      if (!ok9(req.query.custinsights)) return res.status(403).json({ ok: false })
      const [ins, idx, sum2] = await Promise.all([kvGet('sp_finance_pm_inline_insights'), kvGet('sp_finance_pm_inline_custidx'), kvGet('sp_finance_pm_inline')])
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
      return res.status(200).json({ ok: true, ins: ins || null, idx: idx || null, months: (sum2 || {}).months || {}, farFuture: (sum2 || {}).farFuture || [], dayNotes: (sum2 || {}).dayNotes || {} })
    }
    if (req.query?.custoutlook) { // ?custoutlook=OPS → 近期展望（未來14天＋連假倒數＋要你做的事；v4.70.63／v4.70.81 加預估最終與行動狀態）
      if (!ok9(req.query.custoutlook)) return res.status(403).json({ ok: false })
      const [ol, st] = await Promise.all([custOutlook(), actStates()])
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
      return res.status(200).json({ ok: true, ...ol, st: st.keys || {} })
    }
    if (req.query?.custact) { // POST ?custact=OPS {token,key,op:'done'|'undo'|'task',owner,due,title} → 行動建議勾完成／派成任務（v4.70.81 第 4 項）
      if (!ok9(req.query.custact)) return res.status(403).json({ ok: false })
      let b = {}; try { b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
      const w = await whoTok(b.token); if (!w) return res.status(403).json({ ok: false, error: '要先綁定 GD（DD 私訊「綁定GD」）才能勾選' })
      const key = String(b.key || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); if (!key) return res.status(400).json({ ok: false, error: '缺 key' })
      const st = await actStates(); st.keys = st.keys || {}
      const op = String(b.op || 'done')
      if (op === 'undo') delete st.keys[key]
      else if (op === 'done') st.keys[key] = { st: 'done', by: w.name, at: new Date().toISOString() }
      else if (op === 'task') {
        const title = String(b.title || '').replace(/\*\*/g, '').slice(0, 80); if (!title) return res.status(400).json({ ok: false, error: '缺標題' })
        const owner = String(b.owner || '').slice(0, 30) || undefined, due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : ''
        const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now = new Date().toISOString()
        { const { abgdKv } = await import('./_abgdkv.js'); const kvT = await abgdKv({ domain: 'tasks', lockKey: 'sp_team_pm_task_x', operator: w.name, label: '任務' }); await kvT.kvPut('sp_team_pm_task_' + id, { id, title, note: '來自 inline 近期展望「要你做的事」', status: 'todo', catId: '__inbox__', owner, start: '', due, priority: 'normal', tags: ['inline'], createdAt: now, updatedAt: now, createdBy: w.name }, '/prep inline(' + w.name + ')') } // v4.71.115 依資料歸屬：任務域搬到新殼後走命令橋
        try { const cur = await kvGet('sp_team_pm_activity'); const arr = Array.isArray(cur) ? cur : []; await kvPut('sp_team_pm_activity', [{ ts: now, user: w.name, action: '新增', detail: `從 inline 行動建議派任務「${title}」${owner ? '給 ' + owner : ''}` }, ...arr].slice(0, 200), '/prep inline') } catch (_) {}
        await announceChanged()
        st.keys[key] = { st: 'task', by: w.name, at: now, tid: id, owner }
      } else return res.status(400).json({ ok: false, error: '未知 op' })
      await kvPut(ACT_ST_KEY, st, '/prep inline(' + w.name + ')')
      return res.status(200).json({ ok: true, st: st.keys, tid: (st.keys[key] || {}).tid || null })
    }
    if (req.query?.custholly) { // ?custholly=OPS&from=YYYY-MM-DD → 連假「去年來過、今年還沒訂」名單（v4.70.81 第 5 項）
      if (!ok9(req.query.custholly)) return res.status(403).json({ ok: false })
      const ol = await custOutlook()
      const out = await holLost(ol, String(req.query.from || ''))
      if (!out) return res.status(404).json({ ok: false, error: '這個連假不在倒數卡裡' })
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
      return res.status(200).json({ ok: true, ...out })
    }
    if (req.query?.custholcopy) { // POST ?custholcopy=OPS {token,from} → AI 寫三版 LINE 推播文案（走 AI 中樞 route=social）
      if (!ok9(req.query.custholcopy)) return res.status(403).json({ ok: false })
      let b = {}; try { b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch (_) {}
      const w = await whoTok(b.token); if (!w) return res.status(403).json({ ok: false, error: '要先綁定 GD 才能用 AI 產文案' })
      const ol = await custOutlook()
      const h = (ol.hols || []).find((x) => x.from === String(b.from || '')); if (!h) return res.status(404).json({ ok: false, error: '這個連假不在倒數卡裡' })
      const { aiCall } = await import('./_ai.js')
      const rng = h.from === h.to ? `${mdOf(h.from)}（${wdOf(h.from)}）` : `${mdOf(h.from)}～${mdOf(h.to)}`
      const sys = '你是台北信義區餐酒館 A Beach 101&Pizza 的行銷，寫給「去年這個連假來過、今年還沒訂位」的老客人的 LINE 私訊。繁體中文、口語、親切不油、不要表情符號堆疊（最多 1 個）、每版 60～110 字、結尾一定有訂位行動呼籲（回覆這則訊息或點訂位連結）。只輸出 JSON：{"versions":["…","…","…"]}，三版角度不同：①老朋友想念感 ②連假檔期快滿提醒 ③家庭／朋友聚會場景。不要編造優惠。'
      const usr = `連假：${h.name}（${rng}），倒數 ${h.left} 天。目前已訂 ${h.g} 人，去年同期已訂 ${h.ly.then} 人。店的特色：海灘風餐酒館、披薩、適合聚餐慶生。${b.extra ? '老闆補充：' + String(b.extra).slice(0, 200) : ''}`
      let versions = []
      try {
        const r = await aiCall('social', { system: sys, messages: [{ role: 'user', content: usr }], maxTokens: 900 })
        let s = String(r.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
        try { versions = JSON.parse(s).versions || [] } catch (_) { const m = s.match(/\{[\s\S]*\}/); if (m) { try { versions = JSON.parse(m[0]).versions || [] } catch (_) {} } }
        if (!versions.length && s) versions = [s]
      } catch (e) { return res.status(200).json({ ok: false, error: 'AI 沒回：' + (e?.message || e) }) }
      return res.status(200).json({ ok: true, versions: versions.map((v) => String(v).trim()).filter(Boolean).slice(0, 3) })
    }
    if (req.query?.custnr) { // ?custnr=OPS&ym=2026-10 → 該月新/回「逐筆名單」（眼見為憑，張良 2026-10-04）
      if (!ok9(req.query.custnr)) return res.status(403).json({ ok: false })
      const ym9 = /^\d{4}-\d{2}$/.test(String(req.query.ym || '')) ? String(req.query.ym) : null
      if (!ym9) return res.status(400).json({ ok: false, error: '要 ym=YYYY-MM' })
      const doc9 = await kvGet(`sp_finance_pm_inline_nr_${ym9}`)
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600')
      return res.status(200).json({ ok: true, ym: ym9, nr: doc9 || null })
    }
    if (req.query?.custfind) { // ?custfind=OPS&q=OD → 即時直搜 inline（姓名/電話片段）＋官方客人檔統計
      if (!ok9(req.query.custfind)) return res.status(403).json({ ok: false })
      const token = await inlineLogin()
      const { total, rows } = await inlineSearchKeyword(token, String(req.query.q || ''), 30)
      const cids = [...new Set(rows.map((r) => r.cid).filter(Boolean))].slice(0, 3)
      const stats = {}
      for (const cid of cids) { const c = await inlineCustomer(token, cid); if (c?.stats) stats[cid] = c }
      return res.status(200).json({ ok: true, total, rows, stats })
    }
    if (req.query?.custbuild) { // 手動重建（MENU 金鑰）
      if (!mk || String(req.query.custbuild) !== mk) return res.status(403).json({ ok: false })
      const out = await custBuild()
      return res.status(200).json({ ok: true, ...out })
    }
    // 關鍵字搜尋盤點口（驗證 D哥 query_resv name 模式用；正式邏輯在 line-webhook queryResvName）
    if (req.query?.kwsearch) {
      if (!mk || String(req.query.kwsearch) !== mk) return res.status(403).json({ ok: false })
      const token = await inlineLogin()
      const out = await inlineSearchKeyword(token, String(req.query.kw || ''), 40)
      return res.status(200).json({ ok: true, ...out })
    }
    // 常客排行盤點口（驗證 D哥 query_resv top 模式用；同一套聚合邏輯）
    if (req.query?.custtop) {
      if (!mk || String(req.query.custtop) !== mk) return res.status(403).json({ ok: false })
      const sum = (await kvGet('sp_finance_pm_inline')) || {}
      const mos = Object.keys(sum.months || {}).sort()
      const cust = {}
      for (let i = 0; i < mos.length; i += 12) {
        const docs = await Promise.all(mos.slice(i, i + 12).map((m) => kvGet('sp_finance_pm_inline_' + m)))
        for (const doc of docs) {
          for (const [d, arr] of Object.entries(doc?.days || {})) {
            for (const r of arr) {
              const name = (r.name || '').trim()
              const key = r.cid || r.phone || (name ? 'n:' + name : '') // cid=inline 客人檔口徑（同人換名/沒留電話合併）
              if (!key) continue
              const c = cust[key] = cust[key] || { name, phone: '', seat: 0, book: 0, cx: 0, guests: 0, last: '' }
              if (name && (!c.name || name.length > c.name.length)) c.name = name
              if ((r.phone || '').length > (c.phone || '').length) c.phone = r.phone
              if (r.cid && !c.cid) c.cid = r.cid
              c.book++
              if (CANCELED_STATES.includes(r.st)) c.cx++
              else { if (r.st === 4) { c.seat++; c.guests += r.n || 0 }; if (d > c.last) c.last = d }
            }
          }
        }
      }
      const topN = Math.min(30, Number(req.query.n) || 10)
      // 聚合選人 → inline 官方客人檔統計定次數（與 line-webhook queryResvTop 同款；楊主委=楊安娜案）
      const cands = Object.values(cust).filter((c) => c.name && (c.phone || '').replace(/\D/g, '').length >= 8).sort((a, b) => b.seat - a.seat || b.book - a.book).slice(0, Math.min(30, topN * 2))
      try {
        const token = await inlineLogin()
        await Promise.all(cands.map(async (c) => {
          if (!c.cid) return
          const o = await inlineCustomer(token, c.cid)
          // 取消＝全部−入座−NoShow 反推（官方取消欄位名不固定）
          if (o?.stats?.total != null) { c.seat = o.stats.seated ?? c.seat; c.bookOfficial = o.stats.total; c.cx = o.stats.total - (o.stats.seated || 0) - (o.stats.noShow || 0) }
        }))
      } catch (_) {}
      const rank = cands.sort((a, b) => b.seat - a.seat || b.book - a.book).slice(0, topN)
      return res.status(200).json({ ok: true, customers: Object.keys(cust).length, rank })
    }
    // 回填口
    if (req.query?.backfill) {
      if (!mk || String(req.query.backfill) !== mk) return res.status(403).json({ ok: false })
      const { from, to } = req.query
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return res.status(400).json({ ok: false, error: '要 from/to=YYYY-MM-DD' })
      const out = await syncRange(from, to)
      return res.status(200).json({ ok: true, ...out })
    }
    // cron：①滾動窗 前3天～未來45天 ②遠期（45天後全部，搜尋端點）③顧客庫/洞察超過20小時自動重建
    const t = twToday()
    const out = await syncRange(addDays(t, -3), addDays(t, 45))
    const far = await syncFuture(await inlineLogin())
    let cb = {}
    try {
      const idx = await kvGet('sp_finance_pm_inline_custidx')
      if (!idx?.builtAt || Date.now() - new Date(idx.builtAt).getTime() > 20 * 3600e3) cb = await custBuild()
    } catch (e) { cb = { custErr: e?.message } }
    let ha = {}, ol9 = null
    try { ol9 = await custOutlook(); const { days, ...slim } = ol9; await kvPut('sp_finance_pm_inline_outlook', { ...slim, days: days.map(({ list, ...x }) => x) }, 'inline近期展望快照') } catch (e) { ha.olErr = e?.message } // 快照給 DD／App AI 讀（不含逐筆名單）
    try { Object.assign(ha, await holidayAlert(ol9)) } catch (e) { ha.alertErr = e?.message }
    try { Object.assign(ha, await bigAlert()) } catch (e) { ha.bigErr = e?.message }
    try { if (ol9) Object.assign(ha, await weeklyDigest(ol9)) } catch (e) { ha.wkErr = e?.message }
    return res.status(200).json({ ok: true, ...out, ...far, ...cb, ...ha })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
