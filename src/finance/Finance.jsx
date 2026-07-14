// ── 財務內帳模組（獨立）──────────────────────────────────────────────────────
// 自成一格：自己載入/儲存資料（pm_fin_accounts / pm_fin_ledger，依目前空間前綴）。
// 核心觀念（照內帳藍圖）：帳戶(accounts) + 交易明細(ledger)，分開「資金流(轉帳)」與「費用(支出)」。
// 未來財務負責人接手開發，原則上只動這個資料夾，碰不到工程/總覽。
import { useState, useEffect, useMemo, useRef } from "react";
import { fmt } from "../lib/cost.js";
import { parseNum, blankZero } from "../lib/num.js";

const C = { text: "#171717", sub: "#737373", faint: "#a3a3a3", line: "#e5e5e5", soft: "#f5f5f5", bg: "#fafafa", card: "#FFFFFF", head: "#fafafa", accent: "#16a34a", red: "#dc2626", blue: "#2563eb", amber: "#d97706", brand: "#2563eb" };
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

  useEffect(() => { (async () => {
    try { const a = await window.storage.get(K("pm_fin_accounts"), true); setAccounts(a && a.value ? JSON.parse(a.value) : []); } catch { setAccounts([]); }
    try { const l = await window.storage.get(K("pm_fin_ledger"), true); setLedger(l && l.value ? JSON.parse(l.value) : []); } catch { setLedger([]); }
    try { const c = await window.storage.get(K("pm_fin_coa"), true); const v = c && c.value ? JSON.parse(c.value) : null; setCoa(Array.isArray(v) && v.length ? v : SEED_COA()); } catch { setCoa(SEED_COA()); }
  })(); }, []); // eslint-disable-line
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
  const addLed = () => { if (!guard()) return; onLog?.("新增", "新增財務交易"); saveLed([{ id: rid("tx"), date: "", kind: "expense", amount: 0, from: accounts[0]?.id || "", to: "", category: "", vendor: "", invoiceNo: "", note: "", receipts: [] }, ...ledger]); };
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
          {[["overview", "📊 總覽"], ["accounts", "🏦 帳戶"], ["ledger", "🧾 交易明細"], ["coa", "🗂 科目"]].map(([k, l]) => (
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
        const gtc = "98px 60px 116px 116px 116px 92px 104px 78px 1fr 124px 56px 24px";
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
                 rows.map((l, i) => { const km = kindMeta(l.kind); const rb = single ? running[l.id] : null; return (
                  <div key={l.id} style={{ display: "grid", gridTemplateColumns: gtc, alignItems: "center", background: i % 2 ? "#fafafa" : C.card, borderTop: "1px solid #f5f5f5" }}>
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
                    <button onClick={() => delLed(l)} title="刪除" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 15 }} onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = C.faint}>×</button>
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
