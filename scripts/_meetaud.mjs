import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const pg = await (await b.newContext({ viewport:{width:430,height:900} })).newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(String(e)));
await pg.goto('https://groun-d.vercel.app/ops/?cb='+Date.now(), { waitUntil:'networkidle', timeout:60000 });
await pg.waitForTimeout(1000);
await pg.evaluate(()=>{ try{ meetLoad() }catch(e){ window.__e=String(e) } });
await pg.waitForTimeout(1500);
await pg.evaluate(()=>{ try{ meetForm() }catch(e){ window.__e2=String(e) } });
await pg.waitForTimeout(500);
const a = await pg.evaluate(()=>{
  const ov=document.getElementById('meetOv');
  return { formOpen:!!ov, hasAll:!!document.getElementById('mtAudAll'), hasPick:!!document.getElementById('mtAudPick'), e:window.__e||null, e2:window.__e2||null };
});
console.log('表單:', JSON.stringify(a));
// 切指定對象→出現勾選清單
await pg.evaluate(()=>{ try{ mtAudMode('picked') }catch(e){ window.__e3=String(e) } });
await pg.waitForTimeout(400);
const p = await pg.evaluate(()=>{
  const box=document.getElementById('mtAudBox');
  const checks=box?box.querySelectorAll('input[type=checkbox]').length:0;
  const hasMng=box?/管理群組/.test(box.textContent):false;
  return { checks, hasMng, e3:window.__e3||null };
});
console.log('指定對象:', JSON.stringify(p));
// 開群組管理
await pg.evaluate(()=>{ try{ meetGroupMng() }catch(e){ window.__e4=String(e) } });
await pg.waitForTimeout(400);
const g = await pg.evaluate(()=>({ mgOpen:!!document.getElementById('mgOv'), e4:window.__e4||null }));
console.log('群組管理:', JSON.stringify(g));
const pass = a.formOpen&&a.hasAll&&a.hasPick&&p.checks>5&&p.hasMng&&g.mgOpen&&errs.length===0&&!a.e2&&!p.e3&&!g.e4;
console.log('JS錯誤:', errs.length?errs:'無');
console.log(pass?'✅ 通過：表單有收件對象(全體/指定)、指定出現勾選清單+管理群組、群組管理開得了':'❌ 未通過');
await b.close(); process.exit(pass?0:1);
