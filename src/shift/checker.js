// ── 法遵檢查器（§C）：全系統唯一的規則判斷實作 ──
// 輸入任一份班表（手排或求解器產出）→ 輸出違規清單。
// 求解器不得內含另一套規則邏輯，必須呼叫本檢查器（§15、§28c）。
// 純函式、無副作用、無隨機 → node 可跑 selftest。
import {
  byId, skillOf, ruleBy, effectiveSystem, systemFallbackNote, ageAt,
  shiftHours, tMin, addDays, mondayOf, weekDates, dowOf, fmtMD, SKILL_RANK, SKILL_LABEL,
} from "./model.js";

// 兩個時段是否重疊（同一天內）
const overlap = (s1, e1, s2, e2) => tMin(s1) < tMin(e2) && tMin(s2) < tMin(e1);

// 違規物件（§13：規則代碼、法條、涉及人員、日期區間、實際 vs 上限、嚴重度 — 禁止只標紅不說明）
const V = (rule, staff, dates, actual, limit, msg, severityOverride) => ({
  code: rule.rule_code, lawRef: rule.law_ref, severity: severityOverride || rule.severity,
  staffId: staff?.id || "", staffName: staff ? (staff.nick || staff.name) : "",
  dates, actual, limit,
  message: msg + `，實際 ${actual} / 上限 ${limit} · ${rule.rule_code}`,
});
// 公司內規（非法條）：技能/請假/重疊等硬條件也走檢查器（§12 任一份班表都要能驗）
const CR = (code, name) => ({ rule_code: code, law_ref: "公司規則", severity: "block", name });
const CR_RULES = {
  skill: CR("CR-01", "崗位技能不可"),
  training: CR("CR-02", "受訓中須主力在場"),
  leave: CR("CR-03", "已核准請假仍排班"),
  unavailable: CR("CR-04", "固定不可排時段"),
  overlapDay: CR("CR-05", "同日班別時間重疊"),
  employment: CR("CR-06", "非在職期間"),
};

/**
 * checkSchedule(ctx) → { violations, notices }
 * ctx: {
 *   storeId, weekStart, assignments,        // 本週班表（含暫定格）
 *   otherAssignments,                       // 其他週（跨週規則：連續出勤/單月加班/四週總量/跨週換班間隔）
 *   staff, skills, shifts, stations, leaves, rules, settings,
 *   staffFilter,                            // 只檢查某人（求解器增量檢查用；同一實作、縮小範圍）
 * }
 */
export function checkSchedule(ctx) {
  const {
    storeId, weekStart, assignments = [], otherAssignments = [],
    staff = [], skills = {}, shifts = [], stations = [], leaves = [], rules = [], settings = {},
    staffFilter = null,
  } = ctx;
  const staffById = byId(staff), shiftById = byId(shifts), stationById = byId(stations);
  const stName = (id) => stationById[id]?.code || stationById[id]?.name || id;
  const violations = [], notices = [];
  const system = effectiveSystem(settings, storeId);
  const fb = systemFallbackNote(settings, storeId);
  if (fb) notices.push(fb);

  const rule = (code) => { const r = ruleBy(rules, code); return r && r.enabled !== false ? r : null; };
  const sysApplies = (r) => r.applies_to_system === "both" || r.applies_to_system === system;

  // 本週 + 跨週合併（跨週資料供連續出勤/月加班/四週總量）
  const all = [...otherAssignments, ...assignments].filter(a => a && a.staffId && shiftById[a.shiftId]);
  const weekSet = new Set(weekDates(weekStart));
  // 每人 → 日期 → 當日班列表
  const perStaff = {};
  for (const a of all) {
    if (staffFilter && a.staffId !== staffFilter) continue;
    (perStaff[a.staffId] = perStaff[a.staffId] || {})[a.date] = [...(perStaff[a.staffId]?.[a.date] || []), a];
  }
  const dayHours = (list) => list.reduce((s, a) => s + shiftHours(shiftById[a.shiftId]), 0);
  const inWeek = (date) => weekSet.has(date);

  for (const [staffId, days] of Object.entries(perStaff)) {
    const p = staffById[staffId];
    if (!p) continue;
    const dates = Object.keys(days).sort();
    const weekDatesOf = dates.filter(inWeek);
    if (!weekDatesOf.length) continue; // 只回報涉及本週的違規

    // ── 公司硬條件（逐格）──
    for (const date of weekDatesOf) {
      const list = days[date];
      for (const a of list) {
        const sh = shiftById[a.shiftId];
        // CR-06 在職期間
        if ((p.startDate && date < p.startDate) || (p.endDate && date > p.endDate)) {
          violations.push(V(CR_RULES.employment, p, [date, date], "非在職", "在職期間", `${p.nick || p.name} ${fmtMD(date)} 排班日不在在職期間（到職 ${p.startDate || "?"}${p.endDate ? "、離職 " + p.endDate : ""}）`));
        }
        // CR-01 技能：level=不可 或 未達班別最低等級
        const lv = skillOf(skills, staffId, a.stationId);
        const need = sh.minLevel || "training";
        if (lv === "no" || SKILL_RANK[lv] < SKILL_RANK[need]) {
          violations.push(V(CR_RULES.skill, p, [date, date], SKILL_LABEL[lv] || "無此技能", `至少${SKILL_LABEL[need]}`, `${p.nick || p.name} ${fmtMD(date)} 排入「${stName(a.stationId)}」但技能等級不符`));
        }
        // CR-02 受訓中：同日同時段須有該崗位主力在場（重疊班即算在場；部分重疊亦可 — 解釋待顧問確認）
        if (lv === "training") {
          const hasMain = all.some(b => b.date === date && b.staffId !== staffId && shiftById[b.shiftId]
            && overlap(sh.start, sh.end, shiftById[b.shiftId].start, shiftById[b.shiftId].end)
            && skillOf(skills, b.staffId, a.stationId) === "main");
          if (!hasMain) violations.push(V(CR_RULES.training, p, [date, date], "受訓中單獨上崗", "須主力同時段在場", `${p.nick || p.name} ${fmtMD(date)} 受訓中排入「${stName(a.stationId)}」，但同時段無該崗位主力`));
        }
        // CR-03 已核准請假
        const lv2 = (leaves || []).find(l => l.staffId === staffId && l.date === date && l.status === "approved" && overlap(sh.start, sh.end, l.from || "00:00", l.to === "24:00" ? "23:59" : (l.to || "23:59")));
        if (lv2) violations.push(V(CR_RULES.leave, p, [date, date], `已核准${lv2.type}`, "不得排班", `${p.nick || p.name} ${fmtMD(date)} 已核准${lv2.type}仍被排班`));
        // CR-04 固定不可排
        const ua = (p.unavailable || []).find(u => u.dow === dowOf(date) && overlap(sh.start, sh.end, u.from || "00:00", u.to === "24:00" ? "23:59" : (u.to || "23:59")));
        if (ua) violations.push(V(CR_RULES.unavailable, p, [date, date], sh.start + "–" + sh.end, "固定不可排" + (ua.note ? `（${ua.note}）` : ""), `${p.nick || p.name} ${fmtMD(date)} 排入固定不可排時段`));
      }
      // CR-05 同日重疊
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const s1 = shiftById[list[i].shiftId], s2 = shiftById[list[j].shiftId];
        if (overlap(s1.start, s1.end, s2.start, s2.end)) {
          violations.push(V(CR_RULES.overlapDay, p, [date, date], `${s1.code}+${s2.code}`, "時間不得重疊", `${p.nick || p.name} ${fmtMD(date)} 同日兩班時間重疊（${s1.code} ${s1.start}–${s1.end} 與 ${s2.code} ${s2.start}–${s2.end}）`));
        }
      }
    }

    // ── 法規（參數表驅動）──
    const dailyNormal = system === "four_week" ? (rule("LR-030-1")?.params?.dailyNormalMax ?? 10) : (rule("LR-030")?.params?.dailyNormalMax ?? 8);

    // LR-030 一般工時（僅 general；四週變形由 LR-030-1 管）
    const r030 = rule("LR-030");
    if (r030 && sysApplies(r030)) {
      for (const date of weekDatesOf) {
        const h = dayHours(days[date]);
        if (h > r030.params.dailyNormalMax) violations.push(V(r030, p, [date, date], `${h}h`, `${r030.params.dailyNormalMax}h`, `${p.nick || p.name} ${fmtMD(date)} 單日工時 ${h}h 超過正常工時（超過部分屬延長工時，${r030.law_ref}）`));
      }
      const wk = weekDatesOf.reduce((s, d) => s + dayHours(days[d]), 0);
      if (wk > r030.params.weeklyNormalMax) violations.push(V(r030, p, [weekStart, addDays(weekStart, 6)], `${Math.round(wk * 10) / 10}h`, `${r030.params.weeklyNormalMax}h`, `${p.nick || p.name} ${fmtMD(weekStart)}–${fmtMD(addDays(weekStart, 6))} 週工時超過每週正常工時上限（${r030.law_ref}）`));
    }

    // LR-030-1 四週變形（僅 four_week 且已填同意書 — effectiveSystem 已處理回退）
    const r0301 = rule("LR-030-1");
    if (r0301 && sysApplies(r0301)) {
      for (const date of weekDatesOf) {
        const h = dayHours(days[date]);
        if (h > r0301.params.dailyNormalMax) violations.push(V(r0301, p, [date, date], `${h}h`, `${r0301.params.dailyNormalMax}h`, `${p.nick || p.name} ${fmtMD(date)} 單日工時超過四週變形單日上限（${r0301.law_ref}）`));
      }
      // 四週總量：本週往前推 3 週的滾動窗（保守解讀，週期起算點待顧問確認）
      const from4 = addDays(weekStart, -21);
      let tot = 0;
      for (const d of dates) if (d >= from4 && d <= addDays(weekStart, 6)) tot += Math.min(dayHours(days[d]), r0301.params.dailyNormalMax);
      if (tot > r0301.params.fourWeekNormalMax) violations.push(V(r0301, p, [from4, addDays(weekStart, 6)], `${Math.round(tot * 10) / 10}h`, `${r0301.params.fourWeekNormalMax}h`, `${p.nick || p.name} ${fmtMD(from4)}–${fmtMD(addDays(weekStart, 6))} 四週正常工時總量超限（${r0301.law_ref}）`));
    }

    // LR-032 延長工時：單日總工時 12h、單月延長 46h
    const r032 = rule("LR-032");
    if (r032 && sysApplies(r032)) {
      for (const date of weekDatesOf) {
        const h = dayHours(days[date]);
        if (h > r032.params.dailyTotalMax) violations.push(V(r032, p, [date, date], `${h}h`, `${r032.params.dailyTotalMax}h`, `${p.nick || p.name} ${fmtMD(date)} 單日總工時（含加班）超限（${r032.law_ref}）`));
      }
      // 單月延長工時：本週觸及的每個月份各算一次（用全部已知資料）
      const months = [...new Set(weekDatesOf.map(d => d.slice(0, 7)))];
      for (const mo of months) {
        let ot = 0;
        for (const d of dates) if (d.slice(0, 7) === mo) ot += Math.max(0, dayHours(days[d]) - dailyNormal);
        if (ot > r032.params.monthlyOtMax) violations.push(V(r032, p, [mo + "-01", mo + "-28"], `${Math.round(ot * 10) / 10}h`, `${r032.params.monthlyOtMax}h`, `${p.nick || p.name} ${mo} 當月延長工時超限（${r032.law_ref}）`));
      }
    }

    // LR-036 七休一：連續出勤上限（一般 6 日 / 四週變形 12 日 — 解釋待顧問覆核）
    const r036 = rule("LR-036");
    if (r036 && sysApplies(r036)) {
      const maxRun = system === "four_week" ? r036.params.maxConsecutiveFourWeek : r036.params.maxConsecutiveGeneral;
      let run = [], reported = new Set();
      const sorted = dates;
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && addDays(sorted[i - 1], 1) === sorted[i]) run.push(sorted[i]);
        else run = [sorted[i]];
        if (run.length > maxRun && run.some(inWeek)) {
          const key = run[0];
          if (!reported.has(key)) { // 同一段連續只報一次（以最長狀態更新）
            reported.add(key);
            violations.push(V(r036, p, [run[0], run[run.length - 1]], `連續 ${run.length} 日`, `${maxRun} 日`, `${p.nick || p.name} ${fmtMD(run[0])}–${fmtMD(run[run.length - 1])} 連續出勤 ${run.length} 日，違反七休一（${r036.law_ref}）`));
          } else {
            const v = violations.findLast?.(x => x.code === "LR-036" && x.staffId === staffId) || violations[violations.length - 1];
            if (v && v.code === "LR-036") { v.dates = [run[0], run[run.length - 1]]; v.actual = `連續 ${run.length} 日`; v.message = `${p.nick || p.name} ${fmtMD(run[0])}–${fmtMD(run[run.length - 1])} 連續出勤 ${run.length} 日，違反七休一（${r036.law_ref}），實際 連續 ${run.length} 日 / 上限 ${maxRun} 日 · LR-036`; }
          }
        }
      }
    }

    // LR-036-1 休息日出勤：單週出勤第 6 日起提示
    const r0361 = rule("LR-036-1");
    if (r0361 && sysApplies(r0361)) {
      const wd = weekDatesOf.length;
      if (wd > r0361.params.weeklyWorkDaysBeforeRestDay) {
        violations.push(V(r0361, p, [weekStart, addDays(weekStart, 6)], `週出勤 ${wd} 日`, `${r0361.params.weeklyWorkDaysBeforeRestDay} 日`, `${p.nick || p.name} 本週出勤 ${wd} 日，第 ${r0361.params.weeklyWorkDaysBeforeRestDay + 1} 日起屬休息日出勤，需勞工同意且工資加成（${r0361.law_ref}）`));
      }
    }

    // LR-034 換班間隔（含跨週前一日）
    const r034 = rule("LR-034");
    if (r034 && sysApplies(r034)) {
      for (const date of weekDatesOf) {
        const prevDate = addDays(date, -1);
        const prevList = days[prevDate]; if (!prevList) continue;
        const endMax = Math.max(...prevList.map(a => tMin(shiftById[a.shiftId].end)));
        const startMin = Math.min(...days[date].map(a => tMin(shiftById[a.shiftId].start)));
        const gap = (24 * 60 - endMax + startMin) / 60;
        if (gap < r034.params.minRestHours) {
          violations.push(V(r034, p, [prevDate, date], `間隔 ${Math.round(gap * 10) / 10}h`, `${r034.params.minRestHours}h`, `${p.nick || p.name} ${fmtMD(prevDate)} 下班至 ${fmtMD(date)} 上班間隔不足（${r034.law_ref}；是否屬輪班制待確認）`));
        }
      }
    }

    // LR-048 未成年工（年齡以出生年概算，保守判定）
    const r048 = rule("LR-048");
    if (r048 && sysApplies(r048) && p.birthYear) {
      for (const date of weekDatesOf) {
        const age = ageAt(p.birthYear, date);
        if (age >= 18) continue;
        for (const a of days[date]) {
          const sh = shiftById[a.shiftId];
          const banFrom = tMin(r048.params.nightBanFrom), banTo = tMin(r048.params.nightBanTo);
          if (tMin(sh.end) > banFrom || tMin(sh.start) < banTo) {
            violations.push(V(r048, p, [date, date], `${sh.start}–${sh.end}`, `${r048.params.nightBanFrom} 前下班`, `${p.nick || p.name}（${age} 歲）${fmtMD(date)} 班次跨入未成年禁止工作時段 ${r048.params.nightBanFrom}–${r048.params.nightBanTo}（${r048.law_ref}）`));
          }
        }
        if (age < 16) {
          const h = dayHours(days[date]);
          if (h > r048.params.minorDailyMax) violations.push(V(r048, p, [date, date], `${h}h`, `${r048.params.minorDailyMax}h`, `${p.nick || p.name}（童工）${fmtMD(date)} 單日工時超限（${r048.law_ref}）`));
        }
      }
    }
  }

  return { violations, notices };
}

// 是否可發布（§14：有 block 不得進入已發布）
export const canPublish = (violations) => !(violations || []).some(v => v.severity === "block");
