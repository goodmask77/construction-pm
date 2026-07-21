// 本機串接驗證：注入種子 → 逐頁截圖＋抽取畫面數字跟預期對帳
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const { seed } = JSON.parse(readFileSync("/tmp/crew-seed.json", "utf8"));
const URL = "http://localhost:5199";
const shot = (p, n) => p.screenshot({ path: `/tmp/vfy-${n}.png`, fullPage: false });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-TW", timezoneId: "Asia/Taipei" });
await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, seed);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const grab = async (n) => { await page.waitForTimeout(700); await shot(page, n); const t = (await page.innerText("body")).replace(/\n{2,}/g, "\n"); return t; };

// 1) 預設落點應為「今日」
const today = await grab("01-today");
console.log("=== 今日頁 ===");
console.log(today.slice(0, 2200));

// 2) 第一層四入口 → 人員與排班 → 名冊
const clickTab = async (label) => { await page.locator(`button:has-text("${label}")`).first().click(); await page.waitForTimeout(900); };
await clickTab("人員與排班");
console.log("\n=== 人員與排班(名冊) 標頭 ===");
console.log((await grab("02-people")).slice(0, 700));

// 3) SOP與訓練 → SOP知識庫（驗雙維度＋舊資料遷移）
await clickTab("SOP與訓練");
let kb = await grab("03-kb");
console.log("\n=== SOP知識庫 ===\n" + kb.slice(0, 1500));
// 篩選：對象=內場
await page.locator('button:has-text("內場")').first().click();
console.log("\n=== 篩選 對象=內場 ===\n" + (await grab("04-kb-inner")).split("SOP知識庫")[1]?.slice(0, 600));
await page.locator('button:has-text("全部")').first().click();
// 篩選：類型=教學
await page.locator('button:has-text("教學")').last().click();
console.log("\n=== 篩選 類型=教學 ===\n" + (await grab("05-kb-teach")).split("SOP知識庫")[1]?.slice(0, 600));
await page.locator('button:has-text("全部")').nth(1).click();

// 4) 闖關子分頁
await page.locator('button:has-text("闖關")').first().click();
console.log("\n=== 闖關 ===\n" + (await grab("06-quest")).slice(0, 1200));

// 5) 成長與文化 → 360 / 回饋 / 投票 / 獎勵中心
await clickTab("成長與文化");
console.log("\n=== 360評鑑 ===\n" + (await grab("07-360")).slice(0, 900));
await page.locator('button:has-text("回饋")').first().click();
await page.waitForTimeout(600);
await page.locator('button:has-text("回饋牆")').first().click();
console.log("\n=== 回饋牆 ===\n" + (await grab("08-fbwall")).slice(0, 1600));
await page.locator('button:has-text("投票")').first().click();
console.log("\n=== 投票 ===\n" + (await grab("09-poll")).slice(0, 1400));
// 🔍 probe: 張良對「夏季聚餐地點」投一票 → 應變已投＋顯示票數
await page.locator('div:has-text("夏季聚餐地點")').locator("text=熱炒").last().click();
console.log("\n=== 投票後(熱炒+1) ===\n" + (await grab("10-poll-voted")).split("夏季聚餐地點")[1]?.slice(0, 400));
// 獎勵中心（商城/排行榜合併）
await page.locator('button:has-text("獎勵中心")').first().click();
console.log("\n=== 獎勵中心-商城 ===\n" + (await grab("11-shop")).slice(0, 1200));
await page.locator('button:has-text("排行榜")').first().click();
console.log("\n=== 獎勵中心-排行榜 ===\n" + (await grab("12-rank")).slice(0, 2000));

// 6) 回「今日」驗數字卡
await clickTab("今日");
console.log("\n=== 今日(回訪) ===\n" + (await grab("13-today2")).slice(0, 1600));

// 7) 🔍 手機版：底部導覽應只有4主入口＋內容區子分頁列
const mp = await ctx.newPage();
await mp.setViewportSize({ width: 390, height: 844 });
await mp.goto(URL, { waitUntil: "networkidle" });
await mp.waitForTimeout(2500);
await shot(mp, "14-mobile-today");
await mp.locator('button:has-text("成長與文化")').last().click();
await mp.waitForTimeout(900);
await shot(mp, "15-mobile-grow");
console.log("\n=== 手機版-成長與文化 ===\n" + (await mp.innerText("body")).replace(/\n{2,}/g, "\n").slice(0, 900));

console.log("\n=== JS錯誤 ===\n" + (errors.length ? errors.join("\n") : "無"));
await browser.close();
