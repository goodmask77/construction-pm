// 📊 DD 推播統一補「額度尾巴」v4.71.10（張良 2026-10-14「DD 的通知都沒有顯示訊息額度 why」）
// why：v4.41/v4.55 規則「所有 DD 通知末尾帶『本次則數 本月用量/上限』」原本靠各推播點自己加 quotaFoot，全面掃描 45 處只有 9 處有加 → 治本改在出口統一補：
//   攔 fetch → 只處理「DD 的 token（LINE_CHANNEL_ACCESS_TOKEN）＋ /v2/bot/message/push」→ 最後一則文字訊息尾端補 `\n\n本次計費 本月用量/上限`
//   本次計費＝私訊 1；群組 C… 照群內人數（LINE 群推按人數計費）；已經有尾巴的（舊的 9 處）不重複補；查不到額度就不補
//   不補：其他官方帳號 token（收件匣回客人用各帳號 token）、init.noQuota=true（收件匣用 DD 名義回客人）
// 用法：會發 DD 推播的檔案頂端 import './_qpatch.js'（重複 import 只裝一次）
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const DD_TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
const PUSH_URL = 'https://api.line.me/v2/bot/message/push'
export const HAS_FOOT = /\n\n(\d+ \d+(\/\d+)?|📊 本次 [^\n]*則)\s*$/u // 兩種舊格式：簡易版「1 70/3000」、App 推播「📊 本次 1 則｜本月 …則」
let _q = { t: 0, used: -1, total: -1 }
const _mem = new Map()
if (!globalThis.__ddQuotaPatched && typeof globalThis.fetch === 'function' && DD_TOKEN) {
  globalThis.__ddQuotaPatched = true
  const orig = globalThis.fetch
  const quota = async () => {
    if (Date.now() - _q.t < 60e3) return _q
    try {
      const H = { authorization: `Bearer ${DD_TOKEN}` }
      const [q, c] = await Promise.all([orig('https://api.line.me/v2/bot/message/quota', { headers: H }).then(r => r.json()), orig('https://api.line.me/v2/bot/message/quota/consumption', { headers: H }).then(r => r.json())])
      _q = { t: Date.now(), used: (c && c.totalUsage != null) ? c.totalUsage : -1, total: (q && q.type === 'limited') ? q.value : -1 }
    } catch (_) { _q = { t: Date.now(), used: -1, total: -1 } }
    return _q
  }
  const members = async (to) => {
    if (!/^C/.test(to)) return 1
    const m = _mem.get(to); if (m && Date.now() - m.t < 3600e3) return m.n
    try { const r = await orig(`https://api.line.me/v2/bot/group/${to}/members/count`, { headers: { authorization: `Bearer ${DD_TOKEN}` } }); const d = r.ok ? await r.json() : null; const n = (d && d.count) || 1; _mem.set(to, { t: Date.now(), n }); return n } catch (_) { return 1 }
  }
  globalThis.fetch = async function (url, init) {
    try {
      if (String(url) === PUSH_URL && init && !init.noQuota && typeof init.body === 'string') {
        const h = init.headers || {}
        const auth = String(h.authorization || h.Authorization || (typeof h.get === 'function' ? h.get('authorization') : '') || '')
        if (auth.replace(/^Bearer\s+/i, '').trim() === DD_TOKEN) {
          const b = JSON.parse(init.body)
          const msgs = Array.isArray(b.messages) ? b.messages : []
          const last = [...msgs].reverse().find(m => m && m.type === 'text' && typeof m.text === 'string')
          if (last && !HAS_FOOT.test(last.text)) {
            const [q, n] = await Promise.all([quota(), members(String(b.to || ''))])
            if (q.used >= 0) {
              const billed = msgs.length * n
              last.text = (last.text.slice(0, 4980) + `\n\n${billed} ${q.used + billed}${q.total > 0 ? '/' + q.total : ''}`)
              q.used += billed // 同一輪連發時本月用量往上加，不會每則都同一個數字
              init = { ...init, body: JSON.stringify(b) }
            }
          }
        }
      }
    } catch (_) {}
    return orig(url, init)
  }
}
