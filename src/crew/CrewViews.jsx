// ── 夥伴中心（crew 空間）：知識庫/名冊/360互評/回饋/闖關/投票/商城/排行榜 ─────────
// 由 App.jsx 原樣搬出（2026-07-18 拆檔第一刀；行為/畫面零改變）。
import { useState, useEffect, useRef } from "react";
import { uploadPhoto, onSharedChange, supabase, getSharedPrefix } from "../supa.js";
import QRCode from "qrcode";
import { ACCENT, PRIMARY, SURFACE, BORDER, TEXT, SUB, MONO, DISP, useIsMobile } from "../lib/theme.jsx"; // 張良 2026-07-26 手機版全面體檢：引入 useIsMobile
import { K, auditLog } from "../lib/runtime.js";
import { ROSTER_KEY, loadRosterDoc, saveRosterDoc, saveRosterPatch } from "./roster.js";
import { compareDay, summarize, ATT_LABEL } from "../shift/attendance.js";
import { schedKey, mondayOf } from "../shift/model.js";
import { PAY_DEFAULTS, rulesAt, calcMonthPay, monthSummary } from "../shift/payroll.js";

// ── 夥伴中心：SOP知識庫（2026-07-18 雙維度改造）──────────────────────────────
// 舊的單一分類「內場/外場/通用/教育訓練」混了兩個維度（前三個是「誰的」、教育訓練是「什麼用途」）
// → 拆成 適用對象(aud) × 內容類型(dtype) 兩個正交維度；崗位（炸台/早爐…）走 tags，跟排班同一組詞。
const KB_AUDIENCES = ["內場", "外場", "管理", "全員"];       // 維度1：適用對象
const KB_TYPES = ["SOP", "工作標準", "教學", "表單", "制度"]; // 維度2：內容類型
// 舊文件自動歸類（讀到即套用、下次儲存寫回新欄位；不需一次性搬資料）：
// 內場/外場→照舊；通用/教育訓練/自訂→全員；教育訓練→類型=教學（教育訓練不是分類，是內容類型）
export const kbDims = (d) => ({
  aud: d.aud || (d.category === "內場" || d.category === "外場" ? d.category : "全員"),
  dtype: d.dtype || (d.category === "教育訓練" ? "教學" : "SOP"),
});
const kbIcon = (d) => d.kind === "link" ? "🔗" : d.kind === "text" ? "📝" : (d.isImage ? "🖼️" : (/\.pdf$/i.test(d.name || "") ? "📕" : /\.(xls|xlsx|csv)$/i.test(d.name || "") ? "📊" : "📄"));
export function KnowledgeBaseView({ canEdit, requireLogin, confirm, userName }) {
  const isMobile = useIsMobile(); // 張良 2026-07-26 手機版全面體檢：編輯彈窗三個下拉手機改直向堆疊
  const [docs, setDocs] = useState(null);
  const [q, setQ] = useState("");
  const [audFilter, setAudFilter] = useState("全部");
  const [typeFilter, setTypeFilter] = useState("全部");
  const [stations, setStations] = useState([]); // 崗位清單（跟排班同一份 shift_stations；點選不手打，避免「炸台/炸檯」兩套寫法）
  const [edit, setEdit] = useState(null); // 正在編輯/新增的 doc
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const safety = setTimeout(() => setDocs(prev => prev === null ? [] : prev), 8000);
    (async () => {
      try { const r = await window.storage.get(K("kb_docs"), true); setDocs(r && r.value ? JSON.parse(r.value) : []); }
      catch (_) { setDocs([]); }
      try { const s = await window.storage.get(K("shift_stations"), true); const d = s && s.value ? JSON.parse(s.value) : null; setStations([...new Set((d?.stations || []).map(x => x.name).filter(Boolean))]); } catch (_) {}
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);

  const persist = async (list) => { try { const p = docs || []; auditLog(list.length > p.length ? "新增" : list.length < p.length ? "刪除" : "編輯", "夥伴中心・知識庫文件"); } catch (_) {} setDocs(list); try { await window.storage.set(K("kb_docs"), JSON.stringify(list), true); } catch (_) {} };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };

  const blank = () => ({ id: "", aud: "全員", dtype: "SOP", title: "", kind: "link", url: "", name: "", content: "", tags: "", pinned: false });
  const openNew = () => { if (!guard()) return; setEdit(blank()); };
  const openEdit = (d) => { if (!guard()) return; setEdit({ ...d, ...kbDims(d), tags: (d.tags || []).join(", ") }); };
  const saveDoc = () => {
    const e = edit; if (!e.title.trim()) { alert("請填標題"); return; }
    // category 保留寫回（=適用對象；全員寫「通用」）給舊版畫面/D哥相容；新篩選只認 aud/dtype
    const doc = { id: e.id || "kb-" + Math.random().toString(36).slice(2, 8), aud: e.aud, dtype: e.dtype, category: e.aud === "全員" ? "通用" : e.aud, title: e.title.trim(), kind: e.kind, url: e.url || "", name: e.name || "", isImage: !!e.isImage, content: e.content || "", tags: (e.tags || "").split(/[,，]/).map(t => t.trim()).filter(Boolean), pinned: !!e.pinned, updatedBy: userName || "—", updatedAt: new Date().toISOString() };
    const list = e.id ? (docs || []).map(d => d.id === e.id ? doc : d) : [doc, ...(docs || [])];
    persist(list); setEdit(null);
  };
  const delDoc = async (d) => { if (!guard()) return; if (await confirm(`刪除「${d.title}」？`)) persist((docs || []).filter(x => x.id !== d.id)); };
  const togglePin = (d) => { if (!guard()) return; persist((docs || []).map(x => x.id === d.id ? { ...x, pinned: !x.pinned } : x)); };
  const uploadFile = async (files) => {
    const f = (files || [])[0]; if (!f) return;
    setBusy(true);
    try { const { url } = await uploadPhoto(f); setEdit(e => ({ ...e, kind: "file", url, name: f.name, isImage: !!(f.type || "").startsWith("image/") })); }
    catch (er) { alert("上傳失敗：" + (er?.message || er)); }
    setBusy(false);
  };

  const filtered = (docs || [])
    .filter(d => audFilter === "全部" || kbDims(d).aud === audFilter)
    .filter(d => typeFilter === "全部" || kbDims(d).dtype === typeFilter)
    .filter(d => { if (!q.trim()) return true; const s = (d.title + " " + (d.tags || []).join(" ") + " " + (d.content || "")).toLowerCase(); return s.includes(q.trim().toLowerCase()); })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  if (docs === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const inputS = { width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, outline: "none", background: "#fff", color: TEXT };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>📚 SOP知識庫</div>
        <div style={{ fontSize: 12.5, color: SUB }}>SOP・工作標準・教學・表單・制度（{docs.length}）</div>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 搜尋標題／標籤…" style={{ ...inputS, width: 220, maxWidth: "50vw" }} />
        {canEdit && <button onClick={openNew} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>＋ 新增</button>}
      </div>
      {/* 兩維度篩選：適用對象 × 內容類型（可疊加），同一份文件可同時標「內場＋SOP＋炸台」 */}
      {[["對象", KB_AUDIENCES, audFilter, setAudFilter], ["類型", KB_TYPES, typeFilter, setTypeFilter]].map(([lab, opts, cur, set]) => (
        <div key={lab} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, color: SUB, fontWeight: 600, width: 30 }}>{lab}</span>
          {["全部", ...opts].map(c => (
            <button key={c} onClick={() => set(c)} style={{ border: `1px solid ${cur === c ? PRIMARY : BORDER}`, background: cur === c ? PRIMARY : "transparent", color: cur === c ? "#fff" : TEXT, borderRadius: 16, padding: "4px 12px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>{c}</button>
          ))}
        </div>
      ))}
      <div style={{ marginBottom: 6 }} />
      {filtered.length === 0 && <div style={{ textAlign: "center", color: "#9b9384", padding: "50px 0", fontSize: 14 }}>{docs.length === 0 ? "還沒有資料，點「＋ 新增」開始建立。" : "沒有符合的資料。"}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {filtered.map(d => (
          <div key={d.id} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>{kbIcon(d)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: TEXT, wordBreak: "break-word" }}>{d.pinned && "📌 "}{d.title}</div>
                <div style={{ fontSize: 11, color: SUB, marginTop: 2, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ background: "#fbeee6", color: "#92400e", borderRadius: 8, padding: "1px 7px" }}>{kbDims(d).aud}</span>
                  <span style={{ background: "#ece4d6", color: "#4A4234", borderRadius: 8, padding: "1px 7px" }}>{kbDims(d).dtype}</span>
                  {d.tags?.length > 0 && <span>{d.tags.map(t => "#" + t).join(" ")}</span>}
                </div>
              </div>
            </div>
            {d.kind === "text" && d.content && <div style={{ fontSize: 13, color: "#4A4234", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 140, overflowY: "auto", background: "#FBF7EE", borderRadius: 8, padding: "8px 10px" }}>{d.content}</div>}
            {(d.kind === "link" || d.kind === "file") && d.url && <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#2E6FB0", textDecoration: "none", wordBreak: "break-all" }}>{d.kind === "file" ? `📎 ${d.name || "開啟檔案"}` : "🔗 開啟連結"}</a>}
            {canEdit && <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 12 }}>
              <button onClick={() => togglePin(d)} style={{ border: "none", background: "none", color: d.pinned ? ACCENT : SUB, cursor: "pointer", padding: 0 }}>{d.pinned ? "取消置頂" : "置頂"}</button>
              <button onClick={() => openEdit(d)} style={{ border: "none", background: "none", color: SUB, cursor: "pointer", padding: 0 }}>編輯</button>
              <button onClick={() => delDoc(d)} style={{ border: "none", background: "none", color: "#b3261e", cursor: "pointer", padding: 0 }}>刪除</button>
              <div style={{ flex: 1 }} /><span style={{ color: "#C8BCA0" }}>{d.updatedBy}</span>
            </div>}
          </div>
        ))}
      </div>

      {edit && (
        <div onClick={e => e.target === e.currentTarget && setEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 460, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 14 }}>{edit.id ? "編輯資料" : "新增資料"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>標題</div><input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} style={inputS} placeholder="例：外場點餐 SOP" /></div>
              {/* 張良 2026-07-26 手機版全面體檢：三個下拉手機直向堆疊（桌機維持並排） */}
              <div style={{ display: "flex", gap: 10, flexDirection: isMobile ? "column" : "row" }}>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>適用對象</div>
                  <select value={edit.aud} onChange={e => setEdit({ ...edit, aud: e.target.value })} style={inputS}>
                    {KB_AUDIENCES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>內容類型</div>
                  <select value={edit.dtype} onChange={e => setEdit({ ...edit, dtype: e.target.value })} style={inputS}>
                    {KB_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>形式</div>
                  <select value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })} style={inputS}>
                    <option value="link">🔗 連結</option><option value="file">📎 檔案</option><option value="text">📝 純文字</option>
                  </select>
                </div>
              </div>
              {edit.kind === "link" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>連結網址</div><input value={edit.url} onChange={e => setEdit({ ...edit, url: e.target.value })} style={inputS} placeholder="https://…" /></div>}
              {edit.kind === "file" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>檔案</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => fileRef.current?.click()} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>{busy ? "上傳中…" : "選擇檔案"}</button>
                  {edit.name && <span style={{ fontSize: 12, color: TEXT }}>📎 {edit.name}</span>}
                  <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => { uploadFile(e.target.files); e.target.value = ""; }} />
                </div></div>}
              {edit.kind === "text" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>內容</div><textarea value={edit.content} onChange={e => setEdit({ ...edit, content: e.target.value })} style={{ ...inputS, height: 140, resize: "vertical", fontFamily: "inherit" }} placeholder="直接輸入內容…" /></div>}
              <div>
                <div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>適用崗位（點選，跟排班同一份清單）</div>
                {stations.length > 0 ? (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {stations.map(s => { const cur = (edit.tags || "").split(/[,，]/).map(t => t.trim()).filter(Boolean); const on = cur.includes(s); return (
                      <button key={s} onClick={() => setEdit({ ...edit, tags: (on ? cur.filter(t => t !== s) : [...cur, s]).join(", ") })} style={{ border: `1px solid ${on ? ACCENT : BORDER}`, background: on ? ACCENT : "#fff", color: on ? "#fff" : TEXT, borderRadius: 14, padding: "4px 12px", fontSize: 12.5, cursor: "pointer" }}>{s}</button>
                    ); })}
                  </div>
                ) : <div style={{ fontSize: 11.5, color: "#9b9384", marginBottom: 8 }}>（排班的崗位清單建立後，這裡會出現可點選的崗位）</div>}
                <div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>其他標籤（逗號分隔）</div>
                <input value={edit.tags} onChange={e => setEdit({ ...edit, tags: e.target.value })} style={inputS} placeholder="例：新人必讀" />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: TEXT, cursor: "pointer" }}><input type="checkbox" checked={edit.pinned} onChange={e => setEdit({ ...edit, pinned: e.target.checked })} />📌 置頂</label>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setEdit(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={saveDoc} disabled={busy} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 夥伴中心：360 評鑑（設計原型；正式版接 Auth+正規表+權限/匿名）─────────────────
const R360_DEFAULT_DIMS = ["工作態度", "團隊合作", "專業技能", "服務品質", "責任感", "學習成長"];
export function Review360View({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const isMobile = useIsMobile(); // 張良 2026-07-26 手機版全面體檢：setup 人員編輯列手機改網格排版
  const [data, setData] = useState(null);     // {dimensions, reviews}（kb_360；名冊已分家獨立存）
  const [people, setPeople] = useState([]);   // 名冊人員（kb_roster，唯一真相）
  const [tab, setTab] = useState("fill"); // fill | result | setup
  const [me, setMe] = useState("");
  const [rate, setRate] = useState(null); // 正在評的對象 {revieweeId, scores, comment}
  const [resultId, setResultId] = useState("");
  useMeSync(people, userName, setMe);

  useEffect(() => {
    const safety = setTimeout(() => setData(prev => prev || emptyR360()), 8000);
    (async () => {
      try {
        const [ros, r] = await Promise.all([loadRosterDoc(), window.storage.get(K("kb_360"), true)]);
        const d = r && r.value ? JSON.parse(r.value) : null;
        setData(normR360(d)); setPeople(ros.people); setMe(meFromRoster(ros.people, userName));
      }
      catch (_) { setData(emptyR360()); }
    })().finally(() => clearTimeout(safety));
    // 即時同步：別台改了評鑑/名冊 → 這裡畫面跟著更新
    const un1 = onSharedChange(K("kb_360"), (_k, v) => { try { setData(normR360(v ? JSON.parse(v) : null)); } catch (_) {} });
    const un2 = onSharedChange(K(ROSTER_KEY), (_k, v) => { try { const p = v ? (JSON.parse(v).people || []) : []; setPeople(p); setMe(m => m || meFromRoster(p, userName)); } catch (_) {} });
    return () => { clearTimeout(safety); un1(); un2(); };
  }, []);
  function emptyR360() { return { dimensions: R360_DEFAULT_DIMS.map((l, i) => ({ id: "d" + i, label: l })), reviews: [] }; }
  function normR360(d) { if (!d) return emptyR360(); return { dimensions: d.dimensions?.length ? d.dimensions : emptyR360().dimensions, reviews: d.reviews || [] }; }
  const persist = async (next) => { try { auditLog("編輯", "夥伴中心・360 互評"); } catch (_) {} setData(next); try { await window.storage.set(K("kb_360"), JSON.stringify({ dimensions: next.dimensions, reviews: next.reviews }), true); } catch (_) {} };
  const persistPeople = (nextPeople) => { setPeople(nextPeople); saveRosterPatch({ people: nextPeople }); }; // 只動 people；fields 由名冊頁管理
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };

  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const { dimensions, reviews } = data;
  const nameOf = (id) => people.find(p => p.id === id)?.name || "—";

  // 儲存一筆評鑑（同一人評同一人＝覆蓋）
  const submitRate = () => {
    if (!me) { alert("請先在上方選「我是誰」"); return; }
    const r = rate;
    const review = { id: "rv-" + me + "-" + r.revieweeId, reviewerId: me, revieweeId: r.revieweeId, scores: r.scores, comment: (r.comment || "").trim(), ts: new Date().toISOString() };
    const others = reviews.filter(x => !(x.reviewerId === me && x.revieweeId === r.revieweeId));
    persist({ ...data, reviews: [...others, review] });
    setRate(null);
  };
  const myReviewOf = (revId) => reviews.find(x => x.reviewerId === me && x.revieweeId === revId);

  // 結果彙整
  const agg = (revieweeId) => {
    const others = reviews.filter(x => x.revieweeId === revieweeId && x.reviewerId !== revieweeId);
    const self = reviews.find(x => x.reviewerId === revieweeId && x.revieweeId === revieweeId);
    const perDim = dimensions.map(dim => {
      const vals = others.map(r => Number(r.scores?.[dim.id])).filter(v => v > 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return { dim, avg, selfV: self ? Number(self.scores?.[dim.id]) || null : null, n: vals.length };
    });
    const allVals = others.flatMap(r => dimensions.map(d => Number(r.scores?.[d.id])).filter(v => v > 0));
    const overall = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : null;
    const comments = others.map(r => r.comment).filter(Boolean);
    return { perDim, overall, comments, count: others.length, hasSelf: !!self };
  };

  const card = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
  const subTab = (t, label) => <button key={t} onClick={() => setTab(t)} style={{ border: `1px solid ${tab === t ? PRIMARY : BORDER}`, background: tab === t ? PRIMARY : "transparent", color: tab === t ? "#fff" : TEXT, borderRadius: 8, padding: "7px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{label}</button>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>⭐ 360 評鑑</div>
        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>這是預覽版：用下方「我是誰」模擬身分、資料先存本機。正式版會接真帳號＋權限＋匿名保護。</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {subTab("fill", "📝 我要評")}{subTab("result", "📊 看結果")}{isAdmin && subTab("setup", "⚙ 設定")}
      </div>

      {tab === "fill" && (<>
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <CrewMe people={people} me={me} />
          {people.length === 0 && <span style={{ fontSize: 12, color: "#C2872E" }}>請先到「設定」加入夥伴名單</span>}
        </div>
        {me && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {people.map(p => { const done = !!myReviewOf(p.id); const isSelf = p.id === me; return (
            <button key={p.id} onClick={() => setRate({ revieweeId: p.id, scores: myReviewOf(p.id)?.scores || {}, comment: myReviewOf(p.id)?.comment || "" })}
              style={{ textAlign: "left", background: "#fff", border: `1px solid ${done ? "#3C8C3C" : BORDER}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#fbeee6", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{p.name?.[0] || "?"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{p.name}{isSelf && <span style={{ fontSize: 11, color: SUB }}> · 自評</span>}</div>
                <div style={{ fontSize: 11, color: SUB }}>{p.dept || "—"}</div>
              </div>
              <span style={{ fontSize: 12, color: done ? "#3C8C3C" : "#C8BCA0", fontWeight: 600 }}>{done ? "✓ 已評" : "待評"}</span>
            </button>
          ); })}
        </div>}
      </>)}

      {tab === "result" && (<>
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: SUB }}>看誰的結果：</span>
          <select value={resultId} onChange={e => setResultId(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px", fontSize: 14, background: "#fff", color: TEXT, minWidth: 140 }}>
            <option value="">— 選擇夥伴 —</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {resultId && (() => { const a = agg(resultId); return (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{nameOf(resultId)}</div>
              <div style={{ fontSize: 13, color: SUB }}>他評 {a.count} 人{a.hasSelf ? " · 含自評" : ""}</div>
              <div style={{ flex: 1 }} />
              {a.overall != null && <div style={{ fontSize: 22, fontWeight: 800, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{a.overall.toFixed(1)}<span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}> /5</span></div>}
            </div>
            {a.count === 0 && <div style={{ fontSize: 13, color: "#9b9384", padding: "10px 0" }}>還沒有人評過這位夥伴。</div>}
            {a.perDim.map(({ dim, avg, selfV, n }) => (
              <div key={dim.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", fontSize: 13, marginBottom: 4 }}><span style={{ color: TEXT, fontWeight: 600 }}>{dim.label}</span><div style={{ flex: 1 }} /><span style={{ color: ACCENT, fontFamily: "monospace", fontWeight: 700 }}>{avg != null ? avg.toFixed(1) : "—"}</span>{selfV != null && <span style={{ color: "#2E6FB0", marginLeft: 8, fontSize: 12 }}>自評 {selfV}</span>}</div>
                <div style={{ position: "relative", height: 8, background: "#e6ddc9", borderRadius: 4 }}>
                  <div style={{ width: `${(avg || 0) / 5 * 100}%`, height: "100%", background: ACCENT, borderRadius: 4, transition: "width .2s" }} />
                  {selfV != null && <div title="自評" style={{ position: "absolute", top: -2, left: `calc(${selfV / 5 * 100}% - 1px)`, width: 2, height: 12, background: "#2E6FB0" }} />}
                </div>
              </div>
            ))}
            {a.comments.length > 0 && <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8 }}>💬 匿名評語</div>
              {a.comments.map((c, i) => <div key={i} style={{ fontSize: 13, color: "#4A4234", background: "#FBF7EE", borderRadius: 8, padding: "8px 12px", marginBottom: 6, whiteSpace: "pre-wrap" }}>{c}</div>)}
            </div>}
            <div style={{ fontSize: 11, color: "#9b9384", marginTop: 12 }}>※ 正式版：評語匿名、評鑑者身分隱藏；少於設定人數不顯示結果以保護匿名。</div>
          </div>
        ); })()}
      </>)}

      {tab === "setup" && isAdmin && (<>
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 10 }}>評分面向</div>
          {dimensions.map(d => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <input value={d.label} onChange={e => persist({ ...data, dimensions: dimensions.map(x => x.id === d.id ? { ...x, label: e.target.value } : x) })} style={{ flex: 1, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "#fff", color: TEXT }} />
              <button onClick={() => { if (!guard()) return; persist({ ...data, dimensions: dimensions.filter(x => x.id !== d.id) }); }} style={{ border: "none", background: "none", color: "#b3261e", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          ))}
          <button onClick={() => { if (!guard()) return; persist({ ...data, dimensions: [...dimensions, { id: "d" + Date.now(), label: "新面向" }] }); }} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer", marginTop: 4 }}>＋ 新增面向</button>
        </div>
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 10 }}>夥伴名單（{people.length}）</div>
          {/* 張良 2026-07-26 手機版全面體檢：欄頭列手機隱藏（各輸入框有 placeholder），編輯列手機改兩欄網格不溢出 */}
          {!isMobile && <div style={{ display: "flex", gap: 8, fontSize: 10, color: SUB, marginBottom: 4, padding: "0 2px" }}><span style={{ flex: 1 }}>姓名</span><span style={{ width: 80 }}>部門</span><span style={{ width: 90 }}>層級</span><span style={{ width: 110 }}>登入帳號</span><span style={{ width: 20 }} /></div>}
          {people.map(p => { const up = (k, v) => persistPeople(people.map(x => x.id === p.id ? { ...x, [k]: v } : x)); return (
            <div key={p.id} style={isMobile
              ? { display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 6, alignItems: "center", marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #f0ead9" }
              : { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <input value={p.name} onChange={e => up("name", e.target.value)} placeholder="姓名" style={{ ...(isMobile ? { gridColumn: "1 / 3", gridRow: 1, width: "100%", boxSizing: "border-box" } : { flex: 1, minWidth: 90 }), border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "#fff", color: TEXT }} />
              <input value={p.dept || ""} onChange={e => up("dept", e.target.value)} placeholder="部門" style={{ ...(isMobile ? { gridColumn: 1, gridRow: 2, width: "100%", boxSizing: "border-box" } : { width: 80 }), border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, background: "#fff", color: TEXT }} />
              <select value={p.role || "staff"} onChange={e => up("role", e.target.value)} title="層級＝權限：主管/管理員可管理" style={{ ...(isMobile ? { gridColumn: 2, gridRow: 2, width: "100%", boxSizing: "border-box" } : { width: 90 }), border: `1px solid ${canManageRole(p.role) ? "#C2872E" : BORDER}`, borderRadius: 8, padding: "6px 6px", fontSize: 13, background: "#fff", color: TEXT }}>{CREW_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input value={p.account || ""} onChange={e => up("account", e.target.value)} placeholder="登入帳號" title="對應登入身分（例：goodmask77）" style={{ ...(isMobile ? { gridColumn: "1 / 3", gridRow: 3, width: "100%", boxSizing: "border-box" } : { width: 110 }), border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, background: "#fff", color: TEXT }} />
              <button onClick={() => { if (!guard()) return; confirm(`移除「${p.name}」？`).then(ok => ok && persistPeople(people.filter(x => x.id !== p.id))); }} style={{ ...(isMobile ? { gridColumn: 3, gridRow: 1 } : {}), border: "none", background: "none", color: "#b3261e", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          ); })}
          <button onClick={() => { if (!guard()) return; persistPeople([...people, { id: "p" + Date.now(), name: "", dept: "", role: "staff", account: "" }]); }} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer", marginTop: 4 }}>＋ 新增夥伴</button>
          <div style={{ fontSize: 11, color: "#9b9384", marginTop: 8 }}>※ 層級＝權限：主管/管理員可新增關卡、發起投票、上架獎勵。登入帳號＝這個人登入後自動對應的身分（正式版接 Auth 後就不用選身分了）。</div>
        </div>
      </>)}

      {/* 評分彈窗 */}
      {rate && (() => { const p = people.find(x => x.id === rate.revieweeId); return (
        <div onClick={e => e.target === e.currentTarget && setRate(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 2 }}>評鑑：{p?.name}{p?.id === me ? "（自評）" : ""}</div>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>每個面向給 1–5 分</div>
            {dimensions.map(dim => (
              <div key={dim.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>{dim.label}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 2, 3, 4, 5].map(n => { const on = rate.scores[dim.id] === n; return (
                    <button key={n} onClick={() => setRate({ ...rate, scores: { ...rate.scores, [dim.id]: n } })} style={{ flex: 1, height: 38, borderRadius: 8, border: `1px solid ${on ? ACCENT : BORDER}`, background: on ? ACCENT : "#fff", color: on ? "#fff" : TEXT, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{n}</button>
                  ); })}
                </div>
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>評語（可留空）</div>
              <textarea value={rate.comment} onChange={e => setRate({ ...rate, comment: e.target.value })} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 9, fontSize: 14, height: 80, resize: "vertical", outline: "none", fontFamily: "inherit" }} placeholder="具體的觀察與建議…" />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setRate(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={submitRate} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>送出評鑑</button>
            </div>
          </div>
        </div>
      ); })()}
    </div>
  );
}

// ── 夥伴中心：回饋制度 + 積分 + 排行榜（設計原型）─────────────────────────────
const FB_POS_TAGS = ["服務暖心", "救火英雄", "執行力強", "細心可靠", "思慮周全", "帶人有耐心", "正能量", "神隊友", "出餐快又準", "臨危不亂"];
const FB_CON_TAGS = ["可多主動溝通", "記得多確認細節", "建議提早備料", "開會多分享想法"];
// 積分：給回饋+2、收到回饋+1、你給的回饋被按「幫到我」+5
function crewPointStats(items, people) {
  const m = {};
  people.forEach(p => { m[p.id] = { id: p.id, name: p.name, dept: p.dept, given: 0, received: 0, helpfulGot: 0, points: 0 }; });
  items.forEach(it => {
    if (m[it.fromId]) { m[it.fromId].given++; m[it.fromId].helpfulGot += (it.helpful?.length || 0); }
    if (m[it.toId]) m[it.toId].received++;
  });
  Object.values(m).forEach(s => { s.points = s.given * 2 + s.received * 1 + s.helpfulGot * 5; });
  return m;
}
async function loadCrewRoster() {
  try { return (await loadRosterDoc()).people || []; } catch (_) { return []; }
}

export function FeedbackView({ canEdit, requireLogin, isAdmin, userName }) {
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState(null);
  const [me, setMe] = useState("");
  const [tab, setTab] = useState("give");
  const [draft, setDraft] = useState({ toId: "", tags: [], text: "", anon: false });
  const [wallFilter, setWallFilter] = useState("all"); // all | tome | byme
  const [exclusions, setExclusions] = useState([]); // 迴避配對 [[idA,idB],...]（立場衝突者互不回饋）
  const [exDraft, setExDraft] = useState({ a: "", b: "" });
  useMeSync(people, userName, setMe);

  useEffect(() => {
    const safety = setTimeout(() => setItems(prev => prev || []), 8000);
    (async () => {
      const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName));
      try { const rr = await window.storage.get(K("kb_feedback"), true); const parsed = rr && rr.value ? JSON.parse(rr.value) : {}; setItems(parsed.items || []); setExclusions(parsed.exclusions || []); } catch (_) { setItems([]); }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);
  const persist = async (list) => { try { const p = items || []; auditLog(list.length > p.length ? "新增" : list.length < p.length ? "刪除" : "編輯", "夥伴中心・意見回饋"); } catch (_) {} setItems(list); try { await window.storage.set(K("kb_feedback"), JSON.stringify({ items: list, exclusions }), true); } catch (_) {} };
  const persistEx = async (next) => { setExclusions(next); try { auditLog("編輯", "夥伴中心・回饋迴避設定"); } catch (_) {} try { await window.storage.set(K("kb_feedback"), JSON.stringify({ items: items || [], exclusions: next }), true); } catch (_) {} };
  const isExcluded = (a, b) => exclusions.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const nameOf = (id) => people.find(p => p.id === id)?.name || "—";
  if (items === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;

  const toggleTag = (t) => setDraft(d => ({ ...d, tags: d.tags.includes(t) ? d.tags.filter(x => x !== t) : [...d.tags, t] }));
  const submit = () => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    if (!me) { alert("請先選「我是誰」"); return; }
    if (!draft.toId) { alert("請選回饋對象"); return; }
    if (!draft.tags.length && !draft.text.trim()) { alert("至少選一個標籤或寫幾個字"); return; }
    const it = { id: "fb-" + Math.random().toString(36).slice(2, 8), fromId: me, toId: draft.toId, tags: draft.tags, text: draft.text.trim(), anon: draft.anon, ts: new Date().toISOString(), helpful: [] };
    persist([it, ...items]);
    setDraft({ toId: "", tags: [], text: "", anon: false });
    setTab("wall");
  };
  const toggleHelpful = (it) => {
    if (!me) { alert("請先選「我是誰」才能標記"); return; }
    const has = (it.helpful || []).includes(me);
    persist(items.map(x => x.id === it.id ? { ...x, helpful: has ? x.helpful.filter(h => h !== me) : [...(x.helpful || []), me] } : x));
  };

  const meSelect = <CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} />;
  const card = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
  const subTab = (t, l) => <button key={t} onClick={() => setTab(t)} style={{ border: `1px solid ${tab === t ? PRIMARY : BORDER}`, background: tab === t ? PRIMARY : "transparent", color: tab === t ? "#fff" : TEXT, borderRadius: 8, padding: "7px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{l}</button>;
  const tagChip = (t, on, onClick) => <button key={t} onClick={onClick} style={{ border: `1px solid ${on ? ACCENT : BORDER}`, background: on ? ACCENT : "#fff", color: on ? "#fff" : TEXT, borderRadius: 16, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>{t}</button>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>💬 回饋</div>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>讓正向、有建設性的回饋變習慣——給回饋得分、被按「幫到我」更高分，累積成回饋王。</div>
      {/* 週期性觸發：本週（週一起算）還沒給過回饋 → 提示（搭配每週五 LINE 提醒） */}
      {me && (() => { const now = new Date(); const monday = new Date(now); monday.setHours(0,0,0,0); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); const given = (items || []).some(it => it.fromId === me && new Date(it.ts) >= monday); if (given) return null; return (
        <div style={{ background: "#FFF7ED", border: "1.5px solid #c98a14", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#7a5410", fontWeight: 600 }}>⏰ 你本週還沒給出回饋——花 30 秒鼓勵一位夥伴，讓好表現被看見。</span>
          <div style={{ flex: 1 }} />
          {tab !== "give" && <button onClick={() => setTab("give")} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>去給回饋 ＋2分</button>}
        </div>
      ); })()}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>{subTab("give", "✍ 給回饋")}{subTab("wall", "🧱 回饋牆")}</div>

      {tab === "give" && (
        <div style={card}>
          <div style={{ marginBottom: 12 }}>{meSelect}</div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 4 }}>給誰</div>
          <select value={draft.toId} onChange={e => setDraft({ ...draft, toId: e.target.value })} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, background: "#fff", color: TEXT, marginBottom: 12 }}>
            <option value="">— 選擇夥伴 —</option>
            {people.filter(p => p.id !== me && !isExcluded(me, p.id)).map(p => <option key={p.id} value={p.id}>{p.name}{p.nick ? `（${p.nick}）` : (p.dept ? `（${p.dept}）` : "")}</option>)}
          </select>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 6 }}>👍 正向標籤</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{FB_POS_TAGS.map(t => tagChip(t, draft.tags.includes(t), () => toggleTag(t)))}</div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 6 }}>💡 建設性建議</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{FB_CON_TAGS.map(t => tagChip(t, draft.tags.includes(t), () => toggleTag(t)))}</div>
          <textarea value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder="具體說說（可留空，例：那天尖峰你主動幫忙收尾，真的很救火）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 9, fontSize: 14, height: 70, resize: "vertical", outline: "none", fontFamily: "inherit", marginBottom: 10 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: TEXT, cursor: "pointer" }}><input type="checkbox" checked={draft.anon} onChange={e => setDraft({ ...draft, anon: e.target.checked })} />匿名給</label>
            <div style={{ flex: 1 }} />
            <button onClick={submit} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "9px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>送出回饋 ＋2分</button>
          </div>
          {isAdmin && (
            <div style={{ marginTop: 16, borderTop: `1px dashed ${BORDER}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 4 }}>⚖ 迴避設定（管理員）</div>
              <div style={{ fontSize: 11.5, color: SUB, marginBottom: 8 }}>立場衝突的兩人（例如主管×直屬、有心結）互相不會出現在對方的回饋名單。</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                {[["a"], ["b"]].map(([k], i) => (
                  <select key={k} value={exDraft[k]} onChange={e => setExDraft(d => ({ ...d, [k]: e.target.value }))} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 9px", fontSize: 13, background: "#fff", color: TEXT }}>
                    <option value="">{i === 0 ? "— 甲 —" : "— 乙 —"}</option>
                    {people.map(pp => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                  </select>
                ))}
                <button onClick={() => { if (!exDraft.a || !exDraft.b || exDraft.a === exDraft.b || isExcluded(exDraft.a, exDraft.b)) return; persistEx([...exclusions, [exDraft.a, exDraft.b]]); setExDraft({ a: "", b: "" }); }} style={{ border: `1.5px solid ${ACCENT}`, background: "#fff", color: ACCENT, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>＋ 新增迴避</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {exclusions.length === 0 && <span style={{ fontSize: 12, color: "#9b9384" }}>目前沒有迴避配對</span>}
                {exclusions.map(([a, b], i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, background: "#ece4d6", border: `1px solid ${BORDER}`, borderRadius: 14, padding: "3px 10px" }}>
                    {nameOf(a)} ✕ {nameOf(b)}
                    <button onClick={() => persistEx(exclusions.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "#9b9384", cursor: "pointer", padding: 0, fontSize: 13 }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "wall" && (<>
        <div style={{ ...card, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {meSelect}
          {me && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["all", "全部"], ["tome", `給我的${items.filter(x => x.toId === me).length ? "·" + items.filter(x => x.toId === me).length : ""}`], ["byme", "我給的"]].map(([k, l]) =>
              <button key={k} onClick={() => setWallFilter(k)} style={{ border: `1px solid ${wallFilter === k ? PRIMARY : BORDER}`, background: wallFilter === k ? PRIMARY : "transparent", color: wallFilter === k ? "#fff" : TEXT, borderRadius: 14, padding: "4px 12px", fontSize: 12.5, cursor: "pointer" }}>{l}</button>)}
          </div>}
        </div>
        {me && wallFilter === "tome" && <div style={{ fontSize: 12, color: SUB, margin: "-4px 2px 10px" }}>👇 別人給你的回饋，覺得有幫助就按「幫到我」，給予者會加分。</div>}
        {(() => { const list = items.filter(it => wallFilter === "all" || !me ? true : wallFilter === "tome" ? it.toId === me : it.fromId === me); return (<>
        {list.length === 0 && <div style={{ textAlign: "center", color: "#9b9384", padding: "40px 0", fontSize: 14 }}>{items.length === 0 ? "還沒有回饋，去「給回饋」開始吧。" : "這個篩選沒有回饋。"}</div>}
        {list.map(it => { const helped = (it.helpful || []).includes(me); const mine = it.toId === me; return (
          <div key={it.id} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: TEXT }}>{it.anon ? "匿名夥伴" : nameOf(it.fromId)}</span>
              <span style={{ color: SUB }}>→</span>
              <span style={{ fontWeight: 600, color: ACCENT }}>{nameOf(it.toId)}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "#C8BCA0" }}>{new Date(it.ts).toLocaleDateString("zh-TW")}</span>
            </div>
            {it.tags?.length > 0 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: it.text ? 8 : 0 }}>{it.tags.map(t => <span key={t} style={{ fontSize: 12, background: FB_CON_TAGS.includes(t) ? "#FFF7ED" : "#F0FDF4", color: FB_CON_TAGS.includes(t) ? "#9A5B12" : "#2E7D32", border: `1px solid ${FB_CON_TAGS.includes(t) ? "#FDE6C8" : "#C8E6C9"}`, borderRadius: 12, padding: "2px 9px" }}>{t}</span>)}</div>}
            {it.text && <div style={{ fontSize: 14, color: "#4A4234", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{it.text}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <button onClick={() => toggleHelpful(it)} disabled={!mine} title={mine ? "" : "只有收到回饋的本人能標記（選對應的『我是誰』）"} style={{ border: `1px solid ${helped ? "#3C8C3C" : BORDER}`, background: helped ? "#F0FDF4" : "#fff", color: helped ? "#3C8C3C" : (mine ? TEXT : "#C8BCA0"), borderRadius: 16, padding: "4px 12px", fontSize: 12.5, fontWeight: 600, cursor: mine ? "pointer" : "default" }}>👍 幫到我{(it.helpful?.length || 0) > 0 ? ` · ${it.helpful.length}` : ""}</button>
              {(it.helpful?.length || 0) > 0 && <span style={{ fontSize: 11, color: "#3C8C3C" }}>給予者 +{it.helpful.length * 5} 分</span>}
            </div>
          </div>
        ); })}
        </>); })()}
      </>)}
    </div>
  );
}

// 夥伴中心共用：讀寫 + 完整積分餘額（回饋 + 闖關 − 兌換）
const loadCrewJSON = async (key, def) => { try { const r = await window.storage.get(K(key), true); return r && r.value ? JSON.parse(r.value) : def; } catch (_) { return def; } };
const CREW_LABELS = { kb_quests: "夥伴中心・闖關任務", kb_polls: "夥伴中心・投票", kb_shop: "夥伴中心・獎勵商店", kb_feedback: "夥伴中心・意見回饋", kb_360: "夥伴中心・360 互評", kb_docs: "夥伴中心・知識庫" };
const saveCrewJSON = async (key, val) => { try { auditLog("編輯", CREW_LABELS[key] || ("夥伴中心・" + key)); } catch (_) {} try { await window.storage.set(K(key), JSON.stringify(val), true); } catch (_) {} };
function crewFullBalance(people, fbItems, questsData, shopData) {
  const fb = crewPointStats(fbItems, people); const m = {};
  people.forEach(p => { m[p.id] = fb[p.id]?.points || 0; });
  (questsData?.progress || []).forEach(pr => { if (pr.status === "completed") { const q = (questsData.quests || []).find(x => x.id === pr.questId); if (q && m[pr.userId] != null) m[pr.userId] += (q.points || 0); } });
  (shopData?.redemptions || []).forEach(rd => { if (rd.status !== "rejected" && m[rd.userId] != null) m[rd.userId] -= (rd.cost || 0); });
  return m;
}
// 夥伴中心層級／權限
const CREW_ROLES = [["staff", "基層"], ["lead", "組長"], ["manager", "主管"], ["admin", "管理員"]];
const roleLabel = (r) => (CREW_ROLES.find(x => x[0] === r) || ["staff", "基層"])[1];
const canManageRole = (r) => r === "manager" || r === "admin";
const meFromRoster = (people, userName) => (people.find(p => p.account && p.account === userName) || {}).id || "";
// 修（張良 2026-07-22 回報「有時顯示尚未綁定」）：登入身分(profile)常比頁面晚載入，
// 掛載當下 userName 還是 null → me 算成空且不再重算。這個 hook 在 userName/名冊就緒後補綁一次。
const useMeSync = (people, userName, setMe) => { useEffect(() => { if (userName && people.length) setMe(m => m || meFromRoster(people, userName)); }, [userName, people]); };
// 目前身分＝登入帳號對應的人（固定、不可切換，避免冒名頂替）
const CrewMe = ({ people, me }) => {
  const cur = people.find(p => p.id === me);
  if (!cur) return <div style={{ fontSize: 12.5, color: "#C2872E" }}>⚠ 你的登入帳號尚未綁定夥伴身分——用 LINE 對 DD 說「你的本名＋報到」即可綁定；或請管理員在名冊把你的「App帳號」欄填上登入名稱。</div>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: SUB }}>身分</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{cur.name}{cur.dept ? `（${cur.dept}）` : ""}</span>
      <span style={{ fontSize: 11, background: canManageRole(cur.role) ? "#FEF3C7" : "#e6ddc9", color: canManageRole(cur.role) ? "#92400e" : SUB, borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>{roleLabel(cur.role)}</span>
    </div>
  );
};
const crewCard = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const crewProtoTitle = (emoji, t, sub) => (<><div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}><div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>{emoji} {t}</div><span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span></div>{sub && <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>{sub}</div>}</>);

// ── 闖關任務 ─────────────────────────────────────────────────────────────────
export function QuestView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [data, setData] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  useMeSync(people, userName, setMe);
  useEffect(() => { const s = setTimeout(() => setData(p => p || { quests: [], progress: [] }), 8000);
    (async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); setData(await loadCrewJSON("kb_quests", { quests: [], progress: [] })); })().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setData(n); saveCrewJSON("kb_quests", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const done = (qid) => (data.progress || []).some(p => p.questId === qid && p.userId === me && p.status === "completed");
  const countDone = (qid) => (data.progress || []).filter(p => p.questId === qid && p.status === "completed").length;
  const complete = (q) => { if (!me) { alert("尚未對應到名單身分"); return; } if (done(q.id)) return; persist({ ...data, progress: [...(data.progress || []), { questId: q.id, userId: me, status: "completed", ts: new Date().toISOString() }] }); };
  const saveQuest = () => { if (!ed.title.trim()) { alert("請填關卡名稱"); return; } const q = { id: ed.id || "q-" + Math.random().toString(36).slice(2, 7), title: ed.title.trim(), desc: ed.desc || "", points: Number(ed.points) || 0, active: ed.active !== false }; persist({ ...data, quests: ed.id ? data.quests.map(x => x.id === ed.id ? q : x) : [...data.quests, q] }); setEd(null); };
  return (
    <div>
      {crewProtoTitle("🎮", "闖關任務", "完成關卡得積分（正式版完成需組長核可、防自核）。")}
      <div style={{ ...crewCard, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} /><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ title: "", desc: "", points: 50, active: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增關卡</button>}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {data.quests.filter(q => q.active !== false || canManage).map(q => { const d = done(q.id); return (
          <div key={q.id} style={{ ...crewCard, marginBottom: 0, opacity: q.active === false ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><span style={{ fontSize: 22 }}>{d ? "✅" : "🎯"}</span><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{q.title}</div><div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{q.desc}</div></div><span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, whiteSpace: "nowrap" }}>+{q.points}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: SUB }}>已完成 {countDone(q.id)} 人</span><div style={{ flex: 1 }} />
              {canManage && <button onClick={() => guard() && setEd({ ...q })} style={{ border: "none", background: "none", color: SUB, fontSize: 12, cursor: "pointer" }}>編輯</button>}
              <button onClick={() => complete(q)} disabled={d} style={{ border: `1px solid ${d ? "#3C8C3C" : ACCENT}`, background: d ? "#F0FDF4" : ACCENT, color: d ? "#3C8C3C" : "#fff", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: d ? "default" : "pointer" }}>{d ? "✓ 已完成" : "完成挑戰"}</button>
            </div>
          </div>); })}
        {data.quests.length === 0 && <div style={{ color: "#9b9384", fontSize: 14, padding: "30px 0" }}>還沒有關卡{isAdmin ? "，點「＋ 新增關卡」" : ""}。</div>}
      </div>
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{ed.id ? "編輯關卡" : "新增關卡"}</div>
            <input value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="關卡名稱（例：完成新人訓練）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 8 }} />
            <textarea value={ed.desc} onChange={e => setEd({ ...ed, desc: e.target.value })} placeholder="說明" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, height: 60, resize: "vertical", marginBottom: 8, fontFamily: "inherit" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><span style={{ fontSize: 13, color: SUB }}>積分</span><input type="number" value={ed.points || ""} onChange={e => setEd({ ...ed, points: e.target.value })} style={{ width: 90, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /><label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={ed.active !== false} onChange={e => setEd({ ...ed, active: e.target.checked })} />啟用</label></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={saveQuest} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 投票（含各項投票王）──────────────────────────────────────────────────────
export function PollView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [data, setData] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  useMeSync(people, userName, setMe);
  useEffect(() => { const s = setTimeout(() => setData(p => p || { polls: [], votes: [] }), 8000);
    (async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); setData(await loadCrewJSON("kb_polls", { polls: [], votes: [] })); })().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setData(n); saveCrewJSON("kb_polls", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const nameOf = (id) => people.find(p => p.id === id)?.name || "（查無此人）"; // 防呆：名冊查無id不再裸露內部代號
  const myVote = (pid) => (data.votes || []).find(v => v.pollId === pid && v.voterId === me);
  const vote = (poll, optId) => { if (!me) { alert("尚未對應到名單身分"); return; } if (myVote(poll.id)) return; persist({ ...data, votes: [...(data.votes || []), { pollId: poll.id, voterId: me, choiceId: optId, ts: new Date().toISOString() }] }); };
  const tally = (poll) => { const c = {}; poll.options.forEach(o => c[o.id] = 0); (data.votes || []).filter(v => v.pollId === poll.id).forEach(v => { if (c[v.choiceId] != null) c[v.choiceId]++; }); const total = Object.values(c).reduce((a, b) => a + b, 0); const win = poll.options.slice().sort((a, b) => c[b.id] - c[a.id])[0]; return { c, total, win: total > 0 ? win : null }; };
  const savePoll = () => { if (!ed.title.trim()) { alert("請填主題"); return; } let opts = ed.usePeople ? people.map(p => ({ id: p.id, label: p.name })) : (ed.optText || "").split("\n").map(s => s.trim()).filter(Boolean).map((l, i) => ({ id: "o" + i, label: l })); if (opts.length < 2) { alert("至少要 2 個選項"); return; } const poll = { id: ed.id || "poll-" + Math.random().toString(36).slice(2, 7), title: ed.title.trim(), options: opts, anon: !!ed.anon, peoplePoll: !!ed.usePeople }; persist({ ...data, polls: ed.id ? data.polls.map(x => x.id === ed.id ? poll : x) : [...data.polls, poll] }); setEd(null); };
  const optLabel = (poll, oid) => poll.peoplePoll ? nameOf(oid) : (poll.options.find(o => o.id === oid)?.label || oid);
  return (
    <div>
      {crewProtoTitle("🗳", "投票", "一人一票（防灌票）；人物類投票會選出「投票王」。")}
      <div style={{ ...crewCard, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} /><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ title: "", optText: "", usePeople: false, anon: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 發起投票</button>}</div>
      {data.polls.length === 0 && <div style={{ color: "#9b9384", fontSize: 14, padding: "30px 0" }}>還沒有投票{isAdmin ? "，點「＋ 發起投票」" : ""}。</div>}
      {data.polls.map(poll => { const t = tally(poll); const voted = myVote(poll.id); return (
        <div key={poll.id} style={crewCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{poll.title}</div><div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: SUB }}>{t.total} 票</span></div>
          {poll.peoplePoll && t.win && <div style={{ fontSize: 13, color: "#B8860B", fontWeight: 700, marginBottom: 8 }}>👑 目前投票王：{optLabel(poll, t.win.id)}（{t.c[t.win.id]} 票）</div>}
          {poll.options.map(o => { const n = t.c[o.id] || 0; const pct = t.total ? Math.round(n / t.total * 100) : 0; const mine = voted?.choiceId === o.id; return (
            <div key={o.id} onClick={() => !voted && vote(poll, o.id)} style={{ position: "relative", border: `1px solid ${mine ? ACCENT : BORDER}`, borderRadius: 8, padding: "8px 12px", marginBottom: 6, cursor: voted ? "default" : "pointer", overflow: "hidden" }}>
              {voted && <div style={{ position: "absolute", inset: 0, width: pct + "%", background: mine ? "#fbeee6" : "#ece4d6", zIndex: 0 }} />}
              <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center" }}><span style={{ fontSize: 14, color: TEXT, fontWeight: mine ? 700 : 500 }}>{optLabel(poll, o.id)}{mine && " ✓"}</span><div style={{ flex: 1 }} />{voted && <span style={{ fontSize: 13, color: SUB, fontVariantNumeric: "tabular-nums" }}>{n}（{pct}%）</span>}</div>
            </div>); })}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>{!voted && <span style={{ fontSize: 12, color: ACCENT }}>點選項投票</span>}{voted && <span style={{ fontSize: 12, color: "#3C8C3C" }}>✓ 已投</span>}<div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && confirm("刪除這個投票？").then(ok => ok && persist({ ...data, polls: data.polls.filter(x => x.id !== poll.id), votes: (data.votes || []).filter(v => v.pollId !== poll.id) }))} style={{ border: "none", background: "none", color: "#b3261e", fontSize: 12, cursor: "pointer" }}>刪除</button>}</div>
        </div>); })}
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 440, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>發起投票</div>
            <input value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="主題（例：本月最佳服務）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 10 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, cursor: "pointer" }}><input type="checkbox" checked={ed.usePeople} onChange={e => setEd({ ...ed, usePeople: e.target.checked })} />選項用「夥伴名單」（選出投票王）</label>
            {!ed.usePeople && <textarea value={ed.optText} onChange={e => setEd({ ...ed, optText: e.target.value })} placeholder={"每行一個選項\n例：\n加開週會\n改善排班"} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, height: 90, resize: "vertical", marginBottom: 10, fontFamily: "inherit" }} />}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14, cursor: "pointer" }}><input type="checkbox" checked={ed.anon} onChange={e => setEd({ ...ed, anon: e.target.checked })} />匿名投票</label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={savePoll} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>發布</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 兌換商城 + 錢包 ───────────────────────────────────────────────────────────
export function ShopView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [fb, setFb] = useState([]); const [quests, setQuests] = useState({ quests: [], progress: [] }); const [shop, setShop] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  const [showLedger, setShowLedger] = useState(false); // 📒 積分存摺
  useMeSync(people, userName, setMe);
  const reload = async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); const f = await loadCrewJSON("kb_feedback", { items: [] }); setFb(f.items || []); setQuests(await loadCrewJSON("kb_quests", { quests: [], progress: [] })); setShop(await loadCrewJSON("kb_shop", { rewards: [], redemptions: [] })); };
  useEffect(() => { const s = setTimeout(() => setShop(p => p || { rewards: [], redemptions: [] }), 8000); reload().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setShop(n); saveCrewJSON("kb_shop", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (shop === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const balances = crewFullBalance(people, fb, quests, shop);
  const myBal = me ? (balances[me] || 0) : null;
  // 兌換生命週期（張良 2026-07-22 藏寶盒）：兌換→owned(進藏寶盒) → 要用時按「使用」→using(等主管核銷) → 核銷→used
  // 舊資料相容：requested 一律視為 owned（原本「處理中」的概念改為「已入藏寶盒」）
  const rdStatus = (r) => r.status === "requested" ? "owned" : (r.status || "owned");
  const updRd = (id, patch) => persist({ ...shop, redemptions: (shop.redemptions || []).map(x => x.id === id ? { ...x, ...patch } : x) });
  const notifyRewardEvent = async (kind, redemptionId) => { try { const t = await authToken(); await fetch("/api/onboard?action=reward-event", { method: "POST", headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ kind, redemptionId }) }); } catch (_) {} };
  const redeem = (r) => { if (!me) { alert("尚未對應到名單身分"); return; } if ((balances[me] || 0) < r.cost) { alert("積分不足"); return; } if ((r.stock ?? 99) <= 0) { alert("已兌完"); return; } confirm(`用 ${r.cost} 分兌換「${r.name}」？\n兌換後會放進「我的藏寶盒」，要用的時候再拿出來核銷。`, { danger: false, confirmLabel: "兌換" }).then(ok => { if (!ok) return; try { auditLog("新增", `兌換獎勵「${r.name}」`); } catch (_) {} persist({ ...shop, rewards: shop.rewards.map(x => x.id === r.id ? { ...x, stock: (x.stock ?? 99) - 1 } : x), redemptions: [...(shop.redemptions || []), { id: "rd-" + Math.random().toString(36).slice(2, 7), userId: me, rewardId: r.id, cost: r.cost, name: r.name, status: "owned", ts: new Date().toISOString() }] }); }); };
  const useItem = (r) => confirm(`要使用「${r.name}」嗎？\n送出後請找主管確認核銷（主管的獎勵中心會看到）。`, { danger: false, confirmLabel: "使用" }).then(ok => { if (!ok) return; try { auditLog("編輯", `申請使用獎勵「${r.name}」`); } catch (_) {} updRd(r.id, { status: "using", usingAt: new Date().toISOString() }); notifyRewardEvent("use", r.id); });
  const cancelUse = (r) => updRd(r.id, { status: "owned", usingAt: null });
  const verifyItem = (r, pName) => confirm(`核銷 ${pName} 的「${r.name}」？（確認已交付/已使用）`, { danger: false, confirmLabel: "核銷" }).then(ok => { if (!ok) return; try { auditLog("編輯", `核銷 ${pName} 的獎勵「${r.name}」`); } catch (_) {} updRd(r.id, { status: "used", usedAt: new Date().toISOString(), verifiedBy: userName || "主管" }); notifyRewardEvent("verified", r.id); });
  const returnItem = (r) => updRd(r.id, { status: "owned", usingAt: null });
  const saveReward = () => { if (!ed.name.trim()) { alert("請填名稱"); return; } const r = { id: ed.id || "rw-" + Math.random().toString(36).slice(2, 7), name: ed.name.trim(), desc: ed.desc || "", cost: Number(ed.cost) || 0, stock: ed.stock === "" ? 99 : Number(ed.stock), active: ed.active !== false }; persist({ ...shop, rewards: ed.id ? shop.rewards.map(x => x.id === ed.id ? r : x) : [...shop.rewards, r] }); setEd(null); };
  const myRedemptions = (shop.redemptions || []).filter(r => r.userId === me);
  const nameOfP = (id) => (people.find(p => p.id === id) || {}).name || "—";
  const allUsing = (shop.redemptions || []).filter(r => rdStatus(r) === "using");
  return (
    <div>
      {crewProtoTitle("🎁", "獎勵商城", "用累積的積分兌換獎勵（正式版兌換＝原子扣點、可稽核）。")}
      <div style={{ ...crewCard, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} />
        {me && <div onClick={() => setShowLedger(true)} title="點開積分存摺（逐筆來源與使用，像銀行收支）" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><span style={{ fontSize: 13, color: SUB }}>我的積分</span><span style={{ fontSize: 24, fontWeight: 800, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{myBal}</span><span style={{ fontSize: 12, color: SUB }}>分</span><span style={{ fontSize: 11.5, color: "#2E6FB0", fontWeight: 600 }}>📒 明細</span></div>}
        <div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ name: "", desc: "", cost: 100, stock: "", active: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增獎勵</button>}
      </div>
      {/* 張良 2026-07-26 手機版全面體檢：220→160 手機可排兩欄不擠 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        {shop.rewards.filter(r => r.active !== false || canManage).map(r => { const afford = me && (balances[me] || 0) >= r.cost; const out = (r.stock ?? 99) <= 0; return (
          <div key={r.id} style={{ ...crewCard, marginBottom: 0, opacity: r.active === false ? 0.55 : 1 }}>
            <div style={{ fontSize: 30, marginBottom: 4 }}>🎁</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{r.name}</div>
            <div style={{ fontSize: 12.5, color: SUB, marginBottom: 8, minHeight: 18 }}>{r.desc}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16, fontWeight: 800, color: ACCENT }}>{r.cost}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> 分</span></span><span style={{ fontSize: 11, color: SUB }}>{(r.stock ?? 99) >= 99 ? "" : `剩 ${r.stock}`}</span><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ ...r, stock: r.stock ?? "" })} style={{ border: "none", background: "none", color: SUB, fontSize: 12, cursor: "pointer" }}>編輯</button>}</div>
            <button onClick={() => redeem(r)} disabled={!afford || out} style={{ marginTop: 10, width: "100%", border: "none", background: out ? "#C8BCA0" : afford ? "#3C8C3C" : "#C8BCA0", color: "#fff", borderRadius: 8, padding: "8px", fontSize: 13.5, fontWeight: 600, cursor: afford && !out ? "pointer" : "default" }}>{out ? "已兌完" : afford ? "兌換" : "積分不足"}</button>
          </div>); })}
        {shop.rewards.length === 0 && <div style={{ color: "#9b9384", fontSize: 14, padding: "30px 0" }}>還沒有獎勵{isAdmin ? "，點「＋ 新增獎勵」" : ""}。</div>}
      </div>
      {showLedger && me && <PointsLedgerModal me={me} people={people} fbItems={fb} quests={quests} shop={shop} onClose={() => setShowLedger(false)} />}
      {/* 主管：待核銷（夥伴按了「使用」的獎品，當面確認後在這裡核銷） */}
      {canManage && allUsing.length > 0 && (
        <div style={{ ...crewCard, marginTop: 14, border: "1.5px solid #c98a14" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🎫 待核銷<span style={{ marginLeft: 6, fontSize: 11, background: ACCENT, color: "#fff", borderRadius: 10, padding: "1px 8px", fontWeight: 700 }}>{allUsing.length}</span><span style={{ marginLeft: 8, fontSize: 11.5, color: SUB, fontWeight: 400 }}>夥伴申請使用的獎品，當面確認交付後按核銷</span></div>
          {allUsing.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, padding: "7px 0", borderTop: "1px solid #ece4d6", flexWrap: "wrap" }}>
              <b style={{ color: TEXT }}>{nameOfP(r.userId)}</b><span>{r.name}</span>
              <span style={{ fontSize: 11.5, color: SUB }}>{(r.usingAt || "").slice(5, 16).replace("T", " ")} 申請</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => returnItem(r)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>退回藏寶盒</button>
              <button onClick={() => verifyItem(r, nameOfP(r.userId))} style={{ border: "none", background: "#3C8C3C", color: "#fff", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✅ 核銷</button>
            </div>
          ))}
        </div>
      )}
      {/* 我的藏寶盒：兌換到的獎品放這裡，要用時按「使用」請主管核銷 */}
      {me && myRedemptions.length > 0 && (() => {
        const owned = myRedemptions.filter(r => rdStatus(r) === "owned");
        const using = myRedemptions.filter(r => rdStatus(r) === "using");
        const used = myRedemptions.filter(r => rdStatus(r) === "used");
        return (
          <div style={{ ...crewCard, marginTop: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>🎒 我的藏寶盒<span style={{ marginLeft: 8, fontSize: 11.5, color: SUB, fontWeight: 400 }}>兌換到的獎品放這裡，要用的時候按「使用」找主管核銷</span></div>
            {owned.length + using.length === 0 && <div style={{ fontSize: 12.5, color: "#9b9384", padding: "6px 0" }}>藏寶盒是空的——上面商城逛起來！</div>}
            {/* 張良 2026-07-26 手機版全面體檢：210→160 手機可排兩欄不擠 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginTop: 8 }}>
              {[...using, ...owned].map(r => { const isUsing = rdStatus(r) === "using"; return (
                <div key={r.id} style={{ border: `1.5px solid ${isUsing ? "#c98a14" : BORDER}`, borderRadius: 10, padding: "10px 12px", background: isUsing ? "#FFF7ED" : "#FBF7EE" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 18 }}>🎁</span><b style={{ fontSize: 13.5, color: TEXT }}>{r.name}</b></div>
                  <div style={{ fontSize: 11, color: SUB, margin: "3px 0 8px" }}>{(r.ts || "").slice(0, 10)} 兌換 · {r.cost} 分</div>
                  {isUsing
                    ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 12, color: "#c98a14", fontWeight: 700 }}>⏳ 等待主管核銷</span><div style={{ flex: 1 }} /><button onClick={() => cancelUse(r)} style={{ border: "none", background: "none", color: SUB, fontSize: 11.5, cursor: "pointer" }}>取消</button></div>
                    : <button onClick={() => useItem(r)} style={{ width: "100%", border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>🎫 使用</button>}
                </div>
              ); })}
            </div>
            {used.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: SUB }}>已使用 {used.length} 項：{used.slice(0, 5).map(r => `${r.name}（${(r.usedAt || "").slice(0, 10)}）`).join("、")}{used.length > 5 ? "…" : ""}</div>}
          </div>
        );
      })()}
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{ed.id ? "編輯獎勵" : "新增獎勵"}</div>
            <input value={ed.name} onChange={e => setEd({ ...ed, name: e.target.value })} placeholder="獎勵名稱（例：星巴克咖啡券）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 8 }} />
            <input value={ed.desc} onChange={e => setEd({ ...ed, desc: e.target.value })} placeholder="說明（選填）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}><div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>所需積分</div><input type="number" value={ed.cost || ""} onChange={e => setEd({ ...ed, cost: e.target.value })} style={{ width: 100, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /></div><div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>庫存（空=不限）</div><input type="number" value={ed.stock || ""} onChange={e => setEd({ ...ed, stock: e.target.value })} style={{ width: 100, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /></div></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={saveReward} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button></div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── 夥伴中心：名冊 / 入職流程（人員主檔：動態自訂欄位、檔案上傳、必填追蹤入職進度）──
// 欄位定義存在 kb_roster.fields（2026-07-18 與 360 分家），管理員可任意 新增/改名/改型別(文字/日期/選單/檔案上傳)/設必填/刪除。
const DEFAULT_ROSTER_FIELDS = [
  { key: "empNo", show: true, label: "員工編號(NUEiP)", type: "text" },
  { key: "dept", show: true, label: "部門/崗位", type: "text" },
  { key: "startDate", show: true, label: "到職日", type: "date", req: true },
  { key: "endDate", label: "離職日", type: "date" },
  { key: "bday", show: true, label: "生日", type: "date", req: true },
  { key: "insureCode", label: "投保用生日碼", type: "text" },
  { key: "idNo", label: "身分證字號", type: "text", req: true },
  { key: "workPermit", label: "工作證號(外籍)", type: "text" },
  { key: "special", label: "特殊身份", type: "text" },
  { key: "insUpdate", label: "保險更新日期", type: "text" },
  { key: "laborIns", label: "勞保投保額", type: "text", req: true },
  { key: "healthIns", label: "健保投保額", type: "text" },
  { key: "insNote", label: "保險備註", type: "text" },
  { key: "groupIns", label: "富邦團保", type: "select", options: ["", "Ｖ"] },
  { key: "baseSalary", label: "本薪", type: "text", req: true },
  { key: "studyAllow", label: "學習補助", type: "text" },
  { key: "mealAllow", label: "伙食津貼", type: "text" },
  { key: "bankBranch", label: "薪轉分行", type: "text", req: true },
  { key: "bankAcct", label: "薪轉帳號", type: "text", req: true },
  { key: "phone", label: "電話", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "account", label: "App帳號(對應登入名)", type: "text" },
  { key: "note", label: "備註", type: "text" },
  { key: "idDoc", label: "身分證影本", type: "file", req: true },
  { key: "contractDoc", label: "勞動契約", type: "file", req: true },
  { key: "bankDoc", label: "存摺影本", type: "file", req: true },
  { key: "docs", label: "其他文件", type: "file" },
];
// ── 入職 2.1：私密文件（存私有桶 ground-private，經 api/onboard 驗身分換短效連結才開得了）──
const authToken = async () => { try { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; } catch (_) { return ""; } };
const openPrivateDoc = async (path) => {
  try {
    const t = await authToken();
    const r = await fetch(`/api/onboard?action=docurl&path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${t}` } });
    const d = await r.json();
    if (d.url) window.open(d.url, "_blank"); else alert(d.error || "無法開啟文件");
  } catch (_) { alert("無法開啟文件"); }
};
const PrivateDocBtns = ({ docs }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {(docs || []).map(dcc => (
      <button key={dcc.path} onClick={() => openPrivateDoc(dcc.path)} style={{ border: `1px solid ${BORDER}`, background: "#FBF7EE", color: "#2E6FB0", borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>🔒 {dcc.label || dcc.name}</button>
    ))}
  </div>
);
// 名冊機密檔案欄（身分證/存摺/契約…）：上傳走私有桶（治本：不再進公開圖庫）；舊的公開檔連結照樣能開
function PrivateFileField({ person, fieldKey, entries, editable, onLocal }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const up = async (files) => {
    const f = files?.[0]; if (!f) return;
    if (f.size > 12 * 1024 * 1024) { alert("檔案太大（上限 12MB）"); return; }
    setBusy(true);
    try {
      const dataUrl = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(f); });
      const t = await authToken();
      const r = await fetch("/api/onboard?action=upload", { method: "POST", headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ personId: person.id, fieldKey, filename: f.name, dataUrl }) });
      const d = await r.json();
      if (d.ok) onLocal([...(entries || []), d.entry]); // 後端已寫回名冊；前端只同步畫面不重存（避免互蓋）
      else alert(d.error || "上傳失敗");
    } catch (_) { alert("上傳失敗"); }
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {(entries || []).map((e2, i) => e2.private || (!e2.url && e2.path)
        ? <button key={i} onClick={() => openPrivateDoc(e2.path)} style={{ border: `1px solid ${BORDER}`, background: "#FBF7EE", color: "#2E6FB0", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>🔒 {e2.name || "檔案"}</button>
        : <a key={i} href={e2.url} target="_blank" rel="noreferrer" style={{ border: `1px solid ${BORDER}`, background: "#fff", color: "#2E6FB0", borderRadius: 8, padding: "5px 10px", fontSize: 12, textDecoration: "none" }}>📎 {e2.name || "檔案"}</a>)}
      {editable && <>
        <button onClick={() => ref.current?.click()} disabled={busy} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>{busy ? "上傳中…" : "＋ 上傳(拍照)"}</button>
        <input ref={ref} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => { up(e.target.files); e.target.value = ""; }} />
      </>}
      {(entries || []).length === 0 && !editable && <span style={{ fontSize: 12, color: "#C8BCA0" }}>—</span>}
    </div>
  );
}
// 名冊「待審核」區（入職 2.1）：LINE 報到即開帳號＋名冊「入職中」卡，夥伴自己在 App 填資料，
// 這裡看進度/證件 → 一鍵核准轉正式（退回=刪卡+刪帳號+LINE 通知）
function OnboardReviewSection({ pending, fields, progressOf, mgr, confirm, refresh }) {
  const [busy, setBusy] = useState("");
  const [deptDraft, setDeptDraft] = useState({});
  if (!mgr || !pending.length) return null; // 只有管理員/主管看得到審核區（一般夥伴/新人不該看到別人的申請）
  const act = async (action, p, reason) => {
    setBusy(p.id);
    try {
      const t = await authToken();
      const r = await fetch(`/api/onboard?action=${action}`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ personId: p.id, dept: deptDraft[p.id] || "", reason }) });
      const d = await r.json();
      if (!d.ok) alert(d.error || "操作失敗");
      else { try { auditLog(action === "approve" ? "新增" : "刪除", `入職${action === "approve" ? "核准" : "退回"}：${p.name}`); } catch (_) {} }
      await refresh?.(); // 後端寫完馬上重抓名冊（伺服器寫入不會觸發前端即時廣播，不重抓畫面會卡舊狀態）
    } catch (_) { alert("操作失敗"); }
    setBusy("");
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT, marginBottom: 8 }}>📥 入職中・待審核<span style={{ marginLeft: 6, fontSize: 11, background: ACCENT, color: "#fff", borderRadius: 10, padding: "1px 8px", fontWeight: 700 }}>{pending.length}</span></div>
      <div style={{ display: "grid", gap: 10 }}>
        {pending.map(p => {
          const pg = progressOf(p);
          const missing = fields.filter(f => f.req && !(f.type === "file" ? (p[f.key] || []).length : String(p[f.key] ?? "").trim())).map(f => f.label);
          const docs = fields.filter(f => f.type === "file").flatMap(f => (p[f.key] || []).filter(e2 => e2.private || e2.path));
          return (
            <div key={p.id} style={{ background: "#fff", border: "1.5px solid #c98a14", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>{p.name}{p.nick ? `（${p.nick}）` : ""}</span>
                <span style={{ fontSize: 11.5, color: SUB }}>{(p.onboardAt || "").slice(0, 10)} 報到</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: p.contractSigned ? "#3C8C3C" : "#b3261e" }}>{p.contractSigned ? `✍ 契約已簽 ${(p.contractSigned || "").slice(0, 10)}` : "✍ 契約未簽"}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: pg === 100 ? "#3C8C3C" : "#c98a14" }}>資料 {pg}%</span>
              </div>
              {missing.length > 0 && <div style={{ fontSize: 12, color: "#9b9384", marginBottom: 8 }}>缺：{missing.slice(0, 6).join("、")}{missing.length > 6 ? `…共${missing.length}項` : ""}（點下方名冊本人卡片可代填）</div>}
              {docs.length > 0 && <div style={{ marginBottom: 4 }}><PrivateDocBtns docs={docs} /></div>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <input value={deptDraft[p.id] ?? (p.dept || "")} onChange={e => setDeptDraft(s => ({ ...s, [p.id]: e.target.value }))} placeholder="部門/崗位（例：外場）" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, width: 170 }} />
                <div style={{ flex: 1 }} />
                <button disabled={busy === p.id} onClick={async () => { const rs = window.prompt("退回原因（會用 LINE 告訴對方；退回=刪除這張卡與帳號）", "非本店錄取人員"); if (rs === null) return; act("reject", p, rs); }} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: "#b3261e", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>退回並刪除</button>
                <button disabled={busy === p.id} onClick={async () => { if (await confirm(`核准「${p.name}」轉正式夥伴？\n・部門：${deptDraft[p.id] ?? (p.dept || "未填")}\n・到職日：今天（可再改）\n・LINE 通知本人`, { danger: false, confirmLabel: "核准" })) act("approve", p); }} style={{ border: "none", background: "#3C8C3C", color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{busy === p.id ? "處理中…" : "✅ 核准轉正式"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RosterView({ canEdit, confirm, me, ReceiptUploader }) {
  // GD App 綁定狀態（張良 2026-09-21：名冊要看得到誰綁了 /prep）——讀 pm_prep_bind（finance 空間 key，直接用完整 key）
  const [gdBind, setGdBind] = useState({});
  useEffect(() => { (async () => { try {
    const r = await window.storage.get("sp_finance_pm_prep_bind", true);
    const d = r && r.value ? JSON.parse(r.value) : null;
    const m = {};
    Object.values(d?.tokens || {}).forEach(t2 => { if (t2.rid) m[t2.rid] = 1; if (t2.uid) m["u_" + t2.uid] = 1; });
    setGdBind(m);
  } catch (_) {} })(); }, []);
  const isMobile = useIsMobile(); // 張良 2026-07-26 手機版全面體檢：夥伴詳情彈窗手機改單欄（主表維持橫滑）
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [sortUser, setSortUser] = useState(null); // 疊加排序（null=用預設）：先點=主排序、再點別欄=次排序；同欄第2次反向、第3次取消
  const [sel, setSel] = useState(null);
  const [showFields, setShowFields] = useState(false);
  const [lockTip, setLockTip] = useState(false);
  const [dragIdx, setDragIdx] = useState(null); // 欄位設定拖曳排序
  const [optField, setOptField] = useState(null); // 選項管理中的欄位 key（選單型欄位的增刪改）
  useEffect(() => {
    (async () => {
      const d = await loadRosterDoc(); setData(d);
      // 今日頁「入職資料卡」導過來 → 自動打開本人卡片
      try { const openId = localStorage.getItem("pm_open_self_card"); if (openId && (d.people || []).some(pp => pp.id === openId)) { setSel(openId); localStorage.removeItem("pm_open_self_card"); } } catch (_) {}
    })();
    // 即時同步：別台改了名冊 → 這裡跟著更新
    const un = onSharedChange(K(ROSTER_KEY), (_k, v) => { try { const d = v ? JSON.parse(v) : { people: [], fields: [] }; setData({ people: d.people || [], fields: d.fields || [], autoCols: d.autoCols || {} }); } catch (_) {} });
    return un;
  }, []);
  if (!data) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const people = data.people || [];
  const fields = (data.fields && data.fields.length ? data.fields : DEFAULT_ROSTER_FIELDS);
  // 自動計算欄位（年紀/入職進度/狀態/文件）：不是資料欄位、系統自己算，但可在欄位設定勾顯示與否（張良 2026-07-22）
  const autoCols = { age: true, prog: true, status: true, docs: true, ...(data.autoCols || {}) };
  // 預設排序（張良 2026-07-18 定案）：部門 ▲ → 職稱 ▲ → 到職日 ▼（職稱是自訂欄位，動態找 key）
  const titleField = fields.find(f => /職稱/.test(f.label || ""));
  const sort = sortUser || [{ key: "dept", dir: 1 }, ...(titleField ? [{ key: titleField.key, dir: 1 }] : []), { key: "startDate", dir: -1 }];
  const setSort = (fn) => setSortUser(typeof fn === "function" ? fn(sort) : fn);
  const persist = (patch) => { const next = { ...data, ...patch }; setData(next); saveRosterDoc(next); }; // 沒自訂過欄位＝fields 留空，跟舊行為一樣沿用預設（日後預設更新能跟上）
  const updP = (id, fp) => persist({ people: people.map(pp => pp.id === id ? { ...pp, ...fp } : pp) });
  const updLocal = (id, fp) => setData(d => ({ ...d, people: (d.people || []).map(pp => pp.id === id ? { ...pp, ...fp } : pp) })); // 只更新畫面不重存（私密上傳後端已寫回名冊）
  const addP = () => { if (!canEdit) return; const np = { id: "p-" + Math.random().toString(36).slice(2, 8), name: "", nick: "", role: "staff", status: "在職" }; persist({ people: [...people, np] }); setSel(np.id); };
  const delP = async (pp) => { if (!canEdit) return; if (!(await confirm(`刪除「${pp.name || "未命名"}」？`, { confirmLabel: "刪除" }))) return; persist({ people: people.filter(x => x.id !== pp.id) }); setSel(null); };
  // 入職進度＝必填欄位完成率（含必上傳的檔案）
  const reqFields = fields.filter(f => f.req);
  const filledOf = (pp, f) => f.type === "file" ? (Array.isArray(pp[f.key]) && pp[f.key].length > 0) : String(pp[f.key] ?? "").trim() !== "";
  const progress = (pp) => reqFields.length ? Math.round(reqFields.filter(f => filledOf(pp, f)).length / reqFields.length * 100) : 100;
  const statusOf = (pp) => pp.endDate ? "離職" : (pp.status || "在職");
  const isSelf = (pp) => !!me && [pp.account, pp.name, pp.nick].filter(Boolean).includes(me.name);
  const canOpen = (pp) => canEdit || isSelf(pp);
  const mmdd = (b) => b ? `${Number(b.split("-")[1])}/${Number(b.split("-")[2])}` : "—";
  const docCount = (pp) => fields.filter(f => f.type === "file").reduce((n, f) => n + ((pp[f.key] || []).length), 0);
  const nextBdayDays = (b) => {
    if (!b) return 9999;
    const t = new Date(); const [, m, d] = b.split("-").map(Number);
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    let nb = new Date(t.getFullYear(), m - 1, d);
    if (nb < today) nb = new Date(t.getFullYear() + 1, m - 1, d);
    return Math.round((nb - today) / 864e5);
  };
  const val = (pp, k) => {
    if (k === "prog") return progress(pp);
    if (k === "statusD") return statusOf(pp);
    if (k === "bdayMD") return nextBdayDays(pp.bday);
    if (k === "age") return ageOf(pp.bday) === "" ? 999 : ageOf(pp.bday);
    // 選單型欄位照「選項管理」裡排的順序（不是筆畫）；沒填/不在清單的排最後
    const f = fields.find(x => x.key === k);
    if (f && f.type === "select") {
      const v = String(pp[k] ?? "").trim();
      if (!v) return 999; // 沒填的排最後
      const i = (f.options || []).indexOf(v);
      return i >= 0 ? i : 998;
    }
    return pp[k] ?? "";
  };
  const showCols = fields.filter(f => f.show);
  // 欄寬自動調整：依「表頭 + 該欄實際內容」計算（中文算2格、英數算1格），夾在 56~230px
  const dispW = (t) => [...String(t)].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  const colW = (f) => {
    if (f.type === "file") return "52px";
    if (f.key === "bday") return "150px";
    const units = Math.max(dispW(f.label) * 0.9, 6, ...people.map(pp => dispW(cellVal(pp, f) === "—" ? "" : cellVal(pp, f))));
    const px = Math.min(230, Math.max(56, Math.round(units * 7.6 + (f.key === "dept" ? 34 : 20))));
    return px + "px";
  };
  // 姓名欄也依內容自動寬（避免當彈性欄吃掉全部剩餘空間、跟員編隔一大片）
  const nameW = Math.min(250, Math.max(150, Math.round(Math.max(8, ...people.map(pp => dispW(`${pp.name || ""}（${pp.nick || ""}）`))) * 7.6 + 30)));
  const DEPT_PAL = ["#3a6ea5", "#3f7d4e", "#c98a14", "#b3492f", "#6b4a86", "#2f7d7a", "#c4582a", "#5a6e3a"];
  const deptColor = (v) => { const opts = ((fields.find(f2 => f2.key === "dept") || {}).options || []).filter(Boolean); const i = opts.indexOf(v); return DEPT_PAL[(i >= 0 ? i : opts.length) % DEPT_PAL.length]; };
  const ageOf = (b) => { if (!b) return ""; const t = new Date(), d = new Date(b + "T00:00:00"); let a = t.getFullYear() - d.getFullYear(); if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--; return a; };
  const tenureOf = (pp) => {
    if (!pp.startDate) return "";
    const st = new Date(pp.startDate + "T00:00:00"), en = pp.endDate ? new Date(pp.endDate + "T00:00:00") : new Date();
    let m = (en.getFullYear() - st.getFullYear()) * 12 + en.getMonth() - st.getMonth() - (en.getDate() < st.getDate() ? 1 : 0);
    if (m < 0) m = 0;
    const y = Math.floor(m / 12), mo = m % 12;
    return y ? `${y}年${mo}月` : `${mo}月`;
  };
  const cellVal = (pp, f) => {
    if (f.key === "startDate") return pp.startDate ? `${pp.startDate}（${tenureOf(pp)}）` : "—";
    if (f.key === "bday") { const tm = pp.bday && Number(pp.bday.split("-")[1]) === new Date().getMonth() + 1; return pp.bday ? `${pp.bday}（${ageOf(pp.bday)}歲）` + (tm ? " 🎂" : "") : "—"; }
    if (f.type === "file") { const n = (pp[f.key] || []).length; return n ? `📎${n}` : "—"; }
    return String(pp[f.key] ?? "").trim() || "—";
  };
  let rows = people.filter(pp => !q.trim() || ((pp.name || "") + (pp.nick || "") + (pp.dept || "") + (pp.empNo || "") + (pp.phone || "")).toLowerCase().includes(q.trim().toLowerCase()));
  rows = [...rows].sort((a, b) => {
    for (const s of (sort.length ? sort : [{ key: "startDate", dir: 1 }])) {
      const va = val(a, s.key), vb = val(b, s.key);
      const c = (typeof va === "number" && typeof vb === "number") ? (va - vb) : String(va).localeCompare(String(vb), "zh-Hant-TW");
      if (c) return c * s.dir;
    }
    return 0;
  });
  const GTC = `40px ${nameW}px ${showCols.flatMap(f => f.key === "bday" ? ["150px", ...(autoCols.age ? ["52px"] : [])] : [colW(f)]).join(" ")}${autoCols.prog ? " 126px" : ""}${autoCols.status ? " 58px" : ""}${autoCols.docs ? " 48px" : ""}`;
  const th = (label, key, extra) => {
    const si = key ? sort.findIndex(s => s.key === key) : -1;
    const s = si >= 0 ? sort[si] : null;
    return (
      <button key={label} onClick={() => key && setSort(list => {
        const i = list.findIndex(x => x.key === key);
        if (i < 0) return [...list, { key, dir: 1 }];              // 沒點過 → 疊加為次排序（▲）
        if (list[i].dir === 1) return list.map((x, j) => j === i ? { ...x, dir: -1 } : x); // 第2次 → 反向（▼）
        return list.filter((_, j) => j !== i);                     // 第3次 → 從排序中移除
      })} title={`${label}｜點一下疊加排序、再點反向、第三下取消`} style={{ background: "none", border: "none", textAlign: "left", padding: "8px 8px", fontSize: 10.5, letterSpacing: 0.8, color: s ? TEXT : "#9b9384", fontWeight: 700, cursor: key ? "pointer" : "default", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, maxWidth: "100%", ...extra }}>
        {label}{s ? (s.dir === 1 ? " ▲" : " ▼") : ""}{s && sort.length > 1 ? <span style={{ fontSize: 9, color: ACCENT }}>{si + 1}</span> : null}
      </button>
    );
  };
  const inpS = { border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13.5, background: "#fff", color: TEXT, boxSizing: "border-box", width: "100%", outline: "none" };
  const dateS = { ...inpS, colorScheme: "light", fontFamily: "'Noto Sans TC',sans-serif", cursor: "pointer" };
  return (
    <div>
      <OnboardReviewSection pending={people.filter(pp => pp.onboarding)} fields={fields} progressOf={progress} mgr={me?.role === "admin" || me?.role === "manager"} confirm={confirm} refresh={async () => setData(await loadRosterDoc())} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <span style={{ background: ACCENT, color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "2px 8px", letterSpacing: 1 }}>名冊</span>
        <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, fontFamily: DISP }}>夥伴名冊 / 入職流程</div>
        <span style={{ fontSize: 12, color: "#9b9384" }}>{people.length} 人・必填 {reqFields.length} 項＝入職進度・🔒完整卡片＝主管與本人</span>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋姓名/綽號/員編/部門…" style={{ ...inpS, width: 210 }} />
        {canEdit && <button onClick={() => setShowFields(true)} style={{ background: "#fff", color: TEXT, border: `1.5px solid #c8bca6`, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⚙ 欄位設定</button>}
        {canEdit && <button onClick={addP} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>＋ 新增夥伴</button>}
      </div>
      {lockTip && <div style={{ background: "#fbeee6", border: `1px solid ${ACCENT}`, color: ACCENT, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>🔒 完整資料卡（含身分證、薪資等機密）只有主管與本人可以打開；表格上顯示的都是公開欄位。</div>}
      <div style={{ background: "#fff", border: "1.5px solid #c8bca6", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}><div style={{ minWidth: 860 }}>
          <div style={{ display: "grid", gridTemplateColumns: GTC, background: "#ece4d6", borderBottom: "1.5px solid #c8bca6", alignItems: "center" }}>
            <span />{th("姓名（綽號）", "name")}{showCols.flatMap(f => f.key === "bday" ? [th("生日", "bdayMD"), ...(autoCols.age ? [th("年紀", "age")] : [])] : [th(f.label, f.type === "file" ? null : f.key)])}{autoCols.prog && th("入職進度", "prog")}{autoCols.status && th("狀態", "statusD")}{autoCols.docs && th("文件", null)}
          </div>
          {rows.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "#9b9384", fontSize: 13 }}>沒有符合的人</div> :
            rows.map((pp, i) => {
              const pg = progress(pp); const st = statusOf(pp);
              const thisMonth = pp.bday && Number(pp.bday.split("-")[1]) === new Date().getMonth() + 1;
              return (
                <div key={pp.id} onClick={() => canOpen(pp) ? setSel(pp.id) : (setLockTip(true), setTimeout(() => setLockTip(false), 3000))}
                  onMouseEnter={e => e.currentTarget.style.background = "#f4efe5"} onMouseLeave={e => e.currentTarget.style.background = st === "離職" ? "#f2ede1" : "#fff"}
                  style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "center", height: 40, borderTop: i ? `1px solid #f0ead9` : "none", cursor: "pointer", background: st === "離職" ? "#f2ede1" : "#fff", opacity: st === "離職" ? .72 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "center" }}><span style={{ width: 24, height: 24, borderRadius: "50%", background: "#fbeee6", color: ACCENT, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{(pp.name || "?")[0]}</span></div>
                  <div style={{ padding: "0 8px", fontSize: 13, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pp.name || "（未命名）"}{pp.nick && <span style={{ color: "#9b9384", fontWeight: 400 }}>（{pp.nick}）</span>}{(() => { // GD 人員標記（張良 2026-09-21：點一下標記/取消→/prep 排班/任務/回饋選人名單；✓=已綁定App）
                    const bound = gdBind[pp.id] || (pp.lineUserId && gdBind["u_" + pp.lineUserId]);
                    const on = !!pp.gd;
                    if (!on && !canEdit) return null;
                    return <span title={on ? (bound ? "GD 人員・已綁定 App（點一下取消標記）" : "GD 人員（點一下取消標記）") : "點一下標記為 GD 人員"}
                      onClick={canEdit ? (e) => { e.stopPropagation(); updP(pp.id, { gd: on ? 0 : 1 }); } : undefined}
                      style={{ fontSize: 9.5, fontWeight: 800, cursor: canEdit ? "pointer" : "default", marginLeft: 4, verticalAlign: "1px", borderRadius: 6, padding: "1px 5px",
                        color: on ? "#1a7f4b" : "#c8bca6", background: on ? "#e6f5ec" : "transparent", border: on ? "1px solid #bbe3cc" : "1px dashed #d8cfba" }}>
                      {on ? (bound ? "GD✓" : "GD") : "GD＋"}</span>;
                  })()}{thisMonth && " 🎂"}{canOpen(pp) ? "" : " "}{!canOpen(pp) && <span style={{ fontSize: 10, color: "#c8bca6" }}>🔒</span>}</div>
                  {showCols.flatMap(f => {
                    if (f.key === "bday") {
                      const dLeft = nextBdayDays(pp.bday);
                      const near = pp.bday && dLeft <= 30;
                      return [
                        <div key="bdayMD" style={{ padding: "0 6px" }}>{pp.bday ? (
                          <span style={near ? { fontSize: 12, fontWeight: 700, color: ACCENT, background: "#fbeee6", border: `1px solid ${ACCENT}`, borderRadius: 8, padding: "2px 8px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" } : { fontSize: 12.5, color: SUB, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            {pp.bday.slice(5)}{dLeft === 0 ? " 🎂今天" : near ? `（${dLeft}天後）` : ""}
                          </span>) : <span style={{ color: "#c8bca6" }}>—</span>}</div>,
                        ...(autoCols.age ? [<div key="age" style={{ padding: "0 8px", fontSize: 12.5, color: SUB, fontVariantNumeric: "tabular-nums" }}>{pp.bday ? ageOf(pp.bday) : "—"}</div>] : []),
                      ];
                    }
                    const v = cellVal(pp, f);
                    if (f.key === "dept" && v !== "—") return [<div key={f.key} style={{ padding: "0 8px" }}><span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: deptColor(v), borderRadius: 10, padding: "2px 10px", whiteSpace: "nowrap" }}>{v}</span></div>];
                    return [<div key={f.key} style={{ padding: "0 8px", fontSize: f.key === "empNo" ? 11.5 : 12.5, fontFamily: f.key === "empNo" ? "'IBM Plex Mono',monospace" : undefined, fontVariantNumeric: "tabular-nums", color: v === "—" ? "#c8bca6" : SUB, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>];
                  })}
                  {autoCols.prog && <div style={{ padding: "0 10px", display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ flex: 1, height: 7, background: "#e6ddc9", borderRadius: 4, overflow: "hidden" }}><div style={{ width: pg + "%", height: "100%", background: pg === 100 ? "#3f7d4e" : pg >= 50 ? "#c98a14" : "#b3261e", borderRadius: 4 }} /></div>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 700, color: pg === 100 ? "#3f7d4e" : TEXT, width: 34, textAlign: "right" }}>{pg}%</span>
                  </div>}
                  {autoCols.status && <div style={{ padding: "0 8px" }}><span style={{ fontSize: 11, fontWeight: 600, color: st === "在職" ? "#3f7d4e" : "#9b9384", background: st === "在職" ? "#eef5ef" : "#ece4d6", borderRadius: 10, padding: "2px 9px", whiteSpace: "nowrap" }}>{st}</span></div>}
                  {autoCols.docs && <div style={{ padding: "0 8px", fontSize: 12, color: docCount(pp) ? SUB : "#c8bca6", fontVariantNumeric: "tabular-nums" }}>{docCount(pp) ? `📎${docCount(pp)}` : "—"}</div>}
                </div>
              );
            })}
        </div></div>
      </div>
      {/* 夥伴詳情：動態欄位（依欄位設定渲染） */}
      {sel && (() => {
        const pp = people.find(x => x.id === sel); if (!pp) return null;
        if (!canOpen(pp)) return null;
        const pg = progress(pp);
        const editable = canEdit || isSelf(pp);
        const F = (f) => {
          const missing = f.req && !filledOf(pp, f);
          const lab = <span>{f.label}{f.req && <span style={{ color: missing ? "#b3261e" : "#3f7d4e" }}> {missing ? "＊必填" : "✓"}</span>}</span>;
          let node = null;
          // 機密檔案（身分證/存摺/契約…）改走私有桶上傳（入職 2.1；舊公開檔連結照常能開）
          if (f.type === "file") node = <PrivateFileField person={pp} fieldKey={f.key} entries={pp[f.key] || []} editable={editable} onLocal={list => updLocal(pp.id, { [f.key]: list })} />;
          else if (f.type === "date") node = <input type="date" value={pp[f.key] || ""} onChange={e => updP(pp.id, { [f.key]: e.target.value })} disabled={!editable} style={dateS} />;
          else if (f.type === "select") {
            const cur = pp[f.key] || "";
            const opts = [...new Set(["", ...(f.options || []).map(o => String(o).trim()), ...(cur ? [cur] : [])])];
            node = <select value={cur} onChange={e => {
              if (e.target.value === "__add__") { const nv = window.prompt(`「${f.label}」新增選項`); if (nv && nv.trim()) { persist({ fields: fields.map(x => x.key === f.key ? { ...x, options: [...(x.options || []), nv.trim()] } : x), people: people.map(x => x.id === pp.id ? { ...x, [f.key]: nv.trim() } : x) }); } return; }
              if (e.target.value === "__manage__") { setOptField(f.key); return; }
              updP(pp.id, { [f.key]: e.target.value });
            }} disabled={!editable} style={inpS}>{opts.map(o => <option key={o} value={o}>{o || "—"}</option>)}{editable && <option value="__add__">＋ 新增選項…</option>}{editable && <option value="__manage__">✎ 編輯選項（改名/刪除/排序）…</option>}</select>;
          }
          else node = <input value={pp[f.key] || ""} onChange={e => updP(pp.id, { [f.key]: e.target.value })} disabled={!editable} style={inpS} />;
          return <label key={f.key} style={{ display: "block", fontSize: 11, letterSpacing: 0.5, color: "#9b9384", fontWeight: 600, gridColumn: f.type === "file" ? "1 / -1" : undefined }}>{lab}<div style={{ marginTop: 4 }}>{node}</div></label>;
        };
        return (
          <div onClick={e => e.target === e.currentTarget && setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, width: "min(680px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>夥伴資料{pp.name ? `：${pp.name}` : ""}{pp.nick ? `（${pp.nick}）` : ""}</div>
                <div style={{ flex: 1 }} />
                {canEdit && <button onClick={() => delP(pp)} style={{ background: "none", border: `1px solid ${BORDER}`, color: "#b3261e", borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>刪除</button>}
                <button onClick={() => setSel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: SUB }}>×</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 11, letterSpacing: .5, color: "#9b9384", fontWeight: 600 }}>入職進度</span>
                <div style={{ flex: 1, height: 8, background: "#e6ddc9", borderRadius: 4, overflow: "hidden" }}><div style={{ width: pg + "%", height: "100%", background: pg === 100 ? "#3f7d4e" : pg >= 50 ? "#c98a14" : "#b3261e" }} /></div>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, fontWeight: 700 }}>{pg}%</span>
              </div>
              {/* 張良 2026-07-26 手機版全面體檢：手機改單欄直列（桌機維持兩欄） */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 4 }}>
                <label style={{ display: "block", fontSize: 11, letterSpacing: 0.5, color: "#9b9384", fontWeight: 600 }}>姓名<div style={{ marginTop: 4 }}><input value={pp.name || ""} onChange={e => updP(pp.id, { name: e.target.value })} disabled={!editable} style={inpS} /></div></label>
                <label style={{ display: "block", fontSize: 11, letterSpacing: 0.5, color: "#9b9384", fontWeight: 600 }}>綽號<div style={{ marginTop: 4 }}><input value={pp.nick || ""} onChange={e => updP(pp.id, { nick: e.target.value })} disabled={!editable} style={inpS} /></div></label>
                {fields.map(F)}
                <label style={{ display: "block", fontSize: 11, letterSpacing: 0.5, color: "#9b9384", fontWeight: 600 }}>狀態<div style={{ marginTop: 4 }}><select value={pp.status || "在職"} onChange={e => updP(pp.id, { status: e.target.value })} disabled={!editable} style={inpS}><option>在職</option><option>離職</option><option>留停</option></select></div></label>
                {(pp.privateDocs || []).length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 11, letterSpacing: 0.5, color: "#9b9384", fontWeight: 600, marginBottom: 4 }}>🔒 入職文件（私密加密存放，點擊開啟短效連結）</div>
                    <PrivateDocBtns docs={pp.privateDocs} />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {/* 欄位設定：任意新增/改名/型別(含檔案上傳)/必填/刪除 */}
      {showFields && (
        <div onClick={e => e.target === e.currentTarget && setShowFields(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 720, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, width: "min(640px,96vw)", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>⚙ 名冊欄位設定</div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowFields(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: SUB }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>拖 ⠿ 可調整欄位順序（＝表格欄位順序）；選單型欄位按「✎」管理選項（改名/刪除/排序）。型別選「檔案上傳」＝可上傳檔案/貼截圖；勾「顯示」＝變成表格欄位（公開）；勾「必填」＝計入入職進度。改動立即套用。<br />※「姓名（綽號）」是固定欄位（在人員卡片編輯）；年紀/入職進度等自動算的欄位在最下面「🤖 自動計算欄位」勾選。</div>
            {fields.map((f, idx) => (
              <div key={f.key} draggable={canEdit}
                onDragStart={() => setDragIdx(idx)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => { if (dragIdx == null || dragIdx === idx) return; const arr = [...fields]; const [m] = arr.splice(dragIdx, 1); arr.splice(idx, 0, m); persist({ fields: arr }); setDragIdx(null); }}
                style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "nowrap", background: dragIdx === idx ? "#fbeee6" : "transparent", borderRadius: 8, cursor: "grab" }}>
                <span title="拖曳調整順序（欄位順序＝表格欄位順序）" style={{ color: "#c8bca6", fontSize: 14, cursor: "grab", userSelect: "none", flexShrink: 0 }}>⠿</span>
                <input value={f.label} onChange={e => persist({ fields: fields.map((x, j) => j === idx ? { ...x, label: e.target.value } : x) })} style={{ ...inpS, width: 150, minWidth: 100 }} />
                <select value={f.type} onChange={e => persist({ fields: fields.map((x, j) => j === idx ? { ...x, type: e.target.value } : x) })} style={{ ...inpS, width: 96, flexShrink: 0 }}>
                  <option value="text">文字</option><option value="date">日期</option><option value="select">選單</option><option value="file">檔案上傳</option>
                </select>
                {f.type === "select" && <button onClick={() => setOptField(f.key)} style={{ ...inpS, width: 118, flexShrink: 0, textAlign: "left", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }}>選項({(f.options || []).filter(o => String(o).trim() !== "").length}) ✎</button>}
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: TEXT, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}><input type="checkbox" checked={!!f.show} onChange={e => persist({ fields: fields.map((x, j) => j === idx ? { ...x, show: e.target.checked } : x) })} />顯示</label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: TEXT, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}><input type="checkbox" checked={!!f.req} onChange={e => persist({ fields: fields.map((x, j) => j === idx ? { ...x, req: e.target.checked } : x) })} />必填</label>
                <button onClick={async () => { if (await confirm(`刪除欄位「${f.label}」？（各人此欄資料仍保留，只是不再顯示）`, { confirmLabel: "刪除" })) persist({ fields: fields.filter((_, j) => j !== idx) }); }} style={{ background: "none", border: "none", color: "#9b9384", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>×</button>
              </div>
            ))}
            <button onClick={() => persist({ fields: [...fields, { key: "cf_" + Math.random().toString(36).slice(2, 7), label: "新欄位", type: "text" }] })} style={{ width: "100%", border: `1.5px dashed ${BORDER}`, background: "transparent", color: ACCENT, borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 4 }}>＋ 新增欄位</button>
            {/* 自動計算欄位：不是資料欄位（不用填），系統依現有資料自動算；只決定「表格要不要顯示」 */}
            <div style={{ marginTop: 16, borderTop: `1px dashed ${BORDER}`, paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 2 }}>🤖 自動計算欄位</div>
              <div style={{ fontSize: 11.5, color: SUB, marginBottom: 8 }}>這些不用填、系統自動算出來，所以不在上面的欄位清單；勾選＝顯示在表格。</div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {[["age", "年紀", "由「生日」計算（生日欄要勾顯示才會出現）"], ["prog", "入職進度", "必填欄位完成率"], ["status", "狀態", "在職/離職/留停"], ["docs", "文件", "已上傳文件份數"]].map(([k, l, tip]) => (
                  <label key={k} title={tip} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: TEXT, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!autoCols[k]} onChange={e => persist({ autoCols: { ...autoCols, [k]: e.target.checked } })} />{l}
                    <span style={{ fontSize: 10.5, color: "#c8bca6" }}>ⓘ</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 選項管理：選單型欄位的選項 改名(同步更新所有人資料)/刪除/排序/新增 */}
      {optField && (() => {
        const f = fields.find(x => x.key === optField);
        if (!f) return null;
        const opts = f.options || [];
        const setOpts = (list) => persist({ fields: fields.map(x => x.key === optField ? { ...x, options: list } : x) });
        const usedBy = (o) => people.filter(p => (p[optField] || "") === o && String(o).trim() !== "").length;
        return (
          <div onClick={e => e.target === e.currentTarget && setOptField(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 740, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, width: "min(440px,96vw)", maxHeight: "85vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>✎ 「{f.label}」選項管理</div>
                <div style={{ flex: 1 }} />
                <button onClick={() => setOptField(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: SUB }}>×</button>
              </div>
              <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>改名會同步更新所有夥伴的資料；刪除選項不動已填的人（他們的舊值會保留顯示）。</div>
              {opts.map((o, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <input value={o} placeholder="(空白)" onChange={e => {
                    const nv = e.target.value;
                    persist({
                      fields: fields.map(x => x.key === optField ? { ...x, options: opts.map((y, j) => j === i ? nv : y) } : x),
                      people: String(o).trim() ? people.map(p => p[optField] === o ? { ...p, [optField]: nv } : p) : people,
                    });
                  }} style={{ ...inpS, flex: 1 }} />
                  <span style={{ fontSize: 11, color: SUB, minWidth: 34, textAlign: "right" }}>{usedBy(o) ? `${usedBy(o)}人` : ""}</span>
                  <button title="上移" disabled={i === 0} onClick={() => { const l = [...opts]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setOpts(l); }} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#d9cfbd" : SUB, padding: "4px 7px" }}>↑</button>
                  <button title="下移" disabled={i === opts.length - 1} onClick={() => { const l = [...opts]; [l[i], l[i + 1]] = [l[i + 1], l[i]]; setOpts(l); }} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, cursor: i === opts.length - 1 ? "default" : "pointer", color: i === opts.length - 1 ? "#d9cfbd" : SUB, padding: "4px 7px" }}>↓</button>
                  <button title="刪除選項" onClick={async () => {
                    const n = usedBy(o);
                    if (await confirm(`刪除選項「${o || "(空白)"}」？${n ? `（${n} 人目前填此值，資料不會被改動）` : ""}`, { confirmLabel: "刪除" })) setOpts(opts.filter((_, j) => j !== i));
                  }} style={{ background: "none", border: "none", color: "#b3261e", cursor: "pointer", fontSize: 15 }}>×</button>
                </div>
              ))}
              <button onClick={() => setOpts([...opts, ""])} style={{ width: "100%", border: `1.5px dashed ${BORDER}`, background: "transparent", color: ACCENT, borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 4 }}>＋ 新增選項</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export function CrewRankView() {
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState(null);
  const [quests, setQuests] = useState({ quests: [], progress: [] });
  const [shop, setShop] = useState({ rewards: [], redemptions: [] });
  const [polls, setPolls] = useState({ polls: [], votes: [] });
  useEffect(() => {
    const safety = setTimeout(() => setItems(prev => prev || []), 8000);
    (async () => {
      setPeople(await loadCrewRoster());
      const f = await loadCrewJSON("kb_feedback", { items: [] }); setItems(f.items || []);
      setQuests(await loadCrewJSON("kb_quests", { quests: [], progress: [] }));
      setShop(await loadCrewJSON("kb_shop", { rewards: [], redemptions: [] }));
      setPolls(await loadCrewJSON("kb_polls", { polls: [], votes: [] }));
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);
  if (items === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const bal = crewFullBalance(people, items, quests, shop);
  const stats = Object.values(crewPointStats(items, people)).map(s => ({ ...s, balance: bal[s.id] || 0 }));
  const board = (title, sub, key, unit, color) => {
    const sorted = [...stats].sort((a, b) => b[key] - a[key]).filter(s => s[key] > 0).slice(0, 8);
    const medal = ["🥇", "🥈", "🥉"];
    return (
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{title}</div>
        <div style={{ fontSize: 11.5, color: SUB, marginBottom: 10 }}>{sub}</div>
        {sorted.length === 0 && <div style={{ fontSize: 13, color: "#9b9384", padding: "8px 0" }}>尚無資料</div>}
        {sorted.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: i ? "1px solid #ece4d6" : "none" }}>
            <span style={{ width: 24, textAlign: "center", fontSize: i < 3 ? 16 : 13, color: SUB, fontWeight: 700 }}>{medal[i] || i + 1}</span>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#fbeee6", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.name?.[0] || "?"}</span>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>{s.name}</div><div style={{ fontSize: 11, color: SUB }}>{s.dept}</div></div>
            <span style={{ fontSize: 16, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{s[key]}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> {unit}</span></span>
          </div>
        ))}
      </div>
    );
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>🏆 排行榜</div>
      </div>
      {(() => { const mo = new Date().getMonth() + 1; const bd = people.filter(pp => pp.bday && Number(pp.bday.split("-")[1]) === mo).sort((a, b) => a.bday.slice(8) < b.bday.slice(8) ? -1 : 1); if (!bd.length) return null; return (
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 16px", margin: "10px 0 0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 20 }}>🎂</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>本月壽星</span>
          {bd.map(pp => <span key={pp.id} style={{ fontSize: 12.5, background: "#fbeee6", color: ACCENT, borderRadius: 14, padding: "3px 12px", fontWeight: 600 }}>{pp.nick || pp.name}・{Number(pp.bday.split("-")[1])}/{Number(pp.bday.split("-")[2])}</span>)}
        </div>
      ); })()}
      {(() => { const top = [...stats].sort((a, b) => b.points - a.points)[0]; if (!top || top.points <= 0) return null; return (
        <div style={{ background: "#fff", border: "1.5px solid #c8bca6", borderRadius: 12, padding: "12px 16px", margin: "10px 0 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 28 }}>👑</span>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: SUB, fontWeight: 700 }}>本期回饋王</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{top.name} <span style={{ fontFamily: MONO, fontSize: 15, color: ACCENT }}>{top.points} 分</span></div>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: SUB }}>給出 {top.given} 則・被按幫到我 {top.helpfulGot} 次</span>
        </div>
      ); })()}
      <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>積分＝給回饋×2 ＋ 收到×1 ＋ 你的回饋被按「幫到我」×5。</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {board("🏅 積分王", "總積分（回饋＋闖關－兌換）", "balance", "分", ACCENT)}
        {board("💬 回饋王", "給出最多被肯定（幫到我）的回饋", "helpfulGot", "讚", "#3C8C3C")}
        {board("🌟 人氣王", "收到最多回饋", "received", "則", "#2E6FB0")}
      </div>
      {/* 各項投票王（人物類投票同步進排行榜）*/}
      {(() => {
        const pp = (polls.polls || []).filter(p => p.peoplePoll);
        if (!pp.length) return null;
        const medal = ["🥇", "🥈", "🥉"];
        return (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 10 }}>👑 各項投票王</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {pp.map(poll => {
                const c = {}; poll.options.forEach(o => c[o.id] = 0);
                (polls.votes || []).filter(v => v.pollId === poll.id).forEach(v => { if (c[v.choiceId] != null) c[v.choiceId]++; });
                const ranked = poll.options.map(o => ({ id: o.id, name: people.find(p => p.id === o.id)?.name || o.label, dept: people.find(p => p.id === o.id)?.dept || "", votes: c[o.id] })).filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 6);
                return (
                  <div key={poll.id} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 10 }}>{poll.title}</div>
                    {ranked.length === 0 && <div style={{ fontSize: 13, color: "#9b9384" }}>尚無投票</div>}
                    {ranked.map((s, i) => (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: i ? "1px solid #ece4d6" : "none" }}>
                        <span style={{ width: 24, textAlign: "center", fontSize: i < 3 ? 16 : 13, color: SUB, fontWeight: 700 }}>{medal[i] || i + 1}</span>
                        <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#fbeee6", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.name?.[0] || "?"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>{s.name}</div><div style={{ fontSize: 11, color: SUB }}>{s.dept}</div></div>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#B8860B", fontVariantNumeric: "tabular-nums" }}>{s.votes}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> 票</span></span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}


// ── 獎勵中心：商城＋排行榜合併（2026-07-18 分層重整：兩者同屬「積分激勵」，共用一個入口）──
export function RewardCenterView(props) {
  const [sub, setSub] = useState("shop"); // shop | rank
  const subTab = (k, l) => <button key={k} onClick={() => setSub(k)} style={{ border: `1px solid ${sub === k ? PRIMARY : BORDER}`, background: sub === k ? PRIMARY : "transparent", color: sub === k ? "#fff" : TEXT, borderRadius: 8, padding: "7px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{l}</button>;
  return (
    <div>
      <div style={{ display: "flex", gap: 8, margin: "6px 0 10px", flexWrap: "wrap" }}>{subTab("shop", "🎁 商城")}{subTab("rank", "🏆 排行榜")}</div>
      {sub === "shop" ? <ShopView {...props} /> : <CrewRankView />}
    </div>
  );
}

// ── 今日（夥伴中心首頁）：一進來先看「今天與我有關的事」，不再落在空資料庫 ─────────
// 全部用現有資料組合：訓練(kb_quests)/評鑑(kb_360)/回饋(kb_feedback)/SOP更新(kb_docs)/積分(kb_shop)。
// 排班資訊等排班系統接上真實資料後再加進來（現在還是虛擬資料，不硬塞）。
// 工作日誌類型定義（今日頁快速發文＋工作日誌看板共用；LINE 端 _ddcards.js 同語意）
const JN_KM = {
  note: { ic: "📝", lb: "心得", col: "#5a5247", bg: "#f1ede3" },
  issue: { ic: "⚠️", lb: "問題", col: "#b3261e", bg: "#fdf0ef" },
  improve: { ic: "🔧", lb: "改善", col: "#2c6e3a", bg: "#e8f0e8" },
  help: { ic: "🙋", lb: "求助", col: "#a05c0f", bg: "#fdf3e3" },
};
const JN_SM = { abeach: "A Beach", ground: "GROUN:D" };

export function CrewTodayView({ userName, isAdmin, setView }) {
  const [people, setPeople] = useState([]);
  const [rfields, setRfields] = useState([]); // 名冊欄位定義（入職資料卡算必填進度用）
  const [docs, setDocs] = useState(null);
  const [quests, setQuests] = useState({ quests: [], progress: [] });
  const [r360, setR360] = useState({ reviews: [] });
  const [fb, setFb] = useState({ items: [] });
  const [shop, setShop] = useState({ rewards: [], redemptions: [] });
  const [journal, setJournal] = useState({ items: [] }); // 每日心得（夥伴在 LINE 用「心得 …」記錄）
  const [me, setMe] = useState("");
  const [showLedger, setShowLedger] = useState(false); // 📒 積分存摺
  // 📝 工作日誌快速發文（完整看板在「工作日誌」分頁——張良 2026-08-20：要 Notion/Monday 那種有組織的版面）
  const [jText, setJText] = useState("");
  const [jKind, setJKind] = useState("note");
  const [jStore, setJStore] = useState("");
  useMeSync(people, userName, setMe);
  useEffect(() => {
    const s = setTimeout(() => setDocs(prev => prev || []), 8000);
    (async () => {
      const rd = await loadRosterDoc(); const r = rd.people || []; setPeople(r); setRfields(rd.fields || []); setMe(meFromRoster(r, userName));
      setJournal(await loadCrewJSON("kb_journal", { items: [] }));
      setDocs(await loadCrewJSON("kb_docs", []));
      setQuests(await loadCrewJSON("kb_quests", { quests: [], progress: [] }));
      setR360(await loadCrewJSON("kb_360", { reviews: [] }));
      setFb(await loadCrewJSON("kb_feedback", { items: [] }));
      setShop(await loadCrewJSON("kb_shop", { rewards: [], redemptions: [] }));
    })().finally(() => clearTimeout(s));
    return () => clearTimeout(s);
  }, []);
  if (docs === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;

  const now = new Date();
  const active = people.filter(p => p.status !== "離職");
  const myRole = (people.find(p => p.id === me) || {}).role;
  const canManage = isAdmin || canManageRole(myRole);
  // 我的待辦：未完成訓練關卡、還沒評的夥伴、本週是否給過回饋
  const activeQuests = (quests.quests || []).filter(q => q.active !== false);
  const myPendingQuests = me ? activeQuests.filter(q => !(quests.progress || []).some(p => p.questId === q.id && p.userId === me && p.status === "completed")) : [];
  const myPending360 = me ? active.filter(p => !(r360.reviews || []).some(rv => rv.reviewerId === me && rv.revieweeId === p.id)) : [];
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const fbGivenThisWeek = me ? (fb.items || []).some(it => it.fromId === me && new Date(it.ts) >= monday) : false;
  const myBal = me ? (crewFullBalance(people, fb.items || [], quests, shop)[me] || 0) : null;
  const recentDocs = [...(docs || [])].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 5);
  // 管理者概況：訓練完成率、本週已給回饋人數、待處理兌換
  const questSlots = activeQuests.length * active.length;
  const questDone = (quests.progress || []).filter(p => p.status === "completed" && activeQuests.some(q => q.id === p.questId) && active.some(a2 => a2.id === p.userId)).length;
  const fbGivers = new Set((fb.items || []).filter(it => new Date(it.ts) >= monday).map(it => it.fromId));
  const pendingRedeem = (shop.redemptions || []).filter(r => r.status === "using").length; // 藏寶盒制：待核銷=夥伴按了「使用」的獎品

  const go = (v) => setView && setView(v);
  const num = (n, label, color, onClick) => (
    <div onClick={onClick} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px", cursor: onClick ? "pointer" : "default", flex: 1, minWidth: 120 }}>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, color, lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 3, fontWeight: 500 }}>{label}</div>
    </div>
  );
  const secT = (t, btnLabel, v) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT }}>{t}</div>
      <div style={{ flex: 1 }} />
      {btnLabel && <button onClick={() => go(v)} style={{ border: "none", background: "none", color: ACCENT, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>{btnLabel} →</button>}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>🏠 今日</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{now.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" })}</div>
      </div>
      <div style={{ margin: "8px 0 14px" }}><CrewMe people={people} me={me} /></div>

      {/* 入職資料卡（入職 2.1）：入職中的夥伴一進來就看到「像註冊一樣」的填寫進度與下一步 */}
      {(() => {
        const meP = people.find(p => p.id === me);
        if (!meP?.onboarding) return null;
        const flds = (rfields && rfields.length ? rfields : DEFAULT_ROSTER_FIELDS);
        const req = flds.filter(f => f.req);
        const filled = (f) => f.type === "file" ? (Array.isArray(meP[f.key]) && meP[f.key].length > 0) : String(meP[f.key] ?? "").trim() !== "";
        const missing = req.filter(f => !filled(f)).map(f => f.label);
        const pg = req.length ? Math.round((req.length - missing.length) / req.length * 100) : 100;
        const allDone = missing.length === 0 && !!meP.contractSigned;
        return (
          <div style={{ background: "#fff", border: "1.5px solid #c98a14", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>📋 入職資料卡</div>
              <span style={{ fontSize: 11.5, color: SUB }}>把資料填齊＋簽好契約，店長核准後就正式加入</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, color: pg === 100 ? "#3C8C3C" : "#c98a14" }}>{pg}%</span>
            </div>
            <div style={{ height: 8, background: "#e6ddc9", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}><div style={{ width: pg + "%", height: "100%", background: pg === 100 ? "#3f7d4e" : "#c98a14" }} /></div>
            {missing.length > 0 && <div style={{ fontSize: 12.5, color: "#9b9384", marginBottom: 10 }}>還缺：{missing.slice(0, 5).join("、")}{missing.length > 5 ? `…共 ${missing.length} 項` : ""}</div>}
            {allDone && <div style={{ fontSize: 13, color: "#3C8C3C", fontWeight: 600, marginBottom: 10 }}>✅ 資料齊了！等店長核准就完成入職。</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => { try { localStorage.setItem("pm_open_self_card", meP.id); } catch (_) {} go("roster"); }} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>✍ 去填資料／傳證件</button>
              {meP.contractSigned
                ? <span style={{ alignSelf: "center", fontSize: 12.5, color: "#3C8C3C", fontWeight: 600 }}>✍ 勞動契約已簽（{String(meP.contractSigned).slice(0, 10)}）</span>
                : meP.signToken && <button onClick={() => window.open(`/api/onboard?action=sign&t=${encodeURIComponent(meP.signToken)}`, "_blank")} style={{ border: `1.5px solid ${ACCENT}`, background: "#fff", color: ACCENT, borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>📜 閱讀＋簽署勞動契約</button>}
            </div>
          </div>
        );
      })()}

      {/* 摘要數字卡：今天跟我有關的事一眼看完 */}
      {me && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {num(myPendingQuests.length, "待完成訓練", myPendingQuests.length ? ACCENT : "#3C8C3C", () => go("quest"))}
          {num(myPending360.length, "待回覆評鑑", myPending360.length ? "#C2872E" : "#3C8C3C", () => go("r360"))}
          {num(fbGivenThisWeek ? "✓" : "0", "本週給出回饋", fbGivenThisWeek ? "#3C8C3C" : "#b3261e", () => go("fb"))}
          {num(myBal, "我的積分 📒", ACCENT, () => setShowLedger(true))}
        </div>
      )}
      {!fbGivenThisWeek && me && (
        <div style={{ background: "#FFF7ED", border: "1.5px solid #c98a14", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#7a5410", fontWeight: 600 }}>⏰ 本週還沒給出回饋——花 30 秒鼓勵一位夥伴。</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => go("fb")} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>去給回饋 ＋2分</button>
        </div>
      )}

      {/* 📝 工作日誌快速入口（張良 2026-08-20：完整版＝「工作日誌」分頁的 Notion/Monday 式看板；今日頁只留快速記＋未解決提示） */}
      {(() => {
        const items = journal.items || [];
        const meP = people.find(p => p.id === me);
        const postJournal = () => {
          if (!meP || !jText.trim()) return;
          const item = { id: "jn-" + Math.random().toString(36).slice(2, 8), personId: me, name: meP.name, text: jText.trim().slice(0, 500), ts: new Date().toISOString(), via: "web", kind: jKind, store: jStore || null, likes: [], photos: [], ...(jKind === "help" || jKind === "issue" ? { status: "open" } : {}) };
          const n = { ...journal, items: [item, ...items].slice(0, 1000) };
          setJournal(n); saveCrewJSON("kb_journal", n); setJText("");
        };
        const openCnt = items.filter(i => (i.kind === "help" || i.kind === "issue") && i.status !== "solved").length;
        const sel = { border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 8px", fontSize: 12.5, background: "#fff", color: TEXT };
        return (
          <div style={{ ...crewCard, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT }}>📝 工作日誌</div>
              <span style={{ fontSize: 11.5, color: SUB }}>今天遇到什麼、改了什麼、需要誰幫忙——記一句就好</span>
              {openCnt > 0 && <span onClick={() => go("cjournal")} style={{ fontSize: 11.5, fontWeight: 800, color: "#b3261e", background: "#fdf0ef", borderRadius: 10, padding: "2px 10px", cursor: "pointer" }}>⏳ {openCnt} 件未結案</span>}
              <div style={{ flex: 1 }} />
              <button onClick={() => go("cjournal")} style={{ border: "none", background: "none", color: ACCENT, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>開日誌看板 →</button>
            </div>
            {meP ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select value={jKind} onChange={e => setJKind(e.target.value)} style={sel}>
                  {Object.entries(JN_KM).map(([k, m]) => <option key={k} value={k}>{m.ic} {m.lb}</option>)}
                </select>
                <select value={jStore} onChange={e => setJStore(e.target.value)} style={sel}>
                  <option value="">通用（兩店）</option><option value="abeach">A Beach</option><option value="ground">GROUN:D</option>
                </select>
                <input value={jText} onChange={e => setJText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") postJournal(); }} placeholder="例：組裝漢堡發現奶油滾輪不好用（麵包不平），改用刷子" style={{ ...sel, flex: 1, minWidth: 200 }} />
                <button onClick={postJournal} disabled={!jText.trim()} style={{ border: "none", background: jText.trim() ? ACCENT : BORDER, color: "#fff", borderRadius: 8, padding: "7px 16px", fontSize: 12.5, fontWeight: 700, cursor: jText.trim() ? "pointer" : "default" }}>送出</button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: SUB }}>綁定夥伴身分後可以在這裡發日誌；也可以在 LINE 對 DD 說「日誌 …」（私訊或群組都行，15 分鐘內傳照片自動附上）。</div>
            )}
          </div>
        );
      })()}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 12 }}>
        {/* 待完成訓練 */}
        {me && (
          <div style={crewCard}>
            {secT("🎯 待完成訓練", "去闖關", "quest")}
            {myPendingQuests.length === 0 && <div style={{ fontSize: 13, color: "#3C8C3C" }}>✓ 目前的訓練關卡都完成了</div>}
            {myPendingQuests.slice(0, 5).map(q => (
              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #ece4d6", fontSize: 13.5 }}>
                <span style={{ color: TEXT, fontWeight: 600 }}>{q.title}</span><div style={{ flex: 1 }} /><span style={{ color: ACCENT, fontWeight: 700 }}>+{q.points}</span>
              </div>
            ))}
            {myPendingQuests.length > 5 && <div style={{ fontSize: 12, color: SUB, marginTop: 4 }}>…還有 {myPendingQuests.length - 5} 關</div>}
          </div>
        )}
        {/* 待回覆評鑑 */}
        {me && myPending360.length > 0 && (
          <div style={crewCard}>
            {secT("⭐ 待回覆評鑑", "去評鑑", "r360")}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {myPending360.slice(0, 10).map(p => <span key={p.id} style={{ fontSize: 12.5, background: "#fbeee6", color: "#92400e", borderRadius: 14, padding: "3px 12px", fontWeight: 600 }}>{p.nick || p.name}</span>)}
              {myPending360.length > 10 && <span style={{ fontSize: 12, color: SUB, alignSelf: "center" }}>…共 {myPending360.length} 位</span>}
            </div>
          </div>
        )}
        {/* 最新 SOP / 公告更新 */}
        <div style={crewCard}>
          {secT("📚 SOP・公告最新更新", "看全部", "kb")}
          {recentDocs.length === 0 && <div style={{ fontSize: 13, color: "#9b9384" }}>知識庫還沒有內容。</div>}
          {recentDocs.map(d => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #ece4d6", fontSize: 13 }}>
              <span style={{ background: "#fbeee6", color: "#92400e", borderRadius: 8, padding: "1px 7px", fontSize: 11, flexShrink: 0 }}>{kbDims(d).aud}</span>
              <span style={{ background: "#ece4d6", color: "#4A4234", borderRadius: 8, padding: "1px 7px", fontSize: 11, flexShrink: 0 }}>{kbDims(d).dtype}</span>
              <span style={{ color: TEXT, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "#C8BCA0", flexShrink: 0 }}>{d.updatedAt ? new Date(d.updatedAt).toLocaleDateString("zh-TW") : ""}</span>
            </div>
          ))}
        </div>
        {/* 管理者概況（組長以上） */}
        {canManage && (() => {
          const monday2 = new Date(now); monday2.setHours(0, 0, 0, 0); monday2.setDate(now.getDate() - ((now.getDay() + 6) % 7));
          const wkJournal = (journal.items || []).filter(i => new Date(i.ts) >= monday2);
          return (
          <div style={{ ...crewCard, border: "1.5px solid #c8bca6" }}>
            {secT("👔 團隊概況（管理）", null, null)}
            <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 13.5 }}>
              <div style={{ display: "flex" }}><span style={{ color: SUB }}>訓練完成率</span><div style={{ flex: 1 }} /><span style={{ fontFamily: MONO, fontWeight: 700, color: TEXT }}>{questSlots ? Math.round(questDone / questSlots * 100) + "%" : "—"}<span style={{ color: SUB, fontWeight: 400, fontSize: 11.5 }}>（{questDone}/{questSlots || 0}）</span></span></div>
              <div style={{ display: "flex" }}><span style={{ color: SUB }}>本週已給回饋</span><div style={{ flex: 1 }} /><span style={{ fontFamily: MONO, fontWeight: 700, color: TEXT }}>{fbGivers.size}<span style={{ color: SUB, fontWeight: 400, fontSize: 11.5 }}>／{active.length} 人</span></span></div>
              <div style={{ display: "flex", cursor: "pointer" }} onClick={() => go("reward")}><span style={{ color: SUB }}>待核銷獎品</span><div style={{ flex: 1 }} /><span style={{ fontFamily: MONO, fontWeight: 700, color: pendingRedeem ? ACCENT : TEXT }}>{pendingRedeem} 筆 →</span></div>
              <div style={{ display: "flex" }}><span style={{ color: SUB }}>本週夥伴心得</span><div style={{ flex: 1 }} /><span style={{ fontFamily: MONO, fontWeight: 700, color: TEXT }}>{wkJournal.length} 則</span></div>
              {wkJournal.slice(0, 3).map(i => (
                <div key={i.id} style={{ fontSize: 12, color: SUB, background: "#FBF7EE", borderRadius: 8, padding: "6px 10px", lineHeight: 1.5 }}>💬 <b style={{ color: TEXT }}>{i.name}</b>：{(i.text || "").slice(0, 42)}{(i.text || "").length > 42 ? "…" : ""}</div>
              ))}
              {wkJournal.length === 0 && <div style={{ fontSize: 11.5, color: "#9b9384" }}>夥伴在 LINE 對 DD 說「日誌 …」（私訊或群組都行）就會記錄到上面的工作日誌（也可對 DD 說「推播心得提醒」邀大家寫）</div>}
            </div>
          </div>
          );
        })()}
      </div>
      {showLedger && me && <PointsLedgerModal me={me} people={people} fbItems={fb.items || []} quests={quests} shop={shop} onClose={() => setShowLedger(false)} />}
      {!me && <div style={{ marginTop: 14, fontSize: 13, color: SUB, background: `#fff`, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>登入並綁定夥伴身分後，這裡會顯示你的待完成訓練、待回覆評鑑與積分。</div>}
    </div>
  );
}

// ── 📝 工作日誌看板（張良 2026-08-20：不要流水帳，要 Notion/Monday 式有組織的版面——誰/分類/追蹤一眼看清）──
// 資料同 kb_journal 一份（LINE「日誌 …」與今日頁快速發文都進這裡）；問題/求助有狀態欄可追蹤到結案
export function JournalBoardView({ userName, isAdmin, confirm }) {
  const [journal, setJournal] = useState({ items: [] });
  const [people, setPeople] = useState([]);
  const [me, setMe] = useState("");
  const [grp, setGrp] = useState("time");      // 分組：time=依時間 kind=依類型 person=依夥伴 store=依店別
  const [fStore, setFStore] = useState("all"); // 店別篩選
  const [fOpen, setFOpen] = useState(false);   // 只看未結案
  const [q, setQ] = useState("");              // 搜尋（內容/人名）
  const [days, setDays] = useState(14);        // 期間：近 N 天
  const [nText, setNText] = useState(""); const [nKind, setNKind] = useState("note"); const [nStore, setNStore] = useState("");
  useMeSync(people, userName, setMe);
  useEffect(() => { (async () => {
    const rd = await loadRosterDoc(); const r = rd.people || []; setPeople(r); setMe(meFromRoster(r, userName));
    setJournal(await loadCrewJSON("kb_journal", { items: [] }));
  })(); }, []);
  const items = journal.items || [];
  const persist = (n) => { setJournal(n); saveCrewJSON("kb_journal", n); };
  const meP = people.find(p => p.id === me);
  const myRole = (meP || {}).role;
  const canManage = isAdmin || canManageRole(myRole);
  const trackable = (i) => i.kind === "help" || i.kind === "issue";
  const isOpen = (i) => trackable(i) && i.status !== "solved";

  // 期間 + 篩選 + 搜尋
  const since = Date.now() - days * 86400000;
  const kw = q.trim().toLowerCase();
  const shown = items
    .filter(i => new Date(i.ts).getTime() >= since || isOpen(i)) // 未結案不受期間限制——追蹤到結案為止
    .filter(i => fStore === "all" || (fStore === "none" ? !i.store : i.store === fStore))
    .filter(i => !fOpen || isOpen(i))
    .filter(i => !kw || (i.text || "").toLowerCase().includes(kw) || (i.name || "").includes(q.trim()));

  // 統計（Monday 式數字卡）：本週則數/未結案/改善數/參與人數
  const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const wk = items.filter(i => new Date(i.ts) >= monday);
  const openAll = items.filter(isOpen);
  const stats = [
    ["本週日誌", wk.length, ACCENT],
    ["⏳ 未結案（問題+求助）", openAll.length, openAll.length ? "#b3261e" : "#3C8C3C"],
    ["🔧 本週改善", wk.filter(i => i.kind === "improve").length, "#2c6e3a"],
    ["👥 本週參與", new Set(wk.map(i => i.personId)).size + "／" + people.filter(p => p.status !== "離職").length, "#4A4234"],
  ];

  // 分組（Monday groups）：時間=依日期、其餘依維度；組內新到舊
  const sorted = [...shown].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const groups = (() => {
    if (grp === "kind") return Object.keys(JN_KM).map(k => [JN_KM[k].ic + " " + JN_KM[k].lb, sorted.filter(i => (i.kind || "note") === k), JN_KM[k]]).filter(g => g[1].length);
    if (grp === "person") { const ns = [...new Set(sorted.map(i => i.name))]; return ns.map(n => ["👤 " + n, sorted.filter(i => i.name === n), null]); }
    if (grp === "store") return [["🏖 A Beach", sorted.filter(i => i.store === "abeach"), null], ["🍕 GROUN:D", sorted.filter(i => i.store === "ground"), null], ["🏢 通用（兩店）", sorted.filter(i => !i.store), null]].filter(g => g[1].length);
    const ds = [...new Set(sorted.map(i => (i.ts || "").slice(0, 10)))];
    return ds.map(d => [`${d.slice(5)}（${["日", "一", "二", "三", "四", "五", "六"][new Date(d + "T00:00:00").getDay()]}）`, sorted.filter(i => (i.ts || "").slice(0, 10) === d), null]);
  })();

  const post = () => {
    if (!meP || !nText.trim()) return;
    const item = { id: "jn-" + Math.random().toString(36).slice(2, 8), personId: me, name: meP.name, text: nText.trim().slice(0, 500), ts: new Date().toISOString(), via: "web", kind: nKind, store: nStore || null, likes: [], photos: [], ...(nKind === "help" || nKind === "issue" ? { status: "open" } : {}) };
    persist({ ...journal, items: [item, ...items].slice(0, 1000) }); setNText("");
  };
  const like = (id) => { if (!me) return; persist({ ...journal, items: items.map(i => i.id === id ? { ...i, likes: (i.likes || []).includes(me) ? (i.likes || []).filter(x => x !== me) : [...(i.likes || []), me] } : i) }); };
  const toggle = (id) => { if (!me) return; persist({ ...journal, items: items.map(i => i.id === id ? (i.status === "solved" ? { ...i, status: "open", solvedBy: undefined, solvedAt: undefined } : { ...i, status: "solved", solvedBy: meP?.name || "", solvedAt: new Date().toISOString() }) : i) }); };
  const del = async (it) => { if (!(canManage || it.personId === me)) return; if (confirm && !(await confirm(`刪除這則日誌？\n${it.name}：${(it.text || "").slice(0, 40)}`))) return; persist({ ...journal, items: items.filter(i => i.id !== it.id) }); };

  const chip = (label, on, onClick) => <button key={label} onClick={onClick} style={{ border: `1.5px solid ${on ? ACCENT : BORDER}`, background: on ? ACCENT : "#fff", color: on ? "#fff" : SUB, borderRadius: 13, padding: "3px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{label}</button>;
  const sel = { border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 8px", fontSize: 12.5, background: "#fff", color: TEXT };
  const td = { border: "1px solid #e5dcc8", padding: "7px 9px", fontSize: 12.5, verticalAlign: "top", color: TEXT }; // 硬格線（管理頁慣例）
  const th = { ...td, background: "#f4efe5", fontWeight: 700, color: SUB, fontSize: 11.5, whiteSpace: "nowrap", textAlign: "left" };
  const tag = (txt2, col, bg) => <span style={{ display: "inline-block", fontSize: 11, fontWeight: 800, color: col, background: bg, borderRadius: 8, padding: "1px 8px", whiteSpace: "nowrap" }}>{txt2}</span>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>📝 工作日誌</div>
        <span style={{ fontSize: 12.5, color: SUB }}>每天的執行問題・改的做法・要幫忙的事——全店看得見、追蹤到結案</span>
      </div>
      {/* 統計列 */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "10px 0 12px" }}>
        {stats.map(([lb, v, col]) => (
          <div key={lb} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 14px", flex: 1, minWidth: 130 }}>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: col, lineHeight: 1.1 }}>{v}</div>
            <div style={{ fontSize: 11, color: SUB, marginTop: 3, fontWeight: 500 }}>{lb}</div>
          </div>
        ))}
      </div>
      {/* 工具列：分組/篩選/搜尋/期間 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <select value={grp} onChange={e => setGrp(e.target.value)} style={sel}>
          <option value="time">分組：依日期</option><option value="kind">分組：依類型</option><option value="person">分組：依夥伴</option><option value="store">分組：依店別</option>
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={sel}>
          {[7, 14, 30, 90].map(d => <option key={d} value={d}>近 {d} 天</option>)}
        </select>
        {chip("全部", fStore === "all", () => setFStore("all"))}
        {chip("A Beach", fStore === "abeach", () => setFStore(fStore === "abeach" ? "all" : "abeach"))}
        {chip("GROUN:D", fStore === "ground", () => setFStore(fStore === "ground" ? "all" : "ground"))}
        {chip(`⏳ 只看未結案${openAll.length ? `(${openAll.length})` : ""}`, fOpen, () => setFOpen(!fOpen))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 搜內容或人名" style={{ ...sel, minWidth: 150 }} />
      </div>
      {/* 新增列（Notion 式 composer） */}
      {meP ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 10 }}>
          <select value={nKind} onChange={e => setNKind(e.target.value)} style={sel}>
            {Object.entries(JN_KM).map(([k, m]) => <option key={k} value={k}>{m.ic} {m.lb}</option>)}
          </select>
          <select value={nStore} onChange={e => setNStore(e.target.value)} style={sel}>
            <option value="">通用（兩店）</option><option value="abeach">A Beach</option><option value="ground">GROUN:D</option>
          </select>
          <input value={nText} onChange={e => setNText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") post(); }} placeholder="＋ 記一則：今天遇到什麼、改了什麼、需要誰幫忙" style={{ ...sel, flex: 1, minWidth: 220 }} />
          <button onClick={post} disabled={!nText.trim()} style={{ border: "none", background: nText.trim() ? ACCENT : BORDER, color: "#fff", borderRadius: 8, padding: "7px 16px", fontSize: 12.5, fontWeight: 700, cursor: nText.trim() ? "pointer" : "default" }}>新增</button>
          <div style={{ flexBasis: "100%", fontSize: 11, color: "#9b9384" }}>LINE 也能記：對 DD 說「日誌 [問題/改善/求助] [AB/GD] 內容」（私訊或群組），15 分鐘內傳照片自動附上。</div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: SUB, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>綁定夥伴身分後可在這裡新增；或在 LINE 對 DD 說「日誌 …」。</div>
      )}
      {/* 表格（硬格線；分組色帶） */}
      <div style={{ overflowX: "auto", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead><tr>
            <th style={{ ...th, width: 92 }}>日期</th><th style={{ ...th, width: 80 }}>夥伴</th><th style={{ ...th, width: 64 }}>類型</th><th style={{ ...th, width: 76 }}>店別</th>
            <th style={th}>內容・照片</th><th style={{ ...th, width: 120 }}>狀態（追蹤）</th><th style={{ ...th, width: 86 }}>👍 有用</th><th style={{ ...th, width: 40 }}></th>
          </tr></thead>
          <tbody>
            {groups.length === 0 && <tr><td colSpan={8} style={{ ...td, color: "#9b9384", textAlign: "center", padding: 20 }}>這個範圍沒有日誌。調整期間/篩選，或上面記第一則。</td></tr>}
            {groups.flatMap(([gLabel, gItems, gMeta]) => [
              <tr key={"g-" + gLabel}><td colSpan={8} style={{ ...td, background: gMeta ? gMeta.bg : "#ece4d6", fontWeight: 800, fontSize: 12, color: gMeta ? gMeta.col : "#4A4234" }}>{gLabel}　<span style={{ fontWeight: 600, color: SUB }}>{gItems.length} 則</span></td></tr>,
              ...gItems.map(i => {
                const m = JN_KM[i.kind] || JN_KM.note;
                const liked = (i.likes || []).includes(me);
                return (
                  <tr key={i.id}>
                    <td style={{ ...td, fontFamily: MONO, fontSize: 11.5, whiteSpace: "nowrap", color: SUB }}>{(i.ts || "").slice(5, 10)}<br />{new Date(i.ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}{i.via === "line-group" ? " 💬" : i.via === "line" ? " 📱" : ""}</td>
                    <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{i.name}</td>
                    <td style={td}>{tag(`${m.ic} ${m.lb}`, m.col, m.bg)}</td>
                    <td style={td}>{i.store ? tag(JN_SM[i.store], i.store === "ground" ? "#92400e" : "#2c5a38", i.store === "ground" ? "#fbeee6" : "#e8f0e8") : <span style={{ fontSize: 11, color: "#C8BCA0" }}>通用</span>}</td>
                    <td style={{ ...td, lineHeight: 1.6 }}>
                      {i.text}
                      {(i.photos || []).length > 0 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>{i.photos.map((u, pi) => <a key={pi} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: `1px solid ${BORDER}` }} /></a>)}</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {!trackable(i) ? <span style={{ fontSize: 11, color: "#C8BCA0" }}>—（純紀錄）</span> : i.status === "solved" ? (
                        <div>{tag(i.kind === "help" ? "✅ 已解決" : "✅ 已處理", "#2c6e3a", "#e8f0e8")}<div style={{ fontSize: 10.5, color: SUB, marginTop: 2 }}>{i.solvedBy}{i.solvedAt ? `・${(i.solvedAt || "").slice(5, 10)}` : ""}</div>{me && <button onClick={() => toggle(i.id)} style={{ border: "none", background: "none", color: "#C8BCA0", fontSize: 10.5, cursor: "pointer", padding: 0 }}>↩ 還原</button>}</div>
                      ) : (
                        <div>{tag(i.kind === "help" ? "⏳ 等人幫忙" : "⏳ 待處理", "#b3261e", "#fdf0ef")}{me && <div><button onClick={() => toggle(i.id)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: "#2c6e3a", borderRadius: 8, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", marginTop: 4 }}>✓ 結案</button></div>}</div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <button onClick={() => like(i.id)} style={{ border: `1px solid ${liked ? ACCENT : BORDER}`, background: liked ? "#fbeee6" : "#fff", color: liked ? ACCENT : SUB, borderRadius: 8, padding: "2px 10px", fontSize: 11, fontWeight: 700, cursor: me ? "pointer" : "default" }}>👍{(i.likes || []).length ? ` ${(i.likes || []).length}` : ""}</button>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>{(canManage || i.personId === me) && <span onClick={() => del(i)} title="刪除" style={{ cursor: "pointer", color: "#C8BCA0", fontSize: 13 }}>✕</span>}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "#9b9384", marginTop: 8 }}>狀態欄：問題/求助＝可追蹤（⏳→✓結案記名）；心得/改善＝純紀錄。未結案的不受「近 N 天」限制，會一直顯示到結案。📱＝LINE 私訊記的、💬＝LINE 群組記的。</div>
    </div>
  );
}

// ── 出勤打卡（P1，張良 2026-07-22）：店內 iPad 開「打卡站」顯示動態 QR（30秒換、HMAC簽章、不用GPS），
// 夥伴手機相機掃 → 帶 ?pt= 開 App → 自動打卡；相機壞掉備援＝LINE 對 DD 打「上班/下班」（負責人在這裡審核）。
// 出勤＝法定紀錄：逐筆一筆一檔 sp_crew_pch_*、記到分鐘、永久保存。
const pchDayKey = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(d).replace(/-/g, "");
const pchHHMM = (t) => new Date(t).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" });
async function loadPunchDays(days) { // 近 N 天全部打卡（依日期前綴撈）
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const map = await getSharedPrefix(`sp_crew_pch_${pchDayKey(d)}_`);
    Object.entries(map).forEach(([k, v]) => { try { out.push({ key: k, day: pchDayKey(d), ...JSON.parse(v) } ); } catch (_) {} });
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}
const pairHours = (recs) => { let ms = 0; for (let i = 0; i < recs.length; i += 2) if (recs[i]?.dir === "in" && recs[i + 1]?.dir === "out") ms += new Date(recs[i + 1].ts) - new Date(recs[i].ts); return Math.round(ms / 360000) / 10; };

export function PunchView({ me: account, userName }) {
  const [people, setPeople] = useState([]);
  const [meId, setMeId] = useState("");
  const [recs, setRecs] = useState(null); // 近7天全部
  const [station, setStation] = useState(false); // 打卡站全螢幕
  const [qrErr, setQrErr] = useState("");
  const [punchMsg, setPunchMsg] = useState(null); // 掃碼進來的打卡結果
  const canvasRef = useRef(null);
  useMeSync(people, userName, setMeId);
  const mgr = account?.role === "admin" || account?.role === "manager";
  const [shiftDocs, setShiftDocs] = useState(null); // {staffById, shiftById, assignments} 今日班表（P2 比對用）
  const reload = async () => setRecs(await loadPunchDays(7));
  useEffect(() => { (async () => {
    const rd = await loadRosterDoc(); setPeople(rd.people || []); setMeId(meFromRoster(rd.people || [], userName)); await reload();
    // P2：載入本週班表＋班別定義（沒發布＝比對區顯示提示）
    try {
      const todayISO = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
      const [sd, td, sc] = await Promise.all([
        window.storage.get(K("shift_staff"), true), window.storage.get(K("shift_templates"), true), window.storage.get(K(schedKey("abeach", mondayOf(todayISO))), true),
      ]);
      const staff = sd?.value ? (JSON.parse(sd.value).staff || []) : [];
      const shifts = td?.value ? (JSON.parse(td.value).shifts || []) : [];
      const assignments = sc?.value ? ((JSON.parse(sc.value).assignments || []).filter(a => a.date === todayISO)) : [];
      setShiftDocs({ staffById: Object.fromEntries(staff.map(s => [s.id, s])), shiftById: Object.fromEntries(shifts.map(s => [s.id, s])), assignments, todayISO });
    } catch (_) { setShiftDocs({ staffById: {}, shiftById: {}, assignments: [], todayISO: "" }); }
  })(); }, []);

  // 掃碼深連結：App.jsx 把 ?pt= 存進 sessionStorage 後切到本頁 → 自動打卡
  useEffect(() => {
    (async () => {
      let pt = ""; try { pt = sessionStorage.getItem("pm_punch_token") || ""; sessionStorage.removeItem("pm_punch_token"); } catch (_) {}
      if (!pt) return;
      setPunchMsg({ busy: true });
      try {
        const t = await authToken();
        const r = await fetch("/api/punch?action=punch", { method: "POST", headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ token: pt }) });
        const d = await r.json();
        setPunchMsg(d.ok ? { ok: true, ...d } : { error: d.error || "打卡失敗" });
        if (d.ok) reload();
      } catch (_) { setPunchMsg({ error: "網路異常，請重掃一次" }); }
    })();
  }, []);
  const fixLast = async () => {
    try { const t = await authToken(); const r = await fetch("/api/punch?action=fix", { method: "POST", headers: { Authorization: `Bearer ${t}` } }); const d = await r.json(); if (d.ok) { setPunchMsg(m => ({ ...m, dir: d.dir, fixed: true })); reload(); } else alert(d.error); } catch (_) {}
  };

  // 打卡站：每 28 秒抓新 token 畫 QR
  useEffect(() => {
    if (!station) return;
    let alive = true;
    const draw = async () => {
      try {
        const t = await authToken();
        const r = await fetch("/api/punch?action=token", { headers: { Authorization: `Bearer ${t}` } });
        const d = await r.json();
        if (!alive) return;
        if (!d.token) { setQrErr(d.error || "取得 QR 失敗"); return; }
        setQrErr("");
        const url = `${window.location.origin}/?pt=${encodeURIComponent(d.token)}`;
        if (canvasRef.current) await QRCode.toCanvas(canvasRef.current, url, { width: Math.min(520, window.innerWidth - 80), margin: 1, color: { dark: "#211C15", light: "#ffffff" } });
      } catch (_) { if (alive) setQrErr("網路異常，重試中…"); }
    };
    draw();
    const iv = setInterval(draw, 28000);
    return () => { alive = false; clearInterval(iv); };
  }, [station]);

  if (recs === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const today = pchDayKey();
  const mine = recs.filter(r => r.personId === meId);
  const mineToday = mine.filter(r => r.day === today);
  const pendingLine = recs.filter(r => r.src === "line" && !r.verified);
  const verify = async (r, ok) => {
    try { const t = await authToken(); const res = await fetch("/api/punch?action=verify", { method: "POST", headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ recordId: r.key, ok }) }); const d = await res.json(); if (!d.ok) alert(d.error); else { try { auditLog("編輯", `${ok ? "核可" : "刪除"} ${r.name} 的LINE打卡`); } catch (_) {} reload(); } } catch (_) { alert("操作失敗"); }
  };
  const nameOf2 = (id) => (people.find(p => p.id === id) || {}).name || "—";
  // 今日各人狀態（管理者總覽）
  const byPerson = {};
  recs.filter(r => r.day === today).forEach(r => { (byPerson[r.personId] = byPerson[r.personId] || []).push(r); });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>⏱ 出勤打卡</div>
        <span style={{ fontSize: 12.5, color: SUB }}>掃店內打卡站 QR 打卡；掃不了時 LINE 跟 DD 說「上班」「下班」（需負責人審核）</span>
        <div style={{ flex: 1 }} />
        {mgr && <button onClick={() => setStation(true)} style={{ border: "none", background: PRIMARY, color: "#fff", borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>🖥 開啟打卡站（iPad 放這頁）</button>}
      </div>

      {/* 掃碼打卡結果 */}
      {punchMsg && (
        <div style={{ ...crewCard, border: `2px solid ${punchMsg.ok ? "#3C8C3C" : punchMsg.busy ? BORDER : "#b3261e"}`, textAlign: "center", padding: 22 }}>
          {punchMsg.busy ? <div style={{ fontSize: 15, color: SUB }}>打卡中…</div> : punchMsg.ok ? (<>
            <div style={{ fontSize: 34 }}>{punchMsg.dir === "in" ? "🟢" : "🔴"}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, margin: "4px 0" }}>{punchMsg.name}｜{punchMsg.dir === "in" ? "上班" : "下班"}打卡成功</div>
            <div style={{ fontSize: 14, color: SUB }}>{pchHHMM(punchMsg.ts)}・今日累計 {punchMsg.todayHours} 小時</div>
            {!punchMsg.fixed && <button onClick={fixLast} style={{ marginTop: 10, border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, cursor: "pointer" }}>打錯了？改成{punchMsg.dir === "in" ? "下班" : "上班"}（5分鐘內）</button>}
          </>) : <div style={{ fontSize: 15, fontWeight: 700, color: "#b3261e" }}>{punchMsg.error}</div>}
        </div>
      )}

      {/* 負責人：LINE 備援打卡待審核 */}
      {mgr && pendingLine.length > 0 && (
        <div style={{ ...crewCard, border: "1.5px solid #c98a14" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>⚠ LINE 備援打卡待審核<span style={{ marginLeft: 6, fontSize: 11, background: ACCENT, color: "#fff", borderRadius: 10, padding: "1px 8px", fontWeight: 700 }}>{pendingLine.length}</span></div>
          {pendingLine.map(r => (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, padding: "6px 0", borderTop: "1px solid #ece4d6", flexWrap: "wrap" }}>
              <b>{r.name}</b><span>{r.dir === "in" ? "上班" : "下班"} {r.day.slice(4, 6)}/{r.day.slice(6)} {pchHHMM(r.ts)}</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => verify(r, false)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: "#b3261e", borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>刪除</button>
              <button onClick={() => verify(r, true)} style={{ border: "none", background: "#3C8C3C", color: "#fff", borderRadius: 8, padding: "5px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>✅ 核可</button>
            </div>
          ))}
        </div>
      )}

      {/* 我的出勤 */}
      <div style={crewCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT }}>我的出勤</div>
          <span style={{ fontSize: 12, color: SUB }}>今日 {pairHours(mineToday)} 小時・近7天 {pairHours(mine)} 小時</span>
        </div>
        {mine.length === 0 && <div style={{ fontSize: 13, color: "#9b9384" }}>還沒有打卡紀錄。到店掃打卡站 QR 開始第一筆！</div>}
        {[...new Set(mine.map(r => r.day))].sort().reverse().slice(0, 7).map(d => { const list = mine.filter(r => r.day === d); return (
          <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0", borderTop: "1px solid #ece4d6", flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: TEXT, width: 52 }}>{d.slice(4, 6)}/{d.slice(6)}</span>
            {list.map(r => <span key={r.key} style={{ background: r.dir === "in" ? "#eef5ef" : "#fbeee6", color: r.dir === "in" ? "#3f7d4e" : ACCENT, borderRadius: 8, padding: "2px 9px", fontSize: 12 }}>{r.dir === "in" ? "上" : "下"} {pchHHMM(r.ts)}{r.src === "line" && <span style={{ color: r.verified ? "#3f7d4e" : "#c98a14" }}>{r.verified ? " ✓" : " 待審"}</span>}</span>)}
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700 }}>{pairHours(list)}h</span>
          </div>
        ); })}
      </div>

      {/* P2：今日班表比對（App 與 D哥 同一套 attendance.js 演算法；寬限5分鐘） */}
      {(() => {
        if (!shiftDocs) return null;
        const punchesToday = recs.filter(r => r.day === today).map(r => ({ personId: r.personId, name: r.name, dir: r.dir, ts: r.ts }));
        if (!shiftDocs.assignments.length) {
          return mgr ? <div style={{ ...crewCard, fontSize: 12.5, color: "#9b9384" }}>📋 班表比對：本週尚無發布班表——排班頁發布真實班表後，這裡會自動顯示每個人「準時/遲到/未到/早退」。</div> : null;
        }
        const now = new Date(); const tstr = now.toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Taipei" });
        const nowMin = Number(tstr.slice(0, 2)) * 60 + Number(tstr.slice(3, 5));
        const rows = compareDay({ date: shiftDocs.todayISO, assignments: shiftDocs.assignments, staffById: shiftDocs.staffById, shiftById: shiftDocs.shiftById, punches: punchesToday, nowMin });
        const show = mgr ? rows : rows.filter(r => r.rosterId === meId);
        if (!show.length) return null;
        const color = { done: "#3f7d4e", working: "#2E6FB0", late: "#b3261e", early: "#C2872E", absent: "#b3261e", pending: "#9b9384", extra: "#8d4fa8", ontime: "#3f7d4e" };
        const sum = summarize(rows);
        return (
          <div style={{ ...crewCard, border: sum.bad.length && mgr ? "1.5px solid #c98a14" : `1px solid ${BORDER}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT }}>📋 今日班表比對</div>
              <span style={{ fontSize: 11.5, color: SUB }}>遲到寬限 5 分鐘</span>
              {mgr && sum.bad.length > 0 && <span style={{ fontSize: 11, background: "#FEF2F2", color: "#b3261e", border: "1px solid #FECACA", borderRadius: 8, padding: "1px 8px", fontWeight: 700 }}>異常 {sum.bad.length}</span>}
            </div>
            {show.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0", borderTop: "1px solid #ece4d6", flexWrap: "wrap" }}>
                <b style={{ width: 70 }}>{r.name}</b>
                <span style={{ fontSize: 12, color: SUB }}>{r.shiftCode || "未排班"}{r.planIn ? ` ${r.planIn}-${r.planOut}` : ""}</span>
                <span style={{ fontSize: 12, color: SUB }}>實到 {r.firstIn || "—"}{r.lastOut ? `~${r.lastOut}` : ""}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: color[r.status] || SUB, borderRadius: 9, padding: "2px 10px" }}>{ATT_LABEL[r.status]}{r.lateMin ? ` ${r.lateMin}分` : r.earlyMin ? ` ${r.earlyMin}分` : ""}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* 管理者：今日全店出勤 */}
      {mgr && Object.keys(byPerson).length > 0 && (
        <div style={crewCard}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT, marginBottom: 8 }}>今日全店出勤（{Object.keys(byPerson).length} 人）</div>
          {Object.entries(byPerson).map(([pid, list]) => { const last = list[list.length - 1]; return (
            <div key={pid} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0", borderTop: "1px solid #ece4d6", flexWrap: "wrap" }}>
              <b style={{ width: 70 }}>{nameOf2(pid)}</b>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: last.dir === "in" ? "#3f7d4e" : SUB }}>{last.dir === "in" ? "🟢 上班中" : "已下班"}</span>
              {list.map(r => <span key={r.key} style={{ fontSize: 12, color: SUB }}>{r.dir === "in" ? "上" : "下"}{pchHHMM(r.ts)}</span>)}
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700 }}>{pairHours(list)}h</span>
            </div>
          ); })}
        </div>
      )}

      {/* 打卡站全螢幕（iPad 開著這個） */}
      {station && (
        <div style={{ position: "fixed", inset: 0, background: "#F2EDE3", zIndex: 900, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: TEXT, fontFamily: DISP }}>GROUN:D 打卡站</div>
          <div style={{ fontSize: 14, color: SUB }}>用手機「相機」掃描 QR 完成上/下班打卡（QR 每 30 秒更新）</div>
          {qrErr ? <div style={{ color: "#b3261e", fontSize: 15, fontWeight: 700, padding: 40 }}>{qrErr}</div> : <canvas ref={canvasRef} style={{ background: "#fff", borderRadius: 16, padding: 8, border: `1px solid ${BORDER}` }} />}
          <StationClock />
          <button onClick={() => setStation(false)} style={{ position: "absolute", top: 14, right: 16, border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>關閉打卡站</button>
        </div>
      )}
    </div>
  );
}
function StationClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(iv); }, []);
  return <div style={{ fontFamily: MONO, fontSize: 40, fontWeight: 800, color: TEXT, letterSpacing: 1 }}>{now.toLocaleTimeString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" })}</div>;
}

// ── P3 薪資試算（張良 2026-07-22：可用模擬班表估、勞基法條件進設定頁+預排生效日自動切換）──
// ⚠ 草稿試算：正式發薪以人工核定為準。引擎= src/shift/payroll.js（App 與 D哥 同一套）。
// 薪資表欄位定義（版面設定：可勾選顯示、可點欄頭排序、緊湊欄寬——ground-pack 硬格線表格慣例）
const PAY_COLS = [
  { k: "hours", label: "時數 正常+加班", w: "96px" },
  { k: "wage", label: "底薪/時薪", w: "104px" },
  { k: "otPay", label: "加班費", w: "84px" },
  { k: "allowance", label: "津貼", w: "84px" },
  { k: "insSelf", label: "勞健保自付", w: "92px" },
  { k: "gross", label: "應發", w: "96px" },
  { k: "net", label: "預估實領", w: "96px" },
  { k: "employerCost", label: "雇主總成本", w: "100px" },
];
const payVline = { borderRight: "1px solid #e0d6bf", alignSelf: "stretch", display: "flex", alignItems: "center" }; // 直向格線（同產品管理頁範本）
export function PayView({ me: account, userName }) {
  const isMobile = useIsMobile(); // 張良 2026-07-26 手機版全面體檢：手機薪資表改一人一卡（桌機表格不變）
  const [payOpen, setPayOpen] = useState(null); // 手機卡片展開中的人（rosterId）
  const [roster, setRoster] = useState(null);
  const [rulesDoc, setRulesDoc] = useState(null);
  const [month, setMonth] = useState(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date()).slice(0, 7)); // YYYY-MM
  const [source, setSource] = useState("auto"); // auto=實際打卡優先 / sched=純班表模擬
  const [hoursBy, setHoursBy] = useState(null);  // {rosterId: {date: hours}}
  const [showSet, setShowSet] = useState(false);
  const [showCols, setShowColsUI] = useState(false); // 🧩 欄位設定小視窗
  const [sort, setSort] = useState(null); // {k, dir}
  const mgr = account?.role === "admin" || account?.role === "manager";
  const [meId, setMeId] = useState("");

  const loadAll = async (m = month, src = source) => {
    setHoursBy(null);
    const rd = await loadRosterDoc(); setRoster(rd); setMeId(meFromRoster(rd.people || [], userName));
    let prd = null; try { const r = await window.storage.get(K("pay_rules"), true); prd = r?.value ? JSON.parse(r.value) : null; } catch (_) {}
    setRulesDoc(prd);
    // 班表時數（模擬）：抓涵蓋本月的每週班表
    const schedHours = {}; // rosterId -> date -> hours
    try {
      const [sd, td] = await Promise.all([window.storage.get(K("shift_staff"), true), window.storage.get(K("shift_templates"), true)]);
      const staff = sd?.value ? (JSON.parse(sd.value).staff || []) : [];
      const shifts = td?.value ? (JSON.parse(td.value).shifts || []) : [];
      const shiftById = Object.fromEntries(shifts.map(s => [s.id, s]));
      const rosterOf = Object.fromEntries(staff.map(s => [s.id, s.rosterId]));
      const shiftHours = (sh) => { const [h1, m1] = sh.start.split(":").map(Number), [h2, m2] = sh.end.split(":").map(Number); return Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1 - (sh.breakMin || 0)) / 60); };
      const first = `${month}-01`;
      const mondays = new Set(); for (let i = 0; i < 31; i++) { const d = new Date(first + "T12:00:00"); d.setDate(d.getDate() + i); const iso = d.toISOString().slice(0, 10); if (!iso.startsWith(month)) break; mondays.add(mondayOf(iso)); }
      for (const wk of mondays) {
        try { const sc = await window.storage.get(K(schedKey("abeach", wk)), true); const asg = sc?.value ? (JSON.parse(sc.value).assignments || []) : [];
          asg.filter(a => String(a.date || "").startsWith(month)).forEach(a => { const rid = rosterOf[a.staffId]; const sh = shiftById[a.shiftId]; if (!rid || !sh) return; (schedHours[rid] = schedHours[rid] || {})[a.date] = (schedHours[rid][a.date] || 0) + shiftHours(sh); });
        } catch (_) {}
      }
    } catch (_) {}
    // 實際打卡時數：一次抓整月前綴
    const punchHours = {};
    try {
      const map = await getSharedPrefix(`sp_crew_pch_${month.replace("-", "")}`);
      const byPD = {};
      Object.entries(map).forEach(([k, v]) => { try { const r = JSON.parse(v); const day = k.split("_")[3]; (byPD[r.personId + "|" + day] = byPD[r.personId + "|" + day] || []).push(r); } catch (_) {} });
      Object.entries(byPD).forEach(([pd, list]) => { const [rid, day] = pd.split("|"); list.sort((a, b) => a.ts < b.ts ? -1 : 1); let ms = 0; for (let i = 0; i < list.length; i += 2) if (list[i]?.dir === "in" && list[i + 1]?.dir === "out") ms += new Date(list[i + 1].ts) - new Date(list[i].ts); const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`; (punchHours[rid] = punchHours[rid] || {})[date] = Math.round(ms / 360000) / 10; });
    } catch (_) {}
    // 合成：auto=該日有打卡用打卡、否則用班表；sched=全用班表
    const out = {};
    const ids = new Set([...Object.keys(schedHours), ...Object.keys(punchHours)]);
    for (const rid of ids) {
      out[rid] = {};
      const dates = new Set([...Object.keys(schedHours[rid] || {}), ...Object.keys(punchHours[rid] || {})]);
      for (const d of dates) out[rid][d] = (src === "sched") ? (schedHours[rid]?.[d] || 0) : (punchHours[rid]?.[d] ?? schedHours[rid]?.[d] ?? 0);
    }
    setHoursBy(out);
  };
  useEffect(() => { loadAll(); }, [month, source]);

  if (!roster || hoursBy === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>試算中…</div>;
  const people = (roster.people || []).filter(p => (p.status || "在職") === "在職" && !p.onboarding);
  const titleField = (roster.fields || []).find(f => /職稱/.test(f.label || ""));
  const titleOf = (p) => titleField ? (p[titleField.key] || "") : (p.grade || "");
  const monthEnd = `${month}-28`;
  const rules = rulesAt(rulesDoc, monthEnd);
  const rows = people.map(p => {
    const days = Object.entries(hoursBy[p.id] || {}).map(([date, hours]) => ({ date, hours }));
    if (!days.length) return null;
    return { p, title: titleOf(p), pay: calcMonthPay({ person: p, title: titleOf(p), days, rules }) };
  }).filter(Boolean);
  let show = mgr ? rows : rows.filter(r => r.p.id === meId);
  // 版面設定：欄位勾選（存 pay_rules.uiCols＝全裝置一致）＋點欄頭排序
  const uiCols = { ...Object.fromEntries(PAY_COLS.map(c => [c.k, true])), ...(rulesDoc?.uiCols || {}) };
  const cols = PAY_COLS.filter(c => uiCols[c.k]);
  const valOf = (r, k) => k === "hours" ? r.pay.hours.total : k === "wage" ? r.pay.wage : k === "insSelf" ? (r.pay.laborSelf + r.pay.healthSelf) : (r.pay[k] || 0);
  if (sort) show = [...show].sort((a, b) => (sort.k === "name" ? String(a.p.name).localeCompare(String(b.p.name), "zh-Hant-TW") : valOf(a, sort.k) - valOf(b, sort.k)) * sort.dir);
  const clickSort = (k) => setSort(s => !s || s.k !== k ? { k, dir: -1 } : s.dir === -1 ? { k, dir: 1 } : null); // 點一下大→小、再點小→大、第三下取消
  const GTCPAY = `minmax(150px,1fr) ${cols.map(c => c.w).join(" ")}`; // 姓名欄彈性吸收剩餘寬度（不留尾端空欄）
  const sum = monthSummary(rows);
  const fmt$ = (x) => "$" + Math.round(x).toLocaleString();
  const nextSched = (rulesDoc?.scheduled || []).filter(s => s.effective > monthEnd).sort((a, b) => a.effective.localeCompare(b.effective))[0];
  const saveRules = async (next) => { const doc = { ...(rulesDoc || {}), ...next, updatedAt: new Date().toISOString() }; setRulesDoc(doc); try { auditLog("編輯", "薪資/勞基法參數設定"); } catch (_) {} try { await window.storage.set(K("pay_rules"), JSON.stringify(doc), true); } catch (_) {} };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>💰 薪資試算</div>
        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>草稿試算・發薪以人工核定為準</span>
        <div style={{ flex: 1 }} />
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px", fontSize: 13.5, background: "#fff" }} />
        <div style={{ display: "inline-flex", background: "#ece4d6", borderRadius: 8, padding: 2 }}>
          {[["auto", "實卡優先"], ["sched", "純班表模擬"]].map(([k, l]) => (
            <button key={k} onClick={() => setSource(k)} style={{ border: "none", background: source === k ? "#fff" : "transparent", color: TEXT, borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: source === k ? 700 : 500, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        {mgr && <button onClick={() => setShowColsUI(true)} style={{ border: `1.5px solid #c8bca6`, background: "#fff", color: TEXT, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🧩 欄位設定</button>}
        {mgr && <button onClick={() => setShowSet(true)} style={{ border: `1.5px solid #c8bca6`, background: "#fff", color: TEXT, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⚙ 薪資/勞基法設定</button>}
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>
        時數來源：{source === "auto" ? "有打卡的日子用實際打卡、沒打卡用班表排定（模擬）" : "全部用班表排定時數模擬"}・適用參數：基本工資 月{rules.minWageMonthly.toLocaleString()}／時{rules.minWageHourly}、加班 {rules.otRate1}／{rules.otRate2}
        {nextSched && <span style={{ color: "#C2872E", fontWeight: 600 }}>・📅 已預排 {nextSched.effective} 起自動套用新參數{nextSched.note ? `（${nextSched.note}）` : ""}</span>}
      </div>
      {show.length === 0 && <div style={{ ...crewCard, color: "#9b9384", fontSize: 13.5 }}>{month} 沒有可試算的時數——{source === "sched" ? "本月沒有發布班表" : "本月沒有打卡也沒有班表"}。排班頁發布班表或開始打卡後，這裡就能試算。</div>}
      {/* 張良 2026-07-26 手機版全面體檢：手機一人一卡（第一行姓名＋實領/應發、點卡展開已啟用欄位明細），橫滑表格只留桌機 */}
      {show.length > 0 && isMobile && (
        <div>
          {show.map(({ p, title, pay }) => {
            const cell = { hours: [`${pay.hours.reg}+${r1sum(pay.hours.ot1, pay.hours.ot2)}h`, SUB], wage: [pay.hourlyMode ? `${pay.wage}/時` : fmt$(pay.wage) + "/月", TEXT], otPay: [fmt$(pay.otPay), pay.otPay ? "#C2872E" : SUB], allowance: [fmt$(pay.allowance), SUB], insSelf: ["-" + fmt$(pay.laborSelf + pay.healthSelf), SUB], gross: [fmt$(pay.gross), TEXT], net: [fmt$(pay.net), "#3f7d4e"], employerCost: [fmt$(pay.employerCost), ACCENT] };
            const open = payOpen === p.id;
            return (
              <div key={p.id} onClick={() => setPayOpen(open ? null : p.id)} style={{ background: "#fff", border: "1.5px solid #c8bca6", borderRadius: 4, padding: "11px 14px", marginBottom: 10, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: TEXT }}>{p.name}</span>
                  <span style={{ fontSize: 11.5, color: "#9b9384" }}>{title || "—"}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: 16, fontWeight: 800, color: "#3f7d4e", textAlign: "right" }}>{fmt$(pay.net)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: SUB, marginTop: 3 }}>
                  <span>應發 <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: TEXT }}>{fmt$(pay.gross)}</span>・實領為預估</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ color: "#2E6FB0", fontWeight: 600 }}>{open ? "▲ 收合" : "▼ 明細"}</span>
                </div>
                {open && (
                  <div style={{ marginTop: 8, borderTop: "1px solid #f0ead9", paddingTop: 4 }}>
                    {cols.map(c => (
                      <div key={c.k} style={{ display: "flex", alignItems: "baseline", fontSize: 13, padding: "4px 0" }}>
                        <span style={{ color: SUB, fontSize: 12 }}>{c.label}</span>
                        <div style={{ flex: 1 }} />
                        <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontWeight: ["gross", "net"].includes(c.k) ? 800 : 500, color: cell[c.k][1] }}>{cell[c.k][0]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {mgr && (() => {
            const sumCell = { otPay: fmt$(sum.otPay), gross: fmt$(sum.gross), net: fmt$(sum.net), employerCost: fmt$(sum.employerCost) };
            const sumColor = { net: "#3f7d4e", employerCost: ACCENT };
            return (
              <div style={{ background: "#FBF7EE", border: "1.5px solid #c8bca6", borderRadius: 4, padding: "11px 14px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, marginBottom: 4 }}>合計（{sum.people} 人）</div>
                {cols.filter(c => sumCell[c.k]).map(c => (
                  <div key={c.k} style={{ display: "flex", alignItems: "baseline", fontSize: 13, padding: "3px 0" }}>
                    <span style={{ color: SUB, fontSize: 12 }}>{c.label}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontWeight: 800, color: sumColor[c.k] || TEXT }}>{sumCell[c.k]}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
      {show.length > 0 && !isMobile && (
        <div style={{ maxWidth: 1060 }}>{/* 頁寬限 1060＋方角4＋直向格線＋數字MONO右對齊（ground-pack 表格慣例） */}
        <div style={{ background: "#fff", border: "1.5px solid #c8bca6", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}><div style={{ minWidth: 640 }}>
            <div style={{ display: "grid", gridTemplateColumns: GTCPAY, background: "#ece4d6", borderBottom: "1.5px solid #c8bca6" }}>
              {[{ k: "name", label: "姓名（職稱）" }, ...cols].map(c => { const on = sort?.k === c.k; return (
                <button key={c.k} onClick={() => clickSort(c.k)} title="點一下排序、再點反向、第三下取消" style={{ ...payVline, borderRight: "1px solid #d3c8ac", background: "none", justifyContent: c.k === "name" ? "flex-start" : "flex-end", padding: "7px 9px", fontSize: 10.5, fontWeight: 700, color: on ? TEXT : "#9b9384", letterSpacing: .6, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }}>{c.label}{on ? (sort.dir === -1 ? " ▼" : " ▲") : ""}</button>
              ); })}
            </div>
            {show.map(({ p, title, pay }) => {
              const cell = { hours: [`${pay.hours.reg}+${r1sum(pay.hours.ot1, pay.hours.ot2)}h`, SUB], wage: [pay.hourlyMode ? `${pay.wage}/時` : fmt$(pay.wage) + "/月", TEXT], otPay: [fmt$(pay.otPay), pay.otPay ? "#C2872E" : SUB], allowance: [fmt$(pay.allowance), SUB], insSelf: ["-" + fmt$(pay.laborSelf + pay.healthSelf), SUB], gross: [fmt$(pay.gross), TEXT], net: [fmt$(pay.net), "#3f7d4e"], employerCost: [fmt$(pay.employerCost), ACCENT] };
              return (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: GTCPAY, borderTop: "1px solid #f0ead9", fontSize: 13, height: 36 }}>
                  <span style={{ ...payVline, padding: "0 9px", fontWeight: 600, overflow: "hidden" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}<span style={{ color: "#9b9384", fontWeight: 400, fontSize: 11.5 }}>（{title || "—"}）</span></span></span>
                  {cols.map(c => <span key={c.k} style={{ ...payVline, justifyContent: "flex-end", padding: "0 9px", fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: ["gross", "net"].includes(c.k) ? 13 : 12.5, fontWeight: c.k === "net" ? 800 : c.k === "gross" ? 700 : 400, color: cell[c.k][1] }}>{cell[c.k][0]}</span>)}
                </div>
              );
            })}
            {mgr && (() => {
              const sumCell = { hours: "", wage: "", otPay: fmt$(sum.otPay), allowance: "", insSelf: "", gross: fmt$(sum.gross), net: fmt$(sum.net), employerCost: fmt$(sum.employerCost) };
              const sumColor = { net: "#3f7d4e", employerCost: ACCENT };
              return (
                <div style={{ display: "grid", gridTemplateColumns: GTCPAY, borderTop: "1.5px solid #c8bca6", background: "#FBF7EE", fontSize: 13, height: 38, fontWeight: 800 }}>
                  <span style={{ ...payVline, padding: "0 9px" }}>合計（{sum.people} 人）</span>
                  {cols.map(c => <span key={c.k} style={{ ...payVline, justifyContent: "flex-end", padding: "0 9px", fontFamily: MONO, fontVariantNumeric: "tabular-nums", color: sumColor[c.k] || TEXT }}>{sumCell[c.k]}</span>)}
                </div>
              );
            })()}
          </div></div>
        </div>
        </div>
      )}
      {/* 🧩 欄位設定：勾選顯示哪些欄（存設定檔＝所有裝置一致）——全站表格慣例 */}
      {showCols && (
        <div onClick={e => e.target === e.currentTarget && setShowColsUI(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 22, width: "min(380px,94vw)" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>🧩 薪資表欄位設定</div><div style={{ flex: 1 }} />
              <button onClick={() => setShowColsUI(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: SUB }}>×</button>
            </div>
            <div style={{ fontSize: 11.5, color: SUB, marginBottom: 10 }}>勾＝顯示在表格；也可點表格欄頭排序（再點反向、第三下取消）。設定會存起來、所有裝置一致。</div>
            {/* 張良 2026-07-26 手機版全面體檢：手機改單欄，欄名不擠壓換行 */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
              {PAY_COLS.map(c => (
                <label key={c.k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!uiCols[c.k]} onChange={e => saveRules({ uiCols: { ...uiCols, [c.k]: e.target.checked } })} />{c.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
      {showSet && <PayRulesModal rulesDoc={rulesDoc} onSave={saveRules} onClose={() => setShowSet(false)} />}
    </div>
  );
}
const r1sum = (a, b) => Math.round((a + b) * 10) / 10;

// ⚙ 薪資/勞基法設定（可改參數＋預排調整：設生效日到期自動切換——法規調整不用改程式）
function PayRulesModal({ rulesDoc, onSave, onClose }) {
  const cur = { ...PAY_DEFAULTS, ...(rulesDoc || {}) };
  const [d, setD] = useState({ minWageMonthly: cur.minWageMonthly, minWageHourly: cur.minWageHourly, otRate1: cur.otRate1, otRate2: cur.otRate2, laborInsRate: cur.laborInsRate, laborInsEmpShare: cur.laborInsEmpShare, healthInsRate: cur.healthInsRate, healthInsEmpShare: cur.healthInsEmpShare, pensionRate: cur.pensionRate, monthlyBaseHours: cur.monthlyBaseHours });
  const [sch, setSch] = useState(cur.scheduled || []);
  const [ns, setNs] = useState({ effective: "", minWageMonthly: "", minWageHourly: "", note: "" });
  const F = (k, label, step = 1) => (
    <label style={{ display: "block", fontSize: 11, color: "#9b9384", fontWeight: 600 }}>{label}
      <input type="number" step={step} value={d[k]} onChange={e => setD(s => ({ ...s, [k]: Number(e.target.value) }))} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 9px", fontSize: 13.5, marginTop: 3 }} />
    </label>
  );
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 22, width: "min(620px,96vw)", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>⚙ 薪資／勞基法參數設定</div><div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: SUB }}>×</button>
        </div>
        <div style={{ fontSize: 11.5, color: SUB, marginBottom: 12 }}>法規調整（例每年基本工資公告）在下面「預排調整」設好生效日＝到期自動套用，不用改程式。每年 1 月記得跟官方公告核對一次。⚠ 倍率/費率建議經勞資顧問覆核。</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
          {F("minWageMonthly", "基本工資（月薪）")}{F("minWageHourly", "基本工資（時薪）")}
          {F("otRate1", "加班倍率（前2小時）", 0.01)}{F("otRate2", "加班倍率（第3小時起）", 0.01)}
          {F("monthlyBaseHours", "月薪換算時薪除數")}
          {F("laborInsRate", "勞保費率", 0.001)}{F("laborInsEmpShare", "勞保自付比例", 0.01)}
          {F("healthInsRate", "健保費率", 0.0001)}{F("healthInsEmpShare", "健保自付比例", 0.01)}
          {F("pensionRate", "勞退雇主提繳率", 0.01)}
        </div>
        <div style={{ marginTop: 16, borderTop: `1px dashed ${BORDER}`, paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>📅 預排調整（到生效日自動套用）</div>
          {sch.length === 0 && <div style={{ fontSize: 12, color: "#9b9384", marginBottom: 6 }}>尚無預排。例：明年基本工資公告後，設 2027-01-01 生效的新數字。</div>}
          {sch.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, padding: "4px 0", flexWrap: "wrap" }}>
              <b>{s.effective}</b><span>{Object.entries(s.patch || {}).map(([k, v]) => `${k}=${v}`).join("、")}</span><span style={{ color: SUB }}>{s.note}</span>
              <div style={{ flex: 1 }} /><button onClick={() => setSch(sch.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "#b3261e", cursor: "pointer" }}>×</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 6 }}>
            <label style={{ fontSize: 11, color: "#9b9384" }}>生效日<input type="date" value={ns.effective} onChange={e => setNs({ ...ns, effective: e.target.value })} style={{ display: "block", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
            <label style={{ fontSize: 11, color: "#9b9384" }}>月薪基本工資<input type="number" value={ns.minWageMonthly} onChange={e => setNs({ ...ns, minWageMonthly: e.target.value })} style={{ display: "block", width: 110, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
            <label style={{ fontSize: 11, color: "#9b9384" }}>時薪基本工資<input type="number" value={ns.minWageHourly} onChange={e => setNs({ ...ns, minWageHourly: e.target.value })} style={{ display: "block", width: 100, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
            <label style={{ fontSize: 11, color: "#9b9384", flex: 1, minWidth: 120 }}>備註<input value={ns.note} onChange={e => setNs({ ...ns, note: e.target.value })} style={{ display: "block", width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, marginTop: 3 }} placeholder="例：2027基本工資調整" /></label>
            <button onClick={() => { if (!ns.effective) { alert("請選生效日"); return; } const patch = {}; if (ns.minWageMonthly) patch.minWageMonthly = Number(ns.minWageMonthly); if (ns.minWageHourly) patch.minWageHourly = Number(ns.minWageHourly); if (!Object.keys(patch).length) { alert("至少填一個新數字"); return; } setSch([...sch, { effective: ns.effective, patch, note: ns.note }]); setNs({ effective: "", minWageMonthly: "", minWageHourly: "", note: "" }); }} style={{ border: `1.5px solid ${ACCENT}`, background: "#fff", color: ACCENT, borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>＋ 加入預排</button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
          <button onClick={() => { onSave({ ...d, scheduled: sch }); onClose(); }} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>儲存設定</button>
        </div>
      </div>
    </div>
  );
}

// ── 積分存摺（張良 2026-07-24：我的積分要像銀行收支/LINE Points 逐筆顯示來源與使用＋餘額）──
// 不另存一份帳：直接從 回饋/闖關/兌換 原始資料推導（跟排行榜 crewFullBalance 同一套公式＝數字一致）。
export function buildPointLedger(me, people, fbItems, quests, shop) {
  const entries = [];
  const nameOf = (id) => (people.find(p => p.id === id) || {}).name || "—";
  (fbItems || []).forEach(it => {
    if (it.fromId === me) {
      entries.push({ ts: it.ts, icon: "✍", label: `給回饋 → ${nameOf(it.toId)}${it.tags?.[0] ? `「${it.tags[0]}」` : ""}`, delta: 2 });
      if ((it.helpful || []).length) entries.push({ ts: it.ts, icon: "👍", label: `回饋被 ${nameOf(it.toId)} 按「幫到我」×${it.helpful.length}`, delta: 5 * it.helpful.length });
    }
    if (it.toId === me) entries.push({ ts: it.ts, icon: "💬", label: `收到回饋 ← ${it.anon ? "匿名夥伴" : nameOf(it.fromId)}`, delta: 1 });
  });
  (quests?.progress || []).filter(p => p.userId === me && p.status === "completed").forEach(pr => {
    const q = (quests.quests || []).find(x => x.id === pr.questId);
    if (q) entries.push({ ts: pr.ts, icon: "🎯", label: `完成關卡「${q.title}」`, delta: q.points || 0 });
  });
  (shop?.redemptions || []).filter(r => r.userId === me && r.status !== "rejected").forEach(r => {
    entries.push({ ts: r.ts, icon: "🎁", label: `兌換「${r.name}」`, delta: -(r.cost || 0) });
  });
  entries.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  let bal = 0;
  entries.forEach(e => { bal += e.delta; e.balance = bal; });
  return entries.reverse(); // 新到舊（最上面是最新，跟銀行 App 一樣）
}
export function PointsLedgerModal({ me, people, fbItems, quests, shop, onClose }) {
  const entries = buildPointLedger(me, people, fbItems, quests, shop);
  const cur = entries[0]?.balance || 0;
  const fmtD = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 820, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, width: "min(480px,96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px 12px", borderBottom: `1.5px solid #c8bca6`, background: "#FBF7EE" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>📒 我的積分存摺</div>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: SUB }}>×</button>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 800, color: ACCENT }}>{cur}</span>
            <span style={{ fontSize: 12.5, color: SUB }}>分・共 {entries.length} 筆紀錄</span>
          </div>
          <div style={{ fontSize: 11, color: "#9b9384", marginTop: 2 }}>給回饋+2・收到回饋+1・被按幫到我+5/讚・闖關依關卡・兌換扣分（與排行榜同一套算法）</div>
        </div>
        <div style={{ overflowY: "auto", padding: "4px 0" }}>
          {entries.length === 0 && <div style={{ padding: "36px 0", textAlign: "center", color: "#9b9384", fontSize: 13.5 }}>還沒有積分紀錄——去「回饋」給夥伴一個鼓勵就有第一筆了！</div>}
          {entries.map((e, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 18px", borderTop: i ? "1px solid #f0ead9" : "none" }}>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: "#9b9384", width: 34, flexShrink: 0 }}>{fmtD(e.ts)}</span>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{e.icon}</span>
              <span style={{ fontSize: 13, color: TEXT, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.label}>{e.label}</span>
              <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: 13.5, fontWeight: 800, color: e.delta >= 0 ? "#3f7d4e" : "#b3261e", width: 46, textAlign: "right", flexShrink: 0 }}>{e.delta >= 0 ? "+" : ""}{e.delta}</span>
              <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: 12, color: SUB, width: 52, textAlign: "right", flexShrink: 0 }}>{e.balance}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 18px", borderTop: `1px solid ${BORDER}`, display: "flex", fontSize: 10.5, color: "#c8bca6" }}>
          <span style={{ flex: 1 }} /><span style={{ width: 46, textAlign: "right" }}>增減</span><span style={{ width: 52, textAlign: "right" }}>餘額</span>
        </div>
      </div>
    </div>
  );
}
