// 後端：管理員專用的帳號建立/刪除/重設密碼。用 service-role 金鑰，純 fetch 呼叫 Supabase Auth Admin API
// （不 import @supabase/supabase-js，避免 serverless 載入失敗）。前端帶上登入者 access token，先驗證是 admin。
// 容錯：有時環境變數的值會不小心連名稱一起貼進去（例 "NEXT_PUBLIC_SUPABASE_URL=https://..."）或多了結尾斜線/引號，這裡清乾淨。
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim().replace(/\/+$/, '')
const URL_ = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()

const svcHeaders = {
  'content-type': 'application/json',
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: '僅支援 POST' })
    if (!URL_ || !SERVICE) return res.status(400).json({ error: '後端未設定 SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL，請在 Vercel 環境變數加入後重新部署。' })

    // 1) 驗證呼叫者
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: '未登入' })
    const meRes = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: `Bearer ${token}` } })
    if (!meRes.ok) return res.status(401).json({ error: '登入無效，請重新登入' })
    const meUser = await meRes.json()
    const meId = meUser?.id
    if (!meId) return res.status(401).json({ error: '登入無效' })
    const roleRes = await fetch(`${URL_}/rest/v1/profiles?id=eq.${meId}&select=role`, { headers: svcHeaders })
    const roleArr = roleRes.ok ? await roleRes.json() : []
    if (roleArr?.[0]?.role !== 'admin') return res.status(403).json({ error: '只有管理員可以管理帳號' })

    const { action, username, password, displayName, role, id } = req.body || {}

    if (action === 'create') {
      if (!username || !password) return res.status(400).json({ error: '帳號與密碼必填' })
      const email = String(username).includes('@') ? String(username) : `${username}@ground.local`
      const cRes = await fetch(`${URL_}/auth/v1/admin/users`, {
        method: 'POST', headers: svcHeaders,
        body: JSON.stringify({ email, password, email_confirm: true }),
      })
      const cData = await cRes.json().catch(() => ({}))
      if (!cRes.ok) {
        const msg = cData?.msg || cData?.error_description || cData?.error || cData?.message || '建立失敗'
        return res.status(400).json({ error: /already|exists|registered/i.test(JSON.stringify(cData)) ? '此帳號已存在' : msg })
      }
      const newId = cData?.id || cData?.user?.id
      await fetch(`${URL_}/rest/v1/profiles`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ id: newId, email, display_name: displayName || username, role: role || 'staff' }),
      })
      return res.status(200).json({ ok: true, id: newId })
    }

    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: '缺少帳號 id' })
      if (id === meId) return res.status(400).json({ error: '不能刪除自己' })
      const dRes = await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svcHeaders })
      if (!dRes.ok) { const d = await dRes.json().catch(() => ({})); return res.status(400).json({ error: d?.msg || '刪除失敗' }) }
      return res.status(200).json({ ok: true })
    }

    if (action === 'resetPassword') {
      if (!id || !password) return res.status(400).json({ error: '缺少 id 或新密碼' })
      const uRes = await fetch(`${URL_}/auth/v1/admin/users/${id}`, {
        method: 'PUT', headers: svcHeaders, body: JSON.stringify({ password }),
      })
      if (!uRes.ok) { const d = await uRes.json().catch(() => ({})); return res.status(400).json({ error: d?.msg || '重設失敗' }) }
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: '未知動作' })
  } catch (e) {
    return res.status(500).json({ error: e?.message || '伺服器錯誤' })
  }
}
