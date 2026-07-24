// ── 工程專案：總覽表（Notion-style）＋付款紀錄面板＋狀態徽章 ─────────────────────
// 由 App.jsx 原樣搬出（2026-07-18 拆檔第二刀；行為/畫面零改變）。
import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { createPortal } from "react-dom";
import { uploadPhoto, deletePhotoFile } from "../supa.js";
import { fmt, taxOf, estAmount, paidOf, pretaxOf, catRawEst, catPretaxSub, catDiscount, catEstAfter, catItemEstAfter, PAY_CATEGORIES, catPaid, catItemPaidMap, isFundingCat } from "../lib/cost.js";
import { ACCENT, PRIMARY, BG, SURFACE, BORDER, TEXT, SUB } from "../lib/theme.jsx";
import { showMoney, L } from "../lib/runtime.js";
import { parseNum } from "../lib/num.js";
import { STATUS_MAP, markCatDone, syncCatStatus } from "../lib/status.js";
import { SidePanel, inputStyle } from "../lib/ui.jsx";

const COST_COL_IDS = new Set(["estQty", "unit", "estUnitPrice", "taxType", "taxAmount", "estTotal", "itemPaid", "payAccount", "payDate"]);

// ── OVERVIEW TABLE (Notion-style) ────────────────────────────────────────────
export const COLS = [
  { id:"payDate",  label:"付款日",  w:120 }, // 付款日移到最左
  { id:"name",     label:"細項名稱", w:200, fixed:true },
  { id:"status",   label:"狀態",   w:90 },
  // 金額區
  { id:"estQty",   label:"數量",   w:70 },
  { id:"unit",     label:"單位",   w:56 },
  { id:"estUnitPrice", label:"單價", w:100 },
  { id:"taxType",  label:"稅別",   w:84 },
  { id:"taxAmount",label:"稅額",   w:90 },
  { id:"estTotal", label:"預估金額", w:120 },
  // 付款區
  { id:"itemPaid", label:"已付/未付", w:130 }, // 逐項付款狀態（從大項付款紀錄依品項加總）
  { id:"cat",      label:"大項",   w:120 }, // 可下拉移動細項到其他大項（移到付款帳號左邊）
  { id:"payAccount",  label:"付款帳號", w:130 },
  { id:"assignee", label:"負責人",  w:100 },
  { id:"receipts", label:"憑證",   w:104 },
  // 其他
  { id:"notes",    label:"備註",   w:180 },
];

const MONEY_FIELDS = new Set(["estUnitPrice"]); // 只有這些 number 欄要加 NT$
// 安全地計算公式（變數來自 ctx；錯誤回傳空）
function evalFormula(expr, ctx) {
  if (!expr) return 0;
  try {
    const keys = Object.keys(ctx);
    const fn = new Function(...keys, `"use strict"; try { return (${expr}); } catch(e){ return null; }`);
    const v = fn(...keys.map(k => ctx[k]));
    return (typeof v === "number" && isFinite(v)) ? v : (v ?? "");
  } catch (_) { return ""; }
}
function CustomInput({ value, type, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => { setLocal(value ?? ""); }, [value]);
  const isNum = type === "number" || type === "money";
  const display = (type === "money" && value !== undefined && value !== "" && value !== null) ? fmt(Number(value)||0) : (value ?? "");
  if (editing) {
    return <input autoFocus value={local} onChange={e=>setLocal(e.target.value)}
      onBlur={()=>{ onCommit(isNum ? parseNum(local) : local); setEditing(false); }}
      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Escape") e.target.blur(); }}
      style={{ width:"100%", border:"none", outline:"2px solid "+ACCENT, borderRadius:4, padding:"2px 4px", fontSize:12.5, fontFamily:"'Noto Sans TC',sans-serif", background:"#fbeee6" }} />;
  }
  return <div onClick={()=>{ setLocal(value ?? ""); setEditing(true); }} style={{ width:"100%", cursor:"text", minHeight:22, color: (value!==undefined&&value!=="")?"#211C15":"#CDC3AC", padding:"2px 2px" }}>{display || "—"}</div>;
}
export function OverviewTable({ cats, setCats, confirm, customCols = [], setCustomCols, onSelect, dragging, dragOver, onDragStart, onDragOver, onDrop, trash = [], trashItems, restoreTrash, commitTrash, petty, setView }) {
  // 零用金實支依工種（在總覽各大項旁顯示「🪙零用金 +$X」）
  const pettyByCat = useMemo(() => { const m = {}; (petty?.spends || []).forEach(s => { if (s.catId) m[s.catId] = (m[s.catId] || 0) + (Number(s.amount) || 0); }); return m; }, [petty]);
  const [showTrash, setShowTrash] = useState(false);
  const [newColLabel, setNewColLabel] = useState("");
  const [newColType, setNewColType] = useState("money");
  const [newColFormula, setNewColFormula] = useState("");
  const [dragRowId, setDragRowId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [showColMenu, setShowColMenu] = useState(false);
  const [editCell, setEditCell] = useState(null); // {rowId, col}
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const [viewMode, setViewMode] = useState("table"); // 已移除卡片檢視，固定表格
  const [collapsed, setCollapsed] = useState(new Set()); // 收合的大項 id
  // 預設全部收合（只做一次；之後使用者展開/收合自行決定）
  const didInitCollapse = useRef(false);
  useEffect(() => { if (!didInitCollapse.current && cats.length) { setCollapsed(new Set(cats.map(c => c.id))); didInitCollapse.current = true; } }, [cats]);
  const toggleCollapse = (catId) => setCollapsed(s => { const n = new Set(s); n.has(catId) ? n.delete(catId) : n.add(catId); return n; });
  const allCollapsed = cats.length > 0 && cats.every(c => collapsed.has(c.id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(cats.map(c => c.id)));
  const [lightbox, setLightbox] = useState(null); // 憑證放大檢視
  const [rcpBusy, setRcpBusy] = useState(null);    // 正在上傳憑證的 itemId
  const [rcpAdd, setRcpAdd] = useState(null);      // 憑證上傳小彈窗：{catId,item,x,y}
  const [payCatId, setPayCatId] = useState(null);  // 開啟付款紀錄面板的大項 id
  const [groupEditId, setGroupEditId] = useState(null); // 正在編輯費用群組標籤的大項
  const [catNameEdit, setCatNameEdit] = useState(null);  // 正在改名的大項
  const [groupsOpen, setGroupsOpen] = useState(true);   // 費用群組合計面板展開
  const [groupMode, setGroupMode] = useState(false);    // 分類模式：每列顯示群組/非工程編輯
  const allGroups = [...new Set(cats.map(c => c.group).filter(Boolean))];
  const setCatGroup = (catId, g) => setCats(prev => prev.map(c => c.id === catId ? { ...c, group: g || "" } : c));
  const setCatNonProj = (catId, v) => setCats(prev => prev.map(c => c.id === catId ? { ...c, nonProject: v } : c));

  // Flatten all items into rows with cat info
  const allRows = [];
  [...cats].sort((a,b) => a.order - b.order).forEach(cat => {
    cat.items.forEach(item => {
      allRows.push({ catId: cat.id, catName: cat.name, item });
    });
  });

  const matchRow = (r) => { if (!q) return true; const it = r.item; return [it.name, it.assignee, it.notes, r.catName, it.unit].filter(Boolean).join(" ").toLowerCase().includes(q); };
  const rows = allRows.filter(r => (filterStatus === "all" || r.item.status === filterStatus) && matchRow(r));

  const updateItem = (catId, itemId, field, val) => {
    setCats(prev => prev.map(c => {
      if (c.id !== catId) return c;
      const items = c.items.map(it => {
        if (it.id !== itemId) return it;
        const next = { ...it, [field]: val };
        if (field === "status") next.done = val === "done"; // 狀態與 done 同步
        // 改數量或單價 → 金額回到「數量×單價」（解除匯入時鎖定的單據小計），避免新舊不一致
        if (["estQty", "qty", "estUnitPrice", "unitPrice"].includes(field)) {
          const q = Number(next.estQty ?? next.qty) || 0;
          const u = Number(next.estUnitPrice ?? next.unitPrice) || 0;
          next.amount = Math.round(q * u);
        }
        return next;
      });
      const c2 = { ...c, items };
      return field === "status" ? syncCatStatus(c2) : c2; // 改細項狀態 → 回算大項狀態
    }));
  };
  // 移動細項到其他大項：把「此細項的已付」一起帶走（含分攤到它的整批付款），來源不留殘渣、金額守恆
  const moveItemToCat = (fromCatId, itemId, toCatId) => {
    if (fromCatId === toCatId) return;
    setCats(prev => {
      const from = prev.find(c => c.id === fromCatId); if (!from) return prev;
      const it = (from.items || []).find(x => x.id === itemId); if (!it) return prev;
      const pays = from.payments || [];
      const linked = pays.filter(p => p.itemId === itemId);            // 已綁此細項的付款 → 整筆跟著走
      const linkedSum = linked.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const itemPaidTotal = catItemPaidMap(from)[itemId] || 0;          // 此細項實際已付（含整批分攤）
      let lumpShare = Math.max(0, itemPaidTotal - linkedSum);           // 來自「整批/未指定」付款、該分給此細項的部分

      // 從來源的「未指定」付款扣掉 lumpShare（依序扣、扣完即止）
      let remain = lumpShare;
      const fromPays = [];
      for (const p of pays) {
        if (p.itemId === itemId) continue;                             // linked 已搬走
        if (!p.itemId && remain > 0) {                                  // 未指定付款 → 扣抵
          const amt = Number(p.amount) || 0;
          if (amt <= remain) { remain -= amt; continue; }              // 整筆被扣掉
          fromPays.push({ ...p, amount: amt - remain }); remain = 0;    // 部分扣抵
        } else fromPays.push(p);
      }
      // 目的地：linked 付款 + 一筆代表分攤過來的已付（綁定此細項）
      const toAdd = [...linked];
      if (lumpShare > 0) toAdd.push({ id: "pay-" + Math.random().toString(36).slice(2, 8), date: new Date().toISOString().slice(0, 10), amount: lumpShare, category: "其他", note: `隨「${it.name}」自${from.name}移轉`, itemId, receipts: [] });

      return prev.map(c => {
        if (c.id === fromCatId) return { ...c, items: c.items.filter(x => x.id !== itemId), payments: fromPays };
        if (c.id === toCatId) return { ...c, items: [...(c.items || []), it], payments: [...(c.payments || []), ...toAdd] };
        return c;
      });
    });
  };
  // 整張報價單付到 X%：該組各品項各付 X%、最後一筆吸收進位差→整組精確
  const payReport = (catId, itemIds, ratio) => {
    setCats(prev => prev.map(c => {
      if (c.id !== catId) return c;
      const estMap = catItemEstAfter(c);
      const estOf = (id) => estMap[id] ?? estAmount(c.items.find(x => x.id === id) || {});
      const target = Math.round(itemIds.reduce((s, id) => s + estOf(id), 0) * ratio);
      const pays = (c.payments || []).filter(p => !itemIds.includes(p.itemId)); // 移除這些品項的舊付款
      let acc = 0;
      itemIds.forEach((id, i) => {
        let amt = (i === itemIds.length - 1) ? Math.max(0, target - acc) : Math.round(estOf(id) * ratio);
        if (i < itemIds.length - 1) acc += amt;
        if (amt > 0) pays.push({ id: "pay-" + Math.random().toString(36).slice(2, 8), date: new Date().toISOString().slice(0, 10), amount: amt, category: ratio >= 1 ? "尾款" : "訂金", note: `報價單付到 ${Math.round(ratio * 100)}%`, itemId: id, receipts: [] });
      });
      return { ...c, payments: pays };
    }));
  };

  const addReceipts = async (catId, item, files) => {
    if (!files || !files.length) return;
    setRcpBusy(item.id);
    const out = [];
    for (const f of files) {
      try { const { url, path } = await uploadPhoto(f); out.push({ id: "rc-" + Math.random().toString(36).slice(2, 8), url, path, name: f.name || "憑證", isImage: /^image\//.test(f.type) }); }
      catch (_) {}
    }
    setRcpBusy(null);
    if (out.length) updateItem(catId, item.id, "receipts", [...(item.receipts || []), ...out]);
  };
  const removeReceipt = async (catId, item, rid, ri) => {
    const r = (item.receipts || [])[ri];
    if (r?.path) { try { await deletePhotoFile(r.path); } catch (_) {} }
    updateItem(catId, item.id, "receipts", (item.receipts || []).filter((_, i) => i !== ri));
  };

  const deleteItem = (catId, itemId, name) => {
    confirm(`刪除「${name}」？（可到垃圾桶還原）`).then(ok => {
      if (!ok) return;
      const c = cats.find(x => x.id === catId); const it = c?.items.find(x => x.id === itemId);
      if (it && trashItems) trashItems(catId, c.name, [it]);
      setCats(prev => prev.map(c => c.id === catId ? { ...c, items: c.items.filter(it => it.id !== itemId) } : c));
    });
  };

  // Row drag-drop (reorder within same cat, or across cats)
  const onRowDragStart = (rowKey) => setDragRowId(rowKey);
  const onRowDrop = (targetKey) => {
    if (!dragRowId || dragRowId === targetKey) { setDragRowId(null); setDragOverId(null); return; }
    // Move item in cats
    const [srcCatId, srcItemId] = dragRowId.split("||");
    const [tgtCatId, tgtItemId] = targetKey.split("||");
    setCats(prev => {
      let newCats = prev.map(c => ({ ...c, items: [...c.items] }));
      const srcCat = newCats.find(c => c.id === srcCatId);
      const tgtCat = newCats.find(c => c.id === tgtCatId);
      const srcIdx = srcCat.items.findIndex(i => i.id === srcItemId);
      const tgtIdx = tgtCat.items.findIndex(i => i.id === tgtItemId);
      const [moved] = srcCat.items.splice(srcIdx, 1);
      if (srcCatId === tgtCatId) {
        srcCat.items.splice(tgtIdx, 0, moved);
      } else {
        tgtCat.items.splice(tgtIdx, 0, moved);
      }
      return newCats;
    });
    setDragRowId(null); setDragOverId(null);
  };

  // ── 統一欄位（內建+自訂，皆可排序/改名/刪除/調寬）──
  const builtinMap = Object.fromEntries(COLS.map(c => [c.id, c]));
  const cols = (customCols && customCols.length) ? customCols : COLS.map(c => ({ id:c.id, label:c.label, builtin:true, fixed:!!c.fixed, w:c.w }));
  const resolve = (e) => e.builtin ? { ...builtinMap[e.id], label: e.label ?? builtinMap[e.id]?.label, w: e.w ?? builtinMap[e.id]?.w, builtin:true, fixed: e.fixed ?? builtinMap[e.id]?.fixed } : e;
  const relabel = (c) => c.id === "cat" ? { ...c, label: L("cat") } : c.id === "name" ? { ...c, label: L("item") + "名稱" } : c;
  const orderedCols = cols.map(resolve).filter(c => c && c.id).filter(c => showMoney() || !COST_COL_IDS.has(c.id)).map(relabel);
  const totalW = orderedCols.reduce((s,c) => s + (c.w || 110), 0) + 48;

  const NUM_BUILTIN = new Set(["estQty","estUnitPrice","taxAmount","estTotal","itemPaid","paid","unpaid"]);
  const MONEY_TOTAL = new Set(["taxAmount","estTotal","itemPaid","paid","unpaid"]); // 內建總計顯示為金額
  const NO_SUM = new Set(["estUnitPrice"]); // 單價不加總
  const isNumCol = (col) => col.builtin ? NUM_BUILTIN.has(col.id) : (col.type === "money" || col.type === "number" || col.type === "formula");
  const isMoneyCol = (col) => col.builtin ? (MONEY_TOTAL.has(col.id) || ["estUnitPrice"].includes(col.id)) : (col.type === "money" || col.type === "formula");
  const summable = (col) => isNumCol(col) && !NO_SUM.has(col.id);

  const buildCtx = (item) => {
    const ctx = {
      estQty: Number(item.estQty ?? item.qty ?? 0),
      estUnitPrice: Number(item.estUnitPrice ?? item.unitPrice ?? 0),
      taxAmount: taxOf(item),
      estTotal: estAfterOf(item),
      paid: paidOf(item),
      unpaid: unpaidAfterOf(item),
    };
    cols.filter(c => c.builtin === false && c.type !== "formula").forEach(c => { ctx[c.id] = c.type === "text" ? (item.cust?.[c.id] || "") : (Number(item.cust?.[c.id]) || 0); });
    cols.filter(c => c.builtin === false && c.type === "formula").forEach(c => { ctx[c.id] = evalFormula(c.formula, ctx); });
    return ctx;
  };
  // 逐筆議價後預估金額（跨所有大項合併成一張對照表）
  const estAfterMap = {};
  for (const c of cats) Object.assign(estAfterMap, catItemEstAfter(c));
  const estAfterOf = (it) => (it.id in estAfterMap) ? estAfterMap[it.id] : estAmount(it);
  const unpaidAfterOf = (it) => estAfterOf(it) - paidOf(it);
  // 逐項已付（含整批付款自動分攤）
  const itemPaidMap = {};
  for (const c of cats) Object.assign(itemPaidMap, catItemPaidMap(c));
  const itemPaidOf = (it) => itemPaidMap[it.id] || 0;

  const numVal = (col, item) => {
    if (col.builtin) {
      if (col.id === "estTotal") return estAfterOf(item);
      if (col.id === "taxAmount") return taxOf(item);
      if (col.id === "itemPaid") return itemPaidOf(item);
      if (col.id === "paid") return paidOf(item);
      if (col.id === "unpaid") return unpaidAfterOf(item);
      const m = { estQty:item.estQty??item.qty, estUnitPrice:item.estUnitPrice??item.unitPrice };
      return Number(m[col.id]) || 0;
    }
    return Number(buildCtx(item)[col.id]) || 0;
  };

  const updateCustom = (catId, itemId, colId, val) => setCats(prev => prev.map(c => c.id===catId ? { ...c, items: c.items.map(it => it.id===itemId ? { ...it, cust: { ...(it.cust||{}), [colId]: val } } : it) } : c) );
  const addCustomCol = () => {
    if (!setCustomCols) return;
    const label = newColLabel.trim(); if (!label) return;
    const id = "cc-" + Math.random().toString(36).slice(2,6);
    setCustomCols([...cols, { id, label, type:newColType, formula: newColType==="formula"?newColFormula.trim():undefined, w:110, builtin:false }]);
    setNewColLabel(""); setNewColFormula("");
  };
  const delCol = (id) => { if (!setCustomCols) return; const c = cols.find(x=>x.id===id); if (c?.fixed) return; setCustomCols(cols.filter(x => x.id !== id)); };
  const renameCol = (id, label) => setCustomCols && setCustomCols(cols.map(c => c.id===id ? { ...c, label } : c));
  const setColW = (id, w) => setCustomCols && setCustomCols(cols.map(c => c.id===id ? { ...c, w: Math.max(50, Math.round(w)) } : c));
  const reAddBuiltin = (id) => { if (!setCustomCols) return; const def = builtinMap[id]; if (!def) return; setCustomCols([...cols, { id, label:def.label, builtin:true, fixed:false, w:def.w }]); };
  const moveCol = (dragId, targetId) => { if (!setCustomCols || dragId===targetId) return; const arr=[...cols]; const fi=arr.findIndex(c=>c.id===dragId), ti=arr.findIndex(c=>c.id===targetId); if (fi<0||ti<0||arr[fi].fixed||arr[ti].fixed) return; const [m]=arr.splice(fi,1); arr.splice(ti,0,m); setCustomCols(arr); };
  const startColResize = (id, e) => { e.preventDefault(); e.stopPropagation(); const startX=e.clientX; const startW = (cols.find(c=>c.id===id)?.w) || builtinMap[id]?.w || 110; const move=(ev)=>setColW(id, startW + ev.clientX - startX); const up=()=>{ document.removeEventListener("mousemove",move); document.removeEventListener("mouseup",up); }; document.addEventListener("mousemove",move); document.addEventListener("mouseup",up); };
  const [colDrag, setColDrag] = useState(null);

  const cellStyle = (col) => ({
    minWidth: col.w, maxWidth: col.w, width: col.w,
    padding: "0 8px", borderRight: "1px solid #d9cfbd",
    fontSize: 12.5, overflow: "hidden", whiteSpace: "nowrap",
    textOverflow: "ellipsis", height: 30, display: "flex", alignItems: "center",
    flexShrink: 0,
    // 金額/數字欄：右對齊 + 等寬數字（財務表格基本排版，方便上下比對位數）
    ...(COST_COL_IDS.has(col.id) ? { justifyContent: "flex-end", fontVariantNumeric: "tabular-nums" } : {}),
  });

  const EditableCell = ({ catId, itemId, field, value, type="text", placeholder="" }) => {
    const key = `${itemId}||${field}`;
    const isEditing = editCell === key;
    // 數字欄位：值為 0 時編輯框顯示空白，可直接打數字（不用先刪掉 0）
    const toLocal = (v) => (type === "number" && (v === 0 || v === "0" || v == null)) ? "" : String(v ?? "");
    const [local, setLocal] = useState(toLocal(value));
    useEffect(() => { setLocal(toLocal(value)); }, [value]);
    if (type === "date") {
      const iso = String(value ?? "").replace(/\//g, "-").slice(0, 10);
      return (
        <input
          type="date"
          value={iso}
          onChange={e => updateItem(catId, itemId, field, e.target.value)}
          style={{ width: "100%", border: "none", outline: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, fontFamily: "'Noto Sans TC', sans-serif", color: iso ? "#211C15" : "#CDC3AC", padding: "2px 2px", colorScheme: "light" }}
        />
      );
    }
    if (isEditing) {
      return (
        <input
          autoFocus
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={() => {
            const v = type === "number" ? parseNum(local) : local;
            updateItem(catId, itemId, field, v);
            setEditCell(null);
          }}
          onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); }}
          style={{ width: "100%", border: "none", outline: "2px solid " + ACCENT, borderRadius: 4, padding: "2px 4px", fontSize: 12.5, fontFamily: "'Noto Sans TC', sans-serif", background: "#fbeee6" }}
        />
      );
    }
    return (
      <div onClick={() => { setLocal(String(value ?? "")); setEditCell(key); }}
        style={{ width: "100%", cursor: "text", minHeight: 22, color: value ? "#211C15" : "#CDC3AC", padding: "2px 2px", borderRadius: 3, transition: "background 0.1s" }}
        onMouseEnter={e => e.currentTarget.style.background="#f0f7ff"}
        onMouseLeave={e => e.currentTarget.style.background="transparent"}
      >
        {type === "number" && value ? (MONEY_FIELDS.has(field) ? fmt(value) : value) : (value || placeholder || "—")}
      </div>
    );
  };

  const catGroups = {};
  // 「全部」檢視且未搜尋時，先列出所有大項（含 0 細項的空大項）；搜尋時只顯示有命中細項的大項
  if (filterStatus === "all" && !q) {
    [...cats].sort((a,b) => a.order - b.order).forEach(c => { catGroups[c.id] = { name: c.name, rows: [] }; });
  }
  rows.forEach(r => {
    if (!catGroups[r.catId]) catGroups[r.catId] = { name: r.catName, rows: [] };
    catGroups[r.catId].rows.push(r);
  });

  return (
    <div style={{ paddingTop: 12 }}>
      <datalist id="cat-group-list">{allGroups.map(g => <option key={g} value={g} />)}</datalist>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, letterSpacing: -0.2 }}>總覽</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{L("subtitle")}</div>
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 360 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#9b9384", pointerEvents: "none" }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋細項／負責人／備註…" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${search ? ACCENT : BORDER}`, borderRadius: 8, padding: "6px 28px 6px 30px", fontSize: 13, background: "#fff", color: TEXT, outline: "none" }} />
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", color: SUB, cursor: "pointer", fontSize: 14 }}>×</button>}
        </div>
        <div style={{ flex: 1 }} />
        {/* 全部收合／展開：原本大小、置中、發光黑框 */}
        <button onClick={toggleAll} title="一鍵收合或展開所有工程大項" className="black-glow"
          style={{ padding: "7px 16px", borderRadius: 8, border: "2px solid #111", fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: "pointer", background: "#fff", color: "#111", transition: "all .15s", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#111"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#111"; }}>
          <span style={{ fontSize: 14, fontWeight: 900 }}>{allCollapsed ? "⊕" : "⊖"}</span>{allCollapsed ? "全部展開" : "全部收合"}
        </button>
        <div style={{ flex: 1 }} />
        {viewMode === "table" && showMoney() && (
          <button onClick={() => setGroupMode(m => !m)} title="分類模式：設定每個大項的費用群組與是否計入工程" style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${groupMode ? ACCENT : BORDER}`, fontSize: 12.5, cursor: "pointer", background: groupMode ? "#fbeee6" : SURFACE, color: groupMode ? ACCENT : SUB, fontWeight: 500 }}>🏷 分類{groupMode ? "中" : ""}</button>
        )}
        <button onClick={() => setShowTrash(true)} title="垃圾桶（刪除的細項可還原）" style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${BORDER}`, fontSize: 12.5, cursor: "pointer", background: SURFACE, color: SUB, fontWeight: 500 }}>🗑 垃圾桶{trash.length ? ` ${trash.length}` : ""}</button>
      </div>

      {/* 工程／非工程／全部 三分類合計 */}
      {viewMode === "table" && showMoney() && (() => {
        let pe = 0, pp = 0, ne = 0, np = 0; // 工程est/paid, 非工程est/paid
        cats.forEach(c => { if (isFundingCat(c)) return; const e = catEstAfter(c), pd = catPaid(c); if (c.nonProject) { ne += e; np += pd; } else { pe += e; pp += pd; } });
        const card = (label, est, paid, color, bg) => (
          <div style={{ flex: 1, minWidth: 200, background: bg, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>{fmt(est)}</div>
            <div style={{ fontSize: 11.5, color: SUB, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>已付 <b style={{ color: "#3C8C3C" }}>{fmt(paid)}</b> · 未付 <b style={{ color: (est - paid) > 0 ? "#C2872E" : "#3C8C3C" }}>{fmt(est - paid)}</b></div>
          </div>
        );
        return (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {card("🏗 工程費用合計", pe, pp, "#2E7D32", "#EAF3EA")}
            {card("● 非工程（業主自理等）", ne, np, ACCENT, SURFACE)}
            {card("全部合計", pe + ne, pp + np, TEXT, SURFACE)}
          </div>
        );
      })()}

      {/* 費用群組合計（自訂分群，例：廣告機螢幕群）*/}
      {viewMode === "table" && showMoney() && allGroups.length > 0 && (() => {
        const g = {};
        allGroups.forEach(name => { g[name] = { name, n: 0, pretax: 0, est: 0, paid: 0 }; });
        cats.forEach(c => { if (c.group && g[c.group]) { const gg = g[c.group]; gg.n++; gg.pretax += catPretaxSub(c); gg.est += catEstAfter(c); gg.paid += catPaid(c); } });
        const list = Object.values(g).sort((a, b) => b.est - a.est);
        return (
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: groupsOpen ? 10 : 0 }}>
              <button onClick={() => setGroupsOpen(o => !o)} style={{ border: "none", background: "none", cursor: "pointer", color: SUB, fontSize: 11, transform: groupsOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</button>
              <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>🏷 費用群組合計</div>
              <span style={{ fontSize: 12, color: SUB }}>{list.length} 群</span>
            </div>
            {groupsOpen && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
              {list.map(x => { const unpaid = x.est - x.paid; return (
                <div key={x.name} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 6 }}>{x.name} <span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}>· {x.n} 項</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: SUB }}>未稅 <b style={{ color: TEXT }}>{fmt(x.pretax)}</b></span>
                    <span style={{ color: SUB }}>含稅 <b style={{ color: ACCENT }}>{fmt(x.est)}</b></span>
                    <span style={{ color: SUB }}>已付 <b style={{ color: "#3C8C3C" }}>{fmt(x.paid)}</b></span>
                    <span style={{ color: SUB }}>未付 <b style={{ color: unpaid > 0 ? "#C2872E" : "#3C8C3C" }}>{fmt(unpaid)}</b></span>
                  </div>
                </div>); })}
            </div>}
          </div>
        );
      })()}

      {(
      /* table */
      <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${BORDER}`, background: SURFACE }}>
        <div style={{ minWidth: totalW }}>
          {/* header */}
          <div style={{ display: "flex", background: BG, borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ width: 24, flexShrink: 0, borderRight: `1px solid ${BORDER}` }} />
            {orderedCols.map(col => (
              <div key={col.id} style={{ ...cellStyle(col), position: "relative", fontWeight: 500, fontSize: 12, color: SUB, letterSpacing: 0.2, background: BG }}>
                <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{col.label}{col.type==="formula" && <span style={{ fontSize:9, marginLeft:3 }}>ƒ</span>}</span>
                {setCustomCols && <div onMouseDown={e=>startColResize(col.id, e)} title="拖曳調整欄寬" style={{ position:"absolute", right:-3, top:0, bottom:0, width:7, cursor:"col-resize", zIndex:2 }} />}
              </div>
            ))}
            <div style={{ width: 32, flexShrink: 0 }} />
          </div>

          {/* rows grouped by cat */}
          {Object.entries(catGroups).map(([catId, group]) => {
            const cat = cats.find(c => c.id === catId);
            const groupRaw = cat ? catRawEst(cat) : group.rows.reduce((s,r) => s + estAmount(r.item), 0); // 原報價（未折）
            const disc = cat ? catDiscount(cat) : { hasDiscount: false, factor: 1, pct: 0, sub: 0 };
            const groupEst = cat ? catEstAfter(cat) : groupRaw; // 議價後含稅
            const groupPretax = cat ? catPretaxSub(cat) : 0; // 未稅小計（對應報價單未稅總價）
            const groupSaved = groupRaw - groupEst;
            const groupPaid = cat ? catPaid(cat) : 0; // 已付＝大項付款紀錄加總
            const payCount = cat ? (cat.payments?.length || 0) : 0;
            const groupUnpaid = groupEst - groupPaid;
            const itemCount = cat ? cat.items.length : group.rows.length;
            const doneCount = cat ? cat.items.filter(i => i.status === "done").length : 0;
            const pct = itemCount ? Math.round(doneCount / itemCount * 100) : 0;
            const isCollapsed = !q && collapsed.has(catId); // 搜尋時一律展開
            const isCatDragOver = dragOver === catId;
            // 依「付款日＋廠商」把同一張報價單的細項分組 → 淡色背景區分 + 小計
            const QUOTE_TINTS = ["#f4efe5", "#EDF3F6", "#F4EEF4", "#EDF5EE", "#FBF0EA"];
            const quoteKeyOf = (it) => `${it.payDate || ""}¦${it.assignee || ""}`;
            const quoteOrder = []; const quoteInfo = {};
            group.rows.forEach(({ item }) => { if (item.fromPetty) return; const k = quoteKeyOf(item); if (!quoteInfo[k]) { quoteInfo[k] = { idx: quoteOrder.length, sum: 0, n: 0, date: item.payDate || "", vendor: item.assignee || "" }; quoteOrder.push(k); } quoteInfo[k].sum += estAfterOf(item); quoteInfo[k].n++; });
            const qualifies = (k) => { const q = quoteInfo[k]; return !!(q && (q.date || q.vendor)); }; // 有日期或廠商＝可視為一張報價單（零用金細項不在表內→null-safe）
            const multiQuote = showMoney() && quoteOrder.some(qualifies) && quoteOrder.length >= 2;
            // 有標籤的大項整行反底色：預估群組→藍、非工程→黃、其他費用群組→淡褐
            const isEstimate = !!(cat?.group && /預估/.test(cat.group));
            const isFunding = !!(cat && /零用金/.test(cat.name || "")); // 撥款帳：不計入工程成本
            const tagTint = isFunding ? "#EDEAE3" : isEstimate ? "#E4EDF7" : cat?.nonProject ? "#FBF1CF" : cat?.group ? "#ece4d6" : null;
            const tagAccent = isFunding ? "#9A8F78" : isEstimate ? "#3E72A8" : cat?.nonProject ? "#C2872E" : ACCENT;
            return (
              <div key={catId}>
                {/* cat group header — 可收合 / 拖曳排序 / 狀態 / 進度 */}
                <div
                  draggable={!!onDragStart}
                  onDragStart={() => onDragStart && onDragStart(catId)}
                  onDragOver={e => { if (onDragOver) { e.preventDefault(); onDragOver(catId); } }}
                  onDrop={() => onDrop && onDrop(catId)}
                  onDragEnd={() => onDragOver && onDragOver(null)}
                  style={{ display: "flex", alignItems: "center", background: isCatDragOver ? "#fbeee6" : (tagTint || BG), borderBottom: `1px solid ${BORDER}`, borderLeft: `2px solid ${tagAccent}`, padding: "0 10px", height: 32, gap: 10, position: "sticky", top: 40, zIndex: 9 }}>
                  <span title="拖曳排序大項" style={{ cursor: "grab", color: "#C8BCA0", fontSize: 13, flexShrink: 0 }}>⠿</span>
                  <button onClick={() => toggleCollapse(catId)} style={{ border: "none", background: "none", cursor: "pointer", color: SUB, fontSize: 11, width: 14, flexShrink: 0, transform: isCollapsed ? "none" : "rotate(90deg)", transition: "transform .15s" }}>▸</button>
                  {/* 狀態徽章固定在最左（每列同一起點，不歪） */}
                  <div style={{ flexShrink: 0, width: 60 }}><StatusBadge status={cat?.status || "pending"} setCats={setCats} catId={catId} /></div>
                  {/* 大項名稱（固定寬；非工程＝名稱反黃底，不另外冒出徽章） */}
                  {catNameEdit === catId
                    ? <input autoFocus defaultValue={group.name} onClick={e => e.stopPropagation()} onBlur={e => { const v = e.target.value.trim(); if (v && v !== group.name) setCats(prev => prev.map(c => c.id === catId ? { ...c, name: v } : c)); setCatNameEdit(null); }} onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setCatNameEdit(null); }} style={{ fontSize: 14, fontWeight: 600, color: PRIMARY, border: `1px solid ${ACCENT}`, borderRadius: 6, padding: "2px 6px", width: Math.max(120, group.name.length * 15), flexShrink: 0, outline: "none" }} />
                    : <div style={{ display: "flex", alignItems: "center", gap: 4, width: 184, flexShrink: 0, padding: "1px 6px" }} title={isEstimate ? group.name + "（預估／報價；雙擊可改名）" : cat?.nonProject ? group.name + "（非工程／業主自理；雙擊可改名）" : group.name + "（雙擊可改名）"}>
                        <div onClick={() => toggleCollapse(catId)} onDoubleClick={e => { e.stopPropagation(); setCatNameEdit(catId); }} style={{ fontSize: 14, fontWeight: 600, color: isEstimate ? "#2C5A8C" : cat?.nonProject ? "#92400e" : PRIMARY, letterSpacing: -0.1, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.name}</div>
                        <button onClick={e => { e.stopPropagation(); setCatNameEdit(catId); }} title="改名" style={{ border: "none", background: "none", cursor: "pointer", color: "#C8BCA0", fontSize: 12, padding: 0, flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.color = ACCENT} onMouseLeave={e => e.currentTarget.style.color = "#C8BCA0"}>✎</button>
                      </div>}
                  {isFunding && <span title="撥款帳：公司撥現金給工地，不計入工程成本（實際花費請看「零用金」分頁）" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 600, color: "#6F6656", background: "#E3DDD0", border: "1px solid #CFC6B4", borderRadius: 10, padding: "1px 8px", whiteSpace: "nowrap" }}>撥款·不計成本</span>}
                  {/* 進度（固定寬，空大項也保留位置 → 議價那欄才會對齊） */}
                  <div style={{ width: 82, flexShrink: 0, display: "flex", alignItems: "center", gap: 7 }}>
                    {itemCount > 0 && <>
                      <div style={{ width: 56, height: 5, background: "#E3DAC6", borderRadius: 3, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: pct === 100 ? "#3C8C3C" : "#3E72A8" }} /></div>
                      <span style={{ fontSize: 11, color: SUB }}>{doneCount}/{itemCount}</span>
                    </>}
                  </div>
                  {/* 議價折扣（固定寬欄位 → 每列對齊；套在未稅層、稅金重算，細項原報價不動） */}
                  {showMoney() && (
                    <div style={{ width: 92, flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }} title="大項議價折扣：套用在未稅小計、稅金重算">
                      {itemCount > 0 && <>
                        <span style={{ fontSize: 11, color: SUB, flexShrink: 0 }}>議價</span>
                        <button onClick={() => setCats(prev => prev.map(c => c.id === catId ? { ...c, discountMode: (disc.mode === "amt" ? "pct" : "amt"), discountValue: 0 } : c))}
                          title={disc.mode === "amt" ? "目前：折讓金額（點擊改為折 %）" : "目前：折 %（點擊改為折讓金額）"}
                          style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: ACCENT, borderRadius: 5, width: 22, height: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, flexShrink: 0 }}>{disc.mode === "amt" ? "$" : "%"}</button>
                        <input type="number" min={0} max={disc.mode === "amt" ? Math.round(disc.sub) : 100} value={cat?.discountValue || ""} placeholder={disc.mode === "amt" ? "折讓$" : "折%"}
                          onChange={e => { const max = disc.mode === "amt" ? catRawEst(cat) : 100; let v = Math.min(Math.max(Number(e.target.value) || 0, 0), max); setCats(prev => prev.map(c => c.id === catId ? { ...c, discountMode: disc.mode, discountValue: v } : c)); }}
                          style={{ width: 48, height: 20, border: `1px solid ${disc.hasDiscount ? "#C0392B" : BORDER}`, borderRadius: 5, padding: "0 5px", fontSize: 11, fontVariantNumeric: "tabular-nums", background: "#fff", color: TEXT }} />
                      </>}
                    </div>
                  )}
                  {/* 費用群組設定／徽章（放在彈性區，不影響左側欄位對齊） */}
                  {showMoney() && (groupMode || groupEditId === catId ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: 6 }}>
                      <input list="cat-group-list" autoFocus={groupEditId === catId} defaultValue={cat?.group || ""} key={cat?.group || ""} onBlur={e => { setCatGroup(catId, e.target.value.trim()); setGroupEditId(null); }} onKeyDown={e => { if (e.key === "Enter") { setCatGroup(catId, e.target.value.trim()); setGroupEditId(null); } if (e.key === "Escape") setGroupEditId(null); }} placeholder="費用群組…" style={{ width: 100, border: `1px solid ${ACCENT}`, borderRadius: 12, padding: "2px 8px", fontSize: 11, background: "#fff", color: TEXT, outline: "none" }} />
                      <button onClick={() => setCatNonProj(catId, !cat?.nonProject)} title="是否計入工程費用" style={{ border: `1px solid ${cat?.nonProject ? "#C2872E" : BORDER}`, background: cat?.nonProject ? "#FFFBEB" : "transparent", color: cat?.nonProject ? "#C2872E" : SUB, borderRadius: 12, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>{cat?.nonProject ? "非工程" : "計入工程"}</button>
                    </div>
                  ) : (
                    cat?.group && <button onClick={() => setGroupEditId(catId)} title="點擊改費用群組" style={{ flexShrink: 0, marginLeft: 6, border: `1px solid ${isEstimate ? "#9DBCE0" : "#C8BCA0"}`, background: isEstimate ? "#DCE8F5" : "#fbeee6", color: isEstimate ? "#2C5A8C" : "#92400e", borderRadius: 12, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🏷 {cat.group}</button>
                  ))}
                  {showMoney() && isCollapsed && pettyByCat[catId] > 0 && <span onClick={() => setView && setView("petty")} title={`此工種的零用金實支 ${fmt(pettyByCat[catId])}（已併入工程實際成本，來源：零用金帳戶）— 點擊看零用金頁`} style={{ flexShrink: 0, marginLeft: 6, fontSize: 11, fontWeight: 600, color: "#C2410C", background: "#FBEFE7", border: "1px solid #F0CFB8", borderRadius: 12, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>🪙 零用金 +{fmt(pettyByCat[catId])}</span>}
                  {!showMoney() && <div style={{ flex: 1 }} />}
                  {showMoney() && <>
                  <div style={{ flex: 1 }} />
                  {(() => {
                    const isEmpty = groupEst === 0 && groupPaid === 0;
                    const over = groupUnpaid < 0;
                    const colNum = (label, val, opts = {}) => <div style={{ width: 150, textAlign: "right", flexShrink: 0, fontSize: 12.5, color: SUB }} title={opts.title}>{label} <span style={{ color: opts.color || TEXT, fontVariantNumeric: "tabular-nums", fontWeight: opts.fw || 500 }}>{val}</span></div>;
                    // 主數字（含稅/議價後）＝這個大項到底多少錢，做成明顯藥丸，不再埋在裡面
                    const colMain = (label, val, opts = {}) => <div style={{ width: 150, textAlign: "right", flexShrink: 0 }} title={opts.title}><span style={{ fontSize: 10.5, color: "#9b9384", marginRight: 5 }}>{label}</span><span style={{ fontSize: 14.5, fontWeight: 800, color: opts.color || "#1A1A1A", fontVariantNumeric: "tabular-nums", background: opts.bg || "#E6DDC9", borderRadius: 6, padding: "2px 8px", letterSpacing: -0.2 }}>{val}</span></div>;
                    // 大項名稱（灰）放在「未付」與「＋新增付款」中間 → 右側數字好對焦；空大項保留同寬位置才不會跑掉
                    const nameCol = <div onClick={() => toggleCollapse(catId)} title={group.name} style={{ width: 130, textAlign: "right", flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: "#9b9384", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{group.name}</div>;
                    if (isEmpty) return (<>
                      <span style={{ fontSize: 12, color: "#C8BCA0", width: 630, textAlign: "right", flexShrink: 0 }}>尚未建立明細</span>
                      {nameCol}
                      <div style={{ width: 96, flexShrink: 0 }} />
                    </>);
                    return (<>
                      {colNum("未稅", fmt(groupPretax), { title: "未稅小計＝Σ數量×單價，對應報價單未稅總價" })}
                      {disc.hasDiscount
                        ? colMain("議價後", fmt(groupEst), { color: "#C0392B", bg: "#FBEAE7", title: `原報價 ${fmt(groupRaw)} → 議價後 ${fmt(groupEst)}，省 ${fmt(groupSaved)}（-${Math.round(disc.pct * 10) / 10}%）` })
                        : colMain("含稅", fmt(groupEst), { title: "含稅總計（這個大項的總金額）" })}
                      {/* 已付金額 / 未付金額：固定兩欄、靠右對齊 */}
                      <button onClick={() => setPayCatId(catId)} title={`檢視／新增付款紀錄${payCount ? `（${payCount} 筆）` : ""}`} style={{ width: 150, textAlign: "right", flexShrink: 0, fontSize: 12.5, color: SUB, border: "none", background: "none", cursor: "pointer", padding: 0 }}>已付 <span style={{ color: groupPaid > 0 ? "#3C8C3C" : "#9b9384", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(groupPaid)}</span></button>
                      <button onClick={() => setPayCatId(catId)} title="未付金額＝含稅 − 已付" style={{ width: 150, textAlign: "right", flexShrink: 0, fontSize: 12.5, color: SUB, border: "none", background: "none", cursor: "pointer", padding: 0 }}>未付 <span style={{ color: over ? "#b3261e" : groupUnpaid > 0 ? "#C2410C" : "#3C8C3C", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{over ? `溢付 ${fmt(-groupUnpaid)}` : fmt(groupUnpaid)}</span></button>
                      {nameCol}
                      <div style={{ width: 96, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={(e) => { e.stopPropagation(); setPayCatId(catId); }} title="新增付款紀錄" style={{ border: `1px solid #3C8C3C`, background: "#F0FDF4", color: "#3C8C3C", borderRadius: 6, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>＋ 新增付款</button>
                      </div>
                    </>);
                  })()}
                  </>}
                  <div style={{ width: 78, flexShrink: 0, display: "flex", justifyContent: "flex-end", marginLeft: 4 }}>{itemCount > 0 && <button onClick={() => confirm(`清空「${group.name}」的全部 ${itemCount} 筆${L("item")}？\n（細項可到垃圾桶還原；付款紀錄一併清除）`, { confirmLabel: "確定清空" }).then(ok => { if (ok) { const c = cats.find(x => x.id === catId); if (c?.items?.length && trashItems) trashItems(catId, c.name, c.items); setCats(prev => prev.map(c => c.id === catId ? { ...c, items: [], payments: [] } : c)); } })} title="清空此大項的所有細項" style={{ border: "1px solid #d9cfbd", background: "transparent", color: SUB, cursor: "pointer", fontSize: 11, borderRadius: 6, padding: "2px 9px", whiteSpace: "nowrap" }} onMouseEnter={e => { e.currentTarget.style.borderColor = "#b3261e"; e.currentTarget.style.color = "#b3261e"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#d9cfbd"; e.currentTarget.style.color = SUB; }}>清空細項</button>}</div>
                  <button onClick={() => confirm(`確定刪除${L("cat")}「${group.name}」？\n（含其下 ${itemCount} 筆${L("item")}，無法復原）`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== catId)); })} title={`刪除此${L("cat")}`} style={{ flexShrink: 0, marginLeft: 4, width: 22, height: 22, borderRadius: "50%", background: "transparent", border: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }} onMouseEnter={e => { e.currentTarget.style.background = "#fbeee6"; e.currentTarget.style.color = "#b3261e"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C8BCA0"; }}>×</button>
                </div>
                {/* item rows（收合時隱藏） */}
                {!isCollapsed && group.rows.map(({ item }, rIdx) => {
                  // 零用金細項：唯讀、同欄位對齊（日期/金額對齊正常細項），前面用 🪙 標示；編輯入口在零用金頁
                  if (item.fromPetty) return (
                    <div key={item.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e6ddc9", background: "#FBF7EE" }}>
                      <div title="來自零用金帳戶（在零用金頁編輯）" style={{ width: 24, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, borderRight: "1px solid #e6ddc9", height: 38 }}>🪙</div>
                      {orderedCols.map(col => {
                        const cs = { ...cellStyle(col) };
                        const ro = { ...cs, color: "#6F6656", fontSize: 12.5 };
                        if (col.id === "payDate") return <div key={col.id} style={ro}>{(item.payDate || "").replace(/-/g, "/") || "—"}</div>;
                        if (col.id === "name") return <div key={col.id} style={{ ...cs, color: "#211C15", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>;
                        if (col.id === "estQty") return <div key={col.id} style={ro}>1</div>;
                        if (col.id === "unit") return <div key={col.id} style={ro}>{item.unit || "式"}</div>;
                        if (col.id === "estUnitPrice") return <div key={col.id} style={{ ...ro, fontFamily: "monospace" }}>{fmt(item.amount)}</div>;
                        if (col.id === "taxType") return <div key={col.id} style={ro}>免稅</div>;
                        if (col.id === "estTotal") return <div key={col.id} style={{ ...cs, fontFamily: "monospace", color: ACCENT, fontWeight: 600 }}>{fmt(item.amount)}</div>;
                        if (col.id === "itemPaid") return <div key={col.id} style={{ ...cs, color: "#3C8C3C", fontSize: 12 }}>✓ 已付</div>;
                        if (col.id === "cat") return <div key={col.id} style={ro}>{group.name}</div>;
                        if (col.id === "assignee") return <div key={col.id} style={ro}>零用金</div>;
                        if (col.id === "receipts") return <div key={col.id} style={{ ...cs, gap: 3 }}>{(item.receipts || []).filter(r => r.isImage).slice(0, 3).map(r => <img key={r.id} src={r.url} alt="" onClick={() => setLightbox(r)} style={{ width: 22, height: 22, objectFit: "cover", borderRadius: 3, border: `1px solid ${BORDER}`, cursor: "zoom-in" }} />)}</div>;
                        if (col.id === "notes") return <div key={col.id} style={{ ...ro, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.notes || ""}</div>;
                        return <div key={col.id} style={ro} />;
                      })}
                    </div>
                  );
                  const rowKey = `${catId}||${item.id}`;
                  const isDragOver = dragOverId === rowKey;
                  const stColor = STATUS_MAP[item.status]?.color || "#6F6656";
                  const tinted = !!item.status && item.status !== "pending"; // 由「狀態」決定整行顏色（待開工=白底）
                  const qk = quoteKeyOf(item); const qi = quoteInfo[qk]; const isQuote = multiQuote && qualifies(qk); const qTint = isQuote ? QUOTE_TINTS[qi.idx % QUOTE_TINTS.length] : null;
                  const newQuote = isQuote && (rIdx === 0 || quoteKeyOf(group.rows[rIdx - 1].item) !== qk);
                  return (
                    <Fragment key={item.id}>
                    {newQuote && (() => { const qItemIds = group.rows.filter(r => quoteKeyOf(r.item) === qk).map(r => r.item.id); return (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: qTint, borderTop: `1px solid ${BORDER}`, borderLeft: `3px solid ${ACCENT}99`, padding: "3px 10px 3px 34px", fontSize: 11.5, color: "#7A6F58" }}>
                        <span style={{ fontWeight: 700 }}>📋 報價單</span>
                        {qi.date && <span>{qi.date.replace(/-/g, "/")}</span>}
                        {qi.vendor && <span>· {qi.vendor}</span>}
                        <span>{qi.n} 筆 · 小計 <b style={{ color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{fmt(qi.sum)}</b></span>
                        <span style={{ flex: 1 }} />
                        <span style={{ color: "#9b9384" }}>整張付款：</span>
                        {[["50%", 0.5], ["30%", 0.3], ["全付清", 1]].map(([lb, r]) => (
                          <button key={lb} onClick={() => payReport(catId, qItemIds, r)} title={`此報價單付到 ${typeof r === "number" && r < 1 ? Math.round(r * 100) + "%" : "全額"}（整組精確）`} style={{ border: `1px solid ${r >= 1 ? "#3C8C3C" : "#C2872E"}`, background: r >= 1 ? "#F0FDF4" : "#FFFBEB", color: r >= 1 ? "#3C8C3C" : "#C2872E", borderRadius: 6, padding: "1px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{lb}</button>
                        ))}
                      </div>
                    ); })()}
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOverId(rowKey); }}
                      onDrop={() => onRowDrop(rowKey)}
                      style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e6ddc9", background: isDragOver ? "#fbeee6" : qTint ? qTint : tinted ? stColor + "1A" : "#fbf8f1", borderLeft: tinted ? `3px solid ${stColor}` : "3px solid transparent", transition: "background 0.15s" }}
                    >
                      {/* drag handle（僅此處可拖曳） */}
                      <div
                        draggable
                        onDragStart={() => onRowDragStart(rowKey)}
                        onDragEnd={() => { setDragRowId(null); setDragOverId(null); }}
                        style={{ width: 24, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", color: "#d1d5db", fontSize: 14, borderRight: "1px solid #e6ddc9", height: 38 }}>⠿</div>

                      {orderedCols.map(col => {
                        const cs = { ...cellStyle(col) };
                        if (col.builtin === false) {
                          if (col.type === "formula") { const v = buildCtx(item)[col.id]; return <div key={col.id} style={{ ...cs, fontFamily:"monospace", fontSize:12, color:"#6F6656" }}>{typeof v === "number" ? fmt(v) : (v || "—")}</div>; }
                          return <div key={col.id} style={cs}><CustomInput value={item.cust?.[col.id]} type={col.type} onCommit={(val)=>updateCustom(catId, item.id, col.id, val)} /></div>;
                        }
                        if (col.id === "cat") return <div key={col.id} style={{ ...cs, padding: "0 4px" }}>
                          <select value={catId} onChange={e => moveItemToCat(catId, item.id, e.target.value)} title="移動此細項到其他大項" style={{ width: "100%", border: "1px solid transparent", borderRadius: 6, padding: "3px 4px", fontSize: 11, color: "#9b9384", background: "transparent", cursor: "pointer" }} onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${BORDER}`; e.currentTarget.style.background = "#fff"; }} onMouseLeave={e => { e.currentTarget.style.border = "1px solid transparent"; e.currentTarget.style.background = "transparent"; }}>
                            {[...cats].sort((a,b)=>a.order-b.order).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>;
                        if (col.id === "name") return <div key={col.id} style={{ ...cs, color: "#211C15", fontWeight: 500, gap: 6 }}>
                          <button onClick={(e) => { e.stopPropagation(); updateItem(catId, item.id, "priority", !item.priority); }} title={item.priority ? "優先追蹤中（點擊取消）" : "標為優先追蹤（AI 會特別關注）"} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, border: "none", background: "transparent", color: item.priority ? "#E8A317" : "#d9cfbd", fontSize: 14, cursor: "pointer", lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{item.priority ? "★" : "☆"}</button>
                          <button onClick={(e) => { e.stopPropagation(); updateItem(catId, item.id, "inSeq", !item.inSeq); }} title={item.inSeq ? "已排入工序（點擊取消同步）" : "排入工序（同步成工序子項目）"} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, border: item.inSeq ? "none" : `1px solid ${BORDER}`, background: item.inSeq ? ACCENT : "transparent", color: item.inSeq ? "#fff" : SUB, fontSize: 10, fontWeight: 600, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>序</button>
                          <EditableCell catId={catId} itemId={item.id} field="name" value={item.name} />
                        </div>;
                        if (col.id === "done") return (
                          <div key={col.id} style={{ ...cs, justifyContent: "center" }}>
                            <input type="checkbox" checked={!!item.done} onChange={e => updateItem(catId, item.id, "done", e.target.checked)}
                              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#3C8C3C" }} />
                          </div>
                        );
                        if (col.id === "status") return (
                          <div key={col.id} style={cs}>
                            <select value={item.status} onChange={e => updateItem(catId, item.id, "status", e.target.value)}
                              style={{ border: "none", background: "transparent", fontSize: 12, cursor: "pointer", color: STATUS_MAP[item.status]?.color || "#6F6656", fontFamily: "'Noto Sans TC', sans-serif", width: "100%", outline: "none" }}>
                              {Object.entries(STATUS_MAP).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                          </div>
                        );
                        if (col.id === "assignee") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="assignee" value={item.assignee} placeholder="指派..." /></div>;
                        if (col.id === "date") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="date" value={item.date} type="date" placeholder="選擇日期" /></div>;
                        if (col.id === "estQty") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="estQty" value={item.estQty ?? item.qty ?? 0} type="number" /></div>;
                        if (col.id === "unit") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="unit" value={item.unit} /></div>;
                        if (col.id === "estUnitPrice") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="estUnitPrice" value={item.estUnitPrice ?? item.unitPrice ?? 0} type="number" /></div>;
                        if (col.id === "taxType") return (
                          <div key={col.id} style={cs}>
                            <select value={item.taxType || "未稅"} onChange={e => updateItem(catId, item.id, "taxType", e.target.value)}
                              style={{ border: "none", background: "transparent", fontSize: 12, cursor: "pointer", color: "#4A4234", fontFamily: "'Noto Sans TC', sans-serif", width: "100%", outline: "none" }}>
                              {["未稅","含稅","免稅"].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        );
                        if (col.id === "taxAmount") return <div key={col.id} style={{ ...cs, color: "#9b9384", fontFamily: "monospace", fontSize: 12 }}>{fmt(taxOf(item))}</div>;
                        if (col.id === "estTotal") {
                          const after = estAfterOf(item), raw = estAmount(item), discd = disc.hasDiscount && after !== raw;
                          return <div key={col.id} style={{ ...cs, color: ACCENT, fontFamily: "monospace", fontWeight: 600, gap: 4 }} title={discd ? `原報價 ${fmt(raw)} → 大項議價後 ${fmt(after)}` : "預估金額（含稅，自動計算）"}>
                            {discd && <span style={{ color: "#9b9384", textDecoration: "line-through", fontWeight: 400, fontSize: 11 }}>{fmt(raw)}</span>}
                            <span>{fmt(after)}</span>
                          </div>;
                        }
                        if (col.id === "itemPaid") {
                          const tgt = estAfterOf(item), ip = itemPaidOf(item), up = tgt - ip;
                          const full = tgt > 0 && up <= 0;
                          return <div key={col.id} style={{ ...cs }} title="此細項已付／未付（來自大項付款紀錄）">
                            {ip === 0 ? <span style={{ fontSize: 11.5, color: "#C2410C" }}>● 未付</span>
                              : full ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3C8C3C", background: "#E7F5E7", borderRadius: 10, padding: "2px 8px" }}>✓ 付清</span>
                                : <span style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}><span style={{ color: "#3C8C3C", fontWeight: 600 }}>{fmt(ip)}</span><span style={{ color: "#9b9384" }}> / {tgt > 0 ? Math.round(ip / tgt * 100) : 0}%</span></span>}
                          </div>;
                        }
                        if (col.id === "paid") {
                          const estA = estAfterOf(item), p = paidOf(item), full = estA > 0 && p >= estA;
                          return <div key={col.id} style={{ ...cs, gap: 6 }}>
                            <input type="checkbox" checked={full} title={full ? "已全額付清（點擊清除）" : "一鍵填入議價後金額"} onChange={() => updateItem(catId, item.id, "paid", full ? 0 : estA)} style={{ width: 16, height: 16, flexShrink: 0, cursor: "pointer", accentColor: "#3C8C3C" }} />
                            <div style={{ flex: 1, minWidth: 0, color: p > 0 ? "#3C8C3C" : "#CDC3AC" }}><EditableCell catId={catId} itemId={item.id} field="paid" value={item.paid ?? item.cust?.paid ?? 0} type="number" /></div>
                          </div>;
                        }
                        if (col.id === "unpaid") { const u = unpaidAfterOf(item); return <div key={col.id} style={{ ...cs, color: u < 0 ? "#b3261e" : u > 0 ? "#C2872E" : "#3C8C3C", fontFamily: "monospace", fontWeight: 600 }} title={u < 0 ? "溢付（已付超過議價後金額）" : "未付金額（議價後 − 已付，自動）"}>{u < 0 ? `溢付 ${fmt(-u)}` : fmt(u)}</div>; }
                        if (col.id === "payDate") { const iso = String(item.payDate ?? "").replace(/\//g, "-").slice(0, 10); return <div key={col.id} style={cs}><input type="date" value={iso} onChange={e => updateItem(catId, item.id, "payDate", e.target.value)} style={{ width: "100%", border: "none", outline: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, fontFamily: "'Noto Sans TC', sans-serif", color: iso ? "#211C15" : "#CDC3AC", padding: "2px 2px", colorScheme: "light" }} /></div>; }
                        if (col.id === "payAccount") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="payAccount" value={item.payAccount} placeholder="銀行/帳號" /></div>;
                        if (col.id === "receipts") {
                          const recs = item.receipts || [];
                          return (
                            <div key={col.id} style={{ ...cs, gap: 3, flexWrap: "wrap", overflow: "visible" }}>
                              {recs.map((r, ri) => {
                                // 新格式：上傳的照片/檔案（有 url）
                                if (r.url) return (
                                  <div key={ri} style={{ position: "relative", width: 28, height: 28, flexShrink: 0 }}
                                    onMouseEnter={e => { const b = e.currentTarget.querySelector("button"); if (b) b.style.display = "flex"; }}
                                    onMouseLeave={e => { const b = e.currentTarget.querySelector("button"); if (b) b.style.display = "none"; }}>
                                    {r.isImage !== false
                                      ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4, border: "1px solid #d9cfbd", cursor: "zoom-in" }} />
                                      : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 28, height: 28, borderRadius: 4, border: "1px solid #d9cfbd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, textDecoration: "none", background: "#fbeee6" }}>📄</a>}
                                    <button onClick={() => removeReceipt(catId, item, r.id, ri)} title="刪除" style={{ display: "none", position: "absolute", top: -6, right: -6, width: 15, height: 15, borderRadius: "50%", background: "#b3261e", color: "#fff", border: "none", fontSize: 10, lineHeight: 1, cursor: "pointer", alignItems: "center", justifyContent: "center", padding: 0 }}>×</button>
                                  </div>
                                );
                                // 舊格式：純文字名稱＋金額（點一下可刪除）
                                return <span key={ri} title={r.amount ? `${r.name}　$${r.amount}（點擊刪除）` : `${r.name}（點擊刪除）`} onClick={() => removeReceipt(catId, item, r.id, ri)} style={{ fontSize: 10, background: "#fbeee6", color: "#92400e", borderRadius: 10, padding: "1px 6px", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>📎 {r.name}</span>;
                              })}
                              <button title="新增憑證（選檔或貼上截圖）" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setRcpAdd({ catId, item, x: r.left, y: r.bottom + 4 }); }} style={{ fontSize: 12, background: "none", border: "1px dashed #d9cfbd", borderRadius: 4, padding: rcpBusy === item.id ? "0 6px" : "1px 6px", cursor: "pointer", color: "#9b9384", flexShrink: 0, display: "flex", alignItems: "center", height: 26 }}>{rcpBusy === item.id ? "…" : "＋"}</button>
                            </div>
                          );
                        }
                        if (col.id === "notes") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="notes" value={item.notes} placeholder="備註..." /></div>;
                        return <div key={col.id} style={cs} />;
                      })}

                      {/* delete */}
                      <div style={{ width: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <button onClick={() => deleteItem(catId, item.id, item.name)}
                          style={{ width: 20, height: 20, borderRadius: "50%", background: "none", border: "none", color: "#d1d5db", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "color 0.15s" }}
                          onMouseEnter={e => e.currentTarget.style.color="#b3261e"}
                          onMouseLeave={e => e.currentTarget.style.color="#d1d5db"}
                        >×</button>
                      </div>
                    </div>
                    </Fragment>
                  );
                })}
                {/* add row in this group（收合時隱藏） */}
                {!isCollapsed && (
                <div onClick={() => {
                  const newItem = { id: `i-${catId}-${Date.now()}`, name: "新細項", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [], done: false };
                  setCats(prev => prev.map(c => c.id === catId ? { ...c, items: [...c.items, newItem] } : c));
                }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 32px", color: "#9b9384", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #e6ddc9", transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background="#ece4d6"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}
                >
                  <span style={{ fontSize: 16, color: ACCENT }}>+</span> 新增{L("item")}至「{group.name}」
                </div>
                )}
                {/* 新增工程大項（最後一組之後不顯示在這） */}
              </div>
            );
          })}
          {/* 新增工程大項 */}
          <div onClick={() => {
            const id = "cat-" + Date.now();
            setCats(prev => [...prev, { id, order: prev.length, name: "新"+L("cat"), budget: 0, status: "pending", items: [] }]);
          }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", color: ACCENT, fontSize: 13, fontWeight: 500, cursor: "pointer", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}
            onMouseEnter={e => e.currentTarget.style.background="#ece4d6"}
            onMouseLeave={e => e.currentTarget.style.background=SURFACE}
          >
            <span style={{ fontSize: 16 }}>＋</span> 新增{L("cat")}
          </div>
          {/* 總計列：數字欄位自動加總 */}
          <div style={{ display: "flex", borderTop: `2px solid ${BORDER}`, background: "#ece4d6", position: "sticky", bottom: 0, zIndex: 5, fontWeight: 600 }}>
            <div style={{ width: 24, flexShrink: 0, borderRight: "1px solid #d9cfbd" }} />
            {(() => { const anyDisc = cats.some(c => catDiscount(c).hasDiscount); return orderedCols.map(col => {
              const cs = { ...cellStyle(col) };
              if (col.id === "name") { const preSum = rows.reduce((s, r) => s + pretaxOf(r.item), 0); return <div key={col.id} style={{ ...cs, fontWeight: 600, color: "#211C15", gap: 8, flexWrap: "wrap" }}>總計（{rows.length} 筆）<span style={{ fontWeight: 500, color: SUB, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>未稅小計 {fmt(preSum)}</span>{anyDisc && <span style={{ fontWeight: 400, color: SUB, fontSize: 11 }}>· 已含議價折扣</span>}</div>; }
              if (col.id === "estTotal" && anyDisc) {
                const rawSum = rows.reduce((s, r) => s + estAmount(r.item), 0);
                const afterSum = rows.reduce((s, r) => s + estAfterOf(r.item), 0);
                return <div key={col.id} style={{ ...cs, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 0, lineHeight: 1.2 }} title="上：原報價總計　下：議價後總計"><span style={{ fontFamily: "monospace", color: "#9b9384", textDecoration: "line-through", fontSize: 11 }}>{fmt(rawSum)}</span><span style={{ fontFamily: "monospace", color: ACCENT, fontWeight: 700 }}>{fmt(afterSum)}</span></div>;
              }
              if (summable(col)) {
                const sum = rows.reduce((s, r) => s + numVal(col, r.item), 0);
                return <div key={col.id} style={{ ...cs, fontFamily: "monospace", color: isMoneyCol(col) ? ACCENT : "#4A4234" }}>{isMoneyCol(col) ? fmt(sum) : (Math.round(sum * 100) / 100)}</div>;
              }
              return <div key={col.id} style={cs} />;
            }); })()}
            <div style={{ width: 32, flexShrink: 0 }} />
          </div>
        </div>
      </div>
      )}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
      {payCatId && (() => { const c = cats.find(x => x.id === payCatId); return c ? (
        <PaymentsPanel cat={c} setCats={setCats} onClose={() => setPayCatId(null)} confirm={confirm} />
      ) : null; })()}

      {/* 憑證上傳小彈窗：選檔 或 Cmd+V 貼上 */}
      {rcpAdd && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setRcpAdd(null); }} style={{ position: "fixed", inset: 0, zIndex: 700 }}>
          <div onPaste={e => { const fs = Array.from(e.clipboardData?.files || []).filter(f => /^image\//.test(f.type) || f.type === "application/pdf"); if (fs.length) { e.preventDefault(); addReceipts(rcpAdd.catId, cats.find(c=>c.id===rcpAdd.catId)?.items.find(i=>i.id===rcpAdd.item.id) || rcpAdd.item, fs); setRcpAdd(null); } }}
            tabIndex={0} autoFocus ref={el => el && el.focus()}
            style={{ position: "fixed", left: Math.min(rcpAdd.x, window.innerWidth - 280), top: Math.min(rcpAdd.y, window.innerHeight - 160), width: 260, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,.18)", padding: 14, outline: "none" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 4 }}>新增憑證</div>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 10 }}>{rcpAdd.item.name}</div>
            <div style={{ border: `2px dashed ${BORDER}`, borderRadius: 10, padding: "18px 10px", textAlign: "center", fontSize: 13, color: "#9b9384", marginBottom: 10, background: "#FBF7EE" }}>📋 在此按 <b style={{ color: ACCENT }}>Cmd+V</b> 貼上截圖</div>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ flex: 1, textAlign: "center", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px", fontSize: 13, cursor: "pointer", color: TEXT, background: SURFACE }}>📎 選擇檔案
                <input type="file" accept="*/*" multiple style={{ display: "none" }} onChange={e => { const fs = e.target.files; e.target.value = ""; addReceipts(rcpAdd.catId, cats.find(c=>c.id===rcpAdd.catId)?.items.find(i=>i.id===rcpAdd.item.id) || rcpAdd.item, fs); setRcpAdd(null); }} />
              </label>
              <button onClick={() => setRcpAdd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 垃圾桶 */}
      {showTrash && (
        <div onClick={e => e.target === e.currentTarget && setShowTrash(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "min(620px,96vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>🗑 垃圾桶</div>
              <span style={{ fontSize: 12, color: SUB }}>{trash.length} 筆 · 刪除的細項可還原</span>
              <div style={{ flex: 1 }} />
              {trash.length > 0 && <button onClick={() => confirm(`清空垃圾桶（永久刪除全部 ${trash.length} 筆，無法復原）？`, { confirmLabel: "永久清空" }).then(ok => ok && commitTrash([]))} style={{ border: "1px solid #b3261e", background: "#fff", color: "#b3261e", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>清空垃圾桶</button>}
              <button onClick={() => setShowTrash(false)} style={{ border: "none", background: "none", fontSize: 20, color: SUB, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {trash.length === 0 && <div style={{ textAlign: "center", color: "#9b9384", padding: "40px 0", fontSize: 14 }}>垃圾桶是空的</div>}
              {trash.map(e => { const it = e.item || {}; const amt = estAmount(it); return (
                <div key={e.tid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 8, background: "#FBF7EE" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{it.name || "（未命名）"} <span style={{ fontSize: 12, color: ACCENT, fontFamily: "monospace", fontWeight: 400 }}>{fmt(amt)}</span></div>
                    <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>原屬：{e.catName}　·　{e.deletedBy} 刪於 {new Date(e.deletedAt).toLocaleString("zh-TW")}</div>
                  </div>
                  <button onClick={() => restoreTrash(e.tid)} style={{ border: "1px solid #3C8C3C", background: "#F0FDF4", color: "#3C8C3C", borderRadius: 7, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>↩ 還原</button>
                  <button onClick={() => confirm(`永久刪除「${it.name}」？`, { confirmLabel: "永久刪除" }).then(ok => ok && commitTrash(trash.filter(x => x.tid !== e.tid)))} title="永久刪除" style={{ border: "none", background: "none", color: "#C8BCA0", fontSize: 16, cursor: "pointer", flexShrink: 0 }}>×</button>
                </div>
              ); })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── 大項（廠商）付款紀錄面板 ─────────────────────────────────────────────────
function PaymentsPanel({ cat, setCats, onClose, confirm }) {
  const payments = cat.payments || [];
  const est = catEstAfter(cat), paid = catPaid(cat), unpaid = est - paid;
  const items = cat.items || [];
  const itemEstMap = catItemEstAfter(cat); // 各品項議價後金額
  const itemPaidDistMap = catItemPaidMap(cat); // 各品項已付（含整批分攤）
  const itemPaidOf = (id) => itemPaidDistMap[id] || 0;
  const [lightbox, setLightbox] = useState(null);
  const [busy, setBusy] = useState(false);
  const blankDraft = () => ({ date: new Date().toISOString().slice(0, 10), amount: "", category: "訂金", note: "", itemId: "", receipts: [] });
  const [draft, setDraft] = useState(blankDraft);

  const update = (next) => setCats(prev => prev.map(c => c.id === cat.id ? { ...c, payments: next } : c));
  const editPay = (id, field, val) => update(payments.map(p => p.id === id ? { ...p, [field]: val } : p));
  const nameOfItem = (id) => items.find(i => i.id === id)?.name || "";
  // 對某品項快速付款：ratio=0.5 訂金一半；full=true 補到付清
  const quickPayItem = (item, { ratio, full, label }) => {
    const target = itemEstMap[item.id] ?? estAmount(item);
    const already = itemPaidOf(item.id);
    const amt = full ? Math.max(0, target - already) : Math.round(target * (ratio || 0));
    if (amt <= 0) return;
    update([...payments, { id: "pay-" + Math.random().toString(36).slice(2, 8), date: new Date().toISOString().slice(0, 10), amount: amt, category: full ? (already > 0 ? "尾款" : "其他") : "訂金", note: label || "", itemId: item.id, receipts: [] }]);
  };

  const uploadRcp = async (files) => {
    if (!files || !files.length) return [];
    setBusy(true);
    const out = [];
    for (const f of files) { try { const { url, path } = await uploadPhoto(f); out.push({ id: "rc-" + Math.random().toString(36).slice(2, 8), url, path, name: f.name || "憑證", isImage: /^image\//.test(f.type) }); } catch (_) {} }
    setBusy(false);
    return out;
  };

  const addPayment = () => {
    const amt = Number(draft.amount) || 0;
    if (amt <= 0) return;
    update([...payments, { id: "pay-" + Math.random().toString(36).slice(2, 8), date: draft.date, amount: amt, category: draft.category, note: draft.note, itemId: draft.itemId || null, receipts: draft.receipts }]);
    setDraft(blankDraft());
  };
  const delPayment = async (id) => {
    if (confirm && !(await confirm("刪除這筆付款紀錄？"))) return;
    const p = payments.find(x => x.id === id);
    for (const r of (p?.receipts || [])) { if (r.path) { try { await deletePhotoFile(r.path); } catch (_) {} } }
    update(payments.filter(x => x.id !== id));
  };
  const removeRcp = async (payId, ri) => {
    const p = payments.find(x => x.id === payId); const r = p?.receipts?.[ri];
    if (r?.path) { try { await deletePhotoFile(r.path); } catch (_) {} }
    editPay(payId, "receipts", (p.receipts || []).filter((_, i) => i !== ri));
  };

  const thumbs = (recs, onDel) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {(recs || []).map((r, ri) => (
        <div key={ri} style={{ position: "relative", width: 44, height: 44 }}>
          {r.isImage !== false
            ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #d9cfbd", cursor: "zoom-in" }} />
            : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 44, height: 44, borderRadius: 6, border: "1px solid #d9cfbd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, textDecoration: "none", background: "#fbeee6" }}>📄</a>}
          {onDel && <button onClick={() => onDel(ri)} style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: "50%", background: "#b3261e", color: "#fff", border: "none", fontSize: 10, lineHeight: 1, cursor: "pointer" }}>×</button>}
        </div>
      ))}
    </div>
  );

  return (
    <SidePanel onClose={onClose} wide>
      <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 2 }}>付款紀錄</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#211C15", marginBottom: 12 }}>{cat.name}</div>

      {/* 三個數字 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div style={{ background: "#fbeee6", border: "1px solid rgba(193,58,34,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>議價後</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: ACCENT }}>{fmt(est)}</div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid rgba(60,140,60,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>已付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#3C8C3C" }}>{fmt(paid)}</div>
        </div>
        <div style={{ background: "#FFFBEB", border: "1px solid rgba(194,135,46,0.3)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>未付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: unpaid < 0 ? "#b3261e" : "#C2872E" }}>{unpaid < 0 ? `溢付 ${fmt(-unpaid)}` : fmt(unpaid)}</div>
        </div>
      </div>

      {/* 一鍵付款：把「每個品項」都設到 X%（最後一筆吸收進位差→整體精確）；重複按只替換、不堆疊 */}
      {(() => {
        const setRatio = (r, label) => {
          const target = Math.round(est * r);
          const list = items;
          let acc = 0; const newPays = [];
          list.forEach((it, i) => {
            let amt = (i === list.length - 1) ? (target - acc) : Math.round((itemEstMap[it.id] ?? estAmount(it)) * r);
            amt = Math.max(0, amt); acc += (i === list.length - 1 ? 0 : amt);
            if (amt > 0) newPays.push({ id: "pay-" + Math.random().toString(36).slice(2, 8), date: new Date().toISOString().slice(0, 10), amount: amt, category: r >= 1 ? "尾款" : "訂金", note: label, itemId: it.id, receipts: [] });
          });
          update(newPays);
        };
        const curPct = est > 0 ? Math.round(paid / est * 100) : 0;
        return (
          <div style={{ marginBottom: 12 }}>
            {unpaid > 0
              ? <button onClick={() => setRatio(1, "全部付清")} style={{ width: "100%", background: "#3C8C3C", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✓ 一鍵全部付清（補 {fmt(unpaid)}）</button>
              : <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#E7F5E7", borderRadius: 10, padding: "10px 14px" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#3C8C3C" }}>✓ 此大項已全部付清</span><div style={{ flex: 1 }} />
                  <button onClick={async () => { if (confirm && !(await confirm("清除這個大項的所有付款紀錄？", { confirmLabel: "確定清除" }))) return; update([]); }} style={{ border: "1px solid #C2872E", background: "#FFFBEB", color: "#C2872E", borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>清除付款</button>
                </div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {[0.3, 0.5, 0.7].map(r => { const active = curPct === Math.round(r * 100); return (
                <button key={r} onClick={() => setRatio(r, `付到 ${Math.round(r * 100)}%`)} title={`整體付到 ${fmt(Math.round(est * r))}`} style={{ flex: 1, border: `1px solid ${active ? "#3C8C3C" : "#C2872E"}`, background: active ? "#EAF5EA" : "#FFFBEB", color: active ? "#3C8C3C" : "#C2872E", borderRadius: 8, padding: "7px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>付到 {Math.round(r * 100)}%{active ? " ✓" : ""}</button>
              ); })}
            </div>
          </div>
        );
      })()}

      {/* 新增付款表單 */}
      <div style={{ border: "1px solid #d9cfbd", borderRadius: 10, padding: 12, marginBottom: 16, background: "#FBF7EE" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#211C15", marginBottom: 8 }}>＋ 新增付款（單筆／指定品項）</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>日期</div><input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} style={inputStyle} /></div>
          <div><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>類別</div><select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} style={inputStyle}>{PAY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>金額 NT$</div><input type="number" min={0} value={draft.amount || ""} placeholder="0" onChange={e => setDraft({ ...draft, amount: e.target.value })} style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }} /></div>
          <div><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>備註</div><input value={draft.note} placeholder="選填" onChange={e => setDraft({ ...draft, note: e.target.value })} style={inputStyle} /></div>
        </div>
        {items.length > 0 && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>對應品項／廠商（選填，多廠商整合用）</div><select value={draft.itemId} onChange={e => setDraft({ ...draft, itemId: e.target.value })} style={inputStyle}><option value="">整批／不指定</option>{items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}</select></div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {thumbs(draft.receipts, (ri) => setDraft({ ...draft, receipts: draft.receipts.filter((_, i) => i !== ri) }))}
          <label style={{ fontSize: 12, border: "1px dashed #d9cfbd", borderRadius: 6, padding: "6px 12px", cursor: "pointer", color: "#6F6656" }}>
            {busy ? "上傳中…" : "📎 上傳憑證"}
            <input type="file" accept="*/*" multiple style={{ display: "none" }} onChange={async e => { const f = e.target.files; e.target.value = ""; const up = await uploadRcp(f); if (up.length) setDraft(d => ({ ...d, receipts: [...d.receipts, ...up] })); }} />
          </label>
          <div style={{ flex: 1 }} />
          <button onClick={addPayment} disabled={!(Number(draft.amount) > 0)} style={{ background: Number(draft.amount) > 0 ? "#3C8C3C" : "#C8BCA0", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: Number(draft.amount) > 0 ? "pointer" : "default" }}>新增</button>
        </div>
      </div>

      {/* 各品項付款進度（同大項整合多廠商，每個品項各自付清/訂金%）*/}
      {items.length > 0 && (() => {
        const withTarget = items.filter(it => (itemEstMap[it.id] ?? estAmount(it)) > 0);
        if (!withTarget.length) return null;
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>各品項付款進度（多廠商整合）</div>
            {withTarget.map(it => {
              const target = itemEstMap[it.id] ?? estAmount(it);
              const ip = itemPaidOf(it.id);
              const pct = target > 0 ? Math.min(100, Math.round(ip / target * 100)) : 0;
              const full = ip >= target;
              return (
                <div key={it.id} style={{ border: "1px solid #E3DAC6", borderRadius: 8, padding: "8px 10px", marginBottom: 6, background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, color: "#211C15", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div><div style={{ fontSize: 11, color: "#6F6656", fontVariantNumeric: "tabular-nums" }}>{fmt(target)}</div></div>
                    {full ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3C8C3C", background: "#E7F5E7", borderRadius: 12, padding: "3px 10px" }}>✓ 已付清</span>
                      : <span style={{ fontSize: 11.5, color: ip > 0 ? "#C2872E" : "#9b9384", fontVariantNumeric: "tabular-nums" }}>{ip > 0 ? `已付 ${fmt(ip)}（${pct}%）` : "未付"}</span>}
                  </div>
                  <div style={{ height: 6, background: "#e6ddc9", borderRadius: 3, overflow: "hidden", margin: "6px 0" }}><div style={{ width: pct + "%", height: "100%", background: "#3C8C3C" }} /></div>
                  {!full && <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => quickPayItem(it, { ratio: 0.5, label: "訂金50%" })} style={{ fontSize: 11.5, border: "1px solid #C2872E", background: "#FFFBEB", color: "#C2872E", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>訂金 50%</button>
                    <button onClick={() => quickPayItem(it, { full: true, label: ip > 0 ? "補尾款" : "全額付清" })} style={{ fontSize: 11.5, border: "1px solid #3C8C3C", background: "#F0FDF4", color: "#3C8C3C", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>{ip > 0 ? "補尾款付清" : "全額付清"}</button>
                  </div>}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 付款紀錄列表 */}
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6, display: "flex", alignItems: "center" }}>已付紀錄（{payments.length} 筆）<div style={{ flex: 1 }} />{payments.length > 0 && <button onClick={async () => { if (confirm && !(await confirm(`清除全部 ${payments.length} 筆付款紀錄？`, { confirmLabel: "確定清除" }))) return; update([]); }} style={{ border: "1px solid #b3261e", background: "#fff", color: "#b3261e", borderRadius: 6, padding: "3px 10px", fontSize: 11.5, cursor: "pointer" }}>一鍵清除</button>}</div>
      {payments.length === 0 && <div style={{ fontSize: 12, color: "#9b9384", padding: "12px 0" }}>尚無付款紀錄</div>}
      {payments.map(p => (
        <div key={p.id} style={{ border: "1px solid #E3DAC6", borderRadius: 8, padding: 10, marginBottom: 8, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, background: "#fbeee6", color: "#92400e", borderRadius: 10, padding: "1px 8px", fontWeight: 600, flexShrink: 0 }}>{p.category || "其他"}</span>
            {p.itemId && <span style={{ fontSize: 10, background: "#E8F0FB", color: "#2E6FB0", borderRadius: 10, padding: "1px 8px", fontWeight: 600, flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={nameOfItem(p.itemId)}>{nameOfItem(p.itemId)}</span>}
            <input type="date" value={p.date || ""} onChange={e => editPay(p.id, "date", e.target.value)} style={{ ...inputStyle, width: 140, padding: "4px 8px", fontSize: 12 }} />
            <input type="number" min={0} value={p.amount || ""} onChange={e => editPay(p.id, "amount", Number(e.target.value) || 0)} style={{ ...inputStyle, width: 120, padding: "4px 8px", fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: "#3C8C3C" }} />
            <div style={{ flex: 1 }} />
            <button onClick={() => delPayment(p.id)} title="刪除這筆" style={{ width: 24, height: 24, borderRadius: "50%", background: "#fbeee6", border: "1px solid rgba(193,58,34,0.25)", color: "#b3261e", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>×</button>
          </div>
          <input value={p.note || ""} placeholder="備註" onChange={e => editPay(p.id, "note", e.target.value)} style={{ ...inputStyle, padding: "4px 8px", fontSize: 12, marginBottom: (p.receipts?.length || 0) ? 8 : 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            {thumbs(p.receipts, (ri) => removeRcp(p.id, ri))}
            <label style={{ fontSize: 11, border: "1px dashed #d9cfbd", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "#6F6656" }}>
              {busy ? "上傳中…" : "📎 加憑證"}
              <input type="file" accept="*/*" multiple style={{ display: "none" }} onChange={async e => { const f = e.target.files; e.target.value = ""; const up = await uploadRcp(f); if (up.length) editPay(p.id, "receipts", [...(p.receipts || []), ...up]); }} />
            </label>
          </div>
        </div>
      ))}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
    </SidePanel>
  );
}

export function StatusBadge({ status, setCats, catId, itemId }) {
  const [pos, setPos] = useState(null); // {x,y} 開啟時的浮層座標；null=關閉
  const st = STATUS_MAP[status] || STATUS_MAP.pending;
  const openMenu = (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setPos({ x: r.left, y: r.bottom + 4 }); };
  const pick = (k) => { setCats(prev => prev.map(c => {
    if (catId && c.id === catId) {
      if (itemId) { // 改細項狀態 → 回算大項狀態
        const items = c.items.map(it => it.id === itemId ? { ...it, status: k, done: k === "done", lastUpdated: new Date().toISOString() } : it);
        return syncCatStatus({ ...c, items });
      }
      return k === "done" ? markCatDone(c) : { ...c, status: k }; // 大項標完工 → 細項全部完工
    }
    return c;
  })); setPos(null); };
  return (
    <>
      <div onClick={openMenu} style={{ background: st.color + "22", border: `1px solid ${st.color}55`, color: st.color, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{st.label}</div>
      {pos && createPortal(
        <div onClick={(e) => { e.stopPropagation(); setPos(null); }} onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
          <div style={{ position: "fixed", left: Math.min(pos.x, window.innerWidth - 130), top: Math.min(pos.y, window.innerHeight - 220), background: "#fff", border: "1px solid #d9cfbd", borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,.18)", minWidth: 110, overflow: "hidden" }}>
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <div key={k} onClick={(e) => { e.stopPropagation(); pick(k); }} style={{ padding: "8px 14px", cursor: "pointer", color: v.color, fontSize: 13, fontWeight: 600, borderBottom: "1px solid #e6ddc9" }} onMouseEnter={e => e.currentTarget.style.background = "#ece4d6"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>{v.label}</div>
            ))}
          </div>
        </div>, document.body
      )}
    </>
  );
}