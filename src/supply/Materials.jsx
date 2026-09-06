// 📦 物料庫（張良 2026-09-06 供應鏈重建 P1）：最清楚的一張大表——廠商/品牌/品名/規格/單位/單價/每單位價格
// 全部串起來：點品名→詳情（貨源/價格趨勢/被哪些食譜用到/叫貨紀錄/編輯歷史）；價格追蹤/食譜點名字也開同一個詳情
// 改動都留痕：這頁改 品牌/規格/單位/入數/價格 → 寫 pm_editlog_ 月檔；改價同時 append pm_ph_ 價格歷史（資料一致）
import React, { useMemo, useState } from "react";
import { C, MONOF } from "./Supply.jsx";
import { unitCost, lastPaid, priceAlert } from "./inv.js";
import { TrendChart, buildSeries } from "./PriceTrack.jsx";

const fmtD = (ts) => ts ? String(ts).slice(5, 10).replace("-", "/") : "—";

export default function Materials({ db, save, canEdit, showMoney, flash, phRows, appendPh, logEdit, editRows, flags, saveFlags, recipesAll, setDetail }) {
  const [q, setQ] = useState("");
  const [vF, setVF] = useState("");
  const [needFix, setNeedFix] = useState(false);
  const series = useMemo(() => buildSeries(phRows || []), [phRows]);
  const vname = (vid) => (db.vendors || []).find(v => v.id === vid)?.name || "—";
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const cInp = { border: "none", background: "transparent", width: "100%", fontSize: 12.5, fontFamily: "inherit", color: C.text, outline: "none", padding: 0 };

  const items = (db.vendorItems || []).filter(vi => (vi.name || "").trim());
  const qq = q.trim().toLowerCase();
  const rows = items
    .filter(vi => !vF || vi.vendor_id === vF)
    .filter(vi => !qq || `${vname(vi.vendor_id)} ${vi.brand || ""} ${vi.name} ${vi.spec || ""}`.toLowerCase().includes(qq))
    .filter(vi => !needFix || !(Number(vi.packToBase) > 0))
    .sort((a, b) => vname(a.vendor_id).localeCompare(vname(b.vendor_id), "zh-TW") || (a.name || "").localeCompare(b.name || "", "zh-TW"));
  const nNoConv = items.filter(vi => !(Number(vi.packToBase) > 0)).length;

  const updVi = (id, fp, logKind) => {
    const old = items.find(x => x.id === id);
    save({ vendorItems: (db.vendorItems || []).map(x => x.id === id ? { ...x, ...fp } : x) });
    if (logKind && old) {
      const k = Object.keys(fp)[0];
      logEdit([{ ts: new Date().toISOString(), by: "App", kind: logKind, name: `${vname(old.vendor_id)}／${old.name}`, field: k, from: old[k] ?? "", to: fp[k] ?? "" }]);
    }
  };
  // 手動改價＝一筆正式價格事件：last 快取（留 prevPrice）＋價格歷史 append＋編輯歷史；價差警示照 priceAlert 同一套
  const setPrice = (vi, val) => {
    const p = Number(val);
    const prev = Number(vi.last?.price) || Number(vi.price) || 0;
    if (!(p > 0) || p === prev) return;
    const now = new Date().toISOString();
    updVi(vi.id, { price: p, last: { price: p, ts: now, prevPrice: prev, prevTs: vi.last?.ts || "" } }, "price");
    appendPh({ d: now.slice(0, 10), vendor: vname(vi.vendor_id), item: vi.name, unit: vi.unit || "", p, q: 0, src: "manual" });
    const key = `${vname(vi.vendor_id)}||${vi.name}`;
    if (flags?.[key]?.status === "pending") saveFlags({ ...flags, [key]: { ...flags[key], status: "fixed" } }); // 改完價＝疑慮解除
    flash && flash(`✓ ${vi.name} 價格 $${prev || "—"} → $${p}（已記入價格歷史）`);
  };

  const gname = (gid) => (db.ingredients || []).find(g => g.id === gid)?.name || "";
  // 被哪些食譜用到（反查：物料卡 → 各產品最新版食譜）
  const usedBy = (vi) => {
    if (!vi.ingredient_id || !recipesAll) return [];
    const latestBy = {}; recipesAll.forEach(r => { const b = latestBy[r.product_id]; if (!b || (r.ts || "") > (b.ts || "")) latestBy[r.product_id] = r; });
    return Object.values(latestBy).filter(r => (r.ingredients || []).some(li => li.ingredient_id === vi.ingredient_id))
      .map(r => (db.products || []).find(p => p.id === r.product_id)).filter(Boolean);
  };

  const th = { padding: "7px 8px", fontSize: 10.5, letterSpacing: .6, color: C.sub, fontWeight: 700, whiteSpace: "nowrap", textAlign: "left", background: "#ece4d6", borderBottom: `1.5px solid ${C.hard}`, position: "sticky", top: 0 };
  const td = { padding: "5px 8px", fontSize: 12.5, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", verticalAlign: "middle" };

  if (!showMoney) return <div style={{ padding: 40, color: C.sub, fontSize: 14 }}>此頁全是進價金額，需要「看金額」權限。</div>;
  return (
    <div style={{ maxWidth: 1060, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 10px", flexWrap: "wrap" }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>物料</span>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>物料庫</div>
        <span style={{ fontSize: 12, color: C.faint }}>{items.length} 個品項・AB / GD 共用一份</span>
        <div style={{ flex: 1 }} />
        {nNoConv > 0 && <button onClick={() => setNeedFix(v => !v)} style={{ border: `1.5px solid ${needFix ? C.amber : C.line}`, background: needFix ? "#fdf6e3" : "#fff", color: needFix ? "#8a6410" : C.sub, borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>⚠ 缺入數換算 {nNoConv}</button>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋廠商/品牌/品名/規格…" style={{ ...inp, width: 230 }} />
        <select value={vF} onChange={e => setVF(e.target.value)} style={inp}>
          <option value="">全部廠商</option>
          {(db.vendors || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-TW")).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div style={{ background: "#fff", border: `1.5px solid ${C.hard}`, borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860 }}>
          <thead><tr>
            {["廠商", "品牌", "品名", "規格", "單位", "單價（最新）", "每單位價格", "漲跌", "最新日"].map(h => <th key={h} style={{ ...th, textAlign: /價|漲|日/.test(h) ? "right" : "left" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(vi => {
              const lp = lastPaid(vi); const u = unitCost(vi);
              const g = (db.ingredients || []).find(x => x.id === vi.ingredient_id);
              const al = priceAlert(vi, (db.settings || {}).priceAlertPct);
              const key = `${vname(vi.vendor_id)}||${vi.name}`;
              const warn = flags?.[key]?.status === "pending";
              const s = series.get(key);
              return (
                <tr key={vi.id} style={{ background: warn ? "#fdf6e3" : undefined }}>
                  <td style={{ ...td, color: C.sub, fontSize: 11.5 }}>{vname(vi.vendor_id)}</td>
                  <td style={{ ...td, width: 90 }}><input value={vi.brand ?? ""} onChange={e => updVi(vi.id, { brand: e.target.value })} onBlur={e => e.target.value !== (vi.brand ?? "") && null} disabled={!canEdit} placeholder="—" style={{ ...cInp, fontSize: 11.5, color: C.sub }} /></td>
                  <td style={td}>
                    {warn && "⚠️ "}
                    <button onClick={() => setDetail(vi.id)} style={{ border: "none", background: "none", color: C.blue, fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 12.5, textDecoration: "underline", textAlign: "left" }}>{vi.name}</button>
                  </td>
                  <td style={{ ...td, width: 110 }}><input value={vi.spec ?? ""} onChange={e => updVi(vi.id, { spec: e.target.value })} disabled={!canEdit} placeholder="—" style={{ ...cInp, fontSize: 11.5, color: C.sub }} /></td>
                  <td style={{ ...td, width: 46 }}><input value={vi.unit ?? ""} onChange={e => updVi(vi.id, { unit: e.target.value })} disabled={!canEdit} placeholder="—" style={{ ...cInp, fontSize: 11.5, color: C.sub, textAlign: "center" }} /></td>
                  <td style={{ ...td, textAlign: "right", fontFamily: MONOF, fontWeight: 700, width: 92 }}>
                    <input key={vi.id + (lp ? lp.price : "")} defaultValue={lp ? lp.price : ""} onBlur={e => setPrice(vi, e.target.value.replace(/[^0-9.]/g, ""))} disabled={!canEdit} inputMode="decimal" placeholder="—" title={lp && lp.src === "主檔" ? "主檔價（還沒有實付紀錄）" : "最近實付價；改了會記入價格歷史＋編輯紀錄"} style={{ ...cInp, fontFamily: MONOF, textAlign: "right", fontWeight: 700 }} />
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: MONOF, color: u != null ? C.accent : C.red, fontSize: 11.5 }}>{u != null ? `$${u < 1 ? (Math.round(u * 10000) / 10000) : Math.round(u * 100) / 100}/${g?.baseUnit || "u"}` : "缺換算"}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: MONOF, fontWeight: 800, fontSize: 11.5, color: al ? (al.up ? C.red : C.green) : C.faint }}>{al ? `${al.up ? "+" : ""}${al.pct}%` : "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: MONOF, fontSize: 11, color: C.faint }}>{fmtD(vi.last?.ts || (s && s.pts[s.pts.length - 1].d))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div style={{ padding: 24, fontSize: 12.5, color: C.faint, textAlign: "center" }}>沒有符合的品項</div>}
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>品牌/規格/單位直接點格子改；單價改了＝記一筆正式價格事件（進價格歷史＋編輯紀錄，全部留痕）。點品名看詳情：價格趨勢／被哪些食譜用到／叫貨與編輯紀錄。</div>

    </div>
  );
}

// ── 物料詳情 modal（全站共用：物料庫點品名、價格追蹤點品項、之後食譜點用料都開這裡）──
export function MatDetail({ db, save, canEdit, flash, phRows, logEdit, editRows, viId, onClose, recipesAll }) {
  const series = useMemo(() => buildSeries(phRows || []), [phRows]);
  const vname = (vid) => (db.vendors || []).find(v => v.id === vid)?.name || "—";
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const selVi = (db.vendorItems || []).find(x => x.id === viId);
  if (!selVi) return null;
  const updVi = (id, fp, logKind) => {
    const old = selVi;
    save({ vendorItems: (db.vendorItems || []).map(x => x.id === id ? { ...x, ...fp } : x) });
    if (logKind && old) {
      const k = Object.keys(fp)[0];
      logEdit([{ ts: new Date().toISOString(), by: "App", kind: logKind, name: `${vname(old.vendor_id)}／${old.name}`, field: k, from: old[k] ?? "", to: fp[k] ?? "" }]);
    }
  };
  const usedBy = (vi) => {
    if (!vi.ingredient_id || !recipesAll) return [];
    const latestBy = {}; recipesAll.forEach(r => { const b = latestBy[r.product_id]; if (!b || (r.ts || "") > (b.ts || "")) latestBy[r.product_id] = r; });
    return Object.values(latestBy).filter(r => (r.ingredients || []).some(li => li.ingredient_id === vi.ingredient_id))
      .map(r => (db.products || []).find(p => p.id === r.product_id)).filter(Boolean);
  };
  const setDetail = (v) => { if (v == null) onClose(); };

        const key = `${vname(selVi.vendor_id)}||${selVi.name}`;
        const s = series.get(key);
        const g = (db.ingredients || []).find(x => x.id === selVi.ingredient_id);
        const used = usedBy(selVi);
        const edits = (editRows || []).filter(r => r.name === `${vname(selVi.vendor_id)}／${selVi.name}`).sort((a, b) => (b.ts || "").localeCompare(a.ts || "")).slice(0, 15);
        const lp = lastPaid(selVi); const u = unitCost(selVi);
        return (
          <div onClick={e => e.target === e.currentTarget && setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, width: "min(720px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{selVi.name}</div>
                <span style={{ fontSize: 11.5, color: C.sub }}>{vname(selVi.vendor_id)}{selVi.brand ? `・${selVi.brand}` : ""}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8, marginBottom: 12 }}>
                {[["規格", selVi.spec || "—"], ["單位", selVi.unit || "—"], ["最新價", lp ? `$${lp.price}（${lp.src}）` : "—"], ["每單位", u != null ? `$${u < 1 ? Math.round(u * 10000) / 10000 : Math.round(u * 100) / 100}/${g?.baseUnit || "u"}` : "缺換算"], ["入數換算", Number(selVi.packToBase) > 0 ? `1${selVi.unit || "件"}=${selVi.packToBase}${g?.baseUnit || ""}` : "未設"], ["最低訂購", selVi.moq || "—"]].map(([l, v]) => (
                  <div key={l} style={{ background: C.soft, borderRadius: 8, padding: "7px 10px" }}>
                    <div style={{ fontSize: 10, color: C.faint, fontWeight: 700 }}>{l}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: MONOF, color: /缺|未設/.test(String(v)) ? C.red : C.text }}>{v}</div>
                  </div>
                ))}
              </div>
              {canEdit && !(Number(selVi.packToBase) > 0) && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, background: "#fdf6e3", border: `1px solid ${C.amber}`, borderRadius: 8, padding: "7px 10px", fontSize: 12 }}>
                  ⚠ 缺入數換算（1{selVi.unit || "件"} = ? {g?.baseUnit || "g"}）→
                  <input placeholder="例：600" inputMode="numeric" onBlur={e => { const n = Number(e.target.value); if (n > 0) { updVi(selVi.id, { packToBase: n }, "vendorItem"); flash && flash("✓ 已補入數換算"); } }} style={{ ...inp, width: 90, padding: "4px 8px" }} />
                  <span style={{ color: C.faint }}>填了才能算每單位成本</span>
                </div>
              )}
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, margin: "6px 0 4px" }}>📈 價格趨勢</div>
              {s ? <TrendChart seriesList={[{ name: selVi.name, color: "#2a78d6", pts: s.pts }]} height={180} /> : <div style={{ fontSize: 12, color: C.faint, padding: "4px 0 10px" }}>還沒有價格歷史（驗收或匯入後自動累積）</div>}
              <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, margin: "10px 0 4px" }}>🍽 被哪些食譜用到（{used.length}）</div>
              {used.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{used.map(p => <span key={p.id} style={{ fontSize: 11.5, background: p.semi ? "#eaf2fa" : "#eef5ef", color: p.semi ? C.blue : C.green, borderRadius: 5, padding: "2px 9px", fontWeight: 600 }}>{p.semi ? "🧪" : "🍽"} {p.name}</span>)}</div> : <div style={{ fontSize: 12, color: C.faint }}>目前沒有食譜用到這個物料</div>}
              {edits.length > 0 && (<>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, margin: "10px 0 4px" }}>📝 編輯歷史（近 {edits.length} 筆）</div>
                {edits.map((r, i) => <div key={i} style={{ fontSize: 11.5, color: C.sub, padding: "2px 0", borderTop: "1px solid #f0ead9" }}><span style={{ fontFamily: MONOF, color: C.faint }}>{String(r.ts).slice(5, 16).replace("T", " ")}</span>・{r.by}・{r.field || r.kind}：{String(r.from ?? "—")} → <b>{String(r.to ?? "—")}</b></div>)}
              </>)}
            </div>
          </div>
        );
      }
