// ⚠️ 這是 /prep 主程式的第 9/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：通知中心+標準照+回饋+人員管理
// ── 👥 inline 顧客資料庫＋營運洞察（v4.39.0 張良 2026-10-04：「建立顧客資料庫inline+九大數據分析首頁+#快速篩選+圖表」）──
// 資料：inline-sync ?custinsights / ?custdb(seg,page) / ?custfind(q)——全史每天自動重算累積
let custV = 'home', custSeg = 'all', custPg = 0, custRows = []
async function custLoad(view){
  curStore = 'cust'; setTabs('cust')
  if (view) { custV = view }
  document.getElementById('upd').textContent = 'inline 顧客資料庫'
  if (custV === 'home') return custHome()
  return custDb()
}
const cFetch = async (qs, ck) => { const c = ck && tcGet(ck); if (c) return c; try { const r = await fetch('/api/inline-sync?' + qs); const d = await r.json(); if (d && d.ok && ck) tcSet(ck, d); return d } catch(_) { return null } }
const cNum = n => (Number(n)||0).toLocaleString()
const cBar = (label, val, max, color, suffix) => `<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:92px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</span><div style="flex:1;background:var(--soft);border-radius:5px;height:14px;overflow:hidden"><div style="width:${max?Math.max(2,Math.round(val/max*100)):0}%;height:100%;background:${color};border-radius:5px"></div></div><span style="font-size:12px;font-weight:800;min-width:72px;text-align:right">${suffix||cNum(val)}</span></div>`
const cCard = (title, body, hint) => `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px 14px">${title?`<div style="font-weight:900;font-size:13.5px;margin-bottom:8px">${title}${hint?` <span class="hint" style="font-weight:600;font-size:10.5px">${hint}</span>`:''}</div>`:''}${body}</div>`
const cKpi = (big, label, sub, color) => cCard('', `<div style="font-size:26px;font-weight:900;color:${color||'var(--text)'};line-height:1.1">${big}</div><div style="font-size:12.5px;font-weight:800;margin-top:3px">${label}</div>${sub?`<div class="hint" style="font-size:11px;margin-top:2px">${sub}</div>`:''}`)
function custTopBar(){
  const b = (v,lb) => `<button class="mini" onclick="custLoad('${v}')" style="padding:5px 14px;font-weight:800;${custV===v?'background:var(--primary);color:#fff;border-color:var(--primary)':''}">${lb}</button>`
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap"><span style="font-weight:900;font-size:16px">inline 顧客資料庫</span>${b('home','📊 洞察首頁')}${b('db','👥 顧客資料')}<span class="hint" style="font-size:10.5px">全史自動累積・每天重算・唯讀</span></div>`
}
async function custHome(){
  app.innerHTML = `<section>${custTopBar()}<div class="mut">載入中…</div></section>`
  const d = await cFetch('custinsights=' + encodeURIComponent(K), 'custins')
  if (!d || !d.ins) { app.innerHTML = `<section>${custTopBar()}<div class="err">洞察還沒建好（每天自動重算；剛上線要等第一輪）</div></section>`; return }
  if (curStore !== 'cust' || custV !== 'home') return
  const ins = d.ins, ms = d.months || {}, idx = d.idx || { segments: {} }
  const nowY = todayTpe().slice(0,4)
  const yrs = Object.keys(ins.yearly||{}).sort().filter(y=>y<=nowY) // v4.39.3 未來年份(2027婚禮預訂)不進逐年統計——「今年321人次0%取消」假數字修正
  const thisY = yrs[yrs.length-1], lastY = yrs[yrs.length-2]
  const yv = y => (ins.yearly||{})[y] || { resv:0, guests:0, cxl:0 }
  const cxRate = y => { const v = yv(y); const t = v.resv + v.cxl; return t ? Math.round(v.cxl/t*100) : 0 }
  const kidsRate = y => { const v = yv(y); return v.resv ? Math.round(((ins.kidsY||{})[y]||0)/v.resv*100) : 0 }
  const nr = y => (ins.nr||{})[y] || { nw:0, rt:0 }
  const rtRate = y => { const n = nr(y); const t = n.nw + n.rt; return t ? Math.round(n.rt/t*100) : 0 }
  // KPI 列
  let h = `<section>${custTopBar()}`
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">`
  h += cKpi(cNum(idx.identified), '識別顧客數', `全史訂位 ${cNum(Object.values(ms).reduce((t,v)=>t+(v.resv||0),0))} 筆`, 'var(--primary)')
  h += cKpi(cNum(yv(thisY).guests), thisY + ' 人次', lastY?`去年 ${cNum(yv(lastY).guests)}`:'', '#5FD3A6')
  h += cKpi(cxRate(thisY) + '%', '今年取消率', lastY?`去年 ${cxRate(lastY)}%`:'', cxRate(thisY) > 25 ? 'var(--red)' : '#E8A657')
  h += cKpi(rtRate(thisY) + '%', '回頭客訂單比', `#回頭客 ${cNum((idx.segments.repeat||{}).total)} 人`, '#6EB1FF')
  h += cKpi(kidsRate(thisY) + '%', '親子組佔比', `#帶小孩 ${cNum((idx.segments.kids||{}).total)} 人`, '#F2C94C')
  h += cKpi(cNum(((ins.bigY||{})[thisY]||{}).cnt), '今年大組/包場', `${cNum(((ins.bigY||{})[thisY]||{}).guests)} 人次`, '#C792EA')
  h += `</div>`
  // 月趨勢（近24月 SVG 折線）
  const mos = Object.keys(ms).sort().slice(-24)
  if (mos.length > 1){
    const vals = mos.map(m=>ms[m].resv||0), mx = Math.max(...vals)
    const W = 940, H = 120, px = i => Math.round(i/(mos.length-1)*W), py = v => Math.round(H - (mx?v/mx*(H-14):0))
    const pts = vals.map((v,i)=>`${px(i)},${py(v)}`).join(' ')
    h += cCard('📈 月訂位趨勢（近24個月・組數）', `<svg viewBox="0 0 ${W} ${H+22}" style="width:100%;height:auto"><polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="2.5"/><polygon points="0,${H} ${pts} ${W},${H}" fill="rgba(77,163,255,.12)" stroke="none"/>${mos.map((m,i)=> i%3===0?`<text x="${px(i)}" y="${H+16}" font-size="9.5" fill="#8A94A4" text-anchor="middle">${m.slice(2).replace('-','/')}</text>`:'').join('')}${vals.map((v,i)=> (v===mx)?`<text x="${px(i)}" y="${py(v)-4}" font-size="10" font-weight="800" fill="var(--primary)" text-anchor="middle">${v}</text>`:'').join('')}</svg>`)
    h += `<div style="height:10px"></div>`
  }
  // 中段雙欄：熱力圖＋來源/提前/目的
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-bottom:12px">`
  const wdN9 = ['一','二','三','四','五','六','日'], slotN9 = ['12-13','13-17','18-19','19後']
  const heat = ins.heat || [], hmax = Math.max(1, ...heat.flat())
  h += cCard('🔥 週幾 × 時段（全史累計人次）', `<table style="width:100%;border-collapse:collapse;font-size:11.5px"><tr><td></td>${slotN9.map(s=>`<td style="text-align:center;font-weight:800;padding:3px">${s}</td>`).join('')}</tr>${heat.map((row,wi)=>`<tr><td style="font-weight:800;padding:3px">${wdN9[wi]}</td>${row.map(v=>`<td style="text-align:center;padding:4px 3px;border-radius:5px;background:rgba(95,211,166,${(v/hmax*0.75).toFixed(2)});font-weight:700">${cNum(v)}</td>`).join('')}</tr>`).join('')}</table>`, '排班/訂位開放策略用')
  const srcE = Object.entries(ins.src||{}).sort((a,b)=>b[1]-a[1]); const srcMax = srcE[0]?.[1]||1; const srcT = srcE.reduce((t,[,v])=>t+v,0)
  h += cCard('📣 客源通路（全史有效訂位）', srcE.map(([k,v])=>cBar(k, v, srcMax, '#6EB1FF', Math.round(v/srcT*100)+'%・'+cNum(v))).join(''), '行銷預算投放依據')
  const ld = ins.lead||{}; const ldE = [['當天','d0'],['1-3天前','d1_3'],['4-7天前','d4_7'],['8-30天前','d8_30'],['31天+','d31']]; const ldMax = Math.max(1,...ldE.map(([,k])=>ld[k]||0))
  h += cCard('⏰ 提前多久訂位', ldE.map(([lb,k])=>cBar(lb, ld[k]||0, ldMax, '#C792EA')).join(''), '開放訂位天數/提醒時機')
  const pp = Object.entries(ins.purpose||{}).filter(([k])=>k!=='未填'&&k!=='其他備註').sort((a,b)=>b[1]-a[1]); const ppMax = pp[0]?.[1]||1
  h += cCard('🎯 用餐目的（客人備註）', pp.map(([k,v])=>cBar(k, v, ppMax, '#F2C94C')).join('') || '<div class="mut">資料不足</div>', '加價購/節日商品線索')
  h += `</div>`
  // 年度結構：新舊客/取消率/親子/大組
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-bottom:12px">`
  const nrMax = Math.max(1,...yrs.map(y=>nr(y).nw+nr(y).rt))
  h += cCard('🆕 新客 vs 回頭（每年有效訂單）', yrs.map(y=>{ const n=nr(y); const t=n.nw+n.rt; return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:40px;font-size:12px;font-weight:800">${y}</span><div style="flex:1;display:flex;height:14px;border-radius:5px;overflow:hidden;background:var(--soft)"><div style="width:${t?Math.round(n.nw/nrMax*100):0}%;background:#6EB1FF"></div><div style="width:${t?Math.round(n.rt/nrMax*100):0}%;background:#5FD3A6"></div></div><span style="font-size:11px;min-width:96px;text-align:right">新${cNum(n.nw)}/回${cNum(n.rt)}</span></div>` }).join('') + `<div class="hint" style="font-size:10.5px;margin-top:4px">🔵新客 🟢回頭客</div>`)
  h += cCard('❌ 取消率逐年', yrs.map(y=>cBar(y, cxRate(y), 100, cxRate(y)>25?'var(--red)':'#E8A657', cxRate(y)+'%')).join(''), '訂金政策依據')
  h += cCard('🧒 親子組佔比逐年', yrs.map(y=>cBar(y, kidsRate(y), 100, '#F2C94C', kidsRate(y)+'%')).join(''), '親子市場定位')
  h += cCard('🎉 大組/包場逐年（≥20人）', yrs.map(y=>{ const b=(ins.bigY||{})[y]||{cnt:0,guests:0}; return cBar(y, b.guests, Math.max(1,...yrs.map(y2=>((ins.bigY||{})[y2]||{}).guests||0)), '#C792EA', `${b.cnt}場・${cNum(b.guests)}人`) }).join(''), '包場定價/婚顧合作')
  h += `</div>`
  // 九大策略建議（吃即時數字）
  const sg = []
  sg.push(['📉 趨勢', `${lastY||''}→${thisY} 訂位 ${cNum(yv(lastY).resv)}→${cNum(yv(thisY).resv)} 組`, '對照月趨勢抓淡月，淡月做活動檔期、旺月顧翻桌率。'])
  sg.push(['💰 訂金政策', `今年取消率 ${cxRate(thisY)}%`, cxRate(thisY)>=20?'取消率偏高：建議大組(≥8人)與週末時段收訂金或信用卡保證。':'取消率健康：維持現制，大組再觀察。'])
  sg.push(['📣 行銷投放', `最大來源：${srcE[0]?srcE[0][0]+' '+Math.round((srcE[0][1]||0)/srcT*100)+'%':'—'}`, 'Google 佔比高＝顧好評論與關鍵字；FB/IG 低＝社群內容有成長空間。'])
  sg.push(['🔁 回頭經營', `回頭客訂單比 ${rtRate(thisY)}%`, '用 #流失常客 名單（' + cNum((idx.segments.lost||{}).total) + ' 人）做喚回：生日/週年訊息＋回店優惠。'])
  sg.push(['🧒 親子市場', `親子組 ${kidsRate(thisY)}%`, '穩定客群：兒童餐/親子日活動可拉平日午場。'])
  sg.push(['🎉 包場引擎', `今年 ${cNum(((ins.bigY||{})[thisY]||{}).cnt)} 場`, '煦願婚禮已是固定合作：把包場定價表制度化、平日晚場開放包場優惠。'])
  sg.push(['⏰ 訂位窗', `多數人提前 ${(ld.d1_3||0)>(ld.d8_30||0)?'1-3天':'8-30天'} 訂`, '提醒訊息排在用餐前1天；熱門時段可開候補。'])
  sg.push(['🎯 目的行銷', `慶生 ${cNum((ins.purpose||{})['慶生'])} 筆`, '慶生客群大：蛋糕/佈置加價購、壽星優惠別省。'])
  sg.push(['🛡 口碑防線', `#高取消 ${cNum((idx.segments.cxh||{}).total)} 人`, '高取消名單訂位時櫃檯可見（DD 可查），大組先電話確認。'])
  h += cCard('🧭 九大數據 × 策略建議', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px">` + sg.map(([t,n,txt])=>`<div style="border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--soft)"><div style="font-weight:900;font-size:12.5px">${t}</div><div style="color:var(--primary);font-weight:800;font-size:12px;margin:2px 0">${n}</div><div class="hint" style="font-size:11.5px;line-height:1.5">${txt}</div></div>`).join('') + `</div>`)
  h += `<div class="hint" style="font-size:10.5px;margin-top:8px">資料：inline 全史（2021-02 起）每小時同步、洞察每天重算（上次 ${String((idx.builtAt||'')).slice(0,16).replace('T',' ')}）；問 DD 可查任何明細</div></section>`
  app.innerHTML = h
}
async function custDb(seg, more){
  if (seg != null && seg !== custSeg) { custSeg = seg; custPg = 0; custRows = [] }
  if (!more && !custRows.length) app.innerHTML = `<section>${custTopBar()}<div class="mut">載入中…</div></section>`
  const d = await cFetch(`custdb=${encodeURIComponent(K)}&seg=${custSeg}&page=${custPg}`, `custdb_${custSeg}_${custPg}`)
  if (curStore !== 'cust' || custV !== 'db') return
  if (!d) { app.innerHTML = `<section>${custTopBar()}<div class="err">讀不到資料</div></section>`; return }
  custRows = custPg === 0 ? (d.rows||[]) : custRows.concat(d.rows||[])
  const idx = d.idx || { segments: {} }
  const segInfo = idx.segments[custSeg] || { total: custRows.length, pages: 1 }
  const chips = Object.entries(idx.segments).map(([k,v])=>`<button class="mini" onclick="custDb('${k}')" style="padding:4px 11px;font-weight:800;${k===custSeg?'background:var(--primary);color:#fff;border-color:var(--primary)':''}">#${v.label} <span style="opacity:.75">${cNum(v.total)}</span></button>`).join('')
  const gdT = g => g===1?'小姐':g===2?'先生':'—'
  let h = `<section>${custTopBar()}`
  h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${chips}</div>`
  h += `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input id="custQ" placeholder="搜尋姓名或電話（直連 inline 全史）" style="flex:1;max-width:340px;background:var(--card);border:1.5px solid var(--line);border-radius:9px;padding:7px 11px;color:var(--text);font-size:14px" onkeydown="if(event.key==='Enter')custFind()"><button class="mini" style="padding:6px 14px;font-weight:800" onclick="custFind()">🔍 搜尋</button><span class="hint" id="custQhint" style="font-size:11px"></span></div>`
  h += `<div id="custFindBox"></div>`
  h += `<div class="hint" style="font-size:11px;margin:4px 0">#${segInfo.label}：共 ${cNum(segInfo.total)} 人（顯示 ${cNum(custRows.length)}）・點欄位名可知排序已固定（此分群預設排序）</div>`
  h += `<div class="scroll" style="max-height:62vh;overflow:auto"><table style="border-collapse:collapse;font-size:12.5px;white-space:nowrap"><thead><tr>${['姓名','稱謂','手機','Email','入座','人次','小孩','最大組','取消','首次來','最近來'].map(x=>`<th style="position:sticky;top:0;background:var(--soft);border:1px solid var(--line);padding:5px 8px;font-size:11.5px">${x}</th>`).join('')}</tr></thead><tbody>`
  h += custRows.map(c=>`<tr>${[`<b>${c.n}</b>`, gdT(c.gd), c.ph||'—', c.em||'—', `<b style="color:#5FD3A6">${c.v}</b>`, cNum(c.p), c.k?`<span style="color:#F2C94C;font-weight:800">${c.k}</span>`:'—', c.mx>=20?`<b style="color:#C792EA">${c.mx}</b>`:(c.mx||'—'), c.cx||'—', c.f||'—', c.l||'—'].map(x=>`<td style="border:1px solid var(--line);padding:4px 8px">${x}</td>`).join('')}</tr>`).join('')
  h += `</tbody></table></div>`
  if (custPg + 1 < (segInfo.pages||1)) h += `<div style="margin-top:8px"><button class="mini" style="padding:6px 16px;font-weight:800" onclick="custPg++;custDb(null,1)">⬇️ 載入更多（還有 ${cNum(segInfo.total - custRows.length)} 人）</button></div>`
  h += `</section>`
  app.innerHTML = h
}
async function custFind(){
  const q = (document.getElementById('custQ')||{}).value || ''
  if (!q.trim()) return
  const hint = document.getElementById('custQhint'); if (hint) hint.textContent = '搜尋中…'
  let d = null
  try { const r = await fetch(`/api/inline-sync?custfind=${encodeURIComponent(K)}&q=${encodeURIComponent(q.trim())}`); d = await r.json() } catch(_){}
  if (hint) hint.textContent = ''
  const box = document.getElementById('custFindBox'); if (!box) return
  if (!d || !d.ok) { box.innerHTML = '<div class="err">搜尋失敗，再試一次</div>'; return }
  const ST9 = {1:'確認',2:'取消',3:'待確認',4:'入座',5:'取消',6:'確認'}
  const stLines = Object.values(d.stats||{}).map(c=>`<div style="font-weight:800;font-size:12.5px;color:#F2C94C">★ ${c.name}${c.phone?`（${c.phone}）`:''}：入座 ${c.stats.seated??0} 次・全部 ${c.stats.total??0}（官方客人檔）</div>`).join('')
  box.innerHTML = cCard(`🔍「${q}」共 ${cNum(d.total)} 筆`, stLines + `<div style="max-height:220px;overflow:auto;margin-top:4px">` + (d.rows||[]).map(r=>`<div style="font-size:12px;padding:2px 0;border-bottom:1px solid var(--line)">${r.d||'?'} ${r.t||''} <b>${r.name}</b> ${r.n}人・${ST9[r.st]||r.st}${r.phone?`・${r.phone}`:''}</div>`).join('') + `</div><div style="text-align:right;margin-top:4px"><button class="mini" onclick="document.getElementById('custFindBox').innerHTML=''">✕ 關閉</button></div>`)
}
const TAB_DEF = { sop:'SOP', task:'任務', lb:'排行榜', food:'盤點', pack:'包材', buy:'採購', meet:'會議', shift:'班表', inc:'異常通知', fb:'回饋', menu:'菜單', cust:'inline' } // v4.33.0 去emoji；cust=inline顧客資料庫(v4.39.0 張良)
// ── 單色線條 icon（張良 2026-09-24：不要彩色 emoji——同 Beach Ops 的 stroke 線條圖）──
const _I = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;vertical-align:-3px">${d}</svg>`
const TAB_ICONS = {
  sop: _I('<path d="M9 11.5 11.2 14 15.5 9"/><rect x="4" y="4" width="16" height="16" rx="3"/>'),
  home: _I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  meet: _I('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2v4M15 2v4M8.5 11h7M8.5 15h5"/>'),
  task: _I('<path d="M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6V21h3.4l5.7-5.7a4.5 4.5 0 0 0 5.6-6l-3 3-2.8-.7-.7-2.8Z"/>'),
  lb: _I('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>'),
  food: _I('<path d="M4 7h16l-1.5 13h-13Z"/><path d="M8 7a4 4 0 0 1 8 0"/>'),
  pack: _I('<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  buy: _I('<circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 4h2l2.4 11h10.2L20 8H6"/>'),
  shift: _I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  fb: _I('<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z"/>'),
  menu: _I('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 20.5V5.5M8 7h8M8 11h6"/>'),
  gear: _I('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M2.8 12h2.6M18.6 12h2.6M4.9 19.1l1.9-1.9M17.2 6.8l1.9-1.9"/>'),
  bell: _I('<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>'),
  errs: _I('<rect x="8" y="7" width="8" height="11" rx="4"/><path d="M8 10H4M20 10h-4M8 14H4.5M19.5 14H16M9 7 7 4.5M15 7l2-2.5M10 3.5h4"/>'),
  cust: _I('<circle cx="9" cy="8" r="3"/><path d="M4 19c0-3 2.2-5 5-5s5 2 5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M14.5 19c.2-2.5 1.7-4 3.5-4 1.8 0 3.3 1.5 3.5 4"/>'), // inline 顧客資料庫
}
const stripEmoji = (s) => String(s||'').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}⭐★☆✅✏️📌]/gu,'').trim()
function applyTabs(cfg){
  cfg = cfg || {}
  window._tabCfg = cfg
  const bar = document.querySelector('.tabs'), gear = document.getElementById('tab-gear')
  const order = (cfg.order && cfg.order.length ? cfg.order : Object.keys(TAB_DEF)).filter(k=>TAB_DEF[k])
  Object.keys(TAB_DEF).forEach(k=>{ if (!order.includes(k)) order.push(k) }) // v4.39.1 新分頁排最後=設定上面（張良 2026-10-04 inline 指定位置；要移前面去設定拖）
  order.forEach(k=>{ const b = document.getElementById('tab-'+k); if (b && bar && gear) { const lb = stripEmoji((cfg.names||{})[k] || TAB_DEF[k]); b.innerHTML = (TAB_ICONS[k]||'') + '<span>' + lb + '</span>'; bar.insertBefore(b, gear) } })
  // 沒文字的補上文字（張良 2026-10-01：首頁/設定/問題回報）
  const hb = document.getElementById('tab-home'); if (hb) hb.innerHTML = TAB_ICONS.home + '<span>首頁</span>'
  const gb = document.getElementById('tab-gear'); if (gb) gb.innerHTML = TAB_ICONS.gear + '<span>設定</span>'
  const eb2 = document.getElementById('tab-errs'); if (eb2) eb2.innerHTML = TAB_ICONS.errs + '<span>問題回報</span>'
  try { favRender() } catch(_) {} // ⭐ 分頁名稱/順序套完→底部捷徑列跟著重畫
}
// ── ⭐ 個人常用捷徑列（v4.39.1 張良「手機版固定一行、每個人可編輯自己的常用清單，例如班表/SOP/盤點/叫貨」）──
// 手機版固定螢幕最底＝拇指直達；最多 5 格＋✎編輯；清單每人一份：綁定者存伺服器(pm_prep_fav)換手機跟著走、未綁定存本機
const FAV_DEFAULT = ['shift','sop','food','buy']
const FAV_MAX = 5
const favAll = () => ['home', ...Object.keys(TAB_DEF), 'errs'].filter(k => { const b = document.getElementById(k==='home'?'tab-home':'tab-'+k); return b && b.style.display !== 'none' }) // 被權限藏掉的分頁不給選
const favGet = () => { try { const v = JSON.parse(localStorage.getItem('gdFav')||'null'); if (Array.isArray(v) && v.length) return v } catch(_){}; return FAV_DEFAULT }
const favLabel = k => k==='home' ? '首頁' : k==='errs' ? '回報' : stripEmoji(((window._tabCfg||{}).names||{})[k] || TAB_DEF[k] || k)
function favRender(){
  const bar = document.getElementById('favbar'); if (!bar) return
  const list = favGet().filter(k => favAll().includes(k)).slice(0, FAV_MAX)
  bar.innerHTML = list.map(k => `<button data-fk="${k}" onclick="favGo('${k}')">${TAB_ICONS[k]||TAB_ICONS.home}<span>${favLabel(k)}</span></button>`).join('')
    + `<button onclick="favEdit()" title="編輯我的常用清單" style="flex:0 0 52px;opacity:.75">${_I('<path d="M4 20h4L19.3 8.7a2.12 2.12 0 0 0-3-3L5 17Z"/><path d="M13.5 6.5l3 3"/>')}<span>編輯</span></button>`
  favMark()
}
function favGo(k){ const b = document.getElementById(k==='home'?'tab-home':'tab-'+k); if (b) b.click(); try{ scrollTo({top:0}) }catch(_){} }
function favMark(k){ if (k) window._favCur = k; const c = window._favCur
  document.querySelectorAll('#favbar [data-fk]').forEach(b => { const fk = b.dataset.fk; b.className = (fk===c || (fk==='home' && (c==='ground'||c==='abeach'))) ? 'on' : '' }) }
async function favSave(sel){
  try { localStorage.setItem('gdFav', JSON.stringify(sel)) } catch(_){}
  favRender()
  if (TK()) { try { await fetch('/api/mail-sync?prepfav=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), list: sel }) }) } catch(_){} } // 綁定者同步伺服器＝換裝置也在
}
function favEdit(){ // 編輯彈層：點=加入/移除、數字=顯示順序(照點的先後)、滿5個再點=擠掉最早的
  let sel = favGet().filter(k => favAll().includes(k)).slice(0, FAV_MAX)
  const ov = document.createElement('div'); ov.id = 'favOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;display:flex;align-items:flex-end;justify-content:center'
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
  const box = document.createElement('div')
  box.style.cssText = 'background:var(--bg);border:1px solid var(--line);border-radius:18px 18px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));width:100%;max-width:560px;max-height:78vh;overflow-y:auto'
  const draw = () => {
    box.innerHTML = `<h2 style="margin-bottom:4px">我的常用清單</h2><div class="hint" style="margin-bottom:10px">點一下＝加入/移除，數字＝顯示順序（最多 ${FAV_MAX} 個）${TK()?'・跟著你的身分走，換手機也在':'・先綁定身分，換手機清單才會跟著'}</div>
      <div id="favList" style="display:grid;grid-template-columns:repeat(4,1fr);gap:9px">${favAll().map(k => { const i = sel.indexOf(k); return `<button class="favchip${i>=0?' on':''}" data-k="${k}">${TAB_ICONS[k]||''}<span>${favLabel(k)}</span>${i>=0?`<b class="fno">${i+1}</b>`:''}</button>` }).join('')}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="mini" style="padding:9px 16px" id="favReset">回預設</button><button class="mini on" style="padding:9px 22px;font-size:15px" id="favOk">✓ 完成</button></div>`
    box.querySelectorAll('.favchip').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k; const i = sel.indexOf(k)
      if (i >= 0) sel.splice(i, 1); else { if (sel.length >= FAV_MAX) sel.shift(); sel.push(k) }
      draw() }))
    box.querySelector('#favReset').addEventListener('click', () => { sel = FAV_DEFAULT.slice(); draw() })
    box.querySelector('#favOk').addEventListener('click', () => { favSave(sel.length ? sel : FAV_DEFAULT.slice()); ov.remove() })
  }
  draw(); ov.appendChild(box); document.body.appendChild(ov)
}
async function meChipInit(){ // 側欄底部＝登入身分（張良 2026-10-02：沒綁定顯示訪客·無編輯權限）
  const el = document.getElementById('meChip'); if (!el) return
  let me = null
  try { const r = await fetch('/api/mail-sync?whoami=' + encodeURIComponent(K) + '&r=' + Date.now() + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); const j = await r.json(); me = j && j.me } catch(e){}
  // 保險（2026-10-02 張良明明是管理者卻顯示訪客＝查詢打到部署空檔）：有綁定 token 但查不到 → 用菜單口身分再試
  if (!me && TK()) {
    try { const r2 = await fetch('/api/mail-sync?menu=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK()) + '&r=' + Date.now()); const j2 = await r2.json(); if (j2 && j2.me) me = { name: j2.me.name, approver: j2.me.admin || j2.me.approver } } catch(e){}
  }
  // v4.34.0 權限快照：鎖按鈕用（模擬時 &as= 自動拿到被模擬者的權限）；菜單口保險路徑拿不到完整權限→不鎖
  window._meW = me ? (me.mode !== undefined ? { bound: true, mode: me.mode || 'open', edit: !!me.edit, adminP: !!me.adminP, tabs: me.tabs || null } : null) : { bound: false }
  try { localStorage.setItem('obt_mew', JSON.stringify(window._meW)) } catch(e){}
  try { permScan(document.body) } catch(e){}
  const nm = me ? me.name : '訪客'
  const role = me ? (me.approver ? '審核人' : (me.role === '主管' ? '主管' : '夥伴')) : '無編輯權限'
  el.innerHTML = `<div style="width:42px;height:42px;border-radius:50%;background:${me?'var(--grad)':'#3A4452'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:17px;flex:0 0 auto">${nm.slice(0,1)}</div>
    <div style="min-width:0"><div style="font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nm}</div><div class="hint" style="font-size:12.5px">${role}</div></div>`
  // 🔔 v4.33.4 鈴鐺改常駐＝通知中心入口（張良：原本按完就消失）＋未讀紅點數；已允許推播→默默補訂閱（換部署/過期自動續）
  try {
    if (me && wpSupport() && Notification.permission === 'granted') pushSub()
    const b9 = document.createElement('button'); b9.id='ntfBell'; b9.className='mini'
    b9.style.cssText='margin-left:auto;padding:8px 11px;font-size:17px;line-height:1;position:relative'
    b9.title='通知中心：歷史紀錄＋分類'; b9.textContent='🔔'; b9.onclick=ntfPage; el.appendChild(b9)
    ntfBadgeSync()
  } catch(e){}
  // v4.26.3（張良：設定每個頁面看不看得見）：被關掉的分頁直接從側欄藏起來（board=首頁）
  if (me && !me.approver && Array.isArray(me.hideTabs)) me.hideTabs.forEach(k=>{ const b = document.getElementById(k==='board' ? 'tab-home' : 'tab-'+k); if (b) b.style.display = 'none' })
  if (me && Array.isArray(me.fav) && me.fav.length) { try { localStorage.setItem('gdFav', JSON.stringify(me.fav)) } catch(_){} } // ⭐ v4.39.1 伺服器版個人常用清單＝以人為準（換手機跟著走）
  try { favRender() } catch(_){} // 藏分頁/個人清單套完→捷徑列重畫
}
// ── 🔔 通知中心（v4.33.4 張良：通知要有頁面＋歷史紀錄＋分類；鈴鐺常駐不再按完消失）──
// 歷史=伺服器每發一次推播自動記一筆(sp_finance_pm_prep_ntf)；全員通知人人看得到、指定對象只有本人看得到
const NTF_CATS = { all:'全部', meet:'📢 會議', sop:'✅ SOP', prep:'🍳 備料', stock:'📦 庫存', issue:'⚠️ 問題回報', other:'🔔 其他' }
let _ntfList = null, _ntfCat = 'all'
async function ntfFetch(){ try { const r = await fetch('/api/mail-sync?ntf=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '') + '&r=' + Date.now()); const j = await r.json(); if (j && j.ok) _ntfList = j.list || [] } catch(e){}; return _ntfList || [] }
function ntfUnread(){ const rd = localStorage.getItem('gdNtfRead') || ''; return (_ntfList || []).filter(x => x.ts > rd).length }
async function ntfBadgeSync(){ // 鈴鐺上的未讀紅點數（進站抓一次）
  await ntfFetch()
  const b = document.getElementById('ntfBell'); if (!b) return
  const n = ntfUnread()
  let d = b.querySelector('.ntfDot'); if (d) d.remove()
  if (n > 0) { d = document.createElement('span'); d.className = 'ntfDot'
    d.style.cssText = 'position:absolute;top:-5px;right:-5px;background:#E5484D;color:#fff;border-radius:999px;font-size:11px;font-weight:900;min-width:17px;height:17px;line-height:17px;text-align:center;padding:0 3px'
    d.textContent = n > 99 ? '99+' : n; b.appendChild(d) }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) ntfBadgeSync() }) // v4.33.6 App從背景回前景＝重算鈴鐺數字（張良：圖示有數字、打開App鈴鐺卻沒有＝喚醒不會重新抓）
try { navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', ev => { if (ev.data && ev.data.gdNtf) ntfBadgeSync() }) } catch(e){} // App開著收到推播→sw廣播→即時重算
async function ntfPage(){ // 通知中心彈層：分類chips＋依日分組歷史；打開＝全部標已讀＋清App圖示數字
  const old = document.getElementById('ntfOv'); if (old) { old.remove(); return }
  const ov = document.createElement('div'); ov.id = 'ntfOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,22,.55);z-index:60;display:flex;align-items:flex-end;justify-content:center'
  ov.innerHTML = `<div style="background:#1C2430;border:1px solid #39434F;border-radius:16px 16px 0 0;width:100%;max-width:560px;max-height:82vh;display:flex;flex-direction:column" onclick="event.stopPropagation()">
    <div style="display:flex;align-items:center;gap:8px;padding:14px 16px 8px"><span style="font-weight:900;font-size:17px">🔔 通知中心</span>
      ${('Notification' in window) && Notification.permission !== 'granted' ? '<button class="mini" style="padding:6px 10px" onclick="pushOn()">開啟推播</button>' : ''}
      <button class="mini" style="margin-left:auto;padding:6px 12px" onclick="document.getElementById('ntfOv').remove()">✕</button></div>
    <div id="ntfChips" style="display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 10px"></div>
    <div id="ntfList" style="overflow:auto;padding:0 16px 20px"></div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
  await ntfFetch(); ntfRender()
  localStorage.setItem('gdNtfRead', new Date().toISOString()) // 打開＝已讀
  if (TK()) fetch('/api/mail-sync?ntfread=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK())).catch(()=>{}) // v4.33.5 伺服器也記已讀＝之後推播的App圖示數字會歸零重算
  try { if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(()=>{}) } catch(e){}
  const b = document.getElementById('ntfBell'); const d = b && b.querySelector('.ntfDot'); if (d) d.remove()
}
function ntfRender(){
  const L = _ntfList || [], rd0 = localStorage.getItem('gdNtfRead') || ''
  const cnt = k => k==='all' ? L.length : L.filter(x=>(x.cat||'other')===k).length
  document.getElementById('ntfChips').innerHTML = Object.entries(NTF_CATS).filter(([k])=>k==='all'||cnt(k)).map(([k,lb]) =>
    `<button class="mini${_ntfCat===k?' on':''}" style="padding:6px 11px" onclick="_ntfCat='${k}';ntfRender()">${lb}${cnt(k)?` <span style="opacity:.65">${cnt(k)}</span>`:''}</button>`).join('')
  const fl = _ntfCat==='all' ? L : L.filter(x=>(x.cat||'other')===_ntfCat)
  if (!fl.length) { document.getElementById('ntfList').innerHTML = '<div class="hint" style="padding:18px 0;text-align:center">還沒有通知</div>'; return }
  const day = ts => { const d2 = ts.slice(0,10), t0 = new Date().toISOString().slice(0,10); return d2===t0 ? '今天' : d2 }
  let lastD = '', html = ''
  fl.forEach(x => {
    const d2 = day(x.ts)
    if (d2 !== lastD) { html += `<div class="hint" style="font-weight:800;margin:12px 0 4px">${d2}</div>`; lastD = d2 }
    const hh = new Date(x.ts).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false})
    const unread = x.ts > rd0
    html += `<div onclick="location.href='${(x.url||'/prep').replace(/'/g,'')}'" style="display:flex;gap:9px;padding:10px 10px;border:1px solid ${unread?'#3E5B86':'#2C3542'};background:${unread?'#20304A':'#202834'};border-radius:11px;margin-bottom:7px;cursor:pointer">
      <span style="flex:0 0 auto;font-size:16px">${(NTF_CATS[x.cat]||'🔔').slice(0,2)}</span>
      <div style="min-width:0"><div style="font-weight:800;font-size:14.5px">${x.title||''} <span class="hint" style="font-weight:400">${hh}</span></div>
      <div class="hint" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${x.body||''}</div></div></div>`
  })
  document.getElementById('ntfList').innerHTML = html
}
function sopPage(){ // ✅ SOP 獨立分頁（張良 2026-10-02：從首頁拆出）
  curStore = 'sop'; setTabs('sop')
  document.getElementById('upd').textContent = '每日 SOP'
  app.innerHTML = '<div id="sop"></div><div id="sosec"></div>'
  sopLoad()
}
async function tabsInit(){
  meChipInit()
  applyTabs(tcGet('tabcfg') || {})
  try { const r = await fetch('/api/mail-sync?tabcfg=' + encodeURIComponent(K)); const d = await r.json(); if (d && d.ok) { tcSet('tabcfg', d); applyTabs(d) } } catch(e){}
}
function tabsEdit(){
  if (!TK()) { alert('要先綁定才能改分頁：跟 DD 說「綁定GD」'); return }
  const cfg = window._tabCfg || tcGet('tabcfg') || {}
  const order = (cfg.order && cfg.order.length ? cfg.order : Object.keys(TAB_DEF)).filter(k=>TAB_DEF[k])
  Object.keys(TAB_DEF).forEach(k=>{ if (!order.includes(k)) order.push(k) }) // v4.39.1 新分頁排最後=設定上面（張良 2026-10-04 inline 指定位置；要移前面去設定拖）
  const ov = document.createElement('div'); ov.id='tbOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  const row = k => `<div class="tbRow" data-k="${k}" style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
    <button class="mini" style="padding:4px 9px" onclick="tabMv(this,-1)">↑</button><button class="mini" style="padding:4px 9px" onclick="tabMv(this,1)">↓</button>
    <input class="tbName" value="${((cfg.names||{})[k]||TAB_DEF[k]).replace(/"/g,'&quot;')}" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:15px">
  </div>`
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:380px;width:100%;padding:16px;max-height:86vh;overflow:auto" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">⚙️ 分頁名稱／排序</div>
    <div class="hint" style="margin-bottom:8px">↑↓ 調順序、直接改名字（含表情符號）；存了全裝置同步</div>
    <div id="tbList">${order.map(row).join('')}</div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:10px">
      <button class="mini" style="padding:9px 12px" onclick="tabsReset()">還原預設</button>
      <span><button class="mini" style="padding:9px 12px" onclick="document.getElementById('tbOv').remove()">取消</button>
      <button class="mini on" style="padding:9px 18px" onclick="tabsSave()">儲存</button></span>
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function tabMv(btn, n){
  const row = btn.closest('.tbRow'), list = row.parentElement
  if (n < 0 && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling)
  if (n > 0 && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row)
}
async function tabsSave(){
  const rows = [...document.querySelectorAll('#tbList .tbRow')]
  const order = rows.map(r=>r.dataset.k)
  const names = {}
  rows.forEach(r=>{ const v = r.querySelector('.tbName').value.trim(); if (v && v !== TAB_DEF[r.dataset.k]) names[r.dataset.k] = v })
  const o = document.getElementById('tbOv'); if (o) o.remove()
  const cfg = { order, names }
  applyTabs(cfg); tcSet('tabcfg', { ok:true, ...cfg })
  const r = await fetch('/api/mail-sync?tabset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...cfg, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (!d || !d.ok) alert((d&&d.error)||'儲存失敗（畫面已先套用，重新整理會還原）')
}
async function tabsReset(){
  const o = document.getElementById('tbOv'); if (o) o.remove()
  const cfg = { order: Object.keys(TAB_DEF), names: {} }
  applyTabs(cfg); tcSet('tabcfg', { ok:true, ...cfg })
  await fetch('/api/mail-sync?tabset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...cfg, token: TK() }) }).catch(()=>{})
}
tabsInit()
bindBtnSync()
// ── 🔔 群組通知開關（張良 2026-09-21：主動群通知先全關；審核人在這裡逐項開）──
const NOTIFY_DEF = [ ['buy','採購需求→內部群'], ['sopLate','SOP 超時未完成→內部群'], ['lowStock','庫存低水位→內部群'], ['prep0930','每日 09:30 備料量→Family 群'], ['staleItem','品項超過5個營業日沒販售→happy337 群（預設開）', 1], ['soldoutAB','AB 停售/恢復即時通知→happy337 群（預設開）', 1] ]
async function notifyEdit(){
  let d
  try { const r = await fetch('/api/mail-sync?notifycfg=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d = await r.json() } catch(e){}
  if (!d || !d.ok) { alert('讀不到通知設定'); return }
  const ov = document.createElement('div'); ov.id='ntOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:400px;width:100%;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:4px">🔔 群組通知開關</div>
    <div class="hint" style="margin-bottom:10px">預設全關（不主動打擾群組）。${d.canEdit?'點開要的：':'只有審核人能改，目前狀態：'}<br>問題回報不在這裡——那個走你的「發布」審核，你按了才進群。</div>
    ${NOTIFY_DEF.map(([k,lb,defOn])=>`<label style="display:flex;gap:8px;align-items:center;padding:7px 4px;border-bottom:1px solid var(--line);font-size:15px;font-weight:600"><input type="checkbox" data-nk="${k}" ${(defOn ? d.cfg[k]!==0 : d.cfg[k]===1)?'checked':''} ${d.canEdit?'':'disabled'} style="width:18px;height:18px"> ${lb}</label>`).join('')}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="mini" style="padding:9px 12px" onclick="document.getElementById('ntOv').remove()">關閉</button>
    ${d.canEdit?`<button class="mini on" style="padding:9px 18px" onclick="notifySave()">儲存</button>`:''}</div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function notifySave(){
  const cfg = {}
  document.querySelectorAll('#ntOv input[data-nk]').forEach(i2=>{ cfg[i2.dataset.nk] = i2.checked ? 1 : 0 })
  const o = document.getElementById('ntOv'); if (o) o.remove()
  const r = await fetch('/api/mail-sync?notifyset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cfg, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) alert('通知開關已更新'); else alert((d&&d.error)||'儲存失敗')
}
// 24小時制時間選擇（張良 2026-09-21：原生 time 輸入會跟著系統顯示上午/下午——改成 00~23 時＋分兩個下拉）
function t24c(cls, v){
  const [h,m] = String(v||'11:00').split(':')
  const H = [...Array(24)].map((_,i)=>String(i).padStart(2,'0'))
  let M = ['00','05','10','15','20','25','30','35','40','45','50','55']
  if (m && !M.includes(m)) M = [...M, m].sort()
  const sS = 'border:1px solid var(--line);border-radius:6px;padding:4px 3px;font-size:14px;background:var(--card)'
  return `<span style="display:inline-flex;gap:2px;align-items:center;white-space:nowrap"><select class="${cls}h" style="${sS}">${H.map(x=>`<option${x===h?' selected':''}>${x}</option>`).join('')}</select>:<select class="${cls}m" style="${sS}">${M.map(x=>`<option${x===m?' selected':''}>${x}</option>`).join('')}</select></span>`
}
const t24read = (root, cls) => `${root.querySelector('.'+cls+'h').value}:${root.querySelector('.'+cls+'m').value}`
// ── 🖼 SOP 標準照（張良 2026-09-22：列表點條目→看標準照＋直接上傳/更換，不用進總編輯）──
function sopRefOpen(itemId){
  const it = ((sopData && sopData.def.items)||[]).find(x=>x.id===itemId)
  if (!it) return
  const canUp = !!(sopData && sopData.me)
  const ov = document.createElement('div'); ov.id='srOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,16,30,.82);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:480px;width:100%;padding:14px;text-align:center" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">🖼 ${it.title}</div>
    ${it.ref?`<img src="${it.ref}" style="max-width:100%;max-height:60vh;border-radius:10px;border:1px solid var(--line)">`:`<div class="mut" style="padding:24px 0">還沒有標準照——${canUp?'按下面上傳，或直接 Cmd/Ctrl+V 貼截圖':'綁定後可以上傳'}</div>`}
    <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap">
      ${canUp?`<button class="mini on" style="padding:9px 16px" onclick="sopRefUp('${it.id}')">📷 ${it.ref?'更換':'上傳'}標準照</button><button class="mini" style="padding:9px 14px" onclick="sopRefPaste('${it.id}')">📋 貼截圖</button>`:''}
      ${canUp&&it.ref?`<button class="mini" style="color:var(--red);padding:9px 12px" onclick="if(confirm('移除標準照？'))sopRefSave('${it.id}','')">移除</button>`:''}
      <button class="mini" style="padding:9px 12px" onclick="document.getElementById('srOv').remove()">關閉</button>
    </div></div>`
  window._srItem = itemId
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function sopRefBlob(itemId, blob, mime){ // 共用上傳（選檔/貼截圖都走這）
  try {
    const ext = (mime||blob.type||'image/png').split('/')[1].replace('jpeg','jpg') || 'png'
    const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ext }) })
    const sd = await sr.json()
    if (sd && sd.ok) { const ur = await fetch(sd.uploadUrl, { method:'PUT', headers:{'content-type': blob.type||'image/png'}, body: blob }); if (ur.ok) { sopRefSave(itemId, sd.publicUrl); return } }
    alert('上傳失敗，再試一次')
  } catch(e){ alert('上傳失敗') }
}
function sopRefUp(itemId){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'
  inp.onchange = () => { const f = inp.files[0]; if (f) sopRefBlob(itemId, f, f.type) }
  inp.click()
}
// 📋 截圖直接貼（張良 2026-09-22）：按鈕讀剪貼簿；視窗開著時 Cmd/Ctrl+V 也直接貼
async function sopRefPaste(itemId){
  try {
    const cs = await navigator.clipboard.read()
    for (const ci of cs) { const ty = ci.types.find(x=>x.startsWith('image/')); if (ty) { const b = await ci.getType(ty); sopRefBlob(itemId, b, ty); return } }
    alert('剪貼簿裡沒有圖片——先截圖再按這顆')
  } catch(e){ alert('瀏覽器不給讀剪貼簿——直接按 Cmd/Ctrl+V 貼，或用「上傳」選檔') }
}
document.addEventListener('paste', (e) => {
  if (!document.getElementById('srOv') || !window._srItem) return
  const it = [...((e.clipboardData||{}).items||[])].find(x=>x.type&&x.type.startsWith('image/'))
  if (it) { e.preventDefault(); sopRefBlob(window._srItem, it.getAsFile(), it.type) }
})
async function sopRefSave(itemId, ref){
  const r = await fetch('/api/mail-sync?sopref=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ itemId, ref, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (!d || !d.ok) { alert((d&&d.error)||'儲存失敗'); return }
  const o = document.getElementById('srOv'); if (o) o.remove()
  sopLoad()
}
