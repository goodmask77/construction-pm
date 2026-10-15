// ── Facebook 粉專授權（張良 2026-10-08：App 裡點「連接 Facebook」走這裡，免碰 Graph API Explorer）──
// 流程：?start=<token> 驗證是管理者→轉去 FB 授權頁；FB 回調 ?code=&state= →換長效 token→取粉專 page token→存檔
// 長效 user token 換出的 page token 通常不過期；失效（改密碼/撤權）由 social-collect 的每日健檢偵測
import { APP_ID, APP_SECRET, REDIRECT_URI, GV, metaReady, getAccounts, setAccounts, getSecret, setSecret, graphGet, whoSocial, canEditSocial } from './_social.js'
import { kvGet, kvPut, socTx, socRun, socGate } from './_socialkv.js' // v4.71.146 社群域依歸屬版本比對讀寫（其他鍵照舊 GD）

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
      await socTx('sp_finance_pm_social_oauth', (cur) => ({ write: true, doc: { state, ts: Date.now(), by: who.name, gen: (Number(cur && cur.gen) || 0) + 1 } }), 'oauth-state') // 授權世代：每次按「連接」在同一筆交易內 +1（嚴格遞增，不靠時間；第五輪 A5）
      const url = `https://www.facebook.com/${GV}/dialog/oauth?` + new URLSearchParams({ client_id: APP_ID, redirect_uri: REDIRECT_URI, state, scope: SCOPES, response_type: 'code' }).toString()
      res.writeHead(302, { Location: url }); return res.end()
    }

    // 使用者在 FB 取消授權
    if (req.query.error) return res.status(200).send(page('已取消', '你在 Facebook 按了取消。要連接的話回 App 再按一次「連接 Facebook」。'))

    // ② 回調：?code=&state=
    if (req.query.code) {
      const saved = (await kvGet('sp_finance_pm_social_oauth')) || {}
      const state = String(req.query.state || '')
      if (!state || state !== saved.state) return res.status(200).send(page('連接逾時', '授權驗證碼不符或太久了。請回 App 重新按一次「連接 Facebook」。'))
      { const g = await socGate(); if (g) return res.status(200).send(page('系統切換中', '行銷大師正在做資料搬家驗收（幾分鐘）。請稍後回 App 再按一次「連接 Facebook」。')) } // 換權杖前先問驗收閘門（關卡 3 行銷大師第一輪 A1）
      // v4.71.147 續做（第一輪 A5）：授權碼只能用一次 → 換到的權杖與粉專清單先存進這次的授權紀錄（同 state），後面寫入失敗時重新整理這一頁會接著寫、不再換一次
      let longUser, t2, list
      // 互斥（第二輪 A5）：同一次授權只准一個在換權杖——state 相同且還沒開始＝標「處理中」；處理中（2 分鐘內）＝請稍候；已拿到＝接續；state 被換掉＝停
      const holder = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) // 持有者編號（第三輪 A5）：存權杖紀錄要持有者相符；Facebook 授權碼本身只能換一次，逾時接手也換不到第二份
      const lockR = await socTx('sp_finance_pm_social_oauth', (cur) => { if (!cur || cur.state !== state) return { write: false, value: 'gone' }; if (cur.stage === 'got') return { write: false, value: 'got' }; if (cur.stage === 'exchanging' && Date.now() - Date.parse(cur.exAt || 0) < 120e3) return { write: false, value: 'busy' }; return { write: true, doc: { ...cur, stage: 'exchanging', exAt: new Date().toISOString(), holder }, value: 'mine' } }, 'oauth-exchanging')
      if (lockR === 'gone') return res.status(200).send(page('連接逾時', '這次授權已被新的連接取代或已完成。請回 App 重新按一次「連接 Facebook」。'))
      if (lockR === 'busy') return res.status(200).send(page('處理中', '這次授權正在處理中，請等幾秒後重新整理這一頁。'))
      const saved2 = lockR === 'got' ? ((await kvGet('sp_finance_pm_social_oauth')) || {}) : saved
      if (lockR === 'got' && saved2.state !== state) return res.status(200).send(page('連接逾時', '這次授權已被新的連接取代。請回 App 重新按一次「連接 Facebook」。')) // 接續前重驗 state
      if (lockR === 'got' && saved2.got) { longUser = saved2.got.longUser; t2 = { expires_in: saved2.got.exp }; list = saved2.got.list || [] }
      else {
        // 短期 user token → 長效 user token
        const t1 = await graphGet('/oauth/access_token', { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code: String(req.query.code) })
        t2 = await graphGet('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: t1.access_token })
        longUser = t2.access_token
        // 取可管理的粉專（通常只有一個）＋ page token
        const pages = await graphGet('/me/accounts', { fields: 'id,name,access_token,instagram_business_account' }, longUser)
        list = pages.data || []
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
      }
      if (lockR !== 'got') { const okGot = await socTx('sp_finance_pm_social_oauth', (cur) => (cur && cur.state === state && cur.holder === holder && cur.stage === 'exchanging') ? { write: true, doc: { ...cur, stage: 'got', got: { longUser, exp: t2.expires_in || null, list: list.map(p => ({ id: p.id, name: p.name, access_token: p.access_token, instagram_business_account: p.instagram_business_account || null })) }, gotAt: new Date().toISOString() }, value: true } : { write: false, value: false }, 'oauth-got'); if (!okGot) return res.status(200).send(page('連接逾時', '這次授權已被新的連接取代。請回 App 重新按一次「連接 Facebook」。')) } // state 不符＝立刻停，不寫權杖（第二輪 A5）
      // v4.71.146：授權碼只能用一次 → 換到權杖後的寫入一律 socTx（重讀最新、合併、只重做寫入），不整段重做
      const S_KEY = 'sp_finance_pm_social_secret', A_KEY = 'sp_finance_pm_social_accounts'
      const gen = Number(saved.gen) // 授權世代＝這次按「連接」配到的遞增序號（第四、五輪 A5）：帳號與權杖文件記 _oauthGen，同一筆交易內比較，較舊（或同代）的授權寫不進去
      if (!(Number.isInteger(gen) && gen > 0)) return res.status(200).send(page('連接逾時', '這次授權紀錄不完整。請回 App 重新按一次「連接 Facebook」。'))
      const newer = (cur) => (Number(cur && cur._oauthGen) || 0) > gen // 同代＝自己（接續時重寫同樣內容）
      const stillMine = async () => (((await kvGet('sp_finance_pm_social_oauth')) || {}).state === state) // 每次寫權杖前再確認這次授權沒被新的連接取代
      const gone = () => res.status(200).send(page('連接逾時', '這次授權已被新的連接取代。請回 App 重新按一次「連接 Facebook」。'))
      // 先存長效 user token（就算沒抓到粉專，之後也能用「粉專編號」手動加商家旗下粉專）
      if (!(await stillMine())) return gone()
      if ((await socTx(S_KEY, (cur) => { if (newer(cur)) return { write: false, value: 'newer' }; const s0 = JSON.parse(JSON.stringify(cur || {})); s0.facebook = s0.facebook || {}; s0.facebook.userToken = longUser; s0.facebook.userTokenExp = t2.expires_in || null; s0._oauthGen = gen; return { write: true, doc: s0 } }, 'FB user token')) === 'newer') return gone()
      if (!list.length) return res.status(200).send(page('授權成功，粉專待加入', '授權已存好 👍 但你的粉專掛在「商家」底下、沒自動列出。<br><br>請回 App「社群」分頁用「<b>用粉專編號加入</b>」，貼上 GROUN:D 粉專編號即可。', true))
      // 多粉專：把這次授權帳號能管的粉專全部「併入」（不覆蓋別帳號已連的），A Beach / GROUN:D 可各自連
      const now = new Date().toISOString()
      // 重連時一併刷新「商家旗下、不在 /me/accounts」的已連粉專（如 A Beach 101&Pizza）→ 先用新 user token 把權杖拿齊（唯讀），再一次合併寫入
      const acc0 = await getAccounts(); const extra = {}
      for (const pid of Object.keys((acc0.facebook && acc0.facebook.pages) || {})) {
        if (list.find(p => p.id === pid)) continue // /me/accounts 已處理過
        try { const pg = await graphGet('/' + pid, { fields: 'id,name,access_token,instagram_business_account' }, longUser); if (pg.access_token) extra[pid] = pg } catch (_) {}
      }
      // 順序：先寫粉專權杖、最後才把帳號標成功——中途失敗只會「權杖新、帳號清單還沒更新」，不會「帳號標成功卻配舊權杖」（第五輪 A5）；重新整理回調頁會接續做完
      if (!(await stillMine())) return gone()
      if ((await socTx(S_KEY, (cur) => { if (newer(cur)) return { write: false, value: 'newer' }; const sec = JSON.parse(JSON.stringify(cur || {})); sec._oauthGen = gen; sec.facebook = sec.facebook || {}; if (!sec.facebook.tokens) sec.facebook.tokens = {}
        for (const pg of list) sec.facebook.tokens[pg.id] = pg.access_token
        for (const [pid, pg] of Object.entries(extra)) sec.facebook.tokens[pid] = pg.access_token
        sec.facebook.userToken = longUser // 存長效 user token：商家旗下粉專不列在 /me/accounts，用它＋粉專編號可直接拿 page token
        sec.facebook.userTokenExp = t2.expires_in || null
        return { write: true, doc: sec } }, 'FB token')) === 'newer') return gone()
      if (!(await stillMine())) return gone()
      if ((await socTx(A_KEY, (cur) => { if (newer(cur)) return { write: false, value: 'newer' }; const acc = JSON.parse(JSON.stringify(cur || {})); acc._oauthGen = gen; acc.facebook = acc.facebook || {}; if (!acc.facebook.pages) acc.facebook.pages = {}
        for (const pg of list) acc.facebook.pages[pg.id] = { pageId: pg.id, pageName: pg.name, igUserId: (pg.instagram_business_account || {}).id || null, tokenStatus: 'ok', tokenCheckedAt: now, connectedAt: (acc.facebook.pages[pg.id] || {}).connectedAt || now, connectedBy: saved.by || '' }
        for (const [pid, pg] of Object.entries(extra)) if (acc.facebook.pages[pid]) { acc.facebook.pages[pid].igUserId = (pg.instagram_business_account || {}).id || acc.facebook.pages[pid].igUserId; acc.facebook.pages[pid].tokenStatus = 'ok'; acc.facebook.pages[pid].tokenCheckedAt = now }
        if (!acc.facebook.defaultPageId) acc.facebook.defaultPageId = list[0].id
        return { write: true, doc: acc } }, 'FB連接')) === 'newer') return gone()
      await socTx('sp_finance_pm_social_oauth', (cur) => (cur && cur.state === state) ? { write: true, doc: {} } : { write: false }, 'oauth-done') // 只清同一次授權的紀錄（第一輪 A5）
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
