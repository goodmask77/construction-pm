// ✨ 菜單 AI 圖庫前端共用模組 v1.0（2026-10-10；menu-tv.html 電視圖「AI 重畫」＋ menu-poster.html 直式「插圖／Logo 變化／標語」共用）
// 流程：open() 開面板 → 參考圖(截圖貼上/檔案/現有照片)＋老闆的話 → ?menuai 兩段式(Claude 寫指令→Gemini 畫) → 挑一張 → 後製(去影子/校色或去背)
//       → 簽名直傳 Supabase → ?menuaisave 登記。圖庫＋版面設定走 ?menuassets（跨裝置）。
window.MAI = (() => {
  const Q = new URLSearchParams(location.search)
  const K = Q.get('k') || '7ea362bae1f0274372d4ec7b27c78852'
  const TK = () => Q.get('me') || (() => { try { return localStorage.getItem('prepToken') || '' } catch (e) { return '' } })()
  const api = (ep, body) => fetch('/api/mail-sync?' + ep + '=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) }).then(r => r.json())
  let assets = { photos: {}, art: [], tvcfg: null, poster: {} }
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
  #maiMod{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;font:14px/1.5 system-ui,-apple-system,sans-serif;color:#eee}
  #maiMod.on{display:flex}
  #maiMod .pan{background:#1b1b1b;border-radius:14px;width:min(760px,96vw);max-height:94vh;overflow:auto;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
  #maiMod h3{margin:0 0 10px;font-size:16px;color:#F5EADA;display:flex;justify-content:space-between;align-items:center}
  #maiMod h3 .x{cursor:pointer;color:#aaa;font-size:22px;padding:0 6px}
  #maiMod .row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;margin:8px 0}
  #maiMod .ref{width:150px;height:110px;border:2px dashed #666;border-radius:10px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;color:#aaa;cursor:pointer;overflow:hidden;background:#F5EADA;position:relative;flex:0 0 auto}
  #maiMod .ref img{max-width:100%;max-height:100%;display:block}
  #maiMod .ref.on{border-style:solid;border-color:#1a7f37}
  #maiMod .ref .del{position:absolute;top:2px;right:4px;color:#fff;background:#000a;border-radius:10px;padding:0 6px;font-size:12px}
  #maiMod textarea,#maiMod input[type=text]{width:100%;background:#111;color:#eee;border:1px solid #444;border-radius:8px;padding:8px;font:14px system-ui;box-sizing:border-box}
  #maiMod textarea{min-height:64px;resize:vertical}
  #maiMod .opts{flex:1;min-width:240px}
  #maiMod .seg{display:inline-flex;border:1px solid #555;border-radius:8px;overflow:hidden;margin:0 6px 6px 0}
  #maiMod .seg button{background:#222;color:#ddd;border:none;padding:6px 10px;cursor:pointer;font-weight:700;font-size:13px}
  #maiMod .seg button.on{background:#CE1611;color:#fff}
  #maiMod .go{background:#CE1611;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-weight:800;font-size:15px;cursor:pointer}
  #maiMod .go:disabled{opacity:.5}
  #maiMod .st{font-size:13px;color:#9cf;min-height:20px}
  #maiMod .brief{background:#262626;border-left:3px solid #CE1611;padding:8px 10px;border-radius:6px;font-size:13px;color:#ddd;margin:8px 0}
  #maiMod .brief b{color:#F5EADA}
  #maiMod .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:8px 0}
  #maiMod .grid .it{border:3px solid transparent;border-radius:10px;overflow:hidden;cursor:pointer;background:#F5EADA;position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center}
  #maiMod .grid .it img{max-width:100%;max-height:100%;display:block}
  #maiMod .grid .it.on{border-color:#1a7f37}
  #maiMod .grid .it .del{position:absolute;top:4px;right:6px;color:#fff;background:#000a;border-radius:10px;padding:0 7px;font-size:12px;cursor:pointer}
  #maiMod .act{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px}
  #maiMod .act button{background:#444;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}
  #maiMod .act button.ok{background:#1a7f37}
  #maiMod .tip{font-size:12px;color:#999}
  #maiMod h4{margin:12px 0 4px;font-size:13px;color:#F5EADA;border-top:1px solid #333;padding-top:10px}`
  let ST = null
  function ensure() {
    if (document.getElementById('maiMod')) return
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s)
    const d = document.createElement('div'); d.id = 'maiMod'; d.innerHTML = '<div class="pan" id="maiPan"></div>'; document.body.appendChild(d)
    d.addEventListener('click', ev => { if (ev.target === d) close() })
    document.addEventListener('paste', ev => { if (!ST || !document.getElementById('maiMod').classList.contains('on')) return; const its = (ev.clipboardData || {}).items || []; for (const it of its) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { ev.preventDefault(); fileToRef(f) } } } })
  }
  function close() { const m = document.getElementById('maiMod'); if (m) m.classList.remove('on'); ST = null }
  async function fileToRef(f) { const fr = new FileReader(); fr.onload = async () => { try { ST.ref = await toDataURL(fr.result, 1024, 'image/jpeg', .9); draw() } catch (e) { alert('讀圖失敗') } }; fr.readAsDataURL(f) }
  const SUBS = { sticker: '小插圖', logo: 'Logo 變化', slogan: '標語圖' }
  function draw() {
    const p = document.getElementById('maiPan'), s = ST; if (!p || !s) return
    const isArt = s.kind === 'art'
    let h = `<h3><b>${s.title || (isArt ? '✨ AI 插圖' : '✨ AI 重畫照片')}</b><span class="x" onclick="MAI.close()">×</span></h3>`
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
  return { K, TK, api, load, get assets() { return assets }, toDataURL, cleanPhoto, cutout, upload, open, close, setSub, setN, pickFile, clearRef, go, pick, use, useLib, delLib }
})()
