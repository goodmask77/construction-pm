// ── 🪪 員工清冊 v4.34.0（張良 2026-10-04：兩間公司現有人員 到職日/生日/身分證；主管限定——資料端 hrmaster 口在伺服器就擋，非主管連資料都拿不到）──
// 來源＝張良提供的 Google Sheet 勞工名冊（口香糖俱樂部=A Beach、喬亞國際=GROUN:D）；更新=重新匯入即可
let hrmQ = ''
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
function hrmRender(){
  const d = window._hrmD; if (!d || curStore !== 'hrm') return
  const rows = (d.rows||[]).filter(x => !hrmQ || (x.name||'').includes(hrmQ) || (x.dept||'').includes(hrmQ) || (x.title||'').includes(hrmQ))
  const cos = [...new Set((d.rows||[]).map(x=>x.co))]
  const fD = s => s||'—'
  let h = `<section><h2>🪪 員工清冊 <span class="hint">主管限定・含個資請勿截圖外傳｜資料日期 ${String(d.updatedAt||'').slice(0,10)}</span></h2>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <input value="${hrmQ.replace(/"/g,'&quot;')}" placeholder="搜姓名／部門／職務" style="padding:8px 12px;border:1.5px solid var(--line);border-radius:10px;font-size:14.5px;width:220px;background:var(--card);color:var(--ink)" oninput="hrmQ=this.value;hrmRender()">
      <span class="hint">共 ${ (d.rows||[]).length } 人（${cos.map(c=>`${c} ${(d.rows||[]).filter(x=>x.co===c).length}`).join('、')}）</span>
    </div>`
  cos.forEach(co=>{
    const list = rows.filter(x=>x.co===co)
    if (!list.length) return
    h += `<div style="font-weight:900;font-size:15.5px;margin:14px 0 6px;color:var(--pdark)">${co}（${list.length} 人）</div>
    <div class="scroll"><table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="padding:6px 8px">#</th><th style="text-align:left;padding:6px 8px">姓名</th><th style="padding:6px 8px">部門</th><th style="padding:6px 8px">職務</th><th style="padding:6px 8px">到職日</th><th style="padding:6px 8px">年資</th><th style="padding:6px 8px">生日</th><th style="padding:6px 8px">年齡</th><th style="padding:6px 8px">性別</th><th style="padding:6px 8px">身分證字號</th><th style="text-align:left;padding:6px 8px">體檢</th></tr></thead><tbody>`
    list.forEach((x,i)=>{
      let ten = ''
      if (x.onboard) { const ms = Date.now() - new Date(x.onboard).getTime(); const y9 = ms/31557600000; ten = y9 >= 1 ? (Math.round(y9*10)/10)+'年' : Math.max(1,Math.round(ms/2629800000))+'個月' }
      h += `<tr style="border-top:1px solid var(--line)"><td style="padding:6px 8px;text-align:center" class="hint">${i+1}</td>
        <td style="padding:6px 8px;font-weight:800;white-space:nowrap">${x.name||''}</td>
        <td style="padding:6px 8px;text-align:center;white-space:nowrap">${fD(x.dept)}</td>
        <td style="padding:6px 8px;text-align:center;white-space:nowrap">${fD(x.title)}</td>
        <td style="padding:6px 8px;text-align:center;white-space:nowrap">${fD(x.onboard)}</td>
        <td style="padding:6px 8px;text-align:center;white-space:nowrap" class="hint">${ten||'—'}</td>
        <td style="padding:6px 8px;text-align:center;white-space:nowrap">${fD(x.birth)}</td>
        <td style="padding:6px 8px;text-align:center">${fD(x.age)}</td>
        <td style="padding:6px 8px;text-align:center">${fD(x.sex)}</td>
        <td style="padding:6px 8px;text-align:center;font-family:ui-monospace,monospace;letter-spacing:.5px">${fD(x.nid)}</td>
        <td style="padding:6px 8px;text-align:left;font-size:12.5px" class="hint">${fD(x.health)}</td></tr>`
    })
    h += `</tbody></table></div>`
  })
  h += `<div class="hint" style="margin-top:10px">來源：勞工名冊（Google Sheet）・要更新跟 D 哥說「更新員工清冊」即可重新匯入</div></section>`
  app.innerHTML = h
}
