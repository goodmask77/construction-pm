// 物料清單頁 v3（2026-07-20）：視角切換（物料/廠商）＋顯示切換（清單/圖片）＋拖曳排序＋📸截圖AI匯入
// v2 原則不變：預設全自動（⚡自動整理/同名併卡/規格解析入數/服務類收摺），人只處理例外
// 截圖匯入：貼上或上傳截圖 → AI 解析品項 → 人工確認才寫入（AI 辨識必經人確認，張良原則）
import React, { useEffect, useRef, useState } from "react";
import { C, MONOF, rid } from "./Supply.jsx";
import { packToBase, lastPaid, unitCost, srcsOf, priceAlert, normName, organizeAll } from "./inv.js";
import { uploadPhoto } from "../supa.js";
import { callAI } from "../lib/ai.js";

const WDZ = ["日", "一", "二", "三", "四", "五", "六"];
const freqText = (f) => {
  if (!f || f.type === "none" || !f.type) return "不盤";
  const base = f.type === "daily" ? "每日" : f.type === "weekly" ? "每週" + (f.days || []).map(d => WDZ[d]).join("") : "每月" + (f.dom || 1) + "日";
  return (f.paused ? "⏸ " : "") + base;
};
const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });

export default function IngredientsView({ db, save, canEdit, showMoney, confirm, flash }) {
  const [q, setQ] = useState("");
  const [vw, setVw] = useState("mat");           // 視角：mat=物料 / ven=廠商
  const [disp, setDisp] = useState("list");      // 顯示：list=清單 / grid=圖片
  const [open, setOpen] = useState(null);        // 展開/彈出詳情的物料 id
  const [sel2, setSel2] = useState({});          // 批次選取
  const [showSvc, setShowSvc] = useState(false);
  const [batCat, setBatCat] = useState("");
  const [drag, setDrag] = useState(null);        // 拖曳中的物料 id
  const [dragI, setDragI] = useState(null);      // 拖曳中的廠商品項 id（廠商視角）
  const [colV, setColV] = useState({});          // 廠商視角收合
  const [imp, setImp] = useState(null);          // 截圖匯入 modal：{vid,newVendor,vendorGuess,rows,busy}
  const imgRef = useRef(null); const imgFor = useRef(null); // 圖片上傳 input + 目標物料 id
  const shotRef = useRef(null);                  // 截圖上傳 input
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const pill = (on, color) => ({ border: `1.5px solid ${on ? color : "#d9cfbd"}`, background: on ? color : "#fff", color: on ? "#fff" : C.sub, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: canEdit ? "pointer" : "default", whiteSpace: "nowrap" });
  const sbtn = { border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "4px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" };
  const seg = (on) => ({ border: "none", background: on ? "#fff" : "transparent", color: on ? C.text : C.sub, borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: on ? 700 : 500, cursor: "pointer", boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none" });

  const all = (db.ingredients || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const vname = (vid) => ((db.vendors || []).find(v => v.id === vid) || {}).name || "—";
  const alertPct = (db.settings && db.settings.priceAlertPct) || 15;
  const updIng = (id, fp) => save({ ingredients: (db.ingredients || []).map(x => x.id === id ? { ...x, ...fp } : x) });
  const d2 = (n) => n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 1000) / 1000).toString();

  // ── ⚡ 自動整理（共用 organizeAll）──
  const pending = (db.vendorItems || []).filter(vi => !vi.ingredient_id && (vi.name || "").trim());
  const autoOrganize = () => {
    if (!canEdit || !pending.length) return;
    const plan = organizeAll(db);
    save({ ingredients: plan.ingredients, vendorItems: plan.vendorItems });
    const s = plan.stats;
    flash(`⚡ 整理完成：自動建 ${s.created} 張卡${s.svcN ? `（${s.svcN} 筆服務/費用類收進「非物料」）` : ""}、同名併入 ${s.merged} 筆${s.needFix ? `；${s.needFix} 筆看不出入數，點開補「1件=幾個」` : ""}`);
  };

  // ── 圖片上傳（物料卡）──
  const upImg = async (file) => {
    const gid = imgFor.current; if (!gid || !file) return;
    try { const { url, path } = await uploadPhoto(file); updIng(gid, { img: url, imgPath: path }); flash("✓ 圖片已更新"); }
    catch (e) { flash("圖片上傳失敗：" + (e?.message || e)); }
  };

  // ── 建議合併 ──
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
    save({ ingredients: (db.ingredients || []).filter(x => x.id !== src.id), vendorItems: (db.vendorItems || []).map(v => v.ingredient_id === src.id ? { ...v, ingredient_id: target.id } : v) });
    flash(`✓ 已把「${src.name}」併入「${target.name}」`);
  };
  const dismissSugg = (key) => save({ settings: { ...(db.settings || {}), mergeDismissed: [...((db.settings && db.settings.mergeDismissed) || []), key] } });

  // ── 批次 ──
  const selIds = Object.keys(sel2).filter(id => sel2[id] && all.some(g => g.id === id));
  const batch = (fp) => save({ ingredients: (db.ingredients || []).map(x => sel2[x.id] ? { ...x, ...fp } : x) });
  const batchFreq = (type) => { batch({ countFreq: { type, days: type === "weekly" ? [1] : [], dom: 1, paused: false } }); flash(`✓ 已把 ${selIds.length} 項設為「${type === "daily" ? "每日" : type === "weekly" ? "每週（預設週一，可點開細調）" : type === "monthly" ? "每月1日" : "不盤"}」`); };

  // ── 拖曳排序 ──
  const dropOn = (targetId) => {
    if (!drag || drag === targetId) return setDrag(null);
    const list = [...all]; const from = list.findIndex(x => x.id === drag), to = list.findIndex(x => x.id === targetId);
    if (from < 0 || to < 0) return setDrag(null);
    const [mv] = list.splice(from, 1); list.splice(to, 0, mv);
    save({ ingredients: list.map((x, i) => ({ ...x, sort: i })) }); setDrag(null);
  };
  const itemsOfV = (vid) => (db.vendorItems || []).filter(v => v.vendor_id === vid).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const dropItemOn = (targetId, vid) => {
    if (!dragI || dragI === targetId) return setDragI(null);
    const mine = itemsOfV(vid); const others = (db.vendorItems || []).filter(v => v.vendor_id !== vid);
    const from = mine.findIndex(x => x.id === dragI), to = mine.findIndex(x => x.id === targetId);
    if (from < 0 || to < 0) return setDragI(null);
    const [mv] = mine.splice(from, 1); mine.splice(to, 0, mv);
    save({ vendorItems: [...others, ...mine.map((x, i) => ({ ...x, sort: i }))] }); setDragI(null);
  };

  // ── 📸 截圖匯入：AI 解析（含商品照片位置）→ 自動裁圖 → 預覽表（可改）→ 人工確認才寫入 ──
  const loadImgEl = (f) => new Promise((res, rej) => { const u = URL.createObjectURL(f); const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
  const cropBox = (im, b) => new Promise((res) => {
    // 裁下截圖裡的商品照片；座標稍微夾一下範圍，裁不出來就回 null（不擋文字匯入）
    try {
      const W = im.naturalWidth, H = im.naturalHeight;
      let x = Math.max(0, Math.min(Number(b.x) || 0, W - 2)), y = Math.max(0, Math.min(Number(b.y) || 0, H - 2));
      let w = Math.min(Number(b.w) || 0, W - x), h = Math.min(Number(b.h) || 0, H - y);
      if (w < 20 || h < 20) return res(null);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(im, x, y, w, h, 0, 0, w, h);
      c.toBlob(bl => res(bl || null), "image/jpeg", 0.85);
    } catch (_) { res(null); }
  });
  const parseShots = async (files) => {
    const arr = Array.from(files || []).filter(f => /^image\//.test(f.type)); if (!arr.length) return;
    setImp(m => m ? { ...m, busy: `AI 解析中（${arr.length} 張）…` } : m);
    for (const f of arr) {
      try {
        const [b64, im] = await Promise.all([fileToB64(f), loadImgEl(f)]);
        const W = im.naturalWidth, H = im.naturalHeight;
        const block = { type: "image", source: { type: "base64", media_type: f.type || "image/png", data: b64 } };
        const prompt = `這是廠商網站/購物車/報價單/型錄的截圖，原始尺寸 ${W}x${H} 像素。抽出每一個商品，只回 JSON、不要其他文字：{"vendor":"截圖上可辨識的廠商或網站名稱(沒有就空字串)","items":[{"name":"品名(簡短,去掉與規格重複的贅字)","spec":"規格(例:1000入/箱,600g/包,沒有就空字串)","unit":"採購單位(箱/件/包/組,預設箱)","price":單價數字,"img":{"x":左上x,"y":左上y,"w":寬,"h":高}}]}。img=該商品縮圖照片在截圖中的像素範圍（以原始 ${W}x${H} 座標、整數、框準照片本身不含文字），該商品沒有照片就給 null。金額只放數字，看不到的欄位留空字串或 0。`;
        const reply = await callAI([{ role: "user", content: [block, { type: "text", text: prompt }] }], "你是採購品項解析助理，只輸出 JSON。", "import");
        const clean = reply.replace(/```json|```/gi, "").trim();
        const parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
        const rows = [];
        for (const it of (parsed.items || [])) {
          const name = String(it.name || "").trim(); if (!name) continue;
          let thumb = null, thumbUrl = "";
          if (it.img && typeof it.img === "object") { thumb = await cropBox(im, it.img); if (thumb) thumbUrl = URL.createObjectURL(thumb); }
          rows.push({ on: true, name, spec: String(it.spec || "").trim(), unit: String(it.unit || "箱").trim() || "箱", price: Number(it.price) || "", thumb, thumbUrl });
        }
        setImp(m => m ? { ...m, rows: [...m.rows, ...rows], vendorGuess: m.vendorGuess || String(parsed.vendor || "").trim() } : m);
      } catch (e) { flash("解析失敗：" + (e?.message || e)); }
    }
    setImp(m => m ? { ...m, busy: "" } : m);
  };
  useEffect(() => {
    if (!imp) return;
    const h = (e) => { const its = (e.clipboardData || {}).items || []; const fs = []; for (const it of its) { if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) fs.push(f); } } if (fs.length) { e.preventDefault(); parseShots(fs); } };
    window.addEventListener("paste", h); return () => window.removeEventListener("paste", h);
  }, [imp]); // eslint-disable-line
  const doImport = async () => {
    const rows = (imp.rows || []).filter(r => r.on && r.name.trim()); if (!rows.length) return;
    let vid = imp.vid; let vendors2 = db.vendors || [];
    if (!vid) { flash("先選這批品項是哪家廠商的"); return; }
    if (vid === "__new") {
      const nm = (imp.newVendor || imp.vendorGuess || "").trim(); if (!nm) { flash("請填新廠商名稱"); return; }
      const nv = { id: rid("v"), name: nm, dept: "共用", vcat: "", url: "", tags: [], note: "", lineGroupId: "", sendMode: "share", sort: vendors2.length };
      vendors2 = [...vendors2, nv]; vid = nv.id;
    }
    // 同廠商同名品項＝更新不重複建（重貼同一張截圖不會灌重複資料）
    let vis2 = [...(db.vendorItems || [])];
    let addN = 0, updN = 0;
    const baseSort = vis2.filter(v => v.vendor_id === vid).length;
    rows.forEach((r, i) => {
      const ex = vis2.find(v => v.vendor_id === vid && normName(v.name) === normName(r.name));
      if (ex) { vis2 = vis2.map(v => v.id === ex.id ? { ...v, spec: r.spec.trim() || v.spec, unit: r.unit || v.unit, price: r.price !== "" ? r.price : v.price } : v); updN++; }
      else { vis2.push({ id: rid("vi"), vendor_id: vid, grp: "", name: r.name.trim(), spec: r.spec.trim(), unit: r.unit || "箱", price: r.price || "", safeStock: "", sort: baseSort + i, tags: "" }); addN++; }
    });
    const plan = organizeAll({ ...db, vendors: vendors2, vendorItems: vis2 });
    // 截圖裁下的商品照片 → 上傳 → 掛到物料卡（卡上已有圖就不動）
    let imgN = 0;
    const withThumb = rows.filter(r => r.thumb);
    if (withThumb.length) {
      setImp(m => m ? { ...m, busy: `上傳圖片中（${withThumb.length} 張）…` } : m);
      for (const r of withThumb) {
        const g = plan.ingredients.find(x => normName(x.name) === normName(r.name));
        if (!g || g.img) continue;
        try {
          const file = new File([r.thumb], "item.jpg", { type: "image/jpeg" });
          const { url, path } = await uploadPhoto(file);
          plan.ingredients = plan.ingredients.map(x => x.id === g.id ? { ...x, img: url, imgPath: path } : x);
          imgN++;
        } catch (_) { /* 單張失敗不擋整批 */ }
      }
    }
    save({ vendors: vendors2, vendorItems: plan.vendorItems, ingredients: plan.ingredients });
    setImp(null);
    flash(`📸 匯入完成：新增 ${addN} 筆、更新 ${updN} 筆${imgN ? `、掛上 ${imgN} 張商品圖` : ""}；自動建 ${plan.stats.created} 張物料卡、同名併入 ${plan.stats.merged} 筆`);
  };

  const qq = q.trim().toLowerCase();
  const match = (g) => !qq || `${g.name || ""} ${g.cat || ""} ${g.tags || ""}`.toLowerCase().includes(qq);
  const shown = stock.filter(match);
  const svcList = all.filter(g => g.nonStock).filter(match);
  const cats = [...new Set(shown.map(g => (g.cat || "").trim() || "未分類"))];

  // ── 物料詳情內容（清單展開與圖片視角彈窗共用）──
  const detailBody = (g) => {
    const srcs = srcsOf(db, g.id);
    const units = srcs.map(vi => unitCost(vi)).filter(u => u != null);
    const minU = units.length ? Math.min(...units) : null;
    return (
      <div onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          {/* 圖片：點縮圖或按鈕換圖（也可在圖片視角卡片上直接按📷） */}
          <span onClick={() => { if (canEdit) { imgFor.current = g.id; imgRef.current && imgRef.current.click(); } }} title="點擊上傳/更換圖片" style={{ width: 46, height: 46, borderRadius: 8, border: `1px solid ${C.line}`, background: g.img ? `url(${g.img}) center/cover` : "#f4efe5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: C.faint, cursor: canEdit ? "pointer" : "default", flexShrink: 0 }}>{g.img ? "" : "📷"}</span>
          <label style={{ fontSize: 11, color: C.sub }}>名稱 <input value={g.name || ""} onChange={e => updIng(g.id, { name: e.target.value })} disabled={!canEdit} style={{ ...inp, width: 140 }} /></label>
          <label style={{ fontSize: 11, color: C.sub }}>分類 <input value={g.cat || ""} onChange={e => updIng(g.id, { cat: e.target.value })} disabled={!canEdit} list="ingcats" style={{ ...inp, width: 90 }} /></label>
          <label style={{ fontSize: 11, color: C.sub }}>計量單位 <input value={g.baseUnit || ""} onChange={e => updIng(g.id, { baseUnit: e.target.value })} disabled={!canEdit} placeholder="個/g/ml" style={{ ...inp, width: 56 }} /></label>
          <label style={{ fontSize: 11, color: C.sub }}>安全庫存 <input value={g.safeStock ?? ""} onChange={e => updIng(g.id, { safeStock: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" style={{ ...inp, width: 70, fontFamily: MONOF }} /> <span style={{ fontSize: 10, color: C.faint }}>{g.baseUnit}</span></label>
          <label style={{ fontSize: 11.5, color: C.sub, display: "flex", alignItems: "center", gap: 4 }}><input type="checkbox" checked={!!g.nonStock} onChange={e => updIng(g.id, { nonStock: e.target.checked })} disabled={!canEdit} />非物料</label>
          {canEdit && <button onClick={async () => { if (await confirm(`刪除「${g.name || "未命名"}」？會整個移除（叫貨表裡也會消失）。\n只是不想盤點的話，按「不盤」就好，不用刪。`, { confirmLabel: "刪除" })) { save({ ingredients: (db.ingredients || []).filter(x => x.id !== g.id), vendorItems: (db.vendorItems || []).filter(v => v.ingredient_id !== g.id) }); setOpen(null); } }} style={{ ...sbtn, color: C.red }}>刪除</button>}
        </div>
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
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: `minmax(80px,0.9fr) minmax(120px,1.3fr) 150px ${showMoney ? "110px 90px" : ""}`, gap: 8, padding: "5px 10px", fontSize: 10, color: C.faint, fontWeight: 700, background: "#f4efe5" }}>
            <span>廠商</span><span>品名/規格</span><span>每件入數</span>{showMoney && <><span style={{ textAlign: "right" }}>最近實付</span><span style={{ textAlign: "right" }}>$/{g.baseUnit || "單位"}</span></>}
          </div>
          {srcs.length === 0 && <div style={{ padding: "8px 10px", fontSize: 11.5, color: C.red }}>沒有廠商賣這個——按上面「⚡ 自動整理」或用「📸 貼截圖匯入」。</div>}
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
    );
  };

  // ── 物料視角：清單列 ──
  const listRow = (g) => {
    const srcs = srcsOf(db, g.id);
    const isOpen = open === g.id;
    const units = srcs.map(vi => unitCost(vi)).filter(u => u != null);
    const minU = units.length ? Math.min(...units) : null;
    const anyAlert = srcs.map(vi => priceAlert(vi, alertPct)).find(Boolean);
    const mainVi = srcs.find(vi => packToBase(vi)) || srcs[0];
    return (
      <React.Fragment key={g.id}>
        <div draggable={canEdit} onDragStart={() => setDrag(g.id)} onDragOver={e => drag && e.preventDefault()} onDrop={() => dropOn(g.id)}
          onClick={() => setOpen(isOpen ? null : g.id)}
          style={{ display: "grid", gridTemplateColumns: `26px 24px minmax(120px,1.4fr) 110px 90px ${showMoney ? "110px " : ""}96px 30px`, gap: 6, alignItems: "center", minHeight: 34, padding: "2px 10px", borderTop: `1px solid #f0ead9`, fontSize: 12.5, cursor: "pointer", background: isOpen ? "#fbeee6" : sel2[g.id] ? "#f2f6fb" : "#fff" }}>
          <input type="checkbox" checked={!!sel2[g.id]} onClick={e => e.stopPropagation()} onChange={e => setSel2(s => ({ ...s, [g.id]: e.target.checked }))} disabled={!canEdit} style={{ cursor: "pointer" }} />
          <button onClick={e => { e.stopPropagation(); canEdit && updIng(g.id, { isKey: !g.isKey }); }} title={g.isKey ? "關鍵品項（點擊取消）" : "標為關鍵品項"} style={{ border: "none", background: "none", color: g.isKey ? "#E8A317" : "#d9cfbd", fontSize: 14, cursor: "pointer", padding: 0 }}>{g.isKey ? "★" : "☆"}</button>
          <span style={{ fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || <span style={{ color: C.faint }}>（未命名）</span>}{anyAlert && <span style={{ fontSize: 10, fontWeight: 700, color: anyAlert.up ? C.red : C.green, marginLeft: 4 }}>{anyAlert.up ? "▲" : "▼"}{Math.abs(anyAlert.pct)}%</span>}</span>
          <span style={{ fontFamily: MONOF, fontSize: 11, color: mainVi && packToBase(mainVi) ? C.sub : C.red }}>{mainVi ? (packToBase(mainVi) ? `1${mainVi.unit || "件"}=${Number(mainVi.packToBase).toLocaleString()}${g.baseUnit}` : "1件=？") : "—"}</span>
          <span style={{ fontSize: 11, color: srcs.length ? C.sub : C.red }}>{srcs.length ? `${srcs.length} 家賣` : "沒人賣"}</span>
          {showMoney && <span style={{ fontFamily: MONOF, fontSize: 11, textAlign: "right", color: minU != null ? C.text : "#d5cbb6" }}>{minU != null ? `$${d2(minU)}/${g.baseUnit}` : "—"}</span>}
          <span onClick={e => e.stopPropagation()} style={{ display: "flex" }}>
            <button onClick={() => setOpen(isOpen ? null : g.id)} style={{ ...pill(g.countFreq && g.countFreq.type !== "none" && !g.countFreq.paused, C.blue), padding: "2px 9px", fontSize: 10.5 }}>{freqText(g.countFreq)}</button>
          </span>
          <span style={{ fontSize: 10, color: C.faint, textAlign: "center" }}>{isOpen ? "▾" : "▸"}</span>
        </div>
        {isOpen && <div style={{ padding: "10px 14px 12px 42px", borderTop: `1px solid #f0ead9`, background: "#fdfaf3" }}>{detailBody(g)}</div>}
      </React.Fragment>
    );
  };

  // ── 物料視角：圖片卡 ──
  const gridCard = (g) => {
    const srcs = srcsOf(db, g.id);
    const units = srcs.map(vi => unitCost(vi)).filter(u => u != null);
    const minU = units.length ? Math.min(...units) : null;
    const mainVi = srcs.find(vi => packToBase(vi)) || srcs[0];
    return (
      <div key={g.id} draggable={canEdit} onDragStart={() => setDrag(g.id)} onDragOver={e => drag && e.preventDefault()} onDrop={() => dropOn(g.id)}
        onClick={() => setOpen(g.id)}
        style={{ width: 150, border: `1.5px solid ${C.hard}`, borderRadius: 10, overflow: "hidden", background: "#fff", cursor: "pointer" }}>
        <div style={{ height: 96, background: g.img ? `url(${g.img}) center/cover` : "#f4efe5", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {!g.img && <span style={{ fontSize: 24, opacity: 0.35 }}>🥬</span>}
          {canEdit && <button onClick={e => { e.stopPropagation(); imgFor.current = g.id; imgRef.current && imgRef.current.click(); }} title="上傳/更換圖片" style={{ position: "absolute", right: 4, bottom: 4, border: "none", background: "rgba(29,26,21,.65)", color: "#fff", borderRadius: 6, padding: "2px 7px", fontSize: 11, cursor: "pointer" }}>📷</button>}
          {g.isKey && <span style={{ position: "absolute", left: 4, top: 4, color: "#E8A317", fontSize: 14 }}>★</span>}
        </div>
        <div style={{ padding: "6px 8px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || "（未命名）"}</div>
          <div style={{ fontSize: 10, color: C.faint, fontFamily: MONOF }}>{mainVi && packToBase(mainVi) ? `1${mainVi.unit || "件"}=${Number(mainVi.packToBase).toLocaleString()}${g.baseUnit}` : "1件=？"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            {showMoney && <span style={{ fontSize: 10.5, fontFamily: MONOF, fontWeight: 700, color: minU != null ? C.text : "#d5cbb6" }}>{minU != null ? `$${d2(minU)}/${g.baseUnit}` : "—"}</span>}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, color: g.countFreq && g.countFreq.type !== "none" && !g.countFreq.paused ? "#fff" : C.sub, background: g.countFreq && g.countFreq.type !== "none" && !g.countFreq.paused ? C.blue : "#efe9db", borderRadius: 8, padding: "1px 6px" }}>{freqText(g.countFreq)}</span>
          </div>
        </div>
      </div>
    );
  };

  // ── 廠商視角 ──
  const vendorView = () => {
    const vs = (db.vendors || []).slice().sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || (a.sort || 0) - (b.sort || 0)).filter(v => itemsOfV(v.id).length);
    if (!vs.length) return <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10 }}>還沒有廠商品項——用「📸 貼截圖匯入」或到「廠商」頁建。</div>;
    return vs.map(v => {
      const its = itemsOfV(v.id).filter(vi => !qq || `${vi.name || ""} ${vi.spec || ""}`.toLowerCase().includes(qq));
      if (!its.length) return null;
      const opened = colV[v.id] !== false;
      return (
        <div key={v.id} style={{ background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
          <div onClick={() => setColV(s => ({ ...s, [v.id]: !opened }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#ece4d6", cursor: "pointer" }}>
            <span style={{ fontSize: 10, color: C.faint }}>{opened ? "▾" : "▸"}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{v.official ? "✓ " : ""}{v.name}</span>
            <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{its.length} 項</span>
          </div>
          {opened && disp === "grid" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 10 }}>
              {its.map(vi => { const g = all.find(x => x.id === vi.ingredient_id); return (
                <div key={vi.id} draggable={canEdit} onDragStart={() => setDragI(vi.id)} onDragOver={e => dragI && e.preventDefault()} onDrop={() => dropItemOn(vi.id, v.id)}
                  onClick={() => g && setOpen(g.id)}
                  style={{ width: 150, border: `1.5px solid ${C.hard}`, borderRadius: 10, overflow: "hidden", background: "#fff", cursor: g ? "pointer" : "default" }}>
                  <div style={{ height: 80, background: g && g.img ? `url(${g.img}) center/cover` : "#f4efe5", display: "flex", alignItems: "center", justifyContent: "center" }}>{!(g && g.img) && <span style={{ fontSize: 20, opacity: 0.3 }}>📦</span>}</div>
                  <div style={{ padding: "5px 8px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vi.name}</div>
                    <div style={{ fontSize: 9.5, color: C.faint }}>{vi.spec || "—"}</div>
                    {showMoney && <div style={{ fontSize: 10.5, fontFamily: MONOF, fontWeight: 700, color: C.sub }}>{(lastPaid(vi) || {}).price ? `$${d2(lastPaid(vi).price)}/${vi.unit || "件"}` : "—"}</div>}
                  </div>
                </div>
              ); })}
            </div>
          )}
          {opened && disp === "list" && <>
            <div style={{ display: "grid", gridTemplateColumns: `minmax(130px,1.4fr) minmax(90px,1fr) 150px ${showMoney ? "100px " : ""}minmax(90px,1fr)`, gap: 8, padding: "3px 12px", fontSize: 9.5, color: C.faint, fontWeight: 700 }}>
              <span>品名（拖曳可排序）</span><span>規格</span><span>每件入數</span>{showMoney && <span style={{ textAlign: "right" }}>最近實付</span>}<span>物料卡</span>
            </div>
            {its.map(vi => { const g = all.find(x => x.id === vi.ingredient_id); const lp = lastPaid(vi); return (
              <div key={vi.id} draggable={canEdit} onDragStart={() => setDragI(vi.id)} onDragOver={e => dragI && e.preventDefault()} onDrop={() => dropItemOn(vi.id, v.id)}
                style={{ display: "grid", gridTemplateColumns: `minmax(130px,1.4fr) minmax(90px,1fr) 150px ${showMoney ? "100px " : ""}minmax(90px,1fr)`, gap: 8, alignItems: "center", minHeight: 32, padding: "2px 12px", borderTop: `1px solid #f0ead9`, fontSize: 12, background: "#fff", cursor: canEdit ? "grab" : "default" }}>
                <span style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vi.name}</span>
                <span style={{ color: C.sub, fontSize: 11 }}>{vi.spec || "—"}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                  1{vi.unit || "件"}=
                  <input value={vi.packToBase ?? ""} onChange={e => save({ vendorItems: (db.vendorItems || []).map(x => x.id === vi.id ? { ...x, packToBase: e.target.value.replace(/[^0-9.]/g, "") } : x) })} disabled={!canEdit} inputMode="decimal" placeholder="？" style={{ ...inp, width: 60, padding: "2px 6px", fontFamily: MONOF, borderColor: packToBase(vi) ? C.line : C.red }} />
                  {g ? g.baseUnit : ""}
                </span>
                {showMoney && <span style={{ fontFamily: MONOF, textAlign: "right", fontSize: 11.5, color: lp ? C.text : "#d5cbb6" }}>{lp ? `$${d2(lp.price)}` : "—"}</span>}
                {g ? <span onClick={() => setOpen(g.id)} style={{ fontSize: 10.5, fontWeight: 700, color: C.blue, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span> : <span style={{ fontSize: 10.5, color: C.amber, fontWeight: 700 }}>⚠ 未整理</span>}
              </div>
            ); })}
          </>}
        </div>
      );
    });
  };

  const openG = open && all.find(g => g.id === open);

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) upImg(f); e.target.value = ""; }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>物料</span>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text }} title="截圖貼上就能匯入品項；同名自動併卡、入數自動抓；拖曳可排序。">物料清單</div>
        {/* 視角/顯示切換 */}
        <div style={{ display: "flex", background: "#e8e0cf", borderRadius: 8, padding: 2 }}>
          <button onClick={() => setVw("mat")} style={seg(vw === "mat")}>🥬 物料</button>
          <button onClick={() => setVw("ven")} style={seg(vw === "ven")}>🏭 廠商</button>
        </div>
        <div style={{ display: "flex", background: "#e8e0cf", borderRadius: 8, padding: 2 }}>
          <button onClick={() => setDisp("list")} style={seg(disp === "list")}>☰ 清單</button>
          <button onClick={() => setDisp("grid")} style={seg(disp === "grid")}>🖼 圖片</button>
        </div>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 搜尋" style={{ ...inp, width: 130 }} />
        {canEdit && <button onClick={() => setImp({ vid: "", newVendor: "", vendorGuess: "", rows: [], busy: "" })} style={{ border: `1.5px solid ${C.accent}`, background: "#fff", color: C.accent, borderRadius: 7, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>📸 貼截圖匯入</button>}
        {canEdit && <button onClick={() => { const g = { id: rid("g"), name: "", cat: "", baseUnit: "g", countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: all.length, tags: "" }; save({ ingredients: [...(db.ingredients || []), g] }); setVw("mat"); setDisp("list"); setOpen(g.id); }} style={sbtn}>＋ 手動新增</button>}
        {canEdit && <button onClick={autoOrganize} disabled={!pending.length} style={{ border: "none", background: pending.length ? C.accent : "#d5cbb6", color: "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: pending.length ? "pointer" : "default" }}>⚡ 自動整理{pending.length ? `（${pending.length}）` : ""}</button>}
      </div>
      <datalist id="ingcats">{[...new Set(all.map(x => (x.cat || "").trim()).filter(Boolean))].map(c2 => <option key={c2} value={c2} />)}</datalist>

      {/* 建議合併 */}
      {canEdit && vw === "mat" && sugg.length > 0 && (
        <div style={{ background: "#f2f6fb", border: `1.5px solid ${C.blue}`, borderRadius: 10, marginBottom: 10, padding: "8px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 4 }}>🔗 這幾組名字很像，是同一種東西嗎？（合併後多家廠商在同一張卡比價）</div>
          {sugg.slice(0, 6).map(({ key, a, b }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28, fontSize: 12, borderTop: `1px solid #dde6f2` }}>
              <span style={{ fontWeight: 700 }}>{a.name}</span><span style={{ color: C.faint }}>vs</span><span style={{ fontWeight: 700 }}>{b.name}</span>
              <span style={{ fontSize: 10.5, color: C.faint }}>（{srcsOf(db, a.id).map(x => vname(x.vendor_id)).join("、") || "無賣家"}｜{srcsOf(db, b.id).map(x => vname(x.vendor_id)).join("、") || "無賣家"}）</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => doMerge(a, b)} style={{ ...sbtn, color: C.green, borderColor: C.green }}>是，合併</button>
              <button onClick={() => dismissSugg(key)} style={sbtn}>不是，別再問</button>
            </div>
          ))}
          {sugg.length > 6 && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>還有 {sugg.length - 6} 組，處理完上面會接著出現。</div>}
        </div>
      )}

      {/* 批次工具列（物料視角清單模式） */}
      {vw === "mat" && disp === "list" && selIds.length > 0 && (
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
          <span style={{ width: 8 }} />
          <button onClick={async () => {
            if (!(await confirm(`刪除勾選的 ${selIds.length} 項？會整個移除（叫貨表裡也會消失）。\n只是不想盤點的話，按「不盤」就好，不用刪。`, { confirmLabel: "刪除" }))) return;
            save({ ingredients: (db.ingredients || []).filter(x => !sel2[x.id]), vendorItems: (db.vendorItems || []).filter(v => !sel2[v.ingredient_id]) });
            setSel2({}); flash(`✓ 已刪除 ${selIds.length} 項`);
          }} style={{ border: "1px solid #b3261e", background: "#b3261e", color: "#fff", borderRadius: 7, padding: "3px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>刪除</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setSel2({})} style={{ border: "none", background: "none", color: "#d9cfbd", fontSize: 11.5, cursor: "pointer" }}>取消選取</button>
        </div>
      )}

      {vw === "mat" && shown.length === 0 && pending.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 12 }}>{qq ? "沒有符合的物料。" : "還沒有物料卡——用「📸 貼截圖匯入」或到「廠商」頁建品項後按「⚡ 自動整理」。"}</div>}
      {vw === "mat" && shown.length === 0 && pending.length > 0 && !qq && <div style={{ padding: 30, textAlign: "center", color: C.sub, background: "#fbeee6", border: `1.5px solid ${C.accent}`, borderRadius: 10, marginBottom: 12, fontSize: 13 }}>有 <b>{pending.length}</b> 筆廠商品項等著變物料卡——按右上角「<b>⚡ 自動整理</b>」，名稱、分類、每件入數都會自動填好。</div>}

      {/* 物料視角 */}
      {vw === "mat" && cats.map(cat => {
        const rows = shown.filter(g => ((g.cat || "").trim() || "未分類") === cat);
        const allSel = rows.every(g => sel2[g.id]);
        return (
          <div key={cat} style={{ background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#ece4d6" }}>
              {disp === "list" && <input type="checkbox" checked={allSel} onChange={e => setSel2(s => { const n = { ...s }; rows.forEach(g => { n[g.id] = e.target.checked; }); return n; })} disabled={!canEdit} title="全選這個分類" style={{ cursor: "pointer" }} />}
              <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{cat}</span>
              <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{rows.length} 項</span>
            </div>
            {disp === "list" && <>
              <div style={{ display: "grid", gridTemplateColumns: `26px 24px minmax(120px,1.4fr) 110px 90px ${showMoney ? "110px " : ""}96px 30px`, gap: 6, padding: "3px 10px", fontSize: 9.5, color: C.faint, fontWeight: 700 }}>
                <span /><span /><span>名稱（拖曳可排序）</span><span>每件入數</span><span>哪些廠商賣</span>{showMoney && <span style={{ textAlign: "right" }}>最低價</span>}<span>盤點</span><span />
              </div>
              {rows.map(listRow)}
            </>}
            {disp === "grid" && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 10 }}>{rows.map(gridCard)}</div>}
          </div>
        );
      })}

      {/* 廠商視角 */}
      {vw === "ven" && vendorView()}

      {/* 非物料收摺區（物料視角） */}
      {vw === "mat" && svcList.length > 0 && (
        <div style={{ background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 12, overflow: "hidden", opacity: 0.85 }}>
          <div onClick={() => setShowSvc(s => !s)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#ece4d6", cursor: "pointer" }}>
            <span style={{ fontSize: 10, color: C.faint }}>{showSvc ? "▾" : "▸"}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>🧾 非物料（服務/費用類）</span>
            <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{svcList.length} 項・不參與盤點/成本/比價</span>
          </div>
          {showSvc && svcList.map(g => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30, padding: "2px 12px", borderTop: `1px solid #f0ead9`, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: C.sub }}>{g.name}</span>
              <span style={{ fontSize: 10.5, color: C.faint }}>{srcsOf(db, g.id).map(x => vname(x.vendor_id)).join("、")}</span>
              <div style={{ flex: 1 }} />
              {canEdit && <button onClick={() => updIng(g.id, { nonStock: false })} style={{ ...sbtn, fontSize: 10.5 }}>其實是物料，移回去</button>}
            </div>
          ))}
        </div>
      )}

      {/* 圖片視角/廠商視角 點卡 → 詳情彈窗（跟清單展開同一份內容） */}
      {openG && (disp === "grid" || vw === "ven") && (
        <div onClick={e => e.target === e.currentTarget && setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 720, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, width: "min(760px,96vw)", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 14.5, fontWeight: 800, color: C.text }}>{openG.name || "（未命名）"}</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setOpen(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.sub }}>×</button>
            </div>
            {detailBody(openG)}
          </div>
        </div>
      )}

      {/* 📸 截圖匯入 modal */}
      {imp && (
        <div onClick={e => e.target === e.currentTarget && !imp.busy && setImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 730, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, width: "min(720px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 14.5, fontWeight: 800, color: C.text }}>📸 貼截圖匯入品項</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setImp(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.sub }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>這批是哪家廠商的：</span>
              <select value={imp.vid} onChange={e => setImp(m => ({ ...m, vid: e.target.value }))} style={{ ...inp, minWidth: 150 }}>
                <option value="">選廠商…</option>
                {(db.vendors || []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                <option value="__new">＋ 新廠商</option>
              </select>
              {imp.vid === "__new" && <input value={imp.newVendor} onChange={e => setImp(m => ({ ...m, newVendor: e.target.value }))} placeholder={imp.vendorGuess || "新廠商名稱"} style={{ ...inp, width: 140 }} />}
              {imp.vendorGuess && imp.vid === "" && <span style={{ fontSize: 11, color: C.faint }}>（AI 猜是「{imp.vendorGuess}」）</span>}
            </div>
            {/* 貼上/上傳區 */}
            <div onClick={() => shotRef.current && shotRef.current.click()} style={{ border: `2px dashed ${C.line}`, borderRadius: 10, padding: "18px 12px", textAlign: "center", color: C.sub, fontSize: 13, cursor: "pointer", background: "#fdfaf3", marginBottom: 10 }}>
              {imp.busy ? <b>⏳ {imp.busy}</b> : <>直接 <b>Ctrl/Cmd+V 貼上截圖</b>，或點這裡上傳圖片（可多張、可連續貼）</>}
            </div>
            <input ref={shotRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { parseShots(e.target.files); e.target.value = ""; }} />
            {/* 預覽表：AI 結果可勾可改，人工確認才寫入 */}
            {imp.rows.length > 0 && <>
              <div style={{ display: "grid", gridTemplateColumns: "26px 36px minmax(140px,1.5fr) minmax(100px,1fr) 64px 84px", gap: 6, padding: "4px 6px", fontSize: 10, color: C.faint, fontWeight: 700, background: "#f4efe5", borderRadius: 6 }}>
                <span /><span>圖</span><span>品名</span><span>規格</span><span>單位</span><span style={{ textAlign: "right" }}>單價</span>
              </div>
              {imp.rows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "26px 36px minmax(140px,1.5fr) minmax(100px,1fr) 64px 84px", gap: 6, alignItems: "center", padding: "3px 6px", borderBottom: `1px solid #f0ead9`, opacity: r.on ? 1 : 0.45 }}>
                  <input type="checkbox" checked={r.on} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, on: e.target.checked } : x) }))} />
                  <span title={r.thumbUrl ? "會一起掛到物料卡" : "這筆沒抓到商品照片（不影響匯入，之後可手動補圖）"} style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${C.line}`, background: r.thumbUrl ? `url(${r.thumbUrl}) center/cover` : "#f4efe5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.faint }}>{r.thumbUrl ? "" : "—"}</span>
                  <input value={r.name} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} style={{ ...inp, padding: "3px 7px", fontSize: 12 }} />
                  <input value={r.spec} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, spec: e.target.value } : x) }))} style={{ ...inp, padding: "3px 7px", fontSize: 11.5 }} />
                  <input value={r.unit} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, unit: e.target.value } : x) }))} style={{ ...inp, padding: "3px 7px", fontSize: 11.5 }} />
                  <input value={r.price} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, price: e.target.value.replace(/[^0-9.]/g, "") } : x) }))} inputMode="decimal" style={{ ...inp, padding: "3px 7px", fontSize: 11.5, fontFamily: MONOF, textAlign: "right" }} />
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 11.5, color: C.faint }}>已勾 {imp.rows.filter(r => r.on && r.name.trim()).length} 筆。匯入後自動建物料卡、同名自動併卡、入數自動從規格抓。</span>
                <div style={{ flex: 1 }} />
                <button onClick={doImport} disabled={!imp.rows.some(r => r.on && r.name.trim()) || !!imp.busy} style={{ border: "none", background: imp.rows.some(r => r.on && r.name.trim()) && !imp.busy ? C.green : "#d5cbb6", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ 確認匯入</button>
              </div>
            </>}
          </div>
        </div>
      )}
    </div>
  );
}
