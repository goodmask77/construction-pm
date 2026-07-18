// 供應鏈空間（P1）：產品管理（完整）＋物料主檔（進銷存地基）＋廠商＋叫貨
// 資料：sp_supply_pm_supply（categories/products/materials/vendors/vendorItems/ingredients/matches/productPackaging）
// 進銷存藍圖見 docs/INVENTORY_BLUEPRINT.md：物料↔貨源多對一、進價/報價/食譜全存流水、成本只用實付價
import React, { useEffect, useState } from "react";
import IngredientsView from "./Ingredients.jsx";
import RecipeCard from "./Recipe.jsx";
import { buildPriceEvents, applyLastPaid, applyQuote, priceAlert, unitCost, quoteUnit, packToBase, srcsOf, lastPaid } from "./inv.js";

export const C = {
  text: "#1d1a15", sub: "#5a5247", faint: "#9b9384", line: "#d9cfbd", hard: "#c8bca6",
  card: "#fbf8f1", soft: "#f4efe5", accent: "#c4582a", blue: "#3a6ea5", green: "#3f7d4e", red: "#b3261e", amber: "#c98a14",
};
export const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
export const rid = (p) => p + Math.random().toString(36).slice(2, 8);
const fmt$ = (v) => { const n = Number(String(v).replace(/[^0-9.-]/g, "")); return isNaN(n) || v === "" ? "" : "NT$" + Math.round(n).toLocaleString(); };

export default function SupplyView({ view, K, canEdit, confirm, showMoney, userName }) {
  const [db, setDb] = useState(null);
  const [q, setQ] = useState("");
  const [catF, setCatF] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [tagF, setTagF] = useState("");
  const [flat, setFlat] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [dragV, setDragV] = useState(null); // 拖曳中的廠商 id
  const [dragI, setDragI] = useState(null); // 拖曳中的品項 id
  const [sel, setSel] = useState(null); // 產品詳情
  const [msg, setMsg] = useState(null);
  const [orders, setOrders] = useState([]);   // 叫貨單紀錄（sp_supply_pm_orders）
  const [qty, setQty] = useState({});          // 叫貨數量 itemId→qty
  const [needDate, setNeedDate] = useState(""); // 希望到貨日
  const [preview, setPreview] = useState(null); // 叫貨單預覽 vendorId
  const [odSel, setOdSel] = useState(null);      // 叫貨紀錄詳情 orderId
  const [oq, setOq] = useState("");              // 叫貨表搜尋（品項/標籤，比價用）
  const [inspEdit, setInspEdit] = useState(false); // 驗收選項編輯器（新增/改名/刪除/排序）
  const [fuTxt, setFuTxt] = useState({});        // 問題追蹤：後續紀錄輸入框（odId:idx → 文字）
  const [oTab, setOTab] = useState("order");     // 叫貨頁子分頁：order=下單 / rec=紀錄・對帳 / issue=問題追蹤
  const [moSel2, setMoSel2] = useState("");      // 紀錄・對帳：月份篩選（空=本月）
  const [vF, setVF] = useState("");              // 紀錄・對帳：廠商篩選
  const [qv2, setQv2] = useState({});            // 報價分頁：輸入中的報價（viId → 文字，離開欄位才寫入流水）
  const [groups, setGroups] = useState({});     // DD看過的LINE群（pm_group_seen，發送綁定用）
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? null : m)), 6000); };

  useEffect(() => { (async () => {
    try { const v = await window.storage.get(K("pm_supply"), true); setDb(v && v.value ? JSON.parse(v.value) : { categories: [], products: [], materials: [], vendors: [], vendorItems: [], ingredients: [], matches: [], productPackaging: [] }); } catch (_) { setDb({ categories: [], products: [], materials: [], vendors: [], vendorItems: [], ingredients: [], matches: [], productPackaging: [] }); }
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

  // ── 物料清單（進銷存中控台）：物料主檔＋盤點頻率＋貨源歸戶＋比價 ──
  if (view === "singred") return <IngredientsView db={db} save={save} canEdit={canEdit} showMoney={showMoney} confirm={confirm} flash={flash} />;

  // ── 叫貨：依廠商勾數量 → 叫貨單 → D自動發群 / LINE分享 / 複製 → 紀錄可追狀態 ──
  if (view === "sorder") {
    const DEPTS = ["外場", "內場", "吧檯", "共用"];
    const itemsOf = (vid) => (db.vendorItems || []).filter(x => x.vendor_id === vid).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    // 搜尋：品名/規格/分類/標籤都比對（跨廠商找同類品項好比價）
    const qq = oq.trim().toLowerCase();
    const matchIt = (it) => !qq || `${it.name || ""} ${it.spec || ""} ${it.grp || ""} ${it.tags || ""}`.toLowerCase().includes(qq);
    const shownOf = (vid) => itemsOf(vid).filter(matchIt);
    // 只列「正式供應商」（廠商頁名稱前打勾）
    const vlist = (db.vendors || []).filter(v => v.official).filter(v => shownOf(v.id).length).filter(v => !catF || (v.dept || "共用") === catF);
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
      saveOrders([od, ...orders].slice(0, 600)); // 每月約百張，留半年份可回查對帳
      const nq = { ...qty }; its.forEach(it => delete nq[it.id]); setQty(nq);
      setPreview(null);
    };
    const pv = preview && db.vendors.find(v => v.id === preview);
    const orderTotal = (od) => od.items.reduce((t, x) => t + (Number(x.price) || 0) * (x.qty || 0), 0);
    const pickTotal = (vid) => picked(vid).reduce((t, it) => t + (Number(it.price) || 0) * (Number(qty[it.id]) || 0), 0);
    const grandTotal = vlist.reduce((t, v) => t + pickTotal(v.id), 0);
    const d2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const nt2 = (n) => "NT$" + d2(n);
    const ST = ["已送出", "廠商已確認", "已到貨", "有問題", "草稿"];
    // 紀錄・對帳：可選月份（預設本月）＋廠商篩選；彙總不含草稿、紀錄含草稿（草稿要能補發）
    const moNow = new Date().toISOString().slice(0, 7);
    const mo2 = moSel2 || moNow;
    const moList = [...new Set([moNow, ...orders.map(od => (od.ts || "").slice(0, 7)).filter(Boolean)])].sort().reverse();
    const moOrders = orders.filter(od => (od.ts || "").slice(0, 7) === mo2 && od.status !== "草稿");
    const byVendor = {};
    moOrders.forEach(od => { const o = byVendor[od.vendorName] = byVendor[od.vendorName] || { n: 0, amt: 0 }; o.n++; o.amt += orderTotal(od); });
    const recVendors = [...new Set(orders.filter(od => (od.ts || "").slice(0, 7) === mo2).map(od => od.vendorName))].sort((a, b) => a.localeCompare(b, "zh-TW"));
    const recOrders = orders.filter(od => (od.ts || "").slice(0, 7) === mo2).filter(od => !vF || od.vendorName === vF);
    // 問題追蹤未解決數（分頁徽章用；明細在問題追蹤分頁內計算）
    const okOptB = (db.inspectOpts || ["✓ 正確"])[0];
    let openIssueN = 0;
    orders.forEach(od => { const chk = od.check; if (!chk || !chk.items) return; od.items.forEach((_, i) => { const ci = chk.items[i]; if (ci && ci.st && ci.st !== okOptB && ((ci.fu && ci.fu.st) || "待處理") !== "已解決") openIssueN++; }); });
    const odDetail = odSel && orders.find(x => x.id === odSel);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 8px", flexWrap: "wrap" }}>
          <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>叫貨</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>叫貨</div>
            <div style={{ fontSize: 11, color: C.faint }}>{oTab === "order" ? "點廠商名展開品項 → 填數量 → 產生叫貨單 → 發送。只列正式供應商（廠商頁名稱前打勾）。" : oTab === "quote" ? "key 各家今日報價 → 自動換算同單位、最低標綠 → 勾本次跟誰叫 → 帶入下單。報價只供比價，成本一律用驗收實付價。" : oTab === "rec" ? "彙總＋逐張紀錄放一起，可選月份、篩廠商，月底對帳用。" : "驗收有問題的品項自動集中在這裡，追到解決為止。"}</div>
          </div>
          <div style={{ flex: 1 }} />
          {oTab === "order" && <>
            <input value={oq} onChange={e => setOq(e.target.value)} placeholder="🔍 搜尋品項/標籤（比價）" style={{ ...inp, width: 180 }} />
            {DEPTS.map(d => <button key={d} onClick={() => setCatF(catF === d ? "" : d)} style={{ border: `1.5px solid ${catF === d ? C.accent : C.line}`, background: catF === d ? C.accent : "#fff", color: catF === d ? "#fff" : C.sub, borderRadius: 12, padding: "3px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{d}</button>)}
            <label style={{ fontSize: 11.5, color: C.sub, display: "flex", alignItems: "center", gap: 5 }}>希望到貨
              <input type="date" value={needDate} onChange={e => setNeedDate(e.target.value)} style={{ ...inp, colorScheme: "light" }} />
            </label>
            {showMoney && grandTotal > 0 && <span style={{ fontFamily: MONOF, fontSize: 15, fontWeight: 800, color: C.accent, background: "#fbeee6", border: `1.5px solid ${C.accent}`, borderRadius: 8, padding: "5px 14px" }}>本次總計 {nt2(grandTotal)}</span>}
          </>}
        </div>
        {/* 子分頁：下單 / 紀錄・對帳 / 問題追蹤（未解決數掛紅徽章） */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: `1.5px solid ${C.hard}` }}>
          {[["order", "📝 下單", 0], ["quote", "💰 報價", 0], ["rec", "🧾 紀錄・對帳", 0], ["issue", "🚩 問題追蹤", openIssueN]].map(([k, lb, n]) => (
            <button key={k} onClick={() => setOTab(k)} style={{ border: "none", borderBottom: `2.5px solid ${oTab === k ? C.accent : "transparent"}`, marginBottom: -1.5, background: "none", color: oTab === k ? C.text : C.sub, padding: "7px 14px", fontSize: 13, fontWeight: oTab === k ? 800 : 600, cursor: "pointer" }}>
              {lb}{n > 0 && <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 700, color: "#fff", background: C.red, borderRadius: 9, padding: "1px 7px" }}>{n}</span>}
            </button>
          ))}
        </div>
        {msg && <div style={{ background: "#eef5ef", border: `1.5px solid ${C.green}`, borderRadius: 8, padding: "7px 12px", marginBottom: 10, fontSize: 12.5, color: "#2c5a38", fontWeight: 600 }}>{msg}</div>}
        {/* ── 分頁1：下單（廠商預設收合，點開才展品項；搜尋/已選數量自動展開） ── */}
        {oTab === "order" && <>
        {vlist.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10 }}>{qq ? "沒有符合的品項/標籤——換個關鍵字試試。" : "還沒有可叫貨的正式供應商——到「廠商」頁在廠商名稱前打勾（正式供應商），並建好品項清單。"}</div>}
        {vlist.map(v => {
          const its = shownOf(v.id); const pk = picked(v.id);
          const open = qq ? true : (collapsed["ov" + v.id] !== undefined ? !!collapsed["ov" + v.id] : pk.length > 0); // 預設收合；搜尋中/已選數量自動展開
          return (
            <div key={v.id} style={{ ...box, marginBottom: 8 }}>
              <div onClick={() => setCollapsed(c2 => ({ ...c2, ["ov" + v.id]: !open }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#ece4d6", cursor: "pointer" }}>
                <span style={{ fontSize: 10, color: C.faint }}>{open ? "▾" : "▸"}</span>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{v.name}</span>
                <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{its.length} 項</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: v.dept === "內場" ? C.green : v.dept === "吧檯" ? C.amber : v.dept === "共用" ? "#9b9384" : C.blue, borderRadius: 9, padding: "1px 8px" }}>{v.dept || "共用"}</span>
                <span style={{ fontSize: 11, color: C.faint }}>{v.sendMode === "dbot" ? (v.lineGroupId ? "D自動發群 ✓已綁定" : "D自動發群 ⚠未綁定群") : v.sendMode === "copy" ? "複製文字" : "LINE分享"}</span>
                <div style={{ flex: 1 }} />
                {pk.length > 0 && <span style={{ fontFamily: MONOF, fontSize: 12, color: C.accent, fontWeight: 700 }}>已選 {pk.length} 項{showMoney ? "・" + nt2(pickTotal(v.id)) : ""}</span>}
                <button disabled={!pk.length} onClick={e => { e.stopPropagation(); setPreview(v.id); }} style={{ border: "none", background: pk.length ? C.accent : "#d5cbb6", color: "#fff", borderRadius: 7, padding: "6px 16px", fontSize: 12.5, fontWeight: 700, cursor: pk.length ? "pointer" : "default" }}>產生叫貨單</button>
              </div>
              {open && <>
              <div style={{ display: "grid", gridTemplateColumns: `minmax(170px,1.4fr) minmax(110px,1fr) 56px ${showMoney ? "76px " : ""}70px 130px${showMoney ? " 86px" : ""}`, gap: 8, padding: "4px 12px", fontSize: 10, color: C.faint, fontWeight: 700, borderBottom: `1px solid #f0ead9` }}>
                <span>品名</span><span>規格</span><span>單位</span>{showMoney && <span style={{ textAlign: "right" }}>單價</span>}<span style={{ textAlign: "right" }}>安全庫存</span><span style={{ textAlign: "center" }}>叫貨量</span>{showMoney && <span style={{ textAlign: "right" }}>小計</span>}
              </div>
              {its.map(it => {
                const qv = qty[it.id] || "";
                return (
                  <div key={it.id} style={{ display: "grid", gridTemplateColumns: `minmax(170px,1.4fr) minmax(110px,1fr) 56px ${showMoney ? "76px " : ""}70px 130px${showMoney ? " 86px" : ""}`, gap: 8, alignItems: "center", minHeight: 34, borderTop: `1px solid #f0ead9`, padding: "0 12px", background: Number(qv) > 0 ? "#fbeee6" : "#fff", fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}{it.tags ? <span style={{ fontSize: 9.5, fontWeight: 600, color: C.amber, marginLeft: 5 }}>{String(it.tags).split(/[,，\s]+/).filter(Boolean).map(t => "#" + t).join(" ")}</span> : null}</span>
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
              </>}
            </div>
          );
        })}
        </>}
        {/* ── 分頁2：報價比價（物料×貨源矩陣；key 報價→寫 pm_quote_ 流水＋quote 快取；成本永遠不用報價） ── */}
        {oTab === "quote" && (() => {
          const ingsQ = (db.ingredients || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(g => ({ g, srcs: srcsOf(db, g.id) })).filter(x => x.srcs.length > 0);
          const vname2 = (vid) => ((db.vendors || []).find(v => v.id === vid) || {}).name || "—";
          const commitQuote = (vi) => {
            const raw = qv2[vi.id]; if (raw === undefined) return;
            const price = Number(raw);
            if (!(price > 0) || price === Number(vi.quote && vi.quote.price)) { setQv2(q3 => { const n = { ...q3 }; delete n[vi.id]; return n; }); return; }
            const ts3 = new Date().toISOString();
            const ev = { id: rid("qt"), ts: ts3, date: ts3.slice(0, 10), ingredient_id: vi.ingredient_id || "", vendor_item_id: vi.id, vendor_id: vi.vendor_id, price, by: userName || "—" };
            window.storage.set(K("pm_quote_" + ev.id), JSON.stringify(ev), true).catch(() => {});
            save({ vendorItems: applyQuote(db.vendorItems || [], vi.id, price, ts3) });
            setQv2(q3 => { const n = { ...q3 }; delete n[vi.id]; return n; });
            flash(`✓ 已記報價：${vname2(vi.vendor_id)} ${vi.name} $${price}（存流水，不覆蓋歷史）`);
          };
          const picked2 = ingsQ.filter(x => x.g.pickVi && x.srcs.some(vi => vi.id === x.g.pickVi));
          const goOrder = () => {
            const vids = [...new Set(picked2.map(x => x.srcs.find(vi => vi.id === x.g.pickVi).vendor_id))];
            setCollapsed(c2 => { const n = { ...c2 }; vids.forEach(vid => { n["ov" + vid] = true; }); return n; });
            setOTab("order");
            flash("✓ 已展開 " + vids.map(vname2).join("、") + "——到各廠商填數量產生叫貨單");
          };
          if (!ingsQ.length) return <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10 }}>還沒有可比價的物料——先到「🥬 物料」頁建物料卡、把各廠商貨源歸戶進來。</div>;
          // 表格化：一貨源一行、物料名只標在該組第一行；限寬，畫面簡潔
          const QGRID = `minmax(72px,0.9fr) minmax(88px,1.1fr) 150px 92px 40px`;
          return (
            <div style={{ ...box, maxWidth: 700 }}>
              <div style={{ display: "grid", gridTemplateColumns: QGRID, gap: 8, padding: "6px 12px", fontSize: 10, color: C.faint, fontWeight: 700, background: "#f4efe5" }}>
                <span>物料</span><span>廠商</span><span>今日報價</span><span style={{ textAlign: "right" }}>換算單價</span><span style={{ textAlign: "center" }}>本次</span>
              </div>
              {ingsQ.map(({ g, srcs }) => {
                const cells = srcs.map(vi => {
                  const pend = qv2[vi.id];
                  const price = pend !== undefined ? Number(pend) || 0 : (vi.quote && Number(vi.quote.price)) || 0;
                  const k = packToBase(vi);
                  return { vi, price, u: price > 0 && k ? price / k : null };
                });
                const us = cells.map(c => c.u).filter(u => u != null);
                const minU = us.length ? Math.min(...us) : null;
                return cells.map(({ vi, u }, i) => {
                  const best = showMoney && u != null && minU != null && u <= minU + 1e-9 && us.length > 1;
                  const on = g.pickVi === vi.id;
                  return (
                    <div key={vi.id} style={{ display: "grid", gridTemplateColumns: QGRID, gap: 8, alignItems: "center", padding: "4px 12px", borderTop: i === 0 ? `1px solid ${C.line}` : `1px solid #f0ead9`, fontSize: 12, background: best ? "#eef5ef" : "#fff" }}>
                      <span style={{ fontWeight: 800, fontSize: 12.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i === 0 ? <>{g.isKey ? "★ " : ""}{g.name || "（未命名）"}</> : ""}</span>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`${vname2(vi.vendor_id)} ${vi.spec || ""}`}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{vname2(vi.vendor_id)}</span>
                        {vi.spec && <span style={{ fontSize: 10, color: C.faint }}>　{vi.spec}</span>}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 10.5, color: C.sub }}>$</span>
                        <input value={qv2[vi.id] !== undefined ? qv2[vi.id] : ((vi.quote && vi.quote.price) || "")} disabled={!canEdit}
                          onChange={e => setQv2(q3 => ({ ...q3, [vi.id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                          onBlur={() => commitQuote(vi)} onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()}
                          placeholder="報價" inputMode="decimal" style={{ ...inp, width: 64, padding: "3px 6px", fontFamily: MONOF, fontSize: 12 }} />
                        <span style={{ fontSize: 10.5, color: C.sub }}>/{vi.unit || "單位"}</span>
                        {vi.quote && vi.quote.ts && qv2[vi.id] === undefined && <span style={{ fontSize: 9.5, color: C.faint }}>{String(vi.quote.ts).slice(5, 10)}</span>}
                      </span>
                      <span style={{ fontFamily: MONOF, fontSize: 11, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", color: u != null ? (best ? C.green : C.sub) : (packToBase(vi) ? "#d5cbb6" : C.red) }}>
                        {showMoney ? (u != null ? `$${u >= 100 ? Math.round(u).toLocaleString() : Math.round(u * 1000) / 1000}/${g.baseUnit || "單位"}${best ? " 低" : ""}` : (packToBase(vi) ? "—" : "未設換算")) : ""}
                      </span>
                      <span style={{ textAlign: "center" }}>
                        <input type="radio" title="本次跟他叫" checked={on} disabled={!canEdit} onChange={() => save({ ingredients: (db.ingredients || []).map(x => x.id === g.id ? { ...x, pickVi: vi.id } : x) })} style={{ accentColor: C.accent, cursor: canEdit ? "pointer" : "default" }} />
                      </span>
                    </div>
                  );
                });
              })}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: `1.5px solid ${C.hard}`, background: "#faf6ec" }}>
                <span style={{ fontSize: 11.5, color: C.sub }}>已勾 {picked2.length} 項物料的本次供應商</span>
                <div style={{ flex: 1 }} />
                <button disabled={!picked2.length} onClick={goOrder} style={{ border: "none", background: picked2.length ? C.accent : "#d5cbb6", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: picked2.length ? "pointer" : "default" }}>🛒 帶入下單（展開已選廠商）</button>
              </div>
            </div>
          );
        })()}
        {/* ── 分頁3：紀錄・對帳（月份/廠商篩選 → 當月彙總＋當月全部紀錄） ── */}
        {oTab === "rec" && <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <select value={moSel2 || moNow} onChange={e => setMoSel2(e.target.value === moNow ? "" : e.target.value)} style={inp}>{moList.map(m => <option key={m} value={m}>{m}{m === moNow ? "（本月）" : ""}</option>)}</select>
          <select value={vF} onChange={e => setVF(e.target.value)} style={inp}><option value="">全部廠商</option>{recVendors.map(vn => <option key={vn}>{vn}</option>)}</select>
          <span style={{ fontSize: 11.5, color: C.faint }}>{recOrders.length} 張單</span>
        </div>
        {showMoney && Object.keys(byVendor).length > 0 && (
          <div style={{ ...box, padding: "10px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>📅 叫貨彙總（{mo2}・月底對帳用，不含草稿）</div>
            {Object.entries(byVendor).sort((a, b) => b[1].amt - a[1].amt).map(([vn, o]) => (
              <div key={vn} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 28, borderTop: `1px solid #f0ead9`, fontSize: 12.5 }}>
                <span style={{ fontWeight: 700, color: C.text, width: 120 }}>{vn}</span>
                <span style={{ color: C.faint, fontSize: 11.5 }}>{o.n} 張單</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: MONOF, fontWeight: 700, color: C.text }}>{nt2(o.amt)}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32, borderTop: `1.5px solid ${C.hard}`, fontSize: 13 }}>
              <span style={{ fontWeight: 800, color: C.accent }}>當月總計</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: MONOF, fontWeight: 800, fontSize: 15, color: C.accent }}>{nt2(Object.values(byVendor).reduce((t, o) => t + o.amt, 0))}</span>
            </div>
          </div>
        )}
        </>}
        {/* ── 分頁3：問題追蹤（驗收有問題的品項集中追到解決為止；未解決置頂、已解決收合） ── */}
        {oTab === "issue" && (() => {
          const okOpt0 = (db.inspectOpts || ["✓ 正確"])[0];
          const issues = [];
          orders.forEach(od => {
            const chk = od.check; if (!chk || !chk.items) return;
            od.items.forEach((x, i) => { const ci = chk.items[i]; if (ci && ci.st && ci.st !== okOpt0) issues.push({ od, i, x, ci }); });
          });
          if (!issues.length) return <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10 }}>目前沒有驗收問題 🎉（驗收時點到紅色選項的品項會自動列在這裡）</div>;
          const FU = ["待處理", "處理中", "已解決"];
          const stOf = (ci) => (ci.fu && ci.fu.st) || "待處理";
          const openIs = issues.filter(e => stOf(e.ci) !== "已解決");
          const doneIs = issues.filter(e => stOf(e.ci) === "已解決");
          const showDone = !!collapsed.fuDone;
          // 追蹤狀態/後續紀錄直接寫回該貨單的 check.items[i].fu（單一資料來源，跟貨單明細同步）
          const setFu = (od, i, patch, logText) => {
            saveOrders(orders.map(o => {
              if (o.id !== od.id) return o;
              const chk = o.check || { items: {} };
              const ci = chk.items[i] || {};
              const fu = { ...(ci.fu || {}), ...patch };
              if (logText) fu.log = [...(fu.log || []), { ts: new Date().toISOString(), by: userName || "—", text: logText }];
              const items2 = { ...chk.items, [i]: { ...ci, fu } };
              // 這張單所有問題都解決→狀態自動回「已到貨」；還有未解決→維持「有問題」
              const anyOpen = o.items.some((_, j) => { const c2 = items2[j]; return c2 && c2.st && c2.st !== okOpt0 && ((c2.fu && c2.fu.st) || "待處理") !== "已解決"; });
              const st2 = (o.status === "有問題" || o.status === "已到貨") ? (anyOpen ? "有問題" : "已到貨") : o.status;
              return { ...o, status: st2, check: { ...chk, items: items2 } };
            }));
          };
          const addLog = (e2) => {
            const k = e2.od.id + ":" + e2.i; const t = (fuTxt[k] || "").trim(); if (!t) return;
            setFu(e2.od, e2.i, stOf(e2.ci) === "待處理" ? { st: "處理中" } : {}, t); // 有後續紀錄＝至少「處理中」
            setFuTxt(f => ({ ...f, [k]: "" }));
          };
          const row = (e2) => {
            const { od, i, x, ci } = e2; const k = od.id + ":" + i; const fu = ci.fu || {}; const st = stOf(ci);
            const baseTs = (od.check && od.check.ts) || od.ts;
            const days = Math.max(0, Math.floor((Date.now() - new Date(baseTs).getTime()) / 86400000));
            const late = st !== "已解決" && days >= 3;
            return (
              <div key={k} style={{ borderTop: `1px solid #f0ead9`, padding: "7px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONOF, fontSize: 11, color: C.sub, width: 44 }}>{new Date(baseTs).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}</span>
                  <span onClick={() => setOdSel(od.id)} title="點開貨單明細" style={{ fontWeight: 700, color: C.blue, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>{od.vendorName}</span>
                  <span style={{ fontWeight: 600, color: C.text }}>{x.name}{x.spec ? <span style={{ fontWeight: 400, color: C.sub, fontSize: 11.5 }}>（{x.spec}）</span> : null}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: C.red, borderRadius: 9, padding: "1px 8px" }}>{ci.st}</span>
                  {ci.note && <span style={{ fontSize: 11.5, color: C.sub }}>「{ci.note}」</span>}
                  {late && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.red }}>⏰ 拖 {days} 天未解決</span>}
                  <div style={{ flex: 1 }} />
                  <span style={{ display: "flex", gap: 4 }}>
                    {FU.map(o => { const on = st === o; const isDone = o === "已解決"; return (
                      <button key={o} onClick={() => canEdit && setFu(od, i, { st: o }, on ? "" : (isDone ? "標記已解決" : ""))} disabled={!canEdit}
                        style={{ border: `1.5px solid ${on ? (isDone ? C.green : C.amber) : "#d9cfbd"}`, background: on ? (isDone ? C.green : C.amber) : "#fff", color: on ? "#fff" : C.sub, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: on ? 700 : 500, cursor: canEdit ? "pointer" : "default", whiteSpace: "nowrap" }}>{o}</button>
                    ); })}
                  </span>
                </div>
                {(fu.log || []).length > 0 && (
                  <div style={{ margin: "4px 0 0 52px" }}>
                    {(fu.log || []).map((l, li) => (
                      <div key={li} style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.7 }}>
                        <span style={{ fontFamily: MONOF, fontSize: 10.5, color: C.faint }}>{new Date(l.ts).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        <span style={{ color: C.faint }}>・{l.by}：</span>{l.text}
                      </div>
                    ))}
                  </div>
                )}
                {canEdit && st !== "已解決" && (
                  <div style={{ display: "flex", gap: 6, margin: "5px 0 0 52px" }}>
                    <input value={fuTxt[k] || ""} onChange={ev => setFuTxt(f => ({ ...f, [k]: ev.target.value }))} onKeyDown={ev => ev.key === "Enter" && addLog(e2)}
                      placeholder="後續紀錄（例：7/20 廠商說補送）→ Enter" style={{ ...inp, flex: 1, maxWidth: 420, padding: "4px 8px", fontSize: 11.5 }} />
                    <button onClick={() => addLog(e2)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "4px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>記一筆</button>
                  </div>
                )}
              </div>
            );
          };
          return (
            <div style={{ ...box, padding: "10px 14px", borderColor: openIs.length ? C.red : C.hard }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🚩 問題追蹤</span>
                {openIs.length ? <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: C.red, borderRadius: 9, padding: "1px 8px" }}>{openIs.length} 筆未解決</span>
                  : <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: C.green, borderRadius: 9, padding: "1px 8px" }}>全部解決 ✓</span>}
                <span style={{ fontSize: 11, color: C.faint }}>驗收有問題的品項自動列在這裡，追到解決為止；點廠商名可回看貨單。</span>
                <div style={{ flex: 1 }} />
                {doneIs.length > 0 && <button onClick={() => setCollapsed(c2 => ({ ...c2, fuDone: !showDone }))} style={{ border: "none", background: "none", color: C.sub, fontSize: 11.5, cursor: "pointer" }}>{showDone ? "▾" : "▸"} 已解決 {doneIs.length} 筆</button>}
              </div>
              {openIs.map(row)}
              {openIs.length === 0 && <div style={{ padding: "8px 0", fontSize: 12, color: C.faint, borderTop: `1px solid #f0ead9` }}>目前沒有未解決的問題 🎉</div>}
              {showDone && doneIs.map(row)}
            </div>
          );
        })()}
        {/* 叫貨紀錄（紀錄・對帳分頁：整月全列、跟月份/廠商篩選連動） */}
        {oTab === "rec" && recOrders.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10 }}>{mo2} 沒有{vF ? `「${vF}」的` : ""}叫貨紀錄。</div>}
        {oTab === "rec" && recOrders.length > 0 && (
          <div style={{ ...box, padding: "10px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>🧾 叫貨紀錄（{mo2}{vF ? "・" + vF : ""}） <span style={{ fontWeight: 400, fontSize: 11, color: C.faint }}>點列看貨單完整明細</span></div>
            {recOrders.map(od => (
              <div key={od.id} onClick={() => setOdSel(od.id)} style={{ display: "grid", gridTemplateColumns: `108px minmax(90px,0.8fr) 56px minmax(150px,1.4fr) ${showMoney ? "90px " : ""}88px 110px 30px`, gap: 8, alignItems: "center", minHeight: 32, borderTop: `1px solid #f0ead9`, fontSize: 12, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = C.soft} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ fontFamily: MONOF, fontSize: 11, color: C.sub }}>{new Date(od.ts).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <span style={{ fontWeight: 700, color: C.text }}>{od.vendorName}{od.check && Object.values(od.check.items || {}).some(x => x.st && x.st !== (db.inspectOpts || ["✓ 正確"])[0]) && <span title="驗收有問題" style={{ color: C.red, marginLeft: 4 }}>⚠</span>}</span>
                <span style={{ color: C.sub }}>{od.items.length} 項</span>
                <span style={{ color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={od.items.map(x => `${x.name}×${x.qty}`).join("、")}>{od.items.map(x => `${x.name}×${x.qty}`).join("、")}</span>
                {showMoney && <span style={{ fontFamily: MONOF, textAlign: "right", color: orderTotal(od) ? C.text : "#d5cbb6" }}>{orderTotal(od) ? "NT$" + Math.round(orderTotal(od)).toLocaleString() : "—"}</span>}
                <span style={{ fontSize: 10.5, color: C.faint }}>{od.via}</span>
                <select onClick={e => e.stopPropagation()} value={od.status} onChange={e => saveOrders(orders.map(x => x.id === od.id ? { ...x, status: e.target.value } : x))} disabled={!canEdit} style={{ ...inp, padding: "3px 6px", fontSize: 11.5, color: od.status === "已到貨" ? C.green : od.status === "有問題" ? C.red : od.status === "廠商已確認" ? C.blue : C.text }}>{ST.map(x => <option key={x}>{x}</option>)}</select>
                {canEdit ? <button onClick={async (e) => { e.stopPropagation(); if (await confirm("刪除這筆叫貨紀錄？", { confirmLabel: "刪除" })) saveOrders(orders.filter(x => x.id !== od.id)); }} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer" }}>×</button> : <span />}
              </div>
            ))}
          </div>
        )}
        {/* 貨單詳細（月底對帳）——驗收欄要夠寬，字不能被切 */}
        {odDetail && (
          <div onClick={e => e.target === e.currentTarget && setOdSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 710, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 22, width: "min(880px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>貨單明細：{odDetail.vendorName}</div>
                <span style={{ fontSize: 11, color: "#fff", background: odDetail.status === "已到貨" ? C.green : odDetail.status === "廠商已確認" ? C.blue : C.amber, borderRadius: 9, padding: "1px 8px", fontWeight: 700 }}>{odDetail.status}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setOdSel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
              </div>
              <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10 }}>
                {new Date(odDetail.ts).toLocaleString("zh-TW")}・{odDetail.via}{odDetail.needDate ? "・希望到貨 " + dz(odDetail.needDate) : ""}・{odDetail.dept}
              </div>
              {(() => {
                const isChk = odDetail.status !== "草稿";
                const chk = odDetail.check || { items: {}, by: "", note: "", ts: "" };
                const setChk = (patch) => saveOrders(orders.map(x => x.id === odDetail.id ? { ...x, check: { ...chk, ...patch } } : x));
                const setChkItem = (i, patch) => setChk({ items: { ...chk.items, [i]: { ...(chk.items[i] || {}), ...patch } } });
                // 驗收選項可自訂（第一個＝正常，綠色；其餘＝問題，紅色）；不用下拉，直接點選比較快
                const INSP = db.inspectOpts || ["✓ 正確", "數量不符", "規格錯誤", "漏送", "退回"];
                const okOpt = INSP[0];
                const allOk = odDetail.items.every((_, i) => (chk.items[i] || {}).st);
                const GTC3 = `minmax(130px,1.2fr) minmax(76px,0.8fr) 54px ${showMoney ? "66px 76px " : ""}${isChk ? `minmax(${60 + INSP.length * 62}px,1.8fr) minmax(96px,0.9fr)` : ""}`;
                return (
                  <div style={{ border: `1.5px solid ${C.hard}`, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: GTC3, gap: 8, background: "#ece4d6", padding: "6px 10px", fontSize: 10.5, color: C.sub, fontWeight: 700, alignItems: "center" }}>
                      <span>品名</span><span>規格</span><span style={{ textAlign: "right" }}>數量</span>{showMoney && <><span style={{ textAlign: "right" }}>單價</span><span style={{ textAlign: "right" }}>小計</span></>}{isChk && <><span>驗收（直接點選）{canEdit && <button onClick={() => setInspEdit(true)} title="編輯驗收選項（新增/改名/刪除/排序）" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11, color: C.sub, padding: "0 3px" }}>⚙</button>}</span><span>備註</span></>}
                    </div>
                    {odDetail.items.map((x, i) => {
                      const ci = chk.items[i] || {};
                      const bad = ci.st && ci.st !== okOpt;
                      return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: GTC3, gap: 8, padding: "5px 10px", borderTop: `1px solid #f0ead9`, fontSize: 12.5, alignItems: "center", background: bad ? "#fdf3f2" : i % 2 ? "#f8f4ea" : "#fff" }}>
                          <span style={{ fontWeight: 600, color: C.text }}>{x.name}</span>
                          <span style={{ color: C.sub, fontSize: 11.5 }}>{x.spec || "—"}</span>
                          <span style={{ fontFamily: MONOF, textAlign: "right" }}>{x.qty} {x.unit || ""}</span>
                          {showMoney && <><span style={{ fontFamily: MONOF, textAlign: "right", color: C.sub }}>{x.price ? Number(x.price).toLocaleString() : "—"}{(() => {
                            // 變價提示：跟該貨源上次實付價比（本單已寫入快取→比 prevPrice；還沒→比 last.price）
                            const vi = (db.vendorItems || []).find(v => v.id === x.id); const cur = Number(x.price) || 0;
                            if (!vi || !vi.last || !cur) return null;
                            const base = Number(vi.last.price) === cur ? Number(vi.last.prevPrice) || 0 : Number(vi.last.price) || 0;
                            if (!base) return null;
                            const ch = (cur - base) / base * 100;
                            return Math.abs(ch) >= ((db.settings && db.settings.priceAlertPct) || 15) ? <span style={{ color: ch > 0 ? C.red : C.green, fontWeight: 700, fontSize: 10 }}>{ch > 0 ? " ▲" : " ▼"}{Math.abs(Math.round(ch))}%</span> : null;
                          })()}</span>
                          <span style={{ fontFamily: MONOF, textAlign: "right", fontWeight: 700 }}>{x.price ? (Math.round(Number(x.price) * x.qty * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</span></>}
                          {isChk && <>
                            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {INSP.map(o => { const on = ci.st === o; const isOk = o === okOpt; return (
                                <button key={o} onClick={() => canEdit && setChkItem(i, { st: on ? "" : o })} disabled={!canEdit}
                                  style={{ border: `1.5px solid ${on ? (isOk ? C.green : C.red) : "#d9cfbd"}`, background: on ? (isOk ? C.green : C.red) : "#fff", color: on ? "#fff" : C.sub, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: canEdit ? "pointer" : "default", whiteSpace: "nowrap" }}>{o}</button>
                              ); })}
                            </span>
                            <input value={ci.note || ""} onChange={e => setChkItem(i, { note: e.target.value })} disabled={!canEdit} placeholder={bad ? "問題說明" : "備註"} style={{ ...inp, padding: "3px 7px", fontSize: 11.5, borderColor: bad && !ci.note ? C.red : C.line }} />
                          </>}
                        </div>
                      );
                    })}
                    {isChk && (
                      <div style={{ display: "flex", gap: 8, padding: "7px 10px", borderTop: `1px solid #f0ead9`, alignItems: "center", flexWrap: "wrap", background: "#faf6ec" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>📥 驗收{chk.ts ? `（${new Date(chk.ts).toLocaleString("zh-TW", { hour12: false })}）` : ""}</span>
                        {/* 驗收人＝自動帶登入帳號（不能手填，才追得到人） */}
                        <span title="驗收人自動帶登入者，無法手改" style={{ fontSize: 12, fontWeight: 700, color: C.text, background: "#f3eddc", border: `1px solid #d9cfbd`, borderRadius: 6, padding: "3px 10px" }}>👤 {chk.ts ? (chk.by || "—") : (userName || "未登入")}</span>
                        <input value={chk.note || ""} onChange={e => setChk({ note: e.target.value })} disabled={!canEdit} placeholder="整體備註（改單/補送約定…）" style={{ ...inp, flex: 1, minWidth: 140, padding: "4px 8px", fontSize: 12 }} />
                        {canEdit && <button onClick={() => {
                          const bad2 = Object.values(chk.items || {}).some(x => x.st && x.st !== okOpt);
                          const ts2 = new Date().toISOString();
                          const od2 = { ...odDetail, status: bad2 ? "有問題" : "已到貨", check: { ...chk, by: userName || "—", ts: ts2 } };
                          saveOrders(orders.map(x => x.id === odDetail.id ? od2 : x));
                          // 進價事件（實付）：逐品項寫流水 pm_price_<orderId>_<i>（決定性 id，重按冪等）＋更新貨源 last 快取
                          let m = bad2 ? "⚠ 驗收完成：有問題項目已標記，狀態→有問題" : "✓ 驗收完成，全數正確，狀態→已到貨";
                          const evs = buildPriceEvents(od2, db, ts2);
                          evs.forEach(ev => window.storage.set(K("pm_price_" + ev.id), JSON.stringify(ev), true).catch(() => {}));
                          if (evs.length) {
                            const nvis = applyLastPaid(db.vendorItems || [], evs, ts2);
                            save({ vendorItems: nvis });
                            const alerts = nvis.filter(vi => evs.some(e => e.vendor_item_id === vi.id)).map(vi => ({ vi, al: priceAlert(vi, (db.settings && db.settings.priceAlertPct) || 15) })).filter(x => x.al);
                            if (alerts.length) m += "｜⚠ 變價：" + alerts.map(x => `${x.vi.name} ${x.al.up ? "▲+" : "▼"}${Math.abs(x.al.pct)}%（$${x.vi.last.prevPrice}→$${x.vi.last.price}）`).join("、");
                          }
                          flash(m);
                        }} disabled={!allOk} title={allOk ? "" : "每一項都要選驗收結果"} style={{ border: "none", background: allOk ? C.green : "#d5cbb6", color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: allOk ? "pointer" : "default" }}>完成驗收</button>}
                      </div>
                    )}
                    {showMoney && <div style={{ display: "flex", padding: "7px 10px", borderTop: `1.5px solid ${C.hard}`, fontSize: 13, alignItems: "center" }}>
                      <span style={{ fontWeight: 800, color: C.accent }}>總金額</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontFamily: MONOF, fontWeight: 800, fontSize: 15, color: C.accent }}>{nt2(orderTotal(odDetail))}</span>
                    </div>}
                  </div>
                );
              })()}
              {/* 草稿：補發送按鈕（發完自動變已送出） */}
              {odDetail.status === "草稿" && (() => {
                const v2 = db.vendors.find(x => x.id === odDetail.vendor_id);
                const text2 = odDetail.text || (`📦 A Beach 101 叫貨單\n【${odDetail.vendorName}】\n` + odDetail.items.map(x => `・${x.name}${x.spec ? " " + x.spec : ""} ×${x.qty} ${x.unit || ""}${x.price ? `＠${d2(Number(x.price))}＝$${d2(Number(x.price) * x.qty)}` : ""}`).join("\n") + `\n──────\n合計 $${d2(orderTotal(odDetail))}` + (odDetail.needDate ? `\n希望到貨：${dz(odDetail.needDate)}` : "") + "\n麻煩核對品項與金額，謝謝！");
                const markSent = (via) => { saveOrders(orders.map(x => x.id === odDetail.id ? { ...x, status: "已送出", via } : x)); setOdSel(null); };
                const cell2 = (txt, flexN, opts = {}) => ({ type: "text", text: String(txt), size: "xs", flex: flexN, ...opts });
                const flex2 = {
                  type: "flex", altText: text2.slice(0, 390),
                  contents: { type: "bubble", size: "mega",
                    header: { type: "box", layout: "vertical", backgroundColor: "#1d1a15", paddingAll: "14px", contents: [
                      { type: "text", text: "📦 A Beach 101 叫貨單", color: "#ffffff", weight: "bold", size: "md" },
                      { type: "text", text: `${new Date().getMonth() + 1}/${new Date().getDate()}（${WDZ[new Date().getDay()]}）｜${odDetail.vendorName}`, color: "#d9cfbd", size: "xs", margin: "sm" },
                    ] },
                    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px", contents: [
                      { type: "box", layout: "horizontal", spacing: "sm", contents: [cell2("品名", 5, { color: "#9b9384", weight: "bold" }), cell2("數量", 2, { color: "#9b9384", align: "end", weight: "bold" }), cell2("單價", 2, { color: "#9b9384", align: "end", weight: "bold" }), cell2("小計", 3, { color: "#9b9384", align: "end", weight: "bold" })] },
                      { type: "separator", color: "#c8bca6" },
                      ...odDetail.items.map(x => ({ type: "box", layout: "horizontal", spacing: "sm", contents: [
                        cell2(x.name + (x.spec ? " " + x.spec : ""), 5, { color: "#1d1a15", wrap: true }),
                        cell2(`${x.qty}${x.unit || ""}`, 2, { color: "#5a5247", align: "end" }),
                        cell2(x.price ? d2(Number(x.price)) : "—", 2, { color: "#5a5247", align: "end" }),
                        cell2(x.price ? "$" + d2(Number(x.price) * x.qty) : "—", 3, { color: "#1d1a15", align: "end", weight: "bold" }),
                      ] })),
                      { type: "separator", color: "#c8bca6" },
                      { type: "box", layout: "horizontal", contents: [
                        { type: "text", text: "合計", size: "sm", weight: "bold", color: "#c4582a", flex: 3 },
                        { type: "text", text: "$" + d2(orderTotal(odDetail)), size: "lg", weight: "bold", color: "#c4582a", flex: 5, align: "end" },
                      ] },
                      ...(odDetail.needDate ? [{ type: "text", text: "🚚 希望到貨：" + dz(odDetail.needDate), size: "xs", color: "#c4582a", margin: "sm" }] : []),
                      { type: "text", text: "麻煩核對品項與金額，謝謝！", size: "xxs", color: "#9b9384", margin: "sm", wrap: true },
                    ] },
                  },
                };
                return (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={async () => {
                      if (!v2?.lineGroupId) { alert("這家廠商還沒綁定群——先用 LINE 分享或複製。"); return; }
                      const gname = (groups[v2.lineGroupId] || {}).name || v2.lineGroupId;
                      if (!(await confirm(`把這張草稿發送到「${gname}」？`, { confirmLabel: "發送" }))) return;
                      try {
                        const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": "ground-pm-2026-secret-abc123" }, body: JSON.stringify({ to: v2.lineGroupId, messages: [flex2] }) });
                        const d = await r.json();
                        if (!d.ok) { alert(/monthly limit/i.test(d.error || "") ? "LINE 推播月額度不足。" : "發送失敗：" + (d.error || "未知")); return; }
                        markSent("D發群"); flash("✓ 草稿已由 DD 發送到「" + gname + "」");
                      } catch (e) { alert("發送失敗：" + e.message); }
                    }} style={{ flex: 1, border: "none", background: v2?.lineGroupId ? C.green : "#d5cbb6", color: "#fff", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🤖 DD 發送</button>
                    <button onClick={async () => {
                      try { await navigator.clipboard.writeText(text2); } catch (_) {}
                      const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
                      markSent(mobile ? "LINE分享" : "複製");
                      if (mobile) window.open("https://line.me/R/share?text=" + encodeURIComponent(text2));
                      else flash("💻 已複製叫貨單文字，開 LINE 貼給廠商即可");
                    }} style={{ flex: 1, border: "none", background: "#06C755", color: "#fff", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📱 LINE 分享</button>
                    <button onClick={async () => { try { await navigator.clipboard.writeText(text2); } catch (_) {} markSent("複製"); flash("✓ 已複製叫貨單文字"); }} style={{ flex: 1, border: `1px solid ${C.line}`, background: "#fff", color: C.text, borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📋 複製</button>
                  </div>
                );
              })()}
              {/* 到貨驗收已合併進上方表格「驗收」欄（直接點選），這裡不再重複一段 */}
              {showMoney && <button onClick={async () => {
                const txt = `【對帳明細】${odDetail.vendorName} ${new Date(odDetail.ts).toLocaleDateString("zh-TW")}\n` + odDetail.items.map(x => `${x.name} ${x.spec || ""} ×${x.qty}${x.unit || ""} @${x.price || "?"} = ${x.price ? (Math.round(Number(x.price) * x.qty * 100) / 100).toLocaleString() : "?"}`).join("\n") + `\n總金額 ${nt2(orderTotal(odDetail))}`;
                try { await navigator.clipboard.writeText(txt); flash("✓ 已複製對帳明細（含單價，內部用）"); } catch (_) {}
                setOdSel(null);
              }} style={{ width: "100%", marginTop: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.text, borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📋 複製對帳明細（含金額）</button>}
            </div>
          </div>
        )}
        {/* 驗收選項編輯器：新增/改名/刪除/排序（第一個＝正常綠色，其餘＝問題紅色） */}
        {inspEdit && (() => {
          const opts = db.inspectOpts || ["✓ 正確", "數量不符", "規格錯誤", "漏送", "退回"];
          const setOpts = (list) => save({ inspectOpts: list });
          const move = (i, d) => { const n = [...opts]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setOpts(n); };
          return (
            <div onClick={e => e.target === e.currentTarget && setInspEdit(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 720, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, width: "min(420px,94vw)" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>⚙ 驗收選項</div>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setInspEdit(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.sub }}>×</button>
                </div>
                <div style={{ fontSize: 11, color: C.faint, marginBottom: 10 }}>第一個＝「正常」（綠色）；其他都算問題（紅色、會標記追蹤）。可改名、拖上下排序、刪除、新增。</div>
                {opts.map((o, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 10.5, color: i === 0 ? C.green : C.red, fontWeight: 700, width: 28 }}>{i === 0 ? "正常" : "問題"}</span>
                    <input value={o} onChange={e => setOpts(opts.map((x, j) => j === i ? e.target.value : x))} style={{ ...inp, flex: 1, padding: "5px 9px", fontSize: 12.5 }} />
                    <button onClick={() => move(i, -1)} disabled={i === 0} style={{ border: `1px solid ${C.line}`, background: "#fff", borderRadius: 6, padding: "3px 7px", fontSize: 11, cursor: i === 0 ? "default" : "pointer", color: C.sub, opacity: i === 0 ? .4 : 1 }}>↑</button>
                    <button onClick={() => move(i, 1)} disabled={i === opts.length - 1} style={{ border: `1px solid ${C.line}`, background: "#fff", borderRadius: 6, padding: "3px 7px", fontSize: 11, cursor: i === opts.length - 1 ? "default" : "pointer", color: C.sub, opacity: i === opts.length - 1 ? .4 : 1 }}>↓</button>
                    <button onClick={() => opts.length > 2 ? setOpts(opts.filter((_, j) => j !== i)) : flash("至少要留 2 個選項")} style={{ border: "none", background: "none", color: C.red, cursor: "pointer", fontSize: 14 }}>×</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={() => setOpts([...opts, "新選項"])} style={{ flex: 1, border: `1px dashed ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "7px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>＋ 新增選項</button>
                  <button onClick={() => setInspEdit(false)} style={{ flex: 1, border: "none", background: C.accent, color: "#fff", borderRadius: 7, padding: "7px 0", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>完成</button>
                </div>
              </div>
            </div>
          );
        })()}
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
              recordOrder(pv, "D發群", "已送出", text); flash("✓ 已由 DD 發送到「" + gname + "」，叫貨單已記錄");
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
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 4 }}>DD 發送目標群（要先把 D 拉進該廠商的 LINE 群，群才會出現在這裡）</div>
                  <select value={pv.lineGroupId || ""} onChange={e => updV(pv.id, { lineGroupId: e.target.value, sendMode: e.target.value ? "dbot" : pv.sendMode })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>
                    <option value="">— 未綁定（用下面的 LINE 分享 / 複製）—</option>
                    {glist.map(([gid, g]) => <option key={gid} value={gid}>{(g && g.name) || gid}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={doSend} style={{ flex: 1, border: "none", background: pv.lineGroupId ? C.green : "#d5cbb6", color: "#fff", borderRadius: 8, padding: "10px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>🤖 DD 發送到群</button>
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
    const itemsOf = (vid) => (db.vendorItems || []).filter(x => x.vendor_id === vid).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    // 搜尋：除了廠商欄位，也比對品項（品名/規格/分類/標籤）——有中的品項就列出該廠商並自動展開
    const qq = q.trim().toLowerCase();
    const matchIt = (it) => !!qq && `${it.name || ""} ${it.spec || ""} ${it.grp || ""} ${it.tags || ""}`.toLowerCase().includes(qq);
    const vs = (db.vendors || []).filter(v => !qq || (v.name + (v.en || "") + (v.tags || []).join("") + (v.note || "") + (v.dept || "")).toLowerCase().includes(qq) || itemsOf(v.id).some(matchIt))
      .filter(v => !catF || (v.dept || "共用") === catF);
    const addVendor = () => { if (!canEdit) return; const nv = { id: rid("v"), name: "", en: "", dept: "外場", url: "", tags: [], note: "", lineGroupId: "", sendMode: "share", sort: (db.vendors || []).length }; save({ vendors: [...db.vendors, nv] }); setSel("v:" + nv.id); };
    const updV = (id, fp) => save({ vendors: db.vendors.map(x => x.id === id ? { ...x, ...fp } : x) });
    const addItem = (vid, grp) => { if (!canEdit) return; const ni = { id: rid("vi"), vendor_id: vid, grp: grp || "", name: "", spec: "", unit: "件", price: "", safeStock: "", sort: itemsOf(vid).length }; save({ vendorItems: [...(db.vendorItems || []), ni] }); setSel("i:" + ni.id); };
    // 拖曳排序：廠商對廠商、品項對品項（同廠商內）
    const dropVendor = (targetId) => {
      if (!dragV || dragV === targetId) return setDragV(null);
      const list = [...(db.vendors || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const from = list.findIndex(x => x.id === dragV), to = list.findIndex(x => x.id === targetId);
      if (from < 0 || to < 0) return setDragV(null);
      const [mv] = list.splice(from, 1); list.splice(to, 0, mv);
      save({ vendors: list.map((x, i2) => ({ ...x, sort: i2 })) }); setDragV(null);
    };
    const dropItem = (targetId, vid) => {
      if (!dragI || dragI === targetId) return setDragI(null);
      const mine = itemsOf(vid); const others = (db.vendorItems || []).filter(x => x.vendor_id !== vid);
      const from = mine.findIndex(x => x.id === dragI), to = mine.findIndex(x => x.id === targetId);
      if (from < 0 || to < 0) return setDragI(null);
      const [mv] = mine.splice(from, 1); const target = mine[to]; mine.splice(to, 0, { ...mv, grp: (target?.grp ?? mv.grp) }); // 拖進別的分類就跟著換組
      save({ vendorItems: [...others, ...mine.map((x, i2) => ({ ...x, sort: i2 }))] }); setDragI(null);
    };
    const updI = (id, fp) => save({ vendorItems: (db.vendorItems || []).map(x => x.id === id ? { ...x, ...fp } : x) });
    const selV = sel && sel.startsWith("v:") && db.vendors.find(x => x.id === sel.slice(2));
    const selI = sel && sel.startsWith("i:") && (db.vendorItems || []).find(x => x.id === sel.slice(2));
    return (
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
          <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>廠商</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>供應商與品項</div>
            <div style={{ fontSize: 11, color: C.faint }}>{(db.vendors || []).length} 家・品項 {(db.vendorItems || []).length} 項・名稱前打勾＝正式供應商（才會進叫貨表，置頂）</div>
          </div>
          <div style={{ flex: 1 }} />
          <select value={catF} onChange={e => setCatF(e.target.value)} style={inp}><option value="">全部部門</option>{DEPTS.map(d => <option key={d} value={d}>{d}</option>)}</select>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 搜尋廠商/品項/標籤…" style={{ ...inp, width: 185 }} />
          {canEdit && btn("＋ 新增分類", () => { const n = window.prompt("分類名稱（例：菜商/包材/耗材/飲品）"); if (n && n.trim()) { save({ vendorCats: [...new Set([...(db.vendorCats || []), n.trim()])] }); setCollapsed(c2 => ({ ...c2, ["vc" + n.trim()]: true })); } })}
          {canEdit && btn("＋ 新增廠商", addVendor, { background: C.accent, color: "#fff", borderColor: C.accent })}
        </div>
        {/* 第一層＝廠商分類（預設收合，點了才出現該類廠商）；分類可新增/改名/移除（張良 2026-07-18） */}
        {(() => {
          const vcatOf = (v) => (v.vcat || "").trim() || "未分類";
          const cats2 = [...new Set([...(db.vendorCats || []), ...vs.map(vcatOf)])];
          const keys2 = cats2.filter(c => c !== "未分類").sort((a, b) => a.localeCompare(b, "zh-TW"));
          if (cats2.includes("未分類")) keys2.push("未分類");
          const renameVcat = (g) => { const n = window.prompt("分類名稱", g); if (n === null || !n.trim() || n === g) return; save({ vendors: db.vendors.map(x => vcatOf(x) === g ? { ...x, vcat: n.trim() } : x), vendorCats: [...new Set((db.vendorCats || []).map(c => c === g ? n.trim() : c))] }); };
          const delVcat = async (g) => { if (await confirm(`移除分類「${g}」？裡面的廠商會移到「未分類」（廠商不會被刪）。`, { confirmLabel: "移除", danger: false })) save({ vendors: db.vendors.map(x => vcatOf(x) === g ? { ...x, vcat: "" } : x), vendorCats: (db.vendorCats || []).filter(c => c !== g) }); };
          return keys2.map(g => {
            const gvs = vs.filter(v => vcatOf(v) === g).sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0)); // 正式供應商置頂
            const gOpen = qq ? true : !!collapsed["vc" + g]; // 搜尋中：分類全展開
            return (
              <div key={g} style={{ border: `1.5px solid ${C.hard}`, borderRadius: 4, marginBottom: 10, overflow: "hidden", background: "#fff" }}>
                <div onClick={() => setCollapsed(c2 => ({ ...c2, ["vc" + g]: !gOpen }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#ece4d6", cursor: "pointer" }}>
                  <span style={{ fontSize: 10, color: C.faint }}>{gOpen ? "▾" : "▸"}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{g}</span>
                  <span style={{ fontFamily: MONOF, fontSize: 11.5, color: C.faint }}>{gvs.length} 家</span>
                  <div style={{ flex: 1 }} />
                  {canEdit && <>
                    <button onClick={e => { e.stopPropagation(); const nv = { id: rid("v"), name: "", en: "", vcat: g === "未分類" ? "" : g, dept: "外場", url: "", tags: [], note: "", lineGroupId: "", sendMode: "share", sort: (db.vendors || []).length }; save({ vendors: [...db.vendors, nv] }); setSel("v:" + nv.id); }} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.accent, borderRadius: 6, padding: "2px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>＋ 廠商</button>
                    {g !== "未分類" && <button onClick={e => { e.stopPropagation(); renameVcat(g); }} title="重新命名分類" style={{ border: "none", background: "none", color: C.sub, fontSize: 11.5, cursor: "pointer" }}>✎</button>}
                    {g !== "未分類" && <button onClick={e => { e.stopPropagation(); delVcat(g); }} title="移除分類" style={{ border: "none", background: "none", color: C.sub, fontSize: 12, cursor: "pointer" }}>×</button>}
                  </>}
                </div>
                {gOpen && gvs.map((v, i) => {
            const hitIts = qq ? itemsOf(v.id).filter(matchIt) : []; // 搜尋命中的品項
            const open = qq && hitIts.length ? true : collapsed["v" + v.id]; // 有命中品項→自動展開
            const its = qq && hitIts.length ? hitIts : itemsOf(v.id); // 搜尋中只列命中的品項
            return (
              <React.Fragment key={v.id}>
                <div onClick={() => setCollapsed(c2 => ({ ...c2, ["v" + v.id]: !c2["v" + v.id] }))}
                  onDragOver={e => dragV && e.preventDefault()} onDrop={() => dropVendor(v.id)}
                  style={{ display: "grid", gridTemplateColumns: "16px 14px 20px minmax(150px,1fr) 44px 44px minmax(140px,1.3fr) 92px", gap: 8, alignItems: "center", minHeight: 38, borderTop: `1px solid #e0d6bf`, padding: "3px 10px", cursor: "pointer", background: open ? C.soft : "#fff", outline: dragV === v.id ? `2px dashed ${C.accent}` : "none" }}
                  onMouseEnter={e => e.currentTarget.style.background = C.soft} onMouseLeave={e => e.currentTarget.style.background = open ? C.soft : "#fff"}>
                  {canEdit ? <span draggable onDragStart={e => { e.stopPropagation(); setDragV(v.id); }} onDragEnd={() => setDragV(null)} onClick={e => e.stopPropagation()} title="拖曳調整廠商順序" style={{ cursor: "grab", color: "#c8bca6", fontSize: 13, textAlign: "center" }}>⠿</span> : <span />}
                  <span style={{ fontSize: 10, color: C.faint }}>{open ? "▾" : "▸"}</span>
                  <input type="checkbox" checked={!!v.official} disabled={!canEdit} onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); updV(v.id, { official: e.target.checked }); }} title="正式供應商（打勾＝出現在叫貨表，並置頂）" style={{ accentColor: C.accent, cursor: canEdit ? "pointer" : "default", margin: 0, width: 14, height: 14 }} />
                  <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{v.name || "（未命名）"}</span>
                    {v.en && <span style={{ fontSize: 10.5, color: C.faint, marginLeft: 6 }}>{v.en}</span>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: v.dept === "內場" ? C.green : v.dept === "吧檯" ? C.amber : v.dept === "共用" ? "#9b9384" : C.blue }}>{v.dept || "共用"}</span>
                  <span style={{ fontFamily: MONOF, fontSize: 12, color: its.length ? C.text : "#d5cbb6", textAlign: "center" }}>{its.length || "—"}</span>
                  <span style={{ fontSize: 11, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.note}>{v.note}</span>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                    {v.url && <a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.blue }}>官網↗</a>}
                    {canEdit && <button onClick={() => setSel("v:" + v.id)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 6, padding: "1px 8px", fontSize: 11, cursor: "pointer" }}>✎</button>}
                  </div>
                </div>
                {open && (() => {
                  // 品項依「分類」分層（可折疊/改名/刪除/拖曳；拖到別的分類會跟著換組）
                  const GTCI = `16px minmax(160px,1.4fr) minmax(110px,1fr) 60px ${showMoney ? "80px " : ""}76px 56px`;
                  const grpsI = {}; its.forEach(it => { (grpsI[it.grp || "未分類"] = grpsI[it.grp || "未分類"] || []).push(it); });
                  const gKeys = Object.keys(grpsI).sort((a, b) => (a === "未分類" ? 1 : 0) - (b === "未分類" ? 1 : 0) || (grpsI[a][0].sort || 0) - (grpsI[b][0].sort || 0));
                  const renameGrp = (g) => { const n = window.prompt("分類名稱", g === "未分類" ? "" : g); if (n === null) return; save({ vendorItems: (db.vendorItems || []).map(x => x.vendor_id === v.id && (x.grp || "未分類") === g ? { ...x, grp: n.trim() } : x) }); };
                  const delGrp = async (g) => { if (await confirm(`移除分類「${g}」？裡面的品項會移到「未分類」（品項不會被刪）。`, { confirmLabel: "移除分類", danger: false })) save({ vendorItems: (db.vendorItems || []).map(x => x.vendor_id === v.id && (x.grp || "未分類") === g ? { ...x, grp: "" } : x) }); };
                  const itemRow = (it) => (
                    <div key={it.id} onDragOver={e => dragI && e.preventDefault()} onDrop={() => dropItem(it.id, v.id)}
                      style={{ display: "grid", gridTemplateColumns: GTCI, gap: 8, alignItems: "center", minHeight: 30, borderTop: `1px solid #f0ead9`, fontSize: 12.5, outline: dragI === it.id ? `2px dashed ${C.accent}` : "none" }}>
                      {canEdit ? <span draggable onDragStart={() => setDragI(it.id)} onDragEnd={() => setDragI(null)} title="拖曳排序／拖到別的分類" style={{ cursor: "grab", color: "#c8bca6", fontSize: 12, textAlign: "center" }}>⠿</span> : <span />}
                      <span style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name || "（未命名）"}{it.matId ? <span title="來自包材庫" style={{ fontSize: 9.5, color: "#7a5c1e", marginLeft: 4 }}>📦</span> : null}{it.tags ? <span style={{ fontSize: 9.5, fontWeight: 600, color: C.amber, marginLeft: 5 }}>{String(it.tags).split(/[,，\s]+/).filter(Boolean).map(t => "#" + t).join(" ")}</span> : null}</span>
                      <span style={{ color: C.sub, fontSize: 11.5 }}>{it.spec || "—"}</span>
                      <span style={{ color: C.sub }}>{it.unit || "—"}</span>
                      {showMoney && <span style={{ fontFamily: MONOF, textAlign: "right", color: it.price ? C.text : "#d5cbb6" }}>{it.price ? Number(it.price).toLocaleString() : "—"}</span>}
                      <span style={{ fontFamily: MONOF, textAlign: "right", color: it.safeStock !== "" && it.safeStock != null ? C.sub : "#d5cbb6" }}>{it.safeStock !== "" && it.safeStock != null ? it.safeStock : "—"}</span>
                      {canEdit ? <button onClick={() => setSel("i:" + it.id)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 6, padding: "1px 8px", fontSize: 11, cursor: "pointer" }}>✎</button> : <span />}
                    </div>
                  );
                  return (
                    <div style={{ background: "#faf6ec", borderTop: `1px solid #f0ead9`, padding: "6px 12px 10px 30px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: GTCI, gap: 8, padding: "4px 0", fontSize: 10, color: C.faint, fontWeight: 700 }}>
                        <span /><span>品名</span><span>規格</span><span>單位</span>{showMoney && <span style={{ textAlign: "right" }}>單價</span>}<span style={{ textAlign: "right" }}>安全庫存</span><span />
                      </div>
                      {its.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: "4px 0" }}>還沒有品項——按下面「＋新增品項」建立這家的清單（包材/食材/耗材都放這）。</div>}
                      {gKeys.map(g => {
                        const gOpen = !collapsed["g" + v.id + g];
                        return (
                          <React.Fragment key={g}>
                            {(gKeys.length > 1 || g !== "未分類") && (
                              <div onClick={() => setCollapsed(c2 => ({ ...c2, ["g" + v.id + g]: gOpen }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", margin: "6px 0 0", background: "#f0e9d8", border: `1px solid #e0d6bf`, borderRadius: 3, cursor: "pointer" }}>
                                <span style={{ fontSize: 9, color: C.faint }}>{gOpen ? "▾" : "▸"}</span>
                                <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{g}</span>
                                <span style={{ fontFamily: MONOF, fontSize: 10.5, color: C.faint }}>{grpsI[g].length} 項</span>
                                <div style={{ flex: 1 }} />
                                {canEdit && <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex", gap: 4 }}>
                                  <button onClick={() => addItem(v.id, g === "未分類" ? "" : g)} title="在此分類新增品項" style={{ border: `1px solid #d9cfbd`, background: "#fff", color: C.accent, borderRadius: 4, padding: "0 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", lineHeight: "18px" }}>＋ 品項</button>
                                  <button onClick={() => renameGrp(g)} title="重新命名分類" style={{ border: `1px solid #d9cfbd`, background: "#fff", color: C.sub, borderRadius: 4, padding: "0 6px", fontSize: 10.5, cursor: "pointer", lineHeight: "18px" }}>✎</button>
                                  {g !== "未分類" && <button onClick={() => delGrp(g)} title="移除分類（品項移到未分類）" style={{ border: `1px solid #d9cfbd`, background: "#fff", color: C.sub, borderRadius: 4, padding: "0 6px", fontSize: 11, cursor: "pointer", lineHeight: "18px" }}>×</button>}
                                </span>}
                              </div>
                            )}
                            {gOpen && grpsI[g].map(itemRow)}
                          </React.Fragment>
                        );
                      })}
                      {canEdit && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button onClick={() => addItem(v.id)} style={{ border: `1.5px dashed ${C.accent}`, background: "#fff", color: C.accent, borderRadius: 7, padding: "5px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>＋ 新增品項</button>
                        <button onClick={() => { const n = window.prompt("新分類名稱（例：醬料杯類/盒類/食材）"); if (n && n.trim()) addItem(v.id, n.trim()); }} style={{ border: `1px dashed ${C.line}`, background: "transparent", color: C.sub, borderRadius: 7, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}>＋ 新分類</button>
                      </div>}
                    </div>
                  );
                })()}
              </React.Fragment>
            );
          })}
              </div>
            );
          });
        })()}
        {/* 📦 包材庫（自 ground-pack 搬來的 36 項）：在這裡歸屬給廠商 → 會出現在該廠商品項清單＆產品綁定分組（張良 2026-07-18） */}
        {(() => {
          const unassigned = (db.materials || []).filter(m => !m.vendor_id);
          const assigned = (db.materials || []).filter(m => m.vendor_id);
          const updM = (id, fp) => save({ materials: (db.materials || []).map(x => x.id === id ? { ...x, ...fp } : x) });
          const assign = (m, vid) => {
            if (!vid) return;
            // 歸屬：包材標上廠商 + 同步塞進該廠商的叫貨品項清單（帶 matId 連結）
            const already = (db.vendorItems || []).some(x => x.matId === m.id && x.vendor_id === vid);
            save({
              materials: (db.materials || []).map(x => x.id === m.id ? { ...x, vendor_id: vid } : x),
              vendorItems: already ? db.vendorItems : [...(db.vendorItems || []), { id: rid("vi"), vendor_id: vid, matId: m.id, name: m.name, spec: m.spec || "", unit: "件", price: "", safeStock: "", sort: (db.vendorItems || []).length }],
            });
            flash(`✓「${m.name}」已歸屬給「${(db.vendors.find(v => v.id === vid) || {}).name}」，同時加進該廠商的品項清單（單價記得補）`);
          };
          return (
            <div style={{ marginTop: 14, border: `1.5px solid ${C.hard}`, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#ece4d6" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>📦 包材庫</span>
                <span style={{ fontSize: 11, color: C.faint }}>未歸屬 {unassigned.length}・已歸屬 {assigned.length}——歸屬給廠商後會出現在該廠商品項清單與產品綁定分組</span>
              </div>
              {unassigned.length === 0 ? <div style={{ padding: 12, fontSize: 12, color: C.green, fontWeight: 600, textAlign: "center" }}>✓ 全部包材都已歸屬廠商</div> : unassigned.map((m, i) => (
                <div key={m.id} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) minmax(100px,1fr) minmax(90px,0.8fr) 180px 26px", gap: 8, alignItems: "center", padding: "4px 12px", borderTop: `1px solid #e0d6bf`, background: i % 2 ? "#faf6ec" : "#fff", fontSize: 12.5 }}>
                  <input value={m.name} onChange={e => canEdit && updM(m.id, { name: e.target.value })} disabled={!canEdit} style={{ border: "none", background: "transparent", fontSize: 12.5, fontWeight: 600, color: C.text, outline: "none" }} />
                  <input value={m.spec || ""} onChange={e => canEdit && updM(m.id, { spec: e.target.value })} disabled={!canEdit} placeholder="規格" style={{ border: "none", background: "transparent", fontSize: 11.5, color: C.sub, outline: "none" }} />
                  <span style={{ fontSize: 10.5, color: C.faint }}>{m.grp}</span>
                  {canEdit ? (
                    <select value="" onChange={e => assign(m, e.target.value)} style={{ ...inp, padding: "3px 6px", fontSize: 11.5 }}>
                      <option value="">歸屬給廠商…</option>
                      {(db.vendors || []).filter(v => v.name).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  ) : <span />}
                  {canEdit ? <button onClick={async () => { if (await confirm(`刪除包材「${m.name}」？`, { confirmLabel: "刪除" })) save({ materials: (db.materials || []).filter(x => x.id !== m.id), productPackaging: (db.productPackaging || []).filter(x => x.packaging_id !== m.id) }); }} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer", fontSize: 13 }}>×</button> : <span />}
                </div>
              ))}
            </div>
          );
        })()}
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
                    <option value="dbot">DD 自動發群（D 已在廠商群）</option>
                    <option value="copy">複製文字</option>
                  </select>
                </label>
                <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600 }}>分類（例：菜商/包材/耗材）
                  <input value={selV.vcat ?? ""} onChange={e => updV(selV.id, { vcat: e.target.value })} disabled={!canEdit} list="sv-vcats" placeholder="留空＝未分類" style={{ ...inp, width: "100%", marginTop: 4 }} />
                  <datalist id="sv-vcats">{[...new Set([...(db.vendorCats || []), ...db.vendors.map(x => (x.vcat || "").trim()).filter(Boolean)])].map(g => <option key={g} value={g} />)}</datalist>
                </label>
                <label style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600, gridColumn: "1 / -1" }}>備註（簡短即可）
                  <input value={selV.note ?? ""} onChange={e => updV(selV.id, { note: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, fontWeight: 700, gridColumn: "1 / -1", cursor: canEdit ? "pointer" : "default" }}>
                  <input type="checkbox" checked={!!selV.official} disabled={!canEdit} onChange={e => updV(selV.id, { official: e.target.checked })} style={{ accentColor: C.accent, width: 15, height: 15 }} />
                  正式供應商（打勾才會出現在叫貨表，並置頂）
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
                {[["name", "品名", "1 / -1"], ["grp", "分類（例：醬料杯類/盒類/食材，留空＝未分類）", "1 / -1"], ["spec", "規格（例：2500入/箱）", "1 / -1"], ["tags", "標籤（比價用，逗號分隔，例：薯條,冷凍）", "1 / -1"], ["unit", "單位（箱/件/包）"], ...(showMoney ? [["price", "單價"]] : []), ["safeStock", "安全庫存量"]].map(([k, l, span]) => (
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
  // ground-pack 風：緊湊欄寬（固定為主、備註吃剩餘）＋每格直向格線＋方角硬邊框（張良 2026-07-18 指定）
  const GTC = `172px 188px minmax(120px,1fr) 56px ${showMoney ? "84px " : ""}52px 96px 58px 34px`;
  const vline = { borderRight: "1px solid #e0d6bf", alignSelf: "stretch", display: "flex", alignItems: "center" };
  const hardBox = { background: "#fff", border: `1.5px solid ${C.hard}`, borderRadius: 4, marginBottom: 12, overflow: "hidden" };
  const addProduct = (catName) => {
    if (!canEdit) return;
    const np = { id: rid("p"), category: catName || catNames[0] || "未分類", name: "", english_name: "", price: "", note: "", is_active: true, sort: (db.products || []).length, unit: "", tags: [] };
    save({ products: [...db.products, np] }); setSel(np.id);
  };
  const addCategory = () => { if (!canEdit) return; const nm = window.prompt("新類別名稱"); if (!nm || !nm.trim()) return; save({ categories: [...db.categories, { name: nm.trim(), sort: db.categories.length }] }); };
  const rows = (list) => list.map((x, i) => (
    <div key={x.id} onClick={() => setSel(x.id)}
      onMouseEnter={e => e.currentTarget.style.background = C.soft} onMouseLeave={e => e.currentTarget.style.background = x.is_active === false ? "#f2ede1" : "#fff"}
      style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "stretch", minHeight: 34, borderTop: `1px solid #e0d6bf`, cursor: "pointer", background: x.is_active === false ? "#f2ede1" : "#fff", opacity: x.is_active === false ? .6 : 1 }}>
      <div style={{ ...vline, padding: "0 9px", fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name || "（未命名）"}</span></div>
      <div style={{ ...vline, padding: "0 9px", fontSize: 11.5, color: C.faint, overflow: "hidden" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.english_name}</span></div>
      <div style={{ ...vline, padding: "0 9px", fontSize: 11.5, color: C.sub, overflow: "hidden" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.note || "—"}</span></div>
      <div style={{ ...vline, padding: "0 9px", fontSize: 12, color: x.unit ? C.sub : "#d5cbb6" }}>{x.unit || "—"}</div>
      {showMoney && <div style={{ ...vline, padding: "0 9px", fontFamily: MONOF, fontSize: 12, justifyContent: "flex-end", color: x.price ? C.text : "#d5cbb6" }}>{fmt$(x.price) || "—"}</div>}
      <div style={{ ...vline, padding: "0 9px", fontFamily: MONOF, fontSize: 12, justifyContent: "center", color: packCount(x.id) ? C.blue : "#d5cbb6" }}>{packCount(x.id) || "—"}</div>
      <div style={{ ...vline, padding: "0 7px", gap: 3, flexWrap: "wrap" }}>{(x.tags || []).map(t => <span key={t} style={{ fontSize: 10, color: C.accent, background: "#fbeee6", borderRadius: 3, padding: "0 5px" }}>#{t}</span>)}</div>
      <div style={{ ...vline, padding: "0 7px" }}><span style={{ fontSize: 10.5, fontWeight: 600, color: x.is_active !== false ? C.green : C.faint }}>{x.is_active !== false ? "啟用" : "停用"}</span></div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>✎</div>
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
        <div style={hardBox}>
          <div style={{ display: "grid", gridTemplateColumns: GTC, background: "#ece4d6", borderBottom: `1.5px solid ${C.hard}`, alignItems: "stretch" }}>
            {["品名", "英文名稱", "內容/備註", "單位", ...(showMoney ? ["售價"] : []), "包材", "標籤", "狀態", ""].map((h, i2) => <div key={i2} style={{ ...vline, borderRight: "1px solid #d3c8ac", padding: "7px 9px", fontSize: 10.5, letterSpacing: .6, color: C.sub, fontWeight: 700, justifyContent: h === "售價" ? "flex-end" : h === "包材" ? "center" : "flex-start" }}>{h}</div>)}
          </div>
          {rows([...prods].sort((a, b) => (a.sort || 0) - (b.sort || 0)))}
        </div>
      ) : catNames.map(cn => (
        <div key={cn} style={hardBox}>
          <div onClick={() => setCollapsed(c2 => ({ ...c2, [cn]: !c2[cn] }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#ece4d6", cursor: "pointer" }}>
            <span style={{ fontSize: 11, color: C.faint }}>{collapsed[cn] ? "▸" : "▾"}</span>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{cn}</span>
            <span style={{ fontFamily: MONOF, fontSize: 11.5, color: C.faint }}>{byCat[cn].length} 項</span>
            <div style={{ flex: 1 }} />
            {canEdit && <button onClick={e => { e.stopPropagation(); addProduct(cn); }} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.accent, borderRadius: 6, padding: "2px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>＋ 產品</button>}
          </div>
          {!collapsed[cn] && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: GTC, background: C.soft, borderTop: `1px solid ${C.line}`, alignItems: "stretch" }}>
                {["品名", "英文名稱", "內容/備註", "單位", ...(showMoney ? ["售價"] : []), "包材", "標籤", "狀態", ""].map((h, i2) => <div key={i2} style={{ ...vline, padding: "5px 9px", fontSize: 10, letterSpacing: .6, color: C.faint, fontWeight: 700, justifyContent: h === "售價" ? "flex-end" : h === "包材" ? "center" : "flex-start" }}>{h}</div>)}
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
              {[["name", "品名"], ["english_name", "英文名稱"], ["unit", "單位"], ...(showMoney ? [["price", "售價"]] : []), ["posName", "POS品名（對應POS報表）"], ["note", "內容/備註"]].map(([k, l]) => (
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
              {/* 包材依「歸屬廠商」分組（張良：包材要隸屬在廠商的品項清單下）；未歸屬的到 廠商頁→包材庫 指定 */}
              <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px" }}>
                {(() => {
                  const vname = (vid) => (db.vendors || []).find(v => v.id === vid)?.name || "";
                  const grps = {};
                  (db.materials || []).forEach(m => { const k = m.vendor_id ? vname(m.vendor_id) : "（未歸屬廠商——到 廠商頁 最下面的包材庫指定）"; (grps[k] = grps[k] || []).push(m); });
                  const keys = Object.keys(grps).sort((a, b) => (a.startsWith("（") ? 1 : 0) - (b.startsWith("（") ? 1 : 0) || a.localeCompare(b, "zh-TW"));
                  return keys.map(k => (
                    <div key={k} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: k.startsWith("（") ? C.faint : C.blue, margin: "4px 0 2px" }}>🏭 {k}</div>
                      {grps[k].map(m => {
                        const on = (db.productPackaging || []).some(x => x.product_id === selP.id && x.packaging_id === m.id);
                        return (
                          <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0 3px 8px", fontSize: 12.5, color: C.text, cursor: canEdit ? "pointer" : "default" }}>
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
                  ));
                })()}
              </div>
            </div>
            {/* 食譜／SOP／成本卡（版本流水 pm_recipe_v_；成本＝用料×最近實付價＋包材） */}
            <RecipeCard product={selP} db={db} canEdit={canEdit} showMoney={showMoney} userName={userName} K={K} />
          </div>
        </div>
      )}
    </div>
  );
}
