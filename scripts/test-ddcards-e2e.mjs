// DD互動卡片 E2E（打預覽站真API/真DB；假人「測試王試」，測完清乾淨）
import { readFileSync } from "node:fs";
const BASE = readFileSync("/tmp/preview-url.txt", "utf8").trim();
const DBG = (op, body = {}) => fetch(`${BASE}/api/onboard?action=debug&t=obtest-x9k2m7`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, ...body }) }).then(r => r.json());
const UID = "U-obtest-001";
const ev = (e) => fetch(`${BASE}/api/line-webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [e] }) });
const msg = (text) => ev({ type: "message", replyToken: "f", source: { type: "user", userId: UID }, message: { type: "text", id: "m" + Date.now(), text } });
const pb = (data) => ev({ type: "postback", replyToken: "f", source: { type: "user", userId: UID }, postback: { data } });
let pass = 0, fail = 0;
const chk = (l, ok, x = "") => { console.log((ok ? "✅" : "❌") + " " + l + (x ? " → " + x : "")); ok ? pass++ : fail++; };

// 0. 建測試綁定人 + 測試投票
await DBG("cleanup", { nameContains: "測試王試", emails: [] });
await DBG("cleanfb", { idContains: "p-" }); // 先清舊測試殘留（只清 via:line 且含測試id的，安全）
await msg("測試王試報到");
const p = (await DBG("person", { nameContains: "測試王試" })).person;
chk("測試人已綁定", !!p?.lineUserId, p?.id);
await DBG("addpoll");

// 1. 回饋卡流程：選人 postback → 選標籤 postback → 寫回 kb_feedback
await msg("回饋");
await pb(`fb|to|p00`);
await pb(`fb|tag|p00|0`); // 服務暖心
let fb = (await DBG("fbdump")).items || [];
let mine = fb.find(i => i.fromId === p.id && i.toId === "p00" && i.via === "line");
chk("回饋已寫回(標籤=服務暖心)", !!mine && mine.tags[0] === "服務暖心", JSON.stringify(mine?.tags));
// 補充一句話
await msg("補充 卡片測試補充語");
fb = (await DBG("fbdump")).items || [];
mine = fb.find(i => i.id === mine?.id);
chk("補充文字已附加", mine?.text === "卡片測試補充語", mine?.text);

// 2. 投票卡：postback 即投；重複投被擋
await pb(`poll|poll-ddtest|o1`);
let polls = await DBG("polldump");
let votes = (polls.votes || []).filter(v => v.pollId === "poll-ddtest" && v.voterId === p.id);
chk("投票已寫回(火鍋)", votes.length === 1 && votes[0].choiceId === "o1");
await pb(`poll|poll-ddtest|o2`);
polls = await DBG("polldump");
votes = (polls.votes || []).filter(v => v.pollId === "poll-ddtest" && v.voterId === p.id);
chk("重複投票被擋(仍1票)", votes.length === 1);

// 3. 文件歸類 postback 防護：路徑不是本人的 → 擋
await pb(`doc|idDoc|roster/p00/steal.jpg`);
const pAfter = (await DBG("person", { nameContains: "測試王試" })).person;
chk("歸檔他人路徑被擋(未寫入)", !(pAfter.idDoc || []).length);

// 4. 未綁定者操作 → 不會寫入
await ev({ type: "postback", replyToken: "f", source: { type: "user", userId: "U-nobody" }, postback: { data: "fb|tag|p00|1" } });
fb = (await DBG("fbdump")).items || [];
chk("未綁定者postback不寫入", !fb.some(i => i.tags?.[0] === "救火英雄" && i.via === "line"));

// 5. 清理（保留測試投票場給張良試卡；清測試人票與回饋）
await DBG("cleanfb", { idContains: p.id });
await DBG("cleanvotes", { idContains: p.id });
await DBG("cleanup", { nameContains: "測試王試", emails: ["u" + p.id.replace(/[^a-z0-9]/gi, "").toLowerCase() + "@ground.local"] });
const fin = await DBG("person", { nameContains: "測試王試" });
chk("測試資料已清(留測試投票場)", !fin.person);

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
