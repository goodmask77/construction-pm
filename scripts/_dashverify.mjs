import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ channel: 'chrome', headless: true });

async function check(store, label, mobile) {
  const ctx = await b.newContext({ viewport: mobile ? { width: 414, height: 900 } : { width: 1200, height: 1000 } });
  const pg = await ctx.newPage();
  await pg.goto('https://construction-mt2cgsyrz-goodmask77s-projects.vercel.app/ops/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(4500);
  if (store !== 'ground') { await pg.evaluate(s => load(s), store); await pg.waitForTimeout(2500); }
  else { await pg.waitForTimeout(1200); }
  // wait for KPI
  for (let i = 0; i < 30; i++) { const n = await pg.evaluate(() => document.querySelectorAll('.kpi').length); if (n) break; await pg.waitForTimeout(400); }
  const r = await pg.evaluate(() => {
    const out = {};
    const bseg = document.querySelector('.bseg.on');
    out.underline = bseg ? getComputedStyle(bseg).borderBottomWidth : 'n/a';
    const brand = document.querySelector('.brand');
    out.brandFont = brand ? getComputedStyle(brand).fontSize : 'n/a';
    out.updText = (document.getElementById('upd') || {}).textContent;
    const kpis = [...document.querySelectorAll('.kpi')].map(k => ({
      l: (k.querySelector('.l') || {}).textContent, v: (k.querySelector('.v') || {}).textContent, sub2: (k.querySelector('.sub2') || {}).textContent
    }));
    out.kpis = kpis;
    // 每日數據 header
    const h2s = [...document.querySelectorAll('h2')];
    const dh = h2s.find(x => /每日數據/.test(x.textContent));
    out.dailyHdr = dh ? dh.textContent.replace(/\s+/g, ' ').trim() : '(none)';
    out.dailyHdrLines = dh ? dh.getClientRects().length : 0;
    out.dailyHdrHeight = dh ? Math.round(dh.getBoundingClientRect().height) : 0;
    // heatmap
    const heat = h2s.find(x => /時段營收熱力圖/.test(x.textContent));
    out.heatmap = !!heat;
    if (heat) {
      const sec = heat.closest('section');
      out.heatCells = sec ? sec.querySelectorAll('tbody td').length : 0;
      out.heatCols = sec ? sec.querySelectorAll('thead th').length : 0;
      out.heatHint = /沒有時段明細/.test(sec.textContent);
    }
    return out;
  });
  console.log('\n===== ' + label + ' =====');
  console.log(JSON.stringify(r, null, 1));
  await pg.screenshot({ path: '/tmp/dash_' + store + (mobile ? '_m' : '') + '.png', fullPage: true });
  await ctx.close();
}

await check('ground', 'GROUND 桌機', false);
await check('ground', 'GROUND 手機', true);
await check('abeach', 'A BEACH 手機', true);
await b.close();
console.log('\nshots: /tmp/dash_ground.png /tmp/dash_ground_m.png /tmp/dash_abeach_m.png');
