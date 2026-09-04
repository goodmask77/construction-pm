// 食譜成本卡（掛在產品詳情 modal 內）：用料＋SOP＋成本毛利
// 藍圖鐵律：食譜版本存流水 pm_recipe_v_<id>（append-only，每存＝新版本，現值＝最新一筆，歷史報表天然不變）
// 成本＝用料×最近實付單位成本＋包材；用量單位鎖＝物料 baseUnit；缺換算/缺價照實列警告不靜默
import React, { useEffect, useRef, useState } from "react";
import { C, MONOF, rid } from "./Supply.jsx";
import { getSharedPrefix } from "../supa.js";
import { subscribeRecords } from "../lib/records.js";
import { recipeCost, latestRecipeOf } from "./inv.js";

export default function RecipeCard({ product, db, save, canEdit, showMoney, userName, K }) {
  const [recs, setRecs] = useState(null);     // 全部食譜版本（跨產品，量小全載）
  const [draft, setDraft] = useState(null);   // 編輯中的草稿（未存＝不進流水）
  const [showHist, setShowHist] = useState(false);
  const loadedFor = useRef(null);
  const inp = { border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, background: "#fff", color: C.text, outline: "none", boxSizing: "border-box" };

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
  // 草稿初始化：帶最新版本（換產品時重帶）
  useEffect(() => {
    if (recs === null || loadedFor.current === product.id) return;
    loadedFor.current = product.id;
    setDraft(latest ? { ingredients: (latest.ingredients || []).map(x => ({ ...x })), subRecipes: (latest.subRecipes || []).map(x => ({ ...x })), steps: (latest.steps || []).join("\n"), yield: latest.yield || 1, yieldUnit: latest.yieldUnit || "份", lossPct: latest.lossPct || "", keepNote: latest.keepNote || "", note: latest.note || "" }
      : { ingredients: [], subRecipes: [], steps: "", yield: 1, yieldUnit: product.semi ? "g" : "份", lossPct: "", keepNote: "", note: "" });
  }, [recs, product.id]); // eslint-disable-line

  if (recs === null || !draft) return <div style={{ marginTop: 14, fontSize: 12, color: C.faint }}>🍳 食譜載入中…</div>;

  const ings = (db.ingredients || []).filter(g => !g.nonStock).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)); // 非物料（服務/費用）不進食譜
  const ingOf = (id) => ings.find(g => g.id === id);
  const upd = (fp) => setDraft(d => ({ ...d, ...fp }));
  const updLine = (i, fp) => upd({ ingredients: draft.ingredients.map((x, j) => j === i ? { ...x, ...fp } : x) });
  const dirty = JSON.stringify({ a: draft.ingredients, b: draft.subRecipes, c: draft.steps, d: draft.yield, e: draft.note, f: draft.yieldUnit, g: draft.lossPct, h: draft.keepNote }) !==
    JSON.stringify(latest ? { a: latest.ingredients || [], b: latest.subRecipes || [], c: (latest.steps || []).join("\n"), d: latest.yield || 1, e: latest.note || "", f: latest.yieldUnit || "份", g: latest.lossPct || "", h: latest.keepNote || "" } : { a: [], b: [], c: "", d: 1, e: "", f: product.semi ? "g" : "份", g: "", h: "" });

  const saveVersion = () => {
    const rec = {
      id: rid("rv"), product_id: product.id, ts: new Date().toISOString(), by: userName || "—",
      ingredients: draft.ingredients.filter(x => x.ingredient_id && Number(x.qty) > 0),
      subRecipes: (draft.subRecipes || []).filter(x => x.product_id && Number(x.qty) > 0),
      steps: String(draft.steps || "").split("\n").map(s => s.trim()).filter(Boolean),
      yield: Number(draft.yield) > 0 ? Number(draft.yield) : 1, yieldUnit: (draft.yieldUnit || "").trim() || "份",
      lossPct: Number(draft.lossPct) > 0 ? Number(draft.lossPct) : 0, keepNote: (draft.keepNote || "").trim(), note: draft.note || "",
    };
    window.storage.set(K("pm_recipe_v_" + rec.id), JSON.stringify(rec), true).catch(() => {});
    setRecs(prev => [...(prev || []), rec]);
  };

  // 成本試算：用「草稿」即時算（存檔前就看得到）；正式現值仍以最新版本為準
  const draftAsRecipe = { id: "_draft", product_id: product.id, ts: "9999", ingredients: draft.ingredients.filter(x => x.ingredient_id && Number(x.qty) > 0), subRecipes: (draft.subRecipes || []).filter(x => x.product_id && Number(x.qty) > 0), yield: Number(draft.yield) > 0 ? Number(draft.yield) : 1, lossPct: Number(draft.lossPct) > 0 ? Number(draft.lossPct) : 0 };
  const cost = recipeCost(db, [...(recs || []).filter(r => r.product_id !== product.id), draftAsRecipe], product.id);
  const sell = Number(product.price) || 0;
  const margin = sell > 0 && cost.total > 0 ? (sell - cost.total) / sell * 100 : null;
  const d2 = (n) => n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 100) / 100).toString();
  const hist = (recs || []).filter(r => r.product_id === product.id).sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

  return (
    <div style={{ marginTop: 14, borderTop: `1.5px solid ${C.hard}`, paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>🍳 食譜／SOP／成本</span>
        {latest ? <span style={{ fontSize: 10, color: C.faint }}>版本 {hist.length}・{new Date(latest.ts).toLocaleDateString("zh-TW")} {latest.by}</span> : <span style={{ fontSize: 10, color: C.amber, fontWeight: 700 }}>尚無食譜</span>}
        <div style={{ flex: 1 }} />
        {hist.length > 0 && <button onClick={() => setShowHist(h => !h)} style={{ border: "none", background: "none", color: C.sub, fontSize: 11, cursor: "pointer" }}>{showHist ? "▾" : "▸"} 歷史版本</button>}
      </div>
      {/* 用料（單位鎖＝物料 baseUnit） */}
      {draft.ingredients.map((li, i) => {
        const g = ingOf(li.ingredient_id);
        return (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            {/* 菜單=物料源頭（2026-07-22 張良第一性原理）：缺什麼物料，在這裡直接「＋新建物料卡」不用跳頁 */}
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
            }} disabled={!canEdit} style={{ ...inp, flex: 1, maxWidth: 200 }}>
              <option value="">選物料…</option>
              {ings.map(x => <option key={x.id} value={x.id}>{x.name || "（未命名）"}</option>)}
              {canEdit && save && <option value="__new">＋ 新建物料卡…</option>}
            </select>
            <input value={li.qty ?? ""} onChange={e => updLine(i, { qty: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="用量" style={{ ...inp, width: 70, fontFamily: MONOF, textAlign: "right" }} />
            <span style={{ fontSize: 11, color: C.sub, width: 30 }}>{g ? g.baseUnit : ""}</span>
            {canEdit && <button onClick={() => upd({ ingredients: draft.ingredients.filter((_, j) => j !== i) })} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer" }}>×</button>}
          </div>
        );
      })}
      {/* 半成品引用（兩店共用醬料/備料）：用量 × 半成品每單位成本（inv.recipeCost 遞迴，含它自己的耗損率） */}
      {(draft.subRecipes || []).map((sr, i) => {
        const semis = (db.products || []).filter(p => p.semi && p.id !== product.id);
        const subR = latestRecipeOf(recs || [], sr.product_id);
        const su = (subR && subR.yieldUnit) || "份";
        const updSub = (fp) => upd({ subRecipes: draft.subRecipes.map((x, j) => j === i ? { ...x, ...fp } : x) });
        return (
          <div key={"sr" + i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#fff", background: C.blue, borderRadius: 3, padding: "1px 5px", fontWeight: 700, flexShrink: 0 }}>半成品</span>
            <select value={sr.product_id || ""} onChange={e => updSub({ product_id: e.target.value })} disabled={!canEdit} style={{ ...inp, flex: 1, maxWidth: 163 }}>
              <option value="">選半成品…</option>
              {semis.map(p => <option key={p.id} value={p.id}>{p.name || "（未命名）"}</option>)}
            </select>
            <input value={sr.qty ?? ""} onChange={e => updSub({ qty: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="用量" style={{ ...inp, width: 70, fontFamily: MONOF, textAlign: "right" }} />
            <span style={{ fontSize: 11, color: C.sub, width: 30 }}>{su}</span>
            {canEdit && <button onClick={() => upd({ subRecipes: draft.subRecipes.filter((_, j) => j !== i) })} style={{ border: "none", background: "none", color: C.faint, cursor: "pointer" }}>×</button>}
          </div>
        );
      })}
      {canEdit && <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button onClick={() => upd({ ingredients: [...draft.ingredients, { ingredient_id: "", qty: "" }] })} style={{ border: `1px dashed ${C.line}`, background: "#fff", color: C.sub, borderRadius: 7, padding: "4px 12px", fontSize: 11.5, cursor: "pointer" }}>＋ 加用料</button>
        {(db.products || []).some(p => p.semi && p.id !== product.id) && <button onClick={() => upd({ subRecipes: [...(draft.subRecipes || []), { product_id: "", qty: "" }] })} style={{ border: `1px dashed ${C.blue}`, background: "#fff", color: C.blue, borderRadius: 7, padding: "4px 12px", fontSize: 11.5, cursor: "pointer" }}>＋ 加半成品</button>}
      </div>}
      {ings.length === 0 && <div style={{ fontSize: 11.5, color: C.amber, marginBottom: 6 }}>⚠ 還沒有物料——先到「🥬 物料」頁建物料卡，這裡才有得選。</div>}
      {/* SOP＋出成 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <label style={{ flex: 1, minWidth: 220, fontSize: 11, color: C.faint, fontWeight: 600 }}>SOP 步驟（一行一步，給現場看）
          <textarea value={draft.steps} onChange={e => upd({ steps: e.target.value })} disabled={!canEdit} rows={3} placeholder={"例：\n1. 醬料 30ml 打底\n2. …"} style={{ ...inp, width: "100%", marginTop: 3, resize: "vertical", fontFamily: "inherit" }} />
        </label>
        <label style={{ fontSize: 11, color: C.faint, fontWeight: 600 }}>此配方出成（量＋單位）
          <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
            <input value={draft.yield} onChange={e => upd({ yield: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" style={{ ...inp, width: 66, fontFamily: MONOF, textAlign: "center" }} />
            <input value={draft.yieldUnit ?? ""} onChange={e => upd({ yieldUnit: e.target.value })} disabled={!canEdit} placeholder="份" title="例：份／g／ml——半成品填 g 或 ml，成品用食譜引用時就照這個單位抓用量" style={{ ...inp, width: 44, textAlign: "center" }} />
          </div>
        </label>
        <label style={{ fontSize: 11, color: C.faint, fontWeight: 600 }} title="修清/蒸發等損耗：實得產量打折，每單位成本自動變貴；不填＝0">耗損率%
          <input value={draft.lossPct ?? ""} onChange={e => upd({ lossPct: e.target.value.replace(/[^0-9.]/g, "") })} disabled={!canEdit} inputMode="decimal" placeholder="0" style={{ ...inp, width: 52, marginTop: 3, fontFamily: MONOF, textAlign: "center", display: "block" }} />
        </label>
        <label style={{ fontSize: 11, color: C.faint, fontWeight: 600, minWidth: 150, flex: 1 }}>保存（方式/位置/期限）
          <input value={draft.keepNote ?? ""} onChange={e => upd({ keepNote: e.target.value })} disabled={!canEdit} placeholder="例：冷藏D+7／冷凍D+30" style={{ ...inp, width: "100%", marginTop: 3 }} />
        </label>
      </div>
      {/* 成本／毛利（用草稿即時試算；成本一律用最近實付價，絕不用報價） */}
      {showMoney && (
        <div style={{ background: "#faf6ec", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12 }}>{product.semi ? `每${(draft.yieldUnit || "份").trim() || "份"}成本` : "一份成本"} <b style={{ fontFamily: MONOF, color: C.accent }}>{cost.total > 0 ? "NT$" + (cost.total < 1 ? (Math.round(cost.total * 10000) / 10000).toString() : d2(cost.total)) : "—"}</b></span>
            {!product.semi && <span style={{ fontSize: 12 }}>售價 <b style={{ fontFamily: MONOF }}>{sell ? "NT$" + d2(sell) : "—"}</b></span>}
            {!product.semi && <span style={{ fontSize: 12 }}>毛利 <b style={{ fontFamily: MONOF, color: margin == null ? C.faint : margin < 50 ? C.red : C.green }}>{margin == null ? "—" : `NT$${d2(sell - cost.total)}（${Math.round(margin)}%）`}</b></span>}
            {product.semi && Number(draft.yield) > 0 && cost.total > 0 && <span style={{ fontSize: 12 }}>整批成本 <b style={{ fontFamily: MONOF }}>NT${d2(cost.total * Number(draft.yield) * (1 - Math.min(Math.max(Number(draft.lossPct) || 0, 0), 90) / 100))}</b>（出成 {draft.yield}{draft.yieldUnit || "份"}{Number(draft.lossPct) > 0 ? `，耗損 ${draft.lossPct}%` : ""}）</span>}
          </div>
          {cost.missing.length > 0 && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>⚠ 成本不完整：{cost.missing.join("；")}（補齊物料換算/驗收一次進價就會準）</div>}
        </div>
      )}
      {canEdit && <button disabled={!dirty} onClick={saveVersion} style={{ border: "none", background: dirty ? C.green : "#d5cbb6", color: "#fff", borderRadius: 7, padding: "7px 16px", fontSize: 12.5, fontWeight: 700, cursor: dirty ? "pointer" : "default" }}>💾 儲存食譜（存為新版本，舊版保留）</button>}
      {/* 歷史版本（唯讀）：報表要算過去成本時取 ts≤當日的版本 */}
      {showHist && hist.map(r => (
        <div key={r.id} style={{ fontSize: 11, color: C.sub, borderTop: `1px solid #f0ead9`, padding: "4px 0", marginTop: 4 }}>
          <span style={{ fontFamily: MONOF, color: C.faint }}>{new Date(r.ts).toLocaleString("zh-TW", { hour12: false })}</span>・{r.by}・
          {(r.ingredients || []).map(li => { const g = ingOf(li.ingredient_id); return `${g ? g.name : "?"}×${li.qty}${g ? g.baseUnit : ""}`; }).join("、") || "（空）"}
          {Number(r.yield) > 1 ? `／出成${r.yield}份` : ""}
        </div>
      ))}
    </div>
  );
}
