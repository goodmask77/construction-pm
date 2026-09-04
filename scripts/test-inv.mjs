// 進銷存算法 selftest：node scripts/test-inv.mjs
// 覆蓋：單位成本/比價取最近實付/食譜成本(含包材/缺料/循環)/進價事件冪等/警示門檻/報價快取
import { unitCost, quoteUnit, latestCostOfIngredient, recipeCost, buildPriceEvents, applyLastPaid, priceAlert, applyQuote, parseSpec, repairPackToBase, isPieceUnit, organizeAll, isServiceName, normName } from "../src/supply/inv.js";
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

// 半成品＋耗損率（2026-09-04 張良兩店成本計算：半成品=醬料一鍋、成品按 g 引用；耗損率=實得產量打折）
// 半成品 sB：200g 高麗菜、出成 1000g → 每 g 成本 7.6/1000；成品 pF 用 100g → 0.76
const recSemi = [
  { id: "rs", product_id: "sB", ts: "1", ingredients: [{ ingredient_id: "g1", qty: 200 }], yield: 1000, yieldUnit: "g" },
  { id: "rf", product_id: "pF", ts: "1", ingredients: [], subRecipes: [{ product_id: "sB", qty: 100 }], yield: 1 },
];
ok("半成品按出成單位遞迴：0.76", Math.abs(recipeCost(db, recSemi, "pF").total - 0.76) < 1e-9);
// 耗損率 20%：實得 800g → 每 g 成本 7.6/800，成品用 100g → 0.95
const recLoss = JSON.parse(JSON.stringify(recSemi)); recLoss[0].lossPct = 20;
ok("耗損率20%→每單位成本變貴 0.95", Math.abs(recipeCost(db, recLoss, "pF").total - 0.95) < 1e-9);
// 耗損率防呆：100% 不會除以零（上限 90）
const recL100 = JSON.parse(JSON.stringify(recSemi)); recL100[0].lossPct = 100;
ok("耗損率100%防呆不爆", Number.isFinite(recipeCost(db, recL100, "pF").total));
// 半成品自己缺料 → 成品 missing 帶（半成品）前綴照實回報
const recMiss = [{ id: "rm", product_id: "sX", ts: "1", ingredients: [{ ingredient_id: "gNone", qty: 5 }], yield: 100 }, { id: "rf2", product_id: "pG", ts: "1", ingredients: [], subRecipes: [{ product_id: "sX", qty: 10 }], yield: 1 }];
ok("半成品缺料往上帶不靜默", recipeCost(db, recMiss, "pG").missing.some(m => m.includes("半成品")));

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

// 規格自動解析（物料頁 v2 自動整理用）
ok("2000入/件→2000個", (() => { const p = parseSpec("(2000入/件)"); return p.packToBase === 2000 && p.baseUnit === "個"; })());
ok("雙括號 ((2500入/件))", parseSpec("((2500入/件))").packToBase === 2500);
ok("20公斤/箱→20000g", (() => { const p = parseSpec("20公斤/箱"); return p.packToBase === 20000 && p.baseUnit === "g"; })());
ok("600g/包→600g", (() => { const p = parseSpec("600g/包"); return p.packToBase === 600 && p.baseUnit === "g"; })());
ok("5台斤→3000g", parseSpec("5台斤").packToBase === 3000);
ok("2L→2000ml", (() => { const p = parseSpec("2L"); return p.packToBase === 2000 && p.baseUnit === "ml"; })());
ok("看不出入數→null不猜", (() => { const p = parseSpec("10*10衛生紙"); return p.packToBase === null; })());
ok("空規格→null", parseSpec("").packToBase === null);
// 多層包裝鏈乘（2026-07-21 張良回報：一箱=100 算錯）
ok("多層 100張/包 60包/箱→6000個", (() => { const p = parseSpec("環保餐巾紙 23x23cm 原色（100張/包 60包/箱）"); return p.packToBase === 6000 && p.baseUnit === "個"; })());
ok("多層順序顛倒 10捲/箱 300張/捲→3000", parseSpec("10捲/箱 300張/捲").packToBase === 3000);
ok("多層帶重量 600g/包 20包/箱→12000g", (() => { const p = parseSpec("600g/包 20包/箱"); return p.packToBase === 12000 && p.baseUnit === "g"; })());
ok("單層 600包/箱 不誤鏈乘=600", parseSpec("600包/箱").packToBase === 600);
ok("單層 20公斤/箱 不受影響", parseSpec("20公斤/箱").packToBase === 20000);
ok("修復：舊誤值100→6000、人工值/正確值不碰", (() => {
  const r = repairPackToBase([
    { id: "a", spec: "100張/包 60包/箱", packToBase: 100 },   // 機器舊誤值 → 修成 6000
    { id: "b", spec: "100張/包 60包/箱", packToBase: 5000 },  // 人工改過 → 不碰
    { id: "c", spec: "2000入/件", packToBase: 2000 },          // 單層正確 → 不動
    { id: "d", spec: "", packToBase: "" },                      // 沒規格 → 不動
  ]);
  return r.fixed === 1 && r.vendorItems[0].packToBase === 6000 && r.vendorItems[1].packToBase === 5000 && r.vendorItems[2].packToBase === 2000;
})());
// 單顆計價（2026-07-21 張良：報價單 5,000個×$4.9/個 匯入卡「1件=?」）
ok("isPieceUnit 個/張/支=true 箱/包=false", isPieceUnit("個") && isPieceUnit("張") && isPieceUnit("支") && !isPieceUnit("箱") && !isPieceUnit("包"));
ok("修復：單位=個沒規格→入數補1、單位=箱不亂補", (() => {
  const r = repairPackToBase([
    { id: "a", spec: "", unit: "個", packToBase: "", ingredient_id: "g9" },  // 單顆計價 → 補 1
    { id: "b", spec: "", unit: "箱", packToBase: "", ingredient_id: "g9" },  // 箱不知入數 → 不猜
    { id: "c", spec: "", unit: "個", packToBase: "", ingredient_id: "gW" },  // 計量單位是 g → 不補
  ], [{ id: "g9", baseUnit: "個" }, { id: "gW", baseUnit: "g" }]);
  return r.fixed === 1 && r.vendorItems[0].packToBase === 1 && r.vendorItems[1].packToBase === "" && r.vendorItems[2].packToBase === "";
})());
ok("organizeAll：單位=個新建卡自動入數=1", (() => {
  const plan = organizeAll({ vendors: [], ingredients: [], vendorItems: [{ id: "x1", vendor_id: "A", name: "少量紙提袋(4色)", spec: "", unit: "個", price: 4.9 }] });
  return plan.vendorItems[0].packToBase === 1 && plan.stats.needFix === 0;
})());
// MOQ 誤當入數（2026-07-21 張良：數量5000個=MOQ、@5.80/pc=單顆價）
ok("pcs 規格看得懂：2000pcs/箱→2000個", (() => { const p = parseSpec("2000pcs/箱"); return p.packToBase === 2000 && p.baseUnit === "個"; })());
ok("isPieceUnit 認得 pc/pcs", isPieceUnit("pc") && isPieceUnit("pcs") && isPieceUnit("PCS"));
ok("修復：規格=數量50000張(MOQ)誤成入數→入數1+搬moq+清規格", (() => {
  const r = repairPackToBase([{ id: "a", spec: "50000張", unit: "張", packToBase: 50000, ingredient_id: "g9" }], [{ id: "g9", baseUnit: "個" }]);
  const a = r.vendorItems[0];
  return r.fixed === 1 && a.packToBase === 1 && a.moq === 50000 && a.spec === "";
})());
ok("修復：入數空但規格可解析→自動補(2000pcs/箱)", (() => {
  const r = repairPackToBase([{ id: "b", spec: "2000pcs/箱", unit: "箱", packToBase: "", ingredient_id: "g9" }], [{ id: "g9", baseUnit: "個" }]);
  return r.fixed === 1 && r.vendorItems[0].packToBase === 2000;
})());
ok("organizeAll：單位=個+規格只有數量→入數1、數量搬moq", (() => {
  const plan = organizeAll({ vendors: [], ingredients: [], vendorItems: [{ id: "x2", vendor_id: "A", name: "小紙袋無手提", spec: "30000個", unit: "個", price: 1.72 }] });
  const v = plan.vendorItems[0];
  return v.packToBase === 1 && v.moq === 30000 && v.spec === "";
})());
ok("服務類判斷：咖啡機年度保養", isServiceName("咖啡機年度保養") === true);
ok("服務類判斷：醬料杯不是服務", isServiceName("A140醬料杯") === false);
ok("正規化：同名不同符號視為同物", normName("PET-2oz醬料杯") === normName("PET–2oz 醬料杯"));

console.log(`結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
