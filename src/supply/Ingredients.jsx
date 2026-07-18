// 物料清單頁 v2（2026-07-19 張良退回重設計）：預設全自動、人只處理例外
// ⚡自動整理＝每個廠商品項自動建卡（同名自動併卡）、規格自動解析每件入數、服務類自動標非物料
// 名詞白話：歸戶→合併到同一張卡、貨源→哪些廠商賣、packToBase→每件入數
// 資料模型不變（ingredients↔vendorItems 多對一），只重做操作層
import React, { useState } from "react";
import { C, MONOF, rid } from "./Supply.jsx";
import { packToBase, lastPaid, unitCost, srcsOf, priceAlert, parseSpec, isServiceName, normName } from "./inv.js";

const WDZ = ["日", "一", "二", "三", "四", "五", "六"];
const freqText = (f) => {
  if (!f || f.type === "none" || !f.type) return "不盤";
  const base = f.type === "daily" ? "每日" : f.type === "weekly" ? "每週" + (f.days || []).map(d => WDZ[d]).join("") : "每月" + (f.dom || 1) + "日";
  return (f.paused ? "⏸ " : "") + base;
};

export default function IngredientsView({ db, save, canEdit, showMoney, confirm, flash }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);        // 展開詳情的物料 id
  const [sel2, setSel2] = useState({});          // 批次選取 id→true
  const [showSvc, setShowSvc] = useState(false); // 非物料區展開
  const [batCat, setBatCat] = useState("");      // 批次設分類輸入
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const pill = (on, color) => ({ border: `1.5px solid ${on ? color : "#d9cfbd"}`, background: on ? color : "#fff", color: on ? "#fff" : C.sub, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: canEdit ? "pointer" : "default", whiteSpace: "nowrap" });
  const sbtn = { border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "4px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" };

  const all = (db.ingredients || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const vname = (vid) => ((db.vendors || []).find(v => v.id === vid) || {}).name || "—";
  const alertPct = (db.settings && db.settings.priceAlertPct) || 15;
  const updIng = (id, fp) => save({ ingredients: (db.ingredients || []).map(x => x.id === id ? { ...x, ...fp } : x) });
  const d2 = (n) => n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 1000) / 1000).toString();

  // ── ⚡ 自動整理：未掛卡的廠商品項 → 同名併入既有卡、否則自動建卡（規格解析入數/服務類標非物料）──
  const pending = (db.vendorItems || []).filter(vi => !vi.ingredient_id && (vi.name || "").trim());
  const autoOrganize = () => {
    if (!canEdit || !pending.length) return;
    const list = [...(db.ingredients || [])];
    const byNorm = new Map();
    list.forEach(g => { const k = normName(g.name); if (k && !byNorm.has(k)) byNorm.set(k, g); });
    let created = 0, merged = 0, svcN = 0, needFix = 0;
    const nvis = (db.vendorItems || []).map(vi => {
      if (vi.ingredient_id || !(vi.name || "").trim()) return vi;
      const k = normName(vi.name);
      let g = byNorm.get(k);
      if (g) merged++;
      else {
        const p = parseSpec(vi.spec);
        const svc = isServiceName(vi.name);
        const vend = (db.vendors || []).find(v => v.id === vi.vendor_id) || {};
        g = { id: rid("g"), name: vi.name.trim(), cat: (vi.grp || "").trim() || (vend.vcat || "").trim() || "", baseUnit: p.baseUnit, countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: list.length, tags: "", nonStock: svc };
        list.push(g); byNorm.set(k, g); created++; if (svc) svcN++;
      }
      const nv = { ...vi, ingredient_id: g.id };
      if (!Number(nv.packToBase)) { const p2 = parseSpec(vi.spec); if (p2.packToBase) nv.packToBase = p2.packToBase; else if (!g.nonStock) needFix++; }
      return nv;
    });
    save({ ingredients: list, vendorItems: nvis });
    flash(`⚡ 整理完成：自動建 ${created} 張卡${svcN ? `（其中 ${svcN} 筆服務/費用類已收進「非物料」）` : ""}、同名併入 ${merged} 筆${needFix ? `；${needFix} 筆規格看不出入數，點開該卡補「1件=幾個」` : ""}`);
  };

  // ── 建議合併：名稱相似（一方包含另一方，≥3字）且不同卡 → 人工確認才併 ──
  const dismissed = new Set((db.settings && db.settings.mergeDismissed) || []);
  const stock = all.filter(g => !g.nonStock);
  const sugg = [];
  for (let i = 0; i < stock.length; i++) for (let j = i + 1; j < stock.length; j++) {
    const a = normName(stock[i].name), b = normName(stock[j].name);
    if (!a || !b || a === b || a.length < 3 || b.length < 3) continue;
    if (a.includes(b) || b.includes(a)) {
      const key = [stock[i].id, stock[j].id].sort().join("|");
      if (!dismissed.has(key)) sugg.push({ key, a: stock[i], b: stock[j] });
    }
  }
  const doMerge = (target, src) => {
    // 併卡：src 的廠商品項全部改掛 target，src 卡刪除（target 的頻率/設定保留）
    save({
      ingredients: (db.ingredients || []).filter(x => x.id !== src.id),
      vendorItems: (db.vendorItems || []).map(v => v.ingredient_id === src.id ? { ...v, ingredient_id: target.id } : v),
    });
    flash(`✓ 已把「${src.name}」併入「${target.name}」（哪些廠商賣會合在同一張卡比價）`);
  };
  const dismissSugg = (key) => save({ settings: { ...(db.settings || {}), mergeDismissed: [...((db.settings && db.settings.mergeDismissed) || []), key] } });

  // ── 批次設定 ──
  const selIds = Object.keys(sel2).filter(id => sel2[id] && all.some(g => g.id === id));
  const batch = (fp) => { save({ ingredients: (db.ingredients || []).map(x => sel2[x.id] ? { ...x, ...(typeof fp === "function" ? fp(x) : fp) } : x) }); };
  const batchFreq = (type) => { batch({ countFreq: { type, days: type === "weekly" ? [1] : [], dom: 1, paused: false } }); flash(`✓ 已把 ${selIds.length} 項設為「${type === "daily" ? "每日" : type === "weekly" ? "每週（預設週一，可點開細調）" : type === "monthly" ? "每月1日" : "不盤"}」`); };

  const qq = q.trim().toLowerCase();
  const match = (g) => !qq || `${g.name || ""} ${g.cat || ""} ${g.tags || ""}`.toLowerCase().includes(qq);
  const shown = stock.filter(match);
  const svcList = all.filter(g => g.nonStock).filter(match);
  const cats = [...new Set(shown.map(g => (g.cat || "").trim() || "未分類"))];

  // ── 單列（表格感、inline 編輯、點列展開）──
  const row = (g) => {
    const srcs = srcsOf(db, g.id);
    const isOpen = open === g.id;
    const units = srcs.map(vi => unitCost(vi)).filter(u => u != null);
    const minU = units.length ? Math.min(...units) : null;
    const anyAlert = srcs.map(vi => priceAlert(vi, alertPct)).find(Boolean);
    const mainVi = srcs.find(vi => packToBase(vi)) || srcs[0];
    return (
      <React.Fragment key={g.id}>
        <div onClick={() => setOpen(isOpen ? null : g.id)}
          style={{ display: "grid", gridTemplateColumns: `26px 24px minmax(120px,1.4fr) 110px 90px ${showMoney ? "110px " : ""}96px 30px`, gap: 6, alignItems: "center", minHeight: 34, padding: "2px 10px", borderTop: `1px solid #f0ead9`, fontSize: 12.5, cursor: "pointer", background: isOpen ? "#fbeee6" : sel2[g.id] ? "#f2f6fb" : "#fff" }}>
          <input type="checkbox" checked={!!sel2[g.id]} onClick={e => e.stopPropagation()} onChange={e => setSel2(s => ({ ...s, [g.id]: e.target.checked }))} disabled={!canEdit} style={{ cursor: "pointer" }} />
          <button onClick={e => { e.stopPropagation(); canEdit && updIng(g.id, { isKey: !g.isKey }); }} title={g.isKey ? "關鍵品項（點擊取消）" : "標為關鍵品項"} style={{ border: "none", background: "none", color: g.isKey ? "#E8A317" : "#d9cfbd", fontSize: 14, cursor: "pointer", padding: 0 }}>{g.isKey ? "★" : "☆"}</button>
          <span style={{ fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || <span style={{ color: C.faint }}>（未命名）</span>}{anyAlert && <span style={{ fontSize: 10, fontWeight: 700, color: anyAlert.up ? C.red : C.green, marginLeft: 4 }}>{anyAlert.up ? "▲" : "▼"}{Math.abs(anyAlert.pct)}%</span>}</span>
          <span style={{ fontFamily: MONOF, fontSize: 11, color: mainVi && packToBase(mainVi) ? C.sub : C.red }}>{mainVi ? (packToBase(mainVi) ? `1${mainVi.unit || "件"}=${Number(mainVi.packToBase).toLocaleString()}${g.baseUnit}` : "1件=？") : "—"}</span>
          <span style={{ fontSize: 11, color: srcs.length ? C.sub : C.red }}>{srcs.length ? `${srcs.length} 家賣` : "沒人賣"}</span>
          {showMoney && <span style={{ fontFamily: MONOF, fontSize: 11, textAlign: "right", color: minU != null ? C.text : "#d5cbb6" }}>{minU != null ? `$${d2(minU)}/${g.baseUnit}` : "—"}</span>}
          <span onClick={e => e.stopPropagation()} style={{ display: "flex" }}>
            <button onClick={() => canEdit && setOpen(isOpen ? null : g.id)} style={{ ...pill(g.countFreq && g.countFreq.type !== "none" && !g.countFreq.paused, C.blue), padding: "2px 9px", fontSize: 10.5 }}>{freqText(g.countFreq)}</button>
          </span>
          <span style={{ fontSize: 10, color: C.faint, textAlign: "center" }}>{isOpen ? "▾" : "▸"}</span>
        </div>
        {isOpen && (
          <div style={{ padding: "10px 14px 12px 42px", borderTop: `1px solid #f0ead9`, background: "#fdfaf3" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: C.sub }}>名稱 <input value={g.name || ""} onChange={e => updIng(g.id, { name: e.target.value })} disabled={!canEdit} style={{ ...inp, width: 140 }} /></label>
              <label style={{ fontSize: 11, color: C.sub }}>分類 <input value={g.cat || ""} onChange={e => updIng(g.id, { cat: e.target.value })} disabled={!canEdit} list="ingcats" style={{ ...inp, width: 90 }} /></label>
              <label style={{ fontSize: 11, color: C.sub }}>計量單位 <input value={g.baseUnit || ""} onChange={e => updIng(g.id, { baseUnit: e.target.value })} disabled={!canEdit} placeholder="個/g/ml" style={{ ...inp, width: 56 }} /></label>
              <label style={{ fontSize: 11, color: C.sub }}>安全庫存 <input value={g.safeStock ?? ""} onChange={e => updIng(g.id, { safeStock: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" style={{ ...inp, width: 70, fontFamily: MONOF }} /> <span style={{ fontSize: 10, color: C.faint }}>{g.baseUnit}</span></label>
              <label style={{ fontSize: 11.5, color: C.sub, display: "flex", alignItems: "center", gap: 4 }}><input type="checkbox" checked={!!g.nonStock} onChange={e => updIng(g.id, { nonStock: e.target.checked })} disabled={!canEdit} />非物料（服務/費用）</label>
              {canEdit && <button onClick={async () => { if (await confirm(`刪除「${g.name || "未命名"}」？廠商品項會退回未整理（品項本身不會被刪）。`, { confirmLabel: "刪除" })) { save({ ingredients: (db.ingredients || []).filter(x => x.id !== g.id), vendorItems: (db.vendorItems || []).map(v => v.ingredient_id === g.id ? { ...v, ingredient_id: "" } : v) }); setOpen(null); } }} style={{ ...sbtn, color: C.red }}>刪除</button>}
            </div>
            {/* 盤點細設 */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>盤點：</span>
              {[["daily", "每日"], ["weekly", "每週"], ["monthly", "每月"], ["none", "不盤"]].map(([k, lb]) => (
                <button key={k} disabled={!canEdit} onClick={() => canEdit && updIng(g.id, { countFreq: { ...(g.countFreq || {}), type: k } })} style={pill((g.countFreq || {}).type === k || (!g.countFreq && k === "none"), C.blue)}>{lb}</button>
              ))}
              {(g.countFreq || {}).type === "weekly" && WDZ.map((w, d) => {
                const on = ((g.countFreq || {}).days || []).includes(d);
                return <button key={d} disabled={!canEdit} onClick={() => { const days = ((g.countFreq || {}).days || []); updIng(g.id, { countFreq: { ...g.countFreq, days: on ? days.filter(x => x !== d) : [...days, d].sort() } }); }} style={{ ...pill(on, C.accent), padding: "3px 8px" }}>{w}</button>;
              })}
              {(g.countFreq || {}).type === "monthly" && <label style={{ fontSize: 11, color: C.sub }}>每月 <input value={(g.countFreq || {}).dom || 1} onChange={e => updIng(g.id, { countFreq: { ...g.countFreq, dom: Math.min(28, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)) } })} disabled={!canEdit} style={{ ...inp, width: 42, fontFamily: MONOF, textAlign: "center" }} /> 日</label>}
              {(g.countFreq || {}).type && (g.countFreq || {}).type !== "none" && <>
                <label style={{ fontSize: 11.5, color: C.sub, display: "flex", alignItems: "center", gap: 4 }}><input type="checkbox" checked={!!(g.countFreq || {}).paused} onChange={e => updIng(g.id, { countFreq: { ...g.countFreq, paused: e.target.checked } })} disabled={!canEdit} />暫停</label>
                <label style={{ fontSize: 11, color: C.sub }}>誰盤 <input value={g.countRole || ""} onChange={e => updIng(g.id, { countRole: e.target.value })} disabled={!canEdit} placeholder="內場收班…" style={{ ...inp, width: 86 }} /></label>
                <label style={{ fontSize: 11, color: C.sub }}>盤點單位 <input value={g.countUnit || ""} onChange={e => updIng(g.id, { countUnit: e.target.value })} disabled={!canEdit} placeholder={g.baseUnit || ""} style={{ ...inp, width: 66 }} /></label>
              </>}
            </div>
            {/* 哪些廠商賣（比價） */}
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
              <div style={{ display: "grid", gridTemplateColumns: `minmax(80px,0.9fr) minmax(120px,1.3fr) 150px ${showMoney ? "110px 90px" : ""}`, gap: 8, padding: "5px 10px", fontSize: 10, color: C.faint, fontWeight: 700, background: "#f4efe5" }}>
                <span>廠商</span><span>品名/規格</span><span>每件入數</span>{showMoney && <><span style={{ textAlign: "right" }}>最近實付</span><span style={{ textAlign: "right" }}>$/{g.baseUnit || "單位"}</span></>}
              </div>
              {srcs.length === 0 && <div style={{ padding: "8px 10px", fontSize: 11.5, color: C.red }}>沒有廠商賣這個——通常是卡建了但品項還沒整理，按上面「⚡ 自動整理」。</div>}
              {srcs.map(vi => {
                const u = unitCost(vi); const lp = lastPaid(vi); const al = priceAlert(vi, alertPct);
                const best = showMoney && u != null && minU != null && u <= minU + 1e-9 && units.length > 1;
                return (
                  <div key={vi.id} style={{ display: "grid", gridTemplateColumns: `minmax(80px,0.9fr) minmax(120px,1.3fr) 150px ${showMoney ? "110px 90px" : ""}`, gap: 8, alignItems: "center", padding: "4px 10px", borderTop: `1px solid #f0ead9`, fontSize: 12, background: best ? "#eef5ef" : "#fff" }}>
                    <span style={{ fontWeight: 700, color: C.text }}>{vname(vi.vendor_id)}</span>
                    <span style={{ color: C.sub, fontSize: 11.5 }}>{vi.name}{vi.spec ? `（${vi.spec}）` : ""}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                      1{vi.unit || "件"}=
                      <input value={vi.packToBase ?? ""} onChange={e => save({ vendorItems: (db.vendorItems || []).map(v => v.id === vi.id ? { ...v, packToBase: e.target.value.replace(/[^0-9.]/g, "") } : v) })} disabled={!canEdit} inputMode="decimal" placeholder="？" style={{ ...inp, width: 66, padding: "3px 6px", fontFamily: MONOF, borderColor: packToBase(vi) ? C.line : C.red }} />
                      {g.baseUnit}
                    </span>
                    {showMoney && <>
                      <span style={{ fontFamily: MONOF, textAlign: "right", color: lp ? C.text : "#d5cbb6", fontSize: 11.5 }}>{lp ? `$${d2(lp.price)}` : "—"}{lp && lp.src === "主檔" && <span title="還沒有驗收實付紀錄，暫用主檔單價" style={{ color: C.faint, fontSize: 9.5 }}>*</span>}{al && <span style={{ color: al.up ? C.red : C.green, fontWeight: 700, marginLeft: 3 }}>{al.up ? "▲" : "▼"}{Math.abs(al.pct)}%</span>}</span>
                      <span style={{ fontFamily: MONOF, textAlign: "right", fontWeight: 700, color: u != null ? (best ? C.green : C.text) : C.red, fontSize: 11.5 }}>{u != null ? `$${d2(u)}${best ? " ✓低" : ""}` : "缺入數"}</span>
                    </>}
                  </div>
                );
              })}
            </div>
            {/* 手動合併（例外操作） */}
            {canEdit && stock.length > 1 && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: C.faint }}>這張卡跟別張是同一種東西？</span>
                <select defaultValue="" onChange={async e => { const t = stock.find(x => x.id === e.target.value); e.target.value = ""; if (t && await confirm(`把「${g.name}」併入「${t.name}」？賣家會合併到同一張卡。`, { confirmLabel: "合併" })) { doMerge(t, g); setOpen(null); } }} style={{ ...inp, fontSize: 11.5, maxWidth: 200 }}>
                  <option value="">合併到…</option>
                  {stock.filter(x => x.id !== g.id).map(x => <option key={x.id} value={x.id}>{x.name || "（未命名）"}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </React.Fragment>
    );
  };

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>物料</span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>物料清單</div>
          <div style={{ fontSize: 11, color: C.faint }}>廠商品項自動變物料卡，同名自動併卡、入數自動從規格抓。勾多列可批次設盤點。</div>
        </div>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 搜尋物料/分類" style={{ ...inp, width: 160 }} />
        {canEdit && <button onClick={() => { const g = { id: rid("g"), name: "", cat: "", baseUnit: "g", countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: all.length, tags: "" }; save({ ingredients: [...(db.ingredients || []), g] }); setOpen(g.id); }} style={sbtn}>＋ 手動新增</button>}
        {canEdit && <button onClick={autoOrganize} disabled={!pending.length} style={{ border: "none", background: pending.length ? C.accent : "#d5cbb6", color: "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: pending.length ? "pointer" : "default" }}>⚡ 自動整理{pending.length ? `（${pending.length} 筆新品項）` : "（沒有待整理）"}</button>}
      </div>
      <datalist id="ingcats">{[...new Set(all.map(x => (x.cat || "").trim()).filter(Boolean))].map(c2 => <option key={c2} value={c2} />)}</datalist>

      {/* 建議合併（人工確認才併；同名的自動整理時就併好了，這裡只列「相似」的） */}
      {canEdit && sugg.length > 0 && (
        <div style={{ background: "#f2f6fb", border: `1.5px solid ${C.blue}`, borderRadius: 10, marginBottom: 10, padding: "8px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 4 }}>🔗 這幾組名字很像，是同一種東西嗎？（合併後多家廠商在同一張卡比價）</div>
          {sugg.slice(0, 6).map(({ key, a, b }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28, fontSize: 12, borderTop: `1px solid #dde6f2` }}>
              <span style={{ fontWeight: 700 }}>{a.name}</span><span style={{ color: C.faint }}>vs</span><span style={{ fontWeight: 700 }}>{b.name}</span>
              <span style={{ fontSize: 10.5, color: C.faint }}>（{srcsOf(db, a.id).map(v => vname(v.vendor_id)).join("、") || "無賣家"}｜{srcsOf(db, b.id).map(v => vname(v.vendor_id)).join("、") || "無賣家"}）</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => doMerge(a, b)} style={{ ...sbtn, color: C.green, borderColor: C.green }}>是，合併</button>
              <button onClick={() => dismissSugg(key)} style={sbtn}>不是，別再問</button>
            </div>
          ))}
          {sugg.length > 6 && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>還有 {sugg.length - 6} 組，處理完上面會接著出現。</div>}
        </div>
      )}

      {/* 批次工具列：勾了才出現 */}
      {selIds.length > 0 && (
        <div style={{ position: "sticky", top: 0, zIndex: 5, background: "#1d1a15", color: "#fff", borderRadius: 10, marginBottom: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>已勾 {selIds.length} 項：</span>
          <span style={{ fontSize: 11.5, color: "#d9cfbd" }}>盤點</span>
          {[["daily", "每日"], ["weekly", "每週"], ["monthly", "每月"], ["none", "不盤"]].map(([k, lb]) => (
            <button key={k} onClick={() => batchFreq(k)} style={{ border: "1px solid #5a5247", background: "transparent", color: "#fff", borderRadius: 999, padding: "3px 11px", fontSize: 11.5, cursor: "pointer" }}>{lb}</button>
          ))}
          <span style={{ width: 8 }} />
          <input value={batCat} onChange={e => setBatCat(e.target.value)} placeholder="設分類…" list="ingcats" style={{ ...inp, width: 100, padding: "3px 8px" }} />
          <button onClick={() => { if (batCat.trim()) { batch({ cat: batCat.trim() }); flash(`✓ 已把 ${selIds.length} 項分類設為「${batCat.trim()}」`); setBatCat(""); } }} style={{ border: "1px solid #5a5247", background: "transparent", color: "#fff", borderRadius: 7, padding: "3px 11px", fontSize: 11.5, cursor: "pointer" }}>套用</button>
          <button onClick={() => { batch({ nonStock: true }); flash(`✓ 已把 ${selIds.length} 項標為非物料`); setSel2({}); }} style={{ border: "1px solid #5a5247", background: "transparent", color: "#fff", borderRadius: 7, padding: "3px 11px", fontSize: 11.5, cursor: "pointer" }}>標非物料</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setSel2({})} style={{ border: "none", background: "none", color: "#d9cfbd", fontSize: 11.5, cursor: "pointer" }}>取消選取</button>
        </div>
      )}

      {shown.length === 0 && pending.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 12 }}>{qq ? "沒有符合的物料。" : "還沒有物料卡。到「廠商」頁建品項後，回來按「⚡ 自動整理」一鍵生成。"}</div>}
      {shown.length === 0 && pending.length > 0 && !qq && <div style={{ padding: 30, textAlign: "center", color: C.sub, background: "#fbeee6", border: `1.5px solid ${C.accent}`, borderRadius: 10, marginBottom: 12, fontSize: 13 }}>有 <b>{pending.length}</b> 筆廠商品項等著變物料卡——按右上角「<b>⚡ 自動整理</b>」，名稱、分類、每件入數都會自動填好。</div>}

      {cats.map(cat => {
        const rows = shown.filter(g => ((g.cat || "").trim() || "未分類") === cat);
        const allSel = rows.every(g => sel2[g.id]);
        return (
          <div key={cat} style={{ background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#ece4d6" }}>
              <input type="checkbox" checked={allSel} onChange={e => setSel2(s => { const n = { ...s }; rows.forEach(g => { n[g.id] = e.target.checked; }); return n; })} disabled={!canEdit} title="全選這個分類" style={{ cursor: "pointer" }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{cat}</span>
              <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{rows.length} 項</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `26px 24px minmax(120px,1.4fr) 110px 90px ${showMoney ? "110px " : ""}96px 30px`, gap: 6, padding: "3px 10px", fontSize: 9.5, color: C.faint, fontWeight: 700 }}>
              <span /><span /><span>名稱</span><span>每件入數</span><span>哪些廠商賣</span>{showMoney && <span style={{ textAlign: "right" }}>最低價</span>}<span>盤點</span><span />
            </div>
            {rows.map(row)}
          </div>
        );
      })}

      {/* 非物料（服務/費用）收摺區：不參與盤點/成本/比價 */}
      {svcList.length > 0 && (
        <div style={{ background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 12, overflow: "hidden", opacity: 0.85 }}>
          <div onClick={() => setShowSvc(s => !s)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#ece4d6", cursor: "pointer" }}>
            <span style={{ fontSize: 10, color: C.faint }}>{showSvc ? "▾" : "▸"}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>🧾 非物料（服務/費用類）</span>
            <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{svcList.length} 項・不參與盤點/成本/比價</span>
          </div>
          {showSvc && svcList.map(g => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30, padding: "2px 12px", borderTop: `1px solid #f0ead9`, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: C.sub }}>{g.name}</span>
              <span style={{ fontSize: 10.5, color: C.faint }}>{srcsOf(db, g.id).map(v => vname(v.vendor_id)).join("、")}</span>
              <div style={{ flex: 1 }} />
              {canEdit && <button onClick={() => updIng(g.id, { nonStock: false })} style={{ ...sbtn, fontSize: 10.5 }}>其實是物料，移回去</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
