// 📈 價格追蹤（張良 2026-09-06 供應鏈重建 P1）：把他自製的「叫貨價格浮動追蹤.html」原樣搬進 App 變活資料
// 版面照他的：KPI 五卡 → 價格波動排行榜（搜尋/只看變動）→ 廠商價格趨勢圖；資料＝pm_ph_ 月檔（歷史＋之後驗收/匯入自動 append）
// 加上他要的：價差過大（疑似資料有誤）黃底 highlight＋確認鈕；名字可點 → 物料庫詳情（全部串起來）
import React, { useMemo, useState } from "react";
import { C, MONOF } from "./Supply.jsx";

const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const fmt$ = (n) => "NT$" + Math.round(n).toLocaleString();
const mdz = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

// 折線趨勢圖（手刻 SVG，照他 HTML 的樣式；物料庫詳情的小圖也共用這個）
export function TrendChart({ seriesList, height = 260 }) {
  // seriesList: [{name, color, pts:[{d,p}]}]（pts 已按日期排序）
  const all = seriesList.flatMap(s => s.pts);
  if (!all.length) return <div style={{ padding: 20, fontSize: 12, color: C.faint }}>沒有價格紀錄</div>;
  const W = 820, H = height, PAD = { l: 46, r: 14, t: 12, b: 26 };
  const days = [...new Set(all.map(p => p.d))].sort();
  const x = (d) => PAD.l + (days.length < 2 ? 0.5 : days.indexOf(d) / (days.length - 1)) * (W - PAD.l - PAD.r);
  let lo = Math.min(...all.map(p => p.p)), hi = Math.max(...all.map(p => p.p));
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const yTicks = [...Array(5)].map((_, i) => lo + (hi - lo) * i / 4);
  const xTickIdx = days.length <= 6 ? days.map((_, i) => i) : [...Array(6)].map((_, i) => Math.round(i * (days.length - 1) / 5));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#e1e0d9" strokeWidth={1} />
          <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10.5} fill={C.faint} fontFamily={MONOF}>{Math.round(v)}</text>
        </g>
      ))}
      {xTickIdx.map(i => <text key={i} x={x(days[i])} y={H - 8} textAnchor="middle" fontSize={10.5} fill={C.faint} fontFamily={MONOF}>{mdz(days[i])}</text>)}
      {seriesList.map((s, si) => {
        const pts = s.pts;
        const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
        return (
          <g key={si}>
            <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            {pts.map((p, i) => <circle key={i} cx={x(p.d)} cy={y(p.p)} r={2.4} fill={s.color}><title>{`${s.name} ${p.d}：${fmt$(p.p)}`}</title></circle>)}
          </g>
        );
      })}
    </svg>
  );
}

// 把 pm_ph_ 全部列組成序列：key=vendor||item → {vendor,item,unit,pts:[{d,p,q}]}
export const buildSeries = (rows) => {
  const m = new Map();
  rows.forEach(r => {
    const k = `${r.vendor}||${r.item}`;
    if (!m.has(k)) m.set(k, { vendor: r.vendor, item: r.item, unit: r.unit || "", pts: [] });
    const s = m.get(k);
    if (r.unit) s.unit = r.unit;
    s.pts.push({ d: r.d, p: Number(r.p), q: Number(r.q) || 0 });
  });
  m.forEach(s => s.pts.sort((a, b) => (a.d < b.d ? -1 : 1)));
  return m;
};

export default function PriceTrack({ phRows, flags, saveFlags, canEdit, showMoney, openMaterial }) {
  const [q, setQ] = useState("");
  const [onlyChg, setOnlyChg] = useState(false);
  const [selVendor, setSelVendor] = useState("");
  const [onItems, setOnItems] = useState(null); // null=前8條全開；Set=手動勾
  const series = useMemo(() => buildSeries(phRows || []), [phRows]);

  // KPI（口徑照他的 HTML：期間金額＝Σ單價×數量）
  const vendors = [...new Set([...series.values()].map(s => s.vendor))];
  const totalRows = (phRows || []).length;
  const totalAmt = (phRows || []).reduce((t, r) => t + (Number(r.p) || 0) * (Number(r.q) || 0), 0);
  const movers = [...series.values()].map(s => {
    const f = s.pts[0], l = s.pts[s.pts.length - 1];
    const chg = f.p > 0 ? (l.p - f.p) / f.p * 100 : 0;
    return { ...s, first: f, last: l, chg, min: Math.min(...s.pts.map(p => p.p)), max: Math.max(...s.pts.map(p => p.p)) };
  });
  const nBig = movers.filter(m => Math.abs(m.chg) > 10).length;

  // 排行榜
  const qq = q.trim().toLowerCase();
  const board = movers
    .filter(m => !qq || `${m.vendor} ${m.item}`.toLowerCase().includes(qq))
    .filter(m => !onlyChg || Math.round(m.chg) !== 0)
    .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
  const flagOf = (m) => (flags || {})[`${m.vendor}||${m.item}`];
  const pendings = movers.filter(m => flagOf(m)?.status === "pending");

  // 趨勢圖：廠商 → 品項
  const vendStats = vendors.map(v => {
    const ss = [...series.values()].filter(s => s.vendor === v);
    return { v, n: ss.reduce((t, s) => t + s.pts.length, 0), amt: ss.reduce((t, s) => t + s.pts.reduce((tt, p) => tt + p.p * p.q, 0), 0), items: ss };
  }).sort((a, b) => b.n - a.n);
  const curV = vendStats.find(x => x.v === selVendor) || vendStats[0];
  const chartItems = curV ? curV.items.slice().sort((a, b) => b.pts.length - a.pts.length) : [];
  const activeSet = onItems || new Set(chartItems.slice(0, 8).map(s => s.item));
  const chartSeries = chartItems.filter(s => activeSet.has(s.item)).slice(0, 8).map((s, i) => ({ name: s.item, color: PALETTE[i % 8], pts: s.pts }));

  const card = { background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, padding: "12px 16px" };
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, background: "#fff", color: C.text, outline: "none" };
  const th = { padding: "6px 8px", fontSize: 10.5, letterSpacing: .6, color: C.sub, fontWeight: 700, whiteSpace: "nowrap", textAlign: "right" };
  const td = { padding: "5px 8px", fontFamily: MONOF, fontSize: 12, textAlign: "right", whiteSpace: "nowrap", borderTop: "1px solid #f0ead9" };

  if (!showMoney) return <div style={{ padding: 40, color: C.sub, fontSize: 14 }}>此頁全是進價金額，需要「看金額」權限。</div>;
  return (
    <div style={{ maxWidth: 1060, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>追蹤</span>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>叫貨價格浮動追蹤</div>
      </div>
      {totalRows > 0 && <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10 }}>資料範圍 {mdz((phRows.map(r => r.d).sort()[0]))} ~ {mdz(phRows.map(r => r.d).sort().slice(-1)[0])}・驗收/匯入的新價會自動累積進來</div>}
      {/* KPI 五卡（照他 HTML） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginBottom: 14 }}>
        {[[vendors.length, "廠商數"], [series.size, "追蹤品項數"], [totalRows.toLocaleString(), "叫貨明細筆數"], [fmt$(totalAmt), "期間總叫貨金額"], [nBig, "漲跌超過 10% 品項"]].map(([v, l]) => (
          <div key={l} style={card}>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: MONOF, color: C.text }}>{v}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>
      {/* 疑似資料有誤（價差過大自動標黃；確認沒錯→解除，有錯→點名字去物料庫改） */}
      {pendings.length > 0 && (
        <div style={{ background: "#fdf6e3", border: `1.5px solid ${C.amber}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#8a6410", marginBottom: 6 }}>⚠️ {pendings.length} 項價差過大，疑似資料有誤——請確認</div>
          {pendings.map(m => { const f = flagOf(m); return (
            <div key={m.vendor + m.item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "3px 0", flexWrap: "wrap" }}>
              <button onClick={() => openMaterial && openMaterial(m.vendor, m.item)} style={{ border: "none", background: "none", color: C.blue, fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: 12.5 }}>{m.item}</button>
              <span style={{ color: C.sub }}>{m.vendor}</span>
              <span style={{ fontFamily: MONOF }}>${f.from || "—"} → ${f.to}（{f.pct > 0 ? "+" : ""}{f.pct}%）</span>
              {canEdit && <button onClick={() => saveFlags({ ...flags, [`${m.vendor}||${m.item}`]: { ...f, status: "ok" } })} style={{ border: `1px solid ${C.green}`, background: "#fff", color: C.green, borderRadius: 6, padding: "2px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>✓ 資料沒錯</button>}
              {canEdit && <button onClick={() => openMaterial && openMaterial(m.vendor, m.item)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 6, padding: "2px 10px", fontSize: 11.5, cursor: "pointer" }}>改資料</button>}
            </div>
          ); })}
        </div>
      )}
      {/* 價格波動排行榜 */}
      <div style={{ background: "#fff", border: `1.5px solid ${C.hard}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>價格波動排行榜</div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋廠商/品項…" style={{ ...inp, width: 180 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: C.sub, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyChg} onChange={e => setOnlyChg(e.target.checked)} />只顯示有價格變動
          </label>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: C.faint }}>點列看趨勢圖・點品名開物料詳情</span>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 680 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>廠商</th><th style={{ ...th, textAlign: "left" }}>品項</th>
              <th style={th}>起始價</th><th style={th}>起始日</th><th style={th}>最新價</th><th style={th}>最新日</th><th style={th}>漲跌</th><th style={th}>筆數</th>
            </tr></thead>
            <tbody>
              {board.slice(0, 400).map(m => {
                const f = flagOf(m);
                const warn = f?.status === "pending";
                return (
                  <tr key={m.vendor + "|" + m.item} onClick={() => { setSelVendor(m.vendor); setOnItems(new Set([m.item])); }} style={{ cursor: "pointer", background: warn ? "#fdf6e3" : undefined }}>
                    <td style={{ ...td, textAlign: "left", fontFamily: "inherit", color: C.sub }}>{m.vendor}</td>
                    <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>
                      {warn && "⚠️ "}
                      <button onClick={e => { e.stopPropagation(); openMaterial && openMaterial(m.vendor, m.item); }} style={{ border: "none", background: "none", color: C.blue, fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 12.5, textDecoration: "underline" }}>{m.item}</button>
                      {m.unit && <span style={{ color: C.faint, fontSize: 11 }}> /{m.unit}</span>}
                    </td>
                    <td style={td}>{fmt$(m.first.p)}</td><td style={td}>{mdz(m.first.d)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmt$(m.last.p)}</td><td style={td}>{mdz(m.last.d)}</td>
                    <td style={{ ...td, fontWeight: 800, color: Math.round(m.chg) > 0 ? C.red : Math.round(m.chg) < 0 ? C.green : C.faint }}>{Math.round(m.chg) > 0 ? "+" : ""}{Math.round(m.chg)}%</td>
                    <td style={td}>{m.pts.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!board.length && <div style={{ padding: 20, fontSize: 12.5, color: C.faint, textAlign: "center" }}>沒有符合的品項</div>}
        </div>
      </div>
      {/* 廠商價格趨勢圖 */}
      <div style={{ background: "#fff", border: `1.5px solid ${C.hard}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>廠商價格趨勢圖</div>
          <select value={curV ? curV.v : ""} onChange={e => { setSelVendor(e.target.value); setOnItems(null); }} style={inp}>
            {vendStats.map(x => <option key={x.v} value={x.v}>{x.v}（{x.n} 筆）</option>)}
          </select>
          {curV && <span style={{ fontSize: 12, color: C.sub }}>共 {curV.items.length} 個品項・期間叫貨金額 {fmt$(curV.amt)}</span>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {chartItems.slice(0, 24).map((s, i) => {
            const on = activeSet.has(s.item);
            return (
              <button key={s.item} onClick={() => { const n = new Set(activeSet); on ? n.delete(s.item) : n.add(s.item); setOnItems(n); }}
                style={{ border: `1.5px solid ${on ? PALETTE[i % 8] : C.line}`, background: on ? "#fff" : C.soft, color: on ? C.text : C.faint, borderRadius: 13, padding: "2px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? PALETTE[i % 8] : C.line }} />{s.item}
              </button>
            );
          })}
        </div>
        <TrendChart seriesList={chartSeries} />
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
          {chartSeries.map(s => <span key={s.name} style={{ fontSize: 11.5, color: C.sub, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, background: s.color, borderRadius: 2 }} />{s.name} <b style={{ fontFamily: MONOF }}>{fmt$(s.pts[s.pts.length - 1].p)}</b></span>)}
        </div>
      </div>
    </div>
  );
}
