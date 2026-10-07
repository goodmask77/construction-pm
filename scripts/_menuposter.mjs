// 驗證直式菜單匯出（v12）：注入 p08 真實繪圖函式，攔截下載，用真實菜單資料產出直式 PNG 供肉眼檢視
import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
import fs from 'fs';

// 取真實菜單資料
const K = '7ea362bae1f0274372d4ec7b27c78852';
const d = await (await fetch('https://ground-pm.vercel.app/api/mail-sync?menu=' + K)).json();
if (!d.draft.note) d.draft.note = '套餐 +89 元';

// 擷取 p08 海報函式（const MENU_SK … 到 function mnImgView 之前）
const src = fs.readFileSync('public/ops/js/p08-menu-misc.js','utf8');
const a = src.indexOf('const MENU_SK');
const b = src.indexOf('function mnImgView(');
if (a<0||b<0) { console.log('擷取失敗 a='+a+' b='+b); process.exit(1); }
const posterCode = src.slice(a,b);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newContext({ viewport:{width:1200,height:900} }).then(c=>c.newPage());
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Poppins:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
</head><body></body></html>`, { waitUntil:'networkidle' });

await page.addScriptTag({ content: `
  function todayTpe(){ return '2026-10-08' }
  window._OUT = [];
  function mnCombo(s2, i2){ const base=Number(s2.combo)||0; if(!base||i2.noCombo) return null;
    const diff=(Number(i2.price)||0)-base; return diff===0?{t:'套餐內含',inc:true}:(diff>0?{t:'套餐 +'+diff,inc:false}:{t:'套餐 '+diff,inc:false}); }
  ${posterCode}
  menuDownload = function(cv,name){ window._OUT.push({ name, dataUrl: cv.toDataURL('image/png'), w:cv.width, h:cv.height }); };
`});

const res = await page.evaluate(async (d)=>{
  const secs = (d.draft.sections||[]).map(s2=>({ name:s2.name, note:s2.note, combo:Number(s2.combo)||0, items:(s2.items||[]).filter(i2=>i2.name) })).filter(s=>s.items.length);
  menuSetSpec('p4k'); await menuPosterCanva(d, secs);
  return { count: window._OUT.length, items: window._OUT.map(o=>({name:o.name,w:o.w,h:o.h})) };
}, d);

const all = await page.evaluate(()=>window._OUT.map(o=>o.dataUrl));
fs.writeFileSync('/tmp/menuposter.png', Buffer.from(all[0].split(',')[1],'base64'));
console.log('產出', res.count, '張，errs='+errs.length);
res.items.forEach((it,i)=>console.log('  ['+i+']', it.w+'x'+it.h, it.name));
if (errs.length) console.log('ERRORS:', errs.join('\n'));
await browser.close();
