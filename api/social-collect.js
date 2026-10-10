// ── 社群成效回收＋token 健檢（張良 2026-10-08；v4.70.21 起每 3 小時一次，分 FB/IG 時序快照）──
// 多粉專：逐一跑 acc.facebook.pages 的每個粉專（A Beach / GROUN:D 各自的 token）
// 範圍：每個粉專近 30 天貼文。既有貼文自動匯入（source=imported）立刻有數據看
// 成效快照存月檔 metricsKey，key=<postId>::<plat>::<slot>（plat=fb|ig、slot=YYYY-MM-DDTHH 取台灣時間 3 小時整點）
// v4.70.37（2026-10-10 張良）：cron 改成台灣 06/09/12/15/18/21/00/03 整點跑（vercel.json UTC 22,1,4,7,10,13,16,19），之前照 UTC 整 3 小時＝台灣 08/11/14…，存檔往下取整後標籤比真實抓取早 2 小時，看起來像少一個點
//   → ① FB 跟 IG 各存一份不再互蓋 ② 一天最多 8 個時序點＝畫得出「貼文發出後的成長曲線」
//   原始整包存 raw（指標改名也不遺失）。舊格式 <postId>::<date> 仍可被 social.js 相容讀取。
// ⚠️ Insights metric 名稱 Meta 近年會改；抓不到不致命，raw 都留著，之後對照文件補
import { kvGet, kvPut } from './mail-sync.js'
import { getAccounts, setAccounts, getSecret, setSecret, getPosts, setPosts, metricsKey, graphGet, fbPageToken, metaReady, APP_ID, APP_SECRET } from './_social.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0 }
// 台灣時間的 3 小時時序槽：YYYY-MM-DDTHH（HH 向下取整到 0/3/6/9/12/15/18/21）
const tpeSlot = () => { const d = new Date(Date.now() + 8 * 3600e3); const h = Math.floor(d.getUTCHours() / 3) * 3; return d.toISOString().slice(0, 10) + 'T' + String(h).padStart(2, '0') }

// 導出核心＝cron 與「立即同步」鈕（social.js op=sync）共用；daysBack 可拉長回補
export async function runCollect(daysBack = 30) {
  if (!metaReady()) return { ok: false, skipped: '未設 META_APP_ID/SECRET' }
  const acc = await getAccounts()
  const pages = (acc.facebook && acc.facebook.pages) || {}
  const pageIds = Object.keys(pages)
  if (!pageIds.length) return { ok: false, skipped: '尚未連接任何粉專' }

  const doc = await getPosts(); doc.list = doc.list || []
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const slot = tpeSlot()
  const ym = today.slice(0, 7), mk = metricsKey(ym)
  const md = (await kvGet(mk)) || { days: {} }

  const db = Math.min(400, Math.max(1, Number(daysBack) || 30))
  const since = Math.floor((Date.now() - db * 864e5) / 1000)
  const result = []
  const sec = await getSecret()
  const userToken = sec.facebook && sec.facebook.userToken
  let secDirty = false
  const nowIso = new Date().toISOString()

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
        pg.tokenStatus = 'invalid'; pg.tokenCheckedAt = nowIso
        await lineBoss(`⚠️「${pg.pageName}」粉專授權失效，社群自動抓數據已暫停。請回 App「行銷大師」分頁重新連接。`)
        result.push({ page: pg.pageName, error: 'token invalid' }); continue
      }
      pg.tokenStatus = 'ok'; pg.tokenCheckedAt = nowIso
    } catch (_) {}

    // ── FB：近 N 天貼文 ──
    let feed, fbOk = false
    try { feed = await graphGet(`/${pageId}/published_posts`, { fields: 'id,message,created_time,permalink_url,full_picture', since: String(since), limit: '100' }, token); fbOk = true }
    catch (_) { try { feed = await graphGet(`/${pageId}/feed`, { fields: 'id,message,created_time,permalink_url,full_picture', since: String(since), limit: '100' }, token); fbOk = true } catch (_2) { feed = { data: [] } } }

    let imported = 0, measured = 0, firstErr = null
    const seenFb = new Set()
    for (const fp of (feed.data || [])) {
      seenFb.add(fp.id)
      let p = doc.list.find(x => x.pub && x.pub.facebook && x.pub.facebook.postId === fp.id)
      if (!p) {
        p = { id: 'im' + String(fp.id).replace(/[^0-9]/g, '').slice(-14), title: '', caption: fp.message || '', media: fp.full_picture ? [{ url: fp.full_picture, type: 'image' }] : [], targets: ['facebook'], page: pageId, brand: pg.pageName, status: 'published', source: 'imported', tags: [], relatedItems: [], createdAt: fp.created_time, updatedAt: fp.created_time, pub: { facebook: { postId: fp.id, permalink: fp.permalink_url, publishedAt: fp.created_time, status: 'published' } } }
        doc.list.push(p); imported++
      } else { if (fp.permalink_url) p.pub.facebook.permalink = fp.permalink_url; if (!p.brand) { p.page = pageId; p.brand = pg.pageName }; if (p.pub.facebook.deletedAt) delete p.pub.facebook.deletedAt } // 又出現＝復活

      try {
        const base = await graphGet(`/${fp.id}`, { fields: 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares' }, token)
        let ins = {}
        for (const mName of ['post_impressions', 'post_impressions_unique', 'post_clicks']) {
          try { const io = await graphGet(`/${fp.id}/insights`, { metric: mName }, token); const v = io.data && io.data[0] && io.data[0].values && io.data[0].values[0]; if (v) ins[mName] = v.value || 0 } catch (ie) { if (!firstErr) firstErr = 'insights(' + mName + '):' + (ie.message || '') }
        }
        const snap = {
          plat: 'fb',
          reactions: num(base.reactions && base.reactions.summary && base.reactions.summary.total_count),
          comments: num(base.comments && base.comments.summary && base.comments.summary.total_count),
          shares: num(base.shares && base.shares.count),
          views: num(ins.post_impressions), reach: num(ins.post_impressions_unique), clicks: num(ins.post_clicks),
          raw: { base, ins }, collectedAt: nowIso,
        }
        md.days[`${p.id}::fb::${slot}`] = snap
        md.days[`${p.id}::fb::${today}`] = snap // 每日最終值（當天多槽都寫同一 key＝最後一次覆蓋＝當日最新）
        measured++
      } catch (e) { if (!firstErr) firstErr = e.message }
    }
    // FB 刪除偵測（保守·連續缺席才標）：單次 API 不一定回傳近 30 天全部貼文，一次抓不到就標會誤殺。
    // 改成連續 MISS_MAX 次（每 3 小時一次＝約 9 小時）都抓不到才軟標 deletedAt；一旦又出現或缺席不足門檻＝自動清除（修復誤標）
    const MISS_MAX = 3
    let fbDeleted = 0
    if (fbOk) {
      for (const p of doc.list) {
        const f = p.pub && p.pub.facebook
        if (!f || f.postId == null) continue
        if (f.status && f.status !== 'published' && !f.deletedAt) continue
        if (p.page && p.page !== pageId) continue
        const pubSec = Date.parse(f.publishedAt || p.createdAt || 0) / 1000
        if (!pubSec || pubSec < since) { if (f.deletedAt) { delete f.deletedAt; f.miss = 0 }; continue } // 超出範圍不判＋清掉舊誤標
        if (seenFb.has(f.postId)) { f.miss = 0; if (f.deletedAt) delete f.deletedAt }
        else { f.miss = (f.miss || 0) + 1; if (f.miss >= MISS_MAX) { if (!f.deletedAt) { f.deletedAt = nowIso; fbDeleted++ } } else if (f.deletedAt) delete f.deletedAt }
      }
    }

    // ── IG（Instagram）：粉專有連 IG 商業帳號才抓 ──
    let igImp = 0, igMeas = 0, igErr = null, igDeleted = 0, igOk = false
    if (pg.igUserId) {
      try {
        const media = await graphGet(`/${pg.igUserId}/media`, { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count', since: String(since), limit: '100' }, token)
        igOk = true
        const seenIg = new Set()
        for (const mp of (media.data || [])) {
          seenIg.add(mp.id)
          let p = doc.list.find(x => x.pub && x.pub.instagram && x.pub.instagram.mediaId === mp.id)
          if (!p) {
            p = { id: 'ig' + String(mp.id).slice(-16), title: '', caption: mp.caption || '', media: (mp.thumbnail_url || mp.media_url) ? [{ url: mp.thumbnail_url || mp.media_url, type: 'image' }] : [], targets: ['instagram'], platform: 'instagram', mediaType: mp.media_type || '', page: pg.igUserId, brand: pg.pageName + '·IG', status: 'published', source: 'imported', tags: [], relatedItems: [], createdAt: mp.timestamp, updatedAt: mp.timestamp, pub: { instagram: { mediaId: mp.id, permalink: mp.permalink, publishedAt: mp.timestamp, status: 'published' } } }
            doc.list.push(p); igImp++
          } else { if (mp.permalink) p.pub.instagram.permalink = mp.permalink; if (!p.mediaType && mp.media_type) p.mediaType = mp.media_type; if (p.pub.instagram.deletedAt) delete p.pub.instagram.deletedAt }
          // IG 數字：讚/留言直接從 media；其餘走 insights（名稱逐一試、略過無效的）
          let iv = {}
          const igMetrics = (mp.media_type === 'VIDEO' || mp.media_type === 'REELS') ? ['reach', 'saved', 'shares', 'views', 'total_interactions'] : ['reach', 'saved', 'shares', 'total_interactions']
          for (const mName of igMetrics) {
            try { const io = await graphGet(`/${mp.id}/insights`, { metric: mName }, token); const d0 = io.data && io.data[0]; const v = d0 && d0.values && d0.values[0]; if (v) iv[mName] = v.value || 0; else if (d0 && d0.total_value) iv[mName] = d0.total_value.value || 0 } catch (ie) { if (!igErr) igErr = 'ig-ins(' + mName + '):' + (ie.message || '') }
          }
          const snap = { plat: 'ig', reactions: num(mp.like_count), comments: num(mp.comments_count), shares: num(iv.shares), saves: num(iv.saved), reach: num(iv.reach), views: num(iv.views), totalInter: num(iv.total_interactions), raw: { mp, iv }, collectedAt: nowIso }
          md.days[`${p.id}::ig::${slot}`] = snap
          md.days[`${p.id}::ig::${today}`] = snap
          igMeas++
        }
        // IG 刪除偵測（同 FB 保守·連續缺席才標）
        for (const p of doc.list) {
          const g = p.pub && p.pub.instagram
          if (!g || g.mediaId == null) continue
          if (p.page && p.page !== pg.igUserId) continue
          const pubSec = Date.parse(g.publishedAt || p.createdAt || 0) / 1000
          if (!pubSec || pubSec < since) { if (g.deletedAt) { delete g.deletedAt; g.miss = 0 }; continue }
          if (seenIg.has(g.mediaId)) { g.miss = 0; if (g.deletedAt) delete g.deletedAt }
          else { g.miss = (g.miss || 0) + 1; if (g.miss >= MISS_MAX) { if (!g.deletedAt) { g.deletedAt = nowIso; igDeleted++ } } else if (g.deletedAt) delete g.deletedAt }
        }
      } catch (e) { igErr = 'ig:' + (e.message || '') }
    }
    // 粉絲數＋帳號層指標（儀表板 KPI／趨勢用）
    try { const fb = await graphGet(`/${pageId}`, { fields: 'fan_count,followers_count' }, token); const fc = num(fb.followers_count || fb.fan_count); if (fc) pg.followers = fc } catch (_) {}
    if (pg.igUserId) {
      try { const ig = await graphGet(`/${pg.igUserId}`, { fields: 'followers_count,media_count' }, token); if (ig.followers_count) pg.igFollowers = num(ig.followers_count); if (ig.media_count) pg.igMediaCount = num(ig.media_count) } catch (_) {}
    }
    // 粉絲數時序（畫粉絲成長曲線）：每日一點存 md.fans[<acctKey>::<date>]
    md.fans = md.fans || {}
    if (pg.followers) md.fans[`fb:${pageId}::${today}`] = { followers: pg.followers, at: nowIso, name: pg.pageName }
    if (pg.igFollowers) md.fans[`ig:${pg.igUserId}::${today}`] = { followers: pg.igFollowers, at: nowIso, name: pg.pageName + '·IG' }

    result.push({ page: pg.pageName, imported, measured, total: (feed.data || []).length, fbDeleted, ig: { imported: igImp, measured: igMeas, deleted: igDeleted, ...(igErr ? { err: igErr } : {}) }, ...(firstErr ? { err: firstErr } : {}) })
  }

  if (secDirty) await setSecret(sec, '刷新page token')
  await kvPut(mk, md, '社群成效'); await setPosts(doc, '社群匯入'); await setAccounts(acc, '社群健檢')
  return { ok: true, slot, pages: result }
}

export default async function handler(req, res) {
  try {
    const out = await runCollect(Number(req.query.days) || 30)
    return res.status(200).json(out)
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }) }
}

async function lineBoss(text) {
  try { const tk = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN), boss = clean(process.env.LINE_BOSS_USER); if (tk && boss) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: boss, messages: [{ type: 'text', text }] }) }) } catch (_) {}
}
