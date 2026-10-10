// ⚠️ /prep 第 17 塊（v4.70.31，2026-10-10）：產品與成本模組｜批次 1「偵錯與待處理中心」
// 規格 docs/COST_MODULE_SPEC.md §2：五個分頁（價格異常／單位待確認／資料缺口／合併建議／已靜音）＋已處理；
// 每筆＝物料、問題、系統判讀與依據、影響幾道在賣菜、每份影響金額、日期；決定全部留紀錄；靜音三種範圍。
// 掛在物料庫（p16）子分頁「待處理」；資料 ?costtodo=（後端 api/_cost.js 規則）。UI 慣例：單色線條圖示、不用彩色 emoji、不用 prompt 彈窗。
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => (Math.round((n || 0) * 100) / 100).toLocaleString()
  const I = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto">${d}</svg>`
  const IC = {
    alert: I('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    check: I('<polyline points="20 6 9 17 4 12"/>'),
    x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    bell0: I('<path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><line x1="1" y1="1" x2="23" y2="23"/>'),
    scale: I('<path d="M12 3v18"/><path d="M5 7l-3 7h6l-3-7z"/><path d="M19 7l-3 7h6l-3-7z"/><path d="M3 21h18"/>'),
    gap: I('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
    merge: I('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'),
    done: I('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
    gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    undo: I('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>'),
    chev: I('<polyline points="6 9 12 15 18 9"/>'),
    trend: I('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  }
  const COL = { b: '#4DA3FF', g: '#3DBE6C', o: '#E8A657', y: '#E8C14E', p: '#B48CF2', r: '#F07373', m: '#8C98A8' }
  const TABS = [
    ['price', '價格異常', IC.trend, COL.r], ['unit', '單位待確認', IC.scale, COL.o], ['gap', '資料缺口', IC.gap, COL.y], ['merge', '合併建議', IC.merge, COL.p], ['muted', '已靜音', IC.bell0, COL.m], ['done', '已處理', IC.done, COL.g],
  ]
  const SIG = { // 訊號 → 標籤文字
    spike: '單點尖峰', step: '階梯變價', 'step-cross': '跨廠商同漲', digit: '差一位數', drift: '累計漂移', openweek: '開帳週錯價', curvslast: '現價≠最後叫貨價', pricelog: '改價紀錄',
    alternate: '一碼多單位', intmul: '整數倍', conserve: '金額守恆', gml11: 'g=ml 1:1', specmismatch: '規格≠換算', noconv: '缺換算', fromprice: '由價格轉入',
    noprice: '缺價', nosku: '缺料號', noinv: '無庫存資料', inactiveused: '停用品被引用', nocode: '行沒料號', incomplete: '食譜不完整', nocost: '白名單外不計成本', samename: '同名多代碼',
  }
  const DEC_LABEL = { ok: '確認正確', fix: '更正金額', unit: '是單位問題', exclude: '排除統計', conv: '接受建議換算', manual: '手動輸入換算', split: '拆料號', noconv: '不需換算', fill: '補資料', alt: '指定替代料', nocost: '標不計成本', merge: '合併', nomerge: '不是同一物' }
  // 各分頁可做的決定（規格 §2 表）：[st, 文字, 需要哪些欄位]
  const DECS = {
    price: [['ok', '確認正確', ['scope']], ['fix', '更正金額', ['amt', 'note']], ['unit', '是單位問題', ['note']], ['exclude', '排除這筆不進統計', ['reason']]],
    unit: [['conv', '接受建議換算', ['note']], ['manual', '手動輸入換算', ['amt', 'note']], ['split', '拆料號', ['note']], ['noconv', '不需換算', ['reason']]],
    gap: [['fill', '補資料（已處理）', ['note']], ['alt', '指定替代料', ['note']], ['nocost', '標不計成本', ['reason']], ['ok', '確認無誤', ['scope']]],
    merge: [['merge', '合併進同一張物料卡', ['note']], ['nomerge', '不是同一物', ['reason']]],
  }

  let CT = null, cTab = 'price', cQ = '', cOnlyMenu = false, cShowInfo = true, cOpenId = null, cForm = null, cSel = new Set(), cCfgOpen = false, cLoading = false

  // ── 讀取（物料庫進頁時平行抓；也可單獨重抓）──
  window.costTodoFetch = async function (silent) {
    if (cLoading) return
    cLoading = true
    try {
      const meQ = TK() ? '&me=' + encodeURIComponent(TK()) : ''
      const r = await fetch('/api/mail-sync?costtodo=' + encodeURIComponent(K) + meQ + '&r=' + Date.now())
      CT = await r.json()
    } catch (e) { CT = { ok: false, error: '連線問題' } }
    cLoading = false
    paintNavBadge()
    if (!silent) costTodoPaint()
  }
  function openCount () { const c = (CT && CT.counts) || {}; return (c.price || 0) + (c.unit || 0) + (c.gap || 0) + (c.merge || 0) }
  // 導覽徽章（規格：導覽列顯示未處理件數）：物料庫分頁按鈕＋手機常用列
  function paintNavBadge () {
    const n = CT && CT.ok ? openCount() : 0
    ;['tab-matlib', 'fav-matlib'].forEach(id => {
      const b = document.getElementById(id); if (!b) return
      let d = b.querySelector('.costDot'); if (d) d.remove()
      if (n > 0) { d = document.createElement('span'); d.className = 'costDot'; d.style.cssText = 'margin-left:4px;background:#E5484D;color:#fff;border-radius:999px;font-size:11px;font-weight:900;min-width:17px;height:17px;line-height:17px;text-align:center;padding:0 4px;display:inline-block'; d.textContent = n > 999 ? '999+' : n; b.appendChild(d) }
    })
    try { const sb = document.getElementById('costSubCnt'); if (sb) sb.textContent = n ? n : '' } catch (_) {}
  }
  window.costTodoOpenCount = openCount

  // ── 畫面入口（p16 子分頁呼叫）──
  window.costTodoView = function () {
    if (!CT) { costTodoFetch(); return '<section><div class="hint" style="padding:22px">載入待處理中…</div></section>' }
    return render()
  }
  function costTodoPaint () { const el = document.getElementById('matBody'); if (el && window._mSubIs && _mSubIs('todo')) el.innerHTML = render() }
  window.costTodoRefresh = function () { CT = null; costTodoFetch() }

  function itemsOf (tab) {
    const all = (CT.items || [])
    if (tab === 'done') return all.filter(it => it.decision)
    return all.filter(it => it.tab === tab && it.open)
  }
  function filt (list) {
    return list.filter(it => {
      if (cOnlyMenu && !((it.impact || {}).nMenus > 0)) return false
      if (!cShowInfo && it.info) return false
      if (cQ) { const q = cQ.toLowerCase(); if (!([it.name, it.supplier, it.code, it.sku, it.title, it.basis].join(' ').toLowerCase().includes(q))) return false }
      return true
    })
  }

  function render () {
    if (!CT.ok) return '<section><div class="err">' + esc(CT.error || '讀不到待處理資料') + '</div></section>'
    const c = CT.counts || {}
    let h = '<section style="padding:14px 16px">'
    h += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${IC.alert} 偵錯與待處理中心</h2>`
      + `<span class="hint">需要人決定的事都在這裡；系統只標記＋建議，不改任何金額</span>`
      + `<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">`
      + (CT.me && CT.me.canDecide ? `<button class="mini ${cCfgOpen ? 'on' : ''}" onclick="_ctCfgTog()">${IC.gear} 門檻設定</button>` : '')
      + `<button class="mini" onclick="costTodoRefresh()">${IC.undo} 重新掃描</button></span></div>`
    h += `<div class="hint" style="margin-top:8px;line-height:1.7">資料：A Beach 叫貨序列 ${esc(CT.seriesFrom || '—')} 起、${nf(CT.nSeries)} 組廠商×物料（阿桑系統每小時同步）`
      + (CT.hasSnap ? `；主檔／換算／食譜行＝<b style="color:${COL.y}">10-06 快照（驗收基準，等 boss-api 端點開通後改即時）</b>` : `；<b style="color:${COL.r}">尚未灌 10/06 快照</b>`)
      + `；門檻 一般 ±${CT.cfg.thr.default}%・蔬果 ±${CT.cfg.thr.veg}%・起司乾貨包材 ±${CT.cfg.thr.tight}%</div>`
    if (cCfgOpen) h += cfgCard()
    h += '</section>'
    // 分頁
    h += `<div style="display:flex;gap:8px;margin:14px 0 8px;flex-wrap:wrap">` + TABS.map(([k, lb, ic, col]) => {
      const n = k === 'done' ? (c.done || 0) : (k === 'muted' ? (c.muted || 0) : (c[k] || 0))
      return `<button class="mini ${cTab === k ? 'on' : ''}" onclick="_ctTab('${k}')" style="display:inline-flex;align-items:center;gap:6px">${ic} ${lb}${n ? ` <b style="background:${col};color:#0E1217;border-radius:999px;padding:0 7px;font-size:12px;line-height:18px">${n}</b>` : ''}</button>`
    }).join('') + `</div>`
    h += '<div id="ctBody">' + body() + '</div>'
    return h
  }
  window._ctTab = function (k) { cTab = k; cOpenId = null; cForm = null; cSel.clear(); const el = document.getElementById('ctBody'); if (el) el.innerHTML = body() }
  window._ctQ = function (v) { cQ = v; const el = document.getElementById('ctList'); if (el) el.innerHTML = list() }
  window._ctOnlyMenu = function () { cOnlyMenu = !cOnlyMenu; const el = document.getElementById('ctBody'); if (el) el.innerHTML = body() }
  window._ctShowInfo = function () { cShowInfo = !cShowInfo; const el = document.getElementById('ctBody'); if (el) el.innerHTML = body() }
  window._ctCfgTog = function () { cCfgOpen = !cCfgOpen; costTodoPaint() }
  window._mSubIs = window._mSubIs || (() => true)

  function body () {
    if (cTab === 'muted') return mutedList()
    let h = '<section style="padding:12px">'
    h += `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">`
      + `<input value="${esc(cQ)}" oninput="_ctQ(this.value)" placeholder="搜尋物料／廠商／代碼／判讀…" style="flex:1;min-width:180px;border:1px solid var(--line);border-radius:10px;padding:9px 12px">`
      + `<button class="mini ${cOnlyMenu ? 'on' : ''}" onclick="_ctOnlyMenu()">只看影響在賣菜</button>`
      + `<button class="mini ${cShowInfo ? 'on' : ''}" onclick="_ctShowInfo()">含資訊級</button>`
      + `</div>`
    if (CT.me && CT.me.canDecide && cTab !== 'done') h += `<div id="ctBatch">${batchBar()}</div>`
    h += '</section><div id="ctList">' + list() + '</div>'
    return h
  }
  function batchBar () {
    const n = cSel.size
    if (!n) return `<div class="hint" style="margin-top:8px">勾選多筆可批次「確認正確」（紀錄會逐筆留）</div>`
    return `<div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--psoft);border-radius:10px;padding:8px 10px"><b>已勾 ${n} 筆</b>`
      + `<button class="mini on" onclick="_ctBatch('ok')">${IC.check} 批次確認正確</button>`
      + (cTab === 'unit' ? `<button class="mini" onclick="_ctBatch('conv')">${IC.check} 批次接受建議換算</button>` : '')
      + `<button class="mini" onclick="_ctSelClear()">取消勾選</button></div>`
  }
  window._ctSel = function (id, on) { if (on) cSel.add(id); else cSel.delete(id); const el = document.getElementById('ctBatch'); if (el) el.innerHTML = batchBar() }
  window._ctSelClear = function () { cSel.clear(); const el = document.getElementById('ctList'); if (el) el.innerHTML = list(); const b = document.getElementById('ctBatch'); if (b) b.innerHTML = batchBar() }

  function impactTxt (it) {
    const im = it.impact || {}
    if (!im.nMenus) return `<span class="hint">不影響在賣菜${(im.recipes || []).length ? `（用在 ${im.recipes.length} 份備料食譜）` : ''}</span>`
    return `<span style="color:${COL.o};font-weight:800">影響 ${im.nMenus} 道在賣菜</span>${im.perServing ? `・最大每份 <b style="color:${COL.r}">${im.perServing > 0 ? '+' : ''}${nf(im.perServing)} 元</b>` : ''}<span class="hint">（估，依 10-06 食譜行）</span>`
  }
  function list () {
    const rows = filt(itemsOf(cTab))
    if (!rows.length) return `<section><div class="hint" style="padding:20px;text-align:center">${cTab === 'done' ? '還沒有處理紀錄' : '這一類目前沒有待處理，太好了'}</div></section>`
    const can = CT.me && CT.me.canDecide
    let h = `<div class="hint" style="margin:6px 2px">${rows.length} 筆・排序：影響在賣菜優先 → 每份影響金額</div>`
    for (const it of rows.slice(0, 300)) {
      const open = cOpenId === it.id
      const col = it.info ? COL.m : ({ price: COL.r, unit: COL.o, gap: COL.y, merge: COL.p })[it.tab] || COL.b
      h += `<section style="padding:12px 14px;margin-top:8px;border-left:3px solid ${col}">`
      h += `<div style="display:flex;gap:10px;align-items:flex-start">`
      if (can && cTab !== 'done' && it.tab !== 'merge') h += `<input type="checkbox" ${cSel.has(it.id) ? 'checked' : ''} onchange="_ctSel('${it.id}',this.checked)" style="width:18px;height:18px;margin-top:4px;flex:0 0 auto">`
      h += `<div style="flex:1;min-width:0;cursor:pointer" onclick="_ctOpen('${it.id}')">`
      h += `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span style="font-size:11.5px;font-weight:800;color:${col};border:1px solid ${col};border-radius:6px;padding:0 6px">${esc(SIG[it.signal] || it.signal)}</span>`
        + (it.info ? `<span class="hint" style="font-size:11.5px">資訊</span>` : '') + (it.fromSnap ? `<span class="hint" style="font-size:11.5px">快照 10-06</span>` : '') + (it.sys ? `<span class="hint" style="font-size:11.5px">${esc(it.sys)}</span>` : '')
        + `<span class="hint" style="margin-left:auto;font-size:12px">${esc(it.date || '')}</span></div>`
      h += `<div style="font-weight:800;font-size:16px;margin-top:4px">${esc(it.name || '')}${it.code ? ` <span class="hint" style="font-weight:600">${esc(it.code)}</span>` : ''}${it.supplier ? ` <span class="hint" style="font-weight:600">・${esc(it.supplier)}</span>` : ''}${it.unit ? ` <span class="hint">／${esc(it.unit)}</span>` : ''}</div>`
      h += `<div style="margin-top:3px;font-size:15px">${esc(it.title)}</div>`
      h += `<div class="hint" style="margin-top:3px;line-height:1.6">判讀：${esc(it.basis)}</div>`
      h += `<div style="margin-top:4px;font-size:13.5px">${impactTxt(it)}</div>`
      if (it.decision) h += `<div style="margin-top:6px;font-size:13.5px;color:${COL.g}">${IC.check} ${esc(DEC_LABEL[it.decision.st] || it.decision.st)}${it.decision.amt != null ? '：' + nf(it.decision.amt) : ''}${it.decision.reason ? '・原因：' + esc(it.decision.reason) : ''}${it.decision.note ? '・' + esc(it.decision.note) : ''} <span class="hint">— ${esc(it.decision.by)} ${esc(String(it.decision.at || '').slice(5, 16).replace('T', ' '))}</span></div>`
      h += `</div></div>`
      if (open) h += detail(it)
      // 決定列
      if (can) {
        if (cTab === 'done') h += `<div style="margin-top:8px"><button class="mini" onclick="_ctUndo('${it.id}')">${IC.undo} 撤銷這個決定</button></div>`
        else {
          h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">` + (DECS[it.tab] || []).map(([st, lb]) => `<button class="mini ${cForm && cForm.id === it.id && cForm.st === st ? 'on' : ''}" onclick="_ctForm('${it.id}','${st}')">${lb}</button>`).join('')
            + `<button class="mini" onclick="_ctForm('${it.id}','mute')" style="margin-left:auto">${IC.bell0} 不再顯示</button></div>`
          if (cForm && cForm.id === it.id) h += form(it)
        }
      } else if (cTab !== 'done') h += `<div class="hint" style="margin-top:6px">只有採購權限可以做決定</div>`
      h += '</section>'
    }
    if (rows.length > 300) h += `<div class="hint" style="margin:8px 2px">只顯示前 300 筆，用搜尋縮小範圍</div>`
    return h
  }
  window._ctOpen = function (id) { cOpenId = (cOpenId === id ? null : id); const el = document.getElementById('ctList'); if (el) el.innerHTML = list() }
  function detail (it) {
    let h = `<div style="margin-top:8px;background:var(--soft);border-radius:10px;padding:10px 12px;font-size:13.5px;line-height:1.7">`
    if (it.series && it.series.length) h += `<div><b>價格序列</b>（每張單一點；單位 ${esc(it.unit || '')}）：` + it.series.map(p => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:1px 7px;border:1px solid var(--line);border-radius:6px">${esc(p.d.slice(5))} <b>${nf(p.p)}</b> <span class="hint">×${nf(p.q)}</span></span>`).join('') + `</div>`
    if (it.suggest) h += `<div><b>建議</b>：${esc(it.suggest)}</div>`
    if (it.thr) h += `<div class="hint">門檻 ±${it.thr}%${it.cat ? '（分類：' + esc(it.cat) + '）' : ''}</div>`
    if (it.rows) h += `<div><b>同名代碼</b>：` + it.rows.map(r => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:1px 7px;border:1px solid var(--line);border-radius:6px">${esc(r.code || r.sku)}・${esc(r.supplier || '—')}${r.status ? '・' + esc(r.status) : ''}</span>`).join('') + `</div>`
    const im = it.impact || {}
    if ((im.menus || []).length) h += `<div><b>影響的在賣菜</b>：` + im.menus.map(m => `${esc(m.menu)}${m.perServing ? ` <span style="color:${COL.r}">${m.perServing > 0 ? '+' : ''}${nf(m.perServing)}</span>` : ''}`).join('、') + `</div>`
    if ((im.recipes || []).length) h += `<div><b>用到的備料食譜</b>：${im.recipes.map(esc).join('、')}</div>`
    if (it.note && it.fromSnap) h += `<div class="hint">${esc(it.note)}</div>`
    if (it.muteKey) h += `<div class="hint">物料鍵：${esc(it.muteKey)}</div>`
    return h + '</div>'
  }

  // ── 決定表單（inline，不用 prompt）──
  window._ctForm = function (id, st) { cForm = (cForm && cForm.id === id && cForm.st === st) ? null : { id, st, scope: 'once', days: 30 }; const el = document.getElementById('ctList'); if (el) el.innerHTML = list() }
  function form (it) {
    const st = cForm.st
    const dec = (DECS[it.tab] || []).find(d => d[0] === st)
    const needs = st === 'mute' ? ['scope'] : (dec ? dec[2] : [])
    let h = `<div style="margin-top:8px;background:var(--psoft);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px">`
    h += `<div style="font-weight:800">${st === 'mute' ? '不再顯示' : esc(dec ? dec[1] : st)}</div>`
    if (needs.includes('amt')) h += `<label class="hint">${st === 'fix' ? '正確金額（會留紀錄；實際改單走阿桑系統 order_adjust）' : '換算值（1 叫貨單位 = ? g／ml／個）'}<br><input id="ctAmt" type="number" step="any" value="${it.amtSuggest != null ? it.amtSuggest : (it.suggestConv != null ? it.suggestConv : '')}" style="width:160px;border:1px solid var(--line);border-radius:8px;padding:7px 9px;margin-top:3px"></label>`
    if (needs.includes('reason')) h += `<label class="hint">原因（必填）<br><input id="ctReason" placeholder="例：颱風季菜價、整箱價、客人自備…" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;margin-top:3px"></label>`
    if (needs.includes('note')) h += `<label class="hint">備註（選填）<br><input id="ctNote" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;margin-top:3px"></label>`
    if (needs.includes('scope')) {
      h += `<div class="hint">之後還要不要提醒？</div><div style="display:flex;gap:6px;flex-wrap:wrap">`
        + `<button class="mini ${cForm.scope === 'once' ? 'on' : ''}" onclick="_ctScope('once')">只關這一筆（再偏離新基準仍提醒）</button>`
        + `<button class="mini ${cForm.scope === 'days' ? 'on' : ''}" onclick="_ctScope('days')">N 天內不提醒</button>`
        + `<button class="mini ${cForm.scope === 'rule' ? 'on' : ''}" onclick="_ctScope('rule')">此物料停用「${esc(SIG[it.signal] || it.signal)}」這條規則</button></div>`
      if (cForm.scope === 'days') h += `<label class="hint">天數 <input id="ctDays" type="number" min="1" max="365" value="${cForm.days}" style="width:80px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"> 天（適合颱風季蔬菜）</label>`
      if (cForm.scope === 'rule') h += `<label class="hint">永久靜音要填原因<br><input id="ctReason2" placeholder="例：這個料本來就箱／散兩種單位" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;margin-top:3px"></label>`
    }
    h += `<div style="display:flex;gap:8px"><button class="mini on" onclick="_ctSend('${it.id}')">${IC.check} 完成</button><button class="mini" onclick="_ctForm('${it.id}','${st}')">${IC.x} 取消</button></div></div>`
    return h
  }
  window._ctScope = function (s) { if (cForm) cForm.scope = s; const el = document.getElementById('ctList'); if (el) el.innerHTML = list() }

  async function post (body) {
    const r = await fetch('/api/mail-sync?costtodo=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
    const j = await r.json().catch(() => ({ ok: false, error: '連線問題' }))
    if (!j.ok) { try { toast(j.error || '沒成功') } catch (_) { alert(j.error || '沒成功') } }
    return j.ok
  }
  window._ctSend = async function (id) {
    const it = (CT.items || []).find(x => x.id === id); if (!it || !cForm) return
    const g = i => { const e = document.getElementById(i); return e ? e.value.trim() : '' }
    const st = cForm.st === 'mute' ? 'ok' : cForm.st
    const scope = (cForm.st === 'mute' || (DECS[it.tab] || []).some(d => d[0] === st && d[2].includes('scope'))) ? cForm.scope : 'once'
    const reason = g('ctReason') || g('ctReason2')
    const body = { op: 'decide', id, st, amt: g('ctAmt') || null, note: g('ctNote'), reason, title: it.title, scope, days: Number(g('ctDays')) || cForm.days, muteKey: it.muteKey, signal: it.signal, name: it.name, supplier: it.supplier }
    if (cForm.st === 'mute' && scope === 'once') body.st = 'ok'
    if (await post(body)) { cForm = null; await costTodoFetch() }
  }
  window._ctBatch = async function (st) {
    const ids = [...cSel]; if (!ids.length) return
    if (!confirm(`要把勾選的 ${ids.length} 筆都標「${DEC_LABEL[st] || st}」嗎？（每筆各留一條紀錄）`)) return
    let ok = 0
    for (const id of ids) { const it = (CT.items || []).find(x => x.id === id); if (!it) continue; if (await post({ op: 'decide', id, st, title: it.title, scope: 'once', amt: st === 'conv' ? it.suggestConv : null, muteKey: it.muteKey, signal: it.signal, name: it.name, supplier: it.supplier, note: '批次' })) ok++ }
    cSel.clear(); try { toast(`完成 ${ok}／${ids.length} 筆`) } catch (_) {}
    await costTodoFetch()
  }
  window._ctUndo = async function (id) { if (await post({ op: 'undo', id })) await costTodoFetch() }

  // ── 已靜音 ──
  function mutedList () {
    const ms = CT.mutes || []
    if (!ms.length) return '<section><div class="hint" style="padding:20px;text-align:center">沒有靜音中的項目</div></section>'
    let h = `<div class="hint" style="margin:6px 2px">${ms.length} 筆・誰選的、何時、範圍都在這裡，可隨時還原</div>`
    for (const m of ms) {
      h += `<section style="padding:12px 14px;margin-top:8px;border-left:3px solid ${COL.m}"><div style="font-weight:800;font-size:16px">${esc(m.name || m.muteKey)}${m.supplier ? ` <span class="hint" style="font-weight:600">・${esc(m.supplier)}</span>` : ''}</div>`
        + `<div style="margin-top:3px">${m.scope === 'days' ? `到 ${esc(m.until)} 前不提醒` : `永久停用規則「${esc(SIG[m.signal] || m.signal || '全部')}」`}${m.reason ? `・原因：${esc(m.reason)}` : ''}</div>`
        + `<div class="hint" style="margin-top:3px">${esc(m.by)} ${esc(String(m.at || '').slice(5, 16).replace('T', ' '))}</div>`
        + (CT.me && CT.me.canDecide ? `<div style="margin-top:8px"><button class="mini" onclick="_ctUnmute('${esc(m.muteKey).replace(/'/g, '&#39;')}',${m.idx})">${IC.undo} 取消靜音</button></div>` : '')
        + `</section>`
    }
    return h
  }
  window._ctUnmute = async function (mk, idx) { if (await post({ op: 'unmute', muteKey: mk, idx })) await costTodoFetch() }

  // ── 門檻設定（管理者）──
  function cfgCard () {
    const t = CT.cfg.thr, cr = CT.cfg.catRules
    return `<div style="margin-top:10px;background:var(--psoft);border-radius:10px;padding:10px 12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;font-size:13.5px">`
      + `<label>一般門檻 ±%<br><input id="cfgDef" type="number" value="${t.default}" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"></label>`
      + `<label>蔬果類 ±%（波動大放寬）<br><input id="cfgVeg" type="number" value="${t.veg}" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"><br><span class="hint">分類關鍵字</span> <input id="cfgVegR" value="${esc(cr.veg)}" style="width:150px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"></label>`
      + `<label>起司／乾貨／包材／耗材 ±%（收緊）<br><input id="cfgTight" type="number" value="${t.tight}" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"><br><span class="hint">分類關鍵字</span> <input id="cfgTightR" value="${esc(cr.tight)}" style="width:150px;border:1px solid var(--line);border-radius:8px;padding:5px 8px"></label>`
      + `<div style="display:flex;align-items:end"><button class="mini on" onclick="_ctCfgSave()">${IC.check} 儲存並重掃</button></div>`
      + `<div class="hint" style="grid-column:1/-1">分類＝物料庫「管理分類」裡你自己訂的物料分類名稱；關鍵字對到就套該門檻，其餘用一般門檻。上線後看誤報率再調。</div></div>`
  }
  window._ctCfgSave = async function () {
    const g = i => { const e = document.getElementById(i); return e ? e.value.trim() : '' }
    if (await post({ op: 'cfg', thr: { default: g('cfgDef'), veg: g('cfgVeg'), tight: g('cfgTight') }, catRules: { veg: g('cfgVegR'), tight: g('cfgTightR') } })) { cCfgOpen = false; await costTodoFetch() }
  }

  // 進站就算徽章（規格：導覽列顯示未處理件數）；沒綁定身分不打
  try { if (TK()) setTimeout(() => costTodoFetch(true), 2500) } catch (_) {}
})()
