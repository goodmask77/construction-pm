// LWLWLW 空間：電子信箱管理（goodmask77 收件匣）
// 來源判讀 → 規則表（留/刪/分類，寄來直接刪）→ 每日自動套用；點信件/來源快速建規則＝系統從你的標記學習。
import React, { useEffect, useState } from "react";

const C = {
  text: "#1d1a15", sub: "#5a5247", faint: "#9b9384", line: "#d9cfbd", hard: "#c8bca6",
  card: "#fbf8f1", soft: "#f4efe5", accent: "#c4582a", blue: "#3a6ea5", green: "#3f7d4e", red: "#b3261e", amber: "#c98a14",
};
const MONOF = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const ACTIONS = [["delete", "🗑 直接刪除"], ["label", "🏷 貼標分類"], ["archive", "📁 封存"], ["keep", "✋ 保留(白名單)"]];
const ACT_COLOR = { delete: C.red, label: C.blue, archive: C.amber, keep: C.green };
const rid = () => "mr-" + Math.random().toString(36).slice(2, 8);

// 來源判讀建議（先幫張良判，一鍵採用；他改了就以他的為準）
function suggest(sd) {
  const f = (sd.from + " " + (sd.name || "")).toLowerCase(), sj = (sd.sample || "").toLowerCase();
  const has = (...ks) => ks.some(k => f.includes(k) || sj.includes(k));
  if (has("ctbcbank")) return { action: "delete", why: "中信通知已自動入庫，原信可刪" };
  if (has("eats365")) return { action: "label", label: "eats365", why: "POS 報表已自動入庫，原檔貼標保存" };
  if (has("pinterest", "hbr", "linkedin", "facebook", "instagram", "電子報", "newsletter", "促銷", "優惠")) return { action: "delete", why: "廣告/社群通知" };
  if (has("登入成功", "login", "verification", "驗證碼")) return { action: "delete", why: "登入/驗證通知，看過即丟" };
  if (has("發票", "invoice", "receipt", "帳單", "statement")) return { action: "label", label: "帳務憑證", why: "憑證類，分類保存" };
  if (has("bank", "銀行", "信用卡")) return { action: "label", label: "銀行通知", why: "金融通知，分類保存" };
  if (has("gov.tw", "勞保", "健保", "國稅", "補貼")) return { action: "keep", why: "政府/法定通知，建議保留" };
  return null;
}

export default function MailManagerView({ K, canEdit, confirm }) {
  const [scan, setScan] = useState(null);
  const [rulesDoc, setRulesDoc] = useState({ rules: [] });
  const [log, setLog] = useState({ items: [] });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [openFrom, setOpenFrom] = useState(null); // 展開中的來源（顯示該來源的信件）
  const [q, setQ] = useState("");
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? null : m)), 9000); };

  const loadAll = async () => {
    try { const v = await window.storage.get(K("pm_mail_scan"), true); setScan(v && v.value ? JSON.parse(v.value) : null); } catch (_) {}
    try { const v = await window.storage.get(K("pm_mail_rules"), true); const d = v && v.value ? JSON.parse(v.value) : null; if (d) setRulesDoc({ rules: d.rules || [] }); } catch (_) {}
    try { const v = await window.storage.get(K("pm_mail_log"), true); const d = v && v.value ? JSON.parse(v.value) : null; if (d) setLog({ items: d.items || [] }); } catch (_) {}
  };
  useEffect(() => { loadAll(); }, []); // eslint-disable-line

  const saveRules = (rules) => { const next = { ...rulesDoc, rules }; setRulesDoc(next); window.storage.set(K("pm_mail_rules"), JSON.stringify(next), true).catch(() => {}); };
  const upd = (id, patch) => saveRules(rulesDoc.rules.map(r => r.id === id ? { ...r, ...patch } : r));

  const runScan = async () => {
    setBusy("scan");
    try { const r = await fetch("/api/mail-manage?action=scan&days=90"); const d = await r.json(); if (!d.ok) alert("掃描失敗：" + d.error); else { await loadAll(); flash(`✓ 掃描完成：收件匣近90天 ${d.inboxCount} 封、${d.senders} 個來源`); } } catch (e) { alert("掃描失敗：" + e.message); }
    setBusy("");
  };
  const runApply = async (days) => {
    if (!canEdit) return;
    const acts = rulesDoc.rules.filter(r => r.enabled !== false && r.action !== "keep");
    if (!acts.length) { alert("還沒有可執行的規則（只有保留/沒啟用）。"); return; }
    if (!(await confirm(`套用 ${acts.length} 條規則？範圍：收件匣＋重要郵件＋自建資料夾${days > 30 ? "（不限時間）" : "（近 " + days + " 天）"}。\n刪除＝移到垃圾桶，30 天內可救回。`, { confirmLabel: "執行" }))) return;
    setBusy("apply");
    try { const r = await fetch("/api/mail-manage?action=apply&days=" + days); const d = await r.json(); if (!d.ok) alert("執行失敗：" + d.error); else { await loadAll(); flash(d.skipped ? d.skipped : `✓ 已處理 ${d.moved} 封（${(d.perRule || []).map(x => `${x.rule}×${x.count}`).join("、")}）`); await runScan(); } } catch (e) { alert("執行失敗：" + e.message); }
    setBusy("");
  };
  // 從來源/信件一鍵建規則＝學習你的標記
  const quickRule = (field, match, action, note) => {
    if (!canEdit) return;
    const exist = rulesDoc.rules.find(r => r.field === field && r.match.toLowerCase() === match.toLowerCase());
    let label = "";
    if (action === "label") { label = window.prompt("標籤名稱（Gmail 會自動建立）", suggest({ from: match, sample: match })?.label || "自動分類") || ""; if (!label) return; }
    if (exist) upd(exist.id, { action, label, enabled: true });
    else saveRules([{ id: rid(), field, match, action, label, note: note || match, enabled: true, hits: 0 }, ...rulesDoc.rules]);
    flash(`✓ 已設定規則：「${match}」→ ${ACTIONS.find(a => a[0] === action)[1]}${label ? "（" + label + "）" : ""}。按「立即執行」馬上生效，之後每天自動。`);
  };

  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };
  const btn = (label, onClick, style2) => <button onClick={onClick} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", ...style2 }}>{label}</button>;
  const senders = (scan?.senders || []).filter(sd => !q.trim() || (sd.from + sd.name + sd.sample).toLowerCase().includes(q.trim().toLowerCase()));
  const ruleFor = (sd) => rulesDoc.rules.find(r => r.field === "from" && sd.from.includes(r.match.toLowerCase()));
  const box = { background: C.card, border: `1.5px solid ${C.hard}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <span style={{ background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px", letterSpacing: 1 }}>信箱</span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>📮 電子信箱管理 <span style={{ fontSize: 12, color: C.faint, fontWeight: 400 }}>goodmask77@gmail.com</span></div>
          <div style={{ fontSize: 11, color: C.faint }}>{scan ? `上次掃描 ${new Date(scan.scannedAt).toLocaleString("zh-TW")}・收件匣近${scan.days}天 ${scan.inboxCount} 封・${(scan.senders || []).length} 個來源` : "還沒掃描過"}・規則每天自動套用</div>
        </div>
        <div style={{ flex: 1 }} />
        {btn(busy === "scan" ? "掃描中…" : "🔍 重新掃描", runScan, { color: C.blue, borderColor: C.blue })}
        {canEdit && btn(busy === "apply" ? "執行中…" : "▶ 立即執行規則", () => runApply(3650), { background: C.accent, color: "#fff", borderColor: C.accent })}
      </div>
      {msg && <div style={{ background: "#eef5ef", border: `1.5px solid ${C.green}`, borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#2c5a38", fontWeight: 600 }}>{msg} <button onClick={() => setMsg(null)} style={{ border: "none", background: "none", color: C.green, cursor: "pointer", float: "right" }}>×</button></div>}

      {/* 規則表：留/刪/分類 全部在這裡設定 */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>📋 處理規則</div>
          <span style={{ fontSize: 11, color: C.faint }}>由上往下比對，「保留」優先於一切；「直接刪除」＝寄來就進垃圾桶（30天可救回）</span>
          <div style={{ flex: 1 }} />
          {canEdit && btn("＋ 新增規則", () => saveRules([{ id: rid(), field: "from", match: "", action: "delete", label: "", note: "", enabled: true, hits: 0 }, ...rulesDoc.rules]))}
        </div>
        {rulesDoc.rules.length === 0 ? <div style={{ padding: 14, textAlign: "center", color: C.faint, fontSize: 12.5 }}>還沒有規則——從下面「信件來源」點快速按鈕建立，或按「＋新增規則」。</div> : (
          <div style={{ overflowX: "auto" }}><div style={{ minWidth: 760 }}>
            <div style={{ display: "grid", gridTemplateColumns: "96px minmax(160px,1fr) 130px 110px minmax(120px,1fr) 52px 56px 34px", gap: 6, fontSize: 10.5, color: C.faint, fontWeight: 700, padding: "2px 4px" }}>
              <span>比對欄位</span><span>包含文字（多關鍵字用 | 分隔）</span><span>動作</span><span>標籤</span><span>備註</span><span>啟用</span><span>命中</span><span />
            </div>
            {rulesDoc.rules.map(r => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: "96px minmax(160px,1fr) 130px 110px minmax(120px,1fr) 52px 56px 34px", gap: 6, alignItems: "center", padding: "3px 4px", opacity: r.enabled === false ? .5 : 1 }}>
                <select value={r.field} onChange={e => upd(r.id, { field: e.target.value })} disabled={!canEdit} style={inp}><option value="from">寄件者</option><option value="subject">主旨</option><option value="to">收件人</option></select>
                <input value={r.match} onChange={e => upd(r.id, { match: e.target.value })} disabled={!canEdit} placeholder="例：ctbcbank 或 發票|invoice" style={inp} />
                <select value={r.action} onChange={e => upd(r.id, { action: e.target.value })} disabled={!canEdit} style={{ ...inp, color: ACT_COLOR[r.action], fontWeight: 700 }}>{ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input value={r.label || ""} onChange={e => upd(r.id, { label: e.target.value })} disabled={!canEdit || r.action !== "label"} placeholder={r.action === "label" ? "標籤名" : "—"} style={inp} />
                <input value={r.note || ""} onChange={e => upd(r.id, { note: e.target.value })} disabled={!canEdit} placeholder="為什麼" style={inp} />
                <input type="checkbox" checked={r.enabled !== false} onChange={e => upd(r.id, { enabled: e.target.checked })} disabled={!canEdit} style={{ justifySelf: "center" }} />
                <span style={{ fontFamily: MONOF, fontSize: 11.5, color: r.hits ? C.text : C.faint, textAlign: "right" }}>{r.hits || 0}</span>
                {canEdit && <button onClick={async () => { if (await confirm(`刪除規則「${r.note || r.match}」？`, { confirmLabel: "刪除" })) saveRules(rulesDoc.rules.filter(x => x.id !== r.id)); }} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer", fontSize: 14 }}>×</button>}
              </div>
            ))}
          </div></div>
        )}
      </div>

      {/* 信件來源＋信件（整合）：點來源列展開該來源的信；動作鈕＝建規則 */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>📬 信件來源（收件匣近 {scan?.days || 90} 天・{(scan?.mails || []).length} 封）</div>
          <span style={{ fontSize: 11, color: C.faint }}>點來源列＝展開信件；點動作鈕＝建立規則（系統照你的標記學習）</span>
          <div style={{ flex: 1 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋來源/主旨…" style={{ ...inp, width: 180 }} />
        </div>
        {!scan ? <div style={{ padding: 16, textAlign: "center", color: C.faint, fontSize: 12.5 }}>按右上「🔍 重新掃描」開始。</div> : senders.length === 0 ? <div style={{ padding: 16, textAlign: "center", color: C.faint, fontSize: 12.5 }}>收件匣乾乾淨淨 🎉（或掃描後全被規則處理掉了）</div> : (
          <div style={{ overflowX: "auto" }}><div style={{ minWidth: 860, maxHeight: "58vh", overflowY: "auto" }}>
            {senders.map(sd => {
              const r = ruleFor(sd); const sg = suggest(sd);
              const open = openFrom === sd.from;
              const mailsOf = open ? (scan.mails || []).filter(m => m.from === sd.from) : [];
              return (
                <React.Fragment key={sd.from}>
                  <div onClick={() => setOpenFrom(open ? null : sd.from)} style={{ display: "grid", gridTemplateColumns: "18px minmax(180px,1.2fr) 44px 76px minmax(170px,1.4fr) minmax(150px,1fr) 236px", gap: 8, alignItems: "center", minHeight: 34, borderTop: `1px solid #f0ead9`, fontSize: 12, cursor: "pointer", background: open ? "#f4efe5" : "transparent" }}>
                    <span style={{ color: C.faint, fontSize: 10, textAlign: "center" }}>{open ? "▾" : "▸"}</span>
                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={sd.from}><b style={{ color: C.text }}>{sd.name || sd.from.split("@")[0]}</b> <span style={{ color: C.faint, fontSize: 10.5 }}>{sd.from}</span></div>
                    <span style={{ fontFamily: MONOF, fontWeight: 700, textAlign: "right", color: sd.count >= 10 ? C.accent : C.text }}>{sd.count}</span>
                    <span style={{ fontFamily: MONOF, fontSize: 11, color: C.sub }}>{sd.latest.slice(5)}</span>
                    <span style={{ color: C.sub, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={sd.sample}>{sd.sample}</span>
                    {r ? <span style={{ fontSize: 11.5, fontWeight: 700, color: ACT_COLOR[r.action] }}>✓ {ACTIONS.find(a => a[0] === r.action)?.[1]}{r.label ? `(${r.label})` : ""}</span>
                      : sg ? <span style={{ fontSize: 11, color: C.faint }}>建議：<b style={{ color: ACT_COLOR[sg.action] }}>{ACTIONS.find(a => a[0] === sg.action)?.[1]}</b>・{sg.why}</span>
                        : <span style={{ fontSize: 11, color: "#d5cbb6" }}>—</span>}
                    <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                      {canEdit && [["delete", "🗑刪"], ["label", "🏷標"], ["archive", "📁存"], ["keep", "✋留"]].map(([a, l]) => (
                        <button key={a} onClick={() => quickRule("from", sd.from, a, sd.name || sd.from)} title={ACTIONS.find(x => x[0] === a)?.[1]} style={{ border: `1px solid ${r?.action === a ? ACT_COLOR[a] : C.line}`, background: r?.action === a ? ACT_COLOR[a] : "#fff", color: r?.action === a ? "#fff" : C.sub, borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>{l}</button>
                      ))}
                    </div>
                  </div>
                  {open && mailsOf.map((m, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "18px 76px minmax(260px,1fr) 150px", gap: 8, alignItems: "center", minHeight: 28, fontSize: 11.5, background: "#faf6ec", borderTop: "1px solid #f0ead9" }}>
                      <span />
                      <span style={{ fontFamily: MONOF, fontSize: 10.5, color: C.faint }}>{m.date.slice(5)}</span>
                      <span style={{ color: C.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }} title={m.subject}>{m.subject}</span>
                      {canEdit && <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => { const kw = window.prompt("主旨要包含什麼文字就直接刪？（可改短）", m.subject.slice(0, 20)); if (kw) quickRule("subject", kw, "delete", "主旨:" + kw); }} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.red, borderRadius: 6, padding: "2px 7px", fontSize: 10.5, cursor: "pointer" }}>此標題→刪</button>
                      </div>}
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div></div>
        )}
      </div>

      {/* 執行紀錄 */}
      {log.items.length > 0 && (
        <div style={box}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>🧾 執行紀錄</div>
          {log.items.slice(0, 12).map((it, i) => (
            <div key={i} style={{ fontSize: 12, color: C.sub, padding: "4px 0", borderTop: i ? `1px solid #f0ead9` : "none" }}>
              <span style={{ fontFamily: MONOF, fontSize: 11, color: C.faint }}>{new Date(it.ts).toLocaleString("zh-TW")}</span>　共 {it.moved} 封：
              {(it.perRule || []).map((pr, j) => <span key={j}>{j ? "、" : ""}<b>{pr.rule}</b>→{ACTIONS.find(a => a[0] === pr.action)?.[1]}{pr.label ? `(${pr.label})` : ""} {pr.count} 封</span>)}
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: C.faint }}>安全機制：刪除＝移到 Gmail 垃圾桶（30 天可救回）；「保留」規則是白名單、永遠不會被動到；處理範圍＝收件匣＋重要郵件＋垃圾郵件夾＋你自建的資料夾；「收件人」規則可清外洩地址（如 privaterelay）的信；分類好的目標資料夾、寄件備份、垃圾桶不會碰。規則每天自動跑一次。</div>
    </div>
  );
}
