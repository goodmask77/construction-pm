// 本機實測 AI 讀秤：用 .env.local 的 GEMINI_API_KEY（本機沒有 Anthropic 金鑰）直接 override 走中樞，驗 prompt＋JSON 解析
import fs from 'node:fs'
const root = process.argv[2]
for (const ln of fs.readFileSync(root + '/.env.local', 'utf8').split('\n')) { const m = ln.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'k'
const W = await import(process.argv[3] + '/api/_waste.js')
const dir = '/private/tmp/claude-501/-Users-wayz-Documents-Claude-Projects-construction-pm/ad000a92-c167-43d6-a3f7-f64fab57aa2f/scratchpad/waste'
const data = fs.readFileSync(dir + '/scale.jpg').toString('base64')
const cands = [{ code: 'GD-2', name: '美生菜', unit: '公斤', category: '蔬果' }, { code: 'GD-7', name: '青花菜', unit: '公斤', category: '蔬果' }, { code: 'GDS-0074', name: '白醬', unit: '包', category: '醬料' }]
for (const model of ['gemini-3.8-flash']) {
  const t0 = Date.now()
  const r = await W.askAi({ saved: [{ type: 'scale', media_type: 'image/jpeg', data }, { type: 'wide', media_type: 'image/jpeg', data }], cands, refs: [], station: 'Pizza', override: { provider: 'gemini', model } })
  console.log(model, Math.round((Date.now() - t0) / 100) / 10 + 's', 'err=', r.aiErr, '\nparsed=', JSON.stringify(r.ai), '\nest=', JSON.stringify(r.est), '\nraw=', (r.aiRaw || '').slice(0, 300))
}
