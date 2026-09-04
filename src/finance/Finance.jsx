// ── 財務內帳模組（獨立）──────────────────────────────────────────────────────
// 自成一格：自己載入/儲存資料（pm_fin_accounts / pm_fin_ledger，依目前空間前綴）。
// 核心觀念（照內帳藍圖）：帳戶(accounts) + 交易明細(ledger)，分開「資金流(轉帳)」與「費用(支出)」。
// 未來財務負責人接手開發，原則上只動這個資料夾，碰不到工程/總覽。
import { useState, useEffect, useMemo, useRef } from "react";
import { fmt } from "../lib/cost.js";
import { parseNum, blankZero, abNorm } from "../lib/num.js";
import { loadRecords, diffPersist, subscribeRecords } from "../lib/records.js";
import { onSharedChange } from "../supa.js";
import { useIsMobile } from "../lib/theme.jsx"; // 張良 2026-07-26 手機版全面體檢：RWD 斷點 hook

const C = { text: "#1d1a15", sub: "#5a5247", faint: "#9b9384", line: "#d9cfbd", soft: "#ece4d6", bg: "#f4efe5", card: "#FFFFFF", head: "#f4efe5", accent: "#3f7d4e", red: "#b3261e", blue: "#c4582a", amber: "#c98a14", brand: "#c4582a" };
const ACC_TYPES = [["bank", "銀行"], ["company", "公司帳戶"], ["cash", "現金"], ["petty", "零用金"], ["loan", "貸款"]];
const KINDS = [["expense", "支出", C.red], ["transfer", "轉帳", "#3E72A8"], ["income", "收入", C.accent]];
const typeLabel = (t) => (ACC_TYPES.find(x => x[0] === t) || [, "—"])[1];
const kindMeta = (k) => KINDS.find(x => x[0] === k) || KINDS[0];
const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 8px", fontSize: 13, background: "#fff", color: C.text, boxSizing: "border-box", outline: "none" };
const dateInp = { ...inp, colorScheme: "light", fontFamily: "'Noto Sans TC', sans-serif", cursor: "pointer" };
const rid = (p) => p + Math.random().toString(36).slice(2, 8);
const num = parseNum; // 共用解析（避免卡0）

// ── A Beach 品項明細細分類（張良 2026-08-19：要刪菜單、現場負荷不了，POS 分類太粗，要照湯/沙拉/開胃菜/麵/飯…細品類看排名）──
// Uber 外送分類（同品項的低價版，張良確認低價=Uber）：份數併進同名品項、另記「Uber」欄
const AB_UBER_CATS = new Set(["Pizza披薩", "主餐＆早午餐", "沙拉＆湯", "炸物＆前菜", "飲品"]);
// 非菜單分類：不進品項明細表（工具箱/包場/免招手/蛋糕/福利=服務性按鍵，不是餐點）
const AB_SKIP_CATS = new Set(["⚡️工具箱", "包場大訂", "免招手", "收蛋糕", "慶生沒蛋糕", "♥️福利♥️", "自訂食品", "總結", "套餐", "商品分類銷售分析"]);
const AB_FINE_ORDER = ["披薩", "排餐", "麵", "飯", "堡・早午餐", "沙拉", "開胃菜", "湯", "炸物", "甜點", "果昔", "茶飲", "咖啡", "熱茶", "調酒", "啤酒", "瓶裝酒"];
const AB_FINE_RULES = [ // 順序重要：特徵強的先比（長島冰茶→調酒不是茶飲、熱紅酒→調酒不是瓶裝酒、燉飯→飯不是開胃菜的青花）
  [/披薩/, "披薩"], [/燉飯/, "飯"], [/麵/, "麵"], [/牛排|肋眼|豬排/, "排餐"],
  [/塔可|漢堡|堡|早餐|法式吐司|班尼迪克|歐姆蛋|布里歐/, "堡・早午餐"], // 張良 2026-08-26：堡塔可＋早午餐併一類
  [/沙拉/, "沙拉"], [/湯/, "湯"], [/薯條|雞翅|生蠔|炸物|酥炸/, "炸物"],
  [/提拉米蘇|蛋糕|檸檬派/, "甜點"], [/果昔/, "果昔"], [/咖啡/, "咖啡"],
  [/莫西多|桑格利亞|長島|貝里斯|熱紅酒|鳥居|A ?Beach/i, "調酒"],
  [/洋甘菊|山楂|紅棗|蕎麥|國寶/, "熱茶"], [/奶茶|紅茶|綠茶|冰茶|檸檬水|氣泡飲|蘇打|烏龍/, "茶飲"],
  [/生啤|啤酒|艾爾|十八天/, "啤酒"], [/紅酒|白酒|氣泡酒|酒莊/, "瓶裝酒"],
  [/魷魚|節瓜|青花|烤餅|韃靼|脆片|鷹嘴豆/, "開胃菜"],
];
const abFineCat = (name) => (AB_FINE_RULES.find(([re]) => re.test(name)) || [, "其他"])[1];
// 「1/4 披薩」＝GROUN:D 試營運切片促銷（無單價、金額0）——張良 2026-08-26：全部畫面/統計都不要出現（原始資料保留，只是不顯示）
const isQuarterItem = (n) => /^1\/4/.test(String(n).trim());
// 同品項內用/Uber 名字只差 emoji（☘️瑪格麗特 vs 瑪格麗特）→ 去 emoji/空白後當同一鍵合併
// abNorm 已抽到 lib/num.js（2026-09-04）：供應鏈成本分析「同步成本」寫 pm_pos_costs 要用同一套 key 算法

// 預設會計科目樹（依張良的公司帳務表；可在「科目」頁自由增刪改）
function SEED_COA() {
  const tree = {
    "A營業收入": { "營業額": ["餐飲"], "包場": ["訂金", "尾款"], "外送": ["Uber", "Foodpanda", "Cutaway", "Inline", "Eztable", "FunNow", "Wemo", "FoodMarco", "社群平台", "悠遊卡公司"], "選物": ["餐具", "家具", "飾品"] },
    "F物料成本": { "內場": ["肉商", "雞肉", "海鮮", "烘焙", "菜商", "雜貨", "蛋商", "油商", "其他"], "吧台": ["啤酒", "基酒", "紅白酒", "牛奶", "咖啡", "水果", "雜貨", "其他"], "外場": ["包材", "備品", "其他"] },
    "L人事成本": { "薪資": ["正職", "PT"], "加班費": ["正職", "PT"], "獎金": ["正職", "PT"], "健保": [], "勞保": [], "勞退": [], "其他": ["資遣費", "招募獎金"], "季薪資": [], "未休特休": [] },
    "R租金成本": { "店租": ["思泊客"], "營登": ["悅鑽", "天成"] },
    "X營業成本": { "規費": ["水費", "電費", "網路電信", "刷卡手續費", "銀行手續費", "管理費"], "系統": ["POS", "訂位", "人資", "文書", "雲端", "音樂", "外送平台"], "會計": ["記帳", "代辦", "顧問"], "消毒": [], "垃圾": [], "維護": ["洗碗機", "廚具", "淨水器", "冰箱", "空調", "弱電", "消防", "公安", "電梯", "咖啡機", "靜電機"] },
    "T稅金成本": { "營所稅": [], "營業稅": [] },
    "Z其他成本": {}, "獎金": {}, "資金": {}, "合庫世貿": {}, "台企東湖": {}, "盈餘公積使用": {},
  };
  const out = []; let i = 0; const id = () => "coa" + (i++).toString(36) + Math.random().toString(36).slice(2, 5);
  for (const [l1, mids] of Object.entries(tree)) {
    const p1 = id(); out.push({ id: p1, name: l1, parentId: null });
    for (const [l2, leaves] of Object.entries(mids)) {
      const p2 = id(); out.push({ id: p2, name: l2, parentId: p1 });
      for (const leaf of leaves) out.push({ id: id(), name: leaf, parentId: p2 });
    }
  }
  return out;
}

export default function FinanceView({ view, K, confirm, canEdit, ReceiptUploader, onLog }) {
  // 張良 2026-07-26 手機版全面體檢：hook 只能在元件頂層呼叫一次（<640px 視為手機），下面各分頁共用
  const isMobile = useIsMobile(640);
  // 操作紀錄：逐筆敲字的編輯做節流（同訊息 8 秒內只記一次），新增/刪除/匯入等明確動作即時記
  const lastLog = useRef({});
  const logT = (action, detail, ms = 8000) => { if (!onLog) return; const now = Date.now(); if (lastLog.current[detail] && now - lastLog.current[detail] < ms) return; lastLog.current[detail] = now; onLog(action, detail); };
  // 分頁改由外層第二層導覽決定（財務報表攤平，不再有內部第三層）；view=fin_* 直接映射
  const tab = ({ fin_ov: "overview", fin_acct: "accounts", fin_ledger: "ledger", fin_coa: "coa", fin_recon: "recon", fin_pos: "pos" })[view] || "overview";
  const [accounts, setAccounts] = useState(null); // null=載入中
  const [ledger, setLedger] = useState(null);
  const [q, setQ] = useState(""); const [fKind, setFKind] = useState("all"); const [fAcc, setFAcc] = useState("all");
  const [sortDir, setSortDir] = useState(-1); // 日期 -1=新到舊
  const [imp, setImp] = useState(null); // 批量匯入面板（hook 一定要在提早 return 之前）
  const [coa, setCoa] = useState(null);  // 會計科目樹 [{id,name,parentId}]
  const [coaImp, setCoaImp] = useState(null); // 科目批量建立面板
  const [editLedId, setEditLedId] = useState(null); // 交易明細：檢視/編輯分離，只有這一列是輸入框
  // ── 對帳中心（試算表 × 工程付款 × 內帳）──
  const [sheet, setSheet] = useState(null);      // {syncedAt, rows[]}（試算表鏡像，退役中，只當匯入來源）
  const [bank, setBank] = useState(null);        // ★ 銀行帳務資料庫（永久、只增不改；一切對帳以此為基礎）
  const [manForm, setManForm] = useState(null);  // 手動新增一筆（未來：貼企業網銀截圖 AI 判讀）
  const [pos, setPos] = useState(null);          // Eats365 POS 日結資料庫（自動收信入庫）
  const [ctbc, setCtbc] = useState(null);        // 中信 e-Cash 匯款通知資料庫（自動收信入庫）
  const [reconAcct, setReconAcct] = useState("coop"); // 對帳帳戶切換：coop=合庫 / ctbc=中信
  const [posDet, setPosDet] = useState({});      // POS 明細（按月分檔 pm_pos_d_YYYY-MM：分類/商品/優惠券/付款）
  const [posTx, setPosTx] = useState({});        // POS 逐筆交易（按月分檔 pm_pos_tx_YYYY-MM；點下鑽才載入，不拖慢日常）
  const [posFlags, setPosFlags] = useState(null); // POS 日別標記（非營運：測試/包場/行銷）→ 警示與佔比排除；原始數字不動
  const [posFlagEdit, setPosFlagEdit] = useState(null); // 標記編輯小卡 {date, kind, type, note}
  const [posIdleCfg, setPosIdleCfg] = useState(null);   // 沒賣預警設定 {days, exCats[], exItems[]}——存 DB，DD 讀同一份（資料一致）
  const [posPeriod, setPosPeriod] = useState({ mode: "all", month: "", from: "", to: "" }); // 分析期間：全部 / 選月份 / 自訂（張良 2026-07-18）
  const [posDrill, setPosDrill] = useState(null); // 明細下鑽：{type, key} → 顯示組成該數字的原始資料
  const [posDrillView, setPosDrillView] = useState("list"); // 明細視角：list=清單 / pivot=品項×日期矩陣
  const [posDrillSort, setPosDrillSort] = useState(null);   // 明細排序：{i, dir}
  const [posSyncBusy, setPosSyncBusy] = useState(false);    // 營運手動更新中
  const [posMsg, setPosMsg] = useState(null);               // 營運更新結果提示
  const [posGran, setPosGran] = useState("day");            // 比較粒度：day/week/month
  const [posSlotDay, setPosSlotDay] = useState("all");      // 時段消費看哪天："all"=期間累計（張良 2026-08-27：要能看每天）
  const [posSlotGran, setPosSlotGran] = useState("hour");   // 時段粒度：hour=每小時 / half=半小時（快照推算，張良 2026-08-27：峰值要切半小時）
  const [posSlotHeat, setPosSlotHeat] = useState(false);    // 時段消費逐日熱力圖（張良 2026-09-01：一天一天切下拉太麻煩，要一眼看每時段逐日變化）
  const [posHH, setPosHH] = useState({});                   // 半小時快照月檔 pm_pos_hh_YYYY-MM：{days:{date:[{t,at,rev,tx}]}}
  const [posExt, setPosExt] = useState(null);               // 參考店1/2每日營業額 pm_ichef：{days:{date:{s1,s2}}}（畫面只標1/2，張良 2026-09-01）
  const [abLive, setAbLive] = useState(null);               // AB 今天即時 pm_ablive：{date,revenue,tx,at}（Eats365 後台抓的，張良 2026-09-02）
  const [posStore, setPosStore] = useState("abeach");       // 分店切換：abeach=A Beach 101 / ground=GROUN:D（營運報表第三層）
  const [posCats, setPosCats] = useState([]);               // 標籤自選：選到的分類做比較（空＝全部）
  const [gdTab, setGdTab] = useState("全部");               // GROUN:D 品項明細：品類籤（張良 2026-08-14 指定試營運儀表板版型）
  const [gdGroup, setGdGroup] = useState(true);             // GROUN:D 品項明細：依品類分組（品類列帶每日總份數）
  const [gdSort, setGdSort] = useState(null);               // GROUN:D 品項明細：排序欄（日期 or "cum"；預設最新一天）
  const [gdIdle, setGdIdle] = useState(false);              // 品項明細：只看 7天+沒賣（取代原本佔版面的「沒賣預警」大區塊，張良 2026-08-19）
  const [gdCost, setGdCost] = useState(false);              // 品項明細：填成本模式（張良 2026-08-28：每品項成本→總成本/每天毛利）
  const [gdCostDetail, setGdCostDetail] = useState(false);  // 期間彙總：成本明細下鑽（張良 2026-08-28：成本率46%？我需要看到畫面——每品項吃掉多少成本）
  const [posCosts, setPosCosts] = useState({});             // 品項成本主檔 {abeach:{品項key:成本}, ground:{…}}——存 DB 一份，兩店分開
  const [posPrices, setPosPrices] = useState({});           // 品項定價手動覆寫 {abeach:{品項key:定價}, ground:{…}}——手填優先於自動還原；0＝不顯示（張良 2026-08-28）
  const [posPivotCats, setPosPivotCats] = useState(null);   // 矩陣內分類勾選（null=全選）
  const [posPivotSort, setPosPivotSort] = useState(null);   // 矩陣排序 {col, dir}
  const [recon, setRecon] = useState({ links: {}, ignored: [] }); // 補記/忽略標記
  const [conCats, setConCats] = useState([]);    // 工程專案大項（唯讀跨空間）
  const [conPetty, setConPetty] = useState({ spends: [] });
  const [syncBusy, setSyncBusy] = useState(false);
  const [showMatched, setShowMatched] = useState(false);
  const [showMirror, setShowMirror] = useState(false);
  const [reconOnlyOpen, setReconOnlyOpen] = useState(false); // 預設「全部」：對帳狀態欄常駐可見，不會消失
  const [reconMsg, setReconMsg] = useState(null); // 補記後的去向提示
  const [reconQ, setReconQ] = useState("");        // 對帳單搜尋
  const [reconCat, setReconCat] = useState("");    // 類別標籤篩選
  const flashRecon = (text) => { setReconMsg(text); setTimeout(() => setReconMsg(m => m === text ? null : m), 8000); };

  // 交易明細逐筆存（2026-07-18）：一筆交易＝一份文件 pm_fin_tx_<id>，兩人同時記帳不再整包互蓋；
  // 舊整包 pm_fin_ledger 第一次載入自動遷移。persistedRef＝上次已存清單（差異寫入的比對基準）。
  const persistedLed = useRef([]);
  const ledgerConf = () => ({ markerKey: K("pm_fin_ledger_v2"), prefix: K("pm_fin_tx_"), legacyKey: K("pm_fin_ledger") });
  useEffect(() => { (async () => {
    try { const a = await window.storage.get(K("pm_fin_accounts"), true); setAccounts(a && a.value ? JSON.parse(a.value) : []); } catch { setAccounts([]); }
    try { const list = await loadRecords({ ...ledgerConf(), sortBy: (a, b) => ((a.date || "") < (b.date || "") ? 1 : -1) }); persistedLed.current = list; setLedger(list); } catch { setLedger([]); }
    try { const c = await window.storage.get(K("pm_fin_coa"), true); const v = c && c.value ? JSON.parse(c.value) : null; setCoa(Array.isArray(v) && v.length ? v : SEED_COA()); } catch { setCoa(SEED_COA()); }
    // 對帳資料：試算表鏡像 + 對帳標記 + 工程專案（跨空間唯讀，絕不寫回）
    try { const sh = await window.storage.get(K("pm_sheet"), true); setSheet(sh && sh.value ? JSON.parse(sh.value) : null); } catch (_) {}
    try { const bk = await window.storage.get(K("pm_bank"), true); setBank(bk && bk.value ? JSON.parse(bk.value) : null); } catch (_) {}
    try { const ps = await window.storage.get(K("pm_pos"), true); setPos(ps && ps.value ? JSON.parse(ps.value) : null); } catch (_) {}
    try { const ct = await window.storage.get(K("pm_ctbc"), true); setCtbc(ct && ct.value ? JSON.parse(ct.value) : null); } catch (_) {}
    try { const fl = await window.storage.get(K("pm_pos_flags"), true); setPosFlags(fl && fl.value ? JSON.parse(fl.value) : { items: {} }); } catch (_) { setPosFlags({ items: {} }); }
    try { const pc = await window.storage.get(K("pm_pos_costs"), true); setPosCosts(pc && pc.value ? JSON.parse(pc.value) : {}); } catch (_) { setPosCosts({}); }
    try { const pp = await window.storage.get(K("pm_pos_prices"), true); setPosPrices(pp && pp.value ? JSON.parse(pp.value) : {}); } catch (_) { setPosPrices({}); }
    try { const ic = await window.storage.get(K("pm_pos_idlecfg"), true); setPosIdleCfg(ic && ic.value ? JSON.parse(ic.value) : { days: 7, exCats: [], exItems: [] }); } catch (_) { setPosIdleCfg({ days: 7, exCats: [], exItems: [] }); }
    try { const ie = await window.storage.get(K("pm_ichef"), true); setPosExt(ie && ie.value ? JSON.parse(ie.value) : null); } catch (_) {}
    try { const al = await window.storage.get(K("pm_ablive"), true); setAbLive(al && al.value ? JSON.parse(al.value) : null); } catch (_) {}
    try { const rc = await window.storage.get(K("pm_recon"), true); const v = rc && rc.value ? JSON.parse(rc.value) : null; if (v) setRecon({ links: v.links || {}, ignored: v.ignored || [] }); } catch (_) {}
    try { const cd = await window.storage.get("pm_data", true); setConCats(cd && cd.value ? JSON.parse(cd.value) : []); } catch (_) {}
    try { const pt = await window.storage.get("pm_petty", true); const v = pt && pt.value ? JSON.parse(pt.value) : {}; setConPetty({ spends: v.spends || [] }); } catch (_) {}
  })(); }, []); // eslint-disable-line
  useEffect(() => { (async () => {
    if (!pos?.entries?.length) return;
    const months = [...new Set(pos.entries.map(e => (e.date || "").slice(0, 7)).filter(Boolean))].slice(-4);
    const out = {};
    for (const mo of months) { try { const d = await window.storage.get(K("pm_pos_d_" + mo), true); if (d && d.value) out[mo] = JSON.parse(d.value); } catch (_) {} }
    setPosDet(out);
    // 半小時快照月檔（時段圖切半小時用；沒有就是空物件，圖上會提示從何時開始累積）
    const outHH = {};
    for (const mo of months) { try { const d = await window.storage.get(K("pm_pos_hh_" + mo), true); if (d && d.value) outHH[mo] = JSON.parse(d.value); } catch (_) {} }
    setPosHH(outHH);
  })(); }, [pos]); // eslint-disable-line
  // 逐筆交易月檔：開「逐筆交易」下鑽才抓那個月（有檔=不重抓；上次抓到空＝每次點都再試一次，後端剛回補完不用重新整理頁面）
  useEffect(() => { (async () => {
    const mo = posDrill?.type === "tx" ? String(posDrill.key || "").slice(0, 7) : null;
    if (!mo || posTx[mo]) return;
    try { const d = await window.storage.get(K("pm_pos_tx_" + mo), true); setPosTx(p => ({ ...p, [mo]: d && d.value ? JSON.parse(d.value) : null })); }
    catch (_) { setPosTx(p => ({ ...p, [mo]: null })); }
  })(); }, [posDrill]); // eslint-disable-line
  // 即時同步：別台記的帳/改的帳戶 → 這裡畫面即時跟上（自己這台寫的不會收到）
  useEffect(() => {
    const un1 = subscribeRecords(K("pm_fin_tx_"), (id, tx) => {
      persistedLed.current = tx ? [tx, ...persistedLed.current.filter(l => l.id !== id)] : persistedLed.current.filter(l => l.id !== id);
      setLedger(prev => prev == null ? prev : (tx ? [tx, ...prev.filter(l => l.id !== id)] : prev.filter(l => l.id !== id)));
    });
    const un2 = onSharedChange(K("pm_fin_accounts"), (_k, v) => { try { setAccounts(v ? JSON.parse(v) : []); } catch (_) {} });
    // 後台收信入庫（POS 日結信/中信匯款通知）也會廣播 → 開著的營運報表/對帳頁自動跳新資料，
    // 不用手動按「🔄 更新」或重新整理（張良 2026-08-14）。pm_pos 一變，明細月檔會由上面的 [pos] effect 自動重抓。
    const un3 = onSharedChange(K("pm_pos"), (_k, v) => { try { setPos(v ? JSON.parse(v) : null); const t = "✓ 收到新日結信，畫面已自動更新"; setPosMsg(t); setTimeout(() => setPosMsg(m => m === t ? null : m), 8000); } catch (_) {} });
    const un4 = onSharedChange(K("pm_pos_tx_") + "*", (k, v) => { try { const mo = k.slice(-7); setPosTx(p => (mo in p) ? { ...p, [mo]: v ? JSON.parse(v) : null } : p); } catch (_) {} });
    const un5 = onSharedChange(K("pm_ctbc"), (_k, v) => { try { setCtbc(v ? JSON.parse(v) : null); } catch (_) {} });
    // 明細月檔單獨更新（例：只補明細不動摘要的維護寫入）也要即時跟上——品項明細/分類表不用重新整理（張良 2026-08-14）
    const un6 = onSharedChange(K("pm_pos_d_") + "*", (k, v) => { try { const mo = k.slice(-7); if (v) setPosDet(p => ({ ...p, [mo]: JSON.parse(v) })); } catch (_) {} });
    const un7 = onSharedChange(K("pm_pos_flags"), (_k, v) => { try { setPosFlags(v ? JSON.parse(v) : { items: {} }); } catch (_) {} });
    // 半小時快照入庫也即時跟上（盤中每半小時記一筆——時段圖開著就自己長出新的半小時格）
    const un8 = onSharedChange(K("pm_pos_hh_") + "*", (k, v) => { try { const mo = k.slice(-7); if (v) setPosHH(p => ({ ...p, [mo]: JSON.parse(v) })); } catch (_) {} });
    const un9 = onSharedChange(K("pm_pos_costs"), (_k, v) => { try { setPosCosts(v ? JSON.parse(v) : {}); } catch (_) {} });
    const un10 = onSharedChange(K("pm_pos_prices"), (_k, v) => { try { setPosPrices(v ? JSON.parse(v) : {}); } catch (_) {} });
    const un11 = onSharedChange(K("pm_ichef"), (_k, v) => { try { setPosExt(v ? JSON.parse(v) : null); } catch (_) {} });
    const un12 = onSharedChange(K("pm_ablive"), (_k, v) => { try { setAbLive(v ? JSON.parse(v) : null); } catch (_) {} });
    return () => { un1(); un2(); un3(); un4(); un5(); un6(); un7(); un8(); un9(); un10(); un11(); un12(); };
  }, []); // eslint-disable-line
  const saveRecon = (next) => { setRecon(next); window.storage.set(K("pm_recon"), JSON.stringify(next), true).catch(() => {}); };
  // 品項成本存檔（防抖在 storage 墊片層；廣播讓別台/別分頁即時跟上）
  const saveCost = (storeKey, itemKey, val) => {
    setPosCosts(prev => {
      const next = { ...prev, [storeKey]: { ...(prev[storeKey] || {}) } };
      if (val == null || val === "" || !(Number(val) > 0)) delete next[storeKey][itemKey]; else next[storeKey][itemKey] = Number(val);
      window.storage.set(K("pm_pos_costs"), JSON.stringify(next), true).catch(() => {});
      return next;
    });
  };
  // 品項定價覆寫存檔：清空＝回自動還原；0＝這品項不顯示價格（跟成本不同，0 要留著）
  const savePrice = (storeKey, itemKey, val) => {
    setPosPrices(prev => {
      const next = { ...prev, [storeKey]: { ...(prev[storeKey] || {}) } };
      const n = Number(val);
      if (val == null || val === "" || isNaN(n) || n < 0) delete next[storeKey][itemKey]; else next[storeKey][itemKey] = n;
      window.storage.set(K("pm_pos_prices"), JSON.stringify(next), true).catch(() => {});
      return next;
    });
  };
  const saveBank = (next) => { setBank(next); window.storage.set(K("pm_bank"), JSON.stringify(next), true).catch(() => {}); };
  // 營運「更新」：mail 到了就手動抓（打烊信一到按一下即上）
  const runPosSync = async () => {
    setPosSyncBusy(true);
    try {
      // 盤中即時（張良 2026-08-27：按更新要立刻反應）：先抓喬亞「現在」的今天數字（後端 3 分鐘冷卻、非營業時間自動略過），再照舊檢查信箱
      let live = null;
      try { const lr = await fetch("/api/joya-intraday?manual=1"); live = await lr.json(); } catch (_) {}
      const r = await fetch("/api/mail-sync?days=2"); const d = await r.json();
      const ps = await window.storage.get(K("pm_pos"), true); setPos(ps && ps.value ? JSON.parse(ps.value) : null);
      const parts = [];
      if (live?.updated) parts.push(`盤中已更新到 ${live.taipei}：今天 NT$${(Number(live.revenue) || 0).toLocaleString()}・${live.txCount} 單`);
      else if (live?.skipped && /剛更新過/.test(live.skipped)) parts.push(`盤中${live.skipped}`);
      if (d?.ic && !d.ic.error) parts.push("1/2 已同步到現在"); // 參考店即時（iCHEF 後台數字本來就是「到目前為止」）
      if (d?.ab?.revenue != null) parts.push(`AB 即時 NT$${Number(d.ab.revenue).toLocaleString()}・${d.ab.tx} 單`);
      else if (d?.ab?.error) parts.push(`AB 即時失敗：${d.ab.error}`);
      if (d?.pos?.added) parts.push(`新入庫 ${d.pos.added} 天日結`);
      const t = parts.length ? "✓ " + parts.join("；") : "✓ 已檢查——沒有新資料（目前已是最新）";
      setPosMsg(t); setTimeout(() => setPosMsg(m => m === t ? null : m), 8000);
    } catch (e) { setPosMsg("更新失敗：" + e.message); }
    setPosSyncBusy(false);
  };
  // 手動匯入舊日結（張良 2026-07-30：信箱 7/12 才開通，7/1-11 從 POS 後台下載的報表補進來）
  // 解析器＝api/_pos-parse.js 與收信同一套（動態載入，不拖慢平常開頁）；規則同收信：只增不改、全零不入庫、日期+店去重
  const importPosFiles = async (files) => {
    setPosSyncBusy(true);
    try {
      const mod = await import("../../api/_pos-parse.js");
      const skOf = (n) => /groun/i.test(n || "") ? "ground" : "abeach";
      const store = pos && Array.isArray(pos.entries) ? { ...pos, entries: [...pos.entries] } : { name: "Eats365 POS 日結", entries: [] };
      const haveCombo = new Set(store.entries.map(e => (e.date || "") + "|" + skOf(e.store)));
      let added = 0, dup = 0, zero = 0, txAdded = 0, bad = 0;
      const byMonth = {}, txByMonth = {};
      for (const f of files) {
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          if (/^transaction/i.test(f.name.trim())) {
            // 逐筆交易檔：日期取自檔名（Transaction (2026-07-05 ...).xls）
            const tx = mod.parseTxSheet(buf, "array");
            const dm = f.name.match(/(\d{4}-\d{2}-\d{2})/);
            if (tx && dm) (txByMonth[dm[1].slice(0, 7)] = txByMonth[dm[1].slice(0, 7)] || []).push({ date: dm[1], tx }); else bad++;
            continue;
          }
          const rec = mod.parsePosWorkbook(buf, f.name, "array");
          if (!rec.date) { bad++; continue; }
          if ((Number(rec.revenue) || 0) <= 0 && (Number(rec.txCount) || 0) <= 0) { zero++; continue; }
          const sk = skOf(rec.store);
          if (haveCombo.has(rec.date + "|" + sk)) { dup++; continue; }
          haveCombo.add(rec.date + "|" + sk);
          const { _details, ...summary } = rec;
          summary.id = rec.id + "-" + sk; summary.source = "manual";
          store.entries.push(summary); added++;
          if (_details) (byMonth[rec.date.slice(0, 7)] = byMonth[rec.date.slice(0, 7)] || []).push({ date: rec.date, period: rec.period, store: rec.store, sheets: _details });
        } catch (_) { bad++; }
      }
      if (added) {
        store.entries.sort((a, b) => (a.date < b.date ? -1 : 1)); store.updatedAt = new Date().toISOString();
        await window.storage.set(K("pm_pos"), JSON.stringify(store), true);
        for (const [mo, recs] of Object.entries(byMonth)) {
          const cur = await window.storage.get(K("pm_pos_d_" + mo), true);
          const doc = cur && cur.value ? JSON.parse(cur.value) : { days: {} };
          for (const r of recs) { const dk = r.date + "::" + skOf(r.store); const legacy = doc.days[r.date] && skOf(doc.days[r.date].store) === skOf(r.store); if (!doc.days[dk] && !legacy) doc.days[dk] = r; }
          doc.updatedAt = new Date().toISOString();
          await window.storage.set(K("pm_pos_d_" + mo), JSON.stringify(doc), true);
        }
        setPos(store); // posDet 會跟著 [pos] effect 重載，畫面即刻有 7/1-11
      }
      for (const [mo, recs] of Object.entries(txByMonth)) {
        const cur = await window.storage.get(K("pm_pos_tx_" + mo), true);
        const doc = cur && cur.value ? JSON.parse(cur.value) : { days: {} };
        let ch = false;
        for (const r of recs) { const dk = r.date + "::" + posStore; if (!doc.days[dk]) { doc.days[dk] = { date: r.date, store: posStore === "ground" ? "GROUN:D" : "A Beach 101&Pizza", tx: r.tx }; ch = true; txAdded++; } }
        if (ch) { doc.updatedAt = new Date().toISOString(); await window.storage.set(K("pm_pos_tx_" + mo), JSON.stringify(doc), true); setPosTx(p => ({ ...p, [mo]: doc })); }
      }
      const t = `📥 匯入完成：日結 ${added} 天${txAdded ? `、逐筆交易 ${txAdded} 天` : ""}${dup ? `・略過已存在 ${dup}` : ""}${zero ? `・略過無營收 ${zero}（颱風/店休本來就會空白）` : ""}${bad ? `・讀不懂 ${bad} 個檔` : ""}`;
      setPosMsg(t); setTimeout(() => setPosMsg(m => m === t ? null : m), 15000);
    } catch (e) { setPosMsg("匯入失敗：" + (e?.message || e)); }
    setPosSyncBusy(false);
  };
  const mergeToBank = (rows, srcLabel) => {
    // 資料庫鐵則：只增不改——已存在的列一律不動，僅加入新列
    const cur = bank || { account: "合作金庫 · 喬亞國際餐飲", entries: [] };
    const have = new Set((cur.entries || []).map(e => e.id));
    const add = rows.filter(x => !have.has(x.id)).map(x => ({ ...x, source: x.source || srcLabel, importedAt: new Date().toISOString().slice(0, 10) }));
    const next = { ...cur, entries: [...(cur.entries || []), ...add], updatedAt: new Date().toISOString() };
    saveBank(next);
    return add.length;
  };
  const runSync = async () => {
    setSyncBusy(true);
    try {
      const r = await fetch("/api/sheet-sync"); const d = await r.json();
      if (!d.ok) alert("匯入失敗：" + (d.error || "未知"));
      else {
        const sh = await window.storage.get(K("pm_sheet"), true);
        const parsed = sh && sh.value ? JSON.parse(sh.value) : null;
        setSheet(parsed);
        const n = mergeToBank(parsed?.rows || [], "sheet");
        onLog?.("編輯", `試算表匯入銀行資料庫（新增 ${n} 筆）`);
        flashRecon(n ? `✓ 從試算表匯入 ${n} 筆新資料進資料庫（既有資料一筆未動）` : "✓ 沒有新資料——資料庫已是最新");
      }
    } catch (e) { alert("匯入失敗：" + e.message); }
    setSyncBusy(false);
  };
  const guard = () => { if (!canEdit) { alert("沒有編輯權限，請聯絡管理員。"); return false; } return true; };
  const saveAcc = (list) => { setAccounts(list); window.storage.set(K("pm_fin_accounts"), JSON.stringify(list), true).catch(() => {}); };
  // 逐筆存：跟上次已存清單比差異，只寫有變動的那幾筆（新增/編輯/刪除各只動自己那份文件）
  const saveLed = (list) => { setLedger(list); persistedLed.current = diffPersist({ prefix: K("pm_fin_tx_"), prevList: persistedLed.current, nextList: list }); };
  const saveCoa = (list) => { if (!guard()) return; setCoa(list); window.storage.set(K("pm_fin_coa"), JSON.stringify(list), true).catch(() => {}); };
  // 科目樹工具
  const coaChildren = (pid) => (coa || []).filter(c => (c.parentId || null) === (pid || null));
  const coaPath = (id) => { const out = []; let n = (coa || []).find(c => c.id === id); let g = 0; while (n && g++ < 6) { out.unshift(n.name); n = (coa || []).find(c => c.id === n.parentId); } return out.join(" / "); };
  const coaFlat = () => { const out = []; const walk = (pid, depth) => coaChildren(pid).forEach(n => { out.push({ id: n.id, name: n.name, depth }); walk(n.id, depth + 1); }); walk(null, 0); return out; };

  const accName = (id) => accounts?.find(a => a.id === id)?.name || (id ? "(已刪帳戶)" : "—");
  const balanceOf = (id) => {
    let b = num(accounts?.find(a => a.id === id)?.opening);
    (ledger || []).forEach(l => { const amt = num(l.amount); if (l.to === id) b += amt; if (l.from === id) b -= amt; });
    return b;
  };

  // ── 批量匯入：貼上(Tab分隔)→欄位對應→預覽驗證→餘額對帳→入帳 ──
  const normDate = (v) => { const s = String(v ?? "").replace(/\//g, "-").trim(); const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : ""; };
  const kindFrom = (s) => { s = String(s || ""); if (/收入|收款|入帳|營收/.test(s)) return "income"; if (/轉帳|轉出|轉入|互轉/.test(s)) return "transfer"; return "expense"; };
  const parsePaste = (text, hasHeader) => {
    const lines = (text || "").split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return null;
    const rows = lines.map(l => (l.includes("\t") ? l.split("\t") : l.split(/ {2,}|,/)).map(c => c.trim()));
    const n = Math.max(...rows.map(r => r.length));
    const headers = hasHeader ? rows[0] : Array.from({ length: n }, (_, i) => `第${i + 1}欄`);
    return { headers, rows: hasHeader ? rows.slice(1) : rows };
  };
  const guessMap = (headers) => { const f = (kws) => headers.findIndex(h => kws.some(k => h.includes(k))); return { date: f(["日期", "日"]), amount: f(["金額", "支出", "付款金額", "付款額"]), kind: f(["類型", "收支"]), vendor: f(["廠商", "對象", "收款", "匯款人"]), category: f(["科目", "大項", "類別", "項目內容", "項目"]), note: f(["備註", "說明", "內容"]) }; };
  const buildPreview = (parsed, map, accId, defKind) => {
    const valid = [], invalid = [];
    const cellOf = (r, k) => (map[k] != null && map[k] >= 0) ? (r[map[k]] || "") : "";
    parsed.rows.forEach((r, i) => {
      const amount = Math.abs(parseNum(cellOf(r, "amount")));
      if (!amount) { invalid.push({ i: i + 1, reason: "金額空白/非數字", raw: r.filter(Boolean).join(" | ").slice(0, 50) }); return; }
      const kind = (map.kind >= 0 && cellOf(r, "kind")) ? kindFrom(cellOf(r, "kind")) : defKind;
      valid.push({ id: rid("tx"), date: normDate(cellOf(r, "date")), kind, amount, from: kind === "income" ? "" : accId, to: kind === "income" ? accId : "", category: cellOf(r, "category"), vendor: cellOf(r, "vendor"), invoiceNo: "", note: cellOf(r, "note"), receipts: [] });
    });
    return { valid, invalid };
  };
  const projectedBalance = () => {
    if (!imp?.preview || !imp.account) return null;
    return imp.preview.valid.reduce((s, e) => s + (e.to === imp.account ? num(e.amount) : e.from === imp.account ? -num(e.amount) : 0), balanceOf(imp.account));
  };

  // ── 帳戶 CRUD ──
  const addAcc = () => { if (!guard()) return; onLog?.("新增", "新增財務帳戶"); saveAcc([...(accounts || []), { id: rid("acc"), name: "", type: "bank", opening: 0, note: "", active: true }]); };
  const updAcc = (id, k, v) => { logT("編輯", "編輯財務帳戶"); saveAcc(accounts.map(a => a.id === id ? { ...a, [k]: v } : a)); };
  const delAcc = async (a) => { if (!guard()) return; const used = (ledger || []).some(l => l.from === a.id || l.to === a.id); if (!(await confirm(`刪除帳戶「${a.name || "未命名"}」？${used ? "（仍有交易用到它，刪後那些交易會標示「已刪帳戶」）" : ""}`, { confirmLabel: "刪除" }))) return; onLog?.("刪除", `刪除財務帳戶「${a.name || "未命名"}」`); saveAcc(accounts.filter(x => x.id !== a.id)); };

  // ── 交易 CRUD ──
  const addLed = () => { if (!guard()) return; onLog?.("新增", "新增財務交易"); const nid = rid("tx"); setEditLedId(nid); saveLed([{ id: nid, date: "", kind: "expense", amount: 0, from: accounts[0]?.id || "", to: "", category: "", vendor: "", invoiceNo: "", note: "", receipts: [] }, ...ledger]); };
  const updLed = (id, k, v) => { logT("編輯", "編輯財務交易"); saveLed(ledger.map(l => l.id === id ? { ...l, [k]: v } : l)); };
  const delLed = async (l) => { if (!guard()) return; if (!(await confirm(`刪除這筆交易（${fmt(num(l.amount))}）？`, { confirmLabel: "刪除" }))) return; onLog?.("刪除", `刪除財務交易 ${fmt(num(l.amount))}${l.vendor ? "（" + l.vendor + "）" : ""}`); saveLed(ledger.filter(x => x.id !== l.id)); };

  // useMemo 必須在任何提早 return 之前（hooks 規則）；對 null 安全
  const rows = useMemo(() => {
    let r = (ledger || []).filter(l => (fKind === "all" || l.kind === fKind) && (fAcc === "all" || l.from === fAcc || l.to === fAcc) && (!q.trim() || (l.vendor + l.category + l.note + l.invoiceNo + accName(l.from) + accName(l.to)).toLowerCase().includes(q.trim().toLowerCase())));
    r = [...r].sort((a, b) => ((a.date || "") < (b.date || "") ? -1 : (a.date || "") > (b.date || "") ? 1 : 0) * sortDir);
    return r;
  }, [ledger, fKind, fAcc, q, sortDir, accounts]); // eslint-disable-line
  const filteredSum = rows.reduce((s, l) => s + num(l.amount), 0);

  // 所有 hooks 都呼叫完了，這裡才可以提早 return
  if (accounts === null || ledger === null || coa === null) return <div style={{ padding: 40, textAlign: "center", color: C.faint }}>載入中…</div>;

  return (
    <div style={{ maxWidth: 1240, margin: "8px auto", padding: "0 4px" }}>

      {tab === "overview" && (() => {
        const groups = { 資產: accounts.filter(a => ["bank", "company", "cash", "petty"].includes(a.type)), 貸款: accounts.filter(a => a.type === "loan") };
        const assets = groups.資產.reduce((s, a) => s + balanceOf(a.id), 0);
        const loans = groups.貸款.reduce((s, a) => s + balanceOf(a.id), 0);
        const totalIn = ledger.filter(l => l.kind === "income").reduce((s, l) => s + num(l.amount), 0);
        const totalExp = ledger.filter(l => l.kind === "expense").reduce((s, l) => s + num(l.amount), 0);
        const accColor = (t) => t === "loan" ? C.red : (t === "cash" || t === "petty") ? C.amber : C.blue;
        const card = (label, val, color) => <div style={{ flex: "1 1 200px", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 18px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}><div style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", letterSpacing: -0.5, marginTop: 2 }}>{fmt(val)}</div></div>;
        return (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              {card("資產餘額合計", assets, C.accent)}
              {card("貸款餘額（欠款）", loans, C.red)}
              {card("淨額（資產−欠款）", assets + loans, C.text)}
            </div>
            <div style={{ marginBottom: 18, fontSize: 12.5, color: C.sub }}>本表累計：收入 <b style={{ color: C.accent }}>{fmt(totalIn)}</b>・支出 <b style={{ color: C.red }}>{fmt(totalExp)}</b></div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>各帳戶餘額</div>
            {accounts.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: C.faint }}>還沒有帳戶，去「🏦 帳戶」新增銀行/貸款/現金帳戶。</div> :
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
                {accounts.map(a => { const b = balanceOf(a.id); return (
                  <div key={a.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px 12px 16px", position: "relative", overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,.03)" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: accColor(a.type) }} />
                    <div style={{ fontSize: 11, color: accColor(a.type), fontWeight: 700 }}>{typeLabel(a.type)}</div>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name || "未命名帳戶"}</div>
                    <div style={{ fontSize: 21, fontWeight: 800, color: b < 0 ? C.red : C.text, fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>{fmt(b)}</div>
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>期初 {fmt(num(a.opening))}</div>
                  </div>
                ); })}
              </div>}
          </div>
        );
      })()}

      {tab === "accounts" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button onClick={addAcc} style={{ background: "#b5512b", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增帳戶</button>
          </div>
          {accounts.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: C.faint }}>還沒有帳戶。新增銀行、貸款、現金、零用金等帳戶，設定期初餘額。</div> :
            <div style={{ display: "grid", gap: 8 }}>
              {/* 張良 2026-07-26 手機版全面體檢：手機改直向堆疊（欄位各佔一行 100%），桌機維持橫排不變 */}
              {accounts.map(a => (
                <div key={a.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, display: "flex", gap: 8, alignItems: isMobile ? "stretch" : "center", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" }}>
                  <select value={a.type} onChange={e => updAcc(a.id, "type", e.target.value)} style={{ ...inp, width: isMobile ? "100%" : 110 }}>{ACC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  <input value={a.name} onChange={e => updAcc(a.id, "name", e.target.value)} placeholder="帳戶名稱（例：合庫商銀 ***244）" style={{ ...inp, ...(isMobile ? { width: "100%" } : { flex: 1, minWidth: 180 }) }} />
                  <label style={{ fontSize: 12, color: C.sub, ...(isMobile ? { display: "flex", alignItems: "center", gap: 6, width: "100%" } : {}) }}>期初 <input value={blankZero(a.opening)} onChange={e => updAcc(a.id, "opening", num(e.target.value))} type="number" placeholder="0" style={{ ...inp, ...(isMobile ? { flex: 1, width: "auto" } : { width: 120 }), fontFamily: "monospace" }} /></label>
                  <div style={{ fontSize: 13, color: balanceOf(a.id) < 0 ? C.red : C.accent, fontWeight: 700, fontVariantNumeric: "tabular-nums", ...(isMobile ? { width: "100%" } : { minWidth: 110 }), textAlign: "right" }}>餘 {fmt(balanceOf(a.id))}</div>
                  <button onClick={() => delAcc(a)} title="刪除" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 18, ...(isMobile ? { alignSelf: "flex-end", padding: "2px 8px" } : {}) }}>×</button>
                </div>
              ))}
            </div>}
        </div>
      )}

      {tab === "coa" && (() => {
        const depthName = (d) => ["大項", "中項", "細項", "子項"][d] || "子項";
        const descIds = (id) => { const acc = [id]; const walk = (p) => coaChildren(p).forEach(c => { acc.push(c.id); walk(c.id); }); walk(id); return acc; };
        const addTop = () => { onLog?.("新增", "新增會計科目大項"); saveCoa([...coa, { id: "coa" + rid(""), name: "新大項", parentId: null }]); };
        const addChild = (pid) => { onLog?.("新增", "新增會計科目"); saveCoa([...coa, { id: "coa" + rid(""), name: "新項目", parentId: pid }]); };
        const renameNode = (id, name) => { logT("編輯", "編輯會計科目"); saveCoa(coa.map(c => c.id === id ? { ...c, name } : c)); };
        const delNode = async (node) => { const ids = new Set(descIds(node.id)); const used = ledger.filter(l => ids.has(l.catId)).length; if (!(await confirm(`刪除「${node.name}」${ids.size > 1 ? `及其 ${ids.size - 1} 個子科目` : ""}？${used ? `（有 ${used} 筆交易用到，刪後那些交易的科目會清空）` : ""}`, { confirmLabel: "刪除" }))) return; if (!guard()) return; onLog?.("刪除", `刪除會計科目「${node.name}」`); setCoa(coa.filter(c => !ids.has(c.id))); window.storage.set(K("pm_fin_coa"), JSON.stringify(coa.filter(c => !ids.has(c.id))), true).catch(() => {}); };
        const NodeRow = (node, depth) => {
          const kids = coaChildren(node.id);
          const tint = depth === 0 ? "#2C5A8C" : depth === 1 ? C.brand : C.sub;
          return (
            <div key={node.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", paddingLeft: depth * 22 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: tint, width: 30, flexShrink: 0 }}>{depthName(depth)}</span>
                <input value={node.name} onChange={e => renameNode(node.id, e.target.value)} style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: "5px 8px", fontSize: 13, fontWeight: depth === 0 ? 700 : depth === 1 ? 600 : 400, color: C.text, width: 220, background: C.card }} />
                {depth < 3 && <button onClick={() => addChild(node.id)} title="新增子科目" style={{ border: `1px solid ${C.line}`, background: C.card, color: C.sub, borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer" }}>＋子科目</button>}
                <button onClick={() => delNode(node)} title="刪除" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 16 }} onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = C.faint}>×</button>
              </div>
              {kids.map(k => NodeRow(k, depth + 1))}
            </div>
          );
        };
        const tops = coaChildren(null);
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: C.sub }}>會計科目分層（大項 → 中項 → 細項），交易明細的「科目」會跟著這裡的樹連動。</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setCoaImp({ text: "" })} style={{ background: C.card, color: C.brand, border: `1px solid ${C.brand}`, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>📋 批量建立</button>
              <button onClick={addTop} style={{ background: C.brand, color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增大項</button>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
              {tops.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: C.faint }}>還沒有科目，點「＋ 新增大項」或「📋 批量建立」。</div> : tops.map(n => NodeRow(n, 0))}
            </div>
            {coaImp && (
              <div onClick={e => e.target === e.currentTarget && setCoaImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "min(620px,96vw)", maxHeight: "88vh", overflowY: "auto" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}><div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>📋 批量建立科目</div><div style={{ flex: 1 }} /><button onClick={() => setCoaImp(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button></div>
                  <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 8, lineHeight: 1.7 }}>每列一筆，用 <b>Tab 或逗號</b>分隔「大項　中項　細項」。空白欄略過。例：<br /><code style={{ fontSize: 11 }}>F物料成本　內場　肉商</code>。會自動建立/沿用相同的大項、中項。</div>
                  <textarea value={coaImp.text} onChange={e => setCoaImp({ text: e.target.value })} rows={9} placeholder={"F物料成本\t內場\t肉商\nF物料成本\t吧台\t啤酒\nX營業成本\t規費\t水費"} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "monospace" }} />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <button onClick={() => {
                      const next = [...coa];
                      const findOrAdd = (name, parentId) => { if (!name) return parentId; let n = next.find(c => c.name === name && (c.parentId || null) === (parentId || null)); if (!n) { n = { id: "coa" + rid(""), name, parentId: parentId || null }; next.push(n); } return n.id; };
                      (coaImp.text || "").split(/\r?\n/).forEach(line => { if (!line.trim()) return; const [a, b, c] = line.split(/\t|,/).map(s => s.trim()); const p1 = findOrAdd(a, null); const p2 = findOrAdd(b, p1); findOrAdd(c, p2); });
                      onLog?.("新增", `批量建立會計科目（+${next.length - coa.length} 項）`);
                      saveCoa(next); setCoaImp(null);
                    }} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>建立</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {tab === "ledger" && (() => {
        const sep = `1px solid ${C.line}`;
        const single = fAcc !== "all" ? fAcc : null; // 篩到單一帳戶 → 顯示逐筆餘額（像銀行對帳單）
        const running = {};
        if (single) { const chron = (ledger || []).filter(l => l.from === single || l.to === single).sort((a, b) => (a.date || "") < (b.date || "") ? -1 : (a.date || "") > (b.date || "") ? 1 : 0); let bal = num(accounts.find(a => a.id === single)?.opening); chron.forEach(l => { bal += l.to === single ? num(l.amount) : l.from === single ? -num(l.amount) : 0; running[l.id] = bal; }); }
        const inSum = rows.filter(r => r.kind === "income").reduce((s, r) => s + num(r.amount), 0);
        const expSum = rows.filter(r => r.kind === "expense").reduce((s, r) => s + num(r.amount), 0);
        const gtc = "84px 64px 108px 112px 112px 100px 96px 76px 1fr 110px 52px 62px";
        const th = (l, align, click) => <div onClick={click} style={{ padding: "9px 8px", fontSize: 11, fontWeight: 700, color: C.sub, borderLeft: sep, cursor: click ? "pointer" : "default", textAlign: align || "left", letterSpacing: .3, userSelect: "none" }}>{l}</div>;
        const cellI = { border: "1px solid transparent", borderRadius: 5, padding: "6px 7px", fontSize: 12.5, background: "transparent", color: C.text, boxSizing: "border-box", width: "100%", outline: "none" };
        const noAcc = accounts.length === 0;
        return (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋廠商/科目/發票/備註…" style={{ ...inp, width: 220 }} />
              <select value={fKind} onChange={e => setFKind(e.target.value)} style={{ ...inp, width: 100 }}><option value="all">全部類型</option>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={fAcc} onChange={e => setFAcc(e.target.value)} style={{ ...inp, width: 140 }}><option value="all">全部帳戶</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name || "未命名"}</option>)}</select>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12.5, color: C.sub }}>{rows.length} 筆・合計 <b style={{ color: C.text }}>{fmt(filteredSum)}</b></span>
              <button onClick={() => { if (!guard()) return; setImp({ text: "", hasHeader: true, parsed: null, map: {}, account: accounts[0]?.id || "", defKind: "expense", preview: null, expected: "" }); }} disabled={noAcc} title={noAcc ? "請先建帳戶" : "從 Excel/Google 試算表整段貼上批量匯入"} style={{ background: "#fff", color: noAcc ? C.faint : "#b5512b", border: `1px solid ${noAcc ? C.line : "#b5512b"}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: noAcc ? "not-allowed" : "pointer" }}>📥 批量匯入</button>
              <button onClick={addLed} disabled={noAcc} title={noAcc ? "請先到「帳戶」建立至少一個帳戶" : ""} style={{ background: noAcc ? C.line : "#b5512b", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: noAcc ? "not-allowed" : "pointer" }}>＋ 新增交易</button>
            </div>
            {noAcc ? <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: sep, borderRadius: 12 }}>請先到 <b>🏦 帳戶</b> 建立帳戶，才能記交易。</div> :
            <div style={{ border: sep, borderRadius: 10, background: C.card, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
             <div style={{ maxHeight: "62vh", overflow: "auto" }}>
              <div style={{ minWidth: 1240 }}>
                <div style={{ display: "grid", gridTemplateColumns: gtc, background: C.head, borderBottom: sep, position: "sticky", top: 0, zIndex: 2 }}>
                  {th(`日期 ${sortDir === -1 ? "▼" : "▲"}`, "left", () => setSortDir(d => -d))}{th("類型")}{th("金額", "right")}{th("從帳戶 出")}{th("到帳戶 進")}{th("科目/工種")}{th("廠商")}{th("發票")}{th("備註")}{th(single ? "帳戶餘額" : "餘額", "right")}{th("憑證", "center")}{th("")}
                </div>
                {rows.length === 0 ? <div style={{ padding: 22, textAlign: "center", color: C.faint, fontSize: 13 }}>沒有符合的交易，點「＋ 新增交易」或「📥 批量匯入」</div> :
                 rows.map((l, i) => { const km = kindMeta(l.kind); const rb = single ? running[l.id] : null;
                  const editing = editLedId === l.id && canEdit;
                  const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
                  const ro = { padding: "0 8px", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
                  // 唯讀 Linear 密列：一行 36px、好掃讀；✎ 或雙擊進編輯
                  if (!editing) return (
                    <div key={l.id} onDoubleClick={() => canEdit && setEditLedId(l.id)}
                      style={{ display: "grid", gridTemplateColumns: gtc, alignItems: "center", height: 36, background: i % 2 ? "#f8f4ea" : C.card, borderTop: "1px solid #ece4d6", cursor: canEdit ? "default" : "default" }}>
                      <div style={{ ...ro, fontFamily: MONOF, fontSize: 11.5, color: l.date ? C.sub : C.faint }}>{l.date ? String(l.date).slice(2) : "—"}</div>
                      <div style={{ ...ro, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: km[2], flexShrink: 0 }} /><span style={{ fontSize: 12, color: C.sub }}>{km[1]}</span></div>
                      <div style={{ ...ro, fontFamily: MONOF, fontWeight: 700, textAlign: "right", color: km[2], fontSize: 12.5 }}>{fmt(num(l.amount))}</div>
                      <div style={{ ...ro, color: l.from ? C.text : C.faint, opacity: l.kind === "income" ? 0.5 : 1 }}>{l.from ? accName(l.from) : "—"}</div>
                      <div style={{ ...ro, color: l.to ? C.text : C.faint, opacity: l.kind === "expense" ? 0.5 : 1 }}>{l.to ? accName(l.to) : "—"}</div>
                      <div style={{ ...ro, color: (l.catId || l.category) ? C.text : C.faint }} title={l.catId ? coaPath(l.catId) : l.category}>{l.catId ? coaPath(l.catId).split(" / ").pop() : (l.category || "—")}</div>
                      <div style={{ ...ro, color: l.vendor ? C.text : C.faint }}>{l.vendor || "—"}</div>
                      <div style={{ ...ro, fontFamily: MONOF, fontSize: 11, color: l.invoiceNo ? C.sub : C.faint }}>{l.invoiceNo || "—"}</div>
                      <div style={{ ...ro, color: l.note ? C.sub : C.faint, fontSize: 12 }}>{l.note || "—"}</div>
                      <div style={{ padding: "0 8px", textAlign: "right", fontFamily: MONOF, fontSize: 12, fontWeight: 600, color: rb == null ? C.faint : rb < 0 ? C.red : C.text }}>{rb == null ? "·" : fmt(rb)}</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{ReceiptUploader ? <ReceiptUploader receipts={l.receipts || []} onChange={r => updLed(l.id, "receipts", r)} size={18} /> : null}</div>
                      {canEdit ? <button onClick={() => setEditLedId(l.id)} title="編輯這一列（也可雙擊）" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 13 }} onMouseEnter={e => e.currentTarget.style.color = C.blue} onMouseLeave={e => e.currentTarget.style.color = C.faint}>✎</button> : <span />}
                    </div>
                  );
                  return (
                  <div key={l.id} style={{ display: "grid", gridTemplateColumns: gtc, alignItems: "center", background: "#fbeee6", borderTop: "1px solid #ece4d6" }}>
                    <input type="date" value={String(l.date || "").replace(/\//g, "-").slice(0, 10)} onChange={e => updLed(l.id, "date", e.target.value)} style={{ ...cellI, ...dateInp, fontSize: 12 }} />
                    <select value={l.kind} onChange={e => updLed(l.id, "kind", e.target.value)} style={{ ...cellI, color: km[2], fontWeight: 700, padding: "6px 2px" }}>{KINDS.map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}</select>
                    <input value={blankZero(l.amount)} onChange={e => updLed(l.id, "amount", num(e.target.value))} type="number" placeholder="0" style={{ ...cellI, fontFamily: "ui-monospace, monospace", fontWeight: 700, textAlign: "right", color: km[2] }} />
                    <select value={l.from || ""} onChange={e => updLed(l.id, "from", e.target.value)} style={{ ...cellI, opacity: l.kind === "income" ? 0.45 : 1 }}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name || "未命名"}</option>)}</select>
                    <select value={l.to || ""} onChange={e => updLed(l.id, "to", e.target.value)} style={{ ...cellI, opacity: l.kind === "expense" ? 0.45 : 1 }}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name || "未命名"}</option>)}</select>
                    {coa.length ? (
                      <select value={l.catId || (l.category ? "__legacy__" : "")} onChange={e => { const v = e.target.value; if (v === "__legacy__") return; logT("編輯", "設定財務交易科目"); saveLed(ledger.map(x => x.id === l.id ? { ...x, catId: v, category: v ? coaPath(v) : "" } : x)); }} title={l.catId ? coaPath(l.catId) : l.category} style={{ ...cellI }}>
                        <option value="">— 科目 —</option>
                        {l.category && !l.catId && <option value="__legacy__">（自訂）{l.category}</option>}
                        {coaFlat().map(n => <option key={n.id} value={n.id}>{(n.depth ? "　".repeat(n.depth) : "▸ ") + n.name}</option>)}
                      </select>
                    ) : (
                      <input value={l.category || ""} onChange={e => updLed(l.id, "category", e.target.value)} placeholder={l.kind === "expense" ? "科目/工種" : "—"} style={cellI} />
                    )}
                    <input value={l.vendor || ""} onChange={e => updLed(l.id, "vendor", e.target.value)} placeholder="廠商/對象" style={cellI} />
                    <input value={l.invoiceNo || ""} onChange={e => updLed(l.id, "invoiceNo", e.target.value)} placeholder="—" style={cellI} />
                    <input value={l.note || ""} onChange={e => updLed(l.id, "note", e.target.value)} placeholder="備註" style={cellI} />
                    <div style={{ padding: "6px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 12.5, fontWeight: 600, color: rb == null ? C.faint : rb < 0 ? C.red : C.text }}>{rb == null ? "·" : fmt(rb)}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{ReceiptUploader ? <ReceiptUploader receipts={l.receipts || []} onChange={r => updLed(l.id, "receipts", r)} size={20} /> : null}</div>
                    <div style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                      <button onClick={() => setEditLedId(null)} title="完成編輯" style={{ border: "none", background: C.blue, color: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 11.5, padding: "3px 7px", fontWeight: 700 }}>完成</button>
                      <button onClick={() => delLed(l)} title="刪除" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 15 }} onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = C.faint}>×</button>
                    </div>
                  </div>
                ); })}
              </div>
             </div>
             {/* 合計列 */}
             <div style={{ display: "flex", gap: 18, justifyContent: "flex-end", alignItems: "center", padding: "9px 14px", borderTop: `2px solid ${C.line}`, background: C.head, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
               <span style={{ color: C.sub }}>本頁 {rows.length} 筆</span>
               <span style={{ color: C.sub }}>收入 <b style={{ color: C.accent }}>{fmt(inSum)}</b></span>
               <span style={{ color: C.sub }}>支出 <b style={{ color: C.red }}>{fmt(expSum)}</b></span>
               <span style={{ color: C.sub }}>淨 <b style={{ color: (inSum - expSum) < 0 ? C.red : C.text }}>{fmt(inSum - expSum)}</b></span>
               {single && <span style={{ color: C.sub }}>此帳戶餘額 <b style={{ color: balanceOf(single) < 0 ? C.red : C.accent }}>{fmt(balanceOf(single))}</b></span>}
             </div>
            </div>}
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.7 }}>
              <b>支出</b>＝從某帳戶付出去（標科目/工種）；<b>轉帳</b>＝帳戶間搬錢（不算成本，選「從／到」）；<b>收入</b>＝錢進某帳戶。<b>篩選單一帳戶</b>時右側顯示逐筆餘額（像對帳單）。
            </div>
          </div>
        );
      })()}

      {/* ── 對帳：合作金庫·喬亞國際餐飲（銀行對帳單式呈現 + 圖表 + 三方核對）── */}
      {tab === "recon" && (() => {
        const ctbcRows = ((ctbc?.entries) || []).map(e => ({
          id: e.id, payDate: e.effDate || e.setDate, notifyDate: e.setDate,
          cat: e.type || "", subject: e.result && e.result !== "交易完成" ? e.result : "",
          content: (e.note || e.type || "") + (e.count > 1 ? `（${e.count}筆）` : ""),
          amount: e.amount, fee: 0, balanceAfter: 0,
          payee: e.inAcct || "", bank: "", batch: e.id, handler: "", source: "ctbc",
        }));
        const shRows = reconAcct === "ctbc" ? ctbcRows : (bank?.entries?.length ? bank.entries : (sheet?.rows || []));
        const d2n = (d) => d ? +new Date(d) : 0;
        const close = (a, b) => a && b && Math.abs(d2n(a) - d2n(b)) <= 5 * 86400e3;
        const pool = [
          ...conCats.flatMap(c => (c.payments || []).map(pm => ({ kind: "工程付款", key: "pay:" + pm.id, date: pm.date, amount: num(pm.amount), label: c.name, note: pm.note || "" }))),
          ...(ledger || []).map(l => ({ kind: "內帳", key: "fin:" + l.id, date: l.date, amount: num(l.amount), label: accName(l.from) || "內帳", note: [l.category, l.vendor, l.note].filter(Boolean).join("・") })),
        ];
        const usedPool = new Set();
        const status = {}; // sheetRowId → {st:'linked'|'ignored'|'matched'|'open', via}
        shRows.forEach(r => {
          if (recon.links[r.id]) { status[r.id] = { st: "linked" }; return; }
          if (recon.ignored.includes(r.id)) { status[r.id] = { st: "ignored" }; return; }
          const hit = pool.find(pl => !usedPool.has(pl.key) && pl.amount === r.amount && (close(pl.date, r.payDate) || !pl.date || !r.payDate));
          if (hit) { usedPool.add(hit.key); status[r.id] = { st: "matched", via: hit.kind + "｜" + hit.label }; }
          else status[r.id] = { st: "open" };
        });
        const nMatched = shRows.filter(r => ["matched", "linked"].includes(status[r.id]?.st)).length;
        const nOpen = shRows.filter(r => status[r.id]?.st === "open").length;
        const nIgn = recon.ignored.length;
        const onlyApp = pool.filter(pl => !usedPool.has(pl.key) && pl.kind === "工程付款" && num(pl.amount) > 0);
        const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
        const chrono = [...shRows].sort((a, b) => (a.payDate || a.notifyDate || "") < (b.payDate || b.notifyDate || "") ? -1 : 1);
        const latestBal = [...chrono].reverse().find(r => r.balanceAfter > 0);
        const doFillFin = (r) => {
          if (!guard()) return;
          saveLed([{ id: rid("tx"), date: r.payDate || "", kind: "expense", amount: r.amount, from: accounts[0]?.id || "", to: "", category: r.subject || r.cat, vendor: r.payee || "", invoiceNo: "", note: r.content + (r.batch ? "（" + r.batch + "）" : "") + "〔對帳補記〕", receipts: [] }, ...ledger]);
          saveRecon({ ...recon, links: { ...recon.links, [r.id]: { kind: "fin" } } });
          onLog?.("新增", "對帳補記內帳 " + fmt(r.amount) + "（" + r.content.slice(0, 14) + "）");
          flashRecon("✓ 「" + r.content.slice(0, 16) + "」" + fmt(r.amount) + " 已補進【交易明細】，此列狀態變為已補記（切「全部」可見）");
        };
        const doFillPay = async (r, catId) => {
          if (!guard() || !catId) return;
          try {
            const cd = await window.storage.get("pm_data", true);
            const cats2 = cd && cd.value ? JSON.parse(cd.value) : [];
            // 正確作法：新增「完整細項」(名稱+金額=該筆匯款、含稅、標銀行已核對) + 綁定的付款 → 預估/已付同步增加、不汙染原有項目金額
            const itemId = "i-" + catId + "-" + Date.now();
            const payId = "pay-" + Math.random().toString(36).slice(2, 8);
            const noteTx = (r.batch ? "（" + r.batch + "）" : "") + "〔對帳補記・銀行已核對〕";
            const next = cats2.map(c => c.id === catId ? {
              ...c,
              items: [...(c.items || []), { id: itemId, name: r.content, qty: 1, unit: "式", unitPrice: r.amount, taxType: "含稅", labor: 0, laborDays: 0, dailyWage: 0, assignee: r.payee || "", status: "done", done: true, receipts: [], notes: noteTx, chat: [], bankVerified: true }],
              payments: [...(c.payments || []), { id: payId, date: r.payDate || "", amount: r.amount, category: "其他", note: r.content + noteTx, itemId, receipts: [], bankVerified: true }],
            } : c);
            await window.storage.set("pm_data", JSON.stringify(next), true);
            setConCats(next);
            saveRecon({ ...recon, links: { ...recon.links, [r.id]: { kind: "pay", catId, itemId } } });
            onLog?.("新增", "對帳補記工程細項+付款 " + fmt(r.amount));
            const cn2 = (cats2.find(c => c.id === catId) || {}).name || "";
            flashRecon("✓ 「" + r.content.slice(0, 16) + "」" + fmt(r.amount) + " 已補進【工程專案→" + cn2 + " 的付款】（切「全部」可見此列已補記）");
          } catch (e) { alert("寫入工程付款失敗：" + e.message); }
        };
        // 圖表資料
        const balSeries = chrono.filter(r => r.balanceAfter > 0 && r.payDate).map(r => ({ d: r.payDate, v: r.balanceAfter }));
        const months = {}; chrono.forEach(r => { const m = (r.payDate || "").slice(0, 7); if (m && r.amount > 0) months[m] = (months[m] || 0) + r.amount; });
        const moArr = Object.entries(months).sort();
        const moMax = Math.max(1, ...moArr.map(([, v]) => v));
        const cats3 = {}; chrono.forEach(r => { const k = (r.cat || "未分類").trim(); if (r.amount > 0) cats3[k] = (cats3[k] || 0) + r.amount; });
        const catArr = Object.entries(cats3).sort((a, b) => b[1] - a[1]).slice(0, 7);
        const catMax = Math.max(1, ...catArr.map(([, v]) => v));
        const CATCOL = { "公      司": "#3a6ea5", "宏匯瑞光": "#3f7d4e", "薪      資": "#c98a14", "設      備": "#b3492f", "行      銷": "#6b4a86", "營業雜支": "#9b9384", "利      息": "#2f7d7a" };
        let rowsView = reconOnlyOpen ? [...chrono].reverse().filter(r => status[r.id]?.st === "open") : [...chrono].reverse();
        if (reconCat) rowsView = rowsView.filter(r => (r.cat || "").replace(/\s+/g, "") === reconCat);
        if (reconQ.trim()) { const qq = reconQ.trim().toLowerCase(); rowsView = rowsView.filter(r => (r.content + (r.payee || "") + (r.batch || "") + (r.subject || "") + (r.handler || "") + String(r.amount)).toLowerCase().includes(qq)); }
        const statCard = (n, l, cl) => (
          <div key={l} style={{ background: C.card, border: "1.5px solid #c8bca6", borderRadius: 8, padding: "8px 12px", flex: "1 1 110px" }}>
            <div style={{ fontFamily: MONOF, fontSize: 20, fontWeight: 700, color: C.text }}>{n}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: cl }} />{l}</div>
          </div>
        );
        const chartBox = { background: C.card, border: "1.5px solid #c8bca6", borderRadius: 8, padding: "10px 14px", flex: "1 1 280px", minWidth: 260 };
        return (
          <div>
            {/* 帳戶頭（張良 2026-07-26 手機版全面體檢：已有 flexWrap 可換行，手機 gap 縮小避免溢出） */}
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, flexWrap: "wrap", marginBottom: 12 }}>
              <span style={{ background: C.blue, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px", letterSpacing: 1 }}>帳戶</span>
              <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                {[["coop", "合作金庫 · 喬亞"], ["ctbc", "中國信託 e-Cash"]].map(([v, l]) => (
                  <button key={v} onClick={() => setReconAcct(v)} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${reconAcct === v ? C.line : "transparent"}`, background: reconAcct === v ? "#fff" : "transparent", color: reconAcct === v ? C.text : C.sub, fontSize: 13, fontWeight: reconAcct === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{reconAcct === "ctbc" ? "🏦 中國信託 · 企業收付 e-Cash" : "🏦 合作金庫 · 喬亞國際餐飲"}</div>
                <div style={{ fontSize: 11, color: C.faint }}>{reconAcct === "ctbc"
                  ? `匯款通知自動入庫・${shRows.length} 筆（每天自動收信，交易序號去重）${ctbc?.updatedAt ? "・更新 " + new Date(ctbc.updatedAt).toLocaleDateString("zh-TW") : ""}`
                  : `銀行帳務資料庫・${shRows.length} 筆（只增不改・所有工程款以此核對）${bank?.updatedAt ? "・更新 " + new Date(bank.updatedAt).toLocaleDateString("zh-TW") : ""}`}</div>
              </div>
              {latestBal && <div style={{ marginLeft: 6 }}>
                <div style={{ fontFamily: MONOF, fontSize: 22, fontWeight: 700, color: C.text }}>{fmt(latestBal.v ?? latestBal.balanceAfter)}</div>
                <div style={{ fontSize: 10.5, color: C.faint }}>最新餘額（{latestBal.payDate}）</div>
              </div>}
              <div style={{ flex: 1 }} />
              {canEdit && reconAcct === "coop" && <button onClick={() => setManForm({ date: "", cat: "", subject: "", content: "", amount: "", fee: "", payee: "", batch: "", balanceAfter: "" })} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>＋ 手動新增一筆</button>}
              {reconAcct === "coop" && <button onClick={runSync} disabled={syncBusy} title="過渡期用：試算表退役前，把上面的新資料撈進資料庫" style={{ background: "#fff", color: C.blue, border: `1.5px solid ${C.blue}`, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: syncBusy ? "wait" : "pointer" }}>{syncBusy ? "匯入中…" : "⬇ 從試算表匯入"}</button>}
            </div>
            {!shRows.length ? (
              <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10 }}>{reconAcct === "ctbc" ? "中信資料還沒進來——每天自動收信後就會出現。" : "資料庫還是空的——按「⬇ 從試算表匯入」建底稿，或「＋ 手動新增一筆」。"}</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  {statCard(nMatched, "對上了 / 已補記", C.accent)}
                  {statCard(nOpen, "未對帳（待處理）", C.red)}
                  {statCard(onlyApp.length, "只在 App（帳務表可能漏）", C.amber)}
                  {statCard(nIgn, "已忽略", C.faint)}
                </div>
                {/* 圖像化：餘額走勢 / 每月支出 / 類別佔比 */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                  <div style={chartBox}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>帳戶餘額走勢</div>
                    {balSeries.length > 1 ? (() => {
                      const vs = balSeries.map(x => x.v); const mn = Math.min(...vs), mx = Math.max(...vs);
                      const pts = balSeries.map((x, i) => `${(i / (balSeries.length - 1)) * 580 + 10},${120 - ((x.v - mn) / Math.max(1, mx - mn)) * 100}`).join(" ");
                      return (
                        <>
                          <svg viewBox="0 0 600 130" style={{ width: "100%", height: 90 }}>
                            <polyline points={pts} fill="none" stroke="#3a6ea5" strokeWidth="2.5" />
                          </svg>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.faint, fontFamily: MONOF }}>
                            <span>{balSeries[0].d.slice(5)}　低 {fmt(mn)}</span><span>{balSeries[balSeries.length - 1].d.slice(5)}　高 {fmt(mx)}</span>
                          </div>
                        </>
                      );
                    })() : <div style={{ fontSize: 12, color: C.faint }}>資料不足</div>}
                  </div>
                  <div style={chartBox}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>每月支出</div>
                    {moArr.map(([m, v]) => (
                      <div key={m} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: MONOF, fontSize: 10.5, color: C.sub, width: 52 }}>{m}</span>
                        <div style={{ flex: 1, height: 10, background: "#eee5d3", borderRadius: 5, overflow: "hidden" }}><div style={{ width: (v / moMax * 100) + "%", height: "100%", background: "#3a6ea5", borderRadius: 5 }} /></div>
                        <span style={{ fontFamily: MONOF, fontSize: 10.5, color: C.text, width: 78, textAlign: "right" }}>{Math.round(v / 1000).toLocaleString()}K</span>
                      </div>
                    ))}
                  </div>
                  <div style={chartBox}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>類別佔比（累計支出）</div>
                    {catArr.map(([k, v]) => (
                      <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 10.5, color: C.sub, width: 64, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{k.replace(/\s+/g, "")}</span>
                        <div style={{ flex: 1, height: 10, background: "#eee5d3", borderRadius: 5, overflow: "hidden" }}><div style={{ width: (v / catMax * 100) + "%", height: "100%", background: CATCOL[k] || "#9b9384", borderRadius: 5 }} /></div>
                        <span style={{ fontFamily: MONOF, fontSize: 10.5, color: C.text, width: 78, textAlign: "right" }}>{Math.round(v / 1000).toLocaleString()}K</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* 手動新增一筆（進資料庫；之後改成貼網銀截圖AI判讀） */}
                {manForm && (() => {
                  const mset = (k) => (e) => setManForm(f => ({ ...f, [k]: e.target.value }));
                  const saveMan = () => {
                    const amt = num(manForm.amount);
                    if (!manForm.date || !manForm.content.trim() || !amt) { alert("至少要填：日期、項目內容、金額"); return; }
                    const e2 = { id: "bk-" + Math.random().toString(36).slice(2, 9), source: "manual", checked: "", notifyDate: "", cat: manForm.cat.trim(), subject: manForm.subject.trim(), content: manForm.content.trim(), owner: "", method: "匯款", pretax: 0, tax: 0, amount: amt, payDate: manForm.date, payee: manForm.payee.trim(), handler: "", fee: num(manForm.fee), bank: "", batch: manForm.batch.trim(), balanceAfter: num(manForm.balanceAfter) };
                    const cur = bank || { account: "合作金庫 · 喬亞國際餐飲", entries: [] };
                    saveBank({ ...cur, entries: [...(cur.entries || []), e2], updatedAt: new Date().toISOString() });
                    onLog?.("新增", "銀行資料庫手動新增 " + fmt(amt));
                    flashRecon("✓ 已新增進資料庫：「" + manForm.content.trim().slice(0, 16) + "」" + fmt(amt));
                    setManForm(null);
                  };
                  const mi = (w) => ({ ...inp, width: w });
                  return (
                    <div style={{ background: "#fff", border: `1.5px solid ${C.accent}`, borderRadius: 8, padding: "10px 14px", marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>新增一筆進資料庫</span>
                      <input type="date" value={manForm.date} onChange={mset("date")} style={{ ...mi(130), colorScheme: "light" }} />
                      <input value={manForm.cat} onChange={mset("cat")} placeholder="類別" style={mi(84)} />
                      <input value={manForm.subject} onChange={mset("subject")} placeholder="科目" style={mi(90)} />
                      <input value={manForm.content} onChange={mset("content")} placeholder="項目內容 *" style={mi(200)} />
                      <input value={manForm.amount} onChange={mset("amount")} placeholder="金額 *" inputMode="numeric" style={mi(92)} />
                      <input value={manForm.fee} onChange={mset("fee")} placeholder="手續費" inputMode="numeric" style={mi(66)} />
                      <input value={manForm.payee} onChange={mset("payee")} placeholder="收款方" style={mi(110)} />
                      <input value={manForm.batch} onChange={mset("batch")} placeholder="批號/憑證" style={mi(100)} />
                      <input value={manForm.balanceAfter} onChange={mset("balanceAfter")} placeholder="匯後餘額" inputMode="numeric" style={mi(96)} />
                      <button onClick={saveMan} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>存入資料庫</button>
                      <button onClick={() => setManForm(null)} style={{ background: "none", border: `1px solid ${C.line}`, color: C.sub, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}>取消</button>
                    </div>
                  );
                })()}
                {/* 對帳單（試算表式完整呈現） */}
                {reconMsg && (
                  <div style={{ background: "#eef5ef", border: "1.5px solid #3f7d4e", borderRadius: 8, padding: "8px 14px", marginBottom: 10, fontSize: 13, color: "#2c5a38", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1 }}>{reconMsg}</span>
                    <button onClick={() => setReconMsg(null)} style={{ border: "none", background: "none", color: "#3f7d4e", cursor: "pointer", fontSize: 15 }}>×</button>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                    {[[false, "全部 " + shRows.length], [true, "只看未對帳 " + nOpen]].map(([v, l]) => (
                      <button key={String(v)} onClick={() => setReconOnlyOpen(v)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${reconOnlyOpen === v ? C.line : "transparent"}`, background: reconOnlyOpen === v ? "#fff" : "transparent", color: reconOnlyOpen === v ? C.text : C.sub, fontSize: 12.5, fontWeight: reconOnlyOpen === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
                    ))}
                  </div>
                  <input value={reconQ} onChange={e => setReconQ(e.target.value)} placeholder="搜尋內容/收款方/批號/金額…" style={{ ...inp, width: 210 }} />
                  <span style={{ fontSize: 11, color: C.faint }}>新 → 舊・之後可直接貼企業網銀截圖補資料（規劃中）</span>
                </div>
                {/* 類別標籤：點了直接篩選（再點一次取消） */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {catArr.map(([k, v]) => { const kk = k.replace(/\s+/g, ""); const on = reconCat === kk; return (
                    <button key={k} onClick={() => setReconCat(on ? "" : kk)} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1.5px solid ${on ? (CATCOL[k] || "#9b9384") : C.line}`, background: on ? (CATCOL[k] || "#9b9384") : "#fff", color: on ? "#fff" : C.sub, borderRadius: 14, padding: "3px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#fff" : (CATCOL[k] || "#9b9384") }} />{kk}
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, opacity: .8 }}>{Math.round(v / 1000).toLocaleString()}K</span>
                    </button>
                  ); })}
                  {reconCat && <button onClick={() => setReconCat("")} style={{ border: "none", background: "none", color: C.faint, fontSize: 12, cursor: "pointer" }}>× 清除篩選</button>}
                </div>
                <div style={{ border: "1.5px solid #c8bca6", borderRadius: 8, background: C.card, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}><div style={{ minWidth: 1180 }}>
                    {(() => {
                      const GTC = "78px 108px minmax(200px,1fr) 96px 46px 104px 170px 118px 56px 210px";
                      const hc = { fontSize: 10.5, letterSpacing: 0.8, color: C.faint, fontWeight: 700, padding: "7px 8px", whiteSpace: "nowrap" };
                      return (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: GTC, background: C.soft, borderBottom: "1.5px solid #c8bca6", alignItems: "center", position: "sticky", top: 0 }}>
                            <div style={hc}>日期</div><div style={hc}>類別・科目</div><div style={hc}>項目內容</div><div style={{ ...hc, textAlign: "right" }}>金額</div><div style={{ ...hc, textAlign: "right" }}>手續</div><div style={{ ...hc, textAlign: "right" }}>餘額</div><div style={hc}>收款方</div><div style={hc}>批號</div><div style={hc}>經手</div><div style={hc}>對帳狀態</div>
                          </div>
                          <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                            {rowsView.map((r, i) => {
                              const st = status[r.id] || { st: "open" };
                              return (
                                <div key={r.id} style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "center", minHeight: 34, borderTop: i ? `1px solid #f0ead9` : "none", background: st.st === "open" ? "#fdf6f4" : (i % 2 ? "#f8f4ea" : C.card) }}>
                                  <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, color: C.sub, whiteSpace: "nowrap" }}>{(r.payDate || r.notifyDate || "—").slice(2)}</div>
                                  <div style={{ padding: "0 8px", fontSize: 11, color: C.sub, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={(r.cat + "・" + r.subject).replace(/\s+/g, "")}>{(r.cat || "").replace(/\s+/g, "")}{r.subject ? "・" + r.subject : ""}</div>
                                  <div style={{ padding: "0 8px", fontSize: 12.5, color: C.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={r.content}>{r.content}</div>
                                  <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 12.5, fontWeight: 700, textAlign: "right", color: r.amount < 0 ? C.accent : C.text }}>{fmt(r.amount)}</div>
                                  <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11, textAlign: "right", color: r.fee ? C.faint : "#d5cbb6" }}>{r.fee || "—"}</div>
                                  <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, textAlign: "right", color: r.balanceAfter > 0 ? C.sub : "#d5cbb6" }}>{r.balanceAfter > 0 ? fmt(r.balanceAfter) : "—"}</div>
                                  <div style={{ padding: "0 8px", fontSize: 11.5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={(r.payee || "") + (r.bank ? "（" + r.bank + "）" : "")}>
                                    <span style={{ color: r.payee ? C.text : "#d5cbb6" }}>{r.payee || "—"}</span>{r.bank && <span style={{ color: C.faint, fontSize: 10 }}>（{r.bank}）</span>}
                                  </div>
                                  <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 10, color: r.batch ? C.faint : "#d5cbb6", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={r.batch}>{(r.batch || "—").replace("批號：", "")}</div>
                                  <div style={{ padding: "0 8px", fontSize: 11.5, color: r.handler ? C.sub : "#d5cbb6" }}>{r.handler || "—"}</div>
                                  <div style={{ padding: "2px 8px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                                    {st.st === "matched" && <span title={st.via} style={{ fontSize: 11, color: "#3f7d4e", fontWeight: 700 }}>✓ 對上（{st.via?.split("｜")[0]}）</span>}
                                    {st.st === "linked" && <span style={{ fontSize: 11, color: C.blue, fontWeight: 700 }}>✓ 已補記</span>}
                                    {st.st === "ignored" && <><span style={{ fontSize: 11, color: C.faint }}>已忽略</span>{canEdit && <button onClick={() => saveRecon({ ...recon, ignored: recon.ignored.filter(x => x !== r.id) })} style={{ border: "none", background: "none", color: C.blue, fontSize: 11, cursor: "pointer", padding: isMobile ? "6px 8px" : 0, ...(isMobile ? { minHeight: 32 } : {}) }}>復原</button>}</>}
                                    {/* 張良 2026-07-26 手機版全面體檢：原 padding 2px 高度僅~17px 手指點不到 → 手機加大到 minHeight 32；桌機不變 */}
                                    {st.st === "open" && canEdit && <>
                                      <select defaultValue="" onChange={e => { if (e.target.value) { doFillPay(r, e.target.value); e.target.value = ""; } }} style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: isMobile ? "6px 8px" : "2px 4px", fontSize: 10.5, background: "#fff", maxWidth: 86, ...(isMobile ? { minHeight: 32 } : {}) }}>
                                        <option value="">工程▾</option>
                                        {conCats.filter(c => !c.nonProject).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                      </select>
                                      <button onClick={() => doFillFin(r)} style={{ border: `1px solid ${C.blue}`, background: "#fff", color: C.blue, borderRadius: 6, padding: isMobile ? "6px 10px" : "2px 7px", fontSize: 10.5, fontWeight: 700, cursor: "pointer", ...(isMobile ? { minHeight: 32 } : {}) }}>內帳</button>
                                      <button onClick={() => saveRecon({ ...recon, ignored: [...recon.ignored, r.id] })} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.faint, borderRadius: 6, padding: isMobile ? "6px 10px" : "2px 6px", fontSize: 10.5, cursor: "pointer", ...(isMobile ? { minHeight: 32 } : {}) }}>略</button>
                                    </>}
                                    {st.st === "open" && !canEdit && <span style={{ fontSize: 11, color: C.red }}>未對帳</span>}
                                    {r.source === "manual" && <span title="手動輸入的資料" style={{ fontSize: 9.5, color: C.faint, border: `1px solid ${C.line}`, borderRadius: 4, padding: "0 4px" }}>手動</span>}
                                    {r.source === "manual" && canEdit && <button onClick={async () => { if (window.confirm("刪除這筆手動輸入？（匯入的資料不能刪，手動的可以）")) { saveBank({ ...bank, entries: bank.entries.filter(x => x.id !== r.id), updatedAt: new Date().toISOString() }); } }} style={{ border: "none", background: "none", color: C.faint, fontSize: 11, cursor: "pointer", padding: isMobile ? "6px 8px" : 0, ...(isMobile ? { minHeight: 32 } : {}) }}>刪</button>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div></div>
                </div>
                {onlyApp.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 8 }}>⚠ 只在 App 的工程付款——帳務表可能漏記（或屬現金/零用金）</div>
                    {onlyApp.slice(0, 30).map(pl => (
                      <div key={pl.key} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: MONOF, fontSize: 12, color: C.sub, width: 74 }}>{pl.date || "—"}</span>
                        <span style={{ flex: 1, minWidth: 140, fontSize: 12.5, color: C.text }}>{pl.label}{pl.note ? "・" + pl.note : ""}</span>
                        <span style={{ fontFamily: MONOF, fontSize: 13, fontWeight: 700 }}>{fmt(pl.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* ── 營運（Eats365 POS 日結：所有數字都從原始資料算、點任何數字下鑽到明細資料庫）── */}
      {tab === "pos" && (() => {
        const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
        // 分店切換：依店名判斷歸屬（GROUN:D 的日結信開始寄進來後，這裡自動就有資料）
        const storeKeyOf = (n) => /groun/i.test(n || "") ? "ground" : "abeach";
        const STORES = [["abeach", "A Beach 101"], ["ground", "GROUN:D"]];
        const all = [...((pos?.entries) || [])].filter(e => storeKeyOf(e.store) === posStore).sort((a, b) => (a.date < b.date ? -1 : 1));
        const days = posPeriod.mode === "month" && posPeriod.month ? all.filter(e => (e.date || "").slice(0, 7) === posPeriod.month)
          : posPeriod.mode === "custom" ? all.filter(e => (!posPeriod.from || e.date >= posPeriod.from) && (!posPeriod.to || e.date <= posPeriod.to))
          : all;
        const monthsAvail = [...new Set(all.map(e => (e.date || "").slice(0, 7)))].sort().reverse(); // 有資料的月份（新→舊）
        const last = days[days.length - 1];
        const sum = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0);
        const revSum = sum(days, "revenue"), txSum = sum(days, "txCount"), guestSum = sum(days, "guests");
        const hasGuests = guestSum > 0; // 該店期間內完全沒有來客數（GROUN:D 喬亞不提供）→ 來客/客單欄整組隱藏（張良 2026-08-27）
        // 客單價＝營收 ÷ 來客數（張良指正：不是除單數）
        const ticket = (rev, g) => g ? Math.round(rev / g) : null;
        const avgTicket = ticket(revSum, guestSum);
        const maxRev = Math.max(1, ...days.map(d => d.revenue || 0));
        // 明細庫：新格式 key=日期::店代碼（雙店同日不互蓋）；舊格式 key=日期（依 store 欄判斷歸屬）
        const dayDet = (date) => { const m = posDet[(date || "").slice(0, 7)]?.days; if (!m) return undefined; const nd = m[`${date}::${posStore}`]; if (nd) return nd; const od = m[date]; return od && storeKeyOf(od.store) === posStore ? od : undefined; };
        const CATSHEET = "總銷售額 (以類別分類)";
        // 明細彙總（期間內，全部從原始明細資料庫算）
        const catAgg = {}, itemAgg = {};
        days.forEach(d => {
          const secs2 = dayDet(d.date)?.sheets?.[CATSHEET] || [];
          const hasSum = secs2.some(s => s.title === "總結"); // 真日結信有官方「總結」段＝分類營收用它；試營運回填沒有＝改用品項列加總（同資料不會兩邊都算）
          secs2.forEach(sec => {
            (sec.rows || []).forEach(r => {
              if (!Array.isArray(r) || typeof r[0] !== "string" || isQuarterItem(r[0])) return;
              const amt = Number(r[r.length - 1]) || 0, qty = Number(r[1]) || 0;
              if (sec.title === "總結") { if (amt > 0) { const c = catAgg[r[0]] = catAgg[r[0]] || { qty: 0, amt: 0 }; c.qty += qty; c.amt += amt; } return; }
              if (sec.title === "套餐") { if (amt > 0) { const c = catAgg["套餐"] = catAgg["套餐"] || { qty: 0, amt: 0 }; c.qty += qty; c.amt += amt; } return; } // 套餐自己算一類（張良 2026-08-16），不混進品項榜
              if (amt > 0) {
                if (!hasSum) { const c = catAgg[sec.title] = catAgg[sec.title] || { qty: 0, amt: 0 }; c.qty += qty; c.amt += amt; }
                const it = itemAgg[r[0]] = itemAgg[r[0]] || { qty: 0, amt: 0, cat: sec.title }; it.qty += qty; it.amt += amt;
                // 同名品項各分類分開記（張良 2026-07-26：外帶類別同名但單價較低，要辨識得出來）
                const bc = (it.byCat = it.byCat || {})[sec.title] = (it.byCat || {})[sec.title] || { qty: 0, amt: 0 };
                bc.qty += qty; bc.amt += amt;
              }
            });
          });
        });
        // 同名多分類且單價有落差＝疑似外帶/優惠版（單價=金額÷份數；差 ≥5% 且 ≥10 元才算）
        const dupeGroups = Object.entries(itemAgg).map(([n, v]) => {
          const cats = Object.entries(v.byCat || {}).filter(([, b]) => b.qty > 0).map(([c2, b]) => ({ cat: c2, qty: b.qty, amt: b.amt, unit: Math.round(b.amt / b.qty) }));
          if (cats.length < 2) return null;
          cats.sort((a, b) => b.unit - a.unit);
          const hi = cats[0].unit, lo = cats[cats.length - 1].unit;
          return (hi - lo >= 10 && (hi - lo) / hi >= 0.05) ? { n, cats, diff: hi - lo } : null;
        }).filter(Boolean).sort((a, b) => b.diff - a.diff);
        const catArr2 = Object.entries(catAgg).sort((a, b) => b[1].amt - a[1].amt);
        const catMax2 = Math.max(1, ...catArr2.map(([, v]) => v.amt));
        const topItems = Object.entries(itemAgg).filter(([, v]) => !posCats.length || posCats.includes(v.cat)).sort((a, b) => b[1].amt - a[1].amt).slice(0, 12);
        const PAL = ["#3a6ea5", "#3f7d4e", "#c98a14", "#b3492f", "#6b4a86", "#2f7d7a", "#9b9384", "#c4582a", "#5a6e3a", "#8a5a44", "#4a6b86", "#7d3f5e"];
        const paySum = { card: sum(days, "card"), cash: sum(days, "cash"), linepay: sum(days, "linepay"), payOther: sum(days, "payOther"), kiosk: sum(days, "kiosk"), uber: sum(days, "uber") }; // linepay 含自助點餐 LINE Pay(APP)；kiosk=自助點餐通路合計（與付款別交疊、非加總項）（2026-08-29）
        const hasKiosk = paySum.kiosk > 0; // 期間內完全沒有自助點餐（A Beach／GROUN:D 8/26 前）→ 整欄隱藏
        const hasLinepay = paySum.linepay > 0; // 期間內完全沒有 LINE Pay（A Beach 沒開通）→ 整欄隱藏（張良 2026-09-01）
        // 「1」「2」參考欄（張良 2026-09-01：兩間外部店每日營業額放 A Beach 日期與營收之間；只標 1/2 不露店名）
        const extDays = posExt?.days || {};
        const hasExt = posStore === "abeach" && Object.keys(extDays).length > 0;
        // A Beach 視圖改「總覽版型」（張良 2026-09-02）：店欄刪掉（籤已選店＝多餘）、營收欄改「AB」、右邊加「GD」欄＝GROUN:D 同日營收
        const abView = posStore === "abeach";
        const inPeriodDate = (dt) => posPeriod.mode === "month" && posPeriod.month ? (dt || "").slice(0, 7) === posPeriod.month
          : posPeriod.mode === "custom" ? (!posPeriod.from || dt >= posPeriod.from) && (!posPeriod.to || dt <= posPeriod.to)
          : true; // 與 days 的期間過濾同一套規則（資料一致）
        const gdByDate = {};
        if (abView) ((pos?.entries) || []).forEach(e => { if (storeKeyOf(e.store) === "ground" && inPeriodDate(e.date)) gdByDate[e.date] = (gdByDate[e.date] || 0) + (Number(e.revenue) || 0); });
        // 「至14:00」欄（張良 2026-09-02：兩點＝中午餐期結束分水嶺）：時段表加總 <14:00 的小時列＝開店到 14:00 的累計
        // 與「⏰ 時段消費」同一份資料（sheets 時段分析）＝數字一致；今天盤中列也有（intraday 帶時段明細）
        const lunchByDate = {};
        if (!abView) days.forEach(d => {
          const secs = dayDet(d.date)?.sheets?.["時段分析(每小時)"];
          if (!Array.isArray(secs) || !secs.length) return;
          let t = 0, any = false;
          secs.forEach(sc => (sc.rows || []).forEach(r => {
            if (!Array.isArray(r)) return;
            const hh = parseInt(String(r[0]).slice(0, 2), 10);
            if (!Number.isFinite(hh)) return;
            any = true;
            if (hh < 14) t += Number(r[r.length - 1]) || 0;
          }));
          if (any) lunchByDate[d.date] = t;
        });
        const hasLunch = days.some(d => lunchByDate[d.date] != null);
        // 自助點餐估算單數＝自助金額÷當日單均（喬亞 15 張報表都沒有付款別筆數、訂單來源篩選實測無效 2026-08-29）——明確標「約」
        const kioskTx = (d) => (d.kiosk > 0 && d.revenue > 0 && d.txCount > 0) ? Math.round(d.kiosk / (d.revenue / d.txCount)) : 0;
        const kioskTxSum = days.reduce((t, d) => t + kioskTx(d), 0);
        // 分類×日 / 品項×日（比較與智慧摘要用）
        const catDay = {}, itemDay = {};
        const addCatDay = (k, dd, amt) => { (catDay[k] = catDay[k] || {})[dd] = ((catDay[k] || {})[dd] || 0) + amt; };
        days.forEach(d => {
          const secs2 = dayDet(d.date)?.sheets?.[CATSHEET] || [];
          const hasSum = secs2.some(s => s.title === "總結"); // 同 catAgg 口徑：沒有官方總結段就用品項列加總、套餐自成一類
          secs2.forEach(sec => (sec.rows || []).forEach(r => {
            if (!Array.isArray(r) || typeof r[0] !== "string") return;
            const amt = Number(r[r.length - 1]) || 0, qty = Number(r[1]) || 0;
            if (sec.title === "總結") { if (amt > 0) addCatDay(r[0], d.date, amt); return; }
            if (sec.title === "套餐") { if (amt > 0) addCatDay("套餐", d.date, amt); return; }
            if (!hasSum && amt > 0) addCatDay(sec.title, d.date, amt);
            if (qty > 0 && !isQuarterItem(r[0])) (itemDay[r[0]] = itemDay[r[0]] || {})[d.date] = ((itemDay[r[0]] || {})[d.date] || 0) + qty;
          }));
        });
        // 期間彙總（日/週/月）
        const WD2 = ["日", "一", "二", "三", "四", "五", "六"];
        const perKey = (date) => {
          if (posGran === "day") return date;
          if (posGran === "month") return date.slice(0, 7);
          const dt = new Date(date + "T00:00:00"); const mon = new Date(dt); mon.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
          return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
        };
        const perLabel = (k) => posGran === "day" ? `${Number(k.slice(8))}(${WD2[new Date(k + "T00:00:00").getDay()]})` : posGran === "month" ? k : `${Number(k.slice(5, 7))}/${Number(k.slice(8))}週`;
        const periods = (() => {
          const m = {};
          days.forEach(d => {
            const k = perKey(d.date);
            const o = m[k] = m[k] || { key: k, nDays: 0, revenue: 0, txCount: 0, guests: 0, cash: 0, card: 0, linepay: 0, kiosk: 0, kioskTx: 0, uber: 0, discount: 0, ext1: 0, ext2: 0, gd: 0, dates: [] };
            o.nDays++; o.dates.push(d.date);
            ["revenue", "txCount", "guests", "cash", "card", "linepay", "kiosk", "uber", "discount"].forEach(f2 => o[f2] += Number(d[f2]) || 0);
            o.kioskTx += kioskTx(d); // 自助估算單數逐日加總（估）
          });
          // 1/2 參考欄＋GD 欄的週/月加總（張良 2026-09-02：切每週每月也要看得到）——同 perKey 歸 bucket；
          // AB 當週完全沒開的極端情況該週 bucket 不存在＝跳過（AB 天天開，實務不會發生）
          if (abView) {
            Object.entries(extDays).forEach(([dt, v]) => { if (!inPeriodDate(dt)) return; const o = m[perKey(dt)]; if (o) { o.ext1 += Number(v?.s1) || 0; o.ext2 += Number(v?.s2) || 0; } });
            Object.entries(gdByDate).forEach(([dt, v]) => { const o = m[perKey(dt)]; if (o) o.gd += v; });
          }
          return Object.values(m).sort((a, b) => (a.key < b.key ? -1 : 1));
        })();
        const maxPer = Math.max(1, ...periods.map(pp => pp.revenue));
        // 智慧摘要：重點 + 警示 + 建議（全部由原始資料計算）
        const insights = (() => {
          const out = [];
          if (days.length < 2) return out;
          const byRev = [...days].sort((a, b) => b.revenue - a.revenue);
          const wdName = (d) => WD2[new Date(d.date + "T00:00:00").getDay()];
          out.push(["🏆", `最佳 ${byRev[0].date.slice(5)}（${wdName(byRev[0])}）${fmt(byRev[0].revenue)}；最低 ${byRev[byRev.length - 1].date.slice(5)}（${wdName(byRev[byRev.length - 1])}）${fmt(byRev[byRev.length - 1].revenue)}`, { type: "day", key: byRev[0].date }]);
          const wk = days.filter(d => [0, 6].includes(new Date(d.date + "T00:00:00").getDay())), wd = days.filter(d => ![0, 6].includes(new Date(d.date + "T00:00:00").getDay()));
          if (wk.length && wd.length) { const a = sum(wk, "revenue") / wk.length, b = sum(wd, "revenue") / wd.length; out.push(["🗓", `週末日均 ${fmt(Math.round(a))} vs 平日 ${fmt(Math.round(b))}（${a >= b ? "週末" : "平日"}強 ${Math.round(Math.abs(a - b) / Math.max(1, Math.min(a, b)) * 100)}%）`]); }
          if (days.length >= 4) {
            const half = Math.floor(days.length / 2);
            const d1 = days.slice(0, half).map(d => d.date), d2 = days.slice(-half).map(d => d.date);
            const movers = Object.entries(catDay).map(([c, dm]) => { const a = d1.reduce((t, dd) => t + (dm[dd] || 0), 0) / half, b = d2.reduce((t, dd) => t + (dm[dd] || 0), 0) / half; return { c, g: a > 0 ? (b - a) / a : (b > 0 ? 1 : 0), base: a + b }; }).filter(x => x.base > 2000);
            const up = movers.filter(x => x.g > 0.25).sort((a, b) => b.g - a.g).slice(0, 3);
            const dn = movers.filter(x => x.g < -0.25).sort((a, b) => a.g - b.g).slice(0, 3);
            if (up.length) out.push(["🚀", "成長中：" + up.map(x => `${x.c} +${Math.round(x.g * 100)}%`).join("、") + "（前後半期日均比較）"]);
            if (dn.length) out.push(["📉", "下滑中：" + dn.map(x => `${x.c} ${Math.round(x.g * 100)}%`).join("、")]);
            const unstable = Object.entries(itemDay).map(([n, dm]) => { const qs = days.map(d => dm[d.date] || 0); const mean = qs.reduce((a, b) => a + b, 0) / qs.length; if (mean < 1.5) return null; const sd = Math.sqrt(qs.reduce((t, q) => t + (q - mean) ** 2, 0) / qs.length); return { n, cv: sd / mean }; }).filter(Boolean).sort((a, b) => b.cv - a.cv).slice(0, 3);
            if (unstable.length) out.push(["🎢", "銷量最不穩：" + unstable.map(x => `${x.n}（波動${Math.round(x.cv * 100)}%）`).join("、")]);
          }
          const junkCat = (c) => posStore === "abeach" && (AB_SKIP_CATS.has(c) || AB_UBER_CATS.has(c)); // 工具箱/包場/Uber低價類不進滯銷與沒賣提醒（張良 2026-08-19）
          const slow = Object.entries(itemAgg).filter(([, v]) => v.qty <= 2 && v.amt > 0 && !junkCat(v.cat)).map(([n, v]) => `${n}〔${v.cat}・${v.qty}份〕`);
          if (slow.length) out.push(["🐌", `滯銷提醒（期間只賣 ≤2 份）共 ${slow.length} 項：${slow.slice(0, 6).join("、")}${slow.length > 6 ? "…" : ""}（同名但分類不同＝POS 新舊重複品項，建議整併）`, { type: "allitems" }]);
          // 同名分類價差辨識（張良 2026-07-26：賣很少+單價比同名低=外帶類別，要認得出來）
          if (dupeGroups.length) out.push(["👯", `同名品項有分類價差 ${dupeGroups.length} 組（低價版多為外帶/優惠類別）：${dupeGroups.slice(0, 4).map(g => `${g.n}（差 ${fmt(g.diff)}）`).join("、")}${dupeGroups.length > 4 ? "…" : ""}——點我看逐組比對`, { type: "dupes" }]);
          // 連續沒賣偵測（張良 2026-07-26；2026-08-19 大區塊移除後摘要仍提醒，細節開品項明細「😴 7天+沒賣」篩選看）——設定 pm_pos_idlecfg 保留，DD 同一份
          const icfg = posIdleCfg || { days: 7, exCats: [], exItems: [] };
          const lastDate = days[days.length - 1].date;
          const idleItems = Object.entries(itemDay).map(([n, dm]) => { const ds = Object.keys(dm).filter(dd => dm[dd] > 0).sort(); return ds.length ? { n, ld: ds[ds.length - 1], gap: Math.round((new Date(lastDate + "T00:00:00") - new Date(ds[ds.length - 1] + "T00:00:00")) / 864e5), cat: itemAgg[n]?.cat || "" } : null; }).filter(x => x && x.gap >= icfg.days && !icfg.exCats.includes(x.cat) && !icfg.exItems.includes(x.n) && !junkCat(x.cat)).sort((a, b) => b.gap - a.gap);
          if (idleItems.length) out.push(["😴", `沒賣提醒：${idleItems.length} 項超過 ${icfg.days} 天沒賣出（最久 ${idleItems[0].n} ${idleItems[0].gap} 天）——開品項明細的「😴 7天+沒賣」篩選看清單`]);
          // 日別標記（張良 2026-07-26：測試單/包場折扣確認過就不要再嚇人）——警示計算扣掉「排除金額」；沒填金額＝整天全額；原始數字照舊
          const flg = (d, kind) => posFlags?.items?.[`${d.date}::${posStore}::${kind}`];
          const exAmt = (d, kind, raw) => { const f = flg(d, kind); if (!f) return 0; const a = Number(f.amt); return a > 0 ? Math.min(a, raw) : raw; };
          let discRaw = 0, discExAmt = 0, discAbs = 0;
          days.forEach(d => { const raw = Math.abs(d.discount || 0); const e = exAmt(d, "discount", raw); discRaw += raw; discExAmt += e; discAbs += raw - e; });
          if (revSum && discAbs / revSum > 0.03) out.push(["⚠️", `折扣佔營收 ${Math.round(discAbs / revSum * 100)}%（${fmt(discAbs)}）超過 3% 警戒${discExAmt ? `（已排除標記 ${fmt(discExAmt)}）` : ""}——點我看逐筆明細（誰給的、為什麼）`, { type: "coupon" }]);
          let wasteRaw = 0, wasteExAmt = 0, wasteAbs = 0;
          days.forEach(d => { const raw = Math.abs(d.voidItems || 0) + Math.abs(d.returnDish || 0); const e = exAmt(d, "waste", raw); wasteRaw += raw; wasteExAmt += e; wasteAbs += raw - e; });
          if (revSum && wasteAbs / revSum > 0.02) out.push(["⚠️", `退菜＋Void 佔營收 ${Math.round(wasteAbs / revSum * 100)}%（${fmt(wasteAbs)}）偏高${wasteExAmt ? `（已排除標記 ${fmt(wasteExAmt)}）` : ""}——點我看逐日追蹤`, { type: "waste" }]);
          // 常駐審計入口（張良 2026-07-26：標記完警示消失就找不到頁面）——不管有沒有警示都固定在摘要裡
          out.push(["🧾", `退菜＋Void 追蹤：期間 ${fmt(wasteRaw)}${wasteExAmt ? `，排除標記 ${fmt(wasteExAmt)} 後＝${fmt(wasteAbs)}` : ""}——點我看逐日＆標記`, { type: "waste" }]);
          out.push(["🧾", `折扣追蹤：期間 ${fmt(discRaw)}${discExAmt ? `，排除標記 ${fmt(discExAmt)} 後＝${fmt(discAbs)}` : ""}——點我看明細＆標記`, { type: "coupon" }]);
          // 主動偵查：疑似測試/誤操作（退菜=Void 同額且佔營收>20%）與異常大額折扣日——沒標記才提醒，確認後標記就安靜
          days.forEach(d => {
            const rv = Math.abs(d.returnDish || 0), vv = Math.abs(d.voidItems || 0);
            if (rv > 0 && rv === vv && d.revenue && rv / d.revenue > 0.2 && !flg(d, "waste")) out.push(["🚨", `${d.date.slice(5)} 退菜＝Void 同額 ${fmt(rv)}（佔營收 ${Math.round(rv / d.revenue * 100)}%）疑似測試/誤操作——點我看該日逐筆，確認後按「＋標記」排除`, { type: "tx", key: d.date }]);
            const dd = Math.abs(d.discount || 0);
            if (dd > 20000 && !flg(d, "discount")) out.push(["🚨", `${d.date.slice(5)} 單日折扣 ${fmt(dd)} 異常大——確認原因後到明細按「＋標記」（包場/行銷）排除警示`, { type: "coupon" }]);
          });
          if (avgTicket) { const t1 = days.slice(0, Math.floor(days.length / 2)), t2 = days.slice(-Math.floor(days.length / 2)); const g1 = sum(t1, "guests"), g2 = sum(t2, "guests"); if (g1 && g2) { const a = sum(t1, "revenue") / g1, b = sum(t2, "revenue") / g2; if (Math.abs(b - a) / a > 0.15) out.push([b > a ? "💡" : "🔻", `客單價${b > a ? "上升" : "下降"}：前半 ${fmt(Math.round(a))} → 後半 ${fmt(Math.round(b))}`]); } }
          return out;
        })();
        // ── 下鑽：每種數字 → 組成它的原始資料列 ──
        const pct1 = (v) => typeof v === "number" && v <= 1 ? (v * 100).toFixed(1) + "%" : (v ?? "");
        // 依段落表頭把原始列解成固定欄位（名稱/數量/佔比/金額/備註）
        const parseRow = (sec, r) => {
          const cells = Array.isArray(r) ? r : [r];
          const name = String(cells[0] ?? "");
          const rest = cells.slice(1);
          const labels = (sec.header || []).map(x => String(x)).slice(1);
          const numsN = rest.filter(c => typeof c === "number").length;
          let qty = "", pctS = "", amt = "", note = [];
          let li = 0;
          for (const c of rest) {
            if (typeof c !== "number") { if (String(c).trim()) note.push(String(c)); continue; }
            let lab = labels[li++] || "";
            if (!lab) lab = (c > 0 && c < 1) ? "%" : (numsN >= 2 && li === 1 ? "數量" : "金額");
            if (numsN === 1 && note.length) lab = "金額"; // 例：優惠券的單號列（D21・小胖・原因・480）
            if (/數量/.test(lab)) qty = c;
            else if (lab.includes("%")) pctS = c <= 1 ? (c * 100).toFixed(1) + "%" : c + "%";
            else amt = fmt(c);
          }
          return [name, qty, pctS, amt, note.join("・")];
        };
        const buildDrill = (dr) => {
          if (!dr) return null;
          if (dr.type === "days") return {
            title: "日結原始資料（Balance Sheet 概覽）", cols: ["日期", "營收", "單數", "來客", "客單", "現金", "信用卡", "LINE Pay", "自助點餐·%", "Uber", "折扣", "服務費", "退菜", "Void"],
            rows: [...days].reverse().map(d => [d.date, fmt(d.revenue), d.txCount, d.guests || "—", d.guests ? fmt(ticket(d.revenue, d.guests)) : "—", fmt(d.cash || 0), fmt(d.card || 0), d.linepay ? fmt(d.linepay) : "—", d.kiosk ? `${fmt(d.kiosk)}·${d.revenue ? Math.round(d.kiosk / d.revenue * 100) : 0}%` : "—", fmt(d.uber || 0), fmt(d.discount || 0), fmt(d.serviceFee || 0), fmt(d.returnDish || 0), fmt(d.voidItems || 0)]),
            note: "來源：每日 POS 日結信 Balance Sheet 分頁 → 資料庫 pm_pos（只增不改）",
          };
          if (dr.type === "cat") {
            const raw = [...days].reverse().flatMap(d => (dayDet(d.date)?.sheets?.[CATSHEET] || []).filter(sec => sec.title === dr.key).flatMap(sec => (sec.rows || []).filter(r => !isQuarterItem(r[0])).map(r => ({ date: d.date, name: String(r[0]), cat: dr.key, qty: Number(r[1]) || 0, pct: r[2], amt: Number(r[r.length - 1]) || 0 }))));
            return {
              title: `分類「${dr.key}」逐日商品明細`, cols: ["日期", "品項", "數量", "佔比", "金額"],
              rows: raw.map(x => [x.date, x.name, x.qty, pct1(x.pct), fmt(x.amt)]), raw, pivot: true,
              note: "來源：日結信「總銷售額(以類別分類)」分頁 → 明細資料庫 pm_pos_d_月份",
            };
          }
          if (dr.type === "catmatrix") {
            const raw = [...days].reverse().flatMap(d => Object.entries(catDay).filter(([, dm]) => dm[d.date]).map(([c, dm]) => ({ date: d.date, name: c, cat: c, qty: dm[d.date], amt: dm[d.date] })));
            return {
              title: "全類別 × 日期（金額）", cols: ["日期", "分類", "金額"],
              rows: raw.map(x => [x.date, x.name, fmt(x.amt)]), raw, pivot: true, pivotMoney: true,
              note: "來源：日結信「總銷售額(以類別分類)」總結段 → 明細資料庫 pm_pos_d_月份・格子＝當日該分類營收",
            };
          }
          if (dr.type === "allitems") {
            const raw = [...days].reverse().flatMap(d => (dayDet(d.date)?.sheets?.[CATSHEET] || []).filter(sec => sec.title !== "總結").flatMap(sec => (sec.rows || []).filter(r => !isQuarterItem(r[0])).map(r => ({ date: d.date, name: String(r[0]), cat: sec.title, qty: Number(r[1]) || 0, pct: r[2], amt: Number(r[r.length - 1]) || 0 }))));
            return {
              title: "全部品項 × 日期（所有分類）", cols: ["日期", "分類", "品項", "數量", "佔比", "金額"],
              rows: raw.map(x => [x.date, x.cat, x.name, x.qty, pct1(x.pct), fmt(x.amt)]), raw, pivot: true, defaultPivot: true,
              note: "來源：日結信「總銷售額(以類別分類)」全部分類 → 明細資料庫 pm_pos_d_月份",
            };
          }
          if (dr.type === "item") {
            const raw = [...days].reverse().flatMap(d => (dayDet(d.date)?.sheets?.[CATSHEET] || []).filter(sec => sec.title !== "總結").flatMap(sec => (sec.rows || []).filter(r => r[0] === dr.key).map(r => ({ date: d.date, name: String(r[0]), cat: sec.title, qty: Number(r[1]) || 0, pct: r[2], amt: Number(r[r.length - 1]) || 0 }))));
            return {
              title: `商品「${dr.key}」逐日銷售`, cols: ["日期", "分類", "數量", "佔比", "金額"],
              rows: raw.map(x => [x.date, x.cat, x.qty, pct1(x.pct), fmt(x.amt)]), raw, pivot: true,
              note: "來源：日結信「總銷售額(以類別分類)」分頁 → 明細資料庫 pm_pos_d_月份",
            };
          }
          if (dr.type === "dupes") return {
            title: "同名品項・分類價差比對（低價版多為外帶類別）", cols: ["品項", "分類", "份數", "金額", "單價", "判讀"],
            rows: dupeGroups.flatMap(g => g.cats.map((c2, i) => [g.n, c2.cat, c2.qty, fmt(c2.amt), fmt(c2.unit), i === 0 ? "主要版（單價最高）" : `疑似外帶/優惠版（低 ${fmt(g.cats[0].unit - c2.unit)}）`])),
            note: "單價＝期間金額÷份數。同一道菜出現在多個分類且單價不同＝POS 裡的外帶/優惠版本。沒賣預警與品項彙總已把同名合併計算（不會把外帶版誤報成滯銷）；這張表是給你決定要不要在 POS 整併品項用",
          };
          if (dr.type === "pay") {
            const K2 = { card: ["card", "cardCount", "信用卡"], cash: ["cash", "cashCount", "現金"], linepay: ["linepay", "linepayCount", "LINE Pay（含自助點餐）"], kiosk: ["kiosk", "kioskCount", "自助點餐（機台刷卡＋LINE Pay(APP)）"], uber: ["uber", "uberCount", "UberEats"] }[dr.key];
            return {
              title: `付款方式「${K2[2]}」逐日`, cols: ["日期", "金額", "筆數", "佔當日營收"],
              rows: [...days].reverse().map(d => [d.date, fmt(d[K2[0]] || 0), dr.key === "kiosk" ? (kioskTx(d) ? `約${kioskTx(d)}(估)` : "—") : (d[K2[1]] ?? "—"), d.revenue ? Math.round((d[K2[0]] || 0) / d.revenue * 100) + "%" : "—"]),
              note: dr.key === "kiosk" ? "自助點餐＝機台刷卡＋LINE Pay(APP)，金額已含在信用卡/LINE Pay 內；筆數＝金額÷當日單均的估算值（喬亞行動報表不提供付款別筆數，要真值需向喬亞開通正式後台報表）" : "來源：日結信 Balance Sheet「付款方式」段 → 資料庫 pm_pos",
            };
          }
          if (dr.type === "waste") return {
            title: "退菜＋Void（作廢）逐日追蹤", cols: ["日期", "退菜", "Void", "退單", "合計", "佔當日營收", "標記"],
            rows: [...days].reverse().map(d => {
              const w = Math.abs(d.returnDish || 0) + Math.abs(d.voidItems || 0);
              return [d.date, fmt(Math.abs(d.returnDish || 0)), fmt(Math.abs(d.voidItems || 0)), d.refund || 0, fmt(w), d.revenue ? (w / d.revenue * 100).toFixed(1) + "%" : "—", ""];
            }),
            rowClick: (r) => ({ type: "tx", key: r[0] }),
            flagCol: { kind: "waste", dateIdx: 0 },
            note: "Void＝結帳前作廢的品項（點錯/客人改單/廚房已做但取消）；退菜＝送出後退回；退單＝整張單退掉。兩欄同額時很可能是同一筆事件被計兩次——點任一列＝看該日逐筆交易；確認是測試/包場就按「＋標記」，警示與佔比不再計入（原始數字保留）",
          };
          if (dr.type === "tx") {
            // 逐筆交易（日結信 Transaction 附件）：結構未知先泛用渲染——表頭原樣、金額欄加千分位、作廢/退相關整列紅字
            const mo2 = String(dr.key).slice(0, 7);
            const txDoc = posTx[mo2];
            const m3 = txDoc?.days;
            const ent3 = m3 ? (m3[`${dr.key}::${posStore}`] || ((m3[dr.key] && storeKeyOf(m3[dr.key].store) === posStore) ? m3[dr.key] : null)) : null;
            const t3 = ent3?.tx;
            const ttl = `${dr.key.slice(5)}（${WD2[new Date(dr.key + "T00:00:00").getDay()]}）逐筆交易`;
            const back = { label: "← 回逐日追蹤", dr: { type: "waste" } };
            if (!t3) return {
              title: ttl, cols: ["說明"], rows: [], back,
              note: txDoc === undefined ? "載入中…再點一下重新整理" : "這一天的逐筆交易還沒入庫——按上面的「🔄 更新」補抓一次（新日結信自動入庫；舊日期只要信還在信箱也會自動回補）",
            };
            const isMoneyCol = (h) => /金額|amount|total|小計|合計|稅|服務費|折扣|價|退|void/i.test(String(h));
            // 狀態統計放最前面：60 筆裡有 1 筆已取消，先講重點再看清單（張良 2026-07-26）
            const si3 = t3.h.findIndex(h => /狀態|status/i.test(String(h)));
            const stat3 = {};
            if (si3 >= 0) t3.r.forEach(row => { const s = String(row[si3] || "—"); stat3[s] = (stat3[s] || 0) + 1; });
            const statTxt = Object.entries(stat3).sort((a, b) => a[1] - b[1]).map(([s, n]) => `${s} ${n} 筆`).join("、");
            return {
              title: ttl, cols: t3.h, back,
              rows: t3.r.map(row => t3.h.map((h, j) => { const v = row[j]; return typeof v === "number" ? (isMoneyCol(h) ? fmt(v) : String(v)) : (v ?? ""); })),
              numIdx: new Set(t3.h.map((_, j) => j).filter(j => t3.r.some(row => typeof row[j] === "number"))),
              redRow: (row) => row.some(c => /void|作廢|退菜|退單|取消|refund/i.test(String(c))),
              note: `本日 ${t3.r.length} 筆${statTxt ? `：${statTxt}` : ""}・紅字列＝作廢/退/取消相關（點「狀態」欄標題可把它排到最上面）・來源：日結信 Transaction 附件逐筆無刪減入庫`,
            };
          }
          if (dr.type === "coupon") {
            // ① POS 一筆拆兩列（品項列＋單號列、金額相同）→ 相鄰配對併回一列
            // ② 依用途自動分類（客訴補償/試菜/夥伴/VIP/招待/一般優惠）→ 上方彙總卡＋明細按類別分組（張良 2026-07-20：流水帳看不出分析）
            const couponClass = (t) => {
              if (/客訴|投訴|滴到|不足|做錯|上錯|送錯|太慢|等太久|重做|補償|道歉|異物|瑕疵|冷掉/.test(t)) return "客訴補償";
              if (/試菜/.test(t)) return "試菜";
              if (/夥伴|員工|自己人/.test(t)) return "夥伴/員工";
              if (/VIP|貴賓/i.test(t)) return "VIP";
              if (/招待|常客|贈送/.test(t)) return "招待/行銷";
              return "一般優惠/折扣";
            };
            const CAT_ORDER = ["客訴補償", "試菜", "夥伴/員工", "VIP", "招待/行銷", "一般優惠/折扣", "（日小計）"];
            const recs = [];
            [...days].reverse().forEach(d => (dayDet(d.date)?.sheets?.["優惠券"] || []).forEach(sec => {
              const parsed = (sec.rows || []).map(r => parseRow(sec, r)); // [名稱, 數量, 佔比, 金額, 經手備註]
              for (let i = 0; i < parsed.length; i++) {
                const a = parsed[i], b = parsed[i + 1];
                let name = a[0], qty = a[1], pctS = a[2], amtS = a[3], who = a[4];
                if (b && a[1] !== "" && !a[4] && b[1] === "" && b[3] === a[3] && (b[4] || /^[A-Z]{1,2}\d+/.test(b[0]))) { name = `${a[0]}｜${b[0]}`; who = b[4] || "—"; i++; }
                const isSubtotal = a[0] === "優惠券" && a[1] === "" && !a[4];
                const cat = isSubtotal ? "（日小計）" : couponClass(name + " " + who);
                recs.push({ cat, date: d.date, blk: sec.title || "優惠券", name, qty, pctS, amtS, who, amtN: Number(String(amtS).replace(/[^0-9.-]/g, "")) || 0 });
              }
            }));
            const real = recs.filter(x => x.cat !== "（日小計）");
            const totalN = real.reduce((t, x) => t + x.amtN, 0);
            const summary = CAT_ORDER.filter(c2 => c2 !== "（日小計）").map(c2 => { const g2 = real.filter(x => x.cat === c2); return g2.length ? { label: c2, n: g2.length, amt: fmt(g2.reduce((t, x) => t + x.amtN, 0)), pct: totalN ? Math.round(g2.reduce((t, x) => t + x.amtN, 0) / totalN * 100) + "%" : "—" } : null; }).filter(Boolean);
            recs.sort((x, y) => CAT_ORDER.indexOf(x.cat) - CAT_ORDER.indexOf(y.cat) || (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
            // 逐日視圖（張良 2026-07-21）：直式＝日期一列（預設）、⇄轉置＝類別一列日期一欄
            const CATS = CAT_ORDER.filter(c2 => c2 !== "（日小計）");
            const byDay = {};
            real.forEach(x => { const o = byDay[x.date] = byDay[x.date] || {}; o[x.cat] = (o[x.cat] || 0) + x.amtN; });
            const dayKeys = Object.keys(byDay).sort().reverse();
            const revOf = (dt) => (days.find(d2 => d2.date === dt) || {}).revenue || 0;
            const dayTotal = (dt) => Object.values(byDay[dt]).reduce((t, v) => t + v, 0);
            const cellV = (dt, c2) => (byDay[dt][c2] ? fmt(byDay[dt][c2]) : "");
            const catTotal = (c2) => real.filter(x => x.cat === c2).reduce((t, x) => t + x.amtN, 0);
            const daily = {
              v: { cols: ["日期", ...CATS, "合計", "佔當日營收", "標記"], rows: dayKeys.map(dt => [dt, ...CATS.map(c2 => cellV(dt, c2)), fmt(dayTotal(dt)), revOf(dt) ? (dayTotal(dt) / revOf(dt) * 100).toFixed(1) + "%" : "", ""]), flagCol: { kind: "discount", dateIdx: 0 } },
              t: { cols: ["類別", ...dayKeys.map(dt => dt.slice(5)), "期間合計"], rows: [...CATS.map(c2 => [c2, ...dayKeys.map(dt => cellV(dt, c2)), fmt(catTotal(c2))]), ["合計", ...dayKeys.map(dt => fmt(dayTotal(dt))), fmt(totalN)]] },
            };
            return {
              title: "優惠券 / 折扣明細（依用途分類）", cols: ["類別", "日期", "品項｜單號", "數量", "佔比", "金額", "經手・原因"],
              rows: recs.map(x => [x.cat, x.date, x.name, x.qty, x.pctS, x.amtS, x.who]),
              summary, daily,
              note: "來源：日結信「優惠券」分頁・已自動併列＋依關鍵字分類（客訴/試菜/夥伴/VIP/招待/一般）・（日小計）＝POS 每日總額列不計入彙總・點欄位標題可排序",
            };
          }
          if (dr.type === "day") {
            const det = dayDet(dr.key);
            const dEnt = days.find(x => x.date === dr.key) || {};
            const rows = [];
            // Balance Sheet 概覽（日結摘要）放最前面
            [["總收入", dEnt.revenue], ["交易數量", dEnt.txCount, true], ["人數(堂食)", dEnt.guests, true], ["銷售", dEnt.sales], ["服務費", dEnt.serviceFee], ["折扣", dEnt.discount], ["現金", dEnt.cash], ["信用卡", dEnt.card], ["LINE Pay", dEnt.linepay], ["其他付款", dEnt.payOther], ["自助點餐(通路,已含在卡/LINE Pay內)", dEnt.kiosk], ["UberEats", dEnt.uber], ["退菜", dEnt.returnDish], ["Void", dEnt.voidItems]].forEach(([lb, v, isCnt]) => {
              if (v != null && v !== 0) rows.push(["Balance Sheet", "概覽", lb, isCnt ? v : "", "", isCnt ? "" : fmt(v), ""]);
            });
            Object.entries(det?.sheets || {}).forEach(([sn, secs]) => secs.forEach(sec => (sec.rows || []).forEach(r => rows.push([sn.replace(/總銷售額 |[()（）]/g, ""), sec.title, ...parseRow(sec, r)]))));
            return { title: `${dr.key} 當日完整原始資料（${det?.period || ""}）`, cols: ["分頁", "區塊", "名稱", "數量", "佔比", "金額", "備註"], rows, note: "來源：當日日結信全部六個分頁，無刪減入庫" };
          }
          return null;
        };
        const drill = buildDrill(posDrill);
        const openDrill = (dr) => { setPosDrillView(["allitems", "catmatrix"].includes(dr.type) ? "pivot" : "list"); setPosDrillSort(null); setPosPivotCats(null); setPosPivotSort(null); setPosDrill(dr); };
        // 日別標記存檔（pm_pos_flags 一份文件；key=日期::店::類別）
        const saveFlags = (next) => { setPosFlags(next); window.storage.set(K("pm_pos_flags"), JSON.stringify(next), true).catch(() => {}); };
        const removeFlag = (fkey) => { const next = { ...(posFlags || { items: {} }), items: { ...(posFlags?.items || {}) } }; delete next.items[fkey]; saveFlags(next); };
        const saveIdleCfg = (next) => { setPosIdleCfg(next); window.storage.set(K("pm_pos_idlecfg"), JSON.stringify(next), true).catch(() => {}); };
        const WD = ["日", "一", "二", "三", "四", "五", "六"];
        const wd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? `${v.slice(5)}（${WD[new Date(v + "T00:00:00").getDay()]}）` : v;
        const kpi = (label, val, sub2, cl, onClick) => (
          <div key={label} onClick={onClick} title="點我看組成明細" style={{ background: C.card, border: "1.5px solid #c8bca6", borderRadius: 8, padding: "10px 14px", flex: "1 1 128px", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#3a6ea5"} onMouseLeave={e => e.currentTarget.style.borderColor = "#c8bca6"}>
            <div style={{ fontFamily: MONOF, fontSize: 21, fontWeight: 700, color: cl || C.text, whiteSpace: "nowrap" }}>{val}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{label}{sub2 ? <span style={{ color: C.faint }}>・{sub2}</span> : null}</div>
          </div>
        );
        const barRow = (label, amt, total, cl, extra, onClick, exW, lw) => ( // exW＝右側附註欄寬（時段圖「單數・單均」比 % 長）；lw＝左標籤欄寬（半小時模式時間範圍較長）
          <div key={label} onClick={onClick} title="點我看組成明細" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, cursor: "pointer", borderRadius: 5, padding: "1px 2px" }}
            onMouseEnter={e => e.currentTarget.style.background = "#f4efe5"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ fontSize: 11.5, color: C.sub, width: lw || 118, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={label}>{label}</span>
            <div style={{ flex: 1, height: 10, background: "#eee5d3", borderRadius: 5, overflow: "hidden" }}><div style={{ width: Math.max(1, amt / total * 100) + "%", height: "100%", background: cl, borderRadius: 5 }} /></div>
            <span style={{ fontFamily: MONOF, fontSize: 11, color: C.text, width: 84, textAlign: "right" }}>{fmt(amt)}</span>
            {extra != null && <span style={{ fontFamily: MONOF, fontSize: 10, color: C.faint, width: exW || 40, textAlign: "right", whiteSpace: "nowrap" }}>{extra}</span>}
          </div>
        );
        const chartBox2 = { background: C.card, border: "1.5px solid #c8bca6", borderRadius: 8, padding: "10px 14px" };
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <span style={{ background: "#3f7d4e", color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px", letterSpacing: 1 }}>營運報表</span>
              {/* 分店切換（第三層）：兩間店各看各的營收 */}
              <div style={{ display: "inline-flex", background: C.soft, border: `1.5px solid #c8bca6`, borderRadius: 8, padding: 2, gap: 2 }}>
                {STORES.map(([v, l]) => (
                  <button key={v} onClick={() => { setPosStore(v); setGdTab("全部"); setGdSort(null); setGdIdle(false); }} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: posStore === v ? C.brand : "transparent", color: posStore === v ? "#fff" : C.sub, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
              {/* 更新鈕緊跟店名右邊（張良 2026-07-18 手機版面優化） */}
              <button onClick={runPosSync} disabled={posSyncBusy} title="信箱有新日結信就立刻入庫" style={{ border: `1px solid ${C.blue}`, background: "#fff", color: C.blue, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: posSyncBusy ? "wait" : "pointer" }}>{posSyncBusy ? "更新中…" : "🔄 更新"}</button>
              {/* 手動匯入舊日結（張良 2026-07-30）：POS 後台下載的 DailyClosing / Transaction 檔可多選一次丟入 */}
              <label title="補信箱開通前的舊資料：把 Eats365 後台下載的 DailyClosing（日結）/ Transaction（逐筆）檔選進來，可一次多選" style={{ border: `1px solid ${C.green}`, background: "#fff", color: C.green, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: posSyncBusy ? "wait" : "pointer" }}>
                📥 匯入舊報表
                <input type="file" multiple accept=".xls,.xlsx" disabled={posSyncBusy} style={{ display: "none" }} onChange={e => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) importPosFiles(fs); }} />
              </label>
              <div style={{ flex: 1 }} />
              {/* 期間：全部 / 選月份 / 自訂（張良：近X天太多，改三種） */}
              <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                {[["all", "全部"], ["month", "選月份"], ["custom", "自訂"]].map(([v, l]) => (
                  <button key={v} onClick={() => setPosPeriod(p => ({ ...p, mode: v, month: v === "month" ? (p.month || monthsAvail[0] || "") : p.month }))} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${posPeriod.mode === v ? C.line : "transparent"}`, background: posPeriod.mode === v ? "#fff" : "transparent", color: posPeriod.mode === v ? C.text : C.sub, fontSize: 12.5, fontWeight: posPeriod.mode === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
              {posPeriod.mode === "month" && (
                <select value={posPeriod.month} onChange={e => setPosPeriod(p => ({ ...p, month: e.target.value }))} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 700, background: "#fff", color: C.text }}>
                  {monthsAvail.map(m => <option key={m} value={m}>{Number(m.slice(0, 4))}年{Number(m.slice(5))}月</option>)}
                </select>
              )}
              {posPeriod.mode === "custom" && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input type="date" value={posPeriod.from} onChange={e => setPosPeriod(p => ({ ...p, from: e.target.value }))} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 8px", fontSize: 12, background: "#fff", color: C.text, colorScheme: "light" }} />
                  <span style={{ fontSize: 12, color: C.faint }}>～</span>
                  <input type="date" value={posPeriod.to} onChange={e => setPosPeriod(p => ({ ...p, to: e.target.value }))} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 8px", fontSize: 12, background: "#fff", color: C.text, colorScheme: "light" }} />
                </span>
              )}
              <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                {[["day", "每天"], ["week", "每週"], ["month", "每月"]].map(([v, l]) => (
                  <button key={v} onClick={() => setPosGran(v)} style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${posGran === v ? C.line : "transparent"}`, background: posGran === v ? "#fff" : "transparent", color: posGran === v ? C.text : C.sub, fontSize: 12.5, fontWeight: posGran === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
            </div>
            {posMsg && <div style={{ background: "#eef5ef", border: `1.5px solid ${C.green}`, borderRadius: 8, padding: "7px 12px", marginBottom: 10, fontSize: 12.5, color: "#2c5a38", fontWeight: 600 }}>{posMsg}</div>}
            {!days.length ? (
              <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10 }}>
                {posStore === "ground"
                  ? "GROUN:D 還沒有日結資料——去 Eats365 後台把 GROUN:D 的日結報表設定寄到 goodmask77@gmail.com，之後每天會自動進來。"
                  : "還沒有資料——POS 日結信寄到後會自動進來（每天）。"}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  {kpi("期間營收", fmt(revSum), days.length + " 天", "#3f7d4e", () => openDrill({ type: "days" }))}
                  {kpi("日均營收", fmt(Math.round(revSum / days.length)), null, null, () => openDrill({ type: "days" }))}
                  {kpi("交易數", txSum, null, null, () => openDrill({ type: "days" }))}
                  {txSum > 0 && kpi("每單平均", fmt(Math.round(revSum / txSum)), "營收÷單數", "#3a6ea5", () => openDrill({ type: "days" }))}
                  {hasGuests && kpi("來客(堂食)", guestSum || "—", avgTicket ? "客單 " + fmt(avgTicket) : null, null, () => openDrill({ type: "days" }))}
                  {hasKiosk && kpi("自助點餐", fmt(paySum.kiosk), (revSum ? "佔營收 " + Math.round(paySum.kiosk / revSum * 100) + "%" : "") + (kioskTxSum ? "・約 " + kioskTxSum + " 單(估)" : ""), "#6b4a86", () => openDrill({ type: "pay", key: "kiosk" }))}
                  {kpi(last.intraday ? "今天（盤中）" : "最新一天", fmt(last.revenue), last.intraday ? (last.fetchedAt || "") + " 更新" : last.date.slice(5), last.intraday ? "#b3261e" : null, () => openDrill({ type: "day", key: last.date }))}
                </div>
                {/* 盤中即時（張良 2026-08-27）：joya-intraday 每半小時~一小時抓「今天」進來，打烊後自動換正式值 */}
                {last?.intraday && (
                  <div style={{ background: "#fdecea", border: "1.5px solid #f0b8b1", borderRadius: 8, padding: "7px 12px", marginBottom: 12, fontSize: 12.5, color: "#8c1d18", fontWeight: 600 }}>
                    🔴 今天是「盤中即時數字」（{last.fetchedAt || "—"} 從喬亞抓的）——還沒打烊，之後還會長大；打烊後自動換成正式結帳數字。
                  </div>
                )}
                {posGran === "day" ? (
                <div style={{ border: "1.5px solid #c8bca6", borderRadius: 8, background: C.card, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}><div style={{ minWidth: (hasGuests ? 1072 : 928) + (hasKiosk ? 156 : 0) + (hasExt ? 168 : 0) - (hasLinepay ? 0 : 96) + (abView ? -44 : 0) + (hasLunch ? 116 : 0) }}>
                    {(() => {
                      const GTC = (abView ? "118px " : "118px minmax(140px,1fr) ") + (hasExt ? "84px 84px " : "") + (hasLunch ? "116px " : "") + (abView ? "96px 96px " : "96px ") + "64px 76px " + (hasGuests ? "64px 80px " : "") + "96px 96px " + (hasLinepay ? "96px " : "") + "96px 80px" + (hasKiosk ? " 156px" : ""); // abView：店欄刪除、營收=AB＋右加GD（張良 2026-09-02） // 張良 2026-08-26 加「單均」欄；2026-08-27 沒來客資料的店隱藏來客/客單欄；2026-08-29 加 LINE Pay 欄（2026-09-01 起沒資料的店整欄隱藏）＋自助點餐通路欄；2026-09-01 加「1」「2」參考欄（店名與營收之間）
                      const hc = { fontSize: 10.5, letterSpacing: 0.8, color: C.faint, fontWeight: 700, padding: "7px 8px", whiteSpace: "nowrap" };
                      const cell = (v, extra) => <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, textAlign: "right", color: C.sub, ...extra }}>{v}</div>;
                      return (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: GTC, background: C.soft, borderBottom: "1.5px solid #c8bca6" }}>
                            <div style={hc}>日期</div>{!abView && <div style={hc}>店</div>}{hasExt && <><div style={{ ...hc, textAlign: "right", color: "#8a7f6a" }} title="參考數據">1</div><div style={{ ...hc, textAlign: "right", color: "#8a7f6a" }} title="參考數據">2</div></>}{hasLunch && <div style={{ ...hc, textAlign: "right", color: "#2f6d5a" }} title="開店到 14:00 的累計營業額（中午餐期＝到兩點為止；時段表加總，與時段消費同一份資料）；灰字＝佔全日 %">至14:00</div>}<div style={{ ...hc, textAlign: "right" }}>{abView ? "AB" : "營收"}</div>{abView && <div style={{ ...hc, textAlign: "right", color: "#b3492f" }}>GD</div>}<div style={{ ...hc, textAlign: "right" }}>單數</div><div style={{ ...hc, textAlign: "right" }}>單均(÷單數)</div>{hasGuests && <><div style={{ ...hc, textAlign: "right" }}>來客</div><div style={{ ...hc, textAlign: "right" }}>客單(÷來客)</div></>}<div style={{ ...hc, textAlign: "right" }}>現金</div><div style={{ ...hc, textAlign: "right" }}>信用卡</div>{hasLinepay && <div style={{ ...hc, textAlign: "right" }}>LINE Pay</div>}<div style={{ ...hc, textAlign: "right" }}>Uber</div><div style={{ ...hc, textAlign: "right" }}>折扣</div>{hasKiosk && <div style={{ ...hc, textAlign: "right", color: "#6b4a86" }} title="自助點餐機（機台刷卡＋LINE Pay(APP)）——金額已含在信用卡/LINE Pay 內，看通路占比用；單數＝金額÷當日單均的估算值（喬亞不提供付款別筆數）">自助點餐·%·約單</div>}
                          </div>
                          <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
                            {(() => {
                              // 週末辨識（張良 2026-07-24）：六日列淡琥珀底＋日期琥珀字；跨週處畫粗分隔線
                              const monOf = (ds) => { const dt = new Date(ds + "T00:00:00"); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`; };
                              const arr = [...days].reverse();
                              // 「今天（即時）」虛擬列（張良 2026-09-02）：AB 日結信打烊才到＝今天沒有列，
                              // 但 1/2（🔄更新抓 iCHEF 到目前為止）與 GD（盤中每30分自動）已有今天數字→補一列顯示；明天真日結入庫後自動被真列取代
                              const twToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
                              const exT = extDays[twToday] || {}; const gdT = gdByDate[twToday] || 0;
                              const abT = abLive && abLive.date === twToday && abLive.revenue ? abLive : null; // AB 後台即時（Eats365）
                              const showLive = abView && inPeriodDate(twToday) && !days.some(d => d.date === twToday) && (exT.s1 || exT.s2 || gdT || abT);
                              const liveRow = showLive ? (() => {
                                const gdL = new Date(twToday + "T00:00:00").getDay();
                                const dashN = 2 + (hasGuests ? 2 : 0) + 2 + (hasLinepay ? 1 : 0) + 2 + (hasKiosk ? 1 : 0); // 單數/單均/(來客/客單)/現金/卡/(LINE Pay)/Uber/折扣/(自助)
                                return (
                                  <div key="live-today" title="今天的即時數字：1/2/AB＝按「🔄 更新」抓後台到目前為止、GD＝盤中每30分自動；打烊日結入庫後這列自動換成正式數字" style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "center", minHeight: 32, background: "#fdf6ec", borderBottom: "1.5px dashed #c8bca6" }}>
                                    <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, color: "#b3261e", fontWeight: 700 }}>{twToday.slice(2)}（{WD2[gdL]}）<span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, background: "#fdecea", border: "1px solid #f0b8b1", borderRadius: 5, padding: "1px 4px" }}>即時</span></div>
                                    {hasExt && <>{cell(exT.s1 ? fmt(exT.s1) : "—", { color: "#8a7f6a" })}{cell(exT.s2 ? fmt(exT.s2) : "—", { color: "#8a7f6a" })}</>}
                                    {cell(abT ? <>{fmt(abT.revenue)}<span style={{ fontSize: 9.5, color: C.faint, fontWeight: 400 }}> {abT.at}</span></> : "—", abT ? { color: "#b3261e", fontWeight: 700 } : { color: "#d5cbb6" })}
                                    {cell(gdT ? fmt(gdT) : "—", gdT ? { color: "#b3492f", fontWeight: 600 } : { color: "#d5cbb6" })}
                                    {Array.from({ length: dashN }, (_, j) => <div key={"dz" + j} style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, textAlign: "right", color: "#d5cbb6" }}>—</div>)}
                                  </div>
                                );
                              })() : null;
                              return [liveRow, ...arr.map((d, i) => {
                              const gd = new Date(d.date + "T00:00:00").getDay(), wknd = gd === 0 || gd === 6;
                              const newWeek = i > 0 && monOf(arr[i - 1].date) !== monOf(d.date);
                              const rowBg = wknd ? "#f6ecd3" : i % 2 ? "#f8f4ea" : C.card;
                              return (
                              <div key={d.id} onClick={() => openDrill({ type: "day", key: d.date })} title="點我看該日完整原始資料" style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "center", minHeight: 32, borderTop: i ? (newWeek ? "2px solid #c8bca6" : "1px solid #f0ead9") : "none", background: rowBg, cursor: "pointer" }}
                                onMouseEnter={e => e.currentTarget.style.background = "#f4efe5"} onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                                <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, color: wknd ? "#a97a10" : C.sub, fontWeight: wknd ? 700 : 400 }}>{d.date.slice(2)}（{WD2[gd]}）</div>
                                {!abView && <div style={{ padding: "0 8px", fontSize: 11.5, color: C.sub, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{d.store}{d.intraday && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#b3261e", background: "#fdecea", border: "1px solid #f0b8b1", borderRadius: 5, padding: "1px 5px" }}>盤中 {d.fetchedAt || ""} 更新</span>}</div>}
                                {hasExt && <>{cell(extDays[d.date]?.s1 ? fmt(extDays[d.date].s1) : "—", { color: "#8a7f6a" })}{cell(extDays[d.date]?.s2 ? fmt(extDays[d.date].s2) : "—", { color: "#8a7f6a" })}</>}
                                {hasLunch && (() => { const lv = lunchByDate[d.date]; return cell(lv != null ? <>{fmt(lv)}<span style={{ color: C.faint, fontWeight: 400 }}>·{d.revenue ? Math.round(lv / d.revenue * 100) : 0}%</span></> : "—", lv != null ? { color: "#2f6d5a", fontWeight: 600 } : { color: "#d5cbb6" }); })()}
                                {cell(fmt(d.revenue), { fontWeight: 700, color: C.text })}
                                {abView && cell(gdByDate[d.date] ? fmt(gdByDate[d.date]) : "—", gdByDate[d.date] ? { color: "#b3492f", fontWeight: 600 } : { color: "#d5cbb6" })}
                                {cell(d.txCount)}{cell(d.txCount ? fmt(Math.round(d.revenue / d.txCount)) : "—", { color: "#3a6ea5", fontWeight: 600 })}{hasGuests && <>{cell(d.guests || "—")}{cell(d.guests ? fmt(ticket(d.revenue, d.guests)) : "—")}</>}
                                {cell(fmt(d.cash || 0))}{cell(fmt(d.card || 0))}{hasLinepay && cell(d.linepay ? fmt(d.linepay) : "—", d.linepay ? undefined : { color: "#d5cbb6" })}{cell(fmt(d.uber || 0))}
                                {cell(d.discount ? fmt(d.discount) : "—", { color: d.discount ? C.accent : "#d5cbb6" })}
                                {hasKiosk && cell(d.kiosk ? `${fmt(d.kiosk)}·${d.revenue ? Math.round(d.kiosk / d.revenue * 100) : 0}%·約${kioskTx(d)}單` : "—", d.kiosk ? { color: "#6b4a86", fontWeight: 600 } : { color: "#d5cbb6" })}
                              </div>
                              );
                              })];
                            })()}
                          </div>
                        </>
                      );
                    })()}
                  </div></div>
                </div>
                ) : (
                  <div style={{ border: "1.5px solid #c8bca6", borderRadius: 8, background: C.card, overflow: "hidden" }}>
                    <div style={{ overflowX: "auto" }}><div style={{ minWidth: (hasGuests ? 1032 : 888) + (hasKiosk ? 156 : 0) - (hasLinepay ? 0 : 96) + (hasExt ? 184 : 0) + (abView ? 110 : 0) }}>
                      {(() => {
                        const GTC2 = "110px 56px " + (hasExt ? "92px 92px " : "") + "110px " + (abView ? "110px " : "") + "104px 64px 76px " + (hasGuests ? "64px 80px " : "") + "100px 100px " + (hasLinepay ? "96px " : "") + "96px 84px" + (hasKiosk ? " 156px" : ""); // abView：1/2參考欄+營收=AB+GD欄（張良 2026-09-02 切週月也要看得到） // 加「單均」欄；沒來客資料的店隱藏來客/客單欄；2026-08-29 加 LINE Pay 欄＋自助點餐通路欄（金額·%·約單數）
                        const hc2 = { fontSize: 10.5, letterSpacing: 0.8, color: C.faint, fontWeight: 700, padding: "7px 8px", whiteSpace: "nowrap", textAlign: "right" };
                        const cell2 = (v, extra) => <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, textAlign: "right", color: C.sub, ...extra }}>{v}</div>;
                        return (
                          <>
                            <div style={{ display: "grid", gridTemplateColumns: GTC2, background: C.soft, borderBottom: "1.5px solid #c8bca6" }}>
                              <div style={{ ...hc2, textAlign: "left" }}>{posGran === "week" ? "週（起始日）" : "月份"}</div><div style={hc2}>天數</div>{hasExt && <><div style={{ ...hc2, color: "#8a7f6a" }} title="參考數據">1</div><div style={{ ...hc2, color: "#8a7f6a" }} title="參考數據">2</div></>}<div style={hc2}>{abView ? "AB" : "營收"}</div>{abView && <div style={{ ...hc2, color: "#b3492f" }}>GD</div>}<div style={hc2}>日均</div><div style={hc2}>單數</div><div style={hc2}>單均</div>{hasGuests && <><div style={hc2}>來客</div><div style={hc2}>客單</div></>}<div style={hc2}>現金</div><div style={hc2}>信用卡</div>{hasLinepay && <div style={hc2}>LINE Pay</div>}<div style={hc2}>Uber</div><div style={hc2}>折扣</div>{hasKiosk && <div style={{ ...hc2, color: "#6b4a86" }} title="自助點餐機（機台刷卡＋LINE Pay(APP)）——金額已含在信用卡/LINE Pay 內，看通路占比用；單數＝金額÷當日單均的估算值（喬亞不提供付款別筆數）">自助點餐·%·約單</div>}
                            </div>
                            {[...periods].reverse().map((pp, i) => (
                              <div key={pp.key} style={{ display: "grid", gridTemplateColumns: GTC2, alignItems: "center", minHeight: 32, borderTop: i ? "1px solid #f0ead9" : "none", background: i % 2 ? "#f8f4ea" : C.card }}>
                                <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, color: C.text, fontWeight: 700 }}>{posGran === "week" ? pp.key.slice(5) + " 起" : pp.key}</div>
                                {cell2(pp.nDays)}
                                {hasExt && <>{cell2(pp.ext1 ? fmt(pp.ext1) : "—", { color: "#8a7f6a" })}{cell2(pp.ext2 ? fmt(pp.ext2) : "—", { color: "#8a7f6a" })}</>}
                                {cell2(fmt(pp.revenue), { fontWeight: 700, color: C.text })}
                                {abView && cell2(pp.gd ? fmt(pp.gd) : "—", pp.gd ? { color: "#b3492f", fontWeight: 600 } : { color: "#d5cbb6" })}
                                {cell2(fmt(Math.round(pp.revenue / Math.max(1, pp.nDays))))}
                                {cell2(pp.txCount)}{cell2(pp.txCount ? fmt(Math.round(pp.revenue / pp.txCount)) : "—", { color: "#3a6ea5", fontWeight: 600 })}{hasGuests && <>{cell2(pp.guests || "—")}
                                {cell2(pp.guests ? fmt(Math.round(pp.revenue / pp.guests)) : "—")}</>}
                                {cell2(fmt(pp.cash))}{cell2(fmt(pp.card))}{hasLinepay && cell2(pp.linepay ? fmt(pp.linepay) : "—", pp.linepay ? undefined : { color: "#d5cbb6" })}{cell2(fmt(pp.uber))}
                                {cell2(pp.discount ? fmt(pp.discount) : "—", { color: pp.discount ? C.accent : "#d5cbb6" })}
                                {hasKiosk && cell2(pp.kiosk ? `${fmt(pp.kiosk)}·${pp.revenue ? Math.round(pp.kiosk / pp.revenue * 100) : 0}%·約${pp.kioskTx}單` : "—", pp.kiosk ? { color: "#6b4a86", fontWeight: 600 } : { color: "#d5cbb6" })}
                              </div>
                            ))}
                          </>
                        );
                      })()}
                    </div></div>
                  </div>
                )}
                <div style={{ ...chartBox2, marginTop: 10, marginBottom: 10 }}>
                  {(() => {
                    // 張良 2026-07-26 手機版全面體檢：手機＋每天粒度且超過14期 → 只畫最近14期（柱子才不會擠成細線）；桌機、週/月粒度不變
                    const trim14 = isMobile && posGran === "day" && periods.length > 14;
                    const chartPer = trim14 ? periods.slice(-14) : periods;
                    const chartMax = trim14 ? Math.max(1, ...chartPer.map(pp => pp.revenue)) : maxPer;
                    return (
                      <>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 8 }}>{posGran === "day" ? "每日" : posGran === "week" ? "每週" : "每月"}營收 <span style={{ fontWeight: 400, color: C.faint }}>{posGran === "day" ? "（點柱子看該日完整原始資料・" : "（彙總自每日日結）"}</span>{posGran === "day" && <span style={{ fontWeight: 400, color: C.faint }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: C.amber, verticalAlign: "middle", margin: "0 3px 2px 0" }} />＝週末）</span>}{trim14 && <span style={{ fontWeight: 400, color: C.faint, fontSize: 10.5 }}>・近14天</span>}</div>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 130 }}>
                          {chartPer.map((pp, pi) => {
                            // 週末柱琥珀色、跨週（週一）柱前留縫（張良 2026-07-24：一眼認出週末）
                            const gd3 = posGran === "day" ? new Date(pp.key + "T00:00:00").getDay() : -1;
                            const wknd3 = gd3 === 0 || gd3 === 6;
                            const newWeek3 = posGran === "day" && pi > 0 && gd3 === 1;
                            return (
                            <div key={pp.key} onClick={() => posGran === "day" && openDrill({ type: "day", key: pp.key })} title={`${pp.key}　${fmt(pp.revenue)}・${pp.txCount}單${pp.nDays > 1 ? `・${pp.nDays}天` : ""}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0, cursor: posGran === "day" ? "pointer" : "default", marginLeft: newWeek3 ? 9 : 0, borderLeft: newWeek3 ? "1px dashed #c8bca6" : "none", paddingLeft: newWeek3 ? 6 : 0 }}>
                              {chartPer.length <= 20 && <span style={{ fontSize: isMobile ? 10 : 9, color: C.sub, fontFamily: MONOF }}>{Math.round((pp.revenue || 0) / 1000)}K</span>}
                              <div style={{ width: "100%", height: Math.max(3, (pp.revenue || 0) / chartMax * 96), background: wknd3 ? C.amber : "#3a6ea5", borderRadius: "3px 3px 0 0" }} />
                              <span style={{ fontSize: isMobile ? 9.5 : 8.5, color: wknd3 ? "#a97a10" : C.faint, fontWeight: wknd3 ? 700 : 400, fontFamily: MONOF, whiteSpace: "nowrap" }}>{perLabel(pp.key)}</span>
                            </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
                {insights.length > 0 && (
                  <div style={{ ...chartBox2, marginBottom: 10, borderLeft: `4px solid ${C.accent}` }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>🧠 重點摘要・提醒・建議 <span style={{ fontWeight: 400, color: C.faint }}>（全部由原始資料即時計算）</span></div>
                    {insights.map(([ic, t, dr2], i) => (
                      <div key={i} onClick={() => dr2 && openDrill(dr2)} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 0", fontSize: 12.5, color: ic === "⚠️" || ic === "🔻" ? C.red : C.text, borderTop: i ? `1px solid #f0ead9` : "none", cursor: dr2 ? "pointer" : "default" }}
                        onMouseEnter={e => { if (dr2) e.currentTarget.style.background = "#f4efe5"; }} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span>{ic}</span><span style={{ flex: 1 }}>{t}{dr2 && <span style={{ color: C.blue, fontWeight: 700 }}> →</span>}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* 標籤自選比較：點分類籤 → 選到的分類逐期比較 */}
                <div style={{ ...chartBox2, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>🏷 分類比較</span>
                    {catArr2.map(([k], i) => { const on = posCats.includes(k); return (
                      <button key={k} onClick={() => setPosCats(cs => on ? cs.filter(x => x !== k) : [...cs, k])} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1.5px solid ${on ? PAL[i % PAL.length] : C.line}`, background: on ? PAL[i % PAL.length] : "#fff", color: on ? "#fff" : C.sub, borderRadius: 13, padding: "2px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#fff" : PAL[i % PAL.length] }} />{k}
                      </button>
                    ); })}
                    {posCats.length > 0 && <button onClick={() => setPosCats([])} style={{ border: "none", background: "none", color: C.faint, fontSize: 11.5, cursor: "pointer" }}>× 清除</button>}
                    <div style={{ flex: 1 }} />
                    <button onClick={() => openDrill({ type: "catmatrix" })} style={{ border: `1px solid ${C.blue}`, background: "#fff", color: C.blue, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>🔲 全類別×日期</button>
                    <button onClick={() => openDrill({ type: "allitems" })} style={{ border: `1px solid ${C.green}`, background: "#fff", color: C.green, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>🔲 全品項×日期</button>
                    {!posCats.length && <span style={{ fontSize: 11, color: C.faint }}>點分類籤＝下方出現「選到的分類」逐{posGran === "day" ? "日" : posGran === "week" ? "週" : "月"}比較；熱銷榜也會跟著只看選到的分類</span>}
                  </div>
                  {posCats.length > 0 && (() => {
                    const series = posCats.map(c => ({ c, col: PAL[catArr2.findIndex(([k]) => k === c) % PAL.length], per: periods.map(pp => pp.dates.reduce((t, dd) => t + ((catDay[c] || {})[dd] || 0), 0)) }));
                    // 張良 2026-07-26 手機版全面體檢：手機超過14期只畫最近14期（保持圖表不改清單）；startIdx=0 時桌機完全不變
                    const startIdx = isMobile && periods.length > 14 ? periods.length - 14 : 0;
                    const perView = periods.slice(startIdx);
                    const mx = Math.max(1, ...series.flatMap(sr => sr.per.slice(startIdx)));
                    return (
                      <div style={{ marginTop: 10 }}>
                        {startIdx > 0 && <div style={{ fontSize: 10.5, color: C.faint, marginBottom: 2 }}>（近14期）</div>}
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, overflowX: "auto" }}>
                          {perView.map((pp, pv) => { const pi = pv + startIdx; return (
                            <div key={pp.key} style={{ flex: 1, minWidth: 30 + series.length * 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 96 }}>
                                {series.map(sr => (
                                  <div key={sr.c} title={`${sr.c}　${perLabel(pp.key)}　${fmt(sr.per[pi])}`} style={{ width: 10, height: Math.max(2, sr.per[pi] / mx * 92), background: sr.col, borderRadius: "2px 2px 0 0" }} />
                                ))}
                              </div>
                              <span style={{ fontSize: 8.5, color: C.faint, fontFamily: MONOF }}>{perLabel(pp.key)}</span>
                            </div>
                          ); })}
                        </div>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
                          {series.map(sr => <span key={sr.c} style={{ fontSize: 11, color: C.sub, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: sr.col }} />{sr.c}　合計 <b style={{ fontFamily: MONOF }}>{fmt(sr.per.reduce((a, b) => a + b, 0))}</b></span>)}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                {/* 品項明細（張良 2026-08-14 GD 版型；2026-08-19 A Beach 也接上——POS 分類太粗，改細品類（湯/沙拉/開胃菜/麵/飯…）看排名決定刪菜單；Uber 低價分類併同品項另立欄） */}
                {(() => {
                  const isAB = posStore === "abeach";
                  const dts = days.map(d => d.date); // 期間內有日結的日子＝表格日欄
                  const items = {}; const catSeen = []; const setDay = {}; // setDay＝套餐每日 組數/金額（張良 2026-08-16：+89套餐的數量金額要看得到）
                  days.forEach(d => {
                    (dayDet(d.date)?.sheets?.[CATSHEET] || []).forEach(sec => {
                      if (sec.title === "總結") return;
                      if (sec.title === "套餐") { (sec.rows || []).forEach(r => { if (Array.isArray(r)) { const o = setDay[d.date] = setDay[d.date] || { qty: 0, amt: 0 }; o.qty += Number(r[1]) || 0; o.amt += Number(r[r.length - 1]) || 0; } }); return; }
                      if (isAB && AB_SKIP_CATS.has(sec.title)) return; // 工具箱/包場/免招手…非菜單分類不進表
                      const uber = isAB && AB_UBER_CATS.has(sec.title); // Uber 低價分類：併入同名品項，份數另記
                      if (!isAB && !catSeen.includes(sec.title)) catSeen.push(sec.title);
                      const ci = (sec.header || []).indexOf("套餐內"); // 欄位用名稱找：真日結信沒這欄＝顯示 —
                      (sec.rows || []).forEach(r => {
                        if (!Array.isArray(r) || typeof r[0] !== "string" || isQuarterItem(r[0])) return;
                        const key = isAB ? abNorm(r[0]) : r[0]; // A Beach：內用/Uber 同品項（只差emoji）合併
                        const o = items[key] = items[key] || { n: r[0], k: key, cat: isAB ? abFineCat(r[0]) : sec.title, q: {}, cum: 0, comboCum: 0, comboHas: false, uber: 0, amt: 0, aq: 0, u: {} };
                        if (!uber) o.n = r[0]; // 顯示名以內用版為準
                        o.q[d.date] = (o.q[d.date] || 0) + (Number(r[1]) || 0); o.cum += Number(r[1]) || 0;
                        if (uber) o.uber += Number(r[1]) || 0;
                        // 定價還原（張良 2026-08-28：只顯示定價，不要折扣後平均）：記下每一天「當日金額÷份數」的分佈，
                        // 沒折扣的日子這個值＝正好定價 → 顯示時取「最近一次的乾淨單價」（見 listPriceOf）。Uber 低價與金額0的列不混入
                        const amt = Number(r[r.length - 1]) || 0;
                        if (!uber && amt > 0 && (Number(r[1]) || 0) > 0) {
                          o.amt += amt; o.aq += Number(r[1]) || 0;
                          const uu = Math.round(amt / (Number(r[1]) || 1) * 100) / 100;
                          const uo = o.u[uu] = o.u[uu] || { d: 0, last: "" };
                          uo.d++; if (d.date > uo.last) uo.last = d.date;
                        }
                        if (ci >= 0) { o.comboCum += Number(r[ci]) || 0; o.comboHas = true; } // 套餐內＝期間累計（張良 2026-08-16：跟累計欄同口徑，不再只看排序那天）
                      });
                    });
                  });
                  if (!Object.keys(items).length) return null;
                  if (isAB) { AB_FINE_ORDER.forEach(c => { if (Object.values(items).some(o => o.cat === c)) catSeen.push(c); }); Object.values(items).forEach(o => { if (!catSeen.includes(o.cat)) catSeen.push(o.cat); }); }
                  const lastD2 = dts[dts.length - 1], prevD2 = dts[dts.length - 2];
                  const sortKey = gdSort && (dts.includes(gdSort) || gdSort === "cum") ? gdSort : lastD2;
                  const sv = (o) => sortKey === "cum" ? o.cum : (o.q[sortKey] || 0);
                  // 😴 只看沒賣：最後售出距最新日結 ≥7 天（取代原「沒賣預警」大區塊——同資訊、不佔版面）
                  const lastSold = (o) => { const ds = Object.keys(o.q).filter(dd => o.q[dd] > 0).sort(); return ds[ds.length - 1] || null; };
                  const idleGap = (o) => { const ls = lastSold(o); return ls ? Math.round((new Date(lastD2 + "T00:00:00") - new Date(ls + "T00:00:00")) / 864e5) : null; };
                  // 定價還原（張良 2026-08-28）：沒折扣的日子「當日金額÷份數」＝正好定價 → 候選＝5的倍數（菜單價一定是）
                  // 且 ≥期間最高單價的8成（排除套餐拆帳的零頭），取「最近出現」的那個（中途調價會自動跟上新價，例：GROUN:D 8/26 重開調價）；
                  // 全期間都被折扣/套餐拆帳污染（如飲料）→ 不顯示，寧缺勿錯
                  const listPriceOf = (o) => {
                    const es = Object.entries(o.u || {}).map(([uu, v]) => ({ u: Number(uu), d: v.d, last: v.last }));
                    if (!es.length) return null;
                    const mx = Math.max(...es.map(e => e.u));
                    const cands = es.filter(e => e.u > 0 && e.u % 5 === 0 && e.u >= mx * 0.8);
                    if (!cands.length) return null;
                    cands.sort((a, b) => a.last === b.last ? (b.d - a.d || b.u - a.u) : (a.last < b.last ? 1 : -1));
                    return cands[0].u;
                  };
                  // GROUN:D 飲料/湯/小點幾乎都跟 +89 套餐賣：POS 分到的金額＝拆帳零頭，連「最乾淨的一天」也是攤提價
                  // （番茄蔬菜湯$20、薯條$30 這種假定價，張良 2026-08-28 抓到）→ 這些類自動還原直接關，寧缺勿錯；
                  // 要顯示就在「💰填成本」把定價手動填進去（手填永遠優先；填 0＝這品項不顯示價格）
                  const GD_PRICE_NOAUTO = new Set(["湯品", "小點", "奶香飲品", "咖啡飲品", "基礎飲品", "檸檬飲品"]);
                  const priceMap = posPrices?.[posStore] || {};
                  const priceOf = (o) => {
                    const ov = priceMap[o.k];
                    if (ov !== undefined && ov !== null && ov !== "") return Number(ov) > 0 ? Number(ov) : null; // 手填優先；0＝不顯示
                    if (!isAB && GD_PRICE_NOAUTO.has(o.cat)) return null;
                    return listPriceOf(o);
                  };
                  const rows = Object.values(items).filter(r => gdTab === "全部" || r.cat === gdTab).filter(r => !gdIdle || (idleGap(r) ?? 99) >= 7).sort((a, b) => sv(b) - sv(a) || b.cum - a.cum);
                  // 成本/毛利（張良 2026-08-28：每品項填成本→總成本/每天毛利/平均成本率）
                  // 口徑：成本＝Σ當日份數×品項成本（含套餐內份數）；毛利＝當日POS實收 − 當日成本（與日表同一個營收數字，資料一致）
                  // 覆蓋率＝已填成本品項的份數佔比——沒填的當 0 成本，覆蓋率不足時毛利會偏高估，彙總列直接標警告不靜默
                  const costMap = posCosts?.[posStore] || {};
                  const costOf = (o) => Number(costMap[o.k]) > 0 ? Number(costMap[o.k]) : null;
                  const allItems = Object.values(items); // 全品項口徑（不受上面分類籤/沒賣篩選影響）
                  const revByDate = {}; days.forEach(d => { revByDate[d.date] = Number(d.revenue) || 0; });
                  const dayCostOf = (dd) => allItems.reduce((t, o) => { const c = costOf(o); return t + (c != null ? (o.q[dd] || 0) * c : 0); }, 0);
                  const cumCost = dts.reduce((t, dd) => t + dayCostOf(dd), 0);
                  const cumRev = dts.reduce((t, dd) => t + (revByDate[dd] || 0), 0);
                  const totalQty = allItems.reduce((t, o) => t + o.cum, 0);
                  const coveredQty = allItems.reduce((t, o) => t + (costOf(o) != null ? o.cum : 0), 0);
                  const missingCnt = allItems.filter(o => costOf(o) == null && o.cum > 0).length;
                  const covPct = totalQty ? Math.round(coveredQty / totalQty * 100) : 0;
                  const hasCost = cumCost > 0;
                  const zero = (r) => prevD2 && (r.q[prevD2] || 0) > 0 && !(r.q[lastD2] || 0);   // 昨有量今零售（缺貨？沒人要？）
                  const surge = (r) => prevD2 && (r.q[lastD2] || 0) >= 10 && (r.q[lastD2] || 0) >= (r.q[prevD2] || 0) * 1.5; // 熱銷竄升 +50%
                  const cb = (r) => r.comboHas ? r.comboCum : null;
                  const setQty = dts.reduce((t, dd) => t + (setDay[dd]?.qty || 0), 0), setAmt = dts.reduce((t, dd) => t + (setDay[dd]?.amt || 0), 0);
                  const groups = gdGroup ? catSeen.filter(c => rows.some(r => r.cat === c)).map(c => [c, rows.filter(r => r.cat === c)]) : [[null, rows]];
                  const thd = { padding: "6px 8px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", fontSize: 11.5, color: C.sub, cursor: "pointer" };
                  const tdn = { padding: "5px 8px", textAlign: "right", fontFamily: MONOF, fontSize: 12.5, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap" };
                  const chip2 = (label, on, onClick, dashed) => <button key={label} onClick={onClick} style={{ border: `1.5px ${dashed ? "dashed" : "solid"} ${on ? C.brand : C.line}`, background: on ? C.brand : "#fff", color: on ? "#fff" : C.sub, borderRadius: 13, padding: "2px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>{label}</button>;
                  // ⬇️ 匯出 CSV（張良 2026-08-31：要拿這張表去做菜單規劃）——跟畫面同一份資料直接輸出（全品項、不受分類籤/沒賣篩選影響），
                  // 欄＝品類/品項/定價/成本/每日份數/累計/Uber(或套餐內)；帶 BOM 讓 Excel/Google 試算表開起來中文不亂碼
                  const exportCsv = () => {
                    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
                    const head = ["品類", "品項", "定價", "成本", ...dts, "累計", isAB ? "Uber" : "套餐內"];
                    const ordered = catSeen.filter(c => allItems.some(o => o.cat === c)).flatMap(c => allItems.filter(o => o.cat === c).sort((a, b) => b.cum - a.cum));
                    const lines = [head.map(esc).join(",")];
                    ordered.forEach(o => {
                      lines.push([esc(o.cat), esc(o.n), priceOf(o) ?? "", costOf(o) ?? "", ...dts.map(dd => o.q[dd] || 0), o.cum, isAB ? (o.uber || 0) : (o.comboHas ? o.comboCum : "")].join(","));
                    });
                    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `品項明細_${isAB ? "ABeach" : "GROUND"}_${dts[0] || ""}~${dts[dts.length - 1] || ""}.csv`;
                    a.click(); URL.revokeObjectURL(a.href);
                  };
                  return (
                    <div style={{ ...chartBox2, marginBottom: 10 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>🍽 品項明細</span>
                        {["全部", ...catSeen].map(t => chip2(t, gdTab === t, () => setGdTab(gdTab === t ? "全部" : t)))}
                        {chip2("依品類分組", gdGroup, () => setGdGroup(!gdGroup), true)}
                        {chip2("😴 7天+沒賣", gdIdle, () => setGdIdle(!gdIdle), true)}
                        {canEdit && chip2("💰 填成本", gdCost, () => setGdCost(!gdCost), true)}
                        {chip2("⬇️ 匯出", false, exportCsv, true)}
                        <span style={{ fontSize: 10.5, color: C.faint }}>點日期/累計欄＝排序；🔥=熱銷竄升(+50%)、紅字⚠0=昨有量今零售</span>
                      </div>
                      <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 8, background: "#fff" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                          <thead><tr style={{ background: C.head }}>
                            <th style={{ ...thd, textAlign: "left", cursor: "default", position: "sticky", left: 0, background: C.head, zIndex: 1 }}>品項</th>
                            {!gdGroup && <th style={{ ...thd, textAlign: "left", cursor: "default" }}>品類</th>}
                            {dts.map(dd => <th key={dd} onClick={() => setGdSort(dd)} style={{ ...thd, fontFamily: MONOF, color: sortKey === dd ? C.brand : C.sub }}>{dd.slice(5)}{sortKey === dd ? " ▼" : ""}</th>)}
                            <th onClick={() => setGdSort("cum")} style={{ ...thd, color: sortKey === "cum" ? C.brand : C.sub }}>累計{sortKey === "cum" ? " ▼" : ""}</th>
                            {isAB
                              ? <th style={{ ...thd, cursor: "default" }} title="Uber 外送分類（低價版）賣出的份數——已併入左邊各日與累計的總量，這欄單獨列出其中多少來自 Uber">Uber</th>
                              : <th style={{ ...thd, cursor: "default" }} title="期間內該品項在套餐裡賣出的份數（累計口徑，跟「累計」欄一致）">套餐內</th>}
                          </tr></thead>
                          <tbody>
                            {/* 套餐列（張良 2026-08-16：不要另外一條橫幅，進表格跟日期欄對齊，日子多了跟表一起捲）：上=組數、下小字=金額 */}
                            {setQty > 0 && (
                              <tr style={{ background: C.bg }}>
                                <td style={{ padding: "5px 8px", fontWeight: 800, color: C.text, whiteSpace: "nowrap", position: "sticky", left: 0, background: C.bg }}>套餐（主餐+89 加價購）</td>
                                {!gdGroup && <td style={{ borderTop: "1px solid #f0ead9" }} />}
                                {dts.map(dd => (
                                  <td key={dd} style={{ ...tdn, lineHeight: 1.25 }}>
                                    <div style={{ fontWeight: 700 }}>{setDay[dd]?.qty || 0} <span style={{ fontSize: 10, fontWeight: 400, color: C.faint }}>組</span></div>
                                    <div style={{ fontSize: 10, color: C.faint }}>{setDay[dd]?.amt ? fmt(setDay[dd].amt) : ""}</div>
                                  </td>
                                ))}
                                <td style={{ ...tdn, lineHeight: 1.25 }}>
                                  <div style={{ fontWeight: 800, color: C.brand }}>{setQty} <span style={{ fontSize: 10, fontWeight: 400, color: C.faint }}>組</span></div>
                                  <div style={{ fontSize: 10, color: C.brand }}>{fmt(setAmt)}</div>
                                </td>
                                <td style={{ ...tdn, color: C.faint }}>—</td>
                              </tr>
                            )}
                            {groups.flatMap(([cat, g]) => {
                              const band = cat != null && (
                                <tr key={"band-" + cat} style={{ background: C.brand }}>
                                  <td style={{ padding: "5px 8px", color: "#fff", fontWeight: 800, fontSize: 12, letterSpacing: 2, position: "sticky", left: 0, background: C.brand, whiteSpace: "nowrap" }}>{cat}</td>
                                  {dts.map(dd => <td key={dd} style={{ ...tdn, borderTop: "none", color: "#fff", fontWeight: 700 }}>{g.reduce((t, r) => t + (r.q[dd] || 0), 0)}</td>)}
                                  <td style={{ ...tdn, borderTop: "none", color: "#fff", fontWeight: 800 }}>{g.reduce((t, r) => t + r.cum, 0)}</td>
                                  <td style={{ ...tdn, borderTop: "none", color: "#ffe0cf", fontWeight: 700 }}>{isAB ? (g.reduce((t, r) => t + r.uber, 0) || "—") : (g.some(r => cb(r) != null) ? g.reduce((t, r) => t + (cb(r) || 0), 0) : "—")}</td>
                                </tr>
                              );
                              const body = g.map(r => (
                                <tr key={(cat || "") + r.n}>
                                  <td style={{ padding: "5px 8px", fontWeight: 600, color: zero(r) ? C.red : C.text, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff", borderTop: "1px solid #f0ead9" }}>
                                    {r.n}{priceOf(r) != null && <span style={{ fontSize: 10.5, fontWeight: 400, color: C.faint, marginLeft: 5 }} title={priceMap[r.k] > 0 ? "定價（手動填的）" : "定價（從無折扣日的單價還原；中途調價會顯示最新價）"}>${priceOf(r).toLocaleString()}</span>}
                                    {gdCost && <span style={{ marginLeft: 6, whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                                      <span style={{ fontSize: 10, color: C.sub }}>定價</span>
                                      <input type="number" min="0" inputMode="decimal" value={priceMap[r.k] ?? ""} placeholder={listPriceOf(r) != null ? String(listPriceOf(r)) : "—"} title="留空＝自動還原；填 0＝這品項不顯示價格；填數字＝以你填的為準"
                                        onChange={e => savePrice(posStore, r.k, e.target.value)}
                                        style={{ width: 52, marginLeft: 3, marginRight: 6, border: `1px solid ${C.line}`, borderRadius: 6, padding: "2px 5px", fontSize: 11.5, fontFamily: MONOF, color: C.text, background: "#fffdf5", outline: "none" }} />
                                      <span style={{ fontSize: 10, color: C.sub }}>成本</span>
                                      <input type="number" min="0" inputMode="decimal" value={costMap[r.k] ?? ""} placeholder="—"
                                        onChange={e => saveCost(posStore, r.k, e.target.value)}
                                        style={{ width: 52, marginLeft: 3, border: `1px solid ${C.line}`, borderRadius: 6, padding: "2px 5px", fontSize: 11.5, fontFamily: MONOF, color: C.text, background: "#fffdf5", outline: "none" }} />
                                      {costOf(r) != null && priceOf(r) != null && <span style={{ fontSize: 10, color: C.accent, marginLeft: 4 }} title="毛利/份＝定價−成本">賺{(priceOf(r) - costOf(r)).toLocaleString()}</span>}
                                    </span>}
                                    {!gdCost && costOf(r) != null && <span style={{ fontSize: 10, color: "#b8ad98", marginLeft: 4 }} title="已填成本（開「💰 填成本」可改）">本${costOf(r).toLocaleString()}</span>}
                                    {surge(r) ? " 🔥" : ""}{zero(r) ? <span style={{ fontSize: 10.5, fontWeight: 800 }}> ⚠0</span> : ""}
                                    {gdIdle && <span style={{ fontSize: 10, fontWeight: 700, color: C.red, marginLeft: 6 }}>{idleGap(r)}天沒賣・最後 {String(lastSold(r) || "").slice(5)}</span>}</td>
                                  {!gdGroup && <td style={{ padding: "5px 8px", borderTop: "1px solid #f0ead9" }}><span style={{ border: `1px solid ${C.line}`, background: C.bg, color: C.sub, borderRadius: 10, padding: "1px 8px", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>{r.cat}</span></td>}
                                  {dts.map(dd => <td key={dd} style={{ ...tdn, fontWeight: sortKey === dd ? 800 : 400, color: sortKey === dd ? C.brand : C.sub }}>{r.q[dd] || 0}</td>)}
                                  <td style={{ ...tdn, fontWeight: sortKey === "cum" ? 800 : 600, color: sortKey === "cum" ? C.brand : C.text }}>{r.cum}</td>
                                  <td style={{ ...tdn, color: C.faint }}>{isAB ? (r.uber || "—") : (cb(r) != null ? cb(r) : "—")}</td>
                                </tr>
                              ));
                              return [band, ...body].filter(Boolean);
                            })}
                            {/* 成本/毛利列（張良 2026-08-28）：填了成本才出現；全品項口徑，不受分類籤篩選影響 */}
                            {hasCost && (
                              <tr style={{ background: "#fdf6ec" }}>
                                <td style={{ padding: "5px 8px", fontWeight: 800, color: C.amber, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fdf6ec" }} title="Σ 當日份數×品項成本（含套餐內份數；未填成本的品項當 0）">食材成本</td>
                                {!gdGroup && <td style={{ borderTop: "1px solid #f0ead9" }} />}
                                {dts.map(dd => <td key={dd} style={{ ...tdn, color: C.amber, fontWeight: 700 }}>{fmt(Math.round(dayCostOf(dd)))}</td>)}
                                <td style={{ ...tdn, color: C.amber, fontWeight: 800 }}>{fmt(Math.round(cumCost))}</td>
                                <td style={{ ...tdn, color: C.faint }}>—</td>
                              </tr>
                            )}
                            {hasCost && (
                              <tr style={{ background: "#eef5ee" }}>
                                <td style={{ padding: "5px 8px", fontWeight: 800, color: C.accent, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#eef5ee" }} title="當日 POS 實收 − 當日食材成本（成本沒填齊時會偏高估）">毛利</td>
                                {!gdGroup && <td style={{ borderTop: "1px solid #f0ead9" }} />}
                                {dts.map(dd => { const g2 = (revByDate[dd] || 0) - dayCostOf(dd); return <td key={dd} style={{ ...tdn, color: g2 < 0 ? C.red : C.accent, fontWeight: 700 }} title={`營收 ${fmt(revByDate[dd] || 0)} − 成本 ${fmt(Math.round(dayCostOf(dd)))}`}>{fmt(Math.round(g2))}</td>; })}
                                <td style={{ ...tdn, color: C.accent, fontWeight: 800 }}>{fmt(Math.round(cumRev - cumCost))}</td>
                                <td style={{ ...tdn, color: C.faint }}>—</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {hasCost && (
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline", marginTop: 8, padding: "8px 12px", background: C.bg, borderRadius: 8, border: `1px solid ${C.line}` }}>
                          <span style={{ fontSize: 11.5, fontWeight: 800, color: C.text }}>期間彙總</span>
                          <span style={{ fontSize: 12, color: C.sub }}>營收 <b style={{ fontFamily: MONOF }}>{fmt(cumRev)}</b></span>
                          <span style={{ fontSize: 12, color: C.amber }}>食材成本 <b style={{ fontFamily: MONOF }}>{fmt(Math.round(cumCost))}</b></span>
                          <span style={{ fontSize: 12, color: C.accent }}>毛利 <b style={{ fontFamily: MONOF }}>{fmt(Math.round(cumRev - cumCost))}</b></span>
                          <span style={{ fontSize: 12, color: C.text }} title="食材成本 ÷ 營收（餐飲常抓 30~35%）">平均成本率 <b style={{ fontFamily: MONOF }}>{cumRev ? Math.round(cumCost / cumRev * 100) : 0}%</b></span>
                          {covPct < 100 && <span style={{ fontSize: 11, color: C.red, fontWeight: 700 }}>⚠ 還有 {missingCnt} 個品項沒填成本（佔銷量 {100 - covPct}%）→ 成本被低估、毛利偏高，開「💰 填成本」補齊</span>}
                          {covPct >= 100 && <span style={{ fontSize: 11, color: C.accent, fontWeight: 700 }}>✓ 成本已全數填齊</span>}
                          <button onClick={() => setGdCostDetail(!gdCostDetail)} style={{ border: `1.5px solid ${gdCostDetail ? C.brand : C.line}`, background: gdCostDetail ? C.brand : "#fff", color: gdCostDetail ? "#fff" : C.sub, borderRadius: 13, padding: "2px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>🔍 成本明細</button>
                        </div>
                      )}
                      {/* 成本明細下鑽（張良 2026-08-28：成本率哪來的要看得到）：每品項 份數×成本＝吃掉多少，由大到小；單份成本率 ≥60% 標紅＝可能填錯 */}
                      {hasCost && gdCostDetail && (() => {
                        const costed = allItems.filter(o => costOf(o) != null && o.cum > 0)
                          .map(o => ({ o, c: costOf(o), sub: o.cum * costOf(o), p: priceOf(o) }))
                          .sort((a, b) => b.sub - a.sub);
                        const missing = allItems.filter(o => costOf(o) == null && o.cum > 0).sort((a, b) => b.cum - a.cum);
                        const rateStyle = (rt) => rt == null ? { color: C.faint } : rt >= 0.6 ? { color: C.red, fontWeight: 800 } : rt >= 0.45 ? { color: C.amber, fontWeight: 700 } : { color: C.accent };
                        return (
                          <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 8, background: "#fff", marginTop: 6 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                              <thead><tr style={{ background: C.head }}>
                                {["品項", "定價", "成本/份", "單份成本率", "期間份數", "成本小計", "佔總成本"].map((h, i) => <th key={h} style={{ padding: "6px 8px", textAlign: i === 0 ? "left" : "right", fontWeight: 700, fontSize: 11.5, color: C.sub, whiteSpace: "nowrap" }}>{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {costed.map(({ o, c, sub, p }) => {
                                  const rt = p ? c / p : null;
                                  return (
                                    <tr key={o.k}>
                                      <td style={{ padding: "5px 8px", fontWeight: 600, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap" }}>{o.n}</td>
                                      <td style={{ ...tdn }}>{p ? "$" + p.toLocaleString() : "—"}</td>
                                      <td style={{ ...tdn }}>${c.toLocaleString()}</td>
                                      <td style={{ ...tdn, ...rateStyle(rt) }} title={rt != null && rt >= 0.6 ? "成本超過定價六成——確認一下是不是填錯（例：把定價填進成本欄）" : "成本/份 ÷ 定價"}>{rt != null ? Math.round(rt * 100) + "%" : "—"}{rt != null && rt >= 0.6 ? " ⚠" : ""}</td>
                                      <td style={{ ...tdn }}>{o.cum}</td>
                                      <td style={{ ...tdn, fontWeight: 700 }}>{fmt(Math.round(sub))}</td>
                                      <td style={{ ...tdn, color: C.sub }}>{cumCost ? Math.round(sub / cumCost * 100) : 0}%</td>
                                    </tr>
                                  );
                                })}
                                <tr style={{ background: C.bg }}>
                                  <td style={{ padding: "5px 8px", fontWeight: 800 }}>合計</td>
                                  <td style={{ ...tdn }} /><td style={{ ...tdn }} /><td style={{ ...tdn, fontWeight: 800 }}>{cumRev ? Math.round(cumCost / cumRev * 100) + "%" : "—"}</td>
                                  <td style={{ ...tdn, fontWeight: 700 }}>{costed.reduce((t, x) => t + x.o.cum, 0)}</td>
                                  <td style={{ ...tdn, fontWeight: 800 }}>{fmt(Math.round(cumCost))}</td>
                                  <td style={{ ...tdn, fontWeight: 800 }}>100%</td>
                                </tr>
                              </tbody>
                            </table>
                            {missing.length > 0 && <div style={{ fontSize: 11, color: C.faint, padding: "6px 10px", borderTop: `1px solid ${C.line}` }}>未填成本（不在上表、當 0 成本）：{missing.slice(0, 20).map(o => `${o.n}×${o.cum}`).join("、")}{missing.length > 20 ? ` …共 ${missing.length} 項` : ""}</div>}
                            <div style={{ fontSize: 10.5, color: C.faint, padding: "4px 10px 8px" }}>單份成本率＝成本÷定價：🟢＜45%、🟠 45~60%、🔴 ≥60%（可能把定價填進成本欄，開「💰 填成本」改）。合計列的成本率＝總成本÷期間營收（含飲料等沒定價品項的營收）。</div>
                          </div>
                        );
                      })()}
                      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 6 }}>{isAB
                        ? "品類＝自訂細分類（湯/沙拉/開胃菜/麵/飯…，跟 POS 分類不同，方便逐品類看排名刪菜單）；菜名旁 $＝定價（從無折扣日的單價還原，調價自動跟上新價；被套餐/折扣拆帳影響太大的品項不顯示）；Uber 欄＝外送(低價)分類賣出的份數，已併入該品項各日與累計總量。工具箱/包場/免招手/蛋糕/福利等非菜單分類不列入。品類色帶＝該品類每日總份數。"
                        : "菜名旁 $＝定價（主餐類從無折扣日的單價自動還原，8/26 調價後自動顯示新價；飲料/湯/小點跟套餐拆帳金額不可信＝不自動顯示，要顯示請開「💰填成本」手動填定價，手填永遠優先、填 0＝不顯示）；套餐內＝期間內該品項在套餐裡賣出的份數（累計，其餘為單點）；每組套餐含飲料一杯，所以「飲料」的套餐內≈套餐組數。品類色帶＝該品類每日總份數。"}</div>
                    </div>
                  );
                })()}
                {/* ⏰ 時段消費（張良 2026-08-26）：喬亞行動報表時段分析入庫後在這裡彙總；POS 只有每小時粒度（沒有半小時） */}
                {(() => {
                  const SLOT = "時段分析(每小時)";
                  const slotOf = (date) => { const secs = dayDet(date)?.sheets?.[SLOT]; return Array.isArray(secs) && secs.length ? secs : null; };
                  const slotDates = days.filter(d => slotOf(d.date)).map(d => d.date); // 期間內有時段資料的日子（舊→新）
                  if (!slotDates.length) return null;
                  // 看單天（張良 2026-08-27：只有加總不夠、要能看每天）：下拉選日期；選的日期不在期間內（換店/換期間）自動退回累計
                  const sel = posSlotDay !== "all" && slotDates.includes(posSlotDay) ? posSlotDay : "all";
                  // 半小時（張良 2026-08-27：峰值 12/13 點要切開看）：喬亞只給每小時，半小時＝盤中每 30 分快照相鄰相減推算（2026-08-28 起累積）
                  const t2m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
                  const m2t = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
                  const hhOf = (date) => { const arr = posHH[date.slice(0, 7)]?.days?.[date]; return Array.isArray(arr) && arr.length ? arr : null; };
                  const hhDates = days.filter(d => hhOf(d.date)).map(d => d.date);
                  const half = posSlotGran === "half";
                  const useDates = half ? (sel === "all" ? hhDates : hhDates.filter(dt => dt === sel)) : (sel === "all" ? slotDates : [sel]);
                  // 單日彙總抽成共用（期間累計＝逐日相加；熱力圖＝逐日各自一欄）
                  const collect = (date, m) => {
                    const add = (k, amt, od) => { const o = m[k] = m[k] || { amt: 0, od: 0 }; o.amt += amt; o.od += od; };
                    if (!half) {
                      slotOf(date).forEach(s => (s.rows || []).forEach(r => { if (!Array.isArray(r)) return; add(String(r[0]), Number(r[r.length - 1]) || 0, Number(r[1]) || 0); }));
                    } else {
                      const snaps = [...hhOf(date)].sort((a, b) => t2m(a.t) - t2m(b.t));
                      if (snaps[0] && snaps[0].t !== "11:00" && (Number(snaps[0].rev) || 0) > 0) snaps.unshift({ t: m2t(t2m(snaps[0].t) - 30), rev: 0, tx: 0 }); // 第一張快照前視為 0（開店前沒營收）
                      for (let i = 1; i < snaps.length; i++) {
                        const amt = (Number(snaps[i].rev) || 0) - (Number(snaps[i - 1].rev) || 0), od = (Number(snaps[i].tx) || 0) - (Number(snaps[i - 1].tx) || 0);
                        if (amt < 0 || od < 0) continue; // 快照倒退（理論上不會）保守跳過
                        add(snaps[i - 1].t, amt, od); // 半小時格用「起始時間」當 key：11:30 = 11:30〜12:00
                      }
                    }
                  };
                  const agg = {};
                  useDates.forEach(date => collect(date, agg));
                  // 顯示哪些時段列：營業時段（11-19）一律顯示；範圍外（9/10/19 點）只要真的有金額也要顯示——
                  // 張良 2026-09-01：時段累計 364,037 vs 日報表 374,052 對不上，向喬亞抓真值核對＝差額全是
                  // 10 點/19 點的真實營收（提早開店賣的、最後一批結帳），以前當「零星舊資料」整列藏掉
                  // 又沒算進全日 → 藏列可以、藏錢不行。0 元的範圍外列（9:00 常見）照舊隱藏。
                  const inWin = (k) => { const m = t2m(k); return m >= 660 && m < (half ? 1170 : 1140); };
                  const keys = Object.keys(agg).sort().filter(k => inWin(k) || agg[k].amt > 0);
                  const dLabel = (dt) => dt.slice(2) + "（" + WD2[new Date(dt + "T00:00:00").getDay()] + "）";
                  const mx = Math.max(1, ...keys.map(k => agg[k].amt));
                  const granBtn = (v, l) => (
                    <button key={v} onClick={() => setPosSlotGran(v)} style={{ padding: "4px 9px", borderRadius: 6, border: `1px solid ${posSlotGran === v ? C.line : "transparent"}`, background: posSlotGran === v ? "#fff" : "transparent", color: posSlotGran === v ? C.text : C.sub, fontSize: 12, fontWeight: posSlotGran === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
                  );
                  // 📅 逐日熱力圖（張良 2026-09-01：切下拉一天一天看太麻煩）：列＝時段、欄＝日期、
                  // 格子顏色＝該時段「自己期間內」的相對強弱（每列各自比，小時段的起伏也看得見）；一眼掃出成長/異常
                  const heatDates = half ? hhDates : slotDates;
                  const perDate = {}; heatDates.forEach(dt => { const m = {}; collect(dt, m); perDate[dt] = m; });
                  // 日均分母＝「該天有營業到這時段」的天數（張良 2026-09-01：8/26 前只營業到下午 2 點，
                  // 14:00 以後的時段拿全部天數除會被拉低）。不寫死 8/26：每天用「第一筆〜最後一筆銷售」
                  // 當營業區間，時段落在區間內那天才算分母——之後改營業時間（提早開/延後收）也自動跟上。
                  const actWin = {}; heatDates.forEach(dt => {
                    const ms = Object.keys(perDate[dt]).filter(k2 => (perDate[dt][k2]?.amt || 0) > 0).map(t2m).sort((a, b) => a - b);
                    if (!ms.length) { actWin[dt] = null; return; }
                    // 切塊（張良 2026-09-01：8/10 試營運中午收攤、晚上又冒 50/20 兩小筆，不能因此把那天當「營業到晚上」）：
                    // 相鄰有賣時段隔超過 120 分鐘＝斷開，取金額最大的那塊當營業區間——零星塊的格子照顯示、累計照算，只是不撐大日均分母
                    const blocks = [[ms[0]]];
                    for (let i = 1; i < ms.length; i++) { if (ms[i] - ms[i - 1] > 120) blocks.push([]); blocks[blocks.length - 1].push(ms[i]); }
                    const amtOf = (b) => b.reduce((t, m3) => t + (perDate[dt][m2t(m3)]?.amt || 0), 0);
                    const main = blocks.reduce((best, b) => amtOf(b) > amtOf(best) ? b : best, blocks[0]);
                    actWin[dt] = [main[0], main[main.length - 1]];
                  });
                  const slotDays = (k) => heatDates.filter(dt => actWin[dt] && t2m(k) >= actWin[dt][0] && t2m(k) <= actWin[dt][1]).length;
                  const heatKeys = [...new Set(heatDates.flatMap(dt => Object.keys(perDate[dt])))].sort().filter(k => inWin(k) || heatDates.some(dt => (perDate[dt][k]?.amt || 0) > 0));
                  // 全日列＝打烊後正式營收（跟日報表/KPI 同一個數字＝資料一致鐵則）；時段加總與它有小差時
                  // 打「＊」＋tooltip 說明（喬亞時段表偶爾含折讓/溢收造成的幾十〜百元差，例 8/10 差 120）
                  const offRev = (dt) => Number((days.find(dd => dd.date === dt) || {}).revenue) || 0;
                  const heatBody = () => {
                    const rowMax = {}; heatKeys.forEach(k => { rowMax[k] = Math.max(1, ...heatDates.map(dt => perDate[dt][k]?.amt || 0)); });
                    const rowSum = (k) => heatDates.reduce((t, dt) => t + (perDate[dt][k]?.amt || 0), 0);
                    const dayTot = (dt) => heatKeys.reduce((t, k) => t + (perDate[dt][k]?.amt || 0), 0);
                    const hh3 = { padding: "5px 7px", textAlign: "right", fontWeight: 700, fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", fontFamily: MONOF };
                    const isWE = (dt) => { const g = new Date(dt + "T00:00:00").getDay(); return g === 0 || g === 6; };
                    return (
                      <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 8, background: "#fff" }}>
                        <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%" }}>
                          <thead><tr style={{ background: C.head }}>
                            <th style={{ ...hh3, textAlign: "left", position: "sticky", left: 0, background: C.head, zIndex: 1 }}>時段</th>
                            {heatDates.map(dt => <th key={dt} style={{ ...hh3, color: isWE(dt) ? C.amber : C.sub }}>{Number(dt.slice(5, 7)) + "/" + Number(dt.slice(8))}<br />{WD2[new Date(dt + "T00:00:00").getDay()]}</th>)}
                            <th style={hh3}>累計</th><th style={hh3}>日均</th>
                          </tr></thead>
                          <tbody>
                            {heatKeys.map(k => {
                              const tl = half ? `${k}-${m2t(t2m(k) + 30)}` : k;
                              return (
                                <tr key={k}>
                                  <td style={{ padding: "4px 7px", fontFamily: MONOF, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff", borderTop: "1px solid #f0ead9" }}>{tl}</td>
                                  {heatDates.map(dt => {
                                    const c = perDate[dt][k]; const amt = c?.amt || 0; const ratio = amt / rowMax[k];
                                    return (
                                      <td key={dt} title={`${dLabel(dt)} ${tl}：NT$${fmt(amt)}・${c?.od || 0} 單`}
                                        style={{ padding: "4px 7px", textAlign: "right", fontFamily: MONOF, fontSize: 10.5, whiteSpace: "nowrap", borderTop: "1px solid #f0ead9", background: amt > 0 ? `rgba(58,110,165,${(0.06 + 0.72 * ratio).toFixed(2)})` : "transparent", color: amt > 0 ? (ratio > 0.55 ? "#fff" : C.text) : C.faint, fontWeight: ratio > 0.85 ? 800 : 400 }}>
                                        {amt > 0 ? fmt(amt) : "—"}
                                      </td>
                                    );
                                  })}
                                  <td style={{ padding: "4px 7px", textAlign: "right", fontFamily: MONOF, fontSize: 10.5, fontWeight: 700, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap" }}>{fmt(rowSum(k))}</td>
                                  <td title={`${slotDays(k)} 天有營業到這時段（每天第一筆〜最後一筆銷售之間算營業中）`} style={{ padding: "4px 7px", textAlign: "right", fontFamily: MONOF, fontSize: 10.5, color: C.sub, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", cursor: "help" }}>{fmt(Math.round(rowSum(k) / Math.max(1, slotDays(k))))}</td>
                                </tr>
                              );
                            })}
                            <tr style={{ background: C.head }}>
                              <td style={{ padding: "4px 7px", fontWeight: 800, fontSize: 10.5, position: "sticky", left: 0, background: C.head, whiteSpace: "nowrap" }}>全日</td>
                              {heatDates.map(dt => { const off = offRev(dt) || dayTot(dt); const diff = off - dayTot(dt); return (
                                <td key={dt} title={diff ? `時段加總 NT$${fmt(dayTot(dt))}、正式結帳營收 NT$${fmt(off)}（差 NT$${fmt(Math.abs(diff))}＝喬亞時段表與結帳金額的折讓/溢收小差）` : undefined}
                                  style={{ padding: "4px 7px", textAlign: "right", fontFamily: MONOF, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap", cursor: diff ? "help" : undefined }}>{fmt(off)}{diff ? "＊" : ""}</td>
                              ); })}
                              <td style={{ padding: "4px 7px", textAlign: "right", fontFamily: MONOF, fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap" }}>{fmt(heatDates.reduce((t, dt) => t + (offRev(dt) || dayTot(dt)), 0))}</td>
                              <td style={{ padding: "4px 7px", textAlign: "right", fontFamily: MONOF, fontSize: 10.5, color: C.sub, whiteSpace: "nowrap" }}>{fmt(Math.round(heatDates.reduce((t, dt) => t + (offRev(dt) || dayTot(dt)), 0) / Math.max(1, heatDates.length)))}</td>
                            </tr>
                          </tbody>
                        </table>
                        <div style={{ fontSize: 10.5, color: C.faint, padding: "5px 8px" }}>「全日」列＝打烊後正式結帳營收，跟上面日報表、期間營收 KPI 同一個數字；＊＝時段格加總與正式營收有零星小差（折讓/溢收不分時段），滑鼠移上去看差額。日均＝只除「該天有營業到這時段」的天數（例：全天營業 8/26 開始，之前只到 14:00 的日子不算進下午時段的分母）——滑鼠移到日均看天數。</div>
                      </div>
                    );
                  };
                  return (
                    <div style={{ ...chartBox2, marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>⏰ 時段消費（{posSlotHeat ? `逐日變化・${heatDates.length} 天` : sel === "all" ? `期間累計・${useDates.length} 天` : dLabel(sel)}）<span style={{ fontWeight: 400, color: C.faint }}>　{posSlotHeat ? "列＝時段、欄＝日期；顏色越深＝該時段當期越好（每列各自比）" : sel === "all" ? "每列＝時間｜日均幾單 → 營業額｜共幾單・單均" : "每列＝營業額｜單數・單均"}；營業 11:00-19:00</span></div>
                        <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>{granBtn("hour", "每小時")}{granBtn("half", "半小時")}</div>
                        <button onClick={() => setPosSlotHeat(!posSlotHeat)} style={{ border: `1.5px dashed ${posSlotHeat ? C.brand : C.line}`, background: posSlotHeat ? C.brand : "#fff", color: posSlotHeat ? "#fff" : C.sub, borderRadius: 13, padding: "3px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>📅 逐日</button>
                        {!posSlotHeat && <select value={sel} onChange={e => setPosSlotDay(e.target.value)} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "4px 8px", fontSize: 12, background: "#fff", color: C.text, cursor: "pointer" }}>
                          <option value="all">期間累計（全部天）</option>
                          {[...(half ? hhDates : slotDates)].reverse().map(dt => <option key={dt} value={dt}>{dLabel(dt)}</option>)}
                        </select>}
                      </div>
                      {posSlotHeat ? (heatKeys.length ? heatBody() : <div style={{ fontSize: 12, color: C.faint, padding: "10px 2px" }}>{half ? "半小時資料從 2026-08-28 開始累積——之前的日子只有每小時可看。" : "期間內沒有時段資料。"}</div>) : half && !keys.length ? (
                        <div style={{ fontSize: 12, color: C.faint, padding: "10px 2px" }}>半小時資料從 2026-08-28 開始累積（喬亞 POS 只提供每小時，半小時是系統每 30 分鐘記快照相減算出來的）——之前的日子只有每小時可看。</div>
                      ) : keys.map(k => {
                        const a = agg[k];
                        const unitAvg = a.od ? fmt(Math.round(a.amt / a.od)) : "—";
                        // 「日均幾單」放時間旁邊（張良 2026-08-27：依時段排人力）：分母改「有營業到該時段的天數」
                        // （張良 2026-09-01：8/26 前只營業到下午 2 點，下午時段除全部天數會失真）；營業中沒單的天照算＝真實負載
                        const dayAvg = a.od / Math.max(1, sel === "all" ? slotDays(k) : useDates.length);
                        const dayAvgTxt = dayAvg >= 10 ? Math.round(dayAvg) : Math.round(dayAvg * 10) / 10;
                        const tLabel = half ? `${k}-${m2t(t2m(k) + 30)}` : k;
                        const label = sel === "all" ? `${tLabel}｜日均 ${dayAvgTxt} 單` : tLabel;
                        const extra = sel === "all" ? `共 ${a.od} 單・單均 ${unitAvg}` : `${a.od} 單｜單均 ${unitAvg}`;
                        return barRow(label, a.amt, mx, "#3a6ea5", extra, undefined, 160, half ? 178 : 118);
                      })}
                      {half && keys.length > 0 && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 6 }}>半小時＝盤中每 30 分鐘快照相減推算（2026-08-28 起累積），分鐘級誤差屬正常；要對帳請看每小時（喬亞原生資料）。</div>}
                    </div>
                  );
                })()}
                {/* 「😴 沒賣預警」大區塊已移除（張良 2026-08-19：版面佔太大不實用）——改成上面品項明細的「😴 7天+沒賣」篩選；DD 的沒賣設定（pm_pos_idlecfg）保留，摘要警示照舊 */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, marginBottom: 12 }}>
                  <div style={chartBox2}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 8 }}>各類別營收佔比（期間累計）</div>
                    {(() => { const catTot = catArr2.reduce((t, [, v]) => t + v.amt, 0) || 1;
                      // 版面（張良 2026-08-16）：一行搞定——名稱・份數｜長條｜金額｜佔比%（金額欄 barRow 本來就有，不重複塞）
                      return catArr2.length ? catArr2.map(([k, v], i) => barRow(`${k}・${v.qty}${k === "套餐" ? "組" : "份"}`, v.amt, catMax2, PAL[i % PAL.length], `${Math.round(v.amt / catTot * 100)}%`, () => openDrill({ type: "cat", key: k }))) : <div style={{ fontSize: 12, color: C.faint }}>無明細資料</div>; })()}
                  </div>
                  <div style={chartBox2}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>熱銷商品 Top 12（期間累計）</div>
                      <div style={{ flex: 1 }} />
                      <button onClick={() => openDrill({ type: "allitems" })} style={{ border: `1px solid ${C.blue}`, background: "#fff", color: C.blue, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>🔲 全部品項×日期</button>
                    </div>
                    {topItems.length ? topItems.map(([k, v], i) => barRow(`${i + 1}. ${k}`, v.amt, topItems[0][1].amt, "#3f7d4e", v.qty + "份", () => openDrill({ type: "item", key: k }))) : <div style={{ fontSize: 12, color: C.faint }}>無明細資料</div>}
                  </div>
                  <div style={chartBox2}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 8 }}>付款方式（期間累計）</div>
                    {barRow("信用卡", paySum.card, revSum || 1, "#3a6ea5", revSum ? Math.round(paySum.card / revSum * 100) + "%" : "", () => openDrill({ type: "pay", key: "card" }))}
                    {barRow("現金", paySum.cash, revSum || 1, "#3f7d4e", revSum ? Math.round(paySum.cash / revSum * 100) + "%" : "", () => openDrill({ type: "pay", key: "cash" }))}
                    {paySum.linepay > 0 && barRow("LINE Pay（含自助）", paySum.linepay, revSum || 1, "#2f7d7a", revSum ? Math.round(paySum.linepay / revSum * 100) + "%" : "", () => openDrill({ type: "pay", key: "linepay" }))}
                    {barRow("UberEats", paySum.uber, revSum || 1, "#c98a14", revSum ? Math.round(paySum.uber / revSum * 100) + "%" : "", () => openDrill({ type: "pay", key: "uber" }))}
                    {hasKiosk && <div style={{ borderTop: "1px dashed #d5cbb6", marginTop: 8, paddingTop: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 5 }}>通路（自助點餐機）</div>
                      {barRow("自助點餐", paySum.kiosk, revSum || 1, "#6b4a86", (revSum ? Math.round(paySum.kiosk / revSum * 100) + "%" : "") + (kioskTxSum ? `·約${kioskTxSum}單` : ""), () => openDrill({ type: "pay", key: "kiosk" }), 78)}
                      <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.6 }}>＝機台刷卡＋LINE Pay(APP)，金額已含在上面信用卡/LINE Pay 內（看通路占比用，不能跟上面相加）；單數＝金額÷單均估算</div>
                    </div>}
                    <div onClick={() => openDrill({ type: "coupon" })} title="點我看優惠券/折扣明細（單號・經手・原因）" style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.8, cursor: "pointer" }}
                      onMouseEnter={e => e.currentTarget.style.color = "#3a6ea5"} onMouseLeave={e => e.currentTarget.style.color = C.faint}>
                      期間審計：退菜 {fmt(sum(days, "returnDish"))}・Void {fmt(sum(days, "voidItems"))}・折扣 {fmt(sum(days, "discount"))} <u>看折扣/優惠券明細（誰給的・為什麼）→</u>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>資料來源：Eats365 日結信六個分頁全數入庫（摘要 pm_pos＋明細 pm_pos_d_月份＋逐筆交易 pm_pos_tx_月份，只增不改）。之後接：週/月彙總、POS信用卡 ↔ 銀行入帳核對、進銷存成本對照。</div>
              </>
            )}
            {/* 下鑽明細（組成該數字的原始資料）：欄位可排序、日期帶星期、清單/矩陣切換 */}
            {drill && (() => {
              const sortVal = (v) => { if (typeof v === "number") return v; const n = parseFloat(String(v).replace(/[NT$,%\s]/g, "")); return isNaN(n) ? String(v) : n; };
              // 逐日視圖（優惠券明細）：daily=日期一列（預設直式）、dailyT=轉置（類別一列、日期一欄）
              const eff = drill.daily && posDrillView === "daily" ? drill.daily.v : drill.daily && posDrillView === "dailyT" ? drill.daily.t : null;
              const cols3 = eff ? eff.cols : drill.cols;
              const isNum = (c2, ci2) => ["數量", "佔比", "金額", "營收", "單數", "來客", "客單", "現金", "信用卡", "Uber", "折扣", "服務費", "退菜", "Void", "筆數", "佔當日營收"].includes(c2) || (eff && cols3.indexOf(c2) > 0) || (drill.numIdx && drill.numIdx.has(ci2 ?? cols3.indexOf(c2)));
              const redCell = (colName, disp) => disp !== "—" && disp !== "" && (colName === "客訴補償" || (colName === "佔當日營收" && parseFloat(disp) > 5));
              let rows2 = eff ? eff.rows : drill.rows;
              if (posDrillSort) rows2 = [...rows2].sort((a, b) => { const va = sortVal(a[posDrillSort.i]), vb = sortVal(b[posDrillSort.i]); return (va < vb ? -1 : va > vb ? 1 : 0) * posDrillSort.dir; });
              return (
                <div onClick={e => e.target === e.currentTarget && setPosDrill(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 720, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                  {/* 張良 2026-07-26 手機版全面體檢：手機加高到 92vh、padding 縮小多留內容寬（內層表格容器本來就有 overflow:auto 可橫滑） */}
                  <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: isMobile ? 12 : 20, width: "min(980px,96vw)", maxHeight: isMobile ? "92vh" : "88vh", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                      {drill.back && <button onClick={() => openDrill(drill.back.dr)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{drill.back.label}</button>}
                      <span style={{ background: "#3f7d4e", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 4, padding: "2px 8px" }}>明細</span>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{drill.title}</div>
                      <span style={{ fontFamily: MONOF, fontSize: 11.5, color: C.faint }}>{drill.rows.length} 列</span>
                      <div style={{ flex: 1 }} />
                      {drill.pivot && (
                        <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                          {[["list", "📋 清單"], ["pivot", "🔲 品項×日期"]].map(([v, l]) => (
                            <button key={v} onClick={() => setPosDrillView(v)} style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${posDrillView === v ? C.line : "transparent"}`, background: posDrillView === v ? "#fff" : "transparent", color: posDrillView === v ? C.text : C.sub, fontSize: 12, fontWeight: posDrillView === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
                          ))}
                        </div>
                      )}
                      {drill.daily && (
                        <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                          {[["list", "逐筆"], ["daily", "逐日"], ["dailyT", "逐日 ⇄"]].map(([v, l]) => { const on = posDrillView === v || (v === "list" && posDrillView !== "daily" && posDrillView !== "dailyT"); return (
                            <button key={v} onClick={() => { setPosDrillView(v); setPosDrillSort(null); }} style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${on ? C.line : "transparent"}`, background: on ? "#fff" : "transparent", color: on ? C.text : C.sub, fontSize: 12, fontWeight: on ? 700 : 400, cursor: "pointer" }}>{l}</button>
                          ); })}
                        </div>
                      )}
                      <button onClick={() => setPosDrill(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, marginBottom: 10 }}>{drill.note}{drill.pivot && posDrillView === "pivot" ? "・顏色越深＝當天賣越多；「—」＝當天沒賣" : "・點欄位標題可排序"}</div>
                    {/* 分類彙總卡（優惠券明細用）：先看錢花去哪，再看逐筆 */}
                    {drill.summary && drill.summary.length > 0 && !eff && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                        {drill.summary.map(s2 => (
                          <div key={s2.label} style={{ border: `1.5px solid ${s2.label === "客訴補償" ? "#b3261e" : "#c8bca6"}`, borderRadius: 8, padding: "6px 14px", background: "#fff", minWidth: 96 }}>
                            <div style={{ fontSize: 10.5, color: s2.label === "客訴補償" ? "#b3261e" : C.sub, fontWeight: 700 }}>{s2.label}</div>
                            <div style={{ fontFamily: MONOF, fontSize: 14.5, fontWeight: 800, color: C.text }}>{s2.amt}</div>
                            <div style={{ fontSize: 10, color: C.faint }}>{s2.n} 筆・佔 {s2.pct}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ overflow: "auto", border: `1.5px solid #c8bca6`, borderRadius: 8 }}>
                      {(!drill.pivot || posDrillView === "list") ? (
                        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                          <thead><tr>{cols3.map((c2, ci) => { const numCol = isNum(c2, ci); return (
                            <th key={c2} onClick={() => setPosDrillSort(sx => sx && sx.i === ci ? { i: ci, dir: -sx.dir } : { i: ci, dir: 1 })} style={{ position: "sticky", top: 0, background: "#ece4d6", textAlign: numCol ? "right" : "left", padding: "6px 10px", fontSize: 10.5, letterSpacing: 0.6, color: posDrillSort?.i === ci ? C.text : C.sub, whiteSpace: "nowrap", borderBottom: "1.5px solid #c8bca6", cursor: "pointer", userSelect: "none" }}>{c2}{posDrillSort?.i === ci ? (posDrillSort.dir === 1 ? " ▲" : " ▼") : ""}</th>
                          ); })}</tr></thead>
                          <tbody>
                            {rows2.length === 0 ? <tr><td colSpan={cols3.length} style={{ padding: 16, textAlign: "center", color: C.faint }}>期間內沒有資料</td></tr> :
                              rows2.map((r, i) => { const rowRed = drill.redRow && drill.redRow(r); const fc = eff ? eff.flagCol : drill.flagCol; return (
                                <tr key={i} onClick={drill.rowClick ? () => { const nx = drill.rowClick(r); if (nx) openDrill(nx); } : undefined} title={drill.rowClick ? "點我看該日逐筆交易" : undefined} style={{ background: i % 2 ? "#f8f4ea" : "#fff", cursor: drill.rowClick ? "pointer" : undefined }}
                                  onMouseEnter={drill.rowClick ? (e => e.currentTarget.style.background = "#f4efe5") : undefined} onMouseLeave={drill.rowClick ? (e => e.currentTarget.style.background = i % 2 ? "#f8f4ea" : "#fff") : undefined}>
                                  {r.map((c2, j) => {
                                    // 標記欄：已標記→綠籤＋×移除；未標記→＋標記（開小卡）。點擊不觸發整列下鑽
                                    if (fc && cols3[j] === "標記") {
                                      const fkey = `${r[fc.dateIdx]}::${posStore}::${fc.kind}`;
                                      const f = posFlags?.items?.[fkey];
                                      return <td key={j} onClick={e => e.stopPropagation()} style={{ padding: "5px 10px", borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", fontSize: 11 }}>
                                        {f ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#eef5ef", border: `1px solid ${C.accent}`, color: "#2c5a38", borderRadius: 10, padding: "1px 8px", fontWeight: 700 }} title={f.note || ""}>🏷 {f.type}{f.note ? `・${f.note}` : ""}｜排除 {Number(f.amt) > 0 ? fmt(f.amt) : "全額"}<span onClick={() => removeFlag(fkey)} style={{ cursor: "pointer", color: C.faint, fontWeight: 400, marginLeft: 2 }}>×</span></span>
                                          : <button onClick={() => { const dref = days.find(x => x.date === r[fc.dateIdx]); const defAmt = dref ? (fc.kind === "waste" ? Math.abs(dref.voidItems || 0) + Math.abs(dref.returnDish || 0) : Math.abs(dref.discount || 0)) : 0; setPosFlagEdit({ date: r[fc.dateIdx], kind: fc.kind, type: "系統測試", note: "", amt: String(defAmt || "") }); }} style={{ border: `1px dashed ${C.line}`, background: "#fff", color: C.sub, borderRadius: 10, padding: "1px 8px", fontSize: 11, cursor: "pointer" }}>＋標記</button>}
                                      </td>;
                                    }
                                    const numCol = isNum(cols3[j], j); const disp = cols3[j] === "日期" ? wd(c2) : c2; const red = rowRed || redCell(cols3[j], String(disp)); return <td key={j} style={{ padding: "5px 10px", fontFamily: numCol || (typeof disp === "string" && /[0-9]/.test(disp) && j > 0) ? MONOF : undefined, textAlign: numCol ? "right" : "left", color: red ? "#b3261e" : disp === "" ? "#d5cbb6" : C.text, fontWeight: red ? 700 : undefined, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", fontSize: 11.5 }}>{disp === "" ? "—" : disp}</td>; })}
                                </tr>
                              ); })}
                          </tbody>
                        </table>
                      ) : (() => {
                        // 矩陣：列=品項、欄=日期；分類可勾選（全選→再刪）、表頭可排序
                        const catsAll = [...new Set(drill.raw.map(x => x.cat).filter(Boolean))];
                        const selCats = posPivotCats == null ? catsAll : posPivotCats;
                        const raw2 = drill.raw.filter(x => !x.cat || selCats.includes(x.cat));
                        const dts = [...new Set(raw2.map(x => x.date))].sort();
                        const byName = {};
                        raw2.forEach(x => { const o = byName[x.name] = byName[x.name] || { total: 0, amt: 0, days: {}, cat: x.cat || "" }; o.days[x.date] = (o.days[x.date] || 0) + x.qty; o.total += x.qty; o.amt += x.amt; });
                        const sk = posPivotSort || { col: "total", dir: -1 };
                        const names = Object.entries(byName).sort((a, b) => {
                          const gv = (e) => sk.col === "name" ? e[0] : sk.col === "cat" ? e[1].cat : sk.col === "amt" ? e[1].amt : sk.col === "total" ? e[1].total : (e[1].days[sk.col] || 0);
                          const va = gv(a), vb = gv(b);
                          const c2 = (typeof va === "number" && typeof vb === "number") ? va - vb : String(va).localeCompare(String(vb), "zh-Hant-TW");
                          return c2 * sk.dir;
                        });
                        const mx = Math.max(1, ...names.flatMap(([, o]) => dts.map(dt => o.days[dt] || 0)));
                        const showCat = !drill.pivotMoney && catsAll.length > 0;
                        const thS = { position: "sticky", top: 0, background: "#ece4d6", padding: "6px 8px", fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", borderBottom: "1.5px solid #c8bca6", cursor: "pointer", userSelect: "none", zIndex: 1 };
                        const thBtn = (label, col, extra) => <th key={col} onClick={() => setPosPivotSort(s2 => s2 && s2.col === col ? { col, dir: -s2.dir } : { col, dir: (col === "name" || col === "cat") ? 1 : -1 })} style={{ ...thS, ...extra }}>{label}{sk.col === col ? (sk.dir === 1 ? " ▲" : " ▼") : ""}</th>;
                        const cbtn = (label, on, onClick, col) => <button key={label} onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1.5px solid ${on ? (col || C.blue) : C.line}`, background: on ? (col || C.blue) : "#fff", color: on ? "#fff" : C.sub, borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{label}</button>;
                        return (
                          <div>
                            {catsAll.length > 1 && (
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", padding: "8px 10px", borderBottom: "1.5px solid #c8bca6", background: "#f8f4ea", position: "sticky", left: 0 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>分類：</span>
                                <button onClick={() => setPosPivotCats(null)} style={{ border: `1px solid ${C.green}`, background: posPivotCats == null ? C.green : "#fff", color: posPivotCats == null ? "#fff" : C.green, borderRadius: 6, padding: "2px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>全選</button>
                                <button onClick={() => setPosPivotCats([])} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 6, padding: "2px 9px", fontSize: 11, cursor: "pointer" }}>全不選</button>
                                {catsAll.map(c2 => cbtn(c2, selCats.includes(c2), () => setPosPivotCats(pc => { const cur = pc == null ? catsAll : pc; return cur.includes(c2) ? cur.filter(x => x !== c2) : [...cur, c2]; })))}
                                <span style={{ fontSize: 10.5, color: C.faint }}>（{names.length} 品項）</span>
                              </div>
                            )}
                            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
                              <thead><tr>
                                {thBtn(drill.pivotMoney ? "分類" : "品項", "name", { textAlign: "left", position: "sticky", left: 0, zIndex: 2 })}
                                {showCat && thBtn("分類", "cat", { textAlign: "left" })}
                                {dts.map(dt => thBtn(wd(dt), dt, { textAlign: "center", fontFamily: MONOF }))}
                                {thBtn("合計", "total", { textAlign: "right" })}
                                {!drill.pivotMoney && thBtn("金額", "amt", { textAlign: "right" })}
                              </tr></thead>
                              <tbody>
                                {names.map(([nm, o], i) => (
                                  <tr key={nm}>
                                    <td style={{ padding: "5px 10px", color: C.text, fontWeight: 600, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", position: "sticky", left: 0, background: i % 2 ? "#f8f4ea" : "#fff", zIndex: 1 }} title={nm}>{nm}</td>
                                    {showCat && <td style={{ padding: "5px 8px", color: C.faint, fontSize: 10.5, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", background: i % 2 ? "#f8f4ea" : "#fff" }}>{o.cat}</td>}
                                    {dts.map(dt => { const q = o.days[dt] || 0; const disp = !q ? "—" : drill.pivotMoney ? (q >= 10000 ? Math.round(q / 1000) + "K" : q.toLocaleString()) : q; return (
                                      <td key={dt} style={{ padding: "5px 6px", textAlign: "center", fontFamily: MONOF, fontWeight: q ? 700 : 400, fontSize: drill.pivotMoney ? 10.5 : undefined, color: q ? "#1d3a5f" : "#d5cbb6", background: q ? `rgba(58,110,165,${0.08 + (q / mx) * 0.42})` : (i % 2 ? "#f8f4ea" : "#fff"), borderTop: "1px solid #f0ead9" }}>{disp}</td>
                                    ); })}
                                    <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: MONOF, fontWeight: 700, color: C.text, borderTop: "1px solid #f0ead9", background: i % 2 ? "#f8f4ea" : "#fff" }}>{drill.pivotMoney ? fmt(o.total) : o.total}</td>
                                    {!drill.pivotMoney && <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: MONOF, color: C.sub, borderTop: "1px solid #f0ead9", background: i % 2 ? "#f8f4ea" : "#fff" }}>{fmt(o.amt)}</td>}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* 日別標記小卡（張良 2026-07-26：測試/包場確認過就標記，警示不再計入；原始數字不動） */}
            {posFlagEdit && (
              <div onClick={e => e.target === e.currentTarget && setPosFlagEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 740, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, width: "min(420px,94vw)" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 }}>🏷 標記 {posFlagEdit.date.slice(5)} 的{posFlagEdit.kind === "waste" ? "退菜/Void" : "折扣"}為非營運</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {["系統測試", "包場/活動", "行銷/招待", "其他"].map(tp => (
                      <button key={tp} onClick={() => setPosFlagEdit(fe => ({ ...fe, type: tp }))} style={{ border: `1.5px solid ${posFlagEdit.type === tp ? C.accent : C.line}`, background: posFlagEdit.type === tp ? C.accent : "#fff", color: posFlagEdit.type === tp ? "#fff" : C.sub, borderRadius: 14, padding: "4px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{tp}</button>
                    ))}
                  </div>
                  <input value={posFlagEdit.note} onChange={e => setPosFlagEdit(fe => ({ ...fe, note: e.target.value }))} placeholder="原因（例：阿桑系統測試、婚禮包場）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 8, background: "#fff", color: C.text }} />
                  {/* 排除金額（張良 2026-07-26：整天全排不對，當天可能還有真實折扣）——預設整天全額，可改成只排那一筆 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 12.5, color: C.sub, whiteSpace: "nowrap" }}>排除金額</span>
                    <input type="number" value={posFlagEdit.amt ?? ""} onChange={e => setPosFlagEdit(fe => ({ ...fe, amt: e.target.value }))} style={{ flex: 1, boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: MONOF, textAlign: "right", background: "#fff", color: C.text }} />
                    <span style={{ fontSize: 11, color: C.faint }}>預設＝整天全額；只排某一筆就改成那筆的金額，其餘照算</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={() => setPosFlagEdit(null)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 8, padding: "7px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
                    <button onClick={() => { const fkey = `${posFlagEdit.date}::${posStore}::${posFlagEdit.kind}`; const next = { ...(posFlags || { items: {} }), items: { ...(posFlags?.items || {}), [fkey]: { type: posFlagEdit.type, note: posFlagEdit.note.trim(), amt: Number(posFlagEdit.amt) || 0, at: new Date().toISOString() } } }; saveFlags(next); setPosFlagEdit(null); }} style={{ border: "none", background: C.accent, color: "#fff", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ 完成</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {imp && (() => {
        const fields = [["date", "日期", true], ["amount", "金額", true], ["kind", "類型(選填)", false], ["category", "科目/工種", false], ["vendor", "廠商/對象", false], ["note", "備註", false]];
        const proj = projectedBalance();
        const expNum = parseNum(imp.expected);
        const diff = proj != null && imp.expected !== "" ? proj - expNum : null;
        return (
          <div onClick={e => e.target === e.currentTarget && setImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "min(820px,97vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>📥 批量匯入交易</div>
                <span style={{ fontSize: 12, color: C.faint }}>從 Excel／Google 試算表整段框選複製，貼到下面</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setImp(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
              </div>

              {!imp.parsed ? (
                <>
                  <textarea value={imp.text} onChange={e => setImp(p => ({ ...p, text: e.target.value }))} placeholder="日期(Tab)金額(Tab)廠商(Tab)…　每列一筆交易" rows={9} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "monospace" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                    <label style={{ fontSize: 13, color: C.sub, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={imp.hasHeader} onChange={e => setImp(p => ({ ...p, hasHeader: e.target.checked }))} /> 第一列是標題</label>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => { const parsed = parsePaste(imp.text, imp.hasHeader); if (!parsed) { alert("沒有解析到資料"); return; } setImp(p => ({ ...p, parsed, map: guessMap(parsed.headers), preview: null })); }} disabled={!imp.text.trim()} style={{ background: imp.text.trim() ? "#b5512b" : C.line, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13.5, fontWeight: 600, cursor: imp.text.trim() ? "pointer" : "not-allowed" }}>解析 →</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: C.sub, marginBottom: 12 }}>解析到 <b style={{ color: C.text }}>{imp.parsed.rows.length}</b> 列、<b style={{ color: C.text }}>{imp.parsed.headers.length}</b> 欄。<button onClick={() => setImp(p => ({ ...p, parsed: null, preview: null }))} style={{ background: "none", border: "none", color: "#b5512b", cursor: "pointer", fontSize: 12.5 }}>← 重貼</button></div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>① 欄位對應</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8, marginBottom: 14 }}>
                    {fields.map(([k, label, req]) => (
                      <label key={k} style={{ fontSize: 12.5, color: C.sub }}>{label}{req && <span style={{ color: C.red }}>*</span>}<br />
                        <select value={imp.map[k] ?? -1} onChange={e => setImp(p => ({ ...p, map: { ...p.map, [k]: Number(e.target.value) }, preview: null }))} style={{ ...inp, width: "100%", marginTop: 3 }}>
                          <option value={-1}>—（無）</option>
                          {imp.parsed.headers.map((h, idx) => <option key={idx} value={idx}>{h || `第${idx + 1}欄`}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>② 這批屬於哪個帳戶 ＆ 預設類型</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                    <select value={imp.account} onChange={e => setImp(p => ({ ...p, account: e.target.value, preview: null }))} style={{ ...inp, width: 200 }}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name || "未命名"}</option>)}</select>
                    <select value={imp.defKind} onChange={e => setImp(p => ({ ...p, defKind: e.target.value, preview: null }))} style={{ ...inp, width: 130 }}>{KINDS.map(([v, l]) => <option key={v} value={v}>預設：{l}</option>)}</select>
                    <button onClick={() => { if (imp.map.amount == null || imp.map.amount < 0) { alert("請先對應「金額」欄"); return; } setImp(p => ({ ...p, preview: buildPreview(p.parsed, p.map, p.account, p.defKind) })); }} style={{ background: "#fff", color: "#b5512b", border: "1px solid #b5512b", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>產生預覽 →</button>
                  </div>

                  {imp.preview && (
                    <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>③ 預覽＋驗證</div>
                      <div style={{ fontSize: 13, marginBottom: 8 }}>✅ 可匯入 <b style={{ color: C.accent }}>{imp.preview.valid.length}</b> 筆{imp.preview.invalid.length > 0 && <>　⚠️ 跳過 <b style={{ color: C.red }}>{imp.preview.invalid.length}</b> 筆</>}</div>
                      {imp.preview.invalid.length > 0 && <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 11.5, color: "#B91C1C", maxHeight: 100, overflowY: "auto" }}>{imp.preview.invalid.slice(0, 12).map(x => <div key={x.i}>第{x.i}列：{x.reason}　{x.raw}</div>)}</div>}
                      <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 8, marginBottom: 12 }}>
                        {imp.preview.valid.slice(0, 30).map(e => { const km = kindMeta(e.kind); return (
                          <div key={e.id} style={{ display: "flex", gap: 8, padding: "4px 8px", fontSize: 12, borderBottom: "1px solid #F3EEE1", alignItems: "center" }}>
                            <span style={{ width: 78, color: C.faint }}>{e.date || "(無日期)"}</span>
                            <span style={{ width: 40, color: km[2], fontWeight: 600 }}>{km[1]}</span>
                            <span style={{ width: 90, textAlign: "right", fontFamily: "monospace" }}>{fmt(e.amount)}</span>
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.sub }}>{[e.category, e.vendor, e.note].filter(Boolean).join("・")}</span>
                          </div>
                        ); })}
                      </div>

                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>④ 餘額對帳（選填，強烈建議）</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6, fontSize: 13 }}>
                        <span style={{ color: C.sub }}>你試算表上「{accName(imp.account)}」的期末餘額：</span>
                        <input value={imp.expected} onChange={e => setImp(p => ({ ...p, expected: e.target.value }))} type="number" placeholder="（輸入做對帳）" style={{ ...inp, width: 160, fontFamily: "monospace" }} />
                      </div>
                      {proj != null && <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 12 }}>匯入後系統算的餘額 = <b style={{ color: C.text }}>{fmt(proj)}</b>{diff != null && (Math.abs(diff) < 1 ? <b style={{ color: C.accent }}> ✅ 與你的期末一致</b> : <b style={{ color: C.red }}> ⚠️ 差 {fmt(diff)}（檢查是否漏/重）</b>)}</div>}

                      <button onClick={async () => { if (!imp.preview.valid.length) return; if (!(await confirm(`確認把 ${imp.preview.valid.length} 筆匯入「${accName(imp.account)}」？`, { confirmLabel: "匯入" }))) return; onLog?.("新增", `批量匯入 ${imp.preview.valid.length} 筆財務交易到「${accName(imp.account)}」`); saveLed([...imp.preview.valid, ...ledger]); setImp(null); }} disabled={!imp.preview.valid.length} style={{ background: imp.preview.valid.length ? C.accent : C.line, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: imp.preview.valid.length ? "pointer" : "not-allowed" }}>✅ 確認匯入 {imp.preview.valid.length} 筆</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
