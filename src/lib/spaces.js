// 空間設定 + 權限矩陣（純資料/衍生，無狀態）— App 與未來 LINE bot 共用
export const SPACES = [
  { id: "construction", name: "工程專案", icon: "🏗" },
  { id: "team",         name: "團隊工作", icon: "👥" },
  { id: "crew",         name: "夥伴中心", icon: "🤝" },
  { id: "finance",      name: "財務內帳", icon: "💰" },
];
// 每個空間的外觀客製（顯示成本與否、隱藏分頁、名詞、AI 角色、專屬分頁）
export const SPACE_CONF = {
  construction: {
    showCost: true,
    hideTabs: [],
    labels: { cat: "工程大項", item: "細項", overview: "總覽", gantt: "工序", subtitle: "成本費用明細" },
    aiRole: null, // 用原本的工程顧問提示
  },
  team: {
    showCost: false,
    hideTabs: ["compare"], // 團隊不需要比價
    labels: { cat: "專案/群組", item: "任務", overview: "任務板", gantt: "進度", subtitle: "團隊任務追蹤" },
    aiRole: "你是團隊專案協作助理，協助追蹤每個人的任務進度、彙整待辦與提醒、整理會議與決策。請用繁體中文、簡潔專業，必要時條列重點。",
  },
  crew: {
    showCost: false,
    hideTabs: [],
    tabs: [["kb", "資料庫", "📚"], ["r360", "360評鑑", "⭐"], ["fb", "回饋", "💬"], ["quest", "闖關", "🎮"], ["poll", "投票", "🗳"], ["shop", "商城", "🎁"], ["rank", "排行榜", "🏆"]], // 夥伴中心專屬分頁
    defaultView: "kb",
    hideKpi: true, // 夥伴中心頂部不顯示工程 KPI
    labels: { cat: "項目", item: "項目", overview: "資料庫", gantt: "進度", subtitle: "夥伴中心" },
    aiRole: "你是餐飲團隊的夥伴中心助理，協助夥伴查找內外場 SOP/手冊/教學等資料、解答工作問題。請用繁體中文、親切清楚。",
  },
  finance: {
    showCost: true, // 內帳全是金額，受看金額權限控管
    hideTabs: [],
    tabs: [["finance", "內帳總表", "💰"]], // 財務空間：單一入口，內部再分子分頁（總覽/帳戶/交易）
    defaultView: "finance",
    hideKpi: true, // 不顯示工程 KPI
    labels: { cat: "科目", item: "交易", overview: "財務總覽", gantt: "—", subtitle: "多帳戶內帳總表" },
    aiRole: "你是公司財務內帳助理，協助管理多個銀行/貸款/現金帳戶、記錄交易、對帳與餘額試算。請用繁體中文、精準務實。",
  },
};
// ── 權限矩陣：每個空間有哪些頁面、各頁是否有「可編輯」「看金額」維度（帳號權限二合一矩陣用）──
export const PERM_MATRIX = {
  construction: [
    ["owner", "儀表板", { money: 1 }],
    ["overview", "總覽", { edit: 1, money: 1 }],
    ["gantt", "工序", { edit: 1 }],
    ["petty", "零用金", { edit: 1, money: 1 }],
    ["files", "檔案庫", { edit: 1 }],
    ["issues", "ToDo", { edit: 1 }],
    ["compare", "比價", { edit: 1, money: 1 }],
    ["advisor", "AI設定", { edit: 1 }],
  ],
  team: [
    ["owner", "儀表板", {}],
    ["overview", "任務板", { edit: 1 }],
    ["gantt", "進度", { edit: 1 }],
    ["files", "檔案庫", { edit: 1 }],
    ["issues", "ToDo", { edit: 1 }],
    ["advisor", "AI設定", { edit: 1 }],
  ],
  crew: [
    ["kb", "資料庫", { edit: 1 }],
    ["r360", "360評鑑", { edit: 1 }],
    ["fb", "回饋", { edit: 1 }],
    ["quest", "闖關", { edit: 1 }],
    ["poll", "投票", { edit: 1 }],
    ["shop", "商城", { edit: 1 }],
    ["rank", "排行榜", {}],
  ],
  finance: [
    ["finance", "內帳總表", { edit: 1, money: 1 }],
  ],
};
// 舊資料相容：以前的可編輯權限只有 data/files/advisor 三類，對應到各頁
export const LEGACY_EDIT = { overview: "data", gantt: "data", petty: "data", issues: "data", owner: "data", groups: "data", kb: "data", r360: "data", fb: "data", quest: "data", poll: "data", shop: "data", rank: "data", finance: "data", files: "files", compare: "files", advisor: "advisor" };
export const PERM_NONE = "__none__"; // 哨兵：陣列＝[PERM_NONE] 代表「明確全關」(與空陣列＝預設全開 區分)
// 預設身份範本（連動式）。陣列規則同矩陣：[]＝全開、[PERM_NONE]＝全關、其餘＝明確允許清單。
export const DEFAULT_ROLES = [
  { id: "role-foreman", name: "工地監工", spaces: ["construction"], view_pages: [], pages: [], money_pages: [] },
  { id: "role-account", name: "會計/財務", spaces: [], view_pages: [], pages: ["construction:petty"], money_pages: [] },
  { id: "role-staff", name: "一般員工", spaces: [], view_pages: [], pages: ["__none__"], money_pages: ["__none__"] },
  { id: "role-vendor", name: "廠商/外部", spaces: ["construction"], view_pages: ["construction:overview", "construction:gantt", "construction:files", "construction:issues"], pages: ["__none__"], money_pages: ["__none__"] },
];
export const ALL_VIEW_KEYS = Object.entries(PERM_MATRIX).flatMap(([sp, rows]) => rows.map(([pg]) => `${sp}:${pg}`));
export const ALL_EDIT_KEYS = Object.entries(PERM_MATRIX).flatMap(([sp, rows]) => rows.filter(r => r[2].edit).map(([pg]) => `${sp}:${pg}`));
export const ALL_MONEY_KEYS = Object.entries(PERM_MATRIX).filter(([sp]) => SPACE_CONF[sp]?.showCost).flatMap(([sp, rows]) => rows.filter(r => r[2].money).map(([pg]) => `${sp}:${pg}`));
