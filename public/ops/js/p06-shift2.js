// ⚠️ 這是 /prep 主程式的第 6/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：班表(複製/請假)+工時前段
// ── ⧉ 複製功能（張良 2026-10-02：複製一格/一天/一週）──
function queueSaveTmp(tmp){ // 樂觀卡入列＋排隊寫入（成功換正式id）
  window._shiftTmpQ.push(tmp); window._shiftD.sched.push(tmp)
  shQueue(async ()=>{
    if (tmp._del) { window._shiftTmpQ = window._shiftTmpQ.filter(x=>x!==tmp); return }
    const send = { ...tmp }; delete send.id; delete send._del
    const d2 = await shPost({ op:'save', item: send, token: TK() })
    window._shiftTmpQ = window._shiftTmpQ.filter(x=>x!==tmp)
    if (d2 && d2.ok) { if (d2.id) tmp.id = d2.id }
    else { const dd = window._shiftD; dd.sched = dd.sched.filter(x=>x!==tmp); shiftRender(); alert('寫入失敗：'+tmp.name) }
  })
}
function cellClick(pos, dt){ if (window._shiftCopy && window._shiftCopy.on) { pasteApply(pos, dt); return } shiftQuick(pos, dt) }
function dayClick(dt){ if (window._shiftCopy && window._shiftCopy.on) { pasteApply(null, dt); return } shiftDay(dt) }
function copyCell(pos, dt){
  window._lastCopy = []
  const d = window._shiftD
  const items = d.sched.filter(x=>x.date===dt && (x.pos||'未分崗')===pos)
  if (!items.length) { alert('這格沒班可複製'); return }
  window._shiftCopy = { on:1, type:'cell', items: items.map(x=>({ name:x.name, start:x.start, end:x.end, break:x.break||0, pos:x.pos||'', tr:x.tr||'' })) }
  const o = document.getElementById('qkOv'); if (o) o.remove()
  pasteBar('已複製這格——點要貼上的格子（可連貼好幾格），貼完按「完成」')
}
function copyDay(dt){
  window._lastCopy = []
  const d = window._shiftD
  const items = d.sched.filter(x=>x.date===dt)
  if (!items.length) { alert('這天沒班可複製'); return }
  window._shiftCopy = { on:1, type:'day', items: items.map(x=>({ name:x.name, start:x.start, end:x.end, break:x.break||0, pos:x.pos||'', tr:x.tr||'' })) }
  const o = document.getElementById('sdOv'); if (o) o.remove()
  pasteBar('已複製整天——點目標日期的「表頭」貼上，貼完按「完成」')
}
function pasteApply(pos, dt){
  const c = window._shiftCopy, d = window._shiftD
  if (c.type === 'day' && pos !== null) { alert('整天複製要點日期「表頭」貼上'); return }
  const exist = new Set(d.sched.map(x=>[x.name, x.date, x.pos||''].join('|')))
  let n = 0
  c.items.forEach(it=>{
    const p2 = c.type === 'cell' ? (pos === '未分崗' ? '' : pos) : (it.pos || '')
    if (exist.has([it.name, dt, p2].join('|'))) return
    exist.add([it.name, dt, p2].join('|'))
    const tmp = { name: it.name, date: dt, start: it.start, end: it.end, break: it.break, pos: p2, id: 'tmp' + Math.random().toString(36).slice(2) }
    if (it.tr) tmp.tr = it.tr
    ;(window._lastCopy = window._lastCopy || []).push(tmp) // 可復原（v4.6.4）
    queueSaveTmp(tmp); n++
  })
  shiftRender()
  if (!n) alert('目標已經有一樣的班，沒有新增')
}
// v4.10.2（張良）：班卡拖到班表「外面」放掉＝直接刪除（格子/未排區各自攔截，掉到其他地方=丟掉）
document.addEventListener('dragover', e2 => { if (window._shiftDragId) e2.preventDefault() })
document.addEventListener('drop', e2 => {
  const id = window._shiftDragId; if (!id) return
  e2.preventDefault(); window._shiftDragId = null
  if (String(id).startsWith('u|')) return // 未排名片丟外面＝不做事
  shiftDelFast(id)
})
// 班卡拖下來丟回未排區＝取消排班（張良 2026-10-02「也要可以拉回去」）
function unschedDrop(ev){
  ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.style.outline = ''
  const id = ev.dataTransfer.getData('text/plain')
  if (!id || id.startsWith('u|')) return
  shiftDelFast(id)
}
// ↩️ 復原上一次複製（張良 2026-10-02「複製了但我不要了」）
function undoLastCopy(){
  const L = window._lastCopy || [], d = window._shiftD
  L.forEach(x=>{
    d.sched = d.sched.filter(y=>y!==x)
    if (String(x.id).startsWith('tmp')) { x._del = 1 } // 還在排隊＝取消不送
    else shQueue(async ()=>{ const r = await shPost({ op:'del', id: x.id, token: TK() }); if (!(r&&r.ok)) alert('復原失敗：'+x.name) })
  })
  window._lastCopy = []
  pasteOff(); shiftRender()
}
// 🗑 清空某一天（張良 2026-10-02「要怎麼消除整天」）——跟清空本週同一套復原機制
function clearDay(dt){
  const d = window._shiftD
  const ents = d.sched.filter(x=>x.date===dt)
  if (!ents.length) { alert('這天沒班'); return }
  if (!confirm(`把 ${dt.slice(5)} 的 ${ents.length} 筆班全部刪除？`)) return
  window._lastClear = ents.map(x=>({ ...x }))
  try { localStorage.setItem('shiftLastClear', JSON.stringify({ ts: Date.now(), list: window._lastClear })) } catch(_) {}
  ents.forEach(x=>{
    d.sched = d.sched.filter(y=>y!==x)
    if (String(x.id).startsWith('tmp')) { const t2 = window._shiftTmpQ.find(q=>q.id===x.id); if (t2) t2._del = 1 }
    else shQueue(async ()=>{ const r = await shPost({ op:'del', id: x.id, token: TK() }); if (!(r&&r.ok)) alert('刪除失敗：'+x.name) })
  })
  shiftRender()
  pasteOff(1)
  const b9 = document.createElement('div'); b9.id = 'pasteBar'
  b9.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:60;background:#10182B;color:#fff;border-radius:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;font-size:14px'
  b9.innerHTML = `<span style="white-space:nowrap">🗑 已清空 ${dt.slice(5)}（${ents.length} 筆）</span><button class="mini" style="padding:6px 12px" onclick="undoClear()">↩️ 復原</button><button class="mini" style="padding:6px 12px" onclick="pasteOff()">好</button>`
  document.body.appendChild(b9)
}
// 🗑 清空本週（班表，打卡紀錄不動）
function clearWeek(){
  try{shWkFollow()}catch(_){}
  const d = window._shiftD
  const days = [...Array(7)].map((_,i)=>{ const t2 = new Date(window._shiftWk); t2.setDate(t2.getDate()+i); return t2.toISOString().slice(0,10) })
  const ents = d.sched.filter(x=>days.includes(x.date))
  if (!ents.length) { alert('本週沒班可清'); return }
  if (!confirm(`把這一週（${days[0].slice(5)}~${days[6].slice(5)}）的 ${ents.length} 筆班全部刪除？打卡紀錄不會動。`)) return
  window._lastClear = ents.map(x=>({ ...x })) // v4.12.0 可復原
  try { localStorage.setItem('shiftLastClear', JSON.stringify({ ts: Date.now(), list: window._lastClear })) } catch(_) {} // 按過「好」也能復原（48h）
  ents.forEach(x=>{
    d.sched = d.sched.filter(y=>y!==x)
    if (String(x.id).startsWith('tmp')) { const t2 = window._shiftTmpQ.find(q=>q.id===x.id); if (t2) t2._del = 1 }
    else shQueue(async ()=>{ const r = await shPost({ op:'del', id: x.id, token: TK() }); if (!(r&&r.ok)) alert('刪除失敗：'+x.name) })
  })
  shiftRender()
  pasteOff(1)
  const b9 = document.createElement('div'); b9.id = 'pasteBar'
  b9.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:60;background:#10182B;color:#fff;border-radius:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.3)'
  b9.innerHTML = `<span style="white-space:nowrap">🗑 已清空 ${ents.length} 筆</span><button class="mini" style="padding:6px 12px" onclick="undoClear()">↩️ 復原</button><button class="mini" style="padding:6px 12px" onclick="pasteOff()">好</button>`
  document.body.appendChild(b9)
}
function undoClear(){ // 清空本週復原：原班原樣補回（新id）；按過「好」也能從 localStorage 撈（48h）
  let L = window._lastClear || []
  if (!L.length) { try { const sv = JSON.parse(localStorage.getItem('shiftLastClear')||'null'); if (sv && Date.now()-sv.ts < 48*3600e3) L = sv.list||[] } catch(_) {} }
  if (!L.length) { alert('沒有可復原的清空紀錄'); pasteOff(); return }
  if (!confirm(`把上次清空的 ${L.length} 筆班補回來？`)) return
  L.forEach(x=>{ const tmp = { name: x.name, date: x.date, start: x.start, end: x.end, break: x.break||0, pos: x.pos||'', id: 'tmp' + Math.random().toString(36).slice(2) }; if (x.tr) tmp.tr = x.tr; queueSaveTmp(tmp) })
  window._lastClear = []
  try { localStorage.removeItem('shiftLastClear') } catch(_) {}
  pasteOff(); shiftRender()
}
async function copyWeekNext(){
  try{shWkFollow()}catch(_){}
  const d = window._shiftD
  const days = [...Array(7)].map((_,i)=>{ const t2 = new Date(window._shiftWk); t2.setDate(t2.getDate()+i); return t2.toISOString().slice(0,10) })
  const ents = d.sched.filter(x=>days.includes(x.date))
  if (!ents.length) { alert('本週沒班可複製'); return }
  if (!confirm(`把這一週（${days[0].slice(5)}~${days[6].slice(5)}）的 ${ents.length} 筆班複製到下週同一天？（下週已有的會自動跳過）`)) return
  const exist = new Set(d.sched.map(x=>[x.name, x.date, x.pos||''].join('|')))
  let n = 0
  window._lastCopy = []
  ents.forEach(x=>{
    const t2 = new Date(x.date); t2.setDate(t2.getDate()+7); const nd = t2.toISOString().slice(0,10)
    if (exist.has([x.name, nd, x.pos||''].join('|'))) return
    exist.add([x.name, nd, x.pos||''].join('|'))
    const tmp = { name: x.name, date: nd, start: x.start, end: x.end, break: x.break||0, pos: x.pos||'', id: 'tmp' + Math.random().toString(36).slice(2) }
    if (x.tr) tmp.tr = x.tr
    window._lastCopy.push(tmp)
    queueSaveTmp(tmp); n++
  })
  shiftRender()
  if (!n) { alert('下週已經都有了，沒新增'); return }
  pasteOff(1)
  const b = document.createElement('div'); b.id = 'pasteBar'
  b.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:60;background:#10182B;color:#fff;border-radius:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.3)'
  b.innerHTML = `<span style="white-space:nowrap">✓ 已複製 ${n} 筆到下週</span><button class="mini" style="padding:6px 12px" onclick="undoLastCopy()">↩️ 復原</button><button class="mini" style="padding:6px 12px" onclick="pasteOff()">好</button>`
  document.body.appendChild(b)
}
function pasteBar(msg){
  pasteOff(1)
  const b = document.createElement('div'); b.id = 'pasteBar'
  b.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:60;background:#10182B;color:#fff;border-radius:12px;padding:10px 14px;display:flex;gap:10px;align-items:center;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:92vw'
  b.innerHTML = `<span style="white-space:nowrap;max-width:68vw;overflow:hidden;text-overflow:ellipsis">⧉ ${msg}</span><button class="mini" style="padding:6px 14px" onclick="pasteOff()">完成</button>`
  document.body.appendChild(b)
}
function pasteOff(keep){ const b = document.getElementById('pasteBar'); if (b) b.remove(); if (!keep && window._shiftCopy) window._shiftCopy.on = 0 }
// 📊 人×崗位熟練度矩陣（張良 2026-10-02：訓練/排崗位安排）——次數熱力格，空白=該訓練
function shiftSkill(){
  const d = window._shiftD, PS = d.posStats || {}
  const cols = (d.posList||[])
  if (!cols.length) { alert('先建崗位清單'); return }
  const ppl = (d.staff||[])
  let max = 1
  ppl.forEach(s2=>cols.forEach(p2=>{ const c2=(PS[s2.n]||{})[p2]||0; if (c2>max) max=c2 }))
  const cell = (n,p2)=>{ const c2=(PS[n]||{})[p2]||0, t2=(PS[n]||{})['🎓'+p2]||0
    const al = c2 ? (0.15+0.7*c2/max).toFixed(2) : 0
    return `<td style="text-align:center;border:1px solid var(--line);padding:6px 4px;background:rgba(77,163,255,${al});font-weight:800;color:${c2?'#fff':'var(--muted)'}">${c2||'·'}${t2?`<span style="font-size:10.5px;opacity:.9"> 🎓${t2}</span>`:''}</td>` }
  // v4.9.4（張良）：名字欄凍結(手機橫滑不消失)+窄欄+不寫「非常態」(淡化就夠)
  const row = s2 => `<tr${s2.off?' style="opacity:.55"':''}><td style="text-align:left;border:1px solid var(--line);padding:6px 6px;font-weight:800;white-space:nowrap;position:sticky;left:0;background:#222B38;z-index:1;color:${_PBX()[((d.colors||{})[s2.n]??0)%_PBX().length]}">${s2.n}</td>${cols.map(p2=>cell(s2.n,p2)).join('')}</tr>`
  const ov = document.createElement('div'); ov.id='skOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;width:min(880px,94vw);max-height:90vh;overflow:auto;padding:18px" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px;margin-bottom:4px">📊 崗位熟練度（排過幾次）</div>
    <div class="hint" style="margin-bottom:10px">只算今天以前的班；顏色越深＝次數越多；「·」＝沒排過（該訓練的空格）；🎓n＝被帶訓次數。</div>
    <div class="scroll"><table style="border-collapse:collapse;min-width:560px"><thead><tr><th style="border:1px solid var(--line);text-align:left;padding:6px 6px;position:sticky;left:0;background:#222B38;z-index:2">夥伴</th>${cols.map(p2=>`<th style="border:1px solid var(--line);padding:6px 4px;text-align:center">${p2}</th>`).join('')}</tr></thead><tbody>${ppl.map(row).join('')}</tbody></table></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="mini" style="padding:9px 14px" onclick="document.getElementById('skOv').remove()">關閉</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
// 💾 班表版本模組（v4.13.0 張良：排好存成版本可命名,自動記姓名時間,之後套用到任何一週）
function tplSave(){
  try{shWkFollow()}catch(_){}
  const d = window._shiftD
  const days = [...Array(7)].map((_,i)=>{ const t2 = new Date(window._shiftWk); t2.setDate(t2.getDate()+i); return t2.toISOString().slice(0,10) })
  const ents = d.sched.filter(x=>days.includes(x.date))
  if (!ents.length) { alert('本週沒班可存'); return }
  prepAsk(`💾 儲存班表版本（本週 ${ents.length} 筆）`, 0, 1, (q, r)=>{
    if (!r) { alert('要取個名字'); return }
    const items = ents.map(x=>({ name: x.name, wd: Math.round((new Date(x.date) - new Date(window._shiftWk)) / 86400e3), start: x.start, end: x.end, break: x.break||0, pos: x.pos||'', tr: x.tr||'' }))
    shQueue(async ()=>{ const d2 = await shPost({ op:'tplsave', name: r, items, token: TK() }); if (!(d2&&d2.ok)) alert((d2&&d2.error)||'儲存失敗') })
  }, '版本名稱（例：標準週班／暑期班）')
}
function tplView(){
  const d = window._shiftD, T = (d.tpls||[]).slice().reverse()
  const tpe = ts => { try { const t2 = new Date(ts); return t2.toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(5) + ' ' + t2.toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}) } catch(e){ return '' } }
  const ov = document.createElement('div'); ov.id='tpOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(520px,94vw);max-height:88vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:16px">📂 班表版本</b><button class="mini" style="padding:7px 12px" onclick="document.getElementById('tpOv').remove()">關閉</button></div>
    <div class="hint" style="margin-bottom:8px">套用＝鋪到「目前看的這一週」（照週一~週日對應；已有的班自動跳過）。</div>
    ${T.length ? T.map(t2=>`<div style="display:flex;gap:8px;align-items:center;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:6px"><div style="flex:1;min-width:0"><b>${t2.name}</b> <span class="hint">${t2.items.length} 筆</span><div class="hint" style="font-size:12px">${t2.by}・${tpe(t2.ts)}</div></div><button class="mini on" style="padding:7px 12px" onclick="tplPreview('${t2.id}')">${EYE_I} 預覽</button><button class="mini" style="padding:7px 10px;color:var(--red)" onclick="if(confirm('刪除版本「${t2.name}」？'))tplDel('${t2.id}')">🗑</button></div>`).join('') : '<div class="mut">還沒有存過版本——排好一週按「💾 存版本」</div>'}</div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function tplPreview(id){ // 👁 先預覽確認再套用（張良 2026-10-02）
  const d = window._shiftD, tp = (d.tpls||[]).find(x=>x.id===id); if (!tp) return
  const days = [...Array(7)].map((_,i)=>{ const t2 = new Date(window._shiftWk); t2.setDate(t2.getDate()+i); return t2.toISOString().slice(0,10) })
  const wdN3 = ['一','二','三','四','五','六','日']
  const exist = new Set(d.sched.map(x=>[x.name, x.date, x.pos||''].join('|')))
  const PBp = _PBX(), PTp = _PTX()
  const cIdx = n => { const c2 = ((d.colors||{})[n]); if (c2 != null) return c2 % PBp.length; let i2 = 0; for (const ch of String(n)) i2 = (i2*31+ch.charCodeAt(0)) % 997; return i2 % PBp.length }
  // 快照格子＝跟班表同一個長相（張良 2026-10-02「就像這樣快照一個版本不就好了」）
  const posOrd = [...(d.posList||[])]
  tp.items.forEach(x=>{ const p2 = x.pos||'未分崗'; if (!posOrd.includes(p2)) posOrd.push(p2) })
  let addN = 0
  const BDp = 'border:1px solid var(--line);'
  const cell9 = (ps, i) => {
    const its = tp.items.filter(x=>(x.wd||0)===i && (x.pos||'未分崗')===ps)
    return `<td style="${BDp}text-align:left;vertical-align:top;padding:3px">${its.map(x=>{
      const dup = exist.has([x.name, days[i], x.pos||''].join('|'))
      if (!dup) addN++
      const pi = cIdx(x.name), ti = x.tr ? cIdx(x.tr) : -1
      const bg2 = x.tr ? `background:linear-gradient(180deg,${PBp[pi]} 50%,${PBp[ti]} 50%);` : `background:${PBp[pi]};`
      return `<div style="font-size:12.5px;line-height:1.6;${bg2}border:${x.tr?'2px dashed rgba(255,255,255,.9)':'none'};border-radius:6px;padding:3px 7px;margin:2px 0;${dup?'opacity:.4':''}"><b style="color:${PTp[pi]};font-weight:600">${x.name}</b>${x.tr?`<span style="display:block;color:${PTp[ti]};font-weight:600;font-size:11.5px">🎓${x.tr}</span>`:''}${dup?'<span style="display:block;font-size:10px;color:#fff;opacity:.9">已存在·跳過</span>':''}</div>`
    }).join('')||'<span class="mut" style="font-size:12px">—</span>'}</td>`
  }
  const cols = `<div class="scroll"><table style="table-layout:fixed;width:100%;min-width:720px;border-collapse:collapse"><colgroup><col style="width:80px">${days.map(()=>'<col>').join('')}</colgroup>
  <thead><tr><th style="${BDp}text-align:left;background:var(--soft)">崗位</th>${days.map((dt,i)=>`<th style="${BDp}text-align:center;background:var(--soft);color:#F2F5F9">${dt.slice(5)}<br>（${wdN3[i]}）</th>`).join('')}</tr></thead>
  <tbody>${posOrd.map(ps=>`<tr><td style="${BDp}text-align:left;font-weight:800;color:var(--pdark)">${ps}</td>${days.map((_,i)=>cell9(ps,i)).join('')}</tr>`).join('')}</tbody></table></div>`
  const o0 = document.getElementById('tpOv'); if (o0) o0.remove()
  const ov = document.createElement('div'); ov.id='tpPv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:61;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(900px,96vw);max-height:88vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;font-size:16px;margin-bottom:6px">${EYE_I} 預覽「${tp.name}」→ ${days[0].slice(5)}~${days[6].slice(5)}</div>
    <div class="hint" style="margin-bottom:8px">「已存在」＝這週已有同一筆會跳過、只會新增缺的；確認沒問題再按套用。</div>
    ${cols}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('tpPv').remove()">取消</button>${addN?`<button class="mini on" style="padding:9px 18px" onclick="document.getElementById('tpPv').remove();tplApply('${id}',1)">✅ 套用（新增 ${addN} 筆）</button>`:`<span class="hint" style="align-self:center">這一週已經有一模一樣的班了——先把班表捲到要套用的那一週，再開預覽</span>`}</div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function tplApply(id, skip){
  try{shWkFollow()}catch(_){}
  const d = window._shiftD, tp = (d.tpls||[]).find(x=>x.id===id); if (!tp) return
  const days = [...Array(7)].map((_,i)=>{ const t2 = new Date(window._shiftWk); t2.setDate(t2.getDate()+i); return t2.toISOString().slice(0,10) })
  if (!skip && !confirm(`把「${tp.name}」套用到 ${days[0].slice(5)}~${days[6].slice(5)}？（已有的班會跳過）`)) return
  const exist = new Set(d.sched.map(x=>[x.name, x.date, x.pos||''].join('|')))
  let n = 0
  tp.items.forEach(x=>{
    const dt = days[Math.max(0, Math.min(6, x.wd||0))]
    if (exist.has([x.name, dt, x.pos||''].join('|'))) return
    exist.add([x.name, dt, x.pos||''].join('|'))
    const tmp = { name: x.name, date: dt, start: x.start, end: x.end, break: x.break||0, pos: x.pos||'', id: 'tmp' + Math.random().toString(36).slice(2) }
    if (x.tr) tmp.tr = x.tr
    queueSaveTmp(tmp); n++
  })
  const o = document.getElementById('tpOv'); if (o) o.remove()
  shiftRender()
  alert(n ? `已套用 ${n} 筆` : '這週已經都有了，沒新增')
}
function tplDel(id){ shQueue(async ()=>{ const d2 = await shPost({ op:'tpldel', id, token: TK() }); if (!(d2&&d2.ok)) alert('刪除失敗') }) }
// 📝 班表修改紀錄（v4.12.0 張良：誰在什麼時間動了什麼）
function shiftHist(){
  const d = window._shiftD, H = d.hist || []
  const tpe = ts => { try { const t2 = new Date(ts); return t2.toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(5) + ' ' + t2.toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}) } catch(e){ return '' } }
  const ov = document.createElement('div'); ov.id='shHov'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(560px,94vw);max-height:88vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:16px">📝 班表修改紀錄</b><button class="mini" style="padding:7px 12px" onclick="document.getElementById('shHov').remove()">關閉</button></div>
    ${H.length ? H.map(x=>`<div style="display:flex;gap:9px;font-size:13.5px;padding:4px 0;border-bottom:1px solid var(--line)"><span class="hint" style="min-width:86px;white-space:nowrap">${tpe(x.ts)}</span><span style="min-width:56px;font-weight:800">${x.by||''}</span><span>${x.d||''}</span></div>`).join('') : '<div class="mut">還沒有紀錄（從現在起每筆排班/修改/刪除都會記）</div>'}</div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function shiftWkToday(){ // 回到本週（張良 2026-10-02「按今天就會回到當周」）
  const t0 = new Date(todayTpe()); t0.setDate(t0.getDate() - ((t0.getDay()+6)%7))
  window._shiftWk = t0.toISOString().slice(0,10)
  window._shScrollTo = todayTpe() // 捲回今天
  const ym2 = todayTpe().slice(0,7)
  shRangeInclude(ym2)
  if (ym2 !== shiftYm) shiftLoad(ym2); else shiftRender()
}
// ── v4.25.0 請假標記（張良「未排名單點人反黑劃掉＝那天休假請假不能排班，選 休/病/事/特/國 等假別」）──
const LEAVE_TYPES = [['休','排休/例假'],['特','特休'],['病','病假'],['事','事假'],['國','國定假'],['婚','婚假'],['喪','喪假'],['產','產假/陪產'],['公','公假']]
function shLeaveMenu(name, date){
  if (!(window._shiftD && window._shiftD.me)) return // 只有綁定者可改
  const cur = ((shMergedLeave()[date]||{})[name]) || ''
  const ov = document.createElement('div'); ov.id='lvOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.5);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:360px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:4px">🏖 ${name}・${date.slice(5)} 請假</div>
    <div class="hint" style="margin-bottom:10px">標了＝那天休假／請假，排班時會劃掉提醒不能排</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${LEAVE_TYPES.map(t=>`<button class="mini${cur===t[0]?' on':''}" style="padding:8px 12px;font-size:15px" onclick="shLeaveSet('${name}','${date}','${t[0]}')" title="${t[1]}">${t[0]}<span style="font-size:11px;opacity:.7;margin-left:3px">${t[1]}</span></button>`).join('')}</div>
    <div style="display:flex;gap:8px;justify-content:space-between;align-items:center">${cur?`<button class="mini" style="padding:8px 14px;color:var(--red)" onclick="shLeaveSet('${name}','${date}','')">✕ 取消請假</button>`:'<span></span>'}<button class="mini" style="padding:8px 14px" onclick="document.getElementById('lvOv').remove()">關閉</button></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function shLeaveSet(name, date, type){
  const ov = document.getElementById('lvOv'); if (ov) ov.remove()
  const ym = date.slice(0,7)
  const patch = o => { if(!o) return; o.leave = o.leave || {}; o.leave[date] = o.leave[date] || {}; if(type) o.leave[date][name] = type; else { delete o.leave[date][name]; if(!Object.keys(o.leave[date]).length) delete o.leave[date] } }
  if (ym === shiftYm) patch(window._shiftD) // 樂觀更新
  const cc = tcGet('shift_'+ym); if (cc) { patch(cc); tcSet('shift_'+ym, cc) }
  const box = document.getElementById('shBox'); if (box) window._shAnchor = shLeftAnchor(box); shGridOnly()
  const r = await shPost({ op:'leave', date, name, type, token: TK() })
  if (!r || !r.ok) alert((r&&r.error) || '請假標記沒存起來，請重試')
}
