// 🗂 通用文件庫 v4.70.0（張良「建一個資料庫像雲端硬碟：可增刪改拖曳排序＋DD上傳歸檔＋搜尋＋DD撈檔傳群＋資料夾權限」）
// 像雲端硬碟：資料夾網格 → 進夾看檔案；資料夾與檔案都可新增/刪除/改名/拖曳排序；上傳(選檔+拖拉)；搜尋；每夾可設權限。
// 權限走伺服器端：libget 只回「這個人看得到的」夾與檔；folder.level 0看不到/1只能看/2可編。管理者(主管/審核人approver/admin)才看得到齒輪與新增夾。
// 頁內 UI 一律單色 stroke SVG（10-04 規則），不用彩色 emoji。

const LIB_ICON = {
  folder: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  upload: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg>',
  download: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>',
  pencil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  move: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>',
  lock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  file: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
}
const LIB_LVL = { 0: '看不到', 1: '只能看', 2: '可編輯' }
let _libCur = null // 目前進入的資料夾 id（null=資料夾網格）
let _libQ = ''      // 搜尋字串

function libEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function libSize(n) { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB' }
function libToast(msg, bad) {
  const old = document.getElementById('libToast'); if (old) old.remove()
  const t = document.createElement('div'); t.id = 'libToast'
  t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:1200;background:' + (bad ? '#7f1d1d' : '#14532d') + ';color:#fff;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:86vw'
  t.textContent = msg; document.body.appendChild(t)
  setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450) }, bad ? 3600 : 2200)
}
async function libPost(q, body) {
  try {
    const r = await fetch('/api/mail-sync?' + q + '=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) })
    return await r.json().catch(() => null)
  } catch (e) { return null }
}

async function libLoad() {
  curStore = 'lib'; setTabs('lib')
  const b = document.getElementById('tab-lib'); if (b) b.className = 'on'
  document.getElementById('upd').textContent = '文件庫'
  app.innerHTML = '<section><h2>文件庫</h2><div class="hint">讀取中…</div></section>'
  let d = null
  try { const r = await fetch('/api/mail-sync?libget=' + encodeURIComponent(K) + (TK() ? '&me=' + encodeURIComponent(TK()) : '') + '&r=' + Date.now()); d = await r.json() } catch (e) {}
  if (!d || !d.ok) {
    app.innerHTML = '<section><h2>文件庫</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">' + LIB_ICON.lock + ' ' + ((d && d.error) || '要先登入才能看（私訊 DD「登入碼」）') + '</div></section>'
    return
  }
  window._libD = d
  libRender()
}

function libRender() {
  const d = window._libD; if (!d) return
  if (_libQ) return libRenderSearch()
  if (_libCur) return libRenderFolder()
  // ── 第一層：資料夾網格 ──
  const mgr = d.mgr
  let html = '<section><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">'
    + '<h2 style="margin:0;display:flex;align-items:center;gap:8px">' + LIB_ICON.folder + ' 文件庫</h2>'
    + '<div style="display:flex;gap:8px;align-items:center">'
    + libSearchBox()
    + (mgr ? '<button class="mini on" style="padding:8px 13px;display:inline-flex;gap:5px;align-items:center;white-space:nowrap" onclick="libNewFolder()">' + LIB_ICON.plus + ' 新資料夾</button>' : '')
    + '</div></div>'
  if (!d.folders.length) {
    html += '<div class="hint" style="margin-top:16px;padding:22px;background:var(--card);border:1.5px solid var(--line);border-radius:12px;text-align:center">還沒有資料夾' + (mgr ? '，按右上「新資料夾」開一個。' : '，或你目前沒有任何資料夾的檢視權限。') + '</div>'
  } else {
    html += '<div id="libGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:16px">'
    html += d.folders.map(f => {
      const canEdit = f.level >= 2
      const drag = mgr ? ' data-fid="' + f.id + '"' : ''
      return '<div class="libCard"' + drag + ' style="background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:15px;cursor:pointer;position:relative" onclick="libOpen(\'' + f.id + '\')">'
        + '<div style="display:flex;align-items:flex-start;justify-content:space-between">'
        + '<span style="color:var(--primary)">' + LIB_ICON.folder + '</span>'
        + (mgr ? '<button class="mini" style="padding:4px 7px" title="權限設定" onclick="event.stopPropagation();libPermOpen(\'' + f.id + '\')">' + LIB_ICON.gear + '</button>' : (canEdit ? '' : '<span class="hint" title="你只能檢視，不能編輯" style="opacity:.7">' + LIB_ICON.lock + '</span>'))
        + '</div>'
        + '<div style="font-weight:800;margin-top:8px;font-size:15.5px;word-break:break-all">' + libEsc(f.name) + '</div>'
        + '<div class="hint" style="font-size:12px;margin-top:3px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span>' + f.count + ' 份檔案</span>'
        + '<span>· ' + (LIB_LVL[f.level] || '') + '</span>'
        + (f.noExport ? '<span style="color:#f97316;display:inline-flex;align-items:center;gap:3px">' + LIB_ICON.lock + '禁外傳</span>' : '')
        + '</div></div>'
    }).join('')
    html += '</div>'
    if (mgr) html += '<div class="hint" style="margin-top:10px;font-size:12px">長按拖曳資料夾可排序・齒輪可設「誰看得到／誰能編」</div>'
  }
  html += '</section>'
  app.innerHTML = html
  if (typeof permScan === 'function') permScan(app)
  libInitSort()
}

// 拖曳排序（SortableJS，手機/iPad 觸控也能用）：長按拖曳，短按＝點擊開啟
function libInitSort() {
  if (!window.Sortable) return
  const d = window._libD; if (!d) return
  if (!_libCur && !_libQ && d.mgr) {
    const g = document.getElementById('libGrid')
    if (g) new Sortable(g, {
      animation: 150, delay: 180, delayOnTouchOnly: true,
      onEnd: async () => {
        const ids = Array.from(g.querySelectorAll('[data-fid]')).map(el => el.getAttribute('data-fid'))
        d.folders.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
        const r = await libPost('libfold', { op: 'reorder', order: ids }); if (!r || !r.ok) { libToast('排序沒存成功', true); libLoad() }
      }
    })
  }
  if (_libCur) {
    const f = d.folders.find(x => x.id === _libCur)
    if (f && f.level >= 2) {
      const dz = document.getElementById('libDrop')
      if (dz) new Sortable(dz, {
        animation: 150, delay: 180, delayOnTouchOnly: true, draggable: '.libFileRow',
        onEnd: async () => {
          const ids = Array.from(dz.querySelectorAll('.libFileRow')).map(el => el.getAttribute('data-fileid'))
          f.files.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
          const r = await libPost('libfile', { op: 'reorder', folderId: f.id, order: ids }); if (!r || !r.ok) { libToast('排序沒存成功', true); libLoad() }
        }
      })
    }
  }
}

function libSearchBox() {
  return '<span style="display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1.5px solid var(--line);border-radius:10px;padding:6px 10px">'
    + '<span class="hint">' + LIB_ICON.search + '</span>'
    + '<input id="libQ" value="' + libEsc(_libQ) + '" oninput="libSearchInput(this.value)" placeholder="搜尋檔名…" style="border:0;background:transparent;color:var(--fg,inherit);outline:none;width:140px;font-size:14px">'
    + '</span>'
}
let _libSearchT = null
function libSearchInput(v) { _libQ = v.trim(); clearTimeout(_libSearchT); _libSearchT = setTimeout(() => { const foc = document.activeElement === document.getElementById('libQ'); libRender(); if (foc) { const el = document.getElementById('libQ'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } } }, 180) }

function libRenderSearch() {
  const d = window._libD
  const q = _libQ.toLowerCase()
  const hits = []
  d.folders.forEach(f => (f.files || []).forEach(x => { if (x.name.toLowerCase().includes(q)) hits.push({ f, x }) }))
  let html = '<section><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">'
    + '<h2 style="margin:0;display:flex;align-items:center;gap:8px">' + LIB_ICON.search + ' 搜尋「' + libEsc(_libQ) + '」</h2>'
    + '<div style="display:flex;gap:8px;align-items:center">' + libSearchBox() + '<button class="mini" style="padding:8px 12px" onclick="libClearSearch()">清除</button></div></div>'
  html += '<div class="hint" style="margin-top:10px">找到 ' + hits.length + ' 份</div>'
  if (hits.length) {
    html += '<div style="margin-top:8px">' + hits.map(({ f, x }) => libFileRow(f, x, true)).join('') + '</div>'
  } else html += '<div class="hint" style="margin-top:14px;padding:20px;background:var(--card);border:1.5px solid var(--line);border-radius:12px;text-align:center">沒有符合的檔案</div>'
  html += '</section>'
  app.innerHTML = html
  if (typeof permScan === 'function') permScan(app)
}
function libClearSearch() { _libQ = ''; libRender() }

function libOpen(id) { _libCur = id; _libQ = ''; libRender() }
function libBack() { _libCur = null; libRender() }

function libRenderFolder() {
  const d = window._libD
  const f = d.folders.find(x => x.id === _libCur)
  if (!f) { _libCur = null; return libRender() }
  const canEdit = f.level >= 2
  const files = (f.files || []).slice()
  let html = '<section><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">'
    + '<h2 style="margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<button class="mini" style="padding:6px 9px" onclick="libBack()">' + LIB_ICON.back + '</button>'
    + '<span style="cursor:pointer;color:var(--primary)" onclick="libBack()">文件庫</span><span class="hint">›</span>'
    + LIB_ICON.folder + ' ' + libEsc(f.name) + '</h2>'
    + '<div style="display:flex;gap:8px;align-items:center">' + libSearchBox()
    + (canEdit ? '<button class="mini on" style="padding:8px 13px;display:inline-flex;gap:5px;align-items:center;white-space:nowrap" onclick="libPickUpload(\'' + f.id + '\')">' + LIB_ICON.upload + ' 上傳</button>' : '')
    + '</div></div>'
  html += '<div class="hint" style="margin-top:6px;font-size:12px">' + (LIB_LVL[f.level] || '') + (f.noExport ? '・此夾已標記禁止 DD 外傳' : '') + (canEdit ? '・可拖曳檔案排序，也可把檔案直接拖進此區上傳' : '') + '</div>'
  html += '<div id="libDrop" ' + (canEdit ? 'ondragover="libDzOver(event)" ondragleave="libDzLeave(event)" ondrop="libDzDrop(event,\'' + f.id + '\')"' : '') + ' style="margin-top:12px;border:1.5px ' + (canEdit ? 'dashed' : 'solid') + ' var(--line);border-radius:12px;padding:6px;min-height:80px">'
  if (!files.length) html += '<div class="hint" style="padding:22px;text-align:center">這個資料夾還沒有檔案' + (canEdit ? '，按「上傳」或把檔案拖進來。' : '。') + '</div>'
  else html += files.map(x => libFileRow(f, x, false)).join('')
  html += '</div></section>'
  app.innerHTML = html
  if (typeof permScan === 'function') permScan(app)
  libInitSort()
}

function libFileRow(f, x, withFolder) {
  const canEdit = f.level >= 2
  const base = '/api/mail-sync?liburl=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK()) + '&folderId=' + f.id + '&fileId=' + x.id
  const dlUrl = base + '&dl=' + encodeURIComponent(x.name) // 帶 dl＝強制下載
  const drag = (canEdit && !withFolder) ? ' data-fileid="' + x.id + '"' : ''
  return '<div class="libFileRow"' + drag + ' style="display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--line);padding:9px 8px;flex-wrap:wrap">'
    + '<span class="hint" style="flex-shrink:0">' + LIB_ICON.file + '</span>'
    + '<a onclick="libPreview(\'' + f.id + '\',\'' + x.id + '\');return false" style="color:var(--primary);text-decoration:none;font-weight:700;font-size:14px;word-break:break-all;flex:1;min-width:140px;cursor:pointer" title="點檔名在這裡預覽">' + libEsc(x.name) + '</a>'
    + (withFolder ? '<span class="hint" style="font-size:11.5px">' + LIB_ICON.folder + ' ' + libEsc(f.name) + '</span>' : '')
    + '<span class="hint" style="font-size:11.5px;white-space:nowrap">' + libSize(x.size) + '・' + (x.by || '') + '・' + (x.ts || '') + '</span>'
    + '<span style="display:inline-flex;gap:4px">'
    + '<a class="mini" style="padding:5px 8px" href="' + dlUrl + '" title="下載">' + LIB_ICON.download + '</a>'
    + (canEdit ? '<button class="mini" style="padding:5px 8px" title="改名" onclick="libRenameFile(\'' + f.id + '\',\'' + x.id + '\')">' + LIB_ICON.pencil + '</button>'
      + '<button class="mini" style="padding:5px 8px" title="搬到其他資料夾" onclick="libMoveFile(\'' + f.id + '\',\'' + x.id + '\')">' + LIB_ICON.move + '</button>'
      + '<button class="mini" style="padding:5px 8px" title="刪除" onclick="libDelFile(\'' + f.id + '\',\'' + x.id + '\',\'' + libEsc(x.name).replace(/'/g, '') + '\')">' + LIB_ICON.trash + '</button>' : '')
    + '</span></div>'
}

// 檔案預覽：在 App 內疊一層看（不開新分頁）。PDF 用 iframe、圖片用 img，其他類型給下載鈕。
function libPreview(folderId, fileId) {
  const f = window._libD.folders.find(x => x.id === folderId); const x = f && (f.files || []).find(z => z.id === fileId); if (!x) return
  const base = '/api/mail-sync?liburl=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK()) + '&folderId=' + folderId + '&fileId=' + fileId
  const dlUrl = base + '&dl=' + encodeURIComponent(x.name)
  const isImg = /^image\//.test(x.mime || '') || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(x.name)
  const isPdf = /pdf/.test(x.mime || '') || /\.pdf$/i.test(x.name)
  const old = document.getElementById('libPvOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id = 'libPvOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,11,16,.94);z-index:1300;display:flex;flex-direction:column'
  const body = isImg
    ? '<div style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:10px"><img src="' + base + '" style="max-width:100%;max-height:100%;object-fit:contain"></div>'
    : (isPdf
      ? '<iframe src="' + base + '" style="flex:1;border:0;width:100%;background:#fff"></iframe>'
      : '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#C7D0DB;padding:20px;text-align:center"><div>這個檔案類型沒辦法在這裡預覽</div><a class="mini on" style="padding:10px 18px" href="' + dlUrl + '">下載來看</a></div>')
  ov.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#161B22;border-bottom:1px solid #2A3240">'
    + '<span style="flex:1;color:#F2F5F9;font-weight:700;font-size:14px;word-break:break-all">' + libEsc(x.name) + '</span>'
    + '<a class="mini" style="padding:6px 12px;display:inline-flex;gap:5px;align-items:center" href="' + dlUrl + '">' + LIB_ICON.download + ' 下載</a>'
    + '<button class="mini" style="padding:6px 14px" onclick="document.getElementById(\'libPvOv\').remove()">關閉</button>'
    + '</div>' + body
  document.body.appendChild(ov)
}

// ── 資料夾操作（限管理者）──
async function libNewFolder() {
  const name = prompt('新資料夾名稱：'); if (!name || !name.trim()) return
  const r = await libPost('libfold', { op: 'add', name: name.trim() })
  if (!r || !r.ok) { libToast((r && r.error) || '建立失敗', true); return }
  libToast('已建立「' + name.trim() + '」'); libLoad()
}
async function libRenameFolder(id) {
  const f = window._libD.folders.find(x => x.id === id); if (!f) return
  const name = prompt('資料夾改名：', f.name); if (!name || !name.trim()) return
  const r = await libPost('libfold', { op: 'rename', id, name: name.trim() })
  if (!r || !r.ok) { libToast((r && r.error) || '改名失敗', true); return }
  libLoad()
}
async function libDelFolder(id) {
  const f = window._libD.folders.find(x => x.id === id); if (!f) return
  if (!confirm('刪除資料夾「' + f.name + '」？\n（裡面 ' + f.count + ' 份檔案的索引會一起移除，實體檔仍留在保險箱可救回）')) return
  const r = await libPost('libfold', { op: 'del', id })
  if (!r || !r.ok) { libToast((r && r.error) || '刪除失敗', true); return }
  libToast('已刪除'); _libCur = null; libLoad()
}

// ── 上傳 ──
function libPickUpload(folderId) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true
  inp.onchange = () => libDoUpload(folderId, Array.from(inp.files || []))
  inp.click()
}
function libDzOver(e) { if (!(e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files'))) return; e.preventDefault(); const dz = document.getElementById('libDrop'); if (dz) dz.style.borderColor = 'var(--primary)' }
function libDzLeave(e) { const dz = document.getElementById('libDrop'); if (dz) dz.style.borderColor = 'var(--line)' }
function libDzDrop(e, folderId) {
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
  if (!files.length) return // 內部排序拖曳交給 SortableJS，不是上傳
  e.preventDefault(); const dz = document.getElementById('libDrop'); if (dz) dz.style.borderColor = 'var(--line)'
  libDoUpload(folderId, files)
}
async function libDoUpload(folderId, files) {
  if (!files.length) return
  let ok9 = 0
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (file.size > 20 * 1024 * 1024) { libToast('「' + file.name + '」超過 20MB，略過', true); continue }
    libToast('上傳中… ' + (i + 1) + '/' + files.length + '：' + file.name)
    const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(file) })
    if (!dataUrl) { libToast('「' + file.name + '」讀取失敗', true); continue }
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const r = await libPost('libup', { folderId, name: file.name, ext, dataUrl })
    if (r && r.ok) ok9++; else libToast('「' + file.name + '」上傳失敗：' + ((r && r.error) || ''), true)
  }
  if (ok9) { libToast('已上傳 ' + ok9 + ' 份'); await libLoad(); libOpen(folderId) }
}

// ── 檔案操作 ──
async function libRenameFile(folderId, id) {
  const f = window._libD.folders.find(x => x.id === folderId); const x = f && (f.files || []).find(z => z.id === id); if (!x) return
  const name = prompt('檔案改名：', x.name); if (!name || !name.trim()) return
  const r = await libPost('libfile', { op: 'rename', folderId, id, name: name.trim() })
  if (!r || !r.ok) { libToast((r && r.error) || '改名失敗', true); return }
  await libLoad(); libOpen(folderId)
}
async function libDelFile(folderId, id, name) {
  if (!confirm('刪除檔案「' + name + '」？\n（實體檔仍留在保險箱可救回）')) return
  const r = await libPost('libfile', { op: 'del', folderId, id })
  if (!r || !r.ok) { libToast((r && r.error) || '刪除失敗', true); return }
  libToast('已刪除'); await libLoad(); libOpen(folderId)
}
async function libMoveFile(folderId, id) {
  const d = window._libD
  const opts = d.folders.filter(f => f.id !== folderId && f.level >= 2)
  if (!opts.length) { libToast('沒有其他可編輯的資料夾可搬', true); return }
  const list = opts.map((f, i) => (i + 1) + '. ' + f.name).join('\n')
  const pick = prompt('搬到哪個資料夾？輸入編號：\n' + list); if (!pick) return
  const g = opts[(+pick || 0) - 1]; if (!g) { libToast('編號不對', true); return }
  const r = await libPost('libfile', { op: 'move', folderId, id, toFolderId: g.id })
  if (!r || !r.ok) { libToast((r && r.error) || '搬移失敗', true); return }
  libToast('已搬到「' + g.name + '」'); await libLoad(); libOpen(folderId)
}

// ── 權限設定 modal（限管理者）──
let _libPermId = null, _libPermAcl = null
function libPermOpen(id) {
  const f = window._libD.folders.find(x => x.id === id); if (!f) return
  _libPermId = id
  _libPermAcl = JSON.parse(JSON.stringify(f.acl || { roles: {}, users: {}, noExport: false }))
  _libPermAcl.roles = _libPermAcl.roles || {}; _libPermAcl.users = _libPermAcl.users || {}
  libPermRender(f.name)
}
function libLvlSel(cur, onch) {
  return '<select onchange="' + onch + '" style="padding:5px 8px;border-radius:8px;border:1.5px solid var(--line);background:var(--card);color:inherit;font-size:13px">'
    + [0, 1, 2].map(v => '<option value="' + v + '"' + ((+cur === v || (cur == null && v === 1)) ? ' selected' : '') + '>' + LIB_LVL[v] + '</option>').join('') + '</select>'
}
function libPermRender(name) {
  const d = window._libD
  const roles = ['一般', '主管', '審核人', '訪客']
  const roleDef = { '一般': 1, '主管': 2, '審核人': 2, '訪客': 0 }
  const covered = Object.keys(_libPermAcl.users || {})
  const old = document.getElementById('libPermOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id = 'libPermOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,22,.6);z-index:1100;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto'
  let inner = '<div style="font-weight:900;font-size:16.5px;display:flex;justify-content:space-between;align-items:center;gap:8px">權限設定：' + libEsc(name)
    + '<button class="mini" style="padding:6px 13px" onclick="document.getElementById(\'libPermOv\').remove()">關閉</button></div>'
  inner += '<div class="hint" style="margin-top:4px;font-size:12px">看不到＝連資料夾都不顯示；只能看＝可下載不可改；可編輯＝可上傳/刪/改/排序。管理者永遠可編。</div>'
  // 角色預設
  inner += '<div style="margin-top:14px;font-weight:800;font-size:13.5px">依角色</div>'
  inner += '<div style="margin-top:6px;display:flex;flex-direction:column;gap:7px">'
  inner += roles.map(rl => {
    const cur = (_libPermAcl.roles[rl] != null) ? _libPermAcl.roles[rl] : roleDef[rl]
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span>' + rl + (rl === '訪客' ? '（未綁定）' : '') + '</span>'
      + libLvlSel(cur, 'libPermSetRole(\'' + rl + '\',this.value)') + '</div>'
  }).join('')
  inner += '</div>'
  // 個人覆蓋
  inner += '<div style="margin-top:16px;font-weight:800;font-size:13.5px">個別指定（覆蓋角色）</div>'
  if (covered.length) {
    inner += '<div style="margin-top:6px;display:flex;flex-direction:column;gap:7px">'
    inner += covered.map(rid => {
      const p = (d.people || []).find(x => x.id === rid)
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span>' + libEsc(p ? p.name : rid) + '</span><span style="display:flex;gap:6px;align-items:center">'
        + libLvlSel(_libPermAcl.users[rid], 'libPermSetUser(\'' + rid + '\',this.value)')
        + '<button class="mini" style="padding:4px 7px" onclick="libPermDelUser(\'' + rid + '\')">' + LIB_ICON.trash + '</button></span></div>'
    }).join('')
    inner += '</div>'
  }
  const addable = (d.people || []).filter(p => _libPermAcl.users[p.id] == null)
  inner += '<div style="margin-top:8px">'
    + '<select onchange="if(this.value){libPermAddUser(this.value)}" style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid var(--line);background:var(--card);color:inherit;font-size:13px">'
    + '<option value="">＋ 選一個人加入個別指定…</option>'
    + addable.map(p => '<option value="' + p.id + '">' + libEsc(p.name) + '（' + p.role + '）</option>').join('')
    + '</select></div>'
  // 禁外傳
  inner += '<label style="margin-top:16px;display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer"><input type="checkbox" id="libPermNoExport"' + (_libPermAcl.noExport ? ' checked' : '') + ' onchange="_libPermAcl.noExport=this.checked"> <span style="display:inline-flex;align-items:center;gap:4px">' + LIB_ICON.lock + ' 禁止 DD 把此夾的檔案撈到群組（敏感文件建議勾）</span></label>'
  // 動作
  inner += '<div style="margin-top:18px;display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap">'
    + '<div style="display:flex;gap:8px"><button class="mini" style="padding:8px 12px" onclick="libRenameFolder(\'' + _libPermId + '\')">資料夾改名</button>'
    + '<button class="mini" style="padding:8px 12px;color:#f87171" onclick="libDelFolder(\'' + _libPermId + '\')">刪除資料夾</button></div>'
    + '<button class="mini on" style="padding:8px 16px;font-weight:800" onclick="libPermSave()">儲存權限</button></div>'
  ov.innerHTML = '<div style="background:#1C2430;border:1px solid #39434F;border-radius:14px;max-width:520px;width:100%;padding:18px;margin:auto 0" onclick="event.stopPropagation()">' + inner + '</div>'
  ov.onclick = () => ov.remove()
  document.body.appendChild(ov)
}
function libPermSetRole(rl, v) { _libPermAcl.roles[rl] = +v }
function libPermSetUser(rid, v) { _libPermAcl.users[rid] = +v }
function libPermDelUser(rid) { delete _libPermAcl.users[rid]; const f = window._libD.folders.find(x => x.id === _libPermId); libPermRender(f ? f.name : '') }
function libPermAddUser(rid) { _libPermAcl.users[rid] = 1; const f = window._libD.folders.find(x => x.id === _libPermId); libPermRender(f ? f.name : '') }
async function libPermSave() {
  const r = await libPost('libfold', { op: 'setacl', id: _libPermId, acl: _libPermAcl })
  if (!r || !r.ok) { libToast((r && r.error) || '儲存失敗', true); return }
  libToast('權限已更新')
  const ov = document.getElementById('libPermOv'); if (ov) ov.remove()
  libLoad()
}
