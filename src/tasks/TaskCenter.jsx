// ── 任務中心（獨立模組）────────────────────────────────────────────────────
// 合併取代「工序 + ToDo」。單一資料 pm_tasks，多視角同步：看板 / 清單 / 依大項分組。
// 小標籤可拖曳排序、拖到任一大項自動歸屬。隨手記 → 先進收件匣，之後再整理。
// App 以 props 傳 K / confirm / canEdit / cats(工程大項，給「隸屬」用) / onLog。
import { useState, useEffect, useMemo } from "react";

const C = { text: "#211C15", sub: "#6F6656", faint: "#A99F88", line: "#D8CFBB", soft: "#F1ECDD", bg: "#FCFAF4", card: "#FFFFFF", head: "#F6F2E8", accent: "#C13A22", soft2: "#F3E4DE" };
const STATUS = [["todo", "待辦", "#6F6656"], ["doing", "進行中", "#3E72A8"], ["done", "完成", "#3C8C3C"]];
const PRIO = [["urgent", "🔥 超急", "#C0392B"], ["high", "高", "#C2872E"], ["normal", "一般", "#6F6656"], ["low", "低", "#A99F88"]];
const sLabel = (s) => (STATUS.find(x => x[0] === s) || STATUS[0])[1];
const sColor = (s) => (STATUS.find(x => x[0] === s) || STATUS[0])[2];
const pMeta = (p) => PRIO.find(x => x[0] === p) || PRIO[2];
const INBOX = "__inbox__";
const rid = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);
const dnorm = (v) => String(v ?? "").replace(/\//g, "-").slice(0, 10);
const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 9px", fontSize: 13, background: "#fff", color: C.text, boxSizing: "border-box", outline: "none" };
const dateInp = { ...inp, colorScheme: "light", fontFamily: "'Noto Sans TC',sans-serif", cursor: "pointer" };

export default function TaskCenter({ K, confirm, canEdit, cats, onLog }) {
  const [tasks, setTasks] = useState(null);
  const [view, setView] = useState("group"); // group | board | list
  const [quick, setQuick] = useState("");
  const [sel, setSel] = useState(null);     // 開啟詳情的任務 id
  const [drag, setDrag] = useState(null);   // 拖曳中的任務 id
  const [overKey, setOverKey] = useState(null); // 拖過的群組/欄
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("open"); // list 篩選
  const [gnew, setGnew] = useState({}); // 各大項的「直接新增」輸入

  useEffect(() => { (async () => {
    try {
      const r = await window.storage.get(K("pm_tasks"), true);
      if (r && r.value) { setTasks(JSON.parse(r.value)); return; }
      // 第一次：把舊 ToDo(pm_issues) 匯入成任務（一次性）
      let imported = [];
      try {
        const ti = await window.storage.get(K("pm_issues"), true);
        const iss = ti && ti.value ? JSON.parse(ti.value) : [];
        imported = (Array.isArray(iss) ? iss : []).map(i => ({
          id: rid(), title: i.desc || "(未命名)", note: i.answer || "", status: (i.status === "done" ? "done" : "todo"),
          catId: INBOX, start: "", due: dnorm(i.due), priority: i.track ? "normal" : "low",
          tags: i.category && i.category !== "其他" ? [i.category] : [], createdAt: i.ts || new Date().toISOString(), updatedAt: new Date().toISOString(),
        }));
      } catch (_) {}
      setTasks(imported);
      window.storage.set(K("pm_tasks"), JSON.stringify(imported), true).catch(() => {});
    } catch { setTasks([]); }
  })(); }, []); // eslint-disable-line

  const guard = () => { if (!canEdit) { alert("沒有編輯權限，請聯絡管理員。"); return false; } return true; };
  const save = (list) => { setTasks(list); window.storage.set(K("pm_tasks"), JSON.stringify(list), true).catch(() => {}); };
  const catName = (id) => id === INBOX || !id ? "📥 收件匣" : (cats || []).find(c => c.id === id)?.name || "📥 收件匣";

  const addQuick = () => {
    if (!guard()) return;
    const t = quick.trim(); if (!t) return;
    const task = { id: rid(), title: t, note: "", status: "todo", catId: INBOX, start: "", due: "", priority: "normal", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    save([task, ...(tasks || [])]); setQuick("");
    onLog?.("新增", `新增任務「${t.slice(0, 20)}」`);
  };
  const addToGroup = (catId) => {
    if (!guard()) return;
    const t = (gnew[catId] || "").trim(); if (!t) return;
    const task = { id: rid(), title: t, note: "", status: "todo", catId, start: "", due: "", priority: "normal", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    save([task, ...(tasks || [])]); setGnew(p => ({ ...p, [catId]: "" }));
    onLog?.("新增", `新增任務「${t.slice(0, 20)}」→${catName(catId)}`);
  };
  const upd = (id, patch) => { save((tasks || []).map(t => t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)); };
  const del = async (id) => { if (!guard()) return; const t = (tasks || []).find(x => x.id === id); if (!(await confirm(`刪除任務「${t?.title || ""}」？`, { confirmLabel: "刪除" }))) return; save((tasks || []).filter(x => x.id !== id)); setSel(null); onLog?.("刪除", `刪除任務「${(t?.title || "").slice(0, 20)}」`); };

  // 拖曳：把 dragId 移到 target 之前；可同時改 catId / status
  const moveTo = (dragId, { catId, status, beforeId } = {}) => {
    if (!guard() || !dragId) return;
    const list = [...(tasks || [])];
    const fi = list.findIndex(t => t.id === dragId); if (fi < 0) return;
    const moved = { ...list[fi] };
    if (catId !== undefined) moved.catId = catId;
    if (status !== undefined) moved.status = status;
    moved.updatedAt = new Date().toISOString();
    list.splice(fi, 1);
    let ti = beforeId ? list.findIndex(t => t.id === beforeId) : -1;
    if (ti < 0) {
      // 沒指定就放到「同群組」的最後
      const grpKey = catId !== undefined ? catId : moved.catId;
      const stKey = status !== undefined ? status : moved.status;
      let last = -1;
      list.forEach((t, idx) => { const okCat = view === "board" ? t.status === stKey : (t.catId || INBOX) === grpKey; if (okCat) last = idx; });
      ti = last + 1;
    }
    list.splice(ti, 0, moved);
    save(list);
  };

  if (tasks === null) return <div style={{ padding: 40, textAlign: "center", color: C.faint }}>載入中…</div>;

  const groups = [{ id: INBOX, name: "📥 收件匣" }, ...(cats || []).filter(c => !c.nonProject).map(c => ({ id: c.id, name: c.name }))];
  const tasksOf = (catId) => tasks.filter(t => (t.catId || INBOX) === catId);
  const open = tasks.filter(t => t.status !== "done");
  const matchQ = (t) => !q.trim() || (t.title + (t.note || "") + (t.tags || []).join("")).toLowerCase().includes(q.trim().toLowerCase());

  // ── 任務小卡 ──
  const Card = ({ t, dropBefore }) => {
    const pm = pMeta(t.priority);
    return (
      <div key={t.id} draggable={canEdit}
        onDragStart={e => { setDrag(t.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDrag(null); setOverKey(null); }}
        onDragOver={e => { if (drag && dropBefore) { e.preventDefault(); e.stopPropagation(); } }}
        onDrop={e => { if (drag && dropBefore) { e.preventDefault(); e.stopPropagation(); moveTo(drag, { catId: view === "group" ? t.catId : undefined, status: view === "board" ? t.status : undefined, beforeId: t.id }); setDrag(null); setOverKey(null); } }}
        onClick={() => setSel(t.id)}
        style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `3px solid ${t.priority === "urgent" ? "#C0392B" : sColor(t.status)}`, borderRadius: 8, padding: "8px 10px", marginBottom: 7, cursor: canEdit ? "grab" : "pointer", boxShadow: "0 1px 2px rgba(0,0,0,.04)", opacity: drag === t.id ? 0.4 : 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { status: t.status === "done" ? "todo" : "done" }); }}
            title="切換完成" style={{ flexShrink: 0, width: 16, height: 16, marginTop: 1, borderRadius: 4, border: `1.5px solid ${t.status === "done" ? "#3C8C3C" : C.line}`, background: t.status === "done" ? "#3C8C3C" : "#fff", color: "#fff", fontSize: 11, lineHeight: "13px", cursor: "pointer", padding: 0 }}>{t.status === "done" ? "✓" : ""}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: t.status === "done" ? C.faint : C.text, textDecoration: t.status === "done" ? "line-through" : "none", lineHeight: 1.4, wordBreak: "break-word" }}>{t.priority === "urgent" && "🔥"}{t.title}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 3 }}>
              {t.due && <span style={{ fontSize: 10.5, color: (!t.done && t.due < today()) ? "#C0392B" : C.sub, background: C.soft, borderRadius: 4, padding: "1px 5px" }}>📅 {t.due}</span>}
              {view !== "board" && <span style={{ fontSize: 10.5, color: "#fff", background: sColor(t.status), borderRadius: 4, padding: "1px 5px" }}>{sLabel(t.status)}</span>}
              {(t.tags || []).map(tg => <span key={tg} style={{ fontSize: 10.5, color: C.sub, background: C.soft, borderRadius: 4, padding: "1px 5px" }}>{tg}</span>)}
            </div>
          </div>
          {canEdit && <button onClick={e => { e.stopPropagation(); del(t.id); }} title="刪除" style={{ flexShrink: 0, background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }} onMouseEnter={e => e.currentTarget.style.color = "#C0392B"} onMouseLeave={e => e.currentTarget.style.color = C.faint}>×</button>}
        </div>
      </div>
    );
  };

  // 群組/欄 的落點容器（拖到空白處 → 歸到該群/欄末端）
  const DropZone = ({ keyId, onDropHere, children, style }) => (
    <div key={keyId}
      onDragOver={e => { if (drag) { e.preventDefault(); setOverKey(keyId); } }}
      onDragLeave={() => setOverKey(k => k === keyId ? null : k)}
      onDrop={e => { if (drag) { e.preventDefault(); onDropHere(); setDrag(null); setOverKey(null); } }}
      style={{ ...style, outline: overKey === keyId ? `2px dashed ${C.accent}` : "none", outlineOffset: -2 }}>
      {children}
    </div>
  );

  const Tab = (k, l) => <button key={k} onClick={() => setView(k)} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: view === k ? C.accent : "transparent", color: view === k ? "#fff" : C.sub, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{l}</button>;

  return (
    <div style={{ maxWidth: 1240, margin: "6px auto", padding: "0 4px" }}>
      {/* 標題 + 視角切換 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>✅ 任務中心</div>
        <span style={{ fontSize: 12, color: C.faint }}>{open.length} 件待辦・共 {tasks.length} 件</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", background: C.head, border: `1px solid ${C.line}`, borderRadius: 10, padding: 3, gap: 2, flexWrap: "wrap" }}>
          {Tab("group", "📁 依大項")}{Tab("board", "🗂 看板")}{Tab("list", "📋 清單")}{Tab("timeline", "📅 時間軸")}{Tab("gantt", "📊 甘特")}{Tab("mind", "🧠 心智圖")}
        </div>
      </div>

      {/* 快速隨手記 */}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) addQuick(); }}
            placeholder="＋ 隨手丟一句任務…（先進收件匣，之後再拖到大項整理）按 Enter 新增" style={{ ...inp, flex: 1, fontSize: 13.5, padding: "10px 12px" }} />
          <button onClick={addQuick} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "0 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>新增</button>
        </div>
      )}

      {/* ── 依大項分組 ── */}
      {view === "group" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12, alignItems: "start" }}>
          {groups.map(g => {
            const items = tasksOf(g.id).filter(matchQ);
            return DropZone({ keyId: g.id, onDropHere: () => moveTo(drag, { catId: g.id }),
              style: { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: 10, minHeight: 80 },
              children: <>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "0 2px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: g.id === INBOX ? C.accent : C.text }}>{g.name}</div>
                  <span style={{ fontSize: 11.5, color: C.faint }}>{items.length}</span>
                </div>
                {items.map(t => Card({ t, dropBefore: true }))}
                {items.length === 0 && <div style={{ fontSize: 11.5, color: C.faint, textAlign: "center", padding: "8px 0" }}>拖任務到這裡 →歸到此大項</div>}
                {canEdit && <input value={gnew[g.id] || ""} onChange={e => setGnew(p => ({ ...p, [g.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) addToGroup(g.id); }} placeholder="＋ 直接在此大項新增…" style={{ width: "100%", boxSizing: "border-box", border: `1px dashed ${C.line}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, background: "transparent", color: C.text, outline: "none", marginTop: 2 }} />}
              </> });
          })}
        </div>
      )}

      {/* ── 看板（依狀態） ── */}
      {view === "board" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, alignItems: "start" }}>
          {STATUS.map(([sk, sl, sc]) => {
            const items = tasks.filter(t => t.status === sk).filter(matchQ);
            return DropZone({ keyId: sk, onDropHere: () => moveTo(drag, { status: sk }),
              style: { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: 10, minHeight: 120 },
              children: <>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: sc }} />
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{sl}</div>
                  <span style={{ fontSize: 11.5, color: C.faint }}>{items.length}</span>
                </div>
                {items.map(t => Card({ t, dropBefore: true }))}
                {items.length === 0 && <div style={{ fontSize: 11.5, color: C.faint, textAlign: "center", padding: "10px 0" }}>拖到這欄</div>}
              </> });
          })}
        </div>
      )}

      {/* ── 清單 ── */}
      {view === "list" && (() => {
        let rows = tasks.filter(matchQ).filter(t => fStatus === "all" || (fStatus === "open" ? t.status !== "done" : t.status === fStatus));
        rows = [...rows].sort((a, b) => {
          const ord = { urgent: 0, high: 1, normal: 2, low: 3 };
          if ((a.due || "9") !== (b.due || "9")) return (a.due || "9999") < (b.due || "9999") ? -1 : 1;
          return (ord[a.priority] ?? 2) - (ord[b.priority] ?? 2);
        });
        return (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋任務…" style={{ ...inp, width: 220 }} />
              <div style={{ display: "inline-flex", gap: 4 }}>
                {[["open", "未完成"], ["all", "全部"], ["done", "已完成"]].map(([k, l]) => (
                  <button key={k} onClick={() => setFStatus(k)} style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${fStatus === k ? C.accent : C.line}`, background: fStatus === k ? C.accent : "#fff", color: fStatus === k ? "#fff" : C.sub, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.card, overflow: "hidden" }}>
              {rows.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>沒有任務</div> :
                rows.map((t, i) => (
                  <div key={t.id} onClick={() => setSel(t.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i ? `1px solid #EFE7D6` : "none", cursor: "pointer", background: i % 2 ? "#FBFAF5" : "#fff" }}>
                    <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { status: t.status === "done" ? "todo" : "done" }); }} style={{ flexShrink: 0, width: 17, height: 17, borderRadius: 4, border: `1.5px solid ${t.status === "done" ? "#3C8C3C" : C.line}`, background: t.status === "done" ? "#3C8C3C" : "#fff", color: "#fff", fontSize: 11, cursor: "pointer", padding: 0 }}>{t.status === "done" ? "✓" : ""}</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: t.status === "done" ? C.faint : C.text, textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.priority === "urgent" && "🔥"}{t.title}</div>
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>{catName(t.catId)}{t.due ? ` ・📅 ${t.due}` : ""}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 11, color: "#fff", background: sColor(t.status), borderRadius: 5, padding: "2px 8px" }}>{sLabel(t.status)}</span>
                  </div>
                ))}
            </div>
          </div>
        );
      })()}

      {/* ── 時間軸（依截止日分桶） ── */}
      {view === "timeline" && (() => {
        const t0 = today();
        const within = (d, n) => { if (!d) return false; const diff = (new Date(d) - new Date(t0)) / 86400000; return diff >= 0 && diff <= n; };
        const buckets = [
          ["🔴 逾期", tasks.filter(t => t.status !== "done" && t.due && t.due < t0)],
          ["📌 今天", tasks.filter(t => t.due === t0)],
          ["🗓 本週內", tasks.filter(t => t.status !== "done" && t.due && t.due > t0 && within(t.due, 7))],
          ["⏳ 之後", tasks.filter(t => t.due && t.due > t0 && !within(t.due, 7))],
          ["📥 無日期", tasks.filter(t => !t.due && t.status !== "done")],
        ].map(([label, arr]) => [label, arr.filter(matchQ).sort((a, b) => (a.due || "9") < (b.due || "9") ? -1 : 1)]);
        return (
          <div style={{ display: "grid", gap: 12 }}>
            {buckets.map(([label, arr]) => arr.length > 0 && (
              <div key={label} style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, marginBottom: 8 }}>{label} <span style={{ color: C.faint, fontSize: 11.5 }}>{arr.length}</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 }}>
                  {arr.map(t => Card({ t }))}
                </div>
              </div>
            ))}
            {tasks.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint }}>還沒有任務</div>}
          </div>
        );
      })()}

      {/* ── 甘特圖（依開始～截止日畫橫條） ── */}
      {view === "gantt" && (() => {
        const dayMs = 86400000, dayW = 24;
        const sched = tasks.filter(t => t.due || t.start).filter(matchQ);
        const unsched = tasks.filter(t => !t.due && !t.start).filter(matchQ);
        if (sched.length === 0) return <div style={{ padding: 30, textAlign: "center", color: C.faint }}>還沒有「有日期」的任務。到任務詳情設好開始/截止日，就會出現在甘特圖。</div>;
        const lo = (t) => new Date(dnorm(t.start || t.due));
        const hi = (t) => new Date(dnorm(t.due || t.start));
        let minD = new Date(Math.min(...sched.map(t => +lo(t)), +new Date(today())));
        let maxD = new Date(Math.max(...sched.map(t => +hi(t)), +new Date(today())));
        minD = new Date(+minD - 2 * dayMs); maxD = new Date(+maxD + 2 * dayMs);
        let totalDays = Math.round((maxD - minD) / dayMs) + 1;
        if (totalDays > 140) { maxD = new Date(+minD + 140 * dayMs); totalDays = 141; }
        const offset = (d) => Math.round((new Date(dnorm(d)) - minD) / dayMs);
        const ticks = []; for (let i = 0; i < totalDays; i += 7) { const d = new Date(+minD + i * dayMs); ticks.push({ i, label: `${d.getMonth() + 1}/${d.getDate()}` }); }
        const todayOff = offset(today());
        return (
          <div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.card, overflow: "auto" }}>
              <div style={{ minWidth: 200 + totalDays * dayW }}>
                {/* 週刻度 */}
                <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.head, zIndex: 1 }}>
                  <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "6px 10px", fontSize: 11.5, color: C.sub, fontWeight: 700 }}>任務</div>
                  <div style={{ position: "relative", height: 26 }}>
                    {ticks.map(tk => <div key={tk.i} style={{ position: "absolute", left: tk.i * dayW, top: 0, fontSize: 10.5, color: C.sub, padding: "6px 0 0 3px", borderLeft: `1px solid ${C.line}`, height: 26, boxSizing: "border-box" }}>{tk.label}</div>)}
                  </div>
                </div>
                {/* 任務列 */}
                {sched.sort((a, b) => +lo(a) - +lo(b)).map((t, i) => {
                  const s = offset(t.start || t.due), e = offset(t.due || t.start);
                  const left = Math.min(s, e), width = Math.abs(e - s) + 1;
                  return (
                    <div key={t.id} onClick={() => setSel(t.id)} style={{ display: "flex", alignItems: "center", borderTop: i ? `1px solid #EFE7D6` : "none", cursor: "pointer", background: i % 2 ? "#FBFAF5" : "#fff" }}>
                      <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "7px 10px", fontSize: 12.5, color: t.status === "done" ? C.faint : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.priority === "urgent" && "🔥"}{t.title}</div>
                      <div style={{ position: "relative", height: 30, flex: 1 }}>
                        {todayOff >= 0 && todayOff < totalDays && <div style={{ position: "absolute", left: todayOff * dayW, top: 0, bottom: 0, width: 1, background: "#C0392B", opacity: .5 }} />}
                        <div title={`${t.start || t.due} ~ ${t.due || t.start}`} style={{ position: "absolute", left: left * dayW + 2, top: 7, height: 16, width: Math.max(width * dayW - 4, 8), background: sColor(t.status), borderRadius: 5, opacity: t.status === "done" ? 0.5 : 1 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>紅線＝今天。點任務列可編輯日期。</div>
            {unsched.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>未排程（沒設日期）{unsched.length}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 }}>{unsched.map(t => Card({ t }))}</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 心智圖（中心→大項→任務 樹狀） ── */}
      {view === "mind" && (() => {
        const branches = groups.map(g => ({ g, items: tasksOf(g.id).filter(matchQ) })).filter(b => b.items.length > 0);
        if (branches.length === 0) return <div style={{ padding: 30, textAlign: "center", color: C.faint }}>還沒有任務</div>;
        return (
          <div style={{ overflowX: "auto", padding: "10px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "min-content" }}>
              <div style={{ background: C.accent, color: "#fff", borderRadius: 20, padding: "8px 20px", fontSize: 15, fontWeight: 800, boxShadow: "0 2px 6px rgba(0,0,0,.12)" }}>✅ 全部任務</div>
              <div style={{ width: 2, height: 18, background: C.line }} />
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "nowrap" }}>
                {branches.map(({ g, items }) => (
                  <div key={g.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 180 }}>
                    <div style={{ width: 2, height: 8, background: C.line }} />
                    <div style={{ background: g.id === INBOX ? C.soft2 : C.head, border: `1.5px solid ${g.id === INBOX ? C.accent : C.line}`, borderRadius: 12, padding: "7px 14px", fontSize: 13.5, fontWeight: 700, color: g.id === INBOX ? C.accent : C.text, whiteSpace: "nowrap" }}>{g.name} <span style={{ color: C.faint, fontWeight: 400, fontSize: 11 }}>{items.length}</span></div>
                    <div style={{ width: 2, height: 10, background: C.line }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "100%" }}>
                      {items.map(t => (
                        <div key={t.id} onClick={() => setSel(t.id)} style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `3px solid ${t.priority === "urgent" ? "#C0392B" : sColor(t.status)}`, borderRadius: 9, padding: "6px 10px", fontSize: 12.5, color: t.status === "done" ? C.faint : C.text, textDecoration: t.status === "done" ? "line-through" : "none", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>{t.priority === "urgent" && "🔥"}{t.title}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 任務詳情（點卡片開啟） ── */}
      {sel && (() => {
        const t = tasks.find(x => x.id === sel); if (!t) return null;
        const F = (label, node) => <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 10 }}>{label}<div style={{ marginTop: 4 }}>{node}</div></label>;
        return (
          <div onClick={e => e.target === e.currentTarget && setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "min(560px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>任務詳情</div>
                <div style={{ flex: 1 }} />
                <button onClick={() => del(t.id)} style={{ background: "none", border: `1px solid ${C.line}`, color: "#C0392B", borderRadius: 7, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>刪除</button>
                <button onClick={() => setSel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
              </div>
              {F("主題", <input value={t.title} onChange={e => upd(t.id, { title: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", fontSize: 14, fontWeight: 600 }} />)}
              {F("內容 / 備註", <textarea value={t.note || ""} onChange={e => upd(t.id, { note: e.target.value })} disabled={!canEdit} rows={3} style={{ ...inp, width: "100%", resize: "vertical" }} />)}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {F("隸屬大項", <select value={t.catId || INBOX} onChange={e => upd(t.id, { catId: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>)}
                {F("狀態", <select value={t.status} onChange={e => upd(t.id, { status: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
                {F("優先級", <select value={t.priority || "normal"} onChange={e => upd(t.id, { priority: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{PRIO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
                {F("截止日", <input type="date" value={dnorm(t.due)} onChange={e => upd(t.id, { due: e.target.value })} disabled={!canEdit} style={{ ...dateInp, width: "100%" }} />)}
                {F("開始日", <input type="date" value={dnorm(t.start)} onChange={e => upd(t.id, { start: e.target.value })} disabled={!canEdit} style={{ ...dateInp, width: "100%" }} />)}
              </div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>建立於 {dnorm(t.createdAt)}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
