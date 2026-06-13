// ── 財務內帳模組（獨立）──────────────────────────────────────────────────────
// 自成一格：自己載入/儲存資料（pm_fin_accounts / pm_fin_ledger，依目前空間前綴）。
// 核心觀念（照內帳藍圖）：帳戶(accounts) + 交易明細(ledger)，分開「資金流(轉帳)」與「費用(支出)」。
// 未來財務負責人接手開發，原則上只動這個資料夾，碰不到工程/總覽。
import { useState, useEffect, useMemo } from "react";
import { fmt } from "../lib/cost.js";

const C = { text: "#211C15", sub: "#6F6656", faint: "#A99F88", line: "#D8CFBB", soft: "#ECE6D7", bg: "#FCFAF4", accent: "#2E7D32", red: "#C0392B", amber: "#C2872E" };
const ACC_TYPES = [["bank", "銀行"], ["company", "公司帳戶"], ["cash", "現金"], ["petty", "零用金"], ["loan", "貸款"]];
const KINDS = [["expense", "支出", C.red], ["transfer", "轉帳", "#3E72A8"], ["income", "收入", C.accent]];
const typeLabel = (t) => (ACC_TYPES.find(x => x[0] === t) || [, "—"])[1];
const kindMeta = (k) => KINDS.find(x => x[0] === k) || KINDS[0];
const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 8px", fontSize: 13, background: "#fff", color: C.text, boxSizing: "border-box", outline: "none" };
const dateInp = { ...inp, colorScheme: "light", fontFamily: "'Noto Sans TC', sans-serif", cursor: "pointer" };
const rid = (p) => p + Math.random().toString(36).slice(2, 8);
const num = (v) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;

export default function FinanceView({ K, confirm, canEdit, ReceiptUploader }) {
  const [tab, setTab] = useState("ledger");      // overview | accounts | ledger
  const [accounts, setAccounts] = useState(null); // null=載入中
  const [ledger, setLedger] = useState(null);
  const [q, setQ] = useState(""); const [fKind, setFKind] = useState("all"); const [fAcc, setFAcc] = useState("all");
  const [sortDir, setSortDir] = useState(-1); // 日期 -1=新到舊

  useEffect(() => { (async () => {
    try { const a = await window.storage.get(K("pm_fin_accounts"), true); setAccounts(a && a.value ? JSON.parse(a.value) : []); } catch { setAccounts([]); }
    try { const l = await window.storage.get(K("pm_fin_ledger"), true); setLedger(l && l.value ? JSON.parse(l.value) : []); } catch { setLedger([]); }
  })(); }, []); // eslint-disable-line
  const guard = () => { if (!canEdit) { alert("沒有編輯權限，請聯絡管理員。"); return false; } return true; };
  const saveAcc = (list) => { setAccounts(list); window.storage.set(K("pm_fin_accounts"), JSON.stringify(list), true).catch(() => {}); };
  const saveLed = (list) => { setLedger(list); window.storage.set(K("pm_fin_ledger"), JSON.stringify(list), true).catch(() => {}); };

  const accName = (id) => accounts?.find(a => a.id === id)?.name || (id ? "(已刪帳戶)" : "—");
  const balanceOf = (id) => {
    let b = num(accounts?.find(a => a.id === id)?.opening);
    (ledger || []).forEach(l => { const amt = num(l.amount); if (l.to === id) b += amt; if (l.from === id) b -= amt; });
    return b;
  };

  // ── 帳戶 CRUD ──
  const addAcc = () => guard() && saveAcc([...(accounts || []), { id: rid("acc"), name: "", type: "bank", opening: 0, note: "", active: true }]);
  const updAcc = (id, k, v) => saveAcc(accounts.map(a => a.id === id ? { ...a, [k]: v } : a));
  const delAcc = async (a) => { if (!guard()) return; const used = (ledger || []).some(l => l.from === a.id || l.to === a.id); if (!(await confirm(`刪除帳戶「${a.name || "未命名"}」？${used ? "（仍有交易用到它，刪後那些交易會標示「已刪帳戶」）" : ""}`, { confirmLabel: "刪除" }))) return; saveAcc(accounts.filter(x => x.id !== a.id)); };

  // ── 交易 CRUD ──
  const addLed = () => guard() && saveLed([{ id: rid("tx"), date: "", kind: "expense", amount: 0, from: accounts[0]?.id || "", to: "", category: "", vendor: "", invoiceNo: "", note: "", receipts: [] }, ...ledger]);
  const updLed = (id, k, v) => saveLed(ledger.map(l => l.id === id ? { ...l, [k]: v } : l));
  const delLed = async (l) => { if (!guard()) return; if (!(await confirm(`刪除這筆交易（${fmt(num(l.amount))}）？`, { confirmLabel: "刪除" }))) return; saveLed(ledger.filter(x => x.id !== l.id)); };

  // useMemo 必須在任何提早 return 之前（hooks 規則）；對 null 安全
  const rows = useMemo(() => {
    let r = (ledger || []).filter(l => (fKind === "all" || l.kind === fKind) && (fAcc === "all" || l.from === fAcc || l.to === fAcc) && (!q.trim() || (l.vendor + l.category + l.note + l.invoiceNo + accName(l.from) + accName(l.to)).toLowerCase().includes(q.trim().toLowerCase())));
    r = [...r].sort((a, b) => ((a.date || "") < (b.date || "") ? -1 : (a.date || "") > (b.date || "") ? 1 : 0) * sortDir);
    return r;
  }, [ledger, fKind, fAcc, q, sortDir, accounts]); // eslint-disable-line
  const filteredSum = rows.reduce((s, l) => s + num(l.amount), 0);

  const Tab = (k, label) => <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 16px", borderRadius: 8, border: `1px solid ${tab === k ? "#b5512b" : C.line}`, background: tab === k ? "#b5512b" : "#fff", color: tab === k ? "#fff" : C.sub, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{label}</button>;

  // 所有 hooks 都呼叫完了，這裡才可以提早 return
  if (accounts === null || ledger === null) return <div style={{ padding: 40, textAlign: "center", color: C.faint }}>載入中…</div>;

  return (
    <div style={{ maxWidth: 1180, margin: "8px auto", padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>💰 財務內帳</div>
        <span style={{ fontSize: 12.5, color: C.sub }}>多帳戶總表（轉帳＝資金搬家不算成本；支出＝費用）</span>
        <div style={{ flex: 1 }} />
        {[["overview", "📊 總覽"], ["accounts", "🏦 帳戶"], ["ledger", "🧾 交易明細"]].map(([k, l]) => Tab(k, l))}
      </div>

      {tab === "overview" && (() => {
        const groups = { 資產: accounts.filter(a => ["bank", "company", "cash", "petty"].includes(a.type)), 貸款: accounts.filter(a => a.type === "loan") };
        const assets = groups.資產.reduce((s, a) => s + balanceOf(a.id), 0);
        const loans = groups.貸款.reduce((s, a) => s + balanceOf(a.id), 0);
        const totalIn = ledger.filter(l => l.kind === "income").reduce((s, l) => s + num(l.amount), 0);
        const totalExp = ledger.filter(l => l.kind === "expense").reduce((s, l) => s + num(l.amount), 0);
        const card = (label, val, color) => <div style={{ flex: "1 1 200px", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 16px" }}><div style={{ fontSize: 12, color: C.sub }}>{label}</div><div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{fmt(val)}</div></div>;
        return (
          <div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              {card("資產餘額合計", assets, C.accent)}
              {card("貸款餘額（欠款）", loans, C.red)}
              {card("淨額（資產−欠款）", assets + loans, C.text)}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, fontSize: 13, color: C.sub }}>
              <span>本表累計：收入 <b style={{ color: C.accent }}>{fmt(totalIn)}</b>・支出 <b style={{ color: C.red }}>{fmt(totalExp)}</b></span>
            </div>
            {accounts.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: C.faint }}>還沒有帳戶，去「🏦 帳戶」新增銀行/貸款/現金帳戶。</div> :
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
                {accounts.map(a => { const b = balanceOf(a.id); return (
                  <div key={a.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, color: C.faint }}>{typeLabel(a.type)}</div>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text, marginBottom: 4 }}>{a.name || "未命名帳戶"}</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: b < 0 ? C.red : C.accent, fontVariantNumeric: "tabular-nums" }}>{fmt(b)}</div>
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
                  <label style={{ fontSize: 12, color: C.sub }}>期初 <input value={a.opening} onChange={e => updAcc(a.id, "opening", num(e.target.value))} type="number" style={{ ...inp, width: 120, fontFamily: "monospace" }} /></label>
                  <div style={{ fontSize: 13, color: balanceOf(a.id) < 0 ? C.red : C.accent, fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 110, textAlign: "right" }}>餘 {fmt(balanceOf(a.id))}</div>
                  <button onClick={() => delAcc(a)} title="刪除" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 18 }}>×</button>
                </div>
              ))}
            </div>}
        </div>
      )}

      {tab === "ledger" && (() => {
        const sep = `1px solid ${C.line}`;
        const gtc = "104px 78px 110px 130px 130px 110px 120px 110px 1fr 90px 30px";
        const th = (l, click) => <div onClick={click} style={{ padding: "7px 6px", fontSize: 11, fontWeight: 600, color: C.faint, borderLeft: sep, cursor: click ? "pointer" : "default" }}>{l}</div>;
        const noAcc = accounts.length === 0;
        return (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋廠商/科目/發票/備註…" style={{ ...inp, width: 220 }} />
              <select value={fKind} onChange={e => setFKind(e.target.value)} style={{ ...inp, width: 100 }}><option value="all">全部類型</option>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={fAcc} onChange={e => setFAcc(e.target.value)} style={{ ...inp, width: 140 }}><option value="all">全部帳戶</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name || "未命名"}</option>)}</select>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12.5, color: C.sub }}>{rows.length} 筆・合計 <b style={{ color: C.text }}>{fmt(filteredSum)}</b></span>
              <button onClick={addLed} disabled={noAcc} title={noAcc ? "請先到「帳戶」建立至少一個帳戶" : ""} style={{ background: noAcc ? C.line : "#b5512b", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: noAcc ? "not-allowed" : "pointer" }}>＋ 新增交易</button>
            </div>
            {noAcc ? <div style={{ padding: 30, textAlign: "center", color: C.faint, background: "#fff", border: sep, borderRadius: 12 }}>請先到 <b>🏦 帳戶</b> 建立帳戶，才能記交易。</div> :
            <div style={{ overflowX: "auto", border: sep, borderRadius: 10, background: "#fff" }}>
              <div style={{ minWidth: 1180 }}>
                <div style={{ display: "grid", gridTemplateColumns: gtc, background: C.bg, borderBottom: sep }}>
                  {th("日期 " + (sortDir === -1 ? "▼" : "▲"), () => setSortDir(d => -d))}{th("類型")}{th("金額")}{th("從帳戶（出）")}{th("到帳戶（進）")}{th("科目/工種")}{th("廠商")}{th("發票號")}{th("備註")}{th("憑證")}{th("")}
                </div>
                {rows.length === 0 ? <div style={{ padding: 22, textAlign: "center", color: C.faint, fontSize: 13 }}>沒有符合的交易，點「＋ 新增交易」</div> :
                 rows.map((l, i) => { const km = kindMeta(l.kind); return (
                  <div key={l.id} style={{ display: "grid", gridTemplateColumns: gtc, alignItems: "center", background: i % 2 ? "#FBF8F0" : "#fff", borderTop: i ? "1px solid #F3EEE1" : "none", gap: 3, padding: "4px 4px" }}>
                    <input type="date" value={String(l.date || "").replace(/\//g, "-").slice(0, 10)} onChange={e => updLed(l.id, "date", e.target.value)} style={{ ...dateInp, width: "100%" }} />
                    <select value={l.kind} onChange={e => updLed(l.id, "kind", e.target.value)} style={{ ...inp, border: "none", color: km[2], fontWeight: 600, padding: "5px 2px" }}>{KINDS.map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}</select>
                    <input value={l.amount} onChange={e => updLed(l.id, "amount", num(e.target.value))} type="number" placeholder="0" style={{ ...inp, fontFamily: "monospace", fontWeight: 600 }} />
                    <select value={l.from || ""} onChange={e => updLed(l.id, "from", e.target.value)} style={{ ...inp, opacity: l.kind === "income" ? 0.5 : 1 }}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name || "未命名"}</option>)}</select>
                    <select value={l.to || ""} onChange={e => updLed(l.id, "to", e.target.value)} style={{ ...inp, opacity: l.kind === "expense" ? 0.5 : 1 }}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name || "未命名"}</option>)}</select>
                    <input value={l.category || ""} onChange={e => updLed(l.id, "category", e.target.value)} placeholder={l.kind === "expense" ? "科目/工種" : "—"} style={inp} />
                    <input value={l.vendor || ""} onChange={e => updLed(l.id, "vendor", e.target.value)} placeholder="廠商/對象" style={inp} />
                    <input value={l.invoiceNo || ""} onChange={e => updLed(l.id, "invoiceNo", e.target.value)} placeholder="發票號" style={inp} />
                    <input value={l.note || ""} onChange={e => updLed(l.id, "note", e.target.value)} placeholder="備註" style={inp} />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{ReceiptUploader ? <ReceiptUploader receipts={l.receipts || []} onChange={r => updLed(l.id, "receipts", r)} size={22} /> : null}</div>
                    <button onClick={() => delLed(l)} title="刪除" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 16 }}>×</button>
                  </div>
                ); })}
              </div>
            </div>}
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.7 }}>
              類型：<b>支出</b>＝從某帳戶付出去（算費用，標科目/工種）；<b>轉帳</b>＝帳戶間搬錢（不算成本，要選「從／到」）；<b>收入</b>＝錢進某帳戶。餘額＝期初＋Σ進−Σ出，會即時反映到「總覽／帳戶」。
            </div>
          </div>
        );
      })()}
    </div>
  );
}
