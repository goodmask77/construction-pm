// Eats365 POS 報表解析（共用模組）：後端收信（mail-sync.js）與前端手動匯入（Finance.jsx 動態載入）用同一套邏輯＝資料一致
// readType：後端 Buffer 用 'buffer'、瀏覽器 Uint8Array 用 'array'
// 報表是「標籤/數值」直欄式（概覽/總銷售額/銷售來源/付款方式/審計…）→ 掃全表建 label→value 字典＋抽關鍵欄位
// 實測樣本：DailyClosing (.xls 舊格式)；label 內含全形/半形空白（信 用 卡）→ key 一律去空白
// 通用「段落表」解析（其餘五個分頁：類別銷售/捆綁/商品類別/優惠券/付款方式）→ 無損保留
// 規則：含「名稱」的列=表頭、純文字短列=段標題、其餘=資料列
import * as XLSX from 'xlsx'

export function sheetSections(grid) {
  const secs = []; let cur = null; let pendingTitle = ''
  for (const row of grid) {
    const cells = row.map(c => typeof c === 'number' ? c : String(c ?? '').trim()).filter(c => c !== '')
    if (!cells.length) continue
    const isHeader = cells.some(c => c === '名稱')
    if (isHeader) { cur = { title: pendingTitle, header: cells, rows: [] }; secs.push(cur); pendingTitle = ''; continue }
    const hasNum = cells.some(c => typeof c === 'number')
    if (!hasNum && cells.length <= 2) { pendingTitle = String(cells[0]); cur = null; continue }
    if (cur) cur.rows.push(cells)
    else { cur = { title: pendingTitle || String(cells[0]), header: [], rows: [cells] }; secs.push(cur); pendingTitle = '' }
  }
  return secs
}

export function parsePosWorkbook(buf, subject, readType = 'buffer') {
  const wb = XLSX.read(buf, { type: readType })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
  const kv = {}, kvArr = {}
  let name = '', period = ''
  for (const row of grid) {
    const cells = row.map(c => String(c ?? '').trim())
    const joined = cells.join('')
    if (joined.startsWith('名稱:')) name = joined.slice(3).replace(/服務由.*$/, '').trim()
    if (joined.startsWith('報表日期:')) period = joined.slice(5).trim()
    const label = cells.find(c => c && isNaN(parseFloat(c.replace(/[NT$,()\s]/g, ''))))
    const nums = row.filter(c => typeof c === 'number' || (String(c).trim() && !isNaN(parseFloat(String(c).replace(/[NT$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'))))).map(c => typeof c === 'number' ? c : parseFloat(String(c).replace(/[NT$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')))
    if (!label || !nums.length) continue
    const key = label.replace(/\s+/g, '')
    if (!(key in kv)) { kv[key] = nums[nums.length - 1]; kvArr[key] = nums }
  }
  const pm = period.match(/(\d{4}-\d{2}-\d{2})/)
  const cnt = (k) => (kvArr[k] && kvArr[k].length > 1) ? kvArr[k][0] : null
  return {
    id: 'pos-' + (period.replace(/[^\d]/g, '').slice(0, 20) || Math.random().toString(36).slice(2, 9)),
    date: pm ? pm[1] : '', period, store: name, subject: subject || '',
    revenue: kv['總收入'] ?? kv['總銷售額'] ?? 0,
    grossSales: kv['總銷售額'] ?? 0, txCount: kv['交易數量'] ?? 0, guests: kv['人數(堂食)'] ?? 0,
    sales: kv['銷售'] ?? 0, serviceFee: kv['服務費'] ?? 0, discount: kv['折扣'] ?? 0, refund: kv['退單'] ?? 0,
    cash: kv['現金'] ?? 0, cashCount: cnt('現金'), card: kv['信用卡'] ?? 0, cardCount: cnt('信用卡'),
    uber: kv['點餐平台(UBEREATS)-API'] ?? 0, uberCount: cnt('點餐平台(UBEREATS)-API'),
    posSales: kv['POS'] ?? 0, apiSales: kv['API'] ?? 0,
    voidItems: kv['VoidItems'] ?? 0, returnDish: kv['退菜'] ?? 0, unsettled: kv['未結賬(轉移)'] ?? 0,
    kv, source: 'mail',
    _details: Object.fromEntries(wb.SheetNames.slice(1).map(sn => [sn, sheetSections(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' }))])),
  }
}

// Transaction 附件（逐筆交易）→ 泛用表格解析：第一個「含≥3個字串格」的列＝表頭，其後＝資料列
// 結構未知先無損保留（h=表頭 r=列），前端泛用渲染；欄名由 sync 回傳 txCols 可驗
export function parseTxSheet(buf, readType = 'buffer') {
  try {
    const wb = XLSX.read(buf, { type: readType })
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
    const hi = grid.findIndex(row => row.filter(c => typeof c === 'string' && String(c).trim()).length >= 3)
    if (hi < 0) return null
    const h = grid[hi].map(c => String(c ?? '').trim())
    const r = grid.slice(hi + 1)
      .map(row => row.slice(0, h.length).map(c => typeof c === 'number' ? c : String(c ?? '').trim()))
      .filter(row => row.some(c => c !== ''))
    return r.length ? { h, r, sn: wb.SheetNames } : null
  } catch (_) { return null }
}
