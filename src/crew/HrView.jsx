// 🕐 人資系統（張良 2026-09-30）：NUEiP 同步資料呈現——先做「出勤紀錄」每人每天
// 資料：sp_crew_pm_hr_att_YYYY-MM（api/hr.js 每日 22:40 自動抓；🔄鈕手動更新）；異常已由 D哥 LINE 通知
import React, { useEffect, useState } from "react";

const C = { text: "#1d1a15", sub: "#5a5247", faint: "#9b9384", line: "#e3ddd0", card: "#fff", soft: "#f4efe5", green: "#3f7d4e", red: "#b3261e", amber: "#c98a14", blue: "#3a6ea5" };
const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

export default function HrView() {
  const nowMo = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  const [mo, setMo] = useState(nowMo);
  const [doc, setDoc] = useState(null);
  const [pF, setPF] = useState("");       // 人員篩選
  const [onlyBad, setOnlyBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async (m) => {
    setDoc(null);
    try { const v = await window.storage.get("sp_crew_pm_hr_att_" + m, true); setDoc(v && v.value ? JSON.parse(v.value) : { days: {} }); } catch (_) { setDoc({ days: {} }); }
  };
  useEffect(() => { load(mo); }, [mo]);

  const syncNow = async () => {
    setBusy(true); setMsg("");
    try {
      const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
      const from = mo === nowMo ? mo + "-01" : mo + "-01";
      const to = mo === nowMo ? today : mo + "-31";
      const r = await fetch(`/api/hr?manual=1&from=${from}&to=${to}`);
      const j = await r.json();
      setMsg(j.ok ? `✓ 已從 NUEiP 更新 ${j.personDays} 筆人日` : "⚠ 更新失敗：" + (j.error || ""));
      await load(mo);
    } catch (e) { setMsg("⚠ 更新失敗"); }
    setBusy(false);
  };

  const days = doc ? Object.keys(doc.days || {}).sort((a, b) => (a < b ? 1 : -1)) : [];
  const people = [...new Set(days.flatMap(d => Object.values(doc.days[d]).map(r => r.name)))].sort((a, b) => a.localeCompare(b, "zh-TW"));
  const isBad = (r) => r.absent || r.miss || r.late || r.early;
  // 本月統計（每人：遲到次/分、缺卡、曠職）
  const stats = {};
  days.forEach(d => Object.values(doc.days[d]).forEach(r => {
    const s = stats[r.name] = stats[r.name] || { late: 0, lateMin: 0, miss: 0, absent: 0, days: 0 };
    s.days++; if (r.late) { s.late++; s.lateMin += r.late; } if (r.miss) s.miss++; if (r.absent) s.absent++;
  }));
  const badPeople = Object.entries(stats).filter(([, s]) => s.late || s.miss || s.absent).sort((a, b) => (b[1].late + b[1].miss + b[1].absent) - (a[1].late + a[1].miss + a[1].absent));

  const inp = { border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", color: C.text, outline: "none" };
  const th = { padding: "7px 9px", fontSize: 10.5, letterSpacing: .6, color: C.sub, fontWeight: 700, whiteSpace: "nowrap", textAlign: "left", background: "#ece4d6", borderBottom: `1.5px solid #c8bca6`, position: "sticky", top: 0 };
  const td = { padding: "6px 9px", fontSize: 12.5, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", verticalAlign: "middle" };
  const badge = (r) => {
    const fx = [];
    if (r.absent) fx.push(["曠職", C.red]);
    if (r.miss) fx.push(["缺卡", C.amber]);
    if (r.late) fx.push([`遲到${r.late}分`, C.red]);
    if (r.early) fx.push([`早退${r.early}分`, C.amber]);
    if (!fx.length) return <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>OK</span>;
    return fx.map(([t, c], i) => <span key={i} style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: c, borderRadius: 4, padding: "1px 7px", marginRight: 4 }}>{t}</span>);
  };
  const durTxt = (m) => m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "—";
  const wd = (d) => "日一二三四五六"[new Date(d + "T00:00:00").getDay()];

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 10px", flexWrap: "wrap" }}>
        <span style={{ background: C.blue, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>人資</span>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>人資系統</div>
        <span style={{ fontSize: 12, color: C.faint }}>NUEiP 出勤紀錄・每天 22:40 自動同步，異常 D哥直接通知</span>
        <div style={{ flex: 1 }} />
        <input type="month" value={mo} onChange={e => setMo(e.target.value)} style={inp} />
        <select value={pF} onChange={e => setPF(e.target.value)} style={inp}>
          <option value="">全部人員</option>
          {people.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: C.sub, cursor: "pointer" }}>
          <input type="checkbox" checked={onlyBad} onChange={e => setOnlyBad(e.target.checked)} />只看異常
        </label>
        <button onClick={syncNow} disabled={busy} style={{ border: "none", background: C.blue, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? .6 : 1 }}>{busy ? "抓取中…" : "🔄 從 NUEiP 更新"}</button>
      </div>
      {msg && <div style={{ background: msg.startsWith("✓") ? "#eef5ef" : "#fdf0ef", border: `1.5px solid ${msg.startsWith("✓") ? C.green : C.red}`, borderRadius: 8, padding: "7px 12px", marginBottom: 10, fontSize: 12.5, fontWeight: 600, color: msg.startsWith("✓") ? "#2c5a38" : C.red }}>{msg}</div>}
      {/* 本月異常統計 */}
      {badPeople.length > 0 && (
        <div style={{ background: "#fdf6e3", border: `1.5px solid ${C.amber}`, borderRadius: 10, padding: "9px 14px", marginBottom: 10, fontSize: 12.5 }}>
          <b style={{ color: "#8a6410" }}>本月異常統計：</b>
          {badPeople.map(([n, s]) => <span key={n} style={{ marginRight: 14 }}>{n}｜{[s.late ? `遲到${s.late}次(${s.lateMin}分)` : "", s.miss ? `缺卡${s.miss}次` : "", s.absent ? `曠職${s.absent}次` : ""].filter(Boolean).join("、")}</span>)}
        </div>
      )}
      {doc === null ? <div style={{ padding: 40, color: C.sub, fontSize: 14 }}>載入中…</div> : !days.length ? (
        <div style={{ padding: 40, color: C.faint, fontSize: 13, textAlign: "center", background: "#fff", border: `1.5px solid #c8bca6`, borderRadius: 8 }}>這個月還沒有資料——按右上「🔄 從 NUEiP 更新」抓一次</div>
      ) : (
        <div style={{ background: "#fff", border: `1.5px solid #c8bca6`, borderRadius: 8, overflow: "auto", maxHeight: "72vh" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
            <thead><tr>{["日期", "部門", "姓名", "班表", "上班卡", "下班卡", "時數", "狀態"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {days.flatMap(d => {
                const rows = Object.values(doc.days[d])
                  .filter(r => !pF || r.name === pF)
                  .filter(r => !onlyBad || isBad(r))
                  .sort((a, b) => (a.dept + a.name).localeCompare(b.dept + b.name, "zh-TW"));
                return rows.map((r, i) => (
                  <tr key={d + r.name} style={{ background: isBad(r) ? "#fdf9ef" : undefined }}>
                    <td style={{ ...td, fontFamily: MONOF, fontSize: 11.5, color: i === 0 ? C.text : "#d5cbb6", fontWeight: i === 0 ? 700 : 400, borderTop: i === 0 ? "2px solid #c8bca6" : td.borderTop }}>{d.slice(5).replace("-", "/")}（{wd(d)}）</td>
                    <td style={{ ...td, fontSize: 11, color: C.faint, borderTop: i === 0 ? "2px solid #c8bca6" : td.borderTop }}>{r.dept.replace(/^AB|^GD/, m => m + " ").replace("管理部", "管理")}</td>
                    <td style={{ ...td, fontWeight: 600, borderTop: i === 0 ? "2px solid #c8bca6" : td.borderTop }}>{r.name}</td>
                    <td style={{ ...td, fontFamily: MONOF, fontSize: 11.5, color: C.sub, borderTop: i === 0 ? "2px solid #c8bca6" : td.borderTop }}>{r.work || "—"}</td>
                    <td style={{ ...td, fontFamily: MONOF, borderTop: i === 0 ? "2px solid #c8bca6" : td.borderTop, color: r.on.length ? C.text : C.red }}>{r.on.join("/") || "—"}</td>
                    <td style={{ ...td, fontFamily: MONOF, borderTop: i === 0 ? "2px solid #c8bca6" : td.borderTop, color: r.off.length ? C.text : C.red }}>{r.off.join("/") || "—"}</td>
                    <td style={{ ...td, fontFamily: MONOF, fontSize: 11.5, borderTop: i === 0 ? "2px solid #c8bca6" : td.borderTop }}>{durTxt(r.durmin)}</td>
                    <td style={{ ...td, borderTop: i === 0 ? "2px solid #c8bca6" : td.borderTop }}>{badge(r)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>資料來源：NUEiP（每天 22:40 自動抓當天；補歷史選月份按更新）。打卡含 GPS/IP 原始資料在 NUEiP 後台，這裡呈現重點。</div>
    </div>
  );
}
