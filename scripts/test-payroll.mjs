// 薪資試算 selftest（純函式；prebuild 自動跑）
import { PAY_DEFAULTS, rulesAt, splitDayHours, calcMonthPay, isHourly, monthSummary } from "../src/shift/payroll.js";

let pass = 0, fail = 0;
const chk = (l, ok, x = "") => { console.log((ok ? "  ✅" : "  ❌") + " " + l + (x ? " → " + x : "")); ok ? pass++ : fail++; };
const R = rulesAt(null, "2026-07-01");

// 1 工時拆分
let s = splitDayHours(8, R); chk("8h=全正常", s.reg === 8 && s.ot1 === 0 && s.ot2 === 0);
s = splitDayHours(9.5, R); chk("9.5h=8+1.5加班1", s.ot1 === 1.5 && s.ot2 === 0);
s = splitDayHours(12, R); chk("12h=8+2+2", s.ot1 === 2 && s.ot2 === 2);
// 2 PT 判定
chk("PT/工讀/時薪判定", isHourly("PT") && isHourly("工讀生") && isHourly("時薪") && !isHourly("正職") && !isHourly("值班DUTY"));
// 3 PT 時薪：20天×5h×200 = 20000、無加班
let p = calcMonthPay({ person: { baseSalary: "200" }, title: "PT", days: Array.from({ length: 20 }, (_, i) => ({ date: "d" + i, hours: 5 })), rules: R });
chk("PT 100h×200=20000", p.basePay === 20000 && p.otPay === 0 && p.gross === 20000, JSON.stringify({ b: p.basePay, g: p.gross }));
// 4 PT 低於基本工資時薪 → 以基本工資時薪計
p = calcMonthPay({ person: { baseSalary: "150" }, title: "PT", days: [{ date: "a", hours: 8 }], rules: R });
chk("PT時薪低於基本工資→用190", p.basePay === 8 * 190);
// 5 月薪制：底薪固定＋一天加班2小時（時薪=36000/240=150 → 2h×1.34×150=402）
p = calcMonthPay({ person: { baseSalary: "36000", laborIns: "36300", healthIns: "36300", mealAllow: "2400" }, title: "正職", days: [{ date: "a", hours: 10 }, { date: "b", hours: 8 }], rules: R });
chk("月薪底薪36000固定", p.basePay === 36000);
chk("加班費2h×1.34×150=402", p.otPay === 402, `ot=${p.otPay}`);
chk("津貼2400入應發", p.allowance === 2400 && p.gross === 36000 + 402 + 2400);
// 6 勞健保自付：勞保36300×11.5%×20%=835、健保36300×5.17%×30%=563
chk("勞保自付835", p.laborSelf === 835, `${p.laborSelf}`);
chk("健保自付563", p.healthSelf === 563, `${p.healthSelf}`);
chk("實領=應發-自付", p.net === p.gross - 835 - 563);
// 7 雇主成本 > 應發（含雇主勞健保+勞退6%）
chk("雇主成本>應發", p.employerCost > p.gross, `${p.employerCost}`);
// 8 12h 一天：8+2×1.34+2×1.67
p = calcMonthPay({ person: { baseSalary: "240" }, title: "PT", days: [{ date: "a", hours: 12 }], rules: R });
chk("PT 12h=8×240+2×1.34×240+2×1.67×240", p.gross === Math.round(8 * 240) + Math.round((2 * 1.34 + 2 * 1.67) * 240), `${p.gross}`);
// 9 預排調整：2027-01-01 生效基本工資調漲
const doc = { ...PAY_DEFAULTS, scheduled: [{ effective: "2027-01-01", patch: { minWageHourly: 200 } }] };
chk("生效日前用舊值", rulesAt(doc, "2026-12-31").minWageHourly === 190);
chk("生效日後自動切新值", rulesAt(doc, "2027-01-01").minWageHourly === 200);
// 10 monthSummary
const rows = [{ pay: p }, { pay: p }];
const m = monthSummary(rows);
chk("summary加總", m.people === 2 && m.gross === p.gross * 2);

console.log(`結果：${pass} 通過 / ${fail} 失敗`);
if (fail) process.exit(1);
