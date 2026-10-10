// 🍳 /prep 第 20 塊（v4.70.34，2026-10-10）：產品與成本模組｜批次 3「食譜庫＋食譜詳情＋製作模式」
// 規格 §4：列表照片為主（工作站／半成品或餐點／版本／產量／每單位成本／完整狀態／內容完整度 材料✓步驟✗照片✗）；
//   詳情：材料（每行完整換算鏈、半成品可展開樹）／步驟（順序、標題、說明、相關材料、照片、計時，可拖曳）／成本（走勢＋差異標記）／版本（草稿→發布，不可覆寫）；
//   製作模式：桌面左材料右步驟、手機上步驟＋材料抽屜＋上一步/下一步/計時；倍率只影響顯示；計時切頁後恢復。
// 資料 ?recipes=（api/_recipe.js）。UI 慣例：單色線條圖示、不用 prompt、編輯卡片 ✓ 完成鈕。
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 100) / 100).toLocaleString()
  const n4 = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 1e4) / 1e4).toString()
  const I = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto">${d}</svg>`
  const IC = { pot: I('<path d="M12 3a7 7 0 0 0-7 7v1h14v-1a7 7 0 0 0-7-7z"/><path d="M4 14h16v2a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-2z"/>'), check: I('<polyline points="20 6 9 17 4 12"/>'), x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'), img: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'), play: I('<polygon points="5 3 19 12 5 21 5 3"/>'), cam: I('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'), clock: I('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'), plus: I('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'), up: I('<polyline points="18 15 12 9 6 15"/>'), dn: I('<polyline points="6 9 12 15 18 9"/>'), trash: I('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'), left: I('<polyline points="15 18 9 12 15 6"/>'), right: I('<polyline points="9 18 15 12 9 6"/>'), list: I('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'), undo: I('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>'), tree: I('<polyline points="9 18 15 12 9 6"/>') }
  const COL = { b: '#4DA3FF', g: '#3DBE6C', o: '#E8A657', y: '#E8C14E', p: '#B48CF2', r: '#F07373', m: '#8C98A8' }
  const LST = { ok: ['', COL.g], noprice: ['缺價格', COL.r], noconv: ['缺換算', COL.r], conv_unconfirmed: ['換算未確認', COL.o], noyield: ['缺產量', COL.r], sub_gap: ['子食譜缺口', COL.o], nomatch: ['對不到物料', COL.r], nocost_unlisted: ['白名單外不計成本', COL.o] }
  let RD = null, mode = 'prep', fSt = 'all', fCat = 'all', fOk = 'all', q = '', openKey = null, dTab = 'items', editing = null, loading = false, mult = 1, cook = null, timerTick = null

  window.rcpLoad = async function () {
    curStore = 'rcp'; try { setTabs('rcp') } catch (_) {}
    document.getElementById('upd').textContent = '食譜庫'
    app.innerHTML = '<section><div class="hint" style="padding:22px">載入食譜庫中…</div></section>'
    await rcpFetch()
  }
  async function rcpFetch () {
    if (loading) return; loading = true
    try { const meQ = TK() ? '&me=' + encodeURIComponent(TK()) : ''; const r = await fetch('/api/mail-sync?recipes=' + encodeURIComponent(K) + meQ + '&r=' + Date.now()); RD = await r.json() } catch (e) { RD = { ok: false, error: '連線問題' } }
    loading = false
    if (curStore === 'rcp') { app.innerHTML = render(); if (openKey) { const r = rec(openKey); if (r) detail(r) } }
  }
  window.rcpRefresh = rcpFetch
  const rec = key => [...(RD.recipes || []), ...(RD.dishes || [])].find(r => r.key === key)
  const imgUrl = p => p ? '/api/mail-sync?rcpimg=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK() || '') + '&path=' + encodeURIComponent(p) : ''
  const can = () => RD && RD.me && RD.me.canEdit

  function filt () {
    const src = mode === 'prep' ? (RD.recipes || []) : (RD.dishes || [])
    const qq = q.toLowerCase()
    return src.filter(r => {
      if (mode === 'prep' && fSt !== 'all' && (r.station || '未分站') !== fSt) return false
      if (mode === 'dish' && fCat !== 'all' && (r.category || '未分類') !== fCat) return false
      if (fOk === 'ok' && !r.ok) return false
      if (fOk === 'gap' && r.ok) return false
      if (fOk === 'nosteps' && r.content.steps) return false
      if (qq && !([r.name, r.code, r.station, r.category, ...(r.items || []).map(i => i.name)].join(' ').toLowerCase().includes(qq))) return false
      return true
    })
  }
  function render () {
    if (!RD.ok) return '<section><div class="err">' + esc(RD.error || '讀不到食譜') + '</div>' + (/綁定|登入|身分/.test(RD.error || '') ? '<div class="hint" style="margin-top:10px">食譜成本是內部資料，要先登入。私訊 DD「登入碼」拿 4 位數 → 右上「登入」。</div>' : '') + '</section>'
    const ps = RD.recipes || [], ds = RD.dishes || []
    let h = `<h1 style="display:flex;align-items:center;gap:8px">${IC.pot} 食譜庫</h1><div class="sub">備料食譜（半成品）＝阿桑系統即時配方 ${ps.length} 份；出餐食譜（在賣菜）${ds.length} 道。材料／用量／產量已有，<b>步驟、照片、影片要補</b>。成本由系統算，每行附換算鏈。</div>`
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:14px 0">`
      + kpi('備料食譜', ps.length, `成本完整 ${ps.filter(r => r.ok).length}`, COL.b, "_rcpMode('prep')") + kpi('出餐食譜', ds.length, `成本完整 ${ds.filter(r => r.ok).length}`, COL.p, "_rcpMode('dish')")
      + kpi('有步驟', ps.filter(r => r.content.steps).length + ds.filter(r => r.content.steps).length, '內容補齊進度', COL.g, "_rcpOk('nosteps')") + kpi('有照片', ps.filter(r => r.content.photo).length + ds.filter(r => r.content.photo).length, '', COL.y, '') + `</div>`
    h += `<section style="padding:12px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">`
      + `<button class="mini ${mode === 'prep' ? 'on' : ''}" onclick="_rcpMode('prep')">備料（半成品）</button><button class="mini ${mode === 'dish' ? 'on' : ''}" onclick="_rcpMode('dish')">出餐（在賣菜）</button>`
      + `<input value="${esc(q)}" oninput="_rcpQ(this.value)" placeholder="搜尋食譜／材料…" style="flex:1;min-width:160px;border:1px solid var(--line);border-radius:10px;padding:8px 12px">`
      + `<button class="mini" onclick="rcpRefresh()">${IC.undo}</button></div>`
    if (mode === 'prep') { const sts = ['未分站', ...(RD.stations || [])]; h += `<div class="hint" style="font-size:12px">工作站（Pizza／內場／吧台…可在食譜裡設）</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"><button class="mini ${fSt === 'all' ? 'on' : ''}" onclick="_rcpSt('all')">全部</button>` + sts.map(s => `<button class="mini ${fSt === s ? 'on' : ''}" onclick="_rcpSt('${esc(s)}')">${esc(s)}</button>`).join('') + `</div>` } else { h += `<div class="hint" style="font-size:12px">菜單品類</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"><button class="mini ${fCat === 'all' ? 'on' : ''}" onclick="_rcpCat('all')">全部</button>` + (RD.cats || []).map(s => `<button class="mini ${fCat === s ? 'on' : ''}" onclick="_rcpCat('${esc(s)}')">${esc(s)}</button>`).join('') + `</div>` }
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap">` + [['all', '全部'], ['ok', '成本完整'], ['gap', '不完整'], ['nosteps', '還沒步驟']].map(([v, l]) => `<button class="mini ${fOk === v ? 'on' : ''}" onclick="_rcpOk('${v}')">${l}</button>`).join('') + `</div></section>`
    h += `<div class="hint" style="margin:6px 2px">${mode === 'dish' ? '出餐食譜行來自 10-06 快照（阿桑尚未給菜單食譜行端點），售價＝/costs/menu 即時' : '資料：阿桑 /recipes 即時（' + esc(String(RD.masterUpdatedAt || '').slice(5, 16).replace('T', ' ')) + '）'}</div>`
    h += '<div id="rcpGrid">' + grid() + '</div>'
    return h
  }
  function kpi (l, v, sub, c, onclick) { return `<div class="kpi" ${onclick ? `onclick="${onclick}" style="cursor:pointer;text-align:left"` : 'style="text-align:left"'}><div class="v" style="color:${c};font-size:25px">${v}</div><div class="l" style="font-size:14px">${l}</div><div class="sub2">${sub}</div></div>` }
  window._rcpMode = function (m) { mode = m; app.innerHTML = render() }
  window._rcpQ = function (v) { q = v; const el = document.getElementById('rcpGrid'); if (el) el.innerHTML = grid() }
  window._rcpSt = function (v) { fSt = v; app.innerHTML = render() }
  window._rcpCat = function (v) { fCat = v; app.innerHTML = render() }
  window._rcpOk = function (v) { fOk = v; app.innerHTML = render() }
  const okBadge = r => r.ok ? `<span style="color:${COL.g};font-weight:800">完整</span>` : `<span style="color:${COL.o};font-weight:800">${esc(r.status)}</span>`
  const contentBadge = r => `<span class="hint" style="font-size:11.5px">材料${r.content.items ? '✓' : '✗'} 步驟${r.content.steps ? '✓' : '✗'} 照片${r.content.photo ? '✓' : '✗'}</span>`
  function grid () {
    const rows = filt()
    if (!rows.length) return '<section><div class="hint" style="padding:18px;text-align:center">沒有符合的食譜</div></section>'
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px">` + rows.map(r => `<div onclick="_rcpOpen('${esc(r.key).replace(/'/g, '&#39;')}')" style="cursor:pointer;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;border-left:3px solid ${r.ok ? COL.g : COL.o}">`
      + `<div style="aspect-ratio:16/9;background:#0E1217;display:flex;align-items:center;justify-content:center;color:var(--muted)">${r.photo ? `<img src="${imgUrl(r.photo)}" style="width:100%;height:100%;object-fit:cover" loading="lazy">` : IC.img}</div>`
      + `<div style="padding:9px 11px"><div style="font-weight:800;font-size:15px">${esc(r.name)}</div><div class="hint" style="font-size:12px">${esc(r.type === 'dish' ? (r.category || '餐點') : (r.station || '未分站'))}・${r.type === 'dish' ? '餐點' : '半成品'}・v${r.pubV || 0}${r.draft ? ' <span style="color:' + COL.o + '">草稿中</span>' : ''}</div>`
      + `<div style="font-size:13px;margin-top:3px">${r.type === 'dish' ? `售價 ${nf(r.price)}・成本 <b>${nf(r.cost)}</b>${r.margin != null ? `・毛利 <b style="color:${COL.g}">${Math.round(r.margin * 100)}%</b>` : ''}` : `產量 ${nf(r.yieldQty)} ${esc(r.yieldUnit)}・<b>${n4(r.perUnit)}</b> 元/${esc(r.yieldUnit)}`}</div>`
      + `<div style="font-size:12.5px;margin-top:2px">${okBadge(r)} ${contentBadge(r)}</div></div></div>`).join('') + `</div>`
  }

  // ── 詳情 ──
  window._rcpOpen = function (key) { const r = rec(key); if (!r) return; openKey = key; dTab = 'items'; editing = null; mult = 1; detail(r) }
  function detail (r) {
    let ov = document.getElementById('rcpOv')
    if (!ov) { ov = document.createElement('div'); ov.id = 'rcpOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:14px'; ov.onclick = () => { ov.remove(); openKey = null }; document.body.appendChild(ov) }
    const tabs = [['items', `材料 ${(r.items || []).length}`], ['steps', `步驟 ${(editing ? editing.steps : r.steps || []).length}`], ['cost', '成本'], ['versions', `版本 ${r.nVersions || 0}`]]
    let h = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:860px;width:100%;max-height:92vh;overflow:auto;padding:14px 16px">`
    h += `<div style="display:flex;gap:12px;align-items:flex-start"><div style="width:72px;height:72px;border-radius:12px;background:#0E1217;display:flex;align-items:center;justify-content:center;color:var(--muted);overflow:hidden;flex:0 0 auto;position:relative">${r.photo ? `<img src="${imgUrl(r.photo)}" style="width:100%;height:100%;object-fit:cover">` : IC.img}${can() ? `<label style="position:absolute;inset:0;cursor:pointer"><input type="file" accept="image/*" style="display:none" onchange="_rcpPhoto('${esc(r.key)}',this)"></label>` : ''}</div>`
      + `<div style="flex:1;min-width:0"><div style="font-size:19px;font-weight:800;color:var(--ink)">${esc(r.name)} <span class="hint" style="font-size:13px;font-weight:600">${esc(r.code || '')}</span></div>`
      + `<div class="hint" style="margin-top:2px">${r.type === 'dish' ? '餐點・' + esc(r.category || '') : '半成品・' + (r.station ? esc(r.station) : '未分站')}・v${r.pubV || 0}${r.draft ? ' <span style="color:' + COL.o + '">有草稿 v' + r.draft.v + '</span>' : ''}${r.minutes ? '・' + r.minutes + ' 分鐘' : ''}</div>`
      + `<div style="margin-top:4px;font-size:15px">${r.type === 'dish' ? `售價 ${nf(r.price)}・食材成本 <b style="font-size:18px;color:${r.ok ? COL.g : COL.o}">${nf(r.cost)}</b>${r.margin != null ? `・毛利率 <b style="color:${COL.g}">${Math.round(r.margin * 100)}%</b>` : '・毛利率 <span class="hint">不完整不顯示</span>'}${r.abCost != null ? ` <span class="hint">（阿桑 view：${nf(r.abCost)}）</span>` : ''}` : `整批 <b style="font-size:18px;color:${r.ok ? COL.g : COL.o}">${nf(r.cost)}</b> 元 ÷ 產量 ${nf(r.yieldQty)} ${esc(r.yieldUnit)} ＝ <b>${n4(r.perUnit)}</b> 元/${esc(r.yieldUnit)}`} ${okBadge(r)}${!r.ok ? ` <span class="hint">已知成本（下限）；缺口：${esc((r.gaps || []).slice(0, 3).join('；'))}</span>` : ''}</div></div>`
      + `<div style="display:flex;flex-direction:column;gap:6px"><button class="mini" onclick="document.getElementById('rcpOv').remove();openKey=null">${IC.x}</button><button class="mini on" onclick="_rcpCook('${esc(r.key)}')">${IC.play} 製作</button></div></div>`
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 10px;align-items:center">` + tabs.map(([k, l]) => `<button class="mini ${dTab === k ? 'on' : ''}" onclick="_rcpTab('${k}')">${l}</button>`).join('')
      + (r.type === 'prep' && can() ? `<span style="margin-left:auto;display:flex;gap:6px;align-items:center"><span class="hint">工作站</span><input id="rcpStation" value="${esc(r.station)}" list="rcpStList" placeholder="Pizza／內場／吧台" style="width:110px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><datalist id="rcpStList">${['Pizza', '內場', '吧台', ...(RD.stations || [])].filter((v, i, a) => a.indexOf(v) === i).map(s => `<option value="${esc(s)}">`).join('')}</datalist><button class="mini" onclick="_rcpMeta('${esc(r.key)}')">${IC.check}</button></span>` : '') + `</div><div id="rcpTabBody">${tabBody(r)}</div></div>`
    ov.innerHTML = h
  }
  window._rcpTab = function (k) { dTab = k; const r = rec(openKey); const el = document.getElementById('rcpTabBody'); if (el && r) el.innerHTML = tabBody(r) }
  function tabBody (r) { return dTab === 'items' ? itemsTab(r) : (dTab === 'steps' ? stepsTab(r) : (dTab === 'cost' ? costTab(r) : versionsTab(r))) }

  // 材料：換算鏈＋半成品樹
  function lineRow (L, depth) {
    const st = LST[L.status] || ['', COL.m]
    const sub = L.kind === 'sub' ? rec(L.subKey) : null
    let h = `<div style="padding:7px 10px 7px ${10 + depth * 18}px;border-top:1px solid var(--line);font-size:14px">`
      + `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${depth ? '<span class="hint">└</span>' : ''}${sub ? `<span style="color:${COL.p}">${IC.tree}</span>` : ''}<b>${esc(L.name)}</b><span class="hint">${esc(L.code || '')}</span><span>${nf((L.qty || 0) * mult)} ${esc(L.unit)}</span>`
      + `<span style="margin-left:auto;font-weight:800;color:${L.cost != null ? 'var(--ink)' : COL.m}">${L.cost != null ? nf(L.cost * mult) + ' 元' : '—'}</span>${st[0] ? `<span style="font-size:11.5px;color:${st[1]};border:1px solid ${st[1]};border-radius:6px;padding:0 6px">${st[0]}</span>` : ''}</div>`
      + `<div class="hint" style="font-size:12px;margin-top:2px;line-height:1.6">${esc(L.chain || '')}${L.priceSrc ? `・${esc(L.priceSrc)}` : ''}${L.cardId ? ` <span onclick="event.stopPropagation();_rcpCard('${esc(L.cardId)}')" style="color:var(--pdark);cursor:pointer;text-decoration:underline">物料卡</span>` : ''}${sub ? ` <span onclick="event.stopPropagation();_rcpToggle('${esc(L.subKey)}')" style="color:var(--pdark);cursor:pointer;text-decoration:underline">${expanded.has(L.subKey) ? '收合' : '展開'}半成品</span>` : ''}</div></div>`
    if (sub && expanded.has(L.subKey) && depth < 5) h += (sub.lines || []).map(x => lineRow(x, depth + 1)).join('')
    return h
  }
  const expanded = new Set()
  window._rcpToggle = function (k) { if (expanded.has(k)) expanded.delete(k); else expanded.add(k); _rcpTab('items') }
  window._rcpCard = function (id) { if (window._mcOpen) { try { if (!window.matcardView) return; } catch (_) {} } alert('物料卡在「物料庫 → 物料卡」分頁，卡 ID：' + id) }
  function itemsTab (r) {
    const lines = r.lines || []
    let h = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px"><span class="hint">份量倍率（只影響顯示，不改食譜）</span>` + [0.5, 1, 2, 3].map(m => `<button class="mini ${mult === m ? 'on' : ''}" onclick="_rcpMult(${m})">×${m}</button>`).join('') + `<input type="number" step="0.1" min="0.1" value="${mult}" onchange="_rcpMult(this.value)" style="width:70px;border:1px solid var(--line);border-radius:8px;padding:5px 8px">`
      + (r.type === 'dish' ? `<span class="hint" style="margin-left:auto">行＝10-06 快照；成本＝我們引擎（代碼→供應品／半成品）</span>` : '') + `</div>`
    h += `<div style="background:var(--soft);border-radius:10px;overflow:hidden">` + (lines.length ? lines.map(L => lineRow(L, 0)).join('') : '<div class="hint" style="padding:12px">沒有材料行</div>') + `</div>`
    h += `<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:14px"><span class="hint">行成本由系統算，不可手填（規格）</span><b>合計 ${nf((r.cost || 0) * mult)} 元${r.type === 'prep' ? `（${nf((r.yieldQty || 0) * mult)} ${esc(r.yieldUnit)}）` : ''}</b></div>`
    if (can() && r.type === 'prep') h += `<div class="hint" style="margin-top:8px">要改材料／用量／產量：到「版本」建新草稿編輯後發布（已發布版本不可覆寫）。</div>`
    return h
  }
  window._rcpMult = function (m) { mult = Math.max(0.1, Number(m) || 1); _rcpTab(dTab) }

  // 步驟（草稿可編）
  function curSteps (r) { return editing ? editing.steps : (r.draft && !r.steps.length ? r.draft.steps : r.steps) || [] }
  function stepsTab (r) {
    const steps = curSteps(r)
    const items = (editing ? editing.items : r.items) || []
    let h = ''
    if (!editing) {
      h += `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><span class="hint">${steps.length ? `v${r.draft && !r.steps.length ? r.draft.v + '（草稿）' : r.pubV} 共 ${steps.length} 步` : '還沒有步驟：這是要補的內容（建議依工作站指定負責人，先補在賣菜用到的備料）'}</span>`
        + (can() ? `<button class="mini on" style="margin-left:auto" onclick="_rcpEditSteps('${esc(r.key)}')">${IC.plus} ${r.draft ? '編輯草稿步驟' : '建草稿補步驟'}</button>` : '') + `</div>`
      if (!steps.length) return h
      return h + `<div style="display:flex;flex-direction:column;gap:8px">` + steps.map((s, i) => stepCard(s, i, items, false)).join('') + `</div>`
    }
    h += `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;background:var(--psoft);border-radius:10px;padding:8px 10px"><b>編輯草稿 v${editing.v}</b><span class="hint">拖曳左側把手排序；每步可選相關材料、上傳照片、設計時</span><span style="margin-left:auto;display:flex;gap:6px"><button class="mini" onclick="_rcpStepAdd()">${IC.plus} 加一步</button><button class="mini on" onclick="_rcpStepsSave('${esc(r.key)}')">${IC.check} 完成（存草稿）</button><button class="mini" onclick="_rcpEditCancel()">${IC.x}</button></span></div>`
    h += `<div id="rcpStepList" style="display:flex;flex-direction:column;gap:8px">` + editing.steps.map((s, i) => stepCard(s, i, items, true)).join('') + `</div>`
    setTimeout(() => { try { const el = document.getElementById('rcpStepList'); if (el && window.Sortable && !el._srt) el._srt = Sortable.create(el, { handle: '.rcpHandle', animation: 120, onEnd: ev => { const a = editing.steps.splice(ev.oldIndex, 1)[0]; editing.steps.splice(ev.newIndex, 0, a); _rcpTab('steps') } }) } catch (_) {} }, 50)
    return h
  }
  function stepCard (s, i, items, edit) {
    const media = (s.media || []).map(m => /^recipe\//.test(m) ? `<img src="${imgUrl(m)}" style="height:72px;border-radius:8px;object-fit:cover" loading="lazy">` : `<a href="${esc(m)}" target="_blank" class="hint" style="font-size:12px">影片／連結</a>`).join(' ')
    const its = (s.itemCodes || []).map(c => { const it = items.find(x => (x.code || x.name) === c); return it ? `<span style="font-size:11.5px;border:1px solid var(--line);border-radius:6px;padding:0 6px">${esc(it.name)} ${nf(it.qty * mult)}${esc(it.unit)}</span>` : '' }).join(' ')
    if (!edit) return `<div style="background:var(--soft);border-radius:10px;padding:10px 12px"><div style="display:flex;gap:8px;align-items:center"><b style="color:var(--pdark)">${i + 1}</b><b>${esc(s.title || '（未命名）')}</b>${s.timerSec ? `<span class="hint">${IC.clock} ${fmtT(s.timerSec)}</span>` : ''}</div><div style="margin-top:4px;white-space:pre-wrap;line-height:1.6">${esc(s.desc || '')}</div>${its ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${its}</div>` : ''}${media ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${media}</div>` : ''}</div>`
    return `<div style="background:var(--soft);border-radius:10px;padding:10px 12px"><div style="display:flex;gap:8px;align-items:center"><span class="rcpHandle" style="cursor:grab;color:var(--muted)">${IC.list}</span><b style="color:var(--pdark)">${i + 1}</b><input value="${esc(s.title)}" placeholder="步驟標題" onchange="_rcpStepF(${i},'title',this.value)" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:6px 8px"><button class="mini" onclick="_rcpStepMove(${i},-1)">${IC.up}</button><button class="mini" onclick="_rcpStepMove(${i},1)">${IC.dn}</button><button class="mini" style="color:var(--red)" onclick="_rcpStepDel(${i})">${IC.trash}</button></div>`
      + `<textarea placeholder="說明（怎麼做、注意什麼）" onchange="_rcpStepF(${i},'desc',this.value)" style="width:100%;margin-top:6px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;min-height:60px">${esc(s.desc)}</textarea>`
      + `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><span class="hint">${IC.clock} 計時</span><input type="number" min="0" value="${s.timerSec || 0}" onchange="_rcpStepF(${i},'timerSec',this.value)" style="width:80px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><span class="hint">秒</span><label class="mini" style="cursor:pointer">${IC.cam} 照片<input type="file" accept="image/*" style="display:none" onchange="_rcpStepMedia(${i},this)"></label><input placeholder="影片連結（貼網址）" onchange="_rcpStepLink(${i},this.value)" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"></div>`
      + `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap"><span class="hint" style="font-size:12px">相關材料：</span>` + items.map(it => { const c = it.code || it.name; const on = (s.itemCodes || []).includes(c); return `<button class="mini ${on ? 'on' : ''}" style="padding:2px 8px;font-size:12px" onclick="_rcpStepItem(${i},'${esc(c).replace(/'/g, '&#39;')}')">${esc(it.name)}</button>` }).join('') + `</div>`
      + (media ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${media}</div>` : '') + `</div>`
  }
  const fmtT = s => s >= 60 ? `${Math.floor(s / 60)} 分${s % 60 ? ' ' + (s % 60) + ' 秒' : ''}` : `${s} 秒`
  window._rcpEditSteps = async function (key) {
    const r = rec(key); if (!r) return
    let d = r.draft
    if (!d) { const j = await post({ op: 'draft', key, base: { items: r.items, yieldQty: r.yieldQty, yieldUnit: r.yieldUnit } }); if (!j || !j.ok) return; await rcpFetch(); const r2 = rec(key); d = r2 && r2.draft; if (!d) return }
    editing = { v: d.v, steps: JSON.parse(JSON.stringify(d.steps || [])), items: d.items || r.items, baseAt: d.editedAt || '' }
    dTab = 'steps'; detail(rec(key))
  }
  window._rcpEditCancel = function () { editing = null; _rcpTab('steps') }
  window._rcpStepAdd = function () { editing.steps.push({ title: '', desc: '', media: [], timerSec: 0, itemCodes: [] }); _rcpTab('steps') }
  window._rcpStepF = function (i, k, v) { if (editing.steps[i]) editing.steps[i][k] = k === 'timerSec' ? Number(v) || 0 : v }
  window._rcpStepMove = function (i, d) { const j = i + d; if (j < 0 || j >= editing.steps.length) return; const a = editing.steps.splice(i, 1)[0]; editing.steps.splice(j, 0, a); _rcpTab('steps') }
  window._rcpStepDel = function (i) { editing.steps.splice(i, 1); _rcpTab('steps') }
  window._rcpStepItem = function (i, c) { const s = editing.steps[i]; s.itemCodes = s.itemCodes || []; const k = s.itemCodes.indexOf(c); if (k >= 0) s.itemCodes.splice(k, 1); else s.itemCodes.push(c); _rcpTab('steps') }
  window._rcpStepLink = function (i, v) { v = String(v || '').trim(); if (!/^https?:\/\//.test(v)) return; editing.steps[i].media = [...(editing.steps[i].media || []), v]; _rcpTab('steps') }
  window._rcpStepMedia = async function (i, input) { const f = input.files && input.files[0]; if (!f) return; const dataUrl = await shrink(f, 1200, 0.85); const j = await post({ op: 'media', key: openKey, dataUrl }); if (j && j.ok) { editing.steps[i].media = [...(editing.steps[i].media || []), j.path]; _rcpTab('steps') } }
  window._rcpStepsSave = async function (key) { const j = await post({ op: 'edit', key, v: editing.v, steps: editing.steps, baseAt: editing.baseAt }); if (j && j.ok) { editing = null; await rcpFetch(); dTab = 'versions'; const r = rec(key); if (r) detail(r) } }
  window._rcpPhoto = async function (key, input) { const f = input.files && input.files[0]; if (!f) return; const dataUrl = await shrink(f, 1200, 0.85); const j = await post({ op: 'photo', key, dataUrl }); if (j && j.ok) await rcpFetch() }
  window._rcpMeta = async function (key) { const v = (document.getElementById('rcpStation') || {}).value || ''; const j = await post({ op: 'meta', key, station: v.trim() }); if (j && j.ok) await rcpFetch() }
  function shrink (file, max, q) { return new Promise(res => { const img = new Image(); const u = URL.createObjectURL(file); img.onload = () => { const r = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u); res(cv.toDataURL('image/jpeg', q)) }; img.src = u }) }

  // 成本：走勢＋差異標記
  function costTab (r) {
    const sn = r.snaps || []
    let h = `<div class="hint" style="margin-bottom:6px">每小時同步後，價格／換算／配方有變就寫一筆成本快照（永不改寫），並標出是哪一行、因為什麼、變多少。</div>`
    if (!sn.length) return h + `<div class="hint">還沒有快照（第一次會在下一個整點同步後出現）。目前成本 ${nf(r.cost)} 元。</div>`
    const vs = sn.map(s => s.cost || 0), mx = Math.max(...vs), mn = Math.min(...vs), rg = (mx - mn) || 1, W = 640, H = 140, P = 26
    const X = i => P + (sn.length === 1 ? 0.5 : i / (sn.length - 1)) * (W - P * 2), Y = v => H - P - (v - mn) / rg * (H - P * 2)
    h += `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:150px"><polyline points="${sn.map((s, i) => `${X(i).toFixed(1)},${Y(s.cost || 0).toFixed(1)}`).join(' ')}" fill="none" stroke="${COL.b}" stroke-width="2"/>${sn.map((s, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(s.cost || 0).toFixed(1)}" r="4" fill="${s.ok ? COL.g : COL.o}"><title>${esc(s.at.slice(5, 16))} ${nf(s.cost)}</title></circle>`).join('')}<text x="${P}" y="12" font-size="10" fill="#8C98A8">最高 ${nf(mx)}</text><text x="${P}" y="${H - 6}" font-size="10" fill="#8C98A8">最低 ${nf(mn)}</text></svg>`
    h += `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">` + sn.slice().reverse().slice(0, 20).map((s, i, arr) => { const prev = arr[i + 1]; const d = prev ? (s.cost || 0) - (prev.cost || 0) : 0; return `<div style="background:var(--soft);border-radius:8px;padding:6px 10px;font-size:13.5px"><b>${esc(s.at.slice(5, 16).replace('T', ' '))}</b> ${nf(s.cost)} 元 ${prev ? `<b style="color:${d > 0 ? COL.r : COL.g}">${d > 0 ? '+' : ''}${nf(d)}</b>` : '<span class="hint">起始</span>'} <span class="hint">v${s.v || 0}・${esc(s.status)}</span>${(s.diff || []).length ? `<div class="hint" style="margin-top:2px">${s.diff.map(x => `${esc(x.why)}（${nf(x.from)}→${nf(x.to)}）`).join('；')}</div>` : ''}</div>` }).join('') + `</div>`
    return h
  }
  // 版本
  function versionsTab (r) {
    let h = `<div class="hint" style="margin-bottom:8px">新增＝草稿；發布後不可直接覆寫，要改就建新草稿。發布前檢查：材料可解析、產量 > 0、無循環引用。</div>`
    const d = r.draft
    if (can() && r.type === 'prep') {
      if (!d) h += `<button class="mini on" onclick="_rcpNewDraft('${esc(r.key)}')">${IC.plus} 建新草稿（複製目前版本）</button>`
      else {
        h += `<section style="padding:10px 12px;margin:0 0 10px;background:var(--psoft)"><div style="font-weight:800">草稿 v${d.v} <span class="hint">${esc(d.by)} ${esc(String(d.editedAt || d.at || '').slice(5, 16).replace('T', ' '))}</span></div>`
        h += `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><span class="hint">產量</span><input id="rcpYq" type="number" step="any" value="${d.yieldQty || ''}" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><input id="rcpYu" value="${esc(d.yieldUnit || '')}" placeholder="g/ml/份" style="width:70px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><span class="hint">實際可用產量（耗損已反映在產量裡，不另加）</span></div>`
        h += `<div style="margin-top:8px"><div class="hint">材料（代碼・品名・用量・單位；代碼要對得到物料或半成品）</div><div id="rcpDItems" style="display:flex;flex-direction:column;gap:4px;margin-top:4px">` + (d.items || []).map((it, i) => `<div style="display:flex;gap:6px;align-items:center"><input value="${esc(it.code)}" placeholder="代碼" onchange="_rcpDItem(${i},'code',this.value)" style="width:100px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><input value="${esc(it.name)}" placeholder="品名" onchange="_rcpDItem(${i},'name',this.value)" style="flex:1;min-width:100px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><input type="number" step="any" value="${it.qty}" onchange="_rcpDItem(${i},'qty',this.value)" style="width:80px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><input value="${esc(it.unit)}" onchange="_rcpDItem(${i},'unit',this.value)" style="width:56px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><button class="mini" style="color:var(--red)" onclick="_rcpDItemDel(${i})">${IC.trash}</button></div>`).join('') + `</div><button class="mini" style="margin-top:6px" onclick="_rcpDItemAdd()">${IC.plus} 加材料</button></div>`
        h += `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="mini on" onclick="_rcpDraftSave('${esc(r.key)}',${d.v})">${IC.check} 存草稿</button><button class="mini" onclick="_rcpPublish('${esc(r.key)}',${d.v})">發布 v${d.v}</button><button class="mini" style="color:var(--red)" onclick="_rcpDiscard('${esc(r.key)}',${d.v})">捨棄草稿</button></div></section>`
        window._rcpDraftObj = d
      }
    }
    h += `<div style="margin-top:10px"><div style="font-weight:800">v0 <span class="hint">阿桑系統原始配方（${esc(String(r.updatedAt || '').slice(0, 10))}）：${(r.liveItems || r.items || []).length} 行、產量 ${nf((r.liveYield || {}).qty || r.yieldQty)} ${esc((r.liveYield || {}).unit || r.yieldUnit)}</span></div></div>`
    if (r.pubV) h += `<div style="margin-top:6px"><div style="font-weight:800;color:${COL.g}">v${r.pubV} 已發布 <span class="hint">目前生效</span></div></div>`
    return h
  }
  window._rcpNewDraft = async function (key) { const r = rec(key); const j = await post({ op: 'draft', key, base: { items: r.items, yieldQty: r.yieldQty, yieldUnit: r.yieldUnit } }); if (j && j.ok) { await rcpFetch(); dTab = 'versions'; const r2 = rec(key); if (r2) detail(r2) } }
  window._rcpDItem = function (i, k, v) { const d = window._rcpDraftObj; if (d && d.items[i]) d.items[i][k] = k === 'qty' ? Number(v) : v }
  window._rcpDItemDel = function (i) { const d = window._rcpDraftObj; d.items.splice(i, 1); _rcpTab('versions') }
  window._rcpDItemAdd = function () { const d = window._rcpDraftObj; d.items.push({ code: '', name: '', qty: 0, unit: 'g' }); _rcpTab('versions') }
  window._rcpDraftSave = async function (key, v) { const d = window._rcpDraftObj; const j = await post({ op: 'edit', key, v, items: d.items, yieldQty: (document.getElementById('rcpYq') || {}).value, yieldUnit: (document.getElementById('rcpYu') || {}).value, baseAt: d.editedAt || '' }); if (j && j.ok) { await rcpFetch(); dTab = 'versions'; const r = rec(key); if (r) detail(r) } }
  window._rcpPublish = async function (key, v) { if (!confirm('發布 v' + v + '？發布後不可直接覆寫（要改就建新草稿）。')) return; const j = await post({ op: 'publish', key, v }); if (j && j.ok) { await rcpFetch(); dTab = 'versions'; const r = rec(key); if (r) detail(r) } }
  window._rcpDiscard = async function (key, v) { if (!confirm('捨棄草稿 v' + v + '？')) return; const j = await post({ op: 'discard', key, v }); if (j && j.ok) { editing = null; await rcpFetch(); const r = rec(key); if (r) detail(r) } }

  // ── 製作模式 ──
  window._rcpCook = function (key) { const r = rec(key); if (!r) return; cook = { key, i: 0, drawer: false }; drawCook() ; if (timerTick) clearInterval(timerTick); timerTick = setInterval(() => { try { const el = document.getElementById('rcpTimer'); if (el) el.textContent = timerText() } catch (_) {} }, 500) }
  const tKey = (key, i) => 'rcpTimer:' + key + ':' + i
  function timerText () { const r = rec(cook.key); const s = (r.steps || [])[cook.i] || {}; const end = Number(localStorage.getItem(tKey(cook.key, cook.i)) || 0); if (!end) return s.timerSec ? fmtT(s.timerSec) : ''; const left = Math.max(0, Math.round((end - Date.now()) / 1000)); return left ? fmtT(left) : '時間到' }
  window._rcpTimerStart = function () { const r = rec(cook.key); const s = (r.steps || [])[cook.i] || {}; const k = tKey(cook.key, cook.i); if (localStorage.getItem(k)) localStorage.removeItem(k); else localStorage.setItem(k, String(Date.now() + (s.timerSec || 0) * 1000)); drawCook() }
  window._rcpCookGo = function (d) { const r = rec(cook.key); const n = (r.steps || []).length; cook.i = Math.max(0, Math.min(n - 1, cook.i + d)); drawCook() }
  window._rcpCookJump = function (i) { cook.i = i; drawCook() }
  window._rcpCookDrawer = function () { cook.drawer = !cook.drawer; drawCook() }
  window._rcpCookClose = function () { const el = document.getElementById('rcpCook'); if (el) el.remove(); cook = null; if (timerTick) { clearInterval(timerTick); timerTick = null } }
  function drawCook () {
    const r = rec(cook.key); if (!r) return
    const steps = r.steps || [], s = steps[cook.i] || null, items = r.items || []
    const mobile = window.innerWidth < 760
    let el = document.getElementById('rcpCook')
    if (!el) { el = document.createElement('div'); el.id = 'rcpCook'; el.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:90;display:flex;flex-direction:column'; document.body.appendChild(el) }
    const matList = `<div style="display:flex;flex-direction:column;gap:6px">` + items.map(it => { const hot = s && (s.itemCodes || []).includes(it.code || it.name); return `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:8px;background:${hot ? 'var(--psoft)' : 'var(--soft)'};border:1px solid ${hot ? 'var(--primary)' : 'var(--line)'};font-size:15px"><span>${esc(it.name)}</span><b>${nf((it.qty || 0) * mult)} ${esc(it.unit)}</b></div>` }).join('') + `</div>`
    const head = `<div style="display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)"><b style="font-size:17px">${esc(r.name)}</b><span class="hint">製作模式・倍率 ×${mult}${r.type === 'prep' ? `（${nf((r.yieldQty || 0) * mult)} ${esc(r.yieldUnit)}）` : ''}</span><span style="margin-left:auto;display:flex;gap:6px">` + [0.5, 1, 2].map(m => `<button class="mini ${mult === m ? 'on' : ''}" onclick="mult=${m};drawCook&&0;_rcpMultCook(${m})">×${m}</button>`).join('') + `<button class="mini" onclick="_rcpCookClose()">${IC.x} 離開</button></span></div>`
    const stepView = s ? `<div style="font-size:13px;color:var(--muted)">第 ${cook.i + 1}／${steps.length} 步</div><div style="font-size:22px;font-weight:800;margin:4px 0 8px">${esc(s.title || '（未命名）')}</div><div style="font-size:17px;line-height:1.7;white-space:pre-wrap">${esc(s.desc || '')}</div>${(s.media || []).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${s.media.map(m => /^recipe\//.test(m) ? `<img src="${imgUrl(m)}" style="max-height:220px;border-radius:10px">` : `<a href="${esc(m)}" target="_blank" class="mini">影片／連結</a>`).join('')}</div>` : ''}${(s.itemCodes || []).length ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${s.itemCodes.map(c => { const it = items.find(x => (x.code || x.name) === c); return it ? `<span style="border:1px solid var(--primary);background:var(--psoft);border-radius:8px;padding:3px 9px;font-size:14px">${esc(it.name)} <b>${nf(it.qty * mult)} ${esc(it.unit)}</b></span>` : '' }).join('')}</div>` : ''}${s.timerSec ? `<div style="margin-top:14px;display:flex;gap:10px;align-items:center"><button class="mini on" style="font-size:16px;padding:10px 16px" onclick="_rcpTimerStart()">${IC.clock} ${localStorage.getItem(tKey(cook.key, cook.i)) ? '重設' : '開始計時'}</button><b id="rcpTimer" style="font-size:26px;font-variant-numeric:tabular-nums">${timerText()}</b></div>` : ''}` : `<div class="hint" style="padding:20px">這份食譜還沒有步驟。先看左側材料，之後到「步驟」補上。</div>`
    const stepList = `<div style="display:flex;flex-direction:column;gap:4px">` + steps.map((x, i) => `<div onclick="_rcpCookJump(${i})" style="cursor:pointer;padding:8px 10px;border-radius:8px;background:${i === cook.i ? 'var(--psoft)' : 'transparent'};border:1px solid ${i === cook.i ? 'var(--primary)' : 'var(--line)'}"><b style="color:var(--pdark)">${i + 1}</b> ${esc(x.title || '（未命名）')}${x.timerSec ? ` <span class="hint">${fmtT(x.timerSec)}</span>` : ''}</div>`).join('') + `</div>`
    const nav = `<div style="display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line);align-items:center"><button class="mini" style="flex:1;padding:12px;font-size:16px" onclick="_rcpCookGo(-1)" ${cook.i <= 0 ? 'disabled' : ''}>${IC.left} 上一步</button>${mobile ? `<button class="mini" style="padding:12px" onclick="_rcpCookDrawer()">${IC.list} 材料</button>` : ''}<button class="mini on" style="flex:1;padding:12px;font-size:16px" onclick="_rcpCookGo(1)" ${cook.i >= steps.length - 1 ? 'disabled' : ''}>下一步 ${IC.right}</button></div>`
    if (mobile) {
      el.innerHTML = head + `<div style="flex:1;overflow:auto;padding:14px 16px">${stepView}${steps.length > 1 ? `<details style="margin-top:14px"><summary class="hint">全部步驟</summary>${stepList}</details>` : ''}</div>` + (cook.drawer ? `<div onclick="_rcpCookDrawer()" style="position:absolute;inset:0;background:rgba(0,0,0,.5)"><div onclick="event.stopPropagation()" style="position:absolute;left:0;right:0;bottom:0;max-height:70vh;overflow:auto;background:var(--card);border-radius:16px 16px 0 0;padding:14px 16px"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><b>材料（×${mult}）</b><button class="mini" onclick="_rcpCookDrawer()">${IC.x}</button></div>${matList}</div></div>` : '') + nav
    } else {
      el.innerHTML = head + `<div style="flex:1;display:grid;grid-template-columns:320px 1fr 260px;gap:0;overflow:hidden"><div style="overflow:auto;padding:14px 16px;border-right:1px solid var(--line)"><b>材料（×${mult}）</b><div style="margin-top:8px">${matList}</div></div><div style="overflow:auto;padding:18px 24px">${stepView}</div><div style="overflow:auto;padding:14px 16px;border-left:1px solid var(--line)"><b>步驟</b><div style="margin-top:8px">${stepList}</div></div></div>` + nav
    }
  }
  window._rcpMultCook = function (m) { mult = m; drawCook() }

  async function post (body) {
    const r = await fetch('/api/mail-sync?recipes=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
    const j = await r.json().catch(() => ({ ok: false, error: '連線問題' }))
    if (!j.ok) alert(j.error || '沒成功')
    return j
  }
  try { if ((location.hash || '').replace(/^#/, '').toLowerCase().startsWith('rcp')) setTimeout(() => { try { rcpLoad() } catch (_) {} }, 300) } catch (_) {}
})()
