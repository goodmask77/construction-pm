// ── 入職 2.1 對外端點：契約簽署頁 / 私密檔案上傳與連結 / 審核（核准/退回）──
// GET  ?action=sign&t=<token>   → 契約簽署頁（HTML；token 存在名冊本人卡上）
// POST ?action=sign             → {t, name, agree} 完成簽署
// POST ?action=upload           → (Bearer=登入者，主管或本人) {personId, fieldKey, filename, dataUrl} → 存私有桶
// GET  ?action=docurl&path=...  → (Bearer=登入者) 主管/本人 → 短效簽名連結
// POST ?action=approve|reject   → (Bearer 管理員/主管) {personId, dept?, reason?}
import { SB_URL, SB_KEY, svc, loadRoster, saveRoster, signedUrl, uploadPrivate } from './_onboard.js'
import { DOC_LABOR_CONTRACT } from '../src/shift/docs.js'

async function whoAmI(req) { // 驗登入者 → {id, role, name} 或 null
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  const u = await r.json()
  if (!u?.id) return null
  const pr = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${u.id}&select=role,display_name`, { headers: svc })
  const rows = pr.ok ? await pr.json() : []
  return { id: u.id, role: rows[0]?.role || 'staff', name: rows[0]?.display_name || '' }
}
const isMgr = (me) => me && (me.role === 'admin' || me.role === 'manager')
const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
function signPage(name, token, contract) {
  return `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>勞動契約線上簽署 — GROUN:D</title><style>
body{font-family:-apple-system,'PingFang TC','Noto Sans TC',sans-serif;background:#F2EDE3;color:#211C15;margin:0;padding:16px}
.card{max-width:640px;margin:0 auto;background:#fff;border:1px solid #d9cfbd;border-radius:14px;padding:20px}
h1{font-size:19px;margin:0 0 4px}.sub{font-size:12.5px;color:#8a8172;margin-bottom:14px}
pre{white-space:pre-wrap;font-family:inherit;font-size:13.5px;line-height:1.75;background:#FBF7EE;border:1px solid #e6ddc9;border-radius:10px;padding:14px;max-height:52vh;overflow-y:auto}
label{display:flex;gap:8px;align-items:flex-start;font-size:14px;margin:14px 0;line-height:1.5}
input[type=text]{width:100%;box-sizing:border-box;border:1px solid #d9cfbd;border-radius:8px;padding:10px;font-size:16px}
button{width:100%;border:none;background:#C13A22;color:#fff;border-radius:10px;padding:13px;font-size:16px;font-weight:700;margin-top:14px}
button:disabled{background:#C8BCA0}.ok{color:#3C8C3C;font-weight:700;font-size:16px;text-align:center;padding:30px 0}
.err{color:#b3261e;font-size:13.5px;margin-top:8px}</style></head><body><div class="card">
<h1>勞動契約線上簽署</h1><div class="sub">簽署人：${esc(name)}｜GROUN:D（A Beach 101）｜請完整閱讀後於下方簽名</div>
<pre>${esc(contract)}</pre>
<label><input type="checkbox" id="agree"> 我已詳閱並同意上述勞動契約內容，本線上簽署與親筆簽名具同等效力。</label>
<div style="font-size:12px;color:#8a8172;margin-bottom:4px">簽名（請輸入你的本名：${esc(name)}）</div>
<input type="text" id="nm" placeholder="輸入本名" autocomplete="off">
<div class="err" id="err"></div>
<button id="go" onclick="submitSign()">✍ 確認簽署</button>
<div id="done" style="display:none" class="ok">✅ 簽署完成！可以關閉此頁，回 App 繼續完成其他入職資料。</div>
<script>
async function submitSign(){
  const err=document.getElementById('err');err.textContent='';
  if(!document.getElementById('agree').checked){err.textContent='請先勾選「我已詳閱並同意」。';return}
  const nm=document.getElementById('nm').value.trim();
  if(!nm){err.textContent='請輸入本名簽名。';return}
  const b=document.getElementById('go');b.disabled=true;b.textContent='送出中…';
  try{
    const r=await fetch('/api/onboard?action=sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t:${JSON.stringify(token)},name:nm,agree:true})});
    const d=await r.json();
    if(d.ok){b.style.display='none';document.querySelector('pre').style.maxHeight='20vh';document.getElementById('done').style.display='block'}
    else{err.textContent=d.error||'送出失敗，請再試一次。';b.disabled=false;b.textContent='✍ 確認簽署'}
  }catch(e){err.textContent='網路異常，請再試一次。';b.disabled=false;b.textContent='✍ 確認簽署'}
}
</script></div></body></html>`
}

export default async function handler(req, res) {
  try {
    if (!SB_URL || !SB_KEY) return res.status(500).json({ error: '後端未設定' })
    const action = req.query?.action || ''

    // ── 簽署頁（免登入、token 綁名冊本人）──
    if (action === 'sign' && req.method === 'GET') {
      const t = req.query?.t || ''
      const roster = await loadRoster()
      const p = roster.people.find(x => x.signToken === t)
      res.setHeader('content-type', 'text/html; charset=utf-8')
      if (!p) return res.status(404).send('<meta charset="utf-8">連結無效。請回 App 的入職資料卡重新點「簽署契約」。')
      if (p.contractSigned) return res.status(200).send('<meta charset="utf-8">✅ 已完成簽署。可關閉此頁。')
      return res.status(200).send(signPage(p.name || '', t, DOC_LABOR_CONTRACT))
    }
    if (action === 'sign' && req.method === 'POST') {
      const { completeSign } = await import('./_onboard.js')
      const body = bodyOf(req)
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || ''
      const out = await completeSign(String(body.t || ''), String(body.name || ''), ip)
      return res.status(out.error ? 400 : 200).json(out)
    }

    // ── 私密檔案上傳（主管或本人；存私有桶並寫回名冊欄位）──
    if (action === 'upload' && req.method === 'POST') {
      const me = await whoAmI(req)
      if (!me) return res.status(401).json({ error: '未登入' })
      const body = bodyOf(req)
      const { personId, fieldKey, filename } = body
      if (!personId || !fieldKey || !/^[\w]+$/.test(fieldKey)) return res.status(400).json({ error: '參數不足' })
      const m = String(body.dataUrl || '').match(/^data:([\w/+.-]+);base64,(.+)$/s)
      if (!m) return res.status(400).json({ error: '檔案格式錯誤' })
      const buf = Buffer.from(m[2], 'base64')
      if (buf.length > 12 * 1024 * 1024) return res.status(400).json({ error: '檔案太大（上限 12MB）' })
      const roster = await loadRoster()
      const p = roster.people.find(x => x.id === personId)
      if (!p) return res.status(404).json({ error: '找不到人員' })
      if (!isMgr(me) && p.account !== me.name) return res.status(403).json({ error: '只有主管或本人可以上傳' })
      const safe = String(filename || 'file').replace(/[^\w.一-鿿-]/g, '_').slice(0, 60)
      const path = `roster/${p.id}/${fieldKey}-${Date.now().toString(36)}-${safe}`
      const ok = await uploadPrivate(path, buf, m[1])
      if (!ok) return res.status(500).json({ error: '儲存失敗，請再試一次' })
      const entry = { name: safe, path, private: true, ts: new Date().toISOString(), by: me.name }
      p[fieldKey] = [...(Array.isArray(p[fieldKey]) ? p[fieldKey] : []), entry]
      await saveRoster(roster)
      return res.status(200).json({ ok: true, entry })
    }

    // ── 私密文件短效連結（主管/本人）──
    if (action === 'docurl' && req.method === 'GET') {
      const me = await whoAmI(req)
      if (!me) return res.status(401).json({ error: '未登入' })
      const path = String(req.query?.path || '')
      if (!/^(roster|onboard)\/[\w-]+\/[\w.一-鿿()-]+$/.test(path)) return res.status(400).json({ error: '路徑不合法' })
      if (!isMgr(me)) {
        const roster = await loadRoster()
        const mine = roster.people.find(p => p.account === me.name && (path.startsWith(`roster/${p.id}/`) || path.startsWith(`onboard/${p.onboardId || '__none__'}/`)))
        if (!mine) return res.status(403).json({ error: '沒有權限' })
      }
      const url = await signedUrl(path, 300)
      if (!url) return res.status(404).json({ error: '檔案不存在' })
      return res.status(200).json({ url })
    }

    // ── 獎勵藏寶盒 LINE 通知（使用申請→通知操作者；核銷/退回→通知本人）。資料本體由 App 寫，這裡只發通知 ──
    if (action === 'reward-event' && req.method === 'POST') {
      const me = await whoAmI(req)
      if (!me) return res.status(401).json({ error: '未登入' })
      const body = bodyOf(req)
      const mod = await import('./_onboard.js')
      const shop = (await mod.kvGet('sp_crew_kb_shop')) || { redemptions: [] }
      const rd = (shop.redemptions || []).find(x => x.id === body.redemptionId)
      if (!rd) return res.status(404).json({ error: '找不到兌換紀錄' })
      const roster = await loadRoster()
      const owner = roster.people.find(p => p.id === rd.userId)
      if (body.kind === 'use') {
        if (!owner || owner.account !== me.name) return res.status(403).json({ error: '只有本人可以申請使用' })
        await mod.notifyOps(`🎫 ${owner.name} 申請使用獎品「${rd.name}」。請當面確認交付後，到 App 獎勵中心按「核銷」。`)
        return res.status(200).json({ ok: true })
      }
      if (body.kind === 'verified' || body.kind === 'returned') {
        if (!isMgr(me)) return res.status(403).json({ error: '只有管理員/主管可以核銷' })
        if (owner?.lineUserId) await mod.linePush(owner.lineUserId, body.kind === 'verified' ? `🎁 你的「${rd.name}」已核銷使用完成，祝使用愉快！` : `你的「${rd.name}」已退回藏寶盒，之後要用再按「使用」。`)
        return res.status(200).json({ ok: true })
      }
      return res.status(400).json({ error: '未知事件' })
    }

    // ── 核准 / 退回（名冊入職中人員；核心邏輯在 _onboard）──
    if ((action === 'approve' || action === 'reject') && req.method === 'POST') {
      const me = await whoAmI(req)
      if (!isMgr(me)) return res.status(403).json({ error: '只有管理員/主管可以審核' })
      const body = bodyOf(req)
      const mod = await import('./_onboard.js')
      const out = action === 'approve'
        ? await mod.approveApp(body.personId, body.dept || '', me.name, body.startDate)
        : await mod.rejectApp(body.personId, body.reason || '', me.name)
      return res.status(out.error ? 400 : 200).json(out)
    }

    return res.status(400).json({ error: '未知動作' })
  } catch (e) { return res.status(500).json({ error: e?.message || '伺服器錯誤' }) }
}
