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
  const [hrTab, setHrTab] = useState("att"); // 第三層：att=出勤紀錄 / pay=薪資（NUEiP 二次密碼解鎖後接資料）

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
  // 本月統計（每人：出勤/時數/準時/遲到/缺卡/曠職/平均上班卡——摘要卡與排名共用）
  const t2m0 = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const m2t0 = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
  const stats = {};
  days.forEach(d => Object.values(doc.days[d]).forEach(r => {
    const s = stats[r.name] = stats[r.name] || { late: 0, lateMin: 0, miss: 0, absent: 0, days: 0, worked: 0, ok: 0, min: 0, onSum: 0, onN: 0, dept: r.dept };
    s.days++; s.min += r.durmin || 0;
    if (r.on.length || r.off.length) { s.worked++; if (!isBad(r)) s.ok++; }
    if (r.on.length) { s.onSum += t2m0(r.on[0]); s.onN++; }
    if (r.late) { s.late++; s.lateMin += r.late; } if (r.miss) s.miss++; if (r.absent) s.absent++;
  }));
  const badPeople = Object.entries(stats).filter(([, s]) => s.late || s.miss || s.absent).sort((a, b) => (b[1].late + b[1].miss + b[1].absent) - (a[1].late + a[1].miss + a[1].absent));

  const inp = { border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", color: C.text, outline: "none" };
  const th = { padding: "7px 9px", fontSize: 10.5, letterSpacing: .6, color: C.sub, fontWeight: 700, whiteSpace: "nowrap", textAlign: "left", background: "#ece4d6", borderBottom: `1.5px solid #c8bca6`, position: "sticky", top: 0 };
  const td = { padding: "6px 9px", fontSize: 12.5, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", verticalAlign: "middle" };
  const badge = (r) => {
    const fx = [];
    // NUEiP 判曠職但有打卡＝補卡/修改還沒核准（2026-09-30 張良問「有打卡為何曠職」查明）——標出來提醒去 NUEiP 簽核
    if (r.absent) fx.push([(r.on.length || r.off.length) ? "曠職·補卡待核?" : "曠職", C.red, (r.on.length || r.off.length) ? "NUEiP 判曠職但有打卡紀錄＝補卡/修改尚未核准。到 NUEiP 簽核通過後，回來按「從 NUEiP 更新」就會變正常" : ""]);
    if (r.miss) fx.push(["缺卡", C.amber]);
    if (r.late) fx.push([`遲到${r.late}分`, C.red]);
    if (r.early) fx.push([`早退${r.early}分`, C.amber]);
    if (!fx.length) return <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>OK</span>;
    return fx.map(([t, c, tip], i) => <span key={i} title={tip || ""} style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: c, borderRadius: 4, padding: "1px 7px", marginRight: 4, cursor: tip ? "help" : "default" }}>{t}</span>);
  };
  const durTxt = (m) => m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "—";
  const wd = (d) => "日一二三四五六"[new Date(d + "T00:00:00").getDay()];

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 10px", flexWrap: "wrap" }}>
        <span style={{ background: C.blue, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>人資</span>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>人資系統</div>
        {/* 第三層子分頁（張良 2026-09-30）：之後薪資/請假/加班都掛這排 */}
        <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
          {[["att", "⏱ 出勤紀錄"], ["pay", "💰 薪資"]].map(([v, l]) => (
            <button key={v} onClick={() => setHrTab(v)} style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${hrTab === v ? C.line : "transparent"}`, background: hrTab === v ? "#fff" : "transparent", color: hrTab === v ? C.text : C.sub, fontSize: 12, fontWeight: hrTab === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
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
      {hrTab === "pay" && (
        <div style={{ background: "#fff", border: `1.5px solid #c8bca6`, borderRadius: 10, padding: "26px 20px", textAlign: "center", fontSize: 13, color: C.sub }}>
          💰 薪資分頁建置中——NUEiP 的工資發放明細有<b>二次密碼</b>鎖，等老闆提供解鎖後就接資料進來（薪資屬機密，這頁只開給有權限的帳號）。
        </div>
      )}
      {hrTab === "att" && <>
      {/* 個人摘要（選了人才出現）：本月統計 KPI＋白話總結（張良 2026-09-30） */}
      {/* 個人摘要（選了人才出現）：本月統計 KPI＋白話總結（張良 2026-09-30） */}
      {pF && doc && (() => {
        const recs = days.flatMap(d => Object.values(doc.days[d]).filter(r => r.name === pF).map(r => ({ ...r, d })));
        if (!recs.length) return <div style={{ background: "#fff", border: `1.5px solid #c8bca6`, borderRadius: 10, padding: "12px 16px", marginBottom: 10, fontSize: 12.5, color: C.faint }}>{pF} 這個月沒有出勤資料</div>;
        const worked = recs.filter(r => r.on.length || r.off.length);
        const totMin = recs.reduce((t, r) => t + (r.durmin || 0), 0);
        const lateN = recs.filter(r => r.late).length, lateMin = recs.reduce((t, r) => t + (r.late || 0), 0);
        const earlyN = recs.filter(r => r.early).length, missN = recs.filter(r => r.miss).length, abN = recs.filter(r => r.absent).length;
        const okN = worked.filter(r => !isBad(r)).length;
        const okPct = worked.length ? Math.round(okN / worked.length * 100) : 0;
        // 平均上/下班卡（分鐘平均再轉回時刻）
        const t2m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        const m2t = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
        const ons = worked.flatMap(r => r.on.slice(0, 1)).map(t2m);
        const offs = worked.flatMap(r => r.off.slice(-1)).map(t2m);
        const avgOn = ons.length ? m2t(ons.reduce((a, b) => a + b, 0) / ons.length) : "—";
        const avgOff = offs.length ? m2t(offs.reduce((a, b) => a + b, 0) / offs.length) : "—";
        const last = recs[0];
        const kpi = [["出勤天數", `${worked.length} 天`, C.text], ["總時數", `${Math.floor(totMin / 60)}h${String(totMin % 60).padStart(2, "0")}`, C.text], ["平均上班卡", avgOn, C.text], ["平均下班卡", avgOff, C.text],
          ["準時率", okPct + "%", okPct >= 90 ? C.green : okPct >= 70 ? C.amber : C.red],
          ["遲到", lateN ? `${lateN} 次 / ${lateMin} 分` : "0", lateN ? C.red : C.green],
          ["早退", earlyN || "0", earlyN ? C.amber : C.green], ["缺卡", missN || "0", missN ? C.amber : C.green], ["曠職", abN || "0", abN ? C.red : C.green]];
        const summary = `${pF}（${last.dept}${last.title ? "・" + last.title : ""}）本月出勤 ${worked.length} 天、共 ${Math.floor(totMin / 60)} 小時，平均 ${avgOn} 上班卡、${avgOff} 下班卡` +
          (lateN || earlyN || missN || abN ? `；${[lateN ? `遲到 ${lateN} 次共 ${lateMin} 分` : "", earlyN ? `早退 ${earlyN} 次` : "", missN ? `缺卡 ${missN} 次` : "", abN ? `曠職 ${abN} 次` : ""].filter(Boolean).join("、")}，準時率 ${okPct}%。` : `，全勤零異常 👍`);
        return (
          <div style={{ background: "#fff", border: `1.5px solid #c8bca6`, borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>👤 {pF}</span>
              <span style={{ fontSize: 11.5, color: C.faint }}>{last.dept}{last.title ? "・" + last.title : ""}｜{mo} 個人摘要</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setPF("")} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "3px 12px", fontSize: 11.5, cursor: "pointer" }}>← 回全部</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(96px,1fr))", gap: 8, marginBottom: 8 }}>
              {kpi.map(([l, v, c2]) => (
                <div key={l} style={{ background: C.soft, borderRadius: 8, padding: "7px 10px" }}>
                  <div style={{ fontSize: 10, color: C.faint, fontWeight: 700 }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, fontFamily: MONOF, color: c2 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.7, background: "#faf6ec", borderRadius: 8, padding: "8px 12px" }}>📋 {summary}</div>
          </div>
        );
      })()}
      {/* 🏆 各類排名（總覽模式；點名字→個人摘要）（張良 2026-09-30） */}
      {!pF && days.length > 0 && (() => {
        const es = Object.entries(stats).filter(([, s]) => s.worked > 0);
        const medal = ["🥇", "🥈", "🥉", "4.", "5."];
        const nameBtn = (n) => <button onClick={() => setPF(n)} style={{ border: "none", background: "none", color: C.blue, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 12, textDecoration: "underline" }}>{n}</button>;
        const board = (title, rows, fmt) => (
          <div key={title} style={{ background: "#fff", border: `1.5px solid #c8bca6`, borderRadius: 10, padding: "10px 14px", minWidth: 180, flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>{title}</div>
            {rows.slice(0, 5).map(([n, s], i) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", fontSize: 12 }}>
                <span style={{ width: 22, flexShrink: 0 }}>{medal[i]}</span>{nameBtn(n)}
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: MONOF, fontSize: 11.5, color: C.sub }}>{fmt(s)}</span>
              </div>
            ))}
            {!rows.length && <div style={{ fontSize: 11.5, color: C.faint }}>—</div>}
          </div>
        );
        return (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            {board("⏱ 時數王（總工時）", [...es].sort((a, b) => b[1].min - a[1].min), s => `${Math.floor(s.min / 60)}h`)}
            {board("✅ 準時率（出勤≥5天）", es.filter(([, s]) => s.worked >= 5).sort((a, b) => (b[1].ok / b[1].worked) - (a[1].ok / a[1].worked) || b[1].worked - a[1].worked), s => `${Math.round(s.ok / s.worked * 100)}%・${s.worked}天`)}
            {board("🐓 早鳥（平均上班卡）", es.filter(([, s]) => s.onN >= 3).sort((a, b) => (a[1].onSum / a[1].onN) - (b[1].onSum / b[1].onN)), s => m2t0(s.onSum / s.onN))}
            {board("😴 遲到榜", es.filter(([, s]) => s.late).sort((a, b) => b[1].lateMin - a[1].lateMin), s => `${s.late}次/${s.lateMin}分`)}
            {board("❓ 缺卡榜", es.filter(([, s]) => s.miss).sort((a, b) => b[1].miss - a[1].miss), s => `${s.miss}次`)}
          </div>
        );
      })()}
      {/* 本月異常統計 */}
      {!pF && badPeople.length > 0 && (
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
      </>}
      <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>資料來源：NUEiP（營業時間每 20 分自動掃＝遲到即時通知；22:40 收班總結；補歷史選月份按更新）。打卡含 GPS/IP 原始資料在 NUEiP 後台，這裡呈現重點。</div>
    </div>
  );
}
