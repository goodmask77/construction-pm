// ⚠️ /prep 第 16 塊（張良 2026-10-08 v4.70.3）：物料庫（A Beach 叫貨物料／進價波動分析）
// 資料＝boss-api 叫貨明細（阿桑系統每小時同步）→ 後端 ?matlib= 聚合成「物料 × 廠商 × 時間」。
// 🔴 成本屬內部資料：後端要 me=token 身分守門，未綁定看不到；分類增刪改限採購權限。
// 功能：分廠商／可自訂物料類別／搜尋／進價波動趨勢／點進去看每一筆叫貨細部（仿「社群」分頁的設定與下鑽）。
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => Math.round(n || 0).toLocaleString()
  const money = n => 'NT$' + nf(n)
  const COL = { b: '#4DA3FF', g: '#3DBE6C', o: '#E8A657', y: '#E8C14E', p: '#B48CF2', r: '#F07373' }
  let MDATA = null, mSub = 'dash', mVendF = 'all', mVcatF = 'all', mCatF = 'all', mQ = '', mSort = 'amt30', mCatMng = false
  let MORD = null, mOrdStat = 'all', mOrdQ = '' // 叫貨單分頁（lazy load）
  const OST = { approved: ['已核准', '#3DBE6C'], pending: ['待審', '#E8A657'], rejected: ['退回', '#F07373'] }

  window.matlibLoad = async function () {
    curStore = 'matlib'; try { setTabs('matlib') } catch (_) {}
    document.getElementById('upd').textContent = '物料庫・A Beach 叫貨'
    app.innerHTML = '<section><div class="hint" style="padding:22px">載入中…</div></section>'
    const meQ = TK() ? '&me=' + encodeURIComponent(TK()) : ''
    let d, od
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/mail-sync?matlib=' + encodeURIComponent(K) + meQ + '&r=' + Date.now()),
        fetch('/api/mail-sync?matord=' + encodeURIComponent(K) + meQ + '&r=' + Date.now()),
      ])
      d = await r1.json(); od = await r2.json()
    } catch (e) {}
    if (!d || !d.ok) {
      app.innerHTML = '<section><div class="err">' + esc((d && d.error) || '讀不到物料庫資料（連線問題）') + '</div>'
        + (d && /綁定|登入|身分/.test(d.error || '') ? '<div class="hint" style="margin-top:10px;line-height:1.7">物料進價是內部成本資料，要先登入才看得到。<br>私訊 DD「登入碼」拿 4 位數 → 右上「登入」填入。</div>' : '') + '</section>'
      return
    }
    MDATA = d; MORD = (od && od.ok) ? od : { orders: [], err: (od && od.error) || '' }; mRender()
  }
  // 物料 key（跟後端同規則：有品號用品號、否則用正規化名稱）＝訂單品項↔物料互跳用
  function itemKeyOf (name, code) { const nc = String(code || '').replace(/\s+/g, '').trim(); return nc ? 'c:' + nc : 'n:' + String(name || '').replace(/\s+/g, '').trim() }
  function findItem (key) { return (MDATA.items || []).find(x => x.key === key) }
  function ordersOfVendor (name) { return (MORD && MORD.orders || []).filter(o => o.supplier === name) }
  function ordersOfDate (date) { return (MORD && MORD.orders || []).filter(o => o.date === date) }

  // ── 工具：篩選後的物料清單 ──
  function catOf (o) { return o.cat || '未分類' }
  function mFilt () {
    let vset = null
    if (mVcatF !== 'all') vset = new Set((MDATA.vendors || []).filter(v => (v.cat || '未分類') === mVcatF).map(v => v.name))
    return (MDATA.items || []).filter(o => {
      if (mVendF !== 'all' && !(o.suppliers || []).includes(mVendF)) return false
      if (vset && !(o.suppliers || []).some(s => vset.has(s))) return false
      if (mCatF !== 'all' && catOf(o) !== mCatF) return false
      if (mQ) { const q = mQ.toLowerCase(); if (!((o.name || '').toLowerCase().includes(q) || (o.code || '').toLowerCase().includes(q) || (o.suppliers || []).some(s => s.toLowerCase().includes(q)))) return false }
      return true
    })
  }
  // 廠商分類清單（只有建過廠商分類才顯示「未分類」，避免一上來佔版面）
  function allVcats () {
    const base = MDATA.vcats || []
    if (!base.length) return []
    const set = new Set(base)
    let hasUn = false
    for (const v of (MDATA.vendors || [])) { if (v.cat) set.add(v.cat); else hasUn = true }
    const arr = base.filter(c => set.has(c))
    for (const c of set) if (!arr.includes(c)) arr.push(c)
    if (hasUn) arr.push('未分類')
    return arr
  }
  // 現有分類清單（自訂分類 ＋ 實際出現的「未分類」）
  function allCats () {
    const set = new Set(MDATA.cats || [])
    let hasUn = false
    for (const o of (MDATA.items || [])) { if (o.cat) set.add(o.cat); else hasUn = true }
    const arr = (MDATA.cats || []).filter(c => set.has(c))
    for (const c of set) if (!arr.includes(c)) arr.push(c)
    if (hasUn) arr.push('未分類')
    return arr
  }

  function kcard (label, val, sub, color, onclick) {
    return `<div class="kpi"${onclick ? ` onclick="${onclick}"` : ''} style="text-align:left${onclick ? ';cursor:pointer' : ''}"><div class="v" style="color:${color};font-size:25px">${val}</div><div class="l" style="font-size:14px;margin-top:2px">${label}${onclick ? ' ›' : ''}</div>${sub ? `<div class="sub2">${sub}</div>` : ''}</div>`
  }

  function mRender () {
    const d = MDATA, items = d.items || []
    const amt30 = items.reduce((s, o) => s + (o.amt30 || 0), 0)
    const n30 = items.reduce((s, o) => s + (o.n30 || 0), 0)
    const ups = items.filter(o => o.pctChg != null && o.pctChg > 0).length
    const lastD = items.reduce((m, o) => (o.lastDate > m ? o.lastDate : m), '')
    let h = '<h1>📦 物料庫</h1><div class="sub">A Beach 叫貨物料・進價波動分析（資料來自阿桑系統，每小時同步）</div>'
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:14px 0">`
      + kcard('廠商數', nf((d.vendors || []).length), '有叫貨紀錄', COL.b, '_mAllVendors()')
      + kcard('物料品項', nf(items.length), '近一年出現過', COL.p, '_mGotoList()')
      + kcard('近30天叫貨額', money(amt30), n30 + ' 筆', COL.g, "_mSub('ord')")
      + kcard('近30天筆數', nf(n30), '已核准的叫貨', COL.o, "_mSub('ord')")
      + kcard('近期漲價', nf(ups) + ' 項', '最新價 > 最早價', COL.r, '_mShowUps()')
      + kcard('最近叫貨', lastD ? lastD.slice(5) : '—', lastD ? lastD.slice(0, 4) + ' 年' : '', COL.y, lastD ? `_mDayDetail('${lastD}')` : '')
      + `</div>`
    // 子分頁
    h += `<div style="display:flex;gap:8px;margin:16px 0 4px;flex-wrap:wrap;align-items:center">`
      + `<button class="mini ${mSub === 'dash' ? 'on' : ''}" onclick="_mSub('dash')">📊 波動分析</button>`
      + `<button class="mini ${mSub === 'card' ? 'on' : ''}" onclick="_mSub('card')" style="display:inline-flex;align-items:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="15" x2="12" y2="15"/></svg>物料卡</button>` // v4.70.33 批次2 物料卡（p19-matcard.js；A Beach＋GROUN:D 即時主檔）
      + `<button class="mini ${mSub === 'list' ? 'on' : ''}" onclick="_mSub('list')">📋 叫貨統計</button>`
      + `<button class="mini ${mSub === 'ord' ? 'on' : ''}" onclick="_mSub('ord')">📄 叫貨單</button>`
      + `<button class="mini ${mSub === 'todo' ? 'on' : ''}" onclick="_mSub('todo')" style="display:inline-flex;align-items:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>待處理<b id="costSubCnt" style="background:#E5484D;color:#fff;border-radius:999px;padding:0 6px;font-size:12px;line-height:18px;${(window.costTodoOpenCount && costTodoOpenCount()) ? '' : 'display:none'}">${(window.costTodoOpenCount && costTodoOpenCount()) || ''}</b></button>` // v4.70.31 成本模組批次1：偵錯與待處理中心（p17-costtodo.js）
      + (d.me && d.me.canEdit ? `<button class="mini ${mCatMng ? 'on' : ''}" style="margin-left:auto" onclick="_mCatMngTog()">🏷 管理分類</button>` : '')
      + `</div>`
    if (d.me && d.me.canEdit && mCatMng) h += catMngCard()
    h += '<div id="matBody"></div>'
    app.innerHTML = h
    mBody()
  }

  window._mSub = function (t) { mSub = t; mBody() }
  window._mSubIs = function (t) { return mSub === t && curStore === 'matlib' } // p17 待處理重畫前確認還在這個子分頁
  window._mCatMngTog = function () { mCatMng = !mCatMng; mRender() }

  function mBody () {
    const el = document.getElementById('matBody'); if (!el) return
    el.innerHTML = (mSub === 'dash') ? dashView() : (mSub === 'ord' ? ordView() : (mSub === 'todo' ? (window.costTodoView ? costTodoView() : '<section><div class="hint">待處理模組沒載入</div></section>') : (mSub === 'card' ? (window.matcardView ? matcardView() : '<section><div class="hint">物料卡模組沒載入</div></section>') : listView())))
  }

  // ── 篩選列（廠商／分類／搜尋）──
  function filterBar () {
    const d = MDATA
    const vcats = allVcats()
    let vends = (d.vendors || []).map(v => v.name)
    if (mVcatF !== 'all') vends = (d.vendors || []).filter(v => (v.cat || '未分類') === mVcatF).map(v => v.name)
    const cats = allCats()
    let h = '<section style="padding:12px">'
    h += `<input value="${esc(mQ)}" oninput="_mSearch(this.value)" placeholder="🔍 搜尋物料／廠商／品號…" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:10px">`
    if (vcats.length) h += `<div class="hint" style="margin-bottom:4px">廠商分類</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">`
      + `<button class="mini ${mVcatF === 'all' ? 'on' : ''}" onclick="_mVcat('all')">全部</button>`
      + vcats.map(c => `<button class="mini ${mVcatF === c ? 'on' : ''}" onclick="_mVcat('${esc(c).replace(/'/g, '&#39;')}')">${esc(c)}</button>`).join('')
      + `</div>`
    h += `<div class="hint" style="margin-bottom:4px">廠商</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">`
      + `<button class="mini ${mVendF === 'all' ? 'on' : ''}" onclick="_mVend('all')">全部</button>`
      + vends.map(v => `<button class="mini ${mVendF === v ? 'on' : ''}" onclick="_mVend('${esc(v).replace(/'/g, '&#39;')}')">${esc(v)}</button>`).join('')
      + `</div>`
    if (cats.length) h += `<div class="hint" style="margin-bottom:4px">分類</div><div style="display:flex;gap:6px;flex-wrap:wrap">`
      + `<button class="mini ${mCatF === 'all' ? 'on' : ''}" onclick="_mCat('all')">全部</button>`
      + cats.map(c => `<button class="mini ${mCatF === c ? 'on' : ''}" onclick="_mCat('${esc(c).replace(/'/g, '&#39;')}')">${esc(c)}</button>`).join('')
      + `</div>`
    return h + '</section>'
  }
  window._mSearch = function (v) { mQ = v; const el = document.getElementById('matList'); if (el) el.innerHTML = listTable() }
  window._mVend = function (v) { mVendF = v; mSub = 'list'; mBody() }
  window._mVcat = function (c) { mVcatF = c; mVendF = 'all'; mSub = 'list'; mBody() }
  window._mCat = function (c) { mCatF = c; mSub = 'list'; mBody() }

  // ── 波動分析（像社群儀表板：建議＋圖表卡牆）──
  function bars (items, color, onclick) {
    if (!items.length) return '<div class="hint">資料不足</div>'
    const mx = Math.max(1, ...items.map(i => i.v))
    return items.map(i => `<div ${onclick ? `onclick="${onclick}('${esc(i.key).replace(/'/g, '&#39;')}')" ` : ''}title="${esc(i.l)}：${i.t || nf(i.v)}" style="display:flex;align-items:center;gap:10px;margin:7px 0;${onclick ? 'cursor:pointer' : ''}"><span style="width:92px;flex:0 0 auto;font-size:13px;color:var(--text);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.l)}</span><div style="flex:1;background:#1C222B;border-radius:6px;height:16px"><div style="height:100%;width:${Math.round(i.v / mx * 100)}%;min-width:3px;background:${i.c || color};border-radius:6px"></div></div><span style="width:78px;flex:0 0 auto;text-align:right;font-weight:800;font-variant-numeric:tabular-nums;font-size:13px">${i.t != null ? i.t : nf(i.v)}</span></div>`).join('')
  }
  function card (icon, title, desc, inner) {
    return `<section><h2 style="margin:0 0 4px">${icon} ${title}</h2><div class="hint" style="margin-bottom:12px;line-height:1.6">${desc}</div>${inner}</section>`
  }
  function dashView () {
    const d = MDATA, items = d.items || []
    let h = filterBar()
    if (!items.length) return h + '<section><div class="hint" style="padding:20px">目前還沒有叫貨明細資料。阿桑系統每小時同步一次，有叫貨單進來後這裡就會長出物料。</div></section>'
    // 行動建議
    const rec = []
    const topV = (d.vendors || [])[0]
    if (topV && topV.amt30) rec.push(`🏭 近 30 天叫貨額最高的廠商是 <b>${esc(topV.name)}</b>（${money(topV.amt30)}、${topV.n30} 筆）。`)
    const ups = items.filter(o => o.pctChg != null && o.pctChg > 0).sort((a, b) => b.pctChg - a.pctChg)
    if (ups[0]) rec.push(`🔺 <b>${esc(ups[0].name)}</b> 進價漲最多：${ups[0].firstPrice} → ${ups[0].lastPrice}（<b style="color:${COL.r}">+${ups[0].pctChg}%</b>），可找廠商議價或比價。`)
    const dns = items.filter(o => o.pctChg != null && o.pctChg < 0).sort((a, b) => a.pctChg - b.pctChg)
    if (dns[0]) rec.push(`🔻 <b>${esc(dns[0].name)}</b> 進價降了 <b style="color:${COL.g}">${dns[0].pctChg}%</b>（${dns[0].firstPrice} → ${dns[0].lastPrice}）。`)
    const multi = items.filter(o => (o.suppliers || []).length > 1).sort((a, b) => b.amt30 - a.amt30)[0]
    if (multi) rec.push(`⚖️ <b>${esc(multi.name)}</b> 有 ${multi.suppliers.length} 家廠商供貨，點進去可比各家價格。`)
    if (!rec.length) rec.push('資料累積越多，這裡的議價／比價建議會越準。')
    h += card('💡', '觀察建議', '依實際叫貨資料自動算出的重點。', '<div style="display:flex;flex-direction:column;gap:9px">' + rec.map(x => `<div style="background:#1A2940;border-left:3px solid ${COL.b};border-radius:0 8px 8px 0;padding:9px 12px;line-height:1.65">${x}</div>`).join('') + '</div>')
    // 月趨勢（叫貨總額）
    const months = (d.months || []).filter(m => d.byMonth && d.byMonth[m] != null)
    const trend = months.map(m => Math.round(d.byMonth[m]))
    let trendHtml
    // v4.70.36：改走全站共用 lineChart（Y 軸金額刻度＋X 軸月份＋滑過浮窗）
    if (!trend.length) trendHtml = '<div class="hint">還沒有叫貨資料</div>'
    else trendHtml = lineChart({ labels: months, series: [{ name: '叫貨總額', vals: trend, color: COL.b }], yFmt: v => money(v), zero: true, h: 150 })
    // 廠商排行
    const vendBars = (d.vendors || []).slice(0, 10).map(v => ({ l: v.name, key: v.name, v: v.amt30, t: money(v.amt30) }))
    // 分類佔比
    const catAmt = {}
    for (const o of items) catAmt[catOf(o)] = (catAmt[catOf(o)] || 0) + (o.amt30 || 0)
    const catBars = Object.entries(catAmt).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ l: k, key: k, v, t: money(v), c: COL.p }))
    // 漲跌 Top
    const upRows = ups.slice(0, 6).map(o => pctRow(o)).join('')
    const dnRows = dns.slice(0, 6).map(o => pctRow(o)).join('')
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:14px">`
      + card('📈', '每月叫貨總額', '近一年叫貨金額走勢（只計已核准）。滑過看每月金額。', trendHtml)
      + card('🏭', '廠商叫貨排行', '近 30 天各廠商叫貨額。<b>點任一條看該廠商的物料與歷史叫貨</b>。', bars(vendBars, COL.b, '_mVendDetail'))
      + card('🏷', '分類佔比', '各物料分類近 30 天叫貨額。<b>點看分類</b>。', bars(catBars, COL.p, '_mCat'))
      + card('🔺', '近期漲價 Top', '最新進價比最早進價高的物料，點看細部。', upRows || '<div class="hint">沒有漲價物料</div>')
      + card('🔻', '近期降價 Top', '進價下降的物料。', dnRows || '<div class="hint">沒有降價物料</div>')
      + `</div>`
    return h
  }
  function pctRow (o) {
    const up = o.pctChg > 0
    return `<div onclick="_mDetail('${esc(o.key).replace(/'/g, '&#39;')}')" style="display:flex;gap:9px;align-items:center;padding:7px 0;border-top:1px solid #222A35;cursor:pointer">`
      + `<b style="width:62px;flex:0 0 auto;text-align:right;color:${up ? COL.r : COL.g};font-variant-numeric:tabular-nums">${up ? '+' : ''}${o.pctChg}%</b>`
      + `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${esc(o.name)}</span>`
      + `<span class="hint" style="font-size:12px;flex:0 0 auto">${o.firstPrice}→${o.lastPrice}</span></div>`
  }

  // ── 物料清單（表格＋排序）──
  function listView () {
    return filterBar() + '<section style="padding:12px"><div id="matList">' + listTable() + '</div></section>'
  }
  function listTable () {
    let list = mFilt()
    const sortFns = {
      amt30: (a, b) => b.amt30 - a.amt30, qty30: (a, b) => b.qty30 - a.qty30,
      pct: (a, b) => (b.pctChg == null ? -1e9 : b.pctChg) - (a.pctChg == null ? -1e9 : a.pctChg),
      price: (a, b) => (b.lastPrice || 0) - (a.lastPrice || 0), last: (a, b) => (a.lastDate < b.lastDate ? 1 : -1), name: (a, b) => (a.name < b.name ? -1 : 1),
    }
    list = list.slice().sort(sortFns[mSort] || sortFns.amt30)
    const hd = (k, lbl) => `<th onclick="_mSortBy('${k}')" style="cursor:pointer;color:${mSort === k ? 'var(--pdark)' : 'var(--muted)'}">${lbl}${mSort === k ? ' ▾' : ''}</th>`
    if (!list.length) return '<div class="hint" style="padding:16px">沒有符合條件的物料。</div>'
    let h = `<div class="hint" style="margin-bottom:8px">共 ${list.length} 項（點任一列看進價歷史與每一筆叫貨）</div><div class="scroll"><table class="tight" style="min-width:560px"><thead><tr>`
      + hd('name', '物料') + `<th style="text-align:left">廠商</th>` + hd('price', '最新進價') + hd('pct', '波動') + hd('qty30', '近30天量') + hd('amt30', '近30天額') + hd('last', '最近叫貨') + '</tr></thead><tbody>'
    for (const o of list) {
      const up = o.pctChg != null && o.pctChg > 0, dn = o.pctChg != null && o.pctChg < 0
      const pctTxt = o.pctChg == null ? '<span class="mut">—</span>' : `<span style="color:${up ? COL.r : (dn ? COL.g : 'var(--muted)')};font-weight:800">${up ? '+' : ''}${o.pctChg}%</span>`
      h += `<tr onclick="_mDetail('${esc(o.key).replace(/'/g, '&#39;')}')" style="cursor:pointer">`
        + `<td style="text-align:left"><div class="iname" style="max-width:none">${esc(o.name)}</div>${o.cat ? `<span class="hint" style="font-size:11px">${esc(o.cat)}</span>` : ''}${o.code ? `<span class="hint" style="font-size:11px"> #${esc(o.code)}</span>` : ''}</td>`
        + `<td style="text-align:left;font-size:12px;color:var(--text)">${esc((o.suppliers || []).join('、'))}</td>`
        + `<td>${o.lastPrice != null ? o.lastPrice : '—'}${o.unit ? `<span class="hint" style="font-size:11px">/${esc(o.unit)}</span>` : ''}</td>`
        + `<td>${pctTxt}</td>`
        + `<td>${o.qty30 ? nf(o.qty30) : '<span class="mut">—</span>'}</td>`
        + `<td>${o.amt30 ? nf(o.amt30) : '<span class="mut">—</span>'}</td>`
        + `<td class="hint" style="font-size:12px">${o.lastDate ? o.lastDate.slice(5) : '—'}</td></tr>`
    }
    return h + '</tbody></table></div>'
  }
  window._mSortBy = function (k) { mSort = k; const el = document.getElementById('matList'); if (el) el.innerHTML = listTable() }

  // ── 物料細部 modal：進價趨勢＋統計＋每一筆叫貨＋分類設定 ──
  window._mDetail = function (key) {
    const o = (MDATA.items || []).find(x => x.key === key); if (!o) return
    const ser = o.series || []
    // 趨勢 SVG（進價隨時間）
    let chart = '<div class="hint">還沒有報價。</div>' // v4.70.36：改走全站共用 lineChart（Y 軸進價刻度＋X 軸日期＋滑過看日期／進價／廠商）
    if (ser.length) chart = lineChart({ labels: ser.map(s => String(s.d || '')), series: [{ name: '進價', vals: ser.map(s => s.p), color: COL.b }], xFmt: d => d.slice(5), tipX: (d, i) => `${d}　${ser[i].s || ''}`, h: 150 })
    const stat = (l, v, c) => `<div style="text-align:center"><div style="font-size:19px;font-weight:800;color:${c || 'var(--ink)'};font-variant-numeric:tabular-nums">${v}</div><div class="hint" style="font-size:12px">${l}</div></div>`
    const up = o.pctChg != null && o.pctChg > 0
    const recRows = (o.recs || []).slice().reverse().map(r => {
      const stTxt = r.st === 'approved' ? '' : `<span class="hint" style="font-size:10px"> ${r.st === 'pending' ? '待審' : (r.st === 'rejected' ? '退回' : esc(r.st))}</span>`
      const clk = r.oid ? ` onclick="_mOrdDetail('${esc(r.oid).replace(/'/g, '&#39;')}')" style="cursor:pointer${r.st !== 'approved' ? ';opacity:.55' : ''}"` : (r.st !== 'approved' ? ' style="opacity:.55"' : '')
      return `<tr${clk}><td style="text-align:left">${r.d}${stTxt}</td><td style="text-align:left;font-size:12px">${esc(r.s)}</td><td>${r.q ? nf(r.q) : '—'}${r.u ? `<span class="hint" style="font-size:10px">${esc(r.u)}</span>` : ''}</td><td>${r.p != null ? r.p : '—'}</td><td>${r.a != null ? nf(r.a) : '—'}</td></tr>`
    }).join('')
    // 分類設定（限有權限者）
    let catUI = ''
    if (MDATA.me && MDATA.me.canEdit) {
      const cats = (MDATA.cats || [])
      catUI = `<div style="margin:14px 0;padding:12px;background:#1C222B;border-radius:10px">
        <div class="hint" style="margin-bottom:6px">分類（歸類後可在上方用分類篩選）</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button class="mini ${!o.cat ? 'on' : ''}" onclick="_mItemCat('${esc(key).replace(/'/g, '&#39;')}','')">未分類</button>`
        + cats.map(c => `<button class="mini ${o.cat === c ? 'on' : ''}" onclick="_mItemCat('${esc(key).replace(/'/g, '&#39;')}','${esc(c).replace(/'/g, '&#39;')}')">${esc(c)}</button>`).join('')
        + (cats.length ? '' : '<span class="hint">還沒有分類，先到上方「🏷 管理分類」新增</span>')
        + `</div></div>`
    }
    const ov = document.createElement('div'); ov.id = 'mDetOv'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px'; ov.onclick = () => ov.remove()
    ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:560px;width:100%;max-height:88vh;overflow:auto;padding:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div><div style="font-size:18px;font-weight:800;color:var(--ink)">${esc(o.name)}</div>
        <div class="hint" style="margin-top:3px">${(o.suppliers || []).map(s => `<span onclick="_mVendDetail('${esc(s).replace(/'/g, '&#39;')}')" style="cursor:pointer;color:var(--pdark);text-decoration:underline">${esc(s)}</span>`).join('、')}${o.code ? '　#' + esc(o.code) : ''}${o.unit ? '　單位：' + esc(o.unit) : ''}</div></div>
        <button class="mini" onclick="document.getElementById('mDetOv').remove()">關閉</button></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0;background:#1C222B;border-radius:12px;padding:14px">
        ${stat('最新進價', o.lastPrice != null ? o.lastPrice : '—', COL.b)}
        ${stat('波動', o.pctChg == null ? '—' : (up ? '+' : '') + o.pctChg + '%', o.pctChg == null ? 'var(--muted)' : (up ? COL.r : COL.g))}
        ${stat('最低 / 最高', (o.minP != null ? o.minP : '—') + ' / ' + (o.maxP != null ? o.maxP : '—'), COL.y)}
        ${stat('近30天額', o.amt30 ? nf(o.amt30) : '—', COL.g)}
      </div>
      <h2 style="margin:4px 0 8px;font-size:15px">📈 進價走勢</h2>${chart}
      ${catUI}
      <h2 style="margin:14px 0 8px;font-size:15px">🧾 每一筆叫貨（新到舊，共 ${(o.recs || []).length} 筆）</h2>
      <div class="scroll"><table class="tight" style="min-width:420px"><thead><tr><th style="text-align:left">日期</th><th style="text-align:left">廠商</th><th>數量</th><th>單價</th><th>金額</th></tr></thead><tbody>${recRows || '<tr><td colspan="5" class="hint">沒有紀錄</td></tr>'}</tbody></table></div>
    </div>`
    document.body.appendChild(ov)
  }
  window._mItemCat = async function (key, cat) {
    const j = await mcPost({ op: 'setcat', key, cat })
    if (j && j.ok) { // 更新本地 + 重畫 modal
      const o = (MDATA.items || []).find(x => x.key === key); if (o) o.cat = cat
      MDATA.cats = j.cats
      _mDetail(key); mBody()
    } else alert((j && j.error) || '沒權限或存檔失敗')
  }

  // ── 分類管理卡（增刪改）──
  function chipRow (list, kind) {
    return list.length ? list.map(c => `<span style="display:inline-flex;align-items:center;gap:6px;background:#1C222B;border:1px solid var(--line);border-radius:999px;padding:5px 10px">${esc(c)}<span onclick="_m${kind}Ren('${esc(c).replace(/'/g, '&#39;')}')" style="cursor:pointer;color:var(--muted)" title="改名">✎</span><span onclick="_m${kind}Del('${esc(c).replace(/'/g, '&#39;')}')" style="cursor:pointer;color:var(--red);font-weight:700" title="刪除">✕</span></span>`).join('') : '<span class="hint">還沒有分類</span>'
  }
  function catMngCard () {
    const cats = MDATA.cats || [], vcats = MDATA.vcats || []
    const vrows = (MDATA.vendors || []).map(v => {
      const opts = ['<option value="">未分類</option>'].concat(vcats.map(c => `<option value="${esc(c)}" ${v.cat === c ? 'selected' : ''}>${esc(c)}</option>`)).join('')
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><span style="flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.name)}${v.cat ? `<span class="hint" style="font-size:11px"> · ${esc(v.cat)}</span>` : ''}</span><select onchange="_mVendSetCat('${esc(v.name).replace(/'/g, '&#39;')}',this.value)" style="border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;max-width:160px">${opts}</select></div>`
    }).join('')
    const inpStyle = 'flex:1;border:1px solid var(--line);border-radius:10px;padding:8px 10px'
    return `<section style="border:1px solid var(--primary)">
      <h2>🏷 管理分類</h2>
      <div class="hint" style="margin-bottom:12px">分類可隨時改名、刪除（不影響叫貨資料，只是取消歸類）。</div>
      <div style="font-weight:800;margin-bottom:4px">📦 物料分類</div>
      <div class="hint" style="margin-bottom:6px">建好後到各物料細部指定分類。</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chipRow(cats, 'Cat')}</div>
      <div style="display:flex;gap:6px;margin-bottom:18px"><input id="mCatNew" placeholder="新物料分類（如：肉品、蔬菜、包材）" style="${inpStyle}"><button class="mini on" onclick="_mCatAdd()">＋ 新增</button></div>
      <div style="font-weight:800;margin-bottom:4px;border-top:1px solid var(--line);padding-top:16px">🏭 廠商分類</div>
      <div class="hint" style="margin-bottom:6px">建好分類後，下方每家廠商直接選分類即可（之後可用「廠商分類」篩選）。</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chipRow(vcats, 'Vcat')}</div>
      <div style="display:flex;gap:6px;margin-bottom:12px"><input id="mVcatNew" placeholder="新廠商分類（如：肉商、起司、水產、員餐）" style="${inpStyle}"><button class="mini on" onclick="_mVcatAdd()">＋ 新增</button></div>
      ${vcats.length ? `<div class="hint" style="margin-bottom:4px">廠商歸類（共 ${(MDATA.vendors || []).length} 家）</div><div style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px">${vrows}</div>` : '<div class="hint">先新增一個廠商分類，這裡才會列出廠商讓你歸類。</div>'}
    </section>`
  }
  async function mcPost (body) {
    try {
      const r = await fetch('/api/mail-sync?matcat=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
      return await r.json()
    } catch (e) { return { ok: false, error: '網路不穩' } }
  }
  window._mCatAdd = async function () {
    const v = ((document.getElementById('mCatNew') || {}).value || '').trim(); if (!v) { alert('請輸入分類名稱'); return }
    const j = await mcPost({ op: 'addcat', name: v }); if (j.ok) { MDATA.cats = j.cats; mRender() } else alert(j.error || '失敗')
  }
  window._mCatDel = async function (name) {
    if (!confirm('刪除分類「' + name + '」？\n（原本歸在這類的物料會變回未分類，叫貨資料不受影響）')) return
    const j = await mcPost({ op: 'delcat', name }); if (j.ok) { MDATA.cats = j.cats; for (const o of MDATA.items) if (o.cat === name) o.cat = ''; if (mCatF === name) mCatF = 'all'; mRender() } else alert(j.error || '失敗')
  }
  window._mCatRen = async function (name) {
    const to = prompt('把分類「' + name + '」改成：', name); if (!to || !to.trim() || to.trim() === name) return
    const j = await mcPost({ op: 'rencat', name, to: to.trim() }); if (j.ok) { MDATA.cats = j.cats; for (const o of MDATA.items) if (o.cat === name) o.cat = to.trim(); if (mCatF === name) mCatF = to.trim(); mRender() } else alert(j.error || '失敗')
  }
  // 廠商分類（kind:'vendor'）
  window._mVcatAdd = async function () {
    const v = ((document.getElementById('mVcatNew') || {}).value || '').trim(); if (!v) { alert('請輸入廠商分類名稱'); return }
    const j = await mcPost({ op: 'addcat', kind: 'vendor', name: v }); if (j.ok) { MDATA.vcats = j.vcats; mRender() } else alert(j.error || '失敗')
  }
  window._mVcatDel = async function (name) {
    if (!confirm('刪除廠商分類「' + name + '」？\n（原本歸這類的廠商會變回未分類，叫貨資料不受影響）')) return
    const j = await mcPost({ op: 'delcat', kind: 'vendor', name }); if (j.ok) { MDATA.vcats = j.vcats; for (const v of MDATA.vendors) if (v.cat === name) v.cat = ''; if (mVcatF === name) mVcatF = 'all'; mRender() } else alert(j.error || '失敗')
  }
  window._mVcatRen = async function (name) {
    const to = prompt('把廠商分類「' + name + '」改成：', name); if (!to || !to.trim() || to.trim() === name) return
    const j = await mcPost({ op: 'rencat', kind: 'vendor', name, to: to.trim() }); if (j.ok) { MDATA.vcats = j.vcats; for (const v of MDATA.vendors) if (v.cat === name) v.cat = to.trim(); if (mVcatF === name) mVcatF = to.trim(); mRender() } else alert(j.error || '失敗')
  }
  window._mVendSetCat = async function (name, cat) {
    const j = await mcPost({ op: 'setcat', kind: 'vendor', key: name, cat })
    if (j && j.ok) { const v = (MDATA.vendors || []).find(x => x.name === name); if (v) v.cat = cat; MDATA.vcats = j.vcats } else alert((j && j.error) || '沒權限或存檔失敗')
  }

  // ── 叫貨單分頁（lazy load；張良 2026-10-10「有物料庫那應該找得到每張訂單」）──
  async function fetchOrders () {
    try {
      const r = await fetch('/api/mail-sync?matord=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '') + '&r=' + Date.now())
      const d = await r.json()
      MORD = (d && d.ok) ? d : { orders: [], err: (d && d.error) || '讀取失敗' }
    } catch (e) { MORD = { orders: [], err: '連線問題' } }
    if (mSub === 'ord') mBody()
  }
  function ordView () {
    if (!MORD) { fetchOrders(); return '<section><div class="hint" style="padding:22px">載入叫貨單中…</div></section>' }
    if (MORD.err) return '<section><div class="err">' + esc(MORD.err) + '</div>' + (/綁定|登入|身分/.test(MORD.err) ? '<div class="hint" style="margin-top:10px">叫貨單是內部成本資料，要先登入才看得到。</div>' : '') + '</section>'
    const orders = MORD.orders || []
    let h = '<section style="padding:12px">'
    h += `<input value="${esc(mOrdQ)}" oninput="_mOrdSearch(this.value)" placeholder="🔍 搜尋廠商／品項／日期…" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:10px">`
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap">`
      + `<button class="mini ${mOrdStat === 'all' ? 'on' : ''}" onclick="_mOrdStatF('all')">全部 ${orders.length}</button>`
      + ['approved', 'pending', 'rejected'].map(s => { const n = orders.filter(o => o.status === s).length; return `<button class="mini ${mOrdStat === s ? 'on' : ''}" onclick="_mOrdStatF('${s}')">${OST[s][0]} ${n}</button>` }).join('')
      + `</div><div id="matOrdList" style="margin-top:10px">` + orderTable() + '</div></section>'
    return h
  }
  function orderFilt () {
    const q = mOrdQ.toLowerCase()
    return (MORD.orders || []).filter(o => {
      if (mOrdStat !== 'all' && o.status !== mOrdStat) return false
      if (q && !((o.supplier || '').toLowerCase().includes(q) || (o.date || '').includes(q) || (o.items || []).some(it => (it.name || '').toLowerCase().includes(q)))) return false
      return true
    })
  }
  function orderTable () {
    const list = orderFilt()
    if (!list.length) return '<div class="hint" style="padding:16px">沒有符合的叫貨單。</div>'
    let h = `<div class="hint" style="margin-bottom:8px">共 ${list.length} 張（點任一張看明細）</div><div class="scroll"><table class="tight" style="min-width:520px"><thead><tr><th style="text-align:left">日期</th><th style="text-align:left">廠商</th><th>品項</th><th>金額</th><th>狀態</th></tr></thead><tbody>`
    for (const o of list) {
      const st = OST[o.status] || [o.status || '—', 'var(--muted)']
      h += `<tr onclick="_mOrdDetail('${esc(o.id).replace(/'/g, '&#39;')}')" style="cursor:pointer">`
        + `<td style="text-align:left">${o.date || '—'}</td>`
        + `<td style="text-align:left"><div class="iname" style="max-width:none">${esc(o.supplier)}</div>${o.dept ? `<span class="hint" style="font-size:11px">${esc(o.dept)}</span>` : ''}</td>`
        + `<td>${o.lineCount || (o.items || []).length}</td>`
        + `<td>${o.total ? nf(o.total) : '—'}${o.unpriced ? `<span class="hint" style="font-size:10px"> ${o.unpriced}無價</span>` : ''}</td>`
        + `<td><span style="color:${st[1]};font-weight:800">${st[0]}</span></td></tr>`
    }
    return h + '</tbody></table></div>'
  }
  window._mOrdStatF = function (s) { mOrdStat = s; const el = document.getElementById('matOrdList'); if (el) el.innerHTML = orderTable() }
  window._mOrdSearch = function (v) { mOrdQ = v; const el = document.getElementById('matOrdList'); if (el) el.innerHTML = orderTable() }
  window._mOrdDetail = function (id) {
    const o = (MORD.orders || []).find(x => x.id === id); if (!o) return
    const st = OST[o.status] || [o.status || '—', 'var(--muted)']
    const rows = (o.items || []).map(it => `<tr onclick="_mItemJump('${esc(it.name).replace(/'/g, '&#39;')}','${esc(it.code || '').replace(/'/g, '&#39;')}')" style="cursor:pointer${it.st && it.st !== 'approved' ? ';opacity:.55' : ''}"><td style="text-align:left">${esc(it.name)}${it.code ? `<span class="hint" style="font-size:10px"> #${esc(it.code)}</span>` : ''}</td><td>${it.qty ? nf(it.qty) : '—'}${it.unit ? `<span class="hint" style="font-size:10px">${esc(it.unit)}</span>` : ''}</td><td>${it.price != null ? it.price : '—'}</td><td>${it.amount != null ? nf(it.amount) : '—'}</td></tr>`).join('')
    const ov = document.createElement('div'); ov.id = 'mOrdOv'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px'; ov.onclick = () => ov.remove()
    ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:560px;width:100%;max-height:88vh;overflow:auto;padding:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div><div onclick="_mVendDetail('${esc(o.supplier).replace(/'/g, '&#39;')}')" style="font-size:18px;font-weight:800;color:var(--ink);cursor:pointer;text-decoration:underline">${esc(o.supplier)}</div>
        <div class="hint" style="margin-top:3px">${o.date ? `<span onclick="_mDayDetail('${o.date}')" style="cursor:pointer;color:var(--pdark);text-decoration:underline">${o.date}</span>` : ''}${o.dept ? '　' + esc(o.dept) : ''}　<span style="color:${st[1]};font-weight:700">${st[0]}</span></div></div>
        <button class="mini" onclick="document.getElementById('mOrdOv').remove()">關閉</button></div>
      <div style="display:flex;gap:18px;margin:14px 0;background:#1C222B;border-radius:12px;padding:14px">
        <div style="text-align:center;flex:1"><div style="font-size:21px;font-weight:800;color:#3DBE6C;font-variant-numeric:tabular-nums">${nf(o.total)}</div><div class="hint" style="font-size:12px">訂單金額</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:21px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums">${o.lineCount || (o.items || []).length}</div><div class="hint" style="font-size:12px">品項數</div></div>
      </div>
      <h2 style="margin:4px 0 8px;font-size:15px">🧾 明細</h2>
      <div class="scroll"><table class="tight" style="min-width:380px"><thead><tr><th style="text-align:left">品項</th><th>數量</th><th>單價</th><th>金額</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="hint">沒有明細</td></tr>'}</tbody></table></div>
    </div>`
    document.body.appendChild(ov)
  }

  // ── 全面下鑽（張良 2026-10-10「都要能點進去看細部，除非到最基本單位」）──
  function openModal (inner, maxw) {
    const ov = document.createElement('div'); ov.className = 'mDrill'
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px'
    ov.onclick = () => ov.remove()
    ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:${maxw || 560}px;width:100%;max-height:88vh;overflow:auto;padding:18px">${inner}</div>`
    document.body.appendChild(ov); return ov
  }
  const closeBtn = '<button class="mini" onclick="this.closest(\'.mDrill\').remove()">關閉</button>'
  window._mGotoList = function () { mVendF = 'all'; mVcatF = 'all'; mCatF = 'all'; mQ = ''; mSort = 'amt30'; mSub = 'list'; mBody() }
  window._mShowUps = function () { mVendF = 'all'; mVcatF = 'all'; mCatF = 'all'; mQ = ''; mSort = 'pct'; mSub = 'list'; mBody() }
  // 訂單明細的品項 → 跳到該物料的進價曲線（最基本單位就不再下鑽）
  window._mItemJump = function (name, code) { const k = itemKeyOf(name, code); if (findItem(k)) _mDetail(k); else alert('這個品項目前沒有更多歷史可看') }

  // 廠商總覽（KPI「廠商數」→ 點進來）：列所有廠商，點一家看詳情
  window._mAllVendors = function () {
    const vs = (MDATA.vendors || [])
    const rows = vs.map(v => `<tr onclick="_mVendDetail('${esc(v.name).replace(/'/g, '&#39;')}')" style="cursor:pointer"><td style="text-align:left"><b>${esc(v.name)}</b>${v.cat ? `<span class="hint" style="font-size:11px"> ${esc(v.cat)}</span>` : ''}</td><td>${v.nItems}</td><td>${v.amt30 ? nf(v.amt30) : '—'}</td><td class="hint" style="font-size:12px">${v.last ? v.last.slice(5) : '—'}</td></tr>`).join('')
    openModal(`<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">🏭 全部廠商（${vs.length}）</h2>${closeBtn}</div>
      <div class="hint" style="margin:6px 0 10px">點任一家看它的物料與歷史叫貨</div>
      <div class="scroll"><table class="tight" style="min-width:420px"><thead><tr><th style="text-align:left">廠商</th><th>物料數</th><th>近30天額</th><th>最近</th></tr></thead><tbody>${rows}</tbody></table></div>`)
  }

  // 廠商詳情（點廠商 → 該廠商所有物料＋歷史叫貨單，可切時間範圍）
  let _vdName = '', _vdWin = 0
  window._mVendDetail = function (name) { if (name) _vdName = name; _vdWin = 0; _renderVendDetail() }
  window._mVendWin = function (w) { _vdWin = Number(w); const top = document.querySelector('.mDrill:last-of-type'); if (top) top.remove(); _renderVendDetail() }
  function _renderVendDetail () {
    const name = _vdName
    const v = (MDATA.vendors || []).find(x => x.name === name) || { name, nItems: 0, amt30: 0 }
    const cutoff = _vdWin ? (() => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(d.getUTCDate() - _vdWin); return d.toISOString().slice(0, 10) })() : ''
    const its = (MDATA.items || []).filter(o => (o.suppliers || []).includes(name) && (!cutoff || (o.lastDate || '') >= cutoff)).sort((a, b) => b.amt30 - a.amt30)
    const ords = ordersOfVendor(name).filter(o => !cutoff || (o.date || '') >= cutoff)
    const itRows = its.map(o => { const up = o.pctChg != null && o.pctChg > 0, dn = o.pctChg != null && o.pctChg < 0; return `<tr onclick="_mDetail('${esc(o.key).replace(/'/g, '&#39;')}')" style="cursor:pointer"><td style="text-align:left">${esc(o.name)}</td><td>${o.lastPrice != null ? o.lastPrice : '—'}</td><td>${o.pctChg == null ? '<span class="mut">—</span>' : `<span style="color:${up ? COL.r : (dn ? COL.g : 'var(--muted)')};font-weight:800">${up ? '+' : ''}${o.pctChg}%</span>`}</td><td class="hint" style="font-size:12px">${o.lastDate ? o.lastDate.slice(5) : ''}</td></tr>` }).join('')
    const odRows = ords.map(o => { const st = OST[o.status] || [o.status, 'var(--muted)']; return `<tr onclick="_mOrdDetail('${esc(o.id).replace(/'/g, '&#39;')}')" style="cursor:pointer"><td style="text-align:left">${o.date || '—'}</td><td>${o.lineCount || (o.items || []).length}</td><td>${o.total ? nf(o.total) : '—'}</td><td><span style="color:${st[1]};font-weight:700">${st[0]}</span></td></tr>` }).join('')
    const winBtns = [[0, '全部'], [90, '近90天'], [30, '近30天']].map(w => `<button class="mini ${_vdWin === w[0] ? 'on' : ''}" onclick="_mVendWin(${w[0]})">${w[1]}</button>`).join('')
    openModal(`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><div style="font-size:18px;font-weight:800;color:var(--ink)">${esc(name)}</div><div class="hint" style="margin-top:3px">${v.cat ? esc(v.cat) + '　' : ''}${its.length} 項物料・${ords.length} 張叫貨單</div></div>${closeBtn}</div>
      <div style="display:flex;gap:6px;margin:12px 0">${winBtns}</div>
      <h2 style="font-size:15px;margin:6px 0 6px">📦 物料（點看進價曲線）</h2>
      <div class="scroll"><table class="tight" style="min-width:380px"><thead><tr><th style="text-align:left">品項</th><th>最新價</th><th>波動</th><th>最近</th></tr></thead><tbody>${itRows || '<tr><td colspan="4" class="hint">這個區間沒有物料</td></tr>'}</tbody></table></div>
      <h2 style="font-size:15px;margin:16px 0 6px">📄 叫貨單（點看明細）</h2>
      <div class="scroll"><table class="tight" style="min-width:360px"><thead><tr><th style="text-align:left">日期</th><th>品項</th><th>金額</th><th>狀態</th></tr></thead><tbody>${odRows || '<tr><td colspan="4" class="hint">這個區間沒有叫貨單</td></tr>'}</tbody></table></div>`, 600)
  }

  // 當日叫貨（點日期 → 當天所有叫貨單）
  window._mDayDetail = function (date) {
    const ords = ordersOfDate(date)
    const tot = ords.reduce((s, o) => s + (o.total || 0), 0)
    const rows = ords.map(o => { const st = OST[o.status] || [o.status, 'var(--muted)']; return `<tr onclick="_mOrdDetail('${esc(o.id).replace(/'/g, '&#39;')}')" style="cursor:pointer"><td style="text-align:left"><b>${esc(o.supplier)}</b></td><td>${o.lineCount || (o.items || []).length}</td><td>${o.total ? nf(o.total) : '—'}</td><td><span style="color:${st[1]};font-weight:700">${st[0]}</span></td></tr>` }).join('')
    openModal(`<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">📅 ${date} 叫貨</h2>${closeBtn}</div>
      <div class="hint" style="margin:6px 0 10px">共 ${ords.length} 張單・合計 ${money(tot)}（點任一張看明細）</div>
      <div class="scroll"><table class="tight" style="min-width:380px"><thead><tr><th style="text-align:left">廠商</th><th>品項</th><th>金額</th><th>狀態</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="hint">這天沒有叫貨單</td></tr>'}</tbody></table></div>`)
  }

  // 深層連結：DD 通知點 /prep#matlib → 自動開
  try { if ((location.hash || '').replace(/^#/, '').toLowerCase().startsWith('matlib')) { if (/todo/i.test(location.hash)) mSub = 'todo'; if (/card/i.test(location.hash)) mSub = 'card'; setTimeout(() => { try { matlibLoad() } catch (_) {} }, 300) } } catch (_) {}
})()
