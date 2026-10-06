// ⚠️ /prep 主程式第 13 塊（v4.56.7 張良「開工」入職流程）：新人自填入職流程頁；欄位對齊 NUEiP 到職基本資料單＋入職繳交表（必填＋選填全補，含眷屬多筆、健檢報告）；v4.56.6 通訊地址「同戶籍」勾選＋緊急聯絡人拆三格必填；v4.56.7 上傳可拍照／圖庫／檔案(含PDF)
// 第一步＝基本資料（繳交表/簽署/勞健保分步後續做）；資料走 ?onboardself（本人 token 驗身分、只改自己那筆名冊卡）
// 本塊只負責「新人端填寫」；主管端核准在名冊頁（p12 待審核區，已有 v4.60）
const ONB_STEPS = ['基本資料', '繳交表', '簽署', '勞健保']

async function onbPage() {
  curStore = 'onb'; setTabs('onb') // v4.56.5 有分頁按鈕後：點進來要高亮「入職」分頁
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
  if (step === 0) { onbDepInit(); onbDepRender() } // 眷屬多筆：表單進 DOM 後再畫
}

// ── 眷屬資料多筆（健保加保用）：存成 JSON 字串進 dependents 欄 ──
function onbDepInit() {
  const me = (window._onbD && window._onbD.me) || {}
  let arr = []
  try { arr = JSON.parse(me.dependents || '[]'); if (!Array.isArray(arr)) arr = [] } catch (_) { arr = [] }
  window._onbDeps = arr
}
function onbDepRender() {
  const box = document.getElementById('ob_deps'); if (!box) return
  const esc = s => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const ip = 'flex:1;min-width:120px;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px;font-family:inherit;background:var(--soft);color:var(--ink)'
  const deps = window._onbDeps || []
  if (!deps.length) { box.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:4px 0">尚無眷屬資料，有需要健保加保再按「＋ 新增眷屬」。</div>'; return }
  box.innerHTML = deps.map((d, i) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-top:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:13px;color:var(--ink)">眷屬 ${i + 1}</b><button type="button" onclick="onbDepDel(${i})" style="border:none;background:transparent;color:var(--red);font-size:13px;font-weight:700;cursor:pointer">刪除</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <input id="ob_dep_name_${i}" value="${esc(d.name)}" placeholder="眷屬姓名" style="${ip}">
      <input id="ob_dep_rel_${i}" value="${esc(d.rel)}" placeholder="關係（配偶/子女…）" style="${ip}">
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
      <input id="ob_dep_birth_${i}" type="date" value="${esc(d.birth)}" style="${ip}">
      <input id="ob_dep_nid_${i}" value="${esc(d.nid)}" placeholder="身分證字號" style="${ip}">
    </div>
  </div>`).join('')
}
function onbDepSync() {
  const g = id => (document.getElementById(id) || {}).value || ''
  const deps = window._onbDeps || []
  window._onbDeps = deps.map((_, i) => ({ name: g('ob_dep_name_' + i).trim(), rel: g('ob_dep_rel_' + i).trim(), birth: g('ob_dep_birth_' + i), nid: g('ob_dep_nid_' + i).trim() }))
}
function onbDepAdd() { onbDepSync(); (window._onbDeps = window._onbDeps || []).push({ name: '', rel: '', birth: '', nid: '' }); onbDepRender() }
function onbDepDel(i) { onbDepSync(); window._onbDeps.splice(i, 1); onbDepRender() }

// 第二步表單：繳交表（健檢＋薪轉銀行＋存摺照＋分行/帳號）v4.56.3 補健檢區
function onbStep2Form(me, esc) {
  const ip = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:15px;font-family:inherit;background:var(--soft);color:var(--ink)'
  const lb = t => `<div style="font-size:13px;font-weight:700;color:var(--ink);margin:12px 0 5px">${t}</div>`
  const sec = t => `<div style="font-size:13px;font-weight:800;color:var(--primary);margin:22px 0 2px;border-bottom:1px solid var(--line);padding-bottom:5px">${t}</div>`
  const upBtn = (field, has, labelNew) => `<button onclick="onbFileUpload('${field}')" style="width:100%;padding:11px;border:1.5px dashed var(--line);border-radius:10px;background:var(--soft);color:${has ? 'var(--green)' : 'var(--primary)'};font-size:14px;font-weight:700;cursor:pointer;margin-top:6px">${has ? '✓ 已上傳（點可重傳）' : labelNew}</button>`
  const hasBank = !!me.bankDoc
  return `<div style="max-width:560px">
    ${sec('健康檢查（報到後兩週內完成）')}
    <div style="background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-top:6px;font-size:13px;color:var(--text);line-height:1.65">
      請自報到之日起<b style="color:var(--ink)">兩週內</b>，前往公司指定之「<b style="color:var(--ink)">博仁綜合醫院健康管理中心</b>」辦理入職前健康檢查。<br>
      檢查共兩項：<br>
      1. 勞工體格檢查報告（職安法 §20／勞工健檢規則 §16-17）<br>
      2. 食品（供膳）從業人員健康檢查報告（食安法 §8／食品良好衛生規範 §5）<br>
      ※ 一年內有做過以上項目，可<b style="color:var(--ink)">直接附上健檢報告</b>即可。<br>
      ※ 首次健檢費用需自費。<br>
      <b style="color:var(--ink)">預約方式</b>：加博仁醫院官方 Line，傳送「<b style="color:var(--ink)">我是口香糖俱樂部的新進同仁想預約體健</b>」，務必「線上預約成功」後再前往。
    </div>
    <a href="https://page.line.me/xrx3648g?openQrModal=true" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:8px;padding:11px;border-radius:10px;background:#06C755;color:#fff;font-size:14px;font-weight:800;text-decoration:none">加博仁醫院官方 Line 預約體檢</a>
    ${lb('健檢報告提交（最多 2 張；已完成檢查者可等報告出來再回來補）')}
    ${upBtn('healthDoc1', !!me.healthDoc1, '上傳健檢報告 ①')}
    ${upBtn('healthDoc2', !!me.healthDoc2, '上傳健檢報告 ②（第二份）')}
    ${sec('薪轉銀行')}
    <div style="background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-top:6px;font-size:13px;color:var(--text);line-height:1.6">
      1. 本公司薪資匯款銀行：<b style="color:var(--ink)">中國信託商業銀行</b>。<br>
      2. 沒有中信帳戶：到職後向公司領取開戶證明單，再行開立。<br>
      3. 不能使用別間銀行存摺。<br>
      4. 發薪日：每月 10 日，遇例假日當日發放。
    </div>
    ${lb('存摺封面照 <span style="color:var(--red)">*</span>')}
    ${upBtn('bankDoc', hasBank, '拍照／上傳存摺封面')}
    ${lb('存摺資訊「分行名稱」 <span style="color:var(--red)">*</span>')}<input type="text" id="ob_branch" value="${esc(me.bankBranch || '')}" placeholder="例：中信・○○分行" style="${ip}">
    ${lb('存摺資訊「帳號」 <span style="color:var(--red)">*</span>')}<input type="text" id="ob_acct" inputmode="numeric" value="${esc(me.bankAccount || '')}" placeholder="請輸入 12 碼帳號" style="${ip}">
    <div style="display:flex;gap:8px;margin-top:18px">
      <button onclick="onbEditStep1()" style="flex:0 0 90px;padding:12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--muted);font-size:14px;font-weight:700;cursor:pointer">← 上一步</button>
      <button onclick="onbSaveStep2()" style="flex:1;padding:12px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-size:15px;font-weight:800;cursor:pointer">儲存並繼續 →</button>
    </div>
    <div class="hint" style="margin-top:8px">存摺／證件只有你本人和主管看得到（存機密私有區，不進公開圖庫）。</div>
  </div>`
}
function onbEditStep2() { const d = window._onbD || {}; d.step = 1; window._onbD = d; onbRender() }

// 機密檔案上傳（可拍照／從圖庫選／選檔案；照片自動壓縮，PDF 等原檔直傳）→ 私有桶
// v4.56.7 張良「手機版不要只能拍照，要能上傳檔案或照片」：移除 capture 強制鏡頭、開放 image+pdf
function onbFileUpload(field) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf' // 不設 capture→手機會跳「拍照／照片圖庫／檔案」讓使用者選
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return
    const isImg = /^image\//.test(f.type || '')
    const reader = new FileReader()
    reader.onload = () => {
      if (!isImg) { // PDF 等非圖片：不壓縮直接傳（dataURL 約為檔案 1.37 倍，13.3MB≈10MB 後端上限）
        if (String(reader.result || '').length > 13.3 * 1024 * 1024) { alert('檔案太大（上限約 10MB），請壓縮後再傳'); return }
        onbSendFile(field, reader.result); return
      }
      const img = new Image()
      img.onload = () => {
        // 壓縮：長邊 ≤1600，jpeg 0.82（存摺照清楚即可、省流量/不超限）
        const max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height))
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc)
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
        onbSendFile(field, cv.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = () => alert('這張圖讀不開，換一張或改用檔案上傳')
      img.src = reader.result
    }
    reader.readAsDataURL(f)
  }
  inp.click()
}
async function onbSendFile(field, dataUrl) {
  try {
    const r = await fetch('/api/mail-sync?onboardfile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TK(), field, dataUrl }) })
    const d = await r.json()
    if (d && d.ok) { if (window._onbD && window._onbD.me) window._onbD.me[field] = 'uploaded'; onbRender(); onbToast('✓ 已上傳') }
    else alert((d && d.error) || '上傳失敗')
  } catch (e) { alert('上傳失敗，稍後再試') }
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

// 第一步表單：基本資料（欄位對齊 NUEiP 到職基本資料單；v4.56.3 補必填）
function onbStep1Form(me, esc) {
  const ip = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:15px;font-family:inherit;background:var(--soft);color:var(--ink)'
  const radio = (name, val, opts) => opts.map(o => `<label style="display:inline-flex;align-items:center;gap:5px;margin-right:16px;cursor:pointer;font-size:14px"><input type="radio" name="${name}" value="${o}" ${val === o ? 'checked' : ''} style="width:16px;height:16px">${o}</label>`).join('')
  const cbg = (name, val, opts) => { const arr = String(val || '').split(',').map(s => s.trim()).filter(Boolean); return opts.map(o => `<label style="display:inline-flex;align-items:center;gap:5px;margin-right:16px;cursor:pointer;font-size:14px"><input type="checkbox" name="${name}" value="${o}" ${arr.includes(o) ? 'checked' : ''} style="width:16px;height:16px">${o}</label>`).join('') }
  const agree = (id, val, txt) => `<label style="display:flex;align-items:flex-start;gap:8px;margin:9px 0;cursor:pointer;font-size:13px;color:var(--text);line-height:1.5"><input type="checkbox" id="${id}" ${val === '1' ? 'checked' : ''} style="width:17px;height:17px;flex:0 0 auto;margin-top:1px"><span>我已詳讀並同意：${txt}</span></label>`
  const lb = t => `<div style="font-size:13px;font-weight:700;color:var(--ink);margin:12px 0 5px">${t}</div>`
  const sec = t => `<div style="font-size:13px;font-weight:800;color:var(--primary);margin:22px 0 2px;border-bottom:1px solid var(--line);padding-bottom:5px">${t}</div>`
  const rq = '<span style="color:var(--red)">*</span>'
  const sameAddr = !!(me.mailAddr && me.regAddr && me.mailAddr === me.regAddr) // 通訊=戶籍時預設勾「同上」
  const ip3 = 'flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:9px;font-size:15px;font-family:inherit;background:var(--soft);color:var(--ink)'
  // 緊急聯絡人三格回填：優先用拆開欄位，舊資料(單一字串)則用分隔符拆
  const emr = { name: me.emerName || '', rel: me.emerRel || '', phone: me.emerPhone || '' }
  if (!emr.name && !emr.rel && !emr.phone && me.emergency) { const pp = String(me.emergency).split(/[・･、,\s]+/).filter(Boolean); emr.name = pp[0] || ''; emr.rel = pp[1] || ''; emr.phone = pp[2] || '' }
  return `<div style="max-width:560px">
    <div style="background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:6px;font-size:13px;color:var(--muted)">
      歡迎加入 GROUN:D！先填基本資料，公司好建檔。${me.name ? `<br>姓名：<b style="color:var(--ink)">${esc(me.name)}</b>${me.dept ? `・部門：${esc(me.dept)}` : ''}${me.empNo ? `・員編：${esc(me.empNo)}` : ''}${me.joinDate ? `・到職：${esc(me.joinDate)}` : ''}` : ''}
    </div>
    ${sec('基本資料')}
    ${lb('出生年月日 ' + rq)}<input type="date" id="ob_birthday" value="${esc(me.birthday || '')}" style="${ip}">
    ${lb('性別 ' + rq)}<div>${radio('ob_gender', me.gender || '', ['男', '女'])}</div>
    ${lb('婚姻狀態')}<div>${radio('ob_marital', me.marital || '', ['未婚', '已婚', '離婚', '分居', '喪偶'])}</div>
    ${lb('身分族群')}<div>${radio('ob_ethnic', me.ethnic || '', ['一般', '原住民', '華僑', '外籍配偶', '外籍員工'])}</div>
    ${lb('身分證號碼 ' + rq)}<input type="text" id="ob_nid" value="${esc(me.nid || '')}" placeholder="外籍請填居留證號" style="${ip}">
    ${lb('勞動部外籍工作許可證號（台灣籍免填）')}<input type="text" id="ob_fp" value="${esc(me.foreignPermitNo || '')}" placeholder="外籍夥伴填寫" style="${ip}">
    ${lb('兵役狀態 ' + rq)}<div>${radio('ob_military', me.military || '', ['役畢', '免役', '服役中', '替代役', '未役'])}</div>
    ${lb('退伍日期（役畢者填，非必填）')}<input type="date" id="ob_discharge" value="${esc(me.dischargeDate || '')}" style="${ip}">
    ${lb('身心障礙類別 ' + rq)}<div>${radio('ob_disab', me.disability || '', ['無', '輕度', '中度', '重度', '極重度'])}</div>
    ${lb('身心障礙說明（選填，無則免填）')}<input type="text" id="ob_disabn" value="${esc(me.disabilityNote || '')}" placeholder="若有身心障礙請簡述" style="${ip}">
    ${lb('國籍（非必填，預設中華民國）')}<input type="text" id="ob_nat" value="${esc(me.nationality || '')}" placeholder="中華民國" style="${ip}">
    ${sec('聯絡資料')}
    ${lb('手機號碼 ' + rq)}<input type="tel" id="ob_mobile" inputmode="numeric" value="${esc(me.mobile || '')}" placeholder="例：0912345678" style="${ip}">
    ${lb('住家電話（非必填）')}<input type="tel" id="ob_home" value="${esc(me.homePhone || '')}" placeholder="例：02-12345678" style="${ip}">
    ${lb('電子信箱（非必填）')}<input type="email" id="ob_email" value="${esc(me.email || '')}" placeholder="example@mail.com" style="${ip}">
    ${lb('電子信箱同步通知')}<div>${radio('ob_emailnot', me.emailNotify || '', ['是', '否'])}</div>
    ${lb('戶籍地址 ' + rq)}<input type="text" id="ob_reg" value="${esc(me.regAddr || '')}" placeholder="請輸入戶籍地址" style="${ip}" oninput="onbSameAddrSync()">
    ${lb('通訊地址 ' + rq + ' <label style="font-weight:600;font-size:12px;color:var(--muted);margin-left:8px;cursor:pointer"><input type="checkbox" id="ob_sameaddr" onchange="onbSameAddr()" ' + (sameAddr ? 'checked' : '') + ' style="width:14px;height:14px;vertical-align:-2px"> 同戶籍地址</label>')}<input type="text" id="ob_mail" value="${esc(me.mailAddr || '')}" placeholder="與戶籍相同可勾選右上「同戶籍地址」" style="${ip}${sameAddr ? ';opacity:0.6' : ''}" ${sameAddr ? 'disabled' : ''}>
    ${lb('通勤方式 ' + rq + '（可複選）')}<div>${cbg('ob_commute', me.commute || '', ['騎車', '捷運', '公車', '走路', '其他'])}</div>
    ${lb('申請機車停車格（非必填，填車牌號碼）')}<input type="text" id="ob_park" value="${esc(me.parkingPlate || '')}" placeholder="填車牌號碼，後續提供停車場資訊" style="${ip}">
    ${lb('緊急聯絡人 ' + rq)}
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <input id="ob_emer_name" value="${esc(emr.name)}" placeholder="姓名" style="${ip3}">
      <input id="ob_emer_rel" value="${esc(emr.rel)}" placeholder="關係(父/配偶…)" style="${ip3}">
      <input id="ob_emer_phone" type="tel" inputmode="numeric" value="${esc(emr.phone)}" placeholder="電話" style="${ip3}">
    </div>
    ${sec('眷屬資料（如有眷屬要依員工做健保加保才填；非必填）')}
    <div id="ob_deps"></div>
    <button type="button" onclick="onbDepAdd()" style="margin-top:8px;padding:8px 14px;border:1px solid var(--line);border-radius:9px;background:var(--soft);color:var(--primary);font-size:13px;font-weight:700;cursor:pointer">＋ 新增眷屬</button>
    ${sec('報到須知（請逐項確認）')}
    ${agree('ob_ag1', me.agree1 || '', '尚未完成報到程序前，皆不列入正式編制。')}
    ${agree('ob_ag2', me.agree2 || '', '入職有三個月試用期，試用期內雙方得隨時終止契約。')}
    ${agree('ob_ag3', me.agree3 || '', '將全力配合排班時間與輪班制度。')}
    <button onclick="onbSaveStep1()" style="margin-top:18px;width:100%;padding:12px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-size:15px;font-weight:800;cursor:pointer">儲存並繼續 →</button>
    <div class="hint" style="margin-top:8px">身分證等機密資料只有你本人和主管看得到。證件照片／存摺之後的步驟再傳。</div>
  </div>`
}

function onbEditStep1() { const d = window._onbD || {}; d.step = 0; window._onbD = d; onbRender() }

// 通訊地址「同戶籍地址」：勾了自動帶戶籍、鎖住；戶籍改字也跟著同步
function onbSameAddr() {
  const c = document.getElementById('ob_sameaddr'), reg = document.getElementById('ob_reg'), mail = document.getElementById('ob_mail')
  if (!c || !reg || !mail) return
  if (c.checked) { mail.value = reg.value; mail.disabled = true; mail.style.opacity = '0.6' }
  else { mail.disabled = false; mail.style.opacity = ''; mail.focus() }
}
function onbSameAddrSync() {
  const c = document.getElementById('ob_sameaddr'); if (!c || !c.checked) return
  const reg = document.getElementById('ob_reg'), mail = document.getElementById('ob_mail'); if (reg && mail) mail.value = reg.value
}

async function onbSaveStep1() {
  const g = id => (document.getElementById(id) || {}).value || ''
  const rv = name => { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : '' }
  const cv = name => Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(e => e.value).join(',')
  const chk = id => ((document.getElementById(id) || {}).checked ? '1' : '')
  onbDepSync()
  const deps = (window._onbDeps || []).filter(d => d.name || d.rel || d.nid || d.birth)
  const en = g('ob_emer_name').trim(), er = g('ob_emer_rel').trim(), ep = g('ob_emer_phone').trim()
  const set = {
    birthday: g('ob_birthday'), gender: rv('ob_gender'), marital: rv('ob_marital'), ethnic: rv('ob_ethnic'),
    nid: g('ob_nid').trim(), foreignPermitNo: g('ob_fp').trim(),
    military: rv('ob_military'), dischargeDate: g('ob_discharge'), disability: rv('ob_disab'), disabilityNote: g('ob_disabn').trim(), nationality: g('ob_nat').trim(),
    mobile: g('ob_mobile').trim(), homePhone: g('ob_home').trim(), email: g('ob_email').trim(), emailNotify: rv('ob_emailnot'),
    regAddr: g('ob_reg').trim(), mailAddr: g('ob_mail').trim(), commute: cv('ob_commute'), parkingPlate: g('ob_park').trim(),
    emerName: en, emerRel: er, emerPhone: ep, emergency: [en, er, ep].filter(Boolean).join('・'), dependents: JSON.stringify(deps),
    agree1: chk('ob_ag1'), agree2: chk('ob_ag2'), agree3: chk('ob_ag3')
  }
  const miss = []
  if (!set.birthday) miss.push('出生年月日'); if (!set.gender) miss.push('性別'); if (!set.nid) miss.push('身分證號碼')
  if (!set.military) miss.push('兵役狀態'); if (!set.disability) miss.push('身心障礙類別')
  if (!set.mobile) miss.push('手機號碼'); if (!set.regAddr) miss.push('戶籍地址'); if (!set.mailAddr) miss.push('通訊地址'); if (!set.commute) miss.push('通勤方式')
  if (!en) miss.push('緊急聯絡人-姓名'); if (!er) miss.push('緊急聯絡人-關係'); if (!ep) miss.push('緊急聯絡人-電話')
  if (miss.length) { alert('這些是必填的喔：\n・' + miss.join('\n・')); return }
  if (!(set.agree1 && set.agree2 && set.agree3)) { alert('請確認並勾選下方三項報到須知。'); return }
  const btn = event && event.target; if (btn) { btn.disabled = true; btn.textContent = '儲存中…' }
  let d
  try { const r = await fetch('/api/mail-sync?onboardself', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TK(), step: 1, set }) }); d = await r.json() } catch (e) {}
  if (d && d.ok) { if (window._onbD) { window._onbD.me = { ...(window._onbD.me || {}), ...set }; window._onbD.step = 1 } onbRender(); try { const t = document.createElement('div'); t.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:80;background:#10182B;color:#fff;border-radius:10px;padding:9px 18px;font-size:14px'; t.textContent = '✓ 基本資料已儲存'; document.body.appendChild(t); setTimeout(() => t.remove(), 1800) } catch (_) {} }
  else { alert((d && d.error) || '儲存失敗，稍後再試'); if (btn) { btn.disabled = false; btn.textContent = '儲存並繼續 →' } }
}
