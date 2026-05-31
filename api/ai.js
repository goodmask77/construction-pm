// Vercel Serverless Function：代理 Anthropic Messages API，金鑰由環境變數提供。
// 前端的 callAI() 會 POST { messages, system } 到 /api/ai。
// 依序嘗試多個現行模型，遇到「模型不存在/無權限」自動換下一個。
const MODELS = [
  process.env.ANTHROPIC_MODEL,
  'claude-sonnet-4-5',
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-latest',
].filter(Boolean)

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

  const { messages, system } = req.body || {}
  let lastErr = 'AI 服務錯誤'

  for (const model of MODELS) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 2048, system, messages }),
      })
      const data = await r.json()
      if (r.ok) {
        return res.status(200).json({ content: data.content, model })
      }
      lastErr = data?.error?.message || lastErr
      // 只有「模型相關」錯誤才換下一個；其他錯誤（金鑰/額度）直接回報
      const isModelErr = /model/i.test(lastErr) || r.status === 404
      if (!isModelErr) {
        return res.status(r.status).json({ error: lastErr })
      }
    } catch (e) {
      lastErr = e?.message || 'unknown'
    }
  }
  return res.status(502).json({ error: 'AI 服務錯誤：' + lastErr })
}
