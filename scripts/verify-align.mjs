// v4.43.7 表格對齊視覺驗證（一次性工具）：開正式站 /prep，截菜單編輯表＋違規清單（stub 假資料走真模板）
import puppeteer from 'puppeteer-core'
import fs from 'fs'

const key = (fs.readFileSync('.env.local', 'utf8').match(/OPS_BOARD_KEY="?([^"\n]+)/) || [])[1]
if (!key) { console.error('no key'); process.exit(1) }
const URL0 = `https://ground-pm.vercel.app/prep?k=${key}`

const br = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, userDataDir: '/tmp/pptr-align-prof', args: ['--window-size=1280,900', '--no-first-run']
})
const pg = await br.newPage()
await pg.setViewport({ width: 1280, height: 900 })
await pg.goto(URL0, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 3000))

// ① 菜單編輯表
await pg.evaluate(() => menuLoad())
await pg.waitForFunction(() => document.querySelector('#app table thead th'), { timeout: 30000 })
await new Promise(r => setTimeout(r, 1200))
const t1 = await pg.$('#app table')
if (t1) await t1.screenshot({ path: '/tmp/align-menu.png' })
// 回報每欄 th/td 的 computed text-align
const menuAl = await pg.evaluate(() => {
  const tb = document.querySelector('#app table'); if (!tb) return null
  const ths = [...tb.querySelectorAll('thead th')]
  const tds = [...(tb.querySelector('tbody tr') || { children: [] }).children]
  return ths.map((th, i) => ({
    col: th.textContent.trim(),
    th: getComputedStyle(th).textAlign,
    td: tds[i] ? getComputedStyle(tds[i]).textAlign : '—'
  }))
})
console.log('MENU:', JSON.stringify(menuAl))

// ② 違規清單（stub 假資料走真模板）
await pg.evaluate(() => {
  window.shVioEnsureAll = async () => {}
  window.shVioCompute = () => ({
    g: { '測試夥伴|2026-10-01': ['單日 >12 小時（13.2h）'] },
    a: { '測試二|2026-10-02': ['班距不足 11 小時'] }
  })
  shVioList()
})
await pg.waitForFunction(() => document.querySelector('#vioOv table'), { timeout: 15000 })
await new Promise(r => setTimeout(r, 800))
const t2 = await pg.$('#vioOv table')
if (t2) await t2.screenshot({ path: '/tmp/align-vio.png' })
const vioAl = await pg.evaluate(() => {
  const tb = document.querySelector('#vioOv table'); if (!tb) return null
  const ths = [...tb.querySelectorAll('thead th')]
  const tds = [...(tb.querySelector('tbody tr') || { children: [] }).children]
  return ths.map((th, i) => ({
    col: th.textContent.trim() || '(鈕)',
    th: getComputedStyle(th).textAlign,
    td: tds[i] ? getComputedStyle(tds[i]).textAlign : '—'
  }))
})
console.log('VIO:', JSON.stringify(vioAl))

await br.close()
console.log('DONE')
