import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto('https://groun-d.vercel.app/ops/?cb=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
await pg.evaluate(() => { try { localStorage.removeItem('gdNtfPin'); localStorage.removeItem('gdNtfRead'); } catch(_){} });
await pg.waitForTimeout(800);
// 確認線上版本有釘選
const hasPin = await pg.evaluate(() => typeof ntfPin === 'function' && /釘選/.test(document.querySelector('script[src*=p09]')?.src ? '' : '') || typeof ntfPin === 'function');
await pg.evaluate(() => { try { ntfPage(); } catch(e){ window.__e=String(e); } });
await pg.waitForTimeout(1000);
const beforePin = await pg.evaluate(() => {
  const chips = [...document.querySelectorAll('#ntfChips button')].map(b=>b.textContent.trim());
  const pinBtns = document.querySelectorAll('#ntfList button[onclick*="ntfPin"]').length;
  return { chips, pinBtns, e: window.__e||null };
});
console.log('釘選前:', JSON.stringify(beforePin));

// 按第一則的釘選鈕
await pg.evaluate(() => { const btn = document.querySelector('#ntfList button[onclick*="ntfPin"]'); if (btn) btn.click(); });
await pg.waitForTimeout(600);
const afterPin = await pg.evaluate(() => {
  const chips = [...document.querySelectorAll('#ntfChips button')].map(b=>b.textContent.trim());
  const stored = JSON.parse(localStorage.getItem('gdNtfPin')||'[]');
  return { chips, pinnedCount: stored.length };
});
console.log('釘選後:', JSON.stringify(afterPin));

// 切到釘選分類
await pg.evaluate(() => { const c = [...document.querySelectorAll('#ntfChips button')].find(b=>/釘選/.test(b.textContent)); if (c) c.click(); });
await pg.waitForTimeout(500);
const pinView = await pg.evaluate(() => {
  const items = document.querySelectorAll('#ntfList > div[onclick]').length;
  const opacity = (document.querySelector('#ntfList > div[onclick]')||{}).style?.opacity;
  return { items, opacity };
});
console.log('釘選分類檢視:', JSON.stringify(pinView));

const pass = typeof hasPin && beforePin.pinBtns>0 && afterPin.chips.some(c=>/釘選/.test(c)) && afterPin.pinnedCount===1 && pinView.items>=1 && pinView.opacity==='1' && errs.length===0 && !beforePin.e;
console.log('\nJS錯誤:', errs.length?errs:'無');
console.log(pass ? '✅ 通過：釘選鈕在、按了出現釘選分類、釘選項保持亮著(opacity 1)、本機有記' : '❌ 未通過');
await b.close();
process.exit(pass?0:1);
