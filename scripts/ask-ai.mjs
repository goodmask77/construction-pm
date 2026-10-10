// 本機小工具（給 CC 在對話中交叉比對用）：用 App 同一套 AI 中樞直接問三家
// 用法：node scripts/ask-ai.mjs <openai|gemini|anthropic> "問題" [模型]      → 文字
//       node scripts/ask-ai.mjs <gemini|openai> --img "畫面描述" [模型]       → 存圖到 scratch/ai_img_*.png
//       node scripts/ask-ai.mjs <openai|gemini|anthropic> --models [text|image] → 列模型
// 金鑰從 .env.local 讀（不進 git）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const f of ['.env.local', '.env']) { const p = path.join(root, f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } }
const { aiCall, aiImage, aiListModels, defaultModel } = await import('../api/_ai.js')
const [provider, a1, a2, a3] = process.argv.slice(2)
if (!provider) { console.log('用法見檔頭'); process.exit(1) }
if (a1 === '--models') { console.log(JSON.stringify(await aiListModels(provider, a2 || 'text'), null, 1)); process.exit(0) }
if (a1 === '--img') {
  const r = await aiImage('image', { override: { provider, model: a3 || defaultModel(provider, 'image') }, noFallback: true, prompt: a2 })
  const out = path.join(root, 'scratch'); fs.mkdirSync(out, { recursive: true })
  const fp = path.join(out, 'ai_img_' + Date.now() + '.' + ((r.mime || 'image/png').split('/')[1] || 'png'))
  fs.writeFileSync(fp, Buffer.from(r.data, 'base64')); console.log(r.provider, r.model, '→', fp, r.note || ''); process.exit(0)
}
const t0 = Date.now()
const r = await aiCall('app', { override: { provider, model: a2 || defaultModel(provider, 'text') }, noFallback: true, messages: [{ role: 'user', content: a1 }], maxTokens: 2000 })
console.log(`[${r.provider} ${r.model} ${((Date.now() - t0) / 1000).toFixed(1)}s]\n` + r.text)
