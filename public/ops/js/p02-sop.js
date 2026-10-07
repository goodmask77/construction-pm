// ⚠️ 這是 /prep 主程式的第 2/10 塊（v4.40.0 拆檔：原 index.html 單一大 <script> 依原順序切開，classic script 共用全域、載入順序就是執行順序——不可單獨重排）
// 本塊內容：節奏表+SOP打卡+推播+模擬檢視+SOP分層
// ── 預做節奏表渲染（完整菜單＋品類分組＋隱藏；隱藏清單在 sopData.prepHide，sopLoad 後會再畫一次）──
let rhyMode = +(localStorage.getItem('rhyMode')||30), rhyMngOn = false // 預設30分（張良 2026-10-02）
function rSwitch(m){ rhyMode = m; try{localStorage.setItem('rhyMode',m)}catch(_){} document.getElementById('rb15').className = 'mini' + (m===15?' on':''); document.getElementById('rb30').className = 'mini' + (m===30?' on':''); rhythmRender() }
function rMng(){ rhyMngOn = !rhyMngOn; const b = document.getElementById('rbMng'); if (b) b.className = 'mini' + (rhyMngOn?' on':''); rhythmRender() }
function rhythmRender(){
  const R = window._rhy, el = document.getElementById('rhyBody'); if (!R || !el) return
  const hide = (sopData && sopData.prepHide) || {}
  const canMng = !!(sopData && sopData.me)
  const slots = rhyMode === 30 ? R.slots.filter((_,i)=>i%2===0) : R.slots
  const qOf = o => rhyMode === 30 ? slots.map((_,i)=>Math.round(((o.q[i*2]||0)+(o.q[i*2+1]||0))*10)/10) : o.q
  const cell = v => v >= 0.5 ? '<b>'+(Math.round(v*10)/10)+'</b>' : (v>0?'·':'<span class="mut">0</span>')
  // 備料導向重分類（張良 2026-09-21：漢堡拆牛肉/煎雞/炸雞、小點拆炸雞(×2=支數)/薯條——同備法放一起、每類帶時段加總抓量）
  const rhyCatOf = o => {
    if (o.cat === '漢堡') return /牛肉/.test(o.n) ? '🥩 牛肉堡' : (/炸雞/.test(o.n) ? '🍗 炸雞堡' : '🍳 煎雞堡')
    if (o.cat === '小點') return /炸雞/.test(o.n) ? '🍗 單點炸雞' : (/薯/.test(o.n) ? '🍟 薯條類' : '🥔 其他小點')
    return o.cat
  }
  const rhyMult = o => (o.cat === '小點' && /炸雞/.test(o.n)) ? 2 : 1 // 目前炸雞一份=2支→×2顯示個數（以後有單點炸雞照名字歸類）
  const rows = R.items.filter(o => rhyMngOn || !hide[o.k]).map(o => ({ ...o, _rc: rhyCatOf(o), _m: rhyMult(o) }))
  const hidCnt = R.items.filter(o => hide[o.k]).length
  const CAT_ORDER = ['披薩', '🥩 牛肉堡', '🍳 煎雞堡', '🍗 炸雞堡', '越法三明治', '🍗 單點炸雞', '🍟 薯條類', '🥔 其他小點']
  const cats = [...new Set(rows.map(o=>o._rc))].sort((a,b)=>{ const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib) })
  let s = `<div class="scroll" style="max-height:70vh;overflow-y:auto"><table><thead><tr><th style="position:sticky;left:0;background:var(--soft);z-index:2">品項${hidCnt&&!rhyMngOn?`<span class="hint">（隱藏${hidCnt}項）</span>`:''}</th>${rhyMngOn?'<th></th>':''}${slots.map(t=>'<th>'+t+'</th>').join('')}</tr></thead><tbody>`
  cats.forEach(c=>{
    const grp = rows.filter(o=>o._rc===c)
    const live = grp.filter(o=>!hide[o.k]) // 加總不含隱藏
    const sums = slots.map((_,i)=>live.reduce((t2,o)=>t2+(qOf(o)[i]||0)*o._m,0))
    s += `<tr class="catband"><td style="position:sticky;left:0;background:var(--psoft);z-index:1">${c}${c==='🍗 單點炸雞'?' <span style="font-weight:600;font-size:11.5px">×2=支</span>':''}</td>${rhyMngOn?'<td></td>':''}${sums.map(v=>`<td style="font-weight:900;font-size:14px;color:#C2410C">${v>=0.5?Math.round(v*10)/10:(v>0?'·':'<span style=\"opacity:.3;font-size:13px\">0</span>')}</td>`).join('')}</tr>`
    grp.forEach(o=>{
      const hid = hide[o.k]
      s += `<tr style="${rhyMngOn&&hid?'opacity:.42':''}"><td class="iname" style="position:sticky;left:0;background:var(--card);z-index:1" title="${o.n}">${o.n}${o._m>1?' <span class="hint">×2</span>':''}</td>${rhyMngOn?`<td><button class="mini" onclick="rHide('${encodeURIComponent(o.k)}',${hid?0:1})">${hid?'恢復':'隱藏'}</button></td>`:''}${qOf(o).map(v=>'<td>'+cell(v*o._m)+'</td>').join('')}</tr>`
    })
  })
  s += `</tbody></table></div>${rhyMngOn?'<div class="hint" style="margin-top:6px">點「隱藏」的品項不會出現在預做表（要綁定過才能改；再按🙈可恢復）</div>':''}`
  el.innerHTML = s
}
async function rHide(kEnc, hideV){
  if (!(sopData && sopData.me)) { alert('要先跟 DD 說「綁定GD」才能改隱藏設定'); return }
  const r = await fetch('/api/mail-sync?prephide=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ key: decodeURIComponent(kEnc), hide: !!hideV, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) { sopData.prepHide = d.prepHide; rhythmRender() } else alert((d&&d.error)||'失敗')
}
// ── 今日SOP（每站每天：拍照＋完成打卡；超時 DD 會通知群）──
// 個人身分：跟 DD 說「綁定看板」拿到 /prep?me=token 連結 → 存這支手機，打卡自動是本人、站長可編輯自己的站
;(function(){ const sp = new URLSearchParams(location.search); const m = sp.get('me'); if (m) localStorage.setItem('prepToken', m); if (m || sp.has('r')) history.replaceState(null, '', location.pathname + location.hash) })() // v4.31.0 保留 #meet=/#sop= 深層連結 // r=🔄的快取時間戳，進站就清掉（張良 2026-09-24：網址多一段）
const TK = () => localStorage.getItem('prepToken') || ''
// 📱 已綁定→manifest 換成個人化版（v4.31.2 張良：換 icon 重加 App 變訪客）：加入主畫面的捷徑 start_url 自帶 ?me=token，重加 App 身分不掉
function maniSync(){ try { const t8 = TK(); const l8 = document.querySelector('link[rel="manifest"]'); if (l8) l8.href = t8 ? ('/api/mail-sync?manifest=1&me=' + encodeURIComponent(t8)) : '/ops/manifest.json?v=2' } catch(_){} }
// ── 🔔 Web Push（v4.33.0 張良：點通知直接打開主畫面GD+本人身分）──
// iOS 規則：只有「加到主畫面」的 GD 裡才有 Notification（Safari 沒有）；允許通知一定要本人手點
if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('/sw.js') } catch(e){} } // sw 在根目錄＝scope 蓋到 /prep
// v4.33.2 圖示紅點：打開 App 就清掉（下次推播會再帶最新未簽收數）；回到前景也清
try { if ('clearAppBadge' in navigator) { navigator.clearAppBadge().catch(()=>{}); document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) navigator.clearAppBadge().catch(()=>{}) }) } } catch(e){}
let _wpCfg = null
async function wpCfg(){ if (_wpCfg) return _wpCfg; try { _wpCfg = await (await fetch('/api/mail-sync?webpushcfg=1')).json() } catch(e){ _wpCfg = {} } return _wpCfg }
function wpSupport(){ return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window }
function wpB64(s){ const p='='.repeat((4-s.length%4)%4); const b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...b].map(c=>c.charCodeAt(0))) }
async function pushSub(){ try { // 訂閱＋回報伺服器（已允許時默默跑＝換裝置/過期自動補）
  const cfg = await wpCfg(); if (!cfg || !cfg.key || !TK()) return false
  const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wpB64(cfg.key) })
  const r = await fetch('/api/mail-sync?pushsub=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), sub: sub.toJSON() }) })
  const j = await r.json().catch(()=>null)
  return !!(j && j.ok)
} catch(e){ return false } }
async function pushOn(){ // 🔔 按鈕（一定要使用者手點，iOS 規定）
  if (!TK()) { alert('要先綁定身分才能開通知：私訊 DD「綁定GD 你的本名」'); return }
  if (!wpSupport()) { alert('這裡開不了通知。iPhone 請用「加到主畫面」的 GD App 打開，再按一次鈴鐺鈕'); return }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') { alert('沒有允許通知。之後要開：iPhone 設定 → 通知 → GD'); return }
  const ok = await pushSub()
  alert(ok ? '通知開好了！之後簽收提醒、公告點通知就直接打開 GD' : '訂閱沒成功，網路穩一點再按一次鈴鐺鈕')
  try { meChipInit() } catch(e){}
}
maniSync()
// ── 模擬檢視（v4.32.0 張良「切換不同使用者，確認每人畫面/設定/權限都正確」）──
// 原理＝攔截全站 fetch：讀取自動帶 &as=對方rid → 伺服器直接用「那個人」的身分回資料（分頁藏不藏、按鈕有沒有、設定看不看得到＝跟本人開起來一模一樣，不是前端假裝）；寫入（POST）全部擋下＝只能看不能改
const SIM = (()=>{ try { return JSON.parse(sessionStorage.getItem('gdSim')||'null') } catch(e){ return null } })()
// v4.32.2 張良「不要這個圖 以後都不要有顏色的emoji」：眼睛改單色線條 SVG（同側欄 stroke 風），UI 一律不用彩色 emoji
const EYE_I = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
// ── 全站彩色emoji→單色線條icon（v4.33.0 張良「以後都不要有顏色的emoji」）──
// 集中一處治本：MutationObserver 盯著畫面，文字裡出現彩色 emoji 就原地換成 stroke SVG（同側欄風格）；
// 以後程式再寫到 emoji 也會自動被換＝規則自動執行。<option>/<title> 塞不了 SVG → 直接把字拿掉。
const _EI = d => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2.5px;flex:0 0 auto">' + d + '</svg>'
const _EP = s => _EI('<path d="' + s + '"/>')
const EMO_SVG = (() => {
  const food = _EP('M4 7h16l-1.5 13h-13ZM8 7a4 4 0 0 1 8 0')
  const tool = _EP('M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6V21h3.4l5.7-5.7a4.5 4.5 0 0 0 5.6-6l-3 3-2.8-.7-.7-2.8Z')
  const folder = _EP('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z')
  const inbox = _EP('M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6ZM22 12h-6l-2 3h-4l-2-3H2')
  const mega = _EP('m3 11 18-7v16L3 13v-2ZM7.5 13.6v3.9a1.5 1.5 0 0 0 3 .3l-.8-4')
  const medal = _EI('<circle cx="12" cy="15.5" r="5"/><path d="m8.5 11-3-8h4.5l2 5M15.5 11l3-8H14l-2 5"/>')
  const lock = _EI('<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>')
  const help = _EI('<circle cx="12" cy="12" r="9"/><path d="M9.3 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.7 2.3-2.7 4M12 17.5h.01"/>')
  const util = _EP('M7 2v8a2 2 0 0 0 4 0V2M9 2v20M17 22V2c-2 1-3 3.5-3 6v5h3')
  const clock = _EI('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')
  const check = _EP('M4 12.5 9.5 18 20 6')
  return {
  '✅': check, '☑': check, '❌': _EP('M5 5l14 14M19 5 5 19'),
  '🗑': _EP('M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6'),
  '⚙': _EI('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M2.8 12h2.6M18.6 12h2.6M4.9 19.1l1.9-1.9M17.2 6.8l1.9-1.9"/>'),
  '✏': _EP('M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'),
  '⚠': _EP('M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01'),
  '🔔': _EP('M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9ZM10 20a2.2 2.2 0 0 0 4 0'),
  '📷': _EI('<path d="M4 7h3l2-2.5h6L17 7h3a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V8.5A1.5 1.5 0 0 1 4 7Z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  '🔗': _EP('M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1L11.7 5M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1L12.3 19'),
  '📎': _EP('m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5'),
  '🎓': _EP('M22 10 12 5 2 10l10 5ZM6 12.5V17c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.5M22 10v5'),
  '📋': _EI('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2v4M15 2v4M8.5 11h7M8.5 15h5"/>'),
  '⭐': _EP('m12 3 2.7 5.7 6.3.9-4.6 4.4 1.1 6.2-5.5-3-5.5 3 1.1-6.2L3 9.6l6.3-.9Z'),
  '🕐': clock, '⏱': clock, '⏳': _EP('M6 2h12M6 22h12M7 2v4.5L12 11l5-4.5V2M7 22v-4.5L12 13l5 4.5V22'),
  '⏰': _EI('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M5 3 2.5 5.5M19 3l2.5 2.5"/>'),
  '📦': _EP('M21 8 12 3 3 8v8l9 5 9-5ZM3 8l9 5 9-5M12 13v8'),
  '📅': _EI('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  '🎉': _EP('M5.5 11 13 18.5 3 21ZM9.5 8.5 15 14M13.5 6.5 15 5M17 10.5l2.5-.5M14.5 2.5 14 5.5M20.5 5 17.5 8'),
  '👤': _EI('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
  '🙋': _EI('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
  '📝': _EP('M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M18.4 2.6a2 2 0 0 1 2.8 2.8L13 13.5l-3.5 1 1-3.5Z'),
  '💡': _EP('M9 18h6M10 21h4M12 3a6 6 0 0 1 3.5 10.9c-.7.5-1 1.3-1 2.1h-5c0-.8-.3-1.6-1-2.1A6 6 0 0 1 12 3Z'),
  '🥩': food, '🍗': food, '🍔': food, '🍳': _EI('<circle cx="10" cy="12" r="7"/><path d="M17 12h5"/>'),
  '💾': _EP('M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8'),
  '🖼': _EI('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 15.5-4.5-4.5L7 20.5"/>'),
  '🙈': _EI('<path d="M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.3M6.6 6.6A16.8 16.8 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M2 2l20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  '📌': _EP('M12 17v5M7 10.5 5.5 12.3a.8.8 0 0 0 .6 1.4h11.8a.8.8 0 0 0 .6-1.4L17 10.5V5l1-2.2H6L7 5Z'),
  '🔍': _EI('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  '🚩': _EP('M4 22v-7M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z'),
  '📱': _EI('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>'),
  '🛠': tool, '🔧': tool,
  '🛒': _EI('<circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 4h2l2.4 11h10.2L20 8H6"/>'),
  '💬': _EP('M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z'),
  '🔄': _EP('M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5'),
  '🐞': _EI('<rect x="8" y="7" width="8" height="11" rx="4"/><path d="M8 10H4M20 10h-4M8 14H4.5M19.5 14H16M9 7 7 4.5M15 7l2-2.5M10 3.5h4"/>'),
  '🚫': _EI('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
  '🗂': folder, '📂': folder, '📁': folder,
  '🏷': _EI('<path d="M12.6 2.6 21.4 11.4a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
  '📬': inbox, '📥': inbox, '📩': inbox, '📣': mega, '📢': mega,
  '👥': _EI('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.7a3.5 3.5 0 0 1 0 6.6M17.5 14.3a6.5 6.5 0 0 1 4 5.7"/>'),
  '🏠': _EP('M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5'),
  '🏆': _EP('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3'),
  '🥇': medal, '🥈': medal, '🥉': medal,
  '📜': _EP('M8 21h11a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4M19 17V5a2 2 0 0 0-2-2H4'),
  '✍': _EP('M12 20h9M16.4 3.6a2 2 0 1 1 2.8 2.8L7 18.5l-4 1 1-4Z'),
  '👑': _EP('m3 8 4.5 3.5L12 5l4.5 6.5L21 8l-1.8 10H4.8ZM5 21h14'),
  '❓': help, '❔': help,
  '📊': _EP('M3 3v16a2 2 0 0 0 2 2h16M8 17v-6M13 17V7M18 17v-3'),
  '📈': _EP('m2 17 7-7 5 5 8-8M16 7h6v6'), '📉': _EP('m22 17-8.5-8.5-5 5L2 7M16 17h6v-6'),
  '🧮': _EI('<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8.5 6.5h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>'),
  '🔐': lock, '🔒': lock,
  '🔑': _EI('<circle cx="8" cy="15.5" r="4.5"/><path d="m11.5 12.5 9-9M16.5 7.5l3 3"/>'),
  '⚡': _EP('M13 2 4.5 13.5H11L10 22l8.5-11.5H13Z'),
  '🍟': util, '🥔': util, '🍴': util,
  '🎬': _EI('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  '🆚': '<b style="font-size:11.5px;letter-spacing:.5px">VS</b>', '🅰': '',
  '🏖': _EP('M12 3a9 9 0 0 0-9 9h18a9 9 0 0 0-9-9ZM12 12v7a2 2 0 0 0 4 0'),
  '🔖': _EP('M6 3h12v18l-6-4-6 4Z'),
  '🧾': _EP('M4 2.5h16V21l-2.7-1.5-2.6 1.5-2.7-1.5L9.4 21l-2.7-1.5L4 21ZM8 7.5h8M8 11.5h8'),
  '🎚': _EP('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4'),
  '☀': _EI('<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>'),
  '🌙': _EP('M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5Z'),
  '🛍': _EP('M6 7h12l1.5 13a1 1 0 0 1-1 1.5h-13a1 1 0 0 1-1-1.5ZM8.5 10V6.5a3.5 3.5 0 0 1 7 0V10'),
  '🔢': _EP('M9 3 7 21M17 3l-2 18M4 8.5h17M3 15.5h17'),
  '👁': _EI('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  '🪑': _EP('M6 19v2M18 19v2M6 11V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7M4 11h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z'),
  }
})()
const EMO_RE = new RegExp('(' + Object.keys(EMO_SVG).join('|') + ')️?', 'gu')
function emoFix(root){
  try {
    if (!root) return
    if (root.nodeType === 3) return emoFixT(root)
    if (root.nodeType !== 1 && root.nodeType !== 11) return
    const L = []
    ;(function walk(n){ n.childNodes && n.childNodes.forEach(c => { if (c.nodeType === 3) L.push(c); else if (c.nodeType === 1 && c.nodeName !== 'svg' && c.nodeName !== 'SVG') walk(c) }) })(root)
    L.forEach(emoFixT)
  } catch(e){}
}
function emoFixT(tn){
  const v = tn.nodeValue; if (!v) return
  EMO_RE.lastIndex = 0; if (!EMO_RE.test(v)) return
  const p = tn.parentNode; if (!p) return
  const tg = p.nodeName
  if (tg === 'SCRIPT' || tg === 'STYLE' || tg === 'TEXTAREA') return
  EMO_RE.lastIndex = 0
  if (tg === 'OPTION' || tg === 'TITLE') { tn.nodeValue = v.replace(EMO_RE, '').replace(/^ +| +$/g, ''); return } // SVG 塞不進去的位置：拿掉字
  const t = document.createElement('template')
  t.innerHTML = v.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]).replace(EMO_RE, (m, g) => EMO_SVG[g] !== undefined ? EMO_SVG[g] : m)
  p.replaceChild(t.content, tn)
}
const emoObs = new MutationObserver(rs => { rs.forEach(r => { if (r.type === 'characterData') emoFix(r.target); else if (r.addedNodes) r.addedNodes.forEach(n => { emoFix(n); if (n.nodeType === 1) { try { permScan(n) } catch(e){} } }) }) })
const emoBoot = () => { emoFix(document.body); emoObs.observe(document.body, { childList: true, subtree: true, characterData: true }) }
document.body ? emoBoot() : document.addEventListener('DOMContentLoaded', emoBoot)
if (SIM) {
  const _fetch0 = window.fetch.bind(window)
  let _simAlertTs = 0 // v4.54 防連環彈窗（張良：點任務連跳四次）：同一波寫入只提醒一次
  window.fetch = (u, o) => {
    const s = String(u)
    if (o && o.method && !/^get$/i.test(o.method)) {
      // v4.54 kvproxy 唯讀（op:get/getPrefix）＝讀共用資料，模擬照放行——否則任務/會議等靠 kvproxy 讀的頁面看不到資料
      let body = null; try { body = o.body ? JSON.parse(o.body) : null } catch (_) {}
      if (/kvproxy=/.test(s) && body && (body.op === 'get' || body.op === 'getPrefix')) return _fetch0(u, o)
      if (!s.includes('errlog=') && Date.now() - _simAlertTs > 2500) { _simAlertTs = Date.now(); alert(canTab(curTabKey()) ? '模擬確認結果：' + SIM.name + ' 在這一頁「有」編輯權限，本人可以正常送出（模擬中不會真的寫入）' : '模擬中不能改資料——按上方「結束模擬」回到自己再操作') } // 有權限→明講他本人送得出去
      return Promise.resolve(new Response(JSON.stringify({ ok:false, error:'模擬模式不能改資料' }), { headers: { 'content-type':'application/json' } }))
    }
    return _fetch0(s.includes('/api/mail-sync?') ? s + '&as=' + encodeURIComponent(SIM.rid) : u, o)
  }
  const _simBn = () => { const bn = document.createElement('div'); bn.id = 'simBn'
    bn.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999;background:#3A2F10;border-bottom:1px solid #D4A72C;color:#F2CE60;font-weight:800;font-size:14px;padding:8px 12px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap'
    bn.innerHTML = EYE_I + ' 模擬中：' + SIM.name + ' 看到的畫面（只能看、改不了資料）<button class="mini" style="padding:4px 14px" onclick="simEnd()">結束模擬</button>'
    document.body.appendChild(bn); document.body.style.paddingTop = '42px' }
  document.body ? _simBn() : document.addEventListener('DOMContentLoaded', _simBn)
}
function simStart(rid, name){ try { sessionStorage.setItem('gdSim', JSON.stringify({ rid, name })) } catch(e){}; simWipe(); location.reload() }
function simEnd(){ try { sessionStorage.removeItem('gdSim') } catch(e){}; simWipe(); location.reload() }
function simWipe(){ try { Object.keys(localStorage).filter(k2=>k2.startsWith('obc_')||k2.startsWith('obt_')).forEach(k2=>localStorage.removeItem(k2)) } catch(e){} } // 進出模擬都清畫面快取＝不殘留彼此的資料
// ── 編輯權限鎖門器（v4.34.0 張良「無法編輯的連打開都不能打開、按鈕直接鎖死跳窗，不要最後才不能送出」）──
// 原理：whoami 回我的（或模擬對象的）權限 → 會寫入的按鈕沒權限就變灰鎖死，一按跳窗「請向張良申請」；
// 跟伺服器 permWho 同一套邏輯＝畫面上鎖的跟實際擋的一定一致。模擬時看到的鎖＝那個人本人看到的鎖。
window._meW = (()=>{ try { return JSON.parse(localStorage.getItem('obt_mew')||'null') } catch(e){ return null } })()
function curTabKey(){ const c = curStore; if (c==='ground'||c==='abeach') return 'board'; if (c==='settings') return 'gear'; return c }
function canTab(k){
  const w = window._meW
  if (w === null || w === undefined) return true // 權限還沒載到→先不鎖（伺服器照樣守門）
  if (!w.bound) return false
  if (w.mode !== 'approve') return true // 全開模式：綁定即可編
  return !!(w.edit && (w.adminP || !w.tabs || w.tabs[k] !== 0))
}
// 會寫入的按鈕 → 所屬分頁權限（'*'=跟著目前頁面，給盤點/包材共用函式）；純看的（切頁/收合/篩選/看圖）不鎖
const EDIT_FN = {
  actSave:'board', actAdd:'board', actLoss:'board', act86:'board', rHide:'board', posHide:'board', rMng:'board', itmMngTog:'board',
  sopItemEdit:'sop', sopItemSave:'sop', sopEdAdd:'sop', sopEdSave:'sop', sopCatAdd:'sop', sopCatMng:'sop', sopCatSet:'sop', sopStAdd:'sop', sopStDel:'sop', sopStRen:'sop', sopStRename:'sop', sopStOp:'sop', sopstOp:'sop', catMove:'sop', msAddSt:'sop', msDelSt:'sop', msSave:'sop', sopOrdMove:'sop', sopRefOpen:'sop', sopRefPaste:'sop', sopRefSave:'sop', sopRefUp:'sop', sopMngT:'sop', sopStrictOn:'sop', sopSummarySend:'sop',
  taskNew:'task', taskNewSend:'task', taskOwn:'task', taskOwnSend:'task', ckAdd:'task', ckOp:'task', ckPick:'task', ckSend:'task', lbOp:'task', lbDue:'task',
  lbPtsSave:'lb', lbPtsAdd:'lb', lbPtsAdjust:'lb', lbRdDecide:'lb', lbGrant:'lb', lbGrantGo:'lb', lbRwMng:'lb', lbRwSave:'lb', lbRwDel:'lb', lbRwAdd:'lb',
  menuCell:'menu', menuItemAdd:'menu', menuItemDel:'menu', menuItemSave:'menu', menuItemPurge:'menu', menuItemRestore:'menu', menuItemShift:'menu', menuSecDel:'menu', menuSecForm:'menu', menuSecShift:'menu', menuNoteEdit:'menu', mnImgPick:'menu', mnImgUndo:'menu', mnDragStart:'menu', menuSecCombo:'menu', menuItemCombo:'menu',
  fbSubmit:'fb', fbjNew:'fb', fbjSend:'fb', fbjDel:'fb', fbAssignNew:'fb', fbAssignGo:'fb', fbAssignDel:'fb', fbDimsEdit:'fb', fbDimsSave:'fb',
  meetForm:'meet', meetSave:'meet', meetOp:'meet', meetTypes:'meet', mtUpload:'meet',
  cellClick:'shift', dayClick:'shift', shiftForm:'shift', shiftSave:'shift', shiftDelFast:'shift', shiftPosEdit:'shift', posSave:'shift', shLeaveMenu:'shift', shLeaveSet:'shift', clearDay:'shift', clearWeek:'shift', copyDay:'shift', copyCell:'shift', copyWeekNext:'shift', undoClear:'shift', undoLastCopy:'shift', pasteOff:'shift', t24set:'shift', qkTrChange:'shift', shiftQuickGo:'shift', tplSave:'shift', tplApply:'shift', tplDel:'shift', shiftSkill:'shift', gdRoleModal:'shift', gdRoleSave:'shift', gdStaffAdd:'shift', gdStaffGo:'shift', gdStaffOp:'shift', odMove:'shift', odOff:'shift',
  lbNew:'shift', lbDel:'shift', lbRen:'shift', lbCopy:'shift', lbSnap:'shift', lbSwitch:'shift', lbUndo:'shift', lbVDel:'shift', lbVRen:'shift', lbVRestore:'shift', lbClearAll:'shift', lbRowClear:'shift', lbColClear:'shift', lbWageMenu:'shift', lbFinSet:'shift', lbAmtPick:'shift',
  invCount:'*', invEdit:'*', invSave:'*', invDel:'*',
  buyNew:'buy', buySend:'buy', buyOp:'buy', buyRecv:'buy', recvPick:'buy', recvSend:'buy', buyCat:'buy', buyPick:'buy',
}
function permFnTab(el){
  const src = (el.getAttribute('onclick') || '') + ';' + (el.getAttribute('onchange') || '')
  for (const m of src.matchAll(/([A-Za-z_]\w*)\s*\(/g)) { const t = EDIT_FN[m[1]]; if (t) return t === '*' ? curTabKey() : t }
  return null
}
function permScan(root){ // 每次重畫：沒權限的寫入鈕上鎖變灰（還是可以點＝點了跳說明窗）
  try {
    if (!root || !root.querySelectorAll) return
    // v4.40.7（張良「不能編輯沒錯，但班表整個看不見了」）：變灰只套「按鈕/輸入框」；
    // 資料格（班表格子這種本身就是內容的）保持原樣清楚可讀——點下去一樣擋＋跳窗，但不弄暗
    const dimOk = el => /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || (el.classList && el.classList.contains('mini'))
    const els = root.querySelectorAll('[onclick],[onchange]')
    els.forEach(el => {
      const k = permFnTab(el); if (!k) return
      const lock = !canTab(k)
      el.classList.toggle('plk', lock && dimOk(el))
      if (lock && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.getAttribute('onchange')) el.disabled = true
    })
    if (root !== document.body && root.matches && root.matches('[onclick],[onchange]')) { const k2 = permFnTab(root); if (k2) root.classList.toggle('plk', !canTab(k2) && dimOk(root)) }
  } catch(e){}
}
function permPop(k){ // 鎖死按鈕被點到＝跳窗講清楚（模擬時=講「這個人」的狀態）
  const old = document.getElementById('ppOv'); if (old) old.remove()
  const names = { board:'首頁', gear:'設定', errs:'問題回報', inc:'異常通知' }
  const lbl = stripEmoji((window._tabCfg && window._tabCfg.names && window._tabCfg.names[k]) || TAB_DEF[k] || names[k] || k)
  const w = window._meW || {}
  const msg = (typeof SIM !== 'undefined' && SIM)
    ? SIM.name + ' 沒有「' + lbl + '」的編輯權限——他本人按這顆按鈕也會看到這個視窗'
    : (w.bound ? '你目前沒有「' + lbl + '」的編輯權限' : '還沒登入——請點 DD 給你的個人連結進來（找不到連結→私訊 DD「我的連結」補發）')
  const ov = document.createElement('div'); ov.id = 'ppOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,20,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px'
  ov.innerHTML = '<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:340px;width:100%;padding:18px" onclick="event.stopPropagation()">'
    + '<div style="font-weight:900;font-size:16px;display:flex;gap:8px;align-items:center">' + (EMO_SVG['🔒'] || '') + ' 無法編輯</div>'
    + '<div style="margin-top:8px;font-size:14.5px;line-height:1.6">' + msg + '</div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">'
    + ((w.bound && !(typeof SIM !== 'undefined' && SIM)) ? '<button class="mini on" style="padding:9px 14px" onclick="document.getElementById(\'ppOv\').remove();prepApply()">向張良申請編輯權限</button>' : '')
    + '<button class="mini" style="padding:9px 14px" onclick="document.getElementById(\'ppOv\').remove()">知道了</button>'
    + '</div></div>'
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
// 全站攔截：鎖住的動作在「進到功能之前」就擋下（capture 階段＝比按鈕自己的 onclick 先跑）
document.addEventListener('click', e => {
  try {
    const el = e.target && e.target.closest ? e.target.closest('[onclick]') : null
    if (!el) return
    const k = permFnTab(el); if (!k || canTab(k)) return
    e.preventDefault(); e.stopPropagation()
    permPop(k)
  } catch(err){}
}, true)
document.addEventListener('change', e => {
  try {
    const el = e.target && e.target.closest ? e.target.closest('[onchange]') : null
    if (!el) return
    const k = permFnTab(el); if (!k || canTab(k)) return
    e.stopPropagation()
    permPop(k)
  } catch(err){}
}, true)
// 右上固定綁定入口（張良 2026-09-24：DD 訊息叫人按「輸入綁定碼」但按鈕藏在提示字裡找不到——未綁定時固定顯示在右上）
function bindBtnSync(){ const b = document.getElementById('bindBtn'); if (b) b.style.display = TK() ? 'none' : '' }

let sopData = null, sopPhotos = {}, sopEditSt = null
let sopPin = new Set(JSON.parse(localStorage.getItem('sopPin')||'[]')) // 📌 釘選的站（存本機＝每個人自己的）
let sopColl = new Set(JSON.parse(localStorage.getItem('sopColl')||'[]')) // ⏷ 收合的站（張良 2026-09-24：可全部收合打開；存本機）
// ── v4.15.0 SOP 分層＋負責人＋建議審核 ──
async function sopstOp(body){
  const r = await fetch('/api/mail-sync?sopst=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...body, token: TK() }) })
  const j = await r.json().catch(()=>null)
  if (j && j.ok) { await sopLoad() } else alert((j&&j.error)||'失敗')
}
function sopOrdMove(kind, name, dir){ // ◀▶ 排序（v4.18.1 張良「讓我可以排序」）
  const arr = kind==='cat' ? [...(sopData.def.cats||[])] : [...(sopData.def.stations||[])]
  const i = arr.indexOf(name), j = i + dir
  if (i < 0 || j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  sopstOp(kind==='cat' ? { op:'catord', list: arr } : { op:'stord', list: arr })
}
function sopMngT(){ window._sopMng = !window._sopMng; sopRender() } // ⚙️ 設定模式（張良 2026-10-02：平常乾淨,按了才出現編輯的東西）
// v4.64.0 V3：原地編輯——點鉛筆在動作卡原位展開編輯表單（不彈窗/不側欄）
function sopItemEdit(id, newSt){
  if (id) { window._sopEdit = id; sopOpenSet.delete(id); const it = (sopData.def.items||[]).find(x=>x.id===id); window._sieSubs = it ? JSON.parse(JSON.stringify(it.subs||[])) : []; window._siePrereq = it ? [...(it.prereq||[])] : [] }
  else { window._sopEdit = '__new__:' + (newSt || window._sopLastSt || ''); if (newSt) window._sopLastSt = newSt; window._sieSubs = []; window._siePrereq = [] }
  sopRender()
  setTimeout(()=>renderSieSubs(), 0)
}
function sieToggleP(id,on){ window._siePrereq = window._siePrereq||[]; if(on){ if(!window._siePrereq.includes(id)) window._siePrereq.push(id) } else window._siePrereq = window._siePrereq.filter(x=>x!==id) }
function sopEditCancel(){ window._sopEdit = null; window._sieSubs = null; window._siePrereq = null; sopRender() }
function sopEditForm(it, isNew){
  const stsE = [...(sopData.def.stations||[])]
  const stDispE = s9 => String(s9).includes('｜') ? String(s9).split('｜').pop() : s9
  const ip9 = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:15px;margin-bottom:8px;background:var(--bg)'
  const selS = 'border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px;background:var(--bg)'
  return `<div style="margin:8px 0 2px;padding:12px;background:#223141;border:1px solid var(--primary);border-radius:10px">
    <div style="font-weight:900;margin-bottom:8px;color:var(--pdark)">✎ 編輯流程範本｜下個營業日生效</div>
    <input id="sieT" value="${sopEsc(it.title)}" placeholder="動作名稱（例：POS 開機・零用金點收）" style="${ip9}">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap"><span class="hint">可完成時間</span><input id="sieS1" type="time" value="${it.start||''}" style="${selS}"><span class="hint">到</span><input id="sieE1" type="time" value="${it.end||it.due||''}" style="${selS}"></div>
    <div class="hint" style="margin:0 0 8px">過了「結束時間」就鎖死不能補打（只能回報異常）。開始留空＝待設定。</div>
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:8px"><label style="font-size:14px"><input id="sieReq" type="checkbox" ${it.req!==false?'checked':''}> 必做</label><label style="font-size:14px"><input id="sieP" type="checkbox" ${it.photo?'checked':''}> 📷 完成要拍照</label></div>
    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap"><span class="hint">階段</span><select id="sieG" style="flex:1;min-width:120px;${selS}"><option value="">未分階段</option>${(sopData.def.cats||[]).map(c9=>`<option value="${sopEsc(c9)}"${it.tg===c9?' selected':''}>${sopEsc(c9)}</option>`).join('')}</select><span class="hint">工作站</span><select id="sieS" style="flex:1;min-width:120px;${selS}">${stsE.map(s9=>`<option value="${sopEsc(s9)}"${it.st===s9?' selected':''}>${sopEsc(stDispE(s9))}</option>`).join('')}</select></div>
    <textarea id="sieDesc" rows="2" placeholder="執行說明（選填）" style="${ip9};font-family:inherit">${sopEsc(it.desc||'')}</textarea>
    <div style="font-weight:800;font-size:13px;margin:2px 0 4px">子項目（選填，只一層）</div>
    <div id="sieSubs"></div>
    <button class="mini" style="padding:6px 12px;margin-top:4px" onclick="sieSubAdd()">＋ 加子項目</button>
    <div style="font-weight:800;font-size:13px;margin:10px 0 4px">前置動作（要先完成才能做這條・選填）</div>
    <div style="max-height:130px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--bg)">${(sopData.def.items||[]).filter(x=>x.st===it.st && x.id!==it.id).map(o=>`<label style="display:block;font-size:13px;padding:2px 0"><input type="checkbox" ${(window._siePrereq||[]).includes(o.id)?'checked':''} onchange="sieToggleP('${o.id}',this.checked)"> ${sopEsc(o.title)}</label>`).join('')||'<span class="hint">這個工作站沒有其他動作可當前置</span>'}</div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
      ${!isNew?`<button class="mini" style="color:var(--red);padding:9px 12px" onclick="if(confirm('刪除這個動作？'))sopItemSave('${it.id}',1)">🗑 刪除</button>`:'<span></span>'}
      <span style="display:flex;gap:8px"><button class="mini" style="padding:9px 12px" onclick="sopEditCancel()">取消</button>
      <button class="mini on" style="padding:9px 16px" onclick="sopItemSave(${isNew?'null':`'${it.id}'`})">✓ 完成編輯</button></span></div>
  </div>`
}
function renderSieSubs(){
  const box = document.getElementById('sieSubs'); if (!box) return
  box.innerHTML = (window._sieSubs||[]).map((su,i)=>`<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
    <input value="${sopEsc(su.title||'')}" oninput="window._sieSubs[${i}].title=this.value" placeholder="子項目名稱" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:6px;padding:6px;font-size:14px">
    <label style="font-size:12px;white-space:nowrap"><input type="checkbox" ${su.req!==false?'checked':''} onchange="window._sieSubs[${i}].req=this.checked">必做</label>
    <label style="font-size:12px;white-space:nowrap"><input type="checkbox" ${su.photo?'checked':''} onchange="window._sieSubs[${i}].photo=this.checked">📷</label>
    <button class="mini" style="padding:4px 8px;color:var(--red)" onclick="window._sieSubs.splice(${i},1);renderSieSubs()">✕</button>
  </div>`).join('') || '<div class="hint">還沒有子項目</div>'
}
function sieSubAdd(){ window._sieSubs = window._sieSubs||[]; window._sieSubs.push({ title:'', req:true, photo:false }); renderSieSubs() }
async function sopItemSave(id, del){
  if (!TK()) { alert('要先綁定才能編輯：跟 DD 說「綁定GD」'); return }
  let body
  if (del) {
    const it0 = (sopData.def.items||[]).find(x=>x.id===id)
    body = { del:true, item:{ id, st: it0?it0.st:'' }, token: TK() }
  } else {
    const t9 = ((document.getElementById('sieT')||{}).value||'').trim()
    if (!t9) { alert('動作名稱不能空'); return }
    const item = {
      id: id||undefined,
      st: (document.getElementById('sieS')||{}).value||'',
      tg: (document.getElementById('sieG')||{}).value||'',
      title: t9,
      start: (document.getElementById('sieS1')||{}).value||'',
      end: (document.getElementById('sieE1')||{}).value||'',
      req: !!((document.getElementById('sieReq')||{}).checked),
      photo: !!((document.getElementById('sieP')||{}).checked),
      desc: ((document.getElementById('sieDesc')||{}).value||'').trim(),
      subs: (window._sieSubs||[]).filter(s=>s&&String(s.title||'').trim()),
      prereq: window._siePrereq||[]
    }
    body = { item, token: TK() }
  }
  const r = await fetch('/api/mail-sync?sopact=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) })
  const j = await r.json().catch(()=>null)
  if (j && j.ok) { window._sopEdit = null; window._sieSubs = null; sopLoad() } else alert((j&&j.error)||'儲存失敗')
}
function sopCatAdd(){ prepAsk('＋ 新增階段',0,1,(q,r)=>{ if (r) sopstOp({op:'catadd',cat:r}).then(()=>{ window._sopTg=r; sopRender() }) },'階段名（例：開班／備料／出餐／收班）') }
function sopStAdd(){ // ＋ 產品（hashtag 模型：產品是全域的，不綁階段）
  prepAsk('＋ 新增產品站',0,1,(q,r)=>{
    r = String(r||'').trim()
    if (!r) return
    if ((sopData.def.stations||[]).includes(r)) { alert(`已經有「${r}」了`); return }
    sopstOp({ op:'add', st: r })
  },'產品名（例：漢堡／披薩／飲料）')
}
function sopStRen(st){
  const pre = String(st).includes('｜') ? String(st).split('｜')[0]+'｜' : ''
  prepAsk(`✏️ 改站名「${st.includes('｜')?st.split('｜').pop():st}」`,0,1,(q,r)=>{ if (r) sopstOp({op:'rename',st,newName:pre+r}) },'新站名')
}
function sopCatMng(){ // 🗂 分類管理：分類增刪改排序＋每站歸類＋負責人
  const def = sopData.def, cats = def.cats||[], sts9 = [...(def.stations||[])]
  const mgr = sopData.me && (sopData.me.approver || sopData.me.role==='主管')
  const catsJ = JSON.stringify(cats).replace(/"/g,'&quot;')
  const ov = document.createElement('div'); ov.id='scOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  // v4.58.3（張良「第二層階段可以拖曳排序」）：↑↓ 箭頭改 ☰ 拖曳，跟第一層站別總編輯一致
  const catRow = c2=>`<div data-c="${String(c2).replace(/"/g,'&quot;')}" style="display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)">
    <span class="catH" style="cursor:grab;touch-action:none;color:var(--muted);font-size:16px">☰</span><b style="flex:1">${c2}</b>
    <button class="mini" style="padding:6px 9px" onclick="document.getElementById('scOv').remove();prepAsk('改名「${c2}」',0,1,(q,r)=>{if(r)sopstOp({op:'catren',cat:'${c2}',newName:r})},'新名稱')">✏️</button>
    <button class="mini" style="padding:6px 9px;color:var(--red)" onclick="if(confirm('刪除分類「${c2}」？站會變未分類，不會刪站')){document.getElementById('scOv').remove();sopstOp({op:'catdel',cat:'${c2}'})}">✕</button></div>`
  // v4.58.3 站別也加 ☰ 拖曳排序（張良「第一層工作站可拖曳排序」）：只改順序，不碰條目內容
  const stRow = st2 => `<div data-st="${String(st2).replace(/"/g,'&quot;')}" style="display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)">
    <span class="stH" style="cursor:grab;touch-action:none;color:var(--muted);font-size:15px">☰</span><b style="flex:1;min-width:0">${st2}</b>
    <select onchange="sopstOp({op:'catset',st:'${st2}',cat:this.value})" style="border:1px solid var(--line);border-radius:7px;padding:6px;font-size:13px;max-width:110px"><option value="">未分類</option>${cats.map(c2=>`<option${(def.stCat||{})[st2]===c2?' selected':''}>${c2}</option>`).join('')}</select>
    <select ${mgr?'':'disabled title="負責人由審核人/主管指定"'} onchange="sopstOp({op:'ownset',st:'${st2}',owner:this.value})" style="border:1px solid var(--line);border-radius:7px;padding:6px;font-size:13px;max-width:110px"><option value="">無負責人</option>${(sopData.names||[]).map(n=>`<option${(def.stOwner||{})[st2]===n?' selected':''}>${n}</option>`).join('')}</select></div>`
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(560px,94vw);max-height:88vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:16px">🗂 SOP 分類（組織架構）</b><button class="mini" style="padding:7px 12px" onclick="document.getElementById('scOv').remove()">關閉</button></div>
    <div class="hint" style="margin-bottom:8px">三層：分類 → 站 → 條目。右邊兩個選單＝每站「歸哪類」「誰負責」（有負責人的站，別人要改得走 💡 提建議）。</div>
    <div style="font-weight:900;margin:6px 0 2px">分類（階段）<span class="hint" style="font-weight:600">拖 ☰ 排順序</span></div><div id="scCatList">${cats.map(catRow).join('')||'<div class="hint">還沒有分類——按下面新增（例：開班／收班／備料／清潔）</div>'}</div>
    <button class="mini" style="margin:8px 0;padding:8px 12px" onclick="document.getElementById('scOv').remove();prepAsk('＋ 新增分類',0,1,(q,r)=>{if(r)sopstOp({op:'catadd',cat:r})},'分類名稱（例：備料/設站/清潔）')">＋ 新增分類</button>
    <div style="font-weight:900;margin:10px 0 2px">站（工作站）<span class="hint" style="font-weight:600">拖 ☰ 排順序・右邊設歸類與負責人</span></div><div id="scStList">${sts9.map(stRow).join('')}</div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
  // v4.58.3 兩層拖曳排序（張良）：拖完直接存 catord/stord；sopstOp 會 sopLoad 更新資料但不關這個 overlay，可連續拖。只改順序不碰條目內容（tg/標準照都保住）
  if (window.Sortable) {
    const cl = document.getElementById('scCatList'); if (cl) new Sortable(cl, { handle:'.catH', animation:150, onEnd: () => { const list = [...cl.querySelectorAll('[data-c]')].map(e=>e.dataset.c); if (list.length) sopstOp({ op:'catord', list }) } })
    const sl = document.getElementById('scStList'); if (sl) new Sortable(sl, { handle:'.stH', animation:150, onEnd: () => { const list = [...sl.querySelectorAll('[data-st]')].map(e=>e.dataset.st); if (list.length) sopstOp({ op:'stord', list }) } })
  }
}
function catMove(i, dir, arr){ const a = [...arr]; const j = i + dir; if (j<0||j>=a.length) return; [a[i],a[j]]=[a[j],a[i]]; const o=document.getElementById('scOv'); if(o)o.remove(); sopstOp({ op:'catord', list:a }) }
function sugAdd(st){
  prepAsk(`💡 對「${st}」SOP 提建議`, 0, 1, (q, r)=>{
    if (!r) { alert('要寫建議內容'); return }
    fetch('/api/mail-sync?sopsugset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'add', st, text: r, token: TK() }) }).then(r2=>r2.json()).then(j=>{ if (j&&j.ok) { alert('已送出給負責人審核——通過會記你一分'); sopLoad() } else alert((j&&j.error)||'失敗') })
  }, '想怎麼改？寫具體一點')
}
async function sugView(st){
  let j = null
  try { const r = await fetch('/api/mail-sync?sopsug=' + encodeURIComponent(K) + '&st=' + encodeURIComponent(st) + '&r=' + Date.now()); j = await r.json() } catch(e){}
  if (!j || !j.ok) { alert('讀不到'); return }
  const me9 = sopData.me, ow9 = (sopData.def.stOwner||{})[st]
  const canDec = me9 && (me9.name===ow9 || me9.approver || me9.role==='主管')
  const open = (j.list||[]).filter(x=>x.status==='open')
  const arch = (j.list||[]).filter(x=>x.status!=='open')
  const old = document.getElementById('sgOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id='sgOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(560px,94vw);max-height:88vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:16px">💡「${st}」SOP 建議</b><span><button class="mini" style="padding:7px 10px" onclick="document.getElementById('sgOv').remove();sugAdd('${st}')">＋ 我也要提</button><button class="mini" style="padding:7px 12px" onclick="document.getElementById('sgOv').remove()">關閉</button></span></div>
    <div style="font-weight:900;margin:6px 0 4px">待審核（${open.length}）</div>
    ${open.map(x=>`<div style="background:var(--soft);border:1px solid #E8D089;border-radius:10px;padding:8px 10px;margin-bottom:6px"><div>${x.text}</div><div class="hint">${x.by}・${x.ts}</div>${canDec?`<div style="margin-top:5px"><button class="mini on" style="padding:6px 12px" onclick="sugDecide('${x.id}',1,'${st}','')">✅ 通過（他加1分）</button><button class="mini" style="padding:6px 12px;color:var(--red)" onclick="document.getElementById('sgOv').remove();prepAsk('駁回原因（會歸檔，不能吃案）',0,1,(q2,r2)=>{if(!r2){alert('一定要寫原因');return}sugDecide('${x.id}',0,'${st}',r2)},'為什麼不採納')">❌ 駁回</button></div>`:''}</div>`).join('')||'<div class="mut">沒有待審的建議</div>'}
    <div style="font-weight:900;margin:12px 0 4px">歸檔（${arch.length}）<span class="hint" style="font-weight:600">全部留存、人人可查——不會吃案</span></div>
    ${arch.map(x=>`<div style="background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:7px 10px;margin-bottom:5px"><div>${x.status==='ok'?'✅':'📁'} ${x.text}</div><div class="hint">${x.by}・${x.ts} → ${x.status==='ok'?`通過（${x.decBy}・${x.decTs}）＋1分`:`未採納（${x.decBy}・${x.decTs}）：${x.note||''}`}</div></div>`).join('')||'<div class="mut">還沒有歸檔紀錄</div>'}</div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function sugDecide(id, pass, st, note){
  fetch('/api/mail-sync?sopsugset=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ op:'decide', id, pass: !!pass, note: note||'', token: TK() }) }).then(r=>r.json()).then(j=>{ if (j&&j.ok) { sopLoad(); sugView(st) } else alert((j&&j.error)||'失敗') })
}
function sopCollT(st){ if (sopColl.has(st)) sopColl.delete(st); else sopColl.add(st); localStorage.setItem('sopColl', JSON.stringify([...sopColl])); sopRender() }
function sopCollAll(sts2){ const allC = sts2.every(s2=>sopColl.has(s2)); if (allC) sts2.forEach(s2=>sopColl.delete(s2)); else sts2.forEach(s2=>sopColl.add(s2)); localStorage.setItem('sopColl', JSON.stringify([...sopColl])); sopRender() }
let sopFilter = localStorage.getItem('sopFilter') || ''
function sopCatSet(c){ window._sopTg = c; sopFilter = 'all'; sopRender() } // #階段切換（v4.18.0）
function sopFset(v){ sopFilter = v; localStorage.setItem('sopFilter', v); sopRender() }
function sopPinT(st){ if (sopPin.has(st)) sopPin.delete(st); else sopPin.add(st); localStorage.setItem('sopPin', JSON.stringify([...sopPin])); if (!sopPin.size && sopFilter==='pin') sopFset('all'); else sopRender() } // itemId -> dataURL（待送出的照片）；編輯中的站
async function sopLoad(){
  const el = document.getElementById('sop'); if (!el) return
  // v4.31.9（張良「其他頁都順了 剩SOP明顯不順」）：全站只剩這頁沒走「快取先畫+背景更新」＝每次傻等網路白畫面。
  // 快取只認「今天的」（SOP勾勾是按天記的，昨天的勾勾閃出來會誤導）；背景照樣抓最新回來重畫
  const c9 = (sopData && sopData.ok) ? sopData : tcGet('sop')
  if (c9 && c9.ok && c9.date === todayTpe()) { sopData = c9; sopRender() }
  let d9 = null
  try { const r = await fetch('/api/mail-sync?sop=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '')); d9 = await r.json() } catch(e){}
  if (d9 && d9.ok) { sopData = d9; tcSet('sop', d9) }
  if (!sopData || !sopData.ok) { el.innerHTML = ''; return }
  sopRender()
}
// ── v4.59.0 工作流程SOP改版（照 GROUND_SOP_CC_spec.md 第1期）：四層(站→階段→動作→子項目)+時間區間鎖+五狀態+展開面板 ──
const sopEsc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
let sopOpenSet = new Set()                 // 展開的動作(itemId)；記憶體即可
window._sopSub = window._sopSub || 'today' // 子頁：today / tmpl / hist
const sopNow = () => new Date(Date.now() + 8*3600e3).toISOString().slice(11,16)
// v4.63.0 V3：正式執行永遠驗證時間（移除嚴格開關）。台北 HH:MM 字串比較；wd=週幾(0日6六公休不鎖)
// v4.66.0 加前置條件：時間內但前置動作未完成＝等待前置（waiting）
const sopPrereqUnmet = (it, log) => it.prereq && it.prereq.length && it.prereq.some(pid => !(log && log[pid] && log[pid].done))
function sopState(it, lg, now, wd, log){
  if (lg && lg.done) return 'done'
  if (!it.start && !it.end) return sopPrereqUnmet(it, log) ? 'waiting' : 'open' // 無時段限制：看前置
  if (!it.start) return 'pending_cfg'                 // 有end沒start＝待設定（管理者去補開始時間）
  const weekend = (wd===0 || wd===6)
  if (weekend) return 'open'                          // 公休預覽不鎖
  // v4.70.0 張良「提早也能做」：移除「尚未開放」鎖，提早(now<start)也可執行；只有逾時(過end)才鎖
  if (it.end && now >= it.end) return 'overdue'       // 逾時＝鎖（只能回報異常）
  if (sopPrereqUnmet(it, log)) return 'waiting'       // 前置未完成＝等待前置
  return 'open'                                       // 可執行（含提早）
}
const SOP_BADGE = {
  done:       { label:'已完成',   c:'#0E1217', bg:'var(--green)' },
  open:       { label:'可執行',   c:'#fff',    bg:'var(--primary)' },
  locked:     { label:'尚未開放', c:'var(--muted)', bg:'var(--soft)' },
  overdue:    { label:'逾時未完成', c:'#fff',  bg:'#C2410C' },
  pending_cfg:{ label:'待設定時間', c:'#1B1300', bg:'#D4A72C' },
  waiting:    { label:'等待前置', c:'var(--muted)', bg:'var(--soft)' },
}
const sopBadge = st => SOP_BADGE[st] || SOP_BADGE.open
const sopBadgeHtml = st => { const b = sopBadge(st); return `<span style="flex:0 0 auto;background:${b.bg};color:${b.c};border-radius:999px;padding:3px 10px;font-size:12px;font-weight:800;white-space:nowrap">${b.label}</span>` }
// v4.61.2（張良「可執行是文字不是按鈕」）：非完成狀態用「外框」徽章＝不像按鈕；可執行狀態直接給「完成」鈕可按
const OUTLINE_C = { locked:'var(--muted)', overdue:'#E8853D', pending_cfg:'#D4A72C', waiting:'var(--muted)', done:'var(--green)', open:'var(--primary)' }
const sopBadgeOutline = st => { const c = OUTLINE_C[st] || 'var(--muted)'; return `<span style="flex:0 0 auto;border:1px solid ${c};color:${c};border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;white-space:nowrap">${sopBadge(st).label}</span>` }
function sopDoOrExpand(id){ const it = (sopData.def.items||[]).find(x=>x.id===id); if (!it) return; if (it.photo || (it.subs && it.subs.length)) { sopOpenSet.add(id); sopRender() } else sopDo(id) } // 要拍照/有子項→展開操作；否則直接完成
const sopFmtRange = it => { const a=it.start||'', b=it.end||it.due||''; return a&&b?`${a}–${b}`:(b?`${b} 前`:(a?`${a} 起`:'未設時間')) }
function sopActToggle(id){ if (sopOpenSet.has(id)) sopOpenSet.delete(id); else sopOpenSet.add(id); sopRender() }
function sopSubTab(v){ window._sopSub = v; sopRender() }
function sopPendingT(){ window._sopPending = !window._sopPending; sopRender() } // V3 只看待完成＝隱藏已完成
// V3 交接待辦（第9節）：新增事項、接收人簽收、刪除
async function sopHoPost(body){ const r=await fetch('/api/mail-sync?sopho='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,token:TK()})}); const d=await r.json().catch(()=>null); if(d&&d.ok){sopData.handover=d.handover;sopRender()}else alert((d&&d.error)||'失敗') }
function sopHoAdd(){ if(!TK()){alert('請先登入：按右上「登入」→ 私訊 DD「登入碼」');return} prepAsk('＋ 新增交接事項',0,1,(q,r)=>{ if(r&&r.trim())sopHoPost({op:'add',text:r.trim()}) },'要交接什麼？（例：剩餘飲料交櫃檯、未完成備料3盤）') }
function sopHoAck(id){ if(!TK()){alert('請先登入');return} sopHoPost({op:'ack',id}) }
function sopHoDel(id){ if(confirm('刪除這筆交接？'))sopHoPost({op:'del',id}) }
// 展開面板：說明＋標準照＋子項目＋今日檢核照＋拍照並完成（照設計圖）
function sopActPanel(it, lg, state){
  const refs = (it.refs && it.refs.length) ? it.refs : (it.ref ? [it.ref] : [])
  const subs = it.subs || []
  const canDo = (state==='open' || state==='pending_cfg')
  let h = `<div style="margin:6px 0 2px;padding:10px 12px;background:var(--soft);border:1px solid var(--line);border-radius:10px">`
  if (it.desc) h += `<div style="font-size:14px;line-height:1.6;white-space:pre-wrap;margin-bottom:8px">${sopEsc(it.desc)}</div>`
  const canEditRef = sopData.me && sopData.me.canEdit
  if (refs.length || canEditRef) {
    h += `<div class="hint" style="margin-bottom:4px;display:flex;align-items:center;gap:8px">標準照片${canEditRef?`<button class="mini" style="padding:3px 10px" onclick="sopRefOpen('${it.id}')">🖼 ${refs.length?'更換':'設定'}</button>`:''}</div>`
    if (refs.length) h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${refs.map(u=>`<img src="${sopEsc(u)}" onclick="window.open('${sopEsc(u)}','_blank')" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer">`).join('')}</div>`
  }
  if (subs.length) {
    h += `<div class="hint" style="margin-bottom:3px">子項目</div>`
    h += subs.map(su => {
      const sl = lg && lg.subs && lg.subs[su.id]; const sd = sl && sl.done
      const pk = it.id+':'+su.id, needP = su.photo && !sopPhotos[pk]
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px dashed var(--line)">
        <span style="font-size:15px;color:${sd?'var(--green)':'var(--muted)'}">${sd?'✓':'○'}</span>
        <span style="flex:1;min-width:0">${sopEsc(su.title)}${su.req===false?' <span class="hint">選做</span>':''}</span>
        ${sd ? `<span class="hint">${sopEsc(sl.by||'')} ${sl.ts||''}</span>${sl.photo?`<img src="${sl.photo}" style="width:30px;height:30px;object-fit:cover;border-radius:5px;cursor:pointer" onclick="window.open('${sl.photo}','_blank')">`:''}<button class="mini" style="padding:4px 8px" onclick="sopSubDo('${it.id}','${su.id}',1)">撤</button>`
             : (canDo ? `${su.photo?`<button class="mini" style="padding:5px 8px" onclick="sopPick('${it.id}','${su.id}')">📷</button>`:''}${sopPhotos[pk]?`<img src="${sopPhotos[pk]}" style="width:30px;height:30px;object-fit:cover;border-radius:5px">`:''}<button class="mini ${needP?'':'on'}" style="padding:5px 10px" onclick="sopSubDo('${it.id}','${su.id}')">完成</button>`
                      : `<span class="hint">—</span>`)}
      </div>`
    }).join('')
  }
  if (lg && lg.done) {
    h += `<div style="display:flex;align-items:center;gap:10px;margin-top:8px"><span style="color:var(--green);font-weight:900">✓ 已完成 ${lg.ts} ${sopEsc(lg.by||'')}</span>${lg.photo?`<img src="${lg.photo}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:1.5px solid var(--green);cursor:pointer" onclick="sopView('${it.id}')">`:''}<button class="mini" style="margin-left:auto;padding:5px 10px" onclick="sopDo('${it.id}',1)">撤銷</button></div>`
  } else if (canDo) {
    const needP = it.photo && !sopPhotos[it.id]
    const reqSubMiss = subs.filter(su=>su.req!==false).some(su=>!(lg&&lg.subs&&lg.subs[su.id]&&lg.subs[su.id].done))
    h += `<div style="display:flex;align-items:center;gap:8px;margin-top:8px">
      ${it.photo?(sopPhotos[it.id]?`<img src="${sopPhotos[it.id]}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:2px solid var(--green);cursor:pointer" onclick="sopPick('${it.id}')">`:`<button class="mini" style="padding:8px 12px;font-size:15px" onclick="sopPick('${it.id}')">📷 拍照</button>`):''}
      <button class="mini ${(needP||reqSubMiss)?'':'on'}" style="margin-left:auto;padding:9px 18px" onclick="sopDo('${it.id}')" ${reqSubMiss?'title="先完成必做子項目"':(needP?'title="要先拍照"':'')}>${it.photo?'拍照並完成':'完成'}</button></div>`
    if (reqSubMiss) h += `<div class="hint" style="text-align:right;margin-top:3px;color:#D4A72C">先完成上面的必做子項目</div>`
  } else if (state==='waiting') {
    const pend = (it.prereq||[]).map(pid=>{ const p=(sopData.def.items||[]).find(x=>x.id===pid); return p?p.title:'' }).filter(Boolean)
    h += `<div class="hint" style="margin-top:6px;color:#D4A72C">⏳ 等待前置完成：${pend.map(t=>sopEsc(t)).join('、')||'前置動作'}</div>`
  } else {
    h += state==='locked'
      ? `<div class="hint" style="margin-top:6px">⏳ 尚未開放——${it.start} 才能開始</div>`
      : `<div style="margin-top:6px;display:flex;align-items:center;gap:8px"><span class="hint" style="color:#C2410C">⛔ 已逾時（${it.end} 截止），不能補打成完成</span><button class="mini" style="margin-left:auto;padding:7px 12px;color:#A85C26" onclick="sopReport('${sopEsc(it.st)}')">⚠️ 回報異常</button></div>`
  }
  h += `<div class="hint" style="margin-top:8px;font-size:12px;border-top:1px solid var(--line);padding-top:6px">來源：${sopEsc(it.editBy||'流程文件')}${it.editTs?`・${sopEsc(it.editTs)}`:''}</div>`
  return h + `</div>`
}
async function sopSubDo(itemId, subId, undo){
  if (!TK()) { alert('請先登入：按右上「登入」→ 私訊 DD「登入碼」→ 填入 4 個數字（或點 DD 給的個人連結）'); return }
  const it = (sopData.def.items||[]).find(x=>x.id===itemId)
  const su = it && (it.subs||[]).find(s=>s.id===subId)
  const pk = itemId+':'+subId
  if (!undo && su && su.photo && !sopPhotos[pk]) { alert('這個子項目要拍照——先按相機鈕'); return }
  // v4.61.3 樂觀更新：沒照片的子項立即反映，fetch 背景確認
  const fast = !sopPhotos[pk]
  if (fast) {
    sopData.log = sopData.log || { items:{} }; sopData.log.items = sopData.log.items || {}
    const cur = sopData.log.items[itemId] || {}; cur.subs = cur.subs || {}
    if (it) { cur.title = it.title; cur.st = it.st; cur.tg = it.tg||'' }
    if (undo) delete cur.subs[subId]
    else { const now = new Date(Date.now()+8*3600e3).toISOString().slice(11,16); cur.subs[subId] = { done:1, ts:now, by:(sopData.me&&sopData.me.name)||'' } }
    sopData.log.items[itemId] = cur; sopRender()
  }
  try {
    const r = await fetch('/api/mail-sync?sopdone=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ itemId, subId, undo:!!undo, photo: sopPhotos[pk]||undefined, token: TK() }) })
    const d = await r.json()
    if (d && d.ok) { delete sopPhotos[pk]; sopData.log = d.log; if (!fast) sopRender() }
    else { alert((d&&d.error)||'失敗'); if (fast) sopLoad() }
  } catch(e){ if (fast) sopLoad(); alert('連線失敗，再試一次') }
}
async function sopStrictOn(on){
  if (on && !confirm('啟用嚴格模式後：動作過了「結束時間」就鎖死、不能再打完成（只能回報異常），連主管也不能補成準時。確定啟用？')) return
  const r = await fetch('/api/mail-sync?sopstrict=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ on:!!on, token: TK() }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) { if (sopData&&sopData.def) sopData.def.strictMode = d.strictMode; sopLoad() } else alert((d&&d.error)||'失敗')
}
async function sopSummaryPreview(){ // v4.60.0 接後端 sop-summary：顯示真實彙整內容＋是否會真發；審核人可手動發送
  let d = null
  try { const r = await fetch('/api/sop-summary?sopsummary=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ mode:'preview', token: TK() }) }); d = await r.json() } catch(_){}
  if (!d || !d.ok) { alert('讀不到彙整'); return }
  const isMgr = sopData.me && sopData.me.isMgr
  const ob = (d.snap && d.snap) || {}
  const ov = document.createElement('div'); ov.id='sumOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:65;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;border-radius:14px;width:min(460px,94vw);max-height:90vh;overflow:auto;padding:16px" onclick="event.stopPropagation()">
    <div style="font-weight:900;margin-bottom:8px">📋 收班彙整預覽</div>
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.6;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px">${sopEsc(d.text)}</div>
    <div class="hint" style="margin-bottom:10px">${d.willSend?'⚠️ 群組發送目前「已開啟」——按下面會真的發到群組。':'🔕 群組發送目前關閉（預設）＝這是預覽，不會發到群組。要真發：到「📢DD自動訊息」開啟「SOP 每日收班彙整」。'}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="mini" style="padding:9px 14px" onclick="document.getElementById('sumOv').remove()">關閉</button>
      ${isMgr?`<button class="mini on" style="padding:9px 16px" onclick="sopSummarySend()">${d.willSend?'立即發送到群組':'測試發送（dry-run）'}</button>`:''}
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
async function sopSummarySend(){
  if (!confirm('確定執行發送？（群組發送關閉時＝dry-run 不會真發，只記錄）')) return
  let d = null
  try { const r = await fetch('/api/sop-summary?sopsummary=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ mode:'send', token: TK() }) }); d = await r.json() } catch(_){}
  const o = document.getElementById('sumOv'); if (o) o.remove()
  if (!d || !d.ok) { alert((d&&d.error)||'失敗'); return }
  alert(d.already ? '今天已經發過了（不重送）' : d.status==='sent' ? '✅ 已發送到群組' : d.status==='dryrun' ? '🔕 dry-run 完成（未真發，已記錄在 outbox）' : d.status==='failed' ? '❌ 發送失敗（可稍後重試）' : '完成：'+d.status)
}
function sopRender(){
  const el = document.getElementById('sop'); if (!el || !sopData) return
  if (sopMasterOn) { sopMaster(el); return }
  const items = (sopData.def.items || [])
  const log = sopData.log.items || {}
  const now = new Date(Date.now() + 8*3600e3).toISOString().slice(11,16)
  const wd = new Date().getDay()
  // 站別清單＝伺服器的 stations 順序（可含空站）＋任何漏網的 item 站
  const sts = [...(sopData.def.stations || []), ...new Set(items.map(i => i.st).filter(s => !(sopData.def.stations || []).includes(s)))]
  if (!sts.length) { el.innerHTML = ''; return }
  const doneN = items.filter(i => log[i.id] && log[i.id].done).length
  const me = sopData.me
  const noStartN = items.filter(i=>!i.start && (i.end||i.due)).length // 有結束沒開始＝待設定
  const subTab = (v,lb)=>`<span onclick="sopSubTab('${v}')" style="padding:7px 14px;border-radius:9px;font-weight:800;font-size:14px;cursor:pointer;border:1px solid ${window._sopSub===v?'transparent':'var(--line)'};background:${window._sopSub===v?'var(--grad)':'var(--card)'};color:${window._sopSub===v?'#fff':'var(--muted)'}">${lb}</span>`
  let s = `<section><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><h2 style="margin:0">工作流程 SOP <span class="hint" style="font-weight:600">${sopData.date.slice(5)}</span></h2><span class="hint" style="margin-left:auto;font-weight:900;color:${doneN===items.length?'var(--green)':'var(--pdark)'}">今日 ${doneN}/${items.length}</span></div>`
  s += `<div style="display:flex;gap:7px;margin-bottom:10px">${subTab('today','今日執行')}${subTab('tmpl','流程範本')}${subTab('hist','歷史紀錄')}</div>`
  s += me ? `<div class="hint" style="margin-bottom:6px">👤 <b style="color:var(--pdark)">${me.name}</b>（打卡自動記你的名字・可編輯 SOP，改動會留姓名時間紀錄）</div>`
          : `<div class="hint" style="margin-bottom:6px">💡 ${BIND_HINT}——打卡不用打名字、可編輯 SOP、認領問題</div>`
  // v4.63.0 V3：正式永遠驗證時間，沒有嚴格開關。待設定（有結束沒開始）提示管理者去補
  if (me && me.isMgr && noStartN) s += `<div style="margin-bottom:8px;padding:8px 11px;background:#2E2816;border:1px solid #E8D089;border-radius:9px;font-size:13px;color:#E8D089">⏳ 有 <b>${noStartN}</b> 個動作沒設「開始時間」＝顯示「待設定」——點該動作 ✎ 補上開始/結束時間。</div>`
  if (wd === 0 || wd === 6) s += `<div class="hint" style="margin-bottom:8px">今天公休——這是清單預覽，打卡留給營業日。</div>`
  // 非「今日執行」子頁＝範本/歷史
  if (window._sopSub === 'tmpl') { s += sopTemplateHtml(now, wd); s += `</section>`; el.innerHTML = s; return }
  if (window._sopSub === 'hist') { s += sopHistoryHtml(); s += `</section>`; el.innerHTML = s; setTimeout(()=>sopHistLoad(sopData.date),0); return }
  // 站別篩選＋📌釘選（張良 2026-09-21：SOP 站多，每人點自己要看的；釘選存在自己手機）
  // v4.18.0 #hashtag 雙標籤（張良拍板）：#階段 × #產品 兩排篩選——點產品看全程、點階段看跨產品、都點=交集
  const stDisp = st9 => String(st9).includes('｜') ? String(st9).split('｜').pop() : st9
  const catsN = sopData.def.cats || []
  const coN = sopData.def.catOwner || {}
  const soN = sopData.def.stOwner || {}
  let curTg = window._sopTg ?? null
  if (curTg && !catsN.includes(curTg)) curTg = window._sopTg = null
  const itemsAll = items
  const tgOf = it9 => it9.tg && catsN.includes(it9.tg) ? it9.tg : ''
  const itemsF = itemsAll.filter(it9 => !curTg || tgOf(it9) === curTg) // 階段篩選後的條目
  const view = (sopFilter==='all'||sopFilter==='pin'||sopFilter==='mine'||sts.includes(sopFilter)) ? sopFilter : (sopPin.size && !curTg ? 'pin' : 'all')
  const myName = me && me.name
  const shown0 = sts.filter(st2 => view==='all' ? true : view==='pin' ? sopPin.has(st2) : view==='mine' ? ((sopData.def.stOwner||{})[st2]===myName) : st2===view).filter(st2 => !curTg || itemsF.some(i9=>i9.st===st2) || view===st2)
  const allColl = shown0.length > 0 && shown0.every(s2=>sopColl.has(s2))
  const chipS = (on) => `border:1px solid ${on?'var(--primary)':'var(--line)'};background:${on?'var(--primary)':'var(--card)'};color:${on?'#fff':'var(--muted)'};border-radius:9px;padding:4px 10px;font-size:14px;font-weight:800;cursor:pointer;white-space:nowrap`
  const catBtn = (on) => `border:1.5px solid ${on?'var(--primary)':'var(--line)'};background:${on?'var(--grad)':'var(--soft)'};color:${on?'#fff':'var(--text)'};border-radius:10px;padding:8px 16px;font-size:15px;font-weight:900;cursor:pointer;white-space:nowrap`
  // v4.62.0 V3：第一排＝工作站、第二排＝階段（交換）
  // 第一排：工作站
  s += `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
    ${me?`<span style="${chipS(view==='mine')}" onclick="sopFset('mine')">我的工作</span>`:''}
    ${sopPin.size&&!curTg?`<span style="${chipS(view==='pin')}" onclick="sopFset('pin')">📌 我的釘選（${sopPin.size}）</span>`:''}
    <span style="${chipS(view==='all')}" onclick="sopFset('all')">全部</span>
    ${sts.map(st2=>`<span style="${chipS(view===st2)};display:inline-flex;gap:6px;align-items:center"><span onclick="sopFset('${st2}')">${stDisp(st2)}</span><span onclick="sopPinT('${st2}')" title="釘選/取消釘選" style="opacity:${sopPin.has(st2)?1:.4};font-size:13px">📌</span></span>`).join('')}
    ${me&&window._sopMng?`<span style="${chipS(false)}" onclick="sopStAdd()">＋ 工作站</span>`:''}
    ${me?`<span style="${chipS(!!window._sopMng)};margin-left:auto" onclick="sopMngT()">⚙️ 設定</span>`:''}
  </div>`
  // 工作站管理列（設定模式＋選中某站）
  if (me && window._sopMng && view !== 'all' && view !== 'pin' && sts.includes(view)) {
    const mgrC2 = me.approver || me.role === '主管'
    s += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 8px;align-items:center;font-size:13px">
      <span class="hint" style="font-weight:800">「${stDisp(view)}」：</span>
      <button class="mini" onclick="sopStRen('${view}')">✏️ 改名</button>
      <button class="mini" style="color:var(--red)" onclick="if(confirm('刪除工作站「${stDisp(view)}」？條目會進回收站可復原'))sopstOp({op:'del',st:'${view}'}).then(()=>{sopFilter='all'})">🗑 刪站</button>
      <button class="mini" onclick="sopOrdMove('st','${view}',-1)">◀</button><button class="mini" onclick="sopOrdMove('st','${view}',1)">▶</button>
      ${mgrC2?`<span class="hint">⭐ 負責人</span><select onchange="sopstOp({op:'ownset',st:'${view}',owner:this.value})" style="border:1px solid var(--line);border-radius:7px;padding:5px;font-size:13px"><option value="">無</option>${(sopData.names||[]).map(n=>`<option${soN[view]===n?' selected':''}>${n}</option>`).join('')}</select>`:''}
      <button class="mini on" onclick="sopItemEdit(null,'${view}')">＋ 新增動作</button>
    </div>`
  }
  // 第二排：階段（V3 張良：第一層跟第二層有區隔＝加底色分開）
  s += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:7px 8px">
    <span class="hint" style="font-weight:800;margin-right:2px">階段</span>
    <span style="${chipS(!curTg)}" onclick="sopCatSet(null)">全部</span>
    ${catsN.map(cg=>`<span style="${chipS(curTg===cg)}" onclick="sopCatSet('${cg}')">${cg}<span style="margin-left:5px;font-weight:700;font-size:12px;color:${curTg===cg?'#DCEBFF':'var(--muted)'}">${itemsAll.filter(i9=>tgOf(i9)===cg).length}</span></span>`).join('')}
    ${me&&window._sopMng?`<span style="${chipS(false)}" onclick="sopCatAdd()">＋ 階段</span>`:''}
    ${me&&window._sopMng?`<span style="${chipS(false)}" onclick="sopCatMng()">🗂 組織架構・拖曳排序</span>`:''}
    <span style="${chipS(!!window._sopPending)};margin-left:auto" onclick="sopPendingT()">只看待完成</span>
    <span style="${chipS(false)}" onclick="sopCollAll(${JSON.stringify(shown0).replace(/"/g,'&quot;')})">${allColl?'⏵ 全部展開':'⏷ 全部收合'}</span>
  </div>`
  // 階段管理列（設定模式＋選中階段）
  if (curTg && me && window._sopMng) {
    const mgrC = me.approver || me.role === '主管'
    s += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 8px;align-items:center;font-size:13px">
      <span class="hint" style="font-weight:800">「${curTg}」：</span>
      <button class="mini" onclick="prepAsk('改階段名「${curTg}」',0,1,(q,r)=>{if(r)sopstOp({op:'catren',cat:'${curTg}',newName:r}).then(()=>{window._sopTg=r})},'新名稱')">✏️ 改名</button>
      <button class="mini" style="color:var(--red)" onclick="if(confirm('刪除階段「${curTg}」？條目會變未分階段，不會刪條目'))sopstOp({op:'catdel',cat:'${curTg}'}).then(()=>{window._sopTg=null})">🗑 刪階段</button>
      <button class="mini" onclick="sopOrdMove('cat','${curTg}',-1)">◀</button><button class="mini" onclick="sopOrdMove('cat','${curTg}',1)">▶</button>
      ${mgrC?`<span class="hint">⭐ 負責人</span><select onchange="sopstOp({op:'catown',cat:'${curTg}',owner:this.value})" style="border:1px solid var(--line);border-radius:7px;padding:5px;font-size:13px"><option value="">無</option>${(sopData.names||[]).map(n=>`<option${coN[curTg]===n?' selected':''}>${n}</option>`).join('')}</select>`:(coN[curTg]?`<span style="color:#D4A72C;font-weight:800">⭐ ${coN[curTg]}</span>`:'')}
    </div>`
  }
  const shown = shown0
  s += `<div class="sopCols"><div class="sopMain">` // v4.65.0 V3 桌面兩欄：左主流程
  if (!shown.length) s += `<div class="mut" style="font-size:14px">${view==='mine'?'今天沒有分派給你的工作——你是負責人的工作站會顯示在這（負責人由審核人／主管在工作站 ⚙️ 指定）。先按「全部工作站」看全部。':curTg?`「${curTg}」還沒有動作——到工作站按 ＋新增動作`:'釘選的站不見了（可能被改名）——按「全部工作站」重新釘。'}</div>`
  shown.forEach(st => {
    const canEd = me && me.canEdit
    const stIss = (sopData.issues||[]).filter(x => x.st === st)
    const stItems = itemsF.filter(i => i.st === st)
    const stDone = stItems.filter(i => log[i.id] && log[i.id].done).length
    const coll = sopColl.has(st)
    const own9 = (sopData.def.stOwner||{})[st]
    const mgr9 = me && (me.approver || me.role === '主管')
    const sug9 = (sopData.sugOpen||{})[st] || 0
    const sugBtn = own9 && me ? ((me.name===own9 || mgr9)
      ? `<button class="mini" style="color:${sug9?'var(--primary)':'var(--muted)'}" onclick="sugView('${st}')">💡 建議${sug9?`(${sug9})`:''}</button>`
      : `<button class="mini" style="color:var(--primary)" onclick="sugAdd('${st}')">💡 提建議</button>`) : (own9 ? `<button class="mini" onclick="sugView('${st}')">💡${sug9?`(${sug9})`:''}</button>` : '')
    s += `<div onclick="sopCollT('${st}')" style="cursor:pointer;background:var(--psoft);border-radius:8px;padding:4px 10px;font-weight:900;color:var(--pdark);font-size:14px;margin:10px 0 4px">${coll?'⏵':'⏷'} ${stDisp(st)}${own9?` <span style="font-weight:700;font-size:12px;color:#D4A72C">⭐${own9}</span>`:''} <span class="hint" style="font-weight:700">${stDone}/${stItems.length}${stIss.length?`・⚠️${stIss.length}`:''}</span>
      <span style="float:right" onclick="event.stopPropagation()">${sugBtn}<button class="mini" style="color:#A85C26" onclick="sopReport('${st}')">⚠️ 回報</button></span></div>`
    if (coll) return
    stIss.forEach(x => {
      const pend = x.status === 'pending'
      s += `<div style="background:${pend?'#2E2816':'#3A2023'};border:1px solid ${pend?'#E8D089':'#F0B8B1'};border-radius:8px;padding:8px 10px;margin:4px 0;font-size:14px">
        <b style="color:${pend?'#A85C26':'var(--red)'}">${pend?'🕐':'⚠️'} ${x.text||'（附件）'}</b>
        <div class="hint">${x.by}・${x.ts}${(x.media||[]).map((m,i)=>` <a href="${m}" target="_blank">📎附件${i+1}</a>`).join('')}</div>
        ${pend?`<div class="hint" style="color:#A85C26;font-weight:700">🕐 ${x.doneBy} 已處理・等老闆審核</div>`:''}
        ${!pend&&x.claimBy?`<div style="color:var(--pdark);font-weight:800;font-size:13px">🔧 ${x.claimBy} 處理中・已 ${lbElapsed(x.claimAt)}</div>`:''}
        ${pend&&me&&me.approver?`<span><button class="mini on" style="margin-top:4px" onclick="sopReview('${x.id}',1)">✅ 核准</button><button class="mini" style="margin-top:4px;color:var(--red)" onclick="sopReview('${x.id}',0)">↩︎ 退回</button></span>`:''}
        ${!pend&&me&&!x.claimBy?`<button class="mini on" style="margin-top:4px" onclick="lbOp('${x.id}','claim')">🙋 我來解決</button>`:''}
        ${!pend&&me?`<button class="mini" style="margin-top:4px" onclick="sopResolve('${x.id}')">✅ 已解決${me.approver?'':'（送審核）'}</button>`:''}</div>`
    })
    if (!items.some(i => i.st === st)) s += `<div class="hint" style="padding:6px 4px">（這一站還沒有 SOP 項目——想加：點某一條旁的 ⚙️，或先按右上「⚙️ 設定」）</div>`
    // 照設定時間自動排序（張良 2026-09-21：早的在上面；沒設時間的排最後）
    const grpMode = (view === st) && !curTg && catsN.length // 看單一產品全程→照階段分組
    const stList = itemsF.filter(i => i.st === st).filter(i => !window._sopPending || !(log[i.id] && log[i.id].done)).sort((a,b)=> grpMode ? ((catsN.indexOf(tgOf(a))+99*(tgOf(a)===''))-(catsN.indexOf(tgOf(b))+99*(tgOf(b)===''))) || String(a.due||'99:99').localeCompare(String(b.due||'99:99')) : String(a.due||'99:99').localeCompare(String(b.due||'99:99')))
    let lastTg9 = '⟪init⟫'
    stList.forEach(it => {
      if (grpMode) { const g9 = tgOf(it) || '未分階段'; if (g9 !== lastTg9) { lastTg9 = g9; s += `<div style="font-weight:900;font-size:13px;color:var(--pdark);margin:8px 0 2px"># ${g9}</div>` } }
      const lg = log[it.id]
      const state = sopState(it, lg, now, wd, log)
      const open = sopOpenSet.has(it.id)
      const subs = it.subs || []
      const subDoneN = subs.filter(su => lg && lg.subs && lg.subs[su.id] && lg.subs[su.id].done).length
      // v4.59.0 收合列：名稱(點展開)＋時間區間＋五狀態徽章＋鉛筆(設定模式)；展開＝說明/標準照/子項目/拍照完成
      s += `<div id="sopit-${it.id}" style="padding:9px 2px;border-bottom:1px solid var(--line)">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;min-width:0;cursor:pointer" onclick="sopActToggle('${it.id}')">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-weight:700;color:var(--ink)">${open?'▾':'▸'} ${sopEsc(it.title)}</span>${it.req===false?'<span class="hint" style="font-size:11px;border:1px solid var(--line);border-radius:5px;padding:0 4px">選做</span>':''}${subs.length?`<span class="hint" style="font-size:12px">子項 ${subDoneN}/${subs.length}</span>`:''}</div>
            <div class="hint" style="font-size:12px">${sopFmtRange(it)}</div>
          </div>
          ${(lg&&lg.done) ? `<span onclick="event.stopPropagation();sopView('${it.id}')" title="查看完成紀錄" style="flex:0 0 auto;display:flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer"><span style="color:var(--green);font-weight:800;font-size:13px">${sopEsc(lg.by||'')} · ${lg.ts}</span>${lg.photo?`<img src="${lg.photo}" style="width:30px;height:30px;object-fit:cover;border-radius:6px;border:1px solid var(--green)">`:''}</span>` : state==='open' ? `<button class="mini on" style="flex:0 0 auto;padding:6px 16px" onclick="event.stopPropagation();sopDoOrExpand('${it.id}')">完成</button>` : sopBadgeOutline(state)}
          <span class="lnkbtn" title="複製這條連結（可貼到會議宣達）" onclick="event.stopPropagation();copyLink('#sop=${it.id}')" style="flex:0 0 auto">🔗</span>
          ${me&&me.isMgr?`<span class="lnkbtn" title="編輯這一條" onclick="event.stopPropagation();sopItemEdit('${it.id}')" style="flex:0 0 auto">✎</span>`:''}
        </div>
        ${window._sopEdit===it.id ? sopEditForm(it, false) : (open ? sopActPanel(it, lg, state) : '')}
      </div>`
    })
    // V3 原地新增動作（設定模式）：站末尾＋新增動作，點了在此展開空白編輯表單
    if (me && me.isMgr) {
      if (window._sopEdit === '__new__:'+st) s += sopEditForm({ title:'', start:'', end:'', req:true, photo:false, desc:'', st, tg:(curTg||window._sopTg||'') }, true)
      else s += `<button class="mini on" style="margin:6px 0 4px;padding:7px 14px" onclick="sopItemEdit(null,'${st}')">＋ 新增動作</button>`
    }
  })
  // ✍️ 編輯紀錄 v2（張良 2026-09-22「這紀錄沒用」→ 每筆算出「改了什麼」：改前快照 vs 下一版逐條 diff）
  const eds = (sopData.def.edits || [])
  if (eds.length) {
    const cntE = {}; eds.forEach(e=>{ cntE[e.by||'？'] = (cntE[e.by||'？']||0)+1 })
    // 每筆的「改後狀態」＝上一筆(更新的那筆)的 prev；最新一筆的改後＝現在的 def
    const itemsOf = (e) => !e ? (sopData.def.items||[]) : (Array.isArray(e.prev) ? e.prev : ((e.prev||{}).items||null))
    const diffOf = (i) => {
      const before = itemsOf(eds[i]); let after = itemsOf(eds[i-1] || null)
      if (!before || !after) return null
      const stE = eds[i].st // 站存檔：只比那一站
      const A = stE ? after.filter(x=>x.st===stE) : after, B = before
      const bm = Object.fromEntries(B.map(x=>[x.id,x])), am = Object.fromEntries(A.map(x=>[x.id,x]))
      const add = A.filter(x=>!bm[x.id]).map(x=>x.title)
      const del = B.filter(x=>!am[x.id]).map(x=>x.title)
      const chg = A.filter(x=>{ const b=bm[x.id]; return b && (b.title!==x.title || b.due!==x.due || !!b.photo!==!!x.photo || (b.ref||'')!==(x.ref||'') || b.st!==x.st) })
        .map(x=>{ const b=bm[x.id]; const w=[]; if(b.title!==x.title)w.push(`改名「${b.title}→${x.title}」`); if(b.due!==x.due)w.push(`時間${b.due}→${x.due}`); if(!!b.photo!==!!x.photo)w.push(x.photo?'加要拍照':'取消拍照'); if((b.ref||'')!==(x.ref||''))w.push('換標準照'); if(b.st!==x.st)w.push(`搬到${x.st}`); return `${b.title}（${w.join('、')}）` })
      const parts2 = []
      if (add.length) parts2.push(`<span class="up">＋${add.join('、')}</span>`)
      if (del.length) parts2.push(`<span style="color:var(--red)">－${del.join('、')}</span>`)
      if (chg.length) parts2.push(`<span style="color:#A85C26">～${chg.join('；')}</span>`)
      return parts2.length ? parts2.join('　') : '（沒有內容變動——可能只是重新排序）'
    }
    s += `<details style="margin-top:8px"><summary class="hint" style="cursor:pointer;font-weight:800">✍️ SOP 編輯紀錄（${eds.length}）｜${Object.entries(cntE).map(([n,c])=>`${n} ${c}次`).join('、')}</summary>${eds.map((e,i)=>{ const t8 = e.ts ? new Date(new Date(e.ts).getTime()+8*3600e3).toISOString().slice(5,16).replace('T',' ') : ''; const df2 = diffOf(i); return `<div class="hint" style="padding:3px 0;border-bottom:1px dashed var(--line)">${t8}・<b>${e.by||'？'}</b>${e.st?`・「${e.st}」站`:''}${df2?`<div style="padding-left:10px">${df2}</div>`:''}</div>` }).join('')}</details>` }
  s += `<div class="hint" style="margin-top:8px">點動作名稱展開＝看說明/標準照/子項目/拍照完成。要拍照的先按 📷。</div>`
  s += `</div><div class="sopSide">` // v4.65.0 V3 右欄：收班彙整＋交接（手機時移到動作下方）
  // 📋 收班彙整（右欄；唯讀統計＋預覽不發，統一群組通知第2期接）
  { const reqAll = items.filter(i=>i.req!==false)
    const doneR = reqAll.filter(i=>log[i.id]&&log[i.id].done).length
    const overR = reqAll.filter(i=>sopState(i,log[i.id],now,wd,log)==='overdue')
    const undoneR = Math.max(0, reqAll.length - doneR - overR.length)
    s += `<div style="margin-top:14px;padding:12px;background:var(--soft);border:1px solid var(--line);border-radius:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><b style="font-size:15px">📋 收班彙整</b><span class="hint" style="margin-left:auto">統一通知群組（第2期上線）</span></div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <div style="flex:1;text-align:center;padding:8px;background:#16261B;border:1px solid var(--green);border-radius:9px"><div style="font-size:22px;font-weight:900;color:var(--green)">${doneR}</div><div class="hint">已完成</div></div>
        <div style="flex:1;text-align:center;padding:8px;background:var(--card);border:1px solid var(--line);border-radius:9px"><div style="font-size:22px;font-weight:900">${undoneR}</div><div class="hint">未完成</div></div>
        <div style="flex:1;text-align:center;padding:8px;background:#2A1A12;border:1px solid #C2410C;border-radius:9px"><div style="font-size:22px;font-weight:900;color:#E8853D">${overR.length}</div><div class="hint">逾時</div></div>
      </div>
      ${overR.length?`<div class="hint" style="margin-bottom:6px">逾時未完成：${overR.map(i=>`${sopEsc(i.st)}／${sopEsc(i.title)}`).join('、')}</div>`:''}
      <button class="mini on" style="width:100%;padding:10px" onclick="sopSummaryPreview()">預覽群組回報</button>
      <div class="hint" style="text-align:center;margin-top:5px">時間外無法完成，逾時可回報異常。</div>
    </div>`
  }
  // 🔄 交接待辦（V3 第9節；交接簽收介面在批次5）
  { const ho = sopData.handover || []
    s += `<div style="margin-top:14px;padding:12px;background:var(--soft);border:1px solid var(--line);border-radius:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b style="font-size:15px">🔄 交接待辦</b>${ho.length?`<span class="hint" style="margin-left:auto">${ho.filter(h=>!h.ackBy).length} 未接收</span>`:''}</div>
      ${ho.length ? ho.map(h=>`<div style="padding:7px 0;border-bottom:1px solid var(--line);font-size:13px">
        <div style="display:flex;gap:6px"><span style="flex:1;font-weight:700">${sopEsc(h.text)}${h.qty?` <span class="hint">×${sopEsc(h.qty)}</span>`:''}</span>${me?`<span class="lnkbtn" onclick="sopHoDel('${h.id}')">✕</span>`:''}</div>
        <div class="hint">交：${sopEsc(h.by)} ${h.byTs||''}${h.to?` → ${sopEsc(h.to)}`:''}</div>
        ${h.ackBy?`<div style="color:var(--green);font-weight:700">✓ ${sopEsc(h.ackBy)} 已接收 ${h.ackTs||''}</div>`:(me?`<button class="mini on" style="padding:5px 12px;margin-top:3px" onclick="sopHoAck('${h.id}')">我接收</button>`:'<span class="hint">等接收</span>')}
      </div>`).join('') : '<div class="hint" style="padding:6px 0">目前沒有交接待辦</div>'}
      ${me?`<button class="mini" style="width:100%;padding:9px;margin-top:6px" onclick="sopHoAdd()">＋ 新增交接</button>`:''}
    </div>` }
  s += `</div></div></section>` // 閉 sopSide + sopCols + section
  el.innerHTML = s
  if (window._sopEdit) renderSieSubs() // 原地編輯中→補填子項目清單
}
// 流程範本（第1期：唯讀總覽——站→階段→動作，含時間區間/必做/子項數；編輯走今日執行頁設定模式）
function sopTemplateHtml(now, wd){
  const items = sopData.def.items || []
  const sts = [...(sopData.def.stations || []), ...new Set(items.map(i=>i.st).filter(s=>!(sopData.def.stations||[]).includes(s)))]
  const cats = sopData.def.cats || []
  if (!items.length) return `<div class="hint" style="padding:16px 0">還沒有任何動作——到「今日執行」按 ⚙️ 設定新增。</div>`
  let h = `<div class="hint" style="margin-bottom:8px">整份流程範本一覽（唯讀）。要增刪改排序請回「今日執行」按 ⚙️ 設定。</div>`
  sts.forEach(st => {
    const stItems = items.filter(i=>i.st===st); if (!stItems.length) return
    h += `<div style="font-weight:900;color:var(--pdark);background:var(--psoft);border-radius:8px;padding:5px 10px;margin:10px 0 4px">${sopEsc(st)} <span class="hint" style="font-weight:700">${stItems.length} 項</span></div>`
    const groups = [...cats, ''].filter(g => stItems.some(i => (i.tg&&cats.includes(i.tg)?i.tg:'')===g))
    groups.forEach(g => {
      const gi = stItems.filter(i => (i.tg&&cats.includes(i.tg)?i.tg:'')===g).sort((a,b)=>String(a.start||a.due||'99:99').localeCompare(String(b.start||b.due||'99:99')))
      if (!gi.length) return
      h += `<div class="hint" style="font-weight:800;margin:6px 0 2px"># ${g||'未分階段'}</div>`
      gi.forEach(it => { h += `<div style="display:flex;gap:8px;align-items:center;padding:4px 6px;border-bottom:1px solid var(--line);font-size:14px"><span style="flex:1;min-width:0">${sopEsc(it.title)}${it.req===false?' <span class="hint">選做</span>':''}${(it.subs||[]).length?` <span class="hint">・${it.subs.length}子項</span>`:''}</span><span class="hint">${sopFmtRange(it)}</span></div>` })
    })
  })
  return h
}
// 歷史紀錄（第3期：跨日查詢——選日期讀當天完成紀錄，用當時快照 title/st/tg 顯示，改名/刪條目不壞）
function sopHistoryHtml(){
  const today = sopData.date
  return `<div class="hint" style="margin-bottom:8px">選日期查當天完成紀錄（用當時快照顯示，動作改名/刪除也看得到）。</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><span class="hint">日期</span><input type="date" id="sopHistD" value="${today}" max="${today}" onchange="sopHistLoad(this.value)" style="border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:14px"></div>
    <div id="sopHistBody"></div>`
}
async function sopHistLoad(date){
  const body = document.getElementById('sopHistBody'); if (!body) return
  body.innerHTML = '<div class="hint" style="padding:12px 0">讀取中…</div>'
  let d = null
  try { const r = await fetch('/api/mail-sync?sophist=' + encodeURIComponent(K) + '&date=' + encodeURIComponent(date)); d = await r.json() } catch(_){}
  if (!d || !d.ok) { body.innerHTML = '<div class="hint" style="padding:12px 0">讀不到</div>'; return }
  const items = d.items || {}
  const list = Object.entries(items).filter(([,v])=>v&&v.done).sort((a,b)=>String(a[1].ts||'').localeCompare(String(b[1].ts||'')))
  if (!list.length) { body.innerHTML = '<div class="hint" style="padding:12px 0">這天沒有完成紀錄。</div>'; return }
  body.innerHTML = `<div class="hint" style="margin-bottom:6px">${date}：完成 ${list.length} 項</div>` + list.map(([id,v]) => `<div style="display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--line);font-size:14px">${v.photo?`<img src="${v.photo}" style="width:34px;height:34px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="window.open('${v.photo}','_blank')">`:'<span style="width:34px;text-align:center;color:var(--green)">✓</span>'}<span style="flex:1;min-width:0">${sopEsc(v.title||id)}${v.st?` <span class="hint">${sopEsc(v.st)}</span>`:''}</span><span class="hint">${sopEsc(v.by||'')} ${v.ts||''}</span></div>`).join('')
}
// ── ⚙️ SOP 總編輯（張良 2026-09-21：站/項目拖曳排序、站名直接改、不再跳系統視窗）──
let sopMasterOn = false
function msItemHtml(it){
  return `<div class="msItem" data-id="${it.id||''}" style="display:flex;gap:5px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:5px 7px;margin-bottom:5px">
    <span class="mih" style="cursor:grab;color:var(--muted);font-size:15px;touch-action:none">☰</span>
    <input class="miT" value="${(it.title||'').replace(/"/g,'&quot;')}" placeholder="項目名稱" style="flex:1;min-width:110px;border:1px solid var(--line);border-radius:6px;padding:5px 7px;font-size:14px">
    ${t24c('miD', it.due||'11:00')}
    <label style="font-size:13px;white-space:nowrap"><input class="miP" type="checkbox" ${it.photo?'checked':''}>📷</label>
    <button class="mini" onclick="this.closest('.msItem').remove()">✕</button></div>`
}
function msCardHtml(st, items){
  return `<div class="msCard" data-st="${st}" style="background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:8px;margin-bottom:10px">
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <span class="msh" style="cursor:grab;color:var(--pdark);font-size:17px;touch-action:none">☰</span>
      <input class="msName" value="${st}" placeholder="站名" style="font-weight:900;color:var(--pdark);border:1px solid var(--line);border-radius:7px;padding:5px 8px;width:130px">
      <span style="flex:1"></span>
      <button class="mini" style="color:var(--red)" onclick="msDelSt(this)">🗑 刪站</button>
      <button class="mini on" onclick="sopItemEdit(null,'${view}')">＋ 新增條目</button>
    </div>
    <div class="msItems" style="min-height:8px">${items.map(msItemHtml).join('')}</div>
    <button class="mini" onclick="this.previousElementSibling.insertAdjacentHTML('beforeend', msItemHtml({due:'11:00'}))">＋ 加項目</button>
  </div>`
}
function sopMaster(el){
  const items = sopData.def.items || []
  const sts = [...(sopData.def.stations || []), ...new Set(items.map(i=>i.st).filter(s=>!(sopData.def.stations||[]).includes(s)))]
  let s = `<section><h2>⚙️ SOP 總編輯 <span class="hint">拖 ☰ 排序（項目可拖到別的站）・站名直接改字・改完按儲存</span></h2>
    <div id="msSt">${sts.map(st=>msCardHtml(st, items.filter(i=>i.st===st).sort((a,b)=>String(a.due||'99:99').localeCompare(String(b.due||'99:99'))))).join('')}</div>
    <div style="display:flex;gap:6px;align-items:center;margin:8px 0">
      <input id="msNew" placeholder="新站名（例：甜點站）" style="border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:14px">
      <button class="mini" onclick="msAddSt()">＋ 新增站</button>
    </div>`
  if ((sopData.trash||[]).length) {
    s += `<div style="border:1px dashed var(--line);border-radius:10px;padding:8px 10px;margin:6px 0"><b style="font-size:14px">🗂 回收站</b>` +
      sopData.trash.map(tr=>`<div style="display:flex;align-items:center;gap:8px;padding:3px 0"><span style="flex:1;font-size:14px">🗑 ${tr.st}（${tr.n}項）<span class="hint">${tr.by}・${tr.ts}</span></span><button class="mini on" onclick="sopStOp({op:'restore',trashId:'${tr.id}'})">復原</button></div>`).join('') + `</div>`
  }
  s += `<div style="display:flex;justify-content:space-between;margin-top:10px">
      <button class="mini" onclick="if(confirm('放棄未儲存的修改？')){sopMasterOn=false;sopRender()}">離開</button>
      <button class="mini on" style="padding:9px 20px" onclick="msSave()">💾 全部儲存</button>
    </div></section>`
  el.innerHTML = s
  if (window.Sortable) {
    new Sortable(document.getElementById('msSt'), { handle: '.msh', animation: 150 })
    document.querySelectorAll('.msItems').forEach(x => new Sortable(x, { group: 'msi', handle: '.mih', animation: 150 }))
  }
}
function msAddSt(){
  const inp = document.getElementById('msNew'); const nm = inp.value.trim()
  if (!nm) { alert('輸入站名'); return }
  document.getElementById('msSt').insertAdjacentHTML('beforeend', msCardHtml(nm, []))
  if (window.Sortable) document.querySelectorAll('.msItems').forEach(x => { if (!x._sorted) { new Sortable(x, { group: 'msi', handle: '.mih', animation: 150 }); x._sorted = 1 } })
  inp.value = ''
}
function msDelSt(btn){
  const card = btn.closest('.msCard'); const st = card.querySelector('.msName').value.trim() || card.dataset.st
  if (!confirm(`刪除「${st}」整站？（現有項目進回收站可復原）`)) return
  if (card.dataset.st) sopStOp({ op:'del', st: card.dataset.st }) // 伺服器軟刪（已存在的站）
  card.remove()
}
async function msSave(){
  const stations = [], items = []
  document.querySelectorAll('#msSt .msCard').forEach(card=>{
    const st = card.querySelector('.msName').value.trim() || card.dataset.st
    if (!st || stations.includes(st)) return
    stations.push(st)
    card.querySelectorAll('.msItem').forEach(r=>{
      const title = r.querySelector('.miT').value.trim()
      if (title) items.push({ id: r.dataset.id || undefined, st, title, due: t24read(r, 'miD') || '11:00', photo: r.querySelector('.miP').checked })
    })
  })
  const r = await fetch('/api/mail-sync?sopfull=' + encodeURIComponent(K), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: TK(), stations, items }) })
  const d = await r.json().catch(()=>null)
  if (d && d.ok) { sopMasterOn = false; sopLoad() } else alert((d&&d.error)||'儲存失敗')
}
// 完成紀錄預覽（點✓或縮圖）
// 完成紀錄預覽（點✓或縮圖）：大圖＋資訊＋撤銷（撤銷只在這裡，防誤點）
function sopView(id){
  const it = (sopData.def.items||[]).find(x => x.id === id)
  const lg = (sopData.log.items||{})[id]
  if (!it || !lg) return
  const ov = document.createElement('div'); ov.id = 'viewOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,24,43,.6);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px'
  ov.innerHTML = `<div style="background:#222B38;border:1px solid #3B4654;box-shadow:0 18px 50px rgba(0,0,0,.55);border-radius:14px;max-width:460px;width:100%;padding:14px;text-align:center" onclick="event.stopPropagation()">
    <div style="font-weight:900;color:var(--ink);margin-bottom:6px">${it.title}</div>
    <div class="hint" style="margin-bottom:8px">✓ ${lg.ts} 完成・${lg.by||''}</div>
    ${lg.photo?`<img src="${lg.photo}" style="max-width:100%;max-height:62vh;border-radius:10px;border:1px solid var(--line)">`:'<div class="hint">（這一項沒有照片）</div>'}
    <div style="display:flex;justify-content:space-between;margin-top:12px">
      <button class="mini" style="padding:9px 14px;color:var(--red)" onclick="if(confirm('撤銷這筆完成紀錄？')){document.getElementById('viewOv').remove();sopDo('${id}',1)}">↩︎ 撤銷完成</button>
      <button class="mini on" style="padding:9px 18px" onclick="document.getElementById('viewOv').remove()">關閉</button>
    </div></div>`
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
