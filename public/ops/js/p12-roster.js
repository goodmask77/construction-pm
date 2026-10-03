// ── 🪪 夥伴名冊 v4.34.2（張良 2026-10-04：主管限定；標題資料對齊/全部AB GD切換/欄位排序/生日提醒卡；生日前一週 cron 發 ABpeople 群）──
// 資料端 hrmaster 口在伺服器就擋，非主管連資料都拿不到；來源＝勞工名冊 Google Sheet（口香糖=A Beach、喬亞=GROUN:D）
let hrmQ = '', hrmCo = 'all', hrmSort = { k: '', dir: 1 }
async function hrmLoad(){
  curStore = 'hrm'; setTabs('hrm')
  const hb = document.getElementById('tab-hrm'); if (hb) hb.className = 'on'
  document.getElementById('upd').textContent = '夥伴名冊'
  app.innerHTML = '<section><h2>🪪 夥伴名冊</h2><div class="hint">讀取中…（主管限定）</div></section>'
  let d = null
  try { const r = await fetch('/api/mail-sync?hrmaster=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '') + '&r=' + Date.now()); d = await r.json() } catch(e){}
  if (!d || !d.ok) {
    app.innerHTML = `<section><h2>🪪 夥伴名冊</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">🔒 ${(d&&d.error)||'這頁只有主管看得到（內含身分證、生日等個資）'}</div></section>`
    return
  }
  window._hrmD = d
  hrmRender()
}
function hrmSortBy(k){ if (hrmSort.k === k) hrmSort.dir = -hrmSort.dir; else hrmSort = { k, dir: 1 }; hrmRender() }
function hrmRender(){
  const d = window._hrmD; if (!d || curStore !== 'hrm') return
  const isAB = x => /A Beach/.test(x.co||'')
  let rows = (d.rows||[]).filter(x => !hrmQ || (x.name||'').includes(hrmQ) || (x.dept||'').includes(hrmQ) || (x.title||'').includes(hrmQ))
  if (hrmCo === 'ab') rows = rows.filter(isAB)
  if (hrmCo === 'gd') rows = rows.filter(x => !isAB(x))
  // 排序（點欄頭）；預設照清冊原順序
  if (hrmSort.k) {
    const k = hrmSort.k
    rows = rows.slice().sort((a,b)=>{
      let va = a[k] ?? '', vb = b[k] ?? ''
      if (k === 'age') { va = +va||0; vb = +vb||0; return (va-vb)*hrmSort.dir }
      if (k === 'bday') { va = String(a.birth||'').slice(5); vb = String(b.birth||'').slice(5); return (va<vb?-1:va>vb?1:0)*hrmSort.dir }
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
  const coBtn = (v,lb)=>`<button class="mini${hrmCo===v?' on':''}" style="padding:6px 14px;font-weight:800" onclick="hrmCo='${v}';hrmRender()">${lb}</button>`
  let h = `<section><h2>🪪 夥伴名冊 <span class="hint">主管限定・含個資請勿截圖外傳｜資料日期 ${String(d.updatedAt||'').slice(0,10)}</span></h2>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      ${coBtn('all','全部')}${coBtn('ab','A Beach')}${coBtn('gd','GROUN:D')}
      <input value="${hrmQ.replace(/"/g,'&quot;')}" placeholder="搜姓名／部門／職務" style="padding:8px 12px;border:1.5px solid var(--line);border-radius:10px;font-size:14.5px;width:200px;background:var(--card);color:var(--ink)" oninput="hrmQ=this.value;hrmRender()">
      <span class="hint">${rows.length} 人</span>
      ${d.canEdit?`<button class="mini${window._hrmEdit?' on':''}" style="padding:6px 14px;font-weight:800" onclick="window._hrmEdit=!window._hrmEdit;hrmRender()">${window._hrmEdit?'✓ 完成編輯':'✏️ 編輯'}</button>`:''}
    </div>`
  if (upcoming.length) {
    h += `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:10px 13px;margin-bottom:12px">
      <b>🎂 生日提醒（接下來 30 天）</b> <span class="hint">生日前一週 D 哥會自動發 ABpeople 群</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:7px">
      ${upcoming.map(x=>`<span style="display:inline-flex;gap:6px;align-items:center;background:var(--soft);border:1.5px solid ${x.days<=7?'#D4A72C':'var(--line)'};border-radius:10px;padding:5px 11px;font-size:13.5px;${x.days<=7?'box-shadow:0 0 8px rgba(212,167,44,.35);':''}">
        <b>${x.md}</b> ${x.name} <span class="hint" style="font-size:12px">${/A Beach/.test(x.co)?'AB':'GD'}・${x.days===0?'🎉 今天！':x.days+'天後'}</span></span>`).join('')}
      </div></div>`
  }
  // 欄頭：對齊與資料一致（姓名/體檢靠左、其餘置中）＋點了排序
  const arrow = k => hrmSort.k===k ? (hrmSort.dir>0?' ▲':' ▼') : ''
  const TH = (k,lb,align)=>`<th style="padding:6px 8px;text-align:${align};cursor:pointer;white-space:nowrap;user-select:none" onclick="hrmSortBy('${k}')" title="點我排序">${lb}${arrow(k)}</th>`
  // 🔒 身分證欄名單鎖（v4.41.2 張良「顯示鎖的符號 裡面有人員名單 我打勾的人才可以看到」）：管理者點鎖頭勾人；沒在名單的主管這欄=「—」(伺服器端拔掉)
  const LOCK_I9 = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="vertical-align:-2px"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  const nidTh = `<th style="padding:6px 8px;text-align:center;white-space:nowrap;user-select:none">身分證字號 ${d.idLock ? `<span title="名單制：打勾的人才看得到這一欄（點我設定）" style="cursor:pointer;color:#D4A72C" onclick="hrmIdLock()">${LOCK_I9}</span>` : (d.idCan ? '' : `<span class="hint" title="你沒有檢視這欄的權限">${LOCK_I9}</span>`)}</th>`
  const header = `<thead><tr><th style="padding:6px 8px;text-align:center">#</th>${TH('name','姓名','left')}${TH('dept','部門','center')}${TH('title','職務','center')}${TH('onboard','到職日','center')}${TH('onboard','年資','center')}${TH('bday','生日','center')}${TH('age','年齡','center')}${TH('sex','性別','center')}${nidTh}${TH('health','體檢','left')}</tr></thead>`
  const bdaySet = {} // 名→天數（近30天壽星整列生日光）
  upcoming.forEach(x=>{ bdaySet[x.co+'|'+x.name]=x.days })
  const IN9 = (x,f,w,alignL)=>`<input value="${String(x[f]??'').replace(/"/g,'&quot;')}" style="width:${w}px;padding:3px 5px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:12.5px;text-align:${alignL?'left':'center'}" onchange="hrmSet('${(x.co||'').replace(/'/g,'')}','${(x.name||'').replace(/'/g,'')}','${f}',this.value)">`
  const rowHtml = (x,i)=>{
    let ten = ''
    if (x.onboard) { const ms = Date.now() - new Date(x.onboard).getTime(); const y9 = ms/31557600000; ten = y9 >= 1 ? (Math.round(y9*10)/10)+'年' : Math.max(1,Math.round(ms/2629800000))+'個月' }
    const bd9 = bdaySet[x.co+'|'+x.name]
    const ed = window._hrmEdit
    return `<tr ${bd9!=null?'class="bdayGlow" title="🎂 '+(bd9===0?'今天生日！':bd9+' 天後生日')+'"':''} style="border-top:1px solid var(--line)"><td style="padding:6px 8px;text-align:center" class="hint">${i+1}</td>
      <td style="padding:6px 8px;text-align:left;font-weight:800;white-space:nowrap">${ed?IN9(x,'name',72,1):(x.name||'')}${bd9!=null?' 🎂':''}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap">${ed?IN9(x,'dept',58):(x.dept||'—')}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap">${ed?IN9(x,'title',58):(x.title||'—')}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap">${ed?IN9(x,'onboard',96):(x.onboard||'—')}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap" class="hint">${ten||'—'}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap">${ed?IN9(x,'birth',96):(x.birth||'—')}</td>
      <td style="padding:6px 8px;text-align:center">${x.age||'—'}</td>
      <td style="padding:6px 8px;text-align:center">${ed?IN9(x,'sex',34):(x.sex||'—')}</td>
      <td style="padding:6px 8px;text-align:center;font-family:ui-monospace,monospace;letter-spacing:.5px">${ed&&d.idCan?IN9(x,'nid',106):(x.nid||'—')}</td>
      <td style="padding:6px 8px;text-align:left;font-size:12.5px" class="hint">${ed?IN9(x,'health',110,1):(x.health||'—')}${ed?` <button class="mini" style="padding:1px 7px;color:var(--red)" onclick="hrmDel('${(x.co||'').replace(/'/g,'')}','${(x.name||'').replace(/'/g,'')}')">刪</button>`:''}</td></tr>`
  }
  if (hrmCo === 'all' && !hrmSort.k) { // 全部＋沒排序＝照公司分區
    ;[...new Set(rows.map(x=>x.co))].forEach(co=>{
      const list = rows.filter(x=>x.co===co)
      h += `<div style="font-weight:900;font-size:15.5px;margin:14px 0 6px;color:var(--pdark)">${co}（${list.length} 人）${window._hrmEdit?` <button class="mini" style="padding:2px 10px" onclick="hrmAdd('${co.replace(/'/g,'')}')">＋ 加人</button>`:''}</div>
        <div class="scroll"><table style="border-collapse:collapse;width:100%">${header}<tbody>${list.map(rowHtml).join('')}</tbody></table></div>`
    })
  } else { // 篩選或排序＝一張表（跨公司排序才有意義），加「公司」欄識別
    h += `<div class="scroll"><table style="border-collapse:collapse;width:100%">${header.replace('<th style="padding:6px 8px;text-align:center">#</th>', `<th style="padding:6px 8px;text-align:center">#</th><th style="padding:6px 8px;text-align:center">店</th>`)}<tbody>
      ${rows.map((x,i)=>rowHtml(x,i).replace('</td>', `</td><td style="padding:6px 8px;text-align:center;font-weight:700">${/A Beach/.test(x.co)?'AB':'GD'}</td>`)).join('')}</tbody></table></div>`
  }
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
async function hrmSet(co, name, field, val){ const r = await hrmUp({ op:'set', co, name, field, val }); if (r) hrmRender() }
async function hrmAdd(co){ const nm = prompt('新夥伴姓名'); if (!nm) return; const r = await hrmUp({ op:'add', co, newName: nm.trim().slice(0,20) }); if (r) hrmRender() }
async function hrmDel(co, name){ if (!confirm('把 '+name+' 從名冊移除？')) return; const r = await hrmUp({ op:'del', co, name }); if (r) hrmRender() }
