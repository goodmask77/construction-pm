// 設定 > 郵件管理 —— 通用文字規則引擎（2026-07-18 張良定案）
// 主體＝規則（第一層）：如果信件的【標題/內文/寄件者/收件者】包含【關鍵字們】→ 執行【刪除/保留/移到資料夾】→ 套用【此信箱/全部信箱】
// 信件（第二層）＝測試資料：預覽命中、覆核 AI 判斷（覆核紀錄會讓建議越來越準）、快速提取關鍵字建規則。
// 資料模型 v2：{id,name,fields[],mode,keywords[],action,folder,group,scope,enabled,hits}；v1 舊規則自動 migration，一條不丟。
import React, { useEffect, useState } from "react";

const C = {
  text: "#1d1a15", sub: "#5a5247", faint: "#9b9384", line: "#d9cfbd", hard: "#c8bca6",
  card: "#fbf8f1", soft: "#f4efe5", accent: "#c4582a", blue: "#3a6ea5", green: "#3f7d4e", red: "#b3261e", amber: "#c98a14",
};
const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const FIELD_OPTS = [["subject", "標題"], ["body", "內文"], ["from", "寄件者名稱/地址"], ["to", "收件者地址"]];
const fieldLabel = (f) => (FIELD_OPTS.find(x => x[0] === f) || [, f])[1];
const MODE_OPTS = [["any", "包含任一關鍵字"], ["all", "包含全部關鍵字"], ["exact", "完全符合"]];
const ACT_OPTS = [["delete", "🗑 刪除", "#b3261e"], ["keep", "✋ 保留", "#3f7d4e"], ["move", "📁 移到資料夾", "#3a6ea5"]];
const actLabel = (r) => r.action === "move" ? `📁 移到「${r.folder || "?"}」` : (ACT_OPTS.find(x => x[0] === r.action) || [, r.action])[1];
const actColor = (a) => (ACT_OPTS.find(x => x[0] === a) || [, , C.sub])[2];
const rid = () => "mr-" + Math.random().toString(36).slice(2, 8);
const DEFAULT_ACCTS = [{ id: "gm77", email: "goodmask77@gmail.com", enabled: true }];

// 前端比對（信封欄位；內文只有後端執行時比對得到）
function matchMail(r, m) {
  const textOf = (f) => f === "subject" ? (m.subject || "") : f === "from" ? ((m.from || "") + " " + (m.name || "")) : f === "to" ? (m.to || "") : "";
  const kws = (r.keywords || []).filter(Boolean);
  if (!kws.length) return false;
  const kwHit = (kw) => { const k = kw.toLowerCase(); return (r.fields || []).some(f => { if (f === "body") return false; const t = textOf(f).toLowerCase(); return r.mode === "exact" ? t.trim() === k : t.includes(k); }); };
  return r.mode === "all" ? kws.every(kwHit) : kws.some(kwHit);
}
// v1 → v2 migration（一條不丟；命中數/啟用/範圍保留）
function migrateRule(r) {
  if (r.fields && r.keywords) return r; // 已是 v2
  return {
    id: r.id, name: r.note || r.match || "規則",
    fields: [r.field === "subject" ? "subject" : r.field === "to" ? "to" : "from"],
    mode: "any",
    keywords: String(r.match || "").split("|").map(s => s.trim()).filter(Boolean),
    action: r.action === "label" ? "move" : r.action === "archive" ? "move" : r.action,
    folder: r.label || (r.action === "archive" ? "封存" : ""),
    group: "", scope: r.scope || ["gm77"], enabled: r.enabled, hits: r.hits || 0,
  };
}
// AI 建議：①你的覆核紀錄（同網域→照你上次的決定）②通用判斷邏輯
function suggestFor(sd, reviews) {
  const dom = (sd.from.split("@")[1] || "").toLowerCase();
  const rv = (reviews || []).find(x => (x.from.split("@")[1] || "").toLowerCase() === dom);
  if (rv) return { action: rv.choice, why: "你上次對這個網域的覆核", learned: true };
  const f = (sd.from + " " + (sd.name || "")).toLowerCase(), sj = (sd.sample || "").toLowerCase();
  const has = (...ks) => ks.some(k => f.includes(k) || sj.includes(k));
  if (has("pinterest", "linkedin", "facebook", "instagram", "newsletter", "電子報", "促銷", "優惠", "任務", "points")) return { action: "delete", why: "廣告/社群通知" };
  if (has("驗證碼", "login", "verification", "登入")) return { action: "delete", why: "登入/驗證信，看過即丟" };
  if (has("發票", "invoice", "receipt", "帳單", "statement", "收據")) return { action: "move", why: "憑證類，建議分類保存" };
  if (has("gov.tw", "勞保", "健保", "國稅", "補貼")) return { action: "keep", why: "政府/法定通知，建議保留" };
  return null;
}

export default function MailManagerView({ K, canEdit, confirm }) {
  const isM = typeof window !== "undefined" && window.innerWidth < 720;
  const [accts, setAccts] = useState(DEFAULT_ACCTS);
  const [acct, setAcct] = useState(() => { try { return localStorage.getItem("pm_mail_last_acct") || "gm77"; } catch (_) { return "gm77"; } });
  const [tab, setTab] = useState("rules"); // 第一層＝規則；mails＝第二層信件；logs
  const [scan, setScan] = useState(null);
  const [rules, setRules] = useState(null);
  const [reviews, setReviews] = useState([]); // 覆核紀錄（學習用）
  const [log, setLog] = useState({ items: [] });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [openFrom, setOpenFrom] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [kwInput, setKwInput] = useState("");
  const [menu, setMenu] = useState(null);
  const [logFilter, setLogFilter] = useState("attention");
  const [logShow, setLogShow] = useState(10);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? null : m)), 8000); };

  const loadAll = async () => {
    try { const v = await window.storage.get(K("pm_mail_accounts"), true); const d = v && v.value ? JSON.parse(v.value) : null; if (d?.list?.length) setAccts(d.list); } catch (_) {}
    try { const v = await window.storage.get(K("pm_mail_scan"), true); setScan(v && v.value ? JSON.parse(v.value) : null); } catch (_) {}
    try { const v = await window.storage.get(K("pm_mail_log"), true); const d = v && v.value ? JSON.parse(v.value) : null; if (d) setLog({ items: d.items || [] }); } catch (_) {}
    try { const v = await window.storage.get(K("pm_mail_reviews"), true); const d = v && v.value ? JSON.parse(v.value) : null; if (d) setReviews(d.items || []); } catch (_) {}
    try {
      const v = await window.storage.get(K("pm_mail_rules"), true); const d = v && v.value ? JSON.parse(v.value) : { rules: [] };
      let list = (d.rules || []).map(migrateRule);
      if (d.v !== 2) { await window.storage.set(K("pm_mail_rules"), JSON.stringify({ v: 2, rules: list }), true).catch(() => {}); }
      setRules(list);
    } catch (_) { setRules([]); }
  };
  useEffect(() => { loadAll(); }, []); // eslint-disable-line
  useEffect(() => { try { localStorage.setItem("pm_mail_last_acct", acct); } catch (_) {} }, [acct]);

  const saveRules = (list) => { setRules(list); window.storage.set(K("pm_mail_rules"), JSON.stringify({ v: 2, rules: list }), true).catch(() => {}); };
  const saveAccts = (list) => { setAccts(list); window.storage.set(K("pm_mail_accounts"), JSON.stringify({ list }), true).catch(() => {}); };
  const saveReviews = (items) => { setReviews(items); window.storage.set(K("pm_mail_reviews"), JSON.stringify({ items: items.slice(0, 500) }), true).catch(() => {}); };
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

  // 覆核（信件頁）：記錄學習 → 追問建立通用規則（預填、可再泛化）
  const review = async (sd, choice) => {
    if (!canEdit) return;
    const sug = suggestFor(sd, reviews);
    saveReviews([{ from: sd.from, name: sd.name || "", subject: sd.sample || "", suggest: sug?.action || "", choice, ts: new Date().toISOString() }, ...reviews]);
    const ok = await confirm(`「${sd.name || sd.from}」→ ${(ACT_OPTS.find(a => a[0] === choice) || [])[1]}\n\n要把這次選擇建立成通用規則嗎？（可以再改關鍵字讓它涵蓋更多信）`, { confirmLabel: "建立規則", danger: false });
    if (!ok) { flash("已記住你的覆核（下次同類信會照這個建議），沒有建立規則。"); return; }
    const nid = rid();
    saveRules([{ id: nid, name: sd.name || sd.from.split("@")[0], fields: ["from"], mode: "any", keywords: [sd.from], action: choice, folder: "", group: "", scope: [acct], enabled: true, hits: 0 }, ...(rules || [])]);
    setScan(s => s ? { ...s, senders: (s.senders || []).filter(x => x.from !== sd.from), mails: (s.mails || []).filter(m => m.from !== sd.from) } : s);
    setTab("rules"); setDrawer(nid); setKwInput("");
  };

  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const btn = (label, onClick, style2) => <button onClick={onClick} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", ...style2 }}>{label}</button>;
  const chip = (on, label, onClick, color, key) => (
    <button key={key || label} onClick={onClick} style={{ border: `1.5px solid ${on ? (color || C.accent) : C.line}`, background: on ? (color || C.accent) : "#fff", color: on ? "#fff" : C.sub, borderRadius: 999, padding: "5px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{label}</button>
  );

  const curAcct = accts.find(a => a.id === acct);
  const enabledRules = (rules || []).filter(r => r.enabled !== false);
  // 信件頁：只列「沒有任何規則會接手」的來源
  const covered = (sd) => enabledRules.some(r => inScope(r, acct) && matchMail(r, { from: sd.from, name: sd.name, subject: sd.sample, to: "" }));
  const senders = (scan?.senders || []).filter(sd => !covered(sd));
  const pendingN = senders.length;
  const acctRules = (rules || []).filter(r => inScope(r, acct));
  const groups = [...new Set(acctRules.map(r => r.group || ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "zh-TW")));
  const folders = [...new Set((rules || []).map(r => r.folder).filter(Boolean))];
  const groupNames = [...new Set((rules || []).map(r => r.group).filter(Boolean))];
  const ydayMoved = (() => { const y = new Date(Date.now() - 864e5).toLocaleDateString("zh-TW"); return (log.items || []).filter(it => new Date(it.ts).toLocaleDateString("zh-TW") === y).reduce((s, it) => s + (it.moved || 0), 0); })();
  const moved30 = (log.items || []).filter(it => Date.now() - new Date(it.ts).getTime() < 30 * 864e5).reduce((s, it) => s + (it.moved || 0), 0);
  const drawerRule = drawer && (rules || []).find(r => r.id === drawer);
  const summary = (r) => `${(r.fields || []).map(fieldLabel).join("、")}${r.mode === "exact" ? "完全符合" : "包含"}「${(r.keywords || []).join("、")}」${r.mode === "all" ? "（全部）" : ""}`;

  const logRows = (log.items || []).map(it => {
    const low = (it.perRule || []).filter(p => String(p.ruleId || "").startsWith("__"));
    const del = (it.perRule || []).filter(p => p.action === "delete" && !String(p.ruleId || "").startsWith("__"));
    const norm = (it.perRule || []).filter(p => p.action !== "delete" && !String(p.ruleId || "").startsWith("__"));
    return { ts: it.ts, moved: it.moved, low, del, norm, normCount: norm.reduce((s, p) => s + p.count, 0) };
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* ── 頂部：信箱 dropdown ＋ 狀態 ＋ 動作 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 14px", flexWrap: "wrap", position: "relative" }}>
        <button onClick={() => setMenu(menu === "acct" ? null : "acct")} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1.5px solid ${C.hard}`, background: "#fff", borderRadius: 9, padding: "8px 14px", fontSize: 14, fontWeight: 700, color: C.text, cursor: "pointer" }}>
          📮 {acct === "__all__" ? "所有信箱" : (curAcct?.email || "選擇信箱")} <span style={{ color: C.faint, fontSize: 11 }}>▾</span>
        </button>
        {menu === "acct" && (
          <div style={{ position: "absolute", top: 42, left: 0, zIndex: 60, background: "#fff", border: `1.5px solid ${C.hard}`, borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,.12)", minWidth: 260, overflow: "hidden" }}>
            {accts.map(a => (
              <div key={a.id} onClick={() => { setAcct(a.id); setMenu(null); }} style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", background: acct === a.id ? C.soft : "#fff", color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
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

      {acct === "__all__" ? (
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 10 }}>所有信箱</div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
            {!isM && <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.4fr) 100px 90px 130px 90px", gap: 10, padding: "8px 14px", background: "#ece4d6", fontSize: 11, fontWeight: 700, color: C.sub }}>
              <span>信箱</span><span>連線狀態</span><span style={{ textAlign: "right" }}>規則數</span><span style={{ textAlign: "right" }}>近30日處理量</span><span />
            </div>}
            {accts.map((a, i) => (
              <div key={a.id} style={{ display: isM ? "block" : "grid", gridTemplateColumns: "minmax(220px,1.4fr) 100px 90px 130px 90px", gap: 10, padding: "9px 14px", alignItems: "center", borderTop: i ? `1px solid #f0ead9` : "none", background: i % 2 ? "#faf6ec" : "#fff", fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: C.text }}>{a.email}</span>
                <span style={{ fontSize: 12, color: a.enabled === false ? C.faint : C.green, fontWeight: 600 }}>{a.enabled === false ? "⏸ 已停用" : "🟢 已連線"}</span>
                <span style={{ fontFamily: MONOF, textAlign: isM ? "left" : "right" }}>{(rules || []).filter(r => inScope(r, a.id)).length}</span>
                <span style={{ fontFamily: MONOF, textAlign: isM ? "left" : "right" }}>{moved30}</span>
                <button onClick={() => setAcct(a.id)} style={{ border: `1px solid ${C.accent}`, background: "#fff", color: C.accent, borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", justifySelf: "end" }}>管理</button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {/* 第一層＝規則；第二層＝信件（測試/覆核）；紀錄 */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: `2px solid ${C.hard}` }}>
            {[["rules", "規則"], ["mails", "信件"], ["logs", "紀錄"]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{ border: "none", background: "none", padding: "8px 14px", fontSize: 13.5, fontWeight: tab === k ? 800 : 500, color: tab === k ? C.text : C.faint, cursor: "pointer", borderBottom: tab === k ? `3px solid ${C.accent}` : "3px solid transparent", marginBottom: -2, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {l}{k === "mails" && pendingN > 0 && <span style={{ background: C.accent, color: "#fff", fontSize: 10.5, fontWeight: 800, borderRadius: 9, padding: "1px 7px" }}>{pendingN}</span>}
              </button>
            ))}
          </div>

          {/* ══ 規則（主體） ══ */}
          {tab === "rules" && rules && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {canEdit && btn("＋ 新增規則", () => { const nid = rid(); saveRules([{ id: nid, name: "", fields: ["subject"], mode: "any", keywords: [], action: "delete", folder: "", group: "", scope: [acct], enabled: true, hits: 0 }, ...rules]); setDrawer(nid); setKwInput(""); })}
                {canEdit && btn(busy === "apply" ? "執行中…" : "▶ 執行全部規則", runApply, { background: C.accent, color: "#fff", borderColor: C.accent })}
              </div>
              {acctRules.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>還沒有規則——按「＋新增規則」，或到「信件」頁從實際信件建。</div> :
                groups.map(g => (
                  <div key={g || "__none__"} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, margin: "0 0 6px 2px" }}>{g || "未分組"} <span style={{ fontWeight: 400, color: C.faint }}>{acctRules.filter(r => (r.group || "") === g).length} 條</span></div>
                    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
                      {acctRules.filter(r => (r.group || "") === g).map((r, i) => (
                        <div key={r.id} onClick={() => canEdit && (setDrawer(r.id), setKwInput(""))} style={{ display: isM ? "block" : "grid", gridTemplateColumns: "minmax(240px,1.6fr) 150px 70px 56px 46px", gap: 10, padding: "8px 12px", alignItems: "center", borderTop: i ? `1px solid #f0ead9` : "none", background: i % 2 ? "#faf6ec" : "#fff", opacity: r.enabled === false ? .45 : 1, cursor: canEdit ? "pointer" : "default" }}>
                          <span style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.name || "（未命名）"}</div>
                            <div style={{ fontSize: 11, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary(r)}</div>
                          </span>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: actColor(r.action) }}>{actLabel(r)}</span>
                          <span style={{ fontSize: 10.5 }}>{r.scope === "all" ? <span style={{ fontWeight: 700, color: "#7a5c1e", background: "#f3e8cf", border: "1px solid #e4d5ae", borderRadius: 5, padding: "1px 7px" }}>全部信箱</span> : <span style={{ color: C.faint }}>此信箱</span>}</span>
                          <span style={{ fontFamily: MONOF, fontSize: 11.5, textAlign: isM ? "left" : "right", color: r.hits ? C.sub : "#d5cbb6" }}>{r.hits || 0}</span>
                          <span style={{ textAlign: "center" }} onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={r.enabled !== false} onChange={e => canEdit && upd(r.id, { enabled: e.target.checked })} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* ══ 信件（第二層：預覽/覆核/建規則素材） ══ */}
          {tab === "mails" && (
            !scan ? <div style={{ padding: 30, textAlign: "center", color: C.faint, fontSize: 13 }}>還沒掃描過——按右上「🔍 立即掃描」。</div> :
            pendingN === 0 ? <div style={{ padding: 26, textAlign: "center", fontSize: 14, color: C.green, fontWeight: 700 }}>✓ 收件匣的信都有規則接手了 · 昨日自動處理 {ydayMoved} 封</div> : (
              <div>
                <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 8 }}>這些來源還沒有規則接手。我先給建議（會從你的覆核學），你按一下覆核；確認後可一鍵變通用規則。</div>
                {senders.map(sd => {
                  const open = openFrom === sd.from;
                  const sug = suggestFor(sd, reviews);
                  const mailsOf = open ? (scan.mails || []).filter(m => m.from === sd.from) : [];
                  return (
                    <React.Fragment key={sd.from}>
                      <div onClick={() => setOpenFrom(open ? null : sd.from)} style={{ display: isM ? "block" : "grid", gridTemplateColumns: "minmax(190px,1.2fr) 40px minmax(150px,1.2fr) minmax(140px,1fr) 224px", gap: 10, alignItems: "center", padding: "8px 10px", borderTop: `1px solid #f0ead9`, cursor: "pointer", background: open ? C.soft : "transparent" }}>
                        <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 12.5 }} title={sd.from}><b style={{ color: C.text }}>{sd.name || sd.from.split("@")[0]}</b> <span style={{ color: C.faint, fontSize: 10.5 }}>{sd.from}</span></div>
                        <span style={{ fontFamily: MONOF, fontWeight: 700, fontSize: 12, color: sd.count >= 10 ? C.accent : C.sub, textAlign: isM ? "left" : "right" }}>{sd.count}封</span>
                        <span style={{ color: C.sub, fontSize: 11.5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={sd.sample}>{sd.sample}</span>
                        {sug ? <span style={{ fontSize: 11, color: sug.learned ? C.green : C.faint, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{sug.learned ? "🧠 " : "💡 "}建議<b style={{ color: actColor(sug.action) }}>{(ACT_OPTS.find(a => a[0] === sug.action) || [])[1]}</b>・{sug.why}</span> : <span style={{ fontSize: 11, color: "#d5cbb6" }}>—</span>}
                        <div style={{ display: "flex", gap: 5, marginTop: isM ? 6 : 0 }} onClick={e => e.stopPropagation()}>
                          {canEdit && ACT_OPTS.map(([a, l, cl]) => (
                            <button key={a} onClick={() => review(sd, a)} style={{ border: `1.5px solid ${cl}`, background: sug?.action === a ? cl : "#fff", color: sug?.action === a ? "#fff" : cl, borderRadius: 999, padding: "3px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>{l.replace("移到資料夾", "分類")}</button>
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

          {/* ══ 紀錄 ══ */}
          {tab === "logs" && (
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
                    const showDel = ["all", "attention", "delete"].includes(logFilter);
                    const showLow = ["all", "attention", "low"].includes(logFilter);
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
                          <div key={"n" + j} style={{ fontSize: 12, color: C.sub, padding: "2px 0" }}>{p.action === "keep" ? "✋ 保留" : "📁 " + (p.label || "分類")}・{p.rule}・{p.count} 封</div>
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

      {/* ══ 規則編輯 drawer（通用文字規則） ══ */}
      {drawerRule && (() => {
        const r = drawerRule;
        const addKw = () => { const k = kwInput.trim(); if (!k) return; if (!(r.keywords || []).includes(k)) upd(r.id, { keywords: [...(r.keywords || []), k] }); setKwInput(""); };
        // 測試：以最近掃描的信（信封欄位）試跑這條規則
        const testHits = (scan?.mails || []).filter(m => matchMail(r, { from: m.from, name: m.name, subject: m.subject, to: "" }));
        return (
          <div onClick={e => e.target === e.currentTarget && setDrawer(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 750 }}>
            <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "min(420px,100vw)", background: "#fff", boxShadow: "-6px 0 30px rgba(0,0,0,.15)", padding: 22, overflowY: "auto", boxSizing: "border-box" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>規則</div>
                <div style={{ flex: 1 }} />
                <button onClick={() => setDrawer(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.sub }}>×</button>
              </div>
              <input value={r.name || ""} onChange={e => upd(r.id, { name: e.target.value })} placeholder="規則名稱（例：財務發票、垃圾廣告、AI服務）" style={{ ...inp, width: "100%", fontSize: 14, fontWeight: 700, marginBottom: 6 }} autoFocus={!r.name} />
              <input value={r.group || ""} onChange={e => upd(r.id, { group: e.target.value })} placeholder="分組（選填，例：刪除垃圾信）" list="mm-groups" style={{ ...inp, width: "100%", marginBottom: 4 }} />
              <datalist id="mm-groups">{groupNames.map(g => <option key={g} value={g} />)}</datalist>

              <div style={{ fontSize: 12, color: C.faint, fontWeight: 700, margin: "14px 0 7px" }}>當信件的（可複選）</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {FIELD_OPTS.map(([v, l]) => chip((r.fields || []).includes(v), l, () => {
                  const cur = r.fields || [];
                  const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
                  if (next.length) upd(r.id, { fields: next });
                }, null, v))}
              </div>

              <div style={{ fontSize: 12, color: C.faint, fontWeight: 700, margin: "14px 0 7px" }}>比對方式</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MODE_OPTS.map(([v, l]) => chip(r.mode === v, l, () => upd(r.id, { mode: v }), null, v))}
              </div>

              <div style={{ fontSize: 12, color: C.faint, fontWeight: 700, margin: "14px 0 7px" }}>關鍵字（輸入後按 Enter，一條規則放多個）</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                {(r.keywords || []).map(k => (
                  <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.soft, border: `1px solid ${C.hard}`, borderRadius: 999, padding: "3px 6px 3px 11px", fontSize: 12.5, fontFamily: MONOF, color: C.text }}>
                    {k}<button onClick={() => upd(r.id, { keywords: (r.keywords || []).filter(x => x !== k) })} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer", fontSize: 12, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
              <input value={kwInput} onChange={e => setKwInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addKw(); } }} onBlur={addKw} placeholder="例：發票（Enter 加入，再打下一個）" style={{ ...inp, width: "100%" }} />

              <div style={{ fontSize: 12, color: C.faint, fontWeight: 700, margin: "14px 0 7px" }}>就執行</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ACT_OPTS.map(([v, l, cl]) => chip(r.action === v, l, () => upd(r.id, { action: v }), cl, v))}
              </div>
              {r.action === "move" && (<>
                <input value={r.folder || ""} onChange={e => upd(r.id, { folder: e.target.value })} placeholder="資料夾名稱（選既有或打新的，不存在會自動建立）" list="mm-folders" style={{ ...inp, width: "100%", marginTop: 8 }} />
                <datalist id="mm-folders">{folders.map(f => <option key={f} value={f} />)}</datalist>
              </>)}

              <div style={{ fontSize: 12, color: C.faint, fontWeight: 700, margin: "14px 0 7px" }}>套用範圍</div>
              <div style={{ display: "flex", gap: 6 }}>
                {chip(r.scope !== "all", "目前信箱", () => upd(r.id, { scope: [acct === "__all__" ? "gm77" : acct] }))}
                {chip(r.scope === "all", "全部信箱", () => upd(r.id, { scope: "all" }))}
              </div>

              {/* 測試：拿最近掃描的信試跑 */}
              {(r.keywords || []).length > 0 && (
                <div style={{ marginTop: 14, background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>🧪 測試：最近掃描的 {scan?.mails?.length || 0} 封中會命中 <b style={{ color: testHits.length ? C.accent : C.green }}>{testHits.length}</b> 封</div>
                  {testHits.slice(0, 4).map((m, i) => <div key={i} style={{ fontSize: 11, color: C.sub, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", marginTop: 2 }}>・{m.subject}<span style={{ color: C.faint }}>（{m.from}）</span></div>)}
                  {(r.fields || []).includes("body") && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4 }}>※ 內文比對在實際執行時才會生效（這裡只測標題/地址）</div>}
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, margin: "14px 0" }}>
                <input type="checkbox" checked={r.enabled !== false} onChange={e => upd(r.id, { enabled: e.target.checked })} />啟用這條規則
              </label>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 14 }}>刪除＝移到 Gmail 垃圾桶（30 天可救回）；「保留」＝白名單，其他規則永遠動不到它。</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={async () => { if (await confirm(`刪除規則「${r.name || "未命名"}」？`, { confirmLabel: "刪除" })) { saveRules(rules.filter(x => x.id !== r.id)); setDrawer(null); } }} style={{ border: `1px solid #e5c4bd`, background: "#fff", color: C.red, borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>刪除規則</button>
                <button onClick={() => { addKw(); setDrawer(null); }} style={{ flex: 1, border: "none", background: C.accent, color: "#fff", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>完成</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
