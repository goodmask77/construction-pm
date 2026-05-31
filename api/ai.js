// Vercel Serverless Function：代理 Anthropic Messages API，金鑰由環境變數提供。
// 前端的 callAI() 會 POST { messages, system } 到 /api/ai。
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '僅支援 POST' })
  }

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return res.status(400).json({
      error: 'AI 顧問尚未設定：請在 Vercel 專案環境變數加入 ANTHROPIC_API_KEY 後重新部署。',
    })
  }

  try {
    const { messages, system } = req.body || {}
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system,
        messages,
      }),
    })
    const data = await r.json()
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || 'AI 服務錯誤' })
    }
    return res.status(200).json({ content: data.content })
  } catch (e) {
    return res.status(500).json({ error: 'AI 代理發生錯誤：' + (e?.message || 'unknown') })
  }
}
