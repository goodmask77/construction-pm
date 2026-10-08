import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const pg = await ctx.newPage();
const HOST = process.env.HOST || 'groun-d.vercel.app';
await pg.goto('https://' + HOST + '/ops/?cb=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
await pg.waitForTimeout(2500);

// 診斷：實際載到的頁
const diag = await pg.evaluate(() => ({ title: document.title, url: location.href, hasApp: !!document.getElementById('app'), hasPrepFn: typeof prepPage, scripts: [...document.scripts].map(s=>s.src).filter(x=>/p0[0-9]/.test(x)).length }));
console.log('診斷:', JSON.stringify(diag));

// 確認載入的 p01-core.js 版號
const ver = await pg.evaluate(() => [...document.scripts].map(s=>s.src).find(x=>/p01-core/.test(x)) || '');
console.log('p01-core 版本:', ver);

// 進備料/銷售數據頁（prepPage）——這就是張良點「明日備料建議」會到的頁
await pg.evaluate(() => { try { prepPage(true); } catch(e) { window.__perr = String(e); } });

// 等最多 15 秒看 app 是否脫離「載入中」
let state = {};
for (let i = 0; i < 30; i++) {
  state = await pg.evaluate(() => {
    const app = document.getElementById('app');
    const t = app ? app.textContent : '';
    return {
      stuck: /載入中/.test(t),
      hasPrepTable: /預估備料量/.test(t),
      hasErr: /讀不到資料/.test(t),
      perr: window.__perr || null,
      upd: (document.getElementById('upd')||{}).textContent || ''
    };
  });
  if (!state.stuck && (state.hasPrepTable || state.hasErr)) break;
  await pg.waitForTimeout(500);
}
console.log('備料頁狀態:', JSON.stringify(state, null, 2));

// 再驗首頁儀表板（renderBoard）不會因 soldoutH 當掉
await pg.evaluate(() => { try { load('ground', true); } catch(e) { window.__herr = String(e); } });
await pg.waitForTimeout(2500);
const home = await pg.evaluate(() => {
  const app = document.getElementById('app'); const t = app ? app.textContent : '';
  return { stuck: /^\s*載入中/.test(t), hasKpi: /總營收/.test(t), hasSoldout: /停售動態/.test(t), herr: window.__herr || null };
});
console.log('首頁狀態:', JSON.stringify(home, null, 2));

const pass = !state.stuck && state.hasPrepTable && !state.perr && !home.herr && home.hasKpi;
console.log(pass ? '\n✅ 通過：備料頁不再卡載入中、首頁正常' : '\n❌ 未通過');
await b.close();
process.exit(pass ? 0 : 1);
