// 💳🧾 綠界 ECPay 共用模組 v4.71.3（團體訂餐第三批金流第二家＋電子發票；張良 2026-10-12「還有綠界的金流／要有統編打發票」）
// 兩件事：①全方位金流 AioCheckOut（信用卡／ATM 轉帳／超商代碼）②B2C 電子發票（有統編＝公司發票）。訂單狀態由 api/_grporder.js 管，這裡只負責跟綠界講話。
// 金鑰：正式＝Vercel env ECPAY_MERCHANT_ID／ECPAY_HASH_KEY／ECPAY_HASH_IV（發票另三個 ECPAY_INV_MERCHANT_ID／ECPAY_INV_HASH_KEY／ECPAY_INV_HASH_IV）；
//       沒設 env 時，團訂設定頁勾「用綠界測試商家」就改用綠界官方公開的測試商家打測試站（不會真扣款、發票是假的），申請下來填 env 自動切正式。
import crypto from 'node:crypto'
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '')
// 綠界官方文件公開的測試商家（全方位金流／電子發票各一組）
const TEST_PAY = { id: '3002607', key: 'pwFHCqoQZGmho4w6', iv: 'EkRm7iFT261dpevs' }
const TEST_INV = { id: '2000132', key: 'ejCk326UnaZWKisg', iv: 'q9jcZX8Ib9LM8wYk' }
export function payCreds (allowTest) { const id = clean(process.env.ECPAY_MERCHANT_ID), key = clean(process.env.ECPAY_HASH_KEY), iv = clean(process.env.ECPAY_HASH_IV); if (id && key && iv) return { id, key, iv, test: false }; return allowTest ? { ...TEST_PAY, test: true } : null }
export function invCreds (allowTest) { const id = clean(process.env.ECPAY_INV_MERCHANT_ID), key = clean(process.env.ECPAY_INV_HASH_KEY), iv = clean(process.env.ECPAY_INV_HASH_IV); if (id && key && iv) return { id, key, iv, test: false }; return allowTest ? { ...TEST_INV, test: true } : null }
const PAY_HOST = (test) => (test ? 'https://payment-stage.ecpay.com.tw' : 'https://payment.ecpay.com.tw')
const INV_HOST = (test) => (test ? 'https://einvoice-stage.ecpay.com.tw' : 'https://einvoice.ecpay.com.tw')

// ── 金流：CheckMacValue（SHA256）。照綠界規則：鍵名 A→Z 排序、HashKey 開頭 HashIV 結尾、.NET 式 URL encode 後轉小寫、SHA256 轉大寫 ──
const netEncode = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/'/g, '%27').replace(/~/g, '%7e').replace(/%[0-9A-F]{2}/g, m => m.toLowerCase())
export function checkMac (params, c) {
  const keys = Object.keys(params).filter(k => k !== 'CheckMacValue').sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0)
  const raw = `HashKey=${c.key}&` + keys.map(k => `${k}=${params[k]}`).join('&') + `&HashIV=${c.iv}`
  return crypto.createHash('sha256').update(netEncode(raw).toLowerCase()).digest('hex').toUpperCase()
}
export function verifyMac (params, c) { try { return !!params && !!params.CheckMacValue && checkMac(params, c) === String(params.CheckMacValue).toUpperCase() } catch (_) { return false } }
const twNow = () => { const d = new Date(Date.now() + 8 * 3600e3); const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` }
export const CHOOSE = { ALL: '信用卡／ATM／超商', Credit: '信用卡', ATM: 'ATM 轉帳', CVS: '超商代碼' }
// 產生「自動送出到綠界」的 HTML（客人瀏覽器打開就跳到綠界付款頁）
export function checkoutHtml ({ creds, tradeNo, amount, desc, itemName, returnUrl, orderResultUrl, clientBackUrl, paymentInfoUrl, choose }) {
  const p = { MerchantID: creds.id, MerchantTradeNo: String(tradeNo).replace(/[^A-Za-z0-9]/g, '').slice(0, 20), MerchantTradeDate: twNow(), PaymentType: 'aio', TotalAmount: String(Math.round(Number(amount) || 0)), TradeDesc: String(desc || 'GROUN:D 團體訂餐').slice(0, 200), ItemName: String(itemName || 'GROUN:D 團體訂餐').slice(0, 400), ReturnURL: returnUrl, ChoosePayment: CHOOSE[choose] ? choose : 'ALL', EncryptType: '1', NeedExtraPaidInfo: 'N' }
  if (orderResultUrl) p.OrderResultURL = orderResultUrl
  if (clientBackUrl) p.ClientBackURL = clientBackUrl
  if (paymentInfoUrl) p.PaymentInfoURL = paymentInfoUrl
  if (choose === 'ATM' || choose === 'ALL') p.ExpireDate = '3' // ATM 虛擬帳號 3 天內有效
  if (choose === 'CVS' || choose === 'ALL') p.StoreExpireDate = String(3 * 24 * 60) // 超商代碼 3 天（分鐘）
  p.CheckMacValue = checkMac(p, creds)
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>前往綠界付款</title><style>body{font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#333}div{text-align:center}b{font-size:18px}</style></head><body><div><b>正在前往綠界付款頁…</b><p>${creds.test ? '（綠界測試商家，不會真的扣款）' : '請勿關閉視窗'}</p><form id="f" method="post" action="${PAY_HOST(creds.test)}/Cashier/AioCheckOut/V5">${Object.keys(p).map(k => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join('')}<noscript><button>繼續</button></noscript></form></div><script>document.getElementById('f').submit()</script></body></html>`
}

// ── 電子發票（B2C API 3.0.0：JSON 先 URL encode 再 AES-128-CBC，回來反向解）──
const aesEnc = (obj, c) => { const ci = crypto.createCipheriv('aes-128-cbc', Buffer.from(c.key, 'utf8'), Buffer.from(c.iv, 'utf8')); return Buffer.concat([ci.update(encodeURIComponent(JSON.stringify(obj)), 'utf8'), ci.final()]).toString('base64') }
const aesDec = (b64, c) => { const de = crypto.createDecipheriv('aes-128-cbc', Buffer.from(c.key, 'utf8'), Buffer.from(c.iv, 'utf8')); return JSON.parse(decodeURIComponent(Buffer.concat([de.update(Buffer.from(b64, 'base64')), de.final()]).toString('utf8').replace(/\+/g, ' '))) } // 綠界把空白編成 +
// 統編檢查碼（財政部 2023 新規：乘積各位數加總 %5==0；第 7 碼是 7 時加 1 再算也算對）
export function validTaxId (t) { t = String(t || '').replace(/\D/g, ''); if (t.length !== 8) return false; const w = [1, 2, 1, 2, 1, 2, 4, 1]; let sum = 0; for (let i = 0; i < 8; i++) { const p = Number(t[i]) * w[i]; sum += Math.floor(p / 10) + (p % 10) } return sum % 5 === 0 || (t[6] === '7' && (sum + 1) % 5 === 0) }
async function invCall (path, data, c) {
  const body = { MerchantID: c.id, RqHeader: { Timestamp: Math.floor(Date.now() / 1000), Revision: '3.0.0' }, Data: aesEnc(data, c) }
  const r = await fetch(INV_HOST(c.test) + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`綠界發票 ${path} HTTP ${r.status}`)
  if (j.TransCode !== 1 && j.TransCode !== '1') throw new Error(`綠界發票拒絕：${j.TransMsg || j.TransCode}`)
  return aesDec(j.Data, c)
}
// 開立發票：有統編＝公司發票（Print=1，買受人可列印）；沒統編＝個人，用綠界會員載具（CarrierType 1），有留 email 會寄通知
export async function issueInvoice ({ creds, relateNumber, taxId, title, addr, email, phone, amount, itemName, remark }) {
  amount = Math.round(Number(amount) || 0); if (amount <= 0) return { ok: false, error: '發票金額要大於 0' }
  taxId = String(taxId || '').replace(/\D/g, '').slice(0, 8); if (taxId && !validTaxId(taxId)) return { ok: false, error: `統編 ${taxId} 不合法（檢查碼不對），請跟客人核對` }
  const data = { MerchantID: creds.id, RelateNumber: String(relateNumber).replace(/[^A-Za-z0-9]/g, '').slice(0, 30), CustomerID: '', CustomerIdentifier: taxId, CustomerName: String(title || (taxId ? '' : '個人')).slice(0, 60), CustomerAddr: String(addr || '').trim().slice(0, 100), CustomerPhone: String(phone || '').replace(/\D/g, '').slice(0, 20), CustomerEmail: String(email || '').trim().slice(0, 80), ClearanceMark: '', Print: taxId ? '1' : '0', Donation: '0', LoveCode: '', CarrierType: taxId ? '' : '1', CarrierNum: '', TaxType: '1', SalesAmount: amount, InvoiceRemark: String(remark || '').slice(0, 200), Items: [{ ItemSeq: 1, ItemName: String(itemName || '團體訂餐').slice(0, 100), ItemCount: 1, ItemWord: '式', ItemPrice: amount, ItemTaxType: '1', ItemAmount: amount, ItemRemark: '' }], InvType: '07', vat: '1' }
  if (taxId && !data.CustomerName) return { ok: false, error: '公司發票要有抬頭（公司名稱）' }
  if (taxId && !data.CustomerAddr) return { ok: false, error: '公司發票要有買受人地址（綠界規定）' }
  if (!taxId && !data.CustomerEmail && !data.CustomerPhone) return { ok: false, error: '個人發票要留 email 或手機（綠界載具通知用）' }
  const r = await invCall('/B2CInvoice/Issue', data, creds)
  if (Number(r.RtnCode) !== 1) return { ok: false, error: `綠界開立失敗（${r.RtnCode}：${String(r.RtnMsg || '').slice(0, 80)}）` }
  return { ok: true, no: r.InvoiceNo, date: r.InvoiceDate, random: r.RandomNumber, test: !!creds.test }
}
// 作廢（開錯或訂單作廢）
export async function voidInvoice ({ creds, no, date, reason }) { const r = await invCall('/B2CInvoice/Invalid', { MerchantID: creds.id, InvoiceNo: String(no), InvoiceDate: String(date || '').slice(0, 10), Reason: String(reason || '訂單作廢').slice(0, 20) }, creds); return Number(r.RtnCode) === 1 ? { ok: true } : { ok: false, error: `作廢失敗（${r.RtnCode}：${String(r.RtnMsg || '').slice(0, 80)}）` } }
export const _netEncode = netEncode
