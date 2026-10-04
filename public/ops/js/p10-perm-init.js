// ⚠️ 這是 /prep 主程式的第 10/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：權限+預測+錯誤偵測+啟動init
// ── 📝 每日回饋紀錄（張良 2026-09-22）：站別＋文字＋照片/影片（sopsign 直傳）──
let fbjFiles = []
function fbjNew(){
  fbjFiles = []
  const d = window._fbD
  const ov = document.createElement('div'); ov.id='fbjOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  const ip = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;font-family:inherit;margin-bottom:6px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:440px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">📝 每日回饋（${d.date.slice(5)}）</div>
    <select id="fbjSt" style="${ip}"><option value="">— 選站別（可空）—</option>${(d.stations||[]).map(s2=>`<option>${s2}</option>`).join('')}<option>其他</option></select>
    <textarea id="fbjTxt" rows="4" placeholder="今天發現什麼問題／可以更好的地方？" style="${ip}"></textarea>
    <div id="fbjList" class="hint" style="margin:4px 0"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:6px">
      <button class="mini" style="padding:9px 12px" onclick="fbjPick()">📷 照片/影片</button>
      <span><button class="mini" style="padding:9px 12px" onclick="document.getElementById('fbjOv').remove()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="fbjSend()">送出</button></span>
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function fbjPick(){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*,video/*'; inp.multiple=true
  inp.onchange = () => { fbjFiles = [...fbjFiles, ...inp.files].slice(0,6); const el=document.getElementById('fbjList'); if(el) el.innerHTML = fbjFiles.map((f,i)=>`📎 ${(f.name||'檔'+(i+1)).slice(0,28)}`).join('<br>') }
  inp.click()
}
async function fbjSend(){
  const st = (document.getElementById('fbjSt')||{}).value||''
  const text = (document.getElementById('fbjTxt')||{}).value||''
  if (!text.trim() && !fbjFiles.length) { alert('寫點文字或附照片/影片'); return }
  document.querySelectorAll('#fbjOv button').forEach(b=>b.disabled=true)
  const media = []
  for (const f of fbjFiles) {
    try {
      const ext = ((f.name||'').split('.').pop()||'jpg').toLowerCase()
      const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ext }) })
      const sd = await sr.json()
      if (sd && sd.ok) { const ur = await fetch(sd.uploadUrl, { method:'PUT', headers:{'content-type': f.type||'application/octet-stream'}, body: f }); if (ur.ok) media.push(sd.publicUrl) }
    } catch(e){}
  }
  const r = await fetch('/api/mail-sync?fbj=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'add', date: window._fbD.date, st, text, media, token: TK() }) })
  const dd = await r.json().catch(()=>null)
  const o = document.getElementById('fbjOv'); if (o) o.remove()
  if (dd && dd.ok) fbLoad(window._fbD.date); else alert((dd&&dd.error)||'送出失敗')
}
async function fbjDel(id){
  const r = await fetch('/api/mail-sync?fbj=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'del', id, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) fbLoad(window._fbD.date); else alert((d&&d.error)||'失敗')
}
// ── 👥 GD 人員直編＋⚙️ 崗位清單（張良 2026-09-24：班表頁直接管理，跟主 App 名冊 GD 標記同一份）──
async function gdStaffOp(op, name){
  if (op==='del' && !confirm(`把 ${name} 移出 GD 人員？（排班/任務/回饋選單就不會出現他；名冊本體不動）`)) return
  const r = await fetch('/api/mail-sync?gdstaff=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op, name, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) shiftLoad(); else alert((d&&d.error)||'失敗')
}
function gdStaffAdd(){
  const d = window._shiftD
  const pool = (d.namesAll||[]).filter(n=>!(d.names||[]).includes(n))
  if (!pool.length) { alert('名冊在職的人都已經在 GD 人員裡了；新人先到主 App 名冊建檔'); return }
  const ov = document.createElement('div'); ov.id='gsOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:360px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">＋ 加入 GD 人員</div>
    <select id="gsSel" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:10px">${pool.map(n=>`<option>${n}</option>`).join('')}</select>
    <div class="hint" style="margin-bottom:8px">名單來自主 App 名冊在職夥伴；加入後排班/任務/回饋選單都會出現。</div>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('gsOv').remove()">取消</button>
    <button class="mini on" style="padding:9px 18px" onclick="gdStaffGo()">加入</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function gdStaffGo(){
  const v = (document.getElementById('gsSel')||{}).value||''
  const o = document.getElementById('gsOv'); if (o) o.remove()
  if (v) gdStaffOp('add', v)
}
function shiftPosEdit(){ // v4.3.2（張良 2026-10-02「這樣很難弄」）：prompt 換正式視窗——一崗位一列、直接改名、✕刪、＋新增、↑↓排序
  const d = window._shiftD
  window._posTmp = (d.posList && d.posList.length) ? d.posList.slice() : ['炸台','吧檯','外場','廚房']
  const ov = document.createElement('div'); ov.id='psOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  // v4.5.2（張良「視窗大一點自適應」+「人員給我可以排序」）：寬螢幕三欄並排、窄螢幕自動疊；新增人員排序區（順序=專屬色+快選排列）
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;width:min(900px,94vw);padding:18px;max-height:90vh;overflow:auto" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px;margin-bottom:10px">⚙️ 班表設定</div>
    ${(d.me&&(d.me.approver||d.me.role==='主管'))?`<label style="display:flex;gap:8px;align-items:center;margin:-4px 0 12px;font-weight:700;cursor:pointer"><input type="checkbox" id="psLock" ${d.lockEdit?'checked':''} style="width:17px;height:17px"> 🔒 鎖定班表——只有審核人／主管能編輯</label>`:''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px">
      <div>
        <div style="font-weight:900;margin-bottom:2px">📋 崗位清單</div>
        <div class="hint" style="margin-bottom:6px">排班選單用這份；改名、✕ 刪、↑↓ 排。</div>
        <div id="psRows"></div>
        <button class="mini" style="margin-top:8px;padding:8px 12px" onclick="window._posTmp.push('');posRender();setTimeout(()=>{const ii=document.querySelectorAll('#psRows input');if(ii.length)ii[ii.length-1].focus()},50)">＋ 新增崗位</button>
      </div>
      <div>
        <div style="font-weight:900;margin-bottom:2px">⏱ 時段快捷</div>
        <div class="hint" style="margin-bottom:6px">排班快選窗的一鍵時段（照尖峰自訂）。</div>
        <div id="slRows"></div>
        <button class="mini" style="margin-top:8px;padding:8px 12px" onclick="window._slotTmp.push({n:'',s:'11:00',e:'20:00'});slRender()">＋ 新增時段</button>
      </div>
      <div>
        <div style="font-weight:900;margin-bottom:2px">👥 人員排序＆顏色</div>
        <div class="hint" style="margin-bottom:6px">↑↓ 調快選排列；點色塊幫每個人選專屬色。</div>
        <div id="odRows"></div>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="mini" style="padding:9px 12px" onclick="document.getElementById('psOv').remove()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="posSave()">儲存</button></div></div>`
  ov.onclick = () => ov.remove()
  window._slotTmp = ((d.slots && d.slots.length) ? d.slots : SLOT_DEF).map(x=>({n:x.n,s:x.s,e:x.e}))
  window._ordTmp = (d.staff||[]).map(s2=>s2.n)
  window._colTmp = { ...(d.colors||{}) }
  window._colOpen = null
  window._offTmp = new Set((d.staff||[]).filter(s2=>s2.off).map(s2=>s2.n))
  document.body.appendChild(ov)
  posRender(); slRender(); odRender()
}
// v4.7.0 寶石色系（張良 2026-10-02 定稿規格）：飽和+明度壓低、實色填滿+白字；繽紛靠色相拉開、質感靠「深」
const _PAL = ()=>[ // v4.8.0 深色主題→寶石色原版（黑灰底上正好發亮）
  {n:'寶石紅',g:'紅系',bg:'#B23A48',tx:'#FFFFFF'},
  {n:'珊瑚紅',g:'紅系',bg:'#D9634C',tx:'#FFFFFF'},
  {n:'莓果紅',g:'紅系',bg:'#B83A72',tx:'#FFFFFF'},
  {n:'琥珀橘',g:'橘黃系',bg:'#D9822B',tx:'#FFFFFF'},
  {n:'赭金',g:'橘黃系',bg:'#D4A72C',tx:'#2B2000'},
  {n:'萊姆綠',g:'綠系',bg:'#8DA33B',tx:'#1E2608'},
  {n:'翡翠綠',g:'綠系',bg:'#2E8B57',tx:'#FFFFFF'},
  {n:'松綠',g:'綠系',bg:'#1F6E5A',tx:'#FFFFFF'},
  {n:'孔雀藍',g:'青藍系',bg:'#138A8A',tx:'#FFFFFF'},
  {n:'湖水藍',g:'青藍系',bg:'#2A9DB5',tx:'#FFFFFF'},
  {n:'鈷藍',g:'青藍系',bg:'#2F5FB3',tx:'#FFFFFF'},
  {n:'海軍藍',g:'青藍系',bg:'#23395D',tx:'#FFFFFF'},
  {n:'靛紫',g:'紫系',bg:'#5B4BA8',tx:'#FFFFFF'},
  {n:'葡萄紫',g:'紫系',bg:'#7B3F8C',tx:'#FFFFFF'},
  {n:'可可棕',g:'中性系',bg:'#6B4A3A',tx:'#FFFFFF'},
  {n:'石墨',g:'中性系',bg:'#3A3F47',tx:'#FFFFFF'},
  // v4.8.4 擴充（張良「更多顏色 深到淺 亮到暗 黑到白」）：id 16起追加，既有16色編號不動
  {n:'酒紅',g:'紅系',bg:'#7A2230',tx:'#FFFFFF'},
  {n:'亮紅',g:'紅系',bg:'#E34B5F',tx:'#FFFFFF'},
  {n:'玫瑰粉',g:'紅系',bg:'#E98FA4',tx:'#47101E'},
  {n:'淺粉',g:'紅系',bg:'#EDB8CA',tx:'#47101E'},
  {n:'深焦糖',g:'橘黃系',bg:'#9A5A14',tx:'#FFFFFF'},
  {n:'亮橘',g:'橘黃系',bg:'#F2A541',tx:'#3A2503'},
  {n:'淺杏',g:'橘黃系',bg:'#F2CE94',tx:'#3A2503'},
  {n:'檸檬黃',g:'橘黃系',bg:'#E8D44D',tx:'#2E2804'},
  {n:'墨綠',g:'綠系',bg:'#123B2E',tx:'#9FD6BC'},
  {n:'亮綠',g:'綠系',bg:'#4CAF6D',tx:'#07230F'},
  {n:'青瓷',g:'綠系',bg:'#7FBFA0',tx:'#11302A'},
  {n:'淺抹茶',g:'綠系',bg:'#BBD6A2',tx:'#263A12'},
  {n:'午夜藍',g:'青藍系',bg:'#152A4A',tx:'#A9C7F0'},
  {n:'亮天藍',g:'青藍系',bg:'#3BA7DD',tx:'#07243A'},
  {n:'冰藍',g:'青藍系',bg:'#8FC3E0',tx:'#0C2436'},
  {n:'淺粉藍',g:'青藍系',bg:'#C0D8EA',tx:'#132A3E'},
  {n:'深茄紫',g:'紫系',bg:'#43275B',tx:'#D9C6F2'},
  {n:'亮紫羅蘭',g:'紫系',bg:'#8B6CD9',tx:'#FFFFFF'},
  {n:'薰衣草',g:'紫系',bg:'#B9A7E0',tx:'#241744'},
  {n:'淺藕紫',g:'紫系',bg:'#D8C9E8',tx:'#30204A'},
  {n:'純黑',g:'中性系',bg:'#0B0D11',tx:'#E8ECF2'},
  {n:'深灰',g:'中性系',bg:'#23272E',tx:'#C9D1DC'},
  {n:'中灰',g:'中性系',bg:'#6B7280',tx:'#FFFFFF'},
  {n:'淺灰',g:'中性系',bg:'#B5BCC6',tx:'#1A1E24'},
  {n:'純白',g:'中性系',bg:'#F5F7FA',tx:'#14181E'},
]
const _PBX = ()=>_PAL().map(x=>x.bg) // 實色底
const _PTX = ()=>_PAL().map(x=>x.tx) // 文字色
function odRender(){
  const box = document.getElementById('odRows'); if (!box) return
  const B = _PBX()
  const regs = window._ordTmp.filter(n=>!window._offTmp.has(n))
  const offs = window._ordTmp.filter(n=>window._offTmp.has(n))
  window._ordTmp = regs.concat(offs) // 非常態永遠沉底
  const PALX = _PAL()
  const row = (n, gi, glen) => {
    const i = window._ordTmp.indexOf(n)
    const ci = window._colTmp[n] != null ? window._colTmp[n] % B.length : i % B.length
    const off = window._offTmp.has(n)
    const sw = `<button title="點我換色" style="width:30px;height:24px;border-radius:6px;border:none;background:${B[ci]};cursor:pointer" onclick="window._colOpen=window._colOpen==='${n}'?null:'${n}';odRender()"></button>`
    let pal = ''
    if (window._colOpen === n) { // v4.8.4：同色系跨段落歸同組（深→亮→淺一排）；選中=白圈+色框；被別人用=角落白點
      const grps = []
      PALX.forEach((c2, ci2)=>{ let g2 = grps.find(x=>x.g===c2.g); if (!g2) { g2 = { g: c2.g, items: [] }; grps.push(g2) } g2.items.push([c2, ci2]) })
      pal = '<div style="padding:6px 0 4px">' + grps.map(g2=>`<div class="hint" style="font-weight:800;margin:5px 0 3px">${g2.g}</div><div style="display:flex;gap:6px;flex-wrap:wrap">` + g2.items.map(([c2, ci2])=>{
        const used = Object.entries(window._colTmp).some(([k2,v2])=>k2!==n && (v2%B.length)===ci2)
        return `<button title="${c2.n}${used?'（有人在用）':''}" style="width:32px;height:26px;border-radius:6px;border:none;background:${c2.bg};cursor:pointer;position:relative;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)${ci2===ci?`,0 0 0 2px #fff,0 0 0 4px ${c2.bg}`:''}" onclick="window._colTmp['${n}']=${ci2};window._colOpen=null;odRender()">${used?'<span style="position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:#fff;opacity:.95"></span>':''}</button>`
      }).join('') + '</div>').join('') + '</div>'
    }
    return `<div style="border-bottom:1px solid var(--line)"><div style="display:flex;gap:6px;align-items:center;padding:4px 0">
      <span style="flex:1;font-weight:800;color:${off?'#9CA3AF':B[ci]};${off?'text-decoration:line-through;':''}">${n}</span>${sw}
      <button class="mini" title="${off?'恢復常態排班':'標為非常態（沉底＋排班選單沉底＋不列未排）'}" style="padding:7px 9px;${off?'':'color:var(--red)'}" onclick="odOff('${n}')">${off?'↺':'✕'}</button>
      <button class="mini" style="padding:7px 9px" ${gi===0?'disabled':''} onclick="odMove('${n}',-1)">↑</button>
      <button class="mini" style="padding:7px 9px" ${gi===glen-1?'disabled':''} onclick="odMove('${n}',1)">↓</button></div>${pal}</div>`
  }
  box.innerHTML = regs.map((n,gi)=>row(n,gi,regs.length)).join('')
    + (offs.length ? `<div class="hint" style="border-top:2px dashed var(--line);margin-top:8px;padding:5px 0 2px;font-weight:800">✕ 非常態（不進快選主選單、不列未排）</div>` + offs.map((n,gi)=>row(n,gi,offs.length)).join('') : '')
}
function odOff(n){ const S = window._offTmp; S.has(n) ? S.delete(n) : S.add(n); odRender() }
function odMove(n, dir){
  const off = window._offTmp.has(n)
  const grp = window._ordTmp.filter(x=>window._offTmp.has(x)===off)
  const oth = window._ordTmp.filter(x=>window._offTmp.has(x)!==off)
  const i = grp.indexOf(n), j = i + dir
  if (j < 0 || j >= grp.length) return
  ;[grp[i], grp[j]] = [grp[j], grp[i]]
  window._ordTmp = off ? oth.concat(grp) : grp.concat(oth)
  odRender()
}
function slRender(){
  const box = document.getElementById('slRows'); if (!box) return
  box.innerHTML = window._slotTmp.map((sl,i)=>`<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:4px 0;border-bottom:1px solid var(--line)">
    <input value="${String(sl.n).replace(/"/g,'&quot;')}" placeholder="名稱" oninput="window._slotTmp[${i}].n=this.value" style="width:56px;min-width:0;border:1px solid var(--line);border-radius:8px;padding:7px 6px;font-size:14px">
    <input type="time" value="${sl.s}" onchange="window._slotTmp[${i}].s=this.value" style="width:132px;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 4px;font-size:13px">
    <span>–</span>
    <input type="time" value="${sl.e}" onchange="window._slotTmp[${i}].e=this.value" style="width:132px;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 4px;font-size:13px">
    <button class="mini" style="padding:7px 9px;color:var(--red);margin-left:auto" onclick="window._slotTmp.splice(${i},1);slRender()">✕</button></div>`).join('')
}
function posRender(){
  const box = document.getElementById('psRows'); if (!box) return
  box.innerHTML = window._posTmp.map((p,i)=>`<div style="display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)">
    <input value="${String(p).replace(/"/g,'&quot;')}" oninput="window._posTmp[${i}]=this.value" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px">
    <button class="mini" style="padding:7px 9px" ${i===0?'disabled':''} onclick="const a=window._posTmp;[a[${i}-1],a[${i}]]=[a[${i}],a[${i}-1]];posRender()">↑</button>
    <button class="mini" style="padding:7px 9px" ${i===window._posTmp.length-1?'disabled':''} onclick="const a=window._posTmp;[a[${i}+1],a[${i}]]=[a[${i}],a[${i}+1]];posRender()">↓</button>
    <button class="mini" style="padding:7px 9px;color:var(--red)" onclick="window._posTmp.splice(${i},1);posRender()">✕</button></div>`).join('')
}
async function posSave(){
  const list = window._posTmp.map(s2=>String(s2).trim()).filter(Boolean)
  if (!list.length) { alert('至少留一個崗位'); return }
  const slots = window._slotTmp.map(x=>({n:String(x.n).trim(),s:x.s,e:x.e})).filter(x=>x.n&&x.s&&x.e)
  const o = document.getElementById('psOv'); if (o) o.remove()
  // v4.8.3 提速：畫面先套用（顏色/排序/非常態/崗位/時段立即重畫）＋設定五合一一發寫入（原本5連發排隊=5~7秒才變）
  const d = window._shiftD
  if (d) {
    d.posList = list.slice(); d.slots = slots.slice(); d.colors = { ...window._colTmp }
    const offS = window._offTmp
    d.staff = window._ordTmp.map(n=>{ const s2 = (d.staff||[]).find(x=>x.n===n) || { n, role:'一般' }; const o2 = { ...s2 }; if (offS.has(n)) o2.off = 1; else delete o2.off; return o2 })
    shiftRender()
  }
  const r = await fetch('/api/mail-sync?shiftset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'cfg', pos: list, slots, ord: window._ordTmp, colors: window._colTmp, off: [...window._offTmp], ...(document.getElementById('psLock')?{lock:document.getElementById('psLock').checked?1:0}:{}), token: TK() }) }).then(r2=>r2.json()).catch(()=>null)
  if (r && r.ok) shiftLoad(); else { alert((r&&r.error)||'儲存失敗'); shiftLoad() }
}
// ── 🎚 權限 modal（張良 2026-09-25：訪客看/綁定一般/名單設權限）──
function gdRoleModal(name, role){
  const ov = document.createElement('div'); ov.id='grOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  const opt = (v,desc) => `<label style="display:flex;gap:8px;align-items:center;padding:8px 6px;border-bottom:1px solid var(--line);cursor:pointer"><input type="radio" name="grR" value="${v}" ${role===v?'checked':''}> <b>${v}</b> <span class="hint">${desc}</span></label>`
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:380px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:800;margin-bottom:8px">${name} 的權限</div>
    ${role==='審核人'?'<div class="hint" style="margin-bottom:8px">審核人——權限最高（核准/發布/通知開關），這裡不能改。</div>':opt('一般','看＋操作（打卡/回報/任務/評分…記名）')+opt('主管','一般＋管理人員名單與權限')+opt('停權','綁定保留，但所有操作被擋')}
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:10px">
      <button class="mini" style="color:var(--red);padding:8px 12px" onclick="if(confirm('把 ${name} 移出 GD 人員名單？')){document.getElementById('grOv').remove();gdStaffOp('del','${name}')}">移出名單</button>
      <span><button class="mini" style="padding:8px 12px" onclick="document.getElementById('grOv').remove()">取消</button>
      ${role!=='審核人'?`<button class="mini on" style="padding:8px 16px" onclick="gdRoleSave('${name}')">儲存</button>`:''}</span>
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function gdRoleSave(name){
  const v = (document.querySelector('#grOv input[name=grR]:checked')||{}).value
  const o = document.getElementById('grOv'); if (o) o.remove()
  if (!v) return
  const r = await fetch('/api/mail-sync?gdrole=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name, role: v, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) shiftLoad(); else alert((d&&d.error)||'失敗')
}
// ── 📈 銷量預測驗證區 P1（張良 2026-09-25：夥伴只看備料卡一個數字——這區只有主管/審核人看得到）──
async function fcLoad(){
  const el = document.getElementById('fcsec'); if (!el || !TK()) return
  let d
  try { const r = await fetch('/api/mail-sync?fc=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK())); d = await r.json() } catch(e){}
  if (!d || !d.ok) { el.innerHTML = ''; return } // 403（非主管）靜默
  const f = d.fc
  const wdN = ['日','一','二','三','四','五','六']
  const accRow = (lb, a) => a.days ? `<tr><td>${lb}（${a.days}天）</td><td class="avg">${a.store.wapeS!=null?a.store.wapeS+'%':'—'}</td><td>${a.store.wapeF!=null?a.store.wapeF+'%':'—'}</td><td>${a.store.wapeB!=null?a.store.wapeB+'%':'—'}</td><td>${a.item.wapeS!=null?a.item.wapeS+'%':'—'}</td><td>${a.item.wapeB!=null?a.item.wapeB+'%':'—'}</td><td>${a.store.winS}勝${a.store.winB}負</td><td class="hint">新+${a.store.overS}/−${a.store.underS}｜舊+${a.store.overB}/−${a.store.underB}</td></tr>` : ''
  let h = `<section style="border:1.5px dashed var(--primary)"><details><summary style="font-weight:800;cursor:pointer;color:var(--pdark)">銷量預測（測試中）｜近28天快照 ${d.snapDays} 天 <span class="hint">只有主管/審核人看得到；夥伴照舊看備料卡</span></summary>
  <div class="hint" style="margin:8px 0">水準 ${f.level} 份/日・成長 ×${f.growth}${f.growthRate!=null?`（近7vs前7 ${f.growthRate>0?'+':''}${Math.round(f.growthRate*100)}%）`:''}・校正 ×${f.calib}（樣本 ${f.calibMeta.n} 天${f.calibMeta.R?'，R='+f.calibMeta.R:''}）・正常營業日 ${f.normalDays} 天（${f.dataFrom||''}~${f.dataTo||''}）${f.notes.length?'<br>⚠ '+f.notes.join('；'):''}</div>
  <div class="scroll"><table><thead><tr><th>日期</th><th>週幾比例</th><th>校正前</th><th>系統預測</th><th>舊法(備料卡)</th></tr></thead><tbody>
  ${f.future.map(x=>`<tr><td>${x.date.slice(5)}（${wdN[x.wd]}）</td><td>${x.ratio}</td><td class="mut">${x.preCal}</td><td class="avg">${x.sys}</td><td>${f.baseStoreByWd[x.wd]||'—'}</td></tr>`).join('')}
  </tbody></table></div>
  <details style="margin-top:8px"><summary class="hint" style="cursor:pointer;font-weight:700">明日品項預測（前 20）＋佔比</summary>
  <div class="scroll" style="margin-top:6px"><table><thead><tr><th>品項</th><th>佔比</th><th>明日預測</th><th>舊法</th><th>調</th></tr></thead><tbody>
  ${(()=>{ const fi=(f.futureItems[0]||{}).items||{}; const wd0=f.future[0]?f.future[0].wd:1
    const d0 = f.future[0]?f.future[0].date:''
    const adjD = (d.adj||{})[d0]||{}
    return f.shares.slice(0,20).map(s=>{ const a=adjD[s.k]; return `<tr><td class="iname">${s.n}</td><td>${Math.round(s.share*1000)/10}%</td><td class="avg">${fi[s.k]||0}${a?`<span style="color:#A85C26;font-weight:800"> ${a.n>0?'+':''}${a.n}</span>`:''}</td><td>${Math.round((f.baseItems[s.k]||{})[wd0]||0)}</td><td><button class="mini" style="padding:1px 8px" onclick="fcAdj('${d0}','${s.k}',${a?a.n:0},'${a?(a.why||'').replace(/'/g,''):''}')">±</button></td></tr>` }).join('') })()}
  </tbody></table></div></details>
  <details style="margin-top:8px"><summary class="hint" style="cursor:pointer;font-weight:700">準確度（新模型 vs 舊法）＋逐日</summary>
  ${d.snapDays?`<div class="scroll" style="margin-top:6px"><table><thead><tr><th>期間</th><th>全店WAPE系統</th><th>最終</th><th>舊</th><th>品項WAPE新</th><th>舊</th><th>逐日勝負</th><th>高/低估</th></tr></thead><tbody>${accRow('近7天',d.acc7)}${accRow('近28天',d.acc28)}</tbody></table></div>
  <div class="scroll" style="margin-top:6px"><table><thead><tr><th>日期</th><th>實際</th><th>新預測</th><th>舊法</th></tr></thead><tbody>${d.daily.map(x=>`<tr><td>${x.date.slice(5)}</td><td class="avg">${x.actual}</td><td style="${Math.abs(x.sys-x.actual)<=Math.abs(x.base-x.actual)?'color:var(--green);font-weight:800':''}">${x.sys}</td><td style="${Math.abs(x.base-x.actual)<Math.abs(x.sys-x.actual)?'color:var(--green);font-weight:800':''}">${x.base}</td></tr>`).join('')}</tbody></table></div>`:'<div class="mut" style="margin-top:6px">還沒有快照實績——每天 11:00 自動鎖當日預測，明天起開始累積成績單</div>'}
  </details>
  <div style="margin-top:8px;font-size:14px"><b>特殊日</b> <button class="mini" style="padding:2px 10px" onclick="fcSpecial()">＋ 標記</button>
  ${Object.entries(d.special||{}).sort((a,b)=>(a[0]<b[0]?1:-1)).slice(0,10).map(([dt,note])=>`<span style="border:1px solid #E8D089;background:#2E2814;border-radius:8px;padding:1px 8px;margin-left:4px;white-space:nowrap;display:inline-block;margin-top:3px">${dt.slice(5)} ${note} <span style="cursor:pointer;color:var(--red);font-weight:800" onclick="fcSpecialDel('${dt}')">✕</span></span>`).join('')||'<span class="hint">（包場/颱風/活動日標起來，不會污染模型）</span>'}</div>
  <details style="margin-top:8px"><summary class="hint" style="cursor:pointer;font-weight:700">中間值（星期比例／有效週）</summary>
  <div class="hint" style="margin-top:6px">星期比例：${[1,2,3,4,5].map(w=>`週${wdN[w]} ${f.ratios[w]||1}`).join('・')}<br>有效週：${f.weekMeta.map(w=>`${w.week.slice(5)}起${w.days}天${w.valid?'✓':'✗'}`).join('｜')}</div></details>
  </details></section>`
  el.innerHTML = h
}
// ── 今日賣完回報（張良 2026-09-26 P2）：收班時勾——只記「有賣完」不用時間；預測佔比/校正會用到 ──
async function soLoad(){
  const el = document.getElementById('sosec'); if (!el) return
  let d
  try { const r = await fetch('/api/mail-sync?fcso=' + encodeURIComponent(K)); d = await r.json() } catch(e){}
  if (!d || !d.ok) { el.innerHTML = ''; return }
  if (d.none) { // 公休/未到11:00：區塊照樣顯示位置＋說明（張良 2026-09-26「沒看到在哪」——藏起來反而找不到）
    el.innerHTML = `<section><div style="font-weight:800;color:var(--muted)">今日賣完回報 <span class="hint">${d.none}——營業日 11:00 後這裡會出現品項清單，收班時把賣完的勾一勾</span></div></section>`
    return
  }
  const soN = d.items.filter(x=>x.so).length
  el.innerHTML = `<section><details><summary style="font-weight:800;cursor:pointer">今日賣完回報（收班勾）${soN?`<span style="color:var(--red);font-weight:800">・已勾 ${soN} 項</span>`:''} <span class="hint">哪些品項今天賣完了？收班時勾一下——預測會把它當「需求下限」不會誤判賣不動</span></summary>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;margin-top:8px">
    ${d.items.map(x=>`<label style="display:flex;gap:7px;align-items:center;background:${x.so?'#3A2023':'var(--soft)'};border:1px solid ${x.so?'#F0B8B1':'var(--line)'};border-radius:9px;padding:7px 10px;font-size:14px;cursor:pointer"><input type="checkbox" ${x.so?'checked':''} onchange="soTog('${x.k}',this.checked)" style="width:16px;height:16px"> ${x.n}</label>`).join('')}
    </div></details></section>`
}
async function soTog(k, on){
  if (!TK()) { alert('要先登入才能勾賣完：按右上「登入」'); soLoad(); return }
  const r = await fetch('/api/mail-sync?fcso=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ k, on, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (!d || !d.ok) alert((d&&d.error)||'失敗')
  soLoad()
}
// ── 特殊日標記＋人工調整（主管/審核人；在預測驗證區操作）──
async function fcSpecial(dateDef){
  const date = prompt('特殊日日期（YYYY-MM-DD；標記後該日不參與比例/水準/校正計算）', dateDef || todayTpe())
  if (!date) return
  const note = prompt('原因（包場/颱風/停電/設備故障/活動…）', '')
  if (note == null) return
  const r = await fetch('/api/mail-sync?fcsp=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ date, note, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) fcLoad(); else alert((d&&d.error)||'失敗')
}
async function fcSpecialDel(date){
  if (!confirm(date + ' 取消特殊日標記？')) return
  const r = await fetch('/api/mail-sync?fcsp=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ date, del: 1, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) fcLoad(); else alert((d&&d.error)||'失敗')
}
async function fcAdj(date, k, n0, why0){
  const n = prompt(`人工調整 ±份數（${date}；現在 ${n0>0?'+':''}${n0||0}；0=清除）`, String(n0||''))
  if (n == null) return
  let why = ''
  if (Math.round(Number(n)||0) !== 0) { why = prompt('原因（必填——規格要求）', why0||'') || ''; if (!why.trim()) { alert('要填原因'); return } }
  const r = await fetch('/api/mail-sync?fcadj=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ date, k, n, why, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) fcLoad(); else alert((d&&d.error)||'失敗')
}
// ── 🐞 App 錯誤自動偵測 L1（張良 2026-09-26）：JS 錯誤/未攔截 Promise 自動上報（同錯誤 3 分鐘內只送一次）──
const _erSent = {}
function errReport(msg, src, stack){
  try {
    const key = String(msg).slice(0, 120)
    if (_erSent[key] && Date.now() - _erSent[key] < 180000) return
    _erSent[key] = Date.now()
    fetch('/api/mail-sync?errlog=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ msg: String(msg).slice(0,300), src: String(src||'').slice(0,120), stack: String(stack||'').slice(0,600), page: curStore || location.pathname, ver: (document.querySelector('meta[name=appver]')||{}).content || '', token: TK() }) }).catch(()=>{})
  } catch(e){}
}
window.addEventListener('error', (e) => { errReport(e.message || '未知錯誤', (e.filename||'') + ':' + (e.lineno||''), e.error && e.error.stack) })
window.addEventListener('unhandledrejection', (e) => { const r = e.reason || {}; errReport('未處理的Promise：' + (r.message || String(r)).slice(0,200), 'promise', r.stack) })
// 🐞 問題回報・功能許願（張良 2026-09-26 全員入口；09-26晚抓包「切過去明顯慢」→改 stale-first：先畫快取秒開、背景更新；技術日誌另外非同步塞進來）
function errsRender(){
  if (curStore !== 'errs') return
  document.getElementById('upd').textContent = '問題回報・功能許願'
  const d = window._lbD || {}
  const mine = (d.issues||[]).filter(x=>['App問題','功能許願'].includes(x.st))
  const badge = x => x.status==='done' ? '<span style="color:var(--green);font-weight:800">✅ 已完成</span>' : x.status==='pending' ? '<span style="color:#A85C26;font-weight:800">🕐 待審核</span>' : (x.claimBy ? `<span style="color:var(--pdark);font-weight:800">處理中（${x.claimBy}）</span>` : '<span class="hint">已收到</span>')
  app.innerHTML = `<section><h2>問題回報・功能許願 <span class="hint">用得不順、想要新功能——文字＋照片＋影片直接說明，老闆看得到</span></h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <button class="mini on" style="padding:10px 18px" onclick="sopReport('App問題')">回報使用問題</button>
    <button class="mini on" style="padding:10px 18px" onclick="sopReport('功能許願')">許願新功能</button>
  </div>
  ${mine.length ? mine.map(x=>`<div style="background:var(--card);border:1.5px solid ${x.status==='done'?'#BBE3CC':'var(--line)'};border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:14px">
    <b>${x.st==='功能許願'?'💡':'🐞'} ${x.text||'（附件）'}</b>${(x.media||[]).length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">${x.media.map(m=>/\.(mp4|mov|webm|m4v)(\?|$)/i.test(m)?`<a href="${m}" target="_blank" style="font-size:12px;border:1px solid var(--line);border-radius:8px;padding:4px 9px">🎬 影片</a>`:`<img src="${m}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer" onclick="imgView('${m}')">`).join('')}</div>`:''}
    <div class="hint">${x.by}・${x.ts}・${badge(x)}</div>
  </div>`).join('') : '<div class="mut">還沒有回報——上面兩顆按鈕隨時丟</div>'}
  </section><div id="errTech"></div>`
  errsTech() // 技術日誌（主管）非同步補進來，不擋畫面
}
async function errsView(){
  curStore = 'errs'; setTabs('errs')
  if (!window._lbD) { const c = tcGet('lb'); if (c) window._lbD = c }
  if (window._lbD) errsRender(); else app.innerHTML = '<section>載入中…</section>'
  await lbFetch()
  errsRender()
}
async function errsTech(){
  const el = document.getElementById('errTech'); if (!el || !TK()) return
  try {
    const r2 = await fetch('/api/mail-sync?errs=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK()))
    const d2 = await r2.json()
    if (!d2 || !d2.ok) return
    const el2 = document.getElementById('errTech'); if (!el2 || curStore !== 'errs') return
    el2.innerHTML = `<section><details><summary style="font-weight:800;cursor:pointer">自動偵測錯誤日誌（${d2.list.length}）<span class="hint">程式報錯自動抓；同錯當天只通知一次</span></summary>
      ${d2.list.length?d2.list.map(x=>`<div style="padding:6px 0;border-bottom:1px dashed var(--line);font-size:14px"><b style="color:var(--red)">${x.msg}</b><div class="hint">頁面 ${x.page||'?'}・v${x.ver||'?'}・${x.by}・首見 ${x.day} ${x.ts}・累計 ${x.n} 次</div></div>`).join(''):'<div class="mut" style="margin-top:6px">沒有錯誤紀錄 🎉</div>'}
      </details></section>`
  } catch(e){}
}
// 🔍 發現王明細（張良 2026-09-26）
function lbFinder(nm){
  const d = window._lbD
  const arr = (d.issues||[]).filter(x=>x.by===nm)
  const ov = document.createElement('div'); ov.id='fdOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:520px;width:100%;padding:16px;max-height:84vh;overflow:auto" onclick="event.stopPropagation()">
    <div style="font-weight:800;margin-bottom:8px">🔍 ${nm} 發現的問題（${arr.length} 件）</div>
    ${arr.map(x=>`<div style="border-bottom:1px dashed var(--line);padding:7px 0;font-size:14px">
      <b>${x.text||'（附件）'}</b> ${x.status==='done'?'<span style="color:var(--green);font-weight:800">✅</span>':x.status==='pending'?'<span style="color:#A85C26">🕐</span>':''}
      <div class="hint">${x.st||''}・${x.ts}${x.findAvg!=null?`・發現評分 ⭐${x.findAvg}`:''}${(x.media||[]).map((m,i)=>` <a href="${m}" target="_blank">📎${i+1}</a>`).join('')}</div>
    </div>`).join('')||'<div class="mut">—</div>'}
    <div style="text-align:right;margin-top:10px"><button class="mini" style="padding:8px 14px" onclick="document.getElementById('fdOv').remove()">關閉</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
// 開場：深層連結(#meet=/#sop=/#tab=)優先→重新整理留在原分頁→首頁（v4.16.0）
(function(){
  let v = null; try { v = sessionStorage.getItem('prepView') } catch(_) {}
  const R = { lb: loadLB, buy: buyLoad, meet: meetLoad, shift: shiftLoad, fb: fbLoad, menu: menuLoad, errs: errsView, sop: sopPage, settings: settingsLoad, taskx: ()=>taskEmbed(), task: ()=>taskEmbed(), food: ()=>invLoad('food'), pack: ()=>invLoad('pack'), abeach: ()=>load('abeach'), hrm: hrmLoad }
  const routeHash = () => { // v4.18.5：頁內點深層連結也要動（原本只在開頁時解析）
    const hs = location.hash || ''
    const mS2 = hs.match(/sop=([A-Za-z0-9_-]+)/), mM = hs.match(/meet=([A-Za-z0-9]+)/), mT = hs.match(/tab=([a-z]+)/), mV = hs.match(/vio=([^&]+)/)
    if (mV) { // v4.36.3 違規深層連結（群通知點進來直達該格金光）
      try { const [stV, nmV, dtV, dt2V] = decodeURIComponent(mV[1]).split('|')
        shiftLoad(dtV.slice(0,7))
        let tryN = 0; const go9 = () => { if (document.getElementById('shBox')) { shVioGo(stV, nmV, dtV, dt2V||'') } else if (++tryN < 25) setTimeout(go9, 400) }
        setTimeout(go9, 800)
      } catch(_) {}
      return true
    }
    const mK9 = hs.match(/task=([A-Za-z0-9_-]+)/) // v4.41.6 任務卡深層連結（張良「通知跟訊息直接帶過去看那張卡片閃金光」）
    if (mK9) { window.tnFocusId = mK9[1]; taskEmbed(); return true }
    if (mS2) { sopPage(); glowWait('sopit-' + mS2[1]); return true }
    if (mM) { meetLoad(); glowWait('mt-' + mM[1]); setTimeout(()=>{ if (TK()) meetMop({ op:'view', id: mM[1] }, 1) }, 1500); return true }
    if (mT && R[mT[1]]) { R[mT[1]](); return true }
    return false
  }
  window.addEventListener('hashchange', routeHash)
  if (!routeHash()) { if (v && R[v]) R[v](); else load('ground') }
  // 側欄每個分頁小🔗（張良：這裡旁邊都建立複製連結）
  try { document.querySelectorAll('.tabs button[id^="tab-"]').forEach(b=>{ const k2 = b.id.slice(4); if (k2 === 'home') return
    const sp = document.createElement('span'); sp.className = 'lnkbtn'; sp.title = '複製此分頁連結'; sp.textContent = '🔗'; sp.style.marginLeft = 'auto'
    sp.addEventListener('click', e2=>{ e2.stopPropagation(); if (k2 === 'task') { try { navigator.clipboard.writeText(location.origin + '/ops-tasks.html') } catch(_) {} const t3 = document.createElement('div'); t3.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:80;background:#10182B;color:#fff;border-radius:10px;padding:8px 16px;font-size:14px'; t3.textContent = '🔗 連結已複製'; document.body.appendChild(t3); setTimeout(()=>t3.remove(), 1200) } else copyLink('#tab=' + k2) })
    b.appendChild(sp) }) } catch(_) {}
})()
