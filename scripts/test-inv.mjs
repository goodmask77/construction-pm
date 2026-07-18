// 進銷存算法 selftest：node scripts/test-inv.mjs
// 覆蓋：單位成本/比價取最近實付/食譜成本(含包材/缺料/循環)/進價事件冪等/警示門檻/報價快取
import { unitCost, quoteUnit, latestCostOfIngredient, recipeCost, buildPriceEvents, applyLastPaid, priceAlert, applyQuote } from "../src/supply/inv.js";
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.log("✗ " + name)); };

ok("unitCost 實付優先", unitCost({ price: 999, last: { price: 800 }, packToBase: 20000 }) === 800 / 20000);
ok("unitCost 無實付退主檔", unitCost({ price: 570, packToBase: 15000 }) === 570 / 15000);
ok("unitCost 缺換算=null 絕不當0", unitCost({ price: 800, last: { price: 800 } }) === null);
ok("quoteUnit 報價換算", quoteUnit({ quote: { price: 42 }, packToBase: 1000 }) === 0.042);

// 高麗菜三貨源比價場景
const db = { ingredients: [{ id: "g1", name: "高麗菜", baseUnit: "g" }],
  vendorItems: [
    { id: "v1", vendor_id: "A", ingredient_id: "g1", name: "高麗菜", packToBase: 20000, last: { price: 800, ts: "2026-07-17" } },
    { id: "v2", vendor_id: "B", ingredient_id: "g1", name: "高麗菜", packToBase: 15000, last: { price: 570, ts: "2026-07-18" } },
    { id: "v3", vendor_id: "C", ingredient_id: "g1", name: "高麗菜", packToBase: 1000, last: { price: 42, ts: "2026-07-15" } }],
  materials: [], productPackaging: [] };
const lc = latestCostOfIngredient(db, "g1");
ok("最近實付=最新ts的B家", lc.vi.id === "v2" && Math.abs(lc.unitCost - 0.038) < 1e-9);

const recipes = [{ id: "r1", product_id: "p1", ts: "2026-07-18", ingredients: [{ ingredient_id: "g1", qty: 200 }], yield: 1 }];
const c1 = recipeCost(db, recipes, "p1");
ok("食譜成本 7.6", Math.abs(c1.total - 7.6) < 1e-9 && c1.missing.length === 0);
const db2 = JSON.parse(JSON.stringify(db)); db2.vendorItems.forEach(v => delete v.packToBase);
const c2 = recipeCost(db2, recipes, "p1");
ok("缺換算列 missing 且 total=0", c2.total === 0 && c2.missing.length === 1);
const recC = [{ id: "ra", product_id: "pa", ts: "1", ingredients: [], subRecipes: [{ product_id: "pb", qty: 1 }] }, { id: "rb", product_id: "pb", ts: "1", ingredients: [], subRecipes: [{ product_id: "pa", qty: 1 }] }];
ok("循環引用回報不當機", recipeCost(db, recC, "pa").missing.some(m => m.includes("循環")));
const db3 = { ...db, materials: [{ id: "m1", name: "醬料杯" }], productPackaging: [{ product_id: "p1", packaging_id: "m1" }],
  vendorItems: [...db.vendorItems, { id: "v9", vendor_id: "K", matId: "m1", name: "A140醬料杯", packToBase: 2000, last: { price: 1100, ts: "2026-07-17" } }] };
ok("包材成本 7.6+0.55", Math.abs(recipeCost(db3, recipes, "p1").total - (7.6 + 1100 / 2000)) < 1e-9);

// 進價事件：決定性 id＋冪等
const order = { id: "oX", vendor_id: "A", items: [{ id: "v1", price: 850, qty: 2, unit: "箱" }, { id: "v2", price: "", qty: 1 }], check: { items: { 0: { st: "✓ 正確" } } } };
const evs = buildPriceEvents(order, db, "2026-07-18T10:00:00Z");
ok("決定性id oX_0 且無價品項跳過", evs.length === 1 && evs[0].id === "oX_0" && evs[0].ingredient_id === "g1");
let vis = applyLastPaid(db.vendorItems, evs, "T1");
const v1a = vis.find(v => v.id === "v1");
ok("變價 prevPrice=800 新價850", v1a.last.price === 850 && v1a.last.prevPrice === 800);
const vis2 = applyLastPaid(vis, buildPriceEvents(order, { ...db, vendorItems: vis }, "T2"), "T2");
const v1b = vis2.find(v => v.id === "v1");
ok("重按同價 prev 不動（冪等）", v1b.last.price === 850 && v1b.last.prevPrice === 800);
ok("850vs800=6% 不警示(門檻15)", priceAlert(v1a, 15) === null);
ok("1000vs800=25% 警示", priceAlert({ last: { price: 1000, prevPrice: 800 } }, 15).pct === 25);
ok("報價快取寫入", applyQuote(db.vendorItems, "v3", 40, "T3").find(x => x.id === "v3").quote.price === 40);

console.log(`結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
