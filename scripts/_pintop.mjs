import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto('https://groun-d.vercel.app/ops/?cb=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
await pg.evaluate(() => { try { localStorage.removeItem('gdNtfPin'); localStorage.removeItem('gdNtfRead'); } catch(_){} });
await pg.waitForTimeout(600);
await pg.evaluate(() => { try { ntfPage(); } catch(e){ window.__e=String(e); } });
await pg.waitForTimeout(900);
// 釘選最後一則（底部那則）
await pg.evaluate(() => { const btns = document.querySelectorAll('#ntfList button[onclick*="ntfPin"]'); const last = btns[btns.length-1]; if (last) last.click(); });
await pg.waitForTimeout(600);
// 回「全部」看置頂
await pg.evaluate(() => { const c = [...document.querySelectorAll('#ntfChips button')].find(b=>/全部/.test(b.textContent)); if (c) c.click(); });
await pg.waitForTimeout(500);
const r = await pg.evaluate(() => {
  const kids = [...document.getElementById('ntfList').children];
  const first = kids[0];
  return {
    firstIsPinHeader: !!(first && /釘選/.test(first.textContent)),
    firstText: first ? first.textContent.trim().slice(0,20) : '',
    hasDashed: kids.some(k=>/dashed/.test(k.getAttribute('style')||'')),
    e: window.__e||null
  };
});
console.log('全部分頁第一個元素:', JSON.stringify(r));
// 驗證線上閃光程式碼
const live = {};
live.taskFlash = (await (await fetch('https://groun-d.vercel.app/ops/tasks.js?v=4524')).text()).includes('function tnFocusFlash');
live.meetNoOpen = !(await (await fetch('https://groun-d.vercel.app/ops/js/p10-perm-init.js?v=4524')).text()).match(/meet=.*meetMop\(\{ op:'view'/);
console.log('線上程式:', JSON.stringify(live));

const pass = r.firstIsPinHeader && r.hasDashed && errs.length===0 && !r.e && live.taskFlash && live.meetNoOpen;
console.log('\nJS錯誤:', errs.length?errs:'無');
console.log(pass ? '✅ 通過：釘選置頂(最上面是釘選區+虛線分隔)、任務閃光碼上線、會議不再自動開卡' : '❌ 未通過');
await b.close();
process.exit(pass?0:1);
