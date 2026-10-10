// 成本總覽（批次 5a）正式站截圖驗證：用 MENU_PROBE_KEY 探針免綁定身分（唯讀）。部署後執行：
//   OUT=/tmp MENU_PROBE_KEY=… node scripts/_costdash-shot.mjs
import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js'
import fs from 'node:fs'
const { chromium } = pkg
const KEY = (process.env.MENU_PROBE_KEY || '').trim(), OUT = process.env.OUT || '/tmp', HOST = process.env.HOST || 'ground-pm.vercel.app'
if (!KEY) { console.error('缺 MENU_PROBE_KEY'); process.exit(1) }
const b = await chromium.launch({ channel: 'chrome', headless: true })
for (const [tag, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 }); const pg = await ctx.newPage(); const errs = []
  pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  await pg.route(/\/api\/mail-sync\?(costdash|matlib|matord|costtodo|matcard|waste)=/, r => { const u = r.request().url(); r.continue({ url: u + (u.includes('probe=') ? '' : '&probe=' + encodeURIComponent(KEY)) }) })
  await pg.goto('https://' + HOST + '/ops/?cb=' + Date.now() + '#costdash', { waitUntil: 'networkidle', timeout: 60000 }); await pg.waitForTimeout(1500)
  await pg.evaluate(() => { try { costdashLoad('dash') } catch (e) { window.__e = String(e) } })
  let st = {}
  for (let i = 0; i < 40; i++) { st = await pg.evaluate(() => { const t = (document.getElementById('app') || {}).textContent || ''; return { loading: /載入成本總覽/.test(t), kpi: document.querySelectorAll('.kpi').length, week: /本週成本變動/.test(t), e: window.__e || null, ov: document.documentElement.scrollWidth - document.documentElement.clientWidth } }); if (!st.loading || st.e) break; await pg.waitForTimeout(500) }
  console.log(tag, '總覽', JSON.stringify(st), '錯誤', errs.slice(0, 3))
  await pg.screenshot({ path: `${OUT}/costdash-${tag}-dash.png` })
  await pg.evaluate(() => { try { _cdSub('vendors') } catch (e) { window.__e = String(e) } }); await pg.waitForTimeout(600)
  console.log(tag, '廠商列', await pg.evaluate(() => document.querySelectorAll('#cdBody tbody tr').length))
  await pg.screenshot({ path: `${OUT}/costdash-${tag}-vendors.png` })
  await pg.evaluate(() => { const tr = document.querySelector('#cdBody tbody tr'); if (tr) tr.click() }); await pg.waitForTimeout(6000)
  console.log(tag, '廠商明細', await pg.evaluate(() => ((document.querySelector('.cdInner') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 80)), '錯誤', errs.slice(0, 3))
  await pg.screenshot({ path: `${OUT}/costdash-${tag}-vendor.png` })
  await ctx.close()
}
await b.close()
console.log('截圖', fs.readdirSync(OUT).filter(f => f.startsWith('costdash-')))
