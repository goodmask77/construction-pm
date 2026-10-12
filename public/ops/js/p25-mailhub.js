// 📬 信箱中樞 v4.70.79（批次1：多信箱接入＋來源排行＋規則＋預覽＋執行紀錄＋每日自動；張良 2026-10-12「重新建立一個信箱管理系統，我有很多個信箱要串接」；規格 docs/MAIL_HUB_PLAN.md）
// 主管限定；密碼只在新增／改密碼的輸入框出現一次，後端加密保存、永不回傳；單色 stroke SVG、無 emoji
const MH_ICON = {
  mail: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  scan: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"/></svg>',
  eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  link: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  shield: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
}
const MH_VER = '4779'
const MH_ACT = { archive: '封存', label: '貼標移出收件匣', trash: '移垃圾桶', keep: '保留（白名單）' }
const MH_ACTC = { archive: '#2563eb', label: '#7c3aed', trash: '#dc2626', keep: '#16a34a' }
const MH_FIELD = { from: '寄件者信箱', name: '寄件者名稱', subject: '主旨' }
const MH_CSS = `<style id="mhCss">
.mhWrap{display:flex;flex-direction:column;gap:14px}
.mhBar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.mhSeg{display:flex;gap:3px;flex-wrap:wrap;padding:3px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.mhSeg button{border:0;background:transparent;color:#C3CEDC;font-size:13px;font-weight:700;padding:6px 10px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:inherit}
.mhSeg button.on{background:var(--grad);color:#fff}
.mhSeg button .n{background:rgba(255,255,255,.18);border-radius:999px;font-size:11px;padding:0 6px;line-height:16px}
.mhSeg button:not(.on) .n{background:#2A3240}
.mhCard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}
.mhCard h3{margin:0 0 8px;font-size:15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mhCard h3 .sub{font-size:12px;color:var(--muted);font-weight:500}
.mhTbl{width:100%;border-collapse:collapse;font-size:13.5px}
.mhTbl th{font-size:12px;color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
.mhTbl td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
.mhTbl tr:last-child td{border-bottom:0}
.mhTbl .r{text-align:right;white-space:nowrap}
.mhTbl .act{display:flex;gap:4px;flex-wrap:wrap}
.mhScroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.mhTag{display:inline-block;border-radius:6px;font-size:11px;font-weight:700;padding:2px 7px;line-height:16px;color:#fff;white-space:nowrap}
.mhKw{display:inline-block;background:#2A3240;border-radius:6px;padding:1px 6px;font-size:12px;margin:1px 2px 1px 0}
.mhOk{color:#3DBE6C}.mhBad{color:#F07373}
.mhBtn{border:1px solid var(--line);background:transparent;color:inherit;border-radius:8px;padding:4px 8px;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-family:inherit;white-space:nowrap}
.mhBtn.pri{background:var(--grad);border-color:transparent;color:#fff}
.mhBtn.red{border-color:#dc2626;color:#F07373}
.mhBtn:disabled{opacity:.45;cursor:default}
.mhIn{width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-size:16px;background:var(--card);color:inherit;font-family:inherit;box-sizing:border-box}
.mhLbl{font-size:12.5px;color:var(--muted);margin:10px 0 4px}
.mhNote{font-size:12.5px;color:var(--muted);line-height:1.5}
.mhLog{font-size:12.5px;line-height:1.5;padding:6px 0;border-bottom:1px solid var(--line)}
.mhLog:last-child{border-bottom:0}
.mhChk{display:flex;gap:10px;flex-wrap:wrap}
.mhChk label{display:flex;align-items:center;gap:5px;font-size:14px;cursor:pointer}
.mhH2{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mhH2 .ttl{white-space:nowrap;display:flex;align-items:center;gap:8px}
.mhWrap,.mhCard{max-width:100%;min-width:0}
@media(max-width:640px){.mhTbl{font-size:12.5px;min-width:620px}.mhTbl td,.mhTbl th{padding:6px 5px}.mhH2 .hint{flex-basis:100%}.mhBar .mhBtn{font-size:12px;padding:4px 7px}}
</style>`
let _mhD = null, _mhBox = '*', _mhBusy = false
const mhEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const mhT = t => { if (!t) return '—'; try { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (_) { return '—' } }
async function mhGet(q) { try { const r = await fetch('/api/mail-sync?mailhub=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK() || '') + '&' + q + '&r=' + Date.now()); return await r.json() } catch (e) { return { ok: false, error: '連不上伺服器' } } }
async function mhPost(body) { try { const r = await fetch('/api/mail-sync?mailhub=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TK() }) }); return await r.json() } catch (e) { return { ok: false, error: '連不上伺服器' } } }
function mhModal(inner, wide) {
  const old = document.getElementById('mhOv'); if (old) old.remove()
  const ov = document.createElement('div'); ov.id = 'mhOv'
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,22,.6);z-index:80;display:flex;align-items:center;justify-content:center;padding:14px'
  ov.onclick = () => ov.remove()
  ov.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--bg);border:1px solid var(--line);border-radius:16px;width:100%;max-width:${wide ? 760 : 540}px;max-height:90vh;overflow:auto;padding:16px">${inner}</div>`
  document.body.appendChild(ov); return ov
}
const mhClose = () => { const o = document.getElementById('mhOv'); if (o) o.remove() }
const mhToast = (m, bad) => { try { libToast(m, bad) } catch (_) { alert(m) } }
const mhBoxName = id => id === '*' ? '全部信箱' : ((((_mhD || {}).boxes) || []).find(b => b.id === id) || {}).name || id

async function mailhubLoad() {
  curStore = 'mail'; setTabs('mail')
  const b = document.getElementById('tab-mail'); if (b) b.className = 'on'
  document.getElementById('upd').textContent = '信箱'
  if (!_mhD) app.innerHTML = '<section><h2>信箱</h2><div class="hint">讀取中…</div></section>'
  const d = await mhGet('op=list')
  if (!d || !d.ok) { app.innerHTML = '<section><h2>信箱</h2><div class="mhCard" style="font-size:15px">' + mhEsc((d && d.error) || '讀不到信箱資料') + '</div></section>'; return }
  _mhD = d
  if (_mhBox !== '*' && !d.boxes.some(b => b.id === _mhBox)) _mhBox = '*'
  mhRender()
}
async function mhReload() { const d = await mhGet('op=list'); if (d && d.ok) { _mhD = d; if (curStore === 'mail') mhRender() } }

function mhRender() {
  const d = _mhD; if (!d) return
  const boxes = d.boxes || [], rules = d.rules || []
  const cur = _mhBox
  const seg = `<div class="mhSeg"><button class="${cur === '*' ? 'on' : ''}" onclick="mhPick('*')">全部<span class="n">${boxes.length}</span></button>${boxes.map(b => `<button class="${cur === b.id ? 'on' : ''}" onclick="mhPick('${b.id}')" style="${b.on ? '' : 'opacity:.5'}">${mhEsc(b.name)}${b.scan && b.scan.unseen ? `<span class="n">${b.scan.unseen}</span>` : ''}</button>`).join('')}</div>`
  const encWarn = d.encReady ? '' : `<div class="mhCard mhBad">後台還沒設定密碼加密金鑰，暫時不能新增信箱（找 CC 處理）。</div>`
  app.innerHTML = MH_CSS + `<section><h2 class="mhH2"><span class="ttl">${MH_ICON.mail} 信箱</span><span class="hint" style="font-size:12px;font-weight:500">每天 07:00 自動套用「已確認」的規則；不刪信，只封存／貼標／移垃圾桶（30 天可救回）</span></h2>
  <div class="mhWrap">
    <div class="mhBar">${seg}
      <span style="flex:1"></span>
      <button class="mhBtn pri" onclick="mhBoxForm()" ${d.encReady ? '' : 'disabled'}>${MH_ICON.plus} 新增信箱</button>
      <button class="mhBtn" onclick="mhScan('${cur}')">${MH_ICON.scan} 重新掃描</button>
      <button class="mhBtn" onclick="mhApply('${cur}', null, false)">${MH_ICON.play} 執行已確認規則</button>
    </div>
    ${encWarn}
    ${mhBoxesCard(boxes)}
    ${mhSendersCard(boxes)}
    ${mhRulesCard(rules, boxes)}
    ${mhLogCard(d.log || [])}
  </div></section>`
}
function mhPick(id) { _mhBox = id; mhRender() }

function mhBoxesCard(boxes) {
  if (!boxes.length) return `<div class="mhCard"><h3>信箱清單</h3><div class="mhNote">還沒接任何信箱。按右上「新增信箱」，填名稱、帳號、應用程式密碼就接上。</div></div>`
  const rows = boxes.map(b => {
    const st = b.lastErr ? `<span class="mhBad" title="${mhEsc(b.lastErr)}">連線失敗</span>` : b.lastOk ? `<span class="mhOk">正常</span>` : `<span class="hint">未測</span>`
    const sc = b.scan ? `${b.scan.inboxCount} 封／未讀 ${b.scan.unseen}<div class="hint" style="font-size:11.5px">近 ${b.scan.days} 天・${mhT(b.scan.scannedAt)}</div>` : `<span class="hint">還沒掃描</span>`
    return `<tr style="${b.on ? '' : 'opacity:.55'}"><td><b>${mhEsc(b.name)}</b>${b.src === 'env' ? '<div class="hint" style="font-size:11px">系統設定</div>' : ''}${b.note ? `<div class="hint" style="font-size:11.5px">${mhEsc(b.note)}</div>` : ''}</td><td>${mhEsc(b.user)}<div class="hint" style="font-size:11px">${mhEsc(b.host)}</div></td><td>${st}${b.lastErr ? `<div class="hint" style="font-size:11px;max-width:220px">${mhEsc(b.lastErr)}</div>` : ''}</td><td>${sc}</td>
      <td><div class="act"><button class="mhBtn" onclick="mhBoxTest('${b.id}')" title="測連線">${MH_ICON.link}</button><button class="mhBtn" onclick="mhScan('${b.id}')" title="掃描">${MH_ICON.scan}</button>${b.src === 'env' ? '' : `<button class="mhBtn" onclick="mhBoxForm('${b.id}')" title="編輯">${MH_ICON.edit}</button>`}<button class="mhBtn" onclick="mhBoxToggle('${b.id}', ${b.on ? 'false' : 'true'})">${b.on ? '停用' : '啟用'}</button>${b.src === 'env' ? '' : `<button class="mhBtn red" onclick="mhBoxDel('${b.id}')" title="移除">${MH_ICON.trash}</button>`}</div></td></tr>`
  }).join('')
  return `<div class="mhCard"><h3>信箱清單 <span class="sub">${boxes.filter(b => b.on).length} 個啟用</span></h3><div class="mhScroll"><table class="mhTbl"><thead><tr><th>名稱</th><th>帳號</th><th>連線</th><th>收件匣</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`
}
function mhSendersCard(boxes) {
  const sel = _mhBox === '*' ? boxes : boxes.filter(b => b.id === _mhBox)
  const agg = {}
  sel.forEach(b => ((b.scan || {}).senders || []).forEach(s => { const a = agg[s.from] = agg[s.from] || { from: s.from, name: s.name, count: 0, unseen: 0, latest: '', sample: '', boxes: new Set() }; a.count += s.count; a.unseen += s.unseen || 0; a.boxes.add(b.name); if (s.latest > a.latest) { a.latest = s.latest; a.sample = s.sample; if (s.name) a.name = s.name } }))
  const list = Object.values(agg).sort((a, b) => b.count - a.count).slice(0, 40)
  const rules = (_mhD || {}).rules || []
  const ruleOf = from => rules.find(r => r.fields.includes('from') && r.kw.some(k => from.includes(k)))
  if (!list.length) return `<div class="mhCard"><h3>誰寄最多 <span class="sub">${mhEsc(mhBoxName(_mhBox))}</span></h3><div class="mhNote">還沒有掃描資料。按「重新掃描」讀近 7 天的收件匣（唯讀，不會動任何信）。</div></div>`
  const rows = list.map(s => { const r = ruleOf(s.from); return `<tr><td><b>${mhEsc(s.name || s.from.split('@')[0])}</b><div class="hint" style="font-size:11.5px;word-break:break-all">${mhEsc(s.from)}</div>${_mhBox === '*' && s.boxes.size ? `<div class="hint" style="font-size:11px">${mhEsc([...s.boxes].join('、'))}</div>` : ''}</td><td class="r"><b>${s.count}</b>${s.unseen ? `<div class="hint" style="font-size:11px">未讀 ${s.unseen}</div>` : ''}</td><td><div style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${mhEsc(s.sample)}">${mhEsc(s.sample)}</div><div class="hint" style="font-size:11px">${mhEsc(s.latest)}</div></td><td>${r ? `<span class="mhTag" style="background:${MH_ACTC[r.action]}">${MH_ACT[r.action]}</span>` : `<button class="mhBtn" data-from="${mhEsc(s.from)}" data-box="${_mhBox}" onclick="mhRuleForm(null, this.dataset)">${MH_ICON.plus} 建規則</button>`}</td></tr>` }).join('')
  return `<div class="mhCard"><h3>誰寄最多 <span class="sub">${mhEsc(mhBoxName(_mhBox))}・前 ${list.length} 名・點「建規則」就能把這家一次處理掉</span></h3><div class="mhScroll"><table class="mhTbl"><thead><tr><th>寄件者</th><th class="r">封數</th><th>最近一封</th><th>規則</th></tr></thead><tbody>${rows}</tbody></table></div></div>`
}
function mhRulesCard(rules, boxes) {
  const sel = _mhBox === '*' ? rules : rules.filter(r => r.box === '*' || r.box === _mhBox)
  const rows = sel.map(r => `<tr style="${r.on ? '' : 'opacity:.55'}"><td><span class="mhTag" style="background:${MH_ACTC[r.action]}">${MH_ACT[r.action]}</span>${r.action === 'label' ? `<div class="hint" style="font-size:11.5px">→ ${mhEsc(r.folder)}</div>` : ''}</td>
    <td><div class="hint" style="font-size:11px">${r.fields.map(f => MH_FIELD[f]).join('／')} 含</div>${r.kw.map(k => `<span class="mhKw">${mhEsc(k)}</span>`).join('')}${r.note ? `<div class="hint" style="font-size:11.5px">${mhEsc(r.note)}</div>` : ''}</td>
    <td>${mhEsc(mhBoxName(r.box))}</td>
    <td>${r.action === 'keep' ? `<span class="mhOk">白名單</span>` : r.confirmed ? `<span class="mhOk">已確認</span><div class="hint" style="font-size:11px">${mhEsc(r.confirmedBy)} ${mhT(r.confirmedAt)}</div>` : `<span class="hint">待預覽確認</span>`}</td>
    <td><div class="act"><button class="mhBtn" onclick="mhPreview('${r.id}')">${MH_ICON.eye} 預覽</button><button class="mhBtn" onclick="mhRuleForm('${r.id}')" title="編輯">${MH_ICON.edit}</button><button class="mhBtn" onclick="mhRuleToggle('${r.id}', ${r.on ? 'false' : 'true'})">${r.on ? '停用' : '啟用'}</button>${r.confirmed && r.action !== 'keep' ? `<button class="mhBtn" onclick="mhRuleConfirm('${r.id}', false)">取消確認</button>` : ''}<button class="mhBtn red" onclick="mhRuleDel('${r.id}')" title="刪除">${MH_ICON.trash}</button></div></td></tr>`).join('')
  return `<div class="mhCard"><h3>規則 <span class="sub">白名單永遠優先；每日自動只跑「已確認」的規則</span><span style="flex:1"></span><button class="mhBtn pri" onclick="mhRuleForm()">${MH_ICON.plus} 新增規則</button></h3>${sel.length ? `<div class="mhScroll"><table class="mhTbl"><thead><tr><th>動作</th><th>條件</th><th>範圍</th><th>狀態</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="mhNote">還沒有規則。從上面「誰寄最多」按「建規則」最快；或按「新增規則」自己填。</div>`}</div>`
}
function mhLogCard(log) {
  const ACT = { boxadd: '接上信箱', boxdel: '移除信箱', boxon: '啟用信箱', boxoff: '停用信箱', boxpass: '更新密碼', ruleadd: '新增規則', ruledel: '刪除規則', ruleok: '確認規則', ruleunok: '取消確認', archive: '封存', label: '貼標', trash: '移垃圾桶' }
  const rows = log.slice(0, 40).map(e => `<div class="mhLog"><span class="hint">${mhT(e.at)}</span> <b>${mhEsc(e.by || '')}</b> ${mhEsc(ACT[e.action] || e.action)}${e.n ? ` <b>${e.n}</b> 封${e.dry ? '（試算，沒動）' : e.moved != null && e.moved !== e.n ? `（實際 ${e.moved}）` : ''}` : ''} <span class="hint">${mhEsc(mhBoxName(e.box))}${e.note ? '・' + mhEsc(e.note) : ''}</span>${e.err ? `<div class="mhBad" style="font-size:12px">${mhEsc(e.err)}</div>` : ''}${e.samples && e.samples.length ? `<div class="hint" style="font-size:11.5px">${e.samples.map(s => mhEsc((s.from || '').split('@')[0] + '：' + (s.subject || ''))).join('；')}</div>` : ''}</div>`).join('')
  return `<div class="mhCard"><h3>執行紀錄 <span class="sub">最近 40 筆</span></h3>${rows || '<div class="mhNote">還沒有紀錄。</div>'}</div>`
}

// ── 信箱：新增／編輯／測連線／開關／移除 ──
function mhBoxForm(id) {
  const b = id ? (_mhD.boxes || []).find(x => x.id === id) : null
  mhModal(`<b style="font-size:16px">${b ? '編輯信箱' : '新增信箱'}</b>
    <div class="mhNote" style="margin-top:4px">Gmail／Google Workspace：到 Google 帳號 → 安全性 → 兩步驟驗證 → 應用程式密碼，產一組 16 碼貼下面。密碼加密保存，之後不會再顯示。</div>
    <div class="mhLbl">名稱（自己看的）</div><input id="mhBName" class="mhIn" value="${mhEsc(b ? b.name : '')}" placeholder="例：公司主信箱、廠商對帳">
    <div class="mhLbl">信箱帳號</div><input id="mhBUser" class="mhIn" value="${mhEsc(b ? b.user : '')}" placeholder="name@gmail.com" ${b ? 'disabled' : ''} inputmode="email" autocapitalize="off">
    <div class="mhLbl">${b ? '新密碼（不改就留空）' : '應用程式密碼'}</div><input id="mhBPass" class="mhIn" type="password" placeholder="${b ? '留空＝不改' : '16 碼，有空格沒關係'}" autocomplete="new-password">
    <div class="mhLbl">用途備註</div><input id="mhBNote" class="mhIn" value="${mhEsc(b ? b.note : '')}" placeholder="例：銀行通知、104 招募">
    <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">不是 Google 信箱？設 IMAP 主機</summary><div class="mhLbl">IMAP 主機</div><input id="mhBHost" class="mhIn" value="${mhEsc(b ? b.host : 'imap.gmail.com')}"><div class="mhLbl">連接埠</div><input id="mhBPort" class="mhIn" value="${b ? b.port : 993}" inputmode="numeric"></details>
    <div id="mhBMsg" class="mhNote" style="margin-top:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mhBtn" onclick="mhClose()">取消</button><button class="mhBtn pri" id="mhBGo" onclick="mhBoxSave('${id || ''}')">${MH_ICON.check} ${b ? '儲存' : '測連線並接上'}</button></div>`)
}
async function mhBoxSave(id) {
  const v = k => (document.getElementById(k) || {}).value || ''
  const body = { name: v('mhBName').trim(), note: v('mhBNote').trim(), host: v('mhBHost').trim(), port: +v('mhBPort') || 993 }
  const pass = v('mhBPass'); if (pass) body.pass = pass
  const msg = document.getElementById('mhBMsg'), go = document.getElementById('mhBGo')
  if (!id) { body.user = v('mhBUser').trim(); if (!body.user || !pass) { msg.textContent = '帳號和應用程式密碼都要填'; msg.className = 'mhNote mhBad'; return } }
  go.disabled = true; msg.className = 'mhNote'; msg.textContent = '連線測試中（最多 30 秒）…'
  const d = id ? await mhPost({ op: 'boxset', id, ...body }) : await mhPost({ op: 'boxadd', ...body })
  go.disabled = false
  if (!d || !d.ok) { msg.textContent = (d && d.error) || '失敗'; msg.className = 'mhNote mhBad'; return }
  mhClose(); mhToast(id ? '已儲存' : `接上了：${d.box.user}（收件匣 ${d.test.messages} 封／未讀 ${d.test.unseen}）`)
  await mhReload()
  if (!id) mhScan(d.box.id)
}
async function mhBoxTest(id) {
  mhToast('連線測試中…')
  const d = await mhPost({ op: 'boxtest', id })
  if (d && d.ok) mhToast(`連線正常：收件匣 ${d.messages} 封／未讀 ${d.unseen}（${d.ms} ms）`); else mhToast('連不上：' + ((d && d.error) || ''), true)
}
async function mhBoxToggle(id, on) { const d = await mhPost({ op: 'boxset', id, on }); if (!d || !d.ok) return mhToast((d && d.error) || '失敗', true); await mhReload() }
async function mhBoxDel(id) {
  const b = (_mhD.boxes || []).find(x => x.id === id) || {}
  if (!confirm(`移除信箱「${b.name}」？\n只是不再管理這個信箱，信件本身不會動；這個信箱專屬的規則會一起拿掉。`)) return
  const d = await mhPost({ op: 'boxdel', id }); if (!d || !d.ok) return mhToast((d && d.error) || '失敗', true)
  mhToast('已移除'); if (_mhBox === id) _mhBox = '*'; await mhReload()
}
async function mhScan(box) {
  const ids = box === '*' ? (_mhD.boxes || []).filter(b => b.on).map(b => b.id) : [box]
  if (!ids.length) return mhToast('沒有啟用的信箱', true)
  if (_mhBusy) return; _mhBusy = true
  const days = 7
  mhToast(`掃描中（${ids.length} 個信箱，近 ${days} 天）…`)
  let bad = 0
  for (const id of ids) { const d = await mhGet('op=scan&box=' + encodeURIComponent(id) + '&days=' + days); if (!d || !d.ok) { bad++; mhToast(mhBoxName(id) + '：' + ((d && d.error) || '掃描失敗'), true) } }
  _mhBusy = false
  if (!bad) mhToast('掃描完成')
  await mhReload()
}

// ── 規則：新增／編輯／預覽／確認／執行 ──
function mhRuleForm(id, pre) {
  const r = id ? (_mhD.rules || []).find(x => x.id === id) : null
  pre = pre || {}
  const boxes = _mhD.boxes || []
  const fields = r ? r.fields : ['from']
  const kw = r ? r.kw.join('\n') : (pre.from || '')
  const box = r ? r.box : (pre.box || '*')
  const action = r ? r.action : 'archive'
  mhModal(`<b style="font-size:16px">${r ? '編輯規則' : '新增規則'}</b>
    <div class="mhLbl">看哪裡</div><div class="mhChk">${Object.keys(MH_FIELD).map(f => `<label><input type="checkbox" class="mhRF" value="${f}" ${fields.includes(f) ? 'checked' : ''}>${MH_FIELD[f]}</label>`).join('')}</div>
    <div class="mhLbl">含這些字（一行一個，任一個符合就算；不分大小寫）</div><textarea id="mhRKw" class="mhIn" rows="3" placeholder="例：noreply@facebookmail.com&#10;電子報">${mhEsc(kw)}</textarea>
    <div class="mhLbl">動作</div><div class="mhChk">${Object.keys(MH_ACT).map(a => `<label><input type="radio" name="mhRA" value="${a}" ${action === a ? 'checked' : ''} onchange="document.getElementById('mhRFold').style.display=this.value==='label'?'':'none'">${MH_ACT[a]}</label>`).join('')}</div>
    <div id="mhRFold" style="${action === 'label' ? '' : 'display:none'}"><div class="mhLbl">資料夾／標籤名稱（沒有會自動建）</div><input id="mhRFolder" class="mhIn" value="${mhEsc(r ? r.folder : '')}" placeholder="例：電子報"></div>
    <div class="mhLbl">套用到</div><select id="mhRBox" class="mhIn"><option value="*" ${box === '*' ? 'selected' : ''}>全部信箱</option>${boxes.map(b => `<option value="${b.id}" ${box === b.id ? 'selected' : ''}>${mhEsc(b.name)}</option>`).join('')}</select>
    <div class="mhLbl">備註</div><input id="mhRNote" class="mhIn" value="${mhEsc(r ? r.note : '')}" placeholder="例：Meta 的信一律留著">
    <div class="mhNote" style="margin-top:8px">「移垃圾桶」的信 30 天內可從信箱垃圾桶救回；不會永久刪除。存好後要先「預覽」看會動到哪些信，確認了每天才會自動跑。</div>
    <div id="mhRMsg" class="mhNote mhBad" style="margin-top:6px"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px;flex-wrap:wrap"><button class="mhBtn" onclick="mhPreviewDraft()">${MH_ICON.eye} 先預覽</button><div style="display:flex;gap:8px"><button class="mhBtn" onclick="mhClose()">取消</button><button class="mhBtn pri" onclick="mhRuleSave('${id || ''}')">${MH_ICON.check} 儲存</button></div></div>`)
}
function mhRuleRead() {
  const fields = [...document.querySelectorAll('.mhRF:checked')].map(x => x.value)
  const action = (document.querySelector('input[name=mhRA]:checked') || {}).value || 'archive'
  return { fields, kw: (document.getElementById('mhRKw') || {}).value || '', action, folder: (document.getElementById('mhRFolder') || {}).value || '', box: (document.getElementById('mhRBox') || {}).value || '*', note: (document.getElementById('mhRNote') || {}).value || '' }
}
async function mhRuleSave(id) {
  const rule = mhRuleRead(), msg = document.getElementById('mhRMsg')
  if (!rule.fields.length) { msg.textContent = '至少勾一個「看哪裡」'; return }
  if (!rule.kw.trim()) { msg.textContent = '至少填一個關鍵字'; return }
  if (rule.action === 'label' && !rule.folder.trim()) { msg.textContent = '貼標要填資料夾名稱'; return }
  const d = id ? await mhPost({ op: 'ruleset', id, rule }) : await mhPost({ op: 'ruleadd', rule })
  if (!d || !d.ok) { msg.textContent = (d && d.error) || '失敗'; return }
  mhClose(); mhToast(id ? '規則已更新（條件有改會要重新預覽確認）' : '規則已存，接著按「預覽」看會動到哪些信')
  await mhReload()
}
async function mhPreviewDraft() {
  const rule = mhRuleRead(); const msg = document.getElementById('mhRMsg')
  if (!rule.kw.trim()) { msg.textContent = '先填關鍵字'; return }
  const d = await mhPost({ op: 'preview', rule })
  if (!d || !d.ok) { msg.textContent = (d && d.error) || '失敗'; return }
  mhPreviewShow(d, null)
}
async function mhPreview(id) { mhToast('計算中…'); const d = await mhGet('op=preview&rule=' + encodeURIComponent(id)); if (!d || !d.ok) return mhToast((d && d.error) || '失敗', true); mhPreviewShow(d, id) }
function mhPreviewShow(d, id) {
  const r = d.rule
  const body = (d.boxes || []).map(b => `<div class="mhCard" style="margin-top:8px"><h3>${mhEsc(b.name)} <span class="sub">${b.noScan ? '還沒掃描，先按「重新掃描」' : `近 ${b.days} 天會動到 <b>${b.n}</b> 封${b.kept ? `，另有 ${b.kept} 封因白名單保留` : ''}`}</span></h3>${b.mails && b.mails.length ? `<div class="mhScroll"><table class="mhTbl"><thead><tr><th>日期</th><th>寄件者</th><th>主旨</th></tr></thead><tbody>${b.mails.map(m => `<tr><td style="white-space:nowrap">${mhEsc(m.date)}</td><td>${mhEsc(m.name || m.from)}<div class="hint" style="font-size:11px">${mhEsc(m.from)}</div></td><td>${mhEsc(m.subject)}</td></tr>`).join('')}</tbody></table></div>${b.n > b.mails.length ? `<div class="hint">只列前 ${b.mails.length} 封</div>` : ''}` : ''}</div>`).join('')
  const isKeep = r.action === 'keep'
  mhModal(`<b style="font-size:16px">預覽：<span class="mhTag" style="background:${MH_ACTC[r.action]}">${MH_ACT[r.action]}</span> ${r.kw.map(k => `<span class="mhKw">${mhEsc(k)}</span>`).join('')}</b>
    <div class="mhNote" style="margin-top:4px">用最近一次掃描的結果算的；總共 <b>${d.total}</b> 封。${isKeep ? '白名單只是保護，不會動信。' : '確認後每天 07:00 會自動對新進的信做同樣處理。'}</div>
    ${body}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap"><button class="mhBtn" onclick="mhClose()">關閉</button>${id && !isKeep ? `<button class="mhBtn" onclick="mhRuleConfirm('${id}', true)">${MH_ICON.check} 確認，每天自動跑</button><button class="mhBtn pri" onclick="mhRuleConfirm('${id}', true, true)">${MH_ICON.play} 確認並現在執行</button>` : ''}</div>`, true)
}
async function mhRuleConfirm(id, on, run) {
  const d = await mhPost({ op: 'ruleset', id, confirmed: on }); if (!d || !d.ok) return mhToast((d && d.error) || '失敗', true)
  mhClose(); mhToast(on ? '已確認' : '已取消確認')
  await mhReload()
  if (run) { const r = (_mhD.rules || []).find(x => x.id === id); mhApply(r && r.box !== '*' ? r.box : '*', [id], false) }
}
async function mhRuleToggle(id, on) { const d = await mhPost({ op: 'ruleset', id, on }); if (!d || !d.ok) return mhToast((d && d.error) || '失敗', true); await mhReload() }
async function mhRuleDel(id) { if (!confirm('刪除這條規則？')) return; const d = await mhPost({ op: 'ruledel', id }); if (!d || !d.ok) return mhToast((d && d.error) || '失敗', true); await mhReload() }
async function mhApply(box, ids, dry) {
  if (_mhBusy) return; _mhBusy = true
  mhToast('執行中…（連信箱搬信，可能要幾十秒）')
  const d = await mhPost({ op: 'apply', box: box || '*', ids: ids || undefined, dry: !!dry, days: 7 })
  _mhBusy = false
  if (!d || !d.ok) return mhToast((d && d.error) || '失敗', true)
  const list = d.boxes ? d.boxes : [d]
  const html = list.map(x => `<div class="mhCard" style="margin-top:8px"><h3>${mhEsc(x.name || mhBoxName(x.box))} <span class="sub">${x.ok ? `掃了 ${x.scanned || 0} 封，動了 <b>${x.n || 0}</b> 封${x.note ? '・' + mhEsc(x.note) : ''}` : `<span class="mhBad">${mhEsc(x.error || '失敗')}</span>`}</span></h3>${(x.groups || []).map(g => `<div class="mhLog"><span class="mhTag" style="background:${MH_ACTC[g.action]}">${MH_ACT[g.action]}</span> ${g.kw.map(k => `<span class="mhKw">${mhEsc(k)}</span>`).join('')} <b>${g.n}</b> 封${g.err ? `<div class="mhBad">${mhEsc(g.err)}</div>` : ''}<div class="hint" style="font-size:11.5px">${(g.samples || []).map(s => mhEsc((s.from || '').split('@')[0] + '：' + (s.subject || ''))).join('；')}</div></div>`).join('')}</div>`).join('')
  mhModal(`<b style="font-size:16px">執行結果${dry ? '（試算，沒動信）' : ''}</b>${html}<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="mhBtn pri" onclick="mhClose()">好</button></div>`, true)
  await mhReload()
}
