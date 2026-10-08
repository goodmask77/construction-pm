// ── 社群成效每日回收＋token 健檢（張良 2026-10-08；cron 每天一次，台灣凌晨 3:15）──
// 多粉專：逐一跑 acc.facebook.pages 的每個粉專（A Beach / GROUN:D 各自的 token）
// 範圍：每個粉專近 30 天貼文（舊的幾乎不再變動，省 API 額度）。既有貼文自動匯入（source=imported）立刻有數據看
// 成效逐日快照存月檔 metricsKey，key=<postId>::<date>，原始整包存 raw（指標改名也不遺失）
// ⚠️ Insights metric 名稱 Meta 近年會改；抓不到不致命，raw 都留著，之後對照文件補
import { kvGet, kvPut } from './mail-sync.js'
import { getAccounts, setAccounts, getSecret, setSecret, getPosts, setPosts, metricsKey, graphGet, fbPageToken, metaReady, APP_ID, APP_SECRET } from './_social.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0 }

export default async function handler(req, res) {
  try {
    if (!metaReady()) return res.status(200).json({ ok: false, skipped: '未設 META_APP_ID/SECRET' })
    const acc = await getAccounts()
    const pages = (acc.facebook && acc.facebook.pages) || {}
    const pageIds = Object.keys(pages)
    if (!pageIds.length) return res.status(200).json({ ok: false, skipped: '尚未連接任何粉專' })

    const doc = await getPosts(); doc.list = doc.list || []
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const ym = today.slice(0, 7), mk = metricsKey(ym)
    const md = (await kvGet(mk)) || { days: {} }
    const daysBack = Math.min(400, Math.max(1, Number(req.query.days) || 30)) // 預設30天；?days=N 可拉長（回補歷史）
    const since = Math.floor((Date.now() - daysBack * 864e5) / 1000)
    const result = []
    const sec = await getSecret()
    const userToken = sec.facebook && sec.facebook.userToken
    let secDirty = false

    for (const pageId of pageIds) {
      const pg = pages[pageId]
      let token = await fbPageToken(pageId)
      // 用最新 user token 重取 page token（帶到新權限）＋ 補抓 IG 帳號連結（當初沒 IG 權限時是空的）
      if (userToken) { try { const rt = await graphGet('/' + pageId, { fields: 'access_token,instagram_business_account' }, userToken); if (rt.access_token) { token = rt.access_token; if (!sec.facebook.tokens) sec.facebook.tokens = {}; sec.facebook.tokens[pageId] = token; secDirty = true } if (rt.instagram_business_account && rt.instagram_business_account.id && pg.igUserId !== rt.instagram_business_account.id) { pg.igUserId = rt.instagram_business_account.id } } catch (_) {} }
      if (!token) { result.push({ page: pg.pageName, skipped: '無 token' }); continue }

      // token 健檢：失效→標記＋通知，略過此粉專
      try {
        const dbg = await graphGet('/debug_token', { input_token: token, access_token: `${APP_ID}|${APP_SECRET}` })
        if (dbg.data && dbg.data.is_valid === false) {
          pg.tokenStatus = 'invalid'; pg.tokenCheckedAt = new Date().toISOString()
          await lineBoss(`⚠️「${pg.pageName}」粉專授權失效，社群自動抓數據已暫停。請回 App「社群」分頁重新連接。`)
          result.push({ page: pg.pageName, error: 'token invalid' }); continue
        }
        pg.tokenStatus = 'ok'; pg.tokenCheckedAt = new Date().toISOString()
      } catch (_) {}

      // 近 30 天貼文
      let feed
      try { feed = await graphGet(`/${pageId}/published_posts`, { fields: 'id,message,created_time,permalink_url,full_picture', since: String(since), limit: '50' }, token) }
      catch (_) { try { feed = await graphGet(`/${pageId}/feed`, { fields: 'id,message,created_time,permalink_url,full_picture', since: String(since), limit: '50' }, token) } catch (_2) { feed = { data: [] } } }

      let imported = 0, measured = 0, firstErr = null
      for (const fp of (feed.data || [])) {
        let p = doc.list.find(x => x.pub && x.pub.facebook && x.pub.facebook.postId === fp.id)
        if (!p) {
          p = { id: 'im' + String(fp.id).replace(/[^0-9]/g, '').slice(-14), title: '', caption: fp.message || '', media: fp.full_picture ? [{ url: fp.full_picture, type: 'image' }] : [], targets: ['facebook'], page: pageId, brand: pg.pageName, status: 'published', source: 'imported', tags: [], relatedItems: [], createdAt: fp.created_time, updatedAt: fp.created_time, pub: { facebook: { postId: fp.id, permalink: fp.permalink_url, publishedAt: fp.created_time, status: 'published' } } }
          doc.list.push(p); imported++
        } else { if (fp.permalink_url) p.pub.facebook.permalink = fp.permalink_url; if (!p.brand) { p.page = pageId; p.brand = pg.pageName } }

        try {
          const base = await graphGet(`/${fp.id}`, { fields: 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares' }, token)
          let ins = {}
          // Meta 2024 淘汰了一堆 post 指標；逐一試、略過無效的（一個壞指標會讓整批 #100）
          for (const mName of ['post_impressions', 'post_impressions_unique']) {
            try { const io = await graphGet(`/${fp.id}/insights`, { metric: mName }, token); const v = io.data && io.data[0] && io.data[0].values && io.data[0].values[0]; if (v) ins[mName] = v.value || 0 } catch (ie) { if (!firstErr) firstErr = 'insights(' + mName + '):' + (ie.message || '') }
          }
          md.days[`${p.id}::${today}`] = {
            reactions: num(base.reactions && base.reactions.summary && base.reactions.summary.total_count),
            comments: num(base.comments && base.comments.summary && base.comments.summary.total_count),
            shares: num(base.shares && base.shares.count),
            views: num(ins.post_impressions), reach: num(ins.post_impressions_unique), clicks: num(ins.post_clicks),
            raw: { base, ins }, collectedAt: new Date().toISOString(),
          }
          measured++
        } catch (e) { if (!firstErr) firstErr = e.message }
      }
      // ── IG（Instagram）：粉專有連 IG 商業帳號才抓 ──
      let igImp = 0, igMeas = 0, igErr = null
      if (pg.igUserId) {
        try {
          const media = await graphGet(`/${pg.igUserId}/media`, { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count', since: String(since), limit: '50' }, token)
          for (const mp of (media.data || [])) {
            let p = doc.list.find(x => x.pub && x.pub.instagram && x.pub.instagram.mediaId === mp.id)
            if (!p) {
              p = { id: 'ig' + String(mp.id).slice(-16), title: '', caption: mp.caption || '', media: (mp.thumbnail_url || mp.media_url) ? [{ url: mp.thumbnail_url || mp.media_url, type: 'image' }] : [], targets: ['instagram'], platform: 'instagram', mediaType: mp.media_type || '', page: pg.igUserId, brand: pg.pageName + '·IG', status: 'published', source: 'imported', tags: [], relatedItems: [], createdAt: mp.timestamp, updatedAt: mp.timestamp, pub: { instagram: { mediaId: mp.id, permalink: mp.permalink, publishedAt: mp.timestamp, status: 'published' } } }
              doc.list.push(p); igImp++
            } else { if (mp.permalink) p.pub.instagram.permalink = mp.permalink; if (!p.mediaType && mp.media_type) p.mediaType = mp.media_type } // 回填舊貼文類型
            // IG 數字：讚/留言直接從 media；reach/saves/shares 走 insights（名稱逐一試、略過無效的）
            let iv = {}
            for (const mName of ['reach', 'saved', 'shares']) {
              try { const io = await graphGet(`/${mp.id}/insights`, { metric: mName }, token); const v = io.data && io.data[0] && io.data[0].values && io.data[0].values[0]; if (v) iv[mName] = v.value || 0; else { const v2 = io.data && io.data[0]; if (v2 && v2.total_value) iv[mName] = v2.total_value.value || 0 } } catch (ie) { if (!igErr) igErr = 'ig-ins(' + mName + '):' + (ie.message || '') }
            }
            md.days[`${p.id}::${today}`] = { reactions: num(mp.like_count), comments: num(mp.comments_count), shares: num(iv.shares), saves: num(iv.saved), reach: num(iv.reach), raw: { mp, iv }, collectedAt: new Date().toISOString() }
            igMeas++
          }
        } catch (e) { igErr = 'ig:' + (e.message || '') }
      }
      // 粉絲數（儀表板 KPI 用）
      try { const fb = await graphGet(`/${pageId}`, { fields: 'fan_count,followers_count' }, token); const fc = num(fb.followers_count || fb.fan_count); if (fc) pg.followers = fc } catch (_) {}
      if (pg.igUserId) { try { const ig = await graphGet(`/${pg.igUserId}`, { fields: 'followers_count,media_count' }, token); if (ig.followers_count) pg.igFollowers = num(ig.followers_count); if (ig.media_count) pg.igMediaCount = num(ig.media_count) } catch (_) {} }
      result.push({ page: pg.pageName, imported, measured, total: (feed.data || []).length, ig: { imported: igImp, measured: igMeas, ...(igErr ? { err: igErr } : {}) }, ...(firstErr ? { err: firstErr } : {}) })
    }

    if (secDirty) await setSecret(sec, '刷新page token')
    await kvPut(mk, md, '社群成效'); await setPosts(doc, '社群匯入'); await setAccounts(acc, '社群健檢')
    return res.status(200).json({ ok: true, pages: result })
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }) }
}

async function lineBoss(text) {
  try { const tk = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN), boss = clean(process.env.LINE_BOSS_USER); if (tk && boss) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: boss, messages: [{ type: 'text', text }] }) }) } catch (_) {}
}
