// 排班系統自我驗證：node src/shift/selftest.mjs
// (a) 合規班表 → 檢查器必須 0 違規
// (b) 刻意無解 → 求解器必須誠實報缺口
// (c) 刻意違規 → 每條 labor_rules 各至少被抓到一次、法條與數值正確
// (K) 上週實際班表 vs 求解器產出 → 差異清單（§46-47 驗收）
import {
  SEED_STORES, SEED_STAFF, SEED_SKILLS, SEED_STATIONS, SEED_SHIFTS, SEED_DEMANDS, SEED_LEAVES,
  DEFAULT_RULES, DEFAULT_RULE_SETTINGS, DEFAULT_WEIGHTS,
  buildScheduleA, buildScheduleBLeaves, buildScheduleC, SEED_LEAVES_C, buildBaselineActual,
  BASELINE_WEEK, byId, seatsForWeek,
} from "./model.js";
import { checkSchedule } from "./checker.js";
import { solveWeek, diffSchedules } from "./solver.js";

let fails = 0;
const ok = (cond, label, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) fails++;
};
const base = {
  storeId: "abeach", staff: SEED_STAFF, skills: SEED_SKILLS, shifts: SEED_SHIFTS,
  stations: SEED_STATIONS, demands: SEED_DEMANDS, rules: DEFAULT_RULES,
};
const settingsGeneral = { byStore: { abeach: { working_time_system: "general", agreement_date: "" } } };
const settingsFourWeek = { byStore: { abeach: { working_time_system: "four_week", agreement_date: "2026-01-15" } } };
const settingsFallback = { byStore: { abeach: { working_time_system: "four_week", agreement_date: "" } } };

console.log("═══ (a) 合規班表：檢查器應回報 0 違規 ═══");
const schedA = buildScheduleA();
for (const [label, settings] of [["一般工時", settingsGeneral], ["四週變形", settingsFourWeek]]) {
  const { violations } = checkSchedule({ ...base, weekStart: BASELINE_WEEK, assignments: schedA, leaves: SEED_LEAVES, settings });
  ok(violations.length === 0, `(a) ${label}：0 違規`, violations.length ? violations.map(v => v.message).join("；") : "");
}
// 座位覆蓋：檢查 (a) 有把需求全填滿
const seats = seatsForWeek(SEED_DEMANDS, BASELINE_WEEK, "abeach", [], null);
const covered = seats.filter(s => schedA.some(a => a.date === s.date && a.shiftId === s.shiftId && a.stationId === s.stationId
  && schedA.filter(x => x.date === s.date && x.shiftId === s.shiftId && x.stationId === s.stationId).length
  >= seats.filter(y => y.date === s.date && y.shiftId === s.shiftId && y.stationId === s.stationId).length));
ok(covered.length === seats.length, `(a) 人力達標：${covered.length}/${seats.length} 席`);

console.log("\n═══ 同意書回退：選四週變形但沒填日期 → 套一般工時＋提示 ═══");
const fbRun = checkSchedule({ ...base, weekStart: BASELINE_WEEK, assignments: schedA, leaves: SEED_LEAVES, settings: settingsFallback });
ok(fbRun.notices.length > 0, "回退提示有出現", fbRun.notices[0] || "");

console.log("\n═══ (c) 刻意違規：每條規則各至少觸發一次 ═══");
const schedC = buildScheduleC("2026-06-01");
const runCG = checkSchedule({ ...base, weekStart: "2026-06-01", assignments: schedC.filter(a => a.date <= "2026-06-07"), otherAssignments: schedC.filter(a => a.date > "2026-06-07"), leaves: SEED_LEAVES_C("2026-06-01"), settings: settingsGeneral });
const runCF = checkSchedule({ ...base, weekStart: "2026-06-01", assignments: schedC.filter(a => a.date <= "2026-06-07"), otherAssignments: schedC.filter(a => a.date > "2026-06-07"), leaves: SEED_LEAVES_C("2026-06-01"), settings: settingsFourWeek });
const allC = [...runCG.violations, ...runCF.violations];
for (const code of ["LR-030", "LR-030-1", "LR-032", "LR-036", "LR-036-1", "LR-034", "LR-048", "CR-01", "CR-02", "CR-03"]) {
  const hit = allC.filter(v => v.code === code);
  ok(hit.length > 0, `${code} 被捕捉 ${hit.length} 次`, hit[0]?.message || "");
}

console.log("\n═══ (b) 刻意無解：週三炸台合格人力全請假 → 誠實報缺口 ═══");
const weekB = "2026-07-13";
const leavesB = [...SEED_LEAVES, ...buildScheduleBLeaves(weekB)];
const resB = solveWeek({ ...base, weekStart: weekB, leaves: leavesB, settings: settingsGeneral, weights: DEFAULT_WEIGHTS });
ok(resB.gaps.length > 0, `缺口報告有內容（${resB.gaps.length} 個缺口）`);
const fryGap = resB.gaps.find(g => g.stationId === "st-fry" && g.date === "2026-07-15");
ok(!!fryGap, "週三炸台缺口有被列出", fryGap ? fryGap.reasons.slice(0, 3).join("；") : "（沒抓到）");
ok(resB.violations.filter(v => v.severity === "block").length === 0, "缺口不硬塞：產出無 block 違規");

console.log("\n═══ 求解器：確定性（同輸入跑兩次結果必相同）═══");
const r1 = solveWeek({ ...base, weekStart: BASELINE_WEEK, leaves: SEED_LEAVES, settings: settingsGeneral, weights: DEFAULT_WEIGHTS });
const r2 = solveWeek({ ...base, weekStart: BASELINE_WEEK, leaves: SEED_LEAVES, settings: settingsGeneral, weights: DEFAULT_WEIGHTS });
ok(JSON.stringify(r1.assignments.map(a => [a.date, a.shiftId, a.stationId, a.staffId])) === JSON.stringify(r2.assignments.map(a => [a.date, a.shiftId, a.stationId, a.staffId])), "兩次輸出完全一致");
ok(r1.violations.filter(v => v.severity === "block").length === 0, `求解器產出無 block 違規（violations=${r1.violations.length}）`, r1.violations.map(v => v.message).join("；"));
ok(r1.gaps.length === 0, `基準週求解無缺口（gaps=${r1.gaps.length}）`, r1.gaps.map(g => `${g.date} ${g.stationId}`).join("；"));
console.log(`  統計：${r1.stats.filled}/${r1.stats.seatCount} 席｜總工時 ${r1.stats.totalHours}h｜預估成本 NT$${r1.stats.estCost.toLocaleString()}`);

console.log("\n═══ (K) 驗收比對：上週實際班表 vs 求解器產出 ═══");
const actual = buildBaselineActual();
const chkActual = checkSchedule({ ...base, weekStart: BASELINE_WEEK, assignments: actual, leaves: SEED_LEAVES, settings: settingsGeneral });
console.log(`  實際班表自身違規 ${chkActual.violations.length} 筆（故意埋的加班段：連鎖觸發 LR-030/032/034＋暴露技能矩陣沒記載阿明支援跑堂）：`);
chkActual.violations.forEach(v => console.log(`    ⚠ ${v.message}`));
ok(chkActual.violations.some(v => v.code === "LR-032"), "實際班表的 LR-032（阿明週五 12.5h）有被抓到");
const staffById = byId(SEED_STAFF), shiftById = byId(SEED_SHIFTS), stationById = byId(SEED_STATIONS);
const diffs = diffSchedules(actual, r1.assignments, staffById, shiftById, stationById);
console.log(`  差異清單（${diffs.length} 處）：`);
diffs.forEach(d => console.log(`    · ${d.slot}：實際=${d.a} → 求解=${d.b}`));

console.log(`\n${fails === 0 ? "✅ 全部通過" : `❌ ${fails} 項失敗`}`);
process.exit(fails ? 1 : 0);
