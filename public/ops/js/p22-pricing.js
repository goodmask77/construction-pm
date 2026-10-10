// 💲 /prep 第 22 塊（v4.70.35，2026-10-10）：產品與成本模組｜批次 5「菜單與定價」＋批次 4「GD 五款代表餐點」
// 規格 §5：列表＋品項抽屜（規格×通路售價／連結食譜＋用量倍率／包材三通路（挑包材卡帶照片）／套餐組合／試算（不寫正式資料）／成本歷史／版本）。
// 資料 ?pricing=（api/_menu.js）。UI 慣例：單色線條圖示、不用 prompt、✓ 完成鈕。
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 100) / 100).toLocaleString()
  const pc = n => (n == null || isNaN(n)) ? '—' : Math.round(n * 100) + '%'
  const I = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto">${d}</svg>`
  const IC = { tag: I('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'), check: I('<polyline points="20 6 9 17 4 12"/>'), x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'), img: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'), plus: I('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'), trash: I('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>'), undo: I('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>'), calc: I('<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8.01" y2="10"/><line x1="12" y1="10" x2="12.01" y2="10"/><line x1="16" y1="10" x2="16.01" y2="10"/><line x1="8" y1="14" x2="8.01" y2="14"/><line x1="12" y1="14" x2="12.01" y2="14"/><line x1="16" y1="14" x2="16.01" y2="14"/>'), box: I('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>') }
  const COL = { b: '#4DA3FF', g: '#3DBE6C', o: '#E8A657', y: '#E8C14E', p: '#B48CF2', r: '#F07373', m: '#8C98A8' }
  const CH = ['dinein', 'takeout', 'delivery'], CHL = { dinein: '內用', takeout: '外帶', delivery: '外送' }
  let PD = null, brand = 'GROUN:D', fCat = 'all', fSt = 'active', q = '', openKey = null, dTab = 'spec', ch = 'dinein', sim = null, ed = null, loading = false

  window.pricingLoad = async function () {
    curStore = 'pricing'; try { setTabs('pricing') } catch (_) {}
    document.getElementById('upd').textContent = '菜單與定價'
    app.innerHTML = '<section><div class="hint" style="padding:22px">載入菜單成本中…</div></section>'
    await fetchAll()
  }
  async function fetchAll () {
    if (loading) return; loading = true
    try { const meQ = TK() ? '&me=' + encodeURIComponent(TK()) : ''; const r = await fetch('/api/mail-sync?pricing=' + encodeURIComponent(K) + meQ + '&r=' + Date.now()); PD = await r.json() } catch (e) { PD = { ok: false, error: '連線問題' } }
    loading = false
    if (curStore === 'pricing') { app.innerHTML = render(); if (openKey) { const it = item(openKey); if (it) drawer(it) } }
  }
  const item = k => (PD.items || []).find(i => i.key === k)
  const can = () => PD && PD.me && PD.me.canEdit
  const imgUrl = p => p ? '/api/mail-sync?mcphoto=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK() || '') + '&path=' + encodeURIComponent(p) : ''

  function filt () {
    const qq = q.toLowerCase()
    return (PD.items || []).filter(i => i.brand === brand && (fCat === 'all' || i.category === fCat) && (fSt === 'all' || (fSt === 'active' ? i.active : !i.active)) && (!qq || (i.name + ' ' + i.category + ' ' + (i.recipeName || '')).toLowerCase().includes(qq)))
  }
  function render () {
    if (!PD.ok) return '<section><div class="err">' + esc(PD.error || '讀不到菜單成本') + '</div></section>'
    const rows = filt(), all = (PD.items || []).filter(i => i.brand === brand && i.active)
    const complete = all.filter(i => i.main && i.main.complete).length
    const avgM = (() => { const xs = all.filter(i => i.main && i.main.margin != null).map(i => i.main.margin); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null })()
    let h = `<h1 style="display:flex;align-items:center;gap:8px">${IC.tag} 菜單與定價</h1><div class="sub">售價＝菜單；食材成本＝連結食譜（系統算）；包材依內用／外帶／外送各算；成本不完整的品項正式毛利留空、只顯示已知成本，且不計入平均。</div>`
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:14px 0">`
      + kpi('在賣品項', all.length, brand, COL.b) + kpi('成本完整', complete + '／' + all.length, '食材＋包材都算得出', complete === all.length && all.length ? COL.g : COL.o) + kpi('平均毛利率（完整者）', pc(avgM), '含包材，內用價', COL.g) + kpi('成本率超標', all.filter(i => i.over).length, '依品類上限（成本總覽設）', COL.r) + `</div>`
    h += `<section style="padding:12px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">`
      + ['GROUN:D', 'A Beach'].map(b => `<button class="mini ${brand === b ? 'on' : ''}" onclick="_prBrand('${b}')">${b}</button>`).join('')
      + `<span style="width:8px"></span>` + CH.map(c => `<button class="mini ${ch === c ? 'on' : ''}" onclick="_prCh('${c}')">${CHL[c]}價</button>`).join('')
      + `<input value="${esc(q)}" oninput="_prQ(this.value)" placeholder="搜尋品項／食譜…" style="flex:1;min-width:150px;border:1px solid var(--line);border-radius:10px;padding:8px 12px"><button class="mini" onclick="pricingLoad()">${IC.undo}</button></div>`
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"><button class="mini ${fCat === 'all' ? 'on' : ''}" onclick="_prCat('all')">全部品類</button>` + ((PD.cats || {})[brand] || []).map(c => `<button class="mini ${fCat === c ? 'on' : ''}" onclick="_prCat('${esc(c).replace(/'/g, '&#39;')}')">${esc(c)}</button>`).join('') + `</div>`
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap">` + [['active', '在賣'], ['off', '停售'], ['all', '全部']].map(([v, l]) => `<button class="mini ${fSt === v ? 'on' : ''}" onclick="_prSt('${v}')">${l}</button>`).join('') + `</div></section>`
    h += `<section style="padding:12px"><div class="hint" style="margin-bottom:6px">${rows.length} 項・點任一列開品項（規格／包材／套餐／試算）${brand === 'A Beach' ? '・A Beach 售價與在賣來自阿桑 /costs/menu，食譜行＝10-06 快照' : '・GROUN:D 售價來自「菜單」分頁，食譜要在「食譜」分頁建（五款代表餐點骨架已建）'}</div>`
    h += `<div class="scroll"><table class="tight" style="min-width:820px"><thead><tr><th style="text-align:left">品名</th><th style="text-align:left">品類</th><th>規格</th><th>${CHL[ch]}售價</th><th>食材成本</th><th>包材</th><th>成本率</th><th>毛利率</th><th style="text-align:left">狀態</th><th style="text-align:left">食譜</th></tr></thead><tbody>`
    for (const i of rows) {
      const m = (i.specs[0] || {}).channels ? i.specs[0].channels[ch] : i.main
      h += `<tr onclick="_prOpen('${esc(i.key).replace(/'/g, '&#39;')}')" style="cursor:pointer${i.active ? '' : ';opacity:.55'}"><td style="text-align:left"><div class="iname" style="max-width:none">${esc(i.name)}</div>${i.combo ? `<span style="font-size:11px;color:${COL.p}">套餐</span>` : ''}</td><td style="text-align:left;font-size:12px">${esc(i.category)}</td><td style="font-size:12px">${i.specs.length > 1 ? i.specs.map(s => esc(s.name)).join('／') : '單一'}</td>`
        + `<td><b>${nf(m.price)}</b></td><td>${m.food != null ? nf(m.food) : '<span class="mut">—</span>'}</td><td>${m.pack ? nf(m.pack) : '<span class="mut">0</span>'}${m.packOk ? '' : ' <span style="color:' + COL.o + ';font-size:11px">缺</span>'}</td>`
        + `<td style="color:${i.over ? COL.r : 'inherit'}">${pc(m.costRatio)}${i.cap != null ? `<span class="hint" style="font-size:10.5px">/${i.cap}%</span>` : ''}</td><td>${m.complete ? `<b style="color:${COL.g}">${pc(m.margin)}</b>` : `<span class="hint" style="font-size:11.5px">已知 ${nf(m.known)}</span>`}</td>`
        + `<td style="text-align:left;font-size:12px">${m.complete ? `<span style="color:${COL.g};font-weight:800">完整</span>` : `<span style="color:${COL.o};font-weight:800">${esc(i.recipeKey ? (i.recipePending ? '待補配方' : (i.recipeGaps[0] || i.recipeStatus)) : '未連結食譜')}</span>`}${i.active ? '' : '<br><span class="mut">停售</span>'}</td><td style="text-align:left;font-size:12px" class="hint">${esc(i.recipeName || '—')}</td></tr>`
    }
    h += `</tbody></table></div></section>`
    return h
  }
  const kpi = (l, v, sub, c) => `<div class="kpi" style="text-align:left"><div class="v" style="color:${c};font-size:25px">${v}</div><div class="l" style="font-size:14px">${l}</div><div class="sub2">${esc(sub)}</div></div>`
  window._prBrand = b => { brand = b; fCat = 'all'; app.innerHTML = render() }
  window._prCh = c => { ch = c; app.innerHTML = render() }
  window._prQ = v => { q = v; app.innerHTML = render() }
  window._prCat = v => { fCat = v; app.innerHTML = render() }
  window._prSt = v => { fSt = v; app.innerHTML = render() }

  // ── 品項抽屜 ──
  window._prOpen = function (k) { const it = item(k); if (!it) return; openKey = k; dTab = 'spec'; sim = null; ed = null; drawer(it) }
  function drawer (it) {
    let ov = document.getElementById('prOv')
    if (!ov) { ov = document.createElement('div'); ov.id = 'prOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:14px'; ov.onclick = () => { ov.remove(); openKey = null }; document.body.appendChild(ov) }
    const m = it.main
    const tabs = [['spec', `規格與售價 ${it.specs.length}`], ['pack', '包材（三通路）'], ['combo', '套餐'], ['sim', '試算'], ['hist', '成本歷史／版本']]
    let h = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:860px;width:100%;max-height:92vh;overflow:auto;padding:14px 16px">`
    h += `<div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><div style="font-size:19px;font-weight:800;color:var(--ink)">${esc(it.name)} <span class="hint" style="font-size:13px;font-weight:600">${esc(it.brand)}・${esc(it.category)}${it.active ? '' : '・停售'}</span></div>`
      + `<div style="margin-top:4px;font-size:15px">內用價 <b>${nf(m.price)}</b>・食材 <b style="color:${it.recipeOk ? COL.g : COL.o}">${nf(m.food)}</b>・包材 ${nf(m.pack)}・成本率 ${pc(m.costRatio)}${it.cap != null ? ` <span class="hint">（上限 ${it.cap}%${it.over ? '，<b style="color:' + COL.r + '">超標</b>' : ''}）</span>` : ' <span class="hint">（上限未設定）</span>'}・毛利率 ${m.complete ? `<b style="color:${COL.g}">${pc(m.margin)}</b>` : `<span class="hint">不完整不顯示（已知成本 ${nf(m.known)}）</span>`}</div>`
      + `<div class="hint" style="margin-top:3px">食譜：${it.recipeName ? `<b>${esc(it.recipeName)}</b>（${esc(it.recipeStatus)}${it.recipeGaps.length ? '：' + esc(it.recipeGaps.join('；')) : ''}）` : '<span style="color:' + COL.o + '">未連結</span>'}${it.abCost != null ? `・阿桑 view 成本 ${nf(it.abCost)}` : ''}</div></div>`
      + `<button class="mini" onclick="document.getElementById('prOv').remove();openKey=null">${IC.x}</button></div>`
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 10px">` + tabs.map(([k, l]) => `<button class="mini ${dTab === k ? 'on' : ''}" onclick="_prTab('${k}')">${l}</button>`).join('') + `</div><div id="prTabBody">${body(it)}</div></div>`
    ov.innerHTML = h
  }
  window._prTab = k => { dTab = k; ed = null; const it = item(openKey); const el = document.getElementById('prTabBody'); if (el && it) el.innerHTML = body(it) }
  function body (it) { return dTab === 'spec' ? specTab(it) : dTab === 'pack' ? packTab(it) : dTab === 'combo' ? comboTab(it) : dTab === 'sim' ? simTab(it) : histTab(it) }
  const inp = (id, v, w, t) => `<input id="${id}" type="${t || 'text'}" value="${esc(v == null ? '' : v)}" style="width:${w || 90}px;border:1px solid var(--line);border-radius:8px;padding:5px 8px">`

  function specTab (it) {
    let h = `<div class="hint" style="margin-bottom:6px">同一品項可有多規格（4oz／8oz、M／L），各自售價與用量倍率（相對連結食譜的一份），<b>不可整份加倍</b>。改售價＝新增一筆版本紀錄。</div>`
    // 連結食譜
    h += `<div style="background:var(--soft);border-radius:10px;padding:10px 12px;margin-bottom:8px"><div style="font-weight:800">連結食譜</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px"><span>${esc(it.recipeName || '（未連結）')}</span>`
      + (can() ? `<select id="prRcp" style="max-width:320px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"><option value="">— 選食譜 —</option>${(PD.recipesPick || []).filter(r => r.brand === it.brand || it.brand === 'A Beach').map(r => `<option value="${esc(r.key)}" ${r.key === it.recipeKey ? 'selected' : ''}>${esc(r.name)}（${r.type === 'dish' ? '餐點' : '半成品'}・${r.ok ? '完整' : '不完整'}・${nf(r.cost)}）</option>`).join('')}</select><button class="mini on" onclick="_prLink('${esc(it.key)}')">${IC.check}</button>` : '') + `</div>${it.recipePending ? `<div class="hint" style="margin-top:4px;color:${COL.o}">這份食譜還沒填材料（批次 4 骨架）：到「食譜」分頁的草稿填入已確認配方與實測產量後發布。</div>` : ''}</div>`
    const specs = ed && ed.kind === 'spec' ? ed.specs : it.specs.map(s => ({ id: s.id, name: s.name, mult: s.mult, prices: { ...s.prices } }))
    h += `<div class="scroll"><table class="tight" style="min-width:600px"><thead><tr><th style="text-align:left">規格</th><th>用量倍率</th>${CH.map(c => `<th>${CHL[c]}價</th>`).join('')}<th>食材</th><th>包材(內用)</th><th>毛利率(內用)</th>${ed ? '<th></th>' : ''}</tr></thead><tbody>`
    specs.forEach((s, i) => {
      const live = it.specs.find(x => x.id === s.id)
      h += `<tr><td style="text-align:left">${ed ? inp('prSpN' + i, s.name, 90) : esc(s.name)}</td><td>${ed ? inp('prSpM' + i, s.mult, 60, 'number') : s.mult}</td>${CH.map(c => `<td>${ed ? inp('prSpP' + i + c, s.prices[c], 70, 'number') : nf(s.prices[c])}</td>`).join('')}<td>${live ? nf(live.food) : '—'}</td><td>${live ? nf(live.channels.dinein.pack) : '—'}</td><td>${live && live.channels.dinein.complete ? pc(live.channels.dinein.margin) : '<span class="hint">—</span>'}</td>${ed ? `<td><button class="mini" style="color:var(--red)" onclick="_prSpecDel(${i})">${IC.trash}</button></td>` : ''}</tr>`
    })
    h += `</tbody></table></div>`
    if (can()) h += ed ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><button class="mini" onclick="_prSpecAdd()">${IC.plus} 加規格</button><input id="prSpReason" placeholder="調價原因（選填）" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"><button class="mini on" onclick="_prSpecSave('${esc(it.key)}')">${IC.check} 建立新版本</button><button class="mini" onclick="_prTab('spec')">${IC.x}</button></div>` : `<div style="margin-top:8px"><button class="mini" onclick="_prSpecEdit()">編輯規格／售價</button></div>`
    return h
  }
  window._prLink = async function (k) { const v = (document.getElementById('prRcp') || {}).value || ''; if (await post({ op: 'link', key: k, recipeKey: v })) await fetchAll() }
  window._prSpecEdit = function () { const it = item(openKey); ed = { kind: 'spec', specs: it.specs.map(s => ({ id: s.id, name: s.name, mult: s.mult, prices: { ...s.prices } })) }; const el = document.getElementById('prTabBody'); if (el) el.innerHTML = body(it) }
  function readSpecs () { return ed.specs.map((s, i) => ({ id: s.id, name: (document.getElementById('prSpN' + i) || {}).value || s.name, mult: Number((document.getElementById('prSpM' + i) || {}).value) || s.mult, prices: Object.fromEntries(CH.map(c => [c, (document.getElementById('prSpP' + i + c) || {}).value])) })) }
  window._prSpecAdd = function () { ed.specs = readSpecs(); ed.specs.push({ id: 's' + Date.now().toString(36), name: '新規格', mult: 1, prices: {} }); const el = document.getElementById('prTabBody'); if (el) el.innerHTML = body(item(openKey)) }
  window._prSpecDel = function (i) { ed.specs = readSpecs(); ed.specs.splice(i, 1); const el = document.getElementById('prTabBody'); if (el) el.innerHTML = body(item(openKey)) }
  window._prSpecSave = async function (k) { const specs = readSpecs(); const reason = (document.getElementById('prSpReason') || {}).value || ''; if (await post({ op: 'specs', key: k, specs, reason })) { ed = null; await fetchAll() } }

  // 包材
  function packTab (it) {
    const cur = ed && ed.kind === 'pack' ? ed.pack : Object.fromEntries(CH.map(c => [c, (it.specs[0].pack[c].lines || []).map(l => ({ cardId: l.cardId, qty: l.qty }))]))
    let h = `<div class="hint" style="margin-bottom:6px">依內用／外帶／外送各設一組包材，從物料卡挑「類型＝包材」的卡（帶照片），成本自動連動該卡的廠商價。沒換算成「個」的卡先用叫貨單位價並標示。</div>`
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">` + CH.map(c => { const pk = it.specs[0].pack[c]; return `<div style="background:var(--soft);border-radius:10px;padding:10px 12px"><div style="display:flex;justify-content:space-between"><b>${CHL[c]}</b><span>${nf(pk.cost)} 元${pk.ok ? '' : ' <span style="color:' + COL.o + ';font-size:11px">缺價</span>'}</span></div><div style="display:flex;flex-direction:column;gap:4px;margin-top:6px">` + (cur[c] || []).map((x, i) => { const p = (PD.packCards || []).find(z => z.id === x.cardId) || {}; return `<div style="display:flex;gap:6px;align-items:center;font-size:13.5px"><span style="width:30px;height:30px;border-radius:6px;background:#0E1217;overflow:hidden;display:flex;align-items:center;justify-content:center;color:var(--muted)">${p.photo ? `<img src="${imgUrl(p.photo)}" style="width:100%;height:100%;object-fit:cover">` : IC.box}</span><span style="flex:1">${esc(p.name || x.cardId)}${p.convNote ? `<br><span class="hint" style="font-size:11px">${esc(p.convNote)}</span>` : ''}</span>${ed ? `<input type="number" step="any" value="${x.qty}" onchange="_prPackQty('${c}',${i},this.value)" style="width:56px;border:1px solid var(--line);border-radius:8px;padding:4px 6px"><button class="mini" style="color:var(--red)" onclick="_prPackDel('${c}',${i})">${IC.trash}</button>` : `<span>×${x.qty}　${p.per != null ? nf(p.per * x.qty) : '—'}</span>`}</div>` }).join('') + (ed ? `<div style="display:flex;gap:6px;margin-top:4px"><select id="prPk_${c}" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:5px 8px">${(PD.packCards || []).filter(z => z.brand.includes(it.brand) || true).map(z => `<option value="${esc(z.id)}">${esc(z.name)}（${z.per != null ? nf(z.per) + '/' + esc(z.unitLabel) : '缺價'}）</option>`).join('')}</select><button class="mini" onclick="_prPackAdd('${c}')">${IC.plus}</button></div>` : '') + `</div></div>` }).join('') + `</div>`
    if (can()) h += ed ? `<div style="display:flex;gap:8px;margin-top:8px"><button class="mini on" onclick="_prPackSave('${esc(it.key)}')">${IC.check} 完成</button><button class="mini" onclick="_prTab('pack')">${IC.x}</button></div>` : `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="mini" onclick="_prPackEdit()">編輯包材</button><button class="mini" onclick="_prPackCopy()">內用複製到外帶／外送</button></div>`
    if (!(PD.packCards || []).length) h += `<div class="hint" style="margin-top:6px;color:${COL.o}">目前沒有「類型＝包材」的物料卡：到物料庫把包材卡的類型改成「包材」就會出現在這裡（ground-pack 的包材資料之後併入）。</div>`
    return h
  }
  window._prPackEdit = function () { const it = item(openKey); ed = { kind: 'pack', pack: Object.fromEntries(CH.map(c => [c, (it.specs[0].pack[c].lines || []).map(l => ({ cardId: l.cardId, qty: l.qty }))])) }; const el = document.getElementById('prTabBody'); if (el) el.innerHTML = body(it) }
  window._prPackCopy = async function () { const it = item(openKey); const d = (it.specs[0].pack.dinein.lines || []).map(l => ({ cardId: l.cardId, qty: l.qty })); if (await post({ op: 'pack', key: it.key, pack: { dinein: d, takeout: d, delivery: d } })) await fetchAll() }
  window._prPackAdd = function (c) { const v = (document.getElementById('prPk_' + c) || {}).value; if (!v) return; (ed.pack[c] = ed.pack[c] || []).push({ cardId: v, qty: 1 }); const el = document.getElementById('prTabBody'); if (el) el.innerHTML = body(item(openKey)) }
  window._prPackQty = function (c, i, v) { ed.pack[c][i].qty = Number(v) || 0 }
  window._prPackDel = function (c, i) { ed.pack[c].splice(i, 1); const el = document.getElementById('prTabBody'); if (el) el.innerHTML = body(item(openKey)) }
  window._prPackSave = async function (k) { if (await post({ op: 'pack', key: k, pack: ed.pack })) { ed = null; await fetchAll() } }

  // 套餐
  function comboTab (it) {
    const cb = it.combo
    let h = `<div class="hint" style="margin-bottom:6px">套餐＝這個主餐＋可選附餐池＋可選飲料池＋額外包材＋加價。系統列出每種合法組合的成本與最低／最高；同一份包材不重複計入；加價是設定值。</div>`
    const pick = (PD.recipesPick || []).filter(r => r.type === 'dish')
    if (can()) {
      const cur = ed && ed.kind === 'combo' ? ed : { sides: cb ? (cb.sidesKeys || []) : [], drinks: cb ? (cb.drinksKeys || []) : [], upcharge: cb ? cb.upcharge : 0 }
      h += `<div style="background:var(--soft);border-radius:10px;padding:10px 12px;margin-bottom:8px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="hint">加價</span>${inp('prCbUp', cur.upcharge, 70, 'number')} 元</div>`
        + `<div style="margin-top:6px"><span class="hint">附餐池（可多選）</span><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${pick.map(r => `<button class="mini ${cur.sides.includes(r.key) ? 'on' : ''}" style="padding:2px 8px;font-size:12px" onclick="_prCbTog('sides','${esc(r.key)}')">${esc(r.name)}</button>`).join('')}</div></div>`
        + `<div style="margin-top:6px"><span class="hint">飲料池（可多選）</span><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${pick.map(r => `<button class="mini ${cur.drinks.includes(r.key) ? 'on' : ''}" style="padding:2px 8px;font-size:12px" onclick="_prCbTog('drinks','${esc(r.key)}')">${esc(r.name)}</button>`).join('')}</div></div>`
        + `<div style="margin-top:8px;display:flex;gap:8px"><button class="mini on" onclick="_prCbSave('${esc(it.key)}')">${IC.check} 完成</button></div></div>`
      if (!ed) ed = { kind: 'combo', ...cur }
    }
    if (!cb) return h + `<div class="hint">還沒設套餐。</div>`
    h += `<div style="margin-bottom:6px">組合 ${cb.n} 種・可算 ${cb.nOk} 種・成本範圍 <b>${nf(cb.min)} ～ ${nf(cb.max)}</b>（食材＋包材）・加價 ${nf(cb.upcharge)}</div>`
    h += `<div class="scroll"><table class="tight" style="min-width:560px"><thead><tr><th style="text-align:left">附餐</th><th style="text-align:left">飲料</th><th>售價</th><th>食材</th><th>包材</th><th>毛利率</th></tr></thead><tbody>` + cb.combos.map(c => `<tr style="${c.ok ? '' : 'opacity:.6'}"><td style="text-align:left">${esc(c.side)}</td><td style="text-align:left">${esc(c.drink)}</td><td>${nf(c.price)}</td><td>${nf(c.food)}</td><td>${nf(c.pack)}</td><td>${c.ok ? pc(c.margin) : '<span class="hint">不完整</span>'}</td></tr>`).join('') + `</tbody></table></div>`
    return h
  }
  window._prCbTog = function (k, key) { const a = ed[k]; const i = a.indexOf(key); if (i >= 0) a.splice(i, 1); else a.push(key); const el = document.getElementById('prTabBody'); if (el) el.innerHTML = body(item(openKey)) }
  window._prCbSave = async function (k) { const up = (document.getElementById('prCbUp') || {}).value; if (await post({ op: 'combo', key: k, sides: ed.sides, drinks: ed.drinks, upcharge: up })) { ed = null; await fetchAll() } }

  // 試算（不寫正式資料）
  function simTab (it) {
    const m = it.main
    if (!sim) sim = { price: m.price || 0, mult: 1, foodAdj: 0 }
    const food = (m.food || 0) * sim.mult * (1 + sim.foodAdj / 100), pack = m.pack || 0, price = Number(sim.price) || 0
    const margin = price > 0 ? (price - food - pack) / price : null
    return `<div class="hint" style="margin-bottom:8px">改售價、份量、模擬原料漲跌，只在這裡看結果，不寫正式資料；要正式調價請到「規格與售價」按「建立新版本」。</div>`
      + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px"><label>售價<br><input type="number" value="${sim.price}" oninput="_prSim('price',this.value)" style="width:120px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"></label><label>份量倍率<br><input type="number" step="0.1" value="${sim.mult}" oninput="_prSim('mult',this.value)" style="width:120px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"></label><label>原料價模擬 ±%<br><input type="number" value="${sim.foodAdj}" oninput="_prSim('foodAdj',this.value)" style="width:120px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"></label></div>`
      + `<div style="margin-top:12px;background:var(--psoft);border-radius:10px;padding:12px 14px;font-size:16px">食材 <b>${nf(food)}</b>＋包材 <b>${nf(pack)}</b>＝ <b>${nf(food + pack)}</b>；售價 ${nf(price)} → 毛利 <b style="color:${margin != null && margin > 0 ? COL.g : COL.r}">${nf(price - food - pack)}</b>（${pc(margin)}）${!m.complete ? `<div class="hint" style="margin-top:4px">注意：這個品項成本不完整，試算用的是已知成本（下限）</div>` : ''}</div>`
  }
  window._prSim = function (k, v) { sim[k] = Number(v) || 0; const el = document.getElementById('prTabBody'); if (el) el.innerHTML = body(item(openKey)) }

  function histTab (it) {
    const vs = (PD.versions || []).filter(v => v.key === it.key)
    let h = `<div style="font-weight:800">售價版本（只新增）</div>` + (vs.length ? `<div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">` + vs.map(v => `<div style="background:var(--soft);border-radius:8px;padding:6px 10px;font-size:13.5px"><span class="hint">${esc(v.at.slice(5, 16).replace('T', ' '))} ${esc(v.by)}</span> ${v.specs.map(s => `${esc(s.name)}：${CH.map(c => CHL[c] + ' ' + nf(s.prices[c])).join('／')}`).join('；')}${v.reason ? `<span class="hint">・${esc(v.reason)}</span>` : ''}</div>`).join('') + `</div>` : `<div class="hint">還沒有調價紀錄（目前售價＝菜單原值）</div>`)
    h += `<div style="font-weight:800;margin-top:12px">成本歷史</div><div class="hint">看連結食譜的「成本」分頁：每小時同步後價格／換算／配方有變就寫一筆快照並標差異行。${it.recipeKey ? `<button class="mini" style="margin-left:6px" onclick="document.getElementById('prOv').remove();openKey=null;rcpLoad().then(()=>_rcpOpen('${esc(it.recipeKey)}'))">開食譜</button>` : ''}</div>`
    return h
  }

  async function post (body) {
    const r = await fetch('/api/mail-sync?pricing=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
    const j = await r.json().catch(() => ({ ok: false, error: '連線問題' }))
    if (!j.ok) alert(j.error || '沒成功')
    return j.ok
  }
  try { if ((location.hash || '').replace(/^#/, '').toLowerCase().startsWith('pricing')) setTimeout(() => { try { pricingLoad() } catch (_) {} }, 300) } catch (_) {}
})()
