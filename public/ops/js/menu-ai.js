// ✨ 菜單 AI 圖庫前端共用模組 v1.1（2026-10-10；v1.1 10-11 加「版本存檔」面板＋Esc 關閉；menu-tv.html 電視圖「AI 重畫」＋ menu-poster.html 直式「插圖／Logo 變化／標語」共用）
// 流程：open() 開面板 → 參考圖(截圖貼上/檔案/現有照片)＋老闆的話 → ?menuai 兩段式(Claude 寫指令→Gemini 畫) → 挑一張 → 後製(去影子/校色或去背)
//       → 簽名直傳 Supabase → ?menuaisave 登記。圖庫＋版面設定走 ?menuassets（跨裝置）。
window.MAI = (() => {
  const Q = new URLSearchParams(location.search)
  const K = Q.get('k') || '7ea362bae1f0274372d4ec7b27c78852'
  const TK = () => Q.get('me') || (() => { try { return localStorage.getItem('prepToken') || '' } catch (e) { return '' } })()
  const api = (ep, body) => fetch('/api/mail-sync?' + ep + '=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) }).then(r => r.json())
  let assets = { photos: {}, art: [], tvcfg: null, poster: {}, vers: [] }
  let _which = null // v4.70.81 「這裡由哪家 AI 處理」小標籤（張良 2026-10-12）
  function aiTagFill() { (_which || (_which = fetch('/api/mail-sync?aiwhich=' + K).then(r => r.json()).then(d => (d && d.ok && d.routes) || {}).catch(() => ({})))).then(R => { const el = document.getElementById('maiAiTag'); const a = R.app, b = R.image; if (!el || !a || !b) return; el.textContent = `寫指令：${a.model} → 畫圖：${b.model}`; el.title = `寫指令由 ${a.co}「${a.model}」、畫圖由 ${b.co}「${b.model}」處理；設定頁「AI 模型」可切換` }) }
  async function load() { try { const r = await fetch('/api/mail-sync?menuassets=' + K + '&_=' + Date.now()); const d = await r.json(); if (d && d.ok) assets = d } catch (e) {} return assets }
  const CR = [245, 234, 218]
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('圖片載入失敗')); im.src = src.startsWith('data:') ? src : src + (src.includes('?') ? '&' : '?') + 'cb=' + Date.now() }) }
  function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
  async function toDataURL(src, maxW, type, q) { const im = await loadImg(src); const s = maxW ? Math.min(1, maxW / im.naturalWidth) : 1; const c = cvs(Math.round(im.naturalWidth * s), Math.round(im.naturalHeight * s)); const g = c.getContext('2d'); if (type === 'image/jpeg') { g.fillStyle = '#F5EADA'; g.fillRect(0, 0, c.width, c.height) } g.drawImage(im, 0, 0, c.width, c.height); return c.toDataURL(type || 'image/png', q) }
  // 照片後製：奶油色正規化（消淡淡矩形）→ 只取最下方那段內容（AI 常把參考原圖留成影子在上面）→ 留邊裁切
  async function cleanPhoto(src) {
    const im = await loadImg(src); const c = cvs(im.naturalWidth, im.naturalHeight); const g = c.getContext('2d'); g.drawImage(im, 0, 0)
    const W = c.width, H = c.height, id = g.getImageData(0, 0, W, H), p = id.data, rows = new Uint8Array(H)
    for (let y = 0; y < H; y++) { let cnt = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const d = Math.abs(p[i] - CR[0]) + Math.abs(p[i + 1] - CR[1]) + Math.abs(p[i + 2] - CR[2]); if (d < 45) { p[i] = CR[0]; p[i + 1] = CR[1]; p[i + 2] = CR[2] } else cnt++ } rows[y] = cnt > 3 ? 1 : 0 }
    const bands = []; let y = 0
    while (y < H) { if (rows[y]) { const y0 = y; let gap = 0; while (y < H && gap < 25) { gap = rows[y] ? 0 : gap + 1; y++ } bands.push([y0, y - gap]) } else y++ }
    g.putImageData(id, 0, 0)
    if (!bands.length) return c.toDataURL('image/png')
    const [y0, y1] = bands[bands.length - 1]; let x0 = W, x1 = 0
    for (let yy = y0; yy < y1; yy++) for (let x = 0; x < W; x++) { const i = (yy * W + x) * 4; if (p[i] !== CR[0] || p[i + 1] !== CR[1] || p[i + 2] !== CR[2]) { if (x < x0) x0 = x; if (x > x1) x1 = x } }
    const mg = 50, cx0 = Math.max(0, x0 - mg), cy0 = Math.max(0, y0 - mg), cx1 = Math.min(W, x1 + mg), cy1 = Math.min(H, y1 + mg)
    const o = cvs(cx1 - cx0, cy1 - cy0); o.getContext('2d').drawImage(c, cx0, cy0, cx1 - cx0, cy1 - cy0, 0, 0, cx1 - cx0, cy1 - cy0); return o.toDataURL('image/png')
  }
  // 插圖後製：奶油底去背成透明（貼在海報上不會蓋到框線／文字）＋ 留邊裁切
  async function cutout(src) {
    const im = await loadImg(src); const c = cvs(im.naturalWidth, im.naturalHeight); const g = c.getContext('2d'); g.drawImage(im, 0, 0)
    const W = c.width, H = c.height, id = g.getImageData(0, 0, W, H), p = id.data; let x0 = W, y0 = H, x1 = 0, y1 = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const d = Math.abs(p[i] - CR[0]) + Math.abs(p[i + 1] - CR[1]) + Math.abs(p[i + 2] - CR[2]); const a = d <= 28 ? 0 : d >= 70 ? 255 : Math.round((d - 28) / 42 * 255); p[i + 3] = a; if (a > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y } }
    g.putImageData(id, 0, 0)
    if (x1 <= x0 || y1 <= y0) return c.toDataURL('image/png')
    const mg = 16, cx0 = Math.max(0, x0 - mg), cy0 = Math.max(0, y0 - mg), cx1 = Math.min(W, x1 + mg), cy1 = Math.min(H, y1 + mg)
    const o = cvs(cx1 - cx0, cy1 - cy0); o.getContext('2d').drawImage(c, cx0, cy0, cx1 - cx0, cy1 - cy0, 0, 0, cx1 - cx0, cy1 - cy0); return o.toDataURL('image/png')
  }
  async function upload(dataURL, kind) {
    const sg = await api('menuaisign', { ext: 'png', kind }); if (!sg.ok) throw new Error(sg.error || '簽名失敗')
    const blob = await (await fetch(dataURL)).blob()
    const u = await fetch(sg.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: blob }); if (!u.ok) throw new Error('上傳失敗 ' + u.status)
    return sg.publicUrl
  }
  // ── 面板 ──
  const CSS = `
  .maiM{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;font:14px/1.5 system-ui,-apple-system,sans-serif;color:#eee}
  .maiM.on{display:flex}
  .maiM .pan{background:#1b1b1b;border-radius:14px;width:min(760px,96vw);max-height:94vh;overflow:auto;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
  .maiM h3{margin:0 0 10px;font-size:16px;color:#F5EADA;display:flex;justify-content:space-between;align-items:center}
  .maiM h3 .x{cursor:pointer;color:#aaa;font-size:22px;padding:0 6px}
  .maiM .row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;margin:8px 0}
  .maiM .ref{width:150px;height:110px;border:2px dashed #666;border-radius:10px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;color:#aaa;cursor:pointer;overflow:hidden;background:#F5EADA;position:relative;flex:0 0 auto}
  .maiM .ref img{max-width:100%;max-height:100%;display:block}
  .maiM .ref.on{border-style:solid;border-color:#1a7f37}
  .maiM .ref .del{position:absolute;top:2px;right:4px;color:#fff;background:#000a;border-radius:10px;padding:0 6px;font-size:12px}
  .maiM textarea,.maiM input[type=text]{width:100%;background:#111;color:#eee;border:1px solid #444;border-radius:8px;padding:8px;font:14px system-ui;box-sizing:border-box}
  .maiM textarea{min-height:64px;resize:vertical}
  .maiM .opts{flex:1;min-width:240px}
  .maiM .seg{display:inline-flex;border:1px solid #555;border-radius:8px;overflow:hidden;margin:0 6px 6px 0}
  .maiM .seg button{background:#222;color:#ddd;border:none;padding:6px 10px;cursor:pointer;font-weight:700;font-size:13px}
  .maiM .seg button.on{background:#CE1611;color:#fff}
  .maiM .go{background:#CE1611;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-weight:800;font-size:15px;cursor:pointer}
  .maiM .go:disabled{opacity:.5}
  .maiM .st{font-size:13px;color:#9cf;min-height:20px}
  .maiM .brief{background:#262626;border-left:3px solid #CE1611;padding:8px 10px;border-radius:6px;font-size:13px;color:#ddd;margin:8px 0}
  .maiM .brief b{color:#F5EADA}
  .maiM .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:8px 0}
  .maiM .grid .it{border:3px solid transparent;border-radius:10px;overflow:hidden;cursor:pointer;background:#F5EADA;position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center}
  .maiM .grid .it img{max-width:100%;max-height:100%;display:block}
  .maiM .grid .it.on{border-color:#1a7f37}
  .maiM .grid .it .del{position:absolute;top:4px;right:6px;color:#fff;background:#000a;border-radius:10px;padding:0 7px;font-size:12px;cursor:pointer}
  .maiM .act{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px}
  .maiM .act button{background:#444;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}
  .maiM .act button.ok{background:#1a7f37}
  .maiM .tip{font-size:12px;color:#999}
  .maiM .vrow{display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #2c2c2c}
  .maiM .vrow .th{display:flex;gap:4px;flex:0 0 auto}
  .maiM .vrow .th img{height:46px;width:auto;border-radius:4px;background:#F5EADA}
  .maiM .vrow .nm{flex:1;min-width:0}
  .maiM .vrow .nm b{color:#F5EADA;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .maiM .vrow.cur{background:#1f2a1f;border-radius:8px;padding-left:8px}
  .maiM .vrow button{background:#444;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-weight:700;cursor:pointer;font-size:12px}
  .maiM .vrow button.ok{background:#1a7f37}
  .maiM h4{margin:12px 0 4px;font-size:13px;color:#F5EADA;border-top:1px solid #333;padding-top:10px}`
  let ST = null
  // Esc：先關開著的面板，都沒開就交給頁面（退出編輯模式）— 張良 10-11「到編輯畫面沒有退出選項」。掛在模組載入時（面板可能還沒建）
  document.addEventListener('keydown', ev => { if (ev.key !== 'Escape') return; const v = document.getElementById('maiVer'), d = document.getElementById('maiMod')
    if (v && v.classList.contains('on')) { if (!(VS && VS.busy)) verClose() } else if (d && d.classList.contains('on')) close(); else if (typeof window.MAI.onEsc === 'function') window.MAI.onEsc() })
  function ensure() {
    if (document.getElementById('maiMod')) return
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s)
    const d = document.createElement('div'); d.id = 'maiMod'; d.className = 'maiM'; d.innerHTML = '<div class="pan" id="maiPan"></div>'; document.body.appendChild(d)
    const v = document.createElement('div'); v.id = 'maiVer'; v.className = 'maiM'; v.innerHTML = '<div class="pan" id="maiVPan"></div>'; document.body.appendChild(v)
    v.addEventListener('click', ev => { if (ev.target === v) verClose() })

    d.addEventListener('click', ev => { if (ev.target === d) close() })
    document.addEventListener('paste', ev => { if (!ST || !document.getElementById('maiMod').classList.contains('on')) return; const its = (ev.clipboardData || {}).items || []; for (const it of its) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { ev.preventDefault(); fileToRef(f) } } } })
  }
  function close() { const m = document.getElementById('maiMod'); if (m) m.classList.remove('on'); ST = null }
  async function fileToRef(f) { const fr = new FileReader(); fr.onload = async () => { try { ST.ref = await toDataURL(fr.result, 1024, 'image/jpeg', .9); draw() } catch (e) { alert('讀圖失敗') } }; fr.readAsDataURL(f) }
  const SUBS = { sticker: '小插圖', logo: 'Logo 變化', slogan: '標語圖' }
  function draw() {
    const p = document.getElementById('maiPan'), s = ST; if (!p || !s) return
    const isArt = s.kind === 'art'
    let h = `<h3><b>${s.title || (isArt ? '✨ AI 插圖' : '✨ AI 重畫照片')}</b><span id="maiAiTag" style="font-size:11px;font-weight:700;opacity:.75;margin-left:10px;white-space:nowrap">AI…</span><span class="x" onclick="MAI.close()">×</span></h3>`
    aiTagFill() // v4.70.81 哪家 AI 處理：寫指令（app）→ 畫圖（image）
    h += `<div class="row">`
    h += `<div class="ref ${s.ref ? 'on' : ''}" onclick="document.getElementById('maiFile').click()" title="${isArt ? '貼上截圖（Ctrl/⌘+V）或點選檔案' : '目前照片'}">${s.ref ? `<img src="${s.ref}">${isArt ? '<span class="del" onclick="event.stopPropagation();MAI.clearRef()">✕</span>' : ''}` : (isArt ? '把你喜歡的風格<br>截圖直接 ⌘V 貼上<br>或點這裡選檔案' : '沒有參考圖')}</div>`
    h += `<input type="file" id="maiFile" accept="image/*" style="display:none" onchange="MAI.pickFile(this)">`
    h += `<div class="opts">`
    if (isArt) { h += `<div class="seg">${Object.entries(SUBS).map(([k, v]) => `<button class="${s.sub === k ? 'on' : ''}" onclick="MAI.setSub('${k}')">${v}</button>`).join('')}</div>`
      if (s.sub === 'slogan') h += `<input type="text" id="maiSlogan" placeholder="要畫進圖裡的標語文字（原樣照抄）" value="${(s.slogan || '').replace(/"/g, '&quot;')}" style="margin-bottom:6px">` }
    h += `<textarea id="maiHint" placeholder="${isArt ? '用你的話講概念跟感覺，例如：海邊度假的輕鬆感、手繪可愛、披薩在衝浪' : '補充要求（可空）：例如 盤子要完整、多一點生菜、角度再俯一點'}">${s.hint || ''}</textarea>`
    h += `<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="seg">${[1, 2, 4].map(n => `<button class="${s.n === n ? 'on' : ''}" onclick="MAI.setN(${n})">${n} 張</button>`).join('')}</span>`
    h += `<button class="go" id="maiGo" onclick="MAI.go(false)" ${s.busy ? 'disabled' : ''}>${s.brief_en ? '改要求、重寫指令再畫' : '開始'}</button>`
    if (s.brief_en) h += `<button class="go" style="background:#444" onclick="MAI.go(true)" ${s.busy ? 'disabled' : ''}>同指令再畫一批</button>`
    h += `</div><div class="st" id="maiSt">${s.st || ''}</div><div class="tip">兩段式：先由文字模型看圖寫一段精確指令，再交給 Gemini 畫。每張約 NT$1.5、約 20～40 秒。</div>`
    h += `</div></div>`
    if (s.brief_zh) h += `<div class="brief"><b>這次給 Gemini 的指令（摘要）：</b>${s.brief_zh}</div>`
    if (s.urls && s.urls.length) { h += `<div class="grid">${s.urls.map((u, i) => `<div class="it ${s.pick === i ? 'on' : ''}" onclick="MAI.pick(${i})"><img src="${u}"></div>`).join('')}</div>`
      h += `<div class="act"><button onclick="MAI.close()">取消</button><button class="ok" onclick="MAI.use()" ${s.pick == null || s.busy ? 'disabled' : ''}>✓ 用這張</button></div>` }
    if (isArt && assets.art && assets.art.length) { h += `<h4>已有的插圖（點一下放到海報上；✕ 從圖庫刪除）</h4><div class="grid">${assets.art.map(a => `<div class="it" onclick="MAI.useLib('${a.id}')"><img src="${a.url}"><span class="del" onclick="event.stopPropagation();MAI.delLib('${a.id}')">✕</span></div>`).join('')}</div>` }
    p.innerHTML = h
  }
  function open(opts) { ensure(); ST = { kind: opts.kind || 'photo', sub: opts.sub || 'sticker', title: opts.title, ref: opts.ref || '', hint: '', n: opts.n || (opts.kind === 'art' ? 4 : 2), onPick: opts.onPick, onLib: opts.onLib, onLibDel: opts.onLibDel, pick: null, urls: [] }; draw(); document.getElementById('maiMod').classList.add('on') }
  function setSub(k) { ST.sub = k; ST.brief_en = ''; ST.urls = []; ST.pick = null; ST.hint = document.getElementById('maiHint').value; draw() }
  function setN(n) { ST.n = n; ST.hint = document.getElementById('maiHint').value; const sl = document.getElementById('maiSlogan'); if (sl) ST.slogan = sl.value; draw() }
  function pickFile(inp) { const f = inp.files && inp.files[0]; if (f) fileToRef(f) }
  function clearRef() { ST.ref = ''; draw() }
  function st(t) { ST.st = t; const e = document.getElementById('maiSt'); if (e) e.textContent = t }
  async function go(same) {
    const s = ST; s.hint = document.getElementById('maiHint').value; const sl = document.getElementById('maiSlogan'); if (sl) s.slogan = sl.value
    if (s.kind === 'art' && s.sub === 'slogan' && !(s.slogan || '').trim()) { alert('先填標語文字'); return }
    if (s.kind === 'art' && !s.ref && !(s.hint || '').trim()) { alert('貼一張風格參考圖，或至少用一句話講想要的感覺'); return }
    const imgs = []; if (s.ref) imgs.push(s.ref)
    if (s.kind === 'art' && s.sub === 'logo') { try { imgs.push(await toDataURL('menu/brand.png', 1080, 'image/png')) } catch (e) {} }
    s.busy = true; s.pick = null; draw(); st(same ? 'Gemini 畫圖中（約 30 秒）…' : '① 文字模型看圖寫指令 → ② Gemini 畫圖（約 40 秒）…')
    try {
      const r = await api('menuai', { kind: s.kind, sub: s.sub, imgs, hint: s.hint, slogan: s.slogan, n: s.n, brief_en: same ? s.brief_en : '', brief_zh: same ? s.brief_zh : '' })
      if (!r.ok) throw new Error(r.error || '失敗')
      s.brief_en = r.brief_en; s.brief_zh = r.brief_zh; s.urls = r.urls; s.pick = r.urls.length === 1 ? 0 : null; st('完成（' + Math.round(r.ms / 1000) + ' 秒）點一張再按「用這張」')
    } catch (e) { st('❌ ' + (e.message || e)) }
    s.busy = false; draw()
  }
  function pick(i) { ST.pick = i; draw() }
  async function use() { const s = ST; if (s.pick == null) return; s.busy = true; draw(); st('後製＋存檔中…'); try { await s.onPick(s.urls[s.pick], { sub: s.sub, brief_zh: s.brief_zh }); close() } catch (e) { s.busy = false; draw(); st('❌ ' + (e.message || e)) } }
  async function useLib(id) { const a = (assets.art || []).find(x => x.id === id); if (a && ST && ST.onLib) { await ST.onLib(a); close() } }
  async function delLib(id) { const r = await api('menuassetset', { artDel: id }); if (!r.ok) { alert(r.error || '刪除失敗'); return } assets.art = r.art; assets.poster = r.poster; draw(); if (ST && ST.onLibDel) ST.onLibDel(id) }
  // ── 🕘 版本存檔（v1.1 張良 2026-10-11「每次編輯完給我版本存檔，顯示日期、版本名稱，也直接更新在 /prep 新菜單頁」）──
  // verOpen({kind:'tv'|'poster', defName, snap:async(progress)=>[dataURL…], cfg:()=>物件, onApplied:async()=>{}})：存=出圖→直傳→?menuassetset verSave；回復=verApply 後頁面重畫
  const now = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
  let VS = null
  function verOpen(opts) { ensure(); VS = { kind: opts.kind || 'tv', defName: opts.defName || '', snap: opts.snap, cfg: opts.cfg, onApplied: opts.onApplied, msg: '', busy: false }; vdraw(); document.getElementById('maiVer').classList.add('on') }
  function verClose() { const m = document.getElementById('maiVer'); if (m) m.classList.remove('on'); VS = null }
  function vst(t) { if (VS) VS.msg = t; const e = document.getElementById('maiVSt'); if (e) e.textContent = t }
  function vdraw() {
    const p = document.getElementById('maiVPan'), s = VS; if (!p || !s) return
    const tv = s.kind === 'tv', list = (assets.vers || []).filter(v => v.kind === s.kind)
    const nmEl = document.getElementById('maiVn'); const keepName = nmEl ? nmEl.value : s.defName
    let h = `<h3><b>🕘 版本存檔（${tv ? '四張電視圖' : '直式菜單'}）</b><span class="x" onclick="MAI.verClose()">×</span></h3>`
    h += `<div class="brief"><b>存成新版本</b><div class="row" style="align-items:center"><input type="text" id="maiVn" value="${String(keepName).replace(/"/g, '&quot;')}" placeholder="版本名稱" style="flex:1;min-width:200px"><button class="go" onclick="MAI.verSave()" ${s.busy ? 'disabled' : ''}>💾 存檔</button></div>`
      + `<div class="tip">${tv ? '把目前四頁各出一張圖存起來，/prep「新菜單」頁最上面四格會直接換成這版。' : '把目前海報出一張圖存起來（含插圖位置），/prep「新菜單」頁會顯示最新直式版。'}之後隨時可回復。</div></div>`
    h += `<div class="st" id="maiVSt">${s.msg || ''}</div>`
    h += `<h4>歷史版本（${list.length}）</h4>`
    if (!list.length) h += `<div class="tip">還沒有存過版本。</div>`
    list.forEach((v, i) => { h += `<div class="vrow ${i === 0 ? 'cur' : ''}"><div class="th">${v.urls.map(u => `<img src="${u}" loading="lazy" onclick="window.open('${u}','_blank')" style="cursor:zoom-in">`).join('')}</div>`
      + `<div class="nm"><b>${String(v.name).replace(/</g, '&lt;')}${i === 0 ? '　<span class="tip" style="color:#8f8">最新</span>' : ''}</b><span class="tip">${v.date}　${v.by || ''}</span></div>`
      + `<div><button class="ok" onclick="MAI.verApply('${v.id}')" ${s.busy ? 'disabled' : ''}>回復這版</button> <button onclick="MAI.verDel('${v.id}')" ${s.busy ? 'disabled' : ''}>刪除</button></div></div>` })
    p.innerHTML = h
  }
  async function verSave() {
    const s = VS; if (!s || s.busy) return
    if (!TK()) { vst('還沒登入——請從已登入的 App 開這一頁再存。'); return }
    const name = (document.getElementById('maiVn') || {}).value || s.defName
    s.busy = true; vdraw(); vst('出圖中…')
    try {
      const shots = await s.snap(t => vst(t)); const urls = []
      for (let i = 0; i < shots.length; i++) { vst('上傳中 ' + (i + 1) + '/' + shots.length + '…'); urls.push(await upload(shots[i], 'ver')) }
      vst('登記中…'); const r = await api('menuassetset', { verSave: { kind: s.kind, name, urls, cfg: s.cfg ? s.cfg() : {} } })
      if (!r.ok) throw new Error(r.error || '存檔失敗')
      assets.vers = r.vers || assets.vers; s.busy = false; s.defName = name; vdraw(); vst('✓ 已存成「' + name + '」' + (s.kind === 'tv' ? '，/prep 新菜單頁四張圖已更新。' : '，/prep 新菜單頁已記成最新直式版。'))
    } catch (e) { s.busy = false; vdraw(); vst('❌ ' + (e.message || e)) }
  }
  async function verApply(id) {
    const s = VS; if (!s || s.busy) return; const v = (assets.vers || []).find(x => x.id === id); if (!v) return
    if (!confirm('回復到「' + v.name + '」（' + v.date + '）？目前畫面的設定會被蓋掉（建議先存一版）。')) return
    s.busy = true; vdraw(); vst('回復中…')
    try { const r = await api('menuassetset', { verApply: id }); if (!r.ok) throw new Error(r.error || '回復失敗'); Object.assign(assets, { photos: r.photos, art: r.art, tvcfg: r.tvcfg, poster: r.poster, vers: r.vers }); if (s.onApplied) await s.onApplied(v); s.busy = false; vdraw(); vst('✓ 已回復「' + v.name + '」') }
    catch (e) { s.busy = false; vdraw(); vst('❌ ' + (e.message || e)) }
  }
  async function verDel(id) {
    const v = (assets.vers || []).find(x => x.id === id); if (!v || !confirm('刪除版本「' + v.name + '」？')) return
    const r = await api('menuassetset', { verDel: id }); if (!r.ok) { alert(r.error || '刪除失敗'); return } assets.vers = r.vers || []; vdraw()
  }
  return { K, TK, api, load, now, get assets() { return assets }, toDataURL, cleanPhoto, cutout, upload, open, close, setSub, setN, pickFile, clearRef, go, pick, use, useLib, delLib, verOpen, verClose, verSave, verApply, verDel }
})()
