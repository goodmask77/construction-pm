import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { uploadPhoto, deletePhotoFile, supabase, getSharedMany, getSharedPrefix, hasSession, listSharedIds } from "./supa.js";
import { fmt, baseAmount, taxOf, estAmount, paidOf, unpaidOf, calcEstimated, calcActual, pretaxOf, isTaxable, catRawEst, catPretaxSub, catDiscount, catEstAfter, catSaved, catItemEstAfter, PAY_CATEGORIES, catPaid, catItemPaidMap, catUnpaidAfter, isFundingCat, pettyItemOf, withPettyItems, projectTotals } from "./lib/cost.js";
import { INITIAL_CATEGORIES } from "./lib/seed.js";
import { SPACES, SPACE_CONF, PERM_MATRIX, LEGACY_EDIT, PERM_NONE, DEFAULT_ROLES, ALL_VIEW_KEYS, ALL_EDIT_KEYS, ALL_MONEY_KEYS } from "./lib/spaces.js";
import { buildBotSnapshot } from "./lib/snapshot.js";
import FinanceView from "./finance/Finance.jsx";
import MailManagerView from "./lw/MailManager.jsx";
import SupplyView from "./supply/Supply.jsx";
import TaskCenter from "./tasks/TaskCenter.jsx";
import ShiftView from "./shift/ShiftView.jsx";
import Conclusions from "./conclusions/Conclusions.jsx";
import SequenceView from "./SequenceView.jsx";
import { LayoutDashboard, ClipboardList, CheckSquare, CalendarDays, Pin as PinIcon, FolderOpen, Wallet, Scale, Settings as SettingsIcon, Bot, Megaphone, MessagesSquare, Users as UsersIcon, ScrollText, LifeBuoy, Lock as LockIcon, Gauge, Bell, KeyRound, Mail as MailIcon } from "lucide-react";
import { BRAND, ACCENT, PRIMARY, BG, SURFACE, BORDER, LINE2, TEXT, SUB, ACCENT_SOFT, DARKCHIP, MONO, DISP, SEM, GOLD, HEAD_BG, HEAD_LINE, HEAD_SUB, HEAD_CHIP, SecHead, MOBILE_BP, useIsMobile } from "./lib/theme.jsx";
import { GLOBAL_KEYS, CURRENT_SPACE, K, switchSpace, CURRENT_USER, setCurrentUser, auditLog, conf, CAN_VIEW_MONEY, setCanViewMoney, showMoney, ADMIN_USER, maskAccount, L } from "./lib/runtime.js";
import { KnowledgeBaseView, RosterView, Review360View, FeedbackView, QuestView, PollView, ShopView, CrewRankView } from "./crew/CrewViews.jsx";
import { STATUS_MAP, markCatDone } from "./lib/status.js";
import { DEFAULT_LINE_GROUP, notifyLineEvent } from "./lib/line.js";
import { callAI } from "./lib/ai.js";
import { SidePanel, ImportElapsed, inputStyle } from "./lib/ui.jsx";
import ReceiptUploader from "./lib/ReceiptUploader.jsx";
import { AdvisorSettingsView, ChangelogView, GroupsView, AccountManager, AuditLogView, HistoryView, VaultView, BotUsagePanel, AIUsagePanel } from "./settings/SettingsViews.jsx";
import { OwnerDashboard, OverviewTable, PettyCashView, PhotoLibraryView, IssuesView, CompareView, StatusBadge, COLS } from "./construction/ConstructionViews.jsx";

// 導覽分頁圖示（依 DESIGN_SPEC：lucide 細線取代 emoji）
const NAV_ICONS = { owner: LayoutDashboard, overview: ClipboardList, tasks: CheckSquare, gantt: CalendarDays, conclusions: PinIcon, files: FolderOpen, petty: Wallet, compare: Scale, settings: SettingsIcon };
const SUB_ICONS = { advisor: Bot, changelog: Megaphone, mail: MailIcon, groups: MessagesSquare, accounts: UsersIcon, audit: ScrollText, history: LifeBuoy, vault: LockIcon, usage: Gauge };
// 設計 tokens／SecHead／useIsMobile 已抽到 ./lib/theme.jsx（拆檔第一刀，2026-07-18）
// ADMIN_USER / maskAccount 已抽到 ./lib/runtime.js（拆檔第二刀，2026-07-18）
const API_URL = "https://api.anthropic.com/v1/messages";
// AI顧問全域即時資料：不分空間、所有資料域全接（與 D哥 同級）。
// 【鐵則】每新增資料域：D哥(line-webhook loaders) 與這裡 都要同步接上。
async function loadSpaceAIContext() {
  try {
    const nt = (n) => "NT$" + Math.round(n || 0).toLocaleString();
    const g = async (k) => { try { const v = await window.storage.get(k, true); return v && v.value ? JSON.parse(v.value) : null; } catch (_) { return null; } };
    // 逐筆存集合（2026-07-18）：合併讀——有 marker＝只用逐筆檔；沒有＝舊整包+逐筆檔合併（同 id 逐筆檔優先）
    const recs = async (marker, prefix, legacy) => {
      try {
        const [mk, m, lg] = await Promise.all([g(marker), getSharedPrefix(prefix), g(legacy)]);
        const rl = Object.values(m).map(v => { try { return JSON.parse(v) } catch (_) { return null } }).filter(t => t && t.id);
        if (mk) return rl;
        const byId = new Map((Array.isArray(lg) ? lg : []).filter(t => t && t.id).map(t => [t.id, t]));
        rl.forEach(t => byId.set(t.id, t));
        return [...byId.values()];
      } catch (_) { return await g(legacy); }
    };
    const d0 = new Date(); const mo = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}`;
    const [snapC, snapT, snapK, snapF, tasks, crewRoster, crewOld, pos, posD, bank, ctbc, accounts, ledger, conclusions, mailRules, mailLog, supply] = await Promise.all([
      g("pm_bot_context"), g("sp_team_pm_bot_context"), g("sp_crew_pm_bot_context"), g("sp_finance_pm_bot_context"),
      recs("pm_tasks_v2", "pm_task_", "pm_tasks"), g("sp_crew_kb_roster"), g("sp_crew_kb_360"), g("sp_finance_pm_pos"), g("sp_finance_pm_pos_d_" + mo),
      g("sp_finance_pm_bank"), g("sp_finance_pm_ctbc"), g("sp_finance_pm_fin_accounts"), recs("sp_finance_pm_fin_ledger_v2", "sp_finance_pm_fin_tx_", "sp_finance_pm_fin_ledger"),
      g("pm_conclusions"), g("sp_lw_pm_mail_rules"), g("sp_lw_pm_mail_log"), g("sp_supply_pm_supply"),
    ]);
    const crew = (crewRoster && (crewRoster.people || []).length) ? crewRoster : crewOld; // 名冊已分家：優先讀 kb_roster
    if (Array.isArray(tasks)) tasks.sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));            // 逐筆載入後照手動順序
    if (Array.isArray(ledger)) ledger.sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1)); // 新到舊
    const parts = [];
    // 各空間快照
    const snapLine = (label, sn) => { if (!sn) return null; const p2 = sn.project || {}, t = sn.totals || {}, pr = sn.progress || {}; return `- ${label}：${p2.name || ""}｜進度${pr.pct || 0}%（${pr.doneItems || 0}/${pr.totalItems || 0}）｜預估${nt(t.est)}/已付${nt(t.paid)}${sn.petty ? `｜零用金餘額${nt(sn.petty.balance)}` : ""}${(sn.issues || []).length ? `｜⚠${sn.issues.slice(0, 5).join("、")}` : ""}`; };
    const snaps = [snapLine("工程專案", snapC), snapLine("團隊工作", snapT), snapLine("夥伴中心", snapK), snapLine("財務報表", snapF)].filter(Boolean);
    if (snaps.length) parts.push("【各空間快照】\n" + snaps.join("\n"));
    // 任務
    const tk = Array.isArray(tasks) ? tasks.filter(t => t.status !== "done") : [];
    if (tk.length) parts.push("【未完成任務（" + tk.length + " 件）】\n" + tk.slice(0, 40).map(t => `- ${t.title}${t.due ? "｜期限" + t.due : ""}${t.prio ? "｜" + t.prio : ""}${t.owner ? "｜負責:" + t.owner : ""}${t.waitingFor ? "｜等:" + t.waitingFor : ""}`).join("\n"));
    // 夥伴名冊（不含薪資/身分證等機密——App 內 AI 所有登入者都能問，機密只給 D哥 私訊老闆）
    if (crew?.people?.length) parts.push("【夥伴名冊（" + crew.people.length + " 人）】\n" + crew.people.map(pp => `- ${pp.name}${pp.nick ? "（" + pp.nick + "）" : ""}｜生日${pp.bday || "?"}｜到職${pp.startDate || "?"}${pp.dept ? "｜" + pp.dept : ""}｜${pp.status || "在職"}`).join("\n"));
    // 排班（100%資料鐵則：問誰哪天上什麼班以此為準；與 D哥 loadShiftText 同步接上）
    try {
      const [stf, tpl, idx] = await Promise.all([g("sp_crew_shift_staff"), g("sp_crew_shift_templates"), g("sp_crew_shift_sched_index")]);
      const staff = stf?.staff || [], shifts = tpl?.shifts || [];
      const weeks = (idx?.weeks || []).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, 4);
      if (staff.length || weeks.length) {
        const sName = (id) => { const p = staff.find(x => x.id === id); return p ? (p.nick || p.name) : id; };
        const shOf = (id) => shifts.find(x => x.id === id);
        const lines = ["【排班（最近 " + weeks.length + " 週；班別：" + shifts.map(s => `${s.code}=${s.start}-${s.end}`).join("、") + "）】"];
        const docs = await Promise.all(weeks.map(w => g("sp_crew_shift_sched_" + w.storeId + "_" + w.weekStart)));
        weeks.forEach((w, i) => {
          const doc = docs[i]; if (!doc) return;
          const byDate = {};
          (doc.assignments || []).forEach(a => { const sh = shOf(a.shiftId); (byDate[a.date] = byDate[a.date] || []).push(`${sName(a.staffId)}${sh ? sh.code : ""}`); });
          lines.push(`▍週 ${w.weekStart}（${doc.status || "?"}${doc.isActual ? "實際" : ""}）` + Object.keys(byDate).sort().map(d => ` ${d.slice(5)}:${byDate[d].join("/")}`).join(""));
        });
        parts.push(lines.join("\n"));
      }
    } catch (_) {}
    // 營運日結 + 品項逐日
    if (pos?.entries?.length) {
      parts.push("【營運日結（" + (pos.entries[0].store || "POS") + "）】\n" + pos.entries.slice(-30).map(e => `- ${e.date} 營收${nt(e.revenue)}｜${e.txCount}單｜來客${e.guests || "?"}｜現金${nt(e.cash)}/卡${nt(e.card)}/Uber${nt(e.uber)}｜折扣${nt(e.discount)}`).join("\n"));
      if (posD?.days) {
        const per = {};
        Object.entries(posD.days).forEach(([dkey, day]) => (day.sheets?.["總銷售額 (以類別分類)"] || []).forEach(sec => {
          if (sec.title === "總結") return;
          const date = (day.date || dkey).slice(0, 10); // 新格式 key＝日期::店代碼（雙店），取純日期
          (sec.rows || []).forEach(r => {
            if (!Array.isArray(r) || typeof r[0] !== "string") return;
            const o = per[r[0]] = per[r[0]] || { cat: sec.title, days: {}, qty: 0, amt: 0 };
            o.days[date] = (o.days[date] || 0) + (Number(r[1]) || 0); o.qty += Number(r[1]) || 0; o.amt += Number(r[r.length - 1]) || 0;
          });
        }));
        const arr = Object.entries(per).filter(([, v]) => v.amt > 0).sort((a, b) => b[1].amt - a[1].amt);
        if (arr.length) parts.push("【本月品項逐日銷售（品項｜分類｜總份｜總額｜各日份數）】\n" + arr.slice(0, 60).map(([n, v]) => `- ${n}｜${v.cat}｜${v.qty}份｜${nt(v.amt)}｜` + Object.entries(v.days).sort().map(([dd, q]) => `${Number(dd.slice(8))}日:${q}`).join(" ")).join("\n"));
      }
    }
    // 銀行/內帳
    if (bank?.entries?.length) { const last = [...bank.entries].reverse().find(e => e.balanceAfter > 0); parts.push(`【合作金庫·喬亞帳戶】銀行進出 ${bank.entries.length} 筆${last ? `，最新餘額 ${nt(last.balanceAfter)}（${last.payDate}）` : ""}；最近5筆：` + bank.entries.slice(-5).map(e => `${e.payDate} ${e.content.slice(0, 12)} ${nt(e.amount)}`).join("、")); }
    if (ctbc?.entries?.length) parts.push(`【中信 e-Cash 匯款】共 ${ctbc.entries.length} 筆；最近5筆：` + ctbc.entries.slice(-5).map(e => `${e.effDate} ${e.note || e.type} ${nt(e.amount)}`).join("、"));
    if (Array.isArray(accounts) && accounts.length) parts.push("【內帳帳戶】" + accounts.map(a => a.name).join("、") + (Array.isArray(ledger) ? `；交易明細共 ${ledger.length} 筆，最近5筆：` + ledger.slice(0, 5).map(l => `${l.date} ${l.kind} ${nt(l.amount)} ${l.note || l.category || ""}`.trim()).join("、") : ""));
    // 公開結論
    const con = Array.isArray(conclusions) ? conclusions.filter(c => c && c.status !== "archived") : [];
    if (con.length) parts.push("【公開結論（團隊定案）】\n" + con.slice(0, 40).map(c => `- ${c.topic}：${c.conclusion}`).join("\n"));
    // 信箱管理
    if (mailRules?.rules?.length) parts.push(`【郵件管理（設定內）】規則 ${mailRules.rules.length} 條（每小時自動跑）${mailLog?.items?.[0] ? `；最近一次處理 ${mailLog.items[0].moved} 封` : ""}`);
    // 供應鏈
    if (supply?.products?.length) parts.push(`【供應鏈】產品 ${supply.products.length} 項（${(supply.categories || []).map(c2 => c2.name).join("/")}）・物料/包材 ${(supply.materials || []).length} 項・廠商 ${(supply.vendors || []).length} 家（${(supply.vendors || []).slice(0, 8).map(v => v.name).join("、")}…）`);
    // 資料總目錄（新功能上線自動出現在這裡）
    try {
      // 帶登入權杖讀（RLS 上鎖後仍可用）；逐筆存的一筆一檔太瑣碎，收斂成一個代表名稱
      const skip = /^(pm_hist_|sp_.*_pm_hist_)|backup|pm_bot_(chats|confirm|operators)|pm_vault|pm_task_|sp_finance_pm_fin_tx_/;
      const ids = (await listSharedIds()).filter(id => !skip.test(id));
      if (ids.length) parts.push("【資料總目錄（全部資料域；被問到沒細節的，回「資料有收錄，請張良叫 Claude 接上細節」）】\n" + ids.join("、"));
    } catch (_) {}
    return parts.length ? "\n\n=== 全系統即時資料（回答任何空間的問題一律以此為準，不要說沒有資料） ===\n\n" + parts.join("\n\n") : "";
  } catch (_) { return ""; }
}
const MODEL = "claude-sonnet-4-20250514";


// STATUS_MAP / markCatDone / syncCatStatus 已抽到 ./lib/status.js（拆檔第二刀，2026-07-18）
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

// LINE 推播（LINE_EVENTS / sendLineNotify / notifyLineEvent…）已抽到 ./lib/line.js（拆檔第二刀，2026-07-18）
const calcItemTotal = (it) => calcEstimated(it);

// ── STORAGE HELPERS ───────────────────────────────────────────────────────────
// ── 工作空間（多空間隔離）──────────────────────────────────────────────────
// 預設空間＝construction，沿用原本的 key（零遷移）；其他空間一律加前綴 sp_<id>_
// 全域 key（跨空間共用）：使用者身分、空間設定本身

// conf / showMoney / GLOBAL_KEYS / CURRENT_SPACE / K / switchSpace / CURRENT_USER / auditLog 已抽到 ./lib/runtime.js（拆檔第一刀，2026-07-18）
// L（空間詞彙）已抽到 ./lib/runtime.js（拆檔第二刀，2026-07-18）
// isFundingCat / pettyItemOf / withPettyItems 已抽到 ./lib/cost.js（與 bot 共用）
// COST_COL_IDS 已抽到 ./construction/Overview.jsx（拆檔第二刀，2026-07-18）

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
// AI 用量計價（MODEL_PRICES / USD_TWD / KIND_LABEL）與 recordAIUsage / callAI 已抽到 ./lib/ai.js（拆檔第二刀，2026-07-18）
const SYSTEM_GLOBAL = `你是「宏匯 GROUN:D」餐廳裝修專案的工程管理助理，可直接操作系統（建檔、改資料、上報價單）。

【回應原則｜很重要】
1. 只回應使用者「當下這句話」要的事，直接做、簡短回。不要主動把整個專案總覽、財務概況、各工程清單念一遍——除非使用者明確問「總覽／現況／全部狀況」。
2. 短指令也要聽懂：使用者回「A」「好」「對」「第一個」等，代表同意你「上一則訊息」提的方案/問題，就照那個做，不要重新自我介紹或念總覽。
3. 不確定就用一句話反問，不要長篇大論。
4. 繁體中文、白話、講重點。`;

// buildAdvisorSystem 已抽到 ./lib/ai.js（拆檔第二刀，2026-07-18）
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
  const [locked, setLocked] = useState(false); // RLS 上鎖後：沒登入＝資料全讀不到 → 顯示登入畫面（不再訪客瀏覽）
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
      // 資料庫已上鎖（RLS）且沒登入 → 一筆都讀不到 → 顯示登入畫面，不讓訪客看到空殼/示範資料
      if (supabase && !hasSession() && Object.keys(batch).length === 0) { setLocked(true); }
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

      // 一次性清舊帳：把歷史紀錄裡「同人同動作同內容、3 分鐘內」的連刷合併成一筆（密碼金庫那種幾十連發）
      const dedupLog = [];
      for (const e of alog) {
        const last = dedupLog[dedupLog.length - 1];
        if (last && last.user === e.user && last.action === e.action && last.detail === e.detail && Math.abs(Date.parse(last.ts) - Date.parse(e.ts)) < 180000) continue;
        dedupLog.push(e);
      }
      if (dedupLog.length !== alog.length) saveActivityLog(dedupLog);
      setActivityLog(dedupLog);
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
    // ⚠️ 死鎖防範：不能在 onAuthStateChange 回呼內「直接」呼叫其他 supabase 方法（登入流程持鎖中，
    // 回呼裡再打 supabase 會等鎖 → 互等卡死，手機新登入必踩）。setTimeout(0) 把工作延到鎖釋放之後。
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => { setTimeout(() => applySession(session), 0); });
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
    const user = userOverride || userName || "系統";
    const ts = new Date().toISOString();
    setActivityLog(prev => {
      // 同人＋同動作＋同內容、3 分鐘內連續發生 → 合併成一筆只更新時間（治「每敲一鍵記一條」刷版）
      const last = prev[0];
      if (last && last.user === user && last.action === action && last.detail === detail && Date.parse(ts) - Date.parse(last.ts) < 180000) {
        const next = [{ ...last, ts }, ...prev.slice(1)]; saveActivityLog(next); return next;
      }
      const next = [{ ts, user, action, detail }, ...prev].slice(0, 200); saveActivityLog(next); return next;
    });
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
  // 舊財務單頁相容：以前財務空間只有一頁 finance:finance，攤平後拆成 fin_* 六頁；舊勾選視同六頁全勾
  const legacyFin = (arr, sp, pg) => sp === "finance" && String(pg).startsWith("fin_") && arr.includes("finance:finance");
  const viewOK = (sp, pg) => {
    if (isAdmin) return true;
    if (!_vp.length) return true;                                   // 未設＝全可見
    return _vp.includes(`${sp}:${pg}`) || _vp.includes(pg) || legacyFin(_vp, sp, pg); // 中者＝舊裸key相容
  };
  const editOK = (sp, pg) => {
    if (isAdmin || isManager) return true;
    if (!profile) return false;                                     // 未登入訪客：唯讀
    if (!_ep.length) return true;                                   // 登入者未設＝預設可編輯（全開）
    return _ep.includes(`${sp}:${pg}`) || _ep.includes(LEGACY_EDIT[pg]) || legacyFin(_ep, sp, pg); // 含舊資料相容
  };
  const moneyOK = (sp, pg) => {
    if (isAdmin || isManager) return true;
    // 安全預設：未登入訪客「沒設定」＝全關（金額一律遮蔽）；登入者「沒設定」才是全開。
    // （曾發生 pm_guest_perms 被存成空陣列 → 舊邏輯把空當全開 → 訪客看光財務數字）
    if (!_mp.length) return !!profile;
    return _mp.includes(`${sp}:${pg}`) || legacyFin(_mp, sp, pg);
  };
  const canViewMoney = moneyOK(CURRENT_SPACE, view);
  setCanViewMoney(canViewMoney); // 同步給 showMoney()（依「目前頁面」決定金額欄位/KPI 顯示與否）
  setCurrentUser(userName || ""); // 同步給模組級 auditLog（夥伴中心等元件作用域外用）
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

  // 資料庫已上鎖且未登入 → 全螢幕登入（登入成功直接重新載入，帶著登入身分重抓資料）
  if (locked && !userName) return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "-apple-system,'PingFang TC','Noto Sans TC',system-ui,sans-serif" }}>
      <LoginModal onClose={() => {}} onLogin={async (username, password) => {
        if (!supabase) return { error: "系統未設定登入服務，請聯絡管理員。" };
        const email = username.includes("@") ? username : `${username}@ground.local`;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { error: "帳號或密碼錯誤，請再試一次。" };
        window.location.reload();
        return {};
      }} />
    </div>
  );

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
        {view === "roster" && (
          <RosterView canEdit={canEditData} confirm={confirm} me={account} ReceiptUploader={ReceiptUploader} />
        )}
        {view === "shift" && (
          <ShiftView K={K} canEdit={canEditData} confirm={confirm} userName={userName} isAdmin={isAdmin} onLog={logActivity} />
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
            waitHint={CURRENT_SPACE === "construction" ? "例：等木工、等房東、等設計圖" : "例：等對方回覆、等報價、等主管確認"}
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
        {/* 供應鏈/LWLWLW：進入與編輯全依「帳號權限矩陣」（不另設管理員硬鎖，勾了就看得到） */}
        {["sproducts", "singred", "svendors", "sorder"].includes(view) && CURRENT_SPACE === "supply" && (
          <SupplyView view={view} K={K} canEdit={canEditData} confirm={confirm} showMoney={showMoney()} userName={userName} />
        )}
        {/* 財務報表：第二層直接六分頁（總覽/帳戶/交易明細/科目/對帳/營運報表），view 直傳 FinanceView */}
        {["fin_ov", "fin_acct", "fin_ledger", "fin_coa", "fin_recon", "fin_pos"].includes(view) && CURRENT_SPACE === "finance" && (showMoney() ? (
          <FinanceView view={view} K={K} confirm={confirm} canEdit={canEditData} ReceiptUploader={ReceiptUploader} onLog={logActivity} />
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, margin: "8px 0" }}>🔒 財務報表含金額，你沒有看金額的權限。</div>
        ))}
        {view === "petty" && (showMoney() ? (
          <PettyCashView petty={petty} setPetty={commitPetty} cats={cats} setCats={guardedSetCats} canEdit={canEditData} confirm={confirm} />
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, margin: "8px 0" }}>🔒 零用金含金額，你沒有看金額的權限。</div>
        ))}
        {/* ⚙ 設定：把 AI設定 / 郵件管理 / 群組 / 帳號 / 紀錄 整合成一頁，內含子分頁（第一層全域入口） */}
        {["advisor", "mail", "groups", "accounts", "audit", "vault", "history", "changelog", "usage"].includes(view) && (() => {
          const subs = [["advisor", "AI設定"], ["changelog", "更新"], ...(isAdmin ? [["mail", "郵件管理"], ["groups", "群組"], ["accounts", "帳號"], ["audit", "紀錄"], ["history", "還原點"], ["usage", "用量"], ["vault", "金庫"]] : [])].filter(([k]) => k !== "advisor" || allowedViewPages == null || allowedViewPages.includes("advisor"));
          return (
            <div>
              {/* 桌機版子分頁已升到第二層（TopNav），這裡只給手機用 */}
              {subs.length > 1 && isMobile && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 1100, margin: "0 auto 16px" }}>
                  {subs.map(([k, l]) => { const SubI = SUB_ICONS[k]; return (
                    <button key={k} onClick={() => setView(k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: `1px solid ${view === k ? PRIMARY : BORDER}`, background: view === k ? PRIMARY : "#fff", color: view === k ? "#fff" : TEXT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{SubI && <SubI size={14} strokeWidth={1.75} />}{l}</button>
                  ); })}
                </div>
              )}
              {view === "advisor" && !settings && <div style={{ padding: 30, textAlign: "center", color: SUB, fontSize: 13 }}>設定載入中…（若一直空白代表此帳號無 AI 設定權限）</div>}
              {view === "advisor" && settings && (
                <AdvisorSettingsView settings={settings} setSettings={guardedSetSettings} cats={cats} aiLog={aiLog} setAiLog={l => { if ((aiLog||[]).length && !(l||[]).length) logActivity("編輯", "清空 AI 顧問對話"); setAiLog(l); saveAILog(l); }} journal={journal} events={events} plans={plans} activityLog={activityLog} logActivity={logActivity} userName={userName} />
              )}
              {view === "changelog" && <ChangelogView />}
              {/* 郵件管理（原 LWLWLW 空間）：資料仍存 sp_lw_ 前綴，這裡用固定 KLW 不隨目前空間變動；之後可加其他公司信箱 */}
              {view === "mail" && isAdmin && (
                <MailManagerView K={(k) => GLOBAL_KEYS.has(k) ? k : `sp_lw_${k}`} canEdit={canEditData} confirm={confirm} />
              )}
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

// IssuesView（問題集/待辦）已抽到 ./construction/ConstructionViews.jsx（拆檔第二刀，2026-07-18）
// GroupsView（LINE 群組管理）已抽到 ./settings/SettingsViews.jsx（拆檔第二刀，2026-07-18）
// CompareView（估價單比價）已抽到 ./construction/ConstructionViews.jsx（拆檔第二刀，2026-07-18）
// ── BOTTOM NAV (手機) ───────────────────────────────────────────────────────
function BottomNav({ view, setView, isAdmin, allowedViewPages }) {
  const pageVisible = (v) => v === "settings" || !allowedViewPages || allowedViewPages.includes(v) || v === "owner";
  // 設定已移到第一層（TopNav 空間列尾端的 ⚙），底部導覽不再放設定
  const tabs = (conf().tabs || [["owner", "儀表板", "📊"], ["overview", L("overview"), "📋"], ["tasks", "任務", "✅"], ["gantt", L("gantt"), "📅"], ["conclusions", "結論", "📌"], ["files", "檔案庫", "📁"], ...(conf().showCost ? [["petty", "零用金", "💵"]] : []), ["compare", "比價", "⚖️"]]).filter(([v]) => !conf().hideTabs.includes(v) && pageVisible(v));
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
      <div style={{ background: "#FBF7EE", border: "1px solid #d9cfbd", borderRadius: 14, padding: "20px 20px 16px", maxWidth: 460, width: "100%", maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        {state.title && <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15", marginBottom: 10 }}>{state.title}</div>}
        <div style={{ fontSize: 14, color: "#211C15", lineHeight: 1.7, overflowY: "auto", marginBottom: 18 }}>
          {lines.length > 1
            ? lines.map((ln, i) => <div key={i} style={ln.trim() === "" ? { height: 6 } : { padding: "1px 0", display: "flex", gap: 6, alignItems: "flex-start" }}>{ln.trim() && <><span style={{ color: "#9b9384", flexShrink: 0 }}>·</span><span style={{ wordBreak: "break-word" }}>{ln.replace(/^[・·]\s*/, "")}</span></>}</div>)
            : <div style={{ textAlign: "center" }}>{state.msg}</div>}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => { state.resolve(false); setState(null); }} style={{ padding: "9px 18px", background: "#d9cfbd", border: "1px solid #d9cfbd", borderRadius: 8, color: "#4A4234", cursor: "pointer", fontSize: 14 }}>取消</button>
          <button onClick={() => { state.resolve(true); setState(null); }} style={{ padding: "9px 22px", background: danger ? "#fbeee6" : "#3C8C3C", border: danger ? "1px solid rgba(193,58,34,0.25)" : "none", borderRadius: 8, color: danger ? "#b3261e" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>{label}</button>
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
      style={{ background: SURFACE, border: `1.5px solid ${LINE2}`, borderRadius: 8, padding: "8px 12px", position: "relative", cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(s => !s)}
    >
      {/* gpack 式：大 mono 黑數字在上（視覺錨點）、小灰標籤在下（彩色小圓點示語意） */}
      <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 700, color: TEXT, letterSpacing: -0.5, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{val}</div>
      <div style={{ fontSize: 11, color: SUB, marginTop: 2, display: "flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
        {bar && <span style={{ width: 6, height: 6, borderRadius: "50%", background: bar, flexShrink: 0 }} />}
        {label}
        <span style={{ fontSize: 8, color: LINE2, border: `1px solid ${LINE2}`, borderRadius: "50%", width: 11, height: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }}>?</span>
      </div>
      {show && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, background: PRIMARY, border: "none", borderRadius: 8, padding: "9px 11px", fontSize: 12, color: "#d9cfbd", zIndex: 300, whiteSpace: "normal", width: 240, lineHeight: 1.6, boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
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
  const SETTINGS_GRP = ["settings", "advisor", "mail", "groups", "accounts", "audit", "vault", "history", "changelog", "usage"];
  const tabActive = (v) => v === "settings" ? SETTINGS_GRP.includes(view) : view === v;
  const settingsOn = SETTINGS_GRP.includes(view);
  return (
    <div style={{ background: HEAD_BG, borderBottom: `2px solid ${HEAD_LINE}`, padding: isMobile ? "10px 14px 0" : "16px 22px 0", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 10 : 12, flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0, order: 0 }}>
          <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 600, fontFamily: DISP, color: BRAND, lineHeight: 1, letterSpacing: -0.5 }}>GROUN:D</div>
          {!isMobile && <div style={{ fontSize: 9.5, color: HEAD_SUB, letterSpacing: 2.5, textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>Construction Project Tracker</div>}
        </div>
        {/* 工作空間切換：按鈕列直接點（桌機顯示名稱、手機只顯示圖示省空間） */}
        <div style={{ flexShrink: 0, order: isMobile ? 1 : 0, display: "inline-flex", background: HEAD_CHIP, border: `1.5px solid #c8bca6`, borderRadius: 9, padding: 2, gap: 2, maxWidth: "100%", overflowX: "auto" }}>
          {SPACES.filter(s => spaceVisible(s.id)).map(s => {
            const on = s.id === CURRENT_SPACE && !settingsOn; // 設定開著時空間chip不反白（避免兩顆同時亮）
            return (
              <button key={s.id} onClick={() => !on && (s.id === CURRENT_SPACE ? setView(conf().defaultView || "owner") : switchSpace(s.id))} title={s.name + "（各空間資料獨立）"}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: isMobile ? "5px 7px" : "6px 11px", borderRadius: 7, border: `1px solid ${on ? "#c8bca6" : "transparent"}`, background: on ? "#fff" : "transparent", color: on ? "#1d1a15" : "#5a5247", fontSize: isMobile ? 14 : 12.5, fontWeight: on ? 700 : 500, cursor: on ? "default" : "pointer", whiteSpace: "nowrap" }}>
                <span>{s.icon}</span>{(!isMobile || on) && <span>{s.name}</span>}
              </button>
            );
          })}
          {/* ⚙ 設定移到第一層最後（張良 2026-07-18）：全域設定不屬於任何空間 */}
          {(isAdmin || pageVisible("advisor")) && (
            <button onClick={() => !settingsOn && setView("advisor")} title="設定（AI/郵件/群組/帳號/紀錄）"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: isMobile ? "5px 7px" : "6px 11px", borderRadius: 7, border: `1px solid ${settingsOn ? "#c8bca6" : "transparent"}`, background: settingsOn ? "#fff" : "transparent", color: settingsOn ? "#1d1a15" : "#5a5247", fontSize: isMobile ? 14 : 12.5, fontWeight: settingsOn ? 700 : 500, cursor: settingsOn ? "default" : "pointer", whiteSpace: "nowrap" }}>
              <SettingsIcon size={isMobile ? 15 : 14} strokeWidth={1.75} />{(!isMobile || settingsOn) && <span>設定</span>}
            </button>
          )}
        </div>
        {/* 頂欄 KPI 卡已移除（張良 2026-07-18：數字被截斷看不完整、和儀表板重複沒意義）——完整數字看各空間「儀表板」 */}
        <div style={{ flex: 1, order: isMobile ? 2 : 0 }} />
        {/* actions（手機改 icon-only，保留 title 提示）*/}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, order: isMobile ? 1 : 0, marginLeft: isMobile ? "auto" : 0 }}>
          {saving && <div style={{ fontSize: 11, color: HEAD_SUB }}>同步中…</div>}
          {stalledCount > 0 && (
            <div title={`${stalledCount} 項卡關`} style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, padding: "4px 10px", fontSize: 12, color: "#b3261e", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }} onClick={() => setView && setView("overview")}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: "#b3261e" }} />{stalledCount}
            </div>
          )}
          {userName ? (
            <div onClick={onRoleClick} title={`${userName}（點擊可切換帳號 / 登出）`} style={{ display: "flex", alignItems: "center", gap: 7, background: HEAD_CHIP, border: `1.5px solid #c8bca6`, borderRadius: 8, padding: isMobile ? "6px" : "5px 12px", minHeight: 40, cursor: "pointer" }}>
              <span style={{ width: 26, height: 26, borderRadius: 13, background: ACCENT, color: "#fff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{(userName[0] || "?").toUpperCase()}</span>
              {!isMobile && <span style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>{userName}</span>}
            </div>
          ) : (
            <button onClick={onRoleClick} title="登入以編輯" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: PRIMARY, border: "none", borderRadius: 8, padding: isMobile ? 0 : "8px 16px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", color: "#fff", fontSize: 13, fontWeight: 600 }}>
              {isMobile ? <KeyRound size={17} /> : "登入以編輯"}
            </button>
          )}
          <button onClick={onActivityLog} title="活動記錄" style={{ background: HEAD_CHIP, border: `1.5px solid #c8bca6`, color: TEXT, borderRadius: 8, padding: isMobile ? 0 : "7px 12px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", fontSize: isMobile ? 17 : 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, position: "relative" }}>
            {isMobile ? <Bell size={17} /> : <>活動{activityCount > 0 ? <span style={{ fontSize: 10, background: ACCENT, color: "#fff", fontWeight: 600, borderRadius: 10, padding: "1px 6px" }}>{activityCount}</span> : ""}</>}
            {isMobile && activityCount > 0 && <span style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px", background: ACCENT, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>{activityCount > 99 ? "99+" : activityCount}</span>}
          </button>
          <button onClick={onAI} title="AI 顧問" style={{ background: ACCENT, border: "none", color: "#fff", borderRadius: 8, padding: isMobile ? 0 : "8px 16px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", fontSize: isMobile ? 17 : 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isMobile ? <Bot size={17} /> : "AI 顧問"}
          </button>
        </div>
      </div>
      {/* view tabs — boxed editorial（手機隱藏，改用底部導覽）；設定開著時第二層換成「設定子分頁」（同樣排版樣式） */}
      {!isMobile && !settingsOn && (
      <div style={{ display: "flex", gap: 8, paddingBottom: 12, flexWrap: "wrap" }}>
        {(conf().tabs || [["owner","儀表板"],["overview",L("overview")],["tasks","任務"],["gantt",L("gantt")],["conclusions","結論"],["files","檔案庫"],...(conf().showCost?[["petty","零用金"]]:[]),["compare","比價"]]).filter(([v]) => !conf().hideTabs.includes(v) && pageVisible(v)).map(([v,l]) => { const act = tabActive(v); const NavI = NAV_ICONS[v]; return (
          <button key={v} onClick={() => setView(v === "settings" ? "advisor" : v)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 7, border: `1.5px solid ${act ? PRIMARY : "#c8bca6"}`, cursor: "pointer", fontSize: 14, fontWeight: act ? 700 : 500, background: act ? PRIMARY : HEAD_CHIP, color: act ? "#fff" : TEXT, transition: "all .12s" }}>{NavI && <NavI size={15} strokeWidth={1.75} />}{String(l).replace(/^[^一-鿿A-Za-z0-9]+\s*/, "")}</button>
        ); })}
      </div>
      )}
      {!isMobile && settingsOn && (
      <div style={{ display: "flex", gap: 8, paddingBottom: 12, flexWrap: "wrap" }}>
        {[["advisor", "AI設定"], ["changelog", "更新"], ...(isAdmin ? [["mail", "郵件管理"], ["groups", "群組"], ["accounts", "帳號"], ["audit", "紀錄"], ["history", "還原點"], ["usage", "用量"], ["vault", "金庫"]] : [])].filter(([k]) => k !== "advisor" || allowedViewPages == null || allowedViewPages.includes("advisor")).map(([k, l]) => { const act = view === k; const SubI = SUB_ICONS[k]; return (
          <button key={k} onClick={() => setView(k)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 7, border: `1.5px solid ${act ? PRIMARY : "#c8bca6"}`, cursor: "pointer", fontSize: 14, fontWeight: act ? 700 : 500, background: act ? PRIMARY : HEAD_CHIP, color: act ? "#fff" : TEXT, transition: "all .12s" }}>{SubI && <SubI size={15} strokeWidth={1.75} />}{l}</button>
        ); })}
      </div>
      )}
    </div>
  );
}


// OverviewTable / PaymentsPanel / CustomInput / COLS 已抽到 ./construction/Overview.jsx（拆檔第二刀，2026-07-18）
// ── SIMPLE LOGIN ─────────────────────────────────────────────────────────────
function AccountMenu({ userName, onClose, onChangePassword, onLogout }) {
  const btn = { width:"100%", padding:"12px 0", borderRadius:10, fontSize:15, fontWeight:600, cursor:"pointer", marginBottom:10 };
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:340, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize:18, fontWeight:600, color:"#211C15", marginBottom:4 }}>{userName}</div>
        <div style={{ fontSize:13, color:"#6F6656", marginBottom:18 }}>帳號設定</div>
        <button onClick={onChangePassword} style={{ ...btn, background:"#211C15", color:"#fff", border:"none" }}>修改我的密碼</button>
        <button onClick={onLogout} style={{ ...btn, background:"#fff", color:"#b3261e", border:"1px solid #FCA5A5" }}>登出</button>
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
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fbf8f1", borderRadius:16, padding:28, maxWidth:380, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize:22, fontWeight: 600, color:"#211C15", marginBottom:6 }}>登入</div>
        <div style={{ fontSize:13, color:"#6F6656", marginBottom:20 }}>請輸入你的帳號與密碼登入；忘記密碼請找管理員重設。</div>
        <input
          value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.nativeEvent.isComposing) submit(); }}
          placeholder="帳號"
          autoFocus autoCapitalize="off" autoCorrect="off"
          style={{ width:"100%", padding:"11px 14px", border:"2px solid #d9cfbd", borderRadius:10, fontSize:15, outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", marginBottom:10 }}
        />
        <input
          type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.nativeEvent.isComposing) submit(); }}
          placeholder="密碼"
          style={{ width:"100%", padding:"11px 14px", border:"2px solid #d9cfbd", borderRadius:10, fontSize:15, outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", marginBottom:err?8:14 }}
        />
        {err && <div style={{ fontSize:12.5, color:"#b3261e", marginBottom:12 }}>{err}</div>}
        <button onClick={submit}
          disabled={!name.trim()||!pw||busy}
          style={{ width:"100%", padding:"12px 0", background:(name.trim()&&pw&&!busy)?"#211C15":"#d9cfbd", border:"none", borderRadius:10, color:(name.trim()&&pw&&!busy)?"#fbf8f1":"#9b9384", fontSize:15, fontWeight: 600, cursor:(name.trim()&&pw&&!busy)?"pointer":"not-allowed" }}>
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

// OwnerDashboard 已抽到 ./construction/ConstructionViews.jsx（拆檔第二刀，2026-07-18）
// HistoryView / CHANGELOG / ChangelogView / AuditLogView / VaultView 已抽到 ./settings/SettingsViews.jsx（拆檔第二刀，2026-07-18）
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
      <div style={{ width:"min(420px,100vw)", background:"#fbf8f1", height:"100vh", overflowY:"auto", borderLeft:"1px solid #d9cfbd" }}>
        <div style={{ padding:"14px 16px", borderBottom:"1px solid #d9cfbd", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, background:"#fbf8f1" }}>
          <div style={{ fontSize:15, fontWeight: 600, color:"#211C15" }}>活動記錄</div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#6F6656" }}>×</button>
        </div>
        <div style={{ padding:16 }}>
          {Object.keys(grouped).length === 0 && <div style={{ textAlign:"center", color:"#9b9384", padding:"40px 0" }}>尚無記錄</div>}
          {Object.entries(grouped).map(([date, entries]) => (
            <div key={date} style={{ marginBottom:20 }}>
              <div style={{ fontSize:12, color:"#6F6656", fontWeight: 600, marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ height:1, flex:1, background:"#d9cfbd" }} />
                {date === today ? "今天" : date}
                <div style={{ height:1, flex:1, background:"#d9cfbd" }} />
              </div>
              {entries.map((a, i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:10, alignItems:"flex-start" }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"#e6ddc9", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>
                    {"👤"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, color:"#211C15" }}><span style={{ fontWeight: 600 }}>{maskAccount(a.user)}</span> {a.action}</div>
                    <div style={{ fontSize:11, color:"#6F6656" }}>{a.detail}</div>
                    <div style={{ fontSize:10, color:"#9b9384", marginTop:2 }}>{new Date(a.ts).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</div>
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
    if (ds === targetStr) results.push({ type:"target", label:"🎯 目標完工日", color:"#b3261e" });
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
        <button onClick={()=>setCursor(new Date(year, month-1, 1))} style={{ padding:"6px 10px", background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:8, cursor:"pointer", fontSize:13 }}>←</button>
        <div style={{ fontSize:15, fontWeight: 600, color:"#211C15", minWidth:120, textAlign:"center" }}>{year}年 {month+1}月</div>
        <button onClick={()=>setCursor(new Date(year, month+1, 1))} style={{ padding:"6px 10px", background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:8, cursor:"pointer", fontSize:13 }}>→</button>
        <button onClick={()=>setCursor(new Date())} style={{ padding:"6px 14px", background:ACCENT, border:"none", borderRadius:8, cursor:"pointer", fontSize:12, color:"#211C15", fontWeight: 600 }}>今天</button>
      </div>

      {/* weekday headers */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4 }}>
        {WEEK.map((w,i) => (
          <div key={w} style={{ padding:"6px 0", textAlign:"center", fontSize:11, fontWeight: 600, color: i===0||i===6?"#b3261e":"#6F6656" }}>{w}</div>
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
              style={{ minHeight:96, background:"#fbf8f1", border:`1px solid ${isToday?ACCENT:"#d9cfbd"}`, borderWidth:isToday?2:1, borderRadius:8, padding:6, cursor:"pointer", transition:"background 0.15s", display:"flex", flexDirection:"column", gap:3 }}
              onMouseEnter={e=>e.currentTarget.style.background="#fbf8f1"}
              onMouseLeave={e=>e.currentTarget.style.background="#fbf8f1"}
            >
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:13, fontWeight:isToday?900:600, color: isToday?ACCENT:isWeekend?"#b3261e":"#4A4234" }}>{d.getDate()}</div>
                {evs.length>0 && <div style={{ fontSize:10, background:"#fbeee6", color:"#92400e", borderRadius:10, padding:"0 6px", fontWeight: 600 }}>{evs.length}</div>}
              </div>
              {miles.map((m,mi) => (
                <div key={mi} style={{ fontSize:10, background:m.color+"20", color:m.color, borderRadius:4, padding:"1px 4px", fontWeight: 600 }}>{m.label}</div>
              ))}
              {evs.slice(0,3).map((e,ei) => (
                <div key={ei} onClick={ev=>{ev.stopPropagation(); setEditingEvent(e); setShowEventModal(true);}}
                  style={{ fontSize:10, background:"#fbeee6", color:"#1e40af", borderRadius:4, padding:"1px 5px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", border:"1px solid #bfdbfe" }}>
                  {e.title || "(未命名)"}
                </div>
              ))}
              {evs.length>3 && <div style={{ fontSize:9, color:"#9b9384" }}>+{evs.length-3} 更多</div>}
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
      <div style={{ background:"#fbf8f1", borderRadius:14, padding:22, maxWidth:420, width:"100%", boxShadow:"0 10px 40px rgba(0,0,0,0.15)" }}>
        <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>📅 {event.title?"編輯":"新增"}事件</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>日期</div>
            <input type="date" value={event.date||""} onChange={e=>setEvent({...event, date:e.target.value})}
              style={{ width:"100%", padding:"8px 10px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>事件標題 *</div>
            <input value={event.title||""} onChange={e=>setEvent({...event, title:e.target.value})}
              placeholder="例如：磁磚到貨、業主驗收、停工..."
              style={{ width:"100%", padding:"9px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} autoFocus />
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯工程（選填）</div>
            <select value={event.catId||""} onChange={e=>{
              const cat = cats.find(c=>c.id===e.target.value);
              setEvent({...event, catId:e.target.value, catName:cat?.name||""});
            }}
              style={{ width:"100%", padding:"8px 10px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#fbf8f1" }}>
              <option value="">— 未關聯 —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>備註</div>
            <textarea value={event.note||""} onChange={e=>setEvent({...event, note:e.target.value})}
              placeholder="備註..."
              style={{ width:"100%", padding:"8px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:70, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:18 }}>
          {event.createdBy && <button onClick={()=>onDelete(event.id)} style={{ padding:"10px 14px", background:"#fbeee6", border:"1px solid #fca5a5", borderRadius:8, color:"#b3261e", fontSize:13, cursor:"pointer", fontWeight:600 }}>刪除</button>}
          <div style={{ flex:1 }} />
          <button onClick={onClose} style={{ padding:"10px 16px", background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
          <button onClick={()=>event.title&&onSave(event)} disabled={!event.title} style={{ padding:"10px 20px", background:event.title?"#211C15":"#d9cfbd", border:"none", borderRadius:8, color:"#fbf8f1", fontSize:13, fontWeight: 600, cursor:event.title?"pointer":"not-allowed" }}>儲存</button>
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
          style={{ padding:"7px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", width:180, fontFamily:"'Noto Sans TC',sans-serif" }} />
        <button onClick={()=>setShowNew(true)} style={{ padding:"8px 16px", background:"#211C15", border:"none", borderRadius:8, color:"#fbf8f1", fontSize:13, fontWeight: 600, cursor:"pointer" }}>+ 新增日誌</button>
      </div>

      {filtered.length === 0 && (
        <div style={{ background:"#fbf8f1", border:"1px dashed #d9cfbd", borderRadius:14, padding:"60px 20px", textAlign:"center", color:"#9b9384" }}>
          <div style={{ fontSize:40, marginBottom:10 }}>📓</div>
          <div style={{ fontSize:14 }}>尚無日誌記錄，點擊右上「+ 新增日誌」開始記錄</div>
        </div>
      )}

      {filtered.map(j => (
        <div key={j.id} style={{ background:"#fbf8f1", border:"1px solid #d9cfbd", borderRadius:14, padding:18, marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:8 }}>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <div style={{ fontSize:15, fontWeight: 600, color:"#211C15" }}>{j.title||"(無標題)"}</div>
                {j.catName && <span style={{ fontSize:10, background:"#fbeee6", color:"#92400e", borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>{j.catName}</span>}
              </div>
              <div style={{ fontSize:11, color:"#9b9384", display:"flex", gap:10, flexWrap:"wrap" }}>
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
            <div style={{ marginTop:10, padding:"8px 12px", background:"#fbeee6", border:"1px solid #fca5a5", borderRadius:8, fontSize:12, color:"#991b1b" }}>
              <strong>⚠️ 問題/待處理：</strong> {j.issues}
            </div>
          )}
        </div>
      ))}

      {/* New entry modal */}
      {showNew && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&setShowNew(false)}>
          <div style={{ background:"#fbf8f1", borderRadius:14, padding:22, maxWidth:520, width:"100%", maxHeight:"88vh", overflow:"auto" }}>
            <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>📓 新增工作日誌</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>日期</div>
                <input type="date" value={draft.date} onChange={e=>setDraft({...draft, date:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>天氣</div>
                <input value={draft.weather} onChange={e=>setDraft({...draft, weather:e.target.value})} placeholder="晴 / 雨 / 陰"
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>標題</div>
              <input value={draft.title} onChange={e=>setDraft({...draft, title:e.target.value})} placeholder={CURRENT_SPACE === "construction" ? "例如：廚房地坪灌漿完成..." : "例如：週會決議、規則定案…"}
                style={{ width:"100%", padding:"9px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} autoFocus />
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯{L("cat")}</div>
              <select value={draft.catId} onChange={e=>setDraft({...draft, catId:e.target.value})}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#fbf8f1" }}>
                <option value="">— 未指定 —</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>現場人員</div>
              <input value={draft.workers} onChange={e=>setDraft({...draft, workers:e.target.value})} placeholder="例如：水電2人、泥作3人"
                style={{ width:"100%", padding:"8px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>內容</div>
              <textarea value={draft.content} onChange={e=>setDraft({...draft, content:e.target.value})}
                placeholder="今日完成什麼？遇到什麼？&#10;可記錄：進度、用料、人員、照片說明、重要決策..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:120, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif", lineHeight:1.7 }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>⚠️ 問題/待處理</div>
              <textarea value={draft.issues} onChange={e=>setDraft({...draft, issues:e.target.value})}
                placeholder="需要上級決策、材料短缺、工序卡關..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:60, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }} />
              <button onClick={()=>setShowNew(false)} style={{ padding:"10px 16px", background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
              <button onClick={save} style={{ padding:"10px 22px", background:"#211C15", border:"none", borderRadius:8, color:"#fbf8f1", fontSize:13, fontWeight: 600, cursor:"pointer" }}>儲存日誌</button>
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

  const priorityColor = { "高":"#b3261e", "中":"#f59e0b", "低":"#6F6656" };

  return (
    <div style={{ paddingTop:16, maxWidth:900, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ fontSize:20, fontWeight: 600, color:"#211C15" }}>🗓 排程規劃</div>
        <div style={{ fontSize:12, color:"#6F6656" }}>待處理 {plans.filter(p=>!p.done).length} · 已完成 {plans.filter(p=>p.done).length}</div>
        <div style={{ flex:1 }} />
        <button onClick={()=>setShowNew(true)} style={{ padding:"8px 16px", background:"#211C15", border:"none", borderRadius:8, color:"#fbf8f1", fontSize:13, fontWeight: 600, cursor:"pointer" }}>+ 新增任務</button>
      </div>

      {/* summary */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        {overdueCount>0 && <div style={{ background:"#fbeee6", border:"1px solid #fca5a5", borderRadius:20, padding:"5px 14px", fontSize:12, color:"#b3261e", fontWeight: 600 }}>⏰ 逾期 {overdueCount} 項</div>}
        {highCount>0 && <div style={{ background:"#fef3c7", border:"1px solid #fcd34d", borderRadius:20, padding:"5px 14px", fontSize:12, color:"#92400e", fontWeight: 600 }}>🔥 高優先 {highCount} 項</div>}
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:4 }}>
          {[["pending","待處理"],["done","已完成"],["all","全部"]].map(([k,l]) => (
            <button key={k} onClick={()=>setFilter(k)} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, border:"1px solid #d9cfbd", cursor:"pointer", background:filter===k?ACCENT:"#ece4d6", color:filter===k?"#fbf8f1":"#6F6656", fontWeight:filter===k?700:400 }}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{ background:"#fbf8f1", border:"1px dashed #d9cfbd", borderRadius:14, padding:"50px 20px", textAlign:"center", color:"#9b9384" }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🗓</div>
          <div style={{ fontSize:14 }}>{filter==="done"?"尚無已完成任務":filter==="pending"?"沒有待處理任務，太棒了！":"尚無任務"}</div>
        </div>
      )}

      {filtered.map(p => {
        const isOverdue = !p.done && p.dueDate && p.dueDate < todayStr;
        return (
          <div key={p.id} style={{ background:"#fbf8f1", border:`1px solid ${isOverdue?"#fca5a5":"#d9cfbd"}`, borderLeft:`4px solid ${p.done?"#3C8C3C":priorityColor[p.priority]||"#6F6656"}`, borderRadius:12, padding:"12px 16px", marginBottom:10, display:"flex", alignItems:"flex-start", gap:12, opacity:p.done?0.6:1 }}>
            <input type="checkbox" checked={!!p.done} onChange={()=>toggleDone(p.id)}
              style={{ width:18, height:18, marginTop:3, cursor:"pointer", accentColor:"#3C8C3C", flexShrink:0 }} />
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                <div style={{ fontSize:14, fontWeight: 600, color:p.done?"#9b9384":"#211C15", textDecoration:p.done?"line-through":"none" }}>{p.title}</div>
                <span style={{ fontSize:10, background:priorityColor[p.priority]+"22", color:priorityColor[p.priority], borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>{p.priority}</span>
                {p.catName && <span style={{ fontSize:10, background:"#fbeee6", color:"#1e40af", borderRadius:10, padding:"1px 8px" }}>{p.catName}</span>}
                {isOverdue && <span style={{ fontSize:10, background:"#fbeee6", color:"#b3261e", borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>⏰ 逾期</span>}
              </div>
              {p.description && <div style={{ fontSize:12, color:"#6F6656", lineHeight:1.7, marginBottom:4 }}>{p.description}</div>}
              <div style={{ fontSize:11, color:"#9b9384", display:"flex", gap:12, flexWrap:"wrap" }}>
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
          <div style={{ background:"#fbf8f1", borderRadius:14, padding:22, maxWidth:460, width:"100%", maxHeight:"88vh", overflow:"auto" }}>
            <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>🗓 新增排程任務</div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>任務標題 *</div>
              <input value={draft.title} onChange={e=>setDraft({...draft, title:e.target.value})} placeholder="例如：下週前確認磁磚廠商..." autoFocus
                style={{ width:"100%", padding:"9px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>優先度</div>
                <select value={draft.priority} onChange={e=>setDraft({...draft, priority:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#fbf8f1" }}>
                  <option>高</option><option>中</option><option>低</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>截止日</div>
                <input type="date" value={draft.dueDate} onChange={e=>setDraft({...draft, dueDate:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯{L("cat")}</div>
              <select value={draft.catId} onChange={e=>setDraft({...draft, catId:e.target.value})}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#fbf8f1" }}>
                <option value="">— 未指定 —</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>負責人</div>
              <input value={draft.assignee} onChange={e=>setDraft({...draft, assignee:e.target.value})} placeholder="誰要做？"
                style={{ width:"100%", padding:"8px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>描述</div>
              <textarea value={draft.description} onChange={e=>setDraft({...draft, description:e.target.value})}
                placeholder="詳細說明..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:70, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }} />
              <button onClick={()=>setShowNew(false)} style={{ padding:"10px 16px", background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
              <button onClick={save} style={{ padding:"10px 22px", background:"#211C15", border:"none", borderRadius:8, color:"#fbf8f1", fontSize:13, fontWeight: 600, cursor:"pointer" }}>建立任務</button>
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
              style={{ background: isDragOver ? "#e8edf8" : "#fbf8f1", border: `1px solid ${isDragOver ? ACCENT : "#d9cfbd"}`, borderRadius: 12, padding: 14, cursor: "grab", transition: "border-color 0.2s, transform 0.15s", transform: dragging === cat.id ? "scale(0.97) rotate(-1deg)" : "none", userSelect: "none", position: "relative" }}
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
                  <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }} onClick={e => { e.stopPropagation(); e.preventDefault(); confirm(`確定刪除「${cat.name}」？\n此操作無法復原。`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== cat.id)); }); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#fbeee6", border: "1px solid rgba(193,58,34,0.25)", color: "#b3261e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer", lineHeight: 1, flexShrink: 0, padding: 0 }} title="刪除此工程">×</button>
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
          style={{ background: "#fbf8f1", border: "1px dashed rgba(193,58,34,0.3)", borderRadius: 12, padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 120, gap: 8, transition: "border-color 0.2s" }}
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

// StatusBadge 已抽到 ./construction/Overview.jsx（拆檔第二刀，2026-07-18）
// LineNotifySettings / BotUsagePanel / LineQuotaBlock / AIUsagePanel / AdvisorSettingsView 已抽到 ./settings/SettingsViews.jsx（拆檔第二刀，2026-07-18）
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
    <div style={{ background:"#f8f0dc", border:"1px solid #fcd34d", borderRadius:12, padding:14, marginBottom:14 }}>
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
              <div key={i} style={{ fontSize: 10, color: "#6F6656", textAlign: "center", borderLeft: "1px solid #d9cfbd33" }}>W{i+1}</div>
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
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${weeks},1fr)`, height: 28, background: "#e6ddc9", borderRadius: 4, overflow: "hidden", cursor: "pointer" }}
                onClick={() => {
                  const s = parseInt(prompt(`「${cat.name}」開始週 (1-${weeks}):`, start+1)) - 1;
                  const d = parseInt(prompt("持續週數:", dur));
                  if (!isNaN(s) && !isNaN(d)) setCats(prev => prev.map(c => c.id === cat.id ? {...c, ganttStart: Math.max(0,s), ganttDur: Math.max(1,d)} : c));
                }}
              >
                {Array.from({length: weeks}, (_,i) => {
                  const inBar = i >= start && i < start + dur;
                  return (
                    <div key={i} style={{ borderLeft: "1px solid #d9cfbd33", height: "100%", background: inBar ? st.color + "cc" : "transparent", position: "relative" }}>
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
        <div style={{ background: "#fbeee6", border: "1px solid rgba(193,58,34,0.3)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>預估（含稅）</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: ACCENT }}>{fmt(e)}</div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid rgba(60,140,60,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>已付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#3C8C3C" }}>{fmt(p)}</div>
        </div>
        <div style={{ background: "#FFFBEB", border: "1px solid rgba(194,135,46,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>未付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: u < 0 ? "#b3261e" : "#C2872E" }}>{u < 0 ? `溢付${fmt(-u)}` : fmt(u)}</div>
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
        <div key={item.id} onClick={() => onSelectItem(item)} style={{ background: "#e6ddc9", borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer", border: "1px solid #d9cfbd", transition: "border-color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
          onMouseLeave={e => e.currentTarget.style.borderColor="#d9cfbd"}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 13, color: item.notes?.includes("⚠️") ? "#C2872E" : "#211C15", flex: 1 }}>{item.name}</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: ACCENT }}>{fmt(calcItemTotal(item))}</div>
            <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); confirm(`刪除「${item.name}」？`).then(ok => { if (ok) setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); }); }} style={{ width: 20, height: 20, borderRadius: "50%", background: "#fbeee6", border: "1px solid rgba(193,58,34,0.25)", color: "#b3261e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, cursor: "pointer", flexShrink: 0, padding: 0 }}>×</button>
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
        <button onClick={() => confirm(`確定刪除細項「${currentItem.name}」？`).then(ok => { if (ok) { setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); onClose(); } })} style={{ marginTop: 6, background: "#fbeee6", border: "1px solid rgba(193,58,34,0.25)", borderRadius: 7, color: "#b3261e", fontSize: 12, padding: "5px 12px", cursor: "pointer", alignSelf: "flex-start" }}>🗑 刪除此細項</button>
      </div>
      {/* ── 預估 vs 實際 兩欄 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 14, border: "1px solid #d9cfbd", borderRadius: 10, overflow: "hidden" }}>
        {/* headers */}
        <div style={{ background: "#fbeee6", borderBottom: "1px solid #d9cfbd", borderRight: "1px solid #d9cfbd", padding: "7px 12px", fontSize: 11, fontWeight: 600, color: ACCENT, letterSpacing: 1 }}>📋 預估（估價單）</div>
        <div style={{ background: "#fbeee6", borderBottom: "1px solid #d9cfbd", padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#3E72A8", letterSpacing: 1 }}>🔨 實際（施工記錄）</div>
        {/* qty */}
        <div style={{ borderRight: "1px solid #d9cfbd", borderBottom: "1px solid #d9cfbd55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>數量</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <NumInput value={currentItem.estQty ?? currentItem.qty ?? 0} onChange={v => updateItem("estQty", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
            <input value={currentItem.unit} onChange={e => updateItem("unit", e.target.value)} style={{ ...inputStyle, width: 56, fontSize: 12 }} />
          </div>
        </div>
        <div style={{ borderBottom: "1px solid #d9cfbd55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>數量</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <NumInput value={currentItem.actQty ?? 0} onChange={v => updateItem("actQty", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
            <span style={{ fontSize: 11, color: "#6F6656", whiteSpace: "nowrap" }}>{currentItem.unit}</span>
          </div>
        </div>
        {/* unit price */}
        <div style={{ borderRight: "1px solid #d9cfbd", borderBottom: "1px solid #d9cfbd55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>單價</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.estUnitPrice ?? currentItem.unitPrice ?? 0} onChange={v => updateItem("estUnitPrice", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        <div style={{ borderBottom: "1px solid #d9cfbd55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>單價</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.actUnitPrice ?? 0} onChange={v => updateItem("actUnitPrice", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        {/* labor */}
        <div style={{ borderRight: "1px solid #d9cfbd", borderBottom: "1px solid #d9cfbd55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>人工費（整筆估）</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.estLabor ?? currentItem.labor ?? 0} onChange={v => updateItem("estLabor", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        <div style={{ borderBottom: "1px solid #d9cfbd55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>人數 / 日薪 / 天數</div>
          <div style={{ display: "flex", gap: 4 }}>
            <NumInput value={currentItem.actWorkers ?? 0} onChange={v => updateItem("actWorkers", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="人" />
            <NumInput value={currentItem.actDailyWage ?? 0} onChange={v => updateItem("actDailyWage", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="日薪" />
            <NumInput value={currentItem.actLaborDays ?? 0} onChange={v => updateItem("actLaborDays", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="天" />
          </div>
        </div>
        {/* totals */}
        <div style={{ borderRight: "1px solid #d9cfbd", padding: "8px 12px", background: "#ece4d6" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>預估複價</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 600, color: ACCENT }}>{fmt(calcEstimated(currentItem))}</div>
        </div>
        <div style={{ padding: "8px 12px", background: "#f5faff" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>實際複價</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 600, color: calcActual(currentItem) > calcEstimated(currentItem) ? "#b3261e" : "#3E72A8" }}>
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
                  ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #d9cfbd", cursor: "zoom-in" }} />
                  : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 80, height: 80, borderRadius: 8, border: "1px solid #d9cfbd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, textDecoration: "none", background: "#fbeee6" }}>📄</a>}
                <button onClick={() => removeReceipt(ri)} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: "50%", background: "#b3261e", color: "#fff", border: "none", fontSize: 11, lineHeight: 1, cursor: "pointer" }}>×</button>
              </div>
            ) : (
              <div key={ri} title="點擊刪除" onClick={() => removeReceipt(ri)} style={{ background: "#e6ddc9", borderRadius: 6, padding: "6px 10px", fontSize: 12, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <span>📎 {r.name}</span>{r.amount ? <span style={{ color: ACCENT, fontFamily: "monospace" }}>{fmt(r.amount)}</span> : null}
              </div>
            )
          ))}
          <label style={{ width: 80, height: 80, borderRadius: 8, border: "1px dashed #d9cfbd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: "#9b9384", fontSize: 12 }}>
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
              <img src={p.data} alt={p.name} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #d9cfbd" }} />
              <button onClick={() => updateItem("photos", currentItem.photos.filter((_,i2)=>i2!==pi))}
                style={{ position:"absolute", top:-6, right:-6, width:20, height:20, borderRadius:"50%", background:"#b3261e", border:"none", color:"#fff", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>×</button>
            </div>
          ))}
          <label style={{ width:80, height:80, border:"2px dashed #d9cfbd", borderRadius:8, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"#9b9384", fontSize:11, gap:4 }}>
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
      <div style={{ background: "#f4f5f7", borderRadius: 8, border: "1px solid #d9cfbd", maxHeight: 280, overflowY: "auto", padding: 10, marginBottom: 8 }}>
        {(!item.chat || item.chat.length === 0) && (
          <div style={{ fontSize: 12, color: "#d9cfbd", textAlign: "center", padding: "20px 0" }}>輸入問題詢問AI工程顧問，或記錄討論內容</div>
        )}
        {item.chat?.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.role === "user" ? "#3E72A8" : "#fbeee6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, border: m.role !== "user" ? `1px solid ${ACCENT}44` : "none" }}>
              {m.role === "user" ? "👤" : "🤖"}
            </div>
            <div style={{ background: m.role === "user" ? ACCENT : "#e6ddc9", border: "none", borderRadius: 10, padding: "8px 11px", maxWidth: "85%", fontSize: 12.5, lineHeight: 1.6, color: m.role === "user" ? "#fbf8f1" : "#211C15", whiteSpace: "pre-wrap" }}>
              {m.text}
              <div style={{ fontSize: 10, color: "#6F6656", marginTop: 3 }}>{m.ts}</div>
            </div>
          </div>
        ))}
        {aiLoading && (
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#fbeee6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, border: `1px solid ${ACCENT}44` }}>🤖</div>
            <div style={{ fontSize: 12, color: ACCENT, padding: "8px 10px" }}>AI顧問分析中…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder="詢問AI顧問或記錄討論…" style={{ ...inputStyle, flex: 1, margin: 0 }} />
        <button onClick={send} disabled={aiLoading || !input.trim()} style={{ background: ACCENT, border: "none", borderRadius: 8, padding: "0 14px", color: "#fbf8f1", fontWeight: 600, cursor: aiLoading ? "not-allowed" : "pointer", fontSize: 13, opacity: aiLoading ? 0.6 : 1 }}>送出</button>
      </div>
    </div>
  );
}

// ── GLOBAL AI PANEL ────────────────────────────────────────────────────────────
// ── 工作日誌 ─────────────────────────────────────────────────────────────────
const wlMiniBtn = { background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer", color:"#4A4234" };
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
    <div key={p.id} style={{ position:"relative", width:60, height:60, borderRadius:8, overflow:"hidden", border:"1px solid #d9cfbd", background:"#ece4d6", display:"flex", alignItems:"center", justifyContent:"center" }}>
      {p.isImage!==false ? <img src={p.url} alt="" onClick={()=>setLightbox(p)} style={{ width:"100%", height:"100%", objectFit:"cover", cursor:"zoom-in" }} />
        : <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize:20, textDecoration:"none" }}>📄</a>}
      {onRemove && <button onClick={()=>onRemove(p.id)} style={{ position:"absolute", top:-6, right:-6, width:18, height:18, borderRadius:"50%", background:"#211C15", color:"#fff", border:"none", fontSize:11, cursor:"pointer", lineHeight:1 }}>×</button>}
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15", marginBottom: 12 }}>📓 工作日誌</div>
      {canEdit ? (
        <div style={{ background:"#fff", border:"1px solid #d9cfbd", borderRadius:12, padding:16, marginBottom:16 }}>
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
            <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{ background:"#e6ddc9", border:"1px solid #d9cfbd", borderRadius:8, padding:"7px 12px", cursor:"pointer", fontSize:13, color:"#4A4234" }}>{uploading?"上傳中…":"📷 附現場照片"}</button>
            <span style={{ fontSize:11, color:"#9b9384" }}>可貼上截圖</span>
            <div style={{ flex:1 }} />
            <button onClick={add} disabled={!draft.trim() && draftPhotos.length===0} style={{ background: (draft.trim()||draftPhotos.length)?ACCENT:"#d9cfbd", color: (draft.trim()||draftPhotos.length)?"#fbf8f1":"#9b9384", border:"none", borderRadius:8, padding:"8px 18px", fontWeight: 600, cursor: (draft.trim()||draftPhotos.length)?"pointer":"not-allowed" }}>新增日誌</button>
          </div>
        </div>
      ) : (
        <div style={{ background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#6F6656" }}>🔒 唯讀模式：登入後可新增 / 編輯工作日誌。</div>
      )}
      {sorted.length === 0 ? (
        <div style={{ textAlign:"center", color:"#9b9384", padding:40 }}>尚無工作日誌</div>
      ) : sorted.map(w => (
        <div key={w.id} style={{ background:"#fff", border:"1px solid #d9cfbd", borderRadius:12, padding:14, marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <span style={{ fontSize:12, fontWeight: 600, color:ACCENT, fontFamily:"monospace" }}>{w.date}</span>
            <span style={{ fontSize:11, color:"#9b9384" }}>by {w.author||"—"}</span>
            <div style={{ flex:1 }} />
            {canEdit && editId !== w.id && (<>
              <button onClick={()=>{ setEditId(w.id); setEditText(w.content); }} style={wlMiniBtn}>編輯</button>
              <button onClick={()=>del(w.id)} style={{ ...wlMiniBtn, color:"#b3261e" }}>刪除</button>
            </>)}
          </div>
          {editId === w.id ? (
            <div>
              <textarea value={editText} onChange={e=>setEditText(e.target.value)} style={{ ...inputStyle, width:"100%", minHeight:70, boxSizing:"border-box" }} />
              <div style={{ textAlign:"right", marginTop:6 }}>
                <button onClick={()=>setEditId(null)} style={{ ...wlMiniBtn, marginRight:6 }}>取消</button>
                <button onClick={()=>saveEdit(w.id)} style={{ background:ACCENT, color:"#fbf8f1", border:"none", borderRadius:6, padding:"5px 14px", fontWeight: 600, cursor:"pointer" }}>儲存</button>
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
                    <button onClick={()=>document.getElementById("wlf-"+w.id)?.click()} style={{ width:60, height:60, borderRadius:8, border:"1px dashed #d9cfbd", background:"#fbf8f1", color:"#9b9384", fontSize:20, cursor:"pointer" }}>＋</button>
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

// PhotoLibraryView（檔案庫/相簿）已抽到 ./construction/ConstructionViews.jsx（拆檔第二刀，2026-07-18）
// AccountManager（帳號管理）已抽到 ./settings/SettingsViews.jsx（拆檔第二刀，2026-07-18）
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

// ImportElapsed 已抽到 ./lib/ui.jsx（拆檔第二刀，2026-07-18）
// DateField 已抽到 ./construction/ConstructionViews.jsx（拆檔第二刀，2026-07-18）
// ReceiptUploader 已抽到 ./lib/ReceiptUploader.jsx（拆檔第二刀，2026-07-18）
// PettyCashView（零用金帳本）已抽到 ./construction/ConstructionViews.jsx（拆檔第二刀，2026-07-18）
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
      const spaceCtx = await loadSpaceAIContext();
      const reply = await callAI(history, (conf().aiRole || SYSTEM_GLOBAL) + spaceCtx + (canEdit ? (AGENT_GUIDE + VISION_GUIDE) : "") + userRules);

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
      <div style={{ width: "min(480px,100vw)", height: "min(680px,90vh)", background: "#fbf8f1", borderRadius: "16px 0 0 16px", display: "flex", flexDirection: "column", border: "1px solid #d9cfbd", borderRight: "none" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #d9cfbd", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fbeee6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: `1px solid ${ACCENT}44` }}>🤖</div>
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
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: m.role === "user" ? "#3E72A8" : "#fbeee6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                {m.role === "user" ? "👤" : "🤖"}
              </div>
              <div style={{ background: m.role === "user" ? ACCENT : "#e6ddc9", border: "none", borderRadius: 12, padding: "10px 13px", maxWidth: "85%", fontSize: 13, lineHeight: 1.7, color: m.role === "user" ? "#fbf8f1" : "#211C15", whiteSpace: "pre-wrap" }}>
                {m.text}
                <div style={{ fontSize: 10, color: "#6F6656", marginTop: 4 }}>{m.ts}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#fbeee6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🤖</div>
              <div style={{ fontSize: 13, color: ACCENT, padding: "9px 12px" }}>顧問分析中…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        {/* quick prompts */}
        <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, overflowX: "auto" }}>
          {["⚠️ 當前風險摘要","📋 未完成待辦","💰 預算差異分析","📅 建議工序安排"].map(q => (
            <button key={q} onClick={() => { setInput(q); setTimeout(() => document.getElementById("global-input")?.focus(),0); }} style={{ whiteSpace: "nowrap", background: "#e6ddc9", border: "1px solid #d9cfbd", color: "#6F6656", borderRadius: 20, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>{q}</button>
          ))}
        </div>
        <div style={{ padding: "0 14px 14px" }}>
          {attachments.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {attachments.map(a => (
                  <div key={a.id} style={{ position: "relative", width: 54, height: 54, borderRadius: 8, overflow: "hidden", border: "1px solid #d9cfbd", background: "#ece4d6", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
            <button onClick={() => fileRef.current?.click()} title="一般上傳（對話用）" style={{ background: "#e6ddc9", border: "1px solid #d9cfbd", borderRadius: 8, padding: "0 12px", height: 40, cursor: "pointer", fontSize: 16, color: "#4A4234", flexShrink: 0 }}>📎</button>
            {canEdit && <button onClick={() => importFileRef.current?.click()} title="報價單結構化匯入（解析→預覽→確認）" style={{ background: "#F0FDF4", border: "1px solid #3C8C3C", borderRadius: 8, padding: "0 10px", height: 40, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#3C8C3C", flexShrink: 0, whiteSpace: "nowrap" }}>📋 報價單</button>}
            <textarea id="global-input" value={input} onChange={e => setInput(e.target.value)} onPaste={onPaste} rows={2} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder="輸入、貼上截圖，或上傳估價單…（Enter 送出 · Shift+Enter 換行）" style={{ ...inputStyle, flex: 1, margin: 0, resize: "vertical", height: "auto", maxHeight: 160, overflowY: "auto", lineHeight: 1.5, fontFamily: "inherit" }} />
            <button onClick={send} disabled={loading || (!input.trim() && attachments.length === 0)} style={{ background: ACCENT, border: "none", borderRadius: 8, padding: "0 16px", height: 40, color: "#fbf8f1", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontSize: 14, opacity: loading ? 0.6 : 1, flexShrink: 0 }}>送</button>
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
                <div style={{ fontSize: 11, color: "#9b9384" }}>※ 數字照單據原值、不換算；可直接修改</div>
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

// SidePanel 已抽到 ./lib/ui.jsx（拆檔第二刀，2026-07-18）
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

// inputStyle 已抽到 ./lib/ui.jsx（拆檔第二刀，2026-07-18）