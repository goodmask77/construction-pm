// ── 🪪 夥伴名冊 v4.34.2（張良 2026-10-04：主管限定；標題資料對齊/全部AB GD切換/欄位排序/生日提醒卡；生日前一週 cron 發 ABpeople 群）──
// 資料端 hrmaster 口在伺服器就擋，非主管連資料都拿不到；來源＝勞工名冊 Google Sheet（口香糖=A Beach、喬亞=GROUN:D）
let hrmQ = '', hrmCo = 'all', hrmSort = { k: '', dir: 1 }
// 📎 入職文件標準清單 v4.35.0（台灣餐飲業；guardian 只有未成年需要）
const HR_DOCS = [ // v4.35.1 張良瘦身：大頭照不用、緊急聯絡人=清單文字欄、勞健保有身分證即可
  { k:'contract',  n:'勞動契約' },
  { k:'idcard',    n:'身分證影本（正反面）' },
  { k:'bank',      n:'存摺封面影本（薪轉）' },
  { k:'health',    n:'體檢報告' },
  { k:'hygiene',   n:'衛生教育訓練證明' },
  { k:'guardian',  n:'法定代理人同意書', minor:1 },
]
function hrmDocStat(x){ const need = HR_DOCS.filter(dk=>!dk.minor || (+x.age||99)<18)
  const got = need.filter(dk=>(((x.docs||{})[dk.k]||{}).files||[]).length).length
  return { got, need: need.length }
}
async function hrmLoad(){
  curStore = 'hrm'; setTabs('hrm')
  const hb = document.getElementById('tab-hrm'); if (hb) hb.className = 'on'
  document.getElementById('upd').textContent = '夥伴名冊'
  app.innerHTML = '<section><h2>🪪 夥伴名冊</h2><div class="hint">讀取中…</div></section>'
  let d = null
  try { const r = await fetch('/api/mail-sync?hrmaster=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '') + '&r=' + Date.now()); d = await r.json() } catch(e){}
  if (!d || !d.ok) {
    app.innerHTML = `<section><h2>🪪 夥伴名冊</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">🔒 ${(d&&d.error)||'要先登入才能看（私訊 DD「登入碼」）'}</div></section>`
    return
  }
  window._hrmD = d
  hrmRender()
}
async function hrmPendAct(id, action, name){ // v4.60 名冊待審核：核准加入／刪除
  if (action==='approve' && !confirm(`把「${name}」核准加入 GD 名冊？（之後可在名冊補部門/職務/生日等）`)) return
  if (action==='reject' && !confirm(`確定刪除「${name}」？會一併移除他的帳號，對方要重新報到。`)) return
  const r = await fetch('/api/mail-sync?hrmpendset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), id, action }) })
  const d = await r.json().catch(()=>null)
  if (!d || !d.ok) { alert((d&&d.error)||'處理失敗'); return }
  hrmLoad() // 重抓：核准的人進表、待審核清掉
}
function hrmSortBy(k){ // v4.34.4 張良「排序畫面不要跳不要閃 手機滑到右邊按排序會跑回左邊」：記住捲動位置重畫後原位還原
  if (hrmSort.k === k) hrmSort.dir = -hrmSort.dir; else hrmSort = { k, dir: 1 }
  const scrs = [...document.querySelectorAll('#app .scroll')].map(el=>el.scrollLeft)
  const winY = window.scrollY
  hrmRender()
  requestAnimationFrame(()=>{ const after=[...document.querySelectorAll('#app .scroll')]; after.forEach((el,i)=>{ if(scrs[i]!=null) el.scrollLeft=scrs[i] }); window.scrollTo(0,winY) })
}
function hrmRender(){
  const d = window._hrmD; if (!d || curStore !== 'hrm') return
  const isAB = x => /A Beach/.test(x.co||'')
  let rows = (d.rows||[]).filter(x => !hrmQ || (x.name||'').includes(hrmQ) || (x.dept||'').includes(hrmQ) || (x.title||'').includes(hrmQ) || (x.emer||'').includes(hrmQ))
  if (hrmCo === 'ab') rows = rows.filter(isAB)
  if (hrmCo === 'gd') rows = rows.filter(x => !isAB(x))
  // 排序（點欄頭）；預設照清冊原順序
  if (hrmSort.k) {
    const k = hrmSort.k
    rows = rows.slice().sort((a,b)=>{
      let va = a[k] ?? '', vb = b[k] ?? ''
      if (k === 'age') { va = +va||0; vb = +vb||0; return (va-vb)*hrmSort.dir }
      if (k === 'bday') { va = String(a.birth||'').slice(5); vb = String(b.birth||'').slice(5); return (va<vb?-1:va>vb?1:0)*hrmSort.dir }
      if (k === 'co') { va = /A Beach/.test(a.co||'')?'AB':'GD'; vb = /A Beach/.test(b.co||'')?'AB':'GD'; return (va<vb?-1:va>vb?1:0)*hrmSort.dir }
      return (String(va)<String(vb)?-1:String(va)>String(vb)?1:0)*hrmSort.dir
    })
  }
  // 🎂 生日提醒（接下來30天；本週內金色醒目）
  const todayMs = (()=>{ const t = new Date(Date.now()+8*3600e3); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) })()
  const upcoming = (d.rows||[]).map(x=>{
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.birth||'')) return null
    const t0 = new Date(todayMs)
    let nb = Date.UTC(t0.getUTCFullYear(), +x.birth.slice(5,7)-1, +x.birth.slice(8,10))
    if (nb < todayMs) nb = Date.UTC(t0.getUTCFullYear()+1, +x.birth.slice(5,7)-1, +x.birth.slice(8,10))
    const days = Math.round((nb-todayMs)/86400e3)
    return days <= 30 ? { ...x, days, md: x.birth.slice(5).replace('-','/') } : null
  }).filter(Boolean).sort((a,b)=>a.days-b.days)
  const bdaySet = {}
  upcoming.forEach(x=>{ bdaySet[x.co+'|'+x.name]=x.days })
  const IN9 = (x,f,w,alignL)=>`<input value="${String(x[f]??'').replace(/"/g,'&quot;')}" style="width:${w}px;padding:3px 5px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:12.5px;text-align:${alignL?'left':'center'}" onchange="hrmSet('${(x.co||'').replace(/'/g,'')}','${(x.name||'').replace(/'/g,'')}','${f}',this.value)">`
  const coBtn = (v,lb)=>`<button class="mini${hrmCo===v?' on':''}" style="padding:6px 14px;font-weight:800" onclick="hrmCo='${v}';hrmRender()">${lb}</button>`
  let h = `<section><h2>🪪 夥伴名冊 <span class="hint">含個資請勿截圖外傳｜資料日期 ${String(d.updatedAt||'').slice(0,10)}</span></h2>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      ${coBtn('all','全部')}${coBtn('ab','A Beach')}${coBtn('gd','GROUN:D')}
      <input value="${hrmQ.replace(/"/g,'&quot;')}" placeholder="搜姓名／部門／職務" style="padding:8px 12px;border:1.5px solid var(--line);border-radius:10px;font-size:14.5px;width:200px;background:var(--card);color:var(--ink)" oninput="hrmQ=this.value;hrmRender()">
      <span class="hint">${rows.length} 人</span>
      ${d.canEdit?`<button class="mini${window._hrmEdit?' on':''}" style="padding:6px 14px;font-weight:800" onclick="window._hrmEdit=!window._hrmEdit;hrmRender()">${window._hrmEdit?'✓ 完成編輯':'✏️ 編輯'}</button>`:''}
      <button class="mini" style="padding:6px 14px;font-weight:800" onclick="hrmLib()">🗂 文件庫</button>
      ${d.canEdit&&window._hrmEdit?`<button class="mini" style="padding:6px 12px" onclick="hrmTitleOpts()">職務選單</button><button class="mini" style="padding:6px 12px" onclick="hrmAdd('ab')">＋ AB 加人</button><button class="mini" style="padding:6px 12px" onclick="hrmAdd('gd')">＋ GD 加人</button><button class="mini" style="padding:6px 12px" onclick="hrmColOrder()">欄位排序</button>`:''}
    </div>`
  if ((d.pending||[]).length) { // v4.60 LINE 報到新人（kb_roster onboarding）在名冊頁顯示＋核准
    h += `<div style="background:#182617;border:1.5px solid var(--green);border-radius:12px;padding:12px 14px;margin-bottom:12px">
      <b style="color:var(--green)">🆕 待審核・LINE 報到新人（${d.pending.length}）</b>
      <div class="hint" style="margin:3px 0 9px">這些人用 LINE 自助報到了，還沒進正式名冊。確認是你要的員工→「核准加入名冊」；不認識→刪除。</div>
      <div style="display:flex;flex-direction:column;gap:8px">
      ${d.pending.map(p=>`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 12px">
        <b style="font-size:15px">${p.name}</b>
        <span class="hint" style="font-size:12.5px">報到 ${String(p.onboardAt||'').slice(0,10)||'—'}・契約${p.contractSigned?'已簽 ✓':'未簽'}${p.inMaster?'・⚠️名冊已有同名':''}</span>
        ${d.canEdit?`<span style="margin-left:auto;display:inline-flex;gap:7px;flex-wrap:wrap"><button class="mini" style="padding:6px 13px;color:#fff;background:var(--green);border-color:transparent;font-weight:800" onclick="hrmPendAct('${p.id}','approve','${(p.name||'').replace(/'/g,'')}')">核准加入名冊</button><button class="mini" style="padding:6px 12px;color:var(--red)" onclick="hrmPendAct('${p.id}','reject','${(p.name||'').replace(/'/g,'')}')">不是員工・刪除</button></span>`:'<span class="hint" style="margin-left:auto">（主管才能核准）</span>'}
      </div>`).join('')}
      </div></div>`
  }
  if (upcoming.length) {
    h += `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:10px 13px;margin-bottom:12px">
      <b>🎂 生日提醒（接下來 30 天）</b> <span class="hint">生日前一週 D 哥會自動發 ABpeople 群</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:7px">
      ${upcoming.map(x=>`<span style="display:inline-flex;gap:6px;align-items:center;background:var(--soft);border:1.5px solid ${x.days<=7?'#D4A72C':'var(--line)'};border-radius:10px;padding:5px 11px;font-size:13.5px;${x.days<=7?'box-shadow:0 0 8px rgba(212,167,44,.35);':''}">
        <b>${x.md}</b> ${x.name} <span class="hint" style="font-size:12px">${/A Beach/.test(x.co)?'AB':'GD'}・${x.days===0?'🎉 今天！':x.days+'天後'}</span></span>`).join('')}
      </div></div>`
  }
  // 欄位＝資料驅動 v4.35.1：順序可自訂（⚙️欄位排序）；體檢文字欄退役（內容看 📎 體檢報告 note）
  const arrow = k => `<span style="display:inline-block;width:12px;text-align:center;font-size:10px">${hrmSort.k===k?(hrmSort.dir>0?'▲':'▼'):''}</span>`
  const LOCK_I9 = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="vertical-align:-2px"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  const topts = d.titleOpts || ['正職','PT']
  const SEL9 = (x)=>`<select style="padding:3px 4px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:12.5px" onchange="hrmSet('${(x.co||'').replace(/'/g,'')}','${(x.name||'').replace(/'/g,'')}','title',this.value)">${[...new Set([x.title,...topts])].filter(Boolean).map(o9=>`<option ${o9===x.title?'selected':''}>${o9}</option>`).join('')}</select>`
  const tenOf = x => { if (!x.onboard) return ''; const ms = Date.now() - new Date(x.onboard).getTime(); const y9 = ms/31557600000; return y9 >= 1 ? (Math.round(y9*10)/10)+'年' : Math.max(1,Math.round(ms/2629800000))+'個月' }
  const ed0 = window._hrmEdit
  const HRM_COLS = [
    { k:'name', lb:'姓名', al:'left', stick:1, td:(x)=>`${ed0?IN9(x,'name',70,1):(x.name||'')}${bdaySet[x.co+'|'+x.name]!=null?' 🎂':''}`, w:800 },
    { k:'co', lb:'店', al:'center', onlyAll:1, td:(x)=>`<b>${/A Beach/.test(x.co)?'AB':'GD'}</b>` },
    { k:'dept', lb:'部門', al:'center', td:(x)=>ed0?IN9(x,'dept',56):(x.dept||'—') },
    { k:'title', lb:'職務', al:'center', td:(x)=>ed0?SEL9(x):(x.title||'—') },
    { k:'onboard', lb:'到職日', al:'center', td:(x)=>ed0?IN9(x,'onboard',92):(x.onboard||'—') },
    { k:'ten', lb:'年資', al:'center', sortK:'onboard', td:(x)=>`<span class="hint">${tenOf(x)||'—'}</span>` },
    { k:'bday', lb:'生日', al:'center', td:(x)=>ed0?IN9(x,'birth',92):(x.birth||'—') },
    { k:'age', lb:'年齡', al:'center', td:(x)=>String(x.age||'—') },
    { k:'sex', lb:'性別', al:'center', td:(x)=>ed0?IN9(x,'sex',32):(x.sex||'—') },
    { k:'nid', lb:'身分證字號', al:'center', nosort:1, td:(x)=>`<span style="font-family:ui-monospace,monospace;letter-spacing:.5px">${ed0&&d.idCan?IN9(x,'nid',104):(x.nid||'—')}</span>` },
    { k:'emer', lb:'緊急聯絡人', al:'left', td:(x)=>ed0?IN9(x,'emer',120,1):(x.emer||'—') },
    { k:'docs', lb:'📎 文件', al:'center', nosort:1, td:(x)=>{ const st9=hrmDocStat(x); return `<button class="mini" style="padding:2px 10px;font-weight:800;color:${st9.got>=st9.need?'var(--green)':'#E8A657'}" onclick="hrmDocs('${(x.co||'').replace(/'/g,'')}','${(x.name||'').replace(/'/g,'')}')">${st9.got}/${st9.need}</button>${ed0?` <button class="mini" style="padding:1px 7px;color:var(--red)" onclick="hrmDel('${(x.co||'').replace(/'/g,'')}','${(x.name||'').replace(/'/g,'')}')">刪</button>`:''}` } },
  ]
  const ordK = [...(d.colOrder||[]).filter(k=>HRM_COLS.some(c=>c.k===k)), ...HRM_COLS.map(c=>c.k).filter(k=>!(d.colOrder||[]).includes(k))]
  const withCo = hrmCo === 'all'
  const colsR = ordK.map(k=>HRM_COLS.find(c=>c.k===k)).filter(c=>c && (!c.onlyAll || withCo))
  const thOf = c => {
    if (c.k==='nid') return `<th style="padding:4px 7px;text-align:center;white-space:nowrap;user-select:none">身分證字號 ${d.idLock ? `<span title="名單制：打勾的人才看得到這一欄（點我設定）" style="cursor:pointer;color:#D4A72C" onclick="hrmIdLock()">${LOCK_I9}</span>` : (d.idCan ? '' : `<span class="hint" title="你沒有檢視這欄的權限">${LOCK_I9}</span>`)}</th>`
    const sk = c.nosort ? '' : (c.sortK||c.k)
    return `<th class="${c.stick?'hrmStick':''}" style="padding:4px 7px;text-align:${c.al};white-space:nowrap;user-select:none${sk?';cursor:pointer':''}" ${sk?`onclick="hrmSortBy('${sk}')" title="點我排序"`:''}>${c.lb}${sk?arrow(sk):''}</th>`
  }
  const rowHtml = (x)=>{
    const bd9 = bdaySet[x.co+'|'+x.name]
    return `<tr ${bd9!=null?'class="bdayGlow" title="🎂 '+(bd9===0?'今天生日！':bd9+' 天後生日')+'"':''} style="border-top:1px solid var(--line);font-size:13px">${colsR.map(c=>`<td class="${c.stick?'hrmStick':''}" style="padding:4px 7px;text-align:${c.al};white-space:nowrap${c.k==='name'?';font-weight:800':''}">${c.td(x)}</td>`).join('')}</tr>`
  }
  h += `<div class="scroll"><table style="border-collapse:collapse;width:100%"><thead><tr>${colsR.map(thOf).join('')}</tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`
  h += `<div class="hint" style="margin-top:10px">來源：勞工名冊（Google Sheet）・要更新跟 D 哥說「更新夥伴名冊」即可重新匯入</div></section>`
  app.innerHTML = h
}
// 🔒 身分證欄名單彈窗（v4.41.2）：勾選誰看得到；管理者固定看得到不可取消
function hrmIdLock(){
  const d = window._hrmD; if (!d || !d.idLock) return
  window._idlSel = new Set(d.idLock.rids || [])
  const ov = document.createElement('div'); ov.id = 'idlOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,22,.55);z-index:70;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:360px;width:100%;max-height:80vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:4px">身分證字號欄・檢視名單</div>
    <div class="hint" style="margin-bottom:10px">打勾的人才看得到這一欄；沒勾的主管開清冊時這欄顯示「—」（伺服器端直接不給資料）</div>
    ${(d.idLock.people || []).map(p=>`<label style="display:flex;gap:8px;align-items:center;padding:7px 4px;border-top:1px solid var(--line);cursor:pointer${p.admin?';opacity:.55':''}">
      <input type="checkbox" ${p.admin ? 'checked disabled' : (window._idlSel.has(p.rid) ? 'checked' : '')} onchange="this.checked?window._idlSel.add('${p.rid}'):window._idlSel.delete('${p.rid}')">
      <span style="font-weight:700">${p.name||''}</span>${p.admin?'<span class="hint">管理者（固定可看）</span>':''}</label>`).join('')}
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="mini" style="padding:8px 14px" onclick="document.getElementById('idlOv').remove()">取消</button>
      <button class="mini on" style="padding:8px 18px" onclick="hrmIdLockSave()">✓ 儲存</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function hrmIdLockSave(){
  const r = await fetch('/api/mail-sync?hridlock=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), rids: [...(window._idlSel||[])] }) })
  const j = await r.json().catch(()=>null)
  const o = document.getElementById('idlOv'); if (o) o.remove()
  if (!j || !j.ok) { alert((j && j.error) || '儲存失敗'); return }
  hrmLoad() // 重抓＝名單即時生效
}

// ✏️ 編輯（v4.34.3）：主管限定、每筆留痕；改生日會自動重算年齡
async function hrmUp(body){
  const r = await fetch('/api/mail-sync?hrmasterup=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...body, token: TK() }) }).then(x=>x.json()).catch(()=>null)
  if (!r || !r.ok) { alert((r&&r.error)||'沒存成功'); return null }
  if (window._hrmD) window._hrmD.rows = r.rows
  return r
}
function hrmRenderKeep(){ const scrs=[...document.querySelectorAll('#app .scroll')].map(el=>el.scrollLeft); const winY=window.scrollY; hrmRender(); requestAnimationFrame(()=>{ [...document.querySelectorAll('#app .scroll')].forEach((el,i)=>{ if(scrs[i]!=null) el.scrollLeft=scrs[i] }); window.scrollTo(0,winY) }) }
async function hrmSet(co, name, field, val){ const r = await hrmUp({ op:'set', co, name, field, val }); if (r) hrmRenderKeep() }
async function hrmAdd(code){ const d = window._hrmD||{rows:[]}
  const co = code==='ab' ? ((d.rows.find(x=>/A Beach/.test(x.co))||{}).co||'口香糖俱樂部（A Beach）') : ((d.rows.find(x=>/GROUN/.test(x.co))||{}).co||'喬亞國際（GROUN:D）')
  const nm = prompt('新夥伴姓名'); if (!nm) return; const r = await hrmUp({ op:'add', co, newName: nm.trim().slice(0,20) }); if (r) hrmRenderKeep() }
async function hrmDel(co, name){ if (!confirm('把 '+name+' 從名冊移除？')) return; const r = await hrmUp({ op:'del', co, name }); if (r) hrmRender() }

// 職務選單自訂 v4.34.6（張良「不要再出現分號一行的設定視窗 專業一點」）：正式視窗＝一列一個選項、可改字/刪、＋新增、✓儲存
function hrmTitleOpts(){
  const d = window._hrmD; if (!d) return
  window._toL = (d.titleOpts && d.titleOpts.length ? d.titleOpts : ['正職','PT']).slice()
  hrmToDraw()
}
function hrmToDraw(){
  const old = document.getElementById('toOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id = 'toOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,22,.55);z-index:70;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:340px;width:100%;max-height:80vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:4px">職務選單</div>
    <div class="hint" style="margin-bottom:10px">編輯模式下職務欄的選項；改字直接打、不要的按 ✕</div>

    <button class="mini" style="padding:7px 14px" onclick="window._toL.push('');hrmToDraw()">＋ 新增選項</button>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button class="mini" style="padding:8px 14px" onclick="document.getElementById('toOv').remove()">取消</button>
      <button class="mini on" style="padding:8px 18px" onclick="hrmToSave()">✓ 儲存</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
  const inp = ov.querySelectorAll('#toList input'); if (inp.length) inp[inp.length-1].focus()
}
async function hrmToSave(){
  const list = (window._toL||[]).map(x=>String(x).trim()).filter(Boolean)
  if (!list.length) { alert('至少留一個選項'); return }
  const r = await hrmUp({ op:'titleopts', list })
  const o = document.getElementById('toOv'); if (o) o.remove()
  if (r) { window._hrmD.titleOpts = r.titleOpts; hrmRenderKeep() }
}

// 📎 入職文件總管 v4.35.0（張良「體檢要能直接上傳檔案 給勞檢稽核；追蹤入職進度」）
function hrmDocs(co, name){
  const d = window._hrmD; if (!d) return
  const x = (d.rows||[]).find(r=>r.co===co&&r.name===name); if (!x) return
  window._hdCur = { co, name }
  const minor = (+x.age||99) < 18
  const old = document.getElementById('hdOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id='hdOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,22,.58);z-index:70;display:flex;align-items:center;justify-content:center;padding:14px'
  const st9 = hrmDocStat(x)
  ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:480px;width:100%;max-height:86vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16.5px">📎 ${name} 入職文件</b><span style="font-weight:900;color:${st9.got>=st9.need?'var(--green)':'#E8A657'}">${st9.got}/${st9.need}</span></div>
    <div class="hint" style="margin:4px 0 10px">檔案存私有空間（個資），點檔名=開 5 分鐘有效連結；也可以 LINE 私訊 DD「文件 ${name} 體檢」再傳照片/檔案</div>
    ${HR_DOCS.map(dk=>{
      if (dk.minor && !minor) return ''
      const files = (((x.docs||{})[dk.k])||{}).files||[]
      return `<div style="border-top:1px solid var(--line);padding:8px 0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:800">${files.length?'✅':'⬜'} ${dk.n}${dk.minor?' <span class="hint" style="font-size:11px">未成年需要</span>':''}</span>${dk.k==='health'&&x.health?`<span class="hint" style="font-size:12px">（${x.health}）</span>`:''}
          <button class="mini" style="padding:3px 12px;margin-left:auto" onclick="hrmDocPick('${dk.k}')">上傳</button>
        </div>
        ${files.map((f,i)=>`<div style="display:flex;gap:8px;align-items:center;padding:3px 0 0 22px;font-size:13px">
          <a href="/api/mail-sync?hrdocurl=${encodeURIComponent(K)}&me=${encodeURIComponent(TK())}&co=${encodeURIComponent(co)}&nm=${encodeURIComponent(name)}&key=${dk.k}&i=${i}" target="_blank" style="color:var(--primary);text-decoration:underline">${dk.n.slice(0,4)}-${i+1}.${f.ext}</a>
          <span class="hint" style="font-size:11.5px">${f.by||''}・${f.ts||''}</span>
          <button class="mini" style="padding:0 8px;color:var(--red);font-size:11px" onclick="hrmDocDel('${dk.k}',${i})">刪</button></div>`).join('')}
      </div>`
    }).join('')}
    <div style="text-align:right;margin-top:10px"><button class="mini" style="padding:8px 16px" onclick="document.getElementById('hdOv').remove()">關閉</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function hrmDocPick(key){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*,application/pdf'
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return
    let dataUrl, ext
    if (/^image\//.test(f.type)) { // 圖片壓縮到長邊1800（個資文件要看得清楚字）
      const img = await new Promise((ok,bad)=>{ const i2=new Image(); i2.onload=()=>ok(i2); i2.onerror=bad; i2.src=URL.createObjectURL(f) })
      const sc = Math.min(1, 1800/Math.max(img.width,img.height))
      const cv = document.createElement('canvas'); cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc)
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height)
      dataUrl = cv.toDataURL('image/jpeg',.88); ext='jpg'
    } else {
      if (f.size > 7*1024*1024) { alert('PDF 太大（上限約 7MB）——可以改用 LINE 傳給 DD（上限 15MB）'); return }
      dataUrl = await new Promise((ok,bad)=>{ const r2=new FileReader(); r2.onload=()=>ok(r2.result); r2.onerror=bad; r2.readAsDataURL(f) })
      ext = (f.name.split('.').pop()||'pdf').toLowerCase()
    }
    const { co, name } = window._hdCur||{}
    const r = await fetch('/api/mail-sync?hrdocup='+encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), co, name, key, ext, dataUrl }) }).then(x=>x.json()).catch(()=>null)
    if (!r || !r.ok) { alert((r&&r.error)||'上傳失敗'); return }
    const row = (window._hrmD.rows||[]).find(z=>z.co===co&&z.name===name); if (row) row.docs = r.docs
    hrmDocs(co, name); hrmRenderKeep()
  }
  inp.click()
}
async function hrmDocDel(key, i){
  if (!confirm('移除這個檔案連結？')) return
  const { co, name } = window._hdCur||{}
  const r = await fetch('/api/mail-sync?hrdocdel='+encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), co, name, key, i }) }).then(x=>x.json()).catch(()=>null)
  if (!r || !r.ok) { alert((r&&r.error)||'失敗'); return }
  const row = (window._hrmD.rows||[]).find(z=>z.co===co&&z.name===name); if (row) row.docs = r.docs
  hrmDocs(co, name); hrmRenderKeep()
}

// 欄位順序自訂 v4.35.1（張良「清單欄位讓我可以排序」）：正式視窗 ▲▼ 調整、全裝置共用（存名冊檔）
function hrmColOrder(){
  const d = window._hrmD; if (!d) return
  const DEF = [['name','姓名'],['co','店'],['dept','部門'],['title','職務'],['onboard','到職日'],['ten','年資'],['bday','生日'],['age','年齡'],['sex','性別'],['nid','身分證字號'],['emer','緊急聯絡人'],['docs','📎 文件']]
  const cur = [...(d.colOrder||[]).filter(k=>DEF.some(x=>x[0]===k)), ...DEF.map(x=>x[0]).filter(k=>!(d.colOrder||[]).includes(k))]
  window._hcL = cur
  const draw = () => {
    const old = document.getElementById('hcOv'); if (old) old.remove()
    const ov = document.createElement('div'); ov.id='hcOv'
    ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,22,.55);z-index:71;display:flex;align-items:center;justify-content:center;padding:16px'
    ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:300px;width:100%;max-height:82vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
      <div style="font-weight:900;margin-bottom:8px">欄位排序</div>
      ${window._hcL.map((k,i)=>{ const lb=(DEF.find(x=>x[0]===k)||[])[1]||k; return `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--line)">
        <span style="flex:1;font-weight:700">${lb}</span>
        <button class="mini" style="padding:1px 9px;${i===0?'opacity:.3':''}" ${i===0?'disabled':''} onclick="const t=window._hcL[${i}];window._hcL[${i}]=window._hcL[${i-1}];window._hcL[${i-1}]=t;window._hcDraw()">▲</button>
        <button class="mini" style="padding:1px 9px;${i===window._hcL.length-1?'opacity:.3':''}" ${i===window._hcL.length-1?'disabled':''} onclick="const t=window._hcL[${i}];window._hcL[${i}]=window._hcL[${i+1}];window._hcL[${i+1}]=t;window._hcDraw()">▼</button></div>` }).join('')}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
        <button class="mini" style="padding:8px 14px" onclick="document.getElementById('hcOv').remove()">取消</button>
        <button class="mini on" style="padding:8px 18px" onclick="hrmColSave()">✓ 儲存</button></div></div>`
    ov.onclick = () => ov.remove()
    document.body.appendChild(ov)
  }
  window._hcDraw = draw
  draw()
}
async function hrmColSave(){
  const r = await hrmUp({ op:'colorder', list: window._hcL })
  const o = document.getElementById('hcOv'); if (o) o.remove()
  if (r) { window._hrmD.colOrder = r.colOrder; hrmRenderKeep() }
}

// 🗂 文件庫 v4.38.3（張良「上面建一個資料庫 點進去看不同檔案的分類資料夾 檔名自動統一」）
// 檔名規範：AB_林品燊_體檢報告_2026-10-04.jpg（下載/另存自動套用）
function hrmFn(x, dk, f){ const co9=/A Beach/.test(x.co)?'AB':'GD'; const d9=(f.ts||'').slice(0,5).replace('-','')||''; return `${co9}_${x.name}_${dk.n.replace(/（.*/,'')}_${(f.ts||'').slice(0,5)||'未知'}.${f.ext||'jpg'}` }
function hrmLib(folder){
  const d = window._hrmD; if (!d) return
  const isAB9 = x => /A Beach/.test(x.co||'')
  let rows = (d.rows||[])
  if (hrmCo==='ab') rows = rows.filter(isAB9)
  if (hrmCo==='gd') rows = rows.filter(x=>!isAB9(x))
  const old9 = document.getElementById('hlOv'); if (old9) old9.remove()
  const ov = document.createElement('div'); ov.id='hlOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,22,.58);z-index:69;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow:auto'
  let inner
  if (!folder) { // 第一層：分類資料夾
    inner = `<div style="font-weight:900;font-size:16.5px;display:flex;justify-content:space-between;align-items:center">🗂 文件庫 <span class="hint" style="font-weight:600;font-size:12px">${hrmCo==='all'?'全部':hrmCo==='ab'?'A Beach':'GROUN:D'}・檔名自動統一：店_姓名_文件_日期</span><button class="mini" style="padding:6px 14px" onclick="document.getElementById('hlOv').remove()">關閉</button></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-top:12px">
      ${HR_DOCS.map(dk=>{ const n9 = rows.reduce((t,x)=>t+((((x.docs||{})[dk.k])||{}).files||[]).length,0)
        const ppl9 = rows.filter(x=>((((x.docs||{})[dk.k])||{}).files||[]).length).length
        return `<div onclick="hrmLib('${dk.k}')" style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:14px;cursor:pointer">
          <div style="font-size:22px">📁</div><div style="font-weight:800;margin-top:4px">${dk.n.replace(/（.*/,'')}</div>
          <div class="hint" style="font-size:12px;margin-top:2px">${n9} 份檔案・${ppl9}/${rows.length} 人已交</div></div>` }).join('')}
      </div>`
  } else { // 第二層：單一分類的全部檔案
    const dk = HR_DOCS.find(z=>z.k===folder) || { n: folder }
    const files = []
    rows.forEach(x=>{ ((((x.docs||{})[folder])||{}).files||[]).forEach((f,i)=>files.push({ x, f, i })) })
    files.sort((a,b)=>String(b.f.ts||'').localeCompare(String(a.f.ts||'')))
    const missing = rows.filter(x=>!((((x.docs||{})[folder])||{}).files||[]).length && (!HR_DOCS.find(z=>z.k===folder)?.minor || (+x.age||99)<18))
    inner = `<div style="font-weight:900;font-size:16.5px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span><span style="cursor:pointer;color:var(--primary)" onclick="hrmLib()">🗂 文件庫</span> › 📁 ${dk.n.replace(/（.*/,'')}</span><button class="mini" style="padding:6px 14px" onclick="document.getElementById('hlOv').remove()">關閉</button></div>
      ${files.length?`<div style="margin-top:10px">${files.map(({x,f,i})=>`<div style="display:flex;gap:10px;align-items:center;border-top:1px solid var(--line);padding:7px 0;font-size:13.5px;flex-wrap:wrap">
        <a href="/api/mail-sync?hrdocurl=${encodeURIComponent(K)}&me=${encodeURIComponent(TK())}&co=${encodeURIComponent(x.co)}&nm=${encodeURIComponent(x.name)}&key=${folder}&i=${i}&dl=${encodeURIComponent(hrmFn(x,dk,f))}" target="_blank" style="color:var(--primary);text-decoration:underline;font-family:ui-monospace,monospace;font-size:12.5px">${hrmFn(x,dk,f)}</a>
        <span class="hint" style="font-size:11.5px">${f.by||''} 上傳・${f.ts||''}</span></div>`).join('')}</div>`:'<div class="mut" style="margin-top:12px">這個分類還沒有檔案</div>'}
      ${missing.length?`<div class="hint" style="margin-top:12px;font-size:12.5px">還沒交（${missing.length}）：${missing.map(x=>x.name).join('、')}</div>`:''}`
  }
  ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:760px;width:100%;padding:16px;margin:auto 0" onclick="event.stopPropagation()">${inner}</div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
