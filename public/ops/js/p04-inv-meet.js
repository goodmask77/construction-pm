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
// ── ⏰ 打卡 v4.57（張良「要有取消＋能正確選上班/下班/補卡(審核)」）：打卡視窗先建議方向、可明確選上/下班、補卡走主管審核 ──
function punchOvClose(){ const o=document.getElementById('punchOv'); if(o) o.remove() }
function punchOv(html){ let o=document.getElementById('punchOv'); if(!o){ o=document.createElement('div'); o.id='punchOv'; o.style.cssText='position:fixed;inset:0;background:rgba(10,14,22,.55);z-index:90;display:flex;align-items:center;justify-content:center;padding:16px'; o.onclick=()=>o.remove(); document.body.appendChild(o) } o.innerHTML='<div style="background:#1C2430;border:1px solid #39434F;border-radius:16px;max-width:380px;width:100%;max-height:84vh;overflow:auto;padding:18px" onclick="event.stopPropagation()">'+html+'</div>' }
async function punchNow(){
  if (!TK()) { alert('要先登入才能打卡：按右上「登入」→ 私訊 DD「登入碼」→ 填入 4 個數字'); return }
  punchOv('<div class="hint" style="padding:12px 0;text-align:center">讀取中…</div>')
  let s=null; try { const r=await fetch('/api/mail-sync?punchstat='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK()})}); s=await r.json() } catch(_){}
  if (!s || !s.ok) { punchOvClose(); alert((s&&s.error)||'讀不到打卡狀態'); return }
  window._punchS=s
  const now=new Date().toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Taipei'}).slice(0,5)
  const btn=(dir,label,primary)=>`<button onclick="punchDo('${dir}')" style="flex:1;padding:15px 8px;border-radius:12px;border:1.5px solid ${primary?'var(--primary)':'var(--line)'};background:${primary?'var(--primary)':'transparent'};color:${primary?'#fff':'var(--ink)'};font-size:16px;font-weight:800;cursor:pointer">${label}${primary?' <span style="font-size:11px;font-weight:700;opacity:.9">建議</span>':''}</button>`
  let h=`<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px"><b style="font-size:17px">打卡</b><span style="font-size:21px;font-weight:900;color:var(--pdark);font-variant-numeric:tabular-nums">${now}</span></div>`
  h+=`<div class="hint" style="margin-bottom:13px">👤 ${s.name}${s.lastHm?`・上次 ${s.lastHm} 打了「${s.lastDir==='in'?'上班':'下班'}」`:'・今天還沒打卡'}</div>`
  h+=`<div style="display:flex;gap:10px;margin-bottom:10px">${s.suggest==='in'?btn('in','上班',true)+btn('out','下班',false):btn('in','上班',false)+btn('out','下班',true)}</div>`
  h+=`<button onclick="punchMakeupForm()" style="width:100%;padding:11px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--ink);font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px">🕐 補卡申請（需主管審核）</button>`
  if (s.isApprover) h+=`<button onclick="punchReviewOpen()" style="width:100%;padding:11px;border-radius:12px;border:1px solid ${s.pendN?'var(--primary)':'var(--line)'};background:transparent;color:${s.pendN?'var(--primary)':'var(--muted)'};font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px">📋 補卡審核${s.pendN?`（${s.pendN}）`:''}</button>`
  h+=`<button onclick="punchOvClose()" style="width:100%;padding:10px;border:none;background:transparent;color:var(--muted);font-size:14px;cursor:pointer">取消</button>`
  punchOv(h)
}
async function punchDo(dir){
  punchOv('<div class="hint" style="padding:12px 0;text-align:center">打卡中…</div>')
  const r=await fetch('/api/mail-sync?punchme='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),dir})})
  const d=await r.json().catch(()=>null)
  if (!d || !d.ok) { punchOvClose(); alert((d&&d.error)||'打卡失敗'); return }
  const hm=new Date(d.ts).toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Taipei'}).slice(0,5)
  punchOv(`<div style="text-align:center;padding:6px 0"><div style="font-size:34px;margin-bottom:6px">✅</div><div style="font-size:17px;font-weight:800;margin-bottom:4px">${d.name}「${d.dir==='in'?'上班':'下班'}」${hm}</div>${d.dir==='out'?`<div class="hint">今天累計 ${d.todayHours} 小時</div>`:''}<button onclick="punchOvClose()" style="margin-top:14px;padding:10px 28px;border-radius:12px;border:none;background:var(--primary);color:#fff;font-weight:800;cursor:pointer">好</button></div>`)
}
function _mkSet(dir){ window._mkDir=dir; const a=document.getElementById('mkb_in'),b=document.getElementById('mkb_out'); if(!a||!b)return
  const on='flex:1;padding:11px;border-radius:10px;border:1.5px solid var(--primary);background:var(--primary);color:#fff;font-weight:800;cursor:pointer'
  const off='flex:1;padding:11px;border-radius:10px;border:1.5px solid var(--line);background:transparent;color:var(--ink);font-weight:800;cursor:pointer'
  a.style.cssText=dir==='in'?on:off; b.style.cssText=dir==='out'?on:off }
function punchMakeupForm(){
  window._mkDir='in'
  const pad=n=>String(n).padStart(2,'0'), t=new Date(Date.now()-3600e3)
  const def=`${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:16px">🕐 補卡申請</b><button onclick="punchNow()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px">‹ 返回</button></div>`
  h+=`<div class="hint" style="margin-bottom:12px">忘記打卡或打錯時用；送出後由主管審核，核准才會寫進出勤。</div>`
  h+=`<div class="hint" style="margin-bottom:5px">方向</div><div style="display:flex;gap:8px;margin-bottom:12px"><button id="mkb_in" onclick="_mkSet('in')" style="flex:1;padding:11px;border-radius:10px;border:1.5px solid var(--primary);background:var(--primary);color:#fff;font-weight:800;cursor:pointer">上班</button><button id="mkb_out" onclick="_mkSet('out')" style="flex:1;padding:11px;border-radius:10px;border:1.5px solid var(--line);background:transparent;color:var(--ink);font-weight:800;cursor:pointer">下班</button></div>`
  h+=`<div class="hint" style="margin-bottom:5px">時間</div><input type="datetime-local" id="mkTs" value="${def}" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);margin-bottom:12px;font-size:15px">`
  h+=`<div class="hint" style="margin-bottom:5px">原因（選填）</div><input id="mkReason" placeholder="例：忘記打下班卡" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);margin-bottom:14px;font-size:15px">`
  h+=`<div style="display:flex;gap:10px"><button onclick="punchOvClose()" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--muted);font-weight:700;cursor:pointer">取消</button><button onclick="punchMakeupSubmit()" style="flex:2;padding:12px;border-radius:12px;border:none;background:var(--primary);color:#fff;font-weight:800;cursor:pointer">送出申請</button></div>`
  punchOv(h)
}
async function punchMakeupSubmit(){
  const tv=document.getElementById('mkTs').value; if(!tv){ alert('請選時間'); return }
  const reason=document.getElementById('mkReason').value||''
  let iso; try { iso=new Date(tv).toISOString() } catch(_){ alert('時間格式不對'); return }
  punchOv('<div class="hint" style="padding:12px 0;text-align:center">送出中…</div>')
  const r=await fetch('/api/mail-sync?punchmakeup='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),dir:window._mkDir||'in',ts:iso,reason})})
  const d=await r.json().catch(()=>null)
  if (!d || !d.ok) { punchOvClose(); alert((d&&d.error)||'送出失敗'); return }
  punchOv(`<div style="text-align:center;padding:6px 0"><div style="font-size:34px;margin-bottom:6px">📨</div><div style="font-size:16px;font-weight:800;margin-bottom:4px">已送出補卡申請</div><div class="hint">等主管審核，核准後會通知你</div><button onclick="punchOvClose()" style="margin-top:14px;padding:10px 28px;border-radius:12px;border:none;background:var(--primary);color:#fff;font-weight:800;cursor:pointer">好</button></div>`)
}
async function punchReviewOpen(){
  punchOv('<div class="hint" style="padding:12px 0;text-align:center">讀取中…</div>')
  const r=await fetch('/api/mail-sync?punchmakeups='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK()})})
  const d=await r.json().catch(()=>null)
  if (!d || !d.ok) { punchOvClose(); alert((d&&d.error)||'讀不到'); return }
  const fmtT=iso=>new Date(iso).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})
  const backAct = document.getElementById('paOv') ? 'punchOvClose()' : 'punchNow()' // 從打卡後台開＝返回只關這層；從打卡視窗開＝回主選單
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:16px">📋 補卡審核</b><button onclick="${backAct}" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px">‹ 返回</button></div>`
  const pend=d.pending||[]
  if (!pend.length) h+=`<div class="hint" style="padding:16px 0;text-align:center">目前沒有待審核的補卡</div>`
  else h+=pend.map(it=>`<div style="border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:8px">
    <div style="font-weight:800">${it.name}　<span style="color:var(--pdark)">補${it.dir==='in'?'上班':'下班'}</span>　<span style="font-variant-numeric:tabular-nums">${fmtT(it.ts)}</span></div>
    ${it.reason?`<div class="hint" style="margin:3px 0">${String(it.reason).replace(/</g,'&lt;')}</div>`:''}
    <div style="display:flex;gap:8px;margin-top:8px"><button onclick="punchReviewAct('${it.id}','approve')" style="flex:1;padding:9px;border-radius:9px;border:1px solid var(--green);background:transparent;color:var(--green);font-weight:800;cursor:pointer">核准</button><button onclick="punchReviewAct('${it.id}','reject')" style="flex:1;padding:9px;border-radius:9px;border:1px solid var(--red);background:transparent;color:var(--red);font-weight:800;cursor:pointer">退回</button></div></div>`).join('')
  h+=`<button onclick="punchOvClose()" style="width:100%;padding:10px;border:none;background:transparent;color:var(--muted);font-size:14px;cursor:pointer;margin-top:4px">關閉</button>`
  punchOv(h)
}
async function punchReviewAct(id,action){
  const r=await fetch('/api/mail-sync?punchmakeupset='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),id,action})})
  const d=await r.json().catch(()=>null)
  if (!d || !d.ok) { alert((d&&d.error)||'處理失敗'); return }
  punchReviewOpen()
}
// ── ⏰ 打卡後台 v4.58（主管／審核人）：某日全員明細＋現在在班＋改/刪/幫補＋匯出CSV（lpOverlay z66；改/補表單用 punchOv z90 疊上去）──
async function punchAdminView(date){
  lpOverlay('paOv','<div class="hint" style="padding:20px">讀取打卡紀錄中…</div>')
  const r=await fetch('/api/mail-sync?punchadmin='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),date:date||null})}).then(x=>x.json()).catch(()=>null)
  if (!r || !r.ok) { lpOverlay('paOv',`<div style="padding:16px">🔒 ${(r&&r.error)||'讀不到'}</div>`); return }
  window._paD=r; punchAdminDraw()
}
function _paNav(n){ const d=new Date(window._paD.date+'T00:00:00'); d.setDate(d.getDate()+n); const p=x=>String(x).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}` }
function punchAdminDraw(){
  const r=window._paD; if(!r)return
  const wd='日一二三四五六'[new Date(r.date+'T00:00:00').getDay()]
  const st=r.stats||{sched:0,punched:0,absent:0,late:0,bad:0,totalHrs:0,working:0}
  let h=`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:13px">
    <div><div style="font-size:18px;font-weight:900;display:flex;align-items:center;gap:7px">⏰ 打卡後台</div><div class="hint" style="margin-top:2px">GD 自建打卡・出勤考勤管理</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${r.pendN?`<button class="mini" style="padding:7px 13px;color:#fff;background:var(--primary);border-color:transparent;font-weight:800" onclick="punchReviewOpen()">📋 補卡審核 ${r.pendN}</button>`:''}<button class="mini" style="padding:7px 13px" onclick="punchAddForm()">＋ 幫人補打卡</button><button class="mini" style="padding:7px 13px" onclick="punchAdminExport()">⬇️ 匯出CSV</button><button class="mini" style="padding:7px 14px" onclick="document.getElementById('paOv').remove()">關閉</button></div></div>`
  const kpi=(lb,v,col)=>`<div style="flex:1;min-width:82px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 10px;text-align:center"><div style="font-size:23px;font-weight:900;line-height:1.1;color:${col||'var(--ink)'};font-variant-numeric:tabular-nums">${v}</div><div class="hint" style="margin-top:3px;font-size:12px">${lb}</div></div>`
  h+=`<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:12px">${kpi('應到',st.sched)}${kpi('實到',st.punched,'var(--green)')}${kpi('未到',st.absent,st.absent?'var(--red)':'var(--muted)')}${kpi('遲到',st.late,st.late?'#E8A657':'var(--muted)')}${kpi('異常',st.bad,st.bad?'var(--red)':'var(--muted)')}${kpi('總工時',st.totalHrs+'h','var(--pdark)')}</div>`
  h+=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
    <button class="mini" style="padding:6px 12px" onclick="punchAdminView('${_paNav(-1)}')">‹ 前一天</button>
    <input type="date" value="${r.date}" onchange="punchAdminView(this.value)" style="padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);font-size:14px;font-weight:700">
    <span style="font-weight:800;color:var(--pdark)">（${wd}）</span>
    <button class="mini" style="padding:6px 12px" onclick="punchAdminView('${_paNav(1)}')">後一天 ›</button>
    ${r.date!==r.today?`<button class="mini on" style="padding:6px 12px" onclick="punchAdminView('${r.today}')">回今天</button>`:'<span class="hint">● 今天</span>'}
    <span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:var(--soft);border:1px solid var(--line);font-size:12.5px;font-weight:700"><span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block"></span>現在在班 ${r.live.length}</span></div>`
  if(r.live.length) h+=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${r.live.map(x=>`<span style="padding:4px 11px;border-radius:999px;background:#16281C;border:1px solid var(--green);color:var(--green);font-size:12.5px;font-weight:700">${x.name}・${x.sinceHm} 起 ${x.hrs}h</span>`).join('')}</div>`
  if(!r.rows.length) h+=`<div style="padding:30px;text-align:center;border:1px dashed var(--line);border-radius:12px"><div style="font-size:15px;font-weight:700;color:var(--muted)">這天沒有排班、也沒有打卡紀錄</div></div>`
  else {
    const badge=(bg,bd,co,t)=>`<span style="padding:2px 9px;border-radius:999px;background:${bg};border:1px solid ${bd};color:${co};font-size:12px;font-weight:700;white-space:nowrap">${t}</span>`
    const stBadge=x=>{
      if(x.working) return badge('#16281C','var(--green)','var(--green)','上班中')
      const reds=x.red.map(f=>badge('#2A181A','var(--red)','var(--red)',f))
      const ambers=x.amber.map(f=>badge('#2A2410','#6B5A2A','#E8A657',f))
      if(!reds.length&&!ambers.length) return x.unplanned?badge('var(--soft)','var(--line)','var(--muted)','未排班'):badge('#16281C','var(--green)','var(--green)','正常')
      return [...reds,...ambers].join(' ')
    }
    const TH='padding:7px 12px;text-align:left;position:sticky;top:0;background:#2A3442;white-space:nowrap'
    h+=`<div class="scroll" style="max-height:50vh;overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:13.5px"><thead><tr><th style="${TH}">夥伴</th><th style="${TH}">排班</th><th style="${TH}">打卡（點可改／刪）</th><th style="${TH};text-align:right">時數</th><th style="${TH}">狀態</th></tr></thead><tbody>`
    h+=r.rows.map((x,i)=>{
      const planTxt=x.plan?((x.plan.pos?x.plan.pos+'　':'')+(x.plan.start&&x.plan.end?x.plan.start+'–'+x.plan.end:'')).trim()||'<span class="mut">—</span>':'<span class="mut">—</span>'
      const chips=x.punches.map(p=>`<button onclick="punchEditForm('${p.key}','${p.dir}','${p.ts}','${String(x.name).replace(/'/g,'')}')" style="margin:2px;padding:3px 9px;border-radius:8px;border:1px solid ${p.dir==='in'?'var(--green)':'#E8A657'};background:transparent;color:${p.dir==='in'?'var(--green)':'#E8A657'};font-size:12px;font-weight:700;cursor:pointer;font-variant-numeric:tabular-nums">${p.dir==='in'?'上':'下'} ${p.hm}${(p.src&&p.src.indexOf('admin')>=0)?' ✎':(p.src==='makeup'?' 補':'')}</button>`).join('')
      const punchCell=chips||`<button onclick="punchAddForm('${String(x.name).replace(/'/g,'')}')" style="padding:3px 10px;border-radius:8px;border:1px dashed var(--line);background:transparent;color:var(--muted);font-size:12px;cursor:pointer">＋ 補打卡</button>`
      return `<tr style="border-top:1px solid var(--line);${i%2?'background:#171E29':''}"><td style="padding:7px 12px;font-weight:800;white-space:nowrap">${x.name}</td><td style="padding:7px 12px;white-space:nowrap;color:var(--text)">${planTxt}</td><td style="padding:6px 12px">${punchCell}</td><td style="padding:7px 12px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums">${x.totalHrs||'<span class="mut">—</span>'}</td><td style="padding:7px 12px">${stBadge(x)}</td></tr>`
    }).join('')
    h+=`</tbody></table></div><div class="hint" style="margin-top:7px">點打卡鈕＝改時間/方向或刪　·　✎管理員改過　·　補＝補卡核准　·　＋補打卡＝幫沒打的人補</div>`
  }
  lpOverlay('paOv', h)
}
function _peSet(dir){ window._peDir=dir; ['in','out'].forEach(dd=>{ const b=document.getElementById('peb_'+dd); if(b){ const on=dd===dir; b.style.cssText=`flex:1;padding:11px;border-radius:10px;border:1.5px solid ${on?'var(--primary)':'var(--line)'};background:${on?'var(--primary)':'transparent'};color:${on?'#fff':'var(--ink)'};font-weight:800;cursor:pointer` } }) }
function _peTog(dir2,lb){ const on=window._peDir===dir2; return `<button id="peb_${dir2}" onclick="_peSet('${dir2}')" style="flex:1;padding:11px;border-radius:10px;border:1.5px solid ${on?'var(--primary)':'var(--line)'};background:${on?'var(--primary)':'transparent'};color:${on?'#fff':'var(--ink)'};font-weight:800;cursor:pointer">${lb}</button>` }
function punchEditForm(key,dir,ts,name){
  window._peKey=key; window._peDir=dir
  const d=new Date(ts), p=n=>String(n).padStart(2,'0')
  const v=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:16px">改打卡・${name}</b><button onclick="punchOvClose()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px">✕</button></div>`
  h+=`<div class="hint" style="margin-bottom:5px">方向</div><div style="display:flex;gap:8px;margin-bottom:12px">${_peTog('in','上班')}${_peTog('out','下班')}</div>`
  h+=`<div class="hint" style="margin-bottom:5px">時間</div><input type="datetime-local" id="peTs" value="${v}" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);margin-bottom:14px;font-size:15px">`
  h+=`<div style="display:flex;gap:10px"><button onclick="punchEditDel()" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--red);background:transparent;color:var(--red);font-weight:800;cursor:pointer">刪除</button><button onclick="punchEditSave()" style="flex:2;padding:12px;border-radius:12px;border:none;background:var(--primary);color:#fff;font-weight:800;cursor:pointer">存檔</button></div>`
  punchOv(h)
}
async function punchEditSave(){
  const tv=document.getElementById('peTs').value; if(!tv){ alert('請選時間'); return }
  const iso=new Date(tv).toISOString()
  const r=await fetch('/api/mail-sync?punchedit='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),action:'edit',key:window._peKey,ts:iso,dir:window._peDir})})
  const d=await r.json().catch(()=>null); if(!d||!d.ok){ alert((d&&d.error)||'存檔失敗'); return }
  punchOvClose(); punchAdminView(window._paD.date)
}
async function punchEditDel(){
  if(!confirm('確定刪除這筆打卡？（出勤是法定紀錄，刪了要留意）')) return
  const r=await fetch('/api/mail-sync?punchedit='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),action:'del',key:window._peKey})})
  const d=await r.json().catch(()=>null); if(!d||!d.ok){ alert((d&&d.error)||'刪除失敗'); return }
  punchOvClose(); punchAdminView(window._paD.date)
}
function punchAddForm(prefill){
  window._peDir='in'
  const names=(window._shiftD&&(window._shiftD.namesAll||window._shiftD.names))||((window._paD&&window._paD.rows)||[]).map(x=>x.name)
  const p=n=>String(n).padStart(2,'0'), d=new Date((window._paD?window._paD.date:'')+'T12:00:00')
  const v=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T12:00`
  let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:16px">幫人補打卡</b><button onclick="punchOvClose()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px">✕</button></div>`
  h+=`<div class="hint" style="margin-bottom:10px">管理員直接補，不用再審核；對方要先綁定過才補得了。</div>`
  h+=`<div class="hint" style="margin-bottom:5px">夥伴</div><input id="peName" list="peNameList" value="${prefill?String(prefill).replace(/"/g,'&quot;'):''}" placeholder="打名字" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);margin-bottom:12px;font-size:15px"><datalist id="peNameList">${[...new Set(names)].map(n=>`<option value="${String(n).replace(/"/g,'&quot;')}">`).join('')}</datalist>`
  h+=`<div class="hint" style="margin-bottom:5px">方向</div><div style="display:flex;gap:8px;margin-bottom:12px">${_peTog('in','上班')}${_peTog('out','下班')}</div>`
  h+=`<div class="hint" style="margin-bottom:5px">時間</div><input type="datetime-local" id="peTs" value="${v}" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);margin-bottom:14px;font-size:15px">`
  h+=`<div style="display:flex;gap:10px"><button onclick="punchOvClose()" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--muted);font-weight:700;cursor:pointer">取消</button><button onclick="punchAddSave()" style="flex:2;padding:12px;border-radius:12px;border:none;background:var(--primary);color:#fff;font-weight:800;cursor:pointer">新增</button></div>`
  punchOv(h)
}
async function punchAddSave(){
  const name=(document.getElementById('peName').value||'').trim(); if(!name){ alert('請填夥伴名字'); return }
  const tv=document.getElementById('peTs').value; if(!tv){ alert('請選時間'); return }
  const iso=new Date(tv).toISOString()
  const r=await fetch('/api/mail-sync?punchedit='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:TK(),action:'add',name,ts:iso,dir:window._peDir})})
  const d=await r.json().catch(()=>null); if(!d||!d.ok){ alert((d&&d.error)||'新增失敗'); return }
  punchOvClose(); punchAdminView(window._paD.date)
}
function punchAdminExport(){
  const r=window._paD; if(!r)return
  let csv='日期,夥伴,排班崗位,排班時間,上班卡,下班卡,時數,狀態\n'
  for(const x of r.rows){
    const ins=x.punches.filter(p=>p.dir==='in').map(p=>p.hm).join(' '), outs=x.punches.filter(p=>p.dir==='out').map(p=>p.hm).join(' ')
    const stt=x.working?'上班中':[...x.red,...x.amber].join('、')||(x.unplanned?'未排班':'正常')
    const pl=x.plan?((x.plan.start&&x.plan.end)?x.plan.start+'-'+x.plan.end:''):''
    csv+=`${r.date},${x.name},"${x.plan?x.plan.pos||'':''}","${pl}","${ins}","${outs}",${x.totalHrs||0},"${stt}"\n`
  }
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'})); a.download=`打卡_${r.date}.csv`; a.click()
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
// v4.47.3 會議卡片化（張良：像任務卡——分類/展開/編輯/看已確認數+時間/點未簽的人直接 DD私訊+App提醒）
window._meetOpen = window._meetOpen || {}       // 展開中的會議 id
window._meetCatClose = window._meetCatClose || {} // 收合的分類
function meetToggle(id){ window._meetOpen[id] = !window._meetOpen[id]; meetRender() }
function meetFilterSet(f){ window._meetFilter = f; meetRender() } // v4.47.5 分段篩選切換（全部/各類型）
function meetCatToggle(tp){ window._meetCatClose[tp] = !window._meetCatClose[tp]; meetRender() }
async function meetNudge(id, name){
  const b = event && event.target && event.target.closest ? event.target.closest('button') : null
  if (b) { b.disabled = true; b.style.opacity = '.5' }
  const r = await fetch('/api/mail-sync?meetset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'nudge', id, name, token: TK() }) }).catch(()=>null)
  const d = r && await r.json().catch(()=>null)
  if (d && d.ok) { meetLoad(); } else { alert((d&&d.error)||'催簽送不出去'); if (b) { b.disabled=false; b.style.opacity='1' } }
}
function meetRender(){
  const d = window._meetD; if (!d || curStore !== 'meet') return
  document.getElementById('upd').textContent = '會議紀錄'
  const meN = d.me ? d.me.name : null
  const canAns = d.me && (d.me.approver || d.me.role === '主管')
  const esc = s => String(s==null?'':s).replace(/</g,'&lt;')
  const lnk = (x,l) => { const inT = /^https?:\/\/[^/]*ground-pm|^\/prep|^#/.test(l.url); const href = l.url.startsWith('#') ? ('/prep'+l.url) : l.url
    return `<a href="${href}" ${inT?'':'target="_blank"'} onclick="event.stopPropagation();meetMop({op:'view',id:'${x.id}'},1)" style="color:var(--primary);font-weight:700;margin-right:10px">🔗 ${esc(l.label||l.url.slice(0,40))}</a>` }
  // ── 任務卡式會議卡（張良「做得像任務中心那樣的卡片」）：內容直接攤開，不折疊 ──
  const mc = x => {
    const ver = x.ver || 1
    const names = x.ackNames || d.regNames || []
    const acks = x.acks || {}, nudges = x.nudges || {}
    const acked = Object.entries(acks).filter(([,v])=>v && v.ver===ver).map(([n])=>n)
    const missing = names.filter(n=>!acked.includes(n))
    const itemsX = (x.items && x.items.length) ? x.items : String(x.text||'').split('\n').map(t=>t.trim()).filter(Boolean).map((t,i)=>({id:'tx'+i,t}))
    const myRow = meN && names.includes(meN), myAck = meN && acked.includes(meN)
    const allDone = names.length && !missing.length
    const title = itemsX.length ? itemsX[0].t : (x.text||'（無內容）')
    let h2 = `<div id="mt-${x.id}" style="background:var(--card);border:1.5px solid ${ver>1?'#E8A657':'var(--line)'};border-radius:12px;padding:12px 14px;margin-bottom:10px;font-size:14px">`
    // 標題行：標題 + 簽收徽章
    h2 += `<div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:15px;line-height:1.3;word-break:break-word">${esc(title)}</div>
        <div class="hint" style="font-size:12px;margin-top:2px">📅 ${x.date}${ver>1?` ・<span style="color:#E8A657;font-weight:800">v${ver} 已改版要重簽</span>`:''}</div>
      </div>
      ${names.length?`<span style="flex-shrink:0;display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:800;border-radius:999px;padding:4px 11px;background:${allDone?'rgba(61,190,108,.15)':'rgba(240,115,115,.15)'};color:${allDone?'var(--green)':'var(--red)'}">${allDone?'🎉':'✍️'} ${acked.length}/${names.length}</span>`:''}
    </div>`
    // 全部條列（≥2 條才列表格；單條已在標題）
    if (itemsX.length > 1) h2 += `<table style="width:100%;border-collapse:collapse;margin:8px 0 2px">${itemsX.map((it2,i)=>`<tr><td style="border:1px solid var(--line);padding:5px 8px;width:30px;text-align:center;color:var(--muted);font-weight:800">${i+1}</td><td style="border:1px solid var(--line);padding:5px 8px;text-align:left">${esc(it2.t)}</td></tr>`).join('')}</table>`
    if ((x.media||[]).length) h2 += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 2px">${x.media.map(u=>`<a href="${u}" target="_blank" onclick="meetMop({op:'view',id:'${x.id}'},1)"><img src="${u}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--line)" onerror="this.outerHTML='📎'"></a>`).join('')}</div>`
    if ((x.links||[]).length) h2 += `<div style="margin:6px 0 2px">${x.links.map(l=>lnk(x,l)).join('')}</div>`
    // 簽收：已確認(含時間)綠chip + 未確認紅chip可點催
    if (names.length) {
      h2 += `<div style="margin:9px 0 2px;border-top:1px dashed var(--line);padding-top:8px">`
      if (acked.length) h2 += `<div style="font-size:12px;color:var(--muted);margin-bottom:4px">✅ 已確認 ${acked.length}</div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:${missing.length?'8px':'0'}">${acked.map(n=>`<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;border-radius:999px;padding:3px 9px;background:rgba(61,190,108,.14);color:var(--green)">${esc(n)}<span style="opacity:.7;font-size:11px">${(acks[n]||{}).ts||''}</span></span>`).join('')}</div>`
      if (missing.length) {
        h2 += `<div style="font-size:12px;color:var(--muted);margin-bottom:4px">⏳ 未確認 ${missing.length}</div><div style="display:flex;flex-wrap:wrap;gap:5px">${missing.map(n=>`<button ${meN?'':'disabled'} onclick="meetNudge('${x.id}','${esc(n).replace(/'/g,'')}')" title="${nudges[n]?('上次催：'+nudges[n]):'點一下催他簽收'}" style="display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:700;border-radius:999px;padding:4px 11px;background:rgba(240,115,115,.12);color:var(--red);border:1px solid rgba(240,115,115,.4);cursor:${meN?'pointer':'default'}">🔔 ${esc(n)}${nudges[n]?' <span style="opacity:.6;font-size:10.5px">已催</span>':''}</button>`).join('')}</div>`
      } else h2 += `<div style="color:var(--green);font-weight:800;font-size:13px">🎉 全員完成簽收</div>`
      h2 += `</div>`
    }
    if (myRow) h2 += myAck ? `<div style="color:var(--green);font-weight:800;font-size:13px;margin-top:6px">✓ 你已簽收（${(acks[meN]||{}).ts||''}）</div>` : `<button class="mini on" style="padding:8px 16px;margin:6px 0 0" onclick="ackWin('${x.id}')">📩 我讀完了（簽收）</button>`
    if ((x.asks||[]).length) h2 += `<div style="margin-top:8px;border-top:1px dashed var(--line);padding-top:6px">${x.asks.map(a2=>`<div style="font-size:13px;margin-bottom:4px"><b>❓ ${esc(a2.q)}</b> <span class="hint">${a2.by}・${a2.ts}</span>${a2.ans?`<div style="color:var(--pdark)">💬 ${esc(a2.ans)} <span class="hint">${a2.ansBy}・${a2.ansTs}</span></div>`:(canAns?` <button class="mini" style="padding:4px 10px" onclick="meetAnswer('${x.id}','${a2.id}')">回覆</button>`:' <span class="hint">（等回覆）</span>')}</div>`).join('')}</div>`
    if (x.groupSent) h2 += x.groupSent.fail ? `<div class="hint" style="margin-top:6px;color:#E8A657;font-size:12px">⚠️ 大群通知發送失敗（可稍後請 DD 補發）</div>` : `<div class="hint" style="margin-top:6px;font-size:12px">📢 已同步大群通知・${x.groupSent.n} 則（${x.groupSent.ts}）</div>` // v4.48.0 最下面顯示發群則數
    h2 += `<div style="margin-top:9px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="hint" style="margin-right:auto">${x.by}・${x.ts}${x.editedBy?`・改 ${x.editedBy}`:''}</span><span class="lnkbtn" title="複製連結" onclick="copyLink('#meet=${x.id}')" style="border:1px solid var(--line);border-radius:8px;padding:4px 9px;font-size:12px">🔗</span>${meN?`<button class="mini" style="padding:4px 10px" onclick="meetForm('${x.id}')">✏️ 編輯</button><button class="mini" style="padding:4px 10px;color:var(--red)" onclick="if(confirm('刪除這筆會議紀錄？'))meetMop({op:'del',id:'${x.id}'})">🗑</button>`:''}</div>`
    h2 += `</div>`
    return h2
  }
  let h = `<section><h2>會議紀錄 <span class="hint">${meN?'':'看得到；要新增/編輯/催簽先綁定——'+BIND_HINT}</span></h2>`
  const cats = [...d.types, ...([...new Set(d.list.map(x=>x.type))].filter(t=>!d.types.includes(t)))]
  // v4.47.5 分段篩選（張良 2026-10-05「像月份選擇器：全部/班前會議/營運會議/＋新增會議，按了下面只顯示那類」）
  const filt = (window._meetFilter === 'all' || cats.includes(window._meetFilter)) ? window._meetFilter : 'all'
  const pill = (lb, on, act) => `<button onclick="${act}" style="padding:8px 16px;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;border:1.5px solid ${on?'var(--primary)':'var(--line)'};background:${on?'var(--primary)':'transparent'};color:${on?'#fff':'var(--muted)'}">${lb}</button>`
  h += `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">`
    + pill('全部（' + d.list.length + '）', filt === 'all', "meetFilterSet('all')")
    + cats.map(tp => pill(tp + '（' + d.list.filter(x => x.type === tp).length + '）', filt === tp, "meetFilterSet('" + tp.replace(/'/g, "\\'") + "')")).join('')
    + (meN ? pill('＋ 新增會議', false, 'meetForm()').replace('var(--muted)', 'var(--primary)') + `<button onclick="meetTypes()" title="管理會議類型" style="padding:8px 12px;border-radius:999px;font-size:13px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--muted)">⚙️</button>` : '')
    + `</div>`
  const showCats = filt === 'all' ? cats : cats.filter(c => c === filt)
  for (const tp of showCats) {
    const rows = d.list.filter(x => x.type === tp)
    if (filt === 'all') h += `<div style="font-weight:900;margin:14px 0 6px;color:var(--pdark)">${tp}（${rows.length}）</div>`
    h += rows.length ? rows.map(mc).join('') : `<div class="mut" style="font-size:14px;margin-bottom:6px">還沒有紀錄</div>`
  }
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
// v4.47.5 會議類型正式視窗（張良「不要prompt 給我按鈕 可新增刪除編輯排序」）：一類一列改名/✕刪/⠿拖曳排序/＋新增
function meetTypes(){
  window._mtTypes = (window._meetD.types || []).slice()
  meetTypesDraw()
}
function meetTypesDraw(){
  const old = document.getElementById('mtTypeOv'); if (old) old.remove()
  const L = window._mtTypes || []
  const ov = document.createElement('div'); ov.id='mtTypeOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:400px;width:100%;padding:18px;max-height:84vh;overflow:auto" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px;margin-bottom:4px">⚙️ 會議類型</div>
    <div class="hint" style="margin-bottom:12px">⠿ 拖曳排順序、直接改名字、✕ 刪除；存了全裝置同步</div>
    <div id="mtTypeList">${L.map((t,i)=>`<div class="mtTypeRow" data-idx="${i}" style="display:flex;gap:7px;align-items:center;margin-bottom:7px">
      <span class="mtTypeHandle" title="拖我排順序" style="flex-shrink:0;display:flex;cursor:grab;color:var(--muted);touch-action:none">⠿</span>
      <input value="${String(t).replace(/"/g,'&quot;')}" onchange="window._mtTypes[${i}]=this.value.trim()" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:15px;background:var(--bg);color:var(--ink)">
      <button onclick="window._mtTypes.splice(${i},1);meetTypesDraw()" style="flex-shrink:0;padding:8px 11px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--red);cursor:pointer">✕</button>
    </div>`).join('')}</div>
    <button onclick="window._mtTypes.push('新類型');meetTypesDraw();setTimeout(()=>{const ii=document.querySelectorAll('#mtTypeList input');if(ii.length){ii[ii.length-1].focus();ii[ii.length-1].select()}},40)" style="padding:8px 14px;border:1px dashed var(--line);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer">＋ 新增類型</button>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
      <button class="mini" style="padding:9px 14px" onclick="document.getElementById('mtTypeOv').remove()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="meetTypesSave()">✓ 儲存</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
  try { const el = document.getElementById('mtTypeList'); if (el && typeof Sortable !== 'undefined') new Sortable(el, { handle:'.mtTypeHandle', animation:150, onEnd:()=>{ const order = Array.from(el.querySelectorAll('.mtTypeRow')).map(n=>Number(n.getAttribute('data-idx'))); window._mtTypes = order.map(i=>window._mtTypes[i]).filter(v=>v!=null); meetTypesDraw() } }) } catch(e){}
}
async function meetTypesSave(){
  const types = (window._mtTypes||[]).map(s=>String(s||'').trim()).filter(Boolean)
  if (!types.length) { alert('至少留一種會議類型'); return }
  const r = await fetch('/api/mail-sync?meetset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'types', types, token: TK() }) })
  const d2 = await r.json().catch(()=>null)
  const o = document.getElementById('mtTypeOv'); if (o) o.remove()
  if (d2 && d2.ok) meetLoad(); else alert((d2&&d2.error)||'失敗')
}
// ── 📅 班表 × 打卡（張良 2026-09-22：排班可增刪改；對照打卡算工時——口徑同薪資引擎 src/shift/payroll.js：
//    正常8h/日、加班前2h×1.34、之後×1.67（勞基法§24）；單日>12h（§32）、月加班>46h（§32）、連上7天（§36七休一）標紅；遲到寬限5分）──
let shiftYm = null
