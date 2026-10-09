// 驗證 HTML 菜單模板出圖（v1.0 2026-10-10）：playwright 開 menu-poster.html 截 1080×1920 存 /tmp/poster_html.png
import pkg from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pkg;
import fs from 'fs';
import path from 'path';

const HTML = path.resolve('public/ops/menu-poster.html');
const browser = await chromium.launch({ channel:'chrome', headless:true });
const page = await browser.newContext({ viewport:{width:1120,height:1960}, deviceScaleFactor:2 }).then(c=>c.newPage());
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto('file://'+HTML, { waitUntil:'networkidle' });
try{ await page.evaluate(()=>document.fonts.ready); }catch(e){}
await page.waitForTimeout(400);
const el = await page.$('#poster');
await el.screenshot({ path:'/tmp/poster_html.png' });
console.log('截圖完成 /tmp/poster_html.png，errs='+errs.length);
if(errs.length) console.log('ERR:', errs.join('\n'));
await browser.close();
