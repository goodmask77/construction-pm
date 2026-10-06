// ⚠️ /prep 主程式第 13 塊（v4.56.1 張良「開工」入職流程）：新人自填入職流程頁
// 第一步＝基本資料（繳交表/簽署/勞健保分步後續做）；資料走 ?onboardself（本人 token 驗身分、只改自己那筆名冊卡）
// 本塊只負責「新人端填寫」；主管端核准在名冊頁（p12 待審核區，已有 v4.60）
const ONB_STEPS = ['基本資料', '繳交表', '簽署', '勞健保']

async function onbPage() {
  curStore = 'onb'; setTabs('')
  app.innerHTML = '<section>載入中…</section>'
  if (!TK || !TK()) { app.innerHTML = '<section class="err">要先綁定才能填入職資料——請私訊 DD「綁定GD 你的本名」，點我發的連結進來。</section>'; return }
  let d
  try { const r = await fetch('/api/mail-sync?onboardself&me=' + encodeURIComponent(TK())); d = await r.json() } catch (e) {}
  if (!d || !d.ok) { app.innerHTML = `<section class="err">${(d && d.error) || '讀不到你的入職資料'}</section>`; return }
  window._onbD = d; onbRender()
}

function onbRender() {
  const d = window._onbD || {}, me = d.me || {}, step = Math.min(d.step || 0, 3)
  const _u = document.getElementById('upd'); if (_u) _u.textContent = '入職流程' // v4.56.1d 修「載入中…」沒消失（張良截圖抓包）
  const esc = s => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;')
  // 進度條
  let h = `<section><h2>入職流程</h2>
    <div style="display:flex;gap:6px;margin-bottom:16px">${ONB_STEPS.map((s, i) => `<div style="flex:1;text-align:center;padding:9px 4px;border-radius:9px;font-size:12px;font-weight:800;background:${i < step ? 'var(--green)' : i === step ? 'var(--primary)' : 'var(--soft)'};color:${i <= step ? '#fff' : 'var(--muted)'}">${i < step ? '✓ ' : ''}${i + 1}. ${s}</div>`).join('')}</div>`
  // 目前只做第一步（基本資料）；其餘步驟顯示「準備中」
  if (step === 0) h += onbStep1Form(me, esc)
  else if (step === 1) h += onbStep2Form(me, esc)
  else h += `<div style="padding:20px;text-align:center;color:var(--muted)">
    <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px">✓ 基本資料、繳交表已完成</div>
    「${ONB_STEPS[step]}」步驟準備中，很快開放。<br>
    <button class="mini" style="margin-top:12px" onclick="onbEditStep1()">↩ 改基本資料</button>
    <button class="mini" style="margin-top:12px" onclick="onbEditStep2()">↩ 改繳交表</button></div>`
  h += `</section>`
  app.innerHTML = h
}

// 第二步表單：繳交表（薪轉銀行＋存摺照＋分行/帳號）
function onbStep2Form(me, esc) {
  const ip = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:15px;font-family:inherit;background:var(--soft);color:var(--ink)'
  const lb = t => `<div style="font-size:13px;font-weight:700;color:var(--ink);margin:12px 0 5px">${t}</div>`
  const hasBank = !!me.bankDoc
  return `<div style="max-width:560px">
    <div style="background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-bottom:6px;font-size:13px;color:var(--text);line-height:1.6">
      <b style="color:var(--ink)">薪轉銀行資訊</b><br>
      1. 本公司薪資匯款銀行：<b style="color:var(--ink)">中國信託商業銀行</b>。<br>
      2. 沒有中信帳戶：到職後向公司領取開戶證明單，再行開立。<br>
      3. 不能使用別間銀行存摺。<br>
      4. 發薪日：每月 10 日，遇例假日當日發放。
    </div>
    ${lb('分行名稱 <span style="color:var(--red)">*</span>')}<input type="text" id="ob_branch" value="${esc(me.bankBranch || '')}" placeholder="例：中信・○○分行" style="${ip}">
    ${lb('帳號 <span style="color:var(--red)">*</span>')}<input type="text" id="ob_acct" inputmode="numeric" value="${esc(me.bankAccount || '')}" placeholder="請輸入帳號（數字）" style="${ip}">
    ${lb('存摺封面照 <span style="color:var(--red)">*</span>')}
    <button onclick="onbFileUpload('bankDoc')" style="width:100%;padding:11px;border:1.5px dashed var(--line);border-radius:10px;background:var(--soft);color:${hasBank ? 'var(--green)' : 'var(--primary)'};font-size:14px;font-weight:700;cursor:pointer">${hasBank ? '✓ 已上傳存摺封面（點可重傳）' : '📷 拍照／上傳存摺封面'}</button>
    <div style="display:flex;gap:8px;margin-top:18px">
      <button onclick="onbEditStep1()" style="flex:0 0 90px;padding:12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--muted);font-size:14px;font-weight:700;cursor:pointer">← 上一步</button>
      <button onclick="onbSaveStep2()" style="flex:1;padding:12px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-size:15px;font-weight:800;cursor:pointer">儲存並繼續 →</button>
    </div>
    <div class="hint" style="margin-top:8px">存摺／證件只有你本人和主管看得到（存機密私有區，不進公開圖庫）。</div>
  </div>`
}
function onbEditStep2() { const d = window._onbD || {}; d.step = 1; window._onbD = d; onbRender() }

// 機密檔案上傳（拍照→壓縮→私有桶）
function onbFileUpload(field) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = async () => {
        // 壓縮：長邊 ≤1600，jpeg 0.82（存摺照清楚即可、省流量/不超限）
        const max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height))
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc)
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
        const dataUrl = cv.toDataURL('image/jpeg', 0.82)
        try {
          const r = await fetch('/api/mail-sync?onboardfile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TK(), field, dataUrl }) })
          const d = await r.json()
          if (d && d.ok) { if (window._onbD && window._onbD.me) window._onbD.me[field] = 'uploaded'; onbRender(); onbToast('✓ 已上傳') }
          else alert((d && d.error) || '上傳失敗')
        } catch (e) { alert('上傳失敗，稍後再試') }
      }
      img.src = reader.result
    }
    reader.readAsDataURL(f)
  }
  inp.click()
}

async function onbSaveStep2() {
  const g = id => (document.getElementById(id) || {}).value || ''
  const branch = g('ob_branch').trim(), acct = g('ob_acct').trim()
  if (!branch || !acct) { alert('分行名稱和帳號要填'); return }
  if (!(window._onbD && window._onbD.me && window._onbD.me.bankDoc)) { if (!confirm('還沒上傳存摺封面照，確定先繼續？（之後可以回來補）')) return }
  const set = { bankBranch: branch, bankAccount: acct }
  const btn = event && event.target; if (btn) { btn.disabled = true; btn.textContent = '儲存中…' }
  let d
  try { const r = await fetch('/api/mail-sync?onboardself', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TK(), step: 2, set }) }); d = await r.json() } catch (e) {}
  if (d && d.ok) { if (window._onbD) { window._onbD.me = { ...(window._onbD.me || {}), ...set }; window._onbD.step = 2 } onbRender(); onbToast('✓ 繳交表已儲存') }
  else { alert((d && d.error) || '儲存失敗，稍後再試'); if (btn) { btn.disabled = false; btn.textContent = '儲存並繼續 →' } }
}

function onbToast(msg) {
  try { const t = document.createElement('div'); t.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:80;background:#10182B;color:#fff;border-radius:10px;padding:9px 18px;font-size:14px'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800) } catch (_) {} }

// 第一步表單：基本資料（原創通用 HR 欄位）
function onbStep1Form(me, esc) {
  const ip = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:15px;font-family:inherit;background:var(--soft);color:var(--ink)'
  const radio = (name, val, opts) => opts.map(o => `<label style="display:inline-flex;align-items:center;gap:5px;margin-right:16px;cursor:pointer;font-size:14px"><input type="radio" name="${name}" value="${o}" ${val === o ? 'checked' : ''} style="width:16px;height:16px">${o}</label>`).join('')
  const lb = t => `<div style="font-size:13px;font-weight:700;color:var(--ink);margin:12px 0 5px">${t}</div>`
  return `<div style="max-width:560px">
    <div style="background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:6px;font-size:13px;color:var(--muted)">
      歡迎加入 GROUN:D！先填基本資料，公司好建檔。${me.name ? `<br>姓名：<b style="color:var(--ink)">${esc(me.name)}</b>${me.dept ? `・部門：${esc(me.dept)}` : ''}${me.empNo ? `・員編：${esc(me.empNo)}` : ''}${me.joinDate ? `・到職：${esc(me.joinDate)}` : ''}` : ''}
    </div>
    ${lb('出生年月日 <span style="color:var(--red)">*</span>')}<input type="date" id="ob_birthday" value="${esc(me.birthday || '')}" style="${ip}">
    ${lb('性別 <span style="color:var(--red)">*</span>')}<div>${radio('ob_gender', me.gender || '', ['男', '女'])}</div>
    ${lb('婚姻狀態')}<div>${radio('ob_marital', me.marital || '', ['未婚', '已婚', '離婚', '分居', '喪偶'])}</div>
    ${lb('身分族群')}<div>${radio('ob_ethnic', me.ethnic || '', ['一般', '原住民', '華僑', '外籍配偶', '外籍員工'])}</div>
    ${lb('身分證字號 <span style="color:var(--red)">*</span>')}<input type="text" id="ob_nid" value="${esc(me.nid || '')}" placeholder="外籍請填居留證號" style="${ip}">
    ${lb('勞動部外籍工作許可證號（台灣籍免填）')}<input type="text" id="ob_fp" value="${esc(me.foreignPermitNo || '')}" placeholder="外籍夥伴填寫" style="${ip}">
    ${lb('緊急聯絡人（姓名・關係・電話）')}<input type="text" id="ob_emer" value="${esc(me.emergency || '')}" placeholder="例：王大明・父・0912345678" style="${ip}">
    <button onclick="onbSaveStep1()" style="margin-top:18px;width:100%;padding:12px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-size:15px;font-weight:800;cursor:pointer">儲存並繼續 →</button>
    <div class="hint" style="margin-top:8px">身分證等機密資料只有你本人和主管看得到。證件照片／存摺之後的步驟再傳。</div>
  </div>`
}

function onbEditStep1() { const d = window._onbD || {}; d.step = 0; window._onbD = d; onbRender() }

async function onbSaveStep1() {
  const g = id => (document.getElementById(id) || {}).value || ''
  const rv = name => { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : '' }
  const set = { birthday: g('ob_birthday'), gender: rv('ob_gender'), marital: rv('ob_marital'), ethnic: rv('ob_ethnic'), nid: g('ob_nid').trim(), foreignPermitNo: g('ob_fp').trim(), emergency: g('ob_emer').trim() }
  if (!set.birthday || !set.gender || !set.nid) { alert('出生年月日、性別、身分證字號是必填的喔'); return }
  const btn = event && event.target; if (btn) { btn.disabled = true; btn.textContent = '儲存中…' }
  let d
  try { const r = await fetch('/api/mail-sync?onboardself', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TK(), step: 1, set }) }); d = await r.json() } catch (e) {}
  if (d && d.ok) { if (window._onbD) { window._onbD.me = { ...(window._onbD.me || {}), ...set }; window._onbD.step = 1 } onbRender(); try { const t = document.createElement('div'); t.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:80;background:#10182B;color:#fff;border-radius:10px;padding:9px 18px;font-size:14px'; t.textContent = '✓ 基本資料已儲存'; document.body.appendChild(t); setTimeout(() => t.remove(), 1800) } catch (_) {} }
  else { alert((d && d.error) || '儲存失敗，稍後再試'); if (btn) { btn.disabled = false; btn.textContent = '儲存並繼續 →' } }
}
