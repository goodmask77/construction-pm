// ── P2 出勤 × 班表比對（純函式；App PunchView 與 D哥 line-webhook 共用同一份——資料一致鐵則）──
// 輸入：當日班表 assignments(staffId/shiftId) + 班別 templates(start/end) + staff(rosterId對應) + 當日打卡 punches
// 輸出：每人一列 {rosterId,name,shiftCode,planIn,planOut,firstIn,lastOut,status,lateMin,earlyMin}
// 狀態：ontime準時 / late遲到 / absent未到(過了應到時間還沒卡) / early早退 / working上班中 / done完成 / extra未排班有打卡 / pending尚未到班
export const GRACE_MIN = 5; // 遲到寬限（分鐘）

const toMin = (hhmm) => { const [h, m] = String(hhmm || "0:0").split(":").map(Number); return h * 60 + m; };
const tsMin = (iso) => { // 打卡時間 → 台北當日分鐘數
  const d = new Date(iso);
  const s = d.toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Taipei" });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
export const fmtMin = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// nowMin：現在時刻（台北，分鐘）；比對「今天」時傳入，比對過去日期傳 1440（一天結束）
export function compareDay({ date, assignments, staffById, shiftById, punches, nowMin = 1440, graceMin = GRACE_MIN }) {
  const rows = [];
  const punchByRoster = {};
  (punches || []).forEach(p => { (punchByRoster[p.personId] = punchByRoster[p.personId] || []).push(p); });
  const seen = new Set();
  for (const a of (assignments || []).filter(x => x.date === date)) {
    const st = staffById[a.staffId];
    const sh = shiftById[a.shiftId];
    if (!st || !sh) continue;
    const rosterId = st.rosterId || null;
    if (rosterId) seen.add(rosterId);
    const planIn = toMin(sh.start), planOut = toMin(sh.end);
    const ps = rosterId ? (punchByRoster[rosterId] || []) : [];
    const ins = ps.filter(p => p.dir === "in").map(p => tsMin(p.ts));
    const outs = ps.filter(p => p.dir === "out").map(p => tsMin(p.ts));
    const firstIn = ins.length ? Math.min(...ins) : null;
    const lastOut = outs.length ? Math.max(...outs) : null;
    let status, lateMin = 0, earlyMin = 0;
    if (firstIn == null) {
      status = nowMin < planIn + graceMin ? "pending" : "absent"; // 還沒到應到時間＝尚未到班；過了＝未到
    } else {
      const isLate = firstIn > planIn + graceMin;      // 超過寬限才算遲到
      if (isLate) lateMin = firstIn - planIn;          // 遲到數字顯示與表定的原始差（含寬限）
      if (lastOut == null) status = "working";         // 有上班卡、還沒下班卡
      else if (lastOut < planOut - graceMin) { status = "early"; earlyMin = planOut - lastOut; } // 提早下班
      else status = "done";
      if (isLate && status !== "early") status = "late"; // 遲到優先顯示（遲到＋早退→標早退、遲到分鐘保留）
    }
    rows.push({ rosterId, staffId: a.staffId, name: st.name || st.nick || "?", shiftCode: sh.code || sh.name, planIn: fmtMin(planIn), planOut: fmtMin(planOut), firstIn: firstIn != null ? fmtMin(firstIn) : null, lastOut: lastOut != null ? fmtMin(lastOut) : null, status, lateMin, earlyMin });
  }
  // 未排班卻有打卡（支援/加班/誤打）
  for (const [rosterId, ps] of Object.entries(punchByRoster)) {
    if (seen.has(rosterId)) continue;
    const ins = ps.filter(p => p.dir === "in").map(p => tsMin(p.ts));
    const outs = ps.filter(p => p.dir === "out").map(p => tsMin(p.ts));
    rows.push({ rosterId, staffId: null, name: ps[0]?.name || "?", shiftCode: null, planIn: null, planOut: null, firstIn: ins.length ? fmtMin(Math.min(...ins)) : null, lastOut: outs.length ? fmtMin(Math.max(...outs)) : null, status: "extra", lateMin: 0, earlyMin: 0 });
  }
  return rows;
}
export const ATT_LABEL = { ontime: "準時", late: "遲到", absent: "未到", early: "早退", working: "上班中", done: "完成", extra: "未排班打卡", pending: "尚未到班" };
export function summarize(rows) {
  const c = {};
  rows.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
  const bad = rows.filter(r => ["late", "absent", "early"].includes(r.status));
  return { counts: c, bad };
}
