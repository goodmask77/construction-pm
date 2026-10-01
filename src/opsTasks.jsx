// /prep × 主App 任務中心整併（張良 2026-10-02 拍板）：同一份 TaskCenter 元件、資料＝團隊工作空間（sp_team_）
// 無登入：儲存層走 supa.js OPS 代理模式（window.__OPS_PROXY__ → mail-sync?kvproxy，伺服器端 permWho(task) 守門留痕）
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TaskCenter from "./tasks/TaskCenter.jsx";
import { installStorageShim } from "./supa.js";

installStorageShim();
const K = (k) => "sp_team_" + k; // 寫死團隊空間（與主 App 任務中心同一份資料，雙向同步）

function OpsTasks() {
  const [cats, setCats] = useState(null);
  const [meName, setMeName] = useState("");
  useEffect(() => { (async () => {
    try { const v = await window.storage.get(K("pm_data"), true); setCats(v && v.value ? JSON.parse(v.value) : []); } catch (_) { setCats([]); }
    try { const o = window.__OPS_PROXY__ || {}; const r = await fetch("/api/mail-sync?whoami=" + encodeURIComponent(o.key) + "&r=" + Date.now() + (o.token ? "&me=" + encodeURIComponent(o.token) : "")); const j = await r.json(); if (j && j.me) setMeName(j.me.name); } catch (_) {}
  })(); }, []);
  const saveCats = (up) => setCats(prev => { const next = up(prev || []); window.storage.set(K("pm_data"), JSON.stringify(next), true).catch(() => {}); return next; });
  const confirm = async (msg) => window.confirm(typeof msg === "string" ? msg : "確定？");
  if (cats === null) return <div style={{ padding: 40, color: "#5a6b85", fontSize: 15 }}>任務載入中…</div>;
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "10px 14px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 2px 10px" }}>
        <a href="/prep" style={{ textDecoration: "none", fontWeight: 800, fontSize: 14, color: "#1266C8", border: "1.5px solid #C9DCF2", borderRadius: 10, padding: "7px 14px", background: "#fff" }}>← 回看板</a>
        <div style={{ fontWeight: 900, fontSize: 17, color: "#16263D" }}>任務中心 <span style={{ fontSize: 12, color: "#8395AC", fontWeight: 400 }}>與主 App 團隊工作空間完全同步</span></div>
      </div>
      <TaskCenter K={K} confirm={confirm} canEdit={true} cats={cats || []} onLog={() => {}} userName={meName}
        waitHint="例：等對方回覆、等報價、等主管確認"
        onAddCat={(name) => saveCats(prev => [...prev, { id: "cat-" + Date.now(), order: prev.length, name, budget: 0, status: "pending", items: [] }])}
        onRenameCat={(id, name) => saveCats(prev => prev.map(c => c.id === id ? { ...c, name } : c))}
        onMoveCat={(fromId, { afterId, beforeId, col, freeze } = {}) => saveCats(prev => { // 與主 App 同邏輯（拖大項＋tcol 欄記憶＋freeze）
          let base = prev;
          if (freeze) base = prev.map(c => (c.tcol === undefined || c.tcol === null) && freeze[c.id] !== undefined ? { ...c, tcol: freeze[c.id] } : c);
          const arr = [...base].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const fi = arr.findIndex(c => c.id === fromId); if (fi < 0) return prev;
          const [m] = arr.splice(fi, 1);
          const m2 = col === undefined ? m : { ...m, tcol: col };
          if (beforeId) { const ti = arr.findIndex(c => c.id === beforeId); arr.splice(ti < 0 ? arr.length : ti, 0, m2); }
          else if (afterId) { const ti = arr.findIndex(c => c.id === afterId); arr.splice(ti < 0 ? arr.length : ti + 1, 0, m2); }
          else arr.push(m2);
          return arr.map((c, i) => ({ ...c, order: i }));
        })}
        onSetCatColor={(id, color) => saveCats(prev => prev.map(c => c.id === id ? { ...c, color } : c))} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<OpsTasks />);
