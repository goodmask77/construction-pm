// ── 排班系統資料模型（純資料/工具，無 React、無 window 依賴 → node 可跑 selftest）──
// 儲存方式：沿用全站 pm_documents 文件式儲存，每張「邏輯資料表」= 一個 key（見 DOC_KEYS）。
// 所有 demo 資料帶 seed 欄位（SEED_BATCH），可整批清除不動真實資料（規格 §45）。

export const SCHEMA_V = 1;
export const SEED_BATCH = "demo-abeach-v1";

// 文件 key（實體 key 由 App 的 K() 加空間前綴，夥伴中心 → sp_crew_*）
export const DOC_KEYS = {
  stores: "shift_stores",         // §A stores
  rules: "shift_rules",           // §B labor_rules + 工時制度設定
  staff: "shift_staff",           // §D16 staff + staff_stores
  stations: "shift_stations",     // §D17-18 stations + station_skills
  templates: "shift_templates",   // §D19-20 shift_templates + demand_templates
  leaves: "shift_leaves",         // §D23 leave_requests
  weights: "shift_weights",       // §E 軟條件權重
  schedIndex: "shift_sched_index",// 週班表索引（每週一份文件）
};
export const schedKey = (storeId, weekStart) => `shift_sched_${storeId}_${weekStart}`; // §D21-22

// ── 日期工具（全部確定性，不用 Date.now）──
export const pad2 = (n) => String(n).padStart(2, "0");
export const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
export const dowOf = (iso) => parseISO(iso).getDay(); // 0=日
export const mondayOf = (iso) => addDays(iso, -((dowOf(iso) + 6) % 7)); // 該週的週一
export const weekDates = (weekStart) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
export const DOW_LABEL = ["日", "一", "二", "三", "四", "五", "六"];
export const fmtMD = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
// "HH:MM" → 分鐘
export const tMin = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
export const minT = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
// 班別實際工時（小時）：(迄-起-休息)；不支援跨夜（餐飲 21:30 打烊）
export const shiftHours = (sh) => Math.max(0, (tMin(sh.end) - tMin(sh.start) - (sh.breakMin || 0)) / 60);
// 日型態（demand 套用）：weekday / fri / sat / sun / holiday / event
export const dayTypeOf = (iso, holidaySet) => {
  if (holidaySet && holidaySet.has(iso)) return "holiday";
  const w = dowOf(iso);
  if (w === 5) return "fri";
  if (w === 6) return "sat";
  if (w === 0) return "sun";
  return "weekday";
};
export const DAY_TYPES = [["weekday", "平日"], ["fri", "週五"], ["sat", "週六"], ["sun", "週日"], ["holiday", "國定假日"], ["event", "活動日"]];

// ── 職級 / 技能等級 ──
export const GRADES = ["正職", "實習生", "全班PT", "週末PT", "管理"];
export const SKILL_LEVELS = [["main", "主力"], ["ok", "可勝任"], ["training", "受訓中"], ["no", "不可"]];
export const SKILL_LABEL = { main: "主力", ok: "可勝任", training: "受訓中", no: "不可" };
export const SKILL_RANK = { main: 3, ok: 2, training: 1, no: 0 }; // minLevel 比較用
export const WEIGHT_LEVELS = [["max", "最高", 8], ["high", "高", 4], ["normal", "一般", 1], ["off", "不考慮", 0]];
export const weightVal = (w) => (WEIGHT_LEVELS.find(([k]) => k === w) || [0, 0, 1])[2];
export const SCHED_STATUS = [["draft", "草稿"], ["review", "待確認"], ["published", "已發布"], ["locked", "已鎖定"]];

// ── §B labor_rules 預設清單（參數值全部 review_status=待驗證，待顧問覆核）──
export const DEFAULT_RULES = [
  {
    rule_code: "LR-030", name: "單日正常工時上限", law_ref: "勞基法 §30",
    params: { dailyNormalMax: 8, weeklyNormalMax: 40 },
    severity: "warn", applies_to_system: "general",
    effective_from: "2026-01-01", effective_to: null,
    interpretation_note: "一般工時制：每日正常工時不得超過 8 小時、每週不得超過 40 小時。超過部分屬延長工時（另受 LR-032 上限管制），排班面先以提示呈現，總量由 LR-032 卡死。",
    review_status: "pending", reviewed_by: "", reviewed_at: "", next_review_due: "", enabled: true, disable_reason: "",
  },
  {
    rule_code: "LR-030-1", name: "四週變形工時", law_ref: "勞基法 §30-1",
    params: { dailyNormalMax: 10, fourWeekNormalMax: 160, restDaysPer2Weeks: 2 },
    severity: "block", applies_to_system: "four_week",
    effective_from: "2026-01-01", effective_to: null,
    interpretation_note: "四週變形：正常工時得分配至其他工作日，每日正常上限 10 小時、4 週正常工時總量 160 小時、每 2 週至少 2 日例假。※分配細節與例假挪移之函釋依據待顧問確認。僅於「已填勞資會議同意書日期」時適用，未填一律回退一般工時（LR-030）。",
    review_status: "pending", reviewed_by: "", reviewed_at: "", next_review_due: "", enabled: true, disable_reason: "",
  },
  {
    rule_code: "LR-032", name: "延長工時上限", law_ref: "勞基法 §32",
    params: { dailyTotalMax: 12, monthlyOtMax: 46 },
    severity: "block", applies_to_system: "both",
    effective_from: "2026-01-01", effective_to: null,
    interpretation_note: "含加班單日總工時不得超過 12 小時；每月延長工時不得超過 46 小時（經工會/勞資會議同意得為 54h/月、138h/3 月 — 本階段先採 46 保守值，放寬需顧問確認）。延長工時 = 超過當日正常上限（一般 8h / 變形 10h）的部分。",
    review_status: "pending", reviewed_by: "", reviewed_at: "", next_review_due: "", enabled: true, disable_reason: "",
  },
  {
    rule_code: "LR-036", name: "七休一（例假）", law_ref: "勞基法 §36",
    params: { maxConsecutiveGeneral: 6, maxConsecutiveFourWeek: 12 },
    severity: "block", applies_to_system: "both",
    effective_from: "2026-01-01", effective_to: null,
    interpretation_note: "每 7 日應有 1 例假 1 休息日，連續出勤不得超過 6 日。四週變形依函釋例假得挪移、連續出勤上限暫採 12 日（勞動部 105 年函釋之保守解讀）※此為本系統解釋，務必顧問覆核。",
    review_status: "pending", reviewed_by: "", reviewed_at: "", next_review_due: "", enabled: true, disable_reason: "",
  },
  {
    rule_code: "LR-036-1", name: "休息日出勤", law_ref: "勞基法 §36、§24",
    params: { weeklyWorkDaysBeforeRestDay: 5 },
    severity: "warn", applies_to_system: "both",
    effective_from: "2026-01-01", effective_to: null,
    interpretation_note: "單週出勤第 6 日視為休息日出勤：需勞工同意且工資依 §24 加成（成本面提示）。不阻擋發布，但明確標示。",
    review_status: "pending", reviewed_by: "", reviewed_at: "", next_review_due: "", enabled: true, disable_reason: "",
  },
  {
    rule_code: "LR-034", name: "輪班換班間隔", law_ref: "勞基法 §34",
    params: { minRestHours: 11 },
    severity: "warn", applies_to_system: "both",
    effective_from: "2026-01-01", effective_to: null,
    interpretation_note: "§34 之適用前提為「輪班制」— A Beach 101 是否屬輪班制待確認；若非輪班制，本條轉為公司自訂軟條件（避免收班隔日開店）。暫以 warn 呈現、間隔 11 小時。",
    review_status: "pending", reviewed_by: "", reviewed_at: "", next_review_due: "", enabled: true, disable_reason: "",
  },
  {
    rule_code: "LR-048", name: "未成年工工時與夜間工作", law_ref: "勞基法 §44、§47、§48",
    params: { minorDailyMax: 8, minorWeeklyMax: 40, nightBanFrom: "20:00", nightBanTo: "06:00" },
    severity: "block", applies_to_system: "both",
    effective_from: "2026-01-01", effective_to: null,
    interpretation_note: "未滿 18 歲不得於 20:00–06:00 工作（§48）；童工（未滿 16）每日 ≤8h、每週 ≤40h、例假日不得工作（§47）。年齡以「出生年」概算（當年 − 出生年，保守判定），不存完整生日。※週末 PT 學生班次到 21:30 會直接觸發本條 — 這是法規現實，需經營面因應。",
    review_status: "pending", reviewed_by: "", reviewed_at: "", next_review_due: "", enabled: true, disable_reason: "",
  },
  {
    rule_code: "LR-MIN-WAGE", name: "基本工資（成本估算參數）", law_ref: "基本工資審議",
    params: { hourly: 190, monthly: 28590 },
    severity: "param", applies_to_system: "both",
    effective_from: "2026-01-01", effective_to: null,
    interpretation_note: "僅供預估人事成本（cost_factor × 工時 × 基本時薪）。2026 年度公告數字待查證更新 — 目前填 2025 值。",
    review_status: "pending", reviewed_by: "", reviewed_at: "", next_review_due: "", enabled: true, disable_reason: "",
  },
];

// 公司/店別工時制度設定（§B9）
export const DEFAULT_RULE_SETTINGS = {
  byStore: {
    abeach: { working_time_system: "four_week", agreement_date: "" }, // 同意書日期未填 → 檢查器一律回退一般工時
    ground: { working_time_system: "general", agreement_date: "" },
  },
};

// §E 軟條件（權重可調；永遠不得覆蓋硬條件）
export const SOFT_ITEMS = [
  ["expectShifts", "每週班數接近期望值"],
  ["wishOff", "希望休假"],
  ["fairness", "工時公平性"],
  ["noCloseThenOpen", "避免收班隔日開店"],
  ["mentorPair", "熟手新手搭配"],
  ["cost", "人力成本"],
  ["fixedPref", "固定班別偏好"],
  ["otWilling", "有加班意願者優先給加班"],
];
export const DEFAULT_WEIGHTS = { expectShifts: "max", wishOff: "max", fairness: "normal", noCloseThenOpen: "high", mentorPair: "normal", cost: "normal", fixedPref: "normal", otWilling: "high" }; // 張良2026-07-18：正職每週要排滿目標班數→班數權重最高；六天班的人靠 期望6+加班意願

// ── §A stores ──
export const SEED_STORES = [
  { id: "abeach", code: "AB101", name: "A Beach 101", legal: "（法人待填）", open: "09:00", close: "21:30", seed: SEED_BATCH },
  { id: "ground", code: "GROUND", name: "GROUN:D", legal: "（法人待填）", open: "", close: "", seed: SEED_BATCH }, // 本階段留空
];

// ── §D17 stations（A Beach 101 崗位）──
export const SEED_STATIONS = [
  { id: "st-early", code: "早爐", name: "早爐", dept: "內場", storeId: "abeach", desc: "開店備爐/早段熱台", sopId: null, seed: SEED_BATCH },
  { id: "st-salad", code: "沙", name: "沙拉台", dept: "內場", storeId: "abeach", desc: "", sopId: null, seed: SEED_BATCH },
  { id: "st-fry", code: "炸", name: "炸台", dept: "內場", storeId: "abeach", desc: "", sopId: null, seed: SEED_BATCH },
  { id: "st-mach", code: "機", name: "機台", dept: "內場", storeId: "abeach", desc: "", sopId: null, seed: SEED_BATCH },
  { id: "st-pd", code: "P/D", name: "P/D", dept: "內場", storeId: "abeach", desc: "備料/出餐調度", sopId: null, seed: SEED_BATCH },
  { id: "st-bar", code: "B", name: "吧台", dept: "外場", storeId: "abeach", desc: "", sopId: null, seed: SEED_BATCH },
  { id: "st-msal", code: "中沙", name: "中沙", dept: "外場", storeId: "abeach", desc: "", sopId: null, seed: SEED_BATCH },
  { id: "st-cash", code: "收", name: "收銀", dept: "外場", storeId: "abeach", desc: "", sopId: null, seed: SEED_BATCH },
  { id: "st-run", code: "跑", name: "跑堂", dept: "外場", storeId: "abeach", desc: "", sopId: null, seed: SEED_BATCH },
  { id: "st-duty", code: "值班", name: "值班經理", dept: "管理", storeId: "abeach", desc: "每時段至少 1 名（必要角色）", sopId: null, seed: SEED_BATCH },
];

// ── §J43 虛擬人員（內場6 / 外場6 / 週末PT4 / 管理1 = 17 人；之後整批換真實資料）──
// 不存身分證/勞健保/實際薪資（§I41）；出生「年」僅供 LR-048 判定。
const P = (id, name, nick, empNo, dept, grade, birthYear, expectShifts, costFactor, extra = {}) => ({
  id, name, nick, empNo, dept, grade, birthYear, expectShifts, costFactor,
  startDate: "2025-03-01", endDate: "", stores: ["abeach"], supportDepts: [],
  unavailable: [], // [{dow:0-6, from:"HH:MM", to:"HH:MM", note}] 固定不可排（整日 = from 00:00 to 24:00）
  otWilling: false, fixedPrefShiftIds: [], note: "", seed: SEED_BATCH, ...extra,
});
export const SEED_STAFF = [
  // 內場 6
  P("sf-ming", "陳志明", "阿明", "A001", "內場", "正職", 1996, 5, 1.0, { otWilling: true }),
  P("sf-chuan", "林大全", "阿全", "A002", "內場", "正職", 1998, 5, 1.0, { supportDepts: ["管理"] }),
  P("sf-cheng", "王承恩", "小丞", "A003", "內場", "正職", 2000, 5, 1.0),
  P("sf-kai", "張凱翔", "阿凱", "A004", "內場", "正職", 1999, 5, 1.0, { otWilling: true }),
  P("sf-ting", "李婷婷", "小婷", "A005", "內場", "實習生", 2004, 5, 0.7),
  P("sf-wei", "魏國強", "老魏", "A006", "內場", "全班PT", 1988, 4, 0.9, { unavailable: [{ dow: 1, from: "00:00", to: "24:00", note: "週一固定不可（家庭日）" }] }),
  // 外場 6
  P("sf-mei", "黃小美", "小美", "B001", "外場", "正職", 1997, 5, 1.0, { supportDepts: ["管理"] }),
  P("sf-je", "吳俊哲", "阿哲", "B002", "外場", "正職", 1995, 5, 1.0, { otWilling: true }),
  P("sf-pei", "周佩佩", "佩佩", "B003", "外場", "正職", 2001, 5, 1.0),
  P("sf-lia", "劉志良", "阿良", "B004", "外場", "全班PT", 1993, 4, 0.9),
  P("sf-rou", "蔡沐柔", "小柔", "B005", "外場", "實習生", 2005, 5, 0.7),
  P("sf-wang", "王泓文", "大王", "B006", "外場", "正職", 1994, 5, 1.0),
  // 週末 PT 4（小安/阿樂 17 歲學生 → LR-048 會管到；平日上課不可排）
  P("sf-an", "許安安", "小安", "C001", "外場", "週末PT", 2009, 2, 0.6, { unavailable: [1, 2, 3, 4, 5].map(dw => ({ dow: dw, from: "00:00", to: "24:00", note: "平日上課" })) }),
  P("sf-le", "楊樂樂", "阿樂", "C002", "內場", "週末PT", 2009, 2, 0.6, { unavailable: [1, 2, 3, 4, 5].map(dw => ({ dow: dw, from: "00:00", to: "24:00", note: "平日上課" })) }),
  P("sf-ni", "郭妮妮", "妮妮", "C003", "外場", "週末PT", 2006, 2, 0.6, { unavailable: [1, 2, 3, 4, 5].map(dw => ({ dow: dw, from: "00:00", to: "24:00", note: "平日上課（大學）" })) }),
  P("sf-tang", "曾以棠", "阿棠", "C004", "外場", "週末PT", 2005, 2, 0.6, { unavailable: [1, 2, 3, 4].map(dw => ({ dow: dw, from: "00:00", to: "24:00", note: "平日上課（大學，週五可）" })) }),
  // 管理 1
  P("sf-wendy", "溫蒂", "Wendy", "M001", "管理", "管理", 1990, 5, 1.3),
];

// ── §D18 崗位技能矩陣（早爐=單點故障：主力僅阿明；受訓中：小婷、小柔 2 名）──
export const SEED_SKILLS = {
  //           早爐        沙       炸       機       P/D      B        中沙     收       跑       值班
  "sf-ming":  { "st-early": "main", "st-salad": "ok", "st-fry": "ok", "st-mach": "ok", "st-pd": "ok" },
  "sf-chuan": { "st-early": "ok", "st-salad": "main", "st-fry": "main", "st-mach": "ok", "st-pd": "ok", "st-duty": "ok" },
  "sf-cheng": { "st-salad": "ok", "st-fry": "ok", "st-mach": "main", "st-pd": "ok" },
  "sf-kai":   { "st-salad": "ok", "st-fry": "ok", "st-mach": "ok", "st-pd": "main" },
  "sf-ting":  { "st-salad": "training", "st-mach": "ok", "st-fry": "no" }, // 受訓中 1（沙拉台受訓）
  "sf-wei":   { "st-early": "ok", "st-salad": "ok", "st-fry": "ok", "st-mach": "ok", "st-pd": "ok" },
  "sf-mei":   { "st-bar": "main", "st-msal": "ok", "st-cash": "ok", "st-run": "ok", "st-duty": "ok" },
  "sf-je":    { "st-bar": "ok", "st-msal": "main", "st-cash": "ok", "st-run": "ok" },
  "sf-pei":   { "st-bar": "ok", "st-msal": "ok", "st-cash": "main", "st-run": "ok" },
  "sf-lia":   { "st-bar": "ok", "st-msal": "ok", "st-cash": "ok", "st-run": "main" },
  "sf-rou":   { "st-msal": "training", "st-run": "training", "st-bar": "no" }, // 受訓中 2
  "sf-wang":  { "st-bar": "ok", "st-msal": "ok", "st-cash": "ok", "st-run": "ok" },
  "sf-an":    { "st-run": "ok", "st-cash": "ok" },
  "sf-le":    { "st-salad": "ok", "st-mach": "ok" },
  "sf-ni":    { "st-run": "ok", "st-cash": "ok", "st-msal": "ok" },
  "sf-tang":  { "st-run": "ok", "st-cash": "ok", "st-bar": "ok" },
  "sf-wendy": { "st-duty": "main", "st-cash": "ok", "st-run": "ok", "st-msal": "ok" },
};

// ── §D19 班別模板（10 種）──
const SH = (id, code, name, color, start, end, breakMin, dept, flags = {}, extra = {}) => ({
  id, code, name, color, start, end, breakMin, dept,
  storeId: "abeach", stationId: null, minLevel: "training",
  isOpen: !!flags.open, isClose: !!flags.close, isMgr: !!flags.mgr,
  externalCode: "", seed: SEED_BATCH, ...extra,
});
export const SEED_SHIFTS = [
  SH("sh-e1", "早爐", "早爐班", "#c98a14", "07:00", "16:00", 60, "內場", { open: true }),   // 8h
  SH("sh-k1", "內早", "內場早班", "#3f7d4e", "09:00", "17:30", 60, "內場", { open: true }), // 7.5h
  SH("sh-k2", "內晚", "內場晚班", "#3a6ea5", "13:00", "21:30", 30, "內場", { close: true }),// 8h
  SH("sh-f1", "外早", "外場早班", "#6a994e", "09:30", "18:00", 60, "外場", { open: true }), // 7.5h
  SH("sh-f2", "外晚", "外場晚班", "#4d6db3", "13:00", "21:30", 30, "外場", { close: true }),// 8h
  SH("sh-m1", "值早", "值班經理早", "#8d4fa8", "08:30", "17:30", 60, "管理", { open: true, mgr: true }, { minLevel: "ok" }),  // 8h
  SH("sh-m2", "值晚", "值班經理晚", "#6b3fa0", "12:30", "21:30", 60, "管理", { close: true, mgr: true }, { minLevel: "ok" }), // 8h
  SH("sh-p1", "PT午", "PT 午班", "#b3702a", "11:00", "16:00", 0, "外場"),                   // 5h
  SH("sh-p2", "PT晚", "PT 晚班", "#a34d68", "17:00", "21:30", 0, "外場", { close: true }),  // 4.5h
  SH("sh-full", "全日", "全日班（活動日）", "#b3261e", "09:00", "21:30", 60, "內場"),        // 11.5h（測試/活動用）
];

// ── §D20 人力需求模板（seats：班別 × 崗位 → 人數；UI 依班別時段呈現）──
const D = (shiftId, stationId, count = 1) => ({ shiftId, stationId, count });
// 平日 7 席：早爐/沙/炸/機/收/跑 + 值班晚（平日早段由店長不定時巡，demo 值：真實需求由使用者調）
const BASE_WEEKDAY = [
  D("sh-e1", "st-early"), D("sh-k1", "st-salad"), D("sh-k2", "st-fry"), D("sh-k2", "st-mach"),
  D("sh-f1", "st-cash"), D("sh-f2", "st-run"), D("sh-m2", "st-duty"),
];
export const SEED_DEMANDS = [
  { id: "dm-weekday", storeId: "abeach", dayType: "weekday", seats: BASE_WEEKDAY, requiredRoles: ["每時段至少 1 名值班經理"], seed: SEED_BATCH },
  { id: "dm-fri", storeId: "abeach", dayType: "fri", seats: [...BASE_WEEKDAY, D("sh-f2", "st-msal")], requiredRoles: ["每時段至少 1 名值班經理"], seed: SEED_BATCH },
  { id: "dm-sat", storeId: "abeach", dayType: "sat", seats: [...BASE_WEEKDAY, D("sh-m1", "st-duty"), D("sh-f1", "st-bar"), D("sh-k1", "st-pd"), D("sh-p1", "st-run"), D("sh-p2", "st-cash"), D("sh-p2", "st-run")], requiredRoles: ["每時段至少 1 名值班經理"], seed: SEED_BATCH },
  { id: "dm-sun", storeId: "abeach", dayType: "sun", seats: [...BASE_WEEKDAY, D("sh-m1", "st-duty"), D("sh-f1", "st-bar"), D("sh-p1", "st-run"), D("sh-p2", "st-cash")], requiredRoles: ["每時段至少 1 名值班經理"], seed: SEED_BATCH },
];

// ── §J44 已核准請假（≥3 筆；上週 2026-07-06 ～ 07-12）──
export const SEED_LEAVES = [
  { id: "lv-1", staffId: "sf-cheng", date: "2026-07-09", from: "00:00", to: "24:00", type: "特休", status: "approved", approver: "Wendy", seed: SEED_BATCH },
  { id: "lv-2", staffId: "sf-pei", date: "2026-07-11", from: "00:00", to: "24:00", type: "事假", status: "approved", approver: "Wendy", seed: SEED_BATCH },
  { id: "lv-3", staffId: "sf-je", date: "2026-07-12", from: "00:00", to: "24:00", type: "特休", status: "approved", approver: "Wendy", seed: SEED_BATCH },
];

// 基準週（虛擬「上週實際班表」：2026-07-06(一) ～ 07-12(日)）
export const BASELINE_WEEK = "2026-07-06";

// ── 索引/查表工具 ──
export const byId = (arr) => Object.fromEntries((arr || []).map(x => [x.id, x]));
export const skillOf = (skills, staffId, stationId) => (skills?.[staffId]?.[stationId]) || "no";
export const activeRules = (rules) => (rules || []).filter(r => r.enabled !== false && r.severity !== "param");
export const ruleBy = (rules, code) => (rules || []).find(r => r.rule_code === code);
// 店別實際適用工時制度（§B9：同意書日期未填 → 一律一般工時）
export const effectiveSystem = (settings, storeId) => {
  const s = settings?.byStore?.[storeId] || {};
  return (s.working_time_system === "four_week" && s.agreement_date) ? "four_week" : "general";
};
export const systemFallbackNote = (settings, storeId) => {
  const s = settings?.byStore?.[storeId] || {};
  return (s.working_time_system === "four_week" && !s.agreement_date)
    ? "已選四週變形工時但未填勞資會議同意書日期 → 檢查器暫套「一般工時」上限（填入日期後自動切換）" : "";
};
// 年齡概算（保守：當年 − 出生年；不存完整生日 §D16）
export const ageAt = (birthYear, iso) => birthYear ? (Number(iso.slice(0, 4)) - birthYear) : 99;

// 需求模板 → 某週的座位清單（date × shiftId × stationId 逐一展開；可被單日覆寫 §D20）
export function seatsForWeek(demands, weekStart, storeId, overrides, holidaySet) {
  const out = [];
  for (const date of weekDates(weekStart)) {
    const ov = (overrides || []).find(o => o.date === date);
    const dayType = ov?.dayType || dayTypeOf(date, holidaySet);
    const dm = (demands || []).find(d => d.storeId === storeId && d.dayType === dayType)
      || (demands || []).find(d => d.storeId === storeId && d.dayType === "weekday");
    const seats = ov?.seats || dm?.seats || [];
    seats.forEach((s, si) => { for (let c = 0; c < (s.count || 1); c++) out.push({ date, shiftId: s.shiftId, stationId: s.stationId, seatKey: `${date}|${s.shiftId}|${s.stationId}|${si}-${c}` }); });
  }
  return out;
}

// 預估人事成本（§I39：cost_factor × 工時 × 基本時薪；僅供成本控管參考，非薪資）
export function estCost(assignments, staffById, shiftById, rules) {
  const hourly = ruleBy(rules, "LR-MIN-WAGE")?.params?.hourly || 190;
  let hours = 0, cost = 0;
  for (const a of assignments || []) {
    const sh = shiftById[a.shiftId]; if (!sh) continue;
    const h = shiftHours(sh); hours += h;
    cost += h * hourly * (staffById[a.staffId]?.costFactor || 1);
  }
  return { hours: Math.round(hours * 10) / 10, cost: Math.round(cost) };
}

// ── 三份測試班表（§J44）＋ 上週實際班表（虛擬基準）──
// 以「暱稱→班別代碼」逐日手排；A = assignment
let _aid = 0;
const A = (staffId, date, shiftId, stationId, pinned = false) => ({ id: `as-${++_aid}`, staffId, date, shiftId, stationId, pinned, seed: SEED_BATCH });
const week = (weekStart, rows) => {
  // rows: [staffId, stationId, shiftId 或 [七天各自的 shiftId|null]]
  const out = [];
  for (const [staffId, plan] of rows) {
    weekDates(weekStart).forEach((date, i) => {
      const p = plan[i]; if (!p) return;
      out.push(A(staffId, date, p[0], p[1]));
    });
  }
  return out;
};
const E1 = ["sh-e1", "st-early"], K1S = ["sh-k1", "st-salad"], K1P = ["sh-k1", "st-pd"], K2F = ["sh-k2", "st-fry"], K2M = ["sh-k2", "st-mach"],
  F1C = ["sh-f1", "st-cash"], F1B = ["sh-f1", "st-bar"], F2R = ["sh-f2", "st-run"], F2M = ["sh-f2", "st-msal"],
  M1 = ["sh-m1", "st-duty"], M2 = ["sh-m2", "st-duty"], P1R = ["sh-p1", "st-run"], P2C = ["sh-p2", "st-cash"], P2R = ["sh-p2", "st-run"],
  FUL = ["sh-full", "st-fry"];

// (a) 完全合規、人力達標的可行班表（= 虛擬「上週實際班表」基底；週一 07-06 ～ 週日 07-12）
//     一~日 index: 0=一 1=二 2=三 3=四 4=五 5=六 6=日（weekDates 從週一起算）
// 逐格手驗過：座位全滿、技能/請假/不可排/七休一/換班間隔/未成年/受訓陪同 全數合規
export function buildScheduleA(weekStart = BASELINE_WEEK) {
  _aid = 1000;
  const K1S_ = K1S, MACH = K2M;
  return week(weekStart, [
    //             一     二     三     四     五     六     日
    ["sf-ming",  [E1,    E1,    null,  E1,    E1,    E1,    null]],  // 早爐唯一主力：5 班（休三/日）
    ["sf-chuan", [K2F,   K2F,   K2F,   K2F,   K2F,   null,  null]],  // 炸台主力：一~五（週末休）
    ["sf-cheng", [MACH,  MACH,  MACH,  null,  MACH,  MACH,  null]],  // 機台主力；週四特休(lv-1)
    ["sf-kai",   [K1S_,  null,  K1S_,  MACH,  null,  K2F,   K2F]],   // 萬用：沙/機/炸
    ["sf-ting",  [null,  K1S_,  null,  null,  K1S_,  null,  MACH]],  // 小婷：沙拉受訓中（二/五同時段有沙拉主力阿全在場）、機可勝任
    ["sf-wei",   [null,  null,  E1,    K1S_,  null,  K1P,   E1]],    // 老魏：週一固定不可；三代早爐、四沙、六P/D、日早爐
    ["sf-le",    [null,  null,  null,  null,  null,  K1S_,  K1S_]],  // 阿樂(17歲)：週末白天沙拉（17:30 前下班，避開 §48）
    ["sf-mei",   [null,  M2,    null,  M2,    null,  M2,    M2]],    // 值班支援 4 班
    ["sf-wendy", [M2,    null,  M2,    null,  M2,    M1,    M1]],    // 店長 5 班
    ["sf-pei",   [F1C,   null,  null,  F1C,   F1C,   null,  F1C]],   // 週六事假(lv-2)
    ["sf-je",    [F2R,   null,  null,  F2R,   F2M,   F1B,   null]],  // 週日特休(lv-3)
    ["sf-wang",  [null,  F1C,   F2R,   null,  null,  F1C,   F2R]],
    ["sf-lia",   [null,  F2R,   F1C,   null,  F2R,   F2R,   null]],
    ["sf-rou",   [null,  null,  null,  null,  null,  P2R,   null]],  // 小柔：跑堂受訓中（六晚有跑堂主力阿良同場）
    ["sf-an",    [null,  null,  null,  null,  null,  P1R,   P1R]],   // 17 歲：只排 11:00–16:00（避開 §48 夜間）
    ["sf-ni",    [null,  null,  null,  null,  null,  P2C,   P2C]],   // 成年 PT 收銀晚
    ["sf-tang",  [null,  null,  null,  null,  null,  null,  F1B]],   // 阿棠：週日吧台
  ]);
}

// (b) 刻意無解：炸台合格人力被抽光（測缺口報告）
export function buildScheduleBLeaves(weekStart) {
  // 附加請假：把炸台合格者（阿全主力、小丞/阿凱/老魏可勝任）在週三全抽掉 → 週三炸台必缺
  return [
    { id: "lv-b1", staffId: "sf-chuan", date: addDays(weekStart, 2), from: "00:00", to: "24:00", type: "特休", status: "approved", approver: "Wendy", seed: SEED_BATCH },
    { id: "lv-b2", staffId: "sf-cheng", date: addDays(weekStart, 2), from: "00:00", to: "24:00", type: "病假", status: "approved", approver: "Wendy", seed: SEED_BATCH },
    { id: "lv-b3", staffId: "sf-kai", date: addDays(weekStart, 2), from: "00:00", to: "24:00", type: "事假", status: "approved", approver: "Wendy", seed: SEED_BATCH },
    { id: "lv-b4", staffId: "sf-wei", date: addDays(weekStart, 2), from: "00:00", to: "24:00", type: "事假", status: "approved", approver: "Wendy", seed: SEED_BATCH },
    { id: "lv-b5", staffId: "sf-ming", date: addDays(weekStart, 2), from: "00:00", to: "24:00", type: "特休", status: "approved", approver: "Wendy", seed: SEED_BATCH },
  ];
}

// (c) 刻意違規：每條已建規則各至少觸發一例（驗證檢查器法條與數值輸出）
export function buildScheduleC(weekStart = "2026-06-01") {
  _aid = 3000;
  const out = [];
  const d = (i) => addDays(weekStart, i);
  // LR-036 七休一：阿明連 7 日出勤（一~日）
  for (let i = 0; i < 7; i++) out.push(A("sf-ming", d(i), "sh-e1", "st-early"));
  // LR-036-1 休息日出勤：上面第 6 日同時觸發 warn
  // LR-030 / LR-030-1：阿全排全日班 11.5h（>8 一般 warn；>10 變形 block）
  out.push(A("sf-chuan", d(0), "sh-full", "st-fry"));
  // LR-032 單日 >12h：阿凱 早爐 8h + PT晚 4.5h = 12.5h
  out.push(A("sf-kai", d(1), "sh-e1", "st-early"));
  out.push(A("sf-kai", d(1), "sh-p2", "st-run"));
  // LR-032 單月延長工時 >46h：小丞全日班 ×14（每日 OT 3.5h × 14 = 49h > 46）
  for (let i = 0; i < 14; i++) out.push(A("sf-cheng", d(i), "sh-full", "st-mach"));
  // LR-034 換班間隔 <11h：大王 週一閉店(21:30) → 週二外場早班(09:30) 間隔 12h OK…改早爐 07:00 → 9.5h
  out.push(A("sf-wang", d(0), "sh-f2", "st-run"));
  out.push(A("sf-wang", d(1), "sh-e1", "st-early")); // 大王沒早爐技能 → 同時觸發技能硬條件（CR-01）
  // LR-048 未成年夜間：小安（17 歲）排 PT晚 17:00–21:30（跨 20:00）
  out.push(A("sf-an", d(5), "sh-p2", "st-cash"));
  // CR-02 受訓中無主力在場：小婷單獨排沙拉台（同時段無沙拉台主力/可勝任）
  out.push(A("sf-ting", d(3), "sh-k1", "st-salad"));
  // CR-03 已核准請假仍排班：佩佩 07-11 事假但在 (c) 測試週另建一筆
  out.push(A("sf-pei", d(2), "sh-f1", "st-cash"));
  return out;
}
export const SEED_LEAVES_C = (weekStart = "2026-06-01") => [
  { id: "lv-c1", staffId: "sf-pei", date: addDays(weekStart, 2), from: "00:00", to: "24:00", type: "事假", status: "approved", approver: "Wendy", seed: SEED_BATCH },
];

// 上週「實際」班表 = (a) 加兩處人為調整（模擬現場換班，讓比對驗收 §46-47 有差異可解讀）
export function buildBaselineActual(weekStart = BASELINE_WEEK) {
  const list = buildScheduleA(weekStart);
  // 調整1：週三 阿良↔大王 崗位對調（收銀/跑堂互換 — 現場口頭換班，表上看不出原因的隱性差異）
  const wed = addDays(weekStart, 2);
  for (const a of list) {
    if (a.date === wed && a.staffId === "sf-lia") a.staffId = "sf-wang";
    else if (a.date === wed && a.staffId === "sf-wang") a.staffId = "sf-lia";
  }
  // 調整2：週五 阿明加排 PT晚跑堂（實際多上一段 → 當日 12.5h，會被檢查器抓 LR-032 — 故意的：實際班表本身就違規）
  list.push(A("sf-ming", addDays(weekStart, 4), "sh-p2", "st-run"));
  return list;
}

// 新排班文件外殼
export const newSchedule = (storeId, weekStart) => ({
  schema_v: SCHEMA_V, storeId, weekStart, status: "draft",
  assignments: [], overrides: [], changeLog: [], seed: "",
});

// ── 名冊 → 排班人員 對照（張良 2026-07-18：排班人員全部對照名冊內外場）──
// 重複同步不會蓋掉手動調過的技能/期望班數/不可排：既有者只更新基本資料，新人才建新檔。
// grade 對照：名冊職稱 正職→正職、含PT→全班PT；預設技能：內場→內場崗位全「可勝任」、外場→外場崗位全「可勝任」（假設值，請在矩陣校正）。
export function syncRosterToShift(rosterPeople, titleOf, existingStaff, stations, existingSkills, storeId = "abeach") {
  const active = (rosterPeople || []).filter(p => (p.status || "在職") === "在職" && ["內場", "外場"].includes(p.dept));
  const byRoster = Object.fromEntries((existingStaff || []).filter(s => s.rosterId).map(s => [s.rosterId, s]));
  const staff = [], skills = { ...(existingSkills || {}) };
  const deptStations = (dept) => (stations || []).filter(st => st.storeId === storeId && st.dept === dept);
  for (const p of active) {
    const title = String(titleOf ? titleOf(p) : "").trim();
    const grade = /pt/i.test(title) ? "全班PT" : "正職";
    const old = byRoster[p.id];
    const id = old ? old.id : "rs-" + p.id;
    const base = {
      id, rosterId: p.id, name: p.name || "", nick: p.nick || "", empNo: p.empNo || "",
      dept: p.dept, grade,
      birthYear: p.bday ? Number(String(p.bday).slice(0, 4)) || null : null,
      startDate: p.startDate || "", endDate: p.endDate || "",
      stores: [storeId], supportDepts: old?.supportDepts || [],
      expectShifts: old?.expectShifts ?? (grade === "正職" ? 5 : 3),
      costFactor: old?.costFactor ?? (grade === "正職" ? 1 : 0.8),
      unavailable: old?.unavailable || [], wishOff: old?.wishOff || [],
      otWilling: old?.otWilling || false, fixedPrefShiftIds: old?.fixedPrefShiftIds || [],
      note: old?.note || "", seed: "",
    };
    staff.push(base);
    if (!skills[id] || !Object.keys(skills[id]).length) {
      skills[id] = Object.fromEntries(deptStations(p.dept).map(st => [st.id, "ok"])); // 假設值：本部門全「可勝任」
    }
  }
  // 名冊已離職/移出內外場者 → 從排班人員移除（demo 假人也在此一併清掉）
  const keepIds = new Set(staff.map(s => s.id));
  for (const k of Object.keys(skills)) if (!keepIds.has(k)) delete skills[k];
  return { staff, skills, added: active.filter(p => !byRoster[p.id]).length, total: staff.length };
}
