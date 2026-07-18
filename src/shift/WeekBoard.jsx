// 週班表（§H38 主畫面）：人員×星期矩陣、拖拉、鎖定、即時法遵檢查、缺口報告、求解器、驗收比對
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import {
  schedKey, DOC_KEYS, SCHEMA_V, newSchedule, mondayOf, addDays, weekDates, toISO, fmtMD, DOW_LABEL, dowOf,
  byId, shiftHours, seatsForWeek, estCost, skillOf, BASELINE_WEEK, SCHED_STATUS,
} from "./model.js";
import { checkSchedule, canPublish } from "./checker.js";
import { solveWeek, diffSchedules } from "./solver.js";
import { T, card, inp, btn, chip, SecHead } from "./ShiftView.jsx";
import { Lock, Unlock, Play, RotateCcw, GitCompare, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";

const todayISO = () => toISO(new Date());

export default function WeekBoard({ K, storeId, canEdit, confirm, userName, isMobile, onLog, data, saveLeaves }) {
  const { staff, skills, stations, shifts, demands, leaves, rules, settings, weights } = data;
  const staffById = byId(staff), shiftById = byId(shifts), stationById = byId(stations);
  const [weekStart, setWeekStart] = useState(mondayOf(todayISO()));
  const [sched, setSched] = useState(null);        // 本週文件
  const [others, setOthers] = useState([]);        // 其他週 assignments（跨週規則用）
  const [editCell, setEditCell] = useState(null);  // {staffId, date}
  const [dragA, setDragA] = useState(null);        // 拖拉中的 assignment id
  const [dragOver, setDragOver] = useState(null);
  const [diffModal, setDiffModal] = useState(null);
  const [busy, setBusy] = useState(false);

  // 載入本週 + 其他週（同店所有已存週次，供連續出勤/月加班等跨週檢查）
  useEffect(() => {
    (async () => {
      setSched(null);
      const idx = await load(DOC_KEYS.schedIndex) || { weeks: [] };
      const cur = await load(schedKey(storeId, weekStart)) || newSchedule(storeId, weekStart);
      const otherWeeks = (idx.weeks || []).filter(w => w.storeId === storeId && w.weekStart !== weekStart);
      const otherDocs = await Promise.all(otherWeeks.map(w => load(schedKey(storeId, w.weekStart))));
      setOthers(otherDocs.filter(Boolean).flatMap(d => d.assignments || []));
      setSched(cur);
    })();
  }, [storeId, weekStart]); // eslint-disable-line
  const load = async (key) => { try { const r = await window.storage.get(K(key), true); if (r && r.value) return JSON.parse(r.value); } catch (_) {} return null; };

  const persist = useCallback(async (doc, logDetail) => {
    setSched(doc);
    try { onLog && logDetail && onLog("編輯", "排班・" + logDetail); } catch (_) {}
    try {
      await window.storage.set(K(schedKey(storeId, weekStart)), JSON.stringify(doc), true);
      const idx = await load(DOC_KEYS.schedIndex) || { schema_v: SCHEMA_V, weeks: [] };
      const rest = (idx.weeks || []).filter(w => !(w.storeId === storeId && w.weekStart === weekStart));
      await window.storage.set(K(DOC_KEYS.schedIndex), JSON.stringify({ ...idx, weeks: [...rest, { storeId, weekStart, status: doc.status }] }), true);
    } catch (_) {}
  }, [K, storeId, weekStart, onLog]); // eslint-disable-line

  // 發布後修改要留變更紀錄（§21）
  const mutate = async (fn, what) => {
    if (!canEdit || !sched) return;
    if (sched.status === "locked") { alert("班表已鎖定，要修改請先退回草稿。"); return; }
    let doc = { ...sched, assignments: [...sched.assignments] };
    fn(doc);
    if (sched.status === "published") {
      const reason = window.prompt(`班表已發布，修改需填原因（會留紀錄）：\n${what}`);
      if (!reason) return;
      doc.changeLog = [...(doc.changeLog || []), { ts: new Date().toISOString(), user: userName || "?", what, reason }];
    }
    await persist(doc, what);
  };

  // ── 即時檢查（§H38 拖拉即時：紅=硬條件、黃=軟提示、綠=正常）──
  const ctxBase = { storeId, weekStart, staff, skills, shifts, stations, leaves, rules, settings, otherAssignments: others };
  const check = useMemo(() => sched ? checkSchedule({ ...ctxBase, assignments: sched.assignments }) : { violations: [], notices: [] }, [sched, others, data]); // eslint-disable-line
  const seats = useMemo(() => seatsForWeek(demands, weekStart, storeId, sched?.overrides || [], null), [demands, weekStart, storeId, sched]);
  // 缺口 = 需求席次沒被填滿（依 date+shift+station 數量比對）
  const gaps = useMemo(() => {
    if (!sched) return [];
    const cnt = {};
    for (const a of sched.assignments) { const k2 = `${a.date}|${a.shiftId}|${a.stationId}`; cnt[k2] = (cnt[k2] || 0) + 1; }
    const need = {};
    for (const s of seats) { const k2 = `${s.date}|${s.shiftId}|${s.stationId}`; need[k2] = (need[k2] || 0) + 1; }
    return Object.entries(need).filter(([k2, n]) => (cnt[k2] || 0) < n).map(([k2, n]) => {
      const [date, shiftId, stationId] = k2.split("|");
      const solverGap = (sched.solverGaps || []).find(g => g.date === date && g.shiftId === shiftId && g.stationId === stationId);
      return { date, shiftId, stationId, missing: n - (cnt[k2] || 0), reasons: solverGap?.reasons || [] };
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [sched, seats]);
  // 格子燈號：staffId|date → block / warn
  const cellFlag = useMemo(() => {
    const m = {};
    for (const v of check.violations) {
      if (!v.staffId) continue;
      let d = v.dates[0];
      while (d <= v.dates[1]) { const k2 = v.staffId + "|" + d; m[k2] = m[k2] === "block" ? "block" : v.severity === "block" ? "block" : "warn"; d = addDays(d, 1); }
    }
    return m;
  }, [check]);
  const dates = weekDates(weekStart);
  const { hours: totalHours, cost: totalCost } = useMemo(() => sched ? estCost(sched.assignments, staffById, shiftById, rules) : { hours: 0, cost: 0 }, [sched]); // eslint-disable-line
  const dailyOK = useMemo(() => dates.map(d => {
    const needN = seats.filter(s => s.date === d).length;
    const gapN = gaps.filter(g => g.date === d).reduce((s, g) => s + g.missing, 0);
    return { date: d, need: needN, ok: needN - gapN };
  }), [seats, gaps, weekStart]); // eslint-disable-line

  // ── 求解器 ──
  const runSolver = async (mode, day) => {
    if (!canEdit || !sched || busy) return;
    setBusy(true);
    try {
      let keep;
      if (mode === "all") keep = sched.assignments.filter(a => a.pinned);
      else if (mode === "rest") keep = [...sched.assignments];
      else keep = sched.assignments.filter(a => a.pinned || a.date !== day); // 重排單日
      if (mode !== "rest" && sched.assignments.length > keep.length) {
        const n = sched.assignments.length - keep.length;
        if (!(await confirm(`將覆蓋 ${n} 個未鎖定格（鎖定格不動），繼續？`))) { setBusy(false); return; }
      }
      const res = solveWeek({ ...ctxBase, demands, weights, overrides: sched.overrides || [], keepAssignments: keep });
      await persist({ ...sched, status: "draft", assignments: res.assignments, solverGaps: res.gaps, solverStats: res.stats }, mode === "all" ? "產生班表" : mode === "rest" ? "排其餘" : `重排單日 ${fmtMD(day)}`);
    } finally { setBusy(false); }
  };

  // ── 驗收比對（§46-47）：對基準週跑求解器 vs 實際班表 ──
  const runDiff = async () => {
    setBusy(true);
    try {
      const baseDoc = await load(schedKey(storeId, BASELINE_WEEK));
      if (!baseDoc || !baseDoc.assignments?.length) { alert("找不到上週實際班表（基準）。"); setBusy(false); return; }
      const res = solveWeek({ storeId, weekStart: BASELINE_WEEK, staff, skills, shifts, stations, demands, leaves, rules, settings, weights, overrides: [], keepAssignments: [], otherAssignments: [] });
      const diffs = diffSchedules(baseDoc.assignments, res.assignments, staffById, shiftById, stationById);
      const baseSeats = seatsForWeek(demands, BASELINE_WEEK, storeId, [], null);
      const withReason = diffs.map(d => {
        const inDemand = baseSeats.some(s => `${fmtMD(s.date)} ${shiftById[s.shiftId]?.code}·${stationById[s.stationId]?.code}` === d.slot);
        let reason;
        if (d.b === "（空）" && !inDemand) reason = "實際加班段：需求表沒有此席（隱性需求或臨時加班）";
        else if (d.a === "（空）") reason = "實際沒填這席（可能現場缺口或省人力）";
        else reason = "軟條件取捨：公平性/期望班數權重讓求解器換了人（實際排法可能含表格沒記載的隱性約束）";
        return { ...d, reason };
      });
      setDiffModal({ diffs: withReason, stats: res.stats, actualViolations: checkSchedule({ storeId, weekStart: BASELINE_WEEK, assignments: baseDoc.assignments, staff, skills, shifts, stations, leaves, rules, settings }).violations });
    } finally { setBusy(false); }
  };

  if (!sched) return <div style={{ padding: 40, textAlign: "center", color: T.SUB }}>載入週班表…</div>;
  const statusIdx = SCHED_STATUS.findIndex(([k]) => k === sched.status);
  const blockCount = check.violations.filter(v => v.severity === "block").length;
  const warnCount = check.violations.length - blockCount;
  const staffRows = staff.filter(p => (p.stores || []).includes(storeId));

  const setStatus = async (next) => {
    if (next === "published" && !canPublish(check.violations)) { alert(`還有 ${blockCount} 筆硬條件違規，不能發布（§14）。先解決紅色格。`); return; }
    await persist({ ...sched, status: next }, `班表狀態 → ${SCHED_STATUS.find(([k]) => k === next)?.[1]}`);
  };

  // 拖拉：把 assignment 移到別人/別天
  const onDropCell = (staffId, date) => {
    if (!dragA) return;
    const a = sched.assignments.find(x => x.id === dragA);
    setDragA(null); setDragOver(null);
    if (!a || a.pinned || (a.staffId === staffId && a.date === date)) return;
    mutate(doc => { doc.assignments = doc.assignments.map(x => x.id === a.id ? { ...x, staffId, date } : x); },
      `拖移 ${shiftById[a.shiftId]?.code} ${fmtMD(a.date)}→${fmtMD(date)} ${staffById[staffId]?.nick || ""}`);
  };

  const cellAssigns = (staffId, date) => sched.assignments.filter(a => a.staffId === staffId && a.date === date);
  const flagColor = { block: T.RED, warn: T.AMBER };

  const CellChips = ({ p, date }) => cellAssigns(p.id, date).map(a => {
    const sh = shiftById[a.shiftId];
    return (
      <div key={a.id} draggable={canEdit && !a.pinned} onDragStart={() => setDragA(a.id)}
        title={`${sh?.name} ${sh?.start}–${sh?.end}｜${stationById[a.stationId]?.name || ""}${a.pinned ? "｜已鎖定" : ""}`}
        style={{ background: sh?.color || T.GREY, color: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 10.5, fontWeight: 700, marginBottom: 2, cursor: canEdit && !a.pinned ? "grab" : "default", display: "flex", alignItems: "center", gap: 3, justifyContent: "center" }}>
        {a.pinned && <Lock size={9} />}{sh?.code}·{stationById[a.stationId]?.code}
      </div>
    );
  });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 週導覽 + 狀態 + 動作 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button style={btn(false)} onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={14} /></button>
        <span style={{ fontWeight: 800, fontFamily: T.MONO }}>{fmtMD(weekStart)}–{fmtMD(addDays(weekStart, 6))}</span>
        <button style={btn(false)} onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={14} /></button>
        <button style={{ ...btn(false), fontSize: 12 }} onClick={() => setWeekStart(mondayOf(todayISO()))}>本週</button>
        <span style={chip(sched.status === "locked" ? T.TEXT : sched.status === "published" ? T.GREEN : sched.status === "review" ? T.BLUE : T.GREY)}>{SCHED_STATUS[statusIdx]?.[1]}{sched.isActual ? "（實際）" : ""}</span>
        <div style={{ flex: 1 }} />
        {canEdit && <Fragment>
          <button disabled={busy} style={btn(true)} onClick={() => runSolver("all")}><Play size={13} /> 產生班表</button>
          <button disabled={busy} style={btn(false)} onClick={() => runSolver("rest")}>排其餘（尊重現有）</button>
          <select style={inp} defaultValue="" onChange={e => { if (e.target.value) { runSolver("day", e.target.value); e.target.value = ""; } }}>
            <option value="">重排單日…</option>{dates.map(d => <option key={d} value={d}>{fmtMD(d)}（{DOW_LABEL[dowOf(d)]}）</option>)}
          </select>
          <button disabled={busy} style={btn(false)} onClick={runDiff}><GitCompare size={13} /> 驗收比對(上週)</button>
        </Fragment>}
      </div>

      {/* 頂部統計（§H38 只保留這五項） */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap: 8 }}>
        {[
          ["每日人力達標", dailyOK.filter(d => d.ok >= d.need).length + "/7 天"],
          ["缺班數", gaps.reduce((s, g) => s + g.missing, 0)],
          ["總工時", totalHours + "h"],
          ["預估成本", "NT$" + totalCost.toLocaleString()],
          ["未解決衝突", blockCount + warnCount ? `${blockCount} 硬 / ${warnCount} 提示` : "0"],
        ].map(([l, v]) => (
          <div key={l} style={{ ...card, padding: "10px 14px" }}>
            <div style={{ fontSize: 11.5, color: T.SUB }}>{l}</div>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: T.MONO, color: l === "未解決衝突" && blockCount ? T.RED : T.TEXT }}>{v}</div>
          </div>))}
      </div>
      {check.notices.map((n, i) => <div key={i} style={{ background: "#fdf1dc", border: `1px solid ${T.AMBER}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "#7a5308" }}>⚠ {n}</div>)}

      {/* 班表主體 */}
      {!isMobile ? (
        <div style={{ ...card, padding: 8, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead><tr>
              <th style={{ padding: 6, textAlign: "left", color: T.SUB, minWidth: 76 }}>人員</th>
              {dates.map((d, i) => { const ok = dailyOK[i]; return (
                <th key={d} style={{ padding: 6, minWidth: 92, color: T.SUB }}>
                  {fmtMD(d)}（{DOW_LABEL[dowOf(d)]}）
                  <div style={{ fontSize: 10, fontWeight: 400, color: ok.ok >= ok.need ? T.GREEN : T.RED }}>{ok.ok}/{ok.need} 席</div>
                </th>); })}
            </tr></thead>
            <tbody>{staffRows.map(p => (
              <tr key={p.id}>
                <td style={{ padding: "4px 6px", fontWeight: 700, borderTop: `1px solid ${T.BORDER}`, whiteSpace: "nowrap" }}>
                  {p.nick || p.name}
                  <div style={{ fontSize: 10, color: T.SUB, fontWeight: 400 }}>{cellCount(sched, p.id)}班 / 期望{p.expectShifts || 0}</div>
                </td>
                {dates.map(d => {
                  const flag = cellFlag[p.id + "|" + d];
                  const onLeave = leaves.find(l => l.staffId === p.id && l.date === d && l.status === "approved");
                  const ua = (p.unavailable || []).some(u => u.dow === dowOf(d));
                  return (
                    <td key={d}
                      onDragOver={e => { e.preventDefault(); setDragOver(p.id + "|" + d); }}
                      onDrop={() => onDropCell(p.id, d)}
                      onClick={() => canEdit && setEditCell({ staffId: p.id, date: d })}
                      style={{
                        padding: 3, borderTop: `1px solid ${T.BORDER}`, borderLeft: `1px solid ${T.BORDER}`, verticalAlign: "top", cursor: canEdit ? "pointer" : "default", minHeight: 40,
                        background: dragOver === p.id + "|" + d ? T.SOFT : onLeave ? "#f3eee6" : "transparent",
                        outline: flag ? `2px solid ${flagColor[flag]}` : "none", outlineOffset: -2,
                      }}>
                      {onLeave && <div style={{ fontSize: 10, color: T.SUB, textAlign: "center" }}>{onLeave.type}</div>}
                      {!onLeave && ua && !cellAssigns(p.id, d).length && <div style={{ fontSize: 10, color: T.GREY, textAlign: "center" }}>不可</div>}
                      <CellChips p={p} date={d} />
                    </td>);
                })}
              </tr>))}</tbody>
          </table>
          <div style={{ fontSize: 11, color: T.SUB, padding: "6px 4px" }}>拖拉格子換人/換天（🔒鎖定格不動）；點格子編輯。紅框=硬條件違規（不可發布）、黃框=提示。</div>
        </div>
      ) : (
        /* 手機版：表格改卡片（§H38） */
        <div style={{ display: "grid", gap: 10 }}>
          {dates.map((d, i) => (
            <div key={d} style={card}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{fmtMD(d)}（{DOW_LABEL[dowOf(d)]}）<span style={{ fontSize: 11, color: dailyOK[i].ok >= dailyOK[i].need ? T.GREEN : T.RED, marginLeft: 8 }}>{dailyOK[i].ok}/{dailyOK[i].need} 席</span></div>
              {staffRows.filter(p => cellAssigns(p.id, d).length).map(p => (
                <div key={p.id} onClick={() => canEdit && setEditCell({ staffId: p.id, date: d })} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderTop: `1px solid ${T.BORDER}` }}>
                  <span style={{ fontWeight: 700, minWidth: 56, color: cellFlag[p.id + "|" + d] ? flagColor[cellFlag[p.id + "|" + d]] : T.TEXT }}>{p.nick || p.name}</span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}><CellChips p={p} date={d} /></div>
                </div>))}
            </div>))}
        </div>
      )}

      {/* 狀態流轉 */}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: T.SUB }}>狀態：</span>
          {SCHED_STATUS.map(([k, l], i) => (
            <button key={k} disabled={k === sched.status} style={{ ...btn(k === sched.status), opacity: k === sched.status ? 1 : 0.85, fontSize: 12 }} onClick={() => setStatus(k)}>{i > statusIdx ? "→ " : "↩ "}{l}</button>
          ))}
          {!canPublish(check.violations) && <span style={{ fontSize: 12, color: T.RED }}>（有硬條件違規，發布被擋 §14）</span>}
        </div>
      )}

      {/* 底部：違規清單 + 缺口報告（§H38） */}
      {(check.violations.length > 0 || gaps.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <div style={card}>
            <SecHead tag={String(check.violations.length)} title="違規清單" />
            {check.violations.length === 0 && <div style={{ color: T.GREEN, fontSize: 13 }}>✓ 無違規</div>}
            {check.violations.map((v, i) => (
              <div key={i} style={{ fontSize: 12.5, padding: "6px 8px", borderLeft: `3px solid ${v.severity === "block" ? T.RED : T.AMBER}`, background: "#fff", borderRadius: 4, marginBottom: 5 }}>
                <span style={chip(v.severity === "block" ? T.RED : T.AMBER)}>{v.severity === "block" ? "硬" : "提示"}</span> {v.message}
              </div>))}
          </div>
          <div style={card}>
            <SecHead tag={String(gaps.reduce((s, g) => s + g.missing, 0))} title="缺口報告" />
            {gaps.length === 0 && <div style={{ color: T.GREEN, fontSize: 13 }}>✓ 無缺口</div>}
            {gaps.map((g, i) => (
              <div key={i} style={{ fontSize: 12.5, padding: "6px 8px", background: "#fff", borderRadius: 4, marginBottom: 5, border: `1px solid ${T.BORDER}` }}>
                <b>{fmtMD(g.date)}（{DOW_LABEL[dowOf(g.date)]}）{shiftById[g.shiftId]?.code}·{stationById[g.stationId]?.code}</b> 缺 {g.missing} 人
                {g.reasons.length > 0 && <div style={{ color: T.SUB, fontSize: 11.5, marginTop: 3 }}>{g.reasons.map((r, ri) => <div key={ri}>· {r}</div>)}</div>}
              </div>))}
          </div>
        </div>
      )}

      {/* 本週請假登記（已核准 = 硬條件 §23） */}
      <div style={card}>
        <SecHead tag="LEAVE" title="請假／不可排（本週）" right={canEdit && <button style={btn(false)} onClick={() => saveLeaves([...leaves, { id: "lv-" + Math.random().toString(36).slice(2, 8), staffId: staffRows[0]?.id, date: weekStart, from: "00:00", to: "24:00", type: "特休", status: "approved", approver: userName || "", seed: "" }])}><Plus size={12} /> 登記</button>} />
        {leaves.filter(l => l.date >= weekStart && l.date <= addDays(weekStart, 6)).map(l => (
          <div key={l.id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, fontSize: 12.5, flexWrap: "wrap" }}>
            <select disabled={!canEdit} style={inp} value={l.staffId} onChange={e => saveLeaves(leaves.map(x => x.id === l.id ? { ...x, staffId: e.target.value } : x))}>{staffRows.map(p => <option key={p.id} value={p.id}>{p.nick || p.name}</option>)}</select>
            <input type="date" disabled={!canEdit} style={inp} value={l.date} onChange={e => saveLeaves(leaves.map(x => x.id === l.id ? { ...x, date: e.target.value } : x))} />
            <select disabled={!canEdit} style={inp} value={l.type} onChange={e => saveLeaves(leaves.map(x => x.id === l.id ? { ...x, type: e.target.value } : x))}>{["特休", "事假", "病假", "不可排"].map(t => <option key={t}>{t}</option>)}</select>
            <span style={chip(l.status === "approved" ? T.GREEN : T.AMBER)}>{l.status === "approved" ? "已核准" : "待核"}</span>
            {canEdit && <button style={{ ...btn(false), padding: "3px 8px", color: T.RED }} onClick={() => saveLeaves(leaves.filter(x => x.id !== l.id))}><Trash2 size={12} /></button>}
          </div>))}
        {leaves.filter(l => l.date >= weekStart && l.date <= addDays(weekStart, 6)).length === 0 && <div style={{ color: T.SUB, fontSize: 12.5 }}>本週無請假。</div>}
      </div>

      {/* 變更紀錄（發布後） */}
      {(sched.changeLog || []).length > 0 && (
        <div style={card}>
          <SecHead tag="LOG" title="發布後變更紀錄" />
          {(sched.changeLog || []).slice().reverse().map((c, i) => <div key={i} style={{ fontSize: 12, color: T.SUB, marginBottom: 3 }}>{c.ts?.slice(0, 16).replace("T", " ")}｜{c.user}｜{c.what}｜原因：{c.reason}</div>)}
        </div>
      )}

      {editCell && <CellEditor {...{ sched, editCell, staffById, shiftById, stationById, shifts, stations, skills, mutate, canEdit }} onClose={() => setEditCell(null)} storeId={storeId} />}
      {diffModal && <DiffModal diff={diffModal} onClose={() => setDiffModal(null)} isMobile={isMobile} />}
    </div>
  );
}
const cellCount = (sched, staffId) => sched.assignments.filter(a => a.staffId === staffId).length;

// 點格子：新增/刪除/鎖定
function CellEditor({ sched, editCell, staffById, shiftById, stationById, shifts, stations, skills, mutate, canEdit, onClose, storeId }) {
  const { staffId, date } = editCell;
  const p = staffById[staffId];
  const list = sched.assignments.filter(a => a.staffId === staffId && a.date === date);
  const [shiftId, setShiftId] = useState(shifts.filter(s => s.storeId === storeId)[0]?.id);
  const [stationId, setStationId] = useState("");
  const stOptions = stations.filter(s => s.storeId === storeId).map(s => ({ ...s, lv: skillOf(skills, staffId, s.id) }));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(29,26,21,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: 420, maxWidth: "100%", background: "#fff" }}>
        <SecHead tag="CELL" title={`${p?.nick || p?.name}・${fmtMD(date)}（${DOW_LABEL[dowOf(date)]}）`} right={<button style={btn(true)} onClick={onClose}>完成</button>} />
        {list.map(a => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${T.BORDER}`, fontSize: 13 }}>
            <span style={chip(shiftById[a.shiftId]?.color)}>{shiftById[a.shiftId]?.code}</span>
            {shiftById[a.shiftId]?.start}–{shiftById[a.shiftId]?.end}｜{stationById[a.stationId]?.name}
            <div style={{ flex: 1 }} />
            <button title={a.pinned ? "解除鎖定" : "鎖定（求解器不覆蓋）"} style={{ ...btn(a.pinned), padding: "4px 8px" }} onClick={() => mutate(doc => { doc.assignments = doc.assignments.map(x => x.id === a.id ? { ...x, pinned: !x.pinned } : x); }, `${a.pinned ? "解鎖" : "鎖定"}格 ${fmtMD(date)}`)}>{a.pinned ? <Lock size={12} /> : <Unlock size={12} />}</button>
            <button style={{ ...btn(false), padding: "4px 8px", color: T.RED }} onClick={() => mutate(doc => { doc.assignments = doc.assignments.filter(x => x.id !== a.id); }, `刪格 ${fmtMD(date)} ${shiftById[a.shiftId]?.code}`)}><Trash2 size={12} /></button>
          </div>))}
        {canEdit && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select style={inp} value={shiftId} onChange={e => setShiftId(e.target.value)}>{shifts.filter(s => s.storeId === storeId).map(s => <option key={s.id} value={s.id}>{s.code} {s.start}–{s.end}</option>)}</select>
            <select style={inp} value={stationId} onChange={e => setStationId(e.target.value)}>
              <option value="">崗位…</option>
              {stOptions.map(s => <option key={s.id} value={s.id} disabled={s.lv === "no"}>{s.code}（{s.lv === "no" ? "不可" : s.lv === "main" ? "主力" : s.lv === "ok" ? "可勝任" : "受訓中"}）</option>)}
            </select>
            <button style={btn(true)} disabled={!stationId} onClick={() => { mutate(doc => { doc.assignments = [...doc.assignments, { id: "mn-" + Math.random().toString(36).slice(2, 9), staffId, date, shiftId, stationId, pinned: false }]; }, `加格 ${fmtMD(date)}`); }}><Plus size={13} /> 加入</button>
          </div>
        )}
        <div style={{ fontSize: 11, color: T.SUB, marginTop: 8 }}>加入後立即跑法遵檢查 — 紅框代表硬條件違規，班表無法發布。</div>
      </div>
    </div>
  );
}

// 驗收比對結果（§46-47）
function DiffModal({ diff, onClose, isMobile }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(29,26,21,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: 760, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", background: "#fff" }}>
        <SecHead tag={String(diff.diffs.length)} title="驗收比對：上週實際 vs 求解器產出（差異≠錯誤，每處都要能解讀 §47）" right={<button style={btn(true)} onClick={onClose}>關閉</button>} />
        {diff.actualViolations.length > 0 && (
          <div style={{ marginBottom: 10, fontSize: 12.5 }}>
            <b style={{ color: T.RED }}>實際班表自身違規 {diff.actualViolations.length} 筆：</b>
            {diff.actualViolations.map((v, i) => <div key={i} style={{ color: T.SUB, marginTop: 2 }}>⚠ {v.message}</div>)}
          </div>
        )}
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
          <thead><tr style={{ color: T.SUB, textAlign: "left" }}>{["時段·崗位", "實際", "求解器", "推測原因"].map(h => <th key={h} style={{ padding: "4px 8px", borderBottom: `1px solid ${T.BORDER}` }}>{h}</th>)}</tr></thead>
          <tbody>{diff.diffs.map((d, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.BORDER}` }}>
              <td style={{ padding: "5px 8px", whiteSpace: "nowrap", fontFamily: T.MONO }}>{d.slot}</td>
              <td style={{ padding: "5px 8px", fontWeight: 700 }}>{d.a}</td>
              <td style={{ padding: "5px 8px", fontWeight: 700, color: T.BLUE }}>{d.b}</td>
              <td style={{ padding: "5px 8px", color: T.SUB, fontSize: 11.5 }}>{d.reason}</td>
            </tr>))}</tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.SUB, background: T.SOFT, borderRadius: 8, padding: "8px 12px" }}>
          👉 請逐條看「實際」欄：如果實際排法有你腦中的隱性規則（誰不能同班、誰週六要早走、誰只能跟誰搭），把它補進「人員與能力」的不可排/技能矩陣或希望休假，系統才真的認識你的店。
        </div>
      </div>
    </div>
  );
}
