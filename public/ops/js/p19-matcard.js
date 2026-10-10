// 🗂 /prep 第 19 塊（v4.70.33，2026-10-10）：產品與成本模組｜批次 2「物料庫＋物料卡」
// 規格 §3：列表（照片/料號/品名/類型/分類/主要廠商/成本基準價/完整狀態；篩選 品牌/類型/分類/存放/廠商/狀態/缺換算/缺價；搜尋含舊代碼；包材照片牆）
//          物料卡五分頁：基本資料／供應品與價格（每代碼一列、主要來源、走勢、查當時價）／單位換算／被使用於／紀錄
// 資料 ?matcard=（api/_matcard.js）：供應品＝阿桑即時主檔；本頁只寫「人做的決定」。UI 慣例：單色線條圖示、不用 prompt。
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 100) / 100).toLocaleString()
  const n4 = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 1e4) / 1e4).toString()
  const I = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto">${d}</svg>`
  const IC = { card: I('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="15" x2="12" y2="15"/>'), check: I('<polyline points="20 6 9 17 4 12"/>'), x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'), img: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'), merge: I('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'), star: I('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'), grid: I('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'), list: I('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'), undo: I('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>'), cam: I('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>') }
  const COL = { b: '#4DA3FF', g: '#3DBE6C', o: '#E8A657', y: '#E8C14E', p: '#B48CF2', r: '#F07373', m: '#8C98A8' }
  const CONV_ST = { confirmed: ['已確認', COL.g], metric: ['公制', COL.g], snapshot: ['快照未確認', COL.y], suggested: ['建議', COL.o], none: ['缺', COL.r] }
  const SRC = { confirmed: '已確認價', order: '最近叫貨', master: '主檔現價', none: '無價', quote: '報價' }
  let MC = null, f = { brand: 'all', type: 'all', cat: 'all', store: 'all', sup: 'all', status: '啟用', gap: 'all', q: '', wall: false }, openId = null, cTab = 'basic', sel = new Set(), form = null, asOfDate = '', loading = false

  window.matcardFetch = async function () {
    if (loading) return; loading = true
    try { const meQ = TK() ? '&me=' + encodeURIComponent(TK()) : ''; const r = await fetch('/api/mail-sync?matcard=' + encodeURIComponent(K) + meQ + '&r=' + Date.now()); MC = await r.json() } catch (e) { MC = { ok: false, error: '連線問題' } }
    loading = false; paint()
  }
  window.matcardView = function () { if (!MC) { matcardFetch(); return '<section><div class="hint" style="padding:22px">載入物料卡中…</div></section>' } return render() }
  function paint () { const el = document.getElementById('matBody'); if (el && window._mSubIs && _mSubIs('card')) el.innerHTML = render(); if (openId) { const c = card(openId); if (c) { drawer(c, true); loadDetail(openId) } } }
  window.matcardRefresh = function () { MC = null; matcardFetch() }
  const card = id => (MC.cards || []).find(c => c.id === id)
  const sup = k => (MC.supplies || {})[k]

  function filt () {
    const q = f.q.toLowerCase()
    return (MC.cards || []).filter(c => {
      if (f.brand !== 'all' && !(c.brands || []).includes(f.brand)) return false
      if (f.type !== 'all' && c.type !== f.type) return false
      if (f.cat !== 'all' && !(c.cats || []).includes(f.cat)) return false
      if (f.store !== 'all' && c.store !== f.store) return false
      if (f.sup !== 'all' && !(c.suppliers || []).includes(f.sup)) return false
      if (f.status !== 'all' && c.status !== f.status) return false
      if (f.gap === 'noconv' && !c.gaps.some(g => /換算/.test(g))) return false
      if (f.gap === 'noprice' && !c.gaps.includes('缺價')) return false
      if (f.gap === 'merged' && c.supplies.length < 2) return false
      if (q && !([c.name, c.displaySku, ...(c.aliases || []), ...(c.suppliers || [])].join(' ').toLowerCase().includes(q))) return false
      return true
    })
  }
  function chips (key, list, all) {
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"><button class="mini ${f[key] === 'all' ? 'on' : ''}" onclick="_mcF('${key}','all')">${all || '全部'}</button>` + list.map(v => `<button class="mini ${f[key] === v ? 'on' : ''}" onclick="_mcF('${key}','${esc(v).replace(/'/g, '&#39;')}')">${esc(v)}</button>`).join('') + '</div>'
  }
  window._mcF = function (k, v) { f[k] = v; repaintList() }
  window._mcQ = function (v) { f.q = v; repaintList() }
  window._mcWall = function () { f.wall = !f.wall; repaintList() }
  function repaintList () { const el = document.getElementById('mcList'); if (el) el.innerHTML = list(); const el2 = document.getElementById('mcFilters'); if (el2) el2.innerHTML = filters() }

  function render () {
    if (!MC.ok) return '<section><div class="err">' + esc(MC.error || '讀不到物料卡') + '</div></section>'
    const total = (MC.cards || []).length, inc = (MC.cards || []).filter(c => c.status === '啟用' && !c.complete).length
    let h = `<section style="padding:14px 16px"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${IC.card} 物料庫・物料卡</h2>`
      + `<span class="hint">一張卡＝一種東西；底下可掛多個代碼（供應品），各代碼保留自己的價格歷史</span>`
      + `<span style="margin-left:auto;display:flex;gap:6px"><button class="mini" onclick="matcardRefresh()">${IC.undo} 重新整理</button></span></div>`
    h += `<div class="hint" style="margin-top:8px;line-height:1.7">${nf(total)} 張卡（已合併 ${nf(MC.nMerged)} 個代碼）・啟用中成本不完整 <b style="color:${inc ? COL.o : COL.g}">${nf(inc)}</b> 張；主檔＝阿桑即時（${esc(String(MC.masterUpdatedAt || '').slice(5, 16).replace('T', ' '))}），換算建議來自規格文字＋10-06 快照，<b>人確認才算完整</b></div></section>`
    h += `<section style="padding:12px"><div id="mcFilters">${filters()}</div></section>`
    h += `<div id="mcList">${list()}</div>`
    return h
  }
  function filters () {
    const fc = MC.facets || {}
    let h = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><input value="${esc(f.q)}" oninput="_mcQ(this.value)" placeholder="搜尋品名／料號／舊代碼／廠商…" style="flex:1;min-width:180px;border:1px solid var(--line);border-radius:10px;padding:9px 12px">`
      + `<button class="mini ${f.wall ? 'on' : ''}" onclick="_mcWall()">${f.wall ? IC.list : IC.grid} ${f.wall ? '清單' : '照片牆'}</button></div>`
    h += `<div class="hint" style="font-size:12px">品牌</div>` + chips('brand', fc.brands || [])
    h += `<div class="hint" style="font-size:12px">類型</div>` + chips('type', fc.types || [])
    h += `<div class="hint" style="font-size:12px">狀態／缺口</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">`
      + ['啟用', '停用', 'all'].map(v => `<button class="mini ${f.status === v ? 'on' : ''}" onclick="_mcF('status','${v}')">${v === 'all' ? '含停用' : v}</button>`).join('')
      + `<span style="width:8px"></span>` + [['all', '全部'], ['noconv', '缺／未確認換算'], ['noprice', '缺價'], ['merged', '已合併']].map(([v, l]) => `<button class="mini ${f.gap === v ? 'on' : ''}" onclick="_mcF('gap','${v}')">${l}</button>`).join('') + `</div>`
    h += `<details style="margin-top:4px"><summary class="hint" style="cursor:pointer">更多篩選：分類／存放／廠商</summary><div style="margin-top:6px"><div class="hint" style="font-size:12px">分類</div>${chips('cat', (fc.cats || []).slice(0, 40))}<div class="hint" style="font-size:12px">存放</div>${chips('store', fc.stores || [])}<div class="hint" style="font-size:12px">廠商</div>${chips('sup', (fc.suppliers || []).slice(0, 60))}</div></details>`
    return h
  }
  const photoUrl = p => p ? '/api/mail-sync?mcphoto=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK() || '') + '&path=' + encodeURIComponent(p) : ''
  function stBadge (c) { return c.complete ? `<span style="color:${COL.g};font-weight:800">完整</span>` : `<span style="color:${COL.o};font-weight:800">${(c.gaps || []).join('・') || '不完整'}</span>` }
  function list () {
    const rows = filt()
    if (!rows.length) return '<section><div class="hint" style="padding:18px;text-align:center">沒有符合的物料卡</div></section>'
    const can = MC.me && MC.me.canEdit
    let h = `<section style="padding:12px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><span class="hint">${rows.length} 張${rows.length > 400 ? '（只顯示前 400，請用搜尋）' : ''}・點任一張開物料卡</span>`
      + (can ? (sel.size >= 2 ? `<button class="mini on" onclick="_mcMergeSel()">${IC.merge} 合併勾選的 ${sel.size} 張成一張卡</button><button class="mini" onclick="_mcSelClear()">取消勾選</button>` : `<span class="hint">勾兩張以上可合併</span>`) : '') + `</div>`
    if (f.wall) {
      h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">` + rows.slice(0, 400).map(c => `<div onclick="_mcOpen('${c.id}')" style="cursor:pointer;background:var(--soft);border:1px solid var(--line);border-radius:12px;overflow:hidden"><div style="aspect-ratio:1;background:#0E1217;display:flex;align-items:center;justify-content:center;color:var(--muted)">${c.photo ? `<img src="${photoUrl(c.photo)}" style="width:100%;height:100%;object-fit:cover" loading="lazy">` : IC.img}</div><div style="padding:8px"><div style="font-weight:800;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</div><div class="hint" style="font-size:12px">${esc(c.displaySku)}・${esc(c.type)}</div><div style="font-size:12.5px;margin-top:2px">${c.baseCost != null ? nf(c.baseCost) + ' 元/' + esc(c.baseUnit) : '<span class="mut">—</span>'} ${stBadge(c)}</div></div></div>`).join('') + `</div></section>`
      return h
    }
    h += `<div class="scroll"><table class="tight" style="min-width:720px"><thead><tr>${can ? '<th></th>' : ''}<th></th><th style="text-align:left">料號</th><th style="text-align:left">品名</th><th>類型</th><th style="text-align:left">分類</th><th style="text-align:left">主要廠商</th><th>成本基準價</th><th>狀態</th><th>代碼</th></tr></thead><tbody>`
    for (const c of rows.slice(0, 400)) {
      h += `<tr style="cursor:pointer" onclick="_mcOpen('${c.id}')">`
        + (can ? `<td onclick="event.stopPropagation()"><input type="checkbox" ${sel.has(c.id) ? 'checked' : ''} onchange="_mcSel('${c.id}',this.checked)" style="width:17px;height:17px"></td>` : '')
        + `<td style="width:34px">${c.photo ? `<img src="${photoUrl(c.photo)}" style="width:30px;height:30px;object-fit:cover;border-radius:6px" loading="lazy">` : `<span style="color:var(--muted)">${IC.img}</span>`}</td>`
        + `<td style="text-align:left;font-size:12px;color:var(--text)">${esc(c.displaySku)}</td>`
        + `<td style="text-align:left"><div class="iname" style="max-width:none">${esc(c.name)}</div>${(c.brands || []).map(b => `<span class="hint" style="font-size:11px">${esc(b)}</span>`).join(' ')}${c.supplies.length > 1 ? ` <span style="font-size:11px;color:${COL.p}">${c.supplies.length} 代碼</span>` : ''}</td>`
        + `<td style="font-size:12px">${esc(c.type)}</td><td style="text-align:left;font-size:12px">${esc((c.cats || []).join('、'))}</td>`
        + `<td style="text-align:left;font-size:12px">${esc((sup(c.primary) || {}).supplier || '')}</td>`
        + `<td>${c.baseCost != null ? `<b>${nf(c.baseCost)}</b><span class="hint" style="font-size:11px">/${esc(c.baseUnit)}</span>` : '<span class="mut">—</span>'}</td>`
        + `<td style="font-size:12px">${stBadge(c)}${c.status === '停用' ? '<br><span class="mut">停用</span>' : ''}</td>`
        + `<td class="hint" style="font-size:11px;text-align:left">${esc(c.supplies.map(k => (sup(k) || {}).code).join('、')).slice(0, 60)}</td></tr>`
    }
    return h + '</tbody></table></div></section>'
  }
  window._mcSel = function (id, on) { if (on) sel.add(id); else sel.delete(id); repaintList() }
  window._mcSelClear = function () { sel.clear(); repaintList() }

  // ── 物料卡 drawer ──
  window._mcOpen = async function (id) { const c = card(id); if (!c) return; openId = id; cTab = 'basic'; form = null; drawer(c); await loadDetail(id) }
  async function loadDetail (id) { // 開卡才抓價格紀錄／換算／紀錄（列表不帶，省流量）
    try { const meQ = TK() ? '&me=' + encodeURIComponent(TK()) : ''; const r = await fetch('/api/mail-sync?matcard=' + encodeURIComponent(K) + meQ + '&card=' + encodeURIComponent(id) + '&r=' + Date.now()); const j = await r.json(); if (!j.ok) return
      Object.assign(MC.supplies, j.supplies || {}); MC.log = [...(j.log || []), ...(MC.log || []).filter(l => !(j.log || []).some(x => x.at === l.at && x.op === l.op))]
      if (openId === id) { const c = card(id); if (c) { const el = document.getElementById('mcTabBody'); if (el) el.innerHTML = tabBody(c, MC.me && MC.me.canEdit) } }
    } catch (_) {}
  }
  function drawer (c, keep) {
    let ov = document.getElementById('mcOv')
    if (!ov) { ov = document.createElement('div'); ov.id = 'mcOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px'; ov.onclick = () => { ov.remove(); openId = null }; document.body.appendChild(ov) }
    const can = MC.me && MC.me.canEdit
    const pri = sup(c.primary) || {}
    const tabs = [['basic', '基本資料'], ['supply', `供應品與價格 ${c.supplies.length}`], ['conv', '單位換算'], ['use', `被使用於 ${c.usedRecipes.length + c.usedMenus.length}`], ['log', '紀錄']]
    let h = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:760px;width:100%;max-height:90vh;overflow:auto;padding:16px 18px">`
    h += `<div style="display:flex;gap:12px;align-items:flex-start"><div style="width:64px;height:64px;border-radius:12px;background:#0E1217;display:flex;align-items:center;justify-content:center;color:var(--muted);overflow:hidden;flex:0 0 auto">${c.photo ? `<img src="${photoUrl(c.photo)}" style="width:100%;height:100%;object-fit:cover">` : IC.img}</div>`
      + `<div style="flex:1;min-width:0"><div style="font-size:19px;font-weight:800;color:var(--ink)">${esc(c.name)} <span class="hint" style="font-size:13px;font-weight:600">${esc(c.displaySku)}</span></div>`
      + `<div class="hint" style="margin-top:2px">${esc(c.type)}・基準單位 ${esc(c.baseUnit)}・${(c.brands || []).join('＋')}${c.store ? '・' + esc(c.store) : ''}${c.status === '停用' ? '・<span style="color:' + COL.r + '">停用</span>' : ''}</div>`
      + `<div style="margin-top:4px;font-size:15px">成本基準價 <b style="color:${c.complete ? COL.g : COL.o};font-size:18px">${c.baseCost != null ? nf(c.baseCost) : '—'}</b> 元／${esc(c.baseUnit)} ${stBadge(c)} <span class="hint">（主要來源 ${esc(pri.supplier || '')} ${esc(pri.code || '')}・${SRC[c.priceSrc] || ''}${c.priceDate ? ' ' + esc(c.priceDate) : ''}）</span></div></div>`
      + `<button class="mini" onclick="document.getElementById('mcOv').remove()">${IC.x}</button></div>`
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 10px">` + tabs.map(([k, l]) => `<button class="mini ${cTab === k ? 'on' : ''}" onclick="_mcTab('${k}')">${l}</button>`).join('') + `</div><div id="mcTabBody">${tabBody(c, can)}</div></div>`
    ov.innerHTML = h
  }
  window._mcTab = function (k) { cTab = k; form = null; const c = card(openId); const el = document.getElementById('mcTabBody'); if (el && c) el.innerHTML = tabBody(c, MC.me && MC.me.canEdit) }
  function tabBody (c, can) {
    if (cTab === 'basic') return basicTab(c, can)
    if (cTab === 'supply') return supplyTab(c, can)
    if (cTab === 'conv') return convTab(c, can)
    if (cTab === 'use') return useTab(c)
    return logTab(c)
  }
  const inp = (id, v, w, type) => `<input id="${id}" type="${type || 'text'}" value="${esc(v == null ? '' : v)}" style="width:${w || 160}px;border:1px solid var(--line);border-radius:8px;padding:6px 8px">`
  function basicTab (c, can) {
    let h = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;font-size:14px">`
      + `<div><div class="hint">內部 ID（不變）</div><div style="font-family:monospace;font-size:12px">${esc(c.id)}</div></div>`
      + `<div><div class="hint">顯示料號</div>${can ? inp('mcSku', c.displaySku, 150) : esc(c.displaySku)}</div>`
      + `<div><div class="hint">品名</div>${can ? inp('mcName', c.name, 200) : esc(c.name)}</div>`
      + `<div><div class="hint">類型</div>${can ? `<select id="mcType" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px">${(MC.facets.types || []).map(t => `<option ${c.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>` : esc(c.type)}</div>`
      + `<div><div class="hint">基準單位（成本以此計）</div>${can ? `<select id="mcBase" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px">${(MC.facets.baseUnits || []).map(t => `<option ${c.baseUnit === t ? 'selected' : ''}>${t}</option>`).join('')}</select>` : esc(c.baseUnit)}</div>`
      + `<div><div class="hint">存放</div>${can ? inp('mcStore', c.store, 100) : esc(c.store || '—')}</div>`
      + `<div><div class="hint">工作站</div>${can ? inp('mcStation', c.station, 120) : esc(c.station || '—')}</div>`
      + `<div><div class="hint">適用品牌</div>${(c.brands || []).join('、')}</div>`
      + `<div><div class="hint">狀態</div>${can ? `<select id="mcStatus" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px"><option ${c.status === '啟用' ? 'selected' : ''}>啟用</option><option ${c.status === '停用' ? 'selected' : ''}>停用</option></select>` : esc(c.status)}</div>`
      + `<div><div class="hint">舊代碼／別名（搜尋都找得到）</div><div style="font-size:12.5px">${esc((c.aliases || []).join('、'))}</div></div>`
      + `<div style="grid-column:1/-1"><div class="hint">備註</div>${can ? `<input id="mcNote" value="${esc(c.note || '')}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 8px">` : esc(c.note || '—')}</div></div>`
    if (can) h += `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="mini on" onclick="_mcSaveBasic('${c.id}')">${IC.check} 完成</button><label class="mini" style="cursor:pointer">${IC.cam} 上傳照片<input type="file" accept="image/*" style="display:none" onchange="_mcPhoto('${c.id}',this)"></label>${c.supplies.length > 1 ? '' : ''}</div>`
    h += `<div class="hint" style="margin-top:10px;line-height:1.6">說明：這張卡的供應品主檔（品名／規格／現價／廠商）來自阿桑系統，這裡改的是「我們的物料卡屬性」，不會回寫阿桑。統一料號之後只改「顯示料號」，舊代碼自動變別名。</div>`
    return h
  }
  window._mcSaveBasic = async function (id) {
    const g = i => { const e = document.getElementById(i); return e ? e.value.trim() : undefined }
    if (await post({ op: 'edit', cardId: id, fields: { displaySku: g('mcSku'), name: g('mcName'), type: g('mcType'), baseUnit: g('mcBase'), store: g('mcStore'), station: g('mcStation'), status: g('mcStatus'), note: g('mcNote') } })) await matcardFetch()
  }
  window._mcPhoto = async function (id, input) {
    const file = input.files && input.files[0]; if (!file) return
    const dataUrl = await shrink(file, 1200, 0.85)
    if (await post({ op: 'photo', cardId: id, dataUrl })) await matcardFetch()
  }
  function shrink (file, max, q) { return new Promise(res => { const img = new Image(); const u = URL.createObjectURL(file); img.onload = () => { const r = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u); res(cv.toDataURL('image/jpeg', q)) }; img.src = u }) }

  // 供應品與價格
  function supplyTab (c, can) {
    const sups = c.supplies.map(sup).filter(Boolean)
    let h = `<div class="hint" style="margin-bottom:6px">每個代碼一列；標 ${IC.star} 的是成本基準用的「主要來源」。價格只新增不覆寫：叫貨序列自動進來、報價／確認價手動加。</div>`
    h += `<div class="scroll"><table class="tight" style="min-width:680px"><thead><tr><th></th><th style="text-align:left">代碼</th><th style="text-align:left">廠商</th><th style="text-align:left">規格</th><th>叫貨單位</th><th>最近價</th><th>每${esc(c.baseUnit)}</th><th>稅別</th><th>最後叫貨</th><th></th></tr></thead><tbody>`
    for (const s of sups) {
      const isP = s.key === c.primary
      h += `<tr${s.status === '停用' ? ' style="opacity:.6"' : ''}><td>${isP ? `<span style="color:${COL.y}">${IC.star}</span>` : (can ? `<button class="mini" style="padding:2px 7px" onclick="_mcPrimary('${c.id}','${s.key}')">設主要</button>` : '')}</td>`
        + `<td style="text-align:left"><b>${esc(s.code)}</b>${s.sku ? `<br><span class="hint" style="font-size:11px">${esc(s.sku)}</span>` : ''}${s.virtual ? `<br><span style="font-size:11px;color:${COL.p}">拆分</span>` : ''}</td>`
        + `<td style="text-align:left;font-size:12.5px">${esc(s.supplier)}<br><span class="hint" style="font-size:11px">${esc(s.sys)}</span></td><td style="text-align:left;font-size:12px">${esc(s.spec || '—')}</td><td>${esc(s.unit)}</td>`
        + `<td><b>${nf(s.lastConfirmed ? s.lastConfirmed.p : (s.lastOrder ? s.lastOrder.p : s.price))}</b><br><span class="hint" style="font-size:10.5px">${SRC[s.priceSrc] || ''}</span></td>`
        + `<td>${s.baseCost != null ? `<b style="color:${s.convStatus === 'confirmed' || s.convStatus === 'metric' ? COL.g : COL.o}">${n4(s.baseCost)}</b>` : '<span class="mut">—</span>'}<br><span class="hint" style="font-size:10.5px">${(CONV_ST[s.convStatus] || [''])[0]}</span></td>`
        + `<td style="font-size:12px">${esc(s.tax || '—')}</td><td class="hint" style="font-size:12px">${esc(s.priceDate || '—')}</td>`
        + `<td style="white-space:nowrap">${can ? `<button class="mini" style="padding:2px 7px" onclick="_mcForm('quote','${s.key}')">加報價</button>${c.supplies.length > 1 && !s.virtual ? `<button class="mini" style="padding:2px 7px" onclick="_mcUnmerge('${s.key}')">拆出</button>` : ''}${!s.virtual ? `<button class="mini" style="padding:2px 7px" onclick="_mcForm('split','${s.key}')">拆料號</button>` : `<button class="mini" style="padding:2px 7px" onclick="_mcUnsplit('${s.splitOf}')">取消拆分</button>`}` : ''}</td></tr>`
    }
    h += `</tbody></table></div>`
    if (form && (form.kind === 'quote' || form.kind === 'split')) h += formBox(c)
    // 走勢圖（各代碼一條線，換成每基準單位才可比）
    h += `<h2 style="font-size:15px;margin:14px 0 6px">價格走勢（每 ${esc(c.baseUnit)}）</h2>` + chart(c, sups)
    // 查當時價
    h += `<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="hint">查當時價：</span><input type="date" value="${esc(asOfDate)}" onchange="_mcAsOf(this.value)" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px"><span id="mcAsOfOut" class="hint">${asOfDate ? asOfText(c, sups) : '選日期 → 顯示該日各代碼「當時價」（該日前最後一筆）'}</span></div>`
    return h
  }
  function convFactor (s, base) { const cv = (s.convs || []).find(x => x.to === base && (x.status === 'confirmed' || x.status === 'metric')) || (s.convs || []).find(x => x.to === base); return cv ? cv.factor : null }
  function asOfText (c, sups) {
    return sups.map(s => { const r = (s.recs || []).filter(x => x.d <= asOfDate).slice(-1)[0]; const k = convFactor(s, c.baseUnit); return `<b>${esc(s.code)}</b> ${r ? nf(r.p) + '／' + esc(s.unit) + (k ? '（' + n4(r.p / k) + '／' + esc(c.baseUnit) + '）' : '') + ' ' + esc(r.d) : '該日前無紀錄'}` }).join('；')
  }
  window._mcAsOf = function (v) { asOfDate = v; const c = card(openId); const el = document.getElementById('mcAsOfOut'); if (el && c) el.innerHTML = asOfText(c, c.supplies.map(sup).filter(Boolean)) }
  function chart (c, sups) {
    const lines = sups.map((s, i) => ({ s, pts: (s.recs || []).filter(r => r.src === 'order' || r.src === 'confirmed').map(r => ({ d: r.d, v: convFactor(s, c.baseUnit) ? r.p / convFactor(s, c.baseUnit) : null })).filter(p => p.v != null), col: [COL.b, COL.o, COL.p, COL.g, COL.y, COL.r][i % 6] })).filter(l => l.pts.length)
    if (!lines.length) return '<div class="hint">沒有可比的價格點（要有換算才能換成每基準單位）</div>'
    const all = lines.flatMap(l => l.pts), ds = all.map(p => Date.parse(p.d)), vs = all.map(p => p.v)
    const W = 640, H = 160, P = 28, x0 = Math.min(...ds), x1 = Math.max(...ds) || x0 + 1, mn = Math.min(...vs), mx = Math.max(...vs), rg = (mx - mn) || 1
    const X = d => P + (x1 === x0 ? 0.5 : (Date.parse(d) - x0) / (x1 - x0)) * (W - P * 2), Y = v => H - P - (v - mn) / rg * (H - P * 2)
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:170px">`
    for (const l of lines) { const pts = l.pts.map(p => `${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' '); svg += `<polyline points="${pts}" fill="none" stroke="${l.col}" stroke-width="2"/>` + l.pts.map(p => `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3" fill="${l.col}"><title>${esc(l.s.code)} ${p.d}：${n4(p.v)}／${esc(c.baseUnit)}</title></circle>`).join('') }
    svg += `<text x="${P}" y="12" font-size="10" fill="#8C98A8">最高 ${n4(mx)}</text><text x="${P}" y="${H - 6}" font-size="10" fill="#8C98A8">最低 ${n4(mn)}</text></svg>`
    svg += `<div style="display:flex;gap:10px;flex-wrap:wrap" class="hint">` + lines.map(l => `<span><span style="display:inline-block;width:10px;height:10px;background:${l.col};border-radius:2px"></span> ${esc(l.s.code)}・${esc(l.s.supplier)}</span>`).join('') + `</div>`
    return svg
  }
  window._mcPrimary = async function (id, key) { if (await post({ op: 'edit', cardId: id, fields: { primary: key } })) await matcardFetch() }
  window._mcUnmerge = async function (key) { if (!confirm('把這個代碼從這張卡拆出去（變回自己一張卡）？歷史不會變。')) return; if (await post({ op: 'unmerge', supplyKey: key })) await matcardFetch() }
  window._mcUnsplit = async function (key) { if (await post({ op: 'unsplit', supplyKey: key })) await matcardFetch() }
  window._mcMergeSel = function () { form = { kind: 'merge', ids: [...sel] }; const ov = document.getElementById('mcOv'); if (ov) ov.remove(); const el = document.getElementById('mcList'); if (el) el.insertAdjacentHTML('afterbegin', formBox()) }
  window._mcForm = function (kind, key) { form = { kind, key }; const c = card(openId); const el = document.getElementById('mcTabBody'); if (el && c) el.innerHTML = tabBody(c, true) }
  function formBox (c) {
    const g = form
    let h = `<section id="mcForm" style="padding:12px 14px;margin:8px 0;background:var(--psoft)">`
    if (g.kind === 'merge') {
      const cards = g.ids.map(card).filter(Boolean)
      h += `<div style="font-weight:800">${IC.merge} 合併 ${cards.length} 張卡成一張</div><div class="hint" style="margin:4px 0 8px">只有「同一種東西」才合併（規格不同可以、員餐帳戶可以）；各代碼保留自己的價格歷史，隨時可拆出還原。</div>`
        + `<div style="display:flex;flex-direction:column;gap:4px;font-size:13.5px">` + cards.map(x => `<div>・${esc(x.name)} <span class="hint">${esc(x.supplies.map(k => (sup(k) || {}).code + '（' + (sup(k) || {}).supplier + '）').join('、'))}</span></div>`).join('') + `</div>`
        + `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label class="hint">卡名 ${inp('mcMName', cards[0] ? cards[0].name : '', 200)}</label><label class="hint">主要來源 <select id="mcMPri" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px">${cards.flatMap(x => x.supplies).map(k => `<option value="${k}">${esc((sup(k) || {}).code)}・${esc((sup(k) || {}).supplier)}</option>`).join('')}</select></label><label class="hint">原因（選填）${inp('mcMReason', '', 200)}</label></div>`
        + `<div style="margin-top:8px;display:flex;gap:8px"><button class="mini on" onclick="_mcMergeGo()">${IC.check} 完成合併</button><button class="mini" onclick="_mcFormClose()">${IC.x} 取消</button></div>`
    } else if (g.kind === 'quote') {
      const s = sup(g.key) || {}
      h += `<div style="font-weight:800">加一筆價格紀錄：${esc(s.code)}・${esc(s.supplier)}</div><div class="hint" style="margin:4px 0 8px">只新增不覆寫。「確認價」會成為成本基準（決策 #17/#18：變價一律確認後才進成本）；「報價」只供比價。</div>`
        + `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label class="hint">日期 ${inp('mcQDate', new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10), 150, 'date')}</label><label class="hint">價格／${esc(s.unit)} ${inp('mcQPrice', '', 100, 'number')}</label><label class="hint">性質 <select id="mcQSrc" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px"><option value="confirmed">確認價（進成本）</option><option value="quote">報價（只比價）</option></select></label><label class="hint">備註 ${inp('mcQNote', '', 180)}</label></div>`
        + `<div style="margin-top:8px;display:flex;gap:8px"><button class="mini on" onclick="_mcQuoteGo('${g.key}')">${IC.check} 完成</button><button class="mini" onclick="_mcFormClose()">${IC.x} 取消</button></div>`
    } else if (g.kind === 'split') {
      const s = sup(g.key) || {}
      const ps = (s.recs || []).filter(r => r.src === 'order').map(r => r.p); const lo = Math.min(...ps), hi = Math.max(...ps)
      h += `<div style="font-weight:800">拆料號：${esc(s.code)}（一碼兩種單位，例：箱／公斤）</div><div class="hint" style="margin:4px 0 8px">決策 #5：先拆再合。價格 ≥ 分界的叫貨行歸「大單位」那個新供應品，各自進物料卡、各自換算。目前價格範圍 ${nf(lo)} ～ ${nf(hi)}。</div>`
        + `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label class="hint">分界價格 ≥ ${inp('mcSMin', ps.length ? Math.round((lo + hi) / 2) : '', 100, 'number')}</label><label class="hint">大單位名稱 ${inp('mcSUnit', '箱', 80)}</label><label class="hint">標籤 ${inp('mcSLabel', '箱', 80)}</label></div>`
        + `<div style="margin-top:8px;display:flex;gap:8px"><button class="mini on" onclick="_mcSplitGo('${g.key}')">${IC.check} 完成</button><button class="mini" onclick="_mcFormClose()">${IC.x} 取消</button></div>`
    } else if (g.kind === 'conv') {
      const s = sup(g.key) || {}
      h += `<div style="font-weight:800">手動輸入換算：${esc(s.code)}・${esc(s.name)}</div><div class="hint" style="margin:4px 0 8px">1 ${esc(s.unit || '叫貨單位')} ＝ ? 目標單位。g ↔ ml 要填實測密度依據（決策 #14 不可預設 1:1）。</div>`
        + `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span>1 ${esc(s.unit)} ＝</span>${inp('mcCF', g.factor || '', 100, 'number')}<select id="mcCTo" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px">${['g', 'ml', '個', '顆', '片', '塊', '包', '瓶'].map(u => `<option ${g.to === u ? 'selected' : ''}>${u}</option>`).join('')}</select><label class="hint">依據／原因 ${inp('mcCWhy', '', 220)}</label></div>`
        + `<div style="margin-top:8px;display:flex;gap:8px"><button class="mini on" onclick="_mcConvGo('${g.key}','manual')">${IC.check} 完成</button><button class="mini" onclick="_mcNoConv('${g.key}')">不需換算（填原因）</button><button class="mini" onclick="_mcFormClose()">${IC.x} 取消</button></div>`
    }
    return h + '</section>'
  }
  window._mcFormClose = function () { form = null; const fb = document.getElementById('mcForm'); if (fb) fb.remove(); const c = card(openId); const el = document.getElementById('mcTabBody'); if (el && c) el.innerHTML = tabBody(c, true) }
  const g = i => { const e = document.getElementById(i); return e ? e.value.trim() : '' }
  window._mcMergeGo = async function () {
    const ids = form.ids, keys = ids.flatMap(id => (card(id) || {}).supplies || [])
    const existing = ids.map(id => card(id)).find(c => c && !c.id.startsWith('auto:'))
    if (await post({ op: 'merge', supplyKeys: keys, targetCardId: existing ? existing.id : '', name: g('mcMName'), primary: g('mcMPri'), reason: g('mcMReason') })) { sel.clear(); form = null; await matcardFetch() }
  }
  window._mcQuoteGo = async function (key) { if (await post({ op: 'quote', supplyKey: key, date: g('mcQDate'), price: g('mcQPrice'), src: g('mcQSrc'), note: g('mcQNote') })) { form = null; await matcardFetch() } }
  window._mcSplitGo = async function (key) { if (await post({ op: 'split', supplyKey: key, minPrice: g('mcSMin'), unit: g('mcSUnit'), label: g('mcSLabel') })) { form = null; await matcardFetch() } }
  window._mcConvGo = async function (key, mode) { const s = sup(key) || {}; if (await post({ op: 'conv', supplyKey: key, mode, from: s.unit, to: g('mcCTo'), factor: g('mcCF'), why: g('mcCWhy'), reason: g('mcCWhy') })) { form = null; await matcardFetch() } }
  window._mcConvAccept = async function (key, to, factor, why) { const s = sup(key) || {}; if (await post({ op: 'conv', supplyKey: key, mode: 'accept', from: s.unit, to, factor, why, reason: why })) await matcardFetch() }
  window._mcConvOff = async function (key, to) { if (await post({ op: 'conv', supplyKey: key, mode: 'off', to })) await matcardFetch() }
  window._mcNoConv = async function (key) { const why = g('mcCWhy'); if (!why) { alert('「不需換算」要填原因'); return } if (await post({ op: 'conv', supplyKey: key, mode: 'noconv', reason: why })) { form = null; await matcardFetch() } }

  // 單位換算
  function convTab (c, can) {
    const sups = c.supplies.map(sup).filter(Boolean)
    let h = `<div class="hint" style="margin-bottom:8px">每個供應品：「1 叫貨單位 ＝ N 目標單位」。來源：公制固定／阿桑快照（未確認）／規格文字解析（建議）／人工確認。<b>只有已確認（含公制）才算完整</b>。自動計算：叫貨價 ÷ 換算 ＝ 每基準單位成本。</div>`
    for (const s of sups) {
      const price = (s.lastConfirmed && s.lastConfirmed.p) || (s.lastOrder && s.lastOrder.p) || s.price
      h += `<div style="background:var(--soft);border-radius:10px;padding:10px 12px;margin-bottom:8px"><div style="font-weight:800">${esc(s.code)}・${esc(s.name)} <span class="hint" style="font-weight:600">${esc(s.supplier)}・規格「${esc(s.spec || '—')}」・叫貨單位 ${esc(s.unit)}・最近價 ${nf(price)}</span></div>`
      const rows = (s.convs || [])
      if (!rows.length) h += `<div class="hint" style="margin-top:4px;color:${COL.r}">沒有任何換算（缺）</div>`
      h += `<div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;font-size:13.5px">` + rows.map((cv, i) => {
        if (cv.noconv) return `<div>・<span style="color:${COL.g}">不需換算</span>：${esc(cv.reason || '')} <span class="hint">${esc(cv.by || '')} ${esc(String(cv.at || '').slice(5, 10))}</span>${can ? ` <button class="mini" style="padding:1px 6px" onclick="_mcConvOff('${s.key}','noconv')">取消</button>` : ''}</div>`
        const st = CONV_ST[cv.status] || ['', COL.m]
        const calc = price && cv.factor ? ` → <b>${n4(price / cv.factor)}</b> 元／${esc(cv.to)}` : ''
        return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span>・1 ${esc(s.unit)} ＝ <b>${nf(cv.factor)}</b> ${esc(cv.to)}${calc}</span><span style="font-size:11.5px;color:${st[1]};border:1px solid ${st[1]};border-radius:6px;padding:0 6px">${st[0]}</span>${cv.why ? `<span class="hint" style="font-size:12px">${esc(cv.why)}</span>` : ''}${cv.by ? `<span class="hint" style="font-size:12px">${esc(cv.by)} ${esc(String(cv.at || '').slice(5, 10))}</span>` : ''}`
          + (can && (cv.status === 'suggested' || cv.status === 'snapshot') ? `<button class="mini" style="padding:1px 7px" onclick="_mcConvAccept('${s.key}','${esc(cv.to)}',${cv.factor},'${esc(cv.why || '').replace(/'/g, '')}')">${IC.check} 接受</button>` : '')
          + (can && cv.status === 'confirmed' ? `<button class="mini" style="padding:1px 7px" onclick="_mcConvOff('${s.key}','${esc(cv.to)}')">取消</button>` : '') + `</div>`
      }).join('') + `</div>`
      if (can) h += `<div style="margin-top:6px"><button class="mini" onclick="_mcForm('conv','${s.key}')">手動輸入換算</button></div>`
      if (form && form.kind === 'conv' && form.key === s.key) h += formBox(c)
      h += `</div>`
    }
    return h
  }
  function useTab (c) {
    let h = `<div class="hint" style="margin-bottom:8px">直接或經半成品間接用到這張卡的食譜／菜單（食譜＝阿桑即時配方；菜單行＝10-06 快照，批次 3 後改即時）。</div>`
    h += `<div><b>備料食譜（${c.usedRecipes.length}）</b>：${c.usedRecipes.length ? c.usedRecipes.map(esc).join('、') : '<span class="mut">無</span>'}</div>`
    h += `<div style="margin-top:8px"><b>在賣菜單（${c.usedMenus.length}）</b>：${c.usedMenus.length ? c.usedMenus.map(esc).join('、') : '<span class="mut">無</span>'}</div>`
    return h
  }
  function logTab (c) {
    const keys = new Set([c.id, ...c.supplies])
    const rows = (MC.log || []).filter(l => keys.has(l.cardId) || keys.has(l.key) || keys.has(l.target) || (l.keys || []).some(k => keys.has(k)))
    if (!rows.length) return '<div class="hint">這張卡還沒有任何人工變更（主檔變動在阿桑系統）。</div>'
    return `<div style="display:flex;flex-direction:column;gap:6px;font-size:13.5px">` + rows.map(l => `<div style="background:var(--soft);border-radius:8px;padding:6px 10px"><span class="hint">${esc(String(l.at || '').slice(5, 16).replace('T', ' '))} ${esc(l.by)}</span> <b>${esc({ merge: '合併', unmerge: '拆出', edit: '編輯', conv: '換算', quote: '價格紀錄', split: '拆料號', unsplit: '取消拆分', photo: '照片' }[l.op] || l.op)}</b> ${esc(JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => !['at', 'by', 'op'].includes(k)))).slice(0, 220))}</div>`).join('') + `</div>`
  }

  async function post (body) {
    const r = await fetch('/api/mail-sync?matcard=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
    const j = await r.json().catch(() => ({ ok: false, error: '連線問題' }))
    if (!j.ok) alert(j.error || '沒成功')
    return j.ok
  }
  // 給待處理中心用：合併建議「合併進同一張物料卡」直接生效
  window.matcardMergeCodes = async function (sys, codes, name) { const keys = codes.map(c => (sys === 'GROUN:D' ? 'G|' : 'A|') + String(c || '').replace(/\s+/g, '')); return post({ op: 'merge', supplyKeys: keys, name, reason: '待處理中心合併建議' }) }
})()
