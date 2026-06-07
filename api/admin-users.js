// 後端：管理員專用的帳號建立/刪除/重設密碼（使用 service-role 金鑰，只在後端）。
// 前端帶上登入者的 access token；這裡先驗證「呼叫者是 admin」才執行。
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '僅支援 POST' })
  if (!url || !serviceKey) return res.status(400).json({ error: '後端未設定 SUPABASE_SERVICE_ROLE_KEY，請在 Vercel 環境變數加入後重新部署。' })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1) 驗證呼叫者身分
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: '未登入' })
  const { data: who, error: whoErr } = await admin.auth.getUser(token)
  if (whoErr || !who?.user) return res.status(401).json({ error: '登入無效，請重新登入' })
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin') return res.status(403).json({ error: '只有管理員可以管理帳號' })

  const { action, username, password, displayName, role, id } = req.body || {}
  try {
    if (action === 'create') {
      if (!username || !password) return res.status(400).json({ error: '帳號與密碼必填' })
      const email = String(username).includes('@') ? String(username) : `${username}@ground.local`
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) return res.status(400).json({ error: /already/i.test(error.message) ? '此帳號已存在' : error.message })
      await admin.from('profiles').upsert({
        id: data.user.id, email,
        display_name: displayName || username,
        role: role || 'staff',
      })
      return res.status(200).json({ ok: true, id: data.user.id })
    }
    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: '缺少帳號 id' })
      if (id === who.user.id) return res.status(400).json({ error: '不能刪除自己' })
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }
    if (action === 'resetPassword') {
      if (!id || !password) return res.status(400).json({ error: '缺少 id 或新密碼' })
      const { error } = await admin.auth.admin.updateUserById(id, { password })
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }
    return res.status(400).json({ error: '未知動作' })
  } catch (e) {
    return res.status(500).json({ error: e?.message || '伺服器錯誤' })
  }
}
