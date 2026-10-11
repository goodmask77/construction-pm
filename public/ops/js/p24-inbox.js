// 📥 統一收件匣 v4.70.61（+DD 帳號：DD 私訊自動進來、DD 答過算已完成、設定頁不給改接；側欄／常用列待處理數字徽章；清單重排：帳號列／狀態列分段、狀態實色標籤；狀態改兩顆按鈕；舊版自動重新整理；提醒通知誰／LINE 群可選；視窗撐滿鎖頁、去多餘文字；回覆權限分開勾；圖片氣泡貼合圖片大小；+傳圖片／檔案、貼上截圖；修回過一次後永遠推播；+轉發：接到收件匣後原系統照收）（溝通中樞第三部：三個官方帳號的客人對話集中一頁；只收＋從 app 回覆；單色 stroke SVG）
// 版型同聊天室：桌機左右雙欄、手機兩層；對話每 6 秒輪詢、清單每 20 秒
const IB_ICON = {
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  gear: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  tpl: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h7"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  clip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
}
const IB_VER = '4761' // 跟後端 INBOX_VER 一致；後端回的 ver 不同＝正式站已更新而這台還是舊 JS → 自動重新整理一次
function ibVerCheck(d) { try { if (d && d.ver && d.ver !== IB_VER && !sessionStorage.getItem('ibReloaded_' + d.ver)) { sessionStorage.setItem('ibReloaded_' + d.ver, '1'); location.reload() } } catch (_) {} }
const IB_ST = { new: '新', open: '處理中', done: '已完成' }
const IB_STC = { new: '#2563eb', open: '#d97706', done: '#16a34a' } // 狀態色：新＝藍、處理中＝橘、已完成＝綠（張良 10-11「底色標籤直覺辨識」）
const ibStBadge = (st) => `<span style="background:${IB_STC[st] || IB_STC.new};color:#fff;border-radius:6px;font-size:11px;font-weight:700;padding:2px 7px;line-height:16px;white-space:nowrap">${IB_ST[st] || '新'}</span>`
const IB_CSS = `<style id="ibCss">
.ibSeg{display:flex;gap:4px;flex-wrap:wrap;padding:3px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.ibSeg::-webkit-scrollbar{display:none}
.ibSeg button{flex:0 0 auto;border:0;background:transparent;color:#C3CEDC;font-size:13px;font-weight:700;padding:6px 11px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:inherit}
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
let _ibD = null, _ibCur = null, _ibConv = null, _ibMsgs = [], _ibTimer = null, _ibListTimer = null, _ibBusy = false, _ibAcct = '', _ibFilter = 'todo', _ibReplyLeft = 0, _ibTick = null
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
  if (!_ibD) app.innerHTML = '<section><h2>收件匣</h2><div class="hint">讀取中…</div></section>'
  const d = await ibGet('op=list')
  ibVerCheck(d)
  if (!d || !d.ok) { app.innerHTML = '<section><h2>收件匣</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">' + ibEsc((d && d.error) || '讀不到收件匣') + '</div></section>'; return }
  _ibD = d
  if (convId) _ibCur = convId
  ibRender()
  _ibListTimer = setInterval(async () => { if (curStore !== 'inbox') return ibStop(); const d2 = await ibGet('op=list'); ibVerCheck(d2); if (d2 && d2.ok) { _ibD = d2; ibRenderList() } }, 20000)
  if (_ibCur) ibOpen(_ibCur, true)
}
function ibUnreadTotal() { return ((_ibD && _ibD.convs) || []).reduce((t, c) => t + (c.unread || 0), 0) }
// 🔴 v4.70.59 側欄數字徽章（張良 10-11「如果有訊息這邊能顯示 123 這種通知在旁邊嗎」）：
// 數字＝「待處理」對話數（跟頁內待處理分頁同一套算法：未完成 或 有未讀）；側欄按鈕＋手機常用列都掛；不在收件匣頁時每 60 秒背景問一次
function ibTodoCount(d) { return (((d || _ibD) && (d || _ibD).convs) || []).filter(c => c.status !== 'done' || c.unread).length }
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
      <div id="ibList" style="width:${mobile ? '100%' : '390px'};flex:none;border-right:${mobile ? '0' : '1px solid var(--line)'};overflow:auto;overscroll-behavior:contain;${mobile && _ibCur ? 'display:none' : ''}"></div>
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
  const nTodo = byAcct.filter(c => c.status !== 'done' || c.unread).length, nDone = byAcct.filter(c => c.status === 'done' && !c.unread).length
  const convs = byAcct.filter(c => _ibFilter === 'all' ? true : _ibFilter === 'done' ? (c.status === 'done' && !c.unread) : (c.status !== 'done' || c.unread))
  const acctSeg = `<div class="ibSeg"><button class="${!_ibAcct ? 'on' : ''}" onclick="_ibAcct='';ibRenderList()">全部</button>${(d.accounts || []).map(a => `<button class="${_ibAcct === a.key ? 'on' : ''}" data-c="1" style="--c:${a.color};${a.configured ? '' : 'opacity:.55'}" onclick="_ibAcct='${a.key}';ibRenderList()"><i class="dot"></i>${ibEsc(a.name)}${a.configured ? '' : ' <span class="nc" style="font-size:10px;font-weight:400">未接</span>'}</button>`).join('')}</div>`
  const stSeg = `<div class="ibSeg"><button class="${_ibFilter === 'todo' ? 'on' : ''}" onclick="_ibFilter='todo';ibRenderList()">待處理${nTodo ? ` <span class="n">${nTodo}</span>` : ''}</button><button class="${_ibFilter === 'done' ? 'on' : ''}" onclick="_ibFilter='done';ibRenderList()">已完成${nDone ? ` <span class="n" style="background:rgba(255,255,255,.12);color:#C3CEDC">${nDone}</span>` : ''}</button><button class="${_ibFilter === 'all' ? 'on' : ''}" onclick="_ibFilter='all';ibRenderList()">全部</button></div>`
  const row = c => { const a = ibAcct(c.acct); return `<div class="ibRow${_ibCur === c.id ? ' cur' : ''}${c.status === 'done' && !c.unread ? ' done' : ''}" onclick="ibOpen('${ibEsc(c.id)}')">
      <div class="av" style="${c.pic ? `background-image:url('${ibEsc(c.pic)}')` : ''}">${c.pic ? '' : ibEsc((c.name || '?').slice(0, 1))}</div>
      <div style="flex:1;min-width:0">
        <div class="l1"><b>${ibEsc(c.alias || c.name || '客人')}</b><span class="hint" style="font-size:11px;flex:none">${c.lastT ? ibT(c.lastT) : ''}</span></div>
        <div class="l2"><span class="t">${c.last ? ibEsc((c.last.dir === 'out' ? '↩ ' : '') + c.last.text) : ''}</span>${c.unread ? `<span class="un">${c.unread}</span>` : ''}</div>
        <div class="l3">${ibStBadge(c.status)}<span class="acct"><i style="background:${a.color}"></i>${ibEsc(a.name)}</span>${c.assignee ? `<span class="who">${ibEsc(c.assignee)}</span>` : ''}${c.follow === false ? '<span class="who">已封鎖</span>' : ''}</div>
      </div></div>` }
  const notCfg = (d.accounts || []).filter(a => !a.configured)
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)"><b style="font-size:16px;flex:1">收件匣</b>${d.me && d.me.mgr ? `<button class="mini" style="padding:6px 8px" title="收件匣設定：帳號連線／權限／範本" onclick="ibSettings()">${IB_ICON.gear}</button>` : ''}</div>
    <div style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)">${acctSeg}${stSeg}</div>
    ${convs.length ? convs.map(row).join('') : `<div class="hint" style="padding:22px 14px;text-align:center;font-size:13.5px">${(d.accounts || []).length === 0 ? '你沒有任何官方帳號的收件匣權限，請主管在設定裡加你。' : notCfg.length === (d.accounts || []).length ? '官方帳號還沒接上。主管按右上齒輪看要怎麼接。' : _ibFilter === 'todo' ? '沒有待處理的對話' : _ibFilter === 'done' ? '沒有已完成的對話' : '還沒有對話'}</div>`}`
  const tb = document.getElementById('tab-inbox'); if (tb) { const n = ibUnreadTotal(); let bd = tb.querySelector('.chBadge'); if (n) { if (!bd) { bd = document.createElement('span'); bd.className = 'chBadge'; bd.style.cssText = 'background:#2563eb;color:#fff;border-radius:999px;font-size:11px;padding:0 6px;margin-left:6px;line-height:16px;display:inline-block'; tb.appendChild(bd) } bd.textContent = n } else if (bd) bd.remove() }
}
function ibRenderPane() {
  const el = document.getElementById('ibPane'); if (!el) return
  const c = ((_ibD && _ibD.convs) || []).find(x => x.id === _ibCur) || _ibConv
  if (!c) { el.innerHTML = '<div class="hint" style="margin:auto;text-align:center;padding:30px">選一個對話</div>'; return }
  const mobile = window.innerWidth < 760
  const cv = _ibConv || c
  const people = (_ibD && _ibD.people) || []
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap">
      ${mobile ? `<button class="mini" style="padding:6px 8px" onclick="ibBack()">${IB_ICON.back}</button>` : ''}
      <div style="flex:1;min-width:140px"><b style="font-size:16px">${ibEsc(cv.alias || cv.name || '客人')}</b> ${ibTag(cv.acct)}<div class="hint" style="font-size:12px">${cv.alias && cv.name ? 'LINE 名稱：' + ibEsc(cv.name) + ' · ' : ''}${cv.follow === false ? '已封鎖官方帳號 · ' : ''}<span id="ibQuota"></span></div></div>
      <span id="ibStBtns" style="display:flex;gap:4px">${ibStBtns(cv.status)}</span>
      <select id="ibAssign" class="mini" style="padding:5px 8px;font-size:12.5px;max-width:120px" onchange="ibOp('assign',this.value)" title="負責人"><option value="">未指派</option>${people.map(p => `<option${cv.assignee === p ? ' selected' : ''}>${ibEsc(p)}</option>`).join('')}</select>
      <button class="mini" style="padding:5px 8px;font-size:12.5px" onclick="ibNote()" title="內部備註（客人看不到）">備註${cv.note ? ' ●' : ''}</button>
    </div>
    <div id="ibMsgs" style="flex:1;overflow:auto;overscroll-behavior:contain;padding:12px;display:flex;flex-direction:column;gap:8px"><div class="hint">讀取中…</div></div>
    ${(ibAcct(cv.acct).canReply === false) ? `<div class="hint" style="padding:12px;border-top:1px solid var(--line);font-size:13.5px;text-align:center">你有這個帳號的查看權限，沒有回覆權限。要回覆請主管在收件匣設定勾「可回覆」。</div>` : `<div style="padding:6px 12px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span id="ibMode" class="hint" style="font-size:12px"></span><span style="flex:1"></span><button class="mini" style="padding:4px 8px;font-size:12px;display:flex;gap:4px;align-items:center" onclick="document.getElementById('ibFile').click()" title="傳圖片或檔案（也可以直接把截圖貼到輸入框）">${IB_ICON.clip} 附件</button><input id="ibFile" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" style="display:none" onchange="ibUploadFiles(this.files);this.value=''"><button class="mini" style="padding:4px 8px;font-size:12px;display:flex;gap:4px;align-items:center" onclick="ibTplPick()">${IB_ICON.tpl} 範本</button></div>
    <div style="display:flex;gap:8px;padding:6px 12px 10px;align-items:flex-end">
      <textarea id="ibInput" rows="1" placeholder="回覆客人…" style="flex:1;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;resize:none;max-height:140px;background:var(--card);color:inherit" oninput="this.style.height='auto';this.style.height=Math.min(140,this.scrollHeight)+'px'" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();ibSend()}" onpaste="ibPaste(event)"></textarea>
      <button class="mini on" style="padding:10px 14px;display:flex;align-items:center;gap:4px" onclick="ibSend()">${IB_ICON.send}</button>
    </div>`}`
  ibModeLine()
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
function ibStBtns(st) { return ['open', 'done'].map(k => `<button class="mini" style="padding:5px 10px;font-size:12.5px;font-weight:700;${st === k ? `background:${IB_STC[k]};border-color:${IB_STC[k]};color:#fff` : ''}" onclick="ibOp('status','${k}')">${IB_ST[k]}</button>`).join('') }
function ibApplyConv(c) { // 回覆後對話狀態變了→表頭的下拉與清單一起更新（v4.70.49 修：之前表頭還停在「新」）
  if (!c) return
  if (_ibConv) { _ibConv.status = c.status; _ibConv.assignee = c.assignee }
  const sb = document.getElementById('ibStBtns'); if (sb) sb.innerHTML = ibStBtns(c.status || 'new'); const as = document.getElementById('ibAssign'); if (as) as.value = c.assignee || ''
  const r = ((_ibD && _ibD.convs) || []).find(x => x.id === _ibCur); if (r) { r.status = c.status; r.assignee = c.assignee }
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
  ibRenderList(); if (op !== 'status' && op !== 'assign') ibRenderPane()
  libToast('已更新')
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
function ibSetRender() {
  const d = _ibSet; const ov = document.getElementById('ibOv'); if (!ov || !d) return
  const box = ov.firstElementChild
  const acc = (d.accounts || []).map(a => {
    const st = a.relay ? (a.hookOk ? '<span style="color:#16a34a;font-weight:700">DD 自己接・私訊自動進收件匣</span>' : '<span style="color:#d97706;font-weight:700">DD 的 webhook 沒指在正式站</span>') : !a.configured ? '<span style="color:#d97706;font-weight:700">未設金鑰</span>' : a.hookOk ? '<span style="color:#16a34a;font-weight:700">已接上</span>' : (a.hook && a.hook.endpoint) ? `<span style="color:#d97706;font-weight:700">webhook 指到別處</span>` : '<span style="color:#d97706;font-weight:700">webhook 未設</span>'
    const info = a.info && !a.info.error ? `${ibEsc(a.info.displayName || '')} ${a.info.basicId ? '(' + ibEsc(a.info.basicId) + ')' : ''} · 模式 ${a.info.chatMode === 'bot' ? '機器人' : '聊天'}` : (a.configured ? '金鑰無效或讀不到帳號資訊' : '')
    const q = a.quota && a.quota.used != null ? `本月 ${a.quota.used}${a.quota.limit != null ? ' / ' + a.quota.limit : ''} 則` : ''
    return `<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-top:8px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="color:${a.color}">${ibEsc(a.name)}</b>${st}<span style="flex:1"></span>${a.configured && !a.hookOk && !a.relay ? `<button class="mini on" style="padding:5px 10px;font-size:12.5px" onclick="ibConnect('${a.key}',false)">接到收件匣</button>` : ''}${a.configured && a.hookOk && !a.relay ? `<button class="mini" style="padding:5px 10px;font-size:12.5px" onclick="ibConnect('${a.key}',false)">重測</button>` : ''}</div>
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
  const permHtml = (d.accounts || []).map(a => `<div style="margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px"><b style="font-size:14px;color:${a.color}">${ibEsc(a.name)}</b>
      <div style="margin-top:6px"><b style="font-size:13px">看得到</b><span class="hint" style="font-size:11.5px">　主管永遠看得到；勾的人看得到並收到通知</span>${grid('ibPerm', a, perm[a.key])}</div>
      <div style="margin-top:10px"><b style="font-size:13px">可回覆</b><span class="hint" style="font-size:11.5px">　主管永遠可回；勾的人才能回覆、傳圖（要同時有「看得到」）</span>${grid('ibReply', a, reply[a.key])}</div>
    </div>`).join('')
  const tpl = (d.cfg && d.cfg.templates) || []
  const tplHtml = `<div id="ibTplList">${tpl.map((t, i) => ibTplRow(t, i)).join('')}</div><button class="mini" style="margin-top:6px;padding:5px 10px;font-size:12.5px" onclick="ibTplAdd()">＋ 新增範本</button>`
  box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><b style="font-size:16px;flex:1">收件匣設定</b><button class="mini" onclick="document.getElementById('ibOv').remove()">關閉</button></div>
    <div class="hint" style="font-size:12px;margin-top:6px">驗簽失敗 ${(d.sigfail || {}).n || 0} 次${(d.sigfail || {}).lastT ? '（最近 ' + ibT(d.sigfail.lastT) + '）' : ''} · 官方帳號（A Beach／GROUN:D／104招募）webhook 都填同一個網址：<span style="word-break:break-all">${ibEsc(((d.accounts || [])[0] || {}).wantHook || '')}</span></div>
    <h3 style="font-size:14px;margin:14px 0 0">帳號連線</h3>${acc}
    <h3 style="font-size:14px;margin:16px 0 0">誰看得到哪個帳號</h3>${permHtml}
    <h3 style="font-size:14px;margin:16px 0 0">常用回覆範本</h3>${tplHtml}
    <h3 style="font-size:14px;margin:16px 0 0">沒人回覆提醒</h3><div style="display:flex;gap:8px;align-items:center;font-size:14px;flex-wrap:wrap">超過 <input id="ibRemind" type="number" min="5" max="1440" value="${(d.cfg && d.cfg.remindMin) || 30}" style="width:70px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit"> 分鐘沒回 → 推播＋LINE 私訊下面勾的人（每小時檢查）</div>
    ${(d.accounts || []).map(a => { const rc = ((d.cfg && d.cfg.remind) || {})[a.key] || {}; return `<div style="margin-top:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px"><b style="font-size:14px;color:${a.color}">${ibEsc(a.name)}</b>
      <div style="margin-top:6px"><b style="font-size:13px">通知誰</b><span class="hint" style="font-size:11.5px">　沒勾＝可回覆的人＋審核人</span>${grid('ibRemind', a, rc.people || [])}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:13px">LINE 群組</b><select class="ibRemindGrp" data-acct="${a.key}" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;font-size:13px;max-width:260px"><option value="">不發群組</option>${(d.groups || []).map(g => `<option value="${ibEsc(g.gid)}"${rc.group === g.gid ? ' selected' : ''}>${ibEsc(g.name)}</option>`).join('')}</select><span class="hint" style="font-size:11.5px">由 DD 發到群；群組推播按群內人數扣 DD 額度</span></div>
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
  const d = await ibPost({ op: 'cfg', cfg: { perm, reply, remind, templates, remindMin } })
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
