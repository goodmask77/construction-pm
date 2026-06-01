import { useState, useRef, useEffect, useMemo } from "react";

/* ════════════════════════════════════════════════════════════════════════
 *  SequenceView ── 工序 × 施工日誌（接 ground-pm cats / pm_seqlogs）
 *  工序 = 工程大項(cats)；日誌 = 工序時間軸上的事件(pm_seqlogs)。
 *  排程支援實際日期、非連續多區段（item.segments=[{start,end}]）。
 * ════════════════════════════════════════════════════════════════════════ */

const ACCENT = "#E8B84B", RED = "#d63b2b";
const C = { text: "#1f2430", sub: "#6b7280", faint: "#9aa1ad", line: "#e7e9ee", soft: "#f7f8fa" };
const TOTAL_WEEKS = 16, TOTAL_DAYS = TOTAL_WEEKS * 7;
const LABEL_W = 168, DAY_PXD = 44, WEEK_PXD = 12;
const ROW_H = 40, ROW_H_OPEN = 116, CARD_W = 150, MAX_OPEN = 3;

const WS = {
  pending: { label: "待開工",   color: "#5b6275", bar: "#aeb4c2", tint: "#eef0f3" },
  doing:   { label: "施工中",   color: "#1d6fd6", bar: "#5b9be8", tint: "#eaf2fd" },
  done:    { label: "完成",     color: "#15803d", bar: "#54c47a", tint: "#eaf7ee" },
  issue:   { label: "問題/延遲", color: "#d63b2b", bar: "#e86a5b", tint: "#fdeceb" },
  wait:    { label: "等待材料", color: "#b8730a", bar: "#e8a24b", tint: "#fdf3e3" },
};
const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const navBtn = { border: `1px solid ${C.line}`, background: "#fff", borderRadius: 8, width: 32, height: 32, fontSize: 17, cursor: "pointer", color: C.text };
const Label = ({ children }) => <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>{children}</div>;

export default function SequenceView({
  items = [], logs = [], projectStart = "2026-03-30", warnDays = 3, canEdit = false,
  onSaveLog, onDelLog, onSetStatus, onSetSchedule, onSetProjectStart, uploadPhotos, aiTidy, aiWeekly,
  onReorder, onAddSub, onDelSub,
}) {
  const [zoom, setZoom] = useState("week");
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
  const [drawer, setDrawer] = useState(null);
  const [schedItem, setSchedItem] = useState(null);
  const [tip, setTip] = useState(null);
  const [scrollTo, setScrollTo] = useState(null);
  const [weeklyOut, setWeeklyOut] = useState(null);
  const ref = useRef(null);

  // 日期數學（以 projectStart 為 W1 週一錨點）
  const START_D = useMemo(() => new Date(projectStart + "T00:00:00"), [projectStart]);
  const TODAY = toKey(new Date());
  const idxOf = (k) => Math.round((new Date(k + "T00:00:00") - START_D) / 86400000);
  const dayKey = (i) => { const d = new Date(START_D); d.setDate(d.getDate() + i); return toKey(d); };
  const TODAY_IDX = idxOf(TODAY);
  const dotFill = (log) => idxOf(log.date) > TODAY_IDX ? ACCENT : log.issue ? RED : "#ffffff";

  const ppd = zoom === "day" ? DAY_PXD : WEEK_PXD;
  const X = (i) => i * ppd, trackW = TOTAL_DAYS * ppd;

  // 每個工序的區段（day index 範圍）
  const segIdxOf = (it) => (it.segments || []).map(s => [idxOf(s.start), idxOf(s.end)]).filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a);
  const spanOf = (it) => { const segs = segIdxOf(it); if (!segs.length) return [0, 0]; return [Math.min(...segs.map(s=>s[0])), Math.max(...segs.map(s=>s[1]))]; };
  const inRange = (it, i) => segIdxOf(it).some(([a,b]) => i >= a && i <= b);

  const logsByItem = useMemo(() => { const m = {}; logs.forEach((l) => (m[l.itemId] ||= []).push(l)); return m; }, [logs]);
  const logMap = useMemo(() => { const m = {}; logs.forEach((l) => (m[`${l.itemId}|${l.date}`] = l)); return m; }, [logs]);

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
  const visItems = base.filter(it => !it.isSub || expandedParents.has(it.parentId)); // 子項目預設收合

  useEffect(() => { if (ref.current) ref.current.scrollLeft = X(TODAY_IDX) - 220; }, [zoom]); // eslint-disable-line
  useEffect(() => { if (scrollTo != null && ref.current) { ref.current.scrollLeft = X(scrollTo) - 120; setScrollTo(null); } }, [scrollTo]); // eslint-disable-line

  const toggle = (it) => {
    if (hasSubs(it)) { setExpandedParents(s => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; }); return; }
    if (zoom === "week") { setZoom("day"); setOpenIds([it.id]); setScrollTo(spanOf(it)[0]); return; }
    setOpenIds((o) => o.includes(it.id) ? o.filter((x) => x !== it.id) : [...o, it.id].slice(-MAX_OPEN));
  };
  const requireEdit = () => { if (!canEdit) { alert("此帳號沒有編輯工程資料的權限，請聯絡管理員開放。"); return false; } return true; };
  const saveLog = (l) => { if (!requireEdit()) return; onSaveLog && onSaveLog(l); setDrawer(null); };
  const delLog = (id) => { if (!requireEdit()) return; onDelLog && onDelLog(id); setDrawer(null); };
  const openCell = (itemId, date) => { if (!requireEdit()) return; const ex = logMap[`${itemId}|${date}`]; setDrawer(ex ? { ...ex } : { itemId, date, done: "", issue: "", next: "", prog: 0, photos: [] }); };
  const copyYesterday = (f) => { const p = logMap[`${f.itemId}|${dayKey(idxOf(f.date) - 1)}`]; if (p) setDrawer({ ...f, done: p.done, issue: p.issue, next: p.next, prog: p.prog }); };
  const doWeekly = async () => {
    if (!aiWeekly) return;
    setWeeklyOut("…產生中");
    const wk = logs.filter(l => { const i = idxOf(l.date); return i <= TODAY_IDX && i > TODAY_IDX - 7; });
    try { setWeeklyOut(await aiWeekly(wk, items)); } catch { setWeeklyOut("AI 連線失敗"); }
  };

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,'Noto Sans TC',sans-serif", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: "#e9ebef", borderRadius: 10, padding: 3 }}>
          {[["week", "週"], ["day", "日"]].map(([k, l]) => (
            <button key={k} onClick={() => { setZoom(k); if (k === "week") setOpenIds([]); }} style={{ border: "none", cursor: "pointer", padding: "6px 20px", borderRadius: 8, fontSize: 14, fontWeight: 700, background: zoom === k ? "#fff" : "transparent", color: zoom === k ? C.text : C.sub, boxShadow: zoom === k ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>{l}</button>
          ))}
        </div>
        <button onClick={() => setScrollTo(TODAY_IDX)} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 13, fontWeight: 700, color: ACCENT }}>今天</button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.sub, cursor: "pointer" }}>
          <input type="checkbox" checked={onlyIssue} onChange={(e) => setOnlyIssue(e.target.checked)} />只看異常
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.sub }}>
          專案起始
          <input type="date" value={projectStart} disabled={!canEdit} onChange={e => onSetProjectStart && onSetProjectStart(e.target.value)} style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: "4px 6px", fontSize: 12 }} />
        </label>
        <button onClick={doWeekly} style={{ border: `1px solid ${ACCENT}`, background: "#fffaf0", color: "#a06d04", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✨ AI 週報</button>
        <span style={{ fontSize: 13, color: C.faint }}>{zoom === "week" ? "點工序 ▸ 展開每日紀錄" : `點 ▸ 展開(最多${MAX_OPEN}) · 點空白新增 · 點卡片看詳細`}</span>
        <div style={{ flex: 1 }} />
        {Object.values(WS).map((s) => <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.sub }}><span style={{ width: 9, height: 9, borderRadius: 3, background: s.bar }} />{s.label}</span>)}
      </div>

      <div ref={ref} style={{ overflow: "auto", maxHeight: "calc(100vh - 240px)", border: `1px solid ${C.line}`, borderRadius: 12, background: "#fff", position: "relative" }}>
        <div style={{ minWidth: labelW + trackW }}>
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 3, background: "#fff", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ width: labelW, flexShrink: 0, position: "sticky", left: 0, zIndex: 4, background: "#fff", padding: "8px 12px", fontSize: 13, fontWeight: 700, color: C.sub, borderRight: `1px solid ${C.line}` }}>
              工程項目
              <div onMouseDown={startResize} title="拖曳調整欄寬" style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 7, cursor: "col-resize", zIndex: 6 }} />
            </div>
            <div style={{ position: "relative", width: trackW, height: 42 }}>
              {Array.from({ length: TOTAL_WEEKS }, (_, w) => {
                const d = new Date(START_D); d.setDate(d.getDate() + w * 7);
                return (
                  <div key={w} style={{ position: "absolute", left: X(w * 7), top: 0, bottom: 0, borderLeft: `1px solid ${C.line}`, paddingLeft: 5, display: "flex", flexDirection: "column", justifyContent: "center", lineHeight: 1.25 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>W{w + 1}</span>
                    {zoom === "week" && <span style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap" }}>{d.getMonth() + 1}/{d.getDate()}</span>}
                  </div>
                );
              })}
              {zoom === "day" && Array.from({ length: TOTAL_DAYS }, (_, i) => { const d = new Date(START_D); d.setDate(d.getDate() + i); const we = d.getDay() % 6 === 0; const showM = i % 7 === 0 || d.getDate() === 1; return <div key={i} style={{ position: "absolute", left: X(i), top: 27, width: ppd, textAlign: "center", fontSize: 10, color: we ? "#c0507a" : C.faint }}>{showM ? `${d.getMonth() + 1}/${d.getDate()}` : d.getDate()}</div>; })}
              <div style={{ position: "absolute", left: X(TODAY_IDX) + ppd / 2, top: 0, bottom: 0, width: 2, background: ACCENT }} />
            </div>
          </div>

          {visItems.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, fontSize: 13 }}>尚無工序（請到「總覽 / 看板」新增工程大項，或設定排程）</div>}
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
              <div key={it.id}
                onDragOver={(e) => { if (it.isParent && dragId && dragId !== it.id) { e.preventDefault(); setDragOverId(it.id); } }}
                onDrop={() => { if (it.isParent && dragId && dragId !== it.id) onReorder && onReorder(dragId, it.id); setDragId(null); setDragOverId(null); }}
                style={{ display: "flex", borderBottom: `1px solid ${C.line}`, minHeight: open ? ROW_H_OPEN : ROW_H, background: dragOverId === it.id ? "#fff5db" : (open ? "#fffdf7" : (it.isSub ? "#fcfcfd" : "#fff")) }}>
                <div style={{ width: labelW, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: dragOverId === it.id ? "#fff5db" : (open ? "#fffdf7" : w.tint), borderRight: `1px solid ${C.line}`, borderLeft: `4px solid ${w.bar}`, padding: "0 6px", paddingLeft: it.isSub ? 20 : 4, display: "flex", alignItems: "center", gap: 4 }}>
                  {it.isParent && canEdit && <span draggable onDragStart={() => setDragId(it.id)} onDragEnd={() => { setDragId(null); setDragOverId(null); }} title="拖曳排序大項" style={{ cursor: "grab", color: "#cfd3db", fontSize: 13, flexShrink: 0 }}>⠿</span>}
                  <button onClick={() => toggle(it)} style={{ border: "none", background: "none", cursor: "pointer", color: caretOpen ? ACCENT : C.faint, fontSize: 13, width: 12, flexShrink: 0, transform: caretOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</button>
                  <span onClick={(e) => { e.stopPropagation(); if (canEdit) setStatusPick({ id: it.id, x: e.clientX, y: e.clientY }); }} title={canEdit ? `${w.label}（點擊設定狀態）` : w.label} style={{ width: 12, height: 12, borderRadius: 3, background: w.bar, flexShrink: 0, cursor: canEdit ? "pointer" : "default", boxShadow: "0 0 0 1px rgba(0,0,0,.12)" }} />
                  <span onClick={() => toggle(it)} title={`${it.name}（${w.label}）`} style={{ fontSize: it.isSub ? 12 : 13, fontWeight: it.isSub ? 500 : 600, color: it.isSub ? C.sub : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", flex: 1 }}>{it.name}</span>
                  {isContainer && !subsOpen && <span style={{ fontSize: 10, color: C.faint, flexShrink: 0 }}>({subCount(it)})</span>}
                  {warnSet.has(it.id) && <span title={`連續 ${warnDays} 天無紀錄`} style={{ color: RED, fontSize: 13, flexShrink: 0 }}>⚠</span>}
                  {canEdit && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                    <button onClick={() => setSchedItem(it)} title="設定排程（日期/區段）" style={{ border: "none", background: "none", cursor: "pointer", color: C.faint, fontSize: 13 }}>📅</button>
                    {it.isParent && <button onClick={() => { const n = prompt(`在「${it.name}」下新增工程子項目：`); if (n && n.trim()) onAddSub && onAddSub(it.id, n.trim()); }} title="新增子項目" style={{ border: "none", background: "none", cursor: "pointer", color: ACCENT, fontSize: 15, fontWeight: 700 }}>＋</button>}
                    {it.isSub && <button onClick={() => { if (window.confirm(`刪除子項目「${it.name}」？`)) onDelSub && onDelSub(it.id); }} title="刪除子項目" style={{ border: "none", background: "none", cursor: "pointer", color: "#dc2626", fontSize: 13 }}>×</button>}
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
                      onClick={(e) => { e.stopPropagation(); setDrawer({ ...l }); }}
                      style={{ position: "absolute", left: dx - 4, top: (ROW_H - 22) / 2 + 12, width: 8, height: 8, borderRadius: 4, background: dotFill(l), boxShadow: "0 0 0 1px rgba(0,0,0,.4)", cursor: "pointer", zIndex: 2 }} />;
                  })}
                  {/* 展開：事件卡 */}
                  {cards.map(({ l, left }) => {
                    const planned = idxOf(l.date) > TODAY_IDX;
                    return (
                      <div key={l.id} onClick={(e) => { e.stopPropagation(); setDrawer({ ...l }); }}
                        style={{ position: "absolute", left, top: 40, width: CARD_W, background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${planned ? ACCENT : l.issue ? RED : w.bar}`, borderRadius: 8, padding: 7, cursor: "pointer", boxShadow: "0 1px 5px rgba(0,0,0,.09)", opacity: planned ? .82 : 1 }}>
                        <div style={{ display: "flex", gap: 7 }}>
                          {l.photos?.[0] && <img src={l.photos[0]} alt="" style={{ width: 40, height: 40, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: planned ? ACCENT : C.sub, fontWeight: 700 }}>{l.date.slice(5).replace("-", "/")}{planned ? " 預排" : ""}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.35 }}>{planned ? l.next : l.done}</div>
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
      </div>

      {tip && (
        <div style={{ position: "fixed", left: tip.x + 12, top: tip.y + 12, zIndex: 1100, background: "#1f2430", color: "#fff", borderRadius: 8, padding: "8px 10px", maxWidth: 220, fontSize: 12, pointerEvents: "none", boxShadow: "0 6px 18px rgba(0,0,0,.3)" }}>
          <div style={{ color: ACCENT, fontWeight: 700, marginBottom: 2 }}>{tip.item} · {tip.l.date.slice(5).replace("-", "/")}</div>
          <div style={{ lineHeight: 1.4 }}>{tip.l.done || tip.l.next}</div>
          {tip.l.issue && <div style={{ color: "#ff9a8f", marginTop: 2 }}>⚠ {tip.l.issue}</div>}
          {(tip.l.photos?.length || 0) > 0 && <div style={{ color: "#aab", marginTop: 3 }}>照片 {tip.l.photos.length} 張</div>}
        </div>
      )}

      {weeklyOut !== null && (
        <div onClick={() => setWeeklyOut(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,24,33,.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 22, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}><div style={{ fontSize: 16, fontWeight: 800 }}>✨ 本週施工週報</div><div style={{ flex: 1 }} /><button onClick={() => setWeeklyOut(null)} style={{ border: "none", background: "none", fontSize: 22, color: C.faint, cursor: "pointer" }}>×</button></div>
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

      {schedItem && <ScheduleEditor item={schedItem} onClose={() => setSchedItem(null)} onSave={(segs) => { onSetSchedule && onSetSchedule(schedItem.id, segs); setSchedItem(null); }} dayKey={dayKey} />}

      {drawer && <Drawer data={drawer} item={items.find((i) => i.id === drawer.itemId)} TODAY={TODAY} onSetStatus={onSetStatus} onSave={saveLog} onDelete={delLog} onClose={() => setDrawer(null)} onCopy={copyYesterday} uploadPhotos={uploadPhotos} aiTidy={aiTidy} canEdit={canEdit} />}
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
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}><div style={{ fontSize: 16, fontWeight: 800 }}>📅 {item.name} 排程</div><div style={{ flex: 1 }} /><button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: C.faint, cursor: "pointer" }}>×</button></div>
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
          <button onClick={() => onSave(valid)} style={{ border: "none", background: ACCENT, color: "#3a2c00", borderRadius: 9, padding: "9px 22px", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>儲存</button>
        </div>
      </div>
    </div>
  );
}

/* ── 右側結構化 Drawer ── */
function Drawer({ data, item, TODAY, onSetStatus, onSave, onDelete, onClose, onCopy, uploadPhotos, aiTidy, canEdit }) {
  const [f, setF] = useState({ ...data, photos: data.photos || [] });
  const [busy, setBusy] = useState(false);
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
          <div><div style={{ fontSize: 18, fontWeight: 800 }}>{item?.name}</div><div style={{ fontSize: 13, color: C.sub }}>{f.date.replaceAll("-", "/")}{planned ? "（預排）" : ""}{busy ? " · 處理中…" : ""}</div></div>
          <div style={{ flex: 1 }} /><button onClick={onClose} style={{ border: "none", background: "none", fontSize: 24, color: C.faint, cursor: "pointer" }}>×</button>
        </div>
        <Label>工序狀態</Label>
        <select value={item?.status || "pending"} disabled={!canEdit} onChange={(e) => onSetStatus && onSetStatus(f.itemId, e.target.value)} style={{ ...ta, padding: "9px 10px", marginBottom: 14 }}>{Object.entries(WS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <Label>進度 {f.prog}%</Label>
        <input type="range" min="0" max="100" step="5" value={f.prog} onChange={(e) => upd("prog", +e.target.value)} style={{ width: "100%", marginBottom: 14, accentColor: ACCENT }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Label>{planned ? "預計工作" : "今日完成"}</Label><div style={{ flex: 1 }} /><button onClick={doTidy} style={{ border: `1px solid ${ACCENT}`, background: "#fffaf0", color: "#a06d04", borderRadius: 7, padding: "3px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✨ AI 整理</button></div>
        <textarea rows={3} value={planned ? f.next : f.done} onChange={(e) => upd(planned ? "next" : "done", e.target.value)} placeholder={planned ? "預計進場、預計拉線…" : "今天做了什麼…（可貼上截圖）"} style={{ ...ta, marginBottom: 14 }} />
        {!planned && <>
          <Label>問題 / 待追蹤</Label>
          <textarea rows={2} value={f.issue} onChange={(e) => upd("issue", e.target.value)} placeholder="缺料、不符圖說、需業主確認…" style={{ ...ta, marginBottom: 14 }} />
          <Label>明日計畫</Label>
          <textarea rows={2} value={f.next} onChange={(e) => upd("next", e.target.value)} placeholder="明天接著做什麼…" style={{ ...ta, marginBottom: 14 }} />
        </>}
        <Label>照片牆（可貼上截圖）</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {(f.photos || []).map((p, i) => <div key={i} style={{ position: "relative" }}><img src={p} alt="" style={{ width: 66, height: 66, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.line}` }} /><button onClick={() => upd("photos", f.photos.filter((_, x) => x !== i))} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, border: "none", background: "#e11d48", color: "#fff", fontSize: 11, cursor: "pointer" }}>×</button></div>)}
          <button onClick={() => fileRef.current?.click()} style={{ width: 66, height: 66, borderRadius: 8, border: `1px dashed ${C.line}`, background: C.soft, fontSize: 22, color: C.faint, cursor: "pointer" }}>＋</button>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => addPhotos(e.target.files)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
          <button onClick={() => onCopy(f)} style={{ border: `1px solid ${C.line}`, background: C.soft, borderRadius: 9, padding: "8px 12px", fontSize: 13, cursor: "pointer", color: C.text }}>複製昨日</button>
          <div style={{ flex: 1 }} />
          {f.id && <button onClick={() => onDelete(f.id)} style={{ border: "none", background: "none", color: "#e11d48", fontSize: 14, cursor: "pointer" }}>刪除</button>}
          <button onClick={() => onSave(f)} disabled={busy} style={{ border: "none", background: ACCENT, color: "#3a2c00", borderRadius: 9, padding: "9px 24px", fontSize: 14, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>{f.id ? "更新" : "儲存"}</button>
        </div>
      </div>
    </div>
  );
}
