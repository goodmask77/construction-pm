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
  if (custV === 'detail') return custDetail(custDK, 1)
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
// v4.40.0（張良「每張卡都是分析儀表板,點進去更深:年/月篩選、平均值、趨勢圖;標題下用專業方式說怎麼用」）
// 九大面向定義：標題/專業說明(寫給夥伴看的「這張圖拿來幹嘛」)/主色
const CUST_KINDS = {
  trend:{ t:'📈 訂位趨勢', c:'var(--primary)', d:'追蹤每月訂位量與人次的長期走勢和季節性。旺月提前排人力與備料，淡月安排行銷檔期或主動開發包場補量；若連續下滑，回頭檢查客源通路與回頭客是否同步衰退，找出是「市場」還是「自己」的問題。' },
  heat:{ t:'🔥 週幾 × 時段', c:'#5FD3A6', d:'找出一週中最強與最弱的「星期×時段」組合。強格顧翻桌率、避免超收；弱格用限定優惠、包場、活動把空位填起來。看「平均每日人次」比總數準——它直接等於那個時段該排幾個人力。' },
  src:{ t:'📣 客源通路', c:'#6EB1FF', d:'客人從哪裡來＝行銷預算該投哪裡。佔比高的通路把轉換顧好（Google 評論、照片、菜單更新）；佔比低但成長中的通路加碼測試；付費通路（如 OpenTable）用帶客數對比費用決定去留。' },
  lead:{ t:'⏰ 提前訂位習慣', c:'#C792EA', d:'客人提前多久訂位決定營運節奏。當天訂的多＝要保留當日桌與機動人力；提前一週以上的多＝適合推訂金與預點菜單。訂位提醒訊息排在用餐前一天發送效果最好。' },
  pp:{ t:'🎯 用餐目的', c:'#F2C94C', d:'客人備註裡的來店目的＝加價購與活動設計的依據。慶生佔比高就把蛋糕、佈置、壽星方案做成固定商品；約會多的時段優化座位與氛圍；商務客多可推套餐與統編服務。' },
  nr:{ t:'🆕 新客 vs 回頭', c:'#6EB1FF', d:'新客代表成長動能，回頭客代表體驗品質。回頭比持續下降＝體驗或喚回機制出問題；搭配「#流失常客」名單做精準喚回（生日、週年訊息＋回店誘因），比撒廣告便宜有效。' },
  cxl:{ t:'❌ 取消率', c:'#F07373', d:'每一筆取消都是被鎖住又放掉的桌位。取消率持續超過 25% 就該上訂金、信用卡保證或取消期限；看逐月變化找出取消最兇的月份與族群，針對性收緊規則而不是一刀切。' },
  kids:{ t:'🧒 親子客', c:'#F2C94C', d:'親子客是平日與午場的重要填補客群，而且忠誠度高。佔比上升就投資兒童椅、兒童餐、親子活動；同時反映在座位規劃（嬰兒車動線）與尖峰時段的設備數量。' },
  big:{ t:'🎉 大組/包場', c:'#C792EA', d:'20 人以上的大組與包場是客單最高、最可預期的業務。看逐年成長決定是否建立固定包場價目表與婚顧分潤制度；接包場前用本頁評估「擋掉散客的機會成本」是否划算。' },
}
let custDK = 'trend', custDy = '12m', custDm = 'all', custDmet = ''
// 依期間篩選出月份清單（排除未來月；未來婚禮預訂會灌水）
// v4.40.3（張良「週一怎麼可能這麼多人 平均欸」）：預設=近12個月——全史平均被 2022-23 黃金年代拉高（週一午餐全史45 vs 近12月30），排班會被誤導
function cMsel(mm){ const nowYM = todayTpe().slice(0,7); const all = Object.keys(mm||{}).sort().filter(ym=>ym<=nowYM); if (custDy==='12m') return all.slice(-12); return all.filter(ym=>custDy==='all'||ym.slice(0,4)===custDy).filter(ym=>custDm==='all'||ym.slice(5,7)===custDm) }
// 合併多個月的洞察
function cAgg(mm, yms){
  const o = { resv:0,guests:0,cxl:0,kids:0,nw:0,rt:0,big:0,bigG:0,src:{},lead:{d0:0,d1_3:0,d4_7:0,d8_30:0,d31:0},pp:{},hp:Array.from({length:7},()=>[0,0,0,0]),hg:Array.from({length:7},()=>[0,0,0,0]),wdD:[0,0,0,0,0,0,0] }
  for (const ym of yms){ const m = mm[ym]; if (!m) continue
    for (const k of ['resv','guests','cxl','kids','nw','rt','big','bigG','posG','posRev','posD','wlN','wlG','wkN','wkG']) o[k] = (o[k]||0) + (m[k]||0)
    for (const [k,v] of Object.entries(m.src||{})) o.src[k]=(o.src[k]||0)+v
    for (const k of Object.keys(o.lead)) o.lead[k]+= (m.lead||{})[k]||0
    for (const [k,v] of Object.entries(m.pp||{})) o.pp[k]=(o.pp[k]||0)+v
    for (let w=0;w<7;w++){ o.wdD[w]+=(m.wdD||[])[w]||0; for (let s=0;s<4;s++){ o.hp[w][s]+=((m.hp||[])[w]||[])[s]||0; o.hg[w][s]+=((m.hg||[])[w]||[])[s]||0 } }
  }
  return o
}
// 折線圖（SVG）：labels=月份、vals=數值
function cLineSvg(labels, vals, color, fmt){
  if (labels.length < 2) return '<div class="mut" style="font-size:12px">期間內資料點不足（選長一點的期間才有趨勢線）</div>'
  const mx = Math.max(1,...vals), W = 940, H = 110
  const px = i => Math.round(i/(labels.length-1)*W), py = v => Math.round(H - v/mx*(H-16))
  const pts = vals.map((v,i)=>`${px(i)},${py(v)}`).join(' ')
  const step = Math.max(1, Math.round(labels.length/10))
  return `<svg viewBox="0 0 ${W} ${H+22}" style="width:100%;height:auto"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5"/><polygon points="0,${H} ${pts} ${W},${H}" fill="${color}22" stroke="none"/>${labels.map((m,i)=> i%step===0?`<text x="${px(i)}" y="${H+16}" font-size="9.5" fill="#8A94A4" text-anchor="middle">${m.slice(2).replace('-','/')}</text>`:'').join('')}${vals.map((v,i)=> v===mx?`<text x="${Math.min(W-14,Math.max(14,px(i)))}" y="${py(v)-4}" font-size="10" font-weight="800" fill="${color}" text-anchor="middle">${fmt?fmt(v):cNum(v)}</text>`:'').join('')}</svg>`
}
async function custHome(){
  app.innerHTML = `<section>${custTopBar()}<div class="mut">載入中…</div></section>`
  const d = await cFetch('custinsights=' + encodeURIComponent(K) + '&v=2', 'custins2') // v=2 破邊緣快取（舊shape在10分快取裡）
  if (!d || !d.ins || !d.ins.m) { app.innerHTML = `<section>${custTopBar()}<div class="err">洞察資料重算中（新版每天自動重建；稍等幾分鐘再進來）</div></section>`; return }
  if (curStore !== 'cust' || custV !== 'home') return
  window._custIns = d
  const ins = d.ins, idx = d.idx || { segments: {} }
  const nowY = todayTpe().slice(0,4), nowYM = todayTpe().slice(0,7)
  const allM = Object.keys(ins.m).sort().filter(ym=>ym<=nowYM)
  const yrs = [...new Set(allM.map(ym=>ym.slice(0,4)))]
  const yAgg = {}; yrs.forEach(y=>{ yAgg[y] = cAgg(ins.m, allM.filter(ym=>ym.slice(0,4)===y)) })
  const thisY = yrs[yrs.length-1], lastY = yrs[yrs.length-2]
  const yv = y => yAgg[y] || { resv:0,guests:0,cxl:0,kids:0,nw:0,rt:0,big:0,bigG:0 }
  const pct = (a,b) => b ? Math.round(a/b*100) : 0
  const cxRate = y => pct(yv(y).cxl, yv(y).resv + yv(y).cxl)
  const rtRate = y => pct(yv(y).rt, yv(y).nw + yv(y).rt)
  // 可點卡片：標題＋專業說明＋預覽＋點開
  const go = (kind, body) => { const KD = CUST_KINDS[kind]; return `<div onclick="custDetail('${kind}')" style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='${KD.c}'" onmouseout="this.style.borderColor='var(--line)'"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:900;font-size:13.5px">${KD.t}</span><span style="font-size:11px;font-weight:800;color:${KD.c};white-space:nowrap">完整分析 ›</span></div><div class="hint" style="font-size:11.5px;line-height:1.55;margin:5px 0 8px">${KD.d}</div>${body}</div>` }
  let h = `<section>${custTopBar()}`
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">`
  h += cKpi(cNum(idx.identified), '識別顧客數', `全史訂位 ${cNum(allM.reduce((t,ym)=>t+(ins.m[ym].resv||0),0))} 筆`, 'var(--primary)')
  h += cKpi(cNum(yv(thisY).guests), thisY + ' 人次', lastY?`去年 ${cNum(yv(lastY).guests)}`:'', '#5FD3A6')
  h += cKpi(cxRate(thisY) + '%', '今年取消率', lastY?`去年 ${cxRate(lastY)}%`:'', cxRate(thisY) > 25 ? 'var(--red)' : '#E8A657')
  h += cKpi(rtRate(thisY) + '%', '回頭客訂單比', `#回頭客 ${cNum((idx.segments.repeat||{}).total)} 人`, '#6EB1FF')
  h += cKpi(pct(yv(thisY).kids, yv(thisY).resv) + '%', '親子組佔比', `#帶小孩 ${cNum((idx.segments.kids||{}).total)} 人`, '#F2C94C')
  h += cKpi(cNum(yv(thisY).big), '今年大組/包場', `${cNum(yv(thisY).bigG)} 人次`, '#C792EA')
  h += `</div>`
  // 預覽小圖們
  const last24 = allM.slice(-24)
  const A = cAgg(ins.m, allM)
  // 熱力預覽＝近12個月平均每日人次（v4.40.3 張良抓包：全史總數被黃金年代拉高會誤導排班）
  const A12 = cAgg(ins.m, allM.slice(-12))
  const hAvg = (w,s) => A12.wdD[w] ? +(A12.hp[w][s]/A12.wdD[w]).toFixed(1) : 0
  const wdN9 = ['一','二','三','四','五','六','日'], slotN9 = ['12-13','13-17','18-19','19後']
  const hmax = Math.max(1,...wdN9.map((_,w)=>slotN9.map((_,s)=>hAvg(w,s))).flat())
  const heatTbl = `<div class="hint" style="font-size:10px;margin-bottom:3px">近12個月・平均每日人次</div><table style="width:100%;border-collapse:collapse;font-size:11px"><tr><td></td>${slotN9.map(s=>`<td style="text-align:center;font-weight:800;padding:2px">${s}</td>`).join('')}</tr>${wdN9.map((wl,w)=>`<tr><td style="font-weight:800;padding:2px">${wl}</td>${slotN9.map((_,s)=>{const v=hAvg(w,s);return `<td style="text-align:center;padding:3px 2px;border-radius:4px;background:rgba(95,211,166,${(v/hmax*0.75).toFixed(2)});font-weight:700">${v}</td>`}).join('')}</tr>`).join('')}</table>`
  const srcE = Object.entries(A.src).sort((a,b)=>b[1]-a[1]); const srcT = srcE.reduce((t,[,v])=>t+v,0)
  const ldE = [['當天','d0'],['1-3天前','d1_3'],['4-7天前','d4_7'],['8-30天前','d8_30'],['31天+','d31']]
  const ppE = Object.entries(A.pp).filter(([k])=>k!=='未填'&&k!=='其他備註').sort((a,b)=>b[1]-a[1])
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-bottom:12px">`
  h += go('trend', cLineSvg(last24, last24.map(ym=>ins.m[ym].resv||0), 'var(--primary)'))
  h += go('heat', heatTbl)
  h += go('src', srcE.slice(0,4).map(([k,v])=>cBar(k, v, srcE[0][1], '#6EB1FF', pct(v,srcT)+'%')).join(''))
  h += go('lead', ldE.map(([lb,k])=>cBar(lb, A.lead[k]||0, Math.max(1,...ldE.map(([,k2])=>A.lead[k2]||0)), '#C792EA')).join(''))
  h += go('pp', ppE.slice(0,4).map(([k,v])=>cBar(k, v, ppE[0]?.[1]||1, '#F2C94C')).join('') || '<div class="mut">資料不足</div>')
  h += go('nr', yrs.slice(-4).map(y=>cBar(y, rtRate(y), 100, '#5FD3A6', '回頭 '+rtRate(y)+'%')).join(''))
  h += go('cxl', yrs.slice(-4).map(y=>cBar(y, cxRate(y), 100, cxRate(y)>25?'var(--red)':'#E8A657', cxRate(y)+'%')).join(''))
  h += go('kids', yrs.slice(-4).map(y=>cBar(y, pct(yv(y).kids,yv(y).resv), 100, '#F2C94C', pct(yv(y).kids,yv(y).resv)+'%')).join(''))
  h += go('big', yrs.slice(-4).map(y=>cBar(y, yv(y).bigG, Math.max(1,...yrs.map(y2=>yv(y2).bigG)), '#C792EA', `${yv(y).big}場・${cNum(yv(y).bigG)}人`)).join(''))
  h += `</div>`
  h += `<div class="hint" style="font-size:10.5px">每張卡「點進去」有完整分析：年/月篩選、平均值、趨勢變化。資料=inline 全史（2021-02 起）每小時同步、洞察每天重算（上次 ${String((idx.builtAt||'')).slice(0,16).replace('T',' ')}）；明細問 DD。</div></section>`
  app.innerHTML = h
}
// ── 下鑽分析儀表板（點卡片進來）──────────────────────────────
async function custDetail(kind, keepFilter){
  custV = 'detail'
  if (!keepFilter) { custDK = kind || custDK; if (!kind) kind = custDK }
  kind = custDK
  if (!window._custIns) { const d = await cFetch('custinsights=' + encodeURIComponent(K) + '&v=2', 'custins2'); window._custIns = d }
  const d = window._custIns
  if (!d || !d.ins || !d.ins.m) { app.innerHTML = `<section>${custTopBar()}<div class="err">洞察資料重算中，稍等再進來</div></section>`; return }
  const KD = CUST_KINDS[kind], ins = d.ins
  const yrsAll = [...new Set(Object.keys(ins.m).sort().map(ym=>ym.slice(0,4)))].filter(y=>y<=todayTpe().slice(0,4))
  const yms = cMsel(ins.m)
  const A = cAgg(ins.m, yms)
  const pct = (a,b) => b ? Math.round(a/b*100) : 0
  const serie = fn => yms.map(ym=>fn(ins.m[ym]||{}))
  // 篩選列
  const yChip = v => `<button class="mini" onclick="custDy='${v}';custDm='all';custDetail('${kind}',1)" style="padding:3px 11px;font-weight:800;${custDy===v?'background:var(--primary);color:#fff;border-color:var(--primary)':''}">${v==='12m'?'近12個月':v==='all'?'全史':v}</button>`
  const mChip = v => `<button class="mini" onclick="custDm='${v}';custDetail('${kind}',1)" style="padding:3px 9px;font-weight:800;${custDm===v?'background:var(--primary);color:#fff;border-color:var(--primary)':''}">${v==='all'?'全年':Number(v)+'月'}</button>`
  let h = `<section>${custTopBar()}`
  h += `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><button class="mini" style="padding:5px 13px;font-weight:800" onclick="custLoad('home')">‹ 返回洞察</button><span style="font-weight:900;font-size:16px;color:${KD.c}">${KD.t}・完整分析</span></div>`
  h += `<div class="hint" style="font-size:12px;line-height:1.6;margin-bottom:8px">${KD.d}</div>`
  h += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">${['12m','all',...yrsAll].map(yChip).join('')}</div>`
  if (custDy !== 'all' && custDy !== '12m') h += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">${['all','01','02','03','04','05','06','07','08','09','10','11','12'].map(mChip).join('')}</div>`
  const periodLb = custDy==='12m' ? '近12個月' : (custDy==='all'?'全史':custDy + (custDm==='all'?' 全年':' '+Number(custDm)+'月'))
  if (!yms.length) { h += `<div class="err">這段期間沒有資料</div></section>`; app.innerHTML = h; return }
  const avgG = A.resv ? (A.guests/A.resv).toFixed(1) : 0
  const wdN9 = ['一','二','三','四','五','六','日'], slotN9 = ['12-13','13-17','18-19','19後']
  // 共用 KPI 條
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:10px">`
  h += cKpi(cNum(A.resv), periodLb + ' 訂位組數', '', KD.c) + cKpi(cNum(A.guests), '訂位人次', `平均每組 ${avgG} 人`, KD.c) + cKpi(pct(A.cxl, A.resv+A.cxl)+'%', '取消率', `取消 ${cNum(A.cxl)} 筆`, A.cxl/(A.resv+A.cxl||1)>0.25?'var(--red)':'#E8A657')
  // POS 對帳卡（v4.40.4 張良「跟營業額人均對得起來嗎」：訂位人次≠真來客——9月實測訂位=POS的110%）
  // v4.40.5：覆蓋率只用「有 POS 資料的月份」對齊算（AB POS 2026-01 起才有；直接除會變 206% 假水分）
  if (A.posG) {
    const ymsP = yms.filter(ym=>(ins.m[ym]||{}).posG)
    const AP = cAgg(ins.m, ymsP)
    h += cKpi(cNum(A.posG), '同期 POS 實際來客', `營收 ${cNum(Math.round(A.posRev/10000))} 萬・人均 NT$${cNum(Math.round(A.posRev/A.posG))}`, '#5FD3A6') + cKpi(pct(AP.guests, AP.posG)+'%', '訂位人次/實際來客', (pct(AP.guests,AP.posG)>100?'訂位有水分（沒到/沒調人數）':'缺口=現場客') + `（對齊 ${ymsP.length} 個有POS的月）`, pct(AP.guests,AP.posG)>100?'#E8A657':'#6EB1FF')
  }
  if (A.wlG) h += cKpi(cNum(A.wlG), '候補人次（已切出，不計入）', `${cNum(A.wlN)} 組沒進店`, '#8C98A8')
  if (A.wkG) h += cKpi(cNum(A.wkG), '現場客人次（含在人次內）', `${cNum(A.wkN)} 組 walk-in 真進店`, '#5FD3A6')
  h += `</div>`
  if (A.posG) h += `<div class="hint" style="font-size:11px;margin:-4px 0 8px">⚠️ 訂位人次是「訂的時候寫的」，實際少來、沒調人數不會改——絕對人數以 POS 來客為準，這張表拿來看「相對強弱與預約壓力」。</div>`
  if (kind === 'trend'){
    const mets = [['guests','人次'],['resv','組數'],['avg','平均每組人數']]
    if (!custDmet || !mets.some(([k])=>k===custDmet)) custDmet = 'guests'
    h += `<div style="margin-bottom:6px">${mets.map(([k,lb])=>`<button class="mini" onclick="custDmet='${k}';custDetail('trend',1)" style="padding:3px 11px;font-weight:800;${custDmet===k?'background:var(--primary);color:#fff;border-color:var(--primary)':''}">${lb}</button>`).join('')}</div>`
    const vals = custDmet==='avg' ? serie(m=>m.resv?+(m.guests/m.resv).toFixed(1):0) : serie(m=>m[custDmet]||0)
    h += cCard(`📈 每月${mets.find(([k])=>k===custDmet)[1]}趨勢（${periodLb}）`, cLineSvg(yms, vals, KD.c))
    h += `<div style="height:8px"></div>` + cCard('月明細（含 POS 對帳）', `<div class="scroll" style="max-height:38vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap"><tr>${['月份','訂位組數','訂位人次','平均每組','取消率','POS來客','POS營收','人均消費','訂位/來客'].map(x=>`<th style="position:sticky;top:0;background:var(--soft);padding:4px 8px">${x}</th>`).join('')}</tr>${[...yms].reverse().map(ym=>{const m=ins.m[ym];const cov=m.posG?pct(m.guests,m.posG):0;return `<tr>${[ym, cNum(m.resv), cNum(m.guests), m.resv?(m.guests/m.resv).toFixed(1):'—', pct(m.cxl,m.resv+m.cxl)+'%', m.posG?cNum(m.posG):'—', m.posRev?cNum(m.posRev):'—', m.posG?('NT$'+cNum(Math.round(m.posRev/m.posG))):'—', m.posG?`<b style="color:${cov>100?'#E8A657':'#6EB1FF'}">${cov}%</b>`:'—'].map(x=>`<td style="border-top:1px solid var(--line);padding:3px 8px">${x}</td>`).join('')}</tr>`}).join('')}</table></div><div class="hint" style="font-size:10.5px;margin-top:4px">POS 來客/營收＝日結真值（AB 2026-01 起才有）；訂位/來客 >100% ＝訂位有水分（沒到、沒調人數）。</div>`)
  }
  if (kind === 'heat'){
    const mets = [['avgp','平均每日人次'],['tot','總人次'],['avgg','平均每組人數']]
    if (!custDmet || !mets.some(([k])=>k===custDmet)) custDmet = 'avgp'
    h += `<div style="margin-bottom:6px">${mets.map(([k,lb])=>`<button class="mini" onclick="custDmet='${k}';custDetail('heat',1)" style="padding:3px 11px;font-weight:800;${custDmet===k?'background:var(--primary);color:#fff;border-color:var(--primary)':''}">${lb}</button>`).join('')}</div>`
    const cell = (w,s) => custDmet==='tot' ? A.hp[w][s] : custDmet==='avgg' ? (A.hg[w][s]?+(A.hp[w][s]/A.hg[w][s]).toFixed(1):0) : (A.wdD[w]?+(A.hp[w][s]/A.wdD[w]).toFixed(1):0)
    const grid = wdN9.map((_,w)=>slotN9.map((_,s)=>cell(w,s)))
    const gmax = Math.max(1,...grid.flat())
    h += cCard(`🔥 週幾 × 時段（${periodLb}・${mets.find(([k])=>k===custDmet)[1]}）`, `<table style="width:100%;border-collapse:collapse;font-size:12px"><tr><td></td>${slotN9.map(s=>`<td style="text-align:center;font-weight:800;padding:3px">${s}</td>`).join('')}<td style="text-align:center;font-weight:800;padding:3px;color:var(--muted)">全日</td></tr>${grid.map((row,w)=>`<tr><td style="font-weight:800;padding:3px">${wdN9[w]}</td>${row.map(v=>`<td style="text-align:center;padding:5px 3px;border-radius:5px;background:rgba(95,211,166,${(v/gmax*0.75).toFixed(2)});font-weight:800">${cNum(v)}</td>`).join('')}<td style="text-align:center;font-weight:800;color:var(--muted)">${custDmet==='avgg'?'—':cNum(+(row.reduce((t,v)=>t+v,0)).toFixed(1))}</td></tr>`).join('')}</table><div class="hint" style="font-size:10.5px;margin-top:5px">平均每日人次＝該星期有營業資料的天數平均（例：週日 12-13 平均 ${cNum(cell(6,0))} 人＝每個週日中午約要接這麼多人）。</div>`)
    h += `<div style="height:8px"></div>` + cCard(`每月人次趨勢（${periodLb}）`, cLineSvg(yms, serie(m=>m.guests||0), KD.c))
  }
  if (kind === 'src'){
    const E = Object.entries(A.src).sort((a,b)=>b[1]-a[1]); const T = E.reduce((t,[,v])=>t+v,0)
    h += cCard(`📣 通路佔比（${periodLb}）`, E.map(([k,v])=>cBar(k, v, E[0][1], '#6EB1FF', pct(v,T)+'%・'+cNum(v))).join(''))
    const SC = { 'Google':'#6EB1FF','店內/電話':'#5FD3A6','官網/線上':'#C792EA','FB/IG':'#F2C94C','OpenTable':'#F07373','其他':'#8C98A8' }
    const keys = E.map(([k])=>k)
    h += `<div style="height:8px"></div>` + cCard('每月通路組成（100% 堆疊）', [...yms].reverse().slice(0,24).reverse().map(ym=>{ const m=ins.m[ym]||{}; const t=Object.values(m.src||{}).reduce((a,b)=>a+b,0)||1; return `<div style="display:flex;align-items:center;gap:8px;margin:2.5px 0"><span style="width:56px;font-size:11px;font-weight:800">${ym.slice(2)}</span><div style="flex:1;display:flex;height:12px;border-radius:4px;overflow:hidden;background:var(--soft)">${keys.map(k=>`<div style="width:${((m.src||{})[k]||0)/t*100}%;background:${SC[k]||'#8C98A8'}" title="${k} ${pct((m.src||{})[k]||0,t)}%"></div>`).join('')}</div></div>` }).join('') + `<div class="hint" style="font-size:10.5px;margin-top:5px">${keys.map(k=>`<span style="color:${SC[k]||'#8C98A8'};font-weight:800">■</span> ${k}`).join('　')}</div>`)
  }
  if (kind === 'lead'){
    const ldE = [['當天','d0'],['1-3天前','d1_3'],['4-7天前','d4_7'],['8-30天前','d8_30'],['31天+','d31']]
    const T = ldE.reduce((t,[,k])=>t+(A.lead[k]||0),0)
    h += cCard(`⏰ 提前訂位分布（${periodLb}）`, ldE.map(([lb,k])=>cBar(lb, A.lead[k]||0, Math.max(1,...ldE.map(([,k2])=>A.lead[k2]||0)), KD.c, pct(A.lead[k]||0,T)+'%・'+cNum(A.lead[k]||0))).join(''))
    h += `<div style="height:8px"></div>` + cCard('「當天才訂」比例逐月（高=臨時客多，要留機動桌）', cLineSvg(yms, serie(m=>{ const t=Object.values(m.lead||{}).reduce((a,b)=>a+b,0); return t?Math.round((m.lead||{}).d0/t*100):0 }), KD.c, v=>v+'%'))
  }
  if (kind === 'pp'){
    const E = Object.entries(A.pp).filter(([k])=>k!=='未填').sort((a,b)=>b[1]-a[1]); const T = E.reduce((t,[,v])=>t+v,0)
    h += cCard(`🎯 用餐目的分布（${periodLb}・有填備註者）`, E.map(([k,v])=>cBar(k, v, E[0]?.[1]||1, KD.c, pct(v,T)+'%・'+cNum(v))).join(''))
    h += `<div style="height:8px"></div>` + cCard('慶生組數逐月（節日商品檔期依據）', cLineSvg(yms, serie(m=>(m.pp||{})['慶生']||0), KD.c))
  }
  if (kind === 'nr'){
    h += cCard(`🆕 新客 vs 回頭（${periodLb}）`, (()=>{ const mx = Math.max(1,...yms.map(ym=>{const m=ins.m[ym];return (m.nw||0)+(m.rt||0)})); return [...yms].slice(-24).map(ym=>{ const m=ins.m[ym]||{}; const t=(m.nw||0)+(m.rt||0); return `<div style="display:flex;align-items:center;gap:8px;margin:2.5px 0"><span style="width:56px;font-size:11px;font-weight:800">${ym.slice(2)}</span><div style="flex:1;display:flex;height:12px;border-radius:4px;overflow:hidden;background:var(--soft)"><div style="width:${(m.nw||0)/mx*100}%;background:#6EB1FF"></div><div style="width:${(m.rt||0)/mx*100}%;background:#5FD3A6"></div></div><span style="font-size:11px;min-width:110px;text-align:right">新${cNum(m.nw)}/回${cNum(m.rt)}（回頭${pct(m.rt,t)}%）</span></div>` }).join('') })() + `<div class="hint" style="font-size:10.5px;margin-top:4px">🔵新客 🟢回頭客（以客人第一次訂位當新客）</div>`)
    h += `<div style="height:8px"></div>` + cCard('回頭客訂單比逐月', cLineSvg(yms, serie(m=>pct(m.rt,(m.nw||0)+(m.rt||0))), '#5FD3A6', v=>v+'%'))
  }
  if (kind === 'cxl'){
    h += cCard('❌ 取消率逐月（紅線＝25% 警戒值以上要上訂金）', cLineSvg(yms, serie(m=>pct(m.cxl,(m.resv||0)+(m.cxl||0))), '#F07373', v=>v+'%'))
    h += `<div style="height:8px"></div>` + cCard('月明細', `<div class="scroll" style="max-height:38vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><tr>${['月份','有效訂位','取消','取消率'].map(x=>`<th style="position:sticky;top:0;background:var(--soft);padding:4px 8px">${x}</th>`).join('')}</tr>${[...yms].reverse().map(ym=>{const m=ins.m[ym];const r=pct(m.cxl,m.resv+m.cxl);return `<tr>${[ym, cNum(m.resv), cNum(m.cxl), `<b style="color:${r>25?'var(--red)':'#E8A657'}">${r}%</b>`].map(x=>`<td style="border-top:1px solid var(--line);padding:3px 8px">${x}</td>`).join('')}</tr>`}).join('')}</table></div>`)
  }
  if (kind === 'kids'){
    h += cCard('🧒 親子組佔比逐月', cLineSvg(yms, serie(m=>pct(m.kids,m.resv)), KD.c, v=>v+'%'))
    h += `<div style="height:8px"></div>` + cCard('親子組數逐月', cLineSvg(yms, serie(m=>m.kids||0), '#E8A657'))
  }
  if (kind === 'big'){
    h += cCard('🎉 大組/包場人次逐月', cLineSvg(yms, serie(m=>m.bigG||0), KD.c))
    const list = (ins.bigList||[]).filter(b=>yms.includes(b.d.slice(0,7)))
    h += `<div style="height:8px"></div>` + cCard(`場次清單（${periodLb}・共 ${cNum(list.length)} 場）`, `<div class="scroll" style="max-height:40vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap"><tr>${['#','日期','時間','名稱','人數'].map(x=>`<th style="position:sticky;top:0;background:var(--soft);padding:4px 8px">${x}</th>`).join('')}</tr>${list.slice(0,300).map((b,i)=>`<tr>${[i+1, b.d, b.t||'—', `<b>${b.n||'—'}</b>`, `<b style="color:#C792EA">${b.g}</b>`].map(x=>`<td style="border-top:1px solid var(--line);padding:3px 8px">${x}</td>`).join('')}</tr>`).join('')}</table></div>`)
  }
  h += `</section>`
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
  h += `<div class="scroll" style="max-height:62vh;overflow:auto"><table style="border-collapse:collapse;font-size:12.5px;white-space:nowrap"><thead><tr>${['#','姓名','稱謂','手機','Email','入座','人次','小孩','最大組','取消','首次來','最近來'].map(x=>`<th style="position:sticky;top:0;background:var(--soft);border:1px solid var(--line);padding:5px 8px;font-size:11.5px">${x}</th>`).join('')}</tr></thead><tbody>`
  h += custRows.map((c,i9)=>`<tr>${[`<span class="hint" style="font-size:11px">${i9+1}</span>`, `<b>${c.n}</b>`, gdT(c.gd), c.ph||'—', c.em||'—', `<b style="color:#5FD3A6">${c.v}</b>`, cNum(c.p), c.k?`<span style="color:#F2C94C;font-weight:800">${c.k}</span>`:'—', c.mx>=20?`<b style="color:#C792EA">${c.mx}</b>`:(c.mx||'—'), c.cx||'—', c.f||'—', c.l||'—'].map(x=>`<td style="border:1px solid var(--line);padding:4px 8px">${x}</td>`).join('')}</tr>`).join('')
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
const TAB_DEF = { prep:'銷售數據', sop:'SOP', task:'任務', lb:'排行榜', food:'盤點', pack:'包材', buy:'採購', meet:'會議', shift:'班表', inc:'異常通知', fb:'回饋', menu:'菜單', cust:'inline', hrm:'夥伴名冊' } // v4.33.0 去emoji；cust=inline顧客資料庫(v4.39.0 張良)
// ── 單色線條 icon（張良 2026-09-24：不要彩色 emoji——同 Beach Ops 的 stroke 線條圖）──
const _I = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;vertical-align:-3px">${d}</svg>`
const TAB_ICONS = {
  prep: _I('<path d="M4 20V10M10 20V4M16 20v-9M20 20H4"/>'), // v4.42.1 銷售數據=長條圖（原備料鍋蓋退役）
  inc: _I('<path d="M12 3 2.5 20h19Z"/><path d="M12 9.5V14M12 17h.01"/>'), // v4.41.5 異常通知原本缺icon=側欄那行沒圖示歪掉
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
  hrm: _I('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10.5" r="2.1"/><path d="M5.8 16c.4-1.7 1.7-2.7 3.2-2.7s2.8 1 3.2 2.7M14.5 9.5H18.2M14.5 12.8H17"/>'), // 🪪 員工清冊（v4.34.0）
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
const FAV_DEFAULT = ['home','shift','sop','food','buy'] // v4.40.4 手機頂部功能鈕整排收掉→首頁進預設常用
const FAV_MAX = 5
const favAll = () => ['home', ...Object.keys(TAB_DEF), 'errs'].filter(k => { const b = document.getElementById(k==='home'?'tab-home':'tab-'+k); return b && b.style.display !== 'none' }) // 被權限藏掉的分頁不給選
const favGet = () => { try { const v = JSON.parse(localStorage.getItem('gdFav')||'null'); if (Array.isArray(v) && v.length) return v } catch(_){}; return FAV_DEFAULT }
const favLabel = k => k==='home' ? '首頁' : k==='errs' ? '回報' : stripEmoji(((window._tabCfg||{}).names||{})[k] || TAB_DEF[k] || k)
function favRender(){
  const bar = document.getElementById('favbar'); if (!bar) return
  const list = favGet().filter(k => favAll().includes(k)).slice(0, FAV_MAX)
  // v4.40.4（張良拍板）：☰放最左=全部功能彈層（✎編輯收進彈層）；手機頂部功能鈕/大標題整排收掉後這裡是唯一入口
  bar.innerHTML = `<button onclick="navSheet()" title="全部功能" style="flex:0 0 54px">${_I('<path d="M4 7h16M4 12h16M4 17h16"/>')}<span>全部</span></button>`
    + list.map(k => `<button data-fk="${k}" onclick="favGo('${k}')">${TAB_ICONS[k]||TAB_ICONS.home}<span>${favLabel(k)}</span></button>`).join('')
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
function favEdit(){ // 編輯彈層：點=加入/移除、數字=顯示順序(照點的先後)
  // v4.40.6（張良「完成旁邊要有取消」「滿了按新的自動擠掉最早的=邏輯有問題」）：滿5=不自動擠、紅字提示先移除；＋取消鈕不存直接關
  let sel = favGet().filter(k => favAll().includes(k)).slice(0, FAV_MAX)
  const ov = document.createElement('div'); ov.id = 'favOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;display:flex;align-items:flex-end;justify-content:center'
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
  const box = document.createElement('div')
  box.style.cssText = 'background:var(--bg);border:1px solid var(--line);border-radius:18px 18px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));width:100%;max-width:560px;max-height:78vh;overflow-y:auto'
  const draw = () => {
    box.innerHTML = `<h2 style="margin-bottom:4px">我的常用清單</h2><div class="hint" style="margin-bottom:10px">點一下＝加入/移除，數字＝顯示順序（最多 ${FAV_MAX} 個）${TK()?'・跟著你的身分走，換手機也在':'・先綁定身分，換手機清單才會跟著'}</div>
      <div id="favList" style="display:grid;grid-template-columns:repeat(4,1fr);gap:9px">${favAll().map(k => { const i = sel.indexOf(k); return `<button class="favchip${i>=0?' on':''}" data-k="${k}">${TAB_ICONS[k]||''}<span>${favLabel(k)}</span>${i>=0?`<b class="fno">${i+1}</b>`:''}</button>` }).join('')}</div>
      <div id="favWarn" style="min-height:19px;margin-top:8px;font-size:13px;font-weight:700;color:var(--red)"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button class="mini" style="padding:9px 16px" id="favReset">回預設</button><button class="mini" style="padding:9px 18px;margin-left:auto" id="favCancel">取消</button><button class="mini on" style="padding:9px 22px;font-size:15px" id="favOk">✓ 完成</button></div>`
    box.querySelectorAll('.favchip').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k; const i = sel.indexOf(k)
      if (i >= 0) sel.splice(i, 1)
      else {
        if (sel.length >= FAV_MAX) { // 滿了不自動擠（會默默弄丟別的）——提示自己挑一個移除
          const w = box.querySelector('#favWarn'); if (w) w.textContent = `已滿 ${FAV_MAX} 個——先點掉一個，再加「${favLabel(k)}」`
          b.style.transition = 'transform .08s'; b.style.transform = 'translateX(4px)'; setTimeout(()=>{ b.style.transform = '' }, 120) // 輕晃提示按到了但加不進去
          return
        }
        sel.push(k)
      }
      draw() }))
    box.querySelector('#favReset').addEventListener('click', () => { sel = FAV_DEFAULT.slice(); draw() })
    box.querySelector('#favCancel').addEventListener('click', () => ov.remove()) // 不存直接關
    box.querySelector('#favOk').addEventListener('click', () => { favSave(sel.length ? sel : FAV_DEFAULT.slice()); ov.remove() })
  }
  draw(); ov.appendChild(box); document.body.appendChild(ov)
}
function navSheet(){ // ☰ 全部功能彈層（v4.40.4）：手機版頂部功能鈕收掉後的總入口；含通知中心(未讀數)與✎編輯常用
  const old9 = document.getElementById('navOv'); if (old9) { old9.remove(); return }
  const ov = document.createElement('div'); ov.id = 'navOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;display:flex;align-items:flex-end;justify-content:center'
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove() })
  const box = document.createElement('div')
  box.style.cssText = 'background:var(--bg);border:1px solid var(--line);border-radius:18px 18px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));width:100%;max-width:560px;max-height:78vh;overflow-y:auto'
  const cur = window._favCur
  let un9 = 0; try { un9 = ntfUnread() } catch(_){}
  box.innerHTML = `<h2 style="margin-bottom:10px">全部功能</h2>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:9px">${favAll().map(k => `<button class="favchip${(k===cur||(k==='home'&&(cur==='ground'||cur==='abeach')))?' on':''}" data-k="${k}">${TAB_ICONS[k]||''}<span>${favLabel(k)}</span></button>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:14px;align-items:center"><button class="mini" style="padding:9px 14px;display:inline-flex;gap:6px;align-items:center" id="navNtf">${TAB_ICONS.bell}通知${un9?` (${un9})`:''}</button><button class="mini" style="padding:9px 14px;margin-left:auto;display:inline-flex;gap:6px;align-items:center" id="navFavEd">${_I('<path d="M4 20h4L19.3 8.7a2.12 2.12 0 0 0-3-3L5 17Z"/><path d="M13.5 6.5l3 3"/>')}編輯常用清單</button></div>`
  box.querySelectorAll('.favchip').forEach(b => b.addEventListener('click', () => { ov.remove(); favGo(b.dataset.k) }))
  box.querySelector('#navNtf').addEventListener('click', () => { ov.remove(); try { ntfPage() } catch(_){} })
  box.querySelector('#navFavEd').addEventListener('click', () => { ov.remove(); favEdit() })
  ov.appendChild(box); document.body.appendChild(ov)
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
  // v4.41.3 張良改規則：夥伴名冊全員可看（身分證欄另有名單鎖、編輯鈕只給主管）——v4.41.2 的藏按鈕取消
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
