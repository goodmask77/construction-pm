// ⚠️ 這是 /prep 主程式的第 1/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：核心(金鑰/分頁/快取/看板/登入)
// v4.33.3 治本（張良點 #meet= 測試連結變訪客+讀不到資料）：舊邏輯「沒 ?k= 就把 # 後面整串當金鑰」會把
// #meet=/#sop= 深層連結吃成假金鑰→全部 API 403。改成只有「長得像金鑰」的 hash（#k=… 或純16進位長串）才算
const K = (() => {
  const q = new URLSearchParams(location.search).get('k'); if (q) return q
  const h = (location.hash || '').replace(/^#/, '')
  const m = h.match(/^k=([A-Za-z0-9]+)$/) || h.match(/^([a-f0-9]{24,})$/i)
  return m ? m[1] : '7ea362bae1f0274372d4ec7b27c78852' // 內建看板唯讀金鑰（短網址 /prep 用；與管理金鑰分開）
})()
const fmt = n => 'NT$' + Math.round(n || 0).toLocaleString()
const app = document.getElementById('app')
let curStore = 'ground'
let lastStore = 'ground'
function setTabs(k){
  // v4.41.2 治本（張良「切到設定了人員名冊還是藍色」）：原本寫死清單＝新分頁(hrm/inline…)漏清不退藍；改抓全部 tab- 按鈕一律清
  document.querySelectorAll('.tabs button[id^="tab-"]').forEach(b => { b.className = (b.id === 'tab-' + k) ? 'on' : '' })
  const tw0 = document.getElementById('taskWrap'); if (tw0) tw0.style.display = (k==='task') ? '' : 'none' // v4.33.7 任務iframe常駐切換（閃跳治本）
  const hb = document.getElementById('tab-home'); if (hb) hb.className = (k==='ground'||k==='abeach') ? 'on' : '' // 🏠=回店面（張良 2026-09-21：怕有人不知道怎麼回去）
  if (k === 'ground' || k === 'abeach') lastStore = k
  const g = document.getElementById('bs-ground'), a = document.getElementById('bs-abeach')
  if (g) g.className = 'bseg' + (lastStore==='ground' ? ' on' : '')
  if (a) a.className = 'bseg' + (lastStore==='abeach' ? ' on' : '')
  try { sessionStorage.setItem('prepView', curStore) } catch(_) {} // v4.4.0（張良 2026-10-02：重新整理留在原頁面）
  try { favMark(k) } catch(_) {} // ⭐ v4.39.1 底部捷徑列同步亮燈
}
// 🔄 更新App（張良 2026-09-22：不是只抓數據——整個 App 重開、連新功能一起拿最新版；r=時戳穿透 CDN 快取）
// 📱 手機版預覽（張良 2026-10-02：每頁右上隨時切手機寬度檢查排版）——iframe 實機 390px 寬載同一頁
function mobilePreview(){
  const ov = document.createElement('div'); ov.id='mpOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:70;display:flex;align-items:center;justify-content:center;padding:12px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:18px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,.55)" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0 4px 8px"><b>📱 手機版預覽（390px）</b><button class="mini" style="padding:5px 12px" onclick="document.getElementById('mpOv').remove()">關閉</button></div>
    <iframe src="${location.pathname}" style="width:390px;height:min(78vh,760px);border:1px solid #3B4654;border-radius:12px;background:var(--bg)"></iframe></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function posFresh(){ // 跟主App同款：手動叫喬亞抓一次盤中→重載看板（v4.18.2）
  const b = document.getElementById('pfBtn'); if (b) { b.disabled = true; b.textContent = '抓取中…' }
  try { await fetch('/api/joya-intraday?manual=1&r=' + Date.now()) } catch(e) {}
  await load('ground', true)
}
function hardRefresh(){ try{ Object.keys(localStorage).filter(k=>k.startsWith('obt_')||k.startsWith('obc_')).forEach(k=>localStorage.removeItem(k)) }catch(_){} location.replace(location.pathname + '?r=' + Date.now()) } // v4.31.8 連本地快取一起清＝真的拿最新
// 依目前分頁重畫（綁定後/操作後用）
function taskEmbed(){ // v4.38.0 任務中心原生版：/ops/tasks.js tnPage()，資料同主App sp_team_ 雙向同步
  if (typeof tnPage === 'function') { tnPage(); return }
  // v4.44.2 真因修（張良「變成以前的版本嚇一跳」）：?v=快取換新後13支腳本重新下載，點任務搶在 tasks.js(93KB)載完前
  // →原本「立刻」退回舊 iframe(React TaskCenter=保留舊欄位的那個彈窗)＝看起來像退版。改=等它載好(最多6秒)再開原生；真的載不到才退 iframe 保底
  curStore = 'taskx'; setTabs('task')
  document.getElementById('upd').textContent = '任務中心載入中…'
  app.innerHTML = '<section><div class="hint" style="padding:26px">任務中心載入中…</div></section>'
  let n9 = 0
  const w9 = () => {
    if (curStore !== 'taskx') return // 使用者已切走
    if (typeof tnPage === 'function') { tnPage(); return }
    if (++n9 < 30) { setTimeout(w9, 200); return }
    document.getElementById('upd').textContent = '任務中心・與主 App 同步'
    const tw = document.getElementById('taskWrap')
    if (tw && !tw.firstChild) tw.innerHTML = `<iframe src="/ops-tasks.html?v=${Date.now()}" style="width:100%;height:calc(100vh - 150px);min-height:560px;border:none;border-radius:14px;background:var(--bg)"></iframe>`
    app.innerHTML = ''
  }
  w9()
}
function goView(){
  if (curStore === 'task' || curStore === 'taskx') taskEmbed() // v4.41.5 舊task路徑一律導新任務中心（審計：殘留入口會開到舊資料域看板）
  else if (curStore === 'lb') loadLB()
  else if (curStore === 'food' || curStore === 'pack') invLoad(curStore)
  else if (curStore === 'buy') buyLoad()
  else if (curStore === 'meet') meetLoad()
  else if (curStore === 'shift') shiftLoad()
  else if (curStore === 'fb') fbLoad()
  else if (curStore === 'menu') menuLoad()
  else if (curStore === 'errs') errsView()
  else if (curStore === 'prep') prepPage(true) // v4.42.0 備料分頁
  else load(curStore, true)
}
// 🔑 輸入綁定碼（iPhone 加入主畫面的 App 跟 Safari 儲存分開→token 帶不過去；貼一次 DD 給的連結/代碼即可）
function bindPrompt(){
  const v = prompt('用 LINE 私訊 DD「登入碼」→ 把 DD 給的 4 個數字填在這裡（10分鐘內有效）\n\n（沒綁定過？先私訊 DD「綁定GD 你的本名」；貼個人連結也可以）')
  if (!v) return
  // 🔢 四位數登入碼（v4.31.3 張良：要更簡單＝打4個數字就好）
  if (/^\d{4}$/.test(v.trim())) {
    fetch('/api/mail-sync?bindcode=' + v.trim()).then(r => r.json()).then(j => {
      if (j.ok && j.me) { localStorage.setItem('prepToken', j.me); try { simWipe() } catch(_){}; alert('登入完成'); hardRefresh() } // v4.31.4 清訪客快取+整個App重開＝名字/權限/分頁即時變（張良：登入完畫面還是訪客要手動刷）
      else alert(j.error || '登入碼錯誤或過期——私訊 DD「登入碼」再拿一組新的')
    }).catch(() => alert('網路不穩，再試一次'))
    return
  }
  if (/bind=/i.test(v)) { location.href = '/prep?bind=' + v.split(/bind=/i)[1].replace(/[^a-z0-9]/gi,''); return } // DD 新版連結 ?bind=xxx 直接走（2026-10-01 Toby 綁不上＝解析器只認舊格式）
  const m = v.match(/me=([a-z0-9]+)/i) || v.match(/(pv[a-z0-9]{8,})/i)
  if (!m) { alert('看不懂這串——輸入 DD 給的 4 位數登入碼，或完整貼上個人連結'); return }
  localStorage.setItem('prepToken', m[1])
  try { simWipe() } catch(_){} // 清掉訪客身分抓的畫面快取
  alert('綁定完成')
  hardRefresh() // v4.31.4 整個App重開＝名字/權限/分頁即時變（manifest 個人化 maniSync 重開後自動跑）
}
const BIND_HINT = `私訊 DD「登入碼」拿 4 位數 → 按 <button class="mini" onclick="bindPrompt()">🔑 登入</button> 填入（沒綁定過先跟 DD 說「綁定GD 本名」）`
// 🗓 台灣國定假日（v4.43.0）：window._twHol={日期:假名} _twWk={日期:補班}——標記每日數據/班表、大卡均線略過連假、以後排班提醒用
window._twHol = {}; window._twWk = {}; let _twT = 0
const twShort = nm => { nm = String(nm||''); if (nm.includes('/')) nm = nm.split('/').pop(); return nm.length > 5 ? nm.slice(0,4) : nm } // v4.43.2 官方假名太長截短顯示
function twHolInit(){
  // v4.47.8 治本（張良「國定假日標記不見」）：原本一進來就設 _twT→被 Vercel 擋/網路失敗後卡 1 小時不重試＝假日一直不回來。改成「只有抓成功才設 _twT」，失敗不節流→下次切頁自動重抓
  if (Date.now() - _twT < 3600e3) return
  try { const c = JSON.parse(localStorage.getItem('twhol9') || 'null'); if (c && c.hol) { window._twHol = c.hol; window._twWk = c.wk || {} } } catch(_){}
  fetch('/api/mail-sync?twhol=' + encodeURIComponent(K) + '&v=2').then(r=>r.json()).then(j=>{
    if (j && j.ok) { window._twHol = j.hol || {}; window._twWk = j.wk || {}; _twT = Date.now(); try { localStorage.setItem('twhol9', JSON.stringify(j)) } catch(_){}
      try { if (curStore === 'shift' && typeof shiftRender === 'function') shiftRender() } catch(_){} // v4.47.8 假日是 async 抓的,比表頭 render 慢→抓到後若正在看班表就補畫表頭假名(不然首次切進來看不到)
    }
  }).catch(()=>{})
}
async function load(store, fresh){
  try { twHolInit() } catch(_){}
  curStore = store
  setTabs(store)
  if (!K) { app.innerHTML = '<div class="err">網址缺少金鑰，請跟店長要完整連結</div>'; return }
  // ⚡ 快取先上（打開秒出畫面）、背景抓最新無感刷新（張良 2026-09-21：讀取太慢）
  const ck = 'obc_' + store
  let hadCache = false
  try { const c = localStorage.getItem(ck); if (c) { renderBoard(JSON.parse(c), store); hadCache = true; document.getElementById('upd').textContent = '⚡ 快取畫面・背景更新最新資料中…' } } catch(e){}
  if (!hadCache) app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?opsboard=' + encodeURIComponent(K) + '&store=' + store + (fresh ? '&r=' + Date.now() : '')); d = await r.json() } catch(e){}
  if (d && d.prepAct) window._prepAct = d.prepAct
  if (d && d.prepS86) window._prepS86 = d.prepS86
  if (!d || !d.ok) { if (!hadCache) app.innerHTML = '<div class="err">讀不到資料（金鑰錯誤或連線問題），請跟店長要新連結</div>'; return }
  try { localStorage.setItem(ck, JSON.stringify(d)) } catch(e){}
  if (curStore !== store) return // 使用者已切到別店，別把畫面蓋回來
  renderBoard(d, store)
}
function dayPer(k){ window._dayPeriod = k; if (window._bd) renderBoard(window._bd, window._bd.store || lastStore) } // 每日數據期間切換（v4.30.0）
function histYrs(){ dayPer('hist') } // v4.37.8 歷史資料＝自己是一個檢視（歷年年度總表＋舊年份鈕；今年鈕取消選取）
function renderBoard(d, store, view){
  if (view === 'prep') return renderPrep(d, store) // v4.42.0（張良拍板）：備料量+節奏表搬「備料」分頁、首頁=今日為王儀表板
  document.getElementById('upd').textContent = '最新日結：' + (d.anchor || '—') + '・資料自動同步'
  let h = ''
  // v4.48.1（張良「頂列只留GROUN:D；A Beach營收放首頁需要再切換」）：營收卡頂店別切換
  h += `<div style="display:inline-flex;background:var(--soft);border:1px solid var(--line);border-radius:9px;padding:2px;gap:2px;margin-top:10px">
    <button onclick="load('ground')" style="padding:5px 14px;border-radius:7px;border:none;font-weight:800;font-size:13px;cursor:pointer;background:${store==='ground'?'var(--primary)':'transparent'};color:${store==='ground'?'#fff':'var(--sub,#8893A4)'}">GROUN:D</button>
    <button onclick="load('abeach')" style="padding:5px 14px;border-radius:7px;border:none;font-weight:800;font-size:13px;cursor:pointer;background:${store==='abeach'?'var(--primary)':'transparent'};color:${store==='abeach'?'#fff':'var(--sub,#8893A4)'}">A Beach</button></div>`
  // 🌞 今日營收大卡（v4.42.0 今日為王：進來先回答「今天怎麼樣」）：營業中=盤中即時、打烊=最新日結；vs 近7個營業日全日均（紅=高 同色階習慣）
  {
    const ds0 = d.days || []
    const lv0 = ds0.filter(x=>x.live).sort((a,b)=>String(a.date)<String(b.date)?-1:1).slice(-1)[0]
    // v4.42.1 治本（張良「怎麼會顯示8/10」）：d.days 不保證照日期排（跨月合併）→明確照日期排序取最大，不再吃陣列順序
    const of0 = ds0.filter(x=>!x.live && (Number(x.rev)||0)>0).slice().sort((a,b)=>String(a.date)<String(b.date)?-1:1)
    const shown = lv0 || of0[of0.length-1]
    if (shown) {
      const base7 = of0.filter(x=>x.date!==shown.date && !(window._twHol||{})[x.date]).slice(-7) // v4.43.0 略過國定假日（張良:中秋連假沒上班族拉低均線→48%虛胖）
      const avg7 = base7.length ? base7.reduce((t,x)=>t+(Number(x.rev)||0),0)/base7.length : 0
      const pc0 = avg7 ? Math.round(((Number(shown.rev)||0)/avg7-1)*100) : null
      const up0 = pc0!=null && pc0>=0
      const lu0 = shown.lunchRev!=null ? shown.lunchRev : (shown.lunchPct!=null&&shown.rev ? shown.rev*shown.lunchPct/100 : null)
      h += `<section style="margin-top:12px"><div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
        <div><div class="hint" style="font-weight:700">${lv0?'今日營收（營業中・隨盤中更新）':`${String(shown.date).slice(5)}${shown.wd?`（${shown.wd}）`:''}${(window._twHol||{})[shown.date]?` <span style="color:#F2C14E">${twShort(window._twHol[shown.date])}</span>`:''} 營收（最新日結）`}</div>
        <div style="font-size:36px;font-weight:900;color:var(--ink);letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.25">${Math.round(shown.rev||0).toLocaleString()}</div></div>
        ${pc0!=null?`<div style="font-size:18px;font-weight:900;color:${up0?'#FF6B6B':'#3DBE6C'}">${up0?'▲':'▼'}${Math.abs(pc0)}%<div class="hint" style="font-weight:600">近7日均(不含連假) ${Math.round(avg7).toLocaleString()}</div></div>`:''}
      </div>
      <div style="display:flex;gap:22px;margin-top:6px;flex-wrap:wrap">
        <span class="hint">單數 <b style="color:var(--ink);font-size:16px">${shown.tx||'—'}</b></span>
        <span class="hint">單均 <b style="color:var(--ink);font-size:16px">${shown.tx&&shown.rev?Math.round(shown.rev/shown.tx).toLocaleString():'—'}</b></span>
        ${store==='ground'&&lu0!=null?`<span class="hint">至14時 <b style="color:var(--ink);font-size:16px">${Math.round(lu0).toLocaleString()}</b></span>`:''}
      </div></section>`
    }
  }
  // 今日事項（張良 2026-09-22：今天該做的事——任務/收貨/班表；資料來自各分頁快取，todayRender 畫）
  h += `<div id="todaysec"></div>`
  // 備料卡＋預做節奏表 → v4.42.0 搬到「備料」分頁（renderPrep）；SOP 已拆獨立分頁（2026-10-02）
  // 🚫 AB 停售動態（張良 2026-10-05「放最下方」）：存變數，renderBoard 尾端才接
  let soldoutH = ''
  if (d.soldout) {
    const cur = Object.entries(d.soldout.current || {})
    soldoutH += `<section><h2>停售動態 <span class="hint">品名🚫自動偵測・每 30 分更新・變化即時通知 happy337</span></h2>
    <div style="font-weight:800;margin-bottom:6px">目前停售中（${cur.length}）</div>
    ${cur.length ? `<div class="scroll"><table><thead><tr><th style="text-align:left">品項</th><th>停售自</th></tr></thead><tbody>${cur.sort((a,b)=>(a[1]<b[1]?1:-1)).map(([n,ts])=>`<tr><td style="text-align:left;font-weight:700">${n}</td><td class="mut">${ts}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mut">目前沒有停售品項 🎉</div>'}
    ${(d.soldout.log||[]).length ? `<details style="margin-top:10px"><summary style="font-weight:800;cursor:pointer">歷史紀錄（${d.soldout.log.length}）</summary>
    <div class="scroll" style="margin-top:6px"><table><thead><tr><th>日期</th><th>時間</th><th style="text-align:left">品項</th><th>動作</th></tr></thead><tbody>${d.soldout.log.map(x=>`<tr><td>${(x.d||'').slice(5)}</td><td>${x.t||''}</td><td style="text-align:left">${x.n}</td><td>${x.op==='停售'?'<span style="color:var(--red);font-weight:800">🚫 停售</span>':'<span style="color:var(--green);font-weight:800">✅ 恢復</span>'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    </section>`
  }
  // KPI（張良 2026-09-22：搬到每日數據上面）
  // v4.41.1（張良「不要30天 顯示全部 手機排版對齊」）：口徑改開店至今全史(吃d.hist=跟歷史資料檢視同一套算法)；
  // 大數換「萬」手機三卡才塞得下；日均只算有天數的月份(AB早期iCHEF月彙總天數不明就不混進分母)
  {
    const hA = d.hist || []
    const revAll = hA.reduce((t,m)=>t+(Number(m.revenue)||0),0)
    const txAll = hA.reduce((t,m)=>t+(Number(m.bills)||0),0)
    const dKn = hA.filter(m=>Number(m.days))
    const dayAvg = dKn.length ? Math.round(dKn.reduce((t,m)=>t+(Number(m.revenue)||0),0)/dKn.reduce((t,m)=>t+Number(m.days),0)) : 0
    const kv9 = n => n >= 1e6 ? Math.round(n/1e4).toLocaleString()+'<span style="font-size:.62em;font-weight:700"> 萬</span>' : Math.round(n||0).toLocaleString()
    h += `<div class="kpis">
      <div class="kpi"><div class="l">總營收</div><div class="v">${kv9(revAll)}</div></div>
      <div class="kpi"><div class="l">日均營收</div><div class="v">${kv9(dayAvg)}</div></div>
      <div class="kpi"><div class="l">總單數</div><div class="v">${kv9(txAll)}</div></div>
    </div>`
  }
  // 日表（張良 2026-09-22 v3：去NT簡化版面、日期欄凍結、至14:00=14點前營收、總營收、表頭下平均列、高低於平均用色階（綠=高於、紅=低於，深淺=差多少））
  // v4.37.9（張良「總營收跟至14:00位子交換」）：總營收移到日期旁、至14:00退第三欄——表頭+總計+平均+單日+歷史年/月列全部同步換
  const isGD = d.store === 'ground'
  // v4.30.0（張良）：分時間週期查看——全部/近7/30/90天/本月/上月；總計+平均+色階+列全部只算該期間
  const per = window._dayPeriod || 'tm' // v4.37.5 預設=本月（「全部/近N天」已退役）
  const todayP = todayTpe()
  // v4.37.4（張良「不要折疊,年按鈕在全部右邊+月按鈕第二層;選年=月列表、選月=當月每日、沒日資料顯示無每日資料」）
  const selY = per.startsWith('y:') ? per.slice(2) : (per.startsWith('m:') ? per.slice(2,6) : null) // 'y:2024' / 'm:2024-03'
  const selM = per.startsWith('m:') ? per.slice(2) : null
  const inPer = x => { if (per==='all') return true
    if (selM) return String(x.date).slice(0,7) === selM
    if (selY || per==='hist') return false // 年/歷年模式＝不看日列
    if (per==='tm') return String(x.date).slice(0,7) === todayP.slice(0,7)
    if (per==='lm') { const t2 = new Date(todayP.slice(0,7)+'-15'); t2.setMonth(t2.getMonth()-1); return String(x.date).slice(0,7) === t2.toISOString().slice(0,7) }
    const cut = new Date(todayP); cut.setDate(cut.getDate()-(+per)); return String(x.date) > cut.toISOString().slice(0,10) }
  const dv = d.days.filter(x=>x.rev>0 && !x.live && inPer(x)) // 平均只算有營業的日子（盤中不入平均）
  const mean = f => { const a = dv.map(f).filter(v=>v!=null&&isFinite(v)); return a.length ? a.reduce((s2,v)=>s2+v,0)/a.length : null }
  const luOf = x => x.lunchRev!=null ? x.lunchRev : (x.lunchPct!=null&&x.rev ? x.rev*x.lunchPct/100 : null)
  const avR = mean(x=>x.rev), avLu = isGD?mean(luOf):null, avTx = mean(x=>x.tx||null)
  const avAvg = (()=>{ const tr=dv.reduce((s2,x)=>s2+(x.rev||0),0), tt=dv.reduce((s2,x)=>s2+(x.tx||0),0); return tt?tr/tt:null })()
  const avCash = mean(x=>x.cash), avCard = mean(x=>x.card), avLp = mean(x=>x.linepay||null), avUb = mean(x=>x.uber||null), avDis = mean(x=>x.discount||null)
  const avKp = isGD?mean(x=>x.kioskPct):null, avTk = isGD?mean(x=>x.takePct):null
  const avSet = isGD?(()=>{ const a=(d.setPcts||[]).filter(v=>v!=null); return a.length?a.reduce((s2,v)=>s2+v,0)/a.length:null })():null
  const fN = v => v!=null ? Math.round(v).toLocaleString() : '—' // 去 NT$：數字乾淨版面
  const fP = v => v!=null?Math.round(v)+'%':'—'
  // 色階：跟該欄平均比，高=綠、低=紅，差越多越深（±3%內不上色）
  const heat = (v, avg) => { if (v==null||!avg) return ''; let dv2=(v-avg)/avg; if (Math.abs(dv2)<0.03) return ''; dv2=Math.max(-0.5,Math.min(0.5,dv2)); const a=Math.min(0.50,0.10+Math.abs(dv2)*0.8); return `background:rgba(${dv2>0?'229,57,53':'27,176,83'},${a.toFixed(2)})` } // v4.41.2 張良「紅綠明顯一點」：0.10起跳最深0.5+顏色換鮮一階；紅=高於平均(台灣看盤習慣)、綠=低於（2026-09-22 指定反轉）
  const hc = (v, avg, extra) => `<td style="${heat(v,avg)}${extra?';'+extra:''}">${fN(v)}</td>`
  const perChip = (k,l) => `<button class="mini${per===k?' on':''}" style="padding:4px 11px" onclick="dayPer('${k}')">${l}</button>`
  // v4.37.5（張良「近幾天/全部拿掉；第一層=本月/上月/今年/歷史資料；歷史資料點開其他年份新→舊；月鈕手機一排6個」）
  const histMos = new Set((d.hist||[]).map(m=>m.month))
  const yrsAll = [...new Set((d.hist||[]).map(m=>m.month.slice(0,4)))].sort()
  const curY = todayP.slice(0,4)
  const pastYrs = yrsAll.filter(y=>y<curY).sort().reverse() // 2025 2024 2023 2022 2021
  const histMode = per==='hist' // v4.37.8：點「歷史資料」＝直接顯示歷年年度總表（今年鈕取消選取、今年資料不留）
  const histOpen = histMode || !!(selY && selY<curY)
  let yrChips = `<button class="mini${selY===curY?' on':''}" style="padding:4px 11px" onclick="dayPer('y:${curY}')">${curY}</button>`
  if (pastYrs.length) yrChips += `<button class="mini${histOpen?' on':''}" style="padding:4px 11px" onclick="histYrs()">歷史資料</button>`
  let moChips = ''
  if (histOpen && pastYrs.length) moChips += `<div style="display:flex;gap:5px;flex-wrap:wrap;margin:-3px 0 8px">` + pastYrs.map(y=>`<button class="mini${selY===y?' on':''}" style="padding:4px 11px" onclick="dayPer('y:${y}')">${y}</button>`).join('') + `</div>`
  if (selY){ // 月鈕：格狀（手機寬≈一排6個、桌機自動一排更多）
    moChips += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(54px,1fr));gap:5px;margin:-3px 0 8px;max-width:760px">` + Array.from({length:12},(_,i2)=>{
      const mo9 = `${selY}-${String(i2+1).padStart(2,'0')}`
      const has = histMos.has(mo9)
      return has ? `<button class="mini${selM===mo9?' on':''}" style="padding:6px 0;text-align:center" onclick="dayPer('${selM===mo9?('y:'+selY):('m:'+mo9)}')">${i2+1}月</button>`
                 : `<button class="mini" style="padding:6px 0;text-align:center;opacity:.3;cursor:default">${i2+1}月</button>`
    }).join('') + `</div>`
  }
  h += `<section><h2>每日數據 ${isGD?(()=>{let t9='';try{t9=new Date(d.updatedAt).toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'})}catch(e){}return `<button class="mini" id="pfBtn" style="float:right" title="資料時間——按一下現抓最新" onclick="posFresh()">🔄 ${t9}</button>`})():``}</h2><div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">${perChip('tm','本月')}${perChip('lm','上月')}${yrChips}</div>${moChips}<div class="scroll" style="max-height:62vh;overflow-y:auto"><table><thead><tr><th style="position:sticky;left:0;z-index:3;text-align:left">日期</th><th>總營收</th>${isGD?'<th>至14:00</th>':''}<th>單數</th><th>單均</th><th>現金</th><th>信用卡</th><th>LINE Pay</th><th>Uber</th><th>折扣</th>${isGD?'<th>自助%</th><th>外帶%</th><th>套餐/主餐%</th>':''}</tr></thead><tbody>`
  const avBg = 'background:var(--psoft);font-weight:800;color:var(--pdark)'
  // 總計列（張良：平均上面放總數+總天數）
  const sm = f => { const a = dv.map(f).filter(v=>v!=null&&isFinite(v)); return a.length ? a.reduce((s2,v)=>s2+v,0) : null }
  const tRev = sm(x=>x.rev), tTx = sm(x=>x.tx||null)
  const tBg = 'background:var(--soft);font-weight:900'
  const avLine = ';border-bottom:2.5px solid #3B4654' // 平均下加線區隔（張良）
  const yearMode = !!(selY && !selM)
  const monthDays = selM ? d.days.map((x,i)=>[x,i]).filter(([x])=>String(x.date).slice(0,7)===selM) : null
  const monthNoDaily = !!(selM && !(monthDays && monthDays.length))
  if (!histMode && !yearMode && !monthNoDaily){
    h += `<tr><td style="position:sticky;left:0;z-index:1;${tBg}">總計<span class="hint" style="font-weight:700">（${dv.length}天）</span></td><td style="${tBg}">${fN(tRev)}</td>${isGD?`<td style="${tBg}">${fN(sm(luOf))}</td>`:''}<td style="${tBg}">${tTx!=null?Math.round(tTx).toLocaleString():'—'}</td><td style="${tBg}">${fN(tRev&&tTx?tRev/tTx:null)}</td><td style="${tBg}">${fN(sm(x=>x.cash))}</td><td style="${tBg}">${fN(sm(x=>x.card))}</td><td style="${tBg}">${fN(sm(x=>x.linepay||null))}</td><td style="${tBg}">${fN(sm(x=>x.uber||null))}</td><td style="${tBg}">${fN(sm(x=>x.discount||null))}</td>${isGD?`<td style="${tBg}">—</td><td style="${tBg}">—</td><td style="${tBg}">—</td>`:''}</tr>`
    h += `<tr><td style="position:sticky;left:0;z-index:1;${avBg}${avLine};font-weight:900">平均</td><td style="${avBg};font-weight:900">${fN(avR)}</td>${isGD?`<td style="${avBg}${avLine}">${fN(avLu)}</td>`:''}<td style="${avBg}${avLine}">${avTx!=null?Math.round(avTx):'—'}</td><td style="${avBg}${avLine}">${fN(avAvg)}</td><td style="${avBg}${avLine}">${fN(avCash)}</td><td style="${avBg}${avLine}">${fN(avCard)}</td><td style="${avBg}${avLine}">${fN(avLp)}</td><td style="${avBg}${avLine}">${fN(avUb)}</td><td style="${avBg}${avLine}">${fN(avDis)}</td>${isGD?`<td style="${avBg}${avLine}">${fP(avKp)}</td><td style="${avBg}${avLine}">${fP(avTk)}</td><td style="${avBg}${avLine}">${fP(avSet)}</td>`:''}</tr>`
  }
  let zbi = 0
  const dayRow = (x,i,indent)=>{ // 單日列（樹狀模式縮排共用）
    const wknd = x.wd==='六'||x.wd==='日'
    const zb = ((zbi++)%2===0) ? '#191F28' : 'var(--card)' // 凍結欄自帶底色
    const lu = luOf(x)
    return `<tr><td style="position:sticky;left:0;z-index:1;background:${zb};text-align:left;font-weight:${wknd?800:500};color:${wknd?'#A85C26':'inherit'}${indent?';padding-left:28px':''}">${x.date.slice(5)}（${x.wd}）${(window._twHol||{})[x.date]?`<span style="font-size:10px;color:#F2C14E;font-weight:800;margin-left:3px">${twShort(window._twHol[x.date])}</span>`:((window._twWk||{})[x.date]?`<span style="font-size:10px;color:#8C98A8;margin-left:3px">補班</span>`:'')}</td>${hc(x.rev,avR,'font-weight:700')}${isGD?hc(lu,avLu):''}<td style="${heat(x.tx,avTx)}">${x.tx||'—'}</td>${hc(x.avg,avAvg)}${hc(x.cash,avCash)}${hc(x.card,avCard)}<td style="${heat(x.linepay||null,avLp)}">${x.linepay?fN(x.linepay):'—'}</td><td style="${heat(x.uber||null,avUb)}">${x.uber?fN(x.uber):'—'}</td><td style="${heat(x.discount||null,avDis)}">${x.discount?fN(x.discount):'—'}</td>${isGD?`<td style="${heat(x.kioskPct,avKp)}">${x.kioskPct!=null?x.kioskPct+'%':'—'}</td><td style="${heat(x.takePct,avTk)}">${x.takePct!=null?x.takePct+'%':'—'}</td><td style="${heat(d.setPcts[i],avSet)}">${d.setPcts[i]!=null?d.setPcts[i]+'%':'—'}</td>`:''}</tr>`
  }
  // v4.37.4（張良「不要折疊——年鈕+月鈕兩層；選年=逐月、選月=逐日、沒日資料顯示無每日資料」）
  if (histMode){ // v4.37.8 歷年年度總表：一年一列（點列=進該年逐月）
    const byY8 = {}
    ;(d.hist||[]).forEach(m=>{ const y8=m.month.slice(0,4); const o=byY8[y8]=byY8[y8]||{rev:0,b:0,c:0,mo:0}; o.rev+=Number(m.revenue)||0; o.b+=Number(m.bills)||0; o.c+=Number(m.customers)||0; o.mo++ })
    const ys8 = Object.keys(byY8).sort().reverse()
    const aRev = ys8.reduce((t,y8)=>t+byY8[y8].rev,0), aB = ys8.reduce((t,y8)=>t+byY8[y8].b,0)
    h += `<tr><td style="position:sticky;left:0;z-index:1;${tBg}">開店至今<span class="hint" style="font-weight:700">（${(d.hist||[]).length}個月）</span></td><td style="${tBg}">${fN(aRev)}</td>${isGD?`<td style="${tBg}">—</td>`:''}<td style="${tBg}">${aB?aB.toLocaleString():'—'}</td><td style="${tBg}">${aB?fN(aRev/aB):'—'}</td><td style="${tBg}" colspan="${5+(isGD?3:0)}"></td></tr>`
    const avY8 = ys8.length ? aRev/ys8.length : null
    ys8.forEach(y8=>{
      const o = byY8[y8]
      h += `<tr onclick="dayPer('y:${y8}')" title="點我看 ${y8} 逐月" style="cursor:pointer"><td style="position:sticky;left:0;z-index:1;background:#191F28;text-align:left;font-weight:800">${y8} 年<span class="hint">（${o.mo}月${o.c?`・客 ${o.c.toLocaleString()}`:''}）</span></td>${hc(o.rev,avY8,'font-weight:800')}${isGD?'<td>—</td>':''}<td>${o.b?o.b.toLocaleString():'—'}</td><td>${o.b?fN(o.rev/o.b):'—'}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>${isGD?'<td>—</td><td>—</td><td>—</td>':''}</tr>`
    })
  } else if (yearMode){
    const ms = (d.hist||[]).filter(m=>m.month.startsWith(selY)).sort((a,b)=>(a.month<b.month?-1:1))
    const dayByMo = {}
    d.days.forEach(x=>{ const mo9=String(x.date).slice(0,7); (dayByMo[mo9]=dayByMo[mo9]||[]).push(x) })
    const yRev = ms.reduce((t,m)=>t+(Number(m.revenue)||0),0), yB = ms.reduce((t,m)=>t+(Number(m.bills)||0),0)
    h += `<tr><td style="position:sticky;left:0;z-index:1;${tBg}">${selY} 年合計<span class="hint" style="font-weight:700">（${ms.length}月）</span></td><td style="${tBg}">${fN(yRev)}</td>${isGD?`<td style="${tBg}">—</td>`:''}<td style="${tBg}">${yB?yB.toLocaleString():'—'}</td><td style="${tBg}">${yB?fN(yRev/yB):'—'}</td><td style="${tBg}" colspan="${5+(isGD?3:0)}"></td></tr>`
    h += `<tr><td style="position:sticky;left:0;z-index:1;${avBg}${avLine};font-weight:900">月均</td><td style="${avBg};font-weight:900">${fN(ms.length?yRev/ms.length:null)}</td>${isGD?`<td style="${avBg}${avLine}">—</td>`:''}<td style="${avBg}${avLine}">${ms.length&&yB?Math.round(yB/ms.length).toLocaleString():'—'}</td><td style="${avBg}${avLine}" colspan="${6+(isGD?3:0)}"></td></tr>`
    const avMo = ms.length ? yRev/ms.length : null
    ms.forEach(m=>{
      const dR = dayByMo[m.month]
      const s9 = f => dR ? dR.reduce((t,x)=>t+(Number(f(x))||0),0) : null
      const c9=dR?s9(x=>x.cash):null, k9=dR?s9(x=>x.card):null, l9=dR?s9(x=>x.linepay):null, u9=dR?s9(x=>x.uber):null, di9=dR?s9(x=>x.discount):null
      h += `<tr onclick="dayPer('m:${m.month}')" title="點我看 ${m.month} 每日數據" style="cursor:pointer"><td style="position:sticky;left:0;z-index:1;background:#191F28;text-align:left;font-weight:700">${+m.month.slice(5)}月<span class="hint">（${m.days??'—'}天${m.customers?`・客 ${Number(m.customers).toLocaleString()}`:''}）</span></td>${hc(Number(m.revenue)||0,avMo,'font-weight:800')}${isGD?'<td>—</td>':''}<td>${m.bills!=null?Number(m.bills).toLocaleString():'—'}</td><td>${m.bills?fN(m.revenue/m.bills):'—'}</td><td>${c9!=null?fN(c9):'—'}</td><td>${k9!=null?fN(k9):'—'}</td><td>${l9?fN(l9):'—'}</td><td>${u9?fN(u9):'—'}</td><td>${di9?fN(di9):'—'}</td>${isGD?'<td>—</td><td>—</td><td>—</td>':''}</tr>`
    })
    if (!ms.length) h += `<tr><td colspan="${isGD?13:9}" class="mut" style="text-align:center;padding:14px">這一年沒有資料</td></tr>`
  } else if (monthNoDaily){
    const m = (d.hist||[]).find(x=>x.month===selM)
    if (m) h += `<tr><td style="position:sticky;left:0;z-index:1;${tBg}">${selM} 月合計</td><td style="${tBg}">${fN(m.revenue)}</td>${isGD?`<td style="${tBg}">—</td>`:''}<td style="${tBg}">${m.bills!=null?Number(m.bills).toLocaleString():'—'}</td><td style="${tBg}">${m.bills?fN(m.revenue/m.bills):'—'}</td><td style="${tBg}" colspan="${5+(isGD?3:0)}"></td></tr>`
    h += `<tr><td colspan="${isGD?13:9}" class="mut" style="text-align:center;padding:16px">這個月無每日資料（iCHEF 時代只有月彙總）${m&&m.customers?`・來客 ${Number(m.customers).toLocaleString()}・營業 ${m.days??'—'} 天`:''}</td></tr>`
  } else {
    d.days.forEach((x,i)=>{ if (inPer(x)) h += dayRow(x,i,false) }) // 期間篩選（v4.30.0）＝平鋪列表（全部/近N天/本月/上月/選月）
  }
  h += `</tbody></table></div></section>`
  // 📜 歷史月營收（張良 2026-10-04「補在哪？現在主要都用prep」）：AB=2021-02 開店起全史（iCHEF 時代只有月彙總）；
  // 有日結的月份=日結加總（跟上表/KPI 同口徑），更早=阿桑系統 /revenue/monthly
  // v4.37.3：獨立「歷史月營收」區塊退役——已整合進上面「每日數據」的年▸月▸日三層樹（全部模式）
  // 品項明細（張良 2026-09-22 v2：互動區塊——全部/分類/依品類分組＋欄位排序＋售價＋%欄＋🙈隱藏管理；itemsRender 畫）
  window._bd = d // v4.42.1 品項明細搬「銷售數據」分頁（張良）；_bd 留著給每日數據期間切換用
  // 時段
  if (d.slots) {
    const draw = (label, arr) => {
      if (!arr.length) return ''
      const mx = Math.max(...arr.map(a=>a[1]), 1)
      return `<h2 style="margin-top:12px">${label} <span class="hint">近30天每小時平均單數</span></h2><div class="slotrow">` +
        arr.map(a=>`<div class="slot"><span style="font-size:11.5px;font-weight:700;color:var(--pdark)">${a[1]}</span><span class="bar" style="height:${Math.max(4, a[1]/mx*56)}px"></span><span>${a[0]}時</span></div>`).join('') + '</div>'
    }
    h += `<section>${draw('平日時段', d.slots.wk)}${draw('週末時段', d.slots.we)}</section>`
  }
  app.innerHTML = h
  todayRender()
  if (store === 'ground') { sopLoad(); soLoad() } // 銷量預測驗證區 fcsec 隨備料搬家（v4.42.0）
  if (!window._pf) { window._pf = 1; setTimeout(prefetchTabs, 800) } // 背景預抓其他分頁（切換秒開）
}
// ── 🍳 備料分頁（v4.42.0 張良拍板：預估備料量+預做節奏表從首頁搬家；App 當初就是為備料而生，現在升格獨立分頁） ──
function renderPrep(d, store){ // v4.42.1 分頁改名「銷售數據」＝備料量+節奏表+品項明細（張良）
  document.getElementById('upd').textContent = '銷售數據・備料照「今天星期幾」那欄的量'
  window._bd = d // 品項明細（itemsRender）吃這份
  let h = ''
  // 備料卡（GD：炸台/沙拉/吧檯；總平均＋每週幾平均——張良 2026-09-20 取消時段拆分，一早備好）
  if (d.prep) {
    const grps = [...new Set(d.prep.map(p=>p.grp))]
    let tw = new Date().getDay() // 今天星期幾（1~5發光）
    if (tw === 0 || tw === 6) tw = 1 // 週六日（GD公休）打開＝在準備週一的量 → 發光週一（張良 2026-09-20 抓到週日沒東西亮）
    h += `<section><h2>預估備料量 <span class="hint">份/日</span><button class="mini" style="float:right" onclick="prepLogView()">📜 紀錄</button></h2>`
    h += `<div class="scroll"><table class="tight"><thead><tr><th>項目</th><th class="todaycol">今日實備✏️</th><th>平均</th>${['一','二','三','四','五'].map((w,i)=>`<th${tw===i+1?' class="todaycol"':''}>週${w}${tw===i+1?' ★':''}</th>`).join('')}</tr></thead><tbody>`
    grps.forEach(g=>{
      h += `<tr class="catband"><td colspan="10">${g}</td></tr>`
      d.prep.filter(p=>p.grp===g).forEach(p=>{
        const wds = (p.byWd||[]).map((v,i)=>{
          if(v==null) return `<td>—</td>`
          return `<td${tw===i+1?' class="todaycol"':''}><b>${v}</b></td>` // ±%與峰低值取消（張良 2026-09-25：版面乾淨）
        }).join('')
        const av=(window._prepAct||{})[p.name]
        const s86 = (window._prepS86||{})[p.name]
        const nmE = p.name.replace(/'/g,"\\'")
        const tb = 'font-size:10.5px;padding:1px 5px;border:1px solid var(--line);border-radius:6px;background:var(--card);cursor:pointer;color:var(--text)'
        const actTd = p.sub ? `<td class="todaycol mut">—</td>` : `<td class="todaycol"><div style="display:inline-flex;gap:3px;align-items:center;white-space:nowrap"><input inputmode="numeric" value="${av!=null?av:''}" placeholder="填" style="width:42px;padding:2px;border:1.5px solid #9EC5E8;border-radius:6px;text-align:center;font-weight:800;font-size:13px" onchange="actSave('${nmE}',this.value)"><button title="追加（又備了幾份）" style="${tb}" onclick="actAdd('${nmE}')">＋</button><button title="耗損記錄" style="${tb}" onclick="actLoss('${nmE}')">耗</button><button title="86停售/回賣" style="${tb};${s86?'color:var(--red);border-color:var(--red);font-weight:800':''}" onclick="act86('${nmE}',${s86?1:0})">86</button></div></td>`
        h += `<tr${p.sub?' class="subrow"':''}><td style="font-weight:${p.sub?800:700};color:${p.sub?'#8a5a2e':'var(--ink)'}">${p.sub?'└ ':''}${p.name}${s86?' <span style="color:var(--red);font-weight:900;font-size:12px;border:1.5px solid var(--red);border-radius:5px;padding:0 4px">86</span>':''}</td>${actTd}<td class="avg">${p.avg!=null?p.avg:'—'}</td>${wds}</tr>`
      })
    })
    h += `</tbody></table></div><div class="hint" style="margin-top:8px">怎麼用：①平均＝近30天「去掉最高/最低各一天」的截尾平均（颱風日/異常日不拉偏；樣本不足8天不截）②看今天星期幾那欄（藍底）＝該星期的截尾平均，照這個數備。</div></section>`
  }
  // 預做節奏表（完整菜單＋品類分組＋隱藏設定；內容由 rhythmRender 畫）
  if (d.rhythm) {
    window._rhy = d.rhythm
    h += `<section><h2>預做節奏表 <span style="float:right;white-space:nowrap"><button class="mini${rhyMode===15?' on':''}" id="rb15" onclick="rSwitch(15)">15分</button><button class="mini${rhyMode===30?' on':''}" id="rb30" onclick="rSwitch(30)">30分</button><button class="mini" id="rbMng" onclick="rMng()">🙈 隱藏管理</button></span><br><span class="hint">${d.rhythm.days ? `近 ${d.rhythm.days} 個營業日平均・每格＝該時段平均賣幾份（·＝不到0.5份）——照表預做、尖峰前先備` : '⏳ 資料累積中（GD 從 2026-09-21 起、AB 從 2026-09-22 起含歷史回補）——顯示近 7 個營業日平均，跑幾天會越來越準'}</span></h2><div id="rhyBody"></div></section>`
  }
  if (!d.prep && !d.rhythm) h += `<section class="mut">這家店還沒有備料資料</section>`
  h += `<div id="itemsec"></div>` // 品項明細（v4.42.1 從首頁搬來；itemsRender 畫）
  if (store === 'ground') h += `<div id="fcsec"></div>` // 銷量預測驗證區（主管限定）跟著備料走
  h += soldoutH // v4.48.2 停售動態放最下方（張良）
  app.innerHTML = h
  rhythmRender()
  itemsRender()
  if (store === 'ground') fcLoad()
}
async function prepPage(fresh){ // 備料分頁入口：跟首頁同一包 opsboard 資料、同快取（stale-first 秒開）
  curStore = 'prep'; setTabs('prep')
  const store = lastStore
  const ck = 'obc_' + store
  let had = false
  try { const c = localStorage.getItem(ck); if (c) { renderBoard(JSON.parse(c), store, 'prep'); had = true } } catch(_){}
  if (!had) app.innerHTML = '<section>載入中…</section>'
  let d
  try { const r = await fetch('/api/mail-sync?opsboard=' + encodeURIComponent(K) + '&store=' + store + (fresh ? '&r=' + Date.now() : '')); d = await r.json() } catch(_){}
  if (d && d.prepAct) window._prepAct = d.prepAct
  if (d && d.prepS86) window._prepS86 = d.prepS86
  if (!d || !d.ok) { if (!had) app.innerHTML = '<div class="err">讀不到資料（金鑰錯誤或連線問題）</div>'; return }
  try { localStorage.setItem(ck, JSON.stringify(d)) } catch(_){}
  if (curStore !== 'prep') return
  renderBoard(d, store, 'prep')
}
// 實際備料填寫（張良 2026-10-01：每天留紀錄做分析；要綁定GD身分才能填）
window._prepAct = {}
async function actSave(item, val){
  try{
    const r = await fetch('/api/mail-sync?prepact=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ item, qty: val, token: TK() }) })
    const j = await r.json()
    if(!j.ok){ alert(j.error || '儲存失敗'); return }
    window._prepAct = j.act || {}
    window._prepS86 = j.s86 || {}
  }catch(e){ alert('儲存失敗，再試一次') }
}
// v4.13.0（張良）：追加/耗損/86——每筆記誰+時間(+原因)
async function actOp(body){
  const r = await fetch('/api/mail-sync?prepact=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...body, token: TK() }) })
  const j = await r.json().catch(()=>null)
  if (j && j.ok) { window._prepAct = j.act || {}; window._prepS86 = j.s86 || {}; if (curStore==='ground'||curStore==='abeach') load(lastStore, true) }
  else alert((j&&j.error)||'失敗')
}
function prepAsk(title, withQty, withReason, cb, ph){
  const ov = document.createElement('div'); ov.id='paOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:70;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(340px,92vw);padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:10px">${title}</div>
    ${withQty?`<input id="paQ" inputmode="numeric" placeholder="數量" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:16px;margin-bottom:8px">`:''}
    ${withReason?`<input id="paR" placeholder="${ph||'原因（例：做壞/掉了/賣完）'}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:15px;margin-bottom:8px">`:''}
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="mini" style="padding:8px 12px" onclick="document.getElementById('paOv').remove()">取消</button><button class="mini on" style="padding:8px 16px" onclick="paGo()">確定</button></div></div>`
  ov.onclick = () => ov.remove()
  window._paCb = cb
  document.body.appendChild(ov)
  setTimeout(()=>{ const i2 = document.getElementById('paQ')||document.getElementById('paR'); if (i2) i2.focus() }, 60)
}
function paGo(){
  const q = Number(((document.getElementById('paQ')||{}).value||'').trim())
  const r = ((document.getElementById('paR')||{}).value||'').trim()
  const cb = window._paCb; window._paCb = null
  const o = document.getElementById('paOv'); if (o) o.remove()
  if (cb) cb(q, r)
}
function actAdd(item){ prepAsk(`＋ 追加備料：${item}`, 1, 0, (q)=>{ if (!(q>0)) { alert('數量要大於 0'); return } actOp({ op:'add', item, qty: q }) }) }
function actLoss(item){ prepAsk(`耗損記錄：${item}`, 1, 1, (q, r)=>{ if (!(q>0)) { alert('數量要大於 0'); return } actOp({ op:'loss', item, qty: q, reason: r }) }) }
function act86(item, on){
  if (on) { if (confirm(`「${item}」恢復販售？`)) actOp({ op:'86', item, on: 0 }) }
  else prepAsk(`86 停售：${item}`, 0, 1, (q, r)=>{ actOp({ op:'86', item, on: 1, reason: r }) })
}
async function prepLogView(ym){
  window._plYm = ym || window._plYm || todayTpe().slice(0,7)
  let d2 = null
  try { const r = await fetch('/api/mail-sync?preplog=' + encodeURIComponent(K) + '&ym=' + window._plYm + '&r=' + Date.now()); d2 = await r.json() } catch(e){}
  if (!d2 || !d2.ok) { alert('讀不到紀錄'); return }
  const old = document.getElementById('plOv'); if (old) old.remove()
  const tpe = ts => { try { return new Date(ts).toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}) } catch(e){ return '' } }
  const dts = Object.keys(d2.days||{}).sort().reverse()
  const body = dts.length ? dts.map(dt=>{
    const rows = []
    Object.entries(d2.days[dt]).forEach(([nm,v])=>{
      const lg = (v.log && v.log.length) ? v.log : [{ t:'填', q: v.q, by: v.by, ts: v.ts }] // 舊格式沒log也顯示
      lg.forEach(l2=>rows.push({ nm, ...l2 }))
    })
    rows.sort((a2,b2)=>String(a2.ts||'').localeCompare(String(b2.ts||'')))
    const cl = t2 => (t2==='耗損'||t2==='86停售') ? 'var(--red)' : t2==='回賣' ? 'var(--green)' : t2==='追加' ? 'var(--pdark)' : 'var(--text)'
    return `<div style="font-weight:900;color:var(--pdark);margin:12px 0 4px">${dt.slice(5)}（${['日','一','二','三','四','五','六'][new Date(dt).getDay()]}）</div>
    <div class="scroll"><table style="min-width:500px;border-collapse:collapse"><thead><tr>${['品項','時間','動作','數量','原因','人'].map((x2,i2)=>`<th style="border:1px solid var(--line);padding:5px 7px;${i2===0||i2===4||i2===5?'text-align:left':'text-align:center'}">${x2}</th>`).join('')}</tr></thead><tbody>${rows.map(r2=>`<tr><td style="border:1px solid var(--line);padding:5px 7px;text-align:left;font-weight:700">${r2.nm}</td><td style="border:1px solid var(--line);padding:5px 7px;text-align:center">${tpe(r2.ts)}</td><td style="border:1px solid var(--line);padding:5px 7px;text-align:center;font-weight:800;color:${cl(r2.t)}">${r2.t}</td><td style="border:1px solid var(--line);padding:5px 7px;text-align:center;font-weight:800">${r2.q!=null?r2.q:'—'}</td><td style="border:1px solid var(--line);padding:5px 7px;text-align:left">${r2.r||'—'}</td><td style="border:1px solid var(--line);padding:5px 7px;text-align:left">${r2.by||'—'}</td></tr>`).join('')}</tbody></table></div>`
  }).join('') : '<div class="mut">這個月還沒有紀錄</div>'
  const ov = document.createElement('div'); ov.id='plOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(640px,94vw);max-height:88vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><b style="font-size:16px">📜 備料紀錄</b>
      <button class="mini" onclick="prepLogView(prevYm(window._plYm))">‹</button><b>${window._plYm}</b><button class="mini" onclick="prepLogView(nextYm(window._plYm))">›</button>
      <button class="mini" style="margin-left:auto;padding:7px 12px" onclick="document.getElementById('plOv').remove()">關閉</button></div>
    <div class="hint" style="margin-bottom:6px">每一筆填數/追加/耗損/86 都記誰＋時間＋原因。</div>${body}</div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
const prevYm = ym => { const t2 = new Date(ym + '-15'); t2.setMonth(t2.getMonth()-1); return t2.toISOString().slice(0,7) }
const nextYm = ym => { const t2 = new Date(ym + '-15'); t2.setMonth(t2.getMonth()+1); return t2.toISOString().slice(0,7) }
