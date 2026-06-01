import { useState, useRef, useEffect, useMemo } from "react";

/* ════════════════════════════════════════════════════════════════════════
 *  SequenceView ── 工序 × 施工日誌（接 ground-pm cats / pm_seqlogs）
 *  工序 = 工程大項(cats)；日誌 = 工序時間軸上的事件(pm_seqlogs)。
 *  排程支援實際日期、非連續多區段（item.segments=[{start,end}]）。
 * ════════════════════════════════════════════════════════════════════════ */

const ACCENT = "#C13A22", RED = "#C0392B", ACCENT_SOFT = "#F3E4DE", PRIMARY = "#1A1A1A", SUB = "#6F6656";
const C = { text: "#211C15", sub: "#6F6656", faint: "#A99F88", line: "#D8CFBB", soft: "#ECE6D7" };
const TOTAL_WEEKS = 16, TOTAL_DAYS = TOTAL_WEEKS * 7;
const LABEL_W = 168, DAY_PXD = 44, WEEK_PXD = 12;
const ROW_H = 40, ROW_H_OPEN = 116, CARD_W = 150, MAX_OPEN = 3;
// v2 胖格子日視圖
const DAY_W = 150, ROW_FAT = 44, ROW_THIN = 34;  // ROW_FAT＝有紀錄列的「最小」高度；照片/多行會自然把該列撐高
const ACTIVE = ["doing", "wait", "issue"]; // 置頂組（正在動的工序）

const WS = {
  pending: { label: "待開工",   color: "#6F6656", bar: "#CDC3AC", tint: "#EFE7D6" },
  doing:   { label: "施工中",   color: "#3E72A8", bar: "#6B97C4", tint: "#F3E4DE" },
  done:    { label: "完成",     color: "#3C8C3C", bar: "#7BA85A", tint: "#F0FDF4" },
  issue:   { label: "問題/延遲", color: "#DC2626", bar: "#F87171", tint: "#FEF2F2" },
  wait:    { label: "等待材料", color: "#D97706", bar: "#FBBF24", tint: "#FFFBEB" },
};
const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const navBtn = { border: `1px solid ${C.line}`, background: "#fff", borderRadius: 8, width: 32, height: 32, fontSize: 17, cursor: "pointer", color: C.text };
const jumpBtn = { border: `1px solid ${C.line}`, background: "#fff", borderRadius: 6, width: 19, height: 19, fontSize: 13, lineHeight: 1, padding: 0, cursor: "pointer", color: C.sub, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const Label = ({ children }) => <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 6 }}>{children}</div>;

export default function SequenceView({
  items = [], logs = [], projectStart = "2026-03-30", warnDays = 3, canEdit = false,
  onSaveLog, onDelLog, onSetStatus, onSetSchedule, onSetProjectStart, uploadPhotos, aiTidy, aiWeekly,
  onReorder, onAddSub, onDelSub, onSetUrgent,
}) {
  const [zoom, setZoom] = useState("day");
  const [labelW, setLabelW] = useState(220);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [openIds, setOpenIds] = useState([]);
  const [expandedParents, setExpandedParents] = useState(new Set()); // 子項目預設收合
  const [statusPick, setStatusPick] = useState(null); // {id, x, y}
  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = labelW;
    const move = (ev) => setLabelW(Math.max(120, Math.min(520, startW + ev.clientX - startX)));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  };
  const [onlyIssue, setOnlyIssue] = useState(false);
  const [showDone, setShowDone] = useState(true); // 顯示/隱藏 完成‧待開工
  const [quick, setQuick] = useState(null); // 行事曆式快速記錄 popover
  const [viewImg, setViewImg] = useState(null); // 點格子照片直接放大
  const [schedItem, setSchedItem] = useState(null);
  const [tip, setTip] = useState(null);
  const [scrollTo, setScrollTo] = useState(null);
  const [scrollX, setScrollX] = useState(0);       // 目前橫向捲動量（給最左欄「跳到有紀錄格子」箭頭判斷可見範圍）
  const [weeklyOut, setWeeklyOut] = useState(null);
  const ref = useRef(null);

  // 日期數學（以 projectStart 為 W1 週一錨點）
  const START_D = useMemo(() => new Date(projectStart + "T00:00:00"), [projectStart]);
  const TODAY = toKey(new Date());
  const idxOf = (k) => Math.round((new Date(k + "T00:00:00") - START_D) / 86400000);
  const dayKey = (i) => { const d = new Date(START_D); d.setDate(d.getDate() + i); return toKey(d); };
  const TODAY_IDX = idxOf(TODAY);
  const dotFill = (log) => idxOf(log.date) > TODAY_IDX ? ACCENT : log.issue ? RED : "#ffffff";

  // 週視圖／日視圖皆為連續座標（原生橫向捲動，不限視窗）
  const ppd = WEEK_PXD;
  const X = (i) => i * ppd, trackW = TOTAL_DAYS * ppd;
  const dayX = (i) => i * DAY_W;                      // 日視圖：絕對座標
  const dayTrackW = TOTAL_DAYS * DAY_W;

  // 每個工序的區段（day index 範圍）
  const segIdxOf = (it) => (it.segments || []).map(s => [idxOf(s.start), idxOf(s.end)]).filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a);
  const spanOf = (it) => { const segs = segIdxOf(it); if (!segs.length) return [0, 0]; return [Math.min(...segs.map(s=>s[0])), Math.max(...segs.map(s=>s[1]))]; };
  const inRange = (it, i) => segIdxOf(it).some(([a,b]) => i >= a && i <= b);

  const logsByItem = useMemo(() => { const m = {}; logs.forEach((l) => (m[l.itemId] ||= []).push(l)); return m; }, [logs]);
  const logMap = useMemo(() => { const m = {}; logs.forEach((l) => (m[`${l.itemId}|${l.date}`] = l)); return m; }, [logs]);
  const lastLog = (id) => { const ls = logsByItem[id] || []; return ls.length ? Math.max(...ls.map((l) => idxOf(l.date))) : -1; };
  const origIdx = useMemo(() => Object.fromEntries(items.map((it, i) => [it.id, i])), [items]);

  const warnSet = useMemo(() => {
    const s = new Set();
    items.forEach((it) => {
      if (!["doing", "wait"].includes(it.status) || spanOf(it)[0] > TODAY_IDX) return;
      const past = (logsByItem[it.id] || []).map((l) => idxOf(l.date)).filter((i) => i <= TODAY_IDX);
      if (TODAY_IDX - (past.length ? Math.max(...past) : -999) >= warnDays) s.add(it.id);
    });
    return s;
  }, [items, logsByItem]);

  const hasSubs = (it) => it.isParent && items.some(x => x.parentId === it.id);
  const subCount = (it) => items.filter(x => x.parentId === it.id).length;
  const base = onlyIssue ? items.filter((it) => it.status === "issue" || warnSet.has(it.id)) : items;
  let visItems = base.filter(it => !it.isSub || expandedParents.has(it.parentId) || it.urgent); // 子項目預設收合；超急件永遠顯示
  if (zoom === "day") {
    if (!showDone) visItems = visItems.filter(it => ACTIVE.includes(it.status) || it.urgent); // 取消「顯示完成/待開工」→ 只剩正在動的(超急件保留)
    // 超急件置頂；其餘依狀態分組：置頂組(施工中/等待/問題) → 完成 → 待開工；置頂組內依「最近有紀錄」由新到舊
    visItems = [...visItems].sort((a, b) => {
      if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1;
      const ra = ACTIVE.includes(a.status) ? 0 : a.status === "done" ? 1 : 2;
      const rb = ACTIVE.includes(b.status) ? 0 : b.status === "done" ? 1 : 2;
      if (ra !== rb) return ra - rb;
      if (ra === 0) return lastLog(b.id) - lastLog(a.id);
      return (origIdx[a.id] ?? 0) - (origIdx[b.id] ?? 0);
    });
  }
  // 日視圖顯示完整工期（0…TOTAL_DAYS-1），靠原生捲動一路往右滑
  const winDays = Array.from({ length: TOTAL_DAYS }, (_, i) => i);

  useEffect(() => { if (!ref.current) return; ref.current.scrollLeft = zoom === "week" ? X(TODAY_IDX) - 220 : dayX(TODAY_IDX) - DAY_W; }, [zoom]); // eslint-disable-line
  useEffect(() => { if (scrollTo != null && ref.current) { ref.current.scrollLeft = (zoom === "day" ? dayX(scrollTo) - DAY_W : X(scrollTo) - 120); setScrollTo(null); } }, [scrollTo]); // eslint-disable-line
  useEffect(() => { const el = ref.current; if (!el) return; const on = () => setScrollX(el.scrollLeft); on(); el.addEventListener("scroll", on, { passive: true }); return () => el.removeEventListener("scroll", on); }, [zoom]); // eslint-disable-line

  const toggle = (it) => {
    if (hasSubs(it)) { setExpandedParents(s => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; }); return; }
    if (zoom === "week") { setZoom("day"); setOpenIds([it.id]); setScrollTo(spanOf(it)[0]); return; }
    setOpenIds((o) => o.includes(it.id) ? o.filter((x) => x !== it.id) : [...o, it.id].slice(-MAX_OPEN));
  };
  const requireEdit = () => { if (!canEdit) { alert("此帳號沒有編輯工程資料的權限，請聯絡管理員開放。"); return false; } return true; };
  const saveLog = (l) => { if (!requireEdit()) return; onSaveLog && onSaveLog(l); setQuick(null); };
  const delLog = (id) => { if (!requireEdit()) return; onDelLog && onDelLog(id); setQuick(null); };
  const openCell = (itemId, date, x, y) => { if (!requireEdit()) return; setQuick({ itemId, date, x: x ?? (window.innerWidth / 2), y: y ?? 120 }); };

  // 拖曳設定工期（取代甘特排程）：點一格＝記錄；拖多格＝設工期
  const [sel, setSel] = useState(null); // { itemId, a, b }
  const selRef = useRef(null); selRef.current = sel;
  const inSel = (id, i) => sel && sel.itemId === id && i >= Math.min(sel.a, sel.b) && i <= Math.max(sel.a, sel.b);
  const commitSel = () => {
    const s = selRef.current; if (!s) return; setSel(null);
    const a = Math.min(s.a, s.b), b = Math.max(s.a, s.b);
    if (a === b) { openCell(s.itemId, dayKey(a), s.x, s.y); return; }
    if (!canEdit || !onSetSchedule) return;
    const cur = segIdxOf(items.find(x => x.id === s.itemId));
    // 再次框選「完全相同的範圍」＝取消該段（清除整格上色）；否則設定為此工序的施工範圍
    if (cur.length === 1 && cur[0][0] === a && cur[0][1] === b) onSetSchedule(s.itemId, []);
    else onSetSchedule(s.itemId, [{ start: dayKey(a), end: dayKey(b) }]);
  };
  const commitRef = useRef(commitSel); commitRef.current = commitSel; // 永遠用最新的 closure（修正權限/狀態 stale）
  useEffect(() => { const up = () => commitRef.current && commitRef.current(); document.addEventListener("mouseup", up); return () => document.removeEventListener("mouseup", up); }, []); // eslint-disable-line
  const doWeekly = async () => {
    if (!aiWeekly) return;
    setWeeklyOut("…產生中");
    const wk = logs.filter(l => { const i = idxOf(l.date); return i <= TODAY_IDX && i > TODAY_IDX - 7; });
    try { setWeeklyOut(await aiWeekly(wk, items)); } catch { setWeeklyOut("AI 連線失敗"); }
  };

  // 左側工程欄（凍結）— 週/日共用
  const renderLabel = (it, minH) => {
    const w = WS[it.status] || WS.pending;
    const isContainer = hasSubs(it);
    const subsOpen = isContainer && expandedParents.has(it.id);
    // 「跳到有紀錄的格子」：找目前可見範圍前/後最近一筆有施工紀錄的日期；前後都沒有就不顯示箭頭
    const logIdxs = (logsByItem[it.id] || []).map(l => idxOf(l.date)).sort((a, b) => a - b);
    const visCols = ref.current ? Math.max(1, Math.floor((ref.current.clientWidth - labelW) / DAY_W)) : 5;
    const vL = scrollX / DAY_W, vR = vL + visCols;
    const jPrev = [...logIdxs].reverse().find(i => i < vL - 0.01);
    const jNext = logIdxs.find(i => i > vR - 1 + 0.01);
    const jumpTo = (i) => { if (ref.current) ref.current.scrollLeft = dayX(i) - DAY_W; };
    return (
      <div onClick={() => isContainer && toggle(it)} className={it.urgent ? "seq-urgent-cell" : undefined} title={isContainer ? (subsOpen ? "收合子項目" : "展開子項目") : undefined} style={{ width: labelW, flexShrink: 0, boxSizing: "border-box", position: "sticky", left: 0, zIndex: 2, background: dragOverId === it.id ? ACCENT_SOFT : (it.isSub ? "#FCFDFE" : "#fff"), borderRight: `1px solid ${C.line}`, borderLeft: it.urgent ? `3px solid ${RED}` : (it.isSub ? "3px solid transparent" : `3px solid ${w.bar}`), padding: "0 8px", paddingLeft: it.isSub ? 18 : 6, display: "flex", alignItems: "center", gap: 6, minHeight: minH, cursor: isContainer ? "pointer" : "default" }}>
        {it.isParent && canEdit && <span className="seq-actions" draggable onClick={(e) => e.stopPropagation()} onDragStart={() => setDragId(it.id)} onDragEnd={() => { setDragId(null); setDragOverId(null); }} title="拖曳排序大項" style={{ cursor: "grab", color: "#CDC3AC", fontSize: 13, flexShrink: 0 }}>⠿</span>}
        {it.isSub && <span style={{ color: "#CDC3AC", fontSize: 12, flexShrink: 0, lineHeight: 1 }}>└</span>}
        <span onClick={(e) => { e.stopPropagation(); if (canEdit) setStatusPick({ id: it.id, x: e.clientX, y: e.clientY }); }} title={canEdit ? `${w.label}（點擊設定狀態）` : w.label} style={{ width: 10, height: 10, borderRadius: 5, background: w.bar, flexShrink: 0, cursor: canEdit ? "pointer" : "default" }} />
        {it.urgent && <span className="seq-fire" onClick={(e) => { e.stopPropagation(); canEdit && onSetUrgent && onSetUrgent(it.id, false); }} title="超急件（點擊取消）" style={{ fontSize: 13, flexShrink: 0, cursor: canEdit ? "pointer" : "default" }}>🔥</span>}
        <span title={`${it.name}（${w.label}）`} style={{ fontSize: it.isSub ? 13 : 14, fontWeight: it.urgent ? 600 : (it.isSub ? 500 : 600), color: it.urgent ? "#B3261E" : (it.isSub ? C.sub : PRIMARY), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, letterSpacing: -0.1 }}>{it.name}</span>
        {isContainer && !subsOpen && <span style={{ fontSize: 11, fontWeight: 500, color: SUB, background: "#EFE7D6", borderRadius: 10, padding: "1px 7px", flexShrink: 0, lineHeight: 1.5 }}>{subCount(it)}</span>}
        {warnSet.has(it.id) && <span title={`連續 ${warnDays} 天無紀錄`} style={{ color: RED, fontSize: 13, flexShrink: 0 }}>⚠</span>}
        {(jPrev != null || jNext != null) && (
          <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 }} title="跳到此工序有施工紀錄的日期">
            {jPrev != null && <button onClick={(e) => { e.stopPropagation(); jumpTo(jPrev); }} title="往前找最近一筆有紀錄的格子" style={jumpBtn}>‹</button>}
            {jNext != null && <button onClick={(e) => { e.stopPropagation(); jumpTo(jNext); }} title="往後找最近一筆有紀錄的格子" style={jumpBtn}>›</button>}
          </span>
        )}
        {canEdit && <div className="seq-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          {!it.urgent && <button onClick={(e) => { e.stopPropagation(); onSetUrgent && onSetUrgent(it.id, true); }} title="標記超急件（置頂＋閃爍提醒）" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, filter: "grayscale(1)", opacity: .7 }}>🔥</button>}
          {it.isParent && <button onClick={(e) => { e.stopPropagation(); const n = prompt(`在「${it.name}」下新增工程子項目：`); if (n && n.trim()) onAddSub && onAddSub(it.id, n.trim()); }} title="新增子項目" style={{ border: "none", background: "none", cursor: "pointer", color: ACCENT, fontSize: 15, fontWeight: 500 }}>＋</button>}
          {it.isSub && <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`刪除子項目「${it.name}」？`)) onDelSub && onDelSub(it.id); }} title="刪除子項目" style={{ border: "none", background: "none", cursor: "pointer", color: "#DC2626", fontSize: 13 }}>×</button>}
        </div>}
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "-apple-system,'PingFang TC','Noto Sans TC',system-ui,'Segoe UI',Roboto,sans-serif", color: C.text, letterSpacing: 0.1 }}>
      <style>{`.seq-row .seq-actions{opacity:0;transition:opacity .12s} .seq-row:hover .seq-actions{opacity:1} .seq-row:hover{background:#F4EFE3} .thin-add{opacity:0;transition:opacity .12s} .seq-row:hover .thin-add{opacity:.5}
        @keyframes seqUrgentBg{0%,100%{background:#FCEDE8}50%{background:#F6D5CB}}
        @keyframes seqUrgentPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.86)}}
        .seq-urgent-cell{animation:seqUrgentBg 1.15s ease-in-out infinite !important}
        .seq-fire{animation:seqUrgentPulse .9s ease-in-out infinite;display:inline-flex}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: "#EFE7D6", borderRadius: 8, padding: 2 }}>
          {[["week", "週"], ["day", "日"]].map(([k, l]) => (
            <button key={k} onClick={() => { setZoom(k); if (k === "week") setOpenIds([]); }} style={{ border: "none", cursor: "pointer", padding: "5px 15px", borderRadius: 6, fontSize: 13, fontWeight: 500, background: zoom === k ? "#fff" : "transparent", color: zoom === k ? C.text : C.sub, boxShadow: zoom === k ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}>{l}</button>
          ))}
        </div>
        {zoom === "day" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => { if (ref.current) ref.current.scrollLeft -= DAY_W * 7; }} title="往前一週" style={navBtn}>‹</button>
            <button onClick={() => { if (ref.current) ref.current.scrollLeft += DAY_W * 7; }} title="往後一週" style={navBtn}>›</button>
          </div>
        )}
        <button onClick={() => { if (zoom === "day") { if (ref.current) ref.current.scrollLeft = dayX(TODAY_IDX) - DAY_W; } else setScrollTo(TODAY_IDX); }} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 13, fontWeight: 600, color: ACCENT }}>今天</button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.sub, cursor: "pointer" }}>
          <input type="checkbox" checked={onlyIssue} onChange={(e) => setOnlyIssue(e.target.checked)} />只看異常
        </label>
        {zoom === "day" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.sub, cursor: "pointer" }}>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />顯示完成/待開工
          </label>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.sub }}>
          專案起始
          <input type="date" value={projectStart} disabled={!canEdit} onChange={e => onSetProjectStart && onSetProjectStart(e.target.value)} style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: "4px 6px", fontSize: 12 }} />
        </label>
        <button onClick={doWeekly} style={{ border: `1px solid ${ACCENT}`, background: "#F3E4DE", color: "#3E72A8", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✨ AI 週報</button>
        <span style={{ fontSize: 13, color: C.faint }}>{zoom === "week" ? "點工序條切日視圖" : "點格子＝記錄 · 橫向拖曳＝設工期"}</span>
        <div style={{ flex: 1 }} />
        {Object.values(WS).map((s) => <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.sub }}><span style={{ width: 9, height: 9, borderRadius: 3, background: s.bar }} />{s.label}</span>)}
      </div>

      <div ref={ref} style={{ overflow: "auto", maxHeight: "calc(100vh - 195px)", border: `1px solid ${C.line}`, borderRadius: 12, background: "#fff", position: "relative" }}>
        {zoom === "week" ? (
        <div style={{ minWidth: labelW + trackW }}>
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 3, background: "#fff", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ width: labelW, flexShrink: 0, boxSizing: "border-box", position: "sticky", left: 0, zIndex: 4, background: "#fff", padding: "8px 12px", fontSize: 13, fontWeight: 600, color: C.sub, borderRight: `1px solid ${C.line}` }}>
              工程項目
              <div onMouseDown={startResize} title="拖曳調整欄寬" style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 7, cursor: "col-resize", zIndex: 6 }} />
            </div>
            <div style={{ position: "relative", width: trackW, height: 42 }}>
              {Array.from({ length: TOTAL_WEEKS }, (_, w) => {
                const d = new Date(START_D); d.setDate(d.getDate() + w * 7);
                return (
                  <div key={w} style={{ position: "absolute", left: X(w * 7), top: 0, bottom: 0, borderLeft: `1px solid ${C.line}`, paddingLeft: 5, display: "flex", flexDirection: "column", justifyContent: "center", lineHeight: 1.25 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.text }}>W{w + 1}</span>
                    {zoom === "week" && <span style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap" }}>{d.getMonth() + 1}/{d.getDate()}</span>}
                  </div>
                );
              })}
              {zoom === "day" && Array.from({ length: TOTAL_DAYS }, (_, i) => { const d = new Date(START_D); d.setDate(d.getDate() + i); const we = d.getDay() % 6 === 0; const showM = i % 7 === 0 || d.getDate() === 1; return <div key={i} style={{ position: "absolute", left: X(i), top: 27, width: ppd, textAlign: "center", fontSize: 10, color: we ? "#c0507a" : C.faint }}>{showM ? `${d.getMonth() + 1}/${d.getDate()}` : d.getDate()}</div>; })}
              <div style={{ position: "absolute", left: X(TODAY_IDX) + ppd / 2, top: 0, bottom: 0, width: 2, background: ACCENT }} />
            </div>
          </div>

          {visItems.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, fontSize: 13 }}>尚無工序（請到「總覽」新增工程大項，或設定排程）</div>}
          {visItems.map((it) => {
            const isContainer = hasSubs(it);
            const subsOpen = isContainer && expandedParents.has(it.id);
            const open = !isContainer && openIds.includes(it.id); // 日誌展開（高列+卡片）
            const caretOpen = isContainer ? subsOpen : open;
            const w = WS[it.status] || WS.pending;
            const segs = segIdxOf(it);
            const itemLogs = logsByItem[it.id] || [];
            let cursor = -1;
            const cards = open ? [...itemLogs].sort((a, b) => a.date.localeCompare(b.date)).map((l) => { const left = Math.max(X(idxOf(l.date)), cursor + 8); cursor = left + CARD_W; return { l, left }; }) : [];
            return (
              <div key={it.id} className="seq-row"
                onDragOver={(e) => { if (it.isParent && dragId && dragId !== it.id) { e.preventDefault(); setDragOverId(it.id); } }}
                onDrop={() => { if (it.isParent && dragId && dragId !== it.id) onReorder && onReorder(dragId, it.id); setDragId(null); setDragOverId(null); }}
                style={{ display: "flex", borderBottom: `1px solid ${C.line}`, minHeight: open ? ROW_H_OPEN : (it.isSub ? 38 : 46), background: dragOverId === it.id ? ACCENT_SOFT : (open ? "#ECE6D7" : (it.isSub ? "#FCFDFE" : "#fff")) }}>
                <div onClick={() => toggle(it)} style={{ width: labelW, flexShrink: 0, boxSizing: "border-box", position: "sticky", left: 0, zIndex: 2, background: dragOverId === it.id ? ACCENT_SOFT : (open ? "#ECE6D7" : (it.isSub ? "#FCFDFE" : "#fff")), borderRight: `1px solid ${C.line}`, borderLeft: it.isSub ? "3px solid transparent" : `3px solid ${w.bar}`, padding: "0 8px", paddingLeft: it.isSub ? 18 : 6, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  {it.isParent && canEdit && <span className="seq-actions" draggable onClick={(e) => e.stopPropagation()} onDragStart={() => setDragId(it.id)} onDragEnd={() => { setDragId(null); setDragOverId(null); }} title="拖曳排序大項" style={{ cursor: "grab", color: "#CDC3AC", fontSize: 13, flexShrink: 0 }}>⠿</span>}
                  {it.isSub && <span style={{ color: "#CDC3AC", fontSize: 12, flexShrink: 0, lineHeight: 1 }}>└</span>}
                  <span onClick={(e) => { e.stopPropagation(); if (canEdit) setStatusPick({ id: it.id, x: e.clientX, y: e.clientY }); }} title={canEdit ? `${w.label}（點擊設定狀態）` : w.label} style={{ width: 8, height: 8, borderRadius: 4, background: w.bar, flexShrink: 0, cursor: canEdit ? "pointer" : "default" }} />
                  <span title={`${it.name}（${w.label}）`} style={{ fontSize: it.isSub ? 13 : 14, fontWeight: it.isSub ? 500 : 600, color: it.isSub ? C.sub : PRIMARY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, letterSpacing: -0.1 }}>{it.name}</span>
                  {isContainer && !subsOpen && <span style={{ fontSize: 11, fontWeight: 500, color: SUB, background: "#EFE7D6", borderRadius: 10, padding: "1px 7px", flexShrink: 0, lineHeight: 1.5 }}>{subCount(it)}</span>}
                  {warnSet.has(it.id) && <span title={`連續 ${warnDays} 天無紀錄`} style={{ fontSize: 10.5, fontWeight: 500, color: "#DC2626", background: "#FEF2F2", borderRadius: 6, padding: "1px 6px", flexShrink: 0, lineHeight: 1.5 }}>逾期</span>}
                  {canEdit && <div className="seq-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                    {it.isParent && <button onClick={(e) => { e.stopPropagation(); const n = prompt(`在「${it.name}」下新增工程子項目：`); if (n && n.trim()) onAddSub && onAddSub(it.id, n.trim()); }} title="新增子項目" style={{ border: "none", background: "none", cursor: "pointer", color: ACCENT, fontSize: 15, fontWeight: 500 }}>＋</button>}
                    {it.isSub && <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`刪除子項目「${it.name}」？`)) onDelSub && onDelSub(it.id); }} title="刪除子項目" style={{ border: "none", background: "none", cursor: "pointer", color: "#DC2626", fontSize: 13 }}>×</button>}
                  </div>}
                </div>
                <div onClick={(e) => { if (!open) return; const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left) / ppd); if (inRange(it, i)) openCell(it.id, dayKey(i)); }}
                  style={{ position: "relative", width: trackW, cursor: open ? "copy" : "default" }}>
                  <div style={{ position: "absolute", left: X(TODAY_IDX) + ppd / 2, top: 0, bottom: 0, width: 2, background: ACCENT, opacity: .4 }} />
                  {/* 工序條（可多區段） */}
                  {segs.map(([ss, ee], si) => (
                    <div key={si} style={{ position: "absolute", left: X(ss), top: open ? 10 : (ROW_H - 22) / 2, width: X(ee - ss + 1), height: 22, background: open ? "#cdd3df" : w.bar, borderRadius: 5, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 12, fontWeight: 600, color: open ? "#5b6275" : "#fff", overflow: "hidden", whiteSpace: "nowrap" }}>
                      {si === 0 ? it.name : ""}
                    </div>
                  ))}
                  {/* 事件點（絕對定位於軌道） */}
                  {!open && itemLogs.map((l) => {
                    const dx = X(idxOf(l.date)) + ppd / 2;
                    return <span key={l.id}
                      onMouseEnter={(e) => setTip({ l, x: e.clientX, y: e.clientY, item: it.name })}
                      onMouseLeave={() => setTip(null)}
                      onClick={(e) => { e.stopPropagation(); setQuick({ itemId: l.itemId, date: l.date, x: e.clientX, y: e.clientY }); }}
                      style={{ position: "absolute", left: dx - 4, top: (ROW_H - 22) / 2 + 12, width: 8, height: 8, borderRadius: 4, background: dotFill(l), boxShadow: "0 0 0 1px rgba(0,0,0,.4)", cursor: "pointer", zIndex: 2 }} />;
                  })}
                  {/* 展開：事件卡 */}
                  {cards.map(({ l, left }) => {
                    const planned = idxOf(l.date) > TODAY_IDX;
                    return (
                      <div key={l.id} onClick={(e) => { e.stopPropagation(); setQuick({ itemId: l.itemId, date: l.date, x: e.clientX, y: e.clientY }); }}
                        style={{ position: "absolute", left, top: 40, width: CARD_W, background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${planned ? ACCENT : l.issue ? RED : w.bar}`, borderRadius: 8, padding: 7, cursor: "pointer", boxShadow: "0 1px 5px rgba(0,0,0,.09)", opacity: planned ? .82 : 1 }}>
                        <div style={{ display: "flex", gap: 7 }}>
                          {l.photos?.[0] && <img src={l.photos[0]} alt="" style={{ width: 40, height: 40, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: planned ? ACCENT : C.sub, fontWeight: 600 }}>{l.date.slice(5).replace("-", "/")}{planned ? " 預排" : ""}</div>
                            <div style={{ fontSize: 12, fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.35 }}>{planned ? l.next : l.done}</div>
                          </div>
                        </div>
                        {(l.issue || (l.photos?.length || 0) > 1) && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                            {l.issue && <span style={{ fontSize: 10, color: RED }}>⚠ 問題</span>}
                            {(l.photos?.length || 0) > 1 && <span style={{ fontSize: 10, color: C.faint }}>📷×{l.photos.length}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        ) : (
        /* ───────── 日視圖：14 天視窗胖格子 ───────── */
        <div style={{ minWidth: labelW + dayTrackW }}>
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 3, background: "#fff", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ width: labelW, flexShrink: 0, boxSizing: "border-box", position: "sticky", left: 0, zIndex: 4, background: "#fff", padding: "8px 12px", fontSize: 13, fontWeight: 600, color: C.sub, borderRight: `1px solid ${C.line}` }}>
              工程項目
              <div onMouseDown={startResize} title="拖曳調整欄寬" style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 7, cursor: "col-resize", zIndex: 6 }} />
            </div>
            {winDays.map((i) => { const d = new Date(START_D); d.setDate(d.getDate() + i); const t = i === TODAY_IDX, wk = d.getDay() % 6 === 0; return (
              <div key={i} style={{ width: DAY_W, flexShrink: 0, boxSizing: "border-box", textAlign: "center", padding: "5px 0 6px", borderLeft: `1px solid ${C.line}`, background: t ? "#FFFBEF" : "#fff" }}>
                <div style={{ fontSize: 10.5, fontWeight: 500, color: wk ? "#c0507a" : C.sub }}>週{WD[d.getDay()]}</div>
                <div style={{ marginTop: 2, display: "flex", justifyContent: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 20, padding: "0 8px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, background: t ? ACCENT : "transparent", color: t ? "#fff" : wk ? "#c0507a" : C.text }}>{d.getMonth() + 1}/{d.getDate()}</span>
                </div>
              </div>); })}
          </div>
          {visItems.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, fontSize: 13 }}>尚無工序（請到「總覽」新增工程大項，或設定排程）</div>}
          {visItems.map((it) => {
            const w = WS[it.status] || WS.pending;
            const hasContentInWin = winDays.some(i => logMap[`${it.id}|${dayKey(i)}`]);
            const fat = hasContentInWin; // 該工序只要有任一筆紀錄就展開成胖格子；其餘一律細列(省空間、整齊一致)
            return (
              <div key={it.id} className="seq-row" style={{ display: "flex", borderBottom: `1px solid ${C.line}`, minHeight: fat ? ROW_FAT : ROW_THIN, background: it.isSub ? "#FCFDFE" : "#fff" }}>
                {renderLabel(it, fat ? ROW_FAT : ROW_THIN)}
                {fat ? (
                  winDays.map((i) => {
                    const inSpan = inRange(it, i), key = dayKey(i), log = logMap[`${it.id}|${key}`], planned = i > TODAY_IDX, t = i === TODAY_IDX;
                    return (
                      <div key={i} onMouseDown={(e) => canEdit && setSel({ itemId: it.id, a: i, b: i, x: e.clientX, y: e.clientY })} onMouseEnter={() => canEdit && setSel(s => s && s.itemId === it.id ? { ...s, b: i } : s)} style={{ width: DAY_W, flexShrink: 0, boxSizing: "border-box", minHeight: ROW_FAT, borderLeft: `1px solid ${C.line}`, padding: 7, cursor: canEdit ? "pointer" : "default", userSelect: "none", background: inSel(it.id, i) ? ACCENT_SOFT : inSpan ? w.tint : t ? "#FFFBEF" : "#fff", position: "relative" }}>
                        {log ? (
                          <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 5, opacity: planned ? .72 : 1 }}>
                            {planned && <span style={{ fontSize: 10, fontWeight: 600, color: ACCENT }}>預排</span>}
                            {!planned && log.prog > 0 && (
                              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <div style={{ flex: 1, height: 4, background: "#EFE7D6", borderRadius: 2, overflow: "hidden" }}><div style={{ width: `${log.prog}%`, height: "100%", background: w.bar }} /></div>
                                <span style={{ fontSize: 10, color: C.sub, fontWeight: 600 }}>{log.prog}%</span>
                              </div>
                            )}
                            <div style={{ fontSize: 12, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{planned ? log.next : log.done}</div>
                            {log.issue && <div style={{ fontSize: 11, color: RED, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>⚠ {log.issue}</div>}
                            {(log.photos?.length > 0) && <div style={{ display: "flex", gap: 4, marginTop: "auto" }}>{log.photos.slice(0, 2).map((p, k) => <img key={k} src={p} alt="" title="點擊放大" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setViewImg(p); }} style={{ width: 38, height: 38, borderRadius: 5, objectFit: "cover", cursor: "zoom-in" }} />)}{log.photos.length > 2 && <span style={{ fontSize: 11, color: C.faint, alignSelf: "flex-end" }}>+{log.photos.length - 2}</span>}</div>}
                          </div>
                        ) : canEdit ? (
                          <div className="thin-add" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: planned ? ACCENT : C.faint, fontSize: 12, border: planned ? `1px dashed ${ACCENT}66` : "none", borderRadius: 6 }}>{planned ? "點此預排" : "＋ 記錄"}</div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  /* 細條列：可點(記錄)/拖曳(設工期)；施工範圍＝整格上狀態色，再框相同範圍可取消 */
                  <div style={{ position: "relative", display: "flex", flex: "0 0 auto" }}>
                    {winDays.map((i) => { const t = i === TODAY_IDX, inSpan = inRange(it, i), log = logMap[`${it.id}|${dayKey(i)}`]; return (
                      <div key={i} onMouseDown={(e) => canEdit && setSel({ itemId: it.id, a: i, b: i, x: e.clientX, y: e.clientY })} onMouseEnter={() => canEdit && setSel(s => s && s.itemId === it.id ? { ...s, b: i } : s)} style={{ width: DAY_W, flexShrink: 0, boxSizing: "border-box", borderLeft: `1px solid ${C.line}`, cursor: canEdit ? "pointer" : "default", userSelect: "none", background: inSel(it.id, i) ? ACCENT_SOFT : inSpan ? w.tint : t ? "#FFFBEF" : "transparent", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {canEdit && !log && <span className="thin-add" style={{ fontSize: 11, color: C.faint }}>＋ 記錄</span>}
                        {log && <span onClick={(e) => { e.stopPropagation(); setQuick({ itemId: log.itemId, date: log.date, x: e.clientX, y: e.clientY }); }} onMouseEnter={(e) => setTip({ l: log, x: e.clientX, y: e.clientY, item: it.name })} onMouseLeave={() => setTip(null)} style={{ position: "absolute", left: DAY_W / 2 - 4, top: ROW_THIN / 2 - 4, width: 8, height: 8, borderRadius: 4, background: dotFill(log), boxShadow: "0 0 0 1px rgba(0,0,0,.4)", cursor: "pointer", zIndex: 3 }} />}
                      </div>); })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      {tip && (
        <div style={{ position: "fixed", left: tip.x + 12, top: tip.y + 12, zIndex: 1100, background: "#1f2430", color: "#fff", borderRadius: 8, padding: "8px 10px", maxWidth: 220, fontSize: 12, pointerEvents: "none", boxShadow: "0 6px 18px rgba(0,0,0,.3)" }}>
          <div style={{ color: ACCENT, fontWeight: 600, marginBottom: 2 }}>{tip.item} · {tip.l.date.slice(5).replace("-", "/")}</div>
          <div style={{ lineHeight: 1.4 }}>{tip.l.done || tip.l.next}</div>
          {tip.l.issue && <div style={{ color: "#ff9a8f", marginTop: 2 }}>⚠ {tip.l.issue}</div>}
          {(tip.l.photos?.length || 0) > 0 && <div style={{ color: "#aab", marginTop: 3 }}>照片 {tip.l.photos.length} 張</div>}
        </div>
      )}

      {weeklyOut !== null && (
        <div onClick={() => setWeeklyOut(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,24,33,.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 22, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}><div style={{ fontSize: 16, fontWeight: 600 }}>✨ 本週施工週報</div><div style={{ flex: 1 }} /><button onClick={() => setWeeklyOut(null)} style={{ border: "none", background: "none", fontSize: 22, color: C.faint, cursor: "pointer" }}>×</button></div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7, color: C.text }}>{weeklyOut}</div>
          </div>
        </div>
      )}

      {statusPick && (
        <div onClick={() => setStatusPick(null)} style={{ position: "fixed", inset: 0, zIndex: 1100 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: "fixed", left: Math.min(statusPick.x, window.innerWidth - 150), top: Math.min(statusPick.y + 6, window.innerHeight - 220), background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,.18)", minWidth: 130 }}>
            <div style={{ fontSize: 11, color: C.faint, padding: "2px 8px 6px" }}>設定工序狀態</div>
            {Object.entries(WS).map(([k, v]) => (
              <button key={k} onClick={() => { onSetStatus && onSetStatus(statusPick.id, k); setStatusPick(null); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: "none", background: "none", padding: "7px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: C.text, textAlign: "left" }}
                onMouseEnter={e => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={e => e.currentTarget.style.background = "none"}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: v.bar }} />{v.label}
              </button>
            ))}
          </div>
        </div>
      )}


      {quick && <QuickLog q={quick} log={logMap[`${quick.itemId}|${quick.date}`]} item={items.find((i) => i.id === quick.itemId)} planned={quick.date > TODAY} onSave={saveLog} onDelete={delLog} onClose={() => setQuick(null)} uploadPhotos={uploadPhotos} />}
      {viewImg && <div onClick={() => setViewImg(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}><img src={viewImg} alt="" style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} /></div>}
    </div>
  );
}

/* ── 行事曆式快速記錄 popover（點格子直接打字＋上傳照片） ── */
function QuickLog({ q, log, item, planned, onSave, onDelete, onClose, uploadPhotos }) {
  const [text, setText] = useState(log ? (planned ? (log.next || "") : (log.done || "")) : "");
  const [photos, setPhotos] = useState(log?.photos || []);
  const [busy, setBusy] = useState(false);
  const [viewImg, setViewImg] = useState(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  useEffect(() => { taRef.current?.focus(); }, []);
  const addPhotos = async (files) => {
    const imgs = Array.from(files).filter((x) => x.type.startsWith("image/"));
    if (!imgs.length || !uploadPhotos) return;
    setBusy(true);
    try { const urls = await uploadPhotos(imgs); setPhotos((p) => [...p, ...urls]); } catch (e) { alert("上傳失敗：" + (e?.message || e)); }
    setBusy(false);
  };
  const save = () => {
    const base = log ? { ...log } : { itemId: q.itemId, date: q.date, done: "", issue: "", next: "", prog: 0, photos: [] };
    onSave({ ...base, [planned ? "next" : "done"]: text.trim(), photos });
  };
  // 視窗內定位（靠近點擊位置、避免超出邊界）
  const W = 320, left = Math.max(12, Math.min((q.x || 200) - W / 2, window.innerWidth - W - 12)), top = Math.min((q.y || 120) + 14, window.innerHeight - 320);
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      <div onMouseDown={(e) => e.stopPropagation()} onPaste={(e) => e.clipboardData?.files?.length && addPhotos(e.clipboardData.files)} style={{ position: "fixed", left, top, width: W, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: "0 12px 40px rgba(20,24,33,.22)", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 5, background: (WS[item?.status] || WS.pending).bar, flexShrink: 0 }} />
          <div style={{ fontSize: 14, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item?.name}</div>
          <span style={{ fontSize: 12, color: C.sub }}>{q.date.slice(5).replace("-", "/")}{planned ? " 預排" : ""}</span>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, color: C.faint, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <textarea ref={taRef} rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }} placeholder={planned ? "預計做什麼…（可貼上截圖）" : "今天做了什麼…（可貼上截圖）"} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 14, padding: 9, resize: "vertical", outline: "none", fontFamily: "inherit" }} />
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "10px 0" }}>
          {photos.map((p, i) => <div key={i} style={{ position: "relative" }}><img src={p} alt="" onClick={() => setViewImg(p)} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 7, border: `1px solid ${C.line}`, cursor: "zoom-in" }} /><button onClick={() => setPhotos(photos.filter((_, x) => x !== i))} style={{ position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 9, border: "none", background: "#e11d48", color: "#fff", fontSize: 11, cursor: "pointer" }}>×</button></div>)}
          <button onClick={() => fileRef.current?.click()} title="上傳照片" style={{ width: 52, height: 52, borderRadius: 7, border: `1px dashed ${C.line}`, background: C.soft, fontSize: 20, color: C.faint, cursor: "pointer" }}>＋</button>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => addPhotos(e.target.files)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {log?.id && <button onClick={() => onDelete(log.id)} style={{ border: "none", background: "none", color: "#e11d48", fontSize: 13, cursor: "pointer" }}>刪除</button>}
          <div style={{ flex: 1, fontSize: 11, color: C.faint }}>{busy ? "上傳中…" : "⌘+Enter 儲存"}</div>
          <button onClick={save} disabled={busy} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 9, padding: "8px 20px", fontSize: 14, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>儲存</button>
        </div>
      </div>
      {viewImg && <div onClick={(e) => { e.stopPropagation(); setViewImg(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}><img src={viewImg} alt="" style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} /></div>}
    </div>
  );
}

/* ── 排程編輯（起始日 + 天數，一次設定；可加多區段） ── */
function ScheduleEditor({ item, onClose, onSave }) {
  const dBetween = (a, b) => Math.max(1, Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000) + 1);
  const addD = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + (Number(n) - 1)); return toKey(d); };
  const init = (item.segments && item.segments.length) ? item.segments.map(s => ({ start: s.start, days: (s.start && s.end) ? dBetween(s.start, s.end) : 1 })) : [{ start: "", days: 1 }];
  const [segs, setSegs] = useState(init);
  const upd = (i, k, v) => setSegs(s => s.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const add = () => setSegs(s => [...s, { start: "", days: 1 }]);
  const del = (i) => setSegs(s => s.filter((_, j) => j !== i));
  const valid = segs.filter(s => s.start && Number(s.days) >= 1).map(s => ({ start: s.start, end: addD(s.start, s.days) }));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,33,.35)", zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 22, maxWidth: 460, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}><div style={{ fontSize: 16, fontWeight: 600 }}>📅 {item.name} 排程</div><div style={{ flex: 1 }} /><button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: C.faint, cursor: "pointer" }}>×</button></div>
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 14 }}>選起始日 + 填工期天數即可；工不連續可加多個區段。</div>
        {segs.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input type="date" value={s.start} onChange={e => upd(i, "start", e.target.value)} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px", fontSize: 13 }} />
            <input type="number" min="1" value={s.days} onChange={e => upd(i, "days", e.target.value)} style={{ width: 64, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px", fontSize: 13 }} />
            <span style={{ fontSize: 13, color: C.sub }}>天</span>
            {s.start && Number(s.days) >= 1 && <span style={{ fontSize: 12, color: C.faint }}>→ 至 {addD(s.start, s.days).slice(5).replace("-", "/")}</span>}
            {segs.length > 1 && <button onClick={() => del(i)} style={{ marginLeft: "auto", border: "none", background: "none", color: "#e11d48", fontSize: 16, cursor: "pointer" }}>×</button>}
          </div>
        ))}
        <button onClick={add} style={{ border: `1px dashed ${C.line}`, background: C.soft, borderRadius: 8, padding: "6px 12px", fontSize: 13, color: C.sub, cursor: "pointer", marginBottom: 16 }}>＋ 新增區段</button>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => onSave([])} style={{ border: `1px solid ${C.line}`, background: "#fff", borderRadius: 9, padding: "8px 14px", fontSize: 13, cursor: "pointer", color: C.sub }}>清空排程</button>
          <button onClick={() => onSave(valid)} style={{ border: "none", background: ACCENT, color: "#ffffff", borderRadius: 9, padding: "9px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>儲存</button>
        </div>
      </div>
    </div>
  );
}

/* ── 右側結構化 Drawer ── */
function Drawer({ data, item, TODAY, onSetStatus, onSave, onDelete, onClose, onCopy, uploadPhotos, aiTidy, canEdit }) {
  const [f, setF] = useState({ ...data, photos: data.photos || [] });
  const [busy, setBusy] = useState(false);
  const [viewImg, setViewImg] = useState(null);
  const fileRef = useRef(null);
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const addPhotos = async (files) => {
    const imgs = Array.from(files).filter((x) => x.type.startsWith("image/"));
    if (!imgs.length || !uploadPhotos) return;
    setBusy(true);
    try { const urls = await uploadPhotos(imgs); setF((s) => ({ ...s, photos: [...(s.photos || []), ...urls] })); } catch (e) { alert("上傳失敗：" + (e?.message || e)); }
    setBusy(false);
  };
  const doTidy = async () => { if (!aiTidy) return; setBusy(true); try { const t = await aiTidy(f); if (t) upd(f.date > TODAY ? "next" : "done", t); } catch {} setBusy(false); };
  const planned = f.date > TODAY;
  const ta = { width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 14, padding: 9, resize: "vertical", outline: "none", fontFamily: "inherit" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,33,.35)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} onPaste={(e) => e.clipboardData?.files?.length && addPhotos(e.clipboardData.files)} style={{ width: "100%", maxWidth: 420, height: "100%", background: "#fff", boxShadow: "-8px 0 30px rgba(0,0,0,.18)", padding: 22, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 16 }}>
          <div><div style={{ fontSize: 18, fontWeight: 600 }}>{item?.name}</div><div style={{ fontSize: 13, color: C.sub }}>{f.date.replaceAll("-", "/")}{planned ? "（預排）" : ""}{busy ? " · 處理中…" : ""}</div></div>
          <div style={{ flex: 1 }} /><button onClick={onClose} style={{ border: "none", background: "none", fontSize: 24, color: C.faint, cursor: "pointer" }}>×</button>
        </div>
        <Label>工序狀態</Label>
        <select value={item?.status || "pending"} disabled={!canEdit} onChange={(e) => onSetStatus && onSetStatus(f.itemId, e.target.value)} style={{ ...ta, padding: "9px 10px", marginBottom: 14 }}>{Object.entries(WS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <Label>進度 {f.prog}%</Label>
        <input type="range" min="0" max="100" step="5" value={f.prog} onChange={(e) => upd("prog", +e.target.value)} style={{ width: "100%", marginBottom: 14, accentColor: ACCENT }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Label>{planned ? "預計工作" : "今日完成"}</Label><div style={{ flex: 1 }} /><button onClick={doTidy} style={{ border: `1px solid ${ACCENT}`, background: "#F3E4DE", color: "#3E72A8", borderRadius: 7, padding: "3px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✨ AI 整理</button></div>
        <textarea rows={3} value={planned ? f.next : f.done} onChange={(e) => upd(planned ? "next" : "done", e.target.value)} placeholder={planned ? "預計進場、預計拉線…" : "今天做了什麼…（可貼上截圖）"} style={{ ...ta, marginBottom: 14 }} />
        {!planned && <>
          <Label>問題 / 待追蹤</Label>
          <textarea rows={2} value={f.issue} onChange={(e) => upd("issue", e.target.value)} placeholder="缺料、不符圖說、需業主確認…" style={{ ...ta, marginBottom: 14 }} />
          <Label>明日計畫</Label>
          <textarea rows={2} value={f.next} onChange={(e) => upd("next", e.target.value)} placeholder="明天接著做什麼…" style={{ ...ta, marginBottom: 14 }} />
        </>}
        <Label>照片牆（可貼上截圖）</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {(f.photos || []).map((p, i) => <div key={i} style={{ position: "relative" }}><img src={p} alt="" onClick={() => setViewImg(p)} title="點擊放大" style={{ width: 66, height: 66, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.line}`, cursor: "zoom-in" }} /><button onClick={() => upd("photos", f.photos.filter((_, x) => x !== i))} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, border: "none", background: "#e11d48", color: "#fff", fontSize: 11, cursor: "pointer" }}>×</button></div>)}
          <button onClick={() => fileRef.current?.click()} style={{ width: 66, height: 66, borderRadius: 8, border: `1px dashed ${C.line}`, background: C.soft, fontSize: 22, color: C.faint, cursor: "pointer" }}>＋</button>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => addPhotos(e.target.files)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
          <button onClick={() => onCopy(f)} style={{ border: `1px solid ${C.line}`, background: C.soft, borderRadius: 9, padding: "8px 12px", fontSize: 13, cursor: "pointer", color: C.text }}>複製昨日</button>
          <div style={{ flex: 1 }} />
          {f.id && <button onClick={() => onDelete(f.id)} style={{ border: "none", background: "none", color: "#e11d48", fontSize: 14, cursor: "pointer" }}>刪除</button>}
          <button onClick={() => onSave(f)} disabled={busy} style={{ border: "none", background: ACCENT, color: "#ffffff", borderRadius: 9, padding: "9px 24px", fontSize: 14, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>{f.id ? "更新" : "儲存"}</button>
        </div>
      </div>
      {viewImg && (
        <div onClick={(e) => { e.stopPropagation(); setViewImg(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={viewImg} alt="" style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
