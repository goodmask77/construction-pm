// 🧾 團體訂餐（GD 分頁）v4.70.78 批次 1｜規格 docs/GROUP_ORDER_SPEC.md（張良 2026-10-12「照這版開工做批次 1」）
// 列表（索引）→ 一張單：基本資料／每人一列核價（只能換成最新菜單品項，沒有手填價格）／共用／金額／狀態動作／搬運建議／紀錄
// 從收件匣對話右上「點餐單」建單＋發連結（goFromInbox）；計價一律 window.GOCALC（grporder-calc.js，與客人頁、後端同一支）
let _goD = null, _goCur = null, _goSaveT = null, _goFilter = 'open'
const GC = () => window.GOCALC
const goEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const goN = n => Math.round(Number(n) || 0).toLocaleString('zh-TW')
async function goGet (q) { try { const r = await fetch('/api/mail-sync?grporder=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK() || '') + '&' + q + '&r=' + Date.now()); return await r.json() } catch (_) { return null } }
async function goPost (b) { try { const r = await fetch('/api/mail-sync?grporder=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, token: TK() }) }); return await r.json() } catch (_) { return null } }
const GO_ST_COLOR = { draft: '#6b7280', sent: '#0ea5e9', submitted: '#d97706', priced: '#2563eb', confirmed: '#16a34a', locked: '#7c3aed', done: '#16a34a', void: '#9ca3af' }
function goPill (st) { const L = GC() ? GC().STATUS_LABEL : {}; return `<span style="display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:800;color:#fff;background:${GO_ST_COLOR[st] || '#6b7280'}">${goEsc(L[st] || st)}</span>` }
function goToast (t, bad) { let el = document.getElementById('goToast'); if (!el) { el = document.createElement('div'); el.id = 'goToast'; el.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:95;padding:9px 16px;border-radius:10px;font-weight:800;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:opacity .3s'; document.body.appendChild(el) } el.style.background = bad ? '#b91c1c' : '#166534'; el.style.color = '#fff'; el.textContent = t; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0' }, 2200) }
function goModal (inner, w) { const old = document.getElementById('goOv'); if (old) old.remove(); const ov = document.createElement('div'); ov.id = 'goOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:14px'; ov.innerHTML = `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:18px;width:min(${w || 560}px,100%);max-height:92vh;overflow:auto" onclick="event.stopPropagation()">${inner}</div>`; ov.onclick = () => ov.remove(); document.body.appendChild(ov); return ov }
const goClose = () => { const o = document.getElementById('goOv'); if (o) o.remove() }

// ── 列表 ──
async function gorderLoad (id) {
  curStore = 'gorder'; setTabs('gorder')
  const b = document.getElementById('tab-gorder'); if (b) b.className = 'on'
  try { document.getElementById('upd').textContent = '團體訂餐' } catch (_) {}
  if (!_goD) app.innerHTML = '<section><h2>團體訂餐</h2><div class="hint">讀取中…</div></section>'
  const d = await goGet('op=list')
  if (!d || !d.ok) { app.innerHTML = '<section><h2>團體訂餐</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">' + goEsc((d && d.error) || '讀不到團體訂餐') + '</div></section>'; return }
  _goD = d
  if (id) return goOpen(id)
  _goCur = null; goRenderList()
  try { history.replaceState(null, '', location.pathname + location.search + '#tab=gorder') } catch (_) {}
}
function goRenderList () {
  const L = GC().STATUS_LABEL
  const all = _goD.list || []
  const list = all.filter(x => _goFilter === 'all' ? true : _goFilter === 'open' ? !['done', 'void'].includes(x.status) : ['done', 'void'].includes(x.status))
  const chip = (k, t) => `<button class="mini ${_goFilter === k ? 'on' : ''}" onclick="_goFilter='${k}';goRenderList()">${t}</button>`
  app.innerHTML = `<section>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><h2 style="margin:0">團體訂餐</h2><span class="hint">從收件匣對話右上「點餐單」建單、發連結；客人填好送出會通知負責人</span><span style="flex:1"></span>${_goD.me.canEdit ? `<button class="mini" onclick="goCfg()">設定</button>` : ''}</div>
    <div style="display:flex;gap:6px;margin-bottom:10px">${chip('open', '進行中 ' + all.filter(x => !['done', 'void'].includes(x.status)).length)}${chip('done', '完成／作廢')}${chip('all', '全部')}</div>
    ${list.length ? `<div style="overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:14px;background:var(--card)"><thead><tr style="text-align:left"><th style="padding:8px;border:1px solid var(--line)">客戶</th><th style="padding:8px;border:1px solid var(--line)">取餐</th><th style="padding:8px;border:1px solid var(--line);text-align:right">人數</th><th style="padding:8px;border:1px solid var(--line);text-align:right">暫計</th><th style="padding:8px;border:1px solid var(--line)">狀態</th><th style="padding:8px;border:1px solid var(--line)">負責</th><th style="padding:8px;border:1px solid var(--line)">更新</th></tr></thead><tbody>
      ${list.map(x => `<tr style="cursor:pointer" onclick="goOpen('${x.id}')"><td style="padding:8px;border:1px solid var(--line);font-weight:800">${goEsc(x.company || x.custName || '—')}<div class="hint" style="font-size:12px">${goEsc(x.custName || '')}</div></td><td style="padding:8px;border:1px solid var(--line)">${goEsc(x.when || '待定')}</td><td style="padding:8px;border:1px solid var(--line);text-align:right">${x.n || 0}</td><td style="padding:8px;border:1px solid var(--line);text-align:right;font-weight:800">${goN(x.total)}</td><td style="padding:8px;border:1px solid var(--line)">${goPill(x.status)}</td><td style="padding:8px;border:1px solid var(--line)">${goEsc(x.assignee || '')}</td><td style="padding:8px;border:1px solid var(--line)" class="hint">${goEsc(String(x.updatedAt || '').slice(5, 16).replace('T', ' '))}</td></tr>`).join('')}
    </tbody></table></div>` : `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px" class="hint">還沒有${_goFilter === 'open' ? '進行中的' : ''}訂餐單。到「收件匣」打開客人對話，按右上「點餐單」就能建一張。</div>`}
  </section>`
}

// ── 一張單 ──
async function goOpen (id) {
  const d = await goGet('op=get&id=' + encodeURIComponent(id))
  if (!d || !d.ok) { goToast((d && d.error) || '讀不到這張單', true); return }
  _goCur = d; goRenderDetail()
  try { history.replaceState(null, '', location.pathname + location.search + '#tab=gorder&id=' + id) } catch (_) {}
}
function goOpt (kind, sel, menu) {
  const items = GC().flatItems(menu).filter(i => kind === 'main' ? i.kind !== 'pizza' && i.kind !== 'drink' : i.kind === kind)
  return `<option value="">—</option>` + items.map(i => `<option value="${i.id}" ${sel === i.id ? 'selected' : ''} ${i.soon ? 'disabled' : ''}>${goEsc(i.name)}${i.soon ? '（即將上線）' : ' ' + i.price}</option>`).join('')
}
function goRenderDetail () {
  const { order: o, menu, cfg, link, me } = _goCur
  const C9 = GC(), L = C9.STATUS_LABEL, t = C9.totals(menu, o), cr = C9.carry(menu, o, cfg.carry)
  const lock = !['draft', 'sent', 'submitted', 'priced', 'confirmed'].includes(o.status) || !me.canEdit
  const dis = lock ? 'disabled' : ''
  const inp = (k, v, extra) => `<input ${dis} value="${goEsc(v)}" onchange="goHeadSet('${k}',this.value)" style="border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit;font-size:14px;${extra || ''}">`
  const pipe = C9.STATUS.map(s => `<span style="font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);${s === o.status ? 'background:' + (GO_ST_COLOR[s] || '#555') + ';color:#fff;border-color:transparent;font-weight:800' : C9.STATUS.indexOf(s) < C9.STATUS.indexOf(o.status) ? 'background:var(--line)' : 'color:var(--muted)'}">${L[s]}</span>`).join('')
  // 1b：一人多道（像 UberEats 每人自己點）；每道＝品項×量＋單點／套餐（副餐＋飲品）
  const sel = (kind, cur, attr) => `<select ${dis} ${attr} style="max-width:170px;border:1px solid var(--line);border-radius:7px;padding:4px;background:var(--card);color:inherit;font-size:12.5px">${goOpt(kind, cur, menu)}</select>`
  const rows = (o.rows || []).map((r, i) => {
    const p = C9.priceRow(menu, r, o.frozen), bad = p.pend || p.missing
    const lines = (r.lines || []).map((l, j) => { const it = C9.itemOf(menu, l.id); const lp = C9.priceLine(menu, l, o.frozen); const cs = C9.canSet(it)
      return `<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:3px 0;border-bottom:1px dashed var(--line)">
        ${sel('main', l.id, `onchange="goLineSet(${i},${j},'id',this.value)"`)}<input ${dis} type="number" min="1" value="${l.q || 1}" onchange="goLineSet(${i},${j},'q',this.value)" style="width:44px;border:1px solid var(--line);border-radius:7px;padding:4px;background:var(--card);color:inherit;text-align:center">
        ${cs ? `<label style="display:flex;align-items:center;gap:3px;font-size:12.5px;white-space:nowrap"><input ${dis} type="checkbox" ${l.set ? 'checked' : ''} onchange="goLineSet(${i},${j},'set',this.checked)">套餐</label>` : ''}
        ${l.set ? `<span class="hint" style="font-size:12px">副餐</span>${sel('snack', l.side && l.side.id, `onchange="goLineSet(${i},${j},'side',this.value)"`)}<span class="hint" style="font-size:12px">飲品</span>${sel('drink', l.drink && l.drink.id, `onchange="goLineSet(${i},${j},'drink',this.value)"`)}<input ${dis} value="${goEsc((l.drink || {}).note || '')}" placeholder="冰／糖" onchange="goLineSet(${i},${j},'dnote',this.value)" style="width:70px;border:1px solid var(--line);border-radius:7px;padding:4px;background:var(--card);color:inherit;font-size:12px">` : ''}
        <input ${dis} value="${goEsc(l.note || '')}" placeholder="口味／備註" onchange="goLineSet(${i},${j},'note',this.value)" style="width:90px;border:1px solid var(--line);border-radius:7px;padding:4px;background:var(--card);color:inherit;font-size:12px">
        <b style="margin-left:auto;font-family:var(--num,inherit);color:${lp.missing ? '#d97706' : 'inherit'}">${lp.missing ? '已下架' : goN(lp.total)}</b>${lock ? '' : `<button class="mini" style="padding:1px 6px;color:var(--red)" onclick="goLineDel(${i},${j})">×</button>`}</div>` }).join('')
    const pend = (r.pend || []).map((pd, j) => `<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:12.5px"><span style="background:#fde68a;color:#7c2d12;border-radius:999px;padding:2px 8px;font-weight:800">待確認：${goEsc(pd.text)}${pd.q > 1 ? ' ×' + pd.q : ''}</span>${lock ? '' : `<span class="hint">換成：</span>${(pd.sug || []).map(sid => { const it = C9.itemOf(menu, sid); return it ? `<button class="mini" style="padding:3px 8px;font-size:12px" onclick="goPendFix(${i},${j},'${sid}')">${goEsc(it.name)} ${it.price}</button>` : '' }).join('')}<button class="mini" style="padding:3px 8px;font-size:12px" onclick="goPendDrop(${i},${j})">不要了</button>`}</div>`).join('')
    return `<tr style="${bad ? 'background:rgba(217,119,6,.12)' : ''}"><td style="padding:6px;border:1px solid var(--line);white-space:nowrap">${i + 1}</td>
      <td style="padding:6px;border:1px solid var(--line)"><input ${dis} value="${goEsc(r.name)}" placeholder="姓名" onchange="goRowSet(${i},'name',this.value)" style="width:92px;border:1px solid var(--line);border-radius:7px;padding:5px;background:var(--card);color:inherit;font-weight:800"><div class="hint" style="font-size:11px">${r.src === 'line' ? 'LINE' : '手打'}${r.done ? '・已點好' : ''}</div></td>
      <td style="padding:6px;border:1px solid var(--line);min-width:320px">${lines}${pend}${lock ? '' : `<select onchange="goLineAdd(${i},this.value);this.value=''" style="margin-top:4px;max-width:170px;border:1px solid var(--line);border-radius:7px;padding:4px;background:var(--card);color:inherit;font-size:12.5px"><option value="">＋ 加一道</option>${C9.flatItems(menu).filter(x => !x.soon && x.kind !== 'pizza').map(x => `<option value="${x.id}">${goEsc(x.name)} ${x.price}</option>`).join('')}</select>`}</td>
      <td style="padding:6px;border:1px solid var(--line);text-align:right">${p.main}</td><td style="padding:6px;border:1px solid var(--line);text-align:right">${p.set}</td><td style="padding:6px;border:1px solid var(--line);text-align:right">${p.diff}</td><td style="padding:6px;border:1px solid var(--line);text-align:right">${p.ala}</td>
      <td style="padding:6px;border:1px solid var(--line);text-align:right;font-weight:900;color:${bad ? '#d97706' : 'var(--red)'}">${bad ? (p.missing ? '已下架' : '待確認') : goN(p.total)}</td>
      <td style="padding:6px;border:1px solid var(--line)">${lock ? '' : `<button class="mini" style="padding:3px 7px;color:var(--red)" onclick="goRowDel(${i})">刪</button>`}</td></tr>`
  }).join('')
  const shared = (o.shared || []).map((s, j) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dashed var(--line)"><span>${goEsc(C9.labelOf(menu, { ...s, q: 1 }))} <span class="hint">${C9.pickPrice(menu, s, o.frozen).price}</span></span><span style="display:flex;gap:6px;align-items:center">${lock ? '' : `<button class="mini" style="padding:2px 8px" onclick="goSharedSet(${j},-1)">−</button>`}<b>${s.q}</b>${lock ? '' : `<button class="mini" style="padding:2px 8px" onclick="goSharedSet(${j},1)">＋</button>`}<b style="min-width:52px;text-align:right">${goN(C9.pickPrice(menu, s, o.frozen).price * s.q)}</b></span></div>`).join('')
  const acts = []
  if (me.canEdit) {
    if (['draft', 'sent'].includes(o.status) || !o.sentAt) acts.push(`<button class="mini" onclick="goSendLink('${o.id}')">傳連結給客人</button>`); else acts.push(`<button class="mini" onclick="goSendLink('${o.id}')">再傳一次連結</button>`)
    if (['submitted', 'draft', 'sent'].includes(o.status)) acts.push(`<button class="mini on" onclick="goStatus('priced')" ${t.pend || t.missing ? 'disabled title="還有待確認"' : ''}>核價完成</button>`)
    if (['priced', 'confirmed', 'submitted'].includes(o.status)) acts.push(`<button class="mini on" onclick="goStatus('locked')" ${t.pend || t.missing ? 'disabled title="還有待確認"' : ''}>鎖單（存價格快照）</button>`)
    if (['locked', 'done'].includes(o.status)) acts.push(`<button class="mini" onclick="goStatus('unlock')">解鎖</button>`)
    if (o.status === 'locked') acts.push(`<button class="mini" onclick="goStatus('done')">完成</button>`)
    if (o.status === 'void') acts.push(`<button class="mini" onclick="goStatus('reopen')">復原</button>`); else if (!['done'].includes(o.status)) acts.push(`<button class="mini" style="color:var(--red)" onclick="goStatus('void')">作廢</button>`)
    if (!['void'].includes(o.status)) acts.push(`<button class="mini on" onclick="goImg()" ${t.pend || t.missing ? 'disabled title="還有待確認"' : ''}>${o.imgs ? '重新產生計價圖' : '產生計價圖'}</button>`)
    if (o.imgs && o.imgs.p1) acts.push(`<button class="mini on" onclick="goSendImgs('${o.id}')">${o.imgSentAt ? '再傳一次圖給客人' : '傳圖給客人'}</button><a class="mini" href="${o.imgs.p1.url}" target="_blank" style="text-decoration:none">看圖 01</a><a class="mini" href="${o.imgs.p2.url}" target="_blank" style="text-decoration:none">看圖 02</a>`)
  }
  app.innerHTML = `<section>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><button class="mini" onclick="gorderLoad()">‹ 列表</button><h2 style="margin:0">${goEsc(o.company || o.custName || '團體訂餐')}</h2>${goPill(o.status)}<span style="flex:1"></span><span class="hint" style="font-size:12.5px">連結 <a href="${link}" target="_blank" style="color:var(--primary)">${link.replace('https://', '')}</a></span><button class="mini" onclick="navigator.clipboard&&navigator.clipboard.writeText('${link}').then(()=>goToast('已複製連結'),()=>goToast('複製失敗',true))">複製</button></div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px">${pipe}${o.imgs ? `<span class="hint" style="font-size:12px">計價圖 ${goEsc(String(o.imgs.at).slice(5, 16).replace('T', ' '))}${o.imgSentAt ? '・已傳客人 ' + goEsc(String(o.imgSentAt).slice(5, 16).replace('T', ' ')) : ''}${o.confirmedAt ? '・客人已確認 ' + goEsc(String(o.confirmedAt).slice(5, 16).replace('T', ' ')) : ''}</span>` : ''}</div>
    <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:12px;align-items:start" class="goGrid">
      <div style="display:grid;gap:12px;min-width:0">
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;font-size:13px">
            <label>客戶名稱${inp('company', o.company, 'width:100%')}</label><label>統編${inp('taxId', o.taxId, 'width:100%')}</label><label>聯絡人${inp('contact', o.contact, 'width:100%')}</label><label>電話${inp('phone', o.phone, 'width:100%')}</label>
            <label>取餐時間<input ${dis} type="datetime-local" value="${goEsc((o.when || '').replace(' ', 'T'))}" onchange="goHeadSet('when',this.value.replace('T',' '))" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit;font-size:14px"></label>
            <label>截單時間<input ${dis} type="datetime-local" value="${goEsc((o.deadline || '').replace(' ', 'T'))}" onchange="goHeadSet('deadline',this.value.replace('T',' '))" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit;font-size:14px"></label>
            <label>方式<select ${dis} onchange="goHeadSet('mode',this.value)" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit;font-size:14px">${['外帶自取', '外送', '內用'].map(m => `<option ${o.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
            <label>負責人${inp('assignee', o.assignee || '', 'width:100%')}</label>
          </div>
          <label style="display:block;margin-top:8px;font-size:13px">內部備註（客人看不到）<input ${dis} value="${goEsc(o.note || '')}" onchange="goHeadSet('note',this.value)" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit;font-size:14px"></label>
        </div>
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>每人一列</b><span class="hint">${(o.rows || []).length} 人（${t.nDone} 人按了點好）・套餐 ${t.sets} 組${t.pend ? `・<span style="color:#d97706;font-weight:800">${t.pend} 項待確認</span>` : ''}${t.missing ? `・<span style="color:#d97706;font-weight:800">${t.missing} 項已下架要換</span>` : ''}</span><span style="flex:1"></span>${lock ? '' : `<button class="mini" onclick="goParse()">貼文字自動拆列</button><button class="mini" onclick="goRowAdd()">＋ 加一人</button>`}</div>
          <div style="overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="text-align:left"><th style="padding:6px;border:1px solid var(--line)">#</th><th style="padding:6px;border:1px solid var(--line)">姓名</th><th style="padding:6px;border:1px solid var(--line)">餐點（一人可多道；套餐＝副餐＋飲品）</th><th style="padding:6px;border:1px solid var(--line);text-align:right">主餐</th><th style="padding:6px;border:1px solid var(--line);text-align:right">套餐</th><th style="padding:6px;border:1px solid var(--line);text-align:right">補差</th><th style="padding:6px;border:1px solid var(--line);text-align:right">單點</th><th style="padding:6px;border:1px solid var(--line);text-align:right">總額</th><th style="padding:6px;border:1px solid var(--line)"></th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="hint" style="padding:14px;text-align:center">還沒有人。客人會自己填；也可以按「貼文字自動拆列」把客人傳的整段貼進來。</td></tr>`}</tbody></table></div>
          <div class="hint" style="font-size:12px;margin-top:6px">每列＝主餐＋套餐 ${menu.setN}（含副餐折抵 ${menu.sideOff}、飲品折抵 ${menu.drinkOff}）＋補差＋單點。價格只從最新菜單來${o.frozen ? '（這張單已鎖，用的是鎖單當時的價）' : ''}。</div>
        </div>
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b>大家共用（披薩等，不分攤到人）</b><span style="flex:1"></span>${lock ? '' : `<select onchange="goSharedAdd(this.value);this.value=''" style="max-width:220px;border:1px solid var(--line);border-radius:7px;padding:5px;background:var(--card);color:inherit;font-size:13px"><option value="">＋ 加入共用</option>${C9.flatItems(menu).filter(x => !x.soon).map(x => `<option value="${x.id}">${goEsc(x.name)} ${x.price}</option>`).join('')}</select>`}</div>
          ${shared || '<div class="hint">沒有共用品項</div>'}
        </div>
      </div>
      <div style="display:grid;gap:12px;min-width:0">
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px;font-size:14px">
          <b>金額</b>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;margin-top:8px;align-items:center">
            <span class="hint">個人餐點</span><span style="text-align:right">${goN(t.people)}</span>
            <span class="hint">共用</span><span style="text-align:right">${goN(t.shared)}</span>
            <span class="hint">折扣</span><input ${dis} value="${goEsc(o.disc || '')}" placeholder="10% 或 300" onchange="goHeadSet('disc',this.value)" style="width:110px;justify-self:end;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--card);color:inherit;text-align:right">
            <span><b>全單總額</b></span><span style="text-align:right;font-size:22px;font-weight:900;color:var(--red)">${goN(t.total)}</span>
            <span class="hint">訂金</span><input ${dis} type="number" value="${o.dep || 0}" onchange="goHeadSet('dep',this.value)" style="width:110px;justify-self:end;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--card);color:inherit;text-align:right">
            <span class="hint">付款</span><select ${dis} onchange="goHeadSet('payStatus',this.value)" style="justify-self:end;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--card);color:inherit">${['未付', '已付訂金', '已付清'].map(x => `<option ${(o.pay || {}).status === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
            <span class="hint">方式</span><select ${dis} onchange="goHeadSet('payMethod',this.value)" style="justify-self:end;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--card);color:inherit">${['現場', '轉帳', '匯款'].map(x => `<option ${(o.pay || {}).method === x ? 'selected' : ''}>${x}</option>`).join('')}<option disabled>LINE Pay（第三批接）</option></select>
          </div>
        </div>
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px"><b>動作</b><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${acts.join('') || '<span class="hint">只能看</span>'}</div></div>
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px;font-size:13.5px"><b>搬運建議</b><div class="hint" style="margin-top:6px">餐點 ${cr.food} 份 → ${cr.bags} 袋・飲料／湯 ${cr.cups} 杯 → ${cr.cupBags} 提袋・披薩 ${cr.pz} 盒 → ${cr.stacks} 疊</div><div style="font-size:18px;font-weight:900;color:var(--red);margin-top:4px">建議 ${cr.people} 人來搬</div></div>
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px;font-size:12.5px"><b>紀錄</b><div style="margin-top:6px;display:grid;gap:3px;max-height:220px;overflow:auto">${(o.edits || []).map(e => `<div><span class="hint">${goEsc(String(e.t).slice(5, 16).replace('T', ' '))}</span> ${goEsc(e.by)}：${goEsc(e.what)}</div>`).join('') || '<span class="hint">—</span>'}</div></div>
      </div>
    </div>
    <style>@media(max-width:900px){.goGrid{grid-template-columns:1fr !important}}</style>
  </section>`
}
// ── 編輯（先改本地 → 重畫 → 0.7 秒後存）──
function goSaveSoon (patch) { clearTimeout(_goSaveT); _goCur._patch = { ...(_goCur._patch || {}), ...patch }; _goSaveT = setTimeout(goSave, 700) }
async function goSave () {
  if (!_goCur || !_goCur._patch) return
  const patch = _goCur._patch; _goCur._patch = null
  const d = await goPost({ op: 'save', id: _goCur.order.id, patch })
  if (!d || !d.ok) { goToast((d && d.error) || '存檔失敗', true); const d2 = await goGet('op=get&id=' + _goCur.order.id); if (d2 && d2.ok) { _goCur = d2; goRenderDetail() }; return }
  _goCur.order = d.order; goRenderDetail(); goToast('已存')
}
function goHeadSet (k, v) {
  const o = _goCur.order
  if (k === 'payStatus') { o.pay = { ...(o.pay || {}), status: v }; goSaveSoon({ pay: o.pay }); return }
  if (k === 'payMethod') { o.pay = { ...(o.pay || {}), method: v }; goSaveSoon({ pay: o.pay }); return }
  o[k] = v; goSaveSoon({ [k]: v }); if (k === 'disc' || k === 'dep') goRenderDetail()
}
function goRowsPatch () { goRenderDetail(); goSaveSoon({ rows: _goCur.order.rows, shared: _goCur.order.shared }) }
function goRowSet (i, k, v) { const r = _goCur.order.rows[i]; if (!r) return; if (k === 'name') r.name = v; goRowsPatch() }
function goLineSet (i, j, f, v) {
  const l = _goCur.order.rows[i].lines[j]; if (!l) return; const C9 = GC(), menu = _goCur.menu
  if (f === 'id') { if (!v) return goLineDel(i, j); l.id = v; if (!C9.canSet(C9.itemOf(menu, v))) { l.set = false; l.side = null; l.drink = null } }
  else if (f === 'q') l.q = Math.max(1, Number(v) || 1)
  else if (f === 'set') { l.set = !!v; if (!l.set) { l.side = null; l.drink = null } }
  else if (f === 'side') l.side = v ? { id: v, note: '' } : null
  else if (f === 'drink') l.drink = v ? { id: v, note: (l.drink || {}).note || '' } : null
  else if (f === 'dnote') { if (l.drink) l.drink.note = v }
  else if (f === 'note') l.note = v
  goRowsPatch()
}
function goLineAdd (i, id) { if (!id) return; _goCur.order.rows[i].lines.push({ id, q: 1, set: false, side: null, drink: null, note: '' }); goRowsPatch() }
function goLineDel (i, j) { _goCur.order.rows[i].lines.splice(j, 1); goRowsPatch() }
function goRowAdd () { _goCur.order.rows.push({ name: '', src: 'manual', lines: [], pend: [] }); goRowsPatch() }
function goRowDel (i) { _goCur.order.rows.splice(i, 1); goRowsPatch() }
function goPendFix (i, j, id) {
  const r = _goCur.order.rows[i], pd = r.pend.splice(j, 1)[0], it = GC().itemOf(_goCur.menu, id); if (!it) return
  r.lines.push({ id, q: pd.q || 1, set: false, side: null, drink: null, note: pd.note || '' })
  goRowsPatch()
}
function goPendDrop (i, j) { _goCur.order.rows[i].pend.splice(j, 1); goRowsPatch() }
function goSharedAdd (id) { if (!id) return; const s = _goCur.order.shared.find(x => x.id === id); if (s) s.q++; else _goCur.order.shared.push({ id, q: 1, note: '' }); goRowsPatch() }
function goSharedSet (j, d) { const s = _goCur.order.shared[j]; s.q += d; if (s.q <= 0) _goCur.order.shared.splice(j, 1); goRowsPatch() }
// ── 貼文字 AI 拆列（店家端） ──
function goParse () {
  goModal(`<h3 style="margin:0 0 8px">貼客人傳的訂餐文字</h3><div class="hint" style="margin-bottom:8px">一行一人（姓名：餐點）。對不到最新菜單的會標「待確認」給你點選換掉，不會硬湊。</div>
    <textarea id="goParseTa" rows="10" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--card);color:inherit;font-size:14px;font-family:inherit"></textarea>
    <label style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:13px"><input type="checkbox" id="goParseAppend"> 加在現有名單後面（不勾＝整張換掉）</label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="mini" onclick="goClose()">取消</button><button class="mini on" id="goParseBtn" onclick="goParseGo()">AI 拆成每人一列</button></div>`)
}
async function goParseGo () {
  const ta = document.getElementById('goParseTa'), btn = document.getElementById('goParseBtn'); if (!ta || !ta.value.trim()) return goToast('先貼文字', true)
  btn.disabled = true; btn.textContent = 'AI 讀取中…'
  const d = await goPost({ op: 'parse', text: ta.value })
  if (!d || !d.ok) { btn.disabled = false; btn.textContent = 'AI 拆成每人一列'; return goToast((d && d.error) || 'AI 讀不出來', true) }
  const append = document.getElementById('goParseAppend').checked
  const o = _goCur.order
  o.rows = append ? [...o.rows, ...d.rows] : d.rows
  for (const s of d.shared) { const ex = o.shared.find(x => x.id === s.id); if (ex && append) ex.q += s.q; else if (!ex) o.shared.push(s) }
  goClose(); goRowsPatch(); goToast(`拆出 ${d.rows.length} 人${d.shared.length ? '＋共用 ' + d.shared.length + ' 項' : ''}`)
}
// ── 狀態／發連結 ──
async function goStatus (st) {
  if (st === 'void' && !(await goConfirm('確定作廢這張單？客人連結會打不開。'))) return
  const d = await goPost({ op: 'status', id: _goCur.order.id, status: st })
  if (!d || !d.ok) return goToast((d && d.error) || '失敗', true)
  _goCur.order = d.order; goRenderDetail(); goToast(GC().STATUS_LABEL[d.order.status] || '已更新')
}
function goConfirm (msg) { return new Promise(res => { goModal(`<div style="font-size:15px;margin-bottom:12px">${goEsc(msg)}</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" id="goNo">取消</button><button class="mini on" id="goYes">確定</button></div>`, 380); document.getElementById('goNo').onclick = () => { goClose(); res(false) }; document.getElementById('goYes').onclick = () => { goClose(); res(true) } }) }
async function goSendLink (id) {
  const d = await goPost({ op: 'sendlink', id })
  if (!d || !d.ok) return goToast((d && d.error) || '傳送失敗', true)
  goToast('連結已傳給客人（' + (d.mode === 'reply' ? '免費回覆' : '推播') + '）')
  if (_goCur && _goCur.order.id === id) { _goCur.order = d.order; goRenderDetail() }
  return d
}
// ── 從收件匣建單（p24 表頭「點餐單」）──
async function goFromInbox () {
  const cv = (typeof _ibConv !== 'undefined' && _ibConv) || ((typeof _ibD !== 'undefined' && _ibD && _ibD.convs) || []).find(x => x.id === (typeof _ibCur !== 'undefined' ? _ibCur : null))
  if (!cv) return goToast('先打開一個客人對話', true)
  const d = await goGet('op=list'); if (!d || !d.ok) return goToast((d && d.error) || '讀不到團體訂餐', true)
  _goD = d
  const mine = (d.list || []).filter(x => x.convId === cv.id && x.status !== 'void')
  const tmr = new Date(Date.now() + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10) + 'T12:00'
  const name = cv.alias || cv.name || '客人'
  goModal(`<h3 style="margin:0 0 6px">建立點餐單｜${goEsc(name)}</h3><div class="hint" style="margin-bottom:10px">建好會綁在這個客人身上。連結傳給他，他轉到群組，每個人點開自己點（像 UberEats）；截單時間前都能改。</div>
    ${mine.length ? `<div style="margin-bottom:10px;font-size:13.5px"><b>這個客人已有：</b>${mine.map(x => `<div style="display:flex;gap:8px;align-items:center;padding:4px 0"><span>${goEsc(x.company || name)}・${goEsc(x.when || '待定')}</span>${goPill(x.status)}<span style="flex:1"></span><button class="mini" onclick="goClose();gorderLoad('${x.id}')">打開</button>${['draft', 'sent'].includes(x.status) ? `<button class="mini" onclick="goSendLink('${x.id}')">傳連結</button>` : ''}</div>`).join('')}</div><hr style="border:0;border-top:1px solid var(--line);margin:8px 0">` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
      <label>客戶名稱<input id="goC_company" value="${goEsc(name)}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit"></label>
      <label>統編<input id="goC_tax" inputmode="numeric" placeholder="8 碼（選填）" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit"></label>
      <label>取餐時間<input id="goC_when" type="datetime-local" value="${tmr}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit"></label>
      <label>截單時間<input id="goC_deadline" type="datetime-local" value="${tmr.slice(0, 10) + 'T10:00'}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit"></label>
      <label>方式<select id="goC_mode" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit"><option>外帶自取</option><option>外送</option><option>內用</option></select></label>
      <label>聯絡人<input id="goC_contact" value="${goEsc(cv.name || '')}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit"></label>
      <label>電話<input id="goC_phone" placeholder="選填" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit"></label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="goClose()">取消</button><button class="mini" id="goC_btn1" onclick="goCreateGo(false)">只建單</button><button class="mini on" id="goC_btn2" onclick="goCreateGo(true)">建單並傳連結給客人</button></div>`)
  window._goInboxConv = cv
}
async function goCreateGo (send) {
  const cv = window._goInboxConv; if (!cv) return
  const g = id => (document.getElementById(id) || {}).value || ''
  const b1 = document.getElementById('goC_btn1'), b2 = document.getElementById('goC_btn2'); if (b1) b1.disabled = true; if (b2) { b2.disabled = true; b2.textContent = '建立中…' }
  const d = await goPost({ op: 'create', acct: cv.acct, convId: cv.id, uid: cv.uid || '', custName: cv.alias || cv.name || '', company: g('goC_company'), taxId: g('goC_tax'), when: g('goC_when').replace('T', ' '), mode: g('goC_mode'), deadline: g('goC_deadline').replace('T', ' '), contact: g('goC_contact'), phone: g('goC_phone') })
  if (!d || !d.ok) { if (b1) b1.disabled = false; if (b2) { b2.disabled = false; b2.textContent = '建單並傳連結給客人' }; return goToast((d && d.error) || '建單失敗', true) }
  let sent = null
  if (send) sent = await goSendLink(d.id)
  goModal(`<h3 style="margin:0 0 8px">點餐單建好了</h3><div style="font-size:14px;line-height:1.7">客人連結：<a href="${d.link}" target="_blank" style="color:var(--primary);word-break:break-all">${d.link}</a><br>${sent && sent.ok ? '<b style="color:#16a34a">已傳給客人</b>' : send ? '<b style="color:#d97706">連結沒傳出去，可以到單子裡再按「傳連結給客人」</b>' : '還沒傳給客人'}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="navigator.clipboard&&navigator.clipboard.writeText('${d.link}').then(()=>goToast('已複製'))">複製連結</button>${sent && sent.ok ? '' : `<button class="mini" onclick="goSendLink('${d.id}').then(r=>{if(r&&r.ok)goClose()})">傳連結給客人</button>`}<button class="mini on" onclick="goClose();gorderLoad('${d.id}')">打開這張單</button></div>`, 480)
}
// ── 設定 ──
function goCfg () {
  const c = _goD.cfg
  goModal(`<h3 style="margin:0 0 8px">團體訂餐設定</h3>
    <b style="font-size:13.5px">搬運估算</b>
    <div style="display:grid;grid-template-columns:1fr 80px;gap:6px;align-items:center;font-size:13px;margin:6px 0 12px">
      <span>一袋裝幾份餐（主餐／副餐各算 1 份）</span><input id="goCf_bag" type="number" value="${c.carry.bag}" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;text-align:center">
      <span>一提袋裝幾杯飲料／湯</span><input id="goCf_cup" type="number" value="${c.carry.cup}" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;text-align:center">
      <span>披薩一疊最多幾盒</span><input id="goCf_pz" type="number" value="${c.carry.pz}" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;text-align:center">
      <span>一個人最多拿幾件</span><input id="goCf_hand" type="number" value="${c.carry.hand}" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;text-align:center">
    </div>
    <b style="font-size:13.5px">客人送出／確認要通知誰</b><div class="hint" style="font-size:12px">姓名用逗號分開；空白＝這張單負責人＋收件匣有權限的人＋審核人</div>
    <input id="goCf_people" value="${goEsc((c.notify.people || []).join('、'))}" placeholder="例：姚沛旭、張良瑋" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);color:inherit;margin:4px 0 12px">
    <b style="font-size:13.5px">連結到期（天）</b><input id="goCf_exp" type="number" value="${c.expireDays}" style="width:80px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;text-align:center;margin:4px 0 12px;display:block">
    <b style="font-size:13.5px">發連結的訊息範本</b><div class="hint" style="font-size:12px">可用 {company} {link} {when} {mode}</div>
    <textarea id="goCf_tpl" rows="4" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--card);color:inherit;font-family:inherit;font-size:13.5px;margin-top:4px">${goEsc(c.linkTpl || '')}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="goClose()">取消</button><button class="mini on" onclick="goCfgSave()">儲存</button></div>`)
}
async function goCfgSave () {
  const g = id => (document.getElementById(id) || {}).value || ''
  const cfg = { carry: { bag: +g('goCf_bag') || 6, cup: +g('goCf_cup') || 6, pz: +g('goCf_pz') || 2, hand: +g('goCf_hand') || 3 }, notify: { people: g('goCf_people').split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean) }, expireDays: +g('goCf_exp') || 14, linkTpl: g('goCf_tpl') }
  const d = await goPost({ op: 'cfg', cfg }); if (!d || !d.ok) return goToast((d && d.error) || '存不了', true)
  _goD.cfg = d.cfg; goClose(); goToast('設定已存')
}

// ── 第二批：兩張計價圖（html-to-image 出 PNG，版型照 10/12 張良給的樣：米底紅表頭）──
const GO_SHEET_CSS = 'font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;color:#2b1d18;background:#f6efe4;width:1180px;padding:30px 28px;box-sizing:border-box'
function goSheetBase (title, o, inner, foot) {
  const m = o
  return `<div style="${GO_SHEET_CSS}"><div style="color:#ce1611;font-weight:900;font-size:15px;letter-spacing:.04em">GROUN:D ／ ${goEsc(m.company || m.custName || '')}</div><div style="font-size:28px;font-weight:900;margin:4px 0 2px">${title}</div><div style="font-size:14px;color:#6b5b53;margin-bottom:12px">取餐 ${goEsc(m.when || '待定')}（${goEsc(m.mode || '')}）｜統編 ${goEsc(m.taxId || '—')}｜聯絡 ${goEsc(m.contact || '')}｜${m.frozen ? '鎖單價格（' + goEsc(String((m.priceAt || {}).at || '').slice(0, 10)) + '）' : '依最新菜單計價'}</div>${inner}<div style="margin-top:12px;font-size:13.5px;color:#4a3b33;line-height:1.7">${foot}</div></div>`
}
const goTh = (cols) => `<thead><tr>${cols.map(c => `<th style="background:#ce1611;color:#fff;padding:8px 9px;font-size:13.5px;border:1px solid #ce1611;text-align:center">${c}</th>`).join('')}</tr></thead>`
const goTd = (v, extra) => `<td style="padding:7px 9px;border:1px solid #d8c9b6;font-size:13.5px;vertical-align:top;${extra || ''}">${v}</td>`
const goMoney = (v) => goTd(`<b style="color:#ce1611">${goN(v)}</b>`, 'text-align:right;white-space:nowrap')
function goSheet1Html (o, menu) {
  const C9 = GC(), t = C9.totals(menu, o)
  let sm = 0, ss = 0, sd = 0, sa = 0
  const rows = (o.rows || []).map((r, i) => { const p = C9.priceRow(menu, r, o.frozen); sm += p.main; ss += p.set; sd += p.diff; sa += p.ala
    const lines = (r.lines || []).map(l => { const it = C9.itemOf(menu, l.id) || { name: '（已下架）' }; return `<div>${goEsc(it.name)}${l.note ? '・' + goEsc(l.note) : ''}${(l.q || 1) > 1 ? ' ×' + l.q : ''}${l.set ? `<div style="font-size:12px;color:#6b5b53">套餐：${l.side ? goEsc(C9.labelOf(menu, l.side)) : '—'}＋${l.drink ? goEsc(C9.labelOf(menu, l.drink)) : '—'}</div>` : ''}</div>` }).join('')
    return `<tr style="background:${i % 2 ? '#f5ede2' : '#fff'}">${goTd(`${String(i + 1).padStart(2, '0')}<br><b>${goEsc(r.name || '')}</b>`, 'white-space:nowrap')}${goTd(lines || '—')}${goTd(goN(p.main), 'text-align:right')}${goTd(goN(p.set), 'text-align:right')}${goTd(goN(p.diff), 'text-align:right')}${goTd(goN(p.ala), 'text-align:right')}${goMoney(p.total)}</tr>` }).join('')
  const sharedTxt = (o.shared || []).map(s => `${goEsc(C9.labelOf(menu, { ...s, q: 1 }))} ${C9.pickPrice(menu, s, o.frozen).price}${s.q > 1 ? '×' + s.q : ''}`).join('＋') || '無'
  const inner = `<table style="border-collapse:collapse;width:100%;background:#fff">${goTh(['姓名', '餐點（套餐＝副餐＋飲品）', '主餐價', '套餐價', '補差價', '單點價', '總金額'])}<tbody>${rows}</tbody><tfoot><tr style="background:#f0e4d4;font-weight:800">${goTd('合計 ' + (o.rows || []).length + ' 人')}${goTd(t.sets + ' 組套餐')}${goTd(goN(sm), 'text-align:right')}${goTd(goN(ss), 'text-align:right')}${goTd(goN(sd), 'text-align:right')}${goTd(goN(sa), 'text-align:right')}${goMoney(t.people)}</tr></tfoot></table>`
  const foot = `每列＝主餐價＋套餐價（+${menu.setN}，含副餐折抵 ${menu.sideOff}、飲品折抵 ${menu.drinkOff}）＋補差價（副餐／飲品超過折抵的差額）＋單點價。<br>共用品項｜${sharedTxt}＝${goN(t.shared)}${t.disc ? '｜折扣 −' + goN(t.disc) : ''}${o.dep ? '｜已付訂金 ' + goN(o.dep) + '，尾款 ' + goN(t.total - o.dep) : ''}<div style="font-size:24px;color:#ce1611;font-weight:900;margin-top:6px">${(o.rows || []).length} 人餐點 ${goN(t.people)} ＋ 共用 ${goN(t.shared)}${t.disc ? ' − 折扣 ' + goN(t.disc) : ''} ＝ 全單 ${goN(t.total)} 元</div>`
  return goSheetBase('01 個人明細與計價表', o, inner, foot)
}
function goSheet2Html (o, menu, cfg) {
  const C9 = GC(), t = C9.totals(menu, o), agg = {}
  const add = (pk, who, tag, mult) => { const it = C9.itemOf(menu, pk.id); if (!it) return; const q = (Number(pk.q) || 1) * (mult || 1); const k = it.id + '|' + (pk.note || ''); (agg[k] = agg[k] || { it, note: pk.note || '', q: 0, who: [] }); agg[k].q += q; agg[k].who.push(who + (tag ? '（' + tag + '）' : '') + (q > 1 ? '×' + q : '')) }
  ;(o.rows || []).forEach((r, i) => { const w = String(i + 1).padStart(2, '0') + ' ' + (r.name || ''); for (const l of (r.lines || [])) { add(l, w, l.set ? '套餐' : '單點'); if (l.set) { if (l.side) add({ ...l.side, q: 1 }, w, '套餐副餐', l.q || 1); if (l.drink) add({ ...l.drink, q: 1 }, w, '套餐飲品', l.q || 1) } } })
  ;(o.shared || []).forEach(s => add(s, '共用'))
  let html = '', orig = 0
  for (const s of menu.sections) { const list = Object.values(agg).filter(a => a.it.sec === s.key); if (!list.length) continue; const n = list.reduce((x, a) => x + a.q, 0)
    html += `<tr><td colspan="5" style="padding:7px 9px;border:1px solid #d8c9b6;background:#e9dccb;font-weight:900">${goEsc(s.name)}｜${n} 份</td></tr>` + list.map(a => { const price = C9.pickPrice(menu, { id: a.it.id }, o.frozen).price; const sub = price * a.q; orig += sub; return `<tr style="background:#fff">${goTd(goEsc(a.it.name) + (a.note ? '・' + goEsc(a.note) : ''))}${goTd(a.q, 'text-align:right')}${goTd(price, 'text-align:right')}${goMoney(sub)}${goTd(a.who.map(goEsc).join('／'), 'font-size:12px')}</tr>` }).join('') }
  const cr = C9.carry(menu, o, cfg && cfg.carry)
  const check = orig + t.sets * (menu.setN - menu.sideOff - menu.drinkOff) - t.disc
  const inner = `<table style="border-collapse:collapse;width:100%">${goTh(['餐點品項', '數量', '單價', '原價小計', '誰點的／套餐或單點'])}<tbody>${html}</tbody></table>`
  const foot = `總額核對：原價 ${goN(orig)} ＋ ${t.sets} 組套餐 × ${menu.setN} − ${t.sets} 組副餐折抵 ${menu.sideOff} − ${t.sets} 組飲品折抵 ${menu.drinkOff}${t.disc ? ' − 折扣 ' + goN(t.disc) : ''} ＝ <b style="color:#ce1611">${goN(check)}</b>（計價表全單 ${goN(t.total)}${check === t.total ? '，一致 ✓' : '，不一致 ✗ 請檢查套餐副餐飲品有沒有漏選'}）<div style="margin-top:10px;border:2px solid #ce1611;border-radius:10px;padding:10px 12px;background:#fff">搬運建議：餐點 ${cr.food} 份裝 ${cr.bags} 袋（每袋 ${cr.cf.bag} 份）、飲料／湯 ${cr.cups} 杯裝 ${cr.cupBags} 提袋（每袋 ${cr.cf.cup} 杯）、披薩 ${cr.pz} 盒分 ${cr.stacks} 疊（每疊 ${cr.cf.pz} 盒），共 ${cr.units} 件，一人拿 ${cr.cf.hand} 件 → <b style="color:#ce1611;font-size:18px">建議 ${cr.people} 人來搬</b></div>`
  return goSheetBase('02 餐點類別・品項整合表', o, inner, foot)
}
async function goImg () {
  if (typeof htmlToImage === 'undefined') return goToast('出圖元件還沒載入，重新整理再試', true)
  const { order: o, menu, cfg } = _goCur
  goToast('出圖中…')
  const wrap = document.createElement('div'); wrap.id = 'goImgWrap'; wrap.style.cssText = 'position:fixed;left:-20000px;top:0;z-index:-1'
  wrap.innerHTML = `<div id="goSheet1">${goSheet1Html(o, menu)}</div><div id="goSheet2">${goSheet2Html(o, menu, cfg)}</div>`
  document.body.appendChild(wrap)
  try {
    const opt = { pixelRatio: 2, backgroundColor: '#f6efe4', cacheBust: true }
    const p1 = await htmlToImage.toPng(document.getElementById('goSheet1').firstElementChild, opt)
    const p2 = await htmlToImage.toPng(document.getElementById('goSheet2').firstElementChild, opt)
    wrap.remove()
    const d = await goPost({ op: 'imgsave', id: o.id, p1, p2 })
    if (!d || !d.ok) return goToast((d && d.error) || '存圖失敗', true)
    _goCur.order = d.order; goRenderDetail(); goToast('兩張計價圖已產生，可按「傳圖給客人」')
  } catch (e) { wrap.remove(); goToast('出圖失敗：' + String(e && e.message || e).slice(0, 60), true) }
}
async function goSendImgs (id) {
  const d = await goPost({ op: 'sendimgs', id })
  if (!d || !d.ok) return goToast((d && d.error) || '傳送失敗', true)
  _goCur.order = d.order; goRenderDetail(); goToast('兩張圖已傳給客人（' + (d.mode === 'reply' ? '免費回覆' : '推播') + '），等客人按確認')
}
