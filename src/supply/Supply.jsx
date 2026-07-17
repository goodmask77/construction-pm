// 供應鏈空間（P1）：產品管理（完整）＋廠商（唯讀預覽，P2 完整版）＋叫貨（P2）
// 資料：sp_supply_pm_supply（B案自 ground-pack 全量搬遷；categories/products/materials/vendors/matches/productPackaging）
import React, { useEffect, useState } from "react";

const C = {
  text: "#1d1a15", sub: "#5a5247", faint: "#9b9384", line: "#d9cfbd", hard: "#c8bca6",
  card: "#fbf8f1", soft: "#f4efe5", accent: "#c4582a", blue: "#3a6ea5", green: "#3f7d4e", red: "#b3261e", amber: "#c98a14",
};
const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const rid = (p) => p + Math.random().toString(36).slice(2, 8);
const fmt$ = (v) => { const n = Number(String(v).replace(/[^0-9.-]/g, "")); return isNaN(n) || v === "" ? "" : "NT$" + Math.round(n).toLocaleString(); };

export default function SupplyView({ view, K, canEdit, confirm, showMoney }) {
  const [db, setDb] = useState(null);
  const [q, setQ] = useState("");
  const [catF, setCatF] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [tagF, setTagF] = useState("");
  const [flat, setFlat] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [sel, setSel] = useState(null); // 產品詳情
  const [msg, setMsg] = useState(null);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? null : m)), 6000); };

  useEffect(() => { (async () => {
    try { const v = await window.storage.get(K("pm_supply"), true); setDb(v && v.value ? JSON.parse(v.value) : { categories: [], products: [], materials: [], vendors: [], matches: [], productPackaging: [] }); } catch (_) { setDb({ categories: [], products: [], materials: [], vendors: [], matches: [], productPackaging: [] }); }
  })(); }, []); // eslint-disable-line

  if (!db) return <div style={{ padding: 40, color: C.sub, fontSize: 14 }}>載入中…</div>;
  const save = (patch) => { const next = { ...db, ...patch }; setDb(next); window.storage.set(K("pm_supply"), JSON.stringify(next), true).catch(() => {}); };
  const updP = (id, fp) => save({ products: db.products.map(x => x.id === id ? { ...x, ...fp } : x) });
  const packCount = (pid) => (db.productPackaging || []).filter(x => x.product_id === pid).length;
  const allTags = [...new Set((db.products || []).flatMap(x => x.tags || []))];
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const btn = (label, onClick, st) => <button onClick={onClick} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", ...st }}>{label}</button>;
  const box = { background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" };

  // ── 叫貨（P2 佔位）──
  if (view === "sorder") return (
    <div style={{ padding: 40, textAlign: "center", background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 12 }}>
      <div style={{ fontSize: 34 }}>🛒</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginTop: 8 }}>叫貨系統（P2 建置中）</div>
      <div style={{ fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 1.9 }}>依廠商勾品項數量 → 存叫貨單 → D自動發廠商群 / LINE分享 → 到貨點收 → 待付款進財務。<br />資料已就緒：{(db.materials || []).length} 項物料・{(db.vendors || []).length} 家廠商。</div>
    </div>
  );

  // ── 廠商（P1 唯讀預覽；P2 完整版含品項清單/報價/LINE群綁定）──
  if (view === "svendors") {
    const vs = (db.vendors || []).filter(v => !q.trim() || (v.name + (v.en || "") + (v.tags || []).join("") + (v.note || "")).toLowerCase().includes(q.trim().toLowerCase()));
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
          <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>廠商</span>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>供應商名錄 <span style={{ fontSize: 12, color: C.faint, fontWeight: 400 }}>{vs.length} 家・P2 將加：品項清單/報價/LINE群綁定/叫貨</span></div>
          <div style={{ flex: 1 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋廠商/標籤…" style={{ ...inp, width: 200 }} />
        </div>
        <div style={box}>
          {vs.map((v, i) => (
            <div key={v.id} style={{ display: "grid", gridTemplateColumns: "minmax(160px,0.9fr) minmax(220px,1.6fr) minmax(160px,1.4fr) 90px", gap: 10, alignItems: "center", minHeight: 44, borderTop: i ? `1px solid #f0ead9` : "none", padding: "6px 12px" }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{v.name}</div>
                <div style={{ fontSize: 10.5, color: C.faint }}>{v.en}</div>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{(v.tags || []).map(t => <span key={t} style={{ fontSize: 10.5, color: C.sub, background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "1px 8px" }}>{t}</span>)}</div>
              <div style={{ fontSize: 11.5, color: C.sub, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }} title={v.note}>{v.note}</div>
              <div>{v.url && <a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.blue }}>官網 ↗</a>}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── 產品管理（核心）──
  const cats = [...(db.categories || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  let prods = (db.products || []).filter(x =>
    (!q.trim() || (x.name + (x.english_name || "") + (x.note || "")).toLowerCase().includes(q.trim().toLowerCase())) &&
    (!catF || x.category === catF) && (!onlyActive || x.is_active !== false) && (!tagF || (x.tags || []).includes(tagF)));
  const byCat = {};
  prods.forEach(x => { (byCat[x.category || "未分類"] = byCat[x.category || "未分類"] || []).push(x); });
  const catNames = [...cats.map(c => c.name), ...Object.keys(byCat).filter(n => !cats.some(c => c.name === n))].filter(n => byCat[n]?.length);
  const GTC = `minmax(150px,1.2fr) minmax(130px,1fr) minmax(120px,1fr) 76px ${showMoney ? "88px " : ""}64px 110px 80px 44px`;
  const addProduct = (catName) => {
    if (!canEdit) return;
    const np = { id: rid("p"), category: catName || catNames[0] || "未分類", name: "", english_name: "", price: "", note: "", is_active: true, sort: (db.products || []).length, unit: "", tags: [] };
    save({ products: [...db.products, np] }); setSel(np.id);
  };
  const addCategory = () => { if (!canEdit) return; const nm = window.prompt("新類別名稱"); if (!nm || !nm.trim()) return; save({ categories: [...db.categories, { name: nm.trim(), sort: db.categories.length }] }); };
  const rows = (list) => list.map((x, i) => (
    <div key={x.id} onClick={() => setSel(x.id)}
      onMouseEnter={e => e.currentTarget.style.background = C.soft} onMouseLeave={e => e.currentTarget.style.background = x.is_active === false ? "#f2ede1" : "#fff"}
      style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "center", minHeight: 36, borderTop: `1px solid #f0ead9`, cursor: "pointer", background: x.is_active === false ? "#f2ede1" : "#fff", opacity: x.is_active === false ? .6 : 1, padding: "0 4px" }}>
      <div style={{ padding: "0 8px", fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name || "（未命名）"}</div>
      <div style={{ padding: "0 8px", fontSize: 11.5, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.english_name}</div>
      <div style={{ padding: "0 8px", fontSize: 11.5, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.note || "—"}</div>
      <div style={{ padding: "0 8px", fontSize: 12, color: x.unit ? C.sub : "#d5cbb6" }}>{x.unit || "—"}</div>
      {showMoney && <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 12, textAlign: "right", color: x.price ? C.text : "#d5cbb6" }}>{fmt$(x.price) || "—"}</div>}
      <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 12, textAlign: "center", color: packCount(x.id) ? C.blue : "#d5cbb6" }}>{packCount(x.id) || "—"}</div>
      <div style={{ padding: "0 6px", display: "flex", gap: 3, flexWrap: "wrap" }}>{(x.tags || []).map(t => <span key={t} style={{ fontSize: 10, color: C.accent, background: "#fbeee6", borderRadius: 8, padding: "0 6px" }}>#{t}</span>)}</div>
      <div style={{ padding: "0 6px" }}><span style={{ fontSize: 10.5, fontWeight: 600, color: x.is_active !== false ? C.green : C.faint, background: x.is_active !== false ? "#eef5ef" : "#ece4d6", borderRadius: 9, padding: "1px 8px" }}>{x.is_active !== false ? "啟用" : "停用"}</span></div>
      <div style={{ textAlign: "center", color: C.faint, fontSize: 12 }}>✎</div>
    </div>
  ));
  const selP = sel && db.products.find(x => x.id === sel);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 10px", flexWrap: "wrap" }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>產品</span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>產品管理</div>
          <div style={{ fontSize: 11, color: C.faint }}>{db.products.length} 項產品・{cats.length} 類別・{(db.materials || []).length} 項物料/包材（自 ground-pack 搬遷完成）</div>
        </div>
        <div style={{ flex: 1 }} />
        {canEdit && btn("＋ 新增類別", addCategory)}
        {canEdit && btn("＋ 新增產品", () => addProduct(catF || ""), { background: C.accent, color: "#fff", borderColor: C.accent })}
      </div>
      {msg && <div style={{ background: "#eef5ef", border: `1.5px solid ${C.green}`, borderRadius: 8, padding: "7px 12px", marginBottom: 10, fontSize: 12.5, color: "#2c5a38", fontWeight: 600 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋產品名稱…" style={{ ...inp, width: 190 }} />
        <select value={catF} onChange={e => setCatF(e.target.value)} style={inp}><option value="">全部類別</option>{cats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: C.sub, cursor: "pointer" }}><input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />只看啟用中</label>
        {allTags.map(t => <button key={t} onClick={() => setTagF(tagF === t ? "" : t)} style={{ border: `1.5px solid ${tagF === t ? C.accent : C.line}`, background: tagF === t ? C.accent : "#fff", color: tagF === t ? "#fff" : C.sub, borderRadius: 12, padding: "2px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>#{t}</button>)}
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
          {[[false, "依類別分組"], [true, "全部攤平"]].map(([v, l]) => (
            <button key={l} onClick={() => setFlat(v)} style={{ padding: "4px 11px", borderRadius: 6, border: `1px solid ${flat === v ? C.line : "transparent"}`, background: flat === v ? "#fff" : "transparent", color: flat === v ? C.text : C.sub, fontSize: 12, fontWeight: flat === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>
      {/* 表格 */}
      {flat ? (
        <div style={box}>
          <div style={{ display: "grid", gridTemplateColumns: GTC, background: "#ece4d6", borderBottom: `1.5px solid ${C.hard}`, padding: "0 4px" }}>
            {["品名", "英文名稱", "內容/備註", "單位", ...(showMoney ? ["售價"] : []), "包材", "標籤", "狀態", ""].map((h, i2) => <div key={i2} style={{ padding: "7px 8px", fontSize: 10.5, letterSpacing: .6, color: C.sub, fontWeight: 700, textAlign: h === "售價" ? "right" : h === "包材" ? "center" : "left" }}>{h}</div>)}
          </div>
          {rows([...prods].sort((a, b) => (a.sort || 0) - (b.sort || 0)))}
        </div>
      ) : catNames.map(cn => (
        <div key={cn} style={box}>
          <div onClick={() => setCollapsed(c2 => ({ ...c2, [cn]: !c2[cn] }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#ece4d6", cursor: "pointer" }}>
            <span style={{ fontSize: 11, color: C.faint }}>{collapsed[cn] ? "▸" : "▾"}</span>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{cn}</span>
            <span style={{ fontFamily: MONOF, fontSize: 11.5, color: C.faint }}>{byCat[cn].length} 項</span>
            <div style={{ flex: 1 }} />
            {canEdit && <button onClick={e => { e.stopPropagation(); addProduct(cn); }} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.accent, borderRadius: 6, padding: "2px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>＋ 產品</button>}
          </div>
          {!collapsed[cn] && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: GTC, background: C.soft, borderTop: `1px solid ${C.line}`, padding: "0 4px" }}>
                {["品名", "英文名稱", "內容/備註", "單位", ...(showMoney ? ["售價"] : []), "包材", "標籤", "狀態", ""].map((h, i2) => <div key={i2} style={{ padding: "5px 8px", fontSize: 10, letterSpacing: .6, color: C.faint, fontWeight: 700, textAlign: h === "售價" ? "right" : h === "包材" ? "center" : "left" }}>{h}</div>)}
              </div>
              {rows([...byCat[cn]].sort((a, b) => (a.sort || 0) - (b.sort || 0)))}
            </>
          )}
        </div>
      ))}
      {/* 產品詳情 */}
      {selP && (
        <div onClick={e => e.target === e.currentTarget && setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 22, width: "min(620px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>產品{selP.name ? `：${selP.name}` : ""}</div>
              <div style={{ flex: 1 }} />
              {canEdit && <button onClick={async () => { if (await confirm(`刪除「${selP.name || "未命名"}」？`, { confirmLabel: "刪除" })) { save({ products: db.products.filter(x => x.id !== selP.id), productPackaging: (db.productPackaging || []).filter(x => x.product_id !== selP.id) }); setSel(null); } }} style={{ background: "none", border: `1px solid ${C.line}`, color: C.red, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>刪除</button>}
              <button onClick={() => setSel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[["name", "品名"], ["english_name", "英文名稱"], ["unit", "單位"], ...(showMoney ? [["price", "售價"]] : []), ["note", "內容/備註"]].map(([k, l]) => (
                <label key={k} style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600, gridColumn: k === "note" ? "1 / -1" : undefined }}>{l}
                  <input value={selP[k] ?? ""} onChange={e => updP(selP.id, { [k]: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }} />
                </label>
              ))}
              <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600 }}>類別
                <select value={selP.category || ""} onChange={e => updP(selP.id, { category: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }}>
                  {cats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                  {selP.category && !cats.some(c => c.name === selP.category) && <option value={selP.category}>{selP.category}</option>}
                </select>
              </label>
              <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600 }}>狀態
                <select value={selP.is_active !== false ? "1" : "0"} onChange={e => updP(selP.id, { is_active: e.target.value === "1" })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }}><option value="1">啟用</option><option value="0">停用</option></select>
              </label>
              <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600, gridColumn: "1 / -1" }}>標籤（逗號分隔）
                <input value={(selP.tags || []).join(",")} onChange={e => updP(selP.id, { tags: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }} placeholder="熱,冷" />
              </label>
            </div>
            {/* 包材綁定 */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>📦 綁定包材（{packCount(selP.id)}）</div>
              <div style={{ maxHeight: 190, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px" }}>
                {(db.materials || []).map(m => {
                  const on = (db.productPackaging || []).some(x => x.product_id === selP.id && x.packaging_id === m.id);
                  return (
                    <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12.5, color: C.text, cursor: canEdit ? "pointer" : "default" }}>
                      <input type="checkbox" checked={on} disabled={!canEdit} onChange={e => {
                        const pp = db.productPackaging || [];
                        save({ productPackaging: e.target.checked ? [...pp, { product_id: selP.id, packaging_id: m.id, sort: pp.length }] : pp.filter(x => !(x.product_id === selP.id && x.packaging_id === m.id)) });
                      }} />
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      <span style={{ fontSize: 10.5, color: C.faint }}>{m.grp}{m.spec ? `・${m.spec}` : ""}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
