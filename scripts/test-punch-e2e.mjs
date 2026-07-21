// 打卡系統 P1 E2E（預覽站真API/DB；假人「測試王試」，測完清乾淨）
import { readFileSync } from "node:fs";
const BASE = readFileSync("/tmp/preview-url.txt", "utf8").trim();
const ENV = readFileSync("/Users/wayz/Documents/Claude/Projects/construction-pm/.env.local", "utf8");
const env = (k) => (ENV.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.replace(/^"|"$/g, "") || "";
const DBG = (op, body = {}) => fetch(`${BASE}/api/onboard?action=debug&t=obtest-x9k2m7`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, ...body }) }).then(r => r.json());
const UID = "U-obtest-001";
const msg = (text) => fetch(`${BASE}/api/line-webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{ type: "message", replyToken: "f", source: { type: "user", userId: UID }, message: { type: "text", id: "m" + Date.now(), text } }] }) });
let pass = 0, fail = 0;
const chk = (l, ok, x = "") => { console.log((ok ? "✅" : "❌") + " " + l + (x ? " → " + x : "")); ok ? pass++ : fail++; };

await DBG("cleanup", { nameContains: "測試王試", emails: [] });
await msg("測試王試報到");
const p = (await DBG("person", { nameContains: "測試王試" })).person;
const EMAIL = ("u" + String(p.id).replace(/[^a-z0-9]/gi, "").toLowerCase()) + "@ground.local";

// 1. LINE 備援打卡：上班/下班（強制判向、未驗證）
await msg("上班");
await msg("下班");
let d = await DBG("punchdump");
let mine = d.recs.filter(r => r.personId === p.id);
chk("LINE上班/下班各一筆", mine.length === 2 && mine[0].dir === "in" && mine[1].dir === "out", JSON.stringify(mine.map(r => r.dir)));
chk("LINE打卡=未驗證待審", mine.every(r => r.src === "line" && r.verified === false));

// 2. 掃碼打卡：取得本人 JWT → 有效token打卡（自動判向→上班）
const link = (await DBG("loginlink", { email: EMAIL })).link;
const th = decodeURIComponent((link.match(/otl=([^&]+)/) || [])[1] || "");
const vo = await fetch(env("VITE_SUPABASE_URL") + "/auth/v1/verify", { method: "POST", headers: { apikey: env("VITE_SUPABASE_ANON_KEY"), "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: th }) }).then(x => x.json());
const jwt = vo.access_token || "";
chk("取得本人session", !!jwt);
const tok = (await DBG("punchtoken")).token;
let r = await fetch(`${BASE}/api/punch?action=punch`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ token: tok }) }).then(x => x.json());
chk("掃碼打卡成功且自動判向=上班", r.ok === true && r.dir === "in", JSON.stringify(r));
// 3. 過期 token 被擋
const oldTok = (await DBG("punchtoken", { offsetMs: -120000 })).token;
r = await fetch(`${BASE}/api/punch?action=punch`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ token: oldTok }) }).then(x => x.json());
chk("過期QR被擋", !!r.error, r.error);
// 4. 亂改 token 簽章被擋
r = await fetch(`${BASE}/api/punch?action=punch`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ token: Date.now() + ".deadbeef1234567890ab" }) }).then(x => x.json());
chk("偽造簽章被擋", !!r.error);
// 5. 未登入打卡被擋
let s = await fetch(`${BASE}/api/punch?action=punch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tok }) });
chk("未登入被擋401", s.status === 401, "HTTP " + s.status);
// 6. 5分鐘內修正判向
r = await fetch(`${BASE}/api/punch?action=fix`, { method: "POST", headers: { Authorization: `Bearer ${jwt}` } }).then(x => x.json());
chk("5分鐘內改判向成功", r.ok === true && r.dir === "out", JSON.stringify(r));
// 7. 一般夥伴不能開打卡站/審核
s = await fetch(`${BASE}/api/punch?action=token`, { headers: { Authorization: `Bearer ${jwt}` } });
chk("非主管開站被擋403", s.status === 403, "HTTP " + s.status);
mine = (await DBG("punchdump")).recs.filter(r2 => r2.personId === p.id && r2.src === "line");
s = await fetch(`${BASE}/api/punch?action=verify`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ recordId: mine[0].key, ok: true }) });
chk("非主管審核被擋403", s.status === 403, "HTTP " + s.status);

// 8. 清理
const c1 = await DBG("punchclean", { personId: p.id });
await DBG("cleanup", { nameContains: "測試王試", emails: [EMAIL] });
chk("打卡與測試人已清", c1.removed >= 3, `清${c1.removed}筆`);

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
