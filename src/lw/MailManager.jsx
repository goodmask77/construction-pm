// 設定 > 郵件管理（2026-07-18 張良規格重構）
// 資訊架構：信箱 dropdown（左上）→ 總覽頁 / 單一信箱頁（待確認・規則・紀錄 三tabs）
// 規則＝全域單一清單＋scope（全部信箱/指定信箱）；migration：舊規則自動補 scope=["gm77"]，不動內容。
// 後端處理邏輯（api/mail-manage.js）不變。
import React, { useEffect, useState } from "react";

const C = {
  text: "#1d1a15", sub: "#5a5247", faint: "#9b9384", line: "#d9cfbd", hard: "#c8bca6",
  card: "#fbf8f1", soft: "#f4efe5", accent: "#c4582a", blue: "#3a6ea5", green: "#3f7d4e", red: "#b3261e", amber: "#c98a14",
};
const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const ACTIONS = [["delete", "🗑 直接刪除"], ["label", "🏷 貼標分類"], ["archive", "📁 封存"], ["keep", "✋ 保留(白名單)"]];
const ACT_COLOR = { delete: C.red, label: C.blue, archive: C.amber, keep: C.green };
const actLabel = (a) => (ACTIONS.find(x => x[0] === a) || [, a])[1];
const rid = () => "mr-" + Math.random().toString(36).slice(2, 8);
const DEFAULT_ACCTS = [{ id: "gm77", email: "goodmask77@gmail.com", enabled: true }];

export default function MailManagerView({ K, canEdit, confirm }) {
  const isM = typeof window !== "undefined" && window.innerWidth < 720; // 手機：表格改卡片
  const [accts, setAccts] = useState(DEFAULT_ACCTS);
  const [acct, setAcct] = useState(() => { try { return localStorage.getItem("pm_mail_last_acct") || "gm77"; } catch (_) { return "gm77"; } }); // 預設落點＝上次使用的信箱
  const [tab, setTab] = useState(null);          // pending | rules | logs（null=待掃描結果決定預設）
  const [scan, setScan] = useState(null);
  const [rules, setRules] = useState(null);      // 全域規則清單（含 scope）
  const [log, setLog] = useState({ items: [] });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [openFrom, setOpenFrom] = useState(null);
  const [drawer, setDrawer] = useState(null);    // 規則編輯 drawer：rule id
  const [menu, setMenu] = useState(null);        // "acct" | "more" | null
  const [logFilter, setLogFilter] = useState("attention"); // attention | delete | low | all
  const [logShow, setLogShow] = useState(10);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? null : m)), 8000); };

  const loadAll = async () => {
    try { const v = await window.storage.get(K("pm_mail_accounts"), true); const d = v && v.value ? JSON.parse(v.value) : null; if (d?.list?.length) setAccts(d.list); } catch (_) {}
    try { const v = await window.storage.get(K("pm_mail_scan"), true); setScan(v && v.value ? JSON.parse(v.value) : null); } catch (_) {}
    try { const v = await window.storage.get(K("pm_mail_log"), true); const d = v && v.value ? JSON.parse(v.value) : null; if (d) setLog({ items: d.items || [] }); } catch (_) {}
    try {
      const v = await window.storage.get(K("pm_mail_rules"), true); const d = v && v.value ? JSON.parse(v.value) : { rules: [] };
      let list = d.rules || [];
      // ── migration：舊規則沒有 scope → 預設「原所屬信箱」(gm77)。只補欄位，內容/順序全保留 ──
      if (list.some(r => !r.scope)) {
        list = list.map(r => r.scope ? r : { ...r, scope: ["gm77"] });
        await window.storage.set(K("pm_mail_rules"), JSON.stringify({ ...d, rules: list }), true).catch(() => {});
      }
      setRules(list);
    } catch (_) { setRules([]); }
  };
  useEffect(() => { loadAll(); }, []); // eslint-disable-line
  useEffect(() => { try { localStorage.setItem("pm_mail_last_acct", acct); } catch (_) {} }, [acct]);

  const saveRules = (list) => { setRules(list); window.storage.set(K("pm_mail_rules"), JSON.stringify({ rules: list }), true).catch(() => {}); };
  const saveAccts = (list) => { setAccts(list); window.storage.set(K("pm_mail_accounts"), JSON.stringify({ list }), true).catch(() => {}); };
  const upd = (id, patch) => saveRules(rules.map(r => r.id === id ? { ...r, ...patch } : r));
  const inScope = (r, aid) => !r.scope || r.scope === "all" || (Array.isArray(r.scope) && r.scope.includes(aid));

  const runScan = async () => {
    setBusy("scan");
    try { const r = await fetch("/api/mail-manage?action=scan&days=90"); const d = await r.json(); if (!d.ok) alert("掃描失敗：" + d.error); else { await loadAll(); flash(`✓ 掃描完成：近90天 ${d.inboxCount} 封、${d.senders} 個來源`); } } catch (e) { alert("掃描失敗：" + e.message); }
    setBusy("");
  };
  const runApply = async () => {
    if (!canEdit) return;
    const acts = (rules || []).filter(r => r.enabled !== false && r.action !== "keep" && inScope(r, acct));
    if (!acts.length) { flash("沒有可執行的規則。"); return; }
    if (!(await confirm(`對此信箱套用 ${acts.length} 條規則？\n刪除＝移到垃圾桶，30 天內可救回。`, { confirmLabel: "執行", danger: false }))) return;
    setBusy("apply");
    try { const r = await fetch("/api/mail-manage?action=apply&days=3650"); const d = await r.json(); if (!d.ok) alert("執行失敗：" + d.error); else { await loadAll(); flash(d.skipped ? d.skipped : `✓ 已處理 ${d.moved} 封`); await runScan(); } } catch (e) { alert("執行失敗：" + e.message); }
    setBusy("");
  };

  // ── 待確認 tab：三個操作（刪除/分類/保留）→ 追問是否建立自動規則 ──
  const decide = async (sd, action) => {
    if (!canEdit) return;
    let label = "";
    if (action === "label") { label = window.prompt("分類到哪個標籤？（Gmail 會自動建立）", "自動分類") || ""; if (!label) return; }
    const ok = await confirm(`寄件者「${sd.name || sd.from}」→ ${actLabel(action)}${label ? `（${label}）` : ""}\n\n是否將這次選擇建立為自動規則？之後這個寄件者的信都會自動這樣處理。`, { confirmLabel: "建立規則", danger: false });
    if (!ok) { flash("沒有建立規則，這次先不動它。"); return; }
    const exist = (rules || []).find(r => r.field === "from" && r.match.toLowerCase() === sd.from.toLowerCase());
    if (exist) upd(exist.id, { action, label, enabled: true });
    else saveRules([{ id: rid(), field: "from", match: sd.from, action, label, note: sd.name || sd.from, enabled: true, hits: 0, scope: [acct] }, ...(rules || [])]);
    flash(`✓ 規則已建立：「${sd.name || sd.from}」→ ${actLabel(action)}。按規則頁「執行全部規則」馬上生效，之後每天自動。`);
  };

  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const btn = (label, onClick, style2) => <button onClick={onClick} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", ...style2 }}>{label}</button>;

  const curAcct = accts.find(a => a.id === acct);
  const senders = scan?.senders || [];
  const pendingN = senders.length;
  const acctRules = (rules || []).filter(r => inScope(r, acct));
  // 昨日自動處理量（給「都處理好了」那行）
  const ydayMoved = (() => { const y = new Date(Date.now() - 864e5).toLocaleDateString("zh-TW"); return (log.items || []).filter(it => new Date(it.ts).toLocaleDateString("zh-TW") === y).reduce((s, it) => s + (it.moved || 0), 0); })();
  const moved30 = (log.items || []).filter(it => Date.now() - new Date(it.ts).getTime() < 30 * 864e5).reduce((s, it) => s + (it.moved || 0), 0);
  // tab 預設落點：待確認>0 → 待確認；否則規則
  const curTab = tab || (pendingN > 0 ? "pending" : "rules");

  const drawerRule = drawer && (rules || []).find(r => r.id === drawer);

  // ── 紀錄整理：需注意（刪除＋低信心）優先，正常命中折疊成統計行 ──
  const logRows = (log.items || []).map(it => {
    const low = (it.perRule || []).filter(p => String(p.ruleId || "").startsWith("__"));           // AI/智慧判斷（低信心）
    const del = (it.perRule || []).filter(p => p.action === "delete" && !String(p.ruleId || "").startsWith("__"));
    const norm = (it.perRule || []).filter(p => p.action !== "delete" && !String(p.ruleId || "").startsWith("__"));
    return { ts: it.ts, moved: it.moved, low, del, norm, normCount: norm.reduce((s, p) => s + p.count, 0) };
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* ── 頂部：信箱 dropdown（左上）＋狀態＋動作 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 14px", flexWrap: "wrap", position: "relative" }}>
        <button onClick={() => setMenu(menu === "acct" ? null : "acct")} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1.5px solid ${C.hard}`, background: "#fff", borderRadius: 9, padding: "8px 14px", fontSize: 14, fontWeight: 700, color: C.text, cursor: "pointer" }}>
          📮 {acct === "__all__" ? "所有信箱" : (curAcct?.email || "選擇信箱")} <span style={{ color: C.faint, fontSize: 11 }}>▾</span>
        </button>
        {menu === "acct" && (
          <div style={{ position: "absolute", top: 42, left: 0, zIndex: 60, background: "#fff", border: `1.5px solid ${C.hard}`, borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,.12)", minWidth: 260, overflow: "hidden" }}>
            {accts.map(a => (
              <div key={a.id} onClick={() => { setAcct(a.id); setMenu(null); setTab(null); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", background: acct === a.id ? C.soft : "#fff", color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: a.enabled === false ? "#d5cbb6" : C.green }} />{a.email}{acct === a.id && <span style={{ marginLeft: "auto", color: C.accent, fontWeight: 700 }}>✓</span>}
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.line}` }} />
            <div onClick={() => { setMenu(null); flash("要接新信箱：跟我（Claude）說一聲＋給該信箱的「應用程式密碼」，接好就會出現在這清單。"); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: C.accent, fontWeight: 600 }}>＋ 新增信箱</div>
            <div onClick={() => { setAcct("__all__"); setMenu(null); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: C.sub, borderTop: `1px solid ${C.line}` }}>🗂 管理所有信箱</div>
          </div>
        )}
        {acct !== "__all__" && (<>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: scan ? C.green : C.faint, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: scan ? C.green : "#d5cbb6" }} />{scan ? "已連線" : "未掃描"}
          </span>
          {scan && <span style={{ fontSize: 11.5, color: C.faint }}>上次掃描 {new Date(scan.scannedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
          <div style={{ flex: 1 }} />
          {btn(busy === "scan" ? "掃描中…" : "🔍 立即掃描", runScan, { color: C.blue, borderColor: C.blue })}
          <button onClick={() => setMenu(menu === "more" ? null : "more")} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "6px 10px", fontSize: 14, cursor: "pointer" }}>⋯</button>
          {menu === "more" && (
            <div style={{ position: "absolute", top: 42, right: 0, zIndex: 60, background: "#fff", border: `1.5px solid ${C.hard}`, borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,.12)", minWidth: 190, overflow: "hidden" }}>
              <div onClick={() => { setMenu(null); runScan(); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: C.text }}>🔄 完整重新掃描</div>
              <div onClick={async () => { setMenu(null); if (await confirm(`停用「${curAcct?.email}」？停用後每天的自動規則不再跑這個信箱。`, { confirmLabel: "停用", danger: false })) { saveAccts(accts.map(a => a.id === acct ? { ...a, enabled: a.enabled === false } : a)); flash("已切換停用狀態。"); } }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: C.amber, borderTop: `1px solid ${C.line}` }}>⏸ {curAcct?.enabled === false ? "重新啟用" : "停用此信箱"}</div>
              <div onClick={async () => { setMenu(null); if (accts.length <= 1) { flash("這是唯一的信箱，要移除請先跟我（Claude）說——連線憑證也要一起拆。"); return; } if (await confirm(`移除「${curAcct?.email}」？規則資料會保留。`, { confirmLabel: "移除" })) { saveAccts(accts.filter(a => a.id !== acct)); setAcct(accts.find(a => a.id !== acct)?.id || "__all__"); } }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: C.red, borderTop: `1px solid ${C.line}` }}>🗑 移除信箱</div>
            </div>
          )}
        </>)}
      </div>
      {msg && <div style={{ background: "#eef5ef", border: `1.5px solid ${C.green}`, borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#2c5a38", fontWeight: 600 }}>{msg} <button onClick={() => setMsg(null)} style={{ border: "none", background: "none", color: C.green, cursor: "pointer", float: "right" }}>×</button></div>}

      {/* ══ 總覽頁：所有信箱精簡表格 ══ */}
      {acct === "__all__" ? (
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 10 }}>所有信箱</div>
          {isM ? accts.map(a => (
            <div key={a.id} style={{ border: `1.5px solid ${C.hard}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10, background: "#fff" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{a.email}</div>
              <div style={{ fontSize: 11.5, color: C.sub, margin: "4px 0 8px" }}>{a.enabled === false ? "⏸ 已停用" : "🟢 已連線"}・規則 {(rules || []).filter(r => inScope(r, a.id)).length} 條・近30日處理 {moved30} 封</div>
              <button onClick={() => { setAcct(a.id); setTab(null); }} style={{ border: `1px solid ${C.accent}`, background: "#fff", color: C.accent, borderRadius: 7, padding: "5px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>管理</button>
            </div>
          )) : (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.4fr) 100px 90px 130px 90px", gap: 10, padding: "8px 14px", background: "#ece4d6", fontSize: 11, fontWeight: 700, color: C.sub }}>
                <span>信箱</span><span>連線狀態</span><span style={{ textAlign: "right" }}>規則數</span><span style={{ textAlign: "right" }}>近30日處理量</span><span />
              </div>
              {accts.map((a, i) => (
                <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.4fr) 100px 90px 130px 90px", gap: 10, padding: "9px 14px", alignItems: "center", borderTop: i ? `1px solid #f0ead9` : "none", background: i % 2 ? "#faf6ec" : "#fff", fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: C.text }}>{a.email}</span>
                  <span style={{ fontSize: 12, color: a.enabled === false ? C.faint : C.green, fontWeight: 600 }}>{a.enabled === false ? "⏸ 已停用" : "🟢 已連線"}</span>
                  <span style={{ fontFamily: MONOF, textAlign: "right" }}>{(rules || []).filter(r => inScope(r, a.id)).length}</span>
                  <span style={{ fontFamily: MONOF, textAlign: "right" }}>{moved30}</span>
                  <button onClick={() => { setAcct(a.id); setTab(null); }} style={{ border: `1px solid ${C.accent}`, background: "#fff", color: C.accent, borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", justifySelf: "end" }}>管理</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* ══ 單一信箱頁：三 tabs ══ */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: `2px solid ${C.hard}` }}>
            {[["pending", `待確認${pendingN ? "" : ""}`], ["rules", "規則"], ["logs", "紀錄"]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{ border: "none", background: "none", padding: "8px 14px", fontSize: 13.5, fontWeight: curTab === k ? 800 : 500, color: curTab === k ? C.text : C.faint, cursor: "pointer", borderBottom: curTab === k ? `3px solid ${C.accent}` : "3px solid transparent", marginBottom: -2, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {l}{k === "pending" && pendingN > 0 && <span style={{ background: C.accent, color: "#fff", fontSize: 10.5, fontWeight: 800, borderRadius: 9, padding: "1px 7px" }}>{pendingN}</span>}
              </button>
            ))}
          </div>

          {/* ── 待確認 ── */}
          {curTab === "pending" && (
            !scan ? <div style={{ padding: 30, textAlign: "center", color: C.faint, fontSize: 13 }}>還沒掃描過——按右上「🔍 立即掃描」開始。</div> :
            pendingN === 0 ? <div style={{ padding: 26, textAlign: "center", fontSize: 14, color: C.green, fontWeight: 700 }}>✓ 都處理好了 · 昨日自動處理 {ydayMoved} 封</div> : (
              <div>
                {senders.map(sd => {
                  const open = openFrom === sd.from;
                  const mailsOf = open ? (scan.mails || []).filter(m => m.from === sd.from) : [];
                  return (
                    <React.Fragment key={sd.from}>
                      <div onClick={() => setOpenFrom(open ? null : sd.from)} style={{ display: isM ? "block" : "grid", gridTemplateColumns: "minmax(200px,1.3fr) 40px minmax(180px,1.4fr) 210px", gap: 10, alignItems: "center", padding: "8px 10px", borderTop: `1px solid #f0ead9`, cursor: "pointer", background: open ? C.soft : "transparent" }}>
                        <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 12.5 }} title={sd.from}><b style={{ color: C.text }}>{sd.name || sd.from.split("@")[0]}</b> <span style={{ color: C.faint, fontSize: 10.5 }}>{sd.from}</span></div>
                        <span style={{ fontFamily: MONOF, fontWeight: 700, fontSize: 12, color: sd.count >= 10 ? C.accent : C.sub, textAlign: isM ? "left" : "right" }}>{sd.count}封</span>
                        <span style={{ color: C.sub, fontSize: 11.5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", display: isM ? "block" : undefined }} title={sd.sample}>{sd.sample}</span>
                        <div style={{ display: "flex", gap: 5, marginTop: isM ? 6 : 0 }} onClick={e => e.stopPropagation()}>
                          {canEdit && [["delete", "🗑 刪除", C.red], ["label", "🏷 分類", C.blue], ["keep", "✋ 保留", C.green]].map(([a, l, cl]) => (
                            <button key={a} onClick={() => decide(sd, a)} style={{ border: `1.5px solid ${cl}`, background: "#fff", color: cl, borderRadius: 999, padding: "3px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>{l}</button>
                          ))}
                        </div>
                      </div>
                      {open && mailsOf.map((m, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "3px 10px 3px 26px", fontSize: 11.5, background: "#faf6ec", borderTop: "1px solid #f0ead9" }}>
                          <span style={{ fontFamily: MONOF, fontSize: 10.5, color: C.faint, flexShrink: 0 }}>{m.date.slice(5)}</span>
                          <span style={{ color: C.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={m.subject}>{m.subject}</span>
                        </div>
                      ))}
                    </React.Fragment>
                  );
                })}
              </div>
            )
          )}

          {/* ── 規則 ── */}
          {curTab === "rules" && rules && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {canEdit && btn("＋ 新增規則", () => { const nid = rid(); saveRules([{ id: nid, field: "from", match: "", action: "delete", label: "", note: "", enabled: true, hits: 0, scope: [acct] }, ...rules]); setDrawer(nid); })}
                {canEdit && btn(busy === "apply" ? "執行中…" : "▶ 執行全部規則", runApply, { background: C.accent, color: "#fff", borderColor: C.accent })}
              </div>
              {acctRules.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>此信箱還沒有規則。</div> : (
                <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
                  {!isM && <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.4fr) 110px 90px 60px 50px", gap: 10, padding: "7px 12px", background: "#ece4d6", fontSize: 10.5, fontWeight: 700, color: C.sub }}>
                    <span>條件</span><span>處理方式</span><span>適用範圍</span><span style={{ textAlign: "right" }}>命中</span><span style={{ textAlign: "center" }}>啟用</span>
                  </div>}
                  {acctRules.map((r, i) => (
                    <div key={r.id} onClick={() => canEdit && setDrawer(r.id)} style={{ display: isM ? "block" : "grid", gridTemplateColumns: "minmax(200px,1.4fr) 110px 90px 60px 50px", gap: 10, padding: "6px 12px", alignItems: "center", borderTop: i ? `1px solid #f0ead9` : "none", background: i % 2 ? "#faf6ec" : "#fff", opacity: r.enabled === false ? .45 : 1, cursor: canEdit ? "pointer" : "default", minHeight: 32 }}>
                      <span style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ color: C.faint, fontSize: 10.5, fontWeight: 700 }}>{({ from: "寄件者", subject: "主旨", to: "收件人" })[r.field]}</span> <span style={{ fontFamily: MONOF }}>{r.match || "（空）"}</span>
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: ACT_COLOR[r.action] }}>{actLabel(r.action)}{r.label ? `(${r.label})` : ""}</span>
                      <span>{r.scope === "all" ? <span style={{ fontSize: 10.5, fontWeight: 700, color: "#7a5c1e", background: "#f3e8cf", border: "1px solid #e4d5ae", borderRadius: 5, padding: "1px 7px" }}>全部</span> : <span style={{ fontSize: 10.5, color: C.faint }}>此信箱</span>}</span>
                      <span style={{ fontFamily: MONOF, fontSize: 11.5, textAlign: isM ? "left" : "right", color: r.hits ? C.sub : "#d5cbb6" }}>{r.hits || 0}</span>
                      <span style={{ textAlign: "center" }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={r.enabled !== false} onChange={e => canEdit && upd(r.id, { enabled: e.target.checked })} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── 紀錄 ── */}
          {curTab === "logs" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
                {[["attention", "需注意"], ["delete", "只看刪除"], ["low", "只看AI判斷"], ["all", "全部"]].map(([k, l]) => (
                  <button key={k} onClick={() => setLogFilter(k)} style={{ border: `1px solid ${logFilter === k ? C.accent : C.line}`, background: logFilter === k ? C.accent : "#fff", color: logFilter === k ? "#fff" : C.sub, borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
                ))}
                <div style={{ flex: 1 }} />
                <a href="https://mail.google.com/mail/#trash" target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.blue }}>↩ 到 Gmail 垃圾桶救回（30天內）</a>
              </div>
              {logRows.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>還沒有執行紀錄。</div> : (
                <div>
                  {logRows.slice(0, logShow).map((it, i) => {
                    const showDel = logFilter === "all" || logFilter === "attention" || logFilter === "delete";
                    const showLow = logFilter === "all" || logFilter === "attention" || logFilter === "low";
                    return (
                      <div key={i} style={{ borderTop: i ? `1px solid #f0ead9` : "none", padding: "8px 4px" }}>
                        <div style={{ fontSize: 11, color: C.faint, fontFamily: MONOF, marginBottom: 4 }}>{new Date(it.ts).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}・共 {it.moved} 封</div>
                        {showDel && it.del.map((p, j) => (
                          <div key={"d" + j} style={{ fontSize: 12, color: C.text, padding: "2px 0" }}>
                            <b style={{ color: C.red }}>🗑 刪除 {p.count} 封</b>・{p.rule}{(p.samples || []).length > 0 && <span style={{ color: C.faint, fontSize: 11 }}>（{p.samples.slice(0, 2).join("、")}…）</span>}
                          </div>
                        ))}
                        {showLow && it.low.map((p, j) => (
                          <div key={"l" + j} style={{ fontSize: 12, color: C.text, padding: "2px 0" }}>
                            <b style={{ color: C.amber }}>🤖 AI 判斷刪除 {p.count} 封</b>・{p.rule}{(p.samples || []).length > 0 && <span style={{ color: C.faint, fontSize: 11 }}>（{p.samples.slice(0, 2).join("、")}…）</span>}
                          </div>
                        ))}
                        {it.normCount > 0 && logFilter === "all" && it.norm.map((p, j) => (
                          <div key={"n" + j} style={{ fontSize: 12, color: C.sub, padding: "2px 0" }}>{actLabel(p.action)}{p.label ? "（" + p.label + "）" : ""}・{p.rule}・{p.count} 封</div>
                        ))}
                        {it.normCount > 0 && logFilter !== "all" && (
                          <div onClick={() => setLogFilter("all")} style={{ fontSize: 11.5, color: C.faint, padding: "2px 0", cursor: "pointer" }}>規則正常處理 {it.normCount} 封 ▸</div>
                        )}
                      </div>
                    );
                  })}
                  {logRows.length > logShow && <button onClick={() => setLogShow(n => n + 20)} style={{ width: "100%", marginTop: 8, border: `1px dashed ${C.line}`, background: "#fff", color: C.sub, borderRadius: 8, padding: "7px 0", fontSize: 12.5, cursor: "pointer" }}>查看更多（還有 {logRows.length - logShow} 次執行）</button>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ 規則編輯 drawer（右側） ══ */}
      {drawerRule && (
        <div onClick={e => e.target === e.currentTarget && setDrawer(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 750 }}>
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "min(400px,100vw)", background: "#fff", boxShadow: "-6px 0 30px rgba(0,0,0,.15)", padding: 22, overflowY: "auto", boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>編輯規則</div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setDrawer(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.sub }}>×</button>
            </div>
            {[
              ["比對欄位", <select value={drawerRule.field} onChange={e => upd(drawerRule.id, { field: e.target.value })} style={{ ...inp, width: "100%" }}><option value="from">寄件者</option><option value="subject">主旨</option><option value="to">收件人</option></select>],
              ["包含文字（多關鍵字用 | 分隔）", <input value={drawerRule.match} onChange={e => upd(drawerRule.id, { match: e.target.value })} placeholder="例：ctbcbank 或 發票|invoice" style={{ ...inp, width: "100%" }} autoFocus />],
              ["處理方式", <select value={drawerRule.action} onChange={e => upd(drawerRule.id, { action: e.target.value })} style={{ ...inp, width: "100%", color: ACT_COLOR[drawerRule.action], fontWeight: 700 }}>{ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>],
              ...(drawerRule.action === "label" ? [["標籤名稱", <input value={drawerRule.label || ""} onChange={e => upd(drawerRule.id, { label: e.target.value })} style={{ ...inp, width: "100%" }} />]] : []),
              ["備註（為什麼）", <input value={drawerRule.note || ""} onChange={e => upd(drawerRule.id, { note: e.target.value })} style={{ ...inp, width: "100%" }} />],
            ].map(([l, node], i) => <label key={i} style={{ display: "block", fontSize: 11, color: C.faint, fontWeight: 600, marginBottom: 12 }}>{l}<div style={{ marginTop: 4 }}>{node}</div></label>)}
            <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, marginBottom: 6 }}>適用範圍</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => upd(drawerRule.id, { scope: "all" })} style={{ flex: 1, border: `1.5px solid ${drawerRule.scope === "all" ? C.accent : C.line}`, background: drawerRule.scope === "all" ? "#fdf3ee" : "#fff", color: drawerRule.scope === "all" ? C.accent : C.sub, borderRadius: 8, padding: "7px 0", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>全部信箱</button>
              <button onClick={() => upd(drawerRule.id, { scope: Array.isArray(drawerRule.scope) && drawerRule.scope.length ? drawerRule.scope : [acct === "__all__" ? "gm77" : acct] })} style={{ flex: 1, border: `1.5px solid ${drawerRule.scope !== "all" ? C.accent : C.line}`, background: drawerRule.scope !== "all" ? "#fdf3ee" : "#fff", color: drawerRule.scope !== "all" ? C.accent : C.sub, borderRadius: 8, padding: "7px 0", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>指定信箱</button>
            </div>
            {drawerRule.scope !== "all" && accts.map(a => (
              <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, marginBottom: 6 }}>
                <input type="checkbox" checked={Array.isArray(drawerRule.scope) && drawerRule.scope.includes(a.id)} onChange={e => {
                  const cur = Array.isArray(drawerRule.scope) ? drawerRule.scope : [];
                  upd(drawerRule.id, { scope: e.target.checked ? [...cur, a.id] : cur.filter(x => x !== a.id) });
                }} />{a.email}
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, margin: "14px 0" }}>
              <input type="checkbox" checked={drawerRule.enabled !== false} onChange={e => upd(drawerRule.id, { enabled: e.target.checked })} />啟用這條規則
            </label>
            <div style={{ fontSize: 11, color: C.faint, marginBottom: 14 }}>刪除＝移到 Gmail 垃圾桶（30 天可救回）；「保留」＝白名單，永遠不會被動到。</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => { if (await confirm(`刪除規則「${drawerRule.note || drawerRule.match}」？`, { confirmLabel: "刪除" })) { saveRules(rules.filter(x => x.id !== drawerRule.id)); setDrawer(null); } }} style={{ border: `1px solid #e5c4bd`, background: "#fff", color: C.red, borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>刪除規則</button>
              <button onClick={() => setDrawer(null)} style={{ flex: 1, border: "none", background: C.accent, color: "#fff", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>完成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
