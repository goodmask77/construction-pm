// GROUN:D 喬亞 POS 行動報表自動抓取（張良 2026-08-26 提供帳密：mobile-report.wixtar.com）
// 流程：POST /api/login（JSON，拿 JSESSIONID）→ POST /api/date 設區間 → GET 報表頁（HTML 內嵌 var dataList = [...] JSON）
// 眉角：頁面要帶完整瀏覽器 Accept/Accept-Language/Referer 標頭，不然 500；品項 id 前綴(F01…)=類別 id → 分組不用猜名字
// 產出 record 與日結信/手動回填同形狀 → 走 mail-sync 同一條只增不改管線（date|store 去重，手動回填過的日子不會撞）
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const BASE = 'https://mobile-report.wixtar.com'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const CO = clean(process.env.JOYA_COMPANY), USR = clean(process.env.JOYA_USER), PWD = clean(process.env.JOYA_PASS)

const num = (s) => Number(String(s ?? '').replace(/,/g, '')) || 0

async function jFetch(path, opts = {}, cookie = '') {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: {
      'user-agent': UA, 'accept-language': 'zh-TW,zh;q=0.9', referer: BASE + '/incomeStatement2',
      ...(opts.body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'text/html,application/xhtml+xml' }),
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  })
  return r
}

export async function joyaLogin() {
  if (!CO || !USR || !PWD) throw new Error('缺 JOYA_COMPANY/JOYA_USER/JOYA_PASS 環境變數')
  const r = await jFetch('/api/login', { method: 'POST', body: JSON.stringify({ companyId: CO, account: USR, password: PWD }) })
  if (!r.ok) throw new Error('喬亞登入失敗 ' + r.status + ' ' + (await r.text()).slice(0, 120))
  const sid = (r.headers.get('set-cookie') || '').match(/JSESSIONID=([^;]+)/)?.[1]
  if (!sid) throw new Error('喬亞登入沒拿到 JSESSIONID')
  return `JSESSIONID=${sid}; company_id=${CO}; username=${USR}`
}

const dataList = (html) => { const m = html.match(/var dataList = (\[[\s\S]*?\]);/); try { return m ? JSON.parse(m[1]) : [] } catch (_) { return [] } }
const pageText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')
const labelVal = (txt, label) => { const m = txt.match(new RegExp(label + '\\|\\s*\\|?\\s*(-?[\\d,]+)')); return m ? num(m[1]) : 0 }

// 時段分析（喬亞只有「每小時」粒度，無半小時）：GROUND 段落的 table rows → [[小時, 營業額, 訂單數]]
function parseTimeslots(html) {
  const i = html.indexOf('GROUND'); if (i < 0) return []
  const seg = html.slice(i, i + 8000)
  const out = []
  for (const tr of seg.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(c => c.replace(/<[^>]+>/g, '').trim())
    if (cells.length >= 3 && /^\d{1,2}$/.test(cells[0])) { const amt = num(cells[1]), orders = num(cells[2]); if (amt > 0 || orders > 0) out.push([Number(cells[0]), amt, orders]) }
  }
  return out
}

// 抓某一天的完整資料（summary＋分類＋品項含金額＋付款＋每小時時段）
export async function joyaFetchDay(cookie, date) {
  const sd = await jFetch('/api/date', { method: 'POST', body: JSON.stringify({ startDate: date, endDate: date }) }, cookie)
  if (!sd.ok) throw new Error('設日期失敗 ' + sd.status)
  const get = async (p) => { const r = await jFetch('/' + p, {}, cookie); if (!r.ok) throw new Error(p + ' ' + r.status); return r.text() }
  const incHtml = await get('incomeStatement2')
  const txt = pageText(incHtml)
  const sum = {
    gross: labelVal(txt, '實銷金額'), over: labelVal(txt, '溢收金額'), rounding: labelVal(txt, '尾數折讓'),
    service: labelVal(txt, '服務費'), revenue: labelVal(txt, '實收金額'), txCount: labelVal(txt, '交易筆數'), qty: labelVal(txt, '銷售數量'),
  }
  if (!sum.revenue) return { date, sum, empty: true } // 公休/沒營業（實收0；就算有test單活動也算沒開）：不入庫，免得0元日拉低日均
  const [cats, items, pays, slots] = await Promise.all([
    get('categorySalesAmount').then(dataList), get('productSalesAmount').then(dataList), get('payment').then(dataList),
    get('period_time_report').then(parseTimeslots).catch(() => []),
  ])
  return { date, sum, cats, items, pays, slots, empty: false }
}

// 只抓時段（給「舊日子補時段」用：日子已入庫但當時沒抓時段 → 只補這張表，不動其他資料）
export async function joyaFetchTimeslots(cookie, date) {
  const sd = await jFetch('/api/date', { method: 'POST', body: JSON.stringify({ startDate: date, endDate: date }) }, cookie)
  if (!sd.ok) throw new Error('設日期失敗 ' + sd.status)
  const r = await jFetch('/period_time_report', {}, cookie); if (!r.ok) throw new Error('period ' + r.status)
  return parseTimeslots(await r.text())
}

export const TIMESLOT_SHEET = '時段分析(每小時)'
export const timeslotSection = (slots) => ({ title: TIMESLOT_SHEET, header: ['時段', '訂單數', '營業額'], rows: slots.map(([h, amt, od]) => [String(h).padStart(2, '0') + ':00', od, amt]) })

// 組成入庫 record（形狀同日結信；rows 無「套餐內」欄→前端顯示 —）
export function joyaBuildRecord(day) {
  const { date, sum, cats, items, pays } = day
  const catName = {}; for (const c of cats) catName[c.id] = c.name
  const secsMap = {}
  for (const it of (items || [])) {
    const cid = String(it.id || '').slice(0, 3)
    const cn = catName[cid] || '其他'
    if (cn === '套餐') continue // 套餐自成一段
    ;(secsMap[cn] = secsMap[cn] || []).push([it.name, Math.round(Number(it.value_qvalue) || 0), '', num(it.value)])
  }
  const secs = Object.entries(secsMap).map(([title, rows]) => ({ title, header: ['名稱', '數量', '佔比', '銷售額'], rows: rows.sort((a, b) => b[3] - a[3]) }))
  secs.push({ title: '總結', header: ['名稱', '數量', '佔比', '銷售額'], rows: cats.filter(c => c.name !== '套餐').map(c => [c.name, Math.round(Number(c.value_qvalue) || 0), '', num(c.value)]) })
  const set = cats.find(c => c.name === '套餐')
  if (set) secs.push({ title: '套餐', header: ['名稱', '數量', '佔比', '銷售額'], rows: [['＋89 套餐', Math.round(Number(set.value_qvalue) || 0), '', num(set.value)]] })
  // 付款逐筆互斥歸類、一毛不漏（張良 2026-08-29：自助點餐的 LINE Pay 之前沒接，現金+卡加總對不上營收）
  // LINE Pay 要先判——「NCCC信用卡(KIOSK)」含「卡」歸信用卡沒問題，但 LINE Pay(APP) 不能被丟掉；剩下歸「其他」（例：預付款沖帳）
  // kiosk＝自助點餐通路合計（NCCC信用卡(KIOSK)＋LINE Pay(APP)，2026-08-26 重開始有）——與付款別交疊（機台刷卡也算進 card），是「通路」維度不是加總項
  let cash = 0, card = 0, linepay = 0, payOther = 0, kiosk = 0
  for (const p of (pays || [])) {
    const n = p.name || '', v = num(p.value)
    if (/kiosk|\(app\)/i.test(n)) kiosk += v
    if (/line\s*pay/i.test(n)) linepay += v
    else if (/現金/.test(n)) cash += v
    else if (/信用卡|刷卡|卡/.test(n)) card += v
    else payOther += v
  }
  return {
    id: 'pos-' + date.replace(/-/g, '') + 'joya-ground',
    date, period: date + '（喬亞行動報表自動抓取）', store: 'GROUN:D', subject: 'GROUN:D 喬亞行動報表',
    revenue: sum.revenue, grossSales: sum.gross, discount: Math.abs(sum.rounding),
    txCount: sum.txCount, guests: 0, sales: sum.revenue, serviceFee: sum.service, refund: 0,
    cash, cashCount: null, card, cardCount: null, linepay, payOther, kiosk, uber: 0, uberCount: null, posSales: 0, apiSales: 0,
    voidItems: 0, returnDish: 0, unsettled: 0, kv: {}, source: 'joya-mobile',
    partial: '喬亞行動報表自動抓取：營收/單數/付款/品項含金額為真值；無來客數、無套餐內拆分、退貨未單列',
    // 時段放獨立分頁鍵（不能塞進分類表——前端會把 11:00 當品項算進熱銷榜）；付款方式原樣入明細（drill 當日原始資料可見）
    _details: {
      '總銷售額 (以類別分類)': secs,
      ...(pays && pays.length ? { '付款方式': [{ title: '付款方式', header: ['名稱', '數量', '佔比', '銷售額'], rows: pays.map(p => [p.name, '', (p.percent_value || '') + '%', num(p.value)]) }] } : {}),
      ...(day.slots && day.slots.length ? { [TIMESLOT_SHEET]: [timeslotSection(day.slots)] } : {}),
    },
  }
}

// 台北現在是否已過結帳時間（張良 2026-08-26：營業 11-19、19:30 就能結）→ 過了就能抓「今天」
export const taipeiAfterClose = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number)
  return h * 60 + m >= 19 * 60 + 30
}

// 台北時區今天（只抓「昨天以前」——今天營業中資料未定，只增不改不能提早凍結）
export const taipeiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date())
