// Vercel Serverless Function：主 App 的 AI 顧問端點（前端 callAI() POST { messages, system }）。
// v4.70.29 改走 AI 中樞 api/_ai.js route=app：設定頁可選 ChatGPT／Claude／Gemini，金鑰全在伺服器端，壞了自動退備援。
// 回傳格式維持舊樣（content:[{type:'text',text}]）前端不用改。
import { aiCall } from './_ai.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '僅支援 POST' })
  const { messages, system } = req.body || {}
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: '缺 messages' })
  try {
    const r = await aiCall('app', { system, messages, maxTokens: 16000 })
    return res.status(200).json({ content: [{ type: 'text', text: r.text }], model: r.model, provider: r.provider, stop_reason: r.stop, usage: r.usage })
  } catch (e) {
    const nokey = (e.tried || []).length && e.tried.every(t => /尚未設定金鑰/.test(t.err))
    return res.status(nokey ? 400 : 502).json({ error: (nokey ? 'AI 顧問尚未設定金鑰：' : 'AI 服務錯誤：') + (e.message || '未知'), tried: e.tried })
  }
}
