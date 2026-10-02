// ── 任務中心（獨立模組）────────────────────────────────────────────────────
// 合併取代「工序 + ToDo」。單一資料 pm_tasks，多視角同步：看板 / 清單 / 依大項分組。
// 小標籤可拖曳排序、拖到任一大項自動歸屬。隨手記 → 先進收件匣，之後再整理。
// App 以 props 傳 K / confirm / canEdit / cats(工程大項，給「隸屬」用) / onLog。
// 視覺：依 docs/DESIGN_SPEC.md（Linear/Stripe 儀表板風）— 中性灰白 + 單一藍色主色 +
//       lucide 細線圖示 + 狀態小圓點；1px 淺灰邊框、8px 圓角、無陰影、大量留白。
import { useState, useEffect, useRef } from "react";
import { Inbox, LayoutGrid, Columns3, List, CalendarDays, ChartGantt, Network, Plus, X, Check, Flame, Calendar, Clock, CircleAlert, ListTodo, Search, Home, Zap, Hourglass, CirclePlay, Coffee, Pin, ArrowUpDown, FolderPlus, Sun, GripVertical } from "lucide-react";
import { isWaiting, isBlocked, missingDeps, wouldCycle, mergeTask, removeTaskAndRefs, isQuickWin, QUICK_WIN_MAX_MINUTES, orderTasks } from "./taskModel.js";
import { uploadPhoto } from "../supa.js";
import { loadRecords, migrateRecords, diffPersist, subscribeRecords } from "../lib/records.js";
import { useIsMobile } from "../lib/theme.jsx"; // 手機判斷（張良 2026-07-26 手機版全面體檢）

// 任務附件：可上傳檔案＋直接 Cmd+V 貼截圖（彈窗開著時全域接住貼上）＋縮圖點開放大（App 慣例）
function TaskAttach({ files = [], onChange, canEdit, C, line }) {
  const [busy, setBusy] = useState(false);
  const [lb, setLb] = useState(null);
  const inputRef = useRef(null);
  const add = async (fileList) => {
    const arr = Array.from(fileList || []); if (!arr.length || !canEdit) return;
    setBusy(true); const out = [];
    for (const f of arr) { try { const { url, path } = await uploadPhoto(f); out.push({ id: "tf" + Math.random().toString(36).slice(2, 7), url, path, name: f.name || "檔案", isImage: /^image\//.test(f.type) }); } catch (_) {} }
    setBusy(false); if (out.length) onChange([...(files || []), ...out]);
  };
  // 彈窗開著（本元件掛載中）時，在任何地方 Cmd+V 貼圖都會進附件
  useEffect(() => {
    const h = (e) => { const items = e.clipboardData?.items; if (!items) return; const fs = []; for (const it of items) { if (it.type?.startsWith("image/")) { const f = it.getAsFile(); if (f) fs.push(f); } } if (fs.length) { e.preventDefault(); add(fs); } };
    document.addEventListener("paste", h);
    return () => document.removeEventListener("paste", h);
  }); // eslint-disable-line
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input ref={inputRef} type="file" accept="*/*" multiple style={{ display: "none" }} onChange={e => { add(e.target.files); e.target.value = ""; }} />
      {(files || []).map(r => (
        <span key={r.id} style={{ position: "relative", display: "inline-flex" }}>
          {r.isImage
            ? <img src={r.url} alt="" onClick={() => setLb(r)} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, border: `1px solid ${line}`, cursor: "zoom-in" }} />
            : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 6, border: `1px solid ${line}`, textDecoration: "none", fontSize: 18 }}>📄<span style={{ fontSize: 8.5, color: "#8a8171", maxWidth: 46, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span></a>}
          {canEdit && <button onClick={() => { if (window.confirm("移除這個附件？")) onChange((files || []).filter(x => x.id !== r.id)); }} style={{ position: "absolute", top: -6, right: -6, width: 17, height: 17, borderRadius: 9, border: "1.5px solid #fff", background: "#b3261e", color: "#fff", fontSize: 11, lineHeight: "14px", cursor: "pointer", padding: 0 }}>×</button>}
        </span>
      ))}
      {canEdit && <button onClick={() => inputRef.current?.click()} title="點選檔上傳；或直接 Cmd+V 貼截圖" style={{ border: `1.5px dashed ${line}`, background: "#fff", color: "#8a8171", borderRadius: 6, width: 52, height: 52, fontSize: 12, cursor: "pointer", lineHeight: 1.3 }}>{busy ? "…" : <>＋<br />貼/傳</>}</button>}
      {lb && <div onClick={() => setLb(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}><img src={lb.url} alt={lb.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} /></div>}
    </div>
  );
}

// 任務顏色（Google Keep 式，低飽和淡色底，白＝無色）
const TASK_COLORS = ["", "#fef2f2", "#fff7ed", "#fefce8", "#f0fdf4", "#eff6ff", "#faf5ff", "#f5f5f5"];
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"; // 數字專用（gpack）

const OPS_DARK = typeof window !== "undefined" && !!window.__OPS_PROXY__; // /prep 深色皮（2026-10-02 張良：風格要跟看板一致）；主 App 照舊米色
const C = OPS_DARK ? {
  text: "#F2F5F9", sub: "#C7D0DB", faint: "#8C98A8",
  line: "#2A3240", soft: "#1C222B", bg: "#0E1217", card: "#161B22",
  accent: "#4DA3FF", accentSoft: "#1A2940",
  green: "#3DBE6C", amber: "#E8A657", red: "#F07373",
} : {
  text: "#1d1a15",       // 墨黑（gpack ink）
  sub: "#5a5247",        // 次要文字
  faint: "#9b9384",      // 小標籤
  line: "#d9cfbd",       // 邊框
  soft: "#ece4d6",       // pill 底
  bg: "#f4efe5",         // 米色紙底
  card: "#fbf8f1",
  accent: "#c4582a",     // 磚紅（唯一強調色）
  accentSoft: "#fbeee6",
  green: "#3f7d4e", amber: "#c98a14", red: "#b3261e",
};
const STATUS = [["todo", "待辦", "#9b9384"], ["doing", "進行中", "#3a6ea5"], ["done", "完成", "#3f7d4e"]];
const PRIO = [["urgent", "超急", "#b3261e"], ["high", "高", "#c98a14"], ["normal", "一般", "#5a5247"], ["low", "低", "#9b9384"]];
const sLabel = (s) => (STATUS.find(x => x[0] === s) || STATUS[0])[1];
const sColor = (s) => (STATUS.find(x => x[0] === s) || STATUS[0])[2];
const pMeta = (p) => PRIO.find(x => x[0] === p) || PRIO[2];
const INBOX = "__inbox__";
const rid = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }; // 本地日期（不能用 toISOString＝UTC，台灣早上會慢一天）
const dnorm = (v) => String(v ?? "").replace(/\//g, "-").slice(0, 10);
const inp = { border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", color: C.text, boxSizing: "border-box", outline: "none" };
const dateInp = { ...inp, colorScheme: "light", fontFamily: "'Noto Sans TC',sans-serif", cursor: "pointer" };
// 欄位小標：小號、加字距、淺灰（規格招牌手法）
const lbl = { display: "block", fontSize: 11, letterSpacing: 0.5, color: C.faint, fontWeight: 500, marginBottom: 10 };
// 狀態徽章：灰底 + 彩色小圓點 + 文字（不用大色塊）
const Pill = ({ color, label }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#404040", background: C.soft, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />{label}
  </span>
);

// 卡片/大項共用色盤（張良 2026-09-10：視覺分類）
const PALETTE = [["", "白"], ["#fde8e6", "紅"], ["#fdf1dd", "杏"], ["#faf6d8", "黃"], ["#e9f2e4", "綠"], ["#e6eef6", "藍"], ["#efe8f6", "紫"]];

export default function TaskCenter({ K, confirm, canEdit, cats, onLog, onAddCat, onRenameCat, onMoveCat, onSetCatColor, waitHint = "例：等對方回覆、等報價、等主管確認", userName = "" }) { // userName：/prep 整併（2026-10-02）我來解決/計時 記名用
  const [tasks, setTasks] = useState(null);
  const [view, setView] = useState("today"); // today(Home 落地頁) | group | board | list | timeline | gantt | mind
  const [quick, setQuick] = useState("");
  const [sel, setSel] = useState(null);     // 開啟詳情的任務 id
  const [drag, setDrag] = useState(null);   // 拖曳中的任務 id
  const [overKey, setOverKey] = useState(null); // 拖過的群組/欄
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("open"); // list 篩選
  const [gnew, setGnew] = useState({}); // 各大項的「直接新增」輸入
  const [tagIn, setTagIn] = useState(""); // 詳情彈窗的標籤輸入
  const [showAllDone, setShowAllDone] = useState(false); // 看板「完成」欄預設只列最近幾件
  const [sortMode, setSortMode] = useState("manual"); // manual(手動/拖曳順序) | due(日期) | prio(重要度)
  const [newCatIn, setNewCatIn] = useState(""); // 依大項視角「新增大項」輸入
  const [editCat, setEditCat] = useState(null); // 大項改名中：{id, name}（張良 2026-09-10：採購大項名稱要可編輯）
  const [dragCat, setDragCat] = useState(null); // 拖曳中的大項 id（張良 2026-09-10：大項要能拖曳排序像 Trello/Keep）
  const [overCat, setOverCat] = useState(null); // 大項拖曳目前懸停的目標
  const colOfRef = useRef({}); // 本次渲染各大項實際落在第幾欄（拖放時用來算 tcol）
  const [showDone, setShowDone] = useState(false); // 完成的任務預設隱藏封存（張良 2026-09-10），點「已完成」切換顯示
  const [colorCat, setColorCat] = useState(null); // 大項調色盤開啟中的大項 id（張良 2026-09-10：大項也要能編輯顏色好辨識區塊）
  // 滑鼠停在卡片上直接 Cmd+V 貼照片（張良 2026-09-10：每個卡片要可以貼上照片）——不用開卡；開著詳情彈窗時讓彈窗自己接
  const hoverCardRef = useRef(null);
  const selRef = useRef(null);
  const [vw, setVw] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1280)); // 視窗寬（後備用）
  useEffect(() => { const f = () => setVw(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  // 瀑布流用「實際容器寬」算欄數（張良 2026-09-10：字被壓縮＝欄算太多；ResizeObserver 量到多寬就排幾欄）
  const groupWrapRef = useRef(null);
  const [gw, setGw] = useState(0);
  useEffect(() => {
    const el = groupWrapRef.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(en => { const w = en[0]?.contentRect?.width || 0; if (w) setGw(w); });
    ro.observe(el); return () => ro.disconnect();
  });
  const isMobile = useIsMobile(); // 手機(<640px)排版切換（張良 2026-07-26 手機版全面體檢）

  // 任務逐筆存（2026-07-18）：一件任務＝一份文件 pm_task_<id>（含 ord＝手動排序位置），
  // 兩人同時改任務不再整包互蓋；舊整包 pm_tasks 第一次載入自動遷移。
  const persistedTasks = useRef([]); // 上次已存清單（差異寫入的比對基準）
  const recConf = () => ({ markerKey: K("pm_tasks_v2"), prefix: K("pm_task_"), withOrd: true });
  useEffect(() => { (async () => {
    try {
      // 合併讀（marker=加速器；沒 marker＝舊整包+逐筆檔合併，讀取偶發失敗也不丟資料）
      const list = await loadRecords({ ...recConf(), legacyKey: K("pm_tasks"), sortBy: (a, b) => (a.ord ?? 0) - (b.ord ?? 0) });
      if (list.length) { persistedTasks.current = list; setTasks(list); return; }
      // 完全沒任務：只有「從未建立過」（沒 marker、沒舊 doc）才做一次性 pm_issues 匯入
      const [mark, legacy] = await Promise.all([window.storage.get(K("pm_tasks_v2"), true), window.storage.get(K("pm_tasks"), true)]);
      if ((mark && mark.value) || (legacy && legacy.value)) { setTasks([]); return; }
      let imported = [];
      try {
        const ti = await window.storage.get(K("pm_issues"), true);
        const iss = ti && ti.value ? JSON.parse(ti.value) : [];
        imported = (Array.isArray(iss) ? iss : []).map(i => ({
          id: rid(), title: i.desc || "(未命名)", note: i.answer || "", status: (i.status === "done" ? "done" : "todo"),
          catId: INBOX, start: "", due: dnorm(i.due), priority: i.track ? "normal" : "low",
          tags: i.category && i.category !== "其他" ? [i.category] : [], createdAt: i.ts || new Date().toISOString(), updatedAt: new Date().toISOString(),
        }));
      } catch (_) {}
      setTasks(imported);
      migrateRecords({ ...recConf(), list: imported }).then(() => { persistedTasks.current = imported; }).catch(() => {});
    } catch { setTasks([]); }
  })(); }, []); // eslint-disable-line
  // 即時同步：別台改的任務 → 這裡畫面即時跟上（依 ord 插回正確位置）
  useEffect(() => {
    const un = subscribeRecords(K("pm_task_"), (id, t) => {
      persistedTasks.current = (t ? [...persistedTasks.current.filter(x => x.id !== id), t] : persistedTasks.current.filter(x => x.id !== id)).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
      setTasks(prev => prev == null ? prev : (t ? [...prev.filter(x => x.id !== id), t] : prev.filter(x => x.id !== id)).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0)));
    });
    return un;
  }, []); // eslint-disable-line

  const guard = () => { if (!canEdit) { alert("沒有編輯權限，請聯絡管理員。"); return false; } return true; };
  // 存檔防抖：畫面即時更新，但停手 0.5 秒才寫後端（避免打一個字寫一次資料庫）
  const saveTimer = useRef(null);
  const undoStack = useRef([]); // Cmd+Z 復原：保留最近 30 步
  const tasksRef = useRef(null);
  const save = (list, opts = {}) => {
    if (!opts.skipUndo && tasksRef.current) { undoStack.current.push(tasksRef.current); if (undoStack.current.length > 30) undoStack.current.shift(); }
    tasksRef.current = list;
    setTasks(list);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // 逐筆存：只寫「有變動的那幾筆」（含順序變動＝ord 改變的）；刪除的刪各自文件
    saveTimer.current = setTimeout(() => { try { persistedTasks.current = diffPersist({ prefix: K("pm_task_"), prevList: persistedTasks.current, nextList: list, withOrd: true }); } catch (_) {} }, 500);
  };
  useEffect(() => { tasksRef.current = tasks; }, [tasks]); // 初次載入也帶進 ref
  // Cmd+Z / Ctrl+Z 復原上一步（打字中在輸入框時不攔截，讓輸入框用原生復原）
  useEffect(() => {
    const h = (e) => {
      if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== "z" || e.shiftKey) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
      if (!undoStack.current.length) return;
      e.preventDefault();
      save(undoStack.current.pop(), { skipUndo: true });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []); // eslint-disable-line
  const catName = (id) => id === INBOX || !id ? "收件匣" : (cats || []).find(c => c.id === id)?.name || "收件匣";

  const addQuick = () => {
    if (!guard()) return;
    const t = quick.trim(); if (!t) return;
    const task = { id: rid(), title: t, note: "", status: "todo", catId: INBOX, start: "", due: "", priority: "normal", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    save([task, ...(tasks || [])]); setQuick("");
    onLog?.("新增", `新增任務「${t.slice(0, 20)}」`);
  };
  const addToGroup = (catId) => {
    if (!guard()) return;
    const t = (gnew[catId] || "").trim(); if (!t) return;
    const task = { id: rid(), title: t, note: "", status: "todo", catId, start: "", due: "", priority: "normal", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    save([task, ...(tasks || [])]); setGnew(p => ({ ...p, [catId]: "" }));
    onLog?.("新增", `新增任務「${t.slice(0, 20)}」→${catName(catId)}`);
  };
  // Merge Rule：一律 {...existing, ...patch}（normalize 只動 patch 有的 key），絕不重建 task
  const upd = (id, patch) => { save((tasks || []).map(t => t.id === id ? mergeTask(t, patch, tasks) : t)); };
  // 全域貼上：滑鼠停在某張卡上（且沒開詳情彈窗）→ 剪貼簿的圖直接進那張卡的附件（張良 2026-09-10）
  useEffect(() => { selRef.current = sel; }, [sel]); // tasksRef 用上面既有那顆（save/undo 已同步維護）
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = async (e) => {
      const tid = hoverCardRef.current;
      if (!tid || selRef.current) return; // 沒停在卡上不管；開著詳情由 TaskAttach 自己接
      const imgs = [...(e.clipboardData?.items || [])].filter(it => it.type?.startsWith("image/")).map(it => it.getAsFile()).filter(Boolean);
      if (!imgs.length) return;
      e.preventDefault();
      const out = [];
      for (const f of imgs) { try { const { url, path } = await uploadPhoto(f); out.push({ id: "tf" + Math.random().toString(36).slice(2, 7), url, path, name: f.name || "貼上的照片", isImage: true }); } catch (_) {} }
      if (out.length) {
        const t = (tasksRef.current || []).find(x => x.id === tid);
        if (t) save((tasksRef.current || []).map(x => x.id === tid ? mergeTask(x, { files: [...(x.files || []), ...out] }, tasksRef.current) : x));
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canEdit]);
  // 刪除：同一次寫回完成「刪任務 + 清掉所有 dependsOn 引用」，不留中間態
  const del = async (id) => { if (!guard()) return; const t = (tasks || []).find(x => x.id === id); if (!(await confirm(`刪除任務「${t?.title || ""}」？`, { confirmLabel: "刪除" }))) return; save(removeTaskAndRefs(tasks, id)); setSel(null); onLog?.("刪除", `刪除任務「${(t?.title || "").slice(0, 20)}」`); };

  // 拖曳：把 dragId 移到 target 之前；可同時改 catId / status
  const moveTo = (dragId, { catId, status, beforeId } = {}) => {
    if (!guard() || !dragId) return;
    const list = [...(tasks || [])];
    const fi = list.findIndex(t => t.id === dragId); if (fi < 0) return;
    const moved = { ...list[fi] };
    if (catId !== undefined) moved.catId = catId;
    if (status !== undefined) moved.status = status;
    moved.updatedAt = new Date().toISOString();
    list.splice(fi, 1);
    let ti = beforeId ? list.findIndex(t => t.id === beforeId) : -1;
    if (ti < 0) {
      // 沒指定就放到「同群組」的最後
      const grpKey = catId !== undefined ? catId : moved.catId;
      const stKey = status !== undefined ? status : moved.status;
      let last = -1;
      list.forEach((t, idx) => { const okCat = view === "board" ? t.status === stKey : (t.catId || INBOX) === grpKey; if (okCat) last = idx; });
      ti = last + 1;
    }
    list.splice(ti, 0, moved);
    save(list);
  };

  // 載入中：skeleton（規格：淺灰佔位塊，不用轉圈）
  if (tasks === null) return (
    <div style={{ maxWidth: 1240, margin: "6px auto", padding: "0 4px" }}>
      {[38, 120, 120].map((h, i) => <div key={i} style={{ height: h, background: "#e6ddc9", borderRadius: 8, marginBottom: 12 }} />)}
    </div>
  );

  const groups = [{ id: INBOX, name: "收件匣" }, ...(cats || []).filter(c => !c.nonProject).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(c => ({ id: c.id, name: c.name, color: c.color || "", tcol: c.tcol }))]; // 照 order 排＝拖曳排序後全視角一致；color=大項底色
  const tasksOf = (catId) => tasks.filter(t => (t.catId || INBOX) === catId);
  const open = tasks.filter(t => t.status !== "done");
  const matchQ = (t) => !q.trim() || (t.title + (t.note || "") + (t.tags || []).join("")).toLowerCase().includes(q.trim().toLowerCase());

  // ── 任務小卡 ──
  const WDZH = ["日", "一", "二", "三", "四", "五", "六"];
  const wdOf = (d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `（${WDZH[new Date(d + "T00:00:00").getDay()]}）` : "";
  const Card = ({ t, dropBefore }) => {
    const done = t.status === "done";
    const hot = !done && t.due === today(); // 今日必處理＝發亮紅（張良 2026-09-10）
    const baseShadow = hot ? "0 0 0 2px rgba(212,22,29,.20), 0 2px 10px rgba(212,22,29,.32)" : "0 1px 3px rgba(29,26,21,.10)";
    return (
      <div key={t.id} draggable={canEdit}
        onDragStart={e => { setDrag(t.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDrag(null); setOverKey(null); }}
        onDragOver={e => { if (drag && dropBefore) { e.preventDefault(); e.stopPropagation(); } }}
        onDrop={e => { if (drag && dropBefore) { e.preventDefault(); e.stopPropagation(); moveTo(drag, { catId: view === "group" ? t.catId : undefined, status: view === "board" ? t.status : undefined, beforeId: t.id }); setDrag(null); setOverKey(null); } }}
        onClick={() => setSel(t.id)}
        style={done
          // 已完成：沉下去（透明底＋虛線框＋降透明度、無陰影）——跟待辦一眼分開
          ? { background: "transparent", border: `1px dashed ${C.line}`, borderRadius: 8, padding: "5px 8px", marginBottom: 5, cursor: canEdit ? "grab" : "pointer", opacity: drag === t.id ? 0.4 : 0.6 }
          // 待辦：浮起來（白底/色底＋硬框＋紙感陰影，懸停再浮一點）；2026-09-10 緊湊化（張良：卡片空白越少越好）；今日必處理＝紅框紅光
          : { background: t.color || "#fff", border: hot ? "1.5px solid #d4161d" : "1.5px solid #c8bca6", borderRadius: 8, padding: "5px 8px", marginBottom: 5, cursor: canEdit ? "grab" : "pointer", opacity: drag === t.id ? 0.4 : 1, boxShadow: baseShadow, transition: "box-shadow .12s, transform .12s" }}
        onMouseEnter={e => { hoverCardRef.current = t.id; if (!done) { e.currentTarget.style.boxShadow = hot ? "0 0 0 2px rgba(212,22,29,.28), 0 4px 14px rgba(212,22,29,.4)" : "0 3px 10px rgba(29,26,21,.16)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
        onMouseLeave={e => { if (hoverCardRef.current === t.id) hoverCardRef.current = null; if (!done) { e.currentTarget.style.boxShadow = baseShadow; e.currentTarget.style.transform = "none"; } }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { status: done ? "todo" : "done" }); }}
            title="切換完成" style={{ flexShrink: 0, width: 16, height: 16, marginTop: 2, borderRadius: 4, border: `1px solid ${done ? C.green : "#c8bca6"}`, background: done ? C.green : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>{done && <Check size={11} color="#fff" strokeWidth={3} />}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: done ? C.faint : C.text, textDecoration: done ? "line-through" : "none", lineHeight: 1.35, wordBreak: "break-word" }}>
              {t.priority === "urgent" && <Flame size={12} color={C.red} style={{ flexShrink: 0 }} />}{t.title}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
              {view !== "group" && <span style={{ fontSize: 11, color: C.faint, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catName(t.catId)}</span>}
              {t.due && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontVariantNumeric: "tabular-nums", color: (!done && t.due < today()) ? C.red : C.sub }}><Calendar size={11} />{t.due}{wdOf(t.due)}</span>}
              {(t.files || []).length > 0 && <span title={`${t.files.length} 個附件`} style={{ fontSize: 11, color: C.sub }}>📎{t.files.length}</span>}
              {view !== "board" && <Pill color={sColor(t.status)} label={sLabel(t.status)} />}
              {isWaiting(t) && !done && <Pill color={C.amber} label={`等：${t.waitingFor}`} />}
              {isBlocked(t, tasks) && !done && <Pill color={C.red} label="被前置卡住" />}
              {(t.tags || []).map(tg => <span key={tg} style={{ fontSize: 10.5, color: C.sub, background: C.soft, borderRadius: 999, padding: "0 6px", whiteSpace: "nowrap" }}>{tg}</span>)}
              {/* /prep 特色（2026-10-02 整併保留）：發現者/我來解決＋計時/審核/發布 */}
              {t.by && <span title="發現/回報者" style={{ fontSize: 10.5, color: C.faint, whiteSpace: "nowrap" }}>👁 {t.by}</span>}
              {t.claimBy && !done && <span title="處理中" style={{ fontSize: 10.5, color: "#1d4e79", fontWeight: 700, whiteSpace: "nowrap" }}>🔧 {t.claimBy}{t.claimAt ? `・已${Math.max(0, Math.floor((Date.now() - t.claimAt) / 60000))}分` : ""}</span>}
              {t.prepPending === 1 && !done && <Pill color={C.amber} label="🕐 待審核" />}
              {t.prepPub === "pending" && <Pill color={C.amber} label="等發布" />}
              {canEdit && !done && !t.claimBy && userName && <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { claimBy: userName, claimAt: Date.now(), status: "doing" }); }} style={{ border: "1px solid #9ec5e8", background: "#eaf2fa", color: "#1d4e79", borderRadius: 999, padding: "0 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>🙋 我來解決</button>}
              {canEdit && !done && t.claimBy === userName && userName && <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { claimBy: "", claimAt: null, status: "todo" }); }} style={{ border: "1px solid #d9cfbd", background: "#fff", color: "#8a7a5e", borderRadius: 999, padding: "0 8px", fontSize: 10.5, cursor: "pointer" }}>放棄</button>}
            </div>
            {/* 卡上照片（張良 2026-09-10：貼上就要看得到）：第一張當封面、其餘小縮圖；已完成不佔版面 */}
            {!done && (t.files || []).some(f => f.isImage) && (() => {
              const imgs = (t.files || []).filter(f => f.isImage);
              return (
                <div style={{ marginTop: 5 }}>
                  <img src={imgs[0].url} alt="" loading="lazy" style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.line}`, display: "block" }} />
                  {imgs.length > 1 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
                      {imgs.slice(1, 4).map(f => <img key={f.id} src={f.url} alt="" loading="lazy" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 5, border: `1px solid ${C.line}` }} />)}
                      {imgs.length > 4 && <span style={{ fontSize: 10.5, color: C.faint }}>+{imgs.length - 4}</span>}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {canEdit && !done && (t.due === today()
            ? <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { due: t.prevDue !== undefined ? t.prevDue : "", prevDue: undefined }); }} title={`退出今天必處理${t.prevDue ? `（恢復原截止日 ${t.prevDue}）` : "（清空截止日）"}`} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "2px", color: C.red }}><Sun size={13} fill={C.red} /></button>
            : <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { due: today(), prevDue: t.due || "" }); }} title="設為今天必處理（再按一次可退出）" style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "2px", color: "#c8bca6" }} onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = "#c8bca6"}><Sun size={13} /></button>)}
          {(canEdit || t.pinned) && <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { pinned: !t.pinned }); }} title={t.pinned ? "取消釘選" : "釘選到最上面"} style={{ flexShrink: 0, background: "none", border: "none", cursor: canEdit ? "pointer" : "default", lineHeight: 1, padding: "2px", color: t.pinned ? C.accent : "#c8bca6" }}><Pin size={13} fill={t.pinned ? C.accent : "none"} /></button>}
          {t.owner && <span title={`負責人：${t.owner}`} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: C.accentSoft, color: C.accent, fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", overflow: "hidden" }}>{t.owner.slice(0, 2)}</span>}
          {canEdit && <button onClick={e => { e.stopPropagation(); del(t.id); }} title="刪除" style={{ flexShrink: 0, background: "none", border: "none", color: C.faint, cursor: "pointer", lineHeight: 1, padding: "2px" }} onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = C.faint}><X size={14} /></button>}
        </div>
      </div>
    );
  };

  // 群組/欄 的落點容器（拖到空白處 → 歸到該群/欄末端）
  const DropZone = ({ keyId, onDropHere, children, style }) => (
    <div key={keyId}
      onDragOver={e => { if (drag) { e.preventDefault(); setOverKey(keyId); } }}
      onDragLeave={() => setOverKey(k => k === keyId ? null : k)}
      onDrop={e => { if (drag) { e.preventDefault(); onDropHere(); setDrag(null); setOverKey(null); } }}
      style={{ ...style, outline: overKey === keyId ? `1px dashed ${C.accent}` : "none", outlineOffset: -1 }}>
      {children}
    </div>
  );

  const TABS = [["group", "依大項", LayoutGrid], ["board", "看板", Columns3], ["list", "清單", List], ["timeline", "時間軸", CalendarDays], ["gantt", "甘特", ChartGantt], ["mind", "心智圖", Network]];
  const Tab = (k, l, Icon) => (
    <button key={k} onClick={() => setView(k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, border: `1px solid ${view === k ? C.line : "transparent"}`, background: view === k ? "#fff" : "transparent", color: view === k ? C.text : C.sub, fontSize: 13, fontWeight: view === k ? 600 : 400, cursor: "pointer" }}>
      <Icon size={14} strokeWidth={1.75} />{l}
    </button>
  );

  // 空狀態：淺灰圖示 + 一行說明
  const Empty = ({ icon: Icon, text, pad = 10 }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: `${pad}px 0`, color: C.faint }}>
      <Icon size={18} strokeWidth={1.5} /><span style={{ fontSize: 12, color: C.sub }}>{text}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 1240, margin: "6px auto", padding: 16, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12 }}>
      {/* 標題 + 視角切換 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <ListTodo size={18} strokeWidth={1.75} color={C.sub} />
        <div style={{ fontSize: 17, fontWeight: 600, color: C.text }}>任務中心</div>
        <span style={{ fontSize: 12, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{open.length} 件待辦・共 {tasks.length} 件</span>
        <div style={{ flex: 1 }} />
        {/* 全域搜尋：六個視角通用（避免在別的視角被看不見的搜尋條件默默過濾） */}
        <div style={{ position: "relative" }}>
          <Search size={13} strokeWidth={1.75} color={C.faint} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋任務…" style={{ ...inp, width: 170, padding: "6px 10px 6px 28px", fontSize: 12.5 }} />
          {q && <button onClick={() => setQ("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.faint, cursor: "pointer", padding: 0, display: "flex" }}><X size={13} /></button>}
        </div>
        {/* 排序切換：看板/清單可切 手動(拖曳)/日期/重要度；釘選永遠最前 */}
        {(view === "board" || view === "list") && (
          <div style={{ display: "inline-flex", alignItems: "center", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
            <ArrowUpDown size={12} color={C.faint} style={{ margin: "0 2px 0 7px" }} />
            {[["manual", "手動"], ["due", "日期"], ["prio", "重要度"]].map(([k, l]) => { // 清單也開放手動拖曳排序（張良 2026-09-10）
              const act = sortMode === k;
              return <button key={k} onClick={() => setSortMode(k)} style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${act ? C.line : "transparent"}`, background: act ? "#fff" : "transparent", color: act ? C.text : C.sub, fontSize: 12, fontWeight: act ? 600 : 400, cursor: "pointer" }}>{l}</button>;
            })}
          </div>
        )}
        {/* Today 是 Home（落地頁），不是第七個並列視角 → 獨立按鈕放在視角切換器外面 */}
        <button onClick={() => setView("today")} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${view === "today" ? C.accent : C.line}`, background: view === "today" ? C.accent : "#fff", color: view === "today" ? "#fff" : C.sub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <Home size={14} strokeWidth={1.75} />今日
        </button>
        <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2, flexWrap: "wrap" }}>
          {TABS.map(([k, l, I]) => Tab(k, l, I))}
        </div>
      </div>

      {/* 快速隨手記 */}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) addQuick(); }}
            placeholder="隨手丟一句任務…（先進收件匣，之後再拖到大項整理）按 Enter 新增" style={{ ...inp, flex: 1, fontSize: 13.5, padding: "10px 12px" }} />
          <button onClick={addQuick} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "0 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}><Plus size={15} strokeWidth={2} />新增</button>
        </div>
      )}

      {/* ── Today / Home：每天打開的落地頁，回答「我今天該做什麼」──
           全部由同一份 tasks 即時推導（不存任何 view 專屬資料）；每個任務依緊急度只出現在一個區塊 */}
      {view === "today" && (() => {
        const t0 = today();
        const openT = tasks.filter(t => t.status !== "done").filter(matchQ);
        const used = new Set();
        const take = (arr) => { const out = arr.filter(t => !used.has(t.id)); out.forEach(t => used.add(t.id)); return out; };
        const prioOrd = { urgent: 0, high: 1, normal: 2, low: 3 };
        const byUrgency = (a, b) => ((a.due || "9999") !== (b.due || "9999")) ? ((a.due || "9999") < (b.due || "9999") ? -1 : 1) : ((prioOrd[a.priority] ?? 2) - (prioOrd[b.priority] ?? 2));
        // 去重順序＝緊急度：必處理 → 進行中 → 被卡住 → 在等別人 → Quick Wins → 七天內
        const pinFirst = (arr) => orderTasks(arr, "manual"); // 釘選排區塊最前
        const dueNow = pinFirst(take(openT.filter(t => t.due && t.due <= t0)).sort(byUrgency));
        const doing = pinFirst(take(openT.filter(t => t.status === "doing")).sort(byUrgency));
        const blockedArr = pinFirst(take(openT.filter(t => isBlocked(t, tasks))).sort(byUrgency));
        const waitingArr = pinFirst(take(openT.filter(t => isWaiting(t))).sort(byUrgency));
        const quick = pinFirst(take(openT.filter(t => isQuickWin(t))).sort(byUrgency));
        const upcoming = pinFirst(take(openT.filter(t => t.due && t.due > t0 && (new Date(t.due) - new Date(t0)) / 86400000 <= 7)).sort(byUrgency));
        const allClear = false; // 「今天必處理」改為常駐區塊，不再整頁 all-clear
        const d = new Date();
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}（週${"日一二三四五六"[d.getDay()]}）`;
        const inboxOpen = openT.filter(t => (t.catId || INBOX) === INBOX).length;
        const depNames = (t) => (t.dependsOn || []).map(id => { const x = tasks.find(y => y.id === id); return x && x.status !== "done" ? x.title : null; }).filter(Boolean);
        const Section = ({ icon: Icon, color, label, hint, children }) => (
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <Icon size={14} strokeWidth={1.75} color={color} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</span>
              {hint && <span style={{ fontSize: 11, color: C.faint }}>{hint}</span>}
            </div>
            {children}
          </div>
        );
        const Grid = ({ arr }) => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 }}>{arr.map(t => Card({ t }))}</div>;
        return (
          <div style={{ display: "grid", gap: 12 }}>
            {/* 問候＋大數字摘要卡（gpack 式 mono 大數字＝視覺錨點，一眼知道今天量級） */}
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, padding: "2px 2px 0" }}>今天 {dateStr}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
              {[[dueNow.length, "今天必處理", C.red], [quick.length, `Quick Wins ≤${QUICK_WIN_MAX_MINUTES}分`, C.green], [waitingArr.length, "在等別人", C.amber], [blockedArr.length, "被前置卡住", C.faint]].map(([n, l, cl]) => (
                <div key={l} style={{ background: C.card, border: "1.5px solid #c8bca6", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: n > 0 ? C.text : C.faint, lineHeight: 1.1 }}>{n}</div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: cl, flexShrink: 0 }} />{l}
                  </div>
                </div>
              ))}
            </div>
            {allClear && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "40px 0", background: C.card, border: `1px solid ${C.line}`, borderRadius: 8 }}>
                <Coffee size={22} strokeWidth={1.5} color={C.faint} />
                <span style={{ fontSize: 13, color: C.sub }}>今天沒有急事{inboxOpen > 0 ? `——收件匣還有 ${inboxOpen} 件可以整理` : "，全部都乾淨"}</span>
              </div>
            )}
            <Section icon={CircleAlert} color={C.red} label="今天必處理" hint="逾期與今天到期・卡片按 ☀ 可直接排進來">{dueNow.length ? <Grid arr={dueNow} /> : <div style={{ fontSize: 12.5, color: C.faint, padding: "6px 2px" }}>目前沒有——任何卡片按 ☀ 就會排到今天。</div>}</Section>
            {doing.length > 0 && <Section icon={CirclePlay} color={C.accent} label="進行中" hint="手上正在做的"><Grid arr={doing} /></Section>}
            {quick.length > 0 && <Section icon={Zap} color={C.green} label="Quick Wins" hint={`≤ ${QUICK_WIN_MAX_MINUTES} 分鐘可完成，有空檔就清掉`}>
              {(() => {
                // 按預估時間分欄（5 / 10 / 15 分）——空檔多長就挑哪欄
                const b5 = quick.filter(t => t.estimatedMinutes <= 5), b10 = quick.filter(t => t.estimatedMinutes > 5 && t.estimatedMinutes <= 10), b15 = quick.filter(t => t.estimatedMinutes > 10);
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
                    {[["≤ 5 min", b5], ["6–10 min", b10], ["11–15 min", b15]].map(([l, arr]) => arr.length > 0 && (
                      <div key={l}>
                        <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>{l}</div>
                        {arr.map(t => Card({ t }))}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Section>}
            {waitingArr.length > 0 && <Section icon={Clock} color={C.amber} label="在等別人" hint="該催的去催一下">
              <Grid arr={waitingArr} />
            </Section>}
            {blockedArr.length > 0 && <Section icon={Hourglass} color={C.sub} label="被前置卡住" hint="前置任務完成後才能動工">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 }}>
                {blockedArr.map(t => (
                  <div key={t.id}>
                    {Card({ t })}
                    <div style={{ fontSize: 11, color: C.faint, margin: "-4px 2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>等：{depNames(t).join("、")}</div>
                  </div>
                ))}
              </div>
            </Section>}
            {upcoming.length > 0 && <Section icon={CalendarDays} color={C.sub} label="接下來 7 天" hint="先心裡有數"><Grid arr={upcoming} /></Section>}
            {/* 各大項一眼：任務完成度 + 今天 + 卡住（GPT 建議的 Project 摘要，資料同一份即時算） */}
            {(() => {
              const rows = (cats || []).filter(c => !c.nonProject).map(c => {
                const ts = tasks.filter(t => (t.catId || INBOX) === c.id);
                if (!ts.length) return null;
                const done = ts.filter(t => t.status === "done").length;
                const tdN = ts.filter(t => t.status !== "done" && t.due && t.due <= t0).length;
                const blkN = ts.filter(t => t.status !== "done" && isBlocked(t, tasks)).length;
                return { c, total: ts.length, done, tdN, blkN, pct: Math.round(done / ts.length * 100) };
              }).filter(Boolean);
              if (!rows.length) return null;
              return (
                <Section icon={LayoutGrid} color={C.sub} label="各大項一眼" hint="任務完成度・今天・卡住">
                  <div style={{ display: "grid", gap: 9 }}>
                    {rows.map(r => (
                      <div key={r.c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 130, flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.c.name}</span>
                        <div style={{ flex: 1, height: 8, background: "#e6ddc9", borderRadius: 6, overflow: "hidden" }}>
                          <div style={{ width: r.pct + "%", height: "100%", background: r.pct === 100 ? C.green : "#3a6ea5", borderRadius: 6 }} />
                        </div>
                        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.text, width: 44, textAlign: "right", flexShrink: 0 }}>{r.pct}%</span>
                        <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint, width: 40, textAlign: "right", flexShrink: 0 }}>{r.done}/{r.total}</span>
                        <span style={{ fontSize: 11, color: r.tdN > 0 ? C.red : C.faint, fontWeight: r.tdN > 0 ? 700 : 400, width: 52, textAlign: "right", flexShrink: 0 }}>今天 {r.tdN}</span>
                        <span style={{ fontSize: 11, color: r.blkN > 0 ? C.sub : C.faint, fontWeight: r.blkN > 0 ? 700 : 400, width: 52, textAlign: "right", flexShrink: 0 }}>卡住 {r.blkN}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              );
            })()}
          </div>
        );
      })()}

      {/* ── 依大項分組（瀑布流：卡片各自貼緊往下堆，不互相撐高度；空大項收到最下面）── */}
      {view === "group" && (() => {
        const withItems = groups.map(g => ({ g, items: orderTasks(tasksOf(g.id).filter(matchQ), "manual") }));
        // 完成＝封存隱藏（張良 2026-09-10）：預設不顯示已完成，右上「已完成 N」可切換回來看/取消完成
        const vis = (items) => showDone ? items : items.filter(t => t.status !== "done");
        const doneTotal = withItems.reduce((s, x) => s + x.items.filter(t => t.status === "done").length, 0);
        const inboxX = withItems.find(x => x.g.id === INBOX);
        const filled = withItems.filter(x => x.g.id !== INBOX && vis(x.items).length > 0);
        const empties = withItems.filter(x => x.g.id !== INBOX && vis(x.items).length === 0); // 全完成的大項也收進來
        const gInput = (gid, slim) => canEdit && <input value={gnew[gid] || ""} onChange={e => setGnew(p => ({ ...p, [gid]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) addToGroup(gid); }} placeholder={slim ? "＋ 新增或拖到這裡…" : "＋ 直接在此大項新增…"} style={{ flex: slim ? 1 : undefined, width: slim ? undefined : "100%", minWidth: 0, boxSizing: "border-box", border: `1px dashed ${C.line}`, borderRadius: 8, padding: slim ? "4px 9px" : "6px 10px", fontSize: slim ? 12 : 12.5, background: "transparent", color: C.text, outline: "none", marginTop: slim ? 0 : 4 }} />;
        // 大項名稱可編輯（點名稱＝改名；收件匣除外）：Enter/失焦儲存、Esc 取消
        const commitCatName = () => { if (editCat && editCat.name.trim() && onRenameCat) onRenameCat(editCat.id, editCat.name.trim()); setEditCat(null); };
        const gName = (g, slim) => {
          if (editCat?.id === g.id) return <input autoFocus value={editCat.name} onChange={e => setEditCat({ ...editCat, name: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) commitCatName(); if (e.key === "Escape") setEditCat(null); }} onBlur={commitCatName}
            style={{ fontSize: slim ? 12.5 : 13, fontWeight: 600, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: "1px 6px", background: "#fff", outline: "none", minWidth: 0, width: 130 }} />;
          const editable = canEdit && onRenameCat && g.id !== INBOX;
          return <div title={editable ? "點我改大項名稱" : undefined} onClick={editable ? () => setEditCat({ id: g.id, name: g.name }) : undefined}
            style={{ fontSize: slim ? 12.5 : 13, fontWeight: 600, color: g.id === INBOX ? C.accent : slim ? C.sub : C.text, whiteSpace: "nowrap", cursor: editable ? "text" : "default" }}>{g.name}</div>;
        };
        // 大項拖曳排序（張良 2026-09-10：像 Trello/Keep）：拖標題列＝搬整個大項；放到別的大項上＝插到它前面
        const canDragCat = (g) => canEdit && onMoveCat && g.id !== INBOX;
        // 拖到目標「上半部＝排它上面、下半部＝排它下面」（張良 2026-09-10：要能拖去任何想放的地方）；插入位置顯示紅色提示線
        const dropPos = (e) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? "b" : "a"; };
        const catWrap = (g, inner, extraStyle) => (
          <div key={g.id}
            onDragOver={e => { if (dragCat && dragCat !== g.id && g.id !== INBOX) { e.preventDefault(); e.stopPropagation(); setOverCat(g.id + ":" + dropPos(e)); } }}
            onDragLeave={() => setOverCat(k => (k || "").startsWith(g.id + ":") ? null : k)}
            onDrop={e => { if (dragCat && dragCat !== g.id && g.id !== INBOX) { e.preventDefault(); e.stopPropagation(); const p = dropPos(e); onMoveCat(dragCat, { [p === "b" ? "beforeId" : "afterId"]: g.id, col: colOfRef.current[g.id], freeze: { ...colOfRef.current } }); setDragCat(null); setOverCat(null); } }}
            style={{ ...extraStyle, opacity: dragCat === g.id ? 0.4 : 1, borderRadius: 8,
              boxShadow: dragCat && overCat === g.id + ":b" ? `0 -4px 0 0 ${C.accent}` : dragCat && overCat === g.id + ":a" ? `0 4px 0 0 ${C.accent}` : "none" }}>
            {inner}
          </div>
        );
        // 大項調色鈕（張良 2026-09-10）：點小圓點→展開 7 色，同色＝同區塊好辨識（例：採購-廚房、採購-器具都選杏）
        const catColorBtn = (g) => canEdit && onSetCatColor && g.id !== INBOX && (
          <button onClick={e => { e.stopPropagation(); setColorCat(colorCat === g.id ? null : g.id); }} title="大項顏色"
            style={{ marginLeft: "auto", flexShrink: 0, width: 15, height: 15, borderRadius: "50%", background: g.color || "#fff", border: `1.5px solid ${C.line}`, cursor: "pointer", padding: 0 }} />
        );
        const catPalette = (g) => colorCat === g.id && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "2px 2px 8px" }}>
            {PALETTE.map(([cv, cl]) => (
              <button key={cl} title={cl} onClick={e => { e.stopPropagation(); onSetCatColor(g.id, cv); setColorCat(null); }}
                style={{ width: 21, height: 21, borderRadius: "50%", background: cv || "#fff", cursor: "pointer", padding: 0,
                  border: (g.color || "") === cv ? "2.5px solid #d4161d" : `1.5px solid ${C.line}` }} />
            ))}
          </div>
        );
        const catHead = (g, items) => (
          <div draggable={canDragCat(g)}
            onDragStart={e => { if (!canDragCat(g)) return; e.stopPropagation(); setDragCat(g.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { setDragCat(null); setOverCat(null); }}
            title={canDragCat(g) ? "拖我＝搬整個大項排序" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7, padding: "0 2px", cursor: canDragCat(g) ? "grab" : "default" }}>
            {g.id === INBOX ? <Inbox size={13} strokeWidth={1.75} color={C.accent} /> : (canDragCat(g) && <GripVertical size={12} strokeWidth={1.75} color={C.faint} style={{ flexShrink: 0 }} />)}
            {gName(g, false)}
            <span style={{ fontSize: 11.5, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{items.length}</span>
            {catColorBtn(g)}
          </div>
        );
        // 大項卡（照片牆用同一顆）
        const groupCard = ({ g, items }) => catWrap(g, DropZone({ keyId: g.id, onDropHere: () => moveTo(drag, { catId: g.id }),
          style: { background: g.color || C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 8 },
          children: <>
            {catHead(g, vis(items))}
            {catPalette(g)}
            {vis(items).map(t => Card({ t, dropBefore: true }))}
            {gInput(g.id, false)}
          </> }), {});
        // ── Keep 式瀑布流（治本：CSS columns 遇到超長大項會縮到最少欄）──
        // 欄數＝「實際容器寬」÷ 每欄最少 250（張良 2026-09-10：卡片的字不能壓縮——用量到的寬度算，欄永遠 ≥250 不再壓字）；
        // 第 0 欄固定＝收件匣＋「沒有任務的大項」；其餘大項逐一丟進「目前最矮的欄」→ 每一欄都會用到
        const gwEff = gw || (vw - 100);
        const NCOL = isMobile ? 1 : Math.max(1, Math.min(8, Math.floor((gwEff + 10) / (250 + 10))));
        const cols = Array.from({ length: NCOL }, () => ({ w: 0, nodes: [] }));
        const emptiesBlock = (empties.length > 0 || (canEdit && onAddCat)) && (
          <div key="empties" style={{ border: `1px dashed ${C.line}`, borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 10.5, letterSpacing: 0.5, fontWeight: 500, color: C.faint, marginBottom: 6, padding: "0 2px" }}>沒有任務的大項（拖任務進來就會長出去）</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {empties.map(({ g, items }) => catWrap(g, DropZone({ keyId: g.id, onDropHere: () => moveTo(drag, { catId: g.id }),
                style: { background: g.color || C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px" },
                children: (<>
                  <div draggable={canDragCat(g)}
                    onDragStart={e => { if (!canDragCat(g)) return; e.stopPropagation(); setDragCat(g.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragCat(null); setOverCat(null); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: canDragCat(g) ? "grab" : "default" }}>
                    {canDragCat(g) && <GripVertical size={12} strokeWidth={1.75} color={C.faint} style={{ flexShrink: 0 }} />}
                    {gName(g, true)}
                    {!showDone && items.length > 0 && <span title="這個大項的任務全完成了" style={{ fontSize: 10.5, color: C.green, flexShrink: 0 }}>✓{items.length}</span>}
                    {gInput(g.id, true) || <span style={{ fontSize: 11.5, color: C.faint }}>0</span>}
                    {catColorBtn(g)}
                  </div>
                  {catPalette(g)}
                </>) })))}
              {/* 直接新增大項（會同步建立到總覽的工程大項） */}
              {canEdit && onAddCat && (
                <div style={{ border: `1px dashed ${C.line}`, borderRadius: 8, padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                  <FolderPlus size={13} strokeWidth={1.75} color={C.faint} style={{ flexShrink: 0 }} />
                  <input value={newCatIn} onChange={e => setNewCatIn(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && newCatIn.trim()) { onAddCat(newCatIn.trim()); setNewCatIn(""); } }}
                    placeholder="＋ 新增大項" style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 12, color: C.text }} />
                </div>
              )}
            </div>
          </div>
        );
        // 佈局三版（張良 2026-09-10：放哪就「釘」哪、不回彈）：每個大項把自己在第幾欄存進 tcol——
        // 拖到某大項上＝繼承那一欄＋排它下方，永久固定；沒拖過的自動補到最矮欄；欄數變少時 tcol 自動夾回範圍
        colOfRef.current = {};
        const orderIdx = {}; groups.forEach((g, i) => { orderIdx[g.id] = i; });
        const wOf = (x) => 2.2 + vis(x.items).length;
        cols[0].nodes.push(<div key="inbox">{groupCard(inboxX)}</div>);
        cols[0].w += 2.5 + vis(inboxX.items).length;
        if (emptiesBlock) { cols[0].nodes.push(emptiesBlock); cols[0].w += 2 + empties.length * 0.6; }
        const colEntries = Array.from({ length: NCOL }, () => []);
        const pinnedX = filled.filter(x => Number.isInteger(x.g.tcol));
        const autosX = filled.filter(x => !Number.isInteger(x.g.tcol));
        for (const x of pinnedX) { const k = Math.min(Math.max(0, x.g.tcol), NCOL - 1); colEntries[k].push(x); cols[k].w += wOf(x); colOfRef.current[x.g.id] = k; }
        for (const x of autosX) { let k = 0; for (let i = 1; i < NCOL; i++) if (cols[i].w < cols[k].w) k = i; colEntries[k].push(x); cols[k].w += wOf(x); colOfRef.current[x.g.id] = k; }
        colEntries.forEach((list, k) => { list.sort((a, b) => orderIdx[a.g.id] - orderIdx[b.g.id]); list.forEach(x => cols[k].nodes.push(<div key={x.g.id}>{groupCard(x)}</div>)); });
        return (
          <div ref={groupWrapRef}>
            {/* 已完成＝封存：預設隱藏，這裡切換（張良 2026-09-10） */}
            {(doneTotal > 0 || showDone) && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button onClick={() => setShowDone(!showDone)} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${showDone ? C.green : C.line}`, background: showDone ? "#eef4ee" : "#fff", color: showDone ? C.green : C.sub, borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Check size={12} strokeWidth={2.5} />已完成 {doneTotal}{showDone ? "・點我收起" : "・點我顯示"}
                </button>
              </div>
            )}
            {/* 每欄至少 250；拖大項到某欄空白處＝釘到那一欄最下面 */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              {cols.map((c, i) => (
                <div key={i}
                  onDragOver={e => { if (dragCat) { e.preventDefault(); setOverCat("col-" + i); } }}
                  onDragLeave={() => setOverCat(k => k === "col-" + i ? null : k)}
                  onDrop={e => { if (dragCat) { e.preventDefault(); onMoveCat(dragCat, { col: i, freeze: { ...colOfRef.current } }); setDragCat(null); setOverCat(null); } }}
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: dragCat ? 220 : undefined, borderRadius: 8, outline: dragCat && overCat === "col-" + i ? `2px dashed ${C.accent}` : "none", outlineOffset: 2 }}>
                  {c.nodes}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── 看板（依狀態） ── */}
      {view === "board" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, alignItems: "start" }}>
          {STATUS.map(([sk, sl, sc]) => {
            const items = orderTasks(tasks.filter(t => t.status === sk).filter(matchQ), sortMode); // 依排序模式；釘選最前
            // 「完成」欄會無限累積 → 預設只列最近 8 件，其餘收起
            const shown = (sk === "done" && !showAllDone) ? items.slice(0, 8) : items;
            const hidden = items.length - shown.length;
            return DropZone({ keyId: sk, onDropHere: () => moveTo(drag, { status: sk }),
              style: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, minHeight: 120 },
              children: <>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: sc }} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{sl}</div>
                  <span style={{ fontSize: 11.5, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{items.length}</span>
                </div>
                {shown.map(t => Card({ t, dropBefore: true }))}
                {hidden > 0 && <button onClick={() => setShowAllDone(true)} style={{ width: "100%", background: "none", border: `1px dashed ${C.line}`, borderRadius: 8, padding: "6px 0", fontSize: 12, color: C.sub, cursor: "pointer" }}>顯示全部（還有 {hidden} 件）</button>}
                {sk === "done" && showAllDone && items.length > 8 && <button onClick={() => setShowAllDone(false)} style={{ width: "100%", background: "none", border: "none", padding: "6px 0", fontSize: 12, color: C.faint, cursor: "pointer" }}>收起</button>}
                {items.length === 0 && <Empty icon={Columns3} text="拖到這欄" />}
              </> });
          })}
        </div>
      )}

      {/* ── 清單 ── */}
      {view === "list" && (() => {
        let rows = tasks.filter(matchQ).filter(t => fStatus === "all" || (fStatus === "open" ? t.status !== "done" : t.status === fStatus));
        rows = orderTasks(rows, sortMode); // 清單依 手動(可拖曳)/日期/重要度；釘選最前
        return (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                {[["open", "未完成"], ["all", "全部"], ["done", "已完成"]].map(([k, l]) => (
                  <button key={k} onClick={() => setFStatus(k)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${fStatus === k ? C.line : "transparent"}`, background: fStatus === k ? "#fff" : "transparent", color: fStatus === k ? C.text : C.sub, fontSize: 12.5, fontWeight: fStatus === k ? 600 : 400, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
            </div>
            {/* Linear 式密表：一件一行 36px、欄位對齊、唯讀掃讀；點列開詳情 */}
            <div style={{ border: "1.5px solid #c8bca6", borderRadius: 8, background: C.card, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                {/* 張良 2026-07-26 手機版全面體檢：手機不橫滑，只留 勾選/標題/截止/狀態 四欄；桌機八欄不變 */}
                <div style={isMobile ? undefined : { minWidth: 880 }}>
                  {(() => {
                    const GTC = isMobile ? "34px minmax(0,1fr) 72px 88px" : "34px minmax(220px,1fr) 72px 96px 130px 52px 130px 88px";
                    const hc = { fontSize: 10.5, letterSpacing: 0.8, color: C.faint, fontWeight: 600, padding: "7px 8px", whiteSpace: "nowrap" };
                    const overdue = (t) => t.status !== "done" && t.due && t.due < today();
                    return (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: GTC, background: C.soft, borderBottom: "1.5px solid #c8bca6", alignItems: "center" }}>
                          <div />
                          <div style={hc}>標題</div><div style={hc}>截止</div>
                          {!isMobile && <><div style={hc}>負責人</div><div style={hc}>等待中</div><div style={hc}>優先</div><div style={hc}>大項</div></>}
                          <div style={hc}>狀態</div>
                        </div>
                        {rows.length === 0 ? <Empty icon={List} text="沒有任務" pad={24} /> :
                          rows.map((t, i) => {
                            const done = t.status === "done";
                            const pm = pMeta(t.priority);
                            return (
                              <div key={t.id} onClick={() => setSel(t.id)}
                                draggable={canEdit && sortMode === "manual"}
                                onDragStart={e => { setDrag(t.id); e.dataTransfer.effectAllowed = "move"; }}
                                onDragEnd={() => { setDrag(null); setOverKey(null); }}
                                onDragOver={e => { if (drag && sortMode === "manual") e.preventDefault(); }}
                                onDrop={e => { if (drag && sortMode === "manual") { e.preventDefault(); moveTo(drag, { beforeId: t.id }); setDrag(null); setOverKey(null); } }}
                                title={canEdit && sortMode === "manual" ? "拖我排序（丟到目標列＝排到它上面）" : undefined}
                                onMouseEnter={e => e.currentTarget.style.background = t.color || C.bg} onMouseLeave={e => e.currentTarget.style.background = t.color || C.card}
                                style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "center", height: 36, borderTop: i ? `1px solid ${C.line}` : "none", cursor: canEdit && sortMode === "manual" ? "grab" : "pointer", background: t.color || C.card, opacity: drag === t.id ? 0.4 : 1 }}>
                                <div style={{ display: "flex", justifyContent: "center" }}>
                                  <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { status: done ? "todo" : "done" }); }} style={{ width: 15, height: 15, borderRadius: 4, border: `1px solid ${done ? C.green : "#c8bca6"}`, background: done ? C.green : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>{done && <Check size={10} color="#fff" strokeWidth={3} />}</button>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 8px", fontSize: 13, color: done ? C.faint : C.text, textDecoration: done ? "line-through" : "none", overflow: "hidden", whiteSpace: "nowrap" }}>
                                  {t.pinned && <Pin size={11} color={C.accent} fill={C.accent} style={{ flexShrink: 0 }} />}
                                  {t.priority === "urgent" && !done && <Flame size={11} color={C.red} style={{ flexShrink: 0 }} />}
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                                </div>
                                <div style={{ padding: "0 8px", fontFamily: MONO, fontSize: 11.5, fontWeight: overdue(t) ? 700 : 500, color: overdue(t) ? C.red : (t.due ? C.sub : C.faint), whiteSpace: "nowrap" }}>{t.due ? t.due.slice(5) + wdOf(t.due) : "—"}</div>
                                {/* 張良 2026-07-26 手機版全面體檢：負責人/等待中/優先/大項 手機隱藏（點列開詳情仍可看） */}
                                {!isMobile && <>
                                  <div style={{ padding: "0 8px", fontSize: 12, color: t.owner ? C.text : C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                                    {t.owner && <span style={{ width: 17, height: 17, borderRadius: "50%", background: C.accentSoft, color: C.accent, fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{t.owner.slice(0, 2)}</span>}
                                    {t.owner || "—"}
                                  </div>
                                  <div style={{ padding: "0 8px", fontSize: 12, color: isWaiting(t) ? C.amber : C.faint, fontWeight: isWaiting(t) ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.waitingFor || "—"}</div>
                                  <div style={{ padding: "0 8px", fontSize: 12, fontWeight: t.priority === "urgent" ? 700 : 500, color: t.priority === "urgent" ? C.red : t.priority === "high" ? C.amber : t.priority === "low" ? C.faint : C.sub, whiteSpace: "nowrap" }}>{pm[1]}</div>
                                  <div style={{ padding: "0 8px", fontSize: 12, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catName(t.catId)}</div>
                                </>}
                                <div style={{ padding: "0 6px" }}><Pill color={sColor(t.status)} label={sLabel(t.status)} /></div>
                              </div>
                            );
                          })}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
            {rows.length > 0 && <div style={{ fontSize: 11, color: C.faint, marginTop: 6, fontFamily: MONO }}>{rows.length} 件</div>}
          </div>
        );
      })()}

      {/* ── 時間軸（依截止日分桶） ── */}
      {view === "timeline" && (() => {
        const t0 = today();
        const within = (d, n) => { if (!d) return false; const diff = (new Date(d) - new Date(t0)) / 86400000; return diff >= 0 && diff <= n; };
        const buckets = [
          ["逾期", CircleAlert, C.red, tasks.filter(t => t.status !== "done" && t.due && t.due < t0)],
          ["今天", Calendar, C.accent, tasks.filter(t => t.status !== "done" && t.due === t0)],
          ["本週內", CalendarDays, C.sub, tasks.filter(t => t.status !== "done" && t.due && t.due > t0 && within(t.due, 7))],
          ["之後", Clock, C.sub, tasks.filter(t => t.status !== "done" && t.due && t.due > t0 && !within(t.due, 7))],
          ["無日期", Inbox, C.faint, tasks.filter(t => !t.due && t.status !== "done")],
        ].map(([label, Icon, color, arr]) => [label, Icon, color, orderTasks(arr.filter(matchQ).sort((a, b) => (a.due || "9") < (b.due || "9") ? -1 : 1), "manual")]);
        return (
          <div style={{ display: "grid", gap: 12 }}>
            {buckets.map(([label, Icon, color, arr]) => arr.length > 0 && (
              <div key={label} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                  <Icon size={14} strokeWidth={1.75} color={color} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</span>
                  <span style={{ color: C.faint, fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{arr.length}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 }}>
                  {arr.map(t => Card({ t }))}
                </div>
              </div>
            ))}
            {tasks.length === 0 && <Empty icon={CalendarDays} text="還沒有任務" pad={24} />}
          </div>
        );
      })()}

      {/* ── 甘特圖（依開始～截止日畫橫條） ── */}
      {view === "gantt" && (() => {
        const dayMs = 86400000, dayW = 24;
        const sched = tasks.filter(t => t.due || t.start).filter(matchQ);
        const unsched = tasks.filter(t => !t.due && !t.start).filter(matchQ);
        if (sched.length === 0) return <Empty icon={ChartGantt} text="還沒有「有日期」的任務。到任務詳情設好開始/截止日，就會出現在甘特圖。" pad={24} />;
        const lo = (t) => new Date(dnorm(t.start || t.due));
        const hi = (t) => new Date(dnorm(t.due || t.start));
        let minD = new Date(Math.min(...sched.map(t => +lo(t)), +new Date(today())));
        let maxD = new Date(Math.max(...sched.map(t => +hi(t)), +new Date(today())));
        minD = new Date(+minD - 2 * dayMs); maxD = new Date(+maxD + 2 * dayMs);
        let totalDays = Math.round((maxD - minD) / dayMs) + 1;
        if (totalDays > 140) { maxD = new Date(+minD + 140 * dayMs); totalDays = 141; }
        const offset = (d) => Math.round((new Date(dnorm(d)) - minD) / dayMs);
        const ticks = []; for (let i = 0; i < totalDays; i += 7) { const d = new Date(+minD + i * dayMs); ticks.push({ i, label: `${d.getMonth() + 1}/${d.getDate()}` }); }
        const todayOff = offset(today());
        // 張良 2026-07-26 手機版全面體檢：手機左欄 200→96，任務名縮字＋省略號，時間軸多留空間（橫滑保留）
        const nameW = isMobile ? 96 : 200;
        return (
          <div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.card, overflow: "auto" }}>
              <div style={{ minWidth: nameW + totalDays * dayW }}>
                {/* 週刻度 */}
                <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.bg, zIndex: 3 }}>
                  <div style={{ width: nameW, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "6px 10px", fontSize: 11, letterSpacing: 0.5, color: C.faint, fontWeight: 500, position: "sticky", left: 0, background: C.bg, zIndex: 4 }}>任務</div>
                  <div style={{ position: "relative", height: 26 }}>
                    {ticks.map(tk => <div key={tk.i} style={{ position: "absolute", left: tk.i * dayW, top: 0, fontSize: 10.5, color: C.faint, fontVariantNumeric: "tabular-nums", padding: "6px 0 0 4px", borderLeft: `1px solid ${C.soft}`, height: 26, boxSizing: "border-box" }}>{tk.label}</div>)}
                  </div>
                </div>
                {/* 任務列 */}
                {sched.sort((a, b) => +lo(a) - +lo(b)).map((t, i) => {
                  const s = offset(t.start || t.due), e = offset(t.due || t.start);
                  const left = Math.min(s, e), width = Math.abs(e - s) + 1;
                  return (
                    <div key={t.id} onClick={() => setSel(t.id)}
                      onMouseEnter={ev => ev.currentTarget.style.background = t.color || C.bg} onMouseLeave={ev => ev.currentTarget.style.background = t.color || "#fff"}
                      style={{ display: "flex", alignItems: "center", borderTop: i ? `1px solid ${C.soft}` : "none", cursor: "pointer", background: t.color || "#fff" }}>
                      {/* 張良 2026-07-26 手機版全面體檢：手機左欄縮窄、任務名縮字並用 span 包住才吃得到 ellipsis；手機省略「・大項」後綴 */}
                      <div style={{ width: nameW, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "7px 10px", fontSize: isMobile ? 11 : 12.5, color: t.status === "done" ? C.faint : C.text, overflow: "hidden", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, position: "sticky", left: 0, background: "inherit", zIndex: 2 }}>{t.priority === "urgent" && <Flame size={11} color={C.red} style={{ flexShrink: 0 }} />}<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>{!isMobile && <span style={{ fontSize: 10.5, color: C.faint, flexShrink: 0 }}>・{catName(t.catId)}</span>}</div>
                      <div style={{ position: "relative", height: 30, flex: 1 }}>
                        {todayOff >= 0 && todayOff < totalDays && <div style={{ position: "absolute", left: todayOff * dayW, top: 0, bottom: 0, width: 1, background: C.red, opacity: .45 }} />}
                        <div title={`${t.start || t.due} ~ ${t.due || t.start}`} style={{ position: "absolute", left: left * dayW + 2, top: 9, height: 12, width: Math.max(width * dayW - 4, 8), background: t.status === "done" ? C.green : C.accent, borderRadius: 999, opacity: t.status === "done" ? 0.45 : 1 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>紅線＝今天。點任務列可編輯日期。</div>
            {unsched.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 0.5, fontWeight: 500, color: C.faint, marginBottom: 8 }}>未排程（沒設日期）{unsched.length}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 }}>{unsched.map(t => Card({ t }))}</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 心智圖（中心→大項→任務 樹狀） ── */}
      {view === "mind" && (() => {
        const branches = groups.map(g => ({ g, items: tasksOf(g.id).filter(matchQ) })).filter(b => b.items.length > 0);
        if (branches.length === 0) return <Empty icon={Network} text="還沒有任務" pad={24} />;
        return (
          <div style={{ padding: "10px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ background: C.accent, color: "#fff", borderRadius: 999, padding: "7px 18px", fontSize: 14, fontWeight: 600 }}>全部任務</div>
              <div style={{ width: 1, height: 18, background: C.line }} />
              {/* 分支換行鋪滿整個寬度（原本 nowrap 只能橫向捲、畫面窄） */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, alignItems: "start", width: "100%" }}>
                {branches.map(({ g, items }) => (
                  <div key={g.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
                    <div style={{ width: 1, height: 8, background: C.line }} />
                    <div style={{ background: g.id === INBOX ? C.accentSoft : C.card, border: `1px solid ${g.id === INBOX ? C.accent : C.line}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, color: g.id === INBOX ? C.accent : C.text, whiteSpace: "nowrap" }}>{g.name} <span style={{ color: C.faint, fontWeight: 400, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{items.length}</span></div>
                    <div style={{ width: 1, height: 10, background: C.line }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "100%" }}>
                      {items.map(t => (
                        <div key={t.id} onClick={() => setSel(t.id)} style={{ display: "flex", alignItems: "center", gap: 5, background: t.color || C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, color: t.status === "done" ? C.faint : C.text, textDecoration: t.status === "done" ? "line-through" : "none", cursor: "pointer" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: sColor(t.status), flexShrink: 0 }} />
                          {t.pinned && <Pin size={11} color={C.accent} fill={C.accent} style={{ flexShrink: 0 }} />}
                          {t.priority === "urgent" && <Flame size={11} color={C.red} style={{ flexShrink: 0 }} />}{t.title}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 任務詳情（點卡片開啟） ── */}
      {sel && (() => {
        const t = tasks.find(x => x.id === sel); if (!t) return null;
        const F = (label, node) => <label style={lbl}>{label}<div style={{ marginTop: 5 }}>{node}</div></label>;
        return (
          <div onClick={e => e.target === e.currentTarget && setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 24, width: "min(560px,96vw)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>任務詳情</div>
                <div style={{ flex: 1 }} />
                {canEdit && <button onClick={() => upd(t.id, { pinned: !t.pinned })} title={t.pinned ? "取消釘選" : "釘選到最上面"} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: t.pinned ? C.accentSoft : "none", border: `1px solid ${t.pinned ? C.accent : C.line}`, color: t.pinned ? C.accent : C.sub, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}><Pin size={12} fill={t.pinned ? C.accent : "none"} />{t.pinned ? "已釘選" : "釘選"}</button>}
                <button onClick={() => del(t.id)} style={{ background: "none", border: `1px solid ${C.line}`, color: C.red, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>刪除</button>
                <button onClick={() => setSel(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.sub, padding: 4, display: "flex" }}><X size={18} /></button>
              </div>
              {F("主題", <input value={t.title} onChange={e => upd(t.id, { title: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", fontSize: 14, fontWeight: 600 }} />)}
              {F("內容 / 備註", <textarea value={t.note || ""} onChange={e => upd(t.id, { note: e.target.value })} disabled={!canEdit} rows={3} style={{ ...inp, width: "100%", resize: "vertical" }} />)}
              {/* 附件外層不能用 <label>（F()）：label 會把任何點擊轉發給裡面的隱藏選檔 input → 點縮圖/刪除都跳出選檔視窗 */}
              <div style={lbl}>附件（截圖直接 Cmd+V 貼上，或按＋上傳檔案）<div style={{ marginTop: 5 }}><TaskAttach files={t.files || []} onChange={list => upd(t.id, { files: list })} canEdit={canEdit} C={C} line={C.line} /></div></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {F("隸屬大項", <select value={t.catId || INBOX} onChange={e => upd(t.id, { catId: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>)}
                {F("狀態", <select value={t.status} onChange={e => upd(t.id, { status: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
                {F("優先級", <select value={t.priority || "normal"} onChange={e => upd(t.id, { priority: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{PRIO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
                {F("截止日", <input type="date" value={dnorm(t.due)} onChange={e => upd(t.id, { due: e.target.value })} disabled={!canEdit} style={{ ...dateInp, width: "100%" }} />)}
                {F("開始日", <input type="date" value={dnorm(t.start)} onChange={e => upd(t.id, { start: e.target.value })} disabled={!canEdit} style={{ ...dateInp, width: "100%" }} />)}
                {F("負責人", <input key={t.id + "-ow"} defaultValue={t.owner || ""} onBlur={e => upd(t.id, { owner: e.target.value })} disabled={!canEdit} placeholder="誰負責完成（自由填）" style={{ ...inp, width: "100%" }} />)}
                {F("等待中（等誰 / 等什麼）", <input key={t.id + "-wf"} defaultValue={t.waitingFor || ""} onBlur={e => upd(t.id, { waitingFor: e.target.value })} disabled={!canEdit} placeholder={waitHint} style={{ ...inp, width: "100%" }} />)}
                {F("預估時間（分鐘）", <input type="number" min={1} step={1} value={t.estimatedMinutes ?? ""} onChange={e => upd(t.id, { estimatedMinutes: e.target.value })} disabled={!canEdit} placeholder="未估算" style={{ ...inp, width: "100%", fontVariantNumeric: "tabular-nums" }} />)}
                {F("卡片顏色（視覺分類）", <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", paddingTop: 3 }}>
                  {[["", "白"], ["#fde8e6", "紅"], ["#fdf1dd", "杏"], ["#faf6d8", "黃"], ["#e9f2e4", "綠"], ["#e6eef6", "藍"], ["#efe8f6", "紫"]].map(([cv, cl]) => (
                    <button key={cl} title={cl} disabled={!canEdit} onClick={() => upd(t.id, { color: cv })}
                      style={{ width: 24, height: 24, borderRadius: "50%", background: cv || "#fff", cursor: canEdit ? "pointer" : "default", padding: 0,
                        border: (t.color || "") === cv ? "2.5px solid #d4161d" : `1.5px solid ${C.line}`, boxShadow: (t.color || "") === cv ? "0 0 0 2px rgba(212,22,29,.15)" : "none" }} />
                  ))}
                </div>)}
              </div>
              {F("依賴任務（前置做完才能動工）", (() => {
                const deps = t.dependsOn || [];
                const missing = missingDeps(t, tasks);
                return (
                  <div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: deps.length ? 8 : 0 }}>
                      {deps.map(id => {
                        const d = tasks.find(x => x.id === id);
                        const isMissing = !d;
                        return (
                          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: isMissing ? C.red : "#404040", background: isMissing ? "#fef2f2" : C.soft, border: `1px solid ${isMissing ? "#fecaca" : C.line}`, borderRadius: 999, padding: "3px 10px" }}>
                            {isMissing ? <><CircleAlert size={12} />失效依賴</> : <>{d.status === "done" ? <Check size={12} color={C.green} /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: sColor(d.status) }} />}{d.title}</>}
                            {canEdit && <button onClick={() => upd(t.id, { dependsOn: deps.filter(x => x !== id) })} style={{ background: "none", border: "none", cursor: "pointer", color: C.faint, padding: 0, display: "flex" }}><X size={12} /></button>}
                          </span>
                        );
                      })}
                    </div>
                    {canEdit && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <select value="" onChange={e => {
                          const depId = e.target.value; if (!depId) return;
                          if (wouldCycle(t.id, depId, tasks)) { alert("不能加這個依賴：會形成循環（例如 A 依賴 B、B 又依賴回 A）。"); return; }
                          upd(t.id, { dependsOn: [...deps, depId] });
                        }} style={{ ...inp, flex: 1 }}>
                          <option value="">＋ 新增依賴…</option>
                          {tasks.filter(x => x.id !== t.id && !deps.includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
                        </select>
                        {missing.length > 0 && <button onClick={() => upd(t.id, { dependsOn: deps.filter(id => tasks.some(x => x.id === id)) })} style={{ background: "none", border: `1px solid ${C.line}`, color: C.sub, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>清除失效依賴</button>}
                      </div>
                    )}
                  </div>
                );
              })())}
              {F("標籤", (
                <div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: (t.tags || []).length ? 8 : 0 }}>
                    {(t.tags || []).map(tg => (
                      <span key={tg} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#404040", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 10px" }}>
                        {tg}{canEdit && <button onClick={() => upd(t.id, { tags: (t.tags || []).filter(x => x !== tg) })} style={{ background: "none", border: "none", cursor: "pointer", color: C.faint, padding: 0, display: "flex" }}><X size={12} /></button>}
                      </span>
                    ))}
                  </div>
                  {canEdit && <input value={tagIn} onChange={e => setTagIn(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && tagIn.trim()) { upd(t.id, { tags: [...(t.tags || []), tagIn.trim()] }); setTagIn(""); } }} placeholder="輸入標籤後按 Enter 新增" style={{ ...inp, width: "100%" }} />}
                </div>
              ))}
              {F("顏色（各視角同步顯示）", (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {TASK_COLORS.map(c => {
                    const sel = (t.color || "") === c;
                    return <button key={c || "none"} disabled={!canEdit} onClick={() => upd(t.id, { color: c })} title={c ? "" : "無顏色"}
                      style={{ width: 26, height: 26, borderRadius: "50%", cursor: canEdit ? "pointer" : "default", background: c || "#fff", border: `2px solid ${sel ? C.accent : C.line}`, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                      {!c && <X size={11} color={C.faint} />}{c && sel && <Check size={12} color={C.accent} strokeWidth={3} />}
                    </button>;
                  })}
                </div>
              ))}
              <div style={{ fontSize: 11, color: C.faint, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>建立於 {dnorm(t.createdAt)}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
