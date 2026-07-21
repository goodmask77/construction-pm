// 進銷存共用算法（純函式，無狀態）— 藍圖鐵律：一律掛物料 ID、共用這裡的算法（同 lib/cost.js 精神）
// 物料 ingredient（物）↔ 貨源 vendorItem（廠商商品）多對一；成本一律用「最近實付價」（vendorItems.last 快取），絕不用報價

// 換算量：1 採購單位 = 多少基本單位（如 1箱=20000g → 20000）；沒填回 null，成本層顯示「未設換算」絕不當 0
export const packToBase = (vi) => { const n = Number(vi && vi.packToBase); return n > 0 ? n : null; };

// 最近價（優先實付快取 last，沒有才退回主檔單價 price 並標來源）
export const lastPaid = (vi) => {
  if (vi && vi.last && Number(vi.last.price) > 0) return { price: Number(vi.last.price), ts: vi.last.ts || "", src: "實付" };
  if (vi && Number(vi.price) > 0) return { price: Number(vi.price), ts: "", src: "主檔" };
  return null;
};

// 單位成本（$/基本單位）：實付價 ÷ 換算量；缺任一 → null
export const unitCost = (vi) => { const p = lastPaid(vi), k = packToBase(vi); return p && k ? p.price / k : null; };

// 報價換算（$/基本單位）：比價用，不進成本
export const quoteUnit = (vi) => { const q = vi && vi.quote && Number(vi.quote.price) > 0 ? Number(vi.quote.price) : null; const k = packToBase(vi); return q && k ? q / k : null; };

// 某物料掛的全部貨源
export const srcsOf = (db, ingId) => (db.vendorItems || []).filter(x => x.ingredient_id === ingId);

// 物料的「最近實付單位成本」：取最近有實付紀錄的貨源（沒實付紀錄的排最後）
export const latestCostOfIngredient = (db, ingId) => {
  const cands = srcsOf(db, ingId)
    .map(vi => ({ vi, u: unitCost(vi), ts: (vi.last && vi.last.ts) || "" }))
    .filter(c => c.u != null)
    .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  return cands.length ? { unitCost: cands[0].u, vi: cands[0].vi, ts: cands[0].ts } : null;
};

// 食譜版本流水（append-only）→ 各產品現值＝ts 最新一筆
export const latestRecipeOf = (recipes, productId) => {
  let best = null;
  (recipes || []).forEach(r => { if (r.product_id === productId && (!best || (r.ts || "") > (best.ts || ""))) best = r; });
  return best;
};

// 食譜成本：用料×最近實付單位成本 ＋ 半成品遞迴（visited 防循環）＋ 包材（productPackaging→matId→貨源）
// 回 { total: 一份成本, missing: [缺料明細，照實回報不靜默] }；用量單位鎖＝物料 baseUnit（不做跨單位換算）
export const recipeCost = (db, recipes, productId, visited) => {
  const seen = visited || new Set();
  if (seen.has(productId)) return { total: 0, missing: ["食譜循環引用，已跳過"] };
  seen.add(productId);
  const r = latestRecipeOf(recipes, productId);
  if (!r) return { total: 0, missing: ["尚無食譜"] };
  let batch = 0; const missing = [];
  (r.ingredients || []).forEach(li => {
    const ing = (db.ingredients || []).find(g => g.id === li.ingredient_id);
    const qty = Number(li.qty) || 0;
    if (!ing) { missing.push("有一筆用料的物料已被刪除"); return; }
    const c = latestCostOfIngredient(db, li.ingredient_id);
    if (!c) { missing.push(`${ing.name}：缺價或貨源未設換算`); return; }
    batch += c.unitCost * qty;
  });
  (r.subRecipes || []).forEach(sr => {
    const sub = recipeCost(db, recipes, sr.product_id, seen);
    batch += sub.total * (Number(sr.qty) || 0);
    sub.missing.forEach(m => missing.push(`（半成品）${m}`));
  });
  const yld = Number(r.yield) > 0 ? Number(r.yield) : 1;
  let total = batch / yld;
  // 包材：每份各用 1 個（productPackaging 對應），成本＝貨源單顆價
  (db.productPackaging || []).filter(x => x.product_id === productId).forEach(pp => {
    const mat = (db.materials || []).find(m => m.id === pp.packaging_id);
    const vi = (db.vendorItems || []).find(v => v.matId === pp.packaging_id);
    const u = vi ? unitCost(vi) : null;
    if (u == null) { missing.push(`包材 ${mat ? mat.name : pp.packaging_id}：缺價或未設換算`); return; }
    total += u;
  });
  return { total, missing };
};

// 進價事件（實付）：驗收完成時逐品項產生；決定性 id＝orderId_index → 重按「完成驗收」冪等不重複記
export const buildPriceEvents = (order, db, ts) => {
  const chk = (order.check && order.check.items) || {};
  return (order.items || []).map((x, i) => {
    const price = Number(x.price) || 0;
    if (!(price > 0)) return null;
    const vi = (db.vendorItems || []).find(v => v.id === x.id);
    return {
      id: order.id + "_" + i, ts: ts || new Date().toISOString(),
      ingredient_id: (vi && vi.ingredient_id) || "", vendor_item_id: x.id,
      vendor_id: order.vendor_id, price, unit: x.unit || "", qty: Number(x.qty) || 0,
      order_id: order.id, inspectSt: (chk[i] && chk[i].st) || "",
    };
  }).filter(Boolean);
};

// 進價事件寫入後更新 last 快取（同價只刷時間不動 prevPrice → 重按驗收不會誤觸漲價警示）
export const applyLastPaid = (vendorItems, events, ts) => {
  const byVi = {};
  (events || []).forEach(e => { byVi[e.vendor_item_id] = e; });
  return (vendorItems || []).map(vi => {
    const ev = byVi[vi.id]; if (!ev) return vi;
    const cur = vi.last || {};
    if (Number(cur.price) === ev.price) return { ...vi, last: { ...cur, ts } };
    return { ...vi, last: { price: ev.price, ts, prevPrice: Number(cur.price) || 0, prevTs: cur.ts || "" } };
  });
};

// 漲跌價警示：last.price vs last.prevPrice 變動 ≥ pct%（預設 15，settings.priceAlertPct 可調）
export const priceAlert = (vi, pct) => {
  const l = vi && vi.last; const th = Number(pct) > 0 ? Number(pct) : 15;
  if (!l || !(Number(l.prevPrice) > 0) || !(Number(l.price) > 0)) return null;
  const ch = (Number(l.price) - Number(l.prevPrice)) / Number(l.prevPrice) * 100;
  return Math.abs(ch) >= th ? { pct: Math.round(ch), up: ch > 0 } : null;
};

// 報價快取更新（報價事件寫入後）：同價只刷時間
export const applyQuote = (vendorItems, viId, price, ts) => (vendorItems || []).map(vi => {
  if (vi.id !== viId) return vi;
  const cur = vi.quote || {};
  if (Number(cur.price) === Number(price)) return { ...vi, quote: { ...cur, ts } };
  return { ...vi, quote: { price: Number(price), ts, prevPrice: Number(cur.price) || 0, prevTs: cur.ts || "" } };
});

// ── 物料頁自動整理用（v1.11 重新設計：預設全自動，人只處理例外）──

// 規格自動解析：「(2000入/件)」→ 每件入數 2000、單位「個」；「20公斤/箱」→ 20000g——系統有資料就不叫人重打
// v1.32 修多層包裝：「100張/包 60包/箱」要鏈乘=6000（舊版只抓第一段誤=100）
const _toBase = (n, unit) => {
  const u = String(unit).toLowerCase();
  if (u === "公斤" || u === "kg") return { packToBase: Math.round(n * 1000), baseUnit: "g" };
  if (u === "台斤" || u === "斤") return { packToBase: Math.round(n * 600), baseUnit: "g" };
  if (u === "公克" || u === "克" || u === "g") return { packToBase: Math.round(n), baseUnit: "g" };
  if (u === "公升" || u === "升" || u === "l") return { packToBase: Math.round(n * 1000), baseUnit: "ml" };
  if (u === "毫升" || u === "ml" || u === "cc") return { packToBase: Math.round(n), baseUnit: "ml" };
  return { packToBase: Math.round(n), baseUnit: "個" };
};
// 單層解析（原邏輯；repairPackToBase 比對「舊版誤值」也用它）
const _parseFlat = (s) => {
  let m;
  if ((m = s.match(/([\d.]+)\s*(?:公斤|kg)/i))) return { packToBase: Math.round(parseFloat(m[1]) * 1000), baseUnit: "g" };
  if ((m = s.match(/([\d.]+)\s*(?:台斤|斤)/))) return { packToBase: Math.round(parseFloat(m[1]) * 600), baseUnit: "g" };
  if ((m = s.match(/([\d.]+)\s*(?:公克|克)/)) || (m = s.match(/([\d.]+)\s*g\b/i))) return { packToBase: Math.round(parseFloat(m[1])), baseUnit: "g" };
  if ((m = s.match(/([\d.]+)\s*(?:公升|升)/)) || (m = s.match(/([\d.]+)\s*L\b/))) return { packToBase: Math.round(parseFloat(m[1]) * 1000), baseUnit: "ml" };
  if ((m = s.match(/([\d.]+)\s*(?:毫升|ml|cc)\b/i))) return { packToBase: Math.round(parseFloat(m[1])), baseUnit: "ml" };
  if ((m = s.match(/(\d+)\s*(?:入|個|个|顆|粒|支|張|片|捲|卷|份|組|雙|條|条|袋|包)/))) return { packToBase: parseInt(m[1], 10), baseUnit: "個" };
  return { packToBase: null, baseUnit: "個" };
};
export const parseSpec = (spec) => {
  const s = String(spec || "");
  // 抓所有「數字＋單位／容器」段（100張/包、60包/箱），兩段以上→從最外層容器往內鏈乘
  const re = /([\d.]+)\s*(公斤|kg|台斤|斤|公克|克|g|公升|升|L|毫升|ml|cc|入|個|个|顆|粒|支|張|片|捲|卷|份|組|雙|條|条|袋|包|盒|瓶|罐|桶)\s*[/／]\s*(箱|件|袋|包|盒|組|桶|捲|卷|罐|瓶)/gi;
  const segs = []; let m;
  while ((m = re.exec(s))) segs.push({ qty: parseFloat(m[1]), unit: m[2], per: m[3] });
  if (segs.length >= 2) {
    const units = new Set(segs.map(x => x.unit));
    let cur = segs.find(x => !units.has(x.per)) || segs[segs.length - 1]; // 最外層＝容器沒被別段當計量單位
    let total = cur.qty; const used = new Set([cur]);
    for (let i = 0; i < segs.length; i++) {
      const nx = segs.find(x => !used.has(x) && x.per === cur.unit);
      if (!nx) break;
      total *= nx.qty; used.add(nx); cur = nx;
    }
    if (total > 0) return _toBase(total, cur.unit);
  }
  return _parseFlat(s);
};

// 一次性資料修復（物料頁載入自動跑、冪等）：
// ①多層規格被舊版算錯的入數——只改「現值＝舊版誤值」的（人工改過的不碰）
// ②沒規格但採購單位＝單顆（個/支/張…）且計量單位＝個 → 入數自動補 1（報價單位就是最小單位）
export const repairPackToBase = (vendorItems, ingredients) => {
  let fixed = 0;
  const byId = new Map((ingredients || []).map(g => [g.id, g]));
  const out = (vendorItems || []).map(vi => {
    const neu = parseSpec(vi.spec);
    if (neu.packToBase) {
      const old = _parseFlat(String(vi.spec || ""));
      if (old.packToBase && neu.packToBase !== old.packToBase && Number(vi.packToBase) === old.packToBase) { fixed++; return { ...vi, packToBase: neu.packToBase }; }
      return vi;
    }
    const g = byId.get(vi.ingredient_id);
    if (!Number(vi.packToBase) && isPieceUnit(vi.unit) && g && (g.baseUnit || "個") === "個") { fixed++; return { ...vi, packToBase: 1 }; }
    return vi;
  });
  return { vendorItems: out, fixed };
};

// 單顆計價單位：採購單位本身＝最小單位（報價單「5,000個×$4.9/個」）→ 1個=1個，入數必=1 不用問人
export const isPieceUnit = (u) => /^(個|个|顆|粒|支|張|片|份|雙|只|枝)$/.test(String(u || "").trim());

// 服務/費用類判斷（保養、運費…）→ 標非物料，不進盤點/成本
export const isServiceName = (name) => /保養|維修|修理|運費|服務|安裝|清潔費|檢測|租金|費用|工資|施工/.test(String(name || ""));

// 品名正規化（自動併卡/建議合併用）：去空白符號、統一小寫
export const normName = (s) => String(s || "").toLowerCase().replace(/[\s\-–—（）()【】\[\]／/、,，.。・*×xX＊]/g, "");

const _rid = (p) => p + Math.random().toString(36).slice(2, 8);

// 自動整理（物料頁⚡按鈕與截圖匯入共用）：未掛卡的廠商品項 → 同名併入既有卡、否則自動建卡
// 回 { ingredients, vendorItems, stats }——純函式不寫庫，呼叫端自己 save
export const organizeAll = (db) => {
  const list = [...(db.ingredients || [])];
  const byNorm = new Map();
  list.forEach(g => { const k = normName(g.name); if (k && !byNorm.has(k)) byNorm.set(k, g); });
  let created = 0, merged = 0, svcN = 0, needFix = 0;
  const vendorItems = (db.vendorItems || []).map(vi => {
    if (vi.ingredient_id || !(vi.name || "").trim()) return vi;
    const k = normName(vi.name);
    let g = byNorm.get(k);
    if (g) merged++;
    else {
      const p = parseSpec(vi.spec);
      const svc = isServiceName(vi.name);
      const vend = (db.vendors || []).find(v => v.id === vi.vendor_id) || {};
      g = { id: _rid("g"), name: vi.name.trim(), cat: (vi.grp || "").trim() || (vend.vcat || "").trim() || "", baseUnit: p.baseUnit, countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: list.length, tags: "", nonStock: svc };
      list.push(g); byNorm.set(k, g); created++; if (svc) svcN++;
    }
    const nv = { ...vi, ingredient_id: g.id };
    if (!Number(nv.packToBase)) { const p2 = parseSpec(vi.spec); if (p2.packToBase) nv.packToBase = p2.packToBase; else if (isPieceUnit(nv.unit) && (g.baseUnit || "個") === "個") nv.packToBase = 1; else if (!g.nonStock) needFix++; }
    return nv;
  });
  return { ingredients: list, vendorItems, stats: { created, merged, svcN, needFix } };
};
