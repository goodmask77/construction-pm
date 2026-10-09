// ── Facebook 粉專授權（張良 2026-10-08：App 裡點「連接 Facebook」走這裡，免碰 Graph API Explorer）──
// 流程：?start=<token> 驗證是管理者→轉去 FB 授權頁；FB 回調 ?code=&state= →換長效 token→取粉專 page token→存檔
// 長效 user token 換出的 page token 通常不過期；失效（改密碼/撤權）由 social-collect 的每日健檢偵測
import { APP_ID, APP_SECRET, REDIRECT_URI, GV, metaReady, getAccounts, setAccounts, getSecret, setSecret, graphGet, whoSocial, canEditSocial } from './_social.js'
import { kvGet, kvPut } from './mail-sync.js'

// Phase 1 先用「一定過」的兩個權限（粉專清單＋互動數據）＝讚/留言/分享先拿得到，馬上連得上
// read_insights（觸及/曝光）、pages_manage_posts（自動發文）要先在 App 使用案例裡開通，之後再加回、重新連一次即可
// 可用 env SOCIAL_SCOPES 覆寫（開通後不用改碼就能擴充）
const clean0 = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SCOPES = clean0(process.env.SOCIAL_SCOPES) || 'pages_show_list,pages_read_engagement'

export default async function handler(req, res) {
  try {
    if (!metaReady()) return res.status(200).send(page('尚未設定', '還沒設定 Meta App ID／Secret。請先把兩組字交給 CC 設定後再回來連接。'))

    // ① 起手：管理者從 App 點「連接 Facebook」→ ?start=<token>
    if (req.query.start != null) {
      const who = await whoSocial(String(req.query.start || ''))
      if (!canEditSocial(who)) return res.status(200).send(page('沒有權限', '只有管理者能連接粉專。請先用你的帳號登入 /prep，再按一次「連接 Facebook」。'))
      const state = 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await kvPut('sp_finance_pm_social_oauth', { state, ts: Date.now(), by: who.name }, 'oauth-state')
      const url = `https://www.facebook.com/${GV}/dialog/oauth?` + new URLSearchParams({ client_id: APP_ID, redirect_uri: REDIRECT_URI, state, scope: SCOPES, response_type: 'code' }).toString()
      res.writeHead(302, { Location: url }); return res.end()
    }

    // 使用者在 FB 取消授權
    if (req.query.error) return res.status(200).send(page('已取消', '你在 Facebook 按了取消。要連接的話回 App 再按一次「連接 Facebook」。'))

    // ② 回調：?code=&state=
    if (req.query.code) {
      const saved = (await kvGet('sp_finance_pm_social_oauth')) || {}
      if (!req.query.state || req.query.state !== saved.state) return res.status(200).send(page('連接逾時', '授權驗證碼不符或太久了。請回 App 重新按一次「連接 Facebook」。'))
      // 短期 user token → 長效 user token
      const t1 = await graphGet('/oauth/access_token', { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code: String(req.query.code) })
      const t2 = await graphGet('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: t1.access_token })
      const longUser = t2.access_token
      // 取可管理的粉專（通常只有一個）＋ page token
      const pages = await graphGet('/me/accounts', { fields: 'id,name,access_token,instagram_business_account' }, longUser)
      let list = pages.data || []
      // 商家旗下粉專不列在 /me/accounts：用 user token 抓商家 owned/client pages 補上（需 business_management）
      if (!list.length) {
        try {
          const biz = await graphGet('/me/businesses', { fields: 'id,name' }, longUser)
          const seen = new Set()
          for (const b of (biz.data || [])) {
            for (const edge of ['owned_pages', 'client_pages']) {
              try {
                const r = await graphGet('/' + b.id + '/' + edge, { fields: 'id,name,access_token,instagram_business_account' }, longUser)
                for (const pg of (r.data || [])) { if (pg.access_token && !seen.has(pg.id)) { seen.add(pg.id); list.push(pg) } }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
      // 先存長效 user token（就算沒抓到粉專，之後也能用「粉專編號」手動加商家旗下粉專）
      { const s0 = await getSecret(); s0.facebook = s0.facebook || {}; s0.facebook.userToken = longUser; s0.facebook.userTokenExp = t2.expires_in || null; await setSecret(s0, 'FB user token') }
      if (!list.length) return res.status(200).send(page('授權成功，粉專待加入', '授權已存好 👍 但你的粉專掛在「商家」底下、沒自動列出。<br><br>請回 App「社群」分頁用「<b>用粉專編號加入</b>」，貼上 GROUN:D 粉專編號即可。', true))
      // 多粉專：把這次授權帳號能管的粉專全部「併入」（不覆蓋別帳號已連的），A Beach / GROUN:D 可各自連
      const now = new Date().toISOString()
      const acc = await getAccounts()
      acc.facebook = acc.facebook || {}
      if (!acc.facebook.pages) acc.facebook.pages = {}
      for (const pg of list) {
        acc.facebook.pages[pg.id] = { pageId: pg.id, pageName: pg.name, igUserId: (pg.instagram_business_account || {}).id || null, tokenStatus: 'ok', tokenCheckedAt: now, connectedAt: (acc.facebook.pages[pg.id] || {}).connectedAt || now, connectedBy: saved.by || '' }
      }
      if (!acc.facebook.defaultPageId) acc.facebook.defaultPageId = list[0].id
      await setAccounts(acc, 'FB連接')
      const sec = await getSecret(); sec.facebook = sec.facebook || {}; if (!sec.facebook.tokens) sec.facebook.tokens = {}
      for (const pg of list) sec.facebook.tokens[pg.id] = pg.access_token
      sec.facebook.userToken = longUser // 存長效 user token：商家旗下粉專不列在 /me/accounts，用它＋粉專編號可直接拿 page token
      sec.facebook.userTokenExp = t2.expires_in || null
      // 重連時一併刷新「商家旗下、不在 /me/accounts」的已連粉專（如 A Beach 101&Pizza）→ 用新 user token 重拿 page token，帶上新授權的發文權限
      for (const pid of Object.keys(acc.facebook.pages)) {
        if (list.find(p => p.id === pid)) continue // /me/accounts 已處理過
        try {
          const pg = await graphGet('/' + pid, { fields: 'id,name,access_token,instagram_business_account' }, longUser)
          if (pg.access_token) { sec.facebook.tokens[pid] = pg.access_token; acc.facebook.pages[pid].igUserId = (pg.instagram_business_account || {}).id || acc.facebook.pages[pid].igUserId; acc.facebook.pages[pid].tokenStatus = 'ok'; acc.facebook.pages[pid].tokenCheckedAt = now }
        } catch (_) {}
      }
      await setAccounts(acc, 'FB連接刷新')
      await setSecret(sec, 'FB token')
      await kvPut('sp_finance_pm_social_oauth', {}, 'oauth-done')
      const names = list.map(p => esc(p.name)).join('、')
      return res.status(200).send(page('連接成功', `已連上粉專：<b style="color:#4DA3FF">${names}</b><br><br>可以關掉這一頁，回 App 的「社群」分頁。<br>要加「別的帳號」管理的粉專（例如同事管的 GROUN:D），用那個帳號再連一次就好，不會蓋掉這個。`, true))
    }

    return res.status(200).send(page('社群授權', '請從 App 的「社群」分頁按「連接 Facebook」。'))
  } catch (e) {
    return res.status(200).send(page('連接失敗', '出錯了：<br><span style="color:#F07373">' + esc(e.message || '未知錯誤') + '</span><br><br>把這頁截圖給 CC 就能查。'))
  }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) }
function page(title, body, ok) {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
    + `<body style="font-family:-apple-system,'PingFang TC','Noto Sans TC',sans-serif;background:#0E1217;color:#F2F5F9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px">`
    + `<div style="max-width:420px;width:100%;text-align:center;background:#161B22;border:1px solid #2A3240;border-radius:18px;padding:32px 24px;box-shadow:0 10px 28px rgba(0,0,0,.4)">`
    + `${ok ? '<div style="font-size:44px;line-height:1">🎉</div>' : ''}`
    + `<div style="font-size:20px;font-weight:800;margin:10px 0 14px">${esc(title)}</div>`
    + `<div style="color:#C7D0DB;line-height:1.85;font-size:15px">${body}</div></div></body>`
}
