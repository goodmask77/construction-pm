// GROUN:D 試營運回填種子驗證：金額對帳（跟試營運儀表板同算法）＋資料結構相容性
import { groundTrialRecords } from "../api/_ground-seed.js";

let pass = 0, fail = 0;
const chk = (l, ok, x = "") => { console.log((ok ? "✅" : "❌") + " " + l + (x ? " → " + x : "")); ok ? pass++ : fail++; };

const recs = groundTrialRecords();
chk("四天記錄", recs.length === 4, recs.map(r => r.date).join(","));
chk("id 不重複且帶店代碼", new Set(recs.map(r => r.id)).size === 4 && recs.every(r => /-ground$/.test(r.id)));
chk("店名可被 storeKeyOf 認出", recs.every(r => /groun/i.test(r.store)));

// 儀表板原始數字（08-10/11 全由品項算出；08-12/13 revenue=總表實收、grossSales=牌價）
const EXP = { "2026-08-10": 18937, "2026-08-11": 33509, "2026-08-12": 34210, "2026-08-13": 32304 };
for (const r of recs) {
  const secs = r._details["總銷售額 (以類別分類)"];
  const sum = secs.flatMap(s => s.rows).reduce((t, row) => t + (Number(row[row.length - 1]) || 0), 0);
  chk(`${r.date} entry.revenue=儀表板實收`, r.revenue === EXP[r.date], String(r.revenue));
  if (!r.discount) chk(`${r.date} 品項金額加總=營收（無折讓日）`, sum === r.revenue, `${sum} vs ${r.revenue}`);
  else console.log(`ℹ️  ${r.date} 品項金額加總 ${sum}（牌價 ${r.grossSales}、實收 ${r.revenue}、折讓 ${r.discount}；差=1/4披薩無單價+折讓，屬已知口徑）`);
  // 結構相容：前端/AI 都讀 r[0]=名稱、r[1]=數量、r[最後]=金額
  chk(`${r.date} 段落結構`, secs.every(s => s.title && s.header.includes("名稱") && s.rows.every(row => typeof row[0] === "string" && typeof row[1] === "number" && typeof row[row.length - 1] === "number")));
  chk(`${r.date} 明細帶齊必要欄位`, !!(r.id && r.date && r.period && r.store && r.partial && r._details));
}
// v2：套餐內欄（前端用 header 名稱找欄位）
chk("v2 header 帶「套餐內」欄", recs.every(r => r._details["總銷售額 (以類別分類)"].every(s => s.header.indexOf("套餐內") === 3)));
chk("v2 seedVer=2", recs.every(r => r.seedVer === 2));
// 抽查（子代理報告要抽查的精神）：跟儀表板畫面數字對五筆
const AMT = (row) => row[row.length - 1], COMBO = (row) => row[3];
const d13 = recs[3], pizza13 = d13._details["總銷售額 (以類別分類)"].find(s => s.title === "披薩");
const bbq = pizza13.rows.find(r => r[0] === "煙燻BBQ雞肉");
chk("08-13 煙燻BBQ雞肉 13 份（畫面熱銷 3→13）", bbq?.[1] === 13);
chk("08-13 煙燻BBQ雞肉 套餐內 7（畫面套餐內=7）", COMBO(bbq) === 7);
const d12 = recs[2], set12 = d12._details["總銷售額 (以類別分類)"].find(s => s.title === "套餐");
chk("08-12 套餐 106 組 / NT$9,434", set12.rows[0][1] === 106 && AMT(set12.rows[0]) === 9434);
const drink10 = recs[0]._details["總銷售額 (以類別分類)"].find(s => s.title === "飲料");
chk("08-10 經典拿鐵 單點5杯=NT$500", AMT(drink10.rows.find(r => r[0] === "經典拿鐵")) === 500);
const burger13 = d13._details["總銷售額 (以類別分類)"].find(s => s.title === "漢堡");
chk("08-13 8oz雙層堡 套餐內 17（畫面=17）", COMBO(burger13.rows.find(r => r[0] === "8oz 雙層純牛肉起司堡")) === 17);

console.log(`\n${fail ? "❌" : "✅"} ${pass} 過 / ${fail} 敗`);
process.exit(fail ? 1 : 0);
