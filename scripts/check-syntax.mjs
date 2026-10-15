// GD 語法總檢查（abgd 搬家 2026-10-15 聊天室事故治本：p23-chat.js 少一個分號仍被合併上線，聊天室頁壞 3～4 分鐘）
// 對 public/ops/js/*.js、public/ops/*.js、api/*.js 全部跑 node --check（ESM 檔用 --input-type 不適用，直接 node --check 依副檔名與 package type 判斷）
// 任何一支失敗＝結束碼 1 → prebuild 失敗 → Vercel 建置失敗 → PR 檢查不過、不能合併
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const dirs = ['public/ops/js', 'public/ops', 'api']
const files = dirs.filter(existsSync).flatMap(d => readdirSync(d).filter(f => f.endsWith('.js')).map(f => join(d, f)))
const bad = []
for (const f of files) { const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); if (r.status !== 0) bad.push(f + '\n' + (r.stderr || '').split('\n').slice(0, 6).join('\n')) }
if (bad.length) { console.error('✗ 語法錯誤 ' + bad.length + ' 支：\n' + bad.join('\n\n')); process.exit(1) }
console.log('✓ 語法檢查 ' + files.length + ' 支全過')
