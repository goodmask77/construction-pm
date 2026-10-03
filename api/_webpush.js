// GD /prep Web Push 共用模組（v4.33.0 張良：點通知直接打開主畫面GD+本人身分）
// 訂閱存 sp_finance_pm_push_subs = { [rid]: { name, subs: [PushSubscription...] } }
// kv 用動態 import 拿 mail-sync 的（mail-sync 也 import 本檔，靜態互相引會循環）
import webpush from 'web-push'

const PUB = (process.env.WEBPUSH_PUB || '').trim()
const PRIV = (process.env.WEBPUSH_PRIV || '').trim()

export const wpReady = () => !!(PUB && PRIV)
export const wpPubKey = () => PUB

// 發推播：rids=null → 全部訂閱者；msg={title, body, url}（url=點通知打開的頁面，可帶 #meet= 深層連結）
export async function wpPush(rids, msg) {
  if (!wpReady()) return 0
  webpush.setVapidDetails('mailto:goodmask77@gmail.com', PUB, PRIV)
  const { kvGet, kvPut } = await import('./mail-sync.js')
  const doc = (await kvGet('sp_finance_pm_push_subs')) || {}
  const payload = JSON.stringify({ title: msg.title || 'GD', body: String(msg.body || '').slice(0, 180), url: msg.url || '/prep' })
  let sent = 0, dirty = false
  for (const [rid, rec] of Object.entries(doc)) {
    if (rids && !rids.includes(rid)) continue
    const keep = []
    for (const sub of (rec.subs || [])) {
      try { await webpush.sendNotification(sub, payload); sent++; keep.push(sub) }
      catch (e) { const sc = e && e.statusCode; if (sc === 404 || sc === 410) dirty = true; else keep.push(sub) } // 404/410=訂閱失效→清掉
    }
    if (keep.length !== (rec.subs || []).length) { rec.subs = keep; dirty = true }
  }
  if (dirty) { try { await kvPut('sp_finance_pm_push_subs', doc, 'webpush清失效訂閱') } catch (_) {} }
  return sent
}

// 群組訊息用的 /prep 連結：有設 LIFF_ID → LIFF 連結（LINE 裡點開自動認人，不再是訪客）；沒設 → 原本 https 連結
// hash 範例：'meet=xxxx'（深層連結，不含 #）
export const prepLink = (hash) => {
  const L = (process.env.LIFF_ID || '').trim()
  return L ? ('https://liff.line.me/' + L + (hash ? ('?s=' + encodeURIComponent(hash)) : ''))
    : ('https://ground-pm.vercel.app/prep' + (hash ? ('#' + hash) : ''))
}

// 用 LINE uid 發（提醒多半只有 lineUserId）：bind.byUid[uid]=token、tokens[token].rid
export async function wpPushUids(uids, msg) {
  try {
    const { kvGet } = await import('./mail-sync.js')
    const bd = (await kvGet('sp_finance_pm_prep_bind')) || {}
    const rids = (uids || []).map(u => (((bd.tokens || {})[(bd.byUid || {})[u]]) || {}).rid).filter(Boolean)
    return rids.length ? await wpPush(rids, msg) : 0
  } catch (_) { return 0 }
}
