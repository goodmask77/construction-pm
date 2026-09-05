// 食譜卡公版（張良 2026-09-06：照他 Google 配方表的完整格式做成 App 公版，每張食譜共用）
// 版面＝他的表：保存方式/位置/期限(冷凍/冷藏)＋站上/預留庫存 → 內容物表(數量/單位/%/成本) → SOP → 尾列(耗損率/每包重量/配方產量/每包成本/每克成本/備註)
// 藍圖鐵律不變：版本存流水 pm_recipe_v_（append-only）；成本＝最近實付價（inv.recipeCost 同一套，含半成品遞迴/耗損率/包材）；缺價照實紅字不靜默
import React, { useEffect, useRef, useState } from "react";
import { C, MONOF, rid } from "./Supply.jsx";
import { getSharedPrefix } from "../supa.js";
import { subscribeRecords } from "../lib/records.js";
import { recipeCost, latestRecipeOf, latestCostOfIngredient } from "./inv.js";

// 舊資料相容：keepNote「冷凍、冷藏；冷凍D+30；冷藏D+7」拆回欄位（新版存欄位，舊版字串照樣讀得回來）
const splitKeep = (r) => {
  const out = { keepType: r.keepType || "", keepPlace: r.keepPlace || "", expFrozen: r.expFrozen || "", expChilled: r.expChilled || "" };
  if (!out.keepType && r.keepNote) {
    String(r.keepNote).split(/[；;]/).map(s => s.trim()).filter(Boolean).forEach((seg, i) => {
      if (/^冷凍/.test(seg) && seg.length > 2) out.expFrozen = out.expFrozen || seg.slice(2);
      else if (/^冷藏/.test(seg) && seg.length > 2) out.expChilled = out.expChilled || seg.slice(2);
      else if (i === 0) out.keepType = seg;
    });
  }
  return out;
};

export default function RecipeCard({ product, db, save, canEdit, showMoney, userName, K }) {
  const [recs, setRecs] = useState(null);     // 全部食譜版本（跨產品，量小全載）
  const [draft, setDraft] = useState(null);   // 編輯中的草稿（未存＝不進流水）
  const [showHist, setShowHist] = useState(false);
  const loadedFor = useRef(null);
  const semi = !!product.semi;
  const inp = { border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 7px", fontSize: 12.5, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };

  useEffect(() => { (async () => {
    try {
      const rows = await getSharedPrefix(K("pm_recipe_v_"));
      const list = Object.values(rows).map(v => { try { return JSON.parse(v); } catch (_) { return null; } }).filter(Boolean);
      setRecs(list);
    } catch (_) { setRecs([]); }
  })(); }, []); // eslint-disable-line
  useEffect(() => subscribeRecords(K("pm_recipe_v_"), (id, rec) => {
    if (!rec) return;
    setRecs(prev => prev ? [...prev.filter(r => r.id !== rec.id), rec] : prev);
  }), []); // eslint-disable-line

  const latest = recs ? latestRecipeOf(recs, product.id) : null;
  // 草稿形狀（init 與 dirty 比對共用同一個函式，才不會判斷不一致）
  const mkDraft = (r) => {
    const k = r ? splitKeep(r) : { keepType: "", keepPlace: "", expFrozen: "", expChilled: "" };
    return {
      ingredients: r ? (r.ingredients || []).map(x => ({ ...x })) : [],
      subRecipes: r ? (r.subRecipes || []).map(x => ({ ...x })) : [],
      steps: r ? (r.steps || []).join("\n") : "",
      lossPct: r && r.lossPct ? String(r.lossPct) : "",
      packW: r ? String(r.packW ?? (semi ? (r.yield || 1) : 1)) : (semi ? "" : "1"),
      packN: r ? String(r.packN ?? (semi ? 1 : (r.yield || 1))) : "1",
      yieldUnit: r ? (r.yieldUnit || (semi ? "g" : "份")) : (semi ? "g" : "份"),
      stationStock: r ? (r.stationStock || "") : "", reserveStock: r ? (r.reserveStock || "") : "",
      ...k, note: r ? (r.note || "") : "",
    };
  };
  useEffect(() => {
    if (recs === null || loadedFor.current === product.id) return;
    loadedFor.current = product.id;
    setDraft(mkDraft(latest));
  }, [recs, product.id]); // eslint-disable-line

  if (recs === null || !draft) return <div style={{ marginTop: 14, fontSize: 12, color: C.faint }}>🍳 食譜載入中…</div>;

  const ings = (db.ingredients || []).filter(g => !g.nonStock).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)); // 非物料（服務/費用）不進食譜
  const semis = (db.products || []).filter(p => p.semi && p.id !== product.id);
  const ingOf = (id) => (db.ingredients || []).find(g => g.id === id);
  const upd = (fp) => setDraft(d => ({ ...d, ...fp }));
  const updLine = (i, fp) => upd({ ingredients: draft.ingredients.map((x, j) => j === i ? { ...x, ...fp } : x) });
  const updSub = (i, fp) => upd({ subRecipes: draft.subRecipes.map((x, j) => j === i ? { ...x, ...fp } : x) });
  const dirty = JSON.stringify(draft) !== JSON.stringify(mkDraft(latest));

  // 出成：半成品＝每包量×包數；成品＝份數
  const packW = Number(draft.packW) > 0 ? Number(draft.packW) : 0;
  const packN = Number(draft.packN) > 0 ? Number(draft.packN) : 1;
  const yieldN = semi ? (packW > 0 ? packW * packN : 1) : packN;
  const yu = (draft.yieldUnit || "").trim() || (semi ? "g" : "份");

  const saveVersion = () => {
    const rec = {
      id: rid("rv"), product_id: product.id, ts: new Date().toISOString(), by: userName || "—",
      ingredients: draft.ingredients.filter(x => x.ingredient_id && Number(x.qty) > 0),
      subRecipes: (draft.subRecipes || []).filter(x => x.product_id && Number(x.qty) > 0),
      steps: String(draft.steps || "").split("\n").map(s => s.trim()).filter(Boolean),
      yield: yieldN, yieldUnit: yu, packW: packW || undefined, packN,
      lossPct: Number(draft.lossPct) > 0 ? Number(draft.lossPct) : 0,
      stationStock: (draft.stationStock || "").trim(), reserveStock: (draft.reserveStock || "").trim(),
      keepType: (draft.keepType || "").trim(), keepPlace: (draft.keepPlace || "").trim(),
      expFrozen: (draft.expFrozen || "").trim(), expChilled: (draft.expChilled || "").trim(),
      note: draft.note || "",
    };
    window.storage.set(K("pm_recipe_v_" + rec.id), JSON.stringify(rec), true).catch(() => {});
    setRecs(prev => [...(prev || []), rec]);
  };

  // 成本試算：草稿即時算（存檔前就看得到）；算法＝inv.recipeCost 同一套（含半成品遞迴/耗損率/包材）
  const draftAsRecipe = { id: "_draft", product_id: product.id, ts: "9999", ingredients: draft.ingredients.filter(x => x.ingredient_id && Number(x.qty) > 0), subRecipes: (draft.subRecipes || []).filter(x => x.product_id && Number(x.qty) > 0), yield: yieldN, lossPct: Number(draft.lossPct) > 0 ? Number(draft.lossPct) : 0 };
  const recsForCalc = [...(recs || []).filter(r => r.product_id !== product.id), draftAsRecipe];
  const cost = recipeCost(db, recsForCalc, product.id);
  const sell = Number(product.price) || 0;
  const margin = sell > 0 && cost.total > 0 ? (sell - cost.total) / sell * 100 : null;
  const d2 = (n) => n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 100) / 100).toString();
  const d4 = (n) => n < 1 ? (Math.round(n * 10000) / 10000).toString() : d2(n);
  const hist = (recs || []).filter(r => r.product_id === product.id).sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

  // 逐列成本＋佔比（公版表的 %/成本欄；與總成本同一套價：最近實付）
  const lineCost = (li) => {
    const g = ingOf(li.ingredient_id); const qty = Number(li.qty) || 0;
    if (!g || !qty) return null;
    if (g.costFree) return 0;
    const c = latestCostOfIngredient(db, li.ingredient_id);
    return c ? c.unitCost * qty : null;
  };
  const subCost = (sr) => {
    const qty = Number(sr.qty) || 0; if (!sr.product_id || !qty) return null;
    const t = recipeCost(db, recsForCalc, sr.product_id).total;
    return t > 0 ? t * qty : null;
  };
  const totalQty = [...draft.ingredients, ...(draft.subRecipes || [])].reduce((t, x) => t + (Number(x.qty) || 0), 0);
  const pct = (q) => totalQty > 0 && Number(q) > 0 ? (Number(q) / totalQty * 100).toFixed(1) + "%" : "";

  // 公版表格樣式（ground-pack 硬格線風，同菜單管理）
  const GTC = `minmax(150px,1fr) 74px 46px 56px ${showMoney ? "84px " : ""}26px`;
  const cell = { borderRight: "1px solid #e0d6bf", alignSelf: "stretch", display: "flex", alignItems: "center", padding: "3px 7px" };
  const headCell = { ...cell, background: "#ece4d6", fontSize: 10.5, letterSpacing: .6, color: C.sub, fontWeight: 700, padding: "6px 7px" };
  const metaLab = { fontSize: 10, color: C.faint, fontWeight: 700, letterSpacing: .5, whiteSpace: "nowrap" };
  const cInp = { ...inp, width: "100%", border: "none", background: "transparent", padding: "3px 0", fontFamily: MONOF, textAlign: "right" };

  return (
    <div style={{ marginTop: 14 }}>
      {/* 卡片標頭（公版）：深色標題列＝他表格的藍色標題列 */}
      <div style={{ border: `1.5px solid ${C.hard}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        <div style={{ background: "#1d1a15", color: "#fff", padding: "9px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>🍳 {product.name || "（未命名）"}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#1d1a15", background: semi ? "#9ec5e8" : "#b9d9a8", borderRadius: 3, padding: "1px 6px" }}>{semi ? "半成品（兩店共用）" : (product.store === "GD" ? "GROUN:D 成品" : "A Beach 成品")}</span>
          <div style={{ flex: 1 }} />
          {latest ? <span style={{ fontSize: 10, color: "#d9cfbd" }}>版本 {hist.length}・{new Date(latest.ts).toLocaleDateString("zh-TW")}・{latest.by}</span> : <span style={{ fontSize: 10, color: "#f0c36a", fontWeight: 700 }}>尚無食譜</span>}
        </div>
        {/* 保存／庫存 meta 列（公版上排） */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: `1px solid ${C.line}`, background: C.soft }}>
          {[["stationStock", "站上"], ["reserveStock", "預留庫存"], ["keepType", "保存方式"], ["keepPlace", "保存位置"], ["expFrozen", "冷凍期限"], ["expChilled", "冷藏期限"]].map(([k, l], i) => (
            <label key={k} style={{ padding: "5px 8px", borderRight: i < 5 ? "1px solid #e0d6bf" : "none", minWidth: 0 }}>
              <div style={metaLab}>{l}</div>
              <input value={draft[k] ?? ""} onChange={e => upd({ [k]: e.target.value })} disabled={!canEdit} placeholder={k === "expFrozen" ? "D+30" : k === "expChilled" ? "D+7" : "—"} style={{ ...inp, border: "none", background: "transparent", padding: "1px 0", width: "100%", fontSize: 12 }} />
            </label>
          ))}
        </div>
        {/* 內容物表（公版主表：內容物/數量/單位/%/成本） */}
        <div style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "stretch" }}>
          {["內容物", "數量", "單位", "％", ...(showMoney ? ["成本"] : []), ""].map((h, i) => <div key={i} style={{ ...headCell, justifyContent: h === "數量" || h === "成本" ? "flex-end" : h === "單位" || h === "％" ? "center" : "flex-start" }}>{h}</div>)}
        </div>
        {draft.ingredients.map((li, i) => {
          const g = ingOf(li.ingredient_id);
          const lc = lineCost(li);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "stretch", borderTop: "1px solid #f0ead9", background: "#fff" }}>
              <div style={{ ...cell, padding: "2px 4px" }}>
                {/* 菜單=物料源頭（2026-07-22 張良第一性原理）：缺什麼物料當場「＋新建物料卡」不用跳頁 */}
                <select value={li.ingredient_id || ""} onChange={e => {
                  const v = e.target.value;
                  if (v === "__new") {
                    const nm = window.prompt("新物料卡名稱（例：漢堡紙）："); if (!nm || !nm.trim() || !save) return;
                    const ng = { id: rid("g"), name: nm.trim(), cat: "", baseUnit: "g", countFreq: { type: "none", days: [], dom: 1, paused: false }, countRole: "", countUnit: "", isKey: false, safeStock: "", note: "", sort: (db.ingredients || []).length, tags: "" };
                    save({ ingredients: [...(db.ingredients || []), ng] });
                    updLine(i, { ingredient_id: ng.id });
                    return;
                  }
                  updLine(i, { ingredient_id: v });
                }} disabled={!canEdit} style={{ ...inp, border: "none", background: "transparent", width: "100%", fontSize: 12.5, padding: "3px 2px" }}>
                  <option value="">選物料…</option>
                  {ings.map(x => <option key={x.id} value={x.id}>{x.name || "（未命名）"}</option>)}
                  {canEdit && save && <option value="__new">＋ 新建物料卡…</option>}
                </select>
              </div>
              <div style={cell}><input value={li.qty ?? ""} onChange={e => updLine(i, { qty: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="0" style={cInp} /></div>
              <div style={{ ...cell, justifyContent: "center", fontSize: 11.5, color: C.sub }}>{g ? g.baseUnit : ""}</div>
              <div style={{ ...cell, justifyContent: "center", fontFamily: MONOF, fontSize: 11, color: C.faint }}>{pct(li.qty)}</div>
              {showMoney && <div style={{ ...cell, justifyContent: "flex-end", fontFamily: MONOF, fontSize: 11.5, color: lc == null ? C.red : g && g.costFree ? C.faint : C.text }}>{lc == null ? (g && Number(li.qty) > 0 ? "缺價" : "—") : lc === 0 ? "$0" : "$" + d4(lc)}</div>}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{canEdit && <button onClick={() => upd({ ingredients: draft.ingredients.filter((_, j) => j !== i) })} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer", fontSize: 13 }}>×</button>}</div>
            </div>
          );
        })}
        {/* 半成品引用列（藍籤；用量單位＝該半成品的出成單位；成本自動遞迴含它的耗損率） */}
        {(draft.subRecipes || []).map((sr, i) => {
          const subR = latestRecipeOf(recs || [], sr.product_id);
          const su = (subR && subR.yieldUnit) || "份";
          const sc = subCost(sr);
          return (
            <div key={"sr" + i} style={{ display: "grid", gridTemplateColumns: GTC, alignItems: "stretch", borderTop: "1px solid #f0ead9", background: "#f4f8fc" }}>
              <div style={{ ...cell, padding: "2px 4px", gap: 5 }}>
                <span style={{ fontSize: 9.5, color: "#fff", background: C.blue, borderRadius: 3, padding: "1px 4px", fontWeight: 700, flexShrink: 0 }}>半成品</span>
                <select value={sr.product_id || ""} onChange={e => updSub(i, { product_id: e.target.value })} disabled={!canEdit} style={{ ...inp, border: "none", background: "transparent", flex: 1, fontSize: 12.5, padding: "3px 0", minWidth: 0 }}>
                  <option value="">選半成品…</option>
                  {semis.map(p => <option key={p.id} value={p.id}>{p.name || "（未命名）"}</option>)}
                </select>
              </div>
              <div style={cell}><input value={sr.qty ?? ""} onChange={e => updSub(i, { qty: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="0" style={cInp} /></div>
              <div style={{ ...cell, justifyContent: "center", fontSize: 11.5, color: C.sub }}>{su}</div>
              <div style={{ ...cell, justifyContent: "center", fontFamily: MONOF, fontSize: 11, color: C.faint }}>{pct(sr.qty)}</div>
              {showMoney && <div style={{ ...cell, justifyContent: "flex-end", fontFamily: MONOF, fontSize: 11.5, color: sc == null ? C.red : C.text }}>{sc == null ? (sr.product_id && Number(sr.qty) > 0 ? "缺價" : "—") : "$" + d4(sc)}</div>}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{canEdit && <button onClick={() => upd({ subRecipes: draft.subRecipes.filter((_, j) => j !== i) })} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer", fontSize: 13 }}>×</button>}</div>
            </div>
          );
        })}
        {canEdit && (
          <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderTop: "1px solid #f0ead9" }}>
            <button onClick={() => upd({ ingredients: [...draft.ingredients, { ingredient_id: "", qty: "" }] })} style={{ border: `1px dashed ${C.line}`, background: "#fff", color: C.sub, borderRadius: 6, padding: "3px 11px", fontSize: 11.5, cursor: "pointer" }}>＋ 加用料</button>
            {semis.length > 0 && <button onClick={() => upd({ subRecipes: [...(draft.subRecipes || []), { product_id: "", qty: "" }] })} style={{ border: `1px dashed ${C.blue}`, background: "#fff", color: C.blue, borderRadius: 6, padding: "3px 11px", fontSize: 11.5, cursor: "pointer" }}>＋ 加半成品</button>}
          </div>
        )}
        {ings.length === 0 && <div style={{ fontSize: 11.5, color: C.amber, padding: "6px 10px" }}>⚠ 還沒有物料——先到「🥬 物料」頁建物料卡，這裡才有得選。</div>}
        {/* SOP 步驟（一行一步；現場照著做） */}
        <div style={{ borderTop: `1px solid ${C.line}`, padding: "7px 10px", background: C.card }}>
          <div style={{ ...metaLab, marginBottom: 3 }}>步驟（包含使用器具，一行一步）</div>
          <textarea value={draft.steps} onChange={e => upd({ steps: e.target.value })} disabled={!canEdit} rows={Math.min(10, Math.max(3, String(draft.steps || "").split("\n").length))} placeholder={"例：\n1. 醬料 30ml 打底\n2. …"} style={{ ...inp, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
        </div>
        {/* 尾列（公版底部）：耗損率／出成／每包成本／每單位成本／備註 */}
        <div style={{ borderTop: `1.5px solid ${C.hard}`, background: C.soft, padding: "7px 10px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label><div style={metaLab} title="修清/蒸發等損耗：實得產量打折，每單位成本自動變貴">耗損率％</div>
            <input value={draft.lossPct ?? ""} onChange={e => upd({ lossPct: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="0" style={{ ...inp, width: 52, marginTop: 2, fontFamily: MONOF, textAlign: "center" }} />
          </label>
          {semi ? (
            <>
              <label><div style={metaLab}>每包重量＋單位</div>
                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                  <input value={draft.packW ?? ""} onChange={e => upd({ packW: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="700" style={{ ...inp, width: 64, fontFamily: MONOF, textAlign: "center" }} />
                  <input value={draft.yieldUnit ?? ""} onChange={e => upd({ yieldUnit: e.target.value })} disabled={!canEdit} placeholder="g" style={{ ...inp, width: 40, textAlign: "center" }} />
                </div>
              </label>
              <label><div style={metaLab}>配方產量（包）</div>
                <input value={draft.packN ?? ""} onChange={e => upd({ packN: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="1" style={{ ...inp, width: 52, marginTop: 2, fontFamily: MONOF, textAlign: "center" }} />
              </label>
              {packW > 0 && <span style={{ fontSize: 11, color: C.faint, paddingBottom: 5 }}>＝總出成 {d2(packW * packN)}{yu}</span>}
            </>
          ) : (
            <label><div style={metaLab}>此配方出成（份）</div>
              <input value={draft.packN ?? ""} onChange={e => upd({ packN: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="1" style={{ ...inp, width: 52, marginTop: 2, fontFamily: MONOF, textAlign: "center" }} />
            </label>
          )}
          <div style={{ flex: 1 }} />
          {showMoney && (semi ? (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              {packW > 0 && cost.total > 0 && <span style={{ fontSize: 12 }}>每包成本 <b style={{ fontFamily: MONOF, color: C.accent }}>NT${d2(cost.total * packW)}</b></span>}
              <span style={{ fontSize: 12 }}>每{yu}成本 <b style={{ fontFamily: MONOF, color: C.accent }}>{cost.total > 0 ? "NT$" + d4(cost.total) : "—"}</b></span>
              {cost.total > 0 && <span style={{ fontSize: 12 }}>整批成本 <b style={{ fontFamily: MONOF }}>NT${d2(cost.total * yieldN * (1 - Math.min(Math.max(Number(draft.lossPct) || 0, 0), 90) / 100))}</b></span>}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12 }}>一份成本 <b style={{ fontFamily: MONOF, color: C.accent }}>{cost.total > 0 ? "NT$" + d2(cost.total) : "—"}</b></span>
              <span style={{ fontSize: 12 }}>售價 <b style={{ fontFamily: MONOF }}>{sell ? "NT$" + d2(sell) : "—"}</b></span>
              <span style={{ fontSize: 12 }}>毛利 <b style={{ fontFamily: MONOF, color: margin == null ? C.faint : margin < 50 ? C.red : C.green }}>{margin == null ? "—" : `NT$${d2(sell - cost.total)}（${Math.round(margin)}%）`}</b></span>
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${C.line}`, padding: "5px 10px", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={metaLab}>備註</span>
          <input value={draft.note ?? ""} onChange={e => upd({ note: e.target.value })} disabled={!canEdit} placeholder="例：24oz醬料瓶700ml" style={{ ...inp, border: "none", background: "transparent", flex: 1, fontSize: 12 }} />
        </div>
        {showMoney && cost.missing.length > 0 && <div style={{ fontSize: 11, color: C.red, padding: "5px 10px", borderTop: `1px solid ${C.line}`, background: "#fdf0ef" }}>⚠ 成本不完整：{cost.missing.join("；")}（補齊物料價格/換算就會準，不會偷偷當 0 算）</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        {canEdit && <button disabled={!dirty} onClick={saveVersion} style={{ border: "none", background: dirty ? C.green : "#d5cbb6", color: "#fff", borderRadius: 7, padding: "7px 16px", fontSize: 12.5, fontWeight: 700, cursor: dirty ? "pointer" : "default" }}>💾 儲存食譜（存為新版本，舊版保留）</button>}
        <div style={{ flex: 1 }} />
        {hist.length > 0 && <button onClick={() => setShowHist(h => !h)} style={{ border: "none", background: "none", color: C.sub, fontSize: 11, cursor: "pointer" }}>{showHist ? "▾" : "▸"} 歷史版本（{hist.length}）</button>}
      </div>
      {/* 歷史版本（唯讀）：報表要算過去成本時取 ts≤當日的版本 */}
      {showHist && hist.map(r => (
        <div key={r.id} style={{ fontSize: 11, color: C.sub, borderTop: `1px solid #f0ead9`, padding: "4px 0", marginTop: 4 }}>
          <span style={{ fontFamily: MONOF, color: C.faint }}>{new Date(r.ts).toLocaleString("zh-TW", { hour12: false })}</span>・{r.by}・
          {(r.ingredients || []).map(li => { const g = ingOf(li.ingredient_id); return `${g ? g.name : "?"}×${li.qty}${g ? g.baseUnit : ""}`; }).join("、") || "（空）"}
          {(r.subRecipes || []).length ? `＋半成品${r.subRecipes.length}` : ""}
          {Number(r.yield) > 1 ? `／出成${r.yield}${r.yieldUnit || "份"}` : ""}
        </div>
      ))}
    </div>
  );
}
