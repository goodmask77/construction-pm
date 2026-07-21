// AI 資料涵蓋檢查（100%資料鐵則的機器強制版）：node scripts/test-ai-coverage.mjs
// 自動掃描 src 裡所有 storage key → 檢查「D哥(line-webhook) / App AI 顧問(loadSpaceAIContext) / 共用摘要(digest)」有沒有涵蓋。
// 新資料域忘記接 AI ＝ 這裡直接紅字失敗（不靠自覺）。真的不該給 AI 的 key 要加進 ALLOW 並寫原因。
import fs from "fs";
import path from "path";

const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

// ── 不需給 AI 的 key（每條都要寫原因；沒理由就不准加）──
const ALLOW = [
  [/^pm_hist_|_v\d$|_v\d_/, "還原點/遷移旗標，非業務資料"],
  [/^pm_vault/, "密碼金庫＝機密，永不進 AI"],
  [/^pm_role$|^pm_roles$|^pm_perm|^pm_users|^pm_login|^pm_accounts$|^pm_guest_perms$|^pm_known_users$/, "帳號權限/登入名單，非業務資料"],
  [/^pm_bot_(chats|confirm|operators|context|aiusage|groups)$/, "bot 內部狀態/用量/群組設定（快照另由 snapshots 進 AI）"],
  [/^pm_(colorder|columns|todo_cats|settings|trash|global_chat)$/, "UI 欄位/分類/設定/垃圾桶/AI對話串本身"],
  [/^pm_(events|journal|plans|seqlogs|worklog)$/, "工序日誌/事件/計畫：工程快照 pm_bot_context 已濃縮進度與問題，逐條屬深查"],
  [/^pm_recon$/, "銀行對帳勾稽記號（連結/忽略），金額本體已在銀行/內帳摘要"],
  [/^pm_mail_(accounts|reviews|scan)$/, "信箱帳號/審閱/掃描內部狀態，郵件摘要已收 rules/log"],
  [/^pm_estimates_an$/, "估價單 AI 解析快取，estimatesText 已收原始估價"],
  [/^pm_group_seen$/, "LINE 群清單，webhook 本來就在用"],
  [/^pm_ui_|_prefs$|_collapsed$/, "純 UI 偏好"],
  [/^pm_advisor|^pm_ai_|^pm_line_notify|^pm_mail_(rules|log)$/, "AI/通知/郵件設定，App 端已以摘要收錄"],
  [/^pm_changelog|^pm_conclusion_drafts/, "更新紀錄/草稿"],
  [/^pm_audit$|^pm_activity/, "操作紀錄，webhook activityText 已收"],
  [/^pm_estimates$/, "工程比價估價單，webhook estimatesText 已收"],
  [/^pm_photos|^pm_files/, "檔案庫二進位，AI 收清單無意義（目錄 fallback 已列）"],
  [/^pm_petty/, "零用金已併入空間快照 totals"],
  [/^kb_kb$|^kb_files/, "夥伴中心資料庫文件，crewText 依需查詢"],
  [/^pm_quests|^pm_polls|^pm_shop|^pm_points|^pm_rank/, "闖關/投票/商城遊戲化資料，非營運決策資料"],
  [/^pm_fb$|^kb_360$|^kb_roster$/, "360/名冊，crewText 已收（kb_roster 在兩邊都有）"],
  [/^pm_sheet|^pm_bank$|^pm_ctbc$/, "財務匯入來源，financeText/sheetText 已收"],
  [/^pm_data$/, "工程主資料，空間快照 pm_bot_context 已濃縮"],
  [/^pm_pos_d_$/, "POS 明細按月 key，兩邊都以當月 key 讀"],
  [/^shift_(sched_|sched$)/, "班表逐週檔，loadShiftText/App 排班段已按週讀"],
];

// ── 掃描 src 收集 key ──
const srcFiles = walk("src").filter((f) => /\.(jsx?|mjs)$/.test(f));
const keys = new Set();
const add = (k) => { if (k && k.length > 3) keys.add(k.replace(/^sp_[a-z]+_/, "")); };
for (const f of srcFiles) {
  const s = read(f);
  for (const m of s.matchAll(/K\(\s*["']([a-z0-9_]+)["']/g)) add(m[1]);
  for (const m of s.matchAll(/storage\.(?:get|set|delete)\(\s*(?:K\()?["']([a-z0-9_]+)["']/g)) add(m[1]);
  for (const m of s.matchAll(/getSharedPrefix\(\s*(?:K\()?["']([a-z0-9_]+)["']/g)) add(m[1]);
  for (const m of s.matchAll(/["'](sp_[a-z]+_[a-z0-9_]+)["']/g)) add(m[1]);
}

// ── AI 載入端文本（涵蓋=key 字串出現在其中任一）──
const webhook = read("api/line-webhook.js");
const digest = read("src/supply/digest.js");
const app = read("src/App.jsx");
const ctxStart = app.indexOf("async function loadSpaceAIContext");
const ctxEnd = app.indexOf("\n}", ctxStart);
const appLoader = app.slice(ctxStart, ctxEnd);
const loaders = webhook + "\n" + digest + "\n" + appLoader;

let pass = 0; const misses = [];
for (const k of [...keys].sort()) {
  const allowed = ALLOW.find(([re]) => re.test(k));
  if (allowed) { pass++; continue; }
  if (loaders.includes(k)) { pass++; continue; }
  misses.push(k);
}
if (misses.length) {
  console.log("✗ 下列資料域「沒有」接進 AI（D哥/App 顧問都讀不到），違反 100% 資料鐵則：");
  misses.forEach((k) => console.log("   - " + k));
  console.log("→ 接法：供應鏈類加進 src/supply/digest.js；其他域接 api/line-webhook.js 與 App.jsx loadSpaceAIContext 兩邊。真的不該給 AI 就加 ALLOW 並寫原因。");
}
console.log(`結果：${pass} 通過 / ${misses.length} 失敗（共掃 ${keys.size} 個資料域）`);
process.exit(misses.length ? 1 : 0);
