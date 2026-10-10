import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const pg = await (await b.newContext({ viewport:{width:1200,height:900} })).newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(String(e)));
await pg.goto('https://groun-d.vercel.app/ops/?cb='+Date.now(), { waitUntil:'networkidle', timeout:60000 });
await pg.waitForTimeout(1200);
// 開設定頁
await pg.evaluate(()=>{ try{ settingsLoad() }catch(e){ window.__e=String(e) } });
await pg.waitForTimeout(1500);
const hasBtn = await pg.evaluate(()=>!![...document.querySelectorAll('button')].find(b=>/DD 自動訊息/.test(b.textContent)));
// 開 DD 自動訊息面板
await pg.evaluate(()=>{ try{ ddMsgEdit() }catch(e){ window.__e2=String(e) } });
await pg.waitForSelector('#ddOv [data-k]', { timeout: 20000 }).catch(()=>{});
await pg.waitForTimeout(500);
const r = await pg.evaluate(()=>{
  const ov=document.getElementById('ddOv');
  const cards=ov?ov.querySelectorAll('[data-k]').length:0;
  const groupsInFirst=ov?(ov.querySelector('.ddGrp')||{}).length:0;
  const hasToggle=ov?!!ov.querySelector('.ddOn'):false;
  const hasTxt=ov?!!ov.querySelector('.ddTxt'):false;
  const subs=ov?ov.querySelectorAll('#ddSub button').length:0; // v4.70.38 三個子頁
  const hasPrep=ov?!!ov.querySelector('[data-k="prep0930"]'):false; // 舊面板的備料量已併入
  const optgroups=ov?(ov.querySelector('.ddGrp')||{querySelectorAll:()=>[]}).querySelectorAll('optgroup').length:0;
  return { open:!!ov, cards, groupsInFirst, hasToggle, hasTxt, subs, hasPrep, optgroups, e:window.__e||null, e2:window.__e2||null };
});
console.log('設定頁有鈕:', hasBtn);
console.log('DD面板:', JSON.stringify(r));
const noOldBtn = await pg.evaluate(()=>![...document.querySelectorAll('button')].find(b=>/群組通知開關/.test(b.textContent)));
console.log('舊「群組通知開關」鈕已移除:', noOldBtn);
const pass = hasBtn && noOldBtn && r.open && r.cards>=10 && r.hasPrep && r.subs===3 && r.hasToggle && r.hasTxt && r.groupsInFirst>3 && errs.length===0 && !r.e && !r.e2;
console.log('JS錯誤:', errs.length?errs:'無');
console.log(pass?'✅ 通過：設定頁有鈕、舊鈕已移除、面板開、≥10張卡含備料量、3子頁、開關/群下拉/文字框都在':'❌ 未通過');
await b.close(); process.exit(pass?0:1);
