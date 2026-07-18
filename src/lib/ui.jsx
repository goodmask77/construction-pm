// ── 共用 UI 原子元件（由 App.jsx 原樣搬出，2026-07-18 拆檔第二刀；行為零改變）────
// SidePanel（側欄/手機底部彈窗）、ImportElapsed（秒數計時）、inputStyle（表單欄樣式）。
import { useState, useEffect, useRef } from "react";
import { useIsMobile } from "./theme.jsx";

export function ImportElapsed({ startedAt }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  return <span style={{ fontWeight: 400, color: "#9b9384" }}>（{s} 秒）</span>;
}
// ── SIDE PANEL ─────────────────────────────────────────────────────────────────
export function SidePanel({ onClose, children, wide }) {
  const isMobile = useIsMobile();
  const [dragY, setDragY] = useState(0);
  const startY = useRef(null);

  // 手機：從底部彈出的 bottom sheet（拖曳柄可下拉關閉）
  if (isMobile) {
    const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
    const onTouchMove = (e) => { if (startY.current != null) { const dy = e.touches[0].clientY - startY.current; if (dy > 0) setDragY(dy); } };
    const onTouchEnd = () => { if (dragY > 90) onClose(); else setDragY(0); startY.current = null; };
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 400, display: "flex", alignItems: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ width: "100%", maxHeight: "90vh", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", display: "flex", flexDirection: "column", animation: "sheetUp .22s ease", transform: dragY ? `translateY(${dragY}px)` : "none", transition: dragY ? "none" : "transform .2s", paddingBottom: "env(safe-area-inset-bottom)", boxShadow: "0 -8px 30px rgba(0,0,0,0.25)" }}>
          <div onClick={onClose} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} title="下拉或點此關閉" style={{ padding: "11px 0 7px", display: "flex", justifyContent: "center", cursor: "pointer", position: "sticky", top: 0, background: "#fff", zIndex: 10, touchAction: "none", borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
            <div style={{ width: 42, height: 5, borderRadius: 3, background: "#d9cfbd" }} />
          </div>
          <div style={{ padding: "2px 16px 20px", flex: 1 }}>{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 400, display: "flex", justifyContent: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: wide ? "min(600px,100vw)" : "min(440px,100vw)", background: "#fbf8f1", height: "100vh", overflowY: "auto", borderLeft: "1px solid #d9cfbd", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #d9cfbd", display: "flex", alignItems: "center", justifyContent: "flex-end", position: "sticky", top: 0, background: "#fbf8f1", zIndex: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#4A4234", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 16, flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}
export const inputStyle = {
  background: "#e6ddc9",
  border: "1px solid #d9cfbd",
  borderRadius: 8,
  color: "#211C15",
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
  outline: "none",
  fontFamily: "'Noto Sans TC', sans-serif",
};