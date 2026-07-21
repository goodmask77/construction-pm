// 物料清單頁 v3（2026-07-20）：視角切換（物料/廠商）＋顯示切換（清單/圖片）＋拖曳排序＋📸截圖AI匯入
// v2 原則不變：預設全自動（⚡自動整理/同名併卡/規格解析入數/服務類收摺），人只處理例外
// 截圖匯入：貼上或上傳截圖 → AI 解析品項 → 人工確認才寫入（AI 辨識必經人確認，張良原則）
import React, { useEffect, useRef, useState } from "react";
import { Leaf, Factory, List, Image as ImageIcon, Camera, Zap, ZoomIn, ExternalLink } from "lucide-react";
import { C, MONOF, rid } from "./Supply.jsx";
import { packToBase, lastPaid, unitCost, srcsOf, priceAlert, normName, organizeAll, repairPackToBase } from "./inv.js";
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
  const [colCat, setColCat] = useState({});      // 物料視角：分類收合（truthy=收合）
  const [zoom, setZoom] = useState(null);        // 圖片放大檢視（lightbox）url
  const [imp, setImp] = useState(null);          // 截圖匯入 modal：{vid,newVendor,vendorGuess,rows,busy}
  const imgRef = useRef(null); const imgFor = useRef(null); // 圖片上傳 input + 目標物料 id
  const viImgRef = useRef(null); const viImgFor = useRef(null); // 貨源（品項）自己的照片上傳
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

  // ── 卡片編輯快照：打開時記原狀，「取消」整卡復原（改動平常即時存檔，確定=收尾不動作）──
  const snapRef = useRef(null);
  useEffect(() => {
    if (!open) { snapRef.current = null; return; }
    const g = (db.ingredients || []).find(x => x.id === open);
    if (!g) return;
    snapRef.current = { id: open, ing: JSON.parse(JSON.stringify(g)), vis: JSON.parse(JSON.stringify((db.vendorItems || []).filter(v => v.ingredient_id === open))) };
  }, [open]); // eslint-disable-line
  const cancelEdit = () => {
    const s = snapRef.current;
    if (s && s.id === open) {
      const byId = new Map(s.vis.map(v => [v.id, v]));
      save({ ingredients: (db.ingredients || []).map(x => x.id === s.id ? s.ing : x), vendorItems: (db.vendorItems || []).map(v => byId.get(v.id) || v) });
      flash("↩ 已取消，這張卡恢復打開前的樣子");
    }
    setOpen(null);
  };

  // ── 包材庫一次性鏡射（2026-07-20 張良：包材庫品項直接搬到物料清單，標★置頂重點比價）──
  useEffect(() => {
    if (!canEdit || (db.settings && db.settings.matMirrored)) return;
    const mats = db.materials || []; if (!mats.length) return;
    const byN = new Set((db.ingredients || []).map(g => normName(g.name)).filter(Boolean));
    const add = mats.filter(m => (m.name || "").trim() && !byN.has(normName(m.name))).map((m, i) => ({ id: rid("g"), name: m.name.trim(), cat: "菜單包材", baseUnit: "個", countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: true, safeStock: "", note: m.spec ? `規格 ${m.spec}` : "", sort: (db.ingredients || []).length + i, tags: "", matId: m.id }));
    save({ ingredients: [...(db.ingredients || []), ...add], settings: { ...(db.settings || {}), matMirrored: 1 } });
    if (add.length) flash(`📦 已把包材庫 ${add.length} 項搬進物料清單（標★置頂、分類「菜單包材」）——等廠商報價/截圖匯入同名品項會自動掛上比價`);
  }, [db.settings && db.settings.matMirrored, canEdit]); // eslint-disable-line

  // ── 卡片開著時直接 Ctrl+V 貼截圖＝換卡片圖片（通則）──
  useEffect(() => {
    if (!open || imp || !canEdit) return;
    const h = (e) => { const its = (e.clipboardData || {}).items || []; for (const it of its) { if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) { e.preventDefault(); imgFor.current = open; upImg(f); return; } } } };
    window.addEventListener("paste", h); return () => window.removeEventListener("paste", h);
  }, [open, imp, canEdit]); // eslint-disable-line

  // ── 多層包裝入數自動修復（2026-07-21 張良：一箱怎會=100？舊版規格解析只抓第一段「100張/包 60包/箱」誤=100）──
  // 只修「現值＝舊版誤值」的機器填值，人工改過的不碰；修完即冪等不會重複觸發
  useEffect(() => {
    if (!canEdit) return;
    const r = repairPackToBase(db.vendorItems, db.ingredients);
    if (r.fixed) { save({ vendorItems: r.vendorItems }); flash(`✓ 已自動補正 ${r.fixed} 筆每件入數（多層包裝鏈乘／單顆計價=1）`); }
  }, [(db.vendorItems || []).length, canEdit]); // eslint-disable-line

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

  // ── 貨源（品項）自己的照片：跟卡片主圖分家，合併/換卡都跟著品項走 ──
  const upViImg = async (file) => {
    const vid = viImgFor.current; if (!vid || !file) return;
    try { const { url, path } = await uploadPhoto(file); save({ vendorItems: (db.vendorItems || []).map(v => v.id === vid ? { ...v, img: url, imgPath: path } : v) }); flash("✓ 品項照片已更新"); }
    catch (e) { flash("圖片上傳失敗：" + (e?.message || e)); }
  };

  // ── ✂️ 拆出：合併錯了，把單一貨源拆回獨立一張卡（照片跟著走）──
  const splitOut = async (g, vi) => {
    if (!(await confirm(`把「${vi.name}」從「${g.name}」拆出去、自己成一張卡？`, { confirmLabel: "拆出" }))) return;
    const ng = { id: rid("g"), name: (vi.name || "").trim() || "未命名", cat: g.cat || "", baseUnit: g.baseUnit || "個", countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: (db.ingredients || []).length, tags: "", img: vi.img || "", imgPath: vi.imgPath || "" };
    save({ ingredients: [...(db.ingredients || []), ng], vendorItems: (db.vendorItems || []).map(v => v.id === vi.id ? { ...v, ingredient_id: ng.id } : v) });
    setOpen(null);
    flash(`✂️ 已把「${vi.name}」拆成獨立卡片`);
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
    // 照片保護（2026-07-22 張良：合併後品項照片不見）：被併卡的圖下放給沒圖的貨源；目標卡沒主圖就接手當代表圖
    save({
      ingredients: (db.ingredients || []).filter(x => x.id !== src.id).map(x => x.id === target.id && !x.img && src.img ? { ...x, img: src.img, imgPath: src.imgPath || "" } : x),
      vendorItems: (db.vendorItems || []).map(v => v.ingredient_id === src.id ? { ...v, ingredient_id: target.id, img: v.img || src.img || "", imgPath: v.imgPath || src.imgPath || "" } : v),
    });
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
  // AI 座標會飄 → 像素校正：在候選框附近找「最大塊連續內容」（縮圖=大方塊；價格/文字=矮條，會被排除）
  const refineBox = (im, b) => {
    try {
      const W = im.naturalWidth, H = im.naturalHeight;
      const pad = Math.round(Math.max(b.w, b.h) * 0.45);
      const x0 = Math.max(0, Math.round(b.x) - pad), y0 = Math.max(0, Math.round(b.y) - pad);
      const x1 = Math.min(W, Math.round(b.x + b.w) + pad), y1 = Math.min(H, Math.round(b.y + b.h) + pad);
      const cw = x1 - x0, ch = y1 - y0;
      if (cw < 40 || ch < 40) return b;
      const c = document.createElement("canvas"); c.width = cw; c.height = ch;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(im, x0, y0, cw, ch, 0, 0, cw, ch);
      const d = ctx.getImageData(0, 0, cw, ch).data;
      const rowD = new Array(ch).fill(0), isBg = (i) => d[i] > 232 && d[i + 1] > 228 && d[i + 2] > 220; // 白/米白頁面底色都算背景
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { if (!isBg((y * cw + x) * 4)) rowD[y]++; }
      // 最長連續「內容列」＝縮圖高度範圍
      const thR = cw * 0.3; let bT = -1, bB = -1, t = -1;
      for (let y = 0; y <= ch; y++) {
        const on = y < ch && rowD[y] >= thR;
        if (on && t < 0) t = y;
        if (!on && t >= 0) { if (bT < 0 || (y - t) > (bB - bT)) { bT = t; bB = y; } t = -1; }
      }
      if (bT < 0 || bB - bT < 30) return b;
      const colD = new Array(cw).fill(0);
      for (let y = bT; y < bB; y++) for (let x = 0; x < cw; x++) { if (!isBg((y * cw + x) * 4)) colD[x]++; }
      const thC = (bB - bT) * 0.3; let bL = -1, bR = -1; t = -1;
      for (let x = 0; x <= cw; x++) {
        const on = x < cw && colD[x] >= thC;
        if (on && t < 0) t = x;
        if (!on && t >= 0) { if (bL < 0 || (x - t) > (bR - bL)) { bL = t; bR = x; } t = -1; }
      }
      if (bL < 0 || bR - bL < 30) return b;
      return { x: x0 + bL, y: y0 + bT, w: bR - bL, h: bB - bT };
    } catch (_) { return b; }
  };
  const parseShots = async (files) => {
    const arr = Array.from(files || []).filter(f => /^image\//.test(f.type)); if (!arr.length) return;
    setImp(m => m ? { ...m, busy: `AI 解析中（${arr.length} 張）…` } : m);
    for (const f of arr) {
      try {
        const [b64, im] = await Promise.all([fileToB64(f), loadImgEl(f)]);
        const W = im.naturalWidth, H = im.naturalHeight;
        const block = { type: "image", source: { type: "base64", media_type: f.type || "image/png", data: b64 } };
        const prompt = `這是廠商網站/購物車/報價單/型錄的截圖，原始尺寸 ${W}x${H} 像素。抽出每一個商品，只回 JSON、不要其他文字：{"vendor":"截圖上可辨識的廠商或網站名稱(沒有就空字串)","url":"截圖裡瀏覽器網址列的完整網址(看不到網址列就空字串)","items":[{"name":"品名","spec":"包裝規格(例:1000入/箱,600g/包,沒有就空字串)","unit":"採購單位(照截圖單位欄原文:箱/件/包/組/個/支/張…,看不到才預設箱)","price":單價數字,"moq":最低訂購量數字(沒有就0),"note":"版費/模具費/交期等備註(沒有就空字串)","img":{"x":左上x,"y":左上y,"w":寬,"h":高}}]}。金額欄位判讀鐵則：①「數量 50000張」「數量5000個」這種＝最低訂購量MOQ→放 moq，絕對不是包裝規格、不要抄進 spec 或品名。②「@1.32/pc」「@5.80/pc」＝每一個的單價→price=1.32、unit=個。③「版費 5000.00」等一次性費用→寫進 note，不是單價。④spec 只放「一箱/一包裝幾個」的包裝規格（例:2000pcs/箱），報價訊息通常沒有，留空。品名規則（張良 2026-07-20 拍板）：①name＝【主標題完整原文，一字不改、包含規格】（例：主標「紙漿杯座-二杯-原色-600入/箱」→ name=紙漿杯座-二杯-原色-600入/箱）。副標/小字（如型號 HR-紙漿二杯架）不要放進品名。②spec＝把規格再抄一份到 spec 欄（例：600入/箱），系統算每件入數用；主標沒有規格才從副標/頁面找。③唯一例外：多列主標題「完全相同」時＝其實是不同商品（例：主標同為「餐刀/叉/匙-白色(散裝) 2000入/箱」三列、副標分別是餐刀/餐叉/餐匙）——此時把主標中的共用字換成副標的差異字組出可區分品名（例：霧面餐刀-白色(散裝) 2000入/箱），每一列都要輸出，不可省略或合併。img=該商品縮圖照片在截圖中的像素範圍（以原始 ${W}x${H} 座標、整數、框準照片本身不含文字），該商品沒有照片就給 null。金額只放數字，看不到的欄位留空字串或 0。`;
        const reply = await callAI([{ role: "user", content: [block, { type: "text", text: prompt }] }], "你是採購品項解析助理，只輸出 JSON。", "import");
        const clean = reply.replace(/```json|```/gi, "").trim();
        const parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
        const rows = [];
        for (const it of (parsed.items || [])) {
          const name = String(it.name || "").trim(); if (!name) continue;
          const box = it.img && typeof it.img === "object" ? { x: Number(it.img.x) || 0, y: Number(it.img.y) || 0, w: Number(it.img.w) || 0, h: Number(it.img.h) || 0 } : null;
          rows.push({ on: true, name, spec: String(it.spec || "").trim(), unit: String(it.unit || "箱").trim() || "箱", price: Number(it.price) || "", moq: Number(it.moq) || "", note: String(it.note || "").trim(), url: "", thumb: null, thumbUrl: "", box });
        }
        // 商品頁截圖（單一商品）→ 網址列的網址掛到該品項；多品項（購物車/報價單）網址非單品專屬不掛
        const pageUrl = String(parsed.url || "").trim();
        if (rows.length === 1 && /^https?:\/\//.test(pageUrl)) rows[0].url = pageUrl;
        // 座標校正①：同一張截圖的縮圖通常同尺寸同 x → 取中位數統一（AI 座標飄的自動拉回）
        const bs = rows.filter(r => r.box && r.box.w >= 20 && r.box.h >= 20);
        if (bs.length >= 3) {
          const med = (a) => { const s2 = [...a].sort((x, y) => x - y); return s2[Math.floor(s2.length / 2)]; };
          const mx = med(bs.map(r => r.box.x)), mw = med(bs.map(r => r.box.w)), mh = med(bs.map(r => r.box.h));
          bs.forEach(r => { const cy = r.box.y + r.box.h / 2; r.box = { x: mx, y: cy - mh / 2, w: mw, h: mh }; });
        }
        // 座標校正②：像素邊界偵測鎖定縮圖本體 → 裁圖
        for (const r of rows) {
          if (!r.box || r.box.w < 20 || r.box.h < 20) { delete r.box; continue; }
          const thumb = await cropBox(im, refineBox(im, r.box));
          if (thumb) { r.thumb = thumb; r.thumbUrl = URL.createObjectURL(thumb); }
          delete r.box;
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
      if (ex) { vis2 = vis2.map(v => v.id === ex.id ? { ...v, spec: r.spec.trim() || v.spec, unit: r.unit || v.unit, price: r.price !== "" ? r.price : v.price, moq: r.moq !== "" ? r.moq : (v.moq ?? ""), note: r.note || v.note || "", url: r.url || v.url || "" } : v); updN++; }
      else { vis2.push({ id: rid("vi"), vendor_id: vid, grp: "", name: r.name.trim(), spec: r.spec.trim(), unit: r.unit || "箱", price: r.price || "", moq: r.moq || "", note: r.note || "", url: r.url || "", safeStock: "", sort: baseSort + i, tags: "" }); addN++; }
    });
    const plan = organizeAll({ ...db, vendors: vendors2, vendorItems: vis2 });
    // 截圖裁下的商品照片 → 上傳 → 存到「貨源」自己身上（品項的圖跟品項走，合併也不丟）＋物料卡沒主圖就順便當代表圖
    let imgN = 0;
    const withThumb = rows.filter(r => r.thumb);
    if (withThumb.length) {
      setImp(m => m ? { ...m, busy: `上傳圖片中（${withThumb.length} 張）…` } : m);
      for (const r of withThumb) {
        const key = normName(r.name);
        const g = plan.ingredients.find(x => normName(x.name) === key);
        const vi2 = plan.vendorItems.find(v => v.vendor_id === vid && normName(v.name) === key);
        if ((!g || g.img) && (!vi2 || vi2.img)) continue;
        try {
          const file = new File([r.thumb], "item.jpg", { type: "image/jpeg" });
          const { url, path } = await uploadPhoto(file);
          if (vi2 && !vi2.img) plan.vendorItems = plan.vendorItems.map(v => v.id === vi2.id ? { ...v, img: url, imgPath: path } : v);
          if (g && !g.img) plan.ingredients = plan.ingredients.map(x => x.id === g.id ? { ...x, img: url, imgPath: path } : x);
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
  // 分類順序：settings.ingCatOrder（可拖曳排序），沒登記的照筆畫排後面
  const catOrder = (db.settings && db.settings.ingCatOrder) || [];
  const cats = [...new Set(shown.map(g => (g.cat || "").trim() || "未分類"))].sort((a, b) => {
    const ia = catOrder.indexOf(a), ib = catOrder.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, "zh-TW");
  });
  const [dragCat2, setDragCat2] = [drag && drag.startsWith("cat:") ? drag.slice(4) : null, (c2) => setDrag(c2 ? "cat:" + c2 : null)];
  const dropCatOn = (target) => {
    if (!dragCat2 || dragCat2 === target) return setDragCat2(null);
    const names = [...cats];
    const from = names.indexOf(dragCat2), to = names.indexOf(target);
    if (from < 0 || to < 0) return setDragCat2(null);
    const [mv] = names.splice(from, 1); names.splice(to, 0, mv);
    save({ settings: { ...(db.settings || {}), ingCatOrder: names } }); setDragCat2(null);
  };

  // ── 物料詳情內容（清單展開與圖片視角彈窗共用）──
  const detailBody = (g) => {
    const srcs = srcsOf(db, g.id);
    const units = srcs.map(vi => unitCost(vi)).filter(u => u != null);
    const minU = units.length ? Math.min(...units) : null;
    return (
      <div onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          {/* 圖片：點縮圖或按鈕換圖（也可在圖片視角卡片上直接按📷） */}
          {/* 有圖：點縮圖=放大看；換圖用旁邊小鈕或直接 Ctrl+V 貼。無圖：點=上傳 */}
          <span onClick={() => { if (g.img) setZoom(g.img); else if (canEdit) { imgFor.current = g.id; imgRef.current && imgRef.current.click(); } }} title={g.img ? "點擊放大檢視" : "點擊上傳，或直接 Ctrl/Cmd+V 貼上截圖"} style={{ width: 46, height: 46, borderRadius: 8, border: `1px solid ${C.line}`, background: g.img ? `url(${g.img}) center/cover` : "#f4efe5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: C.faint, cursor: g.img || canEdit ? "pointer" : "default", flexShrink: 0 }}>{g.img ? "" : "📷"}</span>
          {g.img && canEdit && <button onClick={() => { imgFor.current = g.id; imgRef.current && imgRef.current.click(); }} title="更換圖片（也可直接 Ctrl+V 貼上）" style={{ ...sbtn, padding: "3px 8px", fontSize: 10.5 }}>換圖</button>}
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
          <div style={{ display: "grid", gridTemplateColumns: `34px minmax(80px,0.9fr) minmax(120px,1.3fr) 150px 92px ${showMoney ? "110px 90px" : ""}`, gap: 8, padding: "5px 10px", fontSize: 10, color: C.faint, fontWeight: 700, background: "#f4efe5" }}>
            <span>圖</span><span>廠商</span><span>品名/規格</span><span>每件入數</span><span title="這家報價的最低訂購量（MOQ）">最低訂購</span>{showMoney && <><span style={{ textAlign: "right" }}>最近實付</span><span style={{ textAlign: "right" }}>$/{g.baseUnit || "單位"}</span></>}
          </div>
          {srcs.length === 0 && <div style={{ padding: "8px 10px", fontSize: 11.5, color: C.red }}>沒有廠商賣這個——按上面「⚡ 自動整理」或用「📸 貼截圖匯入」。</div>}
          {srcs.map(vi => {
            const u = unitCost(vi); const lp = lastPaid(vi); const al = priceAlert(vi, alertPct);
            const best = showMoney && u != null && minU != null && u <= minU + 1e-9 && units.length > 1;
            return (
              <div key={vi.id} style={{ display: "grid", gridTemplateColumns: `34px minmax(80px,0.9fr) minmax(120px,1.3fr) 150px 92px ${showMoney ? "110px 90px" : ""}`, gap: 8, alignItems: "center", padding: "4px 10px", borderTop: `1px solid #f0ead9`, fontSize: 12, background: best ? "#eef5ef" : "#fff" }}>
                {/* 品項自己的照片：點擊上傳/更換（跟卡片主圖分家） */}
                <span onClick={() => { if (canEdit) { viImgFor.current = vi.id; viImgRef.current && viImgRef.current.click(); } else if (vi.img) setZoom(vi.img); }} title={vi.img ? "這個品項自己的照片（點擊更換）" : "點擊上傳這個品項自己的照片"} style={{ width: 30, height: 30, borderRadius: 6, border: `1px solid ${C.line}`, background: vi.img ? `url(${vi.img}) center/cover` : "#f4efe5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#c8bca6", cursor: "pointer", flexShrink: 0 }}>{vi.img ? "" : "＋"}</span>
                <span style={{ fontWeight: 700, color: C.text, minWidth: 0 }}>
                  <div>{vname(vi.vendor_id)}</div>
                  {canEdit && srcs.length > 1 && <button onClick={() => splitOut(g, vi)} title="把這個品項拆回獨立一張卡（合併錯了用這個）" style={{ ...sbtn, padding: "1px 8px", fontSize: 10, marginTop: 2 }}>✂ 拆出</button>}
                </span>
                {/* 品名/規格＋商品網址（截圖有網址列會自動帶入；太長截不進圖就直接貼這裡）*/}
                <span style={{ color: C.sub, fontSize: 11.5, minWidth: 0 }}>
                  <div>{vi.name}{vi.spec ? `（${vi.spec}）` : ""}</div>
                  {vi.note && <div style={{ fontSize: 10, color: C.faint }}>📝 {vi.note}</div>}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <input value={vi.url || ""} onChange={e => save({ vendorItems: (db.vendorItems || []).map(v => v.id === vi.id ? { ...v, url: e.target.value.trim() } : v) })} disabled={!canEdit} placeholder="貼商品網址…" style={{ ...inp, fontSize: 10, padding: "2px 6px", flex: 1, minWidth: 0, color: C.sub }} />
                    {/^https?:\/\//.test(vi.url || "") && <a href={vi.url} target="_blank" rel="noreferrer" title="打開商品網頁" onClick={e => e.stopPropagation()} style={{ color: C.blue, display: "flex", flexShrink: 0 }}><ExternalLink size={14} strokeWidth={2} /></a>}
                  </div>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                  1{vi.unit || "件"}=
                  <input value={vi.packToBase ?? ""} onChange={e => save({ vendorItems: (db.vendorItems || []).map(v => v.id === vi.id ? { ...v, packToBase: e.target.value.replace(/[^0-9.]/g, "") } : v) })} disabled={!canEdit} inputMode="decimal" placeholder="？" style={{ ...inp, width: 66, padding: "3px 6px", fontFamily: MONOF, borderColor: packToBase(vi) ? C.line : C.red }} />
                  {g.baseUnit}
                </span>
                {/* 最低訂購量 MOQ：報價「數量5000個」是至少要訂這麼多，不是入數（2026-07-21 張良） */}
                <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>
                  <input value={vi.moq ?? ""} onChange={e => save({ vendorItems: (db.vendorItems || []).map(v => v.id === vi.id ? { ...v, moq: e.target.value.replace(/[^0-9]/g, "") } : v) })} disabled={!canEdit} inputMode="numeric" placeholder="—" style={{ ...inp, width: 62, padding: "3px 6px", fontFamily: MONOF }} />
                  {Number(vi.moq) > 0 && g.baseUnit}
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
        {/* 確定/取消（2026-07-22 張良：要有確定跟取消）——取消=把這次打開後的所有修改復原 */}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={cancelEdit} title="放棄這次打開後的所有修改，恢復原狀" style={{ flex: 1, border: `1.5px solid #d9cfbd`, background: "#fff", color: C.sub, borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✕ 取消</button>
          <button onClick={() => setOpen(null)} style={{ flex: 2, border: "none", background: C.green, color: "#fff", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ 確定</button>
        </div>
      </div>
    );
  };

  // ── 物料視角：清單列（ground-pack 硬格線風：方角、直向格線、字體同產品管理；張良 2026-07-20）──
  const IGRID = `54px 38px minmax(150px,1.2fr) 118px minmax(130px,1.2fr) ${showMoney ? "92px " : ""}92px 26px`;
  const vline = { borderRight: "1px solid #e0d6bf", alignSelf: "stretch", display: "flex", alignItems: "center" };
  const listRow = (g) => {
    const srcs = srcsOf(db, g.id);
    const isOpen = open === g.id;
    const units = srcs.map(vi => unitCost(vi)).filter(u => u != null);
    const minU = units.length ? Math.min(...units) : null;
    const anyAlert = srcs.map(vi => priceAlert(vi, alertPct)).find(Boolean);
    const mainVi = srcs.find(vi => packToBase(vi)) || srcs[0];
    const vnames = [...new Set(srcs.map(vi => vname(vi.vendor_id)))].join("、");
    return (
      <React.Fragment key={g.id}>
        <div draggable={canEdit} onDragStart={() => setDrag(g.id)} onDragOver={e => drag && e.preventDefault()} onDrop={() => dropOn(g.id)}
          onClick={() => setOpen(isOpen ? null : g.id)}
          style={{ display: "grid", gridTemplateColumns: IGRID, alignItems: "stretch", minHeight: 34, borderTop: `1px solid #e0d6bf`, cursor: "pointer", background: isOpen ? "#fbeee6" : sel2[g.id] ? "#f2f6fb" : "#fff" }}
          onMouseEnter={e => { if (!isOpen && !sel2[g.id]) e.currentTarget.style.background = C.soft; }} onMouseLeave={e => { e.currentTarget.style.background = isOpen ? "#fbeee6" : sel2[g.id] ? "#f2f6fb" : "#fff"; }}>
          <div style={{ ...vline, padding: "0 6px", gap: 4, justifyContent: "center" }} onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={!!sel2[g.id]} onChange={e => setSel2(s => ({ ...s, [g.id]: e.target.checked }))} disabled={!canEdit} style={{ cursor: "pointer" }} />
            <button onClick={() => canEdit && updIng(g.id, { isKey: !g.isKey })} title={g.isKey ? "關鍵品項（點擊取消）" : "標為關鍵品項"} style={{ border: "none", background: "none", color: g.isKey ? "#E8A317" : "#d9cfbd", fontSize: 14, cursor: "pointer", padding: 0 }}>{g.isKey ? "★" : "☆"}</button>
          </div>
          {/* 縮圖欄：一眼看有沒有照片；點小圖=放大檢視 */}
          <div style={{ ...vline, padding: "3px 4px", justifyContent: "center" }} onClick={e => { if (g.img) { e.stopPropagation(); setZoom(g.img); } }}>
            <span title={g.img ? "點擊放大檢視" : "還沒有照片（點開卡片上傳或貼上）"} style={{ width: 28, height: 28, borderRadius: 5, border: `1px solid ${C.line}`, background: g.img ? `url(${g.img}) center/cover` : "#f4efe5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#d5cbb6", cursor: g.img ? "zoom-in" : "pointer", flexShrink: 0 }}>{g.img ? "" : "—"}</span>
          </div>
          {/* 名稱長也要看得到：最多兩行、hover 有完整名（2026-07-21 張良：欄位卡住名稱看不到後面） */}
          <div style={{ ...vline, padding: "3px 9px", overflow: "hidden" }}><span title={g.name || ""} style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.22, wordBreak: "break-all" }}>{g.name || <span style={{ color: C.faint }}>（未命名）</span>}{anyAlert && <span style={{ fontSize: 10, fontWeight: 700, color: anyAlert.up ? C.red : C.green, marginLeft: 4 }}>{anyAlert.up ? "▲" : "▼"}{Math.abs(anyAlert.pct)}%</span>}</span></div>
          <div style={{ ...vline, padding: "0 9px", fontFamily: MONOF, fontSize: 11.5, color: mainVi && packToBase(mainVi) ? C.sub : C.red }}>{mainVi ? (packToBase(mainVi) ? `1${mainVi.unit || "件"}=${Number(mainVi.packToBase).toLocaleString()}${g.baseUnit}` : "1件=？") : "—"}</div>
          <div style={{ ...vline, padding: "0 9px", overflow: "hidden" }}><span style={{ fontSize: 11.5, color: srcs.length ? C.sub : C.red, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={vnames}>{vnames || "沒人賣"}</span></div>
          {showMoney && <div style={{ ...vline, padding: "0 9px", fontFamily: MONOF, fontSize: 11.5, justifyContent: "flex-end", color: minU != null ? C.text : "#d5cbb6" }}>{minU != null ? `$${d2(minU)}/${g.baseUnit}` : "—"}</div>}
          <div style={{ ...vline, padding: "0 7px" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setOpen(isOpen ? null : g.id)} style={{ ...pill(g.countFreq && g.countFreq.type !== "none" && !g.countFreq.paused, C.blue), padding: "2px 9px", fontSize: 10.5 }}>{freqText(g.countFreq)}</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.faint }}>{isOpen ? "▾" : "▸"}</div>
        </div>
        {isOpen && <div style={{ padding: "10px 14px 12px 42px", borderTop: `1px solid #e0d6bf`, background: "#fdfaf3" }}>{detailBody(g)}</div>}
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
          {g.img && <button onClick={e => { e.stopPropagation(); setZoom(g.img); }} title="放大檢視" style={{ position: "absolute", right: 4, bottom: 4, border: "none", background: "rgba(29,26,21,.65)", color: "#fff", borderRadius: 6, padding: "3px 7px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center" }}><ZoomIn size={13} strokeWidth={2} /></button>}
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
    const vs = (db.vendors || []).slice().sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || (a.sort || 0) - (b.sort || 0)).filter(v => (v.name || "").trim());
    if (!vs.length) return <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10 }}>還沒有廠商——先到「廠商建檔」頁建一家，回來就能加品項或截圖匯入。</div>;
    return vs.map(v => {
      const its = itemsOfV(v.id).filter(vi => !qq || `${vi.name || ""} ${vi.spec || ""}`.toLowerCase().includes(qq));
      if (qq && !its.length) return null; // 搜尋中才隱藏沒命中的；平常空廠商也要顯示（才有地方按＋品項）
      const opened = colV[v.id] !== false;
      return (
        <div key={v.id} style={{ background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
          <div onClick={() => setColV(s => ({ ...s, [v.id]: !opened }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#ece4d6", cursor: "pointer" }}>
            <span style={{ fontSize: 10, color: C.faint }}>{opened ? "▾" : "▸"}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{v.official ? "✓ " : ""}{v.name}</span>
            <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{its.length} 項</span>
            <div style={{ flex: 1 }} />
            {canEdit && <button onClick={e => { e.stopPropagation(); const ni = { id: rid("vi"), vendor_id: v.id, grp: "", name: "", spec: "", unit: "箱", price: "", safeStock: "", sort: itemsOfV(v.id).length, tags: "" }; save({ vendorItems: [...(db.vendorItems || []), ni] }); setColV(s => ({ ...s, [v.id]: true })); setDisp("list"); }} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.accent, borderRadius: 6, padding: "2px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>＋ 品項</button>}
          </div>
          {opened && disp === "grid" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 10 }}>
              {its.map(vi => { const g = all.find(x => x.id === vi.ingredient_id); return (
                <div key={vi.id} draggable={canEdit} onDragStart={() => setDragI(vi.id)} onDragOver={e => dragI && e.preventDefault()} onDrop={() => dropItemOn(vi.id, v.id)}
                  onClick={() => g && setOpen(g.id)}
                  style={{ width: 150, border: `1.5px solid ${C.hard}`, borderRadius: 10, overflow: "hidden", background: "#fff", cursor: g ? "pointer" : "default" }}>
                  {/* 品項自己的圖優先，沒有才用卡片代表圖 */}
                  <div style={{ height: 80, background: (vi.img || (g && g.img)) ? `url(${vi.img || g.img}) center/cover` : "#f4efe5", display: "flex", alignItems: "center", justifyContent: "center" }}>{!(vi.img || (g && g.img)) && <span style={{ fontSize: 20, opacity: 0.3 }}>📦</span>}</div>
                  <div style={{ padding: "5px 8px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vi.name}</div>
                    <div style={{ fontSize: 9.5, color: C.faint }}>{vi.spec || "—"}</div>
                    {showMoney && <div style={{ fontSize: 10.5, fontFamily: MONOF, fontWeight: 700, color: C.sub }}>{(lastPaid(vi) || {}).price ? `$${d2(lastPaid(vi).price)}/${vi.unit || "件"}` : "—"}</div>}
                  </div>
                </div>
              ); })}
            </div>
          )}
          {opened && disp === "list" && (() => {
            const updVi = (id, fp) => save({ vendorItems: (db.vendorItems || []).map(x => x.id === id ? { ...x, ...fp } : x) });
            const VGRID = `16px minmax(120px,1.3fr) minmax(85px,0.9fr) 158px ${showMoney ? "84px " : ""}minmax(80px,0.9fr) 22px`;
            return <>
            <div style={{ display: "grid", gridTemplateColumns: VGRID, gap: 8, padding: "3px 12px", fontSize: 9.5, color: C.faint, fontWeight: 700 }}>
              <span /><span>品名（可直接改）</span><span>規格</span><span>每件入數</span>{showMoney && <span style={{ textAlign: "right" }}>單價</span>}<span>物料卡</span><span />
            </div>
            {its.map(vi => { const g = all.find(x => x.id === vi.ingredient_id); return (
              <div key={vi.id} onDragOver={e => dragI && e.preventDefault()} onDrop={() => dropItemOn(vi.id, v.id)}
                style={{ display: "grid", gridTemplateColumns: VGRID, gap: 8, alignItems: "center", minHeight: 32, padding: "2px 12px", borderTop: `1px solid #f0ead9`, fontSize: 12, background: "#fff", outline: dragI === vi.id ? `2px dashed ${C.accent}` : "none" }}>
                {canEdit ? <span draggable onDragStart={() => setDragI(vi.id)} onDragEnd={() => setDragI(null)} title="拖曳排序" style={{ cursor: "grab", color: "#c8bca6", fontSize: 12, textAlign: "center" }}>⠿</span> : <span />}
                <input value={vi.name || ""} onChange={e => updVi(vi.id, { name: e.target.value })} disabled={!canEdit} placeholder="品名" style={{ ...inp, padding: "3px 7px", fontSize: 12, fontWeight: 600 }} />
                <input value={vi.spec || ""} onChange={e => updVi(vi.id, { spec: e.target.value })} disabled={!canEdit} placeholder="規格" style={{ ...inp, padding: "3px 7px", fontSize: 11 }} />
                <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>
                  1<input value={vi.unit || ""} onChange={e => updVi(vi.id, { unit: e.target.value })} disabled={!canEdit} placeholder="箱" style={{ ...inp, width: 36, padding: "2px 4px", fontSize: 11, textAlign: "center" }} />=
                  <input value={vi.packToBase ?? ""} onChange={e => updVi(vi.id, { packToBase: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="？" style={{ ...inp, width: 58, padding: "2px 6px", fontFamily: MONOF, borderColor: packToBase(vi) ? C.line : C.red }} />
                  {g ? g.baseUnit : ""}
                </span>
                {showMoney && <input value={vi.price ?? ""} onChange={e => updVi(vi.id, { price: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="單價" style={{ ...inp, padding: "3px 6px", fontSize: 11.5, fontFamily: MONOF, textAlign: "right" }} />}
                {g ? <span onClick={() => setOpen(g.id)} style={{ fontSize: 10.5, fontWeight: 700, color: C.blue, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span> : <span style={{ fontSize: 10.5, color: C.amber, fontWeight: 700 }}>⚠ 按⚡整理</span>}
                {canEdit ? <button onClick={async () => {
                  // 刪到「最後一家貨源」時物料卡一起刪（跟物料視角的刪除一致：刪了就是整個不見，不留孤兒卡）
                  const lastSrc = g && srcsOf(db, g.id).length === 1;
                  if (lastSrc) {
                    if (!(await confirm(`刪除品項「${vi.name || "未命名"}」？這是物料卡「${g.name}」唯一的貨源，卡片會一起刪除（叫貨表也會消失；食譜若有用到會顯示缺料）。`, { confirmLabel: "刪除" }))) return;
                    save({ vendorItems: (db.vendorItems || []).filter(x => x.id !== vi.id), ingredients: (db.ingredients || []).filter(x => x.id !== g.id) });
                  } else {
                    if (!(await confirm(`刪除品項「${vi.name || "未命名"}」？叫貨表裡也會消失。`, { confirmLabel: "刪除" }))) return;
                    save({ vendorItems: (db.vendorItems || []).filter(x => x.id !== vi.id) });
                  }
                }} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer", fontSize: 13 }}>×</button> : <span />}
              </div>
            ); })}
            </>;
          })()}
        </div>
      );
    });
  };

  const openG = open && all.find(g => g.id === open);

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto" }}>
      <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) upImg(f); e.target.value = ""; }} />
      <input ref={viImgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) upViImg(f); e.target.value = ""; }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>物料</span>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text }} title="截圖貼上就能匯入品項；同名自動併卡、入數自動抓；拖曳可排序。">物料清單</div>
        {/* 視角/顯示切換 */}
        <div style={{ display: "flex", background: "#e8e0cf", borderRadius: 8, padding: 2 }}>
          <button onClick={() => setVw("mat")} style={{ ...seg(vw === "mat"), display: "inline-flex", alignItems: "center", gap: 5 }}><Leaf size={13} strokeWidth={1.75} />物料</button>
          <button onClick={() => setVw("ven")} style={{ ...seg(vw === "ven"), display: "inline-flex", alignItems: "center", gap: 5 }}><Factory size={13} strokeWidth={1.75} />廠商</button>
        </div>
        <div style={{ display: "flex", background: "#e8e0cf", borderRadius: 8, padding: 2 }}>
          <button onClick={() => setDisp("list")} style={{ ...seg(disp === "list"), display: "inline-flex", alignItems: "center", gap: 5 }}><List size={13} strokeWidth={1.75} />清單</button>
          <button onClick={() => setDisp("grid")} style={{ ...seg(disp === "grid"), display: "inline-flex", alignItems: "center", gap: 5 }}><ImageIcon size={13} strokeWidth={1.75} />圖片</button>
        </div>
        <div style={{ flex: 1 }} />
        {vw === "mat" && <button onClick={() => { const allC = cats.every(c2 => colCat[c2]); setColCat(s => { const n = { ...s }; cats.forEach(c2 => { n[c2] = !allC; }); return n; }); }} style={{ ...sbtn, padding: "6px 12px", fontSize: 12 }}>{cats.length && cats.every(c2 => colCat[c2]) ? "▾ 全部展開" : "▸ 全部收合"}</button>}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋" style={{ ...inp, width: 120 }} />
        {canEdit && <button onClick={() => setImp({ vid: "", newVendor: "", vendorGuess: "", rows: [], busy: "" })} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1.5px solid ${C.accent}`, background: "#fff", color: C.accent, borderRadius: 7, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}><Camera size={14} strokeWidth={1.75} />貼截圖匯入</button>}
        {canEdit && <button onClick={() => { const g = { id: rid("g"), name: "", cat: "", baseUnit: "g", countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: all.length, tags: "" }; save({ ingredients: [...(db.ingredients || []), g] }); setVw("mat"); setDisp("list"); setOpen(g.id); }} style={sbtn}>＋ 手動新增</button>}
        {canEdit && <button onClick={autoOrganize} disabled={!pending.length} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: pending.length ? C.accent : "#d5cbb6", color: "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: pending.length ? "pointer" : "default" }}><Zap size={14} strokeWidth={1.75} />自動整理{pending.length ? `（${pending.length}）` : ""}</button>}
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
          <span style={{ width: 8 }} />
          <button onClick={() => setSel2(s => { const n = { ...s }; shown.forEach(g => { n[g.id] = true; }); return n; })} style={{ border: "1px solid #5a5247", background: "transparent", color: "#fff", borderRadius: 7, padding: "3px 11px", fontSize: 11.5, cursor: "pointer" }}>全選</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setSel2({})} style={{ border: "none", background: "none", color: "#d9cfbd", fontSize: 11.5, cursor: "pointer" }}>取消選取</button>
        </div>
      )}

      {vw === "mat" && shown.length === 0 && pending.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, marginBottom: 12 }}>{qq ? "沒有符合的物料。" : "還沒有物料卡——用「📸 貼截圖匯入」或到「廠商」頁建品項後按「⚡ 自動整理」。"}</div>}
      {vw === "mat" && shown.length === 0 && pending.length > 0 && !qq && <div style={{ padding: 30, textAlign: "center", color: C.sub, background: "#fbeee6", border: `1.5px solid ${C.accent}`, borderRadius: 10, marginBottom: 12, fontSize: 13 }}>有 <b>{pending.length}</b> 筆廠商品項等著變物料卡——按右上角「<b>⚡ 自動整理</b>」，名稱、分類、每件入數都會自動填好。</div>}

      {/* 物料視角 */}
      {vw === "mat" && cats.map(cat => {
        const rows = shown.filter(g => ((g.cat || "").trim() || "未分類") === cat).sort((a, b) => (b.isKey ? 1 : 0) - (a.isKey ? 1 : 0)); // ★ 置頂（重點比價）
        const allSel = rows.every(g => sel2[g.id]);
        const catClosed = !!colCat[cat];
        return (
          <div key={cat} style={{ background: "#fff", border: `1.5px solid ${C.hard}`, borderRadius: 4, marginBottom: 12, overflow: "hidden", outline: dragCat2 === cat ? `2px dashed ${C.accent}` : "none" }}>
            <div onClick={() => setColCat(s => ({ ...s, [cat]: !catClosed }))}
              draggable={canEdit} onDragStart={() => setDragCat2(cat)} onDragEnd={() => setDragCat2(null)} onDragOver={e => dragCat2 && e.preventDefault()} onDrop={() => dropCatOn(cat)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#ece4d6", cursor: "pointer" }}>
              {canEdit && <span title="拖曳調整分類順序" style={{ cursor: "grab", color: "#c8bca6", fontSize: 13 }}>⠿</span>}
              {disp === "list" && <input type="checkbox" checked={allSel} onClick={e => e.stopPropagation()} onChange={e => setSel2(s => { const n = { ...s }; rows.forEach(g => { n[g.id] = e.target.checked; }); return n; })} disabled={!canEdit} title="全選這個分類" style={{ cursor: "pointer" }} />}
              <span style={{ fontSize: 10, color: C.faint }}>{catClosed ? "▸" : "▾"}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{cat}</span>
              <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{rows.length} 項</span>
            </div>
            {!catClosed && disp === "list" && <>
              <div style={{ display: "grid", gridTemplateColumns: IGRID, alignItems: "stretch", background: "#f2ecdd" }}>
                <div style={{ ...vline, padding: "0 6px" }} />
                <div style={{ ...vline, padding: "4px 4px", fontSize: 10.5, color: C.sub, fontWeight: 700, justifyContent: "center" }}>圖</div>
                <div style={{ ...vline, padding: "4px 9px", fontSize: 10.5, color: C.sub, fontWeight: 700 }}>名稱（拖曳可排序）</div>
                <div style={{ ...vline, padding: "4px 9px", fontSize: 10.5, color: C.sub, fontWeight: 700 }}>每件入數</div>
                <div style={{ ...vline, padding: "4px 9px", fontSize: 10.5, color: C.sub, fontWeight: 700 }}>哪些廠商賣</div>
                {showMoney && <div style={{ ...vline, padding: "4px 9px", fontSize: 10.5, color: C.sub, fontWeight: 700, justifyContent: "flex-end" }}>最低價</div>}
                <div style={{ ...vline, padding: "4px 7px", fontSize: 10.5, color: C.sub, fontWeight: 700 }}>盤點</div>
                <div />
              </div>
              {rows.map(listRow)}
            </>}
            {!catClosed && disp === "grid" && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 10 }}>{rows.map(gridCard)}</div>}
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

      {/* 圖片放大檢視（lightbox）：點任何縮圖進來，點一下關閉 */}
      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 760, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={zoom} alt="" style={{ maxWidth: "92vw", maxHeight: "90vh", borderRadius: 10, boxShadow: "0 8px 40px rgba(0,0,0,.5)" }} />
        </div>
      )}
      {/* 📸 截圖匯入 modal */}
      {imp && (
        <div onClick={e => e.target === e.currentTarget && !imp.busy && setImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 730, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, width: "min(840px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
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
            {/* 預覽表：AI 結果可勾可改，人工確認才寫入；同名紅框警示（同名匯入會併成同一筆） */}
            {imp.rows.length > 0 && (() => {
              const cnt = {}; imp.rows.filter(r => r.on).forEach(r => { const k = normName(r.name); if (k) cnt[k] = (cnt[k] || 0) + 1; });
              const isDup = (r) => (cnt[normName(r.name)] || 0) > 1;
              const dupN = Object.keys(cnt).filter(k => cnt[k] > 1).length;
              return <>
              <div style={{ display: "grid", gridTemplateColumns: "26px 36px minmax(140px,1.5fr) minmax(80px,0.8fr) 54px 74px 76px minmax(70px,0.7fr)", gap: 6, padding: "4px 6px", fontSize: 10, color: C.faint, fontWeight: 700, background: "#f4efe5", borderRadius: 6 }}>
                <span /><span>圖</span><span>品名</span><span>規格</span><span>單位</span><span style={{ textAlign: "right" }}>單價</span><span style={{ textAlign: "right" }} title="最低訂購量（報價的「數量」通常是這個）">最低訂購</span><span>備註</span>
              </div>
              {imp.rows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "26px 36px minmax(140px,1.5fr) minmax(80px,0.8fr) 54px 74px 76px minmax(70px,0.7fr)", gap: 6, alignItems: "center", padding: "3px 6px", borderBottom: `1px solid #f0ead9`, opacity: r.on ? 1 : 0.45 }}>
                  <input type="checkbox" checked={r.on} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, on: e.target.checked } : x) }))} />
                  <span title={r.thumbUrl ? "會一起掛到物料卡" : "這筆沒抓到商品照片（不影響匯入，之後可手動補圖）"} style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${C.line}`, background: r.thumbUrl ? `url(${r.thumbUrl}) center/cover` : "#f4efe5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.faint }}>{r.thumbUrl ? "" : "—"}</span>
                  <input value={r.name} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} style={{ ...inp, padding: "3px 7px", fontSize: 12, borderColor: isDup(r) ? C.red : C.line, borderWidth: isDup(r) ? 1.5 : 1 }} />
                  <input value={r.spec} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, spec: e.target.value } : x) }))} style={{ ...inp, padding: "3px 7px", fontSize: 11.5 }} />
                  <input value={r.unit} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, unit: e.target.value } : x) }))} style={{ ...inp, padding: "3px 7px", fontSize: 11.5 }} />
                  <input value={r.price} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, price: e.target.value.replace(/[^0-9.]/g, "") } : x) }))} inputMode="decimal" style={{ ...inp, padding: "3px 7px", fontSize: 11.5, fontFamily: MONOF, textAlign: "right" }} />
                  <input value={r.moq} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, moq: e.target.value.replace(/[^0-9]/g, "") } : x) }))} inputMode="numeric" placeholder="—" style={{ ...inp, padding: "3px 7px", fontSize: 11.5, fontFamily: MONOF, textAlign: "right" }} />
                  <input value={r.note} onChange={e => setImp(m => ({ ...m, rows: m.rows.map((x, j) => j === i ? { ...x, note: e.target.value } : x) }))} placeholder="版費…" style={{ ...inp, padding: "3px 7px", fontSize: 11 }} />
                </div>
              ))}
              {dupN > 0 && <div style={{ marginTop: 8, fontSize: 12, color: C.red, fontWeight: 600 }}>⚠ 紅框的品名重複——如果其實是不同商品（例如刀/叉/匙三種），請把名字改到不一樣；名字一樣的匯入後會被當成同一筆。</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 11.5, color: C.faint }}>已勾 {imp.rows.filter(r => r.on && r.name.trim()).length} 筆。匯入後自動建物料卡、同名自動併卡、入數自動從規格抓。</span>
                <div style={{ flex: 1 }} />
                <button onClick={doImport} disabled={!imp.rows.some(r => r.on && r.name.trim()) || !!imp.busy} style={{ border: "none", background: imp.rows.some(r => r.on && r.name.trim()) && !imp.busy ? C.green : "#d5cbb6", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ 確認匯入</button>
              </div>
            </>;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
