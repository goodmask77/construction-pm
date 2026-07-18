// ── 設定空間視圖：群組/還原點/更新/紀錄/金庫/通知/用量/AI設定/帳號 ────────────────
// 由 App.jsx 原樣搬出（2026-07-18 拆檔第二刀；行為/畫面零改變）。MailManagerView 在 src/lw/。
import { useState, useEffect, useRef } from "react";
import { supabase, uploadPhoto, deletePhotoFile } from "../supa.js";
import { fmt, projectTotals } from "../lib/cost.js";
import { SPACES, SPACE_CONF, PERM_MATRIX, LEGACY_EDIT, PERM_NONE, ALL_VIEW_KEYS, ALL_EDIT_KEYS, ALL_MONEY_KEYS } from "../lib/spaces.js";
import { ACCENT, SURFACE, BORDER, TEXT, SUB, SecHead } from "../lib/theme.jsx";
import { CURRENT_SPACE, K, CURRENT_USER } from "../lib/runtime.js";
import { LINE_EVENTS, LINE_API_KEY, DEFAULT_LINE_GROUP, _lineSettings, sendLineNotify } from "../lib/line.js";
import { callAI, USD_TWD, KIND_LABEL, buildAdvisorSystem } from "../lib/ai.js";
import { inputStyle } from "../lib/ui.jsx";
import CHANGELOG_GEN from "../changelog.gen.json"; // build 前自動從 git 產生（scripts/gen-changelog.mjs）——手寫漏了也不停更

// ── LINE 群組管理（DD所在的所有群：設權限 + 每日彙報開關）────────────────────
// pm_group_seen：DD自動登記的群清單（名稱/最近活躍/則數，由 bot 寫）
// pm_bot_groups：每個群的設定（mode/綁定工程/彙報開關，由這頁寫）
export function GroupsView({ cats, canEdit, requireLogin, settings, setSettings, journal, events, plans, onLog }) {
  const [seen, setSeen] = useState(null);
  const [cfg, setCfg] = useState({});
  const [saving, setSaving] = useState(false);
  // 設定是全域的：群組/LINE 通知資料一律讀寫「工程空間（bot 老家）」的 key，不跟目前空間走
  // pm_group_seen / pm_bot_groups 本來就是 bot 寫的無前綴全域 key；LINE 通知設定住在工程空間的 pm_settings
  const [gset, setGset] = useState(CURRENT_SPACE === "construction" ? (settings || {}) : null);
  const [gcats, setGcats] = useState(CURRENT_SPACE === "construction" ? (cats || []) : []); // 綁定工程用的大項＝一律工程空間的
  const updSettings = (k, v) => {
    const next = { ...(gset || {}), [k]: v };
    setGset(next);
    if (CURRENT_SPACE === "construction") { setSettings && setSettings(next); }
    else { window.storage.set("pm_settings", JSON.stringify(next), true).catch(() => {}); }
  };

  useEffect(() => {
    (async () => {
      try {
        const s = await window.storage.get("pm_group_seen", true);
        const c = await window.storage.get("pm_bot_groups", true);
        setSeen(s && s.value ? JSON.parse(s.value) : {});
        setCfg(c && c.value ? JSON.parse(c.value) : {});
      } catch { setSeen({}); setCfg({}); }
      if (CURRENT_SPACE !== "construction") {
        try { const r = await window.storage.get("pm_settings", true); setGset(r && r.value ? JSON.parse(r.value) : {}); } catch (_) { setGset({}); }
        try { const r = await window.storage.get("pm_data", true); const d = r && r.value ? JSON.parse(r.value) : []; setGcats(Array.isArray(d) ? d : []); } catch (_) { setGcats([]); }
      }
    })();
  }, []); // eslint-disable-line

  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  const persist = async (next) => {
    setCfg(next); setSaving(true);
    onLog?.("編輯", "調整 LINE 群組設定");
    try { await window.storage.set("pm_bot_groups", JSON.stringify(next), true); } catch (_) {}
    setSaving(false);
  };
  const effMode = (gid) => { const c = cfg[gid] || {}; return c.mode || (gid === DEFAULT_LINE_GROUP ? "internal" : (c.catId ? "vendor" : "locked")); };
  const effDigest = (gid) => (cfg[gid]?.digest !== false);
  const setMode = (gid, mode) => { if (!guard()) return; const c = { ...(cfg[gid] || {}) }; c.mode = mode; if (mode !== "vendor") { delete c.catId; delete c.catName; } persist({ ...cfg, [gid]: c }); };
  const setVendorCat = (gid, catId) => { if (!guard()) return; const cat = (gcats || []).find(x => x.id === catId); persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), mode: "vendor", catId, catName: cat ? cat.name : "" } }); };
  const toggleDigest = (gid) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), digest: !effDigest(gid) } }); };
  const effMonitor = (gid) => (cfg[gid]?.monitor === true);
  const toggleMonitor = (gid) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), monitor: !effMonitor(gid) } }); };
  const effChat = (gid) => cfg[gid]?.chat || (effMode(gid) === "internal" ? "normal" : "quiet");
  const setChat = (gid, val) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), chat: val } }); };
  const renameGroup = (gid, cur) => { if (!guard()) return; const n = window.prompt("這個群的顯示名稱（DD抓不到名字時可手動命名）", cur || ""); if (n === null) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), name: n.trim() || undefined } }); };
  const removeGroup = (gid) => {
    if (!guard()) return;
    if (!window.confirm("從清單移除這個群？\n（若 DD 還在群裡，下次有人講話會再自動出現；只有「已被移出/解散」的死群才會真正消失）")) return;
    const ns = { ...seen }; delete ns[gid]; setSeen(ns);
    try { window.storage.set("pm_group_seen", JSON.stringify(ns), true); } catch (_) {}
    const nc = { ...cfg }; delete nc[gid]; persist(nc);
  };

  if (seen === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;

  // 永遠把內部群放進清單（即使還沒有新訊息）
  // 過濾掉「私訊」誤登記的項目：LINE 個人 id 以 U 開頭（群組 C、聊天室 R）——私訊不是群，不該出現在這頁
  const idsAll = Array.from(new Set([DEFAULT_LINE_GROUP, ...Object.keys(seen), ...Object.keys(cfg)]))
    .filter(gid => !String(gid).startsWith("U") && (seen[gid]?.src !== "user"));
  // 未命名群（抓不到名字的亂碼 ID）直接不顯示（張良 2026-07-18）；DD抓到名字後會自動出現
  const hasName = (gid) => { const n = (cfg[gid]?.name) || seen[gid]?.name || (gid === DEFAULT_LINE_GROUP ? "瑞光路337" : ""); return n && !/^[CRU][0-9a-f]{32}$/.test(n); };
  const ids = idsAll.filter(hasName);
  const hiddenN = idsAll.length - ids.length;
  ids.sort((a, b) => {
    const am = effMode(a) === "internal" ? 0 : 1, bm = effMode(b) === "internal" ? 0 : 1;
    if (am !== bm) return am - bm;
    return (seen[b]?.lastSeen || "").localeCompare(seen[a]?.lastSeen || "");
  });
  const MODE_COLOR = { internal: ACCENT, vendor: "#2E6FB0", locked: SUB };
  const fmtWhen = (iso) => { if (!iso) return "—"; const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); if (days <= 0) return "今天"; if (days === 1) return "昨天"; return `${days}天前`; };
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: SUB, borderBottom: `1.5px solid ${BORDER}`, whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: 13, color: TEXT, borderBottom: `1px solid ${BORDER}`, verticalAlign: "middle" };
  const selStyle = { padding: "4px 6px", borderRadius: 6, border: `1px solid ${BORDER}`, fontSize: 12.5, background: SURFACE, color: TEXT, cursor: "pointer" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 6px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>💬 LINE 群組</div>
        <div style={{ fontSize: 12.5, color: SUB }}>DD所在 {ids.length} 個群{hiddenN > 0 ? `（另 ${hiddenN} 個未命名群已隱藏，抓到群名會自動出現）` : ""}{saving ? " · 儲存中…" : ""}</div>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 14, lineHeight: 1.6 }}>
        <b style={{ color: ACCENT }}>內部群</b>＝自己人，可查預算金額全部工程；<b style={{ color: "#2E6FB0" }}>廠商群</b>＝只回它那項工程進度，<b style={{ color: ACCENT }}>絕不洩漏金額</b>（要選綁定工程）；<b style={{ color: SUB }}>鎖定</b>＝只閒聊。外群一律「叫名字才回話」。<br />
        <b style={{ color: "#B45309" }}>每日彙報</b>＝每晚 8:00 把重點整理私訊你（一天一次）；<b style={{ color: "#b3261e" }}>即時監控</b>＝有重要訊息（變更／缺失／金額／交期／安全…）<b>當下就私訊你</b>。名字抓不到時，點群名旁 ✎ 可手動命名。
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: 12, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead>
            <tr style={{ background: SURFACE }}>
              <th style={th}>群組</th>
              <th style={th}>類型</th>
              <th style={th}>回覆程度</th>
              <th style={th}>綁定工程</th>
              <th style={{ ...th, textAlign: "center" }}>每日彙報</th>
              <th style={{ ...th, textAlign: "center" }}>即時監控</th>
              <th style={{ ...th, textAlign: "right" }}>最近 · 則數</th>
            </tr>
          </thead>
          <tbody>
            {ids.map(gid => {
              const s = seen[gid] || {}; const mode = effMode(gid);
              const isDefault = gid === DEFAULT_LINE_GROUP;
              const name = (cfg[gid]?.name) || s.name || (isDefault ? "瑞光路337（內部群）" : gid);
              const isRawId = /^[CRU][0-9a-f]{32}$/.test(name);
              const dg = effDigest(gid); const mon = effMonitor(gid);
              return (
                <tr key={gid}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: MODE_COLOR[mode], flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: isRawId ? SUB : TEXT, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={isRawId ? "DD抓不到群名，點 ✎ 手動命名" : name}>{isRawId ? "（未命名群）" : name}</span>
                      <button onClick={() => renameGroup(gid, isRawId ? "" : name)} title="改顯示名稱" style={{ border: "none", background: "none", cursor: "pointer", color: isRawId ? ACCENT : SUB, fontSize: 12, padding: 0 }}>✎</button>
                      {!isDefault && <button onClick={() => removeGroup(gid)} title="從清單移除（死群清理）" style={{ border: "none", background: "none", cursor: "pointer", color: isRawId ? "#b3261e" : SUB, fontSize: 12, padding: 0 }}>🗑</button>}
                    </div>
                  </td>
                  <td style={td}>
                    <select value={mode} onChange={e => setMode(gid, e.target.value)} style={{ ...selStyle, fontWeight: 600, color: MODE_COLOR[mode] }}>
                      <option value="internal">內部群</option>
                      <option value="vendor">廠商群</option>
                      <option value="locked">鎖定</option>
                    </select>
                  </td>
                  <td style={td}>
                    <select value={effChat(gid)} onChange={e => setChat(gid, e.target.value)} title="安靜=只有叫它才回；正常=有正事才回、不亂聊；活潑=正事會回＋偶爾俏皮接話" style={selStyle}>
                      <option value="quiet">🤫 安靜</option>
                      <option value="normal">🙂 正常</option>
                      <option value="lively">😄 活潑</option>
                    </select>
                  </td>
                  <td style={td}>
                    {mode === "vendor" ? (
                      <span>
                        <select value={cfg[gid]?.catId || ""} onChange={e => setVendorCat(gid, e.target.value)} style={{ ...selStyle, borderColor: cfg[gid]?.catId ? BORDER : ACCENT }}>
                          <option value="">— 請選 —</option>
                          {(gcats || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        {!cfg[gid]?.catId && <span style={{ color: ACCENT, fontSize: 11, marginLeft: 6 }}>⚠️未綁</span>}
                      </span>
                    ) : <span style={{ color: SUB }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => toggleDigest(gid)} title="每晚 8:00 整理重點私訊給你" style={{ width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${dg ? "#3C8C3C" : BORDER}`, cursor: "pointer", background: dg ? "#3C8C3C" : "transparent", color: "#fff", fontSize: 14, lineHeight: 1, fontWeight: 700 }}>{dg ? "✓" : ""}</button>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => toggleMonitor(gid)} title="有重要訊息(變更/缺失/金額/交期/安全…)當下就私訊你" style={{ width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${mon ? "#b3261e" : BORDER}`, cursor: "pointer", background: mon ? "#b3261e" : "transparent", color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>{mon ? "🔔" : ""}</button>
                  </td>
                  <td style={{ ...td, textAlign: "right", color: SUB, fontSize: 12, whiteSpace: "nowrap" }}>{fmtWhen(s.lastSeen)} · {s.count || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 10, lineHeight: 1.6 }}>
        新群只要 DD 在裡面、有人講話或貼圖，就會自動列進來。設定即時生效。
      </div>
      {/* LINE 通知設定（從 AI設定 整合過來）*/}
      {settings && (
        <div style={{ marginTop: 22 }}>
          <LineNotifySettings settings={gset || {}} upd={updSettings} cats={gcats} journal={journal} events={events} plans={plans} />
        </div>
      )}
    </div>
  );
}

// ── 資料保險箱：版本快照／還原點 ──────────────────────────────────────────────
// 管理員專屬：把「工程資料 / 零用金」每隔一段時間留的還原點列成時間軸，可一鍵還原。
export function HistoryView({ K, confirm, snapshotData, cats, petty }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const META = { pm_data: { label: "工程資料", color: ACCENT }, pm_petty: { label: "零用金", color: "#C2872E" } };
  // 設定是全域 → 還原點彙整全部空間（各空間各存一份 pm_hist_*，只讀當前空間會像「還原點消失」）
  const HIST_SP = { construction: "工程", team: "團隊", crew: "夥伴", finance: "財務", supply: "供應鏈" };
  const histKey = (sp, k) => sp === "construction" ? `pm_hist_${k}` : `sp_${sp}_pm_hist_${k}`;
  const dataKey = (sp, k) => sp === "construction" ? k : `sp_${sp}_${k}`;
  const load = async () => {
    const out = [];
    for (const sp of Object.keys(HIST_SP)) for (const k of ["pm_data", "pm_petty"]) {
      try { const r = await window.storage.get(histKey(sp, k), true); const list = r && r.value ? JSON.parse(r.value) : []; list.forEach(e => out.push({ ...e, key: k, _sp: sp })); } catch (_) {}
    }
    out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    setRows(out);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const summarize = (e) => {
    try {
      const d = JSON.parse(e.json);
      if (e.key === "pm_data") { const arr = Array.isArray(d) ? d : []; const items = arr.reduce((s, c) => s + (c.items || []).length, 0); let t = { est: 0, paid: 0 }; try { t = projectTotals(arr); } catch (_) {} return `${arr.length} 大項・${items} 細項・預估 ${fmt(t.est || 0)}`; }
      if (e.key === "pm_petty") { const adv = (d.advances || []).reduce((s, a) => s + (Number(a.amount) || 0), 0); const sp = (d.spends || []).reduce((s, a) => s + (Number(a.amount) || 0), 0); return `撥款 ${fmt(adv)}・花費 ${fmt(sp)}・餘額 ${fmt(adv - sp)}`; }
    } catch (_) {}
    return "—";
  };
  const fmtWhen = (ts) => { try { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch (_) { return ts; } };
  const noteLabel = (n) => n === "手動還原點" ? "手動建立" : n === "還原前自動存點" ? "還原前自動存" : n === "變更前自動存點" ? "變更前自動存" : "系統自動存點";
  const makePoint = async () => {
    setBusy(true);
    try { await snapshotData("pm_data", cats, { force: true, note: "手動還原點" }); await snapshotData("pm_petty", petty, { force: true, note: "手動還原點" }); } catch (_) {}
    await load(); setBusy(false);
  };
  const restore = async (e) => {
    const m = META[e.key];
    const sp = e._sp || CURRENT_SPACE;
    if (!(await confirm(`確定把「${HIST_SP[sp] || sp}空間的${m.label}」還原回 ${fmtWhen(e.ts)} 的版本？\n\n目前的內容會被覆蓋（但會先自動存一個還原點，之後也能再還原回來）。`, { confirmLabel: "還原" }))) return;
    setBusy(true);
    try {
      // 還原前先把「該空間現在的資料」存成還原點（跨空間直接讀寫該空間的 key，不經 K()）
      try {
        const cur = await window.storage.get(dataKey(sp, e.key), true);
        if (cur && cur.value) {
          const hr = await window.storage.get(histKey(sp, e.key), true);
          const hlist = hr && hr.value ? JSON.parse(hr.value) : [];
          hlist.unshift({ id: "h" + Date.now(), ts: new Date().toISOString(), user: CURRENT_USER || "—", json: cur.value, note: "還原前自動存點" });
          await window.storage.set(histKey(sp, e.key), JSON.stringify(hlist.slice(0, 60)), true);
        }
      } catch (_) {}
      await window.storage.set(dataKey(sp, e.key), e.json, true);
      alert("✅ 已還原，畫面將重新整理。");
      window.location.reload();
    } catch (_) { alert("還原失敗，請再試一次。"); setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>🛟 資料保險箱・還原點</div>
        <div style={{ flex: 1 }} />
        <button onClick={makePoint} disabled={busy} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>＋ 現在建立還原點</button>
      </div>
      <div style={{ fontSize: 12.5, color: SUB, marginBottom: 14, lineHeight: 1.7, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px" }}>
        每一列＝<b>某個時間點「資料當時的樣子」</b>的一份存檔。中間那串數字是<b>當時的內容</b>（不是名稱），按右邊「還原」就會把現在的資料換回那個版本。<br />
        系統會在「工程資料 / 零用金」變動時<b>每隔約 10 分鐘自動存一份</b>（各最多 60 份）；重要操作前也可先按右上角手動存一份。
      </div>
      {rows === null ? <div style={{ padding: 30, textAlign: "center", color: SUB }}>載入中…</div> :
        rows.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: SUB }}>還沒有還原點。資料一有變動就會自動開始累積，或按右上角手動建立。</div> :
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, background: SURFACE, overflow: "hidden" }}>
            {rows.map((e, i) => { const m = META[e.key]; return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderTop: i ? `1px solid #e6ddc9` : "none" }}>
                <div style={{ flexShrink: 0, width: 100, textAlign: "center", fontSize: 11.5, fontWeight: 700, color: "#fff", background: m.color, borderRadius: 6, padding: "4px 0" }}>{HIST_SP[e._sp] || ""}・{e.key === "pm_data" ? "資料" : "零用金"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{fmtWhen(e.ts)} 的版本</div>
                  <div style={{ fontSize: 12, color: SUB, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>當時內容：{summarize(e)}</div>
                  <div style={{ fontSize: 11, color: "#9b9384", marginTop: 1 }}>{e.user || "系統"}・{noteLabel(e.note)}</div>
                </div>
                <button onClick={() => restore(e)} disabled={busy} title="把現在的資料換回這個版本" style={{ flexShrink: 0, background: "#fff", color: ACCENT, border: `1px solid ${ACCENT}`, borderRadius: 7, padding: "6px 16px", fontSize: 12.5, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>↩ 還原</button>
              </div>
            ); })}
          </div>}
    </div>
  );
}

// ── App 更新紀錄（我們對 App 做的功能修改／新增，給全團隊看）─────────────────
// 維護方式：每次有較大改動就在最上面加一筆（日期 + 條列）。
const CHANGELOG = [
  { date: "2026-07-18", items: [
    "供應商加「正式供應商」勾選：廠商頁名稱前打勾才會進叫貨表、並在列表置頂（編輯視窗也有開關）",
    "叫貨表新增搜尋：品名/規格/分類/標籤都能搜，跨廠商比價；品項編輯新增「標籤」欄（逗號分隔），標籤以 #字樣 顯示",
    "廠商頁搜尋升級：連品項一起搜，命中自動展開分類與廠商、只列命中品項",
    "營運報表手機版面：移除 POS 說明文字、更新鈕移到店名右邊、期間改「全部/選月份/自訂起迄」三種取代近X天",
    "修 bug：每日工地速報「關了還照發」——排程現在會讀通知開關（沒勾只同步資料不推播）；推送時間改為台北早上 8:00（原誤設 7:00）",
    "LINE 額度破案：群組推播按「群內人數」計費（1 則 × N 人）——新增「🧪 發 1 則測額度」檢測鈕、推播紀錄改記真實計費則數；App 顯示官方即時數字，LINE 後台總覽有延遲屬正常",
    "導覽大整理：空間「財務內帳」改名「財務報表」，原第三層(總覽/帳戶/交易明細/科目/對帳/營運)攤平升到第二層，「內帳總表」入口移除",
    "「營運」改名「營運報表」並新增分店切換：A Beach 101 / GROUN:D 兩鍵各看各的營收（GROUN:D 待 Eats365 設定寄信後自動進資料）；更新鈕移到最右",
    "⚙ 設定移到第一層（空間列最後面）：全域設定不再藏在工程專案裡；郵件管理從 LWLWLW 空間併入設定（之後可加其他公司信箱），LWLWLW 空間收起",
    "收信管線支援雙店：兩店同日各寄日結信不互蓋、不重複入庫",
    "任務詳情新增「附件」：截圖直接 Cmd+V 貼上、＋上傳檔案、縮圖點開放大、卡片顯示 📎 數",
    "團隊工作收起「任務板/進度」（與任務中心重疊）；營運智慧摘要警示可點開明細（折扣逐筆/退菜Void逐日）",
    "團隊空間去工程字眼：檔案庫類別改 文件/照片/單據、篩選與關聯改「專案/群組」",
    "郵件管理全面重構：信箱下拉切換(可加多信箱)＋總覽頁、單信箱分 待確認/規則/紀錄 三頁；待確認一封信只有 刪除/分類/保留 三鍵、選完問一句要不要變自動規則；規則點列右側抽屜編輯＋適用範圍(全部/指定信箱)；紀錄預設只顯示需注意(刪除+AI判斷)、正常命中折疊",
  ]},
  { date: "2026-07-17", items: [
    "新空間「🔗 供應鏈」上線(P1)：ground-pack 包材系統整併進 App——產品 59 項/類別 10/物料包材 36/廠商 14 全量搬遷完成",
    "產品管理頁：依類別分組(可折疊)/全部攤平、搜尋/類別/標籤/啟用篩選、密表列點開編輯、綁定包材勾選、售價受看金額權限控管",
    "廠商名錄唯讀預覽；叫貨系統與廠商完整版(P2)建置中：依廠商勾品項→叫貨單→D自動發廠商群/LINE分享→到貨點收→待付款進財務",
    "自動收信入庫：App 每天自動讀信箱——中信 e-Cash 匯款通知(歷史786筆已回填，2020/12起) + Eats365 POS 日結報表(Excel附件自動解析)",
    "財務新「📈 營運」分頁：日營收/交易數/客單價/來客 KPI、近30天營收圖、付款方式佔比(現金/信用卡/UberEats)、每日一列日結明細表",
    "財務「對帳」升級為銀行帳務資料庫：每一筆銀行進出永久累積、只增不改，試算表資料一次搬入當底稿(188筆)，之後試算表退役、以資料庫核對所有工程款；可手動新增一筆(未來直接貼網銀截圖AI判讀)",
    "名冊匯入人資「資料總表」：現職 28 人資料補齊(員編/到職日/身分證/勞健保/本薪津貼/薪轉帳戶…)，已離職者不上；欄位可自訂(型別/顯示/必填)",
    "名冊個資保護：表格只顯示公開欄位；完整資料卡(身分證/薪資等機密)只有主管與本人打得開，本人可自己補資料傳文件",
  ]},
  { date: "2026-07-16 深夜", items: [
    "對帳頁改銀行對帳單式：合作金庫帳戶頭+最新餘額、完整欄位(日期/類別/內容/金額/手續費/餘額/收款方/批號/經手/狀態)、餘額走勢+每月支出+類別佔比圖表、未對帳列內快速補記",
    "夥伴中心新增「👥 名冊」分頁：入職人員主檔(姓名綽號同欄/可排序/點列編輯/入職文件上傳/新增刪除)",
    "財務交易明細改 Linear 密表：預設唯讀一行一筆(36px)、✎或雙擊才編輯該列、刪除鈕收進編輯模式",
    "財務內帳新增「🔄 對帳」：公司帳務表(Google試算表)每日自動同步進App，與工程付款/內帳三方比對；只在帳務表的可一鍵補進「工程付款(選大項)」或「內帳」，兩邊同步；D哥 也讀得到帳務表",
    "夥伴中心「360評鑑」完成版：每週五 LINE 自動提醒給回饋、App 內「本週還沒給回饋」提示、迴避設定(立場衝突互不評)、回饋王 👑 加冕；具名/匿名與按讚加分原本就有",
    "任務清單改 Linear 密表(一行一件、欄位對齊、逾期紅字)；全站標題字統一 Montserrat SemiBold(品牌字)",
  ]},
  { date: "2026-07-16 晚", items: [
    "全站改版定案「米色紙感＋硬邊框＋磚紅」（參考自家 ground-pack）：深色頂欄與藍色退場、數字改等寬粗體、紅徽章段落頭",
    "今日頁升級：頂部大數字摘要卡(必處理/QuickWins/在等/卡住)、Quick Wins 按 5/10/15 分鐘分欄、新增「各大項一眼」(完成度/今天/卡住)",
  ]},
  { date: "2026-07-16", items: [
    "介面大改版：深色頂欄＋KPI 彩色卡、導覽/設定全面改用專業線條圖示、金額右對齊等寬字",
    "任務中心升級：釘選＋顏色(全視角同步)、日期/重要度排序、直接新增大項、Cmd+Z 復原、依大項瀑布流、甘特左欄固定、心智圖換行",
    "零用金明細改「預設唯讀、點✎才編輯」＋分頁載入：更快更好讀、不易誤觸；儀表板完工項目摺疊",
    "🔒 修補隱私漏洞：未登入訪客原本看得到全部金額，現在預設全部遮蔽",
    "AI/bot 用量帳單從儀表板移到 設定→用量",
  ]},
  { date: "2026-07-15", items: [
    "任務資料地基 v2：新增 負責人/等待中/依賴任務/預估分鐘 四欄位（防循環依賴、跨視角一致、D哥同步支援）",
    "新增「今日」落地頁：打開任務中心先看 今天必處理/進行中/Quick Wins/在等別人/被卡住/未來7天",
    "任務卡片全視角顯示隸屬大項；D哥 新增 update_task 可用 LINE 更新任務欄位",
  ]},
  { date: "2026-07-01", items: [
    "新增「📌 公開結論」頁：集中存團隊定案、版本控制(更新出新版、舊版進歷史)、D哥可直接回答",
    "新增「✅ 任務中心」：合併取代工序/ToDo，六視角(依大項/看板/清單/時間軸/甘特/心智圖)、收件匣隨手記、小卡拖曳歸屬、大項可直接新增",
    "D哥大升級：改用最高級 Opus、加「對話記憶」(記得前文)、「長期記事本」(永久記重要事)、會自我判斷做不到就直說",
    "修正：中文輸入法打字會重複新增任務的問題、D哥回「確認」沒反應的問題",
  ]},
  { date: "2026-06-22", items: [
    "新增「🛟 還原點」資料保險箱：工程資料/零用金自動留版本、可一鍵還原；搭配 Supabase Pro 每日備份",
    "資料庫上鎖(RLS)：外人無法繞過 App 直接竄改資料",
    "登入紀錄顯示真實姓名(原本都顯示「系統」)；工序日誌紀錄更具體(工項+內容)",
  ]},
  { date: "2026-06-21", items: [
    "操作紀錄全面化：財務/任務/比價/工序/群組…所有操作都會記、且具體",
    "D哥串接全部資料(操作/登入紀錄、比價、夥伴中心)，不再答不出來",
    "D哥動作引擎：可用 LINE 對話直接操作 App(加待辦/記帳/改狀態…含確認)",
  ]},
  { date: "2026-06-13", items: [
    "新增「💰 財務內帳」獨立空間：多帳戶總表、交易明細、會計科目、批量匯入、餘額對帳",
  ]},
];
export function ChangelogView() {
  // 手寫的 CHANGELOG 優先；沒手寫到的日期用 git commit 自動整理保底（不會再「停更」）
  const curated = new Set(CHANGELOG.map(c => c.date));
  const MERGED = [...CHANGELOG, ...CHANGELOG_GEN.filter(g => !curated.has(g.date)).map(g => ({ ...g, auto: true }))]
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <SecHead tag="更新" title="App 更新紀錄" style={{ marginBottom: 6 }} />
      <div style={{ fontSize: 12.5, color: SUB, marginBottom: 16, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 12px" }}>這裡記錄我們對這個系統做的功能新增／修改，讓大家知道最近多了什麼、改了什麼。標「自動」的是從版本紀錄自動整理，文字比較技術一點。</div>
      <div style={{ display: "grid", gap: 12 }}>
        {MERGED.map((c, i) => (
          <div key={c.date} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: i === 0 ? ACCENT : TEXT }}>{c.date}</span>
              {i === 0 && <span style={{ fontSize: 10.5, color: "#fff", background: ACCENT, borderRadius: 5, padding: "1px 7px", fontWeight: 600 }}>最新</span>}
              {c.auto && <span title="從 git 版本紀錄自動整理" style={{ fontSize: 10.5, color: SUB, background: "#eee5d3", borderRadius: 5, padding: "1px 7px", fontWeight: 600 }}>自動</span>}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
              {c.items.map((it, j) => <li key={j} style={{ fontSize: 13, color: TEXT, lineHeight: 1.55 }}>{it}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ACTIVITY LOG PANEL ────────────────────────────────────────────────────────
// 管理員專屬：每個人的登入時間＋操作內容（稽核紀錄）
export function AuditLogView({ activityLog, confirm, onCommit }) {
  const [tab, setTab] = useState("member"); // member | timeline
  const [q, setQ] = useState("");
  const [act, setAct] = useState("all"); // all | 登入 | 編輯
  const [openU, setOpenU] = useState(() => new Set());
  const toggleU = (u) => setOpenU(prev => { const n = new Set(prev); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const isLogin = (a) => a.action === "登入";
  // ── 設定變全域後：紀錄一律「彙整全部空間」（每空間各存一份 pm_activity，只看目前空間會像紀錄不見）──
  const AUD_SP = { construction: "工程", team: "團隊", crew: "夥伴", finance: "財務", supply: "供應鏈", lw: "LW" };
  const audKey = (id) => id === "construction" ? "pm_activity" : `sp_${id}_pm_activity`;
  const [others, setOthers] = useState({}); // 其他空間的紀錄 {spaceId: entries[]}
  useEffect(() => { (async () => {
    const out = {};
    for (const id of Object.keys(AUD_SP)) {
      if (id === CURRENT_SPACE) continue;
      try { const r = await window.storage.get(audKey(id), true); if (r && r.value) out[id] = JSON.parse(r.value) || []; } catch (_) {}
    }
    setOthers(out);
  })(); }, []); // eslint-disable-line
  const allLog = [
    ...(activityLog || []).map(a => ({ ...a, _sp: CURRENT_SPACE })),
    ...Object.entries(others).flatMap(([id, list]) => (list || []).map(a => ({ ...a, _sp: id }))),
  ].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const log = allLog.filter(a => {
    if (act === "登入" && !isLogin(a)) return false;
    if (act === "編輯" && isLogin(a)) return false;
    if (!q.trim()) return true; const s = (a.user + " " + a.action + " " + (a.detail || "") + " " + (AUD_SP[a._sp] || "")).toLowerCase();
    return s.includes(q.trim().toLowerCase());
  });
  const spTag = (a) => <span style={{ fontSize: 10, color: "#8a8171", background: "#f3eddc", border: "1px solid #e4dbc4", borderRadius: 5, padding: "0 6px", flexShrink: 0 }}>{AUD_SP[a._sp] || a._sp}</span>;
  const fmtDT = (ts) => { try { return new Date(ts).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } };
  const fmtT = (ts) => { try { return new Date(ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } };
  // ── 管理員刪除紀錄（跨空間：寫回該筆所屬空間的 key）──
  const sameEntry = (a, b) => a.ts === b.ts && a.user === b.user && a.action === b.action && a.detail === b.detail;
  const strip = (list) => list.map(({ _sp, ...r }) => r);
  const writeSpace = async (id, nextList) => {
    if (id === CURRENT_SPACE) { onCommit && onCommit(strip(nextList)); }
    else { setOthers(o => ({ ...o, [id]: strip(nextList) })); try { await window.storage.set(audKey(id), JSON.stringify(strip(nextList).slice(0, 200)), true); } catch (_) {} }
  };
  const listOf = (id) => id === CURRENT_SPACE ? (activityLog || []) : (others[id] || []);
  const delEntry = async (a) => { if (!confirm || await confirm("刪除這筆紀錄？")) await writeSpace(a._sp, listOf(a._sp).filter(x => !sameEntry(x, a))); };
  const clearMember = async (u) => {
    if (!confirm || await confirm(`清空「${u}」在所有空間的紀錄？`, { confirmLabel: "清空" }))
      for (const id of [CURRENT_SPACE, ...Object.keys(others)]) await writeSpace(id, listOf(id).filter(x => (x.user || "—") !== u));
  };
  const clearAll = async () => {
    if (!confirm || await confirm("清空「全部空間」的登入與操作紀錄？此動作無法復原。", { confirmLabel: "全部清空" }))
      for (const id of [CURRENT_SPACE, ...Object.keys(others)]) await writeSpace(id, []);
  };
  const delX = (a) => <button onClick={(e) => { e.stopPropagation(); delEntry(a); }} title="刪除此筆" style={{ background: "none", border: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }} onMouseEnter={e => e.currentTarget.style.color = "#b3261e"} onMouseLeave={e => e.currentTarget.style.color = "#C8BCA0"}>×</button>;

  // 依成員彙整
  const byUser = {};
  log.forEach(a => { const u = a.user || "—"; (byUser[u] = byUser[u] || []).push(a); });
  const members = Object.entries(byUser).map(([u, list]) => {
    const logins = list.filter(isLogin);
    const lastTs = list.reduce((m, a) => a.ts > m ? a.ts : m, "");
    return { u, list, loginCount: logins.length, lastLogin: logins[0]?.ts, lastTs, actCount: list.length - logins.length };
  }).sort((a, b) => (b.lastTs > a.lastTs ? 1 : -1));

  // 時間軸（依日期）
  const byDate = {}; log.forEach(a => { const d = new Date(a.ts).toLocaleDateString("zh-TW"); (byDate[d] = byDate[d] || []).push(a); });
  const today = new Date().toLocaleDateString("zh-TW");
  const tagStyle = (a) => isLogin(a)
    ? { color: "#2E7D32", background: "#EAF3EA", border: "1px solid #CFE3CF" }
    : { color: "#b5512b", background: "#F6ECE6", border: "1px solid #E6CFC2" };

  return (
    <div style={{ maxWidth: 900, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15", marginBottom: 6 }}>📜 登入與操作紀錄（僅管理員）</div>
      <div style={{ background: "#faf6ee", border: "1px solid #e4ddc9", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#6b6450", lineHeight: 1.7 }}>
        這裡記錄<b>每個人的登入時間</b>與<b>做了什麼</b>（編輯哪一頁），<b>彙整全部空間</b>（每筆有空間標籤）。只有管理員看得到。連續編輯會收斂成每 90 秒一筆，每個空間各保留最近 200 筆。
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {[["member", "👤 依成員"], ["timeline", "🕓 時間軸"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${tab === k ? "#b5512b" : "#d9cfbd"}`, background: tab === k ? "#b5512b" : "#fff", color: tab === k ? "#fff" : "#6F6656", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{l}</button>
        ))}
        <span style={{ width: 1, height: 22, background: "#E0D8C4", margin: "0 2px" }} />
        {[["all", "全部"], ["登入", "只看登入"], ["編輯", "只看操作"]].map(([k, l]) => (
          <button key={k} onClick={() => setAct(k)} style={{ padding: "5px 11px", borderRadius: 999, border: `1px solid ${act === k ? "#7A6F58" : "#d9cfbd"}`, background: act === k ? "#e6ddc9" : "#fff", color: act === k ? "#4A4234" : "#9b9384", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋人名／動作…" style={{ ...inputStyle, width: 180, padding: "6px 10px" }} />
        {allLog.length > 0 && <button onClick={clearAll} title="清空全部空間的紀錄" style={{ background: "#fff", color: "#b3261e", border: "1px solid #F0C0C0", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>🗑 清空全部</button>}
      </div>

      {log.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#9b9384", fontSize: 13 }}>尚無紀錄</div> : tab === "member" ? (
        members.map(m => {
          const open = openU.has(m.u);
          return (
            <div key={m.u} style={{ background: "#fff", border: "1px solid #d9cfbd", borderRadius: 12, padding: "10px 14px", marginBottom: 10 }}>
              <div onClick={() => toggleU(m.u)} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer" }}>
                <span style={{ fontSize: 11, color: "#9b9384", width: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>{m.u}</div>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: "#6F6656" }}>最近登入 <b style={{ color: "#2E7D32" }}>{m.lastLogin ? fmtDT(m.lastLogin) : "—"}</b></span>
                <span style={{ fontSize: 11.5, color: "#9b9384" }}>登入 {m.loginCount} 次・操作 {m.actCount} 次</span>
                <button onClick={(e) => { e.stopPropagation(); clearMember(m.u); }} title="清空此人紀錄" style={{ background: "none", border: "1px solid #E7DFCC", borderRadius: 6, color: "#9b9384", fontSize: 11.5, padding: "2px 8px", cursor: "pointer" }} onMouseEnter={e => { e.currentTarget.style.color = "#b3261e"; e.currentTarget.style.borderColor = "#F0C0C0"; }} onMouseLeave={e => { e.currentTarget.style.color = "#9b9384"; e.currentTarget.style.borderColor = "#E7DFCC"; }}>清空</button>
              </div>
              {open && (
                <div style={{ marginTop: 10, borderTop: "1px solid #F0E9D8", paddingTop: 8 }}>
                  {m.list.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 12.5 }}>
                      <span style={{ fontSize: 11, color: "#9b9384", width: 96, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{fmtDT(a.ts)}</span>
                      {spTag(a)}
                      <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "1px 7px", ...tagStyle(a) }}>{a.action}</span>
                      <span style={{ color: "#4A4234", flex: 1 }}>{a.detail}</span>
                      {delX(a)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      ) : (
        Object.entries(byDate).map(([date, entries]) => (
          <div key={date} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#6F6656", fontWeight: 600, margin: "6px 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ height: 1, flex: 1, background: "#E7DFCC" }} />{date === today ? "今天" : date}<div style={{ height: 1, flex: 1, background: "#E7DFCC" }} />
            </div>
            {entries.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 4px", fontSize: 12.5, borderBottom: "1px solid #F6F1E5" }}>
                <span style={{ fontSize: 11, color: "#9b9384", width: 42, flexShrink: 0 }}>{fmtT(a.ts)}</span>
                <span style={{ fontWeight: 700, color: "#211C15", width: 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.user}</span>
                {spTag(a)}
                <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "1px 7px", ...tagStyle(a) }}>{a.action}</span>
                <span style={{ color: "#4A4234", flex: 1 }}>{a.detail}</span>
                {delX(a)}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

// ── 🔐 加密金庫（零知識）：主密碼只在本機，密碼先加密才上傳，伺服器只存亂碼 ──
const _enc = (s) => new TextEncoder().encode(s);
const _dec = (b) => new TextDecoder().decode(b);
const _b64 = (u8) => { let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const _ub64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function _deriveKey(pw, salt) {
  const mat = await crypto.subtle.importKey("raw", _enc(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// 用「已導出的金鑰」加密（解鎖時導一次 PBKDF2 並快取，之後存檔只跑快速的 AES，不卡打字）
async function vaultEncWithKey(obj, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, _enc(JSON.stringify(obj)));
  return { v: 1, salt: _b64(salt), iv: _b64(iv), ct: _b64(new Uint8Array(ct)) };
}
async function vaultDecWithKey(blob, key) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _ub64(blob.iv) }, key, _ub64(blob.ct)); // 主密碼錯會丟例外
  return JSON.parse(_dec(pt));
}

export function VaultView({ onLog }) {
  const [blob, setBlob] = useState(undefined); // undefined=載入中, null=尚無金庫, obj=密文
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [entries, setEntries] = useState(null); // null=鎖定中, array=已解鎖
  const keyRef = useRef(null); const saltRef = useRef(null); // 快取的 CryptoKey + salt（鎖定即清）
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState({}); const [q, setQ] = useState(""); const [filt, setFilt] = useState("all");

  useEffect(() => { (async () => {
    try { const r = await window.storage.get("pm_vault", true); setBlob(r && r.value ? JSON.parse(r.value) : null); }
    catch (_) { setBlob(null); }
  })(); return () => { keyRef.current = null; saltRef.current = null; }; }, []);

  const isNew = blob === null;
  const save = async (list) => {
    const enc = await vaultEncWithKey({ entries: list }, keyRef.current, saltRef.current);
    setBlob(enc); await window.storage.set("pm_vault", JSON.stringify(enc), true);
  };
  const unlock = async () => {
    setErr(""); if (!pw) return; setBusy(true);
    try {
      if (isNew) {
        if (pw.length < 6) { setErr("主密碼至少 6 碼"); setBusy(false); return; }
        if (pw !== pw2) { setErr("兩次主密碼不一致"); setBusy(false); return; }
        saltRef.current = crypto.getRandomValues(new Uint8Array(16));
        keyRef.current = await _deriveKey(pw, saltRef.current);
        await save([]); setEntries([]);
      } else {
        const salt = _ub64(blob.salt);
        const key = await _deriveKey(pw, salt);
        const data = await vaultDecWithKey(blob, key); // 主密碼錯會丟例外
        keyRef.current = key; saltRef.current = salt; setEntries(data.entries || []);
      }
      setPw(""); setPw2("");
    } catch (_) { setErr("主密碼錯誤，解不開"); }
    setBusy(false);
  };
  // 存檔防抖：打字每敲一鍵都 commit 會「每個字存一次庫＋記一筆操作紀錄」（張良 2026-07-18 抓到刷版 bug）
  // → 畫面即時更新，但實際加密寫庫＋記錄等停止輸入 1 秒後才做一次
  const saveTimer = useRef(null); const pendingRef = useRef(null);
  const flushSave = () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current); saveTimer.current = null;
    const list = pendingRef.current;
    if (list) save(list).then(() => onLog?.("編輯", "更新密碼金庫")).catch(() => setErr("儲存失敗"));
  };
  const commit = (list, instant) => {
    setEntries(list); pendingRef.current = list;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (instant) { saveTimer.current = null; save(list).then(() => onLog?.("編輯", "更新密碼金庫")).catch(() => setErr("儲存失敗")); return; }
    saveTimer.current = setTimeout(() => { saveTimer.current = null; flushSave2(); }, 1000);
  };
  const flushSave2 = () => { const list = pendingRef.current; if (list) save(list).then(() => onLog?.("編輯", "更新密碼金庫")).catch(() => setErr("儲存失敗")); };
  const lock = () => { flushSave(); keyRef.current = null; saltRef.current = null; setEntries(null); setReveal({}); setPw(""); };
  const addEntry = () => commit([...(entries || []), { id: "v" + Math.random().toString(36).slice(2, 8), cat: "company", name: "", account: "", password: "", url: "", notes: "" }], true);
  const upd = (id, k, v) => commit(entries.map(e => e.id === id ? { ...e, [k]: v } : e));
  const del = (id) => commit(entries.filter(e => e.id !== id), true);
  const copy = (t) => { try { navigator.clipboard.writeText(t); } catch (_) {} };
  const [sortKey, setSortKey] = useState("cat"); const [sortDir, setSortDir] = useState(1);
  const [imp, setImp] = useState(null); // 匯入面板 {mode,text,cat,preview,busy,err}
  const fileToB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
  // 貼上解析：Google 試算表複製＝Tab 分隔。欄序 名稱/帳號/密碼/備註/連結；區段標題列(含「帳號」「密碼」)→設目前分類
  const parsePaste = (text, defCat) => {
    const out = []; let cur = defCat || "公司帳號";
    for (const raw of (text || "").split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const cells = (raw.includes("\t") ? raw.split("\t") : raw.split(/ {2,}|,/)).map(c => c.trim());
      if (cells[1] === "帳號" || cells.includes("密碼")) { if (cells[0] && !/帳號|密碼|備註|連結/.test(cells[0])) cur = cells[0]; continue; }
      if (cells.filter(Boolean).length === 1) { cur = cells[0]; continue; }
      const [name, account, password, notes, url] = cells;
      if (!name && !account && !password) continue;
      out.push({ id: "v" + Math.random().toString(36).slice(2, 8), cat: cur, name: name || "", account: account || "", password: password || "", url: url || "", notes: notes || "" });
    }
    return out;
  };
  const runImport = (rows) => { if (rows && rows.length) commit([...(entries || []), ...rows]); setImp(null); };
  const ocrImport = async (file) => {
    setImp(p => ({ ...(p || {}), busy: true, err: "" }));
    try {
      const b64 = await fileToB64(file);
      const block = { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: b64 } };
      const reply = await callAI([{ role: "user", content: [block, { type: "text", text: "把這張帳號密碼表解析成 JSON 陣列，每筆 {cat,name,account,password,notes,url}，cat=該列所屬分類/區段；只輸出一個 ```json 區塊，不要其他文字。" }] }], "你是表格解析助理，只輸出 JSON。", "import");
      const m = reply.match(/```json\s*([\s\S]*?)```/i); const arr = JSON.parse(m ? m[1] : reply);
      const rows = (Array.isArray(arr) ? arr : []).map(r => ({ id: "v" + Math.random().toString(36).slice(2, 8), cat: r.cat || "公司帳號", name: r.name || "", account: r.account || "", password: r.password || "", url: r.url || "", notes: r.notes || "" }));
      setImp(p => ({ ...(p || {}), busy: false, preview: rows }));
    } catch (_) { setImp(p => ({ ...(p || {}), busy: false, err: "解析失敗，請改用「貼上文字」" })); }
  };

  const wrap = { maxWidth: 1080, margin: "16px auto", padding: "0 4px" };
  if (blob === undefined) return <div style={{ ...wrap, padding: 30, color: "#9b9384", textAlign: "center" }}>載入中…</div>;

  // 鎖定畫面
  if (entries === null) return (
    <div style={wrap}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15", marginBottom: 6 }}>🔐 密碼金庫（僅管理員）</div>
      <div style={{ background: "#faf6ee", border: "1px solid #e4ddc9", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#6b6450", lineHeight: 1.7 }}>
        密碼會在<b>你的瀏覽器先加密</b>才上傳，伺服器只存亂碼、<b>連我都看不到明文</b>。只有輸入正確主密碼才解得開。<b style={{ color: "#b45309" }}>主密碼忘了就救不回</b>（這正是它安全的原因）。
      </div>
      <div style={{ maxWidth: 420, background: "#fff", border: "1px solid #d9cfbd", borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#211C15", marginBottom: 12 }}>{isNew ? "設定主密碼（首次建立金庫）" : "輸入主密碼解鎖"}</div>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && !isNew && unlock()} placeholder="主密碼" autoFocus style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
        {isNew && <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === "Enter" && unlock()} placeholder="再輸入一次主密碼" style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }} />}
        {err && <div style={{ color: "#b3261e", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <button onClick={unlock} disabled={busy || !pw} style={{ width: "100%", background: busy || !pw ? "#d9cfbd" : "#b5512b", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 600, cursor: busy || !pw ? "not-allowed" : "pointer" }}>{busy ? "處理中…" : isNew ? "建立金庫" : "解鎖"}</button>
      </div>
    </div>
  );

  // 已解鎖：表格化（分類/排序/篩選/搜尋）+ 批量匯入
  const allCats = Array.from(new Set((entries || []).map(e => e.cat).filter(Boolean)));
  const filtered = entries.filter(e => (filt === "all" || e.cat === filt) && (!q.trim() || (e.cat + e.name + e.account + e.url + e.notes).toLowerCase().includes(q.trim().toLowerCase())));
  const sorted = [...filtered].sort((a, b) => (((a[sortKey] || "") + "").localeCompare((b[sortKey] || "") + "", "zh-Hant")) * sortDir);
  const setSort = (k) => { if (sortKey === k) setSortDir(d => -d); else { setSortKey(k); setSortDir(1); } };
  const arrow = (k) => sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "";
  const cell = { border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, background: "#fff", color: TEXT, width: "100%", boxSizing: "border-box" };
  const ico = { border: `1px solid ${BORDER}`, background: "#fff", borderRadius: 6, padding: "4px 6px", cursor: "pointer", fontSize: 12, flexShrink: 0 };
  const gtc = "130px 1.2fr 1.2fr 1.2fr 1fr 1fr 32px";
  const sep = `1px solid ${BORDER}`;
  const th = (label, k) => <div onClick={k ? () => setSort(k) : undefined} style={{ padding: "7px 8px", fontSize: 11.5, fontWeight: 600, color: "#7A6F58", borderLeft: sep, cursor: k ? "pointer" : "default", userSelect: "none" }}>{label}{k ? arrow(k) : ""}</div>;
  const fld = (e, k, ph) => <input value={e[k] || ""} onChange={ev => upd(e.id, k, ev.target.value)} placeholder={ph} style={cell} />;
  return (
    <div style={wrap}>
      <datalist id="vaultcats">{allCats.map(c => <option key={c} value={c} />)}</datalist>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15" }}>🔐 密碼金庫</div>
        <span style={{ fontSize: 12, color: "#2E7D32" }}>● 已解鎖（{entries.length} 筆）</span>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋…" style={{ ...inputStyle, width: 160, padding: "6px 10px" }} />
        <button onClick={addEntry} style={{ background: "#b5512b", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增</button>
        <button onClick={() => setImp({ mode: "text", text: "", cat: "公司帳號", preview: null, busy: false, err: "" })} style={{ background: "#fff", color: "#b5512b", border: "1px solid #b5512b", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>📋 批量匯入</button>
        <button onClick={lock} title="清除記憶體中的明文" style={{ background: "#fff", color: "#6F6656", border: "1px solid #d9cfbd", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}>🔒 鎖定</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {["all", ...allCats].map(k => { const n = k === "all" ? entries.length : entries.filter(e => e.cat === k).length; return <button key={k} onClick={() => setFilt(k)} style={{ padding: "4px 12px", borderRadius: 999, border: `1px solid ${filt === k ? "#b5512b" : "#d9cfbd"}`, background: filt === k ? "#F4EAE4" : "#fff", color: filt === k ? "#b5512b" : "#6F6656", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{k === "all" ? "全部" : k} {n}</button>; })}
      </div>
      <div style={{ overflowX: "auto", border: sep, borderRadius: 10, background: "#fff" }}>
        <div style={{ minWidth: 760 }}>
          <div style={{ display: "grid", gridTemplateColumns: gtc, background: "#fbf8f1", borderBottom: sep }}>
            {th("分類", "cat")}{th("名稱", "name")}{th("帳號", "account")}{th("密碼", null)}{th("連結", null)}{th("備註", null)}{th("", null)}
          </div>
          {sorted.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "#9b9384", fontSize: 13 }}>沒有資料，點「＋ 新增」或「📋 批量匯入」</div> :
           sorted.map((e, i) => (
            <div key={e.id} style={{ display: "grid", gridTemplateColumns: gtc, alignItems: "center", background: i % 2 ? "#FBF8F0" : "#fff", borderTop: i ? "1px solid #F3EEE1" : "none", padding: "5px 6px", gap: 4 }}>
              <input list="vaultcats" value={e.cat || ""} onChange={ev => upd(e.id, "cat", ev.target.value)} placeholder="分類" style={cell} />
              {fld(e, "name", "名稱")}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>{fld(e, "account", "帳號")}<button onClick={() => copy(e.account)} title="複製" style={ico}>📋</button></div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type={reveal[e.id] ? "text" : "password"} value={e.password || ""} onChange={ev => upd(e.id, "password", ev.target.value)} placeholder="密碼" style={cell} />
                <button onClick={() => setReveal(r => ({ ...r, [e.id]: !r[e.id] }))} title="顯示/隱藏" style={ico}>{reveal[e.id] ? "🙈" : "👁"}</button>
                <button onClick={() => copy(e.password)} title="複製" style={ico}>📋</button>
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>{fld(e, "url", "連結")}{e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ ...ico, textDecoration: "none" }}>↗</a> : null}</div>
              {fld(e, "notes", "備註")}
              <button onClick={() => del(e.id)} title="刪除" style={{ background: "none", border: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 17 }} onMouseEnter={ev => ev.currentTarget.style.color = "#b3261e"} onMouseLeave={ev => ev.currentTarget.style.color = "#C8BCA0"}>×</button>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "#9b9384", marginTop: 8, lineHeight: 1.7 }}>離開此頁或按「🔒 鎖定」會清掉記憶體中的明文。建議主密碼另外抄一份放安全的地方（忘了無法救回）。</div>

      {imp && (
        <div onClick={e => e.target === e.currentTarget && setImp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 18, width: "min(680px,96vw)", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#211C15" }}>📋 批量匯入密碼</div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setImp(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6F6656" }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[["text", "貼上文字（私密）"], ["img", "截圖辨識（送AI）"]].map(([m, l]) => <button key={m} onClick={() => setImp(p => ({ ...p, mode: m, preview: null, err: "" }))} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${imp.mode === m ? "#b5512b" : "#d9cfbd"}`, background: imp.mode === m ? "#b5512b" : "#fff", color: imp.mode === m ? "#fff" : "#6F6656", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{l}</button>)}
            </div>
            {imp.mode === "text" ? (
              <>
                <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>從 Google 試算表整段框選複製、貼到下面（欄序：名稱→帳號→密碼→備註→連結；有「分類標題列」會自動辨識）。<b>此方式在你本機解析，不會外傳。</b></div>
                <textarea value={imp.text} onChange={e => setImp(p => ({ ...p, text: e.target.value, preview: null }))} placeholder="名稱（Tab）帳號（Tab）密碼（Tab）備註（Tab）連結…" rows={7} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "monospace" }} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: "#6F6656" }}>未標分類者歸到：</span>
                  <input value={imp.cat} onChange={e => setImp(p => ({ ...p, cat: e.target.value }))} list="vaultcats" style={{ ...inputStyle, width: 160, padding: "6px 8px" }} />
                  <button onClick={() => setImp(p => ({ ...p, preview: parsePaste(p.text, p.cat) }))} style={{ background: "#fff", color: "#b5512b", border: "1px solid #b5512b", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>解析預覽</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "#C2410C", background: "#FBEFE7", border: "1px solid #F0CFB8", borderRadius: 8, padding: "8px 10px", marginBottom: 8, lineHeight: 1.6 }}>⚠️ 截圖會送到 AI 辨識，<b>圖片裡的密碼會經過 AI 服務</b>。介意隱私請改用「貼上文字」。</div>
                <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) ocrImport(f); }} style={{ fontSize: 13 }} />
                {imp.busy && <div style={{ fontSize: 13, color: "#6F6656", marginTop: 8 }}>AI 辨識中…</div>}
              </>
            )}
            {imp.err && <div style={{ color: "#b3261e", fontSize: 12.5, marginTop: 8 }}>{imp.err}</div>}
            {imp.preview && (
              <div style={{ marginTop: 12, borderTop: sep, paddingTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#211C15", marginBottom: 6 }}>解析出 {imp.preview.length} 筆，預覽前 6 筆：</div>
                {imp.preview.slice(0, 6).map(r => <div key={r.id} style={{ fontSize: 12, color: "#4A4234", padding: "3px 0", borderBottom: "1px solid #F3EEE1" }}>[{r.cat}] {r.name} · {r.account} · {"•".repeat(Math.min(8, (r.password || "").length))}</div>)}
                <button onClick={() => runImport(imp.preview)} disabled={!imp.preview.length} style={{ marginTop: 10, background: imp.preview.length ? "#2E7D32" : "#d9cfbd", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: imp.preview.length ? "pointer" : "not-allowed" }}>✅ 匯入這 {imp.preview.length} 筆</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LINE 通知設定區塊（AI設定 → 專案設定）────────────────────────────────────
function LineNotifySettings({ settings, upd, cats, journal, events, plans }) {
  const [busy, setBusy] = useState(false);
  const [wbusy, setWbusy] = useState(false);
  const [msg, setMsg] = useState("");
  const groupId = settings.lineGroupId ?? DEFAULT_LINE_GROUP;
  const notify = settings.lineNotify || {};
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 4500); };
  const toggle = (k) => upd("lineNotify", { ...notify, [k]: !notify[k] });

  const test = async () => {
    setBusy(true);
    const r = await sendLineNotify(`🔔 GROUN:D 工程管理 — LINE 通知測試\n專案：${settings.projectName || "（未命名）"}\n時間：${new Date().toLocaleString("zh-TW")}`);
    setBusy(false);
    flash(r && r.ok ? "✅ 已送出，請查看 LINE 群組" : `⚠️ 發送失敗：${r?.error || r?.reason || "請確認群組 ID 與 webhook"}`);
  };
  const pushWeekly = async () => {
    setWbusy(true);
    flash("🤖 AI 產生週報中…");
    try {
      const system = buildAdvisorSystem(settings, cats, journal || [], events || [], plans || []);
      const text = await callAI([{ role: "user", content: "請為業主產生一份精簡的本週工程進度週報（約 300 字內，含：整體狀況一句話、各大項進度、本週重點、待決問題、下週預計、整體評估🟢/🟡/🔴）。用業主能懂的口吻，純文字、適合在 LINE 閱讀。" }], system, "weekly");
      const r = await sendLineNotify("📋 本週工程進度週報\n\n" + text);
      flash(r && r.ok ? "✅ 週報已推送到 LINE 群組" : `⚠️ 推送失敗：${r?.error || r?.reason || "請確認群組 ID"}`);
    } catch (e) { flash("⚠️ 產生失敗：" + e.message); }
    setWbusy(false);
  };

  return (
    <div style={{ background: "#fbf8f1", border: "1px solid #d9cfbd", borderRadius: 12, padding: "20px" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#211C15", marginBottom: 4 }}>💬 LINE 通知</div>
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 14 }}>設定推播群組與各類事件通知（設定儲存於共用空間，供伺服器排程使用）</div>

      <div style={{ fontSize: 12.5, color: "#4A4234", fontWeight: 600, marginBottom: 6 }}>LINE 群組 ID</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <input value={groupId} onChange={e => upd("lineGroupId", e.target.value)} placeholder="群組 ID" style={{ flex: 1, minWidth: 200, border: "1px solid #d9cfbd", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "monospace" }} />
        <button onClick={test} disabled={busy} style={{ border: "none", background: "#06C755", color: "#fff", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>{busy ? "傳送中…" : "測試推送"}</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("✅") ? "#3C8C3C" : msg.startsWith("⚠️") ? "#C0392B" : "#6F6656", marginBottom: 10 }}>{msg}</div>}

      <div style={{ fontSize: 12.5, color: "#4A4234", fontWeight: 600, margin: "14px 0 6px" }}>通知開關</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {LINE_EVENTS.map(([k, label]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", cursor: "pointer", fontSize: 13.5, color: "#211C15", borderBottom: "1px solid #ece4d6" }}>
            <input type="checkbox" checked={!!notify[k]} onChange={() => toggle(k)} style={{ width: 18, height: 18, accentColor: ACCENT, flexShrink: 0 }} />
            {label}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#9b9384", marginTop: 8, lineHeight: 1.6 }}>※「有問題 / 完工 / 新日誌」由系統即時推播；「卡關 / 週五週報 / 截止日」為時間排程，由 webhook 伺服器依此設定推播。</div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e6ddc9" }}>
        <button onClick={pushWeekly} disabled={wbusy} style={{ border: "none", background: "#211C15", color: "#fff", borderRadius: 9, padding: "11px 18px", fontSize: 13.5, fontWeight: 600, cursor: wbusy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>{wbusy ? "產生中…" : "📋 立即推送業主週報到 LINE"}</button>
      </div>
    </div>
  );
}

// ── ADVISOR SETTINGS VIEW ────────────────────────────────────────────────────
// ── D哥(LINE bot) 用量 / 估算花費 ────────────────────────────────────────────
const BOT_MODEL_PRICE = { "claude-opus-4-8": [5, 25], "claude-sonnet-4-6": [3, 15], "claude-sonnet-4-5": [3, 15], "claude-haiku-4-5": [1, 5] };
const botPriceFor = (m) => { const k = String(m || "").replace(/-\d{6,}$/, ""); for (const key in BOT_MODEL_PRICE) if (k.startsWith(key)) return BOT_MODEL_PRICE[key]; return [3, 15]; };
const botUsdOf = (m, inTok, outTok) => { const [pi, po] = botPriceFor(m); return (Number(inTok) || 0) / 1e6 * pi + (Number(outTok) || 0) / 1e6 * po; };
export function BotUsagePanel() {
  const [data, setData] = useState(null);
  // D哥用量存全域 key（webhook 寫入不分空間）——不能用 K()，否則從其他空間開設定會顯示 0（張良 2026-07-18 回報「資料消失」）
  const load = async () => { try { const r = await window.storage.get("pm_bot_aiusage", true); setData(r && r.value ? JSON.parse(r.value) : {}); } catch (_) { setData({}); } };
  useEffect(() => { load(); }, []);
  if (data === null) return null;
  const total = data.total || { calls: 0, inTok: 0, outTok: 0 };
  const rows = Object.entries(data.byModel || {}).map(([m, v]) => ({ m: m.replace(/-\d{6,}$/, ""), calls: v.calls || 0, inTok: v.inTok || 0, outTok: v.outTok || 0, usd: botUsdOf(m, v.inTok, v.outTok) })).sort((a, b) => b.usd - a.usd);
  const totUsd = rows.reduce((s, r) => s + r.usd, 0);
  const twd = totUsd * USD_TWD;
  const card = (label, val, sub) => (
    <div style={{ flex: 1, minWidth: 130, background: "#FBF0EC", border: "1px solid #E6C9BE", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#211C15", letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>{val}</div>
      <div style={{ fontSize: 11, color: "#6F6656", marginTop: 2 }}>{label}{sub && <span style={{ color: "#9b9384" }}> {sub}</span>}</div>
    </div>
  );
  return (
    <div style={{ background: "#fbf8f1", border: `1px solid ${ACCENT}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ background: "#1A1A1A", color: "#fff", fontSize: 12, fontWeight: 800, borderRadius: 6, padding: "3px 8px" }}>:D</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>DD（LINE bot）用量 / 估算花費</div>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={{ fontSize: 12, border: "1px solid #d9cfbd", background: "#ece4d6", color: "#6F6656", borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>↻ 重新整理</button>
      </div>
      <div style={{ background: "#FBF0EC", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#6F6656", marginBottom: 14 }}>
        DD 在 LINE（守門 + 思考 + 彙報 + 監控）累計呼叫 Anthropic API 的<b style={{ color: ACCENT }}>估算</b>花費。<b>這是主要花費。</b>精確帳以 platform.claude.com → Usage（篩 ground-bot key）為準。
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {card("估算總花費（USD）", "$" + totUsd.toFixed(3))}
        {card("估算總花費（TWD）", "NT$" + Math.round(twd).toLocaleString(), `@${USD_TWD}`)}
        {card("AI 呼叫次數", (total.calls || 0).toLocaleString())}
        {card("總 tokens（in+out）", ((total.inTok || 0) + (total.outTok || 0)).toLocaleString())}
      </div>
      {rows.length > 0 ? (
        <div style={{ border: "1px solid #E3DAC6", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", background: "#ece4d6", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>模型（錢花在哪）</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div>
          </div>
          {rows.map((r) => (
            <div key={r.m} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #e6ddc9", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.m}{/haiku/.test(r.m) ? "（守門/監控）" : /sonnet/.test(r.m) ? "（主力思考）" : ""}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{r.calls}</div>
              <div style={{ flex: 1.4, textAlign: "right" }}>{(r.inTok + r.outTok).toLocaleString()}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace" }}>${r.usd.toFixed(3)}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace", color: ACCENT }}>{Math.round(r.usd * USD_TWD).toLocaleString()}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#9b9384", textAlign: "center", padding: "12px 0" }}>尚無紀錄（從 v7.5 起累計；DD 之後每次在 LINE 動作就會記）</div>
      )}
      <div style={{ fontSize: 11, color: "#9b9384", marginTop: 10 }}>{data.since ? `自 ${String(data.since).slice(0, 10)} 起累計` : ""}　⚠ 估算值，精確帳以 Console（ground-bot key）為準。</div>
      <LineQuotaBlock />
    </div>
  );
}

// ── LINE 訊息額度（本月已用/上限 + 最近推播去向）——張良測試時不用開 LINE 官方後台 ──
function LineQuotaBlock() {
  const [q, setQ] = useState(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null); // 額度自我檢測：null | "run" | {before,after} | {err}
  const load = async () => { setBusy(true); try { const r = await fetch("/api/line-quota"); setQ(await r.json()); } catch (_) { setQ({ ok: false, error: "連線失敗" }); } setBusy(false); };
  useEffect(() => { load(); }, []);
  // 額度檢測：記下推播前數字 → 真的發 1 則到群 → 等官方計數跳動 → 顯示前後對照（張良 2026-07-18：驗證計數到底準不準）
  const runTest = async () => {
    setTest("run");
    try {
      const q1 = await (await fetch("/api/line-quota")).json();
      const before = q1?.used;
      const s = await _lineSettings();
      const to = s.lineGroupId || DEFAULT_LINE_GROUP;
      const pr = await (await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": LINE_API_KEY }, body: JSON.stringify({ to, text: `🧪 額度檢測：這是 1 則測試訊息（發送前本月已用 ${before ?? "?"} 則）`, src: "額度檢測" }) })).json();
      if (!pr.ok) { setTest({ err: pr.error || "推播失敗" }); return; }
      let after = before;
      for (const ms of [2500, 4000, 6000]) { // 官方計數通常幾秒內跳，最多等三輪
        await new Promise(r2 => setTimeout(r2, ms));
        const q2 = await (await fetch("/api/line-quota")).json();
        after = q2?.used ?? after;
        if (after != null && before != null && after > before) break;
      }
      setTest({ before, after, members: pr.members, billed: pr.billed });
      load();
    } catch (e) { setTest({ err: String(e) }); }
  };
  if (!q) return <div style={{ fontSize: 12, color: "#9b9384", marginTop: 14 }}>LINE 訊息額度載入中…</div>;
  if (!q.ok) return <div style={{ fontSize: 12, color: "#9b9384", marginTop: 14 }}>LINE 訊息額度：{q.error}</div>;
  const pct = q.limit ? Math.min(100, Math.round((q.used || 0) / q.limit * 100)) : 0;
  const warn = pct >= 80;
  return (
    <div style={{ marginTop: 16, borderTop: "1.5px solid #E3DAC6", paddingTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#211C15" }}>💬 LINE 訊息額度（本月）</div>
        <div style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: warn ? "#b3261e" : "#211C15" }}>{(q.used ?? "?").toLocaleString?.() || q.used} / {q.limit ? q.limit.toLocaleString() : "無上限"}</div>
        <div style={{ flex: 1 }} />
        <button onClick={runTest} disabled={test === "run"} title="真的發 1 則到群，對照發送前後的官方計數" style={{ border: "1px solid #d9cfbd", background: "#fff", color: "#5a5247", borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{test === "run" ? "檢測中…" : "🧪 發 1 則測額度"}</button>
        <button onClick={load} disabled={busy} style={{ border: "1px solid #d9cfbd", background: "#fff", color: "#5a5247", borderRadius: 7, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{busy ? "…" : "↻ 重新整理"}</button>
      </div>
      {test && test !== "run" && (
        <div style={{ background: test.err ? "#fdf3f2" : "#eef5ef", border: `1.5px solid ${test.err ? "#b3261e" : "#3f7d4e"}`, borderRadius: 8, padding: "7px 12px", marginBottom: 8, fontSize: 12.5, fontWeight: 600, color: test.err ? "#8c1d16" : "#2c5a38" }}>
          {test.err ? "❌ 檢測失敗：" + test.err
            : `推播前 ${test.before ?? "?"} → 推播後 ${test.after ?? "?"}` + (() => {
              const d = test.after - test.before;
              const exp = test.billed || 1;
              if (d === 0) return "（+0）⚠ 官方計數還沒跳——等幾秒按「↻ 重新整理」再看";
              if (d === exp) return `（+${d}）✓ 計數正常：LINE 群組推播按「群內人數」計費——這群 ${test.members} 人，1 則 × ${test.members} 人 = 扣 ${d} 則`;
              return `（+${d}）⚠ 與預期 ${exp} 不符（這群 ${test.members || "?"} 人）——可能同時有其他推播也在計`;
            })()}
        </div>
      )}
      {q.limit && <div style={{ height: 8, background: "#eee5d3", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}><div style={{ width: pct + "%", height: "100%", background: warn ? "#b3261e" : "#3f7d4e" }} /></div>}
      <div style={{ fontSize: 11, color: "#9b9384", marginBottom: 10 }}>只有「主動推播」計額度，且群組推播按「群內人數」計費：發 1 則到 10 人的群＝扣 10 則（人越多越貴）；在群裡回話（reply）不計、免費。這裡是官方「即時」API 數字；LINE 後台總覽頁更新有延遲（常慢幾小時～一天），以這裡為準。</div>
      {(q.items || []).length > 0 && (
        <div style={{ border: "1px solid #E3DAC6", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", background: "#ece4d6", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "5px 12px" }}>
            <div style={{ width: 96 }}>時間</div><div style={{ flex: 1.4 }}>推到哪</div><div style={{ flex: 1 }}>來源</div><div style={{ width: 44, textAlign: "right" }}>則數</div><div style={{ width: 44, textAlign: "right" }}>人數</div><div style={{ width: 56, textAlign: "right" }}>計費數</div>
          </div>
          {q.items.slice(0, 10).map((it, i) => (
            <div key={i} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "5px 12px", borderTop: "1px solid #e6ddc9" }}>
              <div style={{ width: 96, fontFamily: "monospace", fontSize: 11, color: "#9b9384" }}>{new Date(it.ts).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
              <div style={{ flex: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
              <div style={{ flex: 1, color: "#5a5247" }}>{it.src || "—"}</div>
              <div style={{ width: 44, textAlign: "right", fontFamily: "monospace" }}>{it.n}</div>
              <div style={{ width: 44, textAlign: "right", fontFamily: "monospace", color: "#9b9384" }}>{it.m ?? "—"}</div>
              <div style={{ width: 56, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }} title={it.b == null ? "舊紀錄沒存人數，算不出計費數" : ""}>{it.b ?? "—"}</div>
            </div>
          ))}
        </div>
      )}
      {(q.items || []).length === 0 && <div style={{ fontSize: 11.5, color: "#9b9384" }}>推播去向紀錄從現在開始累積（之後每次推播都會記：時間/推到哪個群/來源/則數）。</div>}
    </div>
  );
}

// ── AI 用量 / 估算花費面板 ───────────────────────────────────────────────────
export function AIUsagePanel() {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    // AI 用量每空間各存一份 → 設定是全域的，彙整全部空間加總（否則從別的空間開設定像歸零）
    const keys = ["pm_ai_usage", ...["team", "crew", "finance", "supply", "lw"].map(id => `sp_${id}_pm_ai_usage`)];
    const all = [];
    for (const k of keys) { try { const r = await window.storage.get(k, true); if (r && r.value) all.push(...(JSON.parse(r.value) || [])); } catch (_) {} }
    setLog(all);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const totUsd = log.reduce((s, e) => s + (Number(e.usd) || 0), 0);
  const totIn = log.reduce((s, e) => s + (Number(e.inTok) || 0), 0);
  const totOut = log.reduce((s, e) => s + (Number(e.outTok) || 0), 0);
  const calls = log.length;
  const twd = totUsd * USD_TWD;
  // 依模型細分
  const byModel = {};
  for (const e of log) {
    const k = (e.model || "?").replace(/-\d{6,}$/, "");
    if (!byModel[k]) byModel[k] = { calls: 0, inTok: 0, outTok: 0, usd: 0 };
    byModel[k].calls++; byModel[k].inTok += Number(e.inTok) || 0; byModel[k].outTok += Number(e.outTok) || 0; byModel[k].usd += Number(e.usd) || 0;
  }
  const models = Object.entries(byModel).sort((a, b) => b[1].usd - a[1].usd);
  // 依用途細分（AI顧問對話/PDF匯入/週報/比價/日誌整理）
  const byKind = {};
  for (const e of log) {
    const k = e.kind || "chat";
    if (!byKind[k]) byKind[k] = { calls: 0, tok: 0, usd: 0 };
    byKind[k].calls++; byKind[k].tok += (Number(e.inTok) || 0) + (Number(e.outTok) || 0); byKind[k].usd += Number(e.usd) || 0;
  }
  const kinds = Object.entries(byKind).sort((a, b) => b[1].usd - a[1].usd);

  const card = (label, val, sub) => (
    <div style={{ flex: 1, minWidth: 130, background: "#FBF7EE", border: "1px solid #E3DAC6", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#211C15", letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>{val}</div>
      <div style={{ fontSize: 11, color: "#6F6656", marginTop: 2 }}>{label}{sub && <span style={{ color: "#9b9384" }}> {sub}</span>}</div>
    </div>
  );

  return (
    <div style={{ background: "#fbf8f1", border: "1px solid #d9cfbd", borderRadius: 12, padding: 20, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ background: ACCENT, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "2px 7px" }}>AI</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>AI 用量 / 估算花費</div>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={{ fontSize: 12, border: "1px solid #d9cfbd", background: "#ece4d6", color: "#6F6656", borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>↻ 重新整理</button>
      </div>
      <div style={{ background: "#ece4d6", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#6F6656", marginBottom: 14 }}>
        本 App 自己呼叫 Anthropic <b>API</b>（非群組）的累計用量與<b style={{ color: ACCENT }}>估算</b>花費。LINE 群組產生的花費屬 bot 端帳，這裡看不到；Claude 訂閱／Claude Code 也是另一套帳。
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {card("估算總花費（USD）", "$" + totUsd.toFixed(3))}
        {card("估算總花費（TWD）", "NT$" + Math.round(twd).toLocaleString(), `@${USD_TWD}`)}
        {card("AI 呼叫次數", calls.toLocaleString())}
        {card("總 tokens（in+out）", (totIn + totOut).toLocaleString())}
      </div>
      {kinds.length > 0 && (
        <div style={{ border: "1px solid #E3DAC6", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ display: "flex", background: "#ece4d6", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>用途（錢主要花在哪）</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div><div style={{ flex: 1, textAlign: "right" }}>占比</div>
          </div>
          {kinds.map(([k, v]) => (
            <div key={k} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #e6ddc9", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{KIND_LABEL[k] || k}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{v.calls}</div>
              <div style={{ flex: 1.4, textAlign: "right" }}>{v.tok.toLocaleString()}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace" }}>${v.usd.toFixed(3)}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace", color: ACCENT }}>{Math.round(v.usd * USD_TWD).toLocaleString()}</div>
              <div style={{ flex: 1, textAlign: "right", color: "#6F6656" }}>{totUsd > 0 ? Math.round(v.usd / totUsd * 100) : 0}%</div>
            </div>
          ))}
        </div>
      )}
      {models.length > 0 && (
        <div style={{ border: "1px solid #E3DAC6", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", background: "#ece4d6", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>模型</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div>
          </div>
          {models.map(([m, v]) => (
            <div key={m} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #e6ddc9", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{v.calls}</div>
              <div style={{ flex: 1.4, textAlign: "right" }}>{(v.inTok + v.outTok).toLocaleString()}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace" }}>${v.usd.toFixed(3)}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace", color: ACCENT }}>{Math.round(v.usd * USD_TWD).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      {!loading && calls === 0 && <div style={{ fontSize: 12, color: "#9b9384", textAlign: "center", padding: "12px 0" }}>尚無 AI 呼叫紀錄（用過 AI 顧問或匯入後會自動累計）</div>}
      <div style={{ fontSize: 11, color: "#9b9384", marginTop: 10 }}>⚠ 為前端估算值，精確帳務請以 platform.claude.com → Usage 為準。</div>
    </div>
  );
}

export function AdvisorSettingsView({ settings, setSettings, cats, aiLog, setAiLog, activityLog, logActivity, userName, journal, events, plans }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const upd = (field, val) => setSettings({ ...settings, [field]: val });
  const fieldStyle = { width:"100%", padding:"9px 12px", border:"1px solid #d9cfbd", borderRadius:8, fontSize:13, color:"#211C15", outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", background:"#f9fafb" };
  const docs = settings.aiDocs || [];
  const addDocs = async (files) => {
    const arr = Array.from(files || []); if (!arr.length) return;
    setBusy(true);
    const out = [];
    for (const f of arr) { try { const { url, path } = await uploadPhoto(f); out.push({ id:"doc-"+Math.random().toString(36).slice(2,8), url, path, name:f.name||"檔案", isImage:!!(f.type||"").startsWith("image/") }); } catch(_){} }
    setBusy(false);
    if (out.length) upd("aiDocs", [...docs, ...out]);
  };
  const delDoc = async (i) => { const d = docs[i]; if (d?.path) { try { await deletePhotoFile(d.path); } catch(_){} } upd("aiDocs", docs.filter((_,x)=>x!==i)); };
  const card = { background:"#fbf8f1", border:"1px solid #d9cfbd", borderRadius:12, padding:20, marginBottom:14 };
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, margin:"6px 0 14px" }}>
        <span style={{ background:ACCENT, color:"#fff", fontSize:11, fontWeight:700, borderRadius:5, padding:"2px 7px" }}>AI</span>
        <div style={{ fontSize:17, fontWeight:700, color:TEXT }}>AI 知識庫 / 指示</div>
      </div>
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:600, color:"#211C15", marginBottom:8 }}>📌 給 AI 的指示</div>
        <div style={{ fontSize:12, color:"#6F6656", marginBottom:8 }}>告訴 AI 要特別注意的事：假日不得施工、業主偏好、付款方式、特殊限制…（AI 顧問與週報都會參考）</div>
        <textarea value={settings.notes||""} onChange={e=>upd("notes",e.target.value)} style={{ ...fieldStyle, height:130, resize:"vertical" }} placeholder="例如：週六日不得施工、磁磚需業主現場確認才下單、廠商付款 30 天票期…" />
      </div>
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:600, color:"#211C15", marginBottom:8 }}>📎 參考檔案（知識庫）</div>
        <div style={{ fontSize:12, color:"#6F6656", marginBottom:10 }}>上傳施工手冊、規範、合約等，作為 AI 提醒與回答的依據。也可從 LINE 直接把檔案丟給 D 哥。</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:6 }}>
          {docs.map((d,i)=>(
            <div key={i} style={{ position:"relative" }}>
              {d.isImage
                ? <img src={d.url} alt={d.name} title={d.name} onClick={()=>window.open(d.url,"_blank")} style={{ width:80,height:80,objectFit:"cover",borderRadius:8,border:"1px solid #d9cfbd",cursor:"pointer" }} />
                : <div onClick={()=>window.open(d.url,"_blank")} title={d.name+"（點擊開啟）"} style={{ width:80,height:80,borderRadius:8,border:"1px solid #d9cfbd",background:"#fbeee6",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,padding:4,boxSizing:"border-box" }}><span style={{ fontSize:26 }}>📄</span><span style={{ fontSize:8,color:"#6F6656",width:"100%",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{d.name}</span></div>}
              <button onClick={()=>delDoc(i)} style={{ position:"absolute",top:-7,right:-7,width:18,height:18,borderRadius:"50%",background:"#b3261e",color:"#fff",border:"none",fontSize:11,cursor:"pointer" }}>×</button>
            </div>
          ))}
          <label style={{ width:80,height:80,borderRadius:8,border:"1px dashed #d9cfbd",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",color:"#9b9384",fontSize:12 }}>
            <span style={{ fontSize:22 }}>{busy?"…":"＋"}</span>{busy?"上傳中":"上傳"}
            <input ref={fileRef} type="file" multiple style={{ display:"none" }} onChange={e=>{ addDocs(e.target.files); e.target.value=""; }} />
          </label>
        </div>
        <div style={{ fontSize:11, color:"#9b9384", marginTop:8 }}>※ 目前 AI 會知道有哪些參考檔；「自動解析檔案內容做工種提醒」為進階功能，將逐步開放。</div>
      </div>
      <div style={{ ...card, marginBottom:0, background:"#FBF7EE" }}>
        <div style={{ fontSize:13, color:"#6F6656", lineHeight:1.8 }}>💡 <b>AI 用量 / 估算花費</b> 已移到「儀表板」。｜ AI 顧問對話請點右上角「AI 顧問」。｜ LINE 通知設定已整合到「群組」分頁。｜ 優先追蹤改在項目上點 ☆。</div>
      </div>
    </div>
  );
}

// ── 帳號管理 ─────────────────────────────────────────────────────────────────
const ACCT_SPACES = [["construction","🏗 工程專案"],["team","👥 團隊工作"],["crew","🤝 夥伴中心"],["finance","💰 財務報表"],["supply","🔗 供應鏈"]];
const ACCT_VIEW_PAGES = [["owner","儀表板"],["overview","總覽"],["tasks","任務"],["gantt","工序"],["conclusions","結論"],["files","檔案庫"],["petty","零用金"],["compare","比價"],["advisor","AI設定"]];
const ACCT_EDIT_PAGES = [["data","總覽/工程資料"],["worklog","工序日誌"],["files","檔案庫"],["advisor","AI設定"]];
export function AccountManager({ confirm, myId, roles = [], commitRoles, onLog, guestPerms = {}, commitGuestPerms }) {
  const logAct = (action, detail) => { try { onLog && onLog(action, detail); } catch (_) {} };
  const permLogRef = useRef({});
  const logThrottled = (action, key) => { const k = action + "|" + key; const now = Date.now(); if (now - (permLogRef.current[k] || 0) < 12000) return; permLogRef.current[k] = now; logAct(action, key); }; // 連續勾選收斂成一筆
  const [list, setList] = useState(null); // null=loading
  const [err, setErr] = useState("");
  const [nName, setNName] = useState(""); const [nUser, setNUser] = useState(""); const [nPw, setNPw] = useState(""); const [nAdmin, setNAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openSp, setOpenSp] = useState(() => new Set()); // 展開中的「帳號:空間」key（預設全部收合，清爽）
  const [openAcct, setOpenAcct] = useState(() => new Set()); // 展開中的帳號id
  const toggleSet = (setter, key) => setter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const load = async () => {
    if (!supabase) { setErr("系統未設定登入服務"); setList([]); return; }
    const { data, error } = await supabase.from("profiles").select("*").order("role").order("display_name");
    if (error) { setErr("讀取帳號失敗：" + error.message); setList([]); return; }
    setErr(""); setList(data || []);
  };
  useEffect(() => { load(); }, []);
  const authToken = async () => (await supabase.auth.getSession()).data.session?.access_token;
  const api = async (body) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch("/api/admin-users", { method:"POST", headers:{ "content-type":"application/json", authorization:`Bearer ${await authToken()}` }, body: JSON.stringify(body), signal: ctrl.signal });
      const d = await r.json().catch(()=>({})); if (!r.ok) throw new Error(d.error || "操作失敗"); return d;
    } catch(e) { throw new Error(e.name === "AbortError" ? "連線逾時，請重新整理頁面後再試一次" : (e.message || "操作失敗")); }
    finally { clearTimeout(timer); }
  };

  const patch = async (id, changes) => {
    setList(prev => prev.map(p => p.id===id ? { ...p, ...changes } : p));
    const { error } = await supabase.from("profiles").update(changes).eq("id", id);
    if (error) { setErr("儲存失敗：" + error.message); load(); }
  };
  // ── 矩陣勾選邏輯（含舊資料具體化：第一次動手就把「預設全可見/全域金額」攤成明確清單）──
  // 三個維度一律「預設全開」：[]＝全部允許、[PERM_NONE]＝全部禁止、其餘＝明確允許清單。勾＝開、取消＝關。
  const viewChecked = (p, sid, pg) => { const vp = p.view_pages || []; if (!vp.length) return true; return vp.includes(`${sid}:${pg}`) || vp.includes(pg); };
  const editChecked = (p, sid, pg) => { const ep = p.pages || []; if (!ep.length) return true; return ep.includes(`${sid}:${pg}`) || ep.includes(LEGACY_EDIT[pg]); };
  const moneyChecked = (p, sid, pg) => { const mp = p.money_pages || []; if (!mp.length) return true; return mp.includes(`${sid}:${pg}`); };
  const spaceChecked = (p, sid) => { const sp = p.spaces || []; return !sp.length || sp.includes(sid); };

  // 通用切換：對任一實體(帳號或身份範本)操作，save 決定存到哪。攤成明確清單後依「全開→[]、全關→[PERM_NONE]」收斂。
  const applyToggle = (obj, field, all, isOn, key, save) => {
    let cur = all.filter(k => { const [s, g] = k.split(":"); return isOn(obj, s, g); });
    cur = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    save({ [field]: cur.length === all.length ? [] : (cur.length === 0 ? [PERM_NONE] : cur) });
  };
  const tView = (obj, sid, pg, save) => applyToggle(obj, "view_pages", ALL_VIEW_KEYS, viewChecked, `${sid}:${pg}`, save);
  const tEdit = (obj, sid, pg, save) => applyToggle(obj, "pages", ALL_EDIT_KEYS, editChecked, `${sid}:${pg}`, save);
  const tMoney = (obj, sid, pg, save) => applyToggle(obj, "money_pages", ALL_MONEY_KEYS, moneyChecked, `${sid}:${pg}`, save);
  const tSpace = (obj, sid, save) => {
    const sp = obj.spaces || [];
    let base = sp.length ? [...sp] : SPACES.map(s => s.id);
    base = base.includes(sid) ? base.filter(x => x !== sid) : [...base, sid];
    save({ spaces: base.length === SPACES.length ? [] : base });
  };
  // ── 身份範本（連動）CRUD ──
  const updateRole = (id, changes) => commitRoles && commitRoles(roles.map(r => r.id === id ? { ...r, ...changes } : r));
  const addRole = () => { const n = window.prompt("新增身份名稱（例：工地監工）"); if (!n || !n.trim() || !commitRoles) return; commitRoles([...roles, { id: "role-" + Math.random().toString(36).slice(2, 7), name: n.trim(), spaces: [], view_pages: [], pages: [], money_pages: [] }]); logAct("新增身份", n.trim()); };
  const renameRole = (r) => { const n = window.prompt("身份改名", r.name); if (n && n.trim()) { updateRole(r.id, { name: n.trim() }); logAct("身份改名", `${r.name}→${n.trim()}`); } };
  const delRole = async (r) => {
    if (!(await confirm(`刪除身份「${r.name}」？指派此身份的帳號會變回「自訂」。`, { confirmLabel: "刪除" })) || !commitRoles) return;
    commitRoles(roles.filter(x => x.id !== r.id));
    (list || []).filter(p => p.role_template === r.id).forEach(p => patch(p.id, { role_template: null }));
    logAct("刪除身份", r.name);
  };
  const roleName = (id) => roles.find(r => r.id === id)?.name;

  const addAcct = async () => {
    if (!nUser.trim() || !nPw || busy) return;
    setBusy(true); setErr("");
    try { await api({ action:"create", username:nUser.trim(), password:nPw, displayName:nName.trim()||nUser.trim(), role:nAdmin?"admin":"staff" });
      logAct("新增帳號", (nName.trim()||nUser.trim()) + (nAdmin ? "（管理員）" : ""));
      setNName(""); setNUser(""); setNPw(""); setNAdmin(false); setBusy(false); load(); // 建好即放開按鈕，清單在背景刷新（不卡住）
      return;
    } catch(e){ setErr(e.message); }
    setBusy(false);
  };
  const delAcct = async (p) => {
    if (!(await confirm(`刪除帳號「${p.display_name}」？刪除後此人將無法再登入。`, { confirmLabel:"刪除" }))) return;
    setErr(""); try { await api({ action:"delete", id:p.id }); logAct("刪除帳號", p.display_name); load(); } catch(e){ setErr(e.message); }
  };
  const resetPw = async (p) => {
    const np = window.prompt(`輸入「${p.display_name}」的新密碼（至少 6 碼）：`); if (!np) return;
    setErr(""); try { await api({ action:"resetPassword", id:p.id, password:np }); logAct("重設密碼", p.display_name); alert("已重設密碼"); } catch(e){ setErr(e.message); }
  };
  const renamePerson = (p) => { const n = window.prompt("改顯示名稱（給人看的，不影響登入）：", p.display_name); if (n && n.trim() && n.trim() !== p.display_name) { patch(p.id, { display_name: n.trim() }); logAct("改顯示名稱", `${p.display_name}→${n.trim()}`); } };
  const changeUsername = async (p) => {
    const cur = (p.email || "").split("@")[0];
    const n = window.prompt(`改登入帳號（目前：${cur}）。\n改完這個人要改用新帳號登入：`, cur);
    if (!n || !n.trim() || n.trim() === cur) return;
    setErr(""); try { await api({ action: "update", id: p.id, username: n.trim() }); logAct("改登入帳號", `${p.display_name}：${cur}→${n.trim()}`); load(); alert(`已改成「${n.trim()}」，請通知本人改用新帳號登入。`); } catch (e) { setErr(e.message); }
  };

  const cbox = (on, onClick, color = "#3C8C3C") => (
    <button onClick={onClick} title={on ? "已開啟，點擊關閉" : "已關閉，點擊開啟"} style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${on ? color : "#CFC6B0"}`, background: on ? color : "#fff", color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>{on ? "✓" : ""}</button>
  );
  const pill = (on, label, onClick) => (
    <button onClick={onClick} style={{ padding: "4px 12px", borderRadius: 999, border: `1px solid ${on ? "#3C8C3C" : "#d9cfbd"}`, background: on ? "#EAF3EA" : "#ece4d6", color: on ? "#2E7D32" : "#9b9384", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{on ? "✓ " : ""}{label}</button>
  );

  // 可重用矩陣：對任一實體(帳號或身份範本)渲染「每空間×每頁」勾選表。readOnly＝唯讀(顯示連動帳號的實際權限)。
  const renderMatrix = (obj, save, idPrefix, readOnly = false, hideEdit = false) => (
    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      {ACCT_SPACES.map(([sid, slabel]) => {
        const rows = PERM_MATRIX[sid] || [];
        const on = spaceChecked(obj, sid);
        const hasMoney = !!SPACE_CONF[sid]?.showCost;
        const spKey = idPrefix + ":" + sid;
        const spOpen = openSp.has(spKey);
        const visN = rows.filter(([pg]) => viewChecked(obj, sid, pg)).length;
        const editN = rows.filter(([pg,, c]) => c.edit && editChecked(obj, sid, pg)).length;
        const moneyN = hasMoney ? rows.filter(([pg,, c]) => c.money && moneyChecked(obj, sid, pg)).length : 0;
        const click = (fn) => readOnly ? undefined : fn;
        return (
          <div key={sid} style={{ border: "1px solid #E7DFCC", borderRadius: 10, overflow: "hidden", opacity: on ? 1 : 0.6 }}>
            <div onClick={() => on && toggleSet(setOpenSp, spKey)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F7F2E7", padding: "8px 12px", cursor: on ? "pointer" : "default" }}>
              <span style={{ fontSize: 11, color: "#9b9384", width: 10, display: "inline-block", transform: spOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>{on ? "▸" : ""}</span>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#211C15" }}>{slabel}</div>
              {on && !spOpen && <span style={{ fontSize: 11.5, color: "#9b9384" }}>可見 {visN}/{rows.length}・可編輯 {editN}{hasMoney ? `・看金額 ${moneyN}` : ""}</span>}
              <div style={{ flex: 1 }} />
              {pill(on, "可進入", (e) => { e.stopPropagation(); if (!readOnly) tSpace(obj, sid, save); })}
            </div>
            {on && spOpen && (() => {
              // 轉置：頁面＝橫向欄位（上方），可見/可編輯/看金額＝往下的列
              const sep = "1px solid #EFE8D6";
              const gtc = `78px repeat(${rows.length}, minmax(46px, 1fr))`;
              const dims = [
                { label: "可見", color: "#3C8C3C", on: (pg) => viewChecked(obj, sid, pg), cap: () => true, go: (pg) => tView(obj, sid, pg, save) },
                ...(hideEdit ? [] : [{ label: "可編輯", color: "#b5512b", on: (pg) => editChecked(obj, sid, pg), cap: (c) => !!c.edit, go: (pg) => tEdit(obj, sid, pg, save) }]),
                ...(hasMoney ? [{ label: "看金額", color: "#2E7D32", on: (pg) => moneyChecked(obj, sid, pg), cap: (c) => !!c.money, go: (pg) => tMoney(obj, sid, pg, save) }] : []),
              ];
              return (
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 78 + rows.length * 46 }}>
                    {/* 表頭：頁面名稱橫向 */}
                    <div style={{ display: "grid", gridTemplateColumns: gtc, fontSize: 11.5, fontWeight: 600, color: "#7A6F58", background: "#fbf8f1", borderBottom: sep }}>
                      <div style={{ padding: "6px 8px" }} />
                      {rows.map(([pg, plabel]) => <div key={pg} style={{ padding: "6px 2px", textAlign: "center", borderLeft: sep, whiteSpace: "nowrap" }}>{plabel}</div>)}
                    </div>
                    {/* 三列：可見 / 可編輯 / 看金額 */}
                    {dims.map((d, di) => (
                      <div key={d.label} style={{ display: "grid", gridTemplateColumns: gtc, alignItems: "center", background: di % 2 ? "#FBF8F0" : "#fff", borderTop: "1px solid #F3EEE1" }}>
                        <div style={{ padding: "5px 8px", fontSize: 12.5, fontWeight: 600, color: d.color }}>{d.label}</div>
                        {rows.map(([pg, , caps]) => (
                          <div key={pg} style={{ display: "flex", alignItems: "center", justifyContent: "center", borderLeft: sep, padding: "5px 0" }}>
                            {d.cap(caps) ? cbox(d.on(pg), click(() => d.go(pg)), d.color) : <span style={{ color: "#DDD4BE" }}>—</span>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ maxWidth: 1100, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize:18, fontWeight: 600, color:"#211C15", marginBottom:6 }}>👤 帳號管理（僅管理員）</div>
      <div style={{ background:"#faf6ee", border:"1px solid #e4ddc9", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#6b6450", lineHeight:1.7 }}>
        最省事做法：先在下方<b style={{color:"#b45309"}}>「身份範本」</b>設好各種身份的權限（如工地監工、會計），再到每個帳號選一個<b>身份</b>即可——之後改身份權限，所有用此身份的人<b>自動跟著變</b>。也可選「自訂」單獨設某人。預設全部開放，取消勾就是不給；沒登入的人只能看。
      </div>

      {err && <div style={{ background:"#FEF2F2", border:"1px solid #FCA5A5", color:"#b3261e", borderRadius:8, padding:"8px 12px", marginBottom:12, fontSize:13 }}>{err}</div>}

      {/* 訪客（未登入）權限：誰點連結沒登入時能看到什麼 */}
      {commitGuestPerms && (() => {
        const open = openAcct.has("__guest__");
        const gMoney = ALL_MONEY_KEYS.filter(k => { const [s, g] = k.split(":"); return moneyChecked(guestPerms, s, g); }).length;
        return (
          <div style={{ background: "#FFF7F2", border: "1px solid #F0CFB8", borderRadius: 12, padding: "12px 16px", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>👁 訪客（未登入）</div>
              <span style={{ fontSize: 12, color: "#9b9384" }}>沒登入就點連結的人能看到什麼{gMoney ? `・看得到 ${gMoney} 頁金額` : "・看不到金額"}</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => toggleSet(setOpenAcct, "__guest__")} style={{ background: open ? "#b5512b" : "#fff", color: open ? "#fff" : "#b5512b", border: "1px solid #b5512b", borderRadius: 8, padding: "4px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{open ? "收合 ▴" : "設定 ▾"}</button>
            </div>
            {open && <>
              <div style={{ fontSize: 12, color: "#6F6656", marginTop: 8, lineHeight: 1.7 }}>訪客<b>一律唯讀</b>（不能改任何東西）。下面設定他「看得到哪些空間/頁面」「哪幾頁看得到金額」。<b style={{ color: "#C2410C" }}>金額預設全關</b>，要逐頁勾才看得到。不同階段可隨時調。</div>
              {renderMatrix(guestPerms, (changes) => { commitGuestPerms({ ...guestPerms, ...changes }); logThrottled("改訪客權限", "訪客"); }, "guest", false, true)}
            </>}
          </div>
        );
      })()}

      {/* 身份範本（連動）：設定一次，指派給帳號後權限跟著身份走 */}
      <div style={{ marginBottom:18 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:8 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#211C15" }}>🧩 身份範本（連動）</div>
          <span style={{ fontSize:12, color:"#9b9384" }}>設定一次，指派給帳號後權限自動跟著身份走</span>
          <div style={{ flex:1 }} />
          <button onClick={addRole} style={{ background:"#b5512b", color:"#fff", border:"none", borderRadius:8, padding:"6px 14px", fontSize:13, fontWeight:600, cursor:"pointer" }}>＋ 新增身份</button>
        </div>
        {roles.length === 0 ? <div style={{ fontSize:13, color:"#9b9384", padding:"6px 2px" }}>還沒有身份範本，點「＋ 新增身份」。</div> :
         roles.map(r => {
           const open = openAcct.has(r.id);
           const memberN = (list||[]).filter(p=>p.role_template===r.id).length;
           return (
             <div key={r.id} style={{ background:"#fff", border:"1px solid #d9cfbd", borderRadius:12, padding:"10px 14px", marginBottom:8 }}>
               <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                 <div style={{ fontSize:14, fontWeight:700, color:"#211C15" }}>{r.name}</div>
                 <span style={{ fontSize:11.5, color:"#9b9384" }}>{memberN} 人使用</span>
                 <button onClick={()=>renameRole(r)} style={{ background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:7, padding:"2px 9px", fontSize:11.5, color:"#6F6656", cursor:"pointer" }}>改名</button>
                 <div style={{ flex:1 }} />
                 <button onClick={()=>toggleSet(setOpenAcct, r.id)} style={{ background: open?"#b5512b":"#fff", color: open?"#fff":"#b5512b", border:"1px solid #b5512b", borderRadius:8, padding:"4px 12px", fontSize:12.5, fontWeight:600, cursor:"pointer" }}>{open?"收合 ▴":"編輯權限 ▾"}</button>
                 <button onClick={()=>delRole(r)} title="刪除身份" style={{ background:"none", border:"none", color:"#C8BCA0", cursor:"pointer", fontSize:18 }} onMouseEnter={e=>e.currentTarget.style.color="#b3261e"} onMouseLeave={e=>e.currentTarget.style.color="#C8BCA0"}>×</button>
               </div>
               {open && renderMatrix(r, (changes)=>{ updateRole(r.id, changes); logThrottled("改身份權限", r.name); }, "role-"+r.id, false)}
             </div>
           );
         })}
      </div>

      {/* 新增帳號 */}
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:18, flexWrap:"wrap", background:"#fff", border:"1px solid #d9cfbd", borderRadius:12, padding:14 }}>
        <input value={nName} onChange={e=>setNName(e.target.value)} placeholder="顯示名稱（例：阿明）" style={{ ...inputStyle, width:170 }} />
        <input value={nUser} onChange={e=>setNUser(e.target.value)} placeholder="登入帳號（例：aming）" autoCapitalize="off" autoCorrect="off" style={{ ...inputStyle, width:170 }} />
        <input value={nPw} onChange={e=>setNPw(e.target.value)} type="text" placeholder="密碼（至少6碼）" style={{ ...inputStyle, width:150 }} />
        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#4A4234", cursor:"pointer" }}>
          <input type="checkbox" checked={nAdmin} onChange={e=>setNAdmin(e.target.checked)} /> 設為管理員
        </label>
        <button onClick={addAcct} disabled={!nUser.trim()||!nPw||busy} style={{ background:(nUser.trim()&&nPw&&!busy)?"#b5512b":"#d9cfbd", color:(nUser.trim()&&nPw&&!busy)?"#fff":"#9b9384", border:"none", borderRadius:8, padding:"9px 18px", fontWeight: 600, cursor:(nUser.trim()&&nPw&&!busy)?"pointer":"not-allowed" }}>{busy?"建立中…":"＋ 新增帳號"}</button>
      </div>

      {/* 帳號清單（卡片） */}
      {list === null ? <div style={{ padding:30, textAlign:"center", color:"#9b9384" }}>載入中…</div>
       : list.length === 0 ? <div style={{ padding:30, textAlign:"center", color:"#9b9384", fontSize:13 }}>尚無帳號</div>
       : list.map(p => {
        const isAdm = p.role === "admin";
        const acctOpen = openAcct.has(p.id);
        const linkedRole = p.role_template ? roles.find(r => r.id === p.role_template) : null;
        const eff = linkedRole || p; // 連動帳號的實際權限來自身份
        const spacesIn = ACCT_SPACES.filter(([sid]) => spaceChecked(eff, sid)).length;
        const moneyPages = ALL_MONEY_KEYS.filter(k => { const [s, g] = k.split(":"); return moneyChecked(eff, s, g); }).length;
        return (
        <div key={p.id} style={{ background:"#fff", border:"1px solid #d9cfbd", borderRadius:12, padding:"12px 16px", marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:15, fontWeight:700, color:"#211C15" }}>{p.display_name}</div>
            <button onClick={()=>renamePerson(p)} title="改顯示名稱" style={{ background:"none", border:"none", color:"#C8BCA0", cursor:"pointer", fontSize:13, padding:0 }} onMouseEnter={e=>e.currentTarget.style.color="#b5512b"} onMouseLeave={e=>e.currentTarget.style.color="#C8BCA0"}>✎</button>
            <div style={{ fontSize:12, color:"#9b9384" }}>{(p.email||"").split("@")[0]}</div>
            <button onClick={()=>!isAdm||list.filter(x=>x.role==="admin").length>1 ? (patch(p.id, { role: isAdm?"staff":"admin" }), logAct("改層級", `${p.display_name}→${isAdm?"一般":"管理員"}`)) : alert("至少要保留一位管理員")} style={{ background:"#ece4d6", border:"1px solid #d9cfbd", borderRadius:8, padding:"3px 11px", fontSize:12.5, cursor:"pointer", color:isAdm?"#b5512b":"#4A4234", fontWeight:isAdm?700:400 }}>{isAdm?"管理員":"一般"} ⇄</button>
            {!isAdm && linkedRole && <span style={{ fontSize:12, fontWeight:700, color:"#2E7D32", background:"#EAF3EA", border:"1px solid #CFE3CF", borderRadius:999, padding:"2px 10px" }}>身份：{linkedRole.name}</span>}
            {!isAdm && <span style={{ fontSize:12, color:"#9b9384" }}>可進入 {spacesIn} 空間{moneyPages?`・看金額 ${moneyPages} 頁`:""}</span>}
            <div style={{ flex:1 }} />
            {!isAdm && <button onClick={()=>toggleSet(setOpenAcct, p.id)} style={{ background: acctOpen?"#b5512b":"#fff", color: acctOpen?"#fff":"#b5512b", border:"1px solid #b5512b", borderRadius:8, padding:"4px 12px", fontSize:12.5, fontWeight:600, cursor:"pointer" }}>{acctOpen?"收合權限 ▴":"設定權限 ▾"}</button>}
            <button onClick={()=>changeUsername(p)} style={{ background:"none", border:"1px solid #d9cfbd", borderRadius:8, padding:"3px 10px", fontSize:12, color:"#6F6656", cursor:"pointer" }}>改帳號</button>
            <button onClick={()=>resetPw(p)} style={{ background:"none", border:"1px solid #d9cfbd", borderRadius:8, padding:"3px 10px", fontSize:12, color:"#6F6656", cursor:"pointer" }}>重設密碼</button>
            {p.id !== myId && <button onClick={()=>delAcct(p)} title="刪除帳號" style={{ background:"none", border:"none", color:"#C8BCA0", cursor:"pointer", fontSize:18 }} onMouseEnter={e=>e.currentTarget.style.color="#b3261e"} onMouseLeave={e=>e.currentTarget.style.color="#C8BCA0"}>×</button>}
          </div>
          {isAdm ? <div style={{ fontSize:13, color:"#9b9384", marginTop:6 }}>管理員：全部空間／全部頁面／可編輯全部／可看金額</div> : (acctOpen &&
          <div style={{ marginTop:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:12.5, color:"#6F6656" }}>身份：</span>
              <select value={p.role_template||""} onChange={e=>{ patch(p.id, { role_template: e.target.value || null }); logAct("指派身份", `${p.display_name}→${roleName(e.target.value) || "自訂"}`); }} style={{ ...inputStyle, width:200, padding:"5px 8px" }}>
                <option value="">自訂（這個人單獨設）</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {linkedRole && <span style={{ fontSize:11.5, color:"#9b9384" }}>權限跟著身份走；要改請改上面的「{linkedRole.name}」身份範本。</span>}
            </div>
            {linkedRole
              ? renderMatrix(linkedRole, ()=>{}, "acctRO-"+p.id, true)
              : renderMatrix(p, (changes)=>{ patch(p.id, changes); logThrottled("改權限", p.display_name); }, "acct-"+p.id, false)}
          </div>)}
        </div>);
       })}
      <div style={{ fontSize:11.5, color:"#9b9384", marginTop:8, lineHeight:1.7 }}>
        提示：三欄（可見／可編輯／看金額）都預設打勾＝全開，取消勾就是不給；可一路取消到「全關」。要讓「身份」「看金額」存得住，Supabase 需先有 money_pages、role_template 兩個欄位（見上次給的 SQL）。
      </div>
    </div>
  );
}