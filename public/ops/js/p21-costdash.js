// 📊 /prep 第 21 塊（v4.70.34，2026-10-10）：產品與成本模組｜批次 5a「成本總覽（首頁）」＋「廠商與月帳」
// 規格 docs/COST_MODULE_SPEC.md §1、§6。資料 ?costdash=（api/_costdash.js；數字口徑沿用待處理中心 buildTodo／物料卡 buildCards）。
// UI 慣例：單色線條圖示、不用彩色 emoji、不用 prompt、編輯卡片要 ✓ 完成鈕；表格 .scroll + table.tight。
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString()
  const n1 = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 10) / 10).toString()
  const money = n => (n == null || isNaN(n)) ? '—' : 'NT$' + Math.round(n).toLocaleString()
  const ts = s => s ? String(s).slice(5, 16).replace('T', ' ') : '—'
  const I = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto">${d}</svg>`
  const IC = {
    chart: I('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
    alert: I('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    check: I('<polyline points="20 6 9 17 4 12"/>'), x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    truck: I('<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
    undo: I('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>'),
    trend: I('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  }
  const COL = { b: '#4DA3FF', g: '#3DBE6C', o: '#E8A657', y: '#E8C14E', p: '#B48CF2', r: '#F07373', m: '#8C98A8' }
  const SIG = { spike: '單點尖峰', step: '階梯變價', 'step-cross': '跨廠商同漲', digit: '差一位數', drift: '累計漂移', range: '高低差2倍', openweek: '開帳週錯價', curvslast: '現價≠最後叫貨價', pricelog: '改價紀錄', alternate: '一碼多單位', intmul: '整數倍', conserve: '金額守恆', gml11: 'g=ml 1:1', specmismatch: '規格≠換算', noconv: '缺換算', fromprice: '由價格轉入', noprice: '缺價', nosku: '缺料號', noinv: '無庫存資料', inactiveused: '停用品被引用', nocode: '行沒料號', incomplete: '食譜不完整', nocost: '白名單外不計成本', samename: '同名多代碼' }
  const TABC = { price: COL.r, unit: COL.o, gap: COL.y, merge: COL.p }
  const meQ = () => TK() ? '&me=' + encodeURIComponent(TK()) : ''
  let D = null, V = null, sub = 'dash', capOpen = false, vf = { brand: 'all', q: '', status: '啟用' }, vSel = null, vDetail = null, vYm = '', loadingV = false

  window.costdashLoad = async function (which) {
    curStore = 'costdash'; try { setTabs('costdash') } catch (_) {}
    try { document.getElementById('upd').textContent = '成本總覽' } catch (_) {}
    if (which) sub = which
    app.innerHTML = '<section><div class="hint" style="padding:22px">載入成本總覽…</div></section>'
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/mail-sync?costdash=' + encodeURIComponent(K) + meQ() + '&view=dash&r=' + Date.now()),
        fetch('/api/mail-sync?costdash=' + encodeURIComponent(K) + meQ() + '&view=vendors&r=' + Date.now()),
      ])
      D = await r1.json(); V = await r2.json()
    } catch (_) { D = D || { ok: false, error: '連線問題' }; V = V || { ok: false, error: '連線問題' } }
    if (!D.ok) { app.innerHTML = '<section><div class="err">' + esc(D.error || '讀不到成本總覽') + '</div>' + (/綁定|登入/.test(D.error || '') ? '<div class="hint" style="margin-top:10px;line-height:1.7">成本是內部資料，要先登入才看得到。<br>私訊 DD「登入碼」拿 4 位數 → 右上「登入」填入。</div>' : '') + '</section>'; return }
    render()
  }
  function render () {
    let h = `<h1 style="display:flex;align-items:center;gap:8px">${IC.chart} 成本總覽</h1><div class="sub">一眼看到哪裡有問題、影響多大；數字跟「物料庫 → 待處理／物料卡」同一套算法</div>`
    h += `<div style="display:flex;gap:8px;margin:14px 0 4px;flex-wrap:wrap"><button class="mini ${sub === 'dash' ? 'on' : ''}" onclick="_cdSub('dash')">${IC.chart} 總覽</button><button class="mini ${sub === 'vendors' ? 'on' : ''}" onclick="_cdSub('vendors')">${IC.truck} 廠商與月帳</button><button class="mini" style="margin-left:auto" onclick="costdashLoad()">${IC.undo} 重新整理</button></div>`
    h += '<div id="cdBody">' + (sub === 'dash' ? dash() : vendors()) + '</div>'
    app.innerHTML = h
  }
  window._cdSub = function (s) { sub = s; render() } // 整頁重畫＝子分頁按鈕亮燈跟著換

  // ── §1 總覽 ──
  const kcard = (val, label, sub2, color, onclick) => `<div class="kpi"${onclick ? ` onclick="${onclick}"` : ''} style="text-align:left${onclick ? ';cursor:pointer' : ''}"><div class="v" style="color:${color};font-size:26px">${val}</div><div class="l" style="font-size:14px;margin-top:2px">${label}${onclick ? ' ›' : ''}</div>${sub2 ? `<div class="sub2" style="line-height:1.5">${sub2}</div>` : ''}</div>`
  function dash () {
    const k = D.kpi, u = D.updated || {}
    const capTxt = k.overSet ? `已設 ${k.overSet}／${k.catsTotal} 品類` : '上限未設定'
    let h = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:10px 0">`
      + kcard(`${nf(k.menuComplete)}<span style="font-size:15px;color:var(--muted)"> ／ ${nf(k.menuTotal)}</span>`, '在賣餐點成本完整', `更新 ${ts(u.menu)}・${esc(k.menuSrc.split('；')[0])}`, COL.g)
      + kcard(nf(k.pending), '待處理件數', `要人決定的（含資訊級共 ${nf(k.pendingAll)}）・更新 ${ts(u.todo)}`, COL.r, "_cdGoTodo()")
      + kcard(k.overSet ? nf(k.over) : '未設定', '成本率超標', `${capTxt}${D.me && D.me.canEdit ? '・<u>點設定</u>' : ''}`, k.overSet ? (k.over ? COL.o : COL.g) : COL.m, D.me && D.me.canEdit ? '_cdCapTog()' : '')
      + kcard(nf(k.weekPrice), '本週變價數', `近 7 天偵測到的價格異常・更新 ${ts(u.todo)}`, COL.b, "_cdGoTodo()")
      + kcard(k.avgMargin != null ? n1(k.avgMargin) + '%' : '—', '平均毛利率', `在賣・非飲料・成本完整 ${nf(k.avgMarginN)} 道（不完整不計）・更新 ${ts(u.menu)}`, COL.p)
      + `</div>`
    if (capOpen) h += capCard()
    if (k.over) h += `<section><h2 style="margin:0 0 6px;font-size:16px">成本率超標（${nf(k.over)} 道）</h2><div class="hint" style="margin-bottom:8px">成本率＝阿桑 view 的 cost ÷ price；上限依品類由管理者設定。</div><div class="scroll"><table class="tight" style="min-width:480px"><thead><tr><th style="text-align:left">餐點</th><th style="text-align:left">品類</th><th>售價</th><th>成本</th><th>成本率</th><th>上限</th></tr></thead><tbody>`
      + D.over.map(o => `<tr><td style="text-align:left">${esc(o.name)}</td><td style="text-align:left;font-size:12px">${esc(o.cat)}</td><td>${nf(o.price)}</td><td>${nf(o.cost)}</td><td style="color:${COL.r};font-weight:800">${n1(o.ratio)}%</td><td class="hint">${n1(o.cap)}%</td></tr>`).join('') + `</tbody></table></div></section>`
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px">`
    // 本週成本變動
    h += `<section><h2 style="margin:0 0 4px;font-size:16px">${IC.trend} 本週成本變動</h2><div class="hint" style="margin-bottom:10px">依「每份成本增加多少錢」排序（決策 #16，不用漲幅 %）；是哪個物料造成、影響幾道在賣菜。點列開待處理。</div>`
    if (!D.weekChanges.length) h += '<div class="hint">近 7 天沒有偵測到變價。</div>'
    else h += `<div style="display:flex;flex-direction:column;gap:6px">` + D.weekChanges.map(w => `<div onclick="_cdGoTodo('${w.id}')" style="cursor:pointer;background:var(--soft);border-left:3px solid ${w.info ? COL.m : COL.r};border-radius:0 10px 10px 0;padding:8px 10px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(w.name)}</b><span class="hint" style="font-size:12px">${esc(w.code || '')}・${esc(w.supplier || '')}${w.sys ? '・' + esc(w.sys) : ''}</span><span style="font-size:11.5px;color:${w.info ? COL.m : COL.r};border:1px solid currentColor;border-radius:6px;padding:0 6px">${esc(SIG[w.signal] || w.signal)}</span><span class="hint" style="margin-left:auto;font-size:12px">${esc(w.date)}</span></div><div style="font-size:13.5px;margin-top:2px">${esc(w.title)}</div><div style="font-size:13px;margin-top:2px">${w.nMenus ? `<span style="color:${COL.o};font-weight:800">影響 ${w.nMenus} 道在賣菜</span>・最大每份 <b style="color:${COL.r}">${w.perServing > 0 ? '+' : ''}${n1(w.perServing)} 元</b>${w.menus.length ? `<span class="hint">（${w.menus.map(m => esc(m.menu)).join('、')}${w.nMenus > w.menus.length ? '…' : ''}）</span>` : ''}` : '<span class="hint">不影響在賣菜</span>'}</div></div>`).join('') + `</div>`
    h += `</section>`
    // 待處理前 10
    h += `<section><h2 style="margin:0 0 4px;font-size:16px">${IC.alert} 待處理前 10 筆</h2><div class="hint" style="margin-bottom:10px">影響在賣菜的優先，再依每份影響金額。點列開待處理中心。</div>`
    if (!D.top10.length) h += '<div class="hint">沒有待處理，太好了。</div>'
    else h += `<div style="display:flex;flex-direction:column;gap:6px">` + D.top10.map((t, i) => `<div onclick="_cdGoTodo('${t.id}')" style="cursor:pointer;background:var(--soft);border-left:3px solid ${TABC[t.tab] || COL.b};border-radius:0 10px 10px 0;padding:8px 10px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="hint" style="font-size:12px">${i + 1}</span><b>${esc(t.name)}</b><span class="hint" style="font-size:12px">${esc(t.supplier || '')}${t.sys ? '・' + esc(t.sys) : ''}</span><span style="font-size:11.5px;color:${TABC[t.tab] || COL.b};border:1px solid currentColor;border-radius:6px;padding:0 6px">${esc(SIG[t.signal] || t.signal)}</span><span class="hint" style="margin-left:auto;font-size:12px">${esc(t.date)}</span></div><div style="font-size:13.5px;margin-top:2px">${esc(t.title)}</div>${t.nMenus ? `<div style="font-size:13px;color:${COL.o}">影響 ${t.nMenus} 道・最大每份 ${t.perServing > 0 ? '+' : ''}${n1(t.perServing)} 元</div>` : ''}</div>`).join('') + `</div>`
    h += `</section></div>`
    h += `<div class="hint" style="margin-top:12px;line-height:1.7">資料時間：菜單成本 ${ts(u.menu)}（阿桑 /costs/menu）・主檔／叫貨 ${ts(u.todo)}（每小時同步）・叫貨序列自 ${esc(u.series || '—')}。</div>`
    return h
  }
  window._cdGoTodo = function (id) { try { location.hash = '#matlib-todo' } catch (_) {} if (window.matlibLoad) { matlibLoad().then(() => { try { if (window._mSub) _mSub('todo') } catch (_) {} if (id && window._ctOpen) setTimeout(() => { try { _ctOpen(id); const el = document.querySelector('#ctList section'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch (_) {} }, 1200) }) } }
  window._cdCapTog = function () { capOpen = !capOpen; const el = document.getElementById('cdBody'); if (el) el.innerHTML = dash() }
  function capCard () {
    return `<section style="padding:14px 16px"><h2 style="margin:0 0 4px;font-size:16px;display:flex;align-items:center;gap:8px">${IC.gear} 成本率上限（依品類）</h2><div class="hint" style="margin-bottom:10px">勾選＝啟用該品類的上限；沒勾＝「未設定」，不套任何預設值。超過上限的在賣餐點會進「成本率超標」。飲料類（阿桑 view 口徑不同）建議先不設。</div>`
      + `<div class="scroll"><table class="tight" style="min-width:520px"><thead><tr><th></th><th style="text-align:left">品類</th><th>在賣道數</th><th>成本完整</th><th>平均成本率</th><th>上限 %</th><th>目前超標</th></tr></thead><tbody>`
      + D.byCat.map((c, i) => `<tr${c.drink ? ' style="opacity:.6"' : ''}><td><input type="checkbox" id="cdCapOn${i}" ${c.cap != null ? 'checked' : ''} style="width:17px;height:17px"></td><td style="text-align:left">${esc(c.cat)}${c.drink ? ' <span class="hint" style="font-size:11px">飲料</span>' : ''}</td><td>${nf(c.n)}</td><td>${nf(c.nComplete)}</td><td>${c.avgRatio != null ? n1(c.avgRatio) + '%' : '<span class="mut">—</span>'}</td><td><input type="number" id="cdCapV${i}" data-cat="${esc(c.cat)}" value="${c.cap != null ? c.cap : ''}" min="1" max="100" placeholder="未設定" style="width:72px;border:1px solid var(--line);border-radius:8px;padding:5px 7px"></td><td>${c.cap != null ? (c.over ? `<b style="color:${COL.o}">${c.over}</b>` : '0') : '<span class="mut">未設定</span>'}</td></tr>`).join('')
      + `</tbody></table></div><div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap"><button class="mini on" onclick="cdCapSave()">${IC.check} 完成</button><button class="mini" onclick="_cdCapTog()">${IC.x} 取消</button><span class="hint">上次修改 ${ts(D.cfgUpdatedAt)}</span></div></section>`
  }
  window.cdCapSave = async function () {
    const caps = {}
    D.byCat.forEach((c, i) => { const on = document.getElementById('cdCapOn' + i), v = document.getElementById('cdCapV' + i); if (!on || !v) return; caps[c.cat] = (on.checked && v.value.trim() !== '') ? Number(v.value) : null })
    if (await post({ op: 'ratioCap', caps })) { capOpen = false; await costdashLoad('dash') }
  }

  // ── §6 廠商與月帳 ──
  function vendors () {
    if (!V || !V.ok) return '<section><div class="err">' + esc((V && V.error) || '讀不到廠商資料') + '</div></section>'
    const q = vf.q.toLowerCase()
    const rows = (V.vendors || []).filter(v => (vf.brand === 'all' || v.sys === vf.brand) && (vf.status === 'all' || v.status === vf.status) && (!q || v.name.toLowerCase().includes(q)))
    const totCur = rows.reduce((s, v) => s + (v.cur.amt || 0), 0)
    let h = `<section style="padding:12px 14px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input value="${esc(vf.q)}" oninput="_cdVf('q',this.value)" placeholder="搜尋廠商…" style="flex:1;min-width:160px;border:1px solid var(--line);border-radius:10px;padding:9px 12px">`
      + ['all', 'A Beach', 'GROUN:D'].map(b => `<button class="mini ${vf.brand === b ? 'on' : ''}" onclick="_cdVf('brand','${b}')">${b === 'all' ? '全部品牌' : b}</button>`).join('')
      + `<span style="width:6px"></span>` + ['啟用', 'all'].map(s => `<button class="mini ${vf.status === s ? 'on' : ''}" onclick="_cdVf('status','${s}')">${s === 'all' ? '含停用' : '啟用'}</button>`).join('') + `</div>`
    h += `<div class="hint" style="margin-top:8px;line-height:1.7">${rows.length} 家・${esc(V.ym)} 系統金額合計 <b>${money(totCur)}</b>（approved 叫貨「下單單價 × 數量」；單價 0／空不計；補單另列）。未稅廠商另顯示「含稅估」＝×1.05 四捨五入。廠商主檔更新 ${ts(V.updated.sup)}。</div></section>`
    h += `<section style="padding:12px"><div class="scroll"><table class="tight" style="min-width:860px"><thead><tr><th style="text-align:left">廠商</th><th>品牌</th><th>狀態</th><th>稅別</th><th style="text-align:left">結帳區間</th><th>供應品</th><th>最後採購</th><th>${esc(V.ym.slice(5))}月 系統金額</th><th>對帳</th><th style="text-align:left">叫貨日／休息</th></tr></thead><tbody>`
    for (const v of rows) {
      const rc = v.recon
      const recTxt = rc && rc.bill != null ? (rc.done ? `<span style="color:${COL.g}">完成</span>` : (rc.warn ? `<span style="color:${COL.r}" title="${esc(rc.warn)}">差 ${nf(rc.diff)}</span>` : `<span style="color:${COL.o}">差 ${nf(rc.diff)}</span>`)) : '<span class="mut">未填</span>'
      h += `<tr onclick="_cdVendor('${esc(v.key).replace(/'/g, '&#39;')}')" style="cursor:pointer${v.status === '停用' ? ';opacity:.55' : ''}"><td style="text-align:left"><b>${esc(v.name)}</b>${v.cat ? `<br><span class="hint" style="font-size:11px">${esc(v.cat)}</span>` : ''}</td><td style="font-size:12px">${esc(v.sys)}</td><td style="font-size:12px">${esc(v.status || '—')}</td><td style="font-size:12px">${v.taxExcl == null ? '—' : (v.taxExcl ? `<span style="color:${COL.o}">未稅</span>` : '含稅')}</td><td style="text-align:left;font-size:12px">${esc(v.bill || '—')}</td><td>${nf(v.nActive)}<span class="hint" style="font-size:11px">/${nf(v.nProducts)}</span></td><td class="hint" style="font-size:12px">${v.last ? esc(v.last.slice(5)) : '—'}</td>`
        + `<td><b>${v.cur.amt ? nf(v.cur.amt) : '<span class="mut">—</span>'}</b>${v.cur.incl != null && v.cur.amt ? `<br><span class="hint" style="font-size:11px">含稅估 ${nf(v.cur.incl)}</span>` : ''}${v.cur.unpriced ? `<br><span style="font-size:11px;color:${COL.o}">${v.cur.unpriced} 行無價</span>` : ''}${v.cur.bfAmt ? `<br><span class="hint" style="font-size:11px">補單 ${nf(v.cur.bfAmt)}</span>` : ''}</td><td style="font-size:12px">${recTxt}</td>`
        + `<td style="text-align:left;font-size:11.5px" class="hint">${(v.orderDays || []).length ? '週' + v.orderDays.map(d => '日一二三四五六'[d] || d).join('') : '—'}${(v.restDays || []).length ? `・休 ${v.restDays.slice(0, 3).map(esc).join('、')}${v.restDays.length > 3 ? '…' : ''}` : ''}</td></tr>`
    }
    h += `</tbody></table></div></section>`
    return h
  }
  window._cdVf = function (k, v) { vf[k] = v; const el = document.getElementById('cdBody'); if (el) el.innerHTML = vendors() }
  window._cdVendor = async function (key) {
    vSel = key; vDetail = null
    openModal(`<div class="hint" style="padding:16px">載入 ${esc(key.slice(2))} 的明細…</div>`, 760)
    try { const r = await fetch('/api/mail-sync?costdash=' + encodeURIComponent(K) + meQ() + '&view=vendors&vendor=' + encodeURIComponent(key) + (vYm ? '&ym=' + vYm : '') + '&r=' + Date.now()); const j = await r.json(); if (j.ok) { vDetail = j.detail; Object.assign(V, { vendors: j.vendors }) } } catch (_) {}
    const ov = document.querySelector('.cdModal:last-of-type'); if (ov) ov.querySelector('.cdInner').innerHTML = vendorDetail()
  }
  function openModal (inner, maxw) {
    const ov = document.createElement('div'); ov.className = 'cdModal'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px'
    ov.onclick = () => ov.remove()
    ov.innerHTML = `<div class="cdInner" onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:${maxw || 560}px;width:100%;max-height:90vh;overflow:auto;padding:16px 18px">${inner}</div>`
    document.body.appendChild(ov); return ov
  }
  function vendorDetail () {
    const d = vDetail; if (!d) return '<div class="err">讀不到這家廠商</div>'
    const v = (V.vendors || []).find(x => x.key === d.key) || {}
    const can = V.me && V.me.canEdit
    let h = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div style="font-size:19px;font-weight:800;color:var(--ink)">${esc(d.name)}</div><div class="hint" style="margin-top:2px">${esc(d.sys)}・${esc(v.status || '')}・${v.taxExcl == null ? '' : (v.taxExcl ? '未稅' : '含稅')}・${esc(v.bill || '—')}${v.minOrder ? '・最低訂購 ' + nf(v.minOrder) : ''}</div></div><button class="mini" onclick="this.closest('.cdModal').remove()">${IC.x}</button></div>`
    // 月帳對帳
    h += `<h2 style="font-size:15px;margin:14px 0 6px">月帳對帳（本模組）</h2><div class="hint" style="margin-bottom:8px">系統金額＝該月 approved 叫貨「單價 × 數量」（含補單，單價 0 不計）；廠商帳單填「未稅」＋「稅額」兩格，系統自動加總比對（消除未稅廠商固定 5% 的假差額）。帳單為負或差 >50% 會提醒。</div>`
    h += `<div class="scroll"><table class="tight" style="min-width:640px"><thead><tr><th>月份</th><th>系統金額</th><th>張數/行</th><th>帳單未稅</th><th>稅額</th><th>帳單合計</th><th>差額</th><th>狀態</th></tr></thead><tbody>`
    d.recon.forEach((r, i) => {
      const warn = r.warn ? `<div style="font-size:11px;color:${COL.r}">${esc(r.warn)}</div>` : ''
      h += `<tr><td>${esc(r.ym)}</td><td><b>${nf(r.sys)}</b>${r.incl != null && r.sys ? `<br><span class="hint" style="font-size:11px">含稅估 ${nf(r.incl)}</span>` : ''}${r.unpriced ? `<br><span style="font-size:11px;color:${COL.o}">${r.unpriced} 行無價</span>` : ''}</td><td class="hint" style="font-size:12px">${nf(r.n)}/${nf(r.lines)}${r.bfLines ? `<br>補單 ${r.bfLines} 行 ${nf(r.bfAmt)}` : ''}</td>`
        + (can ? `<td><input type="number" id="cdEx${i}" value="${r.exTax != null ? r.exTax : ''}" placeholder="未稅" style="width:92px;border:1px solid var(--line);border-radius:8px;padding:5px 7px"></td><td><input type="number" id="cdTax${i}" value="${r.tax != null ? r.tax : ''}" placeholder="稅額" style="width:80px;border:1px solid var(--line);border-radius:8px;padding:5px 7px"></td>` : `<td>${r.exTax != null ? nf(r.exTax) : '—'}</td><td>${r.tax != null ? nf(r.tax) : '—'}</td>`)
        + `<td>${r.bill != null ? nf(r.bill) : '<span class="mut">—</span>'}</td><td>${r.diff != null ? `<b style="color:${r.diff === 0 ? COL.g : (Math.abs(r.pct || 0) > 50 ? COL.r : COL.o)}">${nf(r.diff)}</b>${r.pct != null ? `<span class="hint" style="font-size:11px"> ${n1(r.pct)}%</span>` : ''}${warn}` : '<span class="mut">—</span>'}</td>`
        + `<td style="font-size:12px">${can ? `<label style="white-space:nowrap"><input type="checkbox" id="cdDone${i}" ${r.done ? 'checked' : ''}> 完成</label><br><button class="mini" style="padding:2px 8px;margin-top:3px" onclick="cdReconSave('${esc(d.sys)}','${esc(d.name).replace(/'/g, '&#39;')}','${r.ym}',${i})">${IC.check} 存</button>` : (r.done ? `<span style="color:${COL.g}">完成</span>` : (r.bill != null ? '未完成' : '<span class="mut">未填</span>'))}${r.by ? `<div class="hint" style="font-size:11px">${esc(r.by)} ${ts(r.at)}</div>` : ''}</td></tr>`
    })
    h += `</tbody></table></div>`
    // 供應品
    h += `<h2 style="font-size:15px;margin:14px 0 6px">供應品（${d.products.length}）</h2><div class="scroll"><table class="tight" style="min-width:560px"><thead><tr><th style="text-align:left">代碼</th><th style="text-align:left">品名</th><th>單位</th><th>主檔現價</th><th>最後叫貨</th><th>狀態</th></tr></thead><tbody>`
      + d.products.slice(0, 200).map(p => `<tr onclick="_cdOpenCard('${esc(p.cardId).replace(/'/g, '&#39;')}')" style="cursor:pointer${p.active ? '' : ';opacity:.55'}"><td style="text-align:left;font-size:12px">${esc(p.code)}${p.sku ? `<br><span class="hint" style="font-size:11px">${esc(p.sku)}</span>` : ''}</td><td style="text-align:left">${esc(p.name)}${p.cat ? `<br><span class="hint" style="font-size:11px">${esc(p.cat)}</span>` : ''}</td><td>${esc(p.unit || '')}</td><td>${p.price != null ? nf(p.price) : '<span class="mut">—</span>'}</td><td>${p.lastPrice != null ? `${nf(p.lastPrice)}<br><span class="hint" style="font-size:11px">${esc(p.lastDate.slice(5))}</span>` : '<span class="mut">—</span>'}</td><td style="font-size:12px">${p.active ? '啟用' : '停用'}</td></tr>`).join('') + `</tbody></table></div>${d.products.length > 200 ? '<div class="hint">只列前 200 項</div>' : ''}`
    // 報價歷史
    h += `<h2 style="font-size:15px;margin:14px 0 6px">報價歷史（叫貨序列，${d.quotes.length} 項）</h2><div class="hint" style="margin-bottom:6px">每張單一點；變動次數＝相鄰單價不同的次數。</div><div class="scroll"><table class="tight" style="min-width:600px"><thead><tr><th style="text-align:left">物料</th><th>張數</th><th>首價</th><th>最新</th><th>首→最新</th><th>低/高</th><th>變動</th><th style="text-align:left">近期</th></tr></thead><tbody>`
      + d.quotes.slice(0, 120).map(q => `<tr><td style="text-align:left">${esc(q.name)}<br><span class="hint" style="font-size:11px">${esc(q.code)}／${esc(q.unit)}</span></td><td>${q.n}</td><td>${nf(q.first)}<br><span class="hint" style="font-size:10.5px">${esc(q.firstDate.slice(5))}</span></td><td><b>${nf(q.last)}</b><br><span class="hint" style="font-size:10.5px">${esc(q.lastDate.slice(5))}</span></td><td style="color:${q.pct > 0 ? COL.r : (q.pct < 0 ? COL.g : 'var(--muted)')};font-weight:800">${q.pct == null ? '—' : (q.pct > 0 ? '+' : '') + n1(q.pct) + '%'}</td><td class="hint" style="font-size:12px">${nf(q.min)}/${nf(q.max)}</td><td>${q.changes ? `<b style="color:${q.changes >= 3 ? COL.o : 'var(--ink)'}">${q.changes}</b>` : '0'}</td><td style="text-align:left;font-size:11px" class="hint">${q.series.map(p => p.d.slice(5) + ':' + p.p).join(' → ')}</td></tr>`).join('') + `</tbody></table></div>`
    // 採購單
    h += `<h2 style="font-size:15px;margin:14px 0 6px">採購單（近 3 個月，${d.orders.length} 張）</h2><div class="scroll"><table class="tight" style="min-width:480px"><thead><tr><th style="text-align:left">日期</th><th>狀態</th><th>行數</th><th>金額</th><th>無價行</th><th class="hint">單號</th></tr></thead><tbody>`
      + d.orders.slice(0, 150).map(o => `<tr onclick="_cdOpenOrder('${esc(o.id)}')" style="cursor:pointer${o.status === 'approved' ? '' : ';opacity:.6'}"><td style="text-align:left">${esc(o.date)}</td><td style="font-size:12px">${esc({ approved: '已核准', pending: '待審', rejected: '退回', received: '已收' }[o.status] || o.status)}</td><td>${nf(o.lines)}</td><td>${o.total != null ? nf(o.total) : '—'}</td><td>${o.unpriced ? `<span style="color:${COL.o}">${o.unpriced}</span>` : '0'}</td><td class="hint" style="font-size:10.5px">${esc(String(o.id).slice(0, 8))}</td></tr>`).join('') + `</tbody></table></div>`
    return h
  }
  window._cdOpenCard = function (cardId) { if (window._mcOpen && window.matcardFetch) { if (!window.MC_READY_FLAG) { /* 物料卡沒載過：先進物料庫物料卡分頁再開 */ } try { location.hash = '#matlib-card' } catch (_) {} if (window.matlibLoad) matlibLoad().then(() => { try { _mSub('card') } catch (_) {} setTimeout(() => { try { _mcOpen(cardId) } catch (_) {} }, 1500) }) } else alert('物料卡模組沒載入') }
  window._cdOpenOrder = function (id) { if (window._mOrdDetail) { try { _mOrdDetail(id) } catch (_) { alert('先到物料庫載入叫貨單後再點') } } }
  window.cdReconSave = async function (sys, supplier, ym, i) {
    const g = id => { const e = document.getElementById(id); return e ? e.value.trim() : '' }
    const done = (document.getElementById('cdDone' + i) || {}).checked || false
    if (await post({ op: 'recon', sys, supplier, ym, exTax: g('cdEx' + i), tax: g('cdTax' + i), done })) { await _cdVendor(vSel) }
  }
  async function post (body) {
    const r = await fetch('/api/mail-sync?costdash=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
    const j = await r.json().catch(() => ({ ok: false, error: '連線問題' }))
    if (!j.ok) alert(j.error || '沒成功')
    return j.ok
  }
  // 深層連結 #costdash / #costdash-vendors
  try { const hsh = (location.hash || '').replace(/^#/, '').toLowerCase(); if (hsh.startsWith('costdash')) setTimeout(() => { try { costdashLoad(/vendor/.test(hsh) ? 'vendors' : 'dash') } catch (_) {} }, 350) } catch (_) {}
})()
