// 自動更新紀錄：從 git commit 訊息產生 src/changelog.gen.json（依日期分組）。
// 為什麼：更新紀錄頁以前是手打清單，忘了補就「停更」（張良 2026-07-18 抓到）——
// 改成 build 前自動跑這支，commit 訊息（本來就中文寫了改什麼）直接變成保底紀錄；
// 手寫的 CHANGELOG（App.jsx）同日期優先蓋過自動版。Vercel 雲端 build 沒有 .git 會自動略過（用已 commit 的 json）。
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

try {
  const out = execSync('git log --no-merges --date=format:%Y-%m-%d "--pretty=%ad|%s"', { encoding: "utf8" });
  const by = {};
  out.trim().split("\n").forEach((l) => {
    const i = l.indexOf("|");
    if (i < 0) return;
    const d = l.slice(0, i), s = l.slice(i + 1).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !s) return;
    if (/^(wip|merge|revert|chore)\b/i.test(s)) return; // 雜項不進更新紀錄
    (by[d] = by[d] || []).push(s);
  });
  const list = Object.entries(by)
    .map(([date, items]) => ({ date, items }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 90); // 最近 90 個有改動的日子
  writeFileSync(new URL("../src/changelog.gen.json", import.meta.url), JSON.stringify(list, null, 1));
  console.log("✓ changelog.gen.json 產生完成：" + list.length + " 天");
} catch (e) {
  console.log("gen-changelog 略過（無 git 環境，沿用已 commit 的 json）：" + (e?.message || e).split("\n")[0]);
}
