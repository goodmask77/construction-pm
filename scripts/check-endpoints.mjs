// 🚦 端點重複檢查器（v4.41.4 張良「舊的職級設定口找到舊資料 滿常發生 怎麼根除」）
// 根因：api/mail-sync.js 一大坨 if (req.query?.xxx) 由多個 AI session 分頭加，撞名時「排前面的先贏」＝新口默默被攔截（gdrole 事件）。
// 根除：每次 build（prebuild→selftest）自動掃描——同一檔同名端點出現 2 次以上＝直接 FAIL 擋部署。
// 順手產出 docs/ENDPOINTS.gen.md＝全端點目錄（哪個口在哪一行），AI 加新口前先看這份。
import fs from 'node:fs'
import path from 'node:path'

const API_DIR = 'api'
// 故意同名的（方法分流等）白名單：{ '檔名|口名': 允許次數 }
const ALLOW = {
  'mail-sync.js|gdrole': 2, // v4.41.3 兩口合一：1420行舊口收 POST、後面只留 GET 查職級
}

const files = fs.readdirSync(API_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'))
const GUARD_RE = /if \((?:req\.method === '[A-Z]+' && )?req\.query\?\.([A-Za-z_]\w*)\s*\)/
let bad = 0
const inventory = {}

for (const f of files) {
  const lines = fs.readFileSync(path.join(API_DIR, f), 'utf8').split('\n')
  const seen = {}
  lines.forEach((ln, i) => {
    const m = ln.match(GUARD_RE)
    if (!m) return
    const name = m[1]
    ;(seen[name] = seen[name] || []).push(i + 1)
  })
  inventory[f] = seen
  for (const [name, locs] of Object.entries(seen)) {
    const cap = ALLOW[`${f}|${name}`] || 1
    if (locs.length > cap) {
      bad++
      console.error(`❌ 重複端點：${f} ?${name}= 出現 ${locs.length} 次（行 ${locs.join(', ')}）——排前面的會攔截後面的！合併成一個口，或確定是方法分流就加進 ALLOW 白名單`)
    }
  }
}

// 產端點目錄（給下個 AI session 查「這個口存在嗎」用——加新口前先看這份或直接跑本腳本）
let md = '# API 端點目錄（自動產生，別手改）\n\n`node scripts/check-endpoints.mjs` 產生；加新端點前先搜這份，撞名=build 直接擋。\n'
for (const [f, seen] of Object.entries(inventory)) {
  const names = Object.keys(seen).sort()
  if (!names.length) continue
  md += `\n## api/${f}（${names.length} 個口）\n\n`
  names.forEach(n => { md += `- \`?${n}=\` 行 ${seen[n].join(', ')}\n` })
}
fs.mkdirSync('docs', { recursive: true })
fs.writeFileSync('docs/ENDPOINTS.gen.md', md)

const total = Object.values(inventory).reduce((t, s) => t + Object.keys(s).length, 0)
if (bad) { console.error(`\n🚫 ${bad} 個重複端點——修掉才能部署`); process.exit(1) }
console.log(`✅ 端點檢查通過：${files.length} 檔共 ${total} 個口、無重複；目錄已更新 docs/ENDPOINTS.gen.md`)
