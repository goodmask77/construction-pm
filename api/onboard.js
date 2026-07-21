// ── 入職 2.0 對外端點：契約簽署頁 / 私密文件連結 / 審核（核准/退回）/ 邀請碼設定 ──
// GET  ?action=sign&t=<token>          → 契約簽署頁（HTML，一次性連結）
// POST ?action=sign                    → {t, name, agree} 完成簽署
// GET  ?action=docurl&path=...         → (Bearer=登入者) 管理員/主管/本人 → 302 到短效簽名連結
// GET  ?action=pending                 → (Bearer) 管理員/主管 → 待審核清單
// POST ?action=approve|reject          → (Bearer 管理員/主管) {appId, reason?}
// GET/POST ?action=conf                → (Bearer 管理員) 邀請碼查看/設定 {inviteCode}
import { SB_URL, SB_KEY, svc, kvGet, loadApps, loadRoster, loadConf, saveConf, signedUrl } from './_onboard.js'
import { DOC_LABOR_CONTRACT } from '../src/shift/docs.js'

async function whoAmI(req) { // 驗登入者 → {id, role} 或 null
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
<div id="done" style="display:none" class="ok">✅ 簽署完成！申請已送出，審核通過後 LINE 會收到登入連結。<br>可以關閉此頁回到 LINE。</div>
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

    // ── 簽署頁（免登入、一次性 token）──
    if (action === 'sign' && req.method === 'GET') {
      const t = req.query?.t || ''
      const states = (await kvGet('pm_onboard_state')) || {}
      const st = Object.values(states).find(s => s.signToken === t)
      res.setHeader('content-type', 'text/html; charset=utf-8')
      if (!st) return res.status(404).send('<meta charset="utf-8">連結無效或已完成簽署。請回 LINE 確認狀態。')
      if (st.contractSigned) return res.status(200).send('<meta charset="utf-8">✅ 已完成簽署，等待審核中。可關閉此頁。')
      return res.status(200).send(signPage(st.data?.name || '', t, DOC_LABOR_CONTRACT))
    }
    if (action === 'sign' && req.method === 'POST') {
      const { completeSign } = await import('./_onboard.js')
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || ''
      const out = await completeSign(String(body.t || ''), String(body.name || ''), ip)
      return res.status(out.error ? 400 : 200).json(out)
    }

    // ── 私密文件短效連結（管理員/主管/本人）──
    if (action === 'docurl' && req.method === 'GET') {
      const me = await whoAmI(req)
      if (!me) return res.status(401).json({ error: '未登入' })
      const path = String(req.query?.path || '')
      if (!/^onboard\/[\w-]+\/[\w.-]+$/.test(path)) return res.status(400).json({ error: '路徑不合法' })
      if (!isMgr(me)) {
        // 非主管：只能看自己的（名冊上 account=display_name 且 onboardId 對得上）
        const roster = await loadRoster()
        const mine = roster.people.find(p => p.account === me.name && path.startsWith('onboard/' + (p.onboardId || '__none__') + '/'))
        if (!mine) return res.status(403).json({ error: '沒有權限' })
      }
      const url = await signedUrl(path, 300)
      if (!url) return res.status(404).json({ error: '檔案不存在' })
      return res.status(200).json({ url })
    }

    // ── 待審核清單 ──
    if (action === 'pending' && req.method === 'GET') {
      const me = await whoAmI(req)
      if (!isMgr(me)) return res.status(403).json({ error: '只有管理員/主管可以看' })
      const apps = await loadApps()
      return res.status(200).json({ apps: apps.apps.filter(a => a.status === 'pending') })
    }

    // ── 核准（開帳號→建名冊→綁LINE→發登入連結；核心邏輯在 _onboard.approveApp）──
    if (action === 'approve' && req.method === 'POST') {
      const me = await whoAmI(req)
      if (!isMgr(me)) return res.status(403).json({ error: '只有管理員/主管可以核准' })
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const { approveApp } = await import('./_onboard.js')
      const out = await approveApp(body.appId, body.dept || '', me.name, body.startDate)
      return res.status(out.error ? 400 : 200).json(out)
    }

    // ── 退回 ──
    if (action === 'reject' && req.method === 'POST') {
      const me = await whoAmI(req)
      if (!isMgr(me)) return res.status(403).json({ error: '只有管理員/主管可以退回' })
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const { rejectApp } = await import('./_onboard.js')
      const out = await rejectApp(body.appId, body.reason || '', me.name)
      return res.status(out.error ? 400 : 200).json(out)
    }

    // ── 邀請碼 ──
    if (action === 'conf') {
      const me = await whoAmI(req)
      if (!isMgr(me)) return res.status(403).json({ error: '只有管理員/主管可以設定' })
      if (req.method === 'GET') return res.status(200).json(await loadConf())
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const conf = await loadConf(); conf.inviteCode = String(body.inviteCode || '').trim()
      await saveConf(conf)
      return res.status(200).json({ ok: true, inviteCode: conf.inviteCode })
    }

    return res.status(400).json({ error: '未知動作' })
  } catch (e) { return res.status(500).json({ error: e?.message || '伺服器錯誤' }) }
}
