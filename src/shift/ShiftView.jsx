// 排班系統（夥伴中心・排班）— 四頁：人員與能力 / 班別與需求 / 排班條件 / 週班表
// 資料：pm_documents 文件式（DOC_KEYS），demo 資料帶 seed 批次可整批清除
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DOC_KEYS, SCHEMA_V, SEED_BATCH, schedKey,
  SEED_STORES, SEED_STAFF, SEED_SKILLS, SEED_STATIONS, SEED_SHIFTS, SEED_DEMANDS, SEED_LEAVES,
  DEFAULT_RULES, DEFAULT_RULE_SETTINGS, DEFAULT_WEIGHTS, SOFT_ITEMS, WEIGHT_LEVELS,
  GRADES, SKILL_LEVELS, SKILL_LABEL, DAY_TYPES, DOW_LABEL,
  buildBaselineActual, BASELINE_WEEK, byId, shiftHours, newSchedule, syncRosterToShift,
} from "./model.js";
import { DOC_LABOR_CONTRACT, DOC_LABOR_MEETING_CONSENT } from "./docs.js";
import WeekBoard from "./WeekBoard.jsx";
import { Users, CalendarDays, Scale, LayoutGrid, Plus, Trash2, AlertTriangle, Copy, FileText, Lock } from "lucide-react";

// gpack 設計 tokens（與 App 一致）
export const T = {
  ACCENT: "#c4582a", TEXT: "#1d1a15", BG: "#f4efe5", SURFACE: "#fbf8f1", BORDER: "#d9cfbd",
  LINE2: "#c8bca6", SUB: "#5a5247", SOFT: "#fbeee6", MONO: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  GREEN: "#3f7d4e", AMBER: "#c98a14", BLUE: "#3a6ea5", RED: "#b3261e", GREY: "#9b9384",
};
export const card = { background: T.SURFACE, border: `1px solid ${T.BORDER}`, borderRadius: 12, padding: 16 };
export const inp = { border: `1px solid ${T.LINE2}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "#fff", color: T.TEXT };
export const btn = (primary) => ({ border: `1px solid ${primary ? T.ACCENT : T.LINE2}`, background: primary ? T.ACCENT : "#fff", color: primary ? "#fff" : T.TEXT, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" });
export const chip = (bg, fg) => ({ display: "inline-block", background: bg, color: fg || "#fff", borderRadius: 4, padding: "1px 7px", fontSize: 11.5, fontWeight: 700 });
function useIsMobile(bp = 768) {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => { const on = () => setM(window.innerWidth < bp); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, [bp]);
  return m;
}
export function SecHead({ tag, title, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <span style={chip(T.ACCENT)}>{tag}</span>
      <span style={{ fontSize: 15.5, fontWeight: 800, color: T.TEXT }}>{title}</span>
      <div style={{ flex: 1 }} />{right}
    </div>
  );
}

// ── 文件讀寫 ──
const loadDoc = async (K, key, fallback) => {
  try { const r = await window.storage.get(K(key), true); if (r && r.value) return JSON.parse(r.value); } catch (_) {}
  return fallback;
};

export default function ShiftView({ K, canEdit, confirm, userName, isAdmin, onLog }) {
  const isMobile = useIsMobile();
  const [page, setPage] = useState("week");
  const [storeId, setStoreId] = useState("abeach");
  const [docs, setDocs] = useState(null); // {stores, rulesDoc, staffDoc, stationsDoc, templatesDoc, leavesDoc, weightsDoc}

  const saveDoc = useCallback(async (key, doc, logDetail) => {
    try { if (logDetail && onLog) onLog("編輯", "排班・" + logDetail); } catch (_) {}
    try { await window.storage.set(K(key), JSON.stringify(doc), true); } catch (_) {}
  }, [K, onLog]);

  // 初次載入；缺 staff 文件 → 灌 demo seed（§45 可整批清除）
  useEffect(() => {
    (async () => {
      let [stores, rulesDoc, staffDoc, stationsDoc, templatesDoc, leavesDoc, weightsDoc] = await Promise.all([
        loadDoc(K, DOC_KEYS.stores, null), loadDoc(K, DOC_KEYS.rules, null), loadDoc(K, DOC_KEYS.staff, null),
        loadDoc(K, DOC_KEYS.stations, null), loadDoc(K, DOC_KEYS.templates, null), loadDoc(K, DOC_KEYS.leaves, null),
        loadDoc(K, DOC_KEYS.weights, null),
      ]);
      if (!staffDoc) {
        stores = { schema_v: SCHEMA_V, stores: SEED_STORES };
        rulesDoc = { schema_v: SCHEMA_V, rules: DEFAULT_RULES, settings: DEFAULT_RULE_SETTINGS };
        staffDoc = { schema_v: SCHEMA_V, staff: SEED_STAFF };
        stationsDoc = { schema_v: SCHEMA_V, stations: SEED_STATIONS, skills: SEED_SKILLS };
        templatesDoc = { schema_v: SCHEMA_V, shifts: SEED_SHIFTS, demands: SEED_DEMANDS };
        leavesDoc = { schema_v: SCHEMA_V, leaves: SEED_LEAVES };
        weightsDoc = { schema_v: SCHEMA_V, weights: DEFAULT_WEIGHTS };
        const baseline = { ...newSchedule("abeach", BASELINE_WEEK), status: "locked", isActual: true, seed: SEED_BATCH, assignments: buildBaselineActual() };
        await Promise.all([
          saveDoc(DOC_KEYS.stores, stores), saveDoc(DOC_KEYS.rules, rulesDoc), saveDoc(DOC_KEYS.staff, staffDoc),
          saveDoc(DOC_KEYS.stations, stationsDoc), saveDoc(DOC_KEYS.templates, templatesDoc),
          saveDoc(DOC_KEYS.leaves, leavesDoc), saveDoc(DOC_KEYS.weights, weightsDoc),
          saveDoc(schedKey("abeach", BASELINE_WEEK), baseline),
          saveDoc(DOC_KEYS.schedIndex, { schema_v: SCHEMA_V, weeks: [{ storeId: "abeach", weekStart: BASELINE_WEEK, status: "locked" }] }),
        ]);
        try { onLog && onLog("新增", "排班・初始化示範資料（" + SEED_BATCH + "）"); } catch (_) {}
      }
      setDocs({ stores, rulesDoc, staffDoc, stationsDoc, templatesDoc, leavesDoc, weightsDoc });
    })();
  }, [K]); // eslint-disable-line

  const set = (patch) => setDocs(d => ({ ...d, ...patch }));
  if (!docs) return <div style={{ padding: 40, textAlign: "center", color: T.SUB }}>排班資料載入中…</div>;
  const { stores, rulesDoc, staffDoc, stationsDoc, templatesDoc, leavesDoc, weightsDoc } = docs;
  const storeList = stores?.stores || [];
  const store = storeList.find(s => s.id === storeId) || storeList[0];

  const PAGES = [
    ["week", "週班表", CalendarDays], ["people", "人員與能力", Users],
    ["templates", "班別與需求", LayoutGrid], ["rules", "排班條件", Scale],
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* 店別選擇器 + 子頁籤 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "4px 0 14px" }}>
        <select value={store?.id} onChange={e => setStoreId(e.target.value)} style={{ ...inp, fontWeight: 700 }}>
          {storeList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {PAGES.map(([k, l, Icon]) => (
          <button key={k} onClick={() => setPage(k)} style={{ ...btn(page === k), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon size={14} strokeWidth={1.75} />{!isMobile && l}{isMobile && page === k && l}
          </button>
        ))}
      </div>
      {storeId === "ground" && <div style={{ ...card, color: T.SUB, marginBottom: 12 }}>GROUN:D 店別本階段留空（規格 §A5）— 先在 A Beach 101 驗證。</div>}

      {page === "people" && <PeoplePage {...{ staffDoc, stationsDoc, storeId, canEdit, confirm, isMobile, K }}
        saveStaff={(d) => { set({ staffDoc: d }); saveDoc(DOC_KEYS.staff, d, "人員主檔"); }}
        saveStations={(d) => { set({ stationsDoc: d }); saveDoc(DOC_KEYS.stations, d, "崗位技能矩陣"); }} />}
      {page === "templates" && <TemplatesPage {...{ templatesDoc, stationsDoc, storeId, canEdit, confirm, isMobile }}
        save={(d) => { set({ templatesDoc: d }); saveDoc(DOC_KEYS.templates, d, "班別/需求模板"); }} />}
      {page === "rules" && <RulesPage {...{ rulesDoc, weightsDoc, storeId, canEdit, confirm, isMobile, K, userName }}
        saveRules={(d) => { set({ rulesDoc: d }); saveDoc(DOC_KEYS.rules, d, "法規參數表"); }}
        saveWeights={(d) => { set({ weightsDoc: d }); saveDoc(DOC_KEYS.weights, d, "軟條件權重"); }} onLog={onLog} />}
      {page === "week" && <WeekBoard {...{ K, storeId, canEdit, confirm, userName, isMobile, onLog }}
        data={{ staff: staffDoc.staff, skills: stationsDoc.skills, stations: stationsDoc.stations, shifts: templatesDoc.shifts, demands: templatesDoc.demands, leaves: leavesDoc.leaves, rules: rulesDoc.rules, settings: rulesDoc.settings, weights: weightsDoc.weights }}
        saveLeaves={(list) => { const d = { ...leavesDoc, leaves: list }; set({ leavesDoc: d }); saveDoc(DOC_KEYS.leaves, d, "請假"); }} />}
    </div>
  );
}

// ═══ 頁 1：人員與能力（§H35）═══
function PeoplePage({ staffDoc, stationsDoc, storeId, canEdit, confirm, isMobile, K, saveStaff, saveStations }) {
  const [editId, setEditId] = useState(null);
  // 從名冊同步（張良 2026-07-18：排班人員全部對照名冊內外場；可重複按，不會蓋掉手動調過的技能/班數/不可排）
  const syncRoster = async () => {
    try {
      const r = await window.storage.get(K("kb_360"), true);
      const kb = r && r.value ? JSON.parse(r.value) : null;
      if (!kb?.people?.length) { alert("讀不到名冊資料"); return; }
      const titleField = (kb.fields || []).find(f => /職稱/.test(f.label || ""));
      const titleOf = (p) => titleField ? (p[titleField.key] || "") : "";
      const res = syncRosterToShift(kb.people, titleOf, staffDoc.staff, stationsDoc.stations, stationsDoc.skills, storeId);
      if (!(await confirm(`將同步 ${res.total} 位內外場夥伴（新增 ${res.added} 位）；名冊已離職/非內外場者與示範假人會移出排班。技能矩陣：新人預設本部門全「可勝任」，請再校正。繼續？`))) return;
      saveStaff({ ...staffDoc, staff: res.staff });
      saveStations({ ...stationsDoc, skills: res.skills });
    } catch (e) { alert("同步失敗：" + (e?.message || e)); }
  };
  const staff = (staffDoc.staff || []).filter(p => (p.stores || []).includes(storeId));
  const stations = (stationsDoc.stations || []).filter(s => s.storeId === storeId);
  const skills = stationsDoc.skills || {};
  // 單點故障：主力僅 1 人的崗位（§35）
  const spof = useMemo(() => new Set(stations.filter(st => staff.filter(p => skills[p.id]?.[st.id] === "main").length === 1).map(st => st.id)), [stations, staff, skills]);
  const cycleSkill = (pid, stId) => {
    if (!canEdit) return;
    const order = ["no", "training", "ok", "main"];
    const cur = skills[pid]?.[stId] || "no";
    const next = order[(order.indexOf(cur) + 1) % order.length];
    const ns = { ...skills, [pid]: { ...(skills[pid] || {}), [stId]: next } };
    saveStations({ ...stationsDoc, skills: ns });
  };
  const skillStyle = { main: { background: T.GREEN, color: "#fff" }, ok: { background: "#e3edd9", color: T.GREEN }, training: { background: "#fdf1dc", color: T.AMBER }, no: { background: "#f1ece2", color: T.GREY } };
  const upd = (id, patch) => saveStaff({ ...staffDoc, staff: staffDoc.staff.map(p => p.id === id ? { ...p, ...patch } : p) });
  const editP = staff.find(p => p.id === editId);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={card}>
        <SecHead tag="STAFF" title={`人員（${staff.length} 人）`} right={canEdit && (<div style={{ display: "flex", gap: 6 }}>
          <button style={btn(false)} onClick={syncRoster} title="把名冊的內外場在職夥伴同步進排班（可重複按）">⟳ 從名冊同步</button>
          <button style={btn(true)} onClick={() => {
            const id = "sf-" + Math.random().toString(36).slice(2, 8);
            saveStaff({ ...staffDoc, staff: [...staffDoc.staff, { id, name: "新夥伴", nick: "", empNo: "", dept: "內場", grade: "正職", birthYear: 2000, expectShifts: 5, costFactor: 1, startDate: "", endDate: "", stores: [storeId], supportDepts: [], unavailable: [], otWilling: false, fixedPrefShiftIds: [], wishOff: [], note: "", seed: "" }] });
            setEditId(id);
          }}><Plus size={13} /> 新增</button>
        </div>)} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead><tr style={{ color: T.SUB, textAlign: "left" }}>{["暱稱/姓名", "部門", "職級", "員編", "出生年", "期望班數", "成本係數", "固定不可排", "加班意願", ""].map(h => <th key={h} style={{ padding: "4px 8px", borderBottom: `1px solid ${T.BORDER}`, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{staff.map(p => (
              <tr key={p.id} style={{ borderBottom: `1px solid ${T.BORDER}` }}>
                <td style={{ padding: "5px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{p.nick || p.name}<span style={{ color: T.SUB, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{p.nick ? p.name : ""}</span></td>
                <td style={{ padding: "5px 8px" }}>{p.dept}</td>
                <td style={{ padding: "5px 8px" }}><span style={chip(p.grade === "管理" ? T.TEXT : p.grade === "正職" ? T.BLUE : p.grade === "週末PT" ? T.AMBER : T.GREY)}>{p.grade}</span></td>
                <td style={{ padding: "5px 8px", fontFamily: T.MONO }}>{p.empNo}</td>
                <td style={{ padding: "5px 8px", fontFamily: T.MONO }}>{p.birthYear}{p.birthYear && (new Date().getFullYear() - p.birthYear) < 18 && <span title="未滿18歲，受 LR-048 保護" style={{ marginLeft: 4 }}>🔞</span>}</td>
                <td style={{ padding: "5px 8px", fontFamily: T.MONO }}>{p.expectShifts}</td>
                <td style={{ padding: "5px 8px", fontFamily: T.MONO }}>{p.costFactor}</td>
                <td style={{ padding: "5px 8px", fontSize: 11.5, color: T.SUB }}>{(p.unavailable || []).map(u => `週${DOW_LABEL[u.dow]}`).join("、") || "—"}</td>
                <td style={{ padding: "5px 8px" }}>{p.otWilling ? "✓" : "—"}</td>
                <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                  {canEdit && <button style={{ ...btn(false), padding: "3px 8px", fontSize: 12 }} onClick={() => setEditId(p.id)}>編輯</button>}
                  {canEdit && <button style={{ ...btn(false), padding: "3px 8px", fontSize: 12, marginLeft: 4, color: T.RED }} onClick={async () => { if (await confirm(`刪除 ${p.nick || p.name}？（不影響歷史班表顯示）`)) saveStaff({ ...staffDoc, staff: staffDoc.staff.filter(x => x.id !== p.id) }); }}><Trash2 size={12} /></button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
        <div style={{ color: T.SUB, fontSize: 11.5, marginTop: 8 }}>※ 目前為示範資料（seed: {SEED_BATCH}）。不存身分證/勞健保/實際薪資 — 成本係數為相對值。</div>
      </div>

      {editP && <EditStaffModal p={editP} onClose={() => setEditId(null)} upd={upd} />}

      <div style={card}>
        <SecHead tag="SKILL" title="崗位技能矩陣（點格子切換：不可 → 受訓中 → 可勝任 → 主力）" />
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={{ padding: "4px 8px", textAlign: "left", color: T.SUB }}>人員＼崗位</th>
              {stations.map(st => <th key={st.id} style={{ padding: "4px 6px", color: spof.has(st.id) ? T.RED : T.SUB, whiteSpace: "nowrap" }}>{st.code}{spof.has(st.id) && <span title="單點故障：主力僅 1 人"> ⚠</span>}</th>)}
            </tr></thead>
            <tbody>{staff.map(p => (
              <tr key={p.id}>
                <td style={{ padding: "3px 8px", fontWeight: 700, whiteSpace: "nowrap", borderBottom: `1px solid ${T.BORDER}` }}>{p.nick || p.name}</td>
                {stations.map(st => { const lv = skills[p.id]?.[st.id] || "no"; return (
                  <td key={st.id} onClick={() => cycleSkill(p.id, st.id)} style={{ padding: 2, borderBottom: `1px solid ${T.BORDER}`, cursor: canEdit ? "pointer" : "default" }}>
                    <div style={{ ...skillStyle[lv], borderRadius: 4, textAlign: "center", padding: "3px 2px", minWidth: 44, fontWeight: 600 }}>{lv === "no" ? "·" : SKILL_LABEL[lv]}</div>
                  </td>); })}
              </tr>))}</tbody>
          </table>
        </div>
        {spof.size > 0 && <div style={{ marginTop: 10, color: T.RED, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} /> 單點故障提示：{stations.filter(s => spof.has(s.id)).map(s => s.code).join("、")} 崗位主力僅 1 人 — 該人請假即開天窗，建議培訓第二主力。</div>}
      </div>
    </div>
  );
}

// F 定義在元件外：若定義在內部，每次 render 都是新元件型別 → 輸入框每打一字就失焦
const F = ({ label, children }) => <label style={{ display: "grid", gap: 4, fontSize: 12.5, color: T.SUB }}>{label}{children}</label>;
function EditStaffModal({ p, onClose, upd }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(29,26,21,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: 520, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", background: "#fff" }}>
        <SecHead tag="EDIT" title={`編輯：${p.nick || p.name}`} right={<button style={btn(true)} onClick={onClose}>完成</button>} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <F label="姓名"><input style={inp} value={p.name} onChange={e => upd(p.id, { name: e.target.value })} /></F>
          <F label="暱稱"><input style={inp} value={p.nick || ""} onChange={e => upd(p.id, { nick: e.target.value })} /></F>
          <F label="員工編號（NUEiP）"><input style={inp} value={p.empNo || ""} onChange={e => upd(p.id, { empNo: e.target.value })} /></F>
          <F label="部門"><select style={inp} value={p.dept} onChange={e => upd(p.id, { dept: e.target.value })}>{["內場", "外場", "管理"].map(d => <option key={d}>{d}</option>)}</select></F>
          <F label="職級"><select style={inp} value={p.grade} onChange={e => upd(p.id, { grade: e.target.value })}>{GRADES.map(g => <option key={g}>{g}</option>)}</select></F>
          <F label="出生年（僅供未成年判定）"><input type="number" style={inp} value={p.birthYear || ""} onChange={e => upd(p.id, { birthYear: Number(e.target.value) || null })} /></F>
          <F label="到職日"><input type="date" style={inp} value={p.startDate || ""} onChange={e => upd(p.id, { startDate: e.target.value })} /></F>
          <F label="離職日"><input type="date" style={inp} value={p.endDate || ""} onChange={e => upd(p.id, { endDate: e.target.value })} /></F>
          <F label="每週期望班數"><input type="number" style={inp} value={p.expectShifts || 0} onChange={e => upd(p.id, { expectShifts: Number(e.target.value) || 0 })} /></F>
          <F label="成本係數（相對值，非薪資）"><input type="number" step="0.1" style={inp} value={p.costFactor || 1} onChange={e => upd(p.id, { costFactor: Number(e.target.value) || 1 })} /></F>
          <F label="有加班意願"><select style={inp} value={p.otWilling ? "1" : "0"} onChange={e => upd(p.id, { otWilling: e.target.value === "1" })}><option value="0">否</option><option value="1">是</option></select></F>
          <F label="備註"><input style={inp} value={p.note || ""} onChange={e => upd(p.id, { note: e.target.value })} /></F>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, color: T.SUB, marginBottom: 6 }}>固定不可排（每週固定；請假請在週班表頁登記）</div>
          {(p.unavailable || []).map((u, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, fontSize: 12.5 }}>
              <select style={inp} value={u.dow} onChange={e => { const list = [...p.unavailable]; list[i] = { ...u, dow: Number(e.target.value) }; upd(p.id, { unavailable: list }); }}>{DOW_LABEL.map((d, di) => <option key={di} value={di}>週{d}</option>)}</select>
              <span>整日</span><input style={{ ...inp, flex: 1 }} placeholder="原因" value={u.note || ""} onChange={e => { const list = [...p.unavailable]; list[i] = { ...u, note: e.target.value }; upd(p.id, { unavailable: list }); }} />
              <button style={{ ...btn(false), color: T.RED, padding: "4px 8px" }} onClick={() => upd(p.id, { unavailable: p.unavailable.filter((_, xi) => xi !== i) })}><Trash2 size={12} /></button>
            </div>
          ))}
          <button style={btn(false)} onClick={() => upd(p.id, { unavailable: [...(p.unavailable || []), { dow: 1, from: "00:00", to: "24:00", note: "" }] })}><Plus size={12} /> 加一筆</button>
        </div>
      </div>
    </div>
  );
}

// ═══ 頁 2：班別與需求（§H36）═══
function TemplatesPage({ templatesDoc, stationsDoc, storeId, canEdit, confirm, isMobile, save }) {
  const shifts = (templatesDoc.shifts || []).filter(s => s.storeId === storeId);
  const demands = (templatesDoc.demands || []).filter(d => d.storeId === storeId);
  const stations = (stationsDoc.stations || []).filter(s => s.storeId === storeId);
  const [dayType, setDayType] = useState("weekday");
  const dm = demands.find(d => d.dayType === dayType);
  const updShift = (id, patch) => save({ ...templatesDoc, shifts: templatesDoc.shifts.map(s => s.id === id ? { ...s, ...patch } : s) });
  const updDemand = (patch) => {
    let list = templatesDoc.demands;
    if (dm) list = list.map(d => d === dm || d.id === dm.id ? { ...d, ...patch } : d);
    else list = [...list, { id: "dm-" + dayType + "-" + storeId, storeId, dayType, seats: [], requiredRoles: [], seed: "", ...patch }];
    save({ ...templatesDoc, demands: list });
  };
  const cell = { padding: "5px 8px", borderBottom: `1px solid ${T.BORDER}` };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={card}>
        <SecHead tag="SHIFT" title={`班別模板（${shifts.length} 種）`} right={canEdit && <button style={btn(true)} onClick={() => save({ ...templatesDoc, shifts: [...templatesDoc.shifts, { id: "sh-" + Math.random().toString(36).slice(2, 7), code: "新班", name: "新班別", color: "#3a6ea5", start: "09:00", end: "17:30", breakMin: 60, dept: "內場", storeId, stationId: null, minLevel: "training", isOpen: false, isClose: false, isMgr: false, externalCode: "", seed: "" }] })}><Plus size={13} /> 新增</button>} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead><tr style={{ color: T.SUB, textAlign: "left" }}>{["代碼", "名稱", "起", "迄", "休(分)", "實工時", "部門", "開店", "閉店", "值班", "顏色", ""].map(h => <th key={h} style={{ ...cell, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{shifts.map(s => (
              <tr key={s.id}>
                <td style={cell}><span style={chip(s.color)}>{s.code}</span></td>
                <td style={cell}>{canEdit ? <input style={{ ...inp, width: 110 }} value={s.name} onChange={e => updShift(s.id, { name: e.target.value })} /> : s.name}</td>
                <td style={cell}>{canEdit ? <input type="time" style={inp} value={s.start} onChange={e => updShift(s.id, { start: e.target.value })} /> : s.start}</td>
                <td style={cell}>{canEdit ? <input type="time" style={inp} value={s.end} onChange={e => updShift(s.id, { end: e.target.value })} /> : s.end}</td>
                <td style={cell}>{canEdit ? <input type="number" style={{ ...inp, width: 58 }} value={s.breakMin} onChange={e => updShift(s.id, { breakMin: Number(e.target.value) || 0 })} /> : s.breakMin}</td>
                <td style={{ ...cell, fontFamily: T.MONO, fontWeight: 700 }}>{shiftHours(s)}h</td>
                <td style={cell}>{canEdit ? <select style={inp} value={s.dept} onChange={e => updShift(s.id, { dept: e.target.value })}>{["內場", "外場", "管理"].map(d => <option key={d}>{d}</option>)}</select> : s.dept}</td>
                {["isOpen", "isClose", "isMgr"].map(f => <td key={f} style={{ ...cell, textAlign: "center" }}><input type="checkbox" disabled={!canEdit} checked={!!s[f]} onChange={e => updShift(s.id, { [f]: e.target.checked })} /></td>)}
                <td style={cell}><input type="color" disabled={!canEdit} value={s.color} onChange={e => updShift(s.id, { color: e.target.value })} style={{ width: 34, height: 24, border: "none", background: "none", cursor: "pointer" }} /></td>
                <td style={cell}>{canEdit && <button style={{ ...btn(false), padding: "3px 8px", color: T.RED }} onClick={async () => { if (await confirm(`刪除班別「${s.name}」？`)) save({ ...templatesDoc, shifts: templatesDoc.shifts.filter(x => x.id !== s.id) }); }}><Trash2 size={12} /></button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <SecHead tag="DEMAND" title="人力需求模板（日型態 × 班別 × 崗位 → 人數）" right={
          <div style={{ display: "flex", gap: 6 }}>{DAY_TYPES.map(([k, l]) => <button key={k} style={{ ...btn(dayType === k), padding: "5px 10px", fontSize: 12 }} onClick={() => setDayType(k)}>{l}</button>)}</div>
        } />
        {!dm && <div style={{ color: T.SUB, fontSize: 13, marginBottom: 8 }}>此日型態尚無需求模板（求解時會退用「平日」模板）。{canEdit && "新增一列即自動建立。"}</div>}
        <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr style={{ color: T.SUB, textAlign: "left" }}>{["班別", "崗位", "人數", ""].map(h => <th key={h} style={{ ...cell, minWidth: 90 }}>{h}</th>)}</tr></thead>
          <tbody>{(dm?.seats || []).map((seat, i) => (
            <tr key={i}>
              <td style={cell}><select disabled={!canEdit} style={inp} value={seat.shiftId} onChange={e => { const seats = [...dm.seats]; seats[i] = { ...seat, shiftId: e.target.value }; updDemand({ seats }); }}>{shifts.map(s => <option key={s.id} value={s.id}>{s.code} {s.start}–{s.end}</option>)}</select></td>
              <td style={cell}><select disabled={!canEdit} style={inp} value={seat.stationId} onChange={e => { const seats = [...dm.seats]; seats[i] = { ...seat, stationId: e.target.value }; updDemand({ seats }); }}>{stations.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></td>
              <td style={cell}><input type="number" min="1" disabled={!canEdit} style={{ ...inp, width: 58 }} value={seat.count || 1} onChange={e => { const seats = [...dm.seats]; seats[i] = { ...seat, count: Number(e.target.value) || 1 }; updDemand({ seats }); }} /></td>
              <td style={cell}>{canEdit && <button style={{ ...btn(false), padding: "3px 8px", color: T.RED }} onClick={() => updDemand({ seats: dm.seats.filter((_, xi) => xi !== i) })}><Trash2 size={12} /></button>}</td>
            </tr>))}</tbody>
        </table>
        {canEdit && <button style={{ ...btn(false), marginTop: 8 }} onClick={() => updDemand({ seats: [...(dm?.seats || []), { shiftId: shifts[0]?.id, stationId: stations[0]?.id, count: 1 }] })}><Plus size={12} /> 加一席</button>}
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.SUB }}>必要角色：{(dm?.requiredRoles || []).join("；") || "—"}　※ 需求一律人工設定，不從歷史或營收推導（§20）。</div>
      </div>
    </div>
  );
}

// ═══ 頁 3：排班條件（§H37）═══
function RulesPage({ rulesDoc, weightsDoc, storeId, canEdit, confirm, isMobile, saveRules, saveWeights, K, userName, onLog }) {
  const rules = rulesDoc.rules || [];
  const st = rulesDoc.settings?.byStore?.[storeId] || { working_time_system: "general", agreement_date: "" };
  const [openDoc, setOpenDoc] = useState("");
  const updSetting = (patch) => saveRules({ ...rulesDoc, settings: { ...rulesDoc.settings, byStore: { ...rulesDoc.settings.byStore, [storeId]: { ...st, ...patch } } } });
  const updRule = (code, patch) => saveRules({ ...rulesDoc, rules: rules.map(r => r.rule_code === code ? { ...r, ...patch } : r) });
  const fallback = st.working_time_system === "four_week" && !st.agreement_date;
  const cell = { padding: "6px 8px", borderBottom: `1px solid ${T.BORDER}`, verticalAlign: "top" };
  const copy = async (txt) => { try { await navigator.clipboard.writeText(txt); } catch (_) {} };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={card}>
        <SecHead tag="SYSTEM" title="工時制度設定" />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
          <label>制度：<select disabled={!canEdit} style={inp} value={st.working_time_system} onChange={e => updSetting({ working_time_system: e.target.value })}>
            <option value="general">一般工時</option><option value="four_week">四週變形工時</option>
          </select></label>
          <label>勞資會議同意書日期：<input type="date" disabled={!canEdit} style={inp} value={st.agreement_date || ""} onChange={e => updSetting({ agreement_date: e.target.value })} /></label>
        </div>
        {fallback && <div style={{ marginTop: 10, background: "#fdf1dc", border: `1px solid ${T.AMBER}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "#7a5308" }}>
          ⚠ 已選四週變形但<b>未填同意書日期</b> → 檢查器目前套「一般工時」上限（§B9）。同意書範本在下方，開勞資會議簽好填上日期即自動切換。
        </div>}
      </div>

      <div style={card}>
        <SecHead tag="RULES" title="法規參數表 labor_rules" />
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead><tr style={{ color: T.SUB, textAlign: "left" }}>{["代碼", "名稱／法條", "參數", "嚴重度", "適用制度", "覆核狀態", "啟用"].map(h => <th key={h} style={{ ...cell, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{rules.map(r => (
              <tr key={r.rule_code} style={{ opacity: r.enabled === false ? 0.5 : 1 }}>
                <td style={{ ...cell, fontFamily: T.MONO, fontWeight: 700, whiteSpace: "nowrap" }}>{r.rule_code}</td>
                <td style={{ ...cell, minWidth: 150 }}>
                  <b>{r.name}</b><span style={{ color: T.SUB, marginLeft: 6 }}>{r.law_ref}</span>
                  <details style={{ marginTop: 3 }}><summary style={{ cursor: "pointer", color: T.BLUE, fontSize: 11.5 }}>解釋依據</summary><div style={{ color: T.SUB, fontSize: 11.5, marginTop: 3, maxWidth: 420 }}>{r.interpretation_note}</div></details>
                </td>
                <td style={{ ...cell, minWidth: 150 }}>{Object.entries(r.params || {}).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 2 }}>
                    <span style={{ color: T.SUB, fontSize: 11 }}>{k}</span>
                    <input disabled={!canEdit} style={{ ...inp, width: 70, padding: "2px 6px", fontSize: 11.5, fontFamily: T.MONO }} value={v} onChange={e => { const val = e.target.value; updRule(r.rule_code, { params: { ...r.params, [k]: isNaN(Number(val)) || val === "" ? val : Number(val) }, review_status: "pending" }); }} />
                  </div>))}</td>
                <td style={cell}><span style={chip(r.severity === "block" ? T.RED : r.severity === "warn" ? T.AMBER : T.GREY)}>{r.severity === "block" ? "硬條件" : r.severity === "warn" ? "提示" : "參數"}</span></td>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>{r.applies_to_system === "both" ? "皆適用" : r.applies_to_system === "general" ? "一般工時" : "四週變形"}</td>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>
                  <span style={chip(r.review_status === "verified" ? T.GREEN : T.AMBER)}>{r.review_status === "verified" ? "已驗證" : "待驗證"}</span>
                  {r.review_status === "verified" && <div style={{ fontSize: 10.5, color: T.SUB, marginTop: 2 }}>{r.reviewed_by} {r.reviewed_at?.slice(0, 10)}</div>}
                  {canEdit && r.review_status !== "verified" && <button style={{ ...btn(false), padding: "2px 6px", fontSize: 10.5, marginTop: 3, display: "block" }} onClick={async () => { if (await confirm(`確認「${r.name}」參數已經顧問覆核？`)) updRule(r.rule_code, { review_status: "verified", reviewed_by: userName || "管理員", reviewed_at: new Date().toISOString() }); }}>標記已驗證</button>}
                </td>
                <td style={cell}><input type="checkbox" disabled={!canEdit} checked={r.enabled !== false} onChange={async e => {
                  if (!e.target.checked) { const reason = window.prompt(`停用 ${r.rule_code} 需填原因（會留紀錄）：`); if (!reason) return; updRule(r.rule_code, { enabled: false, disable_reason: reason }); try { onLog && onLog("編輯", `排班・停用規則 ${r.rule_code}（${reason}）`); } catch (_) {} }
                  else updRule(r.rule_code, { enabled: true, disable_reason: "" });
                }} />{r.enabled === false && <div style={{ fontSize: 10.5, color: T.RED }}>{r.disable_reason}</div>}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <div style={{ color: T.SUB, fontSize: 11.5, marginTop: 8 }}>※ 全部規則預設「待驗證」— 參數初值是保守解讀，等勞資顧問逐條覆核後按「標記已驗證」。法規數字不寫死在程式碼（§6）。</div>
      </div>

      <div style={card}>
        <SecHead tag="SOFT" title="軟條件權重（永遠不覆蓋硬條件）" />
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8, fontSize: 13 }}>
          {SOFT_ITEMS.map(([k, label]) => (
            <label key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, border: `1px solid ${T.BORDER}`, borderRadius: 8, padding: "6px 10px", background: "#fff" }}>
              {label}
              <select disabled={!canEdit} style={inp} value={weightsDoc.weights?.[k] || "normal"} onChange={e => saveWeights({ ...weightsDoc, weights: { ...weightsDoc.weights, [k]: e.target.value } })}>
                {WEIGHT_LEVELS.map(([wk, wl]) => <option key={wk} value={wk}>{wl}</option>)}
              </select>
            </label>))}
        </div>
      </div>

      <div style={card}>
        <SecHead tag="DOCS" title="文件範本（草稿 — 看過要改跟我說；正式使用前須經顧問/律師覆核）" />
        {[["contract", "勞動契約書（含四週變形條款）", DOC_LABOR_CONTRACT], ["consent", "勞資會議同意書（四週變形工時）", DOC_LABOR_MEETING_CONSENT]].map(([k, title, txt]) => (
          <div key={k} style={{ marginBottom: 8 }}>
            <button style={{ ...btn(openDoc === k), display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setOpenDoc(openDoc === k ? "" : k)}><FileText size={13} />{title}</button>
            <button style={{ ...btn(false), marginLeft: 6, padding: "5px 10px" }} onClick={() => copy(txt)} title="複製全文"><Copy size={13} /></button>
            {openDoc === k && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, background: "#fff", border: `1px solid ${T.BORDER}`, borderRadius: 8, padding: 14, marginTop: 8, lineHeight: 1.7 }}>{txt}</pre>}
          </div>))}
      </div>
    </div>
  );
}
