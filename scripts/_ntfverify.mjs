import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(String(e)));
await pg.goto('https://groun-d.vercel.app/ops/?cb=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
// 清本機已讀浮水印＝模擬「有未讀」狀態
await pg.evaluate(() => { try { localStorage.removeItem('gdNtfRead'); } catch(_){} });
await pg.evaluate(() => { try { ntfBadgeSync(); } catch(e){ window.__e1 = String(e); } });
await pg.waitForTimeout(1500);

const before = await pg.evaluate(() => {
  const fav = document.getElementById('favBell');
  return { favDot: !!(fav && fav.querySelector('.ntfDot')), favDotText: (fav && fav.querySelector('.ntfDot')||{}).textContent || '' };
});
console.log('點開前・手機底部鈴鐺紅點:', JSON.stringify(before));

// 打開通知中心
await pg.evaluate(() => { try { ntfPage(); } catch(e){ window.__e2 = String(e); } });
await pg.waitForTimeout(1200);

const opened = await pg.evaluate(() => {
  const ov = document.getElementById('ntfOv');
  const chips = [...document.querySelectorAll('#ntfChips button')].map(b=>b.textContent.trim());
  const items = document.querySelectorAll('#ntfList > div').length;
  return { opened: !!ov, chips, items, e1: window.__e1||null, e2: window.__e2||null };
});
console.log('面板:', JSON.stringify(opened));

// 點開後兩顆鈴鐺紅點應都清掉
await pg.waitForTimeout(400);
const after = await pg.evaluate(() => {
  const fav = document.getElementById('favBell'), side = document.getElementById('ntfBell');
  return { favDot: !!(fav && fav.querySelector('.ntfDot')), sideDot: !!(side && side.querySelector('.ntfDot')) };
});
console.log('點開後・紅點:', JSON.stringify(after));

const pass = opened.opened && opened.chips.some(c=>c.includes('全部')) && !after.favDot && !after.sideDot && errs.length===0 && !opened.e2;
console.log('\nJS錯誤:', errs.length ? errs : '無');
console.log(pass ? '✅ 通過：面板正常開、分類列有、點開後兩顆鈴鐺紅點都清掉' : '❌ 未通過');
await b.close();
process.exit(pass ? 0 : 1);
