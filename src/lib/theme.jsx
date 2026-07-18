// ── 設計 tokens 共用層（由 App.jsx 原樣搬出，2026-07-18 拆檔第一刀；行為/數值零改變）──
import { useState, useEffect } from "react";

// 頂欄（ground-pack 系：米色 + 粗黑底線；深色頂欄已退場 2026-07-16）
export const HEAD_BG = "#f4efe5", HEAD_LINE = "#1d1a15", HEAD_SUB = "#5a5247", HEAD_CHIP = "#fbf8f1";

// ── DESIGN TOKENS（2026-07-16 定案：ground-pack 系 — 米色紙底 + 硬邊框 + mono 大數字 + 磚紅節制）──
// 數值直接萃取自 ground-pack.vercel.app（張良自用且認可的成品）。磚紅只用四處：logo/段落徽章/主要動作/當前tab。
export const BRAND   = "#c5281e"; // GROUN:D 商標紅
export const ACCENT  = "#c4582a"; // 磚紅 — 唯一 UI 強調色（主按鈕 / 當前 tab / 段落徽章）
export const PRIMARY = "#1d1a15"; // 墨黑 — 深色按鈕 / 當前 tab
export const BG      = "#f4efe5"; // 米色紙底（paper）
export const SURFACE = "#fbf8f1"; // 卡片表面（card）
export const BORDER  = "#d9cfbd"; // 淺邊框（line）
export const LINE2   = "#c8bca6"; // 硬邊框（1.5px 用，卡片/按鈕的「看得見的框」）
export const TEXT    = "#1d1a15"; // 主文字（ink）
export const SUB     = "#5a5247"; // 次文字
export const ACCENT_SOFT = "#fbeee6"; // 磚紅淡底
export const DARKCHIP = "#33281E"; // 深棕 chip（分類標籤）
export const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"; // 數字專用等寬字
export const DISP = "'Montserrat','Noto Sans TC',-apple-system,system-ui,sans-serif"; // 標題展示字（品牌字 Montserrat SemiBold）
// 語意色（gpack 調）：綠=完成/已付、琥珀=進行/部分、藍=進行中、灰=待開工、紅=危險
export const SEM = { green: "#3f7d4e", amber: "#c98a14", blue: "#3a6ea5", grey: "#9b9384", red: "#b3261e" };
// 段落頭：紅底小徽章 + 大粗標題（gpack 的招牌識別元件）
export function SecHead({ tag, title, right, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, ...style }}>
      <span style={{ background: ACCENT, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px", letterSpacing: 1, flexShrink: 0 }}>{tag}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color: TEXT, fontFamily: DISP, letterSpacing: -0.3 }}>{title}</span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}
export const GOLD    = "#C13A22"; // Logo 用磚紅

// ── RWD：偵測手機寬度（< 768px）──────────────────────────────────────────────
export const MOBILE_BP = 768;
export function useIsMobile(bp = MOBILE_BP) {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}
