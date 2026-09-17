// ── 夥伴中心：薪資透明（A Beach 分潤試算，張良 2026-09-18 拍板）────────────────
// 核心理念：「不要問我你能賺多少，問你自己想要賺多少」——真名公開、全員可查、規則透明。
// 結構：保底固定 + 獎金池動態分配。
//   獎金池 = 淨利 ×（淨利率 × 放大係數）→ 營收↑淨利率↑雙重放大、指數成長、無上限。
//   個人分配 = 票數獎金 × 六係數連乘（壓縮各 1.0~1.5，用乘不用加＝鼓勵均衡發展不能偏科）。
//   三固定（天賦=年齡、資歷=入職月數、貢獻=會站數，客觀自動算）＋二浮動（第一=投票排行、學習=S~D等級）。
// 人員主檔讀名冊 kb_roster（生日/到職日/本薪），本頁只存模型參數與每人浮動欄（sp_crew_salary_model）。
import React, { useEffect, useMemo, useState } from "react";
import { K, auditLog } from "../lib/runtime.js";
import { loadRosterDoc } from "./roster.js";
import { ACCENT, ACCENT_SOFT, SURFACE, BORDER, LINE2, TEXT, SUB, MONO, DISP, SEM, SecHead, useIsMobile } from "../lib/theme.jsx";

const DOC_KEY = "salary_model";
const DEF_LEARN = [
  { g: "S", label: "積極學習者", x: 1.3, desc: "主動進修＆學以致用：每月 2 次以上學習活動、取得認可證書、可指導他人並實際應用成果" },
  { g: "A", label: "穩定學習者", x: 1.2, desc: "定期參加課程（每月至少 1 次）、有進修計畫、願意接受測驗驗證成果" },
  { g: "B", label: "一般學習者", x: 1.1, desc: "參與內部培訓但沒有主動進修習慣、技能提升有限" },
  { g: "C", label: "消極學習者", x: 1.0, desc: "只在被要求時參加學習活動、無法證明學習成效（無加權）" },
  { g: "D", label: "抗拒學習者", x: 0.8, desc: "拒絕培訓、認為學習無用、影響團隊學習氛圍（懲罰性加權——落到 D 會先安排面談）" },
];
const DEF_SETTINGS = {
  facets: ["專業技術", "品質細節", "團隊合作", "責任穩定", "改善創新"], // 五大面向（投票用，可增刪改）
  stationsIn: 9, stationsOut: 11,           // 工作站數（內場/外場）
  maxBoost: 1.5,                            // 天賦/資歷/貢獻 單項係數上限（連乘穩定的關鍵：壓在 1.0~1.5）
  talentFullAge: 20, talentZeroAge: 40,     // 天賦：20 歲滿分 → 40 歲歸零
  tenureCapM: 48,                           // 資歷：48 個月封頂
  firstStep: 0.1,                           // 第一：每拿一個面向第一名 +0.1
  learnGrades: DEF_LEARN,                   // 學習 S~D 等級表（可編輯）
  mode: "A",                                // A=全池連乘 / B=半票半乘
  votesPerPerson: 10, defaultBase: 35000,
  levels: [{ id: "lv_default", name: "正式", desc: "預設等級", w: 1 }], // 等級自訂（票值加權，投票功能上線後生效）
  pnl: { revenue: 1000000, labor: 350000, material: 300000, rent: 100000, utility: 30000, tax: 50000, other: 20000, amp: 2 },
  poolManual: 0,                            // >0 = 手動指定池子（覆寫損益公式），0 = 用公式
};
const COST_KEYS = [["labor", "人事成本"], ["material", "物料成本"], ["rent", "租金成本"], ["utility", "水電成本"], ["tax", "稅金成本"], ["other", "其他成本"]];

const fx = (n) => Math.round(Number(n) || 0).toLocaleString();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ageOf = (bday) => { if (!bday) return null; const d = new Date(bday); if (isNaN(d)) return null; const now = new Date(); let a = now.getFullYear() - d.getFullYear(); if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const monthsOf = (start) => { if (!start) return null; const d = new Date(start); if (isNaN(d)) return null; return Math.max(0, Math.floor((Date.now() - d.getTime()) / (30.44 * 864e5))); };

// ── 核心計算：一個人的六係數與乘數 ──────────────────────────────────────────
function factorsOf(person, ext, S) {
  const boost = (S.maxBoost || 1.5) - 1;
  const age = ageOf(person.bday);
  const months = monthsOf(person.startDate);
  const stTotal = (Number(S.stationsIn) || 0) + (Number(S.stationsOut) || 0) || 20;
  const talent = age == null ? 1 : 1 + boost * clamp((S.talentZeroAge - age) / (S.talentZeroAge - S.talentFullAge || 20), 0, 1);
  const tenure = months == null ? 1 : 1 + boost * clamp(months / (S.tenureCapM || 48), 0, 1);
  const contrib = 1 + boost * clamp((Number(ext.stations) || 0) / stTotal, 0, 1);
  const first = 1 + (S.firstStep || 0.1) * (Number(ext.firsts) || 0);
  const lg = (S.learnGrades || DEF_LEARN).find((g) => g.g === (ext.learn || "C"));
  const learn = lg ? Number(lg.x) || 1 : 1;
  const product = talent * tenure * contrib * first * learn;
  return { age, months, talent, tenure, contrib, first, learn, product };
}
// 損益 → 獎金池（張良：淨利率/營收都是動態指標，池子不設限）
function poolOf(pnl, poolManual) {
  if (Number(poolManual) > 0) return { pool: Number(poolManual), manual: true, net: 0, margin: 0, rate: 0, cost: 0 };
  const rev = Number(pnl.revenue) || 0;
  const cost = COST_KEYS.reduce((a, [k]) => a + (Number(pnl[k]) || 0), 0);
  const net = rev - cost;
  const margin = rev > 0 ? net / rev : 0;
  const rate = Math.max(0, margin * (Number(pnl.amp) || 0)); // 分潤率＝淨利率×放大係數（跟著淨利率長，不是固定值）
  return { pool: Math.max(0, Math.round(net * rate)), manual: false, net, margin, rate, cost };
}
// 全員分配（rows: [{p(名冊人), ext(浮動欄), f(係數)}]）
function distribute(rows, pool, mode) {
  const V = rows.reduce((a, r) => a + (Number(r.ext.votes) || 0), 0);
  const W = rows.reduce((a, r) => a + (Number(r.ext.votes) || 0) * r.f.product, 0);
  return rows.map((r) => {
    const v = Number(r.ext.votes) || 0;
    const byW = W > 0 ? (pool * v * r.f.product) / W : 0;
    const byV = V > 0 ? (pool * v) / V : 0;
    const bonus = mode === "B" ? byV / 2 + byW / 2 : byW;
    return { ...r, bonus: Math.round(bonus) };
  });
}

// ── 小元件 ──────────────────────────────────────────────────────────────────
const cell = { border: `1px solid ${BORDER}`, padding: "6px 8px", fontSize: 13, whiteSpace: "nowrap" };
const th = { ...cell, background: ACCENT_SOFT, fontWeight: 700, fontSize: 12, color: TEXT, position: "sticky", top: 0 };
const numTd = { ...cell, textAlign: "right", fontFamily: MONO };
const inputSt = { width: 64, padding: "4px 6px", border: `1px solid ${LINE2}`, borderRadius: 6, fontSize: 13, fontFamily: MONO, textAlign: "right", background: "#fff" };
// 數字輸入：blankZero 慣例（0 顯示空白）
function NumIn({ value, onChange, width = 64, disabled }) {
  return <input style={{ ...inputSt, width, opacity: disabled ? 0.5 : 1 }} disabled={disabled} inputMode="numeric" value={Number(value) ? String(value) : ""} placeholder="0"
    onChange={(e) => onChange(Number(String(e.target.value).replace(/[^\d.]/g, "")) || 0)} />;
}
function Card({ title, children, style }) {
  return <div style={{ background: SURFACE, border: `1.5px solid ${LINE2}`, borderRadius: 8, padding: 14, ...style }}>
    {title && <div style={{ fontSize: 12, fontWeight: 700, color: SUB, letterSpacing: 1, marginBottom: 6 }}>{title}</div>}
    {children}
  </div>;
}
function Kpi({ label, value, sub, color }) {
  return <Card style={{ flex: 1, minWidth: 130 }}>
    <div style={{ fontSize: 11.5, color: SUB, letterSpacing: 0.5 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: MONO, color: color || TEXT, marginTop: 2 }}>{value}</div>
    {sub && <div style={{ fontSize: 11.5, color: SUB, marginTop: 2 }}>{sub}</div>}
  </Card>;
}
const Btn = ({ on, children, onClick, danger }) => (
  <button onClick={onClick} style={{ padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 700, border: `1.5px solid ${on ? ACCENT : LINE2}`, background: on ? ACCENT : "#fff", color: danger ? SEM.red : on ? "#fff" : TEXT }}>{children}</button>
);

// ══════════════════════════════════════════════════════════════════════════
export default function SalaryView({ me: account, userName }) {
  const isMobile = useIsMobile();
  const mgr = account?.role === "admin" || account?.role === "manager";
  const [tab, setTab] = useState("table"); // table/pnl/sim/guide/set
  const [roster, setRoster] = useState(null);
  const [doc, setDoc] = useState(null);    // {settings, people}
  const [simRev, setSimRev] = useState(1); // 損益情境拉桿（不落地）
  const [simWho, setSimWho] = useState(""); // 模擬對照選的人
  const [simExt, setSimExt] = useState(null); // 模擬用覆寫值

  useEffect(() => { (async () => {
    const rd = await loadRosterDoc(); setRoster(rd);
    let d = null; try { const r = await window.storage.get(K(DOC_KEY), true); d = r?.value ? JSON.parse(r.value) : null; } catch (_) {}
    setDoc({ settings: { ...DEF_SETTINGS, ...(d?.settings || {}), pnl: { ...DEF_SETTINGS.pnl, ...(d?.settings?.pnl || {}) } }, people: d?.people || {} });
  })(); }, []);

  const S = doc?.settings || DEF_SETTINGS;
  const persist = (next) => { setDoc(next); try { auditLog("編輯", "夥伴中心・薪資透明"); } catch (_) {} try { window.storage.set(K(DOC_KEY), JSON.stringify(next), true); } catch (_) {} };
  const setS = (patch) => persist({ ...doc, settings: { ...S, ...patch } });
  const setExt = (pid, patch) => persist({ ...doc, people: { ...doc.people, [pid]: { ...(doc.people[pid] || {}), ...patch } } });

  // 在職人員（有離職日者不列入）
  const people = useMemo(() => (roster?.people || []).filter((p) => !p.endDate), [roster]);
  const rows = useMemo(() => {
    if (!doc) return [];
    return people.map((p) => { const ext = doc.people[p.id] || {}; return { p, ext, f: factorsOf(p, ext, S), base: Number(p.baseSalary) || S.defaultBase }; });
  }, [people, doc]);
  const { pool, manual, net, margin, rate, cost } = useMemo(() => poolOf(S.pnl, S.poolManual), [S]);
  const dist = useMemo(() => distribute(rows, pool, S.mode).sort((a, b) => (b.bonus + b.base) - (a.bonus + a.base)), [rows, pool, S.mode]);
  const totalVotes = rows.reduce((a, r) => a + (Number(r.ext.votes) || 0), 0);

  if (!doc || !roster) return <div style={{ padding: 24, color: SUB }}>載入中…</div>;

  const TABS = [["table", "分配總表"], ["pnl", "損益儀表板"], ["sim", "前後對照"], ["guide", "說明"], ...(mgr ? [["set", "設定"]] : [])];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SecHead tag="薪資透明" title="不要問我你能賺多少，問你自己想要賺多少" right={
        <span style={{ fontSize: 12, color: SUB }}>公司賺越多・大家分越多・無上限</span>} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => <Btn key={k} on={tab === k} onClick={() => setTab(k)}>{l}</Btn>)}
      </div>

      {/* ── 分配總表 ── */}
      {tab === "table" && (<>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Kpi label="本月獎金池" value={"NT$" + fx(pool)} sub={manual ? "（手動指定）" : `淨利 ${fx(net)} × 分潤率 ${(rate * 100).toFixed(1)}%`} color={ACCENT} />
          <Kpi label="保底薪資合計" value={"NT$" + fx(rows.reduce((a, r) => a + r.base, 0))} sub={`${rows.length} 位夥伴`} />
          <Kpi label="分配模式" value={S.mode === "B" ? "半票半乘" : "全池連乘"} sub={S.mode === "B" ? "一半看票、一半看係數" : "票數獎金×係數乘數"} />
          <Kpi label="總票數" value={fx(totalVotes)} sub={`每人 ${S.votesPerPerson} 票・五大面向`} />
        </div>
        <div style={{ overflowX: "auto", border: `1.5px solid ${LINE2}`, borderRadius: 8, background: SURFACE }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
            <thead><tr>
              {["姓名", "年齡→天賦", "月資→資歷", "會站→貢獻", "第一→加成", "學習→係數", "總乘數", "票數", "獎金", "保底", "總薪資"].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {dist.map((r, i) => {
                const dGrade = (r.ext.learn || "C") === "D";
                return (<tr key={r.p.id} style={{ background: i === 0 ? "#fdf6ee" : "#fff" }}>
                  <td style={{ ...cell, fontWeight: 700 }}>{i === 0 ? "👑 " : ""}{r.p.name}{dGrade && <span style={{ marginLeft: 6, fontSize: 11, color: "#fff", background: SEM.red, borderRadius: 4, padding: "1px 6px" }}>需面談</span>}</td>
                  <td style={numTd}>{r.f.age ?? "—"} → <b>{r.f.talent.toFixed(2)}</b></td>
                  <td style={numTd}>{r.f.months ?? "—"} → <b>{r.f.tenure.toFixed(2)}</b></td>
                  <td style={numTd}>{mgr ? <NumIn value={r.ext.stations || 0} width={44} onChange={(v) => setExt(r.p.id, { stations: v })} /> : (r.ext.stations || 0)} → <b>{r.f.contrib.toFixed(2)}</b></td>
                  <td style={numTd}>{mgr ? <NumIn value={r.ext.firsts || 0} width={36} onChange={(v) => setExt(r.p.id, { firsts: clamp(v, 0, (S.facets || []).length) })} /> : (r.ext.firsts || 0)} → <b>{r.f.first.toFixed(2)}</b></td>
                  <td style={{ ...numTd }}>
                    {mgr ? <select value={r.ext.learn || "C"} onChange={(e) => setExt(r.p.id, { learn: e.target.value })} style={{ ...inputSt, width: 52, textAlign: "left" }}>
                      {(S.learnGrades || DEF_LEARN).map((g) => <option key={g.g} value={g.g}>{g.g}</option>)}
                    </select> : (r.ext.learn || "C")} → <b>{r.f.learn.toFixed(2)}</b>
                  </td>
                  <td style={{ ...numTd, fontWeight: 800, color: ACCENT }}>{r.f.product.toFixed(2)}</td>
                  <td style={numTd}>{mgr ? <NumIn value={r.ext.votes || 0} width={44} onChange={(v) => setExt(r.p.id, { votes: v })} /> : (r.ext.votes || 0)}</td>
                  <td style={{ ...numTd, color: SEM.green, fontWeight: 700 }}>{fx(r.bonus)}</td>
                  <td style={numTd}>{fx(r.base)}</td>
                  <td style={{ ...numTd, fontWeight: 800 }}>{fx(r.base + r.bonus)}</td>
                </tr>);
              })}
              <tr style={{ background: ACCENT_SOFT, fontWeight: 800 }}>
                <td style={cell}>合計</td><td style={cell} colSpan={6} />
                <td style={numTd}>{fx(totalVotes)}</td>
                <td style={numTd}>{fx(dist.reduce((a, r) => a + r.bonus, 0))}</td>
                <td style={numTd}>{fx(dist.reduce((a, r) => a + r.base, 0))}</td>
                <td style={numTd}>{fx(dist.reduce((a, r) => a + r.base + r.bonus, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {!rows.length && <div style={{ color: SUB, fontSize: 13 }}>名冊還沒有在職人員——先到「名冊」建好夥伴（生日、到職日、本薪），這裡會自動帶入。</div>}
        <div style={{ fontSize: 12, color: SUB }}>天賦/資歷由名冊生日、到職日自動計算；會站數/第一/學習/票數由管理者維護（之後投票、產能上線改自動）。乘數＝五項連乘，任何一項偏科都會拖累全部——公司要的是均衡發展。</div>
      </>)}

      {/* ── 損益儀表板 ── */}
      {tab === "pnl" && (() => {
        const p2 = { ...S.pnl, revenue: (Number(S.pnl.revenue) || 0) * simRev, material: (Number(S.pnl.material) || 0) * simRev };
        const sim = poolOf(p2, 0);
        return (<>
          <Card title="本月實際數字（公開給全員；獎金池由此而生）">
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
              <label style={{ fontSize: 12.5, color: SUB }}>營收<br /><NumIn width={110} disabled={!mgr} value={S.pnl.revenue} onChange={(v) => setS({ pnl: { ...S.pnl, revenue: v } })} /></label>
              {COST_KEYS.map(([k, l]) => <label key={k} style={{ fontSize: 12.5, color: SUB }}>{l}<br /><NumIn width={110} disabled={!mgr} value={S.pnl[k]} onChange={(v) => setS({ pnl: { ...S.pnl, [k]: v } })} /></label>)}
              <label style={{ fontSize: 12.5, color: SUB }}>放大係數<br /><NumIn width={60} disabled={!mgr} value={S.pnl.amp} onChange={(v) => setS({ pnl: { ...S.pnl, amp: v } })} /></label>
            </div>
          </Card>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Kpi label="總成本" value={"NT$" + fx(cost)} />
            <Kpi label="淨利" value={"NT$" + fx(net)} color={net >= 0 ? SEM.green : SEM.red} />
            <Kpi label="淨利率" value={(margin * 100).toFixed(1) + "%"} />
            <Kpi label="分潤率＝淨利率×放大係數" value={(rate * 100).toFixed(1) + "%"} sub="淨利率越高、分的比例也越高" />
            <Kpi label="獎金池" value={"NT$" + fx(pool)} color={ACCENT} sub="淨利 × 分潤率・無上限" />
          </div>
          <Card title={`情境模擬：如果營收變成 ${(simRev * 100).toFixed(0)}%（物料成本等比隨動、其他成本固定）`}>
            <input type="range" min={0.6} max={1.6} step={0.05} value={simRev} onChange={(e) => setSimRev(Number(e.target.value))} style={{ width: "100%" }} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <Kpi label="模擬淨利" value={"NT$" + fx(sim.net)} color={sim.net >= 0 ? SEM.green : SEM.red} />
              <Kpi label="模擬淨利率" value={(sim.margin * 100).toFixed(1) + "%"} />
              <Kpi label="模擬獎金池" value={"NT$" + fx(sim.pool)} color={ACCENT} sub={pool > 0 ? `是現在的 ${(sim.pool / pool).toFixed(2)} 倍` : ""} />
            </div>
            <div style={{ fontSize: 12, color: SUB, marginTop: 8 }}>營收多 20%，池子不是多 20%——淨利與淨利率同時上升、雙重放大。這就是「公司越賺、大家越賺」的槓桿。</div>
          </Card>
          {mgr && <Card title="手動覆寫獎金池（填 0 = 照公式；試營運期可先手動）">
            <NumIn width={110} value={S.poolManual} onChange={(v) => setS({ poolManual: v })} />
          </Card>}
        </>);
      })()}

      {/* ── 前後對照（因為看見所以相信）── */}
      {tab === "sim" && (() => {
        const who = dist.find((r) => r.p.id === simWho) || dist[0];
        if (!who) return <div style={{ color: SUB }}>名冊還沒有人。</div>;
        const cur = who.ext || {};
        const ov = simExt && simExt.pid === who.p.id ? simExt : { pid: who.p.id, stations: cur.stations || 0, learn: cur.learn || "C", firsts: cur.firsts || 0, votes: cur.votes || 0 };
        const rows2 = rows.map((r) => r.p.id === who.p.id ? { ...r, ext: ov, f: factorsOf(r.p, ov, S) } : r);
        const dist2 = distribute(rows2, pool, S.mode);
        const b4 = who; const af = dist2.find((r) => r.p.id === who.p.id);
        const dl = af.bonus - b4.bonus;
        return (<>
          <Card title="選一位夥伴，動動看：如果他多學一站、學習升一級——薪水會變多少？">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: 12.5, color: SUB }}>夥伴<br />
                <select value={who.p.id} onChange={(e) => { setSimWho(e.target.value); setSimExt(null); }} style={{ ...inputSt, width: 120, textAlign: "left" }}>
                  {dist.map((r) => <option key={r.p.id} value={r.p.id}>{r.p.name}</option>)}
                </select></label>
              <label style={{ fontSize: 12.5, color: SUB }}>會站數（現在 {cur.stations || 0}）<br /><NumIn value={ov.stations} onChange={(v) => setSimExt({ ...ov, stations: v })} /></label>
              <label style={{ fontSize: 12.5, color: SUB }}>學習等級（現在 {cur.learn || "C"}）<br />
                <select value={ov.learn} onChange={(e) => setSimExt({ ...ov, learn: e.target.value })} style={{ ...inputSt, width: 60, textAlign: "left" }}>
                  {(S.learnGrades || DEF_LEARN).map((g) => <option key={g.g} value={g.g}>{g.g}</option>)}
                </select></label>
              <label style={{ fontSize: 12.5, color: SUB }}>面向第一數（現在 {cur.firsts || 0}）<br /><NumIn value={ov.firsts} onChange={(v) => setSimExt({ ...ov, firsts: clamp(v, 0, (S.facets || []).length) })} /></label>
              <label style={{ fontSize: 12.5, color: SUB }}>得票數（現在 {cur.votes || 0}）<br /><NumIn value={ov.votes} onChange={(v) => setSimExt({ ...ov, votes: v })} /></label>
            </div>
          </Card>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Kpi label="乘數" value={`${b4.f.product.toFixed(2)} → ${af.f.product.toFixed(2)}`} />
            <Kpi label="獎金" value={`${fx(b4.bonus)} → ${fx(af.bonus)}`} color={dl >= 0 ? SEM.green : SEM.red} sub={(dl >= 0 ? "+" : "") + fx(dl)} />
            <Kpi label="總薪資" value={`${fx(b4.base + b4.bonus)} → ${fx(af.base + af.bonus)}`} color={dl >= 0 ? SEM.green : SEM.red} />
          </div>
          <Card title="對其他人的影響（池子固定時是此消彼長；把餅做大才是全贏）">
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>{["姓名", "獎金(前)", "獎金(後)", "變化"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{dist2.map((r) => { const b = dist.find((x) => x.p.id === r.p.id); const d = r.bonus - b.bonus; return (
                <tr key={r.p.id} style={{ background: r.p.id === who.p.id ? "#fdf6ee" : "#fff" }}>
                  <td style={cell}>{r.p.name}</td><td style={numTd}>{fx(b.bonus)}</td><td style={numTd}>{fx(r.bonus)}</td>
                  <td style={{ ...numTd, color: d > 0 ? SEM.green : d < 0 ? SEM.red : SUB }}>{d > 0 ? "+" : ""}{fx(d)}</td>
                </tr>); })}</tbody>
            </table>
          </Card>
        </>);
      })()}

      {/* ── 說明（淺顯易懂：對自己的好處）── */}
      {tab === "guide" && (<>
        <Card>
          <div style={{ fontFamily: DISP, fontSize: 18, fontWeight: 800, color: ACCENT }}>不要問我你能賺多少，問你自己想要賺多少。</div>
          <div style={{ fontSize: 13.5, color: TEXT, marginTop: 8, lineHeight: 1.7 }}>
            這一頁真名公開、全員可查——規則透明、能者多得。你的薪水＝<b>保底</b>（不會少）＋<b>獎金</b>（看公司賺多少、看你做多少）。公司賺越多池子越大、沒有上限；你成長越多，分到的比例越高。
          </div>
        </Card>
        <Card title="你能做什麼讓自己加薪">
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["指標", "怎麼算", "你能做的事"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{[
              ["天賦", `年齡自動計算：${S.talentFullAge} 歲最高、${S.talentZeroAge} 歲歸零`, "年輕就是資產——趁現在衝"],
              ["資歷", `到職日自動計算：做滿 ${S.tenureCapM} 個月封頂`, "待得久也是資產——中堅力量公司記得你"],
              ["貢獻", `會幾個工作站（內場 ${S.stationsIn}＋外場 ${S.stationsOut}＝${(Number(S.stationsIn) || 0) + (Number(S.stationsOut) || 0)} 站）`, "多學一站、終身有效；內外場都學、可輪調的人最值錢"],
              ["第一", `五大面向投票（${(S.facets || []).join("、")}），每拿一個面向第一 +${S.firstStep}`, "把一件事做到全店第一，大家會投給你"],
              ["學習", "S~D 五級（見下表），跟老闆聊一本書、一堂課，用出來就升級", "學習升一級、下月生效——最快的加薪按鈕"],
              ["產能", "第二期上線：備料/工作流 App 按完成的量化紀錄", "（敬請期待）"],
            ].map((r, i) => <tr key={i}><td style={{ ...cell, fontWeight: 700 }}>{r[0]}</td><td style={cell}>{r[1]}</td><td style={{ ...cell, whiteSpace: "normal" }}>{r[2]}</td></tr>)}</tbody>
          </table>
          <div style={{ fontSize: 12.5, color: SUB, marginTop: 8 }}>五項係數是「相乘」不是相加——偏科沒有用，任何一項擺爛都會拖累全部。公司要的是均衡發展的人才。</div>
        </Card>
        <Card title="學習等級表（S 級 1.3 倍 → D 級 0.8 倍）">
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["等級", "係數", "具體行為"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{(S.learnGrades || DEF_LEARN).map((g) => <tr key={g.g}>
              <td style={{ ...cell, fontWeight: 700 }}>{g.g} 級（{g.label}）</td>
              <td style={{ ...numTd, color: g.x >= 1.2 ? SEM.green : g.x < 1 ? SEM.red : TEXT, fontWeight: 700 }}>{Number(g.x).toFixed(1)} 倍</td>
              <td style={{ ...cell, whiteSpace: "normal", fontSize: 12.5 }}>{g.desc}</td>
            </tr>)}</tbody>
          </table>
        </Card>
        <Card title="獎金池怎麼來（跟公司損益連動、無上限）">
          <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>
            <b>獎金池 ＝ 淨利 ×（淨利率 × {S.pnl.amp}）</b><br />
            營收越高 → 淨利越高；淨利率越高 → 分潤<b>比例</b>也越高——雙重放大。生意好的月份，池子是指數成長不是線性成長。損益數字公開在「損益儀表板」，大家一起看、一起衝。
          </div>
        </Card>
        <Card title="投票規則">
          <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>
            全員 360 度互投：每人 {S.votesPerPerson} 票、可投自己、投給五大面向（{(S.facets || []).join("、")}）表現最好的人。合夥人／專業等級的票有加權（等級與票值由管理頁設定）。每個面向的第一名獲得「第一加成」。
          </div>
        </Card>
      </>)}

      {/* ── 設定（管理者）── */}
      {tab === "set" && mgr && (<>
        <Card title="五大面向（投票維度，可增刪改）">
          {(S.facets || []).map((f, i) => <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input style={{ ...inputSt, width: 160, textAlign: "left" }} value={f} onChange={(e) => { const a = [...S.facets]; a[i] = e.target.value; setS({ facets: a }); }} />
            <Btn danger onClick={() => setS({ facets: S.facets.filter((_, j) => j !== i) })}>刪</Btn>
          </div>)}
          <Btn onClick={() => setS({ facets: [...(S.facets || []), "新面向"] })}>＋新增面向</Btn>
        </Card>
        <Card title="等級管理（票值加權；名稱/說明/票值自訂，投票功能上線後生效）">
          {(S.levels || []).map((lv, i) => <div key={lv.id} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <input style={{ ...inputSt, width: 110, textAlign: "left" }} value={lv.name} placeholder="等級名" onChange={(e) => { const a = [...S.levels]; a[i] = { ...lv, name: e.target.value }; setS({ levels: a }); }} />
            <input style={{ ...inputSt, width: 220, textAlign: "left" }} value={lv.desc || ""} placeholder="條件說明" onChange={(e) => { const a = [...S.levels]; a[i] = { ...lv, desc: e.target.value }; setS({ levels: a }); }} />
            <NumIn width={56} value={lv.w} onChange={(v) => { const a = [...S.levels]; a[i] = { ...lv, w: v }; setS({ levels: a }); }} />
            <span style={{ fontSize: 12, color: SUB, alignSelf: "center" }}>票值</span>
            <Btn danger onClick={() => setS({ levels: S.levels.filter((_, j) => j !== i) })}>刪</Btn>
          </div>)}
          <Btn onClick={() => setS({ levels: [...(S.levels || []), { id: "lv" + Date.now().toString(36), name: "", desc: "", w: 1 }] })}>＋新增等級</Btn>
        </Card>
        <Card title="係數參數（連乘穩定的關鍵：單項上限別超過 1.5 太多）">
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10, fontSize: 12.5, color: SUB }}>
            <label>單項係數上限<br /><NumIn value={S.maxBoost} onChange={(v) => setS({ maxBoost: v })} /></label>
            <label>天賦滿分年齡<br /><NumIn value={S.talentFullAge} onChange={(v) => setS({ talentFullAge: v })} /></label>
            <label>天賦歸零年齡<br /><NumIn value={S.talentZeroAge} onChange={(v) => setS({ talentZeroAge: v })} /></label>
            <label>資歷封頂月數<br /><NumIn value={S.tenureCapM} onChange={(v) => setS({ tenureCapM: v })} /></label>
            <label>每個第一加成<br /><NumIn value={S.firstStep} onChange={(v) => setS({ firstStep: v })} /></label>
            <label>內場站數<br /><NumIn value={S.stationsIn} onChange={(v) => setS({ stationsIn: v })} /></label>
            <label>外場站數<br /><NumIn value={S.stationsOut} onChange={(v) => setS({ stationsOut: v })} /></label>
            <label>每人票數<br /><NumIn value={S.votesPerPerson} onChange={(v) => setS({ votesPerPerson: v })} /></label>
            <label>預設保底薪資<br /><NumIn width={90} value={S.defaultBase} onChange={(v) => setS({ defaultBase: v })} /></label>
          </div>
        </Card>
        <Card title="學習等級係數（S~D）">
          {(S.learnGrades || DEF_LEARN).map((g, i) => <div key={g.g} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ width: 20, fontWeight: 800, alignSelf: "center" }}>{g.g}</span>
            <NumIn width={56} value={g.x} onChange={(v) => { const a = [...S.learnGrades]; a[i] = { ...g, x: v }; setS({ learnGrades: a }); }} />
            <input style={{ ...inputSt, flex: 1, minWidth: 200, textAlign: "left" }} value={g.desc} onChange={(e) => { const a = [...S.learnGrades]; a[i] = { ...g, desc: e.target.value }; setS({ learnGrades: a }); }} />
          </div>)}
        </Card>
        <Card title="分配模式">
          <div style={{ display: "flex", gap: 8 }}>
            <Btn on={S.mode === "A"} onClick={() => setS({ mode: "A" })}>A・全池連乘（均衡發展導向）</Btn>
            <Btn on={S.mode === "B"} onClick={() => setS({ mode: "B" })}>B・半票半乘（票數保底導向）</Btn>
          </div>
        </Card>
      </>)}
    </div>
  );
}
