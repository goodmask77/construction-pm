// 💳 LINE Pay 共用模組 v4.71.1（團體訂餐第三批「金流」，docs/GROUP_ORDER_SPEC.md 第 9 節；張良 2026-10-12「接著做」）
// 只做一件事：建立付款（request）＋確認付款（confirm）。訂單內容、付款狀態都由呼叫端（api/_grporder.js）管。
// 環境變數（Vercel）：LINEPAY_CHANNEL_ID、LINEPAY_CHANNEL_SECRET；LINEPAY_ENV=prod 才打正式站，預設沙盒（api-sandbox.pay.line.me）。沒設金鑰＝整個付款功能不出現，其他流程照舊。
import crypto from 'node:crypto'
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '')
const ID = () => clean(process.env.LINEPAY_CHANNEL_ID)
const SECRET = () => clean(process.env.LINEPAY_CHANNEL_SECRET)
export const isProd = () => /^prod/i.test(clean(process.env.LINEPAY_ENV))
export const enabled = () => !!(ID() && SECRET())
export const envLabel = () => (isProd() ? '正式' : '沙盒測試')
const HOST = () => (isProd() ? 'https://api-pay.line.me' : 'https://api-sandbox.pay.line.me')

// 簽章：HMAC-SHA256(secret, secret + uri + body + nonce) → base64（官方 v3 規格）
function sign (uri, bodyStr, nonce) { return crypto.createHmac('sha256', SECRET()).update(SECRET() + uri + bodyStr + nonce).digest('base64') }
async function call (uri, body) {
  const nonce = crypto.randomUUID(); const bodyStr = JSON.stringify(body || {})
  const r = await fetch(HOST() + uri, { method: 'POST', headers: { 'content-type': 'application/json', 'X-LINE-ChannelId': ID(), 'X-LINE-Authorization-Nonce': nonce, 'X-LINE-Authorization': sign(uri, bodyStr, nonce) }, body: bodyStr })
  let d = {}; try { d = await r.json() } catch (_) {}
  if (!r.ok) throw new Error(`LINE Pay ${uri} HTTP ${r.status}`)
  return d
}
// 建立付款：回 { transactionId, url }（url＝導客人去付的網頁；手機會自動開 LINE）
export async function request ({ orderId, amount, name, confirmUrl, cancelUrl }) {
  if (!enabled()) return { ok: false, error: 'LINE Pay 尚未設定（LINEPAY_CHANNEL_ID／SECRET）' }
  amount = Math.round(Number(amount) || 0); if (amount <= 0) return { ok: false, error: '金額要大於 0' }
  const body = { amount, currency: 'TWD', orderId: String(orderId).slice(0, 100), packages: [{ id: 'pkg1', amount, name: String(name || 'GROUN:D 團體訂餐').slice(0, 100), products: [{ name: String(name || 'GROUN:D 團體訂餐').slice(0, 100), quantity: 1, price: amount }] }], redirectUrls: { confirmUrl, cancelUrl } }
  const d = await call('/v3/payments/request', body)
  if (d.returnCode !== '0000') return { ok: false, error: `LINE Pay 拒絕建立付款（${d.returnCode}：${String(d.returnMessage || '').slice(0, 80)}）` }
  const info = d.info || {}
  return { ok: true, transactionId: String(info.transactionId), url: (info.paymentUrl || {}).web || (info.paymentUrl || {}).app, raw: { paymentAccessToken: info.paymentAccessToken } }
}
// 確認付款：客人付完被導回 confirmUrl 後呼叫；金額要跟 request 一樣。回 { ok, info }
export async function confirm ({ transactionId, amount }) {
  if (!enabled()) return { ok: false, error: 'LINE Pay 尚未設定' }
  const d = await call(`/v3/payments/${encodeURIComponent(String(transactionId))}/confirm`, { amount: Math.round(Number(amount) || 0), currency: 'TWD' })
  if (d.returnCode !== '0000') return { ok: false, code: d.returnCode, error: `LINE Pay 確認失敗（${d.returnCode}：${String(d.returnMessage || '').slice(0, 80)}）` }
  const info = d.info || {}
  return { ok: true, info: { transactionId: String(info.transactionId || transactionId), orderId: info.orderId, payType: (info.payInfo || [])[0] && info.payInfo[0].method, amount: (info.payInfo || []).reduce((t, p) => t + (Number(p.amount) || 0), 0) } }
}
// 給測試／自檢用：不打網路，只算簽章（scratchpad 驗證簽章公式）
export const _sign = sign
