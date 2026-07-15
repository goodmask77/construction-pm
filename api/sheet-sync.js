// 後端：同步「2025喬亞·公司帳務表」Google 試算表 → sp_finance_pm_sheet（對帳中心資料源）
// 表已設「知道連結者可檢視」→ 用公開 CSV 端點抓，不需 OAuth。
// 觸發：財務內帳「對帳」分頁的「立即同步」按鈕；cron-daily 每天也會呼叫一次。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const SHEET_ID = clean(process.env.FIN_SHEET_ID) || '1a-OBVgd4reSxvgHvHAfb5oM6JFPtZYtIPYmeibilNCE'
const SHEET_TAB = clean(process.env.FIN_SHEET_TAB) || '★總表★'

// 簡易 CSV 解析（處理引號內的逗號與換行）
function parseCSV(text) {
  const rows = []; let row = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else inQ = false }
      else cell += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-()]/g, '').replace(/^\((.*)\)$/, '-$1')); return isNaN(n) ? 0 : n }
// 日期「9/2」「12/29」「1/8」→ 補年份：表從 2025 年中起、列大致按時間排；
// 用「月份回捲」推年份（前一列 12 月、這列 1 月 → 跨年 +1），比固定門檻可靠。
function makeDateNormalizer(startYear = 2025) {
  let y = startYear, lastMo = null
  return (v) => {
    const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/)
    if (!m) return ''
    const mo = Number(m[1]), d = Number(m[2])
    if (lastMo != null && mo < lastMo - 5) y++ // 例如 12 → 1
    lastMo = mo
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
}

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(200).json({ ok: false, error: '缺 Supabase 設定' })
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok) return res.status(200).json({ ok: false, error: `試算表讀取失敗 HTTP ${r.status}（請確認共用設定為「知道連結者可檢視」）` })
    const csv = await r.text()
    if (csv.trim().startsWith('<')) return res.status(200).json({ ok: false, error: '試算表未開放連結讀取（回傳了登入頁）' })
    const raw = parseCSV(csv)
    // 欄位（依表的固定欄序）：A編號 B通知日期 C憑證來源 D基數月 E類別 F科目 G項目內容 H負責人 I期限 J方式
    // K未稅 L稅額 M金額 N付款方備註 O收款方備註 P收匯前餘額 Q匯款人 R匯出日期 S轉出戶名 T支 U手續費 V實轉出 W收匯完餘額
    // X銀行 Y帳號 Z收款戶名 AA收到日期 AB轉入戶名 AC收 AD餘額 AE憑證(批號)
    const rows = []
    const normPay = makeDateNormalizer(2025)   // 匯出日期序列（主要時間軸）
    const normNotify = makeDateNormalizer(2025) // 通知日期序列
    raw.forEach((c, i) => {
      const content = (c[6] || '').trim()
      const amount = num(c[12]) || num(c[10])
      if (!content || !amount) return // 跳過表頭/空列/純備註列
      if (/項\s*目\s*內\s*容/.test(content)) return
      const payDate = normPay(c[17])
      const notifyDate = normNotify(c[1])
      rows.push({
        id: 'sh-' + i,
        checked: (c[0] || '').trim(),           // V/O 勾記
        notifyDate,
        cat: (c[4] || '').trim(),               // 類別（公司/宏匯瑞光/薪資/設備/行銷…）
        subject: (c[5] || '').trim(),           // 科目
        content,                                 // 項目內容
        owner: (c[7] || '').trim(),
        method: (c[9] || '').trim(),            // 匯款/現金/個人墊…
        pretax: num(c[10]), tax: num(c[11]), amount,
        payDate: payDate || notifyDate, // 匯出日期優先
        payee: (c[25] || '').trim(),            // 收款戶名
        handler: (c[16] || '').trim(),          // 匯款人/經手人
        fee: num(c[20]),                        // 手續費
        bank: (c[23] || '').trim(),
        batch: (c[30] || '').trim(),            // 批號/憑證
        balanceAfter: num(c[22]),
      })
    })
    const payload = { syncedAt: new Date().toISOString(), sheetId: SHEET_ID, tab: SHEET_TAB, rows }
    await fetch(`${SB_URL}/rest/v1/pm_documents`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: 'sp_finance_pm_sheet', data: { v: JSON.stringify(payload) }, editor: '對帳同步', updated_at: new Date().toISOString() }),
    })
    return res.status(200).json({ ok: true, rows: rows.length, syncedAt: payload.syncedAt })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) })
  }
}
