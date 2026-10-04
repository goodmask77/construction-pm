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
function fmtHM(mins){ mins=Math.round(mins); const h9=Math.floor(mins/60), m9=mins%60; return m9? (h9? h9+'時'+m9+'分' : m9+'分') : h9+'時' } // v4.37.3 張良「不要12.3小時 幾分鐘就顯示幾分鐘」
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
async function lawView(){
  // v4.37.4（張良「這邊是不是沒更新到 實際上有問題」）：原本只看「當月」→ §32/§34/§36 改吃「全史未處理違規」（與🔴違規清單同一份；負責人按✅處理才轉綠）
  lpOverlay('lawOv','<div class="hint" style="padding:18px">掃描 6 月起全部班表中…</div>')
  if (typeof shVioEnsureAll==='function') await shVioEnsureAll()
  const rows=window._shRows||[], per=window._shPer||{}, abAgg=lpAbAgg(), d=window._shiftD||{}
  const V9 = shVioCompute(rows)
  const vioL = []
  for(const [k9,rs] of Object.entries(V9.g||{})){ const [nm9,dt9]=k9.split('|'); rs.forEach(r9=>vioL.push({st:'GD',nm:nm9,dt:dt9,r:r9})) }
  for(const [k9,rs] of Object.entries(V9.a||{})){ const [nm9,dt9]=k9.split('|'); rs.forEach(r9=>vioL.push({st:'AB',nm:nm9,dt:dt9,r:r9})) }
  vioL.sort((x,y)=>x.dt<y.dt?-1:1)
  const vTx = x => `${x.st} ${x.nm} ${x.dt.slice(5)}（${x.r}）`
  const gapBad = vioL.filter(x=>/班距/.test(x.r)).map(vTx)
  const over12All = vioL.filter(x=>/>12/.test(x.r)).map(vTx)
  const runAll = vioL.filter(x=>/連上/.test(x.r)).map(vTx)
  const gdOver12=[], abOver12=over12All // 併進同一掛（全史）
  const ot46=[...Object.entries(per).filter(([,p])=>p.ot1+p.ot2>46).map(([nm,p])=>`GD ${nm}（本月加班${fmtHM((p.ot1+p.ot2)*60)}）`), ...Object.entries(abAgg).filter(([,o])=>o.ot1+o.ot2>46).map(([nm,o])=>`AB ${nm}（本月加班${fmtHM((o.ot1+o.ot2)*60)}）`)]
  const run12=runAll
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
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:17px">⚖️ 勞基法檢查 <span class="hint" style="font-weight:600;font-size:12.5px">工時類=6月起全史未處理（處理完才轉綠）・月加班/例假統計=${shiftYm}</span></b>
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
  // v4.46.1 NUEiP 真值（張良「好先進去」）：該月有發薪單的 AB 人改吃真值，沒有的（當月還沒發薪）照舊試算
  const TD='border:1px solid #8a8f98;padding:5px 8px;font-size:13px;color:#111;text-align:right;white-space:nowrap'
  const TDL=TD.replace('right','left')
  const TH='border:1px solid #8a8f98;padding:6px 8px;font-size:12.5px;background:#eef1f5;color:#111;font-weight:800;white-space:nowrap'
  const truth = (d.hrPay||[]).filter(x=>x.ym===shiftYm).sort((a,b)=>b.net-a.net)
  const truthN = new Set(truth.map(x=>x.n))
  const ppl=[...Object.keys(per).map(n=>({store:'GD',n,o:per[n]})), ...Object.keys(abAgg).filter(n=>!truthN.has(n)).map(n=>({store:'AB',n,o:abAgg[n]}))]
    .filter(x=>x.o.h>0).sort((a,b)=>a.store.localeCompare(b.store)||b.o.h-a.o.h)
  const rows=ppl.map(x=>{ const rt=rates[x.n]||{}, base=+rt.base||0, allow=+rt.allow||0
    const reg=Math.max(0,x.o.h-x.o.ot1-x.o.ot2)
    const basePay=Math.round(reg*base), ot1Pay=Math.round(x.o.ot1*base*1.34), ot2Pay=Math.round(x.o.ot2*base*1.67)
    return {...x, base, allow, reg, basePay, ot1Pay, ot2Pay, total:basePay+ot1Pay+ot2Pay+allow} })
  window._payRows=rows
  const nt=n=>n?n.toLocaleString('en-US'):'0'
  const sum=k=>rows.reduce((t,r)=>t+r[k],0)
  // 表格用「紙本」配色（黑字白底、純 inline 樣式）＝複製圖片/給會計師列印都清楚
  const truthTbl = truth.length ? `
    <div style="color:#111;font-weight:900;font-size:14px;padding:4px 0 6px">A Beach・NUEiP 發薪真值（${truth.length} 人）</div>
    <table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="${TH};text-align:left">姓名</th><th style="${TH};text-align:left">發薪事件</th><th style="${TH}">發放日</th><th style="${TH}">應發</th><th style="${TH}">加班費</th><th style="${TH}">加班時數</th><th style="${TH}">實發</th></tr></thead><tbody>
      ${truth.map(x=>`<tr><td style="${TDL};font-weight:800">${x.n}</td><td style="${TDL}">${x.ev||''}</td><td style="${TD}">${x.pd||''}</td><td style="${TD}">${nt(x.g)}</td><td style="${TD}">${nt(x.ot)}</td><td style="${TD}">${x.otH?fmtHM(x.otH*60):'—'}</td><td style="${TD};font-weight:900">${nt(x.net)}</td></tr>`).join('')}
      <tr><td style="${TDL};font-weight:900" colspan="3">合計</td><td style="${TD};font-weight:900">${nt(truth.reduce((t,x)=>t+x.g,0))}</td><td style="${TD};font-weight:900">${nt(truth.reduce((t,x)=>t+x.ot,0))}</td><td style="${TD}"></td><td style="${TD};font-weight:900">${nt(truth.reduce((t,x)=>t+x.net,0))}</td></tr>
    </tbody></table>
    <div style="color:#555;font-size:11px;padding:4px 0 10px">來源：NUEiP 工資發放明細（每日自動同步）；勞健保/扣款已含在實發。</div>` : `<div style="color:#555;font-size:12px;padding:4px 0 10px">A Beach ${shiftYm} 的發薪單還沒產生（發薪日次月 10 號後自動出現）——下表為試算。</div>`
  const tbl=`<div id="payTblWrap" style="background:#fff;padding:14px;border-radius:10px">
    <div style="color:#111;font-weight:900;font-size:15px;padding-bottom:8px">GROUN:D × A Beach 薪資表　${shiftYm}　<span style="font-weight:600;font-size:12px;color:#555">AB＝NUEiP 發薪真值（無單月份退回出勤試算）｜GD＝打卡試算（§24 前2h×1.34、後2h×1.67）</span></div>
    ${truthTbl}
    ${rows.length?`<div style="color:#111;font-weight:900;font-size:14px;padding:4px 0 6px">${truth.length?'其餘（試算）':'工時試算'}（${rows.length} 人）</div>`:''}
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
  const rows=window._payRows||[]
  const truth=((window._shiftD||{}).hrPay||[]).filter(x=>x.ym===shiftYm)
  if(!rows.length&&!truth.length){ lpToast('沒有資料'); return }
  let csv='\ufeff來源,店別,姓名,發薪事件/說明,發放日,應發,加班費,實發\n'
  truth.forEach(x=>{ csv+=['NUEiP真值','AB',x.n,(x.ev||'').replace(/,/g,'，'),x.pd,x.g,x.ot,x.net].join(',')+'\n' })
  csv+='\n來源,店別,姓名,正常時數,加班1.34時數,加班1.67時數,時薪,本薪,加班費1.34,加班費1.67,加給,應發合計\n'
  rows.forEach(r=>{ csv+=['試算',r.store,r.n,r1(r.reg),r1(r.o.ot1),r1(r.o.ot2),r.base,r.basePay,r.ot1Pay,r.ot2Pay,r.allow,r.total].join(',')+'\n' })
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
      dts.forEach(dt=>{ if(cal[dt].h>12) addV(out,nm+'|'+dt,'排班'+fmtHM(cal[dt].h*60)+'>12時') })
      for(let i=1;i<dts.length;i++){
        const gap1=(new Date(dts[i])-new Date(dts[i-1]))/86400e3
        if(gap1===1){
          run++
          if(cal[dts[i]].min<99999&&cal[dts[i-1]].max>-1){
            const rest=cal[dts[i]].min+1440-cal[dts[i-1]].max
            if(rest<660&&rest>0) addV(out,nm+'|'+dts[i],'與前一天班距'+fmtHM(rest)+'<11時')
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
  ;((typeof shMergedAbAtt==='function'?shMergedAbAtt():((window._shiftD||{}).abAtt||[]))).forEach(x=>{ if((+x.h||0)>12) addV(a,x.name+'|'+x.date,'實際'+fmtHM(x.h*60)+'>12時') }) // v4.37.1 跨月合併
  // v4.38.0 審核流：st=ok(審核通過)=消失；st=pending(已處理待張良審核)=橘光；其他=紅光
  const res9 = ((window._shiftD||{}).vioRes)||{}
  const gp={}, ap={}
  const stOf = k9 => { const it9=res9[k9]; return it9 ? (it9.st==='pending'?'pending':'ok') : '' }
  for(const k9 of Object.keys(g)){ const st9=stOf('GD|'+k9); if(st9==='ok') delete g[k9]; else if(st9==='pending'){ gp[k9]=g[k9]; delete g[k9] } }
  for(const k9 of Object.keys(a)){ const st9=stOf('AB|'+k9); if(st9==='ok') delete a[k9]; else if(st9==='pending'){ ap[k9]=a[k9]; delete a[k9] } }
  return { g, a, gp, ap }
}
// 🔴 違規清單面板（張良「我要去哪裡確認是什麼問題」）：工具列紅色「違規 N」鈕點開＝每筆誰/哪天/什麼問題
async function shVioEnsureAll(){ // v4.36.6 張良「怎麼又只剩一個」：清單原本只算瀏覽器已載月份→改成掃描前把 2026-06 起全部載好
  const mos=[]; let y=2026, m=6
  const now9=new Date(Date.now()+8*3600e3)
  while(y<now9.getUTCFullYear()||(y===now9.getUTCFullYear()&&m<=now9.getUTCMonth()+2)){ mos.push(y+'-'+String(m).padStart(2,'0')); if(++m>12){m=1;y++} }
  if(typeof shEnsure==='function') await shEnsure(mos)
}
async function shVioList(){
  lpOverlay('vioOv','<div class="hint" style="padding:18px">掃描 6 月起全部班表中…</div>')
  await shVioEnsureAll()
  const V=shVioCompute(window._shRows||[])
  try{ const n9=Object.values(V.g).reduce((t,x)=>t+x.length,0)+Object.values(V.a).reduce((t,x)=>t+x.length,0); const b9=document.getElementById('shVioBadge'); if(b9){ b9.textContent='🔴 違規 '+n9; b9.style.display=n9?'':'none' } }catch(_){}
  const L=[]
  for(const [k,rs] of Object.entries(V.g||{})){ const [nm,dt]=k.split('|'); rs.forEach(r=>L.push({st:'GD',nm,dt,r})) }
  for(const [k,rs] of Object.entries(V.a||{})){ const [nm,dt]=k.split('|'); rs.forEach(r=>L.push({st:'AB',nm,dt,r})) }
  L.sort((x,y)=>x.dt<y.dt?-1:x.dt>y.dt?1:0)
  // v4.37.1（張良「直接有說明跟打卡紀錄時間證明 再加上計算確認說明」）
  const attBy={}; (typeof shMergedAbAtt==='function'?shMergedAbAtt():[]).forEach(x=>{ attBy['AB|'+x.name+'|'+x.date]=x })
  ;(window._shRows||[]).forEach(r=>{ attBy['GD|'+r.name+'|'+r.date]={ on:r.firstIn, off:r.lastOut, h:Math.round(r.h*10)/10 } })
  const t2m9=t=>{ const z=String(t||'').split(':'); return (+z[0]||0)*60+(+z[1]||0) }
  const ruleOf = x => /班距/.test(x.r) ? 'gap' : (/>12/.test(x.r) ? 'h12' : 'run')
  window._vioNotifyL = null // 下面渲染時填（📣 通知用）
  const punchOf = x => { // v4.37.3 純時間呈現「09:58 → 22:15＝12時18分」
    const a=attBy[x.st+'|'+x.nm+'|'+x.dt]
    if(ruleOf(x)==='gap'){
      const d2=new Date(new Date(x.dt+'T00:00:00Z').getTime()-86400e3).toISOString().slice(0,10)
      const b=attBy[x.st+'|'+x.nm+'|'+d2]
      const offT=b&&b.off?b.off:'', onT=a&&a.on?a.on:''
      if(offT&&onT){ const rest=t2m9(onT)+1440-t2m9(offT); return `${d2.slice(5)} ${offT} → ${x.dt.slice(5)} ${onT}＝休${fmtHM(rest)}` }
      return `依排班推算（${d2.slice(5)}/${x.dt.slice(5)} 缺打卡）`
    }
    if(ruleOf(x)==='h12'){
      const onT=a&&a.on?a.on:'—', offT=a&&a.off?a.off:'—'
      return `${onT} → ${offT}${a&&a.h?`＝${fmtHM(a.h*60)}`:''}`
    }
    return '—'
  }
  window._vioNotifyL = L.map(x=>({ st:x.st, nm:x.nm, dt:x.dt, r:x.r, punch:punchOf(x), link:'https://ground-pm.vercel.app/prep#vio='+encodeURIComponent(x.st+'|'+x.nm+'|'+x.dt+'|'+(/班距/.test(x.r)?new Date(new Date(x.dt+'T00:00:00Z').getTime()-86400e3).toISOString().slice(0,10):'')) }))
  // v4.43.7 對齊補正：日期td=center、夥伴td=left 跟表頭一致（之前漏寫吃到全域靠右）
  lpOverlay('vioOv',`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:17px">🔴 班表違規清單</b>
      <span class="hint">和班表上發紅光的格子一一對應；規則＝四週變形（單日12h／班距11h／連13天）</span>
      <span style="display:inline-flex;gap:8px">${L.length?`<button class="mini" style="padding:6px 14px;font-weight:800" onclick="shVioNotifyAsk()">📣 通知</button>`:''}<button class="mini" style="padding:6px 14px" onclick="document.getElementById('vioOv').remove()">關閉</button></span></div>
    ${L.length?`<div class="scroll" style="margin-top:10px"><table style="border-collapse:collapse;width:100%"><thead><tr><th style="padding:5px 8px;text-align:center">店</th><th style="padding:5px 8px;text-align:center">日期</th><th style="text-align:left;padding:5px 8px">夥伴</th><th style="text-align:left;padding:5px 8px">問題</th><th style="text-align:left;padding:5px 8px">打卡</th><th style="padding:5px 8px;text-align:center"></th></tr></thead><tbody>
      ${L.map(x=>{ const prev9 = /班距/.test(x.r) ? new Date(new Date(x.dt+'T00:00:00Z').getTime()-86400e3).toISOString().slice(0,10) : ''
        return `<tr style="border-top:1px solid var(--line)"><td style="padding:6px 8px;text-align:center;cursor:pointer" onclick="shVioGo('${x.st}','${x.nm.replace(/'/g,'')}','${x.dt}','${prev9}')">${x.st}</td><td style="padding:6px 8px;text-align:center;white-space:nowrap;color:var(--primary);text-decoration:underline;cursor:pointer" title="點我跳到班表這一格（金光定位）" onclick="shVioGo('${x.st}','${x.nm.replace(/'/g,'')}','${x.dt}','${prev9}')">${x.dt.slice(5)}</td><td style="padding:6px 8px;text-align:left;font-weight:800;cursor:pointer" onclick="shVioGo('${x.st}','${x.nm.replace(/'/g,'')}','${x.dt}','${prev9}')">${x.nm}</td><td style="padding:6px 8px;text-align:left"><div style="color:var(--red);font-weight:700">${x.r}</div><div class="hint" style="font-size:12px;margin-top:2px;cursor:pointer;text-decoration:underline dotted" title="點我看完整法條" onclick="lawArtView('${ruleOf(x)}')">${LAW_REF[ruleOf(x)].art}：${LAW_REF[ruleOf(x)].brief} ›</div></td><td style="padding:6px 8px;text-align:left;white-space:nowrap;font-family:ui-monospace,monospace;font-size:13px">${punchOf(x)}</td><td style="padding:6px 8px;white-space:nowrap;text-align:center"><button class="mini on" style="padding:3px 12px" onclick="shVioDone('${x.st}','${x.nm.replace(/'/g,'')}','${x.dt}','${x.r.replace(/'/g,'')}')">✅ 處理</button></td></tr>` }).join('')}
    </tbody></table></div><div class="hint" style="margin-top:8px">「✅ 處理」＝負責人已調整/確認過：紅光與提醒消失、進下面的留存紀錄。法條體檢 → 工具列「⚖️ 法規」。</div>`:`<div class="mut" style="margin-top:12px">沒有待處理的違規 🎉</div>`}
    ${(()=>{ const res9=((window._shiftD||{}).vioRes)||{}; const isApr=!!(((window._shiftD||{}).me)||{}).approver
      const pend=Object.entries(res9).filter(([,v9])=>v9.st==='pending')
      const done=Object.entries(res9).filter(([,v9])=>v9.st!=='pending')
      let h9=''
      if(pend.length) h9+=`<div style="margin-top:14px;font-weight:900">🕐 待審核（${pend.length}）<span class="hint" style="font-weight:600;font-size:12px">處理人已回報，張良審核通過才正式銷案；格子橘光</span></div>`+
        pend.sort((a,b)=>String(b[1].ts||'').localeCompare(String(a[1].ts||''))).map(([k9,v9])=>{ const [st9,nm9,dt9]=k9.split('|')
          return `<div style="border-top:1px dashed var(--line);padding:7px 0;font-size:13px">
            <div><b>${st9}</b> ${dt9.slice(5)} <b>${nm9}</b> <span class="hint">${v9.r||''}</span></div>
            <div style="margin-top:2px">處理內容：<b>${v9.note||'—'}</b> <span class="hint" style="font-size:11.5px">（${v9.by||''}・${v9.ts||''}）</span></div>
            ${isApr?`<div style="margin-top:4px;display:flex;gap:8px"><button class="mini on" style="padding:3px 14px" onclick="shVioJudge('${k9.replace(/'/g,'')}','approve')">✅ 審核通過銷案</button><button class="mini" style="padding:3px 12px;color:var(--red)" onclick="shVioJudge('${k9.replace(/'/g,'')}','reject')">退回</button></div>`:''}
          </div>` }).join('')
      if(done.length) h9+=`<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:800" class="hint">📜 已銷案（${done.length}）</summary>
        ${done.sort((a,b)=>String(b[1].apTs||b[1].ts||'').localeCompare(String(a[1].apTs||a[1].ts||''))).map(([k9,v9])=>{ const [st9,nm9,dt9]=k9.split('|')
          return `<div style="border-top:1px dashed var(--line);padding:5px 0;font-size:13px">
            <b>${st9}</b> ${dt9.slice(5)} <b>${nm9}</b> <span class="hint">${v9.r||''}</span>
            <div class="hint" style="font-size:12px">處理：${v9.note||'—'}（${v9.by||''}・${v9.ts||''}）｜審核：${v9.apBy||'—'}・${v9.apTs||''}</div>
            ${isApr?`<button class="mini" style="padding:1px 9px" onclick="shVioJudge('${k9.replace(/'/g,'')}','undo')">復原</button>`:''}</div>` }).join('')}
      </details>`
      return h9 })()}`)
}
function shVioDone(st, nm, dt, r){ // v4.38.0 必填處理內容→送張良審核
  const old9 = document.getElementById('vdOv'); if (old9) old9.remove()
  const ov = document.createElement('div'); ov.id='vdOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,22,.6);z-index:73;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:360px;width:100%;padding:18px" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px">✅ 處理回報：${nm}・${dt.slice(5)}</div>
    <div class="hint" style="margin:4px 0 10px">${r}</div>
    <textarea id="vdNote" rows="3" placeholder="處理了什麼？（必填，例：已與本人確認為代班誤排，班表已改）" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font-size:14.5px"></textarea>
    <div class="hint" style="margin-top:6px;font-size:12px">會記錄你的姓名與時間 → 送張良審核，審核通過才正式銷案。</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="mini" style="padding:9px 14px" onclick="document.getElementById('vdOv').remove()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="shVioDoneSend('${st}','${nm.replace(/'/g,'')}','${dt}','${r.replace(/'/g,'')}')">送出審核</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
  setTimeout(()=>{ const t9=document.getElementById('vdNote'); if(t9) t9.focus() },50)
}
async function shVioDoneSend(st, nm, dt, r){
  const note = (document.getElementById('vdNote')||{}).value||''
  if (!note.trim()) { alert('要寫「處理了什麼」才能送審'); return }
  const o = document.getElementById('vdOv'); if (o) o.remove()
  const key = st+'|'+nm+'|'+dt
  const j = await fetch('/api/mail-sync?vioresset='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),key,op:'done',r,note})}).then(x=>x.json()).catch(()=>null)
  if(!j||!j.ok){ alert((j&&j.error)||'沒存成功'); return }
  if(window._shiftD) window._shiftD.vioRes = j.items
  if(typeof shGridOnly==='function') shGridOnly()
  shVioList()
}
async function shVioJudge(key, op){
  const j = await fetch('/api/mail-sync?vioresset='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),key,op})}).then(x=>x.json()).catch(()=>null)
  if(!j||!j.ok){ alert((j&&j.error)||'沒成功'); return }
  if(window._shiftD) window._shiftD.vioRes = j.items
  if(typeof shGridOnly==='function') shGridOnly()
  shVioList()
}
async function shVioUndo(key){
  const j = await fetch('/api/mail-sync?vioresset='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),key,op:'undo'})}).then(x=>x.json()).catch(()=>null)
  if(!j||!j.ok){ alert((j&&j.error)||'沒成功'); return }
  if(window._shiftD) window._shiftD.vioRes = j.items
  if(typeof shGridOnly==='function') shGridOnly()
  shVioList()
}

// ── 🕐 AB 出勤總覽 v4.36.0（張良「6/1起所有打卡紀錄,看出遲到/沒打卡,每人總紀錄,像營業額那樣好查」）──
let abaMo = 'all', abaSort = { k: 'late', dir: -1 }, abaView = 'det' // v4.43.3 det=全員逐筆明細(張良要的預設)/sum=每人彙總
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
  const vBtn = `<span style="display:inline-flex;gap:0;border:1px solid var(--line);border-radius:999px;overflow:hidden"><button class="mini${abaView==='det'?' on':''}" style="margin:0;border:none;border-radius:0;padding:4px 14px" onclick="abaView='det';abAttDraw()">逐筆明細</button><button class="mini${abaView==='sum'?' on':''}" style="margin:0;border:none;border-radius:0;padding:4px 14px" onclick="abaView='sum';abAttDraw()">每人彙總</button></span>`
  if (abaView === 'det') { // v4.43.3 全員詳細打卡紀錄：日期新→舊、每列=一人一天的上下班卡
    const det = rows.slice().sort((a,b)=> a.d===b.d ? a.n.localeCompare(b.n,'zh-Hant') : (a.d<b.d?1:-1))
    const stT9 = x => [x.abs?'<b style="color:var(--red)">曠職</b>':'', x.miss?'<b style="color:var(--red)">缺卡</b>':'', x.late>0?`<b style="color:#E8A657">遲到${x.late}分</b>`:'', x.early>0?`<b style="color:#E8A657">早退${x.early}分</b>`:''].filter(Boolean).join('、') || '<span class="mut">正常</span>'
    const moBtn9 = (v,lb)=>`<button class="mini${abaMo===v?' on':''}" style="padding:4px 12px;font-weight:800" onclick="abaMo='${v}';abAttDraw()">${lb}</button>`
    // v4.43.5 對齊治本：欄=[名稱,對齊]只宣告一次,表頭資料同一份定義產生——不再兩段手寫各歪各的
    // v4.43.8 欄距收緊（張良「版面精簡好」）：每欄寬=內容寬(width:1%+nowrap)、剩餘空間全推給最右墊欄=欄位靠攏不再被平均拉開
    const C9 = [['日期','left'],['夥伴','left'],['狀態','left'],['班別','center'],['上班卡','center'],['下班卡','center'],['時數','right']]
    const td9 = (i,html,ex)=>`<td style="padding:4px 14px;text-align:${C9[i][1]};${ex||''}">${html}</td>`
    lpOverlay('abaOv', `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:17px">🕐 A Beach 出勤總覽</b>
        <span style="display:flex;gap:8px;align-items:center">${vBtn}<button class="mini" style="padding:6px 14px" onclick="document.getElementById('abaOv').remove()">關閉</button></span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">${moBtn9('all','全部')}${mos.map(m=>moBtn9(m, m.slice(2).replace('-','/'))).join('')}</div>
      <div class="hint" style="margin-bottom:6px">共 ${det.length} 筆・點夥伴名字看他一個人的整期紀錄</div>
      <div class="scroll" style="height:66vh;overflow-y:auto"><table style="border-collapse:collapse;width:100%"><thead><tr>
        ${C9.map(([lb,al])=>`<th style="padding:4px 14px;text-align:${al};width:1%;white-space:nowrap">${lb}</th>`).join('')}<th></th></tr></thead><tbody>
        ${det.map(x=>`<tr style="border-top:1px solid var(--line);font-size:13px">
          ${td9(0, `${x.d.slice(5)}（${'日一二三四五六'[new Date(x.d).getDay()]}）`, 'white-space:nowrap')}
          ${td9(1, x.n, `font-weight:800;white-space:nowrap;cursor:pointer;text-decoration:underline dotted" onclick="abAttPerson('${x.n.replace(/'/g,'')}')`)}
          ${td9(2, stT9(x), 'white-space:nowrap')}
          ${td9(3, x.w||'—')}
          ${td9(4, x.on||'—', !x.on&&!x.abs?'color:var(--red)':'')}
          ${td9(5, x.off||'—')}
          ${td9(6, x.h||'—', 'font-weight:700')}<td></td></tr>`).join('')}
      </tbody></table></div>`)
    return
  }
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
      <span style="display:flex;gap:8px;align-items:center">${vBtn}<button class="mini" style="padding:6px 14px" onclick="document.getElementById('abaOv').remove()">關閉</button></span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">${moBtn('all','全部')}${mos.map(m=>moBtn(m, m.slice(2).replace('-','/'))).join('')}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px" class="hint">共 ${tot.days} 人日｜遲到 ${tot.late} 次｜缺卡 ${tot.miss} 次｜曠職 ${tot.abs} 次・NUEiP 打卡・點欄頭排序、點名字看逐日明細</div><!-- v4.43.8 說明併一行=det/sum 切換彈窗高不跳 -->
    <div class="scroll" style="height:66vh;overflow-y:auto"><table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="padding:5px 8px;text-align:left">夥伴</th>${TH9('days','出勤天')}${TH9('h','總時數')}${TH9('avg','日均')}${TH9('late','遲到次')}${TH9('lateMin','遲到分')}${TH9('early','早退次')}${TH9('miss','缺卡')}${TH9('abs','曠職')}</tr></thead><tbody>
      ${list.map(o=>`<tr style="border-top:1px solid var(--line)">
        <td style="padding:5px 8px;font-weight:800;white-space:nowrap;cursor:pointer;text-decoration:underline dotted" title="點我看逐日明細" onclick="abAttPerson('${o.n.replace(/'/g,'')}')">${o.n}</td>
        <td style="padding:5px 8px;text-align:right">${o.days}</td><td style="padding:5px 8px;text-align:right;font-weight:700">${o.h}</td><td style="padding:5px 8px;text-align:right" class="hint">${o.avg}</td>
        <td style="padding:5px 8px;text-align:right;${o.late?'color:#E8A657;font-weight:800;cursor:pointer;text-decoration:underline dotted':''}"${o.late?` title="點我看遲到彙整" onclick="abAttPerson('${o.n.replace(/'/g,'')}',0,'late')"`:''}>${o.late||'—'}</td>
        <td style="padding:5px 8px;text-align:right;${o.lateMin?'color:#E8A657;cursor:pointer;text-decoration:underline dotted':''}"${o.lateMin?` title="點我看遲到彙整" onclick="abAttPerson('${o.n.replace(/'/g,'')}',0,'late')"`:''}>${o.lateMin||'—'}</td>
        <td style="padding:5px 8px;text-align:right;${o.early?'color:#E8A657;cursor:pointer;text-decoration:underline dotted':''}"${o.early?` title="點我看早退彙整" onclick="abAttPerson('${o.n.replace(/'/g,'')}',0,'early')"`:''}>${o.early||'—'}</td>
        <td style="padding:5px 8px;text-align:right;${o.miss?'color:var(--red);font-weight:800;cursor:pointer;text-decoration:underline dotted':''}"${o.miss?` title="點我看缺卡彙整" onclick="abAttPerson('${o.n.replace(/'/g,'')}',0,'miss')"`:''}>${o.miss||'—'}</td>
        <td style="padding:5px 8px;text-align:right;${o.abs?'color:var(--red);font-weight:900;cursor:pointer;text-decoration:underline dotted':''}"${o.abs?` title="點我看曠職彙整" onclick="abAttPerson('${o.n.replace(/'/g,'')}',0,'abs')"`:''}>${o.abs||'—'}</td></tr>`).join('')}
    </tbody></table>
    <div class="hint" style="margin-top:8px">補卡紀錄 NUEiP 匯出沒帶旗標，先以「缺卡」欄代位；時數=NUEiP 核定工時。</div></div>`) // v4.43.8 注腳移進捲動區=卡片高跟 det 一致
}
function abAttPerson(nm, keep, f){
  // v4.43.4（張良三則）：①狀態欄移日期後②視圖內建月份鈕=不用跳出去切③遲到/缺卡/早退/曠職彙整鈕=只列事件日(黃字數字點進來也是這)
  if (!keep) { window._abaPSort = { k:'d', dir:-1 }; window._abaPMo = abaMo; window._abaPF = f || 'all' }
  if (f) window._abaPF = f
  window._abaPN = nm
  const so = window._abaPSort, pMo = window._abaPMo || 'all', pF = window._abaPF || 'all'
  const nmE = nm.replace(/'/g,'')
  const mine = (window._abaD||[]).filter(x=>x.n===nm)
  const mos9 = [...new Set(mine.map(x=>x.d.slice(0,7)))].sort()
  let all = mine.filter(x=> pMo==='all' || x.d.startsWith(pMo))
  const cnt9 = { late: all.filter(x=>x.late>0).length, miss: all.filter(x=>x.miss).length, early: all.filter(x=>x.early>0).length, abs: all.filter(x=>x.abs).length }
  const lateSum = all.reduce((t,x)=>t+(x.late>0?x.late:0),0)
  if (pF==='late') all = all.filter(x=>x.late>0)
  else if (pF==='miss') all = all.filter(x=>x.miss)
  else if (pF==='early') all = all.filter(x=>x.early>0)
  else if (pF==='abs') all = all.filter(x=>x.abs)
  // v4.38.1 張良「每一天都要顯示 才知道哪天休假」：日期連續補滿，沒紀錄的那天=休（彙整模式只列事件日不補）
  if (pF==='all' && all.length && so.k==='d') {
    const have = new Set(all.map(x=>x.d))
    const today9 = new Date(Date.now()+8*3600e3).toISOString().slice(0,10)
    const d0 = all.map(x=>x.d).sort()[0]
    let dEnd = all.map(x=>x.d).sort().slice(-1)[0]; if (dEnd < today9 && (pMo==='all' || today9.startsWith(pMo))) dEnd = today9
    for (let t9=new Date(d0+'T00:00:00Z'); ; t9=new Date(t9.getTime()+86400e3)) {
      const ds9 = t9.toISOString().slice(0,10)
      if (ds9 > dEnd) break
      if (!have.has(ds9)) all.push({ d: ds9, n: nm, rest: 1 })
    }
  } else if (so.k!=='d') all = all.filter(x=>!x.rest)
  const sev = x => (x.abs?100:0)+(x.miss?50:0)+(x.late>0?10+x.late/1000:0)+(x.early>0?5:0)
  all.sort((a,b)=>{ const k=so.k
    let va = k==='st'?sev(a):(a[k]??''), vb = k==='st'?sev(b):(b[k]??'')
    if (k==='h'||k==='st') return ((+va||0)-(+vb||0))*so.dir
    return (String(va)<String(vb)?-1:String(va)>String(vb)?1:0)*so.dir })
  const stTx = x => [x.abs?'<b style="color:var(--red)">曠職</b>':'', x.miss?'<b style="color:var(--red)">缺卡</b>':'', x.late>0?`<b style="color:#E8A657">遲到${x.late}分</b>`:'', x.early>0?`<b style="color:#E8A657">早退${x.early}分</b>`:''].filter(Boolean).join('、') || '<span style="color:var(--green)">✓</span>'
  // v4.37.2 張良「資料要對齊欄位名稱 所有欄位都要可排序」：th/td 同對齊、每欄可點排序
  const ar9 = k => `<span style="display:inline-block;width:12px;font-size:10px;text-align:center">${so.k===k?(so.dir>0?'▲':'▼'):''}</span>`
  const TH9 = (k,lb,al)=>`<th style="padding:4px 8px;text-align:${al};width:1%;cursor:pointer;white-space:nowrap;user-select:none" onclick="window._abaPSort=window._abaPSort.k==='${k}'?{k:'${k}',dir:-window._abaPSort.dir}:{k:'${k}',dir:${k==='d'?-1:1}};abAttPerson('${nmE}',1)">${lb}${ar9(k)}</th>`
  const pmBtn = (v,lb)=>`<button class="mini${pMo===v?' on':''}" style="padding:4px 12px;font-weight:800" onclick="window._abaPMo='${v}';abAttPerson('${nmE}',1)">${lb}</button>`
  const fBtn = (v,lb,c9)=>`<button class="mini${pF===v?' on':''}" style="padding:4px 12px;font-weight:800${pF!==v&&v!=='all'&&cnt9[v]?';color:'+c9:''}" onclick="window._abaPF='${v}';abAttPerson('${nmE}',1)">${lb}${v!=='all'?` ${cnt9[v]||0}`:''}</button>`
  const fLb = { late:'遲到彙整', miss:'缺卡彙整', early:'早退彙整', abs:'曠職彙整' }
  lpOverlay('abaPOv', `
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16.5px">🕐 ${nm}・${pF==='all'?'逐日打卡':fLb[pF]}（${pMo==='all'?'全部':pMo}）</b>
      <button class="mini" style="padding:6px 14px" onclick="document.getElementById('abaPOv').remove()">關閉</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${pmBtn('all','全部')}${mos9.map(m=>pmBtn(m, m.slice(2).replace('-','/'))).join('')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center">${fBtn('all','全部')}${fBtn('late','遲到','#E8A657')}${fBtn('miss','缺卡','var(--red)')}${fBtn('early','早退','#E8A657')}${fBtn('abs','曠職','var(--red)')}
      ${pF==='late'&&lateSum?`<span class="hint" style="font-weight:800;color:#E8A657">合計遲到 ${lateSum} 分</span>`:''}${pF!=='all'&&!all.length?`<span class="hint">這段期間沒有${fLb[pF].slice(0,2)}紀錄 🎉</span>`:''}</div>
    <div class="scroll" style="margin-top:8px;height:66vh;overflow-y:auto"><table style="border-collapse:collapse;width:100%"><thead><tr>
      ${TH9('d','日期','left')}${TH9('st','狀態','left')}${TH9('w','班別','center')}${TH9('on','上班卡','center')}${TH9('off','下班卡','center')}${TH9('h','時數','right')}<th></th></tr></thead><tbody>
      ${all.map((x,i)=>{
        const wd9 = new Date(x.d).getDay()
        const wkSep = so.k==='d' && pF==='all' && i>0 && wd9===(so.dir<0?0:1) ? 'border-top:3px solid #3A4456;' : '' // 每週分隔線（照排序方向在週一切）
        if (x.rest) return `<tr style="${wkSep}border-top:${wkSep?'3px solid #3A4456':'1px solid var(--line)'};font-size:13px;opacity:.5">
          <td style="padding:4px 8px;text-align:left;white-space:nowrap">${x.d.slice(5)}（${'日一二三四五六'[wd9]}）</td>
          <td style="padding:4px 8px"></td><td style="padding:4px 8px;text-align:center" class="hint">休</td><td style="padding:4px 8px;text-align:center">—</td><td style="padding:4px 8px;text-align:center">—</td><td style="padding:4px 8px;text-align:right">—</td><td></td></tr>`
        return `<tr style="${wkSep}${wkSep?'':'border-top:1px solid var(--line);'}font-size:13px">
        <td style="padding:4px 8px;text-align:left;white-space:nowrap">${x.d.slice(5)}（${'日一二三四五六'[wd9]}）</td>
        <td style="padding:4px 8px;text-align:left;white-space:nowrap">${stTx(x)}</td>
        <td style="padding:4px 8px;text-align:center;white-space:nowrap">${x.w||'—'}</td>
        <td style="padding:4px 8px;text-align:center;${!x.on&&!x.abs?'color:var(--red)':''}">${x.on||'—'}</td>
        <td style="padding:4px 8px;text-align:center">${x.off||'—'}</td>
        <td style="padding:4px 8px;text-align:right;font-weight:700">${x.h?fmtHM(x.h*60):'—'}</td><td></td></tr>` }).join('')}
    </tbody></table></div>`)
}

// 🔗 違規跳轉定位 v4.36.1（張良「點擊直接跑到有問題的地方 兩天金光閃3秒 問題那天持續紅光」）
async function shVioGo(st, nm, dt, dt2){
  const ov = document.getElementById('vioOv'); if (ov) ov.remove()
  shRangeInclude(dt.slice(0,7)); if (dt2) shRangeInclude(dt2.slice(0,7))
  if (!document.querySelector('th[data-d="'+dt+'"]')) { await shEnsure(shRangeYms()); if (typeof shGridOnly==='function') shGridOnly() }
  requestAnimationFrame(()=>{
    const box = document.getElementById('shBox'); if (!box) return
    const th = box.querySelector('th[data-d="'+(dt2&&dt2<dt?dt2:dt)+'"]')
    if (th) box.scrollLeft += th.getBoundingClientRect().left - box.getBoundingClientRect().left - 130
    const attr = st==='AB' ? 'data-ab' : 'data-gd'
    const want = new Set([nm+'|'+dt, ...(dt2?[nm+'|'+dt2]:[])])
    const els = [...box.querySelectorAll('['+attr+']')].filter(el=>want.has(el.getAttribute(attr)))
    if (!els.length) { lpToast('這一格不在目前畫面資料裡（往回翻月再試）'); return }
    const tr0 = els[0].closest('tr'); if (tr0) box.scrollTop = Math.max(0, tr0.offsetTop - box.clientHeight/2)
    els.forEach(el=>{ el.classList.remove('glowgold'); void el.offsetWidth; el.classList.add('glowgold') }) // 重觸發動畫
    setTimeout(()=>els.forEach(el=>el.classList.remove('glowgold')), 3200) // 金光3秒收場；vioGlow紅光class還在=問題那天繼續紅
  })
}

// 🔍 AB 格點擊=排班vs實際打卡核對卡 v4.36.4（張良「點到該格直接顯示上下班真實打卡時間 方便負責人核對」）
function abCellInfo(nm, dt){
  const scheds = (typeof shMergedAb==='function'?shMergedAb():[]).filter(x=>x.name===nm&&x.date===dt)
  const att = (typeof shMergedAbAtt==='function'?shMergedAbAtt():[]).find(x=>x.name===nm&&x.date===dt)
  const wd9 = '日一二三四五六'[new Date(dt).getDay()]
  const schTx = scheds.length ? (scheds.every(x=>/●|⚫/.test(x.code||'')) ? '不可排班（PT 劃假：上課等原因）' : scheds.filter(x=>!/●|⚫/.test(x.code||'')).map(x=>`${x.code||'班'}${x.start?` ${x.start}–${x.end}`:''}`).join('、')) : '沒排班' // v4.38.2 張良「●=PT不能排班,有跟公司說過(上課等)」
  // v4.37.0 張良「不要顯示10.2 就正常時間表示 跟排班時間對齊 快速辨識」：兩列同欄位對齊、時間等寬字、不秀時數
  const sch0 = scheds.find(x=>x.start&&x.end)
  const bad9 = []
  if (att){ if (att.late>0) bad9.push(`<b style="color:#E8A657">遲到 ${att.late} 分</b>`)
    if (att.early>0) bad9.push(`<b style="color:#E8A657">早退 ${att.early} 分</b>`)
    if (att.miss) bad9.push('<b style="color:var(--red)">缺卡</b>')
    if (att.absent) bad9.push('<b style="color:var(--red)">曠職</b>') }
  const MONO='font-family:ui-monospace,SFMono-Regular,monospace;font-size:19px;font-weight:900;letter-spacing:.5px;white-space:nowrap'
  const attOn = att&&att.on?att.on:'—', attOff = att&&att.off?att.off:'—'
  const noAtt = !(att&&(att.on||att.off))
  lpOverlay('abciOv', `
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16.5px">${nm}・${dt.slice(5)}（${wd9}）</b>
      <button class="mini" style="padding:6px 14px" onclick="document.getElementById('abciOv').remove()">關閉</button></div>
    <div style="margin-top:10px;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:12px 14px">
      <table style="border-collapse:collapse"><tbody>
        <tr><td class="hint" style="padding:3px 14px 3px 0;font-size:13px;white-space:nowrap">排班</td>
          <td style="${MONO}">${sch0?`${sch0.start} – ${sch0.end}`:'<span class="hint" style="font-size:14px;font-weight:600">沒排班</span>'}${(()=>{ if(!sch0) return ''; const t9=t=>{const z=String(t).split(':');return (+z[0])*60+(+z[1])}; let sp=t9(sch0.end)-t9(sch0.start); if(sp<=0) sp+=1440; return `<span style="font-size:14px;font-weight:800">＝${fmtHM(sp)}</span>` })()}</td>
          <td style="padding-left:12px;white-space:nowrap"><b>${schTx!=='沒排班'?schTx.replace(/ \d{2}:\d{2}–\d{2}:\d{2}/g,''):''}</b></td></tr>
        <tr><td class="hint" style="padding:3px 14px 3px 0;font-size:13px;white-space:nowrap">打卡</td>
          <td style="${MONO};${noAtt?'':'color:var(--pdark)'}">${noAtt?`<span class="hint" style="font-size:14px;font-weight:600">${dt > todayTpe() ? '還沒到這天' : (att&&att.absent?'—':'沒有打卡資料')}</span>`:`${attOn} – ${attOff}`}${(()=>{ if(noAtt||!att.on||!att.off) return ''; const t9=t=>{const z=String(t).split(':');return (+z[0])*60+(+z[1])}; let sp=t9(att.off)-t9(att.on); if(sp<=0) sp+=1440; return `<span style="font-size:14px;font-weight:800">＝${fmtHM(sp)}</span>` })()}</td>
          <td style="padding-left:12px;white-space:nowrap">${bad9.join('、')||(noAtt?'':'<span style="color:var(--green);font-weight:800">✓</span>')}</td></tr>
      </tbody></table>
    </div>
    <div class="hint" style="margin-top:8px;font-size:12px">打卡=NUEiP 第一張上班卡 → 最後一張下班卡；整月總帳看「🕐 AB出勤」。</div>`)
}

// 📖 法條速查 v4.37.3（張良「點擊打開可看最新勞基法詳細內容 最下方出處帶超連結」）
const LAW_REF = {
  gap: { art:'勞基法 第34條', brief:'輪班更換班次，中間至少要連續休息 11 小時',
    full:'勞工工作採輪班制者，其工作班次，每週更換一次。但經勞工同意者不在此限。\n\n依前項更換班次時，至少應有連續十一小時之休息時間。但因工作特性或特殊原因，經中央目的事業主管機關商請中央主管機關公告者，得變更休息時間不少於連續八小時。\n\n雇主依前項但書規定變更休息時間者，應經工會同意，如事業單位無工會者，經勞資會議同意後，始得為之。',
    url:'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=34' },
  h12: { art:'勞基法 第32條', brief:'一天工時含加班最多 12 小時、每月加班上限 46 小時',
    full:'雇主有使勞工在正常工作時間以外工作之必要者，雇主經工會同意，如事業單位無工會者，經勞資會議同意後，得將工作時間延長之。\n\n前項雇主延長勞工之工作時間連同正常工作時間，一日不得超過十二小時；延長之工作時間，一個月不得超過四十六小時。但雇主經工會同意，如事業單位無工會者，經勞資會議同意後，延長之工作時間，一個月不得超過五十四小時，每三個月不得超過一百三十八小時。',
    url:'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=32' },
  run: { art:'勞基法 第36條（四週變形）', brief:'四週變形工時：每 2 週至少 2 日例假、每 4 週例假＋休息日合計至少 8 日',
    full:'勞工每七日中應有二日之休息，其中一日為例假，一日為休息日。\n\n雇主有下列情形之一，不受前項規定之限制：…三、依第三十條之一規定變更正常工作時間者，勞工每二週內至少應有二日之例假，每四週內之例假及休息日至少應有八日。',
    url:'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=36' },
}
function lawArtView(rule){
  const L9 = LAW_REF[rule]; if (!L9) return
  lpOverlay('lawArtOv', `
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16.5px">📖 ${L9.art}</b>
      <button class="mini" style="padding:6px 14px" onclick="document.getElementById('lawArtOv').remove()">關閉</button></div>
    <div style="margin-top:6px;font-weight:800;color:var(--pdark)">${L9.brief}</div>
    <div style="margin-top:10px;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.75;white-space:pre-wrap">${L9.full}</div>
    <div class="hint" style="margin-top:10px;font-size:12.5px">出處：全國法規資料庫（勞動部主管・勞動基準法）→ <a href="${L9.url}" target="_blank" style="color:var(--primary);text-decoration:underline">點我看官方最新條文</a></div>`)
}

// 📣 違規通知發送 v4.37.5（張良「可選發給班表有勾編輯的主管 或群發ABpeople」）
async function shVioNotifyAsk(){ // v4.37.6 張良「不用說明 私訊要可以選人 不要直接都發」
  const n = (window._vioNotifyL||[]).length; if (!n) return
  let mgrs = []
  try { const r = await fetch('/api/mail-sync?viomgrs='+encodeURIComponent(K)+'&me='+encodeURIComponent(TK())); const j = await r.json(); mgrs = (j&&j.mgrs)||[] } catch(_){}
  window._vnSel = new Set(mgrs.map(m=>m.rid))
  const old = document.getElementById('vnOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id='vnOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,22,.6);z-index:72;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:320px;width:100%;padding:18px" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px;margin-bottom:10px">📣 發送違規清單（${Math.min(n,8)} 筆）</div>
    ${mgrs.map(m=>`<label style="display:flex;gap:10px;align-items:center;padding:8px 4px;border-top:1px solid var(--line);cursor:pointer;font-weight:700">
      <input type="checkbox" checked style="width:17px;height:17px" onchange="this.checked?window._vnSel.add('${m.rid}'):window._vnSel.delete('${m.rid}')">${m.name}</label>`).join('')}
    <button class="mini on" style="width:100%;padding:11px;font-size:15px;margin-top:10px" onclick="shVioNotifySend('mgrs')">✉️ 傳私訊給勾選的人</button>
    <button class="mini" style="width:100%;padding:11px;font-size:15px;margin-top:8px" onclick="shVioNotifySend('group')">📢 群發 ABpeople</button>
    <button class="mini" style="width:100%;padding:9px;margin-top:8px" onclick="document.getElementById('vnOv').remove()">取消</button></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function shVioNotifySend(to){
  const o = document.getElementById('vnOv'); if (o) o.remove()
  lpToast('發送中…')
  const r = await fetch('/api/mail-sync?vionotify='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),to,rids:to==='mgrs'?[...(window._vnSel||[])]:undefined,items:(window._vioNotifyL||[]).slice(0,8)})}).then(x=>x.json()).catch(()=>null)
  if(!r||!r.ok){ alert((r&&r.error)||'發送失敗'); return }
  lpToast('✅ 已發送給：'+r.sent.join('、'))
}
