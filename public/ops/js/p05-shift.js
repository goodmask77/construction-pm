// ⚠️ 這是 /prep 主程式的第 5/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：班表(無限時間軸)
// ── v4.25.0 班表「無限時間軸」（張良「不要限制時間週期」）：日期欄連續不斷，左右一直滑；滑到左/右邊緣自動多載上/下個月，看不到盡頭 ──
function shInitRange(){ if(window._shRangeStart) return; const [y,m]=todayTpe().slice(0,7).split('-').map(Number); const b=new Date(y,m-1-2,1), f=new Date(y,m-1+2,1); window._shRangeStart=b.getFullYear()+'-'+String(b.getMonth()+1).padStart(2,'0'); window._shRangeEnd=f.getFullYear()+'-'+String(f.getMonth()+1).padStart(2,'0') }
function shRangeInclude(ym){ shInitRange(); if(ym<window._shRangeStart) window._shRangeStart=ym; if(ym>window._shRangeEnd) window._shRangeEnd=ym }
function shRangeYms(){ shInitRange(); const out=[]; let [y,m]=window._shRangeStart.split('-').map(Number); const [ey,em]=window._shRangeEnd.split('-').map(Number); while(y<ey||(y===ey&&m<=em)){ out.push(y+'-'+String(m).padStart(2,'0')); if(++m>12){m=1;y++} } return out }
function shRangeDays(){ shInitRange(); const days=[]; const [sy,sm]=window._shRangeStart.split('-').map(Number); const [ey,em]=window._shRangeEnd.split('-').map(Number); const cur=new Date(sy,sm-1,1), end=new Date(ey,em,0); while(cur<=end){ days.push(cur.getFullYear()+'-'+String(cur.getMonth()+1).padStart(2,'0')+'-'+String(cur.getDate()).padStart(2,'0')); cur.setDate(cur.getDate()+1) } return days }
function shMergedSched(){ const out=[], seen=new Set(); const add=a=>(a||[]).forEach(x=>{ const k=x.id||(x.name+'|'+x.date+'|'+(x.pos||'')); if(!seen.has(k)){seen.add(k);out.push(x)} })
  // v4.28.6 治殘影幽靈卡（張良「點9/29的卡跳成新增、拉不下去也刪不掉」）：當月回傳範圍(ym±6天)內一律以最新 d.sched 為準，舊月快取同範圍的卡不疊進來
  const ymD = shiftYm || todayTpe().slice(0,7); const mo0 = new Date(ymD + '-01T00:00:00Z')
  const lo = new Date(mo0.getTime() - 6*86400e3).toISOString().slice(0,10)
  const hi = new Date(Date.UTC(mo0.getUTCFullYear(), mo0.getUTCMonth()+1, 1) + 6*86400e3).toISOString().slice(0,10)
  if(window._shiftD&&window._shiftD.sched) add(window._shiftD.sched)
  ;(window._shLoaded||[]).forEach(y=>{ if(y===shiftYm)return; const c=tcGet('shift_'+y); if(c) add((c.sched||[]).filter(x=>String(x.date||'')<lo||String(x.date||'')>hi)) })
  add(window._shiftTmpQ); return out }
function shMergedLeave(){ const out={}; const addL=l=>{ if(!l)return; for(const dt in l){ out[dt]=Object.assign(out[dt]||{}, l[dt]) } }; if(window._shiftD) addL(window._shiftD.leave); (window._shLoaded||[]).forEach(y=>{ if(y===shiftYm)return; const c=tcGet('shift_'+y); if(c) addL(c.leave) }); return out }
// v4.32.0 真因二（張良「還是沒有班表」）：GD 班表有跨月合併(shMergedSched)，AB 班表/訂位一直沒有→永遠只畫當月檔自帶的 ±7 天，回補了也看不到
function shMergedAb(){ const out=[], seen=new Set(); const add=a=>{ (a||[]).forEach(x=>{ const k=x.date+'|'+x.name; if(seen.has(k))return; seen.add(k); out.push(x) }) }
  if(window._shiftD) add(window._shiftD.ab)
  ;(window._shLoaded||[]).forEach(y=>{ if(y===shiftYm)return; const c=tcGet('shift_'+y); if(c) add(c.ab) })
  return out }
function shMergedResv(){ const out={}; const add=rv=>{ if(!rv)return; for(const dt in rv){ if(!(dt in out)) out[dt]=rv[dt] } }
  if(window._shiftD) add(window._shiftD.resv)
  ;(window._shLoaded||[]).forEach(y=>{ if(y===shiftYm)return; const c=tcGet('shift_'+y); if(c) add(c.resv) })
  return out }
async function shEnsure(yms){ // v4.31.8 治本（張良「重新整理跟右上更新都按了還是沒有」）：原本「localStorage 有就永不再抓」→ 鄰月舊快取卡死（AB回補/別人改班都看不到）。改＝快取先畫（秒出），背景一定重抓一次最新，回來差異就重畫
  window._shLoaded=window._shLoaded||[]
  const reval = async (y)=>{ try{ const r=await fetch('/api/mail-sync?shift='+encodeURIComponent(K)+'&ym='+y+'&r='+Date.now()+(TK()?'&me='+encodeURIComponent(TK()):'')); const dd=await r.json(); if(dd&&dd.ok){ const old9=JSON.stringify(tcGet('shift_'+y)||''); tcSet('shift_'+y,dd); if(JSON.stringify(dd)!==old9&&curStore==='shift'){ const box=document.getElementById('shBox'); if(box) window._shAnchor=shLeftAnchor(box); shGridOnly() } } }catch(_){} }
  await Promise.all(yms.map(async y=>{ if(window._shLoaded.includes(y))return; window._shLoaded.push(y); const c=tcGet('shift_'+y); if(c){ reval(y); return } await reval(y) })) }
function shLeftAnchor(box){ const ths=box.querySelectorAll('th[data-d]'); const bx=box.getBoundingClientRect(); const edge=bx.left+100; for(const th of ths){ const r=th.getBoundingClientRect(); if(r.right>edge) return {date:th.getAttribute('data-d'), vx:r.left-bx.left} } return null }
function shGridOnly(){ const box=document.getElementById('shBox'); if(!box||!window._shBuildGrid)return; const keep=box.scrollLeft; const a=window._shAnchor; window._shAnchor=null; box.innerHTML=window._shBuildGrid(shRangeDays()); box.onscroll=shOnScroll
  try{ const V=(typeof shVioCompute==='function')?shVioCompute(window._shRows||[]):null; const n9=V?Object.values(V.g).reduce((t,x)=>t+x.length,0)+Object.values(V.a).reduce((t,x)=>t+x.length,0):0; window._shVioN=n9; const b9=document.getElementById('shVioBadge'); if(b9){ b9.textContent='🔴 違規 '+n9; b9.style.display=n9?'':'none' } }catch(_){} /* v4.36.2 載入新月份=違規數即時跟上 */
  if(a){ const th=box.querySelector('th[data-d="'+a.date+'"]'); if(th){ box.scrollLeft+=(th.getBoundingClientRect().left-box.getBoundingClientRect().left)-a.vx } } else box.scrollLeft=keep }
function shOnScroll(){ clearTimeout(window._shWkT); window._shWkT = setTimeout(shWkFollow, 150) // v4.40.7 作用週跟著捲
  const box=document.getElementById('shBox'); if(!box||window._shExtBusy)return; const nearL=box.scrollLeft<240, nearR=box.scrollLeft>box.scrollWidth-box.clientWidth-240; if(!nearL&&!nearR)return; window._shExtBusy=true; window._shAnchor=shLeftAnchor(box); if(nearL){ let [y,m]=window._shRangeStart.split('-').map(Number); if(--m<1){m=12;y--} window._shRangeStart=y+'-'+String(m).padStart(2,'0') } if(nearR){ let [y,m]=window._shRangeEnd.split('-').map(Number); if(++m>12){m=1;y++} window._shRangeEnd=y+'-'+String(m).padStart(2,'0') } shEnsure(shRangeYms()).then(()=>{ if(curStore==='shift') shGridOnly(); window._shExtBusy=false }) }
function shiftNav(n){ const t2 = new Date(shiftYm + '-15'); t2.setMonth(t2.getMonth()+n); const ym2 = t2.toISOString().slice(0,7); window._shScrollTo = (ym2===todayTpe().slice(0,7)?todayTpe():ym2+'-01'); shRangeInclude(ym2); shiftLoad(ym2) }
// v4.40.7（張良「選取週沒什麼用 拿掉」）：‹›選取週UI退役。週動作(清空/複製/存版本/套用)的作用週改＝目前捲到的那一週
// ——shWkFollow 停捲150ms後用最左可見日回推週一寫進 _shiftWk；各動作視窗照樣顯示日期範圍再確認
function shWkFollow(){
  const box = document.getElementById('shBox'); if (!box) return
  const an = shLeftAnchor(box); if (!an || !an.date) return
  const t2 = new Date(an.date); t2.setDate(t2.getDate() - ((t2.getDay()+6)%7))
  window._shiftWk = t2.toISOString().slice(0,10)
}
// （手勢切週已移除 v4.20.2：張良「固定視窗原生捲動很滑順，用這個就好」——班表容器維持原生捲動看七天，切週用 ‹ › 今天 按鈕＋滑入動畫）
async function shiftLoad(ym){
  curStore = 'shift'; setTabs('shift')
  shiftYm = (typeof ym === 'string' && ym) || shiftYm || todayTpe().slice(0,7)
  if (!window._shiftD || window._shiftD.ym !== shiftYm) { const c = tcGet('shift_'+shiftYm); if (c) window._shiftD = c }
  if (window._shiftD && window._shiftD.ym === shiftYm) shiftRender(); else app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?shift=' + encodeURIComponent(K) + '&ym=' + shiftYm + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (!d || !d.ok) { if (!window._shiftD) app.innerHTML = '<div class="err">讀不到資料</div>'; return }
  window._shiftD = d; tcSet('shift_'+shiftYm, d)
  window._shLoaded = window._shLoaded || []; if (!window._shLoaded.includes(shiftYm)) window._shLoaded.push(shiftYm) // 無限軸：記下已載月份
  if ((window._shiftTmpQ||[]).length) d.sched.push(...window._shiftTmpQ) // 還在排隊的樂觀卡補回畫面（v4.4.7）
  if (curStore === 'shift') shiftRender()
}
// v4.36.4 未排收合（記住選擇；重畫時 shiftRender 自己會還原捲動位置）
try { window._shUC = localStorage.getItem('shUC') === '1' } catch(_) {}
function unschedToggle(){
  window._shUC = !window._shUC
  try { localStorage.setItem('shUC', window._shUC ? '1' : '') } catch(_) {}
  shiftRender()
}
function shiftRender(){
  const d = window._shiftD; if (!d || curStore !== 'shift') return
  // v4.25.6（張良「重新整理不應該在8月 要在今天」）：重畫前先記住目前捲到哪——沒有明確目標時還原原位；連原位都沒有才預設捲到今天
  const _pbox = document.getElementById('shBox')
  const _prevAnchor = _pbox ? shLeftAnchor(_pbox) : null
  const _prevTop = _pbox ? _pbox.scrollTop : 0
  document.getElementById('upd').textContent = '班表 × 打卡・' + shiftYm
  const meN = d.me ? d.me.name : null // 2026-10-02 全面修：只有菜單口有 canEdit 欄位，整檔替換誤傷各分頁→按鈕全滅；顯示層=綁定即可，真正權限由伺服器端守門
  const tmin = hm => { const a=String(hm||'').split(':'); return (+a[0]||0)*60+(+a[1]||0) }
  const fhm = m => String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')
  const today = todayTpe()
  // 打卡整理：人+日 → 事件列（台北時區）
  const pd = {}
  for (const p2 of d.punches){
    const t3 = new Date(p2.ts)
    const dt = t3.toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})
    const tm = t3.toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Taipei'})
    const k2 = p2.name+'|'+dt
    ;(pd[k2]=pd[k2]||[]).push({ m: (+tm.slice(0,2))*60+(+tm.slice(3,5)), dir: p2.dir })
  }
  Object.values(pd).forEach(a=>a.sort((x,y)=>x.m-y.m))
  // 逐「人日」：工時＋狀態
  const rows = []
  const keys = new Set([...d.sched.map(s=>s.name+'|'+s.date), ...Object.keys(pd)])
  for (const k2 of keys){
    const [name, date] = k2.split('|')
    if (!date || !date.startsWith(shiftYm)) continue
    const s = d.sched.find(x=>x.name===name && x.date===date)
    const ev = pd[k2]||[]
    let ms = 0, working = false
    for (let i=0;i<ev.length;i++){ if (ev[i].dir==='in'){ if (ev[i+1] && ev[i+1].dir==='out'){ ms += ev[i+1].m - ev[i].m; i++ } else if (date===today) working = true } }
    let workedMin = ms
    if (workedMin>0 && ev.length<=2 && s && s.break) workedMin = Math.max(0, workedMin - (+s.break||0)) // 只打上下班各一次→扣班表休息
    const firstIn = ev.find(e=>e.dir==='in'), lastOut = [...ev].reverse().find(e=>e.dir==='out')
    const st = []
    if (s){
      if (firstIn){ if (firstIn.m > tmin(s.start)+5) st.push('遲到'+(firstIn.m-tmin(s.start))+'分') }
      else if (date < today) st.push('未到')
      if (lastOut && lastOut.m < tmin(s.end) && !working) st.push('早退'+(tmin(s.end)-lastOut.m)+'分')
    } else if (ev.length) st.push('未排班出勤')
    if (working) st.push('上班中')
    const h2 = workedMin/60
    // v4.33.2 四週變形工時（張良「我們餐飲業是四週變形」）：加班起算=當日排定時數（排定最多認10h、沒排班=8h）；§32 單日12h上限不變
    let schedH = 8
    if (s && s.start && s.end) { let sp9 = tmin(s.end) - tmin(s.start); if (sp9 <= 0) sp9 += 1440; schedH = Math.min(10, Math.max(8, (sp9 - (+s.break || 0)) / 60)) }
    const otBase = Math.max(0, h2 - schedH)
    rows.push({ date, name, s, firstIn: firstIn?fhm(firstIn.m):'', lastOut: lastOut?fhm(lastOut.m):'', working, h: h2, ot1: Math.min(otBase, 2), ot2: Math.max(0, otBase - 2), over12: h2>12, st })
  }
  // 人員月統計＋勞基法旗標
  const per = {}
  rows.forEach(r=>{ const p3 = per[r.name] = per[r.name]||{ h:0, ot1:0, ot2:0, days:[], flags:new Set() }
    p3.h+=r.h; p3.ot1+=r.ot1; p3.ot2+=r.ot2
    if (r.h>0) p3.days.push(r.date)
    if (r.over12) p3.flags.add('單日>12h('+r.date.slice(5)+')') })
  Object.values(per).forEach(p3=>{
    if (p3.ot1+p3.ot2 > 46) p3.flags.add('月加班'+(Math.round((p3.ot1+p3.ot2)*10)/10)+'h＞46h上限')
    const ds = [...new Set(p3.days)].sort(); let run = 1
    for (let i=1;i<ds.length;i++){ const gap = (new Date(ds[i])-new Date(ds[i-1]))/86400e3; run = gap===1 ? run+1 : 1; if (run>12){ p3.flags.add('連上超過12天（四週變形例假不足）'); break } } // v4.33.2 四週變形：七休一不適用,紅線=連12天
  })
  const r1 = x => Math.round(x*10)/10
  let h = `<section><h2>班表 × 打卡 <button class="mini" style="padding:3px 12px;font-size:12.5px;vertical-align:2px" onclick="window._gdStaffOpen=!window._gdStaffOpen;const b9=document.getElementById('gdStaffBox');if(b9)b9.style.display=window._gdStaffOpen?'':'none'">👥 GD 人員</button> <span class="hint">${meN?'':BIND_HINT}</span></h2>
   <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
     <button class="mini" onclick="shiftNav(-1)">‹</button><b style="font-size:15px">${shiftYm}</b><button class="mini" onclick="shiftNav(1)">›</button>
   </div>
   ${(()=>{ // 人員名單＋權限（張良 2026-09-25：訪客看/綁定一般/名單設權限）
     const canMgr = d.me && (d.me.approver || d.me.role==='主管')
     const chip = s2 => `<span style="border:1px solid ${s2.role==='停權'?'#5A4646':'var(--line)'};border-radius:8px;padding:1px 8px;margin-right:4px;white-space:nowrap;display:inline-block;margin-top:2px;${s2.role==='停權'?'opacity:.5;text-decoration:line-through;':''}${canMgr?'cursor:pointer':''}" ${canMgr?`onclick="gdRoleModal('${s2.n}','${s2.role}')" title="點我設定權限"`:''}>${s2.n}${s2.bound?' <span style="color:var(--green);font-weight:800">✓</span>':''}${s2.role==='主管'?' <span style="color:var(--primary);font-weight:800;font-size:12px">主管</span>':''}${s2.role==='審核人'?' <span style="color:#A85C26;font-weight:800;font-size:12px">審核</span>':''}</span>`
     return `<div id="gdStaffBox" style="background:var(--card);border:1.5px solid var(--line);border-radius:10px;padding:8px 11px;margin-bottom:8px;font-size:14px;${window._gdStaffOpen?'':'display:none'}"><b>GD 人員</b>：${(d.staff||[]).map(chip).join('')||'—'} ${canMgr?`<button class="mini" style="padding:2px 10px" onclick="gdStaffAdd()">＋ 加人</button>`:''}</div>` })()}` // v4.31.4 張良「這邊也收合 放在班表×打卡右邊」：預設收起，標題旁 👥 鈕點開
  // 📅 一週班表（張良 2026-09-22：崗位×星期——每格=人名+時間）
  if (!window._shiftWk) { const t0 = new Date(todayTpe()); t0.setDate(t0.getDate() - ((t0.getDay()+6)%7)); window._shiftWk = t0.toISOString().slice(0,10); window._shScrollTo = todayTpe() }
  const wdN = ['一','二','三','四','五','六','日']
  h += `<div style="display:flex;gap:8px;align-items:center;margin:2px 0 6px;flex-wrap:wrap">
    <span style="font-weight:900;white-space:nowrap">一週班表</span>${meN?`<button class="mini" style="padding:3px 10px" onclick="shiftPosEdit()" title="崗位/時段/人員排序・顏色">⚙️ 設定</button>`:''}
    <button class="mini" style="padding:3px 10px" onclick="shiftSkill()">📊 熟練度</button><button class="mini" style="padding:3px 10px" onclick="shiftHist()">📝 紀錄</button>${(d.me&&(d.me.approver||d.me.role==='主管'))?`<button class="mini" style="padding:3px 10px" onclick="lawView()">⚖️ 法規</button><button class="mini" style="padding:3px 10px" onclick="payView()">💰 薪資表</button><button class="mini" style="padding:3px 10px" onclick="abAttView()">🕐 AB出勤</button>`:''}${(()=>{ try{ const V=(typeof shVioCompute==='function')?shVioCompute(rows):null; const n9=V?Object.values(V.g).reduce((t,x)=>t+x.length,0)+Object.values(V.a).reduce((t,x)=>t+x.length,0):0; window._shVioN=n9; return `<button id="shVioBadge" class="mini" style="padding:3px 10px;color:#fff;background:var(--red);border-color:var(--red);font-weight:800;${n9?'':'display:none'}" onclick="shVioList()">🔴 違規 ${n9}</button>` }catch(_){ return '' } })()}${meN?`<button class="mini" style="padding:3px 10px" onclick="tplSave()">💾 存版本</button><button class="mini" style="padding:3px 10px" onclick="tplView()">📂 版本</button>`:``}${meN?`<button class="mini" style="padding:3px 10px" onclick="copyWeekNext()">⧉ 本週→下週</button><button class="mini" style="padding:3px 10px;color:var(--red)" onclick="clearWeek()">🗑 清空本週</button>${(()=>{ try { const sv = JSON.parse(localStorage.getItem('shiftLastClear')||'null'); return (sv && Date.now()-sv.ts < 48*3600e3) ? `<button class="mini" style="padding:3px 10px" onclick="undoClear()">↩️ 復原清空</button>` : '' } catch(_) { return '' } })()}`:''}
  </div>`
  // v4.3.5（張良 2026-10-02）：①欄寬固定+硬格線=日期與格子切齊 ②崗位三組配色(櫃檯/飲料/中控・漢堡/煎炸麵・披薩/三明治) ③同人同天兼多崗位→班卡同色標記
  const posGrp = ps => /櫃檯|飲料|中控/.test(ps) ? 0 : /漢堡|煎炸|炸麵/.test(ps) ? 1 : /披薩|三明治/.test(ps) ? 2 : 3
  const GC = [{bg:'#17233A',ink:'#7FB5F5'},{bg:'#2C2012',ink:'#E8A657'},{bg:'#152719',ink:'#6FCF8F'},{bg:'#1C222B',ink:'#93A0B2'}] // v4.8.1 深色版左欄：深色調底+亮字跟黑灰底協調
  // v4.4.1（張良 2026-10-02）：每個人固定一個顏色（照 GD 人員名單順序配，超過輪替）——跨崗位/跨天同色快速辨識
  // v4.4.5（張良「搞個綠色灰色白色分開一點」）：12色強對比——紫/橘/綠/藍/粉/棕/深灰/紅/青/草綠/白(黑框)/金黃，不再有紫藍靛擠一起
  const PB = _PBX(), PT = _PTX() // v4.7.0 寶石色：實色填滿+白字
  // v4.5.3 顏色吃伺服器永久色號（d.colors），不再照名單順序——排序/進出都不變色
  const pcIdx = n => { const c2 = (d.colors||{})[n]; if (c2 != null) return c2 % PB.length; let i = 0; for(const ch of String(n)) i=(i*31+ch.charCodeAt(0))%997; return i % PB.length }
  const BD = 'border:1px solid var(--line);'
  const regStaff = (d.staff||[]).filter(s2=>!s2.off)
  // v4.21.0（張良「固定視窗原生捲動滑順翻週」）：三週並排 scroll-snap——原生橫滑一次吸一週，七天壓進一螢幕
  // v4.24.0（張良「左右往前往後無限延伸」）：一次畫整個月的每一天＝一長排日期欄，左右原生橫捲順順滑過整月；
  // 月份用上面 ‹ › 一直往前往後翻＝等於無限延伸；表頭凍結在上、崗位欄凍結在左；週一加分隔線；作用週=捲到的那一週(shWkFollow自動跟隨,金底線已退役)
  const buildGrid = (wd2) => {
    const we2 = shMergedSched().filter(x=>wd2.includes(x.date)) // 無限軸：吃所有已載月份合併後的班
    const leave = shMergedLeave() // 請假標記 { 日期: { 姓名: 假別 } }
    const VIO = (typeof shVioCompute==='function') ? shVioCompute(rows) : { g:{}, a:{} } // v4.33.3 違規格紅光（單日12h/班距11h/連13天）
    const pl2 = (d.posList||[]).slice(); we2.forEach(x=>{ const p4=x.pos||'未分崗'; if(!pl2.includes(p4)) pl2.push(p4) })
    const dayW = 'min-width:76px'
    const wdOf = dt => wdN[(new Date(dt).getDay()+6)%7]
    const sepOf = dt => (new Date(dt).getDay()===1 ? 'border-left:2px solid var(--line);' : '') // 週一＝上一週／這一週的分隔
    const isWknd = dt => { const g9=new Date(dt).getDay(); return g9===0||g9===6 } // v4.25.1 張良「六日微微深淺區隔」
    const wkndBg = dt => (isWknd(dt) ? 'background:#232F4C;' : '') // v4.37.1 張良「六日幫我明顯區隔」：微亮→明顯藍底（整欄含GD班表/AB班表/訂位一致）
    const todayBg = 'background:#17406F;box-shadow:inset 2.5px 0 0 var(--primary),inset -2.5px 0 0 var(--primary);' // v4.31.3 張良「當天跟六日的重疊有點不明顯」：今天整欄亮藍底+左右藍軌，疊在週末上也一眼認得
    let hh = `<table style="border-collapse:collapse"><thead><tr><th style="${BD}padding:5px 6px;text-align:center;position:sticky;left:0;top:0;background:var(--soft);z-index:4;white-space:nowrap"><button onclick="shiftWkToday()" title="捲回今天" style="background:var(--primary);color:#fff;border:none;border-radius:7px;padding:4px 12px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 2px 8px rgba(77,163,255,.35)">今天</button></th>${wd2.map(dt=>`<th data-d="${dt}" id="${dt===today?'shTodayCol':''}" onclick="dayClick('${dt}')" title="點我看當日時段細表" style="${BD}${sepOf(dt)}${dayW};padding:5px 4px;text-align:center;cursor:pointer;font-size:11.5px;white-space:nowrap;position:sticky;top:0;z-index:2;${dt===today?'color:#fff;background:var(--primary);font-weight:900;box-shadow:0 2px 10px rgba(77,163,255,.45)':(isWknd(dt)?'color:#CFE0FF;background:#2E3D63;font-weight:900;':'color:#F2F5F9;background:var(--soft);')}">${dt.slice(5)} ${wdOf(dt)}${(window._twHol||{})[dt]?`<div style="font-size:9px;line-height:1.15;color:#F2C14E;font-weight:800">${twShort(window._twHol[dt])}</div>`:((window._twWk||{})[dt]?`<div style="font-size:9px;line-height:1.15;color:#8C98A8">補班</div>`:'')}</th>`).join('')}</tr></thead><tbody>`
    if (!pl2.length) hh += `<tr><td colspan="${wd2.length+1}" class="mut" style="${BD}text-align:center">先按「⚙️ 設定」建崗位</td></tr>`
    let pg=null
    pl2.forEach(ps=>{
      const g=GC[posGrp(ps)]; const gb=(pg!==null&&posGrp(ps)!==pg)?`border-top:3px solid ${g.ink}AA;`:''; pg=posGrp(ps)
      hh += `<tr><td style="${BD}${gb}padding:3px 6px;text-align:left;font-weight:800;font-size:11px;color:${g.ink};position:sticky;left:0;background:${g.bg};z-index:1;white-space:nowrap">${ps}</td>` + wd2.map(dt=>{
        const es=we2.filter(x=>(x.pos||'未分崗')===ps&&x.date===dt)
        const cellOps=meN?` onclick="cellClick('${ps}','${dt}')" ondragover="event.preventDefault();this.style.outline='2px solid var(--primary)'" ondragleave="this.style.outline=''" ondrop="shiftDrop(event,'${ps}','${dt}')"`:''
        const ents=es.map(e=>{
          const pi=pcIdx(e.name),ti=e.tr?pcIdx(e.tr):-1
          const bg2=e.tr?`background:linear-gradient(180deg,${PB[pi]} 50%,${PB[ti]} 50%);`:`background:${PB[pi]};`
          const exp=((d.posStats||{})[e.name]||{})[ps]||0, trExp=e.tr?(((d.posStats||{})[e.tr]||{})[ps]||0):0
          const vio9=(VIO.g||{})[e.name+'|'+dt]
          return `<div data-gd="${e.name}|${dt}" ${vio9?`class="vioGlow" title="⚠️ ${vio9.join('、')}"`:''} ${meN?`draggable="true" ondragstart="event.stopPropagation();event.dataTransfer.setData('text/plain','${e.id}');window._shiftDragId='${e.id}'" ondragend="window._shiftDragId=null" onclick="event.stopPropagation();shiftForm('${e.id}')"`:''} style="font-size:12px;line-height:1.45;white-space:nowrap;${meN?'cursor:grab;':''}${bg2}border:${e.tr?'1.5px dashed rgba(255,255,255,.95)':'none'};border-radius:5px;padding:${e.tr?'1px 3px':'2px 4px'};margin:1.5px 0">${(e.seq||exp+1)<=2&&dt>=today&&ps!=='未分崗'&&!e.tr?'⚠️':''}<b style="color:${PT[pi]};font-weight:600">${e.name}</b>${ps!=='未分崗'?` <span style="font-size:10px;color:${PT[pi]};opacity:.7;font-weight:700">${e.seq||exp+1}</span>`:''}${e.tr?`<span style="display:block;color:${PT[ti]};font-weight:600;font-size:11.5px">🎓${e.tr} <span style="font-size:9px;opacity:.7">${e.trSeq||trExp+1}</span></span>`:''}</div>`
        }).join('')
        return `<td${cellOps} style="${BD}${sepOf(dt)}${gb}${dt===today?todayBg:wkndBg(dt)}padding:2px 3px;text-align:left;${meN?'cursor:pointer;':''}vertical-align:top">${ents||(meN?'<span class="mut">＋</span>':'<span class="mut">—</span>')}</td>`
      }).join('')+`</tr>`
    })
    // 未排：併進同一張表的最後一列（崗位欄沿用 sticky 凍結，日期欄跟上面對齊）；點人名可標請假(反黑劃掉+假別)＝當天不能排班
    // v4.36.4（張良「未排這邊幫我做收合功能」）：點「未排」整列收合⇄展開（記住選擇）；收起時每天只顯示人數
    const ucOn = !!window._shUC
    hh += `<tr><td onclick="unschedToggle()" title="${ucOn?'點我展開':'點我收合'}" style="${BD}border-top:3px solid var(--line);padding:3px 6px;text-align:left;font-weight:800;font-size:11px;color:var(--muted);position:sticky;left:0;background:var(--soft);z-index:1;white-space:nowrap;cursor:pointer">${ucOn?'▸':'▾'} 未排<br><span class="hint" style="font-weight:600;font-size:9.5px">${ucOn?'點我展開':'點人標請假'}</span></td>`+wd2.map(dt=>{
      const onDay=new Set(we2.filter(x=>x.date===dt).flatMap(x=>[x.name,x.tr].filter(Boolean)))
      const rest=regStaff.filter(s2=>!onDay.has(s2.n))
      if (ucOn) return `<td onclick="unschedToggle()" title="${rest.map(s2=>s2.n).join('、')||'全排完'}（點我展開）" style="${BD}${sepOf(dt)}${dt===today?todayBg:wkndBg(dt)}border-top:3px solid var(--line);padding:2px 3px;text-align:center;cursor:pointer">${rest.length?`<span class="hint" style="font-size:11px;font-weight:700">${rest.length}人</span>`:'<span class="hint" style="font-size:12px">✓</span>'}</td>`
      return `<td ${meN?`ondragover="event.preventDefault();this.style.outline='2px dashed var(--red)'" ondragleave="this.style.outline=''" ondrop="unschedDrop(event)"`:''} style="${BD}${sepOf(dt)}${dt===today?todayBg:wkndBg(dt)}border-top:3px solid var(--line);padding:2px 3px;vertical-align:top;text-align:left">${rest.map(s2=>{
        const lv=(leave[dt]||{})[s2.n]
        if(lv) return `<span ${meN?`onclick="shLeaveMenu('${s2.n}','${dt}')" style="cursor:pointer;"`:'style=""'} title="${s2.n} 請${lv}假${meN?'（點我改/取消）':''}"><span style="display:flex;align-items:center;gap:4px;width:max-content;white-space:nowrap;border:1px solid #5A3A3A;background:#2A1A1A;border-radius:6px;padding:1px 4px 1px 3px;margin:1.5px 0;font-size:11.5px;font-weight:700"><span style="width:7px;height:7px;border-radius:50%;background:#7A5A5A;flex:none"></span><span style="text-decoration:line-through;opacity:.65;color:#C7A0A0">${s2.n}</span><span style="background:var(--red);color:#fff;border-radius:4px;padding:0 5px;font-size:11px;font-weight:900">${lv}</span></span></span>`
        return `<span ${meN?`draggable="true" ondragstart="event.dataTransfer.setData('text/plain','u|${s2.n}')" onclick="shLeaveMenu('${s2.n}','${dt}')" title="拖上去格子＝排班・點我標請假"`:''} style="display:flex;align-items:center;gap:4px;width:max-content;white-space:nowrap;${meN?'cursor:pointer;':''}border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:6px;padding:1px 4px 1px 3px;margin:1.5px 0;font-size:11.5px;font-weight:600"><span style="width:7px;height:7px;border-radius:50%;background:${PB[pcIdx(s2.n)]};flex:none"></span>${s2.n}</span>`
      }).join('')||'<span class="hint" style="font-size:12px">✓</span>'}</td>`
    }).join('')+`</tr>`
    // v4.36.1（張良「班表日期要對照一起；內外場像崗位一樣用顏色區隔」）：AB 班表併進同一張表＝共用日期欄完全對齊、左右捲動同步
    const abAll = shMergedAb() // v4.32.0 跨月合併
    if (abAll.length){
      const abByN = {}, deptOf = {}, cnt = {}, ptOf = {}
      abAll.forEach(x=>{ if(!x.name) return; (abByN[x.name]=abByN[x.name]||{})[x.date]=x; if(x.dept&&!deptOf[x.name]) deptOf[x.name]=x.dept; if(x.pt) ptOf[x.name]=1; cnt[x.name]=(cnt[x.name]||0)+1 })
      const DEPT_C = { '內場':{ink:'#F0A050',bg:'#241A10',chipB:'#7A5A2A',chipBg:'#241A10'}, '外場':{ink:'#6EB1FF',bg:'#101A26',chipB:'#2A4A7A',chipBg:'#101A26'} }
      // v4.31.5（張良「照著NUEiP上面的顏色顯示排班,休假用不明顯的表示,不然都靠文字閱讀成本高」）：班別代碼→顏色（對齊NUEiP色系），沒對到的用調色盤穩定配色（同碼永遠同色）
      const AB_PAL = ['#6EB1FF','#7ED88F','#FF8A8A','#F48FB1','#5FD3D3','#F2C14E','#B9A3E8','#F0A050']
      const abC = (c0) => {
        if (/機/.test(c0)) return '#6EB1FF'            // 機動＝藍（NUEiP 藍）
        if (/沙|叢|^B/.test(c0)) return '#7ED88F'      // 沙/叢/B＝綠
        if (/^D/.test(c0)) return '#FF8A8A'            // D＝紅
        if (/跑|假/.test(c0)) return '#F48FB1'         // 跑/請假＝粉
        if (/收|晚/.test(c0)) return '#5FD3D3'         // 收/晚班＝青
        if (/午/.test(c0)) return '#F2C14E'            // 午班＝橘黃
        if (/爐/.test(c0)) return '#F0A050'            // 爐/早爐＝內場橘
        if (/^P/.test(c0)) return '#B9A3E8'            // P＝紫
        let h9 = 0; for (const ch of String(c0)) h9 = (h9 * 31 + ch.charCodeAt(0)) >>> 0
        return AB_PAL[h9 % AB_PAL.length]
      }
      const OTH_C = {ink:'#9AA4B2',bg:'var(--soft)',chipB:'var(--line)',chipBg:'var(--card)'}
      // v4.36.3（張良「PT也分出來 內歸內外歸外」）：內場→內場PT→外場→外場PT→其他；PT 列名字前掛 PT 小籤（同 NUEiP 呈現）
      const grpOf = n => (DEPT_C[deptOf[n]] ? deptOf[n] : '其他') + (ptOf[n] ? 'PT' : '')
      // v4.32.4（張良「陳立航9/16後就沒班=也是離職 怎麼判他在職」）：NUEiP成員名單會殘留離職者→再加「活躍度」雙條件。
      // 顯示規則：①該月有任何列(含休) ②或 NUEiP現役＋「該月1號往前14天內還有列」(=還在被排班/標休,只是這月還沒排)；兩者都不符=視同離職藏列
      const abOnL9 = (window._shiftD && window._shiftD.abOn) || []
      const abOn9 = new Set(abOnL9)
      const cut9 = (()=>{ const t9 = new Date(shiftYm + '-01T00:00:00Z'); t9.setUTCDate(t9.getUTCDate() - 14); return t9.toISOString().slice(0,10) })()
      const names9 = Object.keys(abByN).filter(n9 => {
        const ds9 = Object.keys(abByN[n9])
        if (ds9.some(dt9 => dt9.startsWith(shiftYm))) return true
        if (!abOnL9.length) return true // 在職名單還沒同步過→全顯示不誤殺
        return abOn9.has(n9) && ds9.some(dt9 => dt9 >= cut9)
      })
      const order9 = ['內場','內場PT','外場','外場PT','其他','其他PT']
      hh += `<tr><td colspan="${wd2.length+1}" style="${BD}border-top:4px solid var(--line);padding:6px 8px;text-align:left;font-weight:900;font-size:13px;background:var(--soft);position:sticky;left:0">🅰 A Beach 班表 <span class="hint" style="font-weight:600;font-size:10.5px">阿桑系統自動同步・唯讀・調度參考</span></td></tr>`
      order9.forEach(gp=>{
        const mem = names9.filter(n=>grpOf(n)===gp).sort((a,b)=>(cnt[b]||0)-(cnt[a]||0))
        if (!mem.length) return
        const c9 = DEPT_C[gp.replace('PT','')] || OTH_C
        mem.forEach((nm,mi)=>{
          const gb9 = mi===0 ? `border-top:3px solid ${c9.ink}AA;` : ''
          const ptTag = ptOf[nm] ? `<span style="font-size:9px;font-weight:900;background:${c9.ink}22;color:${c9.ink};border-radius:4px;padding:0 3px;margin-right:3px">PT</span>` : ''
          hh += `<tr><td style="${BD}${gb9}padding:3px 6px;text-align:left;font-weight:800;font-size:11px;color:${c9.ink};position:sticky;left:0;background:${c9.bg};z-index:1;white-space:nowrap">${ptTag}${nm}${mi===0?` <span style="font-size:9px;font-weight:900;border:1px solid ${c9.ink}66;border-radius:4px;padding:0 3px">${gp==='其他'?'AB':gp}</span>`:''}</td>`
          hh += wd2.map(dt=>{
            const x = (abByN[nm]||{})[dt]
            const vioA9 = (VIO.a||{})[nm+'|'+dt]
            if (!x) return `<td data-ab="${nm}|${dt}" ${vioA9?`class="vioGlow" title="⚠️ ${vioA9.join('、')}"`:''} style="${BD}${gb9}${sepOf(dt)}${dt===today?todayBg:wkndBg(dt)}"></td>`
            const code = x.code || ''
            const tip = `${vioA9?`⚠️ ${vioA9.join('、')}｜`:''}${nm} ${dt} ${code||'排休'}${x.start?` ${x.start}-${x.end}`:''}${x.dept?`（${x.dept}）`:''}`
            const rest9 = /例|休/.test(code) // 休假＝淡灰小字不加框（一眼略過，排班色塊才跳）
            const cc9 = abC(code)
            const chip = code && code!=='●'
              ? (rest9
                ? `<span style="font-size:10px;color:#55617A;font-weight:600;white-space:nowrap">${code.replace(/[●🔴⚪️]/g,'')}</span>`
                : `<span style="display:inline-block;border:1px solid ${cc9};background:${cc9}1F;color:${cc9};border-radius:6px;padding:1px 6px;font-size:11px;font-weight:800;white-space:nowrap">${code}</span>${x.start?`<div class="hint" style="font-size:9px;white-space:nowrap">${x.start}-${x.end}</div>`:''}`)
              : `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#3A4454" title="排休/未排"></span>`
            return `<td data-ab="${nm}|${dt}" ${vioA9?'class="vioGlow"':''} style="${BD}${gb9}${sepOf(dt)}${dt===today?todayBg:wkndBg(dt)}padding:2px 3px;text-align:center" title="${tip}">${chip}</td>`
          }).join('') + `</tr>`
        })
      })
    }
    // v4.37.0（張良「inline訂位也顯示在班表下方,左邊時段/上面日期對齊班表,12-13/13-17/18-19/19後」）：
    // 訂位四列併同一張表=日期欄完全對齊；格=組·人數、≥20人大組附名(🎉)；資料=inline每小時自動同步、唯讀
    const resvAll = shMergedResv() // v4.32.0 跨月合併
    if (Object.keys(resvAll).length){
      const RSL = [['a','12-13'],['b','13-17'],['c','18-19'],['d','19後']]
      const RC = {ink:'#5FD3A6',bg:'#10211A'}
      hh += `<tr><td colspan="${wd2.length+1}" style="${BD}border-top:4px solid var(--line);padding:6px 8px;text-align:left;font-weight:900;font-size:13px;background:var(--soft);position:sticky;left:0">🍴 A Beach 訂位 <span class="hint" style="font-weight:600;font-size:10.5px">inline 自動同步・唯讀・組數/人數（不含已取消；12-13含更早、13-17含17點）</span></td></tr>`
      RSL.forEach(([k9,lb9],ri)=>{
        hh += `<tr><td style="${BD}${ri===0?`border-top:3px solid ${RC.ink}AA;`:''}padding:3px 6px;text-align:left;font-weight:800;font-size:11px;color:${RC.ink};position:sticky;left:0;background:${RC.bg};z-index:1;white-space:nowrap">${lb9}</td>`
        hh += wd2.map(dt=>{
          const v9 = (resvAll[dt]||{})[k9]
          const base = `${BD}${ri===0?`border-top:3px solid ${RC.ink}AA;`:''}${sepOf(dt)}${dt===today?todayBg:wkndBg(dt)}`
          if (!v9) return `<td style="${base}"></td>`
          const big = (v9.big||[]).map(b9=>`<div style="font-size:9.5px;color:#F2C94C;font-weight:800;white-space:nowrap" title="${b9.t} ${b9.name} ${b9.n}人">🎉${b9.name.slice(0,6)}×${b9.n}</div>`).join('')
          return `<td style="${base}padding:2px 3px;text-align:center;vertical-align:top" title="${dt} ${lb9}：${v9.p}人${v9.k?`+${v9.k}小`:''} ${v9.g}組（inline iPad 時間軸人數=大人+小孩）"><span style="font-size:15px;font-weight:900;color:${RC.ink};white-space:nowrap">${v9.p}</span><span style="font-size:10.5px;font-weight:800;color:${RC.ink};opacity:.85">人</span>${v9.k?`<span style="font-size:9.5px;font-weight:800;color:#E8A657;white-space:nowrap">+${v9.k}小</span>`:''}<span class="hint" style="font-size:9.5px;white-space:nowrap;opacity:.6">·${v9.g}組</span>${big}</td>`
        }).join('') + `</tr>`
        // v4.37.4（張良「再顯示早上跟晚上人數」）：早上合計=12-13+13-17、晚上合計=18-19+19後——金字合計列
        if (ri===1 || ri===3){
          const lbS = ri===1?'☀️ 早上合計':'🌙 晚上合計', keys9 = ri===1?['a','b']:['c','d'], GK='#F2C94C'
          hh += `<tr><td style="${BD}padding:3px 6px;text-align:left;font-weight:900;font-size:11px;color:${GK};position:sticky;left:0;background:#241F0E;z-index:1;white-space:nowrap">${lbS}</td>`
          hh += wd2.map(dt=>{
            const vv = keys9.map(k=>(resvAll[dt]||{})[k]).filter(Boolean) // v4.37.7 跟時段列同吃跨月合併版（原讀 d.resv=只有當月±6天→翻舊月合計斷掉）
            const p9 = vv.reduce((t,v)=>t+(v.p||0),0), g9 = vv.reduce((t,v)=>t+(v.g||0),0), k9 = vv.reduce((t,v)=>t+(v.k||0),0)
            const base = `${BD}${sepOf(dt)}${dt===today?todayBg:wkndBg(dt)}border-bottom:2px solid var(--line);`
            if (!p9) return `<td style="${base}"></td>`
            return `<td style="${base}padding:2px 3px;text-align:center" title="${dt} ${lbS}：${p9}人${k9?`+${k9}小`:''} ${g9}組"><span style="font-size:15px;font-weight:900;color:${GK};white-space:nowrap">${p9}</span><span style="font-size:10.5px;font-weight:800;color:${GK};opacity:.85">人</span>${k9?`<span style="font-size:9.5px;font-weight:800;color:#E8A657;white-space:nowrap">+${k9}小</span>`:''}<span class="hint" style="font-size:9.5px;white-space:nowrap;opacity:.6">·${g9}組</span></td>`
          }).join('')+`</tr>`
        }
      })
    }
    hh += `</tbody></table>`
    return hh
  }
  // v4.25.0：無限時間軸——連續日期範圍(預設±2月)一長排，放品項明細同款四向捲動盒；滑到邊緣自動多載(shOnScroll)，月份 ‹ › 跳月，開啟自動捲到今天
  shInitRange(); shRangeInclude(shiftYm)
  h += `<div id="shBox" class="scroll" style="max-height:72vh;overflow:auto;margin-bottom:12px;-webkit-overflow-scrolling:touch">${buildGrid(shRangeDays())}</div>`
  // v4.28.1（張良「不要放左側 放班表下面就好」）：🧮 工時成本試算掛在週班表下面
  h += `<div style="font-weight:900;margin:12px 0 6px;font-size:16px">人力時數配置表</div><div id="lbSec" class="hint">載入中…</div>`
  window._shRows = rows; window._shPer = per // v4.33.0 工時統計表收進「💰 薪資表」不再常駐（張良「不用直接顯示佔版面 要查再查」）；⚖️法規/薪資面板共用
  h += `</section><section><h2>明細 <span class="hint">一格＝一人一天；數字＝工時（白=正常、橘=遲到/早退、紫=未排班出勤、紅框>12h）、✕=未到、●=上班中、排=還沒到的班；點格可改班</span> <button class="mini" style="padding:3px 10px" onclick="window._shDetList=!window._shDetList;shiftRender()">${window._shDetList?'切回矩陣':'切成列表'}</button></h2>`
  const byDate = {}
  rows.forEach(r=>{ (byDate[r.date]=byDate[r.date]||[]).push(r) })
  const wd = ['日','一','二','三','四','五','六']
  const dts = Object.keys(byDate).sort().reverse()
  if (!dts.length) h += `<div class="mut">沒有資料</div>`
  else if (!window._shDetList) { // v4.31.7 矩陣檢視（張良「一列一列的看不了多少資料畫面太大」——同 NUEiP 班表查詢的呈現邏輯）
    const dayN9 = new Date(+shiftYm.slice(0,4), +shiftYm.slice(5,7), 0).getDate()
    const dts9 = Array.from({length:dayN9},(_,i)=>shiftYm+'-'+String(i+1).padStart(2,'0'))
    const byK9 = {}; rows.forEach(r=>{ byK9[r.name+'|'+r.date]=r })
    const names9 = [...new Set(rows.map(r=>r.name))].sort((a,b)=>a.localeCompare(b,'zh-Hant'))
    h += `<div class="scroll"><table style="border-collapse:collapse"><thead><tr><th style="text-align:left;position:sticky;left:0;background:var(--soft);z-index:2;padding:4px 8px">夥伴</th>${dts9.map(dt=>{const g9=new Date(dt).getDay();return `<th style="padding:3px 5px;font-size:10.5px;text-align:center;line-height:1.3;${dt===today?'background:var(--primary);color:#fff;':(g9===0||g9===6?'color:#8FB3E8;background:#232F4C;':'')}">${+dt.slice(8)}<br>${wd[g9]}</th>`}).join('')}</tr></thead><tbody>`
    names9.forEach(nm=>{
      h += `<tr><td style="text-align:left;font-weight:800;position:sticky;left:0;background:var(--card);z-index:1;padding:4px 8px;white-space:nowrap">${nm}</td>`
      dts9.forEach(dt=>{
        const r = byK9[nm+'|'+dt]
        const g9 = new Date(dt).getDay()
        const tdB = `padding:2px 4px;text-align:center;font-size:11px;border:1px solid var(--line);${g9===0||g9===6?'background:#1B2438;':''}${dt===today?'box-shadow:inset 1.5px 0 0 var(--primary),inset -1.5px 0 0 var(--primary);':''}`
        if (!r){ h += `<td style="${tdB}"></td>`; return }
        const tip = `${nm} ${dt.slice(5)}｜班表 ${r.s?`${r.s.start}-${r.s.end}${r.s.break?`(休${r.s.break})`:''}`:'—'}｜打卡 ${r.firstIn||'—'}${r.lastOut?'~'+r.lastOut:(r.working?'~上班中':'')}${r.h?`｜${r1(r.h)}h`:''}${r.st.length?`｜${r.st.join('、')}`:''}`
        let cell = ''
        if (r.st.includes('未到')) cell = `<b style="color:var(--red)">✕</b>`
        else if (r.working) cell = `<b style="color:var(--green)">●${r.h?r1(r.h):''}</b>`
        else if (r.h > 0){
          const warn9 = r.st.some(x=>/遲到|早退/.test(x)), unsch9 = r.st.includes('未排班出勤')
          cell = `<b style="color:${unsch9?'#B9A3E8':warn9?'#E8A657':'var(--ink)'};${r.over12?'text-shadow:0 0 1px var(--red);border-bottom:2px solid var(--red);':''}">${r1(r.h)}</b>`
        } else if (r.s) cell = `<span class="hint" style="font-size:10px">${dt>=today?'排':'—'}</span>`
        h += `<td style="${tdB}${meN&&r.s?'cursor:pointer;':''}" title="${tip}"${meN&&r.s?` onclick="shiftForm('${r.s.id}')"`:''}>${cell}</td>`
      })
      h += `</tr>`
    })
    h += `</tbody></table></div>`
  }
  else dts.forEach(dt=>{
    h += `<div style="font-weight:900;margin:10px 0 4px;color:var(--pdark)">${dt.slice(5)}（${wd[new Date(dt).getDay()]}）${dt===today?'・今天':''}</div>`
    byDate[dt].sort((a,b)=>a.name.localeCompare(b.name)).forEach(r=>{
      const bad = r.st.some(x=>x!=='上班中')
      h += `<div style="background:var(--card);border:1.5px solid ${r.over12?'var(--red)':'var(--line)'};border-radius:10px;padding:7px 10px;margin-bottom:6px;font-size:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <b style="min-width:56px">${r.name}</b>
        <span class="hint">班表 ${r.s?`${r.s.start}-${r.s.end}${r.s.break?`(休${r.s.break})`:''}`:'—'}</span>
        <span class="hint">打卡 ${r.firstIn||'—'}${r.lastOut?'~'+r.lastOut:(r.working?'~上班中':'')}</span>
        <span style="font-weight:800;color:${r.over12?'var(--red)':'var(--ink)'}">${r.h?r1(r.h)+'h':''}</span>
        ${r.st.map(x=>`<span style="font-size:13px;font-weight:800;color:${x==='上班中'?'var(--green)':'var(--red)'};background:${x==='上班中'?'#1C3326':'#3A2023'};border-radius:6px;padding:1px 7px">${x}</span>`).join('')}
        ${meN&&r.s?`<span style="margin-left:auto"><button class="mini" onclick="shiftForm('${r.s.id}')">✏️</button> <button class="mini" style="color:var(--red)" onclick="if(confirm('刪除 ${r.name} ${dt} 的班？'))shiftDelFast('${r.s.id}')">🗑</button></span>`:''}
      </div>`
    })
  })
  h += `</section>`
  app.innerHTML = h
  laborMount() // 🧮 工時成本（v4.28.1 掛在班表下面）
  window._shDir = null // 動畫方向用完即清
  window._shBuildGrid = buildGrid // 給 shGridOnly（邊緣多載/補資料）重畫格子用，吃最新的 d/權限/作用週
  const _box = document.getElementById('shBox'); if (_box) _box.onscroll = shOnScroll
  // 捲動位置三段式（v4.25.6）：①有目標(開啟/翻月/翻週/今天鈕)→捲目標 ②沒目標但重畫前有位置→還原原位(編輯存檔不亂跳) ③都沒有(重新整理第一次畫)→預設捲到今天
  { const tgtDate = window._shScrollTo ? (window._shScrollTo==='today' ? today : window._shScrollTo) : null; window._shScrollTo = null
    requestAnimationFrame(()=>{ try{ const box=document.getElementById('shBox'); if(!box)return
      if (!tgtDate && _prevAnchor){ const thP=box.querySelector('th[data-d="'+_prevAnchor.date+'"]'); if(thP){ box.scrollLeft += thP.getBoundingClientRect().left - box.getBoundingClientRect().left - _prevAnchor.vx; box.scrollTop = _prevTop; return } }
      // v4.28.3（張良）：初始定位——手機=目標日的「昨天」靠左（回看昨天+看到今天）、電腦=往前四天開始
      const base = tgtDate || today
      const bk = new Date(base); bk.setDate(bk.getDate() - (window.innerWidth < 920 ? 1 : 4))
      const bd = bk.toISOString().slice(0,10)
      const th = box.querySelector('th[data-d="'+bd+'"]') || box.querySelector('th[data-d="'+base+'"]') || box.querySelector('th[data-d="'+today+'"]')
      const stW = ((box.querySelector('thead th')||{}).offsetWidth) || 90 // 崗位凍結欄寬：目標欄貼齊它右邊
      if(th){ box.scrollLeft += th.getBoundingClientRect().left - box.getBoundingClientRect().left - stW }
      if(_prevTop) box.scrollTop = _prevTop
    }catch(_){} })
  }
  // 無限軸：確保範圍內各月份資料都載入(未載的欄先空白，載到再補)——只在有缺時跑
  const _need = shRangeYms().filter(y=>!(window._shLoaded||[]).includes(y))
  if (_need.length){ shEnsure(shRangeYms()).then(()=>{ if(curStore!=='shift')return; const box=document.getElementById('shBox'); if(box) window._shAnchor=shLeftAnchor(box); shGridOnly() }) }
}
function shiftForm(id){
  const d = window._shiftD, it = id ? shMergedSched().find(x=>x.id===id) : null // v4.28.6 跨月找——舊月的卡也點得開
  const ov = document.createElement('div'); ov.id='shOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  const ip = 'border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;font-family:inherit'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:420px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:10px">${it?'✏️ 編輯':'📅 新增'}排班</div>
    <div style="display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:center;font-size:14px">
      <span>夥伴</span><span><select id="shName" style="${ip};width:100%">${(it&&it.name&&!(d.names||[]).includes(it.name)?[it.name,...(d.names||[])]:(d.names||[])).map(n=>`<option${it&&it.name===n?' selected':''}>${n}</option>`).join('')}</select></span>
      <span>崗位</span><span><select id="shPos" style="${ip};width:100%">${(()=>{const pl=(d.posList&&d.posList.length?d.posList:[...new Set((d.sched||[]).map(x=>x.pos).filter(Boolean))]);const cur=it?(it.pos||''):'';const all=cur&&!pl.includes(cur)?[cur,...pl]:pl;return `<option value="">（不分崗）</option>`+all.map(n=>`<option${cur===n?' selected':''}>${n}</option>`).join('')})()}</select></span>
      <span>日期</span><input id="shDate" type="date" value="${it?it.date:todayTpe()}" style="${ip}">
      <span>上班</span><span>${t24c('shS', it?it.start:'11:00')}</span>
      <span>下班</span><span>${t24c('shE', it?it.end:'20:00')}</span>
      <span>休息(分)</span><input id="shBreak" type="number" value="${it?(it.break||0):60}" min="0" max="240" style="${ip}">
      <span>🎓帶訓</span><span><select id="shTr" style="${ip};width:100%">${trOpts(d, it?(it.pos||''):'', it?(it.tr||''):'')}</select></span>
    </div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
    <span>${it?`<button class="mini" style="padding:9px 12px;color:var(--red)" onclick="if(confirm('刪除 ${it.name} ${it.date} 這個班？')){document.getElementById('shOv').remove();shiftDelFast('${it.id}')}">🗑 刪除</button>`:''}</span>
    <span style="display:flex;gap:8px"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('shOv').remove()">取消</button>
    <button class="mini on" style="padding:9px 18px" onclick="shiftSave('${id||''}')">儲存</button></span></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function shiftSave(id){
  const g2 = x => (document.getElementById(x)||{}).value||''
  const ovS = document.getElementById('shOv')
  const item = { id: id||undefined, name: g2('shName').trim(), date: g2('shDate'), start: t24read(ovS,'shS'), end: t24read(ovS,'shE'), break: +g2('shBreak')||0, pos: g2('shPos').trim(), tr: g2('shTr').trim() }
  if (item.tr === item.name) item.tr = ''
  if (!item.name || !item.date || !item.start || !item.end) { alert('姓名/日期/時間要填齊'); return }
  const o = document.getElementById('shOv'); if (o) o.remove()
  // 樂觀＋排隊（v4.4.7）：畫面先改，寫入排隊不互蓋
  const dL = window._shiftD
  if (item.id && String(item.id).startsWith('tmp')) { // v4.4.8 分身治本：編輯排隊中的暫存卡＝只改暫存卡內容，由原本排隊那筆帶最終狀態寫入，不另開一筆
    const t2 = window._shiftTmpQ.find(x=>x.id===item.id)
    const old = dL.sched.find(x=>x.id===item.id)
    if (old) Object.assign(old, item)
    if (t2 && t2 !== old) Object.assign(t2, item, { id: t2.id })
    shiftRender(); return
  }
  if (item.id) { const old = dL.sched.find(x=>x.id===item.id); if (old) Object.assign(old, item) } else { const tmp = { ...item, id: 'tmp' + Math.random().toString(36).slice(2) }; window._shiftTmpQ.push(tmp); dL.sched.push(tmp); item._tmpId = tmp.id }
  shiftRender()
  shQueue(async ()=>{
    const tmpId = item._tmpId; delete item._tmpId
    let send = item, t2 = null
    if (tmpId) { t2 = window._shiftTmpQ.find(x=>x.id===tmpId); if (t2) { if (t2._del) { window._shiftTmpQ = window._shiftTmpQ.filter(x=>x!==t2); return } send = { ...t2 }; delete send.id; delete send._del } }
    const d = await shPost({ op:'save', item: send, token: TK() })
    if (t2) { window._shiftTmpQ = window._shiftTmpQ.filter(x=>x!==t2); if (d && d.ok && d.id) t2.id = d.id }
    if (!(d && d.ok)) alert((d&&d.error)||'儲存失敗')
  })
}
async function shiftDel(id){
  const r = await fetch('/api/mail-sync?shiftset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'del', id, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) shiftLoad(); else { alert((d&&d.error)||'失敗'); shiftLoad() }
}
function shiftDelFast(id){ // 樂觀刪除：卡片先消失，背景排隊送刪
  const d = window._shiftD
  d.sched = d.sched.filter(x=>x.id!==id)
  ;(window._shLoaded||[]).forEach(y=>{ try{ const c=tcGet('shift_'+y); if(c&&(c.sched||[]).some(x=>x.id===id)){ c.sched=c.sched.filter(x=>x.id!==id); tcSet('shift_'+y,c) } }catch(_){} }) // v4.28.6 舊月快取一起清
  shiftRender()
  if (String(id).startsWith('tmp')) { const t2 = window._shiftTmpQ.find(x=>x.id===id); if (t2) t2._del = 1; return } // 標記取消——排隊那筆看到就不送（v4.4.8）
  shQueue(async ()=>{ const d2 = await shPost({ op:'del', id, token: TK() }); if (!(d2&&d2.ok)) alert((d2&&d2.error)||'刪除失敗') })
}
// ── 週表直排（張良 2026-10-02「點擊直接選人名、可拖曳」）──
// v4.4.7 連點掉卡治本：存檔改「排隊逐筆送」——同時多筆寫入會在伺服器端互蓋（整份清單讀改寫）；
// 樂觀卡記在 _shiftTmpQ，重載時補回畫面，等整條隊伍跑完才正式重載一次
window._shQ = Promise.resolve(); window._shQn = 0; window._shiftTmpQ = []
function shQueue(fn){
  window._shQn++
  window._shQ = window._shQ.then(fn).catch(()=>{}).then(()=>{ window._shQn--; if (window._shQn === 0) shiftLoad() })
}
const shPost = body => fetch('/api/mail-sync?shiftset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }).then(r=>r.json()).catch(()=>null)
