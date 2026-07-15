import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { createPortal } from "react-dom";
import { uploadPhoto, deletePhotoFile, supabase, getSharedMany } from "./supa.js";
import { fmt, baseAmount, taxOf, estAmount, paidOf, unpaidOf, calcEstimated, calcActual, pretaxOf, isTaxable, catRawEst, catPretaxSub, catDiscount, catEstAfter, catSaved, catItemEstAfter, PAY_CATEGORIES, catPaid, catItemPaidMap, catUnpaidAfter, isFundingCat, pettyItemOf, withPettyItems, projectTotals } from "./lib/cost.js";
import { INITIAL_CATEGORIES } from "./lib/seed.js";
import { SPACES, SPACE_CONF, PERM_MATRIX, LEGACY_EDIT, PERM_NONE, DEFAULT_ROLES, ALL_VIEW_KEYS, ALL_EDIT_KEYS, ALL_MONEY_KEYS } from "./lib/spaces.js";
import { buildBotSnapshot } from "./lib/snapshot.js";
import FinanceView from "./finance/Finance.jsx";
import TaskCenter from "./tasks/TaskCenter.jsx";
import Conclusions from "./conclusions/Conclusions.jsx";
import SequenceView from "./SequenceView.jsx";
import { LayoutDashboard, ClipboardList, CheckSquare, CalendarDays, Pin as PinIcon, FolderOpen, Wallet, Scale, Settings as SettingsIcon, Bot, Megaphone, MessagesSquare, Users as UsersIcon, ScrollText, LifeBuoy, Lock as LockIcon, Gauge, Bell, KeyRound } from "lucide-react";

// 導覽分頁圖示（依 DESIGN_SPEC：lucide 細線取代 emoji）
const NAV_ICONS = { owner: LayoutDashboard, overview: ClipboardList, tasks: CheckSquare, gantt: CalendarDays, conclusions: PinIcon, files: FolderOpen, petty: Wallet, compare: Scale, settings: SettingsIcon };
const SUB_ICONS = { advisor: Bot, changelog: Megaphone, groups: MessagesSquare, accounts: UsersIcon, audit: ScrollText, history: LifeBuoy, vault: LockIcon, usage: Gauge };
// 深色頂欄（Linear 式錨點）
const HEAD_BG = "#171717", HEAD_LINE = "#2e2e2e", HEAD_SUB = "#9ca3af", HEAD_CHIP = "#262626";

// ── DESIGN TOKENS（依 docs/DESIGN_SPEC.md：Linear/Stripe 儀表板風 — 中性灰白 + 單一藍色主色）──
const BRAND   = "#C13A22"; // 品牌磚紅 — 只給 GROUN:D 商標用，不再當 UI 主色
const ACCENT  = "#2563eb"; // blue-600 — 全站唯一 UI 主色（主按鈕 / 選中 / 連結）
const PRIMARY = "#171717"; // neutral-900 — 選中 tab / 深色按鈕
const BG      = "#fafafa"; // neutral-50 頁面背景
const SURFACE = "#ffffff"; // 卡片/表面
const BORDER  = "#e5e5e5"; // neutral-200 邊框（一律 1px）
const TEXT    = "#171717"; // 主文字（近黑）
const SUB     = "#737373"; // neutral-500 次文字
const ACCENT_SOFT = "#eff6ff"; // blue-50 主色淡底
const DARKCHIP = "#262626"; // neutral-800 深色 chip（分類標籤）
const GOLD    = "#C13A22"; // Logo 用磚紅
const ADMIN_USER = "goodmask77"; // 僅此帳號可編輯（不顯示於介面）
// 介面顯示用：絕不顯示登入帳號字串（避免外洩）。管理員一律顯示「管理員」。
const maskAccount = (u) => !u ? "—" : (u === ADMIN_USER ? "管理員" : u);
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";


const STATUS_MAP = {
  pending:     { label: "待開工", color: "#6F6656" },
  inprogress:  { label: "進行中", color: "#3E72A8" },
  done:        { label: "完工",   color: "#3C8C3C" },
  issue:       { label: "有問題", color: "#C0392B" },
  hold:        { label: "暫停",   color: "#C2872E" },
};

// ── 大項⇄細項狀態連動 ──
// 大項標完工 → 底下所有細項一起完工
const markCatDone = (cat) => ({ ...cat, status: "done", items: (cat.items || []).map(it => ({ ...it, status: "done", done: true })) });
// 依細項回算大項狀態：全完工→完工；大項原為完工但細項未全完工→降回進行中/待開工；其餘保留(尊重手動標的進行中/有問題/暫停)
const syncCatStatus = (cat) => {
  const items = cat.items || [];
  if (!items.length) return cat;
  const allDone = items.every(it => it.done || it.status === "done");
  if (allDone) return cat.status === "done" ? cat : { ...cat, status: "done" };
  if (cat.status === "done") { const active = items.some(it => it.done || it.status === "done" || it.status === "inprogress"); return { ...cat, status: active ? "inprogress" : "pending" }; }
  return cat;
};
// 一次性修正既有不一致：大項=完工但細項未全完工 → 細項補完工；細項全完工但大項未標完工 → 大項補完工
function reconcileStatuses(cats) {
  if (!Array.isArray(cats)) return cats;
  let changed = false;
  const out = cats.map(c => {
    const items = c.items || [];
    if (!items.length) return c;
    if (c.status === "done") {
      const ni = items.map(it => (it.done || it.status === "done") ? it : { ...it, status: "done", done: true });
      if (ni.some((it, i) => it !== items[i])) { changed = true; return { ...c, items: ni }; }
      return c;
    }
    if (items.every(it => it.done || it.status === "done")) { changed = true; return { ...c, status: "done" }; }
    return c;
  });
  return changed ? out : cats;
}

// 成本金額模型已抽到 ./lib/cost.js（App 與未來 LINE bot 共用同一套算法）。下方僅保留遷移工具。
// 一次性遷移：
// 1) 沒有 payments 的大項，把舊的逐項已付總和轉成一筆「既有付款」紀錄（已付總額不變）
// 2) 清掉第一版殘留的 cat.budget（App 已改用議價後即時值，此欄不再使用，留著會讓 AI/bot 報出空殼金額）
function migratePayments(cats) {
  if (!Array.isArray(cats)) return cats;
  let changed = false;
  const out = cats.map(c => {
    let next = c;
    if (!Array.isArray(c.payments)) {
      const sumPaid = (c.items || []).reduce((s, it) => s + (Number(it.paid ?? it.cust?.paid) || 0), 0);
      const payments = sumPaid > 0
        ? [{ id: "pay-legacy-" + c.id, date: "", amount: sumPaid, category: "其他", note: "既有付款（系統轉入）", receipts: [] }]
        : [];
      next = { ...next, payments };
      changed = true;
    }
    if (next.budget) { // 非 0 的舊 budget → 清成 0
      next = { ...next, budget: 0 };
      changed = true;
    }
    return next;
  });
  return changed ? out : cats;
}

// ── RWD：偵測手機寬度（< 768px）──────────────────────────────────────────────
const MOBILE_BP = 768;
function useIsMobile(bp = MOBILE_BP) {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}

// ── LINE 推播通知 ───────────────────────────────────────────────────────────
const LINE_PUSH_URL = "https://ground-pm-webhook.vercel.app/api/push";
const LINE_API_KEY = "ground-pm-2026-secret-abc123"; // 先寫死，之後再改後端代理/加密
const DEFAULT_LINE_GROUP = "Cf7940efc6517b0c084ad2ad496b45f30";
// 通知開關清單（key 同時供 webhook server 排程使用）
const LINE_EVENTS = [
  ["daily",   "每日工地速報（早上 8:00 推送）"],
  ["issue",   "細項狀態變為「有問題」時通知"],
  ["done",    "細項狀態變為「完工」時通知"],
  ["stalled", "卡關超過 3 天提醒"],
  ["weekly",  "AI 週報每週五自動推送"],
  ["due",     "排程任務截止日提醒"],
  ["journal", "新工作日誌建立時通知"],
];
async function _lineSettings() {
  try { const r = await window.storage.get(K("pm_settings"), true); return r && r.value ? JSON.parse(r.value) : {}; } catch { return {}; }
}
async function _linePush(body) {
  try {
    const res = await fetch(LINE_PUSH_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": LINE_API_KEY }, body: JSON.stringify(body) });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch (e) { return { ok: false, error: String(e) }; }
}
// 共用：直接推送一段文字（讀 storage 群組 ID；無設定則用預設群組）
async function sendLineNotify(text) {
  const s = await _lineSettings();
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, message: text });
}
// 共用：推送 LINE Flex 訊息
async function sendLineFlex(flex) {
  const s = await _lineSettings();
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, flex });
}
// 事件型通知：依「通知開關」決定是否推送
async function notifyLineEvent(type, text) {
  const s = await _lineSettings();
  if (!((s.lineNotify || {})[type])) return { ok: false, reason: "disabled" };
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, message: text });
}
const calcItemTotal = (it) => calcEstimated(it);

// ── STORAGE HELPERS ───────────────────────────────────────────────────────────
// ── 工作空間（多空間隔離）──────────────────────────────────────────────────
// 預設空間＝construction，沿用原本的 key（零遷移）；其他空間一律加前綴 sp_<id>_
// 全域 key（跨空間共用）：使用者身分、空間設定本身

const conf = () => SPACE_CONF[CURRENT_SPACE] || SPACE_CONF.construction;
const L = (key) => conf().labels[key] || SPACE_CONF.construction.labels[key];
// 金額顯示開關：依登入者 profile 的「看金額」設定（未登入訪客＝可看，維持原行為）。
// 由 App 在每次 render 同步（見 App 內 CAN_VIEW_MONEY 指派）。
let CAN_VIEW_MONEY = true;
const showMoney = () => conf().showCost && CAN_VIEW_MONEY;
// isFundingCat / pettyItemOf / withPettyItems 已抽到 ./lib/cost.js（與 bot 共用）
const COST_COL_IDS = new Set(["estQty", "unit", "estUnitPrice", "taxType", "taxAmount", "estTotal", "itemPaid", "payAccount", "payDate"]);
const GLOBAL_KEYS = new Set(["pm_role", "pm_known_users", "pm_current_space", "pm_roles", "pm_guest_perms"]);
let CURRENT_SPACE = "construction";
try { CURRENT_SPACE = localStorage.getItem("pm_current_space") || "construction"; } catch (_) {}
if (!SPACES.some(s => s.id === CURRENT_SPACE)) CURRENT_SPACE = "construction";
// 邏輯 key → 實體 key（依目前空間）
const K = (key) => (CURRENT_SPACE === "construction" || GLOBAL_KEYS.has(key)) ? key : `sp_${CURRENT_SPACE}_${key}`;
// 目前登入者（由 App 同步），給 App 元件外的模組（如夥伴中心 crew 元件）寫操作紀錄用
let CURRENT_USER = "";
// 模組級操作紀錄：直接讀改寫目前空間的 pm_activity（給 App 元件作用域外的地方用）
async function auditLog(action, detail) {
  try {
    const r = await window.storage.get(K("pm_activity"), true);
    const prev = r && r.value ? JSON.parse(r.value) : [];
    const next = [{ ts: new Date().toISOString(), user: CURRENT_USER || "系統", action, detail }, ...prev].slice(0, 200);
    await window.storage.set(K("pm_activity"), JSON.stringify(next), true);
  } catch (_) {}
}
const switchSpace = (id) => { try { localStorage.setItem("pm_current_space", id); } catch (_) {} window.location.reload(); };

async function loadData() {
  try {
    const r = await window.storage.get(K("pm_data"), true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return null;
}
async function saveData(cats) {
  try {
    await window.storage.set(K("pm_data"), JSON.stringify(cats), true);
  } catch (_) {}
}
async function loadGlobalChat() {
  try {
    const r = await window.storage.get(K("pm_global_chat"), true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return [];
}
async function saveGlobalChat(msgs) {
  try {
    await window.storage.set(K("pm_global_chat"), JSON.stringify(msgs), true);
  } catch (_) {}
}

async function loadSettings() {
  try {
    const r = await window.storage.get(K("pm_settings"), true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return null;
}
async function saveSettings(s) {
  try { await window.storage.set(K("pm_settings"), JSON.stringify(s), true); } catch (_) {}
}
async function loadRole() {
  try { const r = await window.storage.get(K("pm_role"), false); if (r&&r.value) return r.value; } catch(_){}
  return null;
}
async function saveRole(role) {
  try { await window.storage.set(K("pm_role"), role, false); } catch(_){}
}
async function loadActivityLog() {
  try { const r = await window.storage.get(K("pm_activity"), true); if (r&&r.value) return JSON.parse(r.value); } catch(_){}
  return [];
}
async function saveActivityLog(log) {
  try { await window.storage.set(K("pm_activity"), JSON.stringify(log.slice(-200)), true); } catch(_){}
}
async function loadAILog() {
  try {
    const r = await window.storage.get(K("pm_ai_log"), true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return [];
}
async function saveAILog(log) {
  try { await window.storage.set(K("pm_ai_log"), JSON.stringify(log), true); } catch (_) {}
}

// ── AI CALL ───────────────────────────────────────────────────────────────────
// ── AI 用量／估算花費 ───────────────────────────────────────────────────────
// 模型單價（USD / 每百萬 tokens，[輸入, 輸出]）；找不到對應就用 default。可日後微調。
const MODEL_PRICES = [
  [/opus/i,            [15, 75]],
  [/haiku/i,           [1, 5]],
  [/sonnet/i,          [3, 15]],
  [/claude-3-5-sonnet/i, [3, 15]],
];
const PRICE_DEFAULT = [3, 15];
const USD_TWD = 32.5; // 估算匯率（USD→TWD，可日後調整）
const priceFor = (model) => (MODEL_PRICES.find(([re]) => re.test(model || ""))?.[1]) || PRICE_DEFAULT;
async function recordAIUsage(model, usage, kind = "chat") {
  if (!usage) return;
  const inTok = Number(usage.input_tokens) || 0;
  const outTok = Number(usage.output_tokens) || 0;
  if (inTok + outTok === 0) return;
  const [pin, pout] = priceFor(model);
  const usd = inTok / 1e6 * pin + outTok / 1e6 * pout;
  try {
    const r = await window.storage.get(K("pm_ai_usage"), true);
    let log = [];
    if (r && r.value) { try { log = JSON.parse(r.value); } catch (_) {} }
    log.push({ ts: new Date().toISOString(), model: model || "?", kind, inTok, outTok, usd });
    if (log.length > 2000) log = log.slice(-2000);
    await window.storage.set(K("pm_ai_usage"), JSON.stringify(log), true);
  } catch (_) {}
}

async function callAI(messages, systemPrompt, kind = "chat", extSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000); // 逾時保護：避免大圖/PDF 解析永遠卡住
  if (extSignal) { if (extSignal.aborted) ctrl.abort(); else extSignal.addEventListener("abort", () => ctrl.abort()); } // 外部「取消」也能中斷
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system: systemPrompt }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (!res.ok) return data.error || "（AI 顧問尚未設定，請於 Vercel 加入 ANTHROPIC_API_KEY）";
    if (data.usage) recordAIUsage(data.model, data.usage, kind); // 記錄用量＋用途（不阻塞回覆）
    return data.content?.map(b => b.text || "").join("") || "（AI無回應）";
  } catch (e) {
    return e?.name === "AbortError" ? "（AI 解析逾時，請改用較清晰或較小的檔案再試）" : "（AI 連線失敗，請稍後再試）";
  } finally {
    clearTimeout(timer);
  }
}
const KIND_LABEL = { chat: "AI 顧問對話", import: "PDF/估價單匯入", weekly: "AI 週報", compare: "估價單比價", tidy: "日誌整理" };

const SYSTEM_GLOBAL = `你是「宏匯 GROUN:D」餐廳裝修專案的工程管理助理，可直接操作系統（建檔、改資料、上報價單）。

【回應原則｜很重要】
1. 只回應使用者「當下這句話」要的事，直接做、簡短回。不要主動把整個專案總覽、財務概況、各工程清單念一遍——除非使用者明確問「總覽／現況／全部狀況」。
2. 短指令也要聽懂：使用者回「A」「好」「對」「第一個」等，代表同意你「上一則訊息」提的方案/問題，就照那個做，不要重新自我介紹或念總覽。
3. 不確定就用一句話反問，不要長篇大論。
4. 繁體中文、白話、講重點。`;

const buildAdvisorSystem = (settings, cats, journal, events, plans) => {
  journal = journal || [];
  events = events || [];
  plans = plans || [];
  const totalEst = cats.filter(c=>!isFundingCat(c)).reduce((s,c) => s+catEstAfter(c),0); // 議價後含稅總額（排除撥款帳）
  const totalAct = cats.filter(c=>!isFundingCat(c)).reduce((s,c) => s+catPaid(c),0); // 已付總額（排除撥款帳）
  const doneItems = cats.flatMap(c=>c.items).filter(i=>i.done||i.status==="done").length;
  const totalItems = cats.reduce((s,c)=>s+c.items.length,0);
  const issueItems = cats.flatMap(c=>c.items).filter(i=>i.status==="issue");
  const today = new Date().toLocaleDateString("zh-TW");
  const targetDate = settings?.targetDate || "未設定";
  const daysLeft = settings?.targetDate ? Math.ceil((new Date(settings.targetDate)-new Date())/(1000*60*60*24)) : null;
  const projectName = settings?.projectName || "宏匯 GROUN:D";
  const projectAddr = settings?.projectAddress || "台北市內湖區瑞光路337號";
  const owner = settings?.ownerName || "業主";
  const contractor = settings?.contractorName || "碩藝室內裝修";
  const notes = settings?.notes || "";

  const catLines = cats.map(c => {
    const est = catEstAfter(c); // 議價後
    const raw = catRawEst(c);
    const act = catPaid(c);
    const done = c.items.filter(i=>i.done||i.status==="done").length;
    const dInfo = (raw > est) ? "（原報價" + Math.round(raw/10000) + "萬，議價省" + Math.round((raw-est)/10000) + "萬）" : "";
    return "  • " + c.name + "（" + c.status + "）：預估" + Math.round(est/10000) + "萬" + dInfo + "，已付" + (act>0?Math.round(act/10000)+"萬":"未付") + "，" + done + "/" + c.items.length + "細項完成";
  }).join("\n");

  const priorityItems = cats.flatMap(c=>c.items).filter(i=>i.priority || (settings?.priorities||[]).includes(i.id)).map(i=>i.name).join("、");

  return (conf().aiRole ? conf().aiRole + "\n\n" : "") + "你是專屬於「" + projectName + "」的" + (conf().aiRole ? "助理" : "AI工程總顧問") + "，以下是今日（" + today + "）的完整狀態，請根據此資料進行分析與回應。\n\n" +
    "【專案基本資訊】\n" +
    "- 專案名稱：" + projectName + "\n" +
    "- 地址：" + projectAddr + "\n" +
    "- 業主：" + owner + "\n" +
    "- 承包商：" + contractor + "\n" +
    "- 目標完工日：" + targetDate + (daysLeft !== null ? "（距今 "+daysLeft+" 天）" : "") + "\n" +
    "- 今日日期：" + today + "\n" +
    (notes ? "- 特別指示："+notes+"\n" : "") +
    ((settings?.aiDocs||[]).length ? "- 知識庫參考檔："+(settings.aiDocs||[]).map(d=>d.name).join("、")+"\n" : "") +
    "\n【財務狀況】\n" +
    "- 預估總額（含稅）：NT$" + Math.round(totalEst).toLocaleString() + "\n" +
    "- 已付總額：" + (totalAct>0?"NT$"+Math.round(totalAct).toLocaleString():"尚未付款") + "\n" +
    "- 未付總額：NT$" + Math.round(totalEst-totalAct).toLocaleString() + (totalAct>totalEst?"（溢付）":"") + "\n" +
    "\n【工程進度】\n" +
    "- 完成細項：" + doneItems + " / " + totalItems + "（" + Math.round(doneItems/Math.max(totalItems,1)*100) + "%）\n" +
    (issueItems.length>0?"- ⚠️ 有問題項目："+issueItems.map(i=>i.name).join("、")+"\n":"") +
    (priorityItems?"- ⭐ 標記優先項目："+priorityItems+"\n":"") +
    "\n【各大項狀態】\n" + catLines + "\n" +
    "\n【你的核心任務】\n" +
    "1. 每日追蹤：主動詢問各工程進度、是否有阻礙、材料是否到位\n" +
    "2. 優先序管理：依照工序相依性、距完工日時間、風險程度排列當前最優先事項\n" +
    "3. 衝突偵測：檢查工序時間衝突、預算超支風險、未分配項目\n" +
    "4. 進度推演：根據目前進度推算能否如期完工，給出預警\n" +
    "5. 決策建議：當發現問題主動提出具體解決方案（不只指出問題）\n\n" +
    (journal.length>0 ? "\n【最近工作日誌（" + journal.length + "筆）】\n" + journal.slice(0,10).map(j => "• " + (j.date||"") + " 「" + (j.title||"") + "」: " + (j.content||"").slice(0,80)).join("\n") + "\n" : "") +
    (events.length>0 ? "\n【近期行事曆】\n" + events.filter(e => new Date(e.date) >= new Date(Date.now()-7*24*3600*1000)).slice(0,15).map(e => "• " + e.date + " " + e.title + (e.catName?"（"+e.catName+"）":"")).join("\n") + "\n" : "") +
    (plans.length>0 ? "\n【未來排程任務】\n" + plans.filter(p => !p.done).slice(0,20).map(p => "• [" + (p.priority||"中")+"] " + p.title + (p.dueDate?" — 截止 "+p.dueDate:"")).join("\n") + "\n" : "") +
    "\n請用繁體中文回答，條理清晰，必要時用編號清單，關鍵數字請標示清楚。\n當使用者提供新資料時：主動協助歸檔、分析、整理；當發現工序/工法/成本不合理處：結合理論與實務經驗提出優化建議；當某項目太久沒更新：提醒可能跟不上進度；每天被要求時：輸出當日執行計劃與檢核表。";
};

const SYSTEM_ITEM = (catName, itemName) => `你是一位專業餐廳裝修工程顧問。目前討論的工程項目是：【${catName}】中的【${itemName}】。請針對此具體項目提供專業建議，包括施工要點、常見問題、驗收標準、市場行情等。用繁體中文回答。`;

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [cats, setCats] = useState(null);
  const [view, setView] = useState(conf().defaultView || "overview"); // 預設總覽頁（夥伴中心預設資料庫）
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [globalChat, setGlobalChat] = useState([]);
  const [showGlobalAI, setShowGlobalAI] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [aiLog, setAiLog] = useState([]);
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [userName, setUserName] = useState(null); // null=not logged in（顯示名稱，來自登入 session）
  const [profile, setProfile] = useState(null);   // 登入者的 profiles 資料（角色/部門/看金額）
  const [activityLog, setActivityLog] = useState([]);
  const [showLogin, setShowLogin] = useState(false);
  const [showAcctMenu, setShowAcctMenu] = useState(false);
  const [knownUsers, setKnownUsers] = useState([]);
  const [worklog, setWorklog] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [customCols, setCustomCols] = useState([]);
  const [colOrder, setColOrder] = useState([]);
  const [seqLogs, setSeqLogs] = useState([]);
  const [trash, setTrash] = useState([]); // 垃圾桶：刪除的細項，可還原
  const [events, setEvents] = useState([]);
  const [journal, setJournal] = useState([]);
  const [plans, setPlans] = useState([]);
  const [petty, setPetty] = useState({ advances: [], spends: [] }); // 零用金帳本：撥款 / 花費
  const [roles, setRoles] = useState([]); // 身份範本（連動式）：指派給帳號後，帳號權限跟著身份走
  const [guestPerms, setGuestPerms] = useState({ money_pages: ["__none__"] }); // 未登入訪客的權限（可設定；金額預設關）
  const commitGuestPerms = (next) => { setGuestPerms(next); window.storage.set("pm_guest_perms", JSON.stringify(next), true).catch(() => {}); };
  const { confirm, Dialog: ConfirmDialog } = useConfirm();
  const commitPetty = (next) => {
    try { const d = describePettyChange(petty, next); if (d && d.detail) logActionDebounced("編輯", d.key, d.detail); } catch (_) {}
    try { maybeSnapshot("pm_petty", petty); } catch (_) {} // 改之前先留一份舊的(10分鐘節流)→救得回
    setPetty(next);
    window.storage.set(K("pm_petty"), JSON.stringify(next), true).catch(() => {});
  };
  const commitRoles = (next) => {
    setRoles(next);
    window.storage.set(K("pm_roles"), JSON.stringify(next), true).catch(() => {});
  };

  // ── 資料保險箱：版本快照／還原點 ──────────────────────────────────────
  // 重要資料(工程資料/零用金)每次變動就留時間戳快照，之後可一鍵還原到任何一個還原點。
  const histRef = useRef({}); // 每個 key 最近一次快照時間（節流用）
  const snapshotData = async (logicalKey, dataObj, opts = {}) => {
    try {
      const hk = "pm_hist_" + logicalKey;
      const r = await window.storage.get(K(hk), true);
      const list = r && r.value ? JSON.parse(r.value) : [];
      const json = JSON.stringify(dataObj);
      if (!opts.force && list[0] && list[0].json === json) return; // 跟最新一筆一樣就不重複存
      const entry = { id: "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: new Date().toISOString(), user: userName || "系統", json, note: opts.note || "" };
      const next = [entry, ...list].slice(0, 60); // 最多留 60 個還原點
      await window.storage.set(K(hk), JSON.stringify(next), true);
      histRef.current[logicalKey] = Date.now();
    } catch (_) {}
  };
  const maybeSnapshot = (logicalKey, dataObj) => {
    const last = histRef.current[logicalKey] || 0;
    if (Date.now() - last < 10 * 60000) return; // 10 分鐘內同一 key 不重複留點（避免每次小改都存）
    snapshotData(logicalKey, dataObj);
  };

  // 工作日誌：寫入 state 並存進共享後端
  const commitWorklog = (list) => {
    try { const p = worklog || []; if (list.length > p.length) logActivity("新增", "新增工作日誌"); else if (list.length < p.length) logActivity("刪除", "刪除工作日誌"); else logAction("編輯", "編輯工作日誌", 4000); } catch (_) {}
    setWorklog(list);
    window.storage.set(K("pm_worklog"), JSON.stringify(list), true).catch(()=>{});
  };
  // 檔案庫照片：metadata 存共享後端（圖片本體在 Supabase Storage）
  const commitPhotos = (list) => {
    try { const p = photos || []; if (list.length > p.length) logActivity("新增", `上傳檔案庫檔案（+${list.length - p.length}）`); else if (list.length < p.length) logActivity("刪除", "刪除檔案庫檔案"); else logAction("編輯", "編輯檔案庫", 4000); } catch (_) {}
    setPhotos(list);
    window.storage.set(K("pm_photos"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitAccounts = (list) => {
    setAccounts(list);
    window.storage.set(K("pm_accounts"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitCustomCols = (list) => {
    logAction("編輯", "調整總覽欄位", 5000);
    setCustomCols(list);
    window.storage.set(K("pm_columns"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitColOrder = (list) => {
    logAction("編輯", "調整欄位順序", 5000);
    setColOrder(list);
    window.storage.set(K("pm_colorder"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitSeqLogs = (list) => {
    try {
      const p = seqLogs || [];
      const snip = (e) => { const s = (e?.done || e?.next || "").trim(); return s ? "：" + s.slice(0, 30) : (e?.issue ? "：⚠️異常" : ""); };
      if (list.length > p.length) { const a = list.find(x => !p.some(y => y.id === x.id)); logActivity("新增", `工序日誌「${_seqName(a?.itemId)}」${a?.date ? " " + a.date : ""}${snip(a)}`); }
      else if (list.length < p.length) { const r = p.find(x => !list.some(y => y.id === x.id)); logActivity("刪除", `刪工序日誌「${_seqName(r?.itemId)}」${r?.date ? " " + r.date : ""}`); }
      else { const ch = list.find(x => { const o = p.find(y => y.id === x.id); return o && JSON.stringify(o) !== JSON.stringify(x); }); logAction("編輯", `改工序日誌「${_seqName(ch?.itemId)}」${snip(ch)}`, 4000); }
    } catch (_) {}
    setSeqLogs(list);
    window.storage.set(K("pm_seqlogs"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitTrash = (list) => {
    const trimmed = list.slice(0, 200); // 最多留 200 筆
    setTrash(trimmed);
    window.storage.set(K("pm_trash"), JSON.stringify(trimmed), true).catch(()=>{});
  };
  // 刪細項時呼叫：把細項丟進垃圾桶（記住來源大項）
  const trashItems = (catId, catName, items) => {
    const entries = (items || []).map(it => ({ tid: "tr-" + Math.random().toString(36).slice(2, 8), catId, catName, item: it, deletedAt: new Date().toISOString(), deletedBy: userName || "—" }));
    commitTrash([...entries, ...trash]);
  };
  const restoreTrash = (tid) => {
    const e = trash.find(x => x.tid === tid); if (!e) return;
    logActivity("編輯", `還原細項「${e?.item?.name || "—"}」（從垃圾桶）`);
    setCats(prev => {
      let target = prev.find(c => c.id === e.catId) || prev.find(c => c.name === e.catName);
      if (!target) return prev; // 來源大項已不存在
      return prev.map(c => c.id === target.id ? { ...c, items: [...(c.items || []), e.item] } : c);
    });
    commitTrash(trash.filter(x => x.tid !== tid));
  };

  // load — 全部 key 平行載入（不再一個一個排隊），大幅縮短開啟時間
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const parse = (v, def) => { if (!v) return def; try { return JSON.parse(v); } catch (_) { return def; } };
      // 一次抓所有共用資料（合併成單一請求）+ 本機的角色，避免開啟時打十幾次 API
      const SHARED_KEYS = ["pm_data", "pm_global_chat", "pm_settings", "pm_ai_log", "pm_activity", "pm_known_users", "pm_worklog", "pm_photos", "pm_accounts", "pm_seqlogs", "pm_columns", "pm_events", "pm_journal", "pm_plans", "pm_trash", "pm_petty", "pm_roles", "pm_guest_perms"];
      const [batch, savedName] = await Promise.all([getSharedMany(SHARED_KEYS.map(K)), loadRole()]);
      if (cancelled) return;
      const raw = (k) => batch[K(k)] || null;
      const d = parse(raw("pm_data"), null);
      const gc = parse(raw("pm_global_chat"), []);
      const sv = parse(raw("pm_settings"), null);
      const log = parse(raw("pm_ai_log"), []);
      const alog = parse(raw("pm_activity"), []);
      const kuV = raw("pm_known_users"), wlV = raw("pm_worklog"), phV = raw("pm_photos"), acV = raw("pm_accounts"), slV = raw("pm_seqlogs"), ccV = raw("pm_columns"), evV = raw("pm_events"), jnV = raw("pm_journal"), plV = raw("pm_plans"), trV = raw("pm_trash"), ptV = raw("pm_petty"), rlV = raw("pm_roles");
      { const r = parse(rlV, null); setRoles(Array.isArray(r) && r.length ? r : DEFAULT_ROLES); } // 沒存過＝用預設範本（記憶體即可，admin 編輯時才落地）
      { const g = parse(raw("pm_guest_perms"), null); if (g && typeof g === "object") setGuestPerms(g); } // 訪客權限（沒存過＝預設金額關）

      const seed = CURRENT_SPACE === "construction" ? INITIAL_CATEGORIES : [];
      const migrated = reconcileStatuses(migratePayments(d || seed));
      setCats(migrated);
      // 只有「真的有讀到資料」且需要遷移時才回寫；絕不把 seed 自動存回去（避免讀取失敗時蓋掉真資料）
      if (d && migrated !== d) saveData(migrated);

      setGlobalChat(gc);
      const defSettings = CURRENT_SPACE === "construction"
        ? { projectName:"宏匯 GROUN:D", projectAddress:"台北市內湖區瑞光路337號", ownerName:"", contractorName:"碩藝室內裝修有限公司", targetDate:"", notes:"", priorities:[], dailyCheckEnabled:false, lineGroupId: DEFAULT_LINE_GROUP, lineNotify: {} }
        : { projectName: SPACES.find(s=>s.id===CURRENT_SPACE)?.name || "工作空間", projectAddress:"", ownerName:"", contractorName:"", targetDate:"", notes:"", priorities:[], dailyCheckEnabled:false, lineGroupId:"", lineNotify: {} };
      setSettings(sv && Object.keys(sv).length ? sv : defSettings);
      setAiLog(log);
      // 身分改由 Supabase 登入 session 決定（見下方 useEffect），不再用舊的「記住名字」

      // 未登入 → 訪客唯讀瀏覽（不強制登入）
      const kuArr = parse(kuV, null);
      if (Array.isArray(kuArr)) { const arr = kuArr.filter(u => u !== ADMIN_USER); setKnownUsers(arr); window.storage.set(K("pm_known_users"), JSON.stringify(arr), true).catch(()=>{}); }
      else setKnownUsers([]);

      setActivityLog(alog);
      if (wlV) setWorklog(parse(wlV, []));
      if (phV) setPhotos(parse(phV, []));
      if (acV) setAccounts(parse(acV, []));
      if (slV) setSeqLogs(parse(slV, []));
      if (trV) setTrash(parse(trV, []));
      if (evV) setEvents(parse(evV, []));
      if (jnV) setJournal(parse(jnV, []));
      if (plV) setPlans(parse(plV, []));
      if (ptV) { const p = parse(ptV, null); if (p) setPetty({ advances: p.advances || [], spends: p.spends || [] }); }

      // 統一欄位：以新版內建欄重建 + 保留真正的自訂欄
      try {
        const builtins = COLS.map(c => ({ id:c.id, label:c.label, builtin:true, fixed: !!c.fixed, w:c.w }));
        const builtinIds = new Set(COLS.map(c => c.id));
        const customs = parse(ccV, []).filter(c => c.builtin === false && !builtinIds.has(c.id) && c.label !== "稅金");
        const merged = [...builtins, ...customs];
        setCustomCols(merged);
        window.storage.set(K("pm_columns"), JSON.stringify(merged), true).catch(()=>{});
      } catch(_){}
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 真登入（Supabase Auth）：身分一律由登入 session 決定，無法冒名 ──
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let lastUid = null;
    const applySession = async (session) => {
      if (!active) return;
      if (!session?.user) { lastUid = null; setProfile(null); setUserName(null); return; }
      if (session.user.id === lastUid) return; // 避免同一使用者重複抓 profile（getSession + INITIAL_SESSION 會重複）
      lastUid = session.user.id;
      try {
        const { data: prof } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
        if (!active) return;
        setProfile(prof || null);
        setUserName(prof?.display_name || null);
      } catch (_) { setProfile(null); setUserName(null); }
    };
    // 只用 onAuthStateChange（訂閱時會立即發 INITIAL_SESSION 帶入目前登入狀態），不另外再呼叫 getSession，少一次往返
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => applySession(session));
    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  // auto-save（防呆：略過「初始載入」造成的第一次寫入，避免載入失敗時把範例資料存回去蓋掉真資料）
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!cats) return;
    if (!initialLoadDone.current) { initialLoadDone.current = true; return; }
    setSaving(true);
    const t = setTimeout(async () => {
      await saveData(cats);
      try { maybeSnapshot("pm_data", cats); } catch (_) {} // 工程資料還原點(10分鐘節流)
      setSaving(false);
    }, 1200);
    return () => clearTimeout(t);
  }, [cats]);

  // LINE：偵測細項狀態變更為「有問題 / 完工」→ 即時推播（依開關）
  const prevCatsRef = useRef(null);
  useEffect(() => {
    const prev = prevCatsRef.current;
    prevCatsRef.current = cats;
    if (!cats || !prev) return; // 首次載入不通知
    for (const nc of cats) {
      const pc = prev.find(c => c.id === nc.id); if (!pc) continue;
      for (const ni of (nc.items || [])) {
        const pi = (pc.items || []).find(i => i.id === ni.id); if (!pi || pi.status === ni.status) continue;
        if (ni.status === "issue") notifyLineEvent("issue", `🚨【${nc.name}】「${ni.name}」狀態變更為「有問題」\n更新者：${userName || "未具名"}`);
        else if (ni.status === "done") notifyLineEvent("done", `✅【${nc.name}】「${ni.name}」完工\n更新者：${userName || "未具名"}`);
      }
    }
  }, [cats]); // eslint-disable-line

  const logActivity = (action, detail, userOverride) => {
    // userOverride：登入當下 userName 還沒非同步帶入，要用剛抓到的名字記，否則會記成「系統」
    const entry = { ts: new Date().toISOString(), user: userOverride || userName || "系統", action, detail };
    setActivityLog(prev => { const next = [entry, ...prev].slice(0,200); saveActivityLog(next); return next; });
  };
  // 操作紀錄：把連續編輯收斂成「每 90 秒一筆」，避免每打一個字就記一條（只記登入者的操作）
  const logThrottleRef = useRef({});
  const logAction = (action, detail, windowMs = 90000) => {
    if (!userName) return; // 只記登入者
    const key = action + "|" + detail; const now = Date.now();
    if (now - (logThrottleRef.current[key] || 0) < windowMs) return;
    logThrottleRef.current[key] = now;
    logActivity(action, detail);
  };
  // 比對 cats 前後差異 → 產生「具體動作＋新值」描述。回傳 {key, detail}：key 用來節流(同欄位不論值)、detail 給人看(含新值)
  const describeCatChange = (prev, next) => {
    const pc = prev || [], nc = next || [];
    const SL = (s) => STATUS_MAP[s]?.label || s || "—";
    if (nc.length > pc.length) { const a = nc.find(c => !pc.some(p => p.id === c.id)); return { key: "addcat", detail: `新增大項「${a?.name || "—"}」` }; }
    if (nc.length < pc.length) { const r = pc.find(c => !nc.some(n => n.id === c.id)); return { key: "delcat", detail: `刪除大項「${r?.name || "—"}」` }; }
    for (const n of nc) {
      const p = pc.find(c => c.id === n.id); if (!p) continue;
      const pi = p.items || [], ni = n.items || [];
      if (ni.length > pi.length) { const a = ni.find(i => !pi.some(x => x.id === i.id)); return { key: `additem:${n.id}`, detail: `「${n.name}」新增細項${a?.name ? `「${a.name}」` : ""}` }; }
      if (ni.length < pi.length) { const r = pi.find(i => !ni.some(x => x.id === i.id)); return { key: `delitem:${n.id}`, detail: `「${n.name}」刪除細項${r?.name ? `「${r.name}」` : ""}` }; }
      for (const ix of ni) {
        const px = pi.find(i => i.id === ix.id); if (!px) continue;
        const tag = `${n.name}／${ix.name}`;
        if ((px.name ?? "") !== (ix.name ?? "")) return { key: `item:${ix.id}:name`, detail: `細項改名「${n.name}／${px.name}」→「${ix.name}」` };
        const F = [
          ["status", (v) => `改「${tag}」狀態 → ${SL(v)}`],
          ["estQty", (v) => `改「${tag}」數量 ${px.estQty ?? px.qty ?? "—"} → ${v}`],
          ["estUnitPrice", (v) => `改「${tag}」單價 → ${fmt(v)}`],
          ["amount", (v) => `改「${tag}」金額 → ${fmt(v)}`],
          ["taxType", (v) => `改「${tag}」稅別 → ${v}`],
          ["assignee", (v) => `改「${tag}」廠商 → ${v || "（清空）"}`],
          ["payDate", (v) => `改「${tag}」付款日 → ${v || "（清空）"}`],
          ["paid", (v) => `改「${tag}」已付 → ${fmt(v)}`],
          ["catId", () => `把「${tag}」改歸到別的工種`],
          ["notes", () => `改「${tag}」備註`],
          ["qty", (v) => `改「${tag}」數量 ${px.qty ?? "—"} → ${v}`],
          ["unitPrice", (v) => `改「${tag}」單價 → ${fmt(v)}`],
          ["unit", (v) => `改「${tag}」單位 → ${v || "（清空）"}`],
          ["due", (v) => `改「${tag}」期限 → ${v || "（清空）"}`],
          ["inSeq", (v) => `${v ? "把" : "取消"}「${tag}」${v ? "加入" : "移出"}工序`],
          ["urgent", (v) => `${v ? "標記" : "取消"}「${tag}」超急件`],
          ["receipts", () => `更新「${tag}」憑證`],
        ];
        for (const [k, fn] of F) { if (JSON.stringify(px[k] ?? "") !== JSON.stringify(ix[k] ?? "")) return { key: `item:${ix.id}:${k}`, detail: fn(ix[k]) }; }
        // 萬用：上面沒列到的任何細項欄位（含自訂欄位/工序設定）也要具體記，不再落到籠統字串
        for (const k of new Set([...Object.keys(px || {}), ...Object.keys(ix || {})])) {
          if (k === "id" || k === "name" || k === "lastUpdated") continue; // 純時間戳不算動作
          if (JSON.stringify(px[k] ?? "") !== JSON.stringify(ix[k] ?? "")) return { key: `item:${ix.id}:${k}`, detail: `改「${tag}」${({ seq: "工序設定", cols: "自訂欄位", done: "完成狀態" }[k]) || "欄位內容"}` };
        }
      }
      if (p.name !== n.name) return { key: `catname:${n.id}`, detail: `大項改名「${p.name}」→「${n.name}」` };
      if ((p.payments || []).length !== (n.payments || []).length) {
        const pp = p.payments || [], np = n.payments || [];
        if (np.length > pp.length) { const last = np[np.length - 1]; return { key: `pay:${n.id}`, detail: `「${n.name}」新增付款${last?.amount ? ` ${fmt(last.amount)}` : ""}` }; }
        const removed = pp.find(x => !np.some(y => y.id === x.id)) || pp[pp.length - 1];
        return { key: `pay:${n.id}`, detail: `「${n.name}」刪除付款${removed?.amount ? ` ${fmt(removed.amount)}` : ""}` };
      }
      if ((p.discountValue ?? "") !== (n.discountValue ?? "") || (p.discountMode ?? "") !== (n.discountMode ?? "")) return { key: `disc:${n.id}`, detail: `改「${n.name}」議價 → ${n.discountValue || 0}${n.discountMode === "amt" ? "元" : "%"}` };
      if ((p.status ?? "") !== (n.status ?? "")) return { key: `catstatus:${n.id}`, detail: `改大項「${n.name}」狀態 → ${SL(n.status)}` };
      // 萬用：大項層級其餘欄位（非工程標記、序開關、自訂欄位…）也具體記
      for (const k of new Set([...Object.keys(p || {}), ...Object.keys(n || {})])) {
        if (["id", "name", "items", "payments", "status", "discountValue", "discountMode", "order"].includes(k)) continue;
        if (JSON.stringify(p[k] ?? "") !== JSON.stringify(n[k] ?? "")) return { key: `cat:${n.id}:${k}`, detail: `改大項「${n.name}」${({ nonProject: "非工程標記", seq: "序開關", segments: "排程", urgent: "超急件", seqSubs: "工序子項", note: "備註", cols: "自訂欄位" }[k]) || "設定"}` };
      }
    }
    return { key: "edit", detail: "編輯工程資料" };
  };
  // 防抖：同一格連續打字 → 停手 1.2 秒後只記「最後一筆（含最終值）」
  const logDebounceRef = useRef({});
  const logActionDebounced = (action, dkey, detail, delay = 1200) => {
    if (!userName) return;
    const k = action + "|" + dkey;
    clearTimeout(logDebounceRef.current[k]);
    logDebounceRef.current[k] = setTimeout(() => { logActivity(action, detail); }, delay);
  };
  // 零用金前後差異 → 具體動作（記/改/刪 花費或撥款，含新值）
  const describePettyChange = (prev, next) => {
    const ps = (prev?.spends) || [], ns = (next?.spends) || [], pa = (prev?.advances) || [], na = (next?.advances) || [];
    if (ns.length > ps.length) { const a = ns.find(x => !ps.some(y => y.id === x.id)); return { key: "pettyAddSpend", detail: `記零用金花費「${a?.content || "—"}」${a?.amount ? " " + fmt(a.amount) : ""}` }; }
    if (ns.length < ps.length) { const r = ps.find(x => !ns.some(y => y.id === x.id)); return { key: "pettyDelSpend", detail: `刪零用金花費「${r?.content || "—"}」` }; }
    for (const x of ns) { const y = ps.find(z => z.id === x.id); if (!y) continue; const nm = x.content || y.content || "";
      const F = [["content", "內容", v => `→${v}`], ["amount", "金額", v => `→${fmt(v)}`], ["catId", "工種", () => ""], ["date", "日期", v => `→${v}`], ["voucher", "憑證", v => `→${v}`], ["invoiceNo", "發票號", v => `→${v}`], ["note", "備註", () => ""]];
      for (const [k, lbl, fn] of F) if (JSON.stringify(y[k] ?? "") !== JSON.stringify(x[k] ?? "")) return { key: `pettySpend:${x.id}:${k}`, detail: `改零用金花費「${nm}」${lbl}${fn(x[k])}` };
    }
    if (na.length > pa.length) { const a = na.find(x => !pa.some(y => y.id === x.id)); return { key: "pettyAddAdv", detail: `記零用金撥款${a?.amount ? " " + fmt(a.amount) : ""}` }; }
    if (na.length < pa.length) return { key: "pettyDelAdv", detail: "刪零用金撥款" };
    for (const x of na) { const y = pa.find(z => z.id === x.id); if (!y) continue;
      const F = [["amount", "金額", v => `→${fmt(v)}`], ["date", "日期", v => `→${v}`], ["note", "備註", () => ""]];
      for (const [k, lbl, fn] of F) if (JSON.stringify(y[k] ?? "") !== JSON.stringify(x[k] ?? "")) return { key: `pettyAdv:${x.id}:${k}`, detail: `改零用金撥款 ${lbl}${fn(x[k])}` };
    }
    return { key: "petty", detail: "編輯零用金" };
  };
  const setCatsAndLog = (updater) => {
    setCats(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { const d = describeCatChange(prev, next); if (d && d.detail) queueMicrotask(() => logActionDebounced("編輯", d.key, d.detail)); } catch (_) {}
      return next;
    });
  };

  // ── 帳號 / 逐頁權限（一律來自登入 session 的 profile，無法冒名）──
  const account = profile ? { name: profile.display_name, role: profile.role, pages: profile.pages || [] } : null;
  const isAdmin = account?.role === "admin";
  const isManager = account?.role === "manager";
  // ── 帳號權限二合一矩陣解析：每空間×每頁的「可見/可編輯/看金額」。admin/manager/未登入訪客＝全開；
  //    一般帳號：可見預設全部(由admin逐頁限縮)、可編輯預設無、看金額預設無。只有目前這一頁的元件會 render，
  //    所以可編輯/看金額直接依「目前頁面 view」判定，不必到處改編輯邏輯（降低風險）。
  // 連動式身份：帳號若指定了身份範本(role_template)，權限一律跟著該身份走（改身份→所有人一起變）；否則用個人設定。
  const myRole = (profile?.role_template && roles.length) ? roles.find(r => r.id === profile.role_template) : null;
  const eff = myRole || profile || guestPerms; // 未登入訪客＝用可設定的 guestPerms
  const _vp = eff?.view_pages || [];
  const _ep = eff?.pages || [];
  const _mp = eff?.money_pages || [];
  // 預設「全開」，admin 在權限頁逐項取消才會關閉（空陣列＝全部允許）。未登入訪客一律唯讀但可看。
  const viewOK = (sp, pg) => {
    if (isAdmin) return true;
    if (!_vp.length) return true;                                   // 未設＝全可見
    return _vp.includes(`${sp}:${pg}`) || _vp.includes(pg);         // 後者＝舊裸key相容
  };
  const editOK = (sp, pg) => {
    if (isAdmin || isManager) return true;
    if (!profile) return false;                                     // 未登入訪客：唯讀
    if (!_ep.length) return true;                                   // 登入者未設＝預設可編輯（全開）
    return _ep.includes(`${sp}:${pg}`) || _ep.includes(LEGACY_EDIT[pg]); // 含舊資料相容
  };
  const moneyOK = (sp, pg) => {
    if (isAdmin || isManager) return true;
    if (!_mp.length) return true;                                  // 空＝全開（訪客預設 guestPerms.money_pages=[PERM_NONE]→看不到；admin 可逐頁開放或全開）
    return _mp.includes(`${sp}:${pg}`);
  };
  const canViewMoney = moneyOK(CURRENT_SPACE, view);
  CAN_VIEW_MONEY = canViewMoney; // 同步給 showMoney()（依「目前頁面」決定金額欄位/KPI 顯示與否）
  CURRENT_USER = userName || ""; // 同步給模組級 auditLog（夥伴中心等元件作用域外用）
  const can = (page) => isAdmin || isManager || !!account?.pages?.includes(page);
  // 可見空間（admin 全開；未設＝全開）；可見頁面＝目前空間中通過 viewOK 的頁面清單
  const allowedSpaces = isAdmin ? SPACES.map(s => s.id) : (eff?.spaces?.length ? eff.spaces : SPACES.map(s => s.id));
  const allowedViewPages = isAdmin ? null : (!_vp.length ? null : (PERM_MATRIX[CURRENT_SPACE] || []).map(r => r[0]).filter(pg => viewOK(CURRENT_SPACE, pg)));
  const canEditData = editOK(CURRENT_SPACE, view);   // 目前頁面是否可編輯（內容）
  const canEditWorklog = canEditData;
  const canEditFiles = canEditData;                  // files/compare 各為獨立 view，editOK(view) 已正確
  const canEditAdvisor = canEditData;
  const canEdit = canEditData;

  const requireLogin = () => setShowLogin(true);
  const denyEdit = () => { if (!userName) setShowLogin(true); else alert("此帳號沒有編輯此頁面的權限，請聯絡管理員開放。"); };
  const guardedSetCats = (updater) => {
    if (!canEditData) { denyEdit(); return; }
    setCatsAndLog(updater); // 用前後差異記錄具體動作（改X金額/新增大項/刪細項…）
  };
  const guardedSetSettings = (s) => {
    if (!canEditAdvisor) { denyEdit(); return; }
    logAction("編輯", "設定/AI");
    setSettings(s); saveSettings(s);
  };

  const setCatsLogged = (updater) => {
    if (!canEditData) { denyEdit(); return; }
    setCatsAndLog(updater);
  };
  const setEventsLogged = (updater) => {
    setEvents(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      window.storage.set(K("pm_events"), JSON.stringify(next), true).catch(()=>{});
      return next;
    });
  };
  const setJournalLogged = (updater) => {
    setJournal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      window.storage.set(K("pm_journal"), JSON.stringify(next.slice(0,500)), true).catch(()=>{});
      return next;
    });
  };
  const setPlansLogged = (updater) => {
    setPlans(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      window.storage.set(K("pm_plans"), JSON.stringify(next), true).catch(()=>{});
      return next;
    });
  };

  // Stall detection: items not updated > 3 days
  const stalledItems = cats ? cats.filter(c => !isFundingCat(c) && !c.nonProject).flatMap(c => c.items.filter(it => {
    if (it.fromPetty || it.status === "done" || it.done) return false;
    if (!it.lastUpdated) return false;
    const days = (Date.now() - new Date(it.lastUpdated)) / (1000*60*60*24);
    return days > 3;
  })) : [];

  // 顯示用：把零用金花費當成各工種大項的細項注入（總額/總覽會含它；真實 cats 不變）
  const displayCats = useMemo(() => withPettyItems(cats, petty), [cats, petty]);
  const totalEstimated = displayCats ? displayCats.filter(c => !isFundingCat(c)).reduce((s, c) => s + catEstAfter(c), 0) : 0; // 議價後含稅總額（含零用金、排除撥款帳）
  const totalPaid = displayCats ? displayCats.filter(c => !isFundingCat(c)).reduce((s, c) => s + catPaid(c), 0) : 0; // 已付總額（含零用金、排除撥款帳）
  const doneCount = cats ? cats.filter(c => c.status === "done").length : 0;

  // 「唯一真相快照」：資料變動 4 秒後，把目前空間的權威資料寫進 pm_bot_context（給 LINE bot 只讀這一個，數字永遠跟畫面一致）
  useEffect(() => {
    if (!cats || !settings) return; // 載入完成才寫，避免覆蓋成空殼
    const t = setTimeout(async () => {
      try {
        let issues = [];
        try { const r = await window.storage.get(K("pm_issues"), true); issues = r && r.value ? JSON.parse(r.value) : []; } catch (_) {}
        const snap = buildBotSnapshot({ space: CURRENT_SPACE, settings, cats, petty, journal, events, plans, seqLogs, issues }, new Date().toISOString());
        window.storage.set(K("pm_bot_context"), JSON.stringify(snap), true).catch(() => {});
      } catch (_) {}
    }, 4000);
    return () => clearTimeout(t);
  }, [cats, settings, petty, journal, events, plans, seqLogs]);


  // drag-drop categories
  const onDragStart = (id) => setDragging(id);
  const onDragOver = (id) => { if (id !== dragging) setDragOver(id); };
  const onDrop = (targetId) => {
    if (!canEditData) { denyEdit(); setDragging(null); setDragOver(null); return; }
    if (!dragging || dragging === targetId) { setDragging(null); setDragOver(null); return; }
    setCats(prev => {
      const arr = [...prev];
      const fi = arr.findIndex(c => c.id === dragging);
      const ti = arr.findIndex(c => c.id === targetId);
      const [item] = arr.splice(fi, 1);
      arr.splice(ti, 0, item);
      return arr.map((c, i) => ({ ...c, order: i }));
    });
    setDragging(null); setDragOver(null);
  };

  // ── 工序頁（SequenceView）接線：工序=cats、日誌=pm_seqlogs ──
  const projectStart = settings?.projectStart || "2026-03-30";
  const CAT2WS = { pending:"pending", inprogress:"doing", done:"done", issue:"issue", hold:"wait" };
  const WS2CAT = { pending:"pending", doing:"inprogress", done:"done", issue:"issue", wait:"hold" };
  const _pad = (n)=>String(n).padStart(2,"0");
  const _toKey = (d)=>`${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
  const _weekDate = (w0, off) => { const d=new Date(projectStart+"T00:00:00"); d.setDate(d.getDate()+w0*7+off); return _toKey(d); };
  const _segOf = (o) => Array.isArray(o.segments) && o.segments.length ? o.segments.filter(s=>s.start&&s.end)
    : (o.ganttStart != null ? [{ start:_weekDate(o.ganttStart,0), end:_weekDate(o.ganttStart+(o.ganttDur||1),-1) }] : []);
  const seqItems = [];
  (cats || []).slice().sort((a,b)=>(a.order??0)-(b.order??0)).forEach(c => {
    seqItems.push({ id:c.id, name:c.name, status: CAT2WS[c.status] || "pending", segments: _segOf(c), isParent:true, urgent: !!c.urgent });
    (c.seqSubs || []).forEach(sub => seqItems.push({ id:`${c.id}::${sub.id}`, name:sub.name, status: CAT2WS[sub.status] || "pending", segments: _segOf(sub), isSub:true, parentId:c.id, urgent: !!sub.urgent }));
    // 總覽勾選「排入工序」的成本細項 → 同步成工序子項目（工序專屬狀態/排程存在 item.seq）
    (c.items || []).filter(it => it.inSeq).forEach(it => seqItems.push({ id:`${c.id}::ci::${it.id}`, name: it.name, status: CAT2WS[it.seq?.status] || "pending", segments: (it.seq?.segments) || [], isSub:true, parentId:c.id, urgent: !!(it.seq?.urgent), fromCost:true }));
  });
  const seqSaveLog = (l) => {
    if (l.id) commitSeqLogs(seqLogs.map(x => x.id===l.id ? { ...l, updated_at:new Date().toISOString(), updated_by: userName||"—" } : x));
    else commitSeqLogs([...seqLogs, { ...l, id: "sl-"+Math.random().toString(36).slice(2,8), author: userName||"—", created_at:new Date().toISOString() }]);
  };
  const seqDelLog = (id) => commitSeqLogs(seqLogs.filter(x => x.id !== id));
  const _updSub = (itemId, patch) => { const [cid,sid] = itemId.split("::"); setCats(prev => prev.map(c => c.id===cid ? { ...c, seqSubs:(c.seqSubs||[]).map(s => s.id===sid ? { ...s, ...patch } : s) } : c)); };
  const _updCost = (itemId, patch) => { const [cid,,iid] = itemId.split("::"); setCats(prev => prev.map(c => c.id===cid ? { ...c, items:(c.items||[]).map(it => it.id===iid ? { ...it, seq:{ ...(it.seq||{}), ...patch } } : it) } : c)); };
  const _updSeqSub = (itemId, patch) => itemId.includes("::ci::") ? _updCost(itemId, patch) : _updSub(itemId, patch);
  const _seqName = (itemId) => { try { const [cid, mid, iid] = String(itemId).split("::"); const c = (cats||[]).find(x=>x.id===cid); if (!c) return itemId||""; if (!mid) return c.name; if (mid === "ci") { const it = (c.items||[]).find(x=>x.id===iid); return c.name + "／" + (it?.name || iid); } const s = (c.seqSubs||[]).find(x=>x.id===mid); return c.name + "／" + (s?.name || mid); } catch(_) { return ""; } };
  const seqSetStatus = (itemId, wsKey) => { if (!canEditData) { denyEdit(); return; } const st = WS2CAT[wsKey]||"pending"; const lbl = { done:"完工", working:"施工中", problem:"有問題", pending:"待開工" }[st] || st; logAction("編輯", `改工序狀態「${_seqName(itemId)}」→${lbl}`, 4000); if (itemId.includes("::")) _updSeqSub(itemId, { status: st }); else setCats(prev => prev.map(c => c.id===itemId ? (st === "done" ? markCatDone(c) : { ...c, status: st }) : c)); };
  const seqSetSchedule = (itemId, segs) => { if (!canEditData) { denyEdit(); return; } logAction("編輯", `調整工序排程「${_seqName(itemId)}」`, 4000); if (itemId.includes("::")) _updSeqSub(itemId, { segments: segs }); else setCats(prev => prev.map(c => c.id===itemId ? { ...c, segments: segs } : c)); };
  const seqSetUrgent = (itemId, val) => { if (!canEditData) { denyEdit(); return; } logAction("編輯", `${val?"標記":"取消"}工序超急件「${_seqName(itemId)}」`, 4000); if (itemId.includes("::")) _updSeqSub(itemId, { urgent: val }); else setCats(prev => prev.map(c => c.id===itemId ? { ...c, urgent: val } : c)); };
  const seqReorder = (fromId, toId) => { if (!canEditData) { denyEdit(); return; } logAction("編輯", "調整工序順序", 4000); setCats(prev => { const arr = [...prev].sort((a,b)=>(a.order??0)-(b.order??0)); const fi = arr.findIndex(c=>c.id===fromId), ti = arr.findIndex(c=>c.id===toId); if (fi<0||ti<0||fi===ti) return prev; const [m] = arr.splice(fi,1); arr.splice(ti,0,m); return arr.map((c,i)=>({ ...c, order:i })); }); };
  const seqAddSub = (catId, name) => { if (!canEditData) { denyEdit(); return; } const n=(name||"").trim(); if(!n) return; logActivity("編輯", `新增工序子項「${n}」`); setCats(prev => prev.map(c => c.id===catId ? { ...c, seqSubs:[...(c.seqSubs||[]), { id:"ss-"+Math.random().toString(36).slice(2,7), name:n, status:"pending", segments:[] }] } : c)); };
  const seqDelSub = (itemId) => { if (!canEditData) { denyEdit(); return; } logActivity("編輯", "移除工序子項"); if (itemId.includes("::ci::")) { const [cid,,iid] = itemId.split("::"); setCats(prev => prev.map(c => c.id===cid ? { ...c, items:(c.items||[]).map(it => it.id===iid ? { ...it, inSeq:false } : it) } : c)); return; } const [cid,sid] = itemId.split("::"); setCats(prev => prev.map(c => c.id===cid ? { ...c, seqSubs:(c.seqSubs||[]).filter(s=>s.id!==sid) } : c)); };
  const seqSetProjectStart = (v) => { if (!canEditData) { denyEdit(); return; } const s = { ...(settings||{}), projectStart: v }; setSettings(s); saveSettings(s); };
  const seqUploadPhotos = async (files) => { const out=[]; for (const f of files) { try { const { url } = await uploadPhoto(f); out.push({ url, name: f.name || "檔案", isImage: !!(f.type || "").startsWith("image/") }); } catch(_){} } return out; };
  const seqAiTidy = async (f) => {
    const draft = [f.done && `已完成：${f.done}`, f.issue && `問題：${f.issue}`, f.next && `明日：${f.next}`].filter(Boolean).join("\n") || "（無草稿）";
    const reply = await callAI([{ role:"user", content:`請把以下工地日誌草稿整理成一段精簡通順的施工紀錄（繁體中文、一段話、不要條列、不要開場白）：\n${draft}` }], "你是工程現場記錄助理。", "tidy");
    return (reply||"").replace(/```[\s\S]*?```/g,"").trim();
  };
  const seqAiWeekly = async (weekLogs) => {
    const lines = weekLogs.map(l => `${l.date} ${seqItems.find(i=>i.id===l.itemId)?.name||""}：${l.done||l.next||""}${l.issue?`（問題：${l.issue}）`:""}`).join("\n") || "（本週無紀錄）";
    return await callAI([{ role:"user", content:`以下是本週各工序施工日誌，請產生給業主看的本週進度週報（繁體中文，淺顯，含：本週完成、進行中、問題/待決、下週預計、整體評估🟢/🟡/🔴）：\n${lines}` }], "你是餐廳裝修工程顧問，為業主寫週報。", "weekly");
  };

  const isMobile = useIsMobile();

  if (!cats) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", justifyContent: "center", height: "100vh", background: BG, color: SUB, fontFamily: "-apple-system,'PingFang TC','Noto Sans TC',system-ui,sans-serif", fontSize: 15 }}>
      <div>載入中…</div>
      <button onClick={() => window.location.reload()} style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, borderRadius: 8, padding: "8px 18px", fontSize: 14, cursor: "pointer" }}>太久沒反應？點此重新整理</button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "-apple-system,'PingFang TC','Noto Sans TC',system-ui,'Segoe UI',sans-serif", fontSize: 14, letterSpacing: 0.1 }}>
      {/* TOP NAV */}
      <TopNav view={view} setView={setView} saving={saving} totalEstimated={totalEstimated} totalPaid={totalPaid} doneCount={doneCount} catCount={cats.length} onAI={() => setShowGlobalAI(true)} userName={userName} isAdmin={isAdmin} stalledCount={stalledItems.length} onRoleClick={() => userName ? setShowAcctMenu(true) : setShowLogin(true)} onActivityLog={() => setShowActivityLog(true)} activityCount={activityLog.length} isMobile={isMobile} allowedSpaces={allowedSpaces} allowedViewPages={allowedViewPages} />

      {/* MAIN */}
      <div style={{ padding: isMobile ? "0 12px 84px" : "0 16px 80px" }}>
        {view === "kb" && (
          <KnowledgeBaseView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} userName={userName} />
        )}
        {view === "r360" && (
          <Review360View canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "fb" && (
          <FeedbackView canEdit={canEditData} requireLogin={denyEdit} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "quest" && (
          <QuestView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "poll" && (
          <PollView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "shop" && (
          <ShopView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "rank" && (
          <CrewRankView />
        )}
        {view === "owner" && settings && (
          <OwnerDashboard cats={displayCats} setCats={setCatsLogged} settings={settings} stalledItems={stalledItems} activityLog={activityLog} logActivity={logActivity} userName={userName} isAdmin={isAdmin} journal={journal} events={events} plans={plans} petty={petty} totalPaid={totalPaid} pettyInCats={true} />
        )}
        {view === "overview" && (
          <OverviewTable cats={displayCats} setCats={guardedSetCats} confirm={confirm} customCols={customCols} setCustomCols={canEditData ? commitCustomCols : null}
            onSelect={(cat) => { setSelectedCat(cat); setSelectedItem(null); }} dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
            trash={trash} trashItems={trashItems} restoreTrash={restoreTrash} commitTrash={commitTrash} petty={petty} setView={setView} />
        )}
        {view === "gantt" && (
          <SequenceView
            items={seqItems} logs={seqLogs} projectStart={projectStart} warnDays={3} canEdit={canEditData}
            onSaveLog={seqSaveLog} onDelLog={seqDelLog} onSetStatus={seqSetStatus} onSetSchedule={seqSetSchedule}
            onSetProjectStart={seqSetProjectStart} uploadPhotos={seqUploadPhotos} aiTidy={seqAiTidy} aiWeekly={seqAiWeekly}
            onReorder={seqReorder} onAddSub={seqAddSub} onDelSub={seqDelSub} onSetUrgent={seqSetUrgent}
          />
        )}
        {view === "tasks" && (
          <TaskCenter K={K} confirm={confirm} canEdit={canEditData} cats={cats} onLog={logActivity}
            onAddCat={(name) => guardedSetCats(prev => [...prev, { id: "cat-" + Date.now(), order: prev.length, name, budget: 0, status: "pending", items: [] }])} />
        )}
        {view === "conclusions" && (
          <Conclusions K={K} confirm={confirm} canEdit={canEditData} cats={cats} userName={userName} onLog={logActivity} />
        )}
        {view === "files" && (
          <PhotoLibraryView photos={photos} setPhotos={commitPhotos} cats={cats} canEdit={canEditFiles} userName={userName} requireLogin={denyEdit} confirm={confirm} />
        )}
        {view === "issues" && (
          <IssuesView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} onLog={logActivity} />
        )}
        {view === "compare" && (
          <CompareView canEdit={canEditFiles} requireLogin={denyEdit} onLog={logActivity} />
        )}
        {view === "finance" && CURRENT_SPACE === "finance" && (showMoney() ? (
          <FinanceView K={K} confirm={confirm} canEdit={canEditData} ReceiptUploader={ReceiptUploader} onLog={logActivity} />
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, margin: "8px 0" }}>🔒 財務內帳含金額，你沒有看金額的權限。</div>
        ))}
        {view === "petty" && (showMoney() ? (
          <PettyCashView petty={petty} setPetty={commitPetty} cats={cats} setCats={guardedSetCats} canEdit={canEditData} confirm={confirm} />
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, margin: "8px 0" }}>🔒 零用金含金額，你沒有看金額的權限。</div>
        ))}
        {/* ⚙ 設定：把 AI設定 / 群組 / 帳號 / 紀錄 整合成一頁，內含子分頁 */}
        {["advisor", "groups", "accounts", "audit", "vault", "history", "changelog", "usage"].includes(view) && (() => {
          const subs = [["advisor", "AI設定"], ["changelog", "更新"], ...(isAdmin ? [["groups", "群組"], ["accounts", "帳號"], ["audit", "紀錄"], ["history", "還原點"], ["usage", "用量"], ["vault", "金庫"]] : [])].filter(([k]) => k !== "advisor" || allowedViewPages == null || allowedViewPages.includes("advisor"));
          return (
            <div>
              {subs.length > 1 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 1100, margin: "0 auto 16px" }}>
                  {subs.map(([k, l]) => { const SubI = SUB_ICONS[k]; return (
                    <button key={k} onClick={() => setView(k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: `1px solid ${view === k ? PRIMARY : BORDER}`, background: view === k ? PRIMARY : "#fff", color: view === k ? "#fff" : TEXT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{SubI && <SubI size={14} strokeWidth={1.75} />}{l}</button>
                  ); })}
                </div>
              )}
              {view === "advisor" && settings && (
                <AdvisorSettingsView settings={settings} setSettings={guardedSetSettings} cats={cats} aiLog={aiLog} setAiLog={l => { if ((aiLog||[]).length && !(l||[]).length) logActivity("編輯", "清空 AI 顧問對話"); setAiLog(l); saveAILog(l); }} journal={journal} events={events} plans={plans} activityLog={activityLog} logActivity={logActivity} userName={userName} />
              )}
              {view === "changelog" && <ChangelogView />}
              {view === "groups" && isAdmin && (
                <GroupsView cats={cats} canEdit={canEditData} requireLogin={denyEdit} settings={settings} setSettings={guardedSetSettings} journal={journal} events={events} plans={plans} onLog={logActivity} />
              )}
              {view === "accounts" && isAdmin && (
                <AccountManager confirm={confirm} myId={profile?.id} roles={roles} commitRoles={commitRoles} onLog={logActivity} guestPerms={guestPerms} commitGuestPerms={commitGuestPerms} />
              )}
              {view === "audit" && isAdmin && (
                <AuditLogView activityLog={activityLog} confirm={confirm} onCommit={(l) => { setActivityLog(l); saveActivityLog(l); }} />
              )}
              {view === "history" && isAdmin && (
                <HistoryView K={K} confirm={confirm} snapshotData={snapshotData} cats={cats} petty={petty} />
              )}
              {view === "usage" && isAdmin && (
                <div style={{ maxWidth: 1000, margin: "0 auto" }}>
                  <div style={{ fontSize: 12.5, color: SUB, marginBottom: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 12px" }}>系統 AI／LINE bot 的用量與估算花費（從儀表板移到這裡，業主看不到帳單細節）。</div>
                  <BotUsagePanel />
                  <div style={{ marginTop: 16 }}><AIUsagePanel /></div>
                </div>
              )}
              {view === "vault" && isAdmin && (
                <VaultView onLog={logActivity} />
              )}
            </div>
          );
        })()}
      </div>

      {/* CATEGORY DETAIL PANEL */}
      {selectedCat && !selectedItem && (
        <CatPanel cat={selectedCat} cats={cats} setCats={guardedSetCats} onClose={() => setSelectedCat(null)} onSelectItem={(item) => setSelectedItem(item)} confirm={confirm} />
      )}

      {/* ITEM DETAIL PANEL */}
      {selectedCat && selectedItem && (
        <ItemPanel cat={selectedCat} item={selectedItem} cats={cats} setCats={guardedSetCats} onClose={() => setSelectedItem(null)} confirm={confirm} />
      )}

      {showActivityLog && <ActivityLogPanel activityLog={activityLog} onClose={() => setShowActivityLog(false)} />}
      {ConfirmDialog}
      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} onLogin={async (username, password) => {
          if (!supabase) return { error: "系統未設定登入服務，請聯絡管理員。" };
          const email = username.includes("@") ? username : `${username}@ground.local`;
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) return { error: "帳號或密碼錯誤，請再試一次。" };
          // 身分由 onAuthStateChange 自動帶入（profile/userName）；但那是非同步，登入紀錄要先抓名字再記，否則會變「系統」
          setShowLogin(false);
          let loginName = username;
          try { const { data: prof } = await supabase.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle(); loginName = prof?.display_name || username; } catch (_) {}
          logActivity("登入", "登入系統", loginName);
          return {};
        }} />
      )}
      {showAcctMenu && (
        <AccountMenu userName={userName} onClose={() => setShowAcctMenu(false)}
          onChangePassword={async () => {
            const np = window.prompt("輸入新密碼（至少 6 碼）：");
            if (np == null) return;
            if (np.length < 6) { alert("密碼至少 6 碼"); return; }
            const { error } = await supabase.auth.updateUser({ password: np });
            if (error) { alert("修改失敗：" + error.message); return; }
            alert("密碼已更新，下次登入請用新密碼。");
            setShowAcctMenu(false);
          }}
          onLogout={async () => { try { await supabase?.auth.signOut(); } catch(_){} setProfile(null); setUserName(null); setShowAcctMenu(false); }}
        />
      )}
      {/* GLOBAL AI */}
      {showGlobalAI && (
        <GlobalAIPanel chat={globalChat} setChat={setGlobalChat} onClose={() => setShowGlobalAI(false)} cats={cats} setCats={guardedSetCats} canEdit={canEdit} confirm={confirm} settings={settings} setSettings={guardedSetSettings} worklog={worklog} setWorklog={commitWorklog} />
      )}

      {/* 手機底部固定導覽 */}
      {isMobile && <BottomNav view={view} setView={setView} isAdmin={isAdmin} allowedViewPages={allowedViewPages} />}
    </div>
  );
}

// ── 夥伴中心：資料庫 / 知識庫（內外場 SOP、手冊、教學…）─────────────────────────
const KB_DEFAULT_CATS = ["內場", "外場", "通用", "教育訓練"];
const kbIcon = (d) => d.kind === "link" ? "🔗" : d.kind === "text" ? "📝" : (d.isImage ? "🖼️" : (/\.pdf$/i.test(d.name || "") ? "📕" : /\.(xls|xlsx|csv)$/i.test(d.name || "") ? "📊" : "📄"));
function KnowledgeBaseView({ canEdit, requireLogin, confirm, userName }) {
  const [docs, setDocs] = useState(null);
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("全部");
  const [edit, setEdit] = useState(null); // 正在編輯/新增的 doc
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const safety = setTimeout(() => setDocs(prev => prev === null ? [] : prev), 8000);
    (async () => {
      try { const r = await window.storage.get(K("kb_docs"), true); setDocs(r && r.value ? JSON.parse(r.value) : []); }
      catch (_) { setDocs([]); }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);

  const persist = async (list) => { try { const p = docs || []; auditLog(list.length > p.length ? "新增" : list.length < p.length ? "刪除" : "編輯", "夥伴中心・知識庫文件"); } catch (_) {} setDocs(list); try { await window.storage.set(K("kb_docs"), JSON.stringify(list), true); } catch (_) {} };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  const cats = [...new Set([...KB_DEFAULT_CATS, ...(docs || []).map(d => d.category).filter(Boolean)])];

  const blank = () => ({ id: "", category: KB_DEFAULT_CATS[0], title: "", kind: "link", url: "", name: "", content: "", tags: "", pinned: false });
  const openNew = () => { if (!guard()) return; setEdit(blank()); };
  const openEdit = (d) => { if (!guard()) return; setEdit({ ...d, tags: (d.tags || []).join(", ") }); };
  const saveDoc = () => {
    const e = edit; if (!e.title.trim()) { alert("請填標題"); return; }
    const doc = { id: e.id || "kb-" + Math.random().toString(36).slice(2, 8), category: e.category, title: e.title.trim(), kind: e.kind, url: e.url || "", name: e.name || "", isImage: !!e.isImage, content: e.content || "", tags: (e.tags || "").split(/[,，]/).map(t => t.trim()).filter(Boolean), pinned: !!e.pinned, updatedBy: userName || "—", updatedAt: new Date().toISOString() };
    const list = e.id ? (docs || []).map(d => d.id === e.id ? doc : d) : [doc, ...(docs || [])];
    persist(list); setEdit(null);
  };
  const delDoc = async (d) => { if (!guard()) return; if (await confirm(`刪除「${d.title}」？`)) persist((docs || []).filter(x => x.id !== d.id)); };
  const togglePin = (d) => { if (!guard()) return; persist((docs || []).map(x => x.id === d.id ? { ...x, pinned: !x.pinned } : x)); };
  const uploadFile = async (files) => {
    const f = (files || [])[0]; if (!f) return;
    setBusy(true);
    try { const { url } = await uploadPhoto(f); setEdit(e => ({ ...e, kind: "file", url, name: f.name, isImage: !!(f.type || "").startsWith("image/") })); }
    catch (er) { alert("上傳失敗：" + (er?.message || er)); }
    setBusy(false);
  };

  const filtered = (docs || [])
    .filter(d => catFilter === "全部" || d.category === catFilter)
    .filter(d => { if (!q.trim()) return true; const s = (d.title + " " + (d.tags || []).join(" ") + " " + (d.content || "")).toLowerCase(); return s.includes(q.trim().toLowerCase()); })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  if (docs === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const inputS = { width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, outline: "none", background: "#fff", color: TEXT };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>📚 資料庫</div>
        <div style={{ fontSize: 12.5, color: SUB }}>內外場 SOP・手冊・教學（{docs.length}）</div>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 搜尋標題／標籤…" style={{ ...inputS, width: 220, maxWidth: "50vw" }} />
        {canEdit && <button onClick={openNew} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>＋ 新增</button>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {["全部", ...cats].map(c => (
          <button key={c} onClick={() => setCatFilter(c)} style={{ border: `1px solid ${catFilter === c ? PRIMARY : BORDER}`, background: catFilter === c ? PRIMARY : "transparent", color: catFilter === c ? "#fff" : TEXT, borderRadius: 16, padding: "4px 12px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>{c}</button>
        ))}
      </div>
      {filtered.length === 0 && <div style={{ textAlign: "center", color: "#a3a3a3", padding: "50px 0", fontSize: 14 }}>{docs.length === 0 ? "還沒有資料，點「＋ 新增」開始建立。" : "沒有符合的資料。"}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {filtered.map(d => (
          <div key={d.id} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>{kbIcon(d)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: TEXT, wordBreak: "break-word" }}>{d.pinned && "📌 "}{d.title}</div>
                <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}><span style={{ background: "#eff6ff", color: "#92400e", borderRadius: 8, padding: "1px 7px" }}>{d.category}</span>{d.tags?.length > 0 && <span style={{ marginLeft: 6 }}>{d.tags.map(t => "#" + t).join(" ")}</span>}</div>
              </div>
            </div>
            {d.kind === "text" && d.content && <div style={{ fontSize: 13, color: "#4A4234", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 140, overflowY: "auto", background: "#FBF7EE", borderRadius: 8, padding: "8px 10px" }}>{d.content}</div>}
            {(d.kind === "link" || d.kind === "file") && d.url && <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#2E6FB0", textDecoration: "none", wordBreak: "break-all" }}>{d.kind === "file" ? `📎 ${d.name || "開啟檔案"}` : "🔗 開啟連結"}</a>}
            {canEdit && <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 12 }}>
              <button onClick={() => togglePin(d)} style={{ border: "none", background: "none", color: d.pinned ? ACCENT : SUB, cursor: "pointer", padding: 0 }}>{d.pinned ? "取消置頂" : "置頂"}</button>
              <button onClick={() => openEdit(d)} style={{ border: "none", background: "none", color: SUB, cursor: "pointer", padding: 0 }}>編輯</button>
              <button onClick={() => delDoc(d)} style={{ border: "none", background: "none", color: "#DC2626", cursor: "pointer", padding: 0 }}>刪除</button>
              <div style={{ flex: 1 }} /><span style={{ color: "#C8BCA0" }}>{d.updatedBy}</span>
            </div>}
          </div>
        ))}
      </div>

      {edit && (
        <div onClick={e => e.target === e.currentTarget && setEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 460, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 14 }}>{edit.id ? "編輯資料" : "新增資料"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>標題</div><input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} style={inputS} placeholder="例：外場點餐 SOP" /></div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>分類</div>
                  <input list="kb-cats" value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })} style={inputS} />
                  <datalist id="kb-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>類型</div>
                  <select value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })} style={inputS}>
                    <option value="link">🔗 連結</option><option value="file">📎 檔案</option><option value="text">📝 純文字</option>
                  </select>
                </div>
              </div>
              {edit.kind === "link" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>連結網址</div><input value={edit.url} onChange={e => setEdit({ ...edit, url: e.target.value })} style={inputS} placeholder="https://…" /></div>}
              {edit.kind === "file" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>檔案</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => fileRef.current?.click()} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>{busy ? "上傳中…" : "選擇檔案"}</button>
                  {edit.name && <span style={{ fontSize: 12, color: TEXT }}>📎 {edit.name}</span>}
                  <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => { uploadFile(e.target.files); e.target.value = ""; }} />
                </div></div>}
              {edit.kind === "text" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>內容</div><textarea value={edit.content} onChange={e => setEdit({ ...edit, content: e.target.value })} style={{ ...inputS, height: 140, resize: "vertical", fontFamily: "inherit" }} placeholder="直接輸入內容…" /></div>}
              <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>標籤（逗號分隔）</div><input value={edit.tags} onChange={e => setEdit({ ...edit, tags: e.target.value })} style={inputS} placeholder="例：點餐, 新人必讀" /></div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: TEXT, cursor: "pointer" }}><input type="checkbox" checked={edit.pinned} onChange={e => setEdit({ ...edit, pinned: e.target.checked })} />📌 置頂</label>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setEdit(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={saveDoc} disabled={busy} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 夥伴中心：360 評鑑（設計原型；正式版接 Auth+正規表+權限/匿名）─────────────────
const R360_DEFAULT_DIMS = ["工作態度", "團隊合作", "專業技能", "服務品質", "責任感", "學習成長"];
function Review360View({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [data, setData] = useState(null); // {dimensions, people, reviews}
  const [tab, setTab] = useState("fill"); // fill | result | setup
  const [me, setMe] = useState("");
  const [rate, setRate] = useState(null); // 正在評的對象 {revieweeId, scores, comment}
  const [resultId, setResultId] = useState("");

  useEffect(() => {
    const safety = setTimeout(() => setData(prev => prev || emptyR360()), 8000);
    (async () => {
      try { const r = await window.storage.get(K("kb_360"), true); const d = r && r.value ? JSON.parse(r.value) : null; const nd = normR360(d); setData(nd); setMe(meFromRoster(nd.people, userName)); }
      catch (_) { setData(emptyR360()); }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);
  function emptyR360() { return { dimensions: R360_DEFAULT_DIMS.map((l, i) => ({ id: "d" + i, label: l })), people: [], reviews: [] }; }
  function normR360(d) { if (!d) return emptyR360(); return { dimensions: d.dimensions?.length ? d.dimensions : emptyR360().dimensions, people: d.people || [], reviews: d.reviews || [] }; }
  const persist = async (next) => { try { auditLog("編輯", "夥伴中心・360 互評"); } catch (_) {} setData(next); try { await window.storage.set(K("kb_360"), JSON.stringify(next), true); } catch (_) {} };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };

  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const { dimensions, people, reviews } = data;
  const nameOf = (id) => people.find(p => p.id === id)?.name || "—";

  // 儲存一筆評鑑（同一人評同一人＝覆蓋）
  const submitRate = () => {
    if (!me) { alert("請先在上方選「我是誰」"); return; }
    const r = rate;
    const review = { id: "rv-" + me + "-" + r.revieweeId, reviewerId: me, revieweeId: r.revieweeId, scores: r.scores, comment: (r.comment || "").trim(), ts: new Date().toISOString() };
    const others = reviews.filter(x => !(x.reviewerId === me && x.revieweeId === r.revieweeId));
    persist({ ...data, reviews: [...others, review] });
    setRate(null);
  };
  const myReviewOf = (revId) => reviews.find(x => x.reviewerId === me && x.revieweeId === revId);

  // 結果彙整
  const agg = (revieweeId) => {
    const others = reviews.filter(x => x.revieweeId === revieweeId && x.reviewerId !== revieweeId);
    const self = reviews.find(x => x.reviewerId === revieweeId && x.revieweeId === revieweeId);
    const perDim = dimensions.map(dim => {
      const vals = others.map(r => Number(r.scores?.[dim.id])).filter(v => v > 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return { dim, avg, selfV: self ? Number(self.scores?.[dim.id]) || null : null, n: vals.length };
    });
    const allVals = others.flatMap(r => dimensions.map(d => Number(r.scores?.[d.id])).filter(v => v > 0));
    const overall = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : null;
    const comments = others.map(r => r.comment).filter(Boolean);
    return { perDim, overall, comments, count: others.length, hasSelf: !!self };
  };

  const card = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
  const subTab = (t, label) => <button key={t} onClick={() => setTab(t)} style={{ border: `1px solid ${tab === t ? PRIMARY : BORDER}`, background: tab === t ? PRIMARY : "transparent", color: tab === t ? "#fff" : TEXT, borderRadius: 8, padding: "7px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{label}</button>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>⭐ 360 評鑑</div>
        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>這是預覽版：用下方「我是誰」模擬身分、資料先存本機。正式版會接真帳號＋權限＋匿名保護。</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {subTab("fill", "📝 我要評")}{subTab("result", "📊 看結果")}{isAdmin && subTab("setup", "⚙ 設定")}
      </div>

      {tab === "fill" && (<>
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <CrewMe people={people} me={me} />
          {people.length === 0 && <span style={{ fontSize: 12, color: "#C2872E" }}>請先到「設定」加入夥伴名單</span>}
        </div>
        {me && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {people.map(p => { const done = !!myReviewOf(p.id); const isSelf = p.id === me; return (
            <button key={p.id} onClick={() => setRate({ revieweeId: p.id, scores: myReviewOf(p.id)?.scores || {}, comment: myReviewOf(p.id)?.comment || "" })}
              style={{ textAlign: "left", background: "#fff", border: `1px solid ${done ? "#3C8C3C" : BORDER}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#eff6ff", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{p.name?.[0] || "?"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{p.name}{isSelf && <span style={{ fontSize: 11, color: SUB }}> · 自評</span>}</div>
                <div style={{ fontSize: 11, color: SUB }}>{p.dept || "—"}</div>
              </div>
              <span style={{ fontSize: 12, color: done ? "#3C8C3C" : "#C8BCA0", fontWeight: 600 }}>{done ? "✓ 已評" : "待評"}</span>
            </button>
          ); })}
        </div>}
      </>)}

      {tab === "result" && (<>
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: SUB }}>看誰的結果：</span>
          <select value={resultId} onChange={e => setResultId(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px", fontSize: 14, background: "#fff", color: TEXT, minWidth: 140 }}>
            <option value="">— 選擇夥伴 —</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {resultId && (() => { const a = agg(resultId); return (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{nameOf(resultId)}</div>
              <div style={{ fontSize: 13, color: SUB }}>他評 {a.count} 人{a.hasSelf ? " · 含自評" : ""}</div>
              <div style={{ flex: 1 }} />
              {a.overall != null && <div style={{ fontSize: 22, fontWeight: 800, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{a.overall.toFixed(1)}<span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}> /5</span></div>}
            </div>
            {a.count === 0 && <div style={{ fontSize: 13, color: "#a3a3a3", padding: "10px 0" }}>還沒有人評過這位夥伴。</div>}
            {a.perDim.map(({ dim, avg, selfV, n }) => (
              <div key={dim.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", fontSize: 13, marginBottom: 4 }}><span style={{ color: TEXT, fontWeight: 600 }}>{dim.label}</span><div style={{ flex: 1 }} /><span style={{ color: ACCENT, fontFamily: "monospace", fontWeight: 700 }}>{avg != null ? avg.toFixed(1) : "—"}</span>{selfV != null && <span style={{ color: "#2E6FB0", marginLeft: 8, fontSize: 12 }}>自評 {selfV}</span>}</div>
                <div style={{ position: "relative", height: 8, background: "#f0f0f0", borderRadius: 4 }}>
                  <div style={{ width: `${(avg || 0) / 5 * 100}%`, height: "100%", background: ACCENT, borderRadius: 4, transition: "width .2s" }} />
                  {selfV != null && <div title="自評" style={{ position: "absolute", top: -2, left: `calc(${selfV / 5 * 100}% - 1px)`, width: 2, height: 12, background: "#2E6FB0" }} />}
                </div>
              </div>
            ))}
            {a.comments.length > 0 && <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8 }}>💬 匿名評語</div>
              {a.comments.map((c, i) => <div key={i} style={{ fontSize: 13, color: "#4A4234", background: "#FBF7EE", borderRadius: 8, padding: "8px 12px", marginBottom: 6, whiteSpace: "pre-wrap" }}>{c}</div>)}
            </div>}
            <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 12 }}>※ 正式版：評語匿名、評鑑者身分隱藏；少於設定人數不顯示結果以保護匿名。</div>
          </div>
        ); })()}
      </>)}

      {tab === "setup" && isAdmin && (<>
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 10 }}>評分面向</div>
          {dimensions.map(d => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <input value={d.label} onChange={e => persist({ ...data, dimensions: dimensions.map(x => x.id === d.id ? { ...x, label: e.target.value } : x) })} style={{ flex: 1, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "#fff", color: TEXT }} />
              <button onClick={() => { if (!guard()) return; persist({ ...data, dimensions: dimensions.filter(x => x.id !== d.id) }); }} style={{ border: "none", background: "none", color: "#DC2626", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          ))}
          <button onClick={() => { if (!guard()) return; persist({ ...data, dimensions: [...dimensions, { id: "d" + Date.now(), label: "新面向" }] }); }} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer", marginTop: 4 }}>＋ 新增面向</button>
        </div>
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 10 }}>夥伴名單（{people.length}）</div>
          <div style={{ display: "flex", gap: 8, fontSize: 10, color: SUB, marginBottom: 4, padding: "0 2px" }}><span style={{ flex: 1 }}>姓名</span><span style={{ width: 80 }}>部門</span><span style={{ width: 90 }}>層級</span><span style={{ width: 110 }}>登入帳號</span><span style={{ width: 20 }} /></div>
          {people.map(p => { const up = (k, v) => persist({ ...data, people: people.map(x => x.id === p.id ? { ...x, [k]: v } : x) }); return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <input value={p.name} onChange={e => up("name", e.target.value)} placeholder="姓名" style={{ flex: 1, minWidth: 90, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "#fff", color: TEXT }} />
              <input value={p.dept || ""} onChange={e => up("dept", e.target.value)} placeholder="部門" style={{ width: 80, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, background: "#fff", color: TEXT }} />
              <select value={p.role || "staff"} onChange={e => up("role", e.target.value)} title="層級＝權限：主管/管理員可管理" style={{ width: 90, border: `1px solid ${canManageRole(p.role) ? "#C2872E" : BORDER}`, borderRadius: 8, padding: "6px 6px", fontSize: 13, background: "#fff", color: TEXT }}>{CREW_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input value={p.account || ""} onChange={e => up("account", e.target.value)} placeholder="登入帳號" title="對應登入身分（例：goodmask77）" style={{ width: 110, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, background: "#fff", color: TEXT }} />
              <button onClick={() => { if (!guard()) return; confirm(`移除「${p.name}」？`).then(ok => ok && persist({ ...data, people: people.filter(x => x.id !== p.id) })); }} style={{ border: "none", background: "none", color: "#DC2626", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          ); })}
          <button onClick={() => { if (!guard()) return; persist({ ...data, people: [...people, { id: "p" + Date.now(), name: "", dept: "", role: "staff", account: "" }] }); }} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer", marginTop: 4 }}>＋ 新增夥伴</button>
          <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 8 }}>※ 層級＝權限：主管/管理員可新增關卡、發起投票、上架獎勵。登入帳號＝這個人登入後自動對應的身分（正式版接 Auth 後就不用選身分了）。</div>
        </div>
      </>)}

      {/* 評分彈窗 */}
      {rate && (() => { const p = people.find(x => x.id === rate.revieweeId); return (
        <div onClick={e => e.target === e.currentTarget && setRate(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 2 }}>評鑑：{p?.name}{p?.id === me ? "（自評）" : ""}</div>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>每個面向給 1–5 分</div>
            {dimensions.map(dim => (
              <div key={dim.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>{dim.label}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 2, 3, 4, 5].map(n => { const on = rate.scores[dim.id] === n; return (
                    <button key={n} onClick={() => setRate({ ...rate, scores: { ...rate.scores, [dim.id]: n } })} style={{ flex: 1, height: 38, borderRadius: 8, border: `1px solid ${on ? ACCENT : BORDER}`, background: on ? ACCENT : "#fff", color: on ? "#fff" : TEXT, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{n}</button>
                  ); })}
                </div>
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>評語（可留空）</div>
              <textarea value={rate.comment} onChange={e => setRate({ ...rate, comment: e.target.value })} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 9, fontSize: 14, height: 80, resize: "vertical", outline: "none", fontFamily: "inherit" }} placeholder="具體的觀察與建議…" />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setRate(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={submitRate} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>送出評鑑</button>
            </div>
          </div>
        </div>
      ); })()}
    </div>
  );
}

// ── 夥伴中心：回饋制度 + 積分 + 排行榜（設計原型）─────────────────────────────
const FB_POS_TAGS = ["服務暖心", "救火英雄", "執行力強", "細心可靠", "思慮周全", "帶人有耐心", "正能量", "神隊友", "出餐快又準", "臨危不亂"];
const FB_CON_TAGS = ["可多主動溝通", "記得多確認細節", "建議提早備料", "開會多分享想法"];
// 積分：給回饋+2、收到回饋+1、你給的回饋被按「幫到我」+5
function crewPointStats(items, people) {
  const m = {};
  people.forEach(p => { m[p.id] = { id: p.id, name: p.name, dept: p.dept, given: 0, received: 0, helpfulGot: 0, points: 0 }; });
  items.forEach(it => {
    if (m[it.fromId]) { m[it.fromId].given++; m[it.fromId].helpfulGot += (it.helpful?.length || 0); }
    if (m[it.toId]) m[it.toId].received++;
  });
  Object.values(m).forEach(s => { s.points = s.given * 2 + s.received * 1 + s.helpfulGot * 5; });
  return m;
}
async function loadCrewRoster() {
  try { const r = await window.storage.get(K("kb_360"), true); const d = r && r.value ? JSON.parse(r.value) : null; return d?.people || []; } catch (_) { return []; }
}

function FeedbackView({ canEdit, requireLogin, isAdmin, userName }) {
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState(null);
  const [me, setMe] = useState("");
  const [tab, setTab] = useState("give");
  const [draft, setDraft] = useState({ toId: "", tags: [], text: "", anon: false });
  const [wallFilter, setWallFilter] = useState("all"); // all | tome | byme

  useEffect(() => {
    const safety = setTimeout(() => setItems(prev => prev || []), 8000);
    (async () => {
      const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName));
      try { const rr = await window.storage.get(K("kb_feedback"), true); setItems(rr && rr.value ? JSON.parse(rr.value).items || [] : []); } catch (_) { setItems([]); }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);
  const persist = async (list) => { try { const p = items || []; auditLog(list.length > p.length ? "新增" : list.length < p.length ? "刪除" : "編輯", "夥伴中心・意見回饋"); } catch (_) {} setItems(list); try { await window.storage.set(K("kb_feedback"), JSON.stringify({ items: list }), true); } catch (_) {} };
  const nameOf = (id) => people.find(p => p.id === id)?.name || "—";
  if (items === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;

  const toggleTag = (t) => setDraft(d => ({ ...d, tags: d.tags.includes(t) ? d.tags.filter(x => x !== t) : [...d.tags, t] }));
  const submit = () => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    if (!me) { alert("請先選「我是誰」"); return; }
    if (!draft.toId) { alert("請選回饋對象"); return; }
    if (!draft.tags.length && !draft.text.trim()) { alert("至少選一個標籤或寫幾個字"); return; }
    const it = { id: "fb-" + Math.random().toString(36).slice(2, 8), fromId: me, toId: draft.toId, tags: draft.tags, text: draft.text.trim(), anon: draft.anon, ts: new Date().toISOString(), helpful: [] };
    persist([it, ...items]);
    setDraft({ toId: "", tags: [], text: "", anon: false });
    setTab("wall");
  };
  const toggleHelpful = (it) => {
    if (!me) { alert("請先選「我是誰」才能標記"); return; }
    const has = (it.helpful || []).includes(me);
    persist(items.map(x => x.id === it.id ? { ...x, helpful: has ? x.helpful.filter(h => h !== me) : [...(x.helpful || []), me] } : x));
  };

  const meSelect = <CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} />;
  const card = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
  const subTab = (t, l) => <button key={t} onClick={() => setTab(t)} style={{ border: `1px solid ${tab === t ? PRIMARY : BORDER}`, background: tab === t ? PRIMARY : "transparent", color: tab === t ? "#fff" : TEXT, borderRadius: 8, padding: "7px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{l}</button>;
  const tagChip = (t, on, onClick) => <button key={t} onClick={onClick} style={{ border: `1px solid ${on ? ACCENT : BORDER}`, background: on ? ACCENT : "#fff", color: on ? "#fff" : TEXT, borderRadius: 16, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>{t}</button>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>💬 回饋</div>
        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>讓正向、有建設性的回饋變習慣——給回饋得分、被按「幫到我」更高分，累積成回饋王。</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>{subTab("give", "✍ 給回饋")}{subTab("wall", "🧱 回饋牆")}</div>

      {tab === "give" && (
        <div style={card}>
          <div style={{ marginBottom: 12 }}>{meSelect}</div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 4 }}>給誰</div>
          <select value={draft.toId} onChange={e => setDraft({ ...draft, toId: e.target.value })} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, background: "#fff", color: TEXT, marginBottom: 12 }}>
            <option value="">— 選擇夥伴 —</option>
            {people.filter(p => p.id !== me).map(p => <option key={p.id} value={p.id}>{p.name}{p.dept ? `（${p.dept}）` : ""}</option>)}
          </select>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 6 }}>👍 正向標籤</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{FB_POS_TAGS.map(t => tagChip(t, draft.tags.includes(t), () => toggleTag(t)))}</div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 6 }}>💡 建設性建議</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{FB_CON_TAGS.map(t => tagChip(t, draft.tags.includes(t), () => toggleTag(t)))}</div>
          <textarea value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder="具體說說（可留空，例：那天尖峰你主動幫忙收尾，真的很救火）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 9, fontSize: 14, height: 70, resize: "vertical", outline: "none", fontFamily: "inherit", marginBottom: 10 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: TEXT, cursor: "pointer" }}><input type="checkbox" checked={draft.anon} onChange={e => setDraft({ ...draft, anon: e.target.checked })} />匿名給</label>
            <div style={{ flex: 1 }} />
            <button onClick={submit} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "9px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>送出回饋 ＋2分</button>
          </div>
        </div>
      )}

      {tab === "wall" && (<>
        <div style={{ ...card, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {meSelect}
          {me && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["all", "全部"], ["tome", `給我的${items.filter(x => x.toId === me).length ? "·" + items.filter(x => x.toId === me).length : ""}`], ["byme", "我給的"]].map(([k, l]) =>
              <button key={k} onClick={() => setWallFilter(k)} style={{ border: `1px solid ${wallFilter === k ? PRIMARY : BORDER}`, background: wallFilter === k ? PRIMARY : "transparent", color: wallFilter === k ? "#fff" : TEXT, borderRadius: 14, padding: "4px 12px", fontSize: 12.5, cursor: "pointer" }}>{l}</button>)}
          </div>}
        </div>
        {me && wallFilter === "tome" && <div style={{ fontSize: 12, color: SUB, margin: "-4px 2px 10px" }}>👇 別人給你的回饋，覺得有幫助就按「幫到我」，給予者會加分。</div>}
        {(() => { const list = items.filter(it => wallFilter === "all" || !me ? true : wallFilter === "tome" ? it.toId === me : it.fromId === me); return (<>
        {list.length === 0 && <div style={{ textAlign: "center", color: "#a3a3a3", padding: "40px 0", fontSize: 14 }}>{items.length === 0 ? "還沒有回饋，去「給回饋」開始吧。" : "這個篩選沒有回饋。"}</div>}
        {list.map(it => { const helped = (it.helpful || []).includes(me); const mine = it.toId === me; return (
          <div key={it.id} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: TEXT }}>{it.anon ? "匿名夥伴" : nameOf(it.fromId)}</span>
              <span style={{ color: SUB }}>→</span>
              <span style={{ fontWeight: 600, color: ACCENT }}>{nameOf(it.toId)}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "#C8BCA0" }}>{new Date(it.ts).toLocaleDateString("zh-TW")}</span>
            </div>
            {it.tags?.length > 0 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: it.text ? 8 : 0 }}>{it.tags.map(t => <span key={t} style={{ fontSize: 12, background: FB_CON_TAGS.includes(t) ? "#FFF7ED" : "#F0FDF4", color: FB_CON_TAGS.includes(t) ? "#9A5B12" : "#2E7D32", border: `1px solid ${FB_CON_TAGS.includes(t) ? "#FDE6C8" : "#C8E6C9"}`, borderRadius: 12, padding: "2px 9px" }}>{t}</span>)}</div>}
            {it.text && <div style={{ fontSize: 14, color: "#4A4234", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{it.text}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <button onClick={() => toggleHelpful(it)} disabled={!mine} title={mine ? "" : "只有收到回饋的本人能標記（選對應的『我是誰』）"} style={{ border: `1px solid ${helped ? "#3C8C3C" : BORDER}`, background: helped ? "#F0FDF4" : "#fff", color: helped ? "#3C8C3C" : (mine ? TEXT : "#C8BCA0"), borderRadius: 16, padding: "4px 12px", fontSize: 12.5, fontWeight: 600, cursor: mine ? "pointer" : "default" }}>👍 幫到我{(it.helpful?.length || 0) > 0 ? ` · ${it.helpful.length}` : ""}</button>
              {(it.helpful?.length || 0) > 0 && <span style={{ fontSize: 11, color: "#3C8C3C" }}>給予者 +{it.helpful.length * 5} 分</span>}
            </div>
          </div>
        ); })}
        </>); })()}
      </>)}
    </div>
  );
}

// 夥伴中心共用：讀寫 + 完整積分餘額（回饋 + 闖關 − 兌換）
const loadCrewJSON = async (key, def) => { try { const r = await window.storage.get(K(key), true); return r && r.value ? JSON.parse(r.value) : def; } catch (_) { return def; } };
const CREW_LABELS = { kb_quests: "夥伴中心・闖關任務", kb_polls: "夥伴中心・投票", kb_shop: "夥伴中心・獎勵商店", kb_feedback: "夥伴中心・意見回饋", kb_360: "夥伴中心・360 互評", kb_docs: "夥伴中心・知識庫" };
const saveCrewJSON = async (key, val) => { try { auditLog("編輯", CREW_LABELS[key] || ("夥伴中心・" + key)); } catch (_) {} try { await window.storage.set(K(key), JSON.stringify(val), true); } catch (_) {} };
function crewFullBalance(people, fbItems, questsData, shopData) {
  const fb = crewPointStats(fbItems, people); const m = {};
  people.forEach(p => { m[p.id] = fb[p.id]?.points || 0; });
  (questsData?.progress || []).forEach(pr => { if (pr.status === "completed") { const q = (questsData.quests || []).find(x => x.id === pr.questId); if (q && m[pr.userId] != null) m[pr.userId] += (q.points || 0); } });
  (shopData?.redemptions || []).forEach(rd => { if (rd.status !== "rejected" && m[rd.userId] != null) m[rd.userId] -= (rd.cost || 0); });
  return m;
}
// 夥伴中心層級／權限
const CREW_ROLES = [["staff", "基層"], ["lead", "組長"], ["manager", "主管"], ["admin", "管理員"]];
const roleLabel = (r) => (CREW_ROLES.find(x => x[0] === r) || ["staff", "基層"])[1];
const canManageRole = (r) => r === "manager" || r === "admin";
const meFromRoster = (people, userName) => (people.find(p => p.account && p.account === userName) || {}).id || "";
// 目前身分＝登入帳號對應的人（固定、不可切換，避免冒名頂替）
const CrewMe = ({ people, me }) => {
  const cur = people.find(p => p.id === me);
  if (!cur) return <div style={{ fontSize: 12.5, color: "#C2872E" }}>⚠ 你的登入帳號尚未綁定夥伴身分（到 360評鑑 → 設定，把你的「登入帳號」填到對應的人）。</div>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: SUB }}>身分</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{cur.name}{cur.dept ? `（${cur.dept}）` : ""}</span>
      <span style={{ fontSize: 11, background: canManageRole(cur.role) ? "#FEF3C7" : "#f0f0f0", color: canManageRole(cur.role) ? "#92400e" : SUB, borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>{roleLabel(cur.role)}</span>
    </div>
  );
};
const crewCard = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const crewProtoTitle = (emoji, t, sub) => (<><div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}><div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>{emoji} {t}</div><span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span></div>{sub && <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>{sub}</div>}</>);

// ── 闖關任務 ─────────────────────────────────────────────────────────────────
function QuestView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [data, setData] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  useEffect(() => { const s = setTimeout(() => setData(p => p || { quests: [], progress: [] }), 8000);
    (async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); setData(await loadCrewJSON("kb_quests", { quests: [], progress: [] })); })().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setData(n); saveCrewJSON("kb_quests", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const done = (qid) => (data.progress || []).some(p => p.questId === qid && p.userId === me && p.status === "completed");
  const countDone = (qid) => (data.progress || []).filter(p => p.questId === qid && p.status === "completed").length;
  const complete = (q) => { if (!me) { alert("尚未對應到名單身分"); return; } if (done(q.id)) return; persist({ ...data, progress: [...(data.progress || []), { questId: q.id, userId: me, status: "completed", ts: new Date().toISOString() }] }); };
  const saveQuest = () => { if (!ed.title.trim()) { alert("請填關卡名稱"); return; } const q = { id: ed.id || "q-" + Math.random().toString(36).slice(2, 7), title: ed.title.trim(), desc: ed.desc || "", points: Number(ed.points) || 0, active: ed.active !== false }; persist({ ...data, quests: ed.id ? data.quests.map(x => x.id === ed.id ? q : x) : [...data.quests, q] }); setEd(null); };
  return (
    <div>
      {crewProtoTitle("🎮", "闖關任務", "完成關卡得積分（正式版完成需組長核可、防自核）。")}
      <div style={{ ...crewCard, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} /><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ title: "", desc: "", points: 50, active: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增關卡</button>}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {data.quests.filter(q => q.active !== false || canManage).map(q => { const d = done(q.id); return (
          <div key={q.id} style={{ ...crewCard, marginBottom: 0, opacity: q.active === false ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><span style={{ fontSize: 22 }}>{d ? "✅" : "🎯"}</span><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{q.title}</div><div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{q.desc}</div></div><span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, whiteSpace: "nowrap" }}>+{q.points}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: SUB }}>已完成 {countDone(q.id)} 人</span><div style={{ flex: 1 }} />
              {canManage && <button onClick={() => guard() && setEd({ ...q })} style={{ border: "none", background: "none", color: SUB, fontSize: 12, cursor: "pointer" }}>編輯</button>}
              <button onClick={() => complete(q)} disabled={d} style={{ border: `1px solid ${d ? "#3C8C3C" : ACCENT}`, background: d ? "#F0FDF4" : ACCENT, color: d ? "#3C8C3C" : "#fff", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: d ? "default" : "pointer" }}>{d ? "✓ 已完成" : "完成挑戰"}</button>
            </div>
          </div>); })}
        {data.quests.length === 0 && <div style={{ color: "#a3a3a3", fontSize: 14, padding: "30px 0" }}>還沒有關卡{isAdmin ? "，點「＋ 新增關卡」" : ""}。</div>}
      </div>
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{ed.id ? "編輯關卡" : "新增關卡"}</div>
            <input value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="關卡名稱（例：完成新人訓練）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 8 }} />
            <textarea value={ed.desc} onChange={e => setEd({ ...ed, desc: e.target.value })} placeholder="說明" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, height: 60, resize: "vertical", marginBottom: 8, fontFamily: "inherit" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><span style={{ fontSize: 13, color: SUB }}>積分</span><input type="number" value={ed.points || ""} onChange={e => setEd({ ...ed, points: e.target.value })} style={{ width: 90, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /><label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={ed.active !== false} onChange={e => setEd({ ...ed, active: e.target.checked })} />啟用</label></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={saveQuest} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 投票（含各項投票王）──────────────────────────────────────────────────────
function PollView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [data, setData] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  useEffect(() => { const s = setTimeout(() => setData(p => p || { polls: [], votes: [] }), 8000);
    (async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); setData(await loadCrewJSON("kb_polls", { polls: [], votes: [] })); })().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setData(n); saveCrewJSON("kb_polls", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const nameOf = (id) => people.find(p => p.id === id)?.name || id;
  const myVote = (pid) => (data.votes || []).find(v => v.pollId === pid && v.voterId === me);
  const vote = (poll, optId) => { if (!me) { alert("尚未對應到名單身分"); return; } if (myVote(poll.id)) return; persist({ ...data, votes: [...(data.votes || []), { pollId: poll.id, voterId: me, choiceId: optId, ts: new Date().toISOString() }] }); };
  const tally = (poll) => { const c = {}; poll.options.forEach(o => c[o.id] = 0); (data.votes || []).filter(v => v.pollId === poll.id).forEach(v => { if (c[v.choiceId] != null) c[v.choiceId]++; }); const total = Object.values(c).reduce((a, b) => a + b, 0); const win = poll.options.slice().sort((a, b) => c[b.id] - c[a.id])[0]; return { c, total, win: total > 0 ? win : null }; };
  const savePoll = () => { if (!ed.title.trim()) { alert("請填主題"); return; } let opts = ed.usePeople ? people.map(p => ({ id: p.id, label: p.name })) : (ed.optText || "").split("\n").map(s => s.trim()).filter(Boolean).map((l, i) => ({ id: "o" + i, label: l })); if (opts.length < 2) { alert("至少要 2 個選項"); return; } const poll = { id: ed.id || "poll-" + Math.random().toString(36).slice(2, 7), title: ed.title.trim(), options: opts, anon: !!ed.anon, peoplePoll: !!ed.usePeople }; persist({ ...data, polls: ed.id ? data.polls.map(x => x.id === ed.id ? poll : x) : [...data.polls, poll] }); setEd(null); };
  const optLabel = (poll, oid) => poll.peoplePoll ? nameOf(oid) : (poll.options.find(o => o.id === oid)?.label || oid);
  return (
    <div>
      {crewProtoTitle("🗳", "投票", "一人一票（防灌票）；人物類投票會選出「投票王」。")}
      <div style={{ ...crewCard, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} /><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ title: "", optText: "", usePeople: false, anon: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 發起投票</button>}</div>
      {data.polls.length === 0 && <div style={{ color: "#a3a3a3", fontSize: 14, padding: "30px 0" }}>還沒有投票{isAdmin ? "，點「＋ 發起投票」" : ""}。</div>}
      {data.polls.map(poll => { const t = tally(poll); const voted = myVote(poll.id); return (
        <div key={poll.id} style={crewCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{poll.title}</div><div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: SUB }}>{t.total} 票</span></div>
          {poll.peoplePoll && t.win && <div style={{ fontSize: 13, color: "#B8860B", fontWeight: 700, marginBottom: 8 }}>👑 目前投票王：{optLabel(poll, t.win.id)}（{t.c[t.win.id]} 票）</div>}
          {poll.options.map(o => { const n = t.c[o.id] || 0; const pct = t.total ? Math.round(n / t.total * 100) : 0; const mine = voted?.choiceId === o.id; return (
            <div key={o.id} onClick={() => !voted && vote(poll, o.id)} style={{ position: "relative", border: `1px solid ${mine ? ACCENT : BORDER}`, borderRadius: 8, padding: "8px 12px", marginBottom: 6, cursor: voted ? "default" : "pointer", overflow: "hidden" }}>
              {voted && <div style={{ position: "absolute", inset: 0, width: pct + "%", background: mine ? "#eff6ff" : "#f5f5f5", zIndex: 0 }} />}
              <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center" }}><span style={{ fontSize: 14, color: TEXT, fontWeight: mine ? 700 : 500 }}>{optLabel(poll, o.id)}{mine && " ✓"}</span><div style={{ flex: 1 }} />{voted && <span style={{ fontSize: 13, color: SUB, fontVariantNumeric: "tabular-nums" }}>{n}（{pct}%）</span>}</div>
            </div>); })}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>{!voted && <span style={{ fontSize: 12, color: ACCENT }}>點選項投票</span>}{voted && <span style={{ fontSize: 12, color: "#3C8C3C" }}>✓ 已投</span>}<div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && confirm("刪除這個投票？").then(ok => ok && persist({ ...data, polls: data.polls.filter(x => x.id !== poll.id), votes: (data.votes || []).filter(v => v.pollId !== poll.id) }))} style={{ border: "none", background: "none", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>刪除</button>}</div>
        </div>); })}
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 440, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>發起投票</div>
            <input value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="主題（例：本月最佳服務）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 10 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, cursor: "pointer" }}><input type="checkbox" checked={ed.usePeople} onChange={e => setEd({ ...ed, usePeople: e.target.checked })} />選項用「夥伴名單」（選出投票王）</label>
            {!ed.usePeople && <textarea value={ed.optText} onChange={e => setEd({ ...ed, optText: e.target.value })} placeholder={"每行一個選項\n例：\n加開週會\n改善排班"} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, height: 90, resize: "vertical", marginBottom: 10, fontFamily: "inherit" }} />}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14, cursor: "pointer" }}><input type="checkbox" checked={ed.anon} onChange={e => setEd({ ...ed, anon: e.target.checked })} />匿名投票</label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={savePoll} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>發布</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 兌換商城 + 錢包 ───────────────────────────────────────────────────────────
function ShopView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [fb, setFb] = useState([]); const [quests, setQuests] = useState({ quests: [], progress: [] }); const [shop, setShop] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  const reload = async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); const f = await loadCrewJSON("kb_feedback", { items: [] }); setFb(f.items || []); setQuests(await loadCrewJSON("kb_quests", { quests: [], progress: [] })); setShop(await loadCrewJSON("kb_shop", { rewards: [], redemptions: [] })); };
  useEffect(() => { const s = setTimeout(() => setShop(p => p || { rewards: [], redemptions: [] }), 8000); reload().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setShop(n); saveCrewJSON("kb_shop", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (shop === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const balances = crewFullBalance(people, fb, quests, shop);
  const myBal = me ? (balances[me] || 0) : null;
  const redeem = (r) => { if (!me) { alert("尚未對應到名單身分"); return; } if ((balances[me] || 0) < r.cost) { alert("積分不足"); return; } if ((r.stock ?? 99) <= 0) { alert("已兌完"); return; } confirm(`用 ${r.cost} 分兌換「${r.name}」？`).then(ok => { if (!ok) return; persist({ ...shop, rewards: shop.rewards.map(x => x.id === r.id ? { ...x, stock: (x.stock ?? 99) - 1 } : x), redemptions: [...(shop.redemptions || []), { id: "rd-" + Math.random().toString(36).slice(2, 7), userId: me, rewardId: r.id, cost: r.cost, name: r.name, status: "requested", ts: new Date().toISOString() }] }); }); };
  const saveReward = () => { if (!ed.name.trim()) { alert("請填名稱"); return; } const r = { id: ed.id || "rw-" + Math.random().toString(36).slice(2, 7), name: ed.name.trim(), desc: ed.desc || "", cost: Number(ed.cost) || 0, stock: ed.stock === "" ? 99 : Number(ed.stock), active: ed.active !== false }; persist({ ...shop, rewards: ed.id ? shop.rewards.map(x => x.id === ed.id ? r : x) : [...shop.rewards, r] }); setEd(null); };
  const myRedemptions = (shop.redemptions || []).filter(r => r.userId === me);
  return (
    <div>
      {crewProtoTitle("🎁", "獎勵商城", "用累積的積分兌換獎勵（正式版兌換＝原子扣點、可稽核）。")}
      <div style={{ ...crewCard, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} />
        {me && <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 13, color: SUB }}>我的積分</span><span style={{ fontSize: 24, fontWeight: 800, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{myBal}</span><span style={{ fontSize: 12, color: SUB }}>分</span></div>}
        <div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ name: "", desc: "", cost: 100, stock: "", active: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增獎勵</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {shop.rewards.filter(r => r.active !== false || canManage).map(r => { const afford = me && (balances[me] || 0) >= r.cost; const out = (r.stock ?? 99) <= 0; return (
          <div key={r.id} style={{ ...crewCard, marginBottom: 0, opacity: r.active === false ? 0.55 : 1 }}>
            <div style={{ fontSize: 30, marginBottom: 4 }}>🎁</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{r.name}</div>
            <div style={{ fontSize: 12.5, color: SUB, marginBottom: 8, minHeight: 18 }}>{r.desc}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16, fontWeight: 800, color: ACCENT }}>{r.cost}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> 分</span></span><span style={{ fontSize: 11, color: SUB }}>{(r.stock ?? 99) >= 99 ? "" : `剩 ${r.stock}`}</span><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ ...r, stock: r.stock ?? "" })} style={{ border: "none", background: "none", color: SUB, fontSize: 12, cursor: "pointer" }}>編輯</button>}</div>
            <button onClick={() => redeem(r)} disabled={!afford || out} style={{ marginTop: 10, width: "100%", border: "none", background: out ? "#C8BCA0" : afford ? "#3C8C3C" : "#C8BCA0", color: "#fff", borderRadius: 8, padding: "8px", fontSize: 13.5, fontWeight: 600, cursor: afford && !out ? "pointer" : "default" }}>{out ? "已兌完" : afford ? "兌換" : "積分不足"}</button>
          </div>); })}
        {shop.rewards.length === 0 && <div style={{ color: "#a3a3a3", fontSize: 14, padding: "30px 0" }}>還沒有獎勵{isAdmin ? "，點「＋ 新增獎勵」" : ""}。</div>}
      </div>
      {me && myRedemptions.length > 0 && <div style={{ ...crewCard, marginTop: 14 }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>我的兌換紀錄</div>{myRedemptions.map(r => <div key={r.id} style={{ display: "flex", fontSize: 13, padding: "5px 0", borderTop: "1px solid #f5f5f5" }}><span>{r.name}</span><div style={{ flex: 1 }} /><span style={{ color: SUB }}>-{r.cost} 分 · {r.status === "requested" ? "處理中" : r.status}</span></div>)}</div>}
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{ed.id ? "編輯獎勵" : "新增獎勵"}</div>
            <input value={ed.name} onChange={e => setEd({ ...ed, name: e.target.value })} placeholder="獎勵名稱（例：星巴克咖啡券）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 8 }} />
            <input value={ed.desc} onChange={e => setEd({ ...ed, desc: e.target.value })} placeholder="說明（選填）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}><div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>所需積分</div><input type="number" value={ed.cost || ""} onChange={e => setEd({ ...ed, cost: e.target.value })} style={{ width: 100, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /></div><div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>庫存（空=不限）</div><input type="number" value={ed.stock || ""} onChange={e => setEd({ ...ed, stock: e.target.value })} style={{ width: 100, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /></div></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={saveReward} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function CrewRankView() {
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState(null);
  const [quests, setQuests] = useState({ quests: [], progress: [] });
  const [shop, setShop] = useState({ rewards: [], redemptions: [] });
  const [polls, setPolls] = useState({ polls: [], votes: [] });
  useEffect(() => {
    const safety = setTimeout(() => setItems(prev => prev || []), 8000);
    (async () => {
      setPeople(await loadCrewRoster());
      const f = await loadCrewJSON("kb_feedback", { items: [] }); setItems(f.items || []);
      setQuests(await loadCrewJSON("kb_quests", { quests: [], progress: [] }));
      setShop(await loadCrewJSON("kb_shop", { rewards: [], redemptions: [] }));
      setPolls(await loadCrewJSON("kb_polls", { polls: [], votes: [] }));
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);
  if (items === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const bal = crewFullBalance(people, items, quests, shop);
  const stats = Object.values(crewPointStats(items, people)).map(s => ({ ...s, balance: bal[s.id] || 0 }));
  const board = (title, sub, key, unit, color) => {
    const sorted = [...stats].sort((a, b) => b[key] - a[key]).filter(s => s[key] > 0).slice(0, 8);
    const medal = ["🥇", "🥈", "🥉"];
    return (
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{title}</div>
        <div style={{ fontSize: 11.5, color: SUB, marginBottom: 10 }}>{sub}</div>
        {sorted.length === 0 && <div style={{ fontSize: 13, color: "#a3a3a3", padding: "8px 0" }}>尚無資料</div>}
        {sorted.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: i ? "1px solid #f5f5f5" : "none" }}>
            <span style={{ width: 24, textAlign: "center", fontSize: i < 3 ? 16 : 13, color: SUB, fontWeight: 700 }}>{medal[i] || i + 1}</span>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#eff6ff", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.name?.[0] || "?"}</span>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>{s.name}</div><div style={{ fontSize: 11, color: SUB }}>{s.dept}</div></div>
            <span style={{ fontSize: 16, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{s[key]}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> {unit}</span></span>
          </div>
        ))}
      </div>
    );
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>🏆 排行榜</div>
        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>積分＝給回饋×2 ＋ 收到×1 ＋ 你的回饋被按「幫到我」×5。</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {board("🏅 積分王", "總積分（回饋＋闖關－兌換）", "balance", "分", ACCENT)}
        {board("💬 回饋王", "給出最多被肯定（幫到我）的回饋", "helpfulGot", "讚", "#3C8C3C")}
        {board("🌟 人氣王", "收到最多回饋", "received", "則", "#2E6FB0")}
      </div>
      {/* 各項投票王（人物類投票同步進排行榜）*/}
      {(() => {
        const pp = (polls.polls || []).filter(p => p.peoplePoll);
        if (!pp.length) return null;
        const medal = ["🥇", "🥈", "🥉"];
        return (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 10 }}>👑 各項投票王</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {pp.map(poll => {
                const c = {}; poll.options.forEach(o => c[o.id] = 0);
                (polls.votes || []).filter(v => v.pollId === poll.id).forEach(v => { if (c[v.choiceId] != null) c[v.choiceId]++; });
                const ranked = poll.options.map(o => ({ id: o.id, name: people.find(p => p.id === o.id)?.name || o.label, dept: people.find(p => p.id === o.id)?.dept || "", votes: c[o.id] })).filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 6);
                return (
                  <div key={poll.id} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 10 }}>{poll.title}</div>
                    {ranked.length === 0 && <div style={{ fontSize: 13, color: "#a3a3a3" }}>尚無投票</div>}
                    {ranked.map((s, i) => (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: i ? "1px solid #f5f5f5" : "none" }}>
                        <span style={{ width: 24, textAlign: "center", fontSize: i < 3 ? 16 : 13, color: SUB, fontWeight: 700 }}>{medal[i] || i + 1}</span>
                        <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#eff6ff", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.name?.[0] || "?"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>{s.name}</div><div style={{ fontSize: 11, color: SUB }}>{s.dept}</div></div>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#B8860B", fontVariantNumeric: "tabular-nums" }}>{s.votes}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> 票</span></span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── 問題集 / 待辦（資料來自 LINE Bot 寫入的 pm_issues）────────────────────────
const DEFAULT_TODO_CATS = ["工地問題", "採購交期", "待定案", "其他"];
const CAT_PALETTE = ["#C2872E", "#2E6FB0", "#8B5CF6", "#0E9F6E", "#DC2626", "#D97706", "#0891B2", "#6F6656"];
const colorForCat = (name, cats = []) => {
  const i = cats.indexOf(name);
  if (i >= 0) return CAT_PALETTE[i % CAT_PALETTE.length];
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
};
const catOf = (it) => it.category || (it.source === "todo" ? "其他" : "工地問題");
const FREQ_PRESETS = [["自動", 0], ["每天1次", 24], ["一天2次", 12], ["每2天", 48], ["每3天", 72]];
// ToDo 分頁的暖光閃動樣式（注入一次）
if (typeof document !== "undefined" && !document.getElementById("todo-glow-style")) {
  const s = document.createElement("style");
  s.id = "todo-glow-style";
  s.textContent = "@keyframes todoGlow{0%,100%{box-shadow:0 0 2px rgba(245,158,11,.35)}50%{box-shadow:0 0 14px 2px rgba(245,158,11,.85)}}.todo-glow{animation:todoGlow 1.5s ease-in-out infinite;border-color:#F59E0B !important;}@keyframes blackGlow{0%,100%{box-shadow:0 0 3px rgba(17,17,17,.45)}50%{box-shadow:0 0 16px 3px rgba(17,17,17,.9)}}.black-glow{animation:blackGlow 1.6s ease-in-out infinite;}";
  document.head.appendChild(s);
}
const freqLabel = (h) => { if (!h) return "自動（越近越密）"; const p = FREQ_PRESETS.find(([, v]) => v === h); if (p) return p[0]; if (h % 24 === 0) return `每${h / 24}天1次`; return `每${h}小時`; };
const twDateStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
const dueInfo = (due) => {
  if (!due) return null;
  const today = twDateStr();
  const d = Math.round((Date.parse(due + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  if (d < 0) return { txt: `逾期 ${-d} 天`, color: "#DC2626", bold: true };
  if (d === 0) return { txt: "今天到期", color: "#DC2626", bold: true };
  if (d <= 3) return { txt: `剩 ${d} 天`, color: "#C2872E", bold: true };
  return { txt: `${due}`, color: SUB, bold: false };
};

function IssuesView({ canEdit, requireLogin, confirm, onLog }) {
  const [issues, setIssues] = useState(null);
  const [cats, setCats] = useState(DEFAULT_TODO_CATS);
  const [filter, setFilter] = useState("open");
  const [catFilter, setCatFilter] = useState("全部");
  const [lightbox, setLightbox] = useState(null);
  const [editId, setEditId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [cfd, setCfd] = useState(1); // 自訂頻率：每 cfd 天
  const [cft, setCft] = useState(1); // …提醒 cft 次
  const [nd, setNd] = useState({ desc: "", category: "其他", due: "", track: true });

  useEffect(() => {
    // 保險：避免 Supabase 讀取卡住造成永久「載入中…」，最多 8 秒就先顯示空清單
    const safety = setTimeout(() => setIssues(prev => prev === null ? [] : prev), 8000);
    const withTimeout = (p, ms = 7000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
    (async () => {
      let iss = [];
      try { const r = await withTimeout(window.storage.get(K("pm_issues"), true)); iss = r && r.value ? JSON.parse(r.value) : []; } catch (_) {}
      setIssues(iss);
      let list = null;
      try { const c = await withTimeout(window.storage.get(K("pm_todo_cats"), true)); const arr = c && c.value ? JSON.parse(c.value) : null; if (Array.isArray(arr) && arr.length) list = arr; } catch (_) {}
      const base = list || DEFAULT_TODO_CATS;
      // 自我修復：項目用到、但分類清單沒有的分類（例如 D哥 從 LINE 新增的「未來想法」）→ 自動補進清單
      const orphans = [...new Set(iss.map(i => i.category).filter(c => c && !base.includes(c)))];
      const merged = orphans.length ? [...base, ...orphans] : base;
      setCats(merged);
      if (orphans.length) { try { await window.storage.set(K("pm_todo_cats"), JSON.stringify(merged), true); } catch (_) {} }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);

  const save = async (list) => {
    setIssues(list);
    try { await window.storage.set(K("pm_issues"), JSON.stringify(list), true); } catch (_) {}
  };
  const saveCats = async (list) => {
    setCats(list);
    try { await window.storage.set(K("pm_todo_cats"), JSON.stringify(list), true); } catch (_) {}
  };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  const patch = (id, fields) => { if (!guard()) return; save(issues.map(i => i.id === id ? { ...i, ...fields } : i)); };
  const toggleDone = async (it) => {
    if (!guard()) return;
    if (it.status === "done") { onLog?.("編輯", `重啟待辦「${(it.desc||"").slice(0,20)}」`); patch(it.id, { status: "open" }); return; }
    const ans = window.prompt("這件的結論／答案是？（可留空，直接標完成；按取消則不完成）", it.answer || "");
    if (ans === null) return; // 取消 → 不標完成
    onLog?.("編輯", `完成待辦「${(it.desc||"").slice(0,20)}」`);
    patch(it.id, { status: "done", track: false, answer: ans.trim() || it.answer || "" });
  };
  const del = async (id) => { if (!guard()) return; const t = (issues.find(i=>i.id===id)?.desc||"").slice(0,20); if (await confirm("刪除這筆事項？")) { onLog?.("刪除", `刪除待辦「${t}」`); save(issues.filter(i => i.id !== id)); } };
  const addNew = () => {
    if (!guard()) return;
    const desc = nd.desc.trim(); if (!desc) return;
    const entry = { id: "is-" + Math.random().toString(36).slice(2, 8), desc, category: nd.category, due: nd.due, remindEnd: "", track: !!nd.track, remindEvery: 0, status: "open", source: "todo", by: "App", ts: new Date().toISOString(), nudges: 0, answer: "", catName: "", catId: "", photoUrl: "" };
    onLog?.("新增", `新增待辦「${desc.slice(0,20)}」`);
    save([entry, ...issues]);
    setNd({ desc: "", category: cats[0] || "其他", due: "", track: true }); setShowAdd(false);
  };
  // 分類管理
  const addCat = () => { if (!guard()) return; const n = newCat.trim(); if (!n || cats.includes(n)) { setNewCat(""); return; } onLog?.("新增", `新增待辦分類「${n}」`); saveCats([...cats, n]); setNewCat(""); };
  const renameCat = (old, val) => { const n = val.trim(); if (!n || (cats.includes(n) && n !== old)) return; onLog?.("編輯", `待辦分類改名「${old}」→「${n}」`); saveCats(cats.map(c => c === old ? n : c)); save(issues.map(i => catOf(i) === old ? { ...i, category: n } : i)); };
  const delCat = async (c) => { if (!guard()) return; const used = issues.filter(i => catOf(i) === c).length; if (used && !(await confirm(`「${c}」還有 ${used} 筆事項，刪除分類後它們會歸到「其他」。確定刪除？`))) return; onLog?.("刪除", `刪除待辦分類「${c}」`); saveCats(cats.filter(x => x !== c)); if (used) save(issues.map(i => catOf(i) === c ? { ...i, category: "其他" } : i)); if (catFilter === c) setCatFilter("全部"); };

  if (issues === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const open = issues.filter(i => i.status !== "done");
  let shown = filter === "open" ? open : issues;
  if (catFilter !== "全部") shown = shown.filter(i => catOf(i) === catFilter);
  // 待處理：依交期排序（有交期且早的在前）
  shown = [...shown].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (b.status === "done" && a.status !== "done") return -1;
    const ad = a.due || "9999", bd = b.due || "9999";
    return ad.localeCompare(bd);
  });
  const inp = { padding: "6px 8px", borderRadius: 7, border: `1px solid ${BORDER}`, fontSize: 13, background: "#fff", color: TEXT };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>⚠️ 事項 / 待辦 / 問題</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{open.length} 項待處理</div>
        <button onClick={() => setShowAdd(s => !s)} style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${ACCENT}`, fontSize: 12.5, cursor: "pointer", background: showAdd ? ACCENT : "transparent", color: showAdd ? "#fff" : ACCENT, fontWeight: 600 }}>＋ 新增事項</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[["open", "待處理"], ["all", "全部"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${BORDER}`, fontSize: 12.5, cursor: "pointer", background: filter === k ? ACCENT : "transparent", color: filter === k ? "#fff" : SUB, fontWeight: filter === k ? 700 : 500 }}>{l}</button>
          ))}
        </div>
      </div>

      {/* 分類篩選 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {["全部", ...cats].map(c => {
          const on = catFilter === c; const col = c === "全部" ? TEXT : colorForCat(c, cats);
          return <button key={c} onClick={() => setCatFilter(c)} style={{ padding: "4px 12px", borderRadius: 20, border: `1px solid ${on ? col : BORDER}`, fontSize: 12, cursor: "pointer", background: on ? col : "transparent", color: on ? "#fff" : SUB, fontWeight: on ? 700 : 500 }}>{c}</button>;
        })}
        <button onClick={() => setShowCatMgr(s => !s)} title="編輯分類" style={{ padding: "4px 10px", borderRadius: 20, border: `1px dashed ${BORDER}`, fontSize: 12, cursor: "pointer", background: showCatMgr ? SURFACE : "transparent", color: SUB }}>✎ 分類</button>
      </div>

      {/* 分類管理 */}
      {showCatMgr && (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, color: SUB, marginBottom: 10 }}>編輯分類：改名直接打字、按 🗑 刪除（底下可新增）。改名/刪除會同步更新已記事項。</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cats.map(c => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorForCat(c, cats), flexShrink: 0 }} />
                <input defaultValue={c} onBlur={e => renameCat(c, e.target.value)} style={{ ...inp, flex: "0 1 220px" }} />
                <span style={{ fontSize: 11.5, color: SUB }}>{issues.filter(i => catOf(i) === c).length} 筆</span>
                <button onClick={() => delCat(c)} style={{ padding: "4px 9px", borderRadius: 7, border: `1px solid ${BORDER}`, background: "transparent", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>🗑</button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <input value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === "Enter" && addCat()} placeholder="新增分類名稱…" style={{ ...inp, flex: "0 1 220px" }} />
              <button onClick={addCat} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: ACCENT, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>＋ 新增分類</button>
            </div>
          </div>
        </div>
      )}

      {/* 新增表單 */}
      {showAdd && (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={nd.desc} onChange={e => setNd({ ...nd, desc: e.target.value })} placeholder="要記什麼？例：訂製家具交期確認" style={{ ...inp, flex: "1 1 260px" }} />
          <select value={nd.category} onChange={e => setNd({ ...nd, category: e.target.value })} style={inp}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <label style={{ fontSize: 12.5, color: SUB }}>交期 <input type="date" value={nd.due} onChange={e => setNd({ ...nd, due: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={nd.track} onChange={e => setNd({ ...nd, track: e.target.checked })} />🔔 盯到我回</label>
          <button onClick={addNew} style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: ACCENT, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>記下</button>
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          {filter === "open" ? "🎉 目前沒有待處理的事項" : "尚無記錄"}
          <div style={{ fontSize: 12, marginTop: 8 }}>在 LINE 跟 D哥 說「幫我記…」「追一下…」，或按上面「＋ 新增事項」</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                {["事項", "分類", "交期", "狀態", "操作"].map((h, i) => (
                  <th key={h} style={{ textAlign: i >= 3 ? "center" : "left", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: SUB, borderBottom: `1.5px solid ${BORDER}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(it => {
                const cat = catOf(it); const di = it.status !== "done" ? dueInfo(it.due) : null; const editing = editId === it.id;
                const tdS = { padding: "9px 10px", fontSize: 13, color: TEXT, borderBottom: `1px solid ${BORDER}`, verticalAlign: "top" };
                const done = it.status === "done";
                return (
                  <Fragment key={it.id}>
                    <tr style={{ opacity: done ? 0.55 : 1 }}>
                      <td style={tdS}>
                        <div style={{ display: "flex", gap: 8 }}>
                          {it.photoUrl && <img src={it.photoUrl} alt="" onClick={() => setLightbox(it.photoUrl)} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, cursor: "zoom-in", flexShrink: 0 }} />}
                          <div>
                            <div style={{ fontWeight: 500, lineHeight: 1.45, textDecoration: done ? "line-through" : "none" }}>{it.desc}</div>
                            {it.answer && <div style={{ fontSize: 12, color: "#3C8C3C", marginTop: 3 }}>✔ {it.answer}</div>}
                            {it.catName && <span style={{ fontSize: 10.5, background: ACCENT_SOFT, color: ACCENT, borderRadius: 5, padding: "1px 6px", fontWeight: 600, display: "inline-block", marginTop: 4 }}>{it.catName}</span>}
                          </div>
                        </div>
                      </td>
                      <td style={tdS}>{(() => { const col = colorForCat(cat, cats); return <span style={{ fontSize: 11.5, background: col + "22", color: col, borderRadius: 6, padding: "2px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{cat}</span>; })()}</td>
                      <td style={tdS}>{it.due ? <span style={{ fontSize: 12.5, color: di ? di.color : SUB, fontWeight: di && di.bold ? 700 : 500, whiteSpace: "nowrap" }}>{it.due}{di && di.txt !== it.due ? ` · ${di.txt}` : ""}</span> : <span style={{ color: SUB }}>—</span>}</td>
                      <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 12, color: done ? "#3C8C3C" : "#C2872E", fontWeight: 600 }}>{done ? "✅ 已解決" : "🔴 待處理"}</div>
                        {!done && it.track && <div style={{ fontSize: 11, color: "#C2872E", marginTop: 2 }}>🔔{it.nudges ? `已提醒${it.nudges}次` : "追蹤中"}</div>}
                      </td>
                      <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                        <div style={{ display: "inline-flex", gap: 5 }}>
                          <button onClick={() => toggleDone(it)} title={done ? "重開" : "完成/給答案"} style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${BORDER}`, background: done ? "transparent" : "#EAF6EA", color: done ? SUB : "#3C8C3C", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{done ? "↩" : "✅"}</button>
                          <button onClick={() => setEditId(editing ? null : it.id)} title="編輯" style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${editing ? ACCENT : BORDER}`, background: editing ? ACCENT : "transparent", color: editing ? "#fff" : SUB, fontSize: 12, cursor: "pointer" }}>⚙️</button>
                          <button onClick={() => del(it.id)} title="刪除" style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${BORDER}`, background: "transparent", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                    {editing && (
                      <tr>
                        <td colSpan={5} style={{ padding: "12px 14px", background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
                          {/* 內容可編輯 */}
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 11.5, color: SUB, marginBottom: 4 }}>內容</div>
                            <textarea defaultValue={it.desc} onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.desc) patch(it.id, { desc: v }); }} rows={2} style={{ ...inp, width: "100%", resize: "vertical", lineHeight: 1.5 }} />
                          </div>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>分類 <select value={cats.includes(cat) ? cat : ""} onChange={e => patch(it.id, { category: e.target.value })} style={inp}>{!cats.includes(cat) && <option value="">{cat}</option>}{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>交期 <input type="date" value={it.due || ""} onChange={e => patch(it.id, { due: e.target.value })} style={inp} /></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>提醒終止日 <input type="date" value={it.remindEnd || ""} onChange={e => patch(it.id, { remindEnd: e.target.value })} style={inp} /></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={it.track !== false} onChange={e => patch(it.id, { track: e.target.checked })} />🔔 主動追蹤</label>
                          </div>
                          {/* 提醒頻率視覺化 */}
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${BORDER}` }}>
                            <div style={{ fontSize: 11.5, color: SUB, marginBottom: 6 }}>提醒頻率　<span style={{ color: TEXT, fontWeight: 600 }}>目前：{freqLabel(it.remindEvery || 0)}</span></div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              {FREQ_PRESETS.map(([label, h]) => {
                                const on = (it.remindEvery || 0) === h;
                                return <button key={label} onClick={() => patch(it.id, { remindEvery: h })} style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${on ? ACCENT : BORDER}`, fontSize: 12, cursor: "pointer", background: on ? ACCENT : "#fff", color: on ? "#fff" : SUB, fontWeight: on ? 700 : 500 }}>{label}</button>;
                              })}
                              <span style={{ width: 1, height: 18, background: BORDER, margin: "0 2px" }} />
                              <span style={{ fontSize: 12, color: SUB }}>自訂：每</span>
                              <input type="number" min={1} value={cfd} onChange={e => setCfd(Math.max(1, +e.target.value || 1))} style={{ ...inp, width: 52 }} />
                              <span style={{ fontSize: 12, color: SUB }}>天</span>
                              <input type="number" min={1} value={cft} onChange={e => setCft(Math.max(1, +e.target.value || 1))} style={{ ...inp, width: 52 }} />
                              <span style={{ fontSize: 12, color: SUB }}>次</span>
                              <button onClick={() => patch(it.id, { remindEvery: Math.max(1, Math.round((cfd * 24) / cft)) })} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: TEXT, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>套用</button>
                            </div>
                            <div style={{ fontSize: 11, color: SUB, marginTop: 6 }}>「自動」＝越接近交期提醒越密集、時間不固定（不易被忽略）；自訂則照你設定的頻率準時提醒。需開啟「🔔 主動追蹤」或設定交期才會提醒。</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
          <img src={lightbox} alt="" style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}

// ── LINE 群組管理（D哥所在的所有群：設權限 + 每日彙報開關）────────────────────
// pm_group_seen：D哥自動登記的群清單（名稱/最近活躍/則數，由 bot 寫）
// pm_bot_groups：每個群的設定（mode/綁定工程/彙報開關，由這頁寫）
function GroupsView({ cats, canEdit, requireLogin, settings, setSettings, journal, events, plans, onLog }) {
  const [seen, setSeen] = useState(null);
  const [cfg, setCfg] = useState({});
  const [saving, setSaving] = useState(false);
  const updSettings = (k, v) => setSettings && setSettings({ ...(settings || {}), [k]: v });

  useEffect(() => {
    (async () => {
      try {
        const s = await window.storage.get(K("pm_group_seen"), true);
        const c = await window.storage.get(K("pm_bot_groups"), true);
        setSeen(s && s.value ? JSON.parse(s.value) : {});
        setCfg(c && c.value ? JSON.parse(c.value) : {});
      } catch { setSeen({}); setCfg({}); }
    })();
  }, []);

  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  const persist = async (next) => {
    setCfg(next); setSaving(true);
    onLog?.("編輯", "調整 LINE 群組設定");
    try { await window.storage.set(K("pm_bot_groups"), JSON.stringify(next), true); } catch (_) {}
    setSaving(false);
  };
  const effMode = (gid) => { const c = cfg[gid] || {}; return c.mode || (gid === DEFAULT_LINE_GROUP ? "internal" : (c.catId ? "vendor" : "locked")); };
  const effDigest = (gid) => (cfg[gid]?.digest !== false);
  const setMode = (gid, mode) => { if (!guard()) return; const c = { ...(cfg[gid] || {}) }; c.mode = mode; if (mode !== "vendor") { delete c.catId; delete c.catName; } persist({ ...cfg, [gid]: c }); };
  const setVendorCat = (gid, catId) => { if (!guard()) return; const cat = (cats || []).find(x => x.id === catId); persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), mode: "vendor", catId, catName: cat ? cat.name : "" } }); };
  const toggleDigest = (gid) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), digest: !effDigest(gid) } }); };
  const effMonitor = (gid) => (cfg[gid]?.monitor === true);
  const toggleMonitor = (gid) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), monitor: !effMonitor(gid) } }); };
  const effChat = (gid) => cfg[gid]?.chat || (effMode(gid) === "internal" ? "normal" : "quiet");
  const setChat = (gid, val) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), chat: val } }); };
  const renameGroup = (gid, cur) => { if (!guard()) return; const n = window.prompt("這個群的顯示名稱（D哥抓不到名字時可手動命名）", cur || ""); if (n === null) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), name: n.trim() || undefined } }); };
  const removeGroup = (gid) => {
    if (!guard()) return;
    if (!window.confirm("從清單移除這個群？\n（若 D哥 還在群裡，下次有人講話會再自動出現；只有「已被移出/解散」的死群才會真正消失）")) return;
    const ns = { ...seen }; delete ns[gid]; setSeen(ns);
    try { window.storage.set(K("pm_group_seen"), JSON.stringify(ns), true); } catch (_) {}
    const nc = { ...cfg }; delete nc[gid]; persist(nc);
  };

  if (seen === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;

  // 永遠把內部群放進清單（即使還沒有新訊息）
  const ids = Array.from(new Set([DEFAULT_LINE_GROUP, ...Object.keys(seen), ...Object.keys(cfg)]));
  ids.sort((a, b) => {
    const am = effMode(a) === "internal" ? 0 : 1, bm = effMode(b) === "internal" ? 0 : 1;
    if (am !== bm) return am - bm;
    return (seen[b]?.lastSeen || "").localeCompare(seen[a]?.lastSeen || "");
  });
  const MODE_COLOR = { internal: ACCENT, vendor: "#2E6FB0", locked: SUB };
  const fmtWhen = (iso) => { if (!iso) return "—"; const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); if (days <= 0) return "今天"; if (days === 1) return "昨天"; return `${days}天前`; };
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: SUB, borderBottom: `1.5px solid ${BORDER}`, whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 13, color: TEXT, borderBottom: `1px solid ${BORDER}`, verticalAlign: "middle" };
  const selStyle = { padding: "4px 6px", borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 12.5, background: SURFACE, color: TEXT, cursor: "pointer" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 6px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>💬 LINE 群組</div>
        <div style={{ fontSize: 12.5, color: SUB }}>D哥所在 {ids.length} 個群{saving ? " · 儲存中…" : ""}</div>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 14, lineHeight: 1.6 }}>
        <b style={{ color: ACCENT }}>內部群</b>＝自己人，可查預算金額全部工程；<b style={{ color: "#2E6FB0" }}>廠商群</b>＝只回它那項工程進度，<b style={{ color: ACCENT }}>絕不洩漏金額</b>（要選綁定工程）；<b style={{ color: SUB }}>鎖定</b>＝只閒聊。外群一律「叫名字才回話」。<br />
        <b style={{ color: "#B45309" }}>每日彙報</b>＝每晚 8:00 把重點整理私訊你（一天一次）；<b style={{ color: "#DC2626" }}>即時監控</b>＝有重要訊息（變更／缺失／金額／交期／安全…）<b>當下就私訊你</b>。名字抓不到時，點群名旁 ✎ 可手動命名。
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: 12, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead>
            <tr style={{ background: SURFACE }}>
              <th style={th}>群組</th>
              <th style={th}>類型</th>
              <th style={th}>回覆程度</th>
              <th style={th}>綁定工程</th>
              <th style={{ ...th, textAlign: "center" }}>每日彙報</th>
              <th style={{ ...th, textAlign: "center" }}>即時監控</th>
              <th style={{ ...th, textAlign: "right" }}>最近 · 則數</th>
            </tr>
          </thead>
          <tbody>
            {ids.map(gid => {
              const s = seen[gid] || {}; const mode = effMode(gid);
              const isDefault = gid === DEFAULT_LINE_GROUP;
              const name = (cfg[gid]?.name) || s.name || (isDefault ? "瑞光路337（內部群）" : gid);
              const isRawId = /^[CRU][0-9a-f]{32}$/.test(name);
              const dg = effDigest(gid); const mon = effMonitor(gid);
              return (
                <tr key={gid}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: MODE_COLOR[mode], flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: isRawId ? SUB : TEXT, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={isRawId ? "D哥抓不到群名，點 ✎ 手動命名" : name}>{isRawId ? "（未命名群）" : name}</span>
                      <button onClick={() => renameGroup(gid, isRawId ? "" : name)} title="改顯示名稱" style={{ border: "none", background: "none", cursor: "pointer", color: isRawId ? ACCENT : SUB, fontSize: 12, padding: 0 }}>✎</button>
                      {!isDefault && <button onClick={() => removeGroup(gid)} title="從清單移除（死群清理）" style={{ border: "none", background: "none", cursor: "pointer", color: isRawId ? "#DC2626" : SUB, fontSize: 12, padding: 0 }}>🗑</button>}
                    </div>
                  </td>
                  <td style={td}>
                    <select value={mode} onChange={e => setMode(gid, e.target.value)} style={{ ...selStyle, fontWeight: 600, color: MODE_COLOR[mode] }}>
                      <option value="internal">內部群</option>
                      <option value="vendor">廠商群</option>
                      <option value="locked">鎖定</option>
                    </select>
                  </td>
                  <td style={td}>
                    <select value={effChat(gid)} onChange={e => setChat(gid, e.target.value)} title="安靜=只有叫它才回；正常=有正事才回、不亂聊；活潑=正事會回＋偶爾俏皮接話" style={selStyle}>
                      <option value="quiet">🤫 安靜</option>
                      <option value="normal">🙂 正常</option>
                      <option value="lively">😄 活潑</option>
                    </select>
                  </td>
                  <td style={td}>
                    {mode === "vendor" ? (
                      <span>
                        <select value={cfg[gid]?.catId || ""} onChange={e => setVendorCat(gid, e.target.value)} style={{ ...selStyle, borderColor: cfg[gid]?.catId ? BORDER : ACCENT }}>
                          <option value="">— 請選 —</option>
                          {(cats || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        {!cfg[gid]?.catId && <span style={{ color: ACCENT, fontSize: 11, marginLeft: 6 }}>⚠️未綁</span>}
                      </span>
                    ) : <span style={{ color: SUB }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => toggleDigest(gid)} title="每晚 8:00 整理重點私訊給你" style={{ width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${dg ? "#3C8C3C" : BORDER}`, cursor: "pointer", background: dg ? "#3C8C3C" : "transparent", color: "#fff", fontSize: 14, lineHeight: 1, fontWeight: 700 }}>{dg ? "✓" : ""}</button>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => toggleMonitor(gid)} title="有重要訊息(變更/缺失/金額/交期/安全…)當下就私訊你" style={{ width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${mon ? "#DC2626" : BORDER}`, cursor: "pointer", background: mon ? "#DC2626" : "transparent", color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>{mon ? "🔔" : ""}</button>
                  </td>
                  <td style={{ ...td, textAlign: "right", color: SUB, fontSize: 12, whiteSpace: "nowrap" }}>{fmtWhen(s.lastSeen)} · {s.count || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 10, lineHeight: 1.6 }}>
        新群只要 D哥 在裡面、有人講話或貼圖，就會自動列進來。設定即時生效。
      </div>
      {/* LINE 通知設定（從 AI設定 整合過來）*/}
      {settings && (
        <div style={{ marginTop: 22 }}>
          <LineNotifySettings settings={settings} upd={updSettings} cats={cats} journal={journal} events={events} plans={plans} />
        </div>
      )}
    </div>
  );
}

// ── 估價單比價（在 App 上傳多份 PDF/圖 → callAI 解析 → 對比表）─────────────────
const _normName = (s) => String(s || "").replace(/[\s（）()【】\[\].·、，,。-]/g, "").toLowerCase();
function _buildCompareRows(ests) {
  const map = new Map(); // 正規化名稱相同才視為同品項（保守，不亂配對）
  ests.forEach(e => (e.items || []).forEach(it => {
    const key = _normName(it.name);
    if (!key) return;
    if (!map.has(key)) map.set(key, { label: it.name, prices: {} });
    map.get(key).prices[e.id] = Number(it.unitPrice) || 0;
  }));
  return [...map.values()].filter(r => Object.keys(r.prices).length >= 2);
}
function _fileToB64(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

function CompareView({ canEdit, requireLogin, onLog }) {
  const [ests, setEsts] = useState(null);
  const [busy, setBusy] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try { const r = await window.storage.get(K("pm_estimates"), true); setEsts(r && r.value ? JSON.parse(r.value) : []); } catch { setEsts([]); }
      try { const a = await window.storage.get(K("pm_estimates_an"), true); const v = a && a.value ? JSON.parse(a.value) : null; setAnalysis(v && v.rows ? v : null); } catch (_) {}
    })();
  }, []);
  // 估價單一變動就清掉舊分析（避免對不上）
  const save = async (list) => {
    setEsts(list); setAnalysis(null);
    try { await window.storage.set(K("pm_estimates"), JSON.stringify(list), true); await window.storage.set(K("pm_estimates_an"), "null", true); } catch (_) {}
  };

  const runAnalysis = async () => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    onLog?.("編輯", `執行比價分析（${ests.length} 份估價單）`);
    setAnalyzing(true);
    try {
      const forAI = ests.map(e => ({ vendor: e.vendor, total: e.total, items: (e.items || []).map(i => ({ name: i.name, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice })) }));
      const prompt = `你是專業的工程採購／標單比價分析師。以下是 ${ests.length} 份估價單的解析結果：\n${JSON.stringify(forAI)}\n\n請做專業比價分析，只回 JSON、不要其他文字：\n{\n "rows":[{"item":"標準化品項名稱","prices":{"<廠商名>":單價數字或null},"note":"差異備註(可空)"}],\n "missing":[{"vendor":"廠商名","items":["這家沒列、但別家有的品項"]}],\n "gapReason":"一句話：總價差的主因（例：晟弘多含結構支架與設備、發霸未含安裝）",\n "summary":"2-4 句：各家範圍／品質／優劣差異與風險",\n "recommend":"建議選哪家＋理由＋簽約前要向廠商確認／追問的重點"\n}\n規則：rows 要把語意相同的品項對齊在同一列（例「戶外P2.5 LED」與「LED螢幕」視為同一項），各家對應單價填入、沒有就 null；prices 的 key 用上面給的廠商名稱原文；金額只放數字。繁體中文，務實精準。`;
      const reply = await callAI([{ role: "user", content: prompt }], "你是專業工程標單比價分析師，只輸出 JSON。", "compare");
      const clean = reply.replace(/```json|```/gi, "").trim();
      let a = null;
      try { a = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)); } catch (_) {}
      if (a && a.rows) { setAnalysis(a); try { await window.storage.set(K("pm_estimates_an"), JSON.stringify(a), true); } catch (_) {} }
      else setAnalysis({ rows: [], summary: "（分析失敗，請重試）", recommend: "" });
    } catch (e) { setAnalysis({ rows: [], summary: "（分析失敗：" + (e?.message || e) + "）", recommend: "" }); }
    setAnalyzing(false);
  };
  const getP = (row, vendor) => {
    if (!row.prices) return null;
    if (row.prices[vendor] != null) return row.prices[vendor];
    const k = Object.keys(row.prices).find(k => _normName(k) === _normName(vendor));
    return k ? row.prices[k] : null;
  };

  const onPick = async (files) => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    const arr = Array.from(files || []); if (!arr.length) return;
    const added = [];
    for (const f of arr) {
      setBusy(`解析中：${f.name}…`);
      try {
        const b64 = await _fileToB64(f);
        const isPdf = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
        const block = isPdf
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
          : { type: "image", source: { type: "base64", media_type: f.type || "image/jpeg", data: b64 } };
        const prompt = `這是一份工程估價單／報價單。抽出資訊，只回 JSON、不要其他文字：{"vendor":"廠商名稱","total":總額數字,"items":[{"name":"品項","qty":數量,"unit":"單位","unitPrice":單價數字}]}。看不到的：文字留空字串、數字留0；金額只放數字。`;
        const reply = await callAI([{ role: "user", content: [block, { type: "text", text: prompt }] }], "你是工程估價單解析助理，只輸出 JSON。", "import");
        const clean = reply.replace(/```json|```/gi, "").trim();
        let parsed = { vendor: "", total: 0, items: [] };
        try { parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)); } catch (_) {}
        added.push({ id: "es-" + Math.random().toString(36).slice(2, 8), file: f.name, vendor: parsed.vendor || f.name, total: Number(parsed.total) || 0, items: Array.isArray(parsed.items) ? parsed.items : [], ts: new Date().toISOString() });
      } catch (e) {
        added.push({ id: "es-" + Math.random().toString(36).slice(2, 8), file: f.name, vendor: f.name, total: 0, items: [], error: String(e?.message || e) });
      }
    }
    setBusy("");
    if (added.length) onLog?.("新增", `上傳比價估價單 ${added.length} 份（${added.map(a=>a.vendor).filter(Boolean).slice(0,3).join("、")}）`);
    save([...(ests || []), ...added]);
  };

  const remove = (id) => { if (!canEdit) { requireLogin && requireLogin(); return; } const v = (ests||[]).find(e=>e.id===id)?.vendor || "—"; onLog?.("刪除", `刪除比價估價單「${v}」`); save(ests.filter(e => e.id !== id)); };

  if (ests === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const sorted = [...ests].sort((a, b) => (a.total || 0) - (b.total || 0));
  const lowest = sorted.length ? (sorted.find(e => e.total > 0)?.total || 0) : 0;
  const highest = sorted.length ? Math.max(...ests.map(e => e.total || 0)) : 0;

  if (!showMoney()) return <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, margin: "8px 0" }}>🔒 比價頁含報價金額，你沒有看金額的權限。</div>;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 16px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>📊 估價單比價</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{ests.length} 份</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={e => { onPick(e.target.files); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} style={{ background: ACCENT, border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>{busy ? busy : "＋ 上傳估價單"}</button>
        </div>
      </div>

      {ests.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          上傳 2 份以上估價單（PDF／圖片）開始比價
          <div style={{ fontSize: 12, marginTop: 8 }}>D哥 會解析每份的廠商／總額／品項，自動排序並對比</div>
        </div>
      ) : (
        <>
          {/* 總額對比 */}
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginBottom: 10 }}>💰 總額對比（低→高）</div>
            {sorted.map((e, idx) => {
              const diff = (e.total || 0) - lowest;
              const pct = lowest > 0 ? Math.round(diff / lowest * 100) : 0;
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: idx < sorted.length - 1 ? `1px solid #f5f5f5` : "none" }}>
                  <span style={{ fontSize: 15 }}>{idx === 0 && e.total > 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "・"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: TEXT, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.vendor}</div>
                    <div style={{ fontSize: 10.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.file}{e.error ? " ⚠️ 解析失敗" : ""}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: idx === 0 && e.total > 0 ? "#3C8C3C" : TEXT }}>{fmt(e.total)}</div>
                    {diff > 0 && <div style={{ fontSize: 10.5, color: "#C2872E" }}>+{fmt(diff)}（+{pct}%）</div>}
                  </div>
                  <button onClick={() => remove(e.id)} title="移除" style={{ border: "none", background: "none", color: SUB, cursor: "pointer", fontSize: 15 }}>✕</button>
                </div>
              );
            })}
            {highest > lowest && lowest > 0 && (
              <div style={{ fontSize: 12.5, color: "#3C8C3C", marginTop: 10, fontWeight: 600 }}>💡 選最低（{sorted[0].vendor}）比最高省 {fmt(highest - lowest)}</div>
            )}
          </div>

          {/* AI 專業比價分析 */}
          {ests.length >= 2 && (
            <div style={{ marginBottom: 14 }}>
              {!analysis ? (
                <button onClick={runAnalysis} disabled={analyzing} style={{ width: "100%", background: PRIMARY, border: "none", color: "#fff", borderRadius: 10, padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: analyzing ? "wait" : "pointer" }}>
                  {analyzing ? "🔍 AI 分析中…（對齊品項、解釋價差、給建議）" : "🔍 產生 AI 比價分析"}
                </button>
              ) : (
                <>
                  {analysis.gapReason && (
                    <div style={{ background: "#FFF7ED", border: "1px solid #FDE6C8", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: "#9A5B12", lineHeight: 1.6 }}>
                      <b>💡 價差主因：</b>{analysis.gapReason}
                    </div>
                  )}
                  {analysis.summary && (
                    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: TEXT, lineHeight: 1.7 }}>
                      <b style={{ color: ACCENT }}>📋 分析：</b>{analysis.summary}
                    </div>
                  )}
                  {analysis.recommend && (
                    <div style={{ background: "#EAF6EA", border: "1px solid #BFE3BF", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: "#235C23", lineHeight: 1.7 }}>
                      <b>✅ 建議：</b>{analysis.recommend}
                    </div>
                  )}
                  {Array.isArray(analysis.missing) && analysis.missing.some(m => (m.items || []).length) && (
                    <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 12.5, color: "#B43838", lineHeight: 1.7 }}>
                      <b>⚠️ 各家未列項目（可能漏報或不含）：</b>
                      {analysis.missing.filter(m => (m.items || []).length).map((m, i) => <div key={i}>・<b>{m.vendor}</b>：{m.items.join("、")}</div>)}
                    </div>
                  )}
                  {Array.isArray(analysis.rows) && analysis.rows.length > 0 && (
                    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, overflowX: "auto" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginBottom: 10 }}>📦 逐項單價對比（AI 對齊）</div>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 360 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 8px", color: SUB, borderBottom: `1px solid ${BORDER}`, whiteSpace: "nowrap" }}>品項</th>
                            {ests.map(e => <th key={e.id} style={{ textAlign: "right", padding: "6px 8px", color: SUB, borderBottom: `1px solid ${BORDER}`, whiteSpace: "nowrap", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>{e.vendor}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.rows.map((r, ri) => {
                            const vals = ests.map(e => getP(r, e.vendor)).filter(v => v > 0);
                            const min = vals.length ? Math.min(...vals) : 0;
                            return (
                              <tr key={ri}>
                                <td style={{ padding: "6px 8px", color: TEXT, borderBottom: `1px solid #f5f5f5` }}>{r.item}{r.note ? <span style={{ color: SUB, fontSize: 11 }}> · {r.note}</span> : ""}</td>
                                {ests.map(e => {
                                  const v = getP(r, e.vendor);
                                  const isMin = v > 0 && v === min && vals.length > 1;
                                  return <td key={e.id} style={{ textAlign: "right", padding: "6px 8px", fontFamily: "monospace", borderBottom: `1px solid #f5f5f5`, color: isMin ? "#3C8C3C" : (v == null ? "#C0392B" : TEXT), fontWeight: isMin ? 700 : 400, background: isMin ? "#EAF6EA" : "transparent" }}>{v != null ? fmt(v) : "未列"}</td>;
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div style={{ fontSize: 11, color: SUB, marginTop: 8, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <span>※ 由 AI 對齊各家品項；金額以原估價單為準，重要數字請再核對。</span>
                        <button onClick={runAnalysis} disabled={analyzing} style={{ border: "none", background: "none", color: ACCENT, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>{analyzing ? "分析中…" : "↻ 重新分析"}</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── BOTTOM NAV (手機) ───────────────────────────────────────────────────────
function BottomNav({ view, setView, isAdmin, allowedViewPages }) {
  const pageVisible = (v) => v === "settings" || !allowedViewPages || allowedViewPages.includes(v) || v === "owner";
  const tabs = (conf().tabs || [["owner", "儀表板", "📊"], ["overview", L("overview"), "📋"], ["tasks", "任務", "✅"], ["gantt", L("gantt"), "📅"], ["conclusions", "結論", "📌"], ["files", "檔案庫", "📁"], ...(conf().showCost ? [["petty", "零用金", "💵"]] : []), ["compare", "比價", "⚖️"], ...((isAdmin || pageVisible("advisor")) ? [["settings", "設定", "⚙"]] : [])]).filter(([v]) => !conf().hideTabs.includes(v) && pageVisible(v));
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: 60, background: "rgba(255,255,255,0.96)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderTop: `1px solid ${BORDER}`, boxShadow: "0 -2px 14px rgba(0,0,0,0.08)", display: "flex", zIndex: 350, paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map(([v, l, icon]) => {
        const on = v === "settings" ? ["settings", "advisor", "groups", "accounts", "audit", "vault"].includes(view) : view === v;
        return (
          <button key={v} onClick={() => setView(v === "settings" ? "advisor" : v)} title={l} className={v === "issues" && !on ? "todo-glow" : undefined} style={{ flex: 1, minHeight: 44, border: "none", borderRadius: v === "issues" ? 10 : 0, background: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer", color: on ? ACCENT : (v === "issues" ? "#D97706" : SUB), fontWeight: on ? 700 : (v === "issues" ? 700 : 500), padding: 0 }}>
            <span style={{ fontSize: 19, lineHeight: 1, filter: on ? "none" : "grayscale(0.4) opacity(0.85)" }}>{icon}</span>
            <span style={{ fontSize: 10.5 }}>{l}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────────
function useConfirm() {
  const [state, setState] = useState(null);
  // confirm(msg) 或 confirm(msg, { title, confirmLabel, danger, lines })
  const confirm = (msg, opts = {}) => new Promise(resolve => setState({ msg, resolve, ...opts }));
  const danger = state ? (state.danger !== false) : true; // 預設危險(刪除)；批次變更等傳 danger:false
  const label = state ? (state.confirmLabel || (danger ? "確定刪除" : "確定執行")) : "";
  // 若傳 lines 陣列 → 條列；否則把 msg 依換行拆行顯示
  const lines = state ? (state.lines || String(state.msg).split("\n")) : [];
  const Dialog = state ? (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={e => { if (e.target === e.currentTarget) { state.resolve(false); setState(null); } }}>
      <div style={{ background: "#FBF7EE", border: "1px solid #e5e5e5", borderRadius: 14, padding: "20px 20px 16px", maxWidth: 460, width: "100%", maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        {state.title && <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15", marginBottom: 10 }}>{state.title}</div>}
        <div style={{ fontSize: 14, color: "#211C15", lineHeight: 1.7, overflowY: "auto", marginBottom: 18 }}>
          {lines.length > 1
            ? lines.map((ln, i) => <div key={i} style={ln.trim() === "" ? { height: 6 } : { padding: "1px 0", display: "flex", gap: 6, alignItems: "flex-start" }}>{ln.trim() && <><span style={{ color: "#a3a3a3", flexShrink: 0 }}>·</span><span style={{ wordBreak: "break-word" }}>{ln.replace(/^[・·]\s*/, "")}</span></>}</div>)
            : <div style={{ textAlign: "center" }}>{state.msg}</div>}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => { state.resolve(false); setState(null); }} style={{ padding: "9px 18px", background: "#e5e5e5", border: "1px solid #e5e5e5", borderRadius: 8, color: "#4A4234", cursor: "pointer", fontSize: 14 }}>取消</button>
          <button onClick={() => { state.resolve(true); setState(null); }} style={{ padding: "9px 22px", background: danger ? "#eff6ff" : "#3C8C3C", border: danger ? "1px solid rgba(193,58,34,0.25)" : "none", borderRadius: 8, color: danger ? "#DC2626" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>{label}</button>
        </div>
      </div>
    </div>
  ) : null;
  return { confirm, Dialog };
}

// ── KPI CARD WITH TOOLTIP ────────────────────────────────────────────────────
function KPICard({ label, val, color, tip, bg, bar }) {
  const [show, setShow] = useState(false);
  return (
    <div
      style={{ background: bg || SURFACE, border: `1px solid ${BORDER}`, borderLeft: bar ? `3px solid ${bar}` : `1px solid ${BORDER}`, borderRadius: 9, padding: "6px 11px", position: "relative", cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(s => !s)}
    >
      <div style={{ fontSize: 11, color: SUB, marginBottom: 2, display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
        {label}
        <span style={{ fontSize: 8, color: "#CDC3AC", border: "1px solid #CDC3AC", borderRadius: "50%", width: 11, height: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>?</span>
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 16, fontWeight: 600, color, letterSpacing: -0.3 }}>{val}</div>
      {show && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, background: PRIMARY, border: "none", borderRadius: 8, padding: "9px 11px", fontSize: 12, color: "#e5e5e5", zIndex: 300, whiteSpace: "normal", width: 240, lineHeight: 1.6, boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
          {tip}
        </div>
      )}
    </div>
  );
}

// ── TOP NAV ───────────────────────────────────────────────────────────────────
function TopNav({ view, setView, saving, totalEstimated, totalPaid, doneCount, catCount, onAI, userName, isAdmin, stalledCount, onRoleClick, onActivityLog, activityCount, isMobile, allowedSpaces, allowedViewPages }) {
  const totalUnpaid = totalEstimated - totalPaid;
  const payPct = totalEstimated > 0 ? Math.round(totalPaid / totalEstimated * 100) : 0;
  const spaceVisible = (id) => !allowedSpaces || allowedSpaces.includes(id);
  const pageVisible = (v) => v === "settings" || !allowedViewPages || allowedViewPages.includes(v) || v === "owner"; // 儀表板一律可見；設定永遠可見(內含子分頁各自控管)
  const SETTINGS_GRP = ["settings", "advisor", "groups", "accounts", "audit", "vault", "history", "changelog", "usage"];
  const tabActive = (v) => v === "settings" ? SETTINGS_GRP.includes(view) : view === v;
  return (
    <div style={{ background: HEAD_BG, borderBottom: `1px solid ${HEAD_LINE}`, padding: isMobile ? "10px 14px 0" : "16px 22px 0", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 10 : 12, flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0, order: 0 }}>
          <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 800, color: BRAND, lineHeight: 1, letterSpacing: -1 }}>GROUN:D</div>
          {!isMobile && <div style={{ fontSize: 9.5, color: HEAD_SUB, letterSpacing: 2.5, textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>Construction Project Tracker</div>}
        </div>
        {/* 工作空間切換 */}
        <div style={{ flexShrink: 0, order: isMobile ? 1 : 0 }}>
          <select value={CURRENT_SPACE} onChange={(e) => switchSpace(e.target.value)} title="切換工作空間（各空間資料獨立）"
            style={{ border: `1px solid ${HEAD_LINE}`, background: HEAD_CHIP, color: "#fff", borderRadius: 8, padding: isMobile ? "5px 8px" : "7px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer", outline: "none" }}>
            {SPACES.filter(s => spaceVisible(s.id)).map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </select>
        </div>
        {/* KPI cards inline（手機改 2×2、整列獨佔一行；夥伴中心等空間隱藏）*/}
        {!conf().hideKpi && (() => {
          const kpis = showMoney() ? [
            { label: "預估總額", val: fmt(totalEstimated), color: "#1e40af", bg: "#eff6ff", bar: "#2563eb", tip: "各細項「數量×單價」依稅別換算含稅後加總＝總預算" },
            { label: "已付總額", val: totalPaid > 0 ? fmt(totalPaid) : "尚未付款", color: totalPaid > 0 ? "#15803d" : SUB, bg: "#f0fdf4", bar: "#16a34a", tip: `各細項「已付金額」加總。付款進度 ${payPct}%` },
            { label: "未付總額", val: fmt(totalUnpaid), color: totalUnpaid < 0 ? "#DC2626" : "#b45309", bg: "#fffbeb", bar: totalUnpaid < 0 ? "#dc2626" : "#d97706", tip: totalUnpaid < 0 ? "已付超過預估（溢付）" : "預估總額 − 已付總額＝尚需支付" },
            { label: "完工項目", val: `${doneCount} / ${catCount}`, color: TEXT, bg: "#fafafa", bar: "#737373", tip: "狀態標示為「完工」的大項數" },
          ] : [
            { label: `${L("cat")}數`, val: String(catCount), color: TEXT, bg: "#fafafa", bar: "#737373", tip: `目前空間的${L("cat")}數` },
            { label: "完工", val: `${doneCount} / ${catCount}`, color: "#15803d", bg: "#f0fdf4", bar: "#16a34a", tip: `狀態為「完工」的${L("cat")}` },
          ];
          return (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? `repeat(${Math.min(kpis.length,2)},1fr)` : `repeat(${kpis.length},minmax(110px,1fr))`, gap: 8, flex: isMobile ? "1 1 100%" : (showMoney() ? 1 : "0 1 auto"), minWidth: isMobile ? 0 : (showMoney() ? 360 : 0), order: isMobile ? 2 : 0 }}>
            {kpis.map(k => <KPICard key={k.label} label={k.label} val={k.val} color={k.color} tip={k.tip} bg={k.bg} bar={k.bar} />)}
          </div>
          );
        })()}
        {/* actions（手機改 icon-only，保留 title 提示）*/}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, order: isMobile ? 1 : 0, marginLeft: isMobile ? "auto" : 0 }}>
          {saving && <div style={{ fontSize: 11, color: HEAD_SUB }}>同步中…</div>}
          {stalledCount > 0 && (
            <div title={`${stalledCount} 項卡關`} style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, padding: "4px 10px", fontSize: 12, color: "#DC2626", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }} onClick={() => setView && setView("overview")}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: "#DC2626" }} />{stalledCount}
            </div>
          )}
          {userName ? (
            <div onClick={onRoleClick} title={`${userName}（點擊可切換帳號 / 登出）`} style={{ display: "flex", alignItems: "center", gap: 7, background: HEAD_CHIP, border: `1px solid ${HEAD_LINE}`, borderRadius: 8, padding: isMobile ? "6px" : "5px 12px", minHeight: 40, cursor: "pointer" }}>
              <span style={{ width: 26, height: 26, borderRadius: 13, background: ACCENT, color: "#fff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{(userName[0] || "?").toUpperCase()}</span>
              {!isMobile && <span style={{ fontSize: 13, color: "#fff", fontWeight: 500 }}>{userName}</span>}
            </div>
          ) : (
            <button onClick={onRoleClick} title="登入以編輯" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", border: "none", borderRadius: 8, padding: isMobile ? 0 : "8px 16px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", color: HEAD_BG, fontSize: 13, fontWeight: 600 }}>
              {isMobile ? <KeyRound size={17} /> : "登入以編輯"}
            </button>
          )}
          <button onClick={onActivityLog} title="活動記錄" style={{ background: "transparent", border: `1px solid ${HEAD_LINE}`, color: "#d4d4d4", borderRadius: 8, padding: isMobile ? 0 : "7px 12px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", fontSize: isMobile ? 17 : 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, position: "relative" }}>
            {isMobile ? <Bell size={17} /> : <>活動{activityCount > 0 ? <span style={{ fontSize: 10, background: ACCENT, color: "#fff", fontWeight: 600, borderRadius: 10, padding: "1px 6px" }}>{activityCount}</span> : ""}</>}
            {isMobile && activityCount > 0 && <span style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px", background: ACCENT, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>{activityCount > 99 ? "99+" : activityCount}</span>}
          </button>
          <button onClick={onAI} title="AI 顧問" style={{ background: ACCENT, border: "none", color: "#fff", borderRadius: 8, padding: isMobile ? 0 : "8px 16px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", fontSize: isMobile ? 17 : 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isMobile ? <Bot size={17} /> : "AI 顧問"}
          </button>
        </div>
      </div>
      {/* view tabs — boxed editorial（手機隱藏，改用底部導覽）*/}
      {!isMobile && (
      <div style={{ display: "flex", gap: 8, paddingBottom: 12, flexWrap: "wrap" }}>
        {(conf().tabs || [["owner","儀表板"],["overview",L("overview")],["tasks","任務"],["gantt",L("gantt")],["conclusions","結論"],["files","檔案庫"],...(conf().showCost?[["petty","零用金"]]:[]),["compare","比價"],...((isAdmin||pageVisible("advisor"))?[["settings","設定"]]:[])]).filter(([v]) => !conf().hideTabs.includes(v) && pageVisible(v)).map(([v,l]) => { const act = tabActive(v); const NavI = NAV_ICONS[v]; return (
          <button key={v} onClick={() => setView(v === "settings" ? "advisor" : v)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 7, border: `1px solid ${act ? "#fff" : "transparent"}`, cursor: "pointer", fontSize: 14, fontWeight: act ? 600 : 400, background: act ? "#fff" : "transparent", color: act ? HEAD_BG : HEAD_SUB, transition: "all .12s" }}>{NavI && <NavI size={15} strokeWidth={1.75} />}{String(l).replace(/^[^一-鿿A-Za-z0-9]+\s*/, "")}</button>
        ); })}
      </div>
      )}
    </div>
  );
}


// ── OVERVIEW TABLE (Notion-style) ────────────────────────────────────────────
const COLS = [
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
      onBlur={()=>{ onCommit(isNum ? (parseFloat(local)||0) : local); setEditing(false); }}
      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Escape") e.target.blur(); }}
      style={{ width:"100%", border:"none", outline:"2px solid "+ACCENT, borderRadius:4, padding:"2px 4px", fontSize:12.5, fontFamily:"'Noto Sans TC',sans-serif", background:"#eff6ff" }} />;
  }
  return <div onClick={()=>{ setLocal(value ?? ""); setEditing(true); }} style={{ width:"100%", cursor:"text", minHeight:22, color: (value!==undefined&&value!=="")?"#211C15":"#CDC3AC", padding:"2px 2px" }}>{display || "—"}</div>;
}
function OverviewTable({ cats, setCats, confirm, customCols = [], setCustomCols, onSelect, dragging, dragOver, onDragStart, onDragOver, onDrop, trash = [], trashItems, restoreTrash, commitTrash, petty, setView }) {
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
    padding: "0 8px", borderRight: "1px solid #e5e5e5",
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
            const v = type === "number" ? (parseFloat(local) || 0) : local;
            updateItem(catId, itemId, field, v);
            setEditCell(null);
          }}
          onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); }}
          style={{ width: "100%", border: "none", outline: "2px solid " + ACCENT, borderRadius: 4, padding: "2px 4px", fontSize: 12.5, fontFamily: "'Noto Sans TC', sans-serif", background: "#eff6ff" }}
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
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#a3a3a3", pointerEvents: "none" }}>🔍</span>
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
          <button onClick={() => setGroupMode(m => !m)} title="分類模式：設定每個大項的費用群組與是否計入工程" style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${groupMode ? ACCENT : BORDER}`, fontSize: 12.5, cursor: "pointer", background: groupMode ? "#eff6ff" : SURFACE, color: groupMode ? ACCENT : SUB, fontWeight: 500 }}>🏷 分類{groupMode ? "中" : ""}</button>
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
            const QUOTE_TINTS = ["#fafafa", "#EDF3F6", "#F4EEF4", "#EDF5EE", "#FBF0EA"];
            const quoteKeyOf = (it) => `${it.payDate || ""}¦${it.assignee || ""}`;
            const quoteOrder = []; const quoteInfo = {};
            group.rows.forEach(({ item }) => { if (item.fromPetty) return; const k = quoteKeyOf(item); if (!quoteInfo[k]) { quoteInfo[k] = { idx: quoteOrder.length, sum: 0, n: 0, date: item.payDate || "", vendor: item.assignee || "" }; quoteOrder.push(k); } quoteInfo[k].sum += estAfterOf(item); quoteInfo[k].n++; });
            const qualifies = (k) => { const q = quoteInfo[k]; return !!(q && (q.date || q.vendor)); }; // 有日期或廠商＝可視為一張報價單（零用金細項不在表內→null-safe）
            const multiQuote = showMoney() && quoteOrder.some(qualifies) && quoteOrder.length >= 2;
            // 有標籤的大項整行反底色：預估群組→藍、非工程→黃、其他費用群組→淡褐
            const isEstimate = !!(cat?.group && /預估/.test(cat.group));
            const isFunding = !!(cat && /零用金/.test(cat.name || "")); // 撥款帳：不計入工程成本
            const tagTint = isFunding ? "#EDEAE3" : isEstimate ? "#E4EDF7" : cat?.nonProject ? "#FBF1CF" : cat?.group ? "#f5f5f5" : null;
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
                  style={{ display: "flex", alignItems: "center", background: isCatDragOver ? "#eff6ff" : (tagTint || BG), borderBottom: `1px solid ${BORDER}`, borderLeft: `2px solid ${tagAccent}`, padding: "0 10px", height: 32, gap: 10, position: "sticky", top: 40, zIndex: 9 }}>
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
                    cat?.group && <button onClick={() => setGroupEditId(catId)} title="點擊改費用群組" style={{ flexShrink: 0, marginLeft: 6, border: `1px solid ${isEstimate ? "#9DBCE0" : "#C8BCA0"}`, background: isEstimate ? "#DCE8F5" : "#eff6ff", color: isEstimate ? "#2C5A8C" : "#92400e", borderRadius: 12, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🏷 {cat.group}</button>
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
                    const colMain = (label, val, opts = {}) => <div style={{ width: 150, textAlign: "right", flexShrink: 0 }} title={opts.title}><span style={{ fontSize: 10.5, color: "#a3a3a3", marginRight: 5 }}>{label}</span><span style={{ fontSize: 14.5, fontWeight: 800, color: opts.color || "#1A1A1A", fontVariantNumeric: "tabular-nums", background: opts.bg || "#E6DDC9", borderRadius: 6, padding: "2px 8px", letterSpacing: -0.2 }}>{val}</span></div>;
                    // 大項名稱（灰）放在「未付」與「＋新增付款」中間 → 右側數字好對焦；空大項保留同寬位置才不會跑掉
                    const nameCol = <div onClick={() => toggleCollapse(catId)} title={group.name} style={{ width: 130, textAlign: "right", flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: "#a3a3a3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{group.name}</div>;
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
                      <button onClick={() => setPayCatId(catId)} title={`檢視／新增付款紀錄${payCount ? `（${payCount} 筆）` : ""}`} style={{ width: 150, textAlign: "right", flexShrink: 0, fontSize: 12.5, color: SUB, border: "none", background: "none", cursor: "pointer", padding: 0 }}>已付 <span style={{ color: groupPaid > 0 ? "#3C8C3C" : "#a3a3a3", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(groupPaid)}</span></button>
                      <button onClick={() => setPayCatId(catId)} title="未付金額＝含稅 − 已付" style={{ width: 150, textAlign: "right", flexShrink: 0, fontSize: 12.5, color: SUB, border: "none", background: "none", cursor: "pointer", padding: 0 }}>未付 <span style={{ color: over ? "#DC2626" : groupUnpaid > 0 ? "#C2410C" : "#3C8C3C", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{over ? `溢付 ${fmt(-groupUnpaid)}` : fmt(groupUnpaid)}</span></button>
                      {nameCol}
                      <div style={{ width: 96, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={(e) => { e.stopPropagation(); setPayCatId(catId); }} title="新增付款紀錄" style={{ border: `1px solid #3C8C3C`, background: "#F0FDF4", color: "#3C8C3C", borderRadius: 6, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>＋ 新增付款</button>
                      </div>
                    </>);
                  })()}
                  </>}
                  <div style={{ width: 78, flexShrink: 0, display: "flex", justifyContent: "flex-end", marginLeft: 4 }}>{itemCount > 0 && <button onClick={() => confirm(`清空「${group.name}」的全部 ${itemCount} 筆${L("item")}？\n（細項可到垃圾桶還原；付款紀錄一併清除）`, { confirmLabel: "確定清空" }).then(ok => { if (ok) { const c = cats.find(x => x.id === catId); if (c?.items?.length && trashItems) trashItems(catId, c.name, c.items); setCats(prev => prev.map(c => c.id === catId ? { ...c, items: [], payments: [] } : c)); } })} title="清空此大項的所有細項" style={{ border: "1px solid #e5e5e5", background: "transparent", color: SUB, cursor: "pointer", fontSize: 11, borderRadius: 6, padding: "2px 9px", whiteSpace: "nowrap" }} onMouseEnter={e => { e.currentTarget.style.borderColor = "#DC2626"; e.currentTarget.style.color = "#DC2626"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e5e5"; e.currentTarget.style.color = SUB; }}>清空細項</button>}</div>
                  <button onClick={() => confirm(`確定刪除${L("cat")}「${group.name}」？\n（含其下 ${itemCount} 筆${L("item")}，無法復原）`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== catId)); })} title={`刪除此${L("cat")}`} style={{ flexShrink: 0, marginLeft: 4, width: 22, height: 22, borderRadius: "50%", background: "transparent", border: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }} onMouseEnter={e => { e.currentTarget.style.background = "#eff6ff"; e.currentTarget.style.color = "#DC2626"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C8BCA0"; }}>×</button>
                </div>
                {/* item rows（收合時隱藏） */}
                {!isCollapsed && group.rows.map(({ item }, rIdx) => {
                  // 零用金細項：唯讀、同欄位對齊（日期/金額對齊正常細項），前面用 🪙 標示；編輯入口在零用金頁
                  if (item.fromPetty) return (
                    <div key={item.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #f0f0f0", background: "#FBF7EE" }}>
                      <div title="來自零用金帳戶（在零用金頁編輯）" style={{ width: 24, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, borderRight: "1px solid #f0f0f0", height: 38 }}>🪙</div>
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
                        <span style={{ color: "#a3a3a3" }}>整張付款：</span>
                        {[["50%", 0.5], ["30%", 0.3], ["全付清", 1]].map(([lb, r]) => (
                          <button key={lb} onClick={() => payReport(catId, qItemIds, r)} title={`此報價單付到 ${typeof r === "number" && r < 1 ? Math.round(r * 100) + "%" : "全額"}（整組精確）`} style={{ border: `1px solid ${r >= 1 ? "#3C8C3C" : "#C2872E"}`, background: r >= 1 ? "#F0FDF4" : "#FFFBEB", color: r >= 1 ? "#3C8C3C" : "#C2872E", borderRadius: 6, padding: "1px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{lb}</button>
                        ))}
                      </div>
                    ); })()}
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOverId(rowKey); }}
                      onDrop={() => onRowDrop(rowKey)}
                      style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #f0f0f0", background: isDragOver ? "#eff6ff" : qTint ? qTint : tinted ? stColor + "1A" : "#ffffff", borderLeft: tinted ? `3px solid ${stColor}` : "3px solid transparent", transition: "background 0.15s" }}
                    >
                      {/* drag handle（僅此處可拖曳） */}
                      <div
                        draggable
                        onDragStart={() => onRowDragStart(rowKey)}
                        onDragEnd={() => { setDragRowId(null); setDragOverId(null); }}
                        style={{ width: 24, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", color: "#d1d5db", fontSize: 14, borderRight: "1px solid #f0f0f0", height: 38 }}>⠿</div>

                      {orderedCols.map(col => {
                        const cs = { ...cellStyle(col) };
                        if (col.builtin === false) {
                          if (col.type === "formula") { const v = buildCtx(item)[col.id]; return <div key={col.id} style={{ ...cs, fontFamily:"monospace", fontSize:12, color:"#6F6656" }}>{typeof v === "number" ? fmt(v) : (v || "—")}</div>; }
                          return <div key={col.id} style={cs}><CustomInput value={item.cust?.[col.id]} type={col.type} onCommit={(val)=>updateCustom(catId, item.id, col.id, val)} /></div>;
                        }
                        if (col.id === "cat") return <div key={col.id} style={{ ...cs, padding: "0 4px" }}>
                          <select value={catId} onChange={e => moveItemToCat(catId, item.id, e.target.value)} title="移動此細項到其他大項" style={{ width: "100%", border: "1px solid transparent", borderRadius: 6, padding: "3px 4px", fontSize: 11, color: "#a3a3a3", background: "transparent", cursor: "pointer" }} onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${BORDER}`; e.currentTarget.style.background = "#fff"; }} onMouseLeave={e => { e.currentTarget.style.border = "1px solid transparent"; e.currentTarget.style.background = "transparent"; }}>
                            {[...cats].sort((a,b)=>a.order-b.order).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>;
                        if (col.id === "name") return <div key={col.id} style={{ ...cs, color: "#211C15", fontWeight: 500, gap: 6 }}>
                          <button onClick={(e) => { e.stopPropagation(); updateItem(catId, item.id, "priority", !item.priority); }} title={item.priority ? "優先追蹤中（點擊取消）" : "標為優先追蹤（AI 會特別關注）"} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, border: "none", background: "transparent", color: item.priority ? "#E8A317" : "#e5e5e5", fontSize: 14, cursor: "pointer", lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{item.priority ? "★" : "☆"}</button>
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
                        if (col.id === "taxAmount") return <div key={col.id} style={{ ...cs, color: "#a3a3a3", fontFamily: "monospace", fontSize: 12 }}>{fmt(taxOf(item))}</div>;
                        if (col.id === "estTotal") {
                          const after = estAfterOf(item), raw = estAmount(item), discd = disc.hasDiscount && after !== raw;
                          return <div key={col.id} style={{ ...cs, color: ACCENT, fontFamily: "monospace", fontWeight: 600, gap: 4 }} title={discd ? `原報價 ${fmt(raw)} → 大項議價後 ${fmt(after)}` : "預估金額（含稅，自動計算）"}>
                            {discd && <span style={{ color: "#a3a3a3", textDecoration: "line-through", fontWeight: 400, fontSize: 11 }}>{fmt(raw)}</span>}
                            <span>{fmt(after)}</span>
                          </div>;
                        }
                        if (col.id === "itemPaid") {
                          const tgt = estAfterOf(item), ip = itemPaidOf(item), up = tgt - ip;
                          const full = tgt > 0 && up <= 0;
                          return <div key={col.id} style={{ ...cs }} title="此細項已付／未付（來自大項付款紀錄）">
                            {ip === 0 ? <span style={{ fontSize: 11.5, color: "#C2410C" }}>● 未付</span>
                              : full ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3C8C3C", background: "#E7F5E7", borderRadius: 10, padding: "2px 8px" }}>✓ 付清</span>
                                : <span style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}><span style={{ color: "#3C8C3C", fontWeight: 600 }}>{fmt(ip)}</span><span style={{ color: "#a3a3a3" }}> / {tgt > 0 ? Math.round(ip / tgt * 100) : 0}%</span></span>}
                          </div>;
                        }
                        if (col.id === "paid") {
                          const estA = estAfterOf(item), p = paidOf(item), full = estA > 0 && p >= estA;
                          return <div key={col.id} style={{ ...cs, gap: 6 }}>
                            <input type="checkbox" checked={full} title={full ? "已全額付清（點擊清除）" : "一鍵填入議價後金額"} onChange={() => updateItem(catId, item.id, "paid", full ? 0 : estA)} style={{ width: 16, height: 16, flexShrink: 0, cursor: "pointer", accentColor: "#3C8C3C" }} />
                            <div style={{ flex: 1, minWidth: 0, color: p > 0 ? "#3C8C3C" : "#CDC3AC" }}><EditableCell catId={catId} itemId={item.id} field="paid" value={item.paid ?? item.cust?.paid ?? 0} type="number" /></div>
                          </div>;
                        }
                        if (col.id === "unpaid") { const u = unpaidAfterOf(item); return <div key={col.id} style={{ ...cs, color: u < 0 ? "#DC2626" : u > 0 ? "#C2872E" : "#3C8C3C", fontFamily: "monospace", fontWeight: 600 }} title={u < 0 ? "溢付（已付超過議價後金額）" : "未付金額（議價後 − 已付，自動）"}>{u < 0 ? `溢付 ${fmt(-u)}` : fmt(u)}</div>; }
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
                                      ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4, border: "1px solid #e5e5e5", cursor: "zoom-in" }} />
                                      : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 28, height: 28, borderRadius: 4, border: "1px solid #e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, textDecoration: "none", background: "#eff6ff" }}>📄</a>}
                                    <button onClick={() => removeReceipt(catId, item, r.id, ri)} title="刪除" style={{ display: "none", position: "absolute", top: -6, right: -6, width: 15, height: 15, borderRadius: "50%", background: "#DC2626", color: "#fff", border: "none", fontSize: 10, lineHeight: 1, cursor: "pointer", alignItems: "center", justifyContent: "center", padding: 0 }}>×</button>
                                  </div>
                                );
                                // 舊格式：純文字名稱＋金額（點一下可刪除）
                                return <span key={ri} title={r.amount ? `${r.name}　$${r.amount}（點擊刪除）` : `${r.name}（點擊刪除）`} onClick={() => removeReceipt(catId, item, r.id, ri)} style={{ fontSize: 10, background: "#eff6ff", color: "#92400e", borderRadius: 10, padding: "1px 6px", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>📎 {r.name}</span>;
                              })}
                              <button title="新增憑證（選檔或貼上截圖）" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setRcpAdd({ catId, item, x: r.left, y: r.bottom + 4 }); }} style={{ fontSize: 12, background: "none", border: "1px dashed #e5e5e5", borderRadius: 4, padding: rcpBusy === item.id ? "0 6px" : "1px 6px", cursor: "pointer", color: "#a3a3a3", flexShrink: 0, display: "flex", alignItems: "center", height: 26 }}>{rcpBusy === item.id ? "…" : "＋"}</button>
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
                          onMouseEnter={e => e.currentTarget.style.color="#DC2626"}
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
                }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 32px", color: "#a3a3a3", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #f0f0f0", transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background="#f5f5f5"}
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
            onMouseEnter={e => e.currentTarget.style.background="#f5f5f5"}
            onMouseLeave={e => e.currentTarget.style.background=SURFACE}
          >
            <span style={{ fontSize: 16 }}>＋</span> 新增{L("cat")}
          </div>
          {/* 總計列：數字欄位自動加總 */}
          <div style={{ display: "flex", borderTop: `2px solid ${BORDER}`, background: "#f5f5f5", position: "sticky", bottom: 0, zIndex: 5, fontWeight: 600 }}>
            <div style={{ width: 24, flexShrink: 0, borderRight: "1px solid #e5e5e5" }} />
            {(() => { const anyDisc = cats.some(c => catDiscount(c).hasDiscount); return
            orderedCols.map(col => {
              const cs = { ...cellStyle(col) };
              if (col.id === "name") { const preSum = rows.reduce((s, r) => s + pretaxOf(r.item), 0); return <div key={col.id} style={{ ...cs, fontWeight: 600, color: "#211C15", gap: 8, flexWrap: "wrap" }}>總計（{rows.length} 筆）<span style={{ fontWeight: 500, color: SUB, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>未稅小計 {fmt(preSum)}</span>{anyDisc && <span style={{ fontWeight: 400, color: SUB, fontSize: 11 }}>· 已含議價折扣</span>}</div>; }
              if (col.id === "estTotal" && anyDisc) {
                const rawSum = rows.reduce((s, r) => s + estAmount(r.item), 0);
                const afterSum = rows.reduce((s, r) => s + estAfterOf(r.item), 0);
                return <div key={col.id} style={{ ...cs, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 0, lineHeight: 1.2 }} title="上：原報價總計　下：議價後總計"><span style={{ fontFamily: "monospace", color: "#a3a3a3", textDecoration: "line-through", fontSize: 11 }}>{fmt(rawSum)}</span><span style={{ fontFamily: "monospace", color: ACCENT, fontWeight: 700 }}>{fmt(afterSum)}</span></div>;
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
            <div style={{ border: `2px dashed ${BORDER}`, borderRadius: 10, padding: "18px 10px", textAlign: "center", fontSize: 13, color: "#a3a3a3", marginBottom: 10, background: "#FBF7EE" }}>📋 在此按 <b style={{ color: ACCENT }}>Cmd+V</b> 貼上截圖</div>
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
              {trash.length > 0 && <button onClick={() => confirm(`清空垃圾桶（永久刪除全部 ${trash.length} 筆，無法復原）？`, { confirmLabel: "永久清空" }).then(ok => ok && commitTrash([]))} style={{ border: "1px solid #DC2626", background: "#fff", color: "#DC2626", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>清空垃圾桶</button>}
              <button onClick={() => setShowTrash(false)} style={{ border: "none", background: "none", fontSize: 20, color: SUB, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {trash.length === 0 && <div style={{ textAlign: "center", color: "#a3a3a3", padding: "40px 0", fontSize: 14 }}>垃圾桶是空的</div>}
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
            ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #e5e5e5", cursor: "zoom-in" }} />
            : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 44, height: 44, borderRadius: 6, border: "1px solid #e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, textDecoration: "none", background: "#eff6ff" }}>📄</a>}
          {onDel && <button onClick={() => onDel(ri)} style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: "50%", background: "#DC2626", color: "#fff", border: "none", fontSize: 10, lineHeight: 1, cursor: "pointer" }}>×</button>}
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
        <div style={{ background: "#eff6ff", border: "1px solid rgba(193,58,34,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>議價後</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: ACCENT }}>{fmt(est)}</div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid rgba(60,140,60,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>已付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#3C8C3C" }}>{fmt(paid)}</div>
        </div>
        <div style={{ background: "#FFFBEB", border: "1px solid rgba(194,135,46,0.3)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>未付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: unpaid < 0 ? "#DC2626" : "#C2872E" }}>{unpaid < 0 ? `溢付 ${fmt(-unpaid)}` : fmt(unpaid)}</div>
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
      <div style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: 12, marginBottom: 16, background: "#FBF7EE" }}>
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
          <label style={{ fontSize: 12, border: "1px dashed #e5e5e5", borderRadius: 6, padding: "6px 12px", cursor: "pointer", color: "#6F6656" }}>
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
                      : <span style={{ fontSize: 11.5, color: ip > 0 ? "#C2872E" : "#a3a3a3", fontVariantNumeric: "tabular-nums" }}>{ip > 0 ? `已付 ${fmt(ip)}（${pct}%）` : "未付"}</span>}
                  </div>
                  <div style={{ height: 6, background: "#f0f0f0", borderRadius: 3, overflow: "hidden", margin: "6px 0" }}><div style={{ width: pct + "%", height: "100%", background: "#3C8C3C" }} /></div>
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
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6, display: "flex", alignItems: "center" }}>已付紀錄（{payments.length} 筆）<div style={{ flex: 1 }} />{payments.length > 0 && <button onClick={async () => { if (confirm && !(await confirm(`清除全部 ${payments.length} 筆付款紀錄？`, { confirmLabel: "確定清除" }))) return; update([]); }} style={{ border: "1px solid #DC2626", background: "#fff", color: "#DC2626", borderRadius: 6, padding: "3px 10px", fontSize: 11.5, cursor: "pointer" }}>一鍵清除</button>}</div>
      {payments.length === 0 && <div style={{ fontSize: 12, color: "#a3a3a3", padding: "12px 0" }}>尚無付款紀錄</div>}
      {payments.map(p => (
        <div key={p.id} style={{ border: "1px solid #E3DAC6", borderRadius: 8, padding: 10, marginBottom: 8, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, background: "#eff6ff", color: "#92400e", borderRadius: 10, padding: "1px 8px", fontWeight: 600, flexShrink: 0 }}>{p.category || "其他"}</span>
            {p.itemId && <span style={{ fontSize: 10, background: "#E8F0FB", color: "#2E6FB0", borderRadius: 10, padding: "1px 8px", fontWeight: 600, flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={nameOfItem(p.itemId)}>{nameOfItem(p.itemId)}</span>}
            <input type="date" value={p.date || ""} onChange={e => editPay(p.id, "date", e.target.value)} style={{ ...inputStyle, width: 140, padding: "4px 8px", fontSize: 12 }} />
            <input type="number" min={0} value={p.amount || ""} onChange={e => editPay(p.id, "amount", Number(e.target.value) || 0)} style={{ ...inputStyle, width: 120, padding: "4px 8px", fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: "#3C8C3C" }} />
            <div style={{ flex: 1 }} />
            <button onClick={() => delPayment(p.id)} title="刪除這筆" style={{ width: 24, height: 24, borderRadius: "50%", background: "#eff6ff", border: "1px solid rgba(193,58,34,0.25)", color: "#DC2626", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>×</button>
          </div>
          <input value={p.note || ""} placeholder="備註" onChange={e => editPay(p.id, "note", e.target.value)} style={{ ...inputStyle, padding: "4px 8px", fontSize: 12, marginBottom: (p.receipts?.length || 0) ? 8 : 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            {thumbs(p.receipts, (ri) => removeRcp(p.id, ri))}
            <label style={{ fontSize: 11, border: "1px dashed #e5e5e5", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "#6F6656" }}>
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

// ── SIMPLE LOGIN ─────────────────────────────────────────────────────────────
function AccountMenu({ userName, onClose, onChangePassword, onLogout }) {
  const btn = { width:"100%", padding:"12px 0", borderRadius:10, fontSize:15, fontWeight:600, cursor:"pointer", marginBottom:10 };
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:340, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize:18, fontWeight:600, color:"#211C15", marginBottom:4 }}>{userName}</div>
        <div style={{ fontSize:13, color:"#6F6656", marginBottom:18 }}>帳號設定</div>
        <button onClick={onChangePassword} style={{ ...btn, background:"#211C15", color:"#fff", border:"none" }}>修改我的密碼</button>
        <button onClick={onLogout} style={{ ...btn, background:"#fff", color:"#DC2626", border:"1px solid #FCA5A5" }}>登出</button>
        <button onClick={onClose} style={{ ...btn, background:"transparent", color:"#6F6656", border:"none", marginBottom:0 }}>取消</button>
      </div>
    </div>
  );
}
function LoginModal({ onLogin, onClose }) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || !pw || busy) return;
    setBusy(true); setErr("");
    const res = await onLogin(name.trim(), pw);
    setBusy(false);
    if (res?.error) setErr(res.error);
  };
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#ffffff", borderRadius:16, padding:28, maxWidth:380, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize:22, fontWeight: 600, color:"#211C15", marginBottom:6 }}>登入</div>
        <div style={{ fontSize:13, color:"#6F6656", marginBottom:20 }}>未登入只能檢視。輸入你的帳號與密碼登入；忘記密碼請找管理員重設。</div>
        <input
          value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.nativeEvent.isComposing) submit(); }}
          placeholder="帳號"
          autoFocus autoCapitalize="off" autoCorrect="off"
          style={{ width:"100%", padding:"11px 14px", border:"2px solid #e5e5e5", borderRadius:10, fontSize:15, outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", marginBottom:10 }}
        />
        <input
          type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.nativeEvent.isComposing) submit(); }}
          placeholder="密碼"
          style={{ width:"100%", padding:"11px 14px", border:"2px solid #e5e5e5", borderRadius:10, fontSize:15, outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", marginBottom:err?8:14 }}
        />
        {err && <div style={{ fontSize:12.5, color:"#DC2626", marginBottom:12 }}>{err}</div>}
        <button onClick={submit}
          disabled={!name.trim()||!pw||busy}
          style={{ width:"100%", padding:"12px 0", background:(name.trim()&&pw&&!busy)?"#211C15":"#e5e5e5", border:"none", borderRadius:10, color:(name.trim()&&pw&&!busy)?"#ffffff":"#a3a3a3", fontSize:15, fontWeight: 600, cursor:(name.trim()&&pw&&!busy)?"pointer":"not-allowed" }}>
          {busy?"登入中…":"登入"}
        </button>
        {onClose && (
          <button onClick={onClose}
            style={{ width:"100%", padding:"10px 0", marginTop:10, background:"transparent", border:"none", color:"#6F6656", fontSize:13, cursor:"pointer" }}>
            以訪客身分瀏覽（唯讀）
          </button>
        )}
      </div>
    </div>
  );
}

// ── OWNER DASHBOARD ───────────────────────────────────────────────────────────
function OwnerDashboard({ cats, setCats, settings, stalledItems, activityLog, logActivity, userName, isAdmin, journal, events, plans, petty, totalPaid, pettyInCats }) {
  // 零用金實支：已歸類的已注入各大項（含在下方 totalEst/totalAct）；未歸類的另外提示
  const pettySpends = petty?.spends || [];
  const pettyTotal = pettySpends.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const pettyUncat = pettySpends.filter(s => !s.catId || !cats.some(c => c.id === s.catId)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const pettyCategorized = pettyTotal - pettyUncat;
  const pettyByCat = {};
  pettySpends.forEach(s => { if (s.catId && cats.some(c => c.id === s.catId)) pettyByCat[s.catId] = (pettyByCat[s.catId] || 0) + (Number(s.amount) || 0); });
  const pettyCatRows = Object.entries(pettyByCat).sort((a, b) => b[1] - a[1]);
  const pettyCatName = (id) => cats.find(c => c.id === id)?.name || "";
  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState("");
  const [showReport, setShowReport] = useState(false);

  // 進度只算「工程細項」：排除 撥款帳/非工程(業主自理)/零用金注入項
  const workCats = cats.filter(c => !isFundingCat(c) && !c.nonProject);
  const allItems = workCats.flatMap(c => (c.items || []).filter(it => !it.fromPetty));
  const totalItems = allItems.length;
  const doneItems = allItems.filter(i=>i.done||i.status==="done").length;
  const inProgressItems = allItems.filter(i=>i.status==="inprogress");
  const issueItems = allItems.filter(i=>i.status==="issue");
  const pct = totalItems ? Math.round(doneItems/totalItems*100) : 0;
  const totalEst = cats.filter(c=>!isFundingCat(c)).reduce((s,c)=>s+catEstAfter(c),0); // 議價後含稅總額（排除撥款帳）
  const totalAct = cats.filter(c=>!isFundingCat(c)).reduce((s,c)=>s+catPaid(c),0); // 已付總額（排除撥款帳）
  const daysLeft = settings?.targetDate ? Math.ceil((new Date(settings.targetDate)-new Date())/(1000*60*60*24)) : null;
  const today = new Date().toLocaleDateString("zh-TW");

  // 狀態項目數
  const cnt = (s)=>allItems.filter(i=>i.status===s).length;
  const holdItems = allItems.filter(i=>i.status==="hold");
  // 進度 vs 時程（開工日→完工日，時間已過 % 對比完成 %）
  const ps = settings?.projectStart, td = settings?.targetDate;
  let timePct = null, behind = 0;
  if (ps && td) {
    const total = new Date(td) - new Date(ps), elapsed = new Date() - new Date(ps);
    if (total > 0) { timePct = Math.max(0, Math.min(100, Math.round(elapsed/total*100))); behind = timePct - pct; }
  }
  const budgetPct = totalEst>0 ? Math.round(totalAct/totalEst*100) : 0;
  const overBudget = totalAct > totalEst && totalEst>0;
  // 整體健康燈號
  const health = (issueItems.length>0 || behind>=15) ? "red" : (stalledItems.length>0 || holdItems.length>0 || behind>=5) ? "amber" : "green";
  const hh = { green:{c:"#3C8C3C",bg:"#F0FDF4",dot:"🟢",txt:"進度正常"}, amber:{c:"#C2872E",bg:"#FFFBEB",dot:"🟡",txt:"需要注意"}, red:{c:"#C0392B",bg:"#FEF2F2",dot:"🔴",txt:"需立即處理"} }[health];

  const todayActivity = activityLog.filter(a => {
    const d = new Date(a.ts).toLocaleDateString("zh-TW");
    if (d !== today) return false;
    if (a.action === "登入" && !isAdmin) return false; // 登入紀錄只給管理員看，避免帳號外洩
    return true;
  });

  const generateReport = async () => {
    setReportLoading(true);
    setShowReport(true);
    const system = buildAdvisorSystem(settings, cats, journal||[], events||[], plans||[]);
    const prompt = "請為業主產生一份本週工程進度報告。格式要求：\n1. 開頭用一句話總結本週整體狀況\n2. 各工程大項進度（用百分比和狀態說明）\n3. 本週完成的重要事項（條列）\n4. 目前需要業主知道的問題或決策點\n5. 下週預計完成的工作\n6. 結尾給一個整體評估（樂觀/正常/需注意）\n\n請用業主能理解的語言，避免太多技術術語，語氣專業但親切。";
    try {
      const reply = await callAI([{role:"user",content:prompt}], system);
      setReport(reply);
    } catch(e) { setReport("⚠️ 生成失敗：" + e.message); }
    setReportLoading(false);
  };

  const ProgressRing = ({ pct, size=80, stroke=8, color="#3C8C3C" }) => {
    const r = (size-stroke)/2;
    const circ = 2*Math.PI*r;
    const offset = circ - (pct/100)*circ;
    return (
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f0f0f0" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition:"stroke-dashoffset 0.8s ease" }} />
      </svg>
    );
  };

  const card = { background:"#ffffff", border:"1px solid #e5e5e5", borderRadius:16, padding:18 };
  const kLabel = { fontSize:12, color:"#6F6656", fontWeight:600 };
  const Stat = ({ n, label, color }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:12.5, color:"#4A4234" }}>{label}</span>
      <span style={{ fontSize:14, fontWeight:700, color:n>0?color:"#C9BFA8" }}>{n}</span>
    </div>
  );

  return (
    <div style={{ paddingTop:16, maxWidth:1040, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:22, fontWeight: 600, color:"#211C15" }}>{settings?.projectName || "工程進度"}</div>
          <div style={{ fontSize:13, color:"#6F6656", marginTop:2 }}>{settings?.projectAddress}{settings?.contractorName ? ` · ${settings.contractorName}` : ""} · 今日 {today}</div>
        </div>
        <button onClick={generateReport} style={{ padding:"10px 20px", background:"#211C15", border:"none", borderRadius:10, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          📄 產生業主週報
        </button>
      </div>

      {/* 健康燈號橫幅 */}
      <div style={{ display:"flex", alignItems:"center", gap:12, background:hh.bg, border:`1px solid ${hh.c}33`, borderRadius:14, padding:"12px 18px", marginBottom:16, flexWrap:"wrap" }}>
        <span style={{ fontSize:20 }}>{hh.dot}</span>
        <div style={{ fontSize:15, fontWeight:700, color:hh.c }}>{hh.txt}</div>
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:14, fontSize:12.5, color:"#6F6656", flexWrap:"wrap" }}>
          {issueItems.length>0 && <span style={{ color:"#C0392B", fontWeight:600 }}>🚨 問題 {issueItems.length}</span>}
          {stalledItems.length>0 && <span style={{ color:"#C2872E", fontWeight:600 }}>⏰ 卡關 {stalledItems.length}</span>}
          {timePct!=null && behind>=5 && <span style={{ color:"#C0392B", fontWeight:600 }}>📉 落後時程 {behind}%</span>}
          {health==="green" && <span>各項進度皆在掌握中</span>}
        </div>
      </div>

      {/* 工程財務總覽（甲：零用金帶帳戶併進）：預算 vs 付款 vs 實際成本，未付醒目 */}
      {showMoney() && (() => {
        const unpaid = totalEst - totalAct;
        const payPct = totalEst > 0 ? Math.round(totalAct / totalEst * 100) : 0;
        const big = (label, val, color, sub) => <div style={{ flex:"1 1 180px", minWidth:160 }}><div style={{ fontSize:12.5, color:"#6F6656" }}>{label}{sub && <span style={{ color:"#a3a3a3", fontSize:11 }}> {sub}</span>}</div><div style={{ fontSize:24, fontWeight:800, color, fontVariantNumeric:"tabular-nums", letterSpacing:-0.5, marginTop:2 }}>{fmt(val)}</div></div>;
        return (
        <div style={{ background:"#fff", border:"1px solid #e5e5e5", borderRadius:16, padding:18, marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"#211C15", marginBottom:14 }}>💰 工程財務總覽</div>
          {/* 預算 / 已付 / 未付（重點，大字）*/}
          <div style={{ display:"flex", gap:18, flexWrap:"wrap", marginBottom:14 }}>
            {big("預估總額", totalEst, "#211C15", "（議價後含稅）")}
            {big("已付總額", totalAct, "#3C8C3C")}
            {big("未付（尚需支付）", unpaid, unpaid < 0 ? "#DC2626" : "#C2410C")}
          </div>
          <div style={{ height:9, background:"#f0f0f0", borderRadius:6, overflow:"hidden", marginBottom:4 }}><div style={{ width:payPct+"%", height:"100%", background:"#3C8C3C", borderRadius:6 }} /></div>
          <div style={{ fontSize:12, color:"#6F6656", marginBottom:14 }}>付款進度 {payPct}%</div>
          {/* 零用金實支（已併入上方各大項成本）*/}
          {pettyTotal > 0 && (
            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:12 }}>
              <div style={{ fontSize:12, color:"#6F6656", marginBottom:8 }}>
                🪙 其中<b style={{ color:"#C2410C" }}> 零用金實支 {fmt(pettyCategorized)}</b>（來自零用金帳戶，已併入上方各工種成本）
                {pettyUncat > 0 && <span style={{ color:"#C2872E" }}>　· 另有未歸類 {fmt(pettyUncat)}（請到零用金頁歸到工種才會併入）</span>}
              </div>
              {pettyCatRows.length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
                  {pettyCatRows.map(([id, amt]) => (
                    <span key={id} style={{ fontSize:12, background:"#f5f5f5", border:"1px solid #E3DAC6", borderRadius:10, padding:"3px 10px", color:"#4A4234" }}>{pettyCatName(id)} <b style={{ fontVariantNumeric:"tabular-nums" }}>{fmt(amt)}</b></span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>);
      })()}

      {/* Main KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:14, marginBottom:20 }}>
        {/* 完成度 */}
        <div style={card}>
          <div style={kLabel}>整體完成度</div>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginTop:8 }}>
            <div style={{ position:"relative", flexShrink:0 }}>
              <ProgressRing pct={pct} size={70} color={pct>75?"#3C8C3C":pct>40?"#C2872E":"#C0392B"} />
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:700, color:"#211C15" }}>{pct}%</div>
            </div>
            <div>
              <div style={{ fontSize:18, fontWeight:700, color:"#211C15" }}>{doneItems}<span style={{ fontSize:13, color:"#a3a3a3", fontWeight:400 }}> / {totalItems} 項</span></div>
              <div style={{ fontSize:12, color:"#3E72A8", marginTop:3, fontWeight:600 }}>進行中 {inProgressItems.length} 項</div>
            </div>
          </div>
        </div>

        {/* 時程 */}
        <div style={card}>
          <div style={kLabel}>距完工</div>
          {daysLeft !== null ? (
            <>
              <div style={{ fontSize:26, fontWeight:700, color:daysLeft<14?"#C0392B":daysLeft<30?"#C2872E":"#211C15", marginTop:4 }}>{daysLeft}<span style={{ fontSize:13, fontWeight:400, color:"#a3a3a3" }}> 天</span></div>
              {timePct!=null ? (
                <div style={{ marginTop:8 }}>
                  <div style={{ fontSize:11, color:"#6F6656", marginBottom:4 }}>時程已過 {timePct}%・完成 {pct}%</div>
                  <div style={{ position:"relative", background:"#f0f0f0", borderRadius:20, height:7 }}>
                    <div style={{ position:"absolute", left:0, top:0, bottom:0, width:pct+"%", background:behind>=10?"#C0392B":"#3C8C3C", borderRadius:20, transition:"width .8s" }} />
                    <div style={{ position:"absolute", left:`calc(${timePct}% - 1px)`, top:-2, bottom:-2, width:2, background:"#211C15" }} title="今日時程基準" />
                  </div>
                  <div style={{ fontSize:11.5, fontWeight:700, marginTop:5, color: behind>=10?"#C0392B":behind>=5?"#C2872E":"#3C8C3C" }}>{behind>=5?`進度落後 ${behind}%`:behind<=-5?`進度超前 ${-behind}%`:"進度符合時程"}</div>
                </div>
              ) : <div style={{ fontSize:12, color:"#a3a3a3", marginTop:8 }}>完工日 {td}</div>}
            </>
          ) : <div style={{ fontSize:13, color:"#a3a3a3", marginTop:12 }}>尚未設定完工日</div>}
        </div>

        {/* 付款進度（金額，受權限控管）*/}
        {showMoney() ? (
        <div style={card}>
          <div style={kLabel}>付款進度（已付／預估）</div>
          <div style={{ fontSize:19, fontWeight:700, color:overBudget?"#C0392B":"#3C8C3C", marginTop:4, fontFamily:"ui-monospace, monospace" }}>{totalAct>0?fmt(totalAct):"—"}</div>
          <div style={{ fontSize:11.5, color:"#6F6656", marginTop:2 }}>預估 <span style={{ fontFamily:"ui-monospace, monospace" }}>{fmt(totalEst)}</span>・未付 <span style={{ fontFamily:"ui-monospace, monospace", color:"#C2872E" }}>{fmt(totalEst-totalAct)}</span></div>
          <div style={{ background:"#f0f0f0", borderRadius:20, height:7, overflow:"hidden", marginTop:9 }}>
            <div style={{ background:overBudget?"#C0392B":"#3C8C3C", height:"100%", width:Math.min(100,budgetPct)+"%", borderRadius:20, transition:"width .8s" }} />
          </div>
          <div style={{ fontSize:11.5, fontWeight:700, marginTop:5, color:overBudget?"#C0392B":"#6F6656" }}>{totalAct>0?`已付 ${budgetPct}%${overBudget?"（溢付）":""}`:"尚未付款"}</div>
        </div>
        ) : (
        <div style={card}>
          <div style={kLabel}>付款進度</div>
          <div style={{ fontSize:13, color:"#a3a3a3", marginTop:14 }}>🔒 沒有看金額的權限</div>
        </div>
        )}

        {/* 狀態總覽 */}
        <div style={card}>
          <div style={kLabel}>狀態總覽</div>
          <div style={{ display:"flex", flexDirection:"column", gap:7, marginTop:9 }}>
            <Stat n={issueItems.length} label="🚨 有問題" color="#C0392B" />
            <Stat n={stalledItems.length} label="⏰ 卡關 >3天" color="#C2872E" />
            <Stat n={holdItems.length} label="⏸ 暫停" color="#C2872E" />
            <Stat n={cnt("pending")} label="○ 待開工" color="#6F6656" />
          </div>
        </div>
      </div>

      {/* Category progress bars */}
      <div style={{ background:"#ffffff", border:"1px solid #e5e5e5", borderRadius:16, padding:20, marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
          <div style={{ fontSize:14, fontWeight: 600, color:"#211C15" }}>各工程進度</div>
          <div style={{ fontSize:12, color:"#6F6656" }}>{workCats.length} 大項 · 完工 {workCats.filter(c=>c.status==="done").length} · 進行中 {workCats.filter(c=>c.status==="inprogress").length} · 待開工 {workCats.filter(c=>c.status==="pending").length}</div>
        </div>
        {[...cats].sort((a,b)=>{
          const rank = s => s==="issue"?0 : s==="inprogress"?1 : s==="hold"?2 : s==="done"?4 : 3;
          const r = rank(a.status)-rank(b.status); return r!==0 ? r : (a.order-b.order);
        }).map(cat => {
          const total = cat.items.length;
          const done = cat.items.filter(i=>i.done||i.status==="done").length;
          const pct = total ? Math.round(done/total*100) : 0;
          const hasIssue = cat.items.some(i=>i.status==="issue");
          const hasStall = cat.items.some(i=>stalledItems.find(s=>s.id===i.id));
          const st = STATUS_MAP[cat.status]||STATUS_MAP.pending;
          return (
            <div key={cat.id} style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ width:8, height:8, borderRadius:4, background:st.color, flexShrink:0 }} />
                  <span style={{ fontSize:13, fontWeight:600, color:"#4A4234" }}>{cat.name}</span>
                  {hasIssue && <span style={{ fontSize:10, background:"#eff6ff", color:"#dc2626", borderRadius:10, padding:"1px 7px", fontWeight: 600 }}>問題</span>}
                  {hasStall && <span style={{ fontSize:10, background:"#fffbeb", color:"#d97706", borderRadius:10, padding:"1px 7px", fontWeight: 600 }}>卡關</span>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:11, color:"#a3a3a3" }}>{done}/{total}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:"#211C15", minWidth:34, textAlign:"right" }}>{pct}%</span>
                  <span style={{ fontSize:11, color:st.color, background:st.color+"18", borderRadius:20, padding:"1px 8px", fontWeight: 600 }}>{st.label}</span>
                </div>
              </div>
              <div style={{ background:"#f0f0f0", borderRadius:20, height:8, overflow:"hidden" }}>
                <div style={{ background:pct===100?"#3C8C3C":hasIssue?"#C0392B":"#3E72A8", height:"100%", width:pct+"%", borderRadius:20, transition:"width 0.8s" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Today's activity */}
      <div style={{ background:"#ffffff", border:"1px solid #e5e5e5", borderRadius:16, padding:20, marginBottom:20 }}>
        <div style={{ fontSize:14, fontWeight: 600, color:"#211C15", marginBottom:12 }}>今日動態 {todayActivity.length>0&&<span style={{ fontSize:12, color:"#6F6656", fontWeight:400 }}>（{todayActivity.length} 筆）</span>}</div>
        {todayActivity.length === 0 ? (
          <div style={{ fontSize:13, color:"#a3a3a3", textAlign:"center", padding:"20px 0" }}>今日尚無更新記錄</div>
        ) : (
          <div style={{ maxHeight:200, overflowY:"auto" }}>
            {todayActivity.slice(0,20).map((a,i) => (
              <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", paddingBottom:10, marginBottom:10, borderBottom:i<todayActivity.length-1?"1px solid #f0f0f0":"none" }}>
                <div style={{ fontSize:11, color:"#a3a3a3", whiteSpace:"nowrap", marginTop:2 }}>{new Date(a.ts).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</div>
                <div style={{ fontSize:12, color:"#4A4234" }}><span style={{ fontWeight:600, color:"#211C15" }}>{maskAccount(a.user)}</span> {a.action}：{a.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stalled items detail */}
      {stalledItems.length > 0 && (
        <div style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:16, padding:20, marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight: 600, color:"#92400e", marginBottom:12 }}>⏰ 卡關項目（超過3天未更新）</div>
          {stalledItems.map(item => {
            const cat = cats.find(c=>c.items.find(i=>i.id===item.id));
            const days = item.lastUpdated ? Math.floor((Date.now()-new Date(item.lastUpdated))/(1000*60*60*24)) : null;
            return (
              <div key={item.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #fde68a" }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:"#92400e" }}>{item.name}</div>
                  <div style={{ fontSize:11, color:"#b45309" }}>{cat?.name} · {item.assignee||"未指派"}</div>
                </div>
                {days && <div style={{ fontSize:12, color:"#dc2626", fontWeight: 600 }}>卡關 {days} 天</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* AI/bot 用量帳單已移到 設定 → 用量（業主視角的儀表板不該看到 API 帳單） */}

      {/* Weekly Report Modal */}
      {showReport && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&setShowReport(false)}>
          <div style={{ background:"#ffffff", borderRadius:16, padding:24, maxWidth:620, width:"100%", maxHeight:"80vh", overflow:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight: 600, color:"#211C15" }}>📄 業主週報</div>
              <button onClick={()=>setShowReport(false)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#6F6656" }}>×</button>
            </div>
            {reportLoading ? (
              <div style={{ textAlign:"center", padding:"40px", color:ACCENT }}>🤖 AI 生成中…</div>
            ) : (
              <div style={{ fontSize:13, lineHeight:1.9, color:"#4A4234", whiteSpace:"pre-wrap", background:"#f9fafb", borderRadius:10, padding:"16px 18px" }}>{report}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 資料保險箱：版本快照／還原點 ──────────────────────────────────────────────
// 管理員專屬：把「工程資料 / 零用金」每隔一段時間留的還原點列成時間軸，可一鍵還原。
function HistoryView({ K, confirm, snapshotData, cats, petty }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const META = { pm_data: { label: "工程資料", color: ACCENT }, pm_petty: { label: "零用金", color: "#C2872E" } };
  const load = async () => {
    const out = [];
    for (const k of ["pm_data", "pm_petty"]) {
      try { const r = await window.storage.get(K("pm_hist_" + k), true); const list = r && r.value ? JSON.parse(r.value) : []; list.forEach(e => out.push({ ...e, key: k })); } catch (_) {}
    }
    out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    setRows(out);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const summarize = (e) => {
    try {
      const d = JSON.parse(e.json);
      if (e.key === "pm_data") { const arr = Array.isArray(d) ? d : []; const items = arr.reduce((s, c) => s + (c.items || []).length, 0); let t = { est: 0, paid: 0 }; try { t = projectTotals(arr); } catch (_) {} return `${arr.length} 大項・${items} 細項・預估 ${fmt(t.est || 0)}`; }
      if (e.key === "pm_petty") { const adv = (d.advances || []).reduce((s, a) => s + (Number(a.amount) || 0), 0); const sp = (d.spends || []).reduce((s, a) => s + (Number(a.amount) || 0), 0); return `撥款 ${fmt(adv)}・花費 ${fmt(sp)}・餘額 ${fmt(adv - sp)}`; }
    } catch (_) {}
    return "—";
  };
  const fmtWhen = (ts) => { try { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch (_) { return ts; } };
  const noteLabel = (n) => n === "手動還原點" ? "手動建立" : n === "還原前自動存點" ? "還原前自動存" : n === "變更前自動存點" ? "變更前自動存" : "系統自動存點";
  const makePoint = async () => {
    setBusy(true);
    try { await snapshotData("pm_data", cats, { force: true, note: "手動還原點" }); await snapshotData("pm_petty", petty, { force: true, note: "手動還原點" }); } catch (_) {}
    await load(); setBusy(false);
  };
  const restore = async (e) => {
    const m = META[e.key];
    if (!(await confirm(`確定把「${m.label}」還原回 ${fmtWhen(e.ts)} 的版本？\n\n目前的內容會被覆蓋（但會先自動存一個還原點，之後也能再還原回來）。`, { confirmLabel: "還原" }))) return;
    setBusy(true);
    try {
      await snapshotData(e.key, e.key === "pm_data" ? cats : petty, { force: true, note: "還原前自動存點" });
      await window.storage.set(K(e.key), e.json, true);
      alert("✅ 已還原，畫面將重新整理。");
      window.location.reload();
    } catch (_) { alert("還原失敗，請再試一次。"); setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>🛟 資料保險箱・還原點</div>
        <div style={{ flex: 1 }} />
        <button onClick={makePoint} disabled={busy} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>＋ 現在建立還原點</button>
      </div>
      <div style={{ fontSize: 12.5, color: SUB, marginBottom: 14, lineHeight: 1.7, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px" }}>
        每一列＝<b>某個時間點「資料當時的樣子」</b>的一份存檔。中間那串數字是<b>當時的內容</b>（不是名稱），按右邊「還原」就會把現在的資料換回那個版本。<br />
        系統會在「工程資料 / 零用金」變動時<b>每隔約 10 分鐘自動存一份</b>（各最多 60 份）；重要操作前也可先按右上角手動存一份。
      </div>
      {rows === null ? <div style={{ padding: 30, textAlign: "center", color: SUB }}>載入中…</div> :
        rows.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: SUB }}>還沒有還原點。資料一有變動就會自動開始累積，或按右上角手動建立。</div> :
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, background: SURFACE, overflow: "hidden" }}>
            {rows.map((e, i) => { const m = META[e.key]; return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderTop: i ? `1px solid #f0f0f0` : "none" }}>
                <div style={{ flexShrink: 0, width: 70, textAlign: "center", fontSize: 11.5, fontWeight: 700, color: "#fff", background: m.color, borderRadius: 6, padding: "4px 0" }}>{m.label}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{fmtWhen(e.ts)} 的版本</div>
                  <div style={{ fontSize: 12, color: SUB, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>當時內容：{summarize(e)}</div>
                  <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 1 }}>{e.user || "系統"}・{noteLabel(e.note)}</div>
                </div>
                <button onClick={() => restore(e)} disabled={busy} title="把現在的資料換回這個版本" style={{ flexShrink: 0, background: "#fff", color: ACCENT, border: `1px solid ${ACCENT}`, borderRadius: 7, padding: "6px 16px", fontSize: 12.5, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>↩ 還原</button>
              </div>
            ); })}
          </div>}
    </div>
  );
}

// ── App 更新紀錄（我們對 App 做的功能修改／新增，給全團隊看）─────────────────
// 維護方式：每次有較大改動就在最上面加一筆（日期 + 條列）。
const CHANGELOG = [
  { date: "2026-07-01", items: [
    "新增「📌 公開結論」頁：集中存團隊定案、版本控制(更新出新版、舊版進歷史)、D哥可直接回答",
    "新增「✅ 任務中心」：合併取代工序/ToDo，六視角(依大項/看板/清單/時間軸/甘特/心智圖)、收件匣隨手記、小卡拖曳歸屬、大項可直接新增",
    "D哥大升級：改用最高級 Opus、加「對話記憶」(記得前文)、「長期記事本」(永久記重要事)、會自我判斷做不到就直說",
    "修正：中文輸入法打字會重複新增任務的問題、D哥回「確認」沒反應的問題",
  ]},
  { date: "2026-06-22", items: [
    "新增「🛟 還原點」資料保險箱：工程資料/零用金自動留版本、可一鍵還原；搭配 Supabase Pro 每日備份",
    "資料庫上鎖(RLS)：外人無法繞過 App 直接竄改資料",
    "登入紀錄顯示真實姓名(原本都顯示「系統」)；工序日誌紀錄更具體(工項+內容)",
  ]},
  { date: "2026-06-21", items: [
    "操作紀錄全面化：財務/任務/比價/工序/群組…所有操作都會記、且具體",
    "D哥串接全部資料(操作/登入紀錄、比價、夥伴中心)，不再答不出來",
    "D哥動作引擎：可用 LINE 對話直接操作 App(加待辦/記帳/改狀態…含確認)",
  ]},
  { date: "2026-06-13", items: [
    "新增「💰 財務內帳」獨立空間：多帳戶總表、交易明細、會計科目、批量匯入、餘額對帳",
  ]},
];
function ChangelogView() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 6 }}>📣 App 更新紀錄</div>
      <div style={{ fontSize: 12.5, color: SUB, marginBottom: 16, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 12px" }}>這裡記錄我們對這個系統做的功能新增／修改，讓大家知道最近多了什麼、改了什麼。</div>
      <div style={{ display: "grid", gap: 12 }}>
        {CHANGELOG.map((c, i) => (
          <div key={c.date} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: i === 0 ? ACCENT : TEXT }}>{c.date}</span>
              {i === 0 && <span style={{ fontSize: 10.5, color: "#fff", background: ACCENT, borderRadius: 5, padding: "1px 7px", fontWeight: 600 }}>最新</span>}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
              {c.items.map((it, j) => <li key={j} style={{ fontSize: 13, color: TEXT, lineHeight: 1.55 }}>{it}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ACTIVITY LOG PANEL ────────────────────────────────────────────────────────
// 管理員專屬：每個人的登入時間＋操作內容（稽核紀錄）
function AuditLogView({ activityLog, confirm, onCommit }) {
  const [tab, setTab] = useState("member"); // member | timeline
  const [q, setQ] = useState("");
  const [act, setAct] = useState("all"); // all | 登入 | 編輯
  const [openU, setOpenU] = useState(() => new Set());
  const toggleU = (u) => setOpenU(prev => { const n = new Set(prev); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const isLogin = (a) => a.action === "登入";
  const log = (activityLog || []).filter(a => {
    if (act === "登入" && !isLogin(a)) return false;
    if (act === "編輯" && isLogin(a)) return false;
    if (!q.trim()) return true; const s = (a.user + " " + a.action + " " + (a.detail || "")).toLowerCase();
    return s.includes(q.trim().toLowerCase());
  });
  const fmtDT = (ts) => { try { return new Date(ts).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } };
  const fmtT = (ts) => { try { return new Date(ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } };
  // ── 管理員刪除紀錄 ──
  const sameEntry = (a, b) => a.ts === b.ts && a.user === b.user && a.action === b.action && a.detail === b.detail;
  const delEntry = async (a) => { if (onCommit && (!confirm || await confirm("刪除這筆紀錄？"))) onCommit((activityLog || []).filter(x => !sameEntry(x, a))); };
  const clearMember = async (u) => { if (onCommit && (!confirm || await confirm(`清空「${u}」的全部紀錄？`, { confirmLabel: "清空" }))) onCommit((activityLog || []).filter(x => (x.user || "—") !== u)); };
  const clearAll = async () => { if (onCommit && (!confirm || await confirm("清空全部登入與操作紀錄？此動作無法復原。", { confirmLabel: "全部清空" }))) onCommit([]); };
  const delX = (a) => <button onClick={(e) => { e.stopPropagation(); delEntry(a); }} title="刪除此筆" style={{ background: "none", border: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.color = "#DC2626"} onMouseLeave={e => e.currentTarget.style.color = "#C8BCA0"}>×</button>;

  // 依成員彙整
  const byUser = {};
  log.forEach(a => { const u = a.user || "—"; (byUser[u] = byUser[u] || []).push(a); });
  const members = Object.entries(byUser).map(([u, list]) => {
    const logins = list.filter(isLogin);
    const lastTs = list.reduce((m, a) => a.ts > m ? a.ts : m, "");
    return { u, list, loginCount: logins.length, lastLogin: logins[0]?.ts, lastTs, actCount: list.length - logins.length };
  }).sort((a, b) => (b.lastTs > a.lastTs ? 1 : -1));

  // 時間軸（依日期）
  const byDate = {}; log.forEach(a => { const d = new Date(a.ts).toLocaleDateString("zh-TW"); (byDate[d] = byDate[d] || []).push(a); });
  const today = new Date().toLocaleDateString("zh-TW");
  const tagStyle = (a) => isLogin(a)
    ? { color: "#2E7D32", background: "#EAF3EA", border: "1px solid #CFE3CF" }
    : { color: "#b5512b", background: "#F6ECE6", border: "1px solid #E6CFC2" };

  return (
    <div style={{ maxWidth: 900, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15", marginBottom: 6 }}>📜 登入與操作紀錄（僅管理員）</div>
      <div style={{ background: "#faf6ee", border: "1px solid #e4ddc9", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#6b6450", lineHeight: 1.7 }}>
        這裡記錄<b>每個人的登入時間</b>與<b>做了什麼</b>（編輯哪一頁）。只有管理員看得到。連續編輯會收斂成每 90 秒一筆，最多保留最近 200 筆。
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {[["member", "👤 依成員"], ["timeline", "🕓 時間軸"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${tab === k ? "#b5512b" : "#e5e5e5"}`, background: tab === k ? "#b5512b" : "#fff", color: tab === k ? "#fff" : "#6F6656", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{l}</button>
        ))}
        <span style={{ width: 1, height: 22, background: "#E0D8C4", margin: "0 2px" }} />
        {[["all", "全部"], ["登入", "只看登入"], ["編輯", "只看操作"]].map(([k, l]) => (
          <button key={k} onClick={() => setAct(k)} style={{ padding: "5px 11px", borderRadius: 999, border: `1px solid ${act === k ? "#7A6F58" : "#e5e5e5"}`, background: act === k ? "#f0f0f0" : "#fff", color: act === k ? "#4A4234" : "#a3a3a3", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋人名／動作…" style={{ ...inputStyle, width: 180, padding: "6px 10px" }} />
        {(activityLog || []).length > 0 && <button onClick={clearAll} title="清空全部紀錄" style={{ background: "#fff", color: "#DC2626", border: "1px solid #F0C0C0", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>🗑 清空全部</button>}
      </div>

      {log.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#a3a3a3", fontSize: 13 }}>尚無紀錄</div> : tab === "member" ? (
        members.map(m => {
          const open = openU.has(m.u);
          return (
            <div key={m.u} style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: "10px 14px", marginBottom: 10 }}>
              <div onClick={() => toggleU(m.u)} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer" }}>
                <span style={{ fontSize: 11, color: "#a3a3a3", width: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>{m.u}</div>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: "#6F6656" }}>最近登入 <b style={{ color: "#2E7D32" }}>{m.lastLogin ? fmtDT(m.lastLogin) : "—"}</b></span>
                <span style={{ fontSize: 11.5, color: "#a3a3a3" }}>登入 {m.loginCount} 次・操作 {m.actCount} 次</span>
                <button onClick={(e) => { e.stopPropagation(); clearMember(m.u); }} title="清空此人紀錄" style={{ background: "none", border: "1px solid #E7DFCC", borderRadius: 6, color: "#a3a3a3", fontSize: 11.5, padding: "2px 8px", cursor: "pointer" }} onMouseEnter={e => { e.currentTarget.style.color = "#DC2626"; e.currentTarget.style.borderColor = "#F0C0C0"; }} onMouseLeave={e => { e.currentTarget.style.color = "#a3a3a3"; e.currentTarget.style.borderColor = "#E7DFCC"; }}>清空</button>
              </div>
              {open && (
                <div style={{ marginTop: 10, borderTop: "1px solid #F0E9D8", paddingTop: 8 }}>
                  {m.list.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 12.5 }}>
                      <span style={{ fontSize: 11, color: "#a3a3a3", width: 96, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{fmtDT(a.ts)}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "1px 7px", ...tagStyle(a) }}>{a.action}</span>
                      <span style={{ color: "#4A4234", flex: 1 }}>{a.detail}</span>
                      {delX(a)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      ) : (
        Object.entries(byDate).map(([date, entries]) => (
          <div key={date} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#6F6656", fontWeight: 600, margin: "6px 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ height: 1, flex: 1, background: "#E7DFCC" }} />{date === today ? "今天" : date}<div style={{ height: 1, flex: 1, background: "#E7DFCC" }} />
            </div>
            {entries.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 4px", fontSize: 12.5, borderBottom: "1px solid #F6F1E5" }}>
                <span style={{ fontSize: 11, color: "#a3a3a3", width: 42, flexShrink: 0 }}>{fmtT(a.ts)}</span>
                <span style={{ fontWeight: 700, color: "#211C15", width: 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.user}</span>
                <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "1px 7px", ...tagStyle(a) }}>{a.action}</span>
                <span style={{ color: "#4A4234", flex: 1 }}>{a.detail}</span>
                {delX(a)}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

// ── 🔐 加密金庫（零知識）：主密碼只在本機，密碼先加密才上傳，伺服器只存亂碼 ──
const _enc = (s) => new TextEncoder().encode(s);
const _dec = (b) => new TextDecoder().decode(b);
const _b64 = (u8) => { let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const _ub64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function _deriveKey(pw, salt) {
  const mat = await crypto.subtle.importKey("raw", _enc(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// 用「已導出的金鑰」加密（解鎖時導一次 PBKDF2 並快取，之後存檔只跑快速的 AES，不卡打字）
async function vaultEncWithKey(obj, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, _enc(JSON.stringify(obj)));
  return { v: 1, salt: _b64(salt), iv: _b64(iv), ct: _b64(new Uint8Array(ct)) };
}
async function vaultDecWithKey(blob, key) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _ub64(blob.iv) }, key, _ub64(blob.ct)); // 主密碼錯會丟例外
  return JSON.parse(_dec(pt));
}

function VaultView({ onLog }) {
  const [blob, setBlob] = useState(undefined); // undefined=載入中, null=尚無金庫, obj=密文
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [entries, setEntries] = useState(null); // null=鎖定中, array=已解鎖
  const keyRef = useRef(null); const saltRef = useRef(null); // 快取的 CryptoKey + salt（鎖定即清）
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState({}); const [q, setQ] = useState(""); const [filt, setFilt] = useState("all");

  useEffect(() => { (async () => {
    try { const r = await window.storage.get("pm_vault", true); setBlob(r && r.value ? JSON.parse(r.value) : null); }
    catch (_) { setBlob(null); }
  })(); return () => { keyRef.current = null; saltRef.current = null; }; }, []);

  const isNew = blob === null;
  const save = async (list) => {
    const enc = await vaultEncWithKey({ entries: list }, keyRef.current, saltRef.current);
    setBlob(enc); await window.storage.set("pm_vault", JSON.stringify(enc), true);
  };
  const unlock = async () => {
    setErr(""); if (!pw) return; setBusy(true);
    try {
      if (isNew) {
        if (pw.length < 6) { setErr("主密碼至少 6 碼"); setBusy(false); return; }
        if (pw !== pw2) { setErr("兩次主密碼不一致"); setBusy(false); return; }
        saltRef.current = crypto.getRandomValues(new Uint8Array(16));
        keyRef.current = await _deriveKey(pw, saltRef.current);
        await save([]); setEntries([]);
      } else {
        const salt = _ub64(blob.salt);
        const key = await _deriveKey(pw, salt);
        const data = await vaultDecWithKey(blob, key); // 主密碼錯會丟例外
        keyRef.current = key; saltRef.current = salt; setEntries(data.entries || []);
      }
      setPw(""); setPw2("");
    } catch (_) { setErr("主密碼錯誤，解不開"); }
    setBusy(false);
  };
  const lock = () => { keyRef.current = null; saltRef.current = null; setEntries(null); setReveal({}); setPw(""); };
  const commit = async (list) => { setEntries(list); try { await save(list); onLog?.("編輯", "更新密碼金庫"); } catch (_) { setErr("儲存失敗"); } };
  const addEntry = () => commit([...(entries || []), { id: "v" + Math.random().toString(36).slice(2, 8), cat: "company", name: "", account: "", password: "", url: "", notes: "" }]);
  const upd = (id, k, v) => commit(entries.map(e => e.id === id ? { ...e, [k]: v } : e));
  const del = (id) => commit(entries.filter(e => e.id !== id));
  const copy = (t) => { try { navigator.clipboard.writeText(t); } catch (_) {} };
  const [sortKey, setSortKey] = useState("cat"); const [sortDir, setSortDir] = useState(1);
  const [imp, setImp] = useState(null); // 匯入面板 {mode,text,cat,preview,busy,err}
  const fileToB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
  // 貼上解析：Google 試算表複製＝Tab 分隔。欄序 名稱/帳號/密碼/備註/連結；區段標題列(含「帳號」「密碼」)→設目前分類
  const parsePaste = (text, defCat) => {
    const out = []; let cur = defCat || "公司帳號";
    for (const raw of (text || "").split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const cells = (raw.includes("\t") ? raw.split("\t") : raw.split(/ {2,}|,/)).map(c => c.trim());
      if (cells[1] === "帳號" || cells.includes("密碼")) { if (cells[0] && !/帳號|密碼|備註|連結/.test(cells[0])) cur = cells[0]; continue; }
      if (cells.filter(Boolean).length === 1) { cur = cells[0]; continue; }
      const [name, account, password, notes, url] = cells;
      if (!name && !account && !password) continue;
      out.push({ id: "v" + Math.random().toString(36).slice(2, 8), cat: cur, name: name || "", account: account || "", password: password || "", url: url || "", notes: notes || "" });
    }
    return out;
  };
  const runImport = (rows) => { if (rows && rows.length) commit([...(entries || []), ...rows]); setImp(null); };
  const ocrImport = async (file) => {
    setImp(p => ({ ...(p || {}), busy: true, err: "" }));
    try {
      const b64 = await fileToB64(file);
      const block = { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: b64 } };
      const reply = await callAI([{ role: "user", content: [block, { type: "text", text: "把這張帳號密碼表解析成 JSON 陣列，每筆 {cat,name,account,password,notes,url}，cat=該列所屬分類/區段；只輸出一個 ```json 區塊，不要其他文字。" }] }], "你是表格解析助理，只輸出 JSON。", "import");
      const m = reply.match(/```json\s*([\s\S]*?)```/i); const arr = JSON.parse(m ? m[1] : reply);
      const rows = (Array.isArray(arr) ? arr : []).map(r => ({ id: "v" + Math.random().toString(36).slice(2, 8), cat: r.cat || "公司帳號", name: r.name || "", account: r.account || "", password: r.password || "", url: r.url || "", notes: r.notes || "" }));
      setImp(p => ({ ...(p || {}), busy: false, preview: rows }));
    } catch (_) { setImp(p => ({ ...(p || {}), busy: false, err: "解析失敗，請改用「貼上文字」" })); }
  };

  const wrap = { maxWidth: 1080, margin: "16px auto", padding: "0 4px" };
  if (blob === undefined) return <div style={{ ...wrap, padding: 30, color: "#a3a3a3", textAlign: "center" }}>載入中…</div>;

  // 鎖定畫面
  if (entries === null) return (
    <div style={wrap}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15", marginBottom: 6 }}>🔐 密碼金庫（僅管理員）</div>
      <div style={{ background: "#faf6ee", border: "1px solid #e4ddc9", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#6b6450", lineHeight: 1.7 }}>
        密碼會在<b>你的瀏覽器先加密</b>才上傳，伺服器只存亂碼、<b>連我都看不到明文</b>。只有輸入正確主密碼才解得開。<b style={{ color: "#b45309" }}>主密碼忘了就救不回</b>（這正是它安全的原因）。
      </div>
      <div style={{ maxWidth: 420, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#211C15", marginBottom: 12 }}>{isNew ? "設定主密碼（首次建立金庫）" : "輸入主密碼解鎖"}</div>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && !isNew && unlock()} placeholder="主密碼" autoFocus style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
        {isNew && <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === "Enter" && unlock()} placeholder="再輸入一次主密碼" style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }} />}
        {err && <div style={{ color: "#DC2626", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <button onClick={unlock} disabled={busy || !pw} style={{ width: "100%", background: busy || !pw ? "#e5e5e5" : "#b5512b", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 600, cursor: busy || !pw ? "not-allowed" : "pointer" }}>{busy ? "處理中…" : isNew ? "建立金庫" : "解鎖"}</button>
      </div>
    </div>
  );

  // 已解鎖：表格化（分類/排序/篩選/搜尋）+ 批量匯入
  const allCats = Array.from(new Set((entries || []).map(e => e.cat).filter(Boolean)));
  const filtered = entries.filter(e => (filt === "all" || e.cat === filt) && (!q.trim() || (e.cat + e.name + e.account + e.url + e.notes).toLowerCase().includes(q.trim().toLowerCase())));
  const sorted = [...filtered].sort((a, b) => (((a[sortKey] || "") + "").localeCompare((b[sortKey] || "") + "", "zh-Hant")) * sortDir);
  const setSort = (k) => { if (sortKey === k) setSortDir(d => -d); else { setSortKey(k); setSortDir(1); } };
  const arrow = (k) => sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "";
  const cell = { border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, background: "#fff", color: TEXT, width: "100%", boxSizing: "border-box" };
  const ico = { border: `1px solid ${BORDER}`, background: "#fff", borderRadius: 6, padding: "4px 6px", cursor: "pointer", fontSize: 12, flexShrink: 0 };
  const gtc = "130px 1.2fr 1.2fr 1.2fr 1fr 1fr 32px";
  const sep = `1px solid ${BORDER}`;
  const th = (label, k) => <div onClick={k ? () => setSort(k) : undefined} style={{ padding: "7px 8px", fontSize: 11.5, fontWeight: 600, color: "#7A6F58", borderLeft: sep, cursor: k ? "pointer" : "default", userSelect: "none" }}>{label}{k ? arrow(k) : ""}</div>;
  const fld = (e, k, ph) => <input value={e[k] || ""} onChange={ev => upd(e.id, k, ev.target.value)} placeholder={ph} style={cell} />;
  return (
    <div style={wrap}>
      <datalist id="vaultcats">{allCats.map(c => <option key={c} value={c} />)}</datalist>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15" }}>🔐 密碼金庫</div>
        <span style={{ fontSize: 12, color: "#2E7D32" }}>● 已解鎖（{entries.length} 筆）</span>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋…" style={{ ...inputStyle, width: 160, padding: "6px 10px" }} />
        <button onClick={addEntry} style={{ background: "#b5512b", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增</button>
        <button onClick={() => setImp({ mode: "text", text: "", cat: "公司帳號", preview: null, busy: false, err: "" })} style={{ background: "#fff", color: "#b5512b", border: "1px solid #b5512b", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>📋 批量匯入</button>
        <button onClick={lock} title="清除記憶體中的明文" style={{ background: "#fff", color: "#6F6656", border: "1px solid #e5e5e5", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}>🔒 鎖定</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {["all", ...allCats].map(k => { const n = k === "all" ? entries.length : entries.filter(e => e.cat === k).length; return <button key={k} onClick={() => setFilt(k)} style={{ padding: "4px 12px", borderRadius: 999, border: `1px solid ${filt === k ? "#b5512b" : "#e5e5e5"}`, background: filt === k ? "#F4EAE4" : "#fff", color: filt === k ? "#b5512b" : "#6F6656", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{k === "all" ? "全部" : k} {n}</button>; })}
      </div>
      <div style={{ overflowX: "auto", border: sep, borderRadius: 10, background: "#fff" }}>
        <div style={{ minWidth: 760 }}>
          <div style={{ display: "grid", gridTemplateColumns: gtc, background: "#ffffff", borderBottom: sep }}>
            {th("分類", "cat")}{th("名稱", "name")}{th("帳號", "account")}{th("密碼", null)}{th("連結", null)}{th("備註", null)}{th("", null)}
          </div>
          {sorted.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "#a3a3a3", fontSize: 13 }}>沒有資料，點「＋ 新增」或「📋 批量匯入」</div> :
           sorted.map((e, i) => (
            <div key={e.id} style={{ display: "grid", gridTemplateColumns: gtc, alignItems: "center", background: i % 2 ? "#FBF8F0" : "#fff", borderTop: i ? "1px solid #F3EEE1" : "none", padding: "5px 6px", gap: 4 }}>
              <input list="vaultcats" value={e.cat || ""} onChange={ev => upd(e.id, "cat", ev.target.value)} placeholder="分類" style={cell} />
              {fld(e, "name", "名稱")}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>{fld(e, "account", "帳號")}<button onClick={() => copy(e.account)} title="複製" style={ico}>📋</button></div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type={reveal[e.id] ? "text" : "password"} value={e.password || ""} onChange={ev => upd(e.id, "password", ev.target.value)} placeholder="密碼" style={cell} />
                <button onClick={() => setReveal(r => ({ ...r, [e.id]: !r[e.id] }))} title="顯示/隱藏" style={ico}>{reveal[e.id] ? "🙈" : "👁"}</button>
                <button onClick={() => copy(e.password)} title="複製" style={ico}>📋</button>
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>{fld(e, "url", "連結")}{e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ ...ico, textDecoration: "none" }}>↗</a> : null}</div>
              {fld(e, "notes", "備註")}
              <button onClick={() => del(e.id)} title="刪除" style={{ background: "none", border: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 17 }} onMouseEnter={ev => ev.currentTarget.style.color = "#DC2626"} onMouseLeave={ev => ev.currentTarget.style.color = "#C8BCA0"}>×</button>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "#a3a3a3", marginTop: 8, lineHeight: 1.7 }}>離開此頁或按「🔒 鎖定」會清掉記憶體中的明文。建議主密碼另外抄一份放安全的地方（忘了無法救回）。</div>

      {imp && (
        <div onClick={e => e.target === e.currentTarget && setImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 18, width: "min(680px,96vw)", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#211C15" }}>📋 批量匯入密碼</div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setImp(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6F6656" }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[["text", "貼上文字（私密）"], ["img", "截圖辨識（送AI）"]].map(([m, l]) => <button key={m} onClick={() => setImp(p => ({ ...p, mode: m, preview: null, err: "" }))} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${imp.mode === m ? "#b5512b" : "#e5e5e5"}`, background: imp.mode === m ? "#b5512b" : "#fff", color: imp.mode === m ? "#fff" : "#6F6656", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{l}</button>)}
            </div>
            {imp.mode === "text" ? (
              <>
                <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>從 Google 試算表整段框選複製、貼到下面（欄序：名稱→帳號→密碼→備註→連結；有「分類標題列」會自動辨識）。<b>此方式在你本機解析，不會外傳。</b></div>
                <textarea value={imp.text} onChange={e => setImp(p => ({ ...p, text: e.target.value, preview: null }))} placeholder="名稱（Tab）帳號（Tab）密碼（Tab）備註（Tab）連結…" rows={7} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "monospace" }} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: "#6F6656" }}>未標分類者歸到：</span>
                  <input value={imp.cat} onChange={e => setImp(p => ({ ...p, cat: e.target.value }))} list="vaultcats" style={{ ...inputStyle, width: 160, padding: "6px 8px" }} />
                  <button onClick={() => setImp(p => ({ ...p, preview: parsePaste(p.text, p.cat) }))} style={{ background: "#fff", color: "#b5512b", border: "1px solid #b5512b", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>解析預覽</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "#C2410C", background: "#FBEFE7", border: "1px solid #F0CFB8", borderRadius: 8, padding: "8px 10px", marginBottom: 8, lineHeight: 1.6 }}>⚠️ 截圖會送到 AI 辨識，<b>圖片裡的密碼會經過 AI 服務</b>。介意隱私請改用「貼上文字」。</div>
                <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) ocrImport(f); }} style={{ fontSize: 13 }} />
                {imp.busy && <div style={{ fontSize: 13, color: "#6F6656", marginTop: 8 }}>AI 辨識中…</div>}
              </>
            )}
            {imp.err && <div style={{ color: "#DC2626", fontSize: 12.5, marginTop: 8 }}>{imp.err}</div>}
            {imp.preview && (
              <div style={{ marginTop: 12, borderTop: sep, paddingTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#211C15", marginBottom: 6 }}>解析出 {imp.preview.length} 筆，預覽前 6 筆：</div>
                {imp.preview.slice(0, 6).map(r => <div key={r.id} style={{ fontSize: 12, color: "#4A4234", padding: "3px 0", borderBottom: "1px solid #F3EEE1" }}>[{r.cat}] {r.name} · {r.account} · {"•".repeat(Math.min(8, (r.password || "").length))}</div>)}
                <button onClick={() => runImport(imp.preview)} disabled={!imp.preview.length} style={{ marginTop: 10, background: imp.preview.length ? "#2E7D32" : "#e5e5e5", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: imp.preview.length ? "pointer" : "not-allowed" }}>✅ 匯入這 {imp.preview.length} 筆</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityLogPanel({ activityLog, onClose }) {
  const today = new Date().toLocaleDateString("zh-TW");
  const grouped = {};
  activityLog.forEach(a => {
    const d = new Date(a.ts).toLocaleDateString("zh-TW");
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(a);
  });
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:400, display:"flex", justifyContent:"flex-end" }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ width:"min(420px,100vw)", background:"#ffffff", height:"100vh", overflowY:"auto", borderLeft:"1px solid #e5e5e5" }}>
        <div style={{ padding:"14px 16px", borderBottom:"1px solid #e5e5e5", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, background:"#ffffff" }}>
          <div style={{ fontSize:15, fontWeight: 600, color:"#211C15" }}>活動記錄</div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#6F6656" }}>×</button>
        </div>
        <div style={{ padding:16 }}>
          {Object.keys(grouped).length === 0 && <div style={{ textAlign:"center", color:"#a3a3a3", padding:"40px 0" }}>尚無記錄</div>}
          {Object.entries(grouped).map(([date, entries]) => (
            <div key={date} style={{ marginBottom:20 }}>
              <div style={{ fontSize:12, color:"#6F6656", fontWeight: 600, marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ height:1, flex:1, background:"#e5e5e5" }} />
                {date === today ? "今天" : date}
                <div style={{ height:1, flex:1, background:"#e5e5e5" }} />
              </div>
              {entries.map((a, i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:10, alignItems:"flex-start" }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"#f0f0f0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>
                    {"👤"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, color:"#211C15" }}><span style={{ fontWeight: 600 }}>{maskAccount(a.user)}</span> {a.action}</div>
                    <div style={{ fontSize:11, color:"#6F6656" }}>{a.detail}</div>
                    <div style={{ fontSize:10, color:"#a3a3a3", marginTop:2 }}>{new Date(a.ts).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ── CALENDAR VIEW ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function CalendarView({ cats, setCats, settings, events, setEvents, userName }) {
  const [cursor, setCursor] = useState(new Date()); // month being viewed
  const [selectedDate, setSelectedDate] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month+1, 0);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const days = [];
  for (let i = 0; i < firstWeekday; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));

  const todayStr = new Date().toISOString().slice(0,10);
  const targetStr = settings?.targetDate || "";

  // Gather events per day
  const eventsForDay = (d) => {
    if (!d) return [];
    const ds = d.toISOString().slice(0,10);
    return events.filter(e => e.date === ds);
  };

  // Cat milestones: target date
  const milestonesForDay = (d) => {
    if (!d) return [];
    const ds = d.toISOString().slice(0,10);
    const results = [];
    if (ds === targetStr) results.push({ type:"target", label:"🎯 目標完工日", color:"#dc2626" });
    return results;
  };

  const WEEK = ["日","一","二","三","四","五","六"];

  const addEvent = (dateStr) => {
    setEditingEvent({ id: "evt-"+Date.now(), date: dateStr, title: "", catId: "", note: "", createdBy: userName });
    setShowEventModal(true);
  };

  const saveEvent = (evt) => {
    setEvents(prev => {
      const exists = prev.find(e => e.id === evt.id);
      if (exists) return prev.map(e => e.id === evt.id ? evt : e);
      return [...prev, evt];
    });
    setShowEventModal(false); setEditingEvent(null);
  };

  const deleteEvent = (id) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    setShowEventModal(false); setEditingEvent(null);
  };

  return (
    <div style={{ paddingTop:16, maxWidth:1000, margin:"0 auto" }}>
      {/* header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
        <div style={{ fontSize:20, fontWeight: 600, color:"#211C15" }}>📅 行事曆</div>
        <div style={{ flex:1 }} />
        <button onClick={()=>setCursor(new Date(year, month-1, 1))} style={{ padding:"6px 10px", background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:8, cursor:"pointer", fontSize:13 }}>←</button>
        <div style={{ fontSize:15, fontWeight: 600, color:"#211C15", minWidth:120, textAlign:"center" }}>{year}年 {month+1}月</div>
        <button onClick={()=>setCursor(new Date(year, month+1, 1))} style={{ padding:"6px 10px", background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:8, cursor:"pointer", fontSize:13 }}>→</button>
        <button onClick={()=>setCursor(new Date())} style={{ padding:"6px 14px", background:ACCENT, border:"none", borderRadius:8, cursor:"pointer", fontSize:12, color:"#211C15", fontWeight: 600 }}>今天</button>
      </div>

      {/* weekday headers */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4 }}>
        {WEEK.map((w,i) => (
          <div key={w} style={{ padding:"6px 0", textAlign:"center", fontSize:11, fontWeight: 600, color: i===0||i===6?"#dc2626":"#6F6656" }}>{w}</div>
        ))}
      </div>

      {/* days grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
        {days.map((d, i) => {
          if (!d) return <div key={i} style={{ minHeight:96, background:"transparent" }} />;
          const ds = d.toISOString().slice(0,10);
          const isToday = ds === todayStr;
          const isWeekend = d.getDay()===0 || d.getDay()===6;
          const evs = eventsForDay(d);
          const miles = milestonesForDay(d);
          return (
            <div key={i} onClick={()=>addEvent(ds)}
              style={{ minHeight:96, background:"#ffffff", border:`1px solid ${isToday?ACCENT:"#e5e5e5"}`, borderWidth:isToday?2:1, borderRadius:8, padding:6, cursor:"pointer", transition:"background 0.15s", display:"flex", flexDirection:"column", gap:3 }}
              onMouseEnter={e=>e.currentTarget.style.background="#ffffff"}
              onMouseLeave={e=>e.currentTarget.style.background="#ffffff"}
            >
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:13, fontWeight:isToday?900:600, color: isToday?ACCENT:isWeekend?"#dc2626":"#4A4234" }}>{d.getDate()}</div>
                {evs.length>0 && <div style={{ fontSize:10, background:"#eff6ff", color:"#92400e", borderRadius:10, padding:"0 6px", fontWeight: 600 }}>{evs.length}</div>}
              </div>
              {miles.map((m,mi) => (
                <div key={mi} style={{ fontSize:10, background:m.color+"20", color:m.color, borderRadius:4, padding:"1px 4px", fontWeight: 600 }}>{m.label}</div>
              ))}
              {evs.slice(0,3).map((e,ei) => (
                <div key={ei} onClick={ev=>{ev.stopPropagation(); setEditingEvent(e); setShowEventModal(true);}}
                  style={{ fontSize:10, background:"#eff6ff", color:"#1e40af", borderRadius:4, padding:"1px 5px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", border:"1px solid #bfdbfe" }}>
                  {e.title || "(未命名)"}
                </div>
              ))}
              {evs.length>3 && <div style={{ fontSize:9, color:"#a3a3a3" }}>+{evs.length-3} 更多</div>}
            </div>
          );
        })}
      </div>

      {/* legend */}
      <div style={{ marginTop:12, display:"flex", gap:14, fontSize:11, color:"#6F6656" }}>
        <div><span style={{ display:"inline-block", width:10, height:10, background:ACCENT, borderRadius:2, marginRight:4, verticalAlign:"middle" }} />今天</div>
        <div>🎯 目標完工日</div>
        <div>點擊日期可新增事件，點擊事件可編輯</div>
      </div>

      {/* event modal */}
      {showEventModal && editingEvent && (
        <EventEditModal event={editingEvent} setEvent={setEditingEvent} cats={cats} onSave={saveEvent} onDelete={deleteEvent} onClose={()=>{setShowEventModal(false); setEditingEvent(null);}} />
      )}
    </div>
  );
}

function EventEditModal({ event, setEvent, cats, onSave, onDelete, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"#ffffff", borderRadius:14, padding:22, maxWidth:420, width:"100%", boxShadow:"0 10px 40px rgba(0,0,0,0.15)" }}>
        <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>📅 {event.title?"編輯":"新增"}事件</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>日期</div>
            <input type="date" value={event.date||""} onChange={e=>setEvent({...event, date:e.target.value})}
              style={{ width:"100%", padding:"8px 10px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>事件標題 *</div>
            <input value={event.title||""} onChange={e=>setEvent({...event, title:e.target.value})}
              placeholder="例如：磁磚到貨、業主驗收、停工..."
              style={{ width:"100%", padding:"9px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} autoFocus />
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯工程（選填）</div>
            <select value={event.catId||""} onChange={e=>{
              const cat = cats.find(c=>c.id===e.target.value);
              setEvent({...event, catId:e.target.value, catName:cat?.name||""});
            }}
              style={{ width:"100%", padding:"8px 10px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#ffffff" }}>
              <option value="">— 未關聯 —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>備註</div>
            <textarea value={event.note||""} onChange={e=>setEvent({...event, note:e.target.value})}
              placeholder="備註..."
              style={{ width:"100%", padding:"8px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:70, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:18 }}>
          {event.createdBy && <button onClick={()=>onDelete(event.id)} style={{ padding:"10px 14px", background:"#eff6ff", border:"1px solid #fca5a5", borderRadius:8, color:"#dc2626", fontSize:13, cursor:"pointer", fontWeight:600 }}>刪除</button>}
          <div style={{ flex:1 }} />
          <button onClick={onClose} style={{ padding:"10px 16px", background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
          <button onClick={()=>event.title&&onSave(event)} disabled={!event.title} style={{ padding:"10px 20px", background:event.title?"#211C15":"#e5e5e5", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:event.title?"pointer":"not-allowed" }}>儲存</button>
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ── JOURNAL VIEW (工作日誌) ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function JournalView({ journal, setJournal, cats, userName }) {
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title:"", content:"", catId:"", weather:"", date:new Date().toISOString().slice(0,10), workers:"", issues:"" });
  const [filter, setFilter] = useState("");

  const sorted = [...journal].sort((a,b) => (b.date||"").localeCompare(a.date||""));
  const filtered = filter ? sorted.filter(j => (j.title+j.content+j.catName).toLowerCase().includes(filter.toLowerCase())) : sorted;

  const save = () => {
    if (!draft.title && !draft.content) { setShowNew(false); return; }
    const cat = cats.find(c=>c.id===draft.catId);
    const entry = {
      id: "j-" + Date.now(),
      ...draft,
      catName: cat?.name || "",
      author: userName,
      createdAt: new Date().toISOString(),
    };
    setJournal(prev => [entry, ...prev]);
    notifyLineEvent("journal", `📓 ${entry.author || "有人"} 新增日誌：「${entry.title || "(無標題)"}」\n${(entry.content || "").slice(0, 80)}${(entry.content || "").length > 80 ? "..." : ""}`);
    setShowNew(false);
    setDraft({ title:"", content:"", catId:"", weather:"", date:new Date().toISOString().slice(0,10), workers:"", issues:"" });
  };

  const remove = (id) => {
    setJournal(prev => prev.filter(j => j.id !== id));
  };

  return (
    <div style={{ paddingTop:16, maxWidth:880, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ fontSize:20, fontWeight: 600, color:"#211C15" }}>📓 工作日誌</div>
        <div style={{ fontSize:12, color:"#6F6656" }}>共 {journal.length} 筆記錄</div>
        <div style={{ flex:1 }} />
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="搜尋…"
          style={{ padding:"7px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", width:180, fontFamily:"'Noto Sans TC',sans-serif" }} />
        <button onClick={()=>setShowNew(true)} style={{ padding:"8px 16px", background:"#211C15", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer" }}>+ 新增日誌</button>
      </div>

      {filtered.length === 0 && (
        <div style={{ background:"#ffffff", border:"1px dashed #e5e5e5", borderRadius:14, padding:"60px 20px", textAlign:"center", color:"#a3a3a3" }}>
          <div style={{ fontSize:40, marginBottom:10 }}>📓</div>
          <div style={{ fontSize:14 }}>尚無日誌記錄，點擊右上「+ 新增日誌」開始記錄</div>
        </div>
      )}

      {filtered.map(j => (
        <div key={j.id} style={{ background:"#ffffff", border:"1px solid #e5e5e5", borderRadius:14, padding:18, marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:8 }}>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <div style={{ fontSize:15, fontWeight: 600, color:"#211C15" }}>{j.title||"(無標題)"}</div>
                {j.catName && <span style={{ fontSize:10, background:"#eff6ff", color:"#92400e", borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>{j.catName}</span>}
              </div>
              <div style={{ fontSize:11, color:"#a3a3a3", display:"flex", gap:10, flexWrap:"wrap" }}>
                <span>📅 {j.date}</span>
                {j.author && <span>✍️ {j.author}</span>}
                {j.weather && <span>🌤 {j.weather}</span>}
                {j.workers && <span>👷 {j.workers}</span>}
              </div>
            </div>
            <button onClick={()=>remove(j.id)} style={{ background:"none", border:"none", color:"#d1d5db", cursor:"pointer", fontSize:16, padding:0 }}>×</button>
          </div>
          {j.content && <div style={{ fontSize:13, lineHeight:1.8, color:"#4A4234", whiteSpace:"pre-wrap", marginTop:10 }}>{j.content}</div>}
          {j.issues && (
            <div style={{ marginTop:10, padding:"8px 12px", background:"#eff6ff", border:"1px solid #fca5a5", borderRadius:8, fontSize:12, color:"#991b1b" }}>
              <strong>⚠️ 問題/待處理：</strong> {j.issues}
            </div>
          )}
        </div>
      ))}

      {/* New entry modal */}
      {showNew && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&setShowNew(false)}>
          <div style={{ background:"#ffffff", borderRadius:14, padding:22, maxWidth:520, width:"100%", maxHeight:"88vh", overflow:"auto" }}>
            <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>📓 新增工作日誌</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>日期</div>
                <input type="date" value={draft.date} onChange={e=>setDraft({...draft, date:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>天氣</div>
                <input value={draft.weather} onChange={e=>setDraft({...draft, weather:e.target.value})} placeholder="晴 / 雨 / 陰"
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>標題</div>
              <input value={draft.title} onChange={e=>setDraft({...draft, title:e.target.value})} placeholder="例如：廚房地坪灌漿完成..."
                style={{ width:"100%", padding:"9px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} autoFocus />
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯工程</div>
              <select value={draft.catId} onChange={e=>setDraft({...draft, catId:e.target.value})}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#ffffff" }}>
                <option value="">— 未指定 —</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>現場人員</div>
              <input value={draft.workers} onChange={e=>setDraft({...draft, workers:e.target.value})} placeholder="例如：水電2人、泥作3人"
                style={{ width:"100%", padding:"8px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>內容</div>
              <textarea value={draft.content} onChange={e=>setDraft({...draft, content:e.target.value})}
                placeholder="今日完成什麼？遇到什麼？&#10;可記錄：進度、用料、人員、照片說明、重要決策..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:120, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif", lineHeight:1.7 }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>⚠️ 問題/待處理</div>
              <textarea value={draft.issues} onChange={e=>setDraft({...draft, issues:e.target.value})}
                placeholder="需要上級決策、材料短缺、工序卡關..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:60, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }} />
              <button onClick={()=>setShowNew(false)} style={{ padding:"10px 16px", background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
              <button onClick={save} style={{ padding:"10px 22px", background:"#211C15", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer" }}>儲存日誌</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ── PLAN VIEW (排程規劃) ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function PlanView({ cats, setCats, plans, setPlans, settings, userName }) {
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title:"", description:"", priority:"中", dueDate:"", catId:"", assignee:"", done:false });
  const [filter, setFilter] = useState("pending"); // pending | all | done

  const priorityOrder = { "高":1, "中":2, "低":3 };
  const sorted = [...plans].sort((a,b) => {
    if (a.done !== b.done) return a.done?1:-1;
    const p = (priorityOrder[a.priority]||2) - (priorityOrder[b.priority]||2);
    if (p !== 0) return p;
    return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");
  });
  const filtered = filter === "all" ? sorted : filter === "done" ? sorted.filter(p=>p.done) : sorted.filter(p=>!p.done);

  const save = () => {
    if (!draft.title) { setShowNew(false); return; }
    const cat = cats.find(c=>c.id===draft.catId);
    const entry = {
      id: "plan-" + Date.now(),
      ...draft,
      catName: cat?.name || "",
      createdBy: userName,
      createdAt: new Date().toISOString(),
    };
    setPlans(prev => [...prev, entry]);
    setShowNew(false);
    setDraft({ title:"", description:"", priority:"中", dueDate:"", catId:"", assignee:"", done:false });
  };

  const toggleDone = (id) => {
    setPlans(prev => prev.map(p => p.id === id ? {...p, done:!p.done, doneAt: !p.done ? new Date().toISOString() : null} : p));
  };

  const remove = (id) => {
    setPlans(prev => prev.filter(p => p.id !== id));
  };

  const todayStr = new Date().toISOString().slice(0,10);
  const overdueCount = plans.filter(p => !p.done && p.dueDate && p.dueDate < todayStr).length;
  const highCount = plans.filter(p => !p.done && p.priority === "高").length;

  const priorityColor = { "高":"#dc2626", "中":"#f59e0b", "低":"#6F6656" };

  return (
    <div style={{ paddingTop:16, maxWidth:900, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ fontSize:20, fontWeight: 600, color:"#211C15" }}>🗓 排程規劃</div>
        <div style={{ fontSize:12, color:"#6F6656" }}>待處理 {plans.filter(p=>!p.done).length} · 已完成 {plans.filter(p=>p.done).length}</div>
        <div style={{ flex:1 }} />
        <button onClick={()=>setShowNew(true)} style={{ padding:"8px 16px", background:"#211C15", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer" }}>+ 新增任務</button>
      </div>

      {/* summary */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        {overdueCount>0 && <div style={{ background:"#eff6ff", border:"1px solid #fca5a5", borderRadius:20, padding:"5px 14px", fontSize:12, color:"#dc2626", fontWeight: 600 }}>⏰ 逾期 {overdueCount} 項</div>}
        {highCount>0 && <div style={{ background:"#fef3c7", border:"1px solid #fcd34d", borderRadius:20, padding:"5px 14px", fontSize:12, color:"#92400e", fontWeight: 600 }}>🔥 高優先 {highCount} 項</div>}
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:4 }}>
          {[["pending","待處理"],["done","已完成"],["all","全部"]].map(([k,l]) => (
            <button key={k} onClick={()=>setFilter(k)} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, border:"1px solid #e5e5e5", cursor:"pointer", background:filter===k?ACCENT:"#f5f5f5", color:filter===k?"#ffffff":"#6F6656", fontWeight:filter===k?700:400 }}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{ background:"#ffffff", border:"1px dashed #e5e5e5", borderRadius:14, padding:"50px 20px", textAlign:"center", color:"#a3a3a3" }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🗓</div>
          <div style={{ fontSize:14 }}>{filter==="done"?"尚無已完成任務":filter==="pending"?"沒有待處理任務，太棒了！":"尚無任務"}</div>
        </div>
      )}

      {filtered.map(p => {
        const isOverdue = !p.done && p.dueDate && p.dueDate < todayStr;
        return (
          <div key={p.id} style={{ background:"#ffffff", border:`1px solid ${isOverdue?"#fca5a5":"#e5e5e5"}`, borderLeft:`4px solid ${p.done?"#3C8C3C":priorityColor[p.priority]||"#6F6656"}`, borderRadius:12, padding:"12px 16px", marginBottom:10, display:"flex", alignItems:"flex-start", gap:12, opacity:p.done?0.6:1 }}>
            <input type="checkbox" checked={!!p.done} onChange={()=>toggleDone(p.id)}
              style={{ width:18, height:18, marginTop:3, cursor:"pointer", accentColor:"#3C8C3C", flexShrink:0 }} />
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                <div style={{ fontSize:14, fontWeight: 600, color:p.done?"#a3a3a3":"#211C15", textDecoration:p.done?"line-through":"none" }}>{p.title}</div>
                <span style={{ fontSize:10, background:priorityColor[p.priority]+"22", color:priorityColor[p.priority], borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>{p.priority}</span>
                {p.catName && <span style={{ fontSize:10, background:"#eff6ff", color:"#1e40af", borderRadius:10, padding:"1px 8px" }}>{p.catName}</span>}
                {isOverdue && <span style={{ fontSize:10, background:"#eff6ff", color:"#dc2626", borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>⏰ 逾期</span>}
              </div>
              {p.description && <div style={{ fontSize:12, color:"#6F6656", lineHeight:1.7, marginBottom:4 }}>{p.description}</div>}
              <div style={{ fontSize:11, color:"#a3a3a3", display:"flex", gap:12, flexWrap:"wrap" }}>
                {p.dueDate && <span>📅 {p.dueDate}</span>}
                {p.assignee && <span>👤 {p.assignee}</span>}
                {p.createdBy && <span>✍️ {p.createdBy}</span>}
              </div>
            </div>
            <button onClick={()=>remove(p.id)} style={{ background:"none", border:"none", color:"#d1d5db", cursor:"pointer", fontSize:16, padding:0 }}>×</button>
          </div>
        );
      })}

      {/* New task modal */}
      {showNew && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&setShowNew(false)}>
          <div style={{ background:"#ffffff", borderRadius:14, padding:22, maxWidth:460, width:"100%", maxHeight:"88vh", overflow:"auto" }}>
            <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>🗓 新增排程任務</div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>任務標題 *</div>
              <input value={draft.title} onChange={e=>setDraft({...draft, title:e.target.value})} placeholder="例如：下週前確認磁磚廠商..." autoFocus
                style={{ width:"100%", padding:"9px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>優先度</div>
                <select value={draft.priority} onChange={e=>setDraft({...draft, priority:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#ffffff" }}>
                  <option>高</option><option>中</option><option>低</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>截止日</div>
                <input type="date" value={draft.dueDate} onChange={e=>setDraft({...draft, dueDate:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯工程</div>
              <select value={draft.catId} onChange={e=>setDraft({...draft, catId:e.target.value})}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#ffffff" }}>
                <option value="">— 未指定 —</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>負責人</div>
              <input value={draft.assignee} onChange={e=>setDraft({...draft, assignee:e.target.value})} placeholder="誰要做？"
                style={{ width:"100%", padding:"8px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>描述</div>
              <textarea value={draft.description} onChange={e=>setDraft({...draft, description:e.target.value})}
                placeholder="詳細說明..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:70, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }} />
              <button onClick={()=>setShowNew(false)} style={{ padding:"10px 16px", background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
              <button onClick={save} style={{ padding:"10px 22px", background:"#211C15", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer" }}>建立任務</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── KANBAN ─────────────────────────────────────────────────────────────────────
function KanbanView({ cats, setCats, onSelect, dragging, dragOver, onDragStart, onDragOver, onDrop, confirm }) {
  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 12 }}>拖曳卡片可調整工序順序</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px,100%),1fr))", gap: 12 }}>
        {[...cats].sort((a,b) => a.order - b.order).map(cat => {
          const done = cat.items.filter(i => i.status === "done").length;
          const pct = cat.items.length ? Math.round(done / cat.items.length * 100) : 0;
          const st = STATUS_MAP[cat.status] || STATUS_MAP.pending;
          const isDragOver = dragOver === cat.id;
          return (
            <div
              key={cat.id}
              draggable
              onDragStart={() => onDragStart(cat.id)}
              onDragOver={(e) => { e.preventDefault(); onDragOver(cat.id); }}
              onDrop={() => onDrop(cat.id)}
              onClick={() => onSelect(cat)}
              style={{ background: isDragOver ? "#e8edf8" : "#ffffff", border: `1px solid ${isDragOver ? ACCENT : "#e5e5e5"}`, borderRadius: 12, padding: 14, cursor: "grab", transition: "border-color 0.2s, transform 0.15s", transform: dragging === cat.id ? "scale(0.97) rotate(-1deg)" : "none", userSelect: "none", position: "relative" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <input
                  value={cat.name}
                  onChange={e => { e.stopPropagation(); setCats(prev => prev.map(c => c.id === cat.id ? {...c, name: e.target.value} : c)); }}
                  onClick={e => e.stopPropagation()}
                  style={{ fontSize: 14, fontWeight: 600, color: "#211C15", flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "'Noto Sans TC', sans-serif", cursor: "text", minWidth: 0 }}
                />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <StatusBadge status={cat.status} setCats={setCats} catId={cat.id} />
                  <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }} onClick={e => { e.stopPropagation(); e.preventDefault(); confirm(`確定刪除「${cat.name}」？\n此操作無法復原。`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== cat.id)); }); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#eff6ff", border: "1px solid rgba(193,58,34,0.25)", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer", lineHeight: 1, flexShrink: 0, padding: 0 }} title="刪除此工程">×</button>
                </div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 13, color: ACCENT, marginBottom: 8 }}>{fmt(cat.items.reduce((s,it) => s + calcEstimated(it), 0))}</div>
              <div style={{ background: "#e2e4ec", borderRadius: 4, height: 5, marginBottom: 6, overflow: "hidden" }}>
                <div style={{ background: pct === 100 ? "#3C8C3C" : "#3E72A8", width: pct + "%", height: "100%", transition: "width 0.4s" }} />
              </div>
              <div style={{ fontSize: 11, color: "#6F6656" }}>{done}/{cat.items.length} 細項完成 · {pct}%</div>
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {Object.entries(STATUS_MAP).map(([k, v]) => {
                  const cnt = cat.items.filter(i => i.status === k).length;
                  if (!cnt) return null;
                  return <span key={k} style={{ fontSize: 10, color: v.color, background: v.color + "18", border: "1px solid " + v.color + "44", borderRadius: 10, padding: "1px 7px" }}>{v.label} {cnt}</span>;
                })}
              </div>
              {cat.items.some(i => i.notes?.includes("⚠️")) && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#C2872E", background: "#fff7ee", borderRadius: 4, padding: "3px 8px" }}>⚠️ 含待確認項目</div>
              )}
            </div>
          );
        })}
      {/* Add new category card */}
        <div
          onClick={() => {
            const id = "cat-" + Date.now();
            const newCat = { id, order: cats.length, name: "新"+L("cat"), budget: 0, status: "pending", items: [] };
            setCats(prev => [...prev, newCat]);
          }}
          style={{ background: "#ffffff", border: "1px dashed rgba(193,58,34,0.3)", borderRadius: 12, padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 120, gap: 8, transition: "border-color 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
          onMouseLeave={e => e.currentTarget.style.borderColor="rgba(193,58,34,0.3)"}
        >
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff8e6", border: "1px solid rgba(193,58,34,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: ACCENT }}>+</div>
          <div style={{ fontSize: 13, color: "#6F6656" }}>新增{L("cat")}</div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, setCats, catId, itemId }) {
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
          <div style={{ position: "fixed", left: Math.min(pos.x, window.innerWidth - 130), top: Math.min(pos.y, window.innerHeight - 220), background: "#fff", border: "1px solid #e5e5e5", borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,.18)", minWidth: 110, overflow: "hidden" }}>
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <div key={k} onClick={(e) => { e.stopPropagation(); pick(k); }} style={{ padding: "8px 14px", cursor: "pointer", color: v.color, fontSize: 13, fontWeight: 600, borderBottom: "1px solid #f0f0f0" }} onMouseEnter={e => e.currentTarget.style.background = "#f5f5f5"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>{v.label}</div>
            ))}
          </div>
        </div>, document.body
      )}
    </>
  );
}

// ── LINE 通知設定區塊（AI設定 → 專案設定）────────────────────────────────────
function LineNotifySettings({ settings, upd, cats, journal, events, plans }) {
  const [busy, setBusy] = useState(false);
  const [wbusy, setWbusy] = useState(false);
  const [msg, setMsg] = useState("");
  const groupId = settings.lineGroupId ?? DEFAULT_LINE_GROUP;
  const notify = settings.lineNotify || {};
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 4500); };
  const toggle = (k) => upd("lineNotify", { ...notify, [k]: !notify[k] });

  const test = async () => {
    setBusy(true);
    const r = await sendLineNotify(`🔔 GROUN:D 工程管理 — LINE 通知測試\n專案：${settings.projectName || "（未命名）"}\n時間：${new Date().toLocaleString("zh-TW")}`);
    setBusy(false);
    flash(r && r.ok ? "✅ 已送出，請查看 LINE 群組" : `⚠️ 發送失敗：${r?.error || r?.reason || "請確認群組 ID 與 webhook"}`);
  };
  const pushWeekly = async () => {
    setWbusy(true);
    flash("🤖 AI 產生週報中…");
    try {
      const system = buildAdvisorSystem(settings, cats, journal || [], events || [], plans || []);
      const text = await callAI([{ role: "user", content: "請為業主產生一份精簡的本週工程進度週報（約 300 字內，含：整體狀況一句話、各大項進度、本週重點、待決問題、下週預計、整體評估🟢/🟡/🔴）。用業主能懂的口吻，純文字、適合在 LINE 閱讀。" }], system, "weekly");
      const r = await sendLineNotify("📋 本週工程進度週報\n\n" + text);
      flash(r && r.ok ? "✅ 週報已推送到 LINE 群組" : `⚠️ 推送失敗：${r?.error || r?.reason || "請確認群組 ID"}`);
    } catch (e) { flash("⚠️ 產生失敗：" + e.message); }
    setWbusy(false);
  };

  return (
    <div style={{ background: "#ffffff", border: "1px solid #e5e5e5", borderRadius: 12, padding: "20px" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#211C15", marginBottom: 4 }}>💬 LINE 通知</div>
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 14 }}>設定推播群組與各類事件通知（設定儲存於共用空間，供伺服器排程使用）</div>

      <div style={{ fontSize: 12.5, color: "#4A4234", fontWeight: 600, marginBottom: 6 }}>LINE 群組 ID</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <input value={groupId} onChange={e => upd("lineGroupId", e.target.value)} placeholder="群組 ID" style={{ flex: 1, minWidth: 200, border: "1px solid #e5e5e5", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "monospace" }} />
        <button onClick={test} disabled={busy} style={{ border: "none", background: "#06C755", color: "#fff", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>{busy ? "傳送中…" : "測試推送"}</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("✅") ? "#3C8C3C" : msg.startsWith("⚠️") ? "#C0392B" : "#6F6656", marginBottom: 10 }}>{msg}</div>}

      <div style={{ fontSize: 12.5, color: "#4A4234", fontWeight: 600, margin: "14px 0 6px" }}>通知開關</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {LINE_EVENTS.map(([k, label]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", cursor: "pointer", fontSize: 13.5, color: "#211C15", borderBottom: "1px solid #f5f5f5" }}>
            <input type="checkbox" checked={!!notify[k]} onChange={() => toggle(k)} style={{ width: 18, height: 18, accentColor: ACCENT, flexShrink: 0 }} />
            {label}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 8, lineHeight: 1.6 }}>※「有問題 / 完工 / 新日誌」由系統即時推播；「卡關 / 週五週報 / 截止日」為時間排程，由 webhook 伺服器依此設定推播。</div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f0f0f0" }}>
        <button onClick={pushWeekly} disabled={wbusy} style={{ border: "none", background: "#211C15", color: "#fff", borderRadius: 9, padding: "11px 18px", fontSize: 13.5, fontWeight: 600, cursor: wbusy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>{wbusy ? "產生中…" : "📋 立即推送業主週報到 LINE"}</button>
      </div>
    </div>
  );
}

// ── ADVISOR SETTINGS VIEW ────────────────────────────────────────────────────
// ── D哥(LINE bot) 用量 / 估算花費 ────────────────────────────────────────────
const BOT_MODEL_PRICE = { "claude-opus-4-8": [5, 25], "claude-sonnet-4-6": [3, 15], "claude-sonnet-4-5": [3, 15], "claude-haiku-4-5": [1, 5] };
const botPriceFor = (m) => { const k = String(m || "").replace(/-\d{6,}$/, ""); for (const key in BOT_MODEL_PRICE) if (k.startsWith(key)) return BOT_MODEL_PRICE[key]; return [3, 15]; };
const botUsdOf = (m, inTok, outTok) => { const [pi, po] = botPriceFor(m); return (Number(inTok) || 0) / 1e6 * pi + (Number(outTok) || 0) / 1e6 * po; };
function BotUsagePanel() {
  const [data, setData] = useState(null);
  const load = async () => { try { const r = await window.storage.get(K("pm_bot_aiusage"), true); setData(r && r.value ? JSON.parse(r.value) : {}); } catch (_) { setData({}); } };
  useEffect(() => { load(); }, []);
  if (data === null) return null;
  const total = data.total || { calls: 0, inTok: 0, outTok: 0 };
  const rows = Object.entries(data.byModel || {}).map(([m, v]) => ({ m: m.replace(/-\d{6,}$/, ""), calls: v.calls || 0, inTok: v.inTok || 0, outTok: v.outTok || 0, usd: botUsdOf(m, v.inTok, v.outTok) })).sort((a, b) => b.usd - a.usd);
  const totUsd = rows.reduce((s, r) => s + r.usd, 0);
  const twd = totUsd * USD_TWD;
  const card = (label, val, sub) => (
    <div style={{ flex: 1, minWidth: 130, background: "#FBF0EC", border: "1px solid #E6C9BE", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#211C15", letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>{val}</div>
      <div style={{ fontSize: 11, color: "#6F6656", marginTop: 2 }}>{label}{sub && <span style={{ color: "#a3a3a3" }}> {sub}</span>}</div>
    </div>
  );
  return (
    <div style={{ background: "#ffffff", border: `1px solid ${ACCENT}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ background: "#1A1A1A", color: "#fff", fontSize: 12, fontWeight: 800, borderRadius: 6, padding: "3px 8px" }}>:D</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>D哥（LINE bot）用量 / 估算花費</div>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={{ fontSize: 12, border: "1px solid #e5e5e5", background: "#f5f5f5", color: "#6F6656", borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>↻ 重新整理</button>
      </div>
      <div style={{ background: "#FBF0EC", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#6F6656", marginBottom: 14 }}>
        D哥 在 LINE（守門 + 思考 + 彙報 + 監控）累計呼叫 Anthropic API 的<b style={{ color: ACCENT }}>估算</b>花費。<b>這是主要花費。</b>精確帳以 platform.claude.com → Usage（篩 ground-bot key）為準。
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {card("估算總花費（USD）", "$" + totUsd.toFixed(3))}
        {card("估算總花費（TWD）", "NT$" + Math.round(twd).toLocaleString(), `@${USD_TWD}`)}
        {card("AI 呼叫次數", (total.calls || 0).toLocaleString())}
        {card("總 tokens（in+out）", ((total.inTok || 0) + (total.outTok || 0)).toLocaleString())}
      </div>
      {rows.length > 0 ? (
        <div style={{ border: "1px solid #E3DAC6", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", background: "#f5f5f5", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>模型（錢花在哪）</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div>
          </div>
          {rows.map((r) => (
            <div key={r.m} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #f0f0f0", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.m}{/haiku/.test(r.m) ? "（守門/監控）" : /sonnet/.test(r.m) ? "（主力思考）" : ""}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{r.calls}</div>
              <div style={{ flex: 1.4, textAlign: "right" }}>{(r.inTok + r.outTok).toLocaleString()}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace" }}>${r.usd.toFixed(3)}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace", color: ACCENT }}>{Math.round(r.usd * USD_TWD).toLocaleString()}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#a3a3a3", textAlign: "center", padding: "12px 0" }}>尚無紀錄（從 v7.5 起累計；D哥 之後每次在 LINE 動作就會記）</div>
      )}
      <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 10 }}>{data.since ? `自 ${String(data.since).slice(0, 10)} 起累計` : ""}　⚠ 估算值，精確帳以 Console（ground-bot key）為準。</div>
    </div>
  );
}

// ── AI 用量 / 估算花費面板 ───────────────────────────────────────────────────
function AIUsagePanel() {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try { const r = await window.storage.get(K("pm_ai_usage"), true); setLog(r && r.value ? JSON.parse(r.value) : []); }
    catch (_) { setLog([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const totUsd = log.reduce((s, e) => s + (Number(e.usd) || 0), 0);
  const totIn = log.reduce((s, e) => s + (Number(e.inTok) || 0), 0);
  const totOut = log.reduce((s, e) => s + (Number(e.outTok) || 0), 0);
  const calls = log.length;
  const twd = totUsd * USD_TWD;
  // 依模型細分
  const byModel = {};
  for (const e of log) {
    const k = (e.model || "?").replace(/-\d{6,}$/, "");
    if (!byModel[k]) byModel[k] = { calls: 0, inTok: 0, outTok: 0, usd: 0 };
    byModel[k].calls++; byModel[k].inTok += Number(e.inTok) || 0; byModel[k].outTok += Number(e.outTok) || 0; byModel[k].usd += Number(e.usd) || 0;
  }
  const models = Object.entries(byModel).sort((a, b) => b[1].usd - a[1].usd);
  // 依用途細分（AI顧問對話/PDF匯入/週報/比價/日誌整理）
  const byKind = {};
  for (const e of log) {
    const k = e.kind || "chat";
    if (!byKind[k]) byKind[k] = { calls: 0, tok: 0, usd: 0 };
    byKind[k].calls++; byKind[k].tok += (Number(e.inTok) || 0) + (Number(e.outTok) || 0); byKind[k].usd += Number(e.usd) || 0;
  }
  const kinds = Object.entries(byKind).sort((a, b) => b[1].usd - a[1].usd);

  const card = (label, val, sub) => (
    <div style={{ flex: 1, minWidth: 130, background: "#FBF7EE", border: "1px solid #E3DAC6", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#211C15", letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>{val}</div>
      <div style={{ fontSize: 11, color: "#6F6656", marginTop: 2 }}>{label}{sub && <span style={{ color: "#a3a3a3" }}> {sub}</span>}</div>
    </div>
  );

  return (
    <div style={{ background: "#ffffff", border: "1px solid #e5e5e5", borderRadius: 12, padding: 20, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ background: ACCENT, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "2px 7px" }}>AI</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>AI 用量 / 估算花費</div>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={{ fontSize: 12, border: "1px solid #e5e5e5", background: "#f5f5f5", color: "#6F6656", borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>↻ 重新整理</button>
      </div>
      <div style={{ background: "#f5f5f5", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#6F6656", marginBottom: 14 }}>
        本 App 自己呼叫 Anthropic <b>API</b>（非群組）的累計用量與<b style={{ color: ACCENT }}>估算</b>花費。LINE 群組產生的花費屬 bot 端帳，這裡看不到；Claude 訂閱／Claude Code 也是另一套帳。
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {card("估算總花費（USD）", "$" + totUsd.toFixed(3))}
        {card("估算總花費（TWD）", "NT$" + Math.round(twd).toLocaleString(), `@${USD_TWD}`)}
        {card("AI 呼叫次數", calls.toLocaleString())}
        {card("總 tokens（in+out）", (totIn + totOut).toLocaleString())}
      </div>
      {kinds.length > 0 && (
        <div style={{ border: "1px solid #E3DAC6", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ display: "flex", background: "#f5f5f5", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>用途（錢主要花在哪）</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div><div style={{ flex: 1, textAlign: "right" }}>占比</div>
          </div>
          {kinds.map(([k, v]) => (
            <div key={k} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #f0f0f0", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{KIND_LABEL[k] || k}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{v.calls}</div>
              <div style={{ flex: 1.4, textAlign: "right" }}>{v.tok.toLocaleString()}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace" }}>${v.usd.toFixed(3)}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace", color: ACCENT }}>{Math.round(v.usd * USD_TWD).toLocaleString()}</div>
              <div style={{ flex: 1, textAlign: "right", color: "#6F6656" }}>{totUsd > 0 ? Math.round(v.usd / totUsd * 100) : 0}%</div>
            </div>
          ))}
        </div>
      )}
      {models.length > 0 && (
        <div style={{ border: "1px solid #E3DAC6", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", background: "#f5f5f5", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>模型</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div>
          </div>
          {models.map(([m, v]) => (
            <div key={m} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #f0f0f0", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{v.calls}</div>
              <div style={{ flex: 1.4, textAlign: "right" }}>{(v.inTok + v.outTok).toLocaleString()}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace" }}>${v.usd.toFixed(3)}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace", color: ACCENT }}>{Math.round(v.usd * USD_TWD).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      {!loading && calls === 0 && <div style={{ fontSize: 12, color: "#a3a3a3", textAlign: "center", padding: "12px 0" }}>尚無 AI 呼叫紀錄（用過 AI 顧問或匯入後會自動累計）</div>}
      <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 10 }}>⚠ 為前端估算值，精確帳務請以 platform.claude.com → Usage 為準。</div>
    </div>
  );
}

function AdvisorSettingsView({ settings, setSettings, cats, aiLog, setAiLog, activityLog, logActivity, userName, journal, events, plans }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const upd = (field, val) => setSettings({ ...settings, [field]: val });
  const fieldStyle = { width:"100%", padding:"9px 12px", border:"1px solid #e5e5e5", borderRadius:8, fontSize:13, color:"#211C15", outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", background:"#f9fafb" };
  const docs = settings.aiDocs || [];
  const addDocs = async (files) => {
    const arr = Array.from(files || []); if (!arr.length) return;
    setBusy(true);
    const out = [];
    for (const f of arr) { try { const { url, path } = await uploadPhoto(f); out.push({ id:"doc-"+Math.random().toString(36).slice(2,8), url, path, name:f.name||"檔案", isImage:!!(f.type||"").startsWith("image/") }); } catch(_){} }
    setBusy(false);
    if (out.length) upd("aiDocs", [...docs, ...out]);
  };
  const delDoc = async (i) => { const d = docs[i]; if (d?.path) { try { await deletePhotoFile(d.path); } catch(_){} } upd("aiDocs", docs.filter((_,x)=>x!==i)); };
  const card = { background:"#ffffff", border:"1px solid #e5e5e5", borderRadius:12, padding:20, marginBottom:14 };
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, margin:"6px 0 14px" }}>
        <span style={{ background:ACCENT, color:"#fff", fontSize:11, fontWeight:700, borderRadius:5, padding:"2px 7px" }}>AI</span>
        <div style={{ fontSize:17, fontWeight:700, color:TEXT }}>AI 知識庫 / 指示</div>
      </div>
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:600, color:"#211C15", marginBottom:8 }}>📌 給 AI 的指示</div>
        <div style={{ fontSize:12, color:"#6F6656", marginBottom:8 }}>告訴 AI 要特別注意的事：假日不得施工、業主偏好、付款方式、特殊限制…（AI 顧問與週報都會參考）</div>
        <textarea value={settings.notes||""} onChange={e=>upd("notes",e.target.value)} style={{ ...fieldStyle, height:130, resize:"vertical" }} placeholder="例如：週六日不得施工、磁磚需業主現場確認才下單、廠商付款 30 天票期…" />
      </div>
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:600, color:"#211C15", marginBottom:8 }}>📎 參考檔案（知識庫）</div>
        <div style={{ fontSize:12, color:"#6F6656", marginBottom:10 }}>上傳施工手冊、規範、合約等，作為 AI 提醒與回答的依據。也可從 LINE 直接把檔案丟給 D 哥。</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:6 }}>
          {docs.map((d,i)=>(
            <div key={i} style={{ position:"relative" }}>
              {d.isImage
                ? <img src={d.url} alt={d.name} title={d.name} onClick={()=>window.open(d.url,"_blank")} style={{ width:80,height:80,objectFit:"cover",borderRadius:8,border:"1px solid #e5e5e5",cursor:"pointer" }} />
                : <div onClick={()=>window.open(d.url,"_blank")} title={d.name+"（點擊開啟）"} style={{ width:80,height:80,borderRadius:8,border:"1px solid #e5e5e5",background:"#eff6ff",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,padding:4,boxSizing:"border-box" }}><span style={{ fontSize:26 }}>📄</span><span style={{ fontSize:8,color:"#6F6656",width:"100%",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{d.name}</span></div>}
              <button onClick={()=>delDoc(i)} style={{ position:"absolute",top:-7,right:-7,width:18,height:18,borderRadius:"50%",background:"#DC2626",color:"#fff",border:"none",fontSize:11,cursor:"pointer" }}>×</button>
            </div>
          ))}
          <label style={{ width:80,height:80,borderRadius:8,border:"1px dashed #e5e5e5",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",color:"#a3a3a3",fontSize:12 }}>
            <span style={{ fontSize:22 }}>{busy?"…":"＋"}</span>{busy?"上傳中":"上傳"}
            <input ref={fileRef} type="file" multiple style={{ display:"none" }} onChange={e=>{ addDocs(e.target.files); e.target.value=""; }} />
          </label>
        </div>
        <div style={{ fontSize:11, color:"#a3a3a3", marginTop:8 }}>※ 目前 AI 會知道有哪些參考檔；「自動解析檔案內容做工種提醒」為進階功能，將逐步開放。</div>
      </div>
      <div style={{ ...card, marginBottom:0, background:"#FBF7EE" }}>
        <div style={{ fontSize:13, color:"#6F6656", lineHeight:1.8 }}>💡 <b>AI 用量 / 估算花費</b> 已移到「儀表板」。｜ AI 顧問對話請點右上角「AI 顧問」。｜ LINE 通知設定已整合到「群組」分頁。｜ 優先追蹤改在項目上點 ☆。</div>
      </div>
    </div>
  );
}

// ── DEPENDENCY WARNINGS ───────────────────────────────────────────────────────
function DependencyWarnings({ cats }) {
  const [deps, setDeps] = useState(() => {
    // Default suggested dependencies based on construction logic
    return [
      { from:"拆除工程", to:"隔間工程", reason:"隔間前需完成拆除" },
      { from:"隔間工程", to:"天花工程", reason:"天花施作前隔間需定位" },
      { from:"隔間工程", to:"牆面工程", reason:"牆面工程依賴隔間完成" },
      { from:"機電工程", to:"天花工程", reason:"天花封板前需完成管線" },
      { from:"空調工程", to:"天花工程", reason:"空調風管需在天花前配置" },
      { from:"地坪工程", to:"活動道具工程", reason:"地坪完成後才可安裝固定道具" },
      { from:"消防工程", to:"天花工程", reason:"消防管線需在封天花前完成" },
    ];
  });

  const warnings = deps.map(dep => {
    const fromCat = cats.find(c=>c.name===dep.from||c.name.includes(dep.from.replace("工程","")));
    const toCat = cats.find(c=>c.name===dep.to||c.name.includes(dep.to.replace("工程","")));
    if (!fromCat || !toCat) return null;
    const fromDone = fromCat.status==="done" || fromCat.items.filter(i=>i.done||i.status==="done").length===fromCat.items.length;
    const toStarted = toCat.status==="inprogress" || toCat.items.some(i=>i.status==="inprogress"||i.status==="done");
    if (!fromDone && toStarted) return { ...dep, fromName:fromCat.name, toName:toCat.name, severity:"high" };
    if (!fromDone && toCat.status==="pending" && fromCat.status==="pending") return null;
    return null;
  }).filter(Boolean);

  if (warnings.length === 0) return null;

  return (
    <div style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:12, padding:14, marginBottom:14 }}>
      <div style={{ fontSize:13, fontWeight: 600, color:"#92400e", marginBottom:8 }}>⚠️ 工序相依提醒（{warnings.length}）</div>
      {warnings.map((w,i) => (
        <div key={i} style={{ fontSize:12, color:"#78350f", padding:"5px 0", borderBottom:i<warnings.length-1?"1px solid #fde68a":"none" }}>
          <span style={{ fontWeight: 600 }}>{w.toName}</span> 已開始，但 <span style={{ fontWeight: 600 }}>{w.fromName}</span> 尚未完成 — {w.reason}
        </div>
      ))}
    </div>
  );
}

// ── GANTT VIEW ────────────────────────────────────────────────────────────────
function GanttView({ cats, setCats }) {
  const weeks = 16;
  return (
    <div style={{ paddingTop: 16, overflowX: "auto" }}>
      <div style={{ minWidth: 800 }}>
        {/* header */}
        <div style={{ display: "flex", marginBottom: 4 }}>
          <div style={{ width: 200, flexShrink: 0, fontSize: 11, color: "#6F6656", padding: "4px 8px" }}>工程項目</div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${weeks},1fr)` }}>
            {Array.from({length: weeks}, (_,i) => (
              <div key={i} style={{ fontSize: 10, color: "#6F6656", textAlign: "center", borderLeft: "1px solid #e5e5e533" }}>W{i+1}</div>
            ))}
          </div>
        </div>
        {[...cats].sort((a,b) => a.order - b.order).map((cat, ci) => {
          const start = cat.ganttStart ?? ci;
          const dur = cat.ganttDur ?? Math.max(1, Math.round(catEstAfter(cat) / 200000));
          const st = STATUS_MAP[cat.status] || STATUS_MAP.pending;
          return (
            <div key={cat.id} style={{ display: "flex", marginBottom: 6, alignItems: "center" }}>
              <div style={{ width: 200, flexShrink: 0, fontSize: 12, color: "#211C15", padding: "4px 8px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${weeks},1fr)`, height: 28, background: "#f0f0f0", borderRadius: 4, overflow: "hidden", cursor: "pointer" }}
                onClick={() => {
                  const s = parseInt(prompt(`「${cat.name}」開始週 (1-${weeks}):`, start+1)) - 1;
                  const d = parseInt(prompt("持續週數:", dur));
                  if (!isNaN(s) && !isNaN(d)) setCats(prev => prev.map(c => c.id === cat.id ? {...c, ganttStart: Math.max(0,s), ganttDur: Math.max(1,d)} : c));
                }}
              >
                {Array.from({length: weeks}, (_,i) => {
                  const inBar = i >= start && i < start + dur;
                  return (
                    <div key={i} style={{ borderLeft: "1px solid #e5e5e533", height: "100%", background: inBar ? st.color + "cc" : "transparent", position: "relative" }}>
                      {inBar && i === start && <div style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#f4f5f7", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden" }}>{cat.name.slice(0,6)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 11, color: "#6F6656", marginTop: 8, padding: "0 8px" }}>點擊工序列可調整開始週與持續時間</div>
      </div>
    </div>
  );
}

// ── CATEGORY PANEL ─────────────────────────────────────────────────────────────
function CatPanel({ cat: catProp, cats, setCats, onClose, onSelectItem, confirm }) {
  const cat = cats.find(c => c.id === catProp.id) || catProp;
  const updateCat = (field, val) => setCats(prev => prev.map(c => c.id === cat.id ? { ...c, [field]: val } : c));
  return (
    <SidePanel onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 4 }}>工程大項名稱</div>
        <input
          value={cat.name}
          onChange={e => updateCat("name", e.target.value)}
          style={{ ...inputStyle, fontSize: 16, fontWeight: 600, color: "#211C15" }}
        />
      </div>
      {(() => { const e = catEstAfter(cat), p = catPaid(cat), u = e - p; return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "#eff6ff", border: "1px solid rgba(193,58,34,0.3)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>預估（含稅）</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: ACCENT }}>{fmt(e)}</div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid rgba(60,140,60,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>已付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#3C8C3C" }}>{fmt(p)}</div>
        </div>
        <div style={{ background: "#FFFBEB", border: "1px solid rgba(194,135,46,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>未付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: u < 0 ? "#DC2626" : "#C2872E" }}>{u < 0 ? `溢付${fmt(-u)}` : fmt(u)}</div>
        </div>
      </div>
      ); })()}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 4 }}>狀態</div>
        <StatusBadge status={cat.status} setCats={setCats} catId={cat.id} />
      </div>
      <input
        placeholder="負責單位/廠商"
        value={cat.vendor || ""}
        onChange={e => updateCat("vendor", e.target.value)}
        style={{ ...inputStyle, marginBottom: 14 }}
      />
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>細項列表</div>
      {cat.items.map(item => (
        <div key={item.id} onClick={() => onSelectItem(item)} style={{ background: "#f0f0f0", borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer", border: "1px solid #e5e5e5", transition: "border-color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
          onMouseLeave={e => e.currentTarget.style.borderColor="#e5e5e5"}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 13, color: item.notes?.includes("⚠️") ? "#C2872E" : "#211C15", flex: 1 }}>{item.name}</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: ACCENT }}>{fmt(calcItemTotal(item))}</div>
            <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); confirm(`刪除「${item.name}」？`).then(ok => { if (ok) setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); }); }} style={{ width: 20, height: 20, borderRadius: "50%", background: "#eff6ff", border: "1px solid rgba(193,58,34,0.25)", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, cursor: "pointer", flexShrink: 0, padding: 0 }}>×</button>
          </div>
          <div style={{ fontSize: 11, color: "#6F6656", marginTop: 2 }}>
            {item.qty} {item.unit} · {item.assignee || "未指派"} · <span style={{ color: STATUS_MAP[item.status]?.color || "#6F6656" }}>{STATUS_MAP[item.status]?.label}</span>
            {item.chat?.length > 0 && " · 💬" + item.chat.length}
          </div>
        </div>
      ))}
      <button onClick={() => {
        const newItem = { id: "i-" + cat.id + "-" + Date.now(), name: "新細項", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] };
        setCats(prev => prev.map(c => c.id === cat.id ? { ...c, items: [...c.items, newItem] } : c));
      }} style={{ width: "100%", padding: "8px", background: "#fff8e6", border: "1px dashed rgba(193,58,34,0.35)", borderRadius: 8, color: ACCENT, cursor: "pointer", fontSize: 13, marginTop: 4 }}>
        + 新增細項
      </button>
    </SidePanel>
  );
}

// ── ITEM PANEL ─────────────────────────────────────────────────────────────────
function ItemPanel({ cat, item, cats, setCats, onClose, confirm }) {
  const updateItem = (field, val) => {
    setCats(prev => prev.map(c => c.id === cat.id ? { ...c, items: c.items.map(it => it.id === item.id ? {...it, [field]: val} : it) } : c));
  };
  const currentItem = cats.find(c => c.id === cat.id)?.items.find(i => i.id === item.id) || item;
  const [lightbox, setLightbox] = useState(null);
  const [rcpBusy, setRcpBusy] = useState(false);
  const addReceipts = async (files) => {
    if (!files || !files.length) return;
    setRcpBusy(true);
    const out = [];
    for (const f of files) {
      try { const { url, path } = await uploadPhoto(f); out.push({ id: "rc-" + Math.random().toString(36).slice(2, 8), url, path, name: f.name || "憑證", isImage: /^image\//.test(f.type) }); }
      catch (_) {}
    }
    setRcpBusy(false);
    if (out.length) updateItem("receipts", [...(currentItem.receipts || []), ...out]);
  };
  const removeReceipt = async (ri) => {
    const r = (currentItem.receipts || [])[ri];
    if (r?.path) { try { await deletePhotoFile(r.path); } catch (_) {} }
    updateItem("receipts", (currentItem.receipts || []).filter((_, i) => i !== ri));
  };

  return (
    <SidePanel onClose={onClose} wide>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 2 }}>{cat.name}</div>
        <input
          value={currentItem.name}
          onChange={e => updateItem("name", e.target.value)}
          style={{ ...inputStyle, fontSize: 15, fontWeight: 600, color: "#211C15" }}
          placeholder="細項名稱"
        />
        <button onClick={() => confirm(`確定刪除細項「${currentItem.name}」？`).then(ok => { if (ok) { setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); onClose(); } })} style={{ marginTop: 6, background: "#eff6ff", border: "1px solid rgba(193,58,34,0.25)", borderRadius: 7, color: "#DC2626", fontSize: 12, padding: "5px 12px", cursor: "pointer", alignSelf: "flex-start" }}>🗑 刪除此細項</button>
      </div>
      {/* ── 預估 vs 實際 兩欄 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 14, border: "1px solid #e5e5e5", borderRadius: 10, overflow: "hidden" }}>
        {/* headers */}
        <div style={{ background: "#eff6ff", borderBottom: "1px solid #e5e5e5", borderRight: "1px solid #e5e5e5", padding: "7px 12px", fontSize: 11, fontWeight: 600, color: ACCENT, letterSpacing: 1 }}>📋 預估（估價單）</div>
        <div style={{ background: "#eff6ff", borderBottom: "1px solid #e5e5e5", padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#3E72A8", letterSpacing: 1 }}>🔨 實際（施工記錄）</div>
        {/* qty */}
        <div style={{ borderRight: "1px solid #e5e5e5", borderBottom: "1px solid #e5e5e555", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>數量</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <NumInput value={currentItem.estQty ?? currentItem.qty ?? 0} onChange={v => updateItem("estQty", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
            <input value={currentItem.unit} onChange={e => updateItem("unit", e.target.value)} style={{ ...inputStyle, width: 56, fontSize: 12 }} />
          </div>
        </div>
        <div style={{ borderBottom: "1px solid #e5e5e555", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>數量</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <NumInput value={currentItem.actQty ?? 0} onChange={v => updateItem("actQty", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
            <span style={{ fontSize: 11, color: "#6F6656", whiteSpace: "nowrap" }}>{currentItem.unit}</span>
          </div>
        </div>
        {/* unit price */}
        <div style={{ borderRight: "1px solid #e5e5e5", borderBottom: "1px solid #e5e5e555", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>單價</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.estUnitPrice ?? currentItem.unitPrice ?? 0} onChange={v => updateItem("estUnitPrice", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        <div style={{ borderBottom: "1px solid #e5e5e555", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>單價</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.actUnitPrice ?? 0} onChange={v => updateItem("actUnitPrice", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        {/* labor */}
        <div style={{ borderRight: "1px solid #e5e5e5", borderBottom: "1px solid #e5e5e555", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>人工費（整筆估）</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.estLabor ?? currentItem.labor ?? 0} onChange={v => updateItem("estLabor", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        <div style={{ borderBottom: "1px solid #e5e5e555", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>人數 / 日薪 / 天數</div>
          <div style={{ display: "flex", gap: 4 }}>
            <NumInput value={currentItem.actWorkers ?? 0} onChange={v => updateItem("actWorkers", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="人" />
            <NumInput value={currentItem.actDailyWage ?? 0} onChange={v => updateItem("actDailyWage", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="日薪" />
            <NumInput value={currentItem.actLaborDays ?? 0} onChange={v => updateItem("actLaborDays", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="天" />
          </div>
        </div>
        {/* totals */}
        <div style={{ borderRight: "1px solid #e5e5e5", padding: "8px 12px", background: "#f5f5f5" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>預估複價</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 600, color: ACCENT }}>{fmt(calcEstimated(currentItem))}</div>
        </div>
        <div style={{ padding: "8px 12px", background: "#f5faff" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>實際複價</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 600, color: calcActual(currentItem) > calcEstimated(currentItem) ? "#DC2626" : "#3E72A8" }}>
            {calcActual(currentItem) > 0 ? fmt(calcActual(currentItem)) : "尚未填入"}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <Field label="負責人/廠商" value={currentItem.assignee} onChange={v => updateItem("assignee", v)} />
        <div>
          <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 4 }}>狀態</div>
          <StatusBadge status={currentItem.status} setCats={setCats} catId={cat.id} itemId={currentItem.id} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Field label="備註" value={currentItem.notes} onChange={v => updateItem("notes", v)} multiline />
      </div>
      {/* Receipts：發票／憑證照片（點擊放大） */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>🧾 發票／憑證 ({currentItem.receipts?.length || 0})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {currentItem.receipts?.map((r, ri) => (
            r.url ? (
              <div key={ri} style={{ position: "relative" }}>
                {r.isImage !== false
                  ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e5e5", cursor: "zoom-in" }} />
                  : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 80, height: 80, borderRadius: 8, border: "1px solid #e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, textDecoration: "none", background: "#eff6ff" }}>📄</a>}
                <button onClick={() => removeReceipt(ri)} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: "50%", background: "#DC2626", color: "#fff", border: "none", fontSize: 11, lineHeight: 1, cursor: "pointer" }}>×</button>
              </div>
            ) : (
              <div key={ri} title="點擊刪除" onClick={() => removeReceipt(ri)} style={{ background: "#f0f0f0", borderRadius: 6, padding: "6px 10px", fontSize: 12, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <span>📎 {r.name}</span>{r.amount ? <span style={{ color: ACCENT, fontFamily: "monospace" }}>{fmt(r.amount)}</span> : null}
              </div>
            )
          ))}
          <label style={{ width: 80, height: 80, borderRadius: 8, border: "1px dashed #e5e5e5", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: "#a3a3a3", fontSize: 12 }}>
            <span style={{ fontSize: 22 }}>{rcpBusy ? "…" : "＋"}</span>{rcpBusy ? "上傳中" : "上傳"}
            <input type="file" accept="*/*" multiple style={{ display: "none" }} onChange={e => { addReceipts(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      {/* Photo uploads */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>📷 施工照片 ({currentItem.photos?.length || 0})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {currentItem.photos?.map((p, pi) => (
            <div key={pi} style={{ position: "relative" }}>
              <img src={p.data} alt={p.name} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e5e5" }} />
              <button onClick={() => updateItem("photos", currentItem.photos.filter((_,i2)=>i2!==pi))}
                style={{ position:"absolute", top:-6, right:-6, width:20, height:20, borderRadius:"50%", background:"#dc2626", border:"none", color:"#fff", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>×</button>
            </div>
          ))}
          <label style={{ width:80, height:80, border:"2px dashed #e5e5e5", borderRadius:8, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"#a3a3a3", fontSize:11, gap:4 }}>
            <span style={{ fontSize:24 }}>+</span>
            <span>照片</span>
            <input type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e => {
              Array.from(e.target.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = ev => updateItem("photos", [...(currentItem.photos||[]), { data: ev.target.result, name: file.name, ts: new Date().toISOString() }]);
                reader.readAsDataURL(file);
              });
              e.target.value = "";
            }} />
          </label>
        </div>
      </div>
      {/* Item Chat + AI */}
      <ItemChat cat={cat} item={currentItem} setCats={setCats} />
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
    </SidePanel>
  );
}

// ── ITEM CHAT ──────────────────────────────────────────────────────────────────
function ItemChat({ cat, item, setCats }) {
  const [input, setInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const endRef = useRef(null);

  const didScrollItem = useRef(false);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: didScrollItem.current ? "smooth" : "auto" }); didScrollItem.current = true; }, [item.chat]);

  const addMsg = (role, text) => {
    setCats(prev => prev.map(c => c.id === cat.id ? {
      ...c, items: c.items.map(it => it.id === item.id ? { ...it, chat: [...(it.chat || []), { role, text, ts: new Date().toLocaleTimeString("zh-TW", {hour:"2-digit",minute:"2-digit"}) }] } : it)
    } : c));
  };

  const send = async () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    addMsg("user", t);
    setAiLoading(true);
    try {
      const history = (item.chat || []).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      history.push({ role: "user", content: t });
      const reply = await callAI(history, SYSTEM_ITEM(cat.name, item.name));
      addMsg("assistant", reply);
    } catch (_) {
      addMsg("assistant", "⚠️ AI連線失敗，請稍後再試。");
    }
    setAiLoading(false);
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 8 }}>💬 項目討論室 & AI顧問</div>
      <div style={{ background: "#f4f5f7", borderRadius: 8, border: "1px solid #e5e5e5", maxHeight: 280, overflowY: "auto", padding: 10, marginBottom: 8 }}>
        {(!item.chat || item.chat.length === 0) && (
          <div style={{ fontSize: 12, color: "#e5e5e5", textAlign: "center", padding: "20px 0" }}>輸入問題詢問AI工程顧問，或記錄討論內容</div>
        )}
        {item.chat?.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.role === "user" ? "#3E72A8" : "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, border: m.role !== "user" ? `1px solid ${ACCENT}44` : "none" }}>
              {m.role === "user" ? "👤" : "🤖"}
            </div>
            <div style={{ background: m.role === "user" ? ACCENT : "#f0f0f0", border: "none", borderRadius: 10, padding: "8px 11px", maxWidth: "85%", fontSize: 12.5, lineHeight: 1.6, color: m.role === "user" ? "#ffffff" : "#211C15", whiteSpace: "pre-wrap" }}>
              {m.text}
              <div style={{ fontSize: 10, color: "#6F6656", marginTop: 3 }}>{m.ts}</div>
            </div>
          </div>
        ))}
        {aiLoading && (
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, border: `1px solid ${ACCENT}44` }}>🤖</div>
            <div style={{ fontSize: 12, color: ACCENT, padding: "8px 10px" }}>AI顧問分析中…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder="詢問AI顧問或記錄討論…" style={{ ...inputStyle, flex: 1, margin: 0 }} />
        <button onClick={send} disabled={aiLoading || !input.trim()} style={{ background: ACCENT, border: "none", borderRadius: 8, padding: "0 14px", color: "#ffffff", fontWeight: 600, cursor: aiLoading ? "not-allowed" : "pointer", fontSize: 13, opacity: aiLoading ? 0.6 : 1 }}>送出</button>
      </div>
    </div>
  );
}

// ── GLOBAL AI PANEL ────────────────────────────────────────────────────────────
// ── 工作日誌 ─────────────────────────────────────────────────────────────────
const wlMiniBtn = { background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer", color:"#4A4234" };
function WorklogView({ worklog, setWorklog, canEdit, userName, requireLogin, confirm }) {
  const [draft, setDraft] = useState("");
  const [draftDate, setDraftDate] = useState(new Date().toISOString().slice(0,10));
  const [draftPhotos, setDraftPhotos] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef(null);

  const uploadAll = async (files) => {
    const arr = Array.from(files||[]);
    const out = [];
    setUploading(true);
    for (const f of arr) {
      try { const { url, path } = await uploadPhoto(f); out.push({ id:"wp-"+Math.random().toString(36).slice(2,8), url, path, name:f.name||"檔案", isImage:/^image\//.test(f.type) }); }
      catch (e) { alert("上傳失敗：" + (e?.message || e)); }
    }
    setUploading(false);
    return out;
  };
  const addPhotosToDraft = async (files) => { if (!canEdit) { requireLogin&&requireLogin(); return; } const ph = await uploadAll(files); if (ph.length) setDraftPhotos(prev => [...prev, ...ph]); };
  const addPhotosToEntry = async (id, files) => { const ph = await uploadAll(files); if (ph.length) setWorklog(worklog.map(w => w.id===id ? { ...w, photos:[...(w.photos||[]), ...ph] } : w)); };

  // 在工作日誌頁時，貼上截圖 → 加到草稿
  const draftRef = useRef(null); draftRef.current = addPhotosToDraft;
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items || []; const imgs = [];
      for (const it of items) if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); }
      if (imgs.length) { e.preventDefault(); draftRef.current && draftRef.current(imgs); }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);

  const add = () => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    const c = draft.trim(); if (!c && draftPhotos.length === 0) return;
    const entry = { id: "wl-"+Math.random().toString(36).slice(2,8), date: draftDate || new Date().toISOString().slice(0,10), content: c, photos: draftPhotos, author: userName || "—", ts: new Date().toISOString() };
    setWorklog([entry, ...worklog]);
    setDraft(""); setDraftPhotos([]);
  };
  const saveEdit = (id) => { setWorklog(worklog.map(w => w.id === id ? { ...w, content: editText } : w)); setEditId(null); };
  const del = async (id) => { if (confirm && !(await confirm("確定刪除這筆工作日誌？"))) return; setWorklog(worklog.filter(w => w.id !== id)); };
  const removeEntryPhoto = (id, pid) => setWorklog(worklog.map(w => w.id===id ? { ...w, photos:(w.photos||[]).filter(p=>p.id!==pid) } : w));
  const sorted = [...worklog].sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.ts||"").localeCompare(a.ts||""));
  const thumb = (p, onRemove) => (
    <div key={p.id} style={{ position:"relative", width:60, height:60, borderRadius:8, overflow:"hidden", border:"1px solid #e5e5e5", background:"#f5f5f5", display:"flex", alignItems:"center", justifyContent:"center" }}>
      {p.isImage!==false ? <img src={p.url} alt="" onClick={()=>setLightbox(p)} style={{ width:"100%", height:"100%", objectFit:"cover", cursor:"zoom-in" }} />
        : <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize:20, textDecoration:"none" }}>📄</a>}
      {onRemove && <button onClick={()=>onRemove(p.id)} style={{ position:"absolute", top:-6, right:-6, width:18, height:18, borderRadius:"50%", background:"#211C15", color:"#fff", border:"none", fontSize:11, cursor:"pointer", lineHeight:1 }}>×</button>}
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15", marginBottom: 12 }}>📓 工作日誌</div>
      {canEdit ? (
        <div style={{ background:"#fff", border:"1px solid #e5e5e5", borderRadius:12, padding:16, marginBottom:16 }}>
          <input type="date" value={draftDate} onChange={e=>setDraftDate(e.target.value)} style={{ ...inputStyle, width:170, marginBottom:8 }} />
          <textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder="記錄今天的工程狀況、決策、問題…（也可在「AI顧問」對話框口述，請它幫你建立日誌）"
            style={{ ...inputStyle, width:"100%", minHeight:80, resize:"vertical", boxSizing:"border-box" }} />
          {draftPhotos.length > 0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
              {draftPhotos.map(p => thumb(p, (pid)=>setDraftPhotos(prev=>prev.filter(x=>x.id!==pid))))}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e=>{ addPhotosToDraft(e.target.files); e.target.value=""; }} />
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8 }}>
            <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{ background:"#f0f0f0", border:"1px solid #e5e5e5", borderRadius:8, padding:"7px 12px", cursor:"pointer", fontSize:13, color:"#4A4234" }}>{uploading?"上傳中…":"📷 附現場照片"}</button>
            <span style={{ fontSize:11, color:"#a3a3a3" }}>可貼上截圖</span>
            <div style={{ flex:1 }} />
            <button onClick={add} disabled={!draft.trim() && draftPhotos.length===0} style={{ background: (draft.trim()||draftPhotos.length)?ACCENT:"#e5e5e5", color: (draft.trim()||draftPhotos.length)?"#ffffff":"#a3a3a3", border:"none", borderRadius:8, padding:"8px 18px", fontWeight: 600, cursor: (draft.trim()||draftPhotos.length)?"pointer":"not-allowed" }}>新增日誌</button>
          </div>
        </div>
      ) : (
        <div style={{ background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#6F6656" }}>🔒 唯讀模式：登入後可新增 / 編輯工作日誌。</div>
      )}
      {sorted.length === 0 ? (
        <div style={{ textAlign:"center", color:"#a3a3a3", padding:40 }}>尚無工作日誌</div>
      ) : sorted.map(w => (
        <div key={w.id} style={{ background:"#fff", border:"1px solid #e5e5e5", borderRadius:12, padding:14, marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <span style={{ fontSize:12, fontWeight: 600, color:ACCENT, fontFamily:"monospace" }}>{w.date}</span>
            <span style={{ fontSize:11, color:"#a3a3a3" }}>by {w.author||"—"}</span>
            <div style={{ flex:1 }} />
            {canEdit && editId !== w.id && (<>
              <button onClick={()=>{ setEditId(w.id); setEditText(w.content); }} style={wlMiniBtn}>編輯</button>
              <button onClick={()=>del(w.id)} style={{ ...wlMiniBtn, color:"#dc2626" }}>刪除</button>
            </>)}
          </div>
          {editId === w.id ? (
            <div>
              <textarea value={editText} onChange={e=>setEditText(e.target.value)} style={{ ...inputStyle, width:"100%", minHeight:70, boxSizing:"border-box" }} />
              <div style={{ textAlign:"right", marginTop:6 }}>
                <button onClick={()=>setEditId(null)} style={{ ...wlMiniBtn, marginRight:6 }}>取消</button>
                <button onClick={()=>saveEdit(w.id)} style={{ background:ACCENT, color:"#ffffff", border:"none", borderRadius:6, padding:"5px 14px", fontWeight: 600, cursor:"pointer" }}>儲存</button>
              </div>
            </div>
          ) : (
            <>
              {w.content && <div style={{ fontSize:14, color:"#211C15", whiteSpace:"pre-wrap", lineHeight:1.7 }}>{w.content}</div>}
              {((w.photos||[]).length > 0 || canEdit) && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8, alignItems:"center" }}>
                  {(w.photos||[]).map(p => thumb(p, canEdit ? (pid)=>removeEntryPhoto(w.id, pid) : null))}
                  {canEdit && (<>
                    <input id={"wlf-"+w.id} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e=>{ addPhotosToEntry(w.id, e.target.files); e.target.value=""; }} />
                    <button onClick={()=>document.getElementById("wlf-"+w.id)?.click()} style={{ width:60, height:60, borderRadius:8, border:"1px dashed #e5e5e5", background:"#ffffff", color:"#a3a3a3", fontSize:20, cursor:"pointer" }}>＋</button>
                  </>)}
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20, cursor:"zoom-out" }}>
          <img src={lightbox.url} alt="" style={{ maxWidth:"95%", maxHeight:"95%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}
    </div>
  );
}

// ── 檔案庫 / 相簿 ─────────────────────────────────────────────────────────────
const PHOTO_KINDS = [["quote","估價單"],["site","現場照"],["invoice","發票"],["other","其他"]];
const photoKindLabel = (k) => (PHOTO_KINDS.find(x=>x[0]===k)||[,"其他"])[1];
const photoKindColor = { quote:"#3b82f6", site:"#3C8C3C", invoice:"#DC2626", other:"#a3a3a3" };
function PhotoLibraryView({ photos, setPhotos, cats, canEdit, userName, requireLogin, confirm }) {
  const [kind, setKind] = useState("site");
  const [catId, setCatId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fKind, setFKind] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [lightbox, setLightbox] = useState(null);
  const [editId, setEditId] = useState(null);
  const [ef, setEf] = useState({});
  const [groupBy, setGroupBy] = useState("none"); // none | cat | date
  const fileRef = useRef(null);
  const sortedCats = [...cats].sort((a,b)=>a.order-b.order);

  const startEdit = (p) => { if (!canEdit) { requireLogin&&requireLogin(); return; } setEditId(p.id); setEf({ kind:p.kind, catId:p.catId||"", date:p.date||"", note:p.note||"" }); };
  const saveEdit = () => {
    setPhotos(photos.map(p => p.id===editId ? { ...p, kind:ef.kind, catId:ef.catId, catName:(cats.find(c=>c.id===ef.catId)?.name)||"", date:ef.date, note:ef.note } : p));
    setEditId(null);
  };

  const onPick = async (files) => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    const arr = Array.from(files||[]);
    if (!arr.length) return;
    setUploading(true);
    const added = [];
    for (const f of arr) {
      try {
        const { url, path } = await uploadPhoto(f);
        const cat = cats.find(c => c.id === catId);
        added.push({ id: "ph-"+Math.random().toString(36).slice(2,8), url, path, name: f.name || "檔案", mime: f.type||"", isImage: /^image\//.test(f.type), kind, catId: catId||"", catName: cat?cat.name:"", date, note, invoiceReceived: false, by: userName||"—", ts: new Date().toISOString() });
      } catch (e) { alert("上傳失敗：" + (e?.message || e)); }
    }
    if (added.length) setPhotos([...added, ...photos]);
    setNote(""); setUploading(false);
  };
  // 截圖貼上：監聽 paste，把剪貼簿圖片直接上傳
  const onPickRef = useRef(null);
  onPickRef.current = onPick;
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items || [];
      const imgs = [];
      for (const it of items) { if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); } }
      if (imgs.length) { e.preventDefault(); onPickRef.current && onPickRef.current(imgs); }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);
  const toggleReceived = (id) => setPhotos(photos.map(p => p.id===id ? {...p, invoiceReceived: !p.invoiceReceived} : p));
  const del = async (p) => { if (confirm && !(await confirm("刪除這張圖片？"))) return; await deletePhotoFile(p.path); setPhotos(photos.filter(x => x.id !== p.id)); };

  const filtered = photos.filter(p => (fKind==="all"||p.kind===fKind) && (fCat==="all"||p.catId===fCat))
    .sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.ts||"").localeCompare(a.ts||""));
  const pendingInvoices = photos.filter(p => p.kind==="invoice" && !p.invoiceReceived).length;

  const selStyle = { ...inputStyle, width:"auto", padding:"6px 10px" };

  const groups = (() => {
    if (groupBy === "cat") {
      const order = [...sortedCats.map(c=>c.name), "（未指定工程）"];
      const m = {};
      filtered.forEach(p => { const k = p.catName || "（未指定工程）"; (m[k]=m[k]||[]).push(p); });
      return order.filter(k=>m[k]).map(k => ({ label: k, items: m[k] }));
    }
    if (groupBy === "date") {
      const m = {};
      filtered.forEach(p => { const k = p.date || "（無日期）"; (m[k]=m[k]||[]).push(p); });
      return Object.keys(m).sort((a,b)=>b.localeCompare(a)).map(k => ({ label: k, items: m[k] }));
    }
    return [{ label: null, items: filtered }];
  })();

  const renderCard = (p) => (
    <div key={p.id} style={{ background:"#fff", border:"1px solid #e5e5e5", borderRadius:12, overflow:"hidden", display:"flex", flexDirection:"column" }}>
      <div style={{ position:"relative", aspectRatio:"4/3", background:"#f0f0f0", cursor: p.isImage!==false?"zoom-in":"default", display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>{ if (p.isImage!==false) setLightbox(p); }}>
        {p.isImage !== false
          ? <img src={p.url} alt={p.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
          : <a href={p.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ textAlign:"center", textDecoration:"none", color:"#6F6656", padding:"0 10px" }}>
              <div style={{ fontSize:40 }}>📄</div>
              <div style={{ fontSize:11, marginTop:4, wordBreak:"break-all", maxHeight:32, overflow:"hidden" }}>{p.name}</div>
            </a>}
        <span style={{ position:"absolute", top:6, left:6, fontSize:10, fontWeight: 600, color:"#fff", background:photoKindColor[p.kind]||"#a3a3a3", borderRadius:6, padding:"2px 7px" }}>{photoKindLabel(p.kind)}</span>
      </div>
      <div style={{ padding:"8px 10px", fontSize:12 }}>
        {editId === p.id ? (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <select value={ef.kind} onChange={e=>setEf({...ef, kind:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }}>{PHOTO_KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
            <select value={ef.catId} onChange={e=>setEf({...ef, catId:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }}><option value="">（不指定工程）</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input type="date" value={ef.date} onChange={e=>setEf({...ef, date:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }} />
            <input value={ef.note} onChange={e=>setEf({...ef, note:e.target.value})} placeholder="備註" style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }} />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setEditId(null)} style={{ fontSize:11, color:"#6F6656", background:"none", border:"none", cursor:"pointer" }}>取消</button>
              <button onClick={saveEdit} style={{ fontSize:11, fontWeight: 600, color:"#211C15", background:ACCENT, border:"none", borderRadius:6, padding:"4px 12px", cursor:"pointer" }}>儲存</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ color:"#4A4234", fontWeight:600 }}>{p.catName || "（未指定工程）"}</div>
            <div style={{ color:"#a3a3a3", fontSize:11, marginTop:2 }}>{p.date} · {p.by}</div>
            {p.note && <div style={{ color:"#6F6656", fontSize:11, marginTop:3, whiteSpace:"pre-wrap" }}>{p.note}</div>}
            {p.kind === "invoice" && (
              <label style={{ display:"flex", alignItems:"center", gap:5, marginTop:6, fontSize:12, color:p.invoiceReceived?"#16a34a":"#dc2626", fontWeight: 600, cursor:canEdit?"pointer":"default" }}>
                <input type="checkbox" checked={!!p.invoiceReceived} disabled={!canEdit} onChange={()=>canEdit&&toggleReceived(p.id)} style={{ accentColor:"#16a34a" }} />
                {p.invoiceReceived ? "✅ 發票已收到" : "⚠️ 發票未收到"}
              </label>
            )}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#3b82f6", textDecoration:"none" }}>⬇ 下載</a>
              {canEdit && <button onClick={()=>startEdit(p)} style={{ fontSize:11, color:"#4A4234", background:"none", border:"none", cursor:"pointer", padding:0 }}>編輯</button>}
              {canEdit && <button onClick={()=>del(p)} style={{ fontSize:11, color:"#dc2626", background:"none", border:"none", cursor:"pointer", padding:0 }}>刪除</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize:18, fontWeight: 600, color:"#211C15", marginBottom:12 }}>📁 檔案庫 / 相簿</div>

      {pendingInvoices > 0 && (
        <div style={{ background:"#eff6ff", border:"1px solid #fca5a5", borderRadius:10, padding:"8px 14px", marginBottom:12, fontSize:13, color:"#dc2626", fontWeight:600 }}>
          🧾 有 {pendingInvoices} 張發票尚未確認收到（請在發票卡片勾選「已收到」）
        </div>
      )}

      {canEdit ? (
        <div style={{ background:"#fff", border:"1px solid #e5e5e5", borderRadius:12, padding:14, marginBottom:14, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <select value={kind} onChange={e=>setKind(e.target.value)} style={selStyle}>{PHOTO_KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
          <select value={catId} onChange={e=>setCatId(e.target.value)} style={selStyle}><option value="">（不指定工程）</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={selStyle} />
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="備註（選填）" style={{ ...inputStyle, flex:1, minWidth:120, padding:"6px 10px" }} />
          <input ref={fileRef} type="file" multiple style={{ display:"none" }} onChange={e=>{ onPick(e.target.files); e.target.value=""; }} />
          <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{ background:ACCENT, color:"#ffffff", border:"none", borderRadius:8, padding:"8px 16px", fontWeight: 600, cursor: uploading?"wait":"pointer" }}>{uploading?"上傳中…":"📎 上傳照片 / 檔案"}</button>
          <span style={{ fontSize:11, color:"#a3a3a3", width:"100%" }}>支援照片、PDF、Excel 等檔案；也可直接 Ctrl/⌘+V 貼上截圖</span>
        </div>
      ) : (
        <div style={{ background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:13, color:"#6F6656" }}>🔒 唯讀模式：登入後可上傳 / 管理圖片。</div>
      )}

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12, alignItems:"center" }}>
        <span style={{ fontSize:11, color:"#a3a3a3" }}>類別</span>
        {[["all","全部"],...PHOTO_KINDS].map(([k,l])=>(
          <button key={k} onClick={()=>setFKind(k)} style={{ padding:"3px 10px", borderRadius:20, border:"1px solid #e5e5e5", fontSize:11, cursor:"pointer", background:fKind===k?ACCENT:"#f5f5f5", color:fKind===k?"#ffffff":"#6F6656", fontWeight:fKind===k?700:400 }}>{l}</button>
        ))}
        <span style={{ fontSize:11, color:"#a3a3a3", marginLeft:8 }}>工程</span>
        <select value={fCat} onChange={e=>setFCat(e.target.value)} style={{ ...selStyle, fontSize:12, padding:"4px 8px" }}>
          <option value="all">全部工程</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:11, color:"#a3a3a3" }}>分組</span>
        {[["none","不分組"],["cat","按工程"],["date","按日期"]].map(([k,l])=>(
          <button key={k} onClick={()=>setGroupBy(k)} style={{ padding:"3px 10px", borderRadius:20, border:"1px solid #e5e5e5", fontSize:11, cursor:"pointer", background:groupBy===k?ACCENT:"#f5f5f5", color:groupBy===k?"#ffffff":"#6F6656", fontWeight:groupBy===k?700:400 }}>{l}</button>
        ))}
        <span style={{ fontSize:12, color:"#a3a3a3", marginLeft:6 }}>共 {filtered.length} 張</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"#a3a3a3", padding:40 }}>尚無檔案{canEdit?"，用上方按鈕上傳或貼上截圖":""}</div>
      ) : groups.map(g => (
        <div key={g.label || "all"} style={{ marginBottom: g.label ? 18 : 0 }}>
          {g.label && (
            <div style={{ fontSize:13, fontWeight: 600, color:"#4A4234", margin:"6px 0 8px", display:"flex", alignItems:"center", gap:8 }}>
              {groupBy==="date" ? "📅" : "🏗️"} {g.label}
              <span style={{ fontSize:11, color:"#a3a3a3", fontWeight:400 }}>（{g.items.length}）</span>
              <div style={{ height:1, flex:1, background:"#e5e5e5" }} />
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px,1fr))", gap:12 }}>
            {g.items.map(renderCard)}
          </div>
        </div>
      ))}

      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20, cursor:"zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth:"95%", maxHeight:"95%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}
    </div>
  );
}

// ── 帳號管理 ─────────────────────────────────────────────────────────────────
const ACCT_SPACES = [["construction","🏗 工程專案"],["team","👥 團隊工作"],["crew","🤝 夥伴中心"],["finance","💰 財務內帳"]];
const ACCT_VIEW_PAGES = [["owner","儀表板"],["overview","總覽"],["tasks","任務"],["gantt","工序"],["conclusions","結論"],["files","檔案庫"],["petty","零用金"],["compare","比價"],["advisor","AI設定"]];
const ACCT_EDIT_PAGES = [["data","總覽/工程資料"],["worklog","工序日誌"],["files","檔案庫"],["advisor","AI設定"]];
function AccountManager({ confirm, myId, roles = [], commitRoles, onLog, guestPerms = {}, commitGuestPerms }) {
  const logAct = (action, detail) => { try { onLog && onLog(action, detail); } catch (_) {} };
  const permLogRef = useRef({});
  const logThrottled = (action, key) => { const k = action + "|" + key; const now = Date.now(); if (now - (permLogRef.current[k] || 0) < 12000) return; permLogRef.current[k] = now; logAct(action, key); }; // 連續勾選收斂成一筆
  const [list, setList] = useState(null); // null=loading
  const [err, setErr] = useState("");
  const [nName, setNName] = useState(""); const [nUser, setNUser] = useState(""); const [nPw, setNPw] = useState(""); const [nAdmin, setNAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openSp, setOpenSp] = useState(() => new Set()); // 展開中的「帳號:空間」key（預設全部收合，清爽）
  const [openAcct, setOpenAcct] = useState(() => new Set()); // 展開中的帳號id
  const toggleSet = (setter, key) => setter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const load = async () => {
    if (!supabase) { setErr("系統未設定登入服務"); setList([]); return; }
    const { data, error } = await supabase.from("profiles").select("*").order("role").order("display_name");
    if (error) { setErr("讀取帳號失敗：" + error.message); setList([]); return; }
    setErr(""); setList(data || []);
  };
  useEffect(() => { load(); }, []);
  const authToken = async () => (await supabase.auth.getSession()).data.session?.access_token;
  const api = async (body) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch("/api/admin-users", { method:"POST", headers:{ "content-type":"application/json", authorization:`Bearer ${await authToken()}` }, body: JSON.stringify(body), signal: ctrl.signal });
      const d = await r.json().catch(()=>({})); if (!r.ok) throw new Error(d.error || "操作失敗"); return d;
    } catch(e) { throw new Error(e.name === "AbortError" ? "連線逾時，請重新整理頁面後再試一次" : (e.message || "操作失敗")); }
    finally { clearTimeout(timer); }
  };

  const patch = async (id, changes) => {
    setList(prev => prev.map(p => p.id===id ? { ...p, ...changes } : p));
    const { error } = await supabase.from("profiles").update(changes).eq("id", id);
    if (error) { setErr("儲存失敗：" + error.message); load(); }
  };
  // ── 矩陣勾選邏輯（含舊資料具體化：第一次動手就把「預設全可見/全域金額」攤成明確清單）──
  // 三個維度一律「預設全開」：[]＝全部允許、[PERM_NONE]＝全部禁止、其餘＝明確允許清單。勾＝開、取消＝關。
  const viewChecked = (p, sid, pg) => { const vp = p.view_pages || []; if (!vp.length) return true; return vp.includes(`${sid}:${pg}`) || vp.includes(pg); };
  const editChecked = (p, sid, pg) => { const ep = p.pages || []; if (!ep.length) return true; return ep.includes(`${sid}:${pg}`) || ep.includes(LEGACY_EDIT[pg]); };
  const moneyChecked = (p, sid, pg) => { const mp = p.money_pages || []; if (!mp.length) return true; return mp.includes(`${sid}:${pg}`); };
  const spaceChecked = (p, sid) => { const sp = p.spaces || []; return !sp.length || sp.includes(sid); };

  // 通用切換：對任一實體(帳號或身份範本)操作，save 決定存到哪。攤成明確清單後依「全開→[]、全關→[PERM_NONE]」收斂。
  const applyToggle = (obj, field, all, isOn, key, save) => {
    let cur = all.filter(k => { const [s, g] = k.split(":"); return isOn(obj, s, g); });
    cur = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    save({ [field]: cur.length === all.length ? [] : (cur.length === 0 ? [PERM_NONE] : cur) });
  };
  const tView = (obj, sid, pg, save) => applyToggle(obj, "view_pages", ALL_VIEW_KEYS, viewChecked, `${sid}:${pg}`, save);
  const tEdit = (obj, sid, pg, save) => applyToggle(obj, "pages", ALL_EDIT_KEYS, editChecked, `${sid}:${pg}`, save);
  const tMoney = (obj, sid, pg, save) => applyToggle(obj, "money_pages", ALL_MONEY_KEYS, moneyChecked, `${sid}:${pg}`, save);
  const tSpace = (obj, sid, save) => {
    const sp = obj.spaces || [];
    let base = sp.length ? [...sp] : SPACES.map(s => s.id);
    base = base.includes(sid) ? base.filter(x => x !== sid) : [...base, sid];
    save({ spaces: base.length === SPACES.length ? [] : base });
  };
  // ── 身份範本（連動）CRUD ──
  const updateRole = (id, changes) => commitRoles && commitRoles(roles.map(r => r.id === id ? { ...r, ...changes } : r));
  const addRole = () => { const n = window.prompt("新增身份名稱（例：工地監工）"); if (!n || !n.trim() || !commitRoles) return; commitRoles([...roles, { id: "role-" + Math.random().toString(36).slice(2, 7), name: n.trim(), spaces: [], view_pages: [], pages: [], money_pages: [] }]); logAct("新增身份", n.trim()); };
  const renameRole = (r) => { const n = window.prompt("身份改名", r.name); if (n && n.trim()) { updateRole(r.id, { name: n.trim() }); logAct("身份改名", `${r.name}→${n.trim()}`); } };
  const delRole = async (r) => {
    if (!(await confirm(`刪除身份「${r.name}」？指派此身份的帳號會變回「自訂」。`, { confirmLabel: "刪除" })) || !commitRoles) return;
    commitRoles(roles.filter(x => x.id !== r.id));
    (list || []).filter(p => p.role_template === r.id).forEach(p => patch(p.id, { role_template: null }));
    logAct("刪除身份", r.name);
  };
  const roleName = (id) => roles.find(r => r.id === id)?.name;

  const addAcct = async () => {
    if (!nUser.trim() || !nPw || busy) return;
    setBusy(true); setErr("");
    try { await api({ action:"create", username:nUser.trim(), password:nPw, displayName:nName.trim()||nUser.trim(), role:nAdmin?"admin":"staff" });
      logAct("新增帳號", (nName.trim()||nUser.trim()) + (nAdmin ? "（管理員）" : ""));
      setNName(""); setNUser(""); setNPw(""); setNAdmin(false); setBusy(false); load(); // 建好即放開按鈕，清單在背景刷新（不卡住）
      return;
    } catch(e){ setErr(e.message); }
    setBusy(false);
  };
  const delAcct = async (p) => {
    if (!(await confirm(`刪除帳號「${p.display_name}」？刪除後此人將無法再登入。`, { confirmLabel:"刪除" }))) return;
    setErr(""); try { await api({ action:"delete", id:p.id }); logAct("刪除帳號", p.display_name); load(); } catch(e){ setErr(e.message); }
  };
  const resetPw = async (p) => {
    const np = window.prompt(`輸入「${p.display_name}」的新密碼（至少 6 碼）：`); if (!np) return;
    setErr(""); try { await api({ action:"resetPassword", id:p.id, password:np }); logAct("重設密碼", p.display_name); alert("已重設密碼"); } catch(e){ setErr(e.message); }
  };
  const renamePerson = (p) => { const n = window.prompt("改顯示名稱（給人看的，不影響登入）：", p.display_name); if (n && n.trim() && n.trim() !== p.display_name) { patch(p.id, { display_name: n.trim() }); logAct("改顯示名稱", `${p.display_name}→${n.trim()}`); } };
  const changeUsername = async (p) => {
    const cur = (p.email || "").split("@")[0];
    const n = window.prompt(`改登入帳號（目前：${cur}）。\n改完這個人要改用新帳號登入：`, cur);
    if (!n || !n.trim() || n.trim() === cur) return;
    setErr(""); try { await api({ action: "update", id: p.id, username: n.trim() }); logAct("改登入帳號", `${p.display_name}：${cur}→${n.trim()}`); load(); alert(`已改成「${n.trim()}」，請通知本人改用新帳號登入。`); } catch (e) { setErr(e.message); }
  };

  const cbox = (on, onClick, color = "#3C8C3C") => (
    <button onClick={onClick} title={on ? "已開啟，點擊關閉" : "已關閉，點擊開啟"} style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${on ? color : "#CFC6B0"}`, background: on ? color : "#fff", color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>{on ? "✓" : ""}</button>
  );
  const pill = (on, label, onClick) => (
    <button onClick={onClick} style={{ padding: "4px 12px", borderRadius: 999, border: `1px solid ${on ? "#3C8C3C" : "#e5e5e5"}`, background: on ? "#EAF3EA" : "#f5f5f5", color: on ? "#2E7D32" : "#a3a3a3", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{on ? "✓ " : ""}{label}</button>
  );

  // 可重用矩陣：對任一實體(帳號或身份範本)渲染「每空間×每頁」勾選表。readOnly＝唯讀(顯示連動帳號的實際權限)。
  const renderMatrix = (obj, save, idPrefix, readOnly = false, hideEdit = false) => (
    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      {ACCT_SPACES.map(([sid, slabel]) => {
        const rows = PERM_MATRIX[sid] || [];
        const on = spaceChecked(obj, sid);
        const hasMoney = !!SPACE_CONF[sid]?.showCost;
        const spKey = idPrefix + ":" + sid;
        const spOpen = openSp.has(spKey);
        const visN = rows.filter(([pg]) => viewChecked(obj, sid, pg)).length;
        const editN = rows.filter(([pg,, c]) => c.edit && editChecked(obj, sid, pg)).length;
        const moneyN = hasMoney ? rows.filter(([pg,, c]) => c.money && moneyChecked(obj, sid, pg)).length : 0;
        const click = (fn) => readOnly ? undefined : fn;
        return (
          <div key={sid} style={{ border: "1px solid #E7DFCC", borderRadius: 10, overflow: "hidden", opacity: on ? 1 : 0.6 }}>
            <div onClick={() => on && toggleSet(setOpenSp, spKey)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F7F2E7", padding: "8px 12px", cursor: on ? "pointer" : "default" }}>
              <span style={{ fontSize: 11, color: "#a3a3a3", width: 10, display: "inline-block", transform: spOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>{on ? "▸" : ""}</span>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#211C15" }}>{slabel}</div>
              {on && !spOpen && <span style={{ fontSize: 11.5, color: "#a3a3a3" }}>可見 {visN}/{rows.length}・可編輯 {editN}{hasMoney ? `・看金額 ${moneyN}` : ""}</span>}
              <div style={{ flex: 1 }} />
              {pill(on, "可進入", (e) => { e.stopPropagation(); if (!readOnly) tSpace(obj, sid, save); })}
            </div>
            {on && spOpen && (() => {
              // 轉置：頁面＝橫向欄位（上方），可見/可編輯/看金額＝往下的列
              const sep = "1px solid #EFE8D6";
              const gtc = `78px repeat(${rows.length}, minmax(46px, 1fr))`;
              const dims = [
                { label: "可見", color: "#3C8C3C", on: (pg) => viewChecked(obj, sid, pg), cap: () => true, go: (pg) => tView(obj, sid, pg, save) },
                ...(hideEdit ? [] : [{ label: "可編輯", color: "#b5512b", on: (pg) => editChecked(obj, sid, pg), cap: (c) => !!c.edit, go: (pg) => tEdit(obj, sid, pg, save) }]),
                ...(hasMoney ? [{ label: "看金額", color: "#2E7D32", on: (pg) => moneyChecked(obj, sid, pg), cap: (c) => !!c.money, go: (pg) => tMoney(obj, sid, pg, save) }] : []),
              ];
              return (
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 78 + rows.length * 46 }}>
                    {/* 表頭：頁面名稱橫向 */}
                    <div style={{ display: "grid", gridTemplateColumns: gtc, fontSize: 11.5, fontWeight: 600, color: "#7A6F58", background: "#ffffff", borderBottom: sep }}>
                      <div style={{ padding: "6px 8px" }} />
                      {rows.map(([pg, plabel]) => <div key={pg} style={{ padding: "6px 2px", textAlign: "center", borderLeft: sep, whiteSpace: "nowrap" }}>{plabel}</div>)}
                    </div>
                    {/* 三列：可見 / 可編輯 / 看金額 */}
                    {dims.map((d, di) => (
                      <div key={d.label} style={{ display: "grid", gridTemplateColumns: gtc, alignItems: "center", background: di % 2 ? "#FBF8F0" : "#fff", borderTop: "1px solid #F3EEE1" }}>
                        <div style={{ padding: "5px 8px", fontSize: 12.5, fontWeight: 600, color: d.color }}>{d.label}</div>
                        {rows.map(([pg, , caps]) => (
                          <div key={pg} style={{ display: "flex", alignItems: "center", justifyContent: "center", borderLeft: sep, padding: "5px 0" }}>
                            {d.cap(caps) ? cbox(d.on(pg), click(() => d.go(pg)), d.color) : <span style={{ color: "#DDD4BE" }}>—</span>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ maxWidth: 1100, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize:18, fontWeight: 600, color:"#211C15", marginBottom:6 }}>👤 帳號管理（僅管理員）</div>
      <div style={{ background:"#faf6ee", border:"1px solid #e4ddc9", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#6b6450", lineHeight:1.7 }}>
        最省事做法：先在下方<b style={{color:"#b45309"}}>「身份範本」</b>設好各種身份的權限（如工地監工、會計），再到每個帳號選一個<b>身份</b>即可——之後改身份權限，所有用此身份的人<b>自動跟著變</b>。也可選「自訂」單獨設某人。預設全部開放，取消勾就是不給；沒登入的人只能看。
      </div>

      {err && <div style={{ background:"#FEF2F2", border:"1px solid #FCA5A5", color:"#DC2626", borderRadius:8, padding:"8px 12px", marginBottom:12, fontSize:13 }}>{err}</div>}

      {/* 訪客（未登入）權限：誰點連結沒登入時能看到什麼 */}
      {commitGuestPerms && (() => {
        const open = openAcct.has("__guest__");
        const gMoney = ALL_MONEY_KEYS.filter(k => { const [s, g] = k.split(":"); return moneyChecked(guestPerms, s, g); }).length;
        return (
          <div style={{ background: "#FFF7F2", border: "1px solid #F0CFB8", borderRadius: 12, padding: "12px 16px", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>👁 訪客（未登入）</div>
              <span style={{ fontSize: 12, color: "#a3a3a3" }}>沒登入就點連結的人能看到什麼{gMoney ? `・看得到 ${gMoney} 頁金額` : "・看不到金額"}</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => toggleSet(setOpenAcct, "__guest__")} style={{ background: open ? "#b5512b" : "#fff", color: open ? "#fff" : "#b5512b", border: "1px solid #b5512b", borderRadius: 8, padding: "4px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{open ? "收合 ▴" : "設定 ▾"}</button>
            </div>
            {open && <>
              <div style={{ fontSize: 12, color: "#6F6656", marginTop: 8, lineHeight: 1.7 }}>訪客<b>一律唯讀</b>（不能改任何東西）。下面設定他「看得到哪些空間/頁面」「哪幾頁看得到金額」。<b style={{ color: "#C2410C" }}>金額預設全關</b>，要逐頁勾才看得到。不同階段可隨時調。</div>
              {renderMatrix(guestPerms, (changes) => { commitGuestPerms({ ...guestPerms, ...changes }); logThrottled("改訪客權限", "訪客"); }, "guest", false, true)}
            </>}
          </div>
        );
      })()}

      {/* 身份範本（連動）：設定一次，指派給帳號後權限跟著身份走 */}
      <div style={{ marginBottom:18 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:8 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#211C15" }}>🧩 身份範本（連動）</div>
          <span style={{ fontSize:12, color:"#a3a3a3" }}>設定一次，指派給帳號後權限自動跟著身份走</span>
          <div style={{ flex:1 }} />
          <button onClick={addRole} style={{ background:"#b5512b", color:"#fff", border:"none", borderRadius:8, padding:"6px 14px", fontSize:13, fontWeight:600, cursor:"pointer" }}>＋ 新增身份</button>
        </div>
        {roles.length === 0 ? <div style={{ fontSize:13, color:"#a3a3a3", padding:"6px 2px" }}>還沒有身份範本，點「＋ 新增身份」。</div> :
         roles.map(r => {
           const open = openAcct.has(r.id);
           const memberN = (list||[]).filter(p=>p.role_template===r.id).length;
           return (
             <div key={r.id} style={{ background:"#fff", border:"1px solid #e5e5e5", borderRadius:12, padding:"10px 14px", marginBottom:8 }}>
               <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                 <div style={{ fontSize:14, fontWeight:700, color:"#211C15" }}>{r.name}</div>
                 <span style={{ fontSize:11.5, color:"#a3a3a3" }}>{memberN} 人使用</span>
                 <button onClick={()=>renameRole(r)} style={{ background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:7, padding:"2px 9px", fontSize:11.5, color:"#6F6656", cursor:"pointer" }}>改名</button>
                 <div style={{ flex:1 }} />
                 <button onClick={()=>toggleSet(setOpenAcct, r.id)} style={{ background: open?"#b5512b":"#fff", color: open?"#fff":"#b5512b", border:"1px solid #b5512b", borderRadius:8, padding:"4px 12px", fontSize:12.5, fontWeight:600, cursor:"pointer" }}>{open?"收合 ▴":"編輯權限 ▾"}</button>
                 <button onClick={()=>delRole(r)} title="刪除身份" style={{ background:"none", border:"none", color:"#C8BCA0", cursor:"pointer", fontSize:18 }} onMouseEnter={e=>e.currentTarget.style.color="#DC2626"} onMouseLeave={e=>e.currentTarget.style.color="#C8BCA0"}>×</button>
               </div>
               {open && renderMatrix(r, (changes)=>{ updateRole(r.id, changes); logThrottled("改身份權限", r.name); }, "role-"+r.id, false)}
             </div>
           );
         })}
      </div>

      {/* 新增帳號 */}
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:18, flexWrap:"wrap", background:"#fff", border:"1px solid #e5e5e5", borderRadius:12, padding:14 }}>
        <input value={nName} onChange={e=>setNName(e.target.value)} placeholder="顯示名稱（例：阿明）" style={{ ...inputStyle, width:170 }} />
        <input value={nUser} onChange={e=>setNUser(e.target.value)} placeholder="登入帳號（例：aming）" autoCapitalize="off" autoCorrect="off" style={{ ...inputStyle, width:170 }} />
        <input value={nPw} onChange={e=>setNPw(e.target.value)} type="text" placeholder="密碼（至少6碼）" style={{ ...inputStyle, width:150 }} />
        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#4A4234", cursor:"pointer" }}>
          <input type="checkbox" checked={nAdmin} onChange={e=>setNAdmin(e.target.checked)} /> 設為管理員
        </label>
        <button onClick={addAcct} disabled={!nUser.trim()||!nPw||busy} style={{ background:(nUser.trim()&&nPw&&!busy)?"#b5512b":"#e5e5e5", color:(nUser.trim()&&nPw&&!busy)?"#fff":"#a3a3a3", border:"none", borderRadius:8, padding:"9px 18px", fontWeight: 600, cursor:(nUser.trim()&&nPw&&!busy)?"pointer":"not-allowed" }}>{busy?"建立中…":"＋ 新增帳號"}</button>
      </div>

      {/* 帳號清單（卡片） */}
      {list === null ? <div style={{ padding:30, textAlign:"center", color:"#a3a3a3" }}>載入中…</div>
       : list.length === 0 ? <div style={{ padding:30, textAlign:"center", color:"#a3a3a3", fontSize:13 }}>尚無帳號</div>
       : list.map(p => {
        const isAdm = p.role === "admin";
        const acctOpen = openAcct.has(p.id);
        const linkedRole = p.role_template ? roles.find(r => r.id === p.role_template) : null;
        const eff = linkedRole || p; // 連動帳號的實際權限來自身份
        const spacesIn = ACCT_SPACES.filter(([sid]) => spaceChecked(eff, sid)).length;
        const moneyPages = ALL_MONEY_KEYS.filter(k => { const [s, g] = k.split(":"); return moneyChecked(eff, s, g); }).length;
        return (
        <div key={p.id} style={{ background:"#fff", border:"1px solid #e5e5e5", borderRadius:12, padding:"12px 16px", marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:15, fontWeight:700, color:"#211C15" }}>{p.display_name}</div>
            <button onClick={()=>renamePerson(p)} title="改顯示名稱" style={{ background:"none", border:"none", color:"#C8BCA0", cursor:"pointer", fontSize:13, padding:0 }} onMouseEnter={e=>e.currentTarget.style.color="#b5512b"} onMouseLeave={e=>e.currentTarget.style.color="#C8BCA0"}>✎</button>
            <div style={{ fontSize:12, color:"#a3a3a3" }}>{(p.email||"").split("@")[0]}</div>
            <button onClick={()=>!isAdm||list.filter(x=>x.role==="admin").length>1 ? (patch(p.id, { role: isAdm?"staff":"admin" }), logAct("改層級", `${p.display_name}→${isAdm?"一般":"管理員"}`)) : alert("至少要保留一位管理員")} style={{ background:"#f5f5f5", border:"1px solid #e5e5e5", borderRadius:8, padding:"3px 11px", fontSize:12.5, cursor:"pointer", color:isAdm?"#b5512b":"#4A4234", fontWeight:isAdm?700:400 }}>{isAdm?"管理員":"一般"} ⇄</button>
            {!isAdm && linkedRole && <span style={{ fontSize:12, fontWeight:700, color:"#2E7D32", background:"#EAF3EA", border:"1px solid #CFE3CF", borderRadius:999, padding:"2px 10px" }}>身份：{linkedRole.name}</span>}
            {!isAdm && <span style={{ fontSize:12, color:"#a3a3a3" }}>可進入 {spacesIn} 空間{moneyPages?`・看金額 ${moneyPages} 頁`:""}</span>}
            <div style={{ flex:1 }} />
            {!isAdm && <button onClick={()=>toggleSet(setOpenAcct, p.id)} style={{ background: acctOpen?"#b5512b":"#fff", color: acctOpen?"#fff":"#b5512b", border:"1px solid #b5512b", borderRadius:8, padding:"4px 12px", fontSize:12.5, fontWeight:600, cursor:"pointer" }}>{acctOpen?"收合權限 ▴":"設定權限 ▾"}</button>}
            <button onClick={()=>changeUsername(p)} style={{ background:"none", border:"1px solid #e5e5e5", borderRadius:8, padding:"3px 10px", fontSize:12, color:"#6F6656", cursor:"pointer" }}>改帳號</button>
            <button onClick={()=>resetPw(p)} style={{ background:"none", border:"1px solid #e5e5e5", borderRadius:8, padding:"3px 10px", fontSize:12, color:"#6F6656", cursor:"pointer" }}>重設密碼</button>
            {p.id !== myId && <button onClick={()=>delAcct(p)} title="刪除帳號" style={{ background:"none", border:"none", color:"#C8BCA0", cursor:"pointer", fontSize:18 }} onMouseEnter={e=>e.currentTarget.style.color="#DC2626"} onMouseLeave={e=>e.currentTarget.style.color="#C8BCA0"}>×</button>}
          </div>
          {isAdm ? <div style={{ fontSize:13, color:"#a3a3a3", marginTop:6 }}>管理員：全部空間／全部頁面／可編輯全部／可看金額</div> : (acctOpen &&
          <div style={{ marginTop:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:12.5, color:"#6F6656" }}>身份：</span>
              <select value={p.role_template||""} onChange={e=>{ patch(p.id, { role_template: e.target.value || null }); logAct("指派身份", `${p.display_name}→${roleName(e.target.value) || "自訂"}`); }} style={{ ...inputStyle, width:200, padding:"5px 8px" }}>
                <option value="">自訂（這個人單獨設）</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {linkedRole && <span style={{ fontSize:11.5, color:"#a3a3a3" }}>權限跟著身份走；要改請改上面的「{linkedRole.name}」身份範本。</span>}
            </div>
            {linkedRole
              ? renderMatrix(linkedRole, ()=>{}, "acctRO-"+p.id, true)
              : renderMatrix(p, (changes)=>{ patch(p.id, changes); logThrottled("改權限", p.display_name); }, "acct-"+p.id, false)}
          </div>)}
        </div>);
       })}
      <div style={{ fontSize:11.5, color:"#a3a3a3", marginTop:8, lineHeight:1.7 }}>
        提示：三欄（可見／可編輯／看金額）都預設打勾＝全開，取消勾就是不給；可一路取消到「全關」。要讓「身份」「看金額」存得住，Supabase 需先有 money_pages、role_template 兩個欄位（見上次給的 SQL）。
      </div>
    </div>
  );
}

// ── AI 代理：可執行操作的指令引擎 ───────────────────────────────────────────────
const STATUS_ALIASES = {
  "待開工":"pending","未開工":"pending","pending":"pending",
  "進行中":"inprogress","施工中":"inprogress","inprogress":"inprogress","in_progress":"inprogress",
  "完工":"done","完成":"done","已完成":"done","done":"done",
  "有問題":"issue","問題":"issue","issue":"issue",
  "暫停":"paused","paused":"paused",
};
const normStatus = (s) => STATUS_ALIASES[String(s||"").trim()] || null;
const genId = (p) => p + "-" + Math.random().toString(36).slice(2,8);
const findCat = (cats, q) => {
  if (!q) return null;
  return cats.find(c => c.name === q) || cats.find(c => c.name.includes(q) || q.includes(c.name));
};
const findItem = (cat, q) => {
  if (!cat || !q) return null;
  return cat.items.find(i => i.name === q) || cat.items.find(i => i.name.includes(q) || q.includes(i.name));
};

// 從字串中掃出所有「括號平衡」的 {...} 物件（含被截斷的外層也能撿出內層完整物件）
function extractBalancedObjects(s) {
  const out = []; const stack = []; let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") stack.push(i);
    else if (ch === "}") { const st = stack.pop(); if (st != null) out.push(s.slice(st, i + 1)); }
  }
  return out;
}

// 解析 AI 回覆中的指令。容錯：抓 ```json 區塊；接受 {actions:[]} / 裸{type} / 陣列；
// 並對「回覆被截斷」(沒結尾 ``` / JSON 不完整) 做搶救：逐一撿出已完整的 {type:...} 物件。
function parseActions(text) {
  if (!text) return [];
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map(m => m[1]);
  if (blocks.length === 0) {
    const m = text.match(/\{[\s\S]*"actions"[\s\S]*\}/);
    if (m) blocks.push(m[0]);
  }
  if (blocks.length === 0) blocks.push(text); // 連 ```json 圍欄都被截掉時，直接掃整段文字
  const actions = [];
  for (const b of blocks) {
    let ok = false;
    try {
      const obj = JSON.parse(b);
      if (Array.isArray(obj)) { actions.push(...obj); ok = true; }
      else if (Array.isArray(obj.actions)) { actions.push(...obj.actions); ok = true; }
      else if (obj && obj.type) { actions.push(obj); ok = true; }
    } catch (_) {}
    if (!ok) { // 截斷搶救：撿出每個完整的 {...}，保留帶 type 的當作指令
      for (const objStr of extractBalancedObjects(b)) {
        try { const o = JSON.parse(objStr); if (o && o.type) actions.push(o); } catch (_) {}
      }
    }
  }
  return actions;
}

// 套用指令到 cats / settings，回傳 { cats, settings, results }
function applyActions(actions, cats, settings, worklog) {
  let next = JSON.parse(JSON.stringify(cats));
  let nextSettings = settings ? { ...settings } : settings;
  let nextWorklog = Array.isArray(worklog) ? [...worklog] : [];
  const results = [];
  for (const a of actions) {
    const t = a.type;
    try {
      if (t === "clear_all") {
        next = [];
        results.push("🗑️ 已清空所有工程資料");
      } else if (t === "clear_items") {
        const n = next.reduce((s,c)=>s+c.items.length,0);
        next = next.map(c => ({ ...c, items: [] }));
        results.push(`🧹 已清空所有大項的細項（共 ${n} 筆，保留 ${next.length} 個大項）`);
      } else if (t === "clear_category_items") {
        const c = findCat(next, a.category);
        if (c) { const n = c.items.length; c.items = []; results.push(`🧹 已清空「${c.name}」的 ${n} 筆細項`); }
        else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "add_category") {
        const cat = { id: genId("cat"), order: next.length, name: a.name || "新工程大項", budget: Number(a.budget)||0, status: "pending", items: [] };
        next.push(cat);
        results.push(`➕ 新增大項「${cat.name}」`);
      } else if (t === "delete_category") {
        const c = findCat(next, a.category);
        if (c) { next = next.filter(x => x.id !== c.id); results.push(`🗑️ 刪除大項「${c.name}」`); }
        else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "set_category_budget") {
        const c = findCat(next, a.category);
        if (c) { c.budget = Number(a.amount)||0; results.push(`💰 「${c.name}」預算設為 ${fmt(c.budget)}`); }
        else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "set_category_status") {
        const c = findCat(next, a.category); const s = normStatus(a.status);
        if (c && s) { c.status = s; if (s === "done") c.items = (c.items || []).map(it => ({ ...it, status: "done", done: true })); results.push(`🔖 「${c.name}」狀態設為 ${a.status}`); }
        else results.push(`⚠️ 無法設定「${a.category}」狀態`);
      } else if (t === "set_gantt") {
        const c = findCat(next, a.category);
        if (c) {
          if (a.startWeek != null) c.ganttStart = Math.max(0, Number(a.startWeek) - 1); // 使用者 1-based
          if (a.durationWeeks != null) c.ganttDur = Math.max(1, Number(a.durationWeeks));
          results.push(`📅 「${c.name}」排程：第${(c.ganttStart??0)+1}週起、${c.ganttDur??1}週`);
        } else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "add_item") {
        const c = findCat(next, a.category);
        if (c) {
          const tax = ["未稅","含稅","免稅"].includes(a.taxType) ? a.taxType : "未稅";
          const it = { id: genId("i"), name: a.name||"新細項", qty: Number(a.qty)||1, unit: a.unit||"式", unitPrice: Math.round(Number(a.unitPrice)||0), taxType: tax, labor:0, laborDays:0, dailyWage:0, assignee: a.assignee||"", status: normStatus(a.status)||"pending", receipts:[], notes: a.notes||"", chat:[] };
          c.items.push(it);
          results.push(`➕ 「${c.name}」新增細項「${it.name}」（${tax}${fmt(it.qty*it.unitPrice)}）`);
        } else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "delete_item") {
        const c = findCat(next, a.category); const it = c && findItem(c, a.item);
        if (c && it) { c.items = c.items.filter(x => x.id !== it.id); results.push(`🗑️ 刪除「${c.name}」的「${it.name}」`); }
        else results.push(`⚠️ 找不到細項「${a.item}」`);
      } else if (t === "set_item") {
        const c = findCat(next, a.category); const it = c && findItem(c, a.item);
        if (c && it) {
          const chg = [];
          if (a.qty != null) { it.qty = Number(a.qty); chg.push(`數量${it.qty}`); }
          if (a.unit != null) { it.unit = a.unit; chg.push(`單位${it.unit}`); }
          if (a.unitPrice != null) { it.unitPrice = Math.round(Number(a.unitPrice)); chg.push(`單價${fmt(it.unitPrice)}`); }
          if (["未稅","含稅","免稅"].includes(a.taxType)) { it.taxType = a.taxType; chg.push(`稅別${a.taxType}`); }
          if (a.assignee != null) { it.assignee = a.assignee; chg.push(`負責人${it.assignee}`); }
          if (a.notes != null) { it.notes = a.notes; chg.push("備註"); }
          if (a.status != null) { const s=normStatus(a.status); if (s) { it.status = s; chg.push(`狀態${a.status}`); } }
          it.lastUpdated = new Date().toISOString();
          results.push(`✏️ 「${c.name}/${it.name}」更新：${chg.join("、")||"（無變更）"}`);
        } else results.push(`⚠️ 找不到細項「${a.item}」`);
      } else if (t === "set_setting") {
        if (nextSettings && a.field) { nextSettings[a.field] = a.value; results.push(`⚙️ 設定「${a.field}」已更新`); }
      } else if (t === "add_log") {
        const entry = { id: genId("wl"), date: a.date || new Date().toISOString().slice(0,10), content: a.content || "", author: a.author || "AI", ts: new Date().toISOString() };
        nextWorklog = [entry, ...nextWorklog];
        results.push(`📓 工作日誌新增（${entry.date}）：${(a.content||"").slice(0,30)}`);
      } else {
        results.push(`⚠️ 不支援的指令：${t}`);
      }
    } catch (e) {
      results.push(`⚠️ 執行「${t}」失敗`);
    }
  }
  return { cats: next, settings: nextSettings, worklog: nextWorklog, results };
}

const AGENT_GUIDE = `

你不只是顧問，你還能「直接操作」這個工程管理系統。當使用者要求你執行操作（新增/修改/刪除/清空/排程/設定金額等），請在回覆中附上一段可執行指令，格式為 markdown 的 json 區塊：

\`\`\`json
{"actions":[ ... ]}
\`\`\`

可用指令（type 與參數）：
- {"type":"clear_all"} 清空全部工程資料（含大項）
- {"type":"clear_items"} 清空所有大項的細項但「保留大項結構」（要重新上資料時用這個）
- {"type":"clear_category_items","category":"假設工程"} 只清空某大項的細項
- {"type":"add_category","name":"空調工程","budget":310000}
- {"type":"delete_category","category":"空調工程"}
- {"type":"set_category_budget","category":"空調工程","amount":310000}
- {"type":"set_category_status","category":"拆除工程","status":"進行中"}  // 狀態：待開工/進行中/完工/有問題/暫停
- {"type":"set_gantt","category":"地坪工程","startWeek":4,"durationWeeks":3}  // 第幾週開始(1起算)、持續幾週
- {"type":"add_item","category":"空調工程","name":"大金VRV主機","qty":1,"unit":"式","unitPrice":310000,"taxType":"未稅"}  // taxType：未稅/含稅/免稅，預設未稅
- {"type":"set_item","category":"空調工程","item":"主機","qty":2,"unitPrice":150000,"taxType":"含稅","status":"進行中","assignee":"王師傅"}
- {"type":"delete_item","category":"空調工程","item":"主機"}
- {"type":"add_log","content":"今天拆除工程完成80%，廢料清運2車，明天接續隔間","date":"2026-05-31"}  // 工作日誌；date 可省略(預設今天)

規則：
1. category/item 用名稱比對（可部分名稱）。
2. 一次可放多個 action。
3. 先用一兩句白話說明你要做什麼，再附 json 區塊。
4. 只有在使用者「要求執行操作」時才附 json；單純問問題就正常回答、不要附 json。
5. 破壞性操作（清空、刪除）也照樣附指令，系統會再跟使用者確認。
6. 要「清空所有細項重新上資料」時，務必用單一 clear_items 指令，絕對不要產生大量 delete_item 逐筆刪除（會超過長度限制）。
7. 【稅別／單價｜最重要，絕不可做除法換算】unitPrice 一律填「單據上看到的數字本身」(數量×單價=該列金額)，taxType 照單據標示：
   - 使用者／單據說「含稅」→ unitPrice 填那個含稅數字、taxType:"含稅"。例：含稅 88,200、數量1 → unitPrice 88,200、taxType:"含稅"（預估金額就會是 88,200）。
   - 「未稅」或沒講 → unitPrice 填該數字、taxType:"未稅"。
   - 真正免稅（保險、規費等）→ taxType:"免稅"。
   ⚠️ 絕對不要把含稅金額 ÷1.05、也不要自行加減稅；系統會依 taxType 自動算稅，你只要原數字＋正確稅別。
8. 【廠商→負責人】品項名稱裡括號或另一欄的「廠商／人名」(例：泥作工程材料(昇龍建材行)、莊芫菖) 要填到 "assignee"(負責人) 欄，不要併進 name。name 只放品項本身(例：泥作工程材料)。`;

const VISION_GUIDE = `

【判讀附件】若使用者提供圖片或檔案（估價單、報價單、收據、規格表、現場照片等），請仔細判讀，擷取工程項目、數量、單位、單價等資訊，並判斷對應到目前專案的哪個工程大項與細項：
- 能確定時 → 直接用 add_item / set_item / set_category_budget 等指令把資料填入，並條列你做了什麼。一張估價單可用多個 add_item 一次擷取多筆。
- 不確定對應哪個大項/細項、或數字不清楚時 → 「主動反問」使用者澄清（例如：這張估價單屬於哪個工程大項？單價是含稅嗎？），不要亂猜或填錯。
- 使用者若已用文字說明屬於哪個工程，請以使用者說明為準。`;

function ImportElapsed({ startedAt }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  return <span style={{ fontWeight: 400, color: "#a3a3a3" }}>（{s} 秒）</span>;
}
// ── 零用金帳本（獨立分頁）：撥款／花費／餘額＋工種歸屬＋文字貼上匯入 ──────────────
// ── 共用元件：日期欄（全 App 同一套；不會跳的原生選擇器）──────────────────────
function DateField({ value, onChange, style, title }) {
  const iso = String(value ?? "").replace(/\//g, "-").slice(0, 10);
  return <input type="date" value={iso} title={title} onChange={e => onChange(e.target.value)}
    style={{ border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 7px", fontSize: 13, fontFamily: "'Noto Sans TC', sans-serif", colorScheme: "light", cursor: "pointer", background: "#fff", color: iso ? "#211C15" : "#9A8F78", ...(style || {}) }} />;
}
// ── 共用元件：憑證/附件上傳（全 App 同一套；可選檔＋貼截圖＋縮圖放大＋移除）─────────
function ReceiptUploader({ receipts = [], onChange, size = 26 }) {
  const [busy, setBusy] = useState(false);
  const [lb, setLb] = useState(null);
  const inputRef = useRef(null);
  const add = async (fileList) => {
    const arr = Array.from(fileList || []); if (!arr.length) return;
    setBusy(true); const out = [];
    for (const f of arr) { try { const { url, path } = await uploadPhoto(f); out.push({ id: "rc" + Math.random().toString(36).slice(2, 7), url, path, name: f.name || "檔案", isImage: /^image\//.test(f.type) }); } catch (_) {} }
    setBusy(false); if (out.length) onChange([...(receipts || []), ...out]);
  };
  const onPaste = (e) => { const items = e.clipboardData?.items; if (!items) return; const fs = []; for (const it of items) { if (it.type?.startsWith("image/")) { const f = it.getAsFile(); if (f) fs.push(f); } } if (fs.length) { e.preventDefault(); add(fs); } };
  const pasteFromClipboard = async () => {
    try {
      const ctxItems = await navigator.clipboard.read();
      const fs = [];
      for (const it of ctxItems) { for (const type of it.types) { if (type.startsWith("image/")) { const blob = await it.getType(type); fs.push(new File([blob], `貼上.${type.split("/")[1] || "png"}`, { type })); } } }
      if (fs.length) await add(fs); else alert("剪貼簿沒有圖片，請先截圖（Cmd+Shift+4 等）再按貼上。");
    } catch (_) { alert("瀏覽器擋住讀取剪貼簿。請改按「＋」選檔，或在此格按 Cmd+V 貼上。"); }
  };
  return (
    <div onPaste={onPaste} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      <input ref={inputRef} type="file" accept="*/*" multiple style={{ display: "none" }} onChange={e => { add(e.target.files); e.target.value = ""; }} />
      {(receipts || []).map(r => (
        <span key={r.id} style={{ position: "relative", display: "inline-flex" }}>
          {r.isImage
            ? <img src={r.url} alt="" onClick={() => setLb(r)} style={{ width: size, height: size, objectFit: "cover", borderRadius: 4, border: `1px solid ${BORDER}`, cursor: "zoom-in" }} />
            : <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: size * 0.6, textDecoration: "none" }} title={r.name}>📄</a>}
          <button onClick={() => { if (window.confirm("移除這張憑證？此動作無法復原。")) onChange((receipts || []).filter(x => x.id !== r.id)); }} title="移除（會先詢問）" style={{ position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 9, border: "1.5px solid #fff", background: "#DC2626", color: "#fff", fontSize: 11, lineHeight: "14px", cursor: "pointer", padding: 0, boxShadow: "0 1px 2px rgba(0,0,0,.25)" }}>×</button>
        </span>
      ))}
      <button onClick={() => inputRef.current?.click()} onContextMenu={(e) => { e.preventDefault(); pasteFromClipboard(); }} title="點一下選檔上傳；要貼截圖：在這格按 Cmd+V，或在此鈕按右鍵" style={{ border: `1px dashed ${BORDER}`, background: "#fff", color: SUB, borderRadius: 5, width: size, height: size, fontSize: 13, cursor: "pointer" }}>{busy ? "…" : "＋"}</button>
      {lb && <div onClick={() => setLb(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}><img src={lb.url} alt={lb.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} /></div>}
    </div>
  );
}
const PETTY_MISC = "__misc__";
function PettyCashView({ petty, setPetty, cats, setCats, canEdit, confirm }) {
  const advances = petty?.advances || [];
  const spends = petty?.spends || [];
  const advTotal = advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const spendTotal = spends.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const balance = advTotal - spendTotal;
  const catName = (id) => id === PETTY_MISC ? "（未歸類）" : (cats.find(c => c.id === id)?.name || "（未歸類）");
  const catColor = (id) => { const palette = ["#C0392B","#3E72A8","#3C8C3C","#7A6F58","#8E7CC3","#C2872E","#2A9D8F","#A0522D"]; if (id === PETTY_MISC) return "#9A8F78"; const i = cats.findIndex(c => c.id === id); return palette[(i < 0 ? 0 : i) % palette.length]; };
  const byCat = {}; spends.forEach(s => { const k = s.catId || PETTY_MISC; byCat[k] = (byCat[k] || 0) + (Number(s.amount) || 0); });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catRows.map(r => r[1]));

  const guard = () => { if (!canEdit) { alert("沒有編輯權限，請聯絡管理員開放「總覽/工程資料」。"); return false; } return true; };
  const upd = (next) => setPetty(next);
  const addAdv = () => guard() && upd({ ...petty, advances: [...advances, { id: "a" + Date.now(), date: "", amount: 0, note: "" }] });
  const setAdv = (id, k, v) => upd({ ...petty, advances: advances.map(a => a.id === id ? { ...a, [k]: v } : a) });
  const delAdv = async (id) => { if (!guard()) return; const a = advances.find(x => x.id === id); if (!(await confirm(`刪除這筆撥款紀錄（${fmt(a?.amount || 0)}）？`, { confirmLabel: "刪除" }))) return; upd({ ...petty, advances: advances.filter(a => a.id !== id) }); };
  const addSpend = () => guard() && upd({ ...petty, spends: [...spends, { id: "s" + Date.now(), date: "", content: "", amount: 0, catId: PETTY_MISC }] });
  const setSpend = (id, k, v) => upd({ ...petty, spends: spends.map(s => s.id === id ? { ...s, [k]: v } : s) });
  const delSpend = async (id) => { if (!guard()) return; const s = spends.find(x => x.id === id); if (!(await confirm(`刪除這筆花費「${s?.content || "（無內容）"}」（${fmt(s?.amount || 0)}）？`, { confirmLabel: "刪除" }))) return; upd({ ...petty, spends: spends.filter(s => s.id !== id) }); };

  const [imp, setImp] = useState(null);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const ctrlRef = useRef(null);
  const mapCat = (cat) => { if (!cat) return PETTY_MISC; const f = cats.find(c => c.name === cat || c.name.includes(cat) || cat.includes(c.name)); return f ? f.id : PETTY_MISC; };
  const runParse = async () => {
    const text = paste.trim(); if (!text || !guard()) return;
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    setImp({ busy: true, startedAt: Date.now() });
    const catList = cats.map(c => c.name).join("、");
    const sys = `你是零用金帳本解析器。把貼上的表格/文字解析成 JSON，只輸出一個 json 區塊、不要其他文字：
\`\`\`json
{"advances":[{"date":"2026-04-02","amount":20000}],"spends":[{"date":"2026-04-01","content":"工人便當","amount":390,"category":"生活支出","voucher":"發票","invoiceNo":"AB-12345678"}]}
\`\`\`
規則：1)「請款/預支/撥款/零用金」這種公司撥錢給人的項目(常是負數或大額整數)→放 advances，amount 用正數。2)其餘實際花費→放 spends。3)category 用原本分類詞(生活支出/油漆工程/電工水材廠商/雜項...)。4)金額一律正整數、去逗號。5)沒日期留空字串。6)voucher 用憑證欄的值，限：發票/收據/免用收據/支出單，沒有就空字串。7)invoiceNo 抓發票編號欄，沒有就空字串。8)現有工程大項：${catList}。`;
    const reply = await callAI([{ role: "user", content: `解析這份零用金明細：\n${text}` }], sys, "import", ctrl.signal);
    if (ctrlRef.current !== ctrl) return;
    let obj = null; const m = reply.match(/```json\s*([\s\S]*?)```/i); try { obj = JSON.parse(m ? m[1] : reply); } catch (_) {}
    if (!obj || (!obj.spends?.length && !obj.advances?.length)) { setImp(null); alert(/^（AI/.test(reply) ? reply.replace(/[（）]/g, "") : "沒解析到資料，請確認貼上的內容是否完整。"); return; }
    const VOK = ["發票", "收據", "免用收據", "支出單"];
    const rows = (obj.spends || []).map(s => ({ pick: true, date: s.date || "", content: String(s.content || "").trim(), amount: Math.abs(Math.round(Number(s.amount) || 0)), catId: mapCat(s.category), category: s.category || "", voucher: VOK.includes(s.voucher) ? s.voucher : "", invoiceNo: String(s.invoiceNo || "").trim() }));
    const advs = (obj.advances || []).map(a => ({ date: a.date || "", amount: Math.abs(Math.round(Number(a.amount) || 0)) }));
    setImp({ rows, advs });
  };
  const cancelParse = () => { try { ctrlRef.current?.abort(); } catch (_) {} ctrlRef.current = null; setImp(null); };
  const confirmParse = () => {
    const newSpends = (imp.rows || []).filter(r => r.pick && r.content).map(r => ({ id: "s" + Math.random().toString(36).slice(2, 8), date: r.date, content: r.content, amount: r.amount, catId: r.catId, voucher: r.voucher || "", invoiceNo: r.invoiceNo || "", handed: false, claimed: false, receipts: [], note: "" }));
    const newAdvs = (imp.advs || []).map(a => ({ id: "a" + Math.random().toString(36).slice(2, 8), date: a.date, amount: a.amount, note: "請款" }));
    upd({ advances: [...advances, ...newAdvs], spends: [...spends, ...newSpends] });
    setImp(null); setPaste(""); setShowPaste(false);
  };

  // ── 花費明細表：搜尋／篩選／排序／拖曳／上傳憑證 ──
  const [search, setSearch] = useState("");
  const [fCat, setFCat] = useState("all");
  const [fVoucher, setFVoucher] = useState("all");
  const [fClaimed, setFClaimed] = useState("all");
  const [sortKey, setSortKey] = useState(null); // "date" | "amount" | null(手動)
  const [sortDir, setSortDir] = useState("asc");
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [advDragId, setAdvDragId] = useState(null);
  const [advDragOverId, setAdvDragOverId] = useState(null);
  const [selected, setSelected] = useState(new Set()); // 勾選的花費 id（批次操作）
  const reorderAdv = (fromId, toId) => { if (fromId === toId) return; const arr = [...advances]; const fi = arr.findIndex(a => a.id === fromId), ti = arr.findIndex(a => a.id === toId); if (fi < 0 || ti < 0) return; const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m); upd({ ...petty, advances: arr }); };
  const toggleSel = (id, on) => setSelected(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });
  const bulkSetField = (field, val) => { upd({ ...petty, spends: spends.map(s => selected.has(s.id) ? { ...s, [field]: val } : s) }); };
  const bulkDelete = async () => { if (!(await confirm(`刪除選取的 ${selected.size} 筆花費？`, { confirmLabel: "刪除" }))) return; upd({ ...petty, spends: spends.filter(s => !selected.has(s.id)) }); setSelected(new Set()); };
  // ── AI 智慧歸類：依花費內容自動建議工種 → 預覽確認（無法辨識/錯誤可改下拉）→ 套用 ──
  const [classify, setClassify] = useState(null); // null | {busy,startedAt} | {rows:[{id,content,amount,old,sug}]}
  const classifyCtrlRef = useRef(null);
  const autoClassify = async () => {
    if (!guard()) return;
    const targets = spends.filter(s => s.content);
    if (!targets.length) { alert("沒有可歸類的花費"); return; }
    const ctrl = new AbortController(); classifyCtrlRef.current = ctrl;
    setClassify({ busy: true, startedAt: Date.now() });
    const catList = cats.map(c => c.name).join("、");
    const sys = `你是工程費用歸類助理。把每筆零用金花費依「內容」歸到最合適的工程大項。只輸出一個 json 區塊、不要其他文字：
\`\`\`json
{"map":[{"id":"s_xxx","cat":"油漆防水工程"}]}
\`\`\`
歸類原則：油漆/批土/防水/打樣→油漆相關大項；水電/電線/開關/插座/排水/水管→機電或消防相關；燈具/軌道燈→燈具相關；木皮/木作/角材/櫃→木工相關；磁磚/地坪→地坪相關；清潔/打掃/拖把→清潔相關大項；便當/飲料/餐費/計程車/停車/運費/搬運工/小工/雜工/影印 這種交通餐費雜支→歸到清單裡名稱含「雜支」或「交通餐費」的大項（清單裡有就用它）。一定要從清單挑最接近的大項名稱，真的完全對不到才回「未歸類」。現有工程大項：${catList}。`;
    const input = targets.map(s => ({ id: s.id, 內容: s.content })).slice(0, 250);
    const reply = await callAI([{ role: "user", content: `歸類這些花費，回每筆的 id 與最合適的工程大項名稱：\n${JSON.stringify(input)}` }], sys, "import", ctrl.signal);
    if (classifyCtrlRef.current !== ctrl) return;
    let obj = null; const m = reply.match(/```json\s*([\s\S]*?)```/i); try { obj = JSON.parse(m ? m[1] : reply); } catch (_) {}
    if (!obj?.map?.length) { setClassify(null); alert(/^（AI/.test(reply) ? reply.replace(/[（）]/g, "") : "AI 沒有回傳歸類結果，請再試一次。"); return; }
    const byId = {}; obj.map.forEach(x => { byId[x.id] = x.cat; });
    const rows = targets.map(s => ({ id: s.id, content: s.content, amount: s.amount, old: s.catId || PETTY_MISC, sug: mapCat(byId[s.id]) }));
    setClassify({ rows });
  };
  const cancelClassify = () => { try { classifyCtrlRef.current?.abort(); } catch (_) {} classifyCtrlRef.current = null; setClassify(null); };
  const setClassifyRow = (id, catId) => setClassify(c => ({ ...c, rows: c.rows.map(r => r.id === id ? { ...r, sug: catId } : r) }));
  const applyClassify = () => { const map = {}; classify.rows.forEach(r => { map[r.id] = r.sug; }); upd({ ...petty, spends: spends.map(s => map[s.id] != null ? { ...s, catId: map[s.id] } : s) }); setClassify(null); };

  const VOUCHER_OPTS = [["", "—", "#9A8F78"], ["發票", "發票", "#7A3E1D"], ["收據", "收據", "#C0392B"], ["免用收據", "免用收據", "#2E7D32"], ["支出單", "支出單", "#6B6450"], ["其他", "其他", "#8E7CC3"]];
  const voucherColor = (v) => (VOUCHER_OPTS.find(o => o[0] === (v || "")) || VOUCHER_OPTS[0])[2];

  const reorderSpend = (fromId, toId) => {
    if (fromId === toId) return;
    const arr = [...spends]; const fi = arr.findIndex(s => s.id === fromId), ti = arr.findIndex(s => s.id === toId);
    if (fi < 0 || ti < 0) return; const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m); upd({ ...petty, spends: arr });
  };
  const toggleSort = (k) => { if (sortKey === k) { if (sortDir === "asc") setSortDir("desc"); else { setSortKey(null); } } else { setSortKey(k); setSortDir("asc"); } };
  const manualOrder = !sortKey && !search.trim() && fCat === "all" && fVoucher === "all" && fClaimed === "all";

  // 套用搜尋/篩選/排序
  let viewSpends = spends.filter(s => {
    const q = search.trim().toLowerCase();
    if (q && !(`${s.content || ""} ${s.invoiceNo || ""} ${s.note || ""}`.toLowerCase().includes(q))) return false;
    if (fCat !== "all" && (s.catId || PETTY_MISC) !== fCat) return false;
    if (fVoucher !== "all" && (s.voucher || "") !== fVoucher) return false;
    if (fClaimed === "yes" && !s.claimed) return false;
    if (fClaimed === "no" && s.claimed) return false;
    return true;
  });
  if (sortKey) viewSpends = [...viewSpends].sort((a, b) => { const av = sortKey === "amount" ? (Number(a.amount) || 0) : (a.date || ""); const bv = sortKey === "amount" ? (Number(b.amount) || 0) : (b.date || ""); const r = av < bv ? -1 : av > bv ? 1 : 0; return sortDir === "asc" ? r : -r; });
  const viewTotal = viewSpends.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  const kpi = (label, val, color) => <div style={{ flex: 1, minWidth: 150, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 16px" }}><div style={{ fontSize: 12.5, color: SUB }}>{label}</div><div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{fmt(val)}</div></div>;
  const cellInput = (val, onCh, opts = {}) => <input value={val} onChange={e => onCh(e.target.value)} placeholder={opts.ph} style={{ width: opts.w || "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 7px", fontSize: 13, background: "#fff", color: TEXT, ...(opts.style || {}) }} />;
  const thStyle = (k) => ({ padding: "8px 6px", fontSize: 11.5, fontWeight: 600, color: SUB, whiteSpace: "nowrap", textAlign: "left", cursor: k ? "pointer" : "default", userSelect: "none" });
  const sortArrow = (k) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div style={{ maxWidth: 1100, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#211C15" }}>💵 零用金帳本</div>
        <div style={{ fontSize: 12.5, color: SUB }}>撥款給工地的現金，與實際花費分開記；花費依工種歸屬，併入工程實際成本。</div>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0" }}>
        {kpi("撥款合計（請款）", advTotal, "#C2410C")}
        {kpi("花費合計（實支）", spendTotal, "#3C8C3C")}
        {kpi("餘額（撥款−花費）", balance, balance < 0 ? "#DC2626" : "#211C15")}
      </div>

      {/* 各工種花費（點分類＝只看該類明細，像分類抽屜）*/}
      {catRows.length > 0 && (
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>各工種零用金花費</div>
            <span style={{ fontSize: 11.5, color: "#a3a3a3" }}>· 共 {catRows.length} 類 · 點分類只看該類明細 · 已併入該工種實際成本</span>
            {fCat !== "all" && <button onClick={() => setFCat("all")} style={{ marginLeft: "auto", border: `1px solid ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 12, padding: "2px 10px", fontSize: 11.5, cursor: "pointer" }}>✕ 清除分類篩選</button>}
          </div>
          {catRows.map(([id, amt]) => {
            const cnt = spends.filter(s => (s.catId || PETTY_MISC) === id).length;
            const active = fCat === id;
            return (
              <div key={id} onClick={() => setFCat(active ? "all" : id)} title="點一下：下方明細只看這一類（再點取消）" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, cursor: "pointer", background: active ? "#f5f5f5" : "transparent", borderRadius: 8, padding: "3px 6px", border: `1px solid ${active ? "#E0D6BE" : "transparent"}` }}>
                <div style={{ width: 150, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: active ? ACCENT : TEXT, fontWeight: active ? 700 : 500 }}>{catName(id)} <span style={{ color: "#a3a3a3", fontWeight: 400 }}>· {cnt}筆</span></div>
                <div style={{ flex: 1, height: 14, background: "#f0f0f0", borderRadius: 7, overflow: "hidden" }}><div style={{ width: (amt / maxCat * 100) + "%", height: "100%", background: catColor(id), borderRadius: 7 }} /></div>
                <div style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 600, color: TEXT, fontVariantNumeric: "tabular-nums" }}>{fmt(amt)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* 貼上匯入 */}
      <div style={{ marginBottom: 14 }}>
        {!showPaste ? (
          <button onClick={() => { if (guard()) setShowPaste(true); }} style={{ border: `1px solid ${ACCENT}`, background: "#FBF0EA", color: ACCENT, borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>📋 貼上整批花費明細 → AI 解析匯入（建議用文字，最快最準）</button>
        ) : (
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>把你整理好的明細（日期 / 內容 / 金額 / 分類）整段貼進來，一次帶入：</div>
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={6} placeholder={"例：\n4/1 工人便當 390 生活支出\n4/26 油漆一進 11508 油漆工程\n4/2 請款2萬零用金 -20000 零用金"} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={runParse} disabled={!paste.trim()} style={{ border: "none", background: paste.trim() ? ACCENT : "#e5e5e5", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13.5, fontWeight: 600, cursor: paste.trim() ? "pointer" : "not-allowed" }}>解析</button>
              <button onClick={() => { setShowPaste(false); setPaste(""); }} style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13.5, cursor: "pointer" }}>收起</button>
            </div>
          </div>
        )}
      </div>

      {/* 花費明細（專業表格：搜尋/篩選/排序/拖曳/憑證上傳） */}
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
        {/* 工具列 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#f5f5f5", borderBottom: `1px solid ${BORDER}`, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>花費明細</div>
          <span style={{ fontSize: 12, color: SUB }}>{viewSpends.length}/{spends.length} 筆 · 合計 {fmt(viewTotal)}</span>
          <div style={{ flex: 1 }} />
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#a3a3a3" }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋內容/發票號/備註" style={{ width: 180, border: `1px solid ${BORDER}`, borderRadius: 7, padding: "6px 8px 6px 26px", fontSize: 12.5, background: "#fff" }} />
          </div>
          <select value={fCat} onChange={e => setFCat(e.target.value)} title="篩選工種" style={{ border: `1px solid ${fCat !== "all" ? ACCENT : BORDER}`, borderRadius: 7, padding: "6px 6px", fontSize: 12, background: "#fff", color: TEXT }}>
            <option value="all">全部工種</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={PETTY_MISC}>（未歸類）</option>
          </select>
          <select value={fVoucher} onChange={e => setFVoucher(e.target.value)} title="篩選憑證" style={{ border: `1px solid ${fVoucher !== "all" ? ACCENT : BORDER}`, borderRadius: 7, padding: "6px 6px", fontSize: 12, background: "#fff", color: TEXT }}>
            <option value="all">全部憑證</option>{VOUCHER_OPTS.slice(1).map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}<option value="">未填</option>
          </select>
          <select value={fClaimed} onChange={e => setFClaimed(e.target.value)} title="篩選請款狀態" style={{ border: `1px solid ${fClaimed !== "all" ? ACCENT : BORDER}`, borderRadius: 7, padding: "6px 6px", fontSize: 12, background: "#fff", color: TEXT }}>
            <option value="all">請款：全部</option><option value="yes">已請款</option><option value="no">未請款</option>
          </select>
          <button onClick={autoClassify} title="AI 依花費內容自動建議工種，再讓你確認/調整" style={{ border: `1px solid ${ACCENT}`, background: "#FBF0EA", color: ACCENT, borderRadius: 7, padding: "6px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>🤖 AI 自動歸類</button>
          <button onClick={addSpend} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>＋ 新增</button>
        </div>
        {/* 批次操作列（勾選後出現）*/}
        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#FFF7E6", borderBottom: `1px solid #F0D98C`, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>已選 {selected.size} 筆</span>
            <span style={{ fontSize: 12.5, color: "#92400e" }}>批次改工種：</span>
            <select defaultValue="" onChange={e => { if (e.target.value) { bulkSetField("catId", e.target.value); e.target.value = ""; } }} style={{ border: `1px solid #C2872E`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, background: "#fff", color: TEXT }}>
              <option value="">選工種…</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={PETTY_MISC}>（未歸類）</option>
            </select>
            <span style={{ fontSize: 12.5, color: "#92400e" }}>憑證：</span>
            <select defaultValue="" onChange={e => { bulkSetField("voucher", e.target.value === "__none" ? "" : e.target.value); e.target.value = ""; }} style={{ border: `1px solid #C2872E`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, background: "#fff", color: TEXT }}>
              <option value="">選憑證…</option>{VOUCHER_OPTS.slice(1).map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}<option value="__none">清空</option>
            </select>
            <button onClick={() => bulkSetField("claimed", true)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: TEXT, borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>標記已請款</button>
            <button onClick={bulkDelete} style={{ border: "1px solid #FCA5A5", background: "#fff", color: "#DC2626", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>刪除</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSelected(new Set())} style={{ border: "none", background: "none", color: SUB, fontSize: 12.5, cursor: "pointer" }}>取消選取</button>
          </div>
        )}
        {/* 表格 */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1000 }}>
            <thead>
              <tr style={{ background: "#f5f5f5", borderBottom: `1px solid #E3DAC6` }}>
                <th style={{ ...thStyle(), width: 38, textAlign: "center" }}><input type="checkbox" title="全選/取消（目前顯示的）" checked={viewSpends.length > 0 && viewSpends.every(s => selected.has(s.id))} onChange={e => { const n = new Set(selected); viewSpends.forEach(s => e.target.checked ? n.add(s.id) : n.delete(s.id)); setSelected(n); }} style={{ cursor: "pointer" }} /></th>
                <th style={thStyle("date")} onClick={() => toggleSort("date")}>日期{sortArrow("date")}</th>
                <th style={thStyle()}>工種</th>
                <th style={thStyle()}>內容</th>
                <th style={{ ...thStyle("amount"), textAlign: "right" }} onClick={() => toggleSort("amount")}>金額{sortArrow("amount")}</th>
                <th style={thStyle()}>憑證</th>
                <th style={thStyle()}>發票編號</th>
                <th style={{ ...thStyle(), textAlign: "center" }}>已交</th>
                <th style={{ ...thStyle(), textAlign: "center" }}>已請款</th>
                <th style={thStyle()}>憑證檔</th>
                <th style={thStyle()}>備註</th>
                <th style={{ ...thStyle(), width: 24 }} />
              </tr>
            </thead>
            <tbody>
              {viewSpends.length === 0 ? (
                <tr><td colSpan={13} style={{ padding: 20, textAlign: "center", color: "#a3a3a3", fontSize: 13 }}>{spends.length ? "沒有符合條件的資料" : "尚無花費；可用上方「貼上整批花費明細」一次帶入，或按「＋ 新增」。"}</td></tr>
              ) : viewSpends.map(s => (
                <tr key={s.id}
                  draggable={manualOrder}
                  onDragStart={() => manualOrder && setDragId(s.id)}
                  onDragOver={e => { if (manualOrder && dragId) { e.preventDefault(); setDragOverId(s.id); } }}
                  onDrop={() => { if (manualOrder && dragId) { reorderSpend(dragId, s.id); setDragId(null); setDragOverId(null); } }}
                  onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                  style={{ borderBottom: "1px solid #f0f0f0", background: selected.has(s.id) ? "#FFF7E6" : (dragOverId === s.id ? "#eff6ff" : "transparent") }}>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}><input type="checkbox" checked={selected.has(s.id)} onChange={e => toggleSel(s.id, e.target.checked)} style={{ cursor: "pointer", verticalAlign: "middle" }} />{manualOrder && <span title="拖曳排序" style={{ color: "#C8BCA0", cursor: "grab", fontSize: 12, marginLeft: 3 }}>⠿</span>}</td>
                  <td style={{ padding: 3 }}><DateField value={s.date} onChange={v => setSpend(s.id, "date", v)} style={{ width: 134, padding: "5px 6px", fontSize: 12.5 }} /></td>
                  <td style={{ padding: 3 }}>
                    <select value={s.catId || PETTY_MISC} onChange={e => setSpend(s.id, "catId", e.target.value)} style={{ minWidth: 110, border: `1px solid ${catColor(s.catId || PETTY_MISC)}`, color: catColor(s.catId || PETTY_MISC), fontWeight: 600, borderRadius: 12, padding: "4px 6px", fontSize: 12, background: catColor(s.catId || PETTY_MISC) + "14" }}>
                      {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={PETTY_MISC}>（未歸類）</option>
                    </select>
                  </td>
                  <td style={{ padding: 3, minWidth: 200 }}><input value={s.content || ""} onChange={e => setSpend(s.id, "content", e.target.value)} placeholder="花費內容" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 7px", fontSize: 13 }} /></td>
                  <td style={{ padding: 3 }}><input type="number" value={s.amount || ""} onChange={e => setSpend(s.id, "amount", Math.abs(Math.round(Number(e.target.value) || 0)))} style={{ width: 88, textAlign: "right", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 7px", fontSize: 13, fontVariantNumeric: "tabular-nums" }} /></td>
                  <td style={{ padding: 3 }}>
                    <select value={s.voucher || ""} onChange={e => setSpend(s.id, "voucher", e.target.value)} style={{ border: `1px solid ${voucherColor(s.voucher)}`, color: s.voucher ? "#fff" : "#a3a3a3", fontWeight: 600, borderRadius: 8, padding: "4px 6px", fontSize: 12, background: s.voucher ? voucherColor(s.voucher) : "#fff" }}>
                      {VOUCHER_OPTS.map(o => <option key={o[0]} value={o[0]} style={{ color: "#000", background: "#fff" }}>{o[1]}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 3 }}><input value={s.invoiceNo || ""} onChange={e => setSpend(s.id, "invoiceNo", e.target.value)} placeholder="—" style={{ width: 110, border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 6px", fontSize: 12 }} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!s.handed} onChange={e => setSpend(s.id, "handed", e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#3C8C3C" }} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={!!s.claimed} onChange={e => setSpend(s.id, "claimed", e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#3E72A8" }} /></td>
                  <td style={{ padding: 3 }}><ReceiptUploader receipts={s.receipts || []} onChange={list => setSpend(s.id, "receipts", list)} /></td>
                  <td style={{ padding: 3, minWidth: 120 }}><input value={s.note || ""} onChange={e => setSpend(s.id, "note", e.target.value)} placeholder="—" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 6px", fontSize: 12.5 }} /></td>
                  <td style={{ textAlign: "center" }}><button onClick={() => delSpend(s.id)} title="刪除" style={{ border: "none", background: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 15 }} onMouseEnter={e => e.currentTarget.style.color = "#DC2626"} onMouseLeave={e => e.currentTarget.style.color = "#C8BCA0"}>×</button></td>
                </tr>
              ))}
              <tr><td colSpan={13} style={{ padding: 0 }}><button onClick={addSpend} style={{ width: "100%", textAlign: "left", padding: "11px 16px", border: "none", borderTop: `1px dashed ${BORDER}`, background: "#FBF7EE", color: ACCENT, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 在這裡新增一筆花費</button></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 撥款紀錄（移到最下面，不再夾在花費圖表與明細中間）*/}
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", background: "#f5f5f5", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT, flex: 1 }}>撥款紀錄（請款）· {advances.length} 筆<span style={{ fontSize: 11.5, color: "#a3a3a3", fontWeight: 400 }}>　公司撥現金給工地（不計工程成本）</span></div>
          <button onClick={addAdv} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: TEXT, borderRadius: 7, padding: "4px 12px", fontSize: 12.5, cursor: "pointer" }}>＋ 新增撥款</button>
        </div>
        {advances.length === 0 ? <div style={{ padding: 16, textAlign: "center", color: "#a3a3a3", fontSize: 13 }}>尚無撥款紀錄</div> : advances.map(a => (
          <div key={a.id}
            draggable
            onDragStart={() => setAdvDragId(a.id)}
            onDragOver={e => { if (advDragId) { e.preventDefault(); setAdvDragOverId(a.id); } }}
            onDrop={() => { if (advDragId) { reorderAdv(advDragId, a.id); setAdvDragId(null); setAdvDragOverId(null); } }}
            onDragEnd={() => { setAdvDragId(null); setAdvDragOverId(null); }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: `1px solid #f0f0f0`, background: advDragOverId === a.id ? "#eff6ff" : "transparent" }}>
            <span title="拖曳排序" style={{ color: "#C8BCA0", cursor: "grab", fontSize: 13, flexShrink: 0 }}>⠿</span>
            <DateField value={a.date} onChange={v => setAdv(a.id, "date", v)} style={{ width: 140 }} />
            {cellInput(a.note || "", v => setAdv(a.id, "note", v), { ph: "說明（請款）" })}
            <input type="number" value={a.amount || ""} onChange={e => setAdv(a.id, "amount", Math.abs(Math.round(Number(e.target.value) || 0)))} style={{ width: 120, textAlign: "right", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 7px", fontSize: 13, fontVariantNumeric: "tabular-nums" }} />
            <div style={{ flexShrink: 0 }} title="請款單憑證（可貼截圖）"><ReceiptUploader receipts={a.receipts || []} onChange={list => setAdv(a.id, "receipts", list)} /></div>
            <button onClick={() => delAdv(a.id)} style={{ border: "none", background: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 16, flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.color = "#DC2626"} onMouseLeave={e => e.currentTarget.style.color = "#C8BCA0"}>×</button>
          </div>
        ))}
        {advances.length > 0 && <button onClick={addAdv} style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderTop: `1px dashed ${BORDER}`, background: "#FBF7EE", color: ACCENT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>＋ 在這裡新增一筆撥款</button>}
      </div>

      <div style={{ fontSize: 11.5, color: "#a3a3a3", marginTop: 10, lineHeight: 1.7 }}>※ 點欄位標題（日期／金額）可排序；清空搜尋/篩選後可拖曳 ⠿ 排序。憑證檔可按「＋」上傳，或在該格直接貼上截圖。請款（撥款）不算工程成本；花費已依工種併入各大項實際成本。</div>

      {/* AI 歸類預覽：自動建議工種 → 確認/調整 → 套用 */}
      {classify && (
        <div onClick={e => e.target === e.currentTarget && !classify.busy && setClassify(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "min(820px,96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, fontSize: 15, fontWeight: 700, color: TEXT }}>🤖 AI 自動歸類工種（確認後套用）</div>
            {classify.busy ? (
              <div style={{ padding: "44px 24px", textAlign: "center" }}>
                <div style={{ color: ACCENT, fontSize: 15, fontWeight: 600 }}>🤖 AI 分析中…<ImportElapsed startedAt={classify.startedAt} /></div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 8 }}>依每筆內容判斷工種，通常 10–30 秒。</div>
                <button onClick={cancelClassify} style={{ marginTop: 16, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, borderRadius: 8, padding: "8px 22px", fontSize: 14, cursor: "pointer" }}>取消</button>
              </div>
            ) : (() => {
              const changed = classify.rows.filter(r => r.sug !== r.old).length;
              return (<>
                <div style={{ padding: "10px 18px", borderBottom: `1px solid ${BORDER}`, fontSize: 12.5, color: SUB }}>共 {classify.rows.length} 筆，AI 建議調整 <b style={{ color: ACCENT }}>{changed}</b> 筆。<span style={{ color: "#a3a3a3" }}>不對的用右邊下拉改，確認後一次套用。</span></div>
                <div style={{ flex: 1, overflowY: "auto", padding: "4px 18px" }}>
                  {classify.rows.map(r => {
                    const isChanged = r.sug !== r.old;
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #F2ECDD", background: isChanged ? "#FBF7EE" : "transparent" }}>
                        <span style={{ flex: 1, fontSize: 13, color: TEXT, minWidth: 100 }}>{r.content}</span>
                        <span style={{ width: 70, textAlign: "right", fontSize: 12.5, color: SUB, fontVariantNumeric: "tabular-nums" }}>{fmt(r.amount)}</span>
                        <span style={{ width: 92, fontSize: 11.5, color: "#a3a3a3", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catName(r.old)}</span>
                        <span style={{ color: isChanged ? ACCENT : "#C8BCA0", fontSize: 13 }}>→</span>
                        <select value={r.sug} onChange={e => setClassifyRow(r.id, e.target.value)} style={{ width: 150, border: `1px solid ${isChanged ? ACCENT : BORDER}`, borderRadius: 7, padding: "5px 6px", fontSize: 12.5, background: "#fff", color: isChanged ? ACCENT : TEXT, fontWeight: isChanged ? 700 : 400 }}>
                          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value={PETTY_MISC}>（未歸類）</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: "12px 18px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => setClassify(null)} style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 18px", fontSize: 14, cursor: "pointer" }}>取消</button>
                  <button onClick={applyClassify} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>套用歸類（{classify.rows.length} 筆）</button>
                </div>
              </>);
            })()}
          </div>
        </div>
      )}

      {/* 匯入預覽 */}
      {imp && (
        <div onClick={e => e.target === e.currentTarget && !imp.busy && setImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "min(760px,96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, fontSize: 15, fontWeight: 700, color: TEXT }}>📋 零用金匯入預覽</div>
            {imp.busy ? (
              <div style={{ padding: "44px 24px", textAlign: "center" }}>
                <div style={{ color: ACCENT, fontSize: 15, fontWeight: 600 }}>🤖 解析中…<ImportElapsed startedAt={imp.startedAt} /></div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 8 }}>文字解析通常 5–20 秒。太久可按「取消」。</div>
                <button onClick={cancelParse} style={{ marginTop: 16, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, borderRadius: 8, padding: "8px 22px", fontSize: 14, cursor: "pointer" }}>取消</button>
              </div>
            ) : (<>
              <div style={{ padding: "10px 18px", borderBottom: `1px solid ${BORDER}`, fontSize: 12.5, color: SUB }}>撥款 {(imp.advs || []).length} 筆、花費 {(imp.rows || []).length} 筆。可調整工種後再匯入。</div>
              <div style={{ flex: 1, overflowY: "auto", padding: "4px 18px" }}>
                {(imp.rows || []).map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #F2ECDD" }}>
                    <input type="checkbox" checked={r.pick} onChange={e => setImp({ ...imp, rows: imp.rows.map((x, j) => j === i ? { ...x, pick: e.target.checked } : x) })} />
                    <span style={{ width: 80, fontSize: 12, color: SUB }}>{r.date || "—"}</span>
                    <span style={{ flex: 1, fontSize: 13, color: TEXT }}>{r.content}</span>
                    <span style={{ width: 80, textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmt(r.amount)}</span>
                    <select value={r.catId} onChange={e => setImp({ ...imp, rows: imp.rows.map((x, j) => j === i ? { ...x, catId: e.target.value } : x) })} style={{ width: 140, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "4px 6px", fontSize: 12, background: "#fff" }}>
                      {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      <option value={PETTY_MISC}>（未歸類）</option>
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ padding: "12px 18px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setImp(null)} style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 18px", fontSize: 14, cursor: "pointer" }}>取消</button>
                <button onClick={confirmParse} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>確認匯入</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}
function GlobalAIPanel({ chat, setChat, onClose, cats, setCats, canEdit, confirm, settings, setSettings, worklog, setWorklog }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const importFileRef = useRef(null);
  const [imp, setImp] = useState(null); // 報價單匯入：null | {busy, rows, targetCatId, raw}
  const importCtrlRef = useRef(null); // 解析中可中斷的 AbortController

  // 把上傳檔轉成 base64（圖縮放）
  const fileToAtt = (f) => new Promise((resolve) => {
    const isImg = /^image\//.test(f.type), isPdf = f.type === "application/pdf";
    if (!isImg && !isPdf) return resolve(null);
    if (isPdf) { const r = new FileReader(); r.onload = () => resolve({ kind: "pdf", media_type: "application/pdf", data: String(r.result).split(",")[1] }); r.readAsDataURL(f); return; }
    const img = new Image();
    img.onload = () => { const max = 1568; let { width, height } = img; if (width > max || height > max) { const rr = Math.min(max / width, max / height); width = Math.round(width * rr); height = Math.round(height * rr); } const cv = document.createElement("canvas"); cv.width = width; cv.height = height; cv.getContext("2d").drawImage(img, 0, 0, width, height); resolve({ kind: "image", media_type: "image/jpeg", data: cv.toDataURL("image/jpeg", 0.85).split(",")[1] }); };
    img.src = URL.createObjectURL(f);
  });

  // 報價單結構化解析 → 預覽表（可吃 File 或已處理的附件物件）
  const startImport = async (files) => {
    const arr = Array.from(files || []); if (!arr.length) return;
    const atts = (await Promise.all(arr.map(fileToAtt))).filter(Boolean);
    runImport(atts);
  };
  const runImport = async (atts) => {
    if (!atts || !atts.length) return;
    const ctrl = new AbortController();
    importCtrlRef.current = ctrl;
    setImp({ busy: true, rows: [], targetCatId: cats[0]?.id || "", startedAt: Date.now() });
    try {
      const catNames = cats.map(c => c.name).join("、");
      const sys = `你是估價單解析器。只輸出一個 markdown json 區塊，不要任何其他文字。格式：
\`\`\`json
{"suggest":"最可能對應的工程大項名稱","date":"2026-04-25","items":[{"name":"品項名(不含廠商)","qty":1,"unit":"式","unitPrice":88200,"amount":88200,"taxType":"含稅","vendor":"廠商或人名"}]}
\`\`\`
規則：1) unitPrice 填單據上的數字本身，絕不做任何除法或加減稅。2) **amount 填該列單據上印的「小計/金額」原值**（最重要，這是權威數字，常與 數量×單價 差 1 元，例如 2×2086 印 4171）；單據沒有小計欄才留空。amount 的稅別跟著 taxType（未稅列就填未稅小計、含稅列就填含稅小計）。3) taxType 照單據：含稅/未稅/免稅，沒寫就「未稅」。4) 括號或另一欄的廠商/人名放 vendor，name 只放品項本身。5) 數量沒寫填1、單位沒寫填「式」。6) date 抓單據上的日期(年-月-日)，沒有就留空。7) 現有工程大項：${catNames}。suggest 從中挑最接近的。8) 折扣/折讓/優惠等負金額項：qty 用正數(通常1)、unitPrice 與 amount 用負數；絕不可把 qty 設成負數。`;
      const content = [{ type: "text", text: "解析這份估價單／報價單的所有品項。" }];
      atts.forEach(a => content.push(a.kind === "image" ? { type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } } : { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }));
      const reply = await callAI([{ role: "user", content }], sys, "import", ctrl.signal);
      if (importCtrlRef.current !== ctrl) return; // 已被取消／被新的一次取代
      let obj = null;
      const m = reply.match(/```json\s*([\s\S]*?)```/i);
      try { obj = JSON.parse(m ? m[1] : reply); } catch (_) {}
      const items = (obj?.items || []).map(it => { let qty = Number(it.qty) || 1; let up = Math.round(Number(it.unitPrice) || 0); if (qty < 0 && up < 0) qty = Math.abs(qty); const amt = (it.amount != null && it.amount !== "" && !isNaN(Number(it.amount))) ? Math.round(Number(it.amount)) : Math.round(qty * up); return { pick: true, name: String(it.name || "").trim(), qty, unit: it.unit || "式", unitPrice: up, amount: amt, taxType: ["未稅","含稅","免稅"].includes(it.taxType) ? it.taxType : "未稅", vendor: String(it.vendor || "").trim() }; });
      const sugCat = cats.find(c => c.name === obj?.suggest) || cats.find(c => obj?.suggest && c.name.includes(obj.suggest));
      if (!items.length) { setImp(null); alert(/^（AI/.test(reply) ? reply.replace(/[（）]/g, "") : "沒有解析到品項，請改用對話框上傳，或確認圖片清晰。"); return; }
      const dt = /^\d{4}-\d{2}-\d{2}$/.test(obj?.date || "") ? obj.date : "";
      setImp({ busy: false, rows: items, targetCatId: sugCat?.id || cats[0]?.id || "", date: dt, atts, attachReceipt: true });
    } catch (e) { if (importCtrlRef.current === ctrl) { setImp(null); if (e?.name !== "AbortError") alert("解析失敗，請稍後再試。"); } }
  };
  const cancelImport = () => { try { importCtrlRef.current?.abort(); } catch (_) {} importCtrlRef.current = null; setImp(null); };
  const confirmImport = async () => {
    if (!imp) return;
    const cat = cats.find(c => c.id === imp.targetCatId); if (!cat) { alert("請選擇要匯入的工程大項"); return; }
    const picked = imp.rows.filter(r => r.pick && r.name);
    if (!picked.length) { setImp(null); return; }
    // 把上傳的報價單自動存成這批細項的憑證
    let receipts = [];
    if (imp.attachReceipt && imp.atts?.length) {
      setImp({ ...imp, busy: true });
      for (let k = 0; k < imp.atts.length; k++) {
        const a = imp.atts[k];
        try {
          const bin = atob(a.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          const file = new File([u8], `報價單_${cat.name}_${k + 1}.${a.kind === "pdf" ? "pdf" : "jpg"}`, { type: a.media_type });
          const { url, path } = await uploadPhoto(file);
          receipts.push({ id: "rc-" + Math.random().toString(36).slice(2, 8), url, path, name: `報價單${imp.atts.length > 1 ? "-" + (k + 1) : ""}`, isImage: a.kind !== "pdf" });
        } catch (_) {}
      }
    }
    const newItems = picked.map(r => ({ id: "i-" + cat.id + "-" + Math.random().toString(36).slice(2, 7), name: r.name, qty: r.qty, unit: r.unit, unitPrice: Math.round(r.unitPrice), amount: (r.amount != null && !isNaN(Number(r.amount))) ? Math.round(Number(r.amount)) : Math.round((Number(r.qty) || 0) * (Number(r.unitPrice) || 0)), taxType: r.taxType, payDate: imp.date || "", labor: 0, laborDays: 0, dailyWage: 0, assignee: r.vendor, status: "pending", receipts: receipts.slice(), notes: "", chat: [] }));
    setCats(prev => prev.map(c => c.id === cat.id ? { ...c, items: [...(c.items || []), ...newItems] } : c));
    addMsg("assistant", `✅ 已匯入 ${newItems.length} 筆到「${cat.name}」${receipts.length ? "，並自動掛上報價單憑證" : ""}。`);
    setImp(null);
  };

  const addFiles = (files) => {
    Array.from(files || []).slice(0, 5).forEach(f => {
      const isImg = /^image\//.test(f.type);
      const isPdf = f.type === "application/pdf";
      if (!isImg && !isPdf) return;
      const newId = () => Math.random().toString(36).slice(2);
      if (isPdf) {
        if (f.size > 4 * 1024 * 1024) { alert(`${f.name} 超過 4MB，無法上傳`); return; }
        const reader = new FileReader();
        reader.onload = () => { const d = String(reader.result); setAttachments(prev => [...prev, { id: newId(), kind: "pdf", media_type: "application/pdf", data: d.split(",")[1], name: f.name, preview: d }]); };
        reader.readAsDataURL(f);
        return;
      }
      // 圖片：縮放到最長邊 1568px、JPEG 0.85，避免超過上傳上限
      const img = new Image();
      img.onload = () => {
        const max = 1568;
        let { width, height } = img;
        if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setAttachments(prev => [...prev, { id: newId(), kind: "image", media_type: "image/jpeg", data: dataUrl.split(",")[1], name: f.name, preview: dataUrl }]);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
    });
  };
  const onPaste = (e) => {
    const items = e.clipboardData?.items || [];
    const imgs = [];
    for (const it of items) { if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); } }
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };

  const didScroll = useRef(false);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: didScroll.current ? "smooth" : "auto" }); didScroll.current = true; }, [chat]);

  const addMsg = (role, text) => {
    setChat(prev => {
      const next = [...prev, { role, text, ts: new Date().toLocaleTimeString("zh-TW", {hour:"2-digit",minute:"2-digit"}) }];
      saveGlobalChat(next);
      return next;
    });
  };

  // auto greeting
  useEffect(() => {
    if (chat.length === 0) {
      addMsg("assistant", `你好！我是工程管理助理 🤖\n\n我可以幫你：\n・📋 報價單匯入（點下方「報價單」鈕→解析→預覽→確認，最準）\n・改資料、設定金額、排程\n・查詢某工程明細、預算差異、風險摘要\n\n直接告訴我要做什麼就好。`);
    }
  }, []);

  const send = async () => {
    const t = input.trim();
    if (!t && attachments.length === 0) return;
    setInput("");
    const atts = attachments;
    setAttachments([]);
    addMsg("user", (t || "") + (atts.length ? `${t ? "\n" : ""}📎 已附上 ${atts.length} 個附件` : ""));
    setLoading(true);
    try {
      // 把完整專案結構給 AI，方便精準比對名稱與執行操作
      const structure = cats.map(c => `【${c.name}】(${(c.items||[]).length}筆細項${(c.items||[]).length? "：" + c.items.map(i=>i.name).join("、") : ""})`).join("\n");
      const textBlock = `【目前專案結構（系統即時現況，唯一真實依據）】\n${structure}\n\n⚠️ 以上是現在系統的真實狀態。若與先前對話內容不符（例如你之前說建檔完成、但這裡顯示「細項：無」），一律以這份現況為準——代表使用者已手動清空或刪除，請依使用者最新訊息重新處理，不要說「資料已在系統中」。\n\n使用者訊息：${t || "（請判讀附件內容）"}`;
      const history = chat.slice(-12).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      let content;
      if (atts.length) {
        content = [{ type: "text", text: textBlock }];
        atts.forEach(a => {
          if (a.kind === "image") content.push({ type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } });
          else content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
        });
      } else {
        content = textBlock;
      }
      history.push({ role: "user", content });
      const userRules = (settings?.notes || "").trim() ? `\n\n【使用者的自訂指示（最高優先，務必遵守）】\n${settings.notes.trim()}` : "";
      const reply = await callAI(history, (conf().aiRole || SYSTEM_GLOBAL) + (canEdit ? (AGENT_GUIDE + VISION_GUIDE) : "") + userRules);

      // 顯示去掉 json 指令區塊後的乾淨文字
      const cleanText = reply.replace(/```json[\s\S]*?```/gi, "").trim();
      addMsg("assistant", cleanText || reply);

      // 解析並執行操作（僅管理員）
      const actions = parseActions(reply);
      if (actions.length > 0 && !canEdit) {
        addMsg("assistant", "🔒 需以管理員登入才能執行操作（目前為唯讀）。");
      } else if (actions.length > 0 && canEdit) {
        // 任何「會改資料」的動作都先算出結果、跳確認讓你核對（避免建錯大項／清錯東西）
        const { cats: newCats, settings: newSettings, worklog: newWorklog, results } = applyActions(actions, cats, settings, worklog);
        const WRITE = ["clear_all","clear_items","clear_category_items","add_category","delete_category","set_category_budget","set_category_status","set_gantt","add_item","set_item","delete_item","set_setting","add_log"];
        const willWrite = actions.some(a => WRITE.includes(a.type));
        let ok = true;
        if (willWrite && confirm) ok = await confirm("", { title: "AI 要做這些變更，請先核對：", lines: results, confirmLabel: "✓ 確定執行", danger: false });
        if (ok) {
          if (actions.some(a => ["clear_all","clear_items","clear_category_items","add_category","delete_category","set_category_budget","set_category_status","set_gantt","add_item","set_item","delete_item"].includes(a.type))) setCats(newCats);
          if (newSettings && setSettings && actions.some(a => a.type === "set_setting")) setSettings(newSettings);
          if (setWorklog && actions.some(a => a.type === "add_log")) setWorklog(newWorklog);
          addMsg("assistant", "✅ 已執行：\n" + results.map(r => "・" + r).join("\n"));
        } else {
          addMsg("assistant", "好，已取消，沒有改動任何資料。");
        }
      }
    } catch (_) {
      addMsg("assistant", "⚠️ AI連線失敗，請稍後再試。");
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 500, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: "min(480px,100vw)", height: "min(680px,90vh)", background: "#ffffff", borderRadius: "16px 0 0 16px", display: "flex", flexDirection: "column", border: "1px solid #e5e5e5", borderRight: "none" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e5e5", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: `1px solid ${ACCENT}44` }}>🤖</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#211C15" }}>工程AI顧問</div>
            <div style={{ fontSize: 11, color: "#6F6656" }}>GROUN:D 專案</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#4A4234", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {chat.map((m, i) => (
            <div key={i} style={{ marginBottom: 12, display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: m.role === "user" ? "#3E72A8" : "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                {m.role === "user" ? "👤" : "🤖"}
              </div>
              <div style={{ background: m.role === "user" ? ACCENT : "#f0f0f0", border: "none", borderRadius: 12, padding: "10px 13px", maxWidth: "85%", fontSize: 13, lineHeight: 1.7, color: m.role === "user" ? "#ffffff" : "#211C15", whiteSpace: "pre-wrap" }}>
                {m.text}
                <div style={{ fontSize: 10, color: "#6F6656", marginTop: 4 }}>{m.ts}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🤖</div>
              <div style={{ fontSize: 13, color: ACCENT, padding: "9px 12px" }}>顧問分析中…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        {/* quick prompts */}
        <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, overflowX: "auto" }}>
          {["⚠️ 當前風險摘要","📋 未完成待辦","💰 預算差異分析","📅 建議工序安排"].map(q => (
            <button key={q} onClick={() => { setInput(q); setTimeout(() => document.getElementById("global-input")?.focus(),0); }} style={{ whiteSpace: "nowrap", background: "#f0f0f0", border: "1px solid #e5e5e5", color: "#6F6656", borderRadius: 20, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>{q}</button>
          ))}
        </div>
        <div style={{ padding: "0 14px 14px" }}>
          {attachments.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {attachments.map(a => (
                  <div key={a.id} style={{ position: "relative", width: 54, height: 54, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e5e5", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {a.kind === "image"
                      ? <img src={a.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ fontSize: 10, color: "#6F6656", textAlign: "center" }}>📄<br/>PDF</span>}
                    <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "#211C15", color: "#fff", border: "none", fontSize: 11, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                  </div>
                ))}
              </div>
              {canEdit && <button onClick={() => { const a = attachments; setAttachments([]); runImport(a); }} style={{ width: "100%", background: "#F0FDF4", border: "1px solid #3C8C3C", color: "#3C8C3C", borderRadius: 8, padding: "8px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>📋 用以上附件做「報價單結構化匯入」（解析→預覽→確認）</button>}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={importFileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={e => { startImport(e.target.files); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} title="一般上傳（對話用）" style={{ background: "#f0f0f0", border: "1px solid #e5e5e5", borderRadius: 8, padding: "0 12px", height: 40, cursor: "pointer", fontSize: 16, color: "#4A4234", flexShrink: 0 }}>📎</button>
            {canEdit && <button onClick={() => importFileRef.current?.click()} title="報價單結構化匯入（解析→預覽→確認）" style={{ background: "#F0FDF4", border: "1px solid #3C8C3C", borderRadius: 8, padding: "0 10px", height: 40, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#3C8C3C", flexShrink: 0, whiteSpace: "nowrap" }}>📋 報價單</button>}
            <textarea id="global-input" value={input} onChange={e => setInput(e.target.value)} onPaste={onPaste} rows={2} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder="輸入、貼上截圖，或上傳估價單…（Enter 送出 · Shift+Enter 換行）" style={{ ...inputStyle, flex: 1, margin: 0, resize: "vertical", height: "auto", maxHeight: 160, overflowY: "auto", lineHeight: 1.5, fontFamily: "inherit" }} />
            <button onClick={send} disabled={loading || (!input.trim() && attachments.length === 0)} style={{ background: ACCENT, border: "none", borderRadius: 8, padding: "0 16px", height: 40, color: "#ffffff", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontSize: 14, opacity: loading ? 0.6 : 1, flexShrink: 0 }}>送</button>
          </div>
        </div>
      </div>

      {/* 報價單結構化匯入：預覽表 → 勾選/編輯 → 確認寫入 */}
      {imp && (
        <div onClick={e => e.target === e.currentTarget && !imp.busy && setImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "min(820px,96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>📋 報價單匯入預覽</div>
              <div style={{ flex: 1 }} />
              {!imp.busy && <button onClick={() => setImp(null)} style={{ border: "none", background: "none", fontSize: 20, color: SUB, cursor: "pointer" }}>×</button>}
            </div>
            {imp.busy ? (
              <div style={{ padding: "44px 24px", textAlign: "center" }}>
                <div style={{ color: ACCENT, fontSize: 15, fontWeight: 600 }}>🤖 解析報價單中…<ImportElapsed startedAt={imp.startedAt} /></div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 8, lineHeight: 1.7 }}>一般 10–40 秒；筆數很多的大表格可能要 1 分鐘。<br/>太久或卡住可以按「取消」重來。</div>
                <button onClick={cancelImport} style={{ marginTop: 18, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, borderRadius: 8, padding: "8px 22px", fontSize: 14, cursor: "pointer" }}>取消</button>
              </div>
            ) : (<>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: SUB }}>匯入到大項：</span>
                <select value={imp.targetCatId} onChange={e => setImp({ ...imp, targetCatId: e.target.value })} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 14, background: "#fff", color: TEXT }}>
                  {[...cats].sort((a,b)=>a.order-b.order).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span style={{ fontSize: 13, color: SUB }}>單據日期：</span>
                <input type="date" value={imp.date || ""} onChange={e => setImp({ ...imp, date: e.target.value })} title="會填到各細項的付款日（可改）" style={{ border: `1px solid ${imp.date ? BORDER : "#C2872E"}`, borderRadius: 8, padding: "5px 8px", fontSize: 13, background: "#fff", color: TEXT }} />
                <span style={{ fontSize: 12, color: SUB }}>共 {imp.rows.length} 筆，勾選 {imp.rows.filter(r=>r.pick).length} 筆</span>
                <div style={{ fontSize: 11, color: "#a3a3a3" }}>※ 數字照單據原值、不換算；可直接修改</div>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ color: SUB, fontSize: 11 }}>
                    <th style={{ padding: 6 }}><input type="checkbox" checked={imp.rows.every(r=>r.pick)} onChange={e => setImp({ ...imp, rows: imp.rows.map(r=>({ ...r, pick: e.target.checked })) })} /></th>
                    <th style={{ padding: 6, textAlign: "left" }}>品項</th><th style={{ padding: 6 }}>數量</th><th style={{ padding: 6 }}>單位</th><th style={{ padding: 6, textAlign: "right" }}>單價</th><th style={{ padding: 6 }}>稅別</th><th style={{ padding: 6, textAlign: "left" }}>廠商/負責人</th><th style={{ padding: 6, textAlign: "right" }}>金額</th>
                  </tr></thead>
                  <tbody>
                    {imp.rows.map((r, i) => { const upd = (k,v) => setImp({ ...imp, rows: imp.rows.map((x,j)=>{ if(j!==i) return x; const nx={...x,[k]:v}; if(k==="qty"||k==="unitPrice") nx.amount = Math.round((Number(nx.qty)||0)*(Number(nx.unitPrice)||0)); return nx; }) }); const base = (r.amount != null && r.amount !== "" && !isNaN(Number(r.amount))) ? Math.round(Number(r.amount)) : Math.round((Number(r.qty)||0)*(Number(r.unitPrice)||0)); const amt = (r.taxType === "未稅") ? base + Math.round(base*0.05) : base; const cellI = { width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "4px 6px", fontSize: 13, background: "#fff", color: TEXT }; return (
                      <tr key={i} style={{ borderTop: `1px solid ${BORDER}`, opacity: r.pick ? 1 : 0.45 }}>
                        <td style={{ padding: 4, textAlign: "center" }}><input type="checkbox" checked={r.pick} onChange={e => upd("pick", e.target.checked)} /></td>
                        <td style={{ padding: 4 }}><input value={r.name} onChange={e => upd("name", e.target.value)} style={cellI} /></td>
                        <td style={{ padding: 4, width: 56 }}><input type="number" value={r.qty || ""} onChange={e => upd("qty", Number(e.target.value)||0)} style={{ ...cellI, textAlign: "center" }} /></td>
                        <td style={{ padding: 4, width: 50 }}><input value={r.unit} onChange={e => upd("unit", e.target.value)} style={{ ...cellI, textAlign: "center" }} /></td>
                        <td style={{ padding: 4, width: 90 }}><input type="number" value={r.unitPrice || ""} onChange={e => upd("unitPrice", Number(e.target.value)||0)} style={{ ...cellI, textAlign: "right" }} /></td>
                        <td style={{ padding: 4, width: 72 }}><select value={r.taxType} onChange={e => upd("taxType", e.target.value)} style={cellI}>{["未稅","含稅","免稅"].map(t=><option key={t} value={t}>{t}</option>)}</select></td>
                        <td style={{ padding: 4 }}><input value={r.vendor} onChange={e => upd("vendor", e.target.value)} placeholder="—" style={cellI} /></td>
                        <td style={{ padding: 4, textAlign: "right", fontFamily: "monospace", color: ACCENT, whiteSpace: "nowrap" }}>{fmt(amt)}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "12px 18px", borderTop: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: SUB }}>合計（勾選）：<b style={{ color: ACCENT, fontFamily: "monospace" }}>{fmt(imp.rows.filter(r=>r.pick).reduce((s,r)=>{ const base=(r.amount!=null&&r.amount!==""&&!isNaN(Number(r.amount)))?Math.round(Number(r.amount)):Math.round((Number(r.qty)||0)*(Number(r.unitPrice)||0)); return s + ((r.taxType==="未稅")? base+Math.round(base*0.05) : base); }, 0))}</b></span>
                {imp.atts?.length > 0 && <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}><input type="checkbox" checked={!!imp.attachReceipt} onChange={e => setImp({ ...imp, attachReceipt: e.target.checked })} />把報價單掛成憑證</label>}
                <div style={{ flex: 1 }} />
                <button onClick={() => setImp(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
                <button onClick={confirmImport} style={{ border: "none", background: "#3C8C3C", color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✓ 確認匯入 {imp.rows.filter(r=>r.pick).length} 筆</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SIDE PANEL ─────────────────────────────────────────────────────────────────
function SidePanel({ onClose, children, wide }) {
  const isMobile = useIsMobile();
  const [dragY, setDragY] = useState(0);
  const startY = useRef(null);

  // 手機：從底部彈出的 bottom sheet（拖曳柄可下拉關閉）
  if (isMobile) {
    const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
    const onTouchMove = (e) => { if (startY.current != null) { const dy = e.touches[0].clientY - startY.current; if (dy > 0) setDragY(dy); } };
    const onTouchEnd = () => { if (dragY > 90) onClose(); else setDragY(0); startY.current = null; };
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 400, display: "flex", alignItems: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ width: "100%", maxHeight: "90vh", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", display: "flex", flexDirection: "column", animation: "sheetUp .22s ease", transform: dragY ? `translateY(${dragY}px)` : "none", transition: dragY ? "none" : "transform .2s", paddingBottom: "env(safe-area-inset-bottom)", boxShadow: "0 -8px 30px rgba(0,0,0,0.25)" }}>
          <div onClick={onClose} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} title="下拉或點此關閉" style={{ padding: "11px 0 7px", display: "flex", justifyContent: "center", cursor: "pointer", position: "sticky", top: 0, background: "#fff", zIndex: 10, touchAction: "none", borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
            <div style={{ width: 42, height: 5, borderRadius: 3, background: "#e5e5e5" }} />
          </div>
          <div style={{ padding: "2px 16px 20px", flex: 1 }}>{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 400, display: "flex", justifyContent: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: wide ? "min(600px,100vw)" : "min(440px,100vw)", background: "#ffffff", height: "100vh", overflowY: "auto", borderLeft: "1px solid #e5e5e5", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #e5e5e5", display: "flex", alignItems: "center", justifyContent: "flex-end", position: "sticky", top: 0, background: "#ffffff", zIndex: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#4A4234", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 16, flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// ── NUM INPUT (inline number input with string state) ────────────────────────
function NumInput({ value, onChange, style, placeholder }) {
  const [local, setLocal] = useState(String(value ?? ""));
  const ref = useRef(value);
  useEffect(() => {
    if (value !== ref.current) { ref.current = value; setLocal(String(value ?? "")); }
  }, [value]);
  return (
    <input
      type="text" inputMode="decimal"
      value={local}
      placeholder={placeholder}
      onChange={e => { if (/^-?\d*\.?\d*$/.test(e.target.value) || e.target.value === "") setLocal(e.target.value); }}
      onBlur={() => { const n = parseFloat(local); const v = isNaN(n) ? 0 : n; ref.current = v; setLocal(String(v)); onChange(v); }}
      onFocus={e => e.target.select()}
      style={style}
    />
  );
}

// ── FIELD ──────────────────────────────────────────────────────────────────────
function Field({ label, value, onChange, type, readOnly, accent, prefix, suffix, multiline }) {
  const isNum = type === "number";
  const [local, setLocal] = useState(isNum ? String(value ?? "") : "");
  const committed = useRef(value);
  useEffect(() => {
    if (isNum && value !== committed.current) {
      committed.current = value;
      setLocal(String(value ?? ""));
    }
  }, [value, isNum]);
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 4 }}>{label}</div>
      {readOnly ? (
        <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: accent ? ACCENT : "#211C15", padding: "6px 0" }}>{value}</div>
      ) : multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, height: 72, resize: "vertical" }} />
      ) : isNum ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {prefix && <span style={{ fontSize: 11, color: "#6F6656" }}>{prefix}</span>}
          <input
            type="text"
            inputMode="decimal"
            value={local}
            onChange={e => { if (/^-?\d*\.?\d*$/.test(e.target.value) || e.target.value === "") setLocal(e.target.value); }}
            onBlur={() => { const n = parseFloat(local); const v = isNaN(n) ? 0 : n; committed.current = v; setLocal(String(v)); onChange(v); }}
            onFocus={e => e.target.select()}
            style={{ ...inputStyle, flex: 1 }}
          />
          {suffix && <span style={{ fontSize: 11, color: "#6F6656" }}>{suffix}</span>}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {prefix && <span style={{ fontSize: 11, color: "#6F6656" }}>{prefix}</span>}
          <input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          {suffix && <span style={{ fontSize: 11, color: "#6F6656" }}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  background: "#f0f0f0",
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  color: "#211C15",
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
  outline: "none",
  fontFamily: "'Noto Sans TC', sans-serif",
};
