// ⚠️ 這是 /prep 主程式的第 7/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：工時成本試算+品項明細
// ── 🧮 工時成本試算（張良 2026-10-03：每小時×崗位填金額、右/下自動加總、Excel拖曳複製、方案=版本切換比較；v4.28.1 掛班表下面＋↩️復原）──
let laborCur = null, _lbFill = null, _lbSaveT = null, _lbUndo = []
const LB_HOURS = [...Array(14)].map((_,i)=>String(8+i).padStart(2,'0')) // 08..21（8-22區間）
// v4.28.4（張良「欄改成跟班表崗位一樣」）：欄位=班表崗位清單自動同步＋同款三組配色
const LB_GRP = ps => /櫃檯|飲料|中控/.test(ps) ? 0 : /漢堡|煎炸|炸麵/.test(ps) ? 1 : /披薩|三明治/.test(ps) ? 2 : 3
// v4.28.8（張良「直接跳出選單 200 220 250 280 300 不同數字顏色能分辨」）
const LB_AMTS = [200,220,250,280,300]
const LB_AC = {200:'#B07CC6',220:'#4DB6AC',250:'#66BB6A',280:'#FFA726',300:'#4DA3FF'} // 選單/數字色
const LB_AB = {200:'#271A30',220:'#122B28',250:'#152B17',280:'#2F2210',300:'#13283E'} // 格底色
const LB_GC = [{bg:'#17233A',ink:'#7FB5F5'},{bg:'#2C2012',ink:'#E8A657'},{bg:'#152719',ink:'#6FCF8F'},{bg:'#1C222B',ink:'#93A0B2'}]
async function laborMount(){
  const el = document.getElementById('lbSec'); if (!el) return
  if (!window._laborD) { try { const r = await fetch('/api/mail-sync?labor=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); const d2 = await r.json(); if (d2 && d2.ok) window._laborD = d2 } catch(e){} }
  if (!window._laborD) { el.innerHTML = '<div class="err">讀不到工時成本資料</div>'; return }
  const d2 = window._laborD
  if (!(d2.sheets||[]).length) d2.sheets = [{ id:'lb'+Date.now().toString(36), name:'方案A', cols:['收銀','控台','飲料','沙拉','煎炸+麵','漢堡','披薩'], rows:{} }]
  if (!laborCur || !d2.sheets.some(x=>x.id===laborCur)) laborCur = d2.sheets[0].id
  laborRender()
}
function lbSheet(){ const d2=window._laborD||{}; return (d2.sheets||[]).find(x=>x.id===laborCur) || (d2.sheets||[])[0] }
function lbV(sh,h,c){ return Number(((sh.rows||{})[h]||{})[c]) || 0 }
function lbSetV(sh,h,c,v){ sh.rows=sh.rows||{}; sh.rows[h]=sh.rows[h]||{}; const n2=Number(v)||0; if(n2) sh.rows[h][c]=n2; else { delete sh.rows[h][c]; if(!Object.keys(sh.rows[h]).length) delete sh.rows[h] } }
function lbPushUndo(){ const sh=lbSheet(); if(!sh) return; _lbUndo.push(JSON.stringify({ id:sh.id, cols:sh.cols, rows:sh.rows||{} })); if(_lbUndo.length>30) _lbUndo.shift() }
function lbUndo(){ const sn=_lbUndo.pop(); if(!sn){ alert('沒有可復原的步驟了'); return }
  const o=JSON.parse(sn); const sh=(window._laborD.sheets||[]).find(x=>x.id===o.id); if(!sh) return
  sh.cols=o.cols; sh.rows=o.rows; laborCur=o.id; laborRender(); lbSave() }
function lbSave(){ clearTimeout(_lbSaveT); _lbSaveT = setTimeout(async()=>{
  const sh = lbSheet(); if (!sh) return
  const r = await fetch('/api/mail-sync?laborset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'save', sheet:{ id:sh.id, name:sh.name, cols:sh.cols, rows:sh.rows||{}, wage:sh.wage||300, pct:sh.pct||20, fin:sh.fin||null }, token: TK() }) }).then(r2=>r2.json()).catch(()=>null)
  if (!r || !r.ok) alert((r&&r.error)||'工時成本沒存成功——確認有綁定/權限後再改一次')
}, 600) }
function laborRender(){
  const el = document.getElementById('lbSec'); const d2 = window._laborD
  if (!el || !d2) return
  const meN = d2.me ? d2.me.name : null
  const sh = lbSheet(); if (!sh) { el.innerHTML = '沒有方案'; return }
  // 欄位＝班表崗位（⚙️ 設定改崗位這邊自動跟）；換欄時按名字搬舊數字
  const posCols = (window._shiftD && (window._shiftD.posList||[]).length) ? window._shiftD.posList.filter(c=>!/開班|收班/.test(c)) : null // v4.29.2 張良：開班/收班不進成本表
  if (posCols && (sh.cols||[]).join('|') !== posCols.join('|')) {
    const old = sh.cols || []; const map = {}
    old.forEach((nm,oi)=>{ const ni = posCols.indexOf(nm); if (ni >= 0) map[oi] = ni })
    const nr = {}
    for (const [h2,ro] of Object.entries(sh.rows||{})) { const r2 = {}; for (const [k2,v2] of Object.entries(ro)) { if (map[k2] != null) r2[map[k2]] = v2 } if (Object.keys(r2).length) nr[h2] = r2 }
    sh.rows = nr; sh.cols = posCols.slice()
    if (meN) lbSave()
  }
  const cols = sh.cols || []
  const rowSum = h => cols.reduce((a,_,ci)=>a+lbV(sh,h,ci),0)
  const colSum = ci => LB_HOURS.reduce((a,h)=>a+lbV(sh,h,ci),0)
  const grand = LB_HOURS.reduce((a,h)=>a+rowSum(h),0)
  const fmtN = n2 => n2 ? n2.toLocaleString('en-US') : ''
  let h = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
    ${(d2.sheets||[]).map(x=>`<button class="mini${x.id===laborCur?' on':''}" style="padding:6px 14px;font-weight:800" onclick="lbSwitch('${x.id}')">${x.name}</button>`).join('')}
    ${meN?`<button class="mini" style="padding:6px 12px" onclick="lbNew()">＋ 新方案</button><button class="mini" style="padding:6px 12px" onclick="lbCopy()">複製</button><button class="mini" style="padding:6px 12px" onclick="lbRen()">改名</button><button class="mini" style="padding:6px 12px" onclick="lbUndo()">復原</button><button class="mini" style="padding:6px 12px" onclick="lbClearAll()">清空整表</button><button class="mini" style="padding:6px 12px;font-weight:800" onclick="lbSnap()">存檔</button><button class="mini" style="padding:6px 12px" onclick="window._lbVaultOpen=!window._lbVaultOpen;laborRender()">版本庫${(d2.versions||[]).length?` (${d2.versions.length})`:''}</button><button class="mini" style="padding:6px 12px;font-weight:800" onmousedown="event.stopPropagation()" onclick="lbWageMenu(event)">時薪 ${sh.wage||300} ▾</button>${(d2.sheets||[]).length>1?`<button class="mini" style="padding:6px 12px;color:var(--red)" onclick="lbDel()">刪方案</button>`:''}`:'<span class="hint">綁定後才能編輯</span>'}
  </div>
  ${window._lbVaultOpen?`<div style="background:var(--card);border:1.5px solid var(--line);border-radius:10px;padding:8px 11px;margin:0 0 8px;font-size:13.5px">
    <b>版本檔案庫</b> <span class="hint">「存檔」＝幫目前方案拍快照；之後表怎麼被改都動不到快照，隨時可還原（最多留 40 份）</span>
    ${((d2.versions||[]).slice().reverse().map(v9=>`<div style="display:flex;gap:8px;align-items:center;border-top:1px dashed var(--line);padding:5px 0;flex-wrap:wrap">
      <b style="min-width:0">${v9.name}</b><span class="hint" style="font-size:11.5px">${v9.by||''}・${v9.ts||''}</span>
      ${meN?`<span style="margin-left:auto;display:inline-flex;gap:6px"><button class="mini" style="padding:3px 10px" onclick="lbVRestore('${v9.vid}')">還原</button><button class="mini" style="padding:3px 10px" onclick="lbVRen('${v9.vid}')">改名</button><button class="mini" style="padding:3px 10px;color:var(--red)" onclick="lbVDel('${v9.vid}')">刪除</button></span>`:''}
    </div>`).join(''))||'<div class="mut" style="padding:6px 0">還沒有存檔——按上面「存檔」保存目前這張表</div>'}
  </div>`:''}
  <div class="scroll"><table id="lbTbl" style="border-collapse:collapse;user-select:none">
  <thead><tr><th style="padding:6px 10px;text-align:left;position:sticky;left:0;background:var(--soft);z-index:2">時段</th>
  ${cols.map((c,ci)=>{ const g=LB_GC[LB_GRP(c)]; return `<th style="padding:6px 8px;text-align:center;min-width:86px;white-space:nowrap;background:${g.bg};color:${g.ink};font-weight:800;${meN?'cursor:pointer':''}" ${meN?`onclick="lbColClear(${ci})" title="點我＝清空這一欄"`:''}>${c}</th>` }).join('')}
  <th style="padding:6px 10px;text-align:right;font-weight:900">小計</th><th style="padding:6px 10px;text-align:right;font-weight:900">人數</th></tr></thead><tbody>`
  LB_HOURS.forEach(hh=>{
    const meal = hh==='12'||hh==='13'||hh==='18' // v4.30.3 張良「再明顯一點 每個格子跟數字都看得出來」：整列每格淡金描邊+底色加亮
    const mealBg = meal ? 'background:#262B33;box-shadow:inset 0 0 0 1px rgba(226,233,242,.14);' : '' // v4.30.4 偏白色系、框線收斂
    const mealLn = meal ? 'box-shadow:inset 0 0 0 1px rgba(226,233,242,.14);' : ''
    h += `<tr><td style="padding:4px 10px;text-align:left;font-weight:800;position:sticky;left:0;${meal?'background:#262B33;color:#EDF2F8;box-shadow:inset 0 0 0 1px rgba(226,233,242,.14);':'background:var(--card);'}z-index:1;white-space:nowrap;${meN?'cursor:pointer':''}" ${meN?`onclick="lbRowClear('${hh}')" title="點我＝清空這一列"`:''}>${+hh}-${+hh+1}</td>`
    cols.forEach((_,ci)=>{
      const v = lbV(sh,hh,ci)
      h += `<td id="lc_${hh}_${ci}" style="padding:0;text-align:center;min-width:86px;border:1px solid var(--line);${v?`background:${LB_AB[v]||'#1E2630'};`:(meal?'background:#232831;':'')}${mealLn}${meN?'cursor:cell;':''}font-variant-numeric:tabular-nums"
        ${meN?`onmousedown="lbDown(event,'${hh}',${ci})" onmouseenter="lbEnter('${hh}',${ci})"`:''}><div style="padding:6px 8px;min-height:19px;font-weight:800;color:${v?(LB_AC[v]||'var(--ink)'):'var(--ink)'}">${fmtN(v)}</div></td>`
    })
    const ppl = cols.reduce((a,_,ci)=>a+(lbV(sh,hh,ci)?1:0),0)
    h += `<td style="padding:4px 10px;text-align:right;font-weight:900;white-space:nowrap;${mealBg}">${fmtN(rowSum(hh))}</td><td style="padding:4px 10px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums;${mealBg}">${ppl||''}</td></tr>`
  })
  h += `<tr><td style="padding:6px 10px;text-align:left;font-weight:900;position:sticky;left:0;background:var(--soft);z-index:1">合計</td>
  ${cols.map((_,ci)=>`<td style="padding:6px 8px;text-align:center;font-weight:900;background:var(--soft)">${fmtN(colSum(ci))}</td>`).join('')}
  <td style="padding:6px 10px;text-align:right;font-weight:900;color:var(--red);background:var(--soft);font-size:15px">${fmtN(grand)}</td><td style="background:var(--soft)"></td></tr>`
  // 時數列（張良：人數/時數分格子、跟其他數字一樣顯示）
  h += `<tr><td style="padding:6px 10px;text-align:left;font-weight:900;position:sticky;left:0;background:var(--soft);z-index:1">時數</td>
  ${cols.map((_,ci)=>`<td style="padding:6px 8px;text-align:center;font-weight:800;background:var(--soft);font-variant-numeric:tabular-nums">${LB_HOURS.reduce((a,h2)=>a+(lbV(sh,h2,ci)?1:0),0)||''}</td>`).join('')}
  <td style="padding:6px 10px;text-align:right;font-weight:900;background:var(--soft)">${LB_HOURS.reduce((a,h2)=>a+cols.reduce((b,_,ci)=>b+(lbV(sh,h2,ci)?1:0),0),0)||''}</td><td style="background:var(--soft)"></td></tr>`
  h += `</tbody></table></div>
  ${(()=>{ // 反推營業額（張良 2026-10-03；v4.29.0 去emoji表格化：固定成本/變動比率兩欄+結果列）
    const fin = sh.fin || { rent:0, util:0, misc:0, days:26, food:35, tax:5, pay:2, ins:12, profit:0 }
    const hrs = LB_HOURS.reduce((a,h2)=>a+cols.reduce((b,_,ci)=>b+(lbV(sh,h2,ci)?1:0),0),0)
    const mLabor = Math.round(grand * (fin.days||26) * (1 + (fin.ins||0)/100))
    const fixed = (fin.rent||0) + (fin.util||0) + (fin.misc||0) + mLabor
    const varP = (fin.food||0) + (fin.tax||0) + (fin.pay||0)
    const allP = varP + (fin.profit||0)
    const R = allP < 100 ? Math.ceil(fixed / (1 - allP/100)) : 0
    const daily = R && fin.days ? Math.ceil(R / fin.days) : 0
    const pc = v => R ? Math.round(v / R * 1000)/10 : 0 // 佔比（以目標營業額為分母）
    const lp = pc(mLabor)
    const inp2 = (sf,v,w2)=>`<input value="${v}" inputmode="numeric" style="width:${w2}px;border:none;background:transparent;color:var(--ink);font-size:13.5px;font-weight:800;text-align:right;outline:none;border-bottom:1.5px solid var(--primary);font-variant-numeric:tabular-nums" onchange="lbFinSet('${sf}',this.value)">`
    const TL='padding:6px 12px;text-align:left;color:var(--muted);font-weight:700;font-size:13px;border-top:1px solid var(--line);white-space:nowrap'
    const TR='padding:6px 12px;text-align:right;font-weight:800;border-top:1px solid var(--line);font-variant-numeric:tabular-nums;white-space:nowrap'
    return `<div style="border:1.5px solid var(--line);border-radius:10px;margin-top:8px;overflow:hidden;background:var(--card)">
    <div style="padding:7px 12px;font-weight:900;font-size:13.5px;background:var(--soft);letter-spacing:.4px">反推營業額</div>
    <div style="display:flex;flex-wrap:wrap">
      <table style="flex:1;min-width:252px;border-collapse:collapse">
        <tr><td style="${TL};border-top:none">固定成本（每月）</td><td style="${TR};border-top:none"></td></tr>
        <tr><td style="${TL}">日人事（上表）</td><td style="${TR}"><span style="color:var(--red)">${fmtN(grand)||0}</span> <span class="hint" style="font-weight:700">${hrs}小時</span></td></tr>
        <tr><td style="${TL}">營業天數／月</td><td style="${TR}">${inp2('days',fin.days||26,34)} 天</td></tr>
        <tr><td style="${TL}">月租金</td><td style="${TR}">${inp2('rent',fin.rent||0,76)}</td></tr>
        <tr><td style="${TL}">月水電</td><td style="${TR}">${inp2('util',fin.util||0,66)}</td></tr>
        <tr><td style="${TL}">月雜支（耗材／維修）</td><td style="${TR}">${inp2('misc',fin.misc||0,66)}</td></tr>
        <tr><td style="${TL}">月人事（含勞健保）</td><td style="${TR}">${fmtN(mLabor)}</td></tr>
      </table>
      <table style="flex:1;min-width:232px;border-collapse:collapse;border-left:1px solid var(--line)">
        <tr><td style="${TL};border-top:none">變動比率（抽營業額）</td><td style="${TR};border-top:none"></td></tr>
        <tr><td style="${TL}">食材成本</td><td style="${TR}">${inp2('food',fin.food||0,30)} % <span class="hint" style="font-weight:700">毛利 ${100-(fin.food||0)}%</span></td></tr>
        <tr><td style="${TL}">稅費</td><td style="${TR}">${inp2('tax',fin.tax||0,26)} %</td></tr>
        <tr><td style="${TL}">金流／外送手續</td><td style="${TR}">${inp2('pay',fin.pay||0,26)} %</td></tr>
        <tr><td style="${TL}">勞健保附加（乘人事）</td><td style="${TR}">${inp2('ins',fin.ins||0,26)} %</td></tr>
        <tr><td style="${TL}">目標淨利（0＝損益兩平）</td><td style="${TR}">${inp2('profit',fin.profit||0,26)} %</td></tr>
        <tr><td style="${TL}">變動＋淨利合計</td><td style="${TR}">${allP}%</td></tr>
      </table>
    </div>
    <div style="border-top:1px solid var(--line);background:var(--soft);padding:9px 12px;display:flex;gap:18px;flex-wrap:wrap;align-items:baseline;font-weight:800;font-size:13.5px">
      <span>固定成本／月 <span style="font-variant-numeric:tabular-nums">${fmtN(fixed)}</span></span>
      <span>每月要做 <span style="color:var(--green);font-size:17px;font-variant-numeric:tabular-nums">${R?'NT$'+fmtN(R):'—'}</span></span>
      <span>平均每天 <span style="color:var(--green);font-size:15px;font-variant-numeric:tabular-nums">${daily?'NT$'+fmtN(daily):'—'}</span></span>
    </div>
    ${R?`<div style="border-top:1px solid var(--line);padding:8px 12px;display:flex;gap:6px 14px;flex-wrap:wrap;font-size:12.5px;font-weight:700;color:var(--muted)">
      <span>佔營業額：</span>
      <span>人事 <b style="color:var(--ink)">${lp}%</b></span>
      <span>食材 <b style="color:var(--ink)">${fin.food||0}%</b></span>
      <span>租金 <b style="color:var(--ink)">${pc(fin.rent||0)}%</b></span>
      <span>水電 <b style="color:var(--ink)">${pc(fin.util||0)}%</b></span>
      <span>雜支 <b style="color:var(--ink)">${pc(fin.misc||0)}%</b></span>
      <span>稅費 <b style="color:var(--ink)">${fin.tax||0}%</b></span>
      <span>金流／外送 <b style="color:var(--ink)">${fin.pay||0}%</b></span>
      <span>淨利 <b style="color:var(--green)">${fin.profit||0}%</b></span>
    </div>`:''}</div>`
  })()}`
  el.className = ''
  el.innerHTML = h
}
function lbSwitch(id){ laborCur = id; laborRender() }
function lbNew(){ const nm = prompt('新方案名稱','方案'+String.fromCharCode(65+(window._laborD.sheets||[]).length)); if(!nm) return
  const sh = { id:'lb'+Date.now().toString(36), name:nm.trim().slice(0,20), cols:(lbSheet()?lbSheet().cols.slice():['收銀','控台','飲料']), rows:{} }
  window._laborD.sheets.push(sh); laborCur = sh.id; laborRender(); lbSave() }
function lbCopy(){ const cur = lbSheet(); if(!cur) return; const nm = prompt('複製成新方案，取個名字', cur.name+'-複製'); if(!nm) return
  const sh = { id:'lb'+Date.now().toString(36), name:nm.trim().slice(0,20), cols:cur.cols.slice(), rows:JSON.parse(JSON.stringify(cur.rows||{})) }
  window._laborD.sheets.push(sh); laborCur = sh.id; laborRender(); lbSave() }
function lbRen(){ const cur = lbSheet(); if(!cur) return; const nm = prompt('方案改名', cur.name); if(!nm) return; cur.name = nm.trim().slice(0,20); laborRender(); lbSave() }
async function lbVPost(body){ const r = await fetch('/api/mail-sync?laborset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...body, token: TK() }) }).then(r2=>r2.json()).catch(()=>null)
  if (!r || !r.ok) { alert((r&&r.error)||'沒成功，再試一次'); return null } return r }
async function lbSnap(){ // v4.31.6 存檔＝拍快照進版本庫（張良「怕自己或別人動到」）
  const cur = lbSheet(); if(!cur) return
  const r = await lbVPost({ op:'snap', id: cur.id }); if(!r) return
  window._laborD.versions = r.versions; window._lbVaultOpen = true; laborRender() }
async function lbVRestore(vid){ const v9=(window._laborD.versions||[]).find(x=>x.vid===vid); if(!v9) return
  if(!confirm('用「'+v9.name+'」蓋回方案？（目前表上的內容會被取代；建議先按「存檔」留一份現況）')) return
  const r = await lbVPost({ op:'restore', vid }); if(!r) return
  window._laborD.sheets = r.sheets; window._laborD.versions = r.versions; laborCur = (v9.sheet||{}).id || laborCur; laborRender() }
async function lbVRen(vid){ const v9=(window._laborD.versions||[]).find(x=>x.vid===vid); if(!v9) return
  const nm = prompt('版本改名', v9.name); if(!nm) return
  const r = await lbVPost({ op:'vren', vid, name: nm.trim().slice(0,40) }); if(!r) return
  window._laborD.versions = r.versions; laborRender() }
async function lbVDel(vid){ const v9=(window._laborD.versions||[]).find(x=>x.vid===vid); if(!v9) return
  if(!confirm('刪除版本「'+v9.name+'」？（不影響現在的表）')) return
  const r = await lbVPost({ op:'vdel', vid }); if(!r) return
  window._laborD.versions = r.versions; laborRender() }
async function lbDel(){ const cur = lbSheet(); if(!cur) return; if(!confirm('刪除方案「'+cur.name+'」？')) return
  window._laborD.sheets = window._laborD.sheets.filter(x=>x.id!==cur.id); laborCur = (window._laborD.sheets[0]||{}).id; laborRender()
  await fetch('/api/mail-sync?laborset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'del', id:cur.id, token: TK() }) }) }
function lbColClear(ci){ const sh=lbSheet(); if(!confirm('清空「'+sh.cols[ci]+'」整欄的數字？（↩️ 可復原）')) return
  lbPushUndo(); for(const h2 of Object.keys(sh.rows||{})){ delete sh.rows[h2][ci]; if(!Object.keys(sh.rows[h2]).length) delete sh.rows[h2] } laborRender(); lbSave() }
function lbRowClear(h){ const sh=lbSheet(); if(!confirm('清空 '+(+h)+'-'+(+h+1)+' 整列的數字？（↩️ 可復原）')) return
  lbPushUndo(); delete (sh.rows||{})[h]; laborRender(); lbSave() }
function lbClearAll(){ const sh=lbSheet(); if(!confirm('清空「'+sh.name+'」整張表的數字？（↩️ 可復原）')) return
  lbPushUndo(); sh.rows={}; laborRender(); lbSave() }
// Excel 式：mousedown 起點→拖過範圍高亮→放開=把起點值複製到整個矩形；原地放開=編輯那格
function lbDown(ev,h,c){ ev.preventDefault(); _lbFill = { h, c, h2:h, c2:c, moved:false }; lbHL() }
function lbEnter(h,c){ if(!_lbFill) return; _lbFill.h2=h; _lbFill.c2=c; _lbFill.moved=true; lbHL() }
function lbHL(){ const f=_lbFill; if(!f) return
  document.querySelectorAll('#lbTbl td[id^=lc_]').forEach(td=>{ td.style.outline=''; td.style.background='' })
  const hA=Math.min(+f.h,+f.h2), hB=Math.max(+f.h,+f.h2), cA=Math.min(f.c,f.c2), cB=Math.max(f.c,f.c2)
  for(let hh=hA;hh<=hB;hh++) for(let cc=cA;cc<=cB;cc++){ const td=document.getElementById('lc_'+String(hh).padStart(2,'0')+'_'+cc); if(td){ td.style.background='#1A2940'; td.style.outline='1.5px solid var(--primary)' } }
}
document.addEventListener('mouseup', ()=>{
  const f=_lbFill; if(!f) return; _lbFill=null
  const sh=lbSheet(); if(!sh) return
  if(!f.moved){ lbAmtMenu(f.h,f.c); return }
  lbPushUndo()
  const v = lbV(sh,f.h,f.c)
  const hA=Math.min(+f.h,+f.h2), hB=Math.max(+f.h,+f.h2), cA=Math.min(f.c,f.c2), cB=Math.max(f.c,f.c2)
  for(let hh=hA;hh<=hB;hh++) for(let cc=cA;cc<=cB;cc++) lbSetV(sh,String(hh).padStart(2,'0'),cc,v)
  laborRender(); lbSave()
})
function lbMnClose(){ const m=document.getElementById('lbMn'); if(m) m.remove() }
document.addEventListener('mousedown', e2=>{ const m=document.getElementById('lbMn'); if(m && !m.contains(e2.target)) m.remove() })
function lbMnShow(anchorEl, btnsHtml){ // 貼著目標的小浮選單（張良「討厭跳出視窗」）
  lbMnClose()
  const r2 = anchorEl.getBoundingClientRect()
  const m = document.createElement('div'); m.id='lbMn'
  m.style.cssText = `position:fixed;left:${Math.min(r2.left, window.innerWidth-320)}px;top:${r2.bottom+4}px;z-index:70;background:#222B38;border:1px solid #3B4654;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);padding:6px;display:flex;gap:5px;align-items:center`
  m.innerHTML = btnsHtml
  document.body.appendChild(m)
}
const lbAmtBtn = (v,fn) => `<button style="border:none;border-radius:8px;padding:8px 11px;font-weight:900;font-size:14px;cursor:pointer;background:${LB_AB[v]};color:${LB_AC[v]};border:1.5px solid ${LB_AC[v]}" onmousedown="event.stopPropagation()" onclick="${fn}">${v}</button>`
function lbAmtMenu(h,c){ // 點格＝原地跳金額選單
  const td = document.getElementById('lc_'+h+'_'+c); if(!td) return
  lbMnShow(td, LB_AMTS.map(v=>lbAmtBtn(v,`lbAmtPick('${h}',${c},${v})`)).join('') + `<button style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-weight:800;font-size:13px;cursor:pointer;background:transparent;color:var(--red)" onmousedown="event.stopPropagation()" onclick="lbAmtPick('${h}',${c},0)">✕</button>`)
}
function lbAmtPick(h,c,v){ lbMnClose(); lbPushUndo(); lbSetV(lbSheet(),h,c,v); laborRender(); lbSave() }
function lbWageMenu(ev){ // 時薪選單：選了=整張表全部變該數字
  lbMnShow(ev.currentTarget, LB_AMTS.map(v=>lbAmtBtn(v,`lbWagePick(${v})`)).join(''))
}
function lbWagePick(v){ lbMnClose(); const sh=lbSheet(); lbPushUndo(); sh.wage=v
  for(const h2 of Object.keys(sh.rows||{})) for(const k2 of Object.keys(sh.rows[h2])) sh.rows[h2][k2]=v // 全表非零格=該數字
  laborRender(); lbSave() }
function lbPctSet(v){ const sh=lbSheet(); sh.pct=Math.max(1,Math.min(99,Number(v)||20)); laborRender(); lbSave() }
function lbFinSet(k,v){ const sh=lbSheet(); sh.fin=sh.fin||{ rent:0, util:0, misc:0, days:26, food:35, tax:5, pay:2, ins:12, profit:0 }
  const n2=Number(v)||0
  sh.fin[k] = k==='days' ? Math.max(1,Math.min(31,n2)) : (['food','tax','pay','ins','profit'].includes(k) ? Math.max(0,Math.min(99,n2)) : Math.max(0,Math.min(9999999,n2)))
  laborRender(); lbSave() } // 🧾 反推參數（張良 2026-10-03）
const SLOT_DEF = [{n:'午峰',s:'11:00',e:'14:30'},{n:'離峰',s:'14:30',e:'17:30'},{n:'晚峰',s:'17:30',e:'20:00'},{n:'全日',s:'11:00',e:'20:00'}] // 預設照近30天單量尖峰切；⚙️可自訂
function t24set(cls, v){
  const ov = document.getElementById('qkOv'); if (!ov) return
  const [h,m] = String(v).split(':')
  const sh = ov.querySelector('.'+cls+'h'), sm = ov.querySelector('.'+cls+'m')
  if (sh) sh.value = h
  if (sm){ if (![...sm.options].some(o=>o.value===m)) sm.add(new Option(m,m)); sm.value = m }
}
// 📋 當日細表（張良 2026-10-02：時段×崗位、一鍵複製成文字發群組）
function shiftDay(dt){
  const d = window._shiftD
  const meN2 = d.me ? d.me.name : null
  const wdN2 = ['日','一','二','三','四','五','六']
  const es = d.sched.filter(x=>x.date===dt)
  const posIdx = p2 => { const i = (d.posList||[]).indexOf(p2); return i<0 ? 99 : i }
  const grp = {}
  es.forEach(e=>{ const k2 = e.start+'–'+e.end; (grp[k2]=grp[k2]||[]).push(e) })
  const keys = Object.keys(grp).sort()
  keys.forEach(k2=>grp[k2].sort((a,b)=>posIdx(a.pos||'')-posIdx(b.pos||'')))
  const title = `📅 ${dt.slice(5)}（${wdN2[new Date(dt).getDay()]}）班表`
  const txt = title + '\n' + (keys.length ? keys.map(k2=>`\n${k2}\n`+grp[k2].map(e=>`${e.pos||'—'}：${e.name}${e.tr?`（帶${e.tr}）`:''}`).join('\n')).join('\n') : '\n（還沒排班）')
  window._dayTxt = txt
  const ov = document.createElement('div'); ov.id='sdOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:400px;width:100%;padding:16px;max-height:80vh;overflow:auto" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">${title}</div>
    ${keys.length ? keys.map(k2=>`<div style="font-weight:800;color:var(--primary);margin:8px 0 3px">${k2}</div>`+grp[k2].map(e=>`<div style="display:flex;gap:8px;font-size:14px;padding:3px 0;border-bottom:1px solid var(--line)"><span style="min-width:84px;font-weight:700;color:var(--pdark)">${e.pos||'—'}</span><span>${e.name}${e.tr?` <span style="color:#B45309;font-weight:800">🎓帶${e.tr}</span>`:''}</span></div>`).join('')).join('') : '<div class="mut">這天還沒排班</div>'}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
      <button class="mini" style="padding:9px 12px" onclick="document.getElementById('sdOv').remove()">關閉</button>
      ${keys.length&&meN2?`<button class="mini" style="padding:9px 12px;color:var(--red)" onclick="document.getElementById('sdOv').remove();clearDay('${dt}')">🗑 清空這天</button>`:''}
      ${keys.length?`<button class="mini" style="padding:9px 12px" onclick="copyDay('${dt}')">⧉ 複製這天</button><button class="mini on" style="padding:9px 16px" onclick="navigator.clipboard.writeText(window._dayTxt).then(()=>{this.textContent='✓ 已複製';setTimeout(()=>{const o=document.getElementById('sdOv');if(o)o.remove()},700)})">📋 複製文字（貼群組）</button>`:''}
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function shiftQuick(pos, dt){
  const d = window._shiftD
  // 預設時間：同崗位最近一筆 → 整體最近一筆 → 11:00-20:00
  const byNew = (a,b)=>b.date.localeCompare(a.date)
  const last = [...d.sched].filter(x=>(x.pos||'未分崗')===pos).sort(byNew)[0] || [...d.sched].sort(byNew)[0]
  const defS = last?last.start:'11:00', defE = last?last.end:'20:00', defB = last?(last.break==null?60:last.break):60
  const busy = new Set(d.sched.filter(x=>x.date===dt).map(x=>x.name)) // 當天已有班的人標示
  const wdN2 = ['日','一','二','三','四','五','六']
  const ov = document.createElement('div'); ov.id='qkOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  const slots = (d.slots && d.slots.length) ? d.slots : SLOT_DEF
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:420px;width:100%;padding:16px;max-height:80vh;overflow:auto" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px;display:flex;align-items:center;gap:8px">📅 ${dt.slice(5)}（${wdN2[new Date(dt).getDay()]}）・${pos}${d.sched.some(x=>x.date===dt&&(x.pos||'未分崗')===pos)?`<button class="mini" style="margin-left:auto;padding:4px 10px" onclick="copyCell('${pos}','${dt}')">⧉ 複製這格</button>`:''}</div>
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">${slots.map(sl=>`<button class="mini" style="padding:5px 10px" onclick="t24set('qkS','${sl.s}');t24set('qkE','${sl.e}');this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${sl.n} ${sl.s}–${sl.e}</button>`).join('')}</div>
    <div id="qkMsg" style="display:none;color:var(--green);font-weight:800;margin-bottom:6px"></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:14px;margin-bottom:10px">
      <span>上班</span>${t24c('qkS', defS)}<span>下班</span>${t24c('qkE', defE)}
      <span>休(分)</span><input id="qkB" type="number" value="${defB}" min="0" max="240" style="border:1px solid var(--line);border-radius:8px;padding:7px;font-size:15px;width:62px">
      <span>🎓帶訓</span><select id="qkTr" onchange="qkTrChange(this.value)" style="border:1px solid var(--line);border-radius:8px;padding:7px;font-size:14px">${trOpts(d, pos, '')}</select>
    </div>
    <div class="hint" style="margin-bottom:6px">點名字＝直接排進去；名字旁數字＝<b>排過這崗位幾次</b>（照次數排序）；「新」＝沒排過建議搭帶訓；✓＝當天已有班可兼第二崗</div>
    ${(()=>{ // v4.9.0 熟練度（張良）：次數徽章+照次數大到小排；0次標「新」；被帶訓另標🎓n
      const PS = d.posStats || {}
      const cntOf = n => (PS[n]||{})[pos] || 0
      const trOf = n => (PS[n]||{})['🎓'+pos] || 0
      const btn = n => { const c2 = cntOf(n), t2 = trOf(n)
        return `<button class="mini" style="padding:9px 13px;font-size:15px" onclick="shiftQuickGo('${n}','${pos}','${dt}')">${n} ${c2?`<b style="color:var(--pdark)">${c2}</b>`:'<span style="color:#E8A657;font-weight:800;font-size:12px">新</span>'}${t2?` <span style="font-size:12px" title="被帶訓${t2}次">🎓${t2}</span>`:''}${busy.has(n)?' <span style="color:var(--green);font-weight:800">✓</span>':''}</button>` }
      const bySkill = (a,b) => cntOf(b)-cntOf(a) || trOf(b)-trOf(a)
      const regQ = (d.staff||[]).filter(s2=>!s2.off).map(s2=>s2.n).sort(bySkill)
      const offQ = (d.staff||[]).filter(s2=>s2.off).map(s2=>s2.n).sort(bySkill)
      if (!regQ.length && !offQ.length) return `<div style="display:flex;gap:6px;flex-wrap:wrap">${(d.names||[]).map(btn).join('')||'<span class="mut">GD 人員是空的——先在上面「＋ 加人」</span>'}</div>`
      return `<div style="display:flex;gap:6px;flex-wrap:wrap">${regQ.map(btn).join('')}</div>` + (offQ.length?`<div class="hint" style="border-top:1.5px dashed var(--line);margin:10px 0 6px;padding-top:6px;font-weight:700">非常態</div><div style="display:flex;gap:6px;flex-wrap:wrap">${offQ.map(btn).join('')}</div>`:'')
    })()}
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="mini on" style="padding:9px 16px" onclick="document.getElementById('qkOv').remove()">完成</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
  // v4.9.1 連排（張良「時間功能變有用」）：排完不關窗——保留剛選的時段/帶訓，一格分段班連續排
  if (!window._qkKeep) window._qkLast = null // 新開窗＝沒有「剛排的那筆」
  const kp = window._qkKeep
  if (kp) { window._qkKeep = null
    t24set('qkS', kp.s); t24set('qkE', kp.e)
    const qb = document.getElementById('qkB'); if (qb) qb.value = kp.b
    const qt = document.getElementById('qkTr'); if (qt && kp.tr) qt.value = kp.tr
    const mg = document.getElementById('qkMsg'); if (mg) { mg.textContent = kp.msg; mg.style.display = 'block'; mg.style.color = 'var(--green)' }
  }
}
// 帶訓下拉共用選項（v4.9.8 張良：非常態放最下面用 optgroup 區隔）：常態照排序→「── 非常態 ──」群組
function trOpts(d, pos, sel){
  const cnt9 = n => pos ? (((d.posStats||{})[n]||{})[pos]||0) : 0
  const opt = n => `<option value="${n}"${sel===n?' selected':''}>${n}${pos?`｜${cnt9(n)?cnt9(n)+'次':'新'}`:''}</option>`
  const reg = (d.staff||[]).filter(s2=>!s2.off).map(s2=>s2.n)
  const off = (d.staff||[]).filter(s2=>s2.off).map(s2=>s2.n)
  if (!reg.length && !off.length) return `<option value="">無</option>` + (d.names||[]).map(opt).join('')
  return `<option value="">無</option>${reg.map(opt).join('')}${off.length?`<optgroup label="── 非常態 ──">${off.map(opt).join('')}</optgroup>`:''}`
}
// v4.9.6（張良「選了帶訓沒出現」）：先點人、後選帶訓＝直接補到剛排的那筆（原本只對之後點的人生效）
function qkTrChange(v){
  const t2 = window._qkLast
  if (!t2) return // 還沒點人：照舊，等點名字時一起帶上
  if (v && v === t2.name) { alert('不能自己帶自己'); return }
  if (v) t2.tr = v; else delete t2.tr
  shiftRender()
  const mg = document.getElementById('qkMsg'); if (mg) { mg.textContent = v ? `✔ 已幫 ${t2.name} 補上帶訓 ${v}` : `已移除 ${t2.name} 的帶訓`; mg.style.display = 'block' }
  if (!String(t2.id).startsWith('tmp')) shQueue(async ()=>{ const d2 = await shPost({ op:'save', item: { ...t2 }, token: TK() }); if (!(d2&&d2.ok)) alert('帶訓更新失敗') })
  // 還是 tmp＝原本排隊那筆會帶最終狀態寫入，不用再送
}
async function shiftQuickGo(name, pos, dt){
  const ovQ = document.getElementById('qkOv')
  // v4.10.1（張良）：同一格同一人擋重複
  if ((window._shiftD.sched||[]).some(x=>x.name===name && x.date===dt && (x.pos||'未分崗')===pos)) {
    const mg = document.getElementById('qkMsg'); if (mg) { mg.textContent = `⚠️ ${name} 已經在這格了，沒有重複加`; mg.style.display = 'block'; mg.style.color = 'var(--red)' }
    return
  }
  const item = { name, date: dt, start: t24read(ovQ,'qkS'), end: t24read(ovQ,'qkE'), break: +((document.getElementById('qkB')||{}).value||0), pos, tr: (document.getElementById('qkTr')||{}).value||'' }
  if (item.tr === name) item.tr = ''
  if (ovQ) ovQ.remove()
  // 樂觀更新＋排隊存檔（v4.4.7）：卡片馬上出現、存檔一筆一筆送不互蓋
  const d = window._shiftD, tmp = { ...item, id: 'tmp' + Math.random().toString(36).slice(2) }
  window._shiftTmpQ.push(tmp)
  d.sched.push(tmp); shiftRender()
  // v4.9.1 連排：重開快選窗（✓即時更新），時段/休息/帶訓都保留
  window._qkLast = tmp // v4.9.6：剛排的這筆——之後才選帶訓也能直接補上
  window._qkKeep = { s: item.start, e: item.end, b: item.break, tr: item.tr, msg: `✔ 已排 ${name}（${item.start}–${item.end}）——可以繼續點下一位，或按「完成」` }
  shiftQuick(pos, dt)
  shQueue(async ()=>{
    if (tmp._del) { window._shiftTmpQ = window._shiftTmpQ.filter(x=>x!==tmp); return } // 排隊中被刪＝不送
    const send = { ...tmp }; delete send.id; delete send._del // 送出前抄 tmp 現狀——排隊期間被拖曳/編輯過也算數
    const d2 = await shPost({ op:'save', item: send, token: TK() })
    window._shiftTmpQ = window._shiftTmpQ.filter(x=>x!==tmp)
    if (d2 && d2.ok) { if (d2.id) tmp.id = d2.id } // 暫存卡換正式id——之後編輯/刪除對得上（v4.4.8 分身治本）
    else { const dd = window._shiftD; dd.sched = dd.sched.filter(x=>x!==tmp); shiftRender(); alert((d2&&d2.error)||'儲存失敗：'+item.name) }
  })
}
async function shiftDrop(ev, pos, dt){
  ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.style.outline = ''
  const id = ev.dataTransfer.getData('text/plain'); if (!id) return
  if (id.startsWith('u|')) { // v4.6.3（張良）：未排名片拖進格子＝直接排班（時間帶同崗位最近一筆）
    const nm = id.slice(2), d0 = window._shiftD
    if (d0.sched.some(x=>x.date===dt && (x.pos||'未分崗')===pos && x.name===nm)) return
    const byNew = (a,b)=>b.date.localeCompare(a.date)
    const last = [...d0.sched].filter(x=>(x.pos||'未分崗')===pos).sort(byNew)[0] || [...d0.sched].sort(byNew)[0]
    const tmp = { name: nm, date: dt, start: last?last.start:'11:00', end: last?last.end:'20:00', break: last?(last.break==null?60:last.break):60, pos: (pos==='未分崗'?'':pos), id: 'tmp' + Math.random().toString(36).slice(2) }
    queueSaveTmp(tmp); shiftRender(); return
  }
  const d = window._shiftD; let it = d.sched.find(x=>x.id===id)
  if (!it) { it = shMergedSched().find(x=>x.id===id); if (it) d.sched.push(it) } // v4.28.6 舊月的卡也拖得動
  if (!it) return
  if (it.date === dt && (it.pos||'未分崗') === pos) return
  it.date = dt; it.pos = (pos==='未分崗'?'':pos); shiftRender() // 先畫再存（樂觀更新）
  if (String(id).startsWith('tmp')) return // 還在排隊的卡只改畫面，真正寫入由隊伍那筆帶 pos/date
  shQueue(async ()=>{ const d2 = await shPost({ op:'save', item: it, token: TK() }); if (!(d2&&d2.ok)) alert((d2&&d2.error)||'移動失敗') })
}
// ── 品項明細 v2（張良 2026-09-22：①全部/各分類/依品類分組切換 ②30日均/vs近60/累計點欄頭排序（分組模式=組內排）
//    ③累積金額取消→售價（手填牌價優先、無則30日金額÷份數湊5倍數）④%佔比獨立欄放30日均左邊 ⑤🙈隱藏管理＝App 同一份 pm_pos_hidden 全裝置同步）──
let itmView = 'group', itmSort = { c:'avg30', d:-1 }, itmMng = false
function itmSetView(v){ itmView = v; itemsRender() }
function itmSetSort(c){ itmSort = (itmSort.c===c) ? { c, d:-itmSort.d } : { c, d:-1 }; itemsRender() }
function itmMngTog(){ itmMng = !itmMng; itemsRender() }
async function posHide(kEnc, hide){
  if (!TK()) { alert('要先綁定才能改隱藏：跟 DD 說「綁定GD」'); return }
  const r = await fetch('/api/mail-sync?poshide=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ store: (window._bd||{}).store, key: decodeURIComponent(kEnc), hide, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) load(curStore, true); else alert((d&&d.error)||'失敗')
}
function itemsRender(){
  const d = window._bd, el = document.getElementById('itemsec')
  if (!d || !el || !d.cats) return
  const dts = d.dates.map(s=>s.slice(5))
  const growCell = gr => gr==null?'<span class="mut">—</span>':gr==='新'?'<span class="up">新</span>':`<span class="${gr>=0?'up':'dn'}">${gr>=0?'+':''}${gr}%</span>`
  const qCells = q => [...q].reverse().map(v=>'<td>'+(v||0)+'</td>').join('')
  d.cats.forEach(c=>c.items.forEach(o=>{ o.cat = c.name }))
  const sv = o => itmSort.c==='grow' ? (o.grow==='新'?9e9:(o.grow==null||typeof o.grow!=='number'?-9e9:o.grow)) : (o[itmSort.c]!=null?o[itmSort.c]:-9e9)
  const srt = list => [...list].sort((a,b)=>(sv(a)-sv(b))*itmSort.d)
  const catNames = d.cats.map(c=>c.name)
  const totalAmt = d.cats.reduce((t2,c)=>t2+(c.amt30||0),0)
  const hid = d.hidden || []
  const chip = (lb,v) => `<button class="mini${itmView===v?' on':''}" style="padding:5px 12px" onclick="itmSetView('${v}')">${lb}</button>`
  // 依品類分組／全部＝相連切換膠囊（張良 2026-09-22 指定「兩個匡一起做切換的感覺」）
  const seg = (lb,v) => `<button style="border:none;padding:6px 14px;font-size:14px;font-weight:800;cursor:pointer;${itmView===v?'background:var(--primary);color:#fff':'background:var(--card);color:var(--primary)'}" onclick="itmSetView('${v}')">${lb}</button>`
  let s = `<section><h2>品項明細 <span class="hint">30日均＝近30天每營業日平均份數；名字旁 $＝售價（老闆手填優先）；%＝30天金額佔比；點欄頭排序</span></h2>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
    <span style="display:inline-flex;border:1.5px solid var(--primary);border-radius:9px;overflow:hidden">${seg('依品類分組','group')}${seg('全部','all')}</span>${catNames.map(cn=>chip(cn,cn)).join('')}
    <button class="mini${itmMng?' on':''}" style="padding:5px 12px;margin-left:auto" onclick="itmMngTog()">🙈 隱藏管理${hid.length?`（${hid.length}）`:''}</button>
  </div>`
  const arrow = c => itmSort.c===c ? (itmSort.d===-1?' ▼':' ▲') : ''
  const flat = itmView !== 'group'
  const th3 = `<th style="cursor:pointer;white-space:nowrap" onclick="itmSetSort('avg30')">30日均${arrow('avg30')}</th><th style="cursor:pointer;white-space:nowrap" onclick="itmSetSort('grow')">vs近60${arrow('grow')}</th><th style="cursor:pointer;white-space:nowrap" onclick="itmSetSort('cum30')">30天累計${arrow('cum30')}</th>`
  const nCols = 2 + (flat?1:0) + 3 + dts.length // 品項+(品類)+%+三欄+日
  s += `<div class="scroll" style="max-height:70vh;overflow-y:auto"><table><thead><tr><th style="position:sticky;left:0;background:var(--soft);z-index:2;text-align:left">品項</th>${flat?'<th>品類</th>':''}<th>%</th>${th3}${dts.map(t2=>'<th>'+t2+'</th>').reverse().join('')}</tr></thead><tbody>`
  const nameCell = (o,bg) => `<td class="iname" style="position:sticky;left:0;background:${bg};z-index:1${o.hid?';opacity:.5':''}" title="${o.n}">${o.n}${o.price?` <span style="font-size:11.5px;color:var(--muted);font-weight:600">$${o.price}</span>`:''}${itmMng?` <button class="mini" style="padding:1px 7px" onclick="posHide('${encodeURIComponent(o.k)}',${o.hid?0:1})">${o.hid?'恢復':'隱藏'}</button>`:''}</td>`
  const itemRow = o => `<tr style="${o.hid?'opacity:.6':''}">${nameCell(o,o.hid?'#1E242D':'var(--card)')}${flat?`<td><span style="font-size:11.5px;border:1px solid var(--line);border-radius:8px;padding:1px 7px;white-space:nowrap">${o.cat||''}</span></td>`:''}<td class="mut">${o.pct!=null?o.pct+'%':'—'}</td><td class="avg">${o.avg30!=null?o.avg30:'—'}</td><td>${growCell(o.grow)}</td><td>${o.cum30!=null?o.cum30:'—'}</td>${o.q?qCells(o.q):`<td colspan="${dts.length}"></td>`}</tr>`
  const hidRow = o => itemRow({ ...o, hid:1, pct:null, avg30:null, grow:null, q:null })
  if (!flat) {
    d.cats.forEach(c=>{
      const a = c.agg || {}
      const cPct = totalAmt && c.amt30!=null ? Math.round(c.amt30/totalAmt*1000)/10 : null
      s += `<tr class="catband"><td style="position:sticky;left:0;background:var(--psoft);z-index:1">${c.name}${c.amt30?` <span style="font-weight:700;font-size:13px">${fmt(c.amt30)}</span>`:''}</td><td style="font-weight:800">${cPct!=null?cPct+'%':''}</td><td style="font-weight:900">${a.avg30!=null?a.avg30:''}</td><td>${a.grow!=null?growCell(a.grow):''}</td><td style="font-weight:900">${a.cum30!=null?a.cum30:''}</td>${a.q?qCells(a.q):`<td colspan="${dts.length}"></td>`}</tr>`
      ;(c.subs||[]).forEach(sb=>{
        s += `<tr class="subrow"><td style="position:sticky;left:0;background:#2A2415;z-index:1;font-weight:700;color:#8a5a2e;white-space:pre">${sb.n}</td><td></td><td style="font-weight:800;color:#8a5a2e">${sb.avg30!=null?sb.avg30:'—'}</td><td>${growCell(sb.grow)}</td><td style="font-weight:800;color:#8a5a2e">${sb.cum30}</td>${qCells(sb.q)}</tr>`
      })
      srt(c.items).forEach(o=>{ s += itemRow(o) })
      if (itmMng) hid.filter(o2=>o2.cat===c.name).forEach(o2=>{ s += hidRow(o2) })
    })
    if (itmMng) { const orph = hid.filter(o2=>!catNames.includes(o2.cat)); if (orph.length){ s += `<tr class="catband"><td style="position:sticky;left:0;background:var(--psoft);z-index:1">已隱藏（其他）</td><td colspan="${nCols-1}"></td></tr>`; orph.forEach(o2=>{ s += hidRow(o2) }) } }
  } else {
    let rows = d.cats.flatMap(c=>c.items)
    if (itmView !== 'all') rows = rows.filter(o=>o.cat===itmView)
    srt(rows).forEach(o=>{ s += itemRow(o) })
    if (itmMng) hid.filter(o2=>itmView==='all'||o2.cat===itmView).forEach(o2=>{ s += hidRow(o2) })
    if (!rows.length) s += `<tr><td colspan="${nCols}" class="mut" style="text-align:center">這一類沒有資料</td></tr>`
  }
  s += `</tbody></table></div>${itmMng?`<div class="hint" style="margin-top:6px">🙈 隱藏＝已下架品項：不進 30 日均/累計/備料/預做的統計，跟主 App 的隱藏是同一份設定、會同步。</div>`:''}</section>`
  el.innerHTML = s
}
// ── ＋新增任務／👤指派負責人（張良 2026-09-22：比照任務中心——類別(可新)/負責人/時間；步驟清單建卡後「＋加步驟」）──
function taskNew(preSt){
  const d = window._lbD
  const cats = [...new Set([...(d.issues||[]).map(x=>x.st).filter(Boolean), ...(preSt?[preSt]:[])])]
  const ov = document.createElement('div'); ov.id='tkOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  const ip = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;font-family:inherit;margin-bottom:6px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:440px;width:100%;padding:16px;max-height:86vh;overflow:auto" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">🛠 新增任務</div>
    <textarea id="tkTxt" rows="2" placeholder="任務標題／要做什麼" style="${ip}"></textarea>
    <div class="hint">類別</div>
    <select id="tkCat" style="${ip}" onchange="document.getElementById('tkCatNew').style.display=this.value==='__new'?'block':'none'">${cats.map(c=>`<option${preSt===c?' selected':''}>${c}</option>`).join('')}<option value="__new">＋ 新類別…</option></select>
    <input id="tkCatNew" placeholder="新類別名稱" style="${ip};display:${cats.length?'none':'block'}">
    <div class="hint">負責人（可先不指定，之後認領或👤指派）</div>
    <select id="tkOwn" style="${ip}"><option value="">— 不指定 —</option>${(d.names||[]).map(n=>`<option>${n}</option>`).join('')}</select>
    <div class="hint">排定時間（可空）</div>
    <input id="tkDue" type="date" style="${ip}">
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('tkOv').remove()">取消</button>
    <button class="mini on" style="padding:9px 18px" onclick="taskNewSend()">建立</button></div>
    <div class="hint" style="margin-top:6px">建立後在卡片上「＋ 加步驟」可以做 checklist（打勾記名）。</div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function taskNewSend(){
  const g2 = x => (document.getElementById(x)||{}).value||''
  let st = g2('tkCat'); if (st==='__new' || !st) st = g2('tkCatNew').trim()
  const val = { text: g2('tkTxt').trim(), st: st||'一般', owner: g2('tkOwn'), due: g2('tkDue') }
  if (!val.text) { alert('任務要寫標題'); return }
  const r = await fetch('/api/mail-sync?sopissue=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'new', val, token: TK() }) })
  const d = await r.json().catch(()=>null)
  const o = document.getElementById('tkOv'); if (o) o.remove()
  if (d && d.ok) { await lbFetch(); taskRender() } else alert((d&&d.error)||'建立失敗')
}
function taskOwn(id){
  const d = window._lbD
  const x = (d.issues||[]).find(i=>i.id===id)
  const ov = document.createElement('div'); ov.id='ownOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:380px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">👤 指派負責人</div>
    <select id="ownSel" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:10px"><option value="">— 清除負責人 —</option>${(d.names||[]).map(n=>`<option${x&&x.claimBy===n?' selected':''}>${n}</option>`).join('')}</select>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('ownOv').remove()">取消</button>
    <button class="mini on" style="padding:9px 18px" onclick="taskOwnSend('${id}')">確定</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function taskOwnSend(id){
  const v = (document.getElementById('ownSel')||{}).value||''
  const o = document.getElementById('ownOv'); if (o) o.remove()
  lbOp(id, 'own', v)
}
// ── 💬 每日回饋（張良 2026-09-22：每天對有上班的人文字回饋＋評分1~5星拉桿；一人一天對一人一則、可改）──
let fbDate = null
function fbNav(n){ const t2 = new Date(fbDate); t2.setDate(t2.getDate()+n); fbLoad(t2.toISOString().slice(0,10)) }
