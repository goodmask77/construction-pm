// ⚠️ 這是 /prep 主程式的第 8/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：異常通知+菜單+今日事項+分頁自訂+icon
// ── ⚠️ 異常通知（張良 2026-10-03：AB=阿桑系統 boss-api 自動同步先上；之後 GD ERP 叫貨收貨流程也同步進這頁）──
async function incLoad(){
  curStore = 'inc'; setTabs('inc')
  if (window._incD) incRender(); else app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?absinc=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (!d || !d.ok) { if (!window._incD) app.innerHTML = '<div class="err">讀不到資料</div>'; return }
  window._incD = d
  if (curStore === 'inc') incRender()
}
function incRender(){
  const d = window._incD; if (!d || curStore !== 'inc') return
  document.getElementById('upd').textContent = '異常通知'
  // v4.43.6 轉義（阿桑 2026-10-04 提醒「我這邊被塞亂碼你那邊也會收到」）：外來文字一律 esc 再進 HTML——
  // 入庫端 boss-sync sanRow 已消毒一層，這裡是雙保險（客人亂碼/HTML 只會變純文字）
  const esc9 = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const fdt = s => esc9(String(s||'').slice(0,16).replace('T',' '))
  const urgB = u => u ? `<span style="background:${/高|急/.test(u)?'var(--red)':'var(--soft)'};color:${/高|急/.test(u)?'#fff':'var(--muted)'};border-radius:5px;padding:0 6px;font-size:11px;font-weight:800">${esc9(u)}</span>` : ''
  let h = `<section><h2>⚠️ 異常通知 <span class="hint">A Beach＝阿桑系統自動同步（唯讀）・GROUN:D ERP 叫貨收貨之後接入同一頁</span></h2>`
  const card = (x, open) => `<div style="background:var(--card);border:1.5px solid ${open?'var(--red)':'var(--line)'};border-radius:12px;padding:9px 12px;margin-bottom:8px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:3px">
        <span style="background:var(--soft);border-radius:5px;padding:0 6px;font-size:11px;font-weight:800">🅰 A Beach</span>
        <b style="font-size:14px">${esc9(x.cat) || '異常'}</b>${urgB(x.urgency)}
        <span style="background:${open?'#3A2A1A':'var(--soft)'};color:${open?'#F0B060':'var(--muted)'};border-radius:5px;padding:0 6px;font-size:11px;font-weight:800">${esc9(x.status)}${x.stage?'・'+esc9(x.stage):''}</span>
        <span class="hint" style="margin-left:auto;font-size:11px">${fdt(x.created)}</span>
      </div>
      ${x.detail?`<div style="font-size:13.5px;white-space:pre-wrap;margin:2px 0">${esc9(String(x.detail).slice(0,300))}</div>`:''}
      <div class="hint" style="font-size:11.5px">${[x.station&&('站別:'+esc9(x.station)), x.target&&('對象:'+esc9(x.target)), x.by&&('回報:'+esc9(x.by)+(x.dept?'('+esc9(x.dept)+')':'')), x.assignee&&('負責:'+esc9(x.assignee)), x.resolvedAt&&('結案:'+fdt(x.resolvedAt)+(x.resolveType?'・'+esc9(x.resolveType):''))].filter(Boolean).join('｜')}</div>
    </div>`
  h += `<div style="font-weight:900;margin:8px 0 6px;font-size:15px;color:var(--red)">未結案（${(d.open||[]).length}）</div>`
  h += (d.open||[]).map(x=>card(x,1)).join('') || '<div class="mut">目前沒有未結案的異常 🎉</div>'
  h += `<div style="font-weight:900;margin:14px 0 6px;font-size:15px">已結案（近三個月 ${(d.done||[]).length} 筆，列最近 30）</div>`
  h += (d.done||[]).slice(0,30).map(x=>card(x,0)).join('') || '<div class="mut">沒有紀錄</div>'
  h += `</section>`
  app.innerHTML = h
}
async function fbLoad(date){
  curStore = 'fb'; setTabs('fb')
  fbDate = (typeof date === 'string' && date) || fbDate || todayTpe()
  if (!window._fbD || window._fbD.date !== fbDate) { const c = tcGet('fb_'+fbDate); if (c) window._fbD = c }
  if (window._fbD && window._fbD.date === fbDate) { document.getElementById('upd').textContent = '每日回饋・' + fbDate; fbRender() } else app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?fb=' + encodeURIComponent(K) + '&date=' + fbDate + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (!d || !d.ok) { if (!window._fbD) app.innerHTML = '<div class="err">讀不到資料</div>'; return }
  window._fbD = d; tcSet('fb_'+fbDate, d)
  document.getElementById('upd').textContent = '每日回饋・' + d.date
  if (curStore === 'fb') fbRender()
}
// v4.53.0 每日回饋改指派制（張良 2026-10-06）：①換你回饋(系統指派,對方匿名) ②我收到的回饋(匿名) ③每日回饋紀錄(問題回報) ④管理者後台彙總(看得到是誰)
const fbE = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
function fbDimsFor(station){
  const d = window._fbD, m = (d.dims&&d.dims.map)||{}, def = (d.dims&&d.dims.def)||[]
  return (station && m[station] && m[station].length) ? m[station] : def
}
function fbDimsHtml(nm, station, mine){
  const dims = fbDimsFor(station), cur = (mine&&mine.dims)||{}
  return dims.map((asp,i)=>{
    const v = cur[asp]||0
    return `<div style="margin-top:6px"><div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:13px;font-weight:700;flex:0 0 80px">${fbE(asp)}</span>
      <input type="range" min="1" max="5" step="1" value="${v||3}" data-asp="${fbE(asp)}" ${v?'data-touched="1"':''} style="flex:1;accent-color:#E8B931" oninput="fbDimSlide('${nm}',${i})">
      <span id="fbsv_${nm}_${i}" style="width:66px;text-align:right;color:#E8B931;font-size:14px;flex:0 0 auto">${v?'★'.repeat(v)+'☆'.repeat(5-v):'<span class="mut" style="font-size:12px">未評</span>'}</span></div></div>`
  }).join('') || '<div class="hint" style="margin-top:4px">這個站還沒設面向——寫一句話回饋就好（管理者可按「面向設定」加）</div>'
}
function fbAssignCard(a, done){
  const d = window._fbD, nm = a.reviewee
  const mine = (d.fbs||[]).find(x=>x.target===nm && x.by===(d.me&&d.me.name))
  const stations = d.stations || []
  const curSt = (mine&&mine.station) || a.station || (stations[0]||'')
  const tag = a.type==='assigned' ? ` <span style="font-size:12px;background:var(--primary);color:#fff;border-radius:6px;padding:1px 7px">指定</span>` : ''
  let h = `<div style="background:var(--soft);border:1px solid ${done?'var(--green)':'var(--line)'};border-radius:11px;padding:10px 12px;margin-top:8px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:15px">${fbE(nm)}</b>${tag} ${done?'<span style="font-size:13px;color:var(--green);font-weight:800">✓ 已回饋</span>':''}</div>`
  if (a.aspect) h += `<div class="hint" style="margin-top:3px">請針對：${fbE(a.aspect)}</div>`
  if (stations.length) h += `<div style="display:flex;align-items:center;gap:7px;margin:7px 0 2px"><span style="font-size:13px;font-weight:700">站別</span>
    <select id="fbst_${nm}" onchange="fbStPick('${nm}')" style="border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:14px">${stations.map(s=>`<option ${s===curSt?'selected':''}>${fbE(s)}</option>`).join('')}</select></div>`
  h += `<div id="fbdims_${nm}">${fbDimsHtml(nm, curSt, mine)}</div>
    <div style="display:flex;gap:6px;margin-top:7px"><input id="fbtx_${nm}" placeholder="一句話回饋（可空）" value="${mine&&mine.text?fbE(mine.text):''}" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:14px">
    <button class="mini on" style="padding:7px 14px" onclick="fbSubmit('${nm}')">${mine?'更新':'送出'}</button></div></div>`
  return h
}
function fbRecvLine(x){
  const dims = x.dims||{}
  const dimTxt = Object.keys(dims).map(k=>`${fbE(k)} ${'★'.repeat(dims[k])}`).join('　')
  return `<div style="background:var(--soft);border-radius:8px;padding:6px 9px;margin-top:5px;font-size:14px">
    <span class="hint">匿名${x.station?'・'+fbE(x.station):''}</span> ${x.stars?'<span style="color:#E8B931">'+'★'.repeat(x.stars)+'</span>':''}
    ${dimTxt?`<div style="font-size:13px;color:var(--muted);margin-top:2px">${dimTxt}</div>`:''}
    ${x.text?`<div style="white-space:pre-wrap;margin-top:2px">${fbE(x.text)}</div>`:''}</div>`
}
function fbAdminHtml(d){
  const asg = d.assignDay||[], fbs = d.fbs||[]
  const doneKey = new Set(fbs.map(x=>x.by+'→'+x.target))
  const peers = asg.filter(a=>a.type==='peer'), assigned = asg.filter(a=>a.type==='assigned')
  const total = asg.length, done = asg.filter(a=>doneKey.has(a.reviewer+'→'+a.reviewee)).length
  const row = a=>{ const ok = doneKey.has(a.reviewer+'→'+a.reviewee)
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--line);font-size:13.5px">
      <span style="flex:0 0 auto;color:${ok?'var(--green)':'var(--red)'};font-weight:800">${ok?'✓':'○'}</span>
      <span>${fbE(a.reviewer)} → <b>${fbE(a.reviewee)}</b></span>
      ${a.type==='assigned'?`<span style="font-size:12px;background:var(--primary);color:#fff;border-radius:6px;padding:0 6px">指定${a.by?'·'+fbE(a.by):''}</span>`:''}
      ${a.aspect?`<span class="hint">${fbE(a.aspect)}</span>`:''}
      ${a.type==='assigned'?`<button class="mini" style="margin-left:auto;color:var(--red);padding:1px 7px" onclick="fbAssignDel('${a.id}')">刪</button>`:''}</div>` }
  return `<div style="background:var(--card);border:1.5px dashed var(--primary);border-radius:12px;padding:11px 13px;margin-top:4px">
    <div><b>🛠 後台彙總</b> <span class="hint">只有你和站長看得到是誰（完成 ${done}/${total}）</span></div>
    ${total?`<div style="margin-top:6px">${[...assigned,...peers].map(row).join('')}</div>`:'<div class="mut" style="margin-top:6px">今天還沒有任何指派</div>'}</div>`
}
function fbRender(){
  const d = window._fbD; if (!d || curStore !== 'fb') return
  const meN = d.me ? d.me.name : null
  const isAdmin = !!d.isAdmin
  const wd = ['日','一','二','三','四','五','六'][new Date(d.date).getDay()]
  const isToday = d.date === (d.today || todayTpe())
  let h = `<section><h2>每日回饋 <span class="hint">${meN?'對一起上班的夥伴做回饋（系統指派、對方看不到是你）':'看得到；要回饋先綁定——'+BIND_HINT}</span></h2>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <button class="mini" onclick="fbNav(-1)">‹</button><b style="font-size:15px">${d.date.slice(5)}（${wd}）${isToday?'・今天':''}</b><button class="mini" onclick="fbNav(1)">›</button>
      ${isAdmin?`<span style="margin-left:auto;display:flex;gap:6px"><button class="mini" onclick="fbDimsEdit()">面向設定</button><button class="mini on" onclick="fbAssignNew()">＋ 指定回饋</button></span>`:''}
    </div>`
  // ① 換你回饋（系統指派）
  if (meN){
    const mine = d.myAssign || []
    const doneSet = new Set((d.fbs||[]).filter(x=>x.by===meN).map(x=>x.target))
    h += `<div style="background:var(--card);border:1.5px solid var(--primary);border-radius:12px;padding:11px 13px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>📋 換你回饋</b><span class="hint">系統指派你回饋這些夥伴（對方看不到是你）</span></div>
      ${mine.length?mine.map(a=>fbAssignCard(a, doneSet.has(a.reviewee))).join(''):`<div class="mut" style="font-size:14px;margin-top:6px">${isToday?'今天還沒配到對象——有人打卡後就會指派給你':'這天沒有指派給你的回饋'}</div>`}</div>`
  }
  // ② 我收到的回饋（匿名）
  if (meN){
    const got = (d.fbs||[]).filter(x=>x.target===meN)
    if (got.length){
      const sc = got.filter(x=>x.stars)
      const avg = sc.length ? Math.round(sc.reduce((s,x)=>s+x.stars,0)/sc.length*10)/10 : null
      h += `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:12px">
        <div><b>🎯 我收到的回饋</b> ${avg?`<span class="avg">⭐${avg}</span>`:''} <span class="hint">${got.length}則・匿名</span></div>
        ${got.map(fbRecvLine).join('')}</div>`
    }
  }
  // ③ 每日回饋紀錄（問題回報，維持原樣）
  const jn = d.jn || []
  const jnBy = [...new Set(jn.map(x=>x.by))]
  const undone = (d.workers||[]).filter(n=>!jnBy.includes(n))
  h += `<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>📝 每日回饋紀錄</b><span class="hint">每人每天把發現的問題交上來（可多則）</span>
    ${meN?`<button class="mini on" style="margin-left:auto;padding:8px 16px" onclick="fbjNew()">＋ 我要回饋</button>`:''}</div>
    ${(d.workers||[]).length?`<div class="hint" style="margin-top:4px">今日已交：${jnBy.length?jnBy.map(n=>`<b style="color:var(--green)">${fbE(n)}</b>`).join('、'):'—'}${undone.length?`｜未交：<span style="color:var(--red);font-weight:700">${undone.map(fbE).join('、')}</span>`:''}</div>`:''}
    ${jn.length?jn.map(x=>`<div style="background:var(--soft);border-radius:9px;padding:7px 10px;margin-top:6px;font-size:14px">
      <b>${fbE(x.by)}</b>${x.st?` <span style="font-size:13px;border:1px solid var(--line);border-radius:7px;padding:1px 7px">${fbE(x.st)}</span>`:''} <span class="hint">${fbE(x.ts||'')}</span>
      ${x.text?`<div style="white-space:pre-wrap;margin-top:2px">${fbE(x.text)}</div>`:''}
      ${(x.media||[]).length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">${x.media.map(m=>/\.(mp4|mov|webm|m4v)(\?|$)/i.test(m)?`<a href="${m}" target="_blank" style="font-size:13px;border:1px solid var(--line);border-radius:8px;padding:4px 9px">🎬 影片</a>`:`<img src="${m}" style="width:58px;height:58px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer" onclick="imgView('${m}')">`).join('')}</div>`:''}
      ${meN&&(x.by===meN)?`<div style="margin-top:4px"><button class="mini" style="color:var(--red);padding:2px 8px" onclick="if(confirm('刪除這則回饋？'))fbjDel('${x.id}')">🗑</button></div>`:''}
    </div>`).join(''):`<div class="mut" style="font-size:14px;margin-top:6px">這天還沒有人交回饋</div>`}
  </div>`
  // ④ 管理者後台彙總
  if (isAdmin) h += fbAdminHtml(d)
  h += `</section>`
  app.innerHTML = h
}
function fbDimSlide(nm,i){
  const box = document.getElementById('fbdims_'+nm); if(!box) return
  const sl = box.querySelectorAll('input[type=range]')[i]; if(!sl) return
  sl.dataset.touched = '1'; const v = +sl.value
  const sp = document.getElementById('fbsv_'+nm+'_'+i); if(sp) sp.textContent = '★'.repeat(v)+'☆'.repeat(5-v)
}
function fbStPick(nm){
  const sel = document.getElementById('fbst_'+nm); if(!sel) return
  const mine = ((window._fbD.fbs||[]).find(x=>x.target===nm && x.by===(window._fbD.me&&window._fbD.me.name)))||null
  const box = document.getElementById('fbdims_'+nm); if(box) box.innerHTML = fbDimsHtml(nm, sel.value, mine)
}
async function fbSubmit(nm){
  const sel = document.getElementById('fbst_'+nm)
  const station = sel ? sel.value : ''
  const box = document.getElementById('fbdims_'+nm), dims = {}
  if(box) box.querySelectorAll('input[type=range]').forEach(sl=>{ if(sl.dataset.touched) dims[sl.dataset.asp] = +sl.value })
  const tx = document.getElementById('fbtx_'+nm), text = tx ? tx.value : ''
  if(!Object.keys(dims).length && !text.trim()){ alert('至少評一個面向或寫一句話'); return }
  const r = await fetch('/api/mail-sync?fbset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ date: window._fbD.date, target: nm, station, dims, text, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) fbLoad(window._fbD.date); else alert((d&&d.error)||'送出失敗')
}
function fbAssignNew(){
  const d = window._fbD
  const pool = [...new Set([...(d.workers||[]), ...(d.names||[])])]
  const sts = d.stations || []
  const ov = document.createElement('div'); ov.id='fbaOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:380px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:10px">＋ 指定回饋（誰對誰）</div>
    <div style="font-size:13px;margin-bottom:4px">由誰回饋</div>
    <select id="fbaRv" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:8px">${pool.map(n=>`<option>${fbE(n)}</option>`).join('')}</select>
    <div style="font-size:13px;margin-bottom:4px">回饋對象</div>
    <select id="fbaRe" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:8px">${pool.map(n=>`<option>${fbE(n)}</option>`).join('')}</select>
    <div style="font-size:13px;margin-bottom:4px">站別（可留空）</div>
    <select id="fbaSt" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:8px"><option value="">—</option>${sts.map(s=>`<option>${fbE(s)}</option>`).join('')}</select>
    <div style="font-size:13px;margin-bottom:4px">具體方面（可留空，帶教用）</div>
    <input id="fbaAsp" placeholder="例：出餐速度、對客態度" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:12px;box-sizing:border-box">
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('fbaOv').remove()">取消</button>
    <button class="mini on" style="padding:9px 18px" onclick="fbAssignGo()">指定</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function fbAssignGo(){
  const rv = (document.getElementById('fbaRv')||{}).value||''
  const re = (document.getElementById('fbaRe')||{}).value||''
  const st = (document.getElementById('fbaSt')||{}).value||''
  const asp = (document.getElementById('fbaAsp')||{}).value||''
  if(rv===re){ alert('不能指定自己回饋自己'); return }
  const r = await fetch('/api/mail-sync?fbassign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'add', date: window._fbD.date, reviewer: rv, reviewee: re, station: st, aspect: asp, token: TK() }) })
  const d = await r.json().catch(()=>null)
  const o = document.getElementById('fbaOv'); if(o) o.remove()
  if (d && d.ok) fbLoad(window._fbD.date); else alert((d&&d.error)||'指定失敗')
}
async function fbAssignDel(id){
  if(!confirm('刪除這組指定回饋？')) return
  const r = await fetch('/api/mail-sync?fbassign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'del', id, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) fbLoad(window._fbD.date); else alert((d&&d.error)||'刪除失敗')
}
// v4.52.8 治本（張良「再也不要永遠出現頓號分隔、留空用預設的機制」——這條 ui-conventions 早記了卻沒套到這頁）：
// 改一列一面向＋✕移除＋＋新增＋✓存（照夥伴名冊職務選單範式），不再是頓號字串
const fbAspRow = (v) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px"><input value="${fbE(v||'')}" placeholder="面向名稱（例：工作態度）" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:14px"><button class="mini" style="color:var(--red);padding:5px 11px" title="移除這一列" onclick="this.parentElement.remove()">✕</button></div>`
window._fbAspRow = () => fbAspRow('')
function fbDimsEdit(){
  const d = window._fbD
  const sts = d.stations || [], m = (d.dims&&d.dims.map)||{}
  const def = (d.dims&&d.dims.def)||[]
  const grp = (key, title, arr, gid) => `<div style="margin-bottom:12px;border:1px solid var(--line);border-radius:10px;padding:10px 12px">
    <div style="font-size:13px;font-weight:700;margin-bottom:6px">${title}</div>
    <div id="${gid}">${(arr.length?arr:['']).map(a=>fbAspRow(a)).join('')}</div>
    <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
      <button class="mini" style="padding:6px 12px" onclick="var g=document.getElementById('${gid}');g.insertAdjacentHTML('beforeend',window._fbAspRow());var ii=g.querySelectorAll('input');if(ii.length)ii[ii.length-1].focus()">＋ 新增面向</button>
      <button class="mini on" style="padding:6px 16px;margin-left:auto" onclick="fbDimsSave('${key}','${gid}',this)">✓ 存</button>
    </div></div>`
  const ov = document.createElement('div'); ov.id='fbdOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:440px;width:100%;max-height:82vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:6px">回饋面向設定</div>
    <div class="hint" style="margin-bottom:12px">一個面向一列：✕移除、＋新增，改完按✓存；某站整組清空＝那站改用預設</div>
    ${grp('', '預設（沒單獨設的站都用這組）', def, 'fbgDef')}
    ${sts.map((s,i)=>grp(s, fbE(s), m[s]||[], 'fbg'+i)).join('')}
    <div style="display:flex;justify-content:flex-end;margin-top:4px"><button class="mini" style="padding:9px 16px" onclick="document.getElementById('fbdOv').remove()">關閉</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function fbDimsSave(station, gid, btn){
  const g = document.getElementById(gid); if(!g) return
  const aspects = [...g.querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean)
  const body = station ? { op:'station', station, aspects, token: TK() } : { op:'default', aspects, token: TK() }
  const r = await fetch('/api/mail-sync?fbdims=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok){ if(d.dims) window._fbD.dims = { map: d.dims.map, def: d.dims.def }; if(btn){ btn.textContent='✓ 已存'; setTimeout(()=>{ if(btn) btn.textContent='✓ 存' },1200) } } else alert((d&&d.error)||'存失敗')
}
// ── 🍔 菜單分頁（張良 2026-09-22：base=既有菜單凍結、draft=新菜單協作編輯；diff 標新增/刪除/修改給大家看；可切「對照原菜單」雙欄）──
let menuMode = 'edit'
let menuEditSec = {} // 每個分類自己的編輯開關（張良 2026-10-01：每個分類都要有編輯按鈕）
async function menuLoad(){
  curStore = 'menu'; setTabs('menu')
  if (typeof menuFlushCell === 'function') menuFlushCell() // 進來前先把上次待存的格子送出，避免被這次回抓蓋掉
  if (!window._mnPageHide) { window._mnPageHide = 1; window.addEventListener('pagehide', ()=>{ try{ menuFlushCell() }catch(_){} }) } // 關頁/切App前保底存一次
  if (!window._menuD) { const c = tcGet('menu'); if (c) window._menuD = c }
  if (window._menuD) menuRender(); else app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?menu=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (!d || !d.ok) { if (!window._menuD) app.innerHTML = '<div class="err">讀不到資料</div>'; return }
  window._menuD = d; tcSet('menu', d)
  if (curStore === 'menu') menuRender()
}
function menuFoldT(si){ const S = window._menuFold = window._menuFold || new Set(); S.has(si) ? S.delete(si) : S.add(si); menuRender() }
function menuFoldAll(on){ const d = window._menuD; window._menuFold = on ? new Set((d.draft.sections||[]).map((_,i)=>i)) : new Set(); menuRender() }
function menuFlat(m2){ const o2 = {}; (m2.sections||[]).forEach((s2,si)=>(s2.items||[]).forEach(i2=>{ o2[i2.id] = { ...i2, sec: s2.name, si } })); return o2 }
function menuDiff(){
  const d = window._menuD
  const bF = menuFlat(d.base), dF = menuFlat(d.draft||d.base)
  return { bF, dF,
    add: Object.keys(dF).filter(k=>!bF[k]),
    del: Object.keys(bF).filter(k=>!dF[k]),
    chg: Object.keys(dF).filter(k=>bF[k] && (bF[k].name!==dF[k].name || bF[k].price!==dF[k].price || (bF[k].note||'')!==(dF[k].note||'') || (bF[k].en||'')!==(dF[k].en||''))) }
}
function menuRender(){
  const d = window._menuD; if (!d || curStore !== 'menu') return
  document.getElementById('upd').textContent = '新菜單協作・既有菜單已先上、直接改'
  const meN = d.me ? d.me.name : null // 2026-10-02 全面修：只有菜單口有 canEdit 欄位，整檔替換誤傷各分頁→按鈕全滅；顯示層=綁定即可，真正權限由伺服器端守門
  const df = menuDiff()
  const seg = (lb,v) => `<button style="border:none;padding:6px 14px;font-size:14px;font-weight:800;cursor:pointer;${menuMode===v?'background:var(--primary);color:#fff':'background:var(--card);color:var(--primary)'}" onclick="menuMode='${v}';menuRender()">${lb}</button>`
  let h = `<section><h2>新菜單 <span class="hint">${meN?'直接在上面改，大家都看得到動了什麼':'看得到；要編輯先綁定——'+BIND_HINT}</span></h2>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
    <span style="display:inline-flex;border:1.5px solid var(--primary);border-radius:9px;overflow:hidden">${seg('✏️ 新菜單','edit')}${seg('🆚 對照原菜單','cmp')}</span>
    ${meN&&menuMode==='edit'?`<button class="mini" onclick="menuSecForm()">＋ 新增分類</button>`:''}
    ${meN&&menuMode==='edit'?`<button class="mini" id="menuFillBtn" onclick="menuFillEnOfficial()" title="照你上傳的 4 張菜單圖，把所有品項(含已刪除)補上官方英文">照菜單圖補英文</button>`:''}
    ${meN&&menuMode==='edit'?`<button class="mini" id="menuTransBtn" onclick="menuTransAll()" title="把所有缺英文的品項用 AI 自動翻成英文菜名，可再微調">自動翻譯英文</button>`:''}
    <button class="mini" onclick="menuExport('txt')">⬇️ 匯出文字</button>
    <select class="mini" onchange="menuSetSpec(this.value)" title="匯出圖片尺寸（方向×畫質）" style="padding:4px 10px">${Object.entries(MENU_SPECS).map(([k,s])=>`<option value="${k}" ${k===menuOutKey?'selected':''}>${s.t}</option>`).join('')}</select>
    <button class="mini" onclick="menuExport('img')">🖼 直式菜單圖</button>
    <button class="mini" onclick="menuExport('imgsec')">🖼 一區一張</button>
    ${d.me&&!d.me.canEdit?(d.me.pendingMe?`<span class="hint">🕐 編輯權審核中（已通知老闆）</span>`:`<button class="mini on" onclick="prepApply()">🙋 申請編輯權限</button>`):''}
    ${!d.me?`<span class="hint">看得到；要編輯先綁定＋申請</span>`:''}
  </div>`

  // 菜單設計圖四格（張良 2026-10-02：照順序、點看大圖、各格可換圖）
  const imgs = d.imgs || []
  h += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">` + [0,1,2,3].map(i=>{
    const u = imgs[i]
    return `<div style="position:relative;border:1.5px solid var(--line);border-radius:10px;overflow:hidden;background:#2E2512;aspect-ratio:16/9">
      ${u?`<img src="${u}" onclick="mnImgView('${u}')" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in">`:`<div class="mut" style="display:flex;align-items:center;justify-content:center;height:100%">第 ${i+1} 格</div>`}
      ${meN?`<button class="mini" style="position:absolute;right:4px;bottom:4px;background:var(--card)" onclick="mnImgPick(${i})">📷</button>`:''}
      ${meN&&((d.imgHist||{})[i]>0)?`<button class="mini" title="復原上一張" style="position:absolute;right:44px;bottom:4px;background:var(--card)" onclick="mnImgUndo(${i})">↩︎</button>`:''}
    </div>`
  }).join('') + `</div>`
  // 變更總覽（協作人員一眼看懂）
  if (df.add.length || df.del.length || df.chg.length) {
    h += `<div style="background:#2E2814;border:1.5px solid #E8D089;border-radius:12px;padding:10px 12px;margin-bottom:10px;font-size:14px">
      <div style="font-weight:900">📌 跟原菜單比：<span class="up">新增 ${df.add.length}</span>・<span style="color:var(--red);font-weight:800">刪除 ${df.del.length}</span>・<span style="color:#A85C26;font-weight:800">修改 ${df.chg.length}</span></div>`
    df.add.forEach(k=>{ h += `<div class="up">＋ ${df.dF[k].sec}｜${df.dF[k].name} $${df.dF[k].price}</div>` })
    df.del.forEach(k=>{ h += `<div style="color:var(--red)">－ ${df.bF[k].sec}｜<s>${df.bF[k].name} $${df.bF[k].price}</s></div>` })
    // ～修改明細不逐條列（張良 2026-10-02：保留的菜單不用顯示在這）——數字在上面那行就夠
    h += `</div>`
  } else h += `<div class="mut" style="margin-bottom:10px;font-size:14px">還沒有改動——跟原菜單一模一樣</div>`
  h += `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:10px;padding:8px 11px;margin-bottom:10px;font-size:14px"><b>套餐規則：</b>${(d.draft.note||'').replace(/</g,'&lt;')} ${meN&&menuMode==='edit'?`<button class="mini" onclick="menuNoteEdit()">✏️</button>`:''}</div>`
  if (menuMode === 'edit') {
    window._menuFold = window._menuFold || new Set() // v4.10.0（張良）：分類可收合＋一鍵全收/全開
    h += `<div style="margin-bottom:8px;display:flex;gap:6px"><button class="mini" onclick="menuFoldAll(1)">⊖ 全部收合</button><button class="mini" onclick="menuFoldAll(0)">⊕ 全部展開</button></div>`
    h += `<div id="mnSecs">` // v4.57.0 分類拖曳容器（pointer 拖曳＝滑鼠/觸控都順，取代原生 HTML5 拖曳 iPad 不順）
    ;(d.draft.sections||[]).forEach((s2,si)=>{
      const fold = window._menuFold.has(si)
      h += `<div class="mnSec" data-si="${si}" style="background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:9px 11px;margin-bottom:10px">
        <div style="font-weight:900;color:var(--pdark)">${meN?`<span onpointerdown="mnDragStart(event,'sec',${si})" title="按住拖曳排序分類" style="cursor:grab;touch-action:none;color:#9fb0c6;padding:2px 5px;display:inline-block">⠿</span> `:''}<span style="cursor:pointer" onclick="menuFoldT(${si})">${fold?'▸':'▾'} ${s2.name}</span>${fold?` <span class="hint">（${(s2.items||[]).length} 品項）</span>`:''} ${s2.note?`<span class="hint">${s2.note}</span>`:''}
        ${meN?` <button class="mini ${menuEditSec[si]?'on':''}" onclick="menuEditSec[${si}]=!menuEditSec[${si}];menuRender()">${menuEditSec[si]?'完成':'編輯'}</button>`:''}${meN&&menuEditSec[si]?` <button class="mini" onclick="menuSecShift(${si},-1)">↑</button><button class="mini" onclick="menuSecShift(${si},1)">↓</button> <button class="mini" onclick="menuSecForm(${si})">改名</button> <button class="mini ${s2.combo?'on':''}" onclick="menuSecCombo(${si})" title="設這類的套餐基準價：品項售價=基準價→顯示「套餐內含」、高於→「套餐+差額」；0/空=這類不開套餐">套餐價${s2.combo?' $'+s2.combo:''}</button> <button class="mini" onclick="menuItemAdd(${si})">＋品項</button> <button class="mini" style="color:var(--red)" onclick="if(confirm('刪掉整個分類「${s2.name}」？（品項會標成刪除）'))menuSecDel(${si})">刪分類</button>`:''}</div>`
      // 表格化＋每格直接編輯（張良 2026-10-01：中文/英文/售價/備註四欄全 inline 改）
      // v4.43.7 對齊治本：th 改[名稱,對齊]單一來源（售價/新售價=right 跟 td 一致、操作=left）——照 p11 C9 範式
      if (fold) { h += `</div>`; return } // 收合＝只留標題列
      h += `<div class="scroll"><table style="width:100%;min-width:560px;border-collapse:collapse;margin-top:6px;table-layout:fixed"><colgroup><col style="width:22%"><col style="width:25%"><col style="width:9%"><col style="width:9%"><col style="width:11%"><col style="width:18%"><col style="width:6%"></colgroup><thead><tr>${[['中文','left'],['英文','left'],['售價','right'],['新售價','right'],['套餐','center'],['備註','left'],['操作','center']].map(([x,al])=>`<th style="text-align:${al};font-size:12px;color:#6b7a90;padding:5px 7px;border:1px solid var(--line);background:var(--soft)">${x}</th>`).join('')}</tr></thead><tbody>`
      ;(s2.items||[]).forEach(i2=>{
        const b = df.bF[i2.id]
        const isNew = !b, isChg = b && (b.name!==i2.name || b.price!==i2.price || (b.note||'')!==(i2.note||'') || (b.en||'')!==(i2.en||''))
        const edOn = meN && menuEditSec[si]
        // v4.52.5 clr=1 給清空 X（張良「加一個X給我直接消除整個」）：點 X=清空該格並重畫；配合後端防蓋修正,清了不會再跑回來
        const cell=(f,v,st,clr)=> edOn ? `<td style="padding:3px 4px;border:1px solid var(--line);position:relative"><input value="${String(v??'').replace(/"/g,'&quot;')}" onchange="menuCell(${si},'${i2.id}','${f}',this.value)" onkeydown="menuKey(event)" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:7px;padding:6px;${clr?'padding-right:26px;':''}font-size:14px;background:var(--card);${st||''}">${clr?`<button onclick="menuCell(${si},'${i2.id}','${f}','');menuRender()" title="清空這格" style="position:absolute;right:9px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;padding:0">✕</button>`:''}</td>` : `<td style="padding:6px 7px;border:1px solid var(--line);text-align:left;${st||''}">${String(v??'')!==''?String(v).replace(/</g,'&lt;'):'<span class="mut">—</span>'}</td>`
        // v4.57.1 張良：⠿拖曳握把移到中文名左邊、中文欄縮窄、操作欄只留🗑（↑↓拿掉用拖曳取代）
        const nameTd = edOn
          ? `<td style="padding:3px 4px;border:1px solid var(--line)"><div style="display:flex;align-items:center;gap:3px"><span onpointerdown="mnDragStart(event,'item',${si})" title="按住拖曳排序品項" style="cursor:grab;touch-action:none;color:#9fb0c6;padding:2px 2px;flex:none;line-height:1">⠿</span><input value="${String(i2.name??'').replace(/"/g,'&quot;')}" onchange="menuCell(${si},'${i2.id}','name',this.value)" onkeydown="menuKey(event)" style="flex:1;min-width:0;box-sizing:border-box;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:14px;background:var(--card);font-weight:700"></div></td>`
          : cell('name',i2.name,'font-weight:700')
        // v4.58.0 套餐欄（張良）：分類設基準價→品項=基準顯「套餐內含」綠、高於顯「套餐+差額」；品項可選「不給套餐」=不顯示
        const comboTd = (()=>{
          const base = Number(s2.combo)||0
          const td = inner => `<td style="padding:4px 5px;border:1px solid var(--line);text-align:center">${inner}</td>`
          if (!base) return td(`<span class="mut" style="font-size:12px">—</span>`)
          if (i2.noCombo) return td(edOn?`<button class="mini" style="color:var(--muted)" onclick="menuItemCombo(${si},'${i2.id}')" title="點一下改成：納入套餐">不給</button>`:`<span class="mut" style="font-size:12px">不給套餐</span>`)
          const diff = (Number(i2.price)||0) - base
          const label = diff===0?'套餐內含':(diff>0?'套餐 +'+diff:'套餐 '+diff)
          const clr = diff===0?'var(--green)':'var(--muted)'
          const chip = `<span style="color:${clr};font-size:12.5px;font-weight:800;white-space:nowrap">${label}</span>`
          return td(edOn?`<button class="mini" onclick="menuItemCombo(${si},'${i2.id}')" title="點一下改成：不給套餐" style="padding:4px 8px">${chip}</button>`:chip)
        })()
        h += `<tr data-id="${i2.id}" style="background:${isNew?'#1C3326':'transparent'}">${nameTd}${cell('en',i2.en,'min-width:110px',1)}${edOn?`<td style="padding:3px 4px;border:1px solid var(--line)"><input inputmode="numeric" value="${i2.price}" onchange="menuCell(${si},'${i2.id}','price',this.value)" onkeydown="menuKey(event)" style="width:64px;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:14px;text-align:right;font-weight:800;background:var(--card)"></td>`:`<td style="padding:6px 7px;border:1px solid var(--line);text-align:right;font-weight:800">$${i2.price}</td>`}${edOn?`<td style="padding:3px 4px;border:1px solid var(--line)"><input inputmode="numeric" value="${i2.np||''}" placeholder="—" onchange="menuCell(${si},'${i2.id}','np',this.value)" onkeydown="menuKey(event)" style="width:64px;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:14px;text-align:right;font-weight:800;background:var(--card);color:#A85C26"></td>`:`<td style="padding:6px 7px;border:1px solid var(--line);text-align:right;font-weight:800;color:#A85C26">${i2.np?'$'+i2.np:'—'}</td>`}${comboTd}${cell('note',i2.note,'min-width:90px')}<td style="white-space:nowrap;border:1px solid var(--line);padding:3px 5px;text-align:center">${isNew?'<span class="up" style="font-size:12px;font-weight:800">新</span> ':''}${edOn?`<button class="mini" style="color:var(--red)" onclick="if(confirm('刪掉「${i2.name}」？'))menuItemDel(${si},'${i2.id}')">🗑</button>`:''}</td></tr>`
      })
      h += `</tbody></table></div>`
      // 這分類底下被刪掉的（原菜單有、新菜單沒了）→ 灰底刪除線＋復原
      df.del.filter(k=>df.bF[k].sec===s2.name).forEach(k=>{ const b = df.bF[k]
        h += `<div style="display:flex;gap:8px;align-items:center;background:#20262F;border:1px dashed #56493F;border-radius:9px;padding:6px 10px;margin-top:6px;font-size:14px;opacity:.75">
          <span style="flex:1;color:var(--red)"><s>${b.name} $${b.price}</s> <span style="font-size:13px;font-weight:800">已刪除</span></span>
          ${meN?`<button class="mini" onclick="menuItemRestore('${k}')">↩︎ 復原</button> <button class="mini" style="color:var(--red)" onclick="if(confirm('永久刪除「${b.name}」？不會再出現在菜單頁'))menuItemPurge('${k}')">永久刪除</button>`:''}</div>` })
      h += `</div>`
    })
    h += `</div>` // /#mnSecs
    // 整個分類被刪掉的
    const delSecs = (d.base.sections||[]).filter(bs=>!(d.draft.sections||[]).some(s2=>s2.name===bs.name) && df.del.some(k=>df.bF[k].sec===bs.name))
    delSecs.forEach(bs=>{
      h += `<div style="background:#20262F;border:1px dashed #56493F;border-radius:12px;padding:9px 11px;margin-bottom:10px;opacity:.75">
        <div style="font-weight:900;color:var(--red)"><s>${bs.name}</s> 已整類刪除</div>` +
        df.del.filter(k=>df.bF[k].sec===bs.name).map(k=>`<div style="font-size:14px;color:var(--red);margin-top:4px"><s>${df.bF[k].name} $${df.bF[k].price}</s> ${meN?`<button class="mini" onclick="menuItemRestore('${k}')">↩︎ 復原</button>`:''}</div>`).join('') + `</div>`
    })
  } else { // 🆚 對照模式：左原右新
    const secNames = [...new Set([...(d.base.sections||[]).map(s2=>s2.name), ...(d.draft.sections||[]).map(s2=>s2.name)])]
    secNames.forEach(nm=>{
      const bs = (d.base.sections||[]).find(s2=>s2.name===nm), ds = (d.draft.sections||[]).find(s2=>s2.name===nm)
      h += `<div style="background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:9px 11px;margin-bottom:10px">
        <div style="font-weight:900;color:var(--pdark)">${nm}${!bs?' <span class="up" style="font-size:13px">新分類</span>':''}${!ds?' <span style="color:var(--red);font-size:13px;font-weight:800">整類刪除</span>':''}</div>
        ${(()=>{ // 左右同列對齊（張良 2026-10-01：快速辨識）＋刪除的全部放最下面
          const row=(l,r,bd)=>`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:3px 0;border-top:1px dashed ${bd||'#2A3240'}">${l}${r}</div>`
          let rs = row('<div class="hint" style="font-weight:800">原菜單</div>','<div class="hint" style="font-weight:800">新菜單</div>','transparent')
          ;(ds?(ds.items||[]):[]).forEach(i2=>{ const b=df.bF[i2.id]; const isNew=!b; const chg=df.chg.includes(i2.id)
            // v4.47.9 張良「保留的菜單字不要暗橘色很難看→白色存留、字體大一點；綠色新增、紅色刪除」：存留/修改一律白#F2F5F9+15.5px(不再暗橘),新增綠,刪除紅在下方區塊
            rs += row(`<div style="color:#F2F5F9;font-size:15.5px">${b?`${b.name} $${b.price}`:'<span class="mut">—</span>'}</div>`,
              `<div style="${isNew?'color:var(--green);font-weight:700':'color:#F2F5F9'};font-size:15.5px">${i2.name} $${i2.price}${i2.note?` <span class="hint">${i2.note}</span>`:''}${isNew?' <span class="up" style="font-size:12px;font-weight:800">新增</span>':''}</div>`)
          })
          const delK = df.del.filter(k=>df.bF[k].sec===nm)
          if(delK.length){ rs += `<div style="margin-top:8px;font-weight:800;color:var(--red);font-size:13px">🗑 已刪除（${delK.length}）</div>`
            delK.forEach(k=>{ const b=df.bF[k]; rs += row(`<div style="color:var(--red);text-decoration:line-through">${b.name} $${b.price}</div>`,'<div class="mut">—</div>','#4A3432') }) }
          return `<div style="margin-top:6px;font-size:14px">${rs}</div>`
        })()}</div>`
    })
  }
  if ((d.edits||[]).length) h += `<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">✍️ 編輯紀錄（${d.edits.length}）</summary>${d.edits.map(e=>`<div class="hint">${e.ts}・${e.by}${e.what?'・'+e.what:''}</div>`).join('')}</details>`
  h += `</section>`
  app.innerHTML = h
}
// v4.58.0 套餐判定（共用）：分類有基準價且品項沒設不給→內含/+差額；否則 null（不顯示套餐）
function mnCombo(s2, i2){
  const base = Number(s2.combo)||0
  if (!base || i2.noCombo) return null
  const diff = (Number(i2.price)||0) - base
  return diff===0 ? {t:'套餐內含', inc:true} : (diff>0 ? {t:'套餐 +'+diff, inc:false} : {t:'套餐 '+diff, inc:false})
}
function menuExport(kind){ // 匯出完整菜單（張良 2026-10-02）：txt=文字檔 / img=海報圖；只含現行菜單（刪除的不進）
  const d = window._menuD; if (!d) return
  const secs = (d.draft.sections||[]).map(s2=>({ name:s2.name, note:s2.note, combo:Number(s2.combo)||0,
    items:(s2.items||[]).filter(i2=>i2.name) })).filter(s=>s.items.length)
  const L = []
  L.push('GROUN:D 菜單 ' + todayTpe())
  if (d.draft.note) L.push(d.draft.note)
  secs.forEach(s2=>{
    L.push('')
    L.push('【' + s2.name + '】' + (s2.note ? '（' + s2.note + '）' : '') + (s2.combo ? '　套餐價 $' + s2.combo : ''))
    s2.items.forEach(i2=>{ const c = mnCombo(s2, i2)
      L.push('・' + i2.name + (i2.en ? '｜' + i2.en : '') + '｜$' + i2.price + (i2.np ? '（新售價 $' + i2.np + '）' : '') + (c ? '｜' + c.t : '') + (i2.note ? '｜' + i2.note : ''))
    })
  })
  if (kind === 'txt') {
    const blob = new Blob(['\ufeff' + L.join('\n')], { type: 'text/plain;charset=utf-8' })
    const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = 'GROUND菜單_' + todayTpe() + '.txt'; a2.click(); URL.revokeObjectURL(a2.href)
    return
  }
  // 🖼 海報（張良 2026-10-07 v4.58.5）：Canva 奶油底紅字風；img=整張 / imgsec=一區一張
  if (kind === 'imgsec') { menuPosterSections(d, secs); return }
  menuPosterCanva(d, secs)
}
// ───── 菜單海報共用（v4.63.0 / v12，2026-10-08 照 GROUND_portrait-text.svg 官方精確幾何）─────
const MENU_SK = { CREAM:'#F5EADA', RED:'#CE1611', ENG:'#C56B54', WHITE:'#FFF6E9', DOT:'#D98A7A',
  SLAB:'"Alfa Slab One", Georgia, serif', TC:'"Noto Sans TC", system-ui, sans-serif',
  PP:'"Poppins","Noto Sans TC",system-ui,sans-serif', MONO:'"Space Mono",ui-monospace,monospace' }
// 輸出尺寸（張良 2026-10-07 v4.58.6）：方向×畫質，匯出時精準輸出成這個像素（內容置中、奶油底補邊，不變形）
const MENU_SPECS = { p4k:{w:2160,h:3840,t:'直式 4K（2160×3840）'}, l4k:{w:3840,h:2160,t:'橫式 4K（3840×2160）'},
  phd:{w:1080,h:1920,t:'直式 Full HD（1080×1920）'}, lhd:{w:1920,h:1080,t:'橫式 Full HD（1920×1080）'} }
let menuOutKey = 'p4k'
function menuSetSpec(v){ if (MENU_SPECS[v]) menuOutKey = v }
// 把「邏輯畫布」等比置中貼進選定規格的固定尺寸畫布（contain，奶油底補邊）
function menuFitSpec(srcCv){
  const sp = MENU_SPECS[menuOutKey]; if (!sp) return srcCv
  const out = document.createElement('canvas'); out.width = sp.w; out.height = sp.h
  const g = out.getContext('2d'); g.fillStyle = MENU_SK.CREAM; g.fillRect(0,0,sp.w,sp.h)
  const s = Math.min(sp.w/srcCv.width, sp.h/srcCv.height), w = srcCv.width*s, h = srcCv.height*s
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'
  g.drawImage(srcCv, (sp.w-w)/2, (sp.h-h)/2, w, h)
  return out
}
// 字型預載（Alfa Slab 英文大標／Poppins 英文副標／Space Mono 標語／Noto Sans TC 中文）
async function menuFontsReady(){
  const need = ['64px "Alfa Slab One"','900 30px "Noto Sans TC"','700 30px "Noto Sans TC"','500 18px "Poppins"','700 18px "Space Mono"']
  try{ await Promise.all(need.map(f=>document.fonts.load(f))); await document.fonts.ready }catch(e){}
}
// 建一個帶 helper 的繪圖 context
function menuMkCtx(cv, S){
  const g = cv.getContext('2d'); g.scale(S,S); g.textBaseline='alphabetic'
  const fit=(t,m)=>{ t=String(t||''); if(g.measureText(t).width<=m) return t; let s=t; while(s.length>1 && g.measureText(s+'…').width>m) s=s.slice(0,-1); return s+'…' }
  const setFont=(f,ls)=>{ g.font=f; g.letterSpacing=(ls||0)+'px' }
  const rr=(x,y,w,h,r)=>{g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()}
  const leader=(x1,x2,y,col)=>{ if(x2-x1<16) return; g.save(); g.strokeStyle=col; g.lineWidth=3.5; g.lineCap='round'; g.setLineDash([0,13]); g.beginPath(); g.moveTo(x1,y); g.lineTo(x2,y); g.stroke(); g.restore() }
  return {g,fit,setFont,rr,leader}
}
// 區名「PIZZA 披薩」→ {enU, cnT}
function menuSplitName(nm){ nm=String(nm||'').trim(); const m=nm.match(/^([A-Za-z0-9&'.\- ]+?)\s*([一-鿿].*)?$/)
  const enT=m&&m[1]?m[1].trim():''; const cnT=m&&m[2]?m[2].trim():(enT?'':nm); return {enU:enT.toUpperCase(), cnT} }
// 畫一列品項（中文名…點點引線…售價[備註紅徽章]；下方英文副標；無 $）
function menuDrawItemRow(C, SK, it, x, w, ry, ts){
  const {g,fit,setFont,rr,leader}=C; const right=x+w; let rightCursor=right
  if (it.note){ setFont('800 '+Math.round(16*ts)+'px '+SK.TC,1); const t=String(it.note); const tw=g.measureText(t).width, pw=tw+22, ph=Math.round(30*ts), bx=rightCursor-pw, by=ry-Math.round(7*ts)
    rr(bx,by,pw,ph,7); g.fillStyle=SK.RED; g.fill(); g.fillStyle=SK.WHITE; g.fillText(t,bx+11,ry+Math.round(15*ts)); g.letterSpacing='0px'; rightCursor=bx-14 }
  const ps=Math.round(29*ts)
  setFont('800 '+ps+'px '+SK.TC,0); g.fillStyle=SK.RED; const pr=String(it.price||0); const prW=g.measureText(pr).width; const priceLeft=rightCursor-prW; g.fillText(pr,priceLeft,ry+Math.round(16*ts))
  setFont('700 '+ps+'px '+SK.TC,1); g.fillStyle=SK.RED; const nmMax=priceLeft-x-50; const nmTxt=fit(it.name,nmMax); g.fillText(nmTxt,x,ry+Math.round(16*ts))
  const nameEnd=x+g.measureText(nmTxt).width; g.letterSpacing='0px'
  leader(nameEnd+12, priceLeft-12, ry+Math.round(10*ts), SK.DOT)
  if (it.en){ setFont('500 '+Math.round(17*ts)+'px '+SK.PP,0); g.fillStyle=SK.ENG; g.fillText(fit(it.en, w*0.78), x, ry+Math.round(40*ts)) }
}
// 畫一個分區（標題自動縮放＋紅底線＋多欄品項，column-major）；回傳本區高度
function menuDrawSection(C, SK, sec, x, y, fullW, o){
  const {g,setFont}=C; const rowH=o.rowH, headH=o.headH, ts=o.ts||1, cols=o.cols||1, innerGap=o.innerGap||56, right=x+fullW
  const titleW=o.titleW||fullW
  const {enU,cnT}=menuSplitName(sec.name)
  const cnSize=Math.round(30*ts)
  setFont('900 '+cnSize+'px '+SK.TC,3); const cnW=cnT?g.measureText(cnT).width:0
  let enSize=Math.round(44*ts)
  if (enU){ const avail=titleW-(cnT?cnW+16:0); g.font=enSize+'px '+SK.SLAB; g.letterSpacing='0px'; while(enSize>22 && g.measureText(enU).width>avail){ enSize--; g.font=enSize+'px '+SK.SLAB } }
  let tx=x
  if (enU){ setFont(enSize+'px '+SK.SLAB,0); g.fillStyle=SK.RED; g.fillText(enU, tx, y+Math.round(40*ts)); tx+=g.measureText(enU).width+16 }
  if (cnT){ setFont('900 '+cnSize+'px '+SK.TC,3); g.fillStyle=SK.RED; g.fillText(cnT, tx, y+Math.round(37*ts)); g.letterSpacing='0px' }
  const lineY=y+Math.round(52*ts); g.strokeStyle=SK.RED; g.lineWidth=3; g.beginPath(); g.moveTo(x,lineY); g.lineTo(right,lineY); g.stroke()
  const n=sec.items.length, rows=Math.ceil(n/cols), subW=(fullW-(cols-1)*innerGap)/cols
  sec.items.forEach((it,i)=>{ const col=Math.floor(i/rows), rowInCol=i-col*rows, sx=x+col*(subW+innerGap)
    menuDrawItemRow(C, SK, it, sx, subW, y+headH+rowInCol*rowH, ts) })
  return headH + rows*rowH
}
// 底部「套餐玩法 +NN元 ＋ 任一主餐 ＋ 副食 ＋ 飲品」紅膠囊列
function menuDrawComboButtons(C, SK, x, y, w, setN){
  const {g,setFont,rr}=C; const h=74, pad=24, by=y+Math.round(h/2)+9
  const lbl='套餐玩法 +'+setN+'元'
  setFont('900 26px '+SK.TC,1); const lw=g.measureText(lbl).width+pad*2
  let cx=x; rr(cx,y,lw,h,14); g.fillStyle=SK.RED; g.fill(); g.fillStyle=SK.WHITE; g.fillText(lbl,cx+pad,by); cx+=lw+18
  const pills=['任一主餐','副食','飲品']
  pills.forEach((p,i)=>{ setFont('900 24px '+SK.TC,1); const bw=g.measureText(p).width+pad*2
    rr(cx,y,bw,h,h/2); g.fillStyle=SK.RED; g.fill(); g.fillStyle=SK.WHITE; g.fillText(p,cx+pad,by); cx+=bw
    if (i<pills.length-1){ setFont('900 30px '+SK.TC,0); g.fillStyle=SK.RED; g.fillText('＋', cx+6, y+Math.round(h/2)+10); cx+=38 } })
}
// 下載 canvas
function menuDownload(cv, name){ cv.toBlob(bl=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(bl); a.download=name; a.click(); URL.revokeObjectURL(a.href) }, 'image/png') }
// 底部 Space Mono 標語
function menuFooter(C, SK, x, rightX, baseY){
  const {g,setFont}=C
  setFont('700 17px '+SK.MONO,0); g.fillStyle=SK.RED; g.fillText('npm install ', x, baseY)
  const w1=g.measureText('npm install ').width; g.fillStyle=SK.ENG; g.fillText('HAPPINESS', x+w1, baseY)
  setFont('700 15px '+SK.MONO,0); g.fillStyle=SK.ENG; const tag='take a "quick BITE" of "HAPPINESS" :D'; g.fillText(tag, rightX-g.measureText(tag).width, baseY)
}
// ── v4.63.0 直式純文字菜單（1080×1920）：照 GROUND_portrait-text.svg 官方精確幾何 ──
// 固定配對[披薩,療癒碗][漢堡,三明治][PASTA,BRUNCH][SNACKS,DRINKS]、分類圓角紅框(非底線)、英標襯線、底列到底
const MENU_SERIF = 'Georgia, "DejaVu Serif", serif' // 英文分類字（DejaVuSerif-Bold 的網頁近似，缺原 TTF）
// 品牌頭（HAPPINESS 小／GROUN:D 大，置中 x540，位於頂 160 品牌帶）
function menuBrandHead(C, SK){
  const {g,setFont}=C; g.textAlign='center'
  setFont('600 22px '+SK.PP,8); g.fillStyle=SK.RED; g.fillText('HAPPINESS', 540, 66)
  setFont('52px '+SK.SLAB,0); g.fillStyle=SK.RED; g.fillText('GROUN:D', 540, 122)
  g.textAlign='left'; g.letterSpacing='0px'
}
// 分類標題（EN 襯線 30px＋CN 26px，中英共同基線＝分類區起點+27，過寬自動縮 EN）
function menuPHead(C, SK, sec, textX, colW, headStartY){
  const {g,setFont}=C; const {enU,cnT}=menuSplitName(sec.name); const baseY=headStartY+27
  setFont('650 26px '+SK.TC,1); const cnW=cnT?g.measureText(cnT).width:0; g.letterSpacing='0px'
  let enSize=30; if (enU){ const avail=colW-(cnT?cnW+14:0)-4; g.font='bold '+enSize+'px '+MENU_SERIF; while(enSize>16 && g.measureText(enU).width>avail){ enSize--; g.font='bold '+enSize+'px '+MENU_SERIF } }
  let tx=textX
  if (enU){ g.font='bold '+enSize+'px '+MENU_SERIF; g.letterSpacing='0px'; g.fillStyle=SK.RED; g.fillText(enU, tx, baseY); tx+=g.measureText(enU).width+14 }
  if (cnT){ setFont('650 26px '+SK.TC,1); g.fillStyle=SK.RED; g.fillText(cnT, tx, baseY-1); g.letterSpacing='0px' }
}
// 一列品項：中文名…點線…售價＋[內含紅底徽章/+N紅字]；下方英文＋行內標籤(冰／熱‧無咖啡因)
function menuPItemRow(C, SK, sec, it, boxX, boxW, textX, boxTop, i, side){
  const {g,fit,setFont,rr,leader}=C; const right=boxX+boxW
  const cnY=boxTop+38+i*64, enY=cnY+27, leadY=cnY-9
  const nmSize=side?30:32, enSize=side?16:18, prSize=side?29:32
  const c=(typeof mnCombo==='function')?mnCombo(sec,it):null
  const tagRight=right-8, priceRight=side?right-96:right-32
  // 套餐標籤（固定最右欄，價格靠在其左＝數字對齊）
  if (c){ if (c.inc){ const bw=66,bh=34,bx=tagRight-bw,by=cnY-27; rr(bx,by,bw,bh,4); g.fillStyle=SK.RED; g.fill()
      setFont('650 20px '+SK.TC,0); g.fillStyle=SK.WHITE; g.textAlign='center'; g.fillText('內含',bx+bw/2,cnY-2); g.textAlign='left' }
    else { const t=String(c.t).replace('套餐','').trim(); setFont('650 24px '+SK.TC,0); g.fillStyle=SK.RED; g.textAlign='right'; g.fillText(t,tagRight,cnY-1); g.textAlign='left' } }
  // 售價靠右對齊在 priceRight
  setFont('650 '+prSize+'px '+SK.TC,0); g.fillStyle=SK.RED; const pr=String(it.price||0); g.textAlign='right'; g.fillText(pr,priceRight,cnY); g.textAlign='left'
  const priceLeft=priceRight-g.measureText(pr).width
  // 菜名（把結尾的 I/H 抽出來移到英文行）
  let nm=String(it.name||''), ih=false
  if (/\s+I\s*\/\s*H\s*$/i.test(nm)){ ih=true; nm=nm.replace(/\s+I\s*\/\s*H\s*$/i,'').trim() }
  setFont('650 '+nmSize+'px '+SK.TC,0); g.fillStyle=SK.RED; const nmMax=priceLeft-textX-26; const nmTxt=fit(nm,nmMax); g.fillText(nmTxt,textX,cnY)
  const nameEnd=textX+g.measureText(nmTxt).width
  leader(nameEnd+14, priceLeft-18, leadY, SK.DOT)
  // 英文＋行內標籤（依字寬順序，不越價格欄）
  let ex=textX
  if (it.en){ setFont(enSize+'px '+SK.TC,0); g.fillStyle=SK.ENG; const et=fit(it.en, priceLeft-textX-6); g.fillText(et, ex, enY); ex+=g.measureText(et).width+12 }
  const tags=[]; if (ih) tags.push('冰／熱'); String(it.note||'').split(/[\s,，、]+/).forEach(s=>{ s=s.replace(/^#/,'').trim(); if (s) tags.push(s) })
  if (tags.length){ setFont('650 '+enSize+'px '+SK.TC,0); g.fillStyle=SK.RED; g.fillText(tags.join('　'), ex, enY) }
}
// 底部單行紅底列（y1850 高70，直式 26px 置中）：主餐 +N 升級套餐｜副餐選 1＋飲品選 1｜肉品產地…
function menuFooterBar(C, SK, W, y, h, setN, origins){
  const {g,setFont}=C
  g.fillStyle=SK.RED; g.fillRect(0,y,W,h)
  const txt='主餐 +'+setN+' 升級套餐　｜　副餐選 1＋飲品選 1　｜　肉品產地：'+origins
  let fs=26; setFont('650 '+fs+'px '+SK.TC,0); while(fs>14 && g.measureText(txt).width>W-56){ fs--; setFont('650 '+fs+'px '+SK.TC,0) }
  g.fillStyle=SK.WHITE; g.textAlign='center'; g.fillText(txt, W/2, y+Math.round(h/2)+fs*0.36); g.textAlign='left'
}
// 整張直式菜單：固定 1080×1920、固定設計配對、分類圓角框、每列取左右較大框底往下排、底列到底無留白
async function menuPosterCanva(d, secs){
  await menuFontsReady()
  const SK=MENU_SK, S=2, W=1080, H=1920
  const L={x:38,w:498,tx:50}, R={x:573,w:479,tx:585} // 官方 SVG 左右欄座標
  // 固定設計順序＋隱藏待價 $0
  const ORDER=['PIZZA','COMFORT','BURGER','ROLL','PASTA','BRUNCH','SNACK','DRINK']
  secs=secs.map(s=>({...s, items:(s.items||[]).filter(it=>Number(it.price)>0)})).filter(s=>s.items.length)
  const rank=s=>{ const u=String(s.name||'').toUpperCase(); const i=ORDER.findIndex(k=>u.includes(k)); return i<0?99:i }
  secs=secs.slice().map((s,i)=>({s,i})).sort((a,b)=>rank(a.s)-rank(b.s)||a.i-b.i).map(o=>o.s)
  const rows=[]; for (let i=0;i<secs.length;i+=2) rows.push([secs[i],secs[i+1]].filter(Boolean))
  const cv=document.createElement('canvas'); cv.width=W*S; cv.height=H*S
  const C=menuMkCtx(cv,S); const {g}=C
  g.fillStyle=SK.CREAM; g.fillRect(0,0,W,H)
  menuBrandHead(C, SK)
  // 欄頭：左 MENU 菜單／右 單點價・套餐（官方頂部標）
  C.setFont('650 22px '+SK.TC,1); g.fillStyle=SK.RED; g.textAlign='left'; g.fillText('MENU 菜單', L.x+12, 182); g.letterSpacing='0px'
  C.setFont('650 18px '+SK.TC,0); g.fillStyle=SK.RED; g.textAlign='right'; g.fillText('單點價／套餐', R.x+R.w, 182); g.textAlign='left'
  let headStartY=222
  rows.forEach(r=>{
    const boxTop=headStartY+43; let maxBottom=boxTop
    r.forEach((sec,ci)=>{
      const col=ci===0?L:R, side=(Number(sec.combo)||0)>0, n=sec.items.length, boxH=76+(n-1)*64
      menuPHead(C, SK, sec, col.tx, col.w-(col.tx-col.x), headStartY)
      C.rr(col.x,boxTop,col.w,boxH,16); g.strokeStyle=SK.RED; g.lineWidth=2; g.stroke()
      sec.items.forEach((it,i)=>menuPItemRow(C, SK, sec, it, col.x, col.w, col.tx, boxTop, i, side))
      maxBottom=Math.max(maxBottom, boxTop+boxH)
    })
    headStartY=maxBottom+18
  })
  const mm=String(d.draft.note||'').match(/(\d+)\s*元/); const setN=mm?mm[1]:'89'
  const origins=(d.draft.origins||'牛肉 美國／豬肉 台灣／雞肉 美國、台灣')
  menuFooterBar(C, SK, W, 1850, 70, setN, origins)
  menuDownload(menuFitSpec(cv), 'GROUND菜單_直式_'+todayTpe()+'.png')
}
// 一區一張：每區各一張 landscape（標題＋右上雙語升級橫幅＋2 欄品項）
async function menuPosterSections(d, secs){
  await menuFontsReady()
  for (let i=0;i<secs.length;i++){ menuPosterSectionOne(d, secs[i], i); if (i<secs.length-1) await new Promise(r=>setTimeout(r,450)) }
}
function menuPosterSectionOne(d, sec, idx){
  const SK=MENU_SK, S=2, W=1600, padX=80, padTop=72, padBottom=64, innerW=W-padX*2
  const n=sec.items.length, cols=n>=5?2:1, rowH=100, headH=124, rows=Math.ceil(n/cols)
  const comboTxt=(d.draft.note||'').trim(); const mm=comboTxt.match(/(\d+)\s*元/); const setN=mm?mm[1]:''
  const H=padTop + (headH + rows*rowH) + 60 + padBottom
  const cv=document.createElement('canvas'); cv.width=W*S; cv.height=H*S
  const C=menuMkCtx(cv,S); const {g,setFont,rr}=C
  g.fillStyle=SK.CREAM; g.fillRect(0,0,W,H)
  let titleW=innerW
  if (setN){ const bw=560, bh=84, bx=W-padX-bw, by=padTop-8; rr(bx,by,bw,bh,10); g.fillStyle=SK.RED; g.fill()
    setFont('900 30px '+SK.TC,1); g.fillStyle=SK.WHITE; g.fillText('+'+setN+'元 即可升級套餐', bx+22, by+37)
    setFont('600 22px '+SK.PP,0); g.fillStyle='rgba(255,255,255,.92)'; g.fillText('Make a set for just extra NT$'+setN, bx+22, by+68)
    titleW = innerW - bw - 40 }
  menuDrawSection(C, SK, sec, padX, padTop+8, innerW, {rowH, headH, ts:1.4, cols, innerGap:70, titleW})
  menuFooter(C, SK, padX, W-padX, H-padBottom+22)
  const safe=String(sec.name||('區'+(idx+1))).replace(/[\/\\:*?"<>|]/g,'').trim().slice(0,22)
  menuDownload(menuFitSpec(cv), 'GROUND菜單_'+String(idx+1).padStart(2,'0')+'_'+safe+'_'+todayTpe()+'.png')
}
function mnImgView(u){
  const ov=document.createElement('div')
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,16,28,.88);z-index:90;display:flex;align-items:center;justify-content:center;padding:12px;cursor:zoom-out'
  ov.innerHTML=`<img src="${u}" style="max-width:98vw;max-height:96vh;border-radius:10px">`
  ov.onclick=()=>ov.remove(); document.body.appendChild(ov)
}
async function mnImgUndo(i){
  if (!confirm('把第 ' + (i+1) + ' 格復原成上一張圖？')) return
  const r = await (await fetch('/api/mail-sync?menuimgset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ idx:i, undo:1, token: TK() }) })).json()
  if (!r.ok) { alert(r.error || '復原失敗'); return }
  window._menuD.imgs = r.imgs; window._menuD.imgHist = r.imgHist; menuRender()
}
function mnImgPick(i){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'
  inp.onchange=async()=>{
    const f=inp.files[0]; if(!f) return
    try{
      const sg=await (await fetch('/api/mail-sync?sopsign='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ext:(f.name.split('.').pop()||'jpg').toLowerCase()})})).json()
      if(!sg.ok) throw 0
      await fetch(sg.uploadUrl,{method:'PUT',headers:{'content-type':f.type||'image/jpeg'},body:f})
      const r=await (await fetch('/api/mail-sync?menuimgset='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idx:i,url:sg.publicUrl,token:TK()})})).json()
      if(!r.ok){alert(r.error||'換圖失敗');return}
      window._menuD.imgs=r.imgs; if(r.imgHist) window._menuD.imgHist=r.imgHist; menuRender()
    }catch(e){alert('上傳失敗，再試一次')}
  }
  inp.click()
}
// v4.40.1 權限表點名字選單（張良「眼睛跟移除都不要出現圖，點名字進去再出現選擇」）：模擬檢視／移除權限收進來
function permNameMenu(ev, rid, name, isAdmin){
  ev.stopPropagation()
  const old = document.getElementById('pmMn'); if (old) { old.remove(); return }
  const m = document.createElement('div'); m.id = 'pmMn'
  m.style.cssText = 'position:fixed;z-index:80;background:#222B38;border:1px solid #3B4654;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.55);padding:8px;min-width:200px'
  m.innerHTML = `<div style="font-weight:900;padding:4px 8px 8px">${name}</div>
    <div style="padding:0 8px 10px"><div class="hint" style="font-size:12px;margin-bottom:4px">職級</div><div id="pmRoles" style="display:flex;gap:6px">${['PT','正職','主管'].map(r0=>`<button class="mini" style="padding:6px 13px" onclick="permRoleSet('${rid}','${r0}',this)">${r0}</button>`).join('')}</div></div>
    <button class="mini" style="display:block;width:100%;text-align:left;margin:0 0 6px;padding:9px 12px" onclick="document.getElementById('pmMn').remove();simStart('${rid}','${name}')">${EYE_I} 用他的身分看 App</button>
    ${isAdmin?'':`<button class="mini" style="display:block;width:100%;text-align:left;margin:0;padding:9px 12px;color:var(--red)" onclick="document.getElementById('pmMn').remove();if(confirm('確定把 ${name} 移除編輯權限？\\n他的勾選設定會保留，下面「已移除」區可一鍵復原。'))permSet('revoke','${rid}')">移除編輯權限</button>`}`
  document.body.appendChild(m)
  // 目前職級點亮（v4.41.2 張良「PT/正職/主管設定功能」：存名冊 gdRole＝主管才看得到員工清冊）
  fetch('/api/mail-sync?gdrole=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK())).then(r=>r.json()).then(j=>{
    if (!j || !j.ok) return
    const cur = (j.roles || {})[rid] || ''
    document.querySelectorAll('#pmRoles button').forEach(b=>{ if (b.textContent === cur) b.className = 'mini on' })
  }).catch(()=>{})
  const r9 = ev.target.getBoundingClientRect()
  m.style.left = Math.max(8, Math.min(r9.left, innerWidth - m.offsetWidth - 10)) + 'px'
  m.style.top = Math.min(r9.bottom + 6, innerHeight - m.offsetHeight - 10) + 'px'
}
document.addEventListener('mousedown', e9 => { const m9 = document.getElementById('pmMn'); if (m9 && !m9.contains(e9.target)) m9.remove() })
async function permRoleSet(rid, role, btn){ // 點同一顆再點一次＝清除職級
  const was = btn.className.includes(' on')
  const r = await fetch('/api/mail-sync?gdrole=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), rid, role: was ? '' : role }) })
  const j = await r.json().catch(()=>null)
  if (!j || !j.ok) { alert((j && j.error) || '設定失敗'); return }
  document.querySelectorAll('#pmRoles button').forEach(b=>b.className='mini')
  if (!was) btn.className = 'mini on'
}
function permPanelHtml(perm){
  return `<div style="background:#19222E;border:1.5px solid #35557A;border-radius:12px;padding:10px 12px;font-size:14px">
    <div style="font-weight:900">🔐 編輯權限管理 <span class="hint">模式：${perm.mode==='open'?'全開（人人可編）':'審核制（申請→老闆核准）'}</span>
    <button class="mini" onclick="permSet('mode',null,'${perm.mode==='open'?'approve':'open'}')">切成${perm.mode==='open'?'審核制':'全開'}</button>
    <button class="mini" onclick="simStart('guest','未綁定訪客')">${EYE_I} 模擬訪客</button>
    <span class="hint">按人名旁的 ${EYE_I}＝用那個人的身分看整個 App（驗分頁/按鈕/設定），只能看不能改</span></div>
    ${(perm.pending||[]).length?`<div style="margin-top:6px;font-weight:800">待審核：</div>`+perm.pending.map(u=>`<div style="padding:3px 0">🙋 ${u.name} <span class="hint">${u.ts||''}</span> <button class="mini on" onclick="permSet('approve','${u.rid}')">✅ 核准</button> <button class="mini" onclick="permSet('reject','${u.rid}')">✖</button></div>`).join(''):'<div class="hint" style="margin-top:6px">目前沒有待審核的申請</div>'}
    ${(()=>{ // v4.26.4（張良「太多小圖很醜沒質感」）：乾淨表格——每分頁拆「看/編」兩小欄、純勾選框無emoji；欄頭勾=全員一起
      const cfgT = window._tabCfg || {}
      const ordT = (cfgT.order && cfgT.order.length ? cfgT.order.slice() : Object.keys(TAB_DEF)).filter(k=>TAB_DEF[k])
      Object.keys(TAB_DEF).forEach(k=>{ if (!ordT.includes(k)) ordT.push(k) }) // v4.39.1 新分頁排最後(設定上面)——原 unshift 會插到最前(張良要 inline 在設定上面)
      // v4.31.0（張良：側欄每一頁都要能關，像夥伴不用看到「設定」）：問題回報/設定也進表——這兩頁只有「看」的開關
      const TABS=[['board','首頁'], ...ordT.map(k=>[k, stripEmoji((cfgT.names||{})[k] || TAB_DEF[k])]), ['errs','問題回報',1], ['gear','設定',1]]
      const SEEK=TABS.map(x=>x[0]).join(','), EDITK=TABS.filter(x=>!x[2]).map(x=>x[0]).join(',')
      const users=(perm.users||[])
      const normal=users.filter(u=>!u.admin)
      const allSee=k=>normal.length&&normal.every(u=>!(u.hide&&u.hide[k]))
      const allEdit=k=>normal.length&&normal.every(u=>!u.tabs||u.tabs[k]!==0)
      const anySee=k=>normal.some(u=>!(u.hide&&u.hide[k])), anyEdit=k=>normal.some(u=>!u.tabs||u.tabs[k]!==0) // v4.32.1 半勾用
      // v4.32.1（張良「整列框全沒勾看起來不太對」）：部分開＝半勾（－）不再顯示成全關；點半勾＝全開、再點＝全關
      const cb=(ck,fn,tip,ind)=>`<input type="checkbox" ${ck?'checked':''}${!ck&&ind?' data-ind="1"':''} onchange="${fn}" title="${tip}" style="width:15px;height:15px;cursor:pointer;accent-color:var(--primary)">`
      const SEP='border-left:1px solid var(--line);'
      const COLS=1+TABS.reduce((a,x)=>a+(x[2]?1:2),0)
      let t=`<div style="margin-top:8px;font-weight:800">已核准（${users.length}）</div>
      <div class="scroll" style="margin-top:4px"><table style="border-collapse:collapse"><thead>
      <tr><th rowspan="2" style="text-align:left;position:sticky;left:0;background:var(--soft);z-index:2;padding:6px 10px;vertical-align:bottom">夥伴</th>
        <th rowspan="2" style="${SEP}padding:5px 8px;text-align:center;font-size:11px;font-weight:600;vertical-align:bottom">整列<br>看｜編</th>
        ${TABS.map(([k,lb,so])=>`<th colspan="${so?1:2}" style="${SEP}padding:5px 8px 2px;text-align:center;font-size:12.5px;white-space:nowrap">${lb}</th>`).join('')}</tr>
      <tr>${TABS.map(([k,lb,so])=>`<th style="${SEP}padding:2px 5px 6px;text-align:center;font-size:11px;font-weight:600">看<br>${cb(allSee(k),`permSet('taball',null,null,'${k}',this.checked,'see')`,'全員看得見 '+lb,anySee(k))}</th>`+(so?``:`<th style="padding:2px 5px 6px;text-align:center;font-size:11px;font-weight:600">編<br>${cb(allEdit(k),`permSet('taball',null,null,'${k}',this.checked,'edit')`,'全員能編輯 '+lb,anyEdit(k))}</th>`)).join('')}</tr>
      </thead><tbody>`
      users.forEach(u=>{
        // v4.40.1（張良「眼睛跟移除都不要出現圖，點名字進去再出現選擇」）：列上只留名字，點名字開小選單
        t+=`<tr><td style="text-align:left;font-weight:800;position:sticky;left:0;background:var(--card);z-index:1;padding:5px 10px;white-space:nowrap">${u.admin?'👑 ':''}<span style="cursor:pointer;text-decoration:underline dotted rgba(255,255,255,.28);text-underline-offset:3px" title="點名字＝選擇動作" onclick="permNameMenu(event,'${u.rid}','${String(u.name||'').replace(/['"<>]/g,'')}',${u.admin?1:0})">${u.name}</span></td>`
        if(u.admin){ t+=`<td colspan="${COLS}" class="hint" style="text-align:left;padding:5px 10px">管理者＝全部看得見、全部能編輯</td>` }
        else {
          const rowSee=TABS.every(([k])=>!(u.hide&&u.hide[k])), rowEdit=TABS.filter(x=>!x[2]).every(([k])=>!u.tabs||u.tabs[k]!==0)
          const rowSeeAny=TABS.some(([k])=>!(u.hide&&u.hide[k])), rowEditAny=TABS.filter(x=>!x[2]).some(([k])=>!u.tabs||u.tabs[k]!==0) // v4.32.1 半勾
          t+=`<td style="${SEP}padding:4px 6px;text-align:center;white-space:nowrap">${cb(rowSee,`permSet('rowall','${u.rid}',null,'${SEEK}',this.checked,'see')`,u.name+' 整列看得見/全關',rowSeeAny)}｜${cb(rowEdit,`permSet('rowall','${u.rid}',null,'${EDITK}',this.checked,'edit')`,u.name+' 整列能編輯/全關',rowEditAny)}</td>`
          TABS.forEach(([k,lb,so])=>{ t+=`<td style="${SEP}padding:4px 5px;text-align:center">${cb(!(u.hide&&u.hide[k]),`permSet('see','${u.rid}',null,'${k}',this.checked)`,u.name+' 看得見')}</td>`+(so?``:`<td style="padding:4px 5px;text-align:center">${cb(!u.tabs||u.tabs[k]!==0,`permSet('tab','${u.rid}',null,'${k}',this.checked)`,u.name+' 能編輯')}</td>`) })
        }
        t+=`</tr>`
      })
      return t+`</tbody></table></div>`
    })()}
    ${(perm.removed||[]).length?`<div style="margin-top:8px;padding-top:6px;border-top:1px dashed var(--line)"><b style="font-size:13px">🚫 已移除（${perm.removed.length}）</b><span class="hint">　勾選設定都還留著，按復原原樣回來</span>
      ${perm.removed.map(u=>`<div style="padding:3px 0">${u.name} <span class="hint">${u.rts||''} 移除</span> <button class="mini on" style="padding:2px 10px" onclick="permSet('restore','${u.rid}')">↩️ 復原</button></div>`).join('')}</div>`:''}</div>`
}
function permIndFix(box){ box.querySelectorAll('input[data-ind="1"]').forEach(el=>{el.indeterminate=true}) } // v4.32.1 半勾（HTML屬性寫不了只能JS補）
async function settingsLoad(){ // ⚙️ 設定頁（張良 2026-10-01：分頁管理/通知開關/權限管理集中這裡）
  curStore = 'settings'; setTabs('')
  const gb = document.getElementById('tab-gear'); if (gb) gb.className = 'on'
  document.getElementById('upd').textContent = '設定'
  app.innerHTML = `<section><h2>⚙️ 設定</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="mini" style="padding:10px 16px" onclick="const b=document.getElementById('permBox');b.style.display=b.style.display==='none'?'':'none'">🔐 權限設定</button>
      <button class="mini" style="padding:10px 16px" onclick="tabsEdit()">🗂 分頁名稱／排序</button>
      <button class="mini" style="padding:10px 16px" onclick="notifyEdit()">🔔 群組通知開關</button>
      <button class="mini" style="padding:10px 16px" onclick="ddMsgEdit()">📢 DD 自動訊息（發哪個群／話怎麼講）</button>
    </div><div id="permBox" class="hint">權限資料載入中…</div></section>`
  let d; try{ const r = await fetch('/api/mail-sync?menu=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() }catch(e){}
  const box = document.getElementById('permBox'); if (!box) return
  window._permD = (d && d.me && d.me.admin && d.perm) ? d.perm : null // v4.26.4 樂觀更新用的本地快照
  box.innerHTML = window._permD ? permPanelHtml(window._permD) : '<div class="hint">🔐 編輯權限管理：僅管理者（老闆）看得到</div>'
  if (window._permD) permIndFix(box)
  if (window._permKeepOpen) { box.style.display = ''; window._permKeepOpen = 0 }
}
async function prepApply(){
  const r = await fetch('/api/mail-sync?prepapply=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK() }) })
  const j = await r.json().catch(()=>null)
  alert(j&&j.ok ? (j.already?'你已經有編輯權限了':'已送出申請，老闆核准後就能編輯') : (j&&j.error)||'申請失敗')
  menuLoad()
}
async function permSet(op, rid, mode, tab, val, kind){
  // v4.26.4（張良「勾選會卡頓+畫面閃退」治本）：勾選類＝樂觀更新本地立即重畫表格，背景存檔——不再整頁重載(重載會重抓整份菜單資料=卡,permBox又收合=畫面消失)
  const pm = window._permD
  if (pm && (op==='tab' || op==='see' || op==='taball' || op==='rowall')){
    const upd1 = u => { if (op==='tab' || ((op==='taball'||op==='rowall') && kind==='edit')) { u.tabs = u.tabs || {}; u.tabs[tab] = val ? 1 : 0 } else { u.hide = u.hide || {}; if (val) delete u.hide[tab]; else u.hide[tab] = 1 } }
    if (op==='taball') (pm.users||[]).forEach(u=>{ if (!u.admin) upd1(u) })
    else if (op==='rowall') { const u = (pm.users||[]).find(x=>x.rid===rid); if (u) String(tab).split(',').forEach(k9=>{ if (kind==='edit') { u.tabs=u.tabs||{}; u.tabs[k9]=val?1:0 } else { u.hide=u.hide||{}; if (val) delete u.hide[k9]; else u.hide[k9]=1 } }) } // v4.31.0 整列一鍵
    else { const u = (pm.users||[]).find(x=>x.rid===rid); if (u) upd1(u) }
    const box = document.getElementById('permBox'); if (box) { box.innerHTML = permPanelHtml(pm); box.style.display = ''; permIndFix(box) }
    const r = await fetch('/api/mail-sync?preppermset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), op, rid, mode, tab, val, kind }) })
    const j = await r.json().catch(()=>null)
    if (!j || !j.ok) { alert((j&&j.error)||'沒存成功，畫面退回原狀'); window._permKeepOpen = 1; settingsLoad() }
    return
  }
  const r = await fetch('/api/mail-sync?preppermset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), op, rid, mode, tab, val, kind }) })
  const j = await r.json().catch(()=>null)
  if (!j || !j.ok) alert((j&&j.error)||'操作失敗')
  if (curStore === 'settings') { window._permKeepOpen = 1; settingsLoad() } else menuLoad()
}
let mnDragS = null
function menuItemAdd(si){ // 不開視窗：直接在該分類表格長出一列空欄位，填了中文就自動存（張良 2026-10-01）
  const s2 = window._menuD.draft.sections[si]
  s2.items = [...(s2.items||[]), { id: 'mn'+Date.now().toString(36), name: '', en: '', price: 0, note: '' }]
  menuEditSec[si] = true
  menuRender()
  setTimeout(()=>{ const tb=document.querySelectorAll('section table tbody'); },50)
}
function menuItemPurge(id){ // 永久刪除：連原菜單一起移除，不再出現在已刪除區
  const d = window._menuD
  ;(d.base.sections||[]).forEach(s2=>{ s2.items=(s2.items||[]).filter(x=>x.id!==id) })
  ;(d.draft.sections||[]).forEach(s2=>{ s2.items=(s2.items||[]).filter(x=>x.id!==id) })
  menuSave('永久刪除品項', [id])
}
function menuItemShift(si, id, dir){ // 品項 ↑↓ 排序（張良 2026-10-02）
  const items = window._menuD.draft.sections[si].items || []
  const i = items.findIndex(x=>x.id===id), j = i + dir
  if (i < 0 || j < 0 || j >= items.length) return
  const [mv] = items.splice(i, 1); items.splice(j, 0, mv)
  menuSave('搬 ' + (mv.name || '品項'))
}
function menuSecShift(si, dir){ // ↑↓ 搬分類（張良 2026-10-01：拖曳在手機/iPad不順→按鈕最穩）
  const ss = window._menuD.draft.sections, j = si + dir
  if (j < 0 || j >= ss.length) return
  const [mv] = ss.splice(si, 1); ss.splice(j, 0, mv)
  menuEditSec = {}; menuEditSec[j] = true
  menuSave('搬分類 ' + mv.name)
}
// 📋 照菜單圖補官方英文（張良 2026-10-05 上傳 4 張菜單圖）：內建圖上官方中文→英文，遍歷 draft+base(含已刪)用 enMap 一次補；只改英文不動名稱價格
const MENU_EN_OFFICIAL = {
  '經典瑪格麗特':'Classic Margherita','蜂蜜五起司綜合堅果':'Honey Five-Cheese & Mixed Nuts','辣楓糖臘腸培根':'Spicy Maple Pepperoni & Bacon','煙燻BBQ雞肉':'Smoked BBQ Chicken','松露菌菇':'Black Truffle Mushroom','菠菜培根溫泉蛋':'Spinach, Bacon & Onsen Egg',
  '香煎去骨雞腿堡':'Pan-Seared Boneless Chicken Burger','美式牧場炸雞腿堡':'Ranch Fried Chicken Burger','泰式椒麻炸雞腿堡':'Thai Spicy Fried Chicken Burger','大阪燒煎雞腿堡':'Osaka-Style Chicken Burger','松露菌菇炸雞腿堡':'Truffle Mushroom Fried Chicken Burger','川味微辣炸雞腿堡':'Sichuan Spicy Fried Chicken Burger','4oz 100%純牛肉起司堡':'4oz 100% Beef Cheeseburger','8oz 雙層純牛肉起司堡':'8oz Double Beef Cheeseburger',
  '生菜煎蛋越南三明治':'Lettuce and Fried Egg Bánh Mì','BBQ烤豬肉越南三明治':'BBQ Roast Pork Bánh Mì','酥炸雞腿越南三明治':'Crispy Fried Chicken Bánh Mì','烤雞胸越南三明治':'Grilled Chicken Breast Bánh Mì','爐烤牛排越南三明治':'Roast Steak Bánh Mì',
  '川味微辣炸雞 x2':'Sichuan Spicy Fried Chicken x2','玻璃脆殼炸雞 x2':'GROUN:D Fried Chicken x2','松露菌菇義大利麵':'Truffle Mushroom Pasta','經典番茄肉醬義大利麵':'Classic Tomato Meat Sauce Pasta',
  '番茄蔬菜湯':'Tomato & Vegetable Soup','可愛沙拉杯':'Happy Little Salad','薯條':'Fries','酸奶油香煎小洋芋':'Crispy Smashed Baby Potatoes',
  '松露/肉醬薯條':'Truffle / Classic Meat Sauce Fries','雙醬薯條':'Double Sauce Fries','費洛蒙起司薯條':'Animal-Style Fries','肉醬起司小洋芋':'Meat Sauce & Cheese Baby Potatoes','烤地瓜海鹽焦糖冰淇淋':'Roasted Sweet Potato with Salted Caramel Ice Cream',
  '可口可樂 原味/ZERO':'Coca-Cola Original / Zero','南非國寶茶':'Rooibos Tea','自然四季春烏龍':'Taiwan Oolong Tea','台灣有機紅茶':'Org TW Black Tea','美式咖啡':'Americano','國寶鮮奶茶':'Rooibos Milk Tea','經典拿鐵':'Caffè Latte','抹茶/可可拿鐵':'Matcha / Coco Latte',
  // v4.52.7 療癒碗+明太子（張良 2026-10-05「新增菜單 幫補上英文」=保留非下架,這批圖上還沒畫,用系統現有英文一起納入補英文範圍）
  '紐約街頭雞上飯':'NYC Chicken Over Rice','24H爐烤牛肉飯':'NYC Beef Over Rice','GD招牌雙拼飯':'NYC Combo Over Rice','夏威夷BBQ烤豬飯':'Hawaiian BBQ Pork Rice','泰式椒麻炸雞飯':'Thai Spicy Fried Chicken Rice','明太子溫泉蛋義大利麵':'Mentaiko Pasta with Onsen Egg',
}
async function menuFillEnOfficial(){
  const d = window._menuD; if (!d) return
  const nz = s => String(s||'').replace(/\s+/g,'').replace(/％/g,'%').trim()
  const EN2 = {}; for (const [k,v] of Object.entries(MENU_EN_OFFICIAL)) EN2[nz(k)] = v
  const enMap = {}; let n = 0, noMatch = []
  const fill = it => { const e = EN2[nz(it.name)]; if (e && it.id) { enMap[it.id] = e; n++ } else if (it.id) noMatch.push(it.name) }
  ;(d.draft?.sections||[]).forEach(s=>(s.items||[]).forEach(fill))
  ;(d.base?.sections||[]).forEach(s=>(s.items||[]).forEach(fill))
  if (!n) { alert('沒有對應到菜單圖的品項'); return }
  if (!confirm(`照菜單圖補 ${n} 個品項的官方英文嗎？（含已刪除的，只改英文、不動名稱和價格）${noMatch.length?'\n\n圖上沒有、不會動：'+[...new Set(noMatch)].join('、'):''}`)) return
  const btn = document.getElementById('menuFillBtn'); if (btn) { btn.disabled = true; btn.textContent = '補英文中…' }
  try {
    const r = await fetch('/api/mail-sync?menuset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ enMap, token: TK() }) })
    const j = await r.json().catch(()=>null)
    if (j && j.ok) { alert('補好了 '+j.updated+' 項官方英文（含已刪除的）！'); menuLoad() }
    else alert('失敗：' + ((j&&j.error)||'？') + (j&&/登入/.test(j.error||'')?'\n\n→ 先按右上「登入」填 4 位數登入碼再點一次':''))
  } catch(e){ alert('出錯：' + (e.message||e)) }
  finally { const b = document.getElementById('menuFillBtn'); if (b) { b.disabled = false; b.textContent = '照菜單圖補英文' } }
}
// 🌐 自動翻譯英文（張良 2026-10-05「菜單的英文先給自動翻譯功能」）：把所有缺英文的品項用 Claude 翻成道地美式菜名，填回英文欄可再微調
async function menuTransAll(){
  const d = window._menuD; if (!d || !d.draft) return
  const todo = []
  ;(d.draft.sections||[]).forEach((s2,si)=>(s2.items||[]).forEach(i2=>{ if (i2.name && !String(i2.en||'').trim()) todo.push({ si, id: i2.id, name: i2.name }) }))
  if (!todo.length) { alert('沒有缺英文的品項——全部都填好了'); return }
  if (!confirm(`要自動翻譯 ${todo.length} 個缺英文的品項嗎？\n（AI 翻完直接填進英文欄，你可以再微調）`)) return
  const btn = document.getElementById('menuTransBtn'); if (btn) { btn.disabled = true; btn.textContent = '翻譯中…' }
  try {
    const sys = '你是餐飲菜單翻譯專家。把中文菜名翻成簡潔、道地的美式餐廳英文菜名（不要逐字直譯）。範例：紐約街頭雞上飯→NYC Chicken Over Rice、夏威夷BBQ烤豬飯→Hawaiian BBQ Pork Rice、泰式椒麻炸雞飯→Thai Spicy Fried Chicken Rice。只輸出 JSON 陣列 [{"i":編號,"en":"英文菜名"}]，不要任何其他文字、說明或 markdown 標記。'
    const usr = JSON.stringify(todo.map((t,i)=>({ i, name: t.name })))
    const r = await fetch('/api/ai', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ system: sys, messages: [{ role:'user', content: usr }] }) })
    const j = await r.json().catch(()=>null)
    if (!r.ok || !j || !j.content) { alert('翻譯失敗：' + ((j&&j.error)||'AI 沒回應，稍後再試')); return }
    const txt = (j.content||[]).map(c=>c.text||'').join('')
    const m = txt.match(/\[[\s\S]*\]/); if (!m) { alert('翻譯結果看不懂，再試一次'); return }
    const arr = JSON.parse(m[0]); let n = 0
    arr.forEach(x=>{ const t = todo[x.i]; if (t && x.en) { const it = (d.draft.sections[t.si].items||[]).find(y=>y.id===t.id); if (it && !String(it.en||'').trim()) { it.en = String(x.en).trim(); n++ } } })
    if (n) { await menuSave('自動翻譯英文 '+n+' 項'); menuRender(); alert('翻好了 '+n+' 項，英文欄已填入——你可以再微調') }
    else alert('沒有翻出結果，再試一次')
  } catch(e){ alert('翻譯出錯：' + (e.message||e)) }
  finally { const b = document.getElementById('menuTransBtn'); if (b) { b.disabled = false; b.textContent = '自動翻譯英文' } }
}
function menuCell(si, id, f, v){ // v4.57.0 表格每格直接改（onchange=離開格子就存）
  const it = (window._menuD.draft.sections[si].items||[]).find(x=>x.id===id); if(!it) return
  it[f] = (f==='price'||f==='np') ? (+String(v).replace(/[^0-9]/g,'')||0) : String(v).trim()
  tcSet('menu', window._menuD) // 本地快取先更新
  // 關鍵治本（張良「打字卡、刪字跑回來」）：不再每格存完就 menuRender()+menuLoad() 整頁重畫＋回抓
  // 回抓會把 KV 還沒同步的舊值蓋回你剛改/剛刪的字＝「跑回來」；整頁重畫又會打斷你下一格的打字＝「卡」。
  // 改成：本地即時生效＋防抖靜默存檔（700ms 內多格編輯併成一次 POST，不重畫、不回抓）。
  menuSaveSoon('改 '+it.name+' '+({name:'中文',en:'英文',price:'售價',np:'新售價',note:'備註'}[f]||f))
}
let _mnSaveT = null, _mnSaveWhat = ''
function menuSaveSoon(what){ // 防抖：離開格子後 700ms 沒再動才送；期間再改就重新計時＝打字全程零網路零重畫
  _mnSaveWhat = what
  clearTimeout(_mnSaveT)
  _mnSaveT = setTimeout(()=>{ _mnSaveT = null; mnQuietSave(_mnSaveWhat) }, 700)
}
async function mnQuietSave(what){ // 靜默存：只 POST，不 menuRender、不 menuLoad（不打斷打字、刪字不回彈）
  const d = window._menuD; if (!d || !d.draft) return
  try {
    const r = await fetch('/api/mail-sync?menuset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ draft: d.draft, what, token: TK() }) })
    const j = await r.json().catch(()=>null)
    if (!j || !j.ok) alert((j&&j.error)||'儲存失敗——網路不穩，請再改一下或重整')
  } catch(e){ /* 下次編輯會再送整份 draft，不中斷使用 */ }
}
function menuFlushCell(){ if (_mnSaveT) { clearTimeout(_mnSaveT); _mnSaveT = null; mnQuietSave(_mnSaveWhat) } } // 切頁/結構變更前先把待存的格子送出
// ⠿ 拖曳排序（張良 2026-10-06：品項＋分類都要拖、要順）：pointer 事件＝滑鼠/觸控(iPad)共用，拖的時候直接搬 DOM＝流暢，放手才寫資料＋存
let _mnDrag = null
function mnDragStart(e, type, si){
  const handle = e.currentTarget
  const el = type==='sec' ? handle.closest('.mnSec') : handle.closest('tr')
  if (!el || !el.parentNode) return
  e.preventDefault()
  _mnDrag = { type, si, el, parent: el.parentNode }
  el.style.opacity = '.55'; el.style.boxShadow = '0 6px 18px rgba(0,0,0,.4)'
  document.body.style.userSelect = 'none'
  try { handle.setPointerCapture && handle.setPointerCapture(e.pointerId) } catch(_){}
  window.addEventListener('pointermove', mnDragMove)
  window.addEventListener('pointerup', mnDragEnd)
  window.addEventListener('pointercancel', mnDragEnd)
}
function mnDragMove(e){
  if (!_mnDrag) return
  const { el, parent, type } = _mnDrag
  const y = e.clientY
  const sibs = [...parent.children].filter(c => type==='sec' ? c.classList && c.classList.contains('mnSec') : c.tagName==='TR')
  let target = null
  for (const s of sibs){ if (s===el) continue; const r = s.getBoundingClientRect(); if (y < r.top + r.height/2) { target = s; break } }
  if (target){ if (target!==el && el.nextElementSibling!==target) parent.insertBefore(el, target) }
  else if (parent.lastElementChild!==el) parent.appendChild(el)
}
function mnDragEnd(){
  if (!_mnDrag) return
  const { type, si, el, parent } = _mnDrag
  el.style.opacity = ''; el.style.boxShadow = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', mnDragMove)
  window.removeEventListener('pointerup', mnDragEnd)
  window.removeEventListener('pointercancel', mnDragEnd)
  _mnDrag = null
  const d = window._menuD; if (!d || !d.draft) return
  if (type==='sec'){
    const order = [...parent.children].filter(c=>c.classList && c.classList.contains('mnSec')).map(c=>+c.dataset.si)
    if (order.join()=== order.slice().sort((a,b)=>a-b).join()) return // 沒拖動（只點了一下）＝不存不重畫
    const ss = d.draft.sections
    d.draft.sections = order.map(i=>ss[i]).filter(Boolean)
    menuEditSec = {} // 索引全變了，清掉逐類編輯狀態避免錯位
    menuSave('拖曳排序分類')
  } else {
    const order = [...parent.children].filter(c=>c.tagName==='TR').map(c=>c.dataset.id)
    const items = d.draft.sections[si] && d.draft.sections[si].items || []
    if (order.join('|') === items.map(it=>it.id).join('|')) return // 順序沒變＝不存不重畫
    const map = {}; items.forEach(it=>map[it.id]=it)
    d.draft.sections[si].items = order.map(id=>map[id]).filter(Boolean)
    menuSave('拖曳排序品項')
  }
}
function menuSecDrop(to){ // 分類拖曳排序
  if (mnDragS==null || mnDragS===to) { mnDragS=null; return }
  const ss = window._menuD.draft.sections
  const [mv] = ss.splice(mnDragS,1); ss.splice(to,0,mv); mnDragS=null
  menuSave('搬分類 '+mv.name)
}
function menuKey(e){ // v4.57.0 張良「不能直接按 enter」：Enter=存這格並跳下一格（像試算表）；Esc=放棄焦點
  if (e.isComposing || e.keyCode === 229) return // v4.57.2 中文輸入法選字的 Enter 不攔（否則「桂花」還沒落格就被帶到下一格）——要再按一次 Enter 才跳格
  if (e.key === 'Enter') {
    e.preventDefault()
    const inp = e.target, tb = inp.closest('table')
    inp.blur() // 觸發 onchange→menuCell 存檔
    if (tb) { const ins = [...tb.querySelectorAll('input')]; const nx = ins[ins.indexOf(inp)+1]; if (nx) { nx.focus(); nx.select && nx.select() } }
  } else if (e.key === 'Escape') { e.target.blur() }
}
async function menuSave(what, purge){ // 結構變更（增刪品項/分類、排序）：樂觀先畫＝不閃不彈回；成功不再整頁回抓
  clearTimeout(_mnSaveT); _mnSaveT = null // 併入待存的格子編輯（都在同一份 draft 裡，這次 POST 一起送）
  const d = window._menuD
  tcSet('menu', d); menuRender() // 先畫＝拖曳/增刪立即定位，不等網路
  try {
    const r = await fetch('/api/mail-sync?menuset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ draft: d.draft, what, token: TK(), ...(purge&&purge.length?{purge}:{}) }) })
    const j = await r.json().catch(()=>null)
    if (!j || !j.ok) { alert((j&&j.error)||'儲存失敗'); menuLoad() } // 只有失敗才回抓校正（避免 KV 延遲把剛做的蓋掉）
  } catch(e){ alert('儲存失敗，請重試'); menuLoad() }
}
function menuItemForm(si, id){
  const d = window._menuD, s2 = d.draft.sections[si], it = id ? (s2.items||[]).find(x=>x.id===id) : null
  const ov = document.createElement('div'); ov.id='mnOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  const ip = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;font-family:inherit;margin-bottom:6px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:400px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">${it?'✏️ 編輯':'＋ 新增'}品項｜${s2.name}</div>
    <input id="mnName" placeholder="品名" value="${it?it.name.replace(/"/g,'&quot;'):''}" style="${ip}">
    <input id="mnEn" placeholder="英文（可空）" value="${it?(it.en||'').replace(/"/g,'&quot;'):''}" style="${ip}">
    <input id="mnPrice" type="number" placeholder="價格" value="${it?it.price:''}" style="${ip}">
    <input id="mnNote" placeholder="註記（周一/主餐/#無咖啡因…可空）" value="${it?(it.note||'').replace(/"/g,'&quot;'):''}" style="${ip}">
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('mnOv').remove()">取消</button>
    <button class="mini on" style="padding:9px 18px" onclick="menuItemSave(${si},'${id||''}')">儲存</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function menuItemSave(si, id){
  const g2 = x => (document.getElementById(x)||{}).value||''
  const name = g2('mnName').trim(), en = g2('mnEn').trim(), price = +g2('mnPrice')||0, note = g2('mnNote').trim()
  if (!name) { alert('品名空的'); return }
  const s2 = window._menuD.draft.sections[si]
  const o = document.getElementById('mnOv'); if (o) o.remove()
  if (id) { const it = (s2.items||[]).find(x=>x.id===id); if (it) { it.name=name; it.en=en; it.price=price; it.note=note } }
  else s2.items = [...(s2.items||[]), { id: 'mn'+Date.now().toString(36), name, en, price, note }]
  menuSave((id?'改 ':'加 ')+name)
}
function menuItemDel(si, id){
  const s2 = window._menuD.draft.sections[si]
  const it = (s2.items||[]).find(x=>x.id===id)
  s2.items = (s2.items||[]).filter(x=>x.id!==id)
  menuSave('刪 '+(it?it.name:''))
}
function menuItemRestore(id){
  const d = window._menuD
  const b = menuFlat(d.base)[id]
  if (!b) return
  let s2 = d.draft.sections.find(x=>x.name===b.sec)
  if (!s2) { s2 = { name: b.sec, note: (d.base.sections.find(x=>x.name===b.sec)||{}).note||'', items: [] }; d.draft.sections.push(s2) }
  s2.items.push({ id: b.id, name: b.name, price: b.price, note: b.note||'' })
  menuSave('復原 '+b.name)
}
function menuSecForm(si){
  const d = window._menuD, s2 = si!=null ? d.draft.sections[si] : null
  const nm = prompt(s2?'分類名稱':'新分類名稱', s2?s2.name:'')
  if (nm==null || !nm.trim()) return
  const note = prompt('分類註記（可空，例：主餐／4選1）', s2?(s2.note||''):'')
  if (s2) { s2.name = nm.trim(); s2.note = (note||'').trim() }
  else d.draft.sections.push({ name: nm.trim(), note: (note||'').trim(), items: [] })
  menuSave((s2?'改分類 ':'新分類 ')+nm.trim())
}
function menuSecDel(si){
  const d = window._menuD
  const nm = d.draft.sections[si].name
  d.draft.sections.splice(si,1)
  menuSave('刪分類 '+nm)
}
function menuSecCombo(si){ // v4.58.0 設這類的套餐基準價（張良）：售價=基準→「套餐內含」、高於→「套餐+差額」；0/空=這類不開套餐
  const d = window._menuD, s2 = d.draft.sections[si]
  const v = prompt('這類「'+s2.name+'」的套餐基準價（元）\n\n・品項售價＝這個價 → 顯示「套餐內含」\n・品項售價＞這個價 → 顯示「套餐 +差額」\n・留空或 0 → 這類不開套餐', s2.combo||'')
  if (v==null) return
  const n = Math.max(0, Math.round(+String(v).replace(/[^0-9]/g,'')||0))
  s2.combo = n || ''
  menuSave((n?'設套餐價 $'+n+' ':'關套餐 ')+s2.name)
}
function menuItemCombo(si, id){ // 切換這品項「給/不給套餐」
  const it = (window._menuD.draft.sections[si].items||[]).find(x=>x.id===id); if(!it) return
  it.noCombo = it.noCombo ? 0 : 1
  menuSave((it.noCombo?'不給套餐 ':'納入套餐 ')+it.name)
}
function menuNoteEdit(){
  const d = window._menuD
  const v = prompt('套餐規則／菜單說明', d.draft.note||'')
  if (v==null) return
  d.draft.note = v.trim()
  menuSave('改套餐規則')
}
// ── 圖片小圖預覽（張良 2026-09-22：不開新分頁——縮圖點了頁內放大，再點關閉）──
function imgView(u){
  const ov = document.createElement('div')
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,16,30,.82);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<img src="${u}" style="max-width:94vw;max-height:88vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.5)">`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
// ── 今日事項（張良 2026-09-22：看板最上面＝今天該做的事——任務(排今天/🚩/處理中)、待收貨、今天班表；點行跳分頁）──
function todayRender(){
  const el = document.getElementById('todaysec'); if (!el) return
  const today = todayTpe(), md = today.slice(5)
  const lb = window._lbD || tcGet('lb'), buy = window._buyD || tcGet('buy'), sh = (window._shiftD && window._shiftD.ym===today.slice(0,7)) ? window._shiftD : tcGet('shift_'+today.slice(0,7))
  const rows = []
  // 個人化（張良 2026-10-01：每個人看到自己的任務，我會指派）：綁定者只列 claimBy=自己 的任務；未綁定（店內公用裝置）列全部
  const myN = (lb && lb.me && lb.me.name) || null
  const mine = (x) => !myN || x.claimBy === myN
  const openIss = ((lb||{}).issues||[]).filter(x=>x.status!=='done')
  openIss.filter(mine).filter(x=>x.due && (x.due.includes(md)||x.due.includes(today)||/今天|今日/.test(x.due))).forEach(x=>rows.push({ic:'⏰',tx:`任務排今天：${x.text||'（附件）'}${x.claimBy?`（${x.claimBy}）`:''}`,go:"taskEmbed()"}))
  openIss.filter(mine).filter(x=>x.flag && !(x.due&&(x.due.includes(md)||x.due.includes(today)))).forEach(x=>rows.push({ic:'🚩',tx:`重點任務：${x.text||'（附件）'}${x.claimBy?`（${x.claimBy}）`:''}`,go:"taskEmbed()"}))
  const pendPub = openIss.filter(x=>x.pub==='pending').length
  if (pendPub && lb && lb.me && lb.me.approver) rows.push({ic:'🕐',tx:`${pendPub} 筆回報等確認發布`,go:"pubPendOpen()"}) // v4.58.5 治本：原 go=taskEmbed() 跑到 tasks.js(sp_team_ 主App任務)錯資料域→點進去空的;sop_issues 審核UI(taskLoad)是孤兒無入口,審核只能靠 LINE 舊私訊按鈕。改開 pubPendOpen() modal 就地逐筆發布/保留/刪除;限 approver(只有審核人能處理,別人看了也 403)
  const inbound = ((buy||{}).list||[]).filter(x=>x.status==='bought'||x.status==='done')
  inbound.forEach(x=>rows.push({ic:'📦',tx:`待收貨：${x.text||'（附件）'}${x.doneBy?`（${x.doneBy}買的）`:''}——收到請拍照確認`,go:"buyLoad()"}))
  const shToday = ((sh||{}).sched||[]).filter(x=>x.date===today)
  if (shToday.length) rows.push({ic:'📅',tx:`今天班表：${shToday.map(x=>`${x.name} ${x.start}-${x.end}${x.pos?`(${x.pos})`:''}`).join('、')}`,go:"shiftLoad()"})
  let s = `<section style="border:1.5px solid var(--primary);"><h2>今日事項 <span class="hint">${today.slice(5)}${(window._lbD&&window._lbD.me&&window._lbD.me.name)?'・只顯示指派給你的任務':'・今天該做的都在這'}</span></h2>`
  s += rows.length ? rows.map(r=>`<div onclick="${r.go}" style="cursor:pointer;display:flex;gap:8px;align-items:flex-start;background:var(--soft);border-radius:9px;padding:8px 11px;margin-top:6px;font-size:14px"><span style="flex:1;font-weight:600">${r.tx}</span><span class="hint">›</span></div>`).join('')
    : `<div class="mut" style="font-size:14px">今天沒有排定事項 🎉（任務排時間/採購已購買/今天班表 會自動出現在這）</div>`
  s += `</section>`
  el.innerHTML = s
}
// 🕐 等你確認發布（張良 2026-10-07：首頁「N 筆回報等確認發布」點進去 → 這裡逐筆發布/保留/刪除）
// 真因：sop_issues 的審核發布 UI(p03 taskLoad/taskCard)是孤兒無入口，審核只能靠回報當下的 LINE 私訊按鈕；
//       首頁計數原導向 taskEmbed()=tasks.js(sp_team_ 主App任務，另一個資料域)→永遠空的。這裡直接讀 lb.issues 就地處理。
function pubPendOpen(){
  const lb = window._lbD || tcGet('lb')
  if (!lb || !lb.me || !lb.me.approver) { alert('只有審核人能確認發布'); return }
  const list = (lb.issues||[]).filter(x=>x.status!=='done' && x.pub==='pending')
  const body = list.length ? list.map(x=>`
    <div style="background:var(--soft);border:1.5px solid #E8B931;border-radius:12px;padding:11px 13px;margin-bottom:10px">
      <div style="font-weight:800;color:#A85C26">🕐 ${x.st?`【${x.st}】`:''}${(x.text||'（附件）').replace(/</g,'&lt;')}</div>
      <div class="hint" style="margin:3px 0 8px">回報：${x.by||''}・${x.ts||''}${(x.media||[]).map((m,i)=>` <a href="${m}" target="_blank">📎${i+1}</a>`).join('')}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="mini on" onclick="pubReview('${x.id}','go')">📣 發布到群</button>
        <button class="mini" onclick="pubReview('${x.id}','hold')">📥 保留不進群</button>
        <button class="mini" style="color:var(--red)" onclick="if(confirm('刪除這筆回報？'))pubReview('${x.id}','del')">🗑 刪除</button>
      </div>
    </div>`).join('') : '<div class="mut" style="padding:8px">沒有等發布的回報了 🎉</div>'
  const ov = document.createElement('div'); ov.id='pubPendOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,16,30,.82);z-index:60;display:flex;align-items:flex-start;justify-content:center;padding:28px 14px;overflow:auto'
  ov.innerHTML = `<div style="background:var(--card);border-radius:14px;max-width:460px;width:100%;padding:16px;box-shadow:0 10px 50px rgba(0,0,0,.5)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><b style="font-size:16px">🕐 等你確認發布</b><span class="hint">夥伴回報的問題——決定要不要進群</span><button class="mini" style="margin-left:auto" onclick="document.getElementById('pubPendOv').remove()">✕ 關閉</button></div>
    ${body}</div>`
  ov.onclick = (e)=>{ if(e.target===ov) ov.remove() }
  document.body.appendChild(ov)
}
async function pubReview(id, op){
  const r = await fetch('/api/mail-sync?sopissue=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, op:'pub', val:op, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (!d || !d.ok) { alert((d&&d.error)||'失敗（只有審核人能確認發布）'); return }
  await lbFetch(1) // 重抓最新 issues（refreshView 會跑 sopLoad 亂跳頁，這裡自己重抓）
  const ov = document.getElementById('pubPendOv'); if (ov) ov.remove()
  pubPendOpen(); todayRender() // 重開視窗顯示剩餘 + 更新首頁計數
}
// ── 🔖 分頁自訂（張良 2026-09-22：名稱＋排序可編輯，存 pm_prep_tabs 全裝置同步）──
