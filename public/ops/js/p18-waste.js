// 🧪 /prep 第 18 塊（v4.70.32，2026-10-10）：產品與成本模組｜批次 1b「耗損紀錄 v1（AI 拍照）」
// 規格 docs/COST_MODULE_SPEC.md「耗損紀錄(AI 拍照)」：拍秤面＋全景 → AI 讀數＋物料候選 → 人確認才入帳；舊備料板耗損同一條流水；不扣庫存。
// 後端 ?waste=（api/_waste.js）。UI 慣例：單色線條圖示、不用 prompt、編輯卡片 ✓ 完成、手機 390px 不橫向溢出。
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const nf = n => (Math.round((n || 0) * 10) / 10).toLocaleString()
  const money = n => (n == null ? '—' : 'NT$' + Math.round(n).toLocaleString())
  const I = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto">${d}</svg>`
  const IC = {
    cam: I('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    pen: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    check: I('<polyline points="20 6 9 17 4 12"/>'),
    x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    trash: I('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
    undo: I('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>'),
    scale: I('<path d="M12 3v18"/><path d="M5 7l-3 7h6l-3-7z"/><path d="M19 7l-3 7h6l-3-7z"/><path d="M3 21h18"/>'),
    spark: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
    alert: I('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    img: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  }
  const COL = { b: '#4DA3FF', g: '#3DBE6C', o: '#E8A657', y: '#E8C14E', p: '#B48CF2', r: '#F07373', m: '#8C98A8' }
  let WD = null, wSub = 'list', wF = { from: '', to: '', st: 'all', rs: 'all', by: 'all', q: '' }, wCfgOpen = false
  let M = null // 進行中的拍耗損／手打表單狀態

  const meQ = () => TK() ? '&me=' + encodeURIComponent(TK()) : ''
  const imgUrl = p => '/api/mail-sync?wasteimg=' + encodeURIComponent(K) + meQ() + '&path=' + encodeURIComponent(p)

  window.wasteLoad = async function () {
    curStore = 'waste'; try { setTabs('waste') } catch (_) {}
    try { document.getElementById('upd').textContent = '耗損紀錄' } catch (_) {}
    app.innerHTML = '<section><div class="hint" style="padding:22px">載入耗損紀錄…</div></section>'
    let d = null
    try { const r = await fetch('/api/mail-sync?waste=' + encodeURIComponent(K) + meQ() + '&r=' + Date.now()); d = await r.json() } catch (_) {}
    if (!d || !d.ok) { app.innerHTML = '<section><div class="err">' + esc((d && d.error) || '讀不到耗損資料（連線問題）') + '</div>' + (d && /綁定|登入/.test(d.error || '') ? '<div class="hint" style="margin-top:10px;line-height:1.7">私訊 DD「登入碼」拿 4 位數 → 右上「登入」填入。</div>' : '') + '</section>'; return }
    WD = d; render()
  }
  function liveRows () { const rows = WD.rows || []; const voided = new Set(rows.filter(r => r.voidOf).map(r => r.voidOf)); return rows.map(r => ({ ...r, isVoided: voided.has(r.id) })) }
  function render () {
    const s = WD.stats || {}, t = s.total || {}
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const todayN = (WD.rows || []).filter(r => r.date === today && !r.voidOf).length
    let h = `<h1 style="display:flex;align-items:center;gap:10px">${IC.trash} 耗損紀錄</h1><div class="sub">拍照 → AI 讀秤＋認物料 → 你確認才入帳；只用來解釋盤差，不扣庫存（庫存以盤點為準）</div>`
    h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">`
      + `<button class="mini on" style="padding:10px 16px;font-size:15px" onclick="wasteShot()">${IC.cam} 拍耗損</button>`
      + `<button class="mini" style="padding:10px 14px" onclick="wasteManual()">${IC.pen} 手打一筆</button>`
      + (WD.me && WD.me.canEdit ? `<button class="mini ${wCfgOpen ? 'on' : ''}" style="margin-left:auto" onclick="_wCfgTog()">${IC.gear} 容器／原因／門檻</button>` : '')
      + `</div>`
    if (wCfgOpen) h += cfgCard()
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">`
      + kpi('近 3 個月耗損', money(t.amount), `${nf(t.n)} 筆・${nf(t.g)} g`, COL.r)
      + kpi('今天', nf(todayN) + ' 筆', today.slice(5), COL.b)
      + kpi('大額（≥' + nf((WD.cfg || {}).bigAmt) + '）', nf(t.big) + ' 筆', '待處理中心會看到', COL.o)
      + kpi('算不出金額', nf(t.noCost) + ' 筆', '待物料卡換算', COL.y)
      + kpi('員工餐', nf(t.staffMeal) + ' 筆', '另列不算耗損', COL.m)
      + `</div>`
    h += `<div style="display:flex;gap:8px;margin:16px 0 4px;flex-wrap:wrap">`
      + `<button class="mini ${wSub === 'list' ? 'on' : ''}" onclick="_wSub('list')">紀錄</button>`
      + `<button class="mini ${wSub === 'stat' ? 'on' : ''}" onclick="_wSub('stat')">統計</button>`
      + `<button class="mini ${wSub === 'ai' ? 'on' : ''}" onclick="_wSub('ai')">${IC.spark} AI 命中率／估重</button></div>`
    h += '<div id="wBody">' + body() + '</div>'
    app.innerHTML = h
    try { permScan(app) } catch (_) {}
  }
  const kpi = (l, v, sub, c) => `<div class="kpi" style="text-align:left"><div class="v" style="color:${c};font-size:24px">${v}</div><div class="l">${l}</div><div class="sub2">${sub}</div></div>`
  window._wSub = t => { wSub = t; const el = document.getElementById('wBody'); if (el) el.innerHTML = body(); try { permScan(el) } catch (_) {} }
  window._wCfgTog = () => { wCfgOpen = !wCfgOpen; render() }
  function body () { return wSub === 'stat' ? statView() : (wSub === 'ai' ? aiView() : listView()) }

  // ── 紀錄清單 ──
  function filt () {
    return liveRows().filter(r => {
      if (wF.from && r.date < wF.from) return false
      if (wF.to && r.date > wF.to) return false
      if (wF.st !== 'all' && (r.station || '') !== wF.st) return false
      if (wF.rs !== 'all' && (r.reason || '') !== wF.rs) return false
      if (wF.by !== 'all' && r.by !== wF.by) return false
      if (wF.q && !((r.name || '') + (r.code || '') + (r.note || '')).toLowerCase().includes(wF.q.toLowerCase())) return false
      return true
    })
  }
  window._wF = (k, v) => { wF[k] = v; const el = document.getElementById('wList'); if (el) el.innerHTML = listTable(); else _wSub('list') }
  function chips (k, list, cur) { return `<button class="mini ${cur === 'all' ? 'on' : ''}" onclick="_wF('${k}','all')">全部</button>` + list.map(x => `<button class="mini ${cur === x ? 'on' : ''}" onclick="_wF('${k}','${esc(x).replace(/'/g, '&#39;')}')">${esc(x || '（未填）')}</button>`).join('') }
  function listView () {
    const rows = liveRows()
    const sts = [...new Set(rows.map(r => r.station).filter(Boolean))], rss = [...new Set(rows.map(r => r.reason).filter(Boolean))], bys = [...new Set(rows.map(r => r.by).filter(Boolean))]
    let h = '<section style="padding:12px">'
    h += `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="date" value="${wF.from}" onchange="_wF('from',this.value)" style="border:1px solid var(--line);border-radius:8px;padding:7px 9px"><span class="hint">～</span><input type="date" value="${wF.to}" onchange="_wF('to',this.value)" style="border:1px solid var(--line);border-radius:8px;padding:7px 9px">`
      + `<input value="${esc(wF.q)}" oninput="_wF('q',this.value)" placeholder="搜尋物料／備註" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:8px;padding:8px 10px"></div>`
    if (sts.length) h += `<div class="hint" style="margin:8px 0 3px">站別</div><div style="display:flex;gap:6px;flex-wrap:wrap">${chips('st', sts, wF.st)}</div>`
    if (rss.length) h += `<div class="hint" style="margin:8px 0 3px">原因</div><div style="display:flex;gap:6px;flex-wrap:wrap">${chips('rs', rss, wF.rs)}</div>`
    if (bys.length) h += `<div class="hint" style="margin:8px 0 3px">記錄人</div><div style="display:flex;gap:6px;flex-wrap:wrap">${chips('by', bys, wF.by)}</div>`
    h += '</section><div id="wList">' + listTable() + '</div>'
    return h
  }
  function tag (t, c) { return `<span style="font-size:11.5px;font-weight:800;color:${c};border:1px solid ${c};border-radius:6px;padding:0 6px;white-space:nowrap">${t}</span>` }
  function listTable () {
    const rows = filt()
    if (!rows.length) return '<section><div class="hint" style="padding:20px;text-align:center">還沒有耗損紀錄。按上面「拍耗損」開始。</div></section>'
    const can = WD.me && WD.me.canEdit
    let h = `<div class="hint" style="margin:6px 2px">${rows.length} 筆（含舊備料板紀錄；沖銷筆以灰字顯示）</div>`
    for (const r of rows.slice(0, 200)) {
      const dim = r.voidOf || r.isVoided
      const ph = (r.photos || [])[0]
      h += `<section style="padding:10px 12px;margin-top:8px;${dim ? 'opacity:.5' : ''};border-left:3px solid ${r.bigFlag ? COL.o : (r.staffMeal ? COL.m : COL.r)}"><div style="display:flex;gap:10px;align-items:flex-start">`
      h += ph ? `<img src="${imgUrl(ph.path)}" loading="lazy" onclick="_wPhoto('${esc(ph.path)}')" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex:0 0 auto;cursor:pointer;background:var(--soft)">` : `<div style="width:56px;height:56px;border-radius:8px;background:var(--soft);display:flex;align-items:center;justify-content:center;color:var(--muted);flex:0 0 auto">${IC.img}</div>`
      h += `<div style="flex:1;min-width:0"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">`
        + (r.src === 'board' ? tag('舊備料板', COL.m) : r.src === 'photo' ? tag('AI 拍照', COL.b) : r.src === 'est' ? tag('估', COL.y) : tag('手打', COL.p))
        + (r.corrected ? tag('有修正', COL.o) : '') + (r.bigFlag ? tag('大額', COL.o) : '') + (r.voidOf ? tag('沖銷', COL.m) : '') + (r.isVoided ? tag('已沖銷', COL.m) : '') + (r.staffMeal ? tag('員工餐', COL.m) : '')
        + `<span class="hint" style="margin-left:auto;font-size:12px">${esc(r.date)} ${esc(String(r.ts || '').slice(11, 16))}</span></div>`
      h += `<div style="font-weight:800;font-size:16px;margin-top:3px">${esc(r.name)}${r.code ? ` <span class="hint" style="font-weight:600">${esc(r.code)}</span>` : ''}</div>`
      h += `<div style="margin-top:2px;font-size:14.5px">${r.netG != null ? `<b>${nf(r.netG)} g</b>` : ''}${r.qty != null ? `<b>${nf(r.qty)} ${esc(r.qtyUnit || '')}</b>` : ''}${r.tareG ? ` <span class="hint">（毛 ${nf(r.grossG)} − 皿 ${nf(r.tareG)}${r.container ? '・' + esc(r.container) : ''}）</span>` : ''} ・ <b style="color:${r.amount == null ? COL.m : COL.r}">${r.amount == null ? '金額待物料卡' : money(r.amount)}</b></div>`
      h += `<div class="hint" style="margin-top:2px">${esc(r.reason || '—')}${r.note ? '・' + esc(r.note) : ''}${r.station ? '・' + esc(r.station) : ''}・${esc(r.by || '')}${r.costNote && r.amount == null ? '・' + esc(r.costNote) : ''}</div>`
      if (r.ai && (r.ai.readG != null || (r.ai.cands || []).length)) h += `<div class="hint" style="margin-top:2px;font-size:12px">AI：${r.ai.readG != null ? `讀 ${nf(r.ai.readG)} g（信心 ${Math.round((r.ai.conf || 0) * 100)}%）` : '沒讀到數字'}${(r.ai.cands || []).length ? '・猜 ' + esc(r.ai.cands[0].name) : ''}${(r.ai.flags || []).length ? '・' + esc(r.ai.flags.join(',')) : ''}</div>`
      h += `</div></div>`
      if (can && !dim && r.src !== 'board') h += `<div style="margin-top:6px;text-align:right"><button class="mini" onclick="wasteVoid('${r.id}','${esc(r.date).slice(0, 7)}')">${IC.undo} 沖銷這筆</button></div>`
      h += '</section>'
    }
    if (rows.length > 200) h += '<div class="hint" style="margin:8px 2px">只顯示前 200 筆，請縮小日期範圍</div>'
    return h
  }
  window._wPhoto = p => { const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:90;display:flex;align-items:center;justify-content:center;padding:12px'; ov.onclick = () => ov.remove(); ov.innerHTML = `<img src="${imgUrl(p)}" style="max-width:100%;max-height:100%;border-radius:10px">`; document.body.appendChild(ov) }
  window.wasteVoid = async (id, ym) => { if (!confirm('沖銷這筆耗損？會另寫一筆負數紀錄，原紀錄保留。')) return; if (await post({ op: 'void', id, ym })) wasteLoad() }

  // ── 統計 ──
  function bars (list, c) { if (!list.length) return '<div class="hint">沒有資料</div>'; const mx = Math.max(1, ...list.map(x => x.amount)); return list.slice(0, 12).map(x => `<div style="display:flex;align-items:center;gap:8px;margin:5px 0"><div style="width:96px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.k)}">${esc(x.k)}</div><div style="flex:1;height:14px;background:var(--soft);border-radius:7px;overflow:hidden"><div style="width:${Math.round(x.amount / mx * 100)}%;height:100%;background:${c}"></div></div><div style="width:120px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums">${money(x.amount)} <span class="hint">${x.n}筆</span></div></div>`).join('') }
  function statView () {
    const s = WD.stats || {}
    const sec = (t, inner) => `<section><h2 style="margin:0 0 8px">${t}</h2>${inner}</section>`
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">`
      + sec('依物料', bars(s.byItem || [], COL.r)) + sec('依原因', bars(s.byReason || [], COL.o)) + sec('依站別', bars(s.byStation || [], COL.b)) + sec('依記錄人', bars(s.byPerson || [], COL.p))
      + `</div><div class="hint" style="margin:10px 2px;line-height:1.7">金額＝淨重 × 入帳當時物料成本（快照，之後變價不改）；沒成本／沒換算的筆算不出金額，等批次 2 物料卡補齊。佔營收 %、與盤差對照：等盤點資料串接後補。</div>`
  }
  function aiView () {
    const s = WD.stats || {}, prods = [...(WD.products.ground || []), ...(WD.products.abeach || [])]
    const nm = c => (prods.find(p => p.code === c) || {}).name || c
    let h = `<section><h2 style="margin:0 0 6px">辨識命中率</h2><div class="hint" style="margin-bottom:8px">命中＝AI 第一名等於你最後選的物料。低於 60% 的物料多拍幾張全景照當參考照會變準。</div>`
    if (!(s.hit || []).length) h += '<div class="hint">還沒有 AI 辨識紀錄</div>'
    else h += `<table style="width:100%;font-size:14px;border-collapse:collapse">${s.hit.sort((a, b) => a.rate - b.rate).map(x => `<tr style="border-top:1px solid var(--line)"><td style="padding:6px 4px">${esc(nm(x.code))}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${x.n} 次</td><td style="text-align:right;color:${x.rate >= 60 ? COL.g : COL.o};font-weight:800">${x.rate == null ? '—' : x.rate + '%'}</td><td style="text-align:right" class="hint">參考照 ${(WD.refsN || {})[x.code] || 0}${x.rate != null && x.rate < 60 ? '・多拍參考照' : ''}</td></tr>`).join('')}</table>`
    h += '</section>'
    h += `<section><h2 style="margin:0 0 6px">看照片估重（第三階段，先量測再開放）</h2><div class="hint" style="margin-bottom:8px">有拍全景照的紀錄，AI 會另外盲估一次重量跟秤的真值配對存起來（不顯示在紀錄裡）。每個物料累積 ≥ ${(WD.cfg.est || {}).minPairs} 筆且誤差中位數 ≤ ${(WD.cfg.est || {}).maxErr}% 才開放免秤。</div>`
    if (!(s.est || []).length) h += '<div class="hint">還沒有配對資料</div>'
    else h += `<table style="width:100%;font-size:14px;border-collapse:collapse">${s.est.map(x => `<tr style="border-top:1px solid var(--line)"><td style="padding:6px 4px">${esc(nm(x.code))}</td><td style="text-align:right">${x.n} 筆</td><td style="text-align:right">誤差中位數 ${x.medErr == null ? '—' : x.medErr + '%'}</td><td style="text-align:right;font-weight:800;color:${x.open ? COL.g : COL.m}">${x.open ? '可開放' : '未達門檻'}</td></tr>`).join('')}</table>`
    return h + '</section>'
  }

  // ── 設定：容器／原因／門檻 ──
  function cfgCard () {
    const c = WD.cfg || {}
    return `<section style="padding:12px 14px;margin:0 0 12px"><div style="font-weight:800;margin-bottom:6px">常用容器（選了自動扣皿重）</div><div id="wCont">${(c.containers || []).map((x, i) => contRow(x, i)).join('')}</div><button class="mini" onclick="_wContAdd()">＋ 加容器</button>
      <div style="font-weight:800;margin:12px 0 6px">原因選單</div><input id="wReasons" value="${esc((c.reasons || []).join('、'))}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px"><div class="hint">用「、」分隔；「其他」要填說明；員工餐是獨立開關不在這裡</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px"><label>大額門檻（元）<br><input id="wBig" type="number" value="${c.bigAmt}" style="width:110px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"></label><label>估重開放：配對筆數 ≥<br><input id="wEstN" type="number" value="${(c.est || {}).minPairs}" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"></label><label>誤差中位數 ≤ %<br><input id="wEstE" type="number" value="${(c.est || {}).maxErr}" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"></label></div>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="mini on" onclick="wasteCfgSave()">${IC.check} 完成</button><button class="mini" onclick="_wCfgTog()">${IC.x} 取消</button></div></section>`
  }
  const contRow = (x, i) => `<div class="wCrow" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="wCn" value="${esc(x.name)}" placeholder="容器名" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:6px 8px"><input class="wCg" type="number" value="${x.g}" placeholder="g" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:6px 8px"><span class="hint">g</span><button class="mini" onclick="this.closest('.wCrow').remove()">${IC.x}</button></div>`
  window._wContAdd = () => { const el = document.getElementById('wCont'); if (el) el.insertAdjacentHTML('beforeend', contRow({ name: '', g: '' }, 0)) }
  window.wasteCfgSave = async () => {
    const containers = [...document.querySelectorAll('#wCont .wCrow')].map(r => ({ name: r.querySelector('.wCn').value.trim(), g: Number(r.querySelector('.wCg').value) || 0 })).filter(x => x.name)
    const reasons = (document.getElementById('wReasons').value || '').split(/[、,，]/).map(x => x.trim()).filter(Boolean)
    if (await post({ op: 'cfg', containers, reasons, bigAmt: document.getElementById('wBig').value, est: { minPairs: document.getElementById('wEstN').value, maxErr: document.getElementById('wEstE').value } })) { wCfgOpen = false; wasteLoad() }
  }

  async function post (body) {
    let j = null
    try { const r = await fetch('/api/mail-sync?waste=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) }); j = await r.json() } catch (_) { j = { ok: false, error: '連線問題' } }
    if (!j.ok) alert(j.error || '沒成功')
    return j.ok ? j : null
  }

  // ── 拍耗損／手打：全螢幕表單 ──
  window.wasteShot = () => openForm(true)
  window.wasteManual = () => openForm(false)
  function openForm (withPhoto) {
    if (!WD) return
    M = { withPhoto, store: 'ground', station: (WD.stations || [])[0] || '', photos: {}, ai: null, draft: null, code: '', name: '', mode: 'g', grossG: '', tareG: 0, container: '', qty: '', qtyUnit: '', reason: '', note: '', staffMeal: false, q: '', busy: false, sanityOk: false }
    paintForm()
  }
  const prodsOf = () => (M.store === 'abeach' ? WD.products.abeach : WD.products.ground) || []
  function paintForm () {
    let ov = document.getElementById('wOv')
    if (!ov) { ov = document.createElement('div'); ov.id = 'wOv'; ov.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:80;overflow:auto;padding:14px 14px calc(24px + env(safe-area-inset-bottom))'; document.body.appendChild(ov) }
    const p = prodsOf().find(x => x.code === M.code)
    const isCount = p && (WD.countUnits || []).includes(p.unit)
    let h = `<div style="max-width:640px;margin:0 auto"><div style="display:flex;align-items:center;gap:10px"><h2 style="margin:0;flex:1">${M.withPhoto ? IC.cam + ' 拍耗損' : IC.pen + ' 手打耗損'}</h2><button class="mini" onclick="_wClose()">${IC.x} 關閉</button></div>`
    // 店別／站別
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><button class="mini ${M.store === 'ground' ? 'on' : ''}" onclick="_wSet('store','ground')">GROUN:D</button><button class="mini ${M.store === 'abeach' ? 'on' : ''}" onclick="_wSet('store','abeach')">A Beach</button><span style="width:10px"></span>${(WD.stations || []).map(s => `<button class="mini ${M.station === s ? 'on' : ''}" onclick="_wSet('station','${esc(s).replace(/'/g, '&#39;')}')">${esc(s)}</button>`).join('')}</div>`
    // 照片
    if (M.withPhoto) {
      h += `<section style="padding:12px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${photoBox('scale', '第 1 張：秤面特寫', '看得清數字')}${photoBox('wide', '第 2 張：物料全景', '選填，幫 AI 認物料')}</div>`
      h += `<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="mini on" onclick="wasteAi()" ${M.busy || !M.photos.scale && !M.photos.wide ? 'disabled' : ''}>${IC.spark} ${M.busy ? 'AI 辨識中…' : 'AI 讀秤＋認物料'}</button><span class="hint">AI 只預填，入帳前你可以改</span></div>`
      if (M.ai) {
        const a = M.ai
        h += `<div style="margin-top:10px;background:var(--psoft);border-radius:10px;padding:10px 12px;font-size:14px;line-height:1.7">`
          + (a.err ? `<div style="color:${COL.r}">AI 沒回應：${esc(a.err)}（可以手打）</div>` : '')
          + `<div>${IC.scale} 秤面：${a.readG != null ? `<b>${nf(a.readG)} g</b>（信心 ${Math.round(a.conf * 100)}%）` : '沒讀到數字'}${(a.flags || []).length ? ` <span style="color:${COL.o}">${esc(a.flags.map(f => ({ negative: '負數', tare: 'TARE/歸零', unclear: '看不清', no_scale: '沒看到秤' })[f] || f).join('、'))}</span>` : ''}${!a.usable ? ' → <b>請手打重量</b>' : ''}</div>`
          + `<div>物料候選：${(a.cands || []).length ? a.cands.map(c => `<button class="mini ${M.code === c.code ? 'on' : ''}" onclick="_wPick('${esc(c.code)}')">${esc(c.name)} <span class="hint">${Math.round(c.conf * 100)}%</span></button>`).join(' ') : '沒有把握，請搜尋'}</div>`
          + (a.notes ? `<div class="hint">${esc(a.notes)}</div>` : '') + `<div class="hint" style="font-size:12px">模型 ${esc(a.model || '')}</div></div>`
      }
      h += '</section>'
    }
    // 物料
    h += `<section style="padding:12px"><div style="font-weight:800;margin-bottom:6px">物料 ${p ? `<span style="color:${COL.g}">${IC.check} ${esc(p.name)}</span> <span class="hint">${esc(p.code)}・${esc(p.unit)}${p.cost || p.price ? '・' + (p.cost || p.price) + ' 元/' + esc(p.unit) : '・沒成本'}</span>` : '<span class="hint">還沒選</span>'}</div>`
    h += `<input value="${esc(M.q)}" oninput="_wSet('q',this.value,1)" placeholder="搜尋物料名稱／代碼（${M.store === 'abeach' ? 'A Beach' : 'GROUN:D'} 主檔 ${prodsOf().length} 項）" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px">`
    const q = M.q.trim().toLowerCase()
    const list = q ? prodsOf().filter(x => (x.name + x.code + x.category).toLowerCase().includes(q)).slice(0, 12) : (M.withPhoto ? [] : prodsOf().filter(x => (x.stock || 0) > 0).slice(0, 12))
    if (list.length) h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${list.map(x => `<button class="mini ${M.code === x.code ? 'on' : ''}" onclick="_wPick('${esc(x.code)}')">${esc(x.name)} <span class="hint">${esc(x.unit)}</span></button>`).join('')}</div>`
    else if (q) h += `<div class="hint" style="margin-top:6px">找不到，可直接用名稱入帳（金額會待物料卡）：<button class="mini" onclick="_wPickName()">用「${esc(M.q)}」</button></div>`
    h += '</section>'
    // 重量／數量
    h += `<section style="padding:12px"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><span style="font-weight:800">記法</span><button class="mini ${M.mode === 'g' ? 'on' : ''}" onclick="_wSet('mode','g')">秤重（g）</button><button class="mini ${M.mode === 'n' ? 'on' : ''}" onclick="_wSet('mode','n')">數量${isCount ? '（' + esc(p.unit) + '）' : ''}</button></div>`
    if (M.mode === 'g') {
      const gross = Number(M.grossG) || 0, tare = Number(M.tareG) || 0, net = Math.max(0, gross - tare)
      h += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="hint">毛重 g（秤上數字）<br><input id="wGross" type="number" inputmode="decimal" value="${esc(M.grossG)}" oninput="_wSet('grossG',this.value,1)" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:18px;font-weight:800"></label>`
        + `<label class="hint">扣皿重 g<br><input type="number" inputmode="decimal" value="${esc(M.tareG)}" oninput="_wSet('tareG',this.value,1)" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:18px"></label></div>`
      if ((WD.cfg.containers || []).length) h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><span class="hint">常用容器：</span><button class="mini ${!M.container ? 'on' : ''}" onclick="_wCont('',0)">已歸零／無</button>${WD.cfg.containers.map(c => `<button class="mini ${M.container === c.name ? 'on' : ''}" onclick="_wCont('${esc(c.name).replace(/'/g, '&#39;')}',${c.g})">${esc(c.name)} ${c.g}g</button>`).join('')}</div>`
      else h += `<div class="hint" style="margin-top:6px">建議先按秤的歸零鍵再放物料；或請管理者在「容器／原因／門檻」建常用容器。</div>`
      h += `<div style="margin-top:8px;font-size:16px">淨重 <b style="font-size:22px;color:${COL.r}">${nf(net)} g</b>${p && net > 0 ? estAmt(p, net) : ''}</div>`
      if (M.draft && M.draft.sanity && !M.sanityOk) h += `<div style="margin-top:8px;background:#3a2a12;border:1px solid ${COL.o};border-radius:10px;padding:8px 10px;color:${COL.o}">${IC.alert} ${esc(M.draft.sanity.msg)} <button class="mini" onclick="_wSet('sanityOk',true)">確定沒錯</button></div>`
    } else {
      h += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="hint">數量<br><input type="number" inputmode="decimal" value="${esc(M.qty)}" oninput="_wSet('qty',this.value,1)" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:18px;font-weight:800"></label><label class="hint">單位<br><input value="${esc(M.qtyUnit || (p ? p.unit : ''))}" oninput="_wSet('qtyUnit',this.value,1)" placeholder="顆／片／塊／支" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:18px"></label></div>`
    }
    h += '</section>'
    // 原因
    h += `<section style="padding:12px"><div style="font-weight:800;margin-bottom:6px">原因</div><div style="display:flex;gap:6px;flex-wrap:wrap">${(WD.reasons || []).map(r => `<button class="mini ${M.reason === r ? 'on' : ''}" onclick="_wSet('reason','${esc(r)}')">${esc(r)}</button>`).join('')}<button class="mini ${M.staffMeal ? 'on' : ''}" style="margin-left:auto" onclick="_wSet('staffMeal',${!M.staffMeal})">員工餐（不算耗損）</button></div>`
    h += `<input value="${esc(M.note)}" oninput="_wSet('note',this.value,1)" placeholder="${M.reason === '其他' ? '原因「其他」必填說明' : '說明（選填）'}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:8px"></section>`
    h += `<div style="display:flex;gap:8px;margin-top:4px"><button class="mini on" style="padding:12px 18px;font-size:16px;flex:1" onclick="wasteSend()" ${M.busy ? 'disabled' : ''}>${IC.check} 確認入帳</button><button class="mini" onclick="_wClose()">取消</button></div>`
    h += `<div class="hint" style="margin-top:8px;line-height:1.6">入帳＝寫一筆耗損流水（不扣庫存）。AI 讀到的原始值會一起存；你改過的就標「有修正」當 AI 的學習資料。</div></div>`
    ov.innerHTML = h
    try { permScan(ov) } catch (_) {}
  }
  function estAmt (p, net) { const c = p.cost || p.price; if (!c) return ' <span class="hint">金額待物料卡</span>'; const u = String(p.unit || ''); let perG = null; if (/^(kg|公斤)$/i.test(u)) perG = c / 1000; else if (/^(g|公克|克|ml|毫升)$/i.test(u)) perG = c; else { const m = String(p.spec || p.name).replace(/×/g, '*').match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|公斤|公克)(?![a-z])\s*(?:\*\s*(\d+))?/i); if (m) { let v = Number(m[1]) * (m[3] ? Number(m[3]) : 1); if (/kg|公斤|^l$/i.test(m[2])) v *= 1000; perG = c / v } } return perG ? ` <span class="hint">≈ ${money(net * perG)}</span>` : ' <span class="hint">金額待物料卡</span>' }
  function photoBox (type, title, sub) {
    const ph = M.photos[type]
    return `<div style="border:1px dashed var(--line);border-radius:10px;padding:8px;text-align:center;min-height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer" onclick="_wPickPhoto('${type}')">${ph ? `<img src="${ph.dataUrl}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px">` : IC.cam}<div style="font-weight:800;font-size:13.5px">${title}</div><div class="hint" style="font-size:12px">${ph ? '點一下重拍' : sub}</div></div>`
  }
  window._wPickPhoto = type => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { const img = new Image(); img.onload = () => { const max = 1024, sc = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); M.photos[type] = { dataUrl: cv.toDataURL('image/jpeg', 0.8) }; M.ai = null; M.draft = null; paintForm() }; img.onerror = () => alert('這張圖讀不開'); img.src = rd.result }; rd.readAsDataURL(f) }
    inp.click()
  }
  window._wSet = (k, v, quiet) => { M[k] = v; if (k === 'store') { M.code = ''; M.name = '' } if (k === 'staffMeal' && v) M.reason = ''; if (k === 'reason') M.staffMeal = false; if (!quiet) paintForm(); else if (k === 'grossG' || k === 'tareG' || k === 'q') { clearTimeout(M._t); M._t = setTimeout(() => { const act = document.activeElement; const id = act && act.id; const pos = act && act.selectionStart; paintForm(); if (id) { const e = document.getElementById(id); if (e) { e.focus(); try { e.setSelectionRange(pos, pos) } catch (_) {} } } }, k === 'q' ? 250 : 600) } }
  window._wPick = code => { const p = prodsOf().find(x => x.code === code); M.code = code; M.name = p ? p.name : ''; M.q = ''; if (p && (WD.countUnits || []).includes(p.unit) && !M.grossG) M.qtyUnit = p.unit; paintForm() }
  window._wPickName = () => { M.code = ''; M.name = M.q.trim(); paintForm() }
  window._wCont = (name, g) => { M.container = name; M.tareG = g; paintForm() }
  window._wClose = () => { const ov = document.getElementById('wOv'); if (ov) ov.remove(); M = null }

  window.wasteAi = async () => {
    if (!M || M.busy) return
    M.busy = true; paintForm()
    const photos = ['scale', 'wide'].filter(t => M.photos[t]).map(t => ({ type: t, dataUrl: M.photos[t].dataUrl }))
    const q = M.q.trim().toLowerCase()
    const cand = (q ? prodsOf().filter(x => (x.name + x.code).toLowerCase().includes(q)) : prodsOf().filter(x => (x.stock || 0) > 0)).slice(0, 30).map(x => x.code)
    const j = await post({ op: 'ai', photos, store: M.store, station: M.station, candCodes: cand })
    M.busy = false
    if (!j) { paintForm(); return }
    M.draft = j; M.ai = j.ai
    if (j.ai && j.ai.usable && j.ai.readG != null && !M.grossG) M.grossG = String(j.ai.readG)
    if (j.ai && (j.ai.cands || [])[0] && !M.code) _wPick(j.ai.cands[0].code)
    paintForm()
  }
  window.wasteSend = async () => {
    if (!M || M.busy) return
    const p = prodsOf().find(x => x.code === M.code)
    if (!p && !M.name) { alert('要先選物料'); return }
    if (!M.staffMeal && !M.reason) { alert('要選原因'); return }
    if (M.reason === '其他' && !M.note.trim()) { alert('原因「其他」要填說明'); return }
    const gross = Number(M.grossG) || 0, tare = Number(M.tareG) || 0, net = Math.max(0, gross - tare)
    if (M.mode === 'g' && !(net > 0)) { alert('淨重要大於 0（毛重減皿重）'); return }
    if (M.mode === 'n' && !(Number(M.qty) > 0)) { alert('數量要大於 0'); return }
    if (M.mode === 'g' && M.draft && M.draft.sanity && !M.sanityOk) { alert('請先按「確定沒錯」'); return }
    M.busy = true; paintForm()
    const body = { op: 'add', draftId: M.draft && M.draft.draftId, photos: M.draft ? M.draft.photos : [], ai: M.ai, store: M.store, station: M.station, code: M.code, name: M.name, reason: M.reason, note: M.note, staffMeal: M.staffMeal, src: M.withPhoto ? 'photo' : 'manual' }
    if (M.mode === 'g') Object.assign(body, { grossG: gross, tareG: tare, container: M.container, netG: net })
    else Object.assign(body, { qty: Number(M.qty), qtyUnit: M.qtyUnit || (p ? p.unit : '個') })
    const j = await post(body)
    M.busy = false
    if (!j) { paintForm(); return }
    _wClose(); wasteLoad()
  }
})()
