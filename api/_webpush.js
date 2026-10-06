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
  const base = { title: msg.title || 'GD', body: String(msg.body || '').slice(0, 180), url: msg.url || '/prep', ...(msg.badge != null ? { badge: msg.badge } : {}) } // badge=圖示紅點數字(v4.33.2)
  // 📨 通知歷史（v4.33.4 張良：通知要有頁面+歷史+分類）：所有推播都走這裡＝單一路口順手記一筆
  // cat 沒給就按文字自動歸類；to=null 全員看得到、有指定 rids 只有本人看得到（/prep ?ntf= 口過濾）
  let nd = null
  try {
    const t9 = (msg.title || '') + (msg.body || '')
    const cat9 = msg.cat || (/會議|宣達|簽收/.test(t9) ? 'meet' : /SOP|超時/.test(t9) ? 'sop' : /備料/.test(t9) ? 'prep' : /低水位|庫存|包材|叫貨/.test(t9) ? 'stock' : /問題|回報/.test(t9) ? 'issue' : 'other')
    nd = (await kvGet('sp_finance_pm_prep_ntf')) || { list: [] }
    const bodyN = String(msg.body || '').slice(0, 180), toKey = JSON.stringify(rids || null)
    // v4.55.8 去重保險（張良「通知重複」）：8秒內同標題+內容+對象的通知＝視為重複，不再寫一筆
    const dup = (nd.list || []).find(x => x.title === (msg.title || 'GD') && x.body === bodyN && JSON.stringify(x.to || null) === toKey && (Date.now() - new Date(x.ts).getTime()) < 8000)
    if (!dup) { nd.list = [{ id: 'n' + Date.now().toString(36), ts: new Date().toISOString(), cat: cat9, title: msg.title || 'GD', body: bodyN, url: msg.url || '/prep', to: rids || null }, ...(nd.list || [])].slice(0, 300); await kvPut('sp_finance_pm_prep_ntf', nd, '通知歷史') }
  } catch (_) { nd = null }
  // 🔢 App 圖示數字＝每人「通知中心未讀數」（v4.33.5 張良：手機桌面App要顯示通知數字）
  // 跟 App 裡鈴鐺同一個數字＝資料一致；已讀基準=nd.read[rid]（打開通知中心時 ?ntfread= 記）；歷史讀不到才退回呼叫端給的 badge
  const unreadOf = (rid) => { try { const rd = (nd.read || {})[rid] || ''; return nd.list.filter(x => (!x.to || x.to.includes(rid)) && x.ts > rd).length } catch (_) { return null } }
  let sent = 0, dirty = false
  for (const [rid, rec] of Object.entries(doc)) {
    if (rids && !rids.includes(rid)) continue
    const un = nd ? unreadOf(rid) : null
    const payload = JSON.stringify(un != null ? { ...base, badge: un } : base)
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
