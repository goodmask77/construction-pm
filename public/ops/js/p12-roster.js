// ── 🪪 員工清冊 v4.34.2（張良 2026-10-04：主管限定；標題資料對齊/全部AB GD切換/欄位排序/生日提醒卡；生日前一週 cron 發 ABpeople 群）──
// 資料端 hrmaster 口在伺服器就擋，非主管連資料都拿不到；來源＝勞工名冊 Google Sheet（口香糖=A Beach、喬亞=GROUN:D）
let hrmQ = '', hrmCo = 'all', hrmSort = { k: '', dir: 1 }
async function hrmLoad(){
  curStore = 'hrm'; setTabs('hrm')
  const hb = document.getElementById('tab-hrm'); if (hb) hb.className = 'on'
  document.getElementById('upd').textContent = '員工清冊'
  app.innerHTML = '<section><h2>🪪 員工清冊</h2><div class="hint">讀取中…（主管限定）</div></section>'
  let d = null
  try { const r = await fetch('/api/mail-sync?hrmaster=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '') + '&r=' + Date.now()); d = await r.json() } catch(e){}
  if (!d || !d.ok) {
    app.innerHTML = `<section><h2>🪪 員工清冊</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">🔒 ${(d&&d.error)||'這頁只有主管看得到（內含身分證、生日等個資）'}</div></section>`
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
  let h = `<section><h2>🪪 員工清冊 <span class="hint">主管限定・含個資請勿截圖外傳｜資料日期 ${String(d.updatedAt||'').slice(0,10)}</span></h2>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      ${coBtn('all','全部')}${coBtn('ab','A Beach')}${coBtn('gd','GROUN:D')}
      <input value="${hrmQ.replace(/"/g,'&quot;')}" placeholder="搜姓名／部門／職務" style="padding:8px 12px;border:1.5px solid var(--line);border-radius:10px;font-size:14.5px;width:200px;background:var(--card);color:var(--ink)" oninput="hrmQ=this.value;hrmRender()">
      <span class="hint">${rows.length} 人</span>
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
  const header = `<thead><tr><th style="padding:6px 8px;text-align:center">#</th>${TH('name','姓名','left')}${TH('dept','部門','center')}${TH('title','職務','center')}${TH('onboard','到職日','center')}${TH('onboard','年資','center')}${TH('birth','生日','center')}${TH('age','年齡','center')}${TH('sex','性別','center')}${TH('nid','身分證字號','center')}${TH('health','體檢','left')}</tr></thead>`
  const rowHtml = (x,i)=>{
    let ten = ''
    if (x.onboard) { const ms = Date.now() - new Date(x.onboard).getTime(); const y9 = ms/31557600000; ten = y9 >= 1 ? (Math.round(y9*10)/10)+'年' : Math.max(1,Math.round(ms/2629800000))+'個月' }
    return `<tr style="border-top:1px solid var(--line)"><td style="padding:6px 8px;text-align:center" class="hint">${i+1}</td>
      <td style="padding:6px 8px;text-align:left;font-weight:800;white-space:nowrap">${x.name||''}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap">${x.dept||'—'}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap">${x.title||'—'}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap">${x.onboard||'—'}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap" class="hint">${ten||'—'}</td>
      <td style="padding:6px 8px;text-align:center;white-space:nowrap">${x.birth||'—'}</td>
      <td style="padding:6px 8px;text-align:center">${x.age||'—'}</td>
      <td style="padding:6px 8px;text-align:center">${x.sex||'—'}</td>
      <td style="padding:6px 8px;text-align:center;font-family:ui-monospace,monospace;letter-spacing:.5px">${x.nid||'—'}</td>
      <td style="padding:6px 8px;text-align:left;font-size:12.5px" class="hint">${x.health||'—'}</td></tr>`
  }
  if (hrmCo === 'all' && !hrmSort.k) { // 全部＋沒排序＝照公司分區
    ;[...new Set(rows.map(x=>x.co))].forEach(co=>{
      const list = rows.filter(x=>x.co===co)
      h += `<div style="font-weight:900;font-size:15.5px;margin:14px 0 6px;color:var(--pdark)">${co}（${list.length} 人）</div>
        <div class="scroll"><table style="border-collapse:collapse;width:100%">${header}<tbody>${list.map(rowHtml).join('')}</tbody></table></div>`
    })
  } else { // 篩選或排序＝一張表（跨公司排序才有意義），加「公司」欄識別
    h += `<div class="scroll"><table style="border-collapse:collapse;width:100%">${header.replace('<th style="padding:6px 8px;text-align:center">#</th>', `<th style="padding:6px 8px;text-align:center">#</th><th style="padding:6px 8px;text-align:center">店</th>`)}<tbody>
      ${rows.map((x,i)=>rowHtml(x,i).replace('</td>', `</td><td style="padding:6px 8px;text-align:center;font-weight:700">${/A Beach/.test(x.co)?'AB':'GD'}</td>`)).join('')}</tbody></table></div>`
  }
  h += `<div class="hint" style="margin-top:10px">來源：勞工名冊（Google Sheet）・要更新跟 D 哥說「更新員工清冊」即可重新匯入</div></section>`
  app.innerHTML = h
}
