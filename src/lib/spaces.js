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
    // 夥伴中心分層重整（張良 2026-07-18）：第一層依「工作目的」分四個主入口，第二層才是功能頁——
    // 分頁不再全部平鋪一排（人事/訓練/激勵混在一起會越加越長）。groups: [id, 名稱, icon, [第二層 view keys]]
    groups: [
      ["g_today", "今日", "🏠", ["ctoday", "cjournal"]],
      ["g_people", "人員與排班", "👥", ["roster", "shift", "punch", "pay"]],
      ["g_sop", "SOP與訓練", "📚", ["kb", "quest"]],
      ["g_grow", "成長與文化", "🌱", ["r360", "fb", "poll", "reward"]],
    ],
    tabs: [["ctoday", "今日", "🏠"], ["cjournal", "工作日誌", "📝"], ["roster", "名冊", "👥"], ["shift", "排班", "📅"], ["punch", "出勤", "⏱"], ["pay", "薪資試算", "💰"], ["kb", "SOP知識庫", "📚"], ["quest", "闖關", "🎮"], ["r360", "360評鑑", "⭐"], ["fb", "回饋", "💬"], ["poll", "投票", "🗳"], ["reward", "獎勵中心", "🏆"]], // 商城＋排行榜合併成「獎勵中心」；資料庫改名「SOP知識庫」
    defaultView: "ctoday", // 一進來先看「今天與我有關的事」，不再落在空資料庫
    hideKpi: true, // 夥伴中心頂部不顯示工程 KPI
    labels: { cat: "項目", item: "項目", overview: "SOP知識庫", gantt: "進度", subtitle: "夥伴中心" },
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
    // 供應鏈重建定版（張良 2026-09-06「全部打掉重做，現在結構很亂」）：六籤＝物料庫(含廠商子頁)→價格追蹤→半成品→成品食譜→叫貨→成本分析
    // 舊 菜單管理→成品食譜、物料清單/廠商建檔 併入物料庫（view 代碼還在但不掛籤）
    tabs: [["smat", "物料庫", "📦"], ["sprice", "價格追蹤", "📈"], ["ssemi", "半成品", "🧪"], ["sproducts", "成品食譜", "🍽"], ["sorder", "叫貨", "🛒"], ["scost", "成本分析", "📊"]],
    defaultView: "smat", // 重建 P1：進供應鏈先看物料庫
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
    ["ctoday", "今日", {}],
    ["cjournal", "工作日誌", { edit: 1 }],
    ["kb", "SOP知識庫", { edit: 1 }],
    ["roster", "名冊", { edit: 1 }],
    ["shift", "排班", { edit: 1 }],
    ["punch", "出勤", { edit: 1 }],
    ["pay", "薪資試算", { edit: 1 }],
    ["r360", "360評鑑", { edit: 1 }],
    ["fb", "回饋", { edit: 1 }],
    ["quest", "闖關", { edit: 1 }],
    ["poll", "投票", { edit: 1 }],
    ["reward", "獎勵中心", { edit: 1 }], // 原 商城(shop)＋排行榜(rank) 合併；舊權限勾選由 VIEW_PERM_ALIAS 相容
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
    ["smat", "物料庫", { edit: 1, money: 1 }],
    ["sprice", "價格追蹤", { edit: 1, money: 1 }],
    ["ssemi", "半成品", { edit: 1, money: 1 }],
    ["sproducts", "成品食譜", { edit: 1, money: 1 }],
    ["sorder", "叫貨", { edit: 1, money: 1 }],
    ["scost", "成本分析", { edit: 1, money: 1 }],
  ],
};
// 舊資料相容：以前的可編輯權限只有 data/files/advisor 三類，對應到各頁
export const LEGACY_EDIT = { overview: "data", gantt: "data", petty: "data", issues: "data", owner: "data", groups: "data", kb: "data", r360: "data", fb: "data", quest: "data", poll: "data", shop: "data", rank: "data", reward: "data", finance: "data", files: "files", compare: "files", advisor: "advisor" };
// 分頁改組相容：新頁 key → 舊頁 key 清單（帳號權限若勾過舊頁，視同勾了新頁）。例：獎勵中心=舊商城+排行榜
export const VIEW_PERM_ALIAS = { reward: ["shop", "rank"], smat: ["singred", "svendors"], ssemi: ["sproducts"] }; // 供應鏈重建：舊 物料清單/廠商建檔 權限視同物料庫、半成品頁沿用菜單管理權限
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
