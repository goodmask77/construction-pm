// ⚠️ /prep 第 14 塊（張良 2026-10-08）：社群自動發文＋成效（Phase 1 先 FB、先只讀數據）
// 讀 /api/social、寫 POST /api/social；連接走 /api/social-oauth?start=token；真正發文＝下一期
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => Math.round(n || 0).toLocaleString()
  const ST = { draft: ['草稿', '#8C98A8'], pending_review: ['待審核', '#E8A657'], approved: ['已核准待發', '#4DA3FF'], publishing: ['發布中', '#4DA3FF'], published: ['已發布', '#3DBE6C'], failed: ['失敗', '#F07373'], rejected: ['已退回', '#F07373'] }
  let DATA = null, subTab = 'dash', editId = null, editMedia = [], soDrill = {}, platFilter = 'all'
  const INTER = m => (m ? (m.reactions || 0) + (m.comments || 0) + (m.shares || 0) : 0)
  const PLAT = p => (p === 'instagram' || p === 'ig') ? { k: 'ig', n: 'IG', c: '#E1427E' } : { k: 'fb', n: 'FB', c: '#4D8BF0' } // 品牌色：FB藍／IG粉
  const inFilter = p => platFilter === 'all' || (platFilter === 'ig' ? p.platform === 'instagram' : p.platform !== 'instagram')
  // 聚合統計（儀表板共用；吃 platFilter）
  function stats() {
    const posts = (DATA.posts || []).filter(p => p.status === 'published' && p.metrics && inFilter(p))
    const fb = posts.filter(p => p.platform !== 'instagram'), ig = posts.filter(p => p.platform === 'instagram')
    const totInter = posts.reduce((s, p) => s + INTER(p.metrics), 0)
    const totReach = posts.reduce((s, p) => s + (p.metrics.reach || 0), 0)
    const totSaves = posts.reduce((s, p) => s + (p.metrics.saves || 0), 0)
    const pages = ((DATA.account || {}).pages) || []
    const followers = pages.reduce((s, p) => s + (platFilter !== 'ig' ? (p.followers || 0) : 0) + (platFilter !== 'fb' ? (p.igFollowers || 0) : 0), 0)
    const avg = arr => arr.length ? Math.round(arr.reduce((s, p) => s + INTER(p.metrics), 0) / arr.length) : 0
    return { posts, fb, ig, totInter, totReach, totSaves, followers, avgInter: posts.length ? Math.round(totInter / posts.length) : 0, igAvg: avg(ig), fbAvg: avg(fb) }
  }

  async function sPost(body) {
    const r = await fetch('/api/social?social=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
    return r.json()
  }

  window.socialLoad = async function () {
    curStore = 'social'; try { setTabs('social') } catch (_) {}
    document.getElementById('upd').textContent = '社群內容中心'
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
    let h = '<h1>📣 社群</h1><div class="sub">粉專內容與成效・Facebook ＋ Instagram</div>'
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
    if (pages.length) {
      const rows = pages.map(p => {
        const bad = p.tokenStatus === 'invalid'
        return `<div style="display:flex;align-items:center;gap:8px"><b style="color:${bad ? '#F07373' : '#3DBE6C'}">${bad ? '⚠' : '●'}</b> <b>${esc(p.pageName || '')}</b>${bad ? '<span class="hint">（授權失效，請重新連接）</span>' : ''}${p.igUserId ? '<span class="hint" style="font-size:11px">IG已連結</span>' : ''}${isAdmin ? `<span onclick="_socialDelPage('${p.pageId}','${esc(p.pageName || '').replace(/'/g, '')}')" style="cursor:pointer;color:var(--muted);font-weight:700;margin-left:4px" title="從這裡移除（不影響粉專本身）">✕</span>` : ''}</div>`
      }).join('')
      return `<section>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:6px">${rows}</div>
          <div style="display:flex;gap:6px">${isAdmin ? `<button class="mini" onclick="_socialConnect()">＋ 連接其他粉專</button><button class="mini" onclick="_socialDisconnect()">全部斷開</button>` : ''}</div>
        </div>
        ${isAdmin ? '<div class="hint" style="margin-top:8px">要加別人管理的粉專（如同事管的 GROUN:D）：請那位同事用「他的 FB」按「＋ 連接其他粉專」登入即可，不會蓋掉現有的。</div>' : ''}
        ${isAdmin ? addByIdRow() : ''}
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
    el.innerHTML = libView()
  }

  // 內容庫
  function libView() {
    const d = DATA, posts = (d.posts || []).filter(inFilter)
    let h = ''
    if (d.canEdit) h += `<div style="margin:10px 0"><button class="mini on" style="padding:8px 16px" onclick="_socialEdit('')">＋ 新增貼文</button></div>`
    if (editId !== null) h += editorHtml(posts.find(p => p.id === editId) || null)
    if (!posts.length) return h + '<section><div class="hint" style="padding:18px">還沒有貼文。連接粉專後，系統今晚起會自動把你粉專近 30 天的貼文抓進來。</div></section>'
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px">' + posts.map(p => postCard(p)).join('') + '</div>'
    return h
  }

  function postCard(p) {
    const d = DATA, st = ST[p.status] || ['', '#8C98A8'], m = p.metrics
    const img = (p.media && p.media[0] && p.media[0].url) || ''
    const inter = m ? INTER(m) : null
    let acts = ''
    if (d.canEdit) {
      if (p.status === 'draft' || p.status === 'rejected') acts = `<button class="mini" onclick="event.stopPropagation();_socialEdit('${p.id}')">編輯</button><button class="mini" onclick="event.stopPropagation();_socialSubmit('${p.id}')">送審</button><button class="mini" onclick="event.stopPropagation();_socialDel('${p.id}')">刪</button>`
      else if (p.status === 'pending_review' && d.me && d.me.admin) acts = `<button class="mini on" onclick="event.stopPropagation();_socialApprove('${p.id}','approve')">核准</button><button class="mini" onclick="event.stopPropagation();_socialApprove('${p.id}','reject')">退</button>`
    }
    return `<div onclick="_socialDetail('${p.id}')" style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;gap:10px;align-items:center;cursor:pointer">
      ${img ? `<img src="${esc(img)}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;flex:0 0 auto">` : '<div style="width:50px;height:50px;border-radius:8px;background:#1C222B;flex:0 0 auto"></div>'}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px"><span style="color:${st[1]};font-size:11px">●</span><span style="font-size:11px;font-weight:800;color:${PLAT(p.platform).c}">${PLAT(p.platform).n}</span>${(p.tags || []).length ? `<span class="hint" style="font-size:11px">·${esc(p.tags[0])}</span>` : ''}${inter != null ? `<span style="margin-left:auto;font-weight:800;color:var(--pdark);font-size:13px;flex:0 0 auto">互動 ${nf(inter)}</span>` : `<span class="hint" style="margin-left:auto;font-size:11px;flex:0 0 auto">${st[0]}</span>`}</div>
        <div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px">${esc((p.caption || '（無文字）').slice(0, 60))}</div>
        ${acts ? `<div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap" onclick="event.stopPropagation()">${acts}</div>` : ''}
      </div>
    </div>`
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
    const img = editMedia[0] && editMedia[0].url
    return `<section style="border:1px solid var(--primary)">
      <h2>${p ? '編輯貼文' : '新增貼文'}</h2>
      <label class="hint">文案</label>
      <textarea id="sfCap" rows="4" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;margin:4px 0 10px" placeholder="貼文內容…">${esc(v.caption || '')}</textarea>
      <label class="hint">圖片（IG 必附；FB 可選）</label>
      <div style="display:flex;gap:10px;align-items:center;margin:4px 0 10px">
        <div id="sfImgBox">${img ? `<img src="${esc(img)}" style="max-width:160px;max-height:120px;border-radius:8px">` : '<span class="hint">尚無圖片</span>'}</div>
        <button class="mini" onclick="_socialPickImg()">上傳/更換</button>${img ? '<button class="mini" onclick="_socialClrImg()">移除</button>' : ''}
      </div>
      ${destBoxes(v)}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <div style="flex:1;min-width:150px"><label class="hint">分類（逗號分隔，如 新品,活動）</label><input id="sfTags" value="${esc((v.tags || []).join(','))}" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:4px"></div>
        <div style="flex:1;min-width:150px"><label class="hint">關聯餐點（分析銷量用，逗號分隔）</label><input id="sfItems" value="${esc((v.relatedItems || []).join(','))}" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:4px"></div>
      </div>
      <div style="margin-top:10px"><label class="hint">排程發文時間（留空＝核准後盡快發）</label><br><input id="sfWhen" type="datetime-local" value="${v.scheduledAt ? new Date(v.scheduledAt).toISOString().slice(0, 16) : ''}" style="border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:4px"></div>
      <div class="hint" style="margin-top:8px">流程：存草稿 → 送審 → <b>你核准後，到排程時間會「真的」自動發到你勾的平台</b>。</div>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="mini on" onclick="_socialSave('${v.id || ''}')">✓ 儲存</button><button class="mini" onclick="_socialEditClose()">取消</button></div>
    </section>`
  }

  window._socialPickImg = function () {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return
      const im = new Image()
      im.onload = async () => {
        const sc = Math.min(1, 1280 / Math.max(im.width, im.height))
        const cv = document.createElement('canvas'); cv.width = Math.round(im.width * sc); cv.height = Math.round(im.height * sc)
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height)
        const du = cv.toDataURL('image/jpeg', 0.82)
        const box = document.getElementById('sfImgBox'); if (box) box.innerHTML = '<span class="hint">上傳中…</span>'
        const j = await sPost({ op: 'upload', dataUrl: du })
        if (j.ok) { editMedia = [{ url: j.url, type: 'image' }]; if (box) box.innerHTML = `<img src="${j.url}" style="max-width:160px;max-height:120px;border-radius:8px">` }
        else { alert(j.error || '上傳失敗'); if (box) box.innerHTML = '<span class="hint">尚無圖片</span>' }
      }
      im.src = URL.createObjectURL(f)
    }
    inp.click()
  }
  window._socialClrImg = function () { editMedia = []; const box = document.getElementById('sfImgBox'); if (box) box.innerHTML = '<span class="hint">尚無圖片</span>' }

  window._socialEdit = function (id) { editId = id || ''; const pp = (DATA.posts || []).find(x => x.id === editId); editMedia = (pp && pp.media) ? JSON.parse(JSON.stringify(pp.media)) : []; socialBody(); const e = document.getElementById('sfCap'); if (e) e.focus() }
  window._socialEditClose = function () { editId = null; socialBody() }
  window._socialSave = async function (id) {
    const cap = (document.getElementById('sfCap') || {}).value || ''
    if (!cap.trim()) { alert('請先輸入文案'); return }
    const tags = ((document.getElementById('sfTags') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const items = ((document.getElementById('sfItems') || {}).value || '').split(',').map(s => s.trim()).filter(Boolean)
    const whenV = (document.getElementById('sfWhen') || {}).value
    const dests = [...document.querySelectorAll('.sfDest:checked')].map(x => x.value)
    if (dests.some(d => d.startsWith('ig:')) && !(editMedia[0] && editMedia[0].url)) { alert('有勾 IG 的話一定要上傳圖片'); return }
    const j = await sPost({ op: 'save', id: id || undefined, caption: cap, tags, relatedItems: items, scheduledAt: whenV ? new Date(whenV).toISOString() : null, dests, media: editMedia })
    if (j.ok) { editId = null; socialLoad() } else alert(j.error || '儲存失敗')
  }
  window._socialSubmit = async function (id) { if (!confirm('送出審核？張良會收到通知。')) return; const j = await sPost({ op: 'submit', id }); if (j.ok) { alert('已送審，張良會收到通知'); socialLoad() } else alert(j.error || '失敗') }
  window._socialDel = async function (id) { if (!confirm('刪除這則貼文？')) return; const j = await sPost({ op: 'del', id }); if (j.ok) socialLoad(); else alert(j.error || '失敗') }
  window._socialApprove = async function (id, op) { const j = await sPost({ op, id }); if (j.ok) socialLoad(); else alert(j.error || '失敗') }

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
  window._socialDetail = function (id) {
    const p = (DATA.posts || []).find(x => x.id === id); if (!p) return
    const m = p.metrics || {}, link = p.pub && ((p.pub.instagram || {}).permalink || (p.pub.facebook || {}).permalink), img = p.media && p.media[0] && p.media[0].url
    const met = (l, v, c) => `<div style="text-align:center"><div style="font-size:21px;font-weight:800;color:${c || 'var(--ink)'};font-variant-numeric:tabular-nums">${nf(v || 0)}</div><div class="hint" style="font-size:12px">${l}</div></div>`
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:70;display:flex;align-items:center;justify-content:center;padding:16px'; ov.onclick = () => ov.remove()
    ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:460px;width:100%;max-height:85vh;overflow:auto;padding:18px">
      <div style="display:flex;gap:10px"><div style="flex:1;min-width:0"><span style="background:${PLAT(p.platform).c}22;color:${PLAT(p.platform).c};padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700">${esc(p.brand || PLAT(p.platform).n)}</span><div style="margin-top:7px;line-height:1.6;color:var(--text);max-height:160px;overflow:auto">${esc(p.caption || '（無文字）')}</div></div>${img ? `<img src="${esc(img)}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;flex:0 0 auto">` : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0;background:#1C222B;border-radius:12px;padding:14px">${met('互動', INTER(m), '#9CC7F5')}${met('讚', m.reactions, COL.g)}${met('留言', m.comments)}${met('分享', m.shares)}${met('收藏', m.saves, COL.y)}${met('觸及', m.reach, COL.o)}</div>
      <div style="display:flex;gap:8px;align-items:center">${link ? `<a class="mini" style="text-decoration:none" href="${esc(link)}" target="_blank">看原貼文 ↗</a>` : ''}<button class="mini on" style="margin-left:auto" onclick="this.closest('div[style*=fixed]').remove()">關閉</button></div></div>`
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
