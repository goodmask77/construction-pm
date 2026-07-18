// ── 自動排班求解器（§F）：確定性「貪婪＋回溯」──
// 鐵則：
// 1. 不用 LLM、不用隨機（同輸入必同輸出）：所有排序都有固定平手裁決（分數→員編→id）。
// 2. 法遵判斷不自己寫：每一步指派都呼叫同一支檢查器 checkSchedule（staffFilter 縮小範圍）。
// 3. 尊重 is_pinned：鎖定格視為固定條件，不覆蓋（§29）。
// 4. 無可行解 → 誠實輸出部分班表＋缺口報告，嚴禁為填滿而違反硬條件（§32）。
import {
  byId, skillOf, seatsForWeek, shiftHours, tMin, dowOf, fmtMD, addDays,
  SKILL_RANK, weightVal, estCost,
} from "./model.js";
import { checkSchedule } from "./checker.js";

const overlap = (s1, e1, s2, e2) => tMin(s1) < tMin(e2) && tMin(s2) < tMin(e1);

/**
 * solveWeek(ctx) → { assignments, gaps, violations, notices, stats }
 * ctx: { storeId, weekStart, staff, skills, shifts, stations, demands, leaves, rules, settings,
 *        weights, overrides, keepAssignments (含鎖定格與「排其餘」要保留的格), holidaySet }
 */
export function solveWeek(ctx) {
  const {
    storeId, weekStart, staff = [], skills = {}, shifts = [], stations = [], demands = [],
    leaves = [], rules = [], settings = {}, weights = {}, overrides = [],
    keepAssignments = [], otherAssignments = [], holidaySet = null,
  } = ctx;
  const shiftById = byId(shifts);
  const w = (k) => weightVal(weights[k]);

  // 1) 座位展開，扣掉已保留（鎖定/既有）的格
  const allSeats = seatsForWeek(demands, weekStart, storeId, overrides, holidaySet);
  const kept = [...keepAssignments];
  const seatTaken = new Set();
  for (const a of kept) {
    const idx = allSeats.findIndex(s => !seatTaken.has(s.seatKey) && s.date === a.date && s.shiftId === a.shiftId && s.stationId === a.stationId);
    if (idx >= 0) seatTaken.add(allSeats[idx].seatKey);
  }
  const seats = allSeats.filter(s => !seatTaken.has(s.seatKey));

  // 目前指派（含保留格）；求解過程逐步 push
  const assigned = [...kept];
  const newlyAssigned = []; // 求解器自己排的（回溯只動這些）

  // ── 靜態硬條件（不含法規；法規交給檢查器）──
  const staffSorted = [...staff].sort((a, b) => (a.empNo || "").localeCompare(b.empNo || "") || a.id.localeCompare(b.id));
  const staticReason = (p, seat) => {
    const sh = shiftById[seat.shiftId];
    if (!(p.stores || []).includes(storeId)) return "非本店人員";
    if ((p.startDate && seat.date < p.startDate) || (p.endDate && seat.date > p.endDate)) return "不在在職期間";
    const lv = skillOf(skills, p.id, seat.stationId);
    if (lv === "no" || SKILL_RANK[lv] < SKILL_RANK[sh.minLevel || "training"]) return null; // 技能不合 → 不列入「合格者」清單
    const onLeave = (leaves || []).find(l => l.staffId === p.id && l.date === seat.date && l.status === "approved" && overlap(sh.start, sh.end, l.from || "00:00", l.to === "24:00" ? "23:59" : (l.to || "23:59")));
    if (onLeave) return `${onLeave.type}已核准`;
    const ua = (p.unavailable || []).find(u => u.dow === dowOf(seat.date) && overlap(sh.start, sh.end, u.from || "00:00", u.to === "24:00" ? "23:59" : (u.to || "23:59")));
    if (ua) return "固定不可排" + (ua.note ? `（${ua.note}）` : "");
    return ""; // "" = 通過；null = 連合格者都不算；其他字串 = 合格但被擋的原因
  };
  const busyReason = (p, seat, pool) => {
    const sh = shiftById[seat.shiftId];
    const clash = pool.find(a => a.staffId === p.id && a.date === seat.date && shiftById[a.shiftId] && overlap(sh.start, sh.end, shiftById[a.shiftId].start, shiftById[a.shiftId].end));
    return clash ? `已排${shiftById[clash.shiftId].code}` : "";
  };
  // 法規硬條件：暫定加入 → 跑同一支檢查器（只看該員）→ 有新增 block 即擋（§28a）
  const ruleReason = (p, seat, pool) => {
    const sh = shiftById[seat.shiftId];
    const tentative = { id: `tt-${seat.seatKey}`, staffId: p.id, date: seat.date, shiftId: seat.shiftId, stationId: seat.stationId, pinned: false };
    const before = checkSchedule({ storeId, weekStart, assignments: pool, otherAssignments, staff, skills, shifts, stations, leaves, rules, settings, staffFilter: p.id }).violations.filter(v => v.severity === "block").length;
    const after = checkSchedule({ storeId, weekStart, assignments: [...pool, tentative], otherAssignments, staff, skills, shifts, stations, leaves, rules, settings, staffFilter: p.id }).violations.filter(v => v.severity === "block");
    if (after.length > before) return `會觸發${after[after.length - 1].code === "CR-02" ? "受訓陪同" : after[after.length - 1].code}（${after[after.length - 1].message.split("，")[1] || after[after.length - 1].code}）`;
    return "";
  };

  // ── 軟條件評分（§E；永遠不覆蓋硬條件 — 硬條件在上面全過濾掉了）──
  const countOf = (pool, staffId) => pool.filter(a => a.staffId === staffId).length;
  const hoursOf = (pool, staffId) => pool.filter(a => a.staffId === staffId).reduce((s, a) => s + shiftHours(shiftById[a.shiftId]), 0);
  const score = (p, seat, pool) => {
    const sh = shiftById[seat.shiftId];
    let sc = 0;
    // 每週班數接近期望值：還沒到期望 → 加分；超過 → 扣分
    const cnt = countOf(pool, p.id);
    sc += w("expectShifts") * ((p.expectShifts || 5) - cnt);
    // 希望休假（軟性，非請假）：staff.wishOff = ["YYYY-MM-DD"]
    if ((p.wishOff || []).includes(seat.date)) sc -= w("wishOff") * 3;
    // 工時公平性：目前工時越多越扣
    sc -= w("fairness") * (hoursOf(pool, p.id) / 8);
    // 避免收班隔日開店
    if (sh.isOpen) {
      const prev = pool.filter(a => a.staffId === p.id && a.date === addDays(seat.date, -1)).some(a => shiftById[a.shiftId]?.isClose);
      if (prev) sc -= w("noCloseThenOpen") * 2;
    }
    // 熟手新手搭配：主力排入時，若同時段已有受訓中者在同崗位 → 加分
    const lv = skillOf(skills, p.id, seat.stationId);
    if (lv === "main") {
      const hasTrainee = pool.some(a => a.date === seat.date && a.stationId === seat.stationId && skillOf(skills, a.staffId, a.stationId) === "training");
      if (hasTrainee) sc += w("mentorPair") * 2;
    }
    if (lv === "training") sc -= w("mentorPair"); // 受訓中者非必要不優先
    // 人力成本：係數越高越扣
    sc -= w("cost") * (p.costFactor || 1);
    // 固定班別偏好
    if ((p.fixedPrefShiftIds || []).includes(seat.shiftId)) sc += w("fixedPref");
    // 加班意願：這格會讓他當日超過 8h → 有意願加分、無意願扣分
    const dayH = pool.filter(a => a.staffId === p.id && a.date === seat.date).reduce((s, a) => s + shiftHours(shiftById[a.shiftId]), 0);
    if (dayH + shiftHours(sh) > 8) sc += (p.otWilling ? 1 : -1) * w("otWilling");
    // 技能等級偏好：主力優先於可勝任優先於受訓中（小額固定偏好，保證同分時熟手先上）
    sc += SKILL_RANK[lv] * 0.5;
    return sc;
  };

  // 候選人清單（含排除原因，供缺口報告 §31）
  const candidatesOf = (seat, pool) => {
    const ok = [], excluded = [];
    for (const p of staffSorted) {
      const r1 = staticReason(p, seat);
      if (r1 === null) continue; // 技能不合 → 不列
      if (r1) { excluded.push({ staff: p, reason: r1 }); continue; }
      const r2 = busyReason(p, seat, pool);
      if (r2) { excluded.push({ staff: p, reason: r2 }); continue; }
      const r3 = ruleReason(p, seat, pool);
      if (r3) { excluded.push({ staff: p, reason: r3 }); continue; }
      ok.push(p);
    }
    return { ok, excluded };
  };

  // 2) 座位排序：先排「合格候選人最少」的（稀缺優先），再依日期/班別起時/崗位（全部固定鍵 → 確定性）
  const scarcity = new Map();
  for (const s of seats) {
    const n = staffSorted.filter(p => staticReason(p, s) === "").length;
    scarcity.set(s.seatKey, n);
  }
  seats.sort((a, b) => (scarcity.get(a.seatKey) - scarcity.get(b.seatKey)) || a.date.localeCompare(b.date) || (tMin(shiftById[a.shiftId].start) - tMin(shiftById[b.shiftId].start)) || a.stationId.localeCompare(b.stationId) || a.seatKey.localeCompare(b.seatKey));

  // 3) 逐座位指派＋單層回溯（§28d：把佔住候選人的舊指派換人重試；重試失敗 → 缺口）
  const gaps = [];
  let seq = 0;
  for (const seat of seats) {
    const { ok, excluded } = candidatesOf(seat, assigned);
    if (ok.length) {
      const best = [...ok].sort((a, b) => (score(b, seat, assigned) - score(a, seat, assigned)) || (a.empNo || "").localeCompare(b.empNo || "") || a.id.localeCompare(b.id))[0];
      const a = { id: `sv-${weekStart}-${++seq}`, staffId: best.id, date: seat.date, shiftId: seat.shiftId, stationId: seat.stationId, pinned: false, bySolver: true };
      assigned.push(a); newlyAssigned.push(a);
      continue;
    }
    // 回溯：找「只因已排別的班而被擋」的人，看他原本那格能不能換別人
    let solved = false;
    for (const ex of excluded) {
      if (!ex.reason.startsWith("已排")) continue;
      const theirs = newlyAssigned.find(a => a.staffId === ex.staff.id && a.date === seat.date);
      if (!theirs) continue; // 鎖定格/保留格不動（§29）
      const poolWithout = assigned.filter(a => a !== theirs);
      const altSeat = { date: theirs.date, shiftId: theirs.shiftId, stationId: theirs.stationId, seatKey: "bt-" + theirs.id };
      const alt = candidatesOf(altSeat, poolWithout).ok.filter(p => p.id !== ex.staff.id);
      if (!alt.length) continue;
      const altBest = alt.sort((a, b) => (score(b, altSeat, poolWithout) - score(a, altSeat, poolWithout)) || (a.empNo || "").localeCompare(b.empNo || "") || a.id.localeCompare(b.id))[0];
      // 換人：原格給 altBest，這格給 ex.staff（先確認 ex.staff 補進本格不觸法規）
      theirs.staffId = altBest.id;
      const r3 = ruleReason(ex.staff, seat, assigned);
      if (r3) { theirs.staffId = ex.staff.id; continue; } // 還原，試下一個
      const a = { id: `sv-${weekStart}-${++seq}`, staffId: ex.staff.id, date: seat.date, shiftId: seat.shiftId, stationId: seat.stationId, pinned: false, bySolver: true };
      assigned.push(a); newlyAssigned.push(a);
      solved = true; break;
    }
    if (!solved) {
      gaps.push({
        date: seat.date, shiftId: seat.shiftId, stationId: seat.stationId,
        qualified: excluded.length,
        reasons: excluded.map(e => `${e.staff.nick || e.staff.name}：${e.reason}`),
      });
    }
  }

  // 4) 全表跑同一支檢查器（§28c）；求解器新排的格若有 block → 退掉列缺口，違規必須顯示不得吞掉（§31）
  let { violations, notices } = checkSchedule({ storeId, weekStart, assignments: assigned, otherAssignments, staff, skills, shifts, stations, leaves, rules, settings });
  const solverBlocks = violations.filter(v => v.severity === "block");
  for (const v of solverBlocks) {
    const culprit = newlyAssigned.find(a => a.staffId === v.staffId && a.date >= v.dates[0] && a.date <= v.dates[1]);
    if (culprit) {
      assigned.splice(assigned.indexOf(culprit), 1);
      newlyAssigned.splice(newlyAssigned.indexOf(culprit), 1);
      gaps.push({ date: culprit.date, shiftId: culprit.shiftId, stationId: culprit.stationId, qualified: 0, reasons: [`求解器產出違規已退回（求解器 bug，請回報）：${v.message}`] });
    }
  }
  if (solverBlocks.length) ({ violations, notices } = checkSchedule({ storeId, weekStart, assignments: assigned, otherAssignments, staff, skills, shifts, stations, leaves, rules, settings }));

  // 5) 統計（§31：總工時、預估成本、每人班數、軟條件摘要）
  const staffById = byId(staff);
  const { hours, cost } = estCost(assigned, staffById, shiftById, rules);
  const perStaff = {};
  for (const a of assigned) {
    const o = perStaff[a.staffId] = perStaff[a.staffId] || { name: staffById[a.staffId]?.nick || staffById[a.staffId]?.name || a.staffId, count: 0, hours: 0 };
    o.count++; o.hours += shiftHours(shiftById[a.shiftId]);
  }
  const softSummary = Object.entries(perStaff).map(([sid, o]) => {
    const exp = staffById[sid]?.expectShifts || 0;
    return { staffId: sid, name: o.name, count: o.count, hours: Math.round(o.hours * 10) / 10, expect: exp, delta: o.count - exp };
  }).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

  return {
    assignments: assigned, gaps, violations, notices,
    stats: { totalHours: hours, estCost: cost, filled: allSeats.length - gaps.length, seatCount: allSeats.length, softSummary },
  };
}

// 兩份班表逐格比對（§46-47 驗收：每處差異都要能列出來讓人解讀）
export function diffSchedules(aList, bList, staffById, shiftById, stationById) {
  const key = (a) => `${a.date}|${a.shiftId}|${a.stationId}`;
  const nameOf = (id) => staffById[id]?.nick || staffById[id]?.name || id;
  const label = (a) => `${fmtMD(a.date)} ${shiftById[a.shiftId]?.code || a.shiftId}·${stationById[a.stationId]?.code || a.stationId}`;
  const mapA = {}, mapB = {};
  for (const a of aList) (mapA[key(a)] = mapA[key(a)] || []).push(a);
  for (const b of bList) (mapB[key(b)] = mapB[key(b)] || []).push(b);
  const diffs = [];
  const keys = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort();
  for (const k of keys) {
    const la = (mapA[k] || []).map(x => x.staffId).sort();
    const lb = (mapB[k] || []).map(x => x.staffId).sort();
    if (JSON.stringify(la) === JSON.stringify(lb)) continue;
    const sample = (mapA[k] || mapB[k])[0];
    diffs.push({
      slot: label(sample), date: sample.date,
      a: la.map(nameOf).join("、") || "（空）",
      b: lb.map(nameOf).join("、") || "（空）",
    });
  }
  return diffs;
}
