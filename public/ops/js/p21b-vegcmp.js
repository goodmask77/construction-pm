// 🥬 /prep 第 21b 塊（v4.70.70，2026-10-12）：成本總覽 → 「菜商比價」子分頁
//   張良 2026-10-12：上展／尚太每月報價騰上系統、兩家並排看差異、對照市場行情（台北一市批發月均）看歷史波動、
//   核對偵錯中心價格異常（對上就一鍵確認不再出現，對不上留給他）、抓 ops 叫貨單價格沒更新。
//   資料口 ?vegcmp（api/_vegquote.js）；曲線一律 lineChart（p01-core）；單色線條圖示、不用 prompt。
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 10) / 10).toLocaleString()
  const I = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto">${d}</svg>`
  const IC = { leaf: I('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>'), check: I('<polyline points="20 6 9 17 4 12"/>'), x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'), warn: I('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'), undo: I('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>'), dn: I('<polyline points="6 9 12 15 18 9"/>'), up: I('<polyline points="18 15 12 9 6 15"/>'), trend: I('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'), pin: I('<path d="M12 17v5"/><path d="M9 10.8V5h6v5.8l2 2.2H7z"/>'), pinOn: I('<path d="M12 17v5"/><path d="M9 10.8V5h6v5.8l2 2.2H7z" fill="currentColor"/>') }
  const COL = { a: '#4DA3FF', b: '#E8A657', m: '#8C98A8', g: '#3DBE6C', r: '#F07373', p: '#B48CF2', y: '#E8C14E' }
  const VC = { 尚太: COL.a, 上展: COL.b }
  const TKf = () => (typeof TK === 'function' ? TK() : '')
  let D = null, view = 'cmp', f = { cat: '營運', both: true, q: '', sort: 'pct', dir: 'desc' }, open = new Set(), busy = false, msg = '', pins = new Set()

  // v4.70.70 不要卡：①先用上次快取的畫面秒開，背景抓最新 ②核對那包（偵錯中心，慢 5 秒）分開載，進核對頁或背景補
  const CK = 'vegCmpCache'
  let chkLoading = false
  async function load (force, chk) {
    if (D && !force && !chk) return D
    if (!D && !force) { try { const c = JSON.parse(localStorage.getItem(CK) || 'null'); if (c && c.ok && c.items) { D = c; D._stale = true; pins = new Set(D.pins || []) } } catch (_) {} }
    try { const r = await fetch('/api/mail-sync?vegcmp=' + encodeURIComponent(K) + (TKf() ? '&me=' + encodeURIComponent(TKf()) : '') + (chk ? '&chk=1' : '') + '&r=' + Date.now()); const j = await r.json(); if (j.ok && !chk && D && D.chkLoaded) { j.anomalies = D.anomalies; j.anomSummary = D.anomSummary; j.chkLoaded = true } D = j } catch (_) { if (!D || !D.ok) D = { ok: false, error: '連線問題' } }
    if (D && D.ok) { try { const { anomalies, ...slim } = D; localStorage.setItem(CK, JSON.stringify({ ...slim, chkLoaded: false, _savedAt: Date.now() })) } catch (_) {} }
    if (D && D.ok) { pins = new Set(D.pins || []); try { if (!(D.me && D.me.canDecide)) pins = new Set(JSON.parse(localStorage.getItem('vegPins') || '[]')) } catch (_) {} } // 有採購權限＝共用釘選；沒有＝存自己這台
    return D
  }
  window._vgPin = async (k, ev) => { if (ev) ev.stopPropagation(); const on = !pins.has(k); if (on) pins.add(k); else pins.delete(k); paint(); if (D.me && D.me.canDecide) { const j = await post({ op: 'pin', key: k, on }); if (j.ok) pins = new Set(j.pins) } else { try { localStorage.setItem('vegPins', JSON.stringify([...pins])) } catch (_) {} } }
  window._vgSort = k => { if (f.sort === k) f.dir = f.dir === 'desc' ? 'asc' : 'desc'; else { f.sort = k; f.dir = k === 'name' ? 'asc' : 'desc' } paint() }
  async function post (body) { const r = await fetch('/api/mail-sync?vegcmp=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TKf() }) }); return r.json().catch(() => ({ ok: false, error: '連線問題' })) }
  const paint = () => { const el = document.getElementById('cdBody'); if (el) el.innerHTML = render() }

  async function loadChk () { if (chkLoading || (D && D.chkLoaded)) return; chkLoading = true; await load(true, true); chkLoading = false; paint() }
  window.vegView = function () {
    if (!D || D._stale) { const had = !!D; load().then(() => { paint(); if (D.ok && D.me && D.me.canDecide && mktStale() && !autoMkt) { autoMkt = true; _vgMarket() } if (D.ok && !D.chkLoaded) loadChk() }); if (had) return render(); return '<section><div class="hint" style="padding:22px">載入菜商報價…</div></section>' }
    return render()
  }
  window._vgView = v => { view = v; paint() }
  window._vgF = (k, v) => { f[k] = (k === 'both') ? !f.both : v; paint() }
  window._vgQ = v => { f.q = v; const el = document.getElementById('vgTbl'); if (el) el.innerHTML = table() }
  window._vgOpen = k => { if (open.has(k)) open.delete(k); else open.add(k); paint() }
  window._vgReload = async () => { msg = ''; await load(true); paint() }
  let autoMkt = false
  window._vgMarket = async () => { busy = true; msg = '抓農業部行情中（分批、約 1～3 分鐘，抓到哪存到哪）…'; paint(); const j = await post({ op: 'refreshMarket' }); busy = false; msg = j.ok ? `行情已更新：${j.nCrops} 種作物${j.nSkip ? '，還有 ' + j.nSkip + ' 種下次接著抓' : ''}${(j.errs || []).length ? '，' + j.errs.length + ' 種抓失敗' : ''}` : (j.error || '沒成功'); await load(true); paint() }
  window._vgSync = async () => { busy = true; msg = '直接讀兩家 Google 試算表中…'; paint(); const j = await post({ op: 'sync' }); busy = false; if (!j.ok) msg = j.error || '沒成功'; else msg = j.vendors.map(x => x.ok ? `${x.vendor}：讀到 ${x.nRows} 列、${x.months[0].slice(2)}～${x.months[x.months.length - 1].slice(2)}，${x.changes.length ? x.changes.length + ' 筆價格更新' + (x.added.length ? '、新品項 ' + x.added.length : '') : '沒有變動'}` : `${x.vendor}：失敗（${x.error}）`).join('；'); await load(true); paint() }
  const mktStale = () => !D.market.fetchedAt || (Date.now() - Date.parse(D.market.fetchedAt)) > 24 * 3600e3 || (D.market.nCrops < (D.market.nMapped || 0))
  window._vgConfirm = async () => { const n = (D.anomSummary || {}).hit || 0; if (!n) return; if (!confirm(`把 ${n} 筆「跟報價單對上」的價格異常一次確認正確？（偵錯中心逐筆留紀錄，可復原）`)) return; busy = true; msg = '確認中…'; paint(); const j = await post({ op: 'confirm' }); busy = false; msg = j.ok ? `已確認 ${j.done.length} 筆${j.skipped.length ? '，略過 ' + j.skipped.length + ' 筆' : ''}` : (j.error || '沒成功'); await load(true); paint() }

  function render () {
    if (!D.ok) return `<section><div class="err">${esc(D.error || '讀不到菜商報價')}</div></section>`
    const imp = D.imported || {}
    let h = `<section style="padding:12px 14px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:16px">${IC.leaf} 菜商比價</b>`
      + ['cmp', '比價表', 'ana', '走勢分析', 'chk', '核對'].reduce((s, v, i, a) => i % 2 ? s : s + `<button class="mini ${view === v ? 'on' : ''}" onclick="_vgView('${v}')">${a[i + 1]}${v === 'chk' && D.chkLoaded && (D.anomSummary || {}).hit ? ` <span style="background:${COL.g};color:#000;border-radius:8px;padding:0 6px;font-size:11px">${D.anomSummary.hit}</span>` : ''}</button>`, '')
      + `<span style="margin-left:auto"></span><button class="mini" onclick="_vgReload()">${IC.undo}</button></div>`
    h += `<div class="hint" style="margin-top:6px;line-height:1.7">報價：${D.vendors.map(v => `<b style="color:${VC[v]}">${v}</b> ${imp[v] && imp[v].n ? imp[v].n + ` 項（${esc(String(imp[v].at || '').slice(0, 10))} 匯入）` : '<span style="color:' + COL.r + '">尚未匯入</span>'}`).join('・')}；市場行情＝農業部「${esc(D.market.market)}」批發月均（${D.market.fetchedAt ? esc(String(D.market.fetchedAt).slice(0, 16).replace('T', ' ')) : '未抓'}，${D.market.nCrops} 種作物）${D.me && D.me.canDecide ? ` <span onclick="_vgMarket()" style="text-decoration:underline;cursor:pointer">重抓行情</span>` : ''}。單位都是元／公斤（報價＝到店價、行情＝批發價，看走勢不比絕對值）。<br>報價來源＝兩家的 Google 試算表，每天早上 8 點自動讀一次，有變動 DD 私訊你${D.sync ? `（上次讀取 ${esc(String(D.sync.at).slice(0, 16).replace('T', ' '))}：${esc((D.sync.summary || []).join('、'))}）` : ''}${D.me && D.me.canDecide ? ` <button class="mini" ${busy ? 'disabled' : ''} onclick="_vgSync()">${IC.undo} 現在重新讀取報價單</button>` : ''}${msg ? `<div style="color:${COL.y}">${esc(msg)}</div>` : ''}</div></section>`
    if (D._stale) h += `<div class="hint" style="padding:0 14px 6px;font-size:12px">⚡ 先顯示上次的畫面，最新資料背景更新中…</div>`
    h += view === 'cmp' ? cmp() : view === 'ana' ? ana() : chk()
    return h
  }

  // ── 篩選 ──
  const CATS = ['營運', '員餐', '其他']
  const catOf = r => r.cat === '營運' ? '營運' : r.cat === '員餐' ? '員餐' : '其他'
  const lastOf = m => { const ks = Object.keys(m || {}).sort(); return ks.length ? m[ks[ks.length - 1]] : null }
  const latestMkt = r => { if (!r.mkt) return null; const ks = Object.keys(r.mkt).sort(); return ks.length ? r.mkt[ks[ks.length - 1]] : null }
  // 可排序欄位：key → 取值（null 一律排最後）
  const SORTV = {
    name: r => r.name, ym: r => (r.latest || {}).ym || '', a: r => r.s.尚太 ? ((r.latest || {}).尚太 != null ? r.latest.尚太 : lastOf(r.s.尚太)) : null, b: r => r.s.上展 ? ((r.latest || {}).上展 != null ? r.latest.上展 : lastOf(r.s.上展)) : null,
    pct: r => (r.latest || {}).pct == null ? null : Math.abs(r.latest.pct), diff: r => (r.latest || {}).pct == null ? null : r.latest.pct, cheap: r => (r.latest || {}).cheaper || '',
    recent: r => r.stat ? (r.stat.上展便宜 - r.stat.尚太便宜) : null, qa: r => (r.qty3 || {}).尚太 || 0, qb: r => (r.qty3 || {}).上展 || 0, save: r => (r.save || {}).total || 0,
    vola: r => (r.vol尚太 || {}).pct == null ? null : r.vol尚太.pct, volb: r => (r.vol上展 || {}).pct == null ? null : r.vol上展.pct, mkt: r => latestMkt(r), vol: r => Math.max((r.vol尚太 || {}).pct || 0, (r.vol上展 || {}).pct || 0)
  }
  function rows () {
    const q = f.q.trim().toLowerCase()
    const rs = D.items.filter(r => (f.cat === 'all' || catOf(r) === f.cat) && (!f.both || r.both) && (!q || r.name.toLowerCase().includes(q)))
    const g = SORTV[f.sort] || SORTV.pct, dir = f.dir === 'asc' ? 1 : -1
    rs.sort((a, b) => {
      const pa = pins.has(a.key) ? 0 : 1, pb = pins.has(b.key) ? 0 : 1; if (pa !== pb) return pa - pb
      const va = g(a), vb = g(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'zh-Hant') * dir
      return (va - vb) * dir
    })
    return rs
  }
  const th = (k, label, extra) => `<th ${extra || ''} onclick="_vgSort('${k}')" style="cursor:pointer;white-space:nowrap;${f.sort === k ? 'color:var(--ink)' : ''}">${label}${f.sort === k ? (f.dir === 'desc' ? ' ' + IC.dn : ' ' + IC.up) : ''}</th>`
  function filters () {
    const cnt = c => D.items.filter(r => (c === 'all' || catOf(r) === c) && (!f.both || r.both)).length
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">` + [['all', '全部'], ...CATS.map(c => [c, c])].map(([v, l]) => `<button class="mini ${f.cat === v ? 'on' : ''}" onclick="_vgF('cat','${v}')">${l}<span style="margin-left:4px;font-size:11px;opacity:.8">${cnt(v)}</span></button>`).join('')
      + `<span style="width:1px;height:20px;background:var(--line)"></span><button class="mini ${f.both ? 'on' : ''}" onclick="_vgF('both')">只看兩家都有</button>`
      + (pins.size ? `<span class="hint" style="font-size:12px">${IC.pin} 已釘 ${pins.size} 項（置頂）</span>` : '')
      + `<input value="${esc(f.q)}" oninput="_vgQ(this.value)" placeholder="搜尋品項…" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:8px;padding:6px 10px"></div>`
  }
  const pctTag = (p, inv) => p == null ? '<span class="mut">—</span>' : `<b style="color:${Math.abs(p) < 3 ? COL.m : ((p > 0) !== !!inv ? COL.r : COL.g)}">${p > 0 ? '+' : ''}${nf(p)}%</b>`
  const cheapTag = c => c ? `<span style="color:${c === '一樣' ? COL.m : VC[c]};font-weight:800">${c}</span>` : '<span class="mut">—</span>'

  // ── 比價表 ──
  function cmp () {
    return `<section style="padding:12px 14px">${filters()}<div id="vgTbl">${table()}</div></section>`
  }
  function table () {
    const rs = rows(); if (!rs.length) return '<div class="hint" style="padding:16px;text-align:center">沒有符合的品項</div>'
    const mos = D.months.slice(-12)
    let h = `<div class="hint" style="margin-bottom:6px">${rs.length} 項・點欄位名稱排序（再點一次反向）・點 ${IC.pin} 釘選置頂・點品項展開逐月價格、叫貨量與走勢圖。「差」＝尚太 − 上展（紅＝尚太貴、綠＝尚太便宜）；叫貨量＝近 3 個月兩店合計；「叫便宜的可省」＝近 3 個月若都跟便宜那家叫，省多少。</div><div class="scroll"><table class="tight" style="min-width:1180px"><thead><tr><th style="width:26px;position:sticky;left:0;background:var(--card);z-index:2"></th>${th('name', '品項', 'style="text-align:left;position:sticky;left:26px;background:var(--card);z-index:2;min-width:110px"')}<th>規格</th>${th('ym', '最新月')}${th('a', '尚太', `style="color:${VC.尚太}"`)}${th('b', '上展', `style="color:${VC.上展}"`)}${th('diff', '差')}${th('cheap', '便宜')}${th('recent', '近期誰便宜')}${th('qa', '叫貨 尚太', `style="color:${VC.尚太}"`)}${th('qb', '叫貨 上展', `style="color:${VC.上展}"`)}${th('save', '叫便宜的可省')}${th('vola', '波動 尚太')}${th('volb', '波動 上展')}${th('mkt', '市場月均')}</tr></thead><tbody>`
    for (const r of rs) {
      const L = r.latest || {}, st = r.stat, mkv = latestMkt(r), mkYm = r.mkt ? Object.keys(r.mkt).sort().pop() : null
      const o = open.has(r.key), pinned = pins.has(r.key), sv = r.save || {}
      const stk = `position:sticky;background:${pinned ? 'var(--psoft)' : 'var(--card)'};z-index:1`
      h += `<tr style="cursor:pointer${pinned ? ';background:var(--psoft)' : ''}" onclick="_vgOpen('${esc(r.key)}')"><td style="${stk};left:0"><span onclick="_vgPin('${esc(r.key)}',event)" title="${pinned ? '取消釘選' : '釘選置頂'}" style="color:${pinned ? COL.y : 'var(--muted)'};cursor:pointer">${pinned ? IC.pinOn : IC.pin}</span></td><td style="text-align:left;${stk};left:26px;min-width:110px"><b>${esc(r.name)}</b>${r.both ? '' : ` <span class="hint" style="font-size:11px">只有${r.s.尚太 ? '尚太' : '上展'}</span>`}${r.crop ? ` <span class="hint" style="font-size:11px">${IC.trend}</span>` : ''}</td><td class="mut">${esc(r.spec || '')} ${esc(r.unit || '')}</td><td>${L.ym ? esc(L.ym.slice(2).replace('-', '/')) : '—'}</td><td style="color:${VC.尚太};font-weight:800">${r.s.尚太 ? nf(L.尚太 != null ? L.尚太 : lastOf(r.s.尚太)) : '—'}</td><td style="color:${VC.上展};font-weight:800">${r.s.上展 ? nf(L.上展 != null ? L.上展 : lastOf(r.s.上展)) : '—'}</td><td>${L.diff != null ? (L.diff > 0 ? '+' : '') + nf(L.diff) + ' ' + pctTag(L.pct) : '—'}</td><td>${cheapTag(L.cheaper)}</td><td class="hint" style="font-size:12px">${st ? `<span style="color:${VC.尚太}">尚太 ${st.尚太便宜}</span>／<span style="color:${VC.上展}">上展 ${st.上展便宜}</span>${st.一樣 ? '／同 ' + st.一樣 : ''} 月` : '—'}</td><td style="color:${VC.尚太}">${r.qty3 && r.qty3.尚太 ? nf(r.qty3.尚太) + ` <span class="hint" style="font-size:11px">${esc(r.qtyUnit)}</span>` : '<span class="mut">—</span>'}</td><td style="color:${VC.上展}">${r.qty3 && r.qty3.上展 ? nf(r.qty3.上展) + ` <span class="hint" style="font-size:11px">${esc(r.qtyUnit)}</span>` : '<span class="mut">—</span>'}</td><td>${sv.total ? `<b style="color:${COL.g}">${sv.total.toLocaleString()} 元</b> <span class="hint" style="font-size:11px">改叫${esc(sv.to)}</span>` : (r.both ? '<span class="mut">0</span>' : '<span class="mut">—</span>')}</td><td class="hint" style="font-size:12px">${volTag(r.vol尚太)}</td><td class="hint" style="font-size:12px">${volTag(r.vol上展)}</td><td>${mkv != null ? nf(mkv) + ` <span class="hint" style="font-size:11px">${mkYm.slice(5)}月</span>` : '<span class="mut">—</span>'}</td></tr>`
      if (o) h += `<tr><td colspan="15" style="padding:8px 10px;background:var(--soft)">${detail(r)}</td></tr>`
    }
    return h + '</tbody></table></div>'
  }
  const volTag = v => v ? `${nf(v.min)}～${nf(v.max)} <b style="color:${(v.pct || 0) >= 100 ? COL.r : (v.pct || 0) >= 50 ? COL.y : COL.m}">${v.pct == null ? '' : v.pct + '%'}</b>` : '—'
  function detail (r) {
    const mos = D.months
    const series = []
    for (const v of D.vendors) if (r.s[v]) series.push({ name: v, vals: mos.map(m => r.s[v][m] == null ? null : r.s[v][m]), color: VC[v] })
    if (r.mkt) series.push({ name: '市場 ' + r.crop, vals: mos.map(m => r.mkt[m] == null ? null : r.mkt[m]), color: COL.m })
    let h = `<div style="display:grid;grid-template-columns:1fr;gap:10px">`
    h += `<div>${typeof lineChart === 'function' ? lineChart({ labels: mos.map(m => m.slice(2).replace('-', '/')), series, yFmt: v => nf(v), zero: true, h: 170 }) : ''}</div>`
    h += `<div class="scroll"><table class="tight" style="min-width:600px"><thead><tr><th style="text-align:left"></th>${mos.map(m => `<th>${m.slice(2).replace('-', '/')}</th>`).join('')}</tr></thead><tbody>`
    for (const v of D.vendors) if (r.s[v]) h += `<tr><td style="text-align:left;color:${VC[v]};font-weight:800">${v}</td>${mos.map(m => `<td>${r.s[v][m] == null ? '<span class="mut">—</span>' : nf(r.s[v][m])}</td>`).join('')}</tr>`
    if (r.both) h += `<tr><td style="text-align:left">差（尚太−上展）</td>${mos.map(m => { const a = r.s.尚太[m], b = r.s.上展[m]; if (a == null || b == null) return '<td class="mut">—</td>'; const d = a - b; return `<td style="color:${d > 0 ? COL.r : d < 0 ? COL.g : COL.m}">${d > 0 ? '+' : ''}${nf(d)}</td>` }).join('')}</tr>`
    if (r.mkt) h += `<tr><td style="text-align:left;color:${COL.m}">市場月均</td>${mos.map(m => `<td class="mut">${r.mkt[m] == null ? '—' : nf(r.mkt[m])}</td>`).join('')}</tr>`
    for (const v of D.vendors) if (r.qty && r.qty[v]) h += `<tr><td style="text-align:left;color:${VC[v]}">叫貨量 ${v} <span class="hint" style="font-size:11px">${esc(r.qtyUnit)}</span></td>${mos.map(m => `<td>${r.qty[v][m] ? nf(r.qty[v][m]) : '<span class="mut">—</span>'}</td>`).join('')}</tr>`
    if (r.save && r.save.total) h += `<tr><td style="text-align:left;color:${COL.g}">叫便宜的可省</td>${mos.map(m => `<td style="color:${COL.g}">${r.save.byYm[m] ? r.save.byYm[m].toLocaleString() : '<span class="mut">—</span>'}</td>`).join('')}</tr>`
    h += `</tbody></table></div><div class="hint" style="font-size:12px">叫貨量＝A Beach＋GROUN:D 叫貨單合計（近 ${(D.orders || {}).months ? D.orders.months.length : 6} 個月）；可省＝那個月跟貴的那家叫的量 × 兩家價差。</div>${r.crop ? `<div class="hint" style="font-size:12px">市場對照作物：${esc(r.crop)}（台北一市批發月均，元／公斤）。對錯了跟 CC 說。</div>` : `<div class="hint" style="font-size:12px">這個品項還沒對到農業部作物名（市場行情只有生鮮蔬果有）。</div>`}</div>`
    return h
  }

  // ── 走勢分析 ──
  function ana () {
    const both = D.items.filter(r => r.both && r.latest)
    const ops = both.filter(r => catOf(r) === '營運')
    const cheaper = v => both.filter(r => r.latest.cheaper === v).length
    const avgPct = both.length ? Math.round(both.reduce((s, r) => s + (r.latest.pct || 0), 0) / both.length * 10) / 10 : null
    const mos = D.months; const m3 = mos.slice(-4) // 近 3 個月漲跌＝最新 vs 3 個月前
    const chg = (m, a = m3[0], b = m3[m3.length - 1]) => (m && m[a] != null && m[b] != null && m[a]) ? Math.round((m[b] - m[a]) / m[a] * 100) : null
    const trend = D.items.filter(r => r.mkt && (r.s.尚太 || r.s.上展)).map(r => ({ r, mk: chg(r.mkt), a: chg(r.s.尚太), b: chg(r.s.上展) })).filter(x => x.mk != null && (x.a != null || x.b != null))
    const over = trend.filter(x => Math.max(x.a == null ? -999 : x.a, x.b == null ? -999 : x.b) - x.mk >= 20).sort((x, y) => (Math.max(y.a || 0, y.b || 0) - y.mk) - (Math.max(x.a || 0, x.b || 0) - x.mk))
    const under = trend.filter(x => x.mk - Math.min(x.a == null ? 999 : x.a, x.b == null ? 999 : x.b) >= 20)
    const vol = D.items.filter(r => r.vol尚太 || r.vol上展).map(r => ({ r, p: Math.max((r.vol尚太 || {}).pct || 0, (r.vol上展 || {}).pct || 0) })).sort((x, y) => y.p - x.p).slice(0, 12)
    const k = (v, l, c, s) => `<div class="kpi" style="text-align:left"><div class="v" style="color:${c};font-size:24px">${v}</div><div class="l" style="font-size:13px">${l}</div><div class="sub2">${s || ''}</div></div>`
    const saveRows = D.items.filter(r => r.save && r.save.total > 0).sort((a, b) => b.save.total - a.save.total); const saveTot = saveRows.reduce((s9, r) => s9 + r.save.total, 0)
    let h = `<section style="padding:12px 14px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">`
      + k(both.length, '兩家都報價的品項', COL.p, `營運用 ${ops.length} 項`) + k(cheaper('尚太'), '最新月 尚太較便宜', VC.尚太, '項') + k(cheaper('上展'), '最新月 上展較便宜', VC.上展, '項') + k(avgPct == null ? '—' : (avgPct > 0 ? '+' : '') + avgPct + '%', '平均價差（尚太 vs 上展）', avgPct > 0 ? COL.r : COL.g, '正＝尚太整體較貴') + k(saveTot ? saveTot.toLocaleString() + ' 元' : '0', '近 3 個月若都叫便宜那家可省', COL.g, `${saveRows.length} 個品項有差`) + `</div>`
    if (saveRows.length) h += `<div style="margin-top:10px"><b>可省最多的品項</b><div class="scroll"><table class="tight" style="min-width:520px;margin-top:4px"><thead><tr><th style="text-align:left">品項</th><th>可省</th><th>改叫</th><th style="color:${VC.尚太}">叫貨 尚太</th><th style="color:${VC.上展}">叫貨 上展</th></tr></thead><tbody>` + saveRows.slice(0, 12).map(r => `<tr style="cursor:pointer" onclick="_vgGo('${esc(r.key)}')"><td style="text-align:left"><b>${esc(r.name)}</b></td><td style="color:${COL.g};font-weight:800">${r.save.total.toLocaleString()} 元</td><td style="color:${VC[r.save.to]}">${esc(r.save.to)}</td><td>${nf(r.qty3.尚太)} ${esc(r.qtyUnit)}</td><td>${nf(r.qty3.上展)} ${esc(r.qtyUnit)}</td></tr>`).join('') + `</tbody></table></div></div>`
    h += `<div class="hint" style="margin-top:8px;line-height:1.7">怎麼看：同一品項兩家價差常態在 ±10% 內；單一品項長期一邊便宜很多，可以拿報價去跟另一家談。市場行情是批發價，菜商報價會高一截是正常（運費、損耗、利潤），重點看<b>漲跌方向與幅度是否一致</b>：市場跌了菜商沒跟著降，就是議價點。</div></section>`
    // 菜商漲幅 > 市場
    h += `<section style="padding:12px 14px"><h2 style="margin:0 0 6px;font-size:16px">近 3 個月：菜商漲幅明顯高於市場（≥20 個百分點）${over.length ? ` <span style="color:${COL.r}">${over.length} 項</span>` : ''}</h2><div class="hint" style="margin-bottom:6px">${m3[0].slice(2).replace('-', '/')} → ${m3[m3.length - 1].slice(2).replace('-', '/')} 的變化；這些是優先議價對象。</div>`
    h += over.length ? `<div class="scroll"><table class="tight" style="min-width:560px"><thead><tr><th style="text-align:left">品項</th><th>市場</th><th style="color:${VC.尚太}">尚太</th><th style="color:${VC.上展}">上展</th><th>市場月均</th></tr></thead><tbody>` + over.slice(0, 20).map(x => `<tr style="cursor:pointer" onclick="_vgGo('${esc(x.r.key)}')"><td style="text-align:left"><b>${esc(x.r.name)}</b> <span class="hint" style="font-size:11px">${esc(x.r.crop)}</span></td><td>${pctTag(x.mk)}</td><td>${pctTag(x.a)}</td><td>${pctTag(x.b)}</td><td class="mut">${nf(x.r.mkt[m3[0]])} → ${nf(x.r.mkt[m3[m3.length - 1]])}</td></tr>`).join('') + '</tbody></table></div>' : '<div class="hint">沒有</div>'
    h += `</section>`
    if (under.length) h += `<section style="padding:12px 14px"><h2 style="margin:0 0 6px;font-size:16px">市場漲了但菜商還沒漲（≥20 個百分點）<span style="color:${COL.y}"> ${under.length} 項</span></h2><div class="hint">下個月報價可能會補漲，備料／定價先有心理準備：${under.map(x => esc(x.r.name)).join('、')}</div></section>`
    h += `<section style="padding:12px 14px"><h2 style="margin:0 0 6px;font-size:16px">歷史波動最大的品項（近 ${mos.length} 個月 最低→最高）</h2><div class="scroll"><table class="tight" style="min-width:560px"><thead><tr><th style="text-align:left">品項</th><th style="color:${VC.尚太}">尚太</th><th style="color:${VC.上展}">上展</th><th>市場</th></tr></thead><tbody>` + vol.map(x => `<tr style="cursor:pointer" onclick="_vgGo('${esc(x.r.key)}')"><td style="text-align:left"><b>${esc(x.r.name)}</b></td><td class="hint">${volTag(x.r.vol尚太)}</td><td class="hint">${volTag(x.r.vol上展)}</td><td class="hint">${x.r.volMkt ? volTag(x.r.volMkt) : '—'}</td></tr>`).join('') + `</tbody></table></div></section>`
    return h
  }
  window._vgGo = k => { view = 'cmp'; f.cat = 'all'; f.both = false; f.q = ''; open = new Set([k]); paint(); setTimeout(() => { const el = document.querySelector('#vgTbl tr[onclick*="' + k.replace(/"/g, '') + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 50) }

  // ── 核對 ──
  function chk () {
    if (!D.chkLoaded) { loadChk(); return '<section><div class="hint" style="padding:22px">核對資料計算中（偵錯中心那包比較慢，約 5 秒）…</div></section>' }
    const A = D.anomalies || [], S = D.anomSummary || {}, O = D.orders || {}
    const VT = { hit: ['跟報價單對上', COL.g], miss: ['跟報價單對不上', COL.r], noquote: ['報價表沒這品項／該月', COL.y], nodata: ['沒有可比的價', COL.m] }
    let h = `<section style="padding:12px 14px"><h2 style="margin:0 0 6px;font-size:16px">① 偵錯中心「價格異常」×報價單</h2><div class="hint" style="line-height:1.7">價格異常共 ${S.allPrice} 筆，其中菜商 ${S.total} 筆：<b style="color:${COL.g}">對上 ${S.hit}</b>・<b style="color:${COL.r}">對不上 ${S.miss}</b>・<span style="color:${COL.y}">沒報價 ${S.noquote}</span>・已處理 ${S.decided}。「對上」＝變價後的叫貨價跟那家那個月的報價一致（±1%），是真的漲跌不是打錯。</div>`
    if (S.hit && D.me && D.me.canDecide) h += `<div style="margin-top:8px"><button class="mini on" ${busy ? 'disabled' : ''} onclick="_vgConfirm()">${IC.check} 把對上的 ${S.hit} 筆一次確認正確</button></div>`
    for (const v of ['miss', 'hit', 'noquote', 'nodata']) {
      const list = A.filter(a => a.verdict === v && !a.decided); if (!list.length) continue
      h += `<div style="margin-top:12px;font-weight:800;color:${VT[v][1]}">${VT[v][0]} ${list.length} 筆${v === 'miss' ? '<span class="hint" style="font-weight:400">（留給你：到偵錯中心更正金額／是單位問題／確認）</span>' : ''}</div><div class="scroll"><table class="tight" style="min-width:720px"><thead><tr><th style="text-align:left">物料</th><th>廠商</th><th>訊號</th><th style="text-align:left">比對</th><th>影響</th></tr></thead><tbody>`
      for (const a of list) h += `<tr><td style="text-align:left"><b>${esc(a.name)}</b> <span class="hint" style="font-size:11px">${esc(a.code)}</span></td><td>${esc(a.supplier)}</td><td class="hint" style="font-size:12px">${esc(a.signal)}<br>${esc(a.date)}</td><td style="text-align:left;font-size:12.5px">${a.detail.map(d => `<div>${esc(d.lab)} <b>${nf(d.p)}</b>（${esc(d.d)}）vs 報價 ${d.ym || ''} <b>${d.q == null ? '無' : nf(d.q)}</b>${d.qp != null ? `／前月 ${nf(d.qp)}` : ''} <span style="color:${d.hit ? COL.g : COL.r}">${d.hit ? IC.check : IC.x}</span></div>`).join('') || '<span class="mut">—</span>'}</td><td class="hint" style="font-size:12px">${a.impact && a.impact.nMenus ? a.impact.nMenus + ' 道・每份 ' + nf(a.impact.perServing) + ' 元' : '—'}</td></tr>`
      h += '</tbody></table></div>'
    }
    h += `</section>`
    // ops 訂單
    const KL = { ok: ['一致', COL.g], diff: ['不一致', COL.r], prev: ['＝前月報價', COL.y], nomonth: ['該月沒報價', COL.m], noitem: ['報價表沒品項', COL.m], unpriced: ['無單價', COL.r] }
    h += `<section style="padding:12px 14px"><h2 style="margin:0 0 6px;font-size:16px">② ops 叫貨單單價 × 報價單（近 ${(O.months || []).length} 個月，${O.nLines || 0} 行）</h2><div class="scroll"><table class="tight" style="min-width:640px"><thead><tr><th style="text-align:left">廠商</th><th>店</th>${Object.keys(KL).map(k => `<th style="color:${KL[k][1]}">${KL[k][0]}</th>`).join('')}<th>合計</th></tr></thead><tbody>` + (O.summary || []).map(s => `<tr><td style="text-align:left"><b>${esc(s.sup)}</b></td><td>${s.store === 'AB' ? 'A Beach' : 'GROUN:D'}</td>${Object.keys(KL).map(k => `<td>${s[k] || 0}</td>`).join('')}<td>${s.n}</td></tr>`).join('') + `</tbody></table></div><div class="hint" style="margin-top:6px;line-height:1.7">「不一致」＝叫貨單上的單價跟那個月報價不同（ops 主檔沒更新、或月中改價）；「無單價」＝GD 叫貨單沒填價（成本算不出來）；「報價表沒品項」＝名稱對不上（例：聖女番茄 vs 聖女蕃茄已自動視為同一個，其他要改名）。</div>`
    const iss = O.issues || []
    for (const kind of ['diff', 'unpriced', 'noitem']) {
      const list = iss.filter(x => x.kind === kind); if (!list.length) continue
      h += `<div style="margin-top:12px;font-weight:800;color:${KL[kind][1]}">${KL[kind][0]}：${list.length} 個品項（依次數）</div><div class="scroll"><table class="tight" style="min-width:720px"><thead><tr><th style="text-align:left">品項</th><th>廠商</th><th>店</th><th>次數</th><th>最近</th><th style="text-align:left">例子（日期：叫貨價 vs 報價）</th></tr></thead><tbody>`
      for (const x of list.slice(0, 40)) h += `<tr><td style="text-align:left"><b>${esc(x.name)}</b></td><td>${esc(x.sup)}</td><td>${x.store === 'AB' ? 'A Beach' : 'GROUN:D'}</td><td>${x.n}</td><td class="hint">${esc(x.last)}</td><td style="text-align:left;font-size:12px" class="hint">${x.sample.map(s => `${s.date.slice(5)}：${s.price == null ? '無' : nf(s.price)}${s.q != null ? ' vs ' + nf(s.q) : ''}`).join('；')}</td></tr>`
      if (list.length > 40) h += `<tr><td colspan="6" class="hint">…還有 ${list.length - 40} 項</td></tr>`
      h += '</tbody></table></div>'
    }
    h += `</section>`
    return h
  }
})()
