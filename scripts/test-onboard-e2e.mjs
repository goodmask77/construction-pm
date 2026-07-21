// 入職 2.1 端對端測試（打預覽站真 API/真 DB；假人「測試王試」，測完 cleanup）
// 流程：「名字報到」即開帳號發連結 → App 名冊卡填資料(私密上傳) → 簽約 → 審核
import { readFileSync } from "node:fs";
const BASE = readFileSync("/tmp/preview-url.txt", "utf8").trim();
const ENV = readFileSync("/Users/wayz/Documents/Claude/Projects/construction-pm/.env.local", "utf8");
const env = (k) => (ENV.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.replace(/^"|"$/g, "") || "";
const DBG = (op, body = {}) => fetch(`${BASE}/api/onboard?action=debug&t=obtest-x9k2m7`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, ...body }) }).then(r => r.json());
const DUMP = () => fetch(`${BASE}/api/onboard?action=debug&t=obtest-x9k2m7`).then(r => r.json());
const UID = "U-obtest-001", UID2 = "U-obtest-002";
const msg = (text, uid = UID) => fetch(`${BASE}/api/line-webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{ type: "message", replyToken: "faketoken", source: { type: "user", userId: uid }, message: { type: "text", id: "m" + Date.now(), text } }] }) });
const NAME = "測試王試";
let pass = 0, fail = 0;
const chk = (label, ok, extra = "") => { console.log((ok ? "✅" : "❌") + " " + label + (extra ? " → " + extra : "")); ok ? pass++ : fail++; };

// 0. 乾淨起點
await DBG("cleanup", { nameContains: NAME, emails: [] });
let d0 = await DUMP(); const baseCount = d0.rosterCount;

// 1. 「測試王試報到」（名字在前格式）→ 直接開卡+開帳號
await msg(`${NAME}報到`);
let p = (await DBG("person", { nameContains: NAME })).person;
chk("報到即建入職中名冊卡", !!p && p.onboarding === true, JSON.stringify({ id: p?.id, account: p?.account }));
chk("已綁定LINE+帳號對齊本名", p?.lineUserId === UID && p?.account === NAME);
chk("自帶契約簽署token", !!p?.signToken);
const EMAIL = ("u" + String(p.id).replace(/[^a-z0-9]/gi, "").toLowerCase()) + "@ground.local";

// 2. 同一人再報到 → 不重複開卡
await msg(`報到 ${NAME}`);
let d1 = await DUMP();
chk("重複報到不重複建卡", d1.rosterCount === baseCount + 1, `人數 ${d1.rosterCount}`);

// 3. 另一支LINE用同名報到 → 擋（已綁定其他帳號）
await msg(`${NAME}報到`, UID2);
p = (await DBG("person", { nameContains: NAME })).person;
chk("同名已綁定其他LINE被擋", p.lineUserId === UID && d1.rosterCount === (await DUMP()).rosterCount);

// 4. 「登入」補發連結（只驗流程不炸）
await msg("登入");

// 5. 簽署頁：載入含姓名與契約 → 簽名不符擋 → 正確簽署
const page = await fetch(`${BASE}/api/onboard?action=sign&t=${p.signToken}`).then(r => r.text());
chk("簽署頁載入(含姓名+契約)", page.includes(NAME) && page.includes("勞動契約書"));
let r = await fetch(`${BASE}/api/onboard?action=sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: p.signToken, name: "王小明", agree: true }) }).then(r => r.json());
chk("簽名與本名不符被擋", !!r.error, r.error);
r = await fetch(`${BASE}/api/onboard?action=sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: p.signToken, name: NAME, agree: true }) }).then(r => r.json());
chk("簽署成功", r.ok === true);
p = (await DBG("person", { nameContains: NAME })).person;
chk("契約狀態寫回名冊卡", !!p.contractSigned && (p.contractDoc || []).length === 1);
r = await DBG("signurl", { path: `roster/${p.id}/contract.json` });
let cj = null; if (r.url) cj = await fetch(r.url).then(x => x.ok ? x.json() : null).catch(() => null);
chk("契約JSON存私有桶可短效連結讀取", cj?.signName === NAME);

// 6. 以本人身分登入（OTL→session）→ 私密上傳＋docurl 權限
r = await DBG("loginlink", { email: EMAIL });
chk("登入連結產生", !!r.link && r.link.includes("?otl="));
const th = decodeURIComponent((r.link.match(/otl=([^&]+)/) || [])[1] || "");
// 純 REST 驗 OTP（跟 App 的 verifyOtp 同一個端點），不需要整包 supabase 客戶端
const vo = await fetch(env("VITE_SUPABASE_URL") + "/auth/v1/verify", { method: "POST", headers: { apikey: env("VITE_SUPABASE_ANON_KEY"), "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: th }) }).then(x => x.json());
chk("OTL token 換 session 成功", !!vo.access_token, vo.error_description || vo.msg || "");
const jwt = vo.access_token || "";
// 上傳一張假身分證（1x1 png）
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
r = await fetch(`${BASE}/api/onboard?action=upload`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ personId: p.id, fieldKey: "idDoc", filename: "id-front.png", dataUrl: png }) }).then(r => r.json());
chk("本人上傳身分證到私有桶", r.ok === true && r.entry?.private === true, JSON.stringify(r.entry || r));
p = (await DBG("person", { nameContains: NAME })).person;
chk("上傳寫回名冊欄位(入職進度會動)", (p.idDoc || []).length === 1);
// docurl：本人開自己的 → 200；開別人的 → 403
let s1 = await fetch(`${BASE}/api/onboard?action=docurl&path=${encodeURIComponent(p.idDoc[0].path)}`, { headers: { Authorization: `Bearer ${jwt}` } });
chk("docurl 本人可開自己檔案", s1.status === 200);
let s2 = await fetch(`${BASE}/api/onboard?action=docurl&path=${encodeURIComponent("roster/p00/fake.png")}`, { headers: { Authorization: `Bearer ${jwt}` } });
chk("docurl 開別人檔案被擋403", s2.status === 403, "HTTP " + s2.status);
// 未登入審核 → 擋
let s3 = await fetch(`${BASE}/api/onboard?action=approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: p.id }) });
chk("未登入審核被擋", s3.status === 401 || s3.status === 403, "HTTP " + s3.status);
// 一般員工(本人)呼叫審核 → 擋
let s4 = await fetch(`${BASE}/api/onboard?action=approve`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ personId: p.id }) });
chk("非主管審核被擋403", s4.status === 403, "HTTP " + s4.status);

// 7. 核准 → onboarding 移除+到職日
r = await DBG("approveTest", { personId: p.id, dept: "外場" });
chk("核准轉正式", r.ok === true, JSON.stringify(r));
p = (await DBG("person", { nameContains: NAME })).person;
chk("入職中標記移除+到職日/部門寫入", !p.onboarding && !!p.startDate && p.dept === "外場");

// 8. 退回流程（用第二個假人）
await msg("測試王貳報到", UID2);
const p2 = (await DBG("person", { nameContains: "測試王貳" })).person;
chk("第二假人報到成功", !!p2 && p2.onboarding === true);
r = await DBG("rejectTest", { personId: p2.id });
chk("退回執行成功", r.ok === true);
const p2b = (await DBG("person", { nameContains: "測試王貳" })).person;
chk("退回=名冊卡已刪", !p2b);

// 9. 清理
const cl = await DBG("cleanup", { nameContains: "測試王", emails: [EMAIL, ("u" + String(p2?.id || "x").replace(/[^a-z0-9]/gi, "").toLowerCase()) + "@ground.local"] });
const fin = await DUMP();
chk("清理完成回歸原人數", fin.rosterCount === baseCount, `人數 ${fin.rosterCount}（含刪帳號 ${cl.authDeleted}）`);

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
