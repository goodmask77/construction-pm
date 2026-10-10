// 成本模組批次1「待處理中心」截圖驗證（桌面＋手機）：用 MENU_PROBE_KEY 探針免綁定身分（唯讀，按鈕會顯示「只有採購權限可以做決定」）
// 用法：MENU_PROBE_KEY=… node scripts/_costtodo-shot.mjs   （輸出到 scratchpad 或 OUT 指定資料夾）
import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js'
import fs from 'node:fs'
const { chromium } = pkg
const KEY = (process.env.MENU_PROBE_KEY || '').trim()
const OUT = process.env.OUT || '/tmp'
const HOST = process.env.HOST || 'ground-pm.vercel.app'
if (!KEY) { console.error('缺 MENU_PROBE_KEY'); process.exit(1) }
const b = await chromium.launch({ channel: 'chrome', headless: true })
for (const [tag, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', e => errs.push(String(e)))
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  await pg.route(/\/api\/mail-sync\?(matlib|matord|costtodo)=/, route => { const u = route.request().url(); route.continue({ url: u + (u.includes('probe=') ? '' : '&probe=' + encodeURIComponent(KEY)) }) })
  await pg.goto('https://' + HOST + '/ops/?cb=' + Date.now() + '#matlib-todo', { waitUntil: 'networkidle', timeout: 60000 })
  await pg.waitForTimeout(1500)
  await pg.evaluate(() => { try { matlibLoad() } catch (e) { window.__perr = String(e) } })
  let st = {}
  for (let i = 0; i < 40; i++) {
    st = await pg.evaluate(() => { const t = (document.getElementById('app') || {}).textContent || ''; return { loading: /載入中/.test(t), hasTodo: /偵錯與待處理中心/.test(t), hasList: /排序：影響在賣菜優先/.test(t), err: window.__perr || null, sub: (document.getElementById('costSubCnt') || {}).textContent || '', nav: (document.querySelector('#tab-matlib .costDot') || {}).textContent || '' } })
    if (st.hasList || st.err) break
    if (!st.hasTodo && i === 6) await pg.evaluate(() => { try { _mSub('todo') } catch (e) { window.__perr = String(e) } })
    await pg.waitForTimeout(500)
  }
  console.log(tag, JSON.stringify(st), '錯誤:', errs.slice(0, 3))
  await pg.screenshot({ path: `${OUT}/costtodo-${tag}-price.png`, fullPage: false })
  // 切到單位待確認、展開第一筆
  await pg.evaluate(() => { try { _ctTab('unit') } catch (_) {} })
  await pg.waitForTimeout(400)
  await pg.evaluate(() => { const s = document.querySelector('#ctList section [onclick^="_ctOpen"]'); if (s) s.click() })
  await pg.waitForTimeout(400)
  await pg.screenshot({ path: `${OUT}/costtodo-${tag}-unit.png`, fullPage: false })
  await pg.evaluate(() => { try { _ctTab('gap') } catch (_) {} })
  await pg.waitForTimeout(400)
  await pg.screenshot({ path: `${OUT}/costtodo-${tag}-gap.png`, fullPage: false })
  // 橫向溢出檢查（規格驗收：無橫向溢出）
  const ov = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  console.log(tag, '橫向溢出 px:', ov)
  await ctx.close()
}
await b.close()
console.log('截圖在', OUT, fs.readdirSync(OUT).filter(f => f.startsWith('costtodo-')))
