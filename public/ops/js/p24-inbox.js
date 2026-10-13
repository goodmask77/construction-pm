// 📥 統一收件匣 v4.70.62（左欄 440px＋籤縮一點，五個帳號籤一排放得下，張良 10-11「排版啦」；+DD 帳號：DD 私訊自動進來、DD 答過算已完成、設定頁不給改接；側欄／常用列待處理數字徽章；清單重排：帳號列／狀態列分段、狀態實色標籤；狀態改兩顆按鈕；舊版自動重新整理；提醒通知誰／LINE 群可選；視窗撐滿鎖頁、去多餘文字；回覆權限分開勾；圖片氣泡貼合圖片大小；+傳圖片／檔案、貼上截圖；修回過一次後永遠推播；+轉發：接到收件匣後原系統照收）（溝通中樞第三部：三個官方帳號的客人對話集中一頁；只收＋從 app 回覆；單色 stroke SVG）
// 版型同聊天室：桌機左右雙欄、手機兩層；對話每 6 秒輪詢、清單每 20 秒
const IB_ICON = {
  user: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  star: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" class="ibStar" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
  clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  memo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/><path d="M8 9h8M8 13h5"/></svg>',
  ai: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  gear: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  tpl: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h7"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  clip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
}
const IB_VER = '4823' // 跟後端 INBOX_VER 一致；後端回的 ver 不同＝正式站已更新而這台還是舊 JS → 自動重新整理一次
function ibVerCheck(d) { try { if (d && d.ver && d.ver !== IB_VER && !sessionStorage.getItem('ibReloaded_' + d.ver)) { sessionStorage.setItem('ibReloaded_' + d.ver, '1'); location.reload() } } catch (_) {} }
const IB_CATC = ['#0ea5e9', '#f97316', '#e11d48', '#db2777', '#16a34a', '#64748b', '#8b5cf6', '#ca8a04', '#14b8a6', '#4f46e5']
const ibCatCol = (c) => { const cs = (_ibD && _ibD.cats) || []; const i = cs.indexOf(c); return IB_CATC[(i < 0 ? cs.length : i) % IB_CATC.length] }
const ibCatTag = (c, by) => c ? `<span style="background:${ibCatCol(c)}22;color:${ibCatCol(c)};border:1px solid ${ibCatCol(c)}66;border-radius:6px;padding:0 6px;font-size:11px;font-weight:700" title="${by === 'ai' ? 'AI 猜的' : by === 'kw' ? '關鍵字猜的' : '人工分類'}">${ibEsc(c)}${by === 'ai' || by === 'kw' ? '?' : ''}</span>` : ''
const IB_ST = { new: '新', open: '處理中', wait: '等待中', done: '已完成' }
const IB_STC = { new: '#2563eb', open: '#d97706', wait: '#7c3aed', done: '#16a34a' } // 狀態色：新＝藍、處理中＝橘、已完成＝綠（張良 10-11「底色標籤直覺辨識」）
const ibStBadge = (st) => `<span style="background:${IB_STC[st] || IB_STC.new};color:#fff;border-radius:6px;font-size:11px;font-weight:700;padding:2px 7px;line-height:16px;white-space:nowrap">${IB_ST[st] || '新'}</span>`
const IB_CSS = `<style id="ibCss">
.ibSeg{display:flex;gap:3px;flex-wrap:wrap;padding:3px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.ibSeg::-webkit-scrollbar{display:none}
.ibSeg button{flex:0 0 auto;border:0;background:transparent;color:#C3CEDC;font-size:13px;font-weight:700;padding:6px 9px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:inherit}
@media(max-width:430px){.ibSeg button{font-size:12.5px;padding:6px 8px;gap:5px}.ibSeg .nc{display:none}}
.ibSeg button.on{background:var(--grad);color:#fff;box-shadow:0 2px 8px rgba(18,102,200,.3)}
.ibSeg button.on[data-c]{background:var(--c);box-shadow:none}
.ibSeg button .dot{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
.ibSeg button.on .dot{background:#fff}
.ibSeg button .n{background:rgba(255,255,255,.18);border-radius:999px;font-size:11px;padding:0 6px;line-height:16px}
.ibSeg button:not(.on) .n{background:#2563eb;color:#fff}
.ibRow{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-bottom:1px solid var(--line);cursor:pointer}
.ibRow.cur{background:var(--card)}
.ibRow.done{opacity:.72}
.ibRow .av{width:42px;height:42px;border-radius:50%;background:var(--card) center/cover;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:800;flex:none;margin-top:2px}
.ibRow .l1{display:flex;justify-content:space-between;gap:6px;align-items:center}
.ibRow .l1 b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ibRow .l2{display:flex;justify-content:space-between;gap:6px;align-items:center;margin-top:1px}
.ibRow .l2 span.t{font-size:12.5px;color:#8A97A8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ibRow .l3{display:flex;gap:6px;align-items:center;margin-top:5px;flex-wrap:wrap}
.ibRow .acct{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#C3CEDC}
.ibRow .acct i{width:7px;height:7px;border-radius:50%;display:inline-block}
.ibRow .who{font-size:11.5px;color:#8A97A8}
.ibRow .un{background:#2563eb;color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:0 7px;line-height:18px;flex:none}
</style>`
// 對話視窗撐滿（收件匣／聊天室共用，v4.70.52）：頁面鎖住不捲，視窗高＝螢幕高－視窗頂－手機底部捷徑列；只有訊息區會捲
function paneFit(id) {
  const w = document.getElementById(id); if (!w) return
  try { document.documentElement.classList.add('paneLock'); window.scrollTo(0, 0) } catch (_) {}
  const fb = document.getElementById('favbar'); const fbH = (fb && getComputedStyle(fb).display !== 'none') ? fb.offsetHeight : 0
  const top = w.getBoundingClientRect().top
  w.style.height = Math.max(320, window.innerHeight - top - fbH - 8) + 'px'
}
let _ibD = null, _ibCur = null, _ibConv = null, _ibMsgs = [], _ibTimer = null, _ibListTimer = null, _ibBusy = false, _ibAcct = '', _ibFilter = 'todo', _ibReplyLeft = 0, _ibTick = null, _ibSideTab = '', _ibAiHist = {}, _ibCat = ''
const ibEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const ibT = t => { try { const d = new Date(t); const now = new Date(); const same = d.toDateString() === now.toDateString(); return (same ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (_) { return '' } }
async function ibGet(q) { try { const r = await fetch('/api/mail-sync?inbox=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK() || '') + '&' + q + '&r=' + Date.now()); return await r.json() } catch (e) { return null } }
async function ibPost(body) { try { const r = await fetch('/api/mail-sync?inbox=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) }); return await r.json() } catch (e) { return null } }
function ibStop() { [_ibTimer, _ibListTimer, _ibTick].forEach(t => t && clearInterval(t)); _ibTimer = _ibListTimer = _ibTick = null }
const ibAcct = k => ((_ibD && _ibD.accounts) || []).find(a => a.key === k) || { name: k, color: '#888' }
const ibTag = k => { const a = ibAcct(k); return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#C3CEDC;white-space:nowrap"><i style="width:7px;height:7px;border-radius:50%;background:${a.color};display:inline-block"></i>${ibEsc(a.name)}</span>` }

async function inboxLoad(convId) {
  ibStop()
  curStore = 'inbox'; setTabs('inbox')
  const b = document.getElementById('tab-inbox'); if (b) b.className = 'on'
  document.getElementById('upd').textContent = '收件匣'
  // v4.71.11 速度鐵則（docs/PERF_RULES.md）：先畫上次的清單（記憶體→本機快取），背景再抓新的；第一次進來才看到「讀取中」
  if (!_ibD) { try { const c = JSON.parse(localStorage.getItem('ibListCache') || 'null'); if (c && c.ok && c.ver === IB_VER) _ibD = c } catch (_) {} }
  if (_ibD) { if (convId) _ibCur = convId; ibRender() } else app.innerHTML = '<section><h2>收件匣</h2><div class="hint">讀取中…</div></section>'
  const d = await ibGet('op=list')
  if (curStore !== 'inbox') return
  if (d && d.ok) { try { localStorage.setItem('ibListCache', JSON.stringify(d)) } catch (_) {} }
  ibVerCheck(d)
  if (!d || !d.ok) { app.innerHTML = '<section><h2>收件匣</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">' + ibEsc((d && d.error) || '讀不到收件匣') + '</div></section>'; return }
  const had = !!document.getElementById('ibWrap')
  _ibD = d
  if (convId) _ibCur = convId
  if (had) ibRenderList(); else ibRender() // 已經用快取畫好了→只更新清單，不重畫對話區（不洗掉正在打的字）
  _ibListTimer = setInterval(async () => { if (curStore !== 'inbox') return ibStop(); const d2 = await ibGet('op=list'); ibVerCheck(d2); if (d2 && d2.ok) { _ibD = d2; ibRenderList() } }, 20000)
  if (_ibCur) ibOpen(_ibCur, true)
}
function ibUnreadTotal() { return ((_ibD && _ibD.convs) || []).reduce((t, c) => t + (c.unread || 0), 0) }
// 🔴 v4.70.59 側欄數字徽章（張良 10-11「如果有訊息這邊能顯示 123 這種通知在旁邊嗎」）：
// 數字＝「待處理」對話數（跟頁內待處理分頁同一套算法：未完成 或 有未讀）；側欄按鈕＋手機常用列都掛；不在收件匣頁時每 60 秒背景問一次
function ibTodoCount(d) { return (((d || _ibD) && (d || _ibD).convs) || []).filter(c => c.status !== 'done' && c.status !== 'wait' || c.unread).length }
function navBadgePaint(key, n) { // 共用：聊天室也用（key=分頁代號）
  try {
    const els = [document.getElementById('tab-' + key), document.querySelector('#favbar [data-fk="' + key + '"]')].filter(Boolean)
    els.forEach(b => {
      let d = b.querySelector('.navDot'); if (d) d.remove()
      if (!(n > 0)) return
      const fav = b.closest('#favbar')
      d = document.createElement('span'); d.className = 'navDot'
      d.style.cssText = fav ? 'position:absolute;top:-2px;right:8px;background:#E5484D;color:#fff;border-radius:999px;font-size:11px;font-weight:900;min-width:17px;height:17px;line-height:17px;text-align:center;padding:0 3px'
        : 'margin-left:auto;background:#E5484D;color:#fff;border-radius:999px;font-size:11px;font-weight:900;min-width:18px;height:18px;line-height:18px;text-align:center;padding:0 5px;display:inline-block;flex:none'
      if (fav) { b.style.position = 'relative'; b.style.overflow = 'visible' }
      d.textContent = n > 99 ? '99+' : n; b.appendChild(d)
    })
  } catch (_) {}
}
function ibBadgePaint() { navBadgePaint('inbox', _ibD && _ibD.ok !== false ? ibTodoCount() : 0) }
async function ibBadgeSync() { if (curStore === 'inbox') return; const b = document.getElementById('tab-inbox'); if (!b || b.style.display === 'none') return; const d = await ibGet('op=list'); if (d && d.ok) { _ibD = d; ibBadgePaint() } }
setTimeout(ibBadgeSync, 2500); setInterval(() => { if (!document.hidden) ibBadgeSync() }, 60000)
document.addEventListener('visibilitychange', () => { if (!document.hidden) ibBadgeSync() })
function ibRender() {
  const mobile = window.innerWidth < 760
  app.innerHTML = `<section style="padding:0;overflow:hidden">
    <div id="ibWrap" style="display:flex;height:60vh">
      <div id="ibList" style="width:${mobile ? '100%' : '440px'};flex:none;border-right:${mobile ? '0' : '1px solid var(--line)'};overflow:auto;overscroll-behavior:contain;${mobile && _ibCur ? 'display:none' : ''}"></div>
      <div id="ibPane" style="flex:1;display:${mobile && !_ibCur ? 'none' : 'flex'};flex-direction:column;min-width:0"></div>
    </div></section>`
  paneFit('ibWrap'); ibRenderList(); ibRenderPane()
}
function ibRenderList() {
  try { ibBadgePaint() } catch (_) {} // 在頁內也同步徽章（點開對話清未讀／標完成→數字立刻跟著變）
  const el = document.getElementById('ibList'); if (!el) return
  const d = _ibD || { accounts: [], convs: [] }
  if (!document.getElementById('ibCss')) document.head.insertAdjacentHTML('beforeend', IB_CSS)
  const byAcct = (d.convs || []).filter(c => !_ibAcct || c.acct === _ibAcct)
  // v4.71.11 篩選：待處理（不含等待中）／特別注意／等待中／已完成／全部（張良 2026-10-14）
  const isTodo = c => (c.status !== 'done' && c.status !== 'wait') || c.unread, isDone = c => c.status === 'done' && !c.unread
  const FIL = { todo: isTodo, star: c => c.star && !isDone(c), wait: c => c.status === 'wait' && !c.unread, done: isDone, all: () => true }
  const nTodo = byAcct.filter(isTodo).length, nDone = byAcct.filter(isDone).length, nStar = byAcct.filter(FIL.star).length, nWait = byAcct.filter(FIL.wait).length
  const byFil = byAcct.filter(FIL[_ibFilter] || isTodo)
  const convs = byFil.filter(c => !_ibCat || (_ibCat === '__none' ? !c.cat : c.cat === _ibCat))
  const catN = {}; byFil.forEach(c => { const k = c.cat || '__none'; catN[k] = (catN[k] || 0) + 1 })
  const catSeg = ((d.cats || []).length ? `<div class="ibSeg" style="font-size:12.5px"><button class="${!_ibCat ? 'on' : ''}" onclick="_ibCat='';ibRenderList()">全部分類</button>${(d.cats || []).filter(c => catN[c] || _ibCat === c).map(c => `<button class="${_ibCat === c ? 'on' : ''}" data-c="1" style="--c:${ibCatCol(c)}" onclick="_ibCat=${JSON.stringify(c).replace(/"/g, '&quot;')};ibRenderList()"><i class="dot"></i>${ibEsc(c)} <span class="hint" style="font-size:11px">${catN[c] || 0}</span></button>`).join('')}${catN.__none ? `<button class="${_ibCat === '__none' ? 'on' : ''}" onclick="_ibCat='__none';ibRenderList()">未分類 <span class="hint" style="font-size:11px">${catN.__none}</span></button>` : ''}</div>` : '')
  const acctSeg = `<div class="ibSeg"><button class="${!_ibAcct ? 'on' : ''}" onclick="_ibAcct='';ibRenderList()">全部</button>${(d.accounts || []).map(a => `<button class="${_ibAcct === a.key ? 'on' : ''}" data-c="1" style="--c:${a.color};${a.configured ? '' : 'opacity:.55'}" onclick="_ibAcct='${a.key}';ibRenderList()"><i class="dot"></i>${ibEsc(a.name)}${a.configured ? '' : ' <span class="nc" style="font-size:10px;font-weight:400">未接</span>'}</button>`).join('')}</div>`
  const stSeg = `<div class="ibSeg"><button class="${_ibFilter === 'todo' ? 'on' : ''}" onclick="_ibFilter='todo';ibRenderList()">待處理${nTodo ? ` <span class="n">${nTodo}</span>` : ''}</button><button class="${_ibFilter === 'star' ? 'on' : ''}" onclick="_ibFilter='star';ibRenderList()">特別注意${nStar ? ` <span class="n" style="background:#f59e0b">${nStar}</span>` : ''}</button><button class="${_ibFilter === 'wait' ? 'on' : ''}" onclick="_ibFilter='wait';ibRenderList()">等待中${nWait ? ` <span class="n" style="background:#7c3aed">${nWait}</span>` : ''}</button><button class="${_ibFilter === 'done' ? 'on' : ''}" onclick="_ibFilter='done';ibRenderList()">已完成${nDone ? ` <span class="n" style="background:rgba(255,255,255,.12);color:#C3CEDC">${nDone}</span>` : ''}</button><button class="${_ibFilter === 'all' ? 'on' : ''}" onclick="_ibFilter='all';ibRenderList()">全部</button></div>`
  const row = c => { const a = ibAcct(c.acct); return `<div class="ibRow${_ibCur === c.id ? ' cur' : ''}${c.status === 'done' && !c.unread ? ' done' : ''}" onclick="ibOpen('${ibEsc(c.id)}')">
      <div class="av" style="${c.pic ? `background-image:url('${ibEsc(c.pic)}')` : ''}">${c.pic ? '' : ibEsc((c.name || '?').slice(0, 1))}</div>
      <div style="flex:1;min-width:0">
        <div class="l1"><b>${c.star ? `<span style="color:#f59e0b;vertical-align:-2px;margin-right:3px" title="特別注意">${IB_ICON.star.replace('fill="none"', 'fill="currentColor"')}</span>` : ''}${ibEsc(c.alias || c.name || '客人')}</b><span class="hint" style="font-size:11px;flex:none">${c.lastT ? ibT(c.lastT) : ''}</span></div>
        <div class="l2"><span class="t">${c.last ? ibEsc((c.last.dir === 'out' ? '↩ ' : '') + c.last.text) : ''}</span>${c.unread ? `<span class="un">${c.unread}</span>` : ''}</div>
        <div class="l3">${ibStBadge(c.status)}${ibCatTag(c.cat, c.catBy || 'man')}${c.status === 'wait' && c.waitUntil ? `<span class="who" style="color:#a78bfa;font-weight:700">${c.waitUntil.slice(5).replace('-', '/')} 再回</span>` : ''}${c.memoN ? `<span class="who">備忘 ${c.memoN}</span>` : ''}<span class="acct"><i style="background:${a.color}"></i>${ibEsc(a.name)}</span>${c.assignee ? `<span class="who">${ibEsc(c.assignee)}</span>` : ''}${c.follow === false ? '<span class="who">已封鎖</span>' : ''}</div>
      </div></div>` }
  const notCfg = (d.accounts || []).filter(a => !a.configured)
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)"><b style="font-size:16px;flex:1">收件匣</b>${d.me && d.me.mgr ? `<button class="mini" style="padding:6px 8px" title="收件匣設定：帳號連線／權限／範本" onclick="ibSettings()">${IB_ICON.gear}</button>` : ''}</div>
    <div style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)">${acctSeg}${stSeg}${catSeg}</div>
    ${convs.length ? convs.map(row).join('') : `<div class="hint" style="padding:22px 14px;text-align:center;font-size:13.5px">${(d.accounts || []).length === 0 ? '你沒有任何官方帳號的收件匣權限，請主管在設定裡加你。' : notCfg.length === (d.accounts || []).length ? '官方帳號還沒接上。主管按右上齒輪看要怎麼接。' : _ibFilter === 'todo' ? '沒有待處理的對話' : _ibFilter === 'done' ? '沒有已完成的對話' : '還沒有對話'}</div>`}`
  const tb = document.getElementById('tab-inbox'); if (tb) { const n = ibUnreadTotal(); let bd = tb.querySelector('.chBadge'); if (n) { if (!bd) { bd = document.createElement('span'); bd.className = 'chBadge'; bd.style.cssText = 'background:#2563eb;color:#fff;border-radius:999px;font-size:11px;padding:0 6px;margin-left:6px;line-height:16px;display:inline-block'; tb.appendChild(bd) } bd.textContent = n } else if (bd) bd.remove() }
}
function ibRenderPane() {
  const el = document.getElementById('ibPane'); if (!el) return
  // v4.71.17 治本（張良 2026-10-14「用分類結果一直讀取中」）：重畫表頭會連訊息區、回覆框一起重建 → 這裡統一記下捲動位置與打到一半的字，畫完放回去；訊息已載入就直接畫，任何按鈕都不會再卡「讀取中」
  const oldBox = document.getElementById('ibMsgs'), oldIn = document.getElementById('ibInput')
  const keep = { id: _ibCur, st: oldBox ? oldBox.scrollTop : 0, bottom: oldBox ? oldBox.scrollHeight - oldBox.scrollTop - oldBox.clientHeight < 40 : true, txt: oldIn ? oldIn.value : '' }
  const c = ((_ibD && _ibD.convs) || []).find(x => x.id === _ibCur) || _ibConv
  if (!c) { el.innerHTML = '<div class="hint" style="margin:auto;text-align:center;padding:30px">選一個對話</div>'; return }
  const mobile = window.innerWidth < 760
  const cv = _ibConv || c
  const people = (_ibD && _ibD.people) || []
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap">
      ${mobile ? `<button class="mini" style="padding:6px 8px" onclick="ibBack()">${IB_ICON.back}</button>` : ''}
      <div style="flex:1;min-width:140px"><b style="font-size:16px">${ibEsc(cv.alias || cv.name || '客人')}</b> ${ibTag(cv.acct)}<div class="hint" style="font-size:12px">${cv.alias && cv.name ? 'LINE 名稱：' + ibEsc(cv.name) + ' · ' : ''}${cv.follow === false ? '已封鎖官方帳號 · ' : ''}<span id="ibQuota"></span><span id="ibMember"></span></div></div>
      <span id="ibStBtns" style="display:flex;gap:4px">${ibStBtns(cv.status)}</span>
      <select id="ibAssign" class="mini" style="padding:5px 8px;font-size:12.5px;max-width:120px" onchange="ibOp('assign',this.value)" title="負責人"><option value="">未指派</option>${people.map(p => `<option${cv.assignee === p ? ' selected' : ''}>${ibEsc(p)}</option>`).join('')}</select>
      <select class="mini" style="padding:5px 6px;font-size:12.5px;max-width:110px;${cv.cat ? `border-color:${ibCatCol(cv.cat)};color:${ibCatCol(cv.cat)};font-weight:700` : ''}" onchange="ibOp('cat',this.value)" title="對話分類${cv.catBy === 'ai' ? '（AI 猜的，可以改）' : cv.catBy === 'kw' ? '（關鍵字猜的，可以改）' : ''}"><option value="">分類…</option>${((_ibD && _ibD.cats) || []).map(c => `<option${cv.cat === c ? ' selected' : ''}>${ibEsc(c)}</option>`).join('')}</select>
      <button class="mini" style="padding:5px 8px;font-size:12.5px;display:flex;gap:4px;align-items:center;${_ibSideTab === 'cust' ? 'background:#16a34a;border-color:#16a34a;color:#fff' : ''}" onclick="ibSide('cust')" title="客戶資料：會員、inline 訂位紀錄、包場案件、聯絡方式">${IB_ICON.user} 客戶</button>
      <button class="mini" style="padding:5px 8px;font-size:12.5px;display:flex;gap:4px;align-items:center;${cv.star ? 'background:#f59e0b;border-color:#f59e0b;color:#fff' : ''}" onclick="ibOp('star', ${cv.star ? 0 : 1})" title="特別注意：釘在清單最上面，另有「特別注意」分頁">${cv.star ? IB_ICON.star.replace('fill="none"', 'fill="currentColor"') : IB_ICON.star} 注意</button>
      <button class="mini" style="padding:5px 8px;font-size:12.5px;display:flex;gap:4px;align-items:center;${cv.status === 'wait' ? 'background:#7c3aed;border-color:#7c3aed;color:#fff' : ''}" onclick="ibWait()" title="沒辦法馬上處理：收進「等待中」，到日期提醒你再回">${IB_ICON.clock} ${cv.status === 'wait' && cv.waitUntil ? cv.waitUntil.slice(5).replace('-', '/') + ' 再回' : '等待'}</button>
      <button class="mini" style="padding:5px 8px;font-size:12.5px;display:flex;gap:4px;align-items:center;${_ibSideTab === 'memo' ? 'background:#eab308;border-color:#eab308;color:#111' : ''}" onclick="ibSide('memo')" title="內部備忘錄（客人看不到）">${IB_ICON.memo} 備忘錄${((cv.memos || []).length + (cv.note ? 1 : 0)) ? ' ' + ((cv.memos || []).length + (cv.note ? 1 : 0)) : ''}</button>
      <button class="mini" style="padding:5px 8px;font-size:12.5px;display:flex;gap:4px;align-items:center;${_ibSideTab === 'ai' ? 'background:#0ea5e9;border-color:#0ea5e9;color:#fff' : ''}" onclick="ibSide('ai')" title="問 AI：看這段對話回答你、幫你擬回覆">${IB_ICON.ai} 問 AI</button>
      <button class="mini" style="padding:5px 8px;font-size:12.5px" onclick="goFromInbox()" title="建團體訂餐單並把點餐連結傳給這個客人（v4.70.78）">點餐單</button>
    </div>
    <div style="flex:1;display:flex;min-height:0"><div id="ibMsgs" style="flex:1;overflow:auto;overscroll-behavior:contain;padding:12px;display:flex;flex-direction:column;gap:8px;min-width:0"><div class="hint">讀取中…</div></div>${_ibSideTab ? `<div id="ibSide" style="${mobile ? 'position:fixed;inset:auto 0 0 0;height:78vh;z-index:70;border-top:1px solid var(--line);border-radius:16px 16px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.35)' : 'width:340px;flex:none;border-left:1px solid var(--line)'};background:var(--bg);display:flex;flex-direction:column;min-height:0"></div>` : ''}</div>
    ${(ibAcct(cv.acct).canReply === false) ? `<div class="hint" style="padding:12px;border-top:1px solid var(--line);font-size:13.5px;text-align:center">你有這個帳號的查看權限，沒有回覆權限。要回覆請主管在收件匣設定勾「可回覆」。</div>` : `<div style="padding:6px 12px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span id="ibMode" class="hint" style="font-size:12px"></span><span style="flex:1"></span><button class="mini" style="padding:4px 8px;font-size:12px;display:flex;gap:4px;align-items:center" onclick="document.getElementById('ibFile').click()" title="傳圖片或檔案（也可以直接把截圖貼到輸入框）">${IB_ICON.clip} 附件</button><input id="ibFile" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" style="display:none" onchange="ibUploadFiles(this.files);this.value=''"><button class="mini" style="padding:4px 8px;font-size:12px;display:flex;gap:4px;align-items:center" onclick="ibTplPick()">${IB_ICON.tpl} 範本</button></div>
    <div style="display:flex;gap:8px;padding:6px 12px 10px;align-items:flex-end">
      <textarea id="ibInput" rows="1" placeholder="回覆客人…" style="flex:1;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;resize:none;max-height:140px;background:var(--card);color:inherit" oninput="this.style.height='auto';this.style.height=Math.min(140,this.scrollHeight)+'px'" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();ibSend()}" onpaste="ibPaste(event)"></textarea>
      <button class="mini on" style="padding:10px 14px;display:flex;align-items:center;gap:4px" onclick="ibSend()">${IB_ICON.send}</button>
    </div>`}`
  if (_ibConv && _ibConv.id === _ibCur) {
    ibRenderMsgs(false); const nb = document.getElementById('ibMsgs'); if (nb) nb.scrollTop = keep.bottom ? nb.scrollHeight : keep.st
    const ni = document.getElementById('ibInput'); if (ni && keep.txt && keep.id === _ibCur) { ni.value = keep.txt; ni.style.height = 'auto'; ni.style.height = Math.min(140, ni.scrollHeight) + 'px' }
  }
  ibModeLine(); ibSideRender()
  try { if (cv.acct === 'gd' && typeof mbInboxBadge === 'function') mbInboxBadge(cv) } catch (_) {} // v4.70.86 會員徽章（點數／入點）
}
function ibModeLine() {
  const m = document.getElementById('ibMode'); if (!m) return
  const q = (_ibConv && _ibConv.quota) || {}
  const quotaTxt = q.used != null ? `本月已用 ${q.used}${q.limit != null ? ' / ' + q.limit : ''} 則` : ''
  const qEl = document.getElementById('ibQuota'); if (qEl) qEl.textContent = quotaTxt
  if (_ibReplyLeft > 0) m.innerHTML = `<span style="color:#16a34a;font-weight:700">免費回覆</span> ${_ibReplyLeft} 秒`
  else m.innerHTML = `<span style="color:#d97706;font-weight:700">會扣額度</span>`
}
function ibRenderMsgs(scroll) {
  const box = document.getElementById('ibMsgs'); if (!box) return
  if (!_ibMsgs.length) { box.innerHTML = '<div class="hint" style="text-align:center;padding:20px">還沒有訊息</div>'; return }
  let lastDay = ''
  box.innerHTML = _ibMsgs.map(m => {
    const day = (() => { try { const d = new Date(m.t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') } catch (_) { return String(m.t || '').slice(0, 10) } })(); let sep = ''
    if (day !== lastDay) { lastDay = day; sep = `<div class="hint" style="text-align:center;font-size:11px;margin:6px 0">${ibEsc(day)}</div>` }
    if (m.dir === 'sys') return sep + `<div class="hint" style="text-align:center;font-size:12px">${ibEsc(m.text)} · ${ibT(m.t)}</div>`
    const out = m.dir === 'out'
    let body = ''
    if (m.type === 'sticker' && m.sticker) body = `<img src="https://stickershop.line-scdn.net/stickershop/v1/sticker/${ibEsc(m.sticker.id)}/android/sticker.png" style="width:110px;height:110px;object-fit:contain" alt="貼圖" onerror="this.outerHTML='（貼圖）'">`
    else if (m.type === 'image' && (m.url || m.ext)) body = `<a href="${ibEsc(m.url || m.ext)}" target="_blank" rel="noopener" style="display:block;line-height:0"><img src="${ibEsc(m.url || m.ext)}" style="max-width:260px;max-height:340px;width:auto;height:auto;border-radius:10px;display:block" alt="圖片"></a>`
    else if (m.type === 'video' && (m.url || m.ext)) body = `<video src="${ibEsc(m.url || m.ext)}" controls style="max-width:260px;border-radius:10px;display:block"></video>`
    else if (m.type === 'audio' && (m.url || m.ext)) body = `<audio src="${ibEsc(m.url || m.ext)}" controls style="max-width:240px"></audio>`
    else if (m.type === 'file') body = (m.url || m.ext) ? `<a href="${ibEsc(m.url || m.ext)}" target="_blank" rel="noopener" style="display:flex;gap:6px;align-items:center;color:inherit">${IB_ICON.file} ${ibEsc(m.fileName || '檔案')}${m.size ? ` <span class="hint" style="font-size:11px">${Math.round(m.size / 1024)} KB</span>` : ''}</a>` : `${IB_ICON.file} ${ibEsc(m.fileName || '檔案')}（沒抓到內容）`
    else if (m.type === 'location' && m.loc) body = `<a href="https://maps.google.com/?q=${m.loc.lat},${m.loc.lng}" target="_blank" rel="noopener" style="display:flex;gap:6px;align-items:center;color:inherit">${IB_ICON.pin} ${ibEsc(m.text || '位置')}</a>`
    else if (['image', 'video', 'audio'].includes(m.type)) body = `（${{ image: '圖片', video: '影片', audio: '語音' }[m.type]}沒抓到內容）`
    else body = ibEsc(m.text || '')
    return sep + `<div style="display:flex;flex-direction:column;align-items:${out ? 'flex-end' : 'flex-start'};max-width:100%">
      ${out ? `<div class="hint" style="font-size:11.5px;margin:0 6px 2px 0">${ibEsc(m.by || '')}${m.mode === 'push' ? ' · 推播' : ''}</div>` : ''}
      <div style="max-width:78%;${(['image', 'video'].includes(m.type) && (m.url || m.ext)) ? `width:fit-content;padding:3px;background:transparent;border:2px solid ${out ? '#2563eb' : 'var(--line)'}` : `background:${out ? '#2563eb' : 'var(--card)'};color:${out ? '#fff' : 'inherit'};border:1px solid ${out ? '#2563eb' : 'var(--line)'};padding:8px 12px`};border-radius:${out ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};font-size:15px;white-space:pre-wrap;word-break:break-word">${body}</div>
      <div class="hint" style="font-size:10.5px;margin:2px 6px 0">${ibT(m.t)}</div></div>`
  }).join('')
  if (scroll !== false) box.scrollTop = box.scrollHeight
}
async function ibOpen(id, keep) {
  _ibCur = id; _ibMsgs = []; _ibConv = null
  if (!keep) { const c = ((_ibD && _ibD.convs) || []).find(x => x.id === id); if (c) c.unread = 0 }
  if (window.innerWidth < 760) { const l = document.getElementById('ibList'), p = document.getElementById('ibPane'); if (l) l.style.display = 'none'; if (p) p.style.display = 'flex' } else ibRenderList()
  ibRenderPane()
  const d = await ibGet('op=conv&id=' + encodeURIComponent(id) + '&read=1')
  if (!d || !d.ok) { const box = document.getElementById('ibMsgs'); if (box) box.innerHTML = '<div class="err">' + ibEsc((d && d.error) || '讀不到對話') + '</div>'; return }
  _ibConv = d.conv; _ibConv.quota = d.quota; _ibMsgs = d.list || []; _ibReplyLeft = d.replyLeft || 0
  ibRenderPane(); ibRenderMsgs(); ibRenderList()
  if (_ibTimer) clearInterval(_ibTimer); if (_ibTick) clearInterval(_ibTick)
  _ibTimer = setInterval(ibPoll, 6000)
  _ibTick = setInterval(() => { if (_ibReplyLeft > 0) { _ibReplyLeft--; ibModeLine() } }, 1000)
  try { history.replaceState(null, '', '#inbox=' + encodeURIComponent(id)) } catch (_) {}
}
async function ibPoll() {
  if (curStore !== 'inbox' || !_ibCur) return ibStop()
  const d = await ibGet('op=conv&id=' + encodeURIComponent(_ibCur) + '&read=1')
  if (!d || !d.ok) return
  const have = new Set(_ibMsgs.map(m => m.id)); const add = (d.list || []).filter(m => !have.has(m.id))
  if (add.length) { _ibMsgs.push(...add); ibRenderMsgs() }
  if (d.replyLeft > _ibReplyLeft) _ibReplyLeft = d.replyLeft
  if (_ibConv) { _ibConv.quota = d.quota; _ibConv.status = d.conv.status; _ibConv.assignee = d.conv.assignee }
  ibModeLine()
}
function ibBack() { _ibCur = null; _ibConv = null; ibStop(); _ibListTimer = setInterval(async () => { if (curStore !== 'inbox') return ibStop(); const d2 = await ibGet('op=list'); ibVerCheck(d2); if (d2 && d2.ok) { _ibD = d2; ibRenderList() } }, 20000); ibRender(); try { history.replaceState(null, '', '#inbox') } catch (_) {} }
async function ibSend() {
  const ta = document.getElementById('ibInput'); if (!ta || _ibBusy) return
  const text = ta.value.trim(); if (!text) return
  _ibBusy = true; ta.value = ''; ta.style.height = 'auto'
  const tmp = { id: 'tmp' + Date.now(), dir: 'out', type: 'text', text, by: (_ibD.me || {}).name, t: new Date().toISOString() }
  _ibMsgs.push(tmp); ibRenderMsgs()
  const d = await ibPost({ op: 'send', id: _ibCur, text })
  _ibBusy = false
  if (!d || !d.ok) { _ibMsgs = _ibMsgs.filter(m => m.id !== tmp.id); ibRenderMsgs(); ta.value = text; libToast((d && d.error) || '送出失敗，再試一次', true); return }
  const i = _ibMsgs.findIndex(m => m.id === tmp.id); if (i >= 0) _ibMsgs[i] = d.msg
  _ibReplyLeft = 0; ibApplyConv(d.conv)
  ibRenderMsgs(); ibModeLine()
  libToast(d.mode === 'reply' ? '已回覆（免費）' : '已推播（扣 1 則）')
  const c = ((_ibD && _ibD.convs) || []).find(x => x.id === _ibCur); if (c) { c.last = { text: text.slice(0, 60), dir: 'out', t: d.msg.t }; c.lastT = d.msg.t; c.status = d.conv.status; c.assignee = d.conv.assignee; ibRenderList() }
  ta.focus()
}
// 狀態用兩顆按鈕直接按（張良 10-11「不用選單，不然忘記按我就會收到通知」）：亮的＝目前狀態；都不亮＝新
function ibStBtns(st) { return ['open', 'done'].map(k => `<button class="mini" style="padding:5px 10px;font-size:12.5px;font-weight:700;${st === k ? `background:${IB_STC[k]};border-color:${IB_STC[k]};color:#fff` : ''}" onclick="ibOp('status','${k}')" title="${k === 'done' ? '已處理好（不用傳訊息也能按，例如已經打電話處理）；客人再傳訊息會自動回到待處理' : '處理中'}">${IB_ST[k]}</button>`).join('') }
function ibApplyConv(c) { // 回覆後對話狀態變了→表頭的下拉與清單一起更新（v4.70.49 修：之前表頭還停在「新」）
  if (!c) return
  if (_ibConv) { _ibConv.status = c.status; _ibConv.assignee = c.assignee; for (const k of ['star', 'waitUntil', 'memos', 'cat', 'catBy', 'phone', 'email', 'company', 'tags']) if (k in c) _ibConv[k] = c[k] }
  const sb = document.getElementById('ibStBtns'); if (sb) sb.innerHTML = ibStBtns(c.status || 'new'); const as = document.getElementById('ibAssign'); if (as) as.value = c.assignee || ''
  const r = ((_ibD && _ibD.convs) || []).find(x => x.id === _ibCur); if (r) { r.status = c.status; r.assignee = c.assignee; if ('star' in c) r.star = c.star; if ('waitUntil' in c) r.waitUntil = c.waitUntil; if ('cat' in c) { r.cat = c.cat; r.catBy = c.catBy }; if ('memos' in c) r.memoN = (c.memos || []).length + (c.note ? 1 : 0) }
}
function ibPaste(ev) {
  const files = [...((ev.clipboardData || {}).files || [])]
  if (!files.length) return
  ev.preventDefault(); ibUploadFiles(files)
}
function ibShrinkImage(file) { // 截圖常常 3～8MB：縮到長邊 1600、JPEG 0.85（LINE 圖片訊息只收 JPEG/PNG，預覽圖上限 1MB）
  return new Promise(res => {
    const img = new Image(); const u = URL.createObjectURL(file)
    img.onload = () => { try { const M = 1600; let w = img.width, h = img.height; if (Math.max(w, h) > M) { const k = M / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k) } const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', 0.85)) } catch (_) { res(null) } }
    img.onerror = () => { URL.revokeObjectURL(u); res(null) }
    img.src = u
  })
}
async function ibUploadFiles(files) {
  files = [...(files || [])]; if (!files.length || !_ibCur) return
  for (const f of files) {
    const isImg = /^image\//.test(f.type)
    if (!isImg && f.size > 10 * 1024 * 1024) { libToast(f.name + ' 太大（上限 10MB）', true); continue }
    const tmp = { id: 'tmp' + Date.now() + Math.random(), dir: 'out', type: 'sys', text: (isImg ? '圖片' : f.name) + ' 上傳中…', t: new Date().toISOString() }
    _ibMsgs.push(tmp); ibRenderMsgs()
    let dataUrl = isImg ? await ibShrinkImage(f) : null
    if (!dataUrl) dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(f) })
    const d = dataUrl ? await ibPost({ op: 'sendfile', id: _ibCur, dataUrl, name: f.name }) : null
    _ibMsgs = _ibMsgs.filter(m => m.id !== tmp.id)
    if (!d || !d.ok) { ibRenderMsgs(); libToast((d && d.error) || '上傳失敗', true); continue }
    _ibMsgs.push(d.msg); _ibReplyLeft = 0; ibApplyConv(d.conv); ibRenderMsgs(); ibModeLine()
    libToast(d.mode === 'reply' ? '已傳送（免費）' : '已傳送（推播，扣 1 則）')
    const c = ((_ibD && _ibD.convs) || []).find(x => x.id === _ibCur); if (c) { c.last = { text: isImg ? '（圖片）' : '（檔案）' + f.name, dir: 'out', t: d.msg.t }; c.lastT = d.msg.t; ibRenderList() }
  }
  // 剛送出的圖要簽名網址才看得到：重撈一次對話
  const d2 = await ibGet('op=conv&id=' + encodeURIComponent(_ibCur)); if (d2 && d2.ok) { _ibMsgs = d2.list || _ibMsgs; ibRenderMsgs() }
}
async function ibOp(op, value) {
  const d = await ibPost({ op, id: _ibCur, value })
  if (!d || !d.ok) { libToast((d && d.error) || '沒存到', true); return }
  if (_ibConv) Object.assign(_ibConv, d.conv)
  ibApplyConv(d.conv)
  ibRenderList(); if (op !== 'status' && op !== 'assign') ibRenderPane() // 訊息與打到一半的字由 ibRenderPane 自己放回
  if (op !== 'memo' && op !== 'memodel') libToast(op === 'star' ? (value ? '已標「特別注意」' : '已取消特別注意') : op === 'wait' ? (value ? '已收進「等待中」' : '已取消等待') : op === 'cat' ? (value ? '分類：' + value : '已清除分類') : '已更新')
}
function ibModal(inner) {
  const ov = document.createElement('div'); ov.id = 'ibOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,22,.6);z-index:80;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.onclick = () => ov.remove()
  ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--bg);border:1px solid var(--line);border-radius:16px;width:100%;max-width:560px;max-height:90vh;overflow:auto;padding:16px">${inner}</div>`
  document.body.appendChild(ov); return ov
}
function ibNote() {
  const cv = _ibConv || {}
  ibModal(`<b style="font-size:16px">內部備註</b><div class="hint" style="font-size:12px">只有同事看得到，客人看不到。也可以幫這位客人取個備註名。</div>
    <input id="ibAlias" value="${ibEsc(cv.alias || '')}" placeholder="備註名（例：常客王小姐、10/20 訂位）" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:15px;margin-top:10px;background:var(--card);color:inherit">
    <textarea id="ibNoteTa" rows="5" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:15px;margin-top:8px;background:var(--card);color:inherit;font-family:inherit">${ibEsc(cv.note || '')}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="document.getElementById('ibOv').remove()">取消</button><button class="mini on" onclick="ibNoteSave()">儲存</button></div>`)
}
async function ibNoteSave() {
  const note = (document.getElementById('ibNoteTa') || {}).value || '', alias = (document.getElementById('ibAlias') || {}).value || ''
  const d1 = await ibPost({ op: 'note', id: _ibCur, value: note }); const d2 = await ibPost({ op: 'rename', id: _ibCur, value: alias })
  if (!d1 || !d1.ok || !d2 || !d2.ok) { libToast('沒存到', true); return }
  if (_ibConv) { _ibConv.note = note; _ibConv.alias = alias }
  document.getElementById('ibOv').remove(); ibRenderPane(); ibRenderMsgs(false); libToast('已儲存')
}
function ibTplPick() {
  const tp = (_ibD && _ibD.templates) || []
  if (!tp.length) { libToast((_ibD.me || {}).mgr ? '還沒有範本，到右上齒輪「設定」新增' : '還沒有範本，請主管在設定裡新增', true); return }
  ibModal(`<b style="font-size:16px">常用回覆</b>${tp.map((t, i) => `<div onclick="ibTplUse(${i})" style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px;cursor:pointer"><b style="font-size:14px">${ibEsc(t.title || '範本 ' + (i + 1))}</b><div class="hint" style="font-size:13px;white-space:pre-wrap">${ibEsc(t.text)}</div></div>`).join('')}`)
}
function ibTplUse(i) { const t = ((_ibD && _ibD.templates) || [])[i]; const ta = document.getElementById('ibInput'); if (t && ta) { ta.value = (ta.value ? ta.value + '\n' : '') + t.text; ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; ta.focus() } const ov = document.getElementById('ibOv'); if (ov) ov.remove() }

// ── 設定（主管）：帳號連線／權限／範本／提醒 ──
let _ibSet = null
async function ibSettings() {
  const ov = ibModal('<b style="font-size:16px">收件匣設定</b><div class="hint" style="margin-top:8px">讀取中…</div>')
  const d = await ibGet('op=settings'); if (!d || !d.ok) { ov.querySelector('.hint').textContent = (d && d.error) || '讀不到設定'; return }
  _ibSet = d; ibSetRender()
}
const ibSec = (t, col, mt) => `<div style="margin:${mt || 16}px 0 0;padding:8px 12px;border-radius:10px;background:${col}22;border-left:5px solid ${col};font-size:15px;font-weight:800;color:${col}">${t}</div>` // v4.71.9 區段標題整條色塊（張良 2026-10-13）
const ibAcctHead = (a) => `<div style="margin:-10px -12px 6px;padding:7px 12px;border-radius:11px 11px 0 0;background:${a.color};color:#fff;font-size:14px;font-weight:800">${ibEsc(a.name)}</div>` // 每個帳號框的標題列＝帳號色底白字
function ibSetRender() {
  const d = _ibSet; const ov = document.getElementById('ibOv'); if (!ov || !d) return
  const box = ov.firstElementChild
  const acc = (d.accounts || []).map(a => {
    const st = a.relay ? (a.hookOk ? '<span style="color:#16a34a;font-weight:700">DD 自己接・私訊自動進收件匣</span>' : '<span style="color:#d97706;font-weight:700">DD 的 webhook 沒指在正式站</span>') : !a.configured ? '<span style="color:#d97706;font-weight:700">未設金鑰</span>' : a.hookOk ? '<span style="color:#16a34a;font-weight:700">已接上</span>' : (a.hook && a.hook.endpoint) ? `<span style="color:#d97706;font-weight:700">webhook 指到別處</span>` : '<span style="color:#d97706;font-weight:700">webhook 未設</span>'
    const info = a.info && !a.info.error ? `${ibEsc(a.info.displayName || '')} ${a.info.basicId ? '(' + ibEsc(a.info.basicId) + ')' : ''} · 模式 ${a.info.chatMode === 'bot' ? '機器人' : '聊天'}` : (a.configured ? '金鑰無效或讀不到帳號資訊' : '')
    const q = a.quota && a.quota.used != null ? `本月 ${a.quota.used}${a.quota.limit != null ? ' / ' + a.quota.limit : ''} 則` : ''
    return `<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-top:8px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-10px -12px 6px;padding:7px 12px;border-radius:11px 11px 0 0;background:${a.color}22;border-bottom:1px solid ${a.color}55"><b style="background:${a.color};color:#fff;padding:2px 10px;border-radius:999px">${ibEsc(a.name)}</b>${st}<span style="flex:1"></span>${a.configured && !a.hookOk && !a.relay ? `<button class="mini on" style="padding:5px 10px;font-size:12.5px" onclick="ibConnect('${a.key}',false)">接到收件匣</button>` : ''}${a.configured && a.hookOk && !a.relay ? `<button class="mini" style="padding:5px 10px;font-size:12.5px" onclick="ibConnect('${a.key}',false)">重測</button>` : ''}</div>
      ${a.relay ? '<div class="hint" style="font-size:12px">只收 DD 的一對一私訊（群組不收）。DD 自己答過的對話直接算「已完成」、不推播不提醒；你要插手就在那個對話直接回，會用 DD 的名義發出。</div>' : ''}
      <div class="hint" style="font-size:12.5px;margin-top:4px">${info}${q ? ' · ' + q : ''}${a.lastEventT ? ' · 最近收到 ' + ibT(a.lastEventT) : ''}</div>
      ${a.hook && a.hook.endpoint && !a.hookOk ? `<div class="hint" style="font-size:12px;word-break:break-all">目前 webhook：${ibEsc(a.hook.endpoint)}${a.hook.active === false ? '（未啟用）' : ''}</div>` : ''}
      ${!a.configured ? `<div class="hint" style="font-size:12px">要給 CC 的環境變數：${a.envSecret}、${a.envToken}</div>` : ''}
      ${a.forwardSet ? `<div class="hint" style="font-size:12px;word-break:break-all">同時轉發給原本的系統：${ibEsc(a.forward)}${a.lastFwd ? (a.lastFwd.ok ? ' · 最近轉發成功 ' + ibT(a.lastFwd.t) : ' · <span style="color:#d97706">最近轉發失敗 ' + ibEsc(a.lastFwd.err || a.lastFwd.status) + '</span>') : ''} <button class="mini" style="padding:2px 8px;font-size:11.5px" onclick="ibForwardStop('${a.key}')">停止轉發</button></div>` : ''}
    </div>`
  }).join('')
  const people = d.people || []
  const perm = (d.cfg && d.cfg.perm) || {}
  const reply = (d.cfg && d.cfg.reply) || {}
  // 名單依 AB／GD × 正職／PT 分組（張良 10-11），每組一個「全選」
  const info = (d.peopleInfo && d.peopleInfo.length) ? d.peopleInfo : people.map(n => ({ name: n, co: '', title: '' }))
  const GROUPS = [['GD', '正職', 'GROUN:D 正職'], ['GD', 'PT', 'GROUN:D PT'], ['AB', '正職', 'A Beach 正職'], ['AB', 'PT', 'A Beach PT'], ['', '', '其他（名冊沒標店別或職別）']]
  const grid = (cls, a, sel) => GROUPS.map(([co, ti, label]) => {
    const ps = info.filter(p => (co ? (p.co === co && (ti ? p.title === ti : true)) : !(p.co && p.title)))
    if (!ps.length) return ''
    const gid = cls + '_' + a.key + '_' + co + ti
    return `<div style="margin-top:6px"><div style="display:flex;align-items:center;gap:8px"><span class="hint" style="font-size:12px;font-weight:700">${label}</span><label class="hint" style="font-size:11.5px;display:flex;gap:3px;align-items:center;cursor:pointer"><input type="checkbox" onchange="document.querySelectorAll('.${gid}').forEach(x=>x.checked=this.checked)">全選</label></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:2px">${ps.map(p => `<label style="display:flex;gap:4px;align-items:center;font-size:13.5px"><input type="checkbox" class="${cls} ${gid}" data-acct="${a.key}" value="${ibEsc(p.name)}"${(sel || []).includes(p.name) ? ' checked' : ''}>${ibEsc(p.name)}</label>`).join('')}</div></div>`
  }).join('')
  const permHtml = (d.accounts || []).map(a => `<div style="margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px">${ibAcctHead(a)}
      <div style="margin-top:6px"><b style="font-size:13px">看得到</b><span class="hint" style="font-size:11.5px">　主管永遠看得到；勾的人看得到並收到通知</span>${grid('ibPerm', a, perm[a.key])}</div>
      <div style="margin-top:10px"><b style="font-size:13px">可回覆</b><span class="hint" style="font-size:11.5px">　主管永遠可回；勾的人才能回覆、傳圖（要同時有「看得到」）</span>${grid('ibReply', a, reply[a.key])}</div>
    </div>`).join('')
  const tpl = (d.cfg && d.cfg.templates) || []
  const tplHtml = `<div id="ibTplList">${tpl.map((t, i) => ibTplRow(t, i)).join('')}</div><button class="mini" style="margin-top:6px;padding:5px 10px;font-size:12.5px" onclick="ibTplAdd()">＋ 新增範本</button>`
  box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><b style="font-size:16px;flex:1">收件匣設定</b><button class="mini" onclick="document.getElementById('ibOv').remove()">關閉</button></div>
    <div class="hint" style="font-size:12px;margin-top:6px">驗簽失敗 ${(d.sigfail || {}).n || 0} 次${(d.sigfail || {}).lastT ? '（最近 ' + ibT(d.sigfail.lastT) + '）' : ''} · 官方帳號（A Beach／GROUN:D／104招募）webhook 都填同一個網址：<span style="word-break:break-all">${ibEsc(((d.accounts || [])[0] || {}).wantHook || '')}</span></div>
    ${ibSec('帳號連線', '#2563eb', 14)}${acc}
    ${ibSec('誰看得到哪個帳號', '#7c3aed')}${permHtml}
    ${ibSec('對話分類', '#0ea5e9')}<div class="hint" style="font-size:12px;margin-top:6px">新訊息會先用關鍵字猜分類，猜不到每小時由 AI 補；人改過的不會再被自動改。可以增刪改、拖順序用上下鍵。</div><div id="ibCatList" style="margin-top:6px">${((d.cfg && d.cfg.cats) || []).map(ibCatRow).join('')}</div><button class="mini" style="margin-top:6px;padding:5px 10px;font-size:12.5px" onclick="document.getElementById('ibCatList').insertAdjacentHTML('beforeend', ibCatRow(''))">＋ 新增分類</button>
    ${ibSec('常用回覆範本', '#0d9488')}${tplHtml}
    ${ibSec('沒人回覆提醒', '#d97706')}<div style="display:flex;gap:8px;align-items:center;font-size:14px;flex-wrap:wrap;margin-top:8px">① 超過 <input id="ibRemind" type="number" min="5" max="1440" value="${(d.cfg && d.cfg.remindMin) || 30}" style="width:70px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit"> 分鐘沒回 → 私訊「通知誰」勾的人</div><div style="display:flex;gap:8px;align-items:center;font-size:14px;flex-wrap:wrap;margin-top:6px">② 超過 <input id="ibEscH" type="number" min="1" max="168" value="${(d.cfg && d.cfg.escalateH) || 24}" style="width:70px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit"> 小時還沒回 → 才發到下面選的 LINE 群</div><div style="display:flex;gap:8px;align-items:center;font-size:14px;flex-wrap:wrap;margin-top:6px">③ 安靜時段 <label style="display:flex;gap:4px;align-items:center"><input id="ibQOn" type="checkbox"${(d.cfg && d.cfg.quiet) ? ' checked' : ''}>開</label><select id="ibQFrom" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${((d.cfg && d.cfg.quiet) || { from: 21 }).from === h ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select> 到隔天 <select id="ibQTo" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${((d.cfg && d.cfg.quiet) || { to: 12 }).to === h ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select> 不提醒（結束後第一輪合併一起發）</div><div class="hint" style="font-size:12px;margin-top:4px">每小時檢查一次；同一輪所有沒回的客人<b>合併成一則</b>（群組照群內人數扣額度，所以只發一則）</div>
    ${(d.accounts || []).map(a => { const rc = ((d.cfg && d.cfg.remind) || {})[a.key] || {}; return `<div style="margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px">${ibAcctHead(a)}
      <div style="margin-top:6px"><b style="font-size:13px">通知誰</b><span class="hint" style="font-size:11.5px">　①私訊誰；沒勾＝可回覆的人＋審核人</span>${grid('ibRemind', a, rc.people || [])}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:13px">②超過時數發群</b><select class="ibRemindGrp" data-acct="${a.key}" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;font-size:13px;max-width:260px"><option value="">不發群組</option>${(d.groups || []).map(g => `<option value="${ibEsc(g.gid)}"${rc.group === g.gid ? ' selected' : ''}>${ibEsc(g.name)}</option>`).join('')}</select><span class="hint" style="font-size:11.5px">由 DD 發；一輪一則，按群內人數扣 DD 額度</span></div>
    </div>` }).join('')}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="mini on" onclick="ibSetSave()">儲存設定</button></div>`
}
function ibTplRow(t, i) { return `<div class="ibTpl" style="display:flex;gap:6px;margin-top:6px;align-items:flex-start"><input class="ibTplTitle" value="${ibEsc(t.title || '')}" placeholder="標題" style="width:110px;border:1px solid var(--line);border-radius:8px;padding:7px;background:var(--card);color:inherit;font-size:13px"><textarea class="ibTplText" rows="2" placeholder="內容" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px;background:var(--card);color:inherit;font-size:13px;font-family:inherit">${ibEsc(t.text || '')}</textarea><button class="mini" style="padding:5px 8px" onclick="this.parentNode.remove()">刪</button></div>` }
function ibTplAdd() { const l = document.getElementById('ibTplList'); if (l) l.insertAdjacentHTML('beforeend', ibTplRow({}, 0)) }
async function ibSetSave() {
  const perm = {}; document.querySelectorAll('#ibOv .ibPerm:checked').forEach(x => { (perm[x.dataset.acct] = perm[x.dataset.acct] || []).push(x.value) })
  const reply = {}; document.querySelectorAll('#ibOv .ibReply:checked').forEach(x => { (reply[x.dataset.acct] = reply[x.dataset.acct] || []).push(x.value) })
  for (const a of (_ibSet.accounts || [])) { perm[a.key] = perm[a.key] || []; reply[a.key] = reply[a.key] || [] }
  const templates = [...document.querySelectorAll('#ibOv .ibTpl')].map(r => ({ title: r.querySelector('.ibTplTitle').value, text: r.querySelector('.ibTplText').value })).filter(t => t.text.trim())
  const remindMin = +((document.getElementById('ibRemind') || {}).value || 30)
  const remind = {}; for (const a of (_ibSet.accounts || [])) { remind[a.key] = { people: [...document.querySelectorAll(`#ibOv .ibRemind[data-acct="${a.key}"]:checked`)].map(x => x.value), group: ((document.querySelector(`#ibOv .ibRemindGrp[data-acct="${a.key}"]`) || {}).value) || '' } }
  const escalateH = +((document.getElementById('ibEscH') || {}).value || 24)
  const cats = [...document.querySelectorAll('#ibOv .ibCatIn')].map(x => x.value.trim()).filter(Boolean)
  const quiet = (document.getElementById('ibQOn') || {}).checked ? { from: +document.getElementById('ibQFrom').value, to: +document.getElementById('ibQTo').value } : null
  const d = await ibPost({ op: 'cfg', cfg: { perm, reply, remind, templates, remindMin, escalateH, cats, quiet } })
  if (!d || !d.ok) { libToast((d && d.error) || '沒存到', true); return }
  libToast('設定已儲存'); document.getElementById('ibOv').remove()
  const d2 = await ibGet('op=list'); if (d2 && d2.ok) { _ibD = d2; ibRenderList() }
}
async function ibConnect(key, force) {
  const d = await ibPost({ op: 'connect', acct: key, force })
  if (d && d.needConfirm) { if (confirm(d.error)) return ibConnect(key, true); return }
  if (!d || !d.ok) { libToast((d && d.error) || '接不上', true); return }
  const t = d.test || {}
  libToast((t.success ? '已接上，LINE 測試通過' : '已設定，但 LINE 測試回：' + (t.reason || t.detail || JSON.stringify(t)).slice(0, 80)) + (d.forwarding ? '；原本的系統改成轉發' : ''), !t.success)
  const d2 = await ibGet('op=settings'); if (d2 && d2.ok) { _ibSet = d2; ibSetRender() }
}
async function ibForwardStop(key) {
  if (!confirm('停止轉發後，原本接著這個帳號的系統就收不到訊息了。確定？')) return
  const d = await ibPost({ op: 'cfg', cfg: { forward: { [key]: '' } } }); if (!d || !d.ok) { libToast((d && d.error) || '沒存到', true); return }
  libToast('已停止轉發'); const d2 = await ibGet('op=settings'); if (d2 && d2.ok) { _ibSet = d2; ibSetRender() }
}
window.addEventListener('resize', () => { if (curStore === 'inbox' && _ibD) { ibRender(); if (_ibCur) ibRenderMsgs(false) } })
window.addEventListener('orientationchange', () => setTimeout(() => { if (curStore === 'inbox') paneFit('ibWrap'); if (curStore === 'chat') paneFit('chWrap') }, 300))

// ── v4.71.11 等待中／備忘錄／問 AI（張良 2026-10-14「有些客戶要特別注意、沒辦法及時完成→收進資料夾等未來回覆避免忘記；也要備忘錄跟 AI 對話框」）──
function ibDay(n) { const d = new Date(Date.now() + 8 * 3600e3 + n * 864e5); return d.toISOString().slice(0, 10) }
function ibWait() {
  const cv = _ibConv || {}
  const q = [[1, '明天'], [3, '3 天後'], [7, '一週後'], [14, '兩週後']]
  ibModal(`<b style="font-size:16px">收進「等待中」</b><div class="hint" style="font-size:12.5px;margin-top:4px">沒辦法馬上回的客人先收著；到了日期會在收件匣提醒裡通知你，並自動放回「處理中」。客人中途又傳訊息會直接回到待處理。</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${q.map(([n, l]) => `<button class="mini" style="padding:8px 12px" onclick="document.getElementById('ibWaitD').value='${ibDay(n)}'">${l}<span class="hint" style="font-size:11px;margin-left:4px">${ibDay(n).slice(5).replace('-', '/')}</span></button>`).join('')}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:14px">提醒日期 <input id="ibWaitD" type="date" value="${cv.waitUntil || ibDay(3)}" min="${ibDay(0)}" style="border:1px solid var(--line);border-radius:8px;padding:7px 8px;background:var(--card);color:inherit"></div>
    <textarea id="ibWaitM" rows="2" placeholder="在等什麼？（選填，會記進備忘錄，例：等阿桑確認尾牙報價）" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:14.5px;margin-top:10px;background:var(--card);color:inherit;font-family:inherit"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${cv.status === 'wait' ? '<button class="mini" onclick="ibWaitSave(1)">取消等待</button><span style="flex:1"></span>' : ''}<button class="mini" onclick="document.getElementById('ibOv').remove()">取消</button><button class="mini on" style="background:#7c3aed;border-color:#7c3aed" onclick="ibWaitSave()">收進等待中</button></div>`)
}
async function ibWaitSave(cancel) {
  const d = cancel ? '' : ((document.getElementById('ibWaitD') || {}).value || ''), m = ((document.getElementById('ibWaitM') || {}).value || '').trim()
  if (!cancel && !d) { libToast('請選日期', true); return }
  document.getElementById('ibOv').remove()
  if (m) await ibOp('memo', '［等待］' + m)
  await ibOp('wait', d)
}
function ibSide(tab) { _ibSideTab = _ibSideTab === tab ? '' : tab; ibRenderPane(); ibRenderMsgs(false) }
function ibSideRender() {
  const el = document.getElementById('ibSide'); if (!el) return
  const cv = _ibConv || {}
  const head = (t, col) => `<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:${col}22;border-bottom:2px solid ${col}"><b style="flex:1;font-size:14.5px;color:${col}">${t}</b><button class="mini" style="padding:3px 9px;font-size:12px" onclick="ibSide('${_ibSideTab}')">關閉</button></div>`
  if (_ibSideTab === 'memo') {
    const items = [...(cv.note ? [{ id: '__note', by: '', t: '', text: cv.note }] : []), ...(cv.memos || [])].reverse()
    el.innerHTML = head('備忘錄（只有同事看得到）', '#eab308') + `
      <div style="padding:10px 12px;border-bottom:1px solid var(--line);display:flex;gap:6px;align-items:center"><span class="hint" style="font-size:12px;flex:none">備註名</span><input id="ibAliasIn" value="${ibEsc(cv.alias || '')}" placeholder="例：尾牙 110 人 王小姐" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:13.5px;background:var(--card);color:inherit"><button class="mini" style="padding:5px 9px;font-size:12px" onclick="ibAliasSave()">存</button></div>
      <div style="flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px">${items.length ? items.map(m => `<div style="background:#eab30818;border:1px solid #eab30855;border-radius:10px;padding:8px 10px"><div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${ibEsc(m.text)}</div><div class="hint" style="font-size:11px;margin-top:4px;display:flex;gap:6px">${m.id === '__note' ? '舊備註' : ibEsc(m.by) + ' · ' + ibT(m.t)}<span style="flex:1"></span><a href="javascript:void 0" style="color:#ef4444" onclick="ibMemoDel('${m.id}')">刪除</a></div></div>`).join('') : '<div class="hint" style="text-align:center;padding:20px 0;font-size:13px">還沒有備忘錄。記下這位客人的重點（人數、日期、在等什麼、注意事項），之後誰接手都看得到。</div>'}</div>
      <div style="padding:8px 12px 12px;border-top:1px solid var(--line)"><textarea id="ibMemoIn" rows="3" placeholder="新增備忘…" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:14px;background:var(--card);color:inherit;font-family:inherit;resize:vertical"></textarea><div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="mini on" style="background:#eab308;border-color:#eab308;color:#111" onclick="ibMemoAdd()">新增備忘</button></div></div>`
  } else if (_ibSideTab === 'cust') {
    el.innerHTML = head('客戶資料', '#16a34a') + '<div id="ibCustBox" style="flex:1;overflow:auto;padding:10px 12px"><div class="hint">讀取中…</div></div>'
    ibCustLoad()
  } else if (_ibSideTab === 'ai') {
    const h = _ibAiHist[_ibCur] || []
    const chips = ['幫我擬一段回覆', '這位客人要什麼？還有什麼沒回答到', '回覆前我要先跟店裡確認哪些事']
    el.innerHTML = head('問 AI', '#0ea5e9') + `<div style="padding:6px 12px;border-bottom:1px solid var(--line)">${typeof aiTag === 'function' ? aiTag('inbox') : ''}<span class="hint" style="font-size:11.5px;margin-left:6px">會看這段對話＋備忘錄；草稿不會自動發出</span></div>
      <div id="ibAiBox" style="flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px">${h.length ? h.map((m, i) => m.role === 'me' ? `<div style="align-self:flex-end;max-width:88%;background:#0ea5e9;color:#fff;border-radius:12px;padding:7px 10px;font-size:14px;white-space:pre-wrap">${ibEsc(m.text)}</div>` : `<div style="max-width:94%;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px;font-size:14px;white-space:pre-wrap;line-height:1.55">${ibEsc(m.text || '')}${m.draft ? `<div style="margin-top:8px;border:1px solid #0ea5e9;border-radius:10px;padding:8px 10px;background:#0ea5e914"><div class="hint" style="font-size:11px;font-weight:700;color:#0ea5e9">回覆草稿</div><div style="white-space:pre-wrap;margin-top:3px">${ibEsc(m.draft)}</div><div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="mini on" style="padding:4px 10px;font-size:12.5px;background:#0ea5e9;border-color:#0ea5e9" onclick="ibAiUse(${i})">放進回覆框</button></div></div>` : ''}</div>`).join('') : `<div class="hint" style="font-size:13px;padding:6px 0">可以直接問，例如「他問的雲端發票怎麼補登？幫我擬回覆」。</div><div style="display:flex;flex-direction:column;gap:6px">${chips.map(c => `<button class="mini" style="text-align:left;padding:7px 10px;font-size:13px" onclick="ibAiAsk(${JSON.stringify(c).replace(/"/g, '&quot;')})">${c}</button>`).join('')}</div>`}<div id="ibAiWait"></div></div>
      <div style="display:flex;gap:6px;padding:8px 12px 12px;border-top:1px solid var(--line);align-items:flex-end"><textarea id="ibAiIn" rows="2" placeholder="問 AI…（Enter 送出）" style="flex:1;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:14px;background:var(--card);color:inherit;font-family:inherit;resize:none" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();ibAiAsk()}"></textarea><button class="mini on" style="padding:8px 12px;background:#0ea5e9;border-color:#0ea5e9" onclick="ibAiAsk()">${IB_ICON.send}</button></div>`
    const b = document.getElementById('ibAiBox'); if (b) b.scrollTop = b.scrollHeight
  }
}
async function ibMemoAdd() { const ta = document.getElementById('ibMemoIn'); const v = ((ta || {}).value || '').trim(); if (!v) return; await ibOp('memo', v) }
async function ibMemoDel(id) { if (!confirm('刪除這則備忘？')) return; if (id === '__note') { const d = await ibPost({ op: 'note', id: _ibCur, value: '' }); if (d && d.ok) { _ibConv.note = ''; ibRenderPane(); ibRenderMsgs(false) } return } await ibOp('memodel', id) }
async function ibAliasSave() { const v = ((document.getElementById('ibAliasIn') || {}).value || '').trim(); const d = await ibPost({ op: 'rename', id: _ibCur, value: v }); if (!d || !d.ok) { libToast('沒存到', true); return } _ibConv.alias = v; const r = ((_ibD && _ibD.convs) || []).find(x => x.id === _ibCur); if (r) r.alias = v; ibRenderList(); ibRenderPane(); ibRenderMsgs(false); libToast('已儲存') }
let _ibAiBusy = false
async function ibAiAsk(q) {
  const ta = document.getElementById('ibAiIn'); q = String(q || (ta && ta.value) || '').trim(); if (!q || _ibAiBusy) return
  const id = _ibCur; const h = _ibAiHist[id] = _ibAiHist[id] || []
  h.push({ role: 'me', text: q }); _ibAiBusy = true; ibSideRender()
  const w = document.getElementById('ibAiWait'); if (w) w.innerHTML = '<div class="hint" style="font-size:13px">AI 想一下…</div>'
  const d = await ibPost({ op: 'ai', id, q, hist: h.slice(0, -1).map(m => ({ role: m.role === 'me' ? 'me' : 'ai', text: (m.text || '') + (m.draft ? '\n【回覆草稿】' + m.draft + '【/回覆草稿】' : '') })) })
  _ibAiBusy = false
  h.push(d && d.ok ? { role: 'ai', text: d.text || (d.draft ? '' : '（沒有內容）'), draft: d.draft || '' } : { role: 'ai', text: (d && d.error) || 'AI 沒回應，再試一次' })
  if (_ibCur === id) ibSideRender()
}
function ibAiUse(i) { const m = (_ibAiHist[_ibCur] || [])[i]; const ta = document.getElementById('ibInput'); if (!m || !m.draft || !ta) return; ta.value = m.draft; ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; ta.focus(); libToast('已放進回覆框，確認後按送出') }

// ── v4.71.12 對話分類（設定頁可增刪改排序）＋客戶資料側欄（張良 2026-10-14「merge＋A」參考小夏 EM 客戶回覆頁）──
function ibCatRow(c) { return `<div class="ibCatR" style="display:flex;gap:6px;margin-top:5px;align-items:center"><input class="ibCatIn" value="${ibEsc(c)}" placeholder="分類名稱" style="flex:1;max-width:220px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:13.5px;background:var(--card);color:inherit"><button class="mini" style="padding:3px 8px" title="往上" onclick="const r=this.closest('.ibCatR');if(r.previousElementSibling)r.parentNode.insertBefore(r,r.previousElementSibling)">↑</button><button class="mini" style="padding:3px 8px" title="往下" onclick="const r=this.closest('.ibCatR');if(r.nextElementSibling)r.parentNode.insertBefore(r.nextElementSibling,r)">↓</button><button class="mini" style="padding:3px 8px;color:#ef4444" title="刪除" onclick="this.closest('.ibCatR').remove()">×</button></div>` }
const _ibCustC = {} // 速度鐵則：同一位客人第二次打開先畫上次的，背景再更新
async function ibCustLoad() {
  const id = _ibCur
  if (_ibCustC[id]) ibCustPaint(_ibCustC[id])
  const d = await ibPost({ op: 'cust', id })
  if (d && d.ok) _ibCustC[id] = d
  if (_ibCur !== id) return
  ibCustPaint(d)
}
function ibCustPaint(d) {
  const box = document.getElementById('ibCustBox'); if (!box) return
  if (!d || !d.ok) { box.innerHTML = `<div class="err">${ibEsc((d && d.error) || '讀不到客戶資料')}</div>`; return }
  const card = (t, col, body) => `<div style="border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden"><div style="padding:6px 10px;background:${col}22;border-bottom:1px solid ${col}55;font-size:13px;font-weight:800;color:${col}">${t}</div><div style="padding:8px 10px;font-size:13.5px;line-height:1.6">${body}</div></div>`
  const inp = (id2, v, ph) => `<input id="${id2}" value="${ibEsc(v || '')}" placeholder="${ph}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:13.5px;background:var(--card);color:inherit;margin-top:4px">`
  const m = d.member, il = d.inline
  box.innerHTML =
    card('聯絡方式', '#16a34a', `${inp('ibCuPhone', d.phone, '手機')}${d.phoneBy === 'auto' ? '<div class="hint" style="font-size:11px">從客人訊息自動抓到的</div>' : d.phoneBy === 'member' ? '<div class="hint" style="font-size:11px">會員資料的手機</div>' : ''}${inp('ibCuMail', d.email, 'Email')}${inp('ibCuCo', d.company, '公司／統編')}${inp('ibCuTags', (d.tags || []).join('、'), '標籤（用、分開，例：VIP、素食、尾牙）')}<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span class="hint" style="font-size:12px">接洽人員：${ibEsc(d.assignee || '未指派')}</span><button class="mini on" style="padding:4px 10px;font-size:12.5px;background:#16a34a;border-color:#16a34a" onclick="ibCustSave()">儲存</button></div>`) +
    card('會員', '#ce1611', m ? `會員 ${ibEsc(m.mno || '')}・${ibEsc(m.name || '')}<br>點數 <b>${m.balance ?? 0}</b>${m.tier ? '・' + ibEsc(m.tier) : ''}${m.lastVisit && m.lastVisit.created_at ? '<br>最近消費 ' + ibEsc(new Date(m.lastVisit.created_at).toLocaleDateString('zh-TW')) + (m.lastVisit.amount ? '・' + m.lastVisit.amount + ' 元' : '') : ''}` : '<span class="hint">不是會員（或這個官方帳號沒有會員制）</span>') +
    card('inline 訂位紀錄（A Beach）', '#0ea5e9', il ? `${ibEsc(il.name || '')}<br>訂位 ${il.bookings} 次・到店 <b>${il.visits}</b> 次・取消 ${il.cancels} 次<br>第一次 ${ibEsc(il.first || '')}・最近 ${ibEsc(il.last || '')}<br>最多 ${il.maxParty} 人` : `<span class="hint">${d.inlineReady ? '這支電話沒有 inline 訂位紀錄' : '填上手機就能對 inline 訂位紀錄'}</span>`) +
    card('包場案件（小夏 EM）', '#7c3aed', (d.projects || []).length ? d.projects.map(p => `<div style="padding:4px 0;border-bottom:1px dashed var(--line)"><b>${ibEsc(p.date || '')}</b> ${ibEsc(p.title || '')}${p.n ? '・' + p.n + ' 人' : ''}<br><span class="hint" style="font-size:12px">${ibEsc(p.status || '')}・${ibEsc(p.owner || '')}${p.venue ? '・' + ibEsc(p.venue) : ''}・客戶 ${ibEsc(p.cust || '')}</span></div>`).join('') + '<div class="hint" style="font-size:11px;margin-top:4px">用名字比對，可能有同名的</div>' : '<span class="hint">沒有找到同名的包場案件</span>')
}
async function ibCustSave() {
  const g = (i) => ((document.getElementById(i) || {}).value || '').trim()
  const value = { phone: g('ibCuPhone'), email: g('ibCuMail'), company: g('ibCuCo'), tags: g('ibCuTags').split(/[、,，\s]+/).filter(Boolean) }
  const d = await ibPost({ op: 'custset', id: _ibCur, value })
  if (!d || !d.ok) { libToast((d && d.error) || '沒存到', true); return }
  if (_ibConv) Object.assign(_ibConv, d.conv); libToast('已儲存'); ibCustLoad()
}
