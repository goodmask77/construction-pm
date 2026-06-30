// ── 公開結論（決策記錄簿）獨立模組 ──────────────────────────────────────────
// 集中存放所有「定案結論」，全員可查、D哥可答，解決「各人版本不同／認知落差」。
// 版本控制：更新結論 → 舊版自動歸檔(已更新)、畫面永遠只顯示現行定案；歷史可展開查。
// App 以 props 傳 K / confirm / canEdit / cats(隸屬) / userName / onLog。
import { useState, useEffect } from "react";

const C = { text: "#211C15", sub: "#6F6656", faint: "#A99F88", line: "#D8CFBB", soft: "#F1ECDD", bg: "#FCFAF4", card: "#FFFFFF", head: "#F6F2E8", accent: "#C13A22", green: "#3C8C3C", soft2: "#F3E4DE" };
const rid = () => "cc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);
const dnorm = (v) => String(v ?? "").replace(/\//g, "-").slice(0, 10);
const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "8px 10px", fontSize: 13.5, background: "#fff", color: C.text, boxSizing: "border-box", outline: "none", width: "100%" };
const dateInp = { ...inp, colorScheme: "light", fontFamily: "'Noto Sans TC',sans-serif", cursor: "pointer" };
const NONE = "__none__";

export default function Conclusions({ K, confirm, canEdit, cats, userName, onLog }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(null); // 新增表單暫存

  useEffect(() => { (async () => {
    try { const r = await window.storage.get(K("pm_conclusions"), true); setList(r && r.value ? JSON.parse(r.value) : []); } catch { setList([]); }
  })(); }, []); // eslint-disable-line

  const guard = () => { if (!canEdit) { alert("沒有編輯權限，請聯絡管理員。"); return false; } return true; };
  const save = (l) => { setList(l); window.storage.set(K("pm_conclusions"), JSON.stringify(l), true).catch(() => {}); };
  const catName = (id) => !id || id === NONE ? "全公司/不限" : (cats || []).find(c => c.id === id)?.name || "—";

  const addNew = () => {
    if (!guard()) return;
    const a = adding; if (!a || !a.topic.trim() || !a.conclusion.trim()) { alert("請至少填「主題」和「定案結論」"); return; }
    const e = { id: rid(), topic: a.topic.trim(), conclusion: a.conclusion.trim(), reason: a.reason.trim(), decidedBy: (a.decidedBy || userName || "").trim(), date: a.date || today(), catId: a.catId || NONE, tags: (a.tags || "").split(/[,，、\s]+/).filter(Boolean), status: "current", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), by: userName || "" };
    save([e, ...(list || [])]); setAdding(null);
    onLog?.("新增", `新增結論「${e.topic.slice(0, 24)}」`);
  };
  const upd = (id, patch) => save((list || []).map(c => c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c));
  const del = async (id) => { if (!guard()) return; const c = (list || []).find(x => x.id === id); if (!(await confirm(`刪除結論「${c?.topic || ""}」？（含其歷史版本）`, { confirmLabel: "刪除" }))) return; save((list || []).filter(x => x.id !== id && x.supersededBy !== id)); setSel(null); onLog?.("刪除", `刪除結論「${(c?.topic || "").slice(0, 24)}」`); };
  const newVersion = (c) => {
    if (!guard()) return;
    const nv = window.prompt("輸入「更新後的新結論」（舊的會自動歸檔到歷史）：", c.conclusion);
    if (nv == null || !nv.trim()) return;
    const newId = rid(), now = new Date().toISOString();
    const updated = (list || []).map(x => x.id === c.id ? { ...x, status: "archived", supersededBy: newId, updatedAt: now } : x);
    const fresh = { ...c, id: newId, conclusion: nv.trim(), status: "current", supersedes: c.id, date: today(), decidedBy: userName || c.decidedBy, createdAt: now, updatedAt: now };
    save([fresh, ...updated]); setSel(newId);
    onLog?.("編輯", `更新結論「${c.topic.slice(0, 24)}」出新版本`);
  };

  if (list === null) return <div style={{ padding: 40, textAlign: "center", color: C.faint }}>載入中…</div>;
  const current = list.filter(c => c.status !== "archived");
  const history = (topicId) => list.filter(c => c.status === "archived" && (c.id === topicId || c.supersededBy)).filter(c => c.topic === (list.find(x => x.id === topicId)?.topic));
  const matchQ = (c) => !q.trim() || (c.topic + c.conclusion + (c.reason || "") + (c.tags || []).join("") + (c.decidedBy || "")).toLowerCase().includes(q.trim().toLowerCase());
  let rows = (showArchived ? list : current).filter(matchQ).filter(c => fCat === "all" || (c.catId || NONE) === fCat);
  rows = [...rows].sort((a, b) => (a.date || "") < (b.date || "") ? 1 : -1);
  const catsOpts = [["all", "全部"], [NONE, "全公司/不限"], ...(cats || []).filter(c => !c.nonProject).map(c => [c.id, c.name])];

  return (
    <div style={{ maxWidth: 1000, margin: "6px auto", padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>📌 公開結論</div>
        <span style={{ fontSize: 12, color: C.faint }}>{current.length} 條現行定案</span>
        <div style={{ flex: 1 }} />
        {canEdit && <button onClick={() => setAdding({ topic: "", conclusion: "", reason: "", decidedBy: userName || "", date: today(), catId: NONE, tags: "" })} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>＋ 新增結論</button>}
      </div>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 14, lineHeight: 1.7, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px" }}>
        這裡是團隊「<b>共同認定的定案</b>」。畫面只顯示<b>現行版本</b>，結論變了就「更新出新版」、舊版自動進歷史——避免各人拿到不同版本。也可以直接問 D哥「○○的結論是什麼」。
      </div>

      {/* 篩選 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋主題/結論/決定人…" style={{ ...inp, width: 240 }} />
        <select value={fCat} onChange={e => setFCat(e.target.value)} style={{ ...inp, width: 160 }}>{catsOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label style={{ fontSize: 12.5, color: C.sub, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> 顯示歷史版本</label>
      </div>

      {rows.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: C.faint, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12 }}>還沒有結論。{canEdit && "按右上「＋ 新增結論」開始建立。"}</div> :
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map(c => {
            const archived = c.status === "archived";
            return (
              <div key={c.id} onClick={() => setSel(c.id)} style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `4px solid ${archived ? C.faint : C.green}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", opacity: archived ? 0.7 : 1, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{c.topic}</div>
                  {archived ? <span style={{ fontSize: 10.5, color: "#fff", background: C.faint, borderRadius: 5, padding: "1px 7px" }}>歷史版本</span> : <span style={{ fontSize: 10.5, color: "#fff", background: C.green, borderRadius: 5, padding: "1px 7px" }}>現行</span>}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11.5, color: C.faint }}>{c.date}</span>
                </div>
                <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.conclusion}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 7 }}>
                  <span style={{ fontSize: 11, color: C.sub, background: C.soft, borderRadius: 5, padding: "2px 7px" }}>📁 {catName(c.catId)}</span>
                  {c.decidedBy && <span style={{ fontSize: 11, color: C.sub }}>👤 {c.decidedBy}</span>}
                  {(c.tags || []).map(t => <span key={t} style={{ fontSize: 11, color: C.accent, background: C.soft2, borderRadius: 5, padding: "2px 7px" }}>#{t}</span>)}
                </div>
              </div>
            );
          })}
        </div>}

      {/* 新增表單 */}
      {adding && (
        <div onClick={e => e.target === e.currentTarget && setAdding(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "min(560px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>＋ 新增結論</div>
            <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 10 }}>主題 / 問題<input autoFocus value={adding.topic} onChange={e => setAdding(p => ({ ...p, topic: e.target.value }))} placeholder="例：廚房地坪要用哪種防滑磚？" style={{ ...inp, marginTop: 4 }} /></label>
            <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 10 }}>定案結論<textarea value={adding.conclusion} onChange={e => setAdding(p => ({ ...p, conclusion: e.target.value }))} rows={3} placeholder="最後拍板的決定…" style={{ ...inp, marginTop: 4, resize: "vertical" }} /></label>
            <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 10 }}>背景 / 理由（選填）<textarea value={adding.reason} onChange={e => setAdding(p => ({ ...p, reason: e.target.value }))} rows={2} placeholder="為什麼這樣決定，避免日後重吵…" style={{ ...inp, marginTop: 4, resize: "vertical" }} /></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600 }}>隸屬<select value={adding.catId} onChange={e => setAdding(p => ({ ...p, catId: e.target.value }))} style={{ ...inp, marginTop: 4 }}><option value={NONE}>全公司/不限</option>{(cats || []).filter(c => !c.nonProject).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600 }}>決定人<input value={adding.decidedBy} onChange={e => setAdding(p => ({ ...p, decidedBy: e.target.value }))} style={{ ...inp, marginTop: 4 }} /></label>
              <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600 }}>日期<input type="date" value={dnorm(adding.date)} onChange={e => setAdding(p => ({ ...p, date: e.target.value }))} style={{ ...dateInp, marginTop: 4 }} /></label>
              <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600 }}>標籤（逗號分隔）<input value={adding.tags} onChange={e => setAdding(p => ({ ...p, tags: e.target.value }))} placeholder="例：材料,防滑" style={{ ...inp, marginTop: 4 }} /></label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setAdding(null)} style={{ background: "none", border: `1px solid ${C.line}`, color: C.sub, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={addNew} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>儲存結論</button>
            </div>
          </div>
        </div>
      )}

      {/* 詳情 / 編輯 */}
      {sel && (() => {
        const c = list.find(x => x.id === sel); if (!c) return null;
        const hist = list.filter(x => x.status === "archived" && x.topic === c.topic && x.id !== c.id).sort((a, b) => (a.date || "") < (b.date || "") ? 1 : -1);
        const F = (label, node) => <label style={{ display: "block", fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 10 }}>{label}<div style={{ marginTop: 4 }}>{node}</div></label>;
        return (
          <div onClick={e => e.target === e.currentTarget && setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "min(580px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>結論詳情{c.status === "archived" && "（歷史版本）"}</div>
                <div style={{ flex: 1 }} />
                {canEdit && <button onClick={() => del(c.id)} style={{ background: "none", border: `1px solid ${C.line}`, color: "#C0392B", borderRadius: 7, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>刪除</button>}
                <button onClick={() => setSel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>×</button>
              </div>
              {F("主題 / 問題", <input value={c.topic} onChange={e => upd(c.id, { topic: e.target.value })} disabled={!canEdit || c.status === "archived"} style={{ ...inp, fontWeight: 600 }} />)}
              {F("定案結論", <textarea value={c.conclusion} onChange={e => upd(c.id, { conclusion: e.target.value })} disabled={!canEdit || c.status === "archived"} rows={3} style={{ ...inp, resize: "vertical" }} />)}
              {F("背景 / 理由", <textarea value={c.reason || ""} onChange={e => upd(c.id, { reason: e.target.value })} disabled={!canEdit || c.status === "archived"} rows={2} style={{ ...inp, resize: "vertical" }} />)}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {F("隸屬", <select value={c.catId || NONE} onChange={e => upd(c.id, { catId: e.target.value })} disabled={!canEdit || c.status === "archived"} style={inp}><option value={NONE}>全公司/不限</option>{(cats || []).filter(x => !x.nonProject).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>)}
                {F("決定人", <input value={c.decidedBy || ""} onChange={e => upd(c.id, { decidedBy: e.target.value })} disabled={!canEdit || c.status === "archived"} style={inp} />)}
                {F("日期", <input type="date" value={dnorm(c.date)} onChange={e => upd(c.id, { date: e.target.value })} disabled={!canEdit || c.status === "archived"} style={dateInp} />)}
              </div>
              {canEdit && c.status !== "archived" && (
                <button onClick={() => newVersion(c)} style={{ width: "100%", marginTop: 6, background: C.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>↻ 結論變了 → 更新出新版本（舊版進歷史）</button>
              )}
              {hist.length > 0 && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>📜 歷史版本（{hist.length}）</div>
                  {hist.map(h => (
                    <div key={h.id} style={{ fontSize: 12.5, color: C.sub, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", marginBottom: 6 }}>
                      <span style={{ color: C.faint }}>{h.date}</span>　{h.conclusion}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
