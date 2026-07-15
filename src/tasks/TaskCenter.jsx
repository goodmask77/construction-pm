// ── 任務中心（獨立模組）────────────────────────────────────────────────────
// 合併取代「工序 + ToDo」。單一資料 pm_tasks，多視角同步：看板 / 清單 / 依大項分組。
// 小標籤可拖曳排序、拖到任一大項自動歸屬。隨手記 → 先進收件匣，之後再整理。
// App 以 props 傳 K / confirm / canEdit / cats(工程大項，給「隸屬」用) / onLog。
// 視覺：依 docs/DESIGN_SPEC.md（Linear/Stripe 儀表板風）— 中性灰白 + 單一藍色主色 +
//       lucide 細線圖示 + 狀態小圓點；1px 淺灰邊框、8px 圓角、無陰影、大量留白。
import { useState, useEffect, useRef } from "react";
import { Inbox, LayoutGrid, Columns3, List, CalendarDays, ChartGantt, Network, Plus, X, Check, Flame, Calendar, Clock, CircleAlert, ListTodo, Search, Home, Zap, Hourglass, CirclePlay, Coffee } from "lucide-react";
import { isWaiting, isBlocked, missingDeps, wouldCycle, mergeTask, removeTaskAndRefs, isQuickWin, QUICK_WIN_MAX_MINUTES } from "./taskModel.js";

const C = {
  text: "#171717",       // neutral-900 主文字
  sub: "#737373",        // neutral-500 次要文字
  faint: "#a3a3a3",      // neutral-400 小標籤
  line: "#e5e5e5",       // neutral-200 邊框（一律 1px）
  soft: "#f5f5f5",       // neutral-100 pill 底
  bg: "#fafafa",         // neutral-50 面板底
  card: "#ffffff",
  accent: "#2563eb",     // blue-600 全站唯一主色
  accentSoft: "#eff6ff", // blue-50
  green: "#16a34a", amber: "#d97706", red: "#dc2626",
};
const STATUS = [["todo", "待辦", "#737373"], ["doing", "進行中", "#2563eb"], ["done", "完成", "#16a34a"]];
const PRIO = [["urgent", "超急", "#dc2626"], ["high", "高", "#d97706"], ["normal", "一般", "#737373"], ["low", "低", "#a3a3a3"]];
const sLabel = (s) => (STATUS.find(x => x[0] === s) || STATUS[0])[1];
const sColor = (s) => (STATUS.find(x => x[0] === s) || STATUS[0])[2];
const pMeta = (p) => PRIO.find(x => x[0] === p) || PRIO[2];
const INBOX = "__inbox__";
const rid = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);
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

export default function TaskCenter({ K, confirm, canEdit, cats, onLog }) {
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

  useEffect(() => { (async () => {
    try {
      const r = await window.storage.get(K("pm_tasks"), true);
      if (r && r.value) { setTasks(JSON.parse(r.value)); return; }
      // 第一次：把舊 ToDo(pm_issues) 匯入成任務（一次性）
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
      window.storage.set(K("pm_tasks"), JSON.stringify(imported), true).catch(() => {});
    } catch { setTasks([]); }
  })(); }, []); // eslint-disable-line

  const guard = () => { if (!canEdit) { alert("沒有編輯權限，請聯絡管理員。"); return false; } return true; };
  // 存檔防抖：畫面即時更新，但停手 0.5 秒才寫後端（避免打一個字寫一次資料庫）
  const saveTimer = useRef(null);
  const save = (list) => {
    setTasks(list);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { window.storage.set(K("pm_tasks"), JSON.stringify(list), true).catch(() => {}); }, 500);
  };
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
      {[38, 120, 120].map((h, i) => <div key={i} style={{ height: h, background: "#f0f0f0", borderRadius: 8, marginBottom: 12 }} />)}
    </div>
  );

  const groups = [{ id: INBOX, name: "收件匣" }, ...(cats || []).filter(c => !c.nonProject).map(c => ({ id: c.id, name: c.name }))];
  const tasksOf = (catId) => tasks.filter(t => (t.catId || INBOX) === catId);
  const open = tasks.filter(t => t.status !== "done");
  const matchQ = (t) => !q.trim() || (t.title + (t.note || "") + (t.tags || []).join("")).toLowerCase().includes(q.trim().toLowerCase());

  // ── 任務小卡 ──
  const Card = ({ t, dropBefore }) => {
    const done = t.status === "done";
    return (
      <div key={t.id} draggable={canEdit}
        onDragStart={e => { setDrag(t.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDrag(null); setOverKey(null); }}
        onDragOver={e => { if (drag && dropBefore) { e.preventDefault(); e.stopPropagation(); } }}
        onDrop={e => { if (drag && dropBefore) { e.preventDefault(); e.stopPropagation(); moveTo(drag, { catId: view === "group" ? t.catId : undefined, status: view === "board" ? t.status : undefined, beforeId: t.id }); setDrag(null); setOverKey(null); } }}
        onClick={() => setSel(t.id)}
        style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px", marginBottom: 8, cursor: canEdit ? "grab" : "pointer", opacity: drag === t.id ? 0.4 : 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { status: done ? "todo" : "done" }); }}
            title="切換完成" style={{ flexShrink: 0, width: 16, height: 16, marginTop: 2, borderRadius: 4, border: `1px solid ${done ? C.green : "#d4d4d4"}`, background: done ? C.green : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>{done && <Check size={11} color="#fff" strokeWidth={3} />}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: done ? C.faint : C.text, textDecoration: done ? "line-through" : "none", lineHeight: 1.45, wordBreak: "break-word" }}>
              {t.priority === "urgent" && <Flame size={12} color={C.red} style={{ flexShrink: 0 }} />}{t.title}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}>
              {t.due && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontVariantNumeric: "tabular-nums", color: (!done && t.due < today()) ? C.red : C.sub }}><Calendar size={11} />{t.due}</span>}
              {view !== "board" && <Pill color={sColor(t.status)} label={sLabel(t.status)} />}
              {isWaiting(t) && !done && <Pill color={C.amber} label={`等：${t.waitingFor}`} />}
              {isBlocked(t, tasks) && !done && <Pill color={C.red} label="被前置卡住" />}
              {(t.tags || []).map(tg => <span key={tg} style={{ fontSize: 11, color: C.sub, background: C.soft, borderRadius: 999, padding: "1px 8px" }}>{tg}</span>)}
            </div>
          </div>
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
        const dueNow = take(openT.filter(t => t.due && t.due <= t0)).sort(byUrgency);
        const doing = take(openT.filter(t => t.status === "doing")).sort(byUrgency);
        const blockedArr = take(openT.filter(t => isBlocked(t, tasks))).sort(byUrgency);
        const waitingArr = take(openT.filter(t => isWaiting(t))).sort(byUrgency);
        const quick = take(openT.filter(t => isQuickWin(t))).sort(byUrgency);
        const upcoming = take(openT.filter(t => t.due && t.due > t0 && (new Date(t.due) - new Date(t0)) / 86400000 <= 7)).sort(byUrgency);
        const allClear = !dueNow.length && !doing.length && !quick.length && !waitingArr.length && !blockedArr.length && !upcoming.length;
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
            {/* 問候列：今天的一眼總覽 */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", padding: "2px 2px 0" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>今天 {dateStr}</span>
              <span style={{ fontSize: 12.5, color: C.sub, fontVariantNumeric: "tabular-nums" }}>
                {dueNow.length > 0 ? `${dueNow.length} 件必處理` : "沒有到期壓力"}
                {quick.length > 0 && `・${quick.length} 件可速戰速決`}
                {waitingArr.length > 0 && `・${waitingArr.length} 件在等別人`}
              </span>
            </div>
            {allClear && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "40px 0", background: C.card, border: `1px solid ${C.line}`, borderRadius: 8 }}>
                <Coffee size={22} strokeWidth={1.5} color={C.faint} />
                <span style={{ fontSize: 13, color: C.sub }}>今天沒有急事{inboxOpen > 0 ? `——收件匣還有 ${inboxOpen} 件可以整理` : "，全部都乾淨"}</span>
              </div>
            )}
            {dueNow.length > 0 && <Section icon={CircleAlert} color={C.red} label="今天必處理" hint="逾期與今天到期"><Grid arr={dueNow} /></Section>}
            {doing.length > 0 && <Section icon={CirclePlay} color={C.accent} label="進行中" hint="手上正在做的"><Grid arr={doing} /></Section>}
            {quick.length > 0 && <Section icon={Zap} color={C.green} label="Quick Wins" hint={`≤ ${QUICK_WIN_MAX_MINUTES} 分鐘可完成，有空檔就清掉`}><Grid arr={quick} /></Section>}
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
          </div>
        );
      })()}

      {/* ── 依大項分組 ── */}
      {view === "group" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12, alignItems: "start" }}>
          {groups.map(g => {
            const items = tasksOf(g.id).filter(matchQ);
            const isEmpty = items.length === 0;
            // 空大項＝縮成一行（名稱＋直接新增輸入），不再一片空盒海；仍是拖放落點
            return DropZone({ keyId: g.id, onDropHere: () => moveTo(drag, { catId: g.id }),
              style: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: isEmpty ? "8px 10px" : 12, gridColumn: isEmpty ? undefined : undefined },
              children: isEmpty ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {g.id === INBOX && <Inbox size={13} strokeWidth={1.75} color={C.accent} style={{ flexShrink: 0 }} />}
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: g.id === INBOX ? C.accent : C.sub, whiteSpace: "nowrap" }}>{g.name}</div>
                  {canEdit
                    ? <input value={gnew[g.id] || ""} onChange={e => setGnew(p => ({ ...p, [g.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) addToGroup(g.id); }} placeholder="＋ 新增或拖到這裡…" style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: `1px dashed ${C.line}`, borderRadius: 8, padding: "4px 9px", fontSize: 12, background: "transparent", color: C.text, outline: "none" }} />
                    : <span style={{ fontSize: 11.5, color: C.faint }}>0</span>}
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "0 2px" }}>
                    {g.id === INBOX && <Inbox size={13} strokeWidth={1.75} color={C.accent} />}
                    <div style={{ fontSize: 13, fontWeight: 600, color: g.id === INBOX ? C.accent : C.text }}>{g.name}</div>
                    <span style={{ fontSize: 11.5, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{items.length}</span>
                  </div>
                  {items.map(t => Card({ t, dropBefore: true }))}
                  {canEdit && <input value={gnew[g.id] || ""} onChange={e => setGnew(p => ({ ...p, [g.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) addToGroup(g.id); }} placeholder="＋ 直接在此大項新增…" style={{ width: "100%", boxSizing: "border-box", border: `1px dashed ${C.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, background: "transparent", color: C.text, outline: "none", marginTop: 4 }} />}
                </>
              ) });
          })}
        </div>
      )}

      {/* ── 看板（依狀態） ── */}
      {view === "board" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, alignItems: "start" }}>
          {STATUS.map(([sk, sl, sc]) => {
            const items = tasks.filter(t => t.status === sk).filter(matchQ);
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
        rows = [...rows].sort((a, b) => {
          const ord = { urgent: 0, high: 1, normal: 2, low: 3 };
          if ((a.due || "9") !== (b.due || "9")) return (a.due || "9999") < (b.due || "9999") ? -1 : 1;
          return (ord[a.priority] ?? 2) - (ord[b.priority] ?? 2);
        });
        return (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, gap: 2 }}>
                {[["open", "未完成"], ["all", "全部"], ["done", "已完成"]].map(([k, l]) => (
                  <button key={k} onClick={() => setFStatus(k)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${fStatus === k ? C.line : "transparent"}`, background: fStatus === k ? "#fff" : "transparent", color: fStatus === k ? C.text : C.sub, fontSize: 12.5, fontWeight: fStatus === k ? 600 : 400, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.card, overflow: "hidden" }}>
              {rows.length === 0 ? <Empty icon={List} text="沒有任務" pad={24} /> :
                rows.map((t, i) => (
                  <div key={t.id} onClick={() => setSel(t.id)}
                    onMouseEnter={e => e.currentTarget.style.background = C.bg} onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i ? `1px solid ${C.soft}` : "none", cursor: "pointer", background: "#fff" }}>
                    <button onClick={e => { e.stopPropagation(); if (guard()) upd(t.id, { status: t.status === "done" ? "todo" : "done" }); }} style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 4, border: `1px solid ${t.status === "done" ? C.green : "#d4d4d4"}`, background: t.status === "done" ? C.green : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>{t.status === "done" && <Check size={11} color="#fff" strokeWidth={3} />}</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13.5, color: t.status === "done" ? C.faint : C.text, textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.priority === "urgent" && <Flame size={12} color={C.red} />}{t.title}</div>
                      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{catName(t.catId)}{t.due ? `・${t.due}` : ""}</div>
                    </div>
                    <Pill color={sColor(t.status)} label={sLabel(t.status)} />
                  </div>
                ))}
            </div>
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
        ].map(([label, Icon, color, arr]) => [label, Icon, color, arr.filter(matchQ).sort((a, b) => (a.due || "9") < (b.due || "9") ? -1 : 1)]);
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
        return (
          <div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.card, overflow: "auto" }}>
              <div style={{ minWidth: 200 + totalDays * dayW }}>
                {/* 週刻度 */}
                <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.bg, zIndex: 1 }}>
                  <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "6px 10px", fontSize: 11, letterSpacing: 0.5, color: C.faint, fontWeight: 500 }}>任務</div>
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
                      onMouseEnter={ev => ev.currentTarget.style.background = C.bg} onMouseLeave={ev => ev.currentTarget.style.background = "#fff"}
                      style={{ display: "flex", alignItems: "center", borderTop: i ? `1px solid ${C.soft}` : "none", cursor: "pointer", background: "#fff" }}>
                      <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "7px 10px", fontSize: 12.5, color: t.status === "done" ? C.faint : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>{t.priority === "urgent" && <Flame size={11} color={C.red} style={{ flexShrink: 0 }} />}{t.title}</div>
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
          <div style={{ overflowX: "auto", padding: "10px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "min-content" }}>
              <div style={{ background: C.accent, color: "#fff", borderRadius: 999, padding: "7px 18px", fontSize: 14, fontWeight: 600 }}>全部任務</div>
              <div style={{ width: 1, height: 18, background: C.line }} />
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "nowrap" }}>
                {branches.map(({ g, items }) => (
                  <div key={g.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 180 }}>
                    <div style={{ width: 1, height: 8, background: C.line }} />
                    <div style={{ background: g.id === INBOX ? C.accentSoft : C.card, border: `1px solid ${g.id === INBOX ? C.accent : C.line}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, color: g.id === INBOX ? C.accent : C.text, whiteSpace: "nowrap" }}>{g.name} <span style={{ color: C.faint, fontWeight: 400, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{items.length}</span></div>
                    <div style={{ width: 1, height: 10, background: C.line }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "100%" }}>
                      {items.map(t => (
                        <div key={t.id} onClick={() => setSel(t.id)} style={{ display: "flex", alignItems: "center", gap: 5, background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, color: t.status === "done" ? C.faint : C.text, textDecoration: t.status === "done" ? "line-through" : "none", cursor: "pointer" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: sColor(t.status), flexShrink: 0 }} />
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
                <button onClick={() => del(t.id)} style={{ background: "none", border: `1px solid ${C.line}`, color: C.red, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>刪除</button>
                <button onClick={() => setSel(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.sub, padding: 4, display: "flex" }}><X size={18} /></button>
              </div>
              {F("主題", <input value={t.title} onChange={e => upd(t.id, { title: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", fontSize: 14, fontWeight: 600 }} />)}
              {F("內容 / 備註", <textarea value={t.note || ""} onChange={e => upd(t.id, { note: e.target.value })} disabled={!canEdit} rows={3} style={{ ...inp, width: "100%", resize: "vertical" }} />)}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {F("隸屬大項", <select value={t.catId || INBOX} onChange={e => upd(t.id, { catId: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>)}
                {F("狀態", <select value={t.status} onChange={e => upd(t.id, { status: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
                {F("優先級", <select value={t.priority || "normal"} onChange={e => upd(t.id, { priority: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }}>{PRIO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>)}
                {F("截止日", <input type="date" value={dnorm(t.due)} onChange={e => upd(t.id, { due: e.target.value })} disabled={!canEdit} style={{ ...dateInp, width: "100%" }} />)}
                {F("開始日", <input type="date" value={dnorm(t.start)} onChange={e => upd(t.id, { start: e.target.value })} disabled={!canEdit} style={{ ...dateInp, width: "100%" }} />)}
                {F("負責人", <input key={t.id + "-ow"} defaultValue={t.owner || ""} onBlur={e => upd(t.id, { owner: e.target.value })} disabled={!canEdit} placeholder="誰負責完成（自由填）" style={{ ...inp, width: "100%" }} />)}
                {F("等待中（等誰 / 等什麼）", <input key={t.id + "-wf"} defaultValue={t.waitingFor || ""} onBlur={e => upd(t.id, { waitingFor: e.target.value })} disabled={!canEdit} placeholder="例：等木工、等房東、等設計圖" style={{ ...inp, width: "100%" }} />)}
                {F("預估時間（分鐘）", <input type="number" min={1} step={1} value={t.estimatedMinutes ?? ""} onChange={e => upd(t.id, { estimatedMinutes: e.target.value })} disabled={!canEdit} placeholder="未估算" style={{ ...inp, width: "100%", fontVariantNumeric: "tabular-nums" }} />)}
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
              <div style={{ fontSize: 11, color: C.faint, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>建立於 {dnorm(t.createdAt)}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
