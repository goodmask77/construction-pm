import './_qpatch.js' // v4.71.10 DD 推播統一補額度尾巴
// ── /prep「社群」分頁後端（張良 2026-10-08）──
// 讀：GET  ?social=<OPS_BOARD_KEY>&me=token  → 帳號狀態＋貼文＋最新成效＋KPI＋canEdit
// 寫：POST ?social=<OPS_BOARD_KEY> body={op,token,...}  op: save/del/submit/approve/reject/disconnect
// 發文本身在 social-collect / 未來 social-publish；本檔只管內容庫與審核流程（Phase 1 先不自動發）
import { kvGet, kvPut, socTx, socRun, socGate } from './_socialkv.js' // v4.71.146 社群域依歸屬版本比對讀寫（其他鍵照舊 GD）
import { getAccounts, setAccounts, getSecret, setSecret, getPosts, setPosts, metricsKey, whoSocial, canEditSocial, metaReady, GV, graphGet, oauthPending } from './_social.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const ymOf = (iso) => String(iso || '').slice(0, 7)
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const P_KEY = 'sp_finance_pm_social_posts' // 貼文（同 _social.js）
const AST_KEY = 'sp_finance_pm_social_assets' // 素材庫（可重複用的圖片／影片）
const SLG_KEY = 'sp_finance_pm_social_slogans' // v4.71.5 靈感標語庫（張良 2026-10-12「我會貼上很多短劇slogan 主要文字＆精神標語 ai幫我產出文案」）：{list:[{id,text,tag,addedAt,addedBy}]}
const slgGet = async () => { const d = (await kvGet(SLG_KEY)) || { list: [] }; d.list = d.list || []; return d }

// AI 文案生成：v4.70.29 走 AI 中樞（api/_ai.js）route=social，設定頁可選 ChatGPT／Claude／Gemini；圖片用統一格式 {type:'image',media_type,data}
async function aiText(system, user, maxTokens = 1500) {
  const { aiCall } = await import('./_ai.js')
  const r = await aiCall('social', { system, messages: [{ role: 'user', content: user }], maxTokens })
  return r.text
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

// v4.71.146 入口包 socRun（一次請求一個讀寫物件；撞版本整段重做——有對外動作的操作（立即發布、上傳、AI 生圖）動作後一律 socTx 只重做寫入）
// 新殼頁經代發口 social_req 呼叫：req._who＝新殼已驗身分（同 whoSocial 格式），req._fromShell＝true
export default async function handler(req, res) { try { return await socRun((req && req._who && req._who.name) || '社群', () => handlerInner(req, res)) } catch (e) { return res.status(200).json({ ok: false, error: (e && e.code === 'stale') ? '社群資料一直有人同時在改，請重新整理再試一次' : String((e && e.message) || e).slice(0, 200) }) } } // 重試耗盡也回清楚訊息（Gemini 第一輪 B）
async function handlerInner(req, res) {
  try {
    const ok2 = clean(process.env.OPS_BOARD_KEY)

    if (req.method === 'GET') {
      if (!ok2 || String(req.query.social || '') !== ok2) return res.status(403).json({ ok: false, error: '金鑰錯誤' })
      const who = req._who !== undefined ? req._who : await whoSocial(String(req.query.me || ''))
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
      let pinBoards = [], slogans = [] // v4.71.5 Pinterest 登記圖版＋靈感標語庫
      try { const { pinDoc } = await import('./_pinterest.js'); pinBoards = (await pinDoc()).boards } catch (_) {}
      try { slogans = (await slgGet()).list } catch (_) {}
      return res.status(200).json({
        ok: true, connected: pageList.length > 0,
        account: pageList.length ? { pages: pageList, defaultPageId: (acc.facebook && acc.facebook.defaultPageId) || null } : null,
        metaReady: metaReady(), aiReady: !!(process.env.ANTHROPIC_API_KEY || '').trim(), graphVersion: GV, canEdit: canEditSocial(who),
        me: who ? { name: who.name, admin: who.admin } : null,
        posts: withM, assets, pinBoards, slogans, kpi: { pubThis: pubThis.length, reach, inter: interTot, avgInter },
      })
    }

    if (req.method === 'POST') {
      if (!ok2 || String(req.query.social || '') !== ok2) return res.status(403).json({ ok: false, error: '金鑰錯誤' })
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const who = req._who !== undefined ? req._who : await whoSocial(String(body.token || ''))
      if (!canEditSocial(who)) return res.status(200).json({ ok: false, error: '沒有編輯權限——請找張良開通' })
      const op = body.op
      if (['upload', 'genimg', 'gen', 'imgbrief', 'pinimport', 'pinboardadd', 'pinsync', 'sync', 'addpage', 'publishnow'].includes(op)) { const g = await socGate(); if (g) return res.status(200).json({ ok: false, error: g, code: 'smoke' }) } // 有對外動作（上傳、AI、Pinterest、Meta）先問驗收閘門（關卡 3 行銷大師第一輪 A1）
      const doc = await getPosts(); doc.list = doc.list || []
      const act = async (action, detail) => { try { const a = (await kvGet('pm_activity')) || []; a.unshift({ ts: new Date().toISOString(), user: who.name, action, detail }); await kvPut('pm_activity', a.slice(0, 500), '社群') } catch (_) {} }

      if (op === 'sync') {
        // 立即同步：手動觸發 collect（抓最新成效＋偵測粉專已刪的貼文）。張良 2026-10-10
        try { const { runCollect } = await import('./social-collect.js'); const r = await runCollect(Number(body.days) || 30); await act('立即同步社群成效'); return res.status(200).json(r) }
        catch (e) { if (e && e.code === 'stale') throw e; return res.status(200).json({ ok: false, error: e.message || '同步失敗' }) }
      }
      // ── v4.71.5 Pinterest（張良「做 存＆貼連結」）：貼連結立刻抓／登記圖版每小時自動抓 ──
      if (op === 'pinimport') { // body.urls = 多行連結（釘圖或圖版）
        const urls = String(body.urls || body.url || '').split(/[\s,，]+/).map(s => s.trim()).filter(s => /pinterest\.|pin\.it/i.test(s)).slice(0, 10)
        if (!urls.length) return res.status(200).json({ ok: false, error: '請貼 Pinterest 的釘圖或圖版連結' })
        const { importUrl } = await import('./_pinterest.js'); const results = []
        for (const u of urls) { try { results.push(await importUrl(u, who.name)) } catch (e) { results.push({ ok: false, url: u, error: String(e.message || e).slice(0, 160) }) } }
        const added = results.reduce((s, r) => s + ((r.added && r.added.length) || 0), 0), dup = results.reduce((s, r) => s + (r.dup || 0), 0), failed = results.reduce((s, r) => s + ((r.failed && r.failed.length) || 0), 0)
        if (added) await act('Pinterest 貼連結存圖', added + ' 張')
        return res.status(200).json({ ok: true, added, dup, failed, results, assets: (((await kvGet(AST_KEY)) || {}).list) || [] })
      }
      if (op === 'pinboardadd') { try { const { boardAdd } = await import('./_pinterest.js'); const r = await boardAdd(String(body.url || ''), who.name); await act('Pinterest 登記圖版', r.board.name); return res.status(200).json({ ok: true, ...r, added: r.added.length, assets: (((await kvGet(AST_KEY)) || {}).list) || [] }) } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e).slice(0, 200) }) } }
      if (op === 'pinboarddel') { if (!who.admin) return res.status(200).json({ ok: false, error: '只有管理者能移除登記的圖版' }); const { boardDel } = await import('./_pinterest.js'); return res.status(200).json({ ok: true, boards: await boardDel(String(body.id || '')) }) }
      if (op === 'pinsync') { try { const { syncAll, pinDoc } = await import('./_pinterest.js'); const r = await syncAll({ notify: false }); return res.status(200).json({ ...r, boards: (await pinDoc()).boards, assets: (((await kvGet(AST_KEY)) || {}).list) || [] }) } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e).slice(0, 200) }) } }
      // ── v4.71.5 靈感標語庫：一次貼很多行（短劇 slogan／主文字／精神標語），AI 文案「標語精神」風格會學它們的語感 ──
      if (op === 'sloganadd') {
        const lines = String(body.text || '').split(/\r?\n/).map(s => s.trim().replace(/^[-•*\d.、)\]]+\s*/, '')).filter(s => s.length >= 2 && s.length <= 200)
        if (!lines.length) return res.status(200).json({ ok: false, error: '沒有讀到內容，一行一句貼上來' })
        const d = await slgGet(); const have = new Set(d.list.map(x => x.text)); const tag = String(body.tag || '').trim().slice(0, 20); let n = 0
        for (const t of lines) { if (have.has(t)) continue; have.add(t); d.list.unshift({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t, tag, addedAt: new Date().toISOString(), addedBy: who.name }); n++ }
        d.list = d.list.slice(0, 2000); await kvPut(SLG_KEY, d); await act('靈感標語庫新增', n + ' 句')
        return res.status(200).json({ ok: true, added: n, dup: lines.length - n, slogans: d.list })
      }
      if (op === 'slogandel') { const d = await slgGet(); const ids = new Set(Array.isArray(body.ids) ? body.ids : [body.id]); d.list = d.list.filter(x => !ids.has(x.id)); await kvPut(SLG_KEY, d); return res.status(200).json({ ok: true, slogans: d.list }) }
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
          { const item = { url: publicUrl, type: 'image', name: String(body.name || '').slice(0, 40), addedAt: new Date().toISOString(), addedBy: who.name }; try { await socTx(AST_KEY, (cur) => { const L = (cur && cur.list) || []; if (L.some(x => x.url === publicUrl)) return { write: false }; return { write: true, doc: { ...(cur || {}), list: [item, ...L].slice(0, 300) } } }, '素材入庫') } catch (e) { console.error('[social] 素材入庫沒存進去', publicUrl, String(e && e.message || e).slice(0, 80)) } }
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
          spirit: '標語精神：學「靈感標語庫」那些短劇 slogan／精神標語的語感——短、有態度、一句打中人心、有畫面與反差；每版開頭先給一句主標語（15 字內），第二行副標語，接著才是貼文正文',
        }
        const style = styleMap[body.style] || styleMap.warm
        let bank = '' // v4.71.5 靈感標語庫：風格選「標語精神」時整批餵給 AI 學語感（最多 150 句／4000 字），不是拿來抄
        if (body.style === 'spirit') { try { const d = await slgGet(); const pick = d.list.slice(0, 150).map(x => x.text); bank = pick.join('\n').slice(0, 4000); if (!bank) return res.status(200).json({ ok: false, error: '靈感標語庫還是空的，先到「靈感庫」貼幾句 slogan 進來' }) } catch (_) {} }
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
              if (/^image\/(jpeg|png|gif|webp)$/.test(ct) && buf.length < 4.5 * 1024 * 1024) imgBlock = { type: 'image', media_type: ct, data: buf.toString('base64') } // 統一格式，_ai.js 會轉成各家吃的樣子
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
              const txtM = [`品牌：${bd}`, `平台語氣：${plat}`, `文案風格：${style}`, bank ? `【靈感標語庫】以下是老闆收集的短劇 slogan／精神標語，學它們的語感、節奏、態度來寫，但不要照抄任何一句：\n${bank}` : '', `文案長度：${len}`, `語言：${lang}`, items.length ? `主打餐點：${items.join('、')}` : '', imgBlock ? '已附上圖片，請先觀察畫面（餐點／擺盤／場景／氛圍）再寫，讓文字緊貼畫面。' : '', topic ? `要宣傳的重點／素材：\n${topic}` : '請主要依照圖片內容發想。'].filter(Boolean).join('\n')
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
            bank ? `【靈感標語庫】以下是老闆收集的短劇 slogan／精神標語，學它們的語感、節奏、態度來寫 5 版（每版主標語都要不同切角），但不要照抄任何一句：\n${bank}` : '',
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
      if (op === 'imgbrief') { // v4.71.6 張良 2026-10-12「都要描述有點麻煩」：選參考圖→AI 看圖自動寫生圖描述（老闆只要說想換成什麼，或什麼都不說）
        const hint = String(body.hint || '').trim().slice(0, 300)
        const imgs = []
        for (const u of (Array.isArray(body.refUrls) ? body.refUrls : []).slice(0, 3)) {
          try { const ir = await fetch(String(u)); if (!ir.ok) continue; const ct = (ir.headers.get('content-type') || 'image/jpeg').split(';')[0]; const buf = Buffer.from(await ir.arrayBuffer()); if (/^image\/(jpeg|png|webp|gif)$/.test(ct) && buf.length < 4 * 1024 * 1024) imgs.push({ type: 'image', media_type: ct, data: buf.toString('base64') }) } catch (_) {}
        }
        if (!imgs.length && !hint) return res.status(200).json({ ok: false, error: '先勾一張參考圖，或打幾個字說想要什麼' })
        const brand = '品牌 GROUN:D（海邊的披薩／漢堡／早午餐小店，品牌紅 #CE1611 配奶油色）與 A Beach 101&Pizza（海灘邊的披薩店）'
        const sys = `你是餐飲品牌的食物攝影／視覺美術指導。任務：替圖像生成模型寫一段「可以直接拿去生圖」的描述。${imgs.length ? '附圖是老闆喜歡的參考圖：先看懂它的風格（構圖、角度、光線、色調、質感、背景、版面／文字的擺法、氛圍），描述要能重現這種風格。' : ''}規則：①老闆有說要換成什麼商品／場景就照換（主體換掉，風格留著）；沒說就以我們自家餐點（披薩、漢堡、炸物、飲料任選最合適的一種）當主體，不要照抄參考圖裡別家的品牌名或商品。②描述要具體：主體與細節、容器／擺盤、構圖與鏡頭角度、光線、色調、背景、材質、氛圍；參考圖若是海報／看板／包裝那種設計類，要寫清楚版面結構（色塊、字體感、文字位置）並把文字改成我們自家的（品牌名可用 GROUN:D）。③用繁體中文寫，120～220 字，一段，不要標題、不要條列、不要解釋。只輸出描述本身。`
        const txt = [brand, hint ? `老闆的要求：${hint}` : '老闆沒有特別說，照參考圖的風格換成我們自家的餐點。'].join('\n')
        try {
          const { aiCall } = await import('./_ai.js')
          const r = await aiCall('app', { system: sys, messages: [{ role: 'user', content: imgs.length ? [...imgs, { type: 'text', text: txt }] : txt }], maxTokens: 700, effort: 'low' })
          const brief = String(r.text || '').trim().replace(/^```[\s\S]*?\n|```$/g, '').trim()
          if (!brief) return res.status(200).json({ ok: false, error: 'AI 沒寫出來，再試一次' })
          return res.status(200).json({ ok: true, brief, model: r.provider + '/' + r.model })
        } catch (e) { return res.status(200).json({ ok: false, error: '寫描述失敗：' + (e.message || '未知') }) }
      }
      if (op === 'genimg') {
        // v4.70.29 AI 生圖（張良「做圖就得用 Gemini」）：走 AI 中樞 route=image（設定頁可改 Gemini／ChatGPT），生好直接上傳 photos 桶＋入素材庫
        const prompt = String(body.prompt || '').trim().slice(0, 1500)
        if (!prompt) return res.status(200).json({ ok: false, error: '請先描述想要的畫面' })
        const aspect = ['1:1', '3:4', '4:3', '9:16', '16:9'].includes(body.aspect) ? body.aspect : '1:1'
        const refImages = []
        for (const u of (Array.isArray(body.refUrls) ? body.refUrls : []).slice(0, 3)) { // 參考圖（素材庫既有的圖，讓 AI 照著風格／商品改）
          try { const ir = await fetch(String(u)); if (!ir.ok) continue; const ct = (ir.headers.get('content-type') || 'image/jpeg').split(';')[0]; const buf = Buffer.from(await ir.arrayBuffer()); if (/^image\/(jpeg|png|webp)$/.test(ct) && buf.length < 4 * 1024 * 1024) refImages.push({ media_type: ct, data: buf.toString('base64') }) } catch (_) {}
        }
        let im
        try { const { aiImage } = await import('./_ai.js'); im = await aiImage('image', { prompt, refImages, aspect }) }
        catch (e) { return res.status(200).json({ ok: false, error: '生圖失敗：' + (e.message || '未知') }) }
        const ext = (im.mime || 'image/png').split('/')[1].replace('jpeg', 'jpg')
        const path = 'social/ai_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.' + ext
        try {
          const r = await fetch(`${SB_URL}/storage/v1/object/photos/${path}`, { method: 'POST', headers: { authorization: `Bearer ${SB_KEY}`, 'content-type': im.mime || 'image/png' }, body: Buffer.from(im.data, 'base64') })
          if (!r.ok) return res.status(200).json({ ok: false, error: '圖生好了但上傳失敗(' + r.status + ')' })
          const publicUrl = `${SB_URL}/storage/v1/object/public/photos/${path}`
          { const item = { url: publicUrl, type: 'image', name: ('AI:' + prompt).slice(0, 40), ai: 1, prompt: prompt.slice(0, 300), model: im.provider + '/' + im.model, addedAt: new Date().toISOString(), addedBy: who.name }; try { await socTx(AST_KEY, (cur) => { const L = (cur && cur.list) || []; if (L.some(x => x.url === publicUrl)) return { write: false }; return { write: true, doc: { ...(cur || {}), list: [item, ...L].slice(0, 300) } } }, 'AI生圖入庫') } catch (e) { console.error('[social] AI 生圖入庫沒存進去', publicUrl, String(e && e.message || e).slice(0, 80)) } } // 圖已生好上傳：只重做寫入（不重生圖）
          await act('社群AI生圖', (im.provider + ' ' + prompt).slice(0, 40))
          return res.status(200).json({ ok: true, url: publicUrl, provider: im.provider, model: im.model, note: im.note || '' })
        } catch (e) { return res.status(200).json({ ok: false, error: e.message || '上傳失敗' }) }
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
        // v4.71.146：① 先問驗收閘門 ② 版本比對認領（發布中＝不發：結果不明的不自動重發，要先到 FB／IG 確認；已發布的照原本可再發）③ 發 ④ 結果只改這一則（重讀最新、只重做寫入）
        { const g = await socGate(); if (g) return res.status(200).json({ ok: false, error: g, code: 'smoke' }) }
        { const op0 = await oauthPending(); if (op0) return res.status(200).json({ ok: false, error: op0 }) } // 授權沒做完不發（第七輪 A2）
        const claim = await socTx(P_KEY, (cur) => { const d = cur || { list: [] }; const x = (d.list || []).find(y => y.id === body.id); if (!x) return { write: false, value: { err: '找不到貼文' } }; if (x.status === 'publishing') return { write: false, value: { err: '這則正在發布中或上次結果不明——請先到 FB／IG 確認有沒有發出去，再找 CC 重設' } }; if (x.status === 'published' && x.publishedAt && Date.now() - Date.parse(x.publishedAt) < 10 * 60e3) return { write: false, value: { err: '這則 ' + Math.max(1, Math.round((Date.now() - Date.parse(x.publishedAt)) / 60e3)) + ' 分鐘前剛發布過；要再發一次請 10 分鐘後再按（避免逾時重按發兩次）' } }; if (Object.values(x.pub || {}).some(v => v && v.status === 'unknown')) return { write: false, value: { err: '上次發布結果不明（可能已發出）——請先到 FB／IG 確認，再找 CC 重設後重發' } }; const now = new Date().toISOString(); x.status = 'publishing'; x.claimAt = now; x.claimBy = who.name; x.updatedAt = now; return { write: true, doc: d, value: { post: JSON.parse(JSON.stringify(x)) } } }, '立即發布中')
        if (claim.err) return res.status(200).json({ ok: false, error: claim.err })
        const { publishPost } = await import('./social-publish.js')
        const acc = await getAccounts(); const pages = (acc.facebook && acc.facebook.pages) || {}
        const p2 = claim.post; let okPub = false
        try { okPub = await publishPost(p2, pages) } catch (e) { p2.pub = p2.pub || {}; p2.pub._err = String(e && e.message || e).slice(0, 200) }
        const nowR = new Date().toISOString()
        try { await socTx(P_KEY, (cur) => { const d = cur || { list: [] }; const x = (d.list || []).find(y => y.id === body.id); if (!x) return { write: false }; x.pub = p2.pub; x.status = okPub ? 'published' : 'failed'; x.updatedAt = nowR; delete x.claimAt; if (okPub) { x.publishedAt = nowR; x.approvedBy = who.name; x.approvedAt = nowR } return { write: true, doc: d } }, '立即發布結果') }
        catch (e) { console.error('[social] 立即發布結果沒存進去（貼文停在發布中）', body.id, String(e && e.message || e).slice(0, 80)); return res.status(200).json({ ok: okPub, status: okPub ? 'published' : 'failed', pub: p2.pub, error: '發布' + (okPub ? '成功' : '失敗') + '，但結果沒存進去（貼文停在發布中），請重新整理並找 CC 核對' }) }
        await act(okPub ? '社群立即發布' : '社群發布失敗', (p2.caption || '').slice(0, 20))
        const igErr = p2.pub && p2.pub.instagram && ['failed', 'unknown'].includes(p2.pub.instagram.status) ? p2.pub.instagram.error : ''
        const fbErr = p2.pub && p2.pub.facebook && ['failed', 'unknown'].includes(p2.pub.facebook.status) ? p2.pub.facebook.error : ''
        return res.status(200).json({ ok: okPub, status: okPub ? 'published' : 'failed', pub: p2.pub, error: okPub ? null : ('發布失敗：' + [igErr && ('IG—' + igErr), fbErr && ('FB—' + fbErr), p2.pub && p2.pub._err].filter(Boolean).join('；')) })
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
        } catch (e) { if (e && e.code === 'stale') throw e; return res.status(200).json({ ok: false, error: e.message || '新增失敗' }) } // 撞版本整段重做（重拿權杖是唯讀）
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
  } catch (e) { if (e && e.code === 'stale') throw e; return res.status(200).json({ ok: false, error: e.message || '伺服器錯誤' }) } // 撞版本往外丟給 socRun 整段重做
}
