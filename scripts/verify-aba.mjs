// v4.43.8 出勤總覽三視圖尺寸一致性驗證：det/sum/單人 彈窗寬+內容區高要一致（資料少不縮）
// 出勤端點有主管守門（匿名403）→ 注入假 _abaD 走真模板渲染驗 CSS
import puppeteer from 'puppeteer-core'
import fs from 'fs'
const key = (fs.readFileSync('.env.local', 'utf8').match(/OPS_BOARD_KEY="?([^"\n]+)/) || [])[1]
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: '/tmp/pptr-align-prof', args: ['--window-size=1380,900', '--no-first-run'] })
const pg = await br.newPage()
await pg.setViewport({ width: 1380, height: 900 })
await pg.goto(`https://ground-pm.vercel.app/prep?k=${key}`, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 2500))

// 假資料：9月60筆（滿版）+10月3筆（少量）
await pg.evaluate(() => {
  const rows = []
  const names = ['測試一', '測試二', '測試三', '測試四']
  for (let i = 1; i <= 15; i++) for (const n of names)
    rows.push({ d: `2026-09-${String(i).padStart(2, '0')}`, n, w: '12:00～21:00', on: '11:5' + (i % 10), off: '21:30', h: 8.7, late: i % 7 === 0 ? 12 : 0, early: 0, miss: 0, abs: 0 })
  for (let i = 1; i <= 3; i++) rows.push({ d: `2026-10-0${i}`, n: '測試一', w: '12:00～21:00', on: '11:50', off: '21:30', h: 8.7, late: 0, early: 0, miss: 0, abs: 0 })
  window._abaD = rows
  abAttDraw()
})
await pg.waitForFunction(() => document.querySelector('#abaOv table tbody tr'), { timeout: 15000 })
await new Promise(r => setTimeout(r, 400))

const meas = sel => pg.evaluate(s => {
  const ov = document.querySelector(s); if (!ov) return null
  const card = ov.firstElementChild, sc = ov.querySelector('.scroll')
  const c = card.getBoundingClientRect(), k = sc ? sc.getBoundingClientRect() : {}
  return { cardW: Math.round(c.width), cardH: Math.round(c.height), scrollH: Math.round(k.height || 0) }
}, sel)

const det = await meas('#abaOv'); await pg.screenshot({ path: '/tmp/aba-det.png' })

// 切到只有3筆的10月（驗高度不縮）
await pg.evaluate(() => { abaMo = '2026-10'; abAttDraw() })
await new Promise(r => setTimeout(r, 400))
const detSmall = await meas('#abaOv'); await pg.screenshot({ path: '/tmp/aba-det-small.png' })

// sum 視圖
await pg.evaluate(() => { abaView = 'sum'; abAttDraw() })
await new Promise(r => setTimeout(r, 400))
const sum = await meas('#abaOv'); await pg.screenshot({ path: '/tmp/aba-sum.png' })

// 單人視圖
await pg.evaluate(() => { abaView = 'det'; abaMo = 'all'; abAttDraw(); abAttPerson('測試一') })
await new Promise(r => setTimeout(r, 600))
const per = await meas('#abaPOv'); await pg.screenshot({ path: '/tmp/aba-person.png' })

// det 欄寬（收緊後內容欄窄、墊欄吃剩餘）
await pg.evaluate(() => { document.getElementById('abaPOv')?.remove() })
const colW = await pg.evaluate(() => [...document.querySelector('#abaOv table tbody tr').children].map(td => Math.round(td.getBoundingClientRect().width)))

console.log(JSON.stringify({ det, detSmall, sum, person: per, detColWidths: colW }))
await br.close()
