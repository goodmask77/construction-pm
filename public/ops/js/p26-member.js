// 🪪 會員（GD 分頁）v4.70.83 第一批｜docs/MEMBER_PLAN_v1.md（張良 2026-10-12：現場入點＝輸會員號碼或掃會員 QR）
// 名單搜尋／每人卡（資料、流水、券、消費）／入點（掃 QR 或會員號碼＋金額＋單號選填）／兌換（櫃檯直接扣點）／手動調整（留痕）／店員建會員／設定（主管）
// 掃 QR 沿用排行榜那套 Html5Qrcode（index 已載）；後端 api/_member.js；客人卡 /member（LIFF）
let _mbD = null, _mbCur = null, _mbQ = '', _mbT = null
const mbEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const mbN = n => Math.round(Number(n) || 0).toLocaleString('zh-TW')
async function mbGet (q) { try { const r = await fetch('/api/mail-sync?member=' + encodeURIComponent(K) + '&me=' + encodeURIComponent(TK() || '') + '&' + q + '&r=' + Date.now()); return await r.json() } catch (_) { return null } }
async function mbPost (b) { try { const r = await fetch('/api/mail-sync?member=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, token: TK() }) }); return await r.json() } catch (_) { return null } }
function mbToast (t, bad) { let el = document.getElementById('mbToast'); if (!el) { el = document.createElement('div'); el.id = 'mbToast'; el.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:95;padding:9px 16px;border-radius:10px;font-weight:800;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:opacity .3s'; document.body.appendChild(el) } el.style.background = bad ? '#b91c1c' : '#166534'; el.style.color = '#fff'; el.textContent = t; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0' }, 2600) }
function mbModal (inner, w) { const old = document.getElementById('mbOv'); if (old) old.remove(); const ov = document.createElement('div'); ov.id = 'mbOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:14px'; ov.innerHTML = `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:18px;width:min(${w || 520}px,100%);max-height:92vh;overflow:auto" onclick="event.stopPropagation()">${inner}</div>`; ov.onclick = () => ov.remove(); document.body.appendChild(ov); return ov }
const mbClose = () => { const o = document.getElementById('mbOv'); if (o) o.remove() }
const mbIn = (id, extra, v, ph) => `<input id="${id}" value="${mbEsc(v || '')}" placeholder="${mbEsc(ph || '')}" ${extra || ''} style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card);color:inherit;font-size:14px">`
const mbReq = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

async function memberLoad (id) {
  curStore = 'member'; setTabs('member')
  const b = document.getElementById('tab-member'); if (b) b.className = 'on'
  try { document.getElementById('upd').textContent = '會員' } catch (_) {}
  if (!_mbD) app.innerHTML = '<section><h2>會員</h2><div class="hint">讀取中…</div></section>'
  const d = await mbGet('op=list' + (_mbQ ? '&q=' + encodeURIComponent(_mbQ) : ''))
  if (!d || !d.ok) { app.innerHTML = '<section><h2>會員</h2><div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px">' + mbEsc((d && d.error) || '讀不到會員') + '</div></section>'; return }
  _mbD = d
  if (id) return mbOpen(id)
  _mbCur = null; mbRenderList()
  try { history.replaceState(null, '', location.pathname + location.search + '#tab=member') } catch (_) {}
}
function mbRenderList () {
  const d = _mbD, s = d.stats || {}
  const kpi = (l, v, sub) => `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;min-width:120px"><div class="hint" style="font-size:12px">${l}</div><div style="font-size:22px;font-weight:900">${v}</div>${sub ? `<div class="hint" style="font-size:11.5px">${sub}</div>` : ''}</div>`
  app.innerHTML = `<section>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><h2 style="margin:0">會員</h2><span class="hint">${d.liff ? '客人會員卡：LINE 官方帳號 → 會員卡' : '<span style="color:#d97706;font-weight:800">LINE 登入還沒開通（LIFF ID 未設）</span>：客人暫時無法自己入會，先由店員建會員'}</span><span style="flex:1"></span>
      ${d.me.canEdit ? `<button class="mini on" onclick="mbEarn()">入點</button><button class="mini" onclick="mbRedeem()">兌換</button><button class="mini" onclick="mbCreate()">＋ 建會員</button>` : ''}${d.me.mgr ? `<button class="mini" onclick="mbCfg()">設定</button>` : ''}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${kpi('會員數', mbN(s.members))}${kpi('今日入點', '+' + mbN(s.todayEarn), '今日兌換 −' + mbN(s.todayUsed))}${kpi('未用點數', mbN(s.outstanding), '每 ' + (d.cfg || {}).perAmt + ' 元 1 點')}</div>
    <div style="display:flex;gap:8px;margin-bottom:10px"><input id="mbSearch" value="${mbEsc(_mbQ)}" placeholder="搜名字／手機／會員號碼" onkeydown="if(event.key==='Enter'){_mbQ=this.value.trim();memberLoad()}" style="flex:1;max-width:360px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card);color:inherit;font-size:14px"><button class="mini" onclick="_mbQ=document.getElementById('mbSearch').value.trim();memberLoad()">搜尋</button>${_mbQ ? `<button class="mini" onclick="_mbQ='';memberLoad()">清除</button>` : ''}</div>
    ${(d.list || []).length ? `<div style="overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:14px;background:var(--card)"><thead><tr style="text-align:left"><th style="padding:8px;border:1px solid var(--line)">會員</th><th style="padding:8px;border:1px solid var(--line)">會員號碼</th><th style="padding:8px;border:1px solid var(--line)">手機</th><th style="padding:8px;border:1px solid var(--line);text-align:right">點數</th><th style="padding:8px;border:1px solid var(--line)">來源</th><th style="padding:8px;border:1px solid var(--line)">加入</th></tr></thead><tbody>
      ${d.list.map(m => `<tr style="cursor:pointer;${m.status !== 'active' ? 'opacity:.5' : ''}" onclick="mbOpen('${m.id}')"><td style="padding:8px;border:1px solid var(--line);font-weight:800">${m.pic ? `<img src="${mbEsc(m.pic)}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:6px;object-fit:cover">` : ''}${mbEsc(m.name || '—')}${m.status !== 'active' ? ' <span class="hint">(' + ({ left: '已退會', blocked: '停用' })[m.status] + ')</span>' : ''}</td><td style="padding:8px;border:1px solid var(--line);font-family:monospace;font-size:15px">${mbEsc(m.mno || '')}</td><td style="padding:8px;border:1px solid var(--line)">${mbEsc(m.phone || '')}</td><td style="padding:8px;border:1px solid var(--line);text-align:right;font-weight:800">${mbN(m.balance)}</td><td style="padding:8px;border:1px solid var(--line)">${m.src === 'line' ? 'LINE' : '店員建'}</td><td style="padding:8px;border:1px solid var(--line)" class="hint">${mbEsc(String(m.created_at || '').slice(0, 10))}</td></tr>`).join('')}
    </tbody></table></div>` : `<div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:18px;font-size:15px" class="hint">${_mbQ ? '找不到' : '還沒有會員。客人從 GROUN:D 官方帳號打開會員卡入會，或按「＋ 建會員」現場建。'}</div>`}
  </section>`
}
async function mbOpen (id) {
  const d = await mbGet('op=get&id=' + encodeURIComponent(id)); if (!d || !d.ok) return mbToast((d && d.error) || '讀不到', true)
  _mbCur = d; mbRenderDetail()
  try { history.replaceState(null, '', location.pathname + location.search + '#tab=member&id=' + id) } catch (_) {}
}
function mbRenderDetail () {
  const { member: m, balance, earned, used, ledger, coupons, visits } = _mbCur, me = _mbD.me
  const KIND = { earn: '消費累點', spend: '兌換', adjust: '調整', welcome: '入會禮', game: '遊戲', reverse: '沖回' }
  app.innerHTML = `<section>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button class="mini" onclick="memberLoad()">‹ 名單</button>${m.pic ? `<img src="${mbEsc(m.pic)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover">` : ''}<h2 style="margin:0">${mbEsc(m.name)}</h2><span class="hint">會員號碼 <b style="font-family:monospace;font-size:16px">${mbEsc(m.mno || '')}</b>・${m.hasLine ? 'LINE 已綁' : '沒綁 LINE（店員建）'}・${m.status === 'active' ? '正常' : m.status === 'left' ? '已退會' : '停用'}</span><span style="flex:1"></span>
      ${me.canEdit && m.status === 'active' ? `<button class="mini on" onclick="mbEarn('${m.id}')">入點</button><button class="mini" onclick="mbRedeem('${m.id}')">兌換</button><button class="mini" onclick="mbAdjust('${m.id}')">手動調整</button><button class="mini" onclick="mbEdit()">編輯資料</button>` : ''}</div>
    <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:12px;align-items:start" class="mbGrid">
      <div style="display:grid;gap:12px;min-width:0">
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px"><div style="display:flex;gap:18px;flex-wrap:wrap"><div><div class="hint">可用點數</div><div style="font-size:30px;font-weight:900;color:var(--red)">${mbN(balance)}</div></div><div><div class="hint">累計獲得</div><div style="font-size:20px;font-weight:800">${mbN(earned)}</div></div><div><div class="hint">累計使用</div><div style="font-size:20px;font-weight:800">${mbN(used)}</div></div><div><div class="hint">手機</div><div style="font-size:16px;font-weight:800">${mbEsc(m.phone || '—')}</div></div><div><div class="hint">生日</div><div style="font-size:16px;font-weight:800">${mbEsc(m.birthday || '—')}</div></div><div><div class="hint">加入</div><div style="font-size:16px;font-weight:800">${mbEsc(String(m.created_at || '').slice(0, 10))}</div></div></div>${m.note ? `<div class="hint" style="margin-top:8px">內部備註：${mbEsc(m.note)}</div>` : ''}</div>
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px"><b>點數流水</b><div style="overflow:auto;margin-top:6px"><table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="text-align:left"><th style="padding:6px;border:1px solid var(--line)">時間</th><th style="padding:6px;border:1px solid var(--line)">類別</th><th style="padding:6px;border:1px solid var(--line);text-align:right">點數</th><th style="padding:6px;border:1px solid var(--line);text-align:right">消費</th><th style="padding:6px;border:1px solid var(--line)">說明</th><th style="padding:6px;border:1px solid var(--line)">操作者</th></tr></thead><tbody>${(ledger || []).map(l => `<tr><td style="padding:6px;border:1px solid var(--line);white-space:nowrap" class="hint">${mbEsc(String(l.created_at).slice(5, 16).replace('T', ' '))}</td><td style="padding:6px;border:1px solid var(--line)">${KIND[l.kind] || l.kind}</td><td style="padding:6px;border:1px solid var(--line);text-align:right;font-weight:800;color:${l.pts > 0 ? '#16a34a' : 'var(--red)'}">${l.pts > 0 ? '+' : ''}${mbN(l.pts)}</td><td style="padding:6px;border:1px solid var(--line);text-align:right">${l.amount ? mbN(l.amount) : ''}</td><td style="padding:6px;border:1px solid var(--line)">${mbEsc(l.note || '')}</td><td style="padding:6px;border:1px solid var(--line)">${mbEsc(l.by_name || '系統')}</td></tr>`).join('') || '<tr><td colspan="6" class="hint" style="padding:10px">還沒有紀錄</td></tr>'}</tbody></table></div></div>
      </div>
      <div style="display:grid;gap:12px;min-width:0">
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px;font-size:13.5px"><b>兌換紀錄</b><div style="margin-top:6px;display:grid;gap:4px">${(coupons || []).map(c => `<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line);padding:4px 0"><span>${mbEsc(c.name)}<div class="hint" style="font-size:11.5px">${mbEsc(String(c.created_at).slice(0, 16).replace('T', ' '))}・${mbEsc(c.redeemed_by || '')}</div></span><span>${c.pts_cost ? '−' + c.pts_cost + ' 點' : ''}</span></div>`).join('') || '<span class="hint">—</span>'}</div></div>
        <div style="background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:12px;font-size:13.5px"><b>消費紀錄</b><div style="margin-top:6px;display:grid;gap:4px">${(visits || []).map(v => `<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line);padding:4px 0"><span>${mbEsc(String(v.created_at).slice(5, 16).replace('T', ' '))}<div class="hint" style="font-size:11.5px">${mbEsc((v.external_ref || '').replace(/^pos:/, '單號 ').replace(/^req:.*/, '')) }${v.by_name ? '・' + mbEsc(v.by_name) : ''}</div></span><b>${mbN(v.amount)}</b></div>`).join('') || '<span class="hint">—</span>'}</div></div>
      </div>
    </div>
    <style>@media(max-width:900px){.mbGrid{grid-template-columns:1fr !important}}</style>
  </section>`
}
// ── 找人（掃 QR 或會員號碼）──
function mbKeyBox (id) { return `<div style="display:flex;gap:6px"><input id="${id}" placeholder="會員號碼（6 碼）或手機" inputmode="numeric" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:9px 10px;background:var(--card);color:inherit;font-size:16px;letter-spacing:.08em"><button class="mini" onclick="mbScan('${id}')">掃 QR</button></div><div id="${id}_who" class="hint" style="margin-top:4px;min-height:18px"></div>` }
function mbScan (targetId) {
  if (typeof Html5Qrcode === 'undefined') return mbToast('掃碼元件還沒載入，請改輸會員號碼', true)
  const ov = document.createElement('div'); ov.id = 'mbScOv'; ov.style.cssText = 'position:fixed;inset:0;background:rgba(6,9,13,.92);z-index:90;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px'
  ov.innerHTML = `<div style="background:#111820;border:1px solid #2A3240;border-radius:16px;padding:16px;max-width:380px;width:100%"><div style="font-weight:800;color:#fff;margin-bottom:8px">掃客人的會員卡 QR</div><div id="mbReader" style="width:100%;border-radius:12px;overflow:hidden"></div><div id="mbScMsg" class="hint" style="margin-top:8px;font-size:12px">把鏡頭對準客人手機上的 QR…</div><div style="text-align:right;margin-top:10px"><button class="mini" style="padding:8px 16px" onclick="mbScanStop()">關閉</button></div></div>`
  ov.onclick = e => { if (e.target === ov) mbScanStop() }; document.body.appendChild(ov)
  const h5 = new Html5Qrcode('mbReader'); window._mbH5 = h5
  h5.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, async (txt) => { if (window._mbBusy) return; window._mbBusy = true; mbScanStop(); const el = document.getElementById(targetId); if (el) { el.value = String(txt || '').trim(); await mbWho(targetId) } }, () => {}).catch(() => { const m = document.getElementById('mbScMsg'); if (m) m.innerHTML = '<span style="color:#F07373">開不了鏡頭（請允許相機權限，或改輸會員號碼）</span>' })
}
function mbScanStop () { window._mbBusy = false; try { if (window._mbH5) { window._mbH5.stop().then(() => { try { window._mbH5.clear() } catch (_) {} window._mbH5 = null }).catch(() => { window._mbH5 = null }) } } catch (_) {} const ov = document.getElementById('mbScOv'); if (ov) ov.remove() }
async function mbWho (id) { const el = document.getElementById(id), w = document.getElementById(id + '_who'); if (!el || !el.value.trim()) return null; const d = await mbPost({ op: 'find', key: el.value.trim() }); if (w) w.innerHTML = d && d.ok ? `<b style="color:#16a34a">${mbEsc(d.member.name)}</b>（${mbEsc(d.member.mno)}）目前 ${mbN(d.balance)} 點` : `<span style="color:#d97706">${mbEsc((d && d.error) || '找不到')}</span>`; return d && d.ok ? d : null }
// ── 入點 ──
function mbEarn (memberId) {
  const cfg = _mbD.cfg || {}
  mbModal(`<h3 style="margin:0 0 8px">入點</h3>${memberId ? `<div class="hint" style="margin-bottom:8px">會員：<b>${mbEsc(_mbCur.member.name)}</b>（${mbEsc(_mbCur.member.mno)}）</div><input type="hidden" id="mbE_key" value="${memberId}">` : mbKeyBox('mbE_key')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><label class="hint">消費金額${mbIn('mbE_amt', 'type="number" inputmode="numeric" min="1"', '', '元')}</label><label class="hint">POS 單號（選填，防重複）${mbIn('mbE_pos', '', '', '例 A0123')}</label></div>
    <div class="hint" style="margin-top:6px">每 ${cfg.perAmt} 元 1 點；單筆超過 ${mbN(cfg.capSingle)} 元要主管。</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="mbClose()">取消</button><button class="mini on" id="mbE_go" onclick="mbEarnGo()">入點</button></div>`)
  const k = document.getElementById('mbE_key'); if (k && !memberId) { k.onchange = () => mbWho('mbE_key'); k.focus() } else { const a = document.getElementById('mbE_amt'); if (a) a.focus() }
}
async function mbEarnGo () {
  const key = (document.getElementById('mbE_key') || {}).value, amt = (document.getElementById('mbE_amt') || {}).value, pos = (document.getElementById('mbE_pos') || {}).value
  if (!key) return mbToast('先輸會員號碼或掃 QR', true); if (!(Number(amt) > 0)) return mbToast('請填金額', true)
  const b = document.getElementById('mbE_go'); b.disabled = true
  const d = await mbPost({ op: 'earn', key, amount: Number(amt), posNo: pos, reqId: mbReq() })
  if (!d || !d.ok) { b.disabled = false; return mbToast((d && d.error) || '入點失敗', true) }
  mbClose(); mbToast(`${d.member.name} +${d.pts} 點（消費 ${mbN(d.amount)}），目前 ${mbN(d.balance)} 點`)
  if (_mbCur && _mbCur.member.id === d.member.id) mbOpen(d.member.id); else { _mbD = null; memberLoad() }
}
// ── 兌換（櫃檯直接扣點出餐）──
function mbRedeem (memberId) {
  const rws = ((_mbD.cfg || {}).rewards || []).filter(r => r.active !== false)
  if (!rws.length) return mbToast('還沒設定獎勵（主管到設定加）', true)
  mbModal(`<h3 style="margin:0 0 8px">兌換</h3>${memberId ? `<div class="hint" style="margin-bottom:8px">會員：<b>${mbEsc(_mbCur.member.name)}</b>（${mbEsc(_mbCur.member.mno)}）目前 ${mbN(_mbCur.balance)} 點</div><input type="hidden" id="mbR_key" value="${memberId}">` : mbKeyBox('mbR_key')}
    <div style="display:grid;gap:6px;margin-top:10px">${rws.map(r => `<label style="display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:8px 10px;cursor:pointer"><input type="radio" name="mbR_rw" value="${r.id}"><span style="flex:1"><b>${mbEsc(r.name)}</b>${r.value ? ` <span class="hint">市價約 ${r.value}</span>` : ''}</span><b>${r.pts} 點</b></label>`).join('')}</div>
    <div class="hint" style="margin-top:6px">按下去就扣點、直接給餐，客人會員卡馬上看得到。</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="mbClose()">取消</button><button class="mini on" id="mbR_go" onclick="mbRedeemGo()">扣點兌換</button></div>`)
  const k = document.getElementById('mbR_key'); if (k && !memberId) { k.onchange = () => mbWho('mbR_key'); k.focus() }
}
async function mbRedeemGo () {
  const key = (document.getElementById('mbR_key') || {}).value, rw = (document.querySelector('input[name=mbR_rw]:checked') || {}).value
  if (!key) return mbToast('先輸會員號碼或掃 QR', true); if (!rw) return mbToast('選一個獎勵', true)
  const b = document.getElementById('mbR_go'); b.disabled = true
  const d = await mbPost({ op: 'redeem', key, rewardId: rw, reqId: mbReq() })
  if (!d || !d.ok) { b.disabled = false; return mbToast((d && d.error) || '兌換失敗', true) }
  mbClose(); mbToast(`${d.member.name} 兌換「${d.reward.name}」−${d.reward.pts} 點，剩 ${mbN(d.balance)} 點`)
  if (_mbCur && _mbCur.member.id === d.member.id) mbOpen(d.member.id); else { _mbD = null; memberLoad() }
}
// ── 手動調整 ──
function mbAdjust (id) {
  mbModal(`<h3 style="margin:0 0 8px">手動調整點數</h3><div class="hint" style="margin-bottom:8px">${mbEsc(_mbCur.member.name)}（目前 ${mbN(_mbCur.balance)} 點）。正數加、負數扣；一定要寫原因，會留誰操作。超過 500 點要主管。</div>
    <div style="display:grid;grid-template-columns:120px 1fr;gap:8px">${mbIn('mbA_pts', 'type="number" inputmode="numeric"', '', '±點數')}${mbIn('mbA_rs', '', '', '原因（例：補登 10/11 消費 350）')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="mbClose()">取消</button><button class="mini on" onclick="mbAdjustGo('${id}')">確定</button></div>`)
}
async function mbAdjustGo (id) { const d = await mbPost({ op: 'adjust', id, pts: Number((document.getElementById('mbA_pts') || {}).value), reason: (document.getElementById('mbA_rs') || {}).value, reqId: mbReq() }); if (!d || !d.ok) return mbToast((d && d.error) || '失敗', true); mbClose(); mbToast('已調整，目前 ' + mbN(d.balance) + ' 點'); mbOpen(id) }
// ── 店員建會員 ──
function mbCreate () { mbModal(`<h3 style="margin:0 0 8px">建立會員（現場）</h3><div class="hint" style="margin-bottom:8px">客人沒用 LINE 時先建；之後用 LINE 入會可再合併。</div><div style="display:grid;gap:8px">${mbIn('mbC_name', '', '', '名字')}${mbIn('mbC_phone', 'inputmode="tel"', '', '手機（建議填，找人用）')}${mbIn('mbC_note', '', '', '備註（選填）')}</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="mbClose()">取消</button><button class="mini on" onclick="mbCreateGo()">建立</button></div>`) }
async function mbCreateGo () { const d = await mbPost({ op: 'create', name: (document.getElementById('mbC_name') || {}).value, phone: (document.getElementById('mbC_phone') || {}).value, note: (document.getElementById('mbC_note') || {}).value }); if (!d || !d.ok) return mbToast((d && d.error) || '失敗', true); mbClose(); mbToast(`已建立 ${d.member.name}，會員號碼 ${d.member.mno}`); _mbD = null; memberLoad(d.member.id) }
function mbEdit () { const m = _mbCur.member; mbModal(`<h3 style="margin:0 0 8px">編輯會員資料</h3><div style="display:grid;gap:8px"><label class="hint">名字${mbIn('mbX_name', '', m.name)}</label><label class="hint">手機${mbIn('mbX_phone', 'inputmode="tel"', _mbD.me.mgr ? m.phone : '', _mbD.me.mgr ? '' : '只有主管能看／改完整手機')}</label><label class="hint">生日${mbIn('mbX_bday', 'type="date"', m.birthday || '')}</label><label class="hint">內部備註${mbIn('mbX_note', '', m.note || '')}</label><label class="hint">狀態 <select id="mbX_status" style="border:1px solid var(--line);border-radius:8px;padding:7px;background:var(--card);color:inherit"><option value="active" ${m.status === 'active' ? 'selected' : ''}>正常</option><option value="blocked" ${m.status === 'blocked' ? 'selected' : ''}>停用</option></select></label></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="mbClose()">取消</button><button class="mini on" onclick="mbEditSave('${m.id}')">儲存</button></div>`) }
async function mbEditSave (id) { const g = k => (document.getElementById(k) || {}).value; const patch = { name: g('mbX_name'), birthday: g('mbX_bday'), note: g('mbX_note'), status: g('mbX_status') }; if (_mbD.me.mgr) patch.phone = g('mbX_phone'); const d = await mbPost({ op: 'update', id, patch }); if (!d || !d.ok) return mbToast((d && d.error) || '失敗', true); mbClose(); _mbCur = d; mbRenderDetail(); mbToast('已儲存') }
// ── 設定（主管）──
function mbCfg () {
  const c = _mbD.cfg
  const row = (r) => `<div class="mbRw" style="display:grid;grid-template-columns:1fr 70px 70px 50px 32px;gap:6px;align-items:center;margin-top:6px"><input class="rwName" value="${mbEsc(r.name)}" placeholder="獎勵名稱" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit"><input class="rwPts" type="number" value="${r.pts}" title="所需點數" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;text-align:center"><input class="rwVal" type="number" value="${r.value || 0}" title="市價（元）" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--card);color:inherit;text-align:center"><label style="font-size:12px"><input type="checkbox" class="rwOn" ${r.active !== false ? 'checked' : ''}>開</label><button class="mini" style="padding:2px 6px" onclick="this.parentNode.remove()">×</button><input type="hidden" class="rwId" value="${mbEsc(r.id || '')}"></div>`
  mbModal(`<h3 style="margin:0 0 8px">會員設定</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label class="hint">每幾元 1 點${mbIn('mbF_per', 'type="number"', c.perAmt)}</label><label class="hint">單筆入點上限（元，超過要主管）${mbIn('mbF_cap', 'type="number"', c.capSingle)}</label><label class="hint">入會禮點數（0＝沒有）${mbIn('mbF_wel', 'type="number"', c.welcomePts)}</label><label class="hint">個資告知的公司名稱${mbIn('mbF_ent', '', c.entity, '例：○○餐飲有限公司')}</label></div>
    <div style="margin-top:12px;display:flex;align-items:center;gap:8px"><b style="font-size:13.5px">獎勵清單</b><span class="hint">名稱／所需點數／市價</span><span style="flex:1"></span><button class="mini" onclick="document.getElementById('mbF_rws').insertAdjacentHTML('beforeend', mbRwRowHtml())">＋ 加獎勵</button></div>
    <div id="mbF_rws">${(c.rewards || []).map(row).join('')}</div>
    <label class="hint" style="display:block;margin-top:12px">加好友歡迎訊息（{link}＝會員卡連結）<textarea id="mbF_wt" rows="3" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--card);color:inherit;font-family:inherit;font-size:13.5px">${mbEsc(c.welcomeText || '')}</textarea></label>
    <label class="hint" style="display:block;margin-top:8px">個資告知文字（{entity}＝公司名稱）<textarea id="mbF_ct" rows="5" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--card);color:inherit;font-family:inherit;font-size:13px">${mbEsc(c.consentText || '')}</textarea></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="mini" onclick="mbClose()">取消</button><button class="mini on" onclick="mbCfgSave()">儲存</button></div>`, 640)
  window.mbRwRowHtml = () => row({ id: '', name: '', pts: 100, value: 0, active: true })
}
async function mbCfgSave () {
  const g = k => (document.getElementById(k) || {}).value
  const rewards = [...document.querySelectorAll('#mbF_rws .mbRw')].map((el, i) => ({ id: el.querySelector('.rwId').value || 'r' + Date.now().toString(36) + i, name: el.querySelector('.rwName').value, pts: Number(el.querySelector('.rwPts').value), value: Number(el.querySelector('.rwVal').value), active: el.querySelector('.rwOn').checked })).filter(r => r.name.trim())
  const d = await mbPost({ op: 'cfg', cfg: { perAmt: Number(g('mbF_per')), capSingle: Number(g('mbF_cap')), welcomePts: Number(g('mbF_wel')), entity: g('mbF_ent'), rewards, welcomeText: g('mbF_wt'), consentText: g('mbF_ct') } })
  if (!d || !d.ok) return mbToast((d && d.error) || '存不了', true)
  _mbD.cfg = d.cfg; mbClose(); mbToast('設定已存'); mbRenderList()
}
