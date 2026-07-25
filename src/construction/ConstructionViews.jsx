// ── 工程專案空間視圖：儀表板/問題集/比價/檔案庫/零用金（總覽表在 ./Overview.jsx）──
// 由 App.jsx 原樣搬出（2026-07-18 拆檔第二刀；行為/畫面零改變）。
import { useState, useEffect, useRef, Fragment } from "react";
import { uploadPhoto, deletePhotoFile } from "../supa.js";
import { fmt, catEstAfter, catPaid, isFundingCat } from "../lib/cost.js";
import { ACCENT, PRIMARY, SURFACE, BORDER, TEXT, SUB, ACCENT_SOFT, SecHead, useIsMobile } from "../lib/theme.jsx"; // useIsMobile：張良 2026-07-26 手機版全面體檢
import { CURRENT_SPACE, K, showMoney, maskAccount, L } from "../lib/runtime.js";
import { STATUS_MAP } from "../lib/status.js";
import { callAI, buildAdvisorSystem } from "../lib/ai.js";
import { ImportElapsed, inputStyle } from "../lib/ui.jsx";
import ReceiptUploader from "../lib/ReceiptUploader.jsx";

// 總覽表區塊拆在同資料夾 Overview.jsx，對 App 保持單一入口（從本檔 re-export）
export { COLS, OverviewTable, StatusBadge } from "./Overview.jsx";

// ── 問題集 / 待辦（資料來自 LINE Bot 寫入的 pm_issues）────────────────────────
const DEFAULT_TODO_CATS = ["工地問題", "採購交期", "待定案", "其他"];
const CAT_PALETTE = ["#C2872E", "#2E6FB0", "#8B5CF6", "#0E9F6E", "#b3261e", "#D97706", "#0891B2", "#6F6656"];
const colorForCat = (name, cats = []) => {
  const i = cats.indexOf(name);
  if (i >= 0) return CAT_PALETTE[i % CAT_PALETTE.length];
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
};
const catOf = (it) => it.category || (it.source === "todo" ? "其他" : "工地問題");
const FREQ_PRESETS = [["自動", 0], ["每天1次", 24], ["一天2次", 12], ["每2天", 48], ["每3天", 72]];
// ToDo 分頁的暖光閃動樣式（注入一次）
if (typeof document !== "undefined" && !document.getElementById("todo-glow-style")) {
  const s = document.createElement("style");
  s.id = "todo-glow-style";
  s.textContent = "@keyframes todoGlow{0%,100%{box-shadow:0 0 2px rgba(245,158,11,.35)}50%{box-shadow:0 0 14px 2px rgba(245,158,11,.85)}}.todo-glow{animation:todoGlow 1.5s ease-in-out infinite;border-color:#F59E0B !important;}@keyframes blackGlow{0%,100%{box-shadow:0 0 3px rgba(17,17,17,.45)}50%{box-shadow:0 0 16px 3px rgba(17,17,17,.9)}}.black-glow{animation:blackGlow 1.6s ease-in-out infinite;}";
  document.head.appendChild(s);
}
const freqLabel = (h) => { if (!h) return "自動（越近越密）"; const p = FREQ_PRESETS.find(([, v]) => v === h); if (p) return p[0]; if (h % 24 === 0) return `每${h / 24}天1次`; return `每${h}小時`; };
const twDateStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
const dueInfo = (due) => {
  if (!due) return null;
  const today = twDateStr();
  const d = Math.round((Date.parse(due + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  if (d < 0) return { txt: `逾期 ${-d} 天`, color: "#b3261e", bold: true };
  if (d === 0) return { txt: "今天到期", color: "#b3261e", bold: true };
  if (d <= 3) return { txt: `剩 ${d} 天`, color: "#C2872E", bold: true };
  return { txt: `${due}`, color: SUB, bold: false };
};

export function IssuesView({ canEdit, requireLogin, confirm, onLog }) {
  const [issues, setIssues] = useState(null);
  const [cats, setCats] = useState(DEFAULT_TODO_CATS);
  const [filter, setFilter] = useState("open");
  const [catFilter, setCatFilter] = useState("全部");
  const [lightbox, setLightbox] = useState(null);
  const [editId, setEditId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [cfd, setCfd] = useState(1); // 自訂頻率：每 cfd 天
  const [cft, setCft] = useState(1); // …提醒 cft 次
  const [nd, setNd] = useState({ desc: "", category: "其他", due: "", track: true });
  const isMobile = useIsMobile(); // 手機(<640px)排版切換（張良 2026-07-26 手機版全面體檢）

  useEffect(() => {
    // 保險：避免 Supabase 讀取卡住造成永久「載入中…」，最多 8 秒就先顯示空清單
    const safety = setTimeout(() => setIssues(prev => prev === null ? [] : prev), 8000);
    const withTimeout = (p, ms = 7000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
    (async () => {
      let iss = [];
      try { const r = await withTimeout(window.storage.get(K("pm_issues"), true)); iss = r && r.value ? JSON.parse(r.value) : []; } catch (_) {}
      setIssues(iss);
      let list = null;
      try { const c = await withTimeout(window.storage.get(K("pm_todo_cats"), true)); const arr = c && c.value ? JSON.parse(c.value) : null; if (Array.isArray(arr) && arr.length) list = arr; } catch (_) {}
      const base = list || DEFAULT_TODO_CATS;
      // 自我修復：項目用到、但分類清單沒有的分類（例如 D哥 從 LINE 新增的「未來想法」）→ 自動補進清單
      const orphans = [...new Set(iss.map(i => i.category).filter(c => c && !base.includes(c)))];
      const merged = orphans.length ? [...base, ...orphans] : base;
      setCats(merged);
      if (orphans.length) { try { await window.storage.set(K("pm_todo_cats"), JSON.stringify(merged), true); } catch (_) {} }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);

  const save = async (list) => {
    setIssues(list);
    try { await window.storage.set(K("pm_issues"), JSON.stringify(list), true); } catch (_) {}
  };
  const saveCats = async (list) => {
    setCats(list);
    try { await window.storage.set(K("pm_todo_cats"), JSON.stringify(list), true); } catch (_) {}
  };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  const patch = (id, fields) => { if (!guard()) return; save(issues.map(i => i.id === id ? { ...i, ...fields } : i)); };
  const toggleDone = async (it) => {
    if (!guard()) return;
    if (it.status === "done") { onLog?.("編輯", `重啟待辦「${(it.desc||"").slice(0,20)}」`); patch(it.id, { status: "open" }); return; }
    const ans = window.prompt("這件的結論／答案是？（可留空，直接標完成；按取消則不完成）", it.answer || "");
    if (ans === null) return; // 取消 → 不標完成
    onLog?.("編輯", `完成待辦「${(it.desc||"").slice(0,20)}」`);
    patch(it.id, { status: "done", track: false, answer: ans.trim() || it.answer || "" });
  };
  const del = async (id) => { if (!guard()) return; const t = (issues.find(i=>i.id===id)?.desc||"").slice(0,20); if (await confirm("刪除這筆事項？")) { onLog?.("刪除", `刪除待辦「${t}」`); save(issues.filter(i => i.id !== id)); } };
  const addNew = () => {
    if (!guard()) return;
    const desc = nd.desc.trim(); if (!desc) return;
    const entry = { id: "is-" + Math.random().toString(36).slice(2, 8), desc, category: nd.category, due: nd.due, remindEnd: "", track: !!nd.track, remindEvery: 0, status: "open", source: "todo", by: "App", ts: new Date().toISOString(), nudges: 0, answer: "", catName: "", catId: "", photoUrl: "" };
    onLog?.("新增", `新增待辦「${desc.slice(0,20)}」`);
    save([entry, ...issues]);
    setNd({ desc: "", category: cats[0] || "其他", due: "", track: true }); setShowAdd(false);
  };
  // 分類管理
  const addCat = () => { if (!guard()) return; const n = newCat.trim(); if (!n || cats.includes(n)) { setNewCat(""); return; } onLog?.("新增", `新增待辦分類「${n}」`); saveCats([...cats, n]); setNewCat(""); };
  const renameCat = (old, val) => { const n = val.trim(); if (!n || (cats.includes(n) && n !== old)) return; onLog?.("編輯", `待辦分類改名「${old}」→「${n}」`); saveCats(cats.map(c => c === old ? n : c)); save(issues.map(i => catOf(i) === old ? { ...i, category: n } : i)); };
  const delCat = async (c) => { if (!guard()) return; const used = issues.filter(i => catOf(i) === c).length; if (used && !(await confirm(`「${c}」還有 ${used} 筆事項，刪除分類後它們會歸到「其他」。確定刪除？`))) return; onLog?.("刪除", `刪除待辦分類「${c}」`); saveCats(cats.filter(x => x !== c)); if (used) save(issues.map(i => catOf(i) === c ? { ...i, category: "其他" } : i)); if (catFilter === c) setCatFilter("全部"); };

  if (issues === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const open = issues.filter(i => i.status !== "done");
  let shown = filter === "open" ? open : issues;
  if (catFilter !== "全部") shown = shown.filter(i => catOf(i) === catFilter);
  // 待處理：依交期排序（有交期且早的在前）
  shown = [...shown].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (b.status === "done" && a.status !== "done") return -1;
    const ad = a.due || "9999", bd = b.due || "9999";
    return ad.localeCompare(bd);
  });
  const inp = { padding: "6px 8px", borderRadius: 7, border: `1px solid ${BORDER}`, fontSize: 13, background: "#fff", color: TEXT };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>⚠️ 事項 / 待辦 / 問題</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{open.length} 項待處理</div>
        <button onClick={() => setShowAdd(s => !s)} style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${ACCENT}`, fontSize: 12.5, cursor: "pointer", background: showAdd ? ACCENT : "transparent", color: showAdd ? "#fff" : ACCENT, fontWeight: 600 }}>＋ 新增事項</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[["open", "待處理"], ["all", "全部"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${BORDER}`, fontSize: 12.5, cursor: "pointer", background: filter === k ? ACCENT : "transparent", color: filter === k ? "#fff" : SUB, fontWeight: filter === k ? 700 : 500 }}>{l}</button>
          ))}
        </div>
      </div>

      {/* 分類篩選 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {["全部", ...cats].map(c => {
          const on = catFilter === c; const col = c === "全部" ? TEXT : colorForCat(c, cats);
          return <button key={c} onClick={() => setCatFilter(c)} style={{ padding: "4px 12px", borderRadius: 20, border: `1px solid ${on ? col : BORDER}`, fontSize: 12, cursor: "pointer", background: on ? col : "transparent", color: on ? "#fff" : SUB, fontWeight: on ? 700 : 500 }}>{c}</button>;
        })}
        <button onClick={() => setShowCatMgr(s => !s)} title="編輯分類" style={{ padding: "4px 10px", borderRadius: 20, border: `1px dashed ${BORDER}`, fontSize: 12, cursor: "pointer", background: showCatMgr ? SURFACE : "transparent", color: SUB }}>✎ 分類</button>
      </div>

      {/* 分類管理 */}
      {showCatMgr && (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, color: SUB, marginBottom: 10 }}>編輯分類：改名直接打字、按 🗑 刪除（底下可新增）。改名/刪除會同步更新已記事項。</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cats.map(c => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorForCat(c, cats), flexShrink: 0 }} />
                {/* 張良 2026-07-26 手機版全面體檢：手機時輸入框吃滿剩餘寬度（minWidth 0 才縮得下去），桌機維持 220px */}
                <input defaultValue={c} onBlur={e => renameCat(c, e.target.value)} style={{ ...inp, flex: isMobile ? "1 1 auto" : "0 1 220px", ...(isMobile ? { minWidth: 0 } : {}) }} />
                <span style={{ fontSize: 11.5, color: SUB }}>{issues.filter(i => catOf(i) === c).length} 筆</span>
                <button onClick={() => delCat(c)} style={{ padding: "4px 9px", borderRadius: 7, border: `1px solid ${BORDER}`, background: "transparent", color: "#b3261e", fontSize: 12, cursor: "pointer" }}>🗑</button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <input value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === "Enter" && addCat()} placeholder="新增分類名稱…" style={{ ...inp, flex: isMobile ? "1 1 auto" : "0 1 220px", ...(isMobile ? { minWidth: 0 } : {}) }} />
              <button onClick={addCat} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: ACCENT, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>＋ 新增分類</button>
            </div>
          </div>
        </div>
      )}

      {/* 新增表單 */}
      {showAdd && (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={nd.desc} onChange={e => setNd({ ...nd, desc: e.target.value })} placeholder="要記什麼？例：訂製家具交期確認" style={{ ...inp, flex: "1 1 260px" }} />
          <select value={nd.category} onChange={e => setNd({ ...nd, category: e.target.value })} style={inp}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <label style={{ fontSize: 12.5, color: SUB }}>交期 <input type="date" value={nd.due} onChange={e => setNd({ ...nd, due: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={nd.track} onChange={e => setNd({ ...nd, track: e.target.checked })} />🔔 盯到我回</label>
          <button onClick={addNew} style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: ACCENT, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>記下</button>
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          {filter === "open" ? "🎉 目前沒有待處理的事項" : "尚無記錄"}
          <div style={{ fontSize: 12, marginTop: 8 }}>在 LINE 跟 DD 說「幫我記…」「追一下…」，或按上面「＋ 新增事項」</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                {["事項", "分類", "交期", "狀態", "操作"].map((h, i) => (
                  <th key={h} style={{ textAlign: i >= 3 ? "center" : "left", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: SUB, borderBottom: `1.5px solid ${BORDER}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(it => {
                const cat = catOf(it); const di = it.status !== "done" ? dueInfo(it.due) : null; const editing = editId === it.id;
                const tdS = { padding: "9px 10px", fontSize: 13, color: TEXT, borderBottom: `1px solid ${BORDER}`, verticalAlign: "top" };
                const done = it.status === "done";
                return (
                  <Fragment key={it.id}>
                    <tr style={{ opacity: done ? 0.55 : 1 }}>
                      <td style={tdS}>
                        <div style={{ display: "flex", gap: 8 }}>
                          {it.photoUrl && <img src={it.photoUrl} alt="" onClick={() => setLightbox(it.photoUrl)} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, cursor: "zoom-in", flexShrink: 0 }} />}
                          <div>
                            <div style={{ fontWeight: 500, lineHeight: 1.45, textDecoration: done ? "line-through" : "none" }}>{it.desc}</div>
                            {it.answer && <div style={{ fontSize: 12, color: "#3C8C3C", marginTop: 3 }}>✔ {it.answer}</div>}
                            {it.catName && <span style={{ fontSize: 10.5, background: ACCENT_SOFT, color: ACCENT, borderRadius: 5, padding: "1px 6px", fontWeight: 600, display: "inline-block", marginTop: 4 }}>{it.catName}</span>}
                          </div>
                        </div>
                      </td>
                      <td style={tdS}>{(() => { const col = colorForCat(cat, cats); return <span style={{ fontSize: 11.5, background: col + "22", color: col, borderRadius: 6, padding: "2px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{cat}</span>; })()}</td>
                      <td style={tdS}>{it.due ? <span style={{ fontSize: 12.5, color: di ? di.color : SUB, fontWeight: di && di.bold ? 700 : 500, whiteSpace: "nowrap" }}>{it.due}{di && di.txt !== it.due ? ` · ${di.txt}` : ""}</span> : <span style={{ color: SUB }}>—</span>}</td>
                      <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 12, color: done ? "#3C8C3C" : "#C2872E", fontWeight: 600 }}>{done ? "✅ 已解決" : "🔴 待處理"}</div>
                        {!done && it.track && <div style={{ fontSize: 11, color: "#C2872E", marginTop: 2 }}>🔔{it.nudges ? `已提醒${it.nudges}次` : "追蹤中"}</div>}
                      </td>
                      <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                        {/* 張良 2026-07-26 手機版全面體檢：操作鈕 5px→7px 加大點按面積（桌機手機一致微調） */}
                        <div style={{ display: "inline-flex", gap: 5 }}>
                          <button onClick={() => toggleDone(it)} title={done ? "重開" : "完成/給答案"} style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${BORDER}`, background: done ? "transparent" : "#EAF6EA", color: done ? SUB : "#3C8C3C", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{done ? "↩" : "✅"}</button>
                          <button onClick={() => setEditId(editing ? null : it.id)} title="編輯" style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${editing ? ACCENT : BORDER}`, background: editing ? ACCENT : "transparent", color: editing ? "#fff" : SUB, fontSize: 12, cursor: "pointer" }}>⚙️</button>
                          <button onClick={() => del(it.id)} title="刪除" style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${BORDER}`, background: "transparent", color: "#b3261e", fontSize: 12, cursor: "pointer" }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                    {editing && (
                      <tr>
                        <td colSpan={5} style={{ padding: "12px 14px", background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
                          {/* 內容可編輯 */}
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 11.5, color: SUB, marginBottom: 4 }}>內容</div>
                            <textarea defaultValue={it.desc} onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.desc) patch(it.id, { desc: v }); }} rows={2} style={{ ...inp, width: "100%", resize: "vertical", lineHeight: 1.5 }} />
                          </div>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>分類 <select value={cats.includes(cat) ? cat : ""} onChange={e => patch(it.id, { category: e.target.value })} style={inp}>{!cats.includes(cat) && <option value="">{cat}</option>}{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>交期 <input type="date" value={it.due || ""} onChange={e => patch(it.id, { due: e.target.value })} style={inp} /></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>提醒終止日 <input type="date" value={it.remindEnd || ""} onChange={e => patch(it.id, { remindEnd: e.target.value })} style={inp} /></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={it.track !== false} onChange={e => patch(it.id, { track: e.target.checked })} />🔔 主動追蹤</label>
                          </div>
                          {/* 提醒頻率視覺化 */}
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${BORDER}` }}>
                            <div style={{ fontSize: 11.5, color: SUB, marginBottom: 6 }}>提醒頻率　<span style={{ color: TEXT, fontWeight: 600 }}>目前：{freqLabel(it.remindEvery || 0)}</span></div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              {FREQ_PRESETS.map(([label, h]) => {
                                const on = (it.remindEvery || 0) === h;
                                return <button key={label} onClick={() => patch(it.id, { remindEvery: h })} style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${on ? ACCENT : BORDER}`, fontSize: 12, cursor: "pointer", background: on ? ACCENT : "#fff", color: on ? "#fff" : SUB, fontWeight: on ? 700 : 500 }}>{label}</button>;
                              })}
                              <span style={{ width: 1, height: 18, background: BORDER, margin: "0 2px" }} />
                              <span style={{ fontSize: 12, color: SUB }}>自訂：每</span>
                              <input type="number" min={1} value={cfd} onChange={e => setCfd(Math.max(1, +e.target.value || 1))} style={{ ...inp, width: 52 }} />
                              <span style={{ fontSize: 12, color: SUB }}>天</span>
                              <input type="number" min={1} value={cft} onChange={e => setCft(Math.max(1, +e.target.value || 1))} style={{ ...inp, width: 52 }} />
                              <span style={{ fontSize: 12, color: SUB }}>次</span>
                              <button onClick={() => patch(it.id, { remindEvery: Math.max(1, Math.round((cfd * 24) / cft)) })} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: TEXT, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>套用</button>
                            </div>
                            <div style={{ fontSize: 11, color: SUB, marginTop: 6 }}>「自動」＝越接近交期提醒越密集、時間不固定（不易被忽略）；自訂則照你設定的頻率準時提醒。需開啟「🔔 主動追蹤」或設定交期才會提醒。</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
          <img src={lightbox} alt="" style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}

// ── 估價單比價（在 App 上傳多份 PDF/圖 → callAI 解析 → 對比表）─────────────────
const _normName = (s) => String(s || "").replace(/[\s（）()【】\[\].·、，,。-]/g, "").toLowerCase();
function _buildCompareRows(ests) {
  const map = new Map(); // 正規化名稱相同才視為同品項（保守，不亂配對）
  ests.forEach(e => (e.items || []).forEach(it => {
    const key = _normName(it.name);
    if (!key) return;
    if (!map.has(key)) map.set(key, { label: it.name, prices: {} });
    map.get(key).prices[e.id] = Number(it.unitPrice) || 0;
  }));
  return [...map.values()].filter(r => Object.keys(r.prices).length >= 2);
}
function _fileToB64(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

export function CompareView({ canEdit, requireLogin, onLog }) {
  const [ests, setEsts] = useState(null);
  const [busy, setBusy] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try { const r = await window.storage.get(K("pm_estimates"), true); setEsts(r && r.value ? JSON.parse(r.value) : []); } catch { setEsts([]); }
      try { const a = await window.storage.get(K("pm_estimates_an"), true); const v = a && a.value ? JSON.parse(a.value) : null; setAnalysis(v && v.rows ? v : null); } catch (_) {}
    })();
  }, []);
  // 估價單一變動就清掉舊分析（避免對不上）
  const save = async (list) => {
    setEsts(list); setAnalysis(null);
    try { await window.storage.set(K("pm_estimates"), JSON.stringify(list), true); await window.storage.set(K("pm_estimates_an"), "null", true); } catch (_) {}
  };

  const runAnalysis = async () => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    onLog?.("編輯", `執行比價分析（${ests.length} 份估價單）`);
    setAnalyzing(true);
    try {
      const forAI = ests.map(e => ({ vendor: e.vendor, total: e.total, items: (e.items || []).map(i => ({ name: i.name, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice })) }));
      const prompt = `你是專業的工程採購／標單比價分析師。以下是 ${ests.length} 份估價單的解析結果：\n${JSON.stringify(forAI)}\n\n請做專業比價分析，只回 JSON、不要其他文字：\n{\n "rows":[{"item":"標準化品項名稱","prices":{"<廠商名>":單價數字或null},"note":"差異備註(可空)"}],\n "missing":[{"vendor":"廠商名","items":["這家沒列、但別家有的品項"]}],\n "gapReason":"一句話：總價差的主因（例：晟弘多含結構支架與設備、發霸未含安裝）",\n "summary":"2-4 句：各家範圍／品質／優劣差異與風險",\n "recommend":"建議選哪家＋理由＋簽約前要向廠商確認／追問的重點"\n}\n規則：rows 要把語意相同的品項對齊在同一列（例「戶外P2.5 LED」與「LED螢幕」視為同一項），各家對應單價填入、沒有就 null；prices 的 key 用上面給的廠商名稱原文；金額只放數字。繁體中文，務實精準。`;
      const reply = await callAI([{ role: "user", content: prompt }], "你是專業工程標單比價分析師，只輸出 JSON。", "compare");
      const clean = reply.replace(/```json|```/gi, "").trim();
      let a = null;
      try { a = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)); } catch (_) {}
      if (a && a.rows) { setAnalysis(a); try { await window.storage.set(K("pm_estimates_an"), JSON.stringify(a), true); } catch (_) {} }
      else setAnalysis({ rows: [], summary: "（分析失敗，請重試）", recommend: "" });
    } catch (e) { setAnalysis({ rows: [], summary: "（分析失敗：" + (e?.message || e) + "）", recommend: "" }); }
    setAnalyzing(false);
  };
  const getP = (row, vendor) => {
    if (!row.prices) return null;
    if (row.prices[vendor] != null) return row.prices[vendor];
    const k = Object.keys(row.prices).find(k => _normName(k) === _normName(vendor));
    return k ? row.prices[k] : null;
  };

  const onPick = async (files) => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    const arr = Array.from(files || []); if (!arr.length) return;
    const added = [];
    for (const f of arr) {
      setBusy(`解析中：${f.name}…`);
      try {
        const b64 = await _fileToB64(f);
        const isPdf = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
        const block = isPdf
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
          : { type: "image", source: { type: "base64", media_type: f.type || "image/jpeg", data: b64 } };
        const prompt = `這是一份工程估價單／報價單。抽出資訊，只回 JSON、不要其他文字：{"vendor":"廠商名稱","total":總額數字,"items":[{"name":"品項","qty":數量,"unit":"單位","unitPrice":單價數字}]}。看不到的：文字留空字串、數字留0；金額只放數字。`;
        const reply = await callAI([{ role: "user", content: [block, { type: "text", text: prompt }] }], "你是工程估價單解析助理，只輸出 JSON。", "import");
        const clean = reply.replace(/```json|```/gi, "").trim();
        let parsed = { vendor: "", total: 0, items: [] };
        try { parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)); } catch (_) {}
        added.push({ id: "es-" + Math.random().toString(36).slice(2, 8), file: f.name, vendor: parsed.vendor || f.name, total: Number(parsed.total) || 0, items: Array.isArray(parsed.items) ? parsed.items : [], ts: new Date().toISOString() });
      } catch (e) {
        added.push({ id: "es-" + Math.random().toString(36).slice(2, 8), file: f.name, vendor: f.name, total: 0, items: [], error: String(e?.message || e) });
      }
    }
    setBusy("");
    if (added.length) onLog?.("新增", `上傳比價估價單 ${added.length} 份（${added.map(a=>a.vendor).filter(Boolean).slice(0,3).join("、")}）`);
    save([...(ests || []), ...added]);
  };

  const remove = (id) => { if (!canEdit) { requireLogin && requireLogin(); return; } const v = (ests||[]).find(e=>e.id===id)?.vendor || "—"; onLog?.("刪除", `刪除比價估價單「${v}」`); save(ests.filter(e => e.id !== id)); };

  if (ests === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const sorted = [...ests].sort((a, b) => (a.total || 0) - (b.total || 0));
  const lowest = sorted.length ? (sorted.find(e => e.total > 0)?.total || 0) : 0;
  const highest = sorted.length ? Math.max(...ests.map(e => e.total || 0)) : 0;

  if (!showMoney()) return <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, margin: "8px 0" }}>🔒 比價頁含報價金額，你沒有看金額的權限。</div>;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 16px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>📊 估價單比價</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{ests.length} 份</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={e => { onPick(e.target.files); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} style={{ background: ACCENT, border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>{busy ? busy : "＋ 上傳估價單"}</button>
        </div>
      </div>

      {ests.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          上傳 2 份以上估價單（PDF／圖片）開始比價
          <div style={{ fontSize: 12, marginTop: 8 }}>DD 會解析每份的廠商／總額／品項，自動排序並對比</div>
        </div>
      ) : (
        <>
          {/* 總額對比 */}
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginBottom: 10 }}>💰 總額對比（低→高）</div>
            {sorted.map((e, idx) => {
              const diff = (e.total || 0) - lowest;
              const pct = lowest > 0 ? Math.round(diff / lowest * 100) : 0;
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: idx < sorted.length - 1 ? `1px solid #ece4d6` : "none" }}>
                  <span style={{ fontSize: 15 }}>{idx === 0 && e.total > 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "・"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: TEXT, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.vendor}</div>
                    <div style={{ fontSize: 10.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.file}{e.error ? " ⚠️ 解析失敗" : ""}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: idx === 0 && e.total > 0 ? "#3C8C3C" : TEXT }}>{fmt(e.total)}</div>
                    {diff > 0 && <div style={{ fontSize: 10.5, color: "#C2872E" }}>+{fmt(diff)}（+{pct}%）</div>}
                  </div>
                  <button onClick={() => remove(e.id)} title="移除" style={{ border: "none", background: "none", color: SUB, cursor: "pointer", fontSize: 15 }}>✕</button>
                </div>
              );
            })}
            {highest > lowest && lowest > 0 && (
              <div style={{ fontSize: 12.5, color: "#3C8C3C", marginTop: 10, fontWeight: 600 }}>💡 選最低（{sorted[0].vendor}）比最高省 {fmt(highest - lowest)}</div>
            )}
          </div>

          {/* AI 專業比價分析 */}
          {ests.length >= 2 && (
            <div style={{ marginBottom: 14 }}>
              {!analysis ? (
                <button onClick={runAnalysis} disabled={analyzing} style={{ width: "100%", background: PRIMARY, border: "none", color: "#fff", borderRadius: 10, padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: analyzing ? "wait" : "pointer" }}>
                  {analyzing ? "🔍 AI 分析中…（對齊品項、解釋價差、給建議）" : "🔍 產生 AI 比價分析"}
                </button>
              ) : (
                <>
                  {analysis.gapReason && (
                    <div style={{ background: "#FFF7ED", border: "1px solid #FDE6C8", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: "#9A5B12", lineHeight: 1.6 }}>
                      <b>💡 價差主因：</b>{analysis.gapReason}
                    </div>
                  )}
                  {analysis.summary && (
                    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: TEXT, lineHeight: 1.7 }}>
                      <b style={{ color: ACCENT }}>📋 分析：</b>{analysis.summary}
                    </div>
                  )}
                  {analysis.recommend && (
                    <div style={{ background: "#EAF6EA", border: "1px solid #BFE3BF", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: "#235C23", lineHeight: 1.7 }}>
                      <b>✅ 建議：</b>{analysis.recommend}
                    </div>
                  )}
                  {Array.isArray(analysis.missing) && analysis.missing.some(m => (m.items || []).length) && (
                    <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 12.5, color: "#B43838", lineHeight: 1.7 }}>
                      <b>⚠️ 各家未列項目（可能漏報或不含）：</b>
                      {analysis.missing.filter(m => (m.items || []).length).map((m, i) => <div key={i}>・<b>{m.vendor}</b>：{m.items.join("、")}</div>)}
                    </div>
                  )}
                  {Array.isArray(analysis.rows) && analysis.rows.length > 0 && (
                    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, overflowX: "auto" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginBottom: 10 }}>📦 逐項單價對比（AI 對齊）</div>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 360 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 8px", color: SUB, borderBottom: `1px solid ${BORDER}`, whiteSpace: "nowrap" }}>品項</th>
                            {/* 張良 2026-07-26 手機版全面體檢：廠商名被 100px 截斷 → 加 title 長按/滑過可看全名 */}
                            {ests.map(e => <th key={e.id} title={e.vendor} style={{ textAlign: "right", padding: "6px 8px", color: SUB, borderBottom: `1px solid ${BORDER}`, whiteSpace: "nowrap", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>{e.vendor}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.rows.map((r, ri) => {
                            const vals = ests.map(e => getP(r, e.vendor)).filter(v => v > 0);
                            const min = vals.length ? Math.min(...vals) : 0;
                            return (
                              <tr key={ri}>
                                <td style={{ padding: "6px 8px", color: TEXT, borderBottom: `1px solid #ece4d6` }}>{r.item}{r.note ? <span style={{ color: SUB, fontSize: 11 }}> · {r.note}</span> : ""}</td>
                                {ests.map(e => {
                                  const v = getP(r, e.vendor);
                                  const isMin = v > 0 && v === min && vals.length > 1;
                                  return <td key={e.id} style={{ textAlign: "right", padding: "6px 8px", fontFamily: "monospace", borderBottom: `1px solid #ece4d6`, color: isMin ? "#3C8C3C" : (v == null ? "#C0392B" : TEXT), fontWeight: isMin ? 700 : 400, background: isMin ? "#EAF6EA" : "transparent" }}>{v != null ? fmt(v) : "未列"}</td>;
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div style={{ fontSize: 11, color: SUB, marginTop: 8, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <span>※ 由 AI 對齊各家品項；金額以原估價單為準，重要數字請再核對。</span>
                        <button onClick={runAnalysis} disabled={analyzing} style={{ border: "none", background: "none", color: ACCENT, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>{analyzing ? "分析中…" : "↻ 重新分析"}</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── OWNER DASHBOARD ───────────────────────────────────────────────────────────
export function OwnerDashboard({ cats, setCats, settings, stalledItems, activityLog, logActivity, userName, isAdmin, journal, events, plans, petty, totalPaid, pettyInCats }) {
  // 零用金實支：已歸類的已注入各大項（含在下方 totalEst/totalAct）；未歸類的另外提示
  const pettySpends = petty?.spends || [];
  const pettyTotal = pettySpends.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const pettyUncat = pettySpends.filter(s => !s.catId || !cats.some(c => c.id === s.catId)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const pettyCategorized = pettyTotal - pettyUncat;
  const pettyByCat = {};
  pettySpends.forEach(s => { if (s.catId && cats.some(c => c.id === s.catId)) pettyByCat[s.catId] = (pettyByCat[s.catId] || 0) + (Number(s.amount) || 0); });
  const pettyCatRows = Object.entries(pettyByCat).sort((a, b) => b[1] - a[1]);
  const pettyCatName = (id) => cats.find(c => c.id === id)?.name || "";
  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState("");
  const [showReport, setShowReport] = useState(false);

  // 進度只算「工程細項」：排除 撥款帳/非工程(業主自理)/零用金注入項
  const workCats = cats.filter(c => !isFundingCat(c) && !c.nonProject);
  const allItems = workCats.flatMap(c => (c.items || []).filter(it => !it.fromPetty));
  const totalItems = allItems.length;
  const doneItems = allItems.filter(i=>i.done||i.status==="done").length;
  const inProgressItems = allItems.filter(i=>i.status==="inprogress");
  const issueItems = allItems.filter(i=>i.status==="issue");
  const pct = totalItems ? Math.round(doneItems/totalItems*100) : 0;
  const totalEst = cats.filter(c=>!isFundingCat(c)).reduce((s,c)=>s+catEstAfter(c),0); // 議價後含稅總額（排除撥款帳）
  const totalAct = cats.filter(c=>!isFundingCat(c)).reduce((s,c)=>s+catPaid(c),0); // 已付總額（排除撥款帳）
  const daysLeft = settings?.targetDate ? Math.ceil((new Date(settings.targetDate)-new Date())/(1000*60*60*24)) : null;
  const today = new Date().toLocaleDateString("zh-TW");

  // 狀態項目數
  const cnt = (s)=>allItems.filter(i=>i.status===s).length;
  const holdItems = allItems.filter(i=>i.status==="hold");
  // 進度 vs 時程（開工日→完工日，時間已過 % 對比完成 %）
  const ps = settings?.projectStart, td = settings?.targetDate;
  let timePct = null, behind = 0;
  if (ps && td) {
    const total = new Date(td) - new Date(ps), elapsed = new Date() - new Date(ps);
    if (total > 0) { timePct = Math.max(0, Math.min(100, Math.round(elapsed/total*100))); behind = timePct - pct; }
  }
  const budgetPct = totalEst>0 ? Math.round(totalAct/totalEst*100) : 0;
  const overBudget = totalAct > totalEst && totalEst>0;
  // 整體健康燈號
  const health = (issueItems.length>0 || behind>=15) ? "red" : (stalledItems.length>0 || holdItems.length>0 || behind>=5) ? "amber" : "green";
  const hh = { green:{c:"#3C8C3C",bg:"#F0FDF4",dot:"🟢",txt:"進度正常"}, amber:{c:"#C2872E",bg:"#FFFBEB",dot:"🟡",txt:"需要注意"}, red:{c:"#C0392B",bg:"#FEF2F2",dot:"🔴",txt:"需立即處理"} }[health];

  const [showDoneCats, setShowDoneCats] = useState(false); // 各工程進度：完工的預設摺疊
  const todayActivity = activityLog.filter(a => {
    const d = new Date(a.ts).toLocaleDateString("zh-TW");
    if (d !== today) return false;
    if (a.action === "登入" && !isAdmin) return false; // 登入紀錄只給管理員看，避免帳號外洩
    return true;
  });

  const generateReport = async () => {
    setReportLoading(true);
    setShowReport(true);
    const system = buildAdvisorSystem(settings, cats, journal||[], events||[], plans||[]);
    const prompt = "請為業主產生一份本週工程進度報告。格式要求：\n1. 開頭用一句話總結本週整體狀況\n2. 各工程大項進度（用百分比和狀態說明）\n3. 本週完成的重要事項（條列）\n4. 目前需要業主知道的問題或決策點\n5. 下週預計完成的工作\n6. 結尾給一個整體評估（樂觀/正常/需注意）\n\n請用業主能理解的語言，避免太多技術術語，語氣專業但親切。";
    try {
      const reply = await callAI([{role:"user",content:prompt}], system);
      setReport(reply);
    } catch(e) { setReport("⚠️ 生成失敗：" + e.message); }
    setReportLoading(false);
  };

  const ProgressRing = ({ pct, size=80, stroke=8, color="#3C8C3C" }) => {
    const r = (size-stroke)/2;
    const circ = 2*Math.PI*r;
    const offset = circ - (pct/100)*circ;
    return (
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e6ddc9" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition:"stroke-dashoffset 0.8s ease" }} />
      </svg>
    );
  };

  const card = { background:"#fbf8f1", border:"1px solid #d9cfbd", borderRadius:16, padding:18 };
  const kLabel = { fontSize:12, color:"#6F6656", fontWeight:600 };
  const Stat = ({ n, label, color }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:12.5, color:"#4A4234" }}>{label}</span>
      <span style={{ fontSize:14, fontWeight:700, color:n>0?color:"#C9BFA8" }}>{n}</span>
    </div>
  );

  return (
    <div style={{ paddingTop:16, maxWidth:1040, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:22, fontWeight: 600, color:"#211C15" }}>{settings?.projectName || "工程進度"}</div>
          <div style={{ fontSize:13, color:"#6F6656", marginTop:2 }}>{settings?.projectAddress}{settings?.contractorName ? ` · ${settings.contractorName}` : ""} · 今日 {today}</div>
        </div>
        <button onClick={generateReport} style={{ padding:"10px 20px", background:"#211C15", border:"none", borderRadius:10, color:"#fbf8f1", fontSize:13, fontWeight: 600, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          📄 產生業主週報
        </button>
      </div>

      {/* 健康燈號橫幅 */}
      <div style={{ display:"flex", alignItems:"center", gap:12, background:hh.bg, border:`1px solid ${hh.c}33`, borderRadius:14, padding:"12px 18px", marginBottom:16, flexWrap:"wrap" }}>
        <span style={{ fontSize:20 }}>{hh.dot}</span>
        <div style={{ fontSize:15, fontWeight:700, color:hh.c }}>{hh.txt}</div>
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:14, fontSize:12.5, color:"#6F6656", flexWrap:"wrap" }}>
          {issueItems.length>0 && <span style={{ color:"#C0392B", fontWeight:600 }}>🚨 問題 {issueItems.length}</span>}
          {stalledItems.length>0 && <span style={{ color:"#C2872E", fontWeight:600 }}>⏰ 卡關 {stalledItems.length}</span>}
          {timePct!=null && behind>=5 && <span style={{ color:"#C0392B", fontWeight:600 }}>📉 落後時程 {behind}%</span>}
          {health==="green" && <span>各項進度皆在掌握中</span>}
        </div>
      </div>

      {/* 工程財務總覽（甲：零用金帶帳戶併進）：預算 vs 付款 vs 實際成本，未付醒目 */}
      {showMoney() && (() => {
        const unpaid = totalEst - totalAct;
        const payPct = totalEst > 0 ? Math.round(totalAct / totalEst * 100) : 0;
        const big = (label, val, color, sub) => <div style={{ flex:"1 1 180px", minWidth:160 }}><div style={{ fontSize:12.5, color:"#6F6656" }}>{label}{sub && <span style={{ color:"#9b9384", fontSize:11 }}> {sub}</span>}</div><div style={{ fontSize:24, fontWeight:800, color, fontVariantNumeric:"tabular-nums", letterSpacing:-0.5, marginTop:2 }}>{fmt(val)}</div></div>;
        return (
        <div style={{ background:"#fff", border:"1px solid #d9cfbd", borderRadius:16, padding:18, marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"#211C15", marginBottom:14 }}>💰 工程財務總覽</div>
          {/* 預算 / 已付 / 未付（重點，大字）*/}
          <div style={{ display:"flex", gap:18, flexWrap:"wrap", marginBottom:14 }}>
            {big("預估總額", totalEst, "#211C15", "（議價後含稅）")}
            {big("已付總額", totalAct, "#3C8C3C")}
            {big("未付（尚需支付）", unpaid, unpaid < 0 ? "#b3261e" : "#C2410C")}
          </div>
          <div style={{ height:9, background:"#e6ddc9", borderRadius:6, overflow:"hidden", marginBottom:4 }}><div style={{ width:payPct+"%", height:"100%", background:"#3C8C3C", borderRadius:6 }} /></div>
          <div style={{ fontSize:12, color:"#6F6656", marginBottom:14 }}>付款進度 {payPct}%</div>
          {/* 零用金實支（已併入上方各大項成本）*/}
          {pettyTotal > 0 && (
            <div style={{ borderTop:"1px solid #e6ddc9", paddingTop:12 }}>
              <div style={{ fontSize:12, color:"#6F6656", marginBottom:8 }}>
                🪙 其中<b style={{ color:"#C2410C" }}> 零用金實支 {fmt(pettyCategorized)}</b>（來自零用金帳戶，已併入上方各工種成本）
                {pettyUncat > 0 && <span style={{ color:"#C2872E" }}>　· 另有未歸類 {fmt(pettyUncat)}（請到零用金頁歸到工種才會併入）</span>}
              </div>
              {pettyCatRows.length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
                  {pettyCatRows.map(([id, amt]) => (
                    <span key={id} style={{ fontSize:12, background:"#ece4d6", border:"1px solid #E3DAC6", borderRadius:10, padding:"3px 10px", color:"#4A4234" }}>{pettyCatName(id)} <b style={{ fontVariantNumeric:"tabular-nums" }}>{fmt(amt)}</b></span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>);
      })()}

      {/* Main KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:14, marginBottom:20 }}>
        {/* 完成度 */}
        <div style={card}>
          <div style={kLabel}>整體完成度</div>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginTop:8 }}>
            <div style={{ position:"relative", flexShrink:0 }}>
              <ProgressRing pct={pct} size={70} color={pct>75?"#3C8C3C":pct>40?"#C2872E":"#C0392B"} />
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:700, color:"#211C15" }}>{pct}%</div>
            </div>
            <div>
              <div style={{ fontSize:18, fontWeight:700, color:"#211C15" }}>{doneItems}<span style={{ fontSize:13, color:"#9b9384", fontWeight:400 }}> / {totalItems} 項</span></div>
              <div style={{ fontSize:12, color:"#3E72A8", marginTop:3, fontWeight:600 }}>進行中 {inProgressItems.length} 項</div>
            </div>
          </div>
        </div>

        {/* 時程 */}
        <div style={card}>
          <div style={kLabel}>距完工</div>
          {daysLeft !== null ? (
            <>
              <div style={{ fontSize:26, fontWeight:700, color:daysLeft<14?"#C0392B":daysLeft<30?"#C2872E":"#211C15", marginTop:4 }}>{daysLeft}<span style={{ fontSize:13, fontWeight:400, color:"#9b9384" }}> 天</span></div>
              {timePct!=null ? (
                <div style={{ marginTop:8 }}>
                  <div style={{ fontSize:11, color:"#6F6656", marginBottom:4 }}>時程已過 {timePct}%・完成 {pct}%</div>
                  <div style={{ position:"relative", background:"#e6ddc9", borderRadius:20, height:7 }}>
                    <div style={{ position:"absolute", left:0, top:0, bottom:0, width:pct+"%", background:behind>=10?"#C0392B":"#3C8C3C", borderRadius:20, transition:"width .8s" }} />
                    <div style={{ position:"absolute", left:`calc(${timePct}% - 1px)`, top:-2, bottom:-2, width:2, background:"#211C15" }} title="今日時程基準" />
                  </div>
                  <div style={{ fontSize:11.5, fontWeight:700, marginTop:5, color: behind>=10?"#C0392B":behind>=5?"#C2872E":"#3C8C3C" }}>{behind>=5?`進度落後 ${behind}%`:behind<=-5?`進度超前 ${-behind}%`:"進度符合時程"}</div>
                </div>
              ) : <div style={{ fontSize:12, color:"#9b9384", marginTop:8 }}>完工日 {td}</div>}
            </>
          ) : <div style={{ fontSize:13, color:"#9b9384", marginTop:12 }}>尚未設定完工日</div>}
        </div>

        {/* 付款進度（金額，受權限控管）*/}
        {showMoney() ? (
        <div style={card}>
          <div style={kLabel}>付款進度（已付／預估）</div>
          <div style={{ fontSize:19, fontWeight:700, color:overBudget?"#C0392B":"#3C8C3C", marginTop:4, fontFamily:"ui-monospace, monospace" }}>{totalAct>0?fmt(totalAct):"—"}</div>
          <div style={{ fontSize:11.5, color:"#6F6656", marginTop:2 }}>預估 <span style={{ fontFamily:"ui-monospace, monospace" }}>{fmt(totalEst)}</span>・未付 <span style={{ fontFamily:"ui-monospace, monospace", color:"#C2872E" }}>{fmt(totalEst-totalAct)}</span></div>
          <div style={{ background:"#e6ddc9", borderRadius:20, height:7, overflow:"hidden", marginTop:9 }}>
            <div style={{ background:overBudget?"#C0392B":"#3C8C3C", height:"100%", width:Math.min(100,budgetPct)+"%", borderRadius:20, transition:"width .8s" }} />
          </div>
          <div style={{ fontSize:11.5, fontWeight:700, marginTop:5, color:overBudget?"#C0392B":"#6F6656" }}>{totalAct>0?`已付 ${budgetPct}%${overBudget?"（溢付）":""}`:"尚未付款"}</div>
        </div>
        ) : (
        <div style={card}>
          <div style={kLabel}>付款進度</div>
          <div style={{ fontSize:13, color:"#9b9384", marginTop:14 }}>🔒 沒有看金額的權限</div>
        </div>
        )}

        {/* 狀態總覽 */}
        <div style={card}>
          <div style={kLabel}>狀態總覽</div>
          <div style={{ display:"flex", flexDirection:"column", gap:7, marginTop:9 }}>
            <Stat n={issueItems.length} label="🚨 有問題" color="#C0392B" />
            <Stat n={stalledItems.length} label="⏰ 卡關 >3天" color="#C2872E" />
            <Stat n={holdItems.length} label="⏸ 暫停" color="#C2872E" />
            <Stat n={cnt("pending")} label="○ 待開工" color="#6F6656" />
          </div>
        </div>
      </div>

      {/* Category progress bars */}
      <div style={{ background:"#fbf8f1", border:"1px solid #d9cfbd", borderRadius:16, padding:20, marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
          <SecHead tag="進度" title="各工程進度" style={{ marginBottom: 0 }} />
          <div style={{ fontSize:12, color:"#6F6656" }}>{workCats.length} 大項 · 完工 {workCats.filter(c=>c.status==="done").length} · 進行中 {workCats.filter(c=>c.status==="inprogress").length} · 待開工 {workCats.filter(c=>c.status==="pending").length}</div>
        </div>
        {(() => {
          const sorted = [...cats].sort((a,b)=>{
            const rank = s => s==="issue"?0 : s==="inprogress"?1 : s==="hold"?2 : s==="done"?4 : 3;
            const r = rank(a.status)-rank(b.status); return r!==0 ? r : (a.order-b.order);
          });
          // 收斂：完工的預設摺疊（Manus P1），畫面聚焦在進行中/有問題
          const doneList = sorted.filter(c => c.status === "done");
          const activeList = sorted.filter(c => c.status !== "done");
          return (showDoneCats ? sorted : activeList).map(cat => {
          const total = cat.items.length;
          const done = cat.items.filter(i=>i.done||i.status==="done").length;
          const pct = total ? Math.round(done/total*100) : 0;
          const hasIssue = cat.items.some(i=>i.status==="issue");
          const hasStall = cat.items.some(i=>stalledItems.find(s=>s.id===i.id));
          const st = STATUS_MAP[cat.status]||STATUS_MAP.pending;
          return (
            <div key={cat.id} style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ width:8, height:8, borderRadius:4, background:st.color, flexShrink:0 }} />
                  <span style={{ fontSize:13, fontWeight:600, color:"#4A4234" }}>{cat.name}</span>
                  {hasIssue && <span style={{ fontSize:10, background:"#fbeee6", color:"#b3261e", borderRadius:10, padding:"1px 7px", fontWeight: 600 }}>問題</span>}
                  {hasStall && <span style={{ fontSize:10, background:"#f8f0dc", color:"#c98a14", borderRadius:10, padding:"1px 7px", fontWeight: 600 }}>卡關</span>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:11, color:"#9b9384" }}>{done}/{total}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:"#211C15", minWidth:34, textAlign:"right" }}>{pct}%</span>
                  <span style={{ fontSize:11, color:st.color, background:st.color+"18", borderRadius:20, padding:"1px 8px", fontWeight: 600 }}>{st.label}</span>
                </div>
              </div>
              <div style={{ background:"#e6ddc9", borderRadius:20, height:8, overflow:"hidden" }}>
                <div style={{ background:pct===100?"#3C8C3C":hasIssue?"#C0392B":"#3E72A8", height:"100%", width:pct+"%", borderRadius:20, transition:"width 0.8s" }} />
              </div>
            </div>
          );
        });
        })()}
        {cats.some(c => c.status === "done") && (
          <button onClick={() => setShowDoneCats(v => !v)} style={{ width:"100%", border:"1px dashed #d9cfbd", background:"#f4efe5", color:"#5a5247", borderRadius:8, padding:"7px 0", fontSize:12.5, fontWeight:600, cursor:"pointer" }}>
            {showDoneCats ? "收起已完工" : `已完工 ${cats.filter(c=>c.status==="done").length} 項 ▸ 展開`}
          </button>
        )}
      </div>

      {/* Today's activity */}
      <div style={{ background:"#fbf8f1", border:"1px solid #d9cfbd", borderRadius:16, padding:20, marginBottom:20 }}>
        <SecHead tag="動態" title="今日動態" right={todayActivity.length>0&&<span style={{ fontSize:12, color:SUB, fontWeight:400 }}>{todayActivity.length} 筆</span>} />
        {todayActivity.length === 0 ? (
          <div style={{ fontSize:13, color:"#9b9384", textAlign:"center", padding:"20px 0" }}>今日尚無更新記錄</div>
        ) : (
          <div style={{ maxHeight:200, overflowY:"auto" }}>
            {todayActivity.slice(0,20).map((a,i) => (
              <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", paddingBottom:10, marginBottom:10, borderBottom:i<todayActivity.length-1?"1px solid #e6ddc9":"none" }}>
                <div style={{ fontSize:11, color:"#9b9384", whiteSpace:"nowrap", marginTop:2 }}>{new Date(a.ts).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</div>
                <div style={{ fontSize:12, color:"#4A4234" }}><span style={{ fontWeight:600, color:"#211C15" }}>{maskAccount(a.user)}</span> {a.action}：{a.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stalled items detail */}
      {stalledItems.length > 0 && (
        <div style={{ background:"#f8f0dc", border:"1px solid #fcd34d", borderRadius:16, padding:20, marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight: 600, color:"#92400e", marginBottom:12 }}>⏰ 卡關項目（超過3天未更新）</div>
          {stalledItems.map(item => {
            const cat = cats.find(c=>c.items.find(i=>i.id===item.id));
            const days = item.lastUpdated ? Math.floor((Date.now()-new Date(item.lastUpdated))/(1000*60*60*24)) : null;
            return (
              <div key={item.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #fde68a" }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:"#92400e" }}>{item.name}</div>
                  <div style={{ fontSize:11, color:"#b45309" }}>{cat?.name} · {item.assignee||"未指派"}</div>
                </div>
                {days && <div style={{ fontSize:12, color:"#b3261e", fontWeight: 600 }}>卡關 {days} 天</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* AI/bot 用量帳單已移到 設定 → 用量（業主視角的儀表板不該看到 API 帳單） */}

      {/* Weekly Report Modal */}
      {showReport && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&setShowReport(false)}>
          <div style={{ background:"#fbf8f1", borderRadius:16, padding:24, maxWidth:620, width:"100%", maxHeight:"80vh", overflow:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight: 600, color:"#211C15" }}>📄 業主週報</div>
              <button onClick={()=>setShowReport(false)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#6F6656" }}>×</button>
            </div>
            {reportLoading ? (
              <div style={{ textAlign:"center", padding:"40px", color:ACCENT }}>🤖 AI 生成中…</div>
            ) : (
              <div style={{ fontSize:13, lineHeight:1.9, color:"#4A4234", whiteSpace:"pre-wrap", background:"#f9fafb", borderRadius:10, padding:"16px 18px" }}>{report}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 檔案庫 / 相簿 ─────────────────────────────────────────────────────────────
// 檔案類別依空間換詞（key 不變＝舊資料照常對應）：工程用工程詞、其他空間用通用詞
const PHOTO_KINDS = CURRENT_SPACE === "construction"
  ? [["quote","估價單"],["site","現場照"],["invoice","發票"],["other","其他"]]
  : [["quote","文件"],["site","照片"],["invoice","單據"],["other","其他"]];
const photoKindLabel = (k) => (PHOTO_KINDS.find(x=>x[0]===k)||[,"其他"])[1];
const photoKindColor = { quote:"#3b82f6", site:"#3C8C3C", invoice:"#b3261e", other:"#9b9384" };
export function PhotoLibraryView({ photos, setPhotos, cats, canEdit, userName, requireLogin, confirm }) {
  const [kind, setKind] = useState("site");
  const [catId, setCatId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fKind, setFKind] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [lightbox, setLightbox] = useState(null);
  const [editId, setEditId] = useState(null);
  const [ef, setEf] = useState({});
  const [groupBy, setGroupBy] = useState("none"); // none | cat | date
  const fileRef = useRef(null);
  const sortedCats = [...cats].sort((a,b)=>a.order-b.order);

  const startEdit = (p) => { if (!canEdit) { requireLogin&&requireLogin(); return; } setEditId(p.id); setEf({ kind:p.kind, catId:p.catId||"", date:p.date||"", note:p.note||"" }); };
  const saveEdit = () => {
    setPhotos(photos.map(p => p.id===editId ? { ...p, kind:ef.kind, catId:ef.catId, catName:(cats.find(c=>c.id===ef.catId)?.name)||"", date:ef.date, note:ef.note } : p));
    setEditId(null);
  };

  const onPick = async (files) => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    const arr = Array.from(files||[]);
    if (!arr.length) return;
    setUploading(true);
    const added = [];
    for (const f of arr) {
      try {
        const { url, path } = await uploadPhoto(f);
        const cat = cats.find(c => c.id === catId);
        added.push({ id: "ph-"+Math.random().toString(36).slice(2,8), url, path, name: f.name || "檔案", mime: f.type||"", isImage: /^image\//.test(f.type), kind, catId: catId||"", catName: cat?cat.name:"", date, note, invoiceReceived: false, by: userName||"—", ts: new Date().toISOString() });
      } catch (e) { alert("上傳失敗：" + (e?.message || e)); }
    }
    if (added.length) setPhotos([...added, ...photos]);
    setNote(""); setUploading(false);
  };
  // 截圖貼上：監聽 paste，把剪貼簿圖片直接上傳
  const onPickRef = useRef(null);
  onPickRef.current = onPick;
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items || [];
      const imgs = [];
      for (const it of items) { if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); } }
      if (imgs.length) { e.preventDefault(); onPickRef.current && onPickRef.current(imgs); }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);
  const toggleReceived = (id) => setPhotos(photos.map(p => p.id===id ? {...p, invoiceReceived: !p.invoiceReceived} : p));
  const del = async (p) => { if (confirm && !(await confirm("刪除這張圖片？"))) return; await deletePhotoFile(p.path); setPhotos(photos.filter(x => x.id !== p.id)); };

  const filtered = photos.filter(p => (fKind==="all"||p.kind===fKind) && (fCat==="all"||p.catId===fCat))
    .sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.ts||"").localeCompare(a.ts||""));
  const pendingInvoices = photos.filter(p => p.kind==="invoice" && !p.invoiceReceived).length;

  const selStyle = { ...inputStyle, width:"auto", padding:"6px 10px" };

  const groups = (() => {
    if (groupBy === "cat") {
      const order = [...sortedCats.map(c=>c.name), "（未指定工程）"];
      const m = {};
      filtered.forEach(p => { const k = p.catName || "（未指定工程）"; (m[k]=m[k]||[]).push(p); });
      return order.filter(k=>m[k]).map(k => ({ label: k, items: m[k] }));
    }
    if (groupBy === "date") {
      const m = {};
      filtered.forEach(p => { const k = p.date || "（無日期）"; (m[k]=m[k]||[]).push(p); });
      return Object.keys(m).sort((a,b)=>b.localeCompare(a)).map(k => ({ label: k, items: m[k] }));
    }
    return [{ label: null, items: filtered }];
  })();

  const renderCard = (p) => (
    <div key={p.id} style={{ background:"#fff", border:"1px solid #d9cfbd", borderRadius:12, overflow:"hidden", display:"flex", flexDirection:"column" }}>
      <div style={{ position:"relative", aspectRatio:"4/3", background:"#e6ddc9", cursor: p.isImage!==false?"zoom-in":"default", display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>{ if (p.isImage!==false) setLightbox(p); }}>
        {p.isImage !== false
          ? <img src={p.url} alt={p.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
          : <a href={p.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ textAlign:"center", textDecoration:"none", color:"#6F6656", padding:"0 10px" }}>
              <div style={{ fontSize:40 }}>📄</div>
              <div style={{ fontSize:11, marginTop:4, wordBreak:"break-all", maxHeight:32, overflow:"hidden" }}>{p.name}</div>
            </a>}
        <span style={{ position:"absolute", top:6, left:6, fontSize:10, fontWeight: 600, color:"#fff", background:photoKindColor[p.kind]||"#9b9384", borderRadius:6, padding:"2px 7px" }}>{photoKindLabel(p.kind)}</span>
      </div>
      <div style={{ padding:"8px 10px", fontSize:12 }}>
        {editId === p.id ? (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <select value={ef.kind} onChange={e=>setEf({...ef, kind:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }}>{PHOTO_KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
            <select value={ef.catId} onChange={e=>setEf({...ef, catId:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }}><option value="">（不指定{L("cat")}）</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input type="date" value={ef.date} onChange={e=>setEf({...ef, date:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }} />
            <input value={ef.note} onChange={e=>setEf({...ef, note:e.target.value})} placeholder="備註" style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }} />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setEditId(null)} style={{ fontSize:11, color:"#6F6656", background:"none", border:"none", cursor:"pointer" }}>取消</button>
              <button onClick={saveEdit} style={{ fontSize:11, fontWeight: 600, color:"#211C15", background:ACCENT, border:"none", borderRadius:6, padding:"4px 12px", cursor:"pointer" }}>儲存</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ color:"#4A4234", fontWeight:600 }}>{p.catName || "（未指定工程）"}</div>
            <div style={{ color:"#9b9384", fontSize:11, marginTop:2 }}>{p.date} · {p.by}</div>
            {p.note && <div style={{ color:"#6F6656", fontSize:11, marginTop:3, whiteSpace:"pre-wrap" }}>{p.note}</div>}
            {p.kind === "invoice" && (
              <label style={{ display:"flex", alignItems:"center", gap:5, marginTop:6, fontSize:12, color:p.invoiceReceived?"#3f7d4e":"#b3261e", fontWeight: 600, cursor:canEdit?"pointer":"default" }}>
                <input type="checkbox" checked={!!p.invoiceReceived} disabled={!canEdit} onChange={()=>canEdit&&toggleReceived(p.id)} style={{ accentColor:"#3f7d4e" }} />
                {p.invoiceReceived ? "✅ 發票已收到" : "⚠️ 發票未收到"}
              </label>
            )}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#3b82f6", textDecoration:"none" }}>⬇ 下載</a>
              {canEdit && <button onClick={()=>startEdit(p)} style={{ fontSize:11, color:"#4A4234", background:"none", border:"none", cursor:"pointer", padding:0 }}>編輯</button>}
              {canEdit && <button onClick={()=>del(p)} style={{ fontSize:11, color:"#b3261e", background:"none", border:"none", cursor:"pointer", padding:0 }}>刪除</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize:18, fontWeight: 600, color:"#211C15", marginBottom:12 }}>📁 檔案庫 / 相簿</div>

      {pendingInvoices > 0 && (
        <div style={{ background:"#fbeee6", border:"1px solid #fca5a5", borderRadius:10, padding:"8px 14px", marginBottom:12, fontSize:13, color:"#b3261e", fontWeight:600 }}>
          🧾 有 {pendingInvoices} 張發票尚未確認收到（請在發票卡片勾選「已收到」）
        </div>
      )}

      {canEdit ? (
        <div style={{ background:"#fff", border:"1px solid #d9cfbd", borderRadius:12, padding:14, marginBottom:14, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <select value={kind} onChange={e=>setKind(e.target.value)} style={selStyle}>{PHOTO_KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
          <select value={catId} onChange={e=>setCatId(e.target.value)} style={selStyle}><option value="">（不指定{L("cat")}）</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={selStyle} />
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="備註（選填）" style={{ ...inputStyle, flex:1, minWidth:120, padding:"6px 10px" }} />
          <input ref={fileRef} type="file" multiple style={{ display:"none" }} onChange={e=>{ onPick(e.target.files); e.target.value=""; }} />
          <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{ background:ACCENT, color:"#fbf8f1", border:"none", borderRadius:8, padding:"8px 16px", fontWeight: 600, cursor: uploading?"wait":"pointer" }}>{uploading?"上傳中…":"📎 上傳照片 / 檔案"}</button>
          <span style={{ fontSize:11, color:"#9b9384", width:"100%" }}>支援照片、PDF、Excel 等檔案；也可直接 Ctrl/⌘+V 貼上截圖</span>
        </div>
      ) : (
        <div style={{ background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:13, color:"#6F6656" }}>🔒 唯讀模式：登入後可上傳 / 管理圖片。</div>
      )}

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12, alignItems:"center" }}>
        <span style={{ fontSize:11, color:"#9b9384" }}>類別</span>
        {[["all","全部"],...PHOTO_KINDS].map(([k,l])=>(
          <button key={k} onClick={()=>setFKind(k)} style={{ padding:"3px 10px", borderRadius:20, border:"1px solid #d9cfbd", fontSize:11, cursor:"pointer", background:fKind===k?ACCENT:"#ece4d6", color:fKind===k?"#fbf8f1":"#6F6656", fontWeight:fKind===k?700:400 }}>{l}</button>
        ))}
        <span style={{ fontSize:11, color:"#9b9384", marginLeft:8 }}>{L("cat")}</span>
        <select value={fCat} onChange={e=>setFCat(e.target.value)} style={{ ...selStyle, fontSize:12, padding:"4px 8px" }}>
          <option value="all">全部{L("cat")}</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:11, color:"#9b9384" }}>分組</span>
        {[["none","不分組"],["cat","按工程"],["date","按日期"]].map(([k,l])=>(
          <button key={k} onClick={()=>setGroupBy(k)} style={{ padding:"3px 10px", borderRadius:20, border:"1px solid #d9cfbd", fontSize:11, cursor:"pointer", background:groupBy===k?ACCENT:"#ece4d6", color:groupBy===k?"#fbf8f1":"#6F6656", fontWeight:groupBy===k?700:400 }}>{l}</button>
        ))}
        <span style={{ fontSize:12, color:"#9b9384", marginLeft:6 }}>共 {filtered.length} 張</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"#9b9384", padding:40 }}>尚無檔案{canEdit?"，用上方按鈕上傳或貼上截圖":""}</div>
      ) : groups.map(g => (
        <div key={g.label || "all"} style={{ marginBottom: g.label ? 18 : 0 }}>
          {g.label && (
            <div style={{ fontSize:13, fontWeight: 600, color:"#4A4234", margin:"6px 0 8px", display:"flex", alignItems:"center", gap:8 }}>
              {groupBy==="date" ? "📅" : "🏗️"} {g.label}
              <span style={{ fontSize:11, color:"#9b9384", fontWeight:400 }}>（{g.items.length}）</span>
              <div style={{ height:1, flex:1, background:"#d9cfbd" }} />
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px,1fr))", gap:12 }}>
            {g.items.map(renderCard)}
          </div>
        </div>
      ))}

      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20, cursor:"zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth:"95%", maxHeight:"95%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}
    </div>
  );
}

// ── 零用金帳本（獨立分頁）：撥款／花費／餘額＋工種歸屬＋文字貼上匯入 ──────────────
// ── 共用元件：日期欄（全 App 同一套；不會跳的原生選擇器）──────────────────────
function DateField({ value, onChange, style, title }) {
  const iso = String(value ?? "").replace(/\//g, "-").slice(0, 10);
  return <input type="date" value={iso} title={title} onChange={e => onChange(e.target.value)}
    style={{ border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 7px", fontSize: 13, fontFamily: "'Noto Sans TC', sans-serif", colorScheme: "light", cursor: "pointer", background: "#fff", color: iso ? "#211C15" : "#9A8F78", ...(style || {}) }} />;
}

const PETTY_MISC = "__misc__";
export function PettyCashView({ petty, setPetty, cats, setCats, canEdit, confirm }) {
  const advances = petty?.advances || [];
  const spends = petty?.spends || [];
  const advTotal = advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const spendTotal = spends.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const balance = advTotal - spendTotal;
  const catName = (id) => id === PETTY_MISC ? "（未歸類）" : (cats.find(c => c.id === id)?.name || "（未歸類）");
  const catColor = (id) => { const palette = ["#C0392B","#3E72A8","#3C8C3C","#7A6F58","#8E7CC3","#C2872E","#2A9D8F","#A0522D"]; if (id === PETTY_MISC) return "#9A8F78"; const i = cats.findIndex(c => c.id === id); return palette[(i < 0 ? 0 : i) % palette.length]; };
  const byCat = {}; spends.forEach(s => { const k = s.catId || PETTY_MISC; byCat[k] = (byCat[k] || 0) + (Number(s.amount) || 0); });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catRows.map(r => r[1]));

  const guard = () => { if (!canEdit) { alert("沒有編輯權限，請聯絡管理員開放「總覽/工程資料」。"); return false; } return true; };
  const upd = (next) => setPetty(next);
  const addAdv = () => guard() && upd({ ...petty, advances: [...advances, { id: "a" + Date.now(), date: "", amount: 0, note: "" }] });
  const setAdv = (id, k, v) => upd({ ...petty, advances: advances.map(a => a.id === id ? { ...a, [k]: v } : a) });
  const delAdv = async (id) => { if (!guard()) return; const a = advances.find(x => x.id === id); if (!(await confirm(`刪除這筆撥款紀錄（${fmt(a?.amount || 0)}）？`, { confirmLabel: "刪除" }))) return; upd({ ...petty, advances: advances.filter(a => a.id !== id) }); };
  const addSpend = () => { if (!guard()) return; const id = "s" + Date.now(); upd({ ...petty, spends: [...spends, { id, date: "", content: "", amount: 0, catId: PETTY_MISC }] }); setEditRowId(id); setShowRows(v => Math.max(v, spends.length + 5)); };
  const setSpend = (id, k, v) => upd({ ...petty, spends: spends.map(s => s.id === id ? { ...s, [k]: v } : s) });
  const delSpend = async (id) => { if (!guard()) return; const s = spends.find(x => x.id === id); if (!(await confirm(`刪除這筆花費「${s?.content || "（無內容）"}」（${fmt(s?.amount || 0)}）？`, { confirmLabel: "刪除" }))) return; upd({ ...petty, spends: spends.filter(s => s.id !== id) }); };

  const [imp, setImp] = useState(null);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const ctrlRef = useRef(null);
  const mapCat = (cat) => { if (!cat) return PETTY_MISC; const f = cats.find(c => c.name === cat || c.name.includes(cat) || cat.includes(c.name)); return f ? f.id : PETTY_MISC; };
  const runParse = async () => {
    const text = paste.trim(); if (!text || !guard()) return;
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    setImp({ busy: true, startedAt: Date.now() });
    const catList = cats.map(c => c.name).join("、");
    const sys = `你是零用金帳本解析器。把貼上的表格/文字解析成 JSON，只輸出一個 json 區塊、不要其他文字：
\`\`\`json
{"advances":[{"date":"2026-04-02","amount":20000}],"spends":[{"date":"2026-04-01","content":"工人便當","amount":390,"category":"生活支出","voucher":"發票","invoiceNo":"AB-12345678"}]}
\`\`\`
規則：1)「請款/預支/撥款/零用金」這種公司撥錢給人的項目(常是負數或大額整數)→放 advances，amount 用正數。2)其餘實際花費→放 spends。3)category 用原本分類詞(生活支出/油漆工程/電工水材廠商/雜項...)。4)金額一律正整數、去逗號。5)沒日期留空字串。6)voucher 用憑證欄的值，限：發票/收據/免用收據/支出單，沒有就空字串。7)invoiceNo 抓發票編號欄，沒有就空字串。8)現有工程大項：${catList}。`;
    const reply = await callAI([{ role: "user", content: `解析這份零用金明細：\n${text}` }], sys, "import", ctrl.signal);
    if (ctrlRef.current !== ctrl) return;
    let obj = null; const m = reply.match(/```json\s*([\s\S]*?)```/i); try { obj = JSON.parse(m ? m[1] : reply); } catch (_) {}
    if (!obj || (!obj.spends?.length && !obj.advances?.length)) { setImp(null); alert(/^（AI/.test(reply) ? reply.replace(/[（）]/g, "") : "沒解析到資料，請確認貼上的內容是否完整。"); return; }
    const VOK = ["發票", "收據", "免用收據", "支出單"];
    const rows = (obj.spends || []).map(s => ({ pick: true, date: s.date || "", content: String(s.content || "").trim(), amount: Math.abs(Math.round(Number(s.amount) || 0)), catId: mapCat(s.category), category: s.category || "", voucher: VOK.includes(s.voucher) ? s.voucher : "", invoiceNo: String(s.invoiceNo || "").trim() }));
    const advs = (obj.advances || []).map(a => ({ date: a.date || "", amount: Math.abs(Math.round(Number(a.amount) || 0)) }));
    setImp({ rows, advs });
  };
  const cancelParse = () => { try { ctrlRef.current?.abort(); } catch (_) {} ctrlRef.current = null; setImp(null); };
  const confirmParse = () => {
    const newSpends = (imp.rows || []).filter(r => r.pick && r.content).map(r => ({ id: "s" + Math.random().toString(36).slice(2, 8), date: r.date, content: r.content, amount: r.amount, catId: r.catId, voucher: r.voucher || "", invoiceNo: r.invoiceNo || "", handed: false, claimed: false, receipts: [], note: "" }));
    const newAdvs = (imp.advs || []).map(a => ({ id: "a" + Math.random().toString(36).slice(2, 8), date: a.date, amount: a.amount, note: "請款" }));
    upd({ advances: [...advances, ...newAdvs], spends: [...spends, ...newSpends] });
    setImp(null); setPaste(""); setShowPaste(false);
  };

  // ── 花費明細表：搜尋／篩選／排序／拖曳／上傳憑證 ──
  const [search, setSearch] = useState("");
  const [fCat, setFCat] = useState("all");
  const [fVoucher, setFVoucher] = useState("all");
  const [fClaimed, setFClaimed] = useState("all");
  const [editRowId, setEditRowId] = useState(null); // 檢視/編輯分離：只有這一列渲染成輸入框（其餘唯讀，快又乾淨）
  const [showRows, setShowRows] = useState(50);     // 分頁載入：預設 50 筆，按「顯示更多」再加
  const [sortKey, setSortKey] = useState(null); // "date" | "amount" | null(手動)
  const [sortDir, setSortDir] = useState("asc");
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [advDragId, setAdvDragId] = useState(null);
  const [advDragOverId, setAdvDragOverId] = useState(null);
  const [selected, setSelected] = useState(new Set()); // 勾選的花費 id（批次操作）
  const reorderAdv = (fromId, toId) => { if (fromId === toId) return; const arr = [...advances]; const fi = arr.findIndex(a => a.id === fromId), ti = arr.findIndex(a => a.id === toId); if (fi < 0 || ti < 0) return; const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m); upd({ ...petty, advances: arr }); };
  const toggleSel = (id, on) => setSelected(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });
  const bulkSetField = (field, val) => { upd({ ...petty, spends: spends.map(s => selected.has(s.id) ? { ...s, [field]: val } : s) }); };
  const bulkDelete = async () => { if (!(await confirm(`刪除選取的 ${selected.size} 筆花費？`, { confirmLabel: "刪除" }))) return; upd({ ...petty, spends: spends.filter(s => !selected.has(s.id)) }); setSelected(new Set()); };
  // ── AI 智慧歸類：依花費內容自動建議工種 → 預覽確認（無法辨識/錯誤可改下拉）→ 套用 ──
  const [classify, setClassify] = useState(null); // null | {busy,startedAt} | {rows:[{id,content,amount,old,sug}]}
  const classifyCtrlRef = useRef(null);
  const autoClassify = async () => {
    if (!guard()) return;
    const targets = spends.filter(s => s.content);
    if (!targets.length) { alert("沒有可歸類的花費"); return; }
    const ctrl = new AbortController(); classifyCtrlRef.current = ctrl;
    setClassify({ busy: true, startedAt: Date.now() });
    const catList = cats.map(c => c.name).join("、");
    const sys = `你是工程費用歸類助理。把每筆零用金花費依「內容」歸到最合適的工程大項。只輸出一個 json 區塊、不要其他文字：
\`\`\`json
{"map":[{"id":"s_xxx","cat":"油漆防水工程"}]}
\`\`\`
歸類原則：油漆/批土/防水/打樣→油漆相關大項；水電/電線/開關/插座/排水/水管→機電或消防相關；燈具/軌道燈→燈具相關；木皮/木作/角材/櫃→木工相關；磁磚/地坪→地坪相關；清潔/打掃/拖把→清潔相關大項；便當/飲料/餐費/計程車/停車/運費/搬運工/小工/雜工/影印 這種交通餐費雜支→歸到清單裡名稱含「雜支」或「交通餐費」的大項（清單裡有就用它）。一定要從清單挑最接近的大項名稱，真的完全對不到才回「未歸類」。現有工程大項：${catList}。`;
    const input = targets.map(s => ({ id: s.id, 內容: s.content })).slice(0, 250);
    const reply = await callAI([{ role: "user", content: `歸類這些花費，回每筆的 id 與最合適的工程大項名稱：\n${JSON.stringify(input)}` }], sys, "import", ctrl.signal);
    if (classifyCtrlRef.current !== ctrl) return;
    let obj = null; const m = reply.match(/```json\s*([\s\S]*?)```/i); try { obj = JSON.parse(m ? m[1] : reply); } catch (_) {}
    if (!obj?.map?.length) { setClassify(null); alert(/^（AI/.test(reply) ? reply.replace(/[（）]/g, "") : "AI 沒有回傳歸類結果，請再試一次。"); return; }
    const byId = {}; obj.map.forEach(x => { byId[x.id] = x.cat; });
    const rows = targets.map(s => ({ id: s.id, content: s.content, amount: s.amount, old: s.catId || PETTY_MISC, sug: mapCat(byId[s.id]) }));
    setClassify({ rows });
  };
  const cancelClassify = () => { try { classifyCtrlRef.current?.abort(); } catch (_) {} classifyCtrlRef.current = null; setClassify(null); };
  const setClassifyRow = (id, catId) => setClassify(c => ({ ...c, rows: c.rows.map(r => r.id === id ? { ...r, sug: catId } : r) }));
  const applyClassify = () => { const map = {}; classify.rows.forEach(r => { map[r.id] = r.sug; }); upd({ ...petty, spends: spends.map(s => map[s.id] != null ? { ...s, catId: map[s.id] } : s) }); setClassify(null); };

  const VOUCHER_OPTS = [["", "—", "#9A8F78"], ["發票", "發票", "#7A3E1D"], ["收據", "收據", "#C0392B"], ["免用收據", "免用收據", "#2E7D32"], ["支出單", "支出單", "#6B6450"], ["其他", "其他", "#8E7CC3"]];
  const voucherColor = (v) => (VOUCHER_OPTS.find(o => o[0] === (v || "")) || VOUCHER_OPTS[0])[2];

  const reorderSpend = (fromId, toId) => {
    if (fromId === toId) return;
    const arr = [...spends]; const fi = arr.findIndex(s => s.id === fromId), ti = arr.findIndex(s => s.id === toId);
    if (fi < 0 || ti < 0) return; const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m); upd({ ...petty, spends: arr });
  };
  const toggleSort = (k) => { if (sortKey === k) { if (sortDir === "asc") setSortDir("desc"); else { setSortKey(null); } } else { setSortKey(k); setSortDir("asc"); } };
  const manualOrder = !sortKey && !search.trim() && fCat === "all" && fVoucher === "all" && fClaimed === "all";

  // 套用搜尋/篩選/排序
  let viewSpends = spends.filter(s => {
    const q = search.trim().toLowerCase();
    if (q && !(`${s.content || ""} ${s.invoiceNo || ""} ${s.note || ""}`.toLowerCase().includes(q))) return false;
    if (fCat !== "all" && (s.catId || PETTY_MISC) !== fCat) return false;
    if (fVoucher !== "all" && (s.voucher || "") !== fVoucher) return false;
    if (fClaimed === "yes" && !s.claimed) return false;
    if (fClaimed === "no" && s.claimed) return false;
    return true;
  });
  if (sortKey) viewSpends = [...viewSpends].sort((a, b) => { const av = sortKey === "amount" ? (Number(a.amount) || 0) : (a.date || ""); const bv = sortKey === "amount" ? (Number(b.amount) || 0) : (b.date || ""); const r = av < bv ? -1 : av > bv ? 1 : 0; return sortDir === "asc" ? r : -r; });
  const viewTotal = viewSpends.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const kpi = (label, val, color) => <div style={{ flex: 1, minWidth: 150, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 16px" }}><div style={{ fontSize: 12.5, color: SUB }}>{label}</div><div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{fmt(val)}</div></div>;
  const cellInput = (val, onCh, opts = {}) => <input value={val} onChange={e => onCh(e.target.value)} placeholder={opts.ph} style={{ width: opts.w || "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 7px", fontSize: 13, background: "#fff", color: TEXT, ...(opts.style || {}) }} />;
  const thStyle = (k) => ({ padding: "8px 6px", fontSize: 11.5, fontWeight: 600, color: SUB, whiteSpace: "nowrap", textAlign: "left", cursor: k ? "pointer" : "default", userSelect: "none" });
  const sortArrow = (k) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div style={{ maxWidth: 1100, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#211C15" }}>💵 零用金帳本</div>
        <div style={{ fontSize: 12.5, color: SUB }}>撥款給工地的現金，與實際花費分開記；花費依工種歸屬，併入工程實際成本。</div>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0" }}>
        {kpi("撥款合計（請款）", advTotal, "#C2410C")}
        {kpi("花費合計（實支）", spendTotal, "#3C8C3C")}
        {kpi("餘額（撥款−花費）", balance, balance < 0 ? "#b3261e" : "#211C15")}
      </div>

      {/* 各工種花費（點分類＝只看該類明細，像分類抽屜）*/}
      {catRows.length > 0 && (
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>各工種零用金花費</div>
            <span style={{ fontSize: 11.5, color: "#9b9384" }}>· 共 {catRows.length} 類 · 點分類只看該類明細 · 已併入該工種實際成本</span>
            {fCat !== "all" && <button onClick={() => setFCat("all")} style={{ marginLeft: "auto", border: `1px solid ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 12, padding: "2px 10px", fontSize: 11.5, cursor: "pointer" }}>✕ 清除分類篩選</button>}
          </div>
          {catRows.map(([id, amt]) => {
            const cnt = spends.filter(s => (s.catId || PETTY_MISC) === id).length;
            const active = fCat === id;
            return (
              <div key={id} onClick={() => setFCat(active ? "all" : id)} title="點一下：下方明細只看這一類（再點取消）" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, cursor: "pointer", background: active ? "#ece4d6" : "transparent", borderRadius: 8, padding: "3px 6px", border: `1px solid ${active ? "#E0D6BE" : "transparent"}` }}>
                <div style={{ width: 150, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: active ? ACCENT : TEXT, fontWeight: active ? 700 : 500 }}>{catName(id)} <span style={{ color: "#9b9384", fontWeight: 400 }}>· {cnt}筆</span></div>
                <div style={{ flex: 1, height: 14, background: "#e6ddc9", borderRadius: 7, overflow: "hidden" }}><div style={{ width: (amt / maxCat * 100) + "%", height: "100%", background: catColor(id), borderRadius: 7 }} /></div>
                <div style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 600, color: TEXT, fontVariantNumeric: "tabular-nums" }}>{fmt(amt)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* 貼上匯入 */}
      <div style={{ marginBottom: 14 }}>
        {!showPaste ? (
          <button onClick={() => { if (guard()) setShowPaste(true); }} style={{ border: `1px solid ${ACCENT}`, background: "#FBF0EA", color: ACCENT, borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>📋 貼上整批花費明細 → AI 解析匯入（建議用文字，最快最準）</button>
        ) : (
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>把你整理好的明細（日期 / 內容 / 金額 / 分類）整段貼進來，一次帶入：</div>
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={6} placeholder={"例：\n4/1 工人便當 390 生活支出\n4/26 油漆一進 11508 油漆工程\n4/2 請款2萬零用金 -20000 零用金"} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={runParse} disabled={!paste.trim()} style={{ border: "none", background: paste.trim() ? ACCENT : "#d9cfbd", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13.5, fontWeight: 600, cursor: paste.trim() ? "pointer" : "not-allowed" }}>解析</button>
              <button onClick={() => { setShowPaste(false); setPaste(""); }} style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13.5, cursor: "pointer" }}>收起</button>
            </div>
          </div>
        )}
      </div>

      {/* 花費明細（專業表格：搜尋/篩選/排序/拖曳/憑證上傳） */}
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
        {/* 工具列 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#ece4d6", borderBottom: `1px solid ${BORDER}`, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>花費明細</div>
          <span style={{ fontSize: 12, color: SUB }}>{viewSpends.length}/{spends.length} 筆 · 合計 {fmt(viewTotal)}</span>
          <div style={{ flex: 1 }} />
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#9b9384" }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋內容/發票號/備註" style={{ width: 180, border: `1px solid ${BORDER}`, borderRadius: 7, padding: "6px 8px 6px 26px", fontSize: 12.5, background: "#fff" }} />
          </div>
          <select value={fCat} onChange={e => setFCat(e.target.value)} title="篩選工種" style={{ border: `1px solid ${fCat !== "all" ? ACCENT : BORDER}`, borderRadius: 7, padding: "6px 6px", fontSize: 12, background: "#fff", color: TEXT }}>
            <option value="all">全部工種</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={PETTY_MISC}>（未歸類）</option>
          </select>
          <select value={fVoucher} onChange={e => setFVoucher(e.target.value)} title="篩選憑證" style={{ border: `1px solid ${fVoucher !== "all" ? ACCENT : BORDER}`, borderRadius: 7, padding: "6px 6px", fontSize: 12, background: "#fff", color: TEXT }}>
            <option value="all">全部憑證</option>{VOUCHER_OPTS.slice(1).map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}<option value="">未填</option>
          </select>
          <select value={fClaimed} onChange={e => setFClaimed(e.target.value)} title="篩選請款狀態" style={{ border: `1px solid ${fClaimed !== "all" ? ACCENT : BORDER}`, borderRadius: 7, padding: "6px 6px", fontSize: 12, background: "#fff", color: TEXT }}>
            <option value="all">請款：全部</option><option value="yes">已請款</option><option value="no">未請款</option>
          </select>
          <button onClick={autoClassify} title="AI 依花費內容自動建議工種，再讓你確認/調整" style={{ border: `1px solid ${ACCENT}`, background: "#FBF0EA", color: ACCENT, borderRadius: 7, padding: "6px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>🤖 AI 自動歸類</button>
          <button onClick={addSpend} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>＋ 新增</button>
        </div>
        {/* 批次操作列（勾選後出現）*/}
        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#FFF7E6", borderBottom: `1px solid #F0D98C`, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>已選 {selected.size} 筆</span>
            <span style={{ fontSize: 12.5, color: "#92400e" }}>批次改工種：</span>
            <select defaultValue="" onChange={e => { if (e.target.value) { bulkSetField("catId", e.target.value); e.target.value = ""; } }} style={{ border: `1px solid #C2872E`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, background: "#fff", color: TEXT }}>
              <option value="">選工種…</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={PETTY_MISC}>（未歸類）</option>
            </select>
            <span style={{ fontSize: 12.5, color: "#92400e" }}>憑證：</span>
            <select defaultValue="" onChange={e => { bulkSetField("voucher", e.target.value === "__none" ? "" : e.target.value); e.target.value = ""; }} style={{ border: `1px solid #C2872E`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, background: "#fff", color: TEXT }}>
              <option value="">選憑證…</option>{VOUCHER_OPTS.slice(1).map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}<option value="__none">清空</option>
            </select>
            <button onClick={() => bulkSetField("claimed", true)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: TEXT, borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>標記已請款</button>
            <button onClick={bulkDelete} style={{ border: "1px solid #FCA5A5", background: "#fff", color: "#b3261e", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>刪除</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSelected(new Set())} style={{ border: "none", background: "none", color: SUB, fontSize: 12.5, cursor: "pointer" }}>取消選取</button>
          </div>
        )}
        {/* 表格 */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1000 }}>
            <thead>
              <tr style={{ background: "#ece4d6", borderBottom: `1px solid #E3DAC6` }}>
                <th style={{ ...thStyle(), width: 38, textAlign: "center" }}><input type="checkbox" title="全選/取消（目前顯示的）" checked={viewSpends.length > 0 && viewSpends.every(s => selected.has(s.id))} onChange={e => { const n = new Set(selected); viewSpends.forEach(s => e.target.checked ? n.add(s.id) : n.delete(s.id)); setSelected(n); }} style={{ cursor: "pointer" }} /></th>
                <th style={thStyle("date")} onClick={() => toggleSort("date")}>日期{sortArrow("date")}</th>
                <th style={thStyle()}>工種</th>
                <th style={thStyle()}>內容</th>
                <th style={{ ...thStyle("amount"), textAlign: "right" }} onClick={() => toggleSort("amount")}>金額{sortArrow("amount")}</th>
                <th style={thStyle()}>憑證</th>
                <th style={thStyle()}>發票編號</th>
                <th style={{ ...thStyle(), textAlign: "center" }}>已交</th>
                <th style={{ ...thStyle(), textAlign: "center" }}>已請款</th>
                <th style={thStyle()}>憑證檔</th>
                <th style={thStyle()}>備註</th>
                <th style={{ ...thStyle(), width: 24 }} />
              </tr>
            </thead>
            <tbody>
              {viewSpends.length === 0 ? (
                <tr><td colSpan={13} style={{ padding: 20, textAlign: "center", color: "#9b9384", fontSize: 13 }}>{spends.length ? "沒有符合條件的資料" : "尚無花費；可用上方「貼上整批花費明細」一次帶入，或按「＋ 新增」。"}</td></tr>
              ) : viewSpends.slice(0, showRows).map(s => {
                const editing = editRowId === s.id && canEdit;
                const cid = s.catId || PETTY_MISC;
                const catNm = cid === PETTY_MISC ? "（未歸類）" : ((cats.find(c => c.id === cid) || {}).name || "（未歸類）");
                const vLabel = (VOUCHER_OPTS.find(o => o[0] === (s.voucher || "")) || ["", "—"])[1];
                const rowProps = {
                  draggable: manualOrder && !editing,
                  onDragStart: () => manualOrder && setDragId(s.id),
                  onDragOver: (e) => { if (manualOrder && dragId) { e.preventDefault(); setDragOverId(s.id); } },
                  onDrop: () => { if (manualOrder && dragId) { reorderSpend(dragId, s.id); setDragId(null); setDragOverId(null); } },
                  onDragEnd: () => { setDragId(null); setDragOverId(null); },
                  onDoubleClick: () => canEdit && setEditRowId(s.id),
                  style: { borderBottom: "1px solid #e6ddc9", background: editing ? "#fbeee6" : (selected.has(s.id) ? "#FFF7E6" : (dragOverId === s.id ? "#fbeee6" : "transparent")) },
                };
                // 檢視/編輯分離（Manus P0）：預設唯讀文字（好讀、快、不誤觸），✎ 或雙擊才進編輯
                if (!editing) return (
                  <tr key={s.id} {...rowProps}>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}><input type="checkbox" checked={selected.has(s.id)} onChange={e => toggleSel(s.id, e.target.checked)} style={{ cursor: "pointer", verticalAlign: "middle" }} />{manualOrder && <span title="拖曳排序" style={{ color: "#C8BCA0", cursor: "grab", fontSize: 12, marginLeft: 3 }}>⠿</span>}</td>
                    <td style={{ padding: "6px 7px", fontSize: 12.5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: s.date ? TEXT : "#9b9384" }}>{s.date || "—"}</td>
                    <td style={{ padding: "6px 7px" }}><span style={{ display: "inline-block", color: catColor(cid), fontWeight: 600, fontSize: 12, background: catColor(cid) + "14", border: `1px solid ${catColor(cid)}33`, borderRadius: 12, padding: "2px 9px", whiteSpace: "nowrap" }}>{catNm}</span></td>
                    <td style={{ padding: "6px 7px", fontSize: 13, minWidth: 200, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.content || <span style={{ color: "#9b9384" }}>—</span>}</td>
                    <td style={{ padding: "6px 7px", fontSize: 13, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, whiteSpace: "nowrap" }}>{(Number(s.amount) || 0).toLocaleString()}</td>
                    <td style={{ padding: "6px 7px" }}>{s.voucher ? <span style={{ color: "#fff", fontWeight: 600, fontSize: 11.5, background: voucherColor(s.voucher), borderRadius: 8, padding: "2px 8px", whiteSpace: "nowrap" }}>{vLabel}</span> : <span style={{ color: "#9b9384", fontSize: 12 }}>—</span>}</td>
                    <td style={{ padding: "6px 7px", fontSize: 12, fontVariantNumeric: "tabular-nums", color: s.invoiceNo ? TEXT : "#9b9384" }}>{s.invoiceNo || "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 13, color: s.handed ? "#3f7d4e" : "#c8bca6" }}>{s.handed ? "✓" : "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 13, color: s.claimed ? "#c4582a" : "#c8bca6" }}>{s.claimed ? "✓" : "—"}</td>
                    <td style={{ padding: 3 }}><ReceiptUploader receipts={s.receipts || []} onChange={list => setSpend(s.id, "receipts", list)} /></td>
                    <td style={{ padding: "6px 7px", fontSize: 12.5, minWidth: 120, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: s.note ? TEXT : "#9b9384" }}>{s.note || "—"}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{canEdit && <button onClick={() => setEditRowId(s.id)} title="編輯這一列（也可雙擊該列）" style={{ border: "none", background: "none", color: "#9b9384", cursor: "pointer", fontSize: 13 }} onMouseEnter={e => e.currentTarget.style.color = ACCENT} onMouseLeave={e => e.currentTarget.style.color = "#9b9384"}>✎</button>}</td>
                  </tr>
                );
                return (
                <tr key={s.id} {...rowProps}>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}><input type="checkbox" checked={selected.has(s.id)} onChange={e => toggleSel(s.id, e.target.checked)} style={{ cursor: "pointer", verticalAlign: "middle" }} /></td>
                  <td style={{ padding: 3 }}><DateField value={s.date} onChange={v => setSpend(s.id, "date", v)} style={{ width: 134, padding: "5px 6px", fontSize: 12.5 }} /></td>
                  <td style={{ padding: 3 }}>
                    <select value={s.catId || PETTY_MISC} onChange={e => setSpend(s.id, "catId", e.target.value)} style={{ minWidth: 110, border: `1px solid ${catColor(s.catId || PETTY_MISC)}`, color: catColor(s.catId || PETTY_MISC), fontWeight: 600, borderRadius: 12, padding: "4px 6px", fontSize: 12, background: catColor(s.catId || PETTY_MISC) + "14" }}>
                      {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={PETTY_MISC}>（未歸類）</option>
                    </select>
                  </td>
                  <td style={{ padding: 3, minWidth: 200 }}><input value={s.content || ""} onChange={e => setSpend(s.id, "content", e.target.value)} placeholder="花費內容" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 7px", fontSize: 13 }} /></td>
                  <td style={{ padding: 3 }}><input type="number" value={s.amount || ""} onChange={e => setSpend(s.id, "amount", Math.abs(Math.round(Number(e.target.value) || 0)))} style={{ width: 88, textAlign: "right", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 7px", fontSize: 13, fontVariantNumeric: "tabular-nums" }} /></td>
                  <td style={{ padding: 3 }}>
                    <select value={s.voucher || ""} onChange={e => setSpend(s.id, "voucher", e.target.value)} style={{ border: `1px solid ${voucherColor(s.voucher)}`, color: s.voucher ? "#fff" : "#9b9384", fontWeight: 600, borderRadius: 8, padding: "4px 6px", fontSize: 12, background: s.voucher ? voucherColor(s.voucher) : "#fff" }}>
                      {VOUCHER_OPTS.map(o => <option key={o[0]} value={o[0]} style={{ color: "#000", background: "#fff" }}>{o[1]}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 3 }}><input value={s.invoiceNo || ""} onChange={e => setSpend(s.id, "invoiceNo", e.target.value)} placeholder="—" style={{ width: 110, border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 6px", fontSize: 12 }} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!s.handed} onChange={e => setSpend(s.id, "handed", e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#3C8C3C" }} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!s.claimed} onChange={e => setSpend(s.id, "claimed", e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#3E72A8" }} /></td>
                  <td style={{ padding: 3 }}><ReceiptUploader receipts={s.receipts || []} onChange={list => setSpend(s.id, "receipts", list)} /></td>
                  <td style={{ padding: 3, minWidth: 120 }}><input value={s.note || ""} onChange={e => setSpend(s.id, "note", e.target.value)} placeholder="—" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 6px", fontSize: 12.5 }} /></td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <button onClick={() => setEditRowId(null)} title="完成編輯" style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "3px 8px", fontWeight: 600 }}>完成</button>
                    <button onClick={() => delSpend(s.id)} title="刪除" style={{ border: "none", background: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 15, marginLeft: 2 }} onMouseEnter={e => e.currentTarget.style.color = "#b3261e"} onMouseLeave={e => e.currentTarget.style.color = "#C8BCA0"}>×</button>
                  </td>
                </tr>
                );
              })}
              {viewSpends.length > showRows && (
                <tr><td colSpan={13} style={{ padding: 0 }}><button onClick={() => setShowRows(r => r + 100)} style={{ width: "100%", padding: "10px 16px", border: "none", borderTop: `1px solid #e6ddc9`, background: "#f4efe5", color: ACCENT, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>顯示更多（還有 {viewSpends.length - showRows} 筆）</button></td></tr>
              )}
              <tr><td colSpan={13} style={{ padding: 0 }}><button onClick={addSpend} style={{ width: "100%", textAlign: "left", padding: "11px 16px", border: "none", borderTop: `1px dashed ${BORDER}`, background: "#FBF7EE", color: ACCENT, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 在這裡新增一筆花費</button></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 撥款紀錄（移到最下面，不再夾在花費圖表與明細中間）*/}
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", background: "#ece4d6", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}><span style={{ background: ACCENT, color:"#fff", fontSize:11, fontWeight:700, borderRadius:4, padding:"2px 8px", letterSpacing:1 }}>請款</span><div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>撥款紀錄 · {advances.length} 筆<span style={{ fontSize: 11.5, color: "#9b9384", fontWeight: 400 }}>　公司撥現金給工地（不計工程成本）</span></div></div>
          <button onClick={addAdv} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: TEXT, borderRadius: 7, padding: "4px 12px", fontSize: 12.5, cursor: "pointer" }}>＋ 新增撥款</button>
        </div>
        {advances.length === 0 ? <div style={{ padding: 16, textAlign: "center", color: "#9b9384", fontSize: 13 }}>尚無撥款紀錄</div> : advances.map(a => (
          <div key={a.id}
            draggable
            onDragStart={() => setAdvDragId(a.id)}
            onDragOver={e => { if (advDragId) { e.preventDefault(); setAdvDragOverId(a.id); } }}
            onDrop={() => { if (advDragId) { reorderAdv(advDragId, a.id); setAdvDragId(null); setAdvDragOverId(null); } }}
            onDragEnd={() => { setAdvDragId(null); setAdvDragOverId(null); }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: `1px solid #e6ddc9`, background: advDragOverId === a.id ? "#fbeee6" : "transparent" }}>
            <span title="拖曳排序" style={{ color: "#C8BCA0", cursor: "grab", fontSize: 13, flexShrink: 0 }}>⠿</span>
            <DateField value={a.date} onChange={v => setAdv(a.id, "date", v)} style={{ width: 140 }} />
            {cellInput(a.note || "", v => setAdv(a.id, "note", v), { ph: "說明（請款）" })}
            <input type="number" value={a.amount || ""} onChange={e => setAdv(a.id, "amount", Math.abs(Math.round(Number(e.target.value) || 0)))} style={{ width: 120, textAlign: "right", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 7px", fontSize: 13, fontVariantNumeric: "tabular-nums" }} />
            <div style={{ flexShrink: 0 }} title="請款單憑證（可貼截圖）"><ReceiptUploader receipts={a.receipts || []} onChange={list => setAdv(a.id, "receipts", list)} /></div>
            <button onClick={() => delAdv(a.id)} style={{ border: "none", background: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 16, flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.color = "#b3261e"} onMouseLeave={e => e.currentTarget.style.color = "#C8BCA0"}>×</button>
          </div>
        ))}
        {advances.length > 0 && <button onClick={addAdv} style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderTop: `1px dashed ${BORDER}`, background: "#FBF7EE", color: ACCENT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>＋ 在這裡新增一筆撥款</button>}
      </div>

      <div style={{ fontSize: 11.5, color: "#9b9384", marginTop: 10, lineHeight: 1.7 }}>※ 點欄位標題（日期／金額）可排序；清空搜尋/篩選後可拖曳 ⠿ 排序。憑證檔可按「＋」上傳，或在該格直接貼上截圖。請款（撥款）不算工程成本；花費已依工種併入各大項實際成本。</div>

      {/* AI 歸類預覽：自動建議工種 → 確認/調整 → 套用 */}
      {classify && (
        <div onClick={e => e.target === e.currentTarget && !classify.busy && setClassify(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "min(820px,96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, fontSize: 15, fontWeight: 700, color: TEXT }}>🤖 AI 自動歸類工種（確認後套用）</div>
            {classify.busy ? (
              <div style={{ padding: "44px 24px", textAlign: "center" }}>
                <div style={{ color: ACCENT, fontSize: 15, fontWeight: 600 }}>🤖 AI 分析中…<ImportElapsed startedAt={classify.startedAt} /></div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 8 }}>依每筆內容判斷工種，通常 10–30 秒。</div>
                <button onClick={cancelClassify} style={{ marginTop: 16, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, borderRadius: 8, padding: "8px 22px", fontSize: 14, cursor: "pointer" }}>取消</button>
              </div>
            ) : (() => {
              const changed = classify.rows.filter(r => r.sug !== r.old).length;
              return (<>
                <div style={{ padding: "10px 18px", borderBottom: `1px solid ${BORDER}`, fontSize: 12.5, color: SUB }}>共 {classify.rows.length} 筆，AI 建議調整 <b style={{ color: ACCENT }}>{changed}</b> 筆。<span style={{ color: "#9b9384" }}>不對的用右邊下拉改，確認後一次套用。</span></div>
                <div style={{ flex: 1, overflowY: "auto", padding: "4px 18px" }}>
                  {classify.rows.map(r => {
                    const isChanged = r.sug !== r.old;
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #F2ECDD", background: isChanged ? "#FBF7EE" : "transparent" }}>
                        <span style={{ flex: 1, fontSize: 13, color: TEXT, minWidth: 100 }}>{r.content}</span>
                        <span style={{ width: 70, textAlign: "right", fontSize: 12.5, color: SUB, fontVariantNumeric: "tabular-nums" }}>{fmt(r.amount)}</span>
                        <span style={{ width: 92, fontSize: 11.5, color: "#9b9384", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catName(r.old)}</span>
                        <span style={{ color: isChanged ? ACCENT : "#C8BCA0", fontSize: 13 }}>→</span>
                        <select value={r.sug} onChange={e => setClassifyRow(r.id, e.target.value)} style={{ width: 150, border: `1px solid ${isChanged ? ACCENT : BORDER}`, borderRadius: 7, padding: "5px 6px", fontSize: 12.5, background: "#fff", color: isChanged ? ACCENT : TEXT, fontWeight: isChanged ? 700 : 400 }}>
                          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={PETTY_MISC}>（未歸類）</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: "12px 18px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => setClassify(null)} style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 18px", fontSize: 14, cursor: "pointer" }}>取消</button>
                  <button onClick={applyClassify} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>套用歸類（{classify.rows.length} 筆）</button>
                </div>
              </>);
            })()}
          </div>
        </div>
      )}

      {/* 匯入預覽 */}
      {imp && (
        <div onClick={e => e.target === e.currentTarget && !imp.busy && setImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "min(760px,96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, fontSize: 15, fontWeight: 700, color: TEXT }}>📋 零用金匯入預覽</div>
            {imp.busy ? (
              <div style={{ padding: "44px 24px", textAlign: "center" }}>
                <div style={{ color: ACCENT, fontSize: 15, fontWeight: 600 }}>🤖 解析中…<ImportElapsed startedAt={imp.startedAt} /></div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 8 }}>文字解析通常 5–20 秒。太久可按「取消」。</div>
                <button onClick={cancelParse} style={{ marginTop: 16, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, borderRadius: 8, padding: "8px 22px", fontSize: 14, cursor: "pointer" }}>取消</button>
              </div>
            ) : (<>
              <div style={{ padding: "10px 18px", borderBottom: `1px solid ${BORDER}`, fontSize: 12.5, color: SUB }}>撥款 {(imp.advs || []).length} 筆、花費 {(imp.rows || []).length} 筆。可調整工種後再匯入。</div>
              <div style={{ flex: 1, overflowY: "auto", padding: "4px 18px" }}>
                {(imp.rows || []).map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #F2ECDD" }}>
                    <input type="checkbox" checked={r.pick} onChange={e => setImp({ ...imp, rows: imp.rows.map((x, j) => j === i ? { ...x, pick: e.target.checked } : x) })} />
                    <span style={{ width: 80, fontSize: 12, color: SUB }}>{r.date || "—"}</span>
                    <span style={{ flex: 1, fontSize: 13, color: TEXT }}>{r.content}</span>
                    <span style={{ width: 80, textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmt(r.amount)}</span>
                    <select value={r.catId} onChange={e => setImp({ ...imp, rows: imp.rows.map((x, j) => j === i ? { ...x, catId: e.target.value } : x) })} style={{ width: 140, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "4px 6px", fontSize: 12, background: "#fff" }}>
                      {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      <option value={PETTY_MISC}>（未歸類）</option>
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ padding: "12px 18px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setImp(null)} style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 18px", fontSize: 14, cursor: "pointer" }}>取消</button>
                <button onClick={confirmParse} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>確認匯入</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}