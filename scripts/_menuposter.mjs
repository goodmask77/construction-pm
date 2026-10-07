// 驗證直式匯出（v4.64 v15）：用官方 reference JSON 組 draft 渲染 1080×1920，與官方 PNG 做 50% 疊圖比對
import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
import fs from 'fs';

const OFFICIAL = '/tmp/v15/a/GROUND_portrait-text.png';
const REF = JSON.parse(fs.readFileSync('/tmp/v15/a/menu-data-v15.reference.json','utf8'));

// 用 reference 組成 App draft 形狀（分類名=EN zh、side/drink 設 combo 基準、iceHot→名字加 I/H、decaf→note #無咖啡因、soupSwap 不顯示）
const cats = {}; REF.categories.forEach(c=>cats[c.id]={name:c.en+' '+c.zh, items:[]});
REF.items.filter(it=>it.screenVisible!==false && it.categoryId).forEach(it=>{
  const t=it.tags||[]; let name=it.zh; if(t.includes('iceHot')) name+='  I / H';
  const note = t.includes('decaf')?'#無咖啡因':'';
  cats[it.categoryId].items.push({ id:'r'+it.categoryId+'_'+cats[it.categoryId].items.length, name, en:it.en, price:it.price, note });
});
const sections = Object.values(cats).map(s=>{
  const side = s.items.length && /SNACKS|DRINKS/.test(s.name);
  const combo = side ? Math.min(...s.items.map(i=>i.price)) : 0;
  return { name:s.name, combo, items:s.items };
});
const d = { ok:true, draft:{ note:'套餐 +'+REF.setBasePrice+' 元', sections } };

const src = fs.readFileSync('public/ops/js/p08-menu-misc.js','utf8');
const posterCode = src.slice(src.indexOf('const MENU_SK'), src.indexOf('function mnImgView('));
const officialB64 = fs.existsSync(OFFICIAL) ? 'data:image/png;base64,'+fs.readFileSync(OFFICIAL).toString('base64') : '';

const browser = await chromium.launch({ channel:'chrome', headless:true });
const page = await browser.newContext({ viewport:{width:1200,height:900} }).then(c=>c.newPage());
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Poppins:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
</head><body></body></html>`, { waitUntil:'networkidle' });

await page.addScriptTag({ content: `
  function todayTpe(){ return '2026-10-08' }
  window._OUT = [];
  function mnCombo(s2,i2){ const base=Number(s2.combo)||0; if(!base||i2.noCombo) return null;
    const diff=(Number(i2.price)||0)-base; return diff===0?{t:'套餐內含',inc:true}:(diff>0?{t:'套餐 +'+diff,inc:false}:{t:'套餐 '+diff,inc:false}); }
  ${posterCode}
  menuDownload = function(cv,name){ window._OUT.push({ name, dataUrl: cv.toDataURL('image/png'), w:cv.width, h:cv.height }); };
`});

const res = await page.evaluate(async (d)=>{
  const secs=(d.draft.sections||[]).map(s2=>({name:s2.name,note:s2.note,combo:Number(s2.combo)||0,items:(s2.items||[]).filter(i2=>i2.name)})).filter(s=>s.items.length);
  menuSetSpec('phd'); await menuPosterCanva(d, secs);
  return { count:window._OUT.length };
}, d);

const mine=(await page.evaluate(()=>window._OUT.map(o=>o.dataUrl)))[0];
fs.writeFileSync('/tmp/menuposter.png', Buffer.from(mine.split(',')[1],'base64'));
if (officialB64){
  const ov=await page.evaluate(async({mine,off})=>{ const load=u=>new Promise(r=>{const im=new Image();im.onload=()=>r(im);im.src=u});
    const a=await load(mine),b=await load(off); const cv=document.createElement('canvas');cv.width=1080;cv.height=1920;const g=cv.getContext('2d');
    g.drawImage(a,0,0,1080,1920); g.globalAlpha=0.5; g.drawImage(b,0,0,1080,1920); return cv.toDataURL('image/png'); },{mine,off:officialB64});
  fs.writeFileSync('/tmp/menu_overlay.png', Buffer.from(ov.split(',')[1],'base64'));
}
console.log('產出', res.count, '張，errs='+errs.length, '（用官方 reference 資料）');
if (errs.length) console.log('ERRORS:', errs.join('\n'));
await browser.close();
