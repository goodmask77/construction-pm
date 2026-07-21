// 入職 2.0 端對端測試（打預覽站真 API/真 DB；用「測試王試」假人，測完 cleanup）
import { readFileSync } from "node:fs";
const BASE = readFileSync("/tmp/preview-url.txt", "utf8").trim();
const DBG = (op, body = {}) => fetch(`${BASE}/api/onboard?action=debug&t=obtest-x9k2m7`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, ...body }) }).then(r => r.json());
const STATE = () => fetch(`${BASE}/api/onboard?action=debug&t=obtest-x9k2m7`).then(r => r.json());
const UID = "U-obtest-001";
const msg = (text) => fetch(`${BASE}/api/line-webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{ type: "message", replyToken: "faketoken", source: { type: "user", userId: UID }, message: { type: "text", id: "m" + Date.now(), text } }] }) }).then(r => r.status);
const NAME = "測試王試";
let pass = 0, fail = 0;
const chk = (label, ok, extra = "") => { console.log((ok ? "✅" : "❌") + " " + label + (extra ? " → " + extra : "")); ok ? pass++ : fail++; };

// 0. 乾淨起點（先取消殘留流程再清資料）
await msg("取消申請");
await DBG("cleanup", { nameContains: "測試王試", emails: ["0912000111@ground.local"] });

// 1. 邀請碼錯誤 → 不建立狀態
await msg("入職 WRONGCODE");
let s = await STATE();
chk("邀請碼錯誤不進入流程", !s.states[UID]);

// 2. 正確邀請碼 → 建立申請狀態
await msg("入職 GROUND66");
s = await STATE();
chk("正確邀請碼開始申請", s.states[UID]?.mode === "apply" && s.states[UID]?.step === 0);
const appId = s.states[UID]?.appId;

// 3. 逐步填資料（含格式錯誤重試）
await msg(NAME);                       // name
await msg("無");                       // nick
await msg("0912-000");                 // phone 格式錯 → 停在原步
s = await STATE(); chk("手機格式錯誤不前進", s.states[UID]?.step === 2);
await msg("0912000111");               // phone
await msg("2000-01-01");               // bday（成年→跳過家長同意書）
await msg("a123456789");               // idNo（小寫→自動轉大寫）
await msg("合作金庫 三重分行");          // bankBranch
await msg("待補");                      // bankAcct
s = await STATE();
chk("七項文字資料收齊", s.states[UID]?.step === 7, JSON.stringify({ idNo: s.states[UID]?.data?.idNo, step: s.states[UID]?.step }));
chk("身分證自動轉大寫", s.states[UID]?.data?.idNo === "A123456789");

// 4. 檔案步驟（LINE 圖片下載測不了 → 直接 patch 模擬已傳 3 張）＋ 給簽署 token
await DBG("patchState", { uid: UID, patch: { step: 10, files: { idFront: { label: "身分證正面", path: `onboard/${appId}/idFront.jpg` }, idBack: { label: "身分證反面", path: `onboard/${appId}/idBack.jpg` }, bankbook: { label: "存摺封面", path: `onboard/${appId}/bankbook.jpg` } }, signToken: "sg-obtest-777" } });

// 5. 簽署頁 GET（要出現姓名與契約）
const page = await fetch(`${BASE}/api/onboard?action=sign&t=sg-obtest-777`).then(r => r.text());
chk("簽署頁載入(含姓名+契約)", page.includes(NAME) && page.includes("勞動契約書"));

// 6. 簽名不符 → 擋下
let r = await fetch(`${BASE}/api/onboard?action=sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: "sg-obtest-777", name: "王小明", agree: true }) }).then(r => r.json());
chk("簽名與本名不符被擋", !!r.error, r.error);

// 7. 正確簽署 → 申請落檔 pending（會通知操作者=老闆，屬預期）
r = await fetch(`${BASE}/api/onboard?action=sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: "sg-obtest-777", name: NAME, agree: true }) }).then(r => r.json());
chk("簽署成功", r.ok === true);
s = await STATE();
const app = (s.apps || []).find(a => a.id === appId);
chk("申請進待審核", app?.status === "pending");

// 8. 契約檔真的寫進私有桶（簽名短效連結能開）
r = await DBG("signurl", { path: `onboard/${appId}/contract.json` });
let contractOk = false;
if (r.url) { const c = await fetch(r.url).then(x => x.ok ? x.json() : null).catch(() => null); contractOk = c?.signName === NAME; }
chk("契約JSON已存私有桶且可用短效連結讀取", contractOk);

// 9. 重複簽署 → 已完成頁
const page2 = await fetch(`${BASE}/api/onboard?action=sign&t=sg-obtest-777`).then(r => r.text());
chk("重複開簽署連結顯示已完成", page2.includes("已完成簽署"));

// 10. 未帶管理員登入 → 審核 API 拒絕
r = await fetch(`${BASE}/api/onboard?action=pending`).then(r => r.status);
chk("待審清單未登入被擋(401/403)", r === 401 || r === 403, "HTTP " + r);

// 11. 核准（核心邏輯）→ 建名冊＋開帳號
r = await DBG("approveTest", { appId, dept: "測試部" });
chk("核准執行成功", r.ok === true, JSON.stringify(r));
s = await STATE();
const rp = (s.rosterTail || []).find(p => p.name === NAME);
chk("名冊已建檔(含account+LINE綁定)", !!rp && !!rp.account && rp.lineUserId === true, JSON.stringify(rp));

// 12. 一次性登入連結能產生
r = await DBG("loginlink", { email: "0912000111@ground.local" });
chk("登入連結產生(otl)", !!r.link && r.link.includes("?otl="), (r.link || "").slice(0, 60) + "…");
if (r.link) console.log("OTL_LINK=" + r.link);

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
