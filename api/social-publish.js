// ── 社群定時發文引擎（張良 2026-10-08；cron 每15分）──
// 規則：status='approved' 且（無排程時間 或 排程時間已到）→ 發到貼文指定的目的地 dests
// dests 格式：['fb:<pageId>', 'ig:<igUserId>']。FB 有圖走 /photos、純文字走 /feed；IG 兩步驟(建container→輪詢→publish)，IG 一定要有圖
// 安全：人工核可才會到 approved（審核即人工閘門）；DRY_RUN=true 只記 log 不真發
import { getPosts, setPosts, getAccounts, fbPageToken, graphGet, graphPost, DRY_RUN, metaReady } from './_social.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export default async function handler(req, res) {
  try {
    if (!metaReady()) return res.status(200).json({ ok: false, skipped: '未設 META env' })
    const doc = await getPosts(); doc.list = doc.list || []
    const now = Date.now()
    const due = doc.list.filter(p => p.status === 'approved' && (!p.scheduledAt || new Date(p.scheduledAt).getTime() <= now))
    if (!due.length) return res.status(200).json({ ok: true, published: 0 })
    const acc = await getAccounts(); const pages = (acc.facebook && acc.facebook.pages) || {}
    const out = []

    for (const p of due.slice(0, 5)) { // 一次最多 5 則
      p.status = 'publishing'; p.updatedAt = new Date().toISOString(); await setPosts(doc, '發布中') // 原子鎖：先標記避免重複發
      p.pub = p.pub || {}
      const dests = (p.dests && p.dests.length) ? p.dests : []
      let allOk = dests.length > 0
      if (!dests.length) { p.pub._err = '沒有選發布目標' }

      for (const dest of dests) {
        const i = dest.indexOf(':'); const type = dest.slice(0, i), id = dest.slice(i + 1)
        try {
          if (type === 'fb') {
            const token = await fbPageToken(id); if (!token) throw new Error('無粉專權杖')
            const img = (p.media && p.media[0] && p.media[0].url)
            let r
            if (DRY_RUN) r = { id: 'DRYRUN', post_id: 'DRYRUN' }
            else if (img) r = await graphPost(`/${id}/photos`, { url: img, caption: p.caption || '' }, token)
            else r = await graphPost(`/${id}/feed`, { message: p.caption || '' }, token)
            const postId = r.post_id || r.id
            let permalink = ''
            if (!DRY_RUN) { try { const pl = await graphGet(`/${postId}`, { fields: 'permalink_url' }, token); permalink = pl.permalink_url || '' } catch (_) {} }
            p.pub.facebook = { postId, permalink, publishedAt: new Date().toISOString(), status: 'published', dest: id }
          } else if (type === 'ig') {
            const ownPage = Object.values(pages).find(pg => pg.igUserId === id)
            const token = ownPage ? await fbPageToken(ownPage.pageId) : ''
            if (!token) throw new Error('IG 無權杖')
            const img = (p.media && p.media[0] && p.media[0].url); if (!img) throw new Error('IG 一定要有圖片')
            if (DRY_RUN) { p.pub.instagram = { mediaId: 'DRYRUN', status: 'published', publishedAt: new Date().toISOString(), dest: id } }
            else {
              const cont = await graphPost(`/${id}/media`, { image_url: img, caption: p.caption || '' }, token)
              let ready = false
              for (let k = 0; k < 12; k++) { const st = await graphGet(`/${cont.id}`, { fields: 'status_code' }, token); if (st.status_code === 'FINISHED') { ready = true; break } if (st.status_code === 'ERROR') throw new Error('IG 容器處理失敗'); await sleep(2500) }
              if (!ready) throw new Error('IG 容器逾時')
              const pub = await graphPost(`/${id}/media_publish`, { creation_id: cont.id }, token)
              let permalink = ''; try { const pl = await graphGet(`/${pub.id}`, { fields: 'permalink' }, token); permalink = pl.permalink || '' } catch (_) {}
              p.pub.instagram = { mediaId: pub.id, permalink, publishedAt: new Date().toISOString(), status: 'published', dest: id }
            }
          }
        } catch (e) {
          allOk = false
          p.pub[type === 'ig' ? 'instagram' : 'facebook'] = { status: 'failed', error: e.message || '發布失敗', dest: id }
        }
      }

      p.status = allOk ? 'published' : 'failed'; p.updatedAt = new Date().toISOString(); if (allOk) p.publishedAt = new Date().toISOString()
      await setPosts(doc, '發布結果')
      try { const { wpPush } = await import('./_webpush.js'); await wpPush(null, { title: allOk ? '✅ 社群已發布' : '⚠️ 社群發布失敗', body: (p.caption || '').slice(0, 50), url: '/prep#social', cat: 'other' }) } catch (_) {}
      out.push({ id: p.id, status: p.status })
    }

    return res.status(200).json({ ok: true, dryRun: DRY_RUN, published: out.filter(x => x.status === 'published').length, results: out })
  } catch (e) { return res.status(200).json({ ok: false, error: e.message }) }
}
