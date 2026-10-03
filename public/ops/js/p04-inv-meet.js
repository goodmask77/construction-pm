// ⚠️ 這是 /prep 主程式的第 4/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：盤點包材+採購+打卡+會議
// ── 🥩 盤點 / 📦 包材（品項自建＋盤點紀錄＋照銷售自動扣＋低水位；張良 2026-09-21）──
async function invLoad(kind){
  curStore = kind; setTabs(kind)
  if (!window._invD || window._invD.kind !== kind) { const c = tcGet('inv_'+kind); if (c) window._invD = c }
  if (window._invD && window._invD.kind === kind) invRender(); else app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?inv=' + encodeURIComponent(K) + '&kind=' + kind + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (!d || !d.ok) { if (!window._invD) app.innerHTML = '<div class="err">讀不到資料</div>'; return }
  window._invD = d; tcSet('inv_'+kind, d)
  if (curStore === kind) invRender()
}
function invRender(){
  const d = window._invD; if (!d || (curStore !== 'food' && curStore !== 'pack')) return
  const lbl = d.kind === 'pack' ? '包材' : '食材'
  document.getElementById('upd').textContent = `${d.kind==='pack'?'📦':'🥩'} ${lbl}盤點・預估現量＝最後盤點 − 盤後銷售×每份用量`
  const meN = d.me ? d.me.name : null // 2026-10-02 全面修：只有菜單口有 canEdit 欄位，整檔替換誤傷各分頁→按鈕全滅；顯示層=綁定即可，真正權限由伺服器端守門
  const lows = d.items.filter(x => x.low)
  let h = ''
  if (lows.length) h += `<section style="border:1.5px solid #F0B8B1"><h2 style="color:var(--red)">📉 低水位警報（${lows.length}）</h2>` + lows.map(x=>`<div style="font-weight:800;color:var(--red)">・${x.name}：估剩 ${x.est}${x.unit||''}（低標 ${x.min}）</div>`).join('') + `<div class="hint" style="margin-top:4px">每天開店前 DD 也會在群裡提醒</div></section>`
  h += `<section><h2>${d.kind==='pack'?'📦':'🥩'} ${lbl}清單 <span class="hint">${meN?'📋盤點＝輸入現在數量；✏️可改品項/用量連結':''}</span></h2>`
  if (!d.items.length) h += `<div class="mut">還沒有品項——按下面「＋新增品項」開始建（名稱／單位／最低水位／連結哪些菜品扣多少）</div>`
  else {
    h += `<div class="scroll"><table><thead><tr><th style="text-align:left">品項</th><th>預估現量</th><th>低標</th><th>已扣銷售</th><th style="text-align:left">最後盤點</th><th></th></tr></thead><tbody>`
    d.items.forEach(x=>{
      h += `<tr>
        <td style="text-align:left;font-weight:800;color:var(--ink)">${x.low?'📉 ':''}${x.name}<div class="hint">${(x.links||[]).map(l=>`${l.type==='cat'?'類:':''}${l.key}×${l.per}`).join('、')||'（沒設銷售連結，不會自動扣）'}</div></td>
        <td style="font-weight:900;font-size:15px;color:${x.low?'var(--red)':'var(--pdark)'}">${x.est!=null?x.est:'—'}${x.unit||''}</td>
        <td>${x.min||'—'}</td><td class="mut">${x.used!=null?x.used:'—'}</td>
        <td style="text-align:left" class="hint">${x.last?`${x.last.qty}${x.unit||''}・${x.last.ts}<br>${x.last.by}`:'還沒盤過'}</td>
        <td>${meN?`<button class="mini on" onclick="invCount('${x.id}','${x.name.replace(/'/g,'')}')">📋 盤點</button><button class="mini" onclick="invEdit('${x.id}')">✏️</button>`:''}</td></tr>`
    })
    h += `</tbody></table></div>`
  }
  if (meN) h += `<div style="margin-top:10px"><button class="mini on" style="padding:8px 16px" onclick="invEdit(null)">＋ 新增品項</button></div>`
  h += `<div class="hint" style="margin-top:8px">盤點時機：開店前盤＝當天銷售會繼續扣；打烊後盤＝從隔天開始扣（系統照盤點時間自動判斷）。</div></section>`
  app.innerHTML = h
}
async function invCount(id, name){
  const v = prompt(`「${name}」現在實際數量？（純數字）`)
  if (v === null) return
  const qv = Number(v)
  if (isNaN(qv) || qv < 0) { alert('請輸入數字'); return }
  const r = await fetch('/api/mail-sync?invcount=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ kind: window._invD.kind, id, qty: qv, token: TK() }) })
  const dd = await r.json().catch(()=>null)
  if (dd && dd.ok) invLoad(window._invD.kind); else alert((dd&&dd.error)||'失敗')
}
function invEdit(id){
  const d = window._invD
  const it = id ? d.items.find(x=>x.id===id) : { name:'', unit:'', min:0, links:[] }
  let menuNames = [], catNames = []
  try { const c = JSON.parse(localStorage.getItem('obc_ground')||'null'); if (c) { catNames = c.cats.map(x=>x.name); menuNames = c.cats.flatMap(x=>x.items.map(i=>i.n)) } } catch(e){}
  const ov = document.createElement('div'); ov.id='invOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.5);z-index:50;display:flex;align-items:center;justify-content:center;padding:14px;overflow:auto'
  const linkRow = (l) => `<div class="invLink" style="display:flex;gap:4px;margin-bottom:4px;align-items:center">
    <select class="lt" style="border:1px solid var(--line);border-radius:7px;padding:5px"><option value="item"${l&&l.type!=='cat'?' selected':''}>菜品</option><option value="cat"${l&&l.type==='cat'?' selected':''}>品類</option></select>
    <input class="lk" list="menuDL" value="${l?l.key:''}" placeholder="名稱（可挑選）" style="flex:1;min-width:100px;border:1px solid var(--line);border-radius:7px;padding:5px">
    <input class="lp" type="number" step="0.1" value="${l?l.per:''}" placeholder="每份用量" style="width:82px;border:1px solid var(--line);border-radius:7px;padding:5px">
    <button class="mini" onclick="this.parentElement.remove()">刪</button></div>`
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:470px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">${id?'✏️ 編輯':'＋ 新增'}${d.kind==='pack'?'包材':'食材'}品項</div>
    <datalist id="menuDL">${[...catNames,...menuNames].map(n=>`<option value="${n}">`).join('')}</datalist>
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <input id="ivName" value="${it.name}" placeholder="名稱（例：無骨雞腿）" style="flex:1;min-width:120px;border:1px solid var(--line);border-radius:8px;padding:7px">
      <input id="ivUnit" value="${it.unit||''}" placeholder="單位" style="width:62px;border:1px solid var(--line);border-radius:8px;padding:7px">
      <input id="ivMin" type="number" value="${it.min||''}" placeholder="低標" style="width:62px;border:1px solid var(--line);border-radius:8px;padding:7px">
    </div>
    <div style="font-size:13px;font-weight:700;margin-bottom:4px">銷售連結（每賣一份要扣多少）：</div>
    <div id="ivLinks">${(it.links||[]).map(linkRow).join('')}</div>
    <button class="mini" onclick="document.getElementById('ivLinks').insertAdjacentHTML('beforeend', window._invLinkRow())">＋ 加連結</button>
    <div style="display:flex;justify-content:space-between;margin-top:12px;flex-wrap:wrap;gap:6px">
      <span>${id?`<button class="mini" style="color:var(--red)" onclick="invDel('${id}')">🗑 刪除品項</button>`:''}</span>
      <span><button class="mini" onclick="document.getElementById('invOv').remove()">取消</button>
      <button class="mini on" style="padding:8px 16px" onclick="invSave('${id||''}')">💾 儲存</button></span>
    </div></div>`
  window._invLinkRow = () => linkRow(null)
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function invSave(id){
  const links = [...document.querySelectorAll('#invOv .invLink')].map(r=>({ type: r.querySelector('.lt').value, key: r.querySelector('.lk').value.trim(), per: Number(r.querySelector('.lp').value)||0 })).filter(l=>l.key&&l.per>0)
  const item = { id: id||undefined, name: document.getElementById('ivName').value.trim(), unit: document.getElementById('ivUnit').value.trim(), min: Number(document.getElementById('ivMin').value)||0, links }
  if (!item.name) { alert('要有名稱'); return }
  const r = await fetch('/api/mail-sync?invset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ kind: window._invD.kind, op:'save', item, token: TK() }) })
  const dd = await r.json().catch(()=>null)
  if (dd && dd.ok) { document.getElementById('invOv').remove(); invLoad(window._invD.kind) } else alert((dd&&dd.error)||'失敗')
}
async function invDel(id){
  if (!confirm('刪除這個品項？（盤點紀錄一併看不到）')) return
  const r = await fetch('/api/mail-sync?invset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ kind: window._invD.kind, op:'del', id, token: TK() }) })
  const dd = await r.json().catch(()=>null)
  if (dd && dd.ok) { document.getElementById('invOv').remove(); invLoad(window._invD.kind) } else alert((dd&&dd.error)||'失敗')
}
// ── 🛒 採購需求（張良 2026-09-21：大家隨時提要買的東西，附圖片＆連結；DD通知群、可標已購買）──
async function buyLoad(){
  curStore = 'buy'; setTabs('buy')
  if (!window._buyD) { const c = tcGet('buy'); if (c) window._buyD = c }
  if (window._buyD) buyRender(); else app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?buy=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (!d || !d.ok) { if (!window._buyD) app.innerHTML = '<div class="err">讀不到資料</div>'; return }
  window._buyD = d; tcSet('buy', d)
  if (curStore === 'buy') buyRender()
}
function buyRender(){
  const d = window._buyD; if (!d || curStore !== 'buy') return
  document.getElementById('upd').textContent = '採購・提需求 → 已購買 → 收貨拍照'
  const meN = d.me ? d.me.name : null // 2026-10-02 全面修：只有菜單口有 canEdit 欄位，整檔替換誤傷各分頁→按鈕全滅；顯示層=綁定即可，真正權限由伺服器端守門
  const stOf = x => x.status==='done' ? 'bought' : x.status // 舊資料 done=已購買(待收貨)
  const open = d.list.filter(x=>stOf(x)==='open'), bought = d.list.filter(x=>stOf(x)==='bought'), recvd = d.list.filter(x=>stOf(x)==='received')
  const thumbs = (arr) => (arr||[]).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">${arr.map(m=>`<img src="${m}" style="width:58px;height:58px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer" onclick="imgView('${m}')">`).join('')}</div>` : ''
  const card = x => { const st = stOf(x)
    const bc = st==='received'?'#BBE3CC':st==='bought'?'#E8D089':'var(--line)'
    const ic = st==='received'?'✅':st==='bought'?'📦':'🛒'
    return `<div style="background:var(--card);border:1.5px solid ${bc};border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:14px">
    <div style="font-weight:800;color:${st==='received'?'var(--green)':st==='bought'?'#A85C26':'var(--ink)'}">${ic} ${x.text||'（附件）'}${meN?` <span style="cursor:pointer;font-size:13px" class="hint" onclick="buyCat('${x.id}','${(x.cat||'').replace(/'/g,'')}')">🏷${x.cat||'設分類'}</span>`:(x.cat?` <span class="hint" style="font-size:13px">🏷${x.cat}</span>`:'')}</div>
    <div class="hint">${x.by}・${x.ts}${x.url?` <a href="${x.url}" target="_blank">🔗 連結</a>`:''}</div>
    ${thumbs(x.media)}
    ${st!=='open'?`<div class="hint" style="color:#A85C26;font-weight:700">🛍 已購買・${x.doneBy||''}・${x.doneTs||''}</div>`:''}
    ${st==='received'?`<div class="hint" style="color:var(--green);font-weight:700">📬 已收貨・${x.recvBy}・${x.recvTs}</div>${thumbs(x.recvMedia)}`:''}
    ${meN?`<div style="margin-top:5px">${st==='open'?`<button class="mini on" onclick="buyOp('${x.id}','done')">✅ 已購買</button>`:''}${st==='bought'?`<button class="mini on" onclick="buyRecv('${x.id}')">📬 確認收貨（拍照）</button><button class="mini" onclick="buyOp('${x.id}','undone')">↩︎ 還沒買</button>`:''}${(d.me.approver||x.by===meN)?`<button class="mini" style="color:var(--red)" onclick="if(confirm('刪除這筆需求？'))buyOp('${x.id}','del')">🗑</button>`:''}</div>`:''}
  </div>` }
  let h = `<section><h2>待採購（${open.length}） <span class="hint"></span></h2>
    <div style="margin-bottom:10px"><button class="mini on" style="padding:9px 18px" onclick="buyNew()">＋ 我要提需求</button></div>`
  if (open.length) { // 按分類分組（張良 2026-09-22）
    const catsB = [...new Set(open.map(x=>x.cat||'未分類'))]
    catsB.forEach(cb=>{
      if (catsB.length>1 || cb!=='未分類') h += `<div style="font-weight:900;color:var(--pdark);margin:10px 0 4px">🏷 ${cb}（${open.filter(x=>(x.cat||'未分類')===cb).length}）</div>`
      h += open.filter(x=>(x.cat||'未分類')===cb).map(card).join('')
    })
  } else h += '<div class="mut">目前沒有待採購——缺什麼按上面提出來</div>'
  h += `</section>`
  // 待收貨（張良 2026-09-22：已購買的在這等收貨——收的人按確認+拍照，記日期時間）
  h += `<section><h2>待收貨（${bought.length}）</h2>${bought.length?bought.map(card).join(''):'<div class="mut">沒有在途的採購</div>'}</section>`
  if (recvd.length) h += `<section><details><summary style="font-weight:900;cursor:pointer">已收貨（${recvd.length}）</summary><div style="margin-top:8px">${recvd.slice(0,30).map(card).join('')}</div></details></section>`
  app.innerHTML = h
}
// 📬 確認收貨：拍照必附＋日期時間自動記
let recvFiles = []
function buyRecv(id){
  recvFiles = []
  const ov = document.createElement('div'); ov.id='rcvOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:400px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">📬 確認收貨</div>
    <div class="hint" style="margin-bottom:8px">拍一張收到的貨（必拍）——會記你的名字＋日期時間</div>
    <div id="rcvList" class="hint" style="margin:6px 0"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:8px">
      <button class="mini" style="padding:9px 12px" onclick="recvPick()">📷 拍照/選圖</button>
      <span><button class="mini" style="padding:9px 12px" onclick="document.getElementById('rcvOv').remove()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="recvSend('${id}')">確認收貨</button></span>
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function recvPick(){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.multiple=true
  inp.onchange = () => { recvFiles = [...recvFiles, ...inp.files].slice(0,4); const el=document.getElementById('rcvList'); if(el) el.innerHTML = recvFiles.map((f,i)=>`📎 ${(f.name||'照'+(i+1)).slice(0,28)}`).join('<br>') }
  inp.click()
}
async function recvSend(id){
  if (!recvFiles.length) { alert('收貨要拍照存證'); return }
  document.querySelectorAll('#rcvOv button').forEach(b=>b.disabled=true)
  const media = []
  for (const f of recvFiles) {
    try {
      const ext = ((f.name||'').split('.').pop()||'jpg').toLowerCase()
      const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ext }) })
      const sd = await sr.json()
      if (sd && sd.ok) { const ur = await fetch(sd.uploadUrl, { method:'PUT', headers:{'content-type': f.type||'image/jpeg'}, body: f }); if (ur.ok) media.push(sd.publicUrl) }
    } catch(e){}
  }
  const o = document.getElementById('rcvOv'); if (o) o.remove()
  if (!media.length) { alert('照片上傳失敗，再試一次'); return }
  const r = await fetch('/api/mail-sync?buyop=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, op:'recv', media, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) buyLoad(); else alert((d&&d.error)||'失敗')
}
let buyFiles = []
function buyNew(){
  buyFiles = []
  const ov = document.createElement('div'); ov.id='buyOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:430px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">🛒 提出採購需求</div>
    <textarea id="buyTxt" rows="2" placeholder="要買什麼？（品名/規格/數量）" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;font-family:inherit"></textarea>
    <input id="buyUrl" placeholder="商品連結（選填，貼網址）" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px;margin-top:6px">
    <input id="buyCatIn" list="buyCats" placeholder="分類（選填，例：包材/器具/設備）" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px;margin-top:6px"><datalist id="buyCats">${[...new Set(((window._buyD||{}).list||[]).map(x=>x.cat).filter(Boolean))].map(c=>`<option>${c}</option>`).join('')}</datalist>
    <div id="buyList" class="hint" style="margin:6px 0"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:8px;flex-wrap:wrap">
      <button class="mini" style="padding:9px 12px" onclick="buyPick()">📷 加圖片</button>
      <span><button class="mini" style="padding:9px 12px" onclick="document.getElementById('buyOv').remove()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="buySend()">送出</button></span>
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function buyPick(){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.multiple=true
  inp.onchange = () => { buyFiles = [...buyFiles, ...inp.files].slice(0,6); const el=document.getElementById('buyList'); if(el) el.innerHTML = buyFiles.map((f,i)=>`📎 ${(f.name||'圖'+(i+1)).slice(0,28)}`).join('<br>') }
  inp.click()
}
async function buySend(){
  const text = (document.getElementById('buyTxt')||{}).value||''
  const url = (document.getElementById('buyUrl')||{}).value||''
  if (!text.trim() && !buyFiles.length) { alert('至少寫要買什麼'); return }
  document.querySelectorAll('#buyOv button').forEach(b=>b.disabled=true)
  const media = []
  for (const f of buyFiles) {
    try {
      const ext = ((f.name||'').split('.').pop()||'jpg').toLowerCase()
      const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ext }) })
      const sd = await sr.json()
      if (sd && sd.ok) { const ur = await fetch(sd.uploadUrl, { method:'PUT', headers:{'content-type': f.type||'image/jpeg'}, body: f }); if (ur.ok) media.push(sd.publicUrl) }
    } catch(e){}
  }
  if (!TK()) { alert('請先登入：按右上「登入」→ 私訊 DD「登入碼」→ 填入 4 個數字（或點 DD 給的個人連結）'); return }
  const by = ''
  const cat = (document.getElementById('buyCatIn')||{}).value||''
  const r = await fetch('/api/mail-sync?buyadd=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text, url, media, by, cat, token: TK() }) })
  const d = await r.json().catch(()=>null)
  const o = document.getElementById('buyOv'); if (o) o.remove()
  if (d && d.ok) { buyLoad() } else alert((d&&d.error)||'送出失敗')
}
function buyCat(id, cur){
  const v = prompt('分類（例：包材／器具／設備；留空=清除）', cur||'')
  if (v == null) return
  fetch('/api/mail-sync?buyop=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, op:'cat', val: v.trim(), token: TK() }) })
    .then(r=>r.json()).then(d2=>{ if(d2&&d2.ok) buyLoad(); else alert((d2&&d2.error)||'失敗') })
}
async function buyOp(id, op){
  const r = await fetch('/api/mail-sync?buyop=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, op, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) buyLoad(); else alert((d&&d.error)||'失敗')
}
// ── ⏰ 打卡（張良 2026-09-22：/prep 一鍵打卡，寫進既有出勤系統法定逐筆檔；自動判上下班、5分內可修方向）──
let _lastPunch = null
async function punchNow(){
  if (!TK()) { alert('要先登入才能打卡：按右上「登入」→ 私訊 DD「登入碼」→ 填入 4 個數字'); return }
  if (_lastPunch && Date.now() - _lastPunch.at < 5*60000) {
    if (confirm(`剛剛 ${_lastPunch.hm} 打了「${_lastPunch.dir==='in'?'上班':'下班'}」卡。\n\n確定＝修正方向（打錯了）\n取消＝不動作`)) {
      const r = await fetch('/api/mail-sync?punchfix=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK() }) })
      const d = await r.json().catch(()=>null)
      if (d && d.ok) { _lastPunch.dir = d.dir; alert(`已改成「${d.dir==='in'?'上班':'下班'}」`) } else alert((d&&d.error)||'修正失敗，找管理員處理')
    }
    return
  }
  if (!confirm('現在打卡？（自動判斷上班/下班）')) return
  const r = await fetch('/api/mail-sync?punchme=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (!d || !d.ok) { alert((d&&d.error)||'打卡失敗'); return }
  const hm = new Date(d.ts).toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Taipei'}).slice(0,5)
  _lastPunch = { at: Date.now(), dir: d.dir, hm }
  alert(`${d.name}「${d.dir==='in'?'上班':'下班'}」打卡 ${hm}${d.dir==='out'?`・今天累計 ${d.todayHours} 小時`:''}\n（打錯方向？5 分鐘內再按一次右上角打卡鈕可以修正）`)
}
// ── 📋 會議（張良 2026-09-22：班前會議/營運會議紀錄——類型可自訂、紀錄可新增刪改，全留姓名時間）──
function todayTpe(){ return new Date(Date.now()+8*3600e3).toISOString().slice(0,10) }
async function meetLoad(){
  curStore = 'meet'; setTabs('meet')
  if (!window._meetD) { const c = tcGet('meet'); if (c) window._meetD = c }
  if (window._meetD) meetRender(); else app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?meet=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (!d || !d.ok) { if (!window._meetD) app.innerHTML = '<div class="err">讀不到資料</div>'; return }
  window._meetD = d; tcSet('meet', d)
  if (curStore === 'meet') meetRender()
}
function meetRender(){
  const d = window._meetD; if (!d || curStore !== 'meet') return
  document.getElementById('upd').textContent = '會議紀錄'
  const meN = d.me ? d.me.name : null // 2026-10-02 全面修：只有菜單口有 canEdit 欄位，整檔替換誤傷各分頁→按鈕全滅；顯示層=綁定即可，真正權限由伺服器端守門
  // v4.16.0 宣達簽收（張良：條列+全員簽收+發問串+附件連結+🔗）
  const canAns = d.me && (d.me.approver || d.me.role === '主管')
  const mc = x => {
    const ver = x.ver || 1
    const names = x.ackNames || d.regNames || []
    const acked = Object.entries(x.acks||{}).filter(([,v])=>v && v.ver===ver).map(([n])=>n)
    const missing = names.filter(n=>!acked.includes(n))
    const itemsX = (x.items && x.items.length) ? x.items : String(x.text||'').split('\n').map(t=>t.trim()).filter(Boolean).map((t,i)=>({id:'tx'+i,t}))
    const myRow = meN && names.includes(meN)
    const myAck = meN && acked.includes(meN)
    const lnk = l => { const inT = /^https?:\/\/[^/]*ground-pm|^\/prep|^#/.test(l.url); const href = l.url.startsWith('#') ? ('/prep'+l.url) : l.url
      return `<a href="${href}" ${inT?'':'target="_blank"'} onclick="meetMop({op:'view',id:'${x.id}'},1)" style="color:var(--primary);font-weight:700;margin-right:10px">🔗 ${l.label||l.url.slice(0,40)}</a>` }
    return `<div id="mt-${x.id}" style="background:var(--card);border:1.5px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:14px">
    <div style="font-weight:800;display:flex;gap:8px;align-items:center">${x.date}${ver>1?` <span style="color:#E8A657;font-size:12px;font-weight:800">v${ver} 已改版要重簽</span>`:''}<span class="lnkbtn" title="複製這則連結" onclick="copyLink('#meet=${x.id}')">🔗</span></div>
    ${itemsX.length?`<table style="width:100%;border-collapse:collapse;margin:5px 0">${itemsX.map((it2,i)=>`<tr><td style="border:1px solid var(--line);padding:5px 8px;width:30px;text-align:center;color:var(--muted);font-weight:800">${i+1}</td><td style="border:1px solid var(--line);padding:5px 8px;text-align:left">${String(it2.t).replace(/</g,'&lt;')}</td></tr>`).join('')}</table>`:''}
    ${(x.media||[]).length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">${x.media.map(u=>`<a href="${u}" target="_blank" onclick="meetMop({op:'view',id:'${x.id}'},1)"><img src="${u}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" onerror="this.outerHTML='📎 附件'"></a>`).join('')}</div>`:''}
    ${(x.links||[]).length?`<div style="margin:4px 0">${x.links.map(lnk).join('')}</div>`:''}
    ${names.length?`<div style="margin:6px 0 2px;font-size:13px"><b style="color:${missing.length?'var(--red)':'var(--green)'}">✅ 已熟知 ${acked.length}/${names.length}</b>${missing.length?`　<span style="color:var(--red)">未簽：${missing.join('、')}</span>`:' 🎉 全員完成'}</div>`:''}
    ${myRow?(myAck?`<div style="color:var(--green);font-weight:800;font-size:13px">✓ 你已簽收（${(x.acks[meN]||{}).ts||''}）</div>`:`<button class="mini on" style="padding:8px 16px;margin:3px 0" onclick="ackWin('${x.id}')">📩 我讀完了（簽收）</button>`):''}
    ${(x.asks||[]).length?`<div style="margin-top:6px;border-top:1px dashed var(--line);padding-top:5px">${x.asks.map(a2=>`<div style="font-size:13px;margin-bottom:4px"><b>❓ ${String(a2.q).replace(/</g,'&lt;')}</b> <span class="hint">${a2.by}・${a2.ts}</span>${a2.ans?`<div style="color:var(--pdark)">💬 ${String(a2.ans).replace(/</g,'&lt;')} <span class="hint">${a2.ansBy}・${a2.ansTs}</span></div>`:(canAns?` <button class="mini" style="padding:4px 10px" onclick="meetAnswer('${x.id}','${a2.id}')">回覆</button>`:' <span class="hint">（等回覆）</span>')}</div>`).join('')}</div>`:''}
    <div class="hint" style="margin-top:3px">${x.by}・${x.ts}${x.editedBy?`・改：${x.editedBy} ${x.editedTs}`:''}</div>
    ${meN?`<div style="margin-top:5px"><button class="mini" onclick="meetForm('${x.id}')">✏️ 編輯</button> <button class="mini" style="color:var(--red)" onclick="if(confirm('刪除這筆會議紀錄？'))meetOp('del','${x.id}')">🗑</button></div>`:''}
  </div>` }
  let h = `<section><h2>會議紀錄 <span class="hint">${meN?'':'看得到；要新增/編輯先綁定——'+BIND_HINT}</span></h2>
    ${meN?`<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="mini on" style="padding:9px 18px" onclick="meetForm()">＋ 新增紀錄</button><button class="mini" style="padding:9px 12px" onclick="meetTypes()">⚙️ 會議類型</button></div>`:''}`
  for (const tp of d.types) {
    const rows = d.list.filter(x => x.type === tp)
    h += `<div style="font-weight:900;margin:12px 0 6px;color:var(--pdark)">${tp}（${rows.length}）</div>`
    h += rows.length ? rows.map(mc).join('') : `<div class="mut" style="font-size:14px;margin-bottom:6px">還沒有紀錄</div>`
  }
  const orphan = d.list.filter(x => !d.types.includes(x.type))
  if (orphan.length) h += `<div style="font-weight:900;margin:12px 0 6px">其他（${orphan.length}）</div>` + orphan.map(mc).join('')
  h += `</section>`
  app.innerHTML = h
}
function meetForm(id){
  const d = window._meetD, it = id ? d.list.find(x=>x.id===id) : null
  const ov = document.createElement('div'); ov.id='meetOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  const ip = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:15px;font-family:inherit;margin-bottom:6px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:460px;width:100%;padding:16px;max-height:86vh;overflow:auto" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">${it?'✏️ 編輯':'📋 新增'}會議紀錄</div>
    <select id="mtType" style="${ip}">${d.types.map(t2=>`<option${it&&it.type===t2?' selected':''}>${t2}</option>`).join('')}</select>
    <input id="mtDate" type="date" value="${it?it.date:todayTpe()}" style="${ip}">
    <textarea id="mtText" rows="7" placeholder="一行＝一條（會自動變成條列表格）" style="${ip}">${it?(it.text||'').replace(/</g,'&lt;'):''}</textarea>
    <div class="hint" style="margin:-2px 0 4px">📎 附照片：<input type="file" id="mtFile" accept="image/*" multiple style="font-size:13px" onchange="mtUpload(this.files)"><span id="mtUpN">${it&&(it.media||[]).length?`已有 ${it.media.length} 張`:''}</span></div>
    <textarea id="mtLinks" rows="2" placeholder="連結（一行一個：標題|網址，或直接貼網址；SOP連結用每條旁的複製鈕來貼）" style="${ip}">${it?(it.links||[]).map(l2=>l2.label?`${l2.label}|${l2.url}`:l2.url).join('\n'):''}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('meetOv').remove()">取消</button>
    <button class="mini on" style="padding:9px 18px" onclick="meetSave('${id||''}')">儲存</button></div></div>`
  ov.onclick = () => ov.remove()
  window._mtMedia = it ? [...(it.media||[])] : []
  document.body.appendChild(ov)
}
async function mtUpload(files){ // 📎 宣達附照（sopsign 簽名直傳，與回報同管道）
  const nEl = document.getElementById('mtUpN'); if (nEl) nEl.textContent = '上傳中…'
  for (const f of files) {
    try {
      const ext = ((f.name||'').split('.').pop()||'jpg').toLowerCase()
      const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ext }) })
      const sd = await sr.json()
      if (!sd || !sd.ok) continue
      const ur = await fetch(sd.uploadUrl, { method:'PUT', headers:{'content-type': f.type||'application/octet-stream'}, body: f })
      if (ur.ok) window._mtMedia.push(sd.publicUrl)
    } catch(e){}
  }
  if (nEl) nEl.textContent = `已附 ${window._mtMedia.length} 張 ✓`
}
async function meetSave(id){
  const type = (document.getElementById('mtType')||{}).value||''
  const date = (document.getElementById('mtDate')||{}).value||''
  const text = (document.getElementById('mtText')||{}).value||''
  if (!text.trim()) { alert('內容空的'); return }
  const links = ((document.getElementById('mtLinks')||{}).value||'').split('\n').map(x=>x.trim()).filter(Boolean).map(x=>{ const i2 = x.indexOf('|'); return i2>0 ? { label: x.slice(0,i2).trim(), url: x.slice(i2+1).trim() } : { label:'', url: x } })
  const r = await fetch('/api/mail-sync?meetset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op: id?'edit':'add', id, type, date, text, media: window._mtMedia||[], links, token: TK() }) })
  const d = await r.json().catch(()=>null)
  const o = document.getElementById('meetOv'); if (o) o.remove()
  if (d && d.ok) meetLoad(); else alert((d&&d.error)||'儲存失敗')
}
// ── v4.16.0 簽收/發問/回覆 ──
async function meetMop(body, silent){
  const r = await fetch('/api/mail-sync?meetset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...body, token: TK() }) }).catch(()=>null)
  if (silent) return
  const d = r && await r.json().catch(()=>null)
  if (d && d.ok) meetLoad(); else alert((d&&d.error)||'失敗')
}
function ackWin(id){
  const ov = document.createElement('div'); ov.id='akOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:65;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(340px,92vw);padding:18px" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px;margin-bottom:12px">這則宣達你都清楚了嗎？</div>
    <button class="mini on" style="width:100%;padding:12px;font-size:15px;margin-bottom:8px" onclick="document.getElementById('akOv').remove();meetMop({op:'ack',id:'${id}'})">✅ 確認熟知（完成簽收）</button>
    <button class="mini" style="width:100%;padding:12px;font-size:15px" onclick="document.getElementById('akOv').remove();prepAsk('❓ 我想發問',0,1,(q,r2)=>{if(!r2){alert('要寫問題');return}meetMop({op:'ask',id:'${id}',q:r2})},'問題會通知老闆並記錄時間')">❓ 我想發問</button>
    <div class="hint" style="margin-top:8px">發問不算簽收——老闆回覆後再按確認熟知。</div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function meetAnswer(id, askId){ prepAsk('💬 回覆這個發問', 0, 1, (q, r2)=>{ if (!r2) return; meetMop({ op:'answer', id, askId, ans: r2 }) }, '回覆內容（會 DD 通知提問人）') }
function copyLink(h){
  const url = location.origin + '/prep' + h
  try { navigator.clipboard.writeText(url) } catch(e) { prompt('複製這個連結', url); return }
  const b = document.createElement('div'); b.id = 'cpToast'
  const old = document.getElementById('cpToast'); if (old) old.remove()
  b.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:80;background:#10182B;color:#fff;border-radius:10px;padding:8px 16px;font-size:14px;white-space:nowrap'
  b.textContent = '🔗 連結已複製'
  document.body.appendChild(b); setTimeout(()=>b.remove(), 1200)
}
function glowWait(elId, tries){ // deep link 目標閃金光定位
  const el = document.getElementById(elId)
  if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' }); el.classList.add('glowgold'); return }
  if ((tries||0) < 40) setTimeout(()=>glowWait(elId, (tries||0)+1), 400)
}
async function meetOp(op, id){
  const r = await fetch('/api/mail-sync?meetset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op, id, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) meetLoad(); else alert((d&&d.error)||'失敗')
}
function meetTypes(){
  const d = window._meetD
  const v = prompt('會議類型（用「、」分隔，可自行增減改名）', d.types.join('、'))
  if (v == null) return
  fetch('/api/mail-sync?meetset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'types', types: v.split(/[、,，]/).map(s=>s.trim()).filter(Boolean), token: TK() }) })
    .then(r=>r.json()).then(d2=>{ if(d2&&d2.ok) meetLoad(); else alert((d2&&d2.error)||'失敗') })
}
// ── 📅 班表 × 打卡（張良 2026-09-22：排班可增刪改；對照打卡算工時——口徑同薪資引擎 src/shift/payroll.js：
//    正常8h/日、加班前2h×1.34、之後×1.67（勞基法§24）；單日>12h（§32）、月加班>46h（§32）、連上7天（§36七休一）標紅；遲到寬限5分）──
let shiftYm = null
