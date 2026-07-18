// 物料清單頁（進銷存中控台）：物料主檔＋盤點頻率設定＋貨源歸戶＋比價視圖
// 藍圖：物料=「物」（高麗菜），vendorItems=貨源（A/B/C菜商的高麗菜）多對一；食譜/庫存/耗用只認物料層
// 三層分離：這頁是「管理層」——直覺打勾 keyin；執行層（今日盤點）後續期由頻率設定展開餵每日工作
import React, { useState } from "react";
import { C, MONOF, rid } from "./Supply.jsx";
import { packToBase, lastPaid, unitCost, quoteUnit, srcsOf, priceAlert } from "./inv.js";

const WDZ = ["日", "一", "二", "三", "四", "五", "六"];
const freqText = (f) => {
  if (!f || f.type === "none" || !f.type) return "不盤";
  const base = f.type === "daily" ? "每日" : f.type === "weekly" ? "每週" + (f.days || []).map(d => WDZ[d]).join("") : "每月" + (f.dom || 1) + "日";
  return (f.paused ? "⏸ " : "") + base;
};

export default function IngredientsView({ db, save, canEdit, showMoney, confirm, flash }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);      // 展開詳情的物料 id
  const [drag, setDrag] = useState(null);      // 拖曳中的物料 id
  const [asg, setAsg] = useState({});          // 未歸戶面板：viId → 選擇的物料 id
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const pill = (on, color) => ({ border: `1.5px solid ${on ? color : "#d9cfbd"}`, background: on ? color : "#fff", color: on ? "#fff" : C.sub, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: canEdit ? "pointer" : "default", whiteSpace: "nowrap" });

  const ings = (db.ingredients || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const qq = q.trim().toLowerCase();
  const shown = ings.filter(g => !qq || `${g.name || ""} ${g.cat || ""} ${g.tags || ""}`.toLowerCase().includes(qq));
  const cats = [...new Set(shown.map(g => (g.cat || "").trim() || "未分類"))];
  const alertPct = (db.settings && db.settings.priceAlertPct) || 15;
  const vname = (vid) => ((db.vendors || []).find(v => v.id === vid) || {}).name || "—";

  const updIng = (id, fp) => save({ ingredients: (db.ingredients || []).map(x => x.id === id ? { ...x, ...fp } : x) });
  const addIng = () => {
    if (!canEdit) return;
    const g = { id: rid("g"), name: "", cat: "", baseUnit: "g", countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: ings.length, tags: "" };
    save({ ingredients: [...(db.ingredients || []), g] }); setOpen(g.id);
  };
  const delIng = async (g) => {
    if (!(await confirm(`刪除物料「${g.name || "未命名"}」？掛在上面的貨源會退回未歸戶（貨源本身不會被刪）。`, { confirmLabel: "刪除" }))) return;
    // 原子操作：物料刪除＋貨源解掛同一次 save，不留半套
    save({ ingredients: (db.ingredients || []).filter(x => x.id !== g.id), vendorItems: (db.vendorItems || []).map(v => v.ingredient_id === g.id ? { ...v, ingredient_id: "" } : v) });
  };
  const assign = (viId, ingId) => save({ vendorItems: (db.vendorItems || []).map(v => v.id === viId ? { ...v, ingredient_id: ingId } : v) });
  const createFromVi = (vi) => {
    // 建卡並歸戶：用貨源品名預填，原子寫入
    const g = { id: rid("g"), name: vi.name || "", cat: "", baseUnit: "g", countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: (db.ingredients || []).length, tags: "" };
    save({ ingredients: [...(db.ingredients || []), g], vendorItems: (db.vendorItems || []).map(v => v.id === vi.id ? { ...v, ingredient_id: g.id } : v) });
    setOpen(g.id); flash(`✓ 已建物料卡「${g.name}」並掛上貨源——記得補基本單位與換算`);
  };
  const dropOn = (targetId) => {
    if (!drag || drag === targetId) return setDrag(null);
    const list = [...ings]; const from = list.findIndex(x => x.id === drag), to = list.findIndex(x => x.id === targetId);
    if (from < 0 || to < 0) return setDrag(null);
    const [mv] = list.splice(from, 1); list.splice(to, 0, mv);
    save({ ingredients: list.map((x, i) => ({ ...x, sort: i })) }); setDrag(null);
  };

  const unassigned = (db.vendorItems || []).filter(v => !v.ingredient_id);
  const d2 = (n) => n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 1000) / 1000).toString();

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>物料</span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>物料清單</div>
          <div style={{ fontSize: 11, color: C.faint }}>一個物料＝一種「東西」（高麗菜），多家廠商的貨都掛在同一張卡下比價。盤點頻率在這裡勾，之後自動變現場的今日工作。</div>
        </div>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 搜尋物料/分類/標籤" style={{ ...inp, width: 180 }} />
        {canEdit && <button onClick={addIng} style={{ border: "none", background: C.accent, color: "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>＋ 新增物料</button>}
      </div>

      {shown.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 12 }}>{qq ? "沒有符合的物料。" : "還沒有物料卡——按「＋新增物料」，或直接從下方「未歸戶貨源」一鍵建卡。"}</div>}

      {cats.map(cat => (
        <div key={cat} style={{ background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#ece4d6" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{cat}</span>
            <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{shown.filter(g => ((g.cat || "").trim() || "未分類") === cat).length} 項</span>
          </div>
          {shown.filter(g => ((g.cat || "").trim() || "未分類") === cat).map(g => {
            const srcs = srcsOf(db, g.id);
            const isOpen = open === g.id;
            const anyAlert = srcs.map(vi => priceAlert(vi, alertPct)).find(Boolean);
            return (
              <React.Fragment key={g.id}>
                <div draggable={canEdit} onDragStart={() => setDrag(g.id)} onDragOver={e => drag && e.preventDefault()} onDrop={() => dropOn(g.id)}
                  onClick={() => setOpen(isOpen ? null : g.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36, padding: "3px 12px", borderTop: `1px solid #f0ead9`, fontSize: 12.5, cursor: "pointer", background: isOpen ? "#fbeee6" : "#fff", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: C.faint }}>{isOpen ? "▾" : "▸"}</span>
                  <button onClick={e => { e.stopPropagation(); canEdit && updIng(g.id, { isKey: !g.isKey }); }} title={g.isKey ? "關鍵品項（點擊取消）" : "標為關鍵品項"} style={{ border: "none", background: "none", color: g.isKey ? "#E8A317" : "#d9cfbd", fontSize: 14, cursor: "pointer", padding: 0 }}>{g.isKey ? "★" : "☆"}</button>
                  <span style={{ fontWeight: 700, color: C.text, minWidth: 100 }}>{g.name || <span style={{ color: C.faint }}>（未命名）</span>}</span>
                  <span style={{ fontSize: 10.5, color: C.faint }}>{g.baseUnit || "?"}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: g.countFreq && g.countFreq.type !== "none" && !g.countFreq.paused ? "#fff" : C.sub, background: g.countFreq && g.countFreq.type !== "none" && !g.countFreq.paused ? C.blue : "#efe9db", borderRadius: 9, padding: "1px 8px" }}>{freqText(g.countFreq)}</span>
                  {g.countRole && <span style={{ fontSize: 10.5, color: C.faint }}>👤{g.countRole}</span>}
                  {anyAlert && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.red }}>▲ 有貨源變價 {anyAlert.pct > 0 ? "+" : ""}{anyAlert.pct}%</span>}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONOF, fontSize: 11, color: srcs.length ? C.sub : C.red }}>{srcs.length} 貨源</span>
                  {canEdit && <button onClick={e => { e.stopPropagation(); delIng(g); }} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer", fontSize: 14 }}>×</button>}
                </div>
                {isOpen && (
                  <div style={{ padding: "10px 14px 12px 30px", borderTop: `1px solid #f0ead9`, background: "#fdfaf3" }}>
                    {/* 基本資料 */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                      <label style={{ fontSize: 11, color: C.sub }}>名稱 <input value={g.name || ""} onChange={e => updIng(g.id, { name: e.target.value })} disabled={!canEdit} style={{ ...inp, width: 130 }} /></label>
                      <label style={{ fontSize: 11, color: C.sub }}>分類 <input value={g.cat || ""} onChange={e => updIng(g.id, { cat: e.target.value })} disabled={!canEdit} placeholder="菜/肉/海鮮/包材…" list={"ingcats"} style={{ ...inp, width: 100 }} /></label>
                      <datalist id="ingcats">{[...new Set(ings.map(x => (x.cat || "").trim()).filter(Boolean))].map(c2 => <option key={c2} value={c2} />)}</datalist>
                      <label style={{ fontSize: 11, color: C.sub }}>基本單位 <input value={g.baseUnit || ""} onChange={e => updIng(g.id, { baseUnit: e.target.value })} disabled={!canEdit} placeholder="g/ml/個" style={{ ...inp, width: 60 }} /></label>
                      <label style={{ fontSize: 11, color: C.sub }}>安全庫存 <input value={g.safeStock ?? ""} onChange={e => updIng(g.id, { safeStock: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" style={{ ...inp, width: 76, fontFamily: MONOF }} /> <span style={{ fontSize: 10, color: C.faint }}>{g.baseUnit}</span></label>
                    </div>
                    {/* 盤點設定：管理層直覺點選；執行展開到今日工作＝後續期 */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>盤點：</span>
                      {[["daily", "每日"], ["weekly", "每週"], ["monthly", "每月"], ["none", "不盤"]].map(([k, lb]) => (
                        <button key={k} disabled={!canEdit} onClick={() => canEdit && updIng(g.id, { countFreq: { ...(g.countFreq || {}), type: k } })} style={pill((g.countFreq || {}).type === k || (!g.countFreq && k === "none"), C.blue)}>{lb}</button>
                      ))}
                      {(g.countFreq || {}).type === "weekly" && WDZ.map((w, d) => {
                        const on = ((g.countFreq || {}).days || []).includes(d);
                        return <button key={d} disabled={!canEdit} onClick={() => { const days = ((g.countFreq || {}).days || []); updIng(g.id, { countFreq: { ...g.countFreq, days: on ? days.filter(x => x !== d) : [...days, d].sort() } }); }} style={{ ...pill(on, C.accent), padding: "3px 8px" }}>{w}</button>;
                      })}
                      {(g.countFreq || {}).type === "monthly" && <label style={{ fontSize: 11, color: C.sub }}>每月 <input value={(g.countFreq || {}).dom || 1} onChange={e => updIng(g.id, { countFreq: { ...g.countFreq, dom: Math.min(28, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)) } })} disabled={!canEdit} style={{ ...inp, width: 44, fontFamily: MONOF, textAlign: "center" }} /> 日</label>}
                      {(g.countFreq || {}).type && (g.countFreq || {}).type !== "none" && (
                        <label style={{ fontSize: 11.5, color: C.sub, display: "flex", alignItems: "center", gap: 4 }}><input type="checkbox" checked={!!(g.countFreq || {}).paused} onChange={e => updIng(g.id, { countFreq: { ...g.countFreq, paused: e.target.checked } })} disabled={!canEdit} />暫停</label>
                      )}
                      <label style={{ fontSize: 11, color: C.sub }}>負責角色 <input value={g.countRole || ""} onChange={e => updIng(g.id, { countRole: e.target.value })} disabled={!canEdit} placeholder="內場收班…" style={{ ...inp, width: 90 }} /></label>
                      <label style={{ fontSize: 11, color: C.sub }}>盤點單位 <input value={g.countUnit || ""} onChange={e => updIng(g.id, { countUnit: e.target.value })} disabled={!canEdit} placeholder={g.baseUnit || "同基本單位"} style={{ ...inp, width: 76 }} /></label>
                    </div>
                    {/* 貨源清單＝比價視圖：同物料多貨源並列，換算同單位，最低標綠 */}
                    <div style={{ marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                      <div style={{ display: "grid", gridTemplateColumns: `minmax(90px,1fr) minmax(120px,1.3fr) 150px ${showMoney ? "110px 110px 90px" : ""}`, gap: 8, padding: "5px 10px", fontSize: 10, color: C.faint, fontWeight: 700, background: "#f4efe5" }}>
                        <span>廠商</span><span>品名/規格</span><span>換算（1{"採購單位"}=?{g.baseUnit || "基本單位"}）</span>{showMoney && <><span style={{ textAlign: "right" }}>最近實付</span><span style={{ textAlign: "right" }}>最近報價</span><span style={{ textAlign: "right" }}>$/{g.baseUnit || "單位"}</span></>}
                      </div>
                      {srcs.length === 0 && <div style={{ padding: "10px", fontSize: 11.5, color: C.red }}>⚠ 還沒掛貨源——從下面選一個掛上來，或到「未歸戶貨源」歸入。</div>}
                      {(() => {
                        const units = srcs.map(vi => unitCost(vi)).filter(u => u != null);
                        const minU = units.length ? Math.min(...units) : null;
                        return srcs.map(vi => {
                          const u = unitCost(vi); const qu = quoteUnit(vi); const lp = lastPaid(vi); const al = priceAlert(vi, alertPct);
                          const best = showMoney && u != null && minU != null && u <= minU + 1e-9 && units.length > 1;
                          return (
                            <div key={vi.id} style={{ display: "grid", gridTemplateColumns: `minmax(90px,1fr) minmax(120px,1.3fr) 150px ${showMoney ? "110px 110px 90px" : ""}`, gap: 8, alignItems: "center", padding: "4px 10px", borderTop: `1px solid #f0ead9`, fontSize: 12, background: best ? "#eef5ef" : "#fff" }}>
                              <span style={{ fontWeight: 700, color: C.text }}>{vname(vi.vendor_id)}</span>
                              <span style={{ color: C.sub, fontSize: 11.5 }}>{vi.name}{vi.spec ? `（${vi.spec}）` : ""}</span>
                              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                                1{vi.unit || "單位"}=
                                <input value={vi.packToBase ?? ""} onChange={e => save({ vendorItems: (db.vendorItems || []).map(v => v.id === vi.id ? { ...v, packToBase: e.target.value.replace(/[^0-9.]/g, "") } : v) })} disabled={!canEdit} inputMode="decimal" placeholder="?" style={{ ...inp, width: 70, padding: "3px 6px", fontFamily: MONOF, borderColor: packToBase(vi) ? C.line : C.red }} />
                                {g.baseUnit}
                              </span>
                              {showMoney && <>
                                <span style={{ fontFamily: MONOF, textAlign: "right", color: lp ? C.text : "#d5cbb6", fontSize: 11.5 }}>{lp ? `$${d2(lp.price)}/${vi.unit || "單位"}` : "—"}{lp && lp.src === "主檔" && <span title="還沒有驗收實付紀錄，暫用主檔單價" style={{ color: C.faint, fontSize: 9.5 }}>*</span>}{al && <span style={{ color: al.up ? C.red : C.green, fontWeight: 700, marginLeft: 3 }}>{al.up ? "▲" : "▼"}{Math.abs(al.pct)}%</span>}</span>
                                <span style={{ fontFamily: MONOF, textAlign: "right", color: vi.quote && vi.quote.price ? C.sub : "#d5cbb6", fontSize: 11.5 }}>{vi.quote && vi.quote.price ? `$${d2(vi.quote.price)}` : "—"}</span>
                                <span style={{ fontFamily: MONOF, textAlign: "right", fontWeight: 700, color: u != null ? (best ? C.green : C.text) : C.red, fontSize: 11.5 }}>{u != null ? `$${d2(u)}${best ? " ✓低" : ""}` : "未設換算"}</span>
                              </>}
                            </div>
                          );
                        });
                      })()}
                      {canEdit && unassigned.length > 0 && (
                        <div style={{ display: "flex", gap: 6, padding: "6px 10px", borderTop: `1px solid #f0ead9`, alignItems: "center" }}>
                          <select value={asg["ing" + g.id] || ""} onChange={e => setAsg(a => ({ ...a, ["ing" + g.id]: e.target.value }))} style={{ ...inp, fontSize: 11.5, maxWidth: 280 }}>
                            <option value="">＋ 掛上未歸戶貨源…</option>
                            {unassigned.map(vi => <option key={vi.id} value={vi.id}>{vname(vi.vendor_id)}｜{vi.name}{vi.spec ? `（${vi.spec}）` : ""}</option>)}
                          </select>
                          <button disabled={!asg["ing" + g.id]} onClick={() => { assign(asg["ing" + g.id], g.id); setAsg(a => ({ ...a, ["ing" + g.id]: "" })); }} style={{ border: `1px solid ${C.line}`, background: asg["ing" + g.id] ? C.green : "#fff", color: asg["ing" + g.id] ? "#fff" : C.sub, borderRadius: 7, padding: "4px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>掛上</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      ))}

      {/* 未歸戶貨源（不能靜默）：每個貨源都該有主人，否則進不了成本計算 */}
      {unassigned.length > 0 && (
        <div style={{ background: C.card, border: `1.5px solid ${C.amber}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f7edd8" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>📥 未歸戶貨源</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: C.amber, borderRadius: 9, padding: "1px 8px" }}>{unassigned.length}</span>
            <span style={{ fontSize: 11, color: C.faint }}>廠商品項還沒掛到物料卡——歸戶後才能比價、算成本。不歸戶不影響叫貨/驗收。</span>
          </div>
          {unassigned.map(vi => (
            <div key={vi.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", borderTop: `1px solid #f0ead9`, fontSize: 12, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: C.text, minWidth: 80 }}>{vname(vi.vendor_id)}</span>
              <span style={{ color: C.sub }}>{vi.name}{vi.spec ? `（${vi.spec}）` : ""}</span>
              <div style={{ flex: 1 }} />
              {canEdit && <>
                <select value={asg[vi.id] || ""} onChange={e => setAsg(a => ({ ...a, [vi.id]: e.target.value }))} style={{ ...inp, fontSize: 11.5, maxWidth: 180 }}>
                  <option value="">歸入現有物料…</option>
                  {ings.map(g => <option key={g.id} value={g.id}>{g.name || "（未命名）"}</option>)}
                </select>
                <button disabled={!asg[vi.id]} onClick={() => { assign(vi.id, asg[vi.id]); setAsg(a => ({ ...a, [vi.id]: "" })); }} style={{ border: `1px solid ${C.line}`, background: asg[vi.id] ? C.green : "#fff", color: asg[vi.id] ? "#fff" : C.sub, borderRadius: 7, padding: "4px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>歸入</button>
                <button onClick={() => createFromVi(vi)} style={{ border: `1px solid ${C.accent}`, background: "#fff", color: C.accent, borderRadius: 7, padding: "4px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>建卡並歸戶</button>
              </>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
