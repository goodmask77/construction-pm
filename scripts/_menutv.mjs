// 驗證動態橫式四螢幕（v4.67）：載 Ultra 字型，用官方 reference 資料渲 4 張 1920×1080，存 /tmp/tv-1..4.png
import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
import fs from 'fs';

const REF = JSON.parse(fs.readFileSync('/tmp/v15/a/menu-data-v15.reference.json','utf8'));
const ULTRA = 'data:font/ttf;base64,' + fs.readFileSync('public/ops/fonts/Ultra.ttf').toString('base64');

const cats={}; REF.categories.forEach(c=>cats[c.id]={name:c.en+' '+c.zh, items:[]});
REF.items.filter(it=>it.screenVisible!==false && it.categoryId).forEach(it=>{
  const t=it.tags||[]; let name=it.zh; if(t.includes('iceHot')) name+='  I / H';
  cats[it.categoryId].items.push({ id:'r'+it.categoryId+'_'+cats[it.categoryId].items.length, name, en:it.en, price:it.price, note:t.includes('decaf')?'#無咖啡因':'' });
});
const sections=Object.values(cats).map(s=>{ const side=/SNACKS|DRINKS/.test(s.name); return { name:s.name, combo: side?Math.min(...s.items.map(i=>i.price)):0, items:s.items }; });
const d={ ok:true, draft:{ note:'套餐 +'+REF.setBasePrice+' 元', sections } };

const src=fs.readFileSync('public/ops/js/p08-menu-misc.js','utf8');
const posterCode=src.slice(src.indexOf('const MENU_SK'), src.indexOf('function mnImgView('));
const tvCode=src.slice(src.indexOf('async function menuPosterTVDynamic'), src.indexOf('// ───── 菜單海報共用'));

const browser=await chromium.launch({ channel:'chrome', headless:true });
const page=await browser.newContext({ viewport:{width:1200,height:900} }).then(c=>c.newPage());
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.setContent(`<!doctype html><html><head>
<style>@font-face{font-family:'Ultra';src:url('${ULTRA}') format('truetype')}</style>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Poppins:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
</head><body></body></html>`, { waitUntil:'networkidle' });
await page.evaluate(async(u)=>{ const f=new FontFace('Ultra',`url(${u})`); await f.load(); document.fonts.add(f); },ULTRA);

await page.addScriptTag({ content: `
  function todayTpe(){ return '2026-10-08' }
  window._OUT=[];
  function mnCombo(s2,i2){ const base=Number(s2.combo)||0; if(!base||i2.noCombo) return null; const diff=(Number(i2.price)||0)-base; return diff===0?{t:'套餐內含',inc:true}:(diff>0?{t:'套餐 +'+diff,inc:false}:{t:'套餐 '+diff,inc:false}); }
  ${posterCode}
  ${tvCode}
  menuDownload=function(cv,name){ window._OUT.push({name,dataUrl:cv.toDataURL('image/png'),w:cv.width,h:cv.height}); };
`});

const res=await page.evaluate(async(d)=>{
  const secs=(d.draft.sections||[]).map(s2=>({name:s2.name,note:s2.note,combo:Number(s2.combo)||0,items:(s2.items||[]).filter(i2=>i2.name)})).filter(s=>s.items.length);
  await menuPosterTVDynamic(d, secs);
  return { count:window._OUT.length, items:window._OUT.map(o=>({w:o.w,h:o.h,name:o.name})) };
}, d);

const all=await page.evaluate(()=>window._OUT.map(o=>o.dataUrl));
all.forEach((u,i)=>fs.writeFileSync('/tmp/tv-'+(i+1)+'.png', Buffer.from(u.split(',')[1],'base64')));
console.log('產出', res.count, '張，errs='+errs.length);
res.items.forEach((it,i)=>console.log('  ['+(i+1)+']', it.w+'x'+it.h, it.name));
if (errs.length) console.log('ERRORS:', errs.join('\n'));
await browser.close();
