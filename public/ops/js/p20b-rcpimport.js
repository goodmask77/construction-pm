// 🍳 /prep 第 20b 塊（v4.70.66，2026-10-12）：食譜庫「新增食譜」AI 匯入
//   張良 2026-10-12：「新增食譜 讓我可以直接截圖 丟檔案 或連結 然後 app 直接幫我讀取新增；有既有物料／半成品直接連接，沒有的需要新增給我確認按鈕」
//   流程：貼截圖（⌘V）／選檔（圖片、CSV、Excel）／貼連結或文字 → ?recipes POST op:import（api/_rcpimport.js，只讀）→ 審核表（每行材料對到哪、可改、可「新增為半成品」）→ 確認才建草稿（create → edit 步驟）
//   UI 慣例：單色線條圖示、不用 prompt；只有「食譜」分頁有編輯權的人看得到（跟新增食譜同權限）
;(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const I = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex:0 0 auto">${d}</svg>`
  const IC = { check: I('<polyline points="20 6 9 17 4 12"/>'), x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'), img: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'), plus: I('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'), spark: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>'), link: I('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/>'), file: I('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'), warn: I('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'), trash: I('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>') }
  const COL = { g: '#3DBE6C', o: '#E8A657', r: '#F07373', m: '#8C98A8', p: '#B48CF2' }
  const TKf = () => (typeof TK === 'function' ? TK() : '')
  const inp = 'border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--card);color:var(--ink)'
  let S = null // 匯入工作狀態：{ imgs:[dataURL], text, url, busy, res, choice:{i:code|''|'__new'}, steps:[{on,title,desc,timerSec}] }

  async function post (body) {
    const r = await fetch('/api/mail-sync?recipes=' + encodeURIComponent(K), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: TKf() }) })
    return r.json().catch(() => ({ ok: false, error: '連線問題' }))
  }
  // 圖片縮到長邊 1600、JPEG 0.85（Vercel 單次請求 4.5MB 上限；手機原圖常 5MB+）
  function shrink (file) {
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => { const im = new Image(); im.onload = () => { const M = 1600, sc = Math.min(1, M / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.85)) }; im.onerror = () => res(null); im.src = fr.result }; fr.onerror = () => res(null); fr.readAsDataURL(file) })
  }
  async function xlsxToText (file) {
    if (!window.XLSX) await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s) })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    return wb.SheetNames.slice(0, 6).map(n => '【工作表 ' + n + '】\n' + XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })).join('\n\n').slice(0, 40000)
  }
  async function addFiles (files) {
    for (const f of Array.from(files || [])) {
      if (/^image\//.test(f.type)) { if (S.imgs.length >= 4) { alert('最多 4 張圖'); break } const d = await shrink(f); if (d) S.imgs.push(d) } else if (/\.(xlsx|xls)$/i.test(f.name)) { try { S.text = (S.text ? S.text + '\n\n' : '') + await xlsxToText(f) } catch (_) { alert('Excel 讀不進來，請改截圖') } } else if (/\.(csv|txt|md|tsv)$/i.test(f.name) || /^text\//.test(f.type)) { S.text = (S.text ? S.text + '\n\n' : '') + (await f.text()).slice(0, 40000) } else alert('不支援這種檔案：' + f.name + '（可用圖片、CSV、Excel；PDF 請先截圖）')
    }
    paint()
  }
  function onPaste (e) {
    if (!document.getElementById('rcpImp')) return
    const items = Array.from((e.clipboardData || {}).items || []); const imgs = items.filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean)
    if (imgs.length) { e.preventDefault(); addFiles(imgs) }
  }
  document.addEventListener('paste', onPaste)

  // ── 畫面 1：來源輸入 ──
  function paint () {
    const el = document.getElementById('rcpImp'); if (!el || !S) return
    const ta = document.getElementById('rcpImpText'); if (ta) S.text = ta.value
    const ur = document.getElementById('rcpImpUrl'); if (ur) S.url = ur.value
    if (S.res) { el.innerHTML = review(); return }
    el.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${IC.spark} AI 匯入</b><span class="hint">把食譜截圖直接貼上（⌘V／Ctrl+V），或選檔案、貼連結、貼文字 → AI 讀成材料＋步驟 → 你確認後才建草稿</span></div>`
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px"><label class="mini" style="cursor:pointer">${IC.file} 選檔案（圖片／CSV／Excel）<input type="file" multiple accept="image/*,.csv,.txt,.tsv,.xlsx,.xls" style="display:none" onchange="_rcpImpFiles(this.files);this.value=''"></label>`
      + `<input id="rcpImpUrl" value="${esc(S.url || '')}" placeholder="或貼連結（Google 試算表／文件要開「知道連結的人可檢視」、網頁、圖片網址）" style="flex:1;min-width:220px;${inp}"></div>`
      + (S.imgs.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${S.imgs.map((d, i) => `<div style="position:relative"><img src="${d}" style="height:84px;border-radius:8px;border:1px solid var(--line)"><button class="mini" onclick="_rcpImpDelImg(${i})" style="position:absolute;top:-6px;right:-6px;padding:2px 5px">${IC.x}</button></div>`).join('')}</div>` : '')
      + `<textarea id="rcpImpText" placeholder="或把試算表／文字整段貼在這裡（材料、數量、單位、步驟…）" style="width:100%;min-height:${S.text ? 120 : 56}px;margin-top:8px;${inp};font-size:13px">${esc(S.text || '')}</textarea>`
      + `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><input id="rcpImpHint" value="${esc(S.hint || '')}" placeholder="補充給 AI（選填，例：這是 A Beach 的出餐食譜）" style="flex:1;min-width:200px;${inp}"><button class="mini on" ${S.busy ? 'disabled' : ''} onclick="_rcpImpGo()">${IC.spark} ${S.busy ? 'AI 讀取中…（約 10～30 秒）' : 'AI 讀取'}</button></div>`
      + (S.err ? `<div style="color:${COL.r};margin-top:6px;font-size:13px">${IC.warn} ${esc(S.err)}</div>` : '')
  }
  window._rcpImpFiles = f => addFiles(f)
  window._rcpImpDelImg = i => { S.imgs.splice(i, 1); paint() }
  window._rcpImpGo = async function () {
    const ta = document.getElementById('rcpImpText'), ur = document.getElementById('rcpImpUrl'), hi = document.getElementById('rcpImpHint')
    S.text = ta ? ta.value : S.text; S.url = ur ? ur.value.trim() : S.url; S.hint = hi ? hi.value : ''
    if (!S.imgs.length && !S.text.trim() && !S.url) { S.err = '先貼截圖、選檔案、貼文字或連結'; paint(); return }
    S.busy = true; S.err = ''; paint()
    const j = await post({ op: 'import', imgs: S.imgs, text: S.text, url: S.url, hint: S.hint })
    S.busy = false
    if (!j.ok) { S.err = j.error || 'AI 沒讀成功'; paint(); return }
    S.res = j; S.choice = {}; S.meta = { name: j.parsed.name, brand: (document.getElementById('rcpNBrand') || {}).value || 'GROUN:D', type: j.parsed.type, station: j.parsed.station || (document.getElementById('rcpNSt') || {}).value || '', yieldQty: j.parsed.yieldQty == null ? (j.parsed.type === 'dish' ? 1 : '') : j.parsed.yieldQty, yieldUnit: j.parsed.yieldUnit || (j.parsed.type === 'dish' ? '份' : 'g') }
    j.parsed.items.forEach((it, i) => { S.choice[i] = it.match ? it.match.code : '' })
    S.steps = j.parsed.steps.map(s => ({ on: true, ...s }))
    paint()
  }

  // ── 畫面 2：審核表 ──
  const optLabel = c => `${c.label}（${c.sub}）${c.score < 1 ? ' ' + Math.round(c.score * 100) + '%' : ''}`
  function review () {
    const P = S.res.parsed, M = S.meta
    let h = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${IC.spark} AI 讀到的內容</b><span class="hint">AI ${esc((S.res.ai || {}).model || '')}・看了 ${S.res.src.imgs} 張圖${S.res.src.text ? '＋' + S.res.src.text + ' 字' : ''}${S.res.src.note ? '（' + esc(S.res.src.note) + '）' : ''}・請確認下面每一行，確定了再按最下面「建立草稿」</span><button class="mini" style="margin-left:auto" onclick="_rcpImpBack()">${IC.x} 重來</button></div>`
    if (S.res.dupOf) h += `<div style="margin-top:6px;color:${COL.o};font-size:13px">${IC.warn} 食譜庫已經有「${esc(S.res.dupOf.label)}」，確定要再建一份？（或先 <span style="text-decoration:underline;cursor:pointer" onclick="_rcpOpen('${esc(S.res.dupOf.key)}')">打開既有的</span> 看看）</div>`
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px">`
      + `<label style="grid-column:span 2"><div class="hint">名稱</div><input id="rcpImpName" value="${esc(M.name)}" style="width:100%;${inp}"></label>`
      + `<label><div class="hint">品牌</div><select id="rcpImpBrand" style="width:100%;${inp}"><option ${M.brand === 'GROUN:D' ? 'selected' : ''}>GROUN:D</option><option ${M.brand === 'A Beach' ? 'selected' : ''}>A Beach</option></select></label>`
      + `<label><div class="hint">類型</div><select id="rcpImpType" style="width:100%;${inp}" onchange="_rcpImpType(this.value)"><option value="dish" ${M.type === 'dish' ? 'selected' : ''}>餐點（出餐）</option><option value="prep" ${M.type === 'prep' ? 'selected' : ''}>半成品（備料）</option></select></label>`
      + `<label><div class="hint">工作站／品類</div><input id="rcpImpSt" value="${esc(M.station)}" style="width:100%;${inp}"></label>`
      + `<label><div class="hint">產量（${M.type === 'dish' ? '餐點通常 1 份' : '整批做出多少'}）</div><div style="display:flex;gap:4px"><input id="rcpImpYq" type="number" step="any" value="${esc(M.yieldQty)}" style="width:50%;${inp}"><input id="rcpImpYu" value="${esc(M.yieldUnit)}" placeholder="g／ml／份" style="width:50%;${inp}"></div></label></div>`
    // 材料
    const st = S.res.stats
    h += `<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>材料 ${P.items.length}</b><span style="font-size:12px;color:${COL.g}">${IC.check} 自動對到 ${st.matched}</span><span style="font-size:12px;color:${COL.o}">${IC.warn} 要你確認 ${st.suggest}</span><span style="font-size:12px;color:${COL.r}">${IC.x} 對不到 ${st.none}</span><span class="hint">「對到」欄可以換；對不到的原料先留「待補」（阿桑系統有了會自動對上），是自己做的醬料／半成品就按「新增為半成品」</span></div>`
    h += `<div style="overflow:auto;margin-top:6px"><table style="width:100%;border-collapse:collapse;font-size:13.5px"><thead><tr style="color:var(--muted);font-size:12px"><th style="text-align:left;padding:4px 6px">讀到的材料</th><th style="text-align:right;padding:4px 6px">數量</th><th style="text-align:left;padding:4px 6px">單位</th><th style="text-align:left;padding:4px 6px;min-width:260px">對到（物料卡／半成品）</th><th style="padding:4px 6px"></th></tr></thead><tbody>`
    P.items.forEach((it, i) => {
      const ch = S.choice[i], cands = it.candidates || []
      const sel = `<select style="width:100%;${inp}" onchange="_rcpImpPick(${i},this.value)">` + cands.map(c => `<option value="${esc(c.code)}" ${ch === c.code ? 'selected' : ''}>${esc(optLabel(c))}</option>`).join('') + `<option value="" ${ch === '' ? 'selected' : ''}>— 待補（先不對應）—</option><option value="__new" ${ch === '__new' ? 'selected' : ''}>＋ 新增為半成品「${esc(it.name)}」</option></select>`
      const badge = ch === '__new' ? `<span style="color:${COL.p};font-size:12px;white-space:nowrap">${IC.plus} 會新建半成品</span>` : ch ? (it.match && it.match.code === ch ? `<span style="color:${COL.g};font-size:12px;white-space:nowrap">${IC.check} 自動對到</span>` : `<span style="color:${COL.g};font-size:12px;white-space:nowrap">${IC.check} 已選</span>`) : (cands.length ? `<span style="color:${COL.o};font-size:12px;white-space:nowrap">${IC.warn} 請選一個</span>` : `<span style="color:${COL.r};font-size:12px;white-space:nowrap">${IC.x} 待補</span>`)
      h += `<tr style="border-top:1px solid var(--line)"><td style="padding:5px 6px">${it.name ? `<b>${esc(it.name)}</b>` : `<input placeholder="材料名稱" onchange="_rcpImpName(${i},this.value)" style="width:140px;${inp}">`}${it.costHint != null ? `<div class="hint" style="font-size:11.5px">表上成本 ${it.costHint} 元（參考，系統會自己算）</div>` : ''}</td><td style="padding:5px 6px;text-align:right"><input type="number" step="any" value="${it.qty}" onchange="_rcpImpQty(${i},this.value)" style="width:76px;text-align:right;${inp}"></td><td style="padding:5px 6px"><input value="${esc(it.unit)}" onchange="_rcpImpUnit(${i},this.value)" style="width:60px;${inp}"></td><td style="padding:5px 6px">${sel}</td><td style="padding:5px 6px">${badge} <button class="mini" style="padding:2px 6px" onclick="_rcpImpDelItem(${i})" title="刪掉這行">${IC.trash}</button></td></tr>`
    })
    h += `</tbody></table></div><button class="mini" style="margin-top:6px" onclick="_rcpImpAddItem()">${IC.plus} 加一行材料</button>`
    // 步驟
    h += `<div style="margin-top:12px"><b>步驟 ${S.steps.length}</b> <span class="hint">勾選的會一起存進草稿；可直接改字</span></div>`
    if (!S.steps.length) h += `<div class="hint" style="padding:8px 0">AI 沒讀到步驟（表上沒有）。建立後可到食譜「步驟」分頁補。</div>`
    S.steps.forEach((s, i) => { h += `<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;padding:8px;background:var(--soft);border-radius:10px"><input type="checkbox" ${s.on ? 'checked' : ''} onchange="_rcpImpStep(${i},'on',this.checked)" style="margin-top:8px"><div style="flex:1;min-width:0"><div style="display:flex;gap:6px;flex-wrap:wrap"><span class="hint" style="padding-top:7px">${i + 1}.</span><input value="${esc(s.title)}" placeholder="標題" onchange="_rcpImpStep(${i},'title',this.value)" style="flex:1;min-width:140px;${inp}"><label class="hint" style="display:flex;align-items:center;gap:4px">計時秒<input type="number" value="${s.timerSec || 0}" onchange="_rcpImpStep(${i},'timerSec',this.value)" style="width:70px;${inp}"></label></div><textarea onchange="_rcpImpStep(${i},'desc',this.value)" style="width:100%;margin-top:4px;min-height:40px;${inp};font-size:13px">${esc(s.desc)}</textarea></div></div>` })
    if (P.notes) h += `<div class="hint" style="margin-top:8px">AI 另外看到：${esc(P.notes)}</div>`
    h += `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px"><button class="mini on" ${S.busy ? 'disabled' : ''} onclick="_rcpImpCreate()">${IC.check} ${S.busy ? '建立中…' : '確認，建立草稿'}</button><span class="hint">建立的是草稿（不會直接發布）；待補的材料要補齊才能發布</span>${S.err ? `<span style="color:${COL.r}">${IC.warn} ${esc(S.err)}</span>` : ''}</div>`
    return h
  }
  window._rcpImpBack = () => { S.res = null; S.err = ''; paint() }
  window._rcpImpPick = (i, v) => { S.choice[i] = v; syncMeta(); paint() }
  window._rcpImpQty = (i, v) => { S.res.parsed.items[i].qty = Number(v) || 0 }
  window._rcpImpUnit = (i, v) => { S.res.parsed.items[i].unit = String(v).slice(0, 10) }
  window._rcpImpDelItem = i => { syncMeta(); S.res.parsed.items.splice(i, 1); const c = {}; Object.keys(S.choice).map(Number).sort((a, b) => a - b).forEach(k => { if (k < i) c[k] = S.choice[k]; else if (k > i) c[k - 1] = S.choice[k] }); S.choice = c; paint() }
  window._rcpImpAddItem = () => { syncMeta(); S.res.parsed.items.push({ name: '', qty: 0, unit: 'g', candidates: [], match: null }); S.choice[S.res.parsed.items.length - 1] = ''; paint() }
  window._rcpImpName = (i, v) => { S.res.parsed.items[i].name = String(v).slice(0, 80) }
  window._rcpImpStep = (i, k, v) => { S.steps[i][k] = k === 'timerSec' ? (Number(v) || 0) : v }
  window._rcpImpType = v => { syncMeta(); S.meta.type = v; if (v === 'dish' && !(Number(S.meta.yieldQty) > 0)) { S.meta.yieldQty = 1; S.meta.yieldUnit = '份' } paint() }
  function syncMeta () { const g = id => document.getElementById(id); if (!g('rcpImpName')) return; S.meta = { name: g('rcpImpName').value, brand: g('rcpImpBrand').value, type: g('rcpImpType').value, station: g('rcpImpSt').value, yieldQty: g('rcpImpYq').value, yieldUnit: g('rcpImpYu').value } }

  window._rcpImpCreate = async function () {
    syncMeta(); const M = S.meta, P = S.res.parsed
    const name = String(M.name || '').trim(); if (!name) { S.err = '名稱不能空'; paint(); return }
    const items = P.items.filter(it => String(it.name || '').trim())
    const pending = items.filter((it, i) => S.choice[P.items.indexOf(it)] === '' && (it.candidates || []).length)
    if (pending.length && !confirm(`有 ${pending.length} 行材料有候選但你還沒選（${pending.map(p => p.name).slice(0, 4).join('、')}…），先用「待補」建立？`)) return
    S.busy = true; S.err = ''; paint()
    try {
      const ts = Date.now().toString(36); let n = 0
      const finalItems = []
      for (const it of items) {
        const i = P.items.indexOf(it); let code = S.choice[i] || ''
        if (code === '__new') { // 先建半成品草稿，代碼＝它的 key
          const subKey = 'own:' + ts + 's' + (n++)
          const j = await post({ op: 'create', key: subKey, name: it.name, brand: M.brand, type: 'prep', station: M.station, note: '由「' + name + '」AI 匯入時新增，材料／產量待填' })
          if (!j.ok) throw new Error('新增半成品「' + it.name + '」失敗：' + (j.error || ''))
          code = subKey
        }
        finalItems.push({ code, name: it.name, qty: Number(it.qty) || 0, unit: it.unit || '', match: code ? 'matched' : 'unmatched' })
      }
      const key = 'own:' + ts
      const j = await post({ op: 'create', key, name, brand: M.brand, type: M.type, station: M.station, items: finalItems, yieldQty: M.yieldQty, yieldUnit: M.yieldUnit, note: 'AI 匯入（' + (S.res.ai || {}).model + '）' + (P.notes ? '：' + P.notes.slice(0, 200) : '') })
      if (!j.ok) throw new Error(j.error || '建立失敗')
      const steps = S.steps.filter(s => s.on && (s.title || s.desc)).map(s => ({ title: s.title, desc: s.desc, timerSec: s.timerSec || 0, media: [], itemCodes: [] }))
      if (steps.length) { const j2 = await post({ op: 'edit', key, v: 1, steps }); if (!j2.ok) S.err = '草稿建好了，但步驟沒存成功：' + (j2.error || '') }
      const box = document.getElementById('rcpNewBox'); if (box) box.remove()
      S = null
      await rcpRefresh()
      _rcpMode(M.type === 'dish' ? 'dish' : 'prep'); _rcpOpen(key)
    } catch (e) { S.busy = false; S.err = String(e.message || e); paint() }
  }

  // ── 接到既有「新增食譜」盒：原本的手動列保留，下面多一塊 AI 匯入 ──
  const origNew = window._rcpNew
  window._rcpNew = function () {
    if (typeof origNew === 'function') origNew()
    const box = document.getElementById('rcpNewBox'); if (!box) { S = null; return }
    const hint = box.querySelector('.hint'); if (hint) hint.textContent = '上面＝手動建空白草稿；下面＝丟截圖／檔案／連結給 AI 讀，確認後建草稿。'
    const d = document.createElement('div'); d.id = 'rcpImp'; d.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)'
    box.appendChild(d); S = { imgs: [], text: '', url: '', hint: '', busy: false, res: null, err: '' }; paint()
    d.addEventListener('dragover', e => { e.preventDefault() }); d.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files) })
  }
})()
