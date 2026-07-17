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
  const [orders, setOrders] = useState([]);   // 叫貨單紀錄（sp_supply_pm_orders）
  const [qty, setQty] = useState({});          // 叫貨數量 itemId→qty
  const [needDate, setNeedDate] = useState(""); // 希望到貨日
  const [preview, setPreview] = useState(null); // 叫貨單預覽 vendorId
  const [odSel, setOdSel] = useState(null);      // 叫貨紀錄詳情 orderId
  const [groups, setGroups] = useState({});     // D哥看過的LINE群（pm_group_seen，發送綁定用）
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? null : m)), 6000); };

  useEffect(() => { (async () => {
    try { const v = await window.storage.get(K("pm_supply"), true); setDb(v && v.value ? JSON.parse(v.value) : { categories: [], products: [], materials: [], vendors: [], matches: [], productPackaging: [] }); } catch (_) { setDb({ categories: [], products: [], materials: [], vendors: [], matches: [], productPackaging: [] }); }
    try { const o = await window.storage.get(K("pm_orders"), true); setOrders(o && o.value ? JSON.parse(o.value) : []); } catch (_) {}
    try { const g = await window.storage.get("pm_group_seen", true); setGroups(g && g.value ? JSON.parse(g.value) : {}); } catch (_) {}
  })(); }, []); // eslint-disable-line

  if (!db) return <div style={{ padding: 40, color: C.sub, fontSize: 14 }}>載入中…</div>;
  const save = (patch) => { const next = { ...db, ...patch }; setDb(next); window.storage.set(K("pm_supply"), JSON.stringify(next), true).catch(() => {}); };
  const updP = (id, fp) => save({ products: db.products.map(x => x.id === id ? { ...x, ...fp } : x) });
  const packCount = (pid) => (db.productPackaging || []).filter(x => x.product_id === pid).length;
  const allTags = [...new Set((db.products || []).flatMap(x => x.tags || []))];
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 10px", fontSize: 13, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const btn = (label, onClick, st) => <button onClick={onClick} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", ...st }}>{label}</button>;
  const box = { background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" };

  const saveOrders = (list) => { setOrders(list); window.storage.set(K("pm_orders"), JSON.stringify(list), true).catch(() => {}); };
  const WDZ = ["日", "一", "二", "三", "四", "五", "六"];
  const dz = (d) => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}（${WDZ[new Date(d + "T00:00:00").getDay()]}）` : "";

  // ── 叫貨：依廠商勾數量 → 叫貨單 → D自動發群 / LINE分享 / 複製 → 紀錄可追狀態 ──
  if (view === "sorder") {
    const DEPTS = ["外場", "內場", "吧檯", "共用"];
    const itemsOf = (vid) => (db.vendorItems || []).filter(x => x.vendor_id === vid).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const vlist = (db.vendors || []).filter(v => itemsOf(v.id).length).filter(v => !catF || (v.dept || "共用") === catF);
    const picked = (vid) => itemsOf(vid).filter(it => Number(qty[it.id]) > 0);
    const updV = (id, fp) => save({ vendors: db.vendors.map(x => x.id === id ? { ...x, ...fp } : x) });
    const orderText = (v) => {
      const its = picked(v.id);
      const t = new Date();
      const d2t = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const total = its.reduce((tt, it) => tt + (Number(it.price) || 0) * (Number(qty[it.id]) || 0), 0);
      return `📦 A Beach 101 叫貨單 ${t.getMonth() + 1}/${t.getDate()}（${WDZ[t.getDay()]}）\n【${v.name}】\n` +
        its.map(it => `・${it.name}${it.spec ? " " + it.spec : ""} ×${qty[it.id]} ${it.unit || ""}${it.price ? `＠${d2t(Number(it.price))}＝$${d2t(Number(it.price) * Number(qty[it.id]))}` : ""}`).join("\n") +
        `\n──────\n合計 $${d2t(total)}` +
        (needDate ? `\n希望到貨：${dz(needDate)}` : "") + "\n麻煩核對品項與金額，謝謝！";
    };
    // D發群用 Flex 卡片（LINE 原生電子收據樣式：品項/數量/單價/小計對齊＋合計）
    const orderFlex = (v) => {
      const its = picked(v.id);
      const t = new Date();
      const d2t = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const total = its.reduce((tt, it) => tt + (Number(it.price) || 0) * (Number(qty[it.id]) || 0), 0);
      const cell = (txt, flexN, opts = {}) => ({ type: "text", text: String(txt), size: "xs", flex: flexN, ...opts });
      return {
        type: "flex",
        altText: orderText(v).slice(0, 390),
        contents: {
          type: "bubble", size: "mega",
          header: {
            type: "box", layout: "vertical", backgroundColor: "#1d1a15", paddingAll: "14px", contents: [
              { type: "text", text: "📦 A Beach 101 叫貨單", color: "#ffffff", weight: "bold", size: "md" },
              { type: "text", text: `${t.getMonth() + 1}/${t.getDate()}（${WDZ[t.getDay()]}）｜${v.name}`, color: "#d9cfbd", size: "xs", margin: "sm" },
            ],
          },
          body: {
            type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px", contents: [
              { type: "box", layout: "horizontal", spacing: "sm", contents: [
                cell("品名", 5, { color: "#9b9384", weight: "bold" }), cell("數量", 2, { color: "#9b9384", align: "end", weight: "bold" }), cell("單價", 2, { color: "#9b9384", align: "end", weight: "bold" }), cell("小計", 3, { color: "#9b9384", align: "end", weight: "bold" }),
              ] },
              { type: "separator", color: "#c8bca6" },
              ...its.map(it => ({ type: "box", layout: "horizontal", spacing: "sm", contents: [
                cell(it.name + (it.spec ? " " + it.spec : ""), 5, { color: "#1d1a15", wrap: true }),
                cell(`${qty[it.id]}${it.unit || ""}`, 2, { color: "#5a5247", align: "end" }),
                cell(it.price ? d2t(Number(it.price)) : "—", 2, { color: "#5a5247", align: "end" }),
                cell(it.price ? "$" + d2t(Number(it.price) * Number(qty[it.id])) : "—", 3, { color: "#1d1a15", align: "end", weight: "bold" }),
              ] })),
              { type: "separator", color: "#c8bca6" },
              { type: "box", layout: "horizontal", contents: [
                { type: "text", text: "合計", size: "sm", weight: "bold", color: "#c4582a", flex: 3 },
                { type: "text", text: "$" + d2t(total), size: "lg", weight: "bold", color: "#c4582a", flex: 5, align: "end" },
              ] },
              ...(needDate ? [{ type: "text", text: "🚚 希望到貨：" + dz(needDate), size: "xs", color: "#c4582a", margin: "sm" }] : []),
              { type: "text", text: "麻煩核對品項與金額，謝謝！", size: "xxs", color: "#9b9384", margin: "sm", wrap: true },
            ],
          },
        },
      };
    };
    const recordOrder = (v, via, status, text) => {
      const its = picked(v.id);
      const od = { id: rid("o"), ts: new Date().toISOString(), vendor_id: v.id, vendorName: v.name, dept: v.dept || "共用", needDate, via, status, text, items: its.map(it => ({ id: it.id, name: it.name, spec: it.spec, unit: it.unit, qty: Number(qty[it.id]), price: it.price })) };
      saveOrders([od, ...orders].slice(0, 200));
      const nq = { ...qty }; its.forEach(it => delete nq[it.id]); setQty(nq);
      setPreview(null);
    };
    const pv = preview && db.vendors.find(v => v.id === preview);
    const orderTotal = (od) => od.items.reduce((t, x) => t + (Number(x.price) || 0) * (x.qty || 0), 0);
    const pickTotal = (vid) => picked(vid).reduce((t, it) => t + (Number(it.price) || 0) * (Number(qty[it.id]) || 0), 0);
    const grandTotal = vlist.reduce((t, v) => t + pickTotal(v.id), 0);
    const d2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const nt2 = (n) => "NT$" + d2(n);
    const ST = ["已送出", "廠商已確認", "已到貨", "草稿"];
    // 月底對帳：本月（依紀錄月份）各廠商彙總
    const moNow = new Date().toISOString().slice(0, 7);
    const moOrders = orders.filter(od => (od.ts || "").slice(0, 7) === moNow && od.status !== "草稿");
    const byVendor = {};
    moOrders.forEach(od => { const o = byVendor[od.vendorName] = byVendor[od.vendorName] || { n: 0, amt: 0 }; o.n++; o.amt += orderTotal(od); });
    const odDetail = odSel && orders.find(x => x.id === odSel);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
          <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>叫貨</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>叫貨</div>
            <div style={{ fontSize: 11, color: C.faint }}>填數量 → 產生叫貨單 → 發送（不帶價格）。品項到「廠商」頁維護。</div>
          </div>
          <div style={{ flex: 1 }} />
          {DEPTS.map(d => <button key={d} onClick={() => setCatF(catF === d ? "" : d)} style={{ border: `1.5px solid ${catF === d ? C.accent : C.line}`, background: catF === d ? C.accent : "#fff", color: catF === d ? "#fff" : C.sub, borderRadius: 12, padding: "3px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{d}</button>)}
          <label style={{ fontSize: 11.5, color: C.sub, display: "flex", alignItems: "center", gap: 5 }}>希望到貨
            <input type="date" value={needDate} onChange={e => setNeedDate(e.target.value)} style={{ ...inp, colorScheme: "light" }} />
          </label>
          {showMoney && grandTotal > 0 && <span style={{ fontFamily: MONOF, fontSize: 15, fontWeight: 800, color: C.accent, background: "#fbeee6", border: `1.5px solid ${C.accent}`, borderRadius: 8, padding: "5px 14px" }}>本次總計 {nt2(grandTotal)}</span>}
        </div>
        {msg && <div style={{ background: "#eef5ef", border: `1.5px solid ${C.green}`, borderRadius: 8, padding: "7px 12px", marginBottom: 10, fontSize: 12.5, color: "#2c5a38", fontWeight: 600 }}>{msg}</div>}
        {vlist.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10 }}>這個部門還沒有「有品項清單」的廠商——先到「廠商」頁建品項。</div>}
        {vlist.map(v => {
          const its = itemsOf(v.id); const pk = picked(v.id);
          return (
            <div key={v.id} style={box}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#ece4d6" }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{v.name}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: v.dept === "內場" ? C.green : v.dept === "吧檯" ? C.amber : v.dept === "共用" ? "#9b9384" : C.blue, borderRadius: 9, padding: "1px 8px" }}>{v.dept || "共用"}</span>
                <span style={{ fontSize: 11, color: C.faint }}>{v.sendMode === "dbot" ? (v.lineGroupId ? "D自動發群 ✓已綁定" : "D自動發群 ⚠未綁定群") : v.sendMode === "copy" ? "複製文字" : "LINE分享"}</span>
                <div style={{ flex: 1 }} />
                {pk.length > 0 && <span style={{ fontFamily: MONOF, fontSize: 12, color: C.accent, fontWeight: 700 }}>已選 {pk.length} 項{showMoney ? "・" + nt2(pickTotal(v.id)) : ""}</span>}
                <button disabled={!pk.length} onClick={() => setPreview(v.id)} style={{ border: "none", background: pk.length ? C.accent : "#d5cbb6", color: "#fff", borderRadius: 7, padding: "6px 16px", fontSize: 12.5, fontWeight: 700, cursor: pk.length ? "pointer" : "default" }}>產生叫貨單</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `minmax(170px,1.4fr) minmax(110px,1fr) 56px ${showMoney ? "76px " : ""}70px 130px${showMoney ? " 86px" : ""}`, gap: 8, padding: "4px 12px", fontSize: 10, color: C.faint, fontWeight: 700, borderBottom: `1px solid #f0ead9` }}>
                <span>品名</span><span>規格</span><span>單位</span>{showMoney && <span style={{ textAlign: "right" }}>單價</span>}<span style={{ textAlign: "right" }}>安全庫存</span><span style={{ textAlign: "center" }}>叫貨量</span>{showMoney && <span style={{ textAlign: "right" }}>小計</span>}
              </div>
              {its.map(it => {
                const qv = qty[it.id] || "";
                return (
                  <div key={it.id} style={{ display: "grid", gridTemplateColumns: `minmax(170px,1.4fr) minmax(110px,1fr) 56px ${showMoney ? "76px " : ""}70px 130px${showMoney ? " 86px" : ""}`, gap: 8, alignItems: "center", minHeight: 34, borderTop: `1px solid #f0ead9`, padding: "0 12px", background: Number(qv) > 0 ? "#fbeee6" : "#fff", fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                    <span style={{ color: C.sub, fontSize: 11.5 }}>{it.spec || "—"}</span>
                    <span style={{ color: C.sub }}>{it.unit || "—"}</span>
                    {showMoney && <span style={{ fontFamily: MONOF, textAlign: "right", color: C.sub }}>{it.price ? Number(it.price).toLocaleString() : "—"}</span>}
                    <span style={{ fontFamily: MONOF, textAlign: "right", color: C.faint }}>{it.safeStock ?? "—"}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                      <button onClick={() => setQty(q2 => ({ ...q2, [it.id]: Math.max(0, (Number(q2[it.id]) || 0) - 1) || "" }))} style={{ width: 24, height: 24, border: `1px solid ${C.line}`, background: "#fff", borderRadius: 6, cursor: "pointer", color: C.sub }}>−</button>
                      <input value={qv} onChange={e => setQty(q2 => ({ ...q2, [it.id]: e.target.value.replace(/[^0-9.]/g, "") }))} inputMode="decimal" placeholder="0" style={{ ...inp, width: 52, textAlign: "center", padding: "4px 4px", fontFamily: MONOF }} />
                      <button onClick={() => setQty(q2 => ({ ...q2, [it.id]: (Number(q2[it.id]) || 0) + 1 }))} style={{ width: 24, height: 24, border: `1px solid ${C.line}`, background: "#fff", borderRadius: 6, cursor: "pointer", color: C.sub }}>＋</button>
                    </div>
                    {showMoney && <span style={{ fontFamily: MONOF, textAlign: "right", fontWeight: 700, color: Number(qv) > 0 ? C.accent : "#d5cbb6" }}>{Number(qv) > 0 && it.price ? (Math.round(Number(qv) * Number(it.price) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {/* 本月對帳彙總 */}
        {showMoney && Object.keys(byVendor).length > 0 && (
          <div style={{ ...box, padding: "10px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>📅 本月叫貨彙總（{moNow}・月底對帳用）</div>
            {Object.entries(byVendor).sort((a, b) => b[1].amt - a[1].amt).map(([vn, o]) => (
              <div key={vn} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 28, borderTop: `1px solid #f0ead9`, fontSize: 12.5 }}>
                <span style={{ fontWeight: 700, color: C.text, width: 120 }}>{vn}</span>
                <span style={{ color: C.faint, fontSize: 11.5 }}>{o.n} 張單</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: MONOF, fontWeight: 700, color: C.text }}>{nt2(o.amt)}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32, borderTop: `1.5px solid ${C.hard}`, fontSize: 13 }}>
              <span style={{ fontWeight: 800, color: C.accent }}>本月總計</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: MONOF, fontWeight: 800, fontSize: 15, color: C.accent }}>{nt2(Object.values(byVendor).reduce((t, o) => t + o.amt, 0))}</span>
            </div>
          </div>
        )}
        {/* 叫貨紀錄 */}
        {orders.length > 0 && (
          <div style={{ ...box, padding: "10px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>🧾 叫貨紀錄 <span style={{ fontWeight: 400, fontSize: 11, color: C.faint }}>點列看貨單完整明細</span></div>
            {orders.slice(0, 15).map(od => (
              <div key={od.id} onClick={() => setOdSel(od.id)} style={{ display: "grid", gridTemplateColumns: `108px minmax(90px,0.8fr) 56px minmax(150px,1.4fr) ${showMoney ? "90px " : ""}88px 110px 30px`, gap: 8, alignItems: "center", minHeight: 32, borderTop: `1px solid #f0ead9`, fontSize: 12, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = C.soft} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ fontFamily: MONOF, fontSize: 11, color: C.sub }}>{new Date(od.ts).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <span style={{ fontWeight: 700, color: C.text }}>{od.vendorName}</span>
                <span style={{ color: C.sub }}>{od.items.length} 項</span>
                <span style={{ color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={od.items.map(x => `${x.name}×${x.qty}`).join("、")}>{od.items.map(x => `${x.name}×${x.qty}`).join("、")}</span>
                {showMoney && <span style={{ fontFamily: MONOF, textAlign: "right", color: orderTotal(od) ? C.text : "#d5cbb6" }}>{orderTotal(od) ? "NT$" + Math.round(orderTotal(od)).toLocaleString() : "—"}</span>}
                <span style={{ fontSize: 10.5, color: C.faint }}>{od.via}</span>
                <select onClick={e => e.stopPropagation()} value={od.status} onChange={e => saveOrders(orders.map(x => x.id === od.id ? { ...x, status: e.target.value } : x))} disabled={!canEdit} style={{ ...inp, padding: "3px 6px", fontSize: 11.5, color: od.status === "已到貨" ? C.green : od.status === "廠商已確認" ? C.blue : C.text }}>{ST.map(x => <option key={x}>{x}</option>)}</select>
                {canEdit ? <button onClick={async (e) => { e.stopPropagation(); if (await confirm("刪除這筆叫貨紀錄？", { confirmLabel: "刪除" })) saveOrders(orders.filter(x => x.id !== od.id)); }} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer" }}>×</button> : <span />}
              </div>
            ))}
          </div>
        )}
        {/* 貨單詳細（月底對帳） */}
        {odDetail && (
          <div onClick={e => e.target === e.currentTarget && setOdSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 710, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 22, width: "min(560px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>貨單明細：{odDetail.vendorName}</div>
                <span style={{ fontSize: 11, color: "#fff", background: odDetail.status === "已到貨" ? C.green : odDetail.status === "廠商已確認" ? C.blue : C.amber, borderRadius: 9, padding: "1px 8px", fontWeight: 700 }}>{odDetail.status}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setOdSel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
              </div>
              <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10 }}>
                {new Date(odDetail.ts).toLocaleString("zh-TW")}・{odDetail.via}{odDetail.needDate ? "・希望到貨 " + dz(odDetail.needDate) : ""}・{odDetail.dept}
              </div>
              <div style={{ border: `1.5px solid ${C.hard}`, borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: `minmax(150px,1.4fr) minmax(90px,1fr) 60px ${showMoney ? "76px 86px" : ""}`, gap: 8, background: "#ece4d6", padding: "6px 10px", fontSize: 10.5, color: C.sub, fontWeight: 700 }}>
                  <span>品名</span><span>規格</span><span style={{ textAlign: "right" }}>數量</span>{showMoney && <><span style={{ textAlign: "right" }}>單價</span><span style={{ textAlign: "right" }}>小計</span></>}
                </div>
                {odDetail.items.map((x, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: `minmax(150px,1.4fr) minmax(90px,1fr) 60px ${showMoney ? "76px 86px" : ""}`, gap: 8, padding: "5px 10px", borderTop: `1px solid #f0ead9`, fontSize: 12.5, alignItems: "center", background: i % 2 ? "#f8f4ea" : "#fff" }}>
                    <span style={{ fontWeight: 600, color: C.text }}>{x.name}</span>
                    <span style={{ color: C.sub, fontSize: 11.5 }}>{x.spec || "—"}</span>
                    <span style={{ fontFamily: MONOF, textAlign: "right" }}>{x.qty} {x.unit || ""}</span>
                    {showMoney && <><span style={{ fontFamily: MONOF, textAlign: "right", color: C.sub }}>{x.price ? Number(x.price).toLocaleString() : "—"}</span>
                    <span style={{ fontFamily: MONOF, textAlign: "right", fontWeight: 700 }}>{x.price ? (Math.round(Number(x.price) * x.qty * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</span></>}
                  </div>
                ))}
                {showMoney && <div style={{ display: "flex", padding: "7px 10px", borderTop: `1.5px solid ${C.hard}`, fontSize: 13, alignItems: "center" }}>
                  <span style={{ fontWeight: 800, color: C.accent }}>總金額</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONOF, fontWeight: 800, fontSize: 15, color: C.accent }}>{nt2(orderTotal(odDetail))}</span>
                </div>}
              </div>
              {showMoney && <button onClick={async () => {
                const txt = `【對帳明細】${odDetail.vendorName} ${new Date(odDetail.ts).toLocaleDateString("zh-TW")}\n` + odDetail.items.map(x => `${x.name} ${x.spec || ""} ×${x.qty}${x.unit || ""} @${x.price || "?"} = ${x.price ? (Math.round(Number(x.price) * x.qty * 100) / 100).toLocaleString() : "?"}`).join("\n") + `\n總金額 ${nt2(orderTotal(odDetail))}`;
                try { await navigator.clipboard.writeText(txt); flash("✓ 已複製對帳明細（含單價，內部用）"); } catch (_) {}
                setOdSel(null);
              }} style={{ width: "100%", marginTop: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.text, borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📋 複製對帳明細（含金額）</button>}
            </div>
          </div>
        )}
        {/* 叫貨單預覽 + 發送 */}
        {pv && (() => {
          const text = orderText(pv);
          const glist = Object.entries(groups || {}).filter(([gid, g]) => gid.startsWith("C") && g && g.name); // 只列有名稱的群（濾掉亂碼/個人ID）
          const doSend = async () => {
            if (!pv.lineGroupId) { alert("還沒綁定群組——請先在下面選擇 D 要發到哪個群。"); return; }
            const gname = (groups[pv.lineGroupId] || {}).name || pv.lineGroupId;
            if (!(await confirm(`確定把叫貨單發送到「${gname}」？（對外訊息，發出去就收不回）`, { confirmLabel: "發送" }))) return;
            try {
              const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": "ground-pm-2026-secret-abc123" }, body: JSON.stringify({ to: pv.lineGroupId, messages: [orderFlex(pv)] }) });
              const d = await r.json();
              if (!d.ok) { alert(/monthly limit/i.test(d.error || "") ? "LINE 推播月額度用完了（輕用量 200 則/月，每月 1 號重置）。\n這單先按「複製文字」貼給廠商；常用的話可考慮升級 LINE 方案。" : "發送失敗：" + (d.error || "未知")); return; }
              recordOrder(pv, "D發群", "已送出", text); flash("✓ 已由 D哥 發送到「" + gname + "」，叫貨單已記錄");
            } catch (e) { alert("發送失敗：" + e.message); }
          };
          return (
            <div onClick={e => e.target === e.currentTarget && setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 22, width: "min(520px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>叫貨單預覽：{pv.name}</div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setPreview(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
                </div>
                <pre style={{ background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: "pre-wrap", fontFamily: "'Noto Sans TC',sans-serif", color: C.text, margin: 0 }}>{text}</pre>
                <div style={{ fontSize: 11, color: C.faint, margin: "8px 0" }}>叫貨單含單價與合計，方便廠商一起核對金額（價格有調整馬上會發現）。</div>
                {/* D 群綁定 */}
                <div style={{ margin: "10px 0" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 4 }}>D哥 發送目標群（要先把 D 拉進該廠商的 LINE 群，群才會出現在這裡）</div>
                  <select value={pv.lineGroupId || ""} onChange={e => updV(pv.id, { lineGroupId: e.target.value, sendMode: e.target.value ? "dbot" : pv.sendMode })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>
                    <option value="">— 未綁定（用下面的 LINE 分享 / 複製）—</option>
                    {glist.map(([gid, g]) => <option key={gid} value={gid}>{(g && g.name) || gid}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={doSend} style={{ flex: 1, border: "none", background: pv.lineGroupId ? C.green : "#d5cbb6", color: "#fff", borderRadius: 8, padding: "10px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>🤖 D哥 發送到群</button>
                  <button onClick={async () => {
                    try { await navigator.clipboard.writeText(text); } catch (_) {}
                    const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
                    recordOrder(pv, mobile ? "LINE分享" : "複製", "已送出", text);
                    if (mobile) window.open("https://line.me/R/share?text=" + encodeURIComponent(text));
                    else flash("💻 桌機不支援 LINE 分享選單——已自動複製叫貨單，打開 LINE 貼給廠商即可（用手機開 App 按這顆才會跳選聊天室）");
                  }} style={{ flex: 1, border: "none", background: "#06C755", color: "#fff", borderRadius: 8, padding: "10px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>📱 LINE 分享</button>
                  <button onClick={async () => { try { await navigator.clipboard.writeText(text); } catch (_) {} recordOrder(pv, "複製", "已送出", text); flash("✓ 已複製叫貨單文字，貼到廠商聊天室即可"); }} style={{ flex: 1, border: `1px solid ${C.line}`, background: "#fff", color: C.text, borderRadius: 8, padding: "10px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>📋 複製文字</button>
                </div>
                <button onClick={() => recordOrder(pv, "草稿", "草稿", text)} style={{ width: "100%", marginTop: 8, border: `1.5px dashed ${C.line}`, background: "transparent", color: C.sub, borderRadius: 8, padding: "7px 0", fontSize: 12.5, cursor: "pointer" }}>先存草稿不發送</button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ── 廠商（完整版）：可新增/編輯廠商（部門/標籤/LINE群），展開管理該廠商品項清單 ──
  if (view === "svendors") {
    const DEPTS = ["外場", "內場", "吧檯", "共用"];
    const vs = (db.vendors || []).filter(v => !q.trim() || (v.name + (v.en || "") + (v.tags || []).join("") + (v.note || "") + (v.dept || "")).toLowerCase().includes(q.trim().toLowerCase()))
      .filter(v => !catF || (v.dept || "共用") === catF);
    const itemsOf = (vid) => (db.vendorItems || []).filter(x => x.vendor_id === vid).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const addVendor = () => { if (!canEdit) return; const nv = { id: rid("v"), name: "", en: "", dept: "外場", url: "", tags: [], note: "", lineGroupId: "", sendMode: "share", sort: (db.vendors || []).length }; save({ vendors: [...db.vendors, nv] }); setSel("v:" + nv.id); };
    const updV = (id, fp) => save({ vendors: db.vendors.map(x => x.id === id ? { ...x, ...fp } : x) });
    const addItem = (vid) => { if (!canEdit) return; const ni = { id: rid("vi"), vendor_id: vid, name: "", spec: "", unit: "件", price: "", safeStock: "", sort: itemsOf(vid).length }; save({ vendorItems: [...(db.vendorItems || []), ni] }); setSel("i:" + ni.id); };
    const updI = (id, fp) => save({ vendorItems: (db.vendorItems || []).map(x => x.id === id ? { ...x, ...fp } : x) });
    const selV = sel && sel.startsWith("v:") && db.vendors.find(x => x.id === sel.slice(2));
    const selI = sel && sel.startsWith("i:") && (db.vendorItems || []).find(x => x.id === sel.slice(2));
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
          <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>廠商</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>供應商與品項</div>
            <div style={{ fontSize: 11, color: C.faint }}>{(db.vendors || []).length} 家・叫貨品項 {(db.vendorItems || []).length} 項・點廠商列展開品項清單</div>
          </div>
          <div style={{ flex: 1 }} />
          <select value={catF} onChange={e => setCatF(e.target.value)} style={inp}><option value="">全部部門</option>{DEPTS.map(d => <option key={d} value={d}>{d}</option>)}</select>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋廠商/標籤…" style={{ ...inp, width: 180 }} />
          {canEdit && btn("＋ 新增廠商", addVendor, { background: C.accent, color: "#fff", borderColor: C.accent })}
        </div>
        <div style={box}>
          {vs.map((v, i) => {
            const open = collapsed["v" + v.id];
            const its = itemsOf(v.id);
            return (
              <React.Fragment key={v.id}>
                <div onClick={() => setCollapsed(c2 => ({ ...c2, ["v" + v.id]: !c2["v" + v.id] }))}
                  style={{ display: "grid", gridTemplateColumns: "18px minmax(150px,1fr) 64px 56px minmax(160px,1.4fr) minmax(140px,1.2fr) 120px", gap: 8, alignItems: "center", minHeight: 44, borderTop: i ? `1px solid #f0ead9` : "none", padding: "4px 10px", cursor: "pointer", background: open ? C.soft : "#fff" }}
                  onMouseEnter={e => e.currentTarget.style.background = C.soft} onMouseLeave={e => e.currentTarget.style.background = open ? C.soft : "#fff"}>
                  <span style={{ fontSize: 10, color: C.faint }}>{open ? "▾" : "▸"}</span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{v.name || "（未命名）"}</div>
                    <div style={{ fontSize: 10.5, color: C.faint }}>{v.en}</div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: v.dept === "內場" ? C.green : v.dept === "吧檯" ? C.amber : v.dept === "共用" ? "#9b9384" : C.blue, borderRadius: 9, padding: "2px 8px", textAlign: "center" }}>{v.dept || "共用"}</span>
                  <span style={{ fontFamily: MONOF, fontSize: 12, color: its.length ? C.text : "#d5cbb6", textAlign: "center" }}>{its.length ? its.length + "項" : "—"}</span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{(v.tags || []).slice(0, 4).map(t => <span key={t} style={{ fontSize: 10, color: C.sub, background: C.soft, border: `1px solid ${C.line}`, borderRadius: 9, padding: "0 7px" }}>{t}</span>)}</div>
                  <div style={{ fontSize: 11, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.note}>{v.note}</div>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                    {v.url && <a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.blue }}>官網↗</a>}
                    {canEdit && <button onClick={() => setSel("v:" + v.id)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 6, padding: "2px 9px", fontSize: 11, cursor: "pointer" }}>✎ 編輯</button>}
                  </div>
                </div>
                {open && (
                  <div style={{ background: "#faf6ec", borderTop: `1px solid #f0ead9`, padding: "6px 12px 10px 36px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: `minmax(170px,1.4fr) minmax(120px,1fr) 64px ${showMoney ? "84px " : ""}80px 60px`, gap: 8, padding: "4px 0", fontSize: 10, color: C.faint, fontWeight: 700 }}>
                      <span>品名</span><span>規格</span><span>單位</span>{showMoney && <span style={{ textAlign: "right" }}>單價</span>}<span style={{ textAlign: "right" }}>安全庫存</span><span />
                    </div>
                    {its.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: "4px 0" }}>還沒有品項——按下面「＋品項」建立這家的叫貨清單。</div>}
                    {its.map(it => (
                      <div key={it.id} style={{ display: "grid", gridTemplateColumns: `minmax(170px,1.4fr) minmax(120px,1fr) 64px ${showMoney ? "84px " : ""}80px 60px`, gap: 8, alignItems: "center", minHeight: 30, borderTop: `1px solid #f0ead9`, fontSize: 12.5 }}>
                        <span style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name || "（未命名）"}</span>
                        <span style={{ color: C.sub, fontSize: 11.5 }}>{it.spec || "—"}</span>
                        <span style={{ color: C.sub }}>{it.unit || "—"}</span>
                        {showMoney && <span style={{ fontFamily: MONOF, textAlign: "right", color: it.price ? C.text : "#d5cbb6" }}>{it.price ? Number(it.price).toLocaleString() : "—"}</span>}
                        <span style={{ fontFamily: MONOF, textAlign: "right", color: it.safeStock !== "" && it.safeStock != null ? C.sub : "#d5cbb6" }}>{it.safeStock !== "" && it.safeStock != null ? it.safeStock : "—"}</span>
                        {canEdit ? <button onClick={() => setSel("i:" + it.id)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 6, padding: "1px 8px", fontSize: 11, cursor: "pointer" }}>✎</button> : <span />}
                      </div>
                    ))}
                    {canEdit && <button onClick={() => addItem(v.id)} style={{ marginTop: 8, border: `1.5px dashed ${C.line}`, background: "transparent", color: C.accent, borderRadius: 7, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>＋ 品項</button>}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
        {/* 廠商編輯 */}
        {selV && (
          <div onClick={e => e.target === e.currentTarget && setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 22, width: "min(560px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>廠商{selV.name ? `：${selV.name}` : ""}</div>
                <div style={{ flex: 1 }} />
                {canEdit && <button onClick={async () => { if (await confirm(`刪除「${selV.name || "未命名"}」及其 ${itemsOf(selV.id).length} 個品項？`, { confirmLabel: "刪除" })) { save({ vendors: db.vendors.filter(x => x.id !== selV.id), vendorItems: (db.vendorItems || []).filter(x => x.vendor_id !== selV.id) }); setSel(null); } }} style={{ background: "none", border: `1px solid ${C.line}`, color: C.red, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer", marginRight: 8 }}>刪除</button>}
                <button onClick={() => setSel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[["name", "廠商名稱"], ["en", "英文/簡稱"], ["url", "官網/訂購網址"]].map(([k, l]) => (
                  <label key={k} style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600, gridColumn: k === "url" ? "1 / -1" : undefined }}>{l}
                    <input value={selV[k] ?? ""} onChange={e => updV(selV.id, { [k]: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }} />
                  </label>
                ))}
                <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600 }}>部門
                  <select value={selV.dept || "共用"} onChange={e => updV(selV.id, { dept: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }}>{DEPTS.map(d => <option key={d}>{d}</option>)}</select>
                </label>
                <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600 }}>叫貨發送方式
                  <select value={selV.sendMode || "share"} onChange={e => updV(selV.id, { sendMode: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }}>
                    <option value="share">LINE 分享（廠商是官方帳號/1:1）</option>
                    <option value="dbot">D哥 自動發群（D 已在廠商群）</option>
                    <option value="copy">複製文字</option>
                  </select>
                </label>
                <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600, gridColumn: "1 / -1" }}>標籤（逗號分隔）
                  <input value={(selV.tags || []).join(",")} onChange={e => updV(selV.id, { tags: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }} />
                </label>
                <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600, gridColumn: "1 / -1" }}>備註
                  <input value={selV.note ?? ""} onChange={e => updV(selV.id, { note: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }} />
                </label>
              </div>
            </div>
          </div>
        )}
        {/* 品項編輯 */}
        {selI && (
          <div onClick={e => e.target === e.currentTarget && setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 22, width: "min(480px,96vw)" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>品項{selI.name ? `：${selI.name}` : ""} <span style={{ fontSize: 11, color: C.faint, fontWeight: 400 }}>（{(db.vendors.find(v => v.id === selI.vendor_id) || {}).name}）</span></div>
                <div style={{ flex: 1 }} />
                {canEdit && <button onClick={async () => { if (await confirm(`刪除品項「${selI.name || "未命名"}」？`, { confirmLabel: "刪除" })) { save({ vendorItems: (db.vendorItems || []).filter(x => x.id !== selI.id) }); setSel(null); } }} style={{ background: "none", border: `1px solid ${C.line}`, color: C.red, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer", marginRight: 8 }}>刪除</button>}
                <button onClick={() => setSel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[["name", "品名", "1 / -1"], ["spec", "規格（例：2500入/箱）", "1 / -1"], ["unit", "單位（箱/件/包）"], ...(showMoney ? [["price", "單價"]] : []), ["safeStock", "安全庫存量"]].map(([k, l, span]) => (
                  <label key={k} style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600, gridColumn: span }}>{l}
                    <input value={selI[k] ?? ""} onChange={e => updI(selI.id, { [k]: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }} />
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
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
