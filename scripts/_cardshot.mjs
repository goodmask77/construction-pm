import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await pg.goto('http://localhost:8799/ops/_cardtest.html', { waitUntil: 'networkidle' });
await pg.waitForFunction('window.__ready===true', { timeout: 10000 }).catch(() => {});
await pg.waitForTimeout(800);
// 量測：每張卡的高度、標題是否逐字直排（用標題元素 scrollWidth vs clientWidth + 行數）、徽章是否超出卡片
const audit = await pg.evaluate(() => {
  const cards = [...document.querySelectorAll('.tnfxCard, [data-tid]')];
  let overflow = 0, verticalTitle = 0, badgeOut = 0, n = 0;
  for (const c of cards) {
    n++;
    const cr = c.getBoundingClientRect();
    // 標題元素＝含 -webkit-line-clamp 的 div
    const t = [...c.querySelectorAll('div')].find(d => getComputedStyle(d).webkitLineClamp && getComputedStyle(d).webkitLineClamp !== 'none');
    if (t) { const tr = t.getBoundingClientRect(); if (tr.width < 40) verticalTitle++; }
    // 徽章超出卡片右緣？
    const bs = [...c.querySelectorAll('span')].filter(s => /神話|傳說|史詩|大師|精英|稀有|熟練|進階|例行|日常/.test(s.textContent) && /★|♛/.test(s.textContent));
    for (const b2 of bs) { const br = b2.getBoundingClientRect(); if (br.right > cr.right + 1 || br.left < cr.left - 1 || br.bottom > cr.bottom + 1) badgeOut++; }
    // 內容溢出卡片？
    if (c.scrollWidth > c.clientWidth + 2) overflow++;
  }
  return { n, overflow, verticalTitle, badgeOut };
});
await pg.screenshot({ path: '/tmp/cardtest-full.png', fullPage: true });
console.log('AUDIT', JSON.stringify(audit));
console.log('ERRORS', errs.slice(0, 8).join(' | ') || 'none');
await b.close();
