// ── /prep「社群」分頁後端（張良 2026-10-08）──
// 讀：GET  ?social=<OPS_BOARD_KEY>&me=token  → 帳號狀態＋貼文＋最新成效＋KPI＋canEdit
// 寫：POST ?social=<OPS_BOARD_KEY> body={op,token,...}  op: save/del/submit/approve/reject/disconnect
// 發文本身在 social-collect / 未來 social-publish；本檔只管內容庫與審核流程（Phase 1 先不自動發）
import { kvGet, kvPut } from './mail-sync.js'
import { getAccounts, setAccounts, getSecret, setSecret, getPosts, setPosts, metricsKey, whoSocial, canEditSocial, metaReady, GV, graphGet } from './_social.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const ymOf = (iso) => String(iso || '').slice(0, 7)
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// 取每篇貼文「最新一筆」成效快照（翻最近兩個月檔）
async function latestMetrics(postIds) {
  const now = new Date(Date.now() + 8 * 3600e3)
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const yms = [now.toISOString().slice(0, 7), prev.toISOString().slice(0, 7)]
  const ids = new Set(postIds)
  const out = {}
  for (const ym of yms) {
    const doc = (await kvGet(metricsKey(ym))) || { days: {} }
    for (const [k, v] of Object.entries(doc.days || {})) {
      const i = k.indexOf('::'); if (i < 0) continue
      const pid = k.slice(0, i), date = k.slice(i + 2)
      if (!ids.has(pid)) continue
      if (!out[pid] || date > out[pid]._date) out[pid] = { ...v, _date: date }
    }
  }
  return out
}

export default async function handler(req, res) {
  try {
    const ok2 = clean(process.env.OPS_BOARD_KEY)

    if (req.method === 'GET') {
      if (!ok2 || String(req.query.social || '') !== ok2) return res.status(403).json({ ok: false, error: '金鑰錯誤' })
      const who = await whoSocial(String(req.query.me || ''))
      const acc = await getAccounts()
      const posts = (await getPosts()).list || []
      const mx = await latestMetrics(posts.map(p => p.id))
      const withM = posts
        .map(p => ({ ...p, metrics: mx[p.id] || null }))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      // KPI
      const thisYm = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
      const pub = withM.filter(p => p.status === 'published')
      const pubThis = pub.filter(p => ymOf((p.pub && p.pub.facebook && p.pub.facebook.publishedAt) || p.updatedAt) === thisYm)
      // 觸及被 Meta 2024 淘汰（API 抓不到）→ 看板以「互動（讚+留言+分享）」為主
      const reach = pub.reduce((s, p) => s + ((p.metrics && p.metrics.reach) || 0), 0)
      const withMet = pub.filter(p => p.metrics)
      const interTot = withMet.reduce((s, p) => s + ((p.metrics.reactions || 0) + (p.metrics.comments || 0) + (p.metrics.shares || 0)), 0)
      const avgInter = withMet.length ? Math.round(interTot / withMet.length * 10) / 10 : 0
      const pageMap = (acc.facebook && acc.facebook.pages) || {}
      const pageList = Object.values(pageMap)
      return res.status(200).json({
        ok: true, connected: pageList.length > 0,
        account: pageList.length ? { pages: pageList, defaultPageId: (acc.facebook && acc.facebook.defaultPageId) || null } : null,
        metaReady: metaReady(), graphVersion: GV, canEdit: canEditSocial(who),
        me: who ? { name: who.name, admin: who.admin } : null,
        posts: withM, kpi: { pubThis: pubThis.length, reach, inter: interTot, avgInter },
      })
    }

    if (req.method === 'POST') {
      if (!ok2 || String(req.query.social || '') !== ok2) return res.status(403).json({ ok: false, error: '金鑰錯誤' })
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const who = await whoSocial(String(body.token || ''))
      if (!canEditSocial(who)) return res.status(200).json({ ok: false, error: '沒有編輯權限——請找張良開通' })
      const op = body.op
      const doc = await getPosts(); doc.list = doc.list || []
      const act = async (action, detail) => { try { const a = (await kvGet('pm_activity')) || []; a.unshift({ ts: new Date().toISOString(), user: who.name, action, detail }); await kvPut('pm_activity', a.slice(0, 500), '社群') } catch (_) {} }

      if (op === 'upload') {
        // 貼文圖片上傳 photos 桶（公開，發文時給 Meta 當 image_url）
        const du = String(body.dataUrl || '')
        const m = du.match(/^data:(image\/[\w+]+);base64,(.+)$/)
        if (!m) return res.status(200).json({ ok: false, error: '圖片格式不對' })
        const ext = m[1].split('/')[1].replace('jpeg', 'jpg')
        const buf = Buffer.from(m[2], 'base64')
        const path = 'social/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.' + ext
        try {
          const r = await fetch(`${SB_URL}/storage/v1/object/photos/${path}`, { method: 'POST', headers: { authorization: `Bearer ${SB_KEY}`, 'content-type': m[1] }, body: buf })
          if (!r.ok) return res.status(200).json({ ok: false, error: '上傳失敗(' + r.status + ')' })
          return res.status(200).json({ ok: true, url: `${SB_URL}/storage/v1/object/public/photos/${path}` })
        } catch (e) { return res.status(200).json({ ok: false, error: e.message || '上傳失敗' }) }
      }
      if (op === 'save') {
        const now = new Date().toISOString()
        let p = body.id && doc.list.find(x => x.id === body.id)
        if (p) Object.assign(p, { title: body.title || '', caption: body.caption || '', media: body.media || [], dests: body.dests || [], scheduledAt: body.scheduledAt || null, tags: body.tags || [], relatedItems: body.relatedItems || [], updatedAt: now })
        else { p = { id: 'sp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: body.title || '', caption: body.caption || '', media: body.media || [], dests: body.dests || [], scheduledAt: body.scheduledAt || null, status: 'draft', source: body.source || 'manual', tags: body.tags || [], relatedItems: body.relatedItems || [], createdAt: now, updatedAt: now, pub: {} }; doc.list.unshift(p) }
        await setPosts(doc, '存草稿'); await act('社群存草稿', p.title || (p.caption || '').slice(0, 20))
        return res.status(200).json({ ok: true, id: p.id })
      }
      if (op === 'del') { doc.list = doc.list.filter(x => x.id !== body.id); await setPosts(doc, '刪草稿'); await act('社群刪除', body.id); return res.status(200).json({ ok: true }) }
      if (op === 'submit') {
        const p = doc.list.find(x => x.id === body.id); if (!p) return res.status(200).json({ ok: false, error: '找不到貼文' })
        p.status = 'pending_review'; p.updatedAt = new Date().toISOString(); await setPosts(doc, '送審'); await act('社群送審', p.title || (p.caption || '').slice(0, 20))
        try { const { wpPush } = await import('./_webpush.js'); await wpPush(null, { title: '📣 社群貼文待審核', body: (p.title || p.caption || '').slice(0, 60), url: '/prep#social', cat: 'issue' }) } catch (_) {}
        try { const tk = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN), boss = clean(process.env.LINE_BOSS_USER); if (tk && boss) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: boss, messages: [{ type: 'text', text: `📣 社群貼文待審核\n\n${(p.caption || '').slice(0, 120)}\n\n預定：${p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('zh-TW') : '未排程'}\n→ 到 App「社群」分頁核准` }] }) }) } catch (_) {}
        return res.status(200).json({ ok: true })
      }
      if (op === 'approve' || op === 'reject') {
        if (!who.admin) return res.status(200).json({ ok: false, error: '只有管理者能審核' })
        const p = doc.list.find(x => x.id === body.id); if (!p) return res.status(200).json({ ok: false, error: '找不到貼文' })
        p.status = op === 'approve' ? 'approved' : 'rejected'; p.approvedBy = who.name; p.approvedAt = new Date().toISOString(); p.updatedAt = p.approvedAt
        await setPosts(doc, op); await act('社群' + (op === 'approve' ? '核准' : '退回'), p.title || (p.caption || '').slice(0, 20))
        return res.status(200).json({ ok: true })
      }
      if (op === 'addpage') {
        if (!who.admin) return res.status(200).json({ ok: false, error: '只有管理者能新增粉專' })
        // 商家旗下粉專不列在 /me/accounts：用授權時存的 user token＋粉專編號直接拿 page token
        const pid = String(body.pageId || '').replace(/[^0-9]/g, '')
        if (!pid) return res.status(200).json({ ok: false, error: '請輸入粉專編號（純數字）' })
        const sec = await getSecret()
        const ut = sec.facebook && sec.facebook.userToken
        if (!ut) return res.status(200).json({ ok: false, error: '請先按一次「連接 Facebook」授權（才會有讀取權杖），再用編號新增' })
        try {
          const pg = await graphGet('/' + pid, { fields: 'id,name,access_token,instagram_business_account' }, ut)
          if (!pg.access_token) return res.status(200).json({ ok: false, error: '這個編號拿不到權杖——確認你是該粉專的完整管理員' })
          const acc = await getAccounts(); acc.facebook = acc.facebook || {}; if (!acc.facebook.pages) acc.facebook.pages = {}
          const now = new Date().toISOString()
          acc.facebook.pages[pg.id] = { pageId: pg.id, pageName: pg.name, igUserId: (pg.instagram_business_account || {}).id || null, tokenStatus: 'ok', tokenCheckedAt: now, connectedAt: now, connectedBy: who.name }
          if (!acc.facebook.defaultPageId) acc.facebook.defaultPageId = pg.id
          await setAccounts(acc, '加粉專')
          if (!sec.facebook.tokens) sec.facebook.tokens = {}
          sec.facebook.tokens[pg.id] = pg.access_token; await setSecret(sec, '加粉專token')
          await act('社群加粉專', pg.name)
          return res.status(200).json({ ok: true, name: pg.name })
        } catch (e) { return res.status(200).json({ ok: false, error: e.message || '新增失敗' }) }
      }
      if (op === 'delpage') {
        if (!who.admin) return res.status(200).json({ ok: false, error: '只有管理者能移除粉專' })
        const pid = String(body.pageId || '')
        const acc = await getAccounts()
        if (acc.facebook && acc.facebook.pages) { delete acc.facebook.pages[pid]; if (acc.facebook.defaultPageId === pid) acc.facebook.defaultPageId = Object.keys(acc.facebook.pages)[0] || null; await setAccounts(acc, '移除粉專') }
        const sec = await getSecret(); if (sec.facebook && sec.facebook.tokens) { delete sec.facebook.tokens[pid]; await setSecret(sec, '移除粉專token') }
        await act('社群移除粉專', pid)
        return res.status(200).json({ ok: true })
      }
      if (op === 'disconnect') { if (!who.admin) return res.status(200).json({ ok: false, error: '只有管理者能斷開' }); await setAccounts({}, '斷開'); await setSecret({}, '斷開'); await act('社群斷開連接', ''); return res.status(200).json({ ok: true }) }
      return res.status(200).json({ ok: false, error: '未知操作' })
    }

    return res.status(405).json({ ok: false, error: '方法不支援' })
  } catch (e) { return res.status(200).json({ ok: false, error: e.message || '伺服器錯誤' }) }
}
