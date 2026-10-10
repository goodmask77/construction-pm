// ⚠️ /prep 第 14 塊（張良 2026-10-08）：社群自動發文＋成效（Phase 1 先 FB、先只讀數據）
// 讀 /api/social、寫 POST /api/social；連接走 /api/social-oauth?start=token；真正發文＝下一期
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => Math.round(n || 0).toLocaleString()
  const ST = { draft: ['草稿', '#8C98A8'], pending_review: ['待審核', '#E8A657'], approved: ['已核准待發', '#4DA3FF'], publishing: ['發布中', '#4DA3FF'], published: ['已發布', '#3DBE6C'], failed: ['失敗', '#F07373'], rejected: ['已退回', '#F07373'] }
  let DATA = null, subTab = 'dash', editId = null, editMedia = [], soDrill = {}, platFilter = 'all'
  let connEditOn = false // 連接卡「編輯」模式：預設藏操作鈕（連接/斷開/✕/編號），按編輯才顯示
  let genStyle = 'warm', genLang = 'zh', genLen = 'medium', genVers = [] // AI 生成文案：風格／語言／長度／最近 5 版
  let multiDraft = [] // v4.70.26 分品牌各生一版：[{brand,caption,dests}]
  const STYLES = [['warm', '溫馨日常'], ['promo', '促銷強打'], ['chic', '文青質感'], ['fun', '活潑俏皮'], ['pro', '專業正式']]
  const LANGS = [['zh', '繁中'], ['en', '英文'], ['bi', '中英雙語']]
  const LENS = [['short', '簡短(1-2句)'], ['medium', '適中(3-4句)'], ['long', '較長(5句+)']]
  const INTER = m => (m ? (m.reactions || 0) + (m.comments || 0) + (m.shares || 0) : 0)
  const PLAT = p => (p === 'instagram' || p === 'ig') ? { k: 'ig', n: 'IG', c: '#E1427E' } : { k: 'fb', n: 'FB', c: '#4D8BF0' } // 品牌色：FB藍／IG粉
  // 一則可能發到多平台：優先看實際發布結果 pub，其次看勾選 dests，最後才退回匯入貼文的 platform
  const postPlats = p => { const s = new Set(); if (p.pub) { if (p.pub.facebook) s.add('fb'); if (p.pub.instagram) s.add('ig') } if (!s.size && p.dests && p.dests.length) p.dests.forEach(d => s.add(d.startsWith('ig') ? 'ig' : 'fb')); if (!s.size) s.add(p.platform === 'instagram' || p.platform === 'ig' ? 'ig' : 'fb'); return [...s] }
  const platBadges = p => postPlats(p).map(k => `<span style="font-size:11px;font-weight:800;color:${k === 'ig' ? '#E1427E' : '#4D8BF0'}">${k === 'ig' ? 'IG' : 'FB'}</span>`).join('<span style="color:var(--muted);font-size:10px;margin:0 2px">·</span>')
  const inFilter = p => platFilter === 'all' || postPlats(p).includes(platFilter)
  // 聚合統計（儀表板共用；吃 platFilter）
  // v4.70.21 分平台：一則貼文攤成「FB 一筆＋IG 一筆」各帶自己的 metrics＝趨勢/熱力/平台對比全部自動分平台，不再互蓋
  function stats() {
    const out = []
    for (const p of (DATA.posts || []).filter(x => x.status === 'published')) {
      const push = (plat, m) => { if (!m) return; if (platFilter !== 'all' && platFilter !== plat) return; out.push({ ...p, platform: plat === 'ig' ? 'instagram' : 'facebook', metrics: m, _plat: plat }) }
      if (p.metricsFb || p.metricsIg) { push('fb', p.metricsFb); push('ig', p.metricsIg) }
      else if (p.metrics) push(p.platform === 'instagram' ? 'ig' : 'fb', p.metrics) // 舊資料相容
    }
    const fb = out.filter(p => p._plat === 'fb'), ig = out.filter(p => p._plat === 'ig')
    const totInter = out.reduce((s, p) => s + INTER(p.metrics), 0)
    const totReach = out.reduce((s, p) => s + (p.metrics.reach || 0), 0)
    const totSaves = out.reduce((s, p) => s + (p.metrics.saves || 0), 0)
    const pages = ((DATA.account || {}).pages) || []
    const followers = pages.reduce((s, p) => s + (platFilter !== 'ig' ? (p.followers || 0) : 0) + (platFilter !== 'fb' ? (p.igFollowers || 0) : 0), 0)
    const avg = arr => arr.length ? Math.round(arr.reduce((s, p) => s + INTER(p.metrics), 0) / arr.length) : 0
    return { posts: out, fb, ig, totInter, totReach, totSaves, followers, avgInter: out.length ? Math.round(totInter / out.length) : 0, igAvg: avg(ig), fbAvg: avg(fb) }
  }

  async function sPost(body) {
    const r = await fetch('/api/social?social=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
    return r.json()
  }

  window.socialLoad = async function () {
    curStore = 'social'; try { setTabs('social') } catch (_) {}
    document.getElementById('upd').textContent = '行銷大師中心'
    app.innerHTML = '<section><div class="hint" style="padding:22px">載入中…</div></section>'
    let d; try { const r = await fetch('/api/social?social=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch (e) {}
    if (!d || !d.ok) { app.innerHTML = '<div class="err">讀不到社群資料（' + ((d && d.error) || '連線問題') + '）</div>'; return }
    DATA = d; socialRender()
  }

  function kcard(label, val, sub, color) {
    return `<div class="kpi" style="text-align:left"><div class="v" style="color:${color};font-size:27px">${val}</div><div class="l" style="font-size:14px;margin-top:2px">${label}</div>${sub ? `<div class="sub2">${sub}</div>` : ''}</div>`
  }
  function socialRender() {
    const d = DATA, s = stats()
    const _sTab = (((window._tabCfg || {}).names || {}).social) || '行銷大師' // v4.70.18 標題跟著設定頁「分頁名稱」走，避免側邊欄改了標題沒跟上
    let h = '<h1>📣 ' + _sTab + '</h1><div class="sub">粉專內容與成效・Facebook ＋ Instagram</div>'
    // 6 KPI
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0">`
      + kcard('貼文總數', nf(s.posts.length), `FB ${s.fb.length} · IG ${s.ig.length}`, '#4DA3FF')
      + kcard('總互動', nf(s.totInter), '讚+留言+分享', '#3DBE6C')
      + kcard('IG 總觸及', nf(s.totReach), s.ig.length ? `平均 ${nf(Math.round(s.totReach / s.ig.length))}/篇` : '', '#E8A657')
      + kcard('每篇平均互動', nf(s.avgInter), '', '#4DA3FF')
      + kcard('總收藏', nf(s.totSaves), 'IG 被收藏', '#E8C14E')
      + kcard('粉絲數', s.followers ? nf(s.followers) : '—', 'FB＋IG', '#B48CF2')
      + `</div>`
    h += connCard()
    h += `<div style="display:flex;gap:8px;margin:16px 0 4px;flex-wrap:wrap;align-items:center">`
      + `<button class="mini ${subTab === 'dash' ? 'on' : ''}" onclick="_socialSub('dash')">📊 儀表板</button>`
      + `<button class="mini ${subTab === 'lib' ? 'on' : ''}" onclick="_socialSub('lib')">內容庫</button>`
      + `<button class="mini ${subTab === 'assets' ? 'on' : ''}" onclick="_socialSub('assets')">📁 素材庫</button>`
      + (d.canEdit ? `<button class="mini" id="soSyncBtn" onclick="_socialSync()" title="馬上抓最新數據＋偵測粉專已刪的貼文（平常每 3 小時自動跑）">🔄 立即同步</button>` : '')
      + `<span style="margin-left:auto;display:flex;gap:6px">`
      + `<button class="mini ${platFilter === 'all' ? 'on' : ''}" onclick="_socialPlat('all')">全部</button>`
      + `<button class="mini ${platFilter === 'fb' ? 'on' : ''}" onclick="_socialPlat('fb')"><span style="color:#4D8BF0">●</span> FB</button>`
      + `<button class="mini ${platFilter === 'ig' ? 'on' : ''}" onclick="_socialPlat('ig')"><span style="color:#E1427E">●</span> IG</button>`
      + `</span></div>`
    h += '<div id="socialBody"></div>'
    app.innerHTML = h
    socialBody()
  }

  function connCard() {
    const d = DATA, a = d.account
    const isAdmin = !!(d.me && d.me.admin) // 連接/移除粉專＝敏感操作，只有管理者能看能按
    if (!d.metaReady) return `<section><b>尚未啟用</b><div class="hint" style="margin-top:6px">系統還沒設定 Meta App（這步 CC 做）。設定好後這裡會出現「連接 Facebook」按鈕。</div></section>`
    const pages = (a && a.pages) || []
    const showEdit = isAdmin && connEditOn // 編輯模式才顯示操作鈕
    if (pages.length) {
      const rows = pages.map(p => {
        const bad = p.tokenStatus === 'invalid'
        return `<div style="display:flex;align-items:center;gap:8px"><b style="color:${bad ? '#F07373' : '#3DBE6C'}">${bad ? '⚠' : '●'}</b> <b>${esc(p.pageName || '')}</b>${bad ? '<span class="hint">（授權失效，請重新連接）</span>' : ''}${p.igUserId ? '<span class="hint" style="font-size:11px">IG已連結</span>' : ''}${showEdit ? `<span onclick="_socialDelPage('${p.pageId}','${esc(p.pageName || '').replace(/'/g, '')}')" style="cursor:pointer;color:var(--muted);font-weight:700;margin-left:4px" title="從這裡移除（不影響粉專本身）">✕</span>` : ''}</div>`
      }).join('')
      return `<section>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:6px">${rows}</div>
          <div style="display:flex;gap:6px">${showEdit ? `<button class="mini" onclick="_socialConnect()">＋ 連接其他粉專</button><button class="mini" onclick="_socialDisconnect()">全部斷開</button><button class="mini on" onclick="_socialConnEdit()">✓ 完成</button>` : (isAdmin ? `<button class="mini" onclick="_socialConnEdit()">✎ 編輯</button>` : '')}</div>
        </div>
        ${showEdit ? '<div class="hint" style="margin-top:8px">要加別人管理的粉專（如同事管的 GROUN:D）：請那位同事用「他的 FB」按「＋ 連接其他粉專」登入即可，不會蓋掉現有的。</div>' : ''}
        ${showEdit ? addByIdRow() : ''}
      </section>`
    }
    return `<section style="text-align:center;padding:22px">
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">還沒連接任何粉專</div>
      <div class="hint" style="margin-bottom:14px">按下去用 Facebook 登入、同意一次就好（要用粉專管理員帳號）。A Beach 和 GROUN:D 可分別用各自的管理帳號連。</div>
      ${isAdmin ? `<button class="mini on" style="padding:9px 22px;font-size:15px" onclick="_socialConnect()">連接 Facebook</button>${addByIdRow()}` : `<div class="hint">只有管理者能連接粉專。</div>`}
    </section>`
  }

  // 商家旗下粉專不列在連接清單→用粉專編號直接加（需先連接過一次存下讀取權杖）
  function addByIdRow() {
    return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
      <div class="hint" style="margin-bottom:6px">找不到你的粉專（商家旗下的常被 Meta 藏起來）？用「粉專編號」直接加：</div>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
        <input id="sfPageId" placeholder="粉專編號（純數字）" style="border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-width:180px">
        <button class="mini" onclick="_socialAddPage()">用編號新增</button>
      </div>
    </div>`
  }
  window._socialDelPage = async function (pid, name) {
    if (!confirm('把「' + name + '」從這裡移除？\n（只是從系統拿掉、不影響你的 FB 粉專本身）')) return
    const j = await sPost({ op: 'delpage', pageId: pid })
    if (j.ok) socialLoad(); else alert(j.error || '移除失敗')
  }
  window._socialAddPage = async function () {
    const pid = ((document.getElementById('sfPageId') || {}).value || '').trim()
    if (!pid) { alert('請先貼上粉專編號（純數字）'); return }
    const j = await sPost({ op: 'addpage', pageId: pid })
    if (j.ok) { alert('已加入粉專：' + j.name); socialLoad() } else alert(j.error || '新增失敗')
  }

  window._socialSub = function (t) { subTab = t; socialRender() }
  window._socialPlat = function (f) { platFilter = f; socialRender() }
  window._socialSync = async function () {
    const btn = document.getElementById('soSyncBtn'); if (btn) { btn.disabled = true; btn.textContent = '🔄 同步中…（約 20–40 秒）' }
    let j; try { j = await sPost({ op: 'sync' }) } catch (e) { j = { ok: false, error: '連線問題' } }
    if (!j || !j.ok) { if (btn) { btn.disabled = false; btn.textContent = '🔄 立即同步' }; alert((j && j.error) || '同步失敗'); return }
    await socialLoad() // 重載最新數據（含剛同步的成效與已刪標記）
  }

  window._socialConnEdit = function () { connEditOn = !connEditOn; socialRender() }
  window._socialConnect = function () {
    if (!TK()) { alert('請先登入（右上「登入」），再連接粉專'); return }
    location.href = '/api/social-oauth?start=' + encodeURIComponent(TK())
  }
  window._socialDisconnect = async function () {
    if (!confirm('確定要斷開 GROUN:D 粉專？斷開後不再自動抓數據，之後要重新連接。')) return
    const j = await sPost({ op: 'disconnect' }); if (j.ok) socialLoad(); else alert(j.error || '失敗')
  }

  function socialBody() {
    const el = document.getElementById('socialBody'); if (!el) return
    if (subTab === 'dash') { el.innerHTML = dashView(); return }
    if (subTab === 'assets') { el.innerHTML = assetsView(); return }
    el.innerHTML = libView()
    if (document.getElementById('sfMediaWrap')) renderMedia() // 編輯器開著→初始化圖片牆＋拖曳排序
  }

  // 素材庫（獨立子分頁：平常上傳管理，發貼文時可重複選用）
  function assetsView() {
    const assets = DATA.assets || []
    const isAdmin = !!(DATA.me && DATA.me.admin)
    let h = ''
    if (DATA.canEdit) h += `<div style="margin:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="mini on" id="sfUpBtn" style="padding:8px 16px" onclick="_socialUploadAsset()">＋ 上傳素材（可一次多張）</button><button class="mini" style="padding:8px 16px" onclick="_socialGenImg()">AI 生圖</button><span id="sfUpProg" class="hint">上傳的圖存這裡，新增貼文時可一鍵選用、不用每次重傳</span></div>`
    if (!assets.length) return h + '<section><div class="hint" style="padding:18px">素材庫還是空的。按「＋ 上傳素材」放圖片進來，之後新增貼文時就能重複選用。</div></section>'
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">' + assets.map(a => `<div style="position:relative"><img src="${esc(a.url)}" onclick="_socialAssetView('${esc(a.url)}')" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;border:1px solid var(--line);cursor:zoom-in">${isAdmin ? `<span onclick="event.stopPropagation();_socialAssetDel('${esc(a.url)}',this)" style="position:absolute;top:5px;right:5px;background:rgba(0,0,0,.6);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:700">✕</span>` : ''}</div>`).join('') + '</div>'
    return h
  }
  // 壓縮單張成 dataURL（長邊 1280、jpeg 0.82）
  function compressImg(f) {
    return new Promise((res, rej) => {
      const im = new Image()
      im.onload = () => {
        const sc = Math.min(1, 1280 / Math.max(im.width, im.height))
        const cv = document.createElement('canvas'); cv.width = Math.round(im.width * sc); cv.height = Math.round(im.height * sc)
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height)
        try { res(cv.toDataURL('image/jpeg', 0.82)) } catch (e) { rej(e) }
      }
      im.onerror = rej; im.src = URL.createObjectURL(f)
    })
  }
  window._socialUploadAsset = function () {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true // 批量多選
    inp.style.display = 'none'; document.body.appendChild(inp) // v4.70.20 iOS 需掛 DOM 才觸發（同 _socialPickImg）
    inp.onchange = async () => {
      const files = [...inp.files]; if (!files.length) { inp.remove(); return }
      const btn = document.getElementById('sfUpBtn'); const prog = document.getElementById('sfUpProg')
      if (btn) btn.disabled = true
      let ok = 0, fail = 0
      for (let i = 0; i < files.length; i++) {
        if (prog) prog.textContent = `上傳中 ${i + 1}/${files.length}…（成功 ${ok}）`
        try {
          const du = await compressImg(files[i])
          const j = await sPost({ op: 'upload', dataUrl: du })
          if (j.ok) { DATA.assets = DATA.assets || []; DATA.assets.unshift({ url: j.url, type: 'image' }); ok++ } else fail++
        } catch (_) { fail++ }
      }
      if (btn) btn.disabled = false
      socialBody() // 重畫，新圖都顯示出來
      if (fail) alert(`上傳完成：成功 ${ok} 張，失敗 ${fail} 張`)
      inp.remove()
    }
    inp.click()
  }

  // 內容庫
  function libView() {
    const d = DATA, posts = (d.posts || []).filter(inFilter)
    let h = ''
    if (d.canEdit) h += `<div style="margin:10px 0"><button class="mini on" style="padding:8px 16px" onclick="_socialEdit('')">＋ 新增貼文</button></div>`
    if (editId !== null) h += editorHtml(posts.find(p => p.id === editId) || null)
    if (!posts.length) return h + '<section><div class="hint" style="padding:18px">還沒有貼文。連接粉專後，系統今晚起會自動把你粉專近 30 天的貼文抓進來。</div></section>'
    const canEd = d.canEdit
    const rows = flattenRows(posts)
    const docShown = new Set()
    const th = (label, right) => `<th style="padding:11px 12px;font-weight:600;white-space:nowrap${right ? ';text-align:right' : ''}">${label}</th>`
    h += `<div class="hint" style="margin:2px 0 9px">共 ${rows.length} 筆・每則貼文依實際發佈的平台分列（同一則的重複紀錄已自動併一列）${platFilter !== 'all' ? '・只看 ' + (platFilter === 'ig' ? 'IG' : 'FB') : ''}・點任一列看完整數據</div>`
    h += `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:14px;background:var(--card)">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:940px">
        <thead><tr style="background:#131A23;color:var(--muted);text-align:left;font-size:12px;letter-spacing:.3px">
          ${th('帳號')}${th('貼文')}${th('平台')}${th('讚', 1)}${th('留言', 1)}${th('分享', 1)}${th('觸及', 1)}${th('收藏', 1)}${th('瀏覽', 1)}${th('互動', 1)}${th('狀態')}${th('日期')}${canEd ? th('操作') : ''}
        </tr></thead>
        <tbody>${rows.map(r => { const first = !docShown.has(r.id); docShown.add(r.id); return rowHtml(r, canEd, first) }).join('')}</tbody>
      </table>
    </div>`
    return h
  }

  const SHORT_BRAND = b => { b = (b || '').replace(/·IG$/, '').trim(); if (/beach/i.test(b)) return 'A Beach'; if (/groun/i.test(b)) return 'GROUN:D'; return b || '—' }
  const FB_C = '#4D8BF0', IG_C = '#E1427E'

  // v4.70.24 內容庫表格升級：攤平成「平台列」+ 用原生 postId/mediaId 去重（同一則的 App 發布筆與匯入筆併一列）、每個指標獨立欄、帳號欄、tabular 數字、配色對齊版面
  function flattenRows(posts) {
    const rows = [], seen = new Map()
    for (const p of posts) {
      const plats = []
      if (p.metricsFb || (p.pub && p.pub.facebook)) plats.push('fb')
      if (p.metricsIg || (p.pub && p.pub.instagram)) plats.push('ig')
      if (!plats.length) postPlats(p).forEach(k => plats.push(k)) // 草稿/待審：看預定平台
      for (const plat of plats) {
        if (platFilter !== 'all' && platFilter !== plat) continue
        const m = plat === 'fb' ? p.metricsFb : p.metricsIg
        const pubp = p.pub && p.pub[plat === 'fb' ? 'facebook' : 'instagram']
        const nativeId = pubp && (pubp.postId || pubp.mediaId)
        const key = plat + ':' + (nativeId || 'doc:' + p.id)
        const when = (pubp && pubp.publishedAt) || p.publishedAt || p.updatedAt || p.createdAt || ''
        const row = { p, id: p.id, plat, brand: SHORT_BRAND(p.brand), caption: p.caption, media: p.media, status: p.status, metrics: m, when, hasM: !!m }
        if (seen.has(key)) { const i = seen.get(key), o = rows[i]; if ((row.hasM && !o.hasM) || (row.hasM === o.hasM && row.when > o.when)) rows[i] = row }
        else { seen.set(key, rows.length); rows.push(row) }
      }
    }
    rows.sort((a, b) => a.when < b.when ? 1 : a.when > b.when ? -1 : 0)
    return rows
  }

  function rowHtml(r, canEd, showActs) {
    const p = r.p, st = ST[p.status] || ['', '#8C98A8'], m = r.metrics
    const pc = r.plat === 'ig' ? IG_C : FB_C
    const img = (r.media && r.media[0] && r.media[0].url) || ''
    const thumb = img ? `<img src="${esc(img)}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;flex:0 0 auto">` : '<div style="width:40px;height:40px;border-radius:8px;background:#1C222B;flex:0 0 auto"></div>'
    const num = (v, strong) => (v != null) ? `<td style="padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums;color:${strong ? pc : 'var(--text)'};font-weight:${strong ? 800 : 600}">${nf(v)}</td>` : '<td style="padding:9px 12px;text-align:right;color:var(--muted)">—</td>'
    const inter = m ? (m.reactions || 0) + (m.comments || 0) + (m.shares || 0) : null
    const dt = r.when ? String(r.when).slice(5, 10).replace('-', '/') : '—'
    let acts = ''
    if (canEd && showActs) {
      if (p.status === 'draft' || p.status === 'rejected') acts = `<button class="mini" onclick="event.stopPropagation();_socialEdit('${p.id}')">編輯</button><button class="mini" onclick="event.stopPropagation();_socialSubmit('${p.id}')">送審</button><button class="mini" onclick="event.stopPropagation();_socialDel('${p.id}')">刪</button>`
      else if (p.status === 'pending_review' && DATA.me && DATA.me.admin) acts = `${DATA.metaReady ? `<button class="mini on" style="background:#3DBE6C;border-color:transparent" onclick="event.stopPropagation();_socialApprovePublish('${p.id}')">🚀 核准並發</button>` : ''}<button class="mini" onclick="event.stopPropagation();_socialApprove('${p.id}','approve')">核准</button><button class="mini" onclick="event.stopPropagation();_socialApprove('${p.id}','reject')">退</button>`
    }
    return `<tr onclick="_socialDetail('${p.id}')" style="border-top:1px solid var(--line);cursor:pointer" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background=''">
      <td style="padding:9px 12px;white-space:nowrap"><span style="display:inline-block;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid var(--line);font-size:12px;font-weight:600">${esc(r.brand)}</span></td>
      <td style="padding:9px 12px"><div style="display:flex;gap:10px;align-items:center;min-width:0">${thumb}<div style="min-width:0;max-width:340px"><div style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((r.caption || '（無文字）').slice(0, 70))}</div>${(p.tags || []).length ? `<div class="hint" style="font-size:11px;margin-top:2px">#${esc(p.tags[0])}</div>` : ''}</div></div></td>
      <td style="padding:9px 12px;white-space:nowrap"><span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${r.plat === 'ig' ? 'rgba(225,66,126,.15)' : 'rgba(77,139,240,.15)'};color:${pc};font-size:11px;font-weight:800">${r.plat === 'ig' ? 'IG' : 'FB'}</span></td>
      ${num(m && m.reactions)}${num(m && m.comments)}${num(m && m.shares)}${num(m && m.reach)}${num(m && m.saves)}${num(m && m.views)}${num(inter, true)}
      <td style="padding:9px 12px;white-space:nowrap"><span style="color:${st[1]};font-weight:700;font-size:12px">● ${st[0]}</span></td>
      <td style="padding:9px 12px;white-space:nowrap;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums">${dt}</td>
      ${canEd ? `<td style="padding:9px 12px" onclick="event.stopPropagation()"><div style="display:flex;gap:4px;flex-wrap:wrap">${acts || '<span class="hint" style="font-size:11px">—</span>'}</div></td>` : ''}
    </tr>`
  }

  // 發布目標勾選（每個連接的粉專＝FB 一個、IG 一個）
  function destBoxes(v) {
    const pages = ((DATA.account || {}).pages) || []
    const cur = new Set(v.dests || [])
    if (!pages.length) return '<div class="hint">（還沒連接粉專，連接後才能選發布目標）</div>'
    let h = '<label class="hint">發布到哪裡（可複選）</label><div style="display:flex;flex-direction:column;gap:5px;margin-top:5px">'
    for (const pg of pages) {
      h += `<label style="display:flex;gap:7px;align-items:center;cursor:pointer"><input type="checkbox" class="sfDest" value="fb:${pg.pageId}" ${cur.has('fb:' + pg.pageId) ? 'checked' : ''}> ${esc(pg.pageName)}（FB）</label>`
      if (pg.igUserId) h += `<label style="display:flex;gap:7px;align-items:center;cursor:pointer"><input type="checkbox" class="sfDest" value="ig:${pg.igUserId}" ${cur.has('ig:' + pg.igUserId) ? 'checked' : ''}> ${esc(pg.pageName)}（IG・需附圖）</label>`
    }
    return h + '</div>'
  }

  // 編輯器（新增/改草稿）
  function editorHtml(p) {
    const v = p || {}
    const isLater = !!v.scheduledAt
    const aiBox = DATA.aiReady === false ? '' : `
      <div style="border:1px dashed var(--primary);border-radius:12px;padding:12px;margin:4px 0 14px;background:#111A24">
        <div style="font-weight:800;margin-bottom:3px">✨ AI 一鍵生成文案</div>
        <div class="hint" style="margin-bottom:8px">上面有選圖的話，AI 會先看圖再寫。填要宣傳什麼、挑風格/語言/長度，按生成給 5 版選。</div>
        <textarea id="sfTopic" rows="2" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:9px;margin-bottom:8px" placeholder="要宣傳什麼？例：新品草莓千層上市、週末下午茶買一送一（只選圖不打字也行）"></textarea>
        <div style="margin-bottom:6px"><span class="hint" style="margin-right:6px">風格</span>${STYLES.map(s => `<button class="mini ${genStyle === s[0] ? 'on' : ''}" onclick="_socialPickStyle(this,'${s[0]}')">${s[1]}</button>`).join('')}</div>
        <div style="margin-bottom:6px"><span class="hint" style="margin-right:6px">語言</span>${LANGS.map(l => `<button class="mini ${genLang === l[0] ? 'on' : ''}" onclick="_socialPickLang(this,'${l[0]}')">${l[1]}</button>`).join('')}</div>
        <div style="margin-bottom:10px"><span class="hint" style="margin-right:6px">長度</span>${LENS.map(l => `<button class="mini ${genLen === l[0] ? 'on' : ''}" onclick="_socialPickLen(this,'${l[0]}')">${l[1]}</button>`).join('')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="mini on" id="sfGenBtn" style="padding:8px 20px" onclick="_socialGen()">✨ 生成 5 版文案</button>
          <button class="mini" id="sfGenMultiBtn" style="padding:8px 16px" onclick="_socialGenMulti()">🏷 分品牌各生一版</button>
        </div>
        <div class="hint" style="margin-top:6px;font-size:11px">「分品牌各生一版」＝先在下方勾選兩個品牌以上的發布目標，AI 會依各品牌調性各寫一版、各自建一則（素材共用、文案不同），避免四個帳號發得一模一樣影響成效。</div>
        <div id="sfGenOut"></div>
      </div>`
    return `<section style="border:1px solid var(--primary)">
      <h2>${p ? '編輯貼文' : '新增貼文'}</h2>
      <label class="hint">① 圖片（可多張、可拖曳排序，第一張＝封面；IG 必附）</label>
      <div id="sfMediaWrap" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 12px"></div>
      <label class="hint">② AI 生成 / 文案</label>
      ${aiBox}
      <textarea id="sfCap" rows="5" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;margin:4px 0 10px" placeholder="貼文內容…（可用上方 AI 生成，或自己打）">${esc(v.caption || '')}</textarea>
      ${destBoxes(v)}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <div style="flex:1;min-width:150px"><label class="hint">分類（逗號分隔，如 新品,活動）</label><input id="sfTags" value="${esc((v.tags || []).join(','))}" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:4px"></div>
        <div style="flex:1;min-width:150px"><label class="hint">關聯餐點（分析銷量用，逗號分隔）</label><input id="sfItems" value="${esc((v.relatedItems || []).join(','))}" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:4px"></div>
      </div>
      <div style="margin-top:10px">
        <label class="hint">發送時間</label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:5px;flex-wrap:wrap">
          <button class="mini ${isLater ? '' : 'on'}" id="sfSchNow" onclick="_socialSchMode('now')">⚡ 即刻發送</button>
          <button class="mini ${isLater ? 'on' : ''}" id="sfSchLater" onclick="_socialSchMode('later')">📅 指定時間</button>
          <input id="sfWhen" type="datetime-local" value="${v.scheduledAt ? new Date(v.scheduledAt).toISOString().slice(0, 16) : ''}" style="border:1px solid var(--line);border-radius:10px;padding:8px;display:${isLater ? 'inline-block' : 'none'}">
        </div>
      </div>
      <div id="sfSchHint" class="hint" style="margin-top:8px">${isLater ? '📅 已選「指定時間」：到你設的時間自動發。' : '⚡ 已選「即刻發送」：填好內容後，按「🚀 立即發送」直接發，或「✓ 儲存草稿」留著稍後。'}</div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="mini on" onclick="_socialSave('${v.id || ''}')">✓ 儲存草稿</button>
        ${(DATA.me && DATA.me.admin && DATA.metaReady) ? `<button class="mini" style="background:#3DBE6C;color:#fff;border-color:transparent" onclick="_socialPublishNow('${v.id || ''}')">🚀 立即發送</button>` : ''}
        <button class="mini" onclick="_socialEditClose()">取消</button>
      </div>
    </section>`
  }

  window._socialPickImg = function () {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true // 可一次多張，加入到圖片牆
    inp.style.display = 'none'; document.body.appendChild(inp) // v4.70.20 iOS Safari 需 input 掛在 DOM 上 .click() 才會開選圖視窗（原本沒 append＝手機按了沒反應）
    inp.onchange = async () => {
      const files = [...inp.files]; if (!files.length) { inp.remove(); return }
      for (const f of files) {
        try {
          const du = await compressImg(f)
          const j = await sPost({ op: 'upload', dataUrl: du })
          if (j.ok) { editMedia.push({ url: j.url, type: 'image' }); DATA.assets = DATA.assets || []; DATA.assets.unshift({ url: j.url, type: 'image' }) }
          else alert(j.error || '上傳失敗')
        } catch (_) {}
      }
      renderMedia()
      inp.remove()
    }
    inp.click()
  }

  // ── AI 一鍵生成文案 ──
  window._socialPickStyle = function (el, v) { genStyle = v;[...el.parentNode.querySelectorAll('.mini')].forEach(b => b.classList.remove('on')); el.classList.add('on') }
  window._socialPickLang = function (el, v) { genLang = v;[...el.parentNode.querySelectorAll('.mini')].forEach(b => b.classList.remove('on')); el.classList.add('on') }
  window._socialPickLen = function (el, v) { genLen = v;[...el.parentNode.querySelectorAll('.mini')].forEach(b => b.classList.remove('on')); el.classList.add('on') }
  // 發送時間：即刻 / 指定時間
  window._socialSchMode = function (m) {
    const now = document.getElementById('sfSchNow'), later = document.getElementById('sfSchLater'), inp = document.getElementById('sfWhen'), hint = document.getElementById('sfSchHint')
    if (!now || !later || !inp) return
    if (m === 'later') { later.classList.add('on'); now.classList.remove('on'); inp.style.display = 'inline-block'; inp.focus(); if (hint) hint.textContent = '📅 已選「指定時間」：到你設的時間自動發。' }
    else { now.classList.add('on'); later.classList.remove('on'); inp.style.display = 'none'; if (hint) hint.textContent = '⚡ 已選「即刻發送」：核准後馬上發。內容填好後，按下面「✓ 儲存」送出。' }
  }

  // ── 多圖：縮圖牆＋拖曳排序（第一張＝封面）──
  function mediaItemsHtml() {
    const items = editMedia.map((m, i) => `<div class="sfMediaItem" data-url="${esc(m.url)}" style="position:relative;width:78px;height:78px;flex:0 0 auto">
      <img src="${esc(m.url)}" onclick="_socialAssetView('${esc(m.url)}')" style="width:100%;height:100%;object-fit:cover;border-radius:10px;border:1px solid var(--line);cursor:zoom-in">
      ${i === 0 ? '<span style="position:absolute;bottom:3px;left:3px;background:rgba(0,0,0,.65);color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:5px">封面</span>' : ''}
      <span onclick="event.stopPropagation();_socialRmMedia('${esc(m.url)}')" style="position:absolute;top:-6px;right:-6px;background:#F07373;color:#fff;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:700;font-size:12px">✕</span>
    </div>`).join('')
    const add = `<div class="sfAddBtns" style="display:flex;flex-direction:column;gap:4px;justify-content:center;flex:0 0 auto">
      <button class="mini" onclick="_socialPickImg()">＋上傳</button>
      <button class="mini" onclick="_socialAssets()">📁素材庫</button>
    </div>`
    return (items || '') + add
  }
  function renderMedia() {
    const el = document.getElementById('sfMediaWrap'); if (!el) return
    if (el._sortable) { try { el._sortable.destroy() } catch (_) {} el._sortable = null }
    el.innerHTML = mediaItemsHtml()
    bindMediaSort()
  }
  function bindMediaSort() {
    const el = document.getElementById('sfMediaWrap'); if (!el || el._sortable) return
    if (window.Sortable) el._sortable = window.Sortable.create(el, { animation: 150, draggable: '.sfMediaItem', filter: '.sfAddBtns', preventOnFilter: false, onEnd: syncMediaOrder }) // v4.70.20 preventOnFilter:false＝手機上「＋上傳/素材庫」兩鈕的點擊不再被 Sortable 攔掉（張良「點了沒反應」）
  }
  function syncMediaOrder() {
    const el = document.getElementById('sfMediaWrap'); if (!el) return
    const order = [...el.querySelectorAll('.sfMediaItem')].map(x => x.dataset.url)
    editMedia = order.map(u => editMedia.find(m => m.url === u)).filter(Boolean)
    renderMedia() // 重畫讓「封面」標記跟著移到第一張
  }
  window._socialRmMedia = function (url) { editMedia = editMedia.filter(m => m.url !== url); renderMedia() }
  window._socialGen = async function () {
    const topic = ((document.getElementById('sfTopic') || {}).value || '').trim()
    const imageUrl = (editMedia[0] || {}).url || ''
    if (!topic && !imageUrl) { alert('請先輸入「要宣傳什麼」，或先選一張圖片（AI 會看圖寫）'); return }
    const dests = [...document.querySelectorAll('.sfDest:checked')].map(x => x.value)
    const platform = dests.some(d => d.startsWith('fb')) && !dests.some(d => d.startsWith('ig')) ? 'fb' : 'ig'
    const pages = ((DATA.account || {}).pages) || []
    let brand = ''
    if (dests[0]) { const pid = dests[0].split(':')[1]; const pg = pages.find(p => p.pageId === pid || p.igUserId === pid); if (pg) brand = pg.pageName }
    else if (pages[0]) brand = pages[0].pageName
    const items = ((document.getElementById('sfItems') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const btn = document.getElementById('sfGenBtn'); if (btn) { btn.disabled = true; btn.textContent = imageUrl ? '看圖生成中…（約 10 秒）' : '生成 5 版中…（約 10 秒）' }
    const out = document.getElementById('sfGenOut'); if (out) out.innerHTML = '<div class="hint" style="margin-top:10px">AI 思考中…</div>'
    let j
    try { j = await sPost({ op: 'gen', topic, style: genStyle, lang: genLang, length: genLen, platform, brand, relatedItems: items, imageUrl }) } catch (e) { j = { ok: false, error: '連線問題' } }
    if (btn) { btn.disabled = false; btn.textContent = '✨ 生成 5 版文案' }
    if (j.ok && (j.versions || j.caption)) { genVers = j.versions || [j.caption]; renderGenVersions() }
    else { if (out) out.innerHTML = ''; alert(j.error || '生成失敗') }
  }
  function renderGenVersions() {
    const out = document.getElementById('sfGenOut'); if (!out) return
    if (!genVers.length) { out.innerHTML = ''; return }
    out.innerHTML = `<div class="hint" style="margin:12px 0 6px">AI 給了 ${genVers.length} 個版本，點「用這版」填進下方文案框（還能再改、或再生成一批）：</div>`
      + genVers.map((v, i) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--soft)">
        <div style="font-size:11px;font-weight:800;color:var(--pdark);margin-bottom:4px">版本 ${i + 1}</div>
        <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;max-height:160px;overflow:auto">${esc(v)}</div>
        <div style="margin-top:6px;text-align:right"><button class="mini on" onclick="_socialPickVer(${i})">✓ 用這版</button></div>
      </div>`).join('')
  }
  window._socialPickVer = function (i) {
    const t = document.getElementById('sfCap'); if (t && genVers[i] != null) { t.value = genVers[i]; t.focus(); try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch (_) {} }
  }

  // ── v4.70.26 分品牌各生一版（素材共用、文案依品牌調性分化，再各建一則）──
  function destsByBrand() {
    const dests = [...document.querySelectorAll('.sfDest:checked')].map(x => x.value)
    const pages = ((DATA.account || {}).pages) || []
    const groups = [], idx = {}
    for (const d of dests) {
      const pid = d.split(':')[1]; const pg = pages.find(p => p.pageId === pid || p.igUserId === pid); if (!pg) continue
      if (idx[pg.pageId] == null) { idx[pg.pageId] = groups.length; groups.push({ brand: pg.pageName, dests: [] }) }
      groups[idx[pg.pageId]].dests.push(d)
    }
    return groups
  }
  window._socialGenMulti = async function () {
    const topic = ((document.getElementById('sfTopic') || {}).value || '').trim()
    const imageUrl = (editMedia[0] || {}).url || ''
    if (!topic && !imageUrl) { alert('請先輸入「要宣傳什麼」，或先選一張圖片（AI 會看圖寫）'); return }
    const groups = destsByBrand()
    if (groups.length < 2) { alert('請先在下方「發布到哪裡」勾選兩個品牌以上（例如 A Beach 跟 GROUN:D 都勾），才需要分品牌各寫一版'); return }
    const items = ((document.getElementById('sfItems') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const btn = document.getElementById('sfGenMultiBtn'); if (btn) { btn.disabled = true; btn.textContent = `各品牌生成中…（約 ${groups.length * 8} 秒）` }
    const out = document.getElementById('sfGenOut'); if (out) out.innerHTML = '<div class="hint" style="margin-top:10px">AI 正在為每個品牌各寫一版…</div>'
    let j
    try { j = await sPost({ op: 'gen', mode: 'multi', brands: groups.map(g => g.brand), topic, style: genStyle, lang: genLang, length: genLen, platform: 'ig', relatedItems: items, imageUrl }) } catch (e) { j = { ok: false, error: '連線問題' } }
    if (btn) { btn.disabled = false; btn.textContent = '🏷 分品牌各生一版' }
    if (j.ok && Array.isArray(j.perBrand)) { multiDraft = j.perBrand.map((p, i) => ({ brand: p.brand, caption: p.caption || '', dests: (groups[i] && groups[i].dests) || [] })); renderMultiBrands() }
    else { if (out) out.innerHTML = ''; alert(j.error || '生成失敗') }
  }
  function renderMultiBrands() {
    const out = document.getElementById('sfGenOut'); if (!out) return
    if (!multiDraft.length) { out.innerHTML = ''; return }
    const canPub = DATA.me && DATA.me.admin && DATA.metaReady
    out.innerHTML = `<div class="hint" style="margin:12px 0 6px">AI 依各品牌調性各寫了一版，可直接改。確認後選下面一個鈕一次處理：</div>`
      + multiDraft.map((m, i) => {
        const plats = m.dests.map(d => d.startsWith('ig') ? 'IG' : 'FB').join('＋')
        return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--soft)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><span style="display:inline-block;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid var(--line);font-size:12px;font-weight:700">${esc(m.brand)}</span><span class="hint" style="font-size:11px">發到 ${plats || '—'}</span></div>
          <textarea id="sfBrandCap_${i}" rows="4" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:13px">${esc(m.caption)}</textarea>
        </div>`
      }).join('')
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <button class="mini on" onclick="_socialMultiSubmit(false)">✓ 各品牌各存草稿</button>
          ${canPub ? `<button class="mini" style="background:#3DBE6C;color:#fff;border-color:transparent" onclick="_socialMultiSubmit(true)">🚀 各品牌直接發送</button>` : ''}
        </div>`
  }
  window._socialMultiSubmit = async function (publish) {
    const items = ((document.getElementById('sfItems') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const tags = ((document.getElementById('sfTags') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const list = multiDraft.map((m, i) => ({ brand: m.brand, dests: m.dests, caption: (((document.getElementById('sfBrandCap_' + i) || {}).value) || m.caption).trim() })).filter(x => x.caption && x.dests.length)
    if (!list.length) { alert('沒有可處理的品牌文案'); return }
    if (publish && list.some(m => m.dests.some(d => d.startsWith('ig'))) && !editMedia.length) { alert('IG 必須附圖，請先在上方選至少一張圖再發送'); return }
    if (publish && !confirm('確定直接發送？會把 ' + list.length + ' 個品牌各發一則出去（對外）。')) return
    let done = 0; const fail = []
    for (const m of list) {
      try {
        const sv = await sPost({ op: 'save', caption: m.caption, tags, relatedItems: items, dests: m.dests, media: editMedia, scheduledAt: null })
        if (!sv.ok) { fail.push(m.brand + '（存失敗）'); continue }
        if (publish) { const pj = await sPost({ op: 'publishnow', id: sv.id }); if (!pj.ok) { fail.push(m.brand + '（' + (pj.error || '發送失敗') + '）'); continue } }
        done++
      } catch (e) { fail.push(m.brand + '（連線問題）') }
    }
    multiDraft = []
    alert((publish ? '已發送 ' : '已建草稿 ') + done + ' 個品牌' + (fail.length ? '\n⚠️ 失敗：' + fail.join('、') : ''))
    socialLoad()
  }

  // ── AI 生圖（v4.70.29 張良「做圖就得用 Gemini」：走 AI 中樞 route=image，設定頁可改 Gemini／ChatGPT；生好自動入素材庫）──
  // forPost=1：從貼文編輯的素材庫 modal 進來 → 生好可直接「加入這則貼文」
  let genImgRefs = []
  window._socialGenImg = function (forPost) {
    const assets = (DATA.assets || []).slice(0, 12)
    genImgRefs = []
    const ov = document.createElement('div'); ov.className = 'genImgOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.66);z-index:74;display:flex;align-items:center;justify-content:center;padding:14px'; ov.onclick = () => ov.remove()
    const AR = [['1:1', '正方形'], ['4:3', '橫式'], ['3:4', '直式'], ['16:9', '寬螢幕'], ['9:16', '限動／直立']]
    ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:560px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="flex:0 0 auto;padding:16px 18px 8px"><h2 style="margin:0 0 4px">AI 生圖</h2><div class="hint">描述想要的畫面（餐點／場景／氛圍／文字），可勾下方既有素材當參考圖讓 AI 照著商品或風格改。生好的圖自動進素材庫。</div></div>
      <div style="flex:1 1 auto;overflow:auto;padding:0 18px 10px">
        <textarea id="giPrompt" rows="4" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;margin:4px 0 8px" placeholder="例：一盤拿坡里披薩放在木桌上，旁邊有一杯冰啤酒，海邊夕陽自然光，俯拍，質感要像美食雜誌"></textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${AR.map(([v, l], i) => `<button class="mini ${i === 0 ? 'on' : ''}" data-ar="${v}" onclick="this.parentNode.querySelectorAll('.mini').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${l} ${v}</button>`).join('')}</div>
        ${assets.length ? `<div class="hint" style="margin-bottom:4px">參考圖（可選，最多 3 張）：</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px;margin-bottom:8px">${assets.map(a => `<img src="${esc(a.url)}" data-ref="${esc(a.url)}" onclick="_socialGenRef(this)" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer">`).join('')}</div>` : ''}
        <div id="giOut"></div>
      </div>
      <div style="flex:0 0 auto;display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--line);background:var(--card)"><button class="mini" onclick="this.closest('.genImgOv').remove()">關閉</button><button class="mini on" id="giGo" onclick="_socialGenImgGo(${forPost ? 1 : 0})">生成</button></div>
    </div>`
    document.body.appendChild(ov)
  }
  window._socialGenRef = function (el) {
    const u = el.dataset.ref; const i = genImgRefs.indexOf(u)
    if (i >= 0) { genImgRefs.splice(i, 1); el.style.outline = 'none' }
    else { if (genImgRefs.length >= 3) return; genImgRefs.push(u); el.style.outline = '3px solid var(--green)'; el.style.outlineOffset = '-1px' }
  }
  window._socialGenImgGo = async function (forPost) {
    const ov = document.querySelector('.genImgOv'); if (!ov) return
    const prompt = (ov.querySelector('#giPrompt').value || '').trim(); if (!prompt) { alert('先描述想要的畫面'); return }
    const ar = (ov.querySelector('[data-ar].on') || {}).dataset ? ov.querySelector('[data-ar].on').dataset.ar : '1:1'
    const btn = ov.querySelector('#giGo'); const out = ov.querySelector('#giOut')
    btn.disabled = true; btn.textContent = '生成中（約 10–40 秒）…'; out.innerHTML = ''
    let j; try { j = await sPost({ op: 'genimg', prompt, aspect: ar, refUrls: genImgRefs }) } catch (e) { j = { ok: false, error: '連線問題' } }
    btn.disabled = false; btn.textContent = '再生一張'
    if (!j || !j.ok) { out.innerHTML = `<div class="hint" style="color:#F07373">${esc((j && j.error) || '生圖失敗')}</div>`; return }
    DATA.assets = DATA.assets || []; DATA.assets.unshift({ url: j.url, type: 'image', ai: 1 })
    out.innerHTML = `<div style="margin-top:6px"><img src="${esc(j.url)}" style="width:100%;border-radius:12px;border:1px solid var(--line)"><div class="hint" style="margin-top:4px">已存進素材庫・${esc(j.provider || '')} ${esc(j.model || '')}${j.note ? '<br>' + esc(j.note) : ''}</div>
      ${forPost ? `<div style="margin-top:8px;text-align:right"><button class="mini on" onclick="_socialAssetUse('${esc(j.url)}');document.querySelectorAll('.genImgOv,.assetOv').forEach(o=>o.remove())">加入這則貼文</button></div>` : ''}</div>`
    if (!forPost && subTab === 'assets') { try { socialBody() } catch (_) {} }
  }
  // ── 素材庫（可重複選用的圖片）──
  window._socialAssets = function () {
    const assets = DATA.assets || []
    const isAdmin = !!(DATA.me && DATA.me.admin)
    const chosen = u => !!editMedia.find(m => m.url === u)
    const grid = assets.length
      ? assets.map(a => `<div style="position:relative"><img src="${esc(a.url)}" onclick="_socialAssetUse('${esc(a.url)}',this)" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;cursor:pointer;border:1px solid var(--line);outline:${chosen(a.url) ? '3px solid var(--green)' : 'none'};outline-offset:-1px">${chosen(a.url) ? '<span class="sfChk" style="position:absolute;top:4px;left:4px;background:var(--green);color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">✓</span>' : ''}${isAdmin ? `<span onclick="event.stopPropagation();_socialAssetDel('${esc(a.url)}',this)" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:700">✕</span>` : ''}</div>`).join('')
      : '<div class="hint" style="padding:20px;grid-column:1/-1">素材庫還是空的。先按「上傳」放幾張圖進來，之後就能重複選用。</div>'
    const ov = document.createElement('div'); ov.className = 'assetOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:72;display:flex;align-items:center;justify-content:center;padding:16px'; ov.onclick = () => ov.remove()
    // v4.70.20 張良「隨時都要看到完成按鈕，不然要滑很遠」：改 flex column＝標題固定、圖片區捲動、底列(上傳新圖/完成)永遠貼底可見
    ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:560px;width:100%;max-height:86vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="flex:0 0 auto;padding:18px 18px 10px"><h2 style="margin:0 0 4px">📁 素材庫</h2><div class="hint">點圖片＝加入這則貼文（可連點多張），再拖曳排順序。你上傳過的圖會自動收進來。</div></div>
      <div style="flex:1 1 auto;overflow:auto;padding:0 18px 12px"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px">${grid}</div></div>
      <div style="flex:0 0 auto;display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--line);background:var(--card)"><button class="mini" onclick="_socialPickImg()">＋ 上傳新圖</button><button class="mini" onclick="_socialGenImg(1)">AI 生圖</button><button class="mini on" onclick="this.closest('.assetOv').remove()">完成</button></div>
    </div>`
    document.body.appendChild(ov)
  }
  window._socialAssetUse = function (url, el) {
    const i = editMedia.findIndex(m => m.url === url)
    if (i < 0) editMedia.push({ url, type: 'image' }); else editMedia.splice(i, 1) // 再點一次＝取消選取
    renderMedia()
    // 更新 modal 內這張的勾選樣式
    if (el) { const on = !!editMedia.find(m => m.url === url); el.style.outline = on ? '3px solid var(--green)' : 'none'; const chk = el.parentNode.querySelector('.sfChk'); if (on && !chk) { const s = document.createElement('span'); s.className = 'sfChk'; s.textContent = '✓'; s.style.cssText = 'position:absolute;top:4px;left:4px;background:var(--green);color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px'; el.parentNode.appendChild(s) } else if (!on && chk) chk.remove() }
  }
  window._socialAssetDel = async function (url, el) {
    if (!confirm('從素材庫刪掉這張圖？（已發佈的貼文不受影響）')) return
    const j = await sPost({ op: 'assetdel', url })
    if (j.ok) {
      DATA.assets = (DATA.assets || []).filter(a => a.url !== url)
      if (document.querySelector('.assetOv')) { const cell = el.closest('div'); if (cell) cell.remove() } // 素材庫 modal 內：只移掉該格
      else socialBody() // 獨立素材庫頁：重畫（空了會顯示提示）
    } else alert(j.error || '刪除失敗')
  }
  // 素材放大預覽（App 內燈箱，不另開分頁）＋下載
  window._socialAssetView = function (url) {
    const ov = document.createElement('div'); ov.className = 'assetLb'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:75;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:14px'
    ov.onclick = () => ov.remove()
    ov.innerHTML = `<img src="${esc(url)}" onclick="event.stopPropagation()" style="max-width:94vw;max-height:76vh;object-fit:contain;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.6)">
      <div onclick="event.stopPropagation()" style="display:flex;gap:10px">
        <button class="mini on" style="padding:9px 20px" onclick="_socialDownload('${esc(url)}',this)">⬇ 下載</button>
        <button class="mini" style="padding:9px 20px" onclick="this.closest('.assetLb').remove()">關閉</button>
      </div>`
    document.body.appendChild(ov)
  }
  window._socialDownload = async function (url, btn) {
    const name = (url.split('/').pop() || ('素材_' + Date.now() + '.jpg')).split('?')[0]
    if (btn) { btn.disabled = true; btn.textContent = '下載中…' }
    try {
      const r = await fetch(url); const b = await r.blob()
      const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000)
    } catch (_) { window.open(url, '_blank') } // 萬一跨域擋 blob，退而求其次開原圖
    if (btn) { btn.disabled = false; btn.textContent = '⬇ 下載' }
  }

  window._socialEdit = function (id) { editId = id || ''; const pp = (DATA.posts || []).find(x => x.id === editId); editMedia = (pp && pp.media) ? JSON.parse(JSON.stringify(pp.media)) : []; socialBody(); const e = document.getElementById('sfCap'); if (e) e.focus() }
  window._socialEditClose = function () { editId = null; socialBody() }
  window._socialSave = async function (id) {
    const cap = (document.getElementById('sfCap') || {}).value || ''
    if (!cap.trim()) { alert('請先輸入文案'); return }
    const tags = ((document.getElementById('sfTags') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const items = ((document.getElementById('sfItems') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const later = document.getElementById('sfSchLater')
    const isLater = later && later.classList.contains('on') // 指定時間；否則＝即刻（核准後馬上發）
    const whenV = isLater ? ((document.getElementById('sfWhen') || {}).value) : ''
    if (isLater && !whenV) { alert('選了「指定時間」請填發送時間，或改回「即刻發送」'); return }
    const dests = [...document.querySelectorAll('.sfDest:checked')].map(x => x.value)
    if (dests.some(d => d.startsWith('ig:')) && !(editMedia[0] && editMedia[0].url)) { alert('有勾 IG 的話一定要附圖'); return }
    const j = await sPost({ op: 'save', id: id || undefined, caption: cap, tags, relatedItems: items, scheduledAt: whenV ? new Date(whenV).toISOString() : null, dests, media: editMedia })
    if (j.ok) { editId = null; socialLoad() } else alert(j.error || '儲存失敗')
  }
  window._socialPublishNow = async function (id) {
    const cap = ((document.getElementById('sfCap') || {}).value || '').trim()
    if (!cap && !editMedia.length) { alert('請先填文案或選圖'); return }
    const dests = [...document.querySelectorAll('.sfDest:checked')].map(x => x.value)
    if (!dests.length) { alert('請先在下面「發布到哪裡」勾至少一個平台'); return }
    if (dests.some(d => d.startsWith('ig:')) && !(editMedia[0] && editMedia[0].url)) { alert('發 IG 一定要附圖'); return }
    const names = [...new Set(dests.map(d => d.startsWith('ig:') ? 'IG' : 'FB'))].join('、')
    if (!confirm('確定現在直接發送到 ' + names + '？\n發出去就收不回了。')) return
    const tags = ((document.getElementById('sfTags') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const items = ((document.getElementById('sfItems') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const sv = await sPost({ op: 'save', id: id || undefined, caption: cap, tags, relatedItems: items, dests, media: editMedia, scheduledAt: null })
    if (!sv.ok) { alert(sv.error || '儲存失敗'); return }
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:80;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#fff'
    ov.innerHTML = '<div style="font-size:17px;font-weight:800">🚀 發送中…</div><div style="color:#C7D0DB;font-size:13px">發 IG 需要約 10–30 秒，請稍候別關</div>'
    document.body.appendChild(ov)
    let j; try { j = await sPost({ op: 'publishnow', id: sv.id }) } catch (e) { j = { ok: false, error: '連線問題' } }
    ov.remove()
    if (j.ok) { alert('✅ 已發送成功！'); editId = null; socialLoad() }
    else { alert('發送沒成功：\n' + (j.error || '未知原因')); socialLoad() }
  }
  window._socialSubmit = async function (id) { if (!confirm('送出審核？張良會收到通知。')) return; const j = await sPost({ op: 'submit', id }); if (j.ok) { alert('已送審，張良會收到通知'); socialLoad() } else alert(j.error || '失敗') }
  window._socialDel = async function (id) { if (!confirm('刪除這則貼文？')) return; const j = await sPost({ op: 'del', id }); if (j.ok) socialLoad(); else alert(j.error || '失敗') }
  window._socialApprove = async function (id, op) { const j = await sPost({ op, id }); if (j.ok) socialLoad(); else alert(j.error || '失敗') }
  window._socialApprovePublish = async function (id) {
    if (!confirm('核准並「立即發送」到這則勾選的平台？\n發出去就收不回了。')) return
    const a = await sPost({ op: 'approve', id }); if (!a.ok) { alert(a.error || '核准失敗'); return }
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:80;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#fff'
    ov.innerHTML = '<div style="font-size:17px;font-weight:800">🚀 發送中…</div><div style="color:#C7D0DB;font-size:13px">發 IG 需要約 10–30 秒，請稍候別關</div>'
    document.body.appendChild(ov)
    let j; try { j = await sPost({ op: 'publishnow', id }) } catch (e) { j = { ok: false, error: '連線問題' } }
    ov.remove()
    if (j.ok) { alert('✅ 已核准並發送成功！'); socialLoad() } else { alert('已核准，但發送沒成功：\n' + (j.error || '')); socialLoad() }
  }

  // ── 儀表板（像 inline：KPI 已在上方，這裡＝行動建議＋圖表卡牆）──
  const COL = { b: '#4DA3FF', g: '#3DBE6C', o: '#E8A657', y: '#E8C14E', p: '#B48CF2', r: '#F07373' }
  const WD = ['一', '二', '三', '四', '五', '六', '日']
  const BK = [['早', 6, 11], ['午', 11, 14], ['下午', 14, 18], ['晚', 18, 24]]
  const pubTime = p => new Date((p.pub && ((p.pub.instagram || {}).publishedAt || (p.pub.facebook || {}).publishedAt)) || p.createdAt)
  function card(icon, title, desc, inner) {
    return `<section><h2 style="margin:0 0 4px">${icon} ${title}</h2><div class="hint" style="margin-bottom:12px;line-height:1.6">${desc}</div>${inner}</section>`
  }
  function bars(items, color, cat) {
    if (!items.length) return '<div class="hint">資料不足</div>'
    const mx = Math.max(1, ...items.map(i => i.v))
    return items.map(i => `<div ${cat && i.key != null ? `onclick="_socialDrillKey('${cat}','${i.key}')" ` : ''}title="${esc(i.l)}：${nf(i.v)}${cat ? '（點看明細）' : ''}" style="display:flex;align-items:center;gap:10px;margin:7px 0;${cat ? 'cursor:pointer' : ''}"><span style="width:76px;flex:0 0 auto;font-size:13px;color:var(--text);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.l)}</span><div style="flex:1;background:#1C222B;border-radius:6px;height:16px"><div style="height:100%;width:${Math.round(i.v / mx * 100)}%;min-width:3px;background:${i.c || color};border-radius:6px"></div></div><span style="width:62px;flex:0 0 auto;text-align:right;font-weight:800;font-variant-numeric:tabular-nums">${i.t != null ? i.t : nf(i.v)}</span></div>`).join('')
  }
  function dashView() {
    const s = stats()
    if (!s.posts.length) return '<section><div class="hint" style="padding:20px">這個板塊還沒有成效數據。連接粉專後、系統每天凌晨自動抓，隔天起這裡就有完整分析。</div></section>'
    soDrill = {}
    const avgOf = arr => arr.length ? Math.round(arr.reduce((x, p) => x + INTER(p.metrics), 0) / arr.length) : 0
    const sumF = (arr, f) => arr.reduce((x, p) => x + (p.metrics[f] || 0), 0)
    const mkD = (cat, key, title, desc, posts) => { (soDrill[cat] = soDrill[cat] || {})[key] = { title, desc, posts } }
    // 熱力圖（存貼文陣列以便下鑽）
    const grid = {}
    for (const p of s.posts) { const dt = pubTime(p); const wd = (dt.getDay() + 6) % 7, hr = dt.getHours(); let bi = BK.findIndex(b => hr >= b[1] && hr < b[2]); if (bi < 0) bi = 0; (grid[wd + '_' + bi] = grid[wd + '_' + bi] || []).push(p) }
    const cellAvg = (w, b) => avgOf(grid[w + '_' + b] || [])
    let maxCell = 0, best = { v: -1 }
    for (let w = 0; w < 7; w++) for (let b = 0; b < 4; b++) { const v = cellAvg(w, b); maxCell = Math.max(maxCell, v); if (v > best.v && grid[w + '_' + b]) best = { v, w, b } }
    // 月趨勢
    const byM = {}
    for (const p of s.posts) { const ym = pubTime(p).toISOString().slice(0, 7); (byM[ym] = byM[ym] || []).push(p) }
    const months = Object.keys(byM).sort().slice(-12), trend = months.map(m => avgOf(byM[m]))
    // 貼文類型（IG）
    const tName = { IMAGE: '圖片', VIDEO: '影片', CAROUSEL_ALBUM: '輪播', REELS: 'Reels' }
    const byT = {}
    for (const p of s.ig) { const t = tName[p.mediaType] || '其他'; (byT[t] = byT[t] || []).push(p) }
    const tArr = Object.entries(byT).map(([l, arr]) => ({ l, key: l, v: avgOf(arr) })).sort((a, b) => b.v - a.v)
    // 互動組成
    const compF = { 讚: 'reactions', 留言: 'comments', 分享: 'shares', 收藏: 'saves' }
    const compItems = Object.entries(compF).map(([l, f]) => ({ l, key: l, v: sumF(s.posts, f) }))
    // FB vs IG（品牌色）
    const platItems = [{ l: 'IG', key: 'ig', v: s.igAvg, c: '#E1427E' }, { l: 'FB', key: 'fb', v: s.fbAvg, c: '#4D8BF0' }].filter(x => (x.key === 'ig' ? s.ig.length : s.fb.length))
    // 爆款
    const top = [...s.posts].sort((a, b) => INTER(b.metrics) - INTER(a.metrics)).slice(0, 5)
    // 建下鑽資料
    for (const m of months) mkD('trend', m, `${m} 互動明細`, `這個月 ${byM[m].length} 篇、總互動 ${nf(byM[m].reduce((x, p) => x + INTER(p.metrics), 0))} → 平均 ${avgOf(byM[m])}`, byM[m])
    for (let w = 0; w < 7; w++) for (let b = 0; b < 4; b++) { const arr = grid[w + '_' + b]; if (arr) mkD('heat', w + '_' + b, `週${WD[w]}・${BK[b][0]} 發的貼文`, `${arr.length} 篇、平均互動 ${avgOf(arr)}`, arr) }
    for (const [l, arr] of Object.entries(byT)) mkD('type', l, `${l} 類貼文`, `${arr.length} 篇、平均互動 ${avgOf(arr)}`, arr)
    mkD('plat', 'ig', 'IG 貼文', `${s.ig.length} 篇、平均互動 ${s.igAvg}`, s.ig)
    mkD('plat', 'fb', 'FB 貼文', `${s.fb.length} 篇、平均互動 ${s.fbAvg}`, s.fb)
    for (const [l, f] of Object.entries(compF)) mkD('comp', l, `${l}最多的貼文`, `全部 ${l} 加總 ${nf(sumF(s.posts, f))}，以下依${l}排序`, [...s.posts].filter(p => p.metrics[f]).sort((a, b) => (b.metrics[f] || 0) - (a.metrics[f] || 0)))
    // 趨勢 SVG（每點數字＋可點＋滑過顯示）
    let trendHtml
    if (trend.length < 2) trendHtml = '<div class="hint">多發幾篇就有趨勢線</div>'
    else {
      const W = 320, H = 100, PAD = 16, mx = Math.max(...trend), mn = Math.min(...trend), rg = (mx - mn) || 1
      const X = i => PAD + i / (trend.length - 1) * (W - PAD * 2), Y = v => H - PAD - (v - mn) / rg * (H - PAD * 2 - 8)
      const pts = trend.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
      const dots = trend.map((v, i) => `<text x="${X(i).toFixed(1)}" y="${(Y(v) - 9).toFixed(1)}" text-anchor="middle" font-size="10" fill="#C7D0DB" font-weight="700">${v}</text><circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5" fill="${COL.b}" stroke="#0E1217" stroke-width="1.5" style="cursor:pointer" onclick="_socialDrillKey('trend','${months[i]}')"><title>${months[i]}：平均 ${v}（${byM[months[i]].length} 篇，點看明細）</title></circle>`).join('')
      trendHtml = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:118px"><polygon points="${PAD},${H - PAD} ${pts} ${W - PAD},${H - PAD}" fill="rgba(77,163,255,.14)"/><polyline points="${pts}" fill="none" stroke="${COL.b}" stroke-width="2"/>${dots}</svg><div class="hint" style="display:flex;justify-content:space-between"><span>${months[0]}</span><span>${months[months.length - 1]}</span></div>`
    }
    // 熱力圖（可點＋滑過顯示）
    let heatHtml = '<div class="scroll"><table class="tight" style="min-width:340px"><thead><tr><th></th>' + BK.map(b => `<th style="text-align:center">${b[0]}</th>`).join('') + '</tr></thead><tbody>'
    for (let w = 0; w < 7; w++) { heatHtml += `<tr><td style="font-weight:800;text-align:left">${WD[w]}</td>`; for (let b = 0; b < 4; b++) { const arr = grid[w + '_' + b], v = cellAvg(w, b), op = maxCell ? v / maxCell : 0; heatHtml += `<td ${arr ? `onclick="_socialDrillKey('heat','${w}_${b}')" title="週${WD[w]}・${BK[b][0]}：平均 ${v}（${arr.length} 篇，點看明細）"` : ''} style="text-align:center;background:rgba(61,190,108,${(0.08 + op * 0.82).toFixed(2)});color:${op > 0.55 ? '#0E1217' : 'var(--ink)'};font-weight:700;${arr ? 'cursor:pointer' : ''}">${v || '·'}</td>` } heatHtml += '</tr>' }
    heatHtml += '</tbody></table></div>'
    // 行動建議
    const rec = []
    if (s.ig.length && s.fb.length) { const ratio = s.fbAvg ? Math.round(s.igAvg / s.fbAvg * 10) / 10 : 0; rec.push(`📱 IG 每篇平均互動 <b>${nf(s.igAvg)}</b>，是 FB（${nf(s.fbAvg)}）的 <b>${ratio || '多'} 倍</b> → 行銷重心放 IG。`) }
    if (best.v > 0) rec.push(`⏰ <b>週${WD[best.w]}・${BK[best.b][0]}</b> 發文互動最高（平均 ${nf(best.v)}）→ 多把貼文排在這時段。`)
    if (tArr.length && tArr[0].v) rec.push(`🎬 <b>${tArr[0].l}</b> 類貼文平均互動最高（${nf(tArr[0].v)}）→ 多做這種形式。`)
    const bShare = [...s.posts].sort((a, b) => (b.metrics.shares || 0) - (a.metrics.shares || 0))[0]
    if (bShare && bShare.metrics.shares) rec.push(`🔁 分享最高：「${esc((bShare.caption || '').slice(0, 14))}」（${bShare.metrics.shares} 次）→ 擴散力強，可做系列。`)
    const bSave = [...s.posts].sort((a, b) => (b.metrics.saves || 0) - (a.metrics.saves || 0))[0]
    if (bSave && bSave.metrics.saves) rec.push(`💾 最多收藏：「${esc((bSave.caption || '').slice(0, 14))}」（${bSave.metrics.saves} 次）→ 實用/乾貨型內容。`)
    const recent = s.posts.filter(p => (Date.now() - pubTime(p).getTime()) < 30 * 864e5).length
    rec.push(recent < 4 ? `📅 近 30 天只發 <b>${recent}</b> 篇 → 聲量偏低，建議每週至少 2–3 篇。` : `📅 近 30 天發了 ${recent} 篇，節奏不錯，保持。`)
    // 組裝
    let h = card('💡', '行動建議', '根據你的實際數據自動算的，照著做最快見效。', '<div style="display:flex;flex-direction:column;gap:9px">' + rec.map(x => `<div style="background:#1A2940;border-left:3px solid ${COL.b};border-radius:0 8px 8px 0;padding:9px 12px;line-height:1.65">${x}</div>`).join('') + '</div>')
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:14px">`
      + card('📈', '互動趨勢', '每月平均互動走勢。<b>滑過圓點看每月數字、點進去看是哪幾篇</b>。上升＝越對味；下滑＝該換題材。', trendHtml)
      + card('🔥', '最佳發文時段', '星期×時段的平均互動，越綠越強。<b>點任一格看那時段的貼文</b>。', heatHtml)
      + card('📣', 'FB vs IG', '兩平台哪個有效一眼看出（<span style="color:#4D8BF0">■</span>FB <span style="color:#E1427E">■</span>IG），重心放互動高的。<b>點看明細</b>。', bars(platItems, COL.g, 'plat'))
      + card('🎬', '貼文類型成效', '哪種形式互動最高，多做那種。<b>點看明細</b>。', bars(tArr, COL.p, 'type'))
      + card('🧩', '互動組成', '互動主要來自哪裡。<b>點看哪些貼文貢獻最多</b>。', bars(compItems, COL.o, 'comp'))
      + card('🏆', '爆款貼文 Top 5', '表現最好的內容，點開看細節、複製成功模式。', top.map(p => { const pl = PLAT(p.platform); return `<div onclick="_socialDetail('${p.id}')" style="display:flex;gap:9px;align-items:center;padding:7px 0;border-top:1px solid #222A35;cursor:pointer"><b style="color:var(--pdark);width:48px;flex:0 0 auto;font-variant-numeric:tabular-nums">${nf(INTER(p.metrics))}</b><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${esc((p.caption || '（無文字）').slice(0, 30))}</span><span style="font-size:11px;flex:0 0 auto;font-weight:800;color:${pl.c}">${pl.n}</span></div>` }).join(''))
      + `</div>`
    return h
  }
  // 成長曲線（分平台 series：[{t,v,reach,saves,views}]）→ 互動隨時間 SVG：X 軸日期時間、Y 軸互動刻度、格線、資料點、滑鼠／手指移到任一點顯示浮標（張良 2026-10-10）；不足 2 點給累積提示
  function soSeriesSvg(ser) {
    if (!ser || ser.length < 2) return `<div class="hint" style="padding:12px;background:#1C222B;border-radius:10px;line-height:1.6">每 3 小時自動記一次，累積幾天後這裡會長出成長曲線（看互動何時爆、多久飽和）。目前 ${(ser || []).length} 個資料點。</div>`
    const vals = ser.map(x => x.v), W = 380, H = 150, PL = 34, PR = 12, PT = 12, PB = 26
    const mn0 = Math.min(...vals), mx0 = Math.max(...vals)
    // Y 刻度：整數、好看的步距（1/2/5×10^n），至少 3 格
    const span = Math.max(mx0 - mn0, 2), raw = span / 3, pow = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map(m => m * pow).find(v => v >= raw) || pow * 10
    const mn = Math.floor(mn0 / step) * step, mx = Math.ceil(mx0 / step) * step || step, rg = (mx - mn) || 1
    const X = i => PL + i / (ser.length - 1) * (W - PL - PR), Y = v => PT + (1 - (v - mn) / rg) * (H - PT - PB)
    const pts = ser.map((x, i) => `${X(i).toFixed(1)},${Y(x.v).toFixed(1)}`).join(' ')
    const fmt = t => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(String(t)); return m ? `${+m[2]}/${+m[3]} ${m[4]}:00` : String(t) }
    const fmtS = t => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(String(t)); return m ? `${+m[2]}/${+m[3]}` : String(t) }
    const yT = []; for (let v = mn; v <= mx + 1e-9; v += step) yT.push(v)
    const yAxis = yT.map(v => `<line x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#2A3340" stroke-width="1"/><text x="${PL - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#8A94A6">${nf(v)}</text>`).join('')
    // X 刻度：最多 5 個，頭尾一定有；同一天只在第一個點標日期、其餘標時間
    const n = ser.length, want = Math.min(5, n), idx = [...new Set(Array.from({ length: want }, (_, k) => Math.round(k * (n - 1) / (want - 1))))]
    const xAxis = idx.map((i, k) => { const t = ser[i].t, prev = k ? ser[idx[k - 1]].t : '', sameDay = prev && String(prev).slice(0, 10) === String(t).slice(0, 10); const m = /T(\d{2})/.exec(String(t)); const lab = sameDay && m ? `${m[1]}:00` : fmtS(t); const anc = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'; return `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${H - PB}" y2="${H - PB + 4}" stroke="#3A4452"/><text x="${X(i).toFixed(1)}" y="${H - PB + 15}" text-anchor="${anc}" font-size="10" fill="#8A94A6">${lab}</text>` }).join('')
    const dots = ser.map((x, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.v).toFixed(1)}" r="2.6" fill="#0F141B" stroke="${COL.b}" stroke-width="1.6"/>`).join('')
    const data = esc(JSON.stringify(ser.map((x, i) => ({ x: +X(i).toFixed(1), y: +Y(x.v).toFixed(1), t: fmt(x.t), v: x.v, reach: x.reach || 0, saves: x.saves || 0, views: x.views || 0 }))))
    return `<div style="position:relative" class="soSer"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:160px;display:block;touch-action:pan-y" data-ser="${data}" data-pl="${PL}" data-pr="${PR}" data-w="${W}" onmousemove="_soSerHover(event,this)" onmouseleave="_soSerLeave(this)" ontouchstart="_soSerHover(event,this)" ontouchmove="_soSerHover(event,this)" ontouchend="_soSerLeave(this)">
      <line x1="${PL}" x2="${PL}" y1="${PT}" y2="${H - PB}" stroke="#3A4452"/><line x1="${PL}" x2="${W - PR}" y1="${H - PB}" y2="${H - PB}" stroke="#3A4452"/>${yAxis}${xAxis}
      <polygon points="${PL},${H - PB} ${pts} ${X(n - 1).toFixed(1)},${H - PB}" fill="rgba(77,163,255,.14)"/><polyline points="${pts}" fill="none" stroke="${COL.b}" stroke-width="2" stroke-linejoin="round"/>${dots}
      <g class="soCur" style="display:none;pointer-events:none"><line x1="0" x2="0" y1="${PT}" y2="${H - PB}" stroke="#9CC7F5" stroke-dasharray="3 3"/><circle r="4.5" fill="${COL.b}" stroke="#fff" stroke-width="1.5"/></g>
    </svg><div class="soTip" style="display:none;position:absolute;top:6px;pointer-events:none;background:#0F141B;border:1px solid #3A4452;border-radius:8px;padding:6px 9px;font-size:12px;line-height:1.5;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.4);z-index:2"></div>
    <div class="hint" style="display:flex;justify-content:space-between;margin-top:4px"><span>${fmt(ser[0].t)} 起・${n} 個點</span><span>最新互動 ${nf(vals[vals.length - 1])}</span></div></div>`
  }
  // 曲線浮標：找離滑鼠／手指最近的資料點，移動指標線＋圓點，浮窗顯示時間／互動／觸及／收藏／瀏覽
  window._soSerHover = function (ev, svg) {
    const ser = JSON.parse(svg.dataset.ser || '[]'); if (!ser.length) return
    const r = svg.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left, vx = cx / r.width * (+svg.dataset.w)
    let best = 0; ser.forEach((p, i) => { if (Math.abs(p.x - vx) < Math.abs(ser[best].x - vx)) best = i })
    const p = ser[best], g = svg.querySelector('.soCur'), ln = g.querySelector('line'), c = g.querySelector('circle')
    g.style.display = ''; ln.setAttribute('x1', p.x); ln.setAttribute('x2', p.x); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y)
    const tip = svg.parentNode.querySelector('.soTip'); if (!tip) return
    const extra = [p.reach ? `觸及 ${nf(p.reach)}` : '', p.saves ? `收藏 ${nf(p.saves)}` : '', p.views ? `瀏覽 ${nf(p.views)}` : ''].filter(Boolean).join('・')
    tip.innerHTML = `<div class="hint" style="font-size:11px">${p.t}</div><div><b style="color:#9CC7F5">互動 ${nf(p.v)}</b></div>${extra ? `<div class="hint" style="font-size:11px">${extra}</div>` : ''}`
    tip.style.display = 'block'
    const px = p.x / (+svg.dataset.w) * r.width, half = r.width / 2
    if (px > half) { tip.style.left = ''; tip.style.right = (r.width - px + 10) + 'px' } else { tip.style.right = ''; tip.style.left = (px + 10) + 'px' }
  }
  window._soSerLeave = function (svg) { const g = svg.querySelector('.soCur'); if (g) g.style.display = 'none'; const tip = svg.parentNode.querySelector('.soTip'); if (tip) tip.style.display = 'none' }
  window._soDetTab = function (btn, k) { const box = btn.closest('.soDet'); [...box.querySelectorAll('.soTab')].forEach(b => b.classList.remove('on')); btn.classList.add('on'); [...box.querySelectorAll('.soPane')].forEach(pane => { pane.style.display = pane.dataset.k === k ? 'block' : 'none' }) }
  window._socialDetail = function (id) {
    const p = (DATA.posts || []).find(x => x.id === id); if (!p) return
    const img = p.media && p.media[0] && p.media[0].url
    const plats = []
    if (p.metricsFb || (p.pub && p.pub.facebook)) plats.push('fb')
    if (p.metricsIg || (p.pub && p.pub.instagram)) plats.push('ig')
    if (!plats.length) plats.push(p.platform === 'instagram' ? 'ig' : 'fb')
    const met = (l, v, c) => `<div style="text-align:center"><div style="font-size:21px;font-weight:800;color:${c || 'var(--ink)'};font-variant-numeric:tabular-nums">${nf(v || 0)}</div><div class="hint" style="font-size:12px">${l}</div></div>`
    const platPane = (k, show) => {
      const m = (k === 'fb' ? p.metricsFb : p.metricsIg) || {}
      const pub = p.pub && (k === 'fb' ? p.pub.facebook : p.pub.instagram)
      const deleted = pub && pub.deletedAt
      const link = pub && pub.permalink
      const ser = (p.series && p.series[k]) || []
      const cells = k === 'fb'
        ? [met('互動', INTER(m), '#9CC7F5'), met('讚', m.reactions, COL.g), met('留言', m.comments), met('分享', m.shares), met('觸及', m.reach, COL.o), met('曝光', m.views, COL.p), met('點擊', m.clicks, COL.b)]
        : [met('互動', INTER(m), '#9CC7F5'), met('讚', m.reactions, COL.g), met('留言', m.comments), met('分享', m.shares), met('收藏', m.saves, COL.y), met('觸及', m.reach, COL.o), met('瀏覽', m.views, COL.p)]
      const hasData = !!(k === 'fb' ? p.metricsFb : p.metricsIg)
      return `<div class="soPane" data-k="${k}" style="display:${show ? 'block' : 'none'}">
        ${deleted ? '<div style="background:#2A1A1A;border:1px solid #5A3030;color:#F0A0A0;border-radius:10px;padding:9px 12px;margin:10px 0;font-size:13px">⚠️ 這則已從粉專刪除，數據停在刪除前。</div>' : ''}
        ${k === 'fb' ? '<div class="hint" style="margin:8px 0 2px;font-size:11px">FB 觸及/曝光已被 Meta 2024 大幅限縮，常為 0＝正常。</div>' : ''}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:10px 0;background:#1C222B;border-radius:12px;padding:14px">${cells.join('')}</div>
        <div class="hint" style="margin:12px 0 5px;font-weight:700;color:var(--text)">📈 發出後的成長曲線（${k === 'ig' ? 'IG' : 'FB'} 互動）</div>
        ${soSeriesSvg(ser)}
        <div style="margin-top:12px">${link ? `<a class="mini" style="text-decoration:none" href="${esc(link)}" target="_blank">看 ${k === 'ig' ? 'IG' : 'FB'} 原貼文 ↗</a>` : '<span class="hint">（這個平台沒有連結）</span>'}${hasData ? '' : '<span class="hint" style="margin-left:8px">尚無數據（下次抓取後出現）</span>'}</div>
      </div>`
    }
    const tabs = plats.length > 1
      ? `<div style="display:flex;gap:6px;margin:14px 0 2px">${plats.map((k, i) => `<button class="mini soTab ${i === 0 ? 'on' : ''}" style="min-width:56px" onclick="_soDetTab(this,'${k}')">${k === 'ig' ? 'IG' : 'FB'}</button>`).join('')}</div>`
      : ''
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:70;display:flex;align-items:center;justify-content:center;padding:16px'; ov.onclick = () => ov.remove()
    ov.innerHTML = `<div class="soDet" onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:460px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="flex:0 0 auto;padding:18px 18px 0">
        <div style="display:flex;gap:10px"><div style="flex:1;min-width:0"><span>${plats.map(k => `<span style="background:${k === 'ig' ? '#E1427E' : '#4D8BF0'}22;color:${k === 'ig' ? '#E1427E' : '#4D8BF0'};padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;margin-right:4px">${k === 'ig' ? 'IG' : 'FB'}</span>`).join('')}${p.brand ? `<span class="hint" style="font-size:11px">${esc(p.brand)}</span>` : ''}</span><div style="margin-top:7px;line-height:1.6;color:var(--text);max-height:120px;overflow:auto">${esc(p.caption || '（無文字）')}</div></div>${img ? `<img src="${esc(img)}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;flex:0 0 auto">` : ''}</div>
        ${tabs}
      </div>
      <div style="flex:1 1 auto;overflow:auto;padding:0 18px 4px">${plats.map((k, i) => platPane(k, i === 0)).join('')}</div>
      <div style="flex:0 0 auto;padding:12px 18px;border-top:1px solid var(--line);text-align:right"><button class="mini on" onclick="this.closest('.soDet').parentNode.remove()">關閉</button></div>
    </div>`
    document.body.appendChild(ov)
  }
  // 圖表下鑽：點任何圖的元素 → 看「這個數字是哪幾篇貼文來的」
  window._socialDrillKey = function (cat, key) { const g = (soDrill[cat] || {})[key]; if (g) drillModal(g.title, g.desc, g.posts) }
  function drillModal(title, desc, posts) {
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:69;display:flex;align-items:center;justify-content:center;padding:16px'; ov.onclick = () => ov.remove()
    const rows = (posts || []).map(p => { const pl = PLAT(p.platform); return `<div onclick="_socialDetail('${p.id}')" style="display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid #222A35;cursor:pointer"><b style="color:var(--pdark);width:44px;flex:0 0 auto;font-variant-numeric:tabular-nums">${nf(INTER(p.metrics))}</b><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${esc((p.caption || '（無文字）').slice(0, 34))}</span><span style="font-size:11px;font-weight:800;color:${pl.c};flex:0 0 auto">${pl.n}</span></div>` }).join('')
    ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:460px;width:100%;max-height:82vh;overflow:auto;padding:18px"><h2 style="margin:0 0 4px">${esc(title)}</h2><div class="hint" style="margin-bottom:8px;line-height:1.6">${esc(desc)}</div><div class="hint" style="font-size:11px;margin-bottom:2px">數字＝該篇互動（讚+留言+分享）・點任一篇看完整數據</div>${rows || '<div class="hint" style="padding:12px">沒有貼文</div>'}<div style="text-align:right;margin-top:10px"><button class="mini on" onclick="this.closest('div[style*=fixed]').remove()">關閉</button></div></div>`
    document.body.appendChild(ov)
  }

  // 深層連結：DD 通知點進來 /prep#social → 自動開這頁
  try { if ((location.hash || '').replace(/^#/, '').toLowerCase().startsWith('social')) setTimeout(() => { try { socialLoad() } catch (_) {} }, 300) } catch (_) {}
})()
