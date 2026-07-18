// ── 工程狀態模型（STATUS_MAP／大項⇄細項狀態連動）─────────────────────────────
// 由 App.jsx 原樣搬出（2026-07-18 拆檔第二刀；行為零改變）。App 與工程專案視圖共用。
export const STATUS_MAP = {
  pending:     { label: "待開工", color: "#6F6656" },
  inprogress:  { label: "進行中", color: "#3E72A8" },
  done:        { label: "完工",   color: "#3C8C3C" },
  issue:       { label: "有問題", color: "#C0392B" },
  hold:        { label: "暫停",   color: "#C2872E" },
};

// ── 大項⇄細項狀態連動 ──
// 大項標完工 → 底下所有細項一起完工
export const markCatDone = (cat) => ({ ...cat, status: "done", items: (cat.items || []).map(it => ({ ...it, status: "done", done: true })) });
// 依細項回算大項狀態：全完工→完工；大項原為完工但細項未全完工→降回進行中/待開工；其餘保留(尊重手動標的進行中/有問題/暫停)
export const syncCatStatus = (cat) => {
  const items = cat.items || [];
  if (!items.length) return cat;
  const allDone = items.every(it => it.done || it.status === "done");
  if (allDone) return cat.status === "done" ? cat : { ...cat, status: "done" };
  if (cat.status === "done") { const active = items.some(it => it.done || it.status === "done" || it.status === "inprogress"); return { ...cat, status: active ? "inprogress" : "pending" }; }
  return cat;
};