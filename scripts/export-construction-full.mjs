// 主 App 工程資料「完整」匯出（張良 2026-10-14）
// 從 ?catprobe=<MENU_PROBE_KEY>&full=1 抓 pm_data 原文＋零用金＋比價，
// 直接 import src/lib/cost.js（App 畫面用的同一套算法）算總覽三張卡，再輸出整理好的 JSON（給 Excel 用）。
// 用法：node scripts/export-construction-full.mjs <站台網址> <輸出資料夾>   （金鑰讀 .env.local 的 MENU_PROBE_KEY，不印出）
//   或：node scripts/export-construction-full.mjs --file <已抓的 full.json> <輸出資料夾>
import fs from "node:fs";
import path from "node:path";
import { estAmount, catRawEst, catEstAfter, catPaid, catDiscount, catItemEstAfter, catItemPaidMap, isFundingCat, withPettyItems } from "../src/lib/cost.js";

const [a1, a2, a3] = process.argv.slice(2);
let raw;
if (a1 === "--file") raw = JSON.parse(fs.readFileSync(a2, "utf8"));
else {
  const envTxt = [".env.local", "../../../.env.local"].map(p => { try { return fs.readFileSync(p, "utf8"); } catch (_) { return ""; } }).join("\n");
  const key = (process.env.MENU_PROBE_KEY || (envTxt.match(/^MENU_PROBE_KEY=(.*)$/m) || [])[1] || "").replace(/["'\r]/g, "").trim();
  if (!key) throw new Error("找不到 MENU_PROBE_KEY");
  const r = await fetch(`${a1.replace(/\/$/, "")}/api/mail-sync?catprobe=${encodeURIComponent(key)}&full=1`);
  raw = await r.json();
}
const outDir = a1 === "--file" ? a3 : a2;
if (!raw?.ok || !raw.full) throw new Error("探針沒有回完整資料（full=1）");

// App 載入時做的兩個一次性整理（App.jsx migratePayments / reconcileStatuses），同樣套用才會跟畫面一致
const migratePayments = (cats) => cats.map(c => {
  let n = c;
  if (!Array.isArray(c.payments)) { const s = (c.items || []).reduce((t, it) => t + (Number(it.paid ?? it.cust?.paid) || 0), 0); n = { ...n, payments: s > 0 ? [{ id: "pay-legacy-" + c.id, date: "", amount: s, category: "其他", note: "既有付款（系統轉入）", receipts: [] }] : [] }; }
  if (n.budget) n = { ...n, budget: 0 };
  return n;
});
const reconcile = (cats) => cats.map(c => {
  const items = c.items || []; if (!items.length) return c;
  if (c.status === "done") return { ...c, items: items.map(it => (it.done || it.status === "done") ? it : { ...it, status: "done", done: true }) };
  if (items.every(it => it.done || it.status === "done")) return { ...c, status: "done" };
  return c;
});
const petty = raw.petty ? { advances: raw.petty.advances || [], spends: raw.petty.spends || [] } : { advances: [], spends: [] };
const cats = withPettyItems(reconcile(migratePayments(raw.cats)), petty); // = App 的 displayCats

// 總覽三張卡（Overview.jsx 同算法：排除零用金撥款大項；nonProject → 非工程）
let pe = 0, pp = 0, ne = 0, np = 0;
cats.forEach(c => { if (isFundingCat(c)) return; const e = catEstAfter(c), pd = catPaid(c); if (c.nonProject) { ne += e; np += pd; } else { pe += e; pp += pd; } });
const cards = {
  工程費用合計: { 合計: pe, 已付: pp, 未付: pe - pp },
  非工程: { 合計: ne, 已付: np, 未付: ne - np },
  全部合計: { 合計: pe + ne, 已付: pp + np, 未付: pe + ne - pp - np },
};

const ST = { done: "已完成", doing: "進行中", in_progress: "進行中", pending: "未開始", todo: "未開始", blocked: "卡關" };
const st = (s) => ST[s] || s || "";
const sorted = [...cats].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const catRows = sorted.map(c => {
  const d = catDiscount(c), est = catEstAfter(c), paid = catPaid(c);
  return { 大項: c.name, 是否工程: isFundingCat(c) ? "零用金撥款(不計)" : (c.nonProject ? "非工程" : "工程"), 費用群組: c.group || "", 原報價含稅: catRawEst(c), 議價方式: d.hasDiscount ? (d.mode === "amt" ? "固定折讓" : "折%") : "", 議價值: d.hasDiscount ? d.value : "", 議價省下: catRawEst(c) - est, 議價後含稅: est, 已付: paid, 未付: est - paid, 狀態: st(c.status), 細項數: (c.items || []).length };
});
const itemRows = [];
sorted.forEach(c => {
  const after = catItemEstAfter(c), paidMap = catItemPaidMap(c);
  (c.items || []).forEach(it => itemRows.push({
    大項: c.name, 是否工程: isFundingCat(c) ? "零用金撥款(不計)" : (c.nonProject ? "非工程" : "工程"), 細項: it.name || "", "廠商/負責人": it.assignee || "", 規格: it.spec || it.cust?.spec || "",
    數量: Number(it.estQty ?? it.qty) || 0, 單位: it.unit || "", 單價: Number(it.estUnitPrice ?? it.unitPrice) || 0, 稅別: it.taxType || "未稅",
    含稅金額原報價: estAmount(it), 議價後含稅: after[it.id] ?? estAmount(it), "已付(分攤)": it.fromPetty ? (Number(it.paid) || 0) : (paidMap[it.id] || 0), 付款日: it.payDate || "",
    狀態: st(it.status) || (it.done ? "已完成" : ""), 來源: it.fromPetty ? "零用金" : "", 付款帳戶: it.payAccount || "", 備註: it.notes || "",
  }));
});
const payRows = [];
sorted.forEach(c => (c.payments || []).forEach(p => payRows.push({ 大項: c.name, 是否工程: c.nonProject ? "非工程" : "工程", 期別: p.category || "", 金額: Number(p.amount) || 0, 日期: p.date || "", 指定細項: p.itemId ? ((c.items || []).find(i => i.id === p.itemId)?.name || p.itemId) : "", 備註: p.note || "", 憑證數: (p.receipts || []).length })));
const catName = Object.fromEntries(raw.cats.map(c => [c.id, c.name]));
const pettyRows = [
  ...petty.advances.map(a => ({ 類型: "撥款", 日期: a.date || "", 內容: a.content || a.note || "", 金額: Number(a.amount) || 0, 併入大項: "", 憑證: "", 發票號: "", 備註: a.note || "" })),
  ...petty.spends.map(s => ({ 類型: "花費", 日期: s.date || "", 內容: s.content || "", 金額: Number(s.amount) || 0, 併入大項: catName[s.catId] || "", 憑證: s.voucher || "", 發票號: s.invoiceNo || "", 備註: s.note || "" })),
];
const estRows = [];
(Array.isArray(raw.estimates) ? raw.estimates : []).forEach(e => (e.items || []).forEach(it => estRows.push({ 廠商: e.vendor || "", 估價單: e.file || e.fileName || "", 估價單總價: Number(e.total) || 0, 品項: it.name || "", 數量: it.qty ?? "", 單位: it.unit || "", 單價: Number(it.unitPrice) || 0, 小計: it.amount ?? ((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)), 備註: it.note || it.notes || "" })));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "computed.json"), JSON.stringify({ cards, catRows, itemRows, payRows, pettyRows, estRows, estimatesAn: raw.estimatesAn || null }, null, 1));
fs.writeFileSync(path.join(outDir, "raw.json"), JSON.stringify(raw, null, 1));
console.log(JSON.stringify(cards));
console.log(`大項 ${catRows.length}、細項 ${itemRows.length}、付款 ${payRows.length}、零用金 ${pettyRows.length}、比價品項 ${estRows.length}`);
