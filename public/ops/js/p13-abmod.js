// ── 🧩 AB 模組班表 v4.45.0（張良 2026-10-04：把 Excel 四週模組方法論搬進系統）──
// 第一期＝人為列編輯器＋自動體檢（單天逐時段人力/每人時數/PT需求vs排班/薪資預估/勞基法/PT可用性）
// 第二期（之後）＝DD 按鈕卡逐人確認 → on 上班表；NUEiP 照舊人工輸入，用班表比對抓打錯
// 資料 sp_finance_pm_abmod＝{mods:[{id,name,eff,note,dict,rows:[{name,tp:'正'|'PT',needH,note,days:{1..7:dictIdx|-1}}]}]}
let amCur = null, amSaveT = null
const AM_DICT_DEF = [ // 班別字典預設（照張良 Excel＋NUEiP 常用；可自行增改）
  { code: 'D',  s: '11:00', e: '22:00' },
  { code: '機動', s: '12:00', e: '21:00' },
  { code: '收', s: '15:00', e: '24:00' },
  { code: '跑', s: '12:00', e: '22:00' },
  { code: '沙', s: '12:00', e: '21:00' },
  { code: '叢', s: '12:00', e: '21:00' },
  { code: 'B',  s: '12:00', e: '21:00' },
  { code: '早', s: '12:00', e: '17:30' },
  { code: '晚', s: '18:00', e: '22:30' },
  { code: '早8', s: '08:00', e: '17:00' },
]
function amT2m(t){ const a=String(t||'').split(':'); return (+a[0]||0)*60+(+a[1]||0) }
// v4.47.3（張良「顏色跟系統一樣」）：班別配色＝/prep AB 班表同一套（p05 abC）
function amColor(c0, dk){ if(dk&&dk.color&&/^#[0-9a-fA-F]{6}$/.test(dk.color)) return dk.color // v4.55 自訂色優先
  c0=String(c0||'')
  if(/機/.test(c0)) return '#6EB1FF'
  if(/沙|叢|^B/.test(c0)) return '#7ED88F'
  if(/^D/.test(c0)) return '#FF8A8A'
  if(/跑|假/.test(c0)) return '#F48FB1'
  if(/收|晚/.test(c0)) return '#5FD3D3'
  if(/午/.test(c0)) return '#F2C14E'
  if(/爐/.test(c0)) return '#F0A050'
  if(/^P/.test(c0)) return '#B9A3E8'
  const PAL=['#6EB1FF','#7ED88F','#FF8A8A','#F48FB1','#5FD3D3','#F2C14E','#B9A3E8','#F0A050']
  let h=0; for(const ch of c0) h=(h*31+ch.charCodeAt(0))>>>0; return PAL[h%PAL.length] }
function amSpanH(dk){ if(!dk||!dk.s||!dk.e) return 0; let sp=amT2m(dk.e)-amT2m(dk.s); if(sp===0) return 0; if(sp<0) sp+=1440; return Math.max(0,(sp-(sp>=540?60:0)))/60 } // 排9h+預設含1h休；無起訖(如X休)或0時長=0h（v4.55治本：原本空白→繞夜算23h把時數/薪資灌水）
async function abModView(){
  if (!window._amD) {
    lpOverlay('amOv','<div class="hint" style="padding:20px">讀取模組班表中…</div>')
    const r = await fetch('/api/mail-sync?abmod='+encodeURIComponent(K)+'&me='+encodeURIComponent(TK())+'&r='+Date.now()).then(x=>x.json()).catch(()=>null)
    if (!r || !r.ok) { lpOverlay('amOv', `<div style="padding:16px">🔒 ${(r&&r.error)||'讀不到（主管限定）'}</div>`); return }
    window._amD = r
    if (!r.mods.length) { // 首個模組：照班表分組預載（內場/外場×正職/PT，排除離職）
      r.mods = [{ id:'m'+Date.now().toString(36), name:'模組A', eff:'', note:'', dict: JSON.parse(JSON.stringify(AM_DICT_DEF)), rows: amBuildRows(r) }]
    }
  }
  if (!amCur || !window._amD.mods.some(m=>m.id===amCur)) amCur = window._amD.mods[0].id
  // v4.47.2：舊模組(rows 都沒 sub 分組)自動照班表重整一次=不用手動點↻（保留已填格子；班表抓得到名單才套，避免誤清）
  const m0 = amMod()
  if (m0 && (m0.rows||[]).length && m0.rows.every(r=>!r.sub)) {
    const fresh = amBuildRows(window._amD)
    if (fresh.length >= Math.floor(m0.rows.length*0.6)) {
      const byN={}; m0.rows.forEach(r=>byN[r.name]=r)
      m0.rows = fresh.map(f=>{ const o=byN[f.name]; return o?{...f, days:o.days||{}, needH:o.needH||0, rate:o.rate||0, note:o.note||''}:f })
      amSave()
    }
  }
  amDraw()
}
// v4.47.1（張良「正職PT 內場外場 照班表樣式排序；陳立航已離職核對班表」）：照 /prep 班表的分組與在職名單建列
function amBuildRows(r){
  const dep={}, pt={}, cnt={}, act={}
  const today9=new Date(Date.now()+8*3600e3).toISOString().slice(0,10)
  const d14=new Date(Date.now()+8*3600e3-14*86400e3).toISOString().slice(0,10)
  try { (typeof shMergedAb==='function'?shMergedAb():[]).forEach(x=>{ if(!x.name) return
    if(x.dept&&!dep[x.name]) dep[x.name]=x.dept; if(x.pt) pt[x.name]=1; cnt[x.name]=(cnt[x.name]||0)+1
    if(x.date>act[x.name]||!act[x.name]) act[x.name]=x.date }) } catch(_){}
  const onSet=new Set((r.abOn&&r.abOn.length)?r.abOn:(r.staff||[]))
  // 在職判定＝NUEiP現役 且 14天內有班（跟班表同規則；離職如陳立航自動不帶）
  const alive = n => onSet.has(n) && (act[n]?act[n]>=d14:true)
  const names=[...new Set([...(r.staff||[]), ...Object.keys(cnt)])].filter(alive)
  const subOf = n => /內/.test(dep[n]||'')?'內場':(/外/.test(dep[n]||'')?'外場':'其他')
  const grpRank = n => (subOf(n)==='內場'?0:subOf(n)==='外場'?2:4) + (pt[n]?1:0) // 內場→內場PT→外場→外場PT→其他→其他PT
  return names.map(n=>({ name:n, tp: pt[n]?'PT':'正', sub: subOf(n), needH:0, rate:0, note:'', days:{} }))
    .sort((a,b)=>grpRank(a.name)-grpRank(b.name) || (cnt[b.name]||0)-(cnt[a.name]||0))
}
function amMod(){ return (window._amD.mods||[]).find(m=>m.id===amCur) }
function amSave(){ clearTimeout(amSaveT); amSaveT = setTimeout(async()=>{
  const r = await fetch('/api/mail-sync?abmodset='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),mods:window._amD.mods})}).then(x=>x.json()).catch(()=>null)
  if(!r||!r.ok) lpToast((r&&r.error)||'沒存上（要班表編輯權）')
},600) }
function amDraw(){
  const m = amMod(); if (!m) return
  const WD = ['一','二','三','四','五','六','日']
  const dictOf = i => (m.dict||[])[i]
  // ── 體檢計算 ──
  const perH = {}, dayPpl = [0,0,0,0,0,0,0], dayPT = [0,0,0,0,0,0,0]
  const hourly = Array.from({length:7},()=>({})) // [wd][hour]=count（11~24）
  m.rows.forEach(rw=>{ let h=0
    for(let d=1;d<=7;d++){ const di=rw.days[d]; if(di==null||di<0) continue
      const dk=dictOf(di); if(!dk) continue
      const sph=amSpanH(dk); if(sph<=0) continue // v4.55：X/休等無時數＝休假，不算時數/人力/時段
      h+=sph; dayPpl[d-1]++; if(rw.tp==='PT') dayPT[d-1]++
      let sM=amT2m(dk.s), eM=amT2m(dk.e); if(eM<=sM) eM+=1440
      for(let t=Math.floor(sM/60); t<Math.ceil(eM/60); t++){ const hh=t%24; if(hh>=11||t>=24) hourly[d-1][hh]=(hourly[d-1][hh]||0)+1 }
    }
    perH[rw.name]=Math.round(h*10)/10 })
  // 法規（模組週重複推演）：班距11h（含週日→下週一）、單日>12h、連上>12天（週重複=有人7天全排就是無限連上）
  const vio = []
  m.rows.forEach(rw=>{
    const seq=[]; for(let d=1;d<=7;d++){ const dk=rw.days[d]!=null&&rw.days[d]>=0?dictOf(rw.days[d]):null; seq.push(dk&&amSpanH(dk)>0?dk:null) } // v4.55：休假(0h)當沒排班，連上天數不計
    let maxRun=0, run=0
    for(let i=0;i<21;i++){ if(seq[i%7]){ run++; maxRun=Math.max(maxRun,run) } else run=0 }
    if (maxRun>12) vio.push(`${rw.name}：週型重複後連上${maxRun>=21?'∞（每週七天全排）':maxRun+'天'}——至少留例假`)
    seq.forEach((dk,i)=>{ if(dk&&amSpanH(dk)+(amT2m(dk.e)<=amT2m(dk.s)?0:0)>12) vio.push(`${rw.name} 週${WD[i]}：單日排 ${fmtHM(amSpanH(dk)*60)} >12時`) })
    for(let i=0;i<7;i++){ const a=seq[i], b=seq[(i+1)%7]; if(!a||!b) continue
      let eM=amT2m(a.e); if(eM<=amT2m(a.s)) eM+=1440
      const rest=amT2m(b.s)+1440-eM
      if(rest<660&&rest>0) vio.push(`${rw.name} 週${WD[i]}→週${WD[(i+1)%7]}：班距只有 ${fmtHM(rest)} <11時`) }
  })
  // PT 可用性（歷史規律：該週幾 7 成以上是●劃假＝警告）
  const avail = {}
  try { const agg={}
    ;(typeof shMergedAb==='function'?shMergedAb():[]).forEach(x=>{ const g=(new Date(x.date).getDay()+6)%7
      const o=(agg[x.name]=agg[x.name]||Array.from({length:7},()=>({n:0,no:0})))[g]; o.n++
      if(/●|⚫/.test(x.code||'')) o.no++ })
    for(const [n,arr] of Object.entries(agg)) avail[n]=arr.map(o=>o.n>=3&&o.no/o.n>=0.7)
  } catch(_){}
  m.rows.forEach(rw=>{ (avail[rw.name]||[]).forEach((bad,i)=>{ if(bad&&rw.days[i+1]!=null&&rw.days[i+1]>=0) vio.push(`${rw.name} 週${WD[i]}：歷史上這天幾乎都劃假（●），先跟本人確認`) }) })
  // 薪資預估（4週）
  const rates = (window._amD.payRates)||{}
  let cost = 0
  m.rows.forEach(rw=>{ const b=rw.tp==='PT'?(rw.rate||((rates[rw.name]||{}).base)||196):((rates[rw.name]||{}).base||196); cost += (perH[rw.name]||0)*4*b })
  // ── 畫面 ──
  const cellBtn = (rw, d) => {
    const di=rw.days[d], dk=di!=null&&di>=0?dictOf(di):null
    const cc=dk?amColor(dk.code,dk):''
    return `<td onclick="amCell('${rw.name.replace(/'/g,'')}',${d})" style="padding:3px 4px;text-align:center;cursor:pointer;border:1px solid var(--line);min-width:58px">${dk?`<span style="display:inline-block;border:1.5px solid ${cc};background:${cc}1F;color:${cc};border-radius:6px;padding:1px 6px;font-weight:800;font-size:12px;white-space:nowrap">${dk.code}</span><div class="hint" style="font-size:9.5px">${dk.s}-${dk.e}</div>`:'<span class="mut">—</span>'}</td>` }
  // 四區照班表：內場正職/內場PT/外場正職/外場PT/其他（sub 缺就從班表補）
  const SUBO = { '內場':0,'外場':1,'其他':2 }
  const grpKey = rw => (rw.sub||'其他')+'｜'+rw.tp
  const GRPS = [['內場','正'],['內場','PT'],['外場','正'],['外場','PT'],['其他','正'],['其他','PT']]
  const secG = (sub,tp) => m.rows.filter(r=>(r.sub||'其他')===sub && r.tp===tp)
  const rowsHtml = (sub,tp) => secG(sub,tp).map(rw=>{
    const diff = rw.tp==='PT'&&rw.needH ? (perH[rw.name]||0)-rw.needH : null
    return `<tr style="border-top:1px solid var(--line)">
    <td style="padding:3px 7px;text-align:center;font-weight:800;white-space:nowrap;position:sticky;left:0;background:var(--card);z-index:2;border:1px solid var(--line);min-width:96px">${rw.name}<button class="mini" style="padding:0 6px;margin-left:4px;color:var(--red);font-size:10px" onclick="amRowDel('${rw.name.replace(/'/g,'')}')">✕</button></td>
    ${[1,2,3,4,5,6,7].map(d=>cellBtn(rw,d)).join('')}
    <td style="padding:3px 6px;text-align:center;font-weight:800;white-space:nowrap;border:1px solid var(--line)">${perH[rw.name]||0}h</td>
    ${tp==='PT'?`<td style="padding:3px 4px;text-align:center;border:1px solid var(--line)"><input inputmode="numeric" value="${rw.needH||''}" placeholder="—" style="width:42px;padding:2px;border:1px solid var(--line);border-radius:6px;text-align:center;background:var(--bg);color:var(--ink);font-size:12px" onchange="amRowSet('${rw.name.replace(/'/g,'')}','needH',Number(this.value)||0)">${diff!=null?`<span style="font-size:10px;font-weight:800;color:${Math.abs(diff)<2?'var(--green)':'#E8A657'}">${diff>0?'+':''}${Math.round(diff*10)/10}</span>`:''}</td>
    <td style="padding:3px 4px;text-align:center;border:1px solid var(--line)"><input inputmode="numeric" value="${rw.rate||''}" placeholder="196" style="width:48px;padding:2px;border:1px solid var(--line);border-radius:6px;text-align:center;background:var(--bg);color:var(--ink);font-size:12px" onchange="amRowSet('${rw.name.replace(/'/g,'')}','rate',Number(this.value)||0)"></td>
    <td style="padding:3px 6px;text-align:center;font-weight:800;color:var(--pdark);white-space:nowrap;border:1px solid var(--line)">${(perH[rw.name]||0)&&(rw.rate||196)?('$'+Math.round((perH[rw.name]||0)*4*(rw.rate||196)).toLocaleString()):'—'}</td>`:'<td style="border:1px solid var(--line)"></td><td style="border:1px solid var(--line)"></td><td style="border:1px solid var(--line)"></td>'}
    <td style="padding:3px 4px;border:1px solid var(--line);vertical-align:top"><textarea rows="${Math.min(6,Math.max(2,Math.ceil((rw.note||'').length/13)))}" placeholder="備註/限制" style="width:160px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:11.5px;line-height:1.4;resize:vertical;white-space:pre-wrap;word-break:break-word;font-family:inherit;box-sizing:border-box" onchange="amRowSet('${rw.name.replace(/'/g,'')}','note',this.value)">${(rw.note||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea></td></tr>` }).join('')
  const hourlyTbl = `<div class="scroll" style="margin-top:6px"><table style="border-collapse:collapse"><thead><tr><th style="padding:3px 6px">時段</th>${WD.map(w=>`<th style="padding:3px 8px">週${w}</th>`).join('')}</tr></thead><tbody>
    ${Array.from({length:13},(_,i)=>11+i).map(hh=>`<tr style="border-top:1px solid var(--line)"><td style="padding:2px 6px;white-space:nowrap" class="hint">${hh%24}-${(hh+1)%24||24}</td>
      ${hourly.map(hd=>{ const c=hd[hh%24]||0; return `<td style="padding:2px 8px;text-align:center;font-weight:800;${c===0?'color:#55617A':c<=2?'color:#E8A657':'color:var(--green)'}">${c||'·'}</td>` }).join('')}</tr>`).join('')}
    <tr style="border-top:2px solid var(--line)"><td class="hint" style="padding:3px 6px">人數(正+PT)</td>${dayPpl.map((n,i)=>`<td style="padding:3px 8px;text-align:center;font-weight:900">${n}<span class="hint" style="font-size:10px">(${n-dayPT[i]}+${dayPT[i]})</span></td>`).join('')}</tr>
  </tbody></table></div>`
  lpOverlay('amOv', `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:17px">🧩 AB 模組班表</b>
      <span style="display:inline-flex;gap:6px;flex-wrap:wrap">${(window._amD.mods||[]).map(md=>`<button class="mini${md.id===amCur?' on':''}" style="padding:4px 12px;font-weight:800" onclick="amCur='${md.id}';amDraw()">${md.name}</button>`).join('')}
      <button class="mini" style="padding:4px 10px" onclick="amModNew()">＋ 新模組</button><button class="mini" style="padding:4px 10px" onclick="amModRen()">改名</button><button class="mini" style="padding:4px 10px" onclick="amDict()">班別字典</button><button class="mini" style="padding:4px 10px" onclick="amRowAdd()">＋ 加人</button><button class="mini" style="padding:4px 10px" onclick="amReapply()">↻ 套班表名單</button></span>
      <button class="mini" style="padding:6px 14px" onclick="document.getElementById('amOv').remove()">關閉</button></div>
    <div style="display:flex;gap:10px;align-items:center;margin:8px 0;flex-wrap:wrap">
      <span class="hint">生效日</span><input type="date" value="${m.eff||''}" style="padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)" onchange="amMod().eff=this.value;amSave()">
      <input value="${(m.note||'').replace(/"/g,'&quot;')}" placeholder="組成條件備註（例：5正職＋PT假日）" style="flex:1;min-width:180px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font-size:13px" onchange="amMod().note=this.value;amSave()">
      <b style="color:var(--pdark)">四週人力成本預估 NT$${Math.round(cost).toLocaleString()}</b></div>
    <div class="scroll"><table style="border-collapse:collapse;width:100%"><thead><tr><th style="text-align:center;padding:3px 7px;position:sticky;left:0;background:var(--soft);z-index:3;border:1px solid var(--line);min-width:96px"></th>${WD.map(w=>`<th style="text-align:center;padding:3px 6px;border:1px solid var(--line);min-width:58px">週${w}</th>`).join('')}<th style="text-align:center;padding:3px 6px;border:1px solid var(--line)">週時數</th><th style="text-align:center;padding:3px 6px;border:1px solid var(--line)">PT需求</th><th style="text-align:center;padding:3px 6px;border:1px solid var(--line)">時薪</th><th style="text-align:center;padding:3px 6px;border:1px solid var(--line)">4週薪</th><th style="text-align:center;padding:3px 6px;border:1px solid var(--line);min-width:170px">備註</th></tr></thead><tbody>
      ${GRPS.map(([sub,tp])=>{ const mem=secG(sub,tp); if(!mem.length) return ''
        const col = sub==='內場'?'#F0A050':sub==='外場'?'#6EB1FF':'#9AA4B2'
        return `<tr><td style="padding:4px 7px;font-weight:900;color:${col};background:var(--soft);position:sticky;left:0;z-index:2;white-space:nowrap;border:1px solid var(--line)">${sub}${tp==='PT'?'・PT':'・正職'}（${mem.length}）</td>${WD.map(w=>`<td style="padding:3px 6px;text-align:center;font-weight:700;font-size:11px;color:${col};background:var(--soft);border:1px solid var(--line)">週${w}</td>`).join('')}<td colspan="5" style="background:var(--soft);border:1px solid var(--line)"></td></tr>${rowsHtml(sub,tp)}` }).join('')}
      ${(()=>{ const pts=m.rows.filter(r=>r.tp==='PT'); const totW=pts.reduce((t,r)=>t+(perH[r.name]||0),0); const totC=pts.reduce((t,r)=>t+(perH[r.name]||0)*4*(r.rate||196),0)
        return pts.length?`<tr><td colspan="8" style="padding:4px 7px;text-align:right;font-weight:900;background:var(--card)">PT 合計（${pts.length} 人・週 ${Math.round(totW*10)/10}h）</td><td colspan="2" style="padding:4px 6px;text-align:right;font-weight:900;color:var(--pdark);background:var(--card)">4週 $${Math.round(totC).toLocaleString()}</td><td colspan="3" style="background:var(--card)"></td></tr>`:'' })()}
    </tbody></table></div>
    <div style="margin-top:12px"><b>⏱ 單天逐時段人力</b> <span class="hint">灰·=0人、橘=1~2人、綠=3+；自動對照你 Excel 手工那張</span>${hourlyTbl}</div>
    <div style="margin-top:12px"><b>⚖️ 體檢（${vio.length ? `<span style="color:var(--red)">${vio.length} 個問題</span>` : '<span style="color:var(--green)">全部通過</span>'}）</b>
      ${vio.length?`<div style="margin-top:4px">${vio.slice(0,20).map(v=>`<div style="font-size:13px;color:var(--red);padding:2px 0">・${v}</div>`).join('')}</div>`:''}
      <div class="hint" style="font-size:12px;margin-top:4px">規則：四週變形（連上≤12天／班距≥11時／單日≤12時）＋PT 歷史劃假比對；確認流程（DD 逐人按鈕）第二期接上。</div></div>`)
}
function amCell(nm, d){
  const m = amMod(); const rw = m.rows.find(r=>r.name===nm); if (!rw) return
  const old = document.getElementById('amCellOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id='amCellOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,22,.5);z-index:75;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:300px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:10px">${nm}・週${['','一','二','三','四','五','六','日'][d]}</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">
      ${(m.dict||[]).map((dk,i)=>{ const cc=amColor(dk.code,dk); const on=rw.days[d]===i; return `<button style="padding:7px 12px;font-weight:800;border-radius:9px;cursor:pointer;border:1.5px solid ${cc};background:${on?cc:cc+'22'};color:${on?'#10141C':cc}" onclick="amCellSet('${nm.replace(/'/g,'')}',${d},${i})">${dk.code}<div style="font-size:9px;opacity:.8">${dk.s}-${dk.e}</div></button>` }).join('')}
      <button class="mini" style="padding:7px 12px;color:var(--red)" onclick="amCellSet('${nm.replace(/'/g,'')}',${d},-1)">✕ 清除</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function amCellSet(nm, d, i){ const rw = amMod().rows.find(r=>r.name===nm); if (!rw) return
  if (i<0) delete rw.days[d]; else rw.days[d]=i
  const o=document.getElementById('amCellOv'); if(o) o.remove()
  amSave(); amDraw() }
function amRowSet(nm, f, v){ const rw = amMod().rows.find(r=>r.name===nm); if (rw){ rw[f]=v; amSave(); amDraw() } }
function amRowDel(nm){ if(!confirm('把 '+nm+' 移出這個模組？')) return
  const m=amMod(); m.rows=m.rows.filter(r=>r.name!==nm); amSave(); amDraw() }
function amRowAdd(){ const nm=prompt('夥伴姓名'); if(!nm) return
  const tp=confirm('是 PT 嗎？（確定=PT、取消=正職）')?'PT':'正'
  const sub=confirm('是內場嗎？（確定=內場、取消=外場）')?'內場':'外場'
  amMod().rows.push({ name:nm.trim().slice(0,10), tp, sub, needH:0, rate:0, note:'', days:{} }); amSave(); amDraw() }
function amModNew(){ const nm=prompt('新模組名稱（例：11/2後）','模組'+String.fromCharCode(65+window._amD.mods.length)); if(!nm) return
  const cp=JSON.parse(JSON.stringify(amMod())); cp.id='m'+Date.now().toString(36); cp.name=nm.trim().slice(0,16); cp.eff=''
  window._amD.mods.push(cp); amCur=cp.id; amSave(); amDraw() }
function amModRen(){ const m=amMod(); const nm=prompt('模組改名', m.name); if(!nm) return; m.name=nm.trim().slice(0,16); amSave(); amDraw() }
function amDict(){
  const m = amMod()
  const old = document.getElementById('amDictOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id='amDictOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,22,.5);z-index:75;display:flex;align-items:center;justify-content:center;padding:16px'
  const draw = () => {
    ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:360px;width:100%;max-height:80vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:4px">班別字典</div><div class="hint" style="margin-bottom:10px">模組格子可選的班別；排 9 小時以上自動扣 1 小時休息</div>
    ${(m.dict||[]).map((dk,i)=>`<div style="display:flex;gap:6px;align-items:center;margin-bottom:7px">
<label style="position:relative;width:20px;height:20px;flex-shrink:0;cursor:pointer" title="點我改顏色"><span style="display:block;width:20px;height:20px;border-radius:50%;background:${amColor(dk.code,dk)};border:2px solid #39434F;box-sizing:border-box"></span><input type="color" value="${amColor(dk.code,dk)}" onchange="amMod().dict[${i}].color=this.value;amSave();document.getElementById('amDictOv').remove();amDict()" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"></label>
      <input value="${dk.code}" style="width:56px;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font-weight:800;text-align:center" onchange="amMod().dict[${i}].code=this.value.trim();amSave()">
      <input value="${dk.s}" style="width:64px;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);text-align:center" onchange="amMod().dict[${i}].s=this.value.trim();amSave()">
      <span class="hint">–</span>
      <input value="${dk.e}" style="width:64px;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);text-align:center" onchange="amMod().dict[${i}].e=this.value.trim();amSave()">
      <span class="hint" style="font-size:11px">${fmtHM(amSpanH(dk)*60)}</span>
      <button class="mini" style="padding:5px 9px;color:var(--red);margin-left:auto" onclick="amMod().dict.splice(${i},1);amSave();document.getElementById('amDictOv').remove();amDict()">✕</button></div>`).join('')}
    <button class="mini" style="padding:7px 14px" onclick="amMod().dict.push({code:'新',s:'12:00',e:'21:00'});amSave();document.getElementById('amDictOv').remove();amDict()">＋ 新增班別</button>
    <div style="text-align:right;margin-top:10px"><button class="mini on" style="padding:8px 16px" onclick="document.getElementById('amDictOv').remove();amDraw()">✓ 完成</button></div></div>`
  }
  draw()
  ov.onclick = () => { ov.remove(); amDraw() }
  document.body.appendChild(ov)
}

// ↻ 照班表重整名單 v4.47.1（張良「陳立航已離職核對班表；正職PT內外場照班表排序」）：套用現在班表的在職名單與分組，保留已填的格子
function amReapply(){
  if(!confirm('照現在班表重整這個模組的名單？\n（離職的移除、補內/外場分組、照班表排序；你已填的班別/備註/時薪會保留）')) return
  const m=amMod(); const fresh=amBuildRows(window._amD)
  const byName={}; m.rows.forEach(r=>byName[r.name]=r)
  m.rows = fresh.map(f=>{ const old=byName[f.name]; return old?{...f, days:old.days||{}, needH:old.needH||0, rate:old.rate||0, note:old.note||''}:f })
  amSave(); amDraw()
  lpToast('✓ 已照班表重整（'+m.rows.length+' 人）')
}
