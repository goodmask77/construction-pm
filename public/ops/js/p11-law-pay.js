// ── ⚖️ 勞基法檢查 + 💰 薪資表 v4.33.0（張良 2026-10-04：台灣餐飲業 2026 法規對照排班/打卡逐條檢查；雙店薪資條給會計師/稽核，可複製圖片/匯出表格）──
// 依拆檔政策（v4.40.0）新功能獨立一檔；共用全域：window._shiftD / window._shRows / window._shPer / shiftYm / shMergedAb / TK / K / r1
// ⚠️ r1 在 p05-shift.js 裡是「函式內 const」不是全域（v4.40.8 治本：shift 頁 Uncaught ReferenceError: r1 is not defined 崩頁,張良 2026-10-04 05:56 錯誤回報）→ 這裡自備同款全域保險
window.r1 = window.r1 || ((x) => Math.round(x * 10) / 10)

function lpToast(t){ const old=document.getElementById('lpToast'); if(old) old.remove()
  const b=document.createElement('div'); b.id='lpToast'
  b.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:90;background:#10182B;color:#fff;border-radius:10px;padding:9px 18px;font-size:14px;white-space:nowrap'
  b.textContent=t; document.body.appendChild(b); setTimeout(()=>b.remove(),2200) }
function lpOverlay(id, inner){ const old=document.getElementById(id); if(old) old.remove()
  const ov=document.createElement('div'); ov.id=id
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:66;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow:auto'
  ov.innerHTML=`<div style="background:#1C2430;border:1px solid #3B4654;border-radius:14px;max-width:1120px;width:100%;padding:16px;margin:auto 0" onclick="event.stopPropagation()">${inner}</div>`
  ov.onclick=()=>ov.remove(); document.body.appendChild(ov); return ov }

// 2026 法定基準（已查證：基本工資 2026-01-01 起月薪 29,500／時薪 196）
const LP_MIN_HOURLY = 196, LP_MIN_MONTHLY = 29500

// AB 當月出勤彙總（NUEiP 實際打卡 durmin；法規+薪資共用）
function lpAbAgg(){ const d=window._shiftD||{}; const out={}
  // v4.33.2 四週變形工時：加班起算=當日 NUEiP 排定時數（排定最多認10h、查不到排班=8h）
  const t2m9=t=>{ const a=String(t||'').split(':'); return (+a[0]||0)*60+(+a[1]||0) }
  const schedMap={}
  ;(typeof shMergedAb==='function'?shMergedAb():[]).forEach(x=>{ if(!x.start||!x.end||/休|例/.test(x.code||'')) return
    let sp=t2m9(x.end)-t2m9(x.start); if(sp<=0) sp+=1440
    schedMap[x.name+'|'+x.date]=Math.min(10,Math.max(8,(sp-(sp>=540?60:0))/60)) }) // 跨午夜處理；排9h以上預設含1h休
  ;(d.abAtt||[]).forEach(a=>{ if(!String(a.date||'').startsWith(shiftYm)) return
    const o=out[a.name]=out[a.name]||{h:0,ot1:0,ot2:0,days:[],late:0,flags:new Set(),daily:{}}
    const h=+a.h||0; const base9=schedMap[a.name+'|'+a.date]||8; const ot=Math.max(0,h-base9)
    o.h+=h; o.ot1+=Math.min(ot,2); o.ot2+=Math.max(0,ot-2)
    if(h>0){ o.days.push(a.date); o.daily[a.date]=h }
    if(h>12) o.flags.add('單日'+r1(h)+'h>12h('+a.date.slice(5)+')')
    o.late+=a.late||0 })
  Object.values(out).forEach(o=>{ const ds=[...new Set(o.days)].sort(); let run=1
    for(let i=1;i<ds.length;i++){ const gap=(new Date(ds[i])-new Date(ds[i-1]))/86400e3; run=gap===1?run+1:1; if(run>12){ o.flags.add('連上超過12天（四週變形例假不足）'); break } }
    if(o.ot1+o.ot2>46) o.flags.add('月加班'+r1(o.ot1+o.ot2)+'h＞46h') })
  return out }

// ⚖️ 法規逐條檢查（對照本月 GD 打卡實測 + AB NUEiP 出勤/排班）
function lawView(){
  const rows=window._shRows||[], per=window._shPer||{}, abAgg=lpAbAgg(), d=window._shiftD||{}
  const t2m=hm=>{ const a=String(hm||'').split(':'); return (+a[0]||0)*60+(+a[1]||0) }
  // 班距<11h（§34）：GD=打卡（前日最後下班→次日最早上班）；AB=NUEiP 排班時間
  const gapBad=[]
  { const byN={}; rows.forEach(r=>{ (byN[r.name]=byN[r.name]||{})[r.date]=r })
    for(const [nm,ds] of Object.entries(byN)){ const dts=Object.keys(ds).sort()
      for(let i=1;i<dts.length;i++){ const a=ds[dts[i-1]], b=ds[dts[i]]
        if((new Date(dts[i])-new Date(dts[i-1]))/86400e3!==1 || !a.lastOut || !b.firstIn) continue
        const gap=(1440-t2m(a.lastOut))+t2m(b.firstIn)
        if(gap<660) gapBad.push(`GD ${nm} ${dts[i-1].slice(5)}→${dts[i].slice(5)} 僅隔${r1(gap/60)}h`) } }
    const abBy={}; (typeof shMergedAb==='function'?shMergedAb():[]).forEach(x=>{ if(String(x.date||'').startsWith(shiftYm)&&x.start&&x.end&&!/休|例/.test(x.code||'')) (abBy[x.name]=abBy[x.name]||{})[x.date]=x })
    for(const [nm,ds] of Object.entries(abBy)){ const dts=Object.keys(ds).sort()
      for(let i=1;i<dts.length;i++){ const a=ds[dts[i-1]], b=ds[dts[i]]
        if((new Date(dts[i])-new Date(dts[i-1]))/86400e3!==1) continue
        let endM=t2m(a.end); if(endM<=t2m(a.start)) endM+=1440 // 跨午夜(15:00-00:00)
        const gap=(1440-(endM%1440===0?1440:endM%1440))+t2m(b.start)
        if(gap<660&&gap>0) gapBad.push(`AB ${nm} ${dts[i-1].slice(5)}→${dts[i].slice(5)} 排班僅隔${r1(gap/60)}h`) } } }
  // 彙整各條狀態
  const gdOver12=rows.filter(r=>r.over12).map(r=>`GD ${r.name} ${r.date.slice(5)}（${r1(r.h)}h）`)
  const abOver12=[]; Object.entries(abAgg).forEach(([nm,o])=>[...o.flags].filter(f=>f.includes('>12h')).forEach(f=>abOver12.push('AB '+nm+' '+f)))
  const ot46=[...Object.entries(per).filter(([,p])=>p.ot1+p.ot2>46).map(([nm,p])=>`GD ${nm}（${r1(p.ot1+p.ot2)}h）`), ...Object.entries(abAgg).filter(([,o])=>o.ot1+o.ot2>46).map(([nm,o])=>`AB ${nm}（${r1(o.ot1+o.ot2)}h）`)]
  const run12=[...Object.entries(per).filter(([,p])=>[...p.flags].some(f=>f.includes('連上超過12天'))).map(([nm])=>'GD '+nm), ...Object.entries(abAgg).filter(([,o])=>[...o.flags].some(f=>f.includes('連上超過12天'))).map(([nm])=>'AB '+nm)]
  // 每2週至少2例假（§36 四週變形版）：任意連續14天內工作≥13天=例假不足
  const biw=[]
  { const addBi=(tag,nm,dates)=>{ const ds=[...new Set(dates)].sort(); for(let i=0;i<ds.length;i++){ const d0=new Date(ds[i]); let c=0; for(const d2 of ds){ const diff=(new Date(d2)-d0)/86400e3; if(diff>=0&&diff<14) c++ } if(c>=13){ biw.push(`${tag} ${nm}（${ds[i].slice(5)}起14天內上了${c}天）`); return } } }
    Object.entries(per).forEach(([nm,p])=>addBi('GD',nm,p.days||[]))
    Object.entries(abAgg).forEach(([nm,o])=>addBi('AB',nm,o.days||[])) }
  const over8=rows.filter(r=>r.h>8&&!r.over12).length + Object.values(abAgg).reduce((t,o)=>t+Object.values(o.daily).filter(h=>h>8&&h<=12).length,0)
  const brkBad=rows.filter(r=>r.s&&r.h>4&&!((+r.s.break||0)>=30)).map(r=>`GD ${r.name} ${r.date.slice(5)}（班表休息${r.s.break||0}分）`)
  const rates=(d.payRates)||{}
  const lowPay=Object.entries(rates).filter(([,v])=>v.base>0&&v.base<LP_MIN_HOURLY).map(([nm,v])=>`${nm}（時薪${v.base}）`)
  const noPay=[...new Set([...Object.keys(per),...Object.keys(abAgg)])].filter(nm=>!(rates[nm]&&rates[nm].base>0))
  const holWork=(typeof shMergedAb==='function'?shMergedAb():[]).filter(x=>String(x.date||'').startsWith(shiftYm)&&/國/.test(x.code||'')).map(x=>`AB ${x.name} ${x.date.slice(5)}（代碼「${x.code}」）`)
  const st=(s)=>s==='ok'?'<span style="color:var(--green);font-weight:900">✓ 合規</span>':s==='warn'?'<span style="color:#E8A657;font-weight:900">⚠ 需注意</span>':s==='bad'?'<span style="color:var(--red);font-weight:900">✗ 可能違規</span>':'<span class="hint" style="font-weight:800">ℹ 需人工確認</span>'
  const CK=[
    {art:'最低工資法（2026）', rule:'2026-01-01 起基本工資：月薪 29,500／時薪 196', s:lowPay.length?'bad':(noPay.length?'info':'ok'), det:lowPay.join('、')||(noPay.length?'尚未填時薪：'+noPay.slice(0,8).join('、')+(noPay.length>8?'…':''):'已填的時薪都 ≥196'), fix:lowPay.length?'把低於 196 的時薪調上來（薪資表直接改）':'到「薪資表」補齊每人時薪，之後自動盯'},
    {art:'勞基法 §30-1（四週變形）', rule:'餐飲業適用：每日正常工時可排到 10h、4 週正常工時總計 ≤160h；前提=經工會或勞資會議同意並公告週期', s:'info', det:'已套用四週變形模式：加班改以「當日排定時數」起算（排定最多認 10h）', fix:'勞資會議同意書與 4 週週期表要留存備查（勞檢第一個就看這個）'},
    {art:'勞基法 §32', rule:'含加班每日上限 12h；每月加班上限 46h（變形工時不豁免）', s:(gdOver12.length+abOver12.length+ot46.length)?'bad':'ok', det:[...gdOver12,...abOver12,...ot46].join('、')||'無人超標', fix:'超過 12h／46h 屬違法，請調整排班分流或加人'},
    {art:'勞基法 §36（變形版例假）', rule:'四週變形：每 2 週至少 2 日例假、每 4 週例假＋休息日合計至少 8 日（七休一不適用）', s:(run12.length+biw.length)?'bad':'ok', det:[...run12,...biw].join('、')||'每 2 週都有至少 2 天沒出勤', fix:'14 天內至少排 2 天例假；連上超過 12 天絕對紅線'},
    {art:'勞基法 §34（班距）', rule:'輪班換班間隔至少 11 小時', s:gapBad.length?'bad':'ok', det:gapBad.slice(0,10).join('、')+(gapBad.length>10?`…共${gapBad.length}筆`:'')||'班距皆 ≥11h', fix:'晚班接早班最容易踩——兩班之間至少留 11 小時'},
    {art:'勞基法 §35（休息）', rule:'連續工作 4 小時至少休息 30 分鐘', s:brkBad.length?'warn':'ok', det:brkBad.slice(0,8).join('、')||'GD 班表休息欄皆 ≥30 分；AB 請依現場輪休確認', fix:'把班表「休(分)」填 30 以上；AB 由店長確認現場有輪休'},
    {art:'勞基法 §24（加班費率）', rule:'平日加班前 2h ×1.34、第 3-4h ×1.67', s:'ok', det:'薪資表已按 1.34／1.67 自動計算', fix:'—'},
    {art:'勞基法 §37/§39（國定假日）', rule:'國定假日出勤工資加倍（或經同意補休）', s:holWork.length?'warn':'info', det:holWork.join('、')||'本月 NUEiP 無「國」代碼出勤；GD 需人工比對行事曆', fix:'國定假日有上班的人，薪資表加倍欄請人工加上或給補休'},
    {art:'勞基法 §38（特休）', rule:'滿 6 個月 3 天、滿 1 年 7 天…依年資遞增', s:'info', det:'系統缺完整到職日資料，暫無法自動核', fix:'名冊補齊到職日後可自動對照特休餘額'},
  ]
  lpOverlay('lawOv',`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:17px">⚖️ 勞基法檢查・${shiftYm}</b>
      <span class="hint">依據：GD＝打卡實測｜AB＝NUEiP 出勤/排班｜台灣 2026 現行法規・<b style="color:var(--pdark)">已套用四週變形工時（餐飲業）</b></span>
      <button class="mini" style="padding:6px 14px" onclick="document.getElementById('lawOv').remove()">關閉</button></div>
    <div class="scroll" style="margin-top:10px"><table style="border-collapse:collapse;width:100%"><thead>
      <tr><th style="text-align:left;padding:6px 8px;white-space:nowrap">條文</th><th style="text-align:left;padding:6px 8px">規定（白話）</th><th style="padding:6px 8px;white-space:nowrap;text-align:center">狀態</th><th style="text-align:left;padding:6px 8px">檢查結果</th><th style="text-align:left;padding:6px 8px">修正建議</th></tr></thead><tbody>
      ${CK.map(c=>`<tr style="border-top:1px solid var(--line)"><td style="padding:7px 8px;font-weight:800;white-space:nowrap;vertical-align:top">${c.art}</td><td style="padding:7px 8px;vertical-align:top;min-width:150px;text-align:left">${c.rule}</td><td style="padding:7px 8px;text-align:center;white-space:nowrap;vertical-align:top">${st(c.s)}</td><td style="padding:7px 8px;vertical-align:top;font-size:13px;text-align:left;${c.s==='bad'?'color:var(--red);font-weight:700':''}">${c.det}</td><td style="padding:7px 8px;vertical-align:top;font-size:13px;text-align:left" class="hint">${c.fix}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="hint" style="margin-top:8px">提醒：這是排班／出勤面的自動檢查，正式申報仍以勞保局・勞動部函釋為準；AB 打卡資料來自 NUEiP 每日同步。</div>`)
}

// 💰 薪資表（GD 打卡 + AB NUEiP 出勤；時薪/加給可填，本薪/加班費自動算）
function payView(){
  const d=window._shiftD||{}, per=window._shPer||{}, abAgg=lpAbAgg(), rates=d.payRates||{}
  const meN=d.me?d.me.name:null
  const ppl=[...Object.keys(per).map(n=>({store:'GD',n,o:per[n]})), ...Object.keys(abAgg).map(n=>({store:'AB',n,o:abAgg[n]}))]
    .filter(x=>x.o.h>0).sort((a,b)=>a.store.localeCompare(b.store)||b.o.h-a.o.h)
  const rows=ppl.map(x=>{ const rt=rates[x.n]||{}, base=+rt.base||0, allow=+rt.allow||0
    const reg=Math.max(0,x.o.h-x.o.ot1-x.o.ot2)
    const basePay=Math.round(reg*base), ot1Pay=Math.round(x.o.ot1*base*1.34), ot2Pay=Math.round(x.o.ot2*base*1.67)
    return {...x, base, allow, reg, basePay, ot1Pay, ot2Pay, total:basePay+ot1Pay+ot2Pay+allow} })
  window._payRows=rows
  const nt=n=>n?n.toLocaleString('en-US'):'0'
  const sum=k=>rows.reduce((t,r)=>t+r[k],0)
  // 表格用「紙本」配色（黑字白底、純 inline 樣式）＝複製圖片/給會計師列印都清楚
  const TD='border:1px solid #8a8f98;padding:5px 8px;font-size:13px;color:#111;text-align:right;white-space:nowrap'
  const TDL=TD.replace('right','left')
  const TH='border:1px solid #8a8f98;padding:6px 8px;font-size:12.5px;background:#eef1f5;color:#111;font-weight:800;white-space:nowrap'
  const tbl=`<div id="payTblWrap" style="background:#fff;padding:14px;border-radius:10px">
    <div style="color:#111;font-weight:900;font-size:15px;padding-bottom:8px">GROUN:D × A Beach 薪資表　${shiftYm}　<span style="font-weight:600;font-size:12px;color:#555">GD＝打卡實測工時｜AB＝NUEiP 出勤工時｜加班費率 §24：前2h×1.34、後2h×1.67｜四週變形：加班以當日排定時數起算</span></div>
    <table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="${TH}">店</th><th style="${TH};text-align:left">姓名</th><th style="${TH}">正常時數</th><th style="${TH}">加班1.34</th><th style="${TH}">加班1.67</th><th style="${TH}">時薪</th><th style="${TH}">本薪</th><th style="${TH}">加班費1.34</th><th style="${TH}">加班費1.67</th><th style="${TH}">加給</th><th style="${TH}">應發合計</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td style="${TDL}">${r.store}</td><td style="${TDL};font-weight:800">${r.n}</td><td style="${TD}">${r1(r.reg)}</td><td style="${TD}">${r.o.ot1?r1(r.o.ot1):'—'}</td><td style="${TD}">${r.o.ot2?r1(r.o.ot2):'—'}</td>
      <td style="${TD};${r.base&&r.base<LP_MIN_HOURLY?'color:#C00;font-weight:800':''}">${r.base||'未填'}</td>
      <td style="${TD}">${nt(r.basePay)}</td><td style="${TD}">${nt(r.ot1Pay)}</td><td style="${TD}">${nt(r.ot2Pay)}</td><td style="${TD}">${nt(r.allow)}</td><td style="${TD};font-weight:900">${nt(r.total)}</td></tr>`).join('')}
    <tr><td style="${TDL};font-weight:900" colspan="6">合計（${rows.length} 人）</td><td style="${TD};font-weight:900">${nt(sum('basePay'))}</td><td style="${TD};font-weight:900">${nt(sum('ot1Pay'))}</td><td style="${TD};font-weight:900">${nt(sum('ot2Pay'))}</td><td style="${TD};font-weight:900">${nt(sum('allow'))}</td><td style="${TD};font-weight:900">${nt(sum('total'))}</td></tr>
    </tbody></table>
    <div style="color:#555;font-size:11px;padding-top:6px">本表為工時×費率自動試算，勞健保/勞退/請假扣款請由會計另計。產表：${new Date(Date.now()+8*3600e3).toISOString().slice(0,16).replace('T',' ')}</div></div>`
  const rateEd = meN?`<div style="margin-top:10px"><b>費率設定</b> <span class="hint">時薪（基本工資 2026＝196 起）／加給＝固定月加給；改完自動存、留誰改的</span>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">${ppl.map(x=>`<span style="display:inline-flex;gap:4px;align-items:center;background:var(--soft);border:1px solid var(--line);border-radius:9px;padding:4px 8px;font-size:13px"><b>${x.n}</b>
      時薪<input inputmode="numeric" value="${(rates[x.n]||{}).base||''}" placeholder="196" style="width:52px;padding:2px;border:1px solid var(--line);border-radius:6px;text-align:center" onchange="paySetRate('${x.n}','base',this.value)">
      加給<input inputmode="numeric" value="${(rates[x.n]||{}).allow||''}" placeholder="0" style="width:62px;padding:2px;border:1px solid var(--line);border-radius:6px;text-align:center" onchange="paySetRate('${x.n}','allow',this.value)"></span>`).join('')}</div></div>`:''
  lpOverlay('payOv',`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:17px">💰 薪資表・${shiftYm}</b>
      <span style="display:inline-flex;gap:8px"><button class="mini" style="padding:6px 14px" onclick="payCopyImg()">📸 複製圖片</button><button class="mini" style="padding:6px 14px" onclick="payCsv()">⬇️ 匯出表格</button><button class="mini" style="padding:6px 14px" onclick="document.getElementById('payOv').remove()">關閉</button></span></div>
    <div class="scroll" style="margin-top:10px">${tbl}</div>${rateEd}`)
}
async function paySetRate(name, field, val){
  const d=window._shiftD||{}; d.payRates=d.payRates||{}; d.payRates[name]=d.payRates[name]||{}; d.payRates[name][field]=Number(val)||0
  const r=await fetch('/api/mail-sync?payset='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),name,field,val})}).then(x=>x.json()).catch(()=>null)
  if(!r||!r.ok){ alert((r&&r.error)||'沒存成功'); return }
  d.payRates=r.rates; payView() // 重算重畫
}
function payCsv(){
  const rows=window._payRows||[]; if(!rows.length){ lpToast('沒有資料'); return }
  let csv='\ufeff店別,姓名,正常時數,加班1.34時數,加班1.67時數,時薪,本薪,加班費1.34,加班費1.67,加給,應發合計\n'
  rows.forEach(r=>{ csv+=[r.store,r.n,r1(r.reg),r1(r.o.ot1),r1(r.o.ot2),r.base,r.basePay,r.ot1Pay,r.ot2Pay,r.allow,r.total].join(',')+'\n' })
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='薪資表_'+shiftYm+'.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000)
  lpToast('⬇️ 已下載 薪資表_'+shiftYm+'.csv')
}
async function payCopyImg(){
  const node=document.getElementById('payTblWrap'); if(!node) return
  try{
    const w=Math.min(1600,node.scrollWidth+4), hgt=node.scrollHeight+4
    const html='<div xmlns="http://www.w3.org/1999/xhtml">'+node.outerHTML.replace(/&nbsp;/g,' ')+'</div>'
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><foreignObject width="100%" height="100%" style="font-family:-apple-system,'PingFang TC',sans-serif">${html}</foreignObject></svg>`
    const img=new Image(); const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}))
    await new Promise((ok,bad)=>{ img.onload=ok; img.onerror=bad; img.src=url })
    const cv=document.createElement('canvas'); cv.width=w*2; cv.height=hgt*2
    const cx=cv.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,cv.width,cv.height); cx.scale(2,2); cx.drawImage(img,0,0); URL.revokeObjectURL(url)
    cv.toBlob(async b=>{ try{ await navigator.clipboard.write([new ClipboardItem({'image/png':b})]); lpToast('📸 薪資表圖片已複製，直接貼上即可') }catch(e){ lpToast('這台裝置不給複製圖片——請改用「⬇️ 匯出表格」') } },'image/png')
  }catch(e){ lpToast('複製圖片失敗——請改用「⬇️ 匯出表格」') }
}

// ── 🔴 班表違規地圖 v4.33.3（張良「班表上發現違規的 直接在該欄位紅色發光提醒」）──
// 回 {g:{'名|日':[原因]}, a:{...}}；規則=四週變形版：單日>12h(排班或實際)、班距<11h、連上第13天起
function shVioCompute(gdRows){
  const t2m=t=>{ const x=String(t||'').split(':'); return (+x[0]||0)*60+(+x[1]||0) }
  const addV=(m,k,r)=>{ (m[k]=m[k]||[]).push(r) }
  // v4.33.4 誤報治本（張良「為什麼一堆在閃紅光」）：同人同天兼多崗位=多筆「同時段」紀錄，加總會變24h
  // → 改「區間合併」：重疊時段只算一次，真正分段班（早+晚）才相加
  const pushIv=(o,dt,sM,eM,brk)=>{ const p=o[dt]=o[dt]||{iv:[],brk:0}; p.iv.push([sM,eM]); p.brk=Math.max(p.brk,brk||0) }
  const dayCalc=(p)=>{ const iv=p.iv.sort((x,y)=>x[0]-y[0]); let tot=0,cs=null,ce=null,mn=99999,mx=-1
    for(const [s0,e0] of iv){ mn=Math.min(mn,s0); mx=Math.max(mx,e0)
      if(cs===null){ cs=s0; ce=e0 } else if(s0<=ce){ ce=Math.max(ce,e0) } else { tot+=ce-cs; cs=s0; ce=e0 } }
    if(cs!==null) tot+=ce-cs
    return { h: Math.max(0,(tot-p.brk))/60, min:mn, max:mx }
  }
  const scanSched=(map, out)=>{
    for(const [nm,ds] of Object.entries(map)){
      const dts=Object.keys(ds).sort(); let run=1
      const cal={}; dts.forEach(dt=>{ cal[dt]=dayCalc(ds[dt]) })
      dts.forEach(dt=>{ if(cal[dt].h>12) addV(out,nm+'|'+dt,'排班'+Math.round(cal[dt].h*10)/10+'h>12h') })
      for(let i=1;i<dts.length;i++){
        const gap1=(new Date(dts[i])-new Date(dts[i-1]))/86400e3
        if(gap1===1){
          run++
          if(cal[dts[i]].min<99999&&cal[dts[i-1]].max>-1){
            const rest=cal[dts[i]].min+1440-cal[dts[i-1]].max
            if(rest<660&&rest>0) addV(out,nm+'|'+dts[i],'與前一天班距'+(Math.round(rest/6)/10)+'h<11h')
          }
        } else run=1
        if(run>12) addV(out,nm+'|'+dts[i],'連上第'+run+'天(四週變形例假不足)')
      }
    }
  }
  const g={}, a={}
  // GD 排班（同時段多崗位→合併）
  const gs={}
  ;(typeof shMergedSched==='function'?shMergedSched():[]).forEach(x=>{ if(!x.date||!x.name||!x.start||!x.end) return
    let eM=t2m(x.end); if(eM<=t2m(x.start)) eM+=1440
    pushIv(gs[x.name]=gs[x.name]||{}, x.date, t2m(x.start), eM, +x.break||0) })
  scanSched(gs,g)
  ;(gdRows||[]).forEach(r=>{ if(r.over12) addV(g,r.name+'|'+r.date,'實際'+r1(r.h)+'h>12h') })
  // AB 排班（NUEiP；休/例不算工作日）
  const as={}
  // v4.33.5 誤判治本（張良「●是沒排班的意思 怎麼可能連上47天」）：●/⚫＝未排班、沒帶上下班時間的列＝不算工作日——只有「真的有排時段」才進連上/班距/12h計算
  ;(typeof shMergedAb==='function'?shMergedAb():[]).forEach(x=>{ if(!x.name||!x.date||/休|例|●|⚫/.test(x.code||'')) return
    if(!(x.start&&x.end)) return
    let eM=t2m(x.end); if(eM<=t2m(x.start)) eM+=1440; const sp=eM-t2m(x.start)
    pushIv(as[x.name]=as[x.name]||{}, x.date, t2m(x.start), eM, sp>=540?60:0) })
  scanSched(as,a)
  ;(((window._shiftD||{}).abAtt)||[]).forEach(x=>{ if((+x.h||0)>12) addV(a,x.name+'|'+x.date,'實際'+x.h+'h>12h') })
  return { g, a }
}
// 🔴 違規清單面板（張良「我要去哪裡確認是什麼問題」）：工具列紅色「違規 N」鈕點開＝每筆誰/哪天/什麼問題
function shVioList(){
  const V=shVioCompute(window._shRows||[])
  const L=[]
  for(const [k,rs] of Object.entries(V.g||{})){ const [nm,dt]=k.split('|'); rs.forEach(r=>L.push({st:'GD',nm,dt,r})) }
  for(const [k,rs] of Object.entries(V.a||{})){ const [nm,dt]=k.split('|'); rs.forEach(r=>L.push({st:'AB',nm,dt,r})) }
  L.sort((x,y)=>x.dt<y.dt?-1:x.dt>y.dt?1:0)
  lpOverlay('vioOv',`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:17px">🔴 班表違規清單</b>
      <span class="hint">和班表上發紅光的格子一一對應；規則＝四週變形（單日12h／班距11h／連13天）</span>
      <button class="mini" style="padding:6px 14px" onclick="document.getElementById('vioOv').remove()">關閉</button></div>
    ${L.length?`<div class="scroll" style="margin-top:10px"><table style="border-collapse:collapse;width:100%"><thead><tr><th style="padding:5px 8px">店</th><th style="padding:5px 8px">日期</th><th style="text-align:left;padding:5px 8px">夥伴</th><th style="text-align:left;padding:5px 8px">問題</th></tr></thead><tbody>
      ${L.map(x=>`<tr style="border-top:1px solid var(--line)"><td style="padding:6px 8px;text-align:center">${x.st}</td><td style="padding:6px 8px;white-space:nowrap">${x.dt.slice(5)}</td><td style="padding:6px 8px;font-weight:800">${x.nm}</td><td style="padding:6px 8px;color:var(--red);font-weight:700">${x.r}</td></tr>`).join('')}
    </tbody></table></div><div class="hint" style="margin-top:8px">想看法條層面的整體體檢 → 工具列「⚖️ 法規」。</div>`:`<div class="mut" style="margin-top:12px">目前已載入的班表沒有違規 🎉</div>`}`)
}

// ── 🕐 AB 出勤總覽 v4.36.0（張良「6/1起所有打卡紀錄,看出遲到/沒打卡,每人總紀錄,像營業額那樣好查」）──
let abaMo = 'all', abaSort = { k: 'late', dir: -1 }
async function abAttView(){
  if (!window._abaD) {
    lpOverlay('abaOv', '<div class="hint" style="padding:20px">讀取 6 月起全部打卡紀錄中…</div>')
    const r = await fetch('/api/mail-sync?abatt=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK()) + '&from=2026-06').then(x=>x.json()).catch(()=>null)
    if (!r || !r.ok) { lpOverlay('abaOv', `<div style="padding:16px">🔒 ${(r&&r.error)||'讀不到出勤資料'}</div>`); return }
    window._abaD = r.rows
  }
  abAttDraw()
}
function abAttDraw(){
  const all = window._abaD || []
  const mos = [...new Set(all.map(x=>x.d.slice(0,7)))].sort()
  const rows = all.filter(x => abaMo==='all' || x.d.startsWith(abaMo))
  // 每人彙總
  const per = {}
  rows.forEach(x=>{ const o = per[x.n] = per[x.n] || { n:x.n, days:0, h:0, late:0, lateMin:0, early:0, miss:0, abs:0 }
    if (x.h>0 || x.on) o.days++
    o.h += x.h; if (x.late>0){ o.late++; o.lateMin += x.late } if (x.early>0) o.early++; if (x.miss) o.miss++; if (x.abs) o.abs++ })
  let list = Object.values(per).map(o=>({ ...o, h: Math.round(o.h*10)/10, avg: o.days? Math.round(o.h/o.days*10)/10 : 0 }))
  const k = abaSort.k
  list.sort((a,b)=>((a[k]||0)-(b[k]||0))*abaSort.dir || b.h-a.h)
  const arrow9 = kk => `<span style="display:inline-block;width:12px;font-size:10px;text-align:center">${abaSort.k===kk?(abaSort.dir>0?'▲':'▼'):''}</span>`
  const TH9 = (kk,lb)=>`<th style="padding:5px 8px;text-align:right;cursor:pointer;white-space:nowrap;user-select:none" onclick="abaSort=abaSort.k==='${kk}'?{k:'${kk}',dir:-abaSort.dir}:{k:'${kk}',dir:-1};abAttDraw()">${lb}${arrow9(kk)}</th>`
  const moBtn = (v,lb)=>`<button class="mini${abaMo===v?' on':''}" style="padding:4px 12px;font-weight:800" onclick="abaMo='${v}';abAttDraw()">${lb}</button>`
  const tot = { days: list.reduce((t,o)=>t+o.days,0), late: list.reduce((t,o)=>t+o.late,0), miss: list.reduce((t,o)=>t+o.miss,0), abs: list.reduce((t,o)=>t+o.abs,0) }
  lpOverlay('abaOv', `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:17px">🕐 A Beach 出勤總覽</b>
      <span class="hint">NUEiP 打卡・6/1 起已回補｜點欄頭排序、點名字看逐日明細</span>
      <button class="mini" style="padding:6px 14px" onclick="document.getElementById('abaOv').remove()">關閉</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">${moBtn('all','全部')}${mos.map(m=>moBtn(m, m.slice(2).replace('-','/'))).join('')}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px" class="hint">共 ${tot.days} 人日｜遲到 ${tot.late} 次｜缺卡 ${tot.miss} 次｜曠職 ${tot.abs} 次</div>
    <div class="scroll"><table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="padding:5px 8px;text-align:left">夥伴</th>${TH9('days','出勤天')}${TH9('h','總時數')}${TH9('avg','日均')}${TH9('late','遲到次')}${TH9('lateMin','遲到分')}${TH9('early','早退次')}${TH9('miss','缺卡')}${TH9('abs','曠職')}</tr></thead><tbody>
      ${list.map(o=>`<tr style="border-top:1px solid var(--line)">
        <td style="padding:5px 8px;font-weight:800;white-space:nowrap;cursor:pointer;text-decoration:underline dotted" title="點我看逐日明細" onclick="abAttPerson('${o.n.replace(/'/g,'')}')">${o.n}</td>
        <td style="padding:5px 8px;text-align:right">${o.days}</td><td style="padding:5px 8px;text-align:right;font-weight:700">${o.h}</td><td style="padding:5px 8px;text-align:right" class="hint">${o.avg}</td>
        <td style="padding:5px 8px;text-align:right;${o.late?'color:#E8A657;font-weight:800':''}">${o.late||'—'}</td>
        <td style="padding:5px 8px;text-align:right;${o.lateMin?'color:#E8A657':''}">${o.lateMin||'—'}</td>
        <td style="padding:5px 8px;text-align:right;${o.early?'color:#E8A657':''}">${o.early||'—'}</td>
        <td style="padding:5px 8px;text-align:right;${o.miss?'color:var(--red);font-weight:800':''}">${o.miss||'—'}</td>
        <td style="padding:5px 8px;text-align:right;${o.abs?'color:var(--red);font-weight:900':''}">${o.abs||'—'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="hint" style="margin-top:8px">補卡紀錄 NUEiP 匯出沒帶旗標，先以「缺卡」欄代位；時數=NUEiP 核定工時。</div>`)
}
function abAttPerson(nm){
  const all = (window._abaD||[]).filter(x=>x.n===nm && (abaMo==='all' || x.d.startsWith(abaMo))).sort((a,b)=>a.d<b.d?1:-1)
  const stTx = x => [x.abs?'<b style="color:var(--red)">曠職</b>':'', x.miss?'<b style="color:var(--red)">缺卡</b>':'', x.late>0?`<b style="color:#E8A657">遲到${x.late}分</b>`:'', x.early>0?`<b style="color:#E8A657">早退${x.early}分</b>`:''].filter(Boolean).join('、') || '<span style="color:var(--green)">✓</span>'
  lpOverlay('abaPOv', `
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16.5px">🕐 ${nm}・逐日打卡（${abaMo==='all'?'全部':abaMo}）</b>
      <button class="mini" style="padding:6px 14px" onclick="document.getElementById('abaPOv').remove()">關閉</button></div>
    <div class="scroll" style="margin-top:8px"><table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="padding:4px 8px;text-align:left">日期</th><th style="padding:4px 8px">班別</th><th style="padding:4px 8px">上班卡</th><th style="padding:4px 8px">下班卡</th><th style="padding:4px 8px;text-align:right">時數</th><th style="padding:4px 8px;text-align:left">狀態</th></tr></thead><tbody>
      ${all.map(x=>`<tr style="border-top:1px solid var(--line);font-size:13px">
        <td style="padding:4px 8px;white-space:nowrap">${x.d.slice(5)}（${'日一二三四五六'[new Date(x.d).getDay()]}）</td>
        <td style="padding:4px 8px;text-align:center">${x.w||'—'}</td>
        <td style="padding:4px 8px;text-align:center;${!x.on&&!x.abs?'color:var(--red)':''}">${x.on||'—'}</td>
        <td style="padding:4px 8px;text-align:center">${x.off||'—'}</td>
        <td style="padding:4px 8px;text-align:right;font-weight:700">${x.h||'—'}</td>
        <td style="padding:4px 8px;text-align:left">${stTx(x)}</td></tr>`).join('')}
    </tbody></table></div>`)
}
