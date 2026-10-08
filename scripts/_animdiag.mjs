// 動畫根因診斷：開真正式 /prep 任務頁，抓 getAnimations/computed style/reduce-motion
import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;

const URL = process.env.DIAG_URL || 'https://ground-pm.vercel.app/ops/';
const RM = process.env.RM || 'no-preference'; // no-preference | reduce

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: RM });
const pg = await ctx.newPage();
const logs = [];
pg.on('console', m => logs.push('[console] ' + m.text()));

console.log('open', URL, 'reducedMotion=', RM);
await pg.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

// 進任務分頁（點 tab-task 或直接呼叫 setTabs('task')）
await pg.waitForTimeout(1500);
await pg.evaluate(() => { try { curStore = 'task'; if (typeof setTabs === 'function') setTabs('task'); if (typeof taskEmbed === 'function') taskEmbed(); } catch (e) { console.log('trigger err ' + e.message); } });
// 等 tnfxCard 出現（最多 15 秒）
let found = 0;
for (let i = 0; i < 30; i++) {
  found = await pg.evaluate(() => document.querySelectorAll('.tnfxCard').length);
  if (found > 0) break;
  await pg.waitForTimeout(500);
}
console.log('tnfxCard count=', found);

const diag = await pg.evaluate(() => {
  const out = {};
  // 1) 偏好與 root class
  out.animPref = (typeof tnS!=="undefined" && tnS.anim) || null;
  const root = document.querySelector('.tnTaskRoot');
  out.rootClass = root ? root.className : '(no root)';
  out.mql_reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  out.hasPropertyAngle = (CSS && CSS.registerProperty) ? 'CSS.registerProperty available' : 'no';
  // 2) 掃描高階卡：找有 .tnfxrot / glow 的卡
  const cards = [...document.querySelectorAll('.tnfxCard')];
  out.totalCards = cards.length;
  const sample = [];
  for (const c of cards.slice(0, 40)) {
    const rot = c.querySelector('.tnfxrot');
    const glow = c.querySelector('.tnfxab');
    const anims = c.getAnimations ? c.getAnimations({ subtree: true }) : [];
    if (anims.length || rot || glow) {
      const title = (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18);
      const info = { title, nAnims: anims.length };
      info.anims = anims.slice(0, 6).map(a => ({
        name: (a.animationName || (a.effect && a.effect.getKeyframes && 'css') || '?'),
        play: a.playState,
        t0: Math.round(a.currentTime || 0)
      }));
      if (rot) {
        const cs = getComputedStyle(rot);
        info.rot = { animName: cs.animationName, dur: cs.animationDuration, play: cs.animationPlayState, iter: cs.animationIterationCount };
      }
      if (glow) {
        const cs = getComputedStyle(glow);
        info.glow = { animName: cs.animationName, dur: cs.animationDuration, play: cs.animationPlayState, box: cs.boxShadow.slice(0, 40) };
      }
      sample.push(info);
    }
  }
  out.sample = sample.slice(0, 8);
  return out;
});

// 等 1 秒再抓 currentTime 比較是否前進
await pg.waitForTimeout(1000);
const advance = await pg.evaluate(() => {
  const cards = [...document.querySelectorAll('.tnfxCard')];
  const res = [];
  for (const c of cards.slice(0, 40)) {
    const anims = c.getAnimations ? c.getAnimations({ subtree: true }) : [];
    if (anims.length) {
      res.push({
        title: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16),
        times: anims.slice(0, 4).map(a => ({ play: a.playState, t: Math.round(a.currentTime || 0) }))
      });
    }
    if (res.length >= 6) break;
  }
  return res;
});

console.log('\n===== DIAG =====');
console.log(JSON.stringify(diag, null, 2));
console.log('\n===== 1s 後 currentTime（看是否前進）=====');
console.log(JSON.stringify(advance, null, 2));
console.log('\n===== console logs (tail) =====');
console.log(logs.slice(-15).join('\n'));

await b.close();
