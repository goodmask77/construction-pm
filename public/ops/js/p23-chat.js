// 💬 聊天室 v4.70.45（溝通中樞項目 3a「個人聊天室」：像 Google Chat——全體室／每人一間「與主管」／自建群；主管看得到全部；@DD 叫 AI）
// 這版先輪詢（開著的聊天室每 6 秒、清單每 25 秒）；UI 單色 stroke SVG（10-04 規則）；手機＝清單→聊天室兩層，桌機＝左右雙欄
const CH_ICON = {
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  gear: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
}
let _chRooms = null, _chMe = null, _chPeople = [], _chCur = null, _chMsgs = [], _chTimer = null, _chListTimer = null, _chBusy = false
function chEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function chT(t) { try { const d = new Date(t); const now = new Date(); const same = d.toDateString() === now.toDateString(); return (same ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (_) { return '' } }
async function chGet(q) { try { const r = await fetch('/api/mail-sync?chat=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK() || '') + '&' + q + '&r=' + Date.now()); return await r.json() } catch (e) { return null } }
async function chPost(body) { try { const r = await fetch('/api/mail-sync?chat=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) }); return await r.json() } catch (e) { return null } }
function chStop() { if (_chTimer) clearInterval(_chTimer); if (_chListTimer) clearInterval(_chListTimer); _chTimer = _chListTimer = null }

async function chatLoad(roomId) {
  chStop()
  curStore = 'chat'; setTabs('chat')
  const b = document.getElementById('tab-chat'); if (b) b.className = 'on'
  document.getElementById('upd').textContent = '聊天室'
  if (!_chRooms) app.innerHTML = '<section><h2>聊天室</h2><div class="hint">讀取中…</div></section>'
  const d = await chGet('op=rooms')
  if (!d || !d.ok) { app.innerHTML = '<section><h2>聊天室</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">' + chEsc((d && d.error) || '讀不到聊天室') + '</div></section>'; return }
  _chRooms = d.rooms; _chMe = d.me; _chPeople = d.people || []
  if (roomId) _chCur = roomId
  chRender()
  _chListTimer = setInterval(async () => { if (curStore !== 'chat') return chStop(); const d2 = await chGet('op=rooms'); if (d2 && d2.ok) { _chRooms = d2.rooms; chRenderList() } }, 25000)
  if (_chCur) chOpen(_chCur, true)
}
function chUnreadTotal() { return (_chRooms || []).reduce((t, r) => t + (r.unread || 0), 0) }
function chRender() {
  const mobile = window.innerWidth < 760
  app.innerHTML = `<section style="padding:0;overflow:hidden">
    <div id="chWrap" style="display:flex;height:calc(100vh - 150px);min-height:420px">
      <div id="chList" style="width:${mobile ? '100%' : '280px'};flex:none;border-right:${mobile ? '0' : '1px solid var(--line)'};overflow:auto;${mobile && _chCur ? 'display:none' : ''}"></div>
      <div id="chPane" style="flex:1;display:${mobile && !_chCur ? 'none' : 'flex'};flex-direction:column;min-width:0"></div>
    </div></section>`
  chRenderList(); chRenderPane()
}
function chRenderList() {
  const el = document.getElementById('chList'); if (!el) return
  const rooms = _chRooms || []
  const row = r => `<div onclick="chOpen('${chEsc(r.id)}')" style="display:flex;gap:10px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--line);cursor:pointer;${_chCur === r.id ? 'background:var(--card)' : ''}">
      <div style="width:38px;height:38px;border-radius:50%;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:800;flex:none">${chEsc((r.name || '?').slice(0, 1))}</div>
      <div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;gap:6px"><b style="font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${chEsc(r.name)}</b><span class="hint" style="font-size:11px;flex:none">${r.last ? chT(r.last.t) : ''}</span></div>
        <div style="display:flex;justify-content:space-between;gap:6px"><span class="hint" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.last ? chEsc(r.last.name + '：' + r.last.text) : (r.kind === 'personal' ? '你跟主管的私人聊天室' : r.kind === 'all' ? '全部夥伴都在這' : chEsc((r.memberNames || []).join('、')))}</span>${r.unread ? `<span style="background:#2563eb;color:#fff;border-radius:999px;font-size:11px;padding:1px 7px;font-weight:700;flex:none">${r.unread}</span>` : ''}</div></div></div>`
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)"><b style="font-size:16px;flex:1">聊天室</b><button class="mini" style="padding:6px 10px;display:flex;align-items:center;gap:4px" onclick="chNewRoom()">${CH_ICON.plus} 新聊天室</button></div>` + (rooms.length ? rooms.map(row).join('') : '<div class="hint" style="padding:16px">還沒有聊天室</div>')
  const tb = document.getElementById('tab-chat'); if (tb) { const n = chUnreadTotal(); let bd = tb.querySelector('.chBadge'); if (n) { if (!bd) { bd = document.createElement('span'); bd.className = 'chBadge'; bd.style.cssText = 'background:#2563eb;color:#fff;border-radius:999px;font-size:11px;padding:0 6px;margin-left:6px;font-weight:700'; tb.appendChild(bd) } bd.textContent = n } else if (bd) bd.remove() }
}
function chRenderPane() {
  const el = document.getElementById('chPane'); if (!el) return
  const r = (_chRooms || []).find(x => x.id === _chCur)
  if (!r) { el.innerHTML = '<div class="hint" style="margin:auto;text-align:center;padding:30px">左邊選一個聊天室，或按「新聊天室」。<br>在訊息裡打 <b>@DD</b> 可以叫 AI 小幫手回答。</div>'; return }
  const mobile = window.innerWidth < 760
  const canEdit = r.kind === 'group' && (_chMe.mgr || true)
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)">
      ${mobile ? `<button class="mini" style="padding:6px 8px" onclick="chBack()">${CH_ICON.back}</button>` : ''}
      <div style="flex:1;min-width:0"><b style="font-size:16px">${chEsc(r.name)}</b><div class="hint" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.kind === 'all' ? '全部夥伴' : r.kind === 'personal' ? '只有本人與主管看得到' : CH_ICON.users + ' ' + chEsc((r.memberNames || []).join('、'))}</div></div>
      ${r.kind === 'group' ? `<button class="mini" style="padding:6px 8px" onclick="chRoomSettings('${chEsc(r.id)}')" title="聊天室設定">${CH_ICON.gear}</button>` : ''}
    </div>
    <div id="chMsgs" style="flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px"><div class="hint">讀取中…</div></div>
    <div style="display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);align-items:flex-end">
      <textarea id="chInput" rows="1" placeholder="輸入訊息… 打 @DD 叫 AI 回答（Enter 送出、Shift+Enter 換行）" style="flex:1;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:15px;resize:none;max-height:140px;background:var(--card);color:inherit" oninput="this.style.height='auto';this.style.height=Math.min(140,this.scrollHeight)+'px'" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();chSend()}"></textarea>
      <button class="mini on" style="padding:10px 14px;display:flex;align-items:center;gap:4px" onclick="chSend()">${CH_ICON.send}</button>
    </div>`
}
function chRenderMsgs(scroll) {
  const box = document.getElementById('chMsgs'); if (!box) return
  const me = _chMe || {}
  const mineIds = new Set([me.rid, ...((me.ids) || [])].filter(Boolean))
  if (!_chMsgs.length) { box.innerHTML = '<div class="hint" style="text-align:center;padding:20px">還沒有訊息，說點什麼吧。</div>'; return }
  let lastDay = ''
  box.innerHTML = _chMsgs.map(m => {
    const day = String(m.t || '').slice(0, 10); let sep = ''
    if (day !== lastDay) { lastDay = day; sep = `<div class="hint" style="text-align:center;font-size:11px;margin:6px 0">${chEsc(day)}</div>` }
    if (m.kind === 'sys') return sep + `<div class="hint" style="text-align:center;font-size:12px">${chEsc(m.text)}</div>`
    const mine = mineIds.has(m.rid) || (m.name === me.name && m.rid !== 'dd')
    const dd = m.rid === 'dd'
    return sep + `<div style="display:flex;flex-direction:column;align-items:${mine ? 'flex-end' : 'flex-start'};max-width:100%">
      ${mine ? '' : `<div class="hint" style="font-size:11.5px;margin:0 0 2px 6px;${dd ? 'color:#ce1611;font-weight:700' : ''}">${chEsc(m.name)}</div>`}
      <div style="max-width:78%;background:${mine ? '#2563eb' : dd ? 'rgba(206,22,17,.12)' : 'var(--card)'};color:${mine ? '#fff' : 'inherit'};border:1px solid ${mine ? '#2563eb' : 'var(--line)'};border-radius:${mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};padding:8px 12px;font-size:15px;white-space:pre-wrap;word-break:break-word">${chEsc(m.text)}</div>
      <div class="hint" style="font-size:10.5px;margin:2px 6px 0">${chT(m.t)}</div></div>`
  }).join('')
  if (scroll !== false) box.scrollTop = box.scrollHeight
}
async function chOpen(id, keep) {
  _chCur = id; _chMsgs = []
  if (!keep) { const r = (_chRooms || []).find(x => x.id === id); if (r) r.unread = 0 }
  if (window.innerWidth < 760) { const l = document.getElementById('chList'), p = document.getElementById('chPane'); if (l) l.style.display = 'none'; if (p) p.style.display = 'flex' } else chRenderList()
  chRenderPane()
  const d = await chGet('op=msgs&room=' + encodeURIComponent(id) + '&read=1')
  if (!d || !d.ok) { const box = document.getElementById('chMsgs'); if (box) box.innerHTML = '<div class="err">' + chEsc((d && d.error) || '讀不到訊息') + '</div>'; return }
  _chMsgs = d.list || []; chRenderMsgs()
  chRenderList()
  if (_chTimer) clearInterval(_chTimer)
  _chTimer = setInterval(chPoll, 6000)
  try { history.replaceState(null, '', '#chat=' + id) } catch (_) {}
}
async function chPoll() {
  if (curStore !== 'chat' || !_chCur) return chStop()
  const last = _chMsgs.length ? _chMsgs[_chMsgs.length - 1].t : ''
  const d = await chGet('op=msgs&room=' + encodeURIComponent(_chCur) + '&after=' + encodeURIComponent(last) + '&read=1')
  if (d && d.ok && d.list && d.list.length) {
    const have = new Set(_chMsgs.map(m => m.id)); const add = d.list.filter(m => !have.has(m.id))
    if (add.length) { _chMsgs.push(...add); chRenderMsgs() }
  }
}
function chBack() { _chCur = null; chStop(); _chListTimer = setInterval(async () => { if (curStore !== 'chat') return chStop(); const d2 = await chGet('op=rooms'); if (d2 && d2.ok) { _chRooms = d2.rooms; chRenderList() } }, 25000); chRender(); try { history.replaceState(null, '', '#tab=chat') } catch (_) {} }
async function chSend() {
  const ta = document.getElementById('chInput'); if (!ta || _chBusy) return
  const text = ta.value.trim(); if (!text) return
  _chBusy = true; ta.value = ''; ta.style.height = 'auto'
  const tmp = { id: 'tmp' + Date.now(), room: _chCur, rid: _chMe.rid, name: _chMe.name, text, t: new Date().toISOString(), kind: 'text' }
  _chMsgs.push(tmp); chRenderMsgs()
  const d = await chPost({ op: 'send', room: _chCur, text })
  _chBusy = false
  if (!d || !d.ok) { _chMsgs = _chMsgs.filter(m => m.id !== tmp.id); chRenderMsgs(); ta.value = text; libToast((d && d.error) || '送出失敗，再試一次', true); return }
  const i = _chMsgs.findIndex(m => m.id === tmp.id); if (i >= 0) _chMsgs[i] = d.msg
  if (d.ai) _chMsgs.push(d.ai)
  chRenderMsgs()
  const r = (_chRooms || []).find(x => x.id === _chCur); if (r) { r.last = { text: text.slice(0, 60), name: _chMe.name, t: d.msg.t }; chRenderList() }
  ta.focus()
}
function chPeopleChecks(sel) {
  return `<div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px 10px;margin-top:8px">${(_chPeople || []).map(p => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:15px"><input type="checkbox" class="chMem" value="${chEsc(p.rid)}" ${sel && sel.includes(p.rid) ? 'checked' : ''}> ${chEsc(p.name)}${p.mgr ? '<span class="hint" style="font-size:11px">　主管</span>' : ''}</label>`).join('') || '<div class="hint">名冊裡沒有其他人</div>'}</div>`
}
function chModal(inner) {
  const ov = document.createElement('div'); ov.id = 'chOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,22,.6);z-index:80;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.onclick = () => ov.remove()
  ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--bg);border:1px solid var(--line);border-radius:16px;width:100%;max-width:440px;padding:16px">${inner}</div>`
  document.body.appendChild(ov); return ov
}
function chNewRoom() {
  chModal(`<b style="font-size:16px">新聊天室</b>
    <input id="chNewName" placeholder="聊天室名稱（例：外場、週末活動、採購）" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:15px;margin-top:10px;background:var(--card);color:inherit">
    <div class="hint" style="margin-top:10px">成員（你自己一定在裡面；主管看得到所有聊天室）</div>${chPeopleChecks([])}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="document.getElementById('chOv').remove()">取消</button><button class="mini on" onclick="chNewRoomGo()">建立</button></div>`)
  setTimeout(() => { const i = document.getElementById('chNewName'); if (i) i.focus() }, 50)
}
async function chNewRoomGo() {
  const name = (document.getElementById('chNewName') || {}).value || ''
  const members = [...document.querySelectorAll('#chOv .chMem:checked')].map(x => x.value)
  if (!name.trim()) { libToast('要取個名字', true); return }
  const d = await chPost({ op: 'create', name, members })
  if (!d || !d.ok) { libToast((d && d.error) || '建立失敗', true); return }
  document.getElementById('chOv').remove()
  const d2 = await chGet('op=rooms'); if (d2 && d2.ok) { _chRooms = d2.rooms; _chPeople = d2.people || _chPeople }
  chRender(); chOpen(d.id)
}
function chRoomSettings(id) {
  const r = (_chRooms || []).find(x => x.id === id); if (!r) return
  chModal(`<b style="font-size:16px">聊天室設定</b>
    <input id="chRenName" value="${chEsc(r.name)}" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:15px;margin-top:10px;background:var(--card);color:inherit">
    <div class="hint" style="margin-top:10px">成員</div>${chPeopleChecks(r.members || [])}
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px;flex-wrap:wrap"><button class="mini" style="color:#F07373" onclick="chRoomDel('${chEsc(id)}')">刪除聊天室</button><span style="display:flex;gap:8px"><button class="mini" onclick="document.getElementById('chOv').remove()">取消</button><button class="mini on" onclick="chRoomSave('${chEsc(id)}')">儲存</button></span></div>`)
}
async function chRoomSave(id) {
  const name = (document.getElementById('chRenName') || {}).value || ''
  const members = [...document.querySelectorAll('#chOv .chMem:checked')].map(x => x.value)
  const d1 = await chPost({ op: 'rename', room: id, name }); const d2 = await chPost({ op: 'members', room: id, members })
  if (!d1 || !d1.ok || !d2 || !d2.ok) { libToast(((d1 && d1.error) || (d2 && d2.error)) || '儲存失敗', true); return }
  document.getElementById('chOv').remove(); libToast('已更新')
  const d = await chGet('op=rooms'); if (d && d.ok) { _chRooms = d.rooms }; chRender(); if (_chCur) chOpen(_chCur, true)
}
async function chRoomDel(id) {
  if (!confirm('確定刪除這個聊天室？訊息會留在資料庫但大家都看不到了。')) return
  const d = await chPost({ op: 'delete', room: id }); if (!d || !d.ok) { libToast((d && d.error) || '刪除失敗', true); return }
  document.getElementById('chOv').remove(); _chCur = null
  const d2 = await chGet('op=rooms'); if (d2 && d2.ok) _chRooms = d2.rooms; chRender()
}
window.addEventListener('resize', () => { if (curStore === 'chat' && _chRooms) { chRender(); if (_chCur) chRenderMsgs(false) } })
