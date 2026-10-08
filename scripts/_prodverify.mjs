import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const RM = process.env.RM || 'reduce'; // 預設測 reduce：證明新預設 followReduce:false 後,開減少動態仍會動
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1000 }, reducedMotion: RM,
  recordVideo: { dir: '/tmp/prodvid', size: { width: 1440, height: 1000 } }
});
const pg = await ctx.newPage();
await pg.goto('https://ground-pm.vercel.app/ops/?cb=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
await pg.waitForTimeout(1500);
await pg.evaluate(() => { try { curStore = 'task'; setTabs('task'); taskEmbed(); } catch (e) {} });
let found = 0;
for (let i = 0; i < 40; i++) { found = await pg.evaluate(() => document.querySelectorAll('.tnfxCard').length); if (found > 0) break; await pg.waitForTimeout(500); }

const base = await pg.evaluate(() => {
  const root = document.querySelector('.tnTaskRoot');
  const out = { rootClass: root ? root.className : '(none)', mql_reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, cards: document.querySelectorAll('.tnfxCard').length, animPref: (typeof tnS !== 'undefined' && tnS.anim) || null };
  // 找高階卡
  const hi = [...document.querySelectorAll('.tnfxCard')].find(c => /♛|★ (史詩|大師|稀有|精英)/.test(c.textContent));
  if (hi) { const a = hi.getAnimations({ subtree: true }); out.sampleTitle = hi.textContent.replace(/\s+/g, ' ').trim().slice(0, 14); out.n = a.length; out.names = [...new Set(a.map(x => x.animationName))].slice(0, 8); out.t0 = Math.round((a[0] || {}).currentTime || 0); }
  return out;
});
await pg.waitForTimeout(1200);
const adv = await pg.evaluate(() => {
  const hi = [...document.querySelectorAll('.tnfxCard')].find(c => /♛|★ (史詩|大師|稀有|精英)/.test(c.textContent));
  if (!hi) return null; const a = hi.getAnimations({ subtree: true });
  return { play: (a[0] || {}).playState, t1: Math.round((a[0] || {}).currentTime || 0) };
});

// 互動：點第一張卡→詳情彈窗出現？
let detailOpened = false, dragOk = false;
try {
  await pg.evaluate(() => { const c = document.querySelector('.tnfxCard'); if (c) c.click(); });
  await pg.waitForTimeout(800);
  detailOpened = await pg.evaluate(() => !!document.querySelector('[id*="Ov"],[id*="Detail"],.tnOverlay') || document.body.innerText.includes('步驟') && !!document.querySelector('textarea,input'));
  // 關閉
  await pg.keyboard.press('Escape').catch(() => {});
  dragOk = await pg.evaluate(() => { const c = document.querySelector('.tnfxCard'); return !!(c && c.getAttribute('draggable') === 'true'); });
} catch (e) {}

// 錄 8 秒動態
await pg.waitForTimeout(8000);
await pg.screenshot({ path: '/tmp/prod-cards.png', fullPage: false });
console.log('RM=', RM);
console.log('BASE', JSON.stringify(base, null, 1));
console.log('ADVANCE(+1.2s)', JSON.stringify(adv));
console.log('INTERACT detailOpened=', detailOpened, 'draggable=', dragOk);
await ctx.close(); // flush video
const vids = (await import('node:fs')).readdirSync('/tmp/prodvid').filter(f => f.endsWith('.webm'));
console.log('VIDEO', vids.map(v => '/tmp/prodvid/' + v).join(' '));
await b.close();
