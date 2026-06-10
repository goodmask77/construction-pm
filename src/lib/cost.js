// ── 成本金額模型（純函式，無瀏覽器/React 依賴）──────────────────────────────────
// App 前端與未來的 LINE bot 後端共用「同一套」算法，數字才不會兩邊各算各的。
// base = 數量×單價（有單據小計 amount 就用權威數字）；依稅別算稅額與含稅預估；付款＝已付/未付（整數 NT$）。

export const fmt = (n) => "NT$" + Math.round(n || 0).toLocaleString();

// 金額基底：有「單據小計（amount）」就用單據的權威數字（避免 數量×單價 的進位尾差）；沒有就回到 數量×單價。
export const baseAmount = (it) => {
  const a = it?.amount;
  if (a != null && a !== "" && !isNaN(Number(a))) return Math.round(Number(a));
  return Math.round((Number(it.estQty ?? it.qty) || 0) * (Number(it.estUnitPrice ?? it.unitPrice) || 0));
};
export const taxOf = (it) => { const b = baseAmount(it); const t = it.taxType || "未稅"; if (t === "免稅") return 0; if (t === "含稅") return b - Math.round(b / 1.05); return Math.round(b * 0.05); };
export const estAmount = (it) => { const b = baseAmount(it); return (it.taxType || "未稅") === "未稅" ? b + Math.round(b * 0.05) : b; }; // 含稅/免稅=base；未稅=base+稅額
export const paidOf = (it) => Number(it.paid ?? it.cust?.paid) || 0;
export const unpaidOf = (it) => estAmount(it) - paidOf(it);
export const calcEstimated = (it) => estAmount(it); // 預估金額（含稅）＝真正預算數字
export const calcActual = (it) => (it.actQty || 0) * (it.actUnitPrice || 0) + (it.actWorkers || 0) * (it.actDailyWage || 0) * (it.actLaborDays || 0); // 舊「施工記錄」沿用於細項詳情

// ── 大項層級議價折扣：折扣套在「未稅」層、稅金重算（細項原報價不動）──────────────
export const pretaxOf = (it) => { const b = baseAmount(it); return (it.taxType || "未稅") === "含稅" ? Math.round(b / 1.05) : b; }; // 未稅基底
export const isTaxable = (it) => (it.taxType || "未稅") !== "免稅";
export const catRawEst = (cat) => (cat?.items || []).reduce((s, it) => s + estAmount(it), 0); // 原報價含稅
export const catPretaxSub = (cat) => (cat?.items || []).reduce((s, it) => s + pretaxOf(it), 0); // 未稅小計
export const catDiscount = (cat) => {
  // 折% 套在未稅層；固定折讓＝直接從含稅原報價扣（省＝你輸入的金額），上限為含稅原報價
  const sub = catRawEst(cat);
  const mode = cat?.discountMode === "amt" ? "amt" : "pct";
  const v = Number(cat?.discountValue) || 0;
  if (v <= 0 || sub <= 0) return { hasDiscount: false, factor: 1, pct: 0, amt: 0, mode, value: v, sub };
  let factor = 1, pct = 0, amt = 0;
  if (mode === "amt") { amt = Math.min(Math.max(v, 0), sub); factor = (sub - amt) / sub; pct = amt / sub * 100; }
  else { pct = Math.min(Math.max(v, 0), 100); factor = 1 - pct / 100; amt = sub * pct / 100; }
  return { hasDiscount: factor < 1, factor, pct, amt, mode, value: v, sub };
};
// 議價後含稅＝原報價含稅 × factor
export const catEstAfter = (cat) => {
  const { factor } = catDiscount(cat);
  if (factor === 1) return catRawEst(cat);
  return Math.round(catRawEst(cat) * factor);
};
export const catSaved = (cat) => catRawEst(cat) - catEstAfter(cat);
// 逐筆「議價後預估金額」：各細項按 factor 打折，進位殘差塞給最後一筆 → Σ 細項 = 大項議價後
export const catItemEstAfter = (cat) => {
  const map = {};
  const d = catDiscount(cat);
  const items = cat?.items || [];
  if (!d.hasDiscount) { items.forEach(it => { map[it.id] = estAmount(it); }); return map; }
  const target = catEstAfter(cat);
  let acc = 0;
  items.forEach(it => { const v = Math.round(estAmount(it) * d.factor); map[it.id] = v; acc += v; });
  const last = items[items.length - 1];
  if (last) map[last.id] += (target - acc);
  return map;
};

// ── 大項（廠商）層級付款紀錄 ──────────────────────────────────────────────────
export const PAY_CATEGORIES = ["訂金", "期中款", "尾款", "其他"];
// 已付＝大項付款紀錄加總 ＋ 注入的零用金細項(fromPetty，本身即已付)。
export const catPaid = (cat) => (cat?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)
  + (cat?.items || []).reduce((s, it) => s + (it.fromPetty ? (Number(it.paid) || 0) : 0), 0);
// 逐項已付（含「整批/不指定」付款自動分攤到各品項）
export const catItemPaidMap = (cat) => {
  const estMap = catItemEstAfter(cat);
  const items = cat?.items || [];
  const out = {}; const linked = {};
  items.forEach(it => { out[it.id] = 0; linked[it.id] = 0; });
  let pool = 0;
  (cat?.payments || []).forEach(p => { const amt = Number(p.amount) || 0; if (p.itemId && linked[p.itemId] != null) { linked[p.itemId] += amt; out[p.itemId] += amt; } else pool += amt; });
  if (pool > 0) {
    for (const it of items) {
      if (pool <= 0) break;
      const rem = Math.max(0, (estMap[it.id] ?? estAmount(it)) - (out[it.id] || 0));
      if (rem <= 0) continue;
      const give = Math.min(rem, pool);
      out[it.id] += give; pool -= give;
    }
  }
  return out;
};
export const catUnpaidAfter = (cat) => catEstAfter(cat) - catPaid(cat);

// ── 零用金併入工程成本（撥款不算成本，實際花費依工種併入）──────────────────────
export const isFundingCat = (c) => /零用金/.test(c?.name || "");
// 把零用金花費轉成「顯示用」的虛擬細項，注入對應工種大項（顯示用副本，不會存回、不重複計算）。
export const pettyItemOf = (s) => { const amt = Math.round(Number(s.amount) || 0); return { id: "petty::" + s.id, name: s.content || "零用金支出", estQty: 1, qty: 1, estUnitPrice: amt, unitPrice: amt, amount: amt, unit: "式", taxType: "免稅", paid: amt, payDate: s.date || "", assignee: "零用金", status: "done", done: true, receipts: s.receipts || [], notes: s.note || (s.voucher ? `憑證:${s.voucher}${s.invoiceNo ? " " + s.invoiceNo : ""}` : ""), fromPetty: true, _readonly: true, pettyId: s.id }; };
export const withPettyItems = (cats, petty) => {
  const spends = (petty && petty.spends) || [];
  if (!spends.length || !cats) return cats;
  const byCat = {};
  spends.forEach(s => { if (s.catId) (byCat[s.catId] = byCat[s.catId] || []).push(pettyItemOf(s)); });
  if (!Object.keys(byCat).length) return cats;
  return cats.map(c => byCat[c.id] ? { ...c, items: [...(c.items || []), ...byCat[c.id]] } : c);
};

// 工程總計：排除撥款帳(零用金大項)，回傳預估/已付/未付（給 App 與 bot 共用）
export const projectTotals = (cats) => {
  const list = (cats || []).filter(c => !isFundingCat(c));
  const est = list.reduce((s, c) => s + catEstAfter(c), 0);
  const paid = list.reduce((s, c) => s + catPaid(c), 0);
  return { est, paid, unpaid: est - paid };
};
