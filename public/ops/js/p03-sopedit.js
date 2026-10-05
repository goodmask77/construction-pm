// ⚠️ 這是 /prep 主程式的第 3/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：站別管理+問題回報+SOP編輯
// ── 站別管理：新增/改名/刪除(進回收站可復原)——全部留姓名時間紀錄 ──
let sopTrashOpen = false
async function sopStOp(body){
  body.token = TK()
  const r = await fetch('/api/mail-sync?sopst=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) { sopEditSt = null; sopLoad() } else alert((d&&d.error)||'失敗')
}
// （legacy sopStAdd 已併入 hashtag 版）
function sopStRename(st){ const inp = document.getElementById('edStName'); const nn = inp && inp.value.trim(); if (!nn || nn === st) return alert('輸入新站名再按改名'); sopStOp({ op:'rename', st, newName: nn }) }
function sopStDel(st){ if (confirm(`刪除「${st}」整站？（項目會進回收站，可隨時復原）`)) sopStOp({ op:'del', st }) }
function sopPick(id){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return
    const img = new Image()
    img.onload = () => { // 壓縮到長邊1280、jpeg 0.75（原圖幾MB會超過上傳限制）
      const sc = Math.min(1, 1280 / Math.max(img.width, img.height))
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width*sc); cv.height = Math.round(img.height*sc)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
      sopPhotos[id] = cv.toDataURL('image/jpeg', 0.75); sopRender()
    }
    img.src = URL.createObjectURL(f)
  }
  inp.click()
}
async function sopDo(id, undo){
  if (!TK()) { alert('請先登入：按右上「登入」→ 私訊 DD「登入碼」→ 填入 4 個數字（或點 DD 給的個人連結）'); return }
  const it = (sopData.def.items||[]).find(x=>x.id===id)
  if (!undo && it && it.photo && !sopPhotos[id]) { alert('這項要拍照——先按相機鈕'); return }
  try {
    const r = await fetch('/api/mail-sync?sopdone=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ itemId:id, undo:!!undo, photo: sopPhotos[id]||undefined, token: TK() }) })
    const d = await r.json()
    if (d && d.ok) { delete sopPhotos[id]; sopData.log = d.log; sopRender() } else alert((d&&d.error)||'失敗')
  } catch(e){ alert('連線失敗，再試一次') }
}
// sop 資料到手後，預做表也重畫一次（隱藏清單/身分在 sopData 裡）
const _sopLoad0 = sopLoad
sopLoad = async function(){ await _sopLoad0(); rhythmRender() }
// ── 問題回報 v2（張良 2026-09-21 抓包連環彈窗）：正式回報視窗——先打字，附檔自己按📷，不附檔直接送出＝純文字回報 ──
let repFiles = []
function sopReport(st){
  if (!TK()) { alert('請先登入：按右上「登入」→ 私訊 DD「登入碼」→ 填入 4 個數字（或點 DD 給的個人連結）'); return }
  repFiles = []
  const ov = document.createElement('div'); ov.id = 'repOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:430px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;color:var(--ink);margin-bottom:8px">⚠️ 回報問題【${st}】</div>
    <textarea id="repTxt" rows="3" placeholder="發生什麼事？（只寫文字也可以送出）" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;font-family:inherit"></textarea>
    <div id="repList" class="hint" style="margin:6px 0"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:8px;flex-wrap:wrap">
      <button class="mini" style="padding:9px 12px" onclick="repPick()">📷 加照片/影片</button>
      <button class="mini" style="padding:9px 12px" onclick="repPaste()">📋 貼截圖</button>
      <span><button class="mini" style="padding:9px 12px" onclick="repClose()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="repSend('${st.replace(/'/g,'')}')">送出回報</button></span>
    </div></div>`
  ov.onclick = () => repClose()
  document.body.appendChild(ov)
}
function repClose(){ const o = document.getElementById('repOv'); if (o) o.remove() }
// 截圖貼上（張良 2026-09-26）：按鈕讀剪貼簿；modal 開著時 Cmd/Ctrl+V 也直接進附件
async function repPaste(){
  try {
    const cs = await navigator.clipboard.read()
    for (const ci of cs) { const ty = ci.types.find(x=>x.startsWith('image/')); if (ty) { const b = await ci.getType(ty); const f = new File([b], '截圖.' + (ty.split('/')[1]||'png'), { type: ty }); repFiles = [...repFiles, f].slice(0,6); repListRender(); return } }
    alert('剪貼簿裡沒有圖片——先截圖再按')
  } catch(e){ alert('瀏覽器不給讀剪貼簿——直接按 Cmd/Ctrl+V 貼也可以') }
}
document.addEventListener('paste', (e) => {
  if (!document.getElementById('repOv')) return
  const it = [...((e.clipboardData||{}).items||[])].find(x=>x.type&&x.type.startsWith('image/'))
  if (it) { e.preventDefault(); const f = it.getAsFile(); if (f) { repFiles = [...repFiles, f].slice(0,6); repListRender() } }
})
function repPick(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,video/*'; inp.multiple = true
  inp.onchange = () => { repFiles = [...repFiles, ...inp.files].slice(0, 6); repListRender() }
  inp.click()
}
function repListRender(){
  const el = document.getElementById('repList')
  if (el) el.innerHTML = repFiles.map((f, i) => `📎 ${(f.name || '檔案' + (i + 1)).slice(0, 30)} <a href="#" onclick="repFiles.splice(${i},1);repListRender();return false" style="color:var(--red)">✕移除</a>`).join('<br>')
}
async function repSend(st){
  const txt = (document.getElementById('repTxt') || {}).value || ''
  if (!txt.trim() && !repFiles.length) { alert('至少寫一句話或附一個檔案'); return }
  const btns = document.querySelectorAll('#repOv button'); btns.forEach(b => b.disabled = true)
  const media = []
  for (const f of repFiles) {
    try {
      if (f.size > 80 * 1024 * 1024) { alert(`${f.name} 超過 80MB，跳過（影片請拍短一點）`); continue }
      const ext = ((f.name || '').split('.').pop() || (f.type.includes('video') ? 'mp4' : 'jpg')).toLowerCase()
      const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ext }) })
      const sd = await sr.json()
      if (!sd || !sd.ok) { alert('取得上傳位址失敗'); continue }
      const ur = await fetch(sd.uploadUrl, { method: 'PUT', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f })
      if (ur.ok) media.push(sd.publicUrl); else alert(`${f.name} 上傳失敗`)
    } catch(e){ alert(`${f.name} 上傳失敗`) }
  }
  let by = sopData && sopData.me ? sopData.me.name : (localStorage.getItem('sopName') || prompt('你的名字？') || '匿名')
  const r = await fetch('/api/mail-sync?sopreport=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ st, text: txt, media, by, token: TK() }) })
  const d = await r.json().catch(()=>null)
  repClose()
  if (d && d.ok) { alert('回報已送出，DD 已通知群裡'); sopLoad() } else alert((d&&d.error)||'送出失敗，再試一次')
}
async function sopResolve(id){
  if (!confirm('標記已解決？（審核人按＝直接完成；夥伴按＝送審核，核准後才算完成）')) return
  const r = await fetch('/api/mail-sync?sopresolve=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) { if (d.status === 'pending') alert('已送出，等老闆審核'); refreshView() } else alert((d&&d.error)||'失敗（要先跟 DD 綁定GD）')
}
function refreshView(){ if (curStore === 'task' || curStore === 'lb') { lbFetch(1).then(()=>{ curStore==='task' ? taskRender() : lbRender() }) } else sopLoad() } // 操作後重抓一律跳過快取
async function sopReview(id, pass){
  if (!confirm(pass ? '核准這筆解決？' : '退回（狀態回到未解決）？')) return
  const r = await fetch('/api/mail-sync?sopreview=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, pass: !!pass, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) refreshView(); else alert((d&&d.error)||'失敗')
}
// ── SOP 編輯（張良 2026-09-21 拍板：不設站長，綁定者全站可編；時間/姓名/改前內容全留痕）──
function sopEdit(st){ sopEditSt = (sopEditSt === st) ? null : st; sopRender() }
function sopEditor(st){
  const rows = (sopData.def.items||[]).filter(i => i.st === st).sort((a,b)=>String(a.due||'99:99').localeCompare(String(b.due||'99:99'))) // 自動照時間排（張良 2026-09-22）
  let s = `<div id="sopEd" data-st="${st}" style="border:1.5px dashed var(--primary);border-radius:10px;padding:10px;margin-bottom:6px">
  <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
    <span class="hint">站名</span><input id="edStName" value="${st}" style="border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:14px;width:120px">
    <button class="mini" onclick="sopStRename('${st}')">改名</button>
    <button class="mini" style="color:var(--red)" onclick="sopStDel('${st}')">🗑 刪除此站</button>
  </div>`
  rows.forEach(it => { s += sopEdRow(it) })
  s += `<button class="mini" onclick="sopEdAdd()">＋ 加一項</button>
  <div style="margin-top:8px;text-align:right"><button class="mini on" style="padding:8px 18px" onclick="sopEdSave()">💾 儲存這一站</button></div></div>`
  return s
}
function sopEdRow(it){
  return `<div class="sopEdRow" data-id="${it.id||''}" data-ref="${it.ref||''}" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
    <input class="edT" value="${(it.title||'').replace(/"/g,'&quot;')}" placeholder="項目名稱" style="flex:1;min-width:150px;border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:14px">
    ${t24c('edD', it.due||'11:00')}
    <label style="font-size:13px;white-space:nowrap"><input class="edP" type="checkbox" ${it.photo?'checked':''}> 📷</label>
    <button class="mini edRef" style="${it.ref?'color:var(--primary);font-weight:800':''}" onclick="edRefPick(this)" title="上傳標準照（示範照片，大家點名字就看得到）">🖼${it.ref?'✓':''}</button>
    <button class="mini" onclick="this.parentElement.remove()">刪</button></div>`
}
// 標準照上傳：選圖 → sopsign 簽名直傳 → 存進該列 data-ref（按「儲存這一站」才寫入定義）
function edRefPick(btn){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return
    btn.textContent = '⏳'
    try {
      const ext = ((f.name||'').split('.').pop()||'jpg').toLowerCase()
      const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ext }) })
      const sd = await sr.json()
      if (sd && sd.ok) { const ur = await fetch(sd.uploadUrl, { method:'PUT', headers:{'content-type': f.type||'image/jpeg'}, body: f }); if (ur.ok) { btn.closest('.sopEdRow').dataset.ref = sd.publicUrl; btn.innerHTML = '🖼✓'; btn.style.color='var(--primary)'; btn.style.fontWeight='800'; return } }
      btn.innerHTML = '🖼'; alert('上傳失敗，再試一次')
    } catch(e){ btn.innerHTML = '🖼'; alert('上傳失敗') }
  }
  inp.click()
}
function sopEdAdd(){
  const box = document.getElementById('sopEd')
  const div = document.createElement('div'); div.innerHTML = sopEdRow({ due:'11:00' })
  box.insertBefore(div.firstChild, box.querySelector('button.mini'))
}
async function sopEdSave(){
  const box = document.getElementById('sopEd'); if (!box) return
  const items = [...box.querySelectorAll('.sopEdRow')].map(r => ({
    id: r.dataset.id || undefined,
    title: r.querySelector('.edT').value.trim(),
    due: t24read(r, 'edD') || '11:00',
    photo: r.querySelector('.edP').checked,
    ref: r.dataset.ref || undefined, // 標準照
  })).filter(x => x.title)
  try {
    const r = await fetch('/api/mail-sync?sopedit=' + encodeURIComponent(K), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ token: TK(), st: box.dataset.st, items }) })
    const d = await r.json()
    if (d && d.ok) { sopEditSt = null; sopLoad() }
    else alert(d && d.error ? d.error : '儲存失敗')
  } catch(e){ alert('連線失敗，再試一次') }
}
// ── 🛠 任務看板 ＋ 🏆 排行榜（張良 2026-09-22 拆分：未完成任務在「任務」分頁＋階段性checklist；
//    完成經審核後到排行榜給大家評分——評星改「拉桿」就地送出不再閃白、1~5星帶等級說明；
//    評完自動往下封存（可打開看/改票）；沒評完就留在自己頁面上=每個人清單不一樣）──
const LVLTXT = { 1:'1★ 有待加強：還要人帶著做', 2:'2★ 基本達標：交代的有做到', 3:'3★ 稱職：穩定可靠、不用盯', 4:'4★ 超出期待：主動補位、做得比要求多', 5:'5★ 標竿：可以當範本教別人' }
let lbSkip = new Set(JSON.parse(localStorage.getItem('lbSkip')||'[]'))
// ── 分頁切換提速（張良 2026-09-22「切換有點卡頓」）：stale-first——點分頁先畫上次資料(記憶體+localStorage)、
//    背景抓新的回來再重畫；首次進站 0.8 秒後背景預抓全部分頁 → 之後切哪一頁都秒開 ──
const tcGet = k => { try { return JSON.parse(localStorage.getItem('obt_'+k)) } catch(e){ return null } }
const tcSet = (k,d) => { try { localStorage.setItem('obt_'+k, JSON.stringify(d)) } catch(e){} }
async function prefetchTabs(){
  const q = async (url, key) => { try { const r = await fetch(url); const d2 = await r.json(); if (d2 && d2.ok) { tcSet(key, d2); return d2 } } catch(e){} }
  const me = TK() ? '&me=' + encodeURIComponent(TK()) : ''
  q('/api/mail-sync?lb=' + encodeURIComponent(K) + '&v=2' + me, 'lb').then(d2=>{ if(d2){ if(!window._lbD) window._lbD = d2; todayRender() } })
  q('/api/mail-sync?inv=' + encodeURIComponent(K) + '&kind=food' + me, 'inv_food')
  q('/api/mail-sync?inv=' + encodeURIComponent(K) + '&kind=pack' + me, 'inv_pack')
  q('/api/mail-sync?buy=' + encodeURIComponent(K) + me, 'buy').then(d2=>{ if(d2){ if(!window._buyD) window._buyD = d2; todayRender() } })
  q('/api/mail-sync?meet=' + encodeURIComponent(K) + me, 'meet').then(d2=>{ if(d2 && !window._meetD) window._meetD = d2 })
  q('/api/mail-sync?shift=' + encodeURIComponent(K) + '&ym=' + todayTpe().slice(0,7) + me, 'shift_' + todayTpe().slice(0,7)).then(d2=>{ if(d2){ if(!window._shiftD) window._shiftD = d2; todayRender() } })
  q('/api/mail-sync?fb=' + encodeURIComponent(K) + '&date=' + todayTpe() + me, 'fb_' + todayTpe()).then(d2=>{ if(d2 && !window._fbD) window._fbD = d2 })
  q('/api/mail-sync?menu=' + encodeURIComponent(K) + me, 'menu').then(d2=>{ if(d2 && !window._menuD) window._menuD = d2 })
}
async function lbFetch(fresh){
  let d
  try { const r = await fetch('/api/mail-sync?lb=' + encodeURIComponent(K) + '&v=2' + (fresh ? '&r=' + Date.now() : '') + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (d && d.ok) { window._lbD = d; tcSet('lb', d) }
  return window._lbD
}
async function loadLB(){
  curStore = 'lb'; setTabs('lb')
  if (!window._lbD) { const c = tcGet('lb'); if (c) window._lbD = c }
  if (window._lbD) lbRender(); else app.innerHTML = '<section>載入中…</section>'
  await lbFetch(); if (curStore === 'lb') lbRender()
}
async function taskLoad(){
  curStore = 'task'; setTabs('task')
  if (!window._lbD) { const c = tcGet('lb'); if (c) window._lbD = c }
  if (window._lbD) taskRender(); else app.innerHTML = '<section>載入中…</section>'
  await lbFetch(); if (curStore === 'task') taskRender()
}
// 我對這件事的每個「可評面」已評了幾個面向
function lbMyRated(x, meN){
  const out = []
  for (const a of ['find','fix']){
    const target = a==='find' ? x.by : x.doneBy
    if (!target || target==='匿名' || target===meN) continue
    const st = (x.stars||{})[a]||{}
    out.push({ a, n: window._lbD.facets.filter(f=>((st[f]||{})[meN])>=1).length })
  }
  return out
}
function lbRender(){
  const d = window._lbD
  if (!d) { app.innerHTML = '<div class="err">讀不到排行榜資料</div>'; return }
  if (curStore !== 'lb') return
  document.getElementById('upd').textContent = '排行榜・完成的任務在這給大家評星'
  const meN = d.me ? d.me.name : null // 2026-10-02 全面修：只有菜單口有 canEdit 欄位，整檔替換誤傷各分頁→按鈕全滅；顯示層=綁定即可，真正權限由伺服器端守門
  let h = ''
  h += `<section><h2>GD之星 榮耀榜 <span class="hint">各面向平均星最高（至少 3 票上榜）</span></h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">` +
  d.facets.map(f=>{ const w = d.stars5[f]
    return `<div style="background:${w?'#2E2814':'var(--soft)'};border:1px solid ${w?'#E8D089':'var(--line)'};border-radius:12px;padding:10px;text-align:center">
      <div style="font-size:13px;font-weight:800;color:var(--pdark)">${f}之星</div>
      ${w?`<div style="font-size:17px;font-weight:900;color:var(--ink)">👑 ${w.name}</div><div class="hint">⭐${w.avg}・${w.n}票</div>`:`<div class="mut" style="font-size:14px;padding:4px 0">虛位以待</div><div class="hint">滿3票上榜</div>`}
    </div>`}).join('') + `</div></section>`
  // 🎁 兌換商城（張良 2026-10-06：放排行榜頁；排名不掉、另算可用點；全部要你審核；你也可直接給分）
  const Elb = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const myBal = d.myBalance||0
  const rewards = (d.rewards||[]).filter(r=>!r.off).sort((a,b)=>(a.ord||0)-(b.ord||0))
  h += `<section><h2>🎁 兌換商城 <span class="hint">用累積點數換獎勵（兌換不影響排名）</span>${meN&&d.isAdmin?' <button class="mini" style="margin-left:6px" onclick="lbRwMng()">⚙️ 管理獎勵</button> <button class="mini" onclick="lbGrant()">＋ 直接給分</button>':''}</h2>`
  h += meN?`<div style="background:var(--soft);border:1px solid var(--primary);border-radius:12px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px"><span class="hint">我的可用點數</span><b style="font-size:26px;color:var(--primary)">${myBal}</b><span class="hint">點</span></div>`:`<div class="hint" style="margin-bottom:8px">綁定後才能兌換——${BIND_HINT}</div>`
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">`
  h += rewards.length?rewards.map(r=>{
    const soldout = r.stock!=null && r.stock<=0
    const can = meN && myBal>=r.cost && !soldout
    return `<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 12px;display:flex;flex-direction:column;gap:5px">
      <div style="font-weight:800;color:var(--ink)">${Elb(r.name)}</div>
      ${r.desc?`<div class="hint" style="font-size:12px">${Elb(r.desc)}</div>`:''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:6px"><span style="font-weight:800;color:var(--primary)">${r.cost} 點</span>${r.stock!=null?`<span class="hint" style="font-size:11px">剩${r.stock}</span>`:''}</div>
      <button class="mini ${can?'on':''}" ${can?'':'disabled style="opacity:.45"'} onclick="lbRedeem('${r.id}','${Elb(r.name)}',${r.cost})">${soldout?'已換完':(meN?(myBal>=r.cost?'兌換':'點數不足'):'要綁定')}</button>
    </div>`
  }).join(''):'<div class="mut">還沒有獎勵——管理者按「⚙️ 管理獎勵」新增</div>'
  h += `</div>`
  const myRd = d.myRedeems||[]
  if (meN && myRd.length){ const stTag = s=>({pending:'🕐 待審',approved:'✅ 已通過',rejected:'❌ 未過',done:'🎉 已給'}[s]||s)
    h += `<div style="margin-top:10px"><div style="font-weight:700;font-size:13px;margin-bottom:4px">我的兌換紀錄</div>${myRd.slice(0,10).map(r=>`<div style="background:var(--soft);border-radius:8px;padding:5px 9px;margin-top:4px;font-size:13px;display:flex;gap:8px"><span>${stTag(r.status)}</span><span style="flex:1">${Elb(r.rewardName)}（${r.cost}點）</span><span class="hint">${r.ts||''}</span></div>`).join('')}</div>` }
  h += `</section>`
  if (d.isAdmin && (d.pendingRedeems||[]).length){
    h += `<section><h2>🛡 待審核兌換（${d.pendingRedeems.length}） <span class="hint">准了自動扣對方點數、雙方收通知</span></h2>`
    h += d.pendingRedeems.map(r=>`<div style="background:var(--card);border:1.5px solid #E8B931;border-radius:11px;padding:9px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <b>${Elb(r.person)}</b><span>換「${Elb(r.rewardName)}」</span><span style="color:var(--primary);font-weight:800">${r.cost}點</span><span class="hint">${r.ts||''}</span>
      <span style="margin-left:auto;display:flex;gap:6px"><button class="mini on" style="padding:6px 14px" onclick="lbRdDecide('${r.id}',1)">准</button><button class="mini" style="padding:6px 14px;color:var(--red)" onclick="lbRdDecide('${r.id}',0)">駁回</button></span></div>`).join('')
    h += `</section>`
  }
  // 🔍 發現王（張良 2026-09-26）：發現問題次數排行，點名字看他發現過的每一件
  const finders = {}
  ;(d.issues||[]).forEach(x=>{ if (x.by && x.by!=='匿名') (finders[x.by]=finders[x.by]||[]).push(x) })
  const fRank = Object.entries(finders).sort((a,b)=>b[1].length-a[1].length)
  h += `<section><h2>🔍 發現王排行榜 <span class="hint">發現問題次數——點名字看他發現了什麼</span></h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap">${fRank.length?fRank.slice(0,12).map(([nm,arr],i)=>`<div onclick="lbFinder('${nm}')" style="cursor:pointer;background:${i===0?'#2E2814':'var(--soft)'};border:1.5px solid ${i===0?'#E8D089':'var(--line)'};border-radius:12px;padding:10px 16px;text-align:center;min-width:96px">
    <div style="font-size:13px;font-weight:700;color:var(--muted)">${i===0?'👑 ':''}#${i+1}</div><div style="font-weight:800;color:var(--ink)">${nm}</div><div style="font-size:20px;font-weight:800;color:var(--pdark)">${arr.length}<span style="font-size:12px"> 件</span></div>
  </div>`).join(''):'<div class="mut">還沒有人回報過問題</div>'}</div></section>`
  // 🔥 本月行為榜（張良 2026-10-06 拍板：排行榜看 總累積＋本月；行為分＝做了就給）
  const monthRank = [...d.rank].filter(p=>p.behavMonth>0).sort((a,b)=>b.behavMonth-a.behavMonth)
  h += `<section><h2>🔥 本月行為榜 <span class="hint">本月「有做事」累積分（${d.month||''}）：打卡／交回饋／完成SOP／簽收會議／回報問題</span></h2>
  <div style="display:flex;gap:8px;flex-wrap:wrap">${monthRank.length?monthRank.slice(0,12).map((p,i)=>`<div style="background:${i===0?'#13233A':'var(--soft)'};border:1.5px solid ${i===0?'#4DA3FF':'var(--line)'};border-radius:12px;padding:10px 16px;text-align:center;min-width:92px">
    <div style="font-size:13px;font-weight:700;color:var(--muted)">${i===0?'🔥 ':''}#${i+1}</div><div style="font-weight:800;color:var(--ink)">${p.name}</div><div style="font-size:20px;font-weight:800;color:var(--primary)">${p.behavMonth}<span style="font-size:12px"> 分</span></div>
  </div>`).join(''):'<div class="mut">本月還沒有人累積行為分——做事就有分</div>'}</div></section>`
  h += `<section><h2>積分排行榜 <span class="hint">總累積＝行為分(做了就給)＋品質分(被評星)＋任務分</span>${meN&&d.isAdmin?' <button class="mini" style="margin-left:6px" onclick="lbPtsCfg()">⚙️ 積分規則</button>':''}</h2>
  <div class="scroll"><table><thead><tr><th>#</th><th style="text-align:left">夥伴</th><th>行為分</th><th>發現分</th><th>解決分</th><th>任務分</th><th>總積分</th>${d.facets.map(f=>'<th>'+f+'</th>').join('')}<th>發現次</th><th>解決次</th></tr></thead><tbody>`
  if (!d.rank.length) h += `<tr><td colspan="${9+d.facets.length}" style="text-align:center" class="mut">還沒有分數——打卡、交回饋、完成SOP、回報問題、幫別人評星開始累積</td></tr>`
  d.rank.forEach((p,i)=>{
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)
    h += `<tr style="${meN===p.name?'background:var(--psoft)':''}"><td style="font-weight:900">${medal}</td><td style="text-align:left;font-weight:800;color:var(--ink)">${p.name}</td><td style="font-weight:800;color:${p.behavPts?'#4DA3FF':'inherit'}">${p.behavPts||0}</td><td>${p.findPts||0}</td><td>${p.fixPts||0}</td><td style="font-weight:800;color:${p.taskPts?'#F2C14E':'inherit'}">${p.taskPts||0}</td><td class="avg">${p.total||0}</td>${d.facets.map(f=>'<td>'+(p.facets[f]?('⭐'+p.facets[f].avg):'—')+'</td>').join('')}<td class="mut">${p.nFind}</td><td class="mut">${p.nFix}</td></tr>`
  })
  h += `</tbody></table></div></section>`
  // 📒 積分存摺（張良 2026-10-06：像銀行帳戶，逐筆＋餘額；本人看自己、管理者可查任何人）
  h += `<section><h2>📒 積分存摺 <span class="hint">每一筆進出＋當下餘額</span>${d.isAdmin?` <select id="lgWho" onchange="lbLedgerView()" style="margin-left:6px;border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:13px"><option value="">我自己</option>${(d.names||[]).map(n=>`<option>${Elb(n)}</option>`).join('')}</select>`:''}</h2>
  <div id="lgBox">${lbLedgerHtml(d.myLedger||[], d.myBalance||0, meN||'我')}</div></section>`
  // 待你評分（個人化）＋ 📦 封存
  const doneL = (d.issues||[]).filter(x=>x.status==='done')
  const toRate = [], arch = []
  doneL.forEach(x=>{
    if (!meN) { arch.push(x); return }
    const rl = lbMyRated(x, meN)
    if (!rl.length || rl.every(o=>o.n >= d.facets.length) || lbSkip.has(x.id)) arch.push(x); else toRate.push(x)
  })
  h += `<section><h2>待你評分（${toRate.length}） <span class="hint">${meN?'完成的任務等你打星——每個人看到的清單不一樣':'綁定後這裡會出現等你評分的任務'}</span></h2>`
  h += toRate.length ? toRate.map(x=>rateCard(x,meN,false)).join('') : `<div class="mut">目前沒有等你評分的任務 🎉</div>`
  h += `</section>`
  if (arch.length) h += `<section><details><summary style="font-weight:900;cursor:pointer">📦 封存（${arch.length}）｜評完／略過的收在這，點開可看可改票</summary><div style="margin-top:8px">${arch.map(x=>rateCard(x,meN,true)).join('')}</div></details></section>`
  app.innerHTML = h
}
// 🏦 積分規則表管理（管理者；張良 2026-10-06）：改每個動作幾分/每天上限/開關、加新動作、抽查加扣分
async function lbPtsCfg(){
  let d; try { const r = await fetch('/api/mail-sync?pointscfg=' + encodeURIComponent(K) + (TK()?'&me='+encodeURIComponent(TK()):'')); d = await r.json() } catch(e){}
  if (!d || !d.ok){ alert('讀不到積分規則'); return }
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const rules = d.rules || {}
  const rows = Object.keys(rules).map(act=>{ const r = rules[act]
    return `<tr data-act="${esc(act)}" style="${r.off?'opacity:.45':''}">
      <td style="text-align:left;padding:4px 6px"><input class="pcLbl" value="${esc(r.label||act)}" style="width:118px;border:1px solid var(--line);border-radius:7px;padding:5px 7px;font-size:13px"><div class="hint" style="font-size:11px">${esc(act)}</div></td>
      <td style="padding:4px 6px"><input class="pcPts" type="number" value="${Number(r.pts)||0}" style="width:52px;border:1px solid var(--line);border-radius:7px;padding:5px;font-size:13px;text-align:center"></td>
      <td style="padding:4px 6px"><input class="pcCap" type="number" value="${Number(r.cap)||0}" style="width:52px;border:1px solid var(--line);border-radius:7px;padding:5px;font-size:13px;text-align:center"></td>
      <td style="padding:4px 6px;text-align:center"><input class="pcOff" type="checkbox" ${r.off?'checked':''}></td>
      <td style="padding:4px 6px"><button class="mini" style="padding:4px 8px" onclick="lbPtsSave(this)">存</button></td></tr>`
  }).join('')
  const ov = document.createElement('div'); ov.id='pcOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,20,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#161B22;border:1px solid #2A3240;box-shadow:0 18px 50px rgba(0,0,0,.6);border-radius:14px;max-width:560px;width:100%;max-height:86vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px;margin-bottom:4px">⚙️ 積分規則表（行為分）</div>
    <div class="hint" style="margin-bottom:10px">分數＝做一次給幾分；上限＝每人每天最多算幾次（0＝不限）；關閉＝暫停這項給分。品質分由排行榜評星另計。</div>
    <table style="width:100%;font-size:13px"><thead><tr><th style="text-align:left">動作</th><th>分數</th><th>每天上限</th><th>關閉</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:10px">
      <div style="font-weight:800;margin-bottom:6px">＋ 新增動作</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <input id="pcNewAct" placeholder="代碼(英數)" style="width:110px;border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:13px">
        <input id="pcNewLbl" placeholder="顯示名稱" style="width:120px;border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:13px">
        <input id="pcNewPts" type="number" placeholder="分" style="width:56px;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:13px;text-align:center">
        <input id="pcNewCap" type="number" placeholder="上限" style="width:56px;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:13px;text-align:center">
        <button class="mini on" style="padding:6px 12px" onclick="lbPtsAdd()">加入</button></div>
      <div class="hint" style="font-size:11px;margin-top:4px">代碼＝程式識別用（之後要接這個動作給分才有效）；張良只要改分數/上限/開關就好</div>
    </div>
    <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:10px">
      <div style="font-weight:800;margin-bottom:6px">🔎 抽查加／扣分</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <select id="pcAdjP" style="border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:13px">${((window._lbD&&window._lbD.names)||[]).map(n=>`<option>${esc(n)}</option>`).join('')}</select>
        <input id="pcAdjPts" type="number" placeholder="±分" style="width:64px;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:13px;text-align:center">
        <input id="pcAdjNote" placeholder="原因(可空)" style="flex:1;min-width:120px;border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:13px">
        <button class="mini" style="padding:6px 12px" onclick="lbPtsAdjust()">送出</button></div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="mini" style="padding:8px 16px" onclick="document.getElementById('pcOv').remove()">關閉</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function lbPtsPost(body){
  const r = await fetch('/api/mail-sync?pointscfg=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...body, token: TK() }) })
  return r.json().catch(()=>null)
}
async function lbPtsSave(btn){
  const tr = btn.closest('tr'); const act = tr.dataset.act
  const label = tr.querySelector('.pcLbl').value, pts = +tr.querySelector('.pcPts').value, cap = +tr.querySelector('.pcCap').value, off = tr.querySelector('.pcOff').checked
  const d = await lbPtsPost({ op:'set', act, label, pts, cap, off })
  if (d && d.ok){ btn.textContent='✓'; setTimeout(()=>btn.textContent='存',1000) } else alert((d&&d.error)||'存失敗')
}
async function lbPtsAdd(){
  const act=(document.getElementById('pcNewAct')||{}).value||'', label=(document.getElementById('pcNewLbl')||{}).value||'', pts=+((document.getElementById('pcNewPts')||{}).value||0), cap=+((document.getElementById('pcNewCap')||{}).value||0)
  if(!act||!label){ alert('代碼和名稱都要填'); return }
  const d = await lbPtsPost({ op:'set', act, label, pts, cap })
  if (d && d.ok){ document.getElementById('pcOv').remove(); lbPtsCfg() } else alert((d&&d.error)||'加入失敗')
}
async function lbPtsAdjust(){
  const person=(document.getElementById('pcAdjP')||{}).value||'', pts=+((document.getElementById('pcAdjPts')||{}).value||0), note=(document.getElementById('pcAdjNote')||{}).value||''
  if(!person||!pts){ alert('要選人＋填加扣分數'); return }
  const d = await lbPtsPost({ op:'adjust', person, pts, note })
  if (d && d.ok){ alert('已記錄 '+(pts>0?'+':'')+pts+' 給 '+person); document.getElementById('pcOv').remove(); if (typeof refreshView==='function') refreshView() } else alert((d&&d.error)||'送出失敗')
}
// 📒 積分存摺 html（像銀行帳戶：逐筆＋跑餘額）
function lbLedgerHtml(ledger, bal, who){
  const E = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const ACT = { punch:'打卡上班', fb_give:'交每日回饋', sop_done:'完成SOP', meet_ack:'簽收會議', journal:'工作日誌', issue_report:'回報問題', inv_count:'盤點', adjust:'手動調整', redeem:'兌換獎勵' }
  let h = `<div style="background:var(--soft);border-radius:10px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;gap:8px"><span class="hint">${E(who)} 目前餘額</span><b style="font-size:22px;color:var(--primary)">${bal}</b><span class="hint">點</span></div>`
  if (!ledger.length) return h + '<div class="mut">還沒有任何積分紀錄</div>'
  h += `<div class="scroll"><table><thead><tr><th style="text-align:left">時間</th><th style="text-align:left">項目</th><th>±</th><th>餘額</th></tr></thead><tbody>`
  h += ledger.map(e=>`<tr><td style="text-align:left" class="hint">${E((e.date||'').slice(5))} ${E(e.ts||'')}</td><td style="text-align:left">${ACT[e.act]||E(e.act)}${e.note?'·'+E(e.note):''}${e.by?' <span class="hint">by '+E(e.by)+'</span>':''}</td><td style="font-weight:800;color:${e.pts>=0?'var(--green)':'var(--red)'}">${e.pts>=0?'+':''}${e.pts}</td><td>${e.bal}</td></tr>`).join('')
  return h + `</tbody></table></div>`
}
async function lbLedgerView(){
  const sel = document.getElementById('lgWho'); if (!sel) return
  const who = sel.value, box = document.getElementById('lgBox'); if (!box) return
  if (!who){ const d = window._lbD; box.innerHTML = lbLedgerHtml(d.myLedger||[], d.myBalance||0, (d.me&&d.me.name)||'我'); return }
  box.innerHTML = '<div class="mut">載入中…</div>'
  let d; try { const r = await fetch('/api/mail-sync?ledger=' + encodeURIComponent(K) + '&who=' + encodeURIComponent(who) + (TK()?'&me='+encodeURIComponent(TK()):'')); d = await r.json() } catch(e){}
  box.innerHTML = (d&&d.ok) ? lbLedgerHtml(d.ledger||[], d.balance||0, who) : '<div class="err">讀不到</div>'
}
// 🎁 兌換
async function lbRedeem(id, name, cost){
  if (!confirm('用 ' + cost + ' 點兌換「' + name + '」？送出後等審核')) return
  const r = await fetch('/api/mail-sync?redeem=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'request', rewardId:id, token:TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok){ alert('已送出兌換申請，等審核 🎁'); if (typeof refreshView==='function') refreshView() } else alert((d&&d.error)||'兌換失敗')
}
async function lbRdDecide(id, pass){
  if (!confirm(pass ? '核准這筆兌換？會自動扣對方點數' : '駁回這筆兌換？點數不會扣')) return
  const r = await fetch('/api/mail-sync?redeem=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'decide', id, pass: !!pass, token:TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok){ if (typeof refreshView==='function') refreshView() } else alert((d&&d.error)||'處理失敗')
}
// ＋ 直接給／扣積分（複用 pointscfg adjust）
function lbGrant(){
  const d = window._lbD, E = s => String(s==null?'':s).replace(/"/g,'&quot;')
  const ov = document.createElement('div'); ov.id='grOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,20,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#161B22;border:1px solid #2A3240;border-radius:14px;max-width:360px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:10px">＋ 直接給／扣積分</div>
    <select id="grWho" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:8px">${(d.names||[]).map(n=>`<option>${E(n)}</option>`).join('')}</select>
    <input id="grPts" type="number" placeholder="點數（正=給／負=扣）" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:8px;box-sizing:border-box">
    <input id="grNote" placeholder="原因（可空）" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;margin-bottom:12px;box-sizing:border-box">
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('grOv').remove()">取消</button><button class="mini on" style="padding:9px 18px" onclick="lbGrantGo()">送出</button></div></div>`
  ov.onclick = () => ov.remove(); document.body.appendChild(ov)
}
async function lbGrantGo(){
  const person=(document.getElementById('grWho')||{}).value||'', pts=+((document.getElementById('grPts')||{}).value||0), note=(document.getElementById('grNote')||{}).value||''
  if (!person || !pts){ alert('要選人＋填點數'); return }
  const r = await fetch('/api/mail-sync?pointscfg=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'adjust', person, pts, note, token:TK() }) })
  const d = await r.json().catch(()=>null)
  const o = document.getElementById('grOv'); if (o) o.remove()
  if (d && d.ok){ alert('已給 ' + person + ' ' + (pts>0?'+':'') + pts + ' 點'); if (typeof refreshView==='function') refreshView() } else alert((d&&d.error)||'失敗')
}
// ⚙️ 管理獎勵
function lbRwMng(){
  const d = window._lbD, E = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
  const rws = (d.rewards||[]).slice().sort((a,b)=>(a.ord||0)-(b.ord||0))
  const row = r=>`<tr data-id="${E(r.id)}" style="${r.off?'opacity:.45':''}">
    <td style="padding:3px"><input class="rwN" value="${E(r.name)}" style="width:120px;border:1px solid var(--line);border-radius:7px;padding:5px;font-size:13px"></td>
    <td style="padding:3px"><input class="rwC" type="number" value="${r.cost}" style="width:56px;border:1px solid var(--line);border-radius:7px;padding:5px;font-size:13px;text-align:center"></td>
    <td style="padding:3px"><input class="rwS" type="number" value="${r.stock==null?'':r.stock}" placeholder="∞" style="width:48px;border:1px solid var(--line);border-radius:7px;padding:5px;font-size:13px;text-align:center"></td>
    <td style="padding:3px;text-align:center"><input class="rwOff" type="checkbox" ${r.off?'checked':''}></td>
    <td style="padding:3px"><button class="mini" style="padding:4px 7px" onclick="lbRwSave(this)">存</button><button class="mini" style="padding:4px 7px;color:var(--red)" onclick="lbRwDel('${E(r.id)}')">刪</button></td></tr>`
  const ov = document.createElement('div'); ov.id='rwOv'
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,14,20,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#161B22;border:1px solid #2A3240;border-radius:14px;max-width:540px;width:100%;max-height:86vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px;margin-bottom:4px">⚙️ 管理獎勵</div>
    <div class="hint" style="margin-bottom:10px">點數＝兌換要花幾點；庫存留空＝不限；關＝暫時不開放</div>
    <table style="width:100%;font-size:13px"><thead><tr><th style="text-align:left">獎勵</th><th>點</th><th>庫存</th><th>關</th><th></th></tr></thead><tbody>${rws.map(row).join('')}</tbody></table>
    <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:10px"><div style="font-weight:800;margin-bottom:6px">＋ 新增獎勵</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <input id="rwNewN" placeholder="名稱" style="width:130px;border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:13px">
        <input id="rwNewC" type="number" placeholder="點數" style="width:64px;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:13px;text-align:center">
        <input id="rwNewS" type="number" placeholder="庫存(空=∞)" style="width:96px;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:13px">
        <input id="rwNewD" placeholder="說明(可空)" style="flex:1;min-width:110px;border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:13px">
        <button class="mini on" style="padding:6px 12px" onclick="lbRwAdd()">加入</button></div></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="mini" style="padding:8px 16px" onclick="document.getElementById('rwOv').remove()">關閉</button></div></div>`
  ov.onclick = () => ov.remove(); document.body.appendChild(ov)
}
async function lbRwPost(body){ const r = await fetch('/api/mail-sync?rewardset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...body, token:TK() }) }); return r.json().catch(()=>null) }
async function lbRwSave(btn){ const tr = btn.closest('tr'); const d = await lbRwPost({ op:'set', id:tr.dataset.id, name:tr.querySelector('.rwN').value, cost:+tr.querySelector('.rwC').value, stock:tr.querySelector('.rwS').value, off:tr.querySelector('.rwOff').checked }); if (d&&d.ok){ btn.textContent='✓'; setTimeout(()=>btn.textContent='存',1000); window._lbD.rewards=d.rewards } else alert((d&&d.error)||'存失敗') }
async function lbRwDel(id){ if (!confirm('刪除這個獎勵？')) return; const d = await lbRwPost({ op:'del', id }); if (d&&d.ok){ const o=document.getElementById('rwOv'); if(o)o.remove(); window._lbD.rewards=d.rewards; if (typeof refreshView==='function') refreshView() } else alert((d&&d.error)||'刪失敗') }
async function lbRwAdd(){ const n=(document.getElementById('rwNewN')||{}).value||'', c=+((document.getElementById('rwNewC')||{}).value||0), s=(document.getElementById('rwNewS')||{}).value||'', ds=(document.getElementById('rwNewD')||{}).value||''; if (!n||!c){ alert('名稱和點數要填'); return } const d = await lbRwPost({ op:'set', name:n, cost:c, stock:s, desc:ds }); if (d&&d.ok){ const o=document.getElementById('rwOv'); if(o)o.remove(); window._lbD.rewards=d.rewards; lbRwMng(); if (typeof refreshView==='function') refreshView() } else alert((d&&d.error)||'加入失敗') }
// 完成任務卡（排行榜評分用）：拉桿評星＋等級說明，onchange 就地送出
function rateCard(x, meN, archived){
  const d = window._lbD
  let s = `<div style="background:var(--card);border:1.5px solid ${archived?'var(--line)':'#BBE3CC'};border-radius:12px;padding:10px 12px;margin-bottom:10px;font-size:14px">
    <div><b>✅ ${x.text||'（附件）'}</b>${(x.media||[]).map((m,i)=>` <a href="${m}" target="_blank">📎${i+1}</a>`).join('')}</div>
    <div class="hint">${x.st||''}・發現：${x.by}・${x.ts}｜解決：${x.doneBy||'—'}${x.doneTs?'・'+x.doneTs:''}${x.durMin?`・耗時${x.durMin}分`:''}</div>`
  for (const a of ['find','fix']){
    const target = a==='find' ? x.by : x.doneBy
    if (!target || target==='匿名') continue
    const avg = a==='find' ? x.findAvg : x.fixAvg
    const st = (x.stars||{})[a]||{}
    const nAll = Object.values(st).reduce((t2,f)=>t2+Object.keys(f||{}).length,0)
    const canVote = meN && meN!==target
    s += `<div style="margin-top:8px;font-weight:800;font-size:14px">${a==='find'?'🔍 發現':'🔧 解決'}｜${target} <span class="avg">${avg!=null?'⭐'+avg:'—'}</span> <span class="hint">${nAll}票${canVote?'':(meN===target?'（自己的不能評）':'')}</span></div>`
    if (canVote){
      s += `<div style="background:var(--soft);border-radius:10px;padding:7px 10px;margin-top:4px">`
      s += d.facets.map(f=>{ const mine = (st[f]||{})[meN]||0
        return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0"><span style="width:34px;font-size:13px;font-weight:700;flex:0 0 auto">${f}</span><input type="range" min="1" max="5" step="1" value="${mine||3}" style="flex:1;accent-color:#E8B931;min-width:80px" oninput="lbSlide(this,'${x.id}','${a}','${f}')" onchange="lbRate(this,'${x.id}','${a}','${f}')"><span class="lbst" style="width:78px;text-align:right;font-size:15px;color:#E8B931;flex:0 0 auto">${mine?'★'.repeat(mine)+'☆'.repeat(5-mine):'<span class="mut" style="font-size:13px">未評</span>'}</span></div>`
      }).join('')
      s += `<div id="fd_${x.id}_${a}" class="hint" style="margin-top:3px">拉一下拉桿：星數＋等級說明會即時顯示，放開手＝送出（每面向一票、可改）；不熟的面向可以不評</div></div>`
    }
  }
  if (!archived && meN) s += `<div style="margin-top:6px;display:flex;justify-content:flex-end;gap:8px;align-items:center"><span class="hint">兩邊面向都評完會自動收進封存</span><button class="mini" onclick="lbSkipFn('${x.id}')">先收起</button></div>`
  s += `</div>`
  return s
}
function lbSlide(el, id, aspect, facet){
  const v = +el.value
  const sp = el.parentElement.querySelector('.lbst'); if (sp) sp.innerHTML = '★'.repeat(v)+'☆'.repeat(5-v)
  const fd = document.getElementById('fd_'+id+'_'+aspect); if (fd) fd.textContent = facet+'｜'+LVLTXT[v]
}
async function lbRate(el, id, aspect, facet){
  const stars = +el.value
  const r = await fetch('/api/mail-sync?soprate=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, aspect, facet, stars, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (!d || !d.ok) { alert((d&&d.error)||'評分失敗'); return }
  const x = (window._lbD.issues||[]).find(i=>i.id===id)
  if (x) x.stars = d.stars
  const sp = el.parentElement.querySelector('.lbst'); if (sp) sp.innerHTML = '★'.repeat(stars)+'☆'.repeat(5-stars)
  const fd = document.getElementById('fd_'+id+'_'+aspect); if (fd) fd.textContent = '✅ 已送出｜'+facet+'｜'+LVLTXT[stars]
  const meN = window._lbD.me && window._lbD.me.name
  const rl = x ? lbMyRated(x, meN) : []
  if (rl.length && rl.every(o=>o.n >= window._lbD.facets.length)) lbRender() // 全評完→自動往下封存
}
function lbSkipFn(id){ lbSkip.add(id); localStorage.setItem('lbSkip', JSON.stringify([...lbSkip])); lbRender() }
// 🛠 任務中心（張良 2026-09-24「做成跟主App任務中心一樣」：搜尋/快速新增/今日儀表板/依大項/看板/清單/各大項一眼）
let taskView = localStorage.getItem('taskView') || 'today'
let taskQ = ''
function taskVset(v){ taskView = v; localStorage.setItem('taskView', v); taskRender() }
function tkSearch(el){ taskQ = el.value; taskRender(); const el2 = document.getElementById('tkQ'); if (el2){ el2.focus(); el2.setSelectionRange(el2.value.length, el2.value.length) } }
function tkQuickKey(ev){ if (ev.isComposing || ev.keyCode === 229) return; if (ev.key === 'Enter') tkQuickAdd() } // 中文輸入法選字Enter不送出（2026-10-02 張良打到一半跑出兩筆）
async function tkQuickAdd(){
  const el = document.getElementById('tkQuick'); const v = (el&&el.value||'').trim()
  if (!v) return
  if (window._tkBusy) return; window._tkBusy = 1; setTimeout(()=>{ window._tkBusy = 0 }, 1500) // 防連點/重複送出
  const r = await fetch('/api/mail-sync?sopissue=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'new', val:{ text:v, st:'收件匣' }, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) { el.value=''; await lbFetch(); taskRender() } else alert((d&&d.error)||'新增失敗（要先綁定）')
}
function tkMini(x, meN, me){ // 小卡（今日/看板/清單共用）
  const done = x.status==='done'
  return `<div style="background:var(--card);border:1.5px solid ${x.flag?'#E8B931':done?'#BBE3CC':'var(--line)'};border-radius:10px;padding:8px 10px;font-size:14px;margin-bottom:6px">
    <div style="display:flex;gap:7px;align-items:flex-start">
      ${meN&&!done?`<input type="checkbox" style="margin-top:2px;width:15px;height:15px" onclick="this.checked=false;sopResolve('${x.id}')" title="完成（送審核）">`:(done?'<span>✅</span>':'')}
      <div style="flex:1;min-width:0"><b style="${done?'color:var(--green)':''}">${x.flag?'🚩 ':''}${x.text||'（附件）'}</b>
      <div class="hint">${x.st||''}${x.due?`・<span style="color:var(--red);font-weight:700">📅 ${x.due}</span>`:''}${x.claimBy?`・👤 ${x.claimBy}`:''}${x.status==='pending'?'・🕐 待審核':''}${(x.ck||[]).length?`・☑ ${(x.ck||[]).filter(c=>c.done).length}/${x.ck.length}`:''}</div></div>
      ${meN&&!done?`<span style="cursor:pointer" title="指派負責人" onclick="taskOwn('${x.id}')">👤</span>`:''}
    </div></div>`
}
function taskRender(){
  const d = window._lbD
  if (!d) { app.innerHTML = '<div class="err">讀不到任務資料</div>'; return }
  if (curStore !== 'task') return
  document.getElementById('upd').textContent = '任務中心' + (d.me ? '・' + d.me.name + (d.me.approver ? '（審核人）' : '') : '・未綁定（看得到；要操作先綁定）')
  const meN = d.me ? d.me.name : null // 2026-10-02 修：lb 口沒有 canEdit 欄位，之前整檔替換誤傷這行→按鈕全滅；任務操作=綁定即可
  const all0 = d.issues || []
  const q = taskQ.trim()
  const all = q ? all0.filter(x=>((x.text||'')+(x.st||'')+(x.claimBy||'')+(x.by||'')).includes(q)) : all0
  const open = all.filter(x=>x.status!=='done'), doneL = all.filter(x=>x.status==='done')
  const today = todayTpe(), md = today.slice(5)
  const isToday = x => x.due && (x.due.includes(today)||x.due.includes(md)||/今天|今日/.test(x.due))
  const isOver = x => x.due && !isToday(x) && /\d{4}-\d{2}-\d{2}/.test(x.due) && x.due.slice(0,10) < today
  const must = [...open.filter(isOver), ...open.filter(isToday)]
  const flagged = open.filter(x=>x.flag)
  const doing = open.filter(x=>x.status==='open'&&x.claimBy)
  const pend = open.filter(x=>x.status==='pending')
  const vtab = (lb,v) => `<button style="border:none;padding:6px 13px;font-size:14px;font-weight:800;cursor:pointer;${taskView===v?'background:var(--primary);color:#fff':'background:var(--card);color:var(--primary)'}" onclick="taskVset('${v}')">${lb}</button>`
  let h = `<section>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
    <h2 style="margin:0">任務中心 <span class="hint">${open.length} 件待辦・共 ${all.length} 件</span></h2>
    <input id="tkQ" value="${q.replace(/"/g,'&quot;')}" oninput="tkSearch(this)" placeholder="搜尋任務…" style="margin-left:auto;border:1px solid var(--line);border-radius:9px;padding:7px 11px;font-size:14px;width:150px">
    <span style="display:inline-flex;border:1.5px solid var(--primary);border-radius:9px;overflow:hidden">${vtab('🏠 今日','today')}${vtab('依大項','cat')}${vtab('依負責人','owner')}${vtab('看板','board')}${vtab('清單','list')}</span>
  </div>
  ${meN?`<div style="display:flex;gap:8px;margin-bottom:12px">
    <input id="tkQuick" placeholder="隨手丟一句任務…（先進收件匣，之後再整理）按 Enter 新增" onkeydown="tkQuickKey(event)" style="flex:1;border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;font-size:15px">
    <button class="mini on" style="padding:10px 18px;white-space:nowrap" onclick="taskNew()">＋ 新增</button>
  </div>`:''}`
  if (taskView === 'today') {
    const stat = (n,lb,c) => `<div style="flex:1;min-width:130px;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px 14px"><div style="font-size:24px;font-weight:900;color:${n?c:'var(--muted)'}">${n}</div><div class="hint" style="font-weight:700">● ${lb}</div></div>`
    h += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${stat(must.length,'今天必處理','var(--red)')}${stat(flagged.length,'🚩 重點','#A85C26')}${stat(doing.length,'處理中','var(--pdark)')}${stat(pend.length,'待你審核','#A85C26')}</div>`
    h += `<div style="background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px">
      <div style="font-weight:900;margin-bottom:6px;color:var(--red)">今天必處理 <span class="hint">逾期與今天到期</span></div>
      ${must.length?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">${must.map(x=>tkMini(x,meN,d.me)).join('')}</div>`:'<div class="mut" style="font-size:14px">今天沒有到期任務 🎉（卡片按 ⏰排時間 就會排進來）</div>'}
    </div>`
    // 各大項一眼
    const cats = [...new Set(all.map(x=>x.st||'一般'))]
    h += `<div style="background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:10px 12px"><div style="font-weight:900;margin-bottom:6px">各大項一眼 <span class="hint">完成度・今天・待審</span></div>`
    cats.forEach(c=>{
      const tot = all.filter(x=>(x.st||'一般')===c), dn = tot.filter(x=>x.status==='done').length
      const tdN = tot.filter(x=>x.status!=='done'&&(isToday(x)||isOver(x))).length
      const pdN = tot.filter(x=>x.status==='pending').length
      const pct = tot.length?Math.round(dn/tot.length*100):0
      h += `<div style="display:flex;gap:10px;align-items:center;padding:4px 0;font-size:14px">
        <span style="width:90px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c}</span>
        <span style="flex:1;height:8px;background:#2A3240;border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:var(--primary)"></span></span>
        <span style="width:36px;text-align:right;font-weight:800">${pct}%</span><span style="width:44px;text-align:right" class="hint">${dn}/${tot.length}</span>
        <span style="width:52px;text-align:right;${tdN?'color:var(--red);font-weight:800':''}">今天 ${tdN}</span><span style="width:52px;text-align:right;${pdN?'color:#A85C26;font-weight:800':''}">待審 ${pdN}</span></div>`
    })
    h += `</div>`
  } else if (taskView === 'cat') {
    if (!open.length) h += `<div class="mut">沒有未完成的任務——上面丟一句就建立</div>`
    else {
      const stCols = [...new Set(open.map(x=>x.st))]
      const ord = x => (x.flag?0:100) + (x.claimBy?1:2) + (x.status==='pending'?3:0)
      h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px;align-items:start">`
      stCols.forEach(st=>{
        const cards = open.filter(x=>x.st===st).sort((a,b)=>ord(a)-ord(b)||(b.ts<a.ts?-1:1))
        h += `<div style="background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:8px">
          <div style="font-weight:900;color:var(--pdark);padding:2px 6px 6px">${st} <span class="hint">${cards.length} 未結</span></div>`
        cards.forEach(x=>{ h += taskCard(x, meN, d.me) })
        if (meN) h += `<button class="mini" style="width:100%;border-style:dashed" onclick="taskNew('${st.replace(/'/g,'')}')">＋ 直接在此大項新增…</button>`
        h += `</div>`
      })
      h += `</div>`
    }
  } else if (taskView === 'owner') { // 依負責人（張良 2026-09-24）：每人一欄＋未指派
    const owners = [...new Set(open.filter(x=>x.claimBy).map(x=>x.claimBy))].sort()
    const cols = [...owners.map(o=>[`👤 ${o}`, open.filter(x=>x.claimBy===o)]), ['❔ 未指派', open.filter(x=>!x.claimBy)]]
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;align-items:start">`
    cols.forEach(([lb, arr])=>{ if (!arr.length && lb!=='❔ 未指派') return
      h += `<div style="background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:8px"><div style="font-weight:900;color:var(--pdark);padding:2px 6px 6px">${lb} <span class="hint">${arr.length}</span></div>${arr.sort((a,b)=>String(a.due||'9999').localeCompare(String(b.due||'9999'))).map(x=>tkMini(x,meN,d.me)).join('')||'<div class="mut" style="font-size:13px;padding:4px">—（卡片按 👤 指派給人）</div>'}</div>` })
    h += `</div>`
  } else if (taskView === 'board') {
    const cols = [['📥 待辦', open.filter(x=>x.status==='open'&&!x.claimBy)], ['🔧 處理中', doing], ['🕐 待審核', pend], ['✅ 已完成', doneL.slice(0,10)]]
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:start">`
    cols.forEach(([lb, arr])=>{ h += `<div style="background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:8px"><div style="font-weight:900;color:var(--pdark);padding:2px 6px 6px">${lb} <span class="hint">${arr.length}</span></div>${arr.map(x=>tkMini(x,meN,d.me)).join('')||'<div class="mut" style="font-size:13px;padding:4px">—</div>'}</div>` })
    h += `</div>`
  } else { // 清單
    const rows = [...open].sort((a,b)=>String(a.due||'9999').localeCompare(String(b.due||'9999')))
    h += rows.map(x=>tkMini(x,meN,d.me)).join('') || `<div class="mut">沒有未完成的任務</div>`
    if (doneL.length) h += `<details style="margin-top:8px"><summary class="hint" style="cursor:pointer;font-weight:800">✅ 已完成（${doneL.length}）</summary>${doneL.slice(0,20).map(x=>tkMini(x,meN,d.me)).join('')}</details>`
  }
  h += `</section>`
  app.innerHTML = h
}
function lbElapsed(at){ if(!at) return ''; const m=Math.floor((Date.now()-at)/60000); return m<60?`${m}分`:`${Math.floor(m/60)}時${m%60}分` }
function taskCard(x, meN, me){
  const stColor = x.status==='pending'?'#A85C26':'var(--red)'
  const border = x.flag?'#E8B931':x.status==='pending'?'#E8D089':'#F0B8B1'
  let s = `<div style="background:var(--card);border:1.5px solid ${border};border-radius:10px;padding:9px 10px;margin-bottom:8px;font-size:14px">
    <div><b style="color:${stColor}">${x.flag?'🚩 ':''}${x.status==='pending'?'🕐':'⚠️'} ${x.text||'（附件）'}</b>${(x.media||[]).map((m,i)=>` <a href="${m}" target="_blank">📎${i+1}</a>`).join('')}</div>
    <div class="hint">發現：${x.by}・${x.ts}</div>`
  if (x.pub==='pending') s += `<div style="color:#A85C26;font-weight:800;font-size:13px">🕐 等確認發布（還沒進群）</div>`
  if (x.pub==='hold') s += `<div class="hint" style="font-weight:700">📥 保留中（不進群）</div>`
  if (x.due) s += `<div class="hint" style="color:#A85C26;font-weight:700">⏰ 排定：${x.due}</div>`
  if (x.status==='open' && x.claimBy) s += `<div style="color:var(--pdark);font-weight:800">🔧 ${x.claimBy} 處理中・已 ${lbElapsed(x.claimAt)}</div>`
  if (x.status==='pending') s += `<div style="color:#A85C26;font-weight:700">🕐 ${x.doneBy} 已處理・等審核</div>`
  // 📝 階段性 checklist（文字＋圖片；張良 2026-09-22）
  const ck = x.ck||[]
  if (ck.length || meN) {
    const dn = ck.filter(c=>c.done).length
    s += `<div style="margin-top:6px;border-top:1px dashed var(--line);padding-top:5px">`
    if (ck.length) s += `<div style="font-size:13px;font-weight:800">📝 步驟 ${dn}/${ck.length}</div>`
    ck.forEach(c=>{ s += `<div style="display:flex;gap:6px;align-items:flex-start;font-size:14px;padding:2px 0">
      ${meN?`<input type="checkbox" ${c.done?'checked':''} style="margin-top:2px" onclick="ckOp('${x.id}','cktog','${c.id}')">`:(c.done?'☑':'☐')}
      <span style="flex:1;${c.done?'text-decoration:line-through;color:var(--muted)':''}">${(c.t||'').replace(/</g,'&lt;')}${c.img?` <a href="${c.img}" target="_blank">📎圖</a>`:''}${c.done&&c.doneBy?` <span class="hint">${c.doneBy}</span>`:''}</span>
      ${meN?`<button class="mini" style="padding:1px 6px;color:var(--red)" onclick="if(confirm('刪除這個步驟？'))ckOp('${x.id}','ckdel','${c.id}')">✕</button>`:''}
    </div>` })
    if (meN) s += `<button class="mini" onclick="ckAdd('${x.id}')">＋ 加步驟</button>`
    s += `</div>`
  }
  if (meN) {
    s += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">`
    if (x.status==='open' && !x.claimBy) s += `<button class="mini on" onclick="lbOp('${x.id}','claim')">🙋 我來解決</button>`
    if (x.status==='open' && x.claimBy===meN) s += `<button class="mini on" onclick="sopResolve('${x.id}')">✅ 解決了</button><button class="mini" onclick="lbOp('${x.id}','unclaim')">放棄</button>`
    if (x.status==='open' && x.claimBy && x.claimBy!==meN) s += `<button class="mini" onclick="sopResolve('${x.id}')">✅ 已解決</button>`
    if (x.status==='open' && !x.claimBy) s += `<button class="mini" onclick="sopResolve('${x.id}')">✅ 已解決</button>`
    if (x.status==='pending' && me && me.approver) s += `<button class="mini on" onclick="sopReview('${x.id}',1)">✅ 核准</button><button class="mini" style="color:var(--red)" onclick="sopReview('${x.id}',0)">↩︎ 退回</button>`
    if ((x.pub==='pending'||x.pub==='hold') && me && me.approver) s += `${x.pub!=='hold'?'':''}<button class="mini on" onclick="lbOp('${x.id}','pub','go')">📣 發布</button>${x.pub==='pending'?`<button class="mini" onclick="lbOp('${x.id}','pub','hold')">📥 保留</button>`:''}<button class="mini" style="color:var(--red)" onclick="if(confirm('刪除這筆回報？'))lbOp('${x.id}','pub','del')">🗑 刪除</button>`
    s += `<button class="mini" onclick="lbOp('${x.id}','flag',${x.flag?0:1})">${x.flag?'取消🚩':'🚩標記'}</button><button class="mini" onclick="lbDue('${x.id}','${(x.due||'').replace(/'/g,'')}')">⏰排時間</button><button class="mini" onclick="taskOwn('${x.id}')">👤負責人</button>`
    s += `</div>`
  }
  s += `</div>`
  return s
}
let ckFile = null
function ckAdd(id){
  ckFile = null
  const ov = document.createElement('div'); ov.id='ckOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:420px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">📝 加一個步驟</div>
    <textarea id="ckTxt" rows="2" placeholder="這一步要做什麼？" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;font-family:inherit"></textarea>
    <div id="ckImgName" class="hint" style="margin:6px 0"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:8px">
      <button class="mini" style="padding:9px 12px" onclick="ckPick()">📷 加圖片</button>
      <span><button class="mini" style="padding:9px 12px" onclick="document.getElementById('ckOv').remove()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="ckSend('${id}')">加入</button></span>
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function ckPick(){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'
  inp.onchange = () => { ckFile = inp.files[0]||null; const el=document.getElementById('ckImgName'); if(el&&ckFile) el.textContent='📎 '+(ckFile.name||'圖片').slice(0,30) }
  inp.click()
}
async function ckSend(id){
  const t2 = (document.getElementById('ckTxt')||{}).value||''
  if (!t2.trim() && !ckFile) { alert('寫一下這一步要做什麼'); return }
  document.querySelectorAll('#ckOv button').forEach(b=>b.disabled=true)
  let img = ''
  if (ckFile) {
    try {
      const ext = ((ckFile.name||'').split('.').pop()||'jpg').toLowerCase()
      const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ext }) })
      const sd = await sr.json()
      if (sd && sd.ok) { const ur = await fetch(sd.uploadUrl, { method:'PUT', headers:{'content-type': ckFile.type||'image/jpeg'}, body: ckFile }); if (ur.ok) img = sd.publicUrl }
    } catch(e){}
  }
  const o = document.getElementById('ckOv'); if (o) o.remove()
  ckOp(id, 'ckadd', { t: t2.trim(), img })
}
async function ckOp(id, op, val){
  const r = await fetch('/api/mail-sync?sopissue=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, op, val, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (!d || !d.ok) { alert((d&&d.error)||'失敗'); return }
  const x = (window._lbD && window._lbD.issues||[]).find(i=>i.id===id)
  if (x && d.issue) Object.assign(x, d.issue)
  curStore==='task' ? taskRender() : lbRender()
}
async function lbOp(id, op, val){
  const r = await fetch('/api/mail-sync?sopissue=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, op, val, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) refreshView(); else alert((d&&d.error)||'失敗')
}
function lbDue(id, cur){
  const v = prompt('排定處理時間（自由填，例：今天16:00前／9-22 中午；留空=清除）', cur||'')
  if (v === null) return
  lbOp(id, 'due', v.trim())
}
