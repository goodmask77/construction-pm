// ── 財務內帳模組（獨立）──────────────────────────────────────────────────────
// 自成一格：自己載入/儲存資料（pm_fin_accounts / pm_fin_ledger，依目前空間前綴）。
// 核心觀念（照內帳藍圖）：帳戶(accounts) + 交易明細(ledger)，分開「資金流(轉帳)」與「費用(支出)」。
// 未來財務負責人接手開發，原則上只動這個資料夾，碰不到工程/總覽。
import { useState, useEffect, useMemo, useRef } from "react";
import { fmt } from "../lib/cost.js";
import { parseNum, blankZero } from "../lib/num.js";

const C = { text: "#1d1a15", sub: "#5a5247", faint: "#9b9384", line: "#d9cfbd", soft: "#ece4d6", bg: "#f4efe5", card: "#FFFFFF", head: "#f4efe5", accent: "#3f7d4e", red: "#b3261e", blue: "#c4582a", amber: "#c98a14", brand: "#c4582a" };
const ACC_TYPES = [["bank", "銀行"], ["company", "公司帳戶"], ["cash", "現金"], ["petty", "零用金"], ["loan", "貸款"]];
const KINDS = [["expense", "支出", C.red], ["transfer", "轉帳", "#3E72A8"], ["income", "收入", C.accent]];
const typeLabel = (t) => (ACC_TYPES.find(x => x[0] === t) || [, "—"])[1];
const kindMeta = (k) => KINDS.find(x => x[0] === k) || KINDS[0];
const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 8px", fontSize: 13, background: "#fff", color: C.text, boxSizing: "border-box", outline: "none" };
const dateInp = { ...inp, colorScheme: "light", fontFamily: "'Noto Sans TC', sans-serif", cursor: "pointer" };
const rid = (p) => p + Math.random().toString(36).slice(2, 8);
const num = parseNum; // 共用解析（避免卡0）

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

export default function FinanceView({ K, confirm, canEdit, ReceiptUploader, onLog }) {
  // 操作紀錄：逐筆敲字的編輯做節流（同訊息 8 秒內只記一次），新增/刪除/匯入等明確動作即時記
  const lastLog = useRef({});
  const logT = (action, detail, ms = 8000) => { if (!onLog) return; const now = Date.now(); if (lastLog.current[detail] && now - lastLog.current[detail] < ms) return; lastLog.current[detail] = now; onLog(action, detail); };
  const [tab, setTab] = useState("ledger");      // overview | accounts | ledger
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
  const [posRange, setPosRange] = useState(30);  // 分析期間：7 / 30 / 9999 天
  const [posDrill, setPosDrill] = useState(null); // 明細下鑽：{type, key} → 顯示組成該數字的原始資料
  const [posDrillView, setPosDrillView] = useState("list"); // 明細視角：list=清單 / pivot=品項×日期矩陣
  const [posDrillSort, setPosDrillSort] = useState(null);   // 明細排序：{i, dir}
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

  useEffect(() => { (async () => {
    try { const a = await window.storage.get(K("pm_fin_accounts"), true); setAccounts(a && a.value ? JSON.parse(a.value) : []); } catch { setAccounts([]); }
    try { const l = await window.storage.get(K("pm_fin_ledger"), true); setLedger(l && l.value ? JSON.parse(l.value) : []); } catch { setLedger([]); }
    try { const c = await window.storage.get(K("pm_fin_coa"), true); const v = c && c.value ? JSON.parse(c.value) : null; setCoa(Array.isArray(v) && v.length ? v : SEED_COA()); } catch { setCoa(SEED_COA()); }
    // 對帳資料：試算表鏡像 + 對帳標記 + 工程專案（跨空間唯讀，絕不寫回）
    try { const sh = await window.storage.get(K("pm_sheet"), true); setSheet(sh && sh.value ? JSON.parse(sh.value) : null); } catch (_) {}
    try { const bk = await window.storage.get(K("pm_bank"), true); setBank(bk && bk.value ? JSON.parse(bk.value) : null); } catch (_) {}
    try { const ps = await window.storage.get(K("pm_pos"), true); setPos(ps && ps.value ? JSON.parse(ps.value) : null); } catch (_) {}
    try { const ct = await window.storage.get(K("pm_ctbc"), true); setCtbc(ct && ct.value ? JSON.parse(ct.value) : null); } catch (_) {}
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
  })(); }, [pos]); // eslint-disable-line
  const saveRecon = (next) => { setRecon(next); window.storage.set(K("pm_recon"), JSON.stringify(next), true).catch(() => {}); };
  const saveBank = (next) => { setBank(next); window.storage.set(K("pm_bank"), JSON.stringify(next), true).catch(() => {}); };
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
  const saveLed = (list) => { setLedger(list); window.storage.set(K("pm_fin_ledger"), JSON.stringify(list), true).catch(() => {}); };
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

  const Tab = (k, label) => <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 16px", borderRadius: 8, border: `1px solid ${tab === k ? "#b5512b" : C.line}`, background: tab === k ? "#b5512b" : "#fff", color: tab === k ? "#fff" : C.sub, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{label}</button>;

  // 所有 hooks 都呼叫完了，這裡才可以提早 return
  if (accounts === null || ledger === null || coa === null) return <div style={{ padding: 40, textAlign: "center", color: C.faint }}>載入中…</div>;

  return (
    <div style={{ maxWidth: 1240, margin: "8px auto", padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>財務內帳</div>
        <span style={{ fontSize: 12, color: C.faint }}>多帳戶總表・轉帳不算成本</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", background: C.head, border: `1px solid ${C.line}`, borderRadius: 10, padding: 3, gap: 2 }}>
          {[["overview", "📊 總覽"], ["accounts", "🏦 帳戶"], ["ledger", "🧾 交易明細"], ["coa", "🗂 科目"], ["recon", "🔄 對帳"], ["pos", "📈 營運"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: tab === k ? C.brand : "transparent", color: tab === k ? "#fff" : C.sub, fontSize: 13.5, fontWeight: 600, cursor: "pointer", transition: "all .12s" }}>{l}</button>
          ))}
        </div>
      </div>

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
              {accounts.map(a => (
                <div key={a.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select value={a.type} onChange={e => updAcc(a.id, "type", e.target.value)} style={{ ...inp, width: 110 }}>{ACC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  <input value={a.name} onChange={e => updAcc(a.id, "name", e.target.value)} placeholder="帳戶名稱（例：合庫商銀 ***244）" style={{ ...inp, flex: 1, minWidth: 180 }} />
                  <label style={{ fontSize: 12, color: C.sub }}>期初 <input value={blankZero(a.opening)} onChange={e => updAcc(a.id, "opening", num(e.target.value))} type="number" placeholder="0" style={{ ...inp, width: 120, fontFamily: "monospace" }} /></label>
                  <div style={{ fontSize: 13, color: balanceOf(a.id) < 0 ? C.red : C.accent, fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 110, textAlign: "right" }}>餘 {fmt(balanceOf(a.id))}</div>
                  <button onClick={() => delAcc(a)} title="刪除" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 18 }}>×</button>
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
            {/* 帳戶頭 */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
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
                                    {st.st === "ignored" && <><span style={{ fontSize: 11, color: C.faint }}>已忽略</span>{canEdit && <button onClick={() => saveRecon({ ...recon, ignored: recon.ignored.filter(x => x !== r.id) })} style={{ border: "none", background: "none", color: C.blue, fontSize: 11, cursor: "pointer", padding: 0 }}>復原</button>}</>}
                                    {st.st === "open" && canEdit && <>
                                      <select defaultValue="" onChange={e => { if (e.target.value) { doFillPay(r, e.target.value); e.target.value = ""; } }} style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: "2px 4px", fontSize: 10.5, background: "#fff", maxWidth: 86 }}>
                                        <option value="">工程▾</option>
                                        {conCats.filter(c => !c.nonProject).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                      </select>
                                      <button onClick={() => doFillFin(r)} style={{ border: `1px solid ${C.blue}`, background: "#fff", color: C.blue, borderRadius: 6, padding: "2px 7px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>內帳</button>
                                      <button onClick={() => saveRecon({ ...recon, ignored: [...recon.ignored, r.id] })} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.faint, borderRadius: 6, padding: "2px 6px", fontSize: 10.5, cursor: "pointer" }}>略</button>
                                    </>}
                                    {st.st === "open" && !canEdit && <span style={{ fontSize: 11, color: C.red }}>未對帳</span>}
                                    {r.source === "manual" && <span title="手動輸入的資料" style={{ fontSize: 9.5, color: C.faint, border: `1px solid ${C.line}`, borderRadius: 4, padding: "0 4px" }}>手動</span>}
                                    {r.source === "manual" && canEdit && <button onClick={async () => { if (window.confirm("刪除這筆手動輸入？（匯入的資料不能刪，手動的可以）")) { saveBank({ ...bank, entries: bank.entries.filter(x => x.id !== r.id), updatedAt: new Date().toISOString() }); } }} style={{ border: "none", background: "none", color: C.faint, fontSize: 11, cursor: "pointer", padding: 0 }}>刪</button>}
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
        const all = [...((pos?.entries) || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
        const days = posRange >= 9999 ? all : all.slice(-posRange);
        const last = days[days.length - 1];
        const sum = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0);
        const revSum = sum(days, "revenue"), txSum = sum(days, "txCount"), guestSum = sum(days, "guests");
        // 客單價＝營收 ÷ 來客數（張良指正：不是除單數）
        const ticket = (rev, g) => g ? Math.round(rev / g) : null;
        const avgTicket = ticket(revSum, guestSum);
        const maxRev = Math.max(1, ...days.map(d => d.revenue || 0));
        const dayDet = (date) => posDet[(date || "").slice(0, 7)]?.days?.[date];
        const CATSHEET = "總銷售額 (以類別分類)";
        // 明細彙總（期間內，全部從原始明細資料庫算）
        const catAgg = {}, itemAgg = {};
        days.forEach(d => {
          (dayDet(d.date)?.sheets?.[CATSHEET] || []).forEach(sec => {
            (sec.rows || []).forEach(r => {
              if (!Array.isArray(r) || typeof r[0] !== "string") return;
              const amt = Number(r[r.length - 1]) || 0, qty = Number(r[1]) || 0;
              if (sec.title === "總結") { if (amt > 0) { const c = catAgg[r[0]] = catAgg[r[0]] || { qty: 0, amt: 0 }; c.qty += qty; c.amt += amt; } }
              else if (amt > 0) { const it = itemAgg[r[0]] = itemAgg[r[0]] || { qty: 0, amt: 0, cat: sec.title }; it.qty += qty; it.amt += amt; }
            });
          });
        });
        const catArr2 = Object.entries(catAgg).sort((a, b) => b[1].amt - a[1].amt);
        const catMax2 = Math.max(1, ...catArr2.map(([, v]) => v.amt));
        const topItems = Object.entries(itemAgg).sort((a, b) => b[1].amt - a[1].amt).slice(0, 12);
        const PAL = ["#3a6ea5", "#3f7d4e", "#c98a14", "#b3492f", "#6b4a86", "#2f7d7a", "#9b9384", "#c4582a", "#5a6e3a", "#8a5a44", "#4a6b86", "#7d3f5e"];
        const paySum = { card: sum(days, "card"), cash: sum(days, "cash"), uber: sum(days, "uber") };
        // ── 下鑽：每種數字 → 組成它的原始資料列 ──
        const pct1 = (v) => typeof v === "number" && v <= 1 ? (v * 100).toFixed(1) + "%" : (v ?? "");
        const buildDrill = (dr) => {
          if (!dr) return null;
          if (dr.type === "days") return {
            title: "日結原始資料（Balance Sheet 概覽）", cols: ["日期", "營收", "單數", "來客", "客單", "現金", "信用卡", "Uber", "折扣", "服務費", "退菜", "Void"],
            rows: [...days].reverse().map(d => [d.date, fmt(d.revenue), d.txCount, d.guests || "—", d.guests ? fmt(ticket(d.revenue, d.guests)) : "—", fmt(d.cash || 0), fmt(d.card || 0), fmt(d.uber || 0), fmt(d.discount || 0), fmt(d.serviceFee || 0), fmt(d.returnDish || 0), fmt(d.voidItems || 0)]),
            note: "來源：每日 POS 日結信 Balance Sheet 分頁 → 資料庫 pm_pos（只增不改）",
          };
          if (dr.type === "cat") {
            const raw = [...days].reverse().flatMap(d => (dayDet(d.date)?.sheets?.[CATSHEET] || []).filter(sec => sec.title === dr.key).flatMap(sec => (sec.rows || []).map(r => ({ date: d.date, name: String(r[0]), qty: Number(r[1]) || 0, pct: r[2], amt: Number(r[r.length - 1]) || 0 }))));
            return {
              title: `分類「${dr.key}」逐日商品明細`, cols: ["日期", "品項", "數量", "佔比", "金額"],
              rows: raw.map(x => [x.date, x.name, x.qty, pct1(x.pct), fmt(x.amt)]), raw, pivot: true,
              note: "來源：日結信「總銷售額(以類別分類)」分頁 → 明細資料庫 pm_pos_d_月份",
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
          if (dr.type === "pay") {
            const K2 = { card: ["card", "cardCount", "信用卡"], cash: ["cash", "cashCount", "現金"], uber: ["uber", "uberCount", "UberEats"] }[dr.key];
            return {
              title: `付款方式「${K2[2]}」逐日`, cols: ["日期", "金額", "筆數", "佔當日營收"],
              rows: [...days].reverse().map(d => [d.date, fmt(d[K2[0]] || 0), d[K2[1]] ?? "—", d.revenue ? Math.round((d[K2[0]] || 0) / d.revenue * 100) + "%" : "—"]),
              note: "來源：日結信 Balance Sheet「付款方式」段 → 資料庫 pm_pos",
            };
          }
          if (dr.type === "coupon") return {
            title: "優惠券 / 折扣明細（含單號・經手・原因）", cols: ["日期", "區塊", "內容"],
            rows: [...days].reverse().flatMap(d => (dayDet(d.date)?.sheets?.["優惠券"] || []).flatMap(sec => (sec.rows || []).map(r => [d.date, sec.title || "優惠券", (Array.isArray(r) ? r : [r]).map(c => typeof c === "number" ? (c <= 1 && c > 0 ? (c * 100).toFixed(1) + "%" : fmt(c)) : c).join("　")]))),
            note: "來源：日結信「優惠券」分頁 → 明細資料庫 pm_pos_d_月份",
          };
          if (dr.type === "day") {
            const det = dayDet(dr.key);
            const dEnt = days.find(x => x.date === dr.key) || {};
            const rows = [];
            // Balance Sheet 概覽（日結摘要）放最前面
            [["總收入", dEnt.revenue], ["交易數量", dEnt.txCount, true], ["人數(堂食)", dEnt.guests, true], ["銷售", dEnt.sales], ["服務費", dEnt.serviceFee], ["折扣", dEnt.discount], ["現金", dEnt.cash], ["信用卡", dEnt.card], ["UberEats", dEnt.uber], ["退菜", dEnt.returnDish], ["Void", dEnt.voidItems]].forEach(([lb, v, isCnt]) => {
              if (v != null && v !== 0) rows.push(["Balance Sheet", "概覽", lb, isCnt ? v : "", "", isCnt ? "" : fmt(v), ""]);
            });
            Object.entries(det?.sheets || {}).forEach(([sn, secs]) => secs.forEach(sec => (sec.rows || []).forEach(r => rows.push([sn.replace(/總銷售額 |[()（）]/g, ""), sec.title, ...parseRow(sec, r)]))));
            return { title: `${dr.key} 當日完整原始資料（${det?.period || ""}）`, cols: ["分頁", "區塊", "名稱", "數量", "佔比", "金額", "備註"], rows, note: "來源：當日日結信全部六個分頁，無刪減入庫" };
          }
          return null;
        };
        const drill = buildDrill(posDrill);
        const openDrill = (dr) => { setPosDrillView("list"); setPosDrillSort(null); setPosDrill(dr); };
        const WD = ["日", "一", "二", "三", "四", "五", "六"];
        const wd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? `${v.slice(5)}（${WD[new Date(v + "T00:00:00").getDay()]}）` : v;
        const kpi = (label, val, sub2, cl, onClick) => (
          <div key={label} onClick={onClick} title="點我看組成明細" style={{ background: C.card, border: "1.5px solid #c8bca6", borderRadius: 8, padding: "10px 14px", flex: "1 1 128px", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#3a6ea5"} onMouseLeave={e => e.currentTarget.style.borderColor = "#c8bca6"}>
            <div style={{ fontFamily: MONOF, fontSize: 21, fontWeight: 700, color: cl || C.text, whiteSpace: "nowrap" }}>{val}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{label}{sub2 ? <span style={{ color: C.faint }}>・{sub2}</span> : null}</div>
          </div>
        );
        const barRow = (label, amt, total, cl, extra, onClick) => (
          <div key={label} onClick={onClick} title="點我看組成明細" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, cursor: "pointer", borderRadius: 5, padding: "1px 2px" }}
            onMouseEnter={e => e.currentTarget.style.background = "#f4efe5"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ fontSize: 11.5, color: C.sub, width: 118, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={label}>{label}</span>
            <div style={{ flex: 1, height: 10, background: "#eee5d3", borderRadius: 5, overflow: "hidden" }}><div style={{ width: Math.max(1, amt / total * 100) + "%", height: "100%", background: cl, borderRadius: 5 }} /></div>
            <span style={{ fontFamily: MONOF, fontSize: 11, color: C.text, width: 84, textAlign: "right" }}>{fmt(amt)}</span>
            {extra != null && <span style={{ fontFamily: MONOF, fontSize: 10, color: C.faint, width: 40, textAlign: "right" }}>{extra}</span>}
          </div>
        );
        const chartBox2 = { background: C.card, border: "1.5px solid #c8bca6", borderRadius: 8, padding: "10px 14px" };
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <span style={{ background: "#3f7d4e", color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px", letterSpacing: 1 }}>營運</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>🍽 {last?.store || "Eats365 POS"} 日結</div>
                <div style={{ fontSize: 11, color: C.faint }}>POS 結帳信自動入庫・{all.length} 天資料・所有數字皆由原始資料計算，點任一數字看組成明細</div>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                {[[7, "近7天"], [30, "近30天"], [9999, "全部"]].map(([v, l]) => (
                  <button key={v} onClick={() => setPosRange(v)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${posRange === v ? C.line : "transparent"}`, background: posRange === v ? "#fff" : "transparent", color: posRange === v ? C.text : C.sub, fontSize: 12.5, fontWeight: posRange === v ? 700 : 400, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
            </div>
            {!days.length ? (
              <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10 }}>還沒有資料——POS 日結信寄到後會自動進來（每天）。</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  {kpi("期間營收", fmt(revSum), days.length + " 天", "#3f7d4e", () => openDrill({ type: "days" }))}
                  {kpi("日均營收", fmt(Math.round(revSum / days.length)), null, null, () => openDrill({ type: "days" }))}
                  {kpi("交易數", txSum, null, null, () => openDrill({ type: "days" }))}
                  {kpi("來客(堂食)", guestSum || "—", avgTicket ? "客單 " + fmt(avgTicket) : null, null, () => openDrill({ type: "days" }))}
                  {kpi("最新一天", fmt(last.revenue), last.date.slice(5), null, () => openDrill({ type: "day", key: last.date }))}
                </div>
                <div style={{ ...chartBox2, marginBottom: 10 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 8 }}>每日營收 <span style={{ fontWeight: 400, color: C.faint }}>（點柱子看該日完整原始資料）</span></div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 130 }}>
                    {days.map(d => (
                      <div key={d.id} onClick={() => openDrill({ type: "day", key: d.date })} title={`${d.date}　${fmt(d.revenue)}・${d.txCount}單・客單 ${d.guests ? fmt(ticket(d.revenue, d.guests)) : "—"}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0, cursor: "pointer" }}>
                        {days.length <= 20 && <span style={{ fontSize: 9, color: C.sub, fontFamily: MONOF }}>{Math.round((d.revenue || 0) / 1000)}K</span>}
                        <div style={{ width: "100%", height: Math.max(3, (d.revenue || 0) / maxRev * 96), background: "#3a6ea5", borderRadius: "3px 3px 0 0" }} />
                        <span style={{ fontSize: 8.5, color: C.faint, fontFamily: MONOF }}>{Number(d.date.slice(8))}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, marginBottom: 12 }}>
                  <div style={chartBox2}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 8 }}>分類銷售（期間累計）</div>
                    {catArr2.length ? catArr2.map(([k, v], i) => barRow(k, v.amt, catMax2, PAL[i % PAL.length], v.qty + "份", () => openDrill({ type: "cat", key: k }))) : <div style={{ fontSize: 12, color: C.faint }}>無明細資料</div>}
                  </div>
                  <div style={chartBox2}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 8 }}>熱銷商品 Top 12（期間累計）</div>
                    {topItems.length ? topItems.map(([k, v], i) => barRow(`${i + 1}. ${k}`, v.amt, topItems[0][1].amt, "#3f7d4e", v.qty + "份", () => openDrill({ type: "item", key: k }))) : <div style={{ fontSize: 12, color: C.faint }}>無明細資料</div>}
                  </div>
                  <div style={chartBox2}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 8 }}>付款方式（期間累計）</div>
                    {barRow("信用卡", paySum.card, revSum || 1, "#3a6ea5", revSum ? Math.round(paySum.card / revSum * 100) + "%" : "", () => openDrill({ type: "pay", key: "card" }))}
                    {barRow("現金", paySum.cash, revSum || 1, "#3f7d4e", revSum ? Math.round(paySum.cash / revSum * 100) + "%" : "", () => openDrill({ type: "pay", key: "cash" }))}
                    {barRow("UberEats", paySum.uber, revSum || 1, "#c98a14", revSum ? Math.round(paySum.uber / revSum * 100) + "%" : "", () => openDrill({ type: "pay", key: "uber" }))}
                    <div onClick={() => openDrill({ type: "coupon" })} title="點我看優惠券/折扣明細（單號・經手・原因）" style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.8, cursor: "pointer" }}
                      onMouseEnter={e => e.currentTarget.style.color = "#3a6ea5"} onMouseLeave={e => e.currentTarget.style.color = C.faint}>
                      期間審計：退菜 {fmt(sum(days, "returnDish"))}・Void {fmt(sum(days, "voidItems"))}・折扣 {fmt(sum(days, "discount"))} <u>看折扣/優惠券明細（誰給的・為什麼）→</u>
                    </div>
                  </div>
                </div>
                <div style={{ border: "1.5px solid #c8bca6", borderRadius: 8, background: C.card, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}><div style={{ minWidth: 900 }}>
                    {(() => {
                      const GTC = "88px minmax(140px,1fr) 96px 64px 64px 80px 96px 96px 96px 80px";
                      const hc = { fontSize: 10.5, letterSpacing: 0.8, color: C.faint, fontWeight: 700, padding: "7px 8px", whiteSpace: "nowrap" };
                      const cell = (v, extra) => <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, textAlign: "right", color: C.sub, ...extra }}>{v}</div>;
                      return (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: GTC, background: C.soft, borderBottom: "1.5px solid #c8bca6" }}>
                            <div style={hc}>日期</div><div style={hc}>店</div><div style={{ ...hc, textAlign: "right" }}>營收</div><div style={{ ...hc, textAlign: "right" }}>單數</div><div style={{ ...hc, textAlign: "right" }}>來客</div><div style={{ ...hc, textAlign: "right" }}>客單(÷來客)</div><div style={{ ...hc, textAlign: "right" }}>現金</div><div style={{ ...hc, textAlign: "right" }}>信用卡</div><div style={{ ...hc, textAlign: "right" }}>Uber</div><div style={{ ...hc, textAlign: "right" }}>折扣</div>
                          </div>
                          <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
                            {[...days].reverse().map((d, i) => (
                              <div key={d.id} onClick={() => openDrill({ type: "day", key: d.date })} title="點我看該日完整原始資料" style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "center", minHeight: 32, borderTop: i ? "1px solid #f0ead9" : "none", background: i % 2 ? "#f8f4ea" : C.card, cursor: "pointer" }}
                                onMouseEnter={e => e.currentTarget.style.background = "#f4efe5"} onMouseLeave={e => e.currentTarget.style.background = i % 2 ? "#f8f4ea" : C.card}>
                                <div style={{ padding: "0 8px", fontFamily: MONOF, fontSize: 11.5, color: C.sub }}>{d.date.slice(2)}</div>
                                <div style={{ padding: "0 8px", fontSize: 11.5, color: C.sub, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{d.store}</div>
                                {cell(fmt(d.revenue), { fontWeight: 700, color: C.text })}
                                {cell(d.txCount)}{cell(d.guests || "—")}{cell(d.guests ? fmt(ticket(d.revenue, d.guests)) : "—")}
                                {cell(fmt(d.cash || 0))}{cell(fmt(d.card || 0))}{cell(fmt(d.uber || 0))}
                                {cell(d.discount ? fmt(d.discount) : "—", { color: d.discount ? C.accent : "#d5cbb6" })}
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div></div>
                </div>
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>資料來源：Eats365 日結信六個分頁全數入庫（摘要 pm_pos＋明細 pm_pos_d_月份，只增不改）。之後接：週/月彙總、POS信用卡 ↔ 銀行入帳核對、進銷存成本對照。</div>
              </>
            )}
            {/* 下鑽明細（組成該數字的原始資料）：欄位可排序、日期帶星期、清單/矩陣切換 */}
            {drill && (() => {
              const sortVal = (v) => { if (typeof v === "number") return v; const n = parseFloat(String(v).replace(/[NT$,%\s]/g, "")); return isNaN(n) ? String(v) : n; };
              let rows2 = drill.rows;
              if (posDrillSort) rows2 = [...drill.rows].sort((a, b) => { const va = sortVal(a[posDrillSort.i]), vb = sortVal(b[posDrillSort.i]); return (va < vb ? -1 : va > vb ? 1 : 0) * posDrillSort.dir; });
              return (
                <div onClick={e => e.target === e.currentTarget && setPosDrill(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 720, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                  <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, width: "min(980px,96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
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
                      <button onClick={() => setPosDrill(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, marginBottom: 10 }}>{drill.note}{drill.pivot && posDrillView === "pivot" ? "・顏色越深＝當天賣越多；「—」＝當天沒賣" : "・點欄位標題可排序"}</div>
                    <div style={{ overflow: "auto", border: `1.5px solid #c8bca6`, borderRadius: 8 }}>
                      {(!drill.pivot || posDrillView === "list") ? (
                        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                          <thead><tr>{drill.cols.map((c2, ci) => { const numCol = ["數量", "佔比", "金額", "營收", "單數", "來客", "客單", "現金", "信用卡", "Uber", "折扣", "服務費", "退菜", "Void", "筆數", "佔當日營收"].includes(c2); return (
                            <th key={c2} onClick={() => setPosDrillSort(sx => sx && sx.i === ci ? { i: ci, dir: -sx.dir } : { i: ci, dir: 1 })} style={{ position: "sticky", top: 0, background: "#ece4d6", textAlign: numCol ? "right" : "left", padding: "6px 10px", fontSize: 10.5, letterSpacing: 0.6, color: posDrillSort?.i === ci ? C.text : C.sub, whiteSpace: "nowrap", borderBottom: "1.5px solid #c8bca6", cursor: "pointer", userSelect: "none" }}>{c2}{posDrillSort?.i === ci ? (posDrillSort.dir === 1 ? " ▲" : " ▼") : ""}</th>
                          ); })}</tr></thead>
                          <tbody>
                            {rows2.length === 0 ? <tr><td colSpan={drill.cols.length} style={{ padding: 16, textAlign: "center", color: C.faint }}>期間內沒有資料</td></tr> :
                              rows2.map((r, i) => (
                                <tr key={i} style={{ background: i % 2 ? "#f8f4ea" : "#fff" }}>
                                  {r.map((c2, j) => { const numCol = ["數量", "佔比", "金額", "營收", "單數", "來客", "客單", "現金", "信用卡", "Uber", "折扣", "服務費", "退菜", "Void", "筆數", "佔當日營收"].includes(drill.cols[j]); const disp = drill.cols[j] === "日期" ? wd(c2) : c2; return <td key={j} style={{ padding: "5px 10px", fontFamily: numCol || (typeof disp === "string" && /[0-9]/.test(disp) && j > 0) ? MONOF : undefined, textAlign: numCol ? "right" : "left", color: disp === "" ? "#d5cbb6" : C.text, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", fontSize: 11.5 }}>{disp === "" ? "—" : disp}</td>; })}
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      ) : (() => {
                        // 矩陣：列=品項（依總份數排序）、欄=日期、格=當天份數（熱力著色）
                        const dts = [...new Set(drill.raw.map(x => x.date))].sort();
                        const byName = {};
                        drill.raw.forEach(x => { const o = byName[x.name] = byName[x.name] || { total: 0, amt: 0, days: {} }; o.days[x.date] = (o.days[x.date] || 0) + x.qty; o.total += x.qty; o.amt += x.amt; });
                        const names = Object.entries(byName).sort((a, b) => b[1].total - a[1].total);
                        const mx = Math.max(1, ...names.flatMap(([, o]) => dts.map(dt => o.days[dt] || 0)));
                        const thS = { position: "sticky", top: 0, background: "#ece4d6", padding: "6px 8px", fontSize: 10.5, color: C.sub, whiteSpace: "nowrap", borderBottom: "1.5px solid #c8bca6" };
                        return (
                          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
                            <thead><tr>
                              <th style={{ ...thS, textAlign: "left", position: "sticky", left: 0, zIndex: 2 }}>品項</th>
                              {dts.map(dt => <th key={dt} style={{ ...thS, textAlign: "center", fontFamily: MONOF }}>{wd(dt)}</th>)}
                              <th style={{ ...thS, textAlign: "right" }}>合計</th>
                              <th style={{ ...thS, textAlign: "right" }}>金額</th>
                            </tr></thead>
                            <tbody>
                              {names.map(([nm, o], i) => (
                                <tr key={nm}>
                                  <td style={{ padding: "5px 10px", color: C.text, fontWeight: 600, borderTop: "1px solid #f0ead9", whiteSpace: "nowrap", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", position: "sticky", left: 0, background: i % 2 ? "#f8f4ea" : "#fff", zIndex: 1 }} title={nm}>{nm}</td>
                                  {dts.map(dt => { const q = o.days[dt] || 0; return (
                                    <td key={dt} style={{ padding: "5px 6px", textAlign: "center", fontFamily: MONOF, fontWeight: q ? 700 : 400, color: q ? "#1d3a5f" : "#d5cbb6", background: q ? `rgba(58,110,165,${0.08 + (q / mx) * 0.42})` : (i % 2 ? "#f8f4ea" : "#fff"), borderTop: "1px solid #f0ead9" }}>{q || "—"}</td>
                                  ); })}
                                  <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: MONOF, fontWeight: 700, color: C.text, borderTop: "1px solid #f0ead9", background: i % 2 ? "#f8f4ea" : "#fff" }}>{o.total}</td>
                                  <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: MONOF, color: C.sub, borderTop: "1px solid #f0ead9", background: i % 2 ? "#f8f4ea" : "#fff" }}>{fmt(o.amt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })()}
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
