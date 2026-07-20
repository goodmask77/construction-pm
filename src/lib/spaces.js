// 空間設定 + 權限矩陣（純資料/衍生，無狀態）— App 與未來 LINE bot 共用
export const SPACES = [
  { id: "construction", name: "工程專案", icon: "🏗" },
  { id: "team",         name: "團隊工作", icon: "👥" },
  { id: "crew",         name: "夥伴中心", icon: "🤝" },
  { id: "finance",      name: "財務報表", icon: "💰" },
  // lw（LWLWLW）空間已收起：信箱管理移入全域「設定」內（資料 sp_lw_ 前綴保留不動）
  { id: "supply",       name: "供應鏈",    icon: "🔗" },
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
    // 任務板(overview)/進度(gantt) 與任務中心重疊尷尬（張良 2026-07-18）→ 收起，任務中心一站搞定（清單/看板/時間軸/甘特都有）；資料保留，要回來把這兩個從 hideTabs 拿掉即可
    hideTabs: ["compare", "overview", "gantt"],
    defaultView: "tasks",
    labels: { cat: "專案/群組", item: "任務", overview: "任務板", gantt: "進度", subtitle: "團隊任務追蹤" },
    aiRole: "你是團隊專案協作助理，協助追蹤每個人的任務進度、彙整待辦與提醒、整理會議與決策。請用繁體中文、簡潔專業，必要時條列重點。",
  },
  crew: {
    showCost: false,
    hideTabs: [],
    tabs: [["kb", "資料庫", "📚"], ["roster", "名冊", "👥"], ["shift", "排班", "📅"], ["r360", "360評鑑", "⭐"], ["fb", "回饋", "💬"], ["quest", "闖關", "🎮"], ["poll", "投票", "🗳"], ["shop", "商城", "🎁"], ["rank", "排行榜", "🏆"]], // 夥伴中心專屬分頁
    defaultView: "kb",
    hideKpi: true, // 夥伴中心頂部不顯示工程 KPI
    labels: { cat: "項目", item: "項目", overview: "資料庫", gantt: "進度", subtitle: "夥伴中心" },
    aiRole: "你是餐飲團隊的夥伴中心助理，協助夥伴查找內外場 SOP/手冊/教學等資料、解答工作問題。請用繁體中文、親切清楚。",
  },
  finance: {
    showCost: true, // 內帳全是金額，受看金額權限控管
    hideTabs: [],
    // 財務報表：原本「內帳總表」單一入口＋內部子分頁 → 攤平成第二層直接切（張良 2026-07-18）
    tabs: [["fin_ov", "總覽", "📊"], ["fin_acct", "帳戶", "🏦"], ["fin_ledger", "交易明細", "🧾"], ["fin_coa", "科目", "🗂"], ["fin_recon", "對帳", "🔄"], ["fin_pos", "營運報表", "📈"]],
    defaultView: "fin_pos", // 張良 2026-07-20：財務報表預設打開＝營運報表（分店預設 A Beach 101）
    hideKpi: true, // 不顯示工程 KPI
    labels: { cat: "科目", item: "交易", overview: "財務總覽", gantt: "—", subtitle: "多帳戶財務報表" },
    aiRole: "你是公司財務內帳助理，協助管理多個銀行/貸款/現金帳戶、記錄交易、對帳與餘額試算。請用繁體中文、精準務實。",
  },
  lw: {
    showCost: false,
    hideTabs: [],
    tabs: [["mail", "信箱管理", "📮"]], // LW 個人空間：第一個功能=電子信箱管理（來源判讀/規則/自動刪除分類）
    defaultView: "mail",
    hideKpi: true,
    labels: { cat: "項目", item: "項目", overview: "信箱", gantt: "—", subtitle: "LW 個人空間" },
    aiRole: "你是張良的個人助理，協助管理電子信箱與個人事務。請用繁體中文、簡潔務實。",
  },
  supply: {
    showCost: true, // 售價/採購價受「看金額」權限控管（店長層可遮）
    hideTabs: [],
    tabs: [["sproducts", "產品管理", "📦"], ["singred", "物料", "🥬"], ["svendors", "廠商建檔", "🏭"], ["sorder", "叫貨", "🛒"]],
    defaultView: "sproducts",
    hideKpi: true,
    labels: { cat: "類別", item: "品項", overview: "供應鏈", gantt: "—", subtitle: "供應鏈管理（進銷存/採購/比價）" },
    aiRole: "你是供應鏈管理助理，協助管理產品主檔、包材/物料、廠商與叫貨採購。請用繁體中文、簡潔務實。",
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
    ["roster", "名冊", { edit: 1 }],
    ["shift", "排班", { edit: 1 }],
    ["r360", "360評鑑", { edit: 1 }],
    ["fb", "回饋", { edit: 1 }],
    ["quest", "闖關", { edit: 1 }],
    ["poll", "投票", { edit: 1 }],
    ["shop", "商城", { edit: 1 }],
    ["rank", "排行榜", {}],
  ],
  finance: [
    ["fin_ov", "總覽", { money: 1 }],
    ["fin_acct", "帳戶", { edit: 1, money: 1 }],
    ["fin_ledger", "交易明細", { edit: 1, money: 1 }],
    ["fin_coa", "科目", { edit: 1 }],
    ["fin_recon", "對帳", { edit: 1, money: 1 }],
    ["fin_pos", "營運報表", { edit: 1, money: 1 }],
  ],
  // lw 空間收起：信箱管理改掛在全域「設定」（管理員限定），不再進權限矩陣
  supply: [
    ["sproducts", "產品管理", { edit: 1, money: 1 }],
    ["singred", "物料", { edit: 1, money: 1 }],
    ["svendors", "廠商建檔", { edit: 1, money: 1 }],
    ["sorder", "叫貨", { edit: 1, money: 1 }],
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
