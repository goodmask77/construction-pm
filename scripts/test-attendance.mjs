// 出勤×班表比對 selftest（純函式；prebuild 自動跑）
import { compareDay, summarize } from "../src/shift/attendance.js";

let pass = 0, fail = 0;
const chk = (label, ok, extra = "") => { console.log((ok ? "  ✅" : "  ❌") + " " + label + (extra ? " → " + extra : "")); ok ? pass++ : fail++; };

const D = "2026-07-22";
const staffById = { s1: { id: "s1", rosterId: "p1", name: "阿明" }, s2: { id: "s2", rosterId: "p2", name: "小美" }, s3: { id: "s3", rosterId: null, name: "無對應" } };
const shiftById = { sh1: { id: "sh1", code: "內早", start: "09:00", end: "17:30" } };
const asg = (staffId) => ({ staffId, date: D, shiftId: "sh1" });
const pch = (personId, dir, hhmm, name = "x") => ({ personId, name, dir, ts: `${D}T${hhmm}:00+08:00` });
const run = (assignments, punches, nowMin = 1440) => compareDay({ date: D, assignments, staffById, shiftById, punches, nowMin });

// 1 準時完成
let r = run([asg("s1")], [pch("p1", "in", "08:58"), pch("p1", "out", "17:35")]);
chk("準時上下班=done", r[0].status === "done" && r[0].firstIn === "08:58", JSON.stringify(r[0].status));
// 2 寬限內不算遲到
r = run([asg("s1")], [pch("p1", "in", "09:04"), pch("p1", "out", "17:30")]);
chk("寬限5分內不算遲到", r[0].status === "done" && r[0].lateMin === 0);
// 3 遲到
r = run([asg("s1")], [pch("p1", "in", "09:20"), pch("p1", "out", "17:30")]);
chk("遲到20分", r[0].status === "late" && r[0].lateMin === 20, `lateMin=${r[0].lateMin}`);
// 4 早退
r = run([asg("s1")], [pch("p1", "in", "09:00"), pch("p1", "out", "16:00")]);
chk("早退90分", r[0].status === "early" && r[0].earlyMin === 90);
// 5 遲到+早退 → 標早退但遲到分鐘保留
r = run([asg("s1")], [pch("p1", "in", "09:30"), pch("p1", "out", "16:00")]);
chk("遲到+早退標早退保留遲到數", r[0].status === "early" && r[0].lateMin === 30);
// 6 上班中（沒下班卡）
r = run([asg("s1")], [pch("p1", "in", "09:00")], 12 * 60);
chk("上班中", r[0].status === "working");
// 7 尚未到班（還沒到應到時間）
r = run([asg("s1")], [], 8 * 60);
chk("時間未到=尚未到班", r[0].status === "pending");
// 8 未到（過了應到時間沒卡）
r = run([asg("s1")], [], 10 * 60);
chk("過應到時間沒卡=未到", r[0].status === "absent");
// 9 未排班有打卡
r = run([asg("s1")], [pch("p1", "in", "09:00"), pch("p2", "in", "10:00", "小美")]);
chk("未排班打卡=extra", r.some(x => x.rosterId === "p2" && x.status === "extra"));
// 10 無 rosterId 的排班人員不炸、其他日 assignment 不算
r = run([asg("s3"), { staffId: "s1", date: "2026-07-23", shiftId: "sh1" }], []);
chk("無對應者照列/隔日班不列", r.length === 1 && r[0].rosterId === null);
// 11 summarize
const s = summarize(run([asg("s1"), asg("s2")], [pch("p1", "in", "09:30"), pch("p1", "out", "17:30")], 1440));
chk("summarize遲到+未到", s.counts.late === 1 && s.counts.absent === 1 && s.bad.length === 2);

console.log(`結果：${pass} 通過 / ${fail} 失敗`);
if (fail) process.exit(1);
