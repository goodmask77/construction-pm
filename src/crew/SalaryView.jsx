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

// ── 設計過程（2026-09-17~18 老闆與 AI 的完整問答紀錄，公開給全員看制度怎麼誕生的）──
const STORY_QA = [
  ["天賦加成是什麼？", "20 歲的人就可以做到 30 歲的事，即天賦。設 20~40 區間，越年輕越高，40 歲歸零。", "年齡自動計算：20 歲最高、40 歲歸零，客觀不用人評"],
  ["資歷加成入職越久反而越低，是故意的？", "那是改的時候 key 錯。資歷就如其名——做越久分數越高，給中堅力量的鼓勵、支持、感謝。", "方向改正：入職月數越多越高，48 個月封頂"],
  ["貢獻加成跟天賦差在哪？", "貢獻指的是會多少工作站。內場 9＋外場 11 共 20 站，鼓勵大家跨站學習、不分內外、可輪調。", "會站數 ÷ 總站數，客觀有紀錄可依"],
  ["「第一加成」是什麼意思？", "投票設五大面向，某人在某面向第一就有加成，越多第一、加成越多。", "每拿一個面向第一 +0.1"],
  ["「全面加權」的定義？", "有點忘記當時的設定了，可以先刪除。", "刪除 ✂️"],
  ["「學習加權」怎麼認定？", "有跟我溝通——討論某本書、某個課程、某個觀念，去學習後回來討論，真的有改善進步。", "採 S~D 五級表（老闆提供），S 1.3 倍～D 0.8 倍懲罰性"],
  ["產能欄空著要接嗎？", "之後用 App 的備料/日常工作流程，每個人按完成會記錄名字，就能量化每人的產能。", "第二期接自動資料，欄位保留"],
  ["六項指標誰打分？", "不是誰打，是基於客觀事實：天賦＝真實年齡、資歷＝入職時間、貢獻＝會幾站大家都知道、第一＝投票排行榜。只有學習經過我的主觀認定＋對方的客觀行為。", "五項全自動、一項半主觀——最大程度去人治"],
  ["係數用乘的會失控，要改加法嗎？", "用乘的確實會有很大問題，所以 run 一下跑跑看怎麼乘會穩定。用＋的有點不公平——有些人會專攻某項而失去均衡發展。設定及引導、鼓勵及暗喻公司要的文化跟人才方向。", "保留連乘（偏科沒用、均衡才贏），但每項壓縮到 1.0~1.5——模擬驗證：原版最高分者拿走池子 72%，壓縮後降到 39%"],
  ["個人要不要設上限？", "有上限不會造成努力＆潛力也設了上限？我支持能者多得、贏者全拿。", "不設上限"],
  ["獎金池固定還是浮動？", "淨利率＝固定獎金 nono。淨利率是個指標、營收也是個指標，都是相對動態＆指數型變化。營收越高、淨利越高、大家獎金越高，不要限制。", "池＝淨利×（淨利率×放大係數）：雙重放大、指數成長、無上限"],
  ["投票怎麼投？", "每個人都可以投每個人，全員 360 度。每人 10 票、當然能投自己。主管或某些人會有加權（合夥人等級＆專業等級另設）。", "等級與票值可自訂增刪改"],
  ["保底會因人而異嗎？", "保底一樣。但每個人的基準本來就不同——年紀、資歷、工作站貢獻，這三塊是每個人的基礎體質；會隨之改變的是投票的第一＆學習。三固定二浮動。", "保底同額＋三固定二浮動架構定案"],
  ["用在哪？要匿名嗎？", "先用在 A Beach。會是真名對應，大家隨時都可查看自己與別人——形成內部良性競爭，也給面試者看到我們真正落實能者多得、薪資透明化。不需要另外做無真名的 demo，就是要看到真的東西，不是玩玩假裝畫大餅。", "真名公開、全員可查"],
  ["五大面向的「服務態度」內場投不了？", "對，可再提個建議，其他四個很均衡很棒。", "改為「品質細節」：內場＝餐點品質/出餐穩定/衛生、外場＝服務品質/桌況——內外場標準對等"],
];
const STORY_PROBLEMS = [
  ["連乘放大失控", "六個係數相乘，最高與最低乘數差 31 倍，一個人拿走獎金池 72%，8 人裡 6 人比純投票拿更少"],
  ["投票被架空", "重分配後實際結果幾乎由係數決定，票數只剩微調——投了跟沒投一樣"],
  ["二次計分", "票數已是同事評價，係數又乘在票數獎金上，人緣好被放大兩次"],
  ["係數界線不清", "天賦/貢獻/全面概念重疊，同一優點可能算三次；刻度不一致，誰的刻度大誰主宰結果"],
  ["資歷方向反了", "入職 2 個月係數 4.0、48 個月只有 1.44——越資深越低（後來確認是 key 錯）"],
];

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

  const TABS = [["table", "分配總表"], ["pnl", "損益儀表板"], ["sim", "前後對照"], ["guide", "說明"], ["story", "設計過程"], ...(mgr ? [["set", "設定"]] : [])];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SecHead tag="薪資透明" title="你的每一分成長，都看得見、也都算得進薪水裡" right={
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
          <div style={{ fontFamily: DISP, fontSize: 18, fontWeight: 800, color: ACCENT }}>你的每一分成長，都看得見、也都算得進薪水裡。</div>
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

      {/* ── 設計過程（制度怎麼誕生的：老闆的試算表→問答→修正→定案，全程公開）── */}
      {tab === "story" && (<>
        <Card>
          <div style={{ fontFamily: DISP, fontSize: 17, fontWeight: 800, color: TEXT }}>這套制度不是拍腦袋出來的。</div>
          <div style={{ fontSize: 13.5, color: TEXT, marginTop: 8, lineHeight: 1.8 }}>
            2026 年 9 月，老闆拿出一張自己做的薪資分配試算表，跟 AI 來回問答、跑數字模擬、逐條修正——這一頁把<b>完整過程</b>公開：原始版本哪裡有問題、每個規則為什麼這樣定、老闆親口的回答。看懂了，你就知道怎麼讓自己加薪。
          </div>
        </Card>
        <Card title="第一步｜原始試算表（8 人代號 G~H 試算）長什麼樣">
          <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>
            每人保底 35,000；獎金池 40,000 先按<b>得票數</b>分（80 票、1 票 500 元）；再用六個係數（天賦/資歷/貢獻/第一/全面/學習）<b>連乘</b>成乘數，乘回票數獎金重新分配。優點：總預算鎖死不超支、保底不動。但 AI 驗算後發現 5 個問題👇
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 10 }}>
            <thead><tr>{["問題", "說明"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{STORY_PROBLEMS.map((r, i) => <tr key={i}>
              <td style={{ ...cell, fontWeight: 700, whiteSpace: "nowrap" }}>{r[0]}</td>
              <td style={{ ...cell, whiteSpace: "normal", fontSize: 12.5 }}>{r[1]}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="第二步｜逐條問答：規則的每一條，都是老闆親口定的">
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["AI 問", "老闆答（原話摘要）", "定案"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{STORY_QA.map((r, i) => <tr key={i} style={{ background: i % 2 ? "#fff" : "#fdfaf4" }}>
              <td style={{ ...cell, whiteSpace: "normal", fontWeight: 700, fontSize: 12.5, minWidth: 90 }}>{r[0]}</td>
              <td style={{ ...cell, whiteSpace: "normal", fontSize: 12.5, lineHeight: 1.7 }}>「{r[1]}」</td>
              <td style={{ ...cell, whiteSpace: "normal", fontSize: 12.5, color: SEM.green, fontWeight: 700 }}>{r[2]}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="第三步｜跑數字驗證：連乘保留、但把係數壓進安全範圍">
          <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>
            用原表 8 人的真實票數/年齡/月資模擬：<b>原版</b>乘數差距 6~185（31 倍），最高分者拿走池子 <b style={{ color: SEM.red }}>72%</b>；<b>壓縮後</b>（每項 1.0~1.5）乘數收斂到 1.3~3.4，最高分者拿 <b style={{ color: SEM.green }}>39%</b>——能者依然多得、但不會把其他人吸乾。為什麼不改加法？老闆的原話在上表：加法會讓人「專攻某項而失去均衡發展」；乘法之下<b>任何一項擺爛都拖累全部</b>，這正是公司要的人才方向。
            <div style={{ borderLeft: `4px solid ${ACCENT}`, background: "#fdfaf4", padding: "6px 14px", marginTop: 10, color: SUB, fontSize: 13 }}>老闆在設計時說過一句話：「不要問我你能賺多少，問你自己想要賺多少。」——意思不是不談薪水，而是把決定權交還給你：規則全公開、路徑全公開，你心裡想到哪個數字，照著路徑走就到得了。</div>
          </div>
        </Card>
        <Card title="為什麼是 360 度評鑑，不是主管說了算？（老闆的五個理由）">
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["", "傳統制度", "我們的 360 制度"].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{[
              ["評鑑權", "上對下單向評分——勞資雙方對立、猜忌、不公平", "把評鑑的權利還給團隊的每一個人：你天天一起工作的夥伴，比任何主管更知道你做得好不好"],
              ["成本結構", "固定調薪一路疊加——調上去就下不來，變成公司的固定成本包袱", "動態彈性：公司賺，池子大家分；公司難，一起撐——薪資跟著實際表現與經營成果走"],
              ["衡量方式", "傳統 KPI 定義不明確、廣度不足——只量得到數字的，量不到態度、合作、學習", "五大面向投票＋客觀係數（年齡/月資/會站數自動算）——看得全，也講得清楚"],
              ["管理半徑", "老闆一個人，一間店就看不到全部，第二間店更不可能管得到", "每個人都是我們的眼睛：制度自動運轉，開十間店規則都一樣公平"],
              ["中間層風險", "一個有問題的主管就能堵死好員工的路——劣幣驅逐良幣", "多評分者稀釋單一偏見；主管也被大家評——沒有人能一手遮天"],
            ].map((r, i) => <tr key={i} style={{ background: i % 2 ? "#fff" : "#fdfaf4" }}>
              <td style={{ ...cell, fontWeight: 700, whiteSpace: "nowrap" }}>{r[0]}</td>
              <td style={{ ...cell, whiteSpace: "normal", fontSize: 12.5, color: SUB }}>{r[1]}</td>
              <td style={{ ...cell, whiteSpace: "normal", fontSize: 12.5, fontWeight: 600 }}>{r[2]}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="研究怎麼說（不是我們自己說爽的）">
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            <b>1. 薪資差異「講不清楚」才傷士氣——透明化是解藥。</b>經濟學頂刊 QJE 的田野實驗（Breza, Kaur & Shamdasani, 2018）：同單位薪資不同時，若員工<b>看不出差異的理由</b>，產出下降、出勤少 12%、合作意願變差；但當差異對應到<b>大家看得見的實際表現</b>時，負面效應完全消失。——這就是我們把所有數字、規則、係數全部公開的原因：差多少可以，但要讓每個人看得懂為什麼。<br />
            <b>2. 多來源回饋有效，前提是「跟發展掛鉤」。</b>組織心理學期刊 Personnel Psychology 的統合分析（Smither, London & Reilly, 2005，彙整 24 個長期研究）：360 回饋整體帶來正向績效改善，且不同來源的評分者對績效的判斷方向一致——多雙眼睛看到的是同一件事的不同面向；改善幅度最大的，是把回饋連到具體目標與行動的人。——所以我們的學習加權才要求「學了要用出來」。<br />
            <b>3. 多評分者稀釋個人偏見。</b>評鑑心理學的基本原理：單一評分者的月暈效應、寬鬆/嚴苛偏誤，會在多位評分者平均後大幅抵消；主管、同儕、部屬各自看到不同的工作行為，加總比任何單一視角更完整。<br />
            <b>4. 業界早就是主流。</b>多來源回饋在美國大型企業普及率極高，常被引用的估計是九成的 Fortune 500 採用某種形式的 360 評鑑（Edwards & Ewen, 1996）；Netflix、Bridgewater 等以「極度透明」聞名的公司，更是把公開回饋當作組織文化的核心。
          </div>
        </Card>
        <Card title="最後｜三句話記住這套制度">
          <div style={{ fontSize: 14, lineHeight: 2, fontWeight: 700 }}>
            1. <span style={{ color: ACCENT }}>天花板不在老闆手上，在你自己手上——想賺多少，自己決定。</span><br />
            2. 公司越賺、池子越大、無上限——把餅做大才是全贏。<br />
            3. 因為看見，所以相信——所有數字、所有規則、這整頁設計過程，全部公開。
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
