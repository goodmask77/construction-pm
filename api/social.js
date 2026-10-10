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
const AST_KEY = 'sp_finance_pm_social_assets' // 素材庫（可重複用的圖片／影片）

// AI 文案生成：沿用 api/ai.js 同一套金鑰與多模型回退
const AI_MODELS = [process.env.ANTHROPIC_MODEL, 'claude-sonnet-4-6', 'claude-opus-4-8'].filter(Boolean)
async function aiText(system, user, maxTokens = 1500) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim()
  if (!key) throw new Error('AI 文案生成尚未設定（缺 ANTHROPIC_API_KEY）')
  let lastErr = 'AI 服務錯誤'
  for (const model of AI_MODELS) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok) return (data.content || []).map(b => b.text || '').join('').trim()
      lastErr = (data.error && data.error.message) || lastErr
      if (!(/model/i.test(lastErr) || r.status === 404)) break // 非模型問題（金鑰/額度）不再換，直接報
    } catch (e) { lastErr = e.message || lastErr }
  }
  throw new Error(lastErr)
}

// 從 AI 回應解析出多個版本（優先吃 JSON {versions:[...]}，失敗再退回分隔切割）
function parseVersions(raw) {
  if (!raw) return []
  // 統一清掉每版開頭的角度標籤（如「【情境帶入】」）再回傳
  const clean = a => a.map(x => String(x || '').trim().replace(/^【[^】]{0,16}】\s*/, '').trim()).filter(Boolean).slice(0, 5)
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { const o = JSON.parse(s); if (Array.isArray(o.versions)) return clean(o.versions) } catch (_) {}
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { const o = JSON.parse(m[0]); if (Array.isArray(o.versions)) return clean(o.versions) } catch (_) {} }
  const parts = s.split(/\n\s*(?:[-=]{3,}|版本\s*[一二三四五1-5]|\[\[?\d\]?\]|\d\s*[\.、).])/).map(x => x.trim()).filter(x => x.length > 8)
  return clean(parts)
}

// 取每篇貼文分平台（FB／IG）的「最新一筆」成效＋成長曲線時序（翻最近兩個月檔）
// key 新格式 <pid>::<plat>::<slot>（slot 含 T 為 3 小時時序點、無 T 為每日最終值）；舊格式 <pid>::<date> 以 id 前綴判平台
async function latestMetrics(postIds) {
  const now = new Date(Date.now() + 8 * 3600e3)
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const yms = [prev.toISOString().slice(0, 7), now.toISOString().slice(0, 7)]
  const ids = new Set(postIds)
  const out = {} // out[pid] = { fb, ig, series:{fb:[],ig:[]}, _fbAt, _igAt }
  for (const ym of yms) {
    const doc = (await kvGet(metricsKey(ym))) || { days: {} }
    for (const [k, v] of Object.entries(doc.days || {})) {
      const parts = k.split('::'); if (parts.length < 2) continue
      const pid = parts[0]; if (!ids.has(pid)) continue
      let plat, slot
      if (parts.length >= 3) { plat = parts[1]; slot = parts[2] }
      else { plat = (v && v.plat) || (pid.startsWith('ig') ? 'ig' : 'fb'); slot = parts[1] } // 舊格式相容
      if (plat !== 'fb' && plat !== 'ig') plat = 'fb'
      out[pid] = out[pid] || { series: { fb: [], ig: [] } }
      const atKey = '_' + plat + 'At'
      if (!out[pid][atKey] || slot > out[pid][atKey]) { out[pid][plat] = { ...v }; out[pid][atKey] = slot }
      if (/T\d/.test(slot)) out[pid].series[plat].push({ t: slot, v: (v.reactions || 0) + (v.comments || 0) + (v.shares || 0), reach: v.reach || 0, saves: v.saves || 0, views: v.views || 0 })
    }
  }
  for (const pid in out) for (const pl of ['fb', 'ig']) { const m = {}; out[pid].series[pl].forEach(x => { m[x.t] = x }); out[pid].series[pl] = Object.values(m).sort((a, b) => a.t < b.t ? -1 : 1) }
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
      const inter = m => m ? ((m.reactions || 0) + (m.comments || 0) + (m.shares || 0)) : 0
      const withM = posts
        .map(p => { const mm = mx[p.id] || {}; return { ...p, metricsFb: mm.fb || null, metricsIg: mm.ig || null, metrics: mm.ig || mm.fb || null, series: mm.series || null } })
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      // KPI（分平台各自加總，一則雙平台的 FB 互動＋IG 互動分開算）
      const thisYm = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
      const pub = withM.filter(p => p.status === 'published')
      const pubThis = pub.filter(p => ymOf((p.pub && p.pub.facebook && p.pub.facebook.publishedAt) || (p.pub && p.pub.instagram && p.pub.instagram.publishedAt) || p.updatedAt) === thisYm)
      // 觸及被 Meta 2024 淘汰 FB 端（IG 仍有）→ 看板以「互動（讚+留言+分享）」為主
      const reach = pub.reduce((s, p) => s + ((p.metricsFb && p.metricsFb.reach) || 0) + ((p.metricsIg && p.metricsIg.reach) || 0), 0)
      const withMet = pub.filter(p => p.metricsFb || p.metricsIg)
      const interTot = pub.reduce((s, p) => s + inter(p.metricsFb) + inter(p.metricsIg), 0)
      const avgInter = withMet.length ? Math.round(interTot / withMet.length * 10) / 10 : 0
      const pageMap = (acc.facebook && acc.facebook.pages) || {}
      const pageList = Object.values(pageMap)
      const assets = ((await kvGet(AST_KEY)) || { list: [] }).list || []
      return res.status(200).json({
        ok: true, connected: pageList.length > 0,
        account: pageList.length ? { pages: pageList, defaultPageId: (acc.facebook && acc.facebook.defaultPageId) || null } : null,
        metaReady: metaReady(), aiReady: !!(process.env.ANTHROPIC_API_KEY || '').trim(), graphVersion: GV, canEdit: canEditSocial(who),
        me: who ? { name: who.name, admin: who.admin } : null,
        posts: withM, assets, kpi: { pubThis: pubThis.length, reach, inter: interTot, avgInter },
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

      if (op === 'sync') {
        // 立即同步：手動觸發 collect（抓最新成效＋偵測粉專已刪的貼文）。張良 2026-10-10
        try { const { runCollect } = await import('./social-collect.js'); const r = await runCollect(Number(body.days) || 30); await act('立即同步社群成效'); return res.status(200).json(r) }
        catch (e) { return res.status(200).json({ ok: false, error: e.message || '同步失敗' }) }
      }
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
          const publicUrl = `${SB_URL}/storage/v1/object/public/photos/${path}`
          // 存進素材庫，之後可重複選用
          try { const a = (await kvGet(AST_KEY)) || { list: [] }; a.list = a.list || []; a.list.unshift({ url: publicUrl, type: 'image', name: String(body.name || '').slice(0, 40), addedAt: new Date().toISOString(), addedBy: who.name }); a.list = a.list.slice(0, 300); await kvPut(AST_KEY, a, '素材入庫') } catch (_) {}
          return res.status(200).json({ ok: true, url: publicUrl })
        } catch (e) { return res.status(200).json({ ok: false, error: e.message || '上傳失敗' }) }
      }
      if (op === 'gen') {
        const topic = String(body.topic || '').trim().slice(0, 800)
        const imgUrl = String(body.imageUrl || '').trim()
        if (!topic && !imgUrl) return res.status(200).json({ ok: false, error: '請先輸入要宣傳的重點，或先選一張圖片（AI 會看圖寫）' })
        const styleMap = {
          promo: '促銷強打：營造限時／優惠的急迫感，明確行動呼籲（快來、把握、限定）',
          warm: '溫馨日常：親切有溫度，像跟熟客朋友分享生活',
          chic: '文青質感：精煉有氛圍，重意境與畫面感，留白得宜',
          fun: '活潑俏皮：輕鬆幽默，多用口語和表情，貼近年輕族群',
          pro: '專業正式：清楚得體，適合正式公告或品牌宣達',
        }
        const style = styleMap[body.style] || styleMap.warm
        const lenMap = { short: '精簡有力，大約 1–2 句、30 字以內', medium: '適中，大約 3–4 句、60 字上下', long: '較完整，大約 5–7 句、100 字以上，適度分段' }
        const len = lenMap[body.length] || lenMap.medium
        const lang = body.lang === 'en' ? '只用英文撰寫'
          : body.lang === 'bi' ? '先寫繁體中文版本，空一行用「——」分隔後，再接對應的英文版本'
            : '只用繁體中文（台灣用語、口語自然）'
        const plat = body.platform === 'fb'
          ? 'Facebook 貼文：可稍長、有敘事感與故事性，結尾放 2–3 個相關 hashtag'
          : 'Instagram 貼文：精簡分段、適度使用 emoji，結尾放 5–8 個相關 hashtag（中英混搭）'
        const items = (Array.isArray(body.relatedItems) ? body.relatedItems : []).slice(0, 10).filter(Boolean)
        // 抓圖一次（multi 與單版共用）：有圖就讓 AI 看圖（base64 餵 Claude vision）
        let imgBlock = null
        if (imgUrl) {
          try {
            const ir = await fetch(imgUrl)
            if (ir.ok) {
              const ct = (ir.headers.get('content-type') || 'image/jpeg').split(';')[0]
              const buf = Buffer.from(await ir.arrayBuffer())
              if (/^image\/(jpeg|png|gif|webp)$/.test(ct) && buf.length < 4.5 * 1024 * 1024) imgBlock = { type: 'image', source: { type: 'base64', media_type: ct, data: buf.toString('base64') } }
            }
          } catch (_) { /* 抓圖失敗就純文字生成 */ }
        }
        const mkContent = (t) => imgBlock ? [imgBlock, { type: 'text', text: t }] : t
        // ── 分品牌模式：為每個品牌各寫一版（各自調性，避免兩品牌四個帳號發得一模一樣影響成效）──
        if (body.mode === 'multi' && Array.isArray(body.brands) && body.brands.filter(Boolean).length) {
          try {
            const brands = body.brands.slice(0, 4).map(s => String(s || '').trim().slice(0, 40)).filter(Boolean)
            const per = []
            for (const bd of brands) {
              const sysM = `你是台灣餐飲品牌「${bd}」的資深社群小編。請為這個品牌寫「1 則」可直接複製貼上就發佈的純貼文正文，要緊貼「${bd}」的品牌特色、調性與客群，用專屬口吻撰寫，和別的品牌明顯區隔、不要寫得像同一篇。⚠️不要加「【】」方括號標籤、標題或任何說明，直接寫正文。只輸出 JSON，格式嚴格為：{"versions":["正文"]}`
              const txtM = [`品牌：${bd}`, `平台語氣：${plat}`, `文案風格：${style}`, `文案長度：${len}`, `語言：${lang}`, items.length ? `主打餐點：${items.join('、')}` : '', imgBlock ? '已附上圖片，請先觀察畫面（餐點／擺盤／場景／氛圍）再寫，讓文字緊貼畫面。' : '', topic ? `要宣傳的重點／素材：\n${topic}` : '請主要依照圖片內容發想。'].filter(Boolean).join('\n')
              const vs = parseVersions(await aiText(sysM, mkContent(txtM), 1200))
              per.push({ brand: bd, caption: (vs && vs[0]) || '' })
            }
            if (!per.some(x => x.caption)) return res.status(200).json({ ok: false, error: '生成是空的，請換個說法再試一次' })
            await act('社群AI分品牌生成', brands.join('/'))
            return res.status(200).json({ ok: true, perBrand: per })
          } catch (e) { return res.status(200).json({ ok: false, error: e.message || '生成失敗' }) }
        }
        // ── 單一版：一次 5 版不同角度（原本行為）──
        let versions
        try {
          const brand = String(body.brand || '').trim().slice(0, 40)
          const sys = '你是台灣餐飲品牌的資深社群小編，擅長寫吸引人、會被分享與收藏的貼文。這次請一次產出 5 個切入角度明顯不同的版本，每個都是「可直接複製貼上就發佈的純貼文正文」。⚠️非常重要：絕對不要在內文裡加上「【情境帶入】」「【產品特色】」這類角度名稱、標題或任何方括號標籤，直接寫貼文本身。只輸出 JSON，格式嚴格為：{"versions":["版本一","版本二","版本三","版本四","版本五"]}，不要任何其他文字、不要 markdown 標記、不要說明。'
          const txt = [
            brand ? `品牌：${brand}` : '',
            `平台語氣：${plat}`,
            `文案風格：${style}`,
            `文案長度：每版${len}`,
            `語言：${lang}`,
            items.length ? `主打餐點：${items.join('、')}` : '',
            imgBlock ? '已附上一張圖片，請先仔細觀察圖片內容（餐點外觀／擺盤／場景／氛圍／文字），讓 5 個版本都緊貼畫面。' : '',
            topic ? `要宣傳的重點／素材：\n${topic}` : '請主要依照圖片內容發想貼文。',
          ].filter(Boolean).join('\n')
          versions = parseVersions(await aiText(sys, mkContent(txt), 2800))
        } catch (e) { return res.status(200).json({ ok: false, error: e.message || '生成失敗' }) }
        if (!versions || !versions.length) return res.status(200).json({ ok: false, error: '生成是空的，請換個說法再試一次' })
        await act('社群AI生成5版', String(body.topic || '').slice(0, 24))
        return res.status(200).json({ ok: true, versions, caption: versions[0] })
      }
      if (op === 'assetdel') {
        const u = String(body.url || '')
        const a = (await kvGet(AST_KEY)) || { list: [] }; a.list = (a.list || []).filter(x => x.url !== u)
        await kvPut(AST_KEY, a, '素材庫刪'); await act('社群刪素材', '')
        return res.status(200).json({ ok: true })
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
      if (op === 'publishnow') { // 立即發送（管理者繞審核直接發到勾選平台）
        if (!who.admin) return res.status(200).json({ ok: false, error: '只有管理者能直接發送' })
        if (!metaReady()) return res.status(200).json({ ok: false, error: '發送功能尚未開通（Meta 未設定）' })
        const p = doc.list.find(x => x.id === body.id); if (!p) return res.status(200).json({ ok: false, error: '找不到貼文' })
        if (!(p.dests && p.dests.length)) return res.status(200).json({ ok: false, error: '還沒勾選要發到哪個平台（下面「發布到哪裡」）' })
        try {
          const { publishPost } = await import('./social-publish.js')
          const acc = await getAccounts(); const pages = (acc.facebook && acc.facebook.pages) || {}
          p.status = 'publishing'; p.updatedAt = new Date().toISOString(); await setPosts(doc, '立即發布中')
          const okPub = await publishPost(p, pages)
          p.status = okPub ? 'published' : 'failed'; p.updatedAt = new Date().toISOString(); if (okPub) { p.publishedAt = new Date().toISOString(); p.approvedBy = who.name; p.approvedAt = p.publishedAt }
          await setPosts(doc, '立即發布結果'); await act(okPub ? '社群立即發布' : '社群發布失敗', (p.caption || '').slice(0, 20))
          const igErr = p.pub && p.pub.instagram && p.pub.instagram.status === 'failed' ? p.pub.instagram.error : ''
          const fbErr = p.pub && p.pub.facebook && p.pub.facebook.status === 'failed' ? p.pub.facebook.error : ''
          return res.status(200).json({ ok: okPub, status: p.status, pub: p.pub, error: okPub ? null : ('發布失敗：' + [igErr && ('IG—' + igErr), fbErr && ('FB—' + fbErr)].filter(Boolean).join('；')) })
        } catch (e) { p.status = 'failed'; await setPosts(doc, '立即發布錯誤'); return res.status(200).json({ ok: false, error: e.message || '發布失敗' }) }
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
