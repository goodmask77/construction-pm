// 本機驗證種子：真名冊(25人,只取非機密欄位) + 虛擬紀錄(回饋/360/投票/闖關/兌換)
// 產出 /tmp/crew-seed.json（localStorage 鍵值）+ 預期數字（跟畫面對帳用）
import { readFileSync, writeFileSync } from "node:fs";

const dump = JSON.parse(readFileSync("/tmp/crew-dump.json", "utf8"));
const people = (dump.sp_crew_kb_roster?.people || []).map(p => ({
  id: p.id, name: p.name, nick: p.nick || "", dept: p.dept || "", role: p.role || "staff",
  status: "在職", account: p.account || "", bday: p.bday || "",
})).filter(p => p.id !== "p-q1dmk8");
const ZL = "mgr-zhangliang";
if (!people.some(p => p.id === ZL)) throw new Error("名冊缺張良");

// 今天 2026-07-21(週二)，本週一=2026-07-20
const T = (d, h = 10) => new Date(`2026-07-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00+08:00`).toISOString();

const fbItems = [
  { id: "fb-s1", fromId: "p00", toId: "p01", tags: ["服務暖心"], text: "尖峰幫收外場，超暖！", anon: false, ts: T(20), helpful: ["p01"] },
  { id: "fb-s2", fromId: "p02", toId: "p00", tags: ["神隊友"], text: "", anon: true, ts: T(20, 14), helpful: [] },
  { id: "fb-s3", fromId: ZL, toId: "p05", tags: ["執行力強"], text: "備料快又穩。", anon: false, ts: T(15), helpful: ["p05"] },
  { id: "fb-s4", fromId: "p05", toId: ZL, tags: ["思慮周全"], text: "", anon: false, ts: T(21, 9), helpful: [ZL] },
  { id: "fb-s5", fromId: "p03", toId: "p01", tags: ["出餐快又準"], text: "", anon: false, ts: T(19), helpful: [] },
];
const quests = dump.sp_crew_kb_quests?.quests || [];
const progress = [
  { questId: "q-a", userId: "p00", status: "completed", ts: T(18) },
  { questId: "q-a", userId: "p01", status: "completed", ts: T(18) },
  { questId: "q-b", userId: "p01", status: "completed", ts: T(19) },
  { questId: "q-a", userId: ZL, status: "completed", ts: T(19) },
  { questId: "q-d", userId: ZL, status: "completed", ts: T(20) },
];
const rewards = dump.sp_crew_kb_shop?.rewards || [];
const redemptions = [{ id: "rd-s1", userId: ZL, rewardId: "rw-e", cost: 80, name: "公司週邊小物", status: "requested", ts: T(21, 8) }];
const dims = dump.sp_crew_kb_360?.dimensions || [];
const mkScores = (v) => Object.fromEntries(dims.map(d => [d.id, v]));
const reviews = [
  { id: "rv-p01-p00", reviewerId: "p01", revieweeId: "p00", scores: mkScores(4), comment: "穩定可靠。", ts: T(20) },
  { id: "rv-p02-p00", reviewerId: "p02", revieweeId: "p00", scores: mkScores(5), comment: "", ts: T(20) },
  { id: "rv-p00-p00", reviewerId: "p00", revieweeId: "p00", scores: mkScores(3), comment: "", ts: T(20) },
  { id: `rv-${ZL}-p00`, reviewerId: ZL, revieweeId: "p00", scores: mkScores(4), comment: "", ts: T(21) },
  { id: `rv-${ZL}-p01`, reviewerId: ZL, revieweeId: "p01", scores: mkScores(5), comment: "帶新人很有耐心。", ts: T(21) },
];
const polls = [
  { id: "poll-mvp", title: "七月MVP", options: people.map(p => ({ id: p.id, label: p.name })), anon: true, peoplePoll: true },
  { id: "poll-eat", title: "夏季聚餐地點", options: [{ id: "o0", label: "燒肉" }, { id: "o1", label: "火鍋" }, { id: "o2", label: "熱炒" }], anon: true, peoplePoll: false },
];
const votes = [
  { pollId: "poll-mvp", voterId: "p00", choiceId: "p01", ts: T(20) },
  { pollId: "poll-mvp", voterId: "p02", choiceId: "p01", ts: T(20) },
  { pollId: "poll-mvp", voterId: "p03", choiceId: "p00", ts: T(20) },
  { pollId: "poll-mvp", voterId: ZL, choiceId: "p01", ts: T(20) },
  { pollId: "poll-eat", voterId: "p00", choiceId: "o0", ts: T(20) },
  { pollId: "poll-eat", voterId: "p01", choiceId: "o1", ts: T(20) },
];
const docs = [
  { id: "kb-s1", category: "教育訓練", title: "新人第一週教學（舊制文件）", kind: "text", content: "示範：舊單一分類文件", tags: ["新人必讀"], pinned: true, updatedBy: "張良", updatedAt: T(21, 7) },
  { id: "kb-s2", category: "內場", title: "炸台開檔SOP（舊制文件）", kind: "text", content: "示範", tags: ["炸台"], pinned: false, updatedBy: "張良", updatedAt: T(20) },
  { id: "kb-s3", aud: "外場", dtype: "表單", category: "外場", title: "外場交接表（新制）", kind: "text", content: "示範", tags: [], pinned: false, updatedBy: "張良", updatedAt: T(19) },
];

// ── 預期數字（用同一套公式離線算）──
const fbStat = {}; people.forEach(p => fbStat[p.id] = { given: 0, received: 0, helpfulGot: 0 });
fbItems.forEach(i => { if (fbStat[i.fromId]) { fbStat[i.fromId].given++; fbStat[i.fromId].helpfulGot += i.helpful.length; } if (fbStat[i.toId]) fbStat[i.toId].received++; });
const bal = {}; people.forEach(p => { const s = fbStat[p.id]; bal[p.id] = s.given * 2 + s.received + s.helpfulGot * 5; });
progress.forEach(pr => { const q = quests.find(x => x.id === pr.questId); if (q) bal[pr.userId] += q.points; });
redemptions.forEach(r => bal[r.userId] -= r.cost);
const nameOf = id => people.find(p => p.id === id)?.name;
const expected = {
  積分王: Object.entries(bal).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${nameOf(id)}=${v}`),
  張良今日: { 待完成訓練: quests.filter(q => !progress.some(p => p.userId === ZL && p.questId === q.id)).length,
    待回覆評鑑: people.length - reviews.filter(r => r.reviewerId === ZL).length,
    本週給出回饋: "0(紅字+提醒條)", 我的積分: bal[ZL],
    管理_訓練完成率: `${progress.length}/${quests.length * people.length} = ${Math.round(progress.length / (quests.length * people.length) * 100)}%`,
    管理_本週已給回饋: `${new Set(fbItems.filter(i => new Date(i.ts) >= new Date("2026-07-20T00:00:00+08:00")).map(i => i.fromId)).size}/25`,
    管理_待處理兌換: 1 },
  投票王_七月MVP: `${nameOf("p01")} 3票`,
  KB遷移: "教育訓練→全員+教學; 內場→內場+SOP; 新制→外場+表單",
};

const seed = {
  pm_current_space: "crew",
  pm_dev_user: JSON.stringify({ name: "張良", role: "admin" }),
  sp_crew_kb_roster: JSON.stringify({ people, fields: [] }),
  sp_crew_kb_feedback: JSON.stringify({ items: fbItems, exclusions: [] }),
  sp_crew_kb_quests: JSON.stringify({ quests, progress }),
  sp_crew_kb_shop: JSON.stringify({ rewards, redemptions }),
  sp_crew_kb_360: JSON.stringify({ dimensions: dims, reviews }),
  sp_crew_kb_polls: JSON.stringify({ polls, votes }),
  sp_crew_kb_docs: JSON.stringify(docs),
};
writeFileSync("/tmp/crew-seed.json", JSON.stringify({ seed, expected }, null, 1));
console.log("種子完成。預期：", JSON.stringify(expected, null, 1));
